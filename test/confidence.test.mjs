import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  getSuggestedStartingBPM,
  computeConfidence,
  computeAutoConfidence,
  computeProgressTier,
  classifySessionOutcome,
  resolveRequiredReps,
  formatLadderStatus,
} from "../src/lib/confidence.js";

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

// Pass 14 — the BPM-gating decision (docs/Decisions.md#spaced-repetition--maintenance):
// a repeat soft-miss only escalates to "fail" when BOTH the current and the
// previous shortfall were reps-driven (cleanReps < requiredReps). A
// tempo-only shortfall (required reps hit, just under practiceBPM) never
// escalates, in either session of the pair, no matter how many times it
// repeats — practiceBPM already backs off on its own after a tempo-only
// soft-miss.
describe("classifySessionOutcome — base cases (unchanged by Pass 14)", () => {
  test("manualFail always wins, even with full reps and tempo cleared", () => {
    assert.equal(
      classifySessionOutcome({ cleanReps: 10, bpm: 200, requiredReps: 4, practiceBPM: 100, manualFail: true }),
      "fail"
    );
  });

  test("zero clean reps is always a fail", () => {
    assert.equal(
      classifySessionOutcome({ cleanReps: 0, bpm: 100, requiredReps: 4, practiceBPM: 100, manualFail: false }),
      "fail"
    );
  });

  test("required reps hit at/above practiceBPM is a full pass", () => {
    assert.equal(
      classifySessionOutcome({ cleanReps: 4, bpm: 100, requiredReps: 4, practiceBPM: 100, manualFail: false }),
      "pass"
    );
    assert.equal(
      classifySessionOutcome({ cleanReps: 4, bpm: 105, requiredReps: 4, practiceBPM: 100, manualFail: false }),
      "pass"
    );
  });

  test("a null practiceBPM (chunk not yet seeded) treats tempo as already cleared", () => {
    assert.equal(
      classifySessionOutcome({ cleanReps: 4, bpm: 40, requiredReps: 4, practiceBPM: null, manualFail: false }),
      "pass"
    );
  });

  test("a first-ever session (no previousOutcome) that falls short is a soft-miss, not a fail", () => {
    assert.equal(
      classifySessionOutcome({ cleanReps: 4, bpm: 90, requiredReps: 4, practiceBPM: 100, manualFail: false, previousOutcome: null }),
      "soft-miss"
    );
    assert.equal(
      classifySessionOutcome({ cleanReps: 2, bpm: 100, requiredReps: 4, practiceBPM: 100, manualFail: false, previousOutcome: null }),
      "soft-miss"
    );
  });

  test("two consecutive reps-insufficient soft-misses still escalates to a real fail (genuine stagnation is preserved)", () => {
    // Session 1: only 2 of 4 required reps — a soft-miss.
    const first = classifySessionOutcome({ cleanReps: 2, bpm: 100, requiredReps: 4, practiceBPM: 100, manualFail: false, previousOutcome: null });
    assert.equal(first, "soft-miss");
    // Session 2: still only 1 of 4 required reps, right after another reps-driven soft-miss.
    const second = classifySessionOutcome({
      cleanReps: 1,
      bpm: 100,
      requiredReps: 4,
      practiceBPM: 100,
      manualFail: false,
      previousOutcome: first,
      previousCleanReps: 2,
    });
    assert.equal(second, "fail");
  });
});

describe("classifySessionOutcome — the false-fail fix (Pass 14)", () => {
  test("the exact reproduction: full required reps, a hair under an already-ratcheted-down practiceBPM, twice in a row — stays soft-miss, not fail", () => {
    // Session 1: practiceBPM=100, required reps hit, 1 BPM under — soft-miss.
    // (The ladder would step practiceBPM down to 98 after this in lib/ladder.js.)
    const first = classifySessionOutcome({
      cleanReps: 4,
      bpm: 99,
      requiredReps: 4,
      practiceBPM: 100,
      manualFail: false,
      previousOutcome: null,
    });
    assert.equal(first, "soft-miss");

    // Session 2: practiceBPM has stepped down to 98, required reps hit again, still 1 BPM under.
    // Before Pass 14 this classified as "fail" purely because the previous outcome
    // was also "soft-miss" — even though reps were never the problem either time.
    const second = classifySessionOutcome({
      cleanReps: 4,
      bpm: 97,
      requiredReps: 4,
      practiceBPM: 98,
      manualFail: false,
      previousOutcome: first,
      previousCleanReps: 4,
    });
    assert.equal(second, "soft-miss", "a tempo-only shortfall must never escalate to fail, even repeated");
  });

  test("a tempo-only shortfall never escalates to fail no matter how many times it repeats", () => {
    let previousOutcome = null;
    let previousCleanReps = null;
    let outcome;
    for (let i = 0; i < 5; i++) {
      outcome = classifySessionOutcome({
        cleanReps: 4,
        bpm: 90,
        requiredReps: 4,
        practiceBPM: 100,
        manualFail: false,
        previousOutcome,
        previousCleanReps,
      });
      assert.equal(outcome, "soft-miss", `attempt ${i + 1} should still be a soft-miss, not a fail`);
      previousOutcome = outcome;
      previousCleanReps = 4;
    }
  });

  test("this session is reps-solid-but-slow, even though the PREVIOUS session was a genuine reps shortfall — stays soft-miss", () => {
    // Previous session: reps-driven soft-miss (2 of 4 required).
    // This session: all 4 required reps hit, just under tempo — the current
    // shortfall is tempo-only, so it can never be the fail trigger, regardless
    // of what happened last time.
    assert.equal(
      classifySessionOutcome({
        cleanReps: 4,
        bpm: 90,
        requiredReps: 4,
        practiceBPM: 100,
        manualFail: false,
        previousOutcome: "soft-miss",
        previousCleanReps: 2,
      }),
      "soft-miss"
    );
  });

  test("this session is a genuine reps shortfall, but the PREVIOUS session was tempo-only — stays soft-miss (no escalation)", () => {
    // Previous session: full reps, just under tempo (tempo-only soft-miss).
    // This session: only 1 of 4 required reps. Escalation requires BOTH
    // sessions to be reps-driven, so a single reps-driven session on its own
    // (with a tempo-only session before it) doesn't yet count as "twice in a row."
    assert.equal(
      classifySessionOutcome({
        cleanReps: 1,
        bpm: 100,
        requiredReps: 4,
        practiceBPM: 100,
        manualFail: false,
        previousOutcome: "soft-miss",
        previousCleanReps: 4,
      }),
      "soft-miss"
    );
  });

  test("a missing previousCleanReps (legacy/malformed session data) defensively never escalates", () => {
    assert.equal(
      classifySessionOutcome({
        cleanReps: 1,
        bpm: 100,
        requiredReps: 4,
        practiceBPM: 100,
        manualFail: false,
        previousOutcome: "soft-miss",
        previousCleanReps: undefined,
      }),
      "soft-miss"
    );
  });

  test("a previous outcome of 'fail' (not 'soft-miss') never triggers escalation on its own", () => {
    assert.equal(
      classifySessionOutcome({
        cleanReps: 1,
        bpm: 100,
        requiredReps: 4,
        practiceBPM: 100,
        manualFail: false,
        previousOutcome: "fail",
        previousCleanReps: 0,
      }),
      "soft-miss"
    );
  });
});

describe("resolveRequiredReps — Pass 27's flat run-through rep count", () => {
  test("a run-through-kind chunk (section-runthrough or section-transition) always resolves to 2, regardless of difficulty label", () => {
    for (const kind of ["section-runthrough", "section-transition"]) {
      for (const difficultyLabel of ["easy", "medium", "hard"]) {
        assert.equal(resolveRequiredReps({ kind, difficultyLabel }), 2, `${kind} at ${difficultyLabel} should resolve to a flat 2`);
      }
    }
  });

  test("an ordinary practice chunk, plain transition, or combo of the same difficulty is unaffected — still its normal REQUIRED_REPS count", () => {
    assert.equal(resolveRequiredReps({ kind: "section", difficultyLabel: "easy" }), 3);
    assert.equal(resolveRequiredReps({ kind: "section", difficultyLabel: "medium" }), 4);
    assert.equal(resolveRequiredReps({ kind: "section", difficultyLabel: "hard" }), 5);
    assert.equal(
      resolveRequiredReps({ kind: "transition", difficultyLabel: "hard" }),
      5,
      "a plain chunk-to-chunk transition (kind 'transition', not 'section-transition') is unaffected"
    );
    assert.equal(resolveRequiredReps({ kind: "combo", difficultyLabel: "hard" }), 5, "a focus-block combo is unaffected");
  });

  test("a run-through-kind chunk with exactly 2 clean reps classifies as a full pass, regardless of difficulty label", () => {
    for (const difficultyLabel of ["easy", "medium", "hard"]) {
      const chunk = { kind: "section-runthrough", difficultyLabel };
      const requiredReps = resolveRequiredReps(chunk);
      const outcome = classifySessionOutcome({
        cleanReps: 2,
        bpm: 100,
        requiredReps,
        practiceBPM: null, // not yet seeded — isolates the reps threshold from the tempo gate
        manualFail: false,
        previousOutcome: null,
        previousCleanReps: null,
      });
      assert.equal(outcome, "pass", `a ${difficultyLabel} run-through with 2 clean reps should be a full pass`);
    }
  });

  test("the same 2-rep session on an ordinary hard practice chunk does NOT count as a full pass (needs 5)", () => {
    const chunk = { kind: "section", difficultyLabel: "hard" };
    const requiredReps = resolveRequiredReps(chunk);
    assert.equal(requiredReps, 5);
    const outcome = classifySessionOutcome({
      cleanReps: 2,
      bpm: 100,
      requiredReps,
      practiceBPM: null,
      manualFail: false,
      previousOutcome: null,
      previousCleanReps: null,
    });
    assert.equal(outcome, "soft-miss", "2 of 5 required reps on an ordinary hard chunk reads as a soft-miss, not a full pass");
  });
});

describe("computeAutoConfidence uses resolveRequiredReps too, not its own separate REQUIRED_REPS lookup (Pass 27 follow-up)", () => {
  test("a hard run-through logged at its own full requirement (2 reps) scores confidence the same as an ordinary chunk completed at ITS full requirement", () => {
    const runThrough = { id: "sr_s1", kind: "section-runthrough", difficultyLabel: "hard", start: 1, end: 8, recurring: false };
    const ordinary = { id: "c1", kind: "section", difficultyLabel: "hard", start: 1, end: 4, recurring: false };
    const piece = {
      targetBPM: 100,
      bpmZones: [],
      progress: {
        sr_s1: { doneDays: [1], currentBPM: 100, sessions: [{ day: 1, cleanReps: 2, bpm: 100, outcome: "pass" }] },
        c1: { doneDays: [1], currentBPM: 100, sessions: [{ day: 1, cleanReps: 5, bpm: 100, outcome: "pass" }] },
      },
    };
    const runThroughConfidence = computeAutoConfidence(runThrough, piece, 1);
    const ordinaryConfidence = computeAutoConfidence(ordinary, piece, 1);
    assert.equal(
      runThroughConfidence,
      ordinaryConfidence,
      "a run-through 'fully done' at 2 reps and an ordinary chunk 'fully done' at 5 reps should score identically — before this fix the run-through scored lower (54% vs 65%) despite both being a full pass"
    );
  });

  test("logging fewer than the run-through's own 2-rep requirement still scores partial credit, not full", () => {
    const runThrough = { id: "sr_s1", kind: "section-runthrough", difficultyLabel: "hard", start: 1, end: 8, recurring: false };
    const piece = {
      targetBPM: 100,
      bpmZones: [],
      progress: { sr_s1: { doneDays: [1], currentBPM: 100, sessions: [{ day: 1, cleanReps: 1, bpm: 100, outcome: "soft-miss" }] } },
    };
    const confidence = computeAutoConfidence(runThrough, piece, 1);
    assert.ok(confidence < 65, "1 of 2 required reps should score below the 'fully done' 65%");
  });
});

describe("A skipped session (Interleaved mode, Pass 29) is excluded wherever sessions are treated as judged practice", () => {
  const chunk = { id: "c1", kind: "section", difficultyLabel: "medium", start: 1, end: 4, recurring: false };

  test("computeAutoConfidence: a skip as the most recent session does NOT null out the real last outcome's pass/fail multiplier", () => {
    const withoutSkip = {
      targetBPM: 100,
      bpmZones: [],
      progress: {
        c1: { doneDays: [1], currentBPM: 90, sessions: [{ day: 1, cleanReps: 4, bpm: 90, outcome: "pass" }] },
      },
    };
    const withTrailingSkip = {
      targetBPM: 100,
      bpmZones: [],
      progress: {
        c1: {
          // Same day, same doneDays — a skip never adds to doneDays (this
          // pass's fix), so isolating the skip's effect means holding
          // `currentDay` and `doneDays` identical between the two cases and
          // varying only whether a skip record trails the real pass in
          // `sessions`. Evaluating at different currentDay values instead
          // would also move the (unrelated) recency term and produce a
          // false positive here.
          doneDays: [1],
          currentBPM: 90,
          sessions: [
            { day: 1, cleanReps: 4, bpm: 90, outcome: "pass" },
            { day: 1, skipped: true, durationSeconds: 120 },
          ],
        },
      },
    };
    const confBefore = computeAutoConfidence(chunk, withoutSkip, 1);
    const confAfter = computeAutoConfidence(chunk, withTrailingSkip, 1);
    assert.equal(
      confAfter,
      confBefore,
      "a trailing skip must not change the score the real 'pass' session already earned — it should read straight through the skip to that pass"
    );
  });

  test("computeProgressTier: a chunk with only a skipped session (no real session ever) reads as 'untouched', not touched", () => {
    const piece = {
      progress: { c1: { doneDays: [], stage: null, sessions: [{ day: 1, skipped: true, durationSeconds: 60 }] } },
    };
    assert.equal(computeProgressTier(chunk, piece), "untouched");
  });

  test("formatLadderStatus: a chunk with only a skipped session and no recognized stage returns null (same as truly no history)", () => {
    const ladderConfig = {
      stabilizing: { intervalDays: 4, graduationPasses: 4 },
      settling: { intervalDays: 7, graduationPasses: 4 },
      holding: { startIntervalDays: 14, maxIntervalDays: 70 },
    };
    const entry = { stage: null, sessions: [{ day: 1, skipped: true, durationSeconds: 60 }] };
    assert.equal(formatLadderStatus(entry, ladderConfig, "2026-08-16"), null);
  });
});
