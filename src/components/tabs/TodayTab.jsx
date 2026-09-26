import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Target } from "lucide-react";
import { ScheduleBanner } from "../ScheduleBanner";
import { FocusPanel } from "./today/FocusPanel";
import { FocusSpotCard } from "./today/FocusSpotCard";
import { SectionRunThroughPanel } from "./today/SectionRunThroughPanel";
import { ColdStartPanel } from "./today/ColdStartPanel";
import { RandomStartPanel, chunkEntry } from "./revival/RandomStartPanel";
import { ReassessSequencePanel } from "./revival/ReassessSequencePanel";
import { DayChecklist } from "./today/DayChecklist";
import { ChecklistItem } from "./today/ChecklistItem";
import { ReassessPanel } from "./today/ReassessPanel";
import { SplitChunkPanel } from "./today/SplitChunkPanel";
import { WeekView } from "./today/WeekView";
import { InterleavePanel } from "./today/InterleavePanel";
import { TechniquePanel } from "./technique/TechniquePanel";
import { techniqueTodaySummary } from "../../lib/technique";
import { computeDueReviews, totalDueMinutes, mergeLiveDueReviews } from "../../lib/maintenance";
import { isInterleaveEligible } from "../../lib/ladder";
import { isInRevival, getRevivalTargetBPM, computeTempoLadder, computeComboEscalations } from "../../lib/revival";
import { isManualConfidence } from "../../lib/confidence";
import { isPlanActuallyComplete, computeScheduleStatus, classifyDayCompletion, focusSpotGate } from "../../lib/scheduling";
import { elapsedDay as computeElapsedDay, todayISODate, formatMinutes, formatRange, hasPendingProvisionalSession } from "../../lib/utils";

// Pass 91 (experimental v1) — every practice chunk's unresolved focus spots,
// one FocusSpotCard per spot (a chunk with more than one open spot gets one
// card each, not one card for the whole chunk — docs/Algorithms.md#focus-spots-v1).
// `gated` (no introducedDay in the live timeline) only changes each card's
// own bottom-note wording; the actual scheduling consequence already
// happened inside computeTimeline (lib/scheduling.js) by the time this
// renders. Deliberately separate from computeTimeline placement, same as
// the pass calls for — this reads piece.progress directly, not
// timeline.days[], so a gated chunk's drill is reachable even though the
// chunk itself is nowhere in today's (or any day's) checklist.
function FocusSpotsPanel({ piece, chunks, timeline, onLogFocusSpotTime, onUnlogFocusSpotTime, onResolveFocusSpot }) {
  const rows = [];
  chunks
    .filter((c) => c.kind === "section")
    .forEach((chunk) => {
      const { unresolved } = focusSpotGate(piece.progress[chunk.id]);
      unresolved.forEach((spot) => {
        rows.push({ chunk, spot, gated: timeline.introducedDay[chunk.id] == null, siblingCount: unresolved.length });
      });
    });

  if (rows.length === 0) return null;

  return (
    <div className="panel focus-spot-panel" id="focus-spots-panel">
      <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><Target size={16} /> Focus spots</h3>
      <p className="focus-spot-summary">
        Resolve focus spot{rows.length === 1 ? "" : "s"} to add the chunk to daily practice.
      </p>
      <div className="focus-spot-cards">
        {rows.map(({ chunk, spot, gated, siblingCount }) => (
          <FocusSpotCard
            key={spot.id}
            chunk={chunk}
            spot={spot}
            gated={gated}
            siblingCount={siblingCount}
            requiredMinutes={piece.troubleSpotDefaultMinutes ?? 5}
            onLogTime={onLogFocusSpotTime}
            onUnlogTime={onUnlogFocusSpotTime}
            onResolve={onResolveFocusSpot}
          />
        ))}
      </div>
    </div>
  );
}

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
          ? "Maintenance reviews are set aside while a revival is running."
          : null;

    return (
      <div className="panel">
        <h3>Nothing due today</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>
          {suppressed ||
            "Every chunk's next maintenance review is still ahead. Play the piece for the joy of it. The next review will show up here on the day it's due."}
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Due today: {formatMinutes(totalDueMinutes(dueItems))} planned</h3>
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
          ? "Some of these have been waiting a few days. That's fine, take them in order."
          : "All of these came due today."}
      </p>
    </div>
  );
}

export function TodayTab({
  piece,
  chunks,
  chunkSet,
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
  onUpdateBPM,
  onSetManualConfidence,
  onFinishReassessment,
  onReopenReassessment,
  onEndRevival,
  onAssessmentTimerRiskChange,
  onConfirmLeaveAssessmentTimer,
  onAddFocusSpot,
  onLogFocusSpotTime,
  onUnlogFocusSpotTime,
  onResolveFocusSpot,
  technique,
  techniqueRepertoireKeys,
  techniqueHandlers,
  onSplitChunk,
}) {
  const [viewMode, setViewMode] = useState("day");
  const day = timeline.days[currentDay - 1];

  // Today's technique list (Pass 102) — app-level data, not this piece's:
  // the same list and the same panel as the Technique page and Master
  // Agenda, so a check-off here shows there too. Real today only; the rest
  // of the rule (today's saved list, with at least one task — no empty
  // panel on every piece's page) is techniqueTodaySummary in
  // lib/technique.js, shared with Master Agenda. Never read by anything
  // schedule-related on this tab.
  const renderTechniquePanel = (showingToday) =>
    showingToday &&
    techniqueTodaySummary(technique, todayISODate()).visible && (
      <TechniquePanel
        technique={technique}
        repertoireKeys={techniqueRepertoireKeys}
        variant="shared"
        handlers={techniqueHandlers}
      />
    );
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const practiceChunks = chunks.filter((c) => c.kind === "section");

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
  // classifyDayCompletion (lib/scheduling.js) only judges what's still owed
  // on a day — anything a reschedule already moved elsewhere (Pass 48's
  // "Tasks rescheduled") doesn't count. That's what keeps this scan from
  // landing on a day whose work has since moved (after any reschedule the
  // stale, still-undone day 1 would otherwise read "behind" again) and from
  // landing on a half-done, half-moved day where nothing visible is left to
  // do. It needs chunkById so a connector that rode along via a linked
  // practice chunk is recognized as moved too.
  const findEarliestBehindDay = () => {
    for (const d of timeline.days) {
      if (d.dayNumber >= realCurrentDay) break;
      if (classifyDayCompletion(d, piece, realCurrentDay, chunkById) === "behind") return d.dayNumber;
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

  // A historical card's "go to next scheduled practice" link (DayChecklist/
  // ChecklistItem) — same drop-into-day-view pattern handleSelectWeekDay
  // already uses, since "View all" mode has no single-day nav of its own to
  // land on otherwise.
  const handleGoToDay = (dayNumber) => {
    onDayChange(dayNumber);
    setViewMode("day");
  };

  // Interleaved mode (Pass 29) — every chunk in the whole piece that's
  // actually left Stabilizing (isInterleaveEligible, lib/ladder.js), not
  // just whatever happens to be scheduled for today specifically. Used to
  // be scoped to todaysIds (today's own newChunkIds/specialChunkIds/
  // reviewChunkIds) — narrowed on request to the piece-wide pool instead,
  // since a graduated chunk from an earlier day is exactly as valid to
  // interleave against as one that happens to be due today. `chunks` is
  // already exactly chunkSet.all (practice chunks, transitions, combos),
  // with no duplicate ids, so no de-duping is needed the way todaysIds
  // required below.
  const interleaveItems = chunks
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
  // (the segmented control below, the "All Tasks" nudge button, and the
  // "Exit interleaved practice" button) — confirms and discards
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

  // Split a chunk (Pass 97) — same "today's practiced items" set
  // todaysRanges reads above, narrowed to base practice chunks of 2+
  // measures (canSplitChunk, lib/chunking.js) — a transition, combo,
  // section run-through, or 1-measure chunk is never offered. Unlike
  // ReassessPanel, this has no "nothing qualifies" state: the panel itself
  // renders nothing when this list is empty (per direct request).
  const splitEligibleChunks = [...new Set(todaysIds)]
    .filter((id) => ((piece.progress[id] || {}).doneDays || []).includes(todaysDayNumber))
    .map((id) => chunkById[id])
    .filter((c) => c && c.kind === "section" && c.measureCount >= 2);

  // Random Start (Pass 57) — the same "don't let yourself always start
  // from the top" pool RevivalTab/MasterAgendaTab already use (chunkEntry,
  // components/tabs/revival/RandomStartPanel.jsx), scoped here to whatever
  // in this piece already has 2+ logged sessions: practice chunks,
  // transitions, and combos alike (chunkEntry already labels all three
  // correctly, so no filtering to practice chunks only).
  const randomStartPool = chunks
    .filter((c) => ((piece.progress[c.id] || {}).sessions || []).length >= 2)
    .map((c) => chunkEntry(c, piece.memoryAnchors && piece.memoryAnchors[c.id]));

  // Pass 78, folded into Today's Practice by Pass 88 — placed after every
  // hook above (never before one — see the identical caution on
  // SectionRunThroughPanel's isRealToday gate, lib/chunking.js's docs), so
  // this never violates React's rules of hooks even though it replaces the
  // entire rest of the render. The piece's regular plan (every viewMode:
  // Day/Week/Interleaved/All Tasks, FocusPanel, SectionRunThroughPanel, the
  // works, plus ScheduleBanner and the past-target-date nudge — neither
  // applies without a calendar) is meaningless while a revival is running —
  // revival has its own, separate plan, rendered here directly instead of a
  // dedicated tab (retired this pass; there is no more "Revival" nav item
  // or activeTab value to redirect to). Independent of
  // reassessmentComplete/plan existing yet: isInRevival only checks
  // revival.active, so this covers every stage of a revival, not just once
  // a plan has been generated. Same idea DueReviewPanel already applies to
  // just the maintenance-review list (see its own isInRevival-gated copy
  // above) — this generalizes it to the whole tab rather than changing what
  // DueReviewPanel itself does.
  if (isInRevival(piece)) {
    const revival = piece.revival || {};
    // Base practice chunks only — what the reassessment sequence below
    // actually walks and rates. A transition (tagged "Review" in Flagged
    // chunks below) is connecting material, not something to individually
    // set a fresh confidence baseline on the way a real chunk gets
    // Quick-rated during reassessment.
    const revivalBaseChunks = chunkSet.practiceChunks || practiceChunks;
    // Same practiceChunks+transitions list RevivalTab used to build off its
    // own chunkSet prop — chunkSet here is the real one from App.jsx now
    // (Pass 88 added it to this component's props), not a locally
    // reconstructed partial shape. Still needed at this broader scope for
    // the generated plan below (computeRevivalPlan schedules transitions
    // for practice even though they're not walked during reassessment) and
    // for Random start.
    const revivalItems = [...revivalBaseChunks, ...(chunkSet.transitions || [])];
    // Combos aren't part of revivalItems (not reassessed/rated or given
    // their own base-plan task — see computeRevivalPlan), but an escalated
    // combo still needs to be look-up-able by id to render as a
    // ChecklistItem below.
    const revivalChunkById = Object.fromEntries(
      [...revivalItems, ...(chunkSet.combos || [])].map((c) => [c.id, c])
    );
    const ratedCount = revivalBaseChunks.filter((c) => isManualConfidence(c, piece.progress)).length;
    const flagged = revivalItems.filter((c) => (piece.progress[c.id] || {}).flag);
    // Combos whose underlying content (anchor chunk, or an overlapping
    // neighbor) has produced a real fail since this revival run started —
    // see computeComboEscalations for why this is computed live rather
    // than written into revival.plan.
    const comboEscalations = computeComboEscalations(piece, chunkSet);
    // For the single, shared bottom-of-plan ReassessPanel. Deliberately
    // NOT filtered to "logged today" the way the ordinary, non-revival
    // `todaysRanges` above is — revival has no day-scheduling (a plan's
    // dayNumber is a pacing bucket only, not a calendar date — see
    // docs/Algorithms.md#revival), so gating on "today" the same way would
    // mean this panel stays invisible on every visit until something
    // happens to get logged first, which defeats the point of having a
    // reliable, always-reachable way to reassess a chunk you're looking
    // at (confirmed live: this is exactly what happened before this fix —
    // the panel simply never appeared). Every id a revival card can show
    // (plan items + escalated combos) is offered unconditionally instead,
    // same as the per-card control this replaced always was (each card's
    // own range, never gated on same-day logging either).
    const revivalTodaysRanges = Object.values(revivalChunkById).map((c) => ({ start: c.start, end: c.end }));

    return (
      <div className="tab-pane">
        <div className="tab-header day-nav">
          <div>
            <h1>Revival</h1>
            <p className="hero-sub">Returning "{piece.name}" to its former glory</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* Redo reassessment used to live in a "Reassessment complete"
                interstitial panel alongside the now-removed Generate/
                Regenerate plan button (Pass 88 — finishing reassessment
                generates the plan immediately, so that gate panel has
                nothing left to gate). Relocated next to End revival rather
                than dropped, since it's still a real, still-needed action. */}
            {revival.reassessmentComplete && (
              <button className="ghost-btn" onClick={onReopenReassessment}>Redo reassessment</button>
            )}
            <button className="ghost-btn" onClick={onEndRevival}>End revival</button>
          </div>
        </div>

        {/* Revival has no day navigation — it's always today. */}
        {renderTechniquePanel(true)}

        {!revival.reassessmentComplete ? (
          revivalBaseChunks.length > 0 && (
            <ReassessSequencePanel
              piece={piece}
              chunks={revivalBaseChunks}
              currentDay={currentDay}
              ratedCount={ratedCount}
              onUpdateBPM={onUpdateBPM}
              onSetManualConfidence={onSetManualConfidence}
              onSetMemoryAnchor={onSetMemoryAnchor}
              onReassessRange={onReassessRange}
              onLogSession={onLogSession}
              onAssessmentTimerRiskChange={onAssessmentTimerRiskChange}
              onConfirmLeaveAssessmentTimer={onConfirmLeaveAssessmentTimer}
              onFinishReassessment={onFinishReassessment}
            />
          )
        ) : (
          <>
            {flagged.length > 0 && (
              <div className="panel focus-panel">
                <h3>Flagged chunks</h3>
                <div className="focus-list">
                  {flagged.map((c) => (
                    <div key={c.id} className="focus-row">
                      <span className="mono">{formatRange(c.start, c.end)}</span>
                      <span className="tag subtle">{c.kind === "transition" ? "Review" : "Chunk"}</span>
                      {piece.memoryAnchors && piece.memoryAnchors[c.id] && (
                        <span className="tip-line" style={{ marginLeft: "auto" }}>{piece.memoryAnchors[c.id]}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {revival.plan && comboEscalations.length > 0 && (
              <div className="panel focus-panel">
                <h3>Needs another look</h3>
                <p className="wizard-hint">
                  One of the blocks below had a rough pass. Worth practicing on its own rather than
                  assuming it'll sort itself out.
                </p>
                <div className="checklist">
                  {comboEscalations.map((combo) => {
                    const targetBPM = getRevivalTargetBPM(piece, combo);
                    const ladder = computeTempoLadder(targetBPM, revival.tempoLadderStartFraction ?? 0.6, 5);
                    return (
                      <ChecklistItem
                        key={combo.id}
                        chunk={combo}
                        role="combo"
                        piece={piece}
                        day={currentDay}
                        onLogSession={onLogSession}
                        onUnlogSession={onUnlogSession}
                        onConfirmProvisionalSession={onConfirmProvisionalSession}
                        onDiscardProvisionalSession={onDiscardProvisionalSession}
                        tempoLadder={ladder}
                        memoryAnchor={piece.memoryAnchors && piece.memoryAnchors[combo.id]}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {revival.plan && (
              <>
                <div className="tab-header">
                  <h1 style={{ fontSize: 19 }}>Revival plan</h1>
                  <p className="hero-sub">
                    Suggested order and pacing, weakest first. Everything here is loggable any day, in any
                    order.
                  </p>
                </div>
                <div className="view-all-list">
                  {revival.plan.days.map((d) => (
                    <div key={d.dayNumber} className="panel">
                      <h3>Suggested day {d.dayNumber}: {formatMinutes(d.minutes)}</h3>
                      <div className="checklist">
                        {d.itemIds.map((id) => {
                          const chunk = revivalChunkById[id];
                          if (!chunk) return null;
                          const targetBPM = getRevivalTargetBPM(piece, chunk);
                          const ladder = computeTempoLadder(targetBPM, revival.tempoLadderStartFraction ?? 0.6, 5);
                          return (
                            <ChecklistItem
                              key={id}
                              chunk={chunk}
                              role={chunk.kind === "transition" ? "transition" : "review"}
                              piece={piece}
                              day={currentDay}
                              onLogSession={onLogSession}
                              onUnlogSession={onUnlogSession}
                              onConfirmProvisionalSession={onConfirmProvisionalSession}
                              onDiscardProvisionalSession={onDiscardProvisionalSession}
                              tempoLadder={ladder}
                              memoryAnchor={piece.memoryAnchors && piece.memoryAnchors[id]}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Random start and the shared Reassess panel move to the very
                bottom, mirroring ordinary Daily Practice's own layout
                (SectionRunThroughPanel/RandomStartPanel/ColdStartPanel/
                ReassessPanel in that order below the day's checklist) —
                per-card "Reassess difficulty" buttons on every ChecklistItem
                above were removed at the same time (onReassessRange no
                longer passed to them) in favor of this one, same as
                DayChecklist/DueReviewPanel already do for the ordinary,
                non-revival view. */}
            <RandomStartPanel piece={piece} revivalItems={revivalItems} sections={piece.sections} />
            <ReassessPanel piece={piece} todaysRanges={revivalTodaysRanges} onReassessRange={onReassessRange} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="tab-pane">
      <ScheduleBanner
        piece={piece}
        chunkSet={chunkSet}
        timeline={timeline}
        realCurrentDay={realCurrentDay}
        onReschedule={onReschedule}
        // Already on the earliest behind day: "Go to Day N" would jump nowhere,
        // so hide it (and, via the banner's own hasCatchUp check, the "or pick
        // up where you left off" half of its copy). Done here rather than in
        // ScheduleBanner itself, which Pass 74 made realCurrentDay-only — it
        // deliberately has no notion of the browsed day.
        earliestBehindDay={earliestBehindDay === currentDay ? null : earliestBehindDay}
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
                  Every chunk has been introduced. What's left is a transition or focus block
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
          {isRealToday && <h1>Daily Practice</h1>}
          <p className="hero-sub">
            {pastPlan
              ? `Plan complete, maintenance day ${elapsedDay}`
              : `Day ${currentDay} of ${timeline.days.length}`}
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
      {renderTechniquePanel(isRealToday)}
      {/* Pulled out of the segmented view-mode control (Day View/Week
          View/All Tasks) into its own button — entering Interleaved mode
          is a distinct action, not another way to view the same day, so it
          reads oddly grouped alongside those three.
          Pass 94: it's also the way back out. While in Interleaved mode it
          reads "Exit interleaved practice" and returns to Day View — through
          leaveInterleaved, like every other way out, so an unconfirmed
          provisional session still gets the warn-and-discard prompt. The
          "fewer than two qualifying chunks" disable applies only to
          ENTERING: if the pool drops below two mid-session, a disabled exit
          would trap you in the mode. */}
      <button
        type="button"
        className={`ghost-btn interleave-mode-btn ${viewMode === "interleave" ? "active" : ""}`}
        style={{ alignSelf: "flex-start" }}
        disabled={viewMode !== "interleave" && interleaveItems.length < 2}
        onClick={() => (viewMode === "interleave" ? leaveInterleaved("day") : setViewMode("interleave"))}
      >
        {viewMode === "interleave" ? "Exit interleaved practice" : "Interleaved practice"}
      </button>
      {/* Pass 69 — needs two qualifying chunks to actually rotate between,
          not just one, so the unlock threshold moved from "zero" to "fewer
          than two". That means the hint now has to cover a state that
          couldn't previously occur: exactly one chunk graduated. Reusing
          the old "no chunks have graduated" sentence for that case would
          be wrong (a chunk genuinely has graduated), so the copy branches
          instead of using one static sentence for both. */}
      {interleaveItems.length < 2 && (
        <p className="wizard-hint" style={{ marginTop: -8 }}>
          {interleaveItems.length === 0
            ? "Interleaved mode unlocks once at least two chunks graduate past Stabilizing. No chunks have graduated past Stabilizing yet."
            : "Interleaved mode unlocks once at least two chunks graduate past Stabilizing. Only one chunk has graduated past Stabilizing so far."}
        </p>
      )}

      <FocusPanel piece={piece} chunks={chunks} currentDay={currentDay} />

      <FocusSpotsPanel
        piece={piece}
        chunks={chunks}
        timeline={timeline}
        onLogFocusSpotTime={onLogFocusSpotTime}
        onUnlogFocusSpotTime={onUnlogFocusSpotTime}
        onResolveFocusSpot={onResolveFocusSpot}
      />

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
            timeline={timeline}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
            onConfirmProvisionalSession={onConfirmProvisionalSession}
            onDiscardProvisionalSession={onDiscardProvisionalSession}
            onLogRunThrough={onLogRunThrough}
            onUnlogRunThrough={onUnlogRunThrough}
            onSetMemoryAnchor={onSetMemoryAnchor}
            onAddFocusSpot={onAddFocusSpot}
            onGoToNextOccurrence={handleGoToDay}
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
          onReassessRange={onReassessRange}
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
          onDayChange={onDayChange}
        />
      ) : (
        <div className="view-all-list">
          {timeline.days.map((d) => (
            <DayChecklist
              key={d.dayNumber}
              piece={piece}
              chunks={chunks}
              day={d}
              timeline={timeline}
              onLogSession={onLogSession}
              onUnlogSession={onUnlogSession}
              onConfirmProvisionalSession={onConfirmProvisionalSession}
              onDiscardProvisionalSession={onDiscardProvisionalSession}
              onLogRunThrough={onLogRunThrough}
              onUnlogRunThrough={onUnlogRunThrough}
              onSetMemoryAnchor={onSetMemoryAnchor}
              onAddFocusSpot={onAddFocusSpot}
              onGoToNextOccurrence={handleGoToDay}
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

      {/* Pass 97 — regular Today's Practice view only, same as this whole
          return block (revival is an early return above); explicitly
          excluded from Interleaved mode per direct request, unlike
          ReassessPanel just above, which stays available there too. */}
      {viewMode !== "interleave" && <SplitChunkPanel chunks={splitEligibleChunks} onSplitChunk={onSplitChunk} />}
    </div>
  );
}
