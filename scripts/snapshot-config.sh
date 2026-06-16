#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# snapshot-config.sh — export the LIVE gateway config into the repo (secret-scrubbed)
# so the harness is reproducible from a fresh clone (A12). Re-run after config changes.
#
# Captures into config/:
#   openclaw.json        (gateway.auth.token + secret apiKeys scrubbed; ${ENV} kept)
#   exec-approvals.json  (socket.token scrubbed)
#   manager-SOUL.md / manager-AGENTS.md / manager-IDENTITY.md  (the main agent's brain)
set -euo pipefail
HARNESS="$HARNESS_ROOT"
OUT="$HARNESS/config"
WS="$OPENCLAW_WORKSPACE"
mkdir -p "$OUT"

python3 - <<'PY'
import json
src="$OPENCLAW_HOME/openclaw.json"; out="$HARNESS_ROOT/config/openclaw.json"
d=json.load(open(src))
try: d["gateway"]["auth"]["token"]="REDACTED-set-on-restore"
except Exception: pass
for p in d.get("models",{}).get("providers",{}).values():
    k=p.get("apiKey")
    if isinstance(k,str) and not (k.startswith("${") or k=="ollama-local"):
        p["apiKey"]="REDACTED"
# scrub matrix channel secrets (bot accessToken / password), incl. named accounts
def _scrub_mx(node):
    if not isinstance(node,dict): return
    for key in ("accessToken","password"):
        v=node.get(key)
        if isinstance(v,str) and not v.startswith("${"): node[key]="REDACTED"
mx=d.get("channels",{}).get("matrix",{})
_scrub_mx(mx)
for acct in (mx.get("accounts") or {}).values(): _scrub_mx(acct)
json.dump(d, open(out,"w"), indent=2); open(out,"a").write("\n")
print("  config/openclaw.json (scrubbed)")

src2="$OPENCLAW_HOME/exec-approvals.json"; out2="$HARNESS_ROOT/config/exec-approvals.json"
e=json.load(open(src2))
if isinstance(e.get("socket"),dict) and "token" in e["socket"]: e["socket"]["token"]="REDACTED"
json.dump(e, open(out2,"w"), indent=2); open(out2,"a").write("\n")
print("  config/exec-approvals.json (scrubbed)")
PY

for f in SOUL AGENTS IDENTITY; do
  cp "$WS/$f.md" "$OUT/manager-$f.md" && echo "  config/manager-$f.md"
done

# safety: refuse to leave a real-looking secret in the snapshot
if grep -REn '"(token|apiKey|accessToken|password)"[[:space:]]*:[[:space:]]*"(?!REDACTED|\$\{|ollama-local)' "$OUT" 2>/dev/null | grep -vE 'REDACTED|\$\{|ollama-local' | grep -qE '"(token|apiKey|accessToken|password)"'; then
  echo "WARNING: possible unscrubbed secret in config/ — inspect before committing!" >&2
fi
echo "[snapshot-config] done -> $OUT"
