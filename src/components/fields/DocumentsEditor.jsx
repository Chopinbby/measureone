import { Trash2, Plus } from "lucide-react";

// Adapted from RecordingsEditor rather than generalized into a shared
// component — the two lists are structurally identical ({id, label, url},
// same add/update/remove shape) but "generalize unless it's genuinely
// trivial, don't force a shared refactor" was the explicit call for this
// pass (Pass 24), and recordings/documents are different enough in intent
// (a reference to listen to vs. a reference document to read) that forcing
// one component now would make a later divergence — e.g. a document type
// field, or upload support — an awkward prop-threading exercise instead of
// a local edit. Revisit if a third list like this ever shows up.
export function DocumentsEditor({ draft, set }) {
  const addDocument = () =>
    set({
      // Date.now() alone would collide if two rows were ever added in the
      // same millisecond (docs/Decisions.md#open-questions) — same fix
      // App.jsx's import-merge id and lib/works.js's workId already use.
      documents: [...(draft.documents || []), { id: `doc${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, label: "", url: "" }],
    });
  const updateDocument = (i, patch) =>
    set({ documents: draft.documents.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) });
  const removeDocument = (i) => set({ documents: draft.documents.filter((_, idx) => idx !== i) });

  return (
    <div>
      <p className="wizard-hint">
        Link reference documents — sheet music, fingerings, program notes — hosted on Drive, Dropbox,
        IMSLP, wherever, so they're one click away while you practice.
      </p>
      <div className="pairs-list">
        {(draft.documents || []).map((d, i) => (
          <div key={d.id} className="recording-row">
            <input
              type="text"
              className="name-input"
              placeholder="e.g. IMSLP — full score PDF"
              value={d.label}
              onChange={(e) => updateDocument(i, { label: e.target.value })}
            />
            <input
              type="text"
              placeholder="https://…"
              value={d.url}
              onChange={(e) => updateDocument(i, { url: e.target.value })}
            />
            <button className="icon-btn" onClick={() => removeDocument(i)} aria-label="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="ghost-btn" onClick={addDocument}>
          <Plus size={14} /> Add document
        </button>
      </div>
    </div>
  );
}
