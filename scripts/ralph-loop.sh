#!/bin/bash
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-$OPENCLAW_HOME/workspace}"
# ralph-loop.sh — run a long task as many small, checkpointed, self-replanning iterations.
#
# EACH ITERATION (one bounded turn to the manager):
#   A. ORIENT   — read checkpoint (scratch.md) + the live plan (ralph/plan.md) + last Critic note
#   B. RE-PLAN  — rewrite ralph/plan.md: add tasks learned last step + from Critic, re-prioritize
#   C. ACT      — do the SINGLE top task (delegate big/untrusted reads to experts)
#   D. CHECKPOINT — overwrite scratch.md with current state
#   E. DONE-GATE — only if GOAL's DONE WHEN met: Critic must ✅, then debrief + ralph/DONE + RALPH_DONE
# The loop also runs an OBJECTIVE acceptance check (GOAL.md "## DONE CHECK") before trusting "done",
# detects stalls (no checkpoint change), and stops on RALPH_DONE / ralph/STOP / Ctrl-C / iteration cap.
#
# YOU NORMALLY ONLY EDIT ralph/GOAL.md. Run:  ./scripts/ralph-loop.sh
#   ./scripts/ralph-loop.sh [goal-file] [max-iters] [interval-seconds]   (defaults: GOAL.md 15 8)
set -uo pipefail

HARNESS="$HARNESS_ROOT"
GOAL_FILE="${1:-$HARNESS/ralph/GOAL.md}"
MAX_ITERS="${2:-15}"
INTERVAL="${3:-8}"
AGENT="main"
STOP_FILE="$HARNESS/ralph/STOP"
DONE_FILE="$HARNESS/ralph/DONE"
PLAN="$HARNESS/ralph/plan.md"
SCRATCH="$HARNESS/memory/scratch.md"
ITER_TIMEOUT=600       # seconds per turn
STALL_LIMIT=3          # consecutive no-change iterations before giving up
MAX_FALSE_DONE=2       # times to tolerate "claimed done" that fails the acceptance check

[ -f /home/pi/.config/harness/env ] && { set -a; . /home/pi/.config/harness/env; set +a; }
[ -f "$GOAL_FILE" ] || { echo "No goal file: $GOAL_FILE" >&2; exit 1; }
command -v openclaw >/dev/null || { echo "openclaw not on PATH" >&2; exit 1; }

RUN_ID="$(date +%Y%m%d-%H%M%S)"
SESSION="ralph-live"                 # STABLE id — open the "ralph-live" session in the web UI to watch
LOG="$HARNESS/ralph/run-$RUN_ID.log"
LOCK="$HARNESS/ralph/.running"       # presence + PID = a loop is running (see ralph-status.sh)
GOAL="$(cat "$GOAL_FILE")"
rm -f "$STOP_FILE" "$DONE_FILE" "$PLAN"
trap 'rm -f "$LOCK"' EXIT INT TERM
printf 'RUNNING | run %s | pid %s | starting | log %s\n' "$RUN_ID" "$$" "$LOG" > "$LOCK"

# Optional objective acceptance test from GOAL.md "## DONE CHECK" (shell; exit 0 = done).
DONE_CHECK="$(awk '/^## *DONE CHECK/{f=1;next} /^## /{f=0} f' "$GOAL_FILE" | sed '/^[[:space:]]*$/d;/^[[:space:]]*#/d')"

accept_check() {  # 0 = accept "done"; non-zero = reject
  [ -z "$DONE_CHECK" ] && return 0
  bash -c "$DONE_CHECK" >/dev/null 2>&1
}
extract_reply() {
  python3 -c "
import sys,json
try:
    d=json.load(sys.stdin); pls=d.get('result',{}).get('payloads',[])
    print(' '.join(p.get('text','') for p in pls).strip() or d.get('reply','') or '')
except Exception: print('')
"
}
sig() { cat "$SCRATCH" "$PLAN" 2>/dev/null | md5sum | cut -d' ' -f1; }

echo "Ralph loop starting"
echo "  goal : $GOAL_FILE     session: $SESSION"
echo "  caps : $MAX_ITERS iters, ${INTERVAL}s apart, stall=$STALL_LIMIT"
echo "  done check: ${DONE_CHECK:-(none — relies on Critic + DONE marker)}"
echo "  log  : $LOG     stop: touch $STOP_FILE (or Ctrl-C)"
echo "  watch: web UI session 'ralph-live'   ·   terminal: ./scripts/ralph-status.sh"
echo "-------------------------------------------"

done=0; prev_sig=""; stall=0; false_done=0
for i in $(seq 1 "$MAX_ITERS"); do
  [ -f "$STOP_FILE" ] && { echo "[stop] STOP file present."; rm -f "$STOP_FILE"; break; }
  printf 'RUNNING | run %s | pid %s | iter %s/%s | working since %s | top: %s\n' \
    "$RUN_ID" "$$" "$i" "$MAX_ITERS" "$(date '+%H:%M:%S')" \
    "$(grep -m1 -E '^[-*0-9]' "$PLAN" 2>/dev/null | cut -c1-70)" > "$LOCK"

  PROMPT="You are iteration $i of a Ralph loop — autonomous, unattended. One bounded turn toward this GOAL:

=== GOAL.md ===
$GOAL
=== end GOAL.md ===

Do these phases this turn:
A. ORIENT — read (absolute paths) $HARNESS_ROOT/memory/scratch.md (current state) and $HARNESS_ROOT/ralph/plan.md (your live task list; may not exist on iteration 1). Note any Critic feedback from last iteration.
B. RE-PLAN — OVERWRITE $HARNESS_ROOT/ralph/plan.md with your current candidate task list toward the GOAL: ADD tasks you discovered from the last step's result and from any Critic feedback, DROP completed ones, and SORT so the single most important/unblocking task is first. It is a whiteboard — rewrite, do not append.
C. ACT — do the SINGLE top task from plan.md. Delegate LARGE or UNTRUSTED reads to the tool-use / codebase-index experts (keeps your context lean); do trivial trusted-local reads yourself. Do not attempt the whole goal in one turn.
D. CHECKPOINT — OVERWRITE $HARNESS_ROOT/memory/scratch.md with your current state (goal, what you just did, the next top task), using write/edit tools (absolute paths, never shell).
E. DONE-GATE — ONLY if the GOAL's 'DONE WHEN' is fully met: spawn the critic (model ollama/gpt-oss:20b) to verify the OUTPUT against 'DONE WHEN'; log the verdict via $HARNESS_ROOT/scripts/log-critic.sh. If the Critic returns ❌, fix the gaps and do NOT finish. If ✅: write the debrief via $HARNESS_ROOT/scripts/write-debrief.sh, create the marker $HARNESS_ROOT/ralph/DONE (write tool), and reply RALPH_DONE.
Otherwise reply with a ONE-LINE status: what you did + the next top task. Do not ask questions — unattended."

  echo "[iter $i] $(date '+%H:%M:%S') working..." | tee -a "$LOG"
  REPLY="$(timeout "$ITER_TIMEOUT" openclaw agent --agent "$AGENT" --session-id "$SESSION" -m "$PROMPT" --json 2>>"$LOG" | extract_reply)"
  echo "[iter $i] reply: ${REPLY:-(yielded / none — see checkpoint)}" | tee -a "$LOG"
  echo "[iter $i] plan-top: $(grep -m1 -E '^[-*0-9]' "$PLAN" 2>/dev/null)" | tee -a "$LOG"
  echo "[iter $i] state  : $(tail -n1 "$SCRATCH" 2>/dev/null)" | tee -a "$LOG"

  # completion: agent claims done -> verify objectively before trusting it
  if [ -f "$DONE_FILE" ] || printf '%s' "$REPLY" | grep -q 'RALPH_DONE'; then
    if accept_check; then
      echo "[done] goal complete + acceptance check passed at iteration $i." | tee -a "$LOG"
      done=1; break
    else
      false_done=$((false_done+1)); rm -f "$DONE_FILE"
      echo "[reject] agent claimed done but DONE CHECK failed (attempt $false_done/$MAX_FALSE_DONE) — continuing." | tee -a "$LOG"
      [ "$false_done" -ge "$MAX_FALSE_DONE" ] && { echo "[stop] repeated false 'done' — stopping for human review." | tee -a "$LOG"; break; }
    fi
  fi

  # stall detection: no change to plan/scratch across STALL_LIMIT iterations
  cur_sig="$(sig)"
  if [ "$cur_sig" = "$prev_sig" ]; then stall=$((stall+1)); else stall=0; fi
  prev_sig="$cur_sig"
  [ "$stall" -ge "$STALL_LIMIT" ] && { echo "[stall] no checkpoint change in $STALL_LIMIT iterations — stopping." | tee -a "$LOG"; break; }

  sleep "$INTERVAL"
done

echo "==========================================="
if [ "$done" -eq 1 ]; then
  echo "✅ RALPH COMPLETE  (iteration-driven, Critic-gated)"
  echo "   output  : $(ls -1 "$HARNESS"/ralph/output.md 2>/dev/null || echo '(see GOAL OUTPUT location)')"
  echo "   debrief : $(ls -1t "$HARNESS"/debriefs/*.md 2>/dev/null | head -1 || echo '(none found)')"
  echo "   log     : $LOG"
else
  echo "⚠️  RALPH STOPPED without completion (cap / stall / stop / false-done)."
  echo "   Check the live plan: $PLAN"
  echo "   Current state      : $SCRATCH"
  echo "   Log                : $LOG"
fi