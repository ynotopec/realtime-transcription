// public/client.js — ouvre le micro, resample -> 16 kHz, envoie par WS et affiche les résultats
const TARGET_SAMPLE_RATE = 16000;
const logEl = document.getElementById('log');
const finalEl = document.getElementById('final');
const partialEl = document.getElementById('partial');

const log = (message) => {
  const timestamp = new Date().toLocaleTimeString();
  logEl.textContent += `[${timestamp}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

const appendFinal = (text) => {
  if (!text) return;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  finalEl.appendChild(paragraph);
  finalEl.scrollTop = finalEl.scrollHeight;
};

const showPartial = (text) => {
  partialEl.textContent = text || '';
};

const clearFinal = () => {
  finalEl.innerHTML = '';
  finalEl.scrollTop = 0;
};

const resetTranscript = () => {
  clearFinal();
  showPartial('');
};

let ws, audioCtx, workletNode, socketOpen = false;

async function start() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule('/static/worklet.js');
    await audioCtx.resume();

    const src = audioCtx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioCtx, 'pcm16-worklet');
    workletNode.port.postMessage({ type: 'config', targetSampleRate: TARGET_SAMPLE_RATE });
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    src.connect(workletNode);
    workletNode.connect(silentGain).connect(audioCtx.destination);

    // WebSocket binaire
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { socketOpen = true; log("WS connecté"); };
    ws.onclose = () => { socketOpen = false; log("WS fermé"); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'partial') {
        showPartial(msg.text);
        log(`… ${msg.text}`);
      }
      if (msg.type === 'final') {
        appendFinal(msg.text);
        showPartial('');
        log(`✅ ${msg.text}`);
      }
    };

    workletNode.port.onmessage = (e) => {
      if (!socketOpen) return;
      const pcm = e.data; // Int16Array
      ws.send(pcm.buffer.slice(0));
    };

    document.getElementById('start').disabled = true;
    document.getElementById('stop').disabled = false;
    resetTranscript();
  } catch (err) {
    log(`❌ Erreur: ${err?.message || err}`);
    stop();
  }
}

function stop() {
  try { ws && ws.close(); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
  document.getElementById('start').disabled = false;
  document.getElementById('stop').disabled = true;
  showPartial('');
}

document.getElementById('start').onclick = start;
document.getElementById('stop').onclick = stop;
