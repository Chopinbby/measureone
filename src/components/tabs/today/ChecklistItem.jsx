import { useState, useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { formatRange, formatDuration, todayISODate } from "../../../lib/utils";
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
import { NumberInput } from "../../NumberInput";
import { MemoryAnchorField } from "../../MemoryAnchorField";

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
}) {
  const entry = piece.progress[chunk.id] || {};
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
    const id = setInterval(() => setDurationSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning]);

  const canLog = reps !== "" && bpm !== "";
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
  // testable on its own.
  const requiredReps = resolveRequiredReps(chunk);
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
        : `You logged ${cleanReps} clean reps at ${bpmAttempted} BPM — under the ${practiceBPM}+ BPM needed to progress this chunk. Save anyway?`;
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
    setManualFail(false);
    setDurationSeconds(0);
    setTimerRunning(false);
  };

  return (
    <div className={`checklist-item ${checked ? "checked" : ""}`}>
      {checked ? (
        <button
          className="checklist-check"
          onClick={() => onUnlogSession(chunk.id, day)}
          aria-label={undoWillFullyReverse ? "Undo most recent log" : "Remove most recent log"}
          title={
            undoWillFullyReverse
              ? "Undo: removes this log and reverses the tempo and schedule changes it caused."
              : "Removes this log entry, but can't reverse tempo or schedule changes it already caused — a later session has been logged since, or this entry predates undo support."
          }
        >
          <Check size={16} />
        </button>
      ) : (
        <button
          type="button"
          className="checklist-check-empty"
          disabled={!canLog}
          aria-label="Mark done"
          title={canLog ? "Mark done" : "Fill in reps and BPM first"}
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
        {session && session.skipped ? (
          // Pass 29 — a session logged via Interleaved mode's "skip, just
          // save time" action has no reps/BPM/outcome to report (that's the
          // point of the button), so it gets its own line rather than
          // falling into the "Logged: {cleanReps}...{bpm}..." line below,
          // which would otherwise render literal "undefined"s.
          <p className="tip-line">
            Skipped in Interleaved practice
            {session.durationSeconds ? ` — ${formatDuration(session.durationSeconds)} logged` : ""}. Not marked done —
            log a real attempt whenever you're ready.
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
              Provisional: {session.cleanReps} clean rep{session.cleanReps === 1 ? "" : "s"} at {session.bpm} BPM —
              would be a {outcomeMeta ? outcomeMeta.label.toLowerCase() : "non-pass"}. Not yet applied — confirm or
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
            {outcomeMeta ? ` — ${outcomeMeta.label}` : ""}
            {sessionsToday.length > 1 ? ` (attempt ${sessionsToday.length} today)` : ""}
          </p>
        ) : null}
        <p className="tip-line"><strong>{requirementText}</strong></p>
        <p className="tip-line">
          Spaced Repetition:{" "}
          {ladderStatus
            ? `${ladderStatus.stageLabel} — ${ladderStatus.progressLabel}${
                ladderStatus.dueLabel ? ` · Next review ${ladderStatus.dueLabel}` : ""
              }`
            : "not started yet"}
        </p>
        {!isFirstEncounter && practiceBPM == null && targetBPM ? (
          <p className="tip-line">Target tempo: {targetBPM} BPM</p>
        ) : null}
        {tempoLadder && tempoLadder.length > 0 && (
          <p className="tip-line">Tempo ladder: {tempoLadder.join(" → ")} BPM</p>
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
            <span>Clean reps (aim {requiredReps})</span>
            <NumberInput value={reps} min={0} onCommit={(n) => setReps(n)} placeholder={String(requiredReps)} />
          </label>
          <label>
            <span>BPM achieved</span>
            <NumberInput
              value={bpm}
              min={20}
              onCommit={(n) => setBpm(n)}
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
        <label className="fail-override-row">
          <input type="checkbox" checked={manualFail} onChange={(e) => setManualFail(e.target.checked)} />
          <span>Needs more work (lowers practice tempo, increases chunk visibility)</span>
        </label>
        <button className="primary-btn sm" disabled={!canLog} style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={submitLog}>
          {checked ? "Log another attempt" : "Log practice"}
        </button>
      </div>
    </div>
  );
}
