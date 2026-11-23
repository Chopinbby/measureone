// Tests for Pass 143: the day count of a "minutes per day" plan on review model 2
// (src/lib/minutesPlan.js; docs/Algorithms.md, "Deriving daysToLearn from
// minutesPerDay"). Nothing in components/ can be tested here, so everything that
// decides something is in src/lib/ and tested directly. ScheduleFields.jsx only
// shows what modelTwoMinutesPlan says (a length, and whether it fits in six months).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateAllChunks } from "../src/lib/chunking.js";
import { computeDaysNeededForMinutesPerDay, reconcileMinutesPerDaySchedule, computeTimeline } from "../src/lib/scheduling.js";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import {
  MAX_MINUTES_PLAN_DAYS,
  MIN_MINUTES_PLAN_DAYS,
  modelTwoMinutesPlan,
  reconcileMinutesPlan,
  pieceWithReviewModel,
  playMinutesPlan,
  planStructureOf,
  searchMinutesPlan,
  clearMinutesPlanCache,
} from "../src/lib/minutesPlan.js";
import { makePiece, runPlan } from "./review-sim-helper.mjs";

const BAL = "balanced (50/25/25)";
const EASY = "mostly easy (62/25/12)";
const clone = (x) => JSON.parse(JSON.stringify(x));
const mk = (o) => makePiece({ D: 30, scheduleMode: "minutes", reviewModel: 2, ...o });
const average = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// A fresh search every time, so a test never reads another test's remembered answer.
const planOf = (piece) => {
  clearMinutesPlanCache();
  return modelTwoMinutesPlan(piece);
};

describe("[regression, Pass 143] a piece on today's plan is exactly what it was", () => {
  // Recorded from the code BEFORE this pass (the earlier rule, balanced pieces, 30 minutes
  // a day, 7 practice days a week): 60 measures 44 days, 100 measures 75, 200 measures 152.
  for (const [N, expected] of [[60, 44], [100, 75], [200, 152]]) {
    test(`${N} measures, minutes plan, no review model: ${expected} days, as before`, () => {
      const piece = mk({ N, mix: BAL, minutesPerDay: 30, reviewModel: null });
      assert.equal(reconcileMinutesPlan(piece).daysToLearn, expected);
      assert.deepEqual(reconcileMinutesPlan(piece), reconcileMinutesPerDaySchedule(piece));
      assert.equal(computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7), expected);
    });
  }

  test("a days-mode piece, with or without the new plan, is returned untouched (the same object)", () => {
    const days = makePiece({ N: 60, mix: BAL, D: 40, scheduleMode: "days", reviewModel: null });
    const daysV2 = makePiece({ N: 60, mix: BAL, D: 40, scheduleMode: "days", reviewModel: 2 });
    assert.equal(reconcileMinutesPlan(days), days);
    assert.equal(reconcileMinutesPlan(daysV2), daysV2);
  });

  test("the one-argument reconcile in scheduling.js is unchanged: no override, the earlier rule", () => {
    const piece = mk({ N: 100, mix: BAL, minutesPerDay: 30, reviewModel: null });
    assert.equal(reconcileMinutesPerDaySchedule(piece).daysToLearn, 75);
  });
});

describe("[Pass 143] the length follows the plan played forward", () => {
  test("a piece on the new plan gets a length from the simulation, not from the earlier rule", () => {
    const piece = mk({ N: 100, mix: BAL, minutesPerDay: 60 });
    const old = computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 60, 7);
    const plan = planOf(piece);
    assert.equal(old, 75);
    assert.notEqual(plan.days, old);
    assert.equal(reconcileMinutesPlan(piece).daysToLearn, plan.days);
  });

  test("recorded lengths (they change only if the schedule's price or the ladder changes: re-record then)", () => {
    // Recorded 2026-11-22 with EFFORT_TO_MIN 2.5, the Pass 139 pass table and Pass 140 windows.
    assert.deepEqual({ ...planOf(mk({ N: 60, mix: BAL, minutesPerDay: 30 })) }, { days: 126, fits: true });
    assert.deepEqual({ ...planOf(mk({ N: 100, mix: BAL, minutesPerDay: 60 })) }, { days: 89, fits: true });
    assert.deepEqual({ ...planOf(mk({ N: 100, mix: EASY, minutesPerDay: 30 })) }, { days: 121, fits: true });
  });

  test("a plan that fits really does: played forward, the piece is learned inside it and the average day is within the budget", () => {
    for (const [N, mix, budget, ppw] of [[60, BAL, 30, 7], [100, BAL, 60, 7], [100, EASY, 30, 7], [40, "mostly hard (25/25/50)", 45, 5]]) {
      const piece = mk({ N, mix, minutesPerDay: budget, practiceDaysPerWeek: ppw });
      const plan = planOf(piece);
      assert.equal(plan.fits, true, `N=${N} budget ${budget} should fit`);
      const run = playMinutesPlan(planStructureOf(piece), plan.days);
      assert.ok(run.learnedDay != null && run.learnedDay <= plan.days, "every chunk is in Holding inside the plan");
      assert.ok(average(run.minutes) <= budget, `average ${average(run.minutes).toFixed(1)} is within ${budget}`);
      // and it is the end of what the search could shorten: the day before does not fit.
      if (plan.days > MIN_MINUTES_PLAN_DAYS) {
        const shorter = playMinutesPlan(planStructureOf(piece), plan.days - 1);
        assert.ok(shorter.learnedDay == null || average(shorter.minutes) > budget, "one day shorter does not fit");
      }
    }
  });

  test("the search, on its own: a length that fits with the day before not fitting; the top few days are all tried; nothing fits is six months", () => {
    const at = (threshold, holes = []) => (s, b, d) => d >= threshold && !holes.includes(d);
    assert.deepEqual({ ...searchMinutesPlan({}, 30, at(50)) }, { days: 50, fits: true });
    assert.deepEqual({ ...searchMinutesPlan({}, 30, at(MIN_MINUTES_PLAN_DAYS)) }, { days: MIN_MINUTES_PLAN_DAYS, fits: true });
    // an unlucky day at the very top (a jitter pocket) is not "does not fit in six months"
    assert.deepEqual({ ...searchMinutesPlan({}, 30, at(120, [MAX_MINUTES_PLAN_DAYS])) }, { days: 120, fits: true });
    assert.deepEqual({ ...searchMinutesPlan({}, 30, at(120, [MAX_MINUTES_PLAN_DAYS, MAX_MINUTES_PLAN_DAYS - 3, MAX_MINUTES_PLAN_DAYS - 6])) }, { days: 183, fits: false });
    assert.deepEqual({ ...searchMinutesPlan({}, 30, () => false) }, { days: 183, fits: false });
    // it never asks about a plan shorter than a week
    const asked = [];
    searchMinutesPlan({}, 30, (s, b, d) => (asked.push(d), d >= 7));
    assert.ok(Math.min(...asked) >= MIN_MINUTES_PLAN_DAYS);
  });

  test("a bigger budget never gives a longer plan (the earlier rule gave the same length at 30 and 60)", () => {
    const lengths = [30, 45, 60, 90].map((b) => planOf(mk({ N: 100, mix: BAL, minutesPerDay: b })).days);
    for (let i = 1; i < lengths.length; i++) assert.ok(lengths[i] <= lengths[i - 1], `budgets 30, 45, 60, 90 gave ${lengths.join(", ")}`);
    assert.ok(lengths[0] > lengths[lengths.length - 1], "and the budget does move the length for a piece the budget can bind");
  });

  test("the budget binds for a bigger piece: a smaller budget gives a longer plan", () => {
    const small = planOf(mk({ N: 100, mix: BAL, minutesPerDay: 30 }));
    const large = planOf(mk({ N: 100, mix: BAL, minutesPerDay: 60 }));
    assert.ok(small.days > large.days);
  });

  test("joins and focus blocks are not tasks: the simulation never lists one", () => {
    const piece = mk({ N: 60, mix: BAL, minutesPerDay: 30 });
    const chunkSet = generateAllChunks(piece);
    const connectorIds = new Set([...chunkSet.transitions, ...chunkSet.combos].map((c) => c.id));
    assert.ok(connectorIds.size > 0);
    // Played through the real timeline: none of those ids ever lands on a day.
    const D = planOf(piece).days;
    const tl = computeTimeline({ ...piece, daysToLearn: D }, chunkSet, { asOfDay: 1 });
    const listed = tl.days.flatMap((d) => [...d.newChunkIds, ...d.specialChunkIds, ...d.reviewChunkIds]);
    assert.equal(listed.filter((id) => connectorIds.has(id)).length, 0);
  });

  test("run-throughs are priced: their minutes are in the day, and a longer typical run time moves the plan", () => {
    const piece = mk({ N: 60, mix: BAL, minutesPerDay: 60 });
    const run = playMinutesPlan(planStructureOf(piece), planOf(piece).days);
    const withRun = run.rows.filter((r) => r.runThroughMinutes > 0);
    assert.ok(withRun.length >= 5, "early run-throughs fall on practice days before the piece is learned");
    withRun.forEach((r) => assert.ok(r.minutes >= r.runThroughMinutes));
    const long = planOf({ ...piece, typicalRunSeconds: 1800 });
    assert.notEqual(long.days, planOf(piece).days, "the run time is an input of the length");
    const longRun = playMinutesPlan(planStructureOf({ ...piece, typicalRunSeconds: 1800 }), long.days);
    assert.ok(Math.max(...longRun.rows.map((r) => r.runThroughMinutes)) >= 30, "a 30 minute run-through is on its days");
  });

  test("it prices a task the way the schedule does: day one of the simulation is the timeline's day one", () => {
    const piece = mk({ N: 60, mix: BAL, minutesPerDay: 30 });
    const D = planOf(piece).days;
    const tl = computeTimeline({ ...piece, daysToLearn: D }, generateAllChunks({ ...piece, daysToLearn: D }), { asOfDay: 1 });
    const run = playMinutesPlan(planStructureOf(piece), D);
    assert.ok(Math.abs(run.rows[0].minutes - tl.days[0].minutes) < 0.5, `${run.rows[0].minutes} against ${tl.days[0].minutes}`);
  });

  test("[drift guard] the simulation agrees, day by day, with test/review-sim-helper.mjs (the hand-kept copy of handleLogSession)", () => {
    for (const [N, mix, budget, ppw] of [[60, BAL, 30, 7], [100, EASY, 30, 7], [40, "mostly hard (25/25/50)", 45, 5]]) {
      const piece = mk({ N, mix, minutesPerDay: budget, practiceDaysPerWeek: ppw });
      const D = planOf(piece).days;
      const mine = playMinutesPlan(planStructureOf(piece), D);
      const theirs = runPlan({ ...piece, daysToLearn: D }, { throughDay: mine.learnedDay });
      assert.ok(mine.rows.length > 20);
      mine.rows.forEach((r) => {
        const h = theirs.rows[r.day - 1];
        assert.ok(Math.abs(r.minutes - r.runThroughMinutes - h.minutes) < 1e-9, `day ${r.day}: ${r.minutes - r.runThroughMinutes} against ${h.minutes}`);
      });
    }
  });
});

describe("[Pass 143] six months is the limit", () => {
  test("a budget that cannot be met in six months gets six months and says it does not fit", () => {
    const piece = mk({ N: 100, mix: BAL, minutesPerDay: 30 });
    const plan = planOf(piece);
    assert.equal(MAX_MINUTES_PLAN_DAYS, 183);
    assert.deepEqual({ ...plan }, { days: 183, fits: false });
    assert.equal(reconcileMinutesPlan(piece).daysToLearn, 183);
  });

  test("no plan is longer than six months, whatever the piece", () => {
    for (const piece of [mk({ N: 400, mix: BAL, minutesPerDay: 15 }), mk({ N: 200, mix: BAL, minutesPerDay: 45 }), mk({ N: 100, mix: BAL, minutesPerDay: 5 })]) {
      const plan = planOf(piece);
      assert.ok(plan.days <= MAX_MINUTES_PLAN_DAYS);
      assert.equal(plan.days, MAX_MINUTES_PLAN_DAYS);
      assert.equal(plan.fits, false);
    }
  });

  test("a reschedule that extends a plan past six months is kept: the floor is not held to the limit", () => {
    const piece = mk({ N: 100, mix: BAL, minutesPerDay: 30 });
    const extended = { ...piece, daysToLearn: 230, rescheduleMarker: { asOfDay: 5, remainingChunkOrder: [] } };
    assert.equal(reconcileMinutesPlan(extended).daysToLearn, 230);
  });

  test("the shortest plan tried is a week", () => {
    assert.equal(MIN_MINUTES_PLAN_DAYS, 7);
  });
});

describe("[Pass 143] the reschedule-marker floor still works on the new plan (CLAUDE.md: keep it)", () => {
  const piece = mk({ N: 60, mix: BAL, minutesPerDay: 30 });
  const needed = planOf(piece).days;

  test("no marker: an out-of-date daysToLearn is re-derived", () => {
    assert.equal(reconcileMinutesPlan({ ...piece, daysToLearn: 999, rescheduleMarker: null }).daysToLearn, needed);
  });

  test("a marker present: an extended daysToLearn is never shrunk back down, and survives a reload", () => {
    const extended = { ...piece, daysToLearn: needed + 40, rescheduleMarker: { asOfDay: 5, remainingChunkOrder: [] } };
    assert.equal(reconcileMinutesPlan(extended).daysToLearn, needed + 40);
    // a reload is validateAndMigratePiece on the stored copy
    assert.equal(validateAndMigratePiece(clone(extended)).daysToLearn, needed + 40);
  });

  test("a marker present but never extended: just the derived length, no phantom floor", () => {
    assert.equal(reconcileMinutesPlan({ ...piece, daysToLearn: needed, rescheduleMarker: { asOfDay: 5, remainingChunkOrder: [] } }).daysToLearn, needed);
  });

  test("clearing the marker drops the floor at once", () => {
    assert.equal(reconcileMinutesPlan({ ...piece, daysToLearn: needed + 40, rescheduleMarker: null }).daysToLearn, needed);
  });
});

describe("[Pass 143] the length is a pure function of the piece's structure", () => {
  const base = mk({ N: 60, mix: BAL, minutesPerDay: 30 });
  const expected = planOf(base);

  test("not of the start date, the progress, a marker, the name or any note", () => {
    const logged = { ...base, startDate: "2019-02-03", name: "Another", notes: "x", progress: { c1: { doneDays: [1, 2], sessions: [{ day: 1, outcome: "pass" }], stage: "holding" } }, rescheduleMarker: { asOfDay: 3, remainingChunkOrder: [] }, status: "paused", daysToLearn: 500 };
    assert.deepEqual({ ...planOf(logged) }, { ...expected });
  });

  test("not of the clock: the same answer with the date stubbed to another year", () => {
    const RealDate = Date;
    const fixed = new RealDate("2031-07-09T12:00:00Z").getTime();
    class FakeDate extends RealDate {
      constructor(...a) {
        if (a.length === 0) super(fixed);
        else super(...a);
      }
      static now() {
        return fixed;
      }
    }
    globalThis.Date = FakeDate;
    try {
      assert.deepEqual({ ...planOf(clone(base)) }, { ...expected });
    } finally {
      globalThis.Date = RealDate;
    }
  });

  test("the file reads no clock and no elapsed-day helper", () => {
    const src = read("../src/lib/minutesPlan.js").replace(/\/\/.*$/gm, "");
    for (const banned of ["Date.now", "new Date(", "todayISODate", "elapsedDay", "getCurrentDay"]) assert.ok(!src.includes(banned), `minutesPlan.js must not use ${banned}`);
  });

  test("the structure is the whitelist: a field not on it cannot change a length", () => {
    const s = planStructureOf({ ...base, name: "x", notes: "y", progress: { a: 1 }, rescheduleMarker: {}, startDate: "2020-01-01" });
    for (const gone of ["name", "notes", "progress", "rescheduleMarker", "startDate", "daysToLearn", "scheduleMode", "targetBPM", "reviewModel"]) assert.ok(!(gone in s), `${gone} is not an input`);
    for (const kept of ["totalMeasures", "measureDifficulty", "chunkMode", "practiceDaysPerWeek", "minutesPerDay", "ladderConfig"]) assert.ok(kept in s, `${kept} is an input`);
  });

  test("it is remembered, and a change to an input is not served from memory", () => {
    clearMinutesPlanCache();
    const a = modelTwoMinutesPlan(base);
    assert.equal(modelTwoMinutesPlan(clone(base)), a, "the same structure gives the remembered answer");
    const other = modelTwoMinutesPlan({ ...base, minutesPerDay: 5 });
    assert.notEqual(other, a);
    assert.equal(other.fits, false);
  });
});

describe("[Pass 143] where it is wired", () => {
  test("a reload (validateAndMigratePiece) gives the same length, twice over", () => {
    const piece = mk({ N: 60, mix: BAL, minutesPerDay: 30 });
    const once = validateAndMigratePiece(clone(piece));
    assert.equal(once.daysToLearn, planOf(piece).days);
    assert.equal(validateAndMigratePiece(clone(once)).daysToLearn, once.daysToLearn, "idempotent");
  });

  test("a model 2 piece planned by days is not given a minutes length on load", () => {
    const piece = makePiece({ N: 60, mix: BAL, D: 40, scheduleMode: "days", reviewModel: 2 });
    assert.equal(validateAndMigratePiece(clone(piece)).daysToLearn, 40);
  });

  test("storage.js and pieceMerge.js use reconcileMinutesPlan, not the earlier function directly", () => {
    for (const f of ["../src/lib/storage.js", "../src/lib/pieceMerge.js"]) {
      const src = read(f);
      assert.ok(/import \{ reconcileMinutesPlan \} from "\.\/minutesPlan"/.test(src), `${f} imports reconcileMinutesPlan`);
      assert.ok(!/reconcileMinutesPerDaySchedule\(/.test(src.replace(/\/\/.*$/gm, "")), `${f} must not call reconcileMinutesPerDaySchedule itself`);
    }
  });

  test("scheduling.js does not import minutesPlan.js (no circular import)", () => {
    assert.ok(!/from "\.\/minutesPlan"/.test(read("../src/lib/scheduling.js")));
  });

  test("if the simulation fails, loading falls back to the earlier rule and does not throw", () => {
    const piece = mk({ N: 60, mix: BAL, minutesPerDay: 30 });
    const warn = console.warn;
    let warned = 0;
    console.warn = () => warned++;
    try {
      const out = reconcileMinutesPlan(piece, () => {
        throw new Error("boom");
      });
      assert.equal(out.daysToLearn, computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7));
      assert.equal(warned, 1);
    } finally {
      console.warn = warn;
    }
  });
});

describe("[regression, Pass 143 review] switching the review plan re-derives a minutes piece's length", () => {
  test("switching to the new plan gives the length a reload would give", () => {
    const old = makePiece({ N: 60, mix: BAL, D: 30, scheduleMode: "minutes", minutesPerDay: 30 });
    const settled = validateAndMigratePiece(clone(old));
    assert.equal(settled.daysToLearn, computeDaysNeededForMinutesPerDay(generateAllChunks(settled), 30, 7), "today's plan: the earlier rule's count");
    const switched = pieceWithReviewModel(settled, 2);
    assert.equal(switched.reviewModel, 2);
    assert.notEqual(switched.daysToLearn, settled.daysToLearn, "the length moves with the plan");
    assert.equal(switched.daysToLearn, planOf(switched).days);
    assert.equal(validateAndMigratePiece(clone(switched)).daysToLearn, switched.daysToLearn, "a reload agrees: nothing moves later");
  });

  test("and back again", () => {
    const onNew = validateAndMigratePiece(clone(mk({ N: 60, mix: BAL, minutesPerDay: 30 })));
    const back = pieceWithReviewModel(onNew, null);
    assert.equal(back.reviewModel, null);
    assert.equal(back.daysToLearn, computeDaysNeededForMinutesPerDay(generateAllChunks(back), 30, 7));
    assert.equal(validateAndMigratePiece(clone(back)).daysToLearn, back.daysToLearn);
  });

  test("a piece planned by days gets the switch and nothing else", () => {
    const piece = makePiece({ N: 60, mix: BAL, D: 40, scheduleMode: "days" });
    const switched = pieceWithReviewModel(piece, 2);
    assert.deepEqual(switched, { ...piece, reviewModel: 2 });
    assert.deepEqual(pieceWithReviewModel(switched, null), { ...piece, reviewModel: null });
  });

  test("the reschedule floor still holds across a switch", () => {
    const piece = mk({ N: 60, mix: BAL, minutesPerDay: 30 });
    const base = planOf(piece).days;
    const marked = { ...piece, daysToLearn: base + 20, rescheduleMarker: { asOfDay: 5, previous: null, movedIds: [] } };
    assert.ok(pieceWithReviewModel(marked, 2).daysToLearn >= base + 20, "an extension is not shrunk by switching");
  });

  test("a failing simulation falls back and still switches the plan", () => {
    const piece = makePiece({ N: 60, mix: BAL, D: 30, scheduleMode: "minutes", minutesPerDay: 30 });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const out = pieceWithReviewModel(piece, 2, () => {
        throw new Error("boom");
      });
      assert.equal(out.reviewModel, 2);
      assert.equal(out.daysToLearn, computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7));
    } finally {
      console.warn = warn;
    }
  });

  test("App.jsx's switch goes through pieceWithReviewModel, not a bare reviewModel write", () => {
    const src = read("../src/App.jsx").replace(/\/\/.*$/gm, "");
    const handler = src.slice(src.indexOf("const handleSetReviewModel"), src.indexOf("const handleUpdateRevival"));
    assert.ok(/pieceWithReviewModel\(p, model\)/.test(handler));
    assert.ok(!/reviewModel:/.test(handler), "no bare reviewModel write left in the handler");
  });
});
