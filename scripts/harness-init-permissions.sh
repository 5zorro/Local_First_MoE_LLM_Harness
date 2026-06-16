#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# harness-init-permissions.sh
# Sets ownership and permissions for the harness repo per spec §3.9.
# Run as root: sudo $HARNESS_ROOT/scripts/harness-init-permissions.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: must run as root. Use: sudo $0" >&2
  exit 1
fi

HARNESS="$HARNESS_ROOT"
MEM="$HARNESS/memory"

echo "Setting harness permissions..."

# root:root 0644 — agent (pi) cannot write; only the operator via sudo
chown root:root "$MEM/agent.bootstrap.md" && chmod 0644 "$MEM/agent.bootstrap.md"
echo "  root:root 0644  memory/agent.bootstrap.md"

chown root:root "$MEM/conventions.md" && chmod 0644 "$MEM/conventions.md"
echo "  root:root 0644  memory/conventions.md"

# root:pi 0664 — pi can append but not own; append-decision.sh enforces append-only
chown root:pi "$MEM/decisions.md" && chmod 0664 "$MEM/decisions.md"
echo "  root:pi  0664   memory/decisions.md"

# pi:pi 0644 — agent working memory
for f in todos.md scratch.md tool-tricks.md ops-log.md critic-log.md; do
  if [ -f "$MEM/$f" ]; then
    chown pi:pi "$MEM/$f" && chmod 0644 "$MEM/$f"
    echo "  pi:pi    0644   memory/$f"
  fi
done

# scripts: pi:pi 0755
for s in "$HARNESS/scripts/"*.sh; do
  chown pi:pi "$s" && chmod 0755 "$s"
  echo "  pi:pi    0755   scripts/$(basename "$s")"
done

echo ""
echo "Done. Verify:"
ls -l "$MEM"
