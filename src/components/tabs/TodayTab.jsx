import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { ScheduleBanner } from "../ScheduleBanner";
import { FocusPanel } from "./today/FocusPanel";
import { SectionRunThroughPanel } from "./today/SectionRunThroughPanel";
import { ColdStartPanel } from "./today/ColdStartPanel";
import { RandomStartPanel, chunkEntry } from "./revival/RandomStartPanel";
import { DayChecklist } from "./today/DayChecklist";
import { ChecklistItem } from "./today/ChecklistItem";
import { ReassessPanel } from "./today/ReassessPanel";
import { WeekView } from "./today/WeekView";
import { InterleavePanel } from "./today/InterleavePanel";
import { computeDueReviews, totalDueMinutes, mergeLiveDueReviews } from "../../lib/maintenance";
import { isInterleaveEligible } from "../../lib/ladder";
import { isInRevival } from "../../lib/revival";
import { isPlanActuallyComplete, computeScheduleStatus, classifyDayCompletion, isDayFullySwept } from "../../lib/scheduling";
import { elapsedDay as computeElapsedDay, todayISODate, formatMinutes, hasPendingProvisionalSession } from "../../lib/utils";

// Once a piece runs past the end of its bounded plan there is no "Day N of
// N" left to show — the plan grid is exhausted, but the maintenance ladder
// keeps scheduling reviews on real calendar dates. This panel is what the
// day view becomes in that state: the live due list from
// computeDueReviews, logged through exactly the same ChecklistItem the
// bounded plan uses.
function DueReviewPanel({ piece, dueItems, day, onLogSession, onUnlogSession, onConfirmProvisionalSession, onDiscardProvisionalSession }) {
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
            onConfirmProvisionalSession={onConfirmProvisionalSession}
            onDiscardProvisionalSession={onDiscardProvisionalSession}
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
  realCurrentDay,
  onDayChange,
  isRealToday,
  onJumpToday,
  onLogSession,
  onUnlogSession,
  onConfirmProvisionalSession,
  onDiscardProvisionalSession,
  onLogRunThrough,
  onUnlogRunThrough,
  onLogColdStart,
  onUnlogColdStart,
  onSetOverallConfidence,
  onReschedule,
  onReassessRange,
  onSetMemoryAnchor,
  onInterleaveRiskChange,
  onConfirmLeaveInterleaved,
}) {
  const [viewMode, setViewMode] = useState("day");
  const day = timeline.days[currentDay - 1];
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const practiceChunks = chunks.filter((c) => c.kind === "section");
  // TodayTab already receives exactly chunkSet.all (as `chunks`) and
  // derives practiceChunks locally above — this is the same shape a real
  // chunkSet carries, built here rather than threading a new prop through
  // App.jsx for it.
  const chunkSet = { all: chunks, practiceChunks };

  // getCurrentDay (lib/utils) clamps into the plan, so `currentDay` can
  // never report a day past the end — the unclamped elapsed day is what
  // tells us the plan has actually run out.
  const elapsedDay = computeElapsedDay(piece);
  // Only when actually parked on real "today". A day explicitly picked
  // from the Timeline tab still renders that day's plan grid, past-plan or
  // not — otherwise a past-plan piece's plan would become unreachable.
  // Pass 39: the calendar running out is no longer sufficient on its own —
  // see isPlanActuallyComplete (lib/scheduling.js) for what "actually
  // complete" now means per scheduleMode.
  const pastPlan = isRealToday && isPlanActuallyComplete(piece, chunkSet, timeline);
  // The calendar-elapsed-but-not-actually-complete case, scheduleMode:
  // "days" only. A minutes-mode piece in the equivalent state doesn't get
  // this prompt — there was never a deadline to protect, so App.jsx's
  // auto-extend effect (computeMinutesModeAutoExtend) grows the plan
  // automatically instead of asking. See docs/Decisions.md#scheduling for
  // the asymmetry. Paused/archived pieces are excluded the same way every
  // other schedule-pressure surface already excludes them (ScheduleBanner
  // above self-suppresses via computeScheduleStatus's missedCount, which
  // this banner doesn't route through, so it needs its own check).
  const needsRescheduleNudge =
    isRealToday &&
    elapsedDay > timeline.days.length &&
    !pastPlan &&
    (piece.status || "active") === "active" &&
    piece.scheduleMode !== "minutes";
  // isPlanActuallyComplete's "days"-mode bar covers chunkSet.all (practice
  // chunks, transitions, combos), but the reschedule mechanism itself
  // (handleReschedule/rescheduleMarker/getEffectiveTimeline) only ever
  // knows how to re-place *practice chunks* — a transition/combo rides
  // along with its neighboring chunk's touched status, not its own. So
  // needsRescheduleNudge can be true with nothing a reschedule can actually
  // act on, if every practice chunk is touched and the only thing left is a
  // transition/focus block. Distinguished here so the banner can say
  // something true in that case instead of offering a button that would
  // silently no-op — see docs/Decisions.md#scheduling.
  // Computed unconditionally (not just inside needsRescheduleNudge's "&&"
  // short-circuit like before) — Pass 47's catch-up action (folded into
  // ScheduleBanner below) needs the same status regardless of whether the
  // past-target-date nudge is showing.
  const scheduleStatus = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
  const hasReschedulableWork = needsRescheduleNudge && scheduleStatus.remainingChunkIds.length > 0;

  // Pass 47 — an alternative to Reschedule, not a replacement: rescheduling
  // changes the plan itself, this just offers to go work on old, still-valid
  // material instead of (or before) today's. Only offered when there's
  // genuinely untouched work from a day that's already passed — a chunk
  // introduced *today* and not yet logged doesn't count, that's just normal,
  // unstarted "today," not "behind."
  // Reuses classifyDayCompletion (Pass 45) rather than a second definition
  // of "incomplete" — scans forward from day 1 so "earliest" really means
  // earliest, not just the day the first untouched chunk happens to live on
  // (a day can be "behind" from an unfinished review/transition even once
  // every chunk it *introduced* is done). Stops before realCurrentDay
  // itself (Pass 74 — this scan anchors to the real current day, not
  // whichever day is currently being browsed, so a catch-up target found
  // while paging through the past/future is still correct): classifyDay-
  // Completion treats realCurrentDay and later as "future," never
  // "behind," so scanning further is guaranteed empty.
  //
  // A day classifyDayCompletion calls "behind" can still be one Pass 48
  // collapses to "Tasks rescheduled" — classifyDayCompletion only reads
  // doneDays, it has no idea the day's original tasks were swept into a
  // reschedule and now live somewhere else. Found live, post-review: after
  // any reschedule, the earliest "behind" day is reliably day 1 again (its
  // stale newChunkIds are still all undone, by definition), so without this
  // guard the button would send you to that empty collapsed day instead of
  // wherever the work actually moved. isDayFullySwept (lib/scheduling.js,
  // shared with TimelineTab.jsx and DayChecklist.jsx — Pass 74 follow-up
  // consolidated what used to be three separate copies of this exact
  // check) — a day this scan would otherwise land on gets skipped, not
  // returned, so "earliest incomplete day" keeps meaning a day with
  // something real left to do.
  const findEarliestBehindDay = () => {
    for (const d of timeline.days) {
      if (d.dayNumber >= realCurrentDay) break;
      if (isDayFullySwept(d, piece, chunkById)) continue;
      if (classifyDayCompletion(d, piece, realCurrentDay) === "behind") return d.dayNumber;
    }
    return null;
  };
  // Run unconditionally (Pass 67) — this scan is now the sole source of
  // truth for both whether the catch-up button shows and which day it
  // points to. Its own dayNumber >= currentDay boundary and isFullySwept
  // skip already do everything a separate chunk-level pre-check
  // (hasBehindWork, removed) was trying to do, just correctly and for
  // every scheduled item type (reviews, transitions, combos), not only
  // practice chunks.
  const earliestBehindDay = findEarliestBehindDay();

  // computeDueReviews only reads chunkSet.all; TodayTab already receives
  // exactly that list as `chunks`, so it's wrapped rather than threading a
  // second prop through App.jsx.
  //
  // Unconditional as of Pass 66 — this used to run only once pastPlan was
  // true (DueReviewPanel below is what originally motivated it). Always
  // computing it here closes the gap for a piece still inside its plan:
  // the merge just below folds the result into today's own checklist
  // instead of leaving it usable only in the past-plan panel.
  const dueItems = useMemo(
    () => computeDueReviews(piece, { all: chunks }, todayISODate()),
    [piece, chunks]
  );

  // Only for real "today", still inside the plan: a past/future day paged
  // to via day nav is a specific scheduled day, not "as of today" status,
  // so live due-as-of-today reviews don't belong merged into it — see
  // mergeLiveDueReviews (lib/maintenance.js) for the de-dup rule.
  const dayForChecklist = !pastPlan && isRealToday ? mergeLiveDueReviews(day, dueItems) : day;

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

  // Interleaved mode (Pass 29) reuses this exact "today" list rather than
  // building a separate chunk-selection mechanism — just narrowed to
  // chunks that have actually left Stabilizing (isInterleaveEligible,
  // lib/ladder.js). A chunk can appear twice in todaysIds (e.g. a review
  // id also present some other way); de-duped the same way todaysRanges
  // already does below.
  const interleaveItems = [...new Set(todaysIds)]
    .map((id) => chunkById[id])
    .filter(Boolean)
    .filter((c) => isInterleaveEligible(piece.progress[c.id]))
    .map((c) => ({ id: c.id, chunk: c }));

  // User-directed follow-up: while actively in Interleaved mode, an
  // unconfirmed provisional log (a rough interleaved attempt that hasn't
  // been confirmed or discarded — see App.jsx's handleLogSession
  // `provisional` branch) shouldn't be silently abandoned by navigating
  // away. Scoped to today's day and the current rotation only — an older
  // provisional from a previous session sitting unresolved elsewhere isn't
  // "the current rotation" and deliberately doesn't trigger this.
  const interleavePendingChunkIds =
    viewMode === "interleave"
      ? interleaveItems.filter((item) => hasPendingProvisionalSession(piece.progress[item.id], todaysDayNumber)).map((item) => item.id)
      : [];

  // Reports the live risk up to App.jsx, which needs it to gate leaving
  // the tab entirely (sidebar nav, the piece switcher) — navigations this
  // component has no say over.
  //
  // Keyed on `interleavePendingKey` (the chunk ids joined into one string)
  // rather than the array itself: `interleavePendingChunkIds` is a new
  // array *reference* every render even when its *contents* haven't
  // changed, and this effect calls a state setter (App.jsx's
  // setInterleaveRisk) — depending on the array directly, or omitting the
  // dependency array to "always stay fresh," both send a new object up on
  // every render regardless of content, which App.jsx's state setter sees
  // as a real change, triggering a re-render, re-running this effect,
  // sending yet another new object — an infinite loop (caught in manual
  // testing as React's "Maximum update depth exceeded" warning, not
  // theoretical). The joined-string key only changes when the actual
  // pending-chunk-ids content changes, which is what should gate this.
  const interleavePendingKey = interleavePendingChunkIds.join(",");
  useEffect(() => {
    if (typeof onInterleaveRiskChange !== "function") return;
    onInterleaveRiskChange(
      interleavePendingChunkIds.length > 0 ? { chunkIds: interleavePendingChunkIds, day: todaysDayNumber } : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interleavePendingKey, todaysDayNumber, onInterleaveRiskChange]);
  // Defensive reset on unmount only (leaving the Today tab is already
  // gated before this can unmount mid-risk, so this should be a no-op in
  // practice — but a stale risk outliving the component it describes
  // would be a strictly worse failure mode than a redundant reset).
  useEffect(() => {
    return () => {
      if (typeof onInterleaveRiskChange === "function") onInterleaveRiskChange(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by every way this component itself can leave Interleaved mode
  // (currently just the segmented control below) — confirms and discards
  // via the one function App.jsx owns (onConfirmLeaveInterleaved), so the
  // warning text and discard behavior can't drift between this path and
  // the sidebar/piece-switcher path, which reads the risk this component
  // just reported above instead of recomputing it separately.
  const leaveInterleaved = (nextMode) => {
    if (interleavePendingChunkIds.length > 0 && typeof onConfirmLeaveInterleaved === "function") {
      if (!onConfirmLeaveInterleaved(interleavePendingChunkIds, todaysDayNumber)) return;
    }
    setViewMode(nextMode);
  };

  const todaysRanges = [...new Set(todaysIds)]
    .filter((id) => ((piece.progress[id] || {}).doneDays || []).includes(todaysDayNumber))
    .map((id) => chunkById[id])
    .filter(Boolean)
    .map((c) => ({ start: c.start, end: c.end }));

  // Random Start (Pass 57) — the same "don't let yourself always start
  // from the top" pool RevivalTab/MasterAgendaTab already use (chunkEntry,
  // components/tabs/revival/RandomStartPanel.jsx), scoped here to whatever
  // in this piece already has 2+ logged sessions: practice chunks,
  // transitions, and combos alike (chunkEntry already labels all three
  // correctly, so no filtering to practice chunks only).
  const randomStartPool = chunks
    .filter((c) => ((piece.progress[c.id] || {}).sessions || []).length >= 2)
    .map((c) => chunkEntry(c, piece.memoryAnchors && piece.memoryAnchors[c.id]));

  return (
    <div className="tab-pane">
      <ScheduleBanner
        piece={piece}
        chunkSet={chunkSet}
        timeline={timeline}
        realCurrentDay={realCurrentDay}
        onReschedule={onReschedule}
        earliestBehindDay={earliestBehindDay}
        onDayChange={onDayChange}
      />
      {needsRescheduleNudge && (
        <div className="schedule-banner">
          {hasReschedulableWork ? (
            <>
              <div>
                <p className="schedule-banner-title">Past your target date</p>
                <p className="schedule-banner-sub">
                  There's still real work left in this plan. Reschedule to pick a new target date,
                  or fit what's left into the time you have.
                </p>
              </div>
              <button className="primary-btn" onClick={onReschedule}>
                <RotateCcw size={15} /> Reschedule
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="schedule-banner-title">Past your target date</p>
                <p className="schedule-banner-sub">
                  Every chunk has been introduced — what's left is a transition or focus block
                  still waiting to be logged. Nothing to reschedule; check "All Tasks" below to find
                  it.
                </p>
              </div>
              <button className="primary-btn" onClick={() => leaveInterleaved("all")}>
                All Tasks
              </button>
            </>
          )}
        </div>
      )}

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
            <button className={viewMode === "day" ? "active" : ""} onClick={() => leaveInterleaved("day")}>Day View</button>
            <button className={viewMode === "week" ? "active" : ""} onClick={() => leaveInterleaved("week")}>Week View</button>
            <button className={viewMode === "all" ? "active" : ""} onClick={() => leaveInterleaved("all")}>All Tasks</button>
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
      {/* Pulled out of the segmented view-mode control (Day View/Week
          View/All Tasks) into its own button — entering Interleaved mode
          is a distinct action, not another way to view the same day, so it
          reads oddly grouped alongside those three. Doesn't route through
          leaveInterleaved like the others do, since you're never leaving
          Interleaved mode by clicking this — only entering it. */}
      <button
        type="button"
        className={`ghost-btn interleave-mode-btn ${viewMode === "interleave" ? "active" : ""}`}
        style={{ alignSelf: "flex-start" }}
        disabled={interleaveItems.length === 0}
        onClick={() => setViewMode("interleave")}
      >
        Interleaved practice
      </button>
      {interleaveItems.length === 0 && (
        <p className="wizard-hint" style={{ marginTop: -8 }}>
          Interleaved mode unlocks once at least one chunk graduates past Stabilizing — no chunks have graduated past
          Stabilizing yet.
        </p>
      )}

      <FocusPanel piece={piece} chunks={chunks} currentDay={currentDay} />

      {viewMode === "day" ? (
        pastPlan ? (
          <DueReviewPanel
            piece={piece}
            dueItems={dueItems}
            day={elapsedDay}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
            onConfirmProvisionalSession={onConfirmProvisionalSession}
            onDiscardProvisionalSession={onDiscardProvisionalSession}
          />
        ) : (
          <DayChecklist
            piece={piece}
            chunks={chunks}
            day={dayForChecklist}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
            onConfirmProvisionalSession={onConfirmProvisionalSession}
            onDiscardProvisionalSession={onDiscardProvisionalSession}
            onLogRunThrough={onLogRunThrough}
            onUnlogRunThrough={onUnlogRunThrough}
            onSetMemoryAnchor={onSetMemoryAnchor}
          />
        )
      ) : viewMode === "interleave" ? (
        <InterleavePanel
          piece={piece}
          day={todaysDayNumber}
          items={interleaveItems}
          ladderConfig={piece.ladderConfig}
          onLogSession={onLogSession}
          onConfirmProvisionalSession={onConfirmProvisionalSession}
          onDiscardProvisionalSession={onDiscardProvisionalSession}
        />
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
            <DayChecklist
              key={d.dayNumber}
              piece={piece}
              chunks={chunks}
              day={d}
              onLogSession={onLogSession}
              onUnlogSession={onUnlogSession}
              onConfirmProvisionalSession={onConfirmProvisionalSession}
              onDiscardProvisionalSession={onDiscardProvisionalSession}
              onLogRunThrough={onLogRunThrough}
              onUnlogRunThrough={onUnlogRunThrough}
              onSetMemoryAnchor={onSetMemoryAnchor}
            />
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
        isRealToday={isRealToday}
        onLogSession={onLogSession}
        onUnlogSession={onUnlogSession}
      />

      {/* Scoped to the regular (non-past-plan) view — past the plan,
          Master Agenda's own maintenance-due random-start pool already
          covers this idea across every piece's due work. Hidden entirely
          (rather than shown disabled) below 2 entries, matching Master
          Agenda's own threshold for the same component (there's no single
          chunk-level state to point to an explanation the way Pass 29's
          Interleaved-mode gate has, and a 1-entry pool has nothing to
          actually randomize between). */}
      {!pastPlan && randomStartPool.length > 1 && <RandomStartPanel entries={randomStartPool} />}

      {/* Cold-Start is a periodic nudge, not a daily task — it renders
          only on the day a new gap threshold is actually crossed (see
          coldStartDueThreshold, lib/coldStart.js), so it sits below even
          the section run-throughs. */}
      <ColdStartPanel
        piece={piece}
        day={elapsedDay}
        onLogColdStart={onLogColdStart}
        onUnlogColdStart={onUnlogColdStart}
        onSetOverallConfidence={onSetOverallConfidence}
      />

      <ReassessPanel piece={piece} todaysRanges={todaysRanges} onReassessRange={onReassessRange} />
    </div>
  );
}
