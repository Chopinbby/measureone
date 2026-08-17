import { useState, useEffect } from "react";
import { formatRange, formatDuration, todayISODate } from "../../../lib/utils";
import { DIFFICULTY_META, SESSION_OUTCOME_META } from "../../../lib/constants";
import {
  computeConfidence,
  classifySessionOutcome,
  getDefaultTargetBPM,
  getSuggestedStartingBPM,
  formatLadderStatus,
  resolveRequiredReps,
} from "../../../lib/confidence";
import { NumberInput } from "../../NumberInput";

// Fixed for this pass (Pass 29) — a tuning choice, not a design one.
// Configurable-per-user rotation interval is explicitly deferred scope.
const ROTATION_SECONDS = 240;

// Interleaved practice: rotates through chunks that have graduated past
// Stabilizing, prompting a log (or an explicit skip) for whichever one is
// "up" every ROTATION_SECONDS. Reuses the exact same rep/BPM/manualFail
// inputs and onLogSession call that ChecklistItem's regular checklist uses
// — this file doesn't reimplement that path, it just drives it from a
// mode-level timer instead of a per-item one (mirroring the setInterval/
// durationSeconds pattern ChecklistItem already uses for its own timer).
export function InterleavePanel({
  piece,
  day,
  items,
  ladderConfig,
  onLogSession,
  onConfirmProvisionalSession,
  onDiscardProvisionalSession,
}) {
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [reps, setReps] = useState("");
  const [bpm, setBpm] = useState("");
  const [manualFail, setManualFail] = useState(false);

  const safeIndex = items.length ? index % items.length : 0;
  const current = items[safeIndex];

  const resetTurn = () => {
    setElapsedSeconds(0);
    setReps("");
    setBpm("");
    setManualFail(false);
  };

  const advance = () => {
    setIndex((i) => (items.length ? (i + 1) % items.length : 0));
    resetTurn();
  };

  useEffect(() => {
    if (!running || items.length === 0) return;
    const id = setInterval(() => {
      setElapsedSeconds((s) => {
        if (s + 1 >= ROTATION_SECONDS) {
          advance();
          return 0;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, items.length]);

  if (items.length === 0 || !current) {
    return (
      <div className="panel">
        <h3>Interleaved practice</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>
          No chunks have graduated past Stabilizing yet.
        </p>
      </div>
    );
  }

  const { chunk } = current;
  const entry = piece.progress[chunk.id] || {};
  const conf = computeConfidence(chunk, piece, day);
  const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, chunk);
  const practiceBPM = entry.practiceBPM ?? null;
  const requiredReps = resolveRequiredReps(chunk);
  const suggestedStartingBPM = getSuggestedStartingBPM(piece, chunk);
  const ladderStatus = formatLadderStatus(entry, ladderConfig, todayISODate());
  const canLog = reps !== "" && bpm !== "";
  // A chunk can come back around in rotation (or the learner can revisit
  // it) while an earlier turn's soft-miss/fail is still sitting
  // unresolved — surfaced here so it isn't silently forgotten mid-session,
  // without blocking the rotation on it (see submitLog below and
  // docs/Decisions.md).
  const sessionsToday = (entry.sessions || []).filter((s) => s.day === day);
  const pendingProvisional = [...sessionsToday].reverse().find((s) => s.provisional);

  const submitLog = () => {
    if (!canLog) return;
    const cleanReps = Number(reps);
    const bpmAttempted = Number(bpm);
    const priorSessions = entry.sessions || [];
    const previousSession = priorSessions.length ? priorSessions[priorSessions.length - 1] : null;
    const previousOutcome = previousSession ? previousSession.outcome : null;
    const outcome = classifySessionOutcome({
      cleanReps,
      bpm: bpmAttempted,
      requiredReps,
      practiceBPM,
      manualFail,
      previousOutcome,
      previousCleanReps: previousSession ? previousSession.cleanReps : null,
    });
    // Interleaved retrieval often looks rougher than the same chunk would
    // in focused, blocked practice while still being the more effective
    // long-term practice — so an AUTO-classified soft-miss/fail (not a
    // manual "needs more work" override, which is already a deliberate
    // fail decision the learner made on purpose) is saved provisionally
    // rather than committed immediately. No blocking confirm dialog here
    // — the point is the rotation keeps flowing; resolving it happens on
    // this chunk's own card, here or in Day view, whenever the learner
    // gets to it. See App.jsx's handleLogSession `provisional` branch.
    const isAutoNonPass = outcome !== "pass" && !manualFail;
    onLogSession(chunk.id, day, {
      cleanReps,
      bpm: bpmAttempted,
      outcome,
      durationSeconds: elapsedSeconds,
      targetBPM,
      suggestedStartingBPM,
      ...(isAutoNonPass ? { provisional: true } : {}),
    });
    advance();
  };

  const skipTurn = () => {
    onLogSession(chunk.id, day, { skipped: true, durationSeconds: elapsedSeconds });
    advance();
  };

  return (
    <div className="panel">
      <div className="checklist-row" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Interleaved practice</h3>
        <span className="tag subtle">{safeIndex + 1} of {items.length}</span>
      </div>
      <p className="wizard-hint">
        Rotates through chunks past Stabilizing, one at a time. Log what you play, or skip to move on without
        recording an outcome. A rough result here is saved but held for your review, not applied immediately —
        interleaved retrieval often looks harder than it is.
      </p>

      <div className="timer-row">
        <button type="button" className={`timer-btn ${running ? "running" : ""}`} onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Start"} rotation
        </button>
        <span className="timer-display mono">
          {formatDuration(elapsedSeconds)} / {formatDuration(ROTATION_SECONDS)}
        </span>
      </div>

      <div className="checklist-item">
        <div className="checklist-body">
          <div className="checklist-row">
            {chunk.label && <span className="checklist-label">{chunk.label}</span>}
            <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
            <span className="tag tag-review">Review</span>
            <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
            <span className="conf-pill mono">{conf}%</span>
          </div>
          <p className="tip-line">
            {practiceBPM != null
              ? `Need ${requiredReps} clean rep${requiredReps === 1 ? "" : "s"} at ${practiceBPM}+ BPM to progress this chunk.`
              : `Need ${requiredReps} clean rep${requiredReps === 1 ? "" : "s"} to progress this chunk.`}
          </p>
          <p className="tip-line">
            Ladder:{" "}
            {ladderStatus
              ? `${ladderStatus.stageLabel} — ${ladderStatus.progressLabel}${
                  ladderStatus.dueLabel ? ` · Next review ${ladderStatus.dueLabel}` : ""
                }`
              : "not started yet"}
          </p>

          {pendingProvisional && (
            <div className="tip-line">
              <div>
                Unresolved from earlier: {pendingProvisional.cleanReps} clean rep
                {pendingProvisional.cleanReps === 1 ? "" : "s"} at {pendingProvisional.bpm} BPM — would be a{" "}
                {(SESSION_OUTCOME_META[pendingProvisional.outcome] || {}).label?.toLowerCase() || "non-pass"}.
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
          )}

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
          <label className="fail-override-row">
            <input type="checkbox" checked={manualFail} onChange={(e) => setManualFail(e.target.checked)} />
            <span>Needs more work (mark as a fail regardless of reps)</span>
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="primary-btn sm" disabled={!canLog} onClick={submitLog}>
              Log practice
            </button>
            <button className="ghost-btn" onClick={skipTurn} title="Save the time spent without recording an outcome">
              Skip, just save time
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
