// manager-jit — keeps the manager's context fresh without relying on her to run bookkeeping (P2-1)
// and injects only the runbook sections relevant to the current prompt (P1-1 JIT runbook).
//
//   before_prompt_build (manager only):
//     (1) MEMORY: rebuild MEMORY.md iff a source file changed (deterministic, not model-discipline),
//         then inject it via prependSystemContext (cached; refreshes only when it actually changes).
//     (2) RUNBOOK: select the sections relevant to event.prompt under a byte budget and inject via
//         appendSystemContext, so a long MANAGER-RUNBOOK.md never blows the small model's context.
//   Fail-OPEN: any error is caught/logged and the turn proceeds (can't wedge the gateway).
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseRunbook, selectSections, renderRunbook, resolveAgentId } from "./lib.js";

const LOG = "/tmp/manager-jit.log";
const HARNESS = process.env.HARNESS_ROOT || "/home/pi/agent-harness";
const RUNBOOK = HARNESS + "/memory/MANAGER-RUNBOOK.md";
const OPENCLAW_WS = process.env.OPENCLAW_WORKSPACE || ((process.env.OPENCLAW_HOME || ((process.env.HOME || "/home/pi") + "/.openclaw")) + "/workspace");
const MEMORY = OPENCLAW_WS + "/MEMORY.md";
const BUILD = HARNESS + "/scripts/build-manager-memory.sh";
const SRC = ["todos.md", "scratch.md", "decisions.md"].map((f) => HARNESS + "/memory/" + f);

function log(tag, obj) { try { appendFileSync(LOG, `${new Date().toISOString()} ${tag} ${JSON.stringify(obj)}\n`); } catch {} }
function mtime(p) { try { return statSync(p).mtimeMs; } catch { return 0; } }

let cachedRunbook = null, cachedRunbookMtime = -1;
function getRunbook() {
  const mt = mtime(RUNBOOK);
  if (cachedRunbook === null || mt !== cachedRunbookMtime) {
    try { cachedRunbook = parseRunbook(readFileSync(RUNBOOK, "utf8")); cachedRunbookMtime = mt; }
    catch (e) { log("runbook-read-err", { e: String(e) }); cachedRunbook = []; }
  }
  return cachedRunbook;
}

function refreshMemory() {
  try {
    const newest = Math.max(0, ...SRC.map(mtime));
    const before = mtime(MEMORY);
    if (newest > before) {
      // build-manager-memory.sh writes MEMORY.md but exits 141 (SIGPIPE from a `head` in a pipe),
      // so don't treat a nonzero exit as failure — check whether the file actually advanced.
      try { execFileSync("bash", [BUILD], { timeout: 15000, stdio: "ignore" }); } catch {}
      const after = mtime(MEMORY);
      log(after > before ? "memory-rebuilt" : "memory-rebuild-noop", { newest, before, after });
    }
  } catch (e) { log("memory-rebuild-err", { e: String(e) }); }
  try { return existsSync(MEMORY) ? readFileSync(MEMORY, "utf8") : ""; } catch { return ""; }
}

export default definePluginEntry({
  id: "manager-jit",
  name: "Manager JIT memory + runbook",
  register(api, ctx) {
    const cfg = (ctx && ctx.config) || {};
    const onlyAgent = cfg.agentId || "main";
    const byteBudget = cfg.runbookByteBudget || 6000;
    // Runbook injection duplicates the protocol that still lives in SOUL.md until SOUL is slimmed,
    // so it can be turned off to avoid bloating a small model's context. Memory refresh stays on.
    const injectRunbook = cfg.injectRunbook !== false; // default on

    api.on("before_prompt_build", async (event, hookCtx) => {
      try {
        const agent = resolveAgentId(hookCtx);
        if (agent && agent !== onlyAgent) { log("skip-agent", { agent }); return; } // experts/cloud unaffected

        const prompt = String((event && event.prompt) || "");
        const mem = refreshMemory();
        const result = {};
        if (mem) result.prependSystemContext = "# Current harness memory (auto-refreshed on change)\n\n" + mem;
        if (injectRunbook) {
          const sel = selectSections(getRunbook(), prompt, { byteBudget });
          const runbook = renderRunbook(sel);
          if (runbook) result.appendSystemContext = runbook;
          log("inject", { agent: agent || "?", memBytes: mem.length, sections: sel.selected.map((s) => s.tag), truncated: sel.truncated });
        } else {
          log("inject", { agent: agent || "?", memBytes: mem.length, runbook: "off" });
        }
        return result;
      } catch (e) { log("err", { e: String(e) }); return; } // fail-open
    }, { priority: 50 });
  },
});
