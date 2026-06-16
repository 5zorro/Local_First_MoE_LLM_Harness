#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# reflect.sh — digest recent harness activity for the end-of-session reflection.
#
# Run at session end (after the debrief), NOT every turn. Surfaces patterns so the
# manager + identity-keeper can: append a concise lesson to an expert's TOOLS.md
# (injected next spawn) and/or draft a proposed-amendment for recurring friction.
set -uo pipefail
M="$HARNESS_ROOT/memory"

echo "===== REFLECTION DIGEST  ($(date '+%Y-%m-%d %H:%M')) ====="
echo
echo "-- Critic verdicts (last 10) --"
grep -vE '^#|^_|^$' "$M/critic-log.md" 2>/dev/null | tail -n 10
echo
echo "-- Which Critic checks fail most (recurring weak spots) --"
grep -oE 'C[0-9]+' "$M/critic-log.md" 2>/dev/null | sort | uniq -c | sort -rn | head
echo
echo "-- Recurring ops-log errors (normalized) --"
grep -iE 'fail|error|denied|timeout|refused' "$M/ops-log.md" 2>/dev/null \
  | sed -E 's/[0-9]{4}-[0-9-]*[0-9:]*//; s/[0-9]+//g' | sort | uniq -c | sort -rn | head -5
echo
echo "-- Recent debriefs --"
ls -1t $HARNESS_ROOT/debriefs/*.md 2>/dev/null | head -3 | sed 's/^/   /'
echo
echo "ASK YOURSELF:"
echo "  1. Did any EXPERT repeatedly stumble in a fixable way? -> append ONE concise"
echo "     dated lesson to $HARNESS_ROOT/workspaces/<expert>/TOOLS.md"
echo "  2. Does a recurring friction / value-tension mean a RULE should change?"
echo "     -> have identity-keeper draft a proposed-amendment (the operator approves)."
echo "=========================================================="
