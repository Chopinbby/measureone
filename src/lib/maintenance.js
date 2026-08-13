import { EFFORT_TO_MIN } from "./constants";
import { daysBetweenInclusive } from "./utils";

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

// Strictly "due as of asOfDate" — a chunk due tomorrow is not due, and
// there is deliberately no forward-looking/upcoming window anywhere in
// this pass (see Decisions.md's "Scoped out" note).
//
// Suppression, both confirmed rather than assumed:
//   * paused/archived pieces — pause/archive already means "off my daily
//     plate" for schedule pressure generally, and maintenance is schedule
//     pressure.
//   * a piece with an active revival (`revival.startedAt` set) — revival
//     is already "something's wrong, working through it" mode; routine
//     maintenance shown alongside it would compete for attention with no
//     clear priority between the two.
//
// Returns [] (never null) in every suppressed/empty case, so callers can
// treat the result as a plain list.
export function computeDueReviews(piece, chunkSet, asOfDate) {
  if (!piece || !chunkSet || !asOfDate) return [];
  if ((piece.status || "active") !== "active") return [];
  if (piece.revival && piece.revival.startedAt) return [];

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

// Total estimated minutes for a due list — the same effort→minutes
// conversion every other time estimate in the app uses. Kept here so
// Master Agenda's summary and the Today tab's header can't drift apart.
export function totalDueMinutes(dueItems) {
  return dueItems.reduce((sum, item) => sum + item.minutes, 0);
}
