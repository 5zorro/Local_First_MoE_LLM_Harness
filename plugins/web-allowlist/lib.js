// Pure, dependency-free egress-allowlist logic (no openclaw import) so it is unit-testable
// standalone. index.js wires this into the before_tool_call hook.

// Sensible default allowlist (mirrors the tool-use expert's SOUL.md L4 list). Override via config.
export const DEFAULT_ALLOW = [
  "docs.python.org", "pypi.org", "github.com", "raw.githubusercontent.com",
  "developer.mozilla.org", "nodejs.org", "learn.microsoft.com",
  "*.readthedocs.io", "wikipedia.org", "docs.openclaw.ai",
];

// is `url` allowed under `domains`? Bare "x.com" matches x.com and *.x.com; "*.x.com" = subdomains only.
export function hostAllowed(url, domains) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, why: "unparseable-url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, why: "non-http-scheme:" + u.protocol };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  for (const raw of domains) {
    const d = String(raw).toLowerCase().trim();
    if (!d) continue;
    if (d.startsWith("*.")) {
      const base = d.slice(2);
      if (host.endsWith("." + base)) return { ok: true, matched: d }; // subdomains only (list the apex separately if wanted)
    } else if (host === d || host.endsWith("." + d)) {
      return { ok: true, matched: d };
    }
  }
  return { ok: false, why: "off-allowlist:" + host };
}

export function extractUrl(params) {
  if (!params || typeof params !== "object") return null;
  if (typeof params.url === "string") return params.url;
  for (const k of ["uri", "href", "link", "target"]) if (typeof params[k] === "string") return params[k];
  return null;
}
