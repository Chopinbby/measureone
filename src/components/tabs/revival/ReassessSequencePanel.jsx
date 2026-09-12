import { useState, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, RotateCcw, TrendingUp, Metronome, AlertTriangle, LayoutGrid, Check, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
import { NumberInput } from "../../NumberInput";
import { MemoryAnchorField } from "../../MemoryAnchorField";
import { clamp, formatRange, formatDuration, todayISODate, findRelatedChunks } from "../../../lib/utils";
import { DIFFICULTY_META, CONFIDENCE_PRESETS, ROLE_LABEL } from "../../../lib/constants";
import { computeConfidence, isManualConfidence, getDefaultTargetBPM, formatLadderStatus, hasClimbingTempo } from "../../../lib/confidence";
import { simulateTempoConvergence, tempoConvergenceExceedsWarning, TEMPO_CONVERGENCE_WARNING_DAYS } from "../../../lib/ladder";
import { ReassessPanel } from "../today/ReassessPanel";

const DIFFICULTY_SIGNAL_ICON = {
  easy: SignalLow,
  medium: SignalMedium,
  hard: SignalHigh,
};

// Pass 87 — retires PieceMapTab's old `sequentialMode` embed (a mode flag
// threaded through the ordinary Piece Map component, rendering a full grid
// of cells underneath a modal-over-grid detail view). This is a dedicated,
// self-contained panel for Revival's reassessment phase instead: one chunk
// shown inline at a time, no grid underneath. A separate "Progress" modal
// (its own floating overlay, not layered over a grid) gives the same
// "jump to any chunk" access the old grid-of-cells used to, via
// difficulty-tinted, checkmark-when-rated squares.
export function ReassessSequencePanel({
  piece,
  chunks,
  currentDay,
  ratedCount,
  onUpdateBPM,
  onSetManualConfidence,
  onSetMemoryAnchor,
  onClearRelearning = () => {},
  onReassessRange = () => {},
  onLogSession = () => {},
  onAssessmentTimerRiskChange = () => {},
  onConfirmLeaveAssessmentTimer,
  onFinishReassessment,
}) {
  const firstUnratedId = (chunks.find((c) => !isManualConfidence(c, piece.progress)) || chunks[0] || {}).id || null;
  const [selected, setSelected] = useState(firstUnratedId);
  const [progressModalOpen, setProgressModalOpen] = useState(false);

  // Falls back to the first item if `selected` ever stops resolving (e.g.
  // the piece's chunk structure changed underneath an open session) —
  // without this, the whole panel would silently render nothing at all,
  // with no grid left to recover into the way ordinary Piece Map still has.
  const selectedChunk = chunks.find((c) => c.id === selected) || chunks[0];
  const selectedEntry = selectedChunk ? piece.progress[selectedChunk.id] || {} : {};
  const selectedIsManual = selectedChunk ? isManualConfidence(selectedChunk, piece.progress) : false;
  const selectedIdx = selectedChunk ? chunks.findIndex((c) => c.id === selected) : -1;
  const ladderStatus = selectedChunk ? formatLadderStatus(selectedEntry, piece.ladderConfig, todayISODate()) : null;
  const selectedClimbing = selectedChunk ? hasClimbingTempo(selectedEntry) : false;
  const resolvedTargetBPM = selectedChunk ? selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk) || null : null;
  const tempoSimulation = selectedChunk
    ? simulateTempoConvergence(
        {
          stage: selectedEntry.stage,
          consecutivePasses: selectedEntry.consecutivePasses,
          consecutiveStabilizingFails: selectedEntry.consecutiveStabilizingFails,
          practiceBPM: selectedEntry.practiceBPM,
          targetBPM: resolvedTargetBPM,
          tier1Done: selectedEntry.tier1Done,
          needsRelearning: selectedEntry.needsRelearning,
          stabilizingEntryBPM: selectedEntry.stabilizingEntryBPM,
          settlingEntryBPM: selectedEntry.settlingEntryBPM,
          holdingEntryBPM: selectedEntry.holdingEntryBPM,
          tempoRatchetK: selectedEntry.tempoRatchetK,
          holdingReviewCount: selectedEntry.holdingReviewCount,
        },
        piece.ladderConfig,
        todayISODate()
      )
    : null;
  const tempoWarning = tempoConvergenceExceedsWarning(tempoSimulation);

  // Same read-only-by-default Target BPM pattern PieceMapTab's old
  // sequentialMode branch used — resets on every chunk switch so Previous/
  // Next doesn't carry an open editor onto the next chunk.
  const [bpmOverrideOpen, setBpmOverrideOpen] = useState(false);
  useEffect(() => setBpmOverrideOpen(false), [selected]);

  // Per-chunk assessment timer — carried over unchanged from PieceMapTab's
  // old sequentialMode branch (Pass 76), same wall-clock reconciliation
  // pattern (timerStartRef captures the real start moment; each tick
  // recomputes elapsed from Date.now() rather than blindly incrementing).
  const [timerRunning, setTimerRunning] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const timerStartRef = useRef(null);

  useEffect(() => {
    if (!timerRunning) return;
    timerStartRef.current = { startedAt: Date.now(), baseSeconds: durationSeconds };
    const id = setInterval(() => {
      setDurationSeconds(
        timerStartRef.current.baseSeconds + Math.round((Date.now() - timerStartRef.current.startedAt) / 1000)
      );
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning]);

  useEffect(() => {
    setTimerRunning(false);
    setDurationSeconds(0);
  }, [selected]);

  const logAssessedTime = () => {
    const finalDurationSeconds =
      timerRunning && timerStartRef.current
        ? Math.max(0, timerStartRef.current.baseSeconds + Math.floor((Date.now() - timerStartRef.current.startedAt) / 1000))
        : durationSeconds;
    if (finalDurationSeconds <= 0) return;
    onLogSession(selectedChunk.id, currentDay, { skipped: true, durationSeconds: finalDurationSeconds });
    setTimerRunning(false);
    setDurationSeconds(0);
  };

  const hasAssessmentTimerRisk = timerRunning || durationSeconds > 0;

  useEffect(() => {
    onAssessmentTimerRiskChange(hasAssessmentTimerRisk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAssessmentTimerRisk]);
  useEffect(() => {
    return () => onAssessmentTimerRiskChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by every way this panel can leave the current chunk while
  // assessment-timer work is unlogged: Previous, Next, Finish reassessment,
  // Related-chunks links, and Progress-modal square clicks.
  const guardLeavingChunkTimer = () => {
    if (!hasAssessmentTimerRisk) return true;
    return typeof onConfirmLeaveAssessmentTimer === "function" ? onConfirmLeaveAssessmentTimer() : true;
  };
  const changeSelected = (id) => {
    if (!guardLeavingChunkTimer()) return;
    setSelected(id);
    setProgressModalOpen(false);
  };

  const relatedChunks = selectedChunk ? findRelatedChunks(selectedChunk, chunks) : [];
  const relatedChunkLabel = (c) => (c.kind === "section" ? "Chunk" : ROLE_LABEL[c.kind] || c.kind);

  const detailStats = selectedChunk && (
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
      <div>
        <span className="lbl">Stage</span>
        <span className="val">
          {ladderStatus ? `${ladderStatus.stageLabel} — ${ladderStatus.progressLabel}` : "Not started"}
        </span>
      </div>
      {ladderStatus && ladderStatus.dueLabel && (
        <div><span className="lbl">Next review</span><span className="val">{ladderStatus.dueLabel}</span></div>
      )}
      {tempoWarning && (
        <div>
          <span className="lbl">Tempo goal</span>
          <span className="val warn">
            <AlertTriangle size={12} />{" "}
            {tempoSimulation.converged
              ? `${tempoSimulation.days}+ days away — over ${TEMPO_CONVERGENCE_WARNING_DAYS / 30} months at this pace`
              : "may never reach at this pace — check tempo ratchet settings"}
          </span>
        </div>
      )}
      {selectedChunk.recurringNote && <div><span className="lbl">Repeats</span><span className="val">{selectedChunk.recurringNote}</span></div>}
    </div>
  );

  if (!selectedChunk) return null;
  const DiffSignalIcon = DIFFICULTY_SIGNAL_ICON[selectedChunk.difficultyLabel];

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ marginBottom: 2 }}>Reassess</h3>
          <p className="hero-sub mono" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <DiffSignalIcon size={13} style={{ color: "var(--ink-faint)" }} title={DIFFICULTY_META[selectedChunk.difficultyLabel].label} />
            {relatedChunkLabel(selectedChunk)} — {formatRange(selectedChunk.start, selectedChunk.end)}
          </p>
        </div>
      </div>
      <p className="wizard-hint" style={{ marginTop: 12 }}>
        Play through the piece from beginning to end. Rate your confidence on each chunk to set a
        fresh baseline for practice.
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <p className="derived-stat" style={{ margin: 0 }}>
          <strong className="mono">{ratedCount}</strong> of <strong className="mono">{chunks.length}</strong> rated
        </p>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setProgressModalOpen(true)}
          aria-label="View reassessment progress"
          title="View progress"
        >
          <LayoutGrid size={16} />
        </button>
      </div>

      {relatedChunks.length > 0 && (
        <div className="field">
          <span>Related chunks</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
            {relatedChunks.map((rc) => (
              <button type="button" key={rc.id} className="link-btn" onClick={() => changeSelected(rc.id)}>
                {relatedChunkLabel(rc)} — {formatRange(rc.start, rc.end)}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedEntry.needsRelearning && (
        <div className="field">
          <span>Ladder status</span>
          <div className="manual-conf-row">
            <p className="wizard-hint relearning-hint" style={{ margin: 0, flex: 1 }}>
              <RotateCcw size={13} /> Needs reinforcement — review is paused while this chunk rebuilds
              consistency in the Introductory phase. Clears automatically after 4 consecutive full passes.
            </p>
            <button className="ghost-btn" onClick={() => onClearRelearning(selectedChunk.id)}>
              Clear, resume review
            </button>
          </div>
        </div>
      )}

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

      <ReassessPanel
        key={`reassess-${selectedChunk.id}`}
        piece={piece}
        todaysRanges={[{ start: selectedChunk.start, end: selectedChunk.end }]}
        onReassessRange={onReassessRange}
      />

      <div className="field">
        <span>Assessment timer</span>
        <div className="timer-row">
          <button
            type="button"
            className={`timer-btn ${timerRunning ? "running" : ""}`}
            onClick={() => setTimerRunning((r) => !r)}
          >
            {timerRunning ? "Stop" : "Start"} timer
          </button>
          <span className="timer-display mono">{formatDuration(durationSeconds)}</span>
        </div>
        <button type="button" className="ghost-btn" disabled={!hasAssessmentTimerRisk} onClick={logAssessedTime}>
          Log assessed time
        </button>
      </div>

      {selectedIsManual && (
        <div className="field">
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
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>Current BPM</span>
          <NumberInput
            value={selectedEntry.currentBPM || ""}
            min={20}
            max={400}
            onCommit={(n) => onUpdateBPM(selectedChunk.id, "currentBPM", n)}
          />
          <p className="tip-line">The fastest you can currently play it accurately, not necessarily the tempo you're aiming for.</p>
        </label>
        <div className="field">
          <span>Target BPM</span>
          {bpmOverrideOpen ? (
            <NumberInput
              value={resolvedTargetBPM || ""}
              min={20}
              max={400}
              onCommit={(n) => {
                onUpdateBPM(selectedChunk.id, "targetBPM", n);
                setBpmOverrideOpen(false);
              }}
            />
          ) : (
            <div className="manual-conf-row">
              <p className="wizard-hint" style={{ margin: 0, flex: 1 }}>
                {resolvedTargetBPM
                  ? selectedEntry.targetBPM
                    ? `${resolvedTargetBPM} BPM — set for this chunk`
                    : `${resolvedTargetBPM} BPM — set at piece setup`
                  : "No target BPM set yet"}
              </p>
              <button type="button" className="ghost-btn" onClick={() => setBpmOverrideOpen(true)}>
                {resolvedTargetBPM ? "Change for this chunk" : "Set for this chunk"}
              </button>
            </div>
          )}
        </div>
      </div>
      {resolvedTargetBPM > 0 && (
        <div className="bpm-track">
          <div
            className="bpm-fill"
            style={{ width: `${Math.round(clamp((selectedEntry.currentBPM || 0) / resolvedTargetBPM, 0, 1) * 100)}%` }}
          />
        </div>
      )}
      {selectedClimbing && (
        <>
          <div className="climbing-hint">
            <Metronome size={13} />
            <TrendingUp size={13} />
            <span>
              Tempo's been climbing — try {(selectedEntry.currentBPM || 0) + 15}–
              {(selectedEntry.currentBPM || 0) + 30} BPM faster, once or twice.
            </span>
          </div>
          <p className="climbing-hint-note">
            Only try it at this speed a couple times. Extensive practice at BPM higher than you can play
            accurately will hurt your progress.
          </p>
        </>
      )}

      <MemoryAnchorField
        key={selectedChunk.id}
        value={piece.memoryAnchors && piece.memoryAnchors[selectedChunk.id]}
        onCommit={(text) => onSetMemoryAnchor(selectedChunk.id, text)}
      />

      <details className="chunk-info">
        <summary>
          <ChevronRight size={14} className="chunk-info-chevron" />
          Chunk Info
        </summary>
        {detailStats}
      </details>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
        <button className="ghost-btn" disabled={selectedIdx <= 0} onClick={() => changeSelected(chunks[selectedIdx - 1].id)}>
          <ChevronLeft size={16} /> Previous
        </button>
        <p className="wizard-hint" style={{ margin: 0 }}>
          Item {selectedIdx + 1} of {chunks.length}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost-btn" onClick={() => { if (guardLeavingChunkTimer()) onFinishReassessment(); }}>
            Finish reassessment
          </button>
          {selectedIdx < chunks.length - 1 && (
            <button className="primary-btn" onClick={() => changeSelected(chunks[selectedIdx + 1].id)}>
              Next <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>

      {progressModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setProgressModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="detail-head">
              <h3>Progress</h3>
              <button className="icon-btn" onClick={() => setProgressModalOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(34px, 1fr))", gap: 6 }}>
                {chunks.map((c) => {
                  const rated = isManualConfidence(c, piece.progress);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      title={formatRange(c.start, c.end)}
                      onClick={() => changeSelected(c.id)}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 6,
                        border: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: DIFFICULTY_META[c.difficultyLabel].color,
                        opacity: rated ? 1 : 0.35,
                        cursor: "pointer",
                      }}
                    >
                      {rated && <Check size={16} color="#000000" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
