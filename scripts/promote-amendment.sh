#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# promote-amendment.sh — apply a reviewed proposed-amendment, gated by the eval harness.
#
# HUMAN-ONLY (tty-gated, like accept-proposal.sh): the agent cannot self-promote.
# Flow: eval-harness must be green -> show diff -> confirm -> backup -> promote (sudo
# for root-owned targets) -> RE-RUN eval-harness -> if it now FAILS (e.g. bootstrap
# over cap), auto-rollback and report. This is the constitutional change with a
# regression gate + automatic rollback.
#
# Usage: promote-amendment.sh <proposed-amendment-file> <target-file>
#   e.g. promote-amendment.sh proposed-amendments/2026-06-03-x.md memory/conventions.md
set -uo pipefail
HARNESS="$HARNESS_ROOT"
SRC="${1:?Usage: promote-amendment.sh <proposed-file> <target-file>}"
DST="${2:?target file required}"
HARN="$HARNESS/scripts/eval-harness.sh"
[ -f "$SRC" ] || { echo "no such proposal: $SRC" >&2; exit 1; }
[ -f "$DST" ] || { echo "no such target: $DST" >&2; exit 1; }

echo "== pre-promotion eval harness =="
if ! "$HARN"; then echo "REFUSING: harness is already failing — fix that first." >&2; exit 2; fi

echo ""; echo "== diff: $DST  <=  $SRC =="
diff -u "$DST" "$SRC" || true
echo ""
# human gate
if ! { printf "Type 'promote' to apply this amendment: " >/dev/tty && read -r ans </dev/tty; } 2>/dev/null; then
  echo "REFUSING: must be run by a human at a terminal. Nothing changed." >&2; exit 2
fi
[ "$ans" = "promote" ] || { echo "Aborted; nothing changed."; exit 1; }

BAK="/tmp/amend-bak-$(date +%s)-$(basename "$DST")"
owner="$(stat -c '%U:%G' "$DST")"
cp "$DST" "$BAK"; echo "backup: $BAK"

if [ "${owner%%:*}" = root ]; then
  echo "(root-owned target — sudo)"; sudo cp "$SRC" "$DST" && sudo chown "$owner" "$DST"
else
  cp "$SRC" "$DST"
fi
echo "applied. re-running harness..."

if "$HARN"; then
  echo "✅ amendment promoted and harness still green."
  echo "   undo: cp $BAK $DST   (sudo if root-owned)"
else
  echo "❌ harness FAILED after promotion — rolling back."
  if [ "${owner%%:*}" = root ]; then sudo cp "$BAK" "$DST" && sudo chown "$owner" "$DST"; else cp "$BAK" "$DST"; fi
  echo "   rolled back from $BAK. Amendment NOT applied."
  exit 1
fi
