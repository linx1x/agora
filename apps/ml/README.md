# apps/ml: Clef-flash for the characters

The characters (Phase 15, ADR-042, ADR-044) make every choice with a known set of answers
through `decide()`: what to do next, whether to approach someone, whether that person is busy.
This service runs Clef-flash on the PC's GPU and answers those questions. It is the P15.1
spike's `clef_server.py` grown up.

Without it, the characters decide with their own scoring (`packages/shared/src/npc-mind.ts`).
They never send these decisions to the cloud model.

## Run it (WSL2, Ubuntu)

```bash
cd "/mnt/c/Users/vince/Desktop/+/agora-plan/apps/ml"
bash setup-wsl.sh --fast     # once; reuses ~/clef-venv from the spike if it is there
bash run.sh                  # Clef on http://127.0.0.1:8790, about 30 s to load
```

Then in Agora's `.env` (Windows side), restart `pnpm dev`:

```
NPC_DECIDE_URL=http://127.0.0.1:8790
```

The server log says `Clef reachable: characters ask it` or `Clef not reachable at start`.
In the brain view (people list → Characters → a character), each decision shows **Clef** or
**Score** with Clef's confidence.

`bash run.sh --fake` answers at random without a GPU, to try the plumbing.

## Windows cannot reach it ("fetch failed")

WSL2 usually forwards `127.0.0.1` to Windows, but not always (the spike hit this). Check from
PowerShell: `curl.exe http://127.0.0.1:8790/health`. If it fails, either:

1. Mirrored networking: in `%UserProfile%\.wslconfig` put `[wsl2]` then `networkingMode=mirrored`,
   run `wsl --shutdown`, start again. Nothing else changes.
2. Or listen on the WSL address with a token (needed beyond localhost):
   `ML_TOKEN=<long random> bash run.sh --host 0.0.0.0`, then in `.env`
   `NPC_DECIDE_URL=http://<address from: wsl hostname -I>:8790` and `NPC_DECIDE_TOKEN=<same>`.

## API

- `POST /decide` `{state, questions}` → `{answers: {id: {probs: {option: p}}}, ms}`.
  Question types: `noul` (yes/no), `choice` (`criteria: {id: text}`), `score` (`criteria: [levels]`).
  At most 16 questions, 16 options each, 64 KB.
- `GET /health` → `{ok, model, quant, decisions, errors, uptime_s}`.
- `ML_TOKEN` set → both need `Authorization: Bearer <token>`. It refuses to listen beyond
  localhost without one.

Request bodies are never logged (they hold first names of people near a character).
One decision at a time (one GPU). Chatterbox voices (P15.6) will join this service.

## Tests

```bash
cd apps/ml && python3 -m unittest discover -s tests
```

They use the fake model, so they need neither a GPU nor torch.


## Character voices (P15.6)

`POST /speak {"text", "lang": "fr"|"en"}` returns a short Ogg Opus clip (`audio/ogg`, header
`x-duration-ms`). The Agora server asks for it only for replies a person was meant to hear, with
`NPC_VOICE_URL`. Everything stays on your machine: the reply text never goes to a cloud service.

```bash
sudo apt install -y ffmpeg                 # Opus clips
pip install -r requirements-voice.txt      # Chatterbox Multilingual (in ~/clef-venv)
bash run.sh --voice chatterbox             # CPU by default; --voice-device cuda for the GPU
bash run.sh --fake --voice fake            # beeps, no model: to try the plumbing
```

Chatterbox marks every clip with an inaudible watermark (Resemble AI's Perth) so it can be told
from a human voice, and Agora never passes a reference recording, so no real person's voice is ever
imitated. A cloned voice would need that person's written consent first (docs/ASSETS.md).
