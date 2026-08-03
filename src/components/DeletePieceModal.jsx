import { useState } from "react";
import { X, ChevronLeft, Trash2 } from "lucide-react";

// Deletion is irreversible (no undo, no trash) and takes the piece's entire
// practice history with it, so it needs stronger friction than a single
// window.confirm() — typing the exact name back is a deliberate, hard-to-
// misfire gate. Also sidesteps environments where the native confirm()
// dialog is suppressed or never appears, which read to the user as "the
// delete button doesn't work."
export function DeletePieceModal({ piece, onCancel, onConfirm }) {
  const [typed, setTyped] = useState("");
  const targetName = piece.name || "";
  const matches = targetName.length > 0 && typed === targetName;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>Delete this piece</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="wizard-hint">
            Are you sure you want to delete this piece and all its progress? This removes "
            {targetName || "this piece"}" — every chunk, session log, and revival history — from this
            browser, permanently. It can't be undone.
          </p>
          <label className="field">
            <span>
              Type <strong>{targetName || "the piece name"}</strong> to confirm
            </span>
            <input
              type="text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={targetName}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches) onConfirm();
              }}
            />
          </label>
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onCancel}>
            <ChevronLeft size={16} /> Cancel
          </button>
          <button className="danger-btn" disabled={!matches} onClick={onConfirm}>
            <Trash2 size={15} /> Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}
