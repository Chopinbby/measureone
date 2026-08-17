// Proof that Pass 29's Interleaved mode (eligibility + the skip branch)
// works correctly on a piece saved by an app version well before this
// pass — or even before the ladder itself existed. This does NOT mirror
// storage.js; it imports and runs the real, exported
// `validateAndMigratePiece`, the actual function every saved piece is
// loaded through, so this is a genuine migration proof, not a
// reimplementation of one.
//
// `oldPiece` below mirrors storage.test.mjs's own `midPlan` fixture
// (representative of a real pre-ladder save): sessions keyed by the old
// `effectiveness` field instead of `outcome`, no `stage`/`practiceBPM`/
// `nextDueDate`, no `ladderConfig`, no `documents`/`bpmZones`/`revival` —
// nothing this pass (or several before it) added.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import { isInterleaveEligible } from "../src/lib/ladder.js";
import { loggedSessions, sumPracticeSeconds } from "../src/lib/utils.js";
import { computeAutoConfidence } from "../src/lib/confidence.js";

const oldPiece = {
  id: "p_old",
  name: "Old Sonata",
  totalMeasures: 40,
  startDate: "2026-01-01",
  progress: {
    c1: {
      doneDays: [1, 2, 5],
      sessions: [
        { day: 1, cleanReps: 3, bpm: 60, effectiveness: "good", durationSeconds: 120 },
        { day: 5, cleanReps: 4, bpm: 66, effectiveness: "high", durationSeconds: 90 },
      ],
      currentBPM: 66,
    },
  },
};

describe("Old (pre-ladder) piece data through validateAndMigratePiece, then through Interleaved mode", () => {
  test("migrates without throwing, with real ladder defaults backfilled", () => {
    const migrated = validateAndMigratePiece(oldPiece);
    assert.ok(migrated, "migration must not return null for a valid old piece");
    assert.equal(migrated.progress.c1.stage, null, "no ladder history to infer a stage from — correctly null, not a guess");
    assert.ok(migrated.ladderConfig, "ladderConfig backfilled even though the old piece never had one");
    assert.equal(migrated.progress.c1.sessions.length, 2, "the two real old sessions survive migration untouched");
  });

  test("isInterleaveEligible correctly excludes a migrated old chunk (stage: null) — no crash, no false eligibility", () => {
    const migrated = validateAndMigratePiece(oldPiece);
    assert.equal(isInterleaveEligible(migrated.progress.c1), false);
  });

  test("once a migrated old chunk is later practiced up to Settling/Holding, it becomes interleave-eligible like any other chunk", () => {
    const migrated = validateAndMigratePiece(oldPiece);
    // Simulates what real practice sessions logged after migration would
    // eventually produce — not re-deriving computeLadderAdvance here (that
    // has its own dedicated tests in ladder.test.mjs), just confirming
    // isInterleaveEligible reads whatever real state ends up on a
    // migrated entry the same way it reads a chunk that was always native
    // to this app version.
    const advanced = { ...migrated.progress.c1, stage: "settling" };
    assert.equal(isInterleaveEligible(advanced), true);
  });

  test("loggedSessions correctly keeps old, pre-`outcome`-field sessions (they were never 'skipped', they just predate that field)", () => {
    const migrated = validateAndMigratePiece(oldPiece);
    const kept = loggedSessions(migrated.progress.c1.sessions);
    assert.equal(kept.length, 2, "old sessions have no `skipped` field at all, so !s.skipped is true for both — nothing is wrongly excluded");
  });

  test("computeAutoConfidence runs without throwing on a migrated old chunk (legacy `effectiveness`-keyed sessions, no `outcome` field)", () => {
    const migrated = validateAndMigratePiece(oldPiece);
    const chunk = { id: "c1", kind: "section", difficultyLabel: "medium", start: 1, end: 4, recurring: false };
    const piece = { targetBPM: 100, bpmZones: [], progress: migrated.progress };
    const conf = computeAutoConfidence(chunk, piece, 5);
    assert.ok(conf >= 0 && conf <= 100, `expected a valid 0-100 score, got ${conf}`);
  });

  // The skip branch itself is a closure inside App.jsx (see
  // interleave-skip.test.mjs's header comment for why this repo mirrors
  // it in tests rather than importing it). This proves the mirror's
  // behavior end-to-end against a REAL migrated old piece, not a
  // hand-built fresh one — the point being that nothing about "this
  // chunk's data predates the ladder" trips up the skip path once the
  // chunk is otherwise eligible.
  function mirroredSkip(prevEntry, day, durationSeconds, loggedAt, loggedDate) {
    const sessions = [...(prevEntry.sessions || []), { day, loggedAt, loggedDate, skipped: true, durationSeconds }];
    return { ...prevEntry, sessions };
  }

  test("skip on a migrated-from-old, now-eligible chunk: appends the session, does not mark the day done, does not touch the backfilled ladder fields", () => {
    const migrated = validateAndMigratePiece(oldPiece);
    const eligibleEntry = { ...migrated.progress.c1, stage: "holding", practiceBPM: 96, nextDueDate: "2026-08-01" };

    const result = mirroredSkip(eligibleEntry, 9, 200, 5000, "2026-08-16");

    assert.equal(result.sessions.length, 3, "the two old sessions plus the new skip");
    assert.equal(result.sessions[2].skipped, true);
    assert.deepEqual(result.doneDays, [1, 2, 5], "day 9 is NOT added — old doneDays untouched, matches the non-legacy behavior");
    assert.equal(result.stage, "holding", "ladder state carried through migration is untouched by the skip");
    assert.equal(result.practiceBPM, 96);
    assert.equal(result.nextDueDate, "2026-08-01");
  });

  test("sumPracticeSeconds still totals a migrated old piece's real session time plus a later skip's time", () => {
    const migrated = validateAndMigratePiece(oldPiece);
    const eligibleEntry = { ...migrated.progress.c1, stage: "holding" };
    const afterSkip = mirroredSkip(eligibleEntry, 9, 200, 5000, "2026-08-16");
    const piece = { progress: { c1: afterSkip } };
    // 120 + 90 (the two old sessions) + 200 (the new skip) = 410
    assert.equal(sumPracticeSeconds(piece), 410);
  });
});
