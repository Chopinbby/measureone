import { useState, useEffect, useRef } from "react";
import { ChecklistItem } from "./ChecklistItem";
import { NumberInput } from "../../NumberInput";
import { formatMinutes, formatDuration, addDaysISO } from "../../../lib/utils";
import { elapsedSeconds } from "../../../lib/plannedMinutes";
import { classifyDayEmptyState, movedIdsForDay, isReviewModelV2 } from "../../../lib/scheduling";
import { nextReviewForm, isReturnDue } from "../../../lib/reviewForms";
import { findHistoricalItemsForDay } from "../../../lib/history";

// Consolidation-day logging: stop count replaces the old bare "mark
// complete" checkbox (Repertoire-Lifecycle.md's "Post-run-through
// logging"). Chunk-level rough/lost flagging for what caught during this
// run-through happens separately, on the Piece Map.
function ConsolidationPanel({ piece, day, onLogRunThrough, onUnlogRunThrough }) {
  const entry = piece.progress["__consolidation__"] || {};
  const done = (entry.doneDays || []).includes(day);
  const sessionsToday = (entry.sessions || []).filter((s) => s.day === day);
  const lastSession = sessionsToday[sessionsToday.length - 1];
  const [stopCount, setStopCount] = useState("");

  // Pass 137 — a timer for the whole-piece run-through, same shape as the
  // practice cards' (ChecklistItem.jsx, Pass 72): the running stretch remembers
  // the wall-clock moment it began and the seconds it already held, and every
  // reading is recomputed from the clock (lib/plannedMinutes.js elapsedSeconds),
  // so a backgrounded tab that skips ticks is still right when it comes back.
  // The seconds are saved on the logged session beside the stop count. There is
  // deliberately no "planned" figure on this card: today the schedule bills this
  // day at the whole daily budget, a placeholder, not a price (Pass 142).
  const [timerRunning, setTimerRunning] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const timerStartRef = useRef(null);
  useEffect(() => {
    if (!timerRunning) return;
    timerStartRef.current = { startedAt: Date.now(), baseSeconds: durationSeconds };
    const id = setInterval(() => setDurationSeconds(elapsedSeconds(timerStartRef.current, Date.now())), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning]);

  const submit = () => {
    if (stopCount === "") return;
    // Read from the clock at the moment of the click, not from the last tick.
    const finalSeconds = timerRunning && timerStartRef.current ? elapsedSeconds(timerStartRef.current, Date.now(), Math.floor) : durationSeconds;
    onLogRunThrough(day, Number(stopCount), finalSeconds);
    setStopCount("");
    setTimerRunning(false);
    setDurationSeconds(0);
  };

  return (
    <div className="panel">
      <h3>Day {day}: Full run-through</h3>
      <p className="wizard-hint">No new material today. Play through the whole piece and note where it still catches.</p>
      {lastSession && (
        <p className="tip-line">
          Logged: stopped {lastSession.stopCount} time{lastSession.stopCount === 1 ? "" : "s"}
          {lastSession.durationSeconds ? ` in ${formatDuration(lastSession.durationSeconds)}` : ""}
          {sessionsToday.length > 1 ? ` (attempt ${sessionsToday.length} today)` : ""}
        </p>
      )}
      <div className="timer-row">
        <button type="button" className={`timer-btn ${timerRunning ? "running" : ""}`} onClick={() => setTimerRunning((r) => !r)}>
          {timerRunning ? "Stop" : "Start"} timer
        </button>
        {timerRunning ? (
          <span className="timer-display mono">{formatDuration(durationSeconds)}</span>
        ) : (
          <label className="timer-manual">
            <span>minutes practiced</span>
            <NumberInput
              value={durationSeconds ? Math.round(durationSeconds / 60) : ""}
              min={0}
              onCommit={(n) => setDurationSeconds(Math.round(n * 60))}
              placeholder="e.g. 10"
            />
          </label>
        )}
      </div>
      <div className="log-row">
        <label>
          <span>Times stopped</span>
          <NumberInput value={stopCount} min={0} onCommit={(n) => setStopCount(n)} placeholder="0" />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button className="primary-btn sm" disabled={stopCount === ""} onClick={submit}>
          {done ? "Log another run-through" : "Log run-through"}
        </button>
        {done && (
          <button className="ghost-btn" onClick={() => onUnlogRunThrough(day)}>
            Undo most recent
          </button>
        )}
      </div>
      <p className="wizard-hint" style={{ marginTop: 10, marginBottom: 0 }}>
        Flag any chunk that caught on the <strong>Piece Map</strong> as rough or lost.
      </p>
    </div>
  );
}

export function DayChecklist({
  piece,
  chunks,
  day,
  timeline,
  onLogSession,
  onUnlogSession,
  onConfirmProvisionalSession,
  onDiscardProvisionalSession,
  onLogRunThrough,
  onUnlogRunThrough,
  onSetMemoryAnchor,
  onAddFocusSpot,
  onGoToNextOccurrence,
}) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  // What was actually practiced on this exact day that the current live
  // schedule no longer lists here — a transition/combo Pass 90's smoothing
  // has since relocated, or a review whose ladder has moved past this
  // occurrence. `timeline` is optional (View all's per-day loop and the
  // single-day view both already have it in scope; a future caller that
  // doesn't pass it just sees none, rather than crashing) — see
  // findHistoricalItemsForDay, lib/history.js.
  const historicalItems =
    day.type === "consolidation" || !timeline ? [] : findHistoricalItemsForDay(piece, chunks, timeline, day.dayNumber);

  if (day.type === "consolidation") {
    return (
      <ConsolidationPanel
        piece={piece}
        day={day.dayNumber}
        onLogRunThrough={onLogRunThrough}
        onUnlogRunThrough={onUnlogRunThrough}
      />
    );
  }

  const items = [
    ...day.newChunkIds.map((id) => ({ id, role: "new" })),
    ...day.specialChunkIds.map((id) => ({ id, role: chunkById[id].kind })),
    ...day.reviewChunkIds.map((id) => ({ id, role: "review" })),
  ];
  // Combos ("Focus block") span several chunks and take longer than a single
  // chunk's worth of practice — always last, after every atomic task. Sort is
  // stable, so relative order otherwise is unaffected.
  items.sort((a, b) => (a.role === "combo" ? 1 : 0) - (b.role === "combo" ? 1 : 0));

  // classifyDayEmptyState (lib/scheduling.js — Pass 92, consolidates what
  // used to be four surfaces' own separate items.length/isDayFullySwept/
  // staleReviewIds checks into one shared function) reuses isDayFullySwept
  // internally, so this single call covers both the "reschedule swept
  // everything" and "nothing here at all (including a day emptied purely
  // by review staleness)" cases this component used to check separately.
  const emptyState = classifyDayEmptyState(day, piece, chunkById);

  // A historical entry's role for tag/label purposes: a plain chunk
  // (kind "section") only ever shows up here for a completed REVIEW
  // occurrence that's since moved — its own introduction day never
  // disappears — so "review" is correct for it, same as for an id with no
  // kind of its own. Transitions/combos use their own kind directly.
  const roleForHistorical = (chunk) => (chunk.kind === "combo" ? "combo" : chunk.kind === "transition" ? "transition" : "review");

  if (emptyState === "empty") {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        {historicalItems.length === 0 ? (
          <p className="wizard-hint" style={{ margin: 0 }}>Nothing scheduled.</p>
        ) : (
          <div className="checklist">
            {historicalItems.map(({ chunk, nextOccurrenceDay }) => (
              <ChecklistItem
                key={chunk.id + "-historical"}
                chunk={chunk}
                role={roleForHistorical(chunk)}
                piece={piece}
                day={day.dayNumber}
                historical
                nextOccurrenceDay={nextOccurrenceDay}
                onGoToNextOccurrence={onGoToNextOccurrence}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // A day before the reschedule's asOfDay still carries its pre-reschedule
  // newChunkIds/specialChunkIds/reviewChunkIds — getEffectiveTimeline
  // (lib/scheduling.js) only replaces days from asOfDay onward, so an
  // untouched day further back keeps showing the exact list that got swept
  // into the reschedule, duplicating tasks that now also appear on their new
  // day. classifyDayEmptyState (lib/scheduling.js, shared across all four
  // day-list surfaces as of Pass 92) collapses this only when EVERY item
  // this day originally scheduled ended up moved — a day with any real
  // remaining content (done or still legitimately scheduled) renders
  // normally. Shared by both View all (one DayChecklist per timeline day)
  // and the single-day view — day nav has no logic that skips a
  // fully-swept day, so this same check is what keeps that reachable case
  // from showing stale duplicates too. `items` maps 1:1 off the same
  // newChunkIds/specialChunkIds/reviewChunkIds classifyDayEmptyState reads
  // directly off `day`, just relabeled with a role — passing `day` itself
  // checks the identical id set.
  if (emptyState === "rescheduled") {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        <p className="wizard-hint" style={{ margin: 0 }}><em>Tasks rescheduled</em></p>
      </div>
    );
  }

  // A day that ISN'T fully swept can still have SOME of its own ids
  // individually relocated by the reschedule — e.g. an untouched chunk
  // moved to a later day, sitting alongside a genuinely still-open review
  // that (correctly) kept the whole day from collapsing above. Without
  // this filter, that moved chunk renders here too — a live, checkable
  // duplicate of the exact same task now also sitting on its new day.
  // Reported live: checking off the one item that genuinely still
  // belonged here left the moved chunk standing alone, looking exactly
  // like a fresh task that had just appeared.
  const movedIds = movedIdsForDay(day, piece, chunkById);
  const visibleItems = items.filter(({ id }) => !movedIds.has(id));

  // Pass 141 (review model 2): a review that is a RETURN (on or after its window's
  // earliest day; the next-day touch sits before it) takes a form: the chunk, a
  // join with a neighbour, or a combo. The form is read from what was logged
  // (lib/reviewForms.js), never stored. Every other card gets none.
  const formSet = isReviewModelV2(piece)
    ? {
        practiceChunks: chunks.filter((c) => c.kind === "section"),
        transitions: chunks.filter((c) => c.kind === "transition"),
        combos: chunks.filter((c) => c.kind === "combo"),
      }
    : null;
  const cardDate = piece.startDate ? addDaysISO(piece.startDate, day.dayNumber - 1) : null;
  const returnFormFor = (id, role) =>
    formSet && role === "review" && chunkById[id].kind === "section" && isReturnDue(piece.progress[id], cardDate)
      ? nextReviewForm(chunkById[id], formSet, piece.progress)
      : undefined;

  return (
    <div className="panel">
      <h3>Day {day.dayNumber}: {formatMinutes(day.minutes)} planned</h3>
      <div className="checklist">
        {visibleItems.map(({ id, role }) => (
          <ChecklistItem
            key={id + role}
            chunk={chunkById[id]}
            role={role}
            piece={piece}
            day={day.dayNumber}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
            onConfirmProvisionalSession={onConfirmProvisionalSession}
            onDiscardProvisionalSession={onDiscardProvisionalSession}
            onSetMemoryAnchor={onSetMemoryAnchor}
            onAddFocusSpot={onAddFocusSpot}
            returnForm={returnFormFor(id, role)}
          />
        ))}
        {historicalItems.map(({ chunk, nextOccurrenceDay }) => (
          <ChecklistItem
            key={chunk.id + "-historical"}
            chunk={chunk}
            role={roleForHistorical(chunk)}
            piece={piece}
            day={day.dayNumber}
            historical
            nextOccurrenceDay={nextOccurrenceDay}
            onGoToNextOccurrence={onGoToNextOccurrence}
          />
        ))}
      </div>
    </div>
  );
}
