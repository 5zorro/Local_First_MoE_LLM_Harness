// Standalone unit test for the pure allowlist logic (no gateway needed): `node test.mjs`
import { hostAllowed, extractUrl, DEFAULT_ALLOW } from "./lib.js";

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log("  ✅", name); } else { fail++; console.log("  ❌", name); } }

console.log("# web-allowlist lib tests");
// allowed: exact + subdomain + wildcard
check("github.com exact",            hostAllowed("https://github.com/x/y", DEFAULT_ALLOW).ok === true);
check("api.github.com subdomain",    hostAllowed("https://api.github.com/repos", DEFAULT_ALLOW).ok === true);
check("readthedocs wildcard sub",    hostAllowed("https://foo.readthedocs.io/en/latest", DEFAULT_ALLOW).ok === true);
check("docs.python.org exact",       hostAllowed("https://docs.python.org/3/", DEFAULT_ALLOW).ok === true);
// blocked: off-allowlist, scheme, garbage, lookalike
check("evil.com blocked",            hostAllowed("https://evil.com/pwn", DEFAULT_ALLOW).ok === false);
check("file scheme blocked",         hostAllowed("file:///etc/passwd", DEFAULT_ALLOW).ok === false);
check("unparseable blocked",         hostAllowed("not a url", DEFAULT_ALLOW).ok === false);
check("lookalike githubXcom blocked",hostAllowed("https://github.com.evil.net/x", DEFAULT_ALLOW).ok === false);
check("subdomain-suffix trick",      hostAllowed("https://notgithub.com/x", DEFAULT_ALLOW).ok === false);
// custom allowlist
check("custom allow honored",        hostAllowed("https://example.org/a", ["example.org"]).ok === true);
check("*.x only matches sub",        hostAllowed("https://x.com/a", ["*.x.com"]).ok === false);
check("*.x matches sub",             hostAllowed("https://a.x.com/a", ["*.x.com"]).ok === true);
// extractUrl
check("extractUrl url field",        extractUrl({ url: "https://github.com" }) === "https://github.com");
check("extractUrl missing -> null",  extractUrl({ q: "hi" }) === null);

console.log(`\n--- ${pass} passed, ${fail} failed ---`);
process.exit(fail ? 1 : 0);
