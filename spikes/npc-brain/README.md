# Spike P15.1: the NPC brain (ADR-042)

Time-boxed spike for Phase 15. It changes no app code. It answers three questions before the
NPCs are built:

1. **DeepSeek (`deepseek-flash`) for words:** how long a reply takes from your PC, how often the
   `{say}` JSON comes back right, and what a call costs.
2. **Clef-flash for choices:** does it sort French Talk messages well enough, how fast is it, and
   does the 4-bit build fit on the RTX 3080 (8 GB) next to Windows?
3. **The fallback:** how well DeepSeek sorts the same messages when Clef is off.

"Clef decides, the LLM writes": `decide()` for every choice with a known set of answers,
`complete()` only for words no prepared line covers.

| File | What it is |
| --- | --- |
| `src/gateway.ts` | `createGateway()`: `complete()` and `decide()`, settings from `NPC_*` in `.env` |
| `src/llm.ts` | `complete()` adapters: OpenAI-compatible (DeepSeek, Mistral, Ollama…) and Anthropic; the `{say}` check |
| `src/decide.ts` | `decide()`: local Clef over HTTP, the LLM-JSON fallback, `pick()` with the safe default under `NPC_DECIDE_MIN_P` |
| `src/cost.ts` | DeepSeek prices (peak and off-peak) |
| `src/*.test.ts` | Unit tests with a fake `fetch` |
| `deepseek-test.ts` | 20 conversations (10 FR, 10 EN, 3 turns) → `results/deepseek-*.md` |
| `sort-test.ts` | The 240 labelled messages through `decide()`, via Clef or the LLM → `results/sort-*.md` |
| `clef/` | Python, for WSL2: `setup-wsl.sh`, `clef_bench.py` (accuracy, speed, VRAM), `clef_server.py` (HTTP for `decide()`) |
| `data/` | Personas, conversations, Clef questions, 200 French + 40 English labelled messages |

## 1. DeepSeek test (Windows, about 2 minutes, under US$0.05)

Your `.env` already has `NPC_LLM_API_KEY`. Nothing else is needed: the defaults are DeepSeek,
`deepseek-flash`, thinking off, 8 s timeout. In PowerShell at the repo root:

```powershell
pnpm tsx spikes/npc-brain/deepseek-test.ts --limit 1   # one conversation first
pnpm tsx spikes/npc-brain/deepseek-test.ts             # all 20 (60 calls)
pnpm tsx spikes/npc-brain/sort-test.ts --via llm       # the fallback: 240 sort calls
```

Optional: `--thinking on` on the first script to see what DeepSeek's default thinking mode costs in time.

## 2. Clef-flash benchmark (WSL2, about 30 minutes the first time)

Needs about 25 GB free in WSL2 and the NVIDIA Windows driver (it provides the GPU to WSL2).
Close games and apps that use the GPU. In an Ubuntu (WSL2) terminal:

```bash
cd "/mnt/c/Users/vince/Desktop/+/agora-plan/spikes/npc-brain/clef"
bash setup-wsl.sh --fast            # venv in ~/clef-venv: torch (CUDA), transformers, bitsandbytes
source ~/clef-venv/bin/activate
python clef_bench.py --limit 20     # first run downloads the model (~19 GB) and checks it fits
python clef_bench.py                # full run: 240 messages, timing, VRAM
```

If it runs out of GPU memory, write that down: it is a result (decisions would use the fallback).
`--fake` runs the script without a GPU, to check the plumbing.

Then, to try the gateway's `decide()` against the real model from Windows:

```bash
python clef_server.py               # in WSL2, listens on 127.0.0.1:8790
```

```powershell
pnpm tsx spikes/npc-brain/sort-test.ts --via clef --limit 40   # in PowerShell
```

## 3. Send back

The `.md` files in `spikes/npc-brain/results/` (the `.json` files have every row if needed).
Before trusting the accuracy numbers, skim `data/talk-messages.json`: the labels are mine, and a
label you disagree with is worth fixing first.

## Settings (`.env`)

| Variable | Default | |
| --- | --- | --- |
| `NPC_LLM_API_KEY` | — | DeepSeek key (never committed) |
| `NPC_LLM_PROVIDER` | `openai` | `openai` (OpenAI-compatible) or `anthropic` |
| `NPC_LLM_BASE_URL` | `https://api.deepseek.com` | |
| `NPC_LLM_MODEL` | `deepseek-flash` | |
| `NPC_LLM_THINKING` | `off` on deepseek.com, else not sent | `on` / `off` |
| `NPC_LLM_TIMEOUT_MS` | `8000` | |
| `NPC_LLM_PRICE` | known for DeepSeek | `hit,miss,out` US$ per 1M tokens, for other models |
| `NPC_LLM_EXTRA_BODY` | — | JSON merged into each request |
| `NPC_DECIDE_PROVIDER` | `clef` | `clef` (with the LLM as fallback) or `llm` |
| `NPC_DECIDE_URL` | — | e.g. `http://127.0.0.1:8790` |
| `NPC_DECIDE_MIN_P` | `0.7` | below this, the safe default applies |

## Tests

```powershell
pnpm vitest run --config spikes/npc-brain/vitest.config.ts
pnpm exec tsc -p spikes/npc-brain/tsconfig.json
```

## Findings while writing it

- Clef's decision head is custom PyTorch code in the model repo (`joint_schema_model.py`).
  vLLM and SGLang serve only the backbone as a chat model, so the service uses transformers with
  bitsandbytes 4-bit, not vLLM.
- From the model's `config.json`: 6.9 B parameters in linear layers (~3.9 GB in 4 bits), plus two
  248,320 × 4,096 tables (input embeddings and `lm_head`, ~2 GB each in bf16) and a 0.46 B
  vision tower. All on the GPU is ~8.2 GB, which does not fit. The benchmark keeps the input
  embeddings in RAM (only the looked-up rows go to the GPU) and the vision tower on the CPU:
  ~6.5 GB expected. `lm_head` must stay on the GPU because the head reads its weight.
- The backbone mixes linear-attention and full-attention layers. Without `flash-linear-attention`
  transformers falls back to plain torch for them (slower); `setup-wsl.sh --fast` installs it.
- `deepseek-flash` thinks by default. The gateway turns thinking off for NPC lines.
