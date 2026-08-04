import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ScheduleBanner } from "../ScheduleBanner";
import { FocusPanel } from "./today/FocusPanel";
import { SectionRunThroughPanel } from "./today/SectionRunThroughPanel";
import { DayChecklist } from "./today/DayChecklist";
import { ReassessPanel } from "./today/ReassessPanel";

export function TodayTab({
  piece,
  chunks,
  timeline,
  currentDay,
  onDayChange,
  isRealToday,
  onJumpToday,
  onLogSession,
  onUnlogSession,
  onToggleDone,
  onReschedule,
  onReassessRange,
}) {
  const [viewMode, setViewMode] = useState("day");
  const day = timeline.days[currentDay - 1];
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const practiceChunks = chunks.filter((c) => c.kind === "section");

  const todaysRanges = [...new Set(
    [...day.newChunkIds, ...day.specialChunkIds, ...day.reviewChunkIds]
  )]
    .filter((id) => ((piece.progress[id] || {}).doneDays || []).includes(currentDay))
    .map((id) => chunkById[id])
    .filter(Boolean)
    .map((c) => ({ start: c.start, end: c.end }));

  return (
    <div className="tab-pane">
      <ScheduleBanner piece={piece} practiceChunks={practiceChunks} timeline={timeline} currentDay={currentDay} onReschedule={onReschedule} />

      <div className="tab-header day-nav">
        <div>
          <h1>Today's Practice</h1>
          <p className="hero-sub">Day {currentDay} of {timeline.days.length}{!isRealToday ? " (viewing)" : ""}</p>
        </div>
        <div className="day-nav-controls">
          <div className="segmented">
            <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")}>Day view</button>
            <button className={viewMode === "all" ? "active" : ""} onClick={() => setViewMode("all")}>View all</button>
          </div>
          {viewMode === "day" && (
            <>
              <button className="icon-btn" disabled={currentDay <= 1} onClick={() => onDayChange(currentDay - 1)} aria-label="Previous day"><ChevronLeft size={16} /></button>
              {!isRealToday && <button className="ghost-btn" onClick={onJumpToday}>Jump to today</button>}
              <button className="icon-btn" disabled={currentDay >= timeline.days.length} onClick={() => onDayChange(currentDay + 1)} aria-label="Next day, or work ahead"><ChevronRight size={16} /></button>
            </>
          )}
        </div>
      </div>

      <FocusPanel piece={piece} chunks={chunks} currentDay={currentDay} />

      {viewMode === "day" ? (
        <DayChecklist piece={piece} chunks={chunks} day={day} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onToggleDone={onToggleDone} />
      ) : (
        <div className="view-all-list">
          {timeline.days.map((d) => (
            <DayChecklist key={d.dayNumber} piece={piece} chunks={chunks} day={d} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onToggleDone={onToggleDone} />
          ))}
        </div>
      )}

      {/* Section run-throughs are the longest tasks — a full continuous
          play-through, not a single chunk — so they always sit below the
          day's regular checklist. */}
      <SectionRunThroughPanel
        piece={piece}
        practiceChunks={practiceChunks}
        currentDay={currentDay}
        onLogSession={onLogSession}
        onUnlogSession={onUnlogSession}
      />

      <ReassessPanel piece={piece} todaysRanges={todaysRanges} onReassessRange={onReassessRange} />
    </div>
  );
}
