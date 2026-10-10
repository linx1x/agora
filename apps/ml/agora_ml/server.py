#!/usr/bin/env python3
"""apps/ml: Clef-flash behind a small HTTP API for Agora's characters (P15.3, ADR-042, ADR-044).

  POST /decide  {"state": {...}, "questions": {...}}
             -> {"answers": {id: {"probs": {option: p}}}, "ms": 41.2}
  GET  /health  -> {"ok": true, "model": "clef-flash", "quant": "4bit", "decisions": 1234}

The Agora server calls it with NPC_DECIDE_URL (default http://127.0.0.1:8790). It listens on
127.0.0.1 only unless --host says otherwise; beyond localhost set ML_TOKEN (and the same value
in NPC_DECIDE_TOKEN), so nobody else on the network can use the GPU. One decision at a time
(one GPU). Request bodies are never logged: they hold first names of people near a character.

  python -m agora_ml.server            # the real model (WSL2, GPU)
  python -m agora_ml.server --fake     # random answers, no GPU, for development and tests
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .clef import MODEL_ID, Clef, FakeClef, option_ids
from .voice import ChatterboxVoice, FakeVoice, VoiceError, clean_text, to_opus

MAX_BODY = 64 * 1024
MAX_QUESTIONS = 16
MAX_OPTIONS = 16
TYPES = {"noul", "choice", "score"}


def validate(body: Any) -> str | None:
    """Accept only a Jev-style request; the Agora server's own types build the same shape."""
    if not isinstance(body, dict) or "state" not in body or not isinstance(body.get("questions"), dict):
        return "expected {state, questions}"
    qs = body["questions"]
    if not qs or len(qs) > MAX_QUESTIONS:
        return f"1 to {MAX_QUESTIONS} questions"
    for qid, q in qs.items():
        if not isinstance(q, dict) or q.get("type") not in TYPES:
            return f"question {qid}: type must be noul, choice or score"
        if q["type"] == "choice":
            c = q.get("criteria")
            if not (isinstance(c, dict) and 2 <= len(c) <= MAX_OPTIONS and all(isinstance(v, str) for v in c.values())):
                return f"question {qid}: choice needs 2 to {MAX_OPTIONS} text criteria"
        if q["type"] == "score":
            c = q.get("criteria")
            if not (isinstance(c, list) and 2 <= len(c) <= MAX_OPTIONS):
                return f"question {qid}: score needs a list of 2 to {MAX_OPTIONS} levels"
        if q["type"] == "noul" and not isinstance(q.get("instructions"), str):
            return f"question {qid}: noul needs instructions"
    return None


class Stats:
    def __init__(self) -> None:
        self.decisions = 0
        self.speeches = 0
        self.errors = 0
        self.dropped = 0  # callers that hung up before the answer was written (their timeout hit first)
        self.started = time.time()


def make_handler(
    clef: Any, lock: threading.Lock, token: str | None, stats: Stats, voice: Any = None, voice_lock: threading.Lock | None = None
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "agora-ml"

        def _send(self, code: int, obj: Any) -> None:
            data = json.dumps(obj, ensure_ascii=False).encode()
            try:
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                # The caller gave up first (the Agora server aborts after NPC_DECIDE_TIMEOUT_MS and
                # falls back to its own choice). Nothing to answer to; not an error, but worth counting.
                stats.dropped += 1
                self.close_connection = True

        def _authorized(self) -> bool:
            if not token:
                return True
            got = self.headers.get("authorization") or ""
            return hmac.compare_digest(got.encode(), f"Bearer {token}".encode())

        def do_GET(self) -> None:  # noqa: N802
            if not self._authorized():
                self._send(401, {"error": "token required"})
            elif self.path == "/health":
                self._send(
                    200,
                    {
                        "ok": True,
                        "model": clef.name,
                        "quant": clef.info.quant,
                        "decisions": stats.decisions,
                        "voice": voice.name if voice else None,
                        "speeches": stats.speeches,
                        "errors": stats.errors,
                        "dropped": stats.dropped,
                        "uptime_s": round(time.time() - stats.started),
                    },
                )
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if not self._authorized():
                self._send(401, {"error": "token required"})
                return
            if self.path == "/speak":
                self._speak()
                return
            if self.path != "/decide":
                self._send(404, {"error": "not found"})
                return
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > MAX_BODY:
                self._send(413, {"error": f"body must be 1..{MAX_BODY} bytes"})
                return
            try:
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send(400, {"error": "invalid JSON"})
                return
            err = validate(body)
            if err:
                self._send(400, {"error": err})
                return
            record = {"state": body["state"], "questions": body["questions"]}
            t0 = time.perf_counter()
            try:
                with lock:
                    probs = clef.decide(record)
            except Exception as e:  # noqa: BLE001
                stats.errors += 1
                self._send(500, {"error": type(e).__name__})
                sys.stderr.write(f"decide failed: {type(e).__name__}: {e}\n")
                return
            stats.decisions += 1
            ms = (time.perf_counter() - t0) * 1000
            answers = {}
            for qid, q in body["questions"].items():
                p = probs.get(qid, {})
                answers[qid] = {"probs": {o: float(p.get(o, 0.0)) for o in option_ids(q)}}
            self._send(200, {"answers": answers, "ms": round(ms, 1)})

        def _speak(self) -> None:
            """POST /speak {"text", "lang"} -> an Ogg Opus clip (audio/ogg). Text is never logged."""
            if voice is None:
                self._send(404, {"error": "voice off"})
                return
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > 4096:
                self._send(413, {"error": "body must be 1..4096 bytes"})
                return
            try:
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send(400, {"error": "invalid JSON"})
                return
            checked = clean_text(body.get("text") if isinstance(body, dict) else None, body.get("lang") if isinstance(body, dict) else None)
            if isinstance(checked, str):
                self._send(400, {"error": checked})
                return
            text, lang = checked
            t0 = time.perf_counter()
            try:
                with voice_lock or threading.Lock():
                    pcm, sr = voice.synthesize(text, lang)
                clip = to_opus(pcm, sr)
            except VoiceError as e:
                stats.errors += 1
                self._send(500, {"error": str(e)})
                return
            except Exception as e:  # noqa: BLE001
                stats.errors += 1
                self._send(500, {"error": type(e).__name__})
                sys.stderr.write(f"speak failed: {type(e).__name__}\n")
                return
            stats.speeches += 1
            ms = round((time.perf_counter() - t0) * 1000)
            seconds_ms = round(len(pcm) / 2 / sr * 1000)
            try:
                self.send_response(200)
                self.send_header("content-type", "audio/ogg")
                self.send_header("content-length", str(len(clip)))
                self.send_header("x-duration-ms", str(seconds_ms))
                self.send_header("x-synthesis-ms", str(ms))
                self.end_headers()
                self.wfile.write(clip)
            except (BrokenPipeError, ConnectionResetError):
                stats.dropped += 1
                self.close_connection = True

        def log_message(self, fmt: str, *args: Any) -> None:
            # Method, path and status only: never a request body.
            sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    return Handler


def serve(clef: Any, host: str, port: int, token: str | None, voice: Any = None) -> ThreadingHTTPServer:
    """Build the server (not started), so tests can run it on a free port."""
    return ThreadingHTTPServer(
        (host, port), make_handler(clef, threading.Lock(), token, Stats(), voice, threading.Lock())
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default=os.environ.get("ML_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("ML_PORT", "8790")))
    ap.add_argument("--model", default=os.environ.get("ML_MODEL", MODEL_ID), help="model id or local folder")
    ap.add_argument("--quant", default="4bit", choices=["4bit", "8bit", "bf16"])
    ap.add_argument("--fake", action="store_true", help="random answers, no GPU")
    ap.add_argument(
        "--voice",
        default=os.environ.get("ML_VOICE", "off"),
        choices=["off", "fake", "chatterbox"],
        help="POST /speak: off, fake beeps (tests), or Chatterbox Multilingual (P15.6)",
    )
    ap.add_argument("--voice-device", default=os.environ.get("ML_VOICE_DEVICE", "cpu"), help="cpu or cuda")
    a = ap.parse_args(argv)
    token = os.environ.get("ML_TOKEN") or None
    if a.host not in ("127.0.0.1", "localhost", "::1") and not token:
        print(f"Refusing to listen on {a.host} without ML_TOKEN (anyone on the network could use it).", file=sys.stderr)
        return 2
    clef: Any = FakeClef() if a.fake else Clef(a.model, quant=a.quant)
    voice: Any = None
    if a.voice == "fake":
        voice = FakeVoice()
    elif a.voice == "chatterbox":
        voice = ChatterboxVoice(a.voice_device)
    server = serve(clef, a.host, a.port, token, voice)
    print(
        f"Clef ({clef.name}, {clef.info.quant}) on http://{a.host}:{a.port}  (POST /decide"
        f"{', POST /speak' if voice else ''}, GET /health)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
