import { useMemo } from "react";
import { Plus } from "lucide-react";
import { generateAllChunks } from "../lib/chunking";
import { computeProgressTier } from "../lib/confidence";
import { PIECE_STATUS_LABEL } from "../lib/constants";

// Strip of sibling movements shown on the Overview of any piece belonging to a
// multi-movement work. Each part is a self-contained piece, so the percentage
// here is that part's own measures-touched figure — deliberately not rolled up
// into a single "work progress" number, which would flatten movements of very
// different lengths into one misleading bar.
export function PartSwitcher({ parts, activeId, workName, onSelectPart, onAddPart }) {
  const touchedPct = useMemo(() => {
    const out = {};
    parts.forEach((p) => {
      const { practiceChunks } = generateAllChunks(p);
      const untouched = practiceChunks.reduce(
        (s, c) => s + (computeProgressTier(c, p) === "untouched" ? c.measureCount : 0),
        0
      );
      out[p.id] = p.totalMeasures ? Math.round(((p.totalMeasures - untouched) / p.totalMeasures) * 100) : 0;
    });
    return out;
  }, [parts]);

  return (
    <div className="panel part-switcher">
      <h3>{workName}</h3>
      <p className="tip-line">
        {parts.length} movement{parts.length === 1 ? "" : "s"} set up — each has its own plan and progress.
      </p>
      <div className="part-list">
        {parts.map((p, i) => (
          <button
            key={p.id}
            className={`part-chip ${p.id === activeId ? "active" : ""}`}
            onClick={() => p.id !== activeId && onSelectPart(p.id)}
          >
            <span className="part-chip-idx mono">{i + 1}</span>
            <span className="part-chip-name">{p.name || "Untitled movement"}</span>
            {p.status && p.status !== "active" && (
              <span className={`badge ${p.status}`}>{PIECE_STATUS_LABEL[p.status]}</span>
            )}
            <span className="part-chip-pct mono">{touchedPct[p.id]}%</span>
          </button>
        ))}
        <button className="part-chip add" onClick={onAddPart}>
          <Plus size={14} /> Add a movement
        </button>
      </div>
    </div>
  );
}
