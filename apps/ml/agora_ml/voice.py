"""Character voices for Agora (P15.6, ADR-048): text in, a short Opus clip out.

Chatterbox Multilingual (Resemble AI, MIT) runs here, on the operator's own machine, so no reply
text leaves it. Every clip it writes carries Resemble's inaudible Perth watermark (it cannot be
turned off), which marks the voice as synthetic. There is no voice cloning: no reference recording
is ever passed, so a real person's voice is never imitated (a cloned voice would need that person's
written consent and a registry row, see docs/ASSETS.md).

  FakeVoice        a few sine beeps of a length that follows the text (development, tests)
  ChatterboxVoice  the real model, loaded on first use (`--voice chatterbox`)

`to_opus` wraps raw 16-bit mono audio into an Ogg Opus clip with ffmpeg.
"""

from __future__ import annotations

import math
import shutil
import struct
import subprocess
from typing import Protocol

MAX_TEXT = 400
LANGS = ("fr", "en")
# Opus at 24 kbit/s is plenty for speech: about 3 KB per second of voice.
OPUS_BITRATE = "24k"
MAX_CLIP_SECONDS = 30


class VoiceError(Exception):
    """The voice could not make a clip (the caller shows the text without sound)."""


class Voice(Protocol):
    name: str

    def synthesize(self, text: str, lang: str) -> tuple[bytes, int]:
        """Raw signed 16-bit little-endian mono PCM and its sample rate."""


class FakeVoice:
    name = "fake"
    SR = 16000

    def synthesize(self, text: str, lang: str) -> tuple[bytes, int]:
        # about 14 characters a second, a beep per word: recognisably "speech-like" in length
        seconds = max(0.4, min(MAX_CLIP_SECONDS, len(text) / 14))
        n = int(self.SR * seconds)
        out = bytearray()
        for i in range(n):
            t = i / self.SR
            word = int(t * 3.5)
            f = 220 + 40 * (word % 5) + (30 if lang == "en" else 0)
            env = 0.5 * (1 - math.cos(2 * math.pi * ((t * 3.5) % 1.0))) / 2
            out += struct.pack("<h", int(12000 * env * math.sin(2 * math.pi * f * t)))
        return bytes(out), self.SR


class ChatterboxVoice:
    """Chatterbox Multilingual with its built-in voice (no reference audio, so nobody is cloned)."""

    name = "chatterbox-multilingual"

    def __init__(self, device: str = "cpu") -> None:
        import torch  # noqa: PLC0415  (heavy; only when this voice is chosen)
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # noqa: PLC0415

        self._torch = torch
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=torch.device(device))
        self.SR = int(self.model.sr)

    def synthesize(self, text: str, lang: str) -> tuple[bytes, int]:
        wav = self.model.generate(text, language_id=lang)  # (1, N) float tensor on the CPU, watermarked
        pcm = (wav.squeeze(0).clamp(-1, 1) * 32767).to(self._torch.int16).numpy().tobytes()
        return pcm, self.SR


def to_opus(pcm: bytes, sample_rate: int) -> bytes:
    """Ogg Opus from raw PCM; needs ffmpeg with libopus."""
    if len(pcm) > sample_rate * 2 * MAX_CLIP_SECONDS:
        raise VoiceError("clip too long")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise VoiceError("ffmpeg not found")
    p = subprocess.run(
        [ffmpeg, "-v", "error", "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
         "-c:a", "libopus", "-b:a", OPUS_BITRATE, "-application", "voip", "-f", "ogg", "pipe:1"],
        input=pcm, capture_output=True, timeout=30, check=False,
    )
    if p.returncode != 0 or not p.stdout:
        raise VoiceError("ffmpeg failed")
    return p.stdout


def clean_text(text: object, lang: object) -> tuple[str, str] | str:
    """The checked text and language, or a message saying what is wrong."""
    if not isinstance(text, str) or not text.strip():
        return "text must be a non-empty string"
    if len(text) > MAX_TEXT:
        return f"text is limited to {MAX_TEXT} characters"
    if lang not in LANGS:
        return "lang must be fr or en"
    return " ".join(text.split()), str(lang)
