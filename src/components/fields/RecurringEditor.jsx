import { Trash2, Plus } from "lucide-react";
import { NumberInput } from "../NumberInput";

export function RecurringEditor({ draft, set }) {
  const addPair = () =>
    set({
      recurringPairs: [
        ...draft.recurringPairs,
        { repeatStart: 1, repeatEnd: 1, sourceStart: 1, sourceEnd: 1 },
      ],
    });
  const updatePair = (i, patch) =>
    set({ recurringPairs: draft.recurringPairs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const removePair = (i) =>
    set({ recurringPairs: draft.recurringPairs.filter((_, idx) => idx !== i) });

  return (
    <div>
      <p className="wizard-hint">
        Mark any recurring material. You will still need to practice recurring passages in their
        unique context, but your plan will assign slightly fewer repetitions.
      </p>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={draft.recurringMode === "none" ? "active" : ""} onClick={() => set({ recurringMode: "none" })}>
          None
        </button>
        <button className={draft.recurringMode === "advanced" ? "active" : ""} onClick={() => set({ recurringMode: "advanced" })}>
          Map repeats
        </button>
      </div>

      {draft.recurringMode === "advanced" && (
        <div className="pairs-list">
          {draft.recurringPairs.map((p, i) => (
            <div key={i} className="pair-row">
              <span className="pair-label">mm.</span>
              <NumberInput value={p.repeatStart} min={1} onCommit={(n) => updatePair(i, { repeatStart: n })} />
              <span>–</span>
              <NumberInput value={p.repeatEnd} min={1} onCommit={(n) => updatePair(i, { repeatEnd: n })} />
              <span className="pair-label">is like</span>
              <NumberInput value={p.sourceStart} min={1} onCommit={(n) => updatePair(i, { sourceStart: n })} />
              <span>–</span>
              <NumberInput value={p.sourceEnd} min={1} onCommit={(n) => updatePair(i, { sourceEnd: n })} />
              <button className="icon-btn" onClick={() => removePair(i)} aria-label="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="ghost-btn" onClick={addPair}>
            <Plus size={14} /> Add repeated passage
          </button>
        </div>
      )}
    </div>
  );
}
