// public/client.js — ouvre le micro, resample -> 16 kHz, envoie par WS et affiche les résultats
const TARGET_SAMPLE_RATE = 16000;
const log = (m) => (document.getElementById('log').textContent += m + "\n");

let ws, audioCtx, workletNode, socketOpen = false;

async function start() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.audioWorklet.addModule('./worklet.js');
    await audioCtx.resume();

    const src = audioCtx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioCtx, 'pcm16-worklet');
    workletNode.port.postMessage({ type: 'config', targetSampleRate: TARGET_SAMPLE_RATE });
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    src.connect(workletNode);
    workletNode.connect(silentGain).connect(audioCtx.destination);

    // WebSocket binaire — adapte le protocole si la page est servie en HTTPS
    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${wsProtocol}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { socketOpen = true; log("WS connecté"); };
    ws.onclose = () => { socketOpen = false; log("WS fermé"); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'partial') log(`… ${msg.text}`);
      if (msg.type === 'final')   log(`✅ ${msg.text}`);
    };

    workletNode.port.onmessage = (e) => {
      if (!socketOpen) return;
      const pcm = e.data; // Int16Array
      ws.send(pcm.buffer.slice(0));
    };

    document.getElementById('start').disabled = true;
    document.getElementById('stop').disabled = false;
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
}

document.getElementById('start').onclick = start;
document.getElementById('stop').onclick = stop;
