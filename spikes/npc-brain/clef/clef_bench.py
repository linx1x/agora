#!/usr/bin/env python3
"""P15.1 Clef-flash benchmark for Vincent's PC (RTX 3080 8 GB, WSL2).

Measures, with the model loaded in 4 bits:
  - French accuracy on 200 labelled Talk messages (+ 40 English as a control): message kind and
    personal information, both asked in one call like the server will;
  - how many answers clear NPC_DECIDE_MIN_P (0.5..0.9) and how accurate those are;
  - time per decision (sort call and a typical NPC "moment" with 3 questions), and a batch of 3;
  - VRAM: PyTorch peak and what nvidia-smi sees for the whole card (Windows desktop included).

Usage (inside WSL2, after ./setup-wsl.sh):
  source ~/clef-venv/bin/activate
  python clef_bench.py                 # full run, writes ../results/clef-<time>.json and .md
  python clef_bench.py --limit 20      # quick check
  python clef_bench.py --fake          # dry run without GPU or download (tests the script only)
"""

from __future__ import annotations

import argparse
import json
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from clef_common import HERE, MODEL_ID, Clef, FakeClef, load_json, top

SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9]


def nvidia_smi() -> dict[str, Any]:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip().splitlines()[0]
        name, total, used, driver = [x.strip() for x in out.split(",")]
        return {"gpu": name, "total_mb": int(total), "used_mb": int(used), "driver": driver}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


def pctl(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    i = min(len(s) - 1, max(0, int(-(-q * len(s) // 1)) - 1))
    return s[i]


def score(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Same metrics as src/metrics.ts scoreSort()."""
    ok = [r for r in rows if "error" not in r]
    kinds = sorted({r["kind"] for r in rows}, key=lambda k: [r["kind"] for r in rows].index(k))
    confusion: dict[str, dict[str, int]] = {}
    for r in ok:
        confusion.setdefault(r["kind"], {}).setdefault(r["pred_kind"], 0)
        confusion[r["kind"]][r["pred_kind"]] += 1
    per_kind = {}
    for k in kinds:
        lab = [r for r in ok if r["kind"] == k]
        pred = [r for r in ok if r["pred_kind"] == k]
        hit = sum(1 for r in lab if r["pred_kind"] == k)
        per_kind[k] = {
            "n": len(lab),
            "recall": hit / len(lab) if lab else float("nan"),
            "precision": hit / len(pred) if pred else float("nan"),
        }
    pos = [r for r in ok if r["pii"]]
    return {
        "n": len(rows),
        "errors": len(rows) - len(ok),
        "kind_accuracy": sum(r["pred_kind"] == r["kind"] for r in ok) / len(ok) if ok else float("nan"),
        "pii_accuracy": sum(r["pred_pii"] == r["pii"] for r in ok) / len(ok) if ok else float("nan"),
        "pii_recall": sum(r["pred_pii"] for r in pos) / len(pos) if pos else float("nan"),
        "sweep": [
            {
                "min_p": t,
                "coverage": sum(r["p_kind"] >= t for r in ok) / len(ok) if ok else float("nan"),
                "accuracy": (
                    sum(r["pred_kind"] == r["kind"] for r in ok if r["p_kind"] >= t) / sum(r["p_kind"] >= t for r in ok)
                    if any(r["p_kind"] >= t for r in ok)
                    else float("nan")
                ),
            }
            for t in SWEEP
        ],
        "per_kind": per_kind,
        "confusion": confusion,
        "ms": {
            "p50": pctl([r["ms"] for r in ok], 0.5),
            "p90": pctl([r["ms"] for r in ok], 0.9),
            "mean": statistics.fmean([r["ms"] for r in ok]) if ok else float("nan"),
        },
    }


def pc(x: float) -> str:
    return "n/a" if x != x else f"{100 * x:.1f} %"


def md_section(title: str, m: dict[str, Any]) -> list[str]:
    kinds = list(m["per_kind"].keys())
    lines = [
        f"## {title} ({m['n']} messages{', ' + str(m['errors']) + ' errors' if m['errors'] else ''})",
        "",
        f"Kind accuracy {pc(m['kind_accuracy'])} · personal information: accuracy {pc(m['pii_accuracy'])}, "
        f"caught {pc(m['pii_recall'])} · time p50 {m['ms']['p50']:.0f} ms, p90 {m['ms']['p90']:.0f} ms",
        "",
        "| Threshold | Answers used | Accuracy of those |",
        "| --- | --- | --- |",
        *[f"| {s['min_p']} | {pc(s['coverage'])} | {pc(s['accuracy'])} |" for s in m["sweep"]],
        "",
        "| Kind | n | Recall | Precision |",
        "| --- | --- | --- | --- |",
        *[f"| {k} | {v['n']} | {pc(v['recall'])} | {pc(v['precision'])} |" for k, v in m["per_kind"].items()],
        "",
        "Confusion (rows = label, columns = predicted):",
        "",
        "| | " + " | ".join(kinds) + " |",
        "| --- | " + " | ".join("---" for _ in kinds) + " |",
        *["| " + k + " | " + " | ".join(str(m["confusion"].get(k, {}).get(p, 0)) for p in kinds) + " |" for k in kinds],
        "",
    ]
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=MODEL_ID, help="Hugging Face id or local folder")
    ap.add_argument("--quant", default="4bit", choices=["4bit", "8bit", "bf16"])
    ap.add_argument("--embed-on-gpu", action="store_true", help="keep the 2 GB input embedding table on the GPU")
    ap.add_argument("--vision-on-gpu", action="store_true", help="keep the unused vision tower on the GPU")
    ap.add_argument("--lang", default="all", choices=["fr", "en", "all"])
    ap.add_argument("--limit", type=int, default=0, help="only the first N messages")
    ap.add_argument("--moment-runs", type=int, default=50)
    ap.add_argument("--fake", action="store_true", help="dry run with random answers, no GPU")
    ap.add_argument("--out", default=str(HERE.parent / "results"))
    a = ap.parse_args()

    questions = load_json("questions.json")
    messages = load_json("talk-messages.json")["messages"]
    if a.lang != "all":
        messages = [m for m in messages if m["lang"] == a.lang]
    if a.limit:
        messages = messages[: a.limit]

    smi_before = nvidia_smi()
    print(f"GPU before loading: {smi_before}")

    torch = None
    if a.fake:
        clef: Any = FakeClef()
    else:
        import torch  # noqa: F811

        if not torch.cuda.is_available():
            print("CUDA is not available in this Python. Check `nvidia-smi` in WSL2 and the torch install (setup-wsl.sh).")
            return 2
        print(f"Loading {a.model} ({a.quant}); the first run downloads about 19 GB…", flush=True)
        try:
            clef = Clef(a.model, quant=a.quant, embed_on_cpu=not a.embed_on_gpu, vision_on_cpu=not a.vision_on_gpu)
        except torch.cuda.OutOfMemoryError:
            print(
                "\nOut of GPU memory while loading. Close games, browsers with video and other GPU apps, "
                f"then retry. nvidia-smi now: {nvidia_smi()}. Write this down for ADR-042: it means "
                "Clef-flash does not fit next to your desktop, and decisions would use the LLM fallback."
            )
            return 3
        torch.cuda.reset_peak_memory_stats()
    info = clef.info
    print(f"Loaded in {info.seconds:.0f} s · placement {info.placement} · parameters (GB) {info.params_gb}")
    smi_loaded = nvidia_smi()
    alloc_loaded = torch.cuda.memory_allocated() / 1e6 if torch else 0.0
    print(f"GPU after loading: {smi_loaded} · PyTorch allocated {alloc_loaded:.0f} MB")

    def record_for(text: str) -> dict[str, Any]:
        return {"state": {**questions["context"], "message": text}, "questions": questions["sort"]}

    # Warm-up (first calls compile kernels and fill caches).
    for m in messages[:3]:
        clef.decide(record_for(m["text"]))

    rows: list[dict[str, Any]] = []
    for m in messages:
        row: dict[str, Any] = {"id": m["id"], "lang": m["lang"], "kind": m["kind"], "pii": m["pii"]}
        try:
            t0 = time.perf_counter()
            ans = clef.decide(record_for(m["text"]))
            row["ms"] = (time.perf_counter() - t0) * 1000
            row["pred_kind"], row["p_kind"] = top(ans["kind"])
            pii_top, row["p_pii"] = top(ans["pii"])
            row["pred_pii"] = pii_top == "yes"
            row["probs_kind"] = {k: round(v, 4) for k, v in ans["kind"].items()}
        except Exception as e:  # noqa: BLE001
            row["error"] = f"{type(e).__name__}: {e}"
        rows.append(row)
        mark = row.get("error") or f"{'ok ' if row['pred_kind'] == m['kind'] else 'BAD'} {row['pred_kind']} {row['p_kind']:.2f}"
        print(f"{m['id']} {row.get('ms', 0):6.0f} ms {m['kind']:<14} {mark:<34} {m['text'][:60]}", flush=True)

    # A typical NPC moment: next activity, approach, busy in one call.
    moment = {"state": questions["moment"]["state"], "questions": questions["moment"]["questions"]}
    moment_ms = []
    moment_answer = None
    for _ in range(a.moment_runs):
        t0 = time.perf_counter()
        moment_answer = clef.decide(moment)
        moment_ms.append((time.perf_counter() - t0) * 1000)

    # Three NPCs deciding at the same tick, one after the other (what the server will do first).
    three_ms = []
    for _ in range(10):
        t0 = time.perf_counter()
        for _n in range(3):
            clef.decide(moment)
        three_ms.append((time.perf_counter() - t0) * 1000)

    peak_mb = torch.cuda.max_memory_allocated() / 1e6 if torch else 0.0
    smi_after = nvidia_smi()

    by_lang = {lang: score([r for r in rows if r["lang"] == lang]) for lang in sorted({r["lang"] for r in rows}, reverse=True)}
    now = datetime.now(timezone.utc)
    result = {
        "when": now.isoformat(),
        "model": a.model if not a.fake else "fake",
        "quant": info.quant,
        "placement": info.placement,
        "params_gb": info.params_gb,
        "versions": {**info.versions, "python": platform.python_version()},
        "load_seconds": info.seconds,
        "gpu": {
            "before": smi_before,
            "loaded": smi_loaded,
            "after": smi_after,
            "torch_alloc_loaded_mb": alloc_loaded,
            "torch_peak_mb": peak_mb,
        },
        "moment": {"p50": pctl(moment_ms, 0.5), "p90": pctl(moment_ms, 0.9), "answer": moment_answer},
        "three_npcs_ms": {"p50": pctl(three_ms, 0.5), "p90": pctl(three_ms, 0.9)},
        "scores": by_lang,
        "rows": rows,
    }

    used = smi_after.get("used_mb", "?")
    total = smi_after.get("total_mb", "?")
    sort_ms = score(rows)["ms"]
    md = [
        f"# Clef-flash benchmark — {now.isoformat(timespec='minutes')}",
        "",
        f"`{result['model']}` in {info.quant}, loaded in {info.seconds:.0f} s on {smi_after.get('gpu', '?')} "
        f"(driver {smi_after.get('driver', '?')}). Versions: {result['versions']}.",
        "",
        "| Measure | Value |",
        "| --- | --- |",
        f"| VRAM, whole card before loading | {smi_before.get('used_mb', '?')} MB of {smi_before.get('total_mb', '?')} MB |",
        f"| VRAM, whole card after the run | {used} MB of {total} MB |",
        f"| PyTorch peak / after loading | {peak_mb:.0f} MB / {alloc_loaded:.0f} MB |",
        f"| Placement | {info.placement} |",
        f"| Parameters (GB) | {info.params_gb} |",
        f"| Sort call (kind + personal info) p50 / p90 | {sort_ms['p50']:.0f} / {sort_ms['p90']:.0f} ms |",
        f"| NPC moment (3 questions) p50 / p90 | {result['moment']['p50']:.0f} / {result['moment']['p90']:.0f} ms |",
        f"| Three NPCs in a row p50 / p90 | {result['three_npcs_ms']['p50']:.0f} / {result['three_npcs_ms']['p90']:.0f} ms |",
        "",
        f"Moment answer (sanity check): `{json.dumps({k: top(v) for k, v in (moment_answer or {}).items()}, ensure_ascii=False)}`",
        "",
    ]
    for lang, m in by_lang.items():
        md += md_section("French" if lang == "fr" else "English (control)" if lang == "en" else lang, m)
    md += ["## Misses", ""]
    text_of = {m["id"]: m["text"] for m in messages}
    md += [
        f"- {r['id']} {r['kind']} → {r['pred_kind']} ({r['p_kind']:.2f}): {text_of[r['id']]}"
        for r in rows
        if "error" not in r and r["pred_kind"] != r["kind"]
    ]
    md.append("")

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    base = out / f"clef-{now.strftime('%Y%m%d-%H%M')}{'-fake' if a.fake else ''}"
    base.with_suffix(".json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    base.with_suffix(".md").write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md))
    print(f"Saved {base}.json and .md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
