import { RotateCcw } from "lucide-react";
import { computeScheduleStatus, shouldShowScheduleBanner } from "../lib/scheduling";

/* ------------------------------------------------------------------ */
/*  Schedule banner (shared by Overview + Today)                      */
/* ------------------------------------------------------------------ */

export function ScheduleBanner({ piece, chunkSet, timeline, currentDay, onReschedule }) {
  const status = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, currentDay);
  // Pass 16, redefined Pass 39 — shouldShowScheduleBanner needs the full
  // piece/chunkSet (not just a precomputed elapsedDay number) to tell
  // "still in the plan" from "plan's actually over" from "calendar ran out
  // with real work left" apart. See that function for why those three
  // aren't all the same thing.
  if (!shouldShowScheduleBanner(piece, chunkSet, timeline, status.missedCount)) return null;
  return (
    <div className="schedule-banner">
      <div>
        <p className="schedule-banner-title">
          {status.missedCount} chunk{status.missedCount === 1 ? "" : "s"} behind schedule
        </p>
        <p className="schedule-banner-sub">
          Life happens. Rebalance what's left across the rest of your plan without losing what
          you've already learned.
        </p>
      </div>
      <button className="primary-btn" onClick={onReschedule}>
        <RotateCcw size={15} /> Reschedule remaining days
      </button>
    </div>
  );
}
