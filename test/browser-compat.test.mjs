// Guards syntax the production build can't make safe for its oldest
// supported browsers. Vite 5's default build target includes Safari 14, and
// esbuild does not rewrite regex lookbehind ((?<=…) / (?<!…)), which Safari
// only supports from 16.4 — a single one anywhere in the bundle makes the
// whole app fail to load there (a blank page, not just one broken screen).
// Found in review of Pass 101 (components/tabs/technique/format.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
