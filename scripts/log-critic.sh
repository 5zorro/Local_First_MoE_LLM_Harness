#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# log-critic.sh — append a Critic verdict to critic-log.md (audit trail, A9/A13/A14).
# Usage:
#   log-critic.sh PASS   "<turn summary>"
#   log-critic.sh FAIL   "<turn summary>" "C2,C5"
#   log-critic.sh BYPASS "<turn summary>" "trivial: greeting"
set -euo pipefail

LOG="$HARNESS_ROOT/memory/critic-log.md"
VERDICT="${1:-}"
SUMMARY="${2:-}"
DETAIL="${3:-}"

case "$VERDICT" in
  PASS|FAIL|BYPASS) ;;
  *) echo "Usage: $0 PASS|FAIL|BYPASS \"<summary>\" [\"<checks-or-reason>\"]" >&2; exit 1 ;;
esac
[ -z "$SUMMARY" ] && { echo "Error: summary required" >&2; exit 1; }

TS="$(date '+%Y-%m-%d %H:%M')"
case "$VERDICT" in
  PASS)   MARK="✅ PASS" ;;
  FAIL)   MARK="❌ FAIL [${DETAIL}]" ;;
  BYPASS) MARK="⏭️  BYPASS (${DETAIL})" ;;
esac

printf '%s | %s | %s\n' "$TS" "$MARK" "$SUMMARY" >> "$LOG"
echo "[log-critic] $MARK — $SUMMARY"
