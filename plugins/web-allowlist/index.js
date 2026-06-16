// web-allowlist — mechanical egress allowlist for web_fetch (critique P1-3 / spec §3.10 L4).
// Blocks web_fetch to any host not on the allowlist, at the tool layer — so the manager's
// behavioral rule is no longer the only thing between an expert and an arbitrary URL.
//
// Decisions:
//   - Only web_fetch is gated (it pulls arbitrary URLs). web_search goes through the provider and
//     its result links are themselves fetched via web_fetch, which IS gated — so search passes.
//   - POLICY denials are fail-CLOSED (off-allowlist / unparseable / non-http(s) -> block).
//   - INTERNAL errors are fail-OPEN (caught, logged, allowed) so a plugin bug can't wedge the gateway.
//   - Allowlist is config-driven (configSchema.allowDomains); pure logic lives in ./lib.js (unit-tested).
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync } from "node:fs";
import { DEFAULT_ALLOW, hostAllowed, extractUrl } from "./lib.js";

const LOG = "/tmp/web-allowlist.log";
function log(tag, obj) { try { appendFileSync(LOG, `${new Date().toISOString()} ${tag} ${JSON.stringify(obj)}\n`); } catch {} }

export default definePluginEntry({
  id: "web-allowlist",
  name: "Web egress allowlist",
  register(api, ctx) {
    const cfg = (ctx && ctx.config) || {};
    const domains = Array.isArray(cfg.allowDomains) && cfg.allowDomains.length ? cfg.allowDomains : DEFAULT_ALLOW;

    api.on("before_tool_call", async (event) => {
      try {
        if (!event || event.toolName !== "web_fetch") return; // only gate arbitrary-URL fetches
        const url = extractUrl(event.params);
        if (!url) {
          log("block-nourl", { params: JSON.stringify(event.params || "").slice(0, 200) });
          return { block: true, blockReason: "web-allowlist: web_fetch with no parseable URL was blocked." };
        }
        const verdict = hostAllowed(url, domains);
        if (verdict.ok) { log("allow", { url, matched: verdict.matched }); return; }
        log("BLOCK", { url, why: verdict.why });
        return {
          block: true,
          blockReason:
            `web-allowlist: '${url}' is not on the egress allowlist (${verdict.why}). ` +
            `Fetch only from approved domains, or ask the operator to approve this host for the session. ` +
            `Allowed: ${domains.join(", ")}.`,
        };
      } catch (e) { log("err", { e: String(e) }); return; } // fail-open on internal error
    }, { priority: 50 });
  },
});
