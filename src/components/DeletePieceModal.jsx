import { useState } from "react";
import { X, ChevronLeft, Trash2 } from "lucide-react";
import { deleteWindowCopy } from "../lib/recentlyDeleted";

// Deletion takes the piece's entire practice history with it, so it needs stronger
// friction than a single window.confirm() — typing the exact name back is a deliberate,
// hard-to-misfire gate. Also sidesteps environments where the native confirm()
// dialog is suppressed or never appears, which read to the user as "the
// delete button doesn't work."
//
// Pass 122: when this device is signed in and its first backup is checked
// (`syncsToAccount`), deleting a piece deletes it on every device on the account, and it
// can be brought back from Recently deleted for 30 days. The words for both cases are
// in lib/recentlyDeleted.js (deleteWindowCopy, tested); signed out it says what it always
// said: this browser, permanently, no way back.
export function DeletePieceModal({ piece, syncsToAccount = false, onCancel, onConfirm }) {
  const [typed, setTyped] = useState("");
  const targetName = piece.name || "";
  const matches = targetName.length > 0 && typed === targetName;
  const copy = deleteWindowCopy({ name: targetName, syncs: syncsToAccount });

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
          <p className="wizard-hint">{copy.body}</p>
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
            <Trash2 size={15} /> {copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
