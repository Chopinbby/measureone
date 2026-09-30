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
// - a working link: { type: "invite" | "recovery" | ..., error: null }
// - an expired or already used link: { type: null, error: { code, description } }
// The library reports a password-reset link by name (PASSWORD_RECOVERY) but an
// invitation only as an ordinary sign-in, so the app has to read `type` itself,
// before the library removes it from the address.
export function parseAuthLink(hash) {
  const text = typeof hash === "string" ? hash.replace(/^#/, "") : "";
  if (!text) return null;
  const params = new URLSearchParams(text);
  const errorCode = params.get("error_code");
  const errorName = params.get("error");
  const errorDescription = params.get("error_description");
  if (errorCode || errorName || errorDescription) {
    return { type: null, error: { code: errorCode || errorName || "unknown", description: errorDescription || "" } };
  }
  if (params.get("access_token") && params.get("type")) {
    return { type: params.get("type"), error: null };
  }
  return null;
}

// Read once, when this file first loads, which is before anything can load
// the library (and so before the library removes the link from the address).
function captureAuthLink() {
  if (!configured || typeof window === "undefined") return null;
  const link = parseAuthLink(window.location.hash);
  if (link && link.error) {
    // The library won't be asked to handle a failed link, so clear it from the
    // address here, so a reload doesn't show the same message again.
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
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
  return configured && (Boolean(authLink && !authLink.error) || hasStoredSession());
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
