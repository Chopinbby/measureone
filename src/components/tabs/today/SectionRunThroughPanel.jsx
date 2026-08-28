import { useMemo } from "react";
import { computeSectionRunThroughs } from "../../../lib/chunking";
import { formatRange } from "../../../lib/utils";
import { ROLE_LABEL, DIFFICULTY_META } from "../../../lib/constants";
import { ChecklistItem } from "./ChecklistItem";

// A single-section run-through's "one more chunk away" preview (Pass 49) —
// not yet loggable, so it renders without the reps/BPM form ChecklistItem
// would show. Grayed the same way ChecklistItem grays its own checkbox and
// "Log practice" button before required input is filled in (same
// `disabled` state, same CSS classes — no new styling), so a locked task
// reads as a preview of the same kind of row, not a different component.
function LockedRunThroughRow({ item }) {
  return (
    <div className="checklist-item">
      <button
        type="button"
        className="checklist-check-empty"
        disabled
        aria-label="Locked"
        title="Locked — one more chunk needs its next logged session to unlock this run-through"
      />
      <div className="checklist-body">
        <div className="checklist-row">
          {item.label && <span className="checklist-label">{item.label}</span>}
          <span className="mono">{formatRange(item.start, item.end)}</span>
          <span className={`tag tag-${item.kind}`}>{ROLE_LABEL[item.kind]}</span>
          <span className="tag subtle">{DIFFICULTY_META[item.difficultyLabel].label}</span>
        </div>
        <p className="tip-line">
          Almost there — one more chunk needs its next logged session to unlock this run-through.
        </p>
        <button type="button" className="primary-btn sm" disabled style={{ marginTop: 8, alignSelf: "flex-start" }}>
          Log practice
        </button>
      </div>
    </div>
  );
}

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
        A single-section run-through is today's task once every chunk in that section has a logged
        session — then it comes due again every two sessions per chunk after that (a repeating
        check-in, not a one-time unlock), showing locked here the day before it's due. Combined
        section run-throughs unlock once the whole piece has been practiced in chunks, and — unlike
        single sections — stay available from then on.
      </p>
      <div className="checklist">
        {items.map((item) =>
          item.locked ? (
            <LockedRunThroughRow key={item.id} item={item} />
          ) : (
            <ChecklistItem
              key={item.id}
              chunk={item}
              role={item.kind}
              piece={piece}
              day={currentDay}
              onLogSession={onLogSession}
              onUnlogSession={onUnlogSession}
            />
          )
        )}
      </div>
    </div>
  );
}
