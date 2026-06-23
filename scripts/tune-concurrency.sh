#!/bin/bash
# tune-concurrency.sh — derive agents.defaults.subagents.maxConcurrent from a VRAM budget ÷ the expert
# model's footprint, so the harness SCALES with hardware (Goal 2) instead of being hardwired to one GPU.
# Re-run after a GPU/VRAM change or after switching the expert model.
#
#   ./scripts/tune-concurrency.sh                 # declared/default budget, WRITE the result
#   ./scripts/tune-concurrency.sh 24              # budget = 24 GB
#   HARNESS_VRAM_GB=24 ./scripts/tune-concurrency.sh
#   ./scripts/tune-concurrency.sh --dry-run 24    # show what it WOULD set, change nothing
#
# VRAM auto-detection is unreliable on this Windows/AMD box (no nvidia-smi/rocm-smi; Win32 AdapterRAM
# under-reports cards >4 GB), so the budget is DECLARED: arg > $HARNESS_VRAM_GB > default 13. Bump it on
# upgrade (persist via /home/pi/.config/harness/env: HARNESS_VRAM_GB=24). The expert-model footprint is
# MEASURED from Ollama, so swapping to smaller models raises concurrency automatically.
set -uo pipefail
CFG="${OPENCLAW_CONFIG:-/home/pi/.openclaw/openclaw.json}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
[ -f /home/pi/.config/harness/env ] && { set -a; . /home/pi/.config/harness/env; set +a; }

DRY=0; POS=()
for a in "$@"; do if [ "$a" = "--dry-run" ]; then DRY=1; else POS+=("$a"); fi; done
BUDGET="${POS[0]:-${HARNESS_VRAM_GB:-13}}"
SAFETY="${HARNESS_VRAM_SAFETY:-0.85}"   # fraction of VRAM usable for expert weights (rest = KV cache + overhead)

echo "tune-concurrency: budget=${BUDGET}GB  safety=${SAFETY}  config=$CFG"
python3 - "$CFG" "$OLLAMA_URL" "$BUDGET" "$DRY" "$SAFETY" <<'PY'
import sys, json, math, urllib.request, time, shutil
cfg_path, ollama, budget, dry, SAFETY = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4] == "1", float(sys.argv[5])
CAP = 6         # never exceed the dispatchable expert roster

d = json.load(open(cfg_path))
sub = d["agents"]["defaults"]["subagents"]
expert = str(sub.get("model", "ollama/gemma4:latest")).split("/", 1)[-1]  # strip provider prefix

# Measure the expert model's footprint from Ollama (on-disk weights ≈ the VRAM floor).
try:
    tags = json.load(urllib.request.urlopen(ollama.rstrip("/") + "/api/tags", timeout=8))
except Exception as e:
    print(f"  ERROR: can't reach Ollama at {ollama} to measure '{expert}' ({e})."); sys.exit(2)
models = tags.get("models", [])
foot = next((m.get("size", 0) / 1e9 for m in models if m.get("name") == expert), None)  # exact tag first
if foot is None:  # fall back to base name only if the exact tag isn't present
    foot = next((m.get("size", 0) / 1e9 for m in models if m.get("name", "").split(":")[0] == expert.split(":")[0]), None)
if not foot:
    print(f"  ERROR: expert model '{expert}' not found in Ollama — pull it or fix subagents.model."); sys.exit(2)

calc = max(1, min(CAP, math.floor(budget * SAFETY / foot + 1e-9)))
cur = sub.get("maxConcurrent")
print(f"  expert model    : {expert}  (~{foot:.1f} GB weights)")
print(f"  budget × safety : {budget:.0f} × {SAFETY} = {budget*SAFETY:.1f} GB usable")
print(f"  → maxConcurrent : {calc}   (cap {CAP})   [current: {cur}]")

if dry:
    print("  (--dry-run: nothing written)"); sys.exit(0)
if cur == calc:
    print("  already correct — no change."); sys.exit(0)
bak = cfg_path + ".bak." + time.strftime("%Y%m%d-%H%M%S"); shutil.copy(cfg_path, bak)
sub["maxConcurrent"] = calc
json.dump(d, open(cfg_path, "w"), indent=2); open(cfg_path, "a").write("\n")
json.load(open(cfg_path))  # validate it's still parseable
print(f"  WROTE maxConcurrent {cur} → {calc}  (backup: {bak})")
print("  ⚠️  restart the gateway to apply:  openclaw gateway restart")
PY
