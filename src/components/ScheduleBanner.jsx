import { RotateCcw } from "lucide-react";
import { computeScheduleStatus, shouldShowScheduleBanner } from "../lib/scheduling";
import { elapsedDay } from "../lib/utils";

/* ------------------------------------------------------------------ */
/*  Schedule banner (shared by Overview + Today)                      */
/* ------------------------------------------------------------------ */

export function ScheduleBanner({ piece, practiceChunks, timeline, currentDay, onReschedule }) {
  const status = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
  // Pass 16 — currentDay is clamped into the plan (App.jsx's realCurrentDay),
  // so it alone can't tell "still in the plan" from "plan's over, currentDay
  // just stuck at the last day" apart. elapsedDay(piece) is the unclamped
  // read that can.
  if (!shouldShowScheduleBanner(elapsedDay(piece), timeline, status.missedCount)) return null;
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
