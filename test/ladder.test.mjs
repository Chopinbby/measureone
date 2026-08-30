// Tests for the spaced-repetition ladder engine (src/lib/ladder.js) —
// the Stabilizing/Settling/Holding stage math. Pure function, called from
// App.jsx's handleLogSession on every logged session.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLadderAdvance, computeDemonstratedTempoBaseline, isInterleaveEligible, isPieceLearned, isInTempoMaintenance } from "../src/lib/ladder.js";
import { mergeLadderConfig } from "../src/lib/storage.js";

// Mirrors storage.js's DEFAULT_LADDER_CONFIG.
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

const baseState = (overrides = {}) => ({
  stage: "stabilizing",
  consecutivePasses: 0,
  consecutiveStabilizingFails: 0,
  practiceBPM: 60,
  targetBPM: 100,
  tier1Done: true,
  ...overrides,
});

describe("Graduation", () => {
  test("Stabilizing: 4th consecutive full pass graduates to Settling", () => {
    const r = computeLadderAdvance(baseState({ consecutivePasses: 3 }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.stage, "settling");
    assert.equal(r.graduated, true);
    assert.equal(r.consecutivePasses, 0);
    // Pass 59: gap-proportional step, not the old flat +2 — gap=100-60=40,
    // k=0.3 -> 12, capped at kCapBpm (8) -> 60+8.
    assert.equal(r.practiceBPM, 68);
    assert.equal(r.nextDueDate, "2026-01-08", "follows the NEW stage's (Settling, 7d) cadence");
  });

  test("Stabilizing: 3rd consecutive full pass does not yet graduate", () => {
    const r = computeLadderAdvance(baseState({ consecutivePasses: 2 }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.stage, "stabilizing");
    assert.equal(r.consecutivePasses, 3);
    assert.equal(r.nextDueDate, "2026-01-05");
  });

  test("Settling: 4th consecutive full pass at/above the 70% floor graduates to Holding", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", consecutivePasses: 3, practiceBPM: 70, targetBPM: 100 }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "holding");
    assert.equal(r.graduated, true);
    assert.equal(r.nextDueDate, "2026-01-15", "Holding's first interval is startIntervalDays (14)");
  });

  test("Holding never graduates further (no ceiling) — consecutivePasses keeps accruing", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "holding", consecutivePasses: 12, practiceBPM: 100, targetBPM: 100 }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "holding");
    assert.equal(r.consecutivePasses, 13);
  });
});

describe("Tempo floor gating", () => {
  test("Settling: full pass below the tempo floor steps BPM but does NOT count toward graduation", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", consecutivePasses: 3, practiceBPM: 60, targetBPM: 100 }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "settling");
    assert.equal(r.consecutivePasses, 3, "graduation counter unchanged — this pass didn't clear the floor");
    // Pass 59: gap-proportional step (gap=40, k=0.3 -> 12, capped at 8).
    assert.equal(r.practiceBPM, 68, "practiceBPM still ratchets up regardless of floor-gating");
  });

  test("Settling: full pass exactly AT the tempo floor does count (>=, not >)", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", consecutivePasses: 0, practiceBPM: 70, targetBPM: 100 }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.consecutivePasses, 1);
  });

  test("Stabilizing has no tempo floor — a full pass at a low practiceBPM still counts", () => {
    const r = computeLadderAdvance(
      baseState({ consecutivePasses: 0, practiceBPM: 20, targetBPM: 100 }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.consecutivePasses, 1);
  });

  test("No targetBPM configured means no floor to gate against — pass always counts", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", consecutivePasses: 0, practiceBPM: 40, targetBPM: null }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.consecutivePasses, 1);
  });
});

describe("Demotion", () => {
  test("Holding fail demotes exactly one stage, to Settling", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "holding", consecutivePasses: 5, practiceBPM: 100, targetBPM: 100 }),
      { result: "fail", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "settling");
    assert.equal(r.demoted, true);
    assert.equal(r.nextDueDate, "2026-01-08");
  });

  test("Stabilizing fail never demotes below Stabilizing (the floor)", () => {
    const r = computeLadderAdvance(baseState({ consecutivePasses: 1 }), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.stage, "stabilizing");
    assert.equal(r.demoted, true);
  });

  test("Fail pulls practiceBPM back 2 BPM (same magnitude as pass/soft-miss) and never below 0", () => {
    const normal = computeLadderAdvance(baseState({ practiceBPM: 60 }), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(normal.practiceBPM, 58);
    const nearZero = computeLadderAdvance(baseState({ practiceBPM: 1 }), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(nearZero.practiceBPM, 0);
  });

  test("Pass 59: soft-miss keeps the stage, resets the pass counter, and steps practiceBPM FORWARD at a halved ratchet rate (no longer the old flat -2)", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", consecutivePasses: 3, practiceBPM: 80, targetBPM: 100 }),
      { result: "soft-miss", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "settling");
    assert.equal(r.consecutivePasses, 0);
    // halved k = 0.15, gap = 20 -> round(0.15*20) = 3 -> 80+3.
    assert.equal(r.practiceBPM, 83, "moves forward, not backward — a soft-miss no longer costs tempo");
    assert.equal(r.tempoRatchetK, 0.15, "k halved from the default 0.3");
    assert.equal(r.demoted, false);
  });

  test("Pass never asks practiceBPM to exceed targetBPM", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: 99, targetBPM: 100 }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.practiceBPM, 100);
  });
});

describe("Holding interval math at several effectiveness levels", () => {
  // consecutivePasses here is the count going in; Holding always
  // increments it first (no graduation cap), so interval math uses N+1.
  const cases = [
    [0, "low", 8], [0, undefined, 14], [0, "high", 20],
    [1, "low", 5], [1, undefined, 14], [1, "high", 27],
    [2, "low", 3], [2, undefined, 14], [2, "high", 38],
  ];
  cases.forEach(([consecutivePasses, effectiveness, expectedDays]) => {
    test(`consecutivePasses=${consecutivePasses}, effectiveness=${effectiveness} -> +${expectedDays}d`, () => {
      const state = baseState({ stage: "holding", consecutivePasses, practiceBPM: 100, targetBPM: null });
      const r = computeLadderAdvance(state, { result: "pass", asOfDate: "2026-01-01", effectiveness }, LADDER_CONFIG);
      const expected = new Date("2026-01-01T00:00:00");
      expected.setDate(expected.getDate() + expectedDays);
      const pad2 = (n) => String(n).padStart(2, "0");
      assert.equal(r.nextDueDate, `${expected.getFullYear()}-${pad2(expected.getMonth() + 1)}-${pad2(expected.getDate())}`);
    });
  });

  test("growth is capped at maxIntervalDays even after many high-effectiveness passes", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "holding", consecutivePasses: 20, practiceBPM: 100, targetBPM: null }),
      { result: "pass", asOfDate: "2026-01-01", effectiveness: "high" },
      LADDER_CONFIG
    );
    assert.equal(r.nextDueDate, "2026-03-12", "2026-01-01 + 70 days (maxIntervalDays)");
  });

  // Regression test for a bug fixed after this feature shipped: App.jsx's
  // handleLogSession originally never passed `effectiveness` at all, so
  // this multiplier always landed on the neutral case (1x) and Holding's
  // interval could never grow past 14 days no matter how many clean
  // passes happened.
  test("[regression] repeated passes with a high-effectiveness signal actually grow the interval over time", () => {
    let state = { stage: "holding", consecutivePasses: 0, practiceBPM: 100, targetBPM: null };
    const dueDates = [];
    for (let i = 0; i < 3; i++) {
      const advance = computeLadderAdvance(state, { result: "pass", effectiveness: "high", asOfDate: "2026-01-01" }, LADDER_CONFIG);
      state = advance;
      dueDates.push(advance.nextDueDate);
    }
    assert.deepEqual(dueDates, ["2026-01-21", "2026-01-28", "2026-02-08"]);
    assert.notEqual(dueDates[2], "2026-01-15", "must not stay pinned at the flat 14-day interval");
  });
});

describe("Two-consecutive-fails-in-Stabilizing signal", () => {
  test("a single Stabilizing fail does not trigger needsRelearning", () => {
    const r = computeLadderAdvance(baseState(), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.consecutiveStabilizingFails, 1);
    assert.equal(r.needsRelearning, false);
  });

  test("a second consecutive Stabilizing fail triggers needsRelearning", () => {
    const first = computeLadderAdvance(baseState(), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    const second = computeLadderAdvance(first, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(second.consecutiveStabilizingFails, 2);
    assert.equal(second.needsRelearning, true);
  });

  test("the flag pins nextDueDate to the logging date itself (the reused 'lost' demote-and-pin), not a normal 4-day Stabilizing interval", () => {
    const first = computeLadderAdvance(baseState(), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(first.nextDueDate, "2026-01-05", "an ordinary Stabilizing fail still uses the 4-day cadence");
    const second = computeLadderAdvance(first, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(second.nextDueDate, "2026-01-05", "the fail that sets the flag pins to today instead");
  });

  test("a pass in between resets the Stabilizing fail streak", () => {
    const afterFail = computeLadderAdvance(baseState(), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    const afterPass = computeLadderAdvance(afterFail, { result: "pass", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(afterPass.consecutiveStabilizingFails, 0);
  });

  test("a fail that demotes INTO Stabilizing (from Settling) does not itself count toward the signal", () => {
    const r = computeLadderAdvance(baseState({ stage: "settling" }), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.stage, "stabilizing");
    assert.equal(r.consecutiveStabilizingFails, 0);
  });

  test("needsRelearning never fires for fails outside Stabilizing", () => {
    const r = computeLadderAdvance(baseState({ stage: "holding", consecutiveStabilizingFails: 5 }), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.needsRelearning, false);
  });
});

// Pass 11 — the four re-learning rules
// (docs/Decisions.md#spaced-repetition--maintenance). The flag stopped
// being a per-call informational return and became persisted, sticky
// state read back in via chunkLadderState.needsRelearning.
describe("needsRelearning: stickiness and the dual exit (rule 2)", () => {
  test("the flag persists across a subsequent soft-miss — neither set nor cleared by one", () => {
    const flagged = baseState({ needsRelearning: true, consecutiveStabilizingFails: 2 });
    const r = computeLadderAdvance(flagged, { result: "soft-miss", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(r.needsRelearning, true);
  });

  test("the flag persists across a non-graduating pass", () => {
    const flagged = baseState({ needsRelearning: true, consecutivePasses: 0 });
    const r = computeLadderAdvance(flagged, { result: "pass", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(r.consecutivePasses, 1);
    assert.equal(r.needsRelearning, true, "one pass is not four — still rebuilding");
  });

  test("the flag persists across further fails while already flagged", () => {
    const flagged = baseState({ needsRelearning: true, consecutiveStabilizingFails: 2 });
    const r = computeLadderAdvance(flagged, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(r.needsRelearning, true);
    assert.equal(r.consecutiveStabilizingFails, 3);
  });

  test("4 consecutive full passes graduate out of Stabilizing and clear the flag automatically", () => {
    let state = baseState({ needsRelearning: true, consecutiveStabilizingFails: 2, consecutivePasses: 0, practiceBPM: 40 });
    const flagAfterEach = [];
    for (let i = 0; i < 4; i++) {
      state = computeLadderAdvance(state, { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
      flagAfterEach.push(state.needsRelearning);
    }
    assert.deepEqual(flagAfterEach, [true, true, true, false], "clears only on the 4th (graduating) pass");
    assert.equal(state.stage, "settling");
    assert.equal(state.graduated, true);
  });

  test("a graduation out of Settling does not spuriously clear a flag (the flag can only live in Stabilizing anyway)", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", consecutivePasses: 3, practiceBPM: 70, targetBPM: 100, needsRelearning: true }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "holding");
    assert.equal(r.needsRelearning, true, "only a Stabilizing graduation is the documented auto-exit");
  });

  test("an absent needsRelearning on the incoming state is read as false, not undefined", () => {
    const { needsRelearning, ...noFlag } = baseState();
    const r = computeLadderAdvance(noFlag, { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.needsRelearning, false);
  });
});

describe("needsRelearning: practiceBPM resets to the suggested starting tempo (rule 4)", () => {
  test("practiceBPM jumps to suggestedStartingBPM the moment the flag is set, not the normal -2 fail step", () => {
    const first = computeLadderAdvance(
      baseState({ practiceBPM: 92, suggestedStartingBPM: 55 }),
      { result: "fail", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(first.needsRelearning, false);
    assert.equal(first.practiceBPM, 90, "first fail is still just the ordinary -2 step");

    const second = computeLadderAdvance(
      { ...first, suggestedStartingBPM: 55, targetBPM: 100 },
      { result: "fail", asOfDate: "2026-01-05" },
      LADDER_CONFIG
    );
    assert.equal(second.needsRelearning, true);
    assert.equal(second.practiceBPM, 55, "the flagging fail resets to the suggestion outright");
  });

  test("the reset is not reapplied on later fails while already flagged — the ordinary -2 step resumes", () => {
    const flagged = baseState({ needsRelearning: true, consecutiveStabilizingFails: 2, practiceBPM: 60, suggestedStartingBPM: 55 });
    const r = computeLadderAdvance(flagged, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(r.practiceBPM, 58);
  });

  test("with no suggestedStartingBPM supplied, the flagging fail falls back to the normal step rather than writing null", () => {
    const first = computeLadderAdvance(baseState({ practiceBPM: 92 }), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    const second = computeLadderAdvance(first, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(second.needsRelearning, true);
    assert.equal(second.practiceBPM, 88);
  });
});

describe("Defensive / passthrough behavior", () => {
  test("a null stage (not-yet-on-ladder default) is treated as Stabilizing, not a crash", () => {
    const r = computeLadderAdvance(baseState({ stage: null }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.stage, "stabilizing");
  });

  test("tier1Done passes through unchanged", () => {
    const r = computeLadderAdvance(baseState({ tier1Done: true }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.tier1Done, true);
  });

  test("a null practiceBPM (never seeded) passes through unchanged rather than becoming NaN", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: null }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.practiceBPM, null);
  });
});

// Concept 3 of the starting/suggested/demonstrated tempo split
// (docs/Algorithms.md, lib/confidence.js's getSuggestedStartingBPM block
// comment): 3+ clean ("perfect") reps at a bpm above the chunk's current
// baseline replace the baseline outright, rather than the usual +2/-2
// incremental step.
describe("computeDemonstratedTempoBaseline (the raw override rule)", () => {
  test("3 clean reps at a bpm above the current baseline overrides it directly", () => {
    const result = computeDemonstratedTempoBaseline({ outcome: "pass", cleanReps: 3, bpm: 85, practiceBPM: 75, targetBPM: 120 });
    assert.equal(result, 85);
  });

  test("fewer than 3 clean reps does NOT trigger the override, even at a much higher bpm", () => {
    const result = computeDemonstratedTempoBaseline({ outcome: "pass", cleanReps: 2, bpm: 85, practiceBPM: 75, targetBPM: 120 });
    assert.equal(result, null);
  });

  test("a bpm at or below the current baseline does not trigger the override, even with enough reps", () => {
    const atBaseline = computeDemonstratedTempoBaseline({ outcome: "pass", cleanReps: 5, bpm: 75, practiceBPM: 75, targetBPM: 120 });
    const belowBaseline = computeDemonstratedTempoBaseline({ outcome: "pass", cleanReps: 5, bpm: 70, practiceBPM: 75, targetBPM: 120 });
    assert.equal(atBaseline, null);
    assert.equal(belowBaseline, null);
  });

  test("applies on a soft-miss too — enough reps at a higher tempo still counts as demonstrated, even if the overall session wasn't a full pass", () => {
    const result = computeDemonstratedTempoBaseline({ outcome: "soft-miss", cleanReps: 3, bpm: 85, practiceBPM: 75, targetBPM: 120 });
    assert.equal(result, 85);
  });

  test("never applies on a fail, even with 3+ clean reps at a higher bpm (e.g. a repeat-soft-miss auto-fail, or a manual override)", () => {
    const result = computeDemonstratedTempoBaseline({ outcome: "fail", cleanReps: 5, bpm: 90, practiceBPM: 75, targetBPM: 120 });
    assert.equal(result, null);
  });

  test("the demonstrated bpm is still capped at targetBPM, same as the normal ratchet step", () => {
    const result = computeDemonstratedTempoBaseline({ outcome: "pass", cleanReps: 3, bpm: 150, practiceBPM: 75, targetBPM: 120 });
    assert.equal(result, 120);
  });

  test("no targetBPM configured means no cap — the raw achieved bpm becomes the baseline", () => {
    const result = computeDemonstratedTempoBaseline({ outcome: "pass", cleanReps: 3, bpm: 150, practiceBPM: 75, targetBPM: null });
    assert.equal(result, 150);
  });
});

describe("computeLadderAdvance wires the demonstrated-tempo override into practiceBPM", () => {
  test("a pass with 3 clean reps well above the current baseline jumps straight to the achieved bpm, not just +2", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 75 }),
      { result: "pass", cleanReps: 3, bpm: 85, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.practiceBPM, 85);
  });

  test("Pass 59: a pass with only 2 clean reps (below the demonstrated-tempo override threshold) falls back to the gap-proportional ratchet step, not the old flat +2", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 75 }),
      { result: "pass", cleanReps: 2, bpm: 85, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    // gap=100-75=25, k=0.3 -> round(7.5)=8, capped at kCapBpm (8) -> 75+8.
    // (bpm 85 > practiceBPM 75 also qualifies for the overlearning bonus,
    // but the bonus step — round(0.5*10)=5 — is smaller than the ratchet
    // step here, so max(ratchetStep, bonusStep) still lands on 8.)
    assert.equal(r.practiceBPM, 83);
  });

  test("a soft-miss with 3 clean reps above the baseline still overrides practiceBPM upward, despite the overall miss", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 75 }),
      { result: "soft-miss", cleanReps: 3, bpm: 85, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.practiceBPM, 85);
  });

  test("a fail never overrides practiceBPM upward, even with cleanReps/bpm that would otherwise qualify", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 75, stage: "settling" }),
      { result: "fail", cleanReps: 5, bpm: 90, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.practiceBPM, 73); // normal fail step: -2
  });

  test("Pass 59: existing pass behavior (no outcome.cleanReps/bpm supplied) falls back to the gap-proportional ratchet step, not the old flat +2", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: 75 }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    // gap=25, k=0.3 -> round(7.5)=8, capped at kCapBpm (8) -> 75+8.
    assert.equal(r.practiceBPM, 83);
  });
});

// Pass 26 follow-up (docs/Decisions.md#spaced-repetition--maintenance): a
// real fail resets practiceBPM to the recorded entry tempo for the stage
// it demotes INTO, instead of the flat bpmSteps.fail step — reopening a
// decision made once already while this file was first built ("a real
// fail costs practiceBPM the same 2 BPM as a soft-miss"), at the user's
// explicit request.
describe("Per-stage entry-BPM tempo reset on a real fail", () => {
  test("a chunk's very first session (stage: null) seeds stabilizingEntryBPM from the just-seeded practiceBPM", () => {
    const r = computeLadderAdvance(baseState({ stage: null, practiceBPM: 45 }), { result: "fail", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.stabilizingEntryBPM, 45);
    // Seeded AND reset to the same value in the same call — a fail that IS
    // the chunk's first-ever entry has no earlier tempo to fall back to.
    assert.equal(r.practiceBPM, 45, "no earlier baseline exists yet, so this fail doesn't step down at all");
  });

  test("once a Stabilizing entry tempo is recorded, a later fail resets to it instead of stepping -2", () => {
    // Seed the baseline via the first-ever session, then climb well past it.
    const seeded = computeLadderAdvance(baseState({ stage: null, practiceBPM: 40 }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(seeded.stabilizingEntryBPM, 40);
    // Pass 59: gap-proportional step (gap=100-40=60, k=0.3 -> 18, capped
    // at kCapBpm 8) — not the old flat +2.
    assert.equal(seeded.practiceBPM, 48);
    let state = seeded;
    for (let i = 0; i < 5; i++) {
      state = computeLadderAdvance(state, { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    }
    assert.ok(state.practiceBPM > 50, "sanity check: practiceBPM has actually climbed well past the recorded baseline");

    const failed = computeLadderAdvance(state, { result: "fail", asOfDate: "2026-01-10" }, LADDER_CONFIG);
    assert.equal(failed.practiceBPM, 40, "resets all the way back to Stabilizing's recorded entry tempo, not a -2 step off the climbed value");
    assert.equal(failed.stabilizingEntryBPM, 40, "the baseline itself is unchanged — no stage transition happened");
  });

  test("the full round trip: promote to Settling at one tempo, climb further, fail back down — resets to Settling's OWN entry tempo, not Stabilizing's", () => {
    // Graduate Stabilizing -> Settling. LADDER_CONFIG requires 4 consecutive
    // passes; land the 4th exactly at a chosen practiceBPM so Settling's
    // entry tempo is a known, distinct value from Stabilizing's.
    let state = baseState({ stage: null, practiceBPM: 40, consecutivePasses: 3 });
    const graduating = computeLadderAdvance(state, { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(graduating.stage, "settling");
    assert.equal(graduating.graduated, true);
    // Pass 59: gap-proportional step (gap=60, k=0.3 -> 18, capped at 8).
    assert.equal(graduating.practiceBPM, 48, "sanity: the graduating pass steps by the gap-proportional ratchet amount");
    assert.equal(graduating.settlingEntryBPM, 48, "Settling's entry tempo is recorded as the tempo the chunk graduated in AT");
    assert.equal(graduating.stabilizingEntryBPM, 40, "Stabilizing's own entry tempo (from earlier) is untouched by this graduation");

    // Climb well past 42 while in Settling. computeLadderAdvance's return
    // value deliberately doesn't echo caller-resolved inputs like
    // targetBPM back (same reason the header note above targetBPM in the
    // chunkLadderState shape gives) — a real caller re-reads it fresh from
    // the chunk/piece every call, so the loop here must too, or Settling's
    // tempo floor silently stops being gated at all (targetBPM undefined
    // reads as "no floor to check" — see clearsStageFloor).
    state = { ...graduating, targetBPM: 100 };
    for (let i = 0; i < 6; i++) {
      state = { ...computeLadderAdvance(state, { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG), targetBPM: 100 };
    }
    assert.ok(state.practiceBPM > 50, "sanity: climbed well past Settling's recorded entry tempo");
    assert.equal(state.stage, "settling", "still in Settling — this LADDER_CONFIG's Settling floor keeps it from graduating further here");

    // Now fail — demotes Settling -> Stabilizing. Per the user's decision,
    // this must reset to STABILIZING's recorded entry tempo (40, from the
    // very first session), not Settling's (48) and not a flat -2 off the
    // climbed value.
    const failedFromSettling = computeLadderAdvance(state, { result: "fail", asOfDate: "2026-02-01" }, LADDER_CONFIG);
    assert.equal(failedFromSettling.stage, "stabilizing");
    assert.equal(failedFromSettling.practiceBPM, 40, "resets to the STAGE IT'S DEMOTED INTO's entry tempo (Stabilizing's, 40) — not Settling's (48)");
  });

  test("rule 4 (needsRelearning's suggestedStartingBPM reset) still wins outright over the entry-tempo reset", () => {
    const flagging = baseState({
      stage: "stabilizing",
      consecutiveStabilizingFails: 1,
      practiceBPM: 90,
      stabilizingEntryBPM: 70,
      suggestedStartingBPM: 30,
    });
    const r = computeLadderAdvance(flagging, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(r.needsRelearning, true);
    assert.equal(r.practiceBPM, 30, "the flagging fail's rule-4 reset (30) wins over the recorded entry tempo (70)");
  });

  test("with no entry tempo recorded for the demoted-into stage (pre-existing/migrated chunk), a fail falls back to the ordinary -2 step", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", practiceBPM: 80, stabilizingEntryBPM: null }),
      { result: "fail", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "stabilizing");
    assert.equal(r.practiceBPM, 78, "no recorded Stabilizing entry tempo to reset to, so the flat -2 step still applies");
  });

  test("soft-miss and a non-graduating pass pass the three entry-BPM fields through unchanged", () => {
    const state = baseState({ stabilizingEntryBPM: 40, settlingEntryBPM: 50, holdingEntryBPM: 60 });
    const softMiss = computeLadderAdvance(state, { result: "soft-miss", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.deepEqual(
      { s: softMiss.stabilizingEntryBPM, se: softMiss.settlingEntryBPM, h: softMiss.holdingEntryBPM },
      { s: 40, se: 50, h: 60 }
    );
    const nonGraduatingPass = computeLadderAdvance(
      baseState({ ...state, consecutivePasses: 0 }),
      { result: "pass", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.deepEqual(
      { s: nonGraduatingPass.stabilizingEntryBPM, se: nonGraduatingPass.settlingEntryBPM, h: nonGraduatingPass.holdingEntryBPM },
      { s: 40, se: 50, h: 60 },
      "a pass that doesn't graduate never touches any recorded entry tempo"
    );
  });
});

describe("ladderConfig editing (Settings' LadderConfigEditor) actually changes ladder behavior, not just the stored shape", () => {
  test("an edited interval survives mergeLadderConfig's partial-override merge, and a subsequent computeLadderAdvance call uses it over the default", () => {
    // Same shape LadderConfigEditor writes: a piece-level partial override
    // (only the one field the user touched), same input mergeLadderConfig
    // already handles for import/migration — confirming that existing
    // support is sufficient for a Settings edit too, not just those paths.
    const edited = mergeLadderConfig({ stabilizing: { intervalDays: 10 } });
    assert.equal(edited.stabilizing.intervalDays, 10, "the edited value persists");
    assert.equal(edited.stabilizing.graduationPasses, 4, "an untouched sibling field keeps its default");
    assert.equal(edited.settling.intervalDays, 7, "an untouched stage keeps its defaults entirely");

    // A full pass that doesn't graduate (only 1 of 4 required) schedules its
    // next review at asOfDate + the stage's intervalDays — proving the
    // EDITED value (10) drives computeLadderAdvance's actual output, not
    // LADDER_CONFIG's default (4).
    const r = computeLadderAdvance(baseState({ consecutivePasses: 0 }), { result: "pass", asOfDate: "2026-01-01" }, edited);
    assert.equal(r.stage, "stabilizing", "only 1 of 4 required passes — doesn't graduate");
    assert.equal(r.nextDueDate, "2026-01-11", "10 days out (the edited interval), not 4 (the default)");
  });
});

describe("isInterleaveEligible (Pass 29's Interleaved-mode eligibility rule)", () => {
  test("includes Settling and Holding", () => {
    assert.equal(isInterleaveEligible({ stage: "settling" }), true);
    assert.equal(isInterleaveEligible({ stage: "holding" }), true);
  });

  test("excludes Stabilizing", () => {
    assert.equal(isInterleaveEligible({ stage: "stabilizing" }), false);
  });

  test("excludes a chunk with no ladder entry yet (stage null/undefined, hasn't cleared Tier 1)", () => {
    assert.equal(isInterleaveEligible({ stage: null }), false);
    assert.equal(isInterleaveEligible({}), false);
    assert.equal(isInterleaveEligible(undefined), false);
  });
});

describe("isPieceLearned (Pass 39's Stage 3 rollup — every practice chunk at Holding)", () => {
  const chunkSet = { practiceChunks: [{ id: "c1" }, { id: "c5" }, { id: "c9" }] };

  test("false when no chunk has been touched at all", () => {
    assert.equal(isPieceLearned({ progress: {} }, chunkSet), false);
  });

  test("false when some chunks are at Holding but at least one isn't", () => {
    const piece = {
      progress: {
        c1: { stage: "holding" },
        c5: { stage: "settling" },
        c9: { stage: "holding" },
      },
    };
    assert.equal(isPieceLearned(piece, chunkSet), false);
  });

  test("true only once every practice chunk has reached Holding", () => {
    const piece = {
      progress: {
        c1: { stage: "holding" },
        c5: { stage: "holding" },
        c9: { stage: "holding" },
      },
    };
    assert.equal(isPieceLearned(piece, chunkSet), true);
  });

  test("transitions/combos are irrelevant — only chunkSet.practiceChunks is read", () => {
    const withExtras = {
      practiceChunks: chunkSet.practiceChunks,
      transitions: [{ id: "t1" }],
      combos: [{ id: "x1" }],
    };
    const piece = {
      progress: {
        c1: { stage: "holding" },
        c5: { stage: "holding" },
        c9: { stage: "holding" },
        // t1/x1 deliberately left untouched — must not affect the result.
      },
    };
    assert.equal(isPieceLearned(piece, withExtras), true);
  });

  test("an empty piece (no practice chunks) is defensively not 'learned'", () => {
    assert.equal(isPieceLearned({ progress: {} }, { practiceChunks: [] }), false);
  });
});

// Pass 59 — the tempo ratchet: replaces the flat bpmSteps.pass/softMiss
// deltas with a step proportional to the remaining gap to targetBPM, at a
// per-chunk adaptive rate (progress[id].tempoRatchetK). See
// docs/Algorithms.md#tempo-ratchet and docs/Decisions.md#tempo-ratchet.
describe("Pass 59: tempo ratchet — gap-proportional step size", () => {
  // step = clamp(round(k * gap), 1, kCapBpm), where gap = targetBPM -
  // practiceBPM. Each case drives computeLadderAdvance's PASS branch with
  // no cleanReps/bpm, so neither computeDemonstratedTempoBaseline nor the
  // overlearning bonus apply — the resulting practiceBPM is exactly
  // practiceBPM + that clamped step (subject to stepBPM's own
  // cap-at-target/floor-at-0, same as always).
  const cases = [
    [60, 100, 0.3, 8, 68, "a large gap (40) rounds up past the ceiling — clamped at kCapBpm (8)"],
    [97, 100, 0.3, 8, 98, "a small gap (3) rounds down to 1, still respecting the 1bpm floor"],
    [90, 100, 0.3, 8, 93, "a mid-size gap (10) rounds cleanly to 3, under the ceiling"],
    [50, 60, 0.01, 8, 51, "a tiny k would round the raw step to 0 — the 1bpm floor kicks in instead"],
    [0, 1000, 0.3, 3, 3, "a huge gap would blow past a smaller kCapBpm (3) without the ceiling"],
  ];
  cases.forEach(([practiceBPM, targetBPM, k, kCapBpm, expected, label]) => {
    test(label, () => {
      const config = { ...LADDER_CONFIG, tempoRatchet: { k, kCapBpm } };
      const r = computeLadderAdvance(baseState({ practiceBPM, targetBPM }), { result: "pass", asOfDate: "2026-01-01" }, config);
      assert.equal(r.practiceBPM, expected);
    });
  });

  test("gap <= 0 (practiceBPM already at targetBPM) still computes a 1bpm floor step internally, but stepBPM's own cap-at-target keeps the result pinned at targetBPM", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: 100, targetBPM: 100 }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.practiceBPM, 100);
  });
});

describe("Pass 59: tempo ratchet — k-adaptation lifecycle (halve on soft-miss, recover after two clean passes, reset on fail)", () => {
  test("a soft-miss halves tempoRatchetK and still steps practiceBPM forward (not zero, not backward) at the halved rate", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: 80, targetBPM: 100 }), { result: "soft-miss", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.tempoRatchetK, 0.15, "halved from the default 0.3");
    // halved k=0.15, gap=20 -> round(3)=3 -> 80+3.
    assert.equal(r.practiceBPM, 83, "still moves forward, just at half the usual ratchet rate");
  });

  test("two consecutive clean passes after a soft-miss fully restore tempoRatchetK to the configured default", () => {
    const afterSoftMiss = computeLadderAdvance(baseState({ practiceBPM: 80, targetBPM: 100 }), { result: "soft-miss", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(afterSoftMiss.tempoRatchetK, 0.15);
    assert.equal(afterSoftMiss.consecutivePasses, 0, "soft-miss resets the pass counter — the recovery count starts fresh from here");

    // computeLadderAdvance doesn't echo targetBPM back (see the header note
    // on the chunkLadderState shape) — a real caller re-reads it fresh from
    // the chunk/piece every call, so this loop must re-supply it too.
    const firstPass = computeLadderAdvance({ ...afterSoftMiss, targetBPM: 100 }, { result: "pass", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(firstPass.tempoRatchetK, 0.15, "one clean pass alone doesn't recover k yet");

    const secondPass = computeLadderAdvance({ ...firstPass, targetBPM: 100 }, { result: "pass", asOfDate: "2026-01-09" }, LADDER_CONFIG);
    assert.equal(secondPass.tempoRatchetK, 0.3, "the 2nd consecutive clean pass restores k to the configured default");
  });

  test("repeated soft-misses keep halving k further — there's no floor on k itself, only on the resulting BPM step", () => {
    const first = computeLadderAdvance(baseState({ practiceBPM: 80, targetBPM: 100 }), { result: "soft-miss", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(first.tempoRatchetK, 0.15);
    const second = computeLadderAdvance({ ...first, targetBPM: 100 }, { result: "soft-miss", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(second.tempoRatchetK, 0.075);
    assert.ok(second.practiceBPM > first.practiceBPM, "still steps forward — the 1bpm floor guarantees this regardless of how small k gets");
  });

  test("a fail resets tempoRatchetK to default via the fallback flat-step practiceBPM-reset path", () => {
    const halved = computeLadderAdvance(baseState({ practiceBPM: 80, targetBPM: 100 }), { result: "soft-miss", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(halved.tempoRatchetK, 0.15, "sanity: k is non-default going into the fail");
    const failed = computeLadderAdvance({ ...halved, stabilizingEntryBPM: null, targetBPM: 100 }, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(failed.tempoRatchetK, 0.3, "k resets to default even on the plain flat-step fail path");
  });

  test("a fail resets tempoRatchetK to default via the per-stage entry-BPM practiceBPM-reset path", () => {
    const halved = computeLadderAdvance(
      baseState({ practiceBPM: 80, targetBPM: 100, stabilizingEntryBPM: 40 }),
      { result: "soft-miss", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    const failed = computeLadderAdvance({ ...halved, targetBPM: 100 }, { result: "fail", asOfDate: "2026-01-05" }, LADDER_CONFIG);
    assert.equal(failed.practiceBPM, 40, "sanity: this fail actually took the entry-BPM reset path, not the flat step");
    assert.equal(failed.tempoRatchetK, 0.3, "k still resets to default on this path too");
  });

  test("a fail resets tempoRatchetK to default via rule 4's needsRelearning suggestedStartingBPM-reset path", () => {
    const halved = computeLadderAdvance(baseState({ practiceBPM: 80, targetBPM: 100 }), { result: "soft-miss", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    // soft-miss always resets consecutiveStabilizingFails to 0 — carry a
    // fresh count of 1 through by hand so the upcoming fail is the 2nd
    // consecutive Stabilizing fail (the one that fires rule 4).
    const flaggingFail = computeLadderAdvance(
      { ...halved, targetBPM: 100, consecutiveStabilizingFails: 1, suggestedStartingBPM: 30 },
      { result: "fail", asOfDate: "2026-01-05" },
      LADDER_CONFIG
    );
    assert.equal(flaggingFail.needsRelearning, true, "sanity: this fail actually triggered rule 4");
    assert.equal(flaggingFail.practiceBPM, 30, "sanity: rule 4's reset fired, not the entry-BPM reset or the flat step");
    assert.equal(flaggingFail.tempoRatchetK, 0.3, "k still resets to default on this path too");
  });
});

// [Regression, found on critical review] k-recovery reuses
// consecutivePasses/passesIfCounted exactly as this pass was asked to
// (rather than adding a new counter) — but that counter is ALSO the one
// graduation gates on a stage's tempo floor, so a pass that doesn't clear
// the floor doesn't advance it either. The practical consequence: a chunk
// sitting below Settling/Holding's tempo floor can rack up many real
// passes without ever recovering a halved k, because none of them count
// as "clean" for recovery purposes any more than they count toward
// graduation. Self-correcting once practiceBPM actually clears the floor
// (confirmed below) — not a permanent stall — and Stabilizing has no
// floor, so this can't happen there. Documented rather than "fixed":
// decoupling recovery from the floor would need a second persisted
// counter, which contradicts this pass's own instruction to reuse the
// existing one.
describe("Pass 59: tempo ratchet — k recovery is gated by the same stage floor graduation uses", () => {
  test("a soft-miss below Settling's tempo floor keeps k halved through many subsequent passes, since none of them clear the floor either", () => {
    const smallCapConfig = { ...LADDER_CONFIG, tempoRatchet: { k: 0.3, kCapBpm: 1 } }; // tiny cap so the climb is slow enough to observe
    let state = { ...computeLadderAdvance(
      { stage: "settling", consecutivePasses: 0, practiceBPM: 30, targetBPM: 100, tier1Done: true },
      { result: "soft-miss", asOfDate: "2026-01-01" },
      smallCapConfig
    ), targetBPM: 100 };
    assert.equal(state.tempoRatchetK, 0.15, "sanity: the soft-miss halved k");

    for (let i = 0; i < 5; i++) {
      state = { ...computeLadderAdvance(state, { result: "pass", asOfDate: "2026-01-01" }, smallCapConfig), targetBPM: 100 };
    }
    assert.ok(state.practiceBPM < 70, "sanity: still well below Settling's 70% floor after 5 passes at the tiny cap");
    assert.equal(state.consecutivePasses, 0, "none of these passes cleared the floor, so none counted — not reset, just never incremented");
    assert.equal(state.tempoRatchetK, 0.15, "k is still halved — five real passes were not enough to recover it, because none were floor-clearing");
  });

  test("recovery still fires eventually once practiceBPM actually clears the floor — not a permanent stall", () => {
    const smallCapConfig = { ...LADDER_CONFIG, tempoRatchet: { k: 0.3, kCapBpm: 1 } };
    let state = { ...computeLadderAdvance(
      { stage: "settling", consecutivePasses: 0, practiceBPM: 30, targetBPM: 100, tier1Done: true },
      { result: "soft-miss", asOfDate: "2026-01-01" },
      smallCapConfig
    ), targetBPM: 100 };
    assert.equal(state.tempoRatchetK, 0.15);

    // A generous bound (well more than the ~40 passes it actually takes to
    // climb from 31 to past 70 one BPM at a time) — this test cares that
    // recovery happens at all, not the exact pass count, which also
    // depends on the separate, already-documented "the floor check itself
    // runs against the pre-session practiceBPM" quirk
    // (docs/Decisions.md#open-questions).
    let recovered = false;
    for (let i = 0; i < 100 && !recovered; i++) {
      state = { ...computeLadderAdvance(state, { result: "pass", asOfDate: "2026-01-01" }, smallCapConfig), targetBPM: 100 };
      recovered = state.tempoRatchetK === 0.3;
    }
    assert.equal(recovered, true, "k does eventually recover once practiceBPM climbs past the floor — this is a slowdown, not a permanent stall");
  });
});

describe("Pass 59: the overlearning bonus", () => {
  test("does not apply when logged bpm merely meets the asked practiceBPM (not beats it) — the plain gap-proportional step applies", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 60, targetBPM: 100 }),
      { result: "pass", cleanReps: 1, bpm: 60, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.practiceBPM, 68, "no bonus — bpm merely met the ask, didn't beat it");
  });

  test("applies and widens the step when logged bpm clearly beats the asked practiceBPM", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 60, targetBPM: 100 }),
      { result: "pass", cleanReps: 1, bpm: 100, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    // the plain ratchet step alone would be 8 (60 -> 68); the bonus
    // (round(0.5*(100-60))=20) is bigger, so max(8, 20) wins: 60+20=80.
    assert.equal(r.practiceBPM, 80);
  });

  test("caps the RESULTING practiceBPM at 1.15x targetBPM, not the bonus amount itself", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 95, targetBPM: 100 }),
      { result: "pass", cleanReps: 1, bpm: 150, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    // Uncapped candidate would be 95 + max(2, round(0.5*55)=28) = 123, but
    // 1.15*100 = 115 caps the RESULT.
    assert.equal(r.practiceBPM, 115);
  });

  test("never overrides computeDemonstratedTempoBaseline — that mechanism still wins outright and keeps its OWN cap-at-target, not the overlearning 1.15x allowance", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 60, targetBPM: 100 }),
      { result: "pass", cleanReps: 4, bpm: 150, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    // 3+ clean reps at a bpm above baseline triggers the demonstrated-tempo
    // override, capped at targetBPM (100) — not the overlearning bonus's
    // 1.15x allowance (115), which is what a misrouted implementation
    // would produce instead.
    assert.equal(r.practiceBPM, 100, "demonstrated-tempo priority wins, capped at targetBPM, not 1.15x it");
  });
});

describe("Pass 59: targetBPM null falls back to the pre-existing flat bpmSteps step, unchanged", () => {
  test("a pass with no targetBPM uses the flat +2 step, not a gap-based one", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: 60, targetBPM: null }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.practiceBPM, 62);
  });

  test("a soft-miss with no targetBPM uses the flat -2 step (the old backward-stepping behavior), not the ratchet", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: 60, targetBPM: null }), { result: "soft-miss", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.practiceBPM, 58);
    assert.equal(r.tempoRatchetK, 0.15, "k still halves even though the flat step (not a ratchet one) was what actually got used");
  });

  test("the overlearning bonus never applies with no targetBPM (nothing to cap 1.15x against)", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 60, targetBPM: null }),
      { result: "pass", cleanReps: 1, bpm: 150, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.practiceBPM, 62, "falls straight to the flat +2 step — bpm beating the ask is irrelevant without a target");
  });
});

// Pass 60 — "tempo maintenance mode": once practiceBPM is close enough to
// targetBPM, tempo-ratchet step-size calculations substitute a small,
// pinned maintenanceK for the chunk's own tracked tempoRatchetK. Computed
// live off practiceBPM/targetBPM (isInTempoMaintenance), never persisted —
// these tests don't use LADDER_CONFIG's bare tempoRatchet (no
// tempoAchievedThreshold/maintenanceK on it) specifically so every
// pre-existing Pass 59 test above stays provably unaffected: without those
// two fields, isInTempoMaintenance always reads false there (targetBPM *
// undefined is NaN, and every comparison against NaN is false), so this
// pass's substitution never engages for any test that doesn't opt in via
// its own local config below.
describe("Pass 60: tempo maintenance mode", () => {
  const maintenanceConfig = {
    ...LADDER_CONFIG,
    tempoRatchet: { ...LADDER_CONFIG.tempoRatchet, tempoAchievedThreshold: 0.85, maintenanceK: 0.05 },
  };

  describe("isInTempoMaintenance reads true/false live off practiceBPM vs. threshold * targetBPM", () => {
    test("false below the threshold, true at and above it", () => {
      assert.equal(isInTempoMaintenance(84, 100, maintenanceConfig), false, "84 < 85 (0.85 * 100)");
      assert.equal(isInTempoMaintenance(85, 100, maintenanceConfig), true, "exactly at the threshold counts");
      assert.equal(isInTempoMaintenance(95, 100, maintenanceConfig), true);
    });

    test("false without a practiceBPM or targetBPM to compare — nothing to be 'close enough' to yet", () => {
      assert.equal(isInTempoMaintenance(null, 100, maintenanceConfig), false);
      assert.equal(isInTempoMaintenance(95, null, maintenanceConfig), false);
      assert.equal(isInTempoMaintenance(null, null, maintenanceConfig), false);
    });

    test("[regression] flips back to false after a fail resets practiceBPM below the threshold — no special-cased exit path, just re-reading the same live formula", () => {
      // Holding, no holdingEntryBPM recorded, so a fail demotes to Settling
      // and resets practiceBPM to the low tempo this chunk had the last
      // time it entered Settling — well below the maintenance threshold.
      const state = baseState({
        stage: "holding",
        practiceBPM: 95,
        targetBPM: 100,
        tempoRatchetK: 0.3,
        settlingEntryBPM: 60,
      });
      assert.equal(isInTempoMaintenance(state.practiceBPM, state.targetBPM, maintenanceConfig), true, "sanity: starts in maintenance mode (95 >= 85)");

      const failed = computeLadderAdvance(state, { result: "fail", asOfDate: "2026-01-01" }, maintenanceConfig);
      assert.equal(failed.stage, "settling", "demoted one stage");
      assert.equal(failed.practiceBPM, 60, "practiceBPM reset to Settling's recorded entry tempo");
      assert.equal(
        isInTempoMaintenance(failed.practiceBPM, state.targetBPM, maintenanceConfig),
        false,
        "the same live formula, re-read against the post-fail state, is enough to exit maintenance mode — nothing else involved"
      );
    });
  });

  describe("step size uses maintenanceK while in maintenance mode, and the chunk's own tempoRatchetK exactly where Pass 59 left it once out of it", () => {
    // Same starting chunk in both scenarios below — the only thing that
    // differs is tempoAchievedThreshold (1.0 vs 0.85), isolating the
    // maintenanceK substitution as the one variable under test. gap = 10
    // (targetBPM 100 - practiceBPM 90).
    const chunk = () => baseState({ stage: "holding", practiceBPM: 90, targetBPM: 100, tempoRatchetK: 0.3, consecutivePasses: 0 });
    const nonMaintenanceConfig = {
      ...LADDER_CONFIG,
      tempoRatchet: { ...LADDER_CONFIG.tempoRatchet, tempoAchievedThreshold: 1.0, maintenanceK: 0.05 },
    };

    test("out of maintenance mode (90 < 100 * 1.0): step size comes from the chunk's own tempoRatchetK (0.3), exactly as Pass 59 already computes it", () => {
      assert.equal(isInTempoMaintenance(90, 100, nonMaintenanceConfig), false);
      const r = computeLadderAdvance(chunk(), { result: "pass", asOfDate: "2026-01-01" }, nonMaintenanceConfig);
      // clamp(round(0.3 * 10), 1, 8) = 3
      assert.equal(r.practiceBPM, 93, "3-BPM step from the tracked k (0.3) — unaffected by the maintenance-mode machinery existing at all");
    });

    test("in maintenance mode (90 >= 100 * 0.85): step size comes from the pinned maintenanceK (0.05) instead", () => {
      assert.equal(isInTempoMaintenance(90, 100, maintenanceConfig), true);
      const r = computeLadderAdvance(chunk(), { result: "pass", asOfDate: "2026-01-01" }, maintenanceConfig);
      // clamp(round(0.05 * 10), 1, 8) = clamp(round(0.5), 1, 8) = 1
      assert.equal(r.practiceBPM, 91, "1-BPM step from maintenanceK (0.05), not the chunk's own 0.3 — a visibly smaller step than the non-maintenance case above");
    });

    test("the persisted tempoRatchetK is untouched by maintenance mode — confirms nothing was lost by not persisting a maintenance flag", () => {
      const r = computeLadderAdvance(chunk(), { result: "pass", asOfDate: "2026-01-01" }, maintenanceConfig);
      // Only 1 clean pass so far (passesIfCounted < 2), so k-recovery
      // hasn't fired — Pass 59's own bookkeeping says the persisted k stays
      // exactly what it started at (0.3), regardless of which k the step
      // size itself was computed from.
      assert.equal(r.tempoRatchetK, 0.3, "persisted k reflects Pass 59's own bookkeeping exactly — the maintenance substitution only ever touched the step-size calculation");
    });

    test("a soft-miss in maintenance mode: step size also uses maintenanceK, but the real k still halves and persists exactly as Pass 59 already does it", () => {
      const r = computeLadderAdvance(chunk(), { result: "soft-miss", asOfDate: "2026-01-01" }, maintenanceConfig);
      // halvedTempoRatchetK = 0.3 / 2 = 0.15 — that's what persists...
      assert.equal(r.tempoRatchetK, 0.15, "the tracked k still halves on a soft-miss, unaffected by maintenance mode");
      // ...but the step itself was computed from maintenanceK (0.05), not
      // the halved 0.15: clamp(round(0.05 * 10), 1, 8) = 1, not the 2 a
      // halved-0.15 step would have produced (clamp(round(0.15*10),1,8)=2).
      assert.equal(r.practiceBPM, 91, "1-BPM step from maintenanceK, not the 2-BPM step halvedTempoRatchetK (0.15) would have produced");
    });
  });
});
