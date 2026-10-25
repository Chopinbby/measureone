import { X, RotateCcw } from "lucide-react";
import { RECENTLY_DELETED_DAYS, describeDeletedAgo } from "../lib/recentlyDeleted";

// Pass 122: the pieces deleted from any of the person's devices in the last
// RECENTLY_DELETED_DAYS days, each with Restore. The list itself is made in
// lib/recentlyDeleted.js (recentlyDeletedList, tested) from the account's own copy of
// each deleted piece, which a deletion only ever MARKS (it is never erased). Restoring
// brings the piece back on every device as the account last held it: practice that was
// never backed up before the deletion can't come back. This only draws what App.jsx
// gives it; Restore itself is App.jsx's handleRestoreDeleted.
//
// state: { status: "loading" | "ok" | "error", items: [{ id, revision, name, deletedAt,
// measures, sessions }], error, busyId, notice: { text, problem } | null }
export function RecentlyDeletedModal({ state, busy = false, onRestore, onClose }) {
  const { status, items, error, busyId, notice } = state;
  const now = Date.now();
  const facts = (item) => {
    const parts = [];
    if (item.measures != null) parts.push(`${item.measures} ${item.measures === 1 ? "measure" : "measures"}`);
    parts.push(`${item.sessions} ${item.sessions === 1 ? "session" : "sessions"}`);
    return parts.join(", ");
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="recently-deleted-title">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2 id="recently-deleted-title" style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>
            Recently deleted
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="wizard-hint" style={{ marginTop: 0 }}>
            Pieces deleted from any of your devices in the last {RECENTLY_DELETED_DAYS} days. Restoring one brings it back on every
            device, as your account last had it. Practice that was never backed up before the deletion can't come back.
          </p>
          {notice && (
            <p role="status" className={notice.problem ? "tq-error" : "tq-ok"} style={{ margin: "0 0 12px", fontSize: 13 }}>
              {notice.text}
            </p>
          )}
          {status === "loading" && <p className="wizard-hint" style={{ margin: 0 }}>Reading your account...</p>}
          {status === "error" && (
            <p role="status" className="tq-error" style={{ margin: 0, fontSize: 13 }}>
              {error}
            </p>
          )}
          {status === "ok" && items.length === 0 && (
            <p className="wizard-hint" style={{ margin: 0 }}>
              Nothing was deleted in the last {RECENTLY_DELETED_DAYS} days.
            </p>
          )}
          {status === "ok" && items.length > 0 && (
            <div>
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--line)" }}
                >
                  <span style={{ fontSize: 14 }}>
                    <strong>{item.name}</strong>
                    <span className="tip-line" style={{ display: "block", margin: 0 }}>
                      Deleted {describeDeletedAgo(item.deletedAt, now)} · {facts(item)}
                    </span>
                  </span>
                  <button className="ghost-btn" onClick={() => onRestore(item)} disabled={busy}>
                    <RotateCcw size={14} /> {busyId === item.id ? "Restoring..." : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span />
          <button className="primary-btn" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
