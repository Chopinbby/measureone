import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Music, Star } from "lucide-react";
import { NumberInput } from "../../NumberInput";
import { StarButton } from "./StarButton";
import { KeyText } from "./KeyText";
import { itemTitle, itemMeta, octavesText } from "./format";
import { startingTempo, isRepertoireItem } from "../../../lib/technique";
import { formatDuration } from "../../../lib/utils";
import { elapsedSeconds } from "../../../lib/plannedMinutes";
import { TECHNIQUE_MIN_TEMPO, TECHNIQUE_MAX_TEMPO } from "../../../lib/constants";

// One scale/arpeggio task on today's list (Pass 101). Layout and copy follow
// docs/mockups/technique-practice.html; behavior follows
// docs/Technique-Practice.md. No octave selector here, by design — check
// octaves are set in the Library and Add form.
export function TechniqueTaskCard({
  task, item, methodsById, repertoireKeys, open, onToggleOpen,
  onCheckOff, onUncheck, onLogTempo, onToggleStarItem, onToggleStarMethod,
}) {
  const [tempo, setTempo] = useState(item.evenTempo ?? null);
  const tempoRef = useRef(tempo);
  const [tempoError, setTempoError] = useState(false);
  const setTempoBoth = (v) => { tempoRef.current = v; setTempo(v); };

  // Pass 137 — a timer for the task, the same wall-clock rule as the practice cards (Pass 72):
  // the running stretch remembers when it began and the seconds it already held, and every
  // reading is recomputed from the clock (lib/plannedMinutes.js), so a backgrounded tab that
  // skips ticks is still right on return. The seconds are saved with the task's done state,
  // by whichever way it is finished (the tick or the even-rhythm check). Display only: nothing
  // reads them back into any list or schedule. Like the practice cards' timers, this one is
  // lost if the card is left (another tab) before the task is finished.
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
  // What to save at the moment of a click: read from the clock, not from the last tick.
  const secondsNow = () =>
    timerRunning && timerStartRef.current ? elapsedSeconds(timerStartRef.current, Date.now(), Math.floor) : durationSeconds;
  const finishTimer = () => { setTimerRunning(false); setDurationSeconds(0); };

  const title = itemTitle(item);
  const start = startingTempo(item);
  const methods = task.methodIds.map((id) => methodsById[id]).filter(Boolean);
  const inRepertoireKey = isRepertoireItem(item, repertoireKeys);
  // A check-off saved before undo existed has no snapshot to reverse, so it
  // can't be un-checked — say so instead of a button that silently does
  // nothing (Pass 101 review fix).
  const cantUndo = task.done && !task.undo;
  const cantUndoText = "Checked off before undo was available, so this one can't be unchecked.";

  const logCheck = () => {
    const v = tempoRef.current;
    if (v == null || !(v >= TECHNIQUE_MIN_TEMPO && v <= TECHNIQUE_MAX_TEMPO)) {
      setTempoError(true);
      return;
    }
    setTempoError(false);
    const seconds = secondsNow();
    finishTimer();
    onLogTempo(item.id, v, seconds);
  };

  return (
    <div className={`tq-card${task.done ? " done" : ""}`} id={`technique-task-${item.id}`}>
      <button
        type="button"
        className={`tq-check${task.done ? " done" : ""}`}
        aria-label={cantUndo ? `${title} is done. ${cantUndoText}` : task.done ? `Mark ${title} not done` : `Mark ${title} done`}
        title={cantUndo ? cantUndoText : undefined}
        disabled={cantUndo}
        onClick={() => {
          if (task.done) return onUncheck(item.id);
          const seconds = secondsNow();
          finishTimer();
          onCheckOff(item.id, seconds);
        }}
      >
        {task.done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="tq-card-main">
        <div className="tq-card-head" onClick={onToggleOpen}>
          <div>
            <div className="tq-title">
              {item.starred && (
                <span className="tq-title-star" title="You practice this scale more often"><Star size={13} /></span>
              )}
              <KeyText text={title} />
            </div>
            <div className="tq-meta">{itemMeta(item)}</div>
          </div>
          <span className="tq-chevron">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
        </div>

        <div className="tq-methods">
          {methods.map((m) => (
            <div key={m.id} className="tq-method-row">
              <StarButton on={m.starred} onClick={() => onToggleStarMethod(m.id)} label="Suggest this method more often" />
              <div className="tq-method-body" onClick={onToggleOpen}>
                <div className="tq-method-top">
                  <span className="tq-method-name">{m.name}</span>
                  <span className="tq-tech-tag">{m.technique}</span>
                </div>
                {open && m.description && <div className="tq-method-desc">{m.description}</div>}
              </div>
            </div>
          ))}
        </div>

        {inRepertoireKey && (
          <div className="tq-pill-row">
            <span className="tq-pill"><Music size={12} /> Repertoire in this key</span>
          </div>
        )}

        {!task.done && (
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
        {task.done && task.seconds ? <p className="tq-hint">Time spent: {formatDuration(task.seconds)}</p> : null}

        {open && (
          <div className="tq-expanded">
            {start == null ? (
              <div className="tq-start">
                <div>
                  <div className="tq-start-label">No starting tempo yet</div>
                  <div className="tq-start-sub">Your first even-rhythm check sets one.</div>
                </div>
              </div>
            ) : (
              <div className="tq-start">
                <div>
                  <div className="tq-start-label">Recommended starting tempo</div>
                  <div className="tq-start-sub">Start here and work up while it stays clean.</div>
                </div>
                <span className="tq-tip" tabIndex={0}>
                  <span className="tq-start-value mono">♩ = {start}</span>
                  <span className="tq-tip-text" role="tooltip">
                    85% of your last verified tempo (♩ = {item.evenTempo})
                  </span>
                </span>
              </div>
            )}

            {task.done && task.tempo != null ? (
              <p className="tq-ok">Baseline updated to ♩ = {task.tempo}.</p>
            ) : task.done ? (
              <p className="tq-hint">
                Checked off without a tempo.{item.evenTempo != null ? ` Baseline stays at ♩ = ${item.evenTempo}.` : ""}
              </p>
            ) : null}
            {cantUndo && <p className="tq-hint">{cantUndoText}</p>}
            {!task.done && (
              <div className="tq-check-section">
                <div className="tq-check-heading">Finish with an even-rhythm check</div>
                <div className="tq-check-sub">
                  Play {octavesText(item.checkOctaves)} evenly, no rhythm variation. Your cleanest tempo becomes the new baseline.
                </div>
                <div className="tq-check-row">
                  <span className={`tq-tempo-input${tempoError ? " error" : ""}`}>
                    <NumberInput
                      value={tempo ?? ""}
                      onDraftChange={(text) => {
                        setTempoError(false);
                        if (text === "") setTempoBoth(null);
                      }}
                      onCommit={(n) => setTempoBoth(n)}
                    />
                  </span>
                  <button type="button" className="primary-btn sm" onClick={logCheck}>Log check</button>
                  {tempoError && <span className="tq-error">Enter a tempo between {TECHNIQUE_MIN_TEMPO} and {TECHNIQUE_MAX_TEMPO}.</span>}
                </div>
              </div>
            )}

            <div className="tq-more-often">
              <button
                type="button"
                className={`ghost-btn tq-xs${item.starred ? " tq-on" : ""}`}
                aria-pressed={item.starred}
                onClick={() => onToggleStarItem(item.id)}
              >
                <Star size={12} />
                {item.starred ? "Practicing this scale more often" : "Practice this scale more often"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
