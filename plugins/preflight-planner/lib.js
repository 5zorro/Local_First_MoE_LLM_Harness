// Pure, dependency-free logic for preflight-planner. Unit-tested in test.mjs.
// No openclaw / no node-builtin imports here so it runs under plain `node`.
//
// The plugin's job (see index.js): before the WEAK local manager (qwen3.5) acts on a
// non-trivial turn, a stronger local planner (gpt-oss:20b) emits the solution criteria
// (a rubric) + an explicit expert-dispatch list, injected into the manager's context so it
// can EXECUTE a concrete plan instead of free-soloing. The same rubric is reused by the
// end-Critic. This file holds the deterministic, model-free decisions around that call.

// ---------------------------------------------------------------------------
// Expert roster the planner may dispatch to. Mirrors agents.list in openclaw.json;
// index.js may override via cfg.experts so this never drifts silently.
// ---------------------------------------------------------------------------
export const EXPERTS = [
  { id: "tool-use",        role: "fetch/sanitize UNTRUSTED or external content — the firewall between raw input and the manager" },
  { id: "codebase-index",  role: "search/read LARGE local code or docs; returns summaries + paths, keeps the manager's context lean" },
  { id: "todo-expert",     role: "maintain the todo/plan board and decompose multi-step work" },
  { id: "identity-keeper", role: "owns SOUL/IDENTITY/persona + canon consistency; consult on identity or canon questions" },
  { id: "ops-expert",      role: "shell / filesystem / git / system operations the manager should not run inline" },
  { id: "critic",          role: "READ-ONLY QC gate (gpt-oss); grades the planned answer against the rubric before the user sees it" },
];

// ---------------------------------------------------------------------------
// #hottake — per-turn kill switch. If the user puts #hottake anywhere in the prompt,
// the harness disables the planner AND the enforcement gate for that one turn.
// ---------------------------------------------------------------------------
export function isHotTake(prompt) {
  return /(^|[^a-z0-9_])#hottake\b/i.test(String(prompt || ""));
}

// ---------------------------------------------------------------------------
// Trivial-turn triage (deterministic — NO model call; a model call to decide
// triviality would itself force the swap we are trying to avoid).
// Bias: when uncertain, classify NON-trivial (correctness > latency; #hottake is the escape).
// ---------------------------------------------------------------------------
const SMALLTALK_RE = [
  /^\s*(hi|hey+|hello|yo|sup|gm|gn|good (morning|evening|afternoon|night))\b[\s!.?]*$/i,
  /^\s*(thanks?|thank you|ty|thx|cool|nice|great|awesome|got it|gotcha|np|no problem|ok(ay)?|k|sure|yep|yes|yeah|nope|no)\b[\s!.?]*$/i,
  /^\s*(what'?s the (time|date)|what time is it|today'?s date|current (time|date))\b[\s!.?]*$/i,
  /^\s*(status|ping|you there\??|are you (there|up|awake|alive)\??|still there\??)\b[\s!.?]*$/i,
];
// Action verbs that almost always imply a non-trivial, possibly-delegated turn.
const ACTION_RE = /\b(build|implement|fix|add|writ(e|ing)|edit|creat(e|ing)|refactor|debug|analy[sz]e|review|research|search|find|locate|compare|explain|summar(ise|ize)|run|deploy|test|investigat(e|ing)|design|plan|update|chang(e|ing)|remov(e|ing)|delet(e|ing)|generat(e|ing)|draft|check|verif(y|ying)|audit|configur(e|ing)|install|set ?up|migrat(e|ing)|optimi[sz]e|trace|diff|merge|commit|push|grep|inspect|read|open|look (at|into)|trouble ?shoot|wire|hook|grade|score|rank|extract|parse|convert|rename|move)\b/i;
// References that imply real artifacts to ground against.
const REF_RE = /(^|\s)[~./][^\s]*\.[a-z0-9]{1,6}\b|```|\b(file|repo|codebase|code|function|method|class|module|script|config|plugin|test|commit|branch|diff|log|endpoint|schema|table|scripture|chapter|verse|passage|document|spec)\b/i;

export function triage(prompt) {
  const t = String(prompt || "").trim();
  if (!t) return { trivial: true, reason: "empty" };
  for (const re of SMALLTALK_RE) if (re.test(t)) return { trivial: true, reason: "smalltalk/status" };
  const words = t.split(/\s+/).length;
  const hasAction = ACTION_RE.test(t);
  const hasRef = REF_RE.test(t);
  if (words <= 8 && !hasAction && !hasRef) return { trivial: true, reason: "short, no action/ref" };
  return { trivial: false, reason: hasAction ? "action verb" : hasRef ? "artifact ref" : "non-trivial (default)" };
}

// ---------------------------------------------------------------------------
// Ralph-loop detection. ralph-loop.sh runs against the stable session "ralph-live"
// and sends a prompt beginning "You are iteration N of a Ralph loop".
// ---------------------------------------------------------------------------
export function detectRalph(sessionKey, prompt) {
  const sk = String(sessionKey || "");
  const p = String(prompt || "");
  const m = p.match(/You are iteration (\d+) of a Ralph loop/);
  const iter = m ? parseInt(m[1], 10) : null;
  return { ralph: /ralph-live/.test(sk) || m != null, iter };
}

// Pull the GOAL.md body out of a Ralph iteration prompt (between the === markers).
export function extractRalphGoal(prompt) {
  const m = String(prompt || "").match(/=== GOAL\.md ===\s*([\s\S]*?)\s*=== end GOAL\.md ===/);
  return m ? m[1].trim() : "";
}

// ---------------------------------------------------------------------------
// Planner prompts + tolerant parser.
// ---------------------------------------------------------------------------
export function buildPlannerSystemPrompt(experts = EXPERTS) {
  const roster = experts.map((e) => `  - ${e.id}: ${e.role}`).join("\n");
  return [
    "You are the PREFLIGHT PLANNER for a manager-of-experts agent.",
    "The manager runs on a SMALL model that reliably free-solos (skips delegation and the Critic) when",
    "left to plan open-endedly. Your job is to turn open-ended planning (hard) into constrained execution (easy):",
    "given the user's request, emit (1) the solution criteria the answer must meet, and (2) the exact experts to spawn.",
    "",
    "You do NOT solve the task and you have NO tools. Output ONLY the three labelled sections below, nothing else.",
    "",
    "Available experts (use ONLY these ids in DISPATCH):",
    roster,
    "",
    "Rules:",
    "- RUBRIC: 2-6 concrete, checkable success criteria (what a correct, complete answer must contain/do). The Critic grades against these.",
    "- DISPATCH: which experts to spawn and what to ask each. Write 'none' only if the task is genuinely answerable with zero delegation.",
    "- Untrusted/external content MUST go through tool-use. Large local reads SHOULD go through codebase-index.",
    "- PHASES: the ordered steps for this turn, ending with the critic. Keep it short.",
    "",
    "FORMAT (exactly):",
    "RUBRIC:",
    "- <criterion>",
    "DISPATCH:",
    "- <expert-id>: <what to ask them for>   (or)   - none",
    "PHASES:",
    "- <step label>",
  ].join("\n");
}

export function buildPlannerUserPrompt(userPrompt, { ralphGoal = "" } = {}) {
  if (ralphGoal) {
    return "This is iteration 1 of an autonomous Ralph loop. Plan the WHOLE-GOAL rubric + dispatch for this goal " +
      "(these will be FROZEN for the whole run — do not plan per-iteration tasks here):\n\n=== GOAL ===\n" + ralphGoal + "\n=== end GOAL ===";
  }
  return "User request to plan for:\n\n" + String(userPrompt || "").trim();
}

// Tolerant parse of the planner's reply into { ok, rubric[], dispatch[{expert,ask}], phases[], raw }.
export function parsePlannerOutput(text, experts = EXPERTS) {
  const raw = String(text || "");
  const ids = new Set(experts.map((e) => e.id));
  const grab = (label) => {
    const re = new RegExp("^\\s*" + label + "\\s*:?\\s*$", "im");
    const m = re.exec(raw);
    if (!m) return [];
    const rest = raw.slice(m.index + m[0].length);
    const lines = [];
    for (const ln of rest.split(/\r?\n/)) {
      if (/^\s*(RUBRIC|DISPATCH|PHASES)\s*:?\s*$/i.test(ln)) break;     // next section
      const li = ln.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/);
      if (li) lines.push(li[1].trim());
      else if (lines.length && ln.trim()) lines[lines.length - 1] += " " + ln.trim(); // wrapped line
    }
    return lines;
  };
  const rubric = grab("RUBRIC");
  const dispatchRaw = grab("DISPATCH");
  const phases = grab("PHASES");
  const dispatch = [];
  for (const d of dispatchRaw) {
    if (/^none\b/i.test(d)) continue;
    const m = d.match(/^[`*]?([a-z][a-z0-9-]+)[`*]?\s*[:\-–]\s*(.+)$/i);
    if (m && ids.has(m[1].toLowerCase())) dispatch.push({ expert: m[1].toLowerCase(), ask: m[2].trim() });
    else { // tolerate "spawn tool-use to ..." style
      const found = [...ids].find((id) => new RegExp("\\b" + id + "\\b", "i").test(d));
      if (found) dispatch.push({ expert: found, ask: d.replace(new RegExp("\\b" + found + "\\b", "i"), "").replace(/^[\s:\-–to]+/i, "").trim() || d });
    }
  }
  const ok = rubric.length > 0 || dispatch.length > 0;
  return { ok, rubric, dispatch, phases, raw };
}

// Render the system-context block injected into the manager (under a byte budget).
export function renderInjection(parsed, { ralphIter = null, byteBudget = 3500 } = {}) {
  const L = [];
  L.push("# Preflight plan for THIS turn — machine-generated by the harness planner. EXECUTE it; do not re-plan from scratch.");
  if (ralphIter != null) L.push(`(Ralph iteration ${ralphIter}. The rubric below is FROZEN for the whole run.)`);
  L.push("You did NOT author this plan — the planner did. Treat it as your task contract for this turn.");
  L.push("");
  if (parsed.rubric && parsed.rubric.length) {
    L.push("## Solution criteria — the Critic will grade your answer against THESE:");
    for (const r of parsed.rubric) L.push("- " + r);
    L.push("");
  }
  if (parsed.dispatch && parsed.dispatch.length) {
    L.push("## Delegate — spawn these experts with sessions_spawn (do NOT free-solo):");
    for (const d of parsed.dispatch) L.push(`- ${d.expert}: ${d.ask}`);
    L.push("");
  } else {
    L.push("## Delegation: none required for this turn (still gate through the Critic).");
    L.push("");
  }
  L.push("## Required closing steps (the harness enforces this):");
  L.push("1. Before replying, spawn `critic` (gpt-oss) to grade your draft against the criteria above; log the verdict, fix any ❌.");
  L.push("2. THEN you MUST write a FINAL ANSWER to the user in plain text that synthesizes the experts' results. Tool/expert output is NOT shown to the user — if you stop after a tool/`sessions_spawn` call without writing your own answer, the user sees NOTHING. Never end a turn on a tool/expert result; always finish with your own written reply.");
  L.push("");
  L.push("(To run a turn WITHOUT the harness — no planner, no enforcement — include #hottake in your message.)");
  let out = L.join("\n");
  if (Buffer.byteLength(out, "utf8") > byteBudget) out = out.slice(0, byteBudget) + "\n…[plan truncated to budget]";
  return out;
}

// ---------------------------------------------------------------------------
// Reasonableness gate (Ralph iter 2+) — runs ONLY when plan.md changed materially.
// It NEVER adds solution criteria; it only emits ok / revise so the rubric can't creep.
// ---------------------------------------------------------------------------
export function buildReasonablenessSystemPrompt() {
  return [
    "You are the REASONABLENESS GATE for an autonomous Ralph loop. You guard against scope creep, busywork,",
    "and going off-track. You do NOT add success criteria and you do NOT solve anything.",
    "Given the FROZEN goal rubric, the goal, the just-rewritten task plan, and the latest checkpoint, decide whether",
    "the new plan still pursues the same goal, whether new tasks are necessary (vs speculative), and whether the top",
    "task is achievable in one bounded turn. If the plan is growing without progress, say so.",
    "",
    "Output EXACTLY one of:",
    "VERDICT: ok",
    "  -- or --",
    "VERDICT: revise",
    "NOTE: <one line: the single most important correction toward the frozen goal>",
  ].join("\n");
}

export function buildReasonablenessUserPrompt({ rubric = "", goal = "", plan = "", scratch = "" } = {}) {
  const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; };
  return [
    "=== FROZEN GOAL RUBRIC ===", clip(rubric, 2000),
    "=== GOAL ===", clip(goal, 1500),
    "=== NEW PLAN (plan.md, just rewritten this iteration) ===", clip(plan, 2000),
    "=== LATEST CHECKPOINT (scratch.md) ===", clip(scratch, 1500),
  ].join("\n");
}

export function parseReasonableness(text) {
  const raw = String(text || "");
  const v = /verdict\s*:?\s*(ok|revise|off[- ]?track|scope[- ]?creep|bloat|prune|stop)/i.exec(raw);
  const verdict = v && /^ok$/i.test(v[1]) ? "ok" : (v ? "revise" : "ok"); // default ok (fail-open: don't block Ralph)
  const n = /note\s*:?\s*(.+)/i.exec(raw);
  const note = n ? n[1].trim().split(/\r?\n/)[0].slice(0, 240) : "";
  return { verdict, note };
}

export function renderReasonablenessInjection({ verdict, note }, ralphIter) {
  if (verdict === "ok") {
    return `# Reasonableness gate (Ralph iter ${ralphIter}): ✅ plan is on-track for the frozen goal. Proceed with the top task.`;
  }
  return [
    `# Reasonableness gate (Ralph iter ${ralphIter}): ⚠️ REVISE before acting.`,
    `- ${note || "Plan has drifted from the frozen goal — trim it and realign to GOAL/rubric before doing the top task."}`,
    "- RE-PLAN adjusts TASKS only. Do NOT add success criteria — those live in ralph/rubric.md and are frozen.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Progress header (§6-lite) — prepended to each visible MANAGER reply so the operator sees
// cumulative + per-step elapsed time and the step counter. The per-step delta is what
// surfaces a "weird wait": when the next header reads +180s, that step dragged. Pure
// string builder → unit-tested. (No live ticking counter — a blocking in-hook model load
// can't push timed messages mid-hook; this shows the time retrospectively on each reply.)
// ---------------------------------------------------------------------------
export function buildProgressHeader({ totalMs, stepMs, preflightMs, label, n, x, first } = {}) {
  const s = (ms) => Math.max(0, Math.round((ms || 0) / 1000));
  const pre = first && preflightMs ? ` (preflight ${s(preflightMs)}s)` : "";
  const lab = label ? ` on ${label}` : "";
  const step = x ? `${n}/${x}+` : `${n}+`;
  return `⏱ ${s(totalMs)}s consumed${pre} · +${s(stepMs)}s${lab} · step ${step}`;
}

// ---------------------------------------------------------------------------
// Enforcement gate (Component E). Tracks, per turn, whether the manager actually
// delegated + gated through the Critic on a non-trivial write/exec turn.
// Modes: "shadow" (log only) | "enforce" (force one revise pass).
// ---------------------------------------------------------------------------
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "apply_patch", "create", "str_replace", "str_replace_editor", "fs_write", "file_write"]);

// 30 min — comfortably above any single turn (subagents.runTimeoutSeconds is 300s, Ralph iters 600s),
// so an in-flight turn is never collected; only interrupted/abandoned sessions get reaped.
export const GATE_TTL_MS = 30 * 60 * 1000;

export function makeGateState() { return { runs: new Map(), last: null }; }

// Drop records from turns that never finalized (GUI-interrupted / abandoned) so the map can't grow
// unbounded across distinct sessions. Active sessions refresh their record's ts every turn via
// gateStart (below), so a long-but-live turn survives.
export function gcGate(state, ttl = GATE_TTL_MS) {
  const cutoff = Date.now() - ttl;
  for (const [k, rec] of state.runs) if (!rec || rec.ts < cutoff) state.runs.delete(k);
  if (state.last && state.last.ts < cutoff) state.last = null;
}

export function gateStart(state, ids, info) {
  gcGate(state);
  const rec = {
    ids, prompt: info.prompt || "", trivial: !!info.trivial, hotTake: !!info.hotTake,
    ralph: !!info.ralph, acted: false, spawns: [], criticed: false, ts: Date.now(),
  };
  for (const k of (ids && ids.length ? ids : ["_"])) state.runs.set(k, rec);
  state.last = rec;
  return rec;
}

function getRec(state, ids) {
  for (const k of (ids || [])) { const r = state.runs.get(k); if (r) return r; }
  return state.last;
}

export function gateRecordTool(state, ids, { toolName, params }) {
  const rec = getRec(state, ids);
  if (!rec) return;
  const tn = String(toolName || "");
  if (tn === "sessions_spawn") {
    const agent = String((params && (params.agentId || params.agent)) || "").toLowerCase();
    const model = String((params && params.model) || "");
    if (agent) rec.spawns.push(agent);
    if (agent === "critic" || /gpt-oss/i.test(model)) rec.criticed = true;
    return;
  }
  if (WRITE_TOOLS.has(tn)) { rec.acted = true; return; }
  if (tn === "exec") {
    rec.acted = true; // a shell command counts as acting
    const blob = JSON.stringify((params) || "");
    if (/log-critic\.sh/.test(blob)) rec.criticed = true; // Ralph/manual critic logging path
  }
}

// Decide whether the gate should fire. delegated = any non-critic expert was spawned.
export function gateDecision(rec, opts = {}) {
  if (!rec) return { fire: false, reason: "no record" };
  if (rec.hotTake) return { fire: false, reason: "#hottake — harness disabled" };
  if (rec.trivial) return { fire: false, reason: "trivial turn" };
  if (rec.ralph)   return { fire: false, reason: "Ralph mode (DONE-GATE owns QC)" };
  if (!rec.acted)  return { fire: false, reason: "no write/exec this turn" };
  const delegated = rec.spawns.some((a) => a && a !== "critic");
  const missing = [];
  if (!delegated) missing.push("no expert delegation");
  if (!rec.criticed) missing.push("no Critic call");
  const fire = missing.length > 0;
  return { fire, reason: fire ? missing.join(" + ") : "delegated + criticed", delegated, criticed: rec.criticed, mode: opts.mode || "shadow" };
}

// ---------------------------------------------------------------------------
// Resolve agent id from the hook's PluginHookAgentContext (mirrors manager-jit).
// ---------------------------------------------------------------------------
export function resolveAgentId(ctx) {
  if (!ctx) return null;
  if (ctx.agentId) return String(ctx.agentId);
  const sk = String(ctx.sessionKey || ctx.sessionId || "");
  const m = sk.match(/^agent:([^:]+):/);
  if (m) return m[1];
  const wd = String(ctx.workspaceDir || "").replace(/\/+$/, "");
  if (wd.includes("workspace-hatter")) return "hatter";
  const wm = wd.match(/agent-harness\/workspaces\/([^/]+)/);
  if (wm) return wm[1];
  if (wd.endsWith("/.openclaw/workspace")) return "main";
  return null;
}

// Collect candidate id keys from a hook event/context (for the gate's per-turn map).
export function idKeys(event, ctx) {
  const c = ctx || {};
  const e = event || {};
  return [c.runId, e.runId, c.sessionKey, e.sessionKey, c.sessionId, e.sessionId].filter(Boolean).map(String);
}
