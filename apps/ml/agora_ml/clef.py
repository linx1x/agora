"""Clef-flash for Agora's characters (P15.3, ADR-042, ADR-044): loading and one decide() call.

Promoted from the P15.1 spike (spikes/npc-brain/clef/clef_common.py), which measured it on
Vincent's RTX 3080 (10 GB): 6.0 GB in 4 bits, 187-245 ms per decision.

Clef-flash = Qwen3.5-9B backbone + a "joint schema head" that returns one probability per
option. The head is custom PyTorch code shipped in the model repo (joint_schema_model.py),
so vLLM/SGLang cannot serve it; it is loaded with transformers, the backbone in 4 bits
(bitsandbytes NF4):
- linear layers in 4 bits (~3.9 GB);
- lm_head on the GPU in bf16 (~2.0 GB): the joint head reads its weight directly;
- input embeddings (~2.0 GB) in RAM, only the looked-up rows go to the GPU;
- vision tower on the CPU: text-only requests never run it.
torch, transformers and bitsandbytes are imported only when the real model loads, so the
server and its tests run with --fake on any machine with plain Python 3.10+.
"""

from __future__ import annotations

import importlib
import json
import random
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

MODEL_ID = "Cloudflare/clef-flash"


def option_ids(question: dict[str, Any]) -> list[str]:
    """Same option ids as the TypeScript gateway (src/decide.ts optionsOf)."""
    t = question["type"]
    if t == "noul":
        return ["yes", "no"]
    if t == "choice":
        return list(question["criteria"].keys())
    return [str(i) for i in range(len(question["criteria"]))]


def norm_option(opt: Any) -> str:
    """Map Clef's option ids to ours: booleans and yes/no words -> 'yes'/'no', score indexes -> '0'.."""
    if isinstance(opt, bool):
        return "yes" if opt else "no"
    if isinstance(opt, int):
        return str(opt)
    s = str(opt).strip()
    low = s.lower()
    if low in ("true", "yes", "oui"):
        return "yes"
    if low in ("false", "no", "non"):
        return "no"
    return s


@dataclass
class LoadInfo:
    quant: str
    seconds: float
    placement: dict[str, str] = field(default_factory=dict)
    params_gb: dict[str, float] = field(default_factory=dict)
    versions: dict[str, str] = field(default_factory=dict)


class FakeClef:
    """Deterministic stand-in for dry runs without a GPU or the 19 GB download (--fake)."""

    name = "fake"

    def __init__(self, seed: int = 1) -> None:
        self.rng = random.Random(seed)
        self.info = LoadInfo(quant="fake", seconds=0.0)

    def decide(self, record: dict[str, Any]) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = {}
        state = record.get("state")
        message = state.get("message", "") if isinstance(state, dict) else ""
        for qid, q in record["questions"].items():
            opts = option_ids(q)
            weights = [self.rng.random() for _ in opts]
            # A little signal so the report has something to show: greetings look like greetings.
            if qid == "kind" and "greeting" in opts and message.lower().startswith(("salut", "bonjour", "allo", "hi", "hello")):
                weights[opts.index("greeting")] += 3
            total = sum(weights)
            out[qid] = {o: w / total for o, w in zip(opts, weights, strict=True)}
        time.sleep(0.001)
        return out


class Clef:
    """The real model. decide(record) -> {question_id: {option_id: probability}}."""

    name = "clef-flash"

    def __init__(
        self,
        model_path: str = MODEL_ID,
        quant: str = "4bit",
        embed_on_cpu: bool = True,
        vision_on_cpu: bool = True,
        max_state_tokens: int | None = None,
    ) -> None:
        import torch
        import transformers
        from huggingface_hub import snapshot_download
        from safetensors.torch import load_file

        t0 = time.perf_counter()
        path = Path(model_path)
        if not path.is_dir():
            path = Path(snapshot_download(model_path))
        # The model repo ships its own code: import it from the snapshot.
        sys.path.insert(0, str(path))
        jsm = importlib.import_module("joint_schema_model")
        self.jsm = jsm
        self.torch = torch
        self.device = torch.device("cuda")
        self.max_state_tokens = max_state_tokens

        from transformers import AutoConfig, AutoProcessor, Qwen3_5ForConditionalGeneration

        kwargs: dict[str, Any] = {"dtype": torch.bfloat16}
        if quant in ("4bit", "8bit"):
            from transformers import BitsAndBytesConfig

            skip = ["lm_head"]  # the joint head reads lm_head.weight as a plain tensor
            if quant == "4bit":
                kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_compute_dtype=torch.bfloat16,
                    bnb_4bit_use_double_quant=True,
                    llm_int8_skip_modules=skip + (["visual"] if vision_on_cpu else []),
                    llm_int8_enable_fp32_cpu_offload=embed_on_cpu or vision_on_cpu,
                )
            else:
                kwargs["quantization_config"] = BitsAndBytesConfig(
                    load_in_8bit=True,
                    llm_int8_skip_modules=skip + (["visual"] if vision_on_cpu else []),
                    llm_int8_enable_fp32_cpu_offload=embed_on_cpu or vision_on_cpu,
                )
        elif quant != "bf16":
            raise ValueError(f"unknown quant {quant!r}: 4bit, 8bit or bf16")

        device_map = self._device_map(path, AutoConfig, Qwen3_5ForConditionalGeneration, embed_on_cpu, vision_on_cpu)
        backbone = Qwen3_5ForConditionalGeneration.from_pretrained(path, device_map=device_map, **kwargs)
        backbone.config.use_cache = False
        if embed_on_cpu:
            pin_embeddings_on_cpu(backbone, self.device, torch.bfloat16)
        head_config = json.loads((path / "joint_head_config.json").read_text())
        head = jsm.JointSchemaHead(**head_config)
        head.load_state_dict(load_file(path / "joint_head.safetensors"), strict=True)
        head = head.to(device=self.device, dtype=torch.bfloat16)
        self.processor = AutoProcessor.from_pretrained(path)
        self.model = jsm.ClefModel(backbone, head).eval()
        self.pad_id = self.processor.tokenizer.pad_token_id
        if self.pad_id is None:
            self.pad_id = self.processor.tokenizer.eos_token_id
        try:
            import fla  # noqa: F401  (flash-linear-attention: fast kernels for the linear-attention layers)

            fast = "flash-linear-attention " + getattr(fla, "__version__", "?")
        except ImportError:
            fast = "none (torch fallback for linear attention)"

        lm_head = backbone.get_output_embeddings().weight
        if lm_head.device.type != "cuda":
            raise RuntimeError("lm_head is not on the GPU; the joint head needs it there")

        import bitsandbytes  # noqa: F401  (only to report the version)

        self.info = LoadInfo(
            quant=quant,
            seconds=time.perf_counter() - t0,
            placement={k: str(v) for k, v in device_map.items()},
            params_gb=self._param_sizes(backbone, head),
            versions={
                "torch": torch.__version__,
                "transformers": transformers.__version__,
                "bitsandbytes": getattr(sys.modules.get("bitsandbytes"), "__version__", "?"),
                "cuda": str(torch.version.cuda),
                "fast_kernels": fast,
            },
        )

    @staticmethod
    def _device_map(path: Path, AutoConfig: Any, cls: Any, embed_on_cpu: bool, vision_on_cpu: bool) -> dict[str, Any]:
        """Everything on cuda:0, except the input embeddings and the vision tower when asked.
        Module names come from an empty (meta) model, so they match this transformers version."""
        dm: dict[str, Any] = {"": 0}
        if not (embed_on_cpu or vision_on_cpu):
            return dm
        from accelerate import init_empty_weights

        config = AutoConfig.from_pretrained(path)
        with init_empty_weights():
            skeleton = cls._from_config(config)
        names = [n for n, _ in skeleton.named_modules()]
        if embed_on_cpu:
            embeds = [n for n in names if n.endswith("embed_tokens")]
            if not embeds:
                print("warning: no embed_tokens module found; embeddings stay on the GPU", file=sys.stderr)
            for n in embeds:
                dm[n] = "cpu"
        if vision_on_cpu:
            vis = [n for n in names if n.split(".")[-1] in ("visual", "vision_tower", "vision_model")]
            for n in vis:
                dm[n] = "cpu"
        # Tied embeddings would drag lm_head to the CPU too: keep both on the GPU then.
        if getattr(config, "tie_word_embeddings", False) or getattr(getattr(config, "text_config", None), "tie_word_embeddings", False):
            for n in [k for k in dm if k.endswith("embed_tokens")]:
                del dm[n]
                print("note: tied embeddings, so embed_tokens stays on the GPU with lm_head", file=sys.stderr)
        return dm

    @staticmethod
    def _param_sizes(backbone: Any, head: Any) -> dict[str, float]:
        """GB of parameters (and 4-bit packed storage) per placement, for the report."""
        sizes: dict[str, float] = {}
        for module, label in ((backbone, "backbone"), (head, "joint_head")):
            for _, p in module.named_parameters():
                key = f"{label}@{p.device.type}"
                sizes[key] = sizes.get(key, 0.0) + p.numel() * p.element_size() / 1e9
        lm = backbone.get_output_embeddings().weight
        sizes["of which lm_head (bf16)"] = lm.numel() * lm.element_size() / 1e9
        return {k: round(v, 3) for k, v in sizes.items()}

    def decide(self, record: dict[str, Any]) -> dict[str, dict[str, float]]:
        torch = self.torch
        encoded = self.jsm.encode_record(
            self.processor.tokenizer, record, max_state_tokens=self.max_state_tokens, processor=self.processor
        )
        batch = self.jsm.collate_records([encoded], self.pad_id, self.device)
        with torch.inference_mode():
            logits = self.model(batch)[0]
        torch.cuda.synchronize()
        out: dict[str, dict[str, float]] = {}
        for question, question_logits in zip(encoded.questions, logits, strict=True):
            probs = question_logits.float().softmax(-1).tolist()
            out[str(question.question_id)] = {norm_option(o): p for o, p in zip(question.option_ids, probs, strict=True)}
        return out


def pin_embeddings_on_cpu(backbone: Any, device: Any, dtype: Any) -> None:
    """Keep the input embedding table (248,320 x 4,096, about 2 GB in bf16) in RAM and send only
    the looked-up rows to the GPU. A plain device_map "cpu" entry would make accelerate copy the
    whole table to the GPU on every forward; this replaces the module with a CPU lookup."""
    import torch

    class _CpuEmbedding(torch.nn.Module):
        def __init__(self, emb: torch.nn.Embedding) -> None:
            super().__init__()
            self.emb = emb

        def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
            out = self.emb(input_ids.to("cpu"))
            return out.to(device=device, dtype=dtype, non_blocking=True)

    for name, mod in list(backbone.named_modules()):
        if not name.endswith("embed_tokens") or not isinstance(mod, torch.nn.Embedding):
            continue
        weight = None
        hook = getattr(mod, "_hf_hook", None)
        # accelerate may stack hooks (SequentialHook); the offload hook holds the real weights.
        for hk in getattr(hook, "hooks", [hook]) if hook is not None else []:
            if getattr(hk, "weights_map", None) is not None:
                weight = hk.weights_map["weight"]
                break
        if hook is not None:
            from accelerate.hooks import remove_hook_from_module

            remove_hook_from_module(mod, recurse=True)
        if mod.weight.device.type == "meta":
            if weight is None:
                raise RuntimeError(f"{name}: weights were offloaded but cannot be found")
            mod.weight = torch.nn.Parameter(weight.to("cpu"), requires_grad=False)
        elif mod.weight.device.type != "cpu":
            mod.to("cpu")
        parent_name, _, attr = name.rpartition(".")
        setattr(backbone.get_submodule(parent_name), attr, _CpuEmbedding(mod))
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def top(probs: dict[str, float]) -> tuple[str, float]:
    k = max(probs, key=lambda o: probs[o])
    return k, probs[k]
