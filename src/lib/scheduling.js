import { clamp, daysBetweenInclusive, addDaysISO, todayISODate, elapsedDay, getCurrentDay } from "./utils";
import { EFFORT_TO_MIN, LIBERAL_FACTOR, REVIEW_OFFSETS, MIN_PRACTICE_DAYS_PER_WEEK, MAX_PRACTICE_DAYS_PER_WEEK } from "./constants";
import { generateAllChunks } from "./chunking";
import { sessionOutcome } from "./confidence";
import { isInRevival } from "./revival";
import { isPieceLearned } from "./ladder";

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
  // Every introduced item also costs some spaced-review load later — each
  // review touch is priced the same as the chunk's own introduction
  // (chunk.effort), matching computeTimeline's minutesFor and
  // computeDueReviews, both of which price a review at
  // chunk.effort * EFFORT_TO_MIN rather than a flat per-touch minute
  // figure (the flat rate this replaced undercounted a hard chunk's review
  // cost specifically, which could make a minutes-mode day count come out
  // too optimistic for a piece full of difficult passages). Effort alone
  // (the raw introduction cost) undercounts what a day actually ends up
  // costing once review load lands on top of it; folding that in here,
  // already in the same effort-point units as everything else in this
  // budget, is what keeps this estimate from landing on a day count that's
  // technically "enough" for introduction alone but still runs well over
  // budget once review is added.
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
  const REVIEW_TOUCHES_PER_ITEM = 2;
  let learningDaysNeeded = 1;
  let acc = 0;
  chunkSet.all.forEach((c) => {
    const itemEffort = c.effort * (1 + REVIEW_TOUCHES_PER_ITEM);
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
  // `needed` is a pure function of total effort and pace, computed as if
  // starting fresh today with zero progress — it has no notion of days
  // that already elapsed without practice. That's fine for a piece that
  // hasn't fallen behind, but a reschedule (App.jsx's handleReschedule,
  // "doesn't fit" branch) can deliberately push daysToLearn past `needed`
  // to make up for exactly that lost time, at the same minutesPerDay
  // budget. Without this floor, this function — which every load runs
  // unconditionally via validateAndMigratePiece — would silently snap that
  // extension right back down to `needed` on the very next reload, since
  // `needed` alone has no way to tell "deliberately extended" apart from
  // "never reconciled since an edit." Only floors while a rescheduleMarker
  // is actually in effect, so a piece that's never been rescheduled behaves
  // exactly as before; the marker being cleared (any Settings save clears
  // it — App.jsx's handleSavePiece) drops the floor with it, so an
  // intentional pace/measure edit still recomputes from scratch as usual.
  const floor = piece.rescheduleMarker ? piece.daysToLearn : 0;
  const target = Math.max(needed, floor);
  return target === piece.daysToLearn ? piece : { ...piece, daysToLearn: target };
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
  //
  // Cumulative-boundary assignment, not a per-day-reset accumulator: each
  // front day owns an equal proportional slice of totalNewEffort
  // (boundary[i] = totalNewEffort * (i+1) / numFrontDays), and a chunk goes
  // to whichever slice it falls into by where it starts (its running total
  // *before* being added), walked forward with a running total that's
  // never reset. A reset-per-day accumulator capped at the last front day
  // (the previous version of this loop) has no way to correct for its own
  // drift — any chunk that doesn't evenly divide into a day's target just
  // keeps accumulating, and once dayIdx hits the final front day it can't
  // advance further, so all of that drift piles onto whatever's left.
  // Anchoring each day's boundary to the whole remaining total instead of
  // to however much the previous day happened to absorb is what actually
  // prevents that pile-up. Using the chunk's *start* rather than its
  // midpoint for the comparison matters too: the running total is 0 before
  // the very first chunk, which is always less than a positive boundary,
  // so day one always gets at least the first chunk regardless of how
  // large a single chunk's effort is relative to the per-day slice — a
  // midpoint comparison can push even the first chunk past day one's
  // boundary and leave it empty, found while testing this fix (a 3-chunk
  // piece spread across 7 front days left day one with nothing introduced
  // at all). Order (measure order) is preserved — this only changes which
  // day a chunk lands on, never the sequence.
  const totalNewEffort = practiceChunks.reduce((s, c) => s + c.effort, 0);
  const numFrontDays = frontDays.length;
  let dayIdx = 0;
  let runningEffort = 0;
  practiceChunks.forEach((chunk) => {
    while (dayIdx < numFrontDays - 1 && runningEffort >= (totalNewEffort * (dayIdx + 1)) / numFrontDays) {
      dayIdx++;
    }
    const day = frontDays[dayIdx];
    days[day - 1].newChunkIds.push(chunk.id);
    introducedDay[chunk.id] = day;
    runningEffort += chunk.effort;
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
  // A review is priced the same as introducing the chunk fresh —
  // chunk.effort * EFFORT_TO_MIN, same formula for all three roles, and the
  // same rate computeDueReviews (lib/maintenance.js) already uses for its
  // live due-review estimate. Previously reviewMin used a flat 3
  // minutes/touch regardless of the chunk's own difficulty, which
  // undercounted how long a hard chunk's review actually takes and could
  // make a minutes-mode plan's day count come out too optimistic once
  // review load was folded in (see computeDaysNeededForMinutesPerDay below,
  // which had the same flat-rate assumption baked into its day-count math).
  const minutesFor = (d) => {
    const newMin = d.newChunkIds.reduce((s, id) => s + chunkById[id].effort * EFFORT_TO_MIN, 0);
    const specialMin = d.specialChunkIds.reduce((s, id) => s + chunkById[id].effort * EFFORT_TO_MIN, 0);
    const reviewMin = d.reviewChunkIds.reduce((s, id) => s + chunkById[id].effort * EFFORT_TO_MIN, 0);
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

// Rescheduling a piece a *second* time used to discard the first
// reschedule's placements for every day between the old asOfDay and the new
// one: `original` was always the pristine, never-rescheduled computeTimeline
// result, no matter how many times this piece had already been rebalanced.
// A day that had genuinely-live content right up until the second
// reschedule — including a session someone had actually logged there —
// would revert to whatever that day happened to hold before any reschedule
// ever ran, with no way to tell the two apart. Found via manual double-
// reschedule testing: a chunk logged on its first-reschedule placement
// became invisible in its real (now-reverted) spot and unmatched in its
// pre-reschedule one, so it displayed as freshly unstarted even though
// `piece.progress[id].doneDays` never lost the session.
//
// Fixed by chaining: each new rescheduleMarker now also carries `previous`,
// the marker that was in effect right before it (or null, for a piece's
// first-ever reschedule). `original` — the source for everything before
// *this* marker's asOfDay — is the EFFECTIVE timeline as of that previous
// marker, computed recursively, instead of always the raw schedule. A
// once-rescheduled piece has `previous: null`, so this recursion bottoms
// out at exactly the same `computeTimeline` call as before — no behavior
// change for the single-reschedule case this was already tested against,
// and an old saved piece with no `previous` field at all behaves the same
// way (`marker.previous` reads as `undefined`, same falsy base case).
function computeEffectiveTimeline(piece, chunkSet, marker) {
  if (!marker) return computeTimeline(piece, chunkSet);

  const original = computeEffectiveTimeline(piece, chunkSet, marker.previous || null);
  const { practiceChunks, transitions, combos } = chunkSet;
  const chunkById = Object.fromEntries(practiceChunks.map((c) => [c.id, c]));
  const remainingChunks = marker.remainingChunkOrder.map((id) => chunkById[id]).filter(Boolean);
  const remainingIds = new Set(remainingChunks.map((c) => c.id));
  // A transition/combo only ever rode into the remainder indirectly, via
  // this neighbor check — never checked against its OWN logged status.
  // Pass 65 reported this precisely: once both of a transition's flanking
  // chunks (or a combo's one anchor chunk) had been practiced, the
  // connector dropped out of this filter permanently, even with zero
  // doneDays of its own — stranded on whatever day the original
  // computeTimeline call gave it, unmovable by any future reschedule, no
  // matter how many times the piece was rescheduled again. Pass 65 shipped
  // only this neighbor-inference filter as a mitigation, not a fix for
  // that exact gap (its own bug report says so explicitly) — kept here
  // unchanged, since a connector whose neighbor genuinely IS still
  // remaining should still ride along with it exactly as before.
  //
  // remainingConnectorIds (Pass 73 follow-up) is the real fix: a direct,
  // self-status check via computeRemainingConnectorIds below, carried on
  // the marker alongside remainingChunkOrder. `|| []` handles a marker
  // saved before this field existed — it just falls back to the
  // neighbor-only behavior above, exactly as it always did.
  const remainingConnectorIds = new Set(marker.remainingConnectorIds || []);
  const remainingTransitions = transitions.filter(
    (t) => remainingConnectorIds.has(t.id) || t.linkedIds.some((id) => remainingIds.has(id))
  );
  const remainingCombos = combos.filter((c) => remainingConnectorIds.has(c.id) || remainingIds.has(c.linkedIds[0]));

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

export function getEffectiveTimeline(piece, chunkSet) {
  return computeEffectiveTimeline(piece, chunkSet, piece.rescheduleMarker);
}

// A review whose due date has passed sits on its original bounded-timeline
// day forever, unaddressed, looking exactly like a still-open task —
// duplicating what mergeLiveDueReviews (lib/maintenance.js, Pass 66)
// already, separately, surfaces on today's actual screen. This has nothing
// to do with rescheduling: computeTimeline has no notion of "today" at
// all, so once a review's placement day has passed, nothing else in the
// pipeline ever revisits it.
//
// A review sitting on any day *before* realCurrentDay, not logged on that
// exact day, is unconditionally also live-due right now — no separate
// nextDueDate comparison is needed to know that. Tier 2 placement (above)
// derives a review's day number directly from its nextDueDate via the
// same startDate anchor elapsedDay/getCurrentDay use, and snapOrDrop only
// ever snaps a placement *forward*, never backward — so a placement day
// strictly earlier than today can only exist because its nextDueDate
// calendar-maps to a date that has already passed.
//
// Scoped to exactly when mergeLiveDueReviews would actually be surfacing
// this same review live elsewhere: computeDueReviews suppresses its whole
// due list for a paused/archived or mid-revival piece, so stripping a
// review here too in that state would make it vanish with nothing live to
// point to instead — worse than leaving it, not better.
//
// Applied once, centrally, to whatever getEffectiveTimeline already
// produced, rather than as a per-surface check: every consumer of
// timeline.days[] (Timeline, Day view, Week view, Overview's first-week
// list, Master Agenda) gets the corrected reviewChunkIds for free, and
// classifyDayCompletion/countBehindDays stop reading a stale review as
// still-incomplete work too — the same way they already stopped reading a
// swept chunk that way (isDayFullySwept, above). Doesn't touch day.minutes
// — same "don't bother re-costing a stale day" precedent isDayFullySwept
// already set (a swept day's header still shows its original, stale
// minutes figure too).
export function withLiveReviewStatus(timeline, piece, realCurrentDay) {
  if ((piece.status || "active") !== "active" || isInRevival(piece)) return timeline;
  const days = timeline.days.map((day) => {
    // Consolidation days blanket reviewChunkIds with every practice chunk
    // regardless of ladder state (computeTimeline, above) — a completely
    // different mechanism (the whole-piece run-through, tracked via the
    // synthetic "__consolidation__" progress key, not each chunk's own
    // doneDays) that happens to reuse the same field name. Treating those
    // as stale Tier 2 reviews would be wrong, not just redundant — mirrors
    // mergeLiveDueReviews' own identical skip (lib/maintenance.js) for the
    // same reason.
    if (day.type === "consolidation") return day;
    if (day.dayNumber >= realCurrentDay || !day.reviewChunkIds.length) return day;
    // Only a genuine Tier 2 review (already on the ladder, entry.nextDueDate
    // set) is guaranteed to also be live-tracked by computeDueReviews —
    // that function's own gate requires nextDueDate, full stop
    // (lib/maintenance.js). A Tier 1 "first touch" review (above) is
    // placed for a chunk that's never been logged at all, so it never has
    // a nextDueDate and is never surfaced by computeDueReviews either —
    // treating it as "stale" the same way would make it vanish here with
    // nothing live to point to instead, exactly the failure mode this
    // function exists to avoid. Confirmed live: without this guard, every
    // never-touched chunk's first-touch review disappeared, mislabeled
    // "Now due — see today" even though nothing showed there.
    const staleReviewIds = day.reviewChunkIds.filter((id) => {
      const entry = piece.progress[id] || {};
      if (!entry.nextDueDate) return false;
      const doneDays = entry.doneDays || [];
      return !doneDays.includes(day.dayNumber);
    });
    if (!staleReviewIds.length) return day;
    return {
      ...day,
      reviewChunkIds: day.reviewChunkIds.filter((id) => !staleReviewIds.includes(id)),
      staleReviewIds,
    };
  });
  return { ...timeline, days };
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

// Which transitions/combos have never been logged at all — computeScheduleStatus's
// "ever touched" check (above), applied directly to connectors instead of
// practice chunks. Every reschedule call site used to call
// computeScheduleStatus with chunkSet.practiceChunks only, so a
// transition/combo's own doneDays never factored into "what's remaining"
// anywhere — the only signal available was computeEffectiveTimeline's
// neighbor-inference filter (see the comment there), which can't tell "this
// connector itself is untouched" apart from "this connector's neighbors are
// untouched." Confirmed as a real, reported bug (Pass 65); this direct
// check is what actually closes it (Pass 73 follow-up) — feeds
// marker.remainingConnectorIds, which computeEffectiveTimeline reads
// alongside (not instead of) the neighbor check.
//
// Ungated by currentDay, matching remainingChunkIds' own scope exactly — a
// connector not yet due still belongs in a fresh marker's remainder just
// as an unintroduced practice chunk does; day-gating only matters for
// deciding whether to alert instead of reschedule (see handleReschedule/
// planRescheduleForPieces, which additionally check timeline.introducedDay
// for that specific decision).
export function computeRemainingConnectorIds(piece, chunkSet) {
  const untouched = (x) => ((piece.progress[x.id] || {}).doneDays || []).length === 0;
  return [...chunkSet.transitions, ...chunkSet.combos].filter(untouched).map((x) => x.id);
}

// Per-day completion status for a single timeline day, relative to
// currentDay: "future" | "done" | "behind" | "empty". Pure and side-effect
// free, written once (Pass 45) specifically so Pass 46 (Timeline tab) can
// reuse it against the same day objects rather than duplicating this logic.
//
// A day at or after currentDay is always "future" — nothing to judge yet.
// A day before currentDay with nothing scheduled at all (a rest day, or any
// other day the plan assigned no new material, review, or transition to)
// is "empty" — there was nothing to do, so it's neither done nor behind.
// Kept distinct from "done" specifically so a caller can still gray an
// empty past day out (it's still over) without implying real work was
// completed there. "empty" used to collapse into "done" ("vacuously,"
// nothing to miss) — corrected on request, since that read as a
// struck-through "Nothing scheduled" row on Overview's first-week list. A
// day with something scheduled is "done" only if every chunk it scheduled
// (newChunkIds + specialChunkIds + reviewChunkIds) has that exact day
// number in its own doneDays; otherwise "behind".
//
// Deliberately checks each chunk's own doneDays for *that specific day*,
// not just "has this chunk ever been touched" the way computeScheduleStatus
// above does — a chunk logged on some other day still leaves this one
// incomplete.
//
// A consolidation day's reviewChunkIds lists every practice chunk
// (never empty, so it can't land on the "empty" branch below), but logging
// that day's run-through (handleLogRunThrough, App.jsx) only ever writes
// the synthetic "__consolidation__" progress entry, never each individual
// chunk's own doneDays — so the per-chunk check below can't see it.
// Resolved: the user's call is that logging the run-through satisfies that
// day's schedule outright, the same as any other day's task list being
// checked off, so a consolidation day is judged by "__consolidation__"'s
// own doneDays instead of the individual chunk ids it blankets. See
// docs/Decisions.md#scheduling.
export function classifyDayCompletion(day, piece, currentDay) {
  if (day.dayNumber >= currentDay) return "future";
  const ids = [...day.newChunkIds, ...day.specialChunkIds, ...day.reviewChunkIds];
  if (!ids.length) return "empty";
  if (day.type === "consolidation") {
    const consolidationDoneDays = (piece.progress["__consolidation__"] || {}).doneDays || [];
    return consolidationDoneDays.includes(day.dayNumber) ? "done" : "behind";
  }
  const allDone = ids.every((id) => ((piece.progress[id] || {}).doneDays || []).includes(day.dayNumber));
  return allDone ? "done" : "behind";
}

// A day whose entire original task list was swept into a reschedule
// (getEffectiveTimeline only replaces days from the marker's asOfDay
// onward — an untouched day further back still carries its stale
// pre-reschedule newChunkIds/specialChunkIds/reviewChunkIds) reads as
// "moved elsewhere," not as still-incomplete work. TodayTab/TimelineTab/
// DayChecklist each already collapsed this locally to a plain "Tasks
// rescheduled" line (Pass 48) rather than re-showing content that now
// lives on its new day; extracted here (Pass 74 follow-up) so
// countBehindDays below can apply the identical rule instead of counting
// a fully-swept day as still behind — before this, the schedule banner
// kept citing a stale "N days behind" figure immediately after a
// reschedule, even once every day-list surface and the catch-up scan had
// already caught up (confirmed live: 18 days behind, pre- and
// post-reschedule, identically).
//
// A connector (transition/combo) id is never itself in
// marker.remainingChunkOrder (that list is practice-chunk ids only), even
// when it genuinely rode along into the rescheduled remainder —
// getEffectiveTimeline moves a transition whenever either linked chunk
// remains, and a combo whenever its one linked chunk does; the linkedIds
// fallback below mirrors that. `chunkById` is optional and defaults to
// `{}`: without it, a connector can still be recognized as moved via
// `marker.remainingConnectorIds` (Pass 73) directly, just not via the
// linkedIds fallback — so omitting it can only undercount a sweep, never
// overcount one.
//
// Found-and-fixed gap: only checking the *current* marker misses an id
// that was swept by an *earlier* reschedule and has *since* been
// completed — by the time a later reschedule runs, it's no longer
// "remaining" (it's done), so it drops out of that marker's
// remainingChunkOrder, and its original, pre-first-reschedule day never
// learns it was ever moved. The fix doesn't need to walk the whole
// history of rescheduleMarker.previous links to find out, though —
// walking every past marker is answering an unnecessarily roundabout
// version of the real question. What actually matters is simpler and
// doesn't reference markers at all: has this id been done on some day
// OTHER than this one? If so, its presence here is stale regardless of
// *why* (an earlier reschedule's relocation, or simply logged ahead of
// schedule before this day arrived) — one O(1) lookup against doneDays,
// same cost whether the piece was rescheduled once or fifty times.
// Guarded to `!doneDays.includes(day.dayNumber)` specifically so a day
// that's genuinely, fully done *on this exact day* still renders its real
// content (and gets its own "done" treatment from classifyDayCompletion)
// rather than being swallowed into "Tasks rescheduled" too.
//
// That "done elsewhere" check is scoped to newChunkIds/specialChunkIds
// only — never reviewChunkIds. A reschedule marker's remainingChunkOrder/
// remainingConnectorIds only ever track introduction/connector placement;
// a review was never a candidate for being "remaining" in that sense to
// begin with (Tier 2 placement is a wholly separate mechanism — see
// Algorithms.md's "Timeline — scheduler"). A chunk under review always
// has *some* prior doneDays (that's why it's due for review again) that
// almost never include *this* review's own day until it's actually
// logged — applying the same "done elsewhere" test to reviewChunkIds
// would misread nearly every genuine, still-open review as stale and
// silently swallow it into "Tasks rescheduled". Caught before shipping by
// a regression test built specifically to probe this.
export function isDayFullySwept(day, piece, chunkById = {}) {
  const marker = piece.rescheduleMarker;
  if (marker == null || day.dayNumber >= marker.asOfDay) return false;
  const ids = [...day.newChunkIds, ...day.specialChunkIds, ...day.reviewChunkIds];
  if (!ids.length) return false;
  const introOrConnectorIds = new Set([...day.newChunkIds, ...day.specialChunkIds]);
  const isMovedId = (id) => {
    if (introOrConnectorIds.has(id)) {
      const doneDays = (piece.progress[id] || {}).doneDays || [];
      if (doneDays.length > 0 && !doneDays.includes(day.dayNumber)) return true;
    }
    if (marker.remainingChunkOrder.includes(id)) return true;
    if (marker.remainingConnectorIds && marker.remainingConnectorIds.includes(id)) return true;
    const c = chunkById[id];
    if (!c || !c.linkedIds) return false;
    return c.kind === "combo"
      ? marker.remainingChunkOrder.includes(c.linkedIds[0])
      : c.linkedIds.some((lid) => marker.remainingChunkOrder.includes(lid));
  };
  return ids.every(isMovedId);
}

// How many distinct timeline days are "behind" (per classifyDayCompletion)
// as of currentDay — a day-count sibling to computeScheduleStatus's
// chunk-count missedCount, for surfaces that want to say "N days behind"
// instead of "N chunks behind" (a day with several missed chunks only
// counts once here). A fully-swept day (isDayFullySwept, above) is
// excluded rather than counted "behind" — same rule the day-list surfaces
// already applied to themselves, now shared here too.
export function countBehindDays(piece, timeline, currentDay, chunkById = {}) {
  return timeline.days.filter(
    (d) => !isDayFullySwept(d, piece, chunkById) && classifyDayCompletion(d, piece, currentDay) === "behind"
  ).length;
}

// Will the not-yet-started work actually fit in the days this plan has
// left? A rough sanity check on a reschedule, not a scheduling decision:
// rescheduling packs things in as tightly as it can either way, so this
// only ever decides whether the user gets a heads-up first.
//
// Lifted out of App.jsx's per-piece handler in Pass 21 so the bulk
// "Reschedule all" path can ask the same question about each piece without
// a second copy of the formula. The 0.65 is the same day-fill factor the
// rest of the scheduler uses (see computeDaysNeededForMinutesPerDay), and
// the 5-minute floor on minutesPerDay guards a divide-by-something-tiny.
export function estimateRescheduleFit(piece, practiceChunks, timeline, asOfDay, remainingChunkIds) {
  const remaining = new Set(remainingChunkIds);
  const remainingEffort = practiceChunks.reduce((s, c) => (remaining.has(c.id) ? s + c.effort : s), 0);
  const availableDays = Math.max(1, timeline.days.length - asOfDay + 1);
  const requiredDays = Math.max(
    1,
    Math.ceil(((remainingEffort * EFFORT_TO_MIN) / 0.65) / Math.max(5, piece.minutesPerDay))
  );
  return { availableDays, requiredDays, fits: requiredDays <= availableDays };
}

// Shared by handleReschedule's single-piece "doesn't fit" extension
// (App.jsx) and planRescheduleForPieces' bulk "already past its plan"
// extension below — same formula in one place, so a future change to how
// this is sized can't fix one call site and silently leave the other
// stale, which is exactly how Pass 39's clamped-vs-real-elapsedDay bug
// happened in the first place (see docs/Decisions.md#scheduling).
// `anchorDay` is the caller's chosen "day 1 of the extension" — always the
// real elapsedDay(piece), never the clamped currentDay/asOfDay, so the
// result actually covers today in one step. `targetDate` is null for
// scheduleMode: "minutes" (never set in that mode — see
// Data-Model.md#the-piece-object).
export function computeReschedulePastPlanExtension(piece, anchorDay, requiredDays) {
  const daysToLearn = anchorDay - 1 + requiredDays;
  const targetDate = piece.scheduleMode === "minutes" ? null : addDaysISO(piece.startDate, daysToLearn - 1);
  return { daysToLearn, targetDate };
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
//   * its plan isn't *actually* finished yet (isPlanActuallyComplete, Pass
//     39 — see that function) — genuinely done means "behind schedule" is
//     no longer a meaningful question; without this, every finished piece
//     would be swept into a bulk reschedule forever (getCurrentDay clamps,
//     so computeScheduleStatus keeps reporting stale misses — see
//     shouldShowScheduleBanner below). **Was `elapsedDay(piece) >
//     timeline.days.length` through Pass 38** — the same calendar-only
//     check shouldShowScheduleBanner used to make, and the same bug: a
//     days-mode piece whose target date passed with real work still
//     outstanding got silently excluded from "Reschedule all" right when it
//     needed it most. Fixed alongside the rest of Pass 39 rather than left
//     as a sibling gap — see docs/Decisions.md#scheduling.
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
//
// Shared by planRescheduleForPieces and findStuckBehindPieces below — both
// need to answer "is this piece even a candidate to consider at all"
// before asking their own, different follow-up question, and both need to
// agree on that first answer or the two lists could disagree about a piece
// neither of them actually meant to disagree about (e.g. one treating a
// paused piece as a candidate and the other not). Returns `null` for a
// piece that's out of consideration entirely (missing, inactive, mid-
// revival, no real timeline, or its plan is actually complete), otherwise
// `{ chunkSet, timeline, asOfDay, cutoffDay }`.
//
// asOfDay and cutoffDay answer two different questions and must not be
// conflated. asOfDay (`getCurrentDay`, clamped to `timeline.days.length`)
// anchors a reschedule marker at a real timeline day — it has to stay
// clamped, or a marker built from it would point past the end of
// `timeline.days`. cutoffDay is for "how behind is this piece" checks
// (missedCount, countBehindDays) instead: once a piece's whole calendar
// plan has elapsed (`elapsedDay(piece) > timeline.days.length`), nothing
// is "not yet due" anymore, but asOfDay's clamp leaves the literal last
// day perpetually judged against itself (`dayNumber >= currentDay` is
// always true when both equal `timeline.days.length`) — so it can never
// register as behind under that reckoning, no matter how overdue it
// really is. cutoffDay bumps one past the last day specifically in that
// situation, mirroring the identical `timeline.days.length + 1` MasterAgendaTab's
// own needsReschedule branch already uses for its `behindDaysCount`.
//
// **Found in review, before commit, same session:** without cutoffDay,
// `findStuckBehindPieces` below used asOfDay for its own countBehindDays
// check, which meant it could never register the literal last day of an
// already-expired plan as behind, while MasterAgendaTab's own
// needsReschedule branch (which already used length+1 for the identical
// question) could. Confirmed by direct calculation — the arithmetic gap
// itself is real and unambiguous (`classifyDayCompletion` always reads
// `day.dayNumber === timeline.days.length` as `"future"` when currentDay
// is clamped to that same value) — but a live, end-to-end repro through
// this scheduler's actual introduction-window logic was NOT obtained: in
// every configuration tried, a transition/combo that's still genuinely
// untouched by the time a piece is fully past its plan always turned out
// to also have an earlier occurrence (introduction or a Tier 1/2 review)
// well before the last day, which the *old*, unbumped cutoff already
// caught correctly — so the gap this closes may be real but narrower or
// rarer in practice than first assessed. Kept anyway: it's a strict
// correctness improvement with zero measured regressions (full existing
// test suite passed unmodified), not a speculative one bolted on for a
// scenario proven not to occur.
function eligiblePieceContext(piece) {
  if (!piece) return null;
  if ((piece.status || "active") !== "active") return null;
  if (isInRevival(piece)) return null;

  const chunkSet = generateAllChunks(piece);
  const timeline = getEffectiveTimeline(piece, chunkSet);
  if (!timeline || !timeline.days || !timeline.days.length) return null;
  if (isPlanActuallyComplete(piece, chunkSet, timeline)) return null;

  const asOfDay = getCurrentDay(piece, timeline.days.length);
  const cutoffDay = elapsedDay(piece) > timeline.days.length ? timeline.days.length + 1 : asOfDay;
  return { chunkSet, timeline, asOfDay, cutoffDay };
}

export function planRescheduleForPieces(pieces) {
  const plans = [];
  Object.entries(pieces || {}).forEach(([pieceId, piece]) => {
    try {
      const ctx = eligiblePieceContext(piece);
      if (!ctx) return;
      const { chunkSet, timeline, asOfDay, cutoffDay } = ctx;

      const { missedCount, remainingChunkIds } = computeScheduleStatus(
        piece,
        chunkSet.practiceChunks,
        timeline,
        cutoffDay
      );
      const remainingConnectorIds = computeRemainingConnectorIds(piece, chunkSet);
      // A connector counts toward eligibility only once it's actually due —
      // the same introducedDay < cutoffDay gate missedCount applies to
      // practice chunks — so a connector that simply hasn't been introduced
      // yet doesn't force a piece into "Reschedule all" prematurely. Pass 73
      // follow-up to Pass 65: without this, a piece with every practice
      // chunk touched but a genuinely stuck, overdue connector was excluded
      // here exactly like it was in handleReschedule's single-piece guard.
      const qualifyingConnectorIds = remainingConnectorIds.filter(
        (id) => timeline.introducedDay[id] && timeline.introducedDay[id] < cutoffDay
      );
      // Simplified from an earlier version that OR'd in a second,
      // provably-redundant condition (remainingChunkIds.length === 0 &&
      // remainingConnectorIds.length === 0) — whenever this first check is
      // false, that second one always was too (missedCount > 0 implies
      // remainingChunkIds > 0; a qualifying connector implies
      // remainingConnectorIds > 0), so it never independently changed the
      // outcome. Found in review, removed rather than left as dead weight.
      if (missedCount === 0 && qualifyingConnectorIds.length === 0) return;

      const fit = estimateRescheduleFit(piece, chunkSet.practiceChunks, timeline, asOfDay, remainingChunkIds);

      // A piece whose target date has already passed (not just "tight
      // within what's left") has no meaningful "pack into what's left"
      // option left — asOfDay is already clamped to the plan's last day, so
      // there's no calendar room to pack into. Bulk reschedule used to just
      // leave such a piece exactly as behind as it found it (see the fix
      // this addresses, below); now it pushes the target date out to fit,
      // the same way the single-piece "Change target date" button would.
      // Days-mode only — a minutes-mode piece in this state already has its
      // own separate, automatic fix (App.jsx's effect,
      // computeMinutesModeAutoExtend) that runs the moment it's opened, no
      // button needed; giving it a second, differently-sized fix here would
      // just reintroduce two formulas answering the same question. See
      // docs/Decisions.md#scheduling.
      const extend =
        piece.scheduleMode !== "minutes" && elapsedDay(piece) > timeline.days.length
          ? computeReschedulePastPlanExtension(piece, elapsedDay(piece), fit.requiredDays)
          : null;

      plans.push({
        pieceId,
        piece,
        missedCount,
        // Carried so the one bulk confirmation can name the pieces whose
        // remaining work realistically won't fit — the per-piece button
        // gives that warning in full, and the bulk path shouldn't be the
        // less-informative way to do the same thing.
        fit,
        // `previous: piece.rescheduleMarker` chains this reschedule onto
        // whatever the piece's last one was (or null, its first) — see
        // computeEffectiveTimeline for why a piece rescheduled more than
        // once needs that chain instead of always re-deriving from the raw,
        // never-rescheduled schedule.
        marker: { asOfDay, remainingChunkOrder: remainingChunkIds, remainingConnectorIds, previous: piece.rescheduleMarker || null },
        extend,
      });
    } catch (e) {
      console.error(`Error planning reschedule for piece ${pieceId}:`, e);
    }
  });
  // Furthest behind first — that's the order the confirmation lists them in,
  // so the piece most in need of this is the one the user reads first.
  // Sorting on missedCount alone (found in review) always ranked a
  // connector-only piece dead last, however long its connector had been
  // stuck, since such a piece's missedCount is always 0 by construction —
  // folding in the connector count gives it a real, if simple, weight in
  // the ordering instead of an implicit "least behind" default.
  plans.sort((a, b) => (b.missedCount + b.marker.remainingConnectorIds.length) - (a.missedCount + a.marker.remainingConnectorIds.length));
  return plans;
}

// Pieces that are genuinely behind by day-count (countBehindDays — the
// same signal ScheduleBanner and Master Agenda's per-piece badge use) but
// that planRescheduleForPieces above will never include, because they have
// no untouched practice-chunk material (`remainingChunkIds`) for a
// reschedule to actually move. Everything they've introduced has been
// touched at least once; what's still open is a transition, combo, or
// review sitting unlogged past its day — a reschedule genuinely can't help
// there, the same reasoning handleReschedule's single-piece path already
// encodes as an explanatory alert instead of silently doing nothing (see
// docs/Decisions.md#scheduling).
//
// Exists so a caller that widens its own "is this piece behind" check to
// match Master Agenda's badge (countBehindDays, not just missedCount) can
// still tell the two groups apart and say something honest about the
// difference, instead of a piece just silently vanishing from a bulk
// reschedule's confirmation with no explanation. Shares
// eligiblePieceContext with planRescheduleForPieces so the two functions
// can never disagree about which pieces are even candidates to begin
// with — only about what to do with a candidate once found.
export function findStuckBehindPieces(pieces) {
  const stuck = [];
  Object.entries(pieces || {}).forEach(([pieceId, piece]) => {
    try {
      const ctx = eligiblePieceContext(piece);
      if (!ctx) return;
      const { chunkSet, timeline, cutoffDay } = ctx;

      // remainingChunkIds doesn't depend on which day it's evaluated
      // against (it's a plain "ever touched at all" check) — cutoffDay
      // vs. asOfDay makes no difference here, only for countBehindDays
      // below.
      const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, cutoffDay);
      if (remainingChunkIds.length > 0) return; // planRescheduleForPieces already has this one covered

      // Pass 73 follow-up to Pass 65: a piece with a genuinely stuck,
      // overdue connector (transition/combo, never logged) is now ALSO
      // covered by planRescheduleForPieces — it must be excluded here too,
      // or it would show up in both lists at once (once as reschedulable,
      // once as "nothing to reschedule"), the exact contradiction this
      // function exists to prevent. Same qualifying condition
      // planRescheduleForPieces itself applies.
      const qualifyingConnectorIds = computeRemainingConnectorIds(piece, chunkSet).filter(
        (id) => timeline.introducedDay[id] && timeline.introducedDay[id] < cutoffDay
      );
      if (qualifyingConnectorIds.length > 0) return;

      const chunkById = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));
      if (countBehindDays(piece, timeline, cutoffDay, chunkById) > 0) {
        stuck.push({ pieceId, piece });
      }
    } catch (e) {
      console.error(`Error checking stuck-behind state for piece ${pieceId}:`, e);
    }
  });
  return stuck;
}

// Is this piece's plan actually finished, or just past its calendar
// length? Those used to be treated as the same question (`elapsedDay >
// timeline.days.length`, everywhere a surface needed to know "is this
// piece past its plan") — but a piece whose target date passed with real
// work still outstanding isn't done, it's behind, and Pass 39 exists
// specifically to stop conflating the two. What counts as "actually
// finished" splits by scheduleMode, per
// docs/Decisions.md#scheduling's days-vs-minutes asymmetry:
//
//   * "days" — the deadline was a deliberate choice, so running past it
//     doesn't excuse unfinished work. Every item computeTimeline actually
//     scheduled — chunkSet.all: practice chunks, transitions, and combos
//     (generateAllChunks never puts section run-throughs or the synthetic
//     "__consolidation__" entry in `all` — see chunking.js — so neither
//     one is required here; flagged in Decisions.md rather than assumed,
//     since a piece-level "everything, including the final run-through,
//     was played" bar was never specified) — must have at least one
//     logged session (`doneDays.length > 0`).
//   * "minutes" — there was never a deadline to run past in the first
//     place, so "finished" is just Stage 3's real definition: every
//     practice chunk's ladder card at Holding (`isPieceLearned`,
//     lib/ladder.js). See `computeMinutesModeAutoExtend` below for what
//     keeps the plan itself growing to fit until that's true, instead of
//     this ever reporting "finished" purely because the calendar ran out.
export function isPlanActuallyComplete(piece, chunkSet, timeline) {
  if (elapsedDay(piece) <= timeline.days.length) return false;
  if (piece.scheduleMode === "minutes") return isPieceLearned(piece, chunkSet);
  return (chunkSet.all || []).every((c) => (((piece.progress[c.id] || {}).doneDays) || []).length > 0);
}

// How many days computeMinutesModeAutoExtend (below) grows a minutes-mode
// plan by each time it fires. Not derived from anything — just enough
// runway that a piece still consolidating doesn't need to re-trigger this
// every single day. Matches Holding's own default startIntervalDays
// (docs/Repertoire-Lifecycle.md's ladder table) rather than being a bare
// arbitrary number.
const MINUTES_AUTO_EXTEND_STEP_DAYS = 14;

// scheduleMode: "minutes" mirror of the days-mode "past the plan with real
// work left" case above (isPlanActuallyComplete) — see
// docs/Decisions.md#scheduling for the asymmetry this generalizes. A
// minutes-mode piece never had a deadline to protect, so instead of a
// reschedule prompt, the plan just grows automatically to keep producing
// real content until the piece is actually learned (isPieceLearned).
// Reuses reconcileMinutesPerDaySchedule's rescheduleMarker-gated floor
// (below) to make the extension stick across reload — CLAUDE.md: don't
// touch that floor without keeping it, or this silently reverts.
//
// Returns null when no extension is warranted (wrong scheduleMode, still
// inside the current plan, or already learned). Otherwise a
// { daysToLearn, rescheduleMarker } patch, applied by the caller the same
// way handleReschedule's own minutes-mode branch already applies its
// (manually-triggered) result.
export function computeMinutesModeAutoExtend(piece, chunkSet, timeline) {
  if (piece.scheduleMode !== "minutes") return null;
  if (elapsedDay(piece) <= timeline.days.length) return null;
  if (isPieceLearned(piece, chunkSet)) return null;

  // Sized off the real elapsed day, not timeline.days.length, so a piece
  // that's sat unopened for far longer than one step still catches up in
  // a single extension rather than needing several reactive re-fires to
  // converge.
  const target = elapsedDay(piece) + MINUTES_AUTO_EXTEND_STEP_DAYS;
  if (target <= piece.daysToLearn) return null;

  const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, timeline.days.length);
  // Same gap Pass 65/73 fixed for handleReschedule/planRescheduleForPieces,
  // flagged but deliberately left unfixed here at the time — by the point
  // this auto-extend fires, introduction is normally long complete
  // (comment below), which is exactly the state where a connector's own
  // logged status (not its neighbors') is the only thing that can tell
  // computeEffectiveTimeline it still needs a placement. Without this, a
  // stuck, never-logged transition/combo on a minutes-mode piece could
  // never be caught by this auto-extend path at all, even though the
  // single-piece and bulk reschedule paths both now catch the identical
  // case.
  const remainingConnectorIds = computeRemainingConnectorIds(piece, chunkSet);
  return {
    daysToLearn: target,
    // asOfDay is pinned to the *new* final day — not `timeline.days.length`,
    // the anchor handleReschedule's own marker uses — so getEffectiveTimeline's
    // splice only ever re-packs that one trailing day. By the time this
    // auto-extend fires at all, introduction is normally long complete
    // (computeTimeline's own halfPoint rule guarantees it within the
    // *original* plan), so remainingChunkIds is typically empty here —
    // and an empty remainingChunkOrder anchored at the *old* last day
    // would blank Tier 1/2 placement for the *entire* newly-extended
    // region (getEffectiveTimeline gives a chunk no presence at all in
    // the re-packed sub-plan unless it's in remainingChunkOrder).
    // Anchoring at the new last day instead means only that single
    // trailing day goes unplaced; everything else keeps the full, real
    // placement computeTimeline produces against the larger daysToLearn.
    rescheduleMarker: {
      asOfDay: target,
      remainingChunkOrder: remainingChunkIds,
      remainingConnectorIds,
      previous: piece.rescheduleMarker || null,
    },
  };
}

// Whether the schedule-behind-schedule banner (ScheduleBanner.jsx) should
// render at all — Pass 16, redefined in Pass 39. `currentDay` (App.jsx's
// realCurrentDay, fed into computeScheduleStatus above) is clamped to
// timeline.days.length via getCurrentDay (lib/utils.js), so once a piece
// runs past its own plan it stays pinned at the last day forever — and
// computeScheduleStatus keeps finding chunks introduced before that pinned
// day with zero sessions, reporting a nonzero missedCount indefinitely.
// "Behind schedule" stops being a meaningful question once the plan is
// *actually* over (isPlanActuallyComplete — no longer just "the calendar
// ran out," see that function for why the two aren't the same question):
// the piece has moved into ongoing maintenance (computeDueReviews,
// lib/maintenance.js), the same condition TodayTab.jsx's `pastPlan` uses to
// switch into that mode. Takes `piece`/`chunkSet` (rather than a
// precomputed `elapsedDay` number, Pass 16's original signature) because
// isPlanActuallyComplete needs both the real piece and its full chunk set,
// not just one derived number — still a pure function of its inputs, same
// as every other export here.
//
// The last argument was originally always `computeScheduleStatus`'s
// missedCount (base practice chunks only). Same-session follow-up to Pass
// 70: ScheduleBanner.jsx now passes `countBehindDays` instead — a piece
// with every practice chunk touched but a transition, combo, or review
// still unlogged past its day is genuinely still behind, and missedCount
// alone couldn't see that (it never looks past practiceChunks), which used
// to suppress this banner — including Today's Practice's "Go to Day N"
// button, whose own day-search already had no such blind spot — for a
// piece that plainly still needed it. This function itself doesn't care
// which count it's handed; it just needs "is anything behind" as a number
// greater than zero.
export function shouldShowScheduleBanner(piece, chunkSet, timeline, behindCount) {
  if (isPlanActuallyComplete(piece, chunkSet, timeline)) return false;
  return behindCount > 0;
}

// A weekly-escalating "this plan has stalled" reminder — distinct from
// computeRevivalTriggers' 60-day staleness reason (lib/revival.js), which
// (as of this same change) only fires once a piece's plan is actually
// finished (isPlanActuallyComplete). That gate left a real gap: a piece
// still mid-learning whose target date has already passed, with no
// practice logged in weeks, got no equivalent nudge at all. This fills
// that gap without touching revival's own mechanism.
//
// Fires only for a piece that's active (mirrors every other
// schedule-related banner's own status gate — paused/archived pieces are
// consistently excluded from these throughout the app), not already in
// revival (revival is its own recovery flow with its own messaging), has
// logged practice at least once (`piece.lastLoggedAt` truthy — the same
// precondition computeRevivalTriggers' staleness check already requires;
// deliberately not extended with a `piece.createdAt` fallback for a piece
// never touched at all, since that's a different situation than "went
// quiet after being practiced"), and whose plan isn't actually complete.
//
// Returns null when none of that applies. Otherwise
// `{ daysSinceLogged, milestoneDays, targetDatePassed }` —
// `milestoneDays` steps in flat weekly increments (14, 21, 28, ...) off
// `daysSinceLogged` rather than displaying that raw, daily-changing number,
// so the reminder's wording only changes once a week instead of every day
// it's shown.
export function computeAbandonedPlanReminder(piece, chunkSet, timeline) {
  if ((piece.status || "active") !== "active") return null;
  if (isInRevival(piece)) return null;
  if (!piece.lastLoggedAt) return null;
  if (isPlanActuallyComplete(piece, chunkSet, timeline)) return null;

  const daysSinceLogged = daysBetweenInclusive(piece.lastLoggedAt, todayISODate()) - 1;
  if (daysSinceLogged < 14) return null;

  const milestoneDays = Math.floor(daysSinceLogged / 7) * 7;
  const targetDatePassed = elapsedDay(piece) > timeline.days.length;
  return { daysSinceLogged, milestoneDays, targetDatePassed };
}
