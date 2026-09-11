import { EFFORT_TO_MIN } from "./constants";
import { daysBetweenInclusive } from "./utils";
import { isInRevival } from "./revival";

/* ------------------------------------------------------------------ */
/*  "What's due" — the live maintenance query.                         */
/*                                                                     */
/*  Implements the surfacing half of the maintenance ladder            */
/*  (docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built,   */
/*  docs/Decisions.md#spaced-repetition--maintenance): lib/ladder.js    */
/*  has been writing progress[id].nextDueDate on every logged session  */
/*  since Pass 1, but nothing read it, so a review the ladder          */
/*  scheduled past the end of a piece's bounded plan could never reach */
/*  the learner.                                                        */
/*                                                                     */
/*  Deliberately independent of computeTimeline / timeline.days[]:     */
/*  nextDueDate is already a real calendar date, not a plan-day int,   */
/*  so this answers "what's due" for a piece whose plan ran out weeks  */
/*  ago just as well as for one still inside it. Both surfaces that    */
/*  show due work (Master Agenda's per-piece summary, the per-piece    */
/*  Today tab's full detail) call this same function — Master Agenda   */
/*  just renders less of the same result.                              */
/* ------------------------------------------------------------------ */

// Strictly "due as of asOfDate" — a chunk due tomorrow is not due here;
// that's what the forward-looking sibling computeDueOnDate (below) is for
// (the once-scoped-out due-in-N-days query, built later — see
// Decisions.md#open-questions).
//
// Suppression, both confirmed rather than assumed:
//   * paused/archived pieces — pause/archive already means "off my daily
//     plate" for schedule pressure generally, and maintenance is schedule
//     pressure.
//   * a piece with an active revival (isInRevival, lib/revival.js) — revival
//     is already "something's wrong, working through it" mode; routine
//     maintenance shown alongside it would compete for attention with no
//     clear priority between the two.
//
// Returns [] (never null) in every suppressed/empty case, so callers can
// treat the result as a plain list.
export function computeDueReviews(piece, chunkSet, asOfDate) {
  if (!piece || !chunkSet || !asOfDate) return [];
  if ((piece.status || "active") !== "active") return [];
  if (isInRevival(piece)) return [];

  const progress = piece.progress || {};
  const items = [];

  (chunkSet.all || []).forEach((chunk) => {
    const entry = progress[chunk.id];
    if (!entry || !entry.nextDueDate) return;
    // Rule 1 (Decisions.md#spaced-repetition--maintenance): a chunk
    // flagged for re-learning produces no due reviews — it's replacing
    // review, not running alongside it.
    if (entry.needsRelearning) return;
    // Both sides are 'YYYY-MM-DD', where lexicographic order is calendar
    // order — same comparison computeLastLoggedAt (storage.js) already
    // relies on for loggedDate.
    if (entry.nextDueDate > asOfDate) return;

    items.push({
      chunkId: chunk.id,
      chunk,
      dueDate: entry.nextDueDate,
      // A chunk that has never entered the ladder migrates in with
      // stage: null; if it somehow has a due date anyway, report the
      // floor rather than a blank stage.
      stage: entry.stage || "stabilizing",
      // 0 on the day it comes due, 1 the next day, and so on.
      daysOverdue: daysBetweenInclusive(entry.nextDueDate, asOfDate) - 1,
      minutes: Math.round((chunk.effort || 1) * EFFORT_TO_MIN),
    });
  });

  // Most overdue first — the thing that's been waiting longest is the
  // thing most at risk. Ties fall back to measure order so the list reads
  // front-to-back through the piece.
  items.sort((a, b) => b.daysOverdue - a.daysOverdue || a.chunk.start - b.chunk.start);
  return items;
}

// A single future calendar day's *newly* due items — an exact
// `nextDueDate === date` match, not "due as of this date" the way
// computeDueReviews answers for `asOfDate` (which folds in every earlier
// day's backlog too, by design — a chunk overdue since Tuesday is still
// due Wednesday). Built for WeekView.jsx's maintenance-mode week: once
// today's own cell already shows the real backlog via computeDueReviews,
// each cell *after* today should show only what that day itself adds, or
// a real backlog would silently re-count into every future cell too.
//
// This is the once-scoped-out "due-in-N-days" query
// (docs/Decisions.md#open-questions) — built on direct request. Same
// suppression rules as computeDueReviews (paused/archived/revival,
// needsRelearning), since it answers a narrower version of the identical
// underlying question.
export function computeDueOnDate(piece, chunkSet, date) {
  if (!piece || !chunkSet || !date) return [];
  if ((piece.status || "active") !== "active") return [];
  if (isInRevival(piece)) return [];

  const progress = piece.progress || {};
  const items = [];

  (chunkSet.all || []).forEach((chunk) => {
    const entry = progress[chunk.id];
    if (!entry || !entry.nextDueDate) return;
    if (entry.needsRelearning) return;
    if (entry.nextDueDate !== date) return;

    items.push({
      chunkId: chunk.id,
      chunk,
      dueDate: entry.nextDueDate,
      stage: entry.stage || "stabilizing",
      minutes: Math.round((chunk.effort || 1) * EFFORT_TO_MIN),
    });
  });

  items.sort((a, b) => a.chunk.start - b.chunk.start);
  return items;
}

// Total estimated minutes for a due list — the same effort→minutes
// conversion every other time estimate in the app uses. Kept here so
// Master Agenda's summary and the Today tab's header can't drift apart.
export function totalDueMinutes(dueItems) {
  return dueItems.reduce((sum, item) => sum + item.minutes, 0);
}

// Pass 66: before this, computeDueReviews only ever ran once a piece had
// exhausted its whole bounded plan (see DueReviewPanel in TodayTab.jsx and
// the past-plan branch in MasterAgendaTab.jsx) — a review whose
// nextDueDate had already passed while the piece was still comfortably
// inside its active plan had no live surface at all. Its placement day
// (computeTimeline's own once-per-piece scheduling) had already gone by,
// so it would only reappear if you paged day-nav back to that exact past
// day. This merges computeDueReviews' now-unconditional result into a
// plan day's own reviewChunkIds for display/logging.
//
// De-duplicates against day.reviewChunkIds: a review due *exactly* today
// is already placed there by computeTimeline, and would otherwise be
// counted (and rendered) twice — once from the day's own placement, once
// from the live due-query.
//
// Folds each extra item's own `minutes` into day.minutes too — safe to add
// directly (not double-priced) because computeTimeline's minutesFor and
// computeDueReviews both cost a review at chunk.effort * EFFORT_TO_MIN, the
// same rate as introducing the chunk fresh. (Before the difficulty-based
// review pricing follow-up, minutesFor priced a review at a flat 3 minutes
// regardless of the chunk — merging minutes then would have mixed two
// disagreeing estimates, so only the id list merged. Now that both sides
// agree, the displayed total can fold in cleanly.)
//
// Skips consolidation ("full run-through") days entirely — found in
// self-review, not part of the original fix. computeTimeline already
// blankets a consolidation day's reviewChunkIds with every practice chunk
// regardless of ladder state, and neither TodayTab's ConsolidationPanel nor
// MasterAgendaTab's card renders reviewChunkIds or minutes for one at all
// (it's just "play through the whole piece"). Merging a transition/combo's
// overdue live-due review in on that day type would have inflated
// day.minutes — and therefore Master Agenda's total-planned figure — with
// no corresponding line item anywhere on screen: a number the user can't
// account for, not a display gap worth routing around. That item still
// surfaces normally on any other day, or once the piece is past its plan
// (the unrelated pastPlan/DueReviewPanel path, which never reads `day` at
// all) — this only stops it from being silently double-counted into a day
// that was never going to itemize it.
export function mergeLiveDueReviews(day, dueItems) {
  if (day.type === "consolidation") return day;
  const extra = dueItems.filter((item) => !day.reviewChunkIds.includes(item.chunkId));
  if (extra.length === 0) return day;
  return {
    ...day,
    reviewChunkIds: [...day.reviewChunkIds, ...extra.map((item) => item.chunkId)],
    minutes: day.minutes + extra.reduce((sum, item) => sum + item.minutes, 0),
  };
}
