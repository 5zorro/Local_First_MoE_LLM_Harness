// Integration test for preflight-planner: drives the REAL index.js hook handlers through
// scripted turns (planner call stubbed; no gateway, no models, no exec approvals) and asserts
// the wiring — especially that the enforcement gate returns `action: revise` on a skipped
// write/exec turn. This is the deterministic evidence for flipping gateMode to "enforce":
// a live turn can't prove it (a real fire only happens if the weak manager happens to skip),
// but this proves the enforce PATH fires exactly when it should.   Run: node test-integration.mjs
import { register } from "node:module";
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Redirect the one openclaw import to a local stub, then dynamic-import index.js AFTER registering.
register("./_itest/resolver.mjs", import.meta.url);

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log("  ✅", n)) : (fail++, console.log("  ❌", n)));

// Canned planner reply so before_prompt_build runs fully offline.
const CANNED_PLAN = "RUBRIC:\n- Answer is correct and complete\n- Cites real evidence\nDISPATCH:\n- codebase-index: find and read the target\nPHASES:\n- delegate\n- critic";
let fetchCalls = 0, fetchMode = "ok";
globalThis.fetch = async () => {
  fetchCalls++;
  if (fetchMode === "fail") return { ok: false, status: 500, json: async () => ({}) };
  if (fetchMode === "throw") throw new Error("ECONNREFUSED");
  return { ok: true, status: 200, json: async () => ({ message: { content: CANNED_PLAN } }) };
};

const { default: entry } = await import("./index.js");
ok("real index.js loaded (id matches)", entry && entry.id === "preflight-planner" && typeof entry.register === "function");

// A fresh wiring per scenario → fresh gate state + a fresh temp harness dir.
function wire(config) {
  const dir = mkdtempSync(join(tmpdir(), "pfp-"));
  mkdirSync(join(dir, "memory"), { recursive: true });
  mkdirSync(join(dir, "ralph"), { recursive: true });
  const handlers = {};
  // Real contract: register(api) with per-plugin config on api.pluginConfig (no second ctx arg).
  const api = { on: (name, fn) => { handlers[name] = fn; }, pluginConfig: { ollamaUrl: "http://stub", harnessDir: dir, ...config } };
  entry.register(api);
  const ctx = { agentId: "main", sessionKey: "sk", runId: "rid" };
  return {
    dir, handlers,
    prompt: (prompt, c = ctx) => handlers.before_prompt_build({ prompt }, c),
    tool: (toolName, params, c = ctx) => handlers.after_tool_call({ toolName, params }, c),
    finalize: (c = ctx) => handlers.before_agent_finalize({}, c),
    reply: (text, c = ctx, kind = "final") => handlers.reply_payload_sending({ payload: { text }, kind, sessionKey: c.sessionKey, runId: c.runId }, c),
  };
}
const spawn = (agentId, model) => ["sessions_spawn", { agentId, model }];

console.log("# preflight-planner integration (real index.js, planner stubbed)");

// --- S1: enforce + skipped write turn → gate FIRES (action: revise) -----------------
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  const inj = await t.prompt("implement the foo parser and write it to disk");
  ok("S1 planner injected the rubric", !!(inj && inj.appendSystemContext && /Solution criteria/.test(inj.appendSystemContext)));
  ok("S1 injection carries the dispatch expert", /codebase-index/.test(inj.appendSystemContext));
  ok("S1 planner was actually called", fetchCalls === 1);
  await t.tool("edit", { path: "/x" });                 // acted, NO delegation, NO critic
  const r = await t.finalize();
  ok("S1 GATE FIRES → action:revise", !!(r && r.action === "revise"));
  ok("S1 revise is capped (maxAttempts 1, can't loop)", !!(r && r.retry && r.retry.maxAttempts === 1));
  ok("S1 revise reason names the miss", /no expert delegation|no Critic call/.test(r.reason || ""));
}

// --- S2: enforce + proper turn (delegated + criticed) → gate SILENT ------------------
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  await t.prompt("implement the foo parser and write it to disk");
  await t.tool(...spawn("codebase-index"));
  await t.tool("edit", { path: "/x" });
  await t.tool(...spawn("critic"));
  const r = await t.finalize();
  ok("S2 proper turn → gate SILENT (no action)", !r || r.action !== "revise");
}

// --- S3: #hottake → full bypass (no planner, gate disabled even on a write) ----------
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  const inj = await t.prompt("#hottake just edit the file fast");
  ok("S3 #hottake → no planner injection", !inj || !inj.appendSystemContext);
  ok("S3 #hottake → planner NOT called", fetchCalls === 0);
  await t.tool("edit", { path: "/x" });
  const r = await t.finalize();
  ok("S3 #hottake → gate disabled (no action)", !r || r.action !== "revise");
}

// --- S4: trivial turn → planner skipped ---------------------------------------------
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  const inj = await t.prompt("hi there");
  ok("S4 trivial → no planner injection", !inj || !inj.appendSystemContext);
  ok("S4 trivial → planner NOT called", fetchCalls === 0);
}

// --- S5: shadow mode → logs but NEVER blocks ----------------------------------------
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "shadow", agentId: "main" });
  await t.prompt("implement and write the thing");
  await t.tool("edit", { path: "/x" });                 // would-fire
  const r = await t.finalize();
  ok("S5 shadow → returns no action (never blocks)", !r || r.action !== "revise");
  const logp = join(t.dir, "memory", "enforcement-gate.log");
  ok("S5 shadow → wrote a would-fire audit line", existsSync(logp) && /SHADOW fire/.test(readFileSync(logp, "utf8")));
}

// --- S6: non-main agent → plugin does nothing ---------------------------------------
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  const inj = await t.prompt("implement and write the thing", { agentId: "tool-use", sessionKey: "sk2", runId: "rid2" });
  ok("S6 expert turn → no injection", !inj || !inj.appendSystemContext);
  ok("S6 expert turn → planner NOT called", fetchCalls === 0);
}

// --- S7: planner failure → fail-open (no injection, turn proceeds) -------------------
{
  fetchMode = "throw"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  const inj = await t.prompt("implement and write the thing");
  ok("S7 planner error → fail-open (no injection)", !inj || !inj.appendSystemContext);
  // gate still works on the same turn even though the planner failed:
  await t.tool("edit", { path: "/x" });
  const r = await t.finalize();
  ok("S7 gate still fires after planner failure", !!(r && r.action === "revise"));
}

// --- S8: progress header prepended to a visible reply, debounced on chunk bursts -----
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  await t.prompt("implement the foo parser and write it to disk"); // planner ran → progress.total set (CANNED PHASES=2)
  const r1 = await t.reply("Here is the answer.");
  ok("S8 header prepended to first visible reply", !!(r1 && r1.payload && /^⏱ .*consumed.* step 1\/2\+/.test(r1.payload.text)));
  ok("S8 header precedes the original text", !!(r1 && /Here is the answer\.$/.test(r1.payload.text)));
  const r2 = await t.reply("second chunk");
  ok("S8 chunk burst within 3s is NOT re-headered (debounce)", !r2);
}

// --- S9: trivial / #hottake turns get NO progress header ----------------------------
{
  fetchMode = "ok"; fetchCalls = 0;
  const t = wire({ gateMode: "enforce", agentId: "main" });
  await t.prompt("hi there");                  // trivial → planner skipped → progress.total stays null
  const r = await t.reply("hello!");
  ok("S9 trivial turn → no progress header", !r);
}

console.log(`\n# ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
