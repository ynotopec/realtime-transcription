import asyncio
import contextlib
import json
import logging
import os
import time
from collections import deque

import numpy as np
import webrtcvad
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
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
app.mount("/static", StaticFiles(directory="public"), name="static")


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse("public/index.html")

model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)

def bytes_to_int16(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.int16)


@app.on_event("startup")
async def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


@app.websocket("/ws")
async def ws_stream(ws: WebSocket):
    await ws.accept()
    log = logging.getLogger("asr.stream")
    log.info("WebSocket accepted from %s", ws.client)

    vad = webrtcvad.Vad(2)
    ring = deque(maxlen=int((10_000 / FRAME_MS)))
    voiced = False
    last_voice_ts = time.time()
    last_partial_ts = 0.0
    overlap = np.zeros(int(OVERLAP_SEC * SAMPLE_RATE), dtype=np.int16)
    pending = b""
    last_backend_ts = time.time()
    last_vad_ts = time.time()
    last_transcription_ts = time.time()

    async def monitor_inactivity():
        while True:
            await asyncio.sleep(3)
            now = time.time()
            if now - last_backend_ts >= 3:
                log.warning("No backend input for %.1f seconds", now - last_backend_ts)
            if now - last_vad_ts >= 3:
                log.warning("No VAD input for %.1f seconds", now - last_vad_ts)
            if now - last_transcription_ts >= 3:
                log.warning(
                    "No transcription input for %.1f seconds", now - last_transcription_ts
                )

    async def transcribe_block(audio_i16: np.ndarray, final: bool = False):
        nonlocal overlap
        nonlocal last_transcription_ts
        if audio_i16.size == 0:
            return
        buf = np.concatenate([overlap, audio_i16]).astype(np.float32) / 32768.0
        started = time.perf_counter()
        last_transcription_ts = time.time()
        log.info(
            "Transcribe %sms (%s samples, final=%s)",
            round(len(buf) / SAMPLE_RATE * 1000, 1),
            buf.size,
            final,
        )
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
        duration_ms = (time.perf_counter() - started) * 1000
        log.info("Transcribe done in %.1f ms, text='%s'", duration_ms, text)
        if text:
            payload = {"type": "final" if final else "partial", "text": text}
            await ws.send_text(json.dumps(payload))
            log.info("Sent %s text to client (%d chars)", payload["type"], len(text))
        keep = int(OVERLAP_SEC * SAMPLE_RATE)
        if audio_i16.size >= keep:
            overlap = audio_i16[-keep:]
        else:
            overlap = np.pad(audio_i16, (keep - audio_i16.size, 0), mode="constant")

    frame_len = int(SAMPLE_RATE * FRAME_MS / 1000)
    if not webrtcvad.valid_rate_and_frame_length(SAMPLE_RATE, frame_len):
        log.error("Invalid VAD frame length=%d for sample_rate=%d", frame_len, SAMPLE_RATE)
        await ws.close(code=1003, reason="Unsupported audio format")
        return
    log.info(
        "Expecting 16-bit PCM mono @ %d Hz (frame=%d samples, %d ms)",
        SAMPLE_RATE,
        frame_len,
        FRAME_MS,
    )

    monitor_task = asyncio.create_task(monitor_inactivity())

    try:
        while True:
            msg = await ws.receive()
            if "bytes" in msg and msg["bytes"]:
                last_backend_ts = time.time()
                combined = pending + msg["bytes"]
                pcm = bytes_to_int16(combined)
                log.debug(
                    "Received %d samples (bytes=%d, pending=%d)",
                    pcm.size,
                    len(msg["bytes"]),
                    len(pending),
                )
                consumed = 0
                while consumed + frame_len <= len(pcm):
                    frame = pcm[consumed : consumed + frame_len]
                    consumed += frame_len
                    is_speech = vad.is_speech(frame.tobytes(), SAMPLE_RATE)
                    ring.append(frame)
                    last_vad_ts = time.time()
                    if is_speech:
                        voiced = True
                        last_voice_ts = time.time()
                    if voiced and (time.time() - last_partial_ts) * 1000 >= PARTIAL_EVERY_MS:
                        last_partial_ts = time.time()
                        need = int((SAMPLE_RATE * CHUNK_MS) / 1000)
                        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
                        audio_tail = flat[-need * 2 :] if flat.size > need * 2 else flat
                        log.info("Trigger partial (%d samples)", audio_tail.size)
                        await transcribe_block(audio_tail, final=False)
                    if voiced and (time.time() - last_voice_ts) * 1000 >= SIL_MS_END:
                        voiced = False
                        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
                        log.info("Silence detected, sending final (%d samples)", flat.size)
                        await transcribe_block(flat, final=True)
                        ring.clear()
                pending = pcm[consumed:].tobytes()
            else:
                log.warning("Non-bytes message received from client: %s", msg.get("type"))
    except WebSocketDisconnect:
        log.info("WebSocket disconnected, flushing buffer")
        flat = np.frombuffer(b"".join(ring), dtype=np.int16)
        if flat.size > 0:
            await transcribe_block(flat, final=True)
        return
    finally:
        monitor_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await monitor_task
