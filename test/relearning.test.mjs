// Pass 11 — the four re-learning rules for progress[id].needsRelearning
// (docs/Decisions.md#spaced-repetition--maintenance,
// docs/Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built).
//
// The stage-math half of these rules lives in test/ladder.test.mjs (it's
// all inside computeLadderAdvance). This file covers the parts that span
// modules: rule 1's "a flagged chunk produces zero due reviews" across
// both scheduling surfaces, rule 2's manual override, and the migration.
//
// handleClearRelearning is a closure inside the App component (App.jsx),
// not an exported function, and this repo has no React render harness —
// same constraint noted in test/session-undo.test.mjs. The helper below is
// a line-for-line mirror of that reducer body.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateAllChunks } from "../src/lib/chunking.js";
import { computeTimeline } from "../src/lib/scheduling.js";
import { computeDueReviews } from "../src/lib/maintenance.js";
import { computeLadderAdvance } from "../src/lib/ladder.js";
import { validateAndMigratePiece } from "../src/lib/storage.js";

const LADDER_CONFIG = {
  stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
  settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
  holding: {
    startIntervalDays: 14,
    maxIntervalDays: 70,
    tempoFloorStartFraction: 0.85,
    tempoFloorStepFraction: 0.05,
    tempoFloorCapFraction: 1,
  },
  bpmSteps: { pass: 2, softMiss: -2, fail: -2 },
  tempoRatchet: { k: 0.3, kCapBpm: 8 },
};

function basePiece(overrides) {
  return {
    id: "p1",
    name: "Test piece",
    totalMeasures: 12,
    measureDifficulty: Array(12).fill(1),
    chunkMode: "custom",
    customChunkSize: 4,
    recurringMode: "none",
    recurringMeasures: 0,
    recurringPairs: [],
    practiceDaysPerWeek: 7,
    minutesPerDay: 30,
    startDate: "2026-01-01",
    status: "active",
    progress: {},
    ...overrides,
  };
}

// A chunk sitting on the ladder with a due date well inside the plan, so
// both surfaces would definitely place/surface it if not for the flag.
function ladderEntry(overrides) {
  return {
    doneDays: [1],
    sessions: [{ day: 1, outcome: "pass", loggedDate: "2026-01-01" }],
    stage: "stabilizing",
    consecutivePasses: 0,
    consecutiveStabilizingFails: 0,
    practiceBPM: 60,
    nextDueDate: "2026-01-09",
    tier1Done: false,
    ...overrides,
  };
}

// Mirrors App.jsx's handleClearRelearning.
function clearRelearning(piece, chunkId) {
  const progress = { ...piece.progress };
  const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
  entry.needsRelearning = false;
  entry.consecutiveStabilizingFails = 0;
  progress[chunkId] = entry;
  return { ...piece, progress };
}

// Excludes consolidation days: their reviewChunkIds is unconditionally
// overwritten with every practice chunk by separate, pre-existing
// run-through logic, which has nothing to do with Tier 2 placement.
function reviewDaysFor(timeline, chunkId) {
  const days = [];
  timeline.days.forEach((d, i) => {
    if (d.type === "consolidation") return;
    if (d.reviewChunkIds.includes(chunkId)) days.push(i + 1);
  });
  return days;
}

describe("Rule 1 — a flagged chunk produces zero due reviews", () => {
  test("computeTimeline places no Tier 2 review for a flagged chunk (and still places one once cleared)", () => {
    const flagged = basePiece({
      daysToLearn: 14,
      progress: { c1: ladderEntry({ needsRelearning: true, consecutiveStabilizingFails: 2 }) },
    });
    const chunkSet = generateAllChunks(flagged);
    assert.deepEqual(reviewDaysFor(computeTimeline(flagged, chunkSet), "c1"), []);

    const cleared = clearRelearning(flagged, "c1");
    assert.ok(
      reviewDaysFor(computeTimeline(cleared, chunkSet), "c1").length > 0,
      "the same chunk with the flag cleared is scheduled again — the flag is what suppressed it, not something else"
    );
  });

  test("computeDueReviews surfaces nothing for a flagged chunk, even when it's overdue", () => {
    const flagged = basePiece({
      daysToLearn: 14,
      progress: { c1: ladderEntry({ needsRelearning: true, nextDueDate: "2026-01-02" }) },
    });
    const chunkSet = generateAllChunks(flagged);
    const due = computeDueReviews(flagged, chunkSet, "2026-01-20");
    assert.deepEqual(due.map((d) => d.chunkId), [], "18 days overdue and still not surfaced");

    const cleared = clearRelearning(flagged, "c1");
    assert.deepEqual(
      computeDueReviews(cleared, chunkSet, "2026-01-20").map((d) => d.chunkId),
      ["c1"],
      "clearing the flag resumes the due list"
    );
  });

  test("a flagged chunk doesn't suppress its unflagged neighbours", () => {
    const piece = basePiece({
      daysToLearn: 14,
      progress: {
        c1: ladderEntry({ needsRelearning: true, nextDueDate: "2026-01-02" }),
        c5: ladderEntry({ doneDays: [2], nextDueDate: "2026-01-02" }),
      },
    });
    const chunkSet = generateAllChunks(piece);
    assert.deepEqual(
      computeDueReviews(piece, chunkSet, "2026-01-20").map((d) => d.chunkId),
      ["c5"]
    );
  });
});

describe("Rule 2 — the manual override clears the flag", () => {
  test("handleClearRelearning's reducer clears the flag and the fail streak, but nothing else", () => {
    const piece = basePiece({
      progress: { c1: ladderEntry({ needsRelearning: true, consecutiveStabilizingFails: 2, practiceBPM: 55 }) },
    });
    const after = clearRelearning(piece, "c1");
    assert.equal(after.progress.c1.needsRelearning, false);
    // The fail streak resets too (see below for why) — but rule 3's
    // demote-and-pin (stage/practiceBPM) already happened as part of the
    // fail and isn't reverted just because the flag is later cleared.
    assert.equal(after.progress.c1.consecutiveStabilizingFails, 0);
    assert.equal(after.progress.c1.stage, "stabilizing");
    assert.equal(after.progress.c1.practiceBPM, 55);
    assert.deepEqual(after.progress.c1.sessions, piece.progress.c1.sessions);
  });

  // Confirmed with the user: clearing should put the chunk back where a
  // single fail would leave it, not one fail away from immediately
  // re-flagging. handleClearRelearning resets consecutiveStabilizingFails
  // to 0 alongside the flag itself, so the next fail after a manual clear
  // is treated as fail #1 of a fresh streak — ordinary, not an instant
  // re-trigger — and doesn't re-fire rule 4's tempo reset either.
  test("a manual clear resets the fail streak — the next single fail is ordinary, not an instant re-flag", () => {
    const piece = clearRelearning(
      basePiece({ progress: { c1: ladderEntry({ needsRelearning: true, consecutiveStabilizingFails: 2, practiceBPM: 55 }) } }),
      "c1"
    );
    const entry = piece.progress.c1;
    const advance = computeLadderAdvance(
      {
        stage: entry.stage,
        consecutivePasses: entry.consecutivePasses,
        consecutiveStabilizingFails: entry.consecutiveStabilizingFails,
        practiceBPM: entry.practiceBPM,
        targetBPM: 100,
        tier1Done: entry.tier1Done,
        needsRelearning: entry.needsRelearning,
        suggestedStartingBPM: 50,
      },
      { result: "fail", asOfDate: "2026-01-10" },
      LADDER_CONFIG
    );
    assert.equal(advance.consecutiveStabilizingFails, 1, "fail #1 of a fresh streak, not #3 of the old one");
    assert.equal(advance.needsRelearning, false);
    assert.equal(advance.practiceBPM, 53, "normal -2 step — rule 4 doesn't fire again, since this isn't a fresh flag transition");
  });
});

describe("Migration (storage.js)", () => {
  test("a piece saved before the flag existed gets needsRelearning: false when its fail streak is below 2", () => {
    const migrated = validateAndMigratePiece(
      basePiece({ progress: { c1: { doneDays: [1], sessions: [], stage: "stabilizing", consecutiveStabilizingFails: 1 } } })
    );
    assert.equal(migrated.progress.c1.needsRelearning, false);
  });

  test("a piece already sitting at 2+ Stabilizing fails is retroactively flagged on load", () => {
    const migrated = validateAndMigratePiece(
      basePiece({ progress: { c1: { doneDays: [1], sessions: [], stage: "stabilizing", consecutiveStabilizingFails: 2 } } })
    );
    assert.equal(migrated.progress.c1.needsRelearning, true);
  });

  test("a 2+ fail streak at a stage above Stabilizing is not retroactively flagged (stale counter, not a live signal)", () => {
    const migrated = validateAndMigratePiece(
      basePiece({ progress: { c1: { doneDays: [1], sessions: [], stage: "holding", consecutiveStabilizingFails: 2 } } })
    );
    assert.equal(migrated.progress.c1.needsRelearning, false);
  });

  test("an explicit needsRelearning: false always wins over the retroactive backfill (a manual clear can't be undone by a reload)", () => {
    const migrated = validateAndMigratePiece(
      basePiece({
        progress: {
          c1: { doneDays: [1], sessions: [], stage: "stabilizing", consecutiveStabilizingFails: 2, needsRelearning: false },
        },
      })
    );
    assert.equal(migrated.progress.c1.needsRelearning, false);
  });

  test("the synthetic __consolidation__ entry is left alone, not given ladder fields", () => {
    const migrated = validateAndMigratePiece(basePiece({ progress: { __consolidation__: { doneDays: [3] } } }));
    assert.equal("needsRelearning" in migrated.progress.__consolidation__, false);
  });
});
