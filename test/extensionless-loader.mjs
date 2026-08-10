// src/lib/*.js uses extensionless relative imports ("./constants", not
// "./constants.js") — Vite resolves that for the real app, but Node's
// native ESM loader requires the extension. This hook retries a failed
// relative import with ".js" appended, purely so these test files can
// import the real source modules unmodified.
//
// Loaded via `--experimental-loader` (see the "test" script in
// package.json), not `node:module`'s `register()`/`registerHooks()` —
// those are newer APIs (register: Node 18.19+/20.6+; registerHooks: Node
// 22.15+ only) that would silently require a newer Node than this
// project's own toolchain promises. Vite 5 (already a dependency here)
// declares "engines": { "node": "^18.0.0 || >=20.0.0" } — the CLI flag is
// the one loading mechanism that actually covers that full range with no
// gap. See package.json's matching "engines" field.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !specifier.endsWith(".js")) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw err;
  }
}
