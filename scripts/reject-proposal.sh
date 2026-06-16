#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# reject-proposal.sh — discard a proposal and record why so the agent learns (spec §3.6).
# Usage: reject-proposal.sh <task-id> "<reason>" [repo-path]
set -euo pipefail

TASK="${1:?Usage: reject-proposal.sh <task-id> \"<reason>\" [repo-path]}"
REASON="${2:?reason required}"
REPO="${3:-$PWD}"
cd "$REPO"

BRANCH="agent/proposed-${TASK}"
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 || { echo "Error: no branch $BRANCH in $REPO" >&2; exit 1; }

git branch -D "$BRANCH"
echo "Rejected and deleted '$BRANCH'."

# feed the reason back so the agent reads it next turn (spec §3.6 reject path)
SCRATCH="$HARNESS_ROOT/memory/scratch.md"
if [ -w "$SCRATCH" ]; then
  printf '\n## Rejected proposal %s (%s)\nRepo: %s\nReason: %s\n' \
    "$TASK" "$(date '+%Y-%m-%d %H:%M')" "$REPO" "$REASON" >> "$SCRATCH"
  echo "Logged the rejection reason to scratch.md for the agent to learn from."
fi
