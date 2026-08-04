import { clamp } from "./utils";
import { EFFORT_TO_MIN, REVIEW_OFFSETS, MIN_PRACTICE_DAYS_PER_WEEK, MAX_PRACTICE_DAYS_PER_WEEK } from "./constants";

// Spreads (7 - practiceDaysPerWeek) rest days evenly across every rolling
// 7-day window of the plan, using the same running-accumulator technique
// computeTimeline already uses to spread new-chunk introduction by effort —
// this keeps rest days from clustering instead of landing on a fixed
// weekday, since the plan's day 1 can start on any real weekday. The final
// calendar day is always kept a practice/consolidation day so the user's
// chosen deadline itself is never a forced rest day.
function computeRestDayFlags(totalDays, practiceDaysPerWeek) {
  const days = clamp(Math.round(Number(practiceDaysPerWeek)) || MAX_PRACTICE_DAYS_PER_WEEK, MIN_PRACTICE_DAYS_PER_WEEK, MAX_PRACTICE_DAYS_PER_WEEK);
  const restPerWeek = 7 - days;
  const flags = Array(totalDays).fill(false);
  if (restPerWeek <= 0) return flags;
  let acc = 0;
  for (let i = 0; i < totalDays; i++) {
    acc += restPerWeek;
    if (acc >= 7) {
      flags[i] = true;
      acc -= 7;
    }
  }
  if (totalDays > 0) flags[totalDays - 1] = false;
  return flags;
}

/* ------------------------------------------------------------------ */
/*  Timeline engine                                                    */
/* ------------------------------------------------------------------ */

// Spaced review defaults to [1,3,7,14] days after a chunk is introduced, but
// bends based on the learner's own feedback on their most recent session:
// "needs more work" pulls the next review closer, "too easy" pushes it out.
// This is the first step toward the interval engine adapting on its own.
export function adaptiveReviewOffsets(chunk, progress) {
  const sessions = ((progress || {})[chunk.id] || {}).sessions || [];
  if (!sessions.length) return REVIEW_OFFSETS;
  const last = sessions[sessions.length - 1];
  const factor = last.effectiveness === "low" ? 0.6 : last.effectiveness === "high" ? 1.4 : 1;
  return REVIEW_OFFSETS.map((o) => Math.max(1, Math.round(o * factor)));
}

// Rule: the whole piece gets introduced within the first half of the
// learning days. The back half mixes review, seam transitions, and
// hard-section focus blocks (entered from a different point than the
// original chunk boundary) instead of sitting empty until a final
// run-through.
export function computeTimeline(piece, chunkSet) {
  const { practiceChunks, transitions, combos, all } = chunkSet;
  const totalDays = Math.max(1, Number(piece.daysToLearn) || 1);
  const restFlags = computeRestDayFlags(totalDays, piece.practiceDaysPerWeek);

  // Calendar day numbers (1-based) that are actually available for
  // practice — everything else in this function walks *this* list instead
  // of the raw 1..totalDays range, so rest days never get content placed
  // on them and every "next day"/"spread across" computation automatically
  // skips over them.
  const activeDays = [];
  for (let i = 0; i < totalDays; i++) if (!restFlags[i]) activeDays.push(i + 1);
  if (!activeDays.length) activeDays.push(totalDays);

  const consolidationDays = activeDays.length >= 5 ? 1 : 0;
  const consolidationDay = consolidationDays ? activeDays[activeDays.length - 1] : null;
  const learningDaysCalendar = consolidationDays ? activeDays.slice(0, -1) : activeDays;
  const learningDays = learningDaysCalendar[learningDaysCalendar.length - 1];

  const days = Array.from({ length: totalDays }, (_, i) => ({
    dayNumber: i + 1,
    type: restFlags[i] ? "rest" : i + 1 === consolidationDay ? "consolidation" : "learning",
    newChunkIds: [],
    specialChunkIds: [],
    reviewChunkIds: [],
    minutes: 0,
  }));

  const introducedDay = {};

  const halfPointCount = Math.max(1, Math.min(learningDaysCalendar.length, Math.ceil(learningDaysCalendar.length * 0.5)));
  const halfPoint = learningDaysCalendar[halfPointCount - 1];
  const frontDays = learningDaysCalendar.slice(0, halfPointCount);
  const backDays = learningDaysCalendar.slice(halfPointCount);

  // Snaps a raw calendar-day offset forward to the next actual practice
  // day, capping at `learningDays` (the last day before consolidation) —
  // used for transitions/combos, which should still happen even if their
  // "ideal" day landed on a rest day, just as soon as possible after.
  const snapCapped = (rawDay) => {
    for (const d of learningDaysCalendar) if (d >= rawDay) return d;
    return learningDays;
  };
  // Same snap, but drops the item entirely (returns null) once past the
  // learning window, rather than clamping — matches the original "reviews
  // past the plan's end just don't happen" behavior.
  const snapOrDrop = (rawDay) => {
    for (const d of learningDaysCalendar) if (d >= rawDay) return d;
    return null;
  };

  // Spread new-chunk introduction evenly across the front-half *practice*
  // days (by total effort / halfPointCount) instead of greedily filling
  // each day to piece.minutesPerDay and moving on. Filling-to-budget tends
  // to finish early, cramming most of the piece into just the first few
  // days — which then makes their transitions and spaced reviews all land
  // on the same handful of later days too. Spreading introduction itself
  // out is what actually prevents that pile-up; it's still fully
  // introduced by halfPoint.
  const totalNewEffort = practiceChunks.reduce((s, c) => s + c.effort, 0);
  const perDayNewTarget = totalNewEffort / frontDays.length;
  let dayIdx = 0;
  let acc = 0;
  practiceChunks.forEach((chunk) => {
    if (acc + chunk.effort > perDayNewTarget && acc > 0 && dayIdx < frontDays.length - 1) {
      dayIdx++;
      acc = 0;
    }
    const day = frontDays[dayIdx];
    days[day - 1].newChunkIds.push(chunk.id);
    introducedDay[chunk.id] = day;
    acc += chunk.effort;
  });
  const sectionsEndDay = halfPoint;

  transitions.forEach((t) => {
    const readyDay = Math.max(
      introducedDay[t.linkedIds[0]] || sectionsEndDay,
      introducedDay[t.linkedIds[1]] || sectionsEndDay
    );
    const day = snapCapped(readyDay + 1);
    days[day - 1].specialChunkIds.push(t.id);
    introducedDay[t.id] = day;
  });

  combos.forEach((c, i) => {
    const readyDay = introducedDay[c.linkedIds[0]] || sectionsEndDay;
    const earliest = snapCapped(Math.max(sectionsEndDay + 1, readyDay + 1));
    const pool = backDays.length ? backDays.filter((d) => d >= earliest) : [];
    const candidates = pool.length ? pool : [learningDays];
    const day = candidates[i % candidates.length];
    days[day - 1].specialChunkIds.push(c.id);
    introducedDay[c.id] = day;
  });

  const chunkById = Object.fromEntries(all.map((c) => [c.id, c]));
  const minutesFor = (d) => {
    const newMin = d.newChunkIds.reduce((s, id) => s + chunkById[id].effort * EFFORT_TO_MIN, 0);
    const specialMin = d.specialChunkIds.reduce((s, id) => s + chunkById[id].effort * EFFORT_TO_MIN, 0);
    const reviewMin = d.reviewChunkIds.length * 3;
    return newMin + specialMin + reviewMin;
  };

  // Place each spaced-review instance at its normal 1/3/7/14-day (adaptive)
  // offset — snapped forward off any rest day it happens to land on — then
  // nudge individual instances up to 2 calendar days earlier/later (again
  // only ever landing on an actual practice day) if that meaningfully
  // flattens a day sitting well above the plan's average load. This keeps
  // reviews close to their intended spacing while stopping every review
  // triggered by one heavy introduction day from all landing on the exact
  // same later days.
  const learningDaySet = new Set(learningDaysCalendar);
  const reviewItems = [];
  all.forEach((chunk) => {
    const start = introducedDay[chunk.id];
    if (!start) return;
    adaptiveReviewOffsets(chunk, piece.progress).forEach((off) => {
      const day = snapOrDrop(start + off);
      if (day != null) reviewItems.push({ chunkId: chunk.id, minDay: start + 1, day });
    });
  });
  reviewItems.forEach((item) => days[item.day - 1].reviewChunkIds.push(item.chunkId));

  const learningDayList = days.filter((d) => d.type === "learning");
  const avgLoad = learningDayList.length
    ? learningDayList.reduce((s, d) => s + minutesFor(d), 0) / learningDayList.length
    : 0;

  for (let pass = 0; pass < 3; pass++) {
    let movedAny = false;
    reviewItems
      .map((_, idx) => idx)
      .sort((a, b) => minutesFor(days[reviewItems[b].day - 1]) - minutesFor(days[reviewItems[a].day - 1]))
      .forEach((idx) => {
        const item = reviewItems[idx];
        const currentMinutes = minutesFor(days[item.day - 1]);
        if (currentMinutes <= avgLoad * 1.1) return;
        const candidates = [item.day - 2, item.day - 1, item.day + 1, item.day + 2].filter(
          (d) => d >= item.minDay && learningDaySet.has(d) && !days[d - 1].reviewChunkIds.includes(item.chunkId)
        );
        if (!candidates.length) return;
        const best = candidates.reduce((a, b) => (minutesFor(days[b - 1]) < minutesFor(days[a - 1]) ? b : a));
        if (minutesFor(days[best - 1]) + 6 < currentMinutes) {
          days[item.day - 1].reviewChunkIds.splice(days[item.day - 1].reviewChunkIds.indexOf(item.chunkId), 1);
          days[best - 1].reviewChunkIds.push(item.chunkId);
          item.day = best;
          movedAny = true;
        }
      });
    if (!movedAny) break;
  }

  if (consolidationDays) {
    days[consolidationDay - 1].reviewChunkIds = practiceChunks.map((c) => c.id);
  }

  days.forEach((d) => {
    d.minutes = d.type === "consolidation" ? Number(piece.minutesPerDay || 30) : d.type === "rest" ? 0 : Math.round(minutesFor(d));
  });

  return { days, learningDays, consolidationDays, halfPoint, introducedDay };
}

export function getEffectiveTimeline(piece, chunkSet) {
  const marker = piece.rescheduleMarker;
  if (!marker) return computeTimeline(piece, chunkSet);

  const original = computeTimeline(piece, chunkSet);
  const { practiceChunks, transitions, combos } = chunkSet;
  const chunkById = Object.fromEntries(practiceChunks.map((c) => [c.id, c]));
  const remainingChunks = marker.remainingChunkOrder.map((id) => chunkById[id]).filter(Boolean);
  const remainingIds = new Set(remainingChunks.map((c) => c.id));
  const remainingTransitions = transitions.filter((t) => t.linkedIds.some((id) => remainingIds.has(id)));
  const remainingCombos = combos.filter((c) => remainingIds.has(c.linkedIds[0]));

  const asOfDay = clamp(marker.asOfDay, 1, original.days.length);
  const remainingDayCount = Math.max(1, original.days.length - asOfDay + 1);
  const subPiece = { ...piece, daysToLearn: remainingDayCount };
  const subChunkSet = {
    practiceChunks: remainingChunks,
    transitions: remainingTransitions,
    combos: remainingCombos,
    all: [...remainingChunks, ...remainingTransitions, ...remainingCombos],
  };
  const sub = computeTimeline(subPiece, subChunkSet);

  const mergedDays = [
    ...original.days.slice(0, asOfDay - 1),
    ...sub.days.map((d, i) => ({ ...d, dayNumber: asOfDay + i })),
  ];

  return {
    days: mergedDays,
    learningDays: asOfDay - 1 + sub.learningDays,
    consolidationDays: sub.consolidationDays,
    halfPoint: sub.halfPoint,
    introducedDay: { ...original.introducedDay, ...sub.introducedDay },
  };
}

// A chunk only counts as "missed" once its scheduled day has actually passed
// and it still has zero logged sessions — not simply because it hasn't been
// checked off yet today, and not from a same-day confidence dip.
//
// A paused or archived piece never reports missed chunks: pausing is
// specifically meant to stop the schedule from judging a plan the learner
// has deliberately stepped away from (confidence itself keeps decaying via
// the usual recency math in computeAutoConfidence — only this "behind
// schedule" flag is suppressed). remainingChunkIds is still computed either
// way since it's also used to feed rescheduling once the piece is active
// again.
export function computeScheduleStatus(piece, practiceChunks, timeline, currentDay) {
  const remainingChunkIds = [];
  let missedCount = 0;
  const scheduleActive = (piece.status || "active") === "active";
  practiceChunks.forEach((c) => {
    const touched = ((piece.progress[c.id] || {}).doneDays || []).length > 0;
    if (touched) return;
    remainingChunkIds.push(c.id);
    if (!scheduleActive) return;
    const introducedOn = timeline.introducedDay[c.id];
    if (introducedOn && introducedOn < currentDay) missedCount++;
  });
  return { missedCount, remainingChunkIds };
}
