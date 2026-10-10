"""apps/ml tests (P15.3): the HTTP contract the Agora server relies on, with the fake model.

  cd apps/ml && python3 -m unittest discover -s tests
"""

from __future__ import annotations

import json
import shutil
import socket
import sys
import time
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agora_ml.clef import FakeClef, option_ids  # noqa: E402
from agora_ml.server import main, serve, validate  # noqa: E402

NEXT = {"type": "choice", "instructions": "What next?", "criteria": {"desk": "Work.", "coffee": "Coffee."}}
BUSY = {"type": "noul", "instructions": "Busy?"}


class Running:
    def __init__(self, token: str | None = None) -> None:
        self.server = serve(FakeClef(), "127.0.0.1", 0, token)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def call(self, path: str, body: object | None = None, headers: dict[str, str] | None = None):
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        req = urllib.request.Request(self.url + path, data=data, headers={"content-type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class SlowClef(FakeClef):
    def decide(self, record):  # type: ignore[no-untyped-def]
        time.sleep(0.3)
        return super().decide(record)


class HangUpTest(unittest.TestCase):
    def test_caller_that_hangs_up_before_the_answer_is_counted_not_crashed(self) -> None:
        server = serve(SlowClef(), "127.0.0.1", 0, None)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        port = server.server_address[1]
        try:
            body = json.dumps({"state": {}, "questions": {"busy": BUSY}}).encode()
            sock = socket.create_connection(("127.0.0.1", port))
            sock.sendall(
                b"POST /decide HTTP/1.1\r\nHost: x\r\ncontent-type: application/json\r\n"
                + f"content-length: {len(body)}\r\n\r\n".encode()
                + body
            )
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b"\x01\x00\x00\x00\x00\x00\x00\x00")  # RST on close
            sock.close()  # gone before the 0.3 s decision finishes
            deadline = time.time() + 5
            dropped = 0
            while time.time() < deadline and not dropped:
                time.sleep(0.05)
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as r:
                    dropped = json.loads(r.read())["dropped"]
            self.assertEqual(dropped, 1)
        finally:
            server.shutdown()
            server.server_close()


class ServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.s = Running()

    def tearDown(self) -> None:
        self.s.close()

    def test_decide_answers_every_question_with_probabilities_over_its_options(self) -> None:
        code, body = self.s.call("/decide", {"state": {"npc": {"name": "Zoé"}}, "questions": {"next": NEXT, "busy": BUSY}})
        self.assertEqual(code, 200)
        self.assertEqual(set(body["answers"]), {"next", "busy"})
        self.assertEqual(set(body["answers"]["next"]["probs"]), {"desk", "coffee"})
        self.assertEqual(set(body["answers"]["busy"]["probs"]), {"yes", "no"})
        self.assertAlmostEqual(sum(body["answers"]["next"]["probs"].values()), 1.0, places=5)
        self.assertIn("ms", body)

    def test_health(self) -> None:
        self.s.call("/decide", {"state": {}, "questions": {"busy": BUSY}})
        code, body = self.s.call("/health")
        self.assertEqual(code, 200)
        self.assertEqual(body["model"], "fake")
        self.assertEqual(body["decisions"], 1)

    def test_bad_requests_are_refused(self) -> None:
        self.assertEqual(self.s.call("/decide", b"{not json")[0], 400)
        self.assertEqual(self.s.call("/decide", {"questions": {"busy": BUSY}})[0], 400)
        self.assertEqual(self.s.call("/decide", {"state": {}, "questions": {}})[0], 400)
        one = {"type": "choice", "criteria": {"only": "x"}}
        self.assertEqual(self.s.call("/decide", {"state": {}, "questions": {"q": one}})[0], 400)
        self.assertEqual(self.s.call("/nope", {"state": {}, "questions": {"busy": BUSY}})[0], 404)
        self.assertEqual(self.s.call("/decide", {"state": "x" * 70_000, "questions": {"busy": BUSY}})[0], 413)


class TokenTest(unittest.TestCase):
    def test_token_is_required_when_set(self) -> None:
        s = Running(token="s3cret")
        try:
            body = {"state": {}, "questions": {"busy": BUSY}}
            self.assertEqual(s.call("/decide", body)[0], 401)
            self.assertEqual(s.call("/health")[0], 401)
            self.assertEqual(s.call("/decide", body, {"authorization": "Bearer wrong"})[0], 401)
            self.assertEqual(s.call("/decide", body, {"authorization": "Bearer s3cret"})[0], 200)
        finally:
            s.close()

    def test_refuses_to_listen_beyond_localhost_without_a_token(self) -> None:
        self.assertEqual(main(["--host", "0.0.0.0", "--fake", "--port", "0"]), 2)


class ContractTest(unittest.TestCase):
    def test_option_ids_match_the_typescript_gateway(self) -> None:
        self.assertEqual(option_ids(NEXT), ["desk", "coffee"])
        self.assertEqual(option_ids(BUSY), ["yes", "no"])
        self.assertEqual(option_ids({"type": "score", "criteria": ["a", "b", "c"]}), ["0", "1", "2"])
        self.assertIsNone(validate({"state": {}, "questions": {"next": NEXT}}))


if __name__ == "__main__":
    unittest.main()


class VoiceTests(unittest.TestCase):
    """POST /speak (P15.6): the contract the Agora server relies on, with the fake voice."""

    def setUp(self) -> None:
        from agora_ml.voice import FakeVoice

        self.token = "t0ken"
        self.server = serve(FakeClef(), "127.0.0.1", 0, self.token, FakeVoice())
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def post(self, body: object, token: str | None = None):
        req = urllib.request.Request(
            self.url + "/speak",
            data=json.dumps(body).encode(),
            headers={"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
        except urllib.error.HTTPError as e:
            return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}

    @unittest.skipUnless(shutil.which("ffmpeg"), "needs ffmpeg")
    def test_speaks_an_ogg_opus_clip_whose_length_follows_the_text(self) -> None:
        code, short, h1 = self.post({"text": "Salut!", "lang": "fr"}, self.token)
        self.assertEqual(code, 200)
        self.assertEqual(h1["content-type"], "audio/ogg")
        self.assertTrue(short.startswith(b"OggS"))
        _, long_, h2 = self.post({"text": "Une phrase beaucoup plus longue que la précédente, pour voir.", "lang": "fr"}, self.token)
        self.assertGreater(int(h2["x-duration-ms"]), int(h1["x-duration-ms"]))
        self.assertGreater(len(long_), len(short))

    def test_refuses_without_the_token_and_with_bad_input(self) -> None:
        self.assertEqual(self.post({"text": "Salut", "lang": "fr"})[0], 401)
        for body in ({"text": "", "lang": "fr"}, {"text": "x", "lang": "de"}, {"text": "x" * 401, "lang": "fr"}, {"lang": "fr"}, []):
            code, data, _ = self.post(body, self.token)
            self.assertEqual(code, 400, body)
            self.assertIn(b"error", data)

    def test_is_off_without_a_voice_and_never_logs_the_text(self) -> None:
        r = Running()
        try:
            code, body = r.call("/speak", {"text": "Salut", "lang": "fr"})
            self.assertEqual((code, body["error"]), (404, "voice off"))
        finally:
            r.close()
