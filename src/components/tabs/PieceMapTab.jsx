import { useState } from "react";
import { X, Pencil, Flag, ChevronLeft, ChevronRight, RotateCcw, TrendingUp, Metronome } from "lucide-react";
import { NumberInput } from "../NumberInput";
import { MemoryAnchorField } from "../MemoryAnchorField";
import { clamp, formatRange, todayISODate } from "../../lib/utils";
import { DIFFICULTY_META, CONFIDENCE_PRESETS } from "../../lib/constants";
import {
  computeConfidence,
  computeAutoConfidence,
  isManualConfidence,
  getDefaultTargetBPM,
  formatLadderStatus,
  hasClimbingTempo,
} from "../../lib/confidence";

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
                <div>
                  <span className="lbl">Stage</span>
                  <span className="val">
                    {ladderStatus ? `${ladderStatus.stageLabel} — ${ladderStatus.progressLabel}` : "Not started"}
                  </span>
                </div>
                {ladderStatus && ladderStatus.dueLabel && (
                  <div><span className="lbl">Next review</span><span className="val">{ladderStatus.dueLabel}</span></div>
                )}
                {selectedChunk.recurringNote && <div><span className="lbl">Repeats</span><span className="val">{selectedChunk.recurringNote}</span></div>}
              </div>

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
