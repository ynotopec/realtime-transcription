// public/worklet.js — AudioWorkletProcessor -> Float32 mono -> Int16 PCM
class PCM16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => { /* reserved */ };
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const float32 = input[0]; // mono
    const pcm = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage(pcm); // <-- envoi vers main thread
    return true;
  }
}
registerProcessor('pcm16-worklet', PCM16Worklet);
