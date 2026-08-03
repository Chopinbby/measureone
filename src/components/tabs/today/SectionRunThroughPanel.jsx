import { useMemo } from "react";
import { computeSectionRunThroughs } from "../../../lib/chunking";
import { ChecklistItem } from "./ChecklistItem";

export function SectionRunThroughPanel({ piece, practiceChunks, currentDay, onLogSession, onUnlogSession }) {
  const items = useMemo(
    () => computeSectionRunThroughs(piece, practiceChunks),
    [piece, practiceChunks]
  );

  if (items.length === 0) return null;

  return (
    <div className="panel focus-panel">
      <h3>Section run-throughs</h3>
      <p className="wizard-hint">
        Unlocked once every chunk in a section has been practiced at least once — a chance to play
        through continuously instead of chunk by chunk. Combined section run-throughs unlock once
        the whole piece has been practiced in chunks.
      </p>
      <div className="checklist">
        {items.map((item) => (
          <ChecklistItem
            key={item.id}
            chunk={item}
            role={item.kind}
            piece={piece}
            day={currentDay}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ))}
      </div>
    </div>
  );
}
