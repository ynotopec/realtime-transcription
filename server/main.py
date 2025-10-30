import asyncio
import json
import os
import time
from collections import deque

import numpy as np
import webrtcvad
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("FW_MODEL", "large-v3")
DEVICE = os.getenv("FW_DEVICE", "auto")
COMPUTE = os.getenv("FW_COMPUTE", "float16")
SAMPLE_RATE = 16000
FRAME_MS = 20
CHUNK_MS = 200
SIL_MS_END = 500
OVERLAP_SEC = 0.4
PARTIAL_EVERY_MS = 400

app = FastAPI()
app.mount("/", StaticFiles(directory="public", html=True), name="public")

model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)

def bytes_to_int16(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.int16)


@app.websocket("/ws")
async def ws_stream(ws: WebSocket):
    await ws.accept()
    vad = webrtcvad.Vad(2)
    ring = deque(maxlen=int((10_000 / FRAME_MS)))
    voiced = False
    last_voice_ts = time.time()
    last_partial_ts = 0.0
    overlap = np.zeros(int(OVERLAP_SEC * SAMPLE_RATE), dtype=np.int16)

    async def transcribe_block(audio_i16: np.ndarray, final: bool = False):
        nonlocal overlap
        if audio_i16.size == 0:
            return
        buf = np.concatenate([overlap, audio_i16]).astype(np.float32) / 32768.0
        segments, _ = model.transcribe(
            buf,
            language=None,
            beam_size=1,
            best_of=1,
            vad_filter=False,
            temperature=[0.0, 0.2, 0.4],
            condition_on_previous_text=True,
            no_speech_threshold=0.3,
            initial_prompt=None,
        )
        text = "".join([s.text for s in segments]).strip()
        if text:
            await ws.send_text(json.dumps({"type": "final" if final else "partial", "text": text}))
        keep = int(OVERLAP_SEC * SAMPLE_RATE)
        if audio_i16.size >= keep:
            overlap = audio_i16[-keep:]
        else:
            overlap = np.pad(audio_i16, (keep - audio_i16.size, 0), mode="constant")

    frame_len = int(SAMPLE_RATE * FRAME_MS / 1000)

    try:
        while True:
            msg = await ws.receive()
            if "bytes" in msg:
                pcm = bytes_to_int16(msg["bytes"])
                for i in range(0, len(pcm), frame_len):
                    frame = pcm[i : i + frame_len]
                    if len(frame) < frame_len:
                        break
                    is_speech = vad.is_speech(frame.tobytes(), SAMPLE_RATE)
                    ring.append(frame.tobytes())
                    if is_speech:
                        voiced = True
                        last_voice_ts = time.time()
                    if voiced and (time.time() - last_partial_ts) * 1000 >= PARTIAL_EVERY_MS:
                        last_partial_ts = time.time()
                        need = int((SAMPLE_RATE * CHUNK_MS) / 1000)
                        if not ring:
                            continue
                        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
                        audio_tail = flat[-need * 2 :] if flat.size > need * 2 else flat
                        await transcribe_block(audio_tail, final=False)
                    if voiced and (time.time() - last_voice_ts) * 1000 >= SIL_MS_END:
                        voiced = False
                        if not ring:
                            continue
                        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
                        await transcribe_block(flat, final=True)
                        ring.clear()
            else:
                pass
    except WebSocketDisconnect:
        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
        if flat.size > 0:
            await transcribe_block(flat, final=True)
        return
