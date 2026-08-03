import { RotateCcw } from "lucide-react";
import { computeScheduleStatus } from "../lib/scheduling";

/* ------------------------------------------------------------------ */
/*  Schedule banner (shared by Overview + Today)                      */
/* ------------------------------------------------------------------ */

export function ScheduleBanner({ piece, practiceChunks, timeline, currentDay, onReschedule }) {
  const status = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
  if (status.missedCount === 0) return null;
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
