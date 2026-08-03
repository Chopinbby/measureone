import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { formatRange, formatDuration } from "../../../lib/utils";
import { ROLE_LABEL, DIFFICULTY_META, REQUIRED_REPS, EFFECTIVENESS_OPTIONS } from "../../../lib/constants";
import { computeConfidence, suggestMethods } from "../../../lib/confidence";

export function ChecklistItem({ chunk, role, piece, day, onLogSession, onUnlogSession, tempoLadder, memoryAnchor }) {
  const entry = piece.progress[chunk.id] || {};
  const checked = (entry.doneDays || []).includes(day);
  const session = (entry.sessions || []).find((s) => s.day === day);
  const conf = computeConfidence(chunk, piece, day);
  const tips = suggestMethods(chunk, conf);
  const [reps, setReps] = useState("");
  const [bpm, setBpm] = useState("");
  const [feel, setFeel] = useState("");
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const canLog = reps !== "" && bpm !== "" && !!feel;

  const submitLog = () => {
    if (!canLog) return;
    onLogSession(chunk.id, day, Number(reps), Number(bpm), feel, elapsed);
    setReps("");
    setBpm("");
    setFeel("");
    setElapsed(0);
    setTimerRunning(false);
  };

  if (checked) {
    const feltLabel = session && EFFECTIVENESS_OPTIONS.find((o) => o.value === session.effectiveness);
    return (
      <div className="checklist-item checked">
        <button className="checklist-check" onClick={() => onUnlogSession(chunk.id, day)} aria-label="Undo">
          <Check size={13} />
        </button>
        <div className="checklist-body">
          <div className="checklist-row">
            {chunk.label && <span className="checklist-label">{chunk.label}</span>}
            <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
            <span className={`tag tag-${role}`}>{ROLE_LABEL[role]}</span>
            <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
            <span className="conf-pill mono">{conf}%</span>
          </div>
          {session && (
            <p className="tip-line">
              Logged: {session.cleanReps} consecutive clean rep{session.cleanReps === 1 ? "" : "s"} at {session.bpm} BPM
              {session.durationSeconds ? ` in ${formatDuration(session.durationSeconds)}` : ""}
              {feltLabel ? ` — ${feltLabel.label.toLowerCase()}` : ""}
            </p>
          )}
          {memoryAnchor && <p className="tip-line"><strong>Memory anchor:</strong> {memoryAnchor}</p>}
          {tempoLadder && tempoLadder.length > 0 && (
            <p className="tip-line">Tempo ladder: {tempoLadder.join(" → ")} BPM</p>
          )}
        </div>
      </div>
    );
  }

  const suggestedReps = REQUIRED_REPS[chunk.difficultyLabel];

  return (
    <div className="checklist-item">
      <button
        type="button"
        className="checklist-check-empty"
        disabled={!canLog}
        aria-label="Mark done"
        title={canLog ? "Mark done" : "Fill in reps, BPM, and how it felt first"}
        onClick={submitLog}
      />
      <div className="checklist-body">
        <div className="checklist-row">
          {chunk.label && <span className="checklist-label">{chunk.label}</span>}
          <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
          <span className={`tag tag-${role}`}>{ROLE_LABEL[role]}</span>
          <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
          <span className="conf-pill mono">{conf}%</span>
        </div>
        <p className="tip-line">Try: {tips.join(", ")}</p>
        {memoryAnchor && <p className="tip-line"><strong>Memory anchor:</strong> {memoryAnchor}</p>}
        {tempoLadder && tempoLadder.length > 0 && (
          <p className="tip-line">Tempo ladder: {tempoLadder.join(" → ")} BPM</p>
        )}

        <div className="timer-row">
          <button type="button" className={`timer-btn ${timerRunning ? "running" : ""}`} onClick={() => setTimerRunning((r) => !r)}>
            {timerRunning ? "Stop" : "Start"} timer
          </button>
          <span className="timer-display mono">{formatDuration(elapsed)}</span>
        </div>

        <div className="log-row">
          <label>
            <span>Clean reps (aim {suggestedReps})</span>
            <input type="number" min={0} value={reps} onChange={(e) => setReps(e.target.value)} placeholder={String(suggestedReps)} />
          </label>
          <label>
            <span>BPM achieved</span>
            <input type="number" min={20} value={bpm} onChange={(e) => setBpm(e.target.value)} placeholder="e.g. 88" />
          </label>
        </div>
        <div className="feel-row">
          <span>How did it feel?</span>
          <div className="segmented">
            {EFFECTIVENESS_OPTIONS.map((o) => (
              <button key={o.value} className={feel === o.value ? "active" : ""} onClick={() => setFeel(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <button className="primary-btn sm" disabled={!canLog} style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={submitLog}>
          Log practice
        </button>
      </div>
    </div>
  );
}
