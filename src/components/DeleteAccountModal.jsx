import { useState } from "react";
import { X, ChevronLeft, Trash2 } from "lucide-react";
import { DELETE_BACKUP_NOTE, isBotCheckConfigured, botCheckBlocksSubmit } from "../lib/backend";
import { BotCheck } from "./BotCheck";

// Delete the signed-in account (Pass 130, docs/Accounts-and-Backend.md, Phase 3 Design D).
// The password is asked for again first and checked by signing in with it just before
// the delete (lib/backend.js deleteMyAccount, tested), because the database function
// can't see a password: this is the guard against an unlocked device, not something the
// database enforces. This window never reads or stores the password beyond its own
// state while it is open, and clears it as soon as the attempt is over.
//
// It stays open after the account is gone (App.jsx keeps it up when the person becomes
// signed out), so its last screen is where "your account is deleted" is said. This
// device's pieces and technique library are never touched (the owner's choice,
// 2026-11-06): it only signs out.
//
// `onDelete(password, captchaToken)` is App.jsx's handler and resolves to deleteMyAccount's
// describeDeleteAccount result, { text, problem, deleted }. Pass 135: the password re-check is
// a sign-in, and once the project's bot check is on the service asks for its token on a
// sign-in too, so this window carries the widget (BotCheck.jsx) and sends the token along.
// A token works once, so a new one is taken after every attempt.
export function DeleteAccountModal({ email, onDelete, onClose }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [doneText, setDoneText] = useState("");
  const botOn = isBotCheckConfigured();
  const [bot, setBot] = useState({ token: "", status: botOn ? "working" : "off" });
  const [botReset, setBotReset] = useState(0);
  const botWaiting = botOn && botCheckBlocksSubmit(bot.status);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !password || botWaiting) return;
    setBusy(true);
    setProblem("");
    const result = await onDelete(password, bot.token);
    setPassword("");
    setBusy(false);
    setBotReset((n) => n + 1);
    if (result && result.deleted) setDoneText(result.text);
    else setProblem((result && result.text) || "Something went wrong. Try again in a moment.");
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>Delete my account</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </div>
        {doneText ? (
          <>
            <div className="modal-body">
              <p className="tq-ok" role="status" style={{ fontSize: 14, lineHeight: 1.5 }}>{doneText}</p>
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
                This permanently deletes your MeasureOne account ({email}) and the copy of your pieces and technique
                library that it keeps online. It can't be undone.
              </p>
              <p className="wizard-hint">
                Nothing is removed from this device: your pieces and technique library stay here, and you'll be signed
                out. Other devices signed in to this account are signed out within about an hour and keep their own
                copies. If your account holds anything this device doesn't, use Get changes from your account first.
              </p>
              <p className="wizard-hint">{DELETE_BACKUP_NOTE}</p>
              <label className="field">
                <span>Type your password to confirm</span>
                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {botOn && <BotCheck onChange={(token, status) => setBot({ token, status })} resetCount={botReset} />}
              {problem && <p className="tq-error" style={{ marginTop: 8 }} role="alert">{problem}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
                <ChevronLeft size={16} /> Cancel
              </button>
              <button type="submit" className="danger-btn" disabled={busy || !password || botWaiting}>
                <Trash2 size={15} /> {busy ? "Deleting..." : "Delete my account"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
