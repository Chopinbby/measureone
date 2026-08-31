import { ArrowLeft, RotateCcw } from "lucide-react";
import { computeScheduleStatus, shouldShowScheduleBanner } from "../lib/scheduling";

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
  const status = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, currentDay);
  // Pass 16, redefined Pass 39 — shouldShowScheduleBanner needs the full
  // piece/chunkSet (not just a precomputed elapsedDay number) to tell
  // "still in the plan" from "plan's actually over" from "calendar ran out
  // with real work left" apart. See that function for why those three
  // aren't all the same thing.
  if (!shouldShowScheduleBanner(piece, chunkSet, timeline, status.missedCount)) return null;
  const hasCatchUp = earliestBehindDay != null && typeof onDayChange === "function";
  return (
    <div className="schedule-banner">
      <div>
        <p className="schedule-banner-title">
          {status.missedCount} chunk{status.missedCount === 1 ? "" : "s"} behind schedule
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
