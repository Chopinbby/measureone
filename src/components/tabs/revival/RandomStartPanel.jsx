import { useState, useMemo } from "react";
import { Shuffle } from "lucide-react";
import { formatRange } from "../../../lib/utils";
import { sectionLabel } from "../../../lib/chunking";

export function RandomStartPanel({ piece, revivalItems, sections }) {
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
