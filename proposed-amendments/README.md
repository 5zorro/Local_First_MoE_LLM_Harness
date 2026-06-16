# Proposed amendments — how to change a ROOT-OWNED governance file

Root-owned files (`memory/conventions.md`, the config identity files, the spec) **cannot be edited
directly** — you'll get *permission denied*. That's intentional (Defence in Depth). To change one,
use this workflow. Do **not** confuse it with `scripts/propose-edit.sh`, which is for ordinary CODE
changes (it moves work onto an `agent/proposed-*` git branch for the operator to merge). This directory is
**only** for root-owned governance files.

## Steps

1. **Draft** (agent):
   ```
   scripts/draft-amendment.sh <target-file> "<topic-kebab>"
   # e.g. scripts/draft-amendment.sh memory/conventions.md "clean-core-doctrine"
   ```
   This copies the target into `proposed-amendments/<date>-<topic>.md`. **Edit that copy.**

   ⚠️ **Critical:** the draft must stay a **FULL copy of the target with your change applied** —
   `promote-amendment.sh` *whole-file-replaces* the target. Writing a "description of the change"
   instead of the new file content will overwrite the entire target. (Common first-timer mistake,
   including by frontier models.)

2. **Review** (the operator): read the exact diff that promotion will apply —
   ```
   diff -u <target-file> proposed-amendments/<file>
   ```

3. **Promote** (the operator, at a terminal — tty-gated, the agent CANNOT self-promote):
   ```
   scripts/promote-amendment.sh proposed-amendments/<file> <target-file>
   ```
   Flow: eval-harness must be green → shows diff → type `promote` → backup → (`sudo` for
   root-owned) replace → **re-run eval-harness** → auto-rollback if it now fails.

## Undo
- Discard a draft: `rm proposed-amendments/<file>`
- Undo a promotion: the promote script prints `cp <backup> <target>` (with `sudo` if root-owned).
