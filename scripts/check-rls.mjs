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
/*    - new sign-ups and anonymous sign-ins are switched off           */
/*                                                                     */
/*  Safety, on purpose:                                                */
/*    - It refuses a secret key (sb_secret_..., or an old key whose    */
/*      role is service_role). Never give it one.                      */
/*    - It refuses any account that already holds pieces or technique  */
/*      data, so it can't write test rows into a real account.         */
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
/*  Setup: create the two throwaway accounts in the project's          */
/*  dashboard (Authentication > Users > Add user), run this, then      */
/*  delete the two accounts. See docs/Accounts-and-Backend.md.         */
/* ------------------------------------------------------------------ */

import readline from "node:readline";
import { pathToFileURL } from "node:url";

export const ROW_PREFIX = "rls-check-";

// Something wrong with the setup (a wrong password, an account that isn't
// empty), as opposed to a security check that failed.
export class SetupProblem extends Error {}

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
// accounts. log: called with each result as it comes in.
// Returns { results: [{ n, group, title, ok, detail }] }.
export async function runChecks({ createClient, url, key, accountA, accountB, log = () => {} }) {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const anon = createClient(url, key, opts);
  const ca = createClient(url, key, opts);
  const cb = createClient(url, key, opts);
  const probe = createClient(url, key, opts);

  const signIn = async (client, account, label) => {
    const r = await client.auth.signInWithPassword({ email: account.email, password: account.password });
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
      if (r.error) throw new SetupProblem(`Couldn't read the "${table}" table as account ${label}: ${why(r.error)}. Were both migration files run (0001 and 0002)?`);
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
  await check(SIGNIN, "new sign-ups are switched off", async () => {
    const email = `rls-check-signup-probe-${rand()}@example.invalid`;
    const r = await probe.auth.signUp({ email, password: `${rand()}${rand()}Aa1!` });
    if (!r.error && r.data && r.data.user) {
      return { ok: false, detail: `sign-up WENT THROUGH: an account was created for ${email}. Switch sign-ups off (Authentication > Sign In / Providers) and delete that account.` };
    }
    const off = r.error && (r.error.code === "signup_disabled" || /signups? not allowed|signups? (are )?disabled|not allowed for this instance/i.test(messageOf(r.error)));
    return verdict(off, `the sign-up probe failed, but not because sign-ups are off (${why(r.error)})`);
  });
  await check(SIGNIN, "anonymous sign-ins are switched off", async () => {
    if (typeof probe.auth.signInAnonymously !== "function") return { ok: false, detail: "this version of the library can't try an anonymous sign-in" };
    const r = await probe.auth.signInAnonymously();
    if (!r.error && r.data && r.data.user) {
      return { ok: false, detail: "an anonymous sign-in WENT THROUGH. Switch anonymous sign-ins off (Authentication > Sign In / Providers) and delete that anonymous user." };
    }
    const off = r.error && (r.error.code === "anonymous_provider_disabled" || /anonymous sign-ins? (are )?disabled/i.test(messageOf(r.error)));
    return verdict(off, `the anonymous sign-in probe failed, but not because it is switched off (${why(r.error)})`);
  });

  for (const client of [ca, cb]) {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch (e) {
      /* the accounts are about to be deleted anyway */
    }
  }
  return { results };
}

/* ---- the command line --------------------------------------------- */

function printHelp() {
  console.log(`MeasureOne security check (Pass 114)

Usage:  node scripts/check-rls.mjs [--yes]

It asks for, in order: the project's URL, the project's PUBLIC key, then the
email and password of two THROWAWAY accounts (A and B), created in the project's
dashboard (Authentication > Users > Add user, with "Auto Confirm User" ticked).
Passwords are typed hidden. Nothing is saved.

Instead of being asked, it reads these environment variables if they are set:
  CHECK_URL (or VITE_SUPABASE_URL), CHECK_KEY (or VITE_SUPABASE_ANON_KEY),
  CHECK_EMAIL_A, CHECK_PASSWORD_A, CHECK_EMAIL_B, CHECK_PASSWORD_B.

--yes   don't ask "is this the right project?" before starting.

Exit code: 0 every check passed, 1 a check failed, 2 the setup was wrong
(nothing was checked). Afterwards delete the two throwaway accounts in the
dashboard: their rows go with them.`);
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

  const url = (await need(env.CHECK_URL || env.VITE_SUPABASE_URL, "Project URL (https://<project>.supabase.co): ")).replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const ref = projectRefFromUrl(url);
  if (!ref) return fail("That isn't a hosted Supabase project address (https://<project>.supabase.co). Nothing was checked.");
  const key = await need(env.CHECK_KEY || env.VITE_SUPABASE_ANON_KEY, "Project PUBLIC key (sb_publishable_...): ");
  const problem = keyProblem(key);
  if (problem) return fail(`Not using that key: ${problem}. Nothing was checked.`);

  const accountA = { email: await need(env.CHECK_EMAIL_A, "Throwaway account A, email: "), password: await need(env.CHECK_PASSWORD_A, "Throwaway account A, password (hidden): ", { hidden: true }) };
  const accountB = { email: await need(env.CHECK_EMAIL_B, "Throwaway account B, email: "), password: await need(env.CHECK_PASSWORD_B, "Throwaway account B, password (hidden): ", { hidden: true }) };
  if (!accountA.email || !accountA.password || !accountB.email || !accountB.password) {
    return fail("Missing details for the two throwaway accounts, and this isn't an interactive terminal to ask in. Nothing was checked.");
  }

  console.log(`\nMeasureOne security check\nProject: ${ref}  (${url})\nAccount A: ${maskEmail(accountA.email)}\nAccount B: ${maskEmail(accountB.email)}`);
  if (!args.includes("--yes")) {
    if (!interactive) return fail("Not asking \"is this the right project?\" without a terminal: pass --yes to go ahead. Nothing was checked.");
    const answer = await ask(`\nRun the checks against project "${ref}"? These two accounts must be throwaway ones. (yes/no) `);
    if (!/^y(es)?$/i.test(answer)) return fail("Stopped. Nothing was checked.");
  }

  const { createClient } = await import("@supabase/supabase-js");
  let lastGroup = "";
  const log = (r) => {
    if (r.group !== lastGroup) { console.log(`\n${r.group}`); lastGroup = r.group; }
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${String(r.n).padStart(2)}. ${r.title}${r.ok ? "" : `\n          ${r.detail}`}`);
  };

  let run;
  try {
    run = await runChecks({ createClient, url, key, accountA, accountB, log });
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
  console.log(
    "\nNext: delete the two throwaway accounts (dashboard > Authentication > Users > click the row > Delete user)." +
      "\nTheir test rows (named \"RLS check ...\") go with them; nothing else was written."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`\nSomething unexpected stopped the script: ${messageOf(e)}\n`);
    process.exitCode = 2;
  });
}
