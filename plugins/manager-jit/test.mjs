// Standalone tests for manager-jit lib, run against the REAL runbook: `node test.mjs`
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRunbook, selectSections, renderRunbook, scoreSection, termSet, resolveAgentId } from "./lib.js";

const RUNBOOK = join(dirname(fileURLToPath(import.meta.url)), "../../memory/MANAGER-RUNBOOK.md");
const md = readFileSync(RUNBOOK, "utf8");
const secs = parseRunbook(md);

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log("  ✅", n)) : (fail++, console.log("  ❌", n)));
const tags = (sel) => sel.selected.map((s) => s.tag);

console.log("# manager-jit lib tests (against real MANAGER-RUNBOOK.md)");
ok("parsed >=10 sections", secs.length >= 10);
ok("no [always] section (SOUL owns the always-on core)", !secs.some((s) => s.always));
ok("every section has bytes>0", secs.every((s) => s.bytes > 0));

// git-flavored prompt → [git] selected, unrelated sections not
let sel = selectSections(secs, "help me commit this and explain the git undo before you push", { byteBudget: 6000 });
ok("git prompt selects [git]", tags(sel).includes("git"));
ok("git prompt skips [ralph]", !tags(sel).includes("ralph"));

// delegation/search prompt → [delegation] and/or [research]
sel = selectSections(secs, "where is the function that handles the todo list? grep the codebase", { byteBudget: 6000 });
ok("search prompt selects delegation or research", tags(sel).includes("delegation") || tags(sel).includes("research"));

// budget truncation: tiny budget fits nothing → selects 0 + truncated
sel = selectSections(secs, "commit and delegate and fetch and critic and debrief", { byteBudget: 50 });
ok("tiny budget selects nothing", sel.selected.length === 0);
ok("tiny budget truncates", sel.truncated === true);

// partial budget (~1 section) → selects >=1, truncates, marker rendered
const multi = "commit delegate fetch critic debrief ralph variant compaction";
const full = selectSections(secs, multi, { byteBudget: 100000 });
const part = selectSections(secs, multi, { byteBudget: full.selected[0].bytes + 10 });
ok("partial budget selects >=1 and truncates", part.selected.length >= 1 && part.truncated === true);
ok("render shows truncation marker", /runbook:.*sections shown/.test(renderRunbook(part)));

// unrelated prompt → nothing scores → nothing selected (criticals come from SOUL)
sel = selectSections(secs, "hello good morning", { byteBudget: 6000 });
ok("greeting selects nothing", sel.selected.length === 0);

// scoring sanity + agentId
ok("git section scores on git terms", scoreSection(termSet("git commit undo push"), secs.find((s) => s.tag === "git")) > 0);
ok("resolveAgentId agentId field", resolveAgentId({ agentId: "main" }) === "main");
ok("resolveAgentId from sessionKey", resolveAgentId({ sessionKey: "agent:tool-use:abc" }) === "tool-use");
ok("resolveAgentId from workspaceDir main", resolveAgentId({ workspaceDir: "/home/pi/.openclaw/workspace" }) === "main");
ok("resolveAgentId from workspaceDir cloud", resolveAgentId({ workspaceDir: "/home/pi/.openclaw/workspace-cloud" }) === "cloud");
ok("resolveAgentId from workspaceDir expert", resolveAgentId({ workspaceDir: "/home/pi/agent-harness/workspaces/critic" }) === "critic");

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
