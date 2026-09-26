// Guards the house style for user-facing copy: no em dashes (—) in anything
// the app displays. See docs/AI-GUIDELINES.md ("No em dashes in user-facing
// copy") for how to rework a sentence instead. Code comments are exempt, and
// this codebase's own comments and docs use em dashes constantly, which is
// exactly why new copy keeps picking them up without a check.
//
// esbuild (already installed as Vite's compiler) strips every JS comment and
// keeps every string, template literal and piece of JSX text, so whatever em
// dash survives the transform is one the app can actually show.
// minifyWhitespace is what makes the stripping complete: without it, esbuild
// keeps comments that sit inside expressions. The one exception is App.jsx's
// CSS, a template literal whose /* ... */ comments survive as string
// content; those are removed before checking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(js|jsx|mjs)$/.test(name) ? [p] : [];
  });
}

function emDashesInCopy(file) {
  const { code } = transformSync(readFileSync(file, "utf8"), {
    loader: "jsx",
    legalComments: "none",
    charset: "utf8",
    minifyWhitespace: true,
  });
  const copy = code.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...copy.matchAll(/—/g)].map((m) => `${file}: …${copy.slice(Math.max(0, m.index - 60), m.index + 40)}…`);
}

test("no em dashes in user-facing copy anywhere in src/", () => {
  assert.deepEqual(sourceFiles("src").flatMap(emDashesInCopy), []);
});
