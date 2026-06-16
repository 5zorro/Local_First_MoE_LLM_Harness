#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# check-bug-bounty.sh — 3-strike bug bounty rule (A10, spec §3.8 / Critic C5).
#
# Two modes:
#   1. Scan mode (no args): scan ops-log.md for recurring failure signatures.
#      Any normalized failure line seen >=3 times with no existing bounty file
#      → create bug-bounty/<slug>.md from TEMPLATE.md.
#   2. First-strike mode: check-bug-bounty.sh --first "<topic>" "<signature>"
#      Opens a bounty immediately (used for prompt-injection class — spec §3.10).
set -euo pipefail

BB_DIR="$HARNESS_ROOT/bug-bounty"
OPS_LOG="$HARNESS_ROOT/memory/ops-log.md"
TEMPLATE="$BB_DIR/TEMPLATE.md"
mkdir -p "$BB_DIR"

slugify() { echo "$1" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-50; }

open_bounty() { # <slug> <title> <reason>
  local slug="$1" title="$2" reason="$3"
  local f="$BB_DIR/${slug}.md"
  if [ -e "$f" ]; then
    echo "[bug-bounty] already exists: $f (not reopening)"
    return 0
  fi
  sed "s/<topic>/${title//\//\\/}/" "$TEMPLATE" > "$f"
  printf '\n<!-- auto-opened %s: %s -->\n' "$(date '+%Y-%m-%d %H:%M')" "$reason" >> "$f"
  echo "[bug-bounty] OPENED $f — $reason"
}

if [ "${1:-}" = "--first" ]; then
  TITLE="${2:?topic required}"; SIG="${3:-first-occurrence}"
  open_bounty "$(slugify "$TITLE")-$(date +%Y%m%d)" "$TITLE" "first-occurrence: $SIG"
  exit 0
fi

# Scan mode -------------------------------------------------------------
[ -f "$OPS_LOG" ] || { echo "[bug-bounty] no ops-log.md; nothing to scan"; exit 0; }

# Pull failure-ish lines, take the 'notes'/result field, normalize out
# timestamps, hex ids, digits, and paths so the same failure collapses.
grep -iE 'fail|error|denied|timeout|refused|exhausted' "$OPS_LOG" 2>/dev/null \
  | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}[^|]*\|//; s/[0-9a-f]{8,}//g; s/[0-9]+//g; s#/[^ |]+##g' \
  | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' \
  | sort | uniq -c | sort -rn \
  | while read -r count sig; do
      [ "$count" -ge 3 ] || continue
      [ -z "$sig" ] && continue
      open_bounty "recurring-$(slugify "$sig")" "$sig" "$count occurrences in ops-log.md (3-strike rule)"
    done

echo "[bug-bounty] scan complete"
