// Shared by the Pass 140 tests: runs a whole plan day by day through the REAL
// timeline, ladder and due-list code, the way the app does, with a learner who
// does everything the plan puts on a day and logs every task as a Full pass. Not
// a test file itself (the test glob is test/*.test.mjs).
//
// What it mirrors from App.jsx's `handleLogSession`: the ladder context, the
// call to computeLadderAdvance, tier1DoneAfterSession and the write of the
// review window's latest day. App.jsx's handler is a closure and cannot be
// imported, so this is the one hand-kept copy; if that handler changes, change
// this too (the Pass 138 and 139 tests do the same).
import { generateAllChunks } from "../src/lib/chunking.js";
import { getEffectiveTimeline, withLiveReviewStatus, ladderContextFor, tier1DoneAfterSession, isReviewModelV2 } from "../src/lib/scheduling.js";
import { computeLadderAdvance, withDueByDate, dueBySnapshot } from "../src/lib/ladder.js";
import { computeDueReviews, mergeLiveDueReviews } from "../src/lib/maintenance.js";
import { mergeLadderConfig } from "../src/lib/storage.js";
import { EFFORT_TO_MIN } from "../src/lib/constants.js";
import { addDaysISO } from "../src/lib/utils.js";
import { nextReviewForm, prepareReturn, contextForForm, isReturnDue } from "../src/lib/reviewForms.js";

export const START = "2026-01-01";
export const dateOfDay = (n) => addDaysISO(START, n - 1);

// Difficulty patterns by block of 8 measures (1 Workable, 2 Challenging, 3 Difficult).
export const MIXES = {
  "mostly easy (62/25/12)": [1, 1, 1, 1, 1, 2, 2, 3],
  "balanced (50/25/25)": [1, 1, 2, 3],
  "mostly hard (25/25/50)": [1, 2, 3, 3],
};

export function makePiece({ N, mix, D, scheduleMode = "days", reviewModel = null, practiceDaysPerWeek = 7, minutesPerDay = 30, targetBPM = null }) {
  const pat = MIXES[mix];
  return {
    id: "sim-piece",
    name: "Simulated piece",
    totalMeasures: N,
    measureDifficulty: Array.from({ length: N }, (_, i) => pat[Math.floor(i / 8) % pat.length]),
    chunkMode: "auto",
    customChunkSize: 4,
    recurringMode: "none",
    recurringMeasures: 0,
    recurringPairs: [],
    practiceDaysPerWeek,
    minutesPerDay,
    startDate: START,
    daysToLearn: D,
    scheduleMode,
    targetBPM,
    progress: {},
    ladderConfig: mergeLadderConfig(null),
    ...(reviewModel ? { reviewModel } : {}),
  };
}

// One logged session, as handleLogSession records it for a judged (not skipped,
// not provisional) attempt.
export function logSession(p, chunkSet, chunkId, day, date, { result = "pass", bpm = 60, cleanReps = 5, targetBPM = null, form = null, partnerIds = null } = {}) {
  const progress = { ...p.progress };
  // Pass 141: the form a return was logged in (lib/reviewForms.js, shared with App.jsx).
  const ret = prepareReturn({ onModelTwo: isReviewModelV2(p), chunkId, progress, outcome: result, sentForm: form, sentPartnerIds: partnerIds });
  Object.keys(ret.progress).forEach((id) => {
    if (ret.progress[id] !== progress[id]) progress[id] = ret.progress[id];
  });
  const prev = progress[chunkId] || { doneDays: [] };
  const doneDays = prev.doneDays.includes(day) ? prev.doneDays : [...prev.doneDays, day];
  const effectiveness = result === "fail" ? "low" : result === "pass" ? "high" : "good";
  const ladderSnapshot = {
    stage: prev.stage ?? null,
    consecutivePasses: prev.consecutivePasses ?? 0,
    consecutiveStabilizingFails: prev.consecutiveStabilizingFails ?? 0,
    practiceBPM: prev.practiceBPM ?? null,
    nextDueDate: prev.nextDueDate ?? null,
    tier1Done: prev.tier1Done ?? false,
    needsRelearning: prev.needsRelearning ?? false,
    currentBPM: prev.currentBPM ?? null,
    stabilizingEntryBPM: prev.stabilizingEntryBPM ?? null,
    settlingEntryBPM: prev.settlingEntryBPM ?? null,
    holdingEntryBPM: prev.holdingEntryBPM ?? null,
    tempoRatchetK: prev.tempoRatchetK ?? null,
    holdingReviewCount: prev.holdingReviewCount ?? null,
    ...dueBySnapshot(prev, isReviewModelV2(p)),
  };
  const sessions = [
    ...(prev.sessions || []),
    { day, loggedAt: Date.parse(`${date}T10:00:00`) + (prev.sessions || []).length, loggedDate: date, cleanReps, bpm, outcome: result, durationSeconds: 0, ladderSnapshot, ...ret.formFields },
  ];
  if (!ret.plan.runLadder) {
    progress[chunkId] = { ...prev, doneDays, sessions, flagSnapshot: undefined };
    return { ...p, progress, lastLoggedAt: date };
  }
  const ctx = contextForForm(ladderContextFor(p, chunkSet.practiceChunks.find((c) => c.id === chunkId), prev, date), ret.plan);
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
    { result, effectiveness, asOfDate: date, cleanReps, bpm },
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
  return { ...p, progress, lastLoggedAt: date };
}

// What the app would list for plan day `d`: the timeline as it is today, with the
// stale reviews stripped and the live due list merged in (TodayTab's own steps).
export function dayAsTheAppSeesIt(p, d, chunkSet = generateAllChunks(p)) {
  const date = dateOfDay(d);
  const timeline = withLiveReviewStatus(getEffectiveTimeline(p, chunkSet, { asOfDay: d }), p, d);
  const day = timeline.days[d - 1];
  if (!day) return { timeline, day: null, merged: null };
  const merged = mergeLiveDueReviews(day, computeDueReviews(p, chunkSet, date));
  return { timeline, day, merged };
}

// Runs plan days 1..throughDay. Each practice day the learner does every task on
// the list and logs each as a Full pass. `price` scales what a review costs
// (1 is the app's own price: a review costs what learning the chunk costs).
// Returns the piece after the run and one row per day.
export function runPlan(piece, { throughDay, price = 1, afterDay = null } = {}) {
  let p = piece;
  const rows = [];
  for (let d = 1; d <= throughDay; d++) {
    const chunkSet = generateAllChunks(p);
    const byId = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));
    const { day, merged } = dayAsTheAppSeesIt(p, d, chunkSet);
    if (!day) {
      rows.push({ day: d, type: "past", minutes: 0, tasks: [] });
      continue;
    }
    if (day.type === "consolidation" || day.type === "rest") {
      rows.push({ day: d, type: day.type, minutes: 0, tasks: [] });
      continue;
    }
    const ids = [...new Set([...merged.newChunkIds, ...merged.specialChunkIds, ...merged.reviewChunkIds])];
    const reviewIds = new Set(merged.reviewChunkIds);
    let minutes = 0;
    const date = dateOfDay(d);
    const modelTwo = isReviewModelV2(p);
    for (const id of ids) {
      const isReview = reviewIds.has(id) && !merged.newChunkIds.includes(id) && !merged.specialChunkIds.includes(id);
      // Pass 141: on review model 2 a RETURN (on or after the window's earliest
      // day; the next-day touch is before it) takes a form, priced at its own
      // measures. Every other task is the plain chunk.
      if (modelTwo && isReview && isReturnDue(p.progress[id], date)) {
        const f = nextReviewForm(byId[id], chunkSet, p.progress);
        minutes += f.formChunk.effort * EFFORT_TO_MIN * price;
        p = logSession(p, generateAllChunks(p), id, d, date, { form: f.form, partnerIds: f.partnerIds });
        continue;
      }
      minutes += byId[id].effort * EFFORT_TO_MIN * (isReview ? price : 1);
      p = logSession(p, generateAllChunks(p), id, d, date);
    }
    rows.push({ day: d, type: "learning", minutes, tasks: ids });
    if (afterDay) afterDay(p, d, rows);
  }
  return { piece: p, rows };
}

// How even the daily load was (the coefficient of variation: the spread of the
// days' minutes divided by their mean, the figure the design simulation used)
// and how far the chunks got.
export function measureRun(piece, rows) {
  const practice = rows.filter((r) => r.type === "learning");
  const mins = practice.map((r) => r.minutes);
  const mean = mins.reduce((a, b) => a + b, 0) / (mins.length || 1);
  const sd = Math.sqrt(mins.reduce((a, b) => a + (b - mean) ** 2, 0) / (mins.length || 1));
  const chunks = generateAllChunks(piece).practiceChunks;
  const inHolding = chunks.filter((c) => (piece.progress[c.id] || {}).stage === "holding").length;
  let peakWeek = 0;
  for (let i = 0; i + 7 <= rows.length; i++) peakWeek = Math.max(peakWeek, rows.slice(i, i + 7).reduce((a, r) => a + r.minutes, 0) / 7);
  return { cv: mean ? sd / mean : 0, mean, peakWeekRatio: mean ? peakWeek / mean : 0, holdingShare: chunks.length ? inHolding / chunks.length : 0, hours: mins.reduce((a, b) => a + b, 0) / 60, days: practice.length };
}
