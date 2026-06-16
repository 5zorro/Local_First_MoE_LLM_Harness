#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# accept-proposal.sh — merge a reviewed proposal into its base (spec §3.6 "keep all" button).
#
# HUMAN-ONLY: refuses unless run from a real terminal (tty). A headless agent cannot
# complete it — this is what makes "nothing auto-applies" (D3) structurally true even
# though `git` is allowlisted for the manager.
#
# Usage: accept-proposal.sh <task-id> [repo-path]
set -euo pipefail

TASK="${1:?Usage: accept-proposal.sh <task-id> [repo-path]}"
REPO="${2:-$PWD}"
cd "$REPO"

BRANCH="agent/proposed-${TASK}"
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 || { echo "Error: no branch $BRANCH in $REPO" >&2; exit 1; }
BASE="$(git branch --show-current)"
PRE="$(git rev-parse HEAD)"

# git teaching (explain before doing, surface undo) — spec §3.6
echo "About to merge '$BRANCH' → '$BASE' with --ff-only."
echo "  What it does: replays the proposal's commit(s) onto '$BASE' linearly (no merge commit)."
echo "  If it can't fast-forward, '$BASE' has new commits; rebase the proposal first."
echo "  Undo after merge: git -C $REPO reset --hard $PRE"
echo ""

# human gate: must be able to read from a controlling terminal
if ! { printf "Type 'merge' to proceed: " >/dev/tty && read -r ans </dev/tty; } 2>/dev/null; then
  echo "Refusing: accept-proposal must be run by a human at a terminal (no tty). Nothing merged." >&2
  exit 2
fi
[ "$ans" = "merge" ] || { echo "Aborted; nothing merged."; exit 1; }

git merge --ff-only "$BRANCH"
echo "✅ Merged '$BRANCH' into '$BASE'."
echo "   Undo this merge: git -C $REPO reset --hard $PRE"
git branch -d "$BRANCH" >/dev/null 2>&1 && echo "   Cleaned up branch '$BRANCH'."
