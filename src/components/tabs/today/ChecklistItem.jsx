import { useState, useEffect, useRef } from "react";
import { Check, Plus, Target } from "lucide-react";
import { formatRange, formatDuration, todayISODate, parseMeasurePosition } from "../../../lib/utils";
import { ROLE_LABEL, DIFFICULTY_META, SESSION_OUTCOME_META } from "../../../lib/constants";
import {
  computeConfidence,
  classifySessionOutcome,
  sessionOutcome,
  getDefaultTargetBPM,
  getSuggestedStartingBPM,
  formatLadderStatus,
  resolveRequiredReps,
} from "../../../lib/confidence";
import { focusSpotGate } from "../../../lib/scheduling";
import { NumberInput } from "../../NumberInput";
import { MemoryAnchorField } from "../../MemoryAnchorField";
import { ReassessPanel } from "./ReassessPanel";

export function ChecklistItem({
  chunk,
  role,
  piece,
  day,
  onLogSession,
  onUnlogSession,
  onConfirmProvisionalSession,
  onDiscardProvisionalSession,
  tempoLadder,
  memoryAnchor,
  onSetMemoryAnchor,
  onReassessRange,
  // Pass 91 (experimental v1) — only passed by DayChecklist's live (non-
  // historical) render path; a chunk that's already paused by an unresolved
  // spot doesn't need it (there's nowhere to show it once the paused note
  // takes over the card body), and it's never offered on a transition/combo
  // card (chunk.kind !== "section") — see the render below.
  onAddFocusSpot,
  // Historical mode (DayChecklist's record-of-what-was-done cards, added
  // when this item's own live schedule slot has since moved elsewhere —
  // see findHistoricalItemsForDay, lib/history.js): read-only, no
  // logging/undo/note-editing controls, since acting on a day that isn't
  // this item's current live slot could produce confusing data (a fresh
  // log entry dated to a day the ladder no longer treats as this chunk's
  // due day). `day` is still the historical day itself, so the "Logged:
  // ..." line below correctly reports THAT day's own session, not the
  // chunk's latest one. No separate "completed here" badge — being on a
  // specific day already implies that, per direct request — and the
  // requirement/spaced-repetition lines are skipped too, since what
  // actually happened is already stated by the "Logged: ..." line; those
  // two describe what's still needed *going forward*, which isn't this
  // card's question. The dashed card border (`.checklist-item.historical`,
  // App.jsx) is what marks it as historical now, not any text/tag.
  historical = false,
  nextOccurrenceDay,
  onGoToNextOccurrence,
}) {
  const entry = piece.progress[chunk.id] || {};
  // Pass 91 (experimental v1) — an unresolved spot pauses this card's
  // regular practice UI regardless of *how* it was added (fromSetup only
  // matters to computeTimeline's introduction gate, lib/scheduling.js —
  // once a card is showing at all, any open spot pauses it). Never true in
  // historical mode: a read-only record of a day that's already passed has
  // nothing to pause.
  const unresolvedFocusSpots = focusSpotGate(entry).unresolved;
  const isPaused = !historical && unresolvedFocusSpots.length > 0;
  const [addFocusSpotOpen, setAddFocusSpotOpen] = useState(false);
  const [focusSpotName, setFocusSpotName] = useState("");
  const [focusSpotPosition, setFocusSpotPosition] = useState("");
  const canAddFocusSpot =
    !historical && !isPaused && typeof onAddFocusSpot === "function" && chunk.kind === "section" && piece.troubleSpotsEnabled;
  // Required, not optional — a spot with no real measure reference can't be
  // matched back to a chunk if this piece's measures/chunking ever change
  // (reassociateTroubleSpots, lib/chunking.js), so it's validated the same
  // way at both places a spot can be created (this form and the Wizard's
  // FocusSpotsStep).
  const focusSpotPositionParsed = parseMeasurePosition(focusSpotPosition, piece.totalMeasures);
  const submitAddFocusSpot = () => {
    const name = focusSpotName.trim();
    if (!name || !focusSpotPositionParsed) return;
    onAddFocusSpot(chunk.id, {
      name,
      position: focusSpotPosition.trim(),
      startMeasure: focusSpotPositionParsed.start,
      endMeasure: focusSpotPositionParsed.end,
    });
    setFocusSpotName("");
    setFocusSpotPosition("");
    setAddFocusSpotOpen(false);
  };
  const checked = (entry.doneDays || []).includes(day);
  // Multiple sessions can now legitimately share a plan-day (a Tier 1
  // touch, a due review, a re-attempt) — this surface shows/undoes just
  // the most recent one for `day`, but keeps the log form available even
  // once something's logged, so a second attempt the same day is actually
  // reachable rather than gated behind undoing the first.
  const sessionsToday = (entry.sessions || []).filter((s) => s.day === day);
  const session = sessionsToday[sessionsToday.length - 1];
  // Honest undo copy (docs/Decisions.md's "session undo should fully
  // reverse the ladder" entry): undo only fully reverses stage/tempo/
  // nextDueDate when the session being undone is this chunk's most recent
  // session *overall* (not just for `day`) and carries the ladderSnapshot
  // handleLogSession seeds it with. Otherwise (an earlier session, or one
  // logged before this pass existed) undo can only remove the record —
  // mirrors App.jsx's handleUnlogSession fallback exactly, so the control
  // never claims more than it will actually do.
  const allSessions = entry.sessions || [];
  const isLatestSessionOverall = allSessions.length > 0 && allSessions[allSessions.length - 1] === session;
  const hasValidLadderSnapshot =
    !!session &&
    !!session.ladderSnapshot &&
    ["stage", "consecutivePasses", "consecutiveStabilizingFails", "practiceBPM", "nextDueDate", "tier1Done"].every(
      (key) => key in session.ladderSnapshot
    );
  const undoWillFullyReverse = isLatestSessionOverall && hasValidLadderSnapshot;
  const conf = computeConfidence(chunk, piece, day);
  const [reps, setReps] = useState("");
  const [bpm, setBpm] = useState("");
  // Pass 53 — gates the Log button on whatever's been typed, not on the
  // commit-on-blur values above: waiting for blur before enabling the
  // button meant tabbing/clicking straight from BPM to Log never worked,
  // since Log was still disabled at that instant. Submission itself still
  // reads reps/bpm (the committed state), never these flags directly.
  const [hasRepsDraft, setHasRepsDraft] = useState(false);
  const [hasBpmDraft, setHasBpmDraft] = useState(false);
  const [manualFail, setManualFail] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);

  // Read straight off the piece rather than requiring a prop. The note is
  // durable per-chunk metadata keyed by chunk id in piece.memoryAnchors
  // (docs/Data-Model.md — one flat map, chunk/transition ids and section
  // ids never collide), and this component already has `piece`. The
  // `memoryAnchor` prop stays as an explicit override for the callers that
  // already pass it (RevivalTab) — both resolve to the same string, so the
  // fallback is belt-and-braces, not two sources of truth.
  //
  // Before Pass 23 only RevivalTab passed that prop, so a note written on
  // the Piece Map was invisible during ordinary practice — the one place
  // it's most useful. Data-Model.md already claimed it surfaced "during
  // both normal practice and revival"; reading it here is what makes that
  // true.
  const noteText = memoryAnchor || (piece.memoryAnchors || {})[chunk.id] || "";
  // Editing is offered only where a write handler was actually passed
  // (learning-phase logging, via DayChecklist). Everywhere else the note
  // stays read-only, exactly as before.
  const canEditNote = typeof onSetMemoryAnchor === "function";

  // The interval's own tick only updates durationSeconds once per second, so
  // relying on that state at click time can under-report the true elapsed
  // time by up to ~999ms (or more, if a window.confirm() blocks the thread
  // mid-click). timerStartRef records the wall-clock moment this running
  // segment began, plus the accumulated seconds it started from (so
  // pause/resume and manual minutes-entry still carry over correctly) —
  // submitLog re-derives the actual elapsed time from Date.now() at the
  // moment of the click instead of trusting the last tick's state.
  const timerStartRef = useRef(null);

  useEffect(() => {
    if (!timerRunning) return;
    timerStartRef.current = { startedAt: Date.now(), baseSeconds: durationSeconds };
    // Pass 72 — recomputed from the wall clock on every tick, not a blind
    // `s + 1`, so the live display self-corrects on whatever tick actually
    // fires. A backgrounded tab throttles/skips setInterval ticks (browsers
    // do this to save power), so a plain increment would silently fall
    // behind real elapsed time and only "catch up" one second at a time
    // once the tab is foregrounded again. Recomputing from
    // timerStartRef.current each tick means the very first tick after
    // returning already shows the true elapsed time.
    const id = setInterval(() => {
      setDurationSeconds(
        timerStartRef.current.baseSeconds + Math.round((Date.now() - timerStartRef.current.startedAt) / 1000)
      );
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning]);

  // isPaused belongs here, not just on the blocks below that stop
  // rendering while paused: the leading checkmark button (right below, in
  // the render) reads canLog directly and isn't nested inside any of those
  // isPaused-gated blocks, so without it here a reps/BPM draft typed in
  // before a focus spot got added to this same chunk left that button
  // clickable — and clicking it called submitLog for real, silently, on a
  // card that was telling the learner practice was paused. Found in review,
  // fixed here rather than by threading a second condition onto the button
  // itself, so canLog, its tooltip text, and submitLog's own guard all stay
  // correct together automatically.
  const canLog = hasRepsDraft && hasBpmDraft && !isPaused;
  const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, chunk);
  const practiceBPM = entry.practiceBPM ?? null;
  // Single source of truth for "how many reps does this chunk actually
  // need" — reused by the requirement line below, the input field's label,
  // AND submitLog's classification call, so the number the learner reads
  // before logging always matches the number that's actually judged
  // against (previously computed separately in each place, with a subtly
  // different fallback for an unrecognized difficultyLabel). Pass 27 moved
  // the actual resolution (including the run-through flat-rep override)
  // into resolveRequiredReps (lib/confidence.js) — this component has no
  // JSX-free test path of its own, and that logic needs to be unit
  // testable on its own. Pass 61 — entry.stage/entry.holdingReviewCount
  // were already in scope (the same `entry` this component reads
  // everywhere else), so no new prop needed here for Holding's periodic
  // harder-check bump to apply.
  const requiredReps = resolveRequiredReps(chunk, entry.stage, entry.holdingReviewCount);
  const outcomeMeta = session && SESSION_OUTCOME_META[sessionOutcome(session)];
  // First encounter = nothing has ever been logged for this chunk yet, i.e.
  // there's no user-selected starting tempo (practiceBPM) or session history
  // to fall back on — the one moment the suggested-tempo note below is shown.
  const isFirstEncounter = practiceBPM == null && (entry.sessions || []).length === 0;
  // Computed unconditionally (not just isFirstEncounter-gated like the
  // note below) — handleLogSession (App.jsx) also needs this value for
  // needsRelearning's rule 4 (Decisions.md#spaced-repetition--maintenance):
  // a chunk can be flagged for re-learning well past its first encounter,
  // and the tempo it resets to at that moment is this same suggestion.
  const suggestedStartingBPM = getSuggestedStartingBPM(piece, chunk);
  // Pass 26 — the task card states its actual requirement in plain
  // language before logging (docs/Repertoire-Lifecycle.md's "Session
  // outcomes: three tiers, not two"). No tempo clause when practiceBPM
  // isn't seeded yet: classifySessionOutcome treats a null practiceBPM as
  // already-cleared (lib/confidence.js), so a first attempt genuinely only
  // has a reps requirement, not a tempo one — stating a BPM floor that
  // isn't actually being enforced yet would be misleading, not clarifying.
  const requirementText =
    practiceBPM != null
      ? `Need ${requiredReps} clean rep${requiredReps === 1 ? "" : "s"} at ${practiceBPM}+ BPM to progress this chunk.`
      : `Need ${requiredReps} clean rep${requiredReps === 1 ? "" : "s"} to progress this chunk.`;
  // Pass 15 — surfaces stage/consecutivePasses/nextDueDate, computed and
  // persisted on every logged session (lib/ladder.js) but never shown
  // anywhere before now. null for a chunk with no session history yet.
  const ladderStatus = formatLadderStatus(entry, piece.ladderConfig, todayISODate());

  const submitLog = () => {
    if (!canLog) return;
    const cleanReps = Number(reps);
    const bpmAttempted = Number(bpm);
    // Captured immediately on click (pure read, no state write yet) so a
    // window.confirm() below can't stall this number and so a cancelled
    // confirm leaves the running timer untouched.
    const finalDurationSeconds =
      timerRunning && timerStartRef.current
        ? Math.max(
            0,
            timerStartRef.current.baseSeconds + Math.floor((Date.now() - timerStartRef.current.startedAt) / 1000)
          )
        : durationSeconds;
    // Pass 26 — a clarity checkpoint, not a hard block: an attempt that
    // falls short (on reps, or on tempo alone with reps otherwise met —
    // widened post-Pass-26 per the user: a tempo-only shortfall still
    // counts as a Partial pass, not a Full pass, and it's easy to log a
    // slightly-under tempo without noticing that's what just happened)
    // gets confirmed before it saves silently. Zero reps is excluded —
    // already unambiguous. Skipped when manualFail is already checked —
    // that checkbox is itself already an explicit, deliberate "this counts
    // as a fail" choice, so a second confirmation on top of it would be
    // redundant friction, not additional clarity. Confirming (or
    // cancelling) never changes what gets saved — classification below
    // runs unchanged either way.
    const clearsTempo = practiceBPM == null || bpmAttempted >= practiceBPM;
    const isRepsShortfall = cleanReps > 0 && cleanReps < requiredReps;
    const isTempoOnlyShortfall = cleanReps >= requiredReps && !clearsTempo;
    if ((isRepsShortfall || isTempoOnlyShortfall) && !manualFail) {
      const confirmMessage = isRepsShortfall
        ? practiceBPM != null
          ? `You logged ${cleanReps} of the ${requiredReps} reps needed at ${practiceBPM}+ BPM to progress this chunk. Save anyway?`
          : `You logged ${cleanReps} of the ${requiredReps} reps needed to progress this chunk. Save anyway?`
        : `You logged ${cleanReps} clean reps at ${bpmAttempted} BPM, under the ${practiceBPM}+ BPM needed to progress this chunk. Save anyway?`;
      if (!window.confirm(confirmMessage)) return;
    }
    const priorSessions = entry.sessions || [];
    const previousSession = priorSessions.length ? priorSessions[priorSessions.length - 1] : null;
    const previousOutcome = previousSession ? sessionOutcome(previousSession) : null;
    const outcome = classifySessionOutcome({
      cleanReps,
      bpm: bpmAttempted,
      requiredReps,
      practiceBPM,
      manualFail,
      previousOutcome,
      previousCleanReps: previousSession ? previousSession.cleanReps : null,
    });
    onLogSession(chunk.id, day, {
      cleanReps,
      bpm: bpmAttempted,
      outcome,
      durationSeconds: finalDurationSeconds,
      targetBPM,
      suggestedStartingBPM,
    });
    setReps("");
    setBpm("");
    setHasRepsDraft(false);
    setHasBpmDraft(false);
    setManualFail(false);
    setDurationSeconds(0);
    setTimerRunning(false);
  };

  return (
    <div
      // Pass 96 — a stable arrival target for Piece Map's resolved-focus-
      // spot links (App.jsx's scroll-and-highlight effect). Only unique
      // per screen on Day view / "Due today", which is what that link
      // always lands on; "All Tasks" renders one DayChecklist per plan
      // day and can legitimately show the same chunk more than once
      // (new, then reviewed again later), which would repeat this id —
      // a known, accepted imperfection (getElementById just finds the
      // first one), not chased further here.
      id={`checklist-item-${chunk.id}`}
      className={`checklist-item ${checked ? "checked" : ""} ${historical ? "historical" : ""} ${isPaused ? "paused" : ""}`}
    >
      {historical ? (
        <span className="checklist-check" aria-hidden="true">
          <Check size={18} />
        </span>
      ) : checked ? (
        <button
          className="checklist-check"
          onClick={() => onUnlogSession(chunk.id, day)}
          aria-label={undoWillFullyReverse ? "Undo most recent log" : "Remove most recent log"}
          title={
            undoWillFullyReverse
              ? "Undo: removes this log and reverses the tempo and schedule changes it caused."
              : "Removes this log entry, but can't reverse tempo or schedule changes it already caused, because a later session has been logged since or this entry predates undo support."
          }
        >
          <Check size={18} />
        </button>
      ) : (
        <button
          type="button"
          className="checklist-check-empty"
          disabled={!canLog}
          aria-label="Mark done"
          title={canLog ? "Mark done" : isPaused ? "Regular practice is paused. Resolve the focus spot first" : "Fill in reps and BPM first"}
          onClick={submitLog}
        />
      )}
      <div className="checklist-body">
        <div className="checklist-row">
          {chunk.label && <span className="checklist-label">{chunk.label}</span>}
          <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
          <span className={`tag tag-${role}`}>{ROLE_LABEL[role]}</span>
          <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
          <span className="conf-pill mono">{conf}%</span>
        </div>

        {/* Pass 91 (experimental v1) — a chunk with an unresolved focus spot
            pauses here: the rest of this card's regular practice UI
            (requirement line, timer, log inputs, the log button itself) is
            suppressed below, in favor of this one note. Mirrors the
            suppression-without-removal treatment needsRelearning already
            gets on an in-progress chunk's review — the card stays, it just
            isn't actionable the normal way right now. */}
        {isPaused && (
          <div className="paused-note">
            <Target size={14} aria-hidden="true" />
            <span>
              Regular practice paused. {unresolvedFocusSpots.length} focus spot{unresolvedFocusSpots.length === 1 ? "" : "s"} to
              work through first.
              <br />
              <button
                type="button"
                className="link-btn"
                style={{ marginTop: 4 }}
                onClick={() => document.getElementById("focus-spots-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                Jump to focus spot ↑
              </button>
            </span>
          </div>
        )}

        {canAddFocusSpot && !addFocusSpotOpen && (
          <button type="button" className="link-btn" onClick={() => setAddFocusSpotOpen(true)}>
            <Plus size={12} /> Add a focus spot
          </button>
        )}
        {canAddFocusSpot && addFocusSpotOpen && (
          <div className="ts-add-form">
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={focusSpotName}
                onChange={(e) => setFocusSpotName(e.target.value)}
                placeholder="e.g. the descending run"
              />
            </label>
            <label className="field">
              <span>Measure</span>
              <input
                type="text"
                value={focusSpotPosition}
                onChange={(e) => setFocusSpotPosition(e.target.value)}
                placeholder="e.g. 24, 24a, or 24-25"
              />
              {focusSpotPosition.trim() && !focusSpotPositionParsed && (
                <p className="tip-line">
                  Enter a measure number within this piece (e.g. 24, 24a, or 24-25). Use{" "}
                  <em>a</em> or <em>b</em> for half measures.
                </p>
              )}
            </label>
            <div className="ts-form-actions">
              <button
                type="button"
                className="ghost-btn sm"
                onClick={() => {
                  setAddFocusSpotOpen(false);
                  setFocusSpotName("");
                  setFocusSpotPosition("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn sm"
                disabled={!focusSpotName.trim() || !focusSpotPositionParsed}
                onClick={submitAddFocusSpot}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Opt-in: only rendered where a caller passes onReassessRange — no
            current caller does (revival's post-reassessment plan/escalation
            cards passed it through Pass 88, then stopped: moved to one
            shared, bottom-of-plan ReassessPanel instead, mirroring how
            TodayTab's own day checklist and DueReviewPanel already worked).
            Left in place rather than removed — a future caller wanting a
            per-item reassess control still has a working opt-in to reach
            for. Unlike PieceMapTab/InterleavePanel
            (one stateful "current chunk" slot reused across Previous/Next
            or rotation), each ChecklistItem here is already keyed to one
            stable chunk by its own list .map() — there's no cross-chunk
            reuse for a key to guard against. The key is kept anyway,
            matching MemoryAnchorField's identical key={chunk.id} a few
            lines below in this same file, for consistency rather than to
            fix a reproduced bug. Prefixed (reassess-${chunk.id}, not a
            bare key={chunk.id}) only so it can never collide with that
            MemoryAnchorField key if the two ever end up as literal
            siblings under one parent. */}
        {onReassessRange && (
          <ReassessPanel
            key={`reassess-${chunk.id}`}
            piece={piece}
            todaysRanges={[{ start: chunk.start, end: chunk.end }]}
            onReassessRange={onReassessRange}
          />
        )}

        {session && session.skipped ? (
          // Pass 29 — a session logged via Interleaved mode's "skip, just
          // save time" action has no reps/BPM/outcome to report (that's the
          // point of the button), so it gets its own line rather than
          // falling into the "Logged: {cleanReps}...{bpm}..." line below,
          // which would otherwise render literal "undefined"s.
          <p className="tip-line">
            Skipped in Interleaved practice
            {session.durationSeconds ? ` (${formatDuration(session.durationSeconds)} logged)` : ""}. Not marked done.
            Log a real attempt whenever you're ready.
          </p>
        ) : session && session.provisional ? (
          // Pass 29 follow-up — an auto-classified soft-miss/fail logged
          // during Interleaved mode is saved with its real reps/BPM, but
          // deliberately hasn't touched the ladder yet (see App.jsx's
          // handleLogSession `provisional` branch): interleaved retrieval
          // attempts often look rougher than the same chunk would in
          // focused practice, so the learner gets a say before it counts.
          // Confirm applies it now (computeLadderAdvance, dated today, not
          // backdated to the original attempt); Discard drops it as if it
          // never happened — this is also how a rough attempt gets "redone."
          <div className="tip-line">
            <div>
              Provisional: {session.cleanReps} clean rep{session.cleanReps === 1 ? "" : "s"} at {session.bpm} BPM,
              which would be a {outcomeMeta ? outcomeMeta.label.toLowerCase() : "non-pass"}. Not yet applied. Confirm or
              discard, or log a fresh attempt below.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="primary-btn sm"
                onClick={() => onConfirmProvisionalSession(chunk.id, day, { targetBPM, suggestedStartingBPM })}
              >
                Confirm
              </button>
              <button type="button" className="ghost-btn sm" onClick={() => onDiscardProvisionalSession(chunk.id, day)}>
                Discard
              </button>
            </div>
          </div>
        ) : session ? (
          <p className="tip-line">
            Logged: {session.cleanReps} consecutive clean rep{session.cleanReps === 1 ? "" : "s"} at {session.bpm} BPM
            {session.durationSeconds ? ` in ${formatDuration(session.durationSeconds)}` : ""}
            {outcomeMeta ? ` · ${outcomeMeta.label}` : ""}
            {sessionsToday.length > 1 ? ` (attempt ${sessionsToday.length} today)` : ""}
          </p>
        ) : null}
        {/* Pass 59 — the tempo-ratchet overlearning bonus is the only path
            that can push practiceBPM above targetBPM (the normal step and
            computeDemonstratedTempoBaseline both cap at targetBPM), so this
            condition is exactly "the overlearning bonus fired". */}
        {practiceBPM != null && targetBPM && practiceBPM > targetBPM ? (
          <p className="tip-line">
            Overlearning: practice tempo ({practiceBPM} BPM) is now above target ({targetBPM} BPM).
          </p>
        ) : null}
        {!historical && !isPaused && <p className="tip-line"><strong>{requirementText}</strong></p>}
        {!historical && !isPaused && (
          <p className="tip-line">
            Spaced Repetition:{" "}
            {ladderStatus
              ? `${ladderStatus.stageLabel}, ${ladderStatus.progressLabel}${
                  ladderStatus.dueLabel ? ` · Next review ${ladderStatus.dueLabel}` : ""
                }`
              : "not started yet"}
          </p>
        )}
        {!isFirstEncounter && practiceBPM == null && targetBPM ? (
          <p className="tip-line">Target tempo: {targetBPM} BPM</p>
        ) : null}
        {tempoLadder && tempoLadder.length > 0 && (
          <p className="tip-line">Tempo ladder: {tempoLadder.join(" → ")} BPM</p>
        )}

        {!historical && !isPaused && (
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
        )}

        {!historical && !isPaused && (
          <div className="log-row">
            <label>
              <span>Clean reps (aim {requiredReps})</span>
              <NumberInput
                value={reps}
                min={0}
                onCommit={(n) => setReps(n)}
                onDraftChange={(text) => setHasRepsDraft(text !== "")}
                placeholder={String(requiredReps)}
                acceptPlaceholderOnTab
              />
            </label>
            <label>
              <span>BPM achieved</span>
              <NumberInput
                value={bpm}
                min={20}
                onCommit={(n) => setBpm(n)}
                onDraftChange={(text) => setHasBpmDraft(text !== "")}
                acceptPlaceholderOnTab
                placeholder={
                  practiceBPM != null
                    ? String(practiceBPM)
                    : suggestedStartingBPM != null
                    ? String(suggestedStartingBPM)
                    : targetBPM
                    ? String(targetBPM)
                    : "e.g. 88"
                }
              />
            </label>
          </div>
        )}
        {noteText && !noteOpen && <p className="tip-line"><strong>Notes:</strong> {noteText}</p>}
        {canEditNote && (
          noteOpen ? (
            <MemoryAnchorField
              key={chunk.id}
              value={noteText}
              // Commit-on-blur closes the editor too: focus leaving the
              // textarea is the same gesture as "I'm done with this note",
              // and the committed text reappears as the read-only line
              // above, so nothing looks lost. Skips the write entirely when
              // the text is unchanged — opening and closing the editor
              // without typing shouldn't bump the piece's updatedAt, which
              // import-merge reads as "this device has newer state".
              onCommit={(text) => {
                if (text !== noteText) onSetMemoryAnchor(chunk.id, text);
                setNoteOpen(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="link-btn"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setNoteOpen(true)}
            >
              {noteText ? "Edit note" : "+ Add a note"}
            </button>
          )
        )}
        {historical && onGoToNextOccurrence && (
          nextOccurrenceDay != null ? (
            <button
              type="button"
              className="link-btn"
              style={{ alignSelf: "flex-start" }}
              onClick={() => onGoToNextOccurrence(nextOccurrenceDay)}
            >
              Go to next scheduled practice (Day {nextOccurrenceDay}) →
            </button>
          ) : (
            <p className="tip-line" style={{ fontStyle: "italic" }}>
              Not currently scheduled again within this plan.
            </p>
          )
        )}
        {!historical && !isPaused && (
          <>
            <label className="fail-override-row">
              <input type="checkbox" checked={manualFail} onChange={(e) => setManualFail(e.target.checked)} />
              <span>Needs more work (lowers practice tempo, increases chunk visibility)</span>
            </label>
            <button className="primary-btn sm" disabled={!canLog} style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={submitLog}>
              {checked ? "Log another attempt" : "Log practice"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
