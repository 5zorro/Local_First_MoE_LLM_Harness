#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# draft-amendment.sh — scaffold a proposed amendment to a ROOT-OWNED governance file.
#
# Agent-facing. Solves the common failure: "I can't edit memory/conventions.md (root-owned ->
# permission denied) and I don't know how to propose a change." This copies the TARGET file
# verbatim into proposed-amendments/<date>-<topic>.md so you edit a pi-owned COPY. the operator then
# promotes it with promote-amendment.sh, which WHOLE-FILE-REPLACES the target — so the draft
# must stay a full copy of the target with your change applied (NOT a description of the change).
#
# Usage: draft-amendment.sh <target-file> "<topic-kebab>"
#   e.g. draft-amendment.sh memory/conventions.md "clean-core-doctrine"
set -euo pipefail
HARNESS="$HARNESS_ROOT"
TARGET="${1:?Usage: draft-amendment.sh <target-file> \"<topic-kebab>\"}"
TOPIC="${2:?topic required (kebab-case, e.g. clean-core-doctrine)}"

[ -f "$TARGET" ] || { echo "Error: no such target file: $TARGET" >&2; exit 1; }
SLUG="$(printf '%s' "$TOPIC" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
[ -n "$SLUG" ] || { echo "Error: topic produced an empty slug" >&2; exit 1; }
OUT="$HARNESS/proposed-amendments/$(date +%F)-${SLUG}.md"
[ -e "$OUT" ] && { echo "Error: already exists: $OUT (pick another topic)" >&2; exit 1; }

cp "$TARGET" "$OUT"   # copy is pi-owned (editable); target is untouched
echo "✅ Drafted: $OUT"
echo "   It is a FULL COPY of $TARGET. Edit it to make your change."
echo "   ⚠️  promote-amendment.sh whole-file-REPLACES the target — keep everything else intact;"
echo "       do NOT turn this into a 'description of the change'."
echo ""
echo "   Next:"
echo "     1. edit       $OUT"
echo "     2. preview     diff -u $TARGET $OUT"
echo "     3. the operator promotes (at a terminal):"
echo "                    $HARNESS/scripts/promote-amendment.sh $OUT $TARGET"
echo "   Undo draft:      rm $OUT"
