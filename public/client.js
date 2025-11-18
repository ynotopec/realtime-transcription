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

const appendFinal = (text, { allowEmpty = false } = {}) => {
  if (!allowEmpty && !text) return;
  const content = text || '(aucun texte détecté)';
  const paragraph = document.createElement('p');
  paragraph.textContent = content;
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

// File upload elements
const wavInput = document.getElementById('wavInput');
const sendFileBtn = document.getElementById('sendFile');
const fileStatusEl = document.getElementById('fileStatus');
const fileResultEl = document.getElementById('fileResult');

const setFileStatus = (message, isError = false) => {
  if (!fileStatusEl) return;
  fileStatusEl.textContent = message || '';
  fileStatusEl.classList.toggle('error', Boolean(isError));
};

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

const renderFileResult = (payload) => {
  if (!fileResultEl) return;
  const transcriptText = payload?.text || '';
  const displayText = transcriptText || '(aucun texte détecté)';
  const durationSeconds = payload?.frames
    ? (payload.frames / TARGET_SAMPLE_RATE).toFixed(2)
    : '—';
  const meta = `Durée lue: ${durationSeconds}s • Transcription en ${payload?.duration_ms ?? '?'} ms`;
  fileResultEl.textContent = `${displayText}\n\n${meta}`;

  resetTranscript();
  appendFinal(transcriptText, { allowEmpty: true });
  showPartial('');
};

const transcribeFile = async () => {
  if (!wavInput?.files?.length) {
    setFileStatus('Sélectionnez un fichier WAV mono 16 kHz.');
    return;
  }
  const file = wavInput.files[0];
  setFileStatus('Envoi du fichier…');
  fileResultEl.textContent = '';
  if (sendFileBtn) sendFileBtn.disabled = true;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/transcribe-file', { method: 'POST', body: formData });
    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error('Réponse serveur illisible');
    }
    if (!response.ok) {
      const detail = payload?.detail || `HTTP ${response.status}`;
      throw new Error(detail);
    }
    renderFileResult(payload);
    setFileStatus('Transcription terminée');
    log(`🧪 Transcription fichier: ${payload.text || '(aucun texte)'}`);
  } catch (err) {
    setFileStatus(`Erreur: ${err.message || err}`, true);
    if (fileResultEl) fileResultEl.textContent = '';
  } finally {
    if (sendFileBtn) sendFileBtn.disabled = false;
  }
};

if (sendFileBtn) {
  sendFileBtn.onclick = transcribeFile;
}
