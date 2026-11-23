// Pass 143 — how many days a "minutes per day" plan needs, for a piece on review
// model 2 (docs/Algorithms.md#review-model-v2-planned, "Minutes plans").
//
// The rule this replaces (`computeDaysNeededForMinutesPerDay`, lib/scheduling.js,
// still used for a piece on today's plan) packs every chunk, join and focus block
// into days at three times its price (the learning and "two reviews") and ignores
// what the new ladder really asks for. For a piece on model 2 it was measured to
// give the SAME length at 30 and at 60 minutes a day (each join and focus block
// cost more than the budget on its own), and a plan far heavier than the budget.
//
// What this does instead is what the card asked for: PLAY THE PLAN FORWARD with the
// real code. A simulated learner does every task the real timeline lists for each
// day and logs each as a Full pass, through the real ladder, windows, forms and
// due list, until every chunk is in Holding. The plan is long enough when the
// AVERAGE time of those practice days is no more than the budget. A search finds
// the shortest such length. Nothing here is a second formula for how long a chunk
// takes: it reads the schedule's own price (`effort * EFFORT_TO_MIN`, and
// `runThroughPrice` for a run-through), so a change to that price (a different
// EFFORT_TO_MIN, a later pass) moves every length by itself at the next load.
//
// Rules this file keeps (each has a test):
//  - It is a pure function of the piece's STRUCTURE (measures, difficulty, chunking,
//    practice days a week, the budget, the run time, the ladder settings). It never
//    reads the clock, the piece's progress, its start date or its reschedule marker:
//    daysToLearn is re-derived on every load, so a value that depended on today's
//    date or on what was logged would move every time the app opened.
//  - The learner is simplified on purpose: every attempt is a Full pass, at a
//    constant tempo (no target tempo is simulated, so there are no strong passes).
//    A real learner is slower, so this is the SHORTEST the plan could be.
//  - It never throws into a page load: any failure falls back to today's rule.
import { generateAllChunks } from "./chunking";
import {
  getEffectiveTimeline,
  withLiveReviewStatus,
  ladderContextFor,
  tier1DoneAfterSession,
  isReviewModelV2,
  reconcileMinutesPerDaySchedule,
} from "./scheduling";
import { computeLadderAdvance, withDueByDate, isPieceLearned } from "./ladder";
import { computeDueReviews, mergeLiveDueReviews } from "./maintenance";
import { nextReviewForm, prepareReturn, contextForForm, isReturnDue } from "./reviewForms";
import { EFFORT_TO_MIN } from "./constants";
import { addDaysISO } from "./utils";

// The longest plan this derives: six months (the owner's limit, 2026-11-22). A piece
// whose budget cannot be met inside it gets this length and `fits: false`, and
// Settings says so in plain words. The reschedule-extend floor (reconcile, below)
// is not held to it: a reschedule may push a plan past six months on purpose.
export const MAX_MINUTES_PLAN_DAYS = 183;
// The shortest plan the search tries (the scheduler wants five practice days or so
// before it adds a final run-through day).
export const MIN_MINUTES_PLAN_DAYS = 7;

// A fixed calendar for the simulation. Only the gaps between dates matter, so any
// start does; it is never the piece's own start date (see "never reads the clock").
const SIM_START = "2000-01-03";

// What the simulation reads from the piece, and nothing else. Anything the timeline
// or the ladder reads is listed here or set below; a field that is not here cannot
// change a length (a name, notes, recordings, the piece's own progress).
const STRUCTURE_FIELDS = [
  "totalMeasures",
  "measureDifficulty",
  "chunkMode",
  "customChunkSize",
  "recurringMode",
  "recurringMeasures",
  "recurringPairs",
  "chunkSplitPoints",
  "sections",
  "practiceDaysPerWeek",
  "minutesPerDay",
  "typicalRunSeconds",
  "ladderConfig",
];

export function planStructureOf(piece) {
  const out = {};
  STRUCTURE_FIELDS.forEach((k) => {
    if (piece[k] !== undefined) out[k] = piece[k];
  });
  return out;
}

function simulationPiece(structure, days) {
  return {
    id: "minutes-plan-simulation",
    ...structure,
    startDate: SIM_START,
    daysToLearn: days,
    scheduleMode: "minutes",
    targetBPM: null,
    progress: {},
    reviewModel: 2,
    status: "active",
  };
}

// One logged Full pass, the way App.jsx's handleLogSession records a judged attempt
// (the same real functions; test/review-sim-helper.mjs keeps the other hand-kept
// copy, and a test compares the two, so a change to handleLogSession is changed in
// three places or that test fails). No undo snapshot: the simulation never undoes.
function logFullPass(p, chunkSet, chunkId, day, date, form, partnerIds) {
  const result = "pass";
  const bpm = 60;
  const cleanReps = 5;
  const progress = { ...p.progress };
  const ret = prepareReturn({ onModelTwo: true, chunkId, progress, outcome: result, sentForm: form, sentPartnerIds: partnerIds });
  Object.keys(ret.progress).forEach((id) => {
    if (ret.progress[id] !== progress[id]) progress[id] = ret.progress[id];
  });
  const prev = progress[chunkId] || { doneDays: [] };
  const doneDays = prev.doneDays.includes(day) ? prev.doneDays : [...prev.doneDays, day];
  const sessions = [
    ...(prev.sessions || []),
    { day, loggedAt: Date.parse(`${date}T10:00:00`) + (prev.sessions || []).length, loggedDate: date, cleanReps, bpm, outcome: result, durationSeconds: 0, ...ret.formFields },
  ];
  if (!ret.plan.runLadder) {
    progress[chunkId] = { ...prev, doneDays, sessions, flagSnapshot: undefined };
    return { ...p, progress };
  }
  const ctx = contextForForm(ladderContextFor(p, chunkSet.practiceChunks.find((c) => c.id === chunkId), prev, date), ret.plan);
  const advance = computeLadderAdvance(
    {
      stage: prev.stage,
      consecutivePasses: prev.consecutivePasses,
      consecutiveStabilizingFails: prev.consecutiveStabilizingFails,
      practiceBPM: prev.practiceBPM != null ? prev.practiceBPM : bpm,
      targetBPM: null,
      tier1Done: prev.tier1Done,
      needsRelearning: prev.needsRelearning,
      suggestedStartingBPM: null,
      stabilizingEntryBPM: prev.stabilizingEntryBPM,
      settlingEntryBPM: prev.settlingEntryBPM,
      holdingEntryBPM: prev.holdingEntryBPM,
      tempoRatchetK: prev.tempoRatchetK,
      holdingReviewCount: prev.holdingReviewCount,
    },
    { result, effectiveness: "high", asOfDate: date, cleanReps, bpm },
    p.ladderConfig,
    ctx
  );
  const entry = {
    ...prev,
    doneDays,
    sessions,
    currentBPM: bpm,
    stage: advance.stage,
    consecutivePasses: advance.consecutivePasses,
    consecutiveStabilizingFails: advance.consecutiveStabilizingFails,
    practiceBPM: advance.practiceBPM,
    nextDueDate: advance.nextDueDate,
    tier1Done: tier1DoneAfterSession(p, prev, advance.tier1Done, date),
    needsRelearning: advance.needsRelearning,
    stabilizingEntryBPM: advance.stabilizingEntryBPM,
    settlingEntryBPM: advance.settlingEntryBPM,
    holdingEntryBPM: advance.holdingEntryBPM,
    tempoRatchetK: advance.tempoRatchetK,
    holdingReviewCount: advance.holdingReviewCount,
    flagSnapshot: undefined,
  };
  progress[chunkId] = withDueByDate(entry, advance.dueByDate || null);
  return { ...p, progress };
}

// Plays a plan of `days` calendar days forward until every chunk is in Holding.
// Returns the minutes of each PRACTICE day played (rest days and the final
// run-through day are not practice days here), the same days as rows
// ({ day, minutes, runThroughMinutes }, for the tests that compare them with
// test/review-sim-helper.mjs) and the day the last chunk reached Holding (null
// when it never did within `days`).
export function playMinutesPlan(structure, days) {
  let p = simulationPiece(structure, days);
  const minutes = [];
  const rows = [];
  let learnedDay = null;
  for (let d = 1; d <= days && learnedDay == null; d++) {
    // The chunk grid never depends on what has been logged, so it is made once a day.
    const chunkSet = generateAllChunks(p);
    const byId = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));
    const date = addDaysISO(SIM_START, d - 1);
    // What the app lists for this day: the timeline, stale reviews stripped, the live
    // due list merged in (TodayTab's own steps, as test/review-sim-helper.mjs does).
    const timeline = withLiveReviewStatus(getEffectiveTimeline(p, chunkSet, { asOfDay: d }), p, d);
    const day = timeline.days[d - 1];
    if (!day || day.type !== "learning") continue;
    const merged = mergeLiveDueReviews(day, computeDueReviews(p, chunkSet, date));
    const ids = [...new Set([...merged.newChunkIds, ...merged.specialChunkIds, ...merged.reviewChunkIds])];
    const reviewIds = new Set(merged.reviewChunkIds);
    // A run-through placed on the day is time on the day (Pass 142); it is not a task
    // and logs nothing against a chunk.
    const runThroughMinutes = day.runThroughMinutes || 0;
    let total = runThroughMinutes;
    for (const id of ids) {
      const isReview = reviewIds.has(id) && !merged.newChunkIds.includes(id) && !merged.specialChunkIds.includes(id);
      if (isReview && isReturnDue(p.progress[id], date)) {
        // A return takes a form and is priced at that form's own measures (Pass 141).
        const f = nextReviewForm(byId[id], chunkSet, p.progress);
        total += f.formChunk.effort * EFFORT_TO_MIN;
        p = logFullPass(p, chunkSet, id, d, date, f.form, f.partnerIds);
        continue;
      }
      total += byId[id].effort * EFFORT_TO_MIN;
      p = logFullPass(p, chunkSet, id, d, date, null, null);
    }
    minutes.push(total);
    rows.push({ day: d, minutes: total, runThroughMinutes });
    if (isPieceLearned(p, chunkSet)) learnedDay = d;
  }
  return { minutes, rows, learnedDay };
}

const average = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

// Does a plan of `days` fit the budget? Learned inside the plan, and the average
// practice day (from day 1 to the day the last chunk reached Holding) no more than
// the budget. What happens after the piece is learned is maintenance, shown as due
// reviews, and does not set the length.
function fitsAt(structure, budget, days) {
  const { minutes, learnedDay } = playMinutesPlan(structure, days);
  return learnedDay != null && average(minutes) <= budget;
}

// How the search finds the length: a bisection between the shortest plan tried and six
// months. Whether a plan "fits" is NOT smooth in its length: near the shortest the
// ladder can finish, a longer plan sometimes fails where a shorter one fits (the last
// chunk reaches Holding a day after the plan's end, then a day before; measured on a
// 60-measure piece: fits at 96 days, not at 99, 100, 101, 104, ...). So the answer is
// "a length that fits, and the day before does not", not "the shortest that ever
// fits", and a few lengths above it may not fit. A weekly walk down from six months
// was tried and was no steadier as the budget changed (measured on 22 budgets), so it
// was not kept. The top of the range tries the last few days, so one unlucky day
// cannot read as "does not fit in six months". `fits` is a parameter so a test can
// check the search on its own, without the simulation.
const TOP_DAYS_TRIED = [MAX_MINUTES_PLAN_DAYS, MAX_MINUTES_PLAN_DAYS - 3, MAX_MINUTES_PLAN_DAYS - 6];

export function searchMinutesPlan(structure, budget, fits = fitsAt) {
  let hi = null;
  for (const d of TOP_DAYS_TRIED) {
    if (fits(structure, budget, d)) {
      hi = d;
      break;
    }
  }
  if (hi == null) return { days: MAX_MINUTES_PLAN_DAYS, fits: false };
  let lo = MIN_MINUTES_PLAN_DAYS - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(structure, budget, mid)) hi = mid;
    else lo = mid;
  }
  return { days: hi, fits: true };
}

const CACHE_LIMIT = 64;
const planCache = new Map();

// For the tests only: the memory above would hide a change of behavior between two calls.
export function clearMinutesPlanCache() {
  planCache.clear();
}

// { days, fits } for a piece on review model 2 planned by minutes per day. `fits` is
// false when even MAX_MINUTES_PLAN_DAYS cannot meet the budget (days is then the
// maximum). Remembered per structure: a search is about nine simulated plans, and
// this runs on every load and every time Settings re-reads the schedule.
export function modelTwoMinutesPlan(piece) {
  const structure = planStructureOf(piece);
  const budget = Math.max(5, Number(piece.minutesPerDay) || 30);
  const key = JSON.stringify(structure);
  const hit = planCache.get(key);
  if (hit) return hit;
  const result = searchMinutesPlan(structure, budget);
  if (planCache.size >= CACHE_LIMIT) planCache.delete(planCache.keys().next().value);
  planCache.set(key, Object.freeze(result));
  return result;
}

// The one function every load path calls in place of
// scheduling.js's reconcileMinutesPerDaySchedule (storage.js's validateAndMigratePiece
// and pieceMerge.js): a piece on today's plan, or planned by days, goes straight to
// it and is untouched; a piece on model 2 planned by minutes gets the plan-forward
// count. The reschedule-marker floor is that function's, applied to either.
// `plan` is the day count itself; a test passes one that fails to prove the fallback
// (lib/accountSync.js's planSettle takes a `build` for the same reason).
export function reconcileMinutesPlan(piece, plan = modelTwoMinutesPlan) {
  if (piece.scheduleMode !== "minutes" || !isReviewModelV2(piece)) return reconcileMinutesPerDaySchedule(piece);
  let days;
  try {
    days = plan(piece).days;
  } catch (err) {
    // Never break a page load: today's rule is what every piece had before.
    if (typeof console !== "undefined") console.warn("Minutes plan: could not play the plan forward, using the earlier rule.", err);
    return reconcileMinutesPerDaySchedule(piece);
  }
  return reconcileMinutesPerDaySchedule(piece, days);
}
