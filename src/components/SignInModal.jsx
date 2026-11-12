import { useEffect, useState } from "react";
import { X, ChevronLeft, LogIn, Mail, UserPlus } from "lucide-react";
import {
  loadBackend,
  signInErrorMessage,
  isConnectionProblem,
  isCaptchaFailure,
  isBotCheckConfigured,
  botCheckBlocksSubmit,
  captchaOptions,
  passwordResetOptions,
  getSignupSettings,
  canOfferSignUp,
  checkSignUpForm,
  signUpWithEmail,
  NO_CONNECTION_MESSAGE,
  RESET_REQUESTED_MESSAGE,
  SIGNUP_CHECK_EMAIL_MESSAGE,
  EXPIRED_LINK_MESSAGE,
  EXPIRED_SIGNUP_HINT,
  BOT_CHECK_FAILED_MESSAGE,
  MIN_NEW_PASSWORD_LENGTH,
} from "../lib/backend";
import { ReportProblemLink } from "./ReportProblemLink";
import { BotCheck } from "./BotCheck";

// Whether "Create an account" should be offered right now: "unknown" until the service has
// answered (or when it can't be reached), then "open" or "closed". Offered only while the
// service accepts sign-ups AND requires the confirmation email AND this build has the bot
// check (lib/backend.js canOfferSignUp, tested). The answer is read once per page load, so
// switching sign-ups off in the dashboard hides the form on the next reload.
//
// The read is one small request to the account service, so it is made only by a screen that
// is about to show the choice (this window, and the welcome screen's link), never for a
// visitor who is just using the app. And a build with no bot check can't offer the form
// whatever the service says, so it doesn't ask at all: without the bot check's setting the
// app makes exactly the requests it made before Pass 135.
export function useSignUpAvailability(enabled) {
  const botCheck = isBotCheckConfigured();
  const [availability, setAvailability] = useState(botCheck ? "unknown" : "closed");
  useEffect(() => {
    if (!enabled || !botCheck) return undefined;
    let alive = true;
    getSignupSettings().then((settings) => {
      if (!alive || !settings) return;
      setAvailability(canOfferSignUp(settings, isBotCheckConfigured()) ? "open" : "closed");
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return availability;
}

// The welcome screen's "Create an account", beside "Sign in", on the same rule: it shows
// only while sign-ups are on, so it never offers what the service would refuse.
export function WelcomeCreateAccountLink({ onOpen }) {
  const availability = useSignUpAvailability(true);
  if (availability !== "open") return null;
  return (
    <button type="button" className="link-btn" style={{ display: "block", marginTop: 10 }} onClick={onOpen}>
      Create an account
    </button>
  );
}

const checkRowStyle = { display: "flex", alignItems: "flex-start", gap: 8, fontWeight: 500, cursor: "pointer", fontSize: 14, lineHeight: 1.45, marginBottom: 10 };

// Sign in with an email and password, create an account, or ask for a password reset link.
// Since Pass 135 accounts can be made here too, but only while the service accepts sign-ups
// (see useSignUpAvailability); until then accounts are by invitation and this window says so.
// Signing in changes no piece and moves no data (Pass 109): it only tells the app who's
// signed in. On success the app hears about it from the library's auth-change listener in
// App.jsx, so this window just closes. A new account arrives through the link in its
// confirmation email (App.jsx handles that), never through this window.
//
// The password lives only in this component's state while the form is open. It is never
// logged or saved by the app (the library keeps its session, not the password), and it's
// cleared when the window closes.
//
// The bot check (BotCheck.jsx) is on all three forms, because the service asks for its token
// on a sign-in and a reset as well as on a sign-up once it is switched on for the project.
export function SignInModal({ notice, startMode, onClose }) {
  const [mode, setMode] = useState(startMode === "signup" ? "signup" : "signin"); // "signin" | "forgot" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [signedUp, setSignedUp] = useState(false);

  const botOn = isBotCheckConfigured();
  const [bot, setBot] = useState({ token: "", status: botOn ? "working" : "off" });
  const [botReset, setBotReset] = useState(0);
  const onBot = (token, status) => setBot({ token, status });
  // A token works once: after any attempt the widget is asked for a fresh one.
  const spendToken = () => setBotReset((n) => n + 1);
  const botWaiting = botOn && botCheckBlocksSubmit(bot.status);

  const availability = useSignUpAvailability(true);
  const emailTrimmed = email.trim();

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setResetSent(false);
    setSignedUp(false);
    setPassword("");
    setAgain("");
    // The two boxes are an answer to "do you agree, now": leaving the form takes it back,
    // so coming back asks afresh instead of finding them already ticked.
    setAge(false);
    setTerms(false);
    setBot({ token: "", status: botOn ? "working" : "off" });
  };

  const submitSignIn = async (e) => {
    e.preventDefault();
    if (busy || !emailTrimmed || !password || botWaiting) return;
    setBusy(true);
    setError("");
    const client = await loadBackend();
    if (!client) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    const { error: signInError } = await client.auth.signInWithPassword({ email: emailTrimmed, password, ...captchaOptions(bot.token) });
    if (signInError) {
      setError(signInErrorMessage(signInError));
      setBusy(false);
      spendToken();
      return;
    }
    setPassword("");
    onClose();
  };

  const submitReset = async (e) => {
    e.preventDefault();
    if (busy || !emailTrimmed || botWaiting) return;
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
    const { error: resetError } = await client.auth.resetPasswordForEmail(
      emailTrimmed,
      passwordResetOptions(`${window.location.origin}/`, bot.token)
    );
    spendToken();
    // Only a failed connection, or a refused bot check (nothing was sent, and the person must
    // not be told a link is on its way), is reported as a problem. Every other outcome
    // gets the same answer, so this form can't be used to find out who has an
    // account (an unknown address, a rate limit and a real send all look alike).
    if (resetError && isConnectionProblem(resetError)) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    if (resetError && isCaptchaFailure(resetError)) {
      setError(BOT_CHECK_FAILED_MESSAGE);
      setBusy(false);
      return;
    }
    setResetSent(true);
    setBusy(false);
  };

  // Pass 135. Both boxes and the checks are in checkSignUpForm; what the service answered
  // is put into words by signUpWithEmail (lib/backend.js, tested): the same sentence for every
  // address, so this form can't be used to find out who has an account.
  const submitSignUp = async (e) => {
    e.preventDefault();
    if (busy || botWaiting) return;
    const check = checkSignUpForm({ email: emailTrimmed, password, again, age, terms });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setBusy(true);
    setError("");
    const client = await loadBackend();
    if (!client) {
      setError(NO_CONNECTION_MESSAGE);
      setBusy(false);
      return;
    }
    const outcome = await signUpWithEmail({
      client,
      email: check.email,
      password,
      captchaToken: bot.token,
      redirectTo: `${window.location.origin}/`,
    });
    spendToken();
    setBusy(false);
    // The one answer also covers a refusal the app can't explain without giving away who has
    // an account. Leave the service's code (never the address) in the console for whoever
    // looks into a report of "the email never came".
    if (outcome.unexpected) console.warn("MeasureOne: the sign-up got an answer it doesn't explain to the person.", outcome.unexpected);
    if (outcome.kind === "check-email") {
      setPassword("");
      setAgain("");
      setSignedUp(true);
      return;
    }
    if (outcome.kind === "signed-in") {
      setPassword("");
      setAgain("");
      onClose();
      return;
    }
    setError(outcome.message);
  };

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create an account" : "Reset your password";
  const passwordTooShort = password.length > 0 && password.length < MIN_NEW_PASSWORD_LENGTH;
  // The button works as soon as the three fields are filled, ticked boxes or not: pressing it
  // with a box missing says which one (checkSignUpForm), instead of a grey button with no word
  // why. On a small screen the boxes can be scrolled out of sight.
  const canSignUp = !busy && !botWaiting && emailTrimmed && password && again;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {mode === "signin" && (
          <form onSubmit={submitSignIn} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="modal-body">
              {notice && <p className="tq-error" style={{ marginBottom: 14 }}>{notice}</p>}
              {/* An expired link may have been a sign-up confirmation: while sign-ups are on,
                  say how to get another one. */}
              {notice === EXPIRED_LINK_MESSAGE && availability === "open" && (
                <p className="wizard-hint" style={{ marginTop: -6 }}>{EXPIRED_SIGNUP_HINT}</p>
              )}
              {availability === "closed" && <p className="wizard-hint">Accounts are by invitation for now.</p>}
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
              {botOn && (
                <div style={{ marginTop: 10 }}>
                  <BotCheck key="signin" onChange={onBot} resetCount={botReset} />
                </div>
              )}
              {error && <p className="tq-error" style={{ marginTop: 14 }} role="alert">{error}</p>}
              {availability === "open" && (
                <p className="wizard-hint" style={{ margin: "16px 0 0" }}>
                  New here?{" "}
                  <button type="button" className="link-btn" onClick={() => switchMode("signup")}>
                    Create an account
                  </button>
                </p>
              )}
              {/* Pass 133: the two pages open in a new tab so this window (and anything typed
                  into it) stays put. "Report a problem" is here too (Pass 132 left that open):
                  a person who can't sign in is the likeliest to give up. */}
              <p className="wizard-hint" style={{ margin: "16px 0 0" }}>
                <a className="link-btn" href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                {" · "}
                <a className="link-btn" href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a>
                {" · "}
                <ReportProblemLink />
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={onClose}>
                <ChevronLeft size={16} /> Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={busy || !emailTrimmed || !password || botWaiting}>
                <LogIn size={15} /> {busy ? "Signing in..." : "Sign in"}
              </button>
            </div>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={submitSignUp} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="modal-body">
              {signedUp ? (
                <>
                  <p className="tq-ok" role="status">{SIGNUP_CHECK_EMAIL_MESSAGE}</p>
                  <p className="wizard-hint" style={{ margin: "10px 0 0" }}>
                    If it doesn't arrive in a few minutes, check your spam folder.
                  </p>
                </>
              ) : (
                <>
                  <p className="wizard-hint">
                    An account keeps a copy of your pieces online so they can follow you between devices. You can use MeasureOne
                    without one.
                  </p>
                  <label className="field">
                    <span>Email</span>
                    <input
                      type="email"
                      autoFocus
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <span className="field-hint">Use at least {MIN_NEW_PASSWORD_LENGTH} characters.</span>
                  </label>
                  <label className="field">
                    <span>Password again</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={again}
                      onChange={(e) => setAgain(e.target.value)}
                    />
                  </label>
                  {passwordTooShort && <p className="tq-error" style={{ marginTop: -6 }}>That's too short. Use at least {MIN_NEW_PASSWORD_LENGTH} characters.</p>}
                  <label style={checkRowStyle}>
                    <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>I'm 13 or older</span>
                  </label>
                  <label style={checkRowStyle}>
                    <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>
                      I agree to the{" "}
                      <a className="link-btn" href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a>
                      {" "}and the{" "}
                      <a className="link-btn" href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                    </span>
                  </label>
                  {botOn && <BotCheck key="signup" onChange={onBot} resetCount={botReset} />}
                  {error && <p className="tq-error" style={{ marginTop: 6 }} role="alert">{error}</p>}
                  <p className="wizard-hint" style={{ margin: "14px 0 0" }}>
                    <ReportProblemLink />
                  </p>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => switchMode("signin")}>
                <ChevronLeft size={16} /> Back to sign in
              </button>
              {!signedUp && (
                <button type="submit" className="primary-btn" disabled={!canSignUp}>
                  <UserPlus size={15} /> {busy ? "Creating..." : "Create account"}
                </button>
              )}
            </div>
          </form>
        )}

        {mode === "forgot" && (
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
                  {botOn && <BotCheck key="forgot" onChange={onBot} resetCount={botReset} />}
                </>
              )}
              {error && <p className="tq-error" style={{ marginTop: 14 }} role="alert">{error}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => switchMode("signin")}>
                <ChevronLeft size={16} /> Back to sign in
              </button>
              {!resetSent && (
                <button type="submit" className="primary-btn" disabled={busy || !emailTrimmed || botWaiting}>
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
