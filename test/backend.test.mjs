// src/lib/backend.js: the first tests for the file (Pass 130; it had none before).
// Covers the plain-language messages, how a link in the address is read (including
// the half-finished email change added in Pass 130), the change-email checks and
// wording, and the delete-my-account sequence against a stand-in for the library's
// client. Nothing here reaches a network: the library itself is never loaded.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NO_CONNECTION_MESSAGE,
  EMAIL_INVALID_MESSAGE,
  EMAIL_SAME_MESSAGE,
  NOT_SIGNED_IN_EMAIL_MESSAGE,
  SINGLE_CONFIRMATION_LINK,
  DELETE_BACKUP_NOTE,
  isConnectionProblem,
  signInErrorMessage,
  setPasswordErrorMessage,
  changePasswordProblem,
  describeSignOutAll,
  parseAuthLink,
  isSingleConfirmationMessage,
  isPlausibleEmail,
  checkNewEmail,
  emailChangeProblem,
  describeEmailChangeRequested,
  describeEmailLinkNotice,
  deleteMyAccount,
  describeDeleteAccount,
  isBackendConfigured,
  // Pass 135
  SIGNUP_LINK,
  BOT_CHECK_FAILED_MESSAGE,
  BOT_CHECK_UNAVAILABLE_MESSAGE,
  SIGNUP_CHECK_EMAIL_MESSAGE,
  SIGNUP_NEED_AGE_MESSAGE,
  SIGNUP_NEED_TERMS_MESSAGE,
  SIGNUP_PASSWORDS_DIFFER_MESSAGE,
  SIGNUP_PASSWORD_SHORT_MESSAGE,
  SIGNUPS_CLOSED_MESSAGE,
  SIGNUP_RATE_LIMIT_MESSAGE,
  SIGNUP_NOT_ACCEPTED_MESSAGE,
  SIGNUP_FAILED_MESSAGE,
  WELCOME_NEW_ACCOUNT_MESSAGE,
  EXPIRED_SIGNUP_HINT,
  EXPIRED_LINK_MESSAGE,
  TURNSTILE_SCRIPT_URL,
  isCaptchaFailure,
  isEmailTakenError,
  changeEmailOutcome,
  botCheckSiteKey,
  isBotCheckConfigured,
  botCheckBlocksSubmit,
  captchaOptions,
  passwordResetOptions,
  loadTurnstile,
  parseSignupSettings,
  canOfferSignUp,
  readSignupSettings,
  getSignupSettings,
  checkSignUpForm,
  describeSignUpResult,
  signUpWithEmail,
} from "../src/lib/backend.js";

const fetchFailure = { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" };
const SINGLE = "Confirmation link accepted. Please proceed to confirm link sent to the other email";

describe("the backend is off under test", () => {
  test("no connection settings means nothing account-related can run", () => {
    assert.equal(isBackendConfigured(), false);
  });
});

describe("plain-language messages", () => {
  test("a failed connection is recognised from the library's errors", () => {
    assert.equal(isConnectionProblem(fetchFailure), true);
    assert.equal(isConnectionProblem({ status: 503 }), true);
    assert.equal(isConnectionProblem({ message: "Failed to fetch" }), true);
    assert.equal(isConnectionProblem({ status: 400, code: "invalid_credentials" }), false);
    assert.equal(isConnectionProblem(null), false);
  });

  test("a wrong email and a wrong password get one message, so the form can't say who has an account", () => {
    assert.equal(signInErrorMessage({ code: "invalid_credentials", status: 400 }), signInErrorMessage({ status: 400 }));
    assert.match(signInErrorMessage({ code: "invalid_credentials" }), /don't match/);
    assert.equal(signInErrorMessage(fetchFailure), NO_CONNECTION_MESSAGE);
    assert.match(signInErrorMessage({ status: 429 }), /Something went wrong/);
  });

  test("password messages", () => {
    assert.equal(setPasswordErrorMessage(fetchFailure), NO_CONNECTION_MESSAGE);
    assert.equal(setPasswordErrorMessage({ code: "weak_password", message: "Use 8 characters" }), "Use 8 characters");
    assert.match(setPasswordErrorMessage({ code: "weak_password" }), /longer/);
    assert.match(setPasswordErrorMessage({ code: "same_password" }), /different password/);
    assert.match(setPasswordErrorMessage({ name: "AuthSessionMissingError" }), /expired/);
    assert.match(setPasswordErrorMessage({}), /Couldn't save your password/);
  });

  test("changing a password: only 'sign in again' problems offer signing in again", () => {
    assert.equal(changePasswordProblem({ code: "reauthentication_needed" }).signInAgain, true);
    assert.equal(changePasswordProblem({ message: "Password update requires reauthentication" }).signInAgain, true);
    assert.equal(changePasswordProblem({ name: "AuthSessionMissingError" }).signInAgain, true);
    assert.equal(changePasswordProblem(fetchFailure).signInAgain, false);
    assert.equal(changePasswordProblem({ code: "same_password" }).signInAgain, false);
  });

  test("signing out of all devices says what really happened", () => {
    assert.equal(describeSignOutAll({ error: null, signedOutHere: true }).problem, false);
    assert.match(describeSignOutAll({ error: fetchFailure, signedOutHere: false }).text, /still signed in/);
    assert.match(describeSignOutAll({ error: fetchFailure, signedOutHere: true }).text, /other devices may still be signed in/);
    // when this device did get signed out, it says plainly that signing out deletes nothing
    for (const r of [
      describeSignOutAll({ error: null, signedOutHere: true }),
      describeSignOutAll({ error: {}, signedOutHere: true }),
    ]) assert.match(r.text, /Nothing was deleted from any device/);
    // and when nothing happened at all, that nothing changed
    assert.match(describeSignOutAll({ error: {}, signedOutHere: false }).text, /nothing was changed/);
  });
});

describe("reading a link in the address", () => {
  test("nothing in the address is an ordinary visit", () => {
    assert.equal(parseAuthLink(""), null);
    assert.equal(parseAuthLink(undefined), null);
    assert.equal(parseAuthLink("#"), null);
    assert.equal(parseAuthLink("#section=2"), null);
    assert.equal(parseAuthLink("", "?utm=1"), null);
  });

  test("a working link reports its type", () => {
    assert.deepEqual(parseAuthLink("#access_token=a&refresh_token=b&type=invite"), { type: "invite", error: null });
    assert.deepEqual(parseAuthLink("#access_token=a&type=recovery"), { type: "recovery", error: null });
    assert.deepEqual(parseAuthLink("#access_token=a&refresh_token=b&type=email_change"), { type: "email_change", error: null });
  });

  test("an expired or used link reports the problem and no type", () => {
    const link = parseAuthLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    assert.equal(link.type, null);
    assert.equal(link.error.code, "otp_expired");
    assert.match(link.error.description, /expired/);
  });

  test("[Pass 130] the first of the two email-change confirmations comes back with only a message", () => {
    const inHash = parseAuthLink(`#message=${encodeURIComponent(SINGLE)}`);
    assert.equal(inHash.type, SINGLE_CONFIRMATION_LINK);
    assert.equal(inHash.error, null);
    const inQuery = parseAuthLink("", `?message=${encodeURIComponent(SINGLE)}`);
    assert.equal(inQuery.type, SINGLE_CONFIRMATION_LINK);
    // and the plus-for-space form Supabase's redirects use
    assert.equal(parseAuthLink("#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email").type, SINGLE_CONFIRMATION_LINK);
  });

  test("[Pass 130] a message that is not that one is left alone, and an error or a working link wins over a message", () => {
    assert.equal(parseAuthLink("#message=Hello+there"), null);
    assert.equal(parseAuthLink("", "?message=Something+else"), null);
    assert.equal(parseAuthLink(`#error=access_denied&message=${encodeURIComponent(SINGLE)}`).type, null);
    assert.equal(parseAuthLink(`#access_token=a&type=invite&message=${encodeURIComponent(SINGLE)}`).type, "invite");
  });

  test("the single-confirmation message is matched loosely (either half)", () => {
    assert.equal(isSingleConfirmationMessage(SINGLE), true);
    assert.equal(isSingleConfirmationMessage("Confirmation link accepted."), true);
    assert.equal(isSingleConfirmationMessage("please confirm link sent to the other email"), true);
    assert.equal(isSingleConfirmationMessage("Welcome back"), false);
    assert.equal(isSingleConfirmationMessage(null), false);
  });
});

describe("[Pass 130] changing the email address", () => {
  test("a plausible address", () => {
    assert.equal(isPlausibleEmail("a@b.co"), true);
    assert.equal(isPlausibleEmail("  a@b.co "), true);
    for (const bad of ["", "a", "a@b", "a b@c.d", "@b.co", "a@@b.co"]) assert.equal(isPlausibleEmail(bad), false, bad);
  });

  test("checkNewEmail trims, rejects a slip and rejects the address already on the account (any case)", () => {
    assert.deepEqual(checkNewEmail({ current: "me@x.org", typed: "  new@x.org " }), { ok: true, email: "new@x.org" });
    assert.deepEqual(checkNewEmail({ current: "me@x.org", typed: "nope" }), { ok: false, message: EMAIL_INVALID_MESSAGE });
    assert.deepEqual(checkNewEmail({ current: "me@x.org", typed: "ME@X.org" }), { ok: false, message: EMAIL_SAME_MESSAGE });
    assert.deepEqual(checkNewEmail({ current: "", typed: "" }), { ok: false, message: EMAIL_INVALID_MESSAGE });
  });

  test("what the service can answer, in plain words", () => {
    assert.equal(emailChangeProblem(fetchFailure), NO_CONNECTION_MESSAGE);
    // [Pass 135] a taken address is no longer a problem the window shows: see changeEmailOutcome
    assert.equal(changeEmailOutcome({ code: "email_exists", status: 422 }).requested, true);
    assert.equal(emailChangeProblem({ code: "email_address_invalid" }), EMAIL_INVALID_MESSAGE);
    assert.match(emailChangeProblem({ code: "over_email_send_rate_limit", status: 429 }), /Too many emails/);
    assert.match(emailChangeProblem({ status: 429 }), /Too many emails/);
    assert.equal(emailChangeProblem({ name: "AuthSessionMissingError" }), NOT_SIGNED_IN_EMAIL_MESSAGE);
    assert.equal(emailChangeProblem({ code: "session_not_found" }), NOT_SIGNED_IN_EMAIL_MESSAGE);
    assert.match(emailChangeProblem({ code: "something_new" }), /Couldn't start the email change/);
    assert.match(emailChangeProblem(null), /Couldn't start the email change/);
  });

  test("once requested, the words name both addresses and say the change waits for both", () => {
    const text = describeEmailChangeRequested({ current: "old@x.org", next: "new@x.org" });
    assert.match(text, /new@x\.org/);
    assert.match(text, /old@x\.org/);
    assert.match(text, /only after both are confirmed/);
    assert.match(text, /still sign in with old@x\.org/);
    // [Pass 135] true whether or not the new address could be used
    assert.match(text, /^If new@x\.org can be used, we sent/);
  });

  test("the notice after following a link", () => {
    assert.match(describeEmailLinkNotice({ type: "email_change", email: "new@x.org" }).text, /now new@x\.org/);
    assert.match(describeEmailLinkNotice({ type: "email_change", email: "" }).text, /is changed/);
    assert.match(describeEmailLinkNotice({ type: SINGLE_CONFIRMATION_LINK }).text, /other address/);
    assert.equal(describeEmailLinkNotice({ type: "invite" }), null);
    assert.equal(describeEmailLinkNotice({ type: "recovery" }), null);
  });
});

// A stand-in for the library's client: records every call in order, and answers each
// with whatever the test set up. It never loads or contacts anything.
function fakeClient(opts = {}) {
  const calls = [];
  const client = {
    calls,
    auth: {
      signInWithPassword: async (args) => {
        calls.push(["signIn", args]);
        if (opts.signInThrows) throw opts.signInThrows;
        return { data: {}, error: opts.signInError || null };
      },
      getUser: async () => {
        calls.push(["getUser"]);
        if (opts.getUserThrows) throw opts.getUserThrows;
        return opts.getUser || { data: { user: { id: "u1" } }, error: null };
      },
      signOut: async (args) => {
        calls.push(["signOut", args]);
        if (opts.signOutThrows) throw opts.signOutThrows;
        return { error: null };
      },
    },
    rpc: async (...args) => {
      calls.push(["rpc", ...args]);
      if (opts.rpcThrows) throw opts.rpcThrows;
      return { data: null, error: opts.rpcError || null };
    },
  };
  return client;
}
const names = (client) => client.calls.map((c) => c[0]);

describe("[Pass 130] deleting the account", () => {
  test("the happy path: password checked first, then the database function, then signed out here only", async () => {
    const client = fakeClient();
    const result = await deleteMyAccount({ client, email: "me@x.org", password: "pw-123456" });
    assert.deepEqual(result, { status: "deleted" });
    assert.deepEqual(names(client), ["signIn", "rpc", "signOut"]);
    assert.deepEqual(client.calls[0][1], { email: "me@x.org", password: "pw-123456" });
    // the function takes no argument: there is nowhere to name anyone else's account
    assert.deepEqual(client.calls[1], ["rpc", "delete_my_account"]);
    assert.deepEqual(client.calls[2][1], { scope: "local" });
  });

  test("[regression, Pass 130] a wrong password deletes nothing: the database function is never called", async () => {
    const client = fakeClient({ signInError: { code: "invalid_credentials", status: 400 } });
    const result = await deleteMyAccount({ client, email: "me@x.org", password: "wrong" });
    assert.equal(result.status, "wrong-password");
    assert.deepEqual(names(client), ["signIn"]);
  });

  test("no connection while checking the password deletes nothing", async () => {
    for (const opts of [{ signInError: fetchFailure }, { signInThrows: Object.assign(new Error("Failed to fetch"), {}) }]) {
      const client = fakeClient(opts);
      const result = await deleteMyAccount({ client, email: "me@x.org", password: "pw" });
      assert.equal(result.status, "no-connection");
      assert.deepEqual(names(client), ["signIn"]);
    }
    assert.equal((await deleteMyAccount({ client: null, email: "a", password: "b" })).status, "no-connection");
  });

  test("another kind of sign-in failure (a rate limit) is 'could not check', nothing deleted", async () => {
    const client = fakeClient({ signInError: { status: 429, code: "over_request_rate_limit" } });
    const result = await deleteMyAccount({ client, email: "me@x.org", password: "pw" });
    assert.equal(result.status, "could-not-check");
    assert.deepEqual(names(client), ["signIn"]);
  });

  test("the database refusing the delete: the account is read back, found, and this device stays signed in", async () => {
    const client = fakeClient({ rpcError: { code: "PGRST202", status: 404, message: "Could not find the function" } });
    const result = await deleteMyAccount({ client, email: "me@x.org", password: "pw" });
    assert.equal(result.status, "not-deleted");
    assert.equal(result.error.code, "PGRST202");
    assert.deepEqual(names(client), ["signIn", "rpc", "getUser"]);
  });

  test("a lost answer is not a failure when the read-back shows the account is gone", async () => {
    const client = fakeClient({
      rpcError: fetchFailure,
      getUser: { data: { user: null }, error: { code: "user_not_found", status: 403, message: "User from sub claim in JWT does not exist" } },
    });
    const result = await deleteMyAccount({ client, email: "me@x.org", password: "pw" });
    assert.deepEqual(result, { status: "deleted" });
    assert.deepEqual(names(client), ["signIn", "rpc", "getUser", "signOut"]);
  });

  test("a dropped connection that can't be read back is reported as unsure, and nobody is signed out", async () => {
    const client = fakeClient({ rpcError: fetchFailure, getUser: { data: { user: null }, error: fetchFailure } });
    const result = await deleteMyAccount({ client, email: "me@x.org", password: "pw" });
    assert.equal(result.status, "unsure");
    assert.deepEqual(names(client), ["signIn", "rpc", "getUser"]);
    const thrown = fakeClient({ rpcThrows: new Error("boom"), getUserThrows: new Error("boom") });
    assert.equal((await deleteMyAccount({ client: thrown, email: "a", password: "b" })).status, "unsure");
  });

  test("a failing sign-out afterwards doesn't undo the deletion", async () => {
    const client = fakeClient({ signOutThrows: new Error("nope") });
    assert.deepEqual(await deleteMyAccount({ client, email: "me@x.org", password: "pw" }), { status: "deleted" });
  });

  test("the password never appears in a result", async () => {
    const secret = "very-secret-pw-9";
    for (const opts of [{}, { signInError: { code: "invalid_credentials" } }, { rpcError: { message: "x" } }, { rpcError: fetchFailure, getUser: { data: {}, error: fetchFailure } }]) {
      const result = await deleteMyAccount({ client: fakeClient(opts), email: "me@x.org", password: secret });
      assert.equal(JSON.stringify(result).includes(secret), false);
      assert.equal(JSON.stringify(describeDeleteAccount(result)).includes(secret), false);
    }
  });

  test("what the person is told, for every outcome", () => {
    const done = describeDeleteAccount({ status: "deleted" });
    assert.equal(done.deleted, true);
    assert.equal(done.problem, false);
    assert.match(done.text, /still here/);
    assert.match(done.text, /signed out/);
    assert.ok(done.text.includes(DELETE_BACKUP_NOTE));
    for (const status of ["wrong-password", "no-connection", "bot-check-failed", "could-not-check", "not-deleted", "signed-out", "unsure", "mystery"]) {
      const said = describeDeleteAccount({ status });
      assert.equal(said.deleted, false, status);
      assert.equal(said.problem, true, status);
    }
    // every message that means "it did not happen" says nothing was deleted
    for (const status of ["wrong-password", "no-connection", "bot-check-failed", "could-not-check", "not-deleted", "signed-out"]) {
      assert.match(describeDeleteAccount({ status }).text, /nothing was deleted/i, status);
    }
    // and the unsure one says how to find out
    assert.match(describeDeleteAccount({ status: "unsure" }).text, /no longer work, the account is deleted/);
  });

  test("no em dashes in any wording added here", () => {
    const all = [
      EMAIL_INVALID_MESSAGE, EMAIL_SAME_MESSAGE, NOT_SIGNED_IN_EMAIL_MESSAGE, DELETE_BACKUP_NOTE,
      describeEmailChangeRequested({ current: "a@b.co", next: "c@d.co" }),
      describeEmailLinkNotice({ type: "email_change", email: "c@d.co" }).text,
      describeEmailLinkNotice({ type: SINGLE_CONFIRMATION_LINK }).text,
      emailChangeProblem({ status: 429 }), emailChangeProblem({}),
      ...["deleted", "wrong-password", "no-connection", "could-not-check", "not-deleted", "signed-out", "unsure", "x"].map((status) => describeDeleteAccount({ status }).text),
    ];
    for (const text of all) assert.equal(text.includes("—"), false, text);
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 135: open sign-up and the bot check                           */
/* ------------------------------------------------------------------ */

// What Supabase answers when the bot check is missing: a 400, like a wrong password.
const captchaRefusal = { code: "captcha_failed", status: 400, message: "captcha protection: request disallowed (no captcha_token found)" };

// What the service's public settings really looked like on production on 2026-11-12
// (sign-ups off, confirmation emails on), trimmed to the fields the app reads.
const settingsOff = { external: { anonymous_users: false, email: true, phone: false }, disable_signup: true, mailer_autoconfirm: false, phone_autoconfirm: false };
const settingsOn = { ...settingsOff, disable_signup: false };

describe("[Pass 135] the confirmation link", () => {
  test("the link type is 'signup' and is read from the address like any other", () => {
    assert.equal(SIGNUP_LINK, "signup");
    assert.deepEqual(parseAuthLink("#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=signup"), { type: "signup", error: null });
    assert.equal(parseAuthLink("#access_token=a&type=signup").type, SIGNUP_LINK);
  });

  test("the person arrives with a short welcome, and no other link type gets that welcome", () => {
    assert.deepEqual(describeEmailLinkNotice({ type: SIGNUP_LINK, email: "me@x.org" }), { text: WELCOME_NEW_ACCOUNT_MESSAGE, problem: false });
    assert.match(WELCOME_NEW_ACCOUNT_MESSAGE, /confirmed and you're signed in/);
    assert.equal(describeEmailLinkNotice({ type: "invite" }), null);
    assert.equal(describeEmailLinkNotice({ type: "recovery" }), null);
  });

  test("an expired confirmation link is an expired link: no type, the existing note, and a way to get another", () => {
    const link = parseAuthLink("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    assert.equal(link.type, null);
    assert.match(EXPIRED_LINK_MESSAGE, /expired or was already used/);
    assert.match(EXPIRED_SIGNUP_HINT, /Create an account/);
    assert.match(EXPIRED_SIGNUP_HINT, /same address again/);
  });
});

describe("[Pass 135] the sign-up answer is the same for every address", () => {
  const newAddress = { data: { user: { id: "u1", identities: [{ provider: "email" }] }, session: null }, error: null };
  // Supabase answers an address that already has a confirmed account with a look-alike
  // success: a user with no identities. It must read exactly like a new address.
  const existingAddress = { data: { user: { id: "u2", identities: [] }, session: null }, error: null };

  test("[regression, Pass 135] a new address, an existing one, and one the service reports as registered all get the one sentence", () => {
    const answers = [
      describeSignUpResult(newAddress),
      describeSignUpResult(existingAddress),
      describeSignUpResult({ data: { user: null, session: null }, error: { code: "user_already_exists", status: 422 } }),
      describeSignUpResult({ data: { user: null, session: null }, error: { code: "email_exists", status: 422 } }),
    ];
    for (const a of answers) {
      assert.equal(a.kind, "check-email");
      assert.equal(a.message, SIGNUP_CHECK_EMAIL_MESSAGE);
    }
    assert.equal(SIGNUP_CHECK_EMAIL_MESSAGE, "Check your email to confirm your account.");
  });

  test("[regression, Pass 135] 'too many emails' reads like any other address: it is refused for a new address but not for one that has an account", () => {
    // If this were said plainly, using up the hourly email limit and then trying addresses
    // would show who has an account (they alone would still get the usual answer).
    for (const error of [
      { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" },
      { code: "over_email_send_rate_limit", status: 429, message: "For security purposes, you can only request this after 42 seconds." },
      { status: 429 },
      { code: "something_new", status: 422 },
      { code: "unexpected_failure", status: 422 },
    ]) {
      const said = describeSignUpResult({ data: { user: null, session: null }, error });
      assert.equal(said.kind, "check-email", JSON.stringify(error));
      assert.equal(said.message, SIGNUP_CHECK_EMAIL_MESSAGE);
      // and the reason is kept for the console, as the service's code only
      assert.equal(typeof said.unexpected, "string");
    }
    assert.equal(describeSignUpResult({ error: { code: "over_email_send_rate_limit", status: 429 } }).unexpected, "over_email_send_rate_limit");
    assert.equal("unexpected" in describeSignUpResult(newAddress), false);
  });

  test("through the real call: the same client answers give the same result, and the token goes in options", async () => {
    const clientFor = (result) => {
      const calls = [];
      return { calls, auth: { signUp: async (args) => { calls.push(args); return result; } } };
    };
    const a = clientFor(newAddress);
    const b = clientFor(existingAddress);
    const ra = await signUpWithEmail({ client: a, email: "new@x.org", password: "pw-123456", captchaToken: "tok", redirectTo: "https://measureone.app/" });
    const rb = await signUpWithEmail({ client: b, email: "old@x.org", password: "pw-123456", captchaToken: "tok", redirectTo: "https://measureone.app/" });
    assert.deepEqual(ra, rb);
    assert.deepEqual(a.calls[0], { email: "new@x.org", password: "pw-123456", options: { emailRedirectTo: "https://measureone.app/", captchaToken: "tok" } });
    // no token (the bot check not in use): no captchaToken key at all
    const c = clientFor(newAddress);
    await signUpWithEmail({ client: c, email: "n@x.org", password: "pw-123456", redirectTo: "https://measureone.app/" });
    assert.equal("captchaToken" in c.calls[0].options, false);
  });

  test("what the person can act on is said plainly, and none of it depends on whether an address has an account", () => {
    assert.equal(describeSignUpResult({ error: fetchFailure }).message, NO_CONNECTION_MESSAGE);
    assert.deepEqual(describeSignUpResult({ error: captchaRefusal }), { kind: "problem", message: BOT_CHECK_FAILED_MESSAGE });
    assert.deepEqual(describeSignUpResult({ error: { code: "signup_disabled", status: 422 } }), { kind: "closed", message: SIGNUPS_CLOSED_MESSAGE });
    assert.equal(describeSignUpResult({ error: { code: "email_address_invalid", status: 400 } }).message, EMAIL_INVALID_MESSAGE);
    assert.equal(describeSignUpResult({ error: { code: "validation_failed", status: 400 } }).message, SIGNUP_NOT_ACCEPTED_MESSAGE);
    assert.equal(describeSignUpResult({ error: { code: "weak_password", message: "Use 8 characters" } }).message, "Use 8 characters");
    assert.match(describeSignUpResult({ error: { code: "weak_password" } }).message, /longer/);
    // too many requests from one network is about the network, not the address
    assert.deepEqual(describeSignUpResult({ error: { code: "over_request_rate_limit", status: 429 } }), { kind: "problem", message: SIGNUP_RATE_LIMIT_MESSAGE });
    assert.deepEqual(describeSignUpResult(null), { kind: "check-email", message: SIGNUP_CHECK_EMAIL_MESSAGE });
  });

  test("a sign-up that signs the person in at once is not told to check their email", () => {
    assert.deepEqual(describeSignUpResult({ data: { user: { id: "u" }, session: { access_token: "x" } }, error: null }), { kind: "signed-in", message: "" });
  });

  test("a throwing library, or no library at all, never rejects and reads as no connection or a plain failure", async () => {
    assert.deepEqual(await signUpWithEmail({ client: null, email: "a@b.co", password: "pw-123456" }), { kind: "problem", message: NO_CONNECTION_MESSAGE });
    const thrown = { auth: { signUp: async () => { throw Object.assign(new Error("Failed to fetch"), {}); } } };
    assert.equal((await signUpWithEmail({ client: thrown, email: "a@b.co", password: "pw-123456" })).message, NO_CONNECTION_MESSAGE);
    const odd = { auth: { signUp: async () => { throw new Error("boom"); } } };
    assert.equal((await signUpWithEmail({ client: odd, email: "a@b.co", password: "pw-123456" })).message, SIGNUP_FAILED_MESSAGE);
  });

  test("the password never appears in an answer", async () => {
    const secret = "very-secret-pw-9";
    for (const result of [{ error: null, data: {} }, { error: captchaRefusal }, { error: fetchFailure }, { error: { code: "weak_password", message: "weak" } }]) {
      const client = { auth: { signUp: async () => result } };
      assert.equal(JSON.stringify(await signUpWithEmail({ client, email: "a@b.co", password: secret })).includes(secret), false);
    }
  });
});

describe("[Pass 135] both boxes are required, and the passwords must match", () => {
  const good = { email: " me@x.org ", password: "pw-123456", again: "pw-123456", age: true, terms: true };

  test("a complete form is accepted, with the address trimmed", () => {
    assert.deepEqual(checkSignUpForm(good), { ok: true, email: "me@x.org" });
  });

  test("[regression, Pass 135] without 'I'm 13 or older' it is refused, and without the Terms box it is refused", () => {
    assert.deepEqual(checkSignUpForm({ ...good, age: false }), { ok: false, message: SIGNUP_NEED_AGE_MESSAGE });
    assert.deepEqual(checkSignUpForm({ ...good, terms: false }), { ok: false, message: SIGNUP_NEED_TERMS_MESSAGE });
    assert.deepEqual(checkSignUpForm({ ...good, age: false, terms: false }).ok, false);
    assert.deepEqual(checkSignUpForm({ ...good, age: undefined }).ok, false);
    assert.deepEqual(checkSignUpForm({ ...good, terms: null }).ok, false);
    // only a real yes counts for both
    assert.equal(checkSignUpForm({ ...good, age: true, terms: true }).ok, true);
  });

  test("a slip in the address or the passwords is caught first", () => {
    assert.deepEqual(checkSignUpForm({ ...good, email: "nope" }), { ok: false, message: EMAIL_INVALID_MESSAGE });
    assert.deepEqual(checkSignUpForm({ ...good, password: "short", again: "short" }), { ok: false, message: SIGNUP_PASSWORD_SHORT_MESSAGE });
    assert.deepEqual(checkSignUpForm({ ...good, again: "pw-1234567" }), { ok: false, message: SIGNUP_PASSWORDS_DIFFER_MESSAGE });
    assert.equal(checkSignUpForm({ ...good, password: "", again: "" }).ok, false);
    assert.equal(checkSignUpForm({}).ok, false);
  });

  test("the 13 and the Terms words are the ones the owner approved", () => {
    assert.match(SIGNUP_NEED_AGE_MESSAGE, /13 or older/);
    assert.match(SIGNUP_NEED_TERMS_MESSAGE, /Terms and the Privacy Policy/);
  });
});

describe("[Pass 135] the form shows only while sign-ups are on", () => {
  test("[regression, Pass 135] production's real answer with sign-ups off hides the form", () => {
    const settings = parseSignupSettings(settingsOff);
    assert.deepEqual(settings, { signupsOpen: false, confirmationRequired: true });
    assert.equal(canOfferSignUp(settings, true), false);
  });

  test("it is offered only when sign-ups are open AND confirmation emails are required AND the bot check is configured", () => {
    const on = parseSignupSettings(settingsOn);
    assert.deepEqual(on, { signupsOpen: true, confirmationRequired: true });
    assert.equal(canOfferSignUp(on, true), true);
    assert.equal(canOfferSignUp(on, false), false); // no bot check, no form
    // confirmation emails off: an existing address would answer differently, so no form
    assert.equal(canOfferSignUp(parseSignupSettings({ ...settingsOn, mailer_autoconfirm: true }), true), false);
    // the email provider off: nothing to confirm with
    assert.equal(canOfferSignUp(parseSignupSettings({ ...settingsOn, external: { email: false } }), true), false);
  });

  test("an answer that can't be understood never turns the form on", () => {
    for (const bad of [null, undefined, "x", 7, {}, { disable_signup: "false", mailer_autoconfirm: false }, { disable_signup: false }, { mailer_autoconfirm: false }]) {
      assert.equal(parseSignupSettings(bad), null);
      assert.equal(canOfferSignUp(parseSignupSettings(bad), true), false);
    }
    assert.equal(canOfferSignUp(null, true), false);
  });

  test("the read asks the settings address with the public key only, and any failure means 'not offered'", async () => {
    const seen = [];
    const ok = async (u, init) => { seen.push([u, init]); return { ok: true, json: async () => settingsOn }; };
    const result = await readSignupSettings({ fetchFn: ok, baseUrl: "https://abc.supabase.co/", apiKey: "sb_publishable_xyz" });
    assert.deepEqual(result, { signupsOpen: true, confirmationRequired: true });
    assert.deepEqual(seen, [["https://abc.supabase.co/auth/v1/settings", { headers: { apikey: "sb_publishable_xyz" } }]]);
    const failures = [
      async () => ({ ok: false, status: 401, json: async () => ({}) }),
      // a refused request is not believed even if its body happens to say "open"
      async () => ({ ok: false, status: 500, json: async () => settingsOn }),
      async () => { throw new Error("Failed to fetch"); },
      async () => ({ ok: true, json: async () => { throw new Error("not json"); } }),
      async () => ({ ok: true, json: async () => ({ hello: 1 }) }),
    ];
    for (const fetchFn of failures) assert.equal(await readSignupSettings({ fetchFn, baseUrl: "https://abc.supabase.co", apiKey: "k" }), null);
    // nothing to ask without a project address and key
    assert.equal(await readSignupSettings({ fetchFn: ok, baseUrl: "", apiKey: "k" }), null);
    assert.equal(await readSignupSettings({ fetchFn: ok, baseUrl: "https://abc.supabase.co", apiKey: "" }), null);
  });

  test("under test (no account service configured) nothing is read and nothing is offered", async () => {
    assert.equal(await getSignupSettings(), null);
    assert.equal(isBotCheckConfigured(), false);
    assert.equal(botCheckSiteKey(), "");
  });
});

describe("[Pass 135] the bot check reaches every call the service guards", () => {
  test("[regression, Pass 135] a refused bot check is never reported as a wrong password", () => {
    assert.equal(isCaptchaFailure(captchaRefusal), true);
    assert.equal(isCaptchaFailure({ message: "captcha verification process failed", status: 500 }), true);
    assert.equal(isCaptchaFailure({ code: "invalid_credentials", status: 400 }), false);
    assert.equal(isCaptchaFailure(null), false);
    assert.equal(signInErrorMessage(captchaRefusal), BOT_CHECK_FAILED_MESSAGE);
    assert.match(signInErrorMessage({ code: "invalid_credentials", status: 400 }), /don't match/);
    // a failed connection still reads as one, even though its message may name anything
    assert.equal(signInErrorMessage(fetchFailure), NO_CONNECTION_MESSAGE);
  });

  test("the token is passed the way the library wants it, and left out when there is none", () => {
    assert.deepEqual(captchaOptions("tok"), { options: { captchaToken: "tok" } });
    assert.deepEqual(captchaOptions(""), {});
    assert.deepEqual(captchaOptions(undefined), {});
    assert.deepEqual(passwordResetOptions("https://measureone.app/", "tok"), { redirectTo: "https://measureone.app/", captchaToken: "tok" });
    assert.deepEqual(passwordResetOptions("https://measureone.app/", ""), { redirectTo: "https://measureone.app/" });
  });

  test("deleting an account sends the token with the password re-check, and a refused bot check deletes nothing", async () => {
    const ok = fakeClient();
    await deleteMyAccount({ client: ok, email: "me@x.org", password: "pw-123456", captchaToken: "tok" });
    assert.deepEqual(ok.calls[0][1], { email: "me@x.org", password: "pw-123456", options: { captchaToken: "tok" } });
    const refused = fakeClient({ signInError: captchaRefusal });
    const result = await deleteMyAccount({ client: refused, email: "me@x.org", password: "pw-123456" });
    assert.equal(result.status, "bot-check-failed");
    assert.deepEqual(names(refused), ["signIn"]); // the database function was never called
    const said = describeDeleteAccount(result);
    assert.match(said.text, /bot check/);
    assert.match(said.text, /nothing was deleted/i);
    assert.equal(said.problem, true);
    assert.equal(said.deleted, false);
  });

  test("the submit button waits only while the widget is still working", () => {
    assert.equal(botCheckBlocksSubmit("working"), true);
    for (const status of ["ready", "off", "unavailable", undefined]) assert.equal(botCheckBlocksSubmit(status), false, String(status));
  });
});

describe("[Pass 135] the bot check's script is fetched only when a window needs it", () => {
  // loadTurnstile reaches for window and document; give it small stand-ins, and take them away again.
  const realWindow = globalThis.window;
  const realDocument = globalThis.document;
  const makePage = () => {
    const appended = [];
    const page = {
      appended,
      window: {},
      document: {
        createElement: () => ({ remove() { this.removed = true; } }),
        head: { appendChild: (el) => appended.push(el) },
      },
    };
    globalThis.window = page.window;
    globalThis.document = page.document;
    return page;
  };
  const restore = () => {
    if (realWindow === undefined) delete globalThis.window; else globalThis.window = realWindow;
    if (realDocument === undefined) delete globalThis.document; else globalThis.document = realDocument;
  };

  test("no page, no script (server-side or tests): nothing is fetched", async () => {
    assert.equal(await loadTurnstile(), null);
  });

  // One test, in this order, because the loader remembers a successful load for the life of the page.
  test("a failed load, or a script that offers no widget, resolves to null and is tried again; a good load resolves to the widget API", async () => {
    try {
      const page = makePage();
      const first = loadTurnstile();
      assert.equal(page.appended.length, 1);
      assert.equal(page.appended[0].src, TURNSTILE_SCRIPT_URL);
      assert.match(TURNSTILE_SCRIPT_URL, /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
      page.appended[0].onerror();
      assert.equal(await first, null);
      assert.equal(page.appended[0].removed, true);

      // tried again, not remembered as failed; this time the script loads but offers no widget
      const second = loadTurnstile();
      assert.equal(page.appended.length, 2);
      page.appended[1].onload();
      assert.equal(await second, null);

      // tried again once more; now it works
      const third = loadTurnstile();
      assert.equal(page.appended.length, 3);
      page.window.turnstile = { render() {} };
      page.appended[2].onload();
      assert.equal(await third, page.window.turnstile);

      // once there, no further script is added
      assert.equal(await loadTurnstile(), page.window.turnstile);
      assert.equal(page.appended.length, 3);
    } finally {
      restore();
    }
  });
});

describe("[Pass 135] changing the email: a taken address gets the same screen as any other", () => {
  test("[regression, Pass 135] the service's 'already registered' answer and a plain success lead to the same screen", () => {
    assert.deepEqual(changeEmailOutcome(null), { requested: true });
    assert.deepEqual(changeEmailOutcome({ code: "email_exists", status: 422 }), { requested: true });
    assert.equal(isEmailTakenError({ code: "email_exists" }), true);
    assert.equal(isEmailTakenError({ code: "email_address_invalid" }), false);
    assert.equal(isEmailTakenError(null), false);
  });

  test("real problems are still said plainly", () => {
    assert.deepEqual(changeEmailOutcome(fetchFailure), { requested: false, message: NO_CONNECTION_MESSAGE });
    assert.equal(changeEmailOutcome({ code: "email_address_invalid" }).message, EMAIL_INVALID_MESSAGE);
    assert.equal(changeEmailOutcome({ name: "AuthSessionMissingError" }).message, NOT_SIGNED_IN_EMAIL_MESSAGE);
    assert.equal(changeEmailOutcome({ status: 429 }).requested, false);
  });

  test("the screen for a requested change never claims an email was sent to the new address for certain", () => {
    const text = describeEmailChangeRequested({ current: "old@x.org", next: "new@x.org" });
    assert.equal(/^We sent a confirmation link to new@x/.test(text), false);
    assert.match(text, /can be used/);
  });
});

describe("[Pass 135] no em dashes in any wording added here", () => {
  test("none of the new sentences holds one", () => {
    const all = [
      BOT_CHECK_FAILED_MESSAGE, BOT_CHECK_UNAVAILABLE_MESSAGE, SIGNUP_CHECK_EMAIL_MESSAGE, SIGNUP_NEED_AGE_MESSAGE, SIGNUP_NEED_TERMS_MESSAGE,
      SIGNUP_PASSWORDS_DIFFER_MESSAGE, SIGNUP_PASSWORD_SHORT_MESSAGE, SIGNUPS_CLOSED_MESSAGE, SIGNUP_RATE_LIMIT_MESSAGE, SIGNUP_NOT_ACCEPTED_MESSAGE, SIGNUP_FAILED_MESSAGE,
      WELCOME_NEW_ACCOUNT_MESSAGE, EXPIRED_SIGNUP_HINT, describeDeleteAccount({ status: "bot-check-failed" }).text,
    ];
    for (const text of all) assert.equal(text.includes("—"), false, text);
  });
});
