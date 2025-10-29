// public/client.js — ouvre le micro, resample -> 16 kHz, envoie par WS et affiche les résultats
const log = (m) => (document.getElementById('log').textContent += m + "\n");

let ws, audioCtx, workletNode, socketOpen = false;
let resamplerNode;

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true, autoGainControl: true } });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); // force 16 kHz
  await audioCtx.audioWorklet.addModule('./worklet.js');

  const src = audioCtx.createMediaStreamSource(stream);
  workletNode = new AudioWorkletNode(audioCtx, 'pcm16-worklet');
  src.connect(workletNode);

  // WebSocket binaire
  ws = new WebSocket(`ws://${location.host}/ws`);
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
    ws.send(pcm.buffer);
  };

  document.getElementById('start').disabled = true;
  document.getElementById('stop').disabled = false;
}

function stop() {
  try { ws && ws.close(); } catch {}
  try { audioCtx && audioCtx.close(); } catch {}
  document.getElementById('start').disabled = false;
  document.getElementById('stop').disabled = true;
}

document.getElementById('start').onclick = start;
document.getElementById('stop').onclick = stop;
