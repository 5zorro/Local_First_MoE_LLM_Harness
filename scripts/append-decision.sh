#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# append-decision.sh
# Append-only wrapper for decisions.md.
# Usage: append-decision.sh "<decision text>"        (date auto-prepended)
#    or: append-decision.sh "YYYY-MM-DD: <text>"      (explicit date kept as-is)
# The date is added automatically so callers never need a $(date) subshell.
# Never truncates — always appends.

set -euo pipefail

DECISIONS="$HARNESS_ROOT/memory/decisions.md"

if [ $# -eq 0 ]; then
  echo "Usage: $0 \"<decision text>\"" >&2
  exit 1
fi

if [ ! -f "$DECISIONS" ]; then
  echo "Error: $DECISIONS does not exist" >&2
  exit 1
fi

TEXT="$*"
# auto-prepend today's date unless the text already starts with YYYY-MM-DD
if ! printf '%s' "$TEXT" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
  TEXT="$(date +%F): $TEXT"
fi

BEFORE=$(wc -c < "$DECISIONS")
printf '%s\n' "$TEXT" >> "$DECISIONS"
AFTER=$(wc -c < "$DECISIONS")

if [ "$AFTER" -le "$BEFORE" ]; then
  echo "Error: file did not grow after append — check permissions" >&2
  exit 1
fi

echo "[append-decision] appended to $DECISIONS (+$((AFTER - BEFORE)) bytes)"
