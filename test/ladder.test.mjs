// Tests for the spaced-repetition ladder engine (src/lib/ladder.js) —
// the Stabilizing/Settling/Holding stage math. Pure function, called from
// App.jsx's handleLogSession on every logged session.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLadderAdvance, computeDemonstratedTempoBaseline } from "../src/lib/ladder.js";
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
    assert.equal(r.practiceBPM, 62);
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
    assert.equal(r.practiceBPM, 62, "practiceBPM still ratchets up regardless of floor-gating");
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

  test("Soft-miss keeps the stage, resets the pass counter, and steps practiceBPM down 2", () => {
    const r = computeLadderAdvance(
      baseState({ stage: "settling", consecutivePasses: 3, practiceBPM: 80, targetBPM: 100 }),
      { result: "soft-miss", asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.stage, "settling");
    assert.equal(r.consecutivePasses, 0);
    assert.equal(r.practiceBPM, 78);
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

  test("a pass with only 2 clean reps (below the override threshold) falls back to the normal +2 step", () => {
    const r = computeLadderAdvance(
      baseState({ practiceBPM: 75 }),
      { result: "pass", cleanReps: 2, bpm: 85, asOfDate: "2026-01-01" },
      LADDER_CONFIG
    );
    assert.equal(r.practiceBPM, 77);
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

  test("existing pass behavior (no outcome.cleanReps/bpm supplied) is unaffected — falls back to the normal +2 step", () => {
    const r = computeLadderAdvance(baseState({ practiceBPM: 75 }), { result: "pass", asOfDate: "2026-01-01" }, LADDER_CONFIG);
    assert.equal(r.practiceBPM, 77);
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
    assert.equal(seeded.practiceBPM, 42);
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
    assert.equal(graduating.practiceBPM, 42, "sanity: the graduating pass still steps +2 like any other pass");
    assert.equal(graduating.settlingEntryBPM, 42, "Settling's entry tempo is recorded as the tempo the chunk graduated in AT");
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
    // very first session), not Settling's (42) and not a flat -2 off the
    // climbed value.
    const failedFromSettling = computeLadderAdvance(state, { result: "fail", asOfDate: "2026-02-01" }, LADDER_CONFIG);
    assert.equal(failedFromSettling.stage, "stabilizing");
    assert.equal(failedFromSettling.practiceBPM, 40, "resets to the STAGE IT'S DEMOTED INTO's entry tempo (Stabilizing's, 40) — not Settling's (42)");
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
