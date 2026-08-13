import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getSuggestedStartingBPM, computeConfidence } from "../src/lib/confidence.js";

function makeChunk(overrides = {}) {
  return { id: "c1", start: 1, end: 8, difficultyLabel: "medium", ...overrides };
}

function makePiece(overrides = {}) {
  return { targetBPM: null, bpmZones: [], progress: {}, ...overrides };
}

// Calibration grid from the product spec: at each target BPM, the
// suggestion must fall within the given [min, max] range (single-number
// targets, e.g. "75" at 100 BPM, are asserted exactly — the formula is
// defined to hit those precisely since k has no effect at target=100).
describe("getSuggestedStartingBPM — calibration grid", () => {
  const cases = [
    ["easy", 100, 75, 75],
    ["easy", 140, 80, 85],
    ["easy", 180, 85, 90],
    ["easy", 240, 90, 100],
    ["medium", 100, 60, 60],
    ["medium", 140, 60, 70],
    ["medium", 180, 65, 70],
    ["medium", 240, 65, 75],
    ["hard", 100, 45, 45],
    ["hard", 140, 45, 50],
    ["hard", 180, 45, 50],
    ["hard", 240, 45, 55],
  ];

  cases.forEach(([difficulty, target, min, max]) => {
    test(`${difficulty} chunk at ${target} BPM target suggests between ${min} and ${max}`, () => {
      const piece = makePiece({ targetBPM: target });
      const chunk = makeChunk({ difficultyLabel: difficulty });
      const suggested = getSuggestedStartingBPM(piece, chunk);
      assert.ok(
        suggested >= min && suggested <= max,
        `expected ${suggested} to be within [${min}, ${max}] for ${difficulty} @ ${target}`
      );
    });
  });

  test("the suggestion grows far slower than the target as target increases (diminishing returns)", () => {
    const chunk = makeChunk({ difficultyLabel: "easy" });
    const at100 = getSuggestedStartingBPM(makePiece({ targetBPM: 100 }), chunk);
    const at240 = getSuggestedStartingBPM(makePiece({ targetBPM: 240 }), chunk);
    // Target grows 2.4x (100 -> 240); the suggestion must grow much less.
    assert.ok(at240 / at100 < 1.5, `expected suggestion growth ratio < 1.5x, got ${at240 / at100}`);
  });
});

describe("getSuggestedStartingBPM — target resolution", () => {
  test("prefers a chunk-specific progress.targetBPM over the piece-wide default", () => {
    const piece = makePiece({ targetBPM: 200, progress: { c1: { targetBPM: 100 } } });
    const chunk = makeChunk({ difficultyLabel: "medium" });
    assert.equal(getSuggestedStartingBPM(piece, chunk), 60);
  });

  test("falls back to a bpmZone's tempo when no piece-wide targetBPM is set", () => {
    const piece = makePiece({ bpmZones: [{ start: 1, end: 8, bpm: 100 }] });
    const chunk = makeChunk({ difficultyLabel: "medium" });
    assert.equal(getSuggestedStartingBPM(piece, chunk), 60);
  });

  test("returns null when there is no target BPM to derive a suggestion from", () => {
    const piece = makePiece();
    const chunk = makeChunk();
    assert.equal(getSuggestedStartingBPM(piece, chunk), null);
  });
});

// The suggestion is guidance only (concept 1 of 3 — see
// lib/confidence.js's block comment and docs/Algorithms.md). The real
// baseline is whatever the learner actually logs the first time they touch
// a chunk (concept 2) — App.jsx's handleLogSession seeds practiceBPM from
// that, never silently from getSuggestedStartingBPM. handleLogSession
// itself isn't unit-testable here (it's a closure inside the App component
// and this repo has no React render harness), so this exercises the exact
// seeding expression it uses against getSuggestedStartingBPM directly, to
// prove the two are independent: a learner can ignore the suggestion
// entirely and their own choice still wins.
describe("user-selected starting tempo overrides the suggestion (mirrors App.jsx's handleLogSession)", () => {
  test("suggests 65 for this chunk, but the learner logs 65 chosen freely — starts there, not from the suggestion", () => {
    // A target/difficulty combo where the suggestion is a round, easy-to-read number.
    const piece = makePiece({ targetBPM: 100 });
    const chunk = makeChunk({ difficultyLabel: "medium" }); // suggested = 60
    const suggested = getSuggestedStartingBPM(piece, chunk);
    assert.equal(suggested, 60);

    const bpmLearnerActuallyChose = 45; // deliberately far from the suggestion
    const prevEntry = {}; // first-ever log for this chunk
    const seededPracticeBPM = prevEntry.practiceBPM != null ? prevEntry.practiceBPM : bpmLearnerActuallyChose;

    assert.equal(seededPracticeBPM, 45);
    assert.notEqual(seededPracticeBPM, suggested);
  });

  test("a second-ever session does NOT re-seed — it keeps the already-seeded practiceBPM", () => {
    const prevEntry = { practiceBPM: 45 }; // already seeded by a prior log
    const bpmThisSession = 50;
    const seededPracticeBPM = prevEntry.practiceBPM != null ? prevEntry.practiceBPM : bpmThisSession;
    assert.equal(seededPracticeBPM, 45);
  });
});

// needsRelearning (Pass 11) gets the same confidence cap treatment as
// rough/lost flags (Repertoire-Lifecycle.md's "Post-run-through logging")
// — same reasoning: it reuses the `lost` demote-and-pin mechanism under
// the hood, so a stale manual override showing high confidence while a
// chunk needs reinforcement would be the exact "visible contradiction" the
// cap exists to prevent.
describe("computeConfidence — flag and needsRelearning caps", () => {
  test("a manual override of 90 is capped at 55 while flag is 'rough'", () => {
    const piece = makePiece({ progress: { c1: { manualConfidence: 90, flag: "rough" } } });
    assert.equal(computeConfidence(makeChunk(), piece, 1), 55);
  });

  test("a manual override of 90 is capped at 20 while flag is 'lost'", () => {
    const piece = makePiece({ progress: { c1: { manualConfidence: 90, flag: "lost" } } });
    assert.equal(computeConfidence(makeChunk(), piece, 1), 20);
  });

  test("a manual override of 90 is capped at 20 while needsRelearning is true, same as 'lost'", () => {
    const piece = makePiece({ progress: { c1: { manualConfidence: 90, needsRelearning: true } } });
    assert.equal(computeConfidence(makeChunk(), piece, 1), 20);
  });

  test("needsRelearning caps the auto-computed score too, not just a manual override", () => {
    const withoutFlag = makePiece({ progress: { c1: { manualConfidence: 75 } } });
    assert.equal(computeConfidence(makeChunk(), withoutFlag, 1), 75, "sanity check: no cap applies without the flag");

    const flagged = makePiece({ progress: { c1: { manualConfidence: 75, needsRelearning: true } } });
    assert.equal(computeConfidence(makeChunk(), flagged, 1), 20);
  });

  test("a lower score than the cap passes through unchanged — the cap only ever pulls down", () => {
    const piece = makePiece({ progress: { c1: { manualConfidence: 5, needsRelearning: true } } });
    assert.equal(computeConfidence(makeChunk(), piece, 1), 5);
  });

  test("both flag='rough' and needsRelearning set at once: the lower of the two caps wins", () => {
    const piece = makePiece({ progress: { c1: { manualConfidence: 90, flag: "rough", needsRelearning: true } } });
    assert.equal(computeConfidence(makeChunk(), piece, 1), 20, "needsRelearning's cap (20) is stricter than rough's (55)");
  });

  test("clearing needsRelearning removes the cap again", () => {
    const piece = makePiece({ progress: { c1: { manualConfidence: 90, needsRelearning: false } } });
    assert.equal(computeConfidence(makeChunk(), piece, 1), 90);
  });
});
