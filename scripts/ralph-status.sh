#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# ralph-status.sh — is a Ralph loop running right now?
#
# The loop runs in a terminal (not a gateway job), so this checks its lockfile.
# Also: open the "ralph-live" session in the web UI to watch iterations live.
set -uo pipefail
HARNESS="$HARNESS_ROOT"
LOCK="$HARNESS/ralph/.running"
PLAN="$HARNESS/ralph/plan.md"
SCRATCH="$HARNESS/memory/scratch.md"

if [ -f "$LOCK" ]; then
  line="$(cat "$LOCK")"
  pid="$(printf '%s' "$line" | sed -n 's/.*pid \([0-9]\{1,\}\).*/\1/p')"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "🟢 RALPH RUNNING"
    echo "   $line"
    echo "   web UI : open the 'ralph-live' session to watch turns appear"
    echo "   top    : $(grep -m1 -E '^[-*0-9]' "$PLAN" 2>/dev/null | cut -c1-90)"
    echo "   state  : $(tail -n1 "$SCRATCH" 2>/dev/null)"
    exit 0
  fi
  echo "🟠 STALE lockfile — the loop process ($pid) is not alive (crashed or hard-killed)."
  echo "   $line"
  echo "   (safe to remove: rm $LOCK)"
  exit 0
fi

echo "⚪ No Ralph loop running."
last="$(ls -1t "$HARNESS"/ralph/run-*.log 2>/dev/null | head -1)"
if [ -n "$last" ]; then
  echo "   last run log: $last"
  tail -n 3 "$last" | sed 's/^/   /'
fi
