#!/bin/bash
# notify-windows.sh — pop a Windows dialog from WSL so the operator knows to look (msg.exe is the one method that
# renders reliably here; NotifyIcon balloons and WinRT toasts were suppressed). Local interop, no network.
#   ./scripts/notify-windows.sh "the agent is waiting on an exec approval — open the gateway."
set -uo pipefail
MSG="${*:-Agent Harness needs your attention — open the gateway.}"
MSGEXE="/mnt/c/Windows/System32/msg.exe"
command -v "$MSGEXE" >/dev/null 2>&1 || MSGEXE="msg.exe"   # fall back to PATH
exec "$MSGEXE" '*' "Agent Harness: $MSG"
