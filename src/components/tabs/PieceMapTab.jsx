import { useState } from "react";
import { X, Pencil, Flag, RotateCcw, TrendingUp, Metronome, AlertTriangle, SignalLow, SignalMedium, SignalHigh } from "lucide-react";
import { NumberInput } from "../NumberInput";
import { MemoryAnchorField } from "../MemoryAnchorField";
import { clamp, formatRange, todayISODate, findRelatedChunks } from "../../lib/utils";
import { DIFFICULTY_META, ROLE_LABEL } from "../../lib/constants";
import {
  computeConfidence,
  computeAutoConfidence,
  isManualConfidence,
  getDefaultTargetBPM,
  formatLadderStatus,
  hasClimbingTempo,
} from "../../lib/confidence";
import { simulateTempoConvergence, tempoConvergenceExceedsWarning, TEMPO_CONVERGENCE_WARNING_DAYS } from "../../lib/ladder";

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

const DIFFICULTY_SIGNAL_ICON = {
  easy: SignalLow,
  medium: SignalMedium,
  hard: SignalHigh,
};

// Pass 87 — this component is ordinary (non-revival) Piece Map only now.
// Revival's reassessment pass used to embed this component in a
// `sequentialMode` (grid hidden behind a mode flag, one-chunk detail
// wrapped in a modal-over-grid layering, Previous/Next/Finish footer,
// its own assessment timer); that's been retired in favor of a dedicated
// component, ReassessSequencePanel (components/tabs/revival/), that
// doesn't share this one at all. See docs/Decisions.md#revival.
export function PieceMapTab({
  piece,
  chunks,
  currentDay,
  onUpdateBPM,
  onSetManualConfidence,
  onSetFlag = () => {},
  onSetMemoryAnchor = () => {},
  onClearRelearning = () => {},
}) {
  const [selected, setSelected] = useState(null);
  const selectedChunk = chunks.find((c) => c.id === selected);
  const selectedEntry = selectedChunk ? piece.progress[selectedChunk.id] || {} : {};
  const selectedIsManual = selectedChunk ? isManualConfidence(selectedChunk, piece.progress) : false;
  const selectedFlag = selectedEntry.flag || "untouched";
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

  // Pass 50 — the grid shows only base practice chunks (no gaps, m.1
  // through the piece's last measure), so transitions/combos need their
  // own way to be reached: the "Related chunks" field below.
  const gridChunks = chunks.filter((c) => c.kind === "section");
  // Computed for whatever chunk is currently selected, not just a base
  // one — so following a related-chunk link to a transition's or combo's
  // own detail view shows its related chunks in turn (including the base
  // chunk(s) it touches), rather than a one-way dead end.
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

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Piece Map</h1>
        <p className="hero-sub">Color shows confidence.</p>
      </div>

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
          const DiffSignalIcon = DIFFICULTY_SIGNAL_ICON[c.difficultyLabel];
          return (
            <button
              key={c.id}
              className={`map-cell tier-${tier} ${selected === c.id ? "selected" : ""}`}
              onClick={() => setSelected(selected === c.id ? null : c.id)}
            >
              {c.kind !== "section" && <span className="map-cell-kind">{c.kind === "combo" ? "Focus" : "Review"}</span>}
              <DiffSignalIcon size={12} className="map-cell-diff-icon" title={DIFFICULTY_META[c.difficultyLabel].label} />
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
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-head">
              <h3>{formatRange(selectedChunk.start, selectedChunk.end)}</h3>
              <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {detailStats}

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

              {relatedChunks.length > 0 && (
                <div className="field">
                  <span>Related chunks</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                    {relatedChunks.map((rc) => (
                      <button type="button" key={rc.id} className="link-btn" onClick={() => setSelected(rc.id)}>
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
                    value={resolvedTargetBPM || ""}
                    min={20}
                    max={400}
                    onCommit={(n) => onUpdateBPM(selectedChunk.id, "targetBPM", n)}
                  />
                </label>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
