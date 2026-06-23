// Pure/testable core for confusion-recovery (critique P1-2b). No openclaw import.
// Detects a tool failing repeatedly with the same error and builds a recovery hint from the
// in-process history of that tool's recent calls this session (no subagent spawn needed).

const TTL_MS = 30 * 60 * 1000;

export function makeState() { return { sessions: new Map(), pending: new Map() }; }

// Normalize an error to a stable signature so "same error, different path/number" groups together.
export function errSignature(error) {
  let s = String(error || "").toLowerCase();
  s = s.replace(/0x[0-9a-f]+/g, "#")
       .replace(/\b\d+\b/g, "#")
       .replace(/(\/[^\s'":]+)+/g, "/PATH")
       .replace(/\s+/g, " ")
       .trim();
  return s.slice(0, 80);
}

const TIPS = [
  [/(escapes sandbox|enoent|no such file|not found|cannot find|outside[^.]*workspace|not a directory)/,
   "Path/location issue: use an ABSOLUTE path and check your working directory isn't what you assumed (cwd is usually the workspace, not the target dir)."],
  [/(denied|not allowlisted|approval|permission|not permitted|forbidden|blocked)/,
   "Permission/allowlist issue: this isn't permitted for this agent. Don't retry the same call — delegate to the expert that owns it (or ask for approval) and move on."],
  [/(timeout|timed out|econnrefused|network|unreachable|getaddrinfo|egress)/,
   "Connectivity issue: target unreachable or egress is blocked. Don't hammer it — verify the host/route, or route external fetches through the tool-use expert."],
  [/(unexpected token|parse|invalid json|syntax error|malformed)/,
   "Format issue: the input/command is malformed — fix the syntax instead of re-sending the same payload."],
];
export function recoveryTip(error, summary = "") {
  const s = String(error || "").toLowerCase();
  const cmd = String(summary || "").toLowerCase();
  // grep/search confusion → teach ONE tight, bounded search instead of re-scanning the tree
  if (/(^|[^a-z])(rg|grep|egrep|fgrep|ag|ripgrep)([^a-z]|$)/.test(cmd) ||
      /(regex|invalid pattern|unbalanced|argument list too long|binary file matches|no matches)/.test(s)) {
    return "Bounded-search fix: scope AND cap the search — `rg -n --max-count=20 -F 'literal' <specific/path>` " +
      "(or a precise anchored regex), narrow file types with `--glob '*.ext'`, and pipe `| head -50` to cap output. " +
      "Don't scan the whole tree, and don't put an unescaped shell glob in a path (e.g. `memory/2026-*.md` won't " +
      "expand for a missing file) — list the directory first, then read an exact file.";
  }
  for (const [re, tip] of TIPS) if (re.test(s)) return tip;
  return "You've hit the same error repeatedly — stop retrying the identical call. Change an input, verify your assumptions, or delegate.";
}

// short, readable summary of what the tool was called with
export function argsSummary(params) {
  try {
    if (params && typeof params === "object") {
      for (const k of ["command", "cmd", "path", "file", "url", "query"]) {
        if (typeof params[k] === "string") return params[k].slice(0, 120);
      }
    }
    return JSON.stringify(params ?? {}).slice(0, 120);
  } catch { return "(unprintable args)"; }
}

export function buildHint({ toolName, agentId, consec, history, error }) {
  const recent = (history || []).slice(-5).map((h) => `  - ${h.ok ? "ok " : "ERR"} ${h.summary}`).join("\n");
  const lastOk = [...(history || [])].reverse().find((h) => h.ok);
  const lastSummary = (history && history.length) ? history[history.length - 1].summary : "";
  const a = agentId || "this agent";
  return [
    ``,
    `⚠️ [confusion-recovery] \`${toolName}\` has failed ${consec}× in a row with the same error.`,
    `Recent \`${toolName}\` calls this session (newest last):`,
    recent || "  (no prior calls recorded)",
    lastOk ? `It last SUCCEEDED with: ${lastOk.summary}` : `No successful \`${toolName}\` call recorded this session.`,
    `Likely fix: ${recoveryTip(error, lastSummary)}`,
    `If this is a real recurring gotcha, add ONE concise dated line to ${a}'s TOOLS.md (workspaces/${a}/TOOLS.md).`,
  ].join("\n");
}

function gc(state, now) {
  for (const [k, v] of state.sessions) if (now - v.ts > TTL_MS) state.sessions.delete(k);
  for (const [k, v] of state.pending) if (now - v.ts > TTL_MS) state.pending.delete(k);
}

// Record a tool outcome. On the Nth consecutive same-error failure (>= threshold), stash a hint
// keyed by toolCallId and return { triggered:true, hint }. Otherwise { triggered:false }.
export function recordTool(state, ev, cfg = {}) {
  const threshold = cfg.threshold || 2;
  const maxHistory = cfg.maxHistory || 5;
  const now = ev.ts || Date.now();
  const tool = String(ev.toolName || "");
  if (!tool) return { triggered: false };
  const ok = !ev.error;
  const sig = ok ? null : errSignature(ev.error);
  const key = `${ev.sessionKey || "global"}::${tool}`;
  const rec = state.sessions.get(key) || { ts: now, consec: 0, lastSig: null, history: [] };
  rec.ts = now;
  rec.history.push({ ok, summary: argsSummary(ev.params), ts: now });
  if (rec.history.length > maxHistory) rec.history.shift();
  if (ok) { rec.consec = 0; rec.lastSig = null; }
  else if (sig && sig === rec.lastSig) { rec.consec += 1; }
  else { rec.consec = 1; rec.lastSig = sig; }
  state.sessions.set(key, rec);
  gc(state, now);

  if (!ok && rec.consec >= threshold && ev.toolCallId) {
    const hint = buildHint({ toolName: tool, agentId: ev.agentId, consec: rec.consec, history: rec.history, error: ev.error });
    state.pending.set(ev.toolCallId, { hint, ts: now });
    return { triggered: true, hint };
  }
  return { triggered: false };
}

export function takePending(state, toolCallId) {
  if (!toolCallId) return null;
  const p = state.pending.get(toolCallId);
  if (!p) return null;
  state.pending.delete(toolCallId);
  return p.hint;
}
