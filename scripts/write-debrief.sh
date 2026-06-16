#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# write-debrief.sh — create an end-of-session debrief (A6, spec §3.4 rule 4).
# Usage: write-debrief.sh "<topic-slug>"   (body read from stdin; falls back to a template)
set -euo pipefail

TOPIC="${1:-session}"
SLUG="$(echo "$TOPIC" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
DIR="$HARNESS_ROOT/debriefs"
FILE="$DIR/$(date '+%Y-%m-%d')-${SLUG}.md"

mkdir -p "$DIR"

if [ ! -t 0 ] && [ -s /dev/stdin ]; then
  BODY="$(cat)"
else
  BODY=""
fi

{
  echo "# Debrief — ${TOPIC}"
  echo ""
  echo "_Date: $(date '+%Y-%m-%d %H:%M')_"
  echo ""
  if [ -n "$BODY" ]; then
    echo "$BODY"
  else
    echo "## What worked"
    echo "- "
    echo ""
    echo "## What didn't"
    echo "- "
    echo ""
    echo "## What to try next"
    echo "- "
  fi
} > "$FILE"

echo "[write-debrief] wrote $FILE"
