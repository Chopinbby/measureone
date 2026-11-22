// Tests for Pass 140: review windows, placement, worst first, the protected third
// and the slip, for a piece on the new review plan (reviewModel 2). The rules are
// in docs/Algorithms.md#review-model-v2-planned (rules 6 to 8).
//
// Nothing in components/ can be tested here (no render harness), so everything
// that decides something lives in src/lib/ and is tested directly. App.jsx's
// session handlers are closures, so test/review-sim-helper.mjs mirrors the one
// that matters (handleLogSession) with the REAL functions, and runs whole plans
// through the real timeline.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateAllChunks } from "../src/lib/chunking.js";
import {
  computeTimeline,
  getEffectiveTimeline,
  withLiveReviewStatus,
  placeWindowedReviews,
  reviewPriorityParts,
  compareReviewPriority,
  reviewWindowStatus,
  reviewWindowContextFor,
  ladderStatusFor,
  ladderContextFor,
  ESTABLISHED_AFTER_SESSIONS,
  PLACEMENT_NEAR_TIE_SHARE,
} from "../src/lib/scheduling.js";
import {
  computeLadderAdvance,
  simulateTempoConvergence,
  reviewWindowDays,
  reviewPlanDays,
  effectiveDueByDate,
  withDueByDate,
  dueBySnapshot,
  restoreDueByFromSnapshot,
  HOLDING_MAX_DAYS_V2,
  REVIEW_SLIP_INTERVALS,
  withHoldingMaxOverride,
} from "../src/lib/ladder.js";
import { computeDueReviews, computeDueOnDate, mergeLiveDueReviews } from "../src/lib/maintenance.js";
import { validateAndMigratePiece, mergeLadderConfig, mergeImportedPiece } from "../src/lib/storage.js";
import { canonicalPiece, planPieceMerge, piecePartFingerprints, unionProgressEntries } from "../src/lib/pieceMerge.js";
import { addDaysISO } from "../src/lib/utils.js";
import { EFFORT_TO_MIN } from "../src/lib/constants.js";
import { START, dateOfDay, makePiece, logSession, runPlan, measureRun, MIXES } from "./review-sim-helper.mjs";

const CFG = mergeLadderConfig(null);
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ */
/*  A piece on today's plan is unchanged                                */
/* ------------------------------------------------------------------ */

describe("[Pass 140, regression] a piece on today's plan is byte-for-byte what it was", () => {
  // Recorded from the code BEFORE this pass (commit 4082e91) on 14 seeded pieces
  // (days and minutes plans, 4 to 7 practice days a week, several difficulty mixes),
  // each played forward with a mix of passes, soft misses, fails and missed days.
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/timeline-before-pass-140.json", import.meta.url), "utf8"));

  test("the fixture really holds varied pieces with reviews placed and reviews due", () => {
    assert.equal(fixture.length, 14);
    assert.ok(fixture.some((f) => f.piece.scheduleMode === "minutes"));
    assert.ok(fixture.every((f) => f.timeline.days.some((d) => d.reviewChunkIds.length)));
    assert.ok(fixture.every((f) => f.due.some((x) => x.items.length)));
    assert.ok(fixture.every((f) => !f.piece.reviewModel));
  });

  for (const f of fixture) {
    test(`seed ${f.seed}: the timeline is identical, with or without a day given`, () => {
      const chunkSet = generateAllChunks(f.piece);
      assert.deepEqual(clone(computeTimeline(f.piece, chunkSet)), f.timeline);
      assert.deepEqual(clone(computeTimeline(f.piece, chunkSet, { asOfDay: 9 })), f.timeline, "a day given changes nothing for today's plan");
      assert.deepEqual(clone(getEffectiveTimeline(f.piece, chunkSet)), f.timeline);
    });
    test(`seed ${f.seed}: the due list is identical (no new keys on any item)`, () => {
      const chunkSet = generateAllChunks(f.piece);
      for (const { asOf, items } of f.due) {
        const got = computeDueReviews(f.piece, chunkSet, asOf);
        assert.deepEqual(got.map((i) => ({ chunkId: i.chunkId, dueDate: i.dueDate, stage: i.stage, daysOverdue: i.daysOverdue, minutes: i.minutes })), items);
        assert.ok(got.every((i) => !("status" in i) && !("latestDate" in i)));
      }
    });
  }

  test("a load and a save adds no dueByDate to a piece on today's plan, and the fingerprint does not move", () => {
    for (const f of fixture) {
      const loaded = validateAndMigratePiece({ id: "fx", name: "fx", ...clone(f.piece) });
      assert.ok(Object.values(loaded.progress).every((e) => !("dueByDate" in e)));
      assert.deepEqual(canonicalPiece(loaded), canonicalPiece(validateAndMigratePiece(clone(loaded))));
    }
  });

  test("a session logged on today's plan writes no dueByDate and no snapshot key for it", () => {
    let p = makePiece({ N: 24, mix: "balanced (50/25/25)", D: 30 });
    const cs = generateAllChunks(p);
    p = logSession(p, cs, "c1", 1, dateOfDay(1));
    p = logSession(p, generateAllChunks(p), "c1", 5, dateOfDay(5));
    assert.ok(!("dueByDate" in p.progress.c1));
    assert.ok(p.progress.c1.sessions.every((s) => !("dueByDate" in s.ladderSnapshot)));
  });
});

/* ------------------------------------------------------------------ */
/*  Rule 6: the window                                                  */
/* ------------------------------------------------------------------ */

describe("[Pass 140] reviewWindowDays: every window for plans of 30, 45, 60, 75, 90 and 120 days", () => {
  const w = (stage, planDays, extra = {}) => reviewWindowDays({ stage, planDays, ...extra });
  // [plan days, Stabilizing, Settling, Holding first window]. Holding's first gap is 7 (30 and 45 days)
  // or 10 (longer plans), and its window is that gap less and plus 40%.
  const expected = [
    [30, [2, 5], [3, 8], [4, 10]],
    [45, [2, 7], [4, 12], [4, 10]],
    [60, [3, 7], [4, 12], [6, 14]],
    [75, [3, 7], [4, 12], [6, 14]],
    [90, [3, 7], [4, 12], [6, 14]],
    [120, [3, 7], [4, 12], [6, 14]],
  ];
  for (const [days, stab, sett, hold] of expected) {
    test(`${days}-day plan`, () => {
      assert.deepEqual(Object.values(w("stabilizing", days)), stab);
      assert.deepEqual(Object.values(w("settling", days)), sett);
      assert.deepEqual(Object.values(w("holding", days)), hold);
    });
  }

  test("the shares are held between their day limits (a very short and a very long plan)", () => {
    assert.deepEqual(w("stabilizing", 5), { earliest: 2, latest: 3 });
    assert.deepEqual(w("settling", 5), { earliest: 3, latest: 6 });
    assert.deepEqual(w("stabilizing", 400), { earliest: 3, latest: 7 });
    assert.deepEqual(w("settling", 400), { earliest: 4, latest: 12 });
  });

  test("Holding: the gap grows 30% a visit from its first gap and never goes past 30 days", () => {
    const gaps = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => w("holding", 90, { holdingVisits: k }).latest);
    // First gap 10; window latest is the gap plus 40%, capped at 30.
    assert.deepEqual(gaps, [14, 18, 24, 30, 30, 30, 30, 30, 30]);
    const lows = [0, 1, 2, 3, 4, 5].map((k) => w("holding", 90, { holdingVisits: k }).earliest);
    assert.deepEqual(lows, [6, 8, 10, 13, 17, 18], "the lower end follows the gap (10 x 1.3^k), itself capped at 30 (18 = 60% of 30)");
  });

  test("Holding's maximum is 30 for every plan length, and the window never extends past it", () => {
    for (const days of [14, 30, 60, 90, 120, 365]) {
      for (let k = 0; k < 12; k++) {
        const win = w("holding", days, { holdingVisits: k });
        assert.ok(win.latest <= HOLDING_MAX_DAYS_V2, `${days} days, visit ${k}`);
        assert.ok(win.earliest >= 1 && win.earliest <= win.latest);
      }
    }
  });

  test("the owner's Holding maximum is respected (a window never reaches past it)", () => {
    for (let k = 0; k < 8; k++) {
      const win = w("holding", 90, { holdingVisits: k, holdingMaxDays: 14 });
      assert.ok(win.latest <= 14);
    }
    assert.deepEqual(w("holding", 90, { holdingVisits: 5, holdingMaxDays: 14 }), { earliest: 8, latest: 14 });
  });

  test("a plan set by minutes per day, or one that cannot be read, uses the 90-day figures", () => {
    assert.equal(reviewPlanDays(33, "minutes"), 90);
    assert.equal(reviewPlanDays(undefined, "days"), 90);
    assert.equal(reviewPlanDays(0, "days"), 90);
    assert.equal(reviewPlanDays(45, "days"), 45);
    assert.deepEqual(w("stabilizing", reviewPlanDays(20, "minutes")), w("stabilizing", 90));
  });

  test("an unknown stage reads Stabilizing and a window is never empty", () => {
    assert.deepEqual(w(undefined, 60), w("stabilizing", 60));
    for (const stage of ["stabilizing", "settling", "holding"]) for (let d = 1; d < 400; d += 7) {
      const win = w(stage, d);
      assert.ok(win.earliest >= 1 && win.earliest <= win.latest);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  The ladder writes the window                                        */
/* ------------------------------------------------------------------ */

describe("[Pass 140] computeLadderAdvance writes the window for a base chunk on the new plan", () => {
  const ctx = (extra = {}) => ({ passesNeeded: 1, canPromote: true, maxCredit: null, reviewWindow: { planDays: 60, holdingMaxDays: 30 }, ...extra });
  const state = (extra = {}) => ({ stage: "stabilizing", consecutivePasses: 0, consecutiveStabilizingFails: 0, practiceBPM: 60, targetBPM: null, tier1Done: false, ...extra });
  const pass = (asOfDate = "2026-03-01") => ({ result: "pass", effectiveness: "high", asOfDate, cleanReps: 5, bpm: 60 });

  test("a Full pass that stays in Stabilizing: earliest and latest of the Stabilizing window (60 days: 3 and 7)", () => {
    const r = computeLadderAdvance(state(), pass(), CFG, ctx({ passesNeeded: 4 }));
    assert.equal(r.stage, "stabilizing");
    assert.equal(r.nextDueDate, "2026-03-04");
    assert.equal(r.dueByDate, "2026-03-08");
  });

  test("a chunk that moves up gets the NEW stage's window from the day of the session", () => {
    const r = computeLadderAdvance(state({ consecutivePasses: 1 }), pass(), CFG, ctx({ passesNeeded: 2 }));
    assert.equal(r.stage, "settling");
    assert.equal(r.nextDueDate, "2026-03-05", "Settling 60 days: earliest 4");
    assert.equal(r.dueByDate, "2026-03-13", "Settling latest 12");
  });

  test("promotion into Holding: the first Holding gap (60 days: 10, so the window is 6 to 14)", () => {
    const r = computeLadderAdvance(state({ stage: "settling", consecutivePasses: 1 }), pass(), CFG, ctx({ passesNeeded: 2 }));
    assert.equal(r.stage, "holding");
    assert.equal(r.nextDueDate, "2026-03-07");
    assert.equal(r.dueByDate, "2026-03-15");
  });

  test("Holding passes in a row lengthen the gap by 30% each visit, up to the maximum", () => {
    let s = state({ stage: "holding", consecutivePasses: 0, holdingReviewCount: 0 });
    const lasts = [];
    for (let i = 0; i < 6; i++) {
      const r = computeLadderAdvance(s, pass("2026-03-01"), CFG, ctx({ passesNeeded: null }));
      lasts.push(Math.round((new Date(`${r.dueByDate}T00:00:00`) - new Date("2026-03-01T00:00:00")) / 86400000));
      s = { ...s, ...r };
    }
    assert.deepEqual(lasts, [18, 24, 30, 30, 30, 30], "a pass in Holding that follows k passes: gap 10 x 1.3^(k+1), window latest = gap plus 40%, cap 30");
  });

  test("a Partial pass starts the count over: Holding returns to its first window", () => {
    const grown = state({ stage: "holding", consecutivePasses: 3 });
    const r = computeLadderAdvance(grown, { ...pass(), result: "soft-miss", effectiveness: "good" }, CFG, ctx({ passesNeeded: null }));
    assert.equal(r.stage, "holding");
    assert.equal(r.consecutivePasses, 0);
    assert.equal(r.nextDueDate, "2026-03-07");
    assert.equal(r.dueByDate, "2026-03-15");
  });

  test("Needs rework steps back one stage and uses that stage's window", () => {
    const r = computeLadderAdvance(state({ stage: "settling", consecutivePasses: 2 }), { ...pass(), result: "fail", effectiveness: "low" }, CFG, ctx());
    assert.equal(r.stage, "stabilizing");
    assert.equal(r.nextDueDate, "2026-03-04");
    assert.equal(r.dueByDate, "2026-03-08");
  });

  test("the fail that flags a chunk for re-learning has no window: due the same day, dueByDate null", () => {
    const r = computeLadderAdvance(state({ consecutiveStabilizingFails: 1 }), { ...pass(), result: "fail", effectiveness: "low" }, CFG, ctx());
    assert.equal(r.needsRelearning, true);
    assert.equal(r.nextDueDate, "2026-03-01");
    assert.equal(r.dueByDate, null);
  });

  test("a window of one day carries dueByDate null (never the same date twice)", () => {
    const cfg = withHoldingMaxOverride(CFG, 1);
    const r = computeLadderAdvance(state({ stage: "holding" }), pass(), cfg, ctx({ passesNeeded: null, reviewWindow: { planDays: 60, holdingMaxDays: 1 } }));
    assert.equal(r.nextDueDate, "2026-03-02");
    assert.equal(r.dueByDate, null);
  });

  test("effectiveness no longer stretches or shrinks a window on the new plan (today's plan still reads it)", () => {
    const low = computeLadderAdvance(state({ stage: "holding", consecutivePasses: 2 }), { ...pass(), effectiveness: "low" }, CFG, ctx({ passesNeeded: null }));
    const high = computeLadderAdvance(state({ stage: "holding", consecutivePasses: 2 }), { ...pass(), effectiveness: "high" }, CFG, ctx({ passesNeeded: null }));
    assert.equal(low.nextDueDate, high.nextDueDate);
    assert.equal(low.dueByDate, high.dueByDate);
  });

  test("a context WITHOUT a window (Pass 139's, a transition, a combo) keeps the old single date and no dueByDate key", () => {
    const old = computeLadderAdvance(state(), pass(), CFG, { passesNeeded: 4, canPromote: true, maxCredit: null });
    assert.equal(old.nextDueDate, "2026-03-05", "Stabilizing's 4-day interval");
    assert.ok(!("dueByDate" in old));
    const none = computeLadderAdvance(state(), pass(), CFG, null);
    assert.ok(!("dueByDate" in none));
  });

  test("ladderContextFor gives a window only to a base chunk of a piece on the new plan", () => {
    const piece = makePiece({ N: 24, mix: "balanced (50/25/25)", D: 60, reviewModel: 2 });
    const cs = generateAllChunks(piece);
    const base = cs.practiceChunks[0];
    assert.deepEqual(ladderContextFor(piece, base, null, "2026-01-01").reviewWindow, { planDays: 60, holdingMaxDays: 30 });
    assert.equal(ladderContextFor({ ...piece, reviewModel: null }, base, null, "2026-01-01"), null);
    assert.equal(ladderContextFor(piece, cs.transitions[0], null, "2026-01-01"), null);
    assert.deepEqual(ladderContextFor({ ...piece, scheduleMode: "minutes", daysToLearn: 20 }, base, null, "2026-01-01").reviewWindow, { planDays: 90, holdingMaxDays: 30 });
    const own = { ...piece, ladderConfig: withHoldingMaxOverride(piece.ladderConfig, 14) };
    assert.equal(reviewWindowContextFor(own, base).holdingMaxDays, 14);
    assert.equal(reviewWindowContextFor(piece, cs.combos[0]), null);
  });
});

describe("[Pass 140] dueByDate is stored only when there is a window, and read defensively", () => {
  test("withDueByDate sets the key, or removes it, never stores null", () => {
    assert.deepEqual(withDueByDate({ a: 1 }, "2026-03-08"), { a: 1, dueByDate: "2026-03-08" });
    assert.deepEqual(withDueByDate({ a: 1, dueByDate: "2026-03-08" }, null), { a: 1 });
    const same = { a: 1 };
    assert.equal(withDueByDate(same, null), same, "an entry that never had one is returned as it is");
    assert.ok(!("dueByDate" in withDueByDate({ a: 1, dueByDate: "x" }, undefined)));
  });

  test("effectiveDueByDate: absent, equal or earlier than nextDueDate all mean the same day", () => {
    assert.equal(effectiveDueByDate({ nextDueDate: "2026-03-04" }), "2026-03-04");
    assert.equal(effectiveDueByDate({ nextDueDate: "2026-03-04", dueByDate: null }), "2026-03-04");
    assert.equal(effectiveDueByDate({ nextDueDate: "2026-03-04", dueByDate: "2026-03-04" }), "2026-03-04");
    assert.equal(effectiveDueByDate({ nextDueDate: "2026-03-04", dueByDate: "2026-03-01" }), "2026-03-04", "a stale one left by a writer that moved nextDueDate");
    assert.equal(effectiveDueByDate({ nextDueDate: "2026-03-04", dueByDate: "2026-03-09" }), "2026-03-09");
    assert.equal(effectiveDueByDate({ dueByDate: "2026-03-09" }), null);
    assert.equal(effectiveDueByDate(null), null);
  });

  test("the undo snapshot: written on the new plan or where the key exists, restored exactly, an old snapshot changes nothing", () => {
    assert.deepEqual(dueBySnapshot({}, false), {});
    assert.deepEqual(dueBySnapshot({}, true), { dueByDate: null });
    assert.deepEqual(dueBySnapshot({ dueByDate: "2026-03-08" }, false), { dueByDate: "2026-03-08" });
    assert.deepEqual(restoreDueByFromSnapshot({ nextDueDate: "x", dueByDate: "y" }, { dueByDate: null }), { nextDueDate: "x" });
    assert.deepEqual(restoreDueByFromSnapshot({ nextDueDate: "x" }, { dueByDate: "2026-03-08" }), { nextDueDate: "x", dueByDate: "2026-03-08" });
    const e = { nextDueDate: "x", dueByDate: "y" };
    assert.equal(restoreDueByFromSnapshot(e, { stage: "stabilizing" }), e, "a snapshot from before this pass leaves the entry as it is");
  });

  test("logging then undoing a session on the new plan restores nextDueDate and dueByDate", () => {
    let p = makePiece({ N: 24, mix: "balanced (50/25/25)", D: 60, reviewModel: 2 });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1));
    const before = clone(p.progress.c1);
    assert.ok(before.dueByDate && before.dueByDate > before.nextDueDate);
    p = logSession(p, generateAllChunks(p), "c1", 6, dateOfDay(6));
    const after = p.progress.c1;
    assert.notEqual(after.nextDueDate, before.nextDueDate);
    // The handler's undo: put the snapshot back (what handleUnlogSession does for the ladder fields).
    const snap = after.sessions[after.sessions.length - 1].ladderSnapshot;
    let restored = { ...after, nextDueDate: snap.nextDueDate, stage: snap.stage, consecutivePasses: snap.consecutivePasses };
    restored = restoreDueByFromSnapshot(restored, snap);
    assert.equal(restored.nextDueDate, before.nextDueDate);
    assert.equal(restored.dueByDate, before.dueByDate);
  });

  test("a chunk with a window survives a save and reload, and the fingerprint is stable", () => {
    let p = makePiece({ N: 24, mix: "balanced (50/25/25)", D: 60, reviewModel: 2 });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1));
    const loaded = validateAndMigratePiece(clone(p));
    assert.equal(loaded.progress.c1.dueByDate, p.progress.c1.dueByDate);
    assert.deepEqual(canonicalPiece(loaded), canonicalPiece(validateAndMigratePiece(clone(loaded))));
    assert.deepEqual(piecePartFingerprints(loaded), piecePartFingerprints(validateAndMigratePiece(clone(loaded))));
  });
});

/* ------------------------------------------------------------------ */
/*  Merging                                                             */
/* ------------------------------------------------------------------ */

describe("[Pass 140] a window travels with its earliest day through every merge", () => {
  const base = () => {
    let p = makePiece({ N: 24, mix: "balanced (50/25/25)", D: 60, reviewModel: 2 });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1));
    return validateAndMigratePiece(clone(p));
  };

  test("two devices that logged DIFFERENT chunks merge with both windows intact", () => {
    const origin = base();
    const a = logSession(clone(origin), generateAllChunks(origin), "c5", 2, dateOfDay(2));
    const b = logSession(clone(origin), generateAllChunks(origin), "c9", 3, dateOfDay(3));
    const plan = planPieceMerge({ local: validateAndMigratePiece(clone(a)), remote: validateAndMigratePiece(clone(b)), base: piecePartFingerprints(origin) });
    assert.ok(["merged", "conflicts"].includes(plan.status), plan.status);
    assert.equal(plan.conflicts.length, 0);
    for (const id of ["c1", "c5", "c9"]) {
      const e = plan.merged.progress[id];
      assert.ok(e.dueByDate && e.dueByDate > e.nextDueDate, id);
    }
  });

  test("the same chunk logged on both: the dueByDate comes from the same side as nextDueDate", () => {
    const origin = base();
    const a = logSession(clone(origin), generateAllChunks(origin), "c1", 5, dateOfDay(5));
    const b = logSession(clone(origin), generateAllChunks(origin), "c1", 8, dateOfDay(8));
    const merged = unionProgressEntries(a.progress.c1, b.progress.c1, origin.progress.c1);
    const lead = [a.progress.c1, b.progress.c1].find((e) => e.nextDueDate === merged.nextDueDate);
    assert.equal(merged.dueByDate, lead.dueByDate);
    assert.ok(merged.dueByDate > merged.nextDueDate);
  });

  test("the file-import merge takes dueByDate from the same side as nextDueDate, and removes it when that side has none", () => {
    const origin = base();
    const withWindow = logSession(clone(origin), generateAllChunks(origin), "c1", 6, dateOfDay(6));
    const oldEntry = { ...origin.progress.c1 };
    delete oldEntry.dueByDate;
    const noWindow = { ...clone(origin), progress: { ...origin.progress, c1: oldEntry }, updatedAt: 1 };
    const takeWindow = mergeImportedPiece({ ...noWindow, updatedAt: 1 }, { ...withWindow, updatedAt: 1 }, "imported");
    assert.equal(takeWindow.progress.c1.dueByDate, withWindow.progress.c1.dueByDate);
    assert.equal(takeWindow.progress.c1.nextDueDate, withWindow.progress.c1.nextDueDate);
    const keepNone = mergeImportedPiece({ ...noWindow, updatedAt: 1 }, { ...withWindow, updatedAt: 1 }, "existing");
    assert.ok(!("dueByDate" in keepNone.progress.c1), "a stale window from the other side is not carried onto this side's date");
  });
});

/* ------------------------------------------------------------------ */
/*  Rules 7 and 8: placement and order                                  */
/* ------------------------------------------------------------------ */

describe("[Pass 140] placeWindowedReviews", () => {
  const prio = (extra = {}) => ({ outcomeRank: 2, tempoGap: 0, stageRank: 0, overdue: 0, start: 0, ...extra });
  const item = (id, earliestDay, latestDay, extra = {}) => ({ id, earliestDay, latestDay, size: 10, established: false, slipDays: 0, priority: prio({ start: Number(id.replace(/\D/g, "")) }), ...extra });
  const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const place = (items, loads = {}, o = {}) =>
    placeWindowedReviews({
      items,
      practiceDays: o.practiceDays || days(1, 30),
      loadOf: (d) => loads[d] || 0,
      protectedOf: (d) => (o.prot && o.prot[d]) || 0,
      target: o.target ?? 100,
      asOfDay: o.asOfDay ?? 1,
      protectedUntil: o.protectedUntil ?? 0,
      nearTie: o.nearTie ?? 0,
    });

  test("a review goes on the lightest day inside its window", () => {
    const p = place([item("c1", 5, 9)], { 5: 30, 6: 30, 7: 10, 8: 30, 9: 30 });
    assert.equal(p.get("c1"), 7);
  });

  test("ties go to the earlier day", () => {
    const p = place([item("c1", 5, 9)], { 5: 20, 6: 10, 7: 10, 8: 10, 9: 20 });
    assert.equal(p.get("c1"), 6);
  });

  describe("near ties", () => {
    test("by default only an exact tie goes to the earlier day (the rule as the card words it)", () => {
      const p = place([item("c1", 5, 9)], { 5: 12, 6: 10, 7: 20, 8: 20, 9: 20 });
      assert.equal(p.get("c1"), 6);
    });

    test("with an allowance, the earliest day within it of the lightest wins", () => {
      // target 100, allowance 0.5 x 100 = 50 minutes above the lightest (10): day 5 at 40 is within it, day 6 is the lightest.
      const p = place([item("c1", 5, 9)], { 5: 40, 6: 10, 7: 0, 8: 90, 9: 90 }, { nearTie: 0.5 });
      assert.equal(p.get("c1"), 5, "day 7 (0) is the lightest; day 5 (40) is within 50 of it, and earlier");
    });

    test("a day above the allowance is passed over for a later, lighter one", () => {
      const p = place([item("c1", 5, 9)], { 5: 80, 6: 10, 7: 0, 8: 50, 9: 50 }, { nearTie: 0.5 });
      assert.equal(p.get("c1"), 6, "day 5 (80) is 80 above the lightest, past the allowance of 50; day 6 (10) is within it");
    });

    test("the allowance never reaches outside the window", () => {
      const p = place([item("c1", 5, 6)], { 5: 90, 6: 90, 7: 0 }, { nearTie: 5 });
      assert.ok(p.get("c1") <= 6);
    });

    test("the shipped allowance is two average days' worth of minutes", () => {
      assert.equal(PLACEMENT_NEAR_TIE_SHARE, 2);
    });
  });

  test("never before its earliest day, even when an earlier day is empty", () => {
    const p = place([item("c1", 8, 12)], { 8: 50, 9: 50, 10: 50, 11: 50, 12: 50 });
    assert.ok(p.get("c1") >= 8);
    assert.equal(p.get("c1"), 8);
  });

  test("never after its latest day when the days have room, however heavy the days inside it are", () => {
    const p = place([item("c1", 5, 7)], { 5: 500, 6: 500, 7: 500, 8: 0, 9: 0 });
    assert.ok(p.get("c1") <= 7);
  });

  test("reviews placed one after another see each other's load", () => {
    const p = place([item("c1", 5, 6), item("c2", 5, 6), item("c3", 5, 6)], {});
    const counts = [5, 6].map((d) => [...p.values()].filter((x) => x === d).length);
    assert.deepEqual(counts.sort(), [1, 2]);
  });

  test("a window whose latest day has passed is placed on the first practice day on or after today", () => {
    const p = place([item("c1", 3, 6)], {}, { asOfDay: 10 });
    assert.equal(p.get("c1"), 10);
  });

  test("a window that is still open is clipped to days from today on", () => {
    const p = place([item("c1", 3, 14)], { 10: 5, 11: 0, 12: 0 }, { asOfDay: 10 });
    assert.ok(p.get("c1") >= 10);
  });

  test("rest days are skipped (only practice days can hold a review)", () => {
    const p = place([item("c1", 5, 9)], { 8: 0 }, { practiceDays: [3, 4, 8, 9, 10] });
    assert.equal(p.get("c1"), 8);
  });

  test("a window with no practice day inside it goes to the first practice day after it", () => {
    const p = place([item("c1", 5, 6)], {}, { practiceDays: [3, 4, 8, 9, 10] });
    assert.equal(p.get("c1"), 8);
  });

  test("a review with no practice day left in the plan is not placed (the live due list covers it)", () => {
    const p = place([item("c1", 40, 45)], {}, { practiceDays: days(1, 30) });
    assert.ok(!p.has("c1"));
  });

  describe("the protected third", () => {
    const est = (id, e, l, extra = {}) => item(id, e, l, { established: true, ...extra });

    test("an established review may use only what the target leaves after a third is held back", () => {
      // target 90: a third (30) is held back on a day with protected work, so 60 is open to established reviews.
      const items = [est("c1", 5, 5), est("c2", 5, 6), est("c3", 5, 6)].map((it) => ({ ...it, size: 40 }));
      const p = place(items, { 5: 30, 6: 30 }, { target: 90, prot: { 5: 30, 6: 30 }, protectedUntil: 10 });
      // Only one 40-minute review fits a day (60 open); three do not fit on two days: the third is forced onto its latest day.
      const per = [5, 6].map((d) => [...p.values()].filter((x) => x === d).length);
      assert.deepEqual(per.slice().sort(), [1, 2]);
      assert.equal(p.get("c1"), 5, "c1 has only day 5, so it takes it");
    });

    test("a day with only a little protected work still holds a third of the target back", () => {
      // target 90, a third = 30. Protected work is only 10, so 60 stays open to established reviews, not 80: a 70-minute
      // review fits on neither day and both are forced onto the latest day. With no third held back each would fit a day.
      const items = [est("c1", 5, 6), est("c2", 5, 6)].map((it) => ({ ...it, size: 70 }));
      const p = place(items, { 5: 10, 6: 10 }, { target: 90, prot: { 5: 10, 6: 10 }, protectedUntil: 10 });
      assert.deepEqual([p.get("c1"), p.get("c2")], [6, 6]);
    });

    test("protected work larger than a third shrinks the room: the day keeps what the protected work needs", () => {
      const a = place([est("c1", 5, 6)], { 5: 70, 6: 30 }, { target: 100, prot: { 5: 70, 6: 30 }, protectedUntil: 10 });
      assert.equal(a.get("c1"), 6, "day 5 holds 70 protected, leaving 30 open: a 10-minute review fits, but day 6 is lighter");
      const b = place([est("c1", 5, 5)].map((it) => ({ ...it, size: 40 })), { 5: 70 }, { target: 100, prot: { 5: 70 }, protectedUntil: 10 });
      assert.equal(b.get("c1"), 5, "forced on its latest day when no day has room");
    });

    test("time not needed by protected work goes back to reviews once none is waiting (past protectedUntil)", () => {
      const items = [est("c1", 20, 20), est("c2", 20, 20)].map((it) => ({ ...it, size: 45 }));
      const p = place(items, {}, { target: 100, protectedUntil: 10 });
      assert.deepEqual([...p.values()], [20, 20], "both forced on day 20 either way; the point is no error and the cap is not applied");
    });

    test("a review that is not established is not limited by it", () => {
      const p = place([item("c1", 5, 5)].map((it) => ({ ...it, size: 500 })), {}, { target: 90, protectedUntil: 10 });
      assert.equal(p.get("c1"), 5);
    });
  });

  describe("the slip", () => {
    const est = (id, e, l, extra = {}) => item(id, e, l, { established: true, ...extra });

    test("a review the window cannot take may slip past its latest day, by at most its slip allowance, to a day with room", () => {
      // Days 5 and 6 are full; day 7 has room. Its latest day is 6; two extra days of slip reach day 8.
      const it = est("c1", 5, 6, { slipDays: 2, size: 40 });
      const p = place([it], { 5: 100, 6: 100, 7: 0, 8: 0 }, { target: 100, prot: { 5: 100, 6: 100 }, protectedUntil: 0 });
      assert.ok(p.get("c1") > 6 && p.get("c1") <= 8);
    });

    test("it never goes beyond the allowance", () => {
      const it = est("c1", 5, 6, { slipDays: 2, size: 40 });
      const full = { 5: 100, 6: 100, 7: 100, 8: 100, 9: 0 };
      const p = place([it], full, { target: 100, prot: { ...full }, protectedUntil: 0 });
      assert.equal(p.get("c1"), 6, "day 9 is beyond latest + 2; so it is forced onto its latest day");
    });

    test("no slip is used when a day inside the window has room", () => {
      const it = est("c1", 5, 7, { slipDays: 4, size: 40 });
      const p = place([it], { 5: 100, 6: 20, 7: 100, 8: 0 }, { target: 100, prot: { 5: 100, 7: 100 }, protectedUntil: 0 });
      assert.equal(p.get("c1"), 6);
    });

    test("the allowance is two of the stage's normal gaps (REVIEW_SLIP_INTERVALS)", () => {
      assert.equal(REVIEW_SLIP_INTERVALS, 2);
    });
  });

  test("a review already past its latest day is never slipped further: it goes on today", () => {
    const it = item("c1", 2, 4, { established: true, slipDays: 10, size: 40 });
    const p = place([it], { 6: 100 }, { target: 100, prot: { 6: 100 }, protectedUntil: 20, asOfDay: 6 });
    assert.equal(p.get("c1"), 6);
  });

  test("closed windows are placed before open ones, and the nearest latest day before the later ones", () => {
    const order = [];
    const items = [item("c3", 5, 9), item("c1", 2, 3), item("c2", 5, 6)];
    const p = place(items, { 6: 10, 7: 0, 8: 0, 9: 0 }, { asOfDay: 5 });
    assert.equal(p.get("c1"), 5, "closed: today");
    assert.ok(p.get("c2") <= 6);
    assert.ok(p.has("c3"));
    order.push(...p.keys());
    assert.equal(order[0], "c1");
  });
});

describe("[Pass 140] worst first (rule 8)", () => {
  const piece = { targetBPM: 100 };
  const chunk = (start) => ({ start });
  const parts = (entry, start = 1) => reviewPriorityParts(piece, chunk(start), entry, "2026-03-10");
  const sess = (outcome) => ({ loggedDate: "2026-03-01", loggedAt: 1, outcome });
  const sorted = (list) => [...list].sort((a, b) => compareReviewPriority(a.p, b.p)).map((x) => x.id);

  test("Needs rework before Partial pass before Full pass", () => {
    const list = [
      { id: "pass", p: parts({ sessions: [sess("pass")], stage: "stabilizing", practiceBPM: 50 }) },
      { id: "soft", p: parts({ sessions: [sess("soft-miss")], stage: "stabilizing", practiceBPM: 90 }) },
      { id: "fail", p: parts({ sessions: [sess("fail")], stage: "holding", practiceBPM: 99 }) },
    ];
    assert.deepEqual(sorted(list), ["fail", "soft", "pass"]);
  });

  test("then the one furthest below target tempo", () => {
    const list = [
      { id: "near", p: parts({ sessions: [sess("pass")], stage: "stabilizing", practiceBPM: 90 }) },
      { id: "far", p: parts({ sessions: [sess("pass")], stage: "stabilizing", practiceBPM: 40 }) },
    ];
    assert.deepEqual(sorted(list), ["far", "near"]);
  });

  test("the tempo gap comes before the stage: a Holding chunk far below target beats a Stabilizing one near it", () => {
    const list = [
      { id: "stabilizing-near", p: parts({ sessions: [sess("pass")], stage: "stabilizing", practiceBPM: 95 }) },
      { id: "holding-far", p: parts({ sessions: [sess("pass")], stage: "holding", practiceBPM: 30 }) },
    ];
    assert.deepEqual(sorted(list), ["holding-far", "stabilizing-near"]);
  });

  test("then the earlier stage", () => {
    const list = [
      { id: "holding", p: parts({ sessions: [sess("pass")], stage: "holding", practiceBPM: 60 }) },
      { id: "settling", p: parts({ sessions: [sess("pass")], stage: "settling", practiceBPM: 60 }) },
      { id: "stabilizing", p: parts({ sessions: [sess("pass")], stage: "stabilizing", practiceBPM: 60 }) },
    ];
    assert.deepEqual(sorted(list), ["stabilizing", "settling", "holding"]);
  });

  test("then the one that has waited longest past its earliest day", () => {
    const list = [
      { id: "recent", p: parts({ sessions: [sess("pass")], stage: "settling", practiceBPM: 60, nextDueDate: "2026-03-09" }) },
      { id: "old", p: parts({ sessions: [sess("pass")], stage: "settling", practiceBPM: 60, nextDueDate: "2026-03-02" }) },
    ];
    assert.deepEqual(sorted(list), ["old", "recent"]);
  });

  test("ties fall back to measure order; a chunk with no sessions or target reads as neither worst nor best", () => {
    const list = [
      { id: "late", p: parts({ stage: "settling" }, 9) },
      { id: "early", p: parts({ stage: "settling" }, 1) },
    ];
    assert.deepEqual(sorted(list), ["early", "late"]);
    assert.equal(reviewPriorityParts({}, chunk(1), { stage: "settling", practiceBPM: 50 }, "2026-03-10").tempoGap, 0);
  });

  test("a skipped or still-provisional last attempt is not the 'last outcome'", () => {
    const skipped = { loggedDate: "2026-03-05", loggedAt: 2, skipped: true };
    const p = parts({ sessions: [sess("fail"), skipped], stage: "stabilizing" });
    assert.equal(p.outcomeRank, 0, "reads the last JUDGED session");
  });
});

/* ------------------------------------------------------------------ */
/*  The timeline for a piece on the new plan                            */
/* ------------------------------------------------------------------ */

describe("[Pass 140] computeTimeline places a windowed review inside its window", () => {
  // 60 measures in chunks of 4 = 15 chunks; a 45-day plan. The chunk planned for day 1 is learned that day,
  // which opens a Stabilizing window of 2 to 7 days: plan days 3 to 8.
  function learned(reviewModel = 2) {
    let p = makePiece({ N: 60, mix: "balanced (50/25/25)", D: 45, reviewModel });
    const id = computeTimeline(p, generateAllChunks(p), { asOfDay: 1 }).days[0].newChunkIds[0];
    p = logSession(p, generateAllChunks(p), id, 1, dateOfDay(1));
    return { p, id };
  }
  // The window's days are plan days 3 to 8; a Difficult chunk also has its next-day touch on day 2 (Pass 138),
  // which is a separate card, so only days from 3 on are the window's review.
  const whereIs = (tl, id) => tl.days.filter((d) => d.dayNumber >= 3 && d.type !== "consolidation" && d.reviewChunkIds.includes(id)).map((d) => d.dayNumber);

  test("the review sits inside [earliest, latest] and no earlier than today", () => {
    const { p, id } = learned();
    const e = p.progress[id];
    assert.equal(e.nextDueDate, dateOfDay(3));
    assert.equal(e.dueByDate, dateOfDay(8));
    for (const asOfDay of [1, 2, 3, 5]) {
      const where = whereIs(computeTimeline(p, generateAllChunks(p), { asOfDay }), id);
      assert.equal(where.length, 1, `asOfDay ${asOfDay}: placed once`);
      assert.ok(where[0] >= Math.max(3, asOfDay) && where[0] <= 8, `asOfDay ${asOfDay}: day ${where[0]}`);
    }
  });

  test("a window already closed is placed on today, however far past it is", () => {
    const { p, id } = learned();
    assert.deepEqual(whereIs(computeTimeline(p, generateAllChunks(p), { asOfDay: 20 }), id), [20]);
  });

  test("it avoids a heavy day: the review goes on a day within the near-tie allowance of the lightest day of its window", () => {
    const { p, id } = learned();
    const tl = computeTimeline(p, generateAllChunks(p), { asOfDay: 1 });
    const [day] = whereIs(tl, id);
    const cs = generateAllChunks(p);
    const minutes = Object.fromEntries(cs.all.map((c) => [c.id, c.effort * EFFORT_TO_MIN]));
    const load = (d) => [...d.newChunkIds, ...d.specialChunkIds, ...d.reviewChunkIds.filter((x) => x !== id)].reduce((a, x) => a + minutes[x], 0);
    const practice = tl.days.filter((d) => d.type !== "consolidation");
    const average = practice.reduce((a, d) => a + load(d) + (d.reviewChunkIds.includes(id) ? minutes[id] : 0), 0) / practice.length;
    const windowLoads = [3, 4, 5, 6, 7, 8].map((n) => load(tl.days[n - 1]));
    assert.ok(load(tl.days[day - 1]) <= Math.min(...windowLoads) + PLACEMENT_NEAR_TIE_SHARE * average + 1e-9, `day ${day}`);
    assert.ok(day >= 3 && day <= 8);
  });

  test("a piece on today's plan is not affected by the day it is asked about; on the new plan one day gives one answer", () => {
    const old = learned(null).p;
    const cs = generateAllChunks(old);
    assert.deepEqual(clone(computeTimeline(old, cs, { asOfDay: 2 })), clone(computeTimeline(old, cs, { asOfDay: 30 })));
    const fresh = learned(2).p;
    const a = computeTimeline(fresh, generateAllChunks(fresh), { asOfDay: 4 });
    const b = computeTimeline(fresh, generateAllChunks(fresh), { asOfDay: 4 });
    assert.deepEqual(clone(a), clone(b));
  });

  test("a piece switched back to today's plan ignores a window left on its chunks: it is placed and listed by nextDueDate alone", () => {
    const { p, id } = learned();
    const back = { ...p, reviewModel: null };
    assert.ok(back.progress[id].dueByDate);
    // Asked on day 5, a window would put it on day 5 or later; today's plan puts it where nextDueDate says, day 3.
    const placed = whereIs(computeTimeline(back, generateAllChunks(back), { asOfDay: 5 }), id);
    assert.deepEqual(placed, [3], "nextDueDate is plan day 3, whatever dueByDate says");
    const due = computeDueReviews(back, generateAllChunks(back), dateOfDay(5));
    assert.ok(due.length > 0 && due.every((i) => !("status" in i)));
  });

  test("a chunk with no window (nextDueDate only) is placed on its day as before, on the new plan too", () => {
    const { p, id } = learned();
    const e = { ...p.progress[id] };
    delete e.dueByDate;
    const noWindow = { ...p, progress: { ...p.progress, [id]: e } };
    // Placed by nextDueDate (plan day 3), not by a window. The existing smoothing pass
    // may nudge a review up to two days later (Pass 90), and since Pass 141 there are no
    // transitions or combos to share the load, so it can: day 3 to day 5 here.
    const placed = whereIs(computeTimeline(noWindow, generateAllChunks(noWindow), { asOfDay: 1 }), id);
    assert.equal(placed.length, 1);
    assert.ok(placed[0] >= 3 && placed[0] <= 5, `placed on day ${placed[0]}`);
  });

  test("a rescheduled piece passes today's day into its remainder", () => {
    const { p } = learned();
    const cs = generateAllChunks(p);
    const marker = { asOfDay: 10, remainingChunkOrder: cs.practiceChunks.slice(3).map((c) => c.id), remainingConnectorIds: [], previous: null };
    const tl = getEffectiveTimeline({ ...p, rescheduleMarker: marker }, cs, { asOfDay: 12 });
    assert.equal(tl.days.length, 45);
    assert.deepEqual(tl.days.map((d) => d.dayNumber), Array.from({ length: 45 }, (_, i) => i + 1));
  });

  test("a review of a chunk whose window is open is listed on one plan day, plus its done days", () => {
    const { piece } = runPlan(makePiece({ N: 60, mix: "balanced (50/25/25)", D: 45, reviewModel: 2 }), { throughDay: 20 });
    const cs = generateAllChunks(piece);
    const tl = computeTimeline(piece, cs, { asOfDay: 21 });
    for (const c of cs.practiceChunks) {
      const e = piece.progress[c.id];
      if (!e || !e.nextDueDate) continue;
      const future = tl.days.filter((d) => d.dayNumber >= 21 && d.type !== "consolidation" && d.reviewChunkIds.includes(c.id));
      assert.ok(future.length <= 1, `${c.id} placed on ${future.length} future days`);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  The due list                                                        */
/* ------------------------------------------------------------------ */

describe("[Pass 140] computeDueReviews and mergeLiveDueReviews understand the window", () => {
  function setup() {
    let p = makePiece({ N: 60, mix: "balanced (50/25/25)", D: 45, reviewModel: 2 });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1));
    p = logSession(p, generateAllChunks(p), "c5", 1, dateOfDay(1));
    return p;
  }
  const dueOn = (p, date) => computeDueReviews(p, generateAllChunks(p), date);

  test("before the earliest day: not listed; from the earliest day: available; from the latest: due", () => {
    const p = setup();
    assert.equal(dueOn(p, dateOfDay(2)).length, 0);
    const avail = dueOn(p, dateOfDay(3));
    assert.deepEqual(avail.map((i) => i.status), ["available", "available"]);
    assert.ok(avail.every((i) => i.latestDate === dateOfDay(8) && i.daysOverdue === 0));
    const due = dueOn(p, dateOfDay(8));
    assert.deepEqual(due.map((i) => i.status), ["due", "due"]);
    const later = dueOn(p, dateOfDay(10));
    assert.ok(later.every((i) => i.status === "due" && i.daysOverdue === 2), "days late are counted from the latest day");
  });

  test("an available review is not forced onto today; a due one is", () => {
    const p = setup();
    const cs = generateAllChunks(p);
    const day = { type: "learning", dayNumber: 4, newChunkIds: [], specialChunkIds: [], reviewChunkIds: [], minutes: 0 };
    assert.deepEqual(mergeLiveDueReviews(day, dueOn(p, dateOfDay(4))).reviewChunkIds, [], "available: left to the plan");
    assert.deepEqual(mergeLiveDueReviews(day, dueOn(p, dateOfDay(8))).reviewChunkIds.sort(), ["c1", "c5"]);
    const placed = { ...day, reviewChunkIds: ["c1"], minutes: 0 };
    assert.deepEqual(mergeLiveDueReviews(placed, dueOn(p, dateOfDay(8))).reviewChunkIds.sort(), ["c1", "c5"], "no duplicate for one already placed");
    assert.ok(cs);
  });

  test("worst first: a Partial pass is listed before a Full pass", () => {
    let p = makePiece({ N: 60, mix: "balanced (50/25/25)", D: 45, reviewModel: 2 });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1), { result: "pass" });
    p = logSession(p, generateAllChunks(p), "c5", 1, dateOfDay(1), { result: "soft-miss", cleanReps: 1 });
    const list = dueOn(p, dateOfDay(8));
    assert.deepEqual(list.map((i) => i.chunkId), ["c5", "c1"]);
  });

  test("a piece on today's plan keeps most-overdue-first, with no status keys", () => {
    let p = makePiece({ N: 60, mix: "balanced (50/25/25)", D: 45, reviewModel: null });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1));
    p = logSession(p, generateAllChunks(p), "c5", 3, dateOfDay(3));
    const list = dueOn(p, dateOfDay(20));
    assert.deepEqual(list.map((i) => i.chunkId), ["c1", "c5"]);
    assert.ok(list.every((i) => !("status" in i)));
  });

  test("computeDueOnDate marks a window opening as available", () => {
    const p = setup();
    const opens = computeDueOnDate(p, generateAllChunks(p), dateOfDay(3));
    assert.ok(opens.length === 2 && opens.every((i) => i.status === "available" && i.latestDate === dateOfDay(8)));
  });

  test("reviewWindowStatus: nothing for today's plan or a chunk without a window", () => {
    const p = setup();
    const e = p.progress.c1;
    assert.equal(reviewWindowStatus({ reviewModel: null }, e, dateOfDay(4)), null);
    assert.equal(reviewWindowStatus(p, { nextDueDate: e.nextDueDate }, dateOfDay(4)), null);
    assert.equal(reviewWindowStatus(p, e, dateOfDay(2)), null);
    assert.equal(reviewWindowStatus(p, e, dateOfDay(5)).status, "available");
    assert.equal(reviewWindowStatus(p, e, dateOfDay(8)).status, "due");
  });
});

describe("[Pass 140] the card's wording", () => {
  function setup() {
    let p = makePiece({ N: 60, mix: "balanced (50/25/25)", D: 45, reviewModel: 2 });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1));
    return p;
  }
  const chunkOf = (p) => generateAllChunks(p).practiceChunks[0];

  test("inside the window it says 'Ready to review' and keeps the latest day for a tooltip", () => {
    const p = setup();
    const s = ladderStatusFor(p, chunkOf(p), p.progress.c1, dateOfDay(4));
    assert.equal(s.dueSentence, "Ready to review");
    assert.equal(s.dueLabel, "ready to review");
    assert.match(s.dueTitle, /^Due by /);
    assert.ok(!/overdue|late/i.test(`${s.dueSentence} ${s.dueLabel} ${s.dueTitle}`), "no penalty words");
  });

  test("from the latest day it reads as due, counted from that day", () => {
    const p = setup();
    const onDay = ladderStatusFor(p, chunkOf(p), p.progress.c1, dateOfDay(8));
    assert.match(onDay.dueLabel, /^due today/);
    const after = ladderStatusFor(p, chunkOf(p), p.progress.c1, dateOfDay(10));
    assert.match(after.dueLabel, /^was due 2 days ago/);
    assert.ok(!("dueSentence" in onDay));
  });

  test("before the window opens it reads as before: 'in N days'", () => {
    const p = setup();
    const s = ladderStatusFor(p, chunkOf(p), p.progress.c1, dateOfDay(1));
    assert.match(s.dueLabel, /^in 2 days/);
  });

  test("on today's plan the line is exactly what it was", () => {
    let p = makePiece({ N: 60, mix: "balanced (50/25/25)", D: 45, reviewModel: null });
    p = logSession(p, generateAllChunks(p), "c1", 1, dateOfDay(1));
    const s = ladderStatusFor(p, chunkOf(p), p.progress.c1, dateOfDay(6));
    assert.deepEqual(Object.keys(s).sort(), ["dueLabel", "progressLabel", "stageLabel"]);
    assert.match(s.dueLabel, /^was due 1 day ago/);
  });
});

describe("[Pass 140] the tempo projection follows the windows", () => {
  test("with a window the projection takes the middle of each window; without one it is as it was", () => {
    const state = { stage: "stabilizing", consecutivePasses: 0, consecutiveStabilizingFails: 0, practiceBPM: 40, targetBPM: 100, tier1Done: false };
    const old = simulateTempoConvergence(state, CFG, "2026-03-01");
    const withTable = simulateTempoConvergence(state, CFG, "2026-03-01", { stabilizing: 2, settling: 2 });
    const windowed = simulateTempoConvergence(state, CFG, "2026-03-01", { stabilizing: 2, settling: 2 }, { planDays: 60, holdingMaxDays: 30 });
    assert.equal(old.applicable, true);
    assert.ok(withTable.converged && windowed.converged);
    assert.notEqual(windowed.days, withTable.days, "the windows change how long it takes");
    assert.equal(windowed.iterations, withTable.iterations, "the same passes, different gaps");
  });
});

/* ------------------------------------------------------------------ */
/*  Whole plans through the real code                                   */
/* ------------------------------------------------------------------ */

describe("[Pass 140] whole plans, day by day through the real timeline", () => {
  // The learner does everything the plan lists each day and every task is a Full pass.
  // The same grid as the design simulation: 4 piece lengths, 3 difficulty mixes, 4 plan lengths.
  const SCENARIOS = [];
  for (const N of [60, 100, 200, 400]) for (const mix of Object.keys(MIXES)) for (const D of [30, 45, 75, 120]) SCENARIOS.push({ N, mix, D });

  const results = SCENARIOS.map((s) => {
    const run = (reviewModel) => {
      const { piece, rows } = runPlan(makePiece({ ...s, reviewModel }), { throughDay: s.D });
      return { piece, rows, ...measureRun(piece, rows) };
    };
    return { ...s, old: run(null), next: run(2) };
  });
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  test("at least 12 pieces were run, of several lengths, difficulty mixes and plan lengths", () => {
    assert.ok(results.length >= 12);
    assert.equal(results.length, 48);
    assert.equal(new Set(results.map((r) => r.N)).size, 4);
    assert.equal(new Set(results.map((r) => r.mix)).size, 3);
    assert.equal(new Set(results.map((r) => r.D)).size, 4);
  });

  test("the owner's bar: the average evenness of the daily load is no worse than 0.45", () => {
    const cv = mean(results.map((r) => r.next.cv));
    assert.ok(cv <= 0.45, `mean variation ${cv.toFixed(3)}`);
  });

  test("it is more even than today's plan on the same pieces", () => {
    const cvNew = mean(results.map((r) => r.next.cv));
    const cvOld = mean(results.map((r) => r.old.cv));
    assert.ok(cvNew < cvOld, `new ${cvNew.toFixed(3)} against today's ${cvOld.toFixed(3)}`);
  });

  test("more chunks end the plan in Holding than on today's plan, with far less total work (Pass 141: joins are returns, not tasks)", () => {
    // Measured on the real code with the owner's join rule (2026-11-21: a join gives the
    // visiting chunk and its neighbour half a pass each and moves nobody up; a combo is the
    // chunk's own turn and gives its neighbours half): Holding 0.90 on average and 0.72 in
    // the worst plan, against today's 0.51; hours 0.44 of today's, because a transition and
    // a combo no longer have their own introduction and their own ladder. Before Pass 141
    // (joins still tasks) these read 0.98, 0.84 and 1.01.
    const holdNew = mean(results.map((r) => r.next.holdingShare));
    const holdOld = mean(results.map((r) => r.old.holdingShare));
    assert.ok(holdNew > holdOld, `Holding share ${holdNew.toFixed(2)} against ${holdOld.toFixed(2)}`);
    assert.ok(holdNew >= 0.85, `Holding share ${holdNew.toFixed(2)}`);
    assert.ok(Math.min(...results.map((r) => r.next.holdingShare)) >= 0.65);
    const hours = mean(results.map((r) => r.next.hours)) / mean(results.map((r) => r.old.hours));
    assert.ok(hours > 0.3 && hours < 0.7, `hours ratio ${hours.toFixed(2)}`);
  });

  test("the plan never asks for more than one session of a chunk on one day", () => {
    for (const r of results) for (const row of r.next.rows) assert.equal(new Set(row.tasks).size, row.tasks.length);
  });

  test("after its second session a chunk is only ever logged on or after the earliest day its window opened (the learning day and the next-day touch are the two earlier sessions)", () => {
    for (const r of results.filter((x) => x.D === 75 && x.N <= 200)) {
      for (const [id, e] of Object.entries(r.next.piece.progress)) {
        const logged = (e.sessions || []).filter((s) => !s.skipped);
        for (let i = 2; i < logged.length; i++) {
          const opened = logged[i].ladderSnapshot && logged[i].ladderSnapshot.nextDueDate;
          if (opened && logged[i].loggedDate < opened) assert.fail(`${r.N} ${r.mix} ${r.D}: ${id} session ${i} on ${logged[i].loggedDate}, window opened ${opened}`);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Established                                                         */
/* ------------------------------------------------------------------ */

describe("[Pass 140] established chunks", () => {
  test("a chunk with its learning session and three reviews is established; fewer is not", () => {
    assert.equal(ESTABLISHED_AFTER_SESSIONS, 4);
  });
});
