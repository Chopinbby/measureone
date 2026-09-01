import { formatRange } from "../../../lib/utils";
import { DIFFICULTY_META } from "../../../lib/constants";
import { computeConfidence } from "../../../lib/confidence";

export function FocusPanel({ piece, chunks, currentDay }) {
  const ranked = chunks
    .map((c) => ({ chunk: c, conf: computeConfidence(c, piece, currentDay) }))
    .filter((x) => ((piece.progress[x.chunk.id] || {}).doneDays || []).length > 0)
    .sort((a, b) => a.conf - b.conf)
    .slice(0, 5);

  if (ranked.length === 0) return null;

  return (
    <div className="panel focus-panel">
      <h3>Needs the most work right now</h3>
      <p className="wizard-hint">Ranked by confidence across everything you've touched so far.</p>
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
