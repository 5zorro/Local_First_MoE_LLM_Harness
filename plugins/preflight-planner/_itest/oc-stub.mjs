// Test-only stub for `openclaw/plugin-sdk/plugin-entry`. The real one (verified) is pure —
// it just constructs and returns the entry object with `register` passed through — so this
// faithful 1-liner lets the integration test load the REAL index.js with no openclaw install.
export const definePluginEntry = (entry) => entry;
// The runtime builds an OpenClawPluginConfigSchema from a JSON schema; for the offline test we
// pass config straight through ctx.config, so this is a no-op that just returns the schema.
export const buildJsonPluginConfigSchema = (schema) => schema;
