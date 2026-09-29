// Guards syntax the production build can't make safe for its oldest
// supported browsers. Vite 5's default build target includes Safari 14, and
// esbuild does not rewrite regex lookbehind ((?<=…) / (?<!…)), which Safari
// only supports from 16.4 — a single one anywhere in the bundle makes the
// whole app fail to load there (a blank page, not just one broken screen).
// Found in review of Pass 101 (components/tabs/technique/format.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(js|jsx|mjs)$/.test(name) ? [p] : [];
  });
}

test("no regex lookbehind anywhere in src/ (unsupported before Safari 16.4)", () => {
  const offenders = sourceFiles("src").filter((f) => /\(\?<[=!]/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

// crypto.randomUUID() only exists from Safari 15.4 (and only on https or
// localhost), so on Safari 14 it throws "not a function" the moment the app
// tries to make a new piece, work, scale, method or focus spot. New ids come
// from newId (lib/utils.js), which uses crypto.getRandomValues instead.
// Pass 107.
test("no randomUUID anywhere in src/ (unsupported before Safari 15.4)", () => {
  const offenders = sourceFiles("src").filter((f) => readFileSync(f, "utf8").includes("randomUUID"));
  assert.deepEqual(offenders, []);
});

// The same lookbehind rule, applied to what actually ships. The checks above
// read src/ only, but a library's code (the Supabase client, from Pass 109 on)
// goes into the build without ever passing through src/. This reads
// dist/assets/*.js, so it only means something right after `npm run build`
// (a stale dist/ gives a stale answer); with no build there to read, it skips
// and says so rather than passing silently. Pass 108.
const bundleDir = join("dist", "assets");
const bundleFiles = existsSync(bundleDir)
  ? readdirSync(bundleDir).filter((n) => n.endsWith(".js")).map((n) => join(bundleDir, n))
  : [];
test(
  "no regex lookbehind in the built bundle, dist/assets/*.js (unsupported before Safari 16.4)",
  { skip: bundleFiles.length === 0 ? "no build to scan: run `npm run build` first" : false },
  () => {
    const offenders = bundleFiles.filter((f) => /\(\?<[=!]/.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  }
);
