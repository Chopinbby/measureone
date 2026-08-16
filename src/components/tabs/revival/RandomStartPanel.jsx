import { useState, useMemo } from "react";
import { Shuffle } from "lucide-react";
import { formatRange } from "../../../lib/utils";
import { sectionLabel } from "../../../lib/chunking";

// One pool entry — the shape this panel picks from and renders.
// `context` is optional and only carries a value where the pool spans more
// than one piece (Master Agenda's maintenance due list); inside a single
// piece it would just repeat the piece you're already looking at.
export function chunkEntry(chunk, anchor, context) {
  return {
    kind: chunk.kind === "transition" ? "Review" : chunk.kind === "combo" ? "Focus" : "Chunk",
    label: formatRange(chunk.start, chunk.end),
    anchor,
    context,
  };
}

const DEFAULT_HINT =
  "Jump in somewhere you wouldn't have picked yourself — a good way to catch memory gaps you don't know are there.";

// Started life revival-only; generalized in Pass 21 so the same "don't let
// yourself choose the starting point" idea also covers a maintenance
// due-review session, which has exactly the same problem (you always start
// from the top, so the same spots always get the freshest attention).
//
// Two ways to supply the pool, deliberately:
//   * `entries` — a ready-made pool, for a caller whose items span several
//     pieces (Master Agenda's maintenance due list). Build them with
//     chunkEntry above so the labelling can't drift from the revival side.
//   * `piece` + `revivalItems` + `sections` — the original single-piece
//     form, unchanged, still what RevivalTab passes. Sections join the pool
//     here because starting from a section boundary is itself a memory
//     test; a due-review pool deliberately doesn't include them, since a
//     section that isn't due isn't part of that session.
export function RandomStartPanel({
  piece,
  revivalItems,
  sections,
  entries,
  title = "Random start",
  hint = DEFAULT_HINT,
}) {
  const [pick, setPick] = useState(null);

  const pool = useMemo(() => {
    if (entries) return entries;
    const anchors = (piece && piece.memoryAnchors) || {};
    const fromChunks = (revivalItems || []).map((c) => chunkEntry(c, anchors[c.id]));
    const fromSections = (sections || []).map((s, i) => ({
      kind: "Section",
      label: sectionLabel(s, i),
      anchor: anchors[s.id],
    }));
    return [...fromChunks, ...fromSections];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, revivalItems, sections, piece && piece.memoryAnchors]);

  const pickRandom = () => {
    if (!pool.length) return;
    setPick(pool[Math.floor(Math.random() * pool.length)]);
  };

  return (
    <div className="panel">
      <h3>{title}</h3>
      <p className="wizard-hint">{hint}</p>
      <button className="ghost-btn" onClick={pickRandom}>
        <Shuffle size={14} /> {pick ? "Pick another" : "Pick a starting point"}
      </button>
      {pick && (
        <div className="focus-row" style={{ marginTop: 14, paddingBottom: 0, borderBottom: "none" }}>
          <span className="tag subtle">{pick.kind}</span>
          {pick.context && (
            <span style={{ fontSize: "13px", color: "var(--ink-soft)" }}>{pick.context}</span>
          )}
          <span className="mono">{pick.label}</span>
          {pick.anchor && <span className="tip-line" style={{ marginLeft: "auto" }}>{pick.anchor}</span>}
        </div>
      )}
    </div>
  );
}
