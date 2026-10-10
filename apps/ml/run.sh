#!/usr/bin/env bash
# apps/ml (P15.3): start Clef-flash for Agora's characters.
#   bash run.sh            # the real model, http://127.0.0.1:8790
#   bash run.sh --fake     # random answers, no GPU (try the plumbing)
# Extra flags go to the server: --port 8791, --host 0.0.0.0 (needs ML_TOKEN), --quant 8bit.
set -euo pipefail
cd "$(dirname "$0")"
VENV="${CLEF_VENV:-$HOME/clef-venv}"
if [[ " $* " != *" --fake "* ]]; then
  if [[ ! -f "$VENV/bin/activate" ]]; then
    echo "No Python environment in $VENV yet: run  bash setup-wsl.sh --fast  first (or bash run.sh --fake)."
    exit 1
  fi
  # shellcheck disable=SC1091
  source "$VENV/bin/activate"
fi
exec python3 -m agora_ml.server "$@"
