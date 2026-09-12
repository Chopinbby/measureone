import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { formatMinutes, formatRange } from "../../lib/utils";
import { isManualConfidence } from "../../lib/confidence";
import { getRevivalTargetBPM, computeTempoLadder, computeComboEscalations } from "../../lib/revival";
import { ChecklistItem } from "./today/ChecklistItem";
import { RandomStartPanel } from "./revival/RandomStartPanel";
import { ReassessSequencePanel } from "./revival/ReassessSequencePanel";

/* ------------------------------------------------------------------ */
/*  Revival: recover a piece that was learned once but has gone stale */
/* ------------------------------------------------------------------ */

export function RevivalTab({
  piece,
  chunkSet,
  currentDay,
  onUpdateBPM,
  onSetManualConfidence,
  onSetMemoryAnchor,
  onFinishReassessment,
  onReopenReassessment,
  onGeneratePlan,
  onReassessRange,
  onLogSession,
  onUnlogSession,
  onConfirmProvisionalSession,
  onDiscardProvisionalSession,
  onEndRevival,
  onAssessmentTimerRiskChange,
  onConfirmLeaveAssessmentTimer,
}) {
  const revival = piece.revival || {};
  const revivalItems = useMemo(() => [...chunkSet.practiceChunks, ...chunkSet.transitions], [chunkSet]);
  // Combos aren't part of revivalItems (they're not reassessed/rated or
  // given their own base-plan task — see computeRevivalPlan), but an
  // escalated combo still needs to be look-up-able by id to render as a
  // ChecklistItem below.
  const chunkById = useMemo(
    () => Object.fromEntries([...revivalItems, ...(chunkSet.combos || [])].map((c) => [c.id, c])),
    [revivalItems, chunkSet.combos]
  );
  const ratedCount = revivalItems.filter((c) => isManualConfidence(c, piece.progress)).length;
  const flagged = revivalItems.filter((c) => (piece.progress[c.id] || {}).flag);
  // Combos whose underlying content (anchor chunk, or an overlapping
  // neighbor) has produced a real fail since this revival run started —
  // see computeComboEscalations for why this is computed live rather than
  // written into revival.plan.
  const comboEscalations = useMemo(() => computeComboEscalations(piece, chunkSet), [piece, chunkSet]);

  return (
    <div className="tab-pane">
      <div className="tab-header day-nav">
        <div>
          <h1>Revival</h1>
          <p className="hero-sub">Returning "{piece.name}" to its former glory</p>
        </div>
        <button className="ghost-btn" onClick={onEndRevival}>End revival</button>
      </div>

      {!revival.reassessmentComplete ? (
        revivalItems.length > 0 && (
          <ReassessSequencePanel
            piece={piece}
            chunks={revivalItems}
            currentDay={currentDay}
            ratedCount={ratedCount}
            onUpdateBPM={onUpdateBPM}
            onSetManualConfidence={onSetManualConfidence}
            onSetMemoryAnchor={onSetMemoryAnchor}
            onReassessRange={onReassessRange}
            onLogSession={onLogSession}
            onAssessmentTimerRiskChange={onAssessmentTimerRiskChange}
            onConfirmLeaveAssessmentTimer={onConfirmLeaveAssessmentTimer}
            onFinishReassessment={onFinishReassessment}
          />
        )
      ) : (
        <>
          <div className="panel">
            <h3>Reassessment complete</h3>
            <p className="wizard-hint" style={{ marginBottom: 12 }}>
              {ratedCount} of {revivalItems.length} rated
              {flagged.length > 0 ? `, ${flagged.length} flagged rough or lost` : ""}.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="ghost-btn" onClick={onReopenReassessment}>Redo reassessment</button>
              <button className="primary-btn" onClick={onGeneratePlan}>
                <Sparkles size={16} /> {revival.plan ? "Regenerate revival plan" : "Generate revival plan"}
              </button>
            </div>
          </div>

          {flagged.length > 0 && (
            <div className="panel focus-panel">
              <h3>Flagged chunks</h3>
              <div className="focus-list">
                {flagged.map((c) => (
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

          {revival.plan && comboEscalations.length > 0 && (
            <div className="panel focus-panel">
              <h3>Needs another look</h3>
              <p className="wizard-hint">
                One of the blocks below had a rough pass. Worth practicing on its own rather than
                assuming it'll sort itself out.
              </p>
              <div className="checklist">
                {comboEscalations.map((combo) => {
                  const targetBPM = getRevivalTargetBPM(piece, combo);
                  const ladder = computeTempoLadder(targetBPM, revival.tempoLadderStartFraction ?? 0.6, 5);
                  return (
                    <ChecklistItem
                      key={combo.id}
                      chunk={combo}
                      role="combo"
                      piece={piece}
                      day={currentDay}
                      onLogSession={onLogSession}
                      onUnlogSession={onUnlogSession}
                      onConfirmProvisionalSession={onConfirmProvisionalSession}
                      onDiscardProvisionalSession={onDiscardProvisionalSession}
                      tempoLadder={ladder}
                      memoryAnchor={piece.memoryAnchors && piece.memoryAnchors[combo.id]}
                      onReassessRange={onReassessRange}
                    />
                  );
                })}
              </div>
            </div>
          )}

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
                    <h3>Suggested day {d.dayNumber} — {formatMinutes(d.minutes)}</h3>
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
                            onConfirmProvisionalSession={onConfirmProvisionalSession}
                            onDiscardProvisionalSession={onDiscardProvisionalSession}
                            tempoLadder={ladder}
                            memoryAnchor={piece.memoryAnchors && piece.memoryAnchors[id]}
                            onReassessRange={onReassessRange}
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
