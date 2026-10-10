#!/usr/bin/env bash
# P15.1: set up a Python environment for Clef-flash inside WSL2 (Ubuntu), with GPU access.
#   bash setup-wsl.sh          # torch + transformers + bitsandbytes in ~/clef-venv
#   bash setup-wsl.sh --fast   # also flash-linear-attention (faster linear-attention layers)
# Safe to run again. Nothing here needs sudo except installing python3-venv if it is missing.
set -euo pipefail
cd "$(dirname "$0")"

VENV="${CLEF_VENV:-$HOME/clef-venv}"
TORCH_INDEX="${TORCH_INDEX:-https://download.pytorch.org/whl/cu128}"
FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

# Git Bash / MSYS (MINGW64) also runs bash and finds the Windows nvidia-smi, but the model needs Linux.
if [[ "$(uname -s)" != "Linux" ]] || ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "This must run inside WSL2 (Ubuntu), not $(uname -s)."
  echo "Open PowerShell, type: wsl   then:"
  echo "  cd \"/mnt/c/Users/vince/Desktop/+/agora-plan/spikes/npc-brain/clef\" && bash setup-wsl.sh --fast"
  echo "No WSL yet? In PowerShell as administrator: wsl --install   then reboot."
  exit 1
fi

echo "== GPU seen from WSL2"
if ! command -v nvidia-smi >/dev/null; then
  echo "nvidia-smi not found in WSL2. Update the NVIDIA driver on Windows (WSL2 GPU support is in the normal Game Ready / Studio driver), then 'wsl --shutdown' and retry."
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version --format=csv

echo "== Disk (the model is about 19 GB, kept in ~/.cache/huggingface inside WSL2)"
df -h "$HOME" | tail -1
free -g 2>/dev/null | head -2 || true

echo "== Python venv in $VENV"
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ needed"'
if [[ ! -f "$VENV/bin/activate" ]]; then
  # A venv left half-made by an earlier failed attempt has no bin/activate: start it again.
  rm -rf "$VENV"
  PYVER="$(python3 -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
  python3 -m venv "$VENV" || {
    rm -rf "$VENV"
    echo "python3 cannot make a venv yet. Run:"
    echo "  sudo apt update && sudo apt install -y python3-venv python${PYVER}-venv"
    echo "then: bash setup-wsl.sh --fast"
    exit 1
  }
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install -U pip wheel >/dev/null

echo "== torch (CUDA wheels from $TORCH_INDEX)"
python -m pip install torch torchvision --index-url "$TORCH_INDEX"
echo "== transformers, accelerate, bitsandbytes"
python -m pip install -r requirements.txt
if [[ $FAST == 1 ]]; then
  # fla runs Triton kernels, and Triton compiles a small C helper on first use: it needs gcc and Python headers.
  if ! command -v gcc >/dev/null || ! python -c 'import sysconfig,os,sys; sys.exit(0 if os.path.exists(os.path.join(sysconfig.get_paths()["include"],"Python.h")) else 1)'; then
    echo "--fast needs a C compiler and Python headers for Triton. Run:"
    echo "  sudo apt update && sudo apt install -y build-essential python3-dev"
    echo "then: bash setup-wsl.sh --fast"
    exit 1
  fi
  echo "== flash-linear-attention (optional)"
  python -m pip install flash-linear-attention || echo "flash-linear-attention did not install; the benchmark falls back to plain torch."
fi

python - <<'EOF'
import torch, transformers
print("torch", torch.__version__, "cuda", torch.version.cuda, "available", torch.cuda.is_available())
if torch.cuda.is_available():
    free, total = torch.cuda.mem_get_info()
    print("GPU", torch.cuda.get_device_name(0), f"free {free/1e9:.1f} GB of {total/1e9:.1f} GB")
print("transformers", transformers.__version__)
EOF

cat <<EOF

Ready. Next:
  source $VENV/bin/activate
  python clef_bench.py --limit 20    # quick check (downloads the model the first time)
  python clef_bench.py               # full run, results in ../results/
  python clef_server.py              # then on Windows: pnpm tsx spikes/npc-brain/sort-test.ts --via clef
Close games and GPU-heavy apps first: the model needs about 6.5 GB of GPU memory.
EOF
