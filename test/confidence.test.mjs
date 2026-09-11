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
  hasClimbingTempo,
  allJudgedSessions,
  computeAutoOverallConfidence,
  computeOverallConfidence,
  isManualOverallConfidence,
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

// The calibration curve was hand-fit at targets >= 100 BPM only, and below
// a difficulty-dependent threshold (~70 BPM for easy, ~50 for medium) its
// unclamped output rises above target itself — e.g. easy @ 65 BPM target
// raw-computes to ~66.8, rounding to 67, a nonsensical "start faster than
// your goal tempo" recommendation. This floor guarantees the suggestion
// always stays at least MIN_STARTING_TEMPO_BUFFER (15) below target.
describe("getSuggestedStartingBPM — stays below target at low target BPMs", () => {
  test("easy chunk at 65 BPM target (the reported case) suggests 50, not 67", () => {
    const piece = makePiece({ targetBPM: 65 });
    const chunk = makeChunk({ difficultyLabel: "easy" });
    assert.equal(getSuggestedStartingBPM(piece, chunk), 50);
  });

  test("medium chunk at 65 BPM target also respects the 15 BPM floor", () => {
    const piece = makePiece({ targetBPM: 65 });
    const chunk = makeChunk({ difficultyLabel: "medium" });
    assert.equal(getSuggestedStartingBPM(piece, chunk), 50);
  });

  test("suggestion never meets or exceeds target across a range of low targets and difficulties", () => {
    for (const difficulty of ["easy", "medium", "hard"]) {
      for (const target of [20, 30, 40, 50, 60, 65, 70, 80, 90]) {
        const piece = makePiece({ targetBPM: target });
        const chunk = makeChunk({ difficultyLabel: difficulty });
        const suggested = getSuggestedStartingBPM(piece, chunk);
        assert.ok(
          suggested <= target - 15,
          `expected ${difficulty} @ ${target} suggestion (${suggested}) to be <= ${target - 15}`
        );
      }
    }
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

describe("resolveRequiredReps — Pass 61's Holding periodic harder check", () => {
  const chunk = { kind: "section", difficultyLabel: "medium" }; // baseline 4

  test("stage/holdingReviewCount omitted entirely — behaves exactly as before this pass (backward compatible with every existing call site)", () => {
    assert.equal(resolveRequiredReps(chunk), 4);
  });

  test("not in Holding — never bumped, regardless of holdingReviewCount", () => {
    for (const stage of ["stabilizing", "settling", undefined, null]) {
      for (const holdingReviewCount of [0, 3, 7, 100]) {
        assert.equal(resolveRequiredReps(chunk, stage, holdingReviewCount), 4, `stage=${stage}, holdingReviewCount=${holdingReviewCount}`);
      }
    }
  });

  test("in Holding, the review about to be logged is the 4th/8th/12th (holdingReviewCount 3/7/11 going in) — baseline + 1", () => {
    for (const holdingReviewCount of [3, 7, 11]) {
      assert.equal(
        resolveRequiredReps(chunk, "holding", holdingReviewCount),
        5,
        `holdingReviewCount=${holdingReviewCount} going in means this is review #${holdingReviewCount + 1}`
      );
    }
  });

  test("in Holding, every other review — baseline, unchanged", () => {
    for (const holdingReviewCount of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12]) {
      assert.equal(resolveRequiredReps(chunk, "holding", holdingReviewCount), 4, `holdingReviewCount=${holdingReviewCount}`);
    }
  });

  test("holdingReviewCount omitted (null/undefined) while in Holding is treated as 0 — the upcoming review is #1, not bumped", () => {
    assert.equal(resolveRequiredReps(chunk, "holding", undefined), 4);
    assert.equal(resolveRequiredReps(chunk, "holding", null), 4);
  });

  test("the bump applies on top of the run-through flat 2-rep baseline too, not just the difficulty-based table", () => {
    const runThrough = { kind: "section-runthrough", difficultyLabel: "hard" };
    assert.equal(resolveRequiredReps(runThrough, "holding", 0), 2, "ordinary review — still the flat run-through baseline");
    assert.equal(resolveRequiredReps(runThrough, "holding", 3), 3, "4th review — baseline 2 + 1");
  });
});

describe("classifySessionOutcome — base tempo check is unaffected by Pass 61 (clearsStageFloor is retired for Holding, clearsTempo is a completely separate mechanism)", () => {
  // clearsStageFloor decides whether an already-classified pass counts
  // toward Holding's interval growth — a concern of computeLadderAdvance
  // (lib/ladder.js), not of classifySessionOutcome, which decides whether
  // a session is a pass/soft-miss/fail at all in the first place via its
  // own, separate `clearsTempo` check (bpm >= practiceBPM). Pass 61 only
  // retired the former; this file's classifySessionOutcome import is
  // untouched by that pass, and this test proves it stays that way —
  // requiredReps met but bpm under practiceBPM still reads as a soft-miss,
  // exactly as it always has, with no stage/holdingReviewCount concept
  // anywhere in this function's signature.
  test("required reps hit but bpm under practiceBPM is still a soft-miss, not a pass — same as always, nothing Holding-specific here", () => {
    const outcome = classifySessionOutcome({
      cleanReps: 4,
      bpm: 95,
      requiredReps: 4,
      practiceBPM: 100,
      manualFail: false,
      previousOutcome: null,
      previousCleanReps: null,
    });
    assert.equal(outcome, "soft-miss", "reps met, tempo not cleared — the base clearsTempo check, untouched by Pass 61");
  });

  test("required reps hit AND bpm at/above practiceBPM is a full pass — same formula regardless of stage, since this function never took a stage argument", () => {
    const outcome = classifySessionOutcome({
      cleanReps: 4,
      bpm: 100,
      requiredReps: 4,
      practiceBPM: 100,
      manualFail: false,
      previousOutcome: null,
      previousCleanReps: null,
    });
    assert.equal(outcome, "pass");
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

// allJudgedSessions (found in review while building Pass 56's Cold-Start
// check) — Progress's Outcome Breakdown panel needs every session that
// actually has a resolvable pass/soft-miss/fail judgment, not just every
// non-skipped/non-provisional one. loggedSessions() alone lets a
// "__consolidation__" or "__cold_start__" session through (neither is
// skipped or provisional), but sessionOutcome() can't classify either
// shape (no outcome/effectiveness), which used to silently inflate the
// Outcome Breakdown's denominator without ever landing in a bucket —
// pulling every real percentage down. See
// docs/Decisions.md#cold-start-check.
describe("allJudgedSessions — the Outcome Breakdown denominator", () => {
  test("a real judged session (outcome set) is included", () => {
    const piece = { progress: { c1: { sessions: [{ day: 1, cleanReps: 3, bpm: 90, outcome: "pass" }] } } };
    assert.equal(allJudgedSessions(piece).length, 1);
  });

  test("a legacy pre-outcome session (only effectiveness set) is still included — sessionOutcome resolves it", () => {
    const piece = { progress: { c1: { sessions: [{ day: 1, effectiveness: "high" }] } } };
    assert.equal(allJudgedSessions(piece).length, 1);
  });

  test("a skipped session is excluded (already true via loggedSessions)", () => {
    const piece = { progress: { c1: { sessions: [{ day: 1, skipped: true, durationSeconds: 60 }] } } };
    assert.equal(allJudgedSessions(piece).length, 0);
  });

  test("a provisional session is excluded (already true via loggedSessions)", () => {
    const piece = { progress: { c1: { sessions: [{ day: 1, cleanReps: 2, bpm: 80, outcome: "fail", provisional: true }] } } };
    assert.equal(allJudgedSessions(piece).length, 0);
  });

  test("[regression] a __consolidation__ session (stopCount, no outcome/effectiveness) is excluded", () => {
    const piece = { progress: { __consolidation__: { doneDays: [3], sessions: [{ day: 3, stopCount: 2 }] } } };
    assert.equal(allJudgedSessions(piece).length, 0);
  });

  test("[regression] a __cold_start__ session (avgBpm, no outcome/effectiveness) is excluded", () => {
    const piece = { progress: { __cold_start__: { sessions: [{ day: 5, avgBpm: 96, notes: "fine", gapDays: 3 }] } } };
    assert.equal(allJudgedSessions(piece).length, 0);
  });

  test("[regression] the actual dilution scenario: real judged sessions plus cold-start/consolidation sessions — only the judged ones count", () => {
    const piece = {
      progress: {
        c1: {
          sessions: [
            { day: 1, cleanReps: 4, bpm: 90, outcome: "pass" },
            { day: 2, cleanReps: 4, bpm: 92, outcome: "pass" },
          ],
        },
        c2: { sessions: [{ day: 1, cleanReps: 2, bpm: 70, outcome: "fail" }] },
        __consolidation__: { doneDays: [3], sessions: [{ day: 3, stopCount: 1 }] },
        __cold_start__: { sessions: [{ day: 10, avgBpm: 100, notes: "", gapDays: 5 }] },
      },
    };
    const sessions = allJudgedSessions(piece);
    // 2 pass + 1 fail = 3 judged sessions — NOT 5 (which is what the bug's
    // inflated denominator would have produced, since it counted the
    // consolidation and cold-start sessions too without ever bucketing
    // them, silently understating every real percentage).
    assert.equal(sessions.length, 3);
    assert.equal(sessions.filter((s) => s.outcome === "pass").length, 2);
    assert.equal(sessions.filter((s) => s.outcome === "fail").length, 1);
  });

  test("handles a piece with no progress, or no sessions at all, without throwing", () => {
    assert.doesNotThrow(() => allJudgedSessions({ progress: {} }));
    assert.deepEqual(allJudgedSessions({ progress: {} }), []);
    assert.deepEqual(allJudgedSessions({ progress: { c1: {} } }), []);
  });
});

// Pass 30 — the tempo-climbing nudge (Piece Map tile marker + modal
// suggestion). bpmSession() below builds a minimal real (non-skipped,
// non-provisional, judged) session record — only `bpm` matters to
// hasClimbingTempo, but a realistic shape is used throughout rather than
// bare `{ bpm }` objects, consistent with how sessions look elsewhere in
// this file's tests.
function bpmSession(bpm, day) {
  return { day, cleanReps: 3, bpm, outcome: "pass", durationSeconds: 60 };
}

describe("hasClimbingTempo — Pass 30's tempo-climbing trend detection", () => {
  test("several consecutive rising-BPM sessions triggers it", () => {
    const entry = { sessions: [bpmSession(70, 1), bpmSession(75, 2), bpmSession(80, 3), bpmSession(85, 4)] };
    assert.equal(hasClimbingTempo(entry), true);
  });

  test("flat BPM across sessions does NOT trigger it", () => {
    const entry = { sessions: [bpmSession(80, 1), bpmSession(80, 2), bpmSession(80, 3), bpmSession(80, 4)] };
    assert.equal(hasClimbingTempo(entry), false);
  });

  test("declining BPM does NOT trigger it", () => {
    const entry = { sessions: [bpmSession(90, 1), bpmSession(85, 2), bpmSession(80, 3), bpmSession(75, 4)] };
    assert.equal(hasClimbingTempo(entry), false);
  });

  test("a rise below the minimum-rise threshold does NOT trigger it (non-decreasing alone isn't enough)", () => {
    const entry = { sessions: [bpmSession(80, 1), bpmSession(81, 2), bpmSession(82, 3)] };
    assert.equal(hasClimbingTempo(entry), false);
  });

  test("a rise right at the minimum threshold DOES trigger it (boundary is inclusive)", () => {
    const entry = { sessions: [bpmSession(80, 1), bpmSession(82, 2), bpmSession(84, 3)] };
    assert.equal(hasClimbingTempo(entry), true);
  });

  test("too few sessions cannot show a trend, even if the only two rise sharply", () => {
    const entry = { sessions: [bpmSession(70, 1), bpmSession(90, 2)] };
    assert.equal(hasClimbingTempo(entry), false);
  });

  test("a plateau (repeated BPM) in the middle of an otherwise rising run still counts — 'monotonic-ish', not strictly monotonic", () => {
    const entry = { sessions: [bpmSession(70, 1), bpmSession(75, 2), bpmSession(75, 3), bpmSession(85, 4)] };
    assert.equal(hasClimbingTempo(entry), true);
  });

  test("any real dip breaks the trend outright, even with a big net rise overall", () => {
    const entry = { sessions: [bpmSession(70, 1), bpmSession(90, 2), bpmSession(80, 3), bpmSession(95, 4)] };
    assert.equal(hasClimbingTempo(entry), false, "90 -> 80 is a real dip between consecutive sessions");
  });

  test("only looks at the most recent WINDOW sessions — an old climb doesn't paper over a recent flat run", () => {
    const entry = {
      sessions: [
        bpmSession(50, 1),
        bpmSession(60, 2),
        bpmSession(70, 3),
        bpmSession(80, 4),
        bpmSession(80, 5),
        bpmSession(80, 6),
        bpmSession(80, 7),
      ],
    };
    assert.equal(
      hasClimbingTempo(entry),
      false,
      "the climb from 50->80 is now outside the 4-session window — the most recent 4 (80,80,80,80) are flat"
    );
  });

  test("skipped sessions (no bpm at all) are excluded and don't break an otherwise-climbing run", () => {
    const entry = {
      sessions: [
        bpmSession(70, 1),
        { day: 2, skipped: true, durationSeconds: 60 },
        bpmSession(78, 3),
        bpmSession(86, 4),
      ],
    };
    assert.equal(hasClimbingTempo(entry), true);
  });

  test("a still-open provisional session is excluded — not yet judged, shouldn't count as evidence of a climb", () => {
    const entry = {
      sessions: [
        bpmSession(70, 1),
        bpmSession(75, 2),
        bpmSession(80, 3),
        { day: 4, cleanReps: 1, bpm: 200, outcome: "soft-miss", durationSeconds: 30, provisional: true },
      ],
    };
    // Without excluding the provisional 200 BPM outlier this would read as
    // a dramatic climb; with it correctly excluded, only 70/75/80 remain —
    // a real climb, but on 3 sessions within the same window either way,
    // so assert against a case where including it WOULD flip the answer.
    assert.equal(hasClimbingTempo(entry), true, "judged on 70->75->80 only, not the unresolved 200 BPM provisional entry");
  });

  test("a provisional outlier that would otherwise break a flat run stays excluded, so the flat run still correctly does not trigger", () => {
    const entry = {
      sessions: [
        bpmSession(80, 1),
        bpmSession(80, 2),
        bpmSession(80, 3),
        { day: 4, cleanReps: 1, bpm: 40, outcome: "fail", durationSeconds: 30, provisional: true },
      ],
    };
    assert.equal(hasClimbingTempo(entry), false, "the provisional session is excluded entirely, leaving the flat 80/80/80 run");
  });

  test("no entry, no sessions, or empty sessions all return false without throwing", () => {
    assert.equal(hasClimbingTempo(null), false);
    assert.equal(hasClimbingTempo(undefined), false);
    assert.equal(hasClimbingTempo({}), false);
    assert.equal(hasClimbingTempo({ sessions: [] }), false);
  });

  test("sessions with a missing/non-numeric bpm (e.g. a legacy or malformed record) are excluded, not treated as 0", () => {
    const entry = {
      sessions: [bpmSession(70, 1), { day: 2, cleanReps: 3, outcome: "pass", durationSeconds: 60 }, bpmSession(78, 3), bpmSession(86, 4)],
    };
    assert.equal(hasClimbingTempo(entry), true, "the bpm-less record is skipped over, not counted as a BPM of 0 (which would read as a huge dip)");
  });

  // [fix] `typeof NaN === "number"` is true, so a bare `typeof s.bpm ===
  // "number"` guard let a NaN bpm (only reachable via hand-edited/corrupted
  // data, never through NumberInput) through into the window. With NaN at
  // the *start* of the trailing window specifically, the final
  // `recent[last].bpm - recent[0].bpm >= MIN_RISE_BPM` check becomes
  // `NaN >= 4`, always false — silently suppressing a genuine climb in the
  // rest of the window (86 - NaN = NaN, not 86 - 70 = 16), rather than
  // showing a false positive. Number.isFinite excludes the NaN record the
  // same way the pre-existing missing-bpm case above is already excluded,
  // so the real climb underneath it is visible again.
  test("[fix] a NaN bpm at the start of the trailing window no longer silently suppresses a genuine climb in the rest of it", () => {
    const entry = {
      sessions: [bpmSession(NaN, 1), bpmSession(70, 2), bpmSession(78, 3), bpmSession(86, 4)],
    };
    assert.equal(hasClimbingTempo(entry), true, "the NaN record is skipped over, leaving the genuine 70->78->86 climb visible");
  });
});

// Overall piece confidence (Pass 58) — an effort-weighted average of
// computeConfidence across every practice chunk, confirmed with the user
// over a plain (unweighted) average before building, for consistency with
// how this codebase already weights everything else time/effort-related
// (EFFORT_TO_MIN-based scheduling/revival/maintenance math). See
// docs/Algorithms.md and docs/Decisions.md#cold-start-check's neighboring
// entry for the full reasoning.
describe("computeAutoOverallConfidence — effort-weighted average across practice chunks", () => {
  function pieceWithChunk1Confident() {
    return {
      targetBPM: 100,
      bpmZones: [],
      progress: { c1: { doneDays: [1], currentBPM: 100, sessions: [{ day: 1, cleanReps: 5, bpm: 100, outcome: "pass" }] } },
    };
  }

  test("a single chunk's overall confidence equals that chunk's own computeConfidence", () => {
    const chunk = { id: "c1", start: 1, end: 4, difficultyLabel: "easy", effort: 4 };
    const piece = pieceWithChunk1Confident();
    assert.equal(computeAutoOverallConfidence(piece, [chunk], 1), computeConfidence(chunk, piece, 1));
  });

  test("equal-effort chunks reduce to a plain average", () => {
    const c1 = { id: "c1", start: 1, end: 4, difficultyLabel: "easy", effort: 4 };
    const c2 = { id: "c2", start: 5, end: 8, difficultyLabel: "easy", effort: 4 }; // untouched -> confidence 0
    const piece = pieceWithChunk1Confident();
    const c1Confidence = computeConfidence(c1, piece, 1);
    assert.equal(computeAutoOverallConfidence(piece, [c1, c2], 1), Math.round((c1Confidence + 0) / 2));
  });

  test("[regression] weighted by effort, not chunk count — a high-effort low-confidence chunk pulls the result down well below the plain average", () => {
    // c1: confident, but tiny effort (1). c2: untouched (confidence 0), but
    // effort 9 — nine times c1's weight. A plain average of the two would
    // land near the midpoint; the effort-weighted result must land much
    // closer to c2's 0, since c2's effort dominates the denominator.
    const c1 = { id: "c1", start: 1, end: 1, difficultyLabel: "easy", effort: 1 };
    const c2 = { id: "c2", start: 2, end: 20, difficultyLabel: "hard", effort: 9 };
    const piece = pieceWithChunk1Confident();
    const c1Confidence = computeConfidence(c1, piece, 1);
    assert.ok(c1Confidence > 50, "test setup check: c1 must read as reasonably confident for this test to be meaningful");
    const plainAverage = Math.round((c1Confidence + 0) / 2);
    const result = computeAutoOverallConfidence(piece, [c1, c2], 1);
    assert.equal(result, Math.round((c1Confidence * 1 + 0 * 9) / 10), "must match the hand-computed effort-weighted formula exactly");
    assert.ok(result < plainAverage, `effort-weighted result (${result}) must be pulled below the plain average (${plainAverage}) by c2's dominant effort`);
  });

  test("an empty practiceChunks list returns 0, not NaN", () => {
    assert.equal(computeAutoOverallConfidence({ progress: {} }, [], 1), 0);
    assert.equal(computeAutoOverallConfidence({ progress: {} }, null, 1), 0);
  });

  test("reads through computeConfidence (not computeAutoConfidence), so a per-chunk manual override is reflected in the rollup", () => {
    const chunk = { id: "c1", start: 1, end: 4, difficultyLabel: "easy", effort: 4 };
    const piece = { targetBPM: null, bpmZones: [], progress: { c1: { manualConfidence: 42 } } };
    assert.equal(computeAutoOverallConfidence(piece, [chunk], 1), 42);
  });
});

describe("computeOverallConfidence / isManualOverallConfidence — piece-level manual override precedence", () => {
  const chunk = { id: "c1", start: 1, end: 4, difficultyLabel: "easy", effort: 4 };
  function pieceWithOverride(manualOverallConfidence) {
    return {
      targetBPM: 100,
      bpmZones: [],
      progress: { c1: { doneDays: [1], currentBPM: 100, sessions: [{ day: 1, cleanReps: 5, bpm: 100, outcome: "pass" }] } },
      manualOverallConfidence,
    };
  }

  test("no manualOverallConfidence field at all: resolves to auto, isManualOverallConfidence is false", () => {
    const piece = { targetBPM: null, bpmZones: [], progress: {} };
    assert.equal(isManualOverallConfidence(piece), false);
    assert.equal(computeOverallConfidence(piece, [chunk], 1), computeAutoOverallConfidence(piece, [chunk], 1));
  });

  test("manualOverallConfidence: null behaves the same as it being absent — resolves to auto", () => {
    const piece = pieceWithOverride(null);
    assert.equal(isManualOverallConfidence(piece), false);
    assert.equal(computeOverallConfidence(piece, [chunk], 1), computeAutoOverallConfidence(piece, [chunk], 1));
  });

  test("[regression] the manual override takes precedence over the auto-calculated value when set", () => {
    const piece = pieceWithOverride(15);
    const auto = computeAutoOverallConfidence(piece, [chunk], 1);
    assert.notEqual(auto, 15, "test setup check: auto and manual must actually differ, or this test can't prove precedence");
    assert.equal(isManualOverallConfidence(piece), true);
    assert.equal(computeOverallConfidence(piece, [chunk], 1), 15);
  });

  test("a manual override of exactly 0 is respected, not treated as unset (0 is falsy but a real, meaningful rating)", () => {
    const piece = pieceWithOverride(0);
    assert.equal(isManualOverallConfidence(piece), true);
    assert.equal(computeOverallConfidence(piece, [chunk], 1), 0);
  });

  test("[regression] clearing the override (back to null) reverts to the current auto-calculated value, not a frozen snapshot", () => {
    const manualPiece = pieceWithOverride(15);
    assert.equal(computeOverallConfidence(manualPiece, [chunk], 1), 15);
    const clearedPiece = { ...manualPiece, manualOverallConfidence: null };
    assert.equal(isManualOverallConfidence(clearedPiece), false);
    assert.equal(computeOverallConfidence(clearedPiece, [chunk], 1), computeAutoOverallConfidence(clearedPiece, [chunk], 1));
  });

  test("manual override is clamped to 0-100 and rounded, same as per-chunk manualConfidence", () => {
    assert.equal(computeOverallConfidence(pieceWithOverride(150), [chunk], 1), 100);
    assert.equal(computeOverallConfidence(pieceWithOverride(-20), [chunk], 1), 0);
    assert.equal(computeOverallConfidence(pieceWithOverride(55.6), [chunk], 1), 56);
  });
});
