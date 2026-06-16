#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# propose-edit.sh — move working-tree changes onto a review side branch (spec §3.6, D3).
#
# Agent-facing: run AFTER making edits to a PROJECT/CODE repo. It moves the current
# uncommitted changes onto `agent/proposed-<task-id>`, leaves the base branch clean,
# and prints review instructions for the operator. The agent NEVER merges — the operator does that.
#
# NOTE: do not use this for the harness's own memory/ scratchpad — those writes are
# governed by the turn-end flow + permissions model, not the diff-review loop.
#
# Usage: propose-edit.sh <task-id> "<commit msg>" [repo-path]
set -euo pipefail

TASK="${1:?Usage: propose-edit.sh <task-id> \"<commit msg>\" [repo-path]}"
MSG="${2:?commit message required}"
REPO="${3:-$PWD}"

cd "$REPO"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Error: $REPO is not a git repo" >&2; exit 1; }

BRANCH="agent/proposed-${TASK}"
BASE="$(git branch --show-current)"
[ -n "$BASE" ] || { echo "Error: detached HEAD; check out a branch first" >&2; exit 1; }
case "$BASE" in agent/proposed-*) echo "Error: already on a proposal branch ($BASE)" >&2; exit 1;; esac
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && { echo "Error: $BRANCH already exists; pick a new task-id" >&2; exit 1; }

# must actually have changes
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "Error: no changes to propose in $REPO" >&2; exit 1
fi

# move the working-tree changes onto the side branch, leave base clean
git stash push -u -m "propose-${TASK}" >/dev/null
git switch -c "$BRANCH" >/dev/null
git stash pop >/dev/null
git add -A
git commit -q -m "$MSG"
git switch "$BASE" >/dev/null

echo "✅ Proposed changes are on '$BRANCH' (base: '$BASE'). Working tree on '$BASE' is clean."
echo ""
echo "--- For the operator to review ---"
git --no-pager diff --stat "${BASE}..${BRANCH}" | sed 's/^/    /'
echo ""
echo "  Review (VS Code):  open Source Control → branch $BRANCH, or  git -C $REPO difftool $BASE..$BRANCH"
echo "  Review (terminal): git -C $REPO diff $BASE..$BRANCH"
echo "  List all:          $HARNESS_ROOT/scripts/review-proposals.sh $REPO"
echo "  Accept ALL:        $HARNESS_ROOT/scripts/accept-proposal.sh $TASK $REPO"
echo "  Reject:            $HARNESS_ROOT/scripts/reject-proposal.sh $TASK \"<reason>\" $REPO"
