#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# review-proposals.sh — list open agent proposals (spec §3.6).
# Usage: review-proposals.sh [repo-path]
set -euo pipefail

REPO="${1:-$PWD}"
cd "$REPO"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Error: $REPO is not a git repo" >&2; exit 1; }
BASE="$(git branch --show-current)"

mapfile -t branches < <(git branch --list 'agent/proposed-*' --format='%(refname:short)')
if [ "${#branches[@]}" -eq 0 ]; then
  echo "No open proposals (agent/proposed-*) in $REPO."
  exit 0
fi

echo "Open proposals in $REPO (base: $BASE):"
for b in "${branches[@]}"; do
  task="${b#agent/proposed-}"
  echo ""
  echo "• $b"
  git --no-pager log -1 --format='    %h  %s  (%cr)' "$b"
  git --no-pager diff --stat "${BASE}..${b}" 2>/dev/null | sed 's/^/    /'
  echo "    accept: $HARNESS_ROOT/scripts/accept-proposal.sh $task $REPO"
  echo "    reject: $HARNESS_ROOT/scripts/reject-proposal.sh $task \"<reason>\" $REPO"
done
