import { useState } from "react";
import { X, ChevronLeft, LogIn, Mail } from "lucide-react";
import {
  loadBackend,
  signInErrorMessage,
  isConnectionProblem,
  NO_CONNECTION_MESSAGE,
  RESET_REQUESTED_MESSAGE,
} from "../lib/backend";

// Sign in with an email and password, or ask for a password reset link.
// Accounts are by invitation for now (docs/Accounts-and-Backend.md, Decided 4),
// so there is no sign-up form. Signing in changes no piece and moves no data
// (Pass 109): it only tells the app who's signed in. On success the app hears
// about it from the library's auth-change listener in App.jsx, so this window
// just closes.
//
// The password lives only in this component's state while the form is open. It
// is never logged or saved by the app (the library keeps its session, not the
// password), and it's cleared when the window closes.
export function SignInModal({ notice, onClose }) {
  const [mode, setMode] = useState("signin"); // "signin" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const emailTrimmed = email.trim();

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setResetSent(false);
    setPassword("");
  };

  const submitSignIn = async (e) => {
    e.preventDefault();
    if (busy || !emailTrimmed || !password) return;
    setBusy(true);
    setError("");
    const client = await loadBackend();
    if (!client) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    const { error: signInError } = await client.auth.signInWithPassword({ email: emailTrimmed, password });
    if (signInError) {
      setError(signInErrorMessage(signInError));
      setBusy(false);
      return;
    }
    setPassword("");
    onClose();
  };

  const submitReset = async (e) => {
    e.preventDefault();
    if (busy || !emailTrimmed) return;
    setBusy(true);
    setError("");
    const client = await loadBackend();
    if (!client) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    // Back to whichever site asked, which has to be on the project's allowed
    // list of redirect addresses (Authentication > URL Configuration).
    const { error: resetError } = await client.auth.resetPasswordForEmail(emailTrimmed, {
      redirectTo: `${window.location.origin}/`,
    });
    // Only a failed connection is reported as a problem. Every other outcome
    // gets the same answer, so this form can't be used to find out who has an
    // account (an unknown address, a rate limit and a real send all look alike).
    if (resetError && isConnectionProblem(resetError)) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    setResetSent(true);
    setBusy(false);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>
            {mode === "signin" ? "Sign in" : "Reset your password"}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {mode === "signin" ? (
          <form onSubmit={submitSignIn} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="modal-body">
              {notice && <p className="tq-error" style={{ marginBottom: 14 }}>{notice}</p>}
              <p className="wizard-hint">Accounts are by invitation for now.</p>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button type="button" className="link-btn" onClick={() => switchMode("forgot")}>
                Forgot password?
              </button>
              {error && <p className="tq-error" style={{ marginTop: 14 }} role="alert">{error}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={onClose}>
                <ChevronLeft size={16} /> Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={busy || !emailTrimmed || !password}>
                <LogIn size={15} /> {busy ? "Signing in..." : "Sign in"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitReset} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="modal-body">
              {resetSent ? (
                <p className="tq-ok" role="status">{RESET_REQUESTED_MESSAGE}</p>
              ) : (
                <>
                  <p className="wizard-hint">Enter your email and we'll send you a link to choose a new password.</p>
                  <label className="field">
                    <span>Email</span>
                    <input
                      type="email"
                      autoFocus
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                </>
              )}
              {error && <p className="tq-error" style={{ marginTop: 14 }} role="alert">{error}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => switchMode("signin")}>
                <ChevronLeft size={16} /> Back to sign in
              </button>
              {!resetSent && (
                <button type="submit" className="primary-btn" disabled={busy || !emailTrimmed}>
                  <Mail size={15} /> {busy ? "Sending..." : "Send reset link"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
