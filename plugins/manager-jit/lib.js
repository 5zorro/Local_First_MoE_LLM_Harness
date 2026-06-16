// Pure, dependency-free logic for manager-jit (P1-1 JIT runbook selection). Unit-tested in test.mjs.
// No openclaw import here so it runs under plain `node`.

const STOP = new Set(
  ("the a an of to and or is are be in on for with your you i it this that as at by from we our do does " +
   "not no yes if then else when how what why can will would should could into out up down über").split(/\s+/)
);

export function tokenize(s) { return String(s || "").toLowerCase().match(/[a-z0-9_]+/g) || []; }
export function termSet(s) { return new Set(tokenize(s).filter((t) => t.length > 2 && !STOP.has(t))); }

// Parse runbook markdown into sections keyed by `## [tag] Title` headings.
export function parseRunbook(md) {
  const sections = [];
  let cur = null;
  for (const line of String(md || "").split(/\r?\n/)) {
    const m = line.match(/^##\s*\[([a-z0-9_-]+)\]\s*(.*)$/i);
    if (m) { if (cur) sections.push(finalize(cur)); cur = { tag: m[1].toLowerCase(), title: m[2].trim(), bodyLines: [] }; }
    else if (cur) cur.bodyLines.push(line);
  }
  if (cur) sections.push(finalize(cur));
  return sections;
}

function finalize(cur) {
  const body = cur.bodyLines.join("\n").trim();
  const km = body.match(/^keywords:\s*(.*)$/im);
  const kw = km ? km[1] : "";
  const text = `## [${cur.tag}] ${cur.title}\n${body}`.trim();
  return {
    tag: cur.tag, title: cur.title, body, text,
    bytes: Buffer.byteLength(text, "utf8"),
    keywords: termSet(`${kw} ${cur.title} ${cur.tag}`), // high-weight terms
    bodyTerms: termSet(body),                           // low-weight terms
    always: cur.tag === "always",
  };
}

// keyword hit = 3, body-only hit = 1.
export function scoreSection(promptTerms, section) {
  let s = 0;
  for (const t of promptTerms) {
    if (section.keywords.has(t)) s += 3;
    else if (section.bodyTerms.has(t)) s += 1;
  }
  return s;
}

// Always-on sections are included unconditionally; the rest are ranked by score and packed under byteBudget.
export function selectSections(sections, prompt, opts = {}) {
  const byteBudget = opts.byteBudget ?? 6000;
  const minScore = opts.minScore ?? 2;
  const promptTerms = termSet(prompt);
  const always = sections.filter((s) => s.always);
  const ranked = sections
    .filter((s) => !s.always)
    .map((s) => ({ s, score: scoreSection(promptTerms, s) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || a.s.bytes - b.s.bytes);

  const selected = [...always];
  let used = always.reduce((n, s) => n + s.bytes, 0);
  const dropped = [];
  for (const { s } of ranked) {
    if (used + s.bytes <= byteBudget) { selected.push(s); used += s.bytes; }
    else dropped.push(s);
  }
  return { selected, dropped, usedBytes: used, truncated: dropped.length > 0, promptTerms: [...promptTerms] };
}

export function renderRunbook(sel) {
  if (!sel.selected.length) return "";
  let out = "# Manager runbook — sections selected for THIS turn (auto-injected; not the whole runbook)\n\n";
  out += sel.selected.map((s) => s.text).join("\n\n");
  if (sel.truncated) {
    out += `\n\n[runbook: ${sel.selected.length} of ${sel.selected.length + sel.dropped.length} sections shown; ` +
           `omitted for budget: ${sel.dropped.map((s) => s.tag).join(", ")} — ask for them or narrow the task]`;
  }
  return out;
}

// Resolve the agent id from the hook's PluginHookAgentContext (2nd handler arg):
// prefer agentId, else parse "agent:<id>:..." sessionKey, else infer from workspaceDir.
export function resolveAgentId(ctx) {
  if (!ctx) return null;
  if (ctx.agentId) return String(ctx.agentId);
  const sk = String(ctx.sessionKey || ctx.sessionId || "");
  const m = sk.match(/^agent:([^:]+):/);
  if (m) return m[1];
  const wd = String(ctx.workspaceDir || "").replace(/\/+$/, "");
  if (wd.includes("workspace-cloud")) return "cloud";
  const wm = wd.match(/agent-harness\/workspaces\/([^/]+)/);
  if (wm) return wm[1];
  if (wd.endsWith("/.openclaw/workspace")) return "main";
  return null;
}
