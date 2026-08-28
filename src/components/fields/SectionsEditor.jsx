import { Trash2, Plus } from "lucide-react";
import { NumberInput } from "../NumberInput";

export function SectionsEditor({ draft, set }) {
  const addSection = () =>
    set({
      sections: [...draft.sections, { id: `s${Date.now()}`, name: "", start: 1, end: draft.totalMeasures }],
    });
  // start/end commit independently (each NumberInput fires its own
  // onCommit), so a patch touching just one of them can leave the pair
  // backwards — e.g. dragging end below the current start. Re-normalized
  // with the same min/max swap resizeSections (lib/utils.js) already uses
  // for the analogous "total measures changed" case, rather than leaving
  // it possible to save a reversed range: every consumer of section
  // start/end (weightedDifficultyFromArray, chunksBySectionId, and the
  // Progress tab's estimated-vs-actual panel among them) assumes start <=
  // end and doesn't re-check it.
  const updateSection = (i, patch) =>
    set({
      sections: draft.sections.map((s, idx) => {
        if (idx !== i) return s;
        const merged = { ...s, ...patch };
        return { ...merged, start: Math.min(merged.start, merged.end), end: Math.max(merged.start, merged.end) };
      }),
    });
  const removeSection = (i) => {
    if (draft.sections.length <= 1) return;
    set({ sections: draft.sections.filter((_, idx) => idx !== i) });
  };

  return (
    <div>
      <p className="wizard-hint">
        Mark the piece's musical sections (Exposition, Development, Subject, Chorus, Section 1–4,
        whatever applies) as measure ranges. This is just how you think about the piece's form,
        separate from how it's divided up for practice. You'll occasionally be assigned a section
        run-through, but practice chunks will generally be just a few measures.
      </p>
      <div className="pairs-list">
        {draft.sections.map((s, i) => (
          <div key={s.id} className="pair-row">
            <input
              type="text"
              className="name-input"
              placeholder={`Section ${i + 1}`}
              value={s.name}
              onChange={(e) => updateSection(i, { name: e.target.value })}
            />
            <span className="pair-label">mm.</span>
            <NumberInput value={s.start} min={1} max={draft.totalMeasures} onCommit={(n) => updateSection(i, { start: n })} />
            <span>–</span>
            <NumberInput value={s.end} min={1} max={draft.totalMeasures} onCommit={(n) => updateSection(i, { end: n })} />
            {draft.sections.length > 1 && (
              <button className="icon-btn" onClick={() => removeSection(i)} aria-label="Remove">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        <button className="ghost-btn" onClick={addSection}>
          <Plus size={14} /> Add section
        </button>
      </div>
    </div>
  );
}
