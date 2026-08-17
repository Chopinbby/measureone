import { Trash2, Plus } from "lucide-react";
import { NumberInput } from "../NumberInput";

export function BpmZonesEditor({ draft, set }) {
  const addZone = () =>
    set({
      bpmZones: [
        ...(draft.bpmZones || []),
        { id: `bz${Date.now()}`, start: 1, end: draft.totalMeasures, bpm: draft.targetBPM || 100 },
      ],
    });
  const updateZone = (i, patch) =>
    set({ bpmZones: draft.bpmZones.map((z, idx) => (idx === i ? { ...z, ...patch } : z)) });
  const removeZone = (i) => set({ bpmZones: draft.bpmZones.filter((_, idx) => idx !== i) });

  return (
    <div>
      <p className="wizard-hint">
        Optionally set a different tempo target for specific measure ranges — this overrides the
        whole-piece default (set under Piece) for those measures.
      </p>
      <div className="pairs-list">
        {(draft.bpmZones || []).map((z, i) => (
          <div key={z.id} className="pair-row">
            <span className="pair-label">mm.</span>
            <NumberInput value={z.start} min={1} max={draft.totalMeasures} onCommit={(n) => updateZone(i, { start: n })} />
            <span>–</span>
            <NumberInput value={z.end} min={1} max={draft.totalMeasures} onCommit={(n) => updateZone(i, { end: n })} />
            <span className="pair-label">target</span>
            <NumberInput value={z.bpm} min={20} max={400} onCommit={(n) => updateZone(i, { bpm: n })} />
            <button className="icon-btn" onClick={() => removeZone(i)} aria-label="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="ghost-btn" onClick={addZone}>
          <Plus size={14} /> Add tempo zone
        </button>
      </div>
    </div>
  );
}
