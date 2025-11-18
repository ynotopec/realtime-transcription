# Realtime Transcription Demo

A minimal end-to-end speech-to-text stack built with [FastAPI](https://fastapi.tiangolo.com/),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper), and a vanilla browser client.
Audio is captured in the browser, resampled to 16 kHz, streamed over a WebSocket, and
transcribed on the server in near real time.

## Table of contents

1. [Features](#features)
2. [Architecture overview](#architecture-overview)
3. [Quick start](#quick-start)
4. [Configuration](#configuration)
5. [Project layout](#project-layout)
6. [Troubleshooting](#troubleshooting)
7. [Production checklist](#production-checklist)
8. [Ressources en français](#ressources-en-français)

## Features

- 🌐 **FastAPI + WebSocket backend** that performs voice activity detection (VAD) and incremental
  transcription with partial/final hypotheses.
- 🎧 **Browser client** (plain HTML/JS) that records audio via an `AudioWorklet`, resamples to
  16 kHz PCM16, and streams it over a binary WebSocket.
- 🧠 **Configurable faster-whisper model** with sensible defaults for CPU, GPU, or auto-selected
  hardware.
- 🧪 **WAV file testing path**—upload a mono 16 kHz WAV from the UI (or `POST /transcribe-file`) to
  validate the end-to-end chain without a microphone.

## Architecture overview

```
Browser (AudioWorklet 16 kHz PCM)
   │
   ├── binary WebSocket stream
   ▼
FastAPI (async) + WebRTC VAD + sliding buffer
   │
   └── faster-whisper (CTranslate2) → JSON messages (partial / final)
```

**Audio format path (16 kHz mono)**

- The browser requests a mono microphone track and explicitly targets 16 kHz; the AudioContext
  reports its native rate, and the worklet resamples to 16 kHz PCM16 before streaming.
- The backend closes the WebSocket if it cannot validate the 20 ms frame length for 16 kHz audio
  and logs the expected format (`16-bit PCM mono @ 16000 Hz`).

## Quick start

### 1. Install dependencies

This project targets **Python 3.10+**. Create a virtual environment and install the dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. (Optional) Pre-download a model

By default the service loads the `large-v3` faster-whisper model. Set `FW_MODEL` to a smaller
variant such as `medium.en` or `small` if you prefer faster downloads or lower latency.

### 3. Run the development server

Launch the API and static frontend with Uvicorn:

```bash
uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

Then open <http://localhost:8000> in a Chromium-based browser and grant microphone access.

## Configuration

The backend honors several environment variables:

| Variable     | Default    | Description                                       |
| ------------ | ---------- | ------------------------------------------------- |
| `FW_MODEL`   | `large-v3` | Name of the faster-whisper model to load.         |
| `FW_DEVICE`  | `auto`     | Inference device (`cpu`, `cuda`, etc.).           |
| `FW_COMPUTE` | `float16`  | Precision / compute type passed to faster-whisper.|

Example usage:

```bash
FW_MODEL=medium.en FW_DEVICE=cuda FW_COMPUTE=float16 \
  uvicorn server.main:app --host 0.0.0.0 --port 8000
```

## Project layout

```
.
├── public/           # Static frontend served by FastAPI
│   ├── index.html    # UI with start/stop controls
│   ├── client.js     # Captures audio and streams via WebSocket
│   └── worklet.js    # AudioWorkletProcessor that outputs PCM16 frames
├── server/
│   └── main.py       # FastAPI app, VAD loop, faster-whisper integration
├── requirements.txt  # Python dependencies
├── Dockerfile        # Container recipe (CUDA base image)
└── run.sh            # Convenience script for environment creation & launch
```

## Troubleshooting

- The first transcription may take longer while the model downloads or initializes.
- On CPU-only hosts, consider a smaller model for better latency.
- Ensure the browser tab has permission to use the microphone; otherwise the **Start** button
  appears to do nothing.
- If CUDA/cuDNN libraries are missing, startup will detect the absence and automatically
  select `FW_DEVICE=cpu` with `FW_COMPUTE=float32` before initializing faster-whisper.
  You can set these values explicitly to avoid GPU-related warnings.
- Ensure a compatible `torch` wheel is installed for your platform (CPU-only or matching
  CUDA version). For example, with CUDA 12.4 use `pip install --index-url
  https://download.pytorch.org/whl/cu124 torch==2.4.1` before installing the remaining
  requirements.

## Production checklist

- Terminate TLS at your ingress and upgrade to **WSS**.
- Add autoscaling based on concurrent sessions; expose a `/healthz` endpoint.
- If sharing GPUs, cap the number of concurrent decodes with an asyncio semaphore.
- Track metrics such as processing duration, real-time factor (RTF), partial/final latency, and
  VAD-trigger counts.

## Ressources en français

Bonjour Antonio ! Voici un résumé rapide pour un déploiement temps réel **micro navigateur →
faster-whisper** :

1. **Front-end** — `public/index.html`, `public/worklet.js`, `public/client.js` capturent le micro,
   transforment en PCM 16 kHz mono, et envoient les chunks via WebSocket.
2. **Serveur FastAPI** — VAD `webrtcvad`, tampon glissant, appels `faster_whisper.WhisperModel`
   avec `beam_size=1`, `best_of=1`, `condition_on_previous_text=True`, et overlap de 0,3–0,6 s.
3. **Latence / qualité** —
   - Modèle `large-v3` pour la qualité, `medium`/`small` si GPU limité, ou `distil-*` sur CPU.
   - `webrtcvad(2)` est un bon compromis ; ajuste `SIL_MS_END` (300–800 ms).
   - Cadence partielle : 300–600 ms pour un retour quasi temps réel.
   - Active l’annuleur d’écho navigateur et évite de jouer l’audio localement.
   - Fixe `language="fr"` ou `"en"` si ton usage est mono-langue ; sinon laisse `None`.
   - Utilise `initial_prompt` pour biaiser le lexique si besoin.
4. **Docker (optionnel)** — Voir `Dockerfile` pour une image basée sur `nvidia/cuda:12.1.1`.
5. **Checklist prod** — TLS, autoscaling, slicing GPU, logs/metrics détaillés.

Besoin d’une Chart Helm minimaliste ? Il suffit d’exposer `server.main:app`, d’ajouter un Ingress
`public`, et d’optionnellement forcer `language="fr"` via la config.

## License

This project is provided as-is for demonstration purposes. Please consult the licenses of the
upstream dependencies (FastAPI, faster-whisper, WebRTC VAD) for their respective terms.
