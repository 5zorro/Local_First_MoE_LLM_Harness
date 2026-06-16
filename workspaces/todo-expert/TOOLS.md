# TOOLS.md — Learned lessons (todo-expert)

_Injected into this expert on every spawn. Concise, dated, factual lessons only —
appended by the manager during end-of-session reflection. Newest first.
This is learned notes, not a log; keep it short. Persona/role lives in SOUL.md._

## Seeded baseline (2026-06-14, harness critique P1-2)
- Edit by ABSOLUTE path with your write/edit tools: `/home/pi/agent-harness/memory/todos.md`. A bare `todos.md` resolves against your workspace and fails (ENOENT).
- Format: `- [ ]` open · `- [x]` done · `- [~]` partial. A todo that serves a goal carries a `goal:G<n>` tag so it rolls up to its goal.
- Do NOT use shell (`sed`/`echo >>`/`tee`) to edit files — those hit the exec gate and get denied, wasting the turn. Use the write/edit tools only.
- Mark done / add new / reprioritize; don't rewrite history or churn wording. Keep entries terse.
