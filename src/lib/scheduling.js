import { clamp, daysBetweenInclusive, addDaysISO, todayISODate, elapsedDay, getCurrentDay } from "./utils";
import { EFFORT_TO_MIN, LIBERAL_FACTOR, REVIEW_OFFSETS, MIN_PRACTICE_DAYS_PER_WEEK, MAX_PRACTICE_DAYS_PER_WEEK } from "./constants";
import { generateAllChunks } from "./chunking";
import { sessionOutcome } from "./confidence";
import { isInRevival } from "./revival";

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
/*  Fixed-budget day count (scheduleMode: "minutes")                   */
/* ------------------------------------------------------------------ */

// Given a fixed minutes-per-day budget, how many calendar days does this
// plan need so no day's worth of chunks/transitions/combos is greedily
// packed past that budget? The mirror image of "days" scheduleMode, where
// daysToLearn is the fixed input and minutesPerDay is derived from it — here
// minutesPerDay is fixed and daysToLearn is what must flex to fit it.
export function computeDaysNeededForMinutesPerDay(chunkSet, minutesPerDay, practiceDaysPerWeek) {
  const minutes = Math.max(5, Number(minutesPerDay) || 30);
  const dayBudget = (minutes * 0.65) / EFFORT_TO_MIN;
  // Every introduced item also costs some spaced-review load later at a
  // flat 3 minutes per touch (see computeTimeline's minutesFor) — effort
  // alone (the raw introduction cost) undercounts what a day actually ends
  // up costing once review load lands on top of it. Folding an estimate of
  // that in here, converted to the same effort-point units as everything
  // else in this budget, is what keeps this estimate from landing on a day
  // count that's technically "enough" for introduction alone but still
  // runs well over budget once review is added.
  //
  // Budgets for 2 touches per item, not REVIEW_OFFSETS.length (4) — that
  // fixed four-touch assumption predates the ladder scheduler
  // (computeTimeline no longer places a guaranteed fixed number of
  // reviews per item; each recompute shows at most one upcoming review per
  // chunk, driven by its live ladder due-date, not a schedule fixed at
  // introduction time — confirmed stale by Codex review). 2 is a
  // deliberately rough, conservative stand-in for "at least the first
  // couple of ladder touches a chunk will pick up during a normal plan" —
  // not a precise count, since that actually depends on how the plan gets
  // used (how many times a chunk is logged, how it performs), which this
  // function has no visibility into. Same "known limitation, not a hard
  // cap" spirit as the rest of this estimate — see the comment below.
  const reviewEffortPerItem = (2 * 3) / EFFORT_TO_MIN;
  let learningDaysNeeded = 1;
  let acc = 0;
  chunkSet.all.forEach((c) => {
    const itemEffort = c.effort + reviewEffortPerItem;
    if (acc + itemEffort > dayBudget && acc > 0) {
      learningDaysNeeded++;
      acc = 0;
    }
    acc += itemEffort;
  });
  const practiceDaysNeeded = Math.max(1, Math.ceil((learningDaysNeeded / 0.88) * LIBERAL_FACTOR));
  const days = clamp(Math.round(Number(practiceDaysPerWeek)) || MAX_PRACTICE_DAYS_PER_WEEK, MIN_PRACTICE_DAYS_PER_WEEK, MAX_PRACTICE_DAYS_PER_WEEK);
  return Math.max(1, Math.ceil((practiceDaysNeeded * 7) / days));
}

// Keeps piece.daysToLearn honest against piece.minutesPerDay for a
// scheduleMode: "minutes" piece. ScheduleFields already performs this same
// reconciliation live, as a side effect of the Schedule panel being mounted
// — but that means it only ever runs while a human has that panel open. A
// piece arriving any other way (loaded from storage, imported from a
// backup, merged with an existing piece on re-import) never passes through
// that component, so a stale or simply-wrong daysToLearn — e.g. a backup
// hand-edited to change minutesPerDay without touching daysToLearn to match
// — was silently kept as-is, and computeTimeline would cram the piece's
// full effort into however many days that stale value said, regardless of
// whether that fit the stated per-day budget. Calling this from
// storage.js's load path and from the import merge in App.jsx closes that
// gap without duplicating the derivation itself. "days" scheduleMode is
// left untouched here — daysToLearn is the fixed input in that mode.
export function reconcileMinutesPerDaySchedule(piece) {
  if (piece.scheduleMode !== "minutes") return piece;
  const chunkSet = generateAllChunks(piece);
  const needed = computeDaysNeededForMinutesPerDay(chunkSet, piece.minutesPerDay, piece.practiceDaysPerWeek);
  return needed === piece.daysToLearn ? piece : { ...piece, daysToLearn: needed };
}

/* ------------------------------------------------------------------ */
/*  Timeline engine                                                    */
/* ------------------------------------------------------------------ */

// Spaced review defaults to [1,3,7,14] days after a chunk is introduced, but
// bends based on the outcome of the most recent logged session: a real fail
// pulls the next review closer, a full pass pushes it out. Was keyed off the
// old free-standing "how did it feel" self-report (low/good/high); now reads
// the objective pass/soft-miss/fail outcome instead (sessionOutcome() also
// covers sessions logged before that change). This is the first step toward
// the interval engine adapting on its own.
export function adaptiveReviewOffsets(chunk, progress) {
  const sessions = ((progress || {})[chunk.id] || {}).sessions || [];
  if (!sessions.length) return REVIEW_OFFSETS;
  const outcome = sessionOutcome(sessions[sessions.length - 1]);
  const factor = outcome === "fail" ? 0.6 : outcome === "pass" ? 1.4 : 1;
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

  // Tier 1 / Tier 2 review placement — Repertoire-Lifecycle.md's
  // "Introduction-window review scheduling: Tier 1 / Tier 2". Replaces the
  // old fixed REVIEW_OFFSETS/adaptiveReviewOffsets placement: each chunk's
  // *next* review is now driven by the maintenance ladder
  // (computeLadderAdvance, lib/ladder.js) instead of a fixed 1/3/7/14-day
  // schedule computed once at introduction, so at most one upcoming review
  // per chunk comes out of a given recompute (the ladder only ever knows
  // its *next* due date, not a whole future schedule) — this function is
  // already rerun on every piece change (see Architecture.md), so that's
  // sufficient to keep it current as sessions get logged.
  const learningDaySet = new Set(learningDaysCalendar);

  // Tier 1 — a one-time, near-mandatory first-touch review for a chunk
  // that's genuinely never been logged (ChunkProgress.stage still null —
  // Data-Model.md — AND no session history at all). Placed immediately
  // after introduction (day + 1), snapped forward off a rest day via
  // snapCapped, which — unlike snapOrDrop below — clamps into the plan
  // rather than dropping, so Tier 1 always lands somewhere. Deliberately
  // NOT part of the smoothing pass below: per the design, Tier 1 is where
  // schedule pressure does *not* get absorbed, so once placed it never
  // moves, unlike Tier 2.
  //
  // stage:null alone is NOT enough to mean "never touched": migration
  // (backfillProgressLadderState, storage.js) sets stage:null on every
  // pre-existing progress entry that predates the ladder, including a
  // chunk with a long, real session history logged before this feature
  // existed. Without the sessions-history check, a heavily-practiced
  // legacy chunk would be told to do a "first touch" review as if it had
  // never been played — confirmed as a real bug (Codex review) on any
  // already-in-use piece the first time this scheduling model runs. A
  // chunk in that state simply gets no review placed until it's next
  // logged, at which point handleLogSession (App.jsx) gives it real
  // ladder state and it starts taking the Tier 2 path below like any
  // other chunk on the ladder.
  all.forEach((chunk) => {
    const start = introducedDay[chunk.id];
    if (!start) return;
    const entry = piece.progress[chunk.id] || {};
    const everLogged = entry.stage != null || (entry.sessions && entry.sessions.length > 0);
    if (everLogged) return;
    const day = snapCapped(start + 1);
    days[day - 1].reviewChunkIds.push(chunk.id);
  });

  // Tier 2 — the standard ladder cadence for a chunk already on the ladder
  // (at least one session logged, so ChunkProgress.nextDueDate is set by
  // computeLadderAdvance/handleLogSession — App.jsx). nextDueDate is a
  // real calendar date, not a plan-day int — converted to a day number
  // here via piece.startDate rather than trusted as one, since a
  // Holding-stage interval (8–12 weeks) routinely lands well past this
  // plan's daysToLearn. A due date beyond this plan's own days[] simply
  // isn't placed here at all (snapOrDrop returns null, dropping it from
  // *this* bounded view only, same as it always has for reviews past the
  // plan's end) — surfacing it is a live "what's due" query outside
  // timeline.days[]'s fixed length, not built here (see
  // Repertoire-Lifecycle.md's "Explicitly not designed/built here").
  // Allowed to flex under budget pressure — included in the smoothing
  // pass below (adapted from the mechanism previously used for
  // REVIEW_OFFSETS-based items, but forward-only here — see the comment
  // on its candidates array), nudging up to 2 calendar days *later* (only
  // ever onto an actual practice day) if that meaningfully flattens a day
  // sitting well above the plan's average load. A review nudged later is
  // exactly the "rolls to the next day under budget contention, no
  // penalty" the design calls for — it never becomes a missed review (see
  // computeScheduleStatus below, which only ever judges a chunk's
  // *introduction*, never a review's timing).
  const tier2Items = [];
  all.forEach((chunk) => {
    const start = introducedDay[chunk.id];
    if (!start) return;
    const entry = piece.progress[chunk.id] || {};
    if (entry.stage == null || !entry.nextDueDate) return;
    // Rule 1 (Decisions.md#spaced-repetition--maintenance): re-learning
    // replaces review, never runs alongside it — a flagged chunk produces
    // zero due reviews here, full stop, regardless of what nextDueDate
    // happens to hold.
    if (entry.needsRelearning) return;
    const rawDay = daysBetweenInclusive(piece.startDate, entry.nextDueDate);
    if (rawDay == null) return;
    const day = snapOrDrop(Math.max(rawDay, start + 1));
    if (day != null) tier2Items.push({ chunkId: chunk.id, minDay: start + 1, day });
  });
  tier2Items.forEach((item) => days[item.day - 1].reviewChunkIds.push(item.chunkId));

  const learningDayList = days.filter((d) => d.type === "learning");
  const avgLoad = learningDayList.length
    ? learningDayList.reduce((s, d) => s + minutesFor(d), 0) / learningDayList.length
    : 0;

  for (let pass = 0; pass < 3; pass++) {
    let movedAny = false;
    tier2Items
      .map((_, idx) => idx)
      .sort((a, b) => minutesFor(days[tier2Items[b].day - 1]) - minutesFor(days[tier2Items[a].day - 1]))
      .forEach((idx) => {
        const item = tier2Items[idx];
        const currentMinutes = minutesFor(days[item.day - 1]);
        if (currentMinutes <= avgLoad * 1.1) return;
        // Forward-only, unlike the REVIEW_OFFSETS-era version of this pass
        // (which nudged ±1/±2 days, since it was smoothing a fixed schedule
        // computed once, with no notion of a review being "due" on a
        // specific date). Tier 2's due date is a real ladder date — nudging
        // it *earlier* than that isn't "smoothing," it's reviewing before
        // it's actually due, which the design frames specifically as
        // "rolls to the next day under budget contention" (Repertoire-
        // Lifecycle.md), not bidirectional flex.
        const candidates = [item.day + 1, item.day + 2].filter(
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
  // Tier 2 placement inside the nested computeTimeline call below converts
  // each chunk's nextDueDate (a real calendar date) into a plan-day-int
  // relative to *that* call's own day 1 — which, for this rescheduled
  // remainder, is asOfDay's calendar date, not the original plan's day 1.
  // Without this override, subPiece would keep the original piece.startDate
  // while sub.days[] is only remainingDayCount long, so a nextDueDate
  // computed against the wrong (too-early) day-1 anchor would resolve to a
  // day number far past sub.days[]'s actual bounds and get silently
  // dropped by snapOrDrop — not a crash, but a real review quietly
  // vanishing from the rescheduled plan.
  const originalStartDate = piece.startDate || todayISODate();
  const subPiece = { ...piece, daysToLearn: remainingDayCount, startDate: addDaysISO(originalStartDate, asOfDay - 1) };
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

  // `sub` is a whole plan in its own right: its day numbers restart at 1,
  // where 1 means asOfDay. `mergedDays` above already re-bases them;
  // introducedDay has to be re-based by the same offset or it reports
  // sub-plan numbers as if they were absolute plan days.
  //
  // Getting this wrong is not cosmetic — computeScheduleStatus (the only
  // external reader) counts a chunk as behind when
  // `introducedDay[id] < currentDay`. Un-shifted, every rescheduled chunk
  // looks like it was introduced on day 1-2-3 while currentDay is asOfDay
  // or later, so all of them stay "behind schedule" and the banner never
  // clears — making the Reschedule button look like it did nothing, even
  // though the marker saved and the plan really was rebalanced.
  const shiftedIntroducedDay = Object.fromEntries(
    Object.entries(sub.introducedDay).map(([id, day]) => [id, asOfDay + day - 1])
  );

  return {
    days: mergedDays,
    learningDays: asOfDay - 1 + sub.learningDays,
    consolidationDays: sub.consolidationDays,
    halfPoint: sub.halfPoint,
    // Chunks not in the rescheduled remainder (already practiced) keep
    // their original introduction day; only the re-placed ones shift.
    introducedDay: { ...original.introducedDay, ...shiftedIntroducedDay },
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

// "Reschedule all" (Pass 21) — the multi-piece form of what the per-piece
// Reschedule button has always done. Answers, for a whole pieces map:
// which pieces are behind schedule *right now*, and what rescheduleMarker
// should each of them get?
//
// Pure and side-effect free, exactly like computeScheduleStatus above: it
// only reports the markers, it never writes them. App.jsx puts the result
// behind one confirmation and then persists it. Keeping the selection rule
// here rather than in the click handler is what makes it testable at all
// (the test suite is lib-level only — CLAUDE.md).
//
// A piece is included only when every one of these holds:
//   * status is "active" — paused/archived pieces are deliberately out of
//     reach of schedule pressure, the same suppression computeScheduleStatus
//     and computeDueReviews already apply.
//   * it isn't mid-revival — revival replaces the original plan's pacing
//     entirely, so rebalancing that plan underneath it is meaningless.
//   * it's still inside its own plan (elapsedDay <= days.length) — the same
//     boundary shouldShowScheduleBanner uses. Past that point the piece has
//     moved to maintenance and "behind schedule" is no longer a meaningful
//     question; without this, every long-finished piece would be swept into
//     a bulk reschedule forever (getCurrentDay clamps, so computeScheduleStatus
//     keeps reporting stale misses — see shouldShowScheduleBanner below).
//   * it actually has misses (missedCount > 0) and something left to move.
//
// asOfDay comes from getCurrentDay, i.e. the piece's *real* current day —
// never a browsed/overridden day. Each piece is anchored to its own plan
// day, not to a single shared day number: the pieces in a bulk reschedule
// generally started on different dates.
//
// One malformed piece is skipped and logged rather than throwing, matching
// how MasterAgendaTab already walks this same pieces map — a bulk action
// across every piece shouldn't be all-or-nothing on one bad record.
export function planRescheduleForPieces(pieces) {
  const plans = [];
  Object.entries(pieces || {}).forEach(([pieceId, piece]) => {
    try {
      if (!piece) return;
      if ((piece.status || "active") !== "active") return;
      if (isInRevival(piece)) return;

      const chunkSet = generateAllChunks(piece);
      const timeline = getEffectiveTimeline(piece, chunkSet);
      if (!timeline || !timeline.days || !timeline.days.length) return;
      if (elapsedDay(piece) > timeline.days.length) return;

      const asOfDay = getCurrentDay(piece, timeline.days.length);
      const { missedCount, remainingChunkIds } = computeScheduleStatus(
        piece,
        chunkSet.practiceChunks,
        timeline,
        asOfDay
      );
      if (missedCount === 0 || remainingChunkIds.length === 0) return;

      plans.push({
        pieceId,
        piece,
        missedCount,
        marker: { asOfDay, remainingChunkOrder: remainingChunkIds },
      });
    } catch (e) {
      console.error(`Error planning reschedule for piece ${pieceId}:`, e);
    }
  });
  // Furthest behind first — that's the order the confirmation lists them in,
  // so the piece most in need of this is the one the user reads first.
  plans.sort((a, b) => b.missedCount - a.missedCount);
  return plans;
}

// Whether the schedule-behind-schedule banner (ScheduleBanner.jsx) should
// render at all — Pass 16. `currentDay` (App.jsx's realCurrentDay, fed into
// computeScheduleStatus above) is clamped to timeline.days.length via
// getCurrentDay (lib/utils.js), so once a piece runs past its own plan it
// stays pinned at the last day forever — and computeScheduleStatus keeps
// finding chunks introduced before that pinned day with zero sessions,
// reporting a nonzero missedCount indefinitely. "Behind schedule" stops
// being a meaningful question once the plan itself is over: the piece has
// moved into ongoing maintenance (computeDueReviews, lib/maintenance.js),
// the same condition TodayTab.jsx already uses (its own `pastPlan`) to
// switch into that mode. Takes `elapsedDay` as an already-computed number
// (lib/utils.js's elapsedDay(piece), read once by the caller) rather than
// `piece` itself, so this stays a pure function of its inputs like every
// other export here (computeScheduleStatus above takes `currentDay` the
// same way) instead of reaching for the real clock internally.
export function shouldShowScheduleBanner(elapsedDay, timeline, missedCount) {
  if (elapsedDay > timeline.days.length) return false;
  return missedCount > 0;
}
