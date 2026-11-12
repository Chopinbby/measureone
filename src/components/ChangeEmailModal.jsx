import { useState } from "react";
import { X, Mail } from "lucide-react";
import {
  loadBackend,
  checkNewEmail,
  changeEmailOutcome,
  describeEmailChangeRequested,
  NO_CONNECTION_MESSAGE,
} from "../lib/backend";

// Change the address a signed-in account uses (Pass 130, docs/Accounts-and-Backend.md,
// Phase 3 Design D). Supabase's "secure email change" does the work: asking for a new
// address sends a link to BOTH the current and the new address, and the address
// changes only once both links have been opened. Nothing changes here when this
// window is closed, and the account keeps signing in with the current address until
// then. The wording and the checks are in lib/backend.js (tested); this window only
// shows them. No password is asked for: the link that must also be opened at the
// current address is what stops a stranger at an unlocked device finishing a change.
//
// Pass 135: an address that already has an account gets the same "links sent" screen as any
// other (changeEmailOutcome), worded "If the new address can be used, ...", so this window
// can't be used to find out who has an account. The service itself still answers a direct
// request plainly; see the note on isEmailTakenError in lib/backend.js.
export function ChangeEmailModal({ currentEmail, onClose }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    const check = checkNewEmail({ current: currentEmail, typed });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setBusy(true);
    const client = await loadBackend();
    if (!client) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    // Back to this address afterwards, which has to be on the project's allowed
    // list of redirect addresses (the same one a reset link uses).
    const { error: updateError } = await client.auth.updateUser(
      { email: check.email },
      { emailRedirectTo: `${window.location.origin}/` }
    );
    const outcome = changeEmailOutcome(updateError);
    if (!outcome.requested) {
      setError(outcome.message);
      setBusy(false);
      return;
    }
    setSentTo(check.email);
    setBusy(false);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>Change email</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {sentTo ? (
          <>
            <div className="modal-body">
              <p className="tq-ok" role="status" style={{ fontSize: 14, lineHeight: 1.5 }}>
                {describeEmailChangeRequested({ current: currentEmail, next: sentTo })}
              </p>
            </div>
            <div className="modal-foot" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="primary-btn" onClick={onClose} autoFocus>
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="modal-body">
              <p className="wizard-hint">
                Your account's email address is <strong>{currentEmail}</strong>. Enter the new one. For your security we
                send a confirmation link to both addresses, and the address changes only after you open both. Until
                then you keep signing in with {currentEmail}.
              </p>
              <label className="field">
                <span>New email address</span>
                <input
                  type="email"
                  autoFocus
                  autoComplete="email"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </label>
              {error && <p className="tq-error" style={{ marginTop: 8 }} role="alert">{error}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={busy || !typed.trim()}>
                <Mail size={15} /> {busy ? "Sending..." : "Send confirmation links"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
