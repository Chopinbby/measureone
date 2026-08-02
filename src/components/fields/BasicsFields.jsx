import { NumberInput } from "../NumberInput";
import { resizeDifficulty, resizeSections } from "../../lib/utils";

export function BasicsFields({ draft, set }) {
  return (
    <>
      <label className="field">
        <span>Piece name</span>
        <input
          type="text"
          placeholder="e.g. Chopin – Nocturne in E♭ major, Op. 9 No. 2"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Composer</span>
        <input
          type="text"
          placeholder="e.g. Frédéric Chopin"
          value={draft.composer || ""}
          onChange={(e) => set({ composer: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Total measures</span>
        <NumberInput
          value={draft.totalMeasures}
          min={1}
          max={5000}
          onCommit={(total) =>
            set({
              totalMeasures: total,
              measureDifficulty: resizeDifficulty(draft.measureDifficulty, total),
              sections: resizeSections(draft.sections, total),
            })
          }
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          placeholder="Context, history, teacher notes — anything worth remembering about this piece…"
          value={draft.notes || ""}
          onChange={(e) => set({ notes: e.target.value })}
          rows={4}
        />
      </label>
    </>
  );
}
