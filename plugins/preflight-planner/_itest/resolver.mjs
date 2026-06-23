// Module-resolution hook: redirect ONLY `openclaw/plugin-sdk/plugin-entry` to the local stub,
// so the integration test can import the real ../index.js without the openclaw package present.
// Everything else (node:fs, node:crypto, ./lib.js) passes through unchanged.
const STUB = new URL("./oc-stub.mjs", import.meta.url).href;
export function resolve(specifier, context, nextResolve) {
  if (specifier === "openclaw/plugin-sdk/plugin-entry") return { url: STUB, shortCircuit: true };
  return nextResolve(specifier, context);
}
