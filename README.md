# Realtime Transcription Demo

This project showcases a lightweight speech-to-text stack powered by [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and a minimal FastAPI backend. Audio is captured in the browser, resampled to 16&nbsp;kHz, and streamed over a WebSocket to the server where segments are transcribed in near real-time.

## Features

- 🌐 **FastAPI + WebSocket server** that performs voice activity detection (VAD) and incremental transcription.
- 🎧 **Browser client** built with vanilla HTML/JS that captures microphone input and streams 16-bit PCM chunks through an `AudioWorklet`.
- 🧠 **Configurable faster-whisper model** with sensible defaults for running on CPU, GPU, or auto-selected hardware.

## Getting started

### 1. Install dependencies

This repository targets Python 3.10+. Create a virtual environment and install the Python requirements:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. (Optional) Download a faster-whisper model ahead of time

By default the service loads the `large-v3` model which can take a while the first time. You can set `FW_MODEL` to a smaller model such as `medium.en` or `small` to speed up downloads and inference.

### 3. Run the development server

Launch the API and static frontend with Uvicorn:

```bash
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

Then open <http://localhost:8000> in a Chromium-based browser and grant microphone access.

## Environment variables

The server recognizes a few environment variables that can be tuned for your hardware:

| Variable      | Default    | Description |
| ------------- | ---------- | ----------- |
| `FW_MODEL`    | `large-v3` | Name of the faster-whisper model to load. |
| `FW_DEVICE`   | `auto`     | Device to run inference on (`cpu`, `cuda`, etc.). |
| `FW_COMPUTE`  | `float16`  | Precision/compute type passed to faster-whisper. |

Set them before launching Uvicorn, for example:

```bash
FW_MODEL=medium.en FW_DEVICE=cuda FW_COMPUTE=float16 \
  uvicorn server.main:app --host 0.0.0.0 --port 8000
```

## Project structure

```
.
├── public/           # Static frontend served by FastAPI
│   ├── index.html    # Simple UI with start/stop controls
│   ├── client.js     # Browser logic to capture audio and stream via WS
│   └── worklet.js    # AudioWorklet processor that outputs PCM16 frames
├── server/
│   └── main.py       # FastAPI app, VAD loop, and faster-whisper integration
├── requirements.txt  # Python dependencies
└── Dockerfile        # Container recipe for deployment or testing
```

## Troubleshooting

- The first transcription request may take longer while the model is downloaded or loaded into memory.
- When running on CPU, consider switching to a smaller model for better latency.
- Ensure the browser tab has permission to use the microphone; otherwise the `start` button will fail silently.

## License

This project is provided as-is for demonstration purposes. Please consult the licenses of the upstream dependencies (FastAPI, faster-whisper, WebRTC VAD) for their respective terms.

Bonjour Antonio !
Voici une solution **clé-en-main** pour du **streaming micro navigateur → faster-whisper** en temps réel (WebSocket). Elle marche sans WebRTC serveur (plus simple à déployer), avec **VAD** (détection de parole) côté serveur, hypothèses **partielles** + **finales**, et **multilingue** auto.

# Architecture rapide

Navigateur (AudioWorklet 16 kHz PCM) → **WebSocket** binaire → FastAPI (async) → **VAD (webrtcvad)** + tampon glissant → **faster-whisper (CTranslate2)** → messages JSON (partial/final) → Navigateur.

---

# 1) Front-end (capture micro & envoi PCM 16 kHz)

Crée `public/index.html` + `public/worklet.js` + `public/client.js`.

```html
<!-- public/index.html -->
<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Streaming ASR (faster-whisper)</title></head>
<body>
  <button id="start">🎙️ Démarrer</button>
  <button id="stop" disabled>⏹️ Stop</button>
  <pre id="log"></pre>
  <script type="module" src="./client.js"></script>
</body>
</html>
```

```js
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
```

```js
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
```

> Remarque : on force l’AudioContext à **16 kHz** (pratique pour faster-whisper). Les navigateur délivrent parfois 48 kHz ; ici, on laisse le resampling au navigateur (simple et fiable).

---

# 2) Back-end FastAPI (WebSocket + VAD + faster-whisper)

Crée `server/main.py` et un `requirements.txt`.

```txt
# requirements.txt
fastapi==0.115.0
uvicorn[standard]==0.30.0
numpy==2.1.1
webrtcvad==2.0.10
faster-whisper==1.0.3
pydantic==2.9.0
```

```python
# server/main.py
import asyncio, time, json, os, numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel
import webrtcvad
from collections import deque

# --------- Config ----------
MODEL_NAME = os.getenv("FW_MODEL", "large-v3")   # multilingue robuste
DEVICE     = os.getenv("FW_DEVICE", "auto")      # "cuda" / "cpu" / "auto"
COMPUTE    = os.getenv("FW_COMPUTE", "float16")  # "int8_float16" pour GPU faible
SAMPLE_RATE = 16000
FRAME_MS    = 20            # 20ms frames pour VAD (320 samples @16k)
CHUNK_MS    = 200           # regroupe ~200ms avant tentative decode
SIL_MS_END  = 500           # fin si 500ms de silence
OVERLAP_SEC = 0.4           # recouvrement pour contexte
PARTIAL_EVERY_MS = 400      # cadence hypothèses partielles

# --------- Init ----------
app = FastAPI()
app.mount("/", StaticFiles(directory="public", html=True), name="public")

model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)

def bytes_to_int16(b: bytes) -> np.ndarray:
    arr = np.frombuffer(b, dtype=np.int16)
    return arr

@app.websocket("/ws")
async def ws_stream(ws: WebSocket):
    await ws.accept()
    vad = webrtcvad.Vad(2)  # 0..3 (agressivité)
    ring = deque(maxlen=int((10_000 / FRAME_MS)))  # ~10s tampon max
    voiced = False
    last_voice_ts = time.time()
    last_partial_ts = 0.0
    pending = np.zeros(0, dtype=np.int16)
    overlap = np.zeros(int(OVERLAP_SEC * SAMPLE_RATE), dtype=np.int16)

    async def transcribe_block(audio_i16: np.ndarray, final=False):
        nonlocal overlap
        if audio_i16.size == 0: return
        # concat overlap pour la stabilité
        buf = np.concatenate([overlap, audio_i16]).astype(np.float32) / 32768.0
        # decode "streaming-like": temperature fallback + no vad in model (on a déjà un VAD)
        segments, _ = model.transcribe(
            buf,
            language=None,  # auto
            beam_size=1,
            best_of=1,
            vad_filter=False,
            temperature=[0.0, 0.2, 0.4],
            condition_on_previous_text=True,
            no_speech_threshold=0.3,
            initial_prompt=None,  # tu peux injecter ici si tu veux un biais lexical
        )
        text = "".join([s.text for s in segments]).strip()
        if text:
            await ws.send_text(json.dumps({
                "type": "final" if final else "partial",
                "text": text
            }))
        # prépare overlap pour prochaine passe
        keep = int(OVERLAP_SEC * SAMPLE_RATE)
        if audio_i16.size >= keep:
            overlap = audio_i16[-keep:]
        else:
            overlap = np.pad(audio_i16, (keep - audio_i16.size, 0), mode='constant')

    try:
        while True:
            msg = await ws.receive()
            if "bytes" in msg:
                pcm = bytes_to_int16(msg["bytes"])
                # VAD par frames 20ms
                frame_len = int(SAMPLE_RATE * FRAME_MS / 1000)
                for i in range(0, len(pcm), frame_len):
                    frame = pcm[i:i+frame_len]
                    if len(frame) < frame_len:
                        break
                    is_speech = vad.is_speech(frame.tobytes(), SAMPLE_RATE)
                    ring.append(frame)
                    if is_speech:
                        voiced = True
                        last_voice_ts = time.time()
                    # déclenchement partiel régulier
                    if voiced and (time.time() - last_partial_ts) * 1000 >= PARTIAL_EVERY_MS:
                        last_partial_ts = time.time()
                        # prend dernier CHUNK_MS (sans vider)
                        need = int((SAMPLE_RATE * CHUNK_MS) / 1000)
                        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
                        audio_tail = flat[-need*2:] if flat.size > need*2 else flat
                        await transcribe_block(audio_tail, final=False)

                    # fin d’énoncé si silence prolongé
                    if voiced and (time.time() - last_voice_ts) * 1000 >= SIL_MS_END:
                        voiced = False
                        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
                        await transcribe_block(flat, final=True)
                        ring.clear()
            else:
                # text frames (optionnel pour commandes)
                pass
    except WebSocketDisconnect:
        # flush final si reste audio
        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
        if flat.size > 0:
            await transcribe_block(flat, final=True)
        return
```

Lance le serveur :

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
FW_MODEL=large-v3 FW_DEVICE=cuda FW_COMPUTE=float16 uvicorn server.main:app --host 0.0.0.0 --port 8000
# Ouvre ensuite http://localhost:8000/
```

---

# 3) Conseils de **latence** & **qualité**

* **Modèle** : `large-v3` (qualité), `medium` ou `small` si GPU limité. Sur CPU pur, teste `distil-*` (si dispo) ou `int8_float16` sur GPU moyen.
* **VAD** : `webrtcvad(2)` est un bon compromis ; ajuste `SIL_MS_END` (300–800 ms) selon le débit de parole.
* **Overlap** : 0.3–0.6 s stabilise les débuts/fin de mots entre passes (évite les coupes).
* **Cadence partielle** : 300–600 ms donne un bon “quasi-temps réel” sans surcharge.
* **Echo** : active l’annuleur d’écho navigateur (déjà dans les contraintes `getUserMedia`) et évite de jouer l’audio capturé sur les mêmes HP.
* **Langue** : laisse `language=None` pour l’auto-détection ; si ton use-case est surtout FR/EN, fixe `language="fr"` ou `"en"` pour gagner en stabilité/latence.
* **Prompt contextuel** : tu peux passer `initial_prompt="contexte métier, noms propres, orthographe souhaitée"` pour biaiser le lexique (même si faster-whisper n’a pas de vrai streaming interne, le “condition_on_previous_text” + overlap fait le job).

---

# 4) Variante **Docker** (facultatif)

```Dockerfile
# Dockerfile
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y python3 python3-venv python3-pip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt
COPY server ./server
COPY public ./public
ENV FW_MODEL=large-v3 FW_DEVICE=cuda FW_COMPUTE=float16
EXPOSE 8000
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build & run :

```bash
docker build -t asr-realtime .
docker run --gpus all -p 8000:8000 asr-realtime
```

---

# 5) Mini check-list prod

* **TLS** (WSS) via ton Ingress (K8S) ou Caddy/Nginx.
* **Autoscaling** : 1 pod ≈ N sessions (dépend du modèle/GPU) ; expose un **/healthz**.
* **Time slicing** : si GPU partagé, limite le nb. de décodages concurrents (sémaphore asyncio).
* **Logs/metrics** : durée traitement, RTF, latence partielle/finale, taux VAD.

Si tu veux, je peux te générer une **Chart Helm** minimaliste (IngressClass `public`) pour ton cluster CPiN/Scaleway, et une option pour forcer `language="fr"` (ou auto).
