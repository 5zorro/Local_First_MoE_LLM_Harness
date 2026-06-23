#!/bin/bash
# harness-status.sh — watch the live pending-state trail of The manager turns.
# The TUI/in-chat path can't show "still working" (streaming pre-renders + no out-of-band push from a
# hook), so the preflight-planner writes the phase trail to a file instead. Tail it here.
#
#   ./scripts/harness-status.sh         # follow live (Ctrl-C to stop)
#   ./scripts/harness-status.sh 40      # show the last 40 lines and exit
LOG="/home/pi/agent-harness/memory/harness-progress.log"
[ -f "$LOG" ] || { echo "(no turns logged yet: $LOG)"; exit 0; }
if [ -n "${1:-}" ]; then tail -n "$1" "$LOG"; else echo "Following $LOG (Ctrl-C to stop)…"; tail -n 20 -f "$LOG"; fi
