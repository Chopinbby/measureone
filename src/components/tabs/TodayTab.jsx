import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ScheduleBanner } from "../ScheduleBanner";
import { FocusPanel } from "./today/FocusPanel";
import { SectionRunThroughPanel } from "./today/SectionRunThroughPanel";
import { DayChecklist } from "./today/DayChecklist";
import { ChecklistItem } from "./today/ChecklistItem";
import { ReassessPanel } from "./today/ReassessPanel";
import { WeekView } from "./today/WeekView";
import { computeDueReviews, totalDueMinutes } from "../../lib/maintenance";
import { isInRevival } from "../../lib/revival";
import { elapsedDay as computeElapsedDay, todayISODate, formatMinutes } from "../../lib/utils";

// Once a piece runs past the end of its bounded plan there is no "Day N of
// N" left to show — the plan grid is exhausted, but the maintenance ladder
// keeps scheduling reviews on real calendar dates. This panel is what the
// day view becomes in that state: the live due list from
// computeDueReviews, logged through exactly the same ChecklistItem the
// bounded plan uses.
function DueReviewPanel({ piece, dueItems, day, onLogSession, onUnlogSession }) {
  if (dueItems.length === 0) {
    // computeDueReviews returns [] both for "genuinely nothing due" and for
    // a suppressed piece (paused/archived/mid-revival), and those need
    // different copy — an overdue chunk on a paused piece is being held
    // back deliberately, not absent. Mirrors that function's suppression
    // rules for wording only; the list itself still comes from there.
    const status = piece.status || "active";
    const suppressed =
      status !== "active"
        ? `Maintenance reviews are paused while this piece is ${status}.`
        : isInRevival(piece)
          ? "Maintenance reviews are set aside while a revival is running — the Revival tab has the plan."
          : null;

    return (
      <div className="panel">
        <h3>Nothing due today</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>
          {suppressed ||
            "Every chunk's next maintenance review is still ahead. Play the piece for the joy of it — the next review will show up here on the day it's due."}
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Due today — {formatMinutes(totalDueMinutes(dueItems))} planned</h3>
      <div className="checklist">
        {dueItems.map(({ chunkId, chunk }) => (
          <ChecklistItem
            key={chunkId}
            chunk={chunk}
            role="review"
            piece={piece}
            day={day}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ))}
      </div>
      {/* A review arriving late is schedule slack, never a failure — the
          overdue count is stated plainly here, with no penalty language and
          no effect on the ladder itself (only the logged outcome may move
          that). See docs/Repertoire-Lifecycle.md. */}
      <p className="wizard-hint" style={{ marginTop: 12, marginBottom: 0 }}>
        {dueItems.filter((i) => i.daysOverdue > 0).length > 0
          ? "Some of these have been waiting a few days. That's fine — take them in order."
          : "All of these came due today."}
      </p>
    </div>
  );
}

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
  onLogRunThrough,
  onUnlogRunThrough,
  onReschedule,
  onReassessRange,
  onSetMemoryAnchor,
}) {
  const [viewMode, setViewMode] = useState("day");
  const day = timeline.days[currentDay - 1];
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const practiceChunks = chunks.filter((c) => c.kind === "section");

  // getCurrentDay (lib/utils) clamps into the plan, so `currentDay` can
  // never report a day past the end — the unclamped elapsed day is what
  // tells us the plan has actually run out.
  const elapsedDay = computeElapsedDay(piece);
  // Only when actually parked on real "today". A day explicitly picked
  // from the Timeline tab still renders that day's plan grid, past-plan or
  // not — otherwise a past-plan piece's plan would become unreachable.
  const pastPlan = isRealToday && elapsedDay > timeline.days.length;

  // computeDueReviews only reads chunkSet.all; TodayTab already receives
  // exactly that list as `chunks`, so it's wrapped rather than threading a
  // second prop through App.jsx.
  const dueItems = useMemo(
    () => (pastPlan ? computeDueReviews(piece, { all: chunks }, todayISODate()) : []),
    [pastPlan, piece, chunks]
  );

  // Past the plan, "today's work" is the due list rather than a plan day,
  // and sessions there are keyed to elapsedDay — so Reassess offers the
  // ranges actually touched today in either mode.
  const todaysDayNumber = pastPlan ? elapsedDay : currentDay;
  const todaysIds = pastPlan
    ? dueItems.map((i) => i.chunkId)
    : [...day.newChunkIds, ...day.specialChunkIds, ...day.reviewChunkIds];

  // Clicking a day in the week view drops into that day's own view — the
  // week is a way in, never a second place to work. Past the plan there's
  // no plan day to switch to (day nav is disabled entirely in that mode),
  // so the maintenance cell passes null and only the view mode changes.
  const handleSelectWeekDay = (dayNumber) => {
    if (dayNumber != null) onDayChange(dayNumber);
    setViewMode("day");
  };

  const todaysRanges = [...new Set(todaysIds)]
    .filter((id) => ((piece.progress[id] || {}).doneDays || []).includes(todaysDayNumber))
    .map((id) => chunkById[id])
    .filter(Boolean)
    .map((c) => ({ start: c.start, end: c.end }));

  return (
    <div className="tab-pane">
      <ScheduleBanner piece={piece} practiceChunks={practiceChunks} timeline={timeline} currentDay={currentDay} onReschedule={onReschedule} />

      <div className="tab-header day-nav">
        <div>
          <h1>Today's Practice</h1>
          <p className="hero-sub">
            {pastPlan
              ? `Plan complete — maintenance, day ${elapsedDay}`
              : `Day ${currentDay} of ${timeline.days.length}${!isRealToday ? " (viewing)" : ""}`}
          </p>
        </div>
        <div className="day-nav-controls">
          <div className="segmented">
            <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")}>Day view</button>
            <button className={viewMode === "week" ? "active" : ""} onClick={() => setViewMode("week")}>Week</button>
            <button className={viewMode === "all" ? "active" : ""} onClick={() => setViewMode("all")}>View all</button>
          </div>
          {viewMode === "day" && (
            <>
              {/* Past the end of the plan there's no bounded grid left to
                  page through, so day nav is disabled outright rather than
                  paging around a plan the piece has already outgrown. */}
              <button className="icon-btn" disabled={pastPlan || currentDay <= 1} onClick={() => onDayChange(currentDay - 1)} aria-label="Previous day"><ChevronLeft size={16} /></button>
              {!isRealToday && <button className="ghost-btn" onClick={onJumpToday}>Jump to today</button>}
              <button className="icon-btn" disabled={pastPlan || currentDay >= timeline.days.length} onClick={() => onDayChange(currentDay + 1)} aria-label="Next day, or work ahead"><ChevronRight size={16} /></button>
            </>
          )}
        </div>
      </div>

      <FocusPanel piece={piece} chunks={chunks} currentDay={currentDay} />

      {viewMode === "day" ? (
        pastPlan ? (
          <DueReviewPanel
            piece={piece}
            dueItems={dueItems}
            day={elapsedDay}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ) : (
          <DayChecklist piece={piece} chunks={chunks} day={day} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onLogRunThrough={onLogRunThrough} onUnlogRunThrough={onUnlogRunThrough} onSetMemoryAnchor={onSetMemoryAnchor} />
        )
      ) : viewMode === "week" ? (
        <WeekView
          piece={piece}
          chunks={chunks}
          timeline={timeline}
          currentDay={currentDay}
          isRealToday={isRealToday}
          pastPlan={pastPlan}
          dueItems={dueItems}
          onSelectDay={handleSelectWeekDay}
        />
      ) : (
        <div className="view-all-list">
          {timeline.days.map((d) => (
            <DayChecklist key={d.dayNumber} piece={piece} chunks={chunks} day={d} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onLogRunThrough={onLogRunThrough} onUnlogRunThrough={onUnlogRunThrough} onSetMemoryAnchor={onSetMemoryAnchor} />
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
