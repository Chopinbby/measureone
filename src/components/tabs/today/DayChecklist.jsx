import { Check } from "lucide-react";
import { ChecklistItem } from "./ChecklistItem";

export function DayChecklist({ piece, chunks, day, onLogSession, onUnlogSession, onToggleDone }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));

  if (day.type === "consolidation") {
    const done = ((piece.progress["__consolidation__"] || {}).doneDays || []).includes(day.dayNumber);
    return (
      <div className="panel">
        <h3>Day {day.dayNumber} — Full run-through</h3>
        <p className="wizard-hint">No new material today. Play through the whole piece and note where it still catches.</p>
        <button className={done ? "ghost-btn" : "primary-btn"} onClick={() => onToggleDone("__consolidation__", day.dayNumber)}>
          {done ? <><Check size={14} /> Marked complete</> : "Mark run-through complete"}
        </button>
      </div>
    );
  }

  const items = [
    ...day.newChunkIds.map((id) => ({ id, role: "new" })),
    ...day.specialChunkIds.map((id) => ({ id, role: chunkById[id].kind })),
    ...day.reviewChunkIds.map((id) => ({ id, role: "review" })),
  ];

  if (items.length === 0) {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>Nothing scheduled.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Day {day.dayNumber} — {day.minutes} min planned</h3>
      <div className="checklist">
        {items.map(({ id, role }) => (
          <ChecklistItem
            key={id + role}
            chunk={chunkById[id]}
            role={role}
            piece={piece}
            day={day.dayNumber}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ))}
      </div>
    </div>
  );
}
