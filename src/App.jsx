import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BookOpen,
  LayoutGrid,
  CalendarDays,
  Music2,
  ListChecks,
  LineChart,
  BarChart3,
  Settings as SettingsIcon,
  Plus,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  Pencil,
  RotateCcw,
  Sparkles,
  Download,
  Upload,
  RefreshCw,
  Flag,
  Shuffle,
} from "lucide-react";

import {
  clamp,
  rangesOverlap,
  formatRange,
  formatDuration,
  formatHoursMinutes,
  sumPracticeSeconds,
  getCurrentDay,
} from "./lib/utils";
import {
  EFFORT_TO_MIN,
  DIFFICULTY_META,
  REQUIRED_REPS,
  ROLE_LABEL,
  EFFECTIVENESS_OPTIONS,
  REVIVAL_PURPOSE_OPTIONS,
  CONFIDENCE_PRESETS,
} from "./lib/constants";
import {
  autoChunkSize,
  generateAllChunks,
  countLearnedSections,
  computeSectionRunThroughs,
  sectionLabel,
} from "./lib/chunking";
import {
  getEffectiveTimeline,
  computeScheduleStatus,
} from "./lib/scheduling";
import {
  getDefaultTargetBPM,
  computeAutoConfidence,
  computeConfidence,
  computeConfidenceAsOf,
  PROGRESS_TIER_META,
  computeProgressTier,
  isManualConfidence,
  suggestMethods,
} from "./lib/confidence";
import {
  getRevivalTargetBPM,
  computeTempoLadder,
  computeRevivalPlan,
} from "./lib/revival";
import {
  loadPiecesFromStorage,
  loadActivePieceId,
  savePieceToStorage,
  saveActivePieceIdToStorage,
  removePieceFromStorage,
  downloadBackup,
  parseBackupPieces,
} from "./lib/storage";

import { NumberInput } from "./components/NumberInput";
import { MemoryAnchorField } from "./components/MemoryAnchorField";
import { ManuscriptDoodle, ManuscriptStrip } from "./components/Manuscript";
import { BasicsFields } from "./components/fields/BasicsFields";
import { SectionsEditor } from "./components/fields/SectionsEditor";
import { DifficultyEditor } from "./components/fields/DifficultyEditor";
import { RecurringEditor } from "./components/fields/RecurringEditor";
import { ScheduleFields } from "./components/fields/ScheduleFields";
import { BpmZonesEditor } from "./components/fields/BpmZonesEditor";
import { RecordingsEditor } from "./components/fields/RecordingsEditor";
import { RecordingsList } from "./components/fields/RecordingsList";
import { RevivalEntryModal } from "./components/RevivalEntryModal";

import { Wizard } from "./components/Wizard";

/* ------------------------------------------------------------------ */
/*  Schedule banner (shared by Overview + Today)                      */
/* ------------------------------------------------------------------ */

function ScheduleBanner({ piece, practiceChunks, timeline, currentDay, onReschedule }) {
  const status = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
  if (status.missedCount === 0) return null;
  return (
    <div className="schedule-banner">
      <div>
        <p className="schedule-banner-title">
          {status.missedCount} chunk{status.missedCount === 1 ? "" : "s"} behind schedule
        </p>
        <p className="schedule-banner-sub">
          Life happens. Rebalance what's left across the rest of your plan without losing what
          you've already learned.
        </p>
      </div>
      <button className="primary-btn" onClick={onReschedule}>
        <RotateCcw size={15} /> Reschedule remaining days
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

function OverviewTab({ piece, practiceChunks, chunks, timeline, currentDay, onReschedule, onAddPiece, onStartRevival }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const tierMeasures = { untouched: 0, learned: 0, comfortable: 0, mastered: 0 };
  practiceChunks.forEach((c) => {
    tierMeasures[computeProgressTier(c, piece)] += c.measureCount;
  });
  const measuresLearned = piece.totalMeasures - tierMeasures.untouched;
  const sectionsLearned = countLearnedSections(piece, practiceChunks);
  const totalPracticeSeconds = sumPracticeSeconds(piece);

  const totalProgressPct = practiceChunks.length
    ? Math.round(practiceChunks.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / practiceChunks.length)
    : 0;

  return (
    <div className="tab-pane">
      <div className="overview-top-row">
        <button className="ghost-btn" onClick={onStartRevival}>
          <RefreshCw size={14} /> {piece.revival && piece.revival.active ? "Continue revival" : "Start revival"}
        </button>
        <button className="ghost-btn" onClick={onAddPiece}>
          <Plus size={14} /> Add new piece
        </button>
      </div>
      <ScheduleBanner piece={piece} practiceChunks={practiceChunks} timeline={timeline} currentDay={currentDay} onReschedule={onReschedule} />
      <div className="hero-card">
        <div className="hero-doodle-band">
          <ManuscriptDoodle />
        </div>
        <div className="hero-content">
          <p className="eyebrow">Now practicing</p>
          <h1>{piece.name}</h1>
          {piece.composer && <p className="hero-composer">{piece.composer}</p>}
          <p className="hero-sub">
            {piece.totalMeasures} measures, {piece.sections.length} sections, {piece.daysToLearn}-day plan
            {piece.lastPlayedDate ? ` · last played ${piece.lastPlayedDate}` : ""}
          </p>
          <RecordingsList recordings={piece.recordings} />
        </div>
      </div>

      <ManuscriptStrip chunks={practiceChunks} />

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-num mono">{measuresLearned}/{piece.totalMeasures}</span><span className="stat-lbl">Measures learned</span></div>
        <div className="stat-card"><span className="stat-num mono">{sectionsLearned}/{piece.sections.length}</span><span className="stat-lbl">Sections learned</span></div>
        <div className="stat-card"><span className="stat-num mono">{formatHoursMinutes(totalPracticeSeconds)}</span><span className="stat-lbl">Time practiced</span></div>
        <div className="stat-card"><span className="stat-num mono">{totalProgressPct}%</span><span className="stat-lbl">Total progress</span></div>
      </div>

      <div className="panel">
        <h3>Practice progress</h3>
        <div className="bal-row">
          {Object.keys(PROGRESS_TIER_META).map((tier) => (
            <div key={tier} className="bal-seg" style={{ flex: tierMeasures[tier] || 0.001, background: PROGRESS_TIER_META[tier].color }} />
          ))}
        </div>
        <div className="diff-summary">
          {Object.keys(PROGRESS_TIER_META).map((tier) => (
            <div key={tier} className="diff-summary-item">
              <i className="dot" style={{ background: PROGRESS_TIER_META[tier].color }} />
              {PROGRESS_TIER_META[tier].label}: <strong>{Math.round((tierMeasures[tier] / piece.totalMeasures) * 100)}%</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>The first week</h3>
        <div className="day-preview-list">
          {timeline.days.slice(0, 7).map((d) => {
            let desc = "Nothing scheduled";
            if (d.type === "consolidation") {
              desc = "Full run-through & consolidation";
            } else {
              const newMeasures = d.newChunkIds.reduce((s, id) => s + chunkById[id].measureCount, 0);
              const reviewMeasures = [...d.specialChunkIds, ...d.reviewChunkIds].reduce(
                (s, id) => s + chunkById[id].measureCount,
                0
              );
              const parts = [];
              if (newMeasures > 0) parts.push(`Learn ${newMeasures} new measures`);
              if (reviewMeasures > 0) parts.push(`review ${reviewMeasures} measures`);
              if (parts.length) {
                desc = parts.join(", ");
                desc = desc[0].toUpperCase() + desc.slice(1);
              }
            }
            return (
              <div key={d.dayNumber} className="day-preview-row">
                <span className="day-num mono">Day {d.dayNumber}</span>
                <span className="day-desc">{desc}</span>
                <span className="day-min mono">{d.minutes} min</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineTab({ chunks, timeline, onSelectDay }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const weeks = [];
  for (let i = 0; i < timeline.days.length; i += 7) weeks.push(timeline.days.slice(i, i + 7));

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Timeline</h1>
        <p className="hero-sub">
          Touch the whole piece by day {timeline.halfPoint}. Review and master until day{" "}
          {timeline.learningDays}. Click a day to see your practice agenda.
        </p>
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="panel">
          <h3>Week {wi + 1}</h3>
          <div className="week-grid">
            {week.map((d) => (
              <button key={d.dayNumber} className={`day-card clickable ${d.type}`} onClick={() => onSelectDay(d.dayNumber)}>
                <div className="day-card-head">
                  <span className="mono">Day {d.dayNumber}</span>
                  <span className="mono day-card-min">{d.minutes}m</span>
                </div>
                {d.type === "consolidation" ? (
                  <p className="day-card-note">Full run-through of the piece</p>
                ) : (
                  <>
                    {d.newChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag new">New</span>
                        {d.newChunkIds.map((id) => (
                          <span key={id} className="chip">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                    {d.specialChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag special">
                          {d.specialChunkIds.some((id) => chunkById[id].kind === "combo") ? "Focus" : "Review"}
                        </span>
                        {d.specialChunkIds.map((id) => (
                          <span key={id} className="chip transition">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                    {d.reviewChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag review">Review</span>
                        {d.reviewChunkIds.map((id) => (
                          <span key={id} className="chip subtle">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PieceMapTab({
  piece,
  chunks,
  currentDay,
  onUpdateBPM,
  onSetManualConfidence,
  onSetWeakSpot = () => {},
  onSetMemoryAnchor = () => {},
  sequentialMode = false,
  initialSelectedId = null,
  onFinishSequential,
  hideHeader = false,
}) {
  const [selected, setSelected] = useState(initialSelectedId);
  const selectedChunk = chunks.find((c) => c.id === selected);
  const selectedEntry = selectedChunk ? piece.progress[selectedChunk.id] || {} : {};
  const selectedIsManual = selectedChunk ? isManualConfidence(selectedChunk, piece.progress) : false;
  const selectedIsWeakSpot = !!selectedEntry.weakSpot;
  const selectedIdx = selectedChunk ? chunks.findIndex((c) => c.id === selected) : -1;

  return (
    <div className="tab-pane">
      {!hideHeader && (
        <div className="tab-header">
          <h1>Piece Map</h1>
          <p className="hero-sub">Color shows confidence. Includes practice chunks, transitions, and focus blocks.</p>
        </div>
      )}

      <div className="confidence-legend">
        <span><i className="dot" style={{ background: "var(--brick)" }} /> Needs work</span>
        <span><i className="dot" style={{ background: "var(--brass)" }} /> Developing</span>
        <span><i className="dot" style={{ background: "var(--teal)" }} /> Confident</span>
      </div>

      <div className="map-grid">
        {chunks.map((c) => {
          const conf = computeConfidence(c, piece, currentDay);
          const manual = isManualConfidence(c, piece.progress);
          const weak = !!(piece.progress[c.id] || {}).weakSpot;
          const tier = conf >= 67 ? "teal" : conf >= 34 ? "brass" : "brick";
          return (
            <button
              key={c.id}
              className={`map-cell tier-${tier} ${selected === c.id ? "selected" : ""}`}
              onClick={() => setSelected(selected === c.id ? null : c.id)}
            >
              {c.kind !== "section" && <span className="map-cell-kind">{c.kind === "combo" ? "Focus" : "Review"}</span>}
              <span className={`map-cell-diff-dot diff-dot-${c.difficultyLabel}`} title={DIFFICULTY_META[c.difficultyLabel].label} />
              <span className="map-cell-range mono">{formatRange(c.start, c.end)}</span>
              <span className="map-cell-conf mono">
                {conf}%{manual && <Pencil size={9} className="manual-mark" title="Set manually" />}
              </span>
              {c.recurring && <span className="map-cell-recurring" title="Recurring material">&#8635;</span>}
              {weak && (
                <span className="map-cell-weak" title="Weak spot">
                  <Flag size={11} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedChunk && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-head">
              <h3>{formatRange(selectedChunk.start, selectedChunk.end)}</h3>
              <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-stats">
                <div><span className="lbl">Difficulty</span><span className="val">{DIFFICULTY_META[selectedChunk.difficultyLabel].label}</span></div>
                <div>
                  <span className="lbl">Confidence</span>
                  <span className="val">
                    {computeConfidence(selectedChunk, piece, currentDay)}%
                    {selectedIsManual && <span className="badge dark">Manual</span>}
                  </span>
                </div>
                <div><span className="lbl">Sessions logged</span><span className="val mono">{(selectedEntry.doneDays || []).length}</span></div>
                {selectedChunk.recurringNote && <div><span className="lbl">Repeats</span><span className="val">{selectedChunk.recurringNote}</span></div>}
              </div>

              <div className="field">
                <span>Weak spot</span>
                <button
                  type="button"
                  className={`weak-toggle ${selectedIsWeakSpot ? "active" : ""}`}
                  onClick={() => onSetWeakSpot(selectedChunk.id, !selectedIsWeakSpot)}
                >
                  <Flag size={14} /> {selectedIsWeakSpot ? "Flagged as weak spot" : "Mark as weak spot"}
                </button>
              </div>

              {sequentialMode && (
                <div className="field">
                  <span>Quick rate</span>
                  <div className="segmented">
                    {CONFIDENCE_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        className={selectedEntry.manualConfidence === p.value ? "active" : ""}
                        onClick={() => onSetManualConfidence(selectedChunk.id, p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="field">
                <span>Confidence override</span>
                {selectedIsManual ? (
                  <div className="manual-conf-row">
                    <NumberInput
                      value={selectedEntry.manualConfidence}
                      min={0}
                      max={100}
                      onCommit={(n) => onSetManualConfidence(selectedChunk.id, n)}
                    />
                    <button className="ghost-btn" onClick={() => onSetManualConfidence(selectedChunk.id, null)}>
                      Reset to automatic
                    </button>
                  </div>
                ) : (
                  <div className="manual-conf-row">
                    <p className="wizard-hint" style={{ margin: 0, flex: 1 }}>
                      Auto-calculated at {computeAutoConfidence(selectedChunk, piece, currentDay)}% right now.
                    </p>
                    <button
                      className="ghost-btn"
                      onClick={() => onSetManualConfidence(selectedChunk.id, computeAutoConfidence(selectedChunk, piece, currentDay))}
                    >
                      Set manually
                    </button>
                  </div>
                )}
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Current BPM</span>
                  <NumberInput value={selectedEntry.currentBPM || ""} min={20} max={400} onCommit={(n) => onUpdateBPM(selectedChunk.id, "currentBPM", n)} />
                </label>
                <label className="field">
                  <span>Target BPM</span>
                  <NumberInput
                    value={selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk) || ""}
                    min={20}
                    max={400}
                    onCommit={(n) => onUpdateBPM(selectedChunk.id, "targetBPM", n)}
                  />
                </label>
              </div>
              {(selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk)) > 0 && (
                <div className="bpm-track">
                  <div
                    className="bpm-fill"
                    style={{
                      width: `${Math.round(
                        clamp(
                          (selectedEntry.currentBPM || 0) / (selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk)),
                          0,
                          1
                        ) * 100
                      )}%`,
                    }}
                  />
                </div>
              )}

              <MemoryAnchorField
                key={selectedChunk.id}
                value={piece.memoryAnchors && piece.memoryAnchors[selectedChunk.id]}
                onCommit={(text) => onSetMemoryAnchor(selectedChunk.id, text)}
              />
            </div>

            {sequentialMode && (
              <div className="modal-foot">
                <button
                  className="ghost-btn"
                  disabled={selectedIdx <= 0}
                  onClick={() => setSelected(chunks[selectedIdx - 1].id)}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <p className="wizard-hint" style={{ margin: 0 }}>
                  Item {selectedIdx + 1} of {chunks.length}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="ghost-btn" onClick={onFinishSequential}>Finish reassessment</button>
                  {selectedIdx < chunks.length - 1 && (
                    <button className="primary-btn" onClick={() => setSelected(chunks[selectedIdx + 1].id)}>
                      Next <ChevronRight size={16} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Today's Practice                                                   */
/* ------------------------------------------------------------------ */

function ChecklistItem({ chunk, role, piece, day, onLogSession, onUnlogSession, tempoLadder, memoryAnchor }) {
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

function DayChecklist({ piece, chunks, day, onLogSession, onUnlogSession, onToggleDone }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));

  if (day.type === "consolidation") {
    const done = ((piece.progress["__consolidation__"] || {}).doneDays || []).includes(day.dayNumber);
    return (
      <div className="panel">
        <h3>Day {day.dayNumber} — Full run-through</h3>
        <p className="wizard-hint">No new material today. Play through the whole piece and note where it still catches.</p>
        <button className={done ? "ghost-btn" : "primary-btn"} onClick={() => onToggleDone("__consolidation__", day.dayNumber)}>
          {done ? <><Check size={14} /> Marked complete</> : "Mark run-through complete"}
        </button>
      </div>
    );
  }

  const items = [
    ...day.newChunkIds.map((id) => ({ id, role: "new" })),
    ...day.specialChunkIds.map((id) => ({ id, role: chunkById[id].kind })),
    ...day.reviewChunkIds.map((id) => ({ id, role: "review" })),
  ];

  if (items.length === 0) {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>Nothing scheduled.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Day {day.dayNumber} — {day.minutes} min planned</h3>
      <div className="checklist">
        {items.map(({ id, role }) => (
          <ChecklistItem
            key={id + role}
            chunk={chunkById[id]}
            role={role}
            piece={piece}
            day={day.dayNumber}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ))}
      </div>
    </div>
  );
}

function FocusPanel({ piece, chunks, currentDay }) {
  const ranked = chunks
    .map((c) => ({ chunk: c, conf: computeConfidence(c, piece, currentDay) }))
    .filter((x) => ((piece.progress[x.chunk.id] || {}).doneDays || []).length > 0)
    .sort((a, b) => a.conf - b.conf)
    .slice(0, 5);

  if (ranked.length === 0) return null;

  return (
    <div className="panel focus-panel">
      <h3>Needs the most work right now</h3>
      <p className="wizard-hint">
        Ranked by confidence across everything you've touched so far — not just what's on today's
        schedule.
      </p>
      <div className="focus-list">
        {ranked.map(({ chunk, conf }) => (
          <div key={chunk.id} className="focus-row">
            <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
            {chunk.kind !== "section" && (
              <span className="tag subtle">{chunk.kind === "combo" ? "Focus block" : "Review"}</span>
            )}
            <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
            <span className="focus-conf mono">{conf}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionRunThroughPanel({ piece, practiceChunks, currentDay, onLogSession, onUnlogSession }) {
  const items = useMemo(
    () => computeSectionRunThroughs(piece, practiceChunks),
    [piece, practiceChunks]
  );

  if (items.length === 0) return null;

  return (
    <div className="panel focus-panel">
      <h3>Section run-throughs</h3>
      <p className="wizard-hint">
        Unlocked once every chunk in a section has been practiced at least once — a chance to play
        through continuously instead of chunk by chunk. Combined section run-throughs unlock once
        the whole piece has been practiced in chunks.
      </p>
      <div className="checklist">
        {items.map((item) => (
          <ChecklistItem
            key={item.id}
            chunk={item}
            role={item.kind}
            piece={piece}
            day={currentDay}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ))}
      </div>
    </div>
  );
}

function ReassessPanel({ piece, todaysRanges, onReassessRange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [level, setLevel] = useState("medium");

  if (todaysRanges.length === 0) return null;

  return (
    <div className="panel reassess-panel">
      {!open ? (
        <div className="reassess-prompt">
          <p className="wizard-hint" style={{ margin: 0 }}>Practiced something today? You can reassess difficulty for specific measures.</p>
          <button className="ghost-btn" onClick={() => setOpen(true)}>Reassess difficulty</button>
        </div>
      ) : (
        <>
          <h3>Reassess difficulty by measure</h3>
          <p className="wizard-hint">Pick a range and a new rating — difficulty is tracked measure by measure, same as setup.</p>
          <div className="reassess-quickpicks">
            {todaysRanges.map((r) => (
              <button key={`${r.start}-${r.end}`} className="chip subtle" onClick={() => { setFrom(r.start); setTo(r.end); }}>
                {formatRange(r.start, r.end)}
              </button>
            ))}
          </div>
          <div className="field-row">
            <label className="field">
              <span>From measure</span>
              <NumberInput value={from} min={1} max={piece.totalMeasures} onCommit={setFrom} />
            </label>
            <label className="field">
              <span>To measure</span>
              <NumberInput value={to} min={1} max={piece.totalMeasures} onCommit={setTo} />
            </label>
          </div>
          <div className="segmented" style={{ marginBottom: 16 }}>
            {["easy", "medium", "hard"].map((lvl) => (
              <button key={lvl} className={level === lvl ? "active" : ""} onClick={() => setLevel(lvl)}>
                {DIFFICULTY_META[lvl].label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="primary-btn"
              onClick={() => {
                onReassessRange(Math.min(from, to), Math.max(from, to), level);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TodayTab({
  piece,
  chunks,
  timeline,
  currentDay,
  onDayChange,
  isRealToday,
  onJumpToday,
  onLogSession,
  onUnlogSession,
  onToggleDone,
  onReschedule,
  onReassessRange,
}) {
  const [viewMode, setViewMode] = useState("day");
  const day = timeline.days[currentDay - 1];
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const practiceChunks = chunks.filter((c) => c.kind === "section");

  const todaysRanges = [...new Set(
    [...day.newChunkIds, ...day.specialChunkIds, ...day.reviewChunkIds]
  )]
    .filter((id) => ((piece.progress[id] || {}).doneDays || []).includes(currentDay))
    .map((id) => chunkById[id])
    .filter(Boolean)
    .map((c) => ({ start: c.start, end: c.end }));

  return (
    <div className="tab-pane">
      <ScheduleBanner piece={piece} practiceChunks={practiceChunks} timeline={timeline} currentDay={currentDay} onReschedule={onReschedule} />

      <div className="tab-header day-nav">
        <div>
          <h1>Today's Practice</h1>
          <p className="hero-sub">Day {currentDay} of {timeline.days.length}{!isRealToday ? " (viewing)" : ""}</p>
        </div>
        <div className="day-nav-controls">
          <div className="segmented">
            <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")}>Day view</button>
            <button className={viewMode === "all" ? "active" : ""} onClick={() => setViewMode("all")}>View all</button>
          </div>
          {viewMode === "day" && (
            <>
              <button className="icon-btn" disabled={currentDay <= 1} onClick={() => onDayChange(currentDay - 1)} aria-label="Previous day"><ChevronLeft size={16} /></button>
              {!isRealToday && <button className="ghost-btn" onClick={onJumpToday}>Jump to today</button>}
              <button className="icon-btn" disabled={currentDay >= timeline.days.length} onClick={() => onDayChange(currentDay + 1)} aria-label="Next day, or work ahead"><ChevronRight size={16} /></button>
            </>
          )}
        </div>
      </div>

      <FocusPanel piece={piece} chunks={chunks} currentDay={currentDay} />
      <SectionRunThroughPanel
        piece={piece}
        practiceChunks={practiceChunks}
        currentDay={currentDay}
        onLogSession={onLogSession}
        onUnlogSession={onUnlogSession}
      />

      {viewMode === "day" ? (
        <DayChecklist piece={piece} chunks={chunks} day={day} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onToggleDone={onToggleDone} />
      ) : (
        <div className="view-all-list">
          {timeline.days.map((d) => (
            <DayChecklist key={d.dayNumber} piece={piece} chunks={chunks} day={d} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onToggleDone={onToggleDone} />
          ))}
        </div>
      )}

      <ReassessPanel piece={piece} todaysRanges={todaysRanges} onReassessRange={onReassessRange} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Revival: recover a piece that was learned once but has gone stale */
/* ------------------------------------------------------------------ */

function RandomStartPanel({ piece, revivalItems, sections }) {
  const [pick, setPick] = useState(null);

  const pool = useMemo(() => {
    const fromChunks = revivalItems.map((c) => ({
      kind: c.kind === "transition" ? "Review" : "Chunk",
      label: formatRange(c.start, c.end),
      anchor: piece.memoryAnchors && piece.memoryAnchors[c.id],
    }));
    const fromSections = (sections || []).map((s, i) => ({
      kind: "Section",
      label: sectionLabel(s, i),
      anchor: piece.memoryAnchors && piece.memoryAnchors[s.id],
    }));
    return [...fromChunks, ...fromSections];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revivalItems, sections, piece.memoryAnchors]);

  const pickRandom = () => {
    if (!pool.length) return;
    setPick(pool[Math.floor(Math.random() * pool.length)]);
  };

  return (
    <div className="panel">
      <h3>Random start</h3>
      <p className="wizard-hint">
        Jump in somewhere you wouldn't have picked yourself — a good way to catch memory gaps you don't
        know are there.
      </p>
      <button className="ghost-btn" onClick={pickRandom}>
        <Shuffle size={14} /> {pick ? "Pick another" : "Pick a starting point"}
      </button>
      {pick && (
        <div className="focus-row" style={{ marginTop: 14, paddingBottom: 0, borderBottom: "none" }}>
          <span className="tag subtle">{pick.kind}</span>
          <span className="mono">{pick.label}</span>
          {pick.anchor && <span className="tip-line" style={{ marginLeft: "auto" }}>{pick.anchor}</span>}
        </div>
      )}
    </div>
  );
}

function RevivalTab({
  piece,
  chunkSet,
  currentDay,
  onUpdateBPM,
  onSetManualConfidence,
  onSetWeakSpot,
  onSetMemoryAnchor,
  onFinishReassessment,
  onReopenReassessment,
  onGeneratePlan,
  onSetPerformanceTempo,
  onSetTempoLadderFraction,
  onLogSession,
  onUnlogSession,
  onEndRevival,
}) {
  const revival = piece.revival || {};
  const revivalItems = useMemo(() => [...chunkSet.practiceChunks, ...chunkSet.transitions], [chunkSet]);
  const chunkById = useMemo(() => Object.fromEntries(revivalItems.map((c) => [c.id, c])), [revivalItems]);
  const ratedCount = revivalItems.filter((c) => isManualConfidence(c, piece.progress)).length;
  const weakSpots = revivalItems.filter((c) => (piece.progress[c.id] || {}).weakSpot);
  const firstUnratedId = (revivalItems.find((c) => !isManualConfidence(c, piece.progress)) || revivalItems[0] || {}).id || null;
  const purposeLabel = REVIVAL_PURPOSE_OPTIONS.find((o) => o.value === revival.purpose);

  return (
    <div className="tab-pane">
      <div className="tab-header day-nav">
        <div>
          <h1>Revival</h1>
          <p className="hero-sub">
            Bringing "{piece.name}" back{purposeLabel ? ` for ${purposeLabel.label.toLowerCase()}` : ""}
            {piece.lastPlayedDate ? ` · last played ${piece.lastPlayedDate}` : ""}
          </p>
        </div>
        <button className="ghost-btn" onClick={onEndRevival}>End revival</button>
      </div>

      <div className="panel">
        <h3>Revival settings</h3>
        <div className="field-row">
          <label className="field">
            <span>Performance tempo override — optional</span>
            <NumberInput
              value={revival.performanceTempo || ""}
              min={20}
              max={400}
              placeholder={piece.targetBPM ? String(piece.targetBPM) : "—"}
              onCommit={onSetPerformanceTempo}
            />
          </label>
          <label className="field">
            <span>Tempo ladder starting point (% of target)</span>
            <NumberInput
              value={Math.round((revival.tempoLadderStartFraction ?? 0.6) * 100)}
              min={10}
              max={95}
              onCommit={(n) => onSetTempoLadderFraction(clamp(n, 10, 95) / 100)}
            />
          </label>
        </div>
      </div>

      {!revival.reassessmentComplete ? (
        <div className="panel">
          <h3>Reassess where things stand</h3>
          <p className="wizard-hint">
            Go chunk by chunk (and seam by seam) and rate confidence from memory right now — this sets a
            fresh baseline for scheduling without touching your original practice history. Flag anything
            that felt shaky as a weak spot; the plan below will prioritize those first.
          </p>
          <p className="derived-stat" style={{ marginBottom: 14 }}>
            <strong className="mono">{ratedCount}</strong> of <strong className="mono">{revivalItems.length}</strong> rated
          </p>
          {revivalItems.length > 0 && (
            <PieceMapTab
              piece={piece}
              chunks={revivalItems}
              currentDay={currentDay}
              onUpdateBPM={onUpdateBPM}
              onSetManualConfidence={onSetManualConfidence}
              onSetWeakSpot={onSetWeakSpot}
              onSetMemoryAnchor={onSetMemoryAnchor}
              sequentialMode
              initialSelectedId={firstUnratedId}
              onFinishSequential={onFinishReassessment}
              hideHeader
            />
          )}
        </div>
      ) : (
        <>
          <div className="panel">
            <h3>Reassessment complete</h3>
            <p className="wizard-hint" style={{ marginBottom: 12 }}>
              {ratedCount} of {revivalItems.length} rated
              {weakSpots.length > 0 ? `, ${weakSpots.length} flagged as weak spot${weakSpots.length === 1 ? "" : "s"}` : ""}.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="ghost-btn" onClick={onReopenReassessment}>Redo reassessment</button>
              <button className="primary-btn" onClick={onGeneratePlan}>
                <Sparkles size={16} /> {revival.plan ? "Regenerate revival plan" : "Generate revival plan"}
              </button>
            </div>
          </div>

          {weakSpots.length > 0 && (
            <div className="panel focus-panel">
              <h3>Flagged weak spots</h3>
              <div className="focus-list">
                {weakSpots.map((c) => (
                  <div key={c.id} className="focus-row">
                    <span className="mono">{formatRange(c.start, c.end)}</span>
                    <span className="tag subtle">{c.kind === "transition" ? "Review" : "Chunk"}</span>
                    {piece.memoryAnchors && piece.memoryAnchors[c.id] && (
                      <span className="tip-line" style={{ marginLeft: "auto" }}>{piece.memoryAnchors[c.id]}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <RandomStartPanel piece={piece} revivalItems={revivalItems} sections={piece.sections} />

          {revival.plan && (
            <>
              <div className="tab-header">
                <h1 style={{ fontSize: 19 }}>Revival plan</h1>
                <p className="hero-sub">
                  Suggested order and pacing, weakest first — everything here is loggable any day, in any
                  order.
                </p>
              </div>
              <div className="view-all-list">
                {revival.plan.days.map((d) => (
                  <div key={d.dayNumber} className="panel">
                    <h3>Suggested day {d.dayNumber} — {d.minutes} min</h3>
                    <div className="checklist">
                      {d.itemIds.map((id) => {
                        const chunk = chunkById[id];
                        if (!chunk) return null;
                        const targetBPM = getRevivalTargetBPM(piece, chunk);
                        const ladder = computeTempoLadder(targetBPM, revival.tempoLadderStartFraction ?? 0.6, 5);
                        return (
                          <ChecklistItem
                            key={id}
                            chunk={chunk}
                            role={chunk.kind === "transition" ? "transition" : "review"}
                            piece={piece}
                            day={currentDay}
                            onLogSession={onLogSession}
                            onUnlogSession={onUnlogSession}
                            tempoLadder={ladder}
                            memoryAnchor={piece.memoryAnchors && piece.memoryAnchors[id]}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Sparkline({ values }) {
  const w = 130;
  const h = 30;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sparkline">
      <polyline points={points} fill="none" stroke="var(--brass-deep)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProgressTab({ piece, chunks, timeline, currentDay }) {
  const practiceChunks = chunks.filter((c) => c.kind === "section");

  // #1 Rolling-window consistency — not a streak: a plain fraction of the
  // last N days with any logged activity, no "best ever" shown alongside it.
  const practicedDays = new Set();
  Object.entries(piece.progress).forEach(([id, entry]) => {
    (entry.sessions || []).forEach((s) => practicedDays.add(s.day));
    if (id === "__consolidation__") (entry.doneDays || []).forEach((d) => practicedDays.add(d));
  });
  const consistencyWindow = Math.min(14, currentDay);
  const consistencyStart = Math.max(1, currentDay - consistencyWindow + 1);
  let consistencyCount = 0;
  for (let d = consistencyStart; d <= currentDay; d++) {
    if (practicedDays.has(d)) consistencyCount++;
  }

  // #6 Most improved this week — biggest positive confidence delta over the
  // trailing 7 days. Absence of a positive delta is shown neutrally.
  const asOfDay = Math.max(1, currentDay - 7);
  const mostImproved = chunks
    .map((c) => ({ chunk: c, delta: computeConfidence(c, piece, currentDay) - computeConfidenceAsOf(c, piece, asOfDay) }))
    .filter((x) => x.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0];

  // #3 Tempo trend — sparkline of logged BPM per chunk with 2+ sessions and
  // a resolvable target, across practice chunks, transitions, and combos.
  const tempoTrends = chunks
    .map((c) => {
      const entry = piece.progress[c.id] || {};
      const sessions = [...(entry.sessions || [])].sort((a, b) => a.day - b.day);
      const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, c);
      return { chunk: c, sessions, targetBPM };
    })
    .filter((t) => t.sessions.length >= 2 && t.targetBPM);

  // #4 Effectiveness calibration — % distribution of self-reported feel
  // across every logged session in the piece.
  const allSessions = Object.values(piece.progress).flatMap((entry) => entry.sessions || []);
  const effectivenessColors = { low: "var(--brick)", good: "var(--brass)", high: "var(--teal)" };
  const effectivenessBreakdown = EFFECTIVENESS_OPTIONS.map((opt) => {
    const count = allSessions.filter((s) => s.effectiveness === opt.value).length;
    return { ...opt, count, pct: allSessions.length ? Math.round((count / allSessions.length) * 100) : 0 };
  });

  // Actual vs. planned progress — how many practice chunks were planned to
  // be introduced by each day vs. how many actually were.
  const firstDoneDay = {};
  practiceChunks.forEach((c) => {
    const dd = (piece.progress[c.id] || {}).doneDays || [];
    if (dd.length) firstDoneDay[c.id] = Math.min(...dd);
  });
  const plannedByDay = {};
  let cumPlanned = 0;
  timeline.days.forEach((d) => {
    cumPlanned += d.newChunkIds.length;
    plannedByDay[d.dayNumber] = cumPlanned;
  });
  const actualByDay = {};
  let cumActual = 0;
  for (let d = 1; d <= timeline.days.length; d++) {
    cumActual += Object.values(firstDoneDay).filter((fd) => fd === d).length;
    actualByDay[d] = cumActual;
  }
  const maxCum = Math.max(plannedByDay[timeline.days.length] || 1, 1);
  const chartDays = timeline.days.slice(0, Math.min(timeline.days.length, Math.max(currentDay + 3, 14)));

  // #5 Projected finish at current pace — a forward-looking companion to
  // the chart above, based on recent (not average) velocity.
  const velocityWindow = Math.min(7, currentDay);
  const velocityStart = Math.max(1, currentDay - velocityWindow + 1);
  const recentlyIntroducedCount = Object.values(firstDoneDay).filter((d) => d >= velocityStart && d <= currentDay).length;
  const recentVelocity = recentlyIntroducedCount / velocityWindow;
  const remainingChunks = practiceChunks.length - Object.keys(firstDoneDay).length;
  let projectionText;
  if (remainingChunks <= 0) {
    projectionText = "Every chunk has been introduced at least once.";
  } else if (recentVelocity <= 0) {
    projectionText = "No recent pace to project from yet — log a few sessions to see a projection.";
  } else {
    const projectedDay = currentDay + Math.ceil(remainingChunks / recentVelocity);
    projectionText = `At your recent pace, full coverage projects to around day ${projectedDay}.`;
  }

  // Recent practice history — unchanged from before.
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const historyByDay = {};
  Object.entries(piece.progress).forEach(([id, entry]) => {
    (entry.doneDays || []).forEach((d) => {
      if (!historyByDay[d]) historyByDay[d] = [];
      historyByDay[d].push(id);
    });
  });
  const historyDays = Object.keys(historyByDay).map(Number).sort((a, b) => b - a).slice(0, 10);

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Progress</h1>
      </div>

      <div className="stat-grid-2">
        <div className="stat-card">
          <span className="stat-num mono">{consistencyCount}</span>
          <span className="stat-lbl">of last {consistencyWindow} day{consistencyWindow === 1 ? "" : "s"} practiced</span>
        </div>
        <div className="stat-card">
          <span className="stat-num mono">{mostImproved ? `+${mostImproved.delta}%` : "—"}</span>
          <span className="stat-lbl">
            {mostImproved ? `Most improved: ${formatRange(mostImproved.chunk.start, mostImproved.chunk.end)}` : "No standout improvement this week"}
          </span>
        </div>
      </div>

      <div className="panel">
        <h3>Consistency</h3>
        <div className="heatmap-row">
          {timeline.days.map((d) => (
            <div
              key={d.dayNumber}
              className="heatmap-cell"
              title={`Day ${d.dayNumber}${practicedDays.has(d.dayNumber) ? " — practiced" : ""}`}
              style={{ background: practicedDays.has(d.dayNumber) ? "var(--teal)" : "var(--paper)" }}
            />
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Actual vs. planned progress</h3>
        <div className="progress-chart">
          {chartDays.map((d) => {
            const p = plannedByDay[d.dayNumber];
            const a = actualByDay[d.dayNumber];
            return (
              <div key={d.dayNumber} className="progress-chart-col" title={`Day ${d.dayNumber}: ${a} actual / ${p} planned`}>
                <div className="progress-chart-bars">
                  <div className="progress-chart-bar planned" style={{ height: `${(p / maxCum) * 100}%` }} />
                  <div className="progress-chart-bar actual" style={{ height: `${(a / maxCum) * 100}%` }} />
                </div>
                {d.dayNumber % 5 === 0 && <span className="progress-chart-label mono">{d.dayNumber}</span>}
              </div>
            );
          })}
        </div>
        <div className="chart-legend">
          <span><i className="dot" style={{ background: "var(--ink-faint)" }} />Planned</span>
          <span><i className="dot" style={{ background: "var(--brass)" }} />Actual</span>
        </div>
      </div>

      <div className="panel">
        <h3>Projected finish</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>{projectionText}</p>
      </div>

      <div className="panel">
        <h3>Tempo trend</h3>
        {tempoTrends.length === 0 ? (
          <p className="wizard-hint">Log a second session on any chunk with a target BPM to see a tempo trend here.</p>
        ) : (
          <div className="tempo-trend-list">
            {tempoTrends.map(({ chunk, sessions, targetBPM }) => (
              <div key={chunk.id} className="tempo-trend-row">
                <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
                <Sparkline values={sessions.map((s) => s.bpm)} />
                <span className="mono tempo-trend-nums">{sessions[sessions.length - 1].bpm} / {targetBPM}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Effectiveness calibration</h3>
        {allSessions.length === 0 ? (
          <p className="wizard-hint">Nothing logged yet — check items off in Today's Practice.</p>
        ) : (
          <div className="analytics-bars">
            {effectivenessBreakdown.map((e) => (
              <div key={e.value} className="analytics-bar-row">
                <span className="analytics-bar-label">{e.label} ({e.count})</span>
                <div className="analytics-bar-track"><div className="analytics-bar-fill" style={{ width: `${e.pct}%`, background: effectivenessColors[e.value] }} /></div>
                <span className="mono">{e.pct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Recent practice history</h3>
        {historyDays.length === 0 ? (
          <p className="wizard-hint">Nothing logged yet — check items off in Today's Practice.</p>
        ) : (
          <div className="history-list">
            {historyDays.map((d) => (
              <div key={d} className="history-row">
                <span className="mono history-day">Day {d}</span>
                <span className="history-items">
                  {historyByDay[d]
                    .map((id) => (id === "__consolidation__" ? "Full run-through" : formatRange(chunkById[id].start, chunkById[id].end)))
                    .join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsTab({ piece, chunks, currentDay }) {
  const byDifficulty = ["easy", "medium", "hard"].map((level) => {
    const list = chunks.filter((c) => c.difficultyLabel === level);
    const avg = list.length
      ? Math.round(list.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / list.length)
      : 0;
    return { level, count: list.length, avg };
  });

  const practiceChunks = chunks.filter((c) => c.kind === "section");
  const recurringChunks = practiceChunks.filter((c) => c.recurring);
  const fullEffort = practiceChunks.reduce((s, c) => s + c.measureCount * c.avgDifficulty, 0);
  const actualEffort = practiceChunks.reduce((s, c) => s + c.effort, 0);
  const minutesSaved = Math.round((fullEffort - actualEffort) * EFFORT_TO_MIN);

  return (
    <div className="tab-pane">
      <div className="tab-header"><h1>Analytics</h1></div>

      <div className="panel">
        <h3>Confidence by difficulty</h3>
        <div className="analytics-bars">
          {byDifficulty.map((d) => (
            <div key={d.level} className="analytics-bar-row">
              <span className="analytics-bar-label">{DIFFICULTY_META[d.level].label} ({d.count})</span>
              <div className="analytics-bar-track"><div className="analytics-bar-fill" style={{ width: `${d.avg}%`, background: DIFFICULTY_META[d.level].color }} /></div>
              <span className="mono">{d.avg}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Recurring material payoff</h3>
        <p className="wizard-hint" style={{ marginBottom: 0 }}>
          {recurringChunks.length} chunk{recurringChunks.length === 1 ? "" : "s"} marked as recurring saved an
          estimated <strong>{minutesSaved}</strong> minutes of practice time in this plan.
        </p>
      </div>
    </div>
  );
}

function SettingsTab({ piece, editDraft, setEditDraft, onSave, onDelete, editing, onStartEdit, onDiscard, onAddPiece, onExportAll, onImportClick }) {
  if (!editing || !editDraft) {
    return (
      <div className="tab-pane">
        <div className="tab-header"><h1>Settings</h1></div>
        <div className="panel">
          <h3>Pieces</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>Add another piece to your practice rotation.</p>
          <button className="ghost-btn" onClick={onAddPiece}>
            <Plus size={14} /> Add new piece
          </button>
        </div>
        <div className="panel">
          <h3>Backup & restore</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>
            Everything is saved only in this browser. Export a backup file now and then, or before
            switching browsers or devices — you can import it back in later.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ghost-btn" onClick={onExportAll}>
              <Download size={14} /> Export all pieces
            </button>
            <button className="ghost-btn" onClick={onImportClick}>
              <Upload size={14} /> Import backup
            </button>
          </div>
        </div>
        <div className="panel">
          <h3>Piece details</h3>
          <dl className="def-list">
            <div><dt>Name</dt><dd>{piece.name}</dd></div>
            {piece.composer && <div><dt>Composer</dt><dd>{piece.composer}</dd></div>}
            <div><dt>Measures</dt><dd className="mono">{piece.totalMeasures}</dd></div>
            <div><dt>Sections</dt><dd className="mono">{piece.sections.length}</dd></div>
            <div><dt>Chunk size</dt><dd className="mono">{piece.chunkMode === "auto" ? `${autoChunkSize(piece.totalMeasures)} (auto)` : `${piece.customChunkSize} (custom)`}</dd></div>
            <div><dt>Recurring material</dt><dd>{piece.recurringMode === "none" ? "None" : piece.recurringMode === "basic" ? `${piece.recurringMeasures} measures (quick count)` : `${piece.recurringPairs.length} passage(s) mapped`}</dd></div>
            <div><dt>Schedule</dt><dd className="mono">{piece.daysToLearn} days, {piece.minutesPerDay} min/day</dd></div>
          </dl>
          {piece.notes && (
            <div className="piece-notes">
              <h4>Notes</h4>
              <p>{piece.notes}</p>
            </div>
          )}
          {piece.recordings && piece.recordings.length > 0 && (
            <div className="piece-notes">
              <h4>Recordings</h4>
              <RecordingsList recordings={piece.recordings} />
            </div>
          )}
          <button className="primary-btn" onClick={onStartEdit}>
            <Pencil size={15} /> Edit piece
          </button>
        </div>
        <div className="panel danger">
          <h3>Delete this piece</h3>
          <p className="wizard-hint">
            Removes "{piece.name || "this piece"}" and its practice history from this browser. Your
            other pieces aren't affected.
          </p>
          <button className="danger-btn" onClick={onDelete}>
            <RotateCcw size={15} /> Delete this piece
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-pane">
      <div className="tab-header"><h1>Edit piece</h1></div>
      <div className="panel"><h3>Piece</h3><BasicsFields draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Sections</h3><SectionsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Difficulty</h3><DifficultyEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Recurring material</h3><RecurringEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Schedule</h3><ScheduleFields draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Tempo zones</h3><BpmZonesEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Recordings</h3><RecordingsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="edit-actions">
        <button className="ghost-btn" onClick={onDiscard}>Discard changes</button>
        <button className="primary-btn" onClick={() => onSave(editDraft)}>
          <Check size={15} /> Save changes
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App shell                                                          */
/* ------------------------------------------------------------------ */

const NAV_BASE = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "timeline", label: "Timeline", icon: CalendarDays },
  { key: "map", label: "Piece Map", icon: Music2 },
  { key: "today", label: "Today's Practice", icon: ListChecks },
  { key: "progress", label: "Progress", icon: LineChart },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];
const REVIVAL_NAV_ITEM = { key: "revival", label: "Revival", icon: RefreshCw };

export default function App() {
  const [pieces, setPieces] = useState({});
  const [activePieceId, setActivePieceId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [editDraft, setEditDraftState] = useState(null);
  const [dayOverride, setDayOverride] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [revivalModalOpen, setRevivalModalOpen] = useState(false);
  const importInputRef = useRef(null);

  const piece = activePieceId ? pieces[activePieceId] : null;

  // Load every saved piece, then whichever one was active last.
  useEffect(() => {
    const found = loadPiecesFromStorage();
    setPieces(found);
    setActivePieceId(loadActivePieceId(found));
    setLoaded(true);
  }, []);

  // Persist only the active piece when it changes.
  useEffect(() => {
    if (!loaded || !activePieceId || !pieces[activePieceId]) return;
    savePieceToStorage(activePieceId, pieces[activePieceId]);
  }, [pieces, activePieceId, loaded]);

  // Persist which piece is active.
  useEffect(() => {
    if (!loaded) return;
    saveActivePieceIdToStorage(activePieceId);
  }, [activePieceId, loaded]);

  const updatePiece = (updater) => {
    if (!activePieceId) return;
    setPieces((prev) => {
      const current = prev[activePieceId];
      if (!current) return prev;
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [activePieceId]: next };
    });
  };

  const chunkSet = useMemo(() => (piece ? generateAllChunks(piece) : null), [piece]);
  const chunks = chunkSet ? chunkSet.all : [];
  const practiceChunks = chunkSet ? chunkSet.practiceChunks : [];
  const timeline = useMemo(() => (piece ? getEffectiveTimeline(piece, chunkSet) : null), [piece, chunkSet]);
  const realCurrentDay = useMemo(
    () => (piece && timeline ? getCurrentDay(piece, timeline.days.length) : 1),
    [piece, timeline]
  );
  const currentDay = dayOverride || realCurrentDay;

  const navItems = useMemo(() => {
    if (!piece || !piece.revival || !piece.revival.active) return NAV_BASE;
    const items = [...NAV_BASE];
    items.splice(items.findIndex((n) => n.key === "progress"), 0, REVIVAL_NAV_ITEM);
    return items;
  }, [piece && piece.revival && piece.revival.active]);

  const switchToPiece = (id) => {
    setActivePieceId(id);
    setSwitcherOpen(false);
    setActiveTab("overview");
    setDayOverride(null);
    setSettingsEditing(false);
    setEditDraftState(null);
  };

  const handleComplete = (finished) => {
    const id = `p_${Date.now()}`;
    const withId = { ...finished, id };
    setPieces((prev) => ({ ...prev, [id]: withId }));
    setActivePieceId(id);
    setWizardOpen(false);
    setSwitcherOpen(false);
    setActiveTab("overview");
    setDayOverride(null);
  };

  const handleDeletePiece = () => {
    if (!piece) return;
    if (!window.confirm(`Delete "${piece.name}" and all its practice history? This can't be undone.`)) return;
    const idToDelete = piece.id;
    const remainingIds = Object.keys(pieces).filter((id) => id !== idToDelete);
    setPieces((prev) => {
      const next = { ...prev };
      delete next[idToDelete];
      return next;
    });
    removePieceFromStorage(idToDelete);
    setActivePieceId(remainingIds[0] || null);
    setEditDraftState(null);
    setSettingsEditing(false);
    setActiveTab("overview");
    setDayOverride(null);
  };

  const handleExportAll = () => downloadBackup(pieces);

  const handleImportClick = () => importInputRef.current?.click();

  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      let importedPieces;
      try {
        importedPieces = parseBackupPieces(reader.result);
      } catch (e) {
        window.alert("That file doesn't look like a valid MeasureOne backup.");
        return;
      }
      if (!importedPieces || importedPieces.length === 0) {
        window.alert("No pieces found in that backup file.");
        return;
      }
      const next = { ...pieces };
      let firstNewId = null;
      importedPieces.forEach((p) => {
        if (!p || !p.id) return;
        const id = next[p.id] ? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : p.id;
        const withId = { ...p, id };
        next[id] = withId;
        if (!firstNewId) firstNewId = id;
        savePieceToStorage(id, withId);
      });
      setPieces(next);
      if (!activePieceId && firstNewId) setActivePieceId(firstNewId);
      window.alert(`Imported ${importedPieces.length} piece(s).`);
    };
    reader.readAsText(file);
  };

  // Editing state lives here, not inside SettingsTab, so switching tabs
  // mid-edit doesn't unmount (and lose) the in-progress draft.
  const startEditing = () => {
    setEditDraftState((d) => d || { ...piece });
    setSettingsEditing(true);
    setActiveTab("settings");
  };
  const setEditDraft = (patch) => setEditDraftState((d) => ({ ...d, ...patch }));
  const handleSavePiece = (updated) => {
    updatePiece({ ...updated, rescheduleMarker: null });
    setEditDraftState(null);
    setSettingsEditing(false);
  };
  const handleDiscardEdit = () => {
    setEditDraftState(null);
    setSettingsEditing(false);
  };

  const handleToggleDone = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId], doneDays: [...progress[chunkId].doneDays] } : { doneDays: [] };
      const idx = entry.doneDays.indexOf(day);
      if (idx >= 0) entry.doneDays.splice(idx, 1);
      else entry.doneDays.push(day);
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleLogSession = (chunkId, day, cleanReps, bpm, effectiveness, durationSeconds) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId] || { doneDays: [] };
      const doneDays = prevEntry.doneDays.includes(day) ? prevEntry.doneDays : [...prevEntry.doneDays, day];
      const sessions = (prevEntry.sessions || []).filter((s) => s.day !== day);
      sessions.push({ day, cleanReps, bpm, effectiveness, durationSeconds });
      progress[chunkId] = { ...prevEntry, doneDays, sessions, currentBPM: bpm };
      return { ...p, progress };
    });
  };

  const handleUnlogSession = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const doneDays = (prevEntry.doneDays || []).filter((d) => d !== day);
      const sessions = (prevEntry.sessions || []).filter((s) => s.day !== day);
      progress[chunkId] = { ...prevEntry, doneDays, sessions };
      return { ...p, progress };
    });
  };

  const handleUpdateBPM = (chunkId, field, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry[field] = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleSetManualConfidence = (chunkId, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry.manualConfidence = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleSetWeakSpot = (chunkId, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry.weakSpot = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleSetMemoryAnchor = (id, text) => {
    updatePiece((p) => {
      const memoryAnchors = { ...(p.memoryAnchors || {}) };
      const trimmed = (text || "").trim();
      if (trimmed) memoryAnchors[id] = trimmed;
      else delete memoryAnchors[id];
      return { ...p, memoryAnchors };
    });
  };

  const handleUpdateRevival = (patch) => {
    updatePiece((p) => ({ ...p, revival: { ...(p.revival || {}), ...patch } }));
  };

  const handleOpenRevival = () => {
    if (piece.revival && piece.revival.active) setActiveTab("revival");
    else setRevivalModalOpen(true);
  };

  const handleStartRevival = ({ purpose, performanceTempo, lastPlayedDate }) => {
    updatePiece((p) => ({
      ...p,
      lastPlayedDate: lastPlayedDate || p.lastPlayedDate || null,
      revival: {
        active: true,
        startedAt: Date.now(),
        purpose,
        performanceTempo: performanceTempo || null,
        tempoLadderStartFraction: 0.6,
        reassessmentComplete: false,
        plan: null,
      },
    }));
    setRevivalModalOpen(false);
    setActiveTab("revival");
  };

  const handleEndRevival = () => {
    if (!window.confirm("End this revival cycle? Weak-spot flags and confidence ratings stay, but the revival plan will be cleared.")) return;
    updatePiece((p) => ({
      ...p,
      revival: {
        active: false,
        startedAt: null,
        purpose: null,
        performanceTempo: null,
        tempoLadderStartFraction: 0.6,
        reassessmentComplete: false,
        plan: null,
      },
    }));
    setActiveTab("overview");
  };

  const handleGenerateRevivalPlan = () => {
    handleUpdateRevival({ plan: computeRevivalPlan(piece, chunkSet, currentDay) });
  };

  const handleReassessRange = (from, to, level) => {
    const levelNum = level === "easy" ? 1 : level === "medium" ? 2 : 3;
    updatePiece((p) => {
      const measureDifficulty = [...p.measureDifficulty];
      for (let m = from; m <= to; m++) {
        if (m >= 1 && m <= measureDifficulty.length) measureDifficulty[m - 1] = levelNum;
      }
      return { ...p, measureDifficulty };
    });
  };

  const handleSelectDay = (dayNumber) => {
    setDayOverride(dayNumber);
    setActiveTab("today");
  };

  const handleReschedule = () => {
    const status = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
    if (status.remainingChunkIds.length === 0) return;

    const remaining = practiceChunks.filter((c) => status.remainingChunkIds.includes(c.id));
    const remainingEffort = remaining.reduce((s, c) => s + c.effort, 0);
    const availableDays = Math.max(1, timeline.days.length - currentDay + 1);
    const requiredDays = Math.max(
      1,
      Math.ceil(((remainingEffort * EFFORT_TO_MIN) / 0.65) / Math.max(5, piece.minutesPerDay))
    );

    let message = `This will rebalance the ${status.remainingChunkIds.length} chunk(s) you haven't started yet across the days left in your plan. Chunks you've already practiced stay where they are. Continue?`;
    if (requiredDays > availableDays) {
      message = `Heads up: at your current pace (${piece.minutesPerDay} min/day), what's left realistically needs about ${requiredDays} more day(s), but only ${availableDays} day(s) remain in this plan. Rescheduling will pack things in as tightly as possible, but you likely won't finish everything by your target date. You could extend the timeline in Settings instead.\n\nReschedule anyway?`;
    }

    if (!window.confirm(message)) return;
    updatePiece((p) => ({
      ...p,
      rescheduleMarker: { asOfDay: currentDay, remainingChunkOrder: status.remainingChunkIds },
    }));
  };

  const pieceList = Object.values(pieces).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  return (
    <div className="measureone-app">
      <style>{CSS}</style>
      <input
        type="file"
        accept="application/json"
        ref={importInputRef}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files[0];
          if (file) handleImportFile(file);
          e.target.value = "";
        }}
      />

      {!loaded ? (
        <div className="empty-state">
          <p className="wizard-hint" style={{ margin: 0 }}>Loading your pieces…</p>
        </div>
      ) : !piece ? (
        <div className="empty-state">
          <div className="hero-card empty-hero-card">
            <div className="hero-doodle-band"><ManuscriptDoodle /></div>
            <div className="hero-content empty-hero-content">
              <p className="eyebrow">MeasureOne</p>
              <h1>A practice plan for the piece that feels impossible.</h1>
              <p className="empty-sub">
                Tell us the measures, the hard parts, and how long you've got. We'll turn it into
                a day-by-day plan you can actually follow.
              </p>
              <button className="primary-btn lg" onClick={() => setWizardOpen(true)}>
                <Plus size={18} /> Start a new piece
              </button>
              {pieceList.length > 0 && (
                <button className="ghost-btn" style={{ marginTop: 16 }} onClick={() => switchToPiece(pieceList[pieceList.length - 1].id)}>
                  Return to Dashboard
                </button>
              )}
              <button className="ghost-btn" style={{ marginTop: 16 }} onClick={handleImportClick}>
                <Upload size={14} /> Import a backup
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="app-shell">
          <nav className="sidebar">
            <div className="brand"><BookOpen size={20} /><span>MeasureOne</span></div>

            <button className="piece-switcher-trigger" onClick={() => setSwitcherOpen((o) => !o)}>
              <span className="piece-switcher-name">{piece.name || "Untitled piece"}</span>
              <ChevronDown size={14} className={switcherOpen ? "rotated" : ""} />
            </button>
            {switcherOpen && (
              <div className="piece-switcher-list">
                {pieceList.map((p) => (
                  <button
                    key={p.id}
                    className={`piece-switcher-item ${p.id === activePieceId ? "active" : ""}`}
                    onClick={() => switchToPiece(p.id)}
                  >
                    {p.name || "Untitled piece"}
                  </button>
                ))}
                <button className="piece-switcher-add" onClick={() => { setWizardOpen(true); setSwitcherOpen(false); }}>
                  <Plus size={14} /> Add new piece
                </button>
              </div>
            )}

            <div className="nav-list">
              {navItems.map((n) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.key}
                    className={`nav-item ${activeTab === n.key ? "active" : ""}`}
                    onClick={() => setActiveTab(n.key)}
                  >
                    <Icon size={17} />
                    <span>{n.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="sidebar-foot">
              <button className="ghost-btn full" onClick={startEditing}>
                <Pencil size={14} /> Edit piece
              </button>
            </div>
          </nav>

          <main className="main-content">
            {activeTab === "overview" && (
              <OverviewTab piece={piece} practiceChunks={practiceChunks} chunks={chunks} timeline={timeline} currentDay={currentDay} onReschedule={handleReschedule} onAddPiece={() => setWizardOpen(true)} onStartRevival={handleOpenRevival} />
            )}
            {activeTab === "timeline" && <TimelineTab chunks={chunks} timeline={timeline} onSelectDay={handleSelectDay} />}
            {activeTab === "map" && (
              <PieceMapTab
                piece={piece}
                chunks={chunks}
                currentDay={currentDay}
                onUpdateBPM={handleUpdateBPM}
                onSetManualConfidence={handleSetManualConfidence}
                onSetWeakSpot={handleSetWeakSpot}
                onSetMemoryAnchor={handleSetMemoryAnchor}
              />
            )}
            {activeTab === "revival" && piece.revival && piece.revival.active && (
              <RevivalTab
                piece={piece}
                chunkSet={chunkSet}
                currentDay={currentDay}
                onUpdateBPM={handleUpdateBPM}
                onSetManualConfidence={handleSetManualConfidence}
                onSetWeakSpot={handleSetWeakSpot}
                onSetMemoryAnchor={handleSetMemoryAnchor}
                onFinishReassessment={() => handleUpdateRevival({ reassessmentComplete: true })}
                onReopenReassessment={() => handleUpdateRevival({ reassessmentComplete: false })}
                onGeneratePlan={handleGenerateRevivalPlan}
                onSetPerformanceTempo={(n) => handleUpdateRevival({ performanceTempo: n || null })}
                onSetTempoLadderFraction={(n) => handleUpdateRevival({ tempoLadderStartFraction: n })}
                onLogSession={handleLogSession}
                onUnlogSession={handleUnlogSession}
                onEndRevival={handleEndRevival}
              />
            )}
            {activeTab === "today" && (
              <TodayTab
                piece={piece}
                chunks={chunks}
                timeline={timeline}
                currentDay={currentDay}
                isRealToday={currentDay === realCurrentDay}
                onDayChange={(d) => setDayOverride(clamp(d, 1, timeline.days.length))}
                onJumpToday={() => setDayOverride(null)}
                onLogSession={handleLogSession}
                onUnlogSession={handleUnlogSession}
                onToggleDone={handleToggleDone}
                onReschedule={handleReschedule}
                onReassessRange={handleReassessRange}
              />
            )}
            {activeTab === "progress" && <ProgressTab piece={piece} chunks={chunks} timeline={timeline} currentDay={currentDay} />}
            {activeTab === "analytics" && <AnalyticsTab piece={piece} chunks={chunks} currentDay={currentDay} />}
            {activeTab === "settings" && (
              <SettingsTab
                piece={piece}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onSave={handleSavePiece}
                onDelete={handleDeletePiece}
                editing={settingsEditing}
                onStartEdit={startEditing}
                onDiscard={handleDiscardEdit}
                onAddPiece={() => setWizardOpen(true)}
                onExportAll={handleExportAll}
                onImportClick={handleImportClick}
              />
            )}
          </main>
        </div>
      )}

      {wizardOpen && <Wizard onCancel={() => setWizardOpen(false)} onComplete={handleComplete} hasPiece={!!piece} />}
      {revivalModalOpen && piece && (
        <RevivalEntryModal piece={piece} onCancel={() => setRevivalModalOpen(false)} onStart={handleStartRevival} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.measureone-app {
  --paper: #EEF0EC;
  --paper-card: #F8F9F6;
  --ink: #202A33;
  --ink-soft: #57646F;
  --ink-faint: #8B96A0;
  --line: rgba(32,42,51,0.14);
  --brass: #B98A3E;
  --brass-deep: #8F6A2D;
  --teal: #2E6E63;
  --brick: #B5473A;
  --white: #FFFFFF;
  font-family: 'Inter', sans-serif;
  color: var(--ink);
  background: var(--paper);
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
}
.measureone-app *, .measureone-app *::before, .measureone-app *::after { box-sizing: border-box; }
.measureone-app h1, .measureone-app h2, .measureone-app h3 {
  font-family: 'Fraunces', serif; font-weight: 600; margin: 0; color: var(--ink);
}
.measureone-app .mono { font-family: 'IBM Plex Mono', monospace; }
.measureone-app button { font-family: inherit; cursor: pointer; }
.measureone-app input { font-family: inherit; }
.measureone-app :focus-visible { outline: 2px solid var(--brass-deep); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .measureone-app * { transition: none !important; animation: none !important; }
}

.app-shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 232px; flex-shrink: 0; background: var(--paper-card); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; padding: 20px 14px; position: sticky; top: 0; height: 100vh;
}
.brand { display: flex; align-items: center; gap: 8px; padding: 6px 10px 20px; font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; color: var(--brass-deep); }
.nav-list { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; border: none;
  background: transparent; color: var(--ink-soft); font-size: 14px; font-weight: 500; text-align: left;
  width: 100%; transition: background .15s, color .15s;
}
.nav-item span { flex: 1; }
.nav-item:hover { background: rgba(185,138,62,0.1); color: var(--ink); }
.nav-item.active { background: var(--brass); color: var(--white); }
.sidebar-foot { padding-top: 12px; border-top: 1px solid var(--line); margin-top: 8px; }

.piece-switcher-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--white); font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; }
.piece-switcher-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.piece-switcher-trigger svg.rotated { transform: rotate(180deg); }
.piece-switcher-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; padding: 6px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; max-height: 240px; overflow-y: auto; }
.piece-switcher-item { text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-switcher-item:hover { background: rgba(185,138,62,0.08); }
.piece-switcher-item.active { background: var(--brass); color: var(--white); font-weight: 600; }
.piece-switcher-add { display: flex; align-items: center; gap: 6px; text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; font-size: 13px; color: var(--brass-deep); font-weight: 600; border-top: 1px solid var(--line); margin-top: 4px; padding-top: 10px; }
.piece-switcher-add:hover { background: rgba(185,138,62,0.08); }

.main-content { flex: 1; padding: 32px 40px 64px; max-width: 940px; }

@media (max-width: 820px) {
  .app-shell { flex-direction: column; }
  .sidebar { width: 100%; height: auto; position: static; flex-direction: row; align-items: center; overflow-x: auto; padding: 10px; gap: 10px; }
  .brand { padding: 6px 10px; }
  .nav-list { flex-direction: row; }
  .nav-item span { display: none; }
  .sidebar-foot { display: none; }
  .main-content { padding: 20px; }
}

.empty-state { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.empty-hero-card { max-width: 620px; }
.empty-hero-content { text-align: center; padding: 12px 36px 40px; }
.empty-hero-content h1 { font-size: clamp(26px, 4vw, 36px); line-height: 1.15; margin: 10px 0 16px; }
.empty-sub { color: var(--ink-soft); font-size: 15px; line-height: 1.6; margin: 0 0 26px; }

.eyebrow { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: var(--brass-deep); margin: 0 0 6px; font-weight: 600; }

.hero-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.hero-doodle-band { padding: 14px 24px 0; background: linear-gradient(180deg, rgba(185,138,62,0.07), rgba(185,138,62,0)); }
.manuscript-doodle { width: 100%; height: 64px; display: block; opacity: 0.16; }
.hero-content { padding: 6px 32px 32px; }
.hero-content h1 { font-size: clamp(22px, 3vw, 30px); line-height: 1.2; }
.hero-sub { color: var(--ink-soft); font-size: 14px; margin-top: 8px; }
.hero-composer { color: var(--ink-soft); font-size: 15px; font-style: italic; margin-top: 2px; }

.manuscript-strip { display: flex; height: 46px; border-radius: 8px; margin: 20px 0 4px; border: 1px solid var(--line); position: relative; }
.manuscript-strip.compact { height: 28px; }
.manuscript-block { position: relative; border-right: 2px solid var(--paper); min-width: 3px; }
.manuscript-block:first-child { border-top-left-radius: 7px; border-bottom-left-radius: 7px; }
.recurring-dot { position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.85); }
.final-barline { width: 4px; background: var(--ink); border-top-right-radius: 7px; border-bottom-right-radius: 7px; }
.block-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-6px);
  background: var(--ink);
  color: var(--paper);
  font-size: 11px;
  line-height: 1.3;
  padding: 4px 9px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  z-index: 20;
}
.manuscript-block:hover .block-tooltip, .manuscript-block:focus-visible .block-tooltip { opacity: 1; }
.manuscript-block:first-child .block-tooltip { left: 0; transform: translateY(-6px); }
.manuscript-block:nth-last-child(2) .block-tooltip { left: auto; right: 0; transform: translateY(-6px); }

.tab-pane { display: flex; flex-direction: column; gap: 22px; }
.overview-top-row { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: -8px; }
.tab-header { margin-bottom: -4px; }
.tab-header h1 { font-size: 26px; }
.day-nav { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.day-nav-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.panel { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; }
.panel h3 { font-size: 15px; margin-bottom: 14px; }
.panel.danger { border-color: rgba(181,71,58,0.35); }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 640px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
.stat-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 4px; }
.stat-num { font-size: 24px; font-weight: 600; color: var(--brass-deep); }
.stat-lbl { font-size: 12px; color: var(--ink-soft); }

.bal-row { display: flex; height: 14px; border-radius: 7px; overflow: hidden; }
.bal-seg { height: 100%; }
.diff-summary { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.diff-summary-item { font-size: 13.5px; color: var(--ink-soft); display: flex; align-items: center; }
.diff-summary-item strong { color: var(--ink); margin-left: 4px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; flex-shrink: 0; }

.day-preview-list { display: flex; flex-direction: column; }
.day-preview-row { display: flex; align-items: center; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.day-preview-row:last-child { border-bottom: none; }
.day-num { width: 56px; color: var(--brass-deep); flex-shrink: 0; }
.day-desc { flex: 1; color: var(--ink-soft); }
.day-min { color: var(--ink-faint); flex-shrink: 0; }

.def-list { display: flex; flex-direction: column; gap: 10px; margin: 0 0 18px; }
.def-list > div { display: flex; justify-content: space-between; font-size: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); gap: 12px; }
.def-list dt { color: var(--ink-soft); }
.def-list dd { margin: 0; text-align: right; }

.piece-notes { margin: 0 0 18px; }
.piece-notes h4 { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); margin: 0 0 6px; }
.piece-notes p { margin: 0; font-size: 14px; color: var(--ink); white-space: pre-wrap; line-height: 1.5; }
.edit-actions { display: flex; justify-content: flex-end; gap: 10px; padding-bottom: 20px; }

.week-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.day-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--white); }
.day-card.clickable { cursor: pointer; text-align: left; font: inherit; color: inherit; width: 100%; }
.day-card.clickable:hover { border-color: var(--brass); }
.day-card.consolidation { background: rgba(185,138,62,0.08); }
.day-card-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-soft); margin-bottom: 8px; }
.day-card-min { color: var(--brass-deep); }
.day-card-note { font-size: 12.5px; color: var(--ink-soft); margin: 0; }
.day-card-group { margin-bottom: 6px; }
.day-card-tag { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin-bottom: 4px; }
.day-card-tag.special { color: var(--brass-deep); }
.chip { display: inline-block; font-size: 11.5px; font-family: 'IBM Plex Mono', monospace; background: var(--teal); color: var(--white); padding: 2px 7px; border-radius: 5px; margin: 0 4px 4px 0; }
.chip.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.chip.transition { background: var(--brass); }

.diff-grid-wrap { border: 1px solid var(--line); border-radius: 10px; padding: 10px; max-height: 300px; overflow-y: auto; background: var(--white); }
.diff-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 4px; }
.diff-cell { aspect-ratio: 1; border: none; border-radius: 4px; font-size: 9px; font-family: 'IBM Plex Mono', monospace; color: var(--white); }
.diff-cell.diff-1 { background: var(--teal); }
.diff-cell.diff-2 { background: var(--brass); }
.diff-cell.diff-3 { background: var(--brick); }
.diff-cell:hover { filter: brightness(1.1); }

.badge { display: inline-block; font-size: 9.5px; background: rgba(255,255,255,0.25); padding: 1px 6px; border-radius: 20px; margin-left: 6px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.03em; }
.badge.dark { background: rgba(185,138,62,0.18); color: var(--brass-deep); }
.manual-mark { margin-left: 4px; vertical-align: middle; opacity: 0.6; }
.manual-conf-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.manual-conf-row input { width: 80px; flex-shrink: 0; }
.derived-stat { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; }
.derived-stat strong { color: var(--brass-deep); }

.schedule-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: rgba(181,71,58,0.08); border: 1px solid rgba(181,71,58,0.3); border-radius: 14px; padding: 16px 20px; }
.schedule-banner-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; margin: 0 0 4px; color: var(--brick); }
.schedule-banner-sub { font-size: 12.5px; color: var(--ink-soft); margin: 0; max-width: 480px; }

.confidence-legend { display: flex; gap: 18px; font-size: 13px; color: var(--ink-soft); flex-wrap: wrap; }
.confidence-legend span { display: flex; align-items: center; }
.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.map-cell { position: relative; border: 1px solid var(--line); border-radius: 10px; padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; background: var(--white); text-align: left; }
.map-cell.tier-teal { background: rgba(46,110,99,0.14); border-color: rgba(46,110,99,0.4); }
.map-cell.tier-brass { background: rgba(185,138,62,0.14); border-color: rgba(185,138,62,0.4); }
.map-cell.tier-brick { background: rgba(181,71,58,0.14); border-color: rgba(181,71,58,0.4); }
.map-cell.selected { outline: 2px solid var(--ink); outline-offset: -1px; }
.map-cell-kind { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); }
.map-cell-range { font-size: 12.5px; font-weight: 600; }
.map-cell-conf { font-size: 15px; font-weight: 600; color: var(--ink); display: flex; align-items: center; }
.map-cell-diff-dot { position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-radius: 50%; }
.diff-dot-easy { background: var(--teal); }
.diff-dot-medium { background: var(--brass); }
.diff-dot-hard { background: var(--brick); }
.map-cell-recurring { position: absolute; bottom: 10px; right: 10px; font-size: 13px; color: var(--ink-faint); }
.map-cell-weak { position: absolute; bottom: 10px; left: 10px; color: var(--brick); display: inline-flex; }

.weak-toggle { display: inline-flex; align-items: center; gap: 7px; align-self: flex-start; border: 1px solid var(--line); background: var(--white); color: var(--ink-soft); border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 600; transition: border-color .15s, background .15s, color .15s; }
.weak-toggle:hover { border-color: var(--brick); }
.weak-toggle.active { border-color: var(--brick); background: rgba(181,71,58,0.1); color: var(--brick); }

.detail-panel { border-color: var(--ink); }
.detail-modal { max-width: 480px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.detail-modal .modal-body { padding: 22px 22px 24px; }
.detail-stats { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.detail-stats > div { display: flex; justify-content: space-between; font-size: 13.5px; border-bottom: 1px solid var(--line); padding-bottom: 7px; }
.detail-stats .lbl { color: var(--ink-soft); }
.detail-stats .val { font-weight: 600; }

.checklist { display: flex; flex-direction: column; gap: 10px; }
.checklist-item { display: flex; gap: 12px; align-items: flex-start; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--white); }
.checklist-item.checked { background: rgba(46,110,99,0.08); border-color: rgba(46,110,99,0.35); }
.checklist-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--teal); background: rgba(46,110,99,0.15); flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--teal); margin-top: 2px; }
.checklist-check-empty { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--ink-faint); background: var(--white); flex-shrink: 0; margin-top: 2px; padding: 0; cursor: pointer; transition: border-color .15s, background .15s; }
.checklist-check-empty:hover:not(:disabled) { border-color: var(--teal); background: rgba(46,110,99,0.08); }
.checklist-check-empty:disabled { cursor: not-allowed; opacity: 0.6; }
.checklist-body { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.checklist-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.checklist-label { font-weight: 700; }
.tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
.tag-new { background: var(--brass); color: var(--white); }
.tag-review { background: var(--ink-soft); color: var(--white); }
.tag-transition { background: var(--teal); color: var(--white); }
.tag-combo { background: var(--brick); color: var(--white); }
.tag-section-runthrough { background: var(--brass-deep); color: var(--white); }
.tag-section-transition { background: var(--ink); color: var(--white); }
.tag.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.conf-pill { margin-left: auto; font-size: 12px; color: var(--brass-deep); font-weight: 600; }
.tip-line { font-size: 12px; color: var(--ink-soft); margin: 0; }
.timer-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.timer-btn { border: 1px solid var(--line); background: var(--white); color: var(--ink-soft); border-radius: 7px; padding: 5px 12px; font-size: 12px; font-weight: 600; }
.timer-btn.running { background: var(--brick); border-color: var(--brick); color: var(--white); }
.timer-display { font-size: 13px; color: var(--ink-soft); min-width: 40px; }
.log-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.log-row label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--ink-soft); font-weight: 600; }
.log-row input { width: 90px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 13px; background: var(--white); color: var(--ink); font-family: 'IBM Plex Mono', monospace; }
.feel-row { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--ink-soft); font-weight: 600; margin-top: 8px; }
.primary-btn.sm { padding: 7px 14px; font-size: 12.5px; }

.view-all-list { display: flex; flex-direction: column; gap: 14px; }

.focus-panel { border-color: rgba(181,71,58,0.3); }
.focus-list { display: flex; flex-direction: column; gap: 8px; }
.focus-row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.focus-row:last-child { border-bottom: none; padding-bottom: 0; }
.focus-conf { margin-left: auto; font-weight: 600; color: var(--brick); }

.reassess-panel { border-color: rgba(185,138,62,0.35); }
.reassess-prompt { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.reassess-quickpicks { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }

.stat-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 640px) { .stat-grid-2 { grid-template-columns: 1fr; } }

.progress-chart { display: flex; align-items: flex-end; gap: 6px; height: 140px; padding-top: 10px; }
.progress-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
.progress-chart-bars { display: flex; gap: 2px; align-items: flex-end; height: 120px; width: 100%; justify-content: center; }
.progress-chart-bar { width: 6px; border-radius: 3px 3px 0 0; }
.progress-chart-bar.planned { background: var(--ink-faint); opacity: 0.5; }
.progress-chart-bar.actual { background: var(--brass); }
.progress-chart-label { font-size: 9px; color: var(--ink-faint); }
.chart-legend { display: flex; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--ink-soft); }
.chart-legend span { display: flex; align-items: center; }

.heatmap-row { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 6px; }
.heatmap-cell { flex: 0 0 20px; height: 20px; border-radius: 4px; border: 1px solid var(--line); }

.sparkline { flex-shrink: 0; }
.tempo-trend-list { display: flex; flex-direction: column; gap: 10px; }
.tempo-trend-row { display: flex; align-items: center; gap: 12px; font-size: 12.5px; }
.tempo-trend-row .mono:first-child { width: 90px; flex-shrink: 0; }
.tempo-trend-nums { width: 90px; flex-shrink: 0; text-align: right; color: var(--ink-soft); }

.history-list { display: flex; flex-direction: column; gap: 8px; }
.history-row { display: flex; gap: 14px; font-size: 13px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.history-row:last-child { border-bottom: none; padding-bottom: 0; }
.history-day { color: var(--brass-deep); width: 56px; flex-shrink: 0; }
.history-items { color: var(--ink-soft); }

.analytics-bars { display: flex; flex-direction: column; gap: 14px; }
.analytics-bar-row { display: flex; align-items: center; gap: 12px; }
.analytics-bar-label { width: 110px; flex-shrink: 0; font-size: 13px; color: var(--ink-soft); }
.analytics-bar-track { flex: 1; height: 10px; border-radius: 6px; background: var(--paper); overflow: hidden; }
.analytics-bar-fill { height: 100%; border-radius: 6px; }

.primary-btn { display: inline-flex; align-items: center; gap: 8px; background: var(--brass); color: var(--white); border: none; border-radius: 9px; padding: 10px 18px; font-size: 14px; font-weight: 600; transition: background .15s; }
.primary-btn:hover:not(:disabled) { background: var(--brass-deep); }
.primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.primary-btn.lg { padding: 13px 24px; font-size: 15px; }

.ghost-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 9px; padding: 9px 16px; font-size: 13.5px; font-weight: 500; transition: border-color .15s, background .15s; }
.ghost-btn:hover { border-color: var(--brass); background: rgba(185,138,62,0.06); }
.ghost-btn.full { width: 100%; justify-content: center; }

.danger-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--brick); color: var(--brick); border-radius: 9px; padding: 9px 16px; font-size: 13.5px; font-weight: 600; }
.danger-btn:hover { background: rgba(181,71,58,0.08); }

.icon-btn { background: transparent; border: none; color: var(--ink-soft); width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
.icon-btn:hover:not(:disabled) { background: rgba(32,42,51,0.06); color: var(--ink); }
.icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.modal-overlay { position: fixed; inset: 0; background: rgba(32,42,51,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { background: var(--paper-card); border-radius: 16px; width: 100%; max-width: 640px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--line); }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.modal-steps { display: flex; gap: 16px; flex-wrap: wrap; }
.modal-step { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-faint); font-weight: 500; }
.modal-step.active { color: var(--brass-deep); }
.modal-step.done { color: var(--teal); }
.modal-step-dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
.modal-body { padding: 26px 26px 10px; overflow-y: auto; flex: 1; }
.modal-foot { display: flex; justify-content: space-between; padding: 18px 26px; border-top: 1px solid var(--line); }

.wizard-pane h2 { font-size: 20px; margin-bottom: 6px; }
.wizard-hint { color: var(--ink-soft); font-size: 13.5px; margin: 0 0 20px; line-height: 1.5; }

.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.field > span { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); }
.field input[type="text"], .field input[type="number"] { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); }
.field textarea { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); font-family: inherit; resize: vertical; }
.field input:disabled { color: var(--ink-faint); background: var(--paper); }
.field-row { display: flex; gap: 16px; }
.field-row .field { flex: 1; }

.segmented { display: inline-flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; flex-wrap: wrap; }
.segmented button { border: none; background: var(--white); color: var(--ink-soft); padding: 8px 14px; font-size: 13px; font-weight: 500; border-right: 1px solid var(--line); }
.segmented button:last-child { border-right: none; }
.segmented button.active { background: var(--brass); color: var(--white); }

.pairs-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.pair-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); flex-wrap: wrap; }
.pair-row input { width: 52px; border: 1px solid var(--line); border-radius: 6px; padding: 6px; font-size: 13px; text-align: center; font-family: 'IBM Plex Mono', monospace; background: var(--white); color: var(--ink); }
.pair-row input.name-input { width: 120px; text-align: left; font-family: 'Inter', sans-serif; }
.pair-label { flex-shrink: 0; }

.recording-row { display: flex; align-items: center; gap: 6px; }
.recording-row input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font-size: 13px; background: var(--white); color: var(--ink); }
.recording-row input.name-input { flex: 0.8; }
.recordings-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.recording-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--brass-deep); background: rgba(185,138,62,0.08); border: 1px solid var(--line); border-radius: 20px; padding: 5px 12px; text-decoration: none; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recording-link:hover { background: rgba(185,138,62,0.16); }

.review-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 20px; }
.review-stat { background: var(--white); border: 1px solid var(--line); border-radius: 10px; padding: 14px; text-align: center; }
.review-stat .num { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; color: var(--brass-deep); }
.review-stat .lbl { font-size: 11px; color: var(--ink-soft); }
`;
