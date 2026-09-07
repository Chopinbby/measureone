import { Trash2, Plus } from "lucide-react";

export function RecordingsEditor({ draft, set }) {
  const addRecording = () =>
    set({
      // Date.now() alone would collide if two rows were ever added in the
      // same millisecond (docs/Decisions.md#open-questions) — same fix
      // App.jsx's import-merge id and lib/works.js's workId already use.
      recordings: [...(draft.recordings || []), { id: `rec${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, label: "", url: "" }],
    });
  const updateRecording = (i, patch) =>
    set({ recordings: draft.recordings.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const removeRecording = (i) => set({ recordings: draft.recordings.filter((_, idx) => idx !== i) });

  return (
    <div>
      <p className="wizard-hint">
        Link reference recordings — YouTube, Spotify, wherever — so they're one click away while
        you practice.
      </p>
      <div className="pairs-list">
        {(draft.recordings || []).map((r, i) => (
          <div key={r.id} className="recording-row">
            <input
              type="text"
              className="name-input"
              placeholder="e.g. YouTube — Horowitz performance"
              value={r.label}
              onChange={(e) => updateRecording(i, { label: e.target.value })}
            />
            <input
              type="text"
              placeholder="https://…"
              value={r.url}
              onChange={(e) => updateRecording(i, { url: e.target.value })}
            />
            <button className="icon-btn" onClick={() => removeRecording(i)} aria-label="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="ghost-btn" onClick={addRecording}>
          <Plus size={14} /> Add recording
        </button>
      </div>
    </div>
  );
}
