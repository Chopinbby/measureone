// src/lib/backend.js: the first tests for the file (Pass 130; it had none before).
// Covers the plain-language messages, how a link in the address is read (including
// the half-finished email change added in Pass 130), the change-email checks and
// wording, and the delete-my-account sequence against a stand-in for the library's
// client. Nothing here reaches a network: the library itself is never loaded.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NO_CONNECTION_MESSAGE,
  EMAIL_TAKEN_MESSAGE,
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
    assert.equal(emailChangeProblem({ code: "email_exists", status: 422 }), EMAIL_TAKEN_MESSAGE);
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
    for (const status of ["wrong-password", "no-connection", "could-not-check", "not-deleted", "signed-out", "unsure", "mystery"]) {
      const said = describeDeleteAccount({ status });
      assert.equal(said.deleted, false, status);
      assert.equal(said.problem, true, status);
    }
    // every message that means "it did not happen" says nothing was deleted
    for (const status of ["wrong-password", "no-connection", "could-not-check", "not-deleted", "signed-out"]) {
      assert.match(describeDeleteAccount({ status }).text, /nothing was deleted/i, status);
    }
    // and the unsure one says how to find out
    assert.match(describeDeleteAccount({ status: "unsure" }).text, /no longer work, the account is deleted/);
  });

  test("no em dashes in any wording added here", () => {
    const all = [
      EMAIL_TAKEN_MESSAGE, EMAIL_INVALID_MESSAGE, EMAIL_SAME_MESSAGE, NOT_SIGNED_IN_EMAIL_MESSAGE, DELETE_BACKUP_NOTE,
      describeEmailChangeRequested({ current: "a@b.co", next: "c@d.co" }),
      describeEmailLinkNotice({ type: "email_change", email: "c@d.co" }).text,
      describeEmailLinkNotice({ type: SINGLE_CONFIRMATION_LINK }).text,
      emailChangeProblem({ status: 429 }), emailChangeProblem({}),
      ...["deleted", "wrong-password", "no-connection", "could-not-check", "not-deleted", "signed-out", "unsure", "x"].map((status) => describeDeleteAccount({ status }).text),
    ];
    for (const text of all) assert.equal(text.includes("—"), false, text);
  });
});
