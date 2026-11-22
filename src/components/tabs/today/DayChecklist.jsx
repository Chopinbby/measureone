import { useState, useEffect, useRef } from "react";
import { ChecklistItem } from "./ChecklistItem";
import { NumberInput } from "../../NumberInput";
import { formatMinutes, formatDuration, addDaysISO } from "../../../lib/utils";
import { elapsedSeconds } from "../../../lib/plannedMinutes";
import { classifyDayEmptyState, movedIdsForDay, isReviewModelV2 } from "../../../lib/scheduling";
import { nextReviewForm, isReturnDue } from "../../../lib/reviewForms";
import { findHistoricalItemsForDay } from "../../../lib/history";
import { runThroughPrice, runThroughPriceText, previousFeel, FEEL_MIN, FEEL_MAX } from "../../../lib/runThrough";

const FEEL_NUMBERS = Array.from({ length: FEEL_MAX - FEEL_MIN + 1 }, (_, i) => FEEL_MIN + i);
const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

// Whole-piece run-through logging, shared by the final day's panel and, on the new review
// plan, the early run-through on a practice day. Stop count replaces the old bare "mark
// complete" checkbox (Repertoire-Lifecycle.md's "Post-run-through logging"). Chunk-level
// rough/lost flagging for what caught during this run-through happens separately, on the
// Piece Map. Pass 142: on the new review plan (and only there) the card also shows its
// price and asks "How did that feel?" (1 to 10, optional), with the number from the
// previous run-through beside it. A run-through is not a review for any chunk, and
// nothing reads the number to decide anything (lib/runThrough.js).
function RunThroughLogger({ piece, chunks, day, early = false, onLogRunThrough, onUnlogRunThrough }) {
  const entry = piece.progress["__consolidation__"] || {};
  const done = (entry.doneDays || []).includes(day);
  const sessionsToday = (entry.sessions || []).filter((s) => s.day === day);
  const lastSession = sessionsToday[sessionsToday.length - 1];
  const [stopCount, setStopCount] = useState("");
  const [feel, setFeel] = useState(null);
  const onNewPlan = isReviewModelV2(piece);
  const price = onNewPlan ? runThroughPrice(piece, chunks) : null;
  const previous = onNewPlan ? previousFeel(entry.sessions, day) : null;

  // Pass 137 — a timer for the whole-piece run-through, same shape as the
  // practice cards' (ChecklistItem.jsx, Pass 72): the running stretch remembers
  // the wall-clock moment it began and the seconds it already held, and every
  // reading is recomputed from the clock (lib/plannedMinutes.js elapsedSeconds),
  // so a backgrounded tab that skips ticks is still right when it comes back.
  // The seconds are saved on the logged session beside the stop count. Pass 142:
  // a piece on the new review plan shows what the run-through is priced at; a
  // piece on today's plan still shows no figure (its final day bills the daily
  // budget, a placeholder, not a price).
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
    onLogRunThrough(day, Number(stopCount), finalSeconds, feel, early);
    setStopCount("");
    setFeel(null);
    setTimerRunning(false);
    setDurationSeconds(0);
  };

  return (
    <>
      {lastSession && (
        <p className="tip-line">
          Logged: stopped {lastSession.stopCount} time{lastSession.stopCount === 1 ? "" : "s"}
          {lastSession.durationSeconds ? ` in ${formatDuration(lastSession.durationSeconds)}` : ""}
          {lastSession.feel ? `, felt ${lastSession.feel}/${FEEL_MAX}` : ""}
          {sessionsToday.length > 1 ? ` (attempt ${sessionsToday.length} today)` : ""}
        </p>
      )}
      {price && <p className="tip-line">Planned: {runThroughPriceText(price)}</p>}
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
      {onNewPlan && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 600, marginBottom: 4 }}>How did that feel? (optional)</div>
          <div className="segmented" role="group" aria-label="How did that feel, from 1 to 10">
            {FEEL_NUMBERS.map((n) => (
              <button
                key={n}
                type="button"
                className={feel === n ? "active" : ""}
                aria-pressed={feel === n}
                style={{ padding: "6px 10px" }}
                onClick={() => setFeel((f) => (f === n ? null : n))}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="tip-line" style={{ marginTop: 4 }}>
            1 is rough, 10 is great.
            {previous ? ` Last run-through: ${previous.feel}${previous.loggedDate ? ` (${shortDate(previous.loggedDate)})` : ""}.` : ""}
          </p>
        </div>
      )}
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
    </>
  );
}

// The final day: a whole day given to one full run-through.
function ConsolidationPanel({ piece, chunks, day, onLogRunThrough, onUnlogRunThrough }) {
  return (
    <div className="panel">
      <h3>Day {day}: Full run-through</h3>
      <p className="wizard-hint">No new material today. Play through the whole piece and note where it still catches.</p>
      <RunThroughLogger key={day} piece={piece} chunks={chunks} day={day} onLogRunThrough={onLogRunThrough} onUnlogRunThrough={onUnlogRunThrough} />
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
        chunks={chunks}
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

  // Pass 142 (review model 2): an early whole-piece run-through sits on top of this
  // day's other work. The day stays a learning day; `runThroughMinutes` marks it
  // (lib/scheduling.js). It is practice, not a review: it never changes when any
  // chunk comes back, and a day that holds only a run-through owes nothing else.
  const runThroughBlock =
    isReviewModelV2(piece) && day.runThroughMinutes ? (
      <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12, marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 4px" }}>Whole-piece run-through</h4>
        <p className="wizard-hint">Play through the whole piece. It is practice, not a review: it does not change when any chunk comes back.</p>
        <RunThroughLogger key={day.dayNumber} early piece={piece} chunks={chunks} day={day.dayNumber} onLogRunThrough={onLogRunThrough} onUnlogRunThrough={onUnlogRunThrough} />
      </div>
    ) : null;

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
        {runThroughBlock}
        {historicalItems.length === 0 ? (
          runThroughBlock ? null : <p className="wizard-hint" style={{ margin: 0 }}>Nothing scheduled.</p>
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
      {runThroughBlock}
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
