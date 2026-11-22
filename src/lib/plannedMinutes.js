import { EFFORT_TO_MIN } from "./constants";
import { isValidFeel } from "./runThrough";

// Pass 137 — what a practice card says about time.
//
// ONE price per task: the chunk's effort times EFFORT_TO_MIN, rounded to a whole
// minute. It is the same conversion every other time estimate uses
// (computeTimeline's `minutesFor` sums chunk.effort * EFFORT_TO_MIN for a day;
// maintenance.js prices a due review as Math.round((chunk.effort || 1) *
// EFFORT_TO_MIN)). A transition and a combo are chunks with their own `effort`,
// so they price the same way. This function is the card's copy of that rule, not a
// second formula: test/plannedMinutes.test.mjs pins it to both of those, so a
// change to one fails the test until the other follows.
//
// A section run-through ("sr_<id>") and a section-pair run-through ("st_<id>")
// have NO `effort`: computeSectionRunThroughs builds them without one and
// computeTimeline never places them, so they carry no price today. For a chunk
// with no effort this returns null and the card shows no estimate, instead of
// inventing a number (found while building Pass 137; what a run-through should
// cost is Pass 142 and 145's question, not a card's).
//
// The card shows it rounded, the day header rounds a SUM, so the cards on a day
// can differ from the header by a minute or two (three 2.5-minute cards read
// "3 min" each, 9 in all, against a header of 8). That is the cost of showing
// whole minutes on a card, chosen with the owner (Pass 137).
//
// Display only: nothing here changes how days are planned or priced, and nothing
// reads a card's logged time back into a schedule (Pass 145 owns any learned
// estimate).
export function plannedMinutesFor(chunk) {
  const effort = chunk ? Number(chunk.effort) : NaN;
  if (!Number.isFinite(effort) || effort <= 0) return null;
  return Math.round(effort * EFFORT_TO_MIN);
}

// Before logging, beside the timer.
export function plannedAboutText(plannedMinutes) {
  return `planned about ${plannedMinutes} min`;
}

// Total logged seconds across some sessions (a card can hold several attempts
// on the same day). Sessions without a duration, or with a bad one, count as 0.
export function secondsSpentIn(sessions) {
  return (sessions || []).reduce((sum, s) => {
    const n = s && Number(s.durationSeconds);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

// After logging: planned and spent side by side, in neutral words. Nothing here
// judges a longer or a shorter time: no colour, no "over", no "under". With no
// time logged, only the plan is shown.
export function plannedSpentText(plannedMinutes, spentSeconds) {
  const planned = `${plannedMinutes} min planned`;
  if (!(spentSeconds > 0)) return planned;
  const spent = spentSeconds < 60 ? "under 1 min spent" : `${Math.round(spentSeconds / 60)} min spent`;
  return `${planned}, ${spent}`;
}

// Pass 72's wall-clock rule, as a pure function so it can be tested. A running
// timer remembers the wall-clock moment its current stretch began and the seconds
// it already held (`{ startedAt, baseSeconds }`), and every reading is
// recomputed from the clock. A backgrounded tab that skips timer ticks therefore
// cannot fall behind: the first reading after it comes back is already right.
// `round` is Math.round for the live display and Math.floor for the value saved
// at the moment of a click (the same split ChecklistItem uses).
export function elapsedSeconds(timer, now, round = Math.round) {
  if (!timer) return 0;
  return Math.max(0, timer.baseSeconds + round((now - timer.startedAt) / 1000));
}

// A logged whole-piece run-through, stored in piece.progress["__consolidation__"].sessions
// (App.jsx's handleLogRunThrough). `durationSeconds` is the card's timer. It is saved
// ONLY when there is a time: a session without one has exactly the shape it had before
// Pass 137 (no new key, nothing materialized), so older sessions and new ones without a
// time load, save and merge alike (sessions are compared by content, never by a field
// list). Time practiced totals (lib/utils.js sumPracticeSeconds) add every entry's
// durationSeconds, so a run-through's time now joins them. Cold-Start sessions are a
// separate key and are not touched.
//
// Pass 142: `feel`, the "how did that feel?" number from 1 to 10, is saved the same way:
// ONLY when the person picked one (a whole number in range), so a run-through logged
// without it has exactly the shape it always had. Nothing reads it to decide anything
// (lib/runThrough.js says why); it is shown back as the previous run-through's number.
export function buildRunThroughSession({ day, stopCount, loggedAt, loggedDate, durationSeconds, feel }) {
  const seconds = Math.round(Number(durationSeconds));
  return {
    day,
    stopCount,
    loggedAt,
    loggedDate,
    ...(Number.isFinite(seconds) && seconds > 0 ? { durationSeconds: seconds } : {}),
    ...(isValidFeel(feel) ? { feel } : {}),
  };
}
