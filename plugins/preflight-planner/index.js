// preflight-planner — critic-first harness execution (critique P1: "manager skips manager-of-experts").
//
//   before_prompt_build (main only):
//     • #hottake in the prompt  → BYPASS (no planner, no gate) for this turn.
//     • trivial turn            → BYPASS the planner (manager answers directly), still gate-eligible.
//     • Ralph iter 1            → full planner vs GOAL → FREEZE ralph/rubric.md → inject.
//     • Ralph iter 2+           → reasonableness gate ONLY when plan.md changed (never re-derive criteria).
//     • normal non-trivial turn → full planner (gpt-oss) → inject rubric + dispatch + persist preflight-rubric.md.
//   after_tool_call (main only)        : track delegation (sessions_spawn) + Critic + write/exec for the gate.
//   before_agent_finalize (main only)  : enforcement gate — shadow-log, or force one revise pass when enforcing.
//
// The planner is ONE synchronous Ollama call with a timeout. FAIL-OPEN everywhere: any error/timeout and the
// turn proceeds exactly as it would without this plugin (can never wedge the gateway).
import { definePluginEntry, buildJsonPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  EXPERTS, isHotTake, triage, detectRalph, extractRalphGoal,
  buildPlannerSystemPrompt, buildPlannerUserPrompt, parsePlannerOutput, renderInjection,
  buildReasonablenessSystemPrompt, buildReasonablenessUserPrompt, parseReasonableness, renderReasonablenessInjection,
  buildProgressHeader, makeGateState, gateStart, gateRecordTool, gateDecision, resolveAgentId, idKeys,
} from "./lib.js";

const LOG = "/tmp/preflight-planner.log";
function log(tag, obj) { try { appendFileSync(LOG, `${new Date().toISOString()} ${tag} ${JSON.stringify(obj)}\n`); } catch {} }
function readFile(p) { try { return existsSync(p) ? readFileSync(p, "utf8") : ""; } catch { return ""; } }
function writeFile(p, s) { try { writeFileSync(p, s); return true; } catch (e) { log("write-err", { p, e: String(e) }); return false; } }
function md5(s) { try { return createHash("md5").update(String(s || "")).digest("hex"); } catch { return ""; } }

// ONE Ollama chat call, no tools, hard timeout. Returns the assistant text or null (fail-open).
async function ollamaChat(url, model, system, user, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url.replace(/\/+$/, "") + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model, stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        options: { temperature: 0.2 },
      }),
      signal: ctl.signal,
    });
    if (!res.ok) { log("ollama-bad-status", { model, status: res.status }); return null; }
    const j = await res.json();
    const text = j && j.message && j.message.content;
    log("ollama-ok", { model, ms: Date.now() - t0, chars: (text || "").length });
    return text || null;
  } catch (e) {
    log("ollama-err", { model, ms: Date.now() - t0, e: String(e && e.name || e) });
    return null;
  } finally { clearTimeout(to); }
}

// Config schema MUST be declared here (not just in openclaw.plugin.json): the runtime parses
// entries.<id>.config against the IN-CODE configSchema before handing it to register(api, ctx).
// Without it, the default empty schema strips every key → ctx.config = {} → silent fallback to
// defaults (this is the bug that ran the planner on gemma4:latest@13s instead of the configured
// gpt-oss@85s). Keep in sync with openclaw.plugin.json's configSchema.
const CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    agentId: { type: "string" },
    plannerModel: { type: "string" },
    ollamaUrl: { type: "string" },
    plannerTimeoutMs: { type: "number" },
    reasonablenessTimeoutMs: { type: "number" },
    byteBudget: { type: "number" },
    gateMode: { type: "string", enum: ["shadow", "enforce"] },
    progress: { type: "boolean" },
    statusKey: { type: "string" },
    notifyAfterSeconds: { type: "number" },
    notifyCmd: { type: "string" },
    harnessDir: { type: "string" },
    experts: { type: "array", items: { type: "object" } },
  },
};

// Self-contained live-status page served by the gateway at /harness-status. Polls /harness-status/log
// every 1.5s and renders the tailable progress trail — keep it open in a browser tab. No external deps.
const STATUS_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Harness — live status</title><style>
body{background:#0e1116;color:#e6edf3;font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;margin:0}
header{position:sticky;top:0;padding:9px 14px;background:#161b22;border-bottom:1px solid #30363d;display:flex;gap:10px;align-items:center}
#dot{width:9px;height:9px;border-radius:50%;background:#3fb950;box-shadow:0 0 6px #3fb950}
#log{padding:10px 14px;white-space:pre-wrap;word-break:break-word}.muted{color:#8b949e}
b{color:#79c0ff}</style></head>
<body><header><span id="dot"></span><b>Agent Harness — live status</b><span class="muted" id="meta"></span></header>
<div id="log">loading…</div><script>
const L=document.getElementById('log'),D=document.getElementById('dot'),M=document.getElementById('meta');
async function tick(){try{const r=await fetch('/harness-status/log'+location.search,{cache:'no-store'});if(!r.ok)throw 0;const t=await r.text();
const atEnd=Math.abs(innerHeight+scrollY-document.body.scrollHeight)<60;L.textContent=t||'(no turns logged yet)';
M.textContent='· updated '+new Date().toLocaleTimeString();D.style.background='#3fb950';
if(atEnd)scrollTo(0,document.body.scrollHeight);}catch(e){D.style.background='#f85149';M.textContent='· disconnected (retrying)';}}
tick();setInterval(tick,1500);</script></body></html>`;

export default definePluginEntry({
  id: "preflight-planner",
  name: "Preflight planner (critic-first)",
  configSchema: buildJsonPluginConfigSchema(CONFIG_SCHEMA),
  register(api) {
    // register() receives ONLY `api` (no second ctx). Per-plugin config from entries.<id>.config is
    // exposed as `api.pluginConfig` (api.config is the WHOLE OpenClaw config — different thing).
    const cfg = (api && api.pluginConfig) || {};
    if (cfg.enabled === false) { log("disabled", {}); return; }
    const onlyAgent = cfg.agentId || "main";
    const HARNESS = cfg.harnessDir || process.env.HARNESS_ROOT || "/home/pi/agent-harness";
    // The gateway kills before_prompt_build hooks at a budget (default ~15s, raisable per-plugin via
    // entries.<id>.hooks.timeoutMs). The planner call MUST finish under that budget, and plannerTimeoutMs
    // MUST stay just below it so we fail-open cleanly instead of the gateway killing the hook mid-flight.
    //   • DEFAULTS below (gemma4:latest @ 13s) fit the *default* 15s budget out of the box.
    //   • To run a bigger/smarter planner (e.g. gpt-oss:20b, a different family from the manager), ALSO
    //     raise the hook budget: entries.<id>.hooks.timeoutMs ~90000 + plannerTimeoutMs ~85000 (the live
    //     config does this). On a ~13GB GPU a cold gpt-oss load is ~36s, fine under a 90s budget but fatal
    //     under 15s — which is the bug that starved subagent spawns before the budget was raised.
    const plannerModel = cfg.plannerModel || "gemma4:latest";
    const ollamaUrl = cfg.ollamaUrl || "http://127.0.0.1:11434";
    const plannerTimeoutMs = cfg.plannerTimeoutMs || 13000;
    const reasonTimeoutMs = cfg.reasonablenessTimeoutMs || 13000;
    const byteBudget = cfg.byteBudget || 3500;
    const gateMode = cfg.gateMode === "enforce" ? "enforce" : "shadow"; // shadow until the eval suite + report green-light enforce
    const showProgress = cfg.progress !== false; // prepend the timing/step header to visible main replies (default on)
    // Windows alert (msg.exe via interop) when an expert wait runs unusually long → likely blocked on an
    // exec approval. One ping per wait. 0 disables. notifyCmd gets the message as its only arg.
    const notifyAfterSeconds = Number.isFinite(cfg.notifyAfterSeconds) ? cfg.notifyAfterSeconds : 150;
    const notifyCmd = cfg.notifyCmd || (HARNESS + "/scripts/notify-windows.sh");
    const experts = Array.isArray(cfg.experts) && cfg.experts.length ? cfg.experts : EXPERTS;
    // Startup breadcrumb so config delivery is verifiable WITHOUT a live turn: if ctx.config flowed,
    // this logs the configured planner/timeout; if it shows the gemma4:latest/13000 defaults, config is being stripped.
    log("register", { plannerModel, plannerTimeoutMs, gateMode, progress: showProgress, hasConfig: !!(api && api.pluginConfig && Object.keys(api.pluginConfig).length) });

    const RUBRIC_FILE = HARNESS + "/memory/preflight-rubric.md";
    const RALPH_RUBRIC = HARNESS + "/ralph/rubric.md";
    const RALPH_PLAN = HARNESS + "/ralph/plan.md";
    const RALPH_GOAL = HARNESS + "/ralph/GOAL.md";
    const SCRATCH = HARNESS + "/memory/scratch.md";
    const REASON_FILE = HARNESS + "/ralph/reasonableness.md";
    const GATE_LOG = HARNESS + "/memory/enforcement-gate.log";
    const PROGRESS_LOG = HARNESS + "/memory/harness-progress.log";

    // Human-readable, tailable pending-state trail (the TUI/in-chat path is blocked by streaming, so we
    // surface "still working" HERE — `tail -f memory/harness-progress.log`). Writing to a file has none of
    // the out-of-band/streaming problems, so the live model-loading heartbeat works.
    const plog = (rec, msg) => {
      if (!rec || !rec.tid) return;
      const t = Math.round((Date.now() - rec.ts) / 1000);
      try { appendFileSync(PROGRESS_LOG, `${new Date().toTimeString().slice(0, 8)}  turn ${rec.tid}  T+${t}s  ${msg}\n`); } catch {}
    };
    // Run `fn` while emitting a heartbeat line to the progress log every 15s (so a long model load isn't silent).
    const withHeartbeat = async (rec, label, fn) => {
      let iv = null;
      if (rec) iv = setInterval(() => plog(rec, `…still ${label} (${Math.round((Date.now() - rec.ts) / 1000)}s)`), 15000);
      try { return await fn(); } finally { if (iv) clearInterval(iv); }
    };
    // Heartbeat WHILE an expert runs (between spawn and subagent_ended), so a long/blocked expert isn't a
    // silent gap on the status page. Self-clears after a cap so a missed end-event can't leak the timer.
    const stopExpertWatch = (rec) => { if (rec && rec.expertWatch) { clearInterval(rec.expertWatch.iv); rec.expertWatch = null; } };
    const startExpertWatch = (rec, who) => {
      if (!rec) return;
      stopExpertWatch(rec);
      const since = Date.now(); let ticks = 0, notified = false;
      const iv = setInterval(() => {
        const secs = Math.round((Date.now() - since) / 1000);
        plog(rec, `…still waiting on ${who} (${secs}s)`);
        if (!notified && notifyAfterSeconds > 0 && secs >= notifyAfterSeconds) {
          notified = true; // one Windows ping per expert wait
          plog(rec, `🔔 pinging Windows — ${who} has run ${secs}s (likely waiting on your approval)`);
          try { execFile(notifyCmd, [`${who} has run ${secs}s — likely waiting on an exec approval. Open the gateway.`], { timeout: 10000 }, () => {}); } catch {}
        }
        if (++ticks > 30) stopExpertWatch(rec); // safety cap (~10 min) — never leak the interval
      }, 20000);
      rec.expertWatch = { iv, who, since };
    };

    const gate = makeGateState();
    const lastPlanSig = new Map(); // sessionKey -> md5(plan.md) last seen

    // Serve a live status page from the gateway itself (keep it open in a browser tab).
    //   GET /harness-status      → the viewer page
    //   GET /harness-status/log  → the tailable progress trail (text)
    // auth:"plugin" (we gate it ourselves) because gateway-auth requires a Bearer header a browser tab can't
    // send. Access: localhost needs no key; otherwise ?key=<statusKey or gateway token>. Low-sensitivity
    // content (phases/timings/model names — no prompt text, no secrets). Fail-open: never throws to the gateway.
    const statusKey = cfg.statusKey || (api.config && api.config.gateway && api.config.gateway.auth && api.config.gateway.auth.token) || null;
    const statusAuthed = (req) => {
      const a = String((req.socket && req.socket.remoteAddress) || "");
      if (a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1") return true; // same machine
      if (!statusKey) return false;
      const m = String(req.url || "").match(/[?&]key=([^&]+)/);
      return !!m && decodeURIComponent(m[1]) === statusKey;
    };
    if (typeof api.registerHttpRoute === "function") {
      try {
        api.registerHttpRoute({
          path: "/harness-status",
          match: "prefix",
          auth: "plugin",
          replaceExisting: true,
          handler: (req, res) => {
            try {
              if (!statusAuthed(req)) { res.writeHead(401, { "content-type": "text/plain" }); res.end("unauthorized — open from localhost or append ?key=<gateway token>"); return true; }
              if (String(req.url || "").includes("/harness-status/log")) {
                let body = "";
                try { body = readFileSync(PROGRESS_LOG, "utf8"); } catch { body = "(no turns logged yet)\n"; }
                const tail = body.split("\n").slice(-400).join("\n");
                res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
                res.end(tail);
              } else {
                res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
                res.end(STATUS_HTML);
              }
            } catch { try { res.writeHead(500); res.end("error"); } catch {} }
            return true; // handled
          },
        });
        log("http-route-registered", { path: "/harness-status" });
      } catch (e) { log("http-route-err", { e: String(e) }); }
    }

    // ---- before_prompt_build : plan / freeze / reasonableness / inject -----------------
    api.on("before_prompt_build", async (event, hookCtx) => {
      try {
        const agent = resolveAgentId(hookCtx);
        if (agent && agent !== onlyAgent) return; // experts / hatter unaffected
        const prompt = String((event && event.prompt) || "");
        const sessionKey = String((hookCtx && hookCtx.sessionKey) || "");
        const ids = idKeys(event, hookCtx);

        const hotTake = isHotTake(prompt);
        const { ralph, iter } = detectRalph(sessionKey, prompt);
        const tri = triage(prompt);
        // Record this turn for the enforcement gate (decision happens at finalize).
        const rec = gateStart(gate, ids.length ? ids : [sessionKey || "_"], { prompt, trivial: tri.trivial, hotTake, ralph });
        rec.progress = { lastHeaderTs: rec.ts, total: null, preflightMs: null, headerEmitted: false };
        rec.tid = Math.random().toString(36).slice(2, 6); // short turn id for the progress log

        if (hotTake) { log("bypass-hottake", { sk: sessionKey }); plog(rec, "#hottake → harness OFF for this turn (manager answers raw)"); return; }

        // ---------- Ralph mode ----------
        if (ralph) {
          const rubricExists = existsSync(RALPH_RUBRIC);
          if (iter === 1 || !rubricExists) {
            const goal = extractRalphGoal(prompt) || readFile(RALPH_GOAL);
            const out = await ollamaChat(ollamaUrl, plannerModel,
              buildPlannerSystemPrompt(experts), buildPlannerUserPrompt("", { ralphGoal: goal }), plannerTimeoutMs);
            const parsed = out ? parsePlannerOutput(out, experts) : { ok: false };
            if (parsed.ok) {
              writeFile(RALPH_RUBRIC, "# Ralph goal rubric — FROZEN at iteration 1 (do not append across iterations)\n\n" +
                "## Solution criteria\n" + parsed.rubric.map((r) => "- " + r).join("\n") +
                "\n\n## Expert roles for the run\n" + parsed.dispatch.map((d) => `- ${d.expert}: ${d.ask}`).join("\n") + "\n");
              log("ralph-rubric-frozen", { criteria: parsed.rubric.length, dispatch: parsed.dispatch.length });
              lastPlanSig.set(sessionKey, md5(readFile(RALPH_PLAN)));
              return { appendSystemContext: renderInjection(parsed, { ralphIter: iter || 1, byteBudget }) };
            }
            log("ralph-iter1-planner-failed", {});
            return; // fail-open
          }
          // iter 2+ : reasonableness gate ONLY when plan.md changed materially
          const plan = readFile(RALPH_PLAN);
          const sig = md5(plan);
          if (sig === lastPlanSig.get(sessionKey)) { log("ralph-plan-unchanged", { iter }); return; }
          lastPlanSig.set(sessionKey, sig);
          const out = await ollamaChat(ollamaUrl, plannerModel,
            buildReasonablenessSystemPrompt(),
            buildReasonablenessUserPrompt({ rubric: readFile(RALPH_RUBRIC), goal: extractRalphGoal(prompt) || readFile(RALPH_GOAL), plan, scratch: readFile(SCRATCH) }),
            reasonTimeoutMs);
          const verdict = out ? parseReasonableness(out) : { verdict: "ok", note: "" };
          try { appendFileSync(REASON_FILE, `${new Date().toISOString()} iter=${iter} ${verdict.verdict}${verdict.note ? " — " + verdict.note : ""}\n`); } catch {}
          log("ralph-reasonableness", { iter, verdict: verdict.verdict });
          return { appendSystemContext: renderReasonablenessInjection(verdict, iter) };
        }

        // ---------- Normal turns ----------
        if (tri.trivial) { log("bypass-trivial", { reason: tri.reason, sk: sessionKey }); plog(rec, `trivial (${tri.reason}) → manager answers directly, no planner`); return; }

        plog(rec, `preflight: loading ${plannerModel} + planning (this is the silent gap — heartbeats follow)`);
        const out = await withHeartbeat(rec, `loading/planning on ${plannerModel}`, () =>
          ollamaChat(ollamaUrl, plannerModel, buildPlannerSystemPrompt(experts), buildPlannerUserPrompt(prompt), plannerTimeoutMs));
        const parsed = out ? parsePlannerOutput(out, experts) : { ok: false };
        if (!parsed.ok) { log("planner-failed-or-empty", { sk: sessionKey }); plog(rec, "planner failed/timed out → proceeding WITHOUT a plan (fail-open)"); return; } // fail-open
        plog(rec, `preflight done → plan injected (${parsed.rubric.length} criteria, dispatch: ${parsed.dispatch.map((d) => d.expert).join(",") || "none"})`);
        if (showProgress) {
          // total steps ≈ preflight + each dispatched expert + critic; lastHeaderTs starts AFTER the planner
          // load so the first header reports preflight time separately (the wait the operator most wants to see).
          rec.progress.total = (parsed.phases.length || parsed.dispatch.length + 2);
          rec.progress.preflightMs = Date.now() - rec.ts;
          rec.progress.lastHeaderTs = Date.now();
        }
        // Persist (replace-on-turn, never append) so the Critic + the operator can audit the contract.
        writeFile(RUBRIC_FILE, "# Preflight rubric — last turn (replace-on-turn)\n\n" +
          "## Request\n" + prompt.slice(0, 600).replace(/\n+/g, " ") + "\n\n" +
          "## Solution criteria\n" + parsed.rubric.map((r) => "- " + r).join("\n") +
          "\n\n## Dispatch\n" + (parsed.dispatch.length ? parsed.dispatch.map((d) => `- ${d.expert}: ${d.ask}`).join("\n") : "- none") + "\n");
        log("inject-plan", { criteria: parsed.rubric.length, dispatch: parsed.dispatch.map((d) => d.expert) });
        return { appendSystemContext: renderInjection(parsed, { byteBudget }) };
      } catch (e) { log("err-prompt-build", { e: String(e) }); return; } // fail-open
    }, { priority: 50 });

    // ---- after_tool_call : feed the enforcement gate -----------------------------------
    api.on("after_tool_call", async (event, hookCtx) => {
      try {
        const agent = resolveAgentId(hookCtx) || (hookCtx && hookCtx.agentId);
        if (agent && agent !== onlyAgent) return;
        const ids = idKeys(event, hookCtx);
        gateRecordTool(gate, ids, { toolName: event && event.toolName, params: event && event.params });
        // Progress trail: surface delegation/yield so the pending state is visible while experts run.
        const tn = String((event && event.toolName) || "");
        if (tn === "sessions_spawn" || tn === "sessions_yield") {
          const rec = (() => { for (const k of ids) { const r = gate.runs.get(k); if (r) return r; } return null; })();
          if (rec && !rec.hotTake) {
            const who = String((event && event.params && (event.params.agentId || event.params.agent)) || "expert");
            plog(rec, tn === "sessions_spawn" ? `spawned ${who} (loading its model…)` : `yielded — waiting on ${who}`);
            if (tn === "sessions_spawn") startExpertWatch(rec, who); // heartbeat while it runs
          }
        }
      } catch (e) { log("err-after-tool", { e: String(e) }); }
    }, { priority: 50 });

    // ---- subagent_ended : surface each expert's OUTCOME in the progress trail (ok/error/timeout) ----
    // Without this, an expert that errors or times out is silent (the failure lives in the child session).
    api.on("subagent_ended", async (event, hookCtx) => {
      try {
        const rec = (() => { for (const k of idKeys(event, hookCtx)) { const r = gate.runs.get(k); if (r) return r; } return gate.last; })();
        if (!rec || !rec.tid) return;
        let who = String((hookCtx && hookCtx.agentId) || (event && event.agentId) || "");
        if (!who || who === onlyAgent) who = "expert";
        const outcome = String((event && event.outcome) || "?");
        const err = event && event.error ? ` — ${String(event.error).slice(0, 140)}` : "";
        stopExpertWatch(rec); // expert finished — stop the waiting heartbeat
        plog(rec, `${outcome === "ok" ? "✅" : "❌"} ${who} ended: ${outcome}${err}`);
      } catch (e) { log("err-subagent-ended", { e: String(e) }); }
    }, { priority: 50 });

    // ---- reply_payload_sending : prepend the timing/step header to visible MANAGER replies ----
    // Only fires for turns where the planner ran (rec.progress.total set) → main, non-trivial,
    // non-#hottake, non-Ralph. Debounced so chunked replies get one header. Fail-OPEN (never block a reply).
    api.on("reply_payload_sending", async (event, hookCtx) => {
      try {
        if (!showProgress) return;
        const rec = (() => { for (const k of idKeys(event, hookCtx)) { const r = gate.runs.get(k); if (r) return r; } return null; })();
        if (!rec || !rec.progress || rec.progress.total == null) return;
        if (rec.hotTake || rec.trivial || rec.ralph) return;
        const p = event && event.payload;
        const kind = event && event.kind;
        // DIAGNOSTIC: log every reply_payload_sending we see (kind + flags + length) so we can tell
        // which payload is the user-visible one and whether streaming pre-renders it.
        log("reply-seen", { kind, reasoning: !!(p && p.isReasoning), status: !!(p && p.isStatusNotice), err: !!(p && p.isError), len: (p && typeof p.text === "string") ? p.text.length : 0 });
        if (rec.progress.headerEmitted) return;                                  // one header per turn
        if (kind !== "final") return;                                           // ONLY the user-visible final answer (not reasoning/block/tool chunks)
        if (!p || typeof p.text !== "string" || !p.text.trim()) return;
        if (p.isReasoning || p.isStatusNotice || p.isError || p.isCompactionNotice || p.isFallbackNotice) return;
        const now = Date.now();
        const header = buildProgressHeader({
          totalMs: now - rec.ts,
          stepMs: now - rec.progress.lastHeaderTs,
          preflightMs: rec.progress.preflightMs,
          label: rec.spawns.length ? rec.spawns[rec.spawns.length - 1] : "preflight",
          n: rec.spawns.length + 1,
          x: rec.progress.total,
          first: !rec.progress.headerEmitted,
        });
        rec.progress.headerEmitted = true;
        log("progress-header", { totalS: Math.round((now - rec.ts) / 1000), n: rec.spawns.length + 1 });
        plog(rec, `✅ final reply delivered (total ${Math.round((now - rec.ts) / 1000)}s)`);
        return { payload: { ...p, text: header + "\n\n" + p.text } };
      } catch (e) { log("err-progress", { e: String(e) }); }
    }, { priority: 50 });

    // ---- before_agent_finalize : enforcement gate (shadow | enforce) -------------------
    api.on("before_agent_finalize", async (event, hookCtx) => {
      try {
        const agent = resolveAgentId(hookCtx);
        if (agent && agent !== onlyAgent) return;
        const ids = idKeys(event, hookCtx);
        const rec = (() => { for (const k of ids) { const r = gate.runs.get(k); if (r) return r; } return gate.last; })();
        stopExpertWatch(rec); // turn finalizing — stop any expert-wait heartbeat
        const d = gateDecision(rec, { mode: gateMode });
        if (!d.fire) { log("gate-pass", { reason: d.reason }); plog(rec, `gate: pass (${d.reason}) → finalizing`); return; }
        plog(rec, `gate: FIRE (${d.reason}) — ${gateMode === "enforce" ? "forcing one revise pass" : "shadow-logged only"}`);
        // Audit every WOULD-fire, in both modes, so the eval suite + the operator can measure the false-positive rate.
        const key = (ids[0] || "t" + Date.now());
        const line = `${new Date().toISOString()} ${gateMode.toUpperCase()} fire reason="${d.reason}" spawns=[${(rec.spawns || []).join(",")}] prompt="${(rec.prompt || "").slice(0, 120).replace(/\n+/g, " ")}"`;
        try { appendFileSync(GATE_LOG, line + "\n"); } catch {}
        log("gate-fire", { mode: gateMode, reason: d.reason, spawns: rec.spawns });
        if (gateMode !== "enforce") return; // shadow: observe only
        return {
          action: "revise",
          reason: "preflight-planner gate: " + d.reason,
          retry: {
            instruction: "STOP: this was a non-trivial turn that wrote files or ran commands, but you " + d.reason +
              ". Per the harness contract you must delegate the substantive work to experts (sessions_spawn) AND gate your draft " +
              "through the `critic` (gpt-oss) against the preflight rubric BEFORE replying. Do that now, then reply.",
            idempotencyKey: "preflight-gate:" + key,
            maxAttempts: 1,
          },
        };
      } catch (e) { log("err-finalize", { e: String(e) }); return; } // fail-open
    }, { priority: 50 });
  },
});
