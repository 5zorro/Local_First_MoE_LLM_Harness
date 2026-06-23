// Standalone tests for preflight-planner lib: `node test.mjs`
// Covers the deterministic decisions AND the enforcement-gate eval suite (the cases that
// must fire / must stay silent / must bypass), so flipping gateMode to "enforce" is evidence-backed.
import {
  EXPERTS, isHotTake, triage, detectRalph, extractRalphGoal,
  buildPlannerSystemPrompt, parsePlannerOutput, renderInjection,
  parseReasonableness, renderReasonablenessInjection,
  makeGateState, gateStart, gateRecordTool, gateDecision, gcGate, GATE_TTL_MS,
  buildProgressHeader,
} from "./lib.js";

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log("  ✅", n)) : (fail++, console.log("  ❌", n)));

console.log("# preflight-planner lib tests");

// ---- #hottake -----------------------------------------------------------------
ok("hottake detected mid-prompt", isHotTake("just answer fast #hottake no planner"));
ok("hottake detected at start", isHotTake("#hottake what's 2+2"));
ok("no hottake on plain prompt", !isHotTake("build the planner plugin"));
ok("hottake not matched inside a word", !isHotTake("this is a hottakeish idea"));

// ---- triage (bias: uncertain → non-trivial) ------------------------------------
ok("greeting is trivial", triage("hey there").trivial === true);
ok("thanks is trivial", triage("thanks!").trivial === true);
ok("time question is trivial", triage("what's the time").trivial === true);
ok("status ping is trivial", triage("you there?").trivial === true);
ok("action verb is non-trivial", triage("implement the rubric parser").trivial === false);
ok("file ref is non-trivial", triage("look at ./lib.js and tell me about it").trivial === false);
ok("long planning prompt is non-trivial", triage("I want a deep critique of how the manager decides who to spawn and why it skips the critic").trivial === false);
ok("short + no action/ref is trivial", triage("who are you").trivial === true);

// ---- Ralph detection -----------------------------------------------------------
ok("ralph by sessionKey", detectRalph("agent:main:ralph-live", "do stuff").ralph === true);
ok("ralph by prompt prefix", detectRalph("x", "You are iteration 3 of a Ralph loop — go").ralph === true);
ok("ralph iter parsed", detectRalph("x", "You are iteration 7 of a Ralph loop").iter === 7);
ok("non-ralph normal turn", detectRalph("agent:main:web-1", "hello").ralph === false);
ok("extractRalphGoal pulls body",
  extractRalphGoal("pre\n=== GOAL.md ===\nDONE WHEN: x is true\n=== end GOAL.md ===\npost") === "DONE WHEN: x is true");

// ---- planner output parsing (tolerant) -----------------------------------------
const sample = `Sure, here is the plan.
RUBRIC:
- Answer cites the actual file contents, not memory
- Includes the exact line numbers
DISPATCH:
- codebase-index: locate and read lib.js, return the parser function
- tool-use: nothing
- not-an-expert: ignore me
- none
PHASES:
- delegate to codebase-index
- synthesize
- critic`;
const p = parsePlannerOutput(sample);
ok("parses rubric items", p.rubric.length === 2);
ok("parses only-valid dispatch experts", p.dispatch.length === 2 && p.dispatch.every((d) => EXPERTS.some((e) => e.id === d.expert)));
ok("drops bogus expert id", !p.dispatch.some((d) => d.expert === "not-an-expert"));
ok("parses phases", p.phases.length === 3);
ok("ok=true when content present", p.ok === true);
ok("empty planner output → ok=false", parsePlannerOutput("").ok === false);

// "DISPATCH: none" alone → no dispatch, still ok if rubric present
const p2 = parsePlannerOutput("RUBRIC:\n- be correct\nDISPATCH:\n- none\nPHASES:\n- critic");
ok("none dispatch yields empty list", p2.dispatch.length === 0 && p2.ok === true);

// ---- injection rendering -------------------------------------------------------
const inj = renderInjection(p, { byteBudget: 3500 });
ok("injection names the rubric", /Solution criteria/.test(inj));
ok("injection lists dispatch experts", /codebase-index:/.test(inj));
ok("injection always requires the Critic", /spawn `critic`/.test(inj));
ok("injection documents #hottake escape", /#hottake/.test(inj));
ok("injection respects byte budget", Buffer.byteLength(renderInjection(p, { byteBudget: 200 }), "utf8") <= 240);
ok("ralph injection flags frozen rubric", /FROZEN/.test(renderInjection(p, { ralphIter: 1 })));

// ---- reasonableness ------------------------------------------------------------
ok("reasonableness ok", parseReasonableness("VERDICT: ok").verdict === "ok");
ok("reasonableness revise + note", (() => { const r = parseReasonableness("VERDICT: revise\nNOTE: stop adding tasks"); return r.verdict === "revise" && /stop adding/.test(r.note); })());
ok("reasonableness defaults ok (fail-open)", parseReasonableness("garble").verdict === "ok");
ok("reasonableness revise injection warns against new criteria", /Do NOT add success criteria/.test(renderReasonablenessInjection({ verdict: "revise", note: "trim" }, 4)));

// ================================================================================
// ENFORCEMENT-GATE EVAL SUITE — the behaviors that justify flipping to "enforce".
// ================================================================================
console.log("# enforcement-gate eval suite");
function runTurn({ prompt, trivial = false, hotTake = false, ralph = false, tools = [] }) {
  const st = makeGateState();
  const ids = ["sess-" + Math.random()];
  gateStart(st, ids, { prompt, trivial, hotTake, ralph });
  for (const t of tools) gateRecordTool(st, ids, t);
  return gateDecision(st.runs.get(ids[0]), { mode: "enforce" });
}
const spawn = (agentId, model) => ({ toolName: "sessions_spawn", params: { agentId, model } });
const writeTool = { toolName: "edit", params: { path: "/x" } };
const execTool = { toolName: "exec", params: { command: "git commit -m x" } };
const readTool = { toolName: "read", params: { path: "/x" } };

// MUST FIRE
ok("FIRE: write turn, no delegation, no critic",
  runTurn({ prompt: "implement the parser", tools: [writeTool] }).fire === true);
ok("FIRE: exec turn, delegated but NO critic",
  runTurn({ prompt: "fix and commit", tools: [spawn("tool-use"), execTool] }).fire === true);
ok("FIRE: write turn, critic only, NO real delegation",
  runTurn({ prompt: "edit the file", tools: [writeTool, spawn("critic")] }).fire === true);

// MUST STAY SILENT
ok("PASS: delegated + criticed on a write turn",
  runTurn({ prompt: "implement X", tools: [spawn("codebase-index"), writeTool, spawn("critic")] }).fire === false);
ok("PASS: critic detected by gpt-oss model (no explicit agentId)",
  runTurn({ prompt: "implement X", tools: [spawn("tool-use"), writeTool, spawn("", "ollama/gpt-oss:20b")] }).fire === false);
ok("PASS: log-critic.sh via exec counts as criticed",
  runTurn({ prompt: "do work", tools: [spawn("ops-expert"), { toolName: "exec", params: { command: "/home/pi/agent-harness/scripts/log-critic.sh PASS turn ''" } }] }).fire === false);

// MUST BYPASS (gate disabled)
ok("BYPASS: #hottake disables the gate",
  runTurn({ prompt: "edit it #hottake", hotTake: true, tools: [writeTool] }).fire === false);
ok("BYPASS: trivial turn",
  runTurn({ prompt: "hi", trivial: true, tools: [] }).fire === false);
ok("BYPASS: Ralph mode (DONE-GATE owns QC)",
  runTurn({ prompt: "iter", ralph: true, tools: [writeTool] }).fire === false);
ok("BYPASS: no write/exec this turn (pure read/answer)",
  runTurn({ prompt: "what does lib.js do", tools: [readTool] }).fire === false);

// gateRecordTool wiring sanity
(() => {
  const st = makeGateState(); const ids = ["s"]; gateStart(st, ids, { prompt: "x" });
  gateRecordTool(st, ids, spawn("tool-use"));
  gateRecordTool(st, ids, writeTool);
  const r = st.runs.get("s");
  ok("record: spawn captured", r.spawns.includes("tool-use"));
  ok("record: write set acted", r.acted === true);
  ok("record: not criticed yet", r.criticed === false);
})();

// gate-state TTL/GC — abandoned (interrupted) sessions are reaped; live ones survive
(() => {
  const st = makeGateState();
  gateStart(st, ["abandoned"], { prompt: "x" });
  st.runs.get("abandoned").ts = Date.now() - GATE_TTL_MS - 1000;   // age it past the TTL (interrupted, never finalized)
  gateStart(st, ["fresh"], { prompt: "y" });                       // a later turn triggers GC
  ok("GC: abandoned session reaped", !st.runs.has("abandoned"));
  ok("GC: fresh session kept", st.runs.has("fresh"));
})();
(() => {
  const st = makeGateState();
  gateStart(st, ["live"], { prompt: "x" });
  st.runs.get("live").ts = Date.now() - GATE_TTL_MS - 1000;
  gateStart(st, ["live"], { prompt: "x2" });                       // same session, new turn → ts refreshed
  gcGate(st);
  ok("GC: re-started (live) session is NOT reaped", st.runs.has("live"));
  ok("GC: stale state.last is cleared", (() => { const s2 = makeGateState(); gateStart(s2, ["z"], { prompt: "q" }); s2.runs.get("z").ts = Date.now() - GATE_TTL_MS - 1; s2.last.ts = s2.runs.get("z").ts; gcGate(s2); return s2.last === null; })());
})();

// progress header (§6-lite)
ok("progress: first header shows preflight + total + step n/x+",
  buildProgressHeader({ totalMs: 45000, stepMs: 9000, preflightMs: 36000, label: "tool-use", n: 2, x: 5, first: true })
    === "⏱ 45s consumed (preflight 36s) · +9s on tool-use · step 2/5+");
ok("progress: later header omits preflight",
  buildProgressHeader({ totalMs: 187000, stepMs: 42000, preflightMs: 36000, label: "codebase-index", n: 3, x: 5, first: false })
    === "⏱ 187s consumed · +42s on codebase-index · step 3/5+");
ok("progress: no plan total → bare n+",
  /step 1\+$/.test(buildProgressHeader({ totalMs: 1000, stepMs: 1000, label: "preflight", n: 1, x: null })));
ok("progress: rounds seconds, clamps negatives",
  buildProgressHeader({ totalMs: 1600, stepMs: -50, label: "", n: 1, x: 2 }) === "⏱ 2s consumed · +0s · step 1/2+");

console.log(`\n# ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
