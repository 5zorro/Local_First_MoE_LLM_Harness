# agent-harness

A **local-first, multi-agent AI harness** for [OpenClaw](https://openclaw.ai). A single **manager**
agent reads intent, plans, and **delegates to specialist expert sub-agents**, gating results through a
read-only Critic — with privacy/security guardrails designed for small local models that "fail fast."

This is a **reference implementation** extracted from a working personal setup; the operator's data
and network details are removed. The example agent personas are intentionally generic — name them
yourself.

## What's interesting here
- **Manager-of-experts (hub-and-spoke).** The manager delegates to read-only/limited experts
  (`codebase-index`, `tool-use`, `todo-expert`, `identity-keeper`, `ops-expert`, `critic`); experts
  can't talk to each other or the user — they report only to the manager. (`workspaces/*/`)
- **Untrusted-input firewall.** The manager has **no** web tools; all external content comes through
  the `tool-use` expert (read + web only, no write/exec), so injected instructions die there.
- **Read-only Critic on a different model family** gates every write/exec/send/todo turn (`workspaces/critic/`).
- **Three plugins** (`plugins/`):
  - `manager-jit` — rebuilds memory on change and injects only the **prompt-relevant** sections of
    `MANAGER-RUNBOOK.md` (just-in-time), keeping a small model's context lean.
  - `web-allowlist` — mechanical `web_fetch` egress allowlist at the tool layer.
  - `groundcheck` — forces a real file read before answering about a referenced file.
- **Auditable memory tiers** + a Critic-gated, eval-gated amendment workflow (`memory/`, `scripts/`,
  `proposed-amendments/`), an injection canary (`canary/`), and a 3-strike bug-bounty (`bug-bounty/`).
- **Fail-closed privacy.** The local manager's model chain never escalates to cloud; an optional cloud
  "sibling" agent is filesystem-scoped (`tools.fs.workspaceOnly`) so it can't read the private workspace.

## Requirements
- OpenClaw `>= 2026.6.x`
- [Ollama](https://ollama.com) for local models (and/or a cloud provider key)
- Linux / WSL2

## Paths & portability (env vars)
Two environment variables control where things live:
- **`HARNESS_ROOT`** — this repo's location. Scripts and the `manager-jit` plugin auto-detect/honor it
  at runtime (default `/home/pi/agent-harness`).
- **`OPENCLAW_WORKSPACE`** — the manager's OpenClaw workspace (default `$HOME/.openclaw/workspace`).

The OpenClaw config (JSON) and the model-facing prompt docs are read **literally** and can't expand
env vars, so run **`scripts/configure.sh`** once after cloning — it stamps your real paths into them
(it auto-detects `HARNESS_ROOT` from the clone location; override via the env vars above).

## Setup (short)
1. Clone, then run `scripts/configure.sh` (stamps paths for your clone location).
2. `cp config/openclaw.template.json ~/.openclaw/openclaw.json` and fill every `YOUR_*` / `REPLACE_*`
   placeholder (Ollama host, models, gateway token, optional Matrix channel).
3. `cp config/manager-SOUL.template.md ~/.openclaw/workspace/SOUL.md` and make the persona your own.
4. If your models run in **Ollama on Windows** while the harness is in WSL, follow
   **[`docs/ollama-on-windows.md`](docs/ollama-on-windows.md)** (the most common setup gotcha).
5. Read **`SETUP.md`** for the full steps (permissions, first memory build, verify).
6. Verify: `openclaw gateway restart`, then `scripts/eval-harness.sh` (expect 0 failures) and
   `scripts/validate-model-config.sh` (your config vs. what Ollama actually reports).

## Customize
- Name your manager and (optional) cloud-sibling personas in their workspace `SOUL.md` files and in
  `config/openclaw.template.json`.
- Set your own models; the **manager and Critic should be different model families**.
- Behavioral rules: `memory/conventions.md` (single source of truth). Manager protocol:
  `memory/MANAGER-RUNBOOK.md`.

## Tests
`node plugins/web-allowlist/test.mjs` and `node plugins/manager-jit/test.mjs`.

## What was intentionally left out
The operator's runtime brain and project specifics (decision log, goals/todos, debriefs, business
code) and all network details were removed when extracting this reference. Memory files ship as empty
templates and fill with your own state as you use it.

## License
MIT — see `LICENSE`.
