/* ------------------------------------------------------------------ */
/*  The connection to the account backend (Supabase), Pass 108-109.   */
/*                                                                     */
/*  Optional by design (docs/Accounts-and-Backend.md, Decided 3 and    */
/*  Design G): with the two connection settings missing, the app runs  */
/*  exactly as it did before accounts, saving to this browser only.    */
/*  That's the state of the live site, of a fresh checkout, and of     */
/*  `npm test`.                                                        */
/*                                                                     */
/*  Design K: the Supabase library (about 59 KB compressed) is not in  */
/*  the app's main download. It's fetched by loadBackend() only when   */
/*  something needs it: someone opens sign-in, this device already     */
/*  holds a signed-in session, or the person arrived from an invite or */
/*  reset link. Everything before that (is a backend configured, is    */
/*  there a saved session, is there a link in the address) is answered */
/*  here without the library, so a signed-out visitor downloads exactly */
/*  what they always did. Never add a top-level import of the library.  */
/*                                                                     */
/*  Only the public key belongs here (the "anon" / publishable key).   */
/*  The database's row-level security rules decide what each account  */
/*  may read and write, so this key is safe in the browser. The secret */
/*  (service_role) key must never be added: it skips those rules.      */
/*                                                                     */
/*  Session persistence is left at the library's defaults: it keeps    */
/*  the session (never the password) in this browser's localStorage.   */
/* ------------------------------------------------------------------ */

// import.meta.env is Vite's; it's undefined under node:test, hence the `|| {}`.
const env = import.meta.env || {};
const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
const key = typeof env.VITE_SUPABASE_ANON_KEY === "string" ? env.VITE_SUPABASE_ANON_KEY.trim() : "";

function urlIsValid(u) {
  try {
    return Boolean(new URL(u).hostname);
  } catch (e) {
    return false;
  }
}

const configured = Boolean(url && key && urlIsValid(url));

// True when both settings are present and the address is a real one. This is
// the gate for every account feature: when it's false, nothing account-related
// renders anywhere.
export function isBackendConfigured() {
  return configured;
}

/* ------------------------------------------------------------------ */
/*  Questions answered without the library                             */
/* ------------------------------------------------------------------ */

// Where the library keeps a signed-in session: `sb-<first part of the
// project's hostname>-auth-token`, in localStorage. Mirrors what
// supabase-js derives itself, so a saved session can be spotted without
// loading it. If a library upgrade ever changed that name, a signed-in device
// would look signed out until someone opened sign-in, so check this against
// the library's own `client.auth.storageKey` after upgrading supabase-js.
export function authStorageKeyFor(projectUrl) {
  try {
    return `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
  } catch (e) {
    return null;
  }
}

// Does this browser hold a saved session for the configured project?
export function hasStoredSession() {
  if (!configured) return false;
  try {
    const storageKey = authStorageKeyFor(url);
    return Boolean(storageKey && localStorage.getItem(storageKey));
  } catch (e) {
    return false;
  }
}

// What an invite or reset link carries in the address (the library's default
// "implicit" flow puts it after the #), or null for an ordinary visit.
// - a working link: { type: "invite" | "recovery" | "email_change" | ..., error: null }
// - an expired or already used link: { type: null, error: { code, description } }
// - Pass 130: the FIRST of the two confirmations of an email change (Supabase's
//   "secure email change" sends a link to the old address and one to the new, and
//   the change happens when both are opened): the service sends the person back
//   with only a short message and no sign-in, which comes back as
//   { type: SINGLE_CONFIRMATION_LINK, error: null, message }. Looked for after the #
//   and, as a precaution, in the query string (`search`, optional).
// The library reports a password-reset link by name (PASSWORD_RECOVERY) but an
// invitation only as an ordinary sign-in, so the app has to read `type` itself,
// before the library removes it from the address.
export const SINGLE_CONFIRMATION_LINK = "email_change_first";

// Supabase's wording for that message is "Confirmation link accepted. Please
// proceed to confirm link sent to the other email". Matched loosely (either half),
// so a small change in its wording doesn't turn this into a silent miss.
export function isSingleConfirmationMessage(message) {
  return /confirmation link accepted|confirm link sent to the other email/i.test(String(message || ""));
}

export function parseAuthLink(hash, search = "") {
  const text = typeof hash === "string" ? hash.replace(/^#/, "") : "";
  const params = new URLSearchParams(text);
  if (text) {
    const errorCode = params.get("error_code");
    const errorName = params.get("error");
    const errorDescription = params.get("error_description");
    if (errorCode || errorName || errorDescription) {
      return { type: null, error: { code: errorCode || errorName || "unknown", description: errorDescription || "" } };
    }
    if (params.get("access_token") && params.get("type")) {
      return { type: params.get("type"), error: null };
    }
  }
  const queryText = typeof search === "string" ? search.replace(/^\?/, "") : "";
  const message = params.get("message") || (queryText ? new URLSearchParams(queryText).get("message") : null);
  if (message && isSingleConfirmationMessage(message)) {
    return { type: SINGLE_CONFIRMATION_LINK, error: null, message };
  }
  return null;
}

// Read once, when this file first loads, which is before anything can load
// the library (and so before the library removes the link from the address).
function captureAuthLink() {
  if (!configured || typeof window === "undefined") return null;
  const link = parseAuthLink(window.location.hash, window.location.search);
  if (link && link.error) {
    // The library won't be asked to handle a failed link, so clear it from the
    // address here, so a reload doesn't show the same message again.
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch (e) {
      /* leave the address alone */
    }
  } else if (link && link.type === SINGLE_CONFIRMATION_LINK) {
    // Same for the message of a half-finished email change: it is shown once
    // (App.jsx reads it from `authLink`), and the address is cleaned so a reload
    // doesn't show it again. Everything else in the query string is kept.
    try {
      const rest = new URLSearchParams(window.location.search);
      rest.delete("message");
      const query = rest.toString();
      window.history.replaceState(window.history.state, "", window.location.pathname + (query ? `?${query}` : ""));
    } catch (e) {
      /* leave the address alone */
    }
  }
  return link;
}

export const authLink = captureAuthLink();

// Does the app need the library right now, at startup? Yes when a session is
// saved on this device (to know who's signed in) or the person arrived from
// an invite or reset link. Otherwise not until someone opens sign-in.
export function needsBackendAtStartup() {
  // The half-finished email change message (Pass 130) arrives with no sign-in to
  // handle, so it doesn't need the library.
  return configured && (Boolean(authLink && !authLink.error && authLink.type !== SINGLE_CONFIRMATION_LINK) || hasStoredSession());
}

/* ------------------------------------------------------------------ */
/*  The library, loaded on demand                                      */
/* ------------------------------------------------------------------ */

let clientPromise = null;

// Resolves to the Supabase client, or null when no backend is configured or
// the library couldn't be loaded (for example, no connection the first time).
// The same client is returned on every call; a failed load is retried on the
// next call.
export function loadBackend() {
  if (!configured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => createClient(url, key))
      .catch((e) => {
        clientPromise = null;
        console.warn("MeasureOne: couldn't load the account service.", e);
        return null;
      });
  }
  return clientPromise;
}

/* ------------------------------------------------------------------ */
/*  Plain-language messages for what can go wrong                      */
/* ------------------------------------------------------------------ */

export const NO_CONNECTION_MESSAGE = "Couldn't reach the account service. Check your connection and try again.";
export const RESET_REQUESTED_MESSAGE = "If that address has an account, a reset link is on its way.";
export const EXPIRED_LINK_MESSAGE = "That link has expired or was already used. You can ask for a password reset link below.";

// The library reports a failed connection as an error with status 0 (or a
// 5xx from the service), and a missing library as no client at all.
export function isConnectionProblem(error) {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  if (typeof error.status === "number" && (error.status === 0 || error.status >= 500)) return true;
  if (error.status === undefined && /failed to fetch|network|load failed/i.test(String(error.message || ""))) return true;
  return false;
}

// Wrong email and wrong password get the same answer on purpose: the service
// doesn't say which was wrong, so this form can't be used to find out who has
// an account.
export function signInErrorMessage(error) {
  if (isConnectionProblem(error)) return NO_CONNECTION_MESSAGE;
  if (error && (error.code === "invalid_credentials" || error.status === 400)) {
    return "That email and password don't match. Check them and try again.";
  }
  return "Something went wrong signing in. Try again in a moment.";
}

export function setPasswordErrorMessage(error) {
  if (isConnectionProblem(error)) return NO_CONNECTION_MESSAGE;
  if (error && error.code === "weak_password") {
    return error.message ? String(error.message) : "Choose a longer, stronger password.";
  }
  if (error && error.code === "same_password") return "Choose a different password from your current one.";
  if (error && (error.name === "AuthSessionMissingError" || error.code === "session_not_found")) {
    return "That link has expired. Ask for a new one.";
  }
  return "Couldn't save your password. Try again in a moment.";
}

/* ------------------------------------------------------------------ */
/*  Account settings (Pass 113): change password, sign out everywhere  */
/* ------------------------------------------------------------------ */

export const REAUTHENTICATION_MESSAGE = "For your security, sign in again before changing your password.";
export const NOT_SIGNED_IN_MESSAGE = "You're not signed in any more. Sign in again to change your password.";
// Shown in the sign-in window when "Sign in again" is chosen from the change
// password window.
export const SIGN_IN_AGAIN_NOTICE = "Sign in again to change your password. Then choose Change password once more.";

// Supabase's "secure password change" setting (a dashboard setting) makes the
// service ask for a recent sign-in before it changes a password. It answers
// with the code `reauthentication_needed` ("Password update requires
// reauthentication"); matching the wording too covers a server that sends no
// code.
export function isReauthenticationNeeded(error) {
  if (!error) return false;
  if (error.code === "reauthentication_needed") return true;
  return /reauthenticat/i.test(String(error.message || ""));
}

// What went wrong saving a changed password, in plain words, and whether
// signing in again would put it right. The other problems (too short, the same
// as the current one, a failed connection) use the same words as choosing a
// password after an invitation or reset link; only the two that mean "not
// recently signed in" differ, because there is no link to ask for here.
export function changePasswordProblem(error) {
  if (isConnectionProblem(error)) return { message: NO_CONNECTION_MESSAGE, signInAgain: false };
  if (isReauthenticationNeeded(error)) return { message: REAUTHENTICATION_MESSAGE, signInAgain: true };
  if (error && (error.name === "AuthSessionMissingError" || error.code === "session_not_found")) {
    return { message: NOT_SIGNED_IN_MESSAGE, signInAgain: true };
  }
  return { message: setPasswordErrorMessage(error), signInAgain: false };
}

// What to tell someone after "Sign out of all devices" was tried. The library
// (in the version used here) signs this device out even when the service
// couldn't be told, and only reports an error then, so the words depend on two
// things: did the service take the request (`error`), and is this device signed
// out now (`signedOutHere`, read back from the library so this doesn't rely on
// that detail staying true). Other devices keep their sign-in until their
// current session runs out, up to an hour at Supabase's default. Always says
// nothing was deleted: signing out never touches a device's data.
export function describeSignOutAll({ error, signedOutHere }) {
  const noDelete = "Nothing was deleted from any device.";
  if (!error) {
    return {
      text: `You're signed out of all devices. Other devices can stay signed in for up to an hour. ${noDelete}`,
      problem: false,
    };
  }
  if (!signedOutHere) {
    return {
      text: isConnectionProblem(error)
        ? "Couldn't reach the account service, so nothing was changed. You're still signed in. Try again when you're connected."
        : "Couldn't sign out of all devices, so nothing was changed. You're still signed in. Try again in a moment.",
      problem: true,
    };
  }
  return {
    text: isConnectionProblem(error)
      ? `You're signed out on this device, but the account service couldn't be reached, so your other devices may still be signed in. Sign in and try again when you're connected. ${noDelete}`
      : `You're signed out on this device, but the account service didn't confirm signing out your other devices, so they may still be signed in. Sign in and try again. ${noDelete}`,
    problem: true,
  };
}

/* ------------------------------------------------------------------ */
/*  Change email and delete my account (Pass 130)                      */
/* ------------------------------------------------------------------ */

export const NOT_SIGNED_IN_EMAIL_MESSAGE = "You're not signed in any more. Sign in again to change your email.";
export const EMAIL_TAKEN_MESSAGE = "That address already has a MeasureOne account. Use a different address.";
export const EMAIL_INVALID_MESSAGE = "That doesn't look like a valid email address.";
export const EMAIL_SAME_MESSAGE = "That's already the email address on this account.";

// A plain shape check, not a proof the address works: the confirmation link sent
// to it is the proof. It only catches an obvious slip before a request is made.
export function isPlausibleEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || "").trim());
}

// Checks what was typed in the change-email window before anything is sent.
// { ok: true, email } with the address trimmed, or { ok: false, message }.
export function checkNewEmail({ current, typed }) {
  const email = String(typed || "").trim();
  if (!isPlausibleEmail(email)) return { ok: false, message: EMAIL_INVALID_MESSAGE };
  if (String(current || "").trim().toLowerCase() === email.toLowerCase()) return { ok: false, message: EMAIL_SAME_MESSAGE };
  return { ok: true, email };
}

// What went wrong asking the service to change the address, in plain words.
// The address-already-used answer is deliberately plain (the owner chose that on
// 2026-11-06, over the "same answer as any address" wording the sign-in forms
// use): it tells a signed-in person that an address has an account, which is
// fine while accounts are by invitation. Revisit it before open sign-up (Pass 135).
export function emailChangeProblem(error) {
  if (isConnectionProblem(error)) return NO_CONNECTION_MESSAGE;
  const code = error && error.code;
  if (code === "email_exists") return EMAIL_TAKEN_MESSAGE;
  if (code === "email_address_invalid") return EMAIL_INVALID_MESSAGE;
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || (error && error.status === 429)) {
    return "Too many emails were sent just now. Wait a few minutes and try again.";
  }
  if (error && (error.name === "AuthSessionMissingError" || code === "session_not_found" || error.status === 401)) {
    return NOT_SIGNED_IN_EMAIL_MESSAGE;
  }
  return "Couldn't start the email change. Try again in a moment.";
}

// What to say once the service has taken the request. It assumes Supabase's
// "secure email change" setting is on (it is on both projects: the link goes to
// the old address and the new one, and the change happens when both are opened).
export function describeEmailChangeRequested({ current, next }) {
  return (
    `We sent a confirmation link to ${next} and another to ${current}. Open both emails and press the button in each. ` +
    `Your address changes only after both are confirmed. Until then you still sign in with ${current}. ` +
    "If an email doesn't arrive, check the spam folder."
  );
}

// The notice shown after following an email-change link: `type` is the link's
// type (parseAuthLink), `email` the address the account has now (the new one,
// once the second link was opened). null for any other link.
export function describeEmailLinkNotice({ type, email }) {
  if (type === "email_change") {
    return {
      text: email
        ? `Your email address is now ${email}. Use it the next time you sign in.`
        : "Your email address is changed. Use the new one the next time you sign in.",
      problem: false,
    };
  }
  if (type === SINGLE_CONFIRMATION_LINK) {
    return {
      text: "That confirmation is done. The change finishes once you also open the email sent to your other address and confirm there.",
      problem: false,
    };
  }
  return null;
}

// Said before an account is deleted, and again once it is. One place for the
// sentence about the owner's separate daily backup: Pass 131 set how long that
// keeps data (about 30 days: each day's copy is a GitHub Actions artifact that
// GitHub deletes) and Pass 133's privacy policy (public/privacy.html, "Deleting")
// states it, so this says the same thing. Change both together. True only once the
// OLD backups repository (which kept every day forever) has been deleted.
export const DELETE_BACKUP_NOTE =
  "The service also keeps a separate daily backup of its data. Backup copies that include your email address and pieces are deleted within about 30 days.";

const DELETE_NOTHING = "Nothing was deleted.";

// Deletes the signed-in account, in the app's two steps (docs/Accounts-and-Backend.md,
// Phase 3 Design D, Pass 130):
//   1. check the password by signing in with it again (the database can't see a
//      password, so this is the app's own guard against a device left unlocked);
//   2. call the database function from migration 0003, which deletes only the caller's
//      own account (the pieces and technique rows go with it).
// Then this device is signed out locally. It never touches this device's pieces.
// `client` is the library's client (from loadBackend). Resolves to { status } and never
// rejects or logs the password:
//   "deleted"         the account is gone (also when the answer was lost but a read-back
//                     shows the account no longer exists)
//   "wrong-password"  the password was refused; nothing was deleted
//   "no-connection"   the service couldn't be reached while checking the password
//   "could-not-check" the password check failed for another reason (rate limit, ...)
//   "not-deleted"     the delete was refused or failed and the account still exists
//                     (`error` holds the reason, for the console)
//   "unsure"          the connection dropped and a read-back couldn't say either way
export async function deleteMyAccount({ client, email, password }) {
  if (!client) return { status: "no-connection" };
  try {
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn && signIn.error) {
      if (isConnectionProblem(signIn.error)) return { status: "no-connection" };
      if (signIn.error.code === "invalid_credentials" || signIn.error.status === 400) return { status: "wrong-password" };
      return { status: "could-not-check" };
    }
  } catch (e) {
    return { status: isConnectionProblem(e) ? "no-connection" : "could-not-check" };
  }

  let error = null;
  try {
    const result = await client.rpc("delete_my_account");
    error = (result && result.error) || null;
  } catch (e) {
    error = e || { name: "Error" };
  }

  if (!error) {
    await signOutQuietly(client);
    return { status: "deleted" };
  }
  // The call failed, but a lost answer is not proof the account is still there: ask.
  const state = await accountStillExists(client);
  if (state === "no") {
    await signOutQuietly(client);
    return { status: "deleted" };
  }
  if (state === "yes") return { status: "not-deleted", error };
  return { status: "unsure", error };
}

async function signOutQuietly(client) {
  try {
    // The library removes this device's sign-in before it tells the service, and the
    // service has no such account to tell, so an error here changes nothing.
    await client.auth.signOut({ scope: "local" });
  } catch (e) {
    /* signed out here either way */
  }
}

// "yes" | "no" | "unknown": does the signed-in account still exist? A deleted
// account's token is still well formed, and the service answers a read of it with
// `user_not_found` ("User from sub claim in JWT does not exist").
async function accountStillExists(client) {
  try {
    const { data, error } = await client.auth.getUser();
    if (!error && data && data.user) return "yes";
    if (error && (error.code === "user_not_found" || /sub claim in jwt does not exist|user not found/i.test(String(error.message || "")))) {
      return "no";
    }
  } catch (e) {
    /* can't tell */
  }
  return "unknown";
}

// What to tell the person after deleteMyAccount: { text, problem, deleted }.
export function describeDeleteAccount(result) {
  const status = result && result.status;
  if (status === "deleted") {
    return {
      deleted: true,
      problem: false,
      text:
        "Your account is deleted, along with the copy of your pieces and technique library it kept online. " +
        "The pieces and technique on this device are still here, and you're signed out. " +
        "Other devices that were signed in to this account are signed out within about an hour and keep their own copies. " +
        DELETE_BACKUP_NOTE,
    };
  }
  const say = (text) => ({ deleted: false, problem: true, text });
  if (status === "wrong-password") return say(`That password isn't right. Check it and try again. ${DELETE_NOTHING}`);
  if (status === "no-connection") return say(`Couldn't reach the account service, so nothing was deleted. Check your connection and try again.`);
  if (status === "could-not-check") return say(`Couldn't check your password just now. ${DELETE_NOTHING} Try again in a moment.`);
  if (status === "not-deleted") return say(`Couldn't delete your account. ${DELETE_NOTHING} Try again in a moment.`);
  if (status === "signed-out") return say(`You're not signed in any more. ${DELETE_NOTHING} Sign in again to delete your account.`);
  if (status === "unsure") {
    return say(
      "The connection dropped before we could confirm whether your account was deleted. Wait a minute, then try to sign in with your email and password. " +
        "If they no longer work, the account is deleted."
    );
  }
  return say("Something went wrong. Try again in a moment.");
}
