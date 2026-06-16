// confusion-recovery — when a tool fails repeatedly with the same error, hand the agent a
// recovery hint built from that tool's recent in-session history (critique P1-2b).
//   after_tool_call    : observe outcome, update per-(session,tool) history, detect repeats.
//   tool_result_persist : when a repeat just triggered, append the hint to the tool-result
//                         message the agent reads next — so the loop breaks mid-turn.
// Retrieval is in-process (no subagent spawn): same "what worked / what didn't" signal, free + instant.
// Fail-OPEN: any error is caught/logged and the turn proceeds unchanged.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync } from "node:fs";
import { makeState, recordTool, takePending } from "./lib.js";

const LOG = "/tmp/confusion-recovery.log";
function log(tag, obj) { try { appendFileSync(LOG, `${new Date().toISOString()} ${tag} ${JSON.stringify(obj)}\n`); } catch {} }

export default definePluginEntry({
  id: "confusion-recovery",
  name: "Confusion recovery",
  register(api, ctx) {
    const cfg = (ctx && ctx.config) || {};
    const opts = { threshold: cfg.threshold || 2, maxHistory: cfg.maxHistory || 5 };
    const state = makeState();

    api.on("after_tool_call", async (event, hookCtx) => {
      try {
        const r = recordTool(state, {
          sessionKey: hookCtx && hookCtx.sessionKey,
          agentId: (hookCtx && hookCtx.agentId) || "main",
          toolName: event && event.toolName,
          params: event && event.params,
          error: event && event.error,
          toolCallId: event && event.toolCallId,
          ts: Date.now(),
        }, opts);
        if (r.triggered) log("trigger", { tool: event.toolName, agent: (hookCtx && hookCtx.agentId) || "?", callId: event.toolCallId });
      } catch (e) { log("err-after", { e: String(e) }); }
    }, { priority: 50 });

    api.on("tool_result_persist", async (event) => {
      try {
        const hint = takePending(state, event && event.toolCallId);
        if (!hint) return;
        const msg = event && event.message;
        if (msg && typeof msg.content === "string") {
          log("inject-str", { callId: event.toolCallId });
          return { message: { ...msg, content: msg.content + hint } };
        }
        if (msg && Array.isArray(msg.content)) {
          log("inject-blocks", { callId: event.toolCallId });
          return { message: { ...msg, content: [...msg.content, { type: "text", text: hint }] } };
        }
        log("inject-skip-shape", { callId: event.toolCallId, t: typeof (msg && msg.content) });
        return;
      } catch (e) { log("err-persist", { e: String(e) }); }
    }, { priority: 50 });
  },
});
