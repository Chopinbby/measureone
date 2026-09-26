import { useState, useMemo, useEffect } from "react";
import { Check, X, ChevronLeft, ChevronRight, Sparkles, Target, Plus } from "lucide-react";
import { generateAllChunks, reassociateTroubleSpots } from "../lib/chunking";
import { computeTimeline } from "../lib/scheduling";
import { todayISODate, addDaysISO, formatMinutes, formatRange, parseMeasurePosition } from "../lib/utils";
import { DIFFICULTY_META } from "../lib/constants";
import { BasicsFields } from "./fields/BasicsFields";
import { SectionsEditor } from "./fields/SectionsEditor";
import { DifficultyEditor } from "./fields/DifficultyEditor";
import { RecurringEditor } from "./fields/RecurringEditor";
import { ScheduleFields } from "./fields/ScheduleFields";
import { BpmZonesEditor } from "./fields/BpmZonesEditor";
import { RecordingsEditor } from "./fields/RecordingsEditor";
import { DocumentsEditor } from "./fields/DocumentsEditor";
import { ManuscriptStrip } from "./Manuscript";
import { NumberInput } from "./NumberInput";

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
    // Manual escape hatch for a piece finished away from the app (learned
    // before ever logging every chunk in MeasureOne) — set from Settings,
    // never by the app itself. isPlanActuallyComplete (lib/scheduling.js)
    // treats this as an unconditional override, so setting it flips the
    // piece into maintenance mode (Archive unlocks, Start revival unlocks,
    // the schedule banner stops judging it) the same way genuinely
    // finishing the plan would. See docs/Decisions.md#open-questions.
    markedLearnedElsewhere: false,
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
    chunkSplitPoints: [],
    targetBPM: null,
    // Pass 103 — key of the piece / other keys it passes through, both
    // optional ({ tonic, quality } like technique items). Drives the
    // "Repertoire in this key" tag and pace on the Technique page.
    homeKey: null,
    otherKeys: null,
    bpmZones: [],
    recordings: [],
    documents: [],
    createdAt: null,
    progress: {},
    rescheduleMarker: null,
    lastPlayedDate: null,
    lastLoggedAt: null,
    memoryAnchors: {},
    // Tunable config for the spaced-repetition maintenance ladder — see
    // Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built.
    // Hardcoded defaults, no editing UI yet; mirrored in storage.js's
    // DEFAULT_LADDER_CONFIG (see that file for why bpmSteps.fail is -2, not
    // the doc's original ~8-10 pullback, and why there's no
    // holding.intervalGrowthFactor here) for pieces migrated from before
    // this existed.
    ladderConfig: {
      stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
      settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
      // tempoFloorStartFraction/StepFraction/CapFraction removed — Holding's
      // escalating tempo floor was retired outright in Pass 61. See
      // storage.js's DEFAULT_LADDER_CONFIG for the full removal note.
      holding: { startIntervalDays: 14, maxIntervalDays: 70 },
      bpmSteps: { pass: 2, softMiss: -2, fail: -2 },
      // Pass 59 — the gap-proportional tempo-ratchet rate/cap. Must stay
      // mirrored here alongside bpmSteps above: this object is used as-is
      // (handleComplete, App.jsx, doesn't run new pieces through
      // validateAndMigratePiece/mergeLadderConfig), so a missing
      // tempoRatchet here would crash the very first logged session on any
      // brand-new piece.
      // Pass 60 — tempoAchievedThreshold/maintenanceK extend the same
      // object; missed here once already (found in review, fixed same
      // session) for exactly the reason the comment above already warns
      // about — a brand-new piece silently couldn't enter tempo maintenance
      // mode until its next reload, since this literal is used as-is.
      tempoRatchet: { k: 0.3, kCapBpm: 8, tempoAchievedThreshold: 0.85, maintenanceK: 0.05 },
    },
    revival: {
      active: false,
      startedAt: null,
      purpose: null,
      tempoLadderStartFraction: 0.6,
      reassessmentComplete: false,
      plan: null,
    },
    // Pass 91 (experimental v1) — focus spots: a chunk with extra, focused
    // practice needs (docs/Data-Model.md#focus-spots-v1). troubleSpotsEnabled
    // is the Wizard's yes/no gate, changeable later from Settings — it only
    // ever controls whether the "add a focus spot" UI is offered, never
    // whether an already-flagged spot keeps gating/pausing its chunk (see
    // lib/scheduling.js's focusSpotGate). The individual spots themselves
    // live nested under each chunk's own progress[id].troubleSpots, not
    // here — there's nothing piece-level to default beyond these two.
    troubleSpotsEnabled: false,
    troubleSpotDefaultMinutes: 5,
  };
}

/* ------------------------------------------------------------------ */
/*  Setup Wizard (new piece only)                                     */
/* ------------------------------------------------------------------ */

// Repeats sits right after Sections (not Difficulty) so the wizard's two
// measure-range-entry steps (Sections' section ranges, Repeats' recurring
// passage ranges) are adjacent — Difficulty's grid-click UI doesn't share
// that input shape and reads fine coming after either one.
const STEPS = ["Piece", "Sections", "Repeats", "Difficulty", "Focus spots", "Timeline", "Review"];

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
  // Mirrors BasicsFields' own local toggle state (via onMultiPartChange)
  // purely so canAdvance() can see it — BasicsFields still owns the toggle
  // itself, this is read-only from here. Initial value matches BasicsFields'
  // own init logic for the joinWork ("Add a movement") case.
  const [multiPart, setMultiPart] = useState(!!joinWork);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const chunkSet = useMemo(() => generateAllChunks(draft), [draft]);
  const timeline = useMemo(() => computeTimeline(draft, chunkSet), [draft, chunkSet]);

  // Focus spots (Pass 91 follow-up) — FocusSpotsStep below writes spots
  // straight into draft.progress, keyed by chunk id, before the piece is
  // ever saved. Going back to Piece/Difficulty and changing
  // totalMeasures/chunkMode/customChunkSize regenerates those ids (chunkSet
  // above recomputes from scratch), which used to silently orphan any spot
  // already entered — nothing re-homed it, so it just vanished from the UI
  // with no warning. This keeps draft.progress correctly re-homed against
  // the piece's own current chunks on every relevant change, live, so the
  // Focus spots step is always showing what's actually there, not just
  // fixing it invisibly at the moment the wizard finishes. Reference-equal
  // no-op (reassociateTroubleSpots returns the same object back) once
  // nothing's actually out of place, so this settles after one pass instead
  // of looping.
  useEffect(() => {
    const next = reassociateTroubleSpots(draft.progress, chunkSet.practiceChunks);
    if (next !== draft.progress) set({ progress: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkSet.practiceChunks]);
  const totalMinutes = timeline.days.reduce((s, d) => s + d.minutes, 0);
  const avgMinPerDay = Math.round(totalMinutes / draft.daysToLearn / 5) * 5;

  const canAdvance = () => {
    if (step === 0) {
      if (!(draft.name.trim().length > 0 && draft.totalMeasures > 0)) return false;
      if (multiPart && !draft.workName.trim()) return false;
      return true;
    }
    if (step === 5) {
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
                onMultiPartChange={setMultiPart}
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
                        revival: a quick reassessment of where things actually stand. You will be
                        prompted to assess your confidence one chunk at a time after setting up the
                        piece.
                      </p>
                    )}
                  </div>
                }
              />

              {/* Optional extras, all skippable — canAdvance() for step 0
                  only checks name/totalMeasures, so neither of these ever
                  blocks moving on. Recordings/documents stay fully editable
                  later from Settings too (their own dedicated panels there
                  are unchanged) — this just means a learner who already has
                  a reference link in hand doesn't have to detour through
                  Settings right after finishing setup to enter it. Tempo
                  zones moved to the Sections step below (see the comment
                  there) — sections are the more natural thing to set first,
                  and tempo zones can now copy their ranges from them. */}
              <div className="panel" style={{ marginTop: 20 }}>
                <h3>Recordings (optional)</h3>
                <RecordingsEditor draft={draft} set={set} />
              </div>
              <div className="panel" style={{ marginTop: 14 }}>
                <h3>Documents (optional)</h3>
                <DocumentsEditor draft={draft} set={set} />
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="wizard-pane">
              <h2>How is the piece organized?</h2>
              <SectionsEditor draft={draft} set={set} />
              {/* Tempo zones live here, after sections, rather than on the
                  Piece step where they used to sit — sections are the more
                  natural thing to define first, and BpmZonesEditor's "Copy
                  ranges from sections" button needs draft.sections to
                  already have something worth copying. */}
              <div className="panel" style={{ marginTop: 20 }}>
                <h3>Tempo zones (optional)</h3>
                <BpmZonesEditor draft={draft} set={set} />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="wizard-pane">
              <h2>Any recurring material?</h2>
              <RecurringEditor draft={draft} set={set} />
            </div>
          )}
          {step === 3 && (
            <div className="wizard-pane">
              <h2>How hard is each part?</h2>
              <DifficultyEditor draft={draft} set={set} />
            </div>
          )}
          {step === 4 && (
            <div className="wizard-pane">
              <h2>Any spots that need extra focus?</h2>
              <p className="wizard-hint">
                Some passages need extra, focused practice before they're ready for normal-tempo
                work: an awkward stretch, a tricky rhythm, a spot you keep forgetting. If you
                already know where those are, flag them now and MeasureOne will hold that material
                back from your regular schedule until it's ready.
              </p>
              <div className="field">
                <span>Will any of the difficult chunks have focus spots, specific passages that need extra, deliberate practice before they're ready? You can change this later in Settings.</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={!draft.troubleSpotsEnabled ? "active" : ""}
                    onClick={() => set({ troubleSpotsEnabled: false })}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    className={draft.troubleSpotsEnabled ? "active" : ""}
                    onClick={() => set({ troubleSpotsEnabled: true })}
                  >
                    Yes
                  </button>
                </div>
              </div>
              {draft.troubleSpotsEnabled && <FocusSpotsStep draft={draft} set={set} chunkSet={chunkSet} />}
            </div>
          )}
          {step === 5 && (
            <div className="wizard-pane">
              <h2>Set your schedule</h2>
              <p className="wizard-hint">Set a deadline, or commit a set amount of time to spend on this piece per day.</p>
              <ScheduleFields draft={draft} set={set} isRevival={startAsRevival} />
            </div>
          )}
          {step === 6 && (
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

/* ------------------------------------------------------------------ */
/*  Focus spots step (Pass 91, experimental v1)                       */
/* ------------------------------------------------------------------ */

// Wizard-only — Settings' own touch for this pass is just the on/off
// affordance and the default-minutes field (SettingsTab.jsx), not this
// chunk-by-chunk authoring flow, so this stays local to Wizard.jsx rather
// than joining the shared fields/ components CLAUDE.md otherwise asks
// setup and editing to share.
const FOCUS_SPOTS_PAGE_SIZE = 15;

function FocusSpotsStep({ draft, set, chunkSet }) {
  const [page, setPage] = useState(0);
  const [openChunkId, setOpenChunkId] = useState(null);
  const [editingSpotId, setEditingSpotId] = useState(null);
  const [formName, setFormName] = useState("");
  const [formPosition, setFormPosition] = useState("");

  const practiceChunks = chunkSet.practiceChunks;
  const pageStart = page * FOCUS_SPOTS_PAGE_SIZE;
  const pageChunks = practiceChunks.slice(pageStart, pageStart + FOCUS_SPOTS_PAGE_SIZE);
  const hasNext = pageStart + FOCUS_SPOTS_PAGE_SIZE < practiceChunks.length;
  const hasPrev = page > 0;
  const nextChunks = hasNext
    ? practiceChunks.slice(pageStart + FOCUS_SPOTS_PAGE_SIZE, pageStart + FOCUS_SPOTS_PAGE_SIZE * 2)
    : [];
  const prevChunks = hasPrev ? practiceChunks.slice(pageStart - FOCUS_SPOTS_PAGE_SIZE, pageStart) : [];

  const closeForm = () => {
    setOpenChunkId(null);
    setEditingSpotId(null);
  };
  const openAddForm = (chunkId) => {
    setOpenChunkId(chunkId);
    setEditingSpotId(null);
    setFormName("");
    setFormPosition("");
  };
  const openEditForm = (chunkId, spot) => {
    setOpenChunkId(chunkId);
    setEditingSpotId(spot.id);
    setFormName(spot.name);
    setFormPosition(spot.position || "");
  };
  // Required, not optional — validated the same way (and against the same
  // piece.totalMeasures) as ChecklistItem's own add-spot form, so a spot
  // always has a real measure reference reassociateTroubleSpots
  // (lib/chunking.js) can match it back to a chunk with, however chunking
  // changes later.
  const positionParsed = parseMeasurePosition(formPosition, draft.totalMeasures);
  const saveForm = (chunkId) => {
    const name = formName.trim();
    if (!name || !positionParsed) return;
    const entry = draft.progress[chunkId] || { doneDays: [] };
    const spots = entry.troubleSpots || [];
    const position = formPosition.trim();
    const nextSpots = editingSpotId
      ? spots.map((s) =>
          s.id === editingSpotId ? { ...s, name, position, startMeasure: positionParsed.start, endMeasure: positionParsed.end } : s
        )
      : [
          ...spots,
          {
            id: `fs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name,
            position,
            startMeasure: positionParsed.start,
            endMeasure: positionParsed.end,
            length: null,
            // Set at creation, never changed afterward — this is what
            // computeTimeline's focusSpotGate (lib/scheduling.js) reads to
            // gate the chunk's introduction. Every spot created here, at
            // setup, is necessarily pre-introduction (the piece doesn't
            // exist yet); a spot added later from a chunk's own Daily
            // Practice card (ChecklistItem.jsx) is necessarily post-
            // introduction — that path sets this false instead.
            fromSetup: true,
            resolved: false,
            resolvedBpm: null,
            resolvedAt: null,
            sessions: [],
          },
        ];
    set({ progress: { ...draft.progress, [chunkId]: { ...entry, troubleSpots: nextSpots } } });
    closeForm();
  };
  const removeSpot = (chunkId, spotId) => {
    const entry = draft.progress[chunkId] || { doneDays: [] };
    const nextSpots = (entry.troubleSpots || []).filter((s) => s.id !== spotId);
    set({ progress: { ...draft.progress, [chunkId]: { ...entry, troubleSpots: nextSpots } } });
    if (openChunkId === chunkId && editingSpotId === spotId) closeForm();
  };

  return (
    <div className="panel">
      <h3>Focus spots</h3>
      <p className="wizard-hint">Add one for each spot you already know about. You can always add more later.</p>

      {hasPrev && (
        <p style={{ textAlign: "center", margin: "0 0 10px" }}>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setPage((p) => p - 1);
              closeForm();
            }}
          >
            <ChevronLeft size={13} /> Back to {formatRange(prevChunks[0].start, prevChunks[prevChunks.length - 1].end)}
          </button>
        </p>
      )}

      <ul className="ts-chunk-list">
        {pageChunks.map((chunk) => {
          const entry = draft.progress[chunk.id] || {};
          const spots = entry.troubleSpots || [];
          const diffMeta = DIFFICULTY_META[chunk.difficultyLabel];
          return (
            <li key={chunk.id} className="ts-chunk-row">
              <div className="ts-chunk-row-main">
                <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
                <span
                  className="tag subtle"
                  style={chunk.difficultyLabel === "hard" ? { borderColor: diffMeta.color, color: diffMeta.color } : undefined}
                >
                  {diffMeta.label}
                </span>
                <span className="grow" />
                <button type="button" className="ghost-btn sm" onClick={() => openAddForm(chunk.id)}>
                  <Plus size={13} /> Add a focus spot
                </button>
              </div>
              {spots.length > 0 && (
                <div className="ts-chip-row">
                  {spots.map((s) => (
                    <span key={s.id} className="ts-chip">
                      <button type="button" className="ts-chip-label" onClick={() => openEditForm(chunk.id, s)}>
                        {s.position && <span className="mono">{s.position}</span>}
                        {s.name}
                      </button>
                      <button
                        type="button"
                        className="ts-chip-remove"
                        aria-label={`Remove ${s.name}`}
                        onClick={() => removeSpot(chunk.id, s.id)}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {openChunkId === chunk.id && (
                <div className="ts-add-form">
                  <label className="field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. the left-hand leap"
                    />
                  </label>
                  <label className="field">
                    <span>Measure</span>
                    <input
                      type="text"
                      value={formPosition}
                      onChange={(e) => setFormPosition(e.target.value)}
                      placeholder="e.g. 24, 24a, or 24-25"
                    />
                    {formPosition.trim() && !positionParsed && (
                      <p className="tip-line">
                        Enter a measure number within this piece (e.g. 24, 24a, or 24-25). Use{" "}
                        <em>a</em> or <em>b</em> for half measures.
                      </p>
                    )}
                  </label>
                  <div className="ts-form-actions">
                    <button type="button" className="ghost-btn sm" onClick={closeForm}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-btn sm"
                      disabled={!formName.trim() || !positionParsed}
                      onClick={() => saveForm(chunk.id)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasNext && (
        <p style={{ textAlign: "center", margin: "0 0 18px" }}>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setPage((p) => p + 1);
              closeForm();
            }}
          >
            See {formatRange(nextChunks[0].start, nextChunks[nextChunks.length - 1].end)} <ChevronRight size={13} />
          </button>
        </p>
      )}

      <label className="field" style={{ maxWidth: 340 }}>
        <span>Default focus-spot session length (minutes)</span>
        <NumberInput
          value={draft.troubleSpotDefaultMinutes}
          min={1}
          max={120}
          onCommit={(n) => set({ troubleSpotDefaultMinutes: n })}
        />
        <p className="tip-line">
          How long to work a spot each time it comes up, before checking in again. You can change
          this anytime in Settings.
        </p>
      </label>
    </div>
  );
}
