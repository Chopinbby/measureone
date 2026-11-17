// Tests for Pass 139: the pass table, strong passes, half credit, the first-session
// and own-turn rules, and the per-piece override. The rules are in
// docs/Algorithms.md#review-model-v2-planned (rules 1 and 2).
//
// Nothing in components/ can be tested here (no render harness), so everything
// that decides something lives in src/lib/ and is tested directly. The two session
// handlers in App.jsx are closures, so `logSession` below mirrors what they do with
// the REAL functions (ladderContextFor, computeLadderAdvance, tier1DoneAfterSession).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateAllChunks, computeSectionRunThroughs } from "../src/lib/chunking.js";
import {
  computeLadderAdvance,
  simulateTempoConvergence,
  PASS_TABLE_ROWS,
  PASS_TABLE_ROW_LABELS,
  PASS_TABLE_STAGES,
  PASS_TABLE_DIFFICULTIES,
  STRONG_PASS_FRACTION,
  HOLDING_MAX_DAYS_V2,
  passTableRowIndex,
  passTableRowLabelFor,
  autoPassesNeeded,
  passesOverrideFor,
  resolvePassesNeeded,
  effectiveHoldingMaxDaysV2,
  isStrongPass,
  addHalfPass,
  hasPassesOverride,
  withPassesOverride,
  withPassesOverridesCleared,
  withHoldingMaxOverride,
} from "../src/lib/ladder.js";
import {
  ladderContextFor,
  passesNeededForChunk,
  passesNeededByStageFor,
  tier1DoneAfterSession,
} from "../src/lib/scheduling.js";
import { formatLadderStatus, formatPassCount } from "../src/lib/confidence.js";
import { mergeLadderConfig, validateAndMigratePiece } from "../src/lib/storage.js";
import { mergeEditedPiece } from "../src/lib/pieceEdit.js";
import { addDaysISO } from "../src/lib/utils.js";

const CFG = mergeLadderConfig(null);
const START = "2026-01-01";
const dateOfDay = (n) => addDaysISO(START, n - 1);

// 12 measures in three chunks of 4: c1 is Difficult (3), c5 and c9 Workable (1).
function basePiece(overrides) {
  return {
    totalMeasures: 12,
    measureDifficulty: [3, 3, 3, 3, 1, 1, 1, 1, 2, 2, 2, 2],
    chunkMode: "custom",
    customChunkSize: 4,
    recurringMode: "none",
    recurringMeasures: 0,
    recurringPairs: [],
    practiceDaysPerWeek: 7,
    minutesPerDay: 30,
    daysToLearn: 21,
    startDate: START,
    progress: {},
    ladderConfig: CFG,
    reviewModel: 2,
    ...overrides,
  };
}

const chunkOf = (piece, id) => generateAllChunks(piece).practiceChunks.find((c) => c.id === id);

function session({ day, date, outcome = "pass", cleanReps = 5, bpm = 80, extra = {} }) {
  return { day, loggedAt: Date.parse(`${date}T10:00:00`), loggedDate: date, cleanReps, bpm, outcome, durationSeconds: 0, ...extra };
}

// What App.jsx's handleLogSession does to a chunk's progress entry, with the real
// functions. `date` is the calendar date the practice happened on.
function logSession(piece, chunkId, date, { outcome = "pass", bpm = 80, targetBPM = 100, cleanReps = 5 } = {}) {
  const chunk = chunkOf(piece, chunkId);
  const prev = piece.progress[chunkId] || { doneDays: [] };
  const context = ladderContextFor(piece, chunk, prev, date);
  const advance = computeLadderAdvance(
    {
      stage: prev.stage,
      consecutivePasses: prev.consecutivePasses,
      consecutiveStabilizingFails: prev.consecutiveStabilizingFails,
      practiceBPM: prev.practiceBPM != null ? prev.practiceBPM : bpm,
      targetBPM,
      tier1Done: prev.tier1Done,
      needsRelearning: prev.needsRelearning,
      suggestedStartingBPM: null,
      stabilizingEntryBPM: prev.stabilizingEntryBPM,
      settlingEntryBPM: prev.settlingEntryBPM,
      holdingEntryBPM: prev.holdingEntryBPM,
      tempoRatchetK: prev.tempoRatchetK,
      holdingReviewCount: prev.holdingReviewCount,
    },
    { result: outcome, effectiveness: outcome === "pass" ? "high" : "good", asOfDate: date, cleanReps, bpm },
    piece.ladderConfig,
    context
  );
  const sessions = [...(prev.sessions || []), session({ day: (prev.sessions || []).length + 1, date, outcome, cleanReps, bpm })];
  const entry = {
    ...prev,
    doneDays: [...(prev.doneDays || []), sessions.length],
    sessions,
    stage: advance.stage,
    consecutivePasses: advance.consecutivePasses,
    consecutiveStabilizingFails: advance.consecutiveStabilizingFails,
    practiceBPM: advance.practiceBPM,
    nextDueDate: advance.nextDueDate,
    tier1Done: tier1DoneAfterSession(piece, prev, advance.tier1Done, date),
    needsRelearning: advance.needsRelearning,
    stabilizingEntryBPM: advance.stabilizingEntryBPM,
    settlingEntryBPM: advance.settlingEntryBPM,
    holdingEntryBPM: advance.holdingEntryBPM,
    tempoRatchetK: advance.tempoRatchetK,
    holdingReviewCount: advance.holdingReviewCount,
  };
  return { piece: { ...piece, progress: { ...piece.progress, [chunkId]: entry } }, advance, context, entry };
}

const state = (overrides = {}) => ({
  stage: "stabilizing",
  consecutivePasses: 0,
  consecutiveStabilizingFails: 0,
  practiceBPM: 80,
  targetBPM: 100,
  tier1Done: true,
  ...overrides,
});
const pass = (bpm, extra = {}) => ({ result: "pass", asOfDate: "2026-03-10", cleanReps: 5, bpm, ...extra });
const ctx = (passesNeeded, extra = {}) => ({ passesNeeded, canPromote: true, maxCredit: null, ...extra });

/* ------------------------------------------------------------------ */

describe("[Pass 139] rule 1: the pass table", () => {
  test("every cell of the table, for a plan length inside each row", () => {
    const expected = {
      15: { easy: 1, medium: 2, hard: 3 },
      45: { easy: 2, medium: 3, hard: 3 },
      75: { easy: 3, medium: 4, hard: 4 },
      120: { easy: 3, medium: 4, hard: 5 },
    };
    for (const [days, row] of Object.entries(expected)) {
      for (const difficulty of PASS_TABLE_DIFFICULTIES) {
        assert.equal(autoPassesNeeded(difficulty, Number(days), "days"), row[difficulty], `${days} days, ${difficulty}`);
      }
    }
  });

  test("the table has the four rows the owner gave, in order", () => {
    assert.deepEqual(
      PASS_TABLE_ROWS.map((r) => [r.upToDays, r.easy, r.medium, r.hard]),
      [
        [30, 1, 2, 3],
        [60, 2, 3, 3],
        [90, 3, 4, 4],
        [null, 3, 4, 5],
      ]
    );
  });

  test("boundaries are 30, 60 and 90 days with the upper bound included", () => {
    const idx = (d) => passTableRowIndex(d, "days");
    assert.deepEqual([1, 29, 30].map(idx), [0, 0, 0]);
    assert.deepEqual([30.5, 31, 60].map(idx), [1, 1, 1]);
    assert.deepEqual([61, 90].map(idx), [2, 2]);
    assert.deepEqual([91, 365].map(idx), [3, 3]);
    assert.equal(autoPassesNeeded("hard", 30, "days"), 3, "exactly 30 days reads the first row");
    assert.equal(autoPassesNeeded("easy", 30, "days"), 1);
    assert.equal(autoPassesNeeded("easy", 31, "days"), 2, "31 days reads the second row");
  });

  test("a plan set by minutes per day uses the last row whatever its day count", () => {
    for (const days of [10, 45, 80, 200]) {
      assert.equal(passTableRowIndex(days, "minutes"), 3);
      assert.equal(autoPassesNeeded("hard", days, "minutes"), 5);
      assert.equal(autoPassesNeeded("easy", days, "minutes"), 3);
    }
    assert.match(passTableRowLabelFor(20, "minutes"), /minutes per day/);
  });

  test("an unreadable plan length reads the last row, and an unknown difficulty the middle column", () => {
    for (const days of [undefined, null, 0, -4, NaN, "soon"]) assert.equal(passTableRowIndex(days, "days"), 3);
    assert.equal(autoPassesNeeded(undefined, 15, "days"), 2);
    assert.equal(autoPassesNeeded("extreme", 15, "days"), 2);
  });

  test("the labels name the row (shown in Settings)", () => {
    assert.deepEqual(PASS_TABLE_ROW_LABELS, ["up to 30 days", "over 30 up to 60 days", "over 60 up to 90 days", "over 90 days"]);
    assert.equal(passTableRowLabelFor(30, "days"), "up to 30 days");
    assert.equal(passTableRowLabelFor(31, "days"), "over 30 up to 60 days");
  });

  test("Holding has no count (nothing above it)", () => {
    assert.equal(resolvePassesNeeded({ stage: "holding", difficultyLabel: "hard", daysToLearn: 20, scheduleMode: "days" }, CFG), null);
    assert.equal(resolvePassesNeeded({ stage: undefined, difficultyLabel: "hard", daysToLearn: 20, scheduleMode: "days" }, CFG), null);
  });
});

describe("[Pass 139] the per-piece override", () => {
  const cell = { stage: "stabilizing", difficultyLabel: "hard", daysToLearn: 20, scheduleMode: "days" };

  test("an override beats the table, only for its own cell", () => {
    const cfg = withPassesOverride(CFG, "stabilizing", "hard", 6, 3);
    assert.equal(resolvePassesNeeded(cell, cfg), 6);
    assert.equal(resolvePassesNeeded({ ...cell, stage: "settling" }, cfg), 3, "the other stage still follows the plan");
    assert.equal(resolvePassesNeeded({ ...cell, difficultyLabel: "easy" }, cfg), 1, "the other difficulty still follows the plan");
    assert.equal(passesOverrideFor(cfg, "stabilizing", "hard"), 6);
    assert.equal(passesOverrideFor(cfg, "settling", "hard"), null);
  });

  test("typing the automatic number back in is not an override", () => {
    const set = withPassesOverride(CFG, "settling", "medium", 5, 2);
    const back = withPassesOverride(set, "settling", "medium", 2, 2);
    assert.deepEqual(back, CFG);
    assert.equal("overrides" in back, false, "nothing stored once nothing differs");
  });

  test("Reset to automatic restores the table, and leaves the config exactly as it was", () => {
    let cfg = withPassesOverride(CFG, "stabilizing", "hard", 6, 3);
    cfg = withPassesOverride(cfg, "settling", "easy", 2, 1);
    assert.equal(hasPassesOverride(cfg), true);
    const reset = withPassesOverridesCleared(cfg);
    assert.equal(hasPassesOverride(reset), false);
    assert.deepEqual(reset, CFG, "byte-for-byte the config she had, so the piece does not upload again");
    assert.equal("overrides" in reset, false);
    assert.equal(resolvePassesNeeded(cell, reset), 3);
  });

  test("Reset to automatic leaves the Holding maximum she set alone", () => {
    let cfg = withHoldingMaxOverride(withPassesOverride(CFG, "stabilizing", "hard", 6, 3), 20);
    cfg = withPassesOverridesCleared(cfg);
    assert.equal(cfg.overrides.holdingMaxDays, 20);
    assert.equal("passesNeeded" in cfg.overrides, false);
  });

  test("the helpers never change the config they were given", () => {
    const before = JSON.stringify(CFG);
    withPassesOverride(CFG, "stabilizing", "hard", 6, 3);
    withPassesOverridesCleared(CFG);
    withHoldingMaxOverride(CFG, 12);
    assert.equal(JSON.stringify(CFG), before);
  });

  test("a value that is not a whole number of at least 1 is ignored when read", () => {
    for (const bad of [0, -2, 2.5, "3", NaN, null]) {
      const cfg = { ...CFG, overrides: { passesNeeded: { stabilizing: { hard: bad } } } };
      assert.equal(resolvePassesNeeded(cell, cfg), 3, `override ${String(bad)}`);
    }
    // and set values are rounded to a whole number of at least 1
    assert.equal(passesOverrideFor(withPassesOverride(CFG, "stabilizing", "hard", 0, 3), "stabilizing", "hard"), 1);
    assert.equal(passesOverrideFor(withPassesOverride(CFG, "stabilizing", "hard", 4.4, 3), "stabilizing", "hard"), 4);
  });

  test("the Holding maximum: 30 days until the owner sets one, and Reset puts it back", () => {
    assert.equal(effectiveHoldingMaxDaysV2(CFG), HOLDING_MAX_DAYS_V2);
    assert.equal(HOLDING_MAX_DAYS_V2, 30);
    const cfg = withHoldingMaxOverride(CFG, 21);
    assert.equal(effectiveHoldingMaxDaysV2(cfg), 21);
    assert.equal(cfg.holding.maxIntervalDays, 70, "today's maximum is untouched");
    const reset = withHoldingMaxOverride(cfg, null);
    assert.deepEqual(reset, CFG);
    assert.equal(effectiveHoldingMaxDaysV2(undefined), 30);
  });

  test("a changed number carries to the next load: mergeLadderConfig keeps it, and adds nothing when there is none", () => {
    const cfg = withHoldingMaxOverride(withPassesOverride(CFG, "stabilizing", "hard", 6, 3), 21);
    assert.deepEqual(mergeLadderConfig(cfg).overrides, cfg.overrides);
    const plain = mergeLadderConfig({ stabilizing: { intervalDays: 4 } });
    assert.equal("overrides" in plain, false, "never materialized (it would change every piece's fingerprint)");
    assert.equal("overrides" in mergeLadderConfig(null), false);
    assert.equal("overrides" in mergeLadderConfig({ ...CFG, overrides: null }), false);
  });

  test("a whole piece keeps its override through load, and is not given one by loading", () => {
    const withOverride = basePiece({ id: "p1", name: "A", ladderConfig: withPassesOverride(CFG, "settling", "easy", 2, 1) });
    const loaded = validateAndMigratePiece(JSON.parse(JSON.stringify(withOverride)));
    assert.deepEqual(loaded.ladderConfig.overrides, { passesNeeded: { settling: { easy: 2 } } });
    const plain = validateAndMigratePiece(JSON.parse(JSON.stringify(basePiece({ id: "p1", name: "A" }))));
    assert.equal("overrides" in plain.ladderConfig, false);
    assert.equal("reviewModel" in plain, true);
  });

  test("a Settings save takes the owner's override from the draft", () => {
    const live = basePiece({ id: "p1", name: "A", progress: { c1: { doneDays: [1] } } });
    const draft = { ...live, ladderConfig: withPassesOverride(CFG, "stabilizing", "hard", 6, 3), progress: {} };
    const saved = mergeEditedPiece(live, draft);
    assert.equal(passesOverrideFor(saved.ladderConfig, "stabilizing", "hard"), 6);
    assert.deepEqual(saved.progress, live.progress, "practice is still the live piece's");
    assert.equal(saved.reviewModel, 2);
  });
});

describe("[Pass 139] rule 2: what counts as a pass", () => {
  test("a strong pass: exactly 85% of target counts as two, 84% as one", () => {
    assert.equal(STRONG_PASS_FRACTION, 0.85);
    const strong = computeLadderAdvance(state({ consecutivePasses: 1 }), pass(85), CFG, ctx(4));
    assert.equal(strong.consecutivePasses, 3);
    assert.equal(strong.strongPass, true);
    const close = computeLadderAdvance(state({ consecutivePasses: 1 }), pass(84), CFG, ctx(4));
    assert.equal(close.consecutivePasses, 2);
    assert.equal(close.strongPass, false);
  });

  test("a strong pass can finish a stage by itself: 1 earned + 2 = 3 of 3 promotes", () => {
    const r = computeLadderAdvance(state({ consecutivePasses: 1 }), pass(90), CFG, ctx(3));
    assert.equal(r.stage, "settling");
    assert.equal(r.graduated, true);
    assert.equal(r.consecutivePasses, 0, "no carry-over: the next stage starts at 0");
  });

  test("overshooting the count promotes and starts the next stage at 0", () => {
    const r = computeLadderAdvance(state({ consecutivePasses: 2 }), pass(95), CFG, ctx(3));
    assert.equal(r.stage, "settling");
    assert.equal(r.consecutivePasses, 0);
  });

  test("an 84% pass and a no-context 85% pass count one (today's plan is not changed)", () => {
    assert.equal(computeLadderAdvance(state({ consecutivePasses: 1 }), pass(85), CFG).consecutivePasses, 2);
    assert.equal(computeLadderAdvance(state({ consecutivePasses: 1 }), pass(85), CFG, null).consecutivePasses, 2);
  });

  test("a chunk with no target tempo never earns a strong pass", () => {
    const r = computeLadderAdvance(state({ targetBPM: null, consecutivePasses: 1 }), pass(200), CFG, ctx(4));
    assert.equal(r.consecutivePasses, 2);
    assert.equal(isStrongPass("pass", 90, null), false);
    assert.equal(isStrongPass("pass", null, 100), false);
    assert.equal(isStrongPass("soft-miss", 100, 100), false);
    assert.equal(isStrongPass("pass", 85, 100), true);
  });

  test("a strong pass counts double only in Stabilizing and Settling, never in Holding", () => {
    const holding = computeLadderAdvance(
      state({ stage: "holding", consecutivePasses: 2, practiceBPM: 90 }),
      pass(100, { effectiveness: "good" }),
      CFG,
      ctx(null)
    );
    assert.equal(holding.consecutivePasses, 3);
    const settling = computeLadderAdvance(state({ stage: "settling", practiceBPM: 90, consecutivePasses: 0 }), pass(100), CFG, ctx(4));
    assert.equal(settling.consecutivePasses, 2);
  });

  test("a pass below the stage's tempo floor still counts nothing, strong or not", () => {
    // Settling's floor is 70% of 100; the chunk's practice tempo is only 60.
    const r = computeLadderAdvance(state({ stage: "settling", practiceBPM: 60, consecutivePasses: 1 }), pass(95), CFG, ctx(2));
    assert.equal(r.consecutivePasses, 1);
    assert.equal(r.stage, "settling");
  });

  test("a Partial pass starts the count over, and Needs rework steps back one stage", () => {
    const partial = computeLadderAdvance(state({ consecutivePasses: 2.5 }), { result: "soft-miss", asOfDate: "2026-03-10", cleanReps: 2, bpm: 80 }, CFG, ctx(4));
    assert.equal(partial.consecutivePasses, 0);
    assert.equal(partial.stage, "stabilizing");
    const rework = computeLadderAdvance(
      state({ stage: "settling", consecutivePasses: 3, practiceBPM: 80 }),
      { result: "fail", asOfDate: "2026-03-10", cleanReps: 0, bpm: 80 },
      CFG,
      ctx(4)
    );
    assert.equal(rework.stage, "stabilizing");
    assert.equal(rework.consecutivePasses, 0);
    assert.equal(rework.demoted, true);
  });

  test("the first session never promotes, even where the table says 1; the count is kept for the next own turn", () => {
    const first = computeLadderAdvance(
      state({ stage: null, consecutivePasses: undefined, practiceBPM: 80, tier1Done: undefined }),
      pass(70),
      CFG,
      ctx(1, { canPromote: false })
    );
    assert.equal(first.stage, "stabilizing");
    assert.equal(first.graduated, false);
    assert.equal(first.promotionHeld, true);
    assert.equal(first.consecutivePasses, 1, "its learning session is its first pass");
    const next = computeLadderAdvance(state({ consecutivePasses: first.consecutivePasses, practiceBPM: first.practiceBPM }), pass(70), CFG, ctx(1));
    assert.equal(next.stage, "settling");
    assert.equal(next.graduated, true);
  });

  test("a touch counts one pass even when strong, and cannot promote", () => {
    const r = computeLadderAdvance(state({ consecutivePasses: 2 }), pass(100), CFG, ctx(3, { canPromote: false, maxCredit: 1 }));
    assert.equal(r.consecutivePasses, 3);
    assert.equal(r.stage, "stabilizing");
    assert.equal(r.promotionHeld, true);
    assert.equal(r.strongPass, true);
  });
});

describe("[Pass 139] half credit", () => {
  test("adds 0.5 to a Stabilizing or Settling chunk and never changes anything else", () => {
    for (const stage of ["stabilizing", "settling"]) {
      const before = state({ stage, consecutivePasses: 2, practiceBPM: 90 });
      const after = addHalfPass(before);
      assert.equal(after.consecutivePasses, 2.5);
      assert.equal(after.stage, stage);
      assert.deepEqual({ ...after, consecutivePasses: 2 }, before);
      assert.equal(before.consecutivePasses, 2, "the input is not changed");
    }
  });

  test("never promotes, even when the count reaches what is needed", () => {
    const after = addHalfPass(state({ consecutivePasses: 2.5 }));
    assert.equal(after.consecutivePasses, 3);
    assert.equal(after.stage, "stabilizing");
  });

  test("a chunk with no count yet starts at 0.5; Holding and a chunk not yet on the ladder are returned as they were", () => {
    assert.equal(addHalfPass(state({ consecutivePasses: undefined })).consecutivePasses, 0.5);
    const holding = state({ stage: "holding", consecutivePasses: 3 });
    assert.equal(addHalfPass(holding), holding);
    const notStarted = state({ stage: null });
    assert.equal(addHalfPass(notStarted), notStarted);
  });

  test("a fractional count carries through the next real pass (2.5 + 1)", () => {
    const r = computeLadderAdvance(state({ consecutivePasses: 2.5 }), pass(70), CFG, ctx(4));
    assert.equal(r.consecutivePasses, 3.5);
    assert.equal(r.stage, "stabilizing");
    const done = computeLadderAdvance(state({ consecutivePasses: 3.5 }), pass(70), CFG, ctx(4));
    assert.equal(done.stage, "settling", "4.5 of 4");
  });
});

describe("[Pass 139] the context a session is logged with (ladderContextFor)", () => {
  test("null for a piece on today's plan, for a transition or a combo, and for no chunk", () => {
    const m1 = basePiece({ reviewModel: null });
    assert.equal(ladderContextFor(m1, chunkOf(m1, "c1"), {}, dateOfDay(1)), null);
    const m2 = basePiece();
    const transition = generateAllChunks(m2).transitions[0];
    assert.ok(transition, "the fixture has a transition");
    assert.equal(ladderContextFor(m2, transition, {}, dateOfDay(1)), null);
    assert.equal(ladderContextFor(m2, undefined, {}, dateOfDay(1)), null);
    assert.equal(passesNeededForChunk(m1, chunkOf(m1, "c1"), {}), null);
    assert.equal(passesNeededByStageFor(m1, chunkOf(m1, "c1")), null);
  });

  test("passes needed come from the chunk's difficulty and the plan's length", () => {
    const piece = basePiece({ daysToLearn: 21 });
    assert.equal(chunkOf(piece, "c1").difficultyLabel, "hard");
    assert.equal(chunkOf(piece, "c5").difficultyLabel, "easy");
    assert.equal(ladderContextFor(piece, chunkOf(piece, "c1"), {}, dateOfDay(1)).passesNeeded, 3);
    assert.equal(ladderContextFor(piece, chunkOf(piece, "c5"), {}, dateOfDay(1)).passesNeeded, 1);
    const long = basePiece({ daysToLearn: 120 });
    assert.equal(ladderContextFor(long, chunkOf(long, "c1"), {}, dateOfDay(1)).passesNeeded, 5);
    const minutes = basePiece({ scheduleMode: "minutes", daysToLearn: 12 });
    assert.equal(ladderContextFor(minutes, chunkOf(minutes, "c1"), {}, dateOfDay(1)).passesNeeded, 5, "a minutes plan reads the longest row");
    assert.equal(ladderContextFor(minutes, chunkOf(minutes, "c5"), {}, dateOfDay(1)).passesNeeded, 3);
  });

  test("passes needed follow the chunk's current stage, and the owner's override", () => {
    const cfg = withPassesOverride(CFG, "settling", "hard", 5, 3);
    const piece = basePiece({ ladderConfig: cfg });
    const c1 = chunkOf(piece, "c1");
    assert.equal(ladderContextFor(piece, c1, { stage: "stabilizing" }, dateOfDay(3)).passesNeeded, 3);
    assert.equal(ladderContextFor(piece, c1, { stage: "settling" }, dateOfDay(3)).passesNeeded, 5);
    assert.equal(ladderContextFor(piece, c1, { stage: "holding" }, dateOfDay(3)).passesNeeded, null);
    assert.deepEqual(passesNeededByStageFor(piece, c1), { stabilizing: 3, settling: 5 });
  });

  test("a chunk's first session cannot promote (a skipped or provisional attempt is not a session)", () => {
    const piece = basePiece();
    const c5 = chunkOf(piece, "c5");
    assert.equal(ladderContextFor(piece, c5, undefined, dateOfDay(1)).canPromote, false);
    assert.equal(ladderContextFor(piece, c5, { doneDays: [] }, dateOfDay(1)).canPromote, false);
    const skipped = { sessions: [{ day: 1, loggedDate: dateOfDay(1), loggedAt: 1, skipped: true }] };
    assert.equal(ladderContextFor(piece, c5, skipped, dateOfDay(2)).canPromote, false, "a skip is not a logged session");
    const provisional = { sessions: [session({ day: 1, date: dateOfDay(1), extra: { provisional: true } })] };
    assert.equal(ladderContextFor(piece, c5, provisional, dateOfDay(1)).canPromote, false, "a provisional attempt being confirmed is still the first session");
  });

  test("a chunk moves up only on or after the day its next review is due (the owner's rule, 2026-11-17)", () => {
    const piece = basePiece();
    const c5 = chunkOf(piece, "c5");
    const learned = { stage: "stabilizing", consecutivePasses: 1, sessions: [session({ day: 1, date: dateOfDay(1) })], nextDueDate: dateOfDay(5) };
    assert.equal(ladderContextFor(piece, c5, learned, dateOfDay(1)).canPromote, false, "a repeat on the learning day");
    assert.equal(ladderContextFor(piece, c5, learned, dateOfDay(2)).canPromote, false, "an early look the next day, though a Workable chunk owes no touch");
    assert.equal(ladderContextFor(piece, c5, learned, dateOfDay(4)).canPromote, false, "the day before it is due");
    assert.equal(ladderContextFor(piece, c5, learned, dateOfDay(5)).canPromote, true, "on the day it is due");
    assert.equal(ladderContextFor(piece, c5, learned, dateOfDay(9)).canPromote, true, "late is slack, never a block");
    assert.equal(ladderContextFor(piece, c5, learned, dateOfDay(2)).maxCredit, null, "an early look still counts as a full pass");
  });

  test("a chunk with no due date (older data) is not held back by the due-day rule", () => {
    const piece = basePiece();
    const c5 = chunkOf(piece, "c5");
    const older = { stage: "stabilizing", consecutivePasses: 1, sessions: [session({ day: 1, date: dateOfDay(1) })] };
    assert.equal(ladderContextFor(piece, c5, older, dateOfDay(2)).canPromote, true);
  });

  test("the next-day touch of a Difficult chunk is one pass and cannot promote", () => {
    const piece = basePiece();
    const c1 = chunkOf(piece, "c1");
    const learned = { stage: "stabilizing", consecutivePasses: 1, sessions: [session({ day: 1, date: dateOfDay(1) })], nextDueDate: dateOfDay(5) };
    const touch = ladderContextFor(piece, c1, learned, dateOfDay(2));
    assert.equal(touch.canPromote, false);
    assert.equal(touch.maxCredit, 1);
    // the touch was logged on day 2, which set the next review four days on
    const touched = { ...learned, tier1Done: true, nextDueDate: dateOfDay(6), sessions: [...learned.sessions, session({ day: 2, date: dateOfDay(2) })] };
    const repeat = ladderContextFor(piece, c1, touched, dateOfDay(2));
    assert.equal(repeat.canPromote, false, "a second attempt on the touch's own day cannot promote either");
    assert.equal(repeat.maxCredit, null, "but it counts as a full pass");
    const ret = ladderContextFor(piece, c1, touched, dateOfDay(6));
    assert.equal(ret.canPromote, true, "once touched, the return is the chunk's own turn");
    assert.equal(ret.maxCredit, null);
  });

  test("a skipped touch is dropped: a session on its return date is its own turn", () => {
    const piece = basePiece();
    const c1 = chunkOf(piece, "c1");
    const learned = { stage: "stabilizing", consecutivePasses: 1, sessions: [session({ day: 1, date: dateOfDay(1) })], nextDueDate: dateOfDay(5) };
    assert.equal(ladderContextFor(piece, c1, learned, dateOfDay(4)).canPromote, false, "an early look before the return is still the touch");
    const onReturn = ladderContextFor(piece, c1, learned, dateOfDay(5));
    assert.equal(onReturn.canPromote, true);
    assert.equal(onReturn.maxCredit, null);
    assert.equal(ladderContextFor(piece, c1, learned, dateOfDay(9)).canPromote, true, "late is slack");
  });

  test("a Workable chunk whose learning session was a Partial pass owes a touch too", () => {
    const piece = basePiece();
    const c5 = chunkOf(piece, "c5");
    const learned = { stage: "stabilizing", consecutivePasses: 0, sessions: [session({ day: 1, date: dateOfDay(1), outcome: "soft-miss" })], nextDueDate: dateOfDay(5) };
    const touch = ladderContextFor(piece, c5, learned, dateOfDay(2));
    assert.equal(touch.canPromote, false);
    assert.equal(touch.maxCredit, 1);
  });

  test("a chunk flagged for re-learning owes no touch, so a later day is its own turn", () => {
    const piece = basePiece();
    const c1 = chunkOf(piece, "c1");
    const learned = { stage: "stabilizing", needsRelearning: true, sessions: [session({ day: 1, date: dateOfDay(1) })], nextDueDate: dateOfDay(1) };
    assert.equal(ladderContextFor(piece, c1, learned, dateOfDay(2)).canPromote, true);
  });
});

describe("[Pass 139] a section run-through is not a pass for anything", () => {
  // Every chunk logged once, so the section's run-through is due (lib/chunking.js's gate).
  function pieceWithDueRunThrough() {
    let piece = basePiece({ sections: [{ id: "s1", name: "", start: 1, end: 12 }] });
    for (const id of ["c1", "c5", "c9"]) piece = logSession(piece, id, dateOfDay(1), { bpm: 80 }).piece;
    return piece;
  }

  test("it gets no table, no strong pass and no own-turn rule: it keeps the earlier ladder", () => {
    const piece = pieceWithDueRunThrough();
    const item = computeSectionRunThroughs(piece, generateAllChunks(piece).practiceChunks).find((i) => i.id === "sr_s1");
    assert.ok(item && !item.locked, "the run-through is due and loggable");
    assert.equal(item.kind, "section-runthrough");
    assert.equal(ladderContextFor(piece, item, {}, dateOfDay(2)), null);
    assert.equal(passesNeededForChunk(piece, item, {}), null);
    assert.equal(passesNeededByStageFor(piece, item), null);
  });

  test("logging one changes no practice chunk's count, stage or sessions", () => {
    const piece = pieceWithDueRunThrough();
    const before = JSON.stringify({ c1: piece.progress.c1, c5: piece.progress.c5, c9: piece.progress.c9 });
    // 95 BPM against a 100 target would be a strong pass for a chunk; for the run-through it is one ordinary pass.
    const r = logSession(piece, "sr_s1", dateOfDay(2), { bpm: 95 });
    assert.equal(r.context, null, "the handler finds no practice chunk with that id, so there is no context");
    assert.equal(r.entry.consecutivePasses, 1, "a strong tempo does not count double for it");
    assert.equal(r.advance.strongPass, undefined);
    assert.equal(JSON.stringify({ c1: r.piece.progress.c1, c5: r.piece.progress.c5, c9: r.piece.progress.c9 }), before);
  });
});

describe("[Pass 139] whole sequences, logged the way the app logs them", () => {
  test("a Workable chunk on a 21-day plan (1 pass): learned, then its first return moves it up", () => {
    let piece = basePiece({ daysToLearn: 21 });
    let r = logSession(piece, "c5", dateOfDay(1));
    assert.equal(r.entry.stage, "stabilizing", "its first session never promotes");
    assert.equal(r.entry.consecutivePasses, 1);
    assert.equal(r.advance.promotionHeld, true);
    piece = r.piece;
    r = logSession(piece, "c5", dateOfDay(5));
    assert.equal(r.entry.stage, "settling", "its own turn, 1 of 1");
    piece = r.piece;
    r = logSession(piece, "c5", dateOfDay(12));
    assert.equal(r.entry.stage, "holding", "Settling also needs 1");
  });

  test("a Difficult chunk on a 21-day plan (3 passes): learning, touch, then its return", () => {
    let piece = basePiece({ daysToLearn: 21 });
    let r = logSession(piece, "c1", dateOfDay(1));
    assert.deepEqual([r.entry.stage, r.entry.consecutivePasses], ["stabilizing", 1]);
    piece = r.piece;
    r = logSession(piece, "c1", dateOfDay(2));
    assert.deepEqual([r.entry.stage, r.entry.consecutivePasses], ["stabilizing", 2], "the touch is one pass");
    assert.equal(r.entry.tier1Done, true);
    piece = r.piece;
    r = logSession(piece, "c1", dateOfDay(6));
    assert.equal(r.entry.stage, "settling", "3 of 3 on its own turn");
    assert.equal(r.entry.consecutivePasses, 0);
  });

  test("the same Difficult chunk with the touch skipped needs one more visit", () => {
    let piece = basePiece({ daysToLearn: 21 });
    let r = logSession(piece, "c1", dateOfDay(1));
    piece = r.piece;
    r = logSession(piece, "c1", dateOfDay(5));
    assert.deepEqual([r.entry.stage, r.entry.consecutivePasses], ["stabilizing", 2], "the return counts as a pass");
    piece = r.piece;
    r = logSession(piece, "c1", dateOfDay(9));
    assert.equal(r.entry.stage, "settling");
  });

  test("a strong learning session counts two but still cannot promote a Workable chunk", () => {
    const piece = basePiece({ daysToLearn: 21 });
    const r = logSession(piece, "c5", dateOfDay(1), { bpm: 90 });
    assert.equal(r.advance.strongPass, true);
    assert.equal(r.entry.consecutivePasses, 2);
    assert.equal(r.entry.stage, "stabilizing");
  });

  test("two sessions the same day do not move a chunk up; its first session on its due day does", () => {
    let piece = basePiece({ daysToLearn: 21 });
    piece = logSession(piece, "c5", dateOfDay(1)).piece;
    const again = logSession(piece, "c5", dateOfDay(1));
    assert.equal(again.entry.stage, "stabilizing");
    assert.equal(again.entry.consecutivePasses, 2, "the repeat still counts");
    const early = logSession(again.piece, "c5", dateOfDay(2));
    assert.equal(early.entry.stage, "stabilizing", "an early look the next day is not its turn either");
    assert.equal(early.entry.consecutivePasses, 3);
    const due = logSession(early.piece, "c5", early.entry.nextDueDate);
    assert.equal(due.entry.stage, "settling", "on the day its next review is due");
  });

  test("a second attempt on the touch's day counts but does not move a Difficult chunk up (3 passes needed)", () => {
    let piece = basePiece({ daysToLearn: 21 });
    piece = logSession(piece, "c1", dateOfDay(1)).piece;
    const touch = logSession(piece, "c1", dateOfDay(2));
    assert.deepEqual([touch.entry.stage, touch.entry.consecutivePasses], ["stabilizing", 2]);
    const repeat = logSession(touch.piece, "c1", dateOfDay(2));
    assert.deepEqual([repeat.entry.stage, repeat.entry.consecutivePasses], ["stabilizing", 3], "3 of 3, held back");
    assert.equal(repeat.advance.promotionHeld, true);
    const ret = logSession(repeat.piece, "c1", repeat.entry.nextDueDate);
    assert.equal(ret.entry.stage, "settling", "moves up on its first session on the due day");
  });

  test("a Partial pass then a Full pass the same day: the Full pass counts but waits for the due day", () => {
    let piece = basePiece({ daysToLearn: 21 });
    piece = logSession(piece, "c5", dateOfDay(1)).piece;
    piece = logSession(piece, "c5", dateOfDay(5), { outcome: "soft-miss", cleanReps: 2 }).piece;
    assert.equal(piece.progress.c5.consecutivePasses, 0);
    const retry = logSession(piece, "c5", dateOfDay(5));
    assert.deepEqual([retry.entry.stage, retry.entry.consecutivePasses], ["stabilizing", 1], "1 of 1, held back until the review that follows the Partial pass");
    const next = logSession(retry.piece, "c5", retry.entry.nextDueDate);
    assert.equal(next.entry.stage, "settling");
  });

  test("a reschedule that changes the plan's length keeps earned passes and reads the new row at the next pass", () => {
    // 120 days: a Workable chunk needs 3. It has earned 2 by day 2.
    let piece = basePiece({ daysToLearn: 120 });
    let r = logSession(piece, "c5", dateOfDay(1));
    r = logSession(r.piece, "c5", dateOfDay(2));
    assert.deepEqual([r.entry.stage, r.entry.consecutivePasses], ["stabilizing", 2]);
    // the plan is shortened to 21 days: the table now says 1 and the chunk keeps its 2
    piece = { ...r.piece, daysToLearn: 21 };
    assert.equal(piece.progress.c5.consecutivePasses, 2, "nothing was rewritten");
    assert.equal(ladderContextFor(piece, chunkOf(piece, "c5"), piece.progress.c5, dateOfDay(6)).passesNeeded, 1);
    r = logSession(piece, "c5", dateOfDay(6));
    assert.equal(r.entry.stage, "settling", "its next pass reads the new row");
    // and the other way: lengthening asks for more, from its next pass
    const longer = { ...r.piece, daysToLearn: 120 };
    assert.equal(ladderContextFor(longer, chunkOf(longer, "c5"), longer.progress.c5, dateOfDay(20)).passesNeeded, 3);
  });

  test("the owner's override changes how many passes a chunk needs", () => {
    // A Workable chunk on a 21-day plan needs 1; she asks for 3.
    const piece = basePiece({ daysToLearn: 21, ladderConfig: withPassesOverride(CFG, "stabilizing", "easy", 3, 1) });
    let r = logSession(piece, "c5", dateOfDay(1));
    r = logSession(r.piece, "c5", dateOfDay(5));
    assert.deepEqual([r.entry.stage, r.entry.consecutivePasses], ["stabilizing", 2], "2 of 3 is not enough");
    r = logSession(r.piece, "c5", dateOfDay(9));
    assert.equal(r.entry.stage, "settling", "3 of 3 on its own turn");
    // and without the override the same chunk is up on its first return
    const plain = logSession(logSession(basePiece({ daysToLearn: 21 }), "c5", dateOfDay(1)).piece, "c5", dateOfDay(5));
    assert.equal(plain.entry.stage, "settling");
  });
});

describe("[Pass 139] how a count reads on screen", () => {
  const entry = (extra) => ({ stage: "stabilizing", sessions: [session({ day: 1, date: dateOfDay(1) })], nextDueDate: dateOfDay(5), ...extra });

  test("a whole count and a half count", () => {
    assert.equal(formatPassCount(2), "2");
    assert.equal(formatPassCount(2.5), "2.5");
    assert.equal(formatPassCount(0), "0");
    assert.equal(formatLadderStatus(entry({ consecutivePasses: 2.5 }), CFG, dateOfDay(3), 4).progressLabel, "2.5/4 to Building");
    assert.equal(formatLadderStatus(entry({ consecutivePasses: 2 }), CFG, dateOfDay(3), 4).progressLabel, "2/4 to Building");
  });

  test("a count above what is needed reads as full, for a chunk held back from moving up", () => {
    assert.equal(formatLadderStatus(entry({ consecutivePasses: 4 }), CFG, dateOfDay(3), 3).progressLabel, "3/3 to Building");
  });

  test("without a table number it reads the piece's graduationPasses as before", () => {
    assert.equal(formatLadderStatus(entry({ consecutivePasses: 2 }), CFG, dateOfDay(3)).progressLabel, "2/4 to Building");
    assert.equal(formatLadderStatus(entry({ consecutivePasses: 2 }), CFG, dateOfDay(3), null).progressLabel, "2/4 to Building");
    assert.equal(formatLadderStatus(entry({ stage: "holding", consecutivePasses: 3 }), CFG, dateOfDay(3), null).progressLabel, "3 consecutive passes");
  });

  test("passesNeededForChunk gives the number the card shows, per stage", () => {
    const piece = basePiece({ daysToLearn: 70 });
    const c1 = chunkOf(piece, "c1");
    assert.equal(passesNeededForChunk(piece, c1, { stage: "stabilizing" }), 4);
    assert.equal(passesNeededForChunk(piece, c1, {}), 4, "a chunk with no stage yet reads Stabilizing's");
    assert.equal(passesNeededForChunk(piece, c1, { stage: "holding" }), null);
  });
});

describe("[Pass 139] the tempo projection on the new plan", () => {
  test("with the table's numbers the chunk moves up after them, not after the old 4", () => {
    const start = state({ stage: "stabilizing", consecutivePasses: 0, practiceBPM: 40, targetBPM: 100 });
    const old = simulateTempoConvergence(start, CFG, "2026-03-01");
    const same = simulateTempoConvergence(start, CFG, "2026-03-01", null);
    assert.deepEqual(same, old, "no table numbers: exactly as before");
    const quick = simulateTempoConvergence(start, CFG, "2026-03-01", { stabilizing: 1, settling: 1 });
    assert.equal(quick.applicable, true);
    assert.notEqual(quick.days, old.days, "moving up sooner changes the projected gaps");
  });
});

describe("[Pass 139] a piece on today's plan is exactly as it was", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/ladder-before-pass-139.json", import.meta.url), "utf8"));
  const configs = {
    default: CFG,
    "custom-graduation": { ...CFG, stabilizing: { ...CFG.stabilizing, graduationPasses: 2 }, settling: { ...CFG.settling, graduationPasses: 6 } },
    "no-floor": { ...CFG, settling: { ...CFG.settling, tempoFloorFraction: null } },
  };

  test(`${fixture.cases.length} recorded cases from the code before this pass return the same object, with no context`, () => {
    assert.ok(fixture.cases.length >= 30);
    let graduated = 0;
    let demoted = 0;
    for (const [i, c] of fixture.cases.entries()) {
      const actual = JSON.parse(JSON.stringify(computeLadderAdvance(c.state, c.outcome, configs[c.config])));
      assert.deepEqual(actual, c.expected, `case ${i} (${c.config})`);
      const viaNull = JSON.parse(JSON.stringify(computeLadderAdvance(c.state, c.outcome, configs[c.config], null)));
      assert.deepEqual(viaNull, c.expected, `case ${i} with a null context`);
      assert.equal("strongPass" in viaNull, false, "no new keys for a piece on today's plan");
      if (c.expected.graduated) graduated++;
      if (c.expected.demoted) demoted++;
    }
    assert.ok(graduated > 5 && demoted > 5, "the recorded cases include both promotions and demotions");
  });

  test("every stage and outcome appears in the recorded cases", () => {
    const stages = new Set(fixture.cases.map((c) => c.state.stage ?? "none"));
    for (const s of ["none", "stabilizing", "settling", "holding"]) assert.ok(stages.has(s), s);
    const results = new Set(fixture.cases.map((c) => c.outcome.result));
    for (const r of ["pass", "soft-miss", "fail"]) assert.ok(results.has(r), r);
  });

  test("a piece on today's plan logs a whole sequence with the old four passes", () => {
    let piece = basePiece({ reviewModel: null, daysToLearn: 21 });
    const days = [1, 2, 3, 4];
    let stage;
    for (const d of days) {
      const r = logSession(piece, "c5", dateOfDay(d));
      piece = r.piece;
      stage = r.entry.stage;
      assert.equal(r.context, null);
    }
    assert.equal(stage, "settling", "the fourth full pass in a row, the first session included, exactly as today");
  });

  test("the pass table and the strong-pass constants are the owner's, in the same place Research.md names", () => {
    assert.deepEqual(PASS_TABLE_STAGES, ["stabilizing", "settling"]);
    assert.deepEqual(PASS_TABLE_DIFFICULTIES, ["easy", "medium", "hard"]);
  });
});
