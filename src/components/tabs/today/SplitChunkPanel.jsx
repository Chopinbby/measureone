import { formatRange } from "../../../lib/utils";

// Pass 97 — sits next to ReassessPanel on Daily Practice's regular view.
// Unlike ReassessPanel, this has no "nothing qualifies" state: it renders
// nothing at all unless at least one of today's practiced base chunks is
// actually splittable (per direct request — a shown-but-empty panel here
// was judged more confusing than just not showing it). No undo, so the
// confirm step (a plain window.confirm, App.jsx's onSplitChunk) is the only
// safety net.
export function SplitChunkPanel({ chunks, onSplitChunk }) {
  if (!chunks || chunks.length === 0) return null;

  return (
    <div className="panel split-chunk-panel">
      <h3>Split a chunk</h3>
      <p className="wizard-hint">Found a particularly dense passage? Split a chunk into two independent chunks.</p>
      <div className="reassess-quickpicks">
        {chunks.map((c) => (
          <button key={c.id} type="button" className="chip subtle" onClick={() => onSplitChunk(c.id)}>
            {formatRange(c.start, c.end)}
          </button>
        ))}
      </div>
    </div>
  );
}
