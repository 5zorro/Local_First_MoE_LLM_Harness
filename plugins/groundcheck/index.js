// groundcheck — deterministic grounding gate.
// If the user referenced a file/document/scripture and the agent produced a final
// answer WITHOUT reading any file, force one more model pass that requires a read.
// Fail-open: any error in this plugin is swallowed so it can never break a reply.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync } from "node:fs";

const LOG = "/tmp/groundcheck.log";
function log(tag, obj) { try { appendFileSync(LOG, `${new Date().toISOString()} ${tag} ${JSON.stringify(obj)}\n`); } catch {} }

const runs = new Map();
let lastRec = null; // single-slot fallback when per-run ids aren't exposed on the event
const TTL = 10 * 60 * 1000;
function gc() { const now = Date.now(); for (const [k, v] of runs) if (now - v.ts > TTL) runs.delete(k); }
function idsFrom(event) {
  const c = (event && event.context) || {};
  return [c.runId, event && event.runId, c.sessionKey, event && event.sessionKey, c.sessionId, event && event.sessionId].filter(Boolean);
}
function getRec(event) {
  for (const k of idsFrom(event)) { const r = runs.get(k); if (r) return r; }
  return lastRec; // fall back to the most recent run when no id matched
}
function keyDump(event) {
  try { return { evk: Object.keys(event || {}), ctxk: Object.keys((event && event.context) || {}) }; } catch { return {}; }
}

// tools / exec commands that count as actually reading a file
const READ_TOOLS = new Set(["read", "file_fetch", "dir_fetch", "dir_list", "view", "open", "cat"]);
const READ_EXEC = /(^|[^a-z])(cat|less|more|head|tail|rg|grep|egrep|fgrep|ag|fd|find|sed|awk|cut|nl|bat|stat|jq|xxd|od|strings|ls|tree)([^a-z]|$)/i;

// does the user's prompt point at a file/document/scripture that must be read?
function referencesFile(text) {
  if (!text) return false;
  const t = String(text);
  if (/(^|\s)[~./][^\s]*\.[a-z0-9]{1,5}(\s|$)/i.test(t)) return true;                                   // ./x.md  ~/a/b.txt
  if (/\b[\w .'-]+\.(md|markdown|txt|pdf|docx?|csv|tsv|json|ya?ml|log|html?|rtf|org|tex|xml|ini|conf)\b/i.test(t)) return true; // name.ext
  if (/\b\d?\s?(ne(phi)?|nephi|alma|mosiah|moroni|mormon|jacob|enos|jarom|omni|helaman|ether|abinadi|moses|abr(aham)?|d&c|john|matt(hew)?|mark|luke|acts|romans?|isaiah|psalms?|prov(erbs)?|gen(esis)?|ex(odus)?|rev(elation)?)\.?\s*\d{1,3}(:\d{1,3})?/i.test(t)) return true; // scripture ref
  if (/\b(read|reading|open|look(ed)? at|review|check|study|studied|in)\b[^.?!]{0,40}\b(file|document|doc|chapter|verse|passage|scripture|note|notes|page|book)\b/i.test(t)) return true;
  return false;
}

export default definePluginEntry({
  id: "groundcheck",
  name: "Ground Check",
  register(api) {
    api.on("before_agent_run", async (event) => {
      try {
        const ids = idsFrom(event);
        const id = ids[0] || ("t" + Date.now());
        const rec = { id, prompt: String((event && event.prompt) || ""), readUsed: false, ts: Date.now() };
        for (const k of (ids.length ? ids : [id])) runs.set(k, rec);
        lastRec = rec;
        gc();
        log("run", { id, refs: referencesFile(rec.prompt), prompt: rec.prompt.slice(0, 120), ...keyDump(event) });
      } catch (e) { log("err-run", { e: String(e) }); }
    }, { priority: 50 });

    api.on("after_tool_call", async (event) => {
      try {
        const rec = getRec(event);
        const tool = String((event && event.toolName) || "");
        if (!rec) { log("tool-norec", { tool }); return; }
        if (READ_TOOLS.has(tool)) { rec.readUsed = true; log("tool-read", { tool }); return; }
        if (tool === "exec") {
          const blob = JSON.stringify((event && event.params) || "");
          if (READ_EXEC.test(blob)) { rec.readUsed = true; log("tool-execread", { blob: blob.slice(0, 140) }); }
        }
      } catch (e) { log("err-tool", { e: String(e) }); }
    }, { priority: 50 });

    api.on("before_agent_finalize", async (event) => {
      try {
        const rec = getRec(event);
        if (!rec) { log("final-norec", { ids: idsFrom(event), ...keyDump(event) }); return; }
        if (rec.readUsed) { log("final-ok-read", { id: rec.id }); return; }
        if (!referencesFile(rec.prompt)) { log("final-noref", { id: rec.id }); return; }
        log("final-REVISE", { id: rec.id, prompt: rec.prompt.slice(0, 120) });
        return {
          action: "revise",
          reason: "groundcheck: file referenced but not read",
          retry: {
            instruction: "STOP: you answered about a file/document/scripture WITHOUT opening it, so your description of its contents may be invented. Do NOT describe a file from memory. First LOCATE and READ the referenced file (use exec with rg/grep/find/cat, or the read tool), then answer using only what the file actually says.",
            idempotencyKey: "groundcheck:" + rec.id,
            maxAttempts: 1,
          },
        };
      } catch (e) { log("err-final", { e: String(e) }); return; }
    }, { priority: 50 });
  },
});
