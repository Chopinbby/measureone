import { useState, useEffect, useRef } from "react";
import { X, Pencil, Flag, ChevronLeft, ChevronRight, RotateCcw, TrendingUp, Metronome, AlertTriangle } from "lucide-react";
import { NumberInput } from "../NumberInput";
import { MemoryAnchorField } from "../MemoryAnchorField";
import { clamp, formatRange, formatDuration, todayISODate, findRelatedChunks } from "../../lib/utils";
import { DIFFICULTY_META, CONFIDENCE_PRESETS, ROLE_LABEL } from "../../lib/constants";
import {
  computeConfidence,
  computeAutoConfidence,
  isManualConfidence,
  getDefaultTargetBPM,
  formatLadderStatus,
  hasClimbingTempo,
} from "../../lib/confidence";
import { simulateTempoConvergence, tempoConvergenceExceedsWarning, TEMPO_CONVERGENCE_WARNING_DAYS } from "../../lib/ladder";
import { ReassessPanel } from "./today/ReassessPanel";

// Run-through flag cycle (Repertoire-Lifecycle.md's "Post-run-through
// logging"): undefined ("untouched") -> 'rough' -> 'lost' -> undefined.
function nextFlag(current) {
  if (current === "rough") return "lost";
  if (current === "lost") return undefined;
  return "rough";
}

const FLAG_LABEL = {
  untouched: "Mark rough or lost",
  rough: "Rough — tap for lost",
  lost: "Lost — tap to clear",
};

export function PieceMapTab({
  piece,
  chunks,
  currentDay,
  onUpdateBPM,
  onSetManualConfidence,
  onSetFlag = () => {},
  onSetMemoryAnchor = () => {},
  onClearRelearning = () => {},
  onReassessRange = () => {},
  onLogSession = () => {},
  onAssessmentTimerRiskChange = () => {},
  onConfirmLeaveAssessmentTimer,
  sequentialMode = false,
  initialSelectedId = null,
  onFinishSequential,
  hideHeader = false,
}) {
  const [selected, setSelected] = useState(initialSelectedId);
  const selectedChunk = chunks.find((c) => c.id === selected);
  const selectedEntry = selectedChunk ? piece.progress[selectedChunk.id] || {} : {};
  const selectedIsManual = selectedChunk ? isManualConfidence(selectedChunk, piece.progress) : false;
  const selectedFlag = selectedEntry.flag || "untouched";
  const selectedIdx = selectedChunk ? chunks.findIndex((c) => c.id === selected) : -1;
  // Pass 15 — surfaces stage/consecutivePasses/nextDueDate, computed and
  // persisted on every logged session (lib/ladder.js) but never shown
  // anywhere before now. null for a chunk with no session history yet.
  const ladderStatus = selectedChunk ? formatLadderStatus(selectedEntry, piece.ladderConfig, todayISODate()) : null;
  // Pass 30 — live-derived, same as the tile marker above; recomputed on
  // every render from session history, no persisted "seen" state.
  const selectedClimbing = selectedChunk ? hasClimbingTempo(selectedEntry) : false;
  // Same fallback chain used in three places below (the field itself, and
  // the bpm-track gate/width) — computed once so they can't drift.
  const resolvedTargetBPM = selectedChunk ? selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk) || null : null;
  // Pass 62 — forward-projects the chunk's own current ladder state
  // (same fields App.jsx's handleLogSession builds for computeLadderAdvance)
  // to estimate how many calendar days away its tempo goal is, live off
  // whatever's currently persisted — recomputed on every render, no
  // persisted "warned" flag, same pattern selectedClimbing above uses.
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
  // Pass 37 (sequentialMode/revival reassessment only — see
  // docs/Decisions.md#ux): Target BPM defaults to a read-only display of
  // resolvedTargetBPM rather than an always-open input, since most chunks
  // just use the piece's setup-time tempo. Resets on every chunk switch so
  // Next/Previous doesn't carry an open editor onto the next chunk.
  const [bpmOverrideOpen, setBpmOverrideOpen] = useState(false);
  useEffect(() => setBpmOverrideOpen(false), [selected]);

  // Pass 76 (sequentialMode only) — a per-chunk assessment timer, tracking
  // time spent reassessing a chunk (not a graded practice rep). Same
  // wall-clock reconciliation pattern as ChecklistItem's Pass 72 fix
  // (timerStartRef captures the real start moment; each tick recomputes
  // elapsed from Date.now() rather than blindly incrementing), so a
  // backgrounded tab doesn't leave this display frozen or behind.
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

  // Assessment time belongs to the chunk it was spent on — Previous/Next
  // within sequentialMode must not carry a running or accumulated timer
  // over onto the next chunk.
  useEffect(() => {
    setTimerRunning(false);
    setDurationSeconds(0);
  }, [selected]);

  const logAssessedTime = () => {
    // Same wall-clock re-derivation submitLog (ChecklistItem) uses — reads
    // the real elapsed time at the moment of the click rather than
    // trusting the last interval tick's state.
    const finalDurationSeconds =
      timerRunning && timerStartRef.current
        ? Math.max(0, timerStartRef.current.baseSeconds + Math.floor((Date.now() - timerStartRef.current.startedAt) / 1000))
        : durationSeconds;
    if (finalDurationSeconds <= 0) return;
    onLogSession(selectedChunk.id, currentDay, { skipped: true, durationSeconds: finalDurationSeconds });
    setTimerRunning(false);
    setDurationSeconds(0);
  };

  // Single source of truth for "is there assessment-timer work that would
  // be silently lost right now" — read by the local guard below AND
  // reported up to App.jsx (next effect) for cross-tab/piece-switch/End-
  // revival gating, so the two can never disagree about when to ask. A
  // no-op outside sequentialMode, since durationSeconds/timerRunning never
  // move off their defaults there.
  const hasAssessmentTimerRisk = timerRunning || durationSeconds > 0;

  // Mirrors TodayTab's onInterleaveRiskChange reporting for Interleaved
  // mode's own provisional-session risk (App.jsx's interleaveRisk state) —
  // this component owns the only state that knows whether there's unlogged
  // assessment time right now, so it has to be the one to tell App.jsx,
  // which needs it to gate navigation this component has no say over
  // (sidebar tabs, the piece switcher, Edit piece, End revival). Safe to
  // key directly on the boolean (unlike interleaveRisk's array-of-ids,
  // which needed a joined-string key to avoid a new-reference-every-render
  // loop) since a boolean is already a stable primitive.
  useEffect(() => {
    onAssessmentTimerRiskChange(hasAssessmentTimerRisk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAssessmentTimerRisk]);
  // Defensive reset on unmount only — leaving this screen is already gated
  // before this can unmount mid-risk, so this should be a no-op in
  // practice, but a stale risk outliving the component it describes would
  // be a strictly worse failure mode than a redundant reset. Mirrors
  // TodayTab's identical unmount-reset effect for interleaveRisk.
  useEffect(() => {
    return () => onAssessmentTimerRiskChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by every way THIS component can leave the current chunk while
  // assessment-timer work is unlogged (Previous, Next, Finish reassessment,
  // closing the detail panel). Delegates the actual confirm to
  // onConfirmLeaveAssessmentTimer — the one function App.jsx owns — instead
  // of keeping a second local copy of the warning text, so the wording
  // (and any future change to it) can't drift between this path and the
  // sidebar/piece-switcher/End-revival path, which reads the risk this
  // component just reported above instead of recomputing it separately.
  // Mirrors TodayTab's leaveInterleaved/onConfirmLeaveInterleaved split
  // exactly. Falls back to proceeding unprompted if the prop is ever
  // missing (only reachable if hasAssessmentTimerRisk is true with no
  // caller wired to handle it, which shouldn't happen — see the defaults
  // above) rather than crashing on an assumed-present function.
  const guardLeavingChunkTimer = () => {
    if (!hasAssessmentTimerRisk) return true;
    return typeof onConfirmLeaveAssessmentTimer === "function" ? onConfirmLeaveAssessmentTimer() : true;
  };
  const changeSelected = (id) => {
    if (!guardLeavingChunkTimer()) return;
    setSelected(id);
  };

  // Pass 50 — the grid itself shows only base practice chunks (no gaps,
  // m.1 through the piece's last measure), so transitions/combos need
  // their own way to be reached: the "Related chunks" field below.
  // sequentialMode (Revival's reassessment flow) is left unfiltered — it
  // walks `chunks` one at a time via Previous/Next using a deliberately
  // different, revival-curated list (practice chunks + transitions, no
  // combos — see RevivalTab's `revivalItems`), and filtering it here would
  // silently drop transitions from that sequence entirely, which this pass
  // never asked to change.
  const gridChunks = sequentialMode ? chunks : chunks.filter((c) => c.kind === "section");
  // Computed for whatever chunk is currently selected, not just a base
  // one — so following a related-chunk link to a transition's or combo's
  // own detail view shows its related chunks in turn (including the base
  // chunk(s) it touches), rather than a one-way dead end.
  const relatedChunks = selectedChunk ? findRelatedChunks(selectedChunk, chunks) : [];
  const relatedChunkLabel = (c) => (c.kind === "section" ? "Chunk" : ROLE_LABEL[c.kind] || c.kind);

  // Same content, rendered in a different spot depending on mode: inline
  // near the top for ordinary Piece Map, collapsed under "Chunk Info" at
  // the bottom for sequentialMode (Pass 37) — see docs/Decisions.md#ux.
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

  return (
    <div className="tab-pane">
      {!hideHeader && (
        <div className="tab-header">
          <h1>Piece Map</h1>
          <p className="hero-sub">Color shows confidence.</p>
        </div>
      )}

      <div className="confidence-legend">
        <span><i className="dot" style={{ background: "var(--brick)" }} /> Needs work</span>
        <span><i className="dot" style={{ background: "var(--brass)" }} /> Developing</span>
        <span><i className="dot" style={{ background: "var(--teal)" }} /> Confident</span>
      </div>

      <div className="map-grid">
        {gridChunks.map((c) => {
          const conf = computeConfidence(c, piece, currentDay);
          const manual = isManualConfidence(c, piece.progress);
          const flag = (piece.progress[c.id] || {}).flag;
          const needsRelearning = (piece.progress[c.id] || {}).needsRelearning;
          const climbingTempo = hasClimbingTempo(piece.progress[c.id]);
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
                {climbingTempo && (
                  <>
                    <Metronome size={9} className="climbing-mark" title="Tempo climbing — try going faster" />
                    <TrendingUp size={9} className="climbing-mark" title="Tempo climbing — try going faster" />
                  </>
                )}
              </span>
              {c.recurring && <span className="map-cell-recurring" title="Recurring material">&#8635;</span>}
              {flag && (
                <span className={`map-cell-flag flag-${flag}`} title={flag === "lost" ? "Lost" : "Rough"}>
                  <Flag size={11} />
                </span>
              )}
              {needsRelearning && (
                <span className="map-cell-relearning" title="Needs reinforcement">
                  <RotateCcw size={11} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedChunk && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => changeSelected(null)}>
          <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-head">
              <h3>{formatRange(selectedChunk.start, selectedChunk.end)}</h3>
              <button className="icon-btn" onClick={() => changeSelected(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {!sequentialMode && detailStats}

              {!sequentialMode && (
                <div className="field">
                  <span>Run-through flag</span>
                  <button
                    type="button"
                    className={`flag-toggle ${selectedFlag !== "untouched" ? `flag-${selectedFlag}` : ""}`}
                    onClick={() => onSetFlag(selectedChunk.id, nextFlag(selectedEntry.flag))}
                  >
                    <Flag size={14} /> {FLAG_LABEL[selectedFlag]}
                  </button>
                </div>
              )}

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

              {sequentialMode && (
                // key forces a fresh instance (open/from/to/level all reset)
                // whenever the selected chunk changes — without it, Previous/
                // Next carries this component's own internal state across
                // chunks: an opened-but-not-yet-Applied panel would keep
                // showing the PREVIOUS chunk's From/To values while the
                // quick-pick chip above it already displays the new chunk's
                // range, so clicking Apply silently reassessed the wrong
                // measures. Confirmed live before this fix — same
                // key={selectedChunk.id} idea MemoryAnchorField already uses
                // below for the identical reason, but prefixed here: both
                // are direct children of the same .modal-body, and a bare
                // key={selectedChunk.id} collides with MemoryAnchorField's
                // own key on every render (React warns "two children with
                // the same key" and the reset silently doesn't take effect)
                // since React only requires key-uniqueness among siblings,
                // not globally.
                <ReassessPanel
                  key={`reassess-${selectedChunk.id}`}
                  piece={piece}
                  todaysRanges={[{ start: selectedChunk.start, end: selectedChunk.end }]}
                  onReassessRange={onReassessRange}
                />
              )}

              {sequentialMode && (
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
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={!hasAssessmentTimerRisk}
                    onClick={logAssessedTime}
                  >
                    Log assessed time
                  </button>
                </div>
              )}

              {sequentialMode ? (
                selectedIsManual && (
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
                )
              ) : (
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
              )}

              <div className="field-row">
                <label className="field">
                  <span>Current BPM</span>
                  <NumberInput value={selectedEntry.currentBPM || ""} min={20} max={400} onCommit={(n) => onUpdateBPM(selectedChunk.id, "currentBPM", n)} />
                  {sequentialMode && (
                    <p className="tip-line">The fastest you can currently play it accurately, not necessarily the tempo you're aiming for.</p>
                  )}
                </label>
                {sequentialMode ? (
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
                ) : (
                  <label className="field">
                    <span>Target BPM</span>
                    <NumberInput
                      value={resolvedTargetBPM || ""}
                      min={20}
                      max={400}
                      onCommit={(n) => onUpdateBPM(selectedChunk.id, "targetBPM", n)}
                    />
                  </label>
                )}
              </div>
              {resolvedTargetBPM > 0 && (
                <div className="bpm-track">
                  <div
                    className="bpm-fill"
                    style={{
                      width: `${Math.round(clamp((selectedEntry.currentBPM || 0) / resolvedTargetBPM, 0, 1) * 100)}%`,
                    }}
                  />
                </div>
              )}
              {selectedClimbing && (
                <>
                  {/* Pass 30 — a suggestion overlay only: doesn't touch
                      practiceBPM or any ladder field, just a nudge next to
                      the fields a learner would act on it with. */}
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

              {sequentialMode && (
                <details className="chunk-info">
                  <summary>
                    <ChevronRight size={14} className="chunk-info-chevron" />
                    Chunk Info
                  </summary>
                  {detailStats}
                </details>
              )}
            </div>

            {sequentialMode && (
              <div className="modal-foot">
                <button
                  className="ghost-btn"
                  disabled={selectedIdx <= 0}
                  onClick={() => changeSelected(chunks[selectedIdx - 1].id)}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <p className="wizard-hint" style={{ margin: 0 }}>
                  Item {selectedIdx + 1} of {chunks.length}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="ghost-btn" onClick={() => { if (guardLeavingChunkTimer()) onFinishSequential(); }}>
                    Finish reassessment
                  </button>
                  {selectedIdx < chunks.length - 1 && (
                    <button className="primary-btn" onClick={() => changeSelected(chunks[selectedIdx + 1].id)}>
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
