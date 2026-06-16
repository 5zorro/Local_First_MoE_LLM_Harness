# TOOLS.md — Learned lessons (ops-expert)

_Injected into this expert on every spawn. Concise, dated, factual lessons only —
appended by the manager during end-of-session reflection. Newest first.
This is learned notes, not a log; keep it short. Persona/role lives in SOUL.md._

## Seeded baseline (2026-06-14, harness critique P1-2)
- Your cwd is THIS workspace — use ABSOLUTE paths for anything outside it.
- You are network-locked: curl/wget/interpreters are NOT allowlisted and fail closed. Don't attempt fetches; report that web work needs the tool-use expert.
- Allowlisted shell only (ls/cat/grep/rg/find/git/systemctl/journalctl/mkdir/touch/cp/mv/chmod/diff/...). A denied command = off-allowlist: switch tools or report; never hammer a denied command.
- Every git command: explain it + state the undo BEFORE running. Prefer `git switch` over `checkout`, `--ff-only` over `--no-ff`; never `--force`/`--hard` without the operator's explicit confirmation; surface `git reflog` after any destructive op.
- Log shell ops to `/home/pi/agent-harness/memory/ops-log.md`.
