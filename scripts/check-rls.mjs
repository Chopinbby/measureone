#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  MeasureOne: the account service's security checks (Pass 114).      */
/*                                                                     */
/*  Rebuilt from the checks run by hand in Pass 108 (27 of 27 passed   */
/*  on the test project), as a script that can be run against ANY      */
/*  MeasureOne project, test or production:                            */
/*                                                                     */
/*      node scripts/check-rls.mjs                                     */
/*                                                                     */
/*  It is NOT part of the app: nothing in src/ imports it, so it is    */
/*  never in what a visitor downloads. It uses the project's PUBLIC    */
/*  key only (the "publishable" key), exactly what the app itself      */
/*  uses, signs in as TWO THROWAWAY ACCOUNTS, and checks from the      */
/*  outside that the database's rules hold:                            */
/*                                                                     */
/*    - signed out, nothing can be read, added, changed or deleted     */
/*    - each account can add, read and change its OWN rows             */
/*    - an account cannot read, add, change, move to, or delete        */
/*      anyone else's rows, and nobody can delete a row at all         */
/*    - the database keeps each row's revision count (migration 0002)  */
/*    - a sign-up without a valid bot-check token is refused (by the   */
/*      bot check, or because sign-ups are off), and anonymous         */
/*      sign-ins are switched off (Pass 135)                           */
/*    - "delete my account" (migration 0003): a signed-out visitor     */
/*      cannot call it, and when account A calls it, A's account and   */
/*      rows are gone, A cannot sign in or add rows any more, and B's  */
/*      account and rows are untouched. THIS DELETES ACCOUNT A: it is  */
/*      the last group on purpose, and a throwaway is all it is for.   */
/*                                                                     */
/*  Safety, on purpose:                                                */
/*    - It refuses a secret key (sb_secret_..., or an old key whose    */
/*      role is service_role). Never give it one.                      */
/*    - It refuses any account that already holds pieces or technique  */
/*      data, so it can't write test rows into a real account.         */
/*    - It refuses any account whose address does not START WITH       */
/*      "rls-check" (for example rls-check-a@example.com), before it   */
/*      signs in to anything. The last group DELETES account A, and    */
/*      "holds no data" is not proof of a throwaway (a newly invited   */
/*      person's account is empty too).                                */
/*    - Every row it writes is named "RLS check ..." with an id that   */
/*      starts "rls-check-", and belongs to a throwaway account. It    */
/*      cannot delete them (no one can): deleting the two accounts in  */
/*      the dashboard removes every row they own.                      */
/*    - It never prints a password or a key.                           */
/*                                                                     */
/*  A "must be refused" check passes only when the database REFUSES    */
/*  (a permission error) and the row is unchanged afterwards, and the  */
/*  checks are ordered so that a missing rule would let the attempt    */
/*  succeed instead of failing for some other reason (for example the  */
/*  technique table's one-row-per-account rule).                       */
/*                                                                     */
/*  The bot check (Pass 135). Once a project's bot check ("Enable       */
/*  CAPTCHA protection") is on, the service asks for a token on every  */
/*  password sign-in, this script's included, and a real token can     */
/*  only be made in a browser. So:                                     */
/*    - TEST project (its bot check uses Cloudflare's published TEST   */
/*      secret key, which accepts Cloudflare's published dummy token): */
/*      run with --dummy-token.                                        */
/*    - PRODUCTION (a real secret key): the full run only works while  */
/*      the bot check is switched OFF. Run it before switching the bot */
/*      check on; afterwards, `--bot-check` asks the service, with no  */
/*      account at all, whether a sign-in and a sign-up without a      */
/*      token are refused. See DEPLOYMENT.md, "Open sign-up".          */
/*                                                                     */
/*  Setup: create the two throwaway accounts in the project's          */
/*  dashboard (Authentication > Users > Add user), run this, then      */
/*  delete the account(s) still there (A is deleted by the check of    */
/*  migration 0003 itself; B stays). See docs/Accounts-and-Backend.md. */
/* ------------------------------------------------------------------ */

import readline from "node:readline";
import { pathToFileURL } from "node:url";

export const ROW_PREFIX = "rls-check-";

// The check deletes account A and writes test rows into both accounts, so both must be
// accounts made for this: an address whose part before the @ starts with this (any letter
// case), e.g. rls-check-a@example.com. Not proof an account is a throwaway, but a real
// person's address will not start this way, and the emptiness check below can't tell a
// newly invited person's empty account from a throwaway.
export const THROWAWAY_PREFIX = "rls-check";
export function isThrowawayEmail(email) {
  const text = String(email || "").trim();
  return text.includes("@") && text.split("@")[0].toLowerCase().startsWith(THROWAWAY_PREFIX);
}

// Something wrong with the setup (a wrong password, an account that isn't
// empty), as opposed to a security check that failed.
export class SetupProblem extends Error {}

// Cloudflare's published dummy token: what its TEST site keys produce, accepted only by
// its TEST secret keys (a real secret key rejects it). Public, and no use against a real
// project. Read from developers.cloudflare.com/turnstile/troubleshooting/testing, 2026-11-12.
export const DUMMY_BOT_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

// The service refused a call because the bot-check token was missing or not accepted
// ("captcha protection: request disallowed (...)", a 400). Not the same thing as a wrong
// password or sign-ups being off, and the checks below must tell them apart.
export const isBotCheckRefusal = (error) => !!(error && (error.code === "captcha_failed" || /captcha/i.test(String(error.message || error.msg || ""))));

// Sign-ups are switched off for the project.
const isSignupsOff = (error) => !!(error && (error.code === "signup_disabled" || /signups? not allowed|signups? (are )?disabled|not allowed for this instance/i.test(String(error.message || error.msg || ""))));

/* ---- small helpers ------------------------------------------------ */

const rand = () => Math.random().toString(36).slice(2, 10);
const messageOf = (e) => String((e && (e.message || e.msg)) || e || "unknown problem").slice(0, 220);

// How an error reads in a report: its code (if any) and its words.
const why = (error) => (error ? `${error.code ? error.code + ": " : ""}${messageOf(error)}` : "no error");

// The database said no: Postgres's "insufficient privilege" (42501, which is
// both "permission denied" and "violates row-level security") or HTTP 401/403.
// Any other error (a duplicate, a missing column) is NOT a refusal by the rules.
export const refused = (r) => !!(r && r.error && (r.error.code === "42501" || r.status === 401 || r.status === 403));

export function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!domain) return "(no address)";
  return `${name.slice(0, 2)}***@${domain}`;
}

export function projectRefFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const m = u.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

// null when the key looks like the PUBLIC key; otherwise why it was refused.
export function keyProblem(key) {
  if (!key) return "no key was given";
  if (/^sb_secret_/.test(key)) return "that is a SECRET key. Never use one here: it bypasses every security rule being checked. Use the public (publishable) key";
  if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) return null;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(key)) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
      if (payload.role === "anon") return null;
      return `that key's role is "${payload.role}", not "anon". Use the public key`;
    } catch (e) {
      return "that doesn't look like a valid key";
    }
  }
  return "that doesn't look like the public key (it should start with sb_publishable_, or be the older \"anon\" key)";
}

/* ---- the checks --------------------------------------------------- */

// createClient: supabase-js's (or a stand-in with the same shape, for testing
// this script). accountA / accountB: { email, password }, two throwaway
// accounts. log: called with each result as it comes in. botToken: sent with every
// password sign-in when given (see "The bot check" at the top); never with the probes that
// check a call WITHOUT a token is refused.
// Returns { results: [{ n, group, title, ok, detail }], botCheck }, where botCheck says
// what refused the sign-up probe: "on" (the bot check), "off" (only sign-ups being
// switched off: the bot check is not guarding sign-up) or "unknown".
export async function runChecks({ createClient, url, key, accountA, accountB, botToken = "", log = () => {} }) {
  // First of all, before anything signs in: only accounts made for this. The last group deletes A.
  for (const [label, account] of [["A", accountA], ["B", accountB]]) {
    if (!isThrowawayEmail(account.email)) {
      throw new SetupProblem(
        `Account ${label} (${maskEmail(account.email)}) doesn't look like a throwaway account: its address must start with "${THROWAWAY_PREFIX}" ` +
          `(for example ${THROWAWAY_PREFIX}-${label.toLowerCase()}@example.com). The last group of checks DELETES account A and test rows are written into both, ` +
          "so this script will not run against any other address."
      );
    }
  }
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const anon = createClient(url, key, opts);
  const ca = createClient(url, key, opts);
  const cb = createClient(url, key, opts);
  const probe = createClient(url, key, opts);

  const withToken = botToken ? { options: { captchaToken: botToken } } : {};
  const signIn = async (client, account, label) => {
    const r = await client.auth.signInWithPassword({ email: account.email, password: account.password, ...withToken });
    if (r.error && isBotCheckRefusal(r.error)) {
      throw new SetupProblem(
        `Couldn't sign in as account ${label} (${maskEmail(account.email)}): this project's bot check is on and ${botToken ? "did not accept the token given" : "no token was given"}. ` +
          "On the TEST project (Cloudflare's test secret key) run again with --dummy-token. " +
          "On PRODUCTION the full check only runs while the bot check is switched off; with it on, use --bot-check (see DEPLOYMENT.md, \"Open sign-up\")."
      );
    }
    if (r.error || !r.data || !r.data.user) {
      throw new SetupProblem(
        `Couldn't sign in as account ${label} (${maskEmail(account.email)}): ${messageOf(r.error)}. ` +
          "Check the address and password, and that the account was created with \"Auto Confirm User\" ticked."
      );
    }
    return r.data.user.id;
  };
  const idA = await signIn(ca, accountA, "A");
  const idB = await signIn(cb, accountB, "B");
  if (idA === idB) throw new SetupProblem("Accounts A and B are the same account. Use two different throwaway accounts.");

  // A throwaway account is an EMPTY account. Refuse anything else, so this can
  // never write test rows into someone's real data.
  for (const [label, client] of [["A", ca], ["B", cb]]) {
    for (const table of ["pieces", "technique"]) {
      const r = await client.from(table).select("user_id").limit(1);
      if (r.error) throw new SetupProblem(`Couldn't read the "${table}" table as account ${label}: ${why(r.error)}. Were the migration files run?`);
      if (r.data && r.data.length > 0) {
        throw new SetupProblem(
          `Account ${label} already has rows in "${table}", so it isn't a throwaway account. Nothing was written. ` +
            "Create two NEW accounts for this check and delete them afterwards."
        );
      }
    }
  }

  const results = [];
  let n = 0;
  const check = async (group, title, fn) => {
    n += 1;
    let ok = false;
    let detail = "";
    try {
      const r = await fn();
      ok = !!(r && r.ok);
      detail = (r && r.detail) || "";
    } catch (e) {
      ok = false;
      detail = `the check itself failed to run: ${messageOf(e)}`;
    }
    const result = { n, group, title, ok, detail };
    results.push(result);
    log(result);
  };
  const verdict = (ok, detailIfNot) => ({ ok: !!ok, detail: ok ? "" : detailIfNot });

  // The rows each account writes. Names are remembered so a later check can tell
  // whether a row was changed by someone who shouldn't have been able to.
  const pa = `${ROW_PREFIX}a-${rand()}`; // A's main piece
  const pa2 = `${ROW_PREFIX}a2-${rand()}`; // A's second piece, for the last-changed-time check
  const pb = `${ROW_PREFIX}b-${rand()}`; // B's piece
  const nameA = "RLS check A piece";
  const nameB = "RLS check B piece";
  const techNameB = "RLS check B technique";
  const mark = (name) => ({ name, note: "Throwaway row written by scripts/check-rls.mjs" });
  const mine = { pa: null, techA: null, revisionStep: null };

  const rowOf = async (client, table, filters, cols = "*") => {
    let q = client.from(table).select(cols);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    return q;
  };
  const rowsIn = (r) => (r && Array.isArray(r.data) ? r.data : []);

  /* -- your own rows work -------------------------------------------- */
  const OWN = "Signed in: your own rows work";
  await check(OWN, "A can add a piece of its own", async () => {
    const r = await ca.from("pieces").insert({ user_id: idA, id: pa, data: mark(nameA), revision: 99 }).select();
    mine.pa = rowsIn(r)[0];
    return verdict(!r.error && mine.pa && mine.pa.user_id === idA, `the add was refused or came back wrong (${why(r.error)})`);
  });
  await check(OWN, "A can read that piece back", async () => {
    const r = await rowOf(ca, "pieces", { user_id: idA, id: pa });
    return verdict(!r.error && rowsIn(r).length === 1 && rowsIn(r)[0].data.name === nameA, `couldn't read its own piece (${why(r.error)})`);
  });
  await check(OWN, "A can change it", async () => {
    const r = await ca.from("pieces").update({ data: mark(`${nameA} (changed)`) }).eq("user_id", idA).eq("id", pa).select();
    return verdict(!r.error && rowsIn(r).length === 1, `couldn't change its own piece (${why(r.error)})`);
  });
  await check(OWN, "A can mark it deleted, and the row stays", async () => {
    const r = await ca.from("pieces").update({ deleted_at: new Date().toISOString() }).eq("user_id", idA).eq("id", pa).select();
    const after = await rowOf(ca, "pieces", { user_id: idA, id: pa });
    return verdict(!r.error && rowsIn(after).length === 1 && rowsIn(after)[0].deleted_at, `marking a piece deleted didn't work, or the row went away (${why(r.error)})`);
  });
  await check(OWN, "B can add a piece of its own", async () => {
    const r = await cb.from("pieces").insert({ user_id: idB, id: pb, data: mark(nameB) }).select();
    return verdict(!r.error && rowsIn(r).length === 1, `B's add was refused (${why(r.error)})`);
  });
  await check(OWN, "A can add its technique row", async () => {
    const r = await ca.from("technique").insert({ user_id: idA, data: mark("RLS check A technique"), revision: 99 }).select();
    mine.techA = rowsIn(r)[0];
    return verdict(!r.error && mine.techA && mine.techA.user_id === idA, `the add was refused or came back wrong (${why(r.error)})`);
  });
  await check(OWN, "A can read its technique row back", async () => {
    const r = await rowOf(ca, "technique", { user_id: idA });
    return verdict(!r.error && rowsIn(r).length === 1, `couldn't read its own technique row (${why(r.error)})`);
  });
  await check(OWN, "A can change its technique row", async () => {
    const r = await ca.from("technique").update({ data: mark("RLS check A technique (changed)") }).eq("user_id", idA).select();
    return verdict(!r.error && rowsIn(r).length === 1, `couldn't change its own technique row (${why(r.error)})`);
  });

  /* -- nobody else's rows -------------------------------------------- */
  const OTHERS = "Signed in: nobody else's rows";
  await check(OTHERS, "A cannot read B's pieces", async () => {
    const direct = await rowOf(ca, "pieces", { user_id: idB });
    const all = await ca.from("pieces").select("user_id");
    const seesB = rowsIn(all).some((r) => r.user_id === idB);
    return verdict(!direct.error && rowsIn(direct).length === 0 && !seesB, `A could see B's pieces (${rowsIn(direct).length} asked for directly; listed in a full read: ${seesB})`);
  });
  await check(OTHERS, "A cannot add a piece in B's name", async () => {
    const id = `${ROW_PREFIX}forged-${rand()}`;
    const r = await ca.from("pieces").insert({ user_id: idB, id, data: mark("forged by A") }).select();
    const seen = await rowOf(cb, "pieces", { id });
    return verdict(refused(r) && !seen.error && rowsIn(seen).length === 0, `the add in B's name was not refused by the rules (${why(r.error)}; B ${rowsIn(seen).length ? "now has the row" : "doesn't have it"})`);
  });
  await check(OTHERS, "A cannot change B's piece", async () => {
    const r = await ca.from("pieces").update({ data: mark("changed by A") }).eq("user_id", idB).eq("id", pb).select();
    const after = await rowOf(cb, "pieces", { id: pb });
    const unchanged = rowsIn(after).length === 1 && rowsIn(after)[0].data.name === nameB;
    return verdict(unchanged && rowsIn(r).length === 0, `B's piece was changed by A (rows reported: ${rowsIn(r).length}; B's piece is now named "${rowsIn(after)[0] ? rowsIn(after)[0].data.name : "?"}")`);
  });
  await check(OTHERS, "A cannot move its own piece to B", async () => {
    const r = await ca.from("pieces").update({ user_id: idB }).eq("user_id", idA).eq("id", pa).select();
    const stillA = await rowOf(ca, "pieces", { user_id: idA, id: pa });
    const bSees = await rowOf(cb, "pieces", { id: pa });
    return verdict(refused(r) && rowsIn(stillA).length === 1 && rowsIn(bSees).length === 0, `the move was not refused by the rules (${why(r.error)}; still A's: ${rowsIn(stillA).length === 1}; B has it: ${rowsIn(bSees).length > 0})`);
  });
  // B has no technique row yet, on purpose: if a rule were missing, these two
  // attempts would SUCCEED here instead of failing on "one row per account".
  await check(OTHERS, "A cannot add a technique row in B's name", async () => {
    const r = await ca.from("technique").insert({ user_id: idB, data: mark("forged by A") }).select();
    const seen = await rowOf(cb, "technique", { user_id: idB });
    return verdict(refused(r) && !seen.error && rowsIn(seen).length === 0, `the add in B's name was not refused by the rules (${why(r.error)}; B ${rowsIn(seen).length ? "now has a row" : "has none"})`);
  });
  await check(OTHERS, "A cannot move its own technique row to B", async () => {
    const r = await ca.from("technique").update({ user_id: idB }).eq("user_id", idA).select();
    const stillA = await rowOf(ca, "technique", { user_id: idA });
    const bSees = await rowOf(cb, "technique", { user_id: idB });
    return verdict(refused(r) && rowsIn(stillA).length === 1 && rowsIn(bSees).length === 0, `the move was not refused by the rules (${why(r.error)}; still A's: ${rowsIn(stillA).length === 1}; B has it: ${rowsIn(bSees).length > 0})`);
  });
  await check(OTHERS, "B can add its own technique row", async () => {
    const r = await cb.from("technique").insert({ user_id: idB, data: mark(techNameB) }).select();
    return verdict(!r.error && rowsIn(r).length === 1, `B's add was refused (${why(r.error)})`);
  });
  await check(OTHERS, "A cannot read B's technique row", async () => {
    const direct = await rowOf(ca, "technique", { user_id: idB });
    const all = await ca.from("technique").select("user_id");
    const seesB = rowsIn(all).some((r) => r.user_id === idB);
    return verdict(!direct.error && rowsIn(direct).length === 0 && !seesB, "A could see B's technique row");
  });
  await check(OTHERS, "A cannot change B's technique row", async () => {
    const r = await ca.from("technique").update({ data: mark("changed by A") }).eq("user_id", idB).select();
    const after = await rowOf(cb, "technique", { user_id: idB });
    const unchanged = rowsIn(after).length === 1 && rowsIn(after)[0].data.name === techNameB;
    return verdict(unchanged && rowsIn(r).length === 0, "B's technique row was changed by A");
  });

  /* -- nobody can delete --------------------------------------------- */
  const NODEL = "Signed in: nobody can delete a row";
  await check(NODEL, "A cannot delete its own piece", async () => {
    const r = await ca.from("pieces").delete().eq("user_id", idA).eq("id", pa).select();
    const after = await rowOf(ca, "pieces", { user_id: idA, id: pa });
    return verdict(refused(r) && rowsIn(after).length === 1, `the delete was not refused by the rules (${why(r.error)}) or the row is gone`);
  });
  await check(NODEL, "A cannot delete B's piece", async () => {
    const r = await ca.from("pieces").delete().eq("user_id", idB).eq("id", pb).select();
    const after = await rowOf(cb, "pieces", { id: pb });
    return verdict(rowsIn(r).length === 0 && rowsIn(after).length === 1, "B's piece was deleted by A");
  });
  await check(NODEL, "A cannot delete its own technique row", async () => {
    const r = await ca.from("technique").delete().eq("user_id", idA).select();
    const after = await rowOf(ca, "technique", { user_id: idA });
    return verdict(refused(r) && rowsIn(after).length === 1, `the delete was not refused by the rules (${why(r.error)}) or the row is gone`);
  });
  await check(NODEL, "A cannot delete B's technique row", async () => {
    const r = await ca.from("technique").delete().eq("user_id", idB).select();
    const after = await rowOf(cb, "technique", { user_id: idB });
    return verdict(rowsIn(r).length === 0 && rowsIn(after).length === 1, "B's technique row was deleted by A");
  });

  /* -- signed out: nothing at all ------------------------------------ */
  const OUT = "Signed out: nothing at all";
  for (const table of ["pieces", "technique"]) {
    const isPieces = table === "pieces";
    await check(OUT, `a signed-out visitor cannot read ${table}`, async () => {
      const r = await anon.from(table).select("user_id").limit(1);
      const none = rowsIn(r).length === 0;
      return verdict(refused(r) && none, r.error ? `it was not refused by the rules, or a row came back (${why(r.error)})` : "it returned an empty list instead of refusing, so signed-out visitors still have permission on this table (the rules hold, but Pass 108 required no permission at all)");
    });
    await check(OUT, `a signed-out visitor cannot add to ${table}`, async () => {
      const id = `${ROW_PREFIX}anon-${rand()}`;
      const row = isPieces ? { user_id: idA, id, data: mark("forged by a signed-out visitor") } : { user_id: idB, data: mark("forged by a signed-out visitor") };
      const r = await anon.from(table).insert(row).select();
      const seen = isPieces ? await rowOf(ca, "pieces", { id }) : await rowOf(cb, "technique", { user_id: idB });
      const intact = isPieces ? rowsIn(seen).length === 0 : rowsIn(seen).length === 1 && rowsIn(seen)[0].data.name === techNameB;
      return verdict(refused(r) && intact, `the add was not refused by the rules (${why(r.error)})`);
    });
    await check(OUT, `a signed-out visitor cannot change ${table}`, async () => {
      const q = anon.from(table).update({ data: mark("changed by a signed-out visitor") });
      const r = await (isPieces ? q.eq("user_id", idA).eq("id", pa) : q.eq("user_id", idA)).select();
      const after = isPieces ? await rowOf(ca, "pieces", { user_id: idA, id: pa }) : await rowOf(ca, "technique", { user_id: idA });
      const unchanged = rowsIn(after).length === 1 && !/signed-out visitor/.test(JSON.stringify(rowsIn(after)[0].data));
      return verdict(refused(r) && unchanged, `the change was not refused by the rules (${why(r.error)}) or the row changed`);
    });
    await check(OUT, `a signed-out visitor cannot delete from ${table}`, async () => {
      const q = anon.from(table).delete();
      const r = await (isPieces ? q.eq("user_id", idA).eq("id", pa) : q.eq("user_id", idA)).select();
      const after = isPieces ? await rowOf(ca, "pieces", { user_id: idA, id: pa }) : await rowOf(ca, "technique", { user_id: idA });
      return verdict(refused(r) && rowsIn(after).length === 1, `the delete was not refused by the rules (${why(r.error)}) or the row is gone`);
    });
  }

  /* -- the revision rule (migration 0002) ---------------------------- */
  const REV = "The database keeps the revision count (migration 0002)";
  await check(REV, "a new piece starts at revision 1, even if the request says 99", async () => {
    // (A's first piece was added asking for 99, in the first group.)
    return verdict(mine.pa && Number(mine.pa.revision) === 1, `it was stored at revision ${mine.pa ? mine.pa.revision : "?"}. Was migration 0002 run?`);
  });
  await check(REV, "a changed piece goes up by exactly one, even if the request tries to set it", async () => {
    const before = await rowOf(ca, "pieces", { user_id: idA, id: pa }, "revision");
    const r = await ca.from("pieces").update({ data: mark(`${nameA} (again)`), revision: 50 }).eq("user_id", idA).eq("id", pa).select();
    const was = rowsIn(before)[0] ? Number(rowsIn(before)[0].revision) : NaN;
    const now = rowsIn(r)[0] ? Number(rowsIn(r)[0].revision) : NaN;
    mine.revisionStep = { was, now };
    return verdict(now === was + 1, `revision went from ${was} to ${now} (should be ${was + 1}). Was migration 0002 run?`);
  });
  await check(REV, "'only if still at revision N' changes nothing once the row has moved on", async () => {
    if (!mine.revisionStep || !Number.isFinite(mine.revisionStep.was)) return { ok: false, detail: "needs the check before it to have read a revision" };
    const r = await ca.from("pieces").update({ data: mark("should not be written") }).eq("user_id", idA).eq("id", pa).eq("revision", mine.revisionStep.was).select();
    const after = await rowOf(ca, "pieces", { user_id: idA, id: pa });
    return verdict(!r.error && rowsIn(r).length === 0 && rowsIn(after).length === 1 && !/should not be written/.test(JSON.stringify(rowsIn(after)[0].data)), "a change aimed at an old revision still went through");
  });
  await check(REV, "a change moves the last-changed time forward", async () => {
    const ins = await ca.from("pieces").insert({ user_id: idA, id: pa2, data: mark("RLS check A second piece") }).select();
    const t0 = rowsIn(ins)[0] && Date.parse(rowsIn(ins)[0].updated_at);
    await new Promise((res) => setTimeout(res, 50));
    const r = await ca.from("pieces").update({ data: mark("RLS check A second piece (changed)") }).eq("user_id", idA).eq("id", pa2).select();
    const t1 = rowsIn(r)[0] && Date.parse(rowsIn(r)[0].updated_at);
    return verdict(t0 && t1 && t1 > t0, `the time did not move forward (${ins.error ? why(ins.error) : ""}${r.error ? why(r.error) : ""})`);
  });
  await check(REV, "a new technique row starts at revision 1, even if the request says 99", async () => {
    return verdict(mine.techA && Number(mine.techA.revision) === 1, `it was stored at revision ${mine.techA ? mine.techA.revision : "?"}. Was migration 0002 run?`);
  });
  await check(REV, "a changed technique row goes up by exactly one, even if the request tries to set it", async () => {
    const before = await rowOf(ca, "technique", { user_id: idA }, "revision");
    const r = await ca.from("technique").update({ data: mark("RLS check A technique (again)"), revision: 50 }).eq("user_id", idA).select();
    const was = rowsIn(before)[0] ? Number(rowsIn(before)[0].revision) : NaN;
    const now = rowsIn(r)[0] ? Number(rowsIn(r)[0].revision) : NaN;
    return verdict(now === was + 1, `revision went from ${was} to ${now} (should be ${was + 1}). Was migration 0002 run?`);
  });

  /* -- sign-in settings ---------------------------------------------- */
  const SIGNIN = "Sign-in settings";
  // Pass 135: open sign-up is allowed, so what must hold is that a sign-up with NO bot-check
  // token is refused: by the bot check when it is on, or because sign-ups are switched off.
  // Which of the two it was is kept (`botCheck`) and said at the end of the run, because
  // "refused only because sign-ups are off" means nothing would stop automated sign-ups the
  // moment they are switched on.
  let botCheck = "unknown";
  await check(SIGNIN, "a sign-up without a valid bot-check token is refused", async () => {
    const email = `rls-check-signup-probe-${rand()}@example.invalid`;
    const r = await probe.auth.signUp({ email, password: `${rand()}${rand()}Aa1!` }); // no token, on purpose
    if (!r.error && r.data && r.data.user) {
      return {
        ok: false,
        detail:
          `a sign-up with no bot-check token WENT THROUGH: an account was created for ${email}. Switch the bot check on ` +
          "(the project's Authentication settings, \"Enable CAPTCHA protection\") or switch sign-ups off (Authentication > Sign In / Providers), and delete that account.",
      };
    }
    if (isBotCheckRefusal(r.error)) {
      botCheck = "on";
      return verdict(true, "");
    }
    if (isSignupsOff(r.error)) {
      botCheck = "off";
      return verdict(true, "");
    }
    return verdict(false, `the sign-up probe failed, but not because of the bot check and not because sign-ups are off (${why(r.error)})`);
  });
  await check(SIGNIN, "anonymous sign-ins are switched off", async () => {
    if (typeof probe.auth.signInAnonymously !== "function") return { ok: false, detail: "this version of the library can't try an anonymous sign-in" };
    // With the bot check on, a probe with no token is stopped by the bot check before the
    // service says whether anonymous sign-ins are allowed, so the token (when there is one)
    // goes with it: the answer wanted here is "disabled", not "no token".
    const r = await probe.auth.signInAnonymously(withToken);
    if (!r.error && r.data && r.data.user) {
      return { ok: false, detail: "an anonymous sign-in WENT THROUGH. Switch anonymous sign-ins off (Authentication > Sign In / Providers) and delete that anonymous user." };
    }
    if (isBotCheckRefusal(r.error)) {
      return { ok: false, detail: "couldn't tell: the probe was stopped by the bot check before the service said whether anonymous sign-ins are allowed" };
    }
    const off = r.error && (r.error.code === "anonymous_provider_disabled" || /anonymous sign-ins? (are )?disabled/i.test(messageOf(r.error)));
    return verdict(off, `the anonymous sign-in probe failed, but not because it is switched off (${why(r.error)})`);
  });

  /* -- delete my account (migration 0003) ---------------------------- */
  // LAST, because it deletes account A. Everything above needed A signed in with its
  // rows in place. B's rows are what prove the function deletes only the caller.
  const DEL = "Delete my account (migration 0003)";
  const noFunctionHint = (r) => (r && r.error && (r.error.code === "PGRST202" || r.status === 404) ? " Was migration 0003 run?" : "");
  const afterDelete = { deleted: false };
  await check(DEL, "a signed-out visitor cannot call it", async () => {
    const r = await anon.rpc("delete_my_account");
    const stillThere = await rowOf(ca, "technique", { user_id: idA });
    return verdict(refused(r) && rowsIn(stillThere).length === 1, `it was not refused by the rules (${why(r.error)}).${noFunctionHint(r)}`);
  });
  await check(DEL, "A can delete its own account", async () => {
    const r = await ca.rpc("delete_my_account");
    afterDelete.deleted = !r.error;
    return verdict(!r.error, `the call failed (${why(r.error)}).${noFunctionHint(r)}`);
  });
  await check(DEL, "A's pieces and technique row went with it", async () => {
    if (!afterDelete.deleted) return { ok: false, detail: "needs the delete before it to have worked" };
    // A's old sign-in still passes the rules (they go by the token), so an empty list here
    // means the rows are gone, not that they are hidden.
    const p = await rowOf(ca, "pieces", { user_id: idA });
    const t = await rowOf(ca, "technique", { user_id: idA });
    if (p.error || t.error) return { ok: false, detail: `couldn't read the rows back (${why(p.error || t.error)})` };
    return verdict(rowsIn(p).length === 0 && rowsIn(t).length === 0, `A still has ${rowsIn(p).length} piece row(s) and ${rowsIn(t).length} technique row(s)`);
  });
  await check(DEL, "A can no longer sign in", async () => {
    if (!afterDelete.deleted) return { ok: false, detail: "needs the delete before it to have worked" };
    const again = createClient(url, key, opts);
    const r = await again.auth.signInWithPassword({ email: accountA.email, password: accountA.password, ...withToken });
    const signedIn = !r.error && r.data && r.data.user;
    try {
      await again.auth.signOut({ scope: "local" });
    } catch (e) {
      /* nothing to sign out of */
    }
    // Refused by the bot check is not "the account is gone": it would be refused either way.
    if (isBotCheckRefusal(r.error)) return { ok: false, detail: "couldn't tell: the sign-in was stopped by the bot check, not because the account is gone" };
    return verdict(!signedIn, "A could still sign in after deleting its account");
  });
  await check(DEL, "A's old sign-in cannot add rows any more", async () => {
    if (!afterDelete.deleted) return { ok: false, detail: "needs the delete before it to have worked" };
    const id = `${ROW_PREFIX}after-delete-${rand()}`;
    const r = await ca.from("pieces").insert({ user_id: idA, id, data: mark("written after the account was deleted") }).select();
    return verdict(!!r.error && rowsIn(r).length === 0, "a row was written for an account that no longer exists");
  });
  await check(DEL, "B's account and rows are untouched", async () => {
    const again = createClient(url, key, opts);
    const signIn = await again.auth.signInWithPassword({ email: accountB.email, password: accountB.password, ...withToken });
    try {
      await again.auth.signOut({ scope: "local" });
    } catch (e) {
      /* nothing to sign out of */
    }
    const p = await rowOf(cb, "pieces", { id: pb });
    const t = await rowOf(cb, "technique", { user_id: idB });
    const intact = rowsIn(p).length === 1 && rowsIn(p)[0].data.name === nameB && rowsIn(t).length === 1 && rowsIn(t)[0].data.name === techNameB;
    return verdict(!signIn.error && intact, `B can sign in again: ${!signIn.error}; B's piece is there: ${rowsIn(p).length === 1}; B's technique row is there: ${rowsIn(t).length === 1}`);
  });

  for (const client of [ca, cb]) {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch (e) {
      /* the accounts are about to be deleted anyway */
    }
  }
  return { results, botCheck };
}

// `--bot-check`: is the bot check really guarding this project? Asked from the outside
// with the public key and NO account: a password sign-in for a made-up address and a
// sign-up, each with no token, must both be refused BY THE BOT CHECK (not for some other
// reason). It writes nothing and signs in to nothing. The sign-in probe goes first and the
// sign-up probe is only tried once it shows the bot check is on, so that a project with the
// bot check off and sign-ups on doesn't get a stray account made by this probe.
// Returns { results } in the same shape as runChecks.
export async function runBotCheckProbe({ createClient, url, key, log = () => {} }) {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const probe = createClient(url, key, opts);
  const GROUP = "The bot check";
  const results = [];
  const add = (title, ok, detail) => {
    const result = { n: results.length + 1, group: GROUP, title, ok: !!ok, detail: ok ? "" : detail };
    results.push(result);
    log(result);
  };
  const email = `rls-check-probe-${rand()}@example.invalid`;
  const password = `${rand()}${rand()}Aa1!`;

  let signInGuarded = false;
  try {
    const r = await probe.auth.signInWithPassword({ email, password });
    signInGuarded = isBotCheckRefusal(r.error);
    add(
      "a sign-in without a bot-check token is refused by the bot check",
      signInGuarded,
      r.error
        ? `it was refused, but not by the bot check (${why(r.error)}): the bot check is not on for this project`
        : "a sign-in for a made-up address WENT THROUGH, which should be impossible"
    );
  } catch (e) {
    add("a sign-in without a bot-check token is refused by the bot check", false, `the probe itself failed to run: ${messageOf(e)}`);
  }

  if (!signInGuarded) {
    add("a sign-up without a bot-check token is refused by the bot check", false, "not tried: the sign-in probe shows the bot check is off, and a sign-up probe could then create an account");
    return { results };
  }
  try {
    const r = await probe.auth.signUp({ email, password });
    if (!r.error && r.data && r.data.user) {
      add("a sign-up without a bot-check token is refused by the bot check", false, `a sign-up with no token WENT THROUGH: an account was created for ${email}. Delete it, and check the bot check's settings.`);
    } else {
      add(
        "a sign-up without a bot-check token is refused by the bot check",
        isBotCheckRefusal(r.error),
        `it was refused, but not by the bot check (${why(r.error)})`
      );
    }
  } catch (e) {
    add("a sign-up without a bot-check token is refused by the bot check", false, `the probe itself failed to run: ${messageOf(e)}`);
  }
  return { results };
}

/* ---- the command line --------------------------------------------- */

function printHelp() {
  console.log(`MeasureOne security check (Pass 114)

Usage:  node scripts/check-rls.mjs [--yes] [--dummy-token]
        node scripts/check-rls.mjs --bot-check

It asks for, in order: the project's URL, the project's PUBLIC key, then the
email and password of two THROWAWAY accounts (A and B), created in the project's
dashboard (Authentication > Users > Add user, with "Auto Confirm User" ticked).
Both addresses must START WITH "rls-check" (for example rls-check-a@example.com):
the script refuses anything else before it signs in, because it deletes account A.
The key and the passwords are typed hidden. Nothing is saved.

Instead of being asked, it reads these environment variables if they are set:
  CHECK_URL (or VITE_SUPABASE_URL), CHECK_KEY (or VITE_SUPABASE_ANON_KEY),
  CHECK_EMAIL_A, CHECK_PASSWORD_A, CHECK_EMAIL_B, CHECK_PASSWORD_B.

--yes   don't ask "is this the right project?" before starting.

The bot check (Pass 135). When a project's bot check is on, every password
sign-in needs a token, this script's too:
--dummy-token  send Cloudflare's published dummy token with each sign-in. Only a
               project whose bot check uses Cloudflare's TEST secret key accepts
               it (the TEST project). (Or set CHECK_BOT_TOKEN to a token.)
--bot-check    a short check that needs NO accounts: asks only for the URL and
               the public key, then checks that a sign-in and a sign-up without
               a token are refused by the bot check. Use it on PRODUCTION after
               switching the bot check on. The full run works on production only
               while the bot check is off (see DEPLOYMENT.md, "Open sign-up").

Exit code: 0 every check passed, 1 a check failed, 2 the setup was wrong
(nothing was checked). The last group (migration 0003) DELETES account A, so
use throwaway accounts only. Afterwards delete whichever throwaway accounts
are still in the dashboard (B, and A if that group did not get that far):
their rows go with them.`);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

// Reads a line without showing it (for passwords). Needs a real terminal.
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    // Hidden mode first, THEN the prompt: anything typed or pasted the instant the
    // prompt appears must not be echoed.
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    process.stdout.write(question);
    let value = "";
    const done = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\u0003") { done(); process.exit(130); }
        if (c === "\r" || c === "\n") { done(); return resolve(value); }
        if (c === "\u007f" || c === "\b") { value = value.slice(0, -1); continue; }
        value += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return printHelp();
  const env = process.env;
  const interactive = !!(process.stdin.isTTY && process.stdout.isTTY);
  const fail = (message) => { console.error(`\n${message}\n`); process.exitCode = 2; };

  const need = async (value, question, { hidden = false } = {}) => {
    if (value) return value;
    if (!interactive) return "";
    return hidden ? askHidden(question) : ask(question);
  };

  const url = (await need(env.CHECK_URL || env.VITE_SUPABASE_URL, "Project URL (https://<project>.supabase.co): ")).trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const ref = projectRefFromUrl(url);
  if (!ref) return fail("That isn't a hosted Supabase project address (https://<project>.supabase.co). Nothing was checked.");
  // Typed hidden like a password: the public key is not a secret, but the dashboard
  // shows the secret key right beside it, and one pasted by mistake must not end up
  // on the screen (the check below refuses it, but only after it was typed).
  // Trimmed: a hidden prompt can't show a stray space or line break pasted with the key.
  const key = (await need(env.CHECK_KEY || env.VITE_SUPABASE_ANON_KEY, "Project PUBLIC key (sb_publishable_..., hidden as you paste it): ", { hidden: true })).trim();
  const problem = keyProblem(key);
  if (problem) return fail(`Not using that key: ${problem}. Nothing was checked.`);

  let lastGroup = "";
  const log = (r) => {
    if (r.group !== lastGroup) { console.log(`\n${r.group}`); lastGroup = r.group; }
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${String(r.n).padStart(2)}. ${r.title}${r.ok ? "" : `\n          ${r.detail}`}`);
  };

  // The short check of the bot check alone: no accounts, nothing written.
  if (args.includes("--bot-check")) {
    console.log(`\nMeasureOne bot-check probe\nProject: ${ref}  (${url})\nNo account is used and nothing is written.`);
    const { createClient } = await import("@supabase/supabase-js");
    let probeRun;
    try {
      probeRun = await runBotCheckProbe({ createClient, url, key, log });
    } catch (e) {
      return fail(`Something unexpected stopped the probe: ${messageOf(e)}`);
    }
    const ok = probeRun.results.every((r) => r.ok);
    console.log(`\n${ok ? "RESULT: the bot check is ON for this project." : "RESULT: PROBLEMS FOUND. Do NOT switch sign-ups on for this project until both lines pass."}`);
    if (!ok) process.exitCode = 1;
    return;
  }

  const accountA = { email: await need(env.CHECK_EMAIL_A, "Throwaway account A, email (must start with rls-check): "), password: await need(env.CHECK_PASSWORD_A, "Throwaway account A, password (hidden): ", { hidden: true }) };
  const accountB = { email: await need(env.CHECK_EMAIL_B, "Throwaway account B, email (must start with rls-check): "), password: await need(env.CHECK_PASSWORD_B, "Throwaway account B, password (hidden): ", { hidden: true }) };
  if (!accountA.email || !accountA.password || !accountB.email || !accountB.password) {
    return fail("Missing details for the two throwaway accounts, and this isn't an interactive terminal to ask in. Nothing was checked.");
  }

  console.log(`\nMeasureOne security check\nProject: ${ref}  (${url})\nAccount A: ${maskEmail(accountA.email)}\nAccount B: ${maskEmail(accountB.email)}`);
  if (!args.includes("--yes")) {
    if (!interactive) return fail("Not asking \"is this the right project?\" without a terminal: pass --yes to go ahead. Nothing was checked.");
    const answer = await ask(`\nRun the checks against project "${ref}"? These two accounts must be throwaway ones, and account A will be DELETED by the last group of checks. (yes/no) `);
    if (!/^y(es)?$/i.test(answer)) return fail("Stopped. Nothing was checked.");
  }

  const { createClient } = await import("@supabase/supabase-js");
  // Never printed. The dummy token is public (see DUMMY_BOT_TOKEN); a real one is not.
  const botToken = args.includes("--dummy-token") ? DUMMY_BOT_TOKEN : String(env.CHECK_BOT_TOKEN || "").trim();

  let run;
  try {
    run = await runChecks({ createClient, url, key, accountA, accountB, botToken, log });
  } catch (e) {
    if (e instanceof SetupProblem) return fail(`${e.message}\nNothing was checked.`);
    return fail(`Something unexpected stopped the checks: ${messageOf(e)}`);
  }

  const passed = run.results.filter((r) => r.ok).length;
  const total = run.results.length;
  console.log(`\n${passed === total ? "RESULT" : "RESULT: PROBLEMS FOUND"}: ${passed} of ${total} checks passed.`);
  if (passed !== total) {
    console.log("The failed checks are listed above. Do NOT go live on this project until they pass.");
    process.exitCode = 1;
  }
  console.log(botCheckNote(run.botCheck));
  console.log(
    "\nNext: delete the throwaway account(s) still there (dashboard > Authentication > Users > click the row > Delete user)." +
      "\nAccount A is deleted by the check of migration 0003 itself, so usually only B is left. Test rows (named \"RLS check ...\") go with their account; nothing else was written."
  );
}

// The line printed after a full run: was it the bot check that refused the sign-up probe?
export function botCheckNote(botCheck) {
  if (botCheck === "on") return "\nBot check: ON (the sign-up with no token was refused by the bot check).";
  if (botCheck === "off") {
    return (
      "\nBot check: NOT ON for this project. The sign-up with no token was refused only because new sign-ups are switched off." +
      "\nBefore switching sign-ups on: switch the bot check on, then run  node scripts/check-rls.mjs --bot-check  and see both lines pass."
    );
  }
  return "\nBot check: couldn't tell (see the sign-up check above).";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`\nSomething unexpected stopped the script: ${messageOf(e)}\n`);
    process.exitCode = 2;
  });
}
