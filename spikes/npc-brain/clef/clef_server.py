#!/usr/bin/env python3
"""P15.1: Clef-flash behind a tiny HTTP API, for the gateway's decide() (NPC_DECIDE_URL).
A spike stand-in for apps/ml (P15.3).

  POST /decide  {"state": ..., "questions": {...}}  ->  {"answers": {id: {"probs": {option: p}}}, "ms": 41.2}
  GET  /health  ->  {"ok": true, "model": "clef-flash", "quant": "4bit"}

Listens on 127.0.0.1 only; WSL2 forwards it to Windows, so `NPC_DECIDE_URL=http://127.0.0.1:8790`
works from the Windows side. One request at a time (one GPU).

  python clef_server.py            # real model
  python clef_server.py --fake     # random answers, for testing the gateway without a GPU
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from clef_common import MODEL_ID, Clef, FakeClef, option_ids

MAX_BODY = 64 * 1024
TYPES = {"noul", "choice", "score"}


def validate(body: Any) -> str | None:
    """Reject anything that is not a Jev-style request (the server's own zod schema in P15.3)."""
    if not isinstance(body, dict) or "state" not in body or not isinstance(body.get("questions"), dict):
        return "expected {state, questions}"
    if not body["questions"] or len(body["questions"]) > 16:
        return "1 to 16 questions"
    for qid, q in body["questions"].items():
        if not isinstance(q, dict) or q.get("type") not in TYPES:
            return f"question {qid}: type must be noul, choice or score"
        if q["type"] == "choice" and not (isinstance(q.get("criteria"), dict) and len(q["criteria"]) >= 2):
            return f"question {qid}: choice needs 2+ criteria"
        if q["type"] == "score" and not (isinstance(q.get("criteria"), list) and len(q["criteria"]) >= 2):
            return f"question {qid}: score needs a list of 2+ levels"
        if q["type"] == "noul" and not isinstance(q.get("instructions"), str):
            return f"question {qid}: noul needs instructions"
    return None


def make_handler(clef: Any, lock: threading.Lock) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, obj: Any) -> None:
            data = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(200, {"ok": True, "model": clef.name, "quant": clef.info.quant})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/decide":
                self._send(404, {"error": "not found"})
                return
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > MAX_BODY:
                self._send(413, {"error": f"body must be 1..{MAX_BODY} bytes"})
                return
            try:
                body = json.loads(self.rfile.read(length))
            except json.JSONDecodeError:
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
                self._send(500, {"error": f"{type(e).__name__}: {e}"})
                return
            ms = (time.perf_counter() - t0) * 1000
            answers = {}
            for qid, q in body["questions"].items():
                p = probs.get(qid, {})
                answers[qid] = {"probs": {o: float(p.get(o, 0.0)) for o in option_ids(q)}}
            self._send(200, {"answers": answers, "ms": round(ms, 1)})

        def log_message(self, fmt: str, *args: Any) -> None:
            # No request bodies in logs (Talk text is personal information).
            sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--quant", default="4bit", choices=["4bit", "8bit", "bf16"])
    ap.add_argument("--fake", action="store_true")
    a = ap.parse_args()
    clef: Any = FakeClef() if a.fake else Clef(a.model, quant=a.quant)
    server = ThreadingHTTPServer((a.host, a.port), make_handler(clef, threading.Lock()))
    print(f"Clef ({clef.name}, {clef.info.quant}) on http://{a.host}:{a.port}  (POST /decide, GET /health)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
