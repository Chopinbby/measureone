// Tests for the spaced-repetition ladder engine (src/lib/ladder.js) —
// the Stabilizing/Settling/Holding stage math. Pure function, called from
// App.jsx's handleLogSession on every logged session.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLadderAdvance } from "../src/lib/ladder.js";

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
