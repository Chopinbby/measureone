import { useState, useMemo, useEffect } from "react";
import { Check, X, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { generateAllChunks } from "../lib/chunking";
import { computeTimeline } from "../lib/scheduling";
import { todayISODate, addDaysISO, formatMinutes } from "../lib/utils";
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
    workId: null,   // set once workName is non-empty — see lib/works.js
    workName: "",   // title of the whole multi-movement work, "" for a standalone piece
    composer: "",
    notes: "",
    status: "active",   // 'active' | 'paused' | 'archived' — see Repertoire-Lifecycle.md
    totalMeasures,
    measureDifficulty: Array(totalMeasures).fill(1),
    diffMode: "grid",
    sections: [{ id: "s1", name: "", start: 1, end: totalMeasures }],
    recurringMode: "advanced",
    recurringMeasures: 0,
    recurringPairs: [],
    startDate: todayISODate(),
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    targetDate: addDaysISO(todayISODate(), 20),
    practiceDaysPerWeek: 7,
    chunkMode: "auto",
    customChunkSize: 4,
    targetBPM: null,
    bpmZones: [],
    recordings: [],
    createdAt: null,
    progress: {},
    rescheduleMarker: null,
    lastPlayedDate: null,
    lastLoggedAt: null,
    memoryAnchors: {},
    // Tunable config for the spaced-repetition maintenance ladder — see
    // Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built.
    // Hardcoded defaults, no editing UI yet; mirrored in storage.js's
    // DEFAULT_LADDER_CONFIG for pieces migrated from before this existed.
    ladderConfig: {
      stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
      settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
      holding: {
        startIntervalDays: 14,
        intervalGrowthFactor: 1.75,
        maxIntervalDays: 70,
        tempoFloorStartFraction: 0.85,
        tempoFloorStepFraction: 0.05,
        tempoFloorCapFraction: 1,
      },
    },
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

// `joinWork` — {workId, workName, composer} — is set when the wizard was opened
// via "Add a movement" from an existing work, so the new part starts already
// attached to it rather than the user having to retype the title.
export function Wizard({ onCancel, onComplete, hasPiece, joinWork = null }) {
  const [step, setStep] = useState(0);
  // Furthest step reached so far — lets the step indicator act as back/forward
  // navigation without letting the user skip ahead into steps they haven't
  // gotten to (and validated) yet.
  const [maxStep, setMaxStep] = useState(0);
  useEffect(() => {
    setMaxStep((m) => Math.max(m, step));
  }, [step]);
  const [draft, setDraft] = useState(() =>
    joinWork
      ? { ...defaultPiece(), workId: joinWork.workId, workName: joinWork.workName, composer: joinWork.composer || "" }
      : defaultPiece()
  );
  const [startAsRevival, setStartAsRevival] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const chunkSet = useMemo(() => generateAllChunks(draft), [draft]);
  const timeline = useMemo(() => computeTimeline(draft, chunkSet), [draft, chunkSet]);
  const totalMinutes = timeline.days.reduce((s, d) => s + d.minutes, 0);
  const avgMinPerDay = Math.round(totalMinutes / draft.daysToLearn / 5) * 5;

  const canAdvance = () => {
    if (step === 0) return draft.name.trim().length > 0 && draft.totalMeasures > 0;
    if (step === 4) {
      if (draft.scheduleMode === "days" && !draft.targetDate) return false;
      return draft.daysToLearn > 0 && draft.minutesPerDay > 0;
    }
    return true;
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-steps">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                className={`modal-step ${i === step ? "active" : ""} ${i < maxStep ? "done" : ""}`}
                disabled={i > maxStep}
                onClick={() => setStep(i)}
              >
                <span className="modal-step-dot">{i < maxStep ? <Check size={12} /> : i + 1}</span>
                {s}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {step === 0 && (
            <div className="wizard-pane">
              <h2>{joinWork ? "Add a movement" : "What are you learning?"}</h2>
              <p className="wizard-hint">
                {joinWork
                  ? `A new movement of ${joinWork.workName || "this work"}, with its own plan and schedule.`
                  : "Start by entering some basic information about the piece."}
              </p>
              <BasicsFields
                draft={draft}
                set={set}
                lockWork={!!joinWork}
                afterWorkMode={
                  <div className="field" style={{ marginTop: 20 }}>
                    <span>Are you learning it for the first time?</span>
                    <div className="segmented">
                      <button className={!startAsRevival ? "active" : ""} onClick={() => setStartAsRevival(false)}>
                        Yes, learning it fresh
                      </button>
                      <button className={startAsRevival ? "active" : ""} onClick={() => setStartAsRevival(true)}>
                        No, I'm reviving an old piece
                      </button>
                    </div>
                    {startAsRevival && (
                      <p className="wizard-hint" style={{ marginTop: 8 }}>
                        We'll skip the "introduce new material" phase and go straight into a
                        revival — a quick reassessment of where things actually stand. You will be
                        prompted to assess your confidence one chunk at a time after setting up the
                        piece.
                      </p>
                    )}
                  </div>
                }
              />
            </div>
          )}
          {step === 1 && (
            <div className="wizard-pane">
              <h2>How is the piece organized?</h2>
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
              <h2>Set your schedule</h2>
              <p className="wizard-hint">Set a deadline, or commit a set amount of time to spend on this piece per day.</p>
              <ScheduleFields draft={draft} set={set} isRevival={startAsRevival} />
            </div>
          )}
          {step === 5 && (
            <div className="wizard-pane">
              <h2>Ready for MeasureOne</h2>
              {!startAsRevival && (
                <p className="wizard-hint">
                  Cover the whole piece by day {timeline.halfPoint}, then work on drilling,
                  consolidation, and review.
                </p>
              )}
              <ManuscriptStrip chunks={chunkSet.practiceChunks} />
              <div className="review-grid">
                <div className="review-stat"><span className="num">{draft.totalMeasures}</span><span className="lbl">measures</span></div>
                <div className="review-stat"><span className="num">{draft.sections.length}</span><span className="lbl">sections</span></div>
                <div className="review-stat"><span className="num">{draft.daysToLearn}</span><span className="lbl">days</span></div>
                <div className="review-stat"><span className="num">{formatMinutes(avgMinPerDay)}</span><span className="lbl">avg time/day</span></div>
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
