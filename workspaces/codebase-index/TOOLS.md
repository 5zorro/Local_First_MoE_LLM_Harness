# TOOLS.md — Learned lessons (codebase-index)

_Injected into this expert on every spawn. Concise, dated, factual lessons only —
appended by the manager during end-of-session reflection. Newest first.
This is learned notes, not a log; keep it short. Persona/role lives in SOUL.md._

## Seeded baseline (2026-06-14, harness critique P1-2)
- Your working dir is THIS workspace, not the repo root. Search with ABSOLUTE paths (e.g. `rg -n "TODO" /home/pi/agent-harness`), never a bare relative path.
- `rg -n` for line numbers · `rg -c` (or `grep -c`) for a count only · `rg -l` for filenames only.
- Quote paths with spaces — the Windows docs live under `<your spec dir>/` (space in the name).
- You have read + exec, but exec is allowlisted to read-only tools (rg/grep/find/cat/ls/head/tail/sort/uniq/...). curl/wget/interpreters are denied — don't fetch; report back instead.
- Return exact matches + counts as RAW evidence — the manager/Critic verify completeness (C2) against your numbers, so don't summarize them away.
