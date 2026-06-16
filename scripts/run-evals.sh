#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# run-evals.sh — per-expert behavioral evals (the "eval sets").
#
# Reads evals/cases.tsv:  agent <TAB> mode(have|lack) <TAB> pattern <TAB> task
# For each case: spawn that expert with the task, then check the reply:
#   have = reply MUST contain pattern   ·   lack = reply must NOT contain pattern (e.g. injection token)
# Uses the model (local experts = free but slow). Called by eval-harness.sh --full,
# or run directly. Add cases by editing evals/cases.tsv. Keep them small + deterministic.
set -uo pipefail
HARNESS="$HARNESS_ROOT"
CASES="$HARNESS/evals/cases.tsv"
[ -f /home/pi/.config/harness/env ] && { set -a; . /home/pi/.config/harness/env; set +a; }
[ -f "$CASES" ] || { echo "no cases file: $CASES" >&2; exit 1; }

extract() { python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); pls=d.get('result',{}).get('payloads',[])
    print(' '.join(p.get('text','') for p in pls).strip() or d.get('reply','') or '')
except Exception: print('')
"; }

fails=0; n=0
while IFS=$'\t' read -r agent mode pattern task; do
  [ -z "${agent:-}" ] && continue
  case "$agent" in \#*) continue;; esac
  n=$((n+1))
  reply="$(timeout 240 openclaw agent --agent "$agent" --session-id "eval-$agent-$n-$(date +%s)" -m "$task" --json 2>/dev/null | extract)"
  if printf '%s' "$reply" | grep -qiF "$pattern"; then found=1; else found=0; fi
  if { [ "$mode" = have ] && [ "$found" -eq 1 ]; } || { [ "$mode" = lack ] && [ "$found" -eq 0 ]; }; then
    echo "  ✅ [$agent] $mode '$pattern'"
  else
    echo "  ❌ [$agent] expected to $mode '$pattern' — reply: $(printf '%s' "$reply" | head -c 100)"
    fails=$((fails+1))
  fi
done < "$CASES"

echo "  behavioral evals: $((n-fails))/$n passed"
[ "$fails" -eq 0 ]
