#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# plan.sh — append-only helper for the Landmark -> Goal -> Todo planning hierarchy.
# Tiers: memory/landmarks.md (vision) -> memory/goals.md (SMART) -> memory/todos.md (chores).
# Mirrors append-decision.sh: append-only, with a grew-check so a silent failure can't pass.
#
# Usage:
#   plan.sh landmark "<title>: <vision text>"
#   plan.sh goal --landmark L1 "<objective> | done: <measurable test> | by: <when>"
#   plan.sh todo --goal G1 "<todo text>"
#   plan.sh status
set -euo pipefail

MEM="$HARNESS_ROOT/memory"
LANDMARKS="$MEM/landmarks.md"
GOALS="$MEM/goals.md"
TODOS="$MEM/todos.md"

die(){ echo "Error: $*" >&2; exit 1; }

append(){ # <file> <line...> ; append-only with grow-check (same safety as append-decision.sh)
  local f="$1"; shift
  [ -f "$f" ] || die "$f does not exist"
  local before after; before=$(wc -c < "$f")
  printf '%s\n' "$@" >> "$f"
  after=$(wc -c < "$f")
  [ "$after" -gt "$before" ] || die "append to $f did not grow the file (permissions?)"
}

next_id(){ # <file> <prefix L|G> -> next free id like L3 / G7
  local f="$1" p="$2" n
  n=$(grep -oE "^## ${p}[0-9]+" "$f" 2>/dev/null | grep -oE '[0-9]+' | sort -n | tail -1 || true)
  echo "${p}$(( ${n:-0} + 1 ))"
}

cmd="${1:-status}"; shift || true
case "$cmd" in
  landmark)
    text="${1:?Usage: plan.sh landmark \"<title>: <vision>\"}"
    id=$(next_id "$LANDMARKS" L)
    if [[ "$text" == *:* ]]; then title="${text%%:*}"; vision="${text#*:}"; vision="${vision# }";
    else title="$text"; vision="(fill in)"; fi
    append "$LANDMARKS" "" "## $id — $title" "Status: active" "Vision: $vision" "Goals: see goals.md tagged [[$id]]"
    echo "✅ added landmark $id — $title"
    ;;
  goal)
    [ "${1:-}" = "--landmark" ] || die "Usage: plan.sh goal --landmark L<n> \"<objective> | done: <test> | by: <when>\""
    lm="$2"; shift 2 || true
    grep -qE "^## ${lm} " "$LANDMARKS" || die "landmark $lm not found in landmarks.md (run: plan.sh status)"
    text="${1:?objective text required}"
    id=$(next_id "$GOALS" G)
    append "$GOALS" "" "## $id — $text  [[$lm]]" "Status: active  ($(date +%F))" "Todos: tagged goal:$id in todos.md"
    echo "✅ added goal $id under $lm"
    ;;
  todo)
    [ "${1:-}" = "--goal" ] || die "Usage: plan.sh todo --goal G<n> \"<text>\""
    g="$2"; shift 2 || true
    grep -qE "^## ${g} " "$GOALS" || die "goal $g not found in goals.md (run: plan.sh status)"
    text="${1:?todo text required}"
    append "$TODOS" "- [ ] $text  goal:$g"
    echo "✅ added todo under $g"
    ;;
  status)
    echo "=== Plan hierarchy (Landmark → Goal → Todo) ==="
    while IFS= read -r lmline; do
      lid=$(printf '%s' "$lmline" | grep -oE 'L[0-9]+' | head -1)
      echo ""; echo "◆ ${lmline#'## '}"
      while IFS= read -r g; do
        [ -z "$g" ] && continue
        gid=$(printf '%s' "$g" | grep -oE 'G[0-9]+' | head -1)
        total=$(grep -cE "goal:${gid}([^0-9]|$)" "$TODOS" 2>/dev/null || true)
        open=$(grep -E "goal:${gid}([^0-9]|$)" "$TODOS" 2>/dev/null | grep -c '^- \[ \]' || true)
        echo "   ▸ ${g#'## '}    [todos: ${total:-0}, ${open:-0} open]"
      done < <(grep -E "^## G[0-9]+.*\[\[${lid}\]\]" "$GOALS" 2>/dev/null || true)
    done < <(grep -E "^## L[0-9]+" "$LANDMARKS" 2>/dev/null || true)
    orphans=$(grep -E "^## G[0-9]+" "$GOALS" 2>/dev/null | grep -vE "\[\[L[0-9]+\]\]" || true)
    [ -n "$orphans" ] && { echo ""; echo "⚠ goals with no landmark:"; printf '%s\n' "$orphans" | sed 's/^## /   /'; }
    echo ""
    ;;
  *) die "unknown command '$cmd' (use: landmark | goal | todo | status)";;
esac
