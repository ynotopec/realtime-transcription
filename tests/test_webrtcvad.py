from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = PROJECT_ROOT / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

pytest.importorskip("_webrtcvad")

import webrtcvad


SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME_LENGTH = int(SAMPLE_RATE * FRAME_MS / 1000)


def test_valid_rate_and_frame_length_accepts_known_frame_size() -> None:
    assert webrtcvad.valid_rate_and_frame_length(SAMPLE_RATE, FRAME_LENGTH)


def test_valid_rate_and_frame_length_rejects_unknown_frame_size() -> None:
    assert not webrtcvad.valid_rate_and_frame_length(SAMPLE_RATE, FRAME_LENGTH + 1)


def test_is_speech_reports_silence_as_non_speech() -> None:
    vad = webrtcvad.Vad(2)
    silence = np.zeros(FRAME_LENGTH, dtype=np.int16).tobytes()
    assert vad.is_speech(silence, SAMPLE_RATE) is False


def test_is_speech_raises_when_length_exceeds_buffer() -> None:
    vad = webrtcvad.Vad()
    short_frame = np.zeros(FRAME_LENGTH // 2, dtype=np.int16).tobytes()
    with pytest.raises(IndexError):
        vad.is_speech(short_frame, SAMPLE_RATE, length=FRAME_LENGTH)
