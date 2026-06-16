#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# reset-scratch.sh — wipe scratch.md back to a clean template.
#
# scratch.md is the agent's "current state" whiteboard. NOTE: OpenClaw's /reset
# clears the chat SESSION, not this file — they're independent. Run this when you
# want a clean working slate (e.g. starting unrelated work).
set -euo pipefail
SCRATCH="$HARNESS_ROOT/memory/scratch.md"
cat > "$SCRATCH" <<'EOF'
## Active task

_Current working state ONLY — overwrite this each turn. This is a whiteboard, not a log.
(todos.md = the task list · decisions.md = the permanent log · debriefs/ = session retrospectives)_

(nothing active)
EOF
echo "[reset-scratch] scratch.md reset to clean template"
