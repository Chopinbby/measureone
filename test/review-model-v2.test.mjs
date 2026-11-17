// Tests for Pass 138: the review model switch (piece.reviewModel), the real
// next-day touch, the timer alert's planned-time trigger and the "in a row" wording.
// The rules are in docs/Algorithms.md#review-model-v2-planned (rules 3, 9, 10).
//
// Nothing in components/ can be tested here (no render harness), so everything
// that decides something lives in src/lib/ and is tested directly. The session
// handlers in App.jsx are closures, so the one place they matter here
// (tier1Done through log and undo) is mirrored with the REAL functions.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateAllChunks } from "../src/lib/chunking.js";
import {
  computeTimeline,
  withLiveReviewStatus,
  isReviewModelV2,
  nextDayTouchState,
  tier1DoneAfterSession,
  plannedMinutesFor,
  timerAlertMinutes,
  TIMER_ALERT_FLOOR_MINUTES,
} from "../src/lib/scheduling.js";
import { computeLadderAdvance, timerAlertMessage } from "../src/lib/ladder.js";
import { computeDueReviews } from "../src/lib/maintenance.js";
import { EFFORT_TO_MIN } from "../src/lib/constants.js";
import { requirementLine, repsShortfallMessage, tempoShortfallMessage, cleanRepsInARow } from "../src/lib/confidence.js";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import { mergeEditedPiece } from "../src/lib/pieceEdit.js";
import { addDaysISO } from "../src/lib/utils.js";

const START = "2026-01-01";
const dateOfDay = (n) => addDaysISO(START, n - 1);

// 12 measures in three chunks of 4. Measures 1-4 are all "difficult" (3), so
// c1 is a Difficult chunk; c5 and c9 are Workable.
function basePiece(overrides) {
  return {
    totalMeasures: 12,
    measureDifficulty: [3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1],
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
    ...overrides,
  };
}

function session({ day, date, outcome = "pass", cleanReps = 5, bpm = 60, extra = {} }) {
  return { day, loggedAt: Date.parse(`${date}T10:00:00`), loggedDate: date, cleanReps, bpm, outcome, durationSeconds: 0, ...extra };
}

// A chunk whose learning session was logged on plan-day `day`.
function learnedEntry({ day, outcome = "pass", date = dateOfDay(day), extra = {} }) {
  return {
    doneDays: [day],
    sessions: [session({ day, date, outcome })],
    stage: "stabilizing",
    consecutivePasses: outcome === "pass" ? 1 : 0,
    consecutiveStabilizingFails: 0,
    practiceBPM: 60,
    nextDueDate: addDaysISO(date, 4),
    tier1Done: false,
    ...extra,
  };
}

const chunkOf = (piece, id) => generateAllChunks(piece).all.find((c) => c.id === id);
const timelineFor = (piece) => computeTimeline(piece, generateAllChunks(piece));
const dayHas = (timeline, dayNumber, id) => timeline.days[dayNumber - 1].reviewChunkIds.includes(id);
// The consolidation day lists every practice chunk in reviewChunkIds (the whole-piece
// run-through reuses the field), so it is left out when asking where a review sits.
const reviewDaysOf = (timeline, id) =>
  timeline.days.filter((d) => d.type !== "consolidation" && d.reviewChunkIds.includes(id)).map((d) => d.dayNumber);

describe("[Pass 138] test setup sanity", () => {
  test("c1 is Difficult and c5 is Workable", () => {
    const piece = basePiece();
    assert.equal(chunkOf(piece, "c1").difficultyLabel, "hard");
    assert.equal(chunkOf(piece, "c5").difficultyLabel, "easy");
    assert.equal(chunkOf(piece, "c1").kind, "section");
  });
});

describe("[Pass 138] isReviewModelV2", () => {
  test("only the value 2 means the new plan", () => {
    assert.equal(isReviewModelV2({ reviewModel: 2 }), true);
    assert.equal(isReviewModelV2({ reviewModel: null }), false);
    assert.equal(isReviewModelV2({}), false);
    assert.equal(isReviewModelV2(null), false);
    assert.equal(isReviewModelV2({ reviewModel: "2" }), false);
  });
});

describe("[Pass 138] nextDayTouchState — who owes a next-day touch", () => {
  const v2 = (progress) => basePiece({ reviewModel: 2, progress });
  const hard = { kind: "section", difficultyLabel: "hard", id: "c1" };
  const easy = { kind: "section", difficultyLabel: "easy", id: "c5" };

  test("a piece on today's plan never owes one", () => {
    const entry = learnedEntry({ day: 1 });
    assert.equal(nextDayTouchState(basePiece(), hard, entry), null);
    assert.equal(nextDayTouchState(basePiece({ reviewModel: null }), hard, entry), null);
  });

  test("never logged: promised for a Difficult chunk only", () => {
    assert.deepEqual(nextDayTouchState(v2({}), hard, {}), { afterDate: null, touched: false });
    assert.equal(nextDayTouchState(v2({}), easy, {}), null);
  });

  test("a Difficult chunk owes one even after a Full pass", () => {
    const st = nextDayTouchState(v2({}), hard, learnedEntry({ day: 1, outcome: "pass" }));
    assert.deepEqual(st, { afterDate: dateOfDay(1), touched: false });
  });

  test("a Workable chunk owes one only if its learning session was not a Full pass", () => {
    assert.equal(nextDayTouchState(v2({}), easy, learnedEntry({ day: 1, outcome: "pass" })), null);
    assert.ok(nextDayTouchState(v2({}), easy, learnedEntry({ day: 1, outcome: "soft-miss" })));
    assert.ok(nextDayTouchState(v2({}), easy, learnedEntry({ day: 1, outcome: "fail" })));
  });

  test("an unknown learning outcome is not read as 'not a Full pass'", () => {
    const entry = learnedEntry({ day: 1 });
    delete entry.sessions[0].outcome;
    assert.equal(nextDayTouchState(v2({}), easy, entry), null);
    assert.ok(nextDayTouchState(v2({}), hard, entry), "Difficult still owes one");
  });

  test("an older session with only loggedAt still gives a date", () => {
    const entry = learnedEntry({ day: 1, outcome: "fail" });
    delete entry.sessions[0].loggedDate;
    assert.deepEqual(nextDayTouchState(v2({}), easy, entry), { afterDate: dateOfDay(1), touched: false });
  });

  test("touched by a session on a LATER day, by tier1Done, but not by a same-day re-attempt", () => {
    const base = learnedEntry({ day: 1, outcome: "soft-miss" });
    const sameDay = { ...base, sessions: [...base.sessions, session({ day: 1, date: dateOfDay(1), outcome: "pass" })] };
    assert.equal(nextDayTouchState(v2({}), easy, sameDay).touched, false);
    const later = { ...base, sessions: [...base.sessions, session({ day: 2, date: dateOfDay(2), outcome: "pass" })] };
    assert.equal(nextDayTouchState(v2({}), easy, later).touched, true);
    assert.equal(nextDayTouchState(v2({}), easy, { ...base, tier1Done: true }).touched, true);
  });

  test("a skipped or still-provisional session is not a session", () => {
    const base = learnedEntry({ day: 1, outcome: "soft-miss" });
    const skipped = { ...base, sessions: [...base.sessions, { day: 2, loggedDate: dateOfDay(2), skipped: true }] };
    const provisional = { ...base, sessions: [...base.sessions, session({ day: 2, date: dateOfDay(2), extra: { provisional: true } })] };
    assert.equal(nextDayTouchState(v2({}), easy, skipped).touched, false);
    assert.equal(nextDayTouchState(v2({}), easy, provisional).touched, false);
    // And a first session that is only provisional is not a learning session yet.
    const onlyProvisional = { doneDays: [], sessions: [session({ day: 1, date: dateOfDay(1), outcome: "fail", extra: { provisional: true } })] };
    assert.equal(nextDayTouchState(v2({}), easy, onlyProvisional), null);
    assert.deepEqual(nextDayTouchState(v2({}), hard, onlyProvisional), { afterDate: null, touched: false });
  });

  test("transitions and combos keep today's rule; a chunk flagged for re-learning has no touch", () => {
    assert.equal(nextDayTouchState(v2({}), { kind: "transition", difficultyLabel: "hard", id: "t1" }, {}), null);
    assert.equal(nextDayTouchState(v2({}), { kind: "combo", difficultyLabel: "hard", id: "k1" }, {}), null);
    assert.equal(nextDayTouchState(v2({}), hard, { ...learnedEntry({ day: 1 }), needsRelearning: true }), null);
  });
});

describe("[Pass 138] computeTimeline — the touch on a piece using the new plan", () => {
  test("before anything is logged: Difficult chunks are promised a touch, Workable ones are not", () => {
    const piece = basePiece({ reviewModel: 2 });
    const t = timelineFor(piece);
    assert.ok(reviewDaysOf(t, "c1").length === 1, "the Difficult chunk is promised one touch");
    assert.equal(reviewDaysOf(t, "c1")[0], t.introducedDay.c1 + 1, "the day after its introduction");
    assert.deepEqual(reviewDaysOf(t, "c5"), [], "a never-logged Workable chunk has no promised touch on the new plan");
  });

  test("the same piece on today's plan still promises every chunk a first touch (unchanged)", () => {
    const t = timelineFor(basePiece());
    for (const id of ["c1", "c5", "c9"]) {
      assert.deepEqual(reviewDaysOf(t, id), [t.introducedDay[id] + 1], `${id} keeps its Tier 1 first touch`);
    }
  });

  test("a Difficult chunk logged on its introduction day still has its touch the next day (it no longer vanishes)", () => {
    const base = basePiece({ reviewModel: 2 });
    const intro = timelineFor(base).introducedDay.c1;
    const piece = basePiece({ reviewModel: 2, progress: { c1: learnedEntry({ day: intro, outcome: "pass" }) } });
    const t = timelineFor(piece);
    assert.ok(dayHas(t, intro + 1, "c1"), "touch is on day intro + 1");
    assert.ok(dayHas(t, intro + 4, "c1"), "and the ordinary first return is still placed at its due date");
  });

  test("a Workable chunk logged as a Full pass has no touch; logged as a Partial pass it does", () => {
    const intro = timelineFor(basePiece({ reviewModel: 2 })).introducedDay.c5;
    const pass = timelineFor(basePiece({ reviewModel: 2, progress: { c5: learnedEntry({ day: intro, outcome: "pass" }) } }));
    assert.ok(!dayHas(pass, intro + 1, "c5"));
    const partial = timelineFor(basePiece({ reviewModel: 2, progress: { c5: learnedEntry({ day: intro, outcome: "soft-miss" }) } }));
    assert.ok(dayHas(partial, intro + 1, "c5"));
  });

  test("the touch counts from the day the chunk was actually learned, not the planned day", () => {
    const intro = timelineFor(basePiece({ reviewModel: 2 })).introducedDay.c1;
    // Planned for `intro`, but really practised two days later.
    const entry = learnedEntry({ day: intro, date: dateOfDay(intro + 2) });
    const t = timelineFor(basePiece({ reviewModel: 2, progress: { c1: entry } }));
    assert.ok(dayHas(t, intro + 3, "c1"));
    assert.ok(!dayHas(t, intro + 1, "c1"));
  });

  test("once done, the touch stays on its own day (so the card and its Undo stay put)", () => {
    const intro = timelineFor(basePiece({ reviewModel: 2 })).introducedDay.c1;
    const entry = learnedEntry({ day: intro });
    entry.sessions.push(session({ day: intro + 1, date: dateOfDay(intro + 1) }));
    entry.doneDays = [intro, intro + 1];
    entry.tier1Done = true;
    const t = timelineFor(basePiece({ reviewModel: 2, progress: { c1: entry } }));
    assert.ok(dayHas(t, intro + 1, "c1"));
  });

  test("a chunk touched on some other day is not given a touch on a day it did not do it", () => {
    const intro = timelineFor(basePiece({ reviewModel: 2 })).introducedDay.c1;
    const entry = learnedEntry({ day: intro });
    entry.sessions.push(session({ day: intro + 3, date: dateOfDay(intro + 3) }));
    entry.doneDays = [intro, intro + 3];
    const t = timelineFor(basePiece({ reviewModel: 2, progress: { c1: entry } }));
    assert.ok(!dayHas(t, intro + 1, "c1"));
  });

  test("a touch the learner skips is dropped quietly: the past day shows it as stale, never as work owed", () => {
    const intro = timelineFor(basePiece({ reviewModel: 2 })).introducedDay.c1;
    const piece = basePiece({ reviewModel: 2, progress: { c1: learnedEntry({ day: intro }) } });
    const t = timelineFor(piece);
    assert.ok(dayHas(t, intro + 1, "c1"));
    const live = withLiveReviewStatus(t, piece, intro + 3);
    assert.ok(!dayHas(live, intro + 1, "c1"), "no longer listed on the past day");
    assert.ok(live.days[intro].staleReviewIds.includes("c1"), "treated as a stale review, which is not a missed task");
    // It is still listed while its day has not passed.
    assert.ok(dayHas(withLiveReviewStatus(t, piece, intro + 1), intro + 1, "c1"));
  });

  test("transitions keep today's first-touch rule on a piece using the new plan", () => {
    const piece = basePiece({ reviewModel: 2 });
    const chunkSet = generateAllChunks(piece);
    const t = computeTimeline(piece, chunkSet);
    const transition = chunkSet.transitions[0];
    assert.ok(transition, "setup: the piece has a transition");
    const day = t.introducedDay[transition.id];
    assert.ok(day, "setup: the transition is placed");
    assert.ok(dayHas(t, day + 1, transition.id));
  });

  test("[regression, Pass 138] a piece on today's plan places no touch for a logged Difficult chunk", () => {
    // Re-break this on purpose by dropping the reviewModel check in
    // computeTimeline's Tier 1 loop: this test and the next fail.
    const intro = timelineFor(basePiece()).introducedDay.c1;
    const entry = learnedEntry({ day: intro, outcome: "pass" });
    const piece = basePiece({ progress: { c1: entry } });
    assert.ok(!dayHas(timelineFor(piece), intro + 1, "c1"));
    const nulled = basePiece({ reviewModel: null, progress: { c1: entry } });
    assert.ok(!dayHas(timelineFor(nulled), intro + 1, "c1"));
  });

  test("[regression, Pass 138] today's plan: a missing reviewModel and an explicit null give the identical timeline", () => {
    const intro = timelineFor(basePiece()).introducedDay.c1;
    const progress = { c1: learnedEntry({ day: intro }), c5: learnedEntry({ day: intro + 1, outcome: "soft-miss" }) };
    const a = JSON.stringify(timelineFor(basePiece({ progress })));
    const b = JSON.stringify(timelineFor(basePiece({ reviewModel: null, progress })));
    assert.equal(a, b);
  });
});

describe("[Pass 138] tier1DoneAfterSession — what a logged session does to tier1Done", () => {
  const v2 = { reviewModel: 2 };
  const prev = learnedEntry({ day: 1, outcome: "soft-miss" });

  test("a piece on today's plan: whatever the ladder handed back, untouched", () => {
    assert.equal(tier1DoneAfterSession({}, prev, false, dateOfDay(2)), false);
    assert.equal(tier1DoneAfterSession({ reviewModel: null }, prev, undefined, dateOfDay(2)), undefined);
    assert.equal(tier1DoneAfterSession({}, prev, true, dateOfDay(2)), true);
  });

  test("new plan: the first session ever, or one on the learning day, does not set it", () => {
    assert.equal(tier1DoneAfterSession(v2, { doneDays: [] }, false, dateOfDay(1)), false);
    assert.equal(tier1DoneAfterSession(v2, undefined, undefined, dateOfDay(1)), undefined);
    assert.equal(tier1DoneAfterSession(v2, prev, false, dateOfDay(1)), false);
  });

  test("new plan: the first session on a later day sets it, and it never clears", () => {
    assert.equal(tier1DoneAfterSession(v2, prev, false, dateOfDay(2)), true);
    assert.equal(tier1DoneAfterSession(v2, prev, true, dateOfDay(1)), true);
  });

  test("new plan: a skipped or provisional earlier session is not the learning session", () => {
    const onlyProvisional = { doneDays: [], sessions: [session({ day: 1, date: dateOfDay(1), extra: { provisional: true } })] };
    assert.equal(tier1DoneAfterSession(v2, onlyProvisional, false, dateOfDay(2)), false);
  });

  test("it persists through log then undo: the snapshot restores it (mirror of App.jsx's handlers, real ladder math)", () => {
    const piece = { reviewModel: 2 };
    const config = {
      stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
      settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
      holding: { startIntervalDays: 14, maxIntervalDays: 70, tempoFloorStartFraction: 0.85, tempoFloorStepFraction: 0.05, tempoFloorCapFraction: 1 },
      bpmSteps: { pass: 2, softMiss: -2, fail: -2 },
      tempoRatchet: { k: 0.3, kCapBpm: 8 },
    };
    const log = (entry, day, date) => {
      const snapshot = { tier1Done: entry.tier1Done ?? false, stage: entry.stage ?? null };
      const advance = computeLadderAdvance(
        { stage: entry.stage, consecutivePasses: entry.consecutivePasses, consecutiveStabilizingFails: entry.consecutiveStabilizingFails, practiceBPM: 60, targetBPM: 100, tier1Done: entry.tier1Done },
        { result: "pass", effectiveness: "high", asOfDate: date, cleanReps: 5, bpm: 60 },
        config
      );
      return {
        ...entry,
        doneDays: [...(entry.doneDays || []), day],
        sessions: [...(entry.sessions || []), session({ day, date, extra: { ladderSnapshot: snapshot } })],
        stage: advance.stage,
        consecutivePasses: advance.consecutivePasses,
        tier1Done: tier1DoneAfterSession(piece, entry, advance.tier1Done, date),
      };
    };
    const undo = (entry) => {
      const sessions = entry.sessions.slice(0, -1);
      return { ...entry, sessions, tier1Done: entry.sessions[entry.sessions.length - 1].ladderSnapshot.tier1Done };
    };
    let entry = { doneDays: [] };
    entry = log(entry, 1, dateOfDay(1));
    assert.notEqual(entry.tier1Done, true, "the learning session is not a touch");
    entry = log(entry, 2, dateOfDay(2));
    assert.equal(entry.tier1Done, true, "the next-day session is");
    entry = undo(entry);
    assert.notEqual(entry.tier1Done, true, "undoing it puts the flag back");
    assert.equal(nextDayTouchState({ reviewModel: 2 }, { kind: "section", difficultyLabel: "hard" }, entry).touched, false);
  });

  test("a piece loaded with no tier1Done at all still reads as not touched (the backfill default is not 'done')", () => {
    const migrated = validateAndMigratePiece(
      basePiece({ reviewModel: 2, id: "p", name: "x", progress: { c1: { doneDays: [1], sessions: [session({ day: 1, date: dateOfDay(1) })] } } })
    );
    assert.notEqual(migrated.progress.c1.tier1Done, true);
  });
});

describe("[Pass 138] the switch is never filled in by a load or an edit", () => {
  test("a piece with no reviewModel key keeps none, and one that has it keeps it, through a load and a second load", () => {
    const without = validateAndMigratePiece(basePiece({ id: "p", name: "x" }));
    assert.equal("reviewModel" in without, false, "a load must not add the key (it would change every fingerprint)");
    assert.equal("reviewModel" in validateAndMigratePiece(without), false);
    assert.equal(validateAndMigratePiece(basePiece({ id: "p", name: "x", reviewModel: 2 })).reviewModel, 2);
    assert.equal(validateAndMigratePiece(basePiece({ id: "p", name: "x", reviewModel: null })).reviewModel, null);
  });

  test("the Settings form cannot overwrite it: a save takes it from the live piece", () => {
    const live = { id: "p", name: "Sonata", reviewModel: 2, progress: {}, status: "active" };
    const staleDraft = { id: "p", name: "Sonata in C", reviewModel: null, progress: {}, status: "active" };
    assert.equal(mergeEditedPiece(live, staleDraft).reviewModel, 2);
    const liveOld = { id: "p", name: "Sonata", progress: {}, status: "active" };
    const draftWith = { ...liveOld, name: "Sonata in C", reviewModel: 2 };
    assert.equal(mergeEditedPiece(liveOld, draftWith).reviewModel, undefined, "a draft cannot switch the plan on either");
  });
});

describe("[Pass 138] timer alert: fires at the card's planned time, never sooner than 5 minutes", () => {
  test("the planned minutes are the chunk's effort priced through EFFORT_TO_MIN, rounded", () => {
    const piece = basePiece();
    const set = generateAllChunks(piece);
    for (const c of set.all) {
      assert.equal(plannedMinutesFor(c), Math.max(1, Math.round(c.effort * EFFORT_TO_MIN)), `${c.id} (${c.kind})`);
    }
    // And the numbers the alert was changed to follow: a Difficult 4-measure chunk plans 30, a Workable one 10.
    assert.equal(plannedMinutesFor(chunkOf(piece, "c1")), 30);
    assert.equal(plannedMinutesFor(chunkOf(piece, "c5")), 10);
  });

  test("it is the price the plan itself puts on the card (a day holding one new chunk reads the same minutes)", () => {
    const piece = basePiece();
    const set = generateAllChunks(piece);
    const t = computeTimeline(piece, set);
    const day = t.days.find((d) => d.newChunkIds.length === 1 && !d.specialChunkIds.length && !d.reviewChunkIds.length && d.type === "learning");
    assert.ok(day, "setup: a day with exactly one new chunk and nothing else");
    assert.equal(plannedMinutesFor(set.all.find((c) => c.id === day.newChunkIds[0])), day.minutes);
  });

  test("it is the price Master Agenda's live due-review list puts on a review (computeDueReviews)", () => {
    const piece = basePiece({ progress: { c1: learnedEntry({ day: 1 }) } });
    piece.progress.c1.nextDueDate = "2026-01-02";
    const set = generateAllChunks(piece);
    const items = computeDueReviews(piece, set, "2026-01-10");
    const item = items.find((it) => it.chunkId === "c1");
    assert.ok(item, "setup: c1 is due");
    assert.equal(plannedMinutesFor(set.all.find((c) => c.id === "c1")), item.minutes);
  });

  test("a card the plan puts no price on never alerts: no effort, zero, negative, not a number", () => {
    assert.equal(plannedMinutesFor({ id: "sr_s1", kind: "section-runthrough" }), null);
    assert.equal(plannedMinutesFor({ effort: 0 }), null);
    assert.equal(plannedMinutesFor({ effort: -3 }), null);
    assert.equal(plannedMinutesFor({ effort: "x" }), null);
    assert.equal(plannedMinutesFor(null), null);
    assert.equal(plannedMinutesFor(undefined), null);
  });

  test("a very small chunk plans at least 1 minute, not 0", () => {
    assert.equal(plannedMinutesFor({ effort: 0.1 }), 1);
  });

  test("the alert time is the planned time, held to a floor of 5 minutes", () => {
    const piece = basePiece();
    assert.equal(TIMER_ALERT_FLOOR_MINUTES, 5);
    assert.equal(timerAlertMinutes(chunkOf(piece, "c1")), 30, "Difficult 4-measure chunk: its planned time");
    assert.equal(timerAlertMinutes(chunkOf(piece, "c5")), 10, "Workable 4-measure chunk: its planned time");
    // 1 minute and 3 minutes planned both alert at 5; 5 and 7 are left as they are.
    assert.equal(timerAlertMinutes({ effort: 0.4 }), 5);
    assert.equal(timerAlertMinutes({ effort: 1.2 }), 5);
    assert.equal(timerAlertMinutes({ effort: 2 }), 5, "exactly 5 planned");
    assert.equal(timerAlertMinutes({ effort: 2.8 }), 7);
    assert.equal(timerAlertMinutes({ effort: 1.8 }), 5, "4.5 rounds to 5 planned");
  });

  test("the floor is on the alert only: the planned time keeps the plan's own price", () => {
    assert.equal(plannedMinutesFor({ effort: 1.2 }), 3);
    assert.equal(timerAlertMinutes({ effort: 1.2 }), 5);
    assert.equal(plannedMinutesFor({ effort: 0.1 }), 1);
  });

  test("a card the plan puts no price on never alerts (no floor turns it into an alert)", () => {
    assert.equal(timerAlertMinutes({ id: "sr_s1", kind: "section-runthrough" }), null);
    assert.equal(timerAlertMinutes({ effort: 0 }), null);
    assert.equal(timerAlertMinutes(null), null);
    assert.equal(timerAlertMinutes(undefined), null);
  });

  test("the words: 'You've been on this chunk for N minutes'; the 'mark the exact spot' half only where a focus spot can be added", () => {
    assert.equal(
      timerAlertMessage(30, { canAddFocusSpot: true }),
      "You've been on this chunk for 30 minutes. If clean reps aren't coming, try a slower tempo, or mark the exact spot that's going wrong."
    );
    assert.equal(
      timerAlertMessage(10, { canAddFocusSpot: false }),
      "You've been on this chunk for 10 minutes. If clean reps aren't coming, try a slower tempo."
    );
    assert.match(timerAlertMessage(8, { noun: "task" }), /on this task for 8 minutes\./);
    assert.match(timerAlertMessage(1), /for 1 minute\./);
    assert.ok(!timerAlertMessage(20, { canAddFocusSpot: true }).includes("\u2014"), "no em dash");
    assert.ok(!/planned/.test(timerAlertMessage(20, { canAddFocusSpot: true })), "the old 'planned' wording is gone");
  });
});

describe("[Pass 138] 'in a row' wording on the card", () => {
  test("the requirement says the reps must be in a row (not when only one is needed)", () => {
    assert.equal(requirementLine(3, 82), "Need 3 clean reps in a row at 82+ BPM to progress this chunk.");
    assert.equal(requirementLine(5, null), "Need 5 clean reps in a row to progress this chunk.");
    assert.equal(requirementLine(1, 60), "Need 1 clean rep at 60+ BPM to progress this chunk.");
    assert.equal(cleanRepsInARow(2), "2 clean reps in a row");
    assert.equal(cleanRepsInARow(1), "1 clean rep");
  });

  test("the 'Save anyway?' questions use the same words", () => {
    assert.equal(
      repsShortfallMessage(2, 3, 82),
      "Your best run was 2 clean reps in a row. You need 3 clean reps in a row at 82+ BPM to progress this chunk. Save anyway?"
    );
    assert.equal(
      repsShortfallMessage(1, 3, null),
      "Your best run was 1 clean rep. You need 3 clean reps in a row to progress this chunk. Save anyway?"
    );
    assert.equal(
      tempoShortfallMessage(3, 70, 82),
      "You logged 3 clean reps in a row at 70 BPM, under the 82+ BPM needed to progress this chunk. Save anyway?"
    );
  });

  test("none of it contains an em dash", () => {
    const all = [requirementLine(3, 82), repsShortfallMessage(2, 3, 82), tempoShortfallMessage(3, 70, 82)].join(" ");
    assert.ok(!all.includes("—"));
  });
});
