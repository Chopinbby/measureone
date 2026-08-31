import { ArrowLeft, RotateCcw } from "lucide-react";
import { shouldShowScheduleBanner, countBehindDays } from "../lib/scheduling";

/* ------------------------------------------------------------------ */
/*  Schedule banner (shared by Overview, Today, and Timeline)         */
/* ------------------------------------------------------------------ */

// `earliestBehindDay`/`onDayChange` are optional — only Today's Practice
// (Pass 47) has a "current day" to jump away from, so Overview and Timeline
// simply don't pass them and get the reschedule-only banner unchanged. When
// they are passed, the "go to the oldest unfinished day" action folds into
// this same banner instead of Today rendering a second one right below it —
// combined on request once both existed side by side.
export function ScheduleBanner({ piece, chunkSet, timeline, currentDay, onReschedule, earliestBehindDay, onDayChange }) {
  const behindDays = countBehindDays(piece, timeline, currentDay);
  // Pass 16, redefined Pass 39 — shouldShowScheduleBanner needs the full
  // piece/chunkSet (not just a precomputed elapsedDay number) to tell
  // "still in the plan" from "plan's actually over" from "calendar ran out
  // with real work left" apart. See that function for why those three
  // aren't all the same thing.
  //
  // Same-session follow-up to Pass 70: this used to pass
  // computeScheduleStatus's missedCount here instead of behindDays —
  // missedCount only ever looks at base practice chunks, so a piece with
  // every one of those touched but a transition/combo/review still
  // unlogged past its day read as fully caught up and suppressed the
  // banner entirely, even on Today's Practice where `earliestBehindDay`
  // (Pass 67's classifyDayCompletion-based scan, which never had this
  // blind spot) had already found a real day to jump to — the button was
  // computed correctly and then hidden behind this narrower gate. Passing
  // behindDays instead fixes that dead end and makes this the same signal
  // Master Agenda's per-piece badge already uses.
  if (!shouldShowScheduleBanner(piece, chunkSet, timeline, behindDays)) return null;
  const hasCatchUp = earliestBehindDay != null && typeof onDayChange === "function";
  return (
    <div className="schedule-banner">
      <div>
        <p className="schedule-banner-title">
          {behindDays} day{behindDays === 1 ? "" : "s"} behind schedule
        </p>
        <p className="schedule-banner-sub">
          {hasCatchUp
            ? "Life happens. Rebalance incomplete tasks across your remaining plan days, or pick up where you left off."
            : "Life happens. Rebalance what's left across the rest of your plan without losing what you've already learned."}
        </p>
      </div>
      <div className="schedule-banner-actions">
        <button className="primary-btn" onClick={onReschedule}>
          <RotateCcw size={15} /> Reschedule remaining days
        </button>
        {hasCatchUp && (
          <button className="ghost-btn" onClick={() => onDayChange(earliestBehindDay)}>
            <ArrowLeft size={15} /> Go to Day {earliestBehindDay}
          </button>
        )}
      </div>
    </div>
  );
}
