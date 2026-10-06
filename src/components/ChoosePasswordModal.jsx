import { useState } from "react";
import { X, Check } from "lucide-react";
import { loadBackend, setPasswordErrorMessage, changePasswordProblem, NO_CONNECTION_MESSAGE } from "../lib/backend";

// Three ways in, all saving through the library (updateUser):
// - "invite" and "reset" (Pass 109): shown after arriving from an invitation
//   link or a password-reset link. The link has already signed the person in,
//   so all that's left is choosing a password to sign in with next time.
// - "change" (Pass 113): a signed-in person choosing a new password from
//   Settings > Account. No current password is asked for (the service doesn't
//   need one). If the service wants a recent sign-in first (its "secure
//   password change" setting), that's said plainly and "Sign in again" is
//   offered (onSignInAgain, from App.jsx). Saving doesn't sign anyone out, and
//   the window says so instead of just closing.
// This component never logs or stores the password, and clears it once it's
// saved or the window closes.
//
// A floor on length so an obviously too-short password is caught before it's
// sent. Supabase's own minimum (a dashboard setting, 6 by default) is the real
// rule: if it's set higher, the service's answer is shown as it comes back.
const MIN_PASSWORD_LENGTH = 6;

export function ChoosePasswordModal({ mode, onClose, onSignInAgain }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changing = mode === "change";
  // Change mode only: the problem is one that signing in again would fix, and
  // whether the new password has been saved.
  const [canSignInAgain, setCanSignInAgain] = useState(false);
  const [saved, setSaved] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = again.length > 0 && password !== again;
  const canSave = password.length >= MIN_PASSWORD_LENGTH && password === again;

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !canSave) return;
    setBusy(true);
    setError("");
    setCanSignInAgain(false);
    const client = await loadBackend();
    if (!client) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) {
      if (changing) {
        const problem = changePasswordProblem(updateError);
        setError(problem.message);
        setCanSignInAgain(problem.signInAgain);
      } else {
        setError(setPasswordErrorMessage(updateError));
      }
      setBusy(false);
      return;
    }
    setPassword("");
    setAgain("");
    if (changing) {
      setSaved(true);
      setBusy(false);
      return;
    }
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>
            {changing ? "Change password" : "Choose a password"}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {saved ? (
          <>
            <div className="modal-body">
              <p className="tq-ok" role="status" style={{ fontSize: 14, lineHeight: 1.5 }}>
                Your password is changed. You're still signed in on this device.
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
                {mode === "invite"
                  ? "You're signed in. Choose a password to use next time you sign in."
                  : changing
                    ? "Choose a new password for your account. You'll stay signed in on this device."
                    : "Choose a new password for your account."}
              </p>
              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span className="field-hint">Use at least {MIN_PASSWORD_LENGTH} characters.</span>
              </label>
              <label className="field">
                <span>Type it again</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={again}
                  onChange={(e) => setAgain(e.target.value)}
                />
              </label>
              {tooShort && <p className="tq-error">That's too short. Use at least {MIN_PASSWORD_LENGTH} characters.</p>}
              {mismatch && <p className="tq-error">The two passwords don't match.</p>}
              {error && <p className="tq-error" style={{ marginTop: 8 }} role="alert">{error}</p>}
              {canSignInAgain && onSignInAgain && (
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="ghost-btn" onClick={onSignInAgain}>
                    Sign in again
                  </button>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={onClose}>
                {changing ? "Cancel" : "Not now"}
              </button>
              <button type="submit" className="primary-btn" disabled={busy || !canSave}>
                <Check size={15} /> {busy ? "Saving..." : "Save password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
