# Setup — stand up the harness from a fresh clone

This repo is the version-controlled **framework**. The live OpenClaw gateway reads config from
`~/.openclaw/` and the manager's workspace; this repo provides templates + the agents' brains.

## What's where
- **In this repo:** `scripts/`, `plugins/` (manager-jit, web-allowlist, groundcheck),
  `workspaces/<expert>/{SOUL,AGENTS,TOOLS}.md`, `memory/` (conventions, agent.bootstrap, the JIT
  runbook, + empty working-memory templates), `evals/`, `canary/`, `bug-bounty/`, `proposed-amendments/`.
- **Templates you copy out:** `config/openclaw.template.json` → `~/.openclaw/openclaw.json`;
  `config/manager-SOUL.template.md` → `~/.openclaw/workspace/SOUL.md`.
- **NOT in the repo (you provide):** real secrets (gateway token, provider API keys, any Matrix
  tokens), and your own runtime memory/goals/todos (the shipped ones are blank templates).

## Steps
1. **Clone** anywhere, then set paths:
   ```bash
   # optional overrides; both auto-default if you skip them:
   export HARNESS_ROOT="$(pwd)"               # this clone
   export OPENCLAW_WORKSPACE="$HOME/.openclaw/workspace"
   scripts/configure.sh                        # stamps these paths into the config + prompt docs
   ```
   (Scripts and the `manager-jit` plugin read `HARNESS_ROOT`/`OPENCLAW_WORKSPACE` from the environment
   at runtime; `configure.sh` handles the files that are read literally.)
2. **Gateway config:** `cp config/openclaw.template.json ~/.openclaw/openclaw.json`, then fill every
   `YOUR_*` / `REPLACE_*` placeholder — Ollama `baseUrl`, your models, a random `gateway.auth.token`,
   and (optional) the Matrix channel. Generate a token with e.g. `openssl rand -hex 24`.
3. **Manager persona:** `cp config/manager-SOUL.template.md ~/.openclaw/workspace/SOUL.md` and name it.
4. **Ollama on Windows + WSL?** Follow `docs/ollama-on-windows.md` (listen on `0.0.0.0`, reach the
   Windows host IP, open the firewall).
5. **Permissions** (root-owned canon so the agent can't self-edit it): review and run
   `sudo scripts/harness-init-permissions.sh`.
6. **First memory build:** `scripts/build-manager-memory.sh`.
7. **Start + verify:**
   ```bash
   openclaw gateway restart
   scripts/eval-harness.sh            # expect 0 failures
   scripts/validate-model-config.sh   # your config vs. what Ollama reports
   openclaw agents list               # main + experts (+ optional cloud sibling)
   ```

## Models
- Manager: a capable **local** model; Critic: a **different model family** (two heads, two blind spots).
- Keep the manager's fallback chain all-local if privacy matters; put any cloud model on a separate
  agent and scope it with `tools.fs.workspaceOnly: true`.
- `scripts/validate-model-config.sh` warns when a model's `num_ctx`/`contextWindow` disagree with what
  Ollama actually serves.

## Keeping config reproducible
After changing live config, `scripts/snapshot-config.sh` re-exports a secret-scrubbed snapshot into
`config/`. (Re-run `scripts/configure.sh` if you ever move the clone.)
