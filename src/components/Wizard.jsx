import { useState, useMemo } from "react";
import { Check, X, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { generateAllChunks } from "../lib/chunking";
import { computeTimeline } from "../lib/scheduling";
import { BasicsFields } from "./fields/BasicsFields";
import { SectionsEditor } from "./fields/SectionsEditor";
import { DifficultyEditor } from "./fields/DifficultyEditor";
import { RecurringEditor } from "./fields/RecurringEditor";
import { ScheduleFields } from "./fields/ScheduleFields";
import { ManuscriptStrip } from "./Manuscript";

export function defaultPiece() {
  const totalMeasures = 64;
  return {
    id: null,
    name: "",
    composer: "",
    notes: "",
    totalMeasures,
    measureDifficulty: Array(totalMeasures).fill(1),
    diffMode: "grid",
    sections: [{ id: "s1", name: "", start: 1, end: totalMeasures }],
    recurringMode: "advanced",
    recurringMeasures: 0,
    recurringPairs: [],
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    chunkMode: "custom",
    customChunkSize: 4,
    targetBPM: null,
    bpmZones: [],
    recordings: [],
    createdAt: null,
    progress: {},
    rescheduleMarker: null,
    lastPlayedDate: null,
    memoryAnchors: {},
    revival: {
      active: false,
      startedAt: null,
      purpose: null,
      performanceTempo: null,
      tempoLadderStartFraction: 0.6,
      reassessmentComplete: false,
      plan: null,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Setup Wizard (new piece only)                                     */
/* ------------------------------------------------------------------ */

const STEPS = ["Piece", "Sections", "Difficulty", "Repeats", "Timeline", "Review"];

export function Wizard({ onCancel, onComplete, hasPiece }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(defaultPiece());
  const [startAsRevival, setStartAsRevival] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const chunkSet = useMemo(() => generateAllChunks(draft), [draft]);
  const timeline = useMemo(() => computeTimeline(draft, chunkSet), [draft, chunkSet]);
  const totalMinutes = timeline.days.reduce((s, d) => s + d.minutes, 0);
  const avgMinPerDay = Math.round(totalMinutes / draft.daysToLearn / 5) * 5;

  const canAdvance = () => {
    if (step === 0) return draft.name.trim().length > 0 && draft.totalMeasures > 0;
    if (step === 4) return draft.daysToLearn > 0 && draft.minutesPerDay > 0;
    return true;
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`modal-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
                <span className="modal-step-dot">{i < step ? <Check size={12} /> : i + 1}</span>
                {s}
              </div>
            ))}
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {step === 0 && (
            <div className="wizard-pane">
              <h2>What are you learning?</h2>
              <p className="wizard-hint">Start with the basics of the piece.</p>
              <BasicsFields draft={draft} set={set} />

              <div className="field" style={{ marginTop: 20 }}>
                <span>Is this fresh, or a piece you're coming back to?</span>
                <div className="segmented">
                  <button className={!startAsRevival ? "active" : ""} onClick={() => setStartAsRevival(false)}>
                    Learning it fresh
                  </button>
                  <button className={startAsRevival ? "active" : ""} onClick={() => setStartAsRevival(true)}>
                    I already know this piece
                  </button>
                </div>
                {startAsRevival && (
                  <p className="wizard-hint" style={{ marginTop: 8 }}>
                    We'll skip the "introduce new material" phase and go straight into a revival —
                    a quick reassessment of where things actually stand, chunk by chunk.
                  </p>
                )}
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="wizard-pane">
              <h2>What are the piece's sections?</h2>
              <SectionsEditor draft={draft} set={set} />
            </div>
          )}
          {step === 2 && (
            <div className="wizard-pane">
              <h2>How hard is each part?</h2>
              <DifficultyEditor draft={draft} set={set} />
            </div>
          )}
          {step === 3 && (
            <div className="wizard-pane">
              <h2>Any recurring material?</h2>
              <RecurringEditor draft={draft} set={set} />
            </div>
          )}
          {step === 4 && (
            <div className="wizard-pane">
              <h2>Set the schedule</h2>
              <p className="wizard-hint">Fix the constraint that matters most — we'll work out the other one.</p>
              <ScheduleFields draft={draft} set={set} />
            </div>
          )}
          {step === 5 && (
            <div className="wizard-pane">
              <h2>Ready for measure one</h2>
              {!startAsRevival && (
                <p className="wizard-hint">
                  The whole piece gets covered by day {timeline.halfPoint} — the rest of the time is
                  transitions, focus blocks, and review.
                </p>
              )}
              <ManuscriptStrip chunks={chunkSet.practiceChunks} />
              <div className="review-grid">
                <div className="review-stat"><span className="num">{draft.totalMeasures}</span><span className="lbl">measures</span></div>
                <div className="review-stat"><span className="num">{draft.sections.length}</span><span className="lbl">sections</span></div>
                <div className="review-stat"><span className="num">{draft.daysToLearn}</span><span className="lbl">days</span></div>
                <div className="review-stat"><span className="num">{avgMinPerDay}</span><span className="lbl">avg min/day</span></div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="ghost-btn" onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}>
            <ChevronLeft size={16} /> {step === 0 ? (hasPiece ? "Return to Dashboard" : "Cancel") : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button className="primary-btn" disabled={!canAdvance()} onClick={() => setStep((s) => s + 1)}>
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button
              className="primary-btn"
              onClick={() => onComplete({ ...draft, createdAt: Date.now() }, { startAsRevival })}
            >
              <Sparkles size={16} /> {startAsRevival ? "Set up this revival" : "Generate my plan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
