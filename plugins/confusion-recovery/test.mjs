// Standalone tests for confusion-recovery lib: `node test.mjs`
import { makeState, recordTool, takePending, errSignature, recoveryTip, argsSummary, buildHint } from "./lib.js";

let pass = 0, fail = 0;
const ok = (n, c) => (c ? (pass++, console.log("  ✅", n)) : (fail++, console.log("  ❌", n)));

console.log("# confusion-recovery lib tests");

// errSignature groups same error with different path/number
ok("sig ignores paths/numbers",
   errSignature("ENOENT: no such file /home/pi/a/b.md (errno 2)") === errSignature("ENOENT: no such file /var/x/y.txt (errno 9)"));

// recoveryTip routing
ok("tip: path error", /absolute path/i.test(recoveryTip("Path escapes sandbox root")));
ok("tip: denied", /delegate|approval/i.test(recoveryTip("command not allowlisted; approval required")));
ok("tip: network", /unreachable|egress|hammer/i.test(recoveryTip("curl: (7) Failed to connect: ECONNREFUSED")));
ok("tip: generic fallback", /stop retrying/i.test(recoveryTip("weird unknown thing")));
// bounded-grep tip: keyed on a grep/rg command, or on a regex/search error
ok("tip: bounded grep (rg command)", /max-count|bounded-search|head -50/i.test(recoveryTip("exit code 1", "rg TODO /home/pi")));
ok("tip: bounded grep (regex error)", /max-count|bounded-search/i.test(recoveryTip("regex parse error: unbalanced parenthesis", "")));
ok("tip: non-grep unaffected (path still wins)", /absolute path/i.test(recoveryTip("Path escapes sandbox root", "ls /x")));

// argsSummary extracts the useful field
ok("argsSummary command", argsSummary({ command: "rg -n TODO /x" }) === "rg -n TODO /x");
ok("argsSummary path", argsSummary({ path: "/home/pi/x" }) === "/home/pi/x");

// no trigger on first error; trigger on the 2nd same-sig error
const st = makeState();
let r = recordTool(st, { sessionKey: "s1", agentId: "ops-expert", toolName: "exec", params: { command: "curl x" }, error: "denied: not allowlisted", toolCallId: "c1" });
ok("1st error: no trigger", r.triggered === false);
r = recordTool(st, { sessionKey: "s1", agentId: "ops-expert", toolName: "exec", params: { command: "curl x" }, error: "denied: not allowlisted", toolCallId: "c2" });
ok("2nd same error: triggers", r.triggered === true);
ok("hint names the tool + count", /`exec` has failed 2×/.test(r.hint));
ok("hint includes a fix", /Likely fix:/.test(r.hint));
ok("hint suggests TOOLS.md", /ops-expert's TOOLS\.md/.test(r.hint));

// pending retrieval by toolCallId (one-shot)
ok("takePending returns the hint", typeof takePending(st, "c2") === "string");
ok("takePending is one-shot", takePending(st, "c2") === null);

// a success resets the consec counter
recordTool(st, { sessionKey: "s1", toolName: "exec", params: { command: "ls" }, toolCallId: "c3" }); // ok (no error)
r = recordTool(st, { sessionKey: "s1", toolName: "exec", params: { command: "curl x" }, error: "denied: not allowlisted", toolCallId: "c4" });
ok("error after success: back to 1st (no trigger)", r.triggered === false);

// a DIFFERENT error signature resets the streak
const st2 = makeState();
recordTool(st2, { sessionKey: "s", toolName: "read", params: { path: "/a" }, error: "ENOENT no such file /a", toolCallId: "x1" });
r = recordTool(st2, { sessionKey: "s", toolName: "read", params: { path: "/b" }, error: "permission denied /b", toolCallId: "x2" });
ok("different error sig: no trigger", r.triggered === false);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
