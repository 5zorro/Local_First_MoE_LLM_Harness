#!/bin/bash
# configure.sh — stamp this clone's real paths into the files that are read LITERALLY
# (the OpenClaw config template + the model-facing prompt docs). Scripts and the manager-jit
# plugin read HARNESS_ROOT / OPENCLAW_WORKSPACE from the environment at runtime, so they do NOT
# need stamping — but the config JSON and the markdown the model reads cannot expand env vars.
#
# Paths come from env vars (with sensible auto-detected defaults):
#   HARNESS_ROOT       (default: this clone's directory)
#   OPENCLAW_HOME      (default: $HOME/.openclaw)
#   OPENCLAW_WORKSPACE (default: $OPENCLAW_HOME/workspace)
#
# Run once after cloning (or after moving the clone). Idempotent.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # where the repo files actually live
HARNESS_ROOT="${HARNESS_ROOT:-$SELF}"                      # value to stamp (default: here)
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"

echo "Stamping paths into config + prompt docs:"
echo "  HARNESS_ROOT       = $HARNESS_ROOT"
echo "  OPENCLAW_HOME      = $OPENCLAW_HOME"
echo "  OPENCLAW_WORKSPACE = $OPENCLAW_WORKSPACE"

files=(
  config/openclaw.template.json
  memory/MANAGER-RUNBOOK.md
  memory/agent.bootstrap.md
  memory/conventions.md
  SETUP.md
)
for rel in "${files[@]}"; do
  f="$SELF/$rel"
  [ -f "$f" ] || continue
  # most-specific first; workspace before the broader .openclaw home
  sed -i \
    -e "s#/home/pi/.openclaw/workspace#$OPENCLAW_WORKSPACE#g" \
    -e "s#/home/pi/.openclaw#$OPENCLAW_HOME#g" \
    -e "s#/home/pi/agent-harness#$HARNESS_ROOT#g" \
    "$f"
  echo "  stamped $rel"
done

echo
echo "Done. Next: cp config/openclaw.template.json \"$OPENCLAW_HOME/openclaw.json\", fill the"
echo "YOUR_*/REPLACE_* placeholders, then 'openclaw gateway restart'. If you run from a"
echo "non-default shell, export HARNESS_ROOT and OPENCLAW_WORKSPACE so the scripts/plugin agree."
