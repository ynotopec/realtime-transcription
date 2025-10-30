"""Compatibility wrapper around the upstream :mod:`webrtcvad` package.

The official package still relies on :mod:`pkg_resources` which triggers a
``UserWarning`` on import with modern versions of ``setuptools``.  Importing
this module instead mirrors the minimal public surface that the server uses
while avoiding that deprecated dependency.
"""
from __future__ import annotations

from importlib import metadata

import _webrtcvad

__author__ = "John Wiseman jjwiseman@gmail.com"
__copyright__ = "Copyright (C) 2016 John Wiseman"
__license__ = "MIT"

try:
    __version__ = metadata.version("webrtcvad")
except metadata.PackageNotFoundError:  # pragma: no cover - defensive fallback
    __version__ = "0.0.0"


class Vad:
    """Drop-in replacement for :class:`webrtcvad.Vad`."""

    def __init__(self, mode: int | None = None):
        self._vad = _webrtcvad.create()
        _webrtcvad.init(self._vad)
        if mode is not None:
            self.set_mode(mode)

    def set_mode(self, mode: int) -> None:
        _webrtcvad.set_mode(self._vad, mode)

    def is_speech(self, buf: bytes, sample_rate: int, length: int | None = None) -> bool:
        length = length or int(len(buf) / 2)
        if length * 2 > len(buf):
            raise IndexError(
                "buffer has %s frames, but length argument was %s"
                % (int(len(buf) / 2.0), length)
            )
        return _webrtcvad.process(self._vad, sample_rate, buf, length)


def valid_rate_and_frame_length(rate: int, frame_length: int) -> bool:
    return _webrtcvad.valid_rate_and_frame_length(rate, frame_length)
