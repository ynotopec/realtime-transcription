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
