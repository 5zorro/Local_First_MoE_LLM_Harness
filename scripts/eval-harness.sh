#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# eval-harness.sh — regression checks for the harness.
#
# Run anytime, and especially BEFORE promoting a proposed amendment
# (promote-amendment.sh gates on a green run). Encodes the bug CLASSES we have
# actually hit: bootstrap truncation, bare paths, unregistered models, broken
# scripts, lost identity-file ownership, a gutted Critic checklist.
#
#   ./scripts/eval-harness.sh          static checks (fast, deterministic)
#   ./scripts/eval-harness.sh --full   also run per-expert behavioral evals (slow; uses the model)
#
# Exit code 0 = all checks pass (warnings allowed); non-zero = at least one FAIL.
set -uo pipefail
HARNESS="$HARNESS_ROOT"
CFG="$OPENCLAW_HOME/openclaw.json"
WS="$OPENCLAW_WORKSPACE"
fails=0; warns=0
pass(){ echo "  ✅ $1"; }
warn(){ echo "  ⚠️  $1"; warns=$((warns+1)); }
fail(){ echo "  ❌ $1"; fails=$((fails+1)); }

echo "== 1. Bootstrap size (prevents silent SOUL.md truncation) =="
CAP=$(python3 -c "import json;print(json.load(open('$CFG'))['agents']['defaults'].get('bootstrapMaxChars',12000))" 2>/dev/null || echo 12000)
echo "  cap = $CAP chars (warn above 90%)"
over=0
for f in "$WS"/SOUL.md "$WS"/AGENTS.md "$WS"/MEMORY.md "$WS"/IDENTITY.md "$WS"/USER.md "$WS"/TOOLS.md "$WS"/HEARTBEAT.md \
         "$HARNESS"/workspaces/*/SOUL.md "$HARNESS"/workspaces/*/AGENTS.md "$HARNESS"/workspaces/*/TOOLS.md; do
  [ -f "$f" ] || continue
  n=$(wc -c <"$f"); name="${f#/home/pi/}"
  if   [ "$n" -gt "$CAP" ];               then fail "$name = $n  > cap (WILL TRUNCATE)"; over=1
  elif [ "$n" -gt $((CAP*90/100)) ];      then warn "$name = $n  (>90% of cap — tighten soon)"; over=1
  fi
done
[ "$over" -eq 0 ] && pass "all bootstrap files comfortably within cap"

echo "== 2. Config validity =="
python3 -c "import json;json.load(open('$CFG'))" 2>/dev/null && pass "openclaw.json valid" || fail "openclaw.json INVALID JSON"
python3 -c "import json;json.load(open('$OPENCLAW_HOME/exec-approvals.json'))" 2>/dev/null && pass "exec-approvals.json valid" || fail "exec-approvals.json INVALID JSON"

echo "== 3. Every allowlisted model is registered (no silent FailoverError) =="
unreg=$(python3 -c "
import json;d=json.load(open('$CFG'))
allow=set(d['agents']['defaults'].get('models',{}))
reg=set(f\"{p}/{m['id']}\" for p,pp in d['models']['providers'].items() for m in pp.get('models',[]))
print(','.join(sorted(allow-reg)))" 2>/dev/null)
[ -z "$unreg" ] && pass "all allowlisted models registered" || fail "unregistered (would FailoverError): $unreg"

echo "== 4. Bare-path scan (actionable memory/debrief refs without absolute path) =="
hits=$(grep -rnoE '[^/`(]debriefs/|[^/`(]proposed-amendments/' \
  "$WS"/SOUL.md "$HARNESS"/workspaces/*/SOUL.md 2>/dev/null \
  | grep -viE 'retrospectives|= the |only by its absolute' | wc -l)
[ "$hits" -eq 0 ] && pass "no obvious bare actionable paths" || warn "$hits possible bare path ref(s) — review (descriptive prose is fine)"

echo "== 5. Scripts syntax-check (C8) =="
serr=0; for s in "$HARNESS"/scripts/*.sh; do bash -n "$s" 2>/dev/null || { fail "syntax: ${s##*/}"; serr=1; }; done
[ "$serr" -eq 0 ] && pass "all scripts parse"
python3 -m py_compile "$HARNESS"/canary/canary-server.py 2>/dev/null && pass "canary-server.py parses" || fail "canary-server.py syntax"

echo "== 6. Identity files still root-owned (A11) =="
for f in agent.bootstrap.md conventions.md; do
  o=$(stat -c '%U' "$HARNESS/memory/$f" 2>/dev/null || echo '?')
  [ "$o" = "root" ] && pass "$f root-owned" || fail "$f owned by '$o' (must be root)"
done

echo "== 7. Critic checklist intact (C1..C10) =="
miss=""; for c in C1 C2 C3 C4 C5 C6 C7 C8 C9 C10; do grep -q "$c" "$HARNESS/workspaces/critic/SOUL.md" || miss="$miss $c"; done
[ -z "$miss" ] && pass "critic C1-C10 present" || warn "critic missing:$miss"

if [ "${1:-}" = "--full" ]; then
  echo "== 8. Behavioral evals (per-expert) =="
  if [ -x "$HARNESS/scripts/run-evals.sh" ]; then
    "$HARNESS/scripts/run-evals.sh" || fail "behavioral evals reported failures"
  else
    warn "run-evals.sh missing"
  fi
fi

echo "==========================================="
echo "RESULT: $fails failure(s), $warns warning(s)"
[ "$fails" -eq 0 ]
