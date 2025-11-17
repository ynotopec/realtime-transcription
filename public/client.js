// public/client.js — ouvre le micro, resample -> 16 kHz, envoie par WS et affiche les résultats
const TARGET_SAMPLE_RATE = 16000;
const logEl = document.getElementById('log');
const finalEl = document.getElementById('final');
const partialEl = document.getElementById('partial');

const log = (message) => {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${message}\n`;
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
  console.debug(line.trim());
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
let chunksSent = 0;

async function start() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TARGET_SAMPLE_RATE,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
    log('Micro autorisé, création AudioContext…');
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule('/static/worklet.js');
    await audioCtx.resume();
    const ratio = audioCtx.sampleRate / TARGET_SAMPLE_RATE;
    log(
      `AudioContext ready (sampleRate=${audioCtx.sampleRate}Hz → target ${TARGET_SAMPLE_RATE}Hz, ratio=${ratio.toFixed(3)})`,
    );

    const src = audioCtx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioCtx, 'pcm16-worklet');
    workletNode.port.postMessage({ type: 'config', targetSampleRate: TARGET_SAMPLE_RATE });
    log('Worklet chargé et configuré à 16 kHz');
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    src.connect(workletNode);
    workletNode.connect(silentGain).connect(audioCtx.destination);

    // WebSocket binaire
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { socketOpen = true; log("WS connecté"); };
    ws.onerror = (ev) => log(`⚠️ WS error: ${ev?.message || 'see console'}`);
    ws.onclose = (ev) => { socketOpen = false; log(`WS fermé (code=${ev.code}, reason=${ev.reason})`); };
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
      if (!msg.type) {
        log(`⚠️ Message inconnu depuis WS: ${ev.data}`);
      }
    };

    workletNode.port.onmessage = (e) => {
      if (!socketOpen) return;
      const pcm = e.data; // Int16Array
      chunksSent += 1;
      if (chunksSent % 50 === 0) {
        log(`→ ${chunksSent} chunks envoyés (${pcm.length} échantillons chacun)`);
      }
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
