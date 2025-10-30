// public/worklet.js — AudioWorkletProcessor -> Float32 mono -> Int16 PCM
class PCM16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.sampleRatio = sampleRate / this.targetSampleRate;
    this.buffer = [];
    this.cursor = 0;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'config' && e.data.targetSampleRate) {
        this.targetSampleRate = e.data.targetSampleRate;
        this.sampleRatio = sampleRate / this.targetSampleRate;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0]; // mono
    for (let i = 0; i < float32.length; i++) {
      this.buffer.push(float32[i]);
    }

    if (!isFinite(this.sampleRatio) || this.sampleRatio <= 0) {
      return true;
    }

    const availableSamples = this.buffer.length - this.cursor;
    const outputLength = Math.floor(availableSamples / this.sampleRatio);
    if (outputLength <= 0) {
      return true;
    }

    const pcm = new Int16Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const idx = this.cursor + i * this.sampleRatio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, this.buffer.length - 1);
      const frac = idx - i0;
      const sample = this.buffer[i0] + (this.buffer[i1] - this.buffer[i0]) * frac;
      const s = Math.max(-1, Math.min(1, sample));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    this.cursor += outputLength * this.sampleRatio;
    const consumed = Math.floor(this.cursor);
    if (consumed > 0) {
      this.buffer = this.buffer.slice(consumed);
      this.cursor -= consumed;
    }

    this.port.postMessage(pcm); // <-- envoi vers main thread
    return true;
  }
}

registerProcessor('pcm16-worklet', PCM16Worklet);
