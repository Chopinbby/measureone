// Tests for Pass 142: early whole-piece run-throughs, the "Typical run time at target
// tempo" field, a run-through's price, and the inconsequential "how did that feel?"
// number. The rules are in docs/Algorithms.md#review-model-v2-planned (rule 5).
//
// The owner's decision of 2026-11-22: a run-through is NOT a review for any chunk. It
// gives no pass, restarts no window, and the number it carries changes nothing. The
// tests below pin that as well as the schedule and the price.
//
// Nothing in components/ can be tested here (no render harness). App.jsx's
// handleLogRunThrough only appends buildRunThroughSession's result to
// progress["__consolidation__"], so the shape that function returns is what is pinned.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateAllChunks } from "../src/lib/chunking.js";
import { computeTimeline, classifyDayCompletion, classifyDayEmptyState } from "../src/lib/scheduling.js";
import { computeDueReviews } from "../src/lib/maintenance.js";
import { buildRunThroughSession } from "../src/lib/plannedMinutes.js";
import { mergeEditedPiece } from "../src/lib/pieceEdit.js";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import { planPieceMerge, piecePartFingerprints } from "../src/lib/pieceMerge.js";
import {
  RUN_THROUGH_EVERY_PRACTICE_DAYS,
  RUN_THROUGH_GUESS_MIN_PER_100_MEASURES,
  isValidFeel,
  runThroughPlanDays,
  medianLoggedRunSeconds,
  currentTempoFor,
  runThroughPrice,
  runThroughPriceText,
  previousFeel,
} from "../src/lib/runThrough.js";
import { makePiece, logSession } from "./review-sim-helper.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const BALANCED = "balanced (50/25/25)";
const sess = (day, extra = {}) => ({ day, stopCount: 1, loggedAt: day * 1000, loggedDate: "2026-02-01", ...extra });
const withRunThroughs = (piece, sessions) => ({ ...piece, progress: { ...piece.progress, __consolidation__: { doneDays: sessions.map((s) => s.day), sessions } } });
const modelTwo = (over = {}) => makePiece({ N: 100, mix: BALANCED, D: 60, reviewModel: 2, ...over });
const tl = (piece) => computeTimeline(piece, generateAllChunks(piece), { asOfDay: 1 });
const lastIntro = (piece, timeline) => {
  const chunkSet = generateAllChunks(piece);
  return Math.max(...chunkSet.practiceChunks.map((c) => timeline.introducedDay[c.id]));
};
const runDays = (timeline) => timeline.days.filter((d) => d.runThroughMinutes).map((d) => d.dayNumber);

describe("[Pass 142] which days carry an early run-through", () => {
  test("the practice day after the last introduction, then every 3 practice days, and never the last practice day", () => {
    const days = Array.from({ length: 30 }, (_, i) => i + 1);
    const got = runThroughPlanDays({ learningDaysCalendar: days.slice(0, 29), lastIntroDay: 12, learningDays: 29 });
    assert.deepEqual(got.slice(0, 4), [13, 16, 19, 22]);
    assert.ok(!got.includes(29), "the last practice day is right before the final day's run-through");
    assert.equal(RUN_THROUGH_EVERY_PRACTICE_DAYS, 3);
  });

  test("rest days are not counted: the spacing is in practice days", () => {
    // practice days only (days 6, 7, 13 and 14 are rest days)
    const practice = [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19];
    const got = runThroughPlanDays({ learningDaysCalendar: practice, lastIntroDay: 5, learningDays: 19 });
    assert.deepEqual(got, [8, 11, 16]);
  });

  test("nothing without a last introduction day, or when no practice day is left after it", () => {
    assert.deepEqual(runThroughPlanDays({ learningDaysCalendar: [1, 2, 3], lastIntroDay: 0, learningDays: 3 }), []);
    assert.deepEqual(runThroughPlanDays({ learningDaysCalendar: [1, 2, 3], lastIntroDay: 3, learningDays: 3 }), []);
  });

  test("on a real timeline of a piece on the new plan", () => {
    const piece = modelTwo();
    const t = tl(piece);
    const days = runDays(t);
    const intro = lastIntro(piece, t);
    assert.ok(days.length >= 3, `expected several run-throughs, got ${days}`);
    assert.ok(days[0] > intro, "the first is after the last chunk is introduced");
    assert.equal(days[0], intro + 1, "and it is the very next practice day (7 practice days a week here)");
    days.slice(1).forEach((d, i) => assert.equal(d - days[i], 3, "every 3 practice days"));
    assert.ok(!days.includes(t.learningDays), "never the last practice day");
    days.forEach((n) => assert.equal(t.days[n - 1].type, "learning", "it is not a new day type: the day stays a learning day"));
  });

  test("rest days on a real timeline: five practice days a week", () => {
    const piece = modelTwo({ practiceDaysPerWeek: 5 });
    const t = tl(piece);
    const days = runDays(t);
    assert.ok(days.length >= 3);
    const practice = t.days.filter((d) => d.type === "learning").map((d) => d.dayNumber);
    days.forEach((n) => assert.ok(practice.includes(n), `day ${n} is a practice day`));
    days.slice(1).forEach((n, i) => assert.equal(practice.indexOf(n) - practice.indexOf(days[i]), 3, "3 practice days apart"));
  });

  test("a day's total includes the run-through's minutes, and the final day is priced like the others", () => {
    const piece = modelTwo({ minutesPerDay: 45 });
    const t = tl(piece);
    const price = runThroughPrice(piece, generateAllChunks(piece).practiceChunks);
    const withRun = t.days.filter((d) => d.runThroughMinutes);
    withRun.forEach((d) => assert.equal(d.runThroughMinutes, price.minutes));
    // the guess for 100 measures is 8 minutes
    assert.equal(price.minutes, 8);
    const finalDay = t.days.find((d) => d.type === "consolidation");
    assert.equal(finalDay.minutes, 8, "it used to bill the whole daily budget (45)");
    // the day's total adds the run-through to what its chunks cost
    const bare = clone(withRun[0]);
    const { runThroughMinutes, ...rest } = bare;
    const chunkSet = generateAllChunks(piece);
    const byId = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));
    const chunkMin = [...rest.newChunkIds, ...rest.specialChunkIds, ...rest.reviewChunkIds].reduce((s, id) => s + byId[id].effort * 3.5, 0);
    assert.ok(Math.abs(withRun[0].minutes - Math.round(chunkMin + runThroughMinutes)) <= 2, "minutes = the chunks' time plus the run-through (rounding aside)");
  });
});

describe("[Pass 142, regression] a piece on today's plan is unchanged", () => {
  test("no run-through is placed, no day carries the field and the final day still bills the daily budget", () => {
    const piece = makePiece({ N: 100, mix: BALANCED, D: 60, minutesPerDay: 45 });
    const t = tl(piece);
    assert.deepEqual(runDays(t), []);
    assert.ok(!JSON.stringify(t).includes("runThroughMinutes"), "not even an empty key");
    assert.equal(t.days.find((d) => d.type === "consolidation").minutes, 45);
  });

  test("a piece on today's plan with a typical run time set still has none", () => {
    const piece = { ...makePiece({ N: 100, mix: BALANCED, D: 60, minutesPerDay: 45 }), typicalRunSeconds: 600 };
    assert.ok(!JSON.stringify(tl(piece)).includes("runThroughMinutes"));
    assert.equal(tl(piece).days.find((d) => d.type === "consolidation").minutes, 45);
  });
});

describe("[Pass 142] a run-through is not a review: nothing about the schedule or the chunks depends on it", () => {
  const baseLogged = (piece) => {
    const chunkSet = generateAllChunks(piece);
    let p = piece;
    chunkSet.practiceChunks.slice(0, 6).forEach((c, i) => {
      p = logSession(p, chunkSet, c.id, 1 + i, `2026-01-0${1 + i}`, { result: "pass", bpm: 60, cleanReps: 5 });
    });
    return p;
  };

  test("a run-through's own number, stops and time change no plan and no due review", () => {
    const piece = baseLogged(modelTwo({ targetBPM: 100 }));
    const a = withRunThroughs(piece, [sess(20, { feel: 2 })]);
    const b = withRunThroughs(piece, [sess(20, { feel: 9 })]);
    const c = withRunThroughs(piece, [sess(20)]);
    const chunkSet = generateAllChunks(piece);
    const ta = clone(computeTimeline(a, chunkSet, { asOfDay: 25 }));
    assert.deepEqual(clone(computeTimeline(b, chunkSet, { asOfDay: 25 })), ta, "9 and 2 plan the same");
    assert.deepEqual(clone(computeTimeline(c, chunkSet, { asOfDay: 25 })), ta, "with and without a number plan the same");
    const dueOf = (p) => clone(computeDueReviews(p, chunkSet, "2026-02-05"));
    assert.deepEqual(dueOf(b), dueOf(a));
    assert.deepEqual(dueOf(c), dueOf(a));
  });

  test("what is saved for a run-through carries only the day, the stops, the clock times, the duration and the number: nothing for any chunk", () => {
    const s = buildRunThroughSession({ day: 20, stopCount: 2, loggedAt: 5, loggedDate: "2026-02-01", durationSeconds: 540, feel: 7 });
    assert.deepEqual(Object.keys(s).sort(), ["day", "durationSeconds", "feel", "loggedAt", "loggedDate", "stopCount"]);
  });

  test("a day that holds only a run-through owes nothing: never 'behind'", () => {
    const piece = modelTwo();
    const day = { dayNumber: 5, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: [], minutes: 8, runThroughMinutes: 8 };
    assert.equal(classifyDayCompletion(day, piece, 10, {}), "empty");
    assert.equal(classifyDayEmptyState(day, piece, {}), "empty");
  });
});

describe("[Pass 142] how a run-through is priced", () => {
  const chunks = (piece) => generateAllChunks(piece).practiceChunks;

  test("with nothing set: a guess of 8 minutes per 100 measures, named as a guess", () => {
    const piece = modelTwo();
    const price = runThroughPrice(piece, chunks(piece));
    assert.equal(price.source, "guess");
    assert.equal(price.minutes, 8);
    assert.equal(RUN_THROUGH_GUESS_MIN_PER_100_MEASURES, 8);
    assert.match(runThroughPriceText(price), /a guess/);
    const bigger = modelTwo({ N: 250 });
    assert.equal(runThroughPrice(bigger, chunks(bigger)).minutes, 20);
  });

  test("the piece's typical run time is used as it is at the target tempo, and scaled when you play slower", () => {
    const piece = { ...modelTwo({ targetBPM: 120 }), typicalRunSeconds: 360 };
    const cs = chunks(piece);
    // no chunk has a tempo yet: the run time as it is
    assert.deepEqual(runThroughPrice(piece, cs), { seconds: 360, minutes: 6, source: "field", tempoScaled: false });
    const at = (bpm) => ({ ...piece, progress: Object.fromEntries(cs.map((c) => [c.id, { currentBPM: bpm }])) });
    assert.equal(runThroughPrice(at(120), cs).minutes, 6, "at the target tempo");
    assert.equal(runThroughPrice(at(60), cs).minutes, 12, "at half the tempo, twice as long");
    assert.equal(runThroughPrice(at(60), cs).tempoScaled, true);
    assert.equal(runThroughPrice(at(60), cs).seconds, 720);
    assert.equal(runThroughPrice(at(240), cs).minutes, 6, "never faster than the typical run time");
    assert.match(runThroughPriceText(runThroughPrice(at(60), cs)), /about 12 min at your current tempo/);
  });

  test("with no target tempo the run time is used as it is, and says no more than that", () => {
    const piece = { ...modelTwo({ targetBPM: null }), typicalRunSeconds: 360 };
    const cs = chunks(piece);
    const p = { ...piece, progress: Object.fromEntries(cs.map((c) => [c.id, { currentBPM: 50 }])) };
    const price = runThroughPrice(p, cs);
    assert.equal(price.minutes, 6);
    assert.equal(price.tempoScaled, false);
    assert.equal(runThroughPriceText(price), "about 6 min");
  });

  test("the tempo is the chunks' tempos weighted by measures, last logged tempo over the ladder's, chunks without one left out", () => {
    const piece = modelTwo({ targetBPM: 120 });
    const [a, b, c] = chunks(piece);
    const p = { ...piece, progress: { [a.id]: { currentBPM: 100, practiceBPM: 40 }, [b.id]: { practiceBPM: 50 }, [c.id]: {} } };
    const weight = (x) => x.end - x.start + 1;
    const expected = (100 * weight(a) + 50 * weight(b)) / (weight(a) + weight(b));
    assert.ok(Math.abs(currentTempoFor(p, chunks(p)) - expected) < 1e-9);
    assert.equal(currentTempoFor(modelTwo(), chunks(modelTwo())), null);
  });

  test("two timed run-throughs: their median replaces the estimate, as it is", () => {
    const piece = { ...modelTwo({ targetBPM: 120 }), typicalRunSeconds: 360 };
    const cs = chunks(piece);
    const one = withRunThroughs(piece, [sess(20, { durationSeconds: 900 })]);
    assert.equal(medianLoggedRunSeconds(one), null, "one is not enough");
    assert.equal(runThroughPrice(one, cs).source, "field");
    const two = withRunThroughs(piece, [sess(20, { durationSeconds: 600 }), sess(23, { durationSeconds: 840 })]);
    assert.equal(medianLoggedRunSeconds(two), 720);
    assert.deepEqual(runThroughPrice(two, cs), { seconds: 720, minutes: 12, source: "logged", tempoScaled: false });
    const three = withRunThroughs(piece, [sess(20, { durationSeconds: 600 }), sess(23, { durationSeconds: 840 }), sess(26, { durationSeconds: 3000 })]);
    assert.equal(medianLoggedRunSeconds(three), 840, "an odd one out does not drag it");
    // a run-through with no time does not count
    const untimed = withRunThroughs(piece, [sess(20, { durationSeconds: 600 }), sess(23), sess(26)]);
    assert.equal(medianLoggedRunSeconds(untimed), null);
    assert.match(runThroughPriceText(runThroughPrice(two, cs)), /middle of your logged run-throughs/);
  });

  test("the plan uses the price: a longer typical run time puts more minutes on the run-through days", () => {
    const short = { ...modelTwo(), typicalRunSeconds: 300 };
    const long = { ...modelTwo(), typicalRunSeconds: 1500 };
    assert.equal(runDays(tl(short)).length, runDays(tl(long)).length);
    assert.ok(tl(short).days.find((d) => d.runThroughMinutes).runThroughMinutes === 5);
    assert.ok(tl(long).days.find((d) => d.runThroughMinutes).runThroughMinutes === 25);
    assert.equal(tl(long).days.find((d) => d.type === "consolidation").minutes, 25);
  });
});

describe("[Pass 142] 'how did that feel?' (1 to 10), and the previous run-through's number", () => {
  test("only a whole number from 1 to 10 is a rating", () => {
    [1, 5, 10].forEach((n) => assert.equal(isValidFeel(n), true));
    [0, 11, 5.5, -1, "7", null, undefined, NaN].forEach((n) => assert.equal(isValidFeel(n), false, String(n)));
  });

  test("a rating is saved only when one was picked: without it the saved run-through has exactly the shape it always had", () => {
    const args = { day: 20, stopCount: 1, loggedAt: 5, loggedDate: "2026-02-01" };
    assert.deepEqual(buildRunThroughSession(args), { ...args });
    assert.deepEqual(buildRunThroughSession({ ...args, durationSeconds: 0, feel: null }), { ...args });
    assert.deepEqual(buildRunThroughSession({ ...args, feel: 8 }), { ...args, feel: 8 });
    assert.deepEqual(buildRunThroughSession({ ...args, durationSeconds: 61, feel: 8 }), { ...args, durationSeconds: 61, feel: 8 });
    assert.ok(!("feel" in buildRunThroughSession({ ...args, feel: 11 })), "out of range is dropped, never clamped");
    assert.ok(!("feel" in buildRunThroughSession({ ...args, feel: "9" })));
  });

  test("the previous run-through's number: the latest earlier run-through that has one", () => {
    const s = [sess(10, { feel: 4 }), sess(13, { feel: 6, loggedDate: "2026-02-04" }), sess(16), sess(20, { feel: 9 })];
    assert.deepEqual(previousFeel(s, 20), { feel: 6, day: 13, loggedDate: "2026-02-04" }, "an unrated run-through (day 16) is skipped, today's own is not 'previous'");
    assert.equal(previousFeel(s, 13).feel, 4);
    assert.equal(previousFeel(s, 10), null, "the first run-through has no previous");
    assert.equal(previousFeel([], 5), null);
    assert.equal(previousFeel(undefined, 5), null);
  });

  test("two attempts on one earlier day: the later attempt is the previous", () => {
    const s = [sess(10, { feel: 3, loggedAt: 100 }), sess(10, { feel: 8, loggedAt: 200 })];
    assert.equal(previousFeel(s, 12).feel, 8);
  });

  test("a bad number saved by something else is never shown", () => {
    assert.equal(previousFeel([sess(10, { feel: 99 }), sess(11, { feel: "x" })], 20), null);
  });
});

describe("[Pass 142] the typical run time field is an ordinary piece setting", () => {
  test("the Settings form saves it (it is on the edit form's allow-list)", () => {
    const live = { id: "p", name: "A", typicalRunSeconds: null, progress: { c1: { doneDays: [1] } } };
    const merged = mergeEditedPiece(live, { ...live, typicalRunSeconds: 540, progress: {} });
    assert.equal(merged.typicalRunSeconds, 540);
    assert.deepEqual(merged.progress, live.progress, "and still never writes the draft's progress over the live piece");
  });

  test("loading never adds it, so an old piece's fingerprint does not move", () => {
    const old = makePiece({ N: 40, mix: BALANCED, D: 30 });
    const migrated = validateAndMigratePiece(clone(old));
    assert.ok(!("typicalRunSeconds" in migrated), "no key appears");
    const twice = validateAndMigratePiece(clone(migrated));
    assert.ok(!("typicalRunSeconds" in twice));
    assert.deepEqual(validateAndMigratePiece(clone({ ...old, typicalRunSeconds: 480 })).typicalRunSeconds, 480, "a set value survives a load");
  });

  test("two devices that set it differently settle by the more recent change, with nothing asked", () => {
    const base = { ...makePiece({ N: 40, mix: BALANCED, D: 30, reviewModel: 2 }), updatedAt: 1000, typicalRunSeconds: 300 };
    const local = { ...base, typicalRunSeconds: 600, updatedAt: 2000, settingTimes: { typicalRunSeconds: 2000 } };
    const remote = { ...base, typicalRunSeconds: 900, updatedAt: 3000, settingTimes: { typicalRunSeconds: 3000 } };
    const r = planPieceMerge({ local, remote, base: piecePartFingerprints(base) });
    assert.equal(r.status, "merged");
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.merged.typicalRunSeconds, 900);
    assert.ok(r.recencySettled.some((x) => x.part === "typicalRunSeconds" && x.side === "remote"));
    const back = planPieceMerge({ local: { ...local, settingTimes: { typicalRunSeconds: 4000 } }, remote, base: piecePartFingerprints(base) });
    assert.equal(back.merged.typicalRunSeconds, 600, "and the other way round");
  });
});
