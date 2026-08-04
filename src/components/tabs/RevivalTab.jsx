import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { NumberInput } from "../NumberInput";
import { clamp, formatMinutes } from "../../lib/utils";
import { REVIVAL_PURPOSE_OPTIONS } from "../../lib/constants";
import { isManualConfidence } from "../../lib/confidence";
import { getRevivalTargetBPM, computeTempoLadder } from "../../lib/revival";
import { PieceMapTab } from "./PieceMapTab";
import { ChecklistItem } from "./today/ChecklistItem";
import { RandomStartPanel } from "./revival/RandomStartPanel";

/* ------------------------------------------------------------------ */
/*  Revival: recover a piece that was learned once but has gone stale */
/* ------------------------------------------------------------------ */

export function RevivalTab({
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
