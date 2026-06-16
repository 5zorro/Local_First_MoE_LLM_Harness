#!/usr/bin/env bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# validate-model-config.sh — compare the ollama model entries in openclaw.json against
# what `ollama` actually reports via /api/show, and warn on drift.
#   exit 0 = no drift · exit 1 = at least one warning (so it can gate promote-amendment).
# Source of truth = ollama, NOT the config. (P1-4 from the 2026-06-14 harness critique.)
#
# Usage: scripts/validate-model-config.sh [path-to-openclaw.json]
set -uo pipefail
CONFIG="${1:-$HOME/.openclaw/openclaw.json}"

python3 - "$CONFIG" <<'PY'
import json, sys, urllib.request

cfg_path = sys.argv[1]
try:
    cfg = json.load(open(cfg_path))
except Exception as e:
    print(f"❌ cannot read {cfg_path}: {e}"); sys.exit(2)

prov = cfg.get("models", {}).get("providers", {}).get("ollama", {})
base = prov.get("baseUrl", "http://localhost:11434").rstrip("/")
models = prov.get("models", [])
prov_num_ctx = prov.get("params", {}).get("num_ctx")
prov_cw = prov.get("contextWindow")

def api_show(name):
    req = urllib.request.Request(
        base + "/api/show",
        data=json.dumps({"name": name}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

warns = 0
print(f"# model-config validation against {base}\n")

if prov_num_ctx is not None or prov_cw is not None:
    print(f"⚠️  provider-level override present: contextWindow={prov_cw} num_ctx={prov_num_ctx}")
    print("    → this can force an over-large context on every model; prefer per-model values (critique P1-4).\n")
    warns += 1

for m in models:
    mid = m.get("id")
    cfg_cw = m.get("contextWindow")
    cfg_nctx = m.get("params", {}).get("num_ctx")
    cfg_in = set(m.get("input", []))
    out = [f"## {mid}"]
    try:
        info = api_show(mid)
    except Exception as e:
        print(f"## {mid}\n  ❌ ollama /api/show failed: {e}\n"); warns += 1; continue
    mi = info.get("model_info", {}) or {}
    real_cw = next((v for k, v in mi.items() if k.endswith(".context_length")), None)
    caps = set(info.get("capabilities", []) or [])
    real_in = {"text"}
    if "vision" in caps:
        real_in.add("image")
    # audio is not exposed via ollama capabilities, so we never flag a configured "audio" as wrong.

    # invariant 1: num_ctx must not exceed the model's real context window (OOM / invalid request)
    if real_cw is not None and cfg_nctx is not None and cfg_nctx > real_cw:
        out.append(f"  ⚠️  num_ctx={cfg_nctx} exceeds model context_length={real_cw} (OOM/invalid)"); warns += 1
    # invariant 2: OpenClaw's contextWindow (packing budget) must not exceed num_ctx (else it overfills -> truncation)
    if cfg_cw is not None and cfg_nctx is not None and cfg_cw > cfg_nctx:
        out.append(f"  ⚠️  contextWindow={cfg_cw} > num_ctx={cfg_nctx} (OpenClaw may overfill the ollama context)"); warns += 1
    # modality: only flag a configured modality ollama doesn't report. audio isn't exposed via caps, so it's never flagged.
    missing = cfg_in - real_in - {"audio"}
    if missing:
        out.append(f"  ⚠️  config input {sorted(cfg_in)} but ollama caps imply {sorted(real_in)} (unconfirmed: {sorted(missing)})"); warns += 1
    if len(out) == 1:
        head = (real_cw - cfg_nctx) if (real_cw and cfg_nctx) else None
        out.append(f"  ✅ ok — num_ctx={cfg_nctx}, contextWindow={cfg_cw}, model max={real_cw}"
                   + (f" (headroom to raise num_ctx: +{head} if VRAM allows)" if head else "")
                   + f", caps={sorted(caps)}")
    print("\n".join(out) + "\n")

print(f"--- {warns} warning(s) ---")
sys.exit(1 if warns else 0)
PY
