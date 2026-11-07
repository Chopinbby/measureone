// scripts/check-rls.mjs: the account service's security check, tested against a
// stand-in database that follows the rules (Pass 130; the script's own tests were
// never committed before, Accounts-and-Backend.md "Found in the review", item 2).
//
// The stand-in below is a small in-memory copy of what migrations 0001 to 0003 do:
// row-level security by account, no delete permission, the database-kept revision count,
// sign-ups and anonymous sign-ins off, and "delete my account". It can be BROKEN one rule
// at a time, and each broken version must make the right check fail: that is what shows
// the checks can actually fail, which a script that has only ever passed cannot show.
// Nothing here touches a network or a real project.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runChecks, refused, keyProblem, projectRefFromUrl, maskEmail, isThrowawayEmail, THROWAWAY_PREFIX, SetupProblem, ROW_PREFIX } from "../scripts/check-rls.mjs";

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ACCOUNT_A = { email: "rls-check-a@example.test", password: "pw-for-a-9" };
const ACCOUNT_B = { email: "rls-check-b@example.test", password: "pw-for-b-9" };

const RULES = {
  rls: true, // an account reaches only its own rows
  noDeleteGrant: true, // nobody can delete a row (0001)
  anonLocked: true, // a signed-out visitor is refused outright (0001)
  revisionTrigger: true, // the database keeps the count (0002)
  signupsOff: true,
  anonSignInOff: true,
  deleteFn: "ok", // 0003: "ok" | "missing" | "anon-allowed" | "deletes-everyone" | "no-cascade" | "deletes-nothing"
  fkToAccount: true, // a row must belong to an account that exists (0001's references)
};

function makeDatabase(overrides = {}, seed = {}, extraUsers = []) {
  const rules = { ...RULES, ...overrides };
  const users = new Map([
    [ID_A, { id: ID_A, ...ACCOUNT_A }],
    [ID_B, { id: ID_B, ...ACCOUNT_B }],
  ]);
  for (const u of extraUsers) users.set(u.id, u);
  const tables = { pieces: [...(seed.pieces || [])], technique: [...(seed.technique || [])] };
  let tick = Date.parse("2026-11-06T12:00:00Z");
  const now = () => new Date((tick += 7)).toISOString();
  const db = { rules, users, tables, signIns: 0 };

  const err = (code, message, status) => ({ data: null, error: { code, message }, status });
  const denied = (what, client) => err("42501", `permission denied for ${what}`, client.uid ? 403 : 401);

  class Query {
    constructor(client, table) {
      this.client = client;
      this.table = table;
      this.op = "select";
      this.filters = [];
      this.returning = false;
      this.cols = "*";
      this.max = null;
    }
    select(cols = "*") {
      if (this.op === "select") this.cols = cols;
      else this.returning = true;
      return this;
    }
    insert(row) { this.op = "insert"; this.row = row; return this; }
    update(patch) { this.op = "update"; this.patch = patch; return this; }
    delete() { this.op = "delete"; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    limit(n) { this.max = n; return this; }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }

    visible(row) {
      if (!rules.rls) return true;
      return Boolean(this.client.uid) && row.user_id === this.client.uid;
    }
    matching() {
      return tables[this.table].filter((row) => this.visible(row) && this.filters.every(([c, v]) => row[c] === v));
    }
    run() {
      const c = this.client;
      const anon = !c.uid;
      if (anon && rules.anonLocked) return denied(`table ${this.table}`, c);
      if (this.op === "delete" && rules.noDeleteGrant) return denied(`table ${this.table}`, c);
      const copy = (row) => JSON.parse(JSON.stringify(row));

      if (this.op === "select") {
        let rows = this.matching().map(copy);
        if (this.max !== null) rows = rows.slice(0, this.max);
        if (this.cols !== "*") {
          const cols = this.cols.split(",").map((x) => x.trim());
          rows = rows.map((row) => Object.fromEntries(cols.map((k) => [k, row[k]])));
        }
        return { data: rows, error: null, status: 200 };
      }

      if (this.op === "insert") {
        const row = copy(this.row);
        if (rules.rls && row.user_id !== c.uid) return err("42501", "new row violates row-level security policy", 403);
        if (rules.fkToAccount && !users.has(row.user_id)) return err("23503", "violates foreign key constraint", 409);
        const dup = tables[this.table].some((r) => r.user_id === row.user_id && (this.table === "technique" || r.id === row.id));
        if (dup) return err("23505", "duplicate key value violates unique constraint", 409);
        row.revision = rules.revisionTrigger ? 1 : row.revision ?? 1;
        row.updated_at = now();
        if (this.table === "pieces" && row.deleted_at === undefined) row.deleted_at = null;
        tables[this.table].push(row);
        return { data: this.returning ? [copy(row)] : null, error: null, status: 201 };
      }

      if (this.op === "update") {
        const rows = this.matching();
        if (rules.rls && this.patch.user_id !== undefined && this.patch.user_id !== c.uid) {
          return err("42501", "new row violates row-level security policy", 403);
        }
        for (const row of rows) {
          const was = row.revision;
          Object.assign(row, this.patch);
          row.revision = rules.revisionTrigger ? was + 1 : this.patch.revision ?? was;
          row.updated_at = now();
        }
        return { data: this.returning ? rows.map(copy) : null, error: null, status: 200 };
      }

      // delete (only reached when the no-delete rule is broken)
      const rows = this.matching();
      tables[this.table] = tables[this.table].filter((r) => !rows.includes(r));
      return { data: this.returning ? rows.map(copy) : null, error: null, status: 200 };
    }
  }

  const createClient = () => {
    const client = {
      uid: null,
      from: (table) => new Query(client, table),
      rpc: async (name) => {
        if (name !== "delete_my_account" || rules.deleteFn === "missing") {
          return err("PGRST202", `Could not find the function public.${name}`, 404);
        }
        if (!client.uid) {
          if (rules.deleteFn === "anon-allowed") return { data: null, error: null, status: 204 };
          return denied("function delete_my_account", client);
        }
        if (rules.deleteFn !== "deletes-nothing") {
          const victims = rules.deleteFn === "deletes-everyone" ? [...users.keys()] : [client.uid];
          for (const id of victims) {
            users.delete(id);
            if (rules.deleteFn !== "no-cascade") {
              tables.pieces = tables.pieces.filter((r) => r.user_id !== id);
              tables.technique = tables.technique.filter((r) => r.user_id !== id);
            }
          }
        }
        return { data: null, error: null, status: 204 };
      },
      auth: {
        signInWithPassword: async ({ email, password }) => {
          db.signIns += 1;
          const user = [...users.values()].find((u) => u.email === email && u.password === password);
          if (!user) return { data: { user: null }, error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" } };
          client.uid = user.id;
          return { data: { user: { id: user.id } }, error: null };
        },
        signUp: async () =>
          rules.signupsOff
            ? { data: { user: null }, error: { code: "signup_disabled", status: 422, message: "Signups not allowed for this instance" } }
            : { data: { user: { id: "new-user" } }, error: null },
        signInAnonymously: async () =>
          rules.anonSignInOff
            ? { data: { user: null }, error: { code: "anonymous_provider_disabled", status: 422, message: "Anonymous sign-ins are disabled" } }
            : { data: { user: { id: "anon-user" } }, error: null },
        signOut: async () => ({ error: null }),
      },
    };
    return client;
  };
  return { db, createClient };
}

async function run(overrides, seed) {
  const { db, createClient } = makeDatabase(overrides, seed);
  const logged = [];
  const { results } = await runChecks({
    createClient,
    url: "https://abcdefghij.supabase.co",
    key: "sb_publishable_abcdefghijklmnop",
    accountA: ACCOUNT_A,
    accountB: ACCOUNT_B,
    log: (r) => logged.push(r),
  });
  return { db, results, logged };
}
const failed = (results) => results.filter((r) => !r.ok).map((r) => r.title);

describe("the checks pass on a database that follows every rule", () => {
  test("every check passes, in the groups the docs describe", async () => {
    const { results, logged } = await run();
    assert.deepEqual(failed(results), []);
    assert.equal(results.length, 43); // 37 before migration 0003 + 6 for it
    assert.equal(logged.length, results.length);
    const groups = [...new Set(results.map((r) => r.group))];
    assert.deepEqual(groups, [
      "Signed in: your own rows work",
      "Signed in: nobody else's rows",
      "Signed in: nobody can delete a row",
      "Signed out: nothing at all",
      "The database keeps the revision count (migration 0002)",
      "Sign-in settings",
      "Delete my account (migration 0003)",
    ]);
    // the delete group is the last one, because it deletes account A
    assert.equal(results[results.length - 1].group, "Delete my account (migration 0003)");
  });

  test("it deletes account A and leaves account B, and writes only rows named as test rows", async () => {
    const { db } = await run();
    assert.equal(db.users.has(ID_A), false);
    assert.equal(db.users.has(ID_B), true);
    assert.equal(db.tables.pieces.some((r) => r.user_id === ID_A), false);
    for (const row of [...db.tables.pieces, ...db.tables.technique]) {
      assert.equal(row.user_id, ID_B);
      assert.match(JSON.stringify(row.data), /RLS check/);
      if (row.id !== undefined) assert.ok(row.id.startsWith(ROW_PREFIX), row.id);
    }
  });

  test("no password appears in what it reports", async () => {
    const { results, logged } = await run();
    const text = JSON.stringify([results, logged]);
    assert.equal(text.includes(ACCOUNT_A.password), false);
    assert.equal(text.includes(ACCOUNT_B.password), false);
  });
});

describe("each broken rule is caught by the right check", () => {
  const cases = [
    ["row-level security missing", { rls: false }, ["A cannot read B's pieces", "A cannot change B's piece", "A cannot read B's technique row"]],
    ["the delete permission left in", { noDeleteGrant: false }, ["A cannot delete its own piece", "A cannot delete its own technique row"]],
    ["a signed-out visitor given permission", { anonLocked: false }, ["a signed-out visitor cannot read pieces", "a signed-out visitor cannot read technique"]],
    ["the revision counter missing", { revisionTrigger: false }, ["a changed piece goes up by exactly one, even if the request tries to set it", "a new piece starts at revision 1, even if the request says 99"]],
    ["sign-ups left on", { signupsOff: false }, ["new sign-ups are switched off"]],
    ["anonymous sign-ins left on", { anonSignInOff: false }, ["anonymous sign-ins are switched off"]],
    // migration 0003
    ["[Pass 130] the delete function missing (migration 0003 not run)", { deleteFn: "missing" }, [
      "a signed-out visitor cannot call it", "A can delete its own account", "A's pieces and technique row went with it", "A can no longer sign in", "A's old sign-in cannot add rows any more",
    ]],
    ["[Pass 130] a signed-out visitor allowed to call it", { deleteFn: "anon-allowed" }, ["a signed-out visitor cannot call it"]],
    ["[Pass 130] the function deleting every account, not just the caller's", { deleteFn: "deletes-everyone" }, ["B's account and rows are untouched"]],
    ["[Pass 130] the account deleted but its rows left behind", { deleteFn: "no-cascade" }, ["A's pieces and technique row went with it"]],
    ["[Pass 130] the function doing nothing", { deleteFn: "deletes-nothing" }, ["A's pieces and technique row went with it", "A can no longer sign in"]],
    ["[Pass 130] rows accepted for an account that no longer exists", { fkToAccount: false }, ["A's old sign-in cannot add rows any more"]],
  ];
  for (const [name, overrides, expected] of cases) {
    test(name, async () => {
      const { results } = await run(overrides);
      const bad = failed(results);
      for (const title of expected) assert.ok(bad.includes(title), `"${title}" should have failed. Failed: ${JSON.stringify(bad)}`);
    });
  }

  test("[Pass 130] a missing function says which migration to run", async () => {
    const { results } = await run({ deleteFn: "missing" });
    const first = results.find((r) => r.title === "A can delete its own account");
    assert.equal(first.ok, false);
    assert.match(first.detail, /migration 0003/);
  });

  test("[Pass 130] only the delete group fails when only the delete function is wrong (the other 37 stay green)", async () => {
    for (const deleteFn of ["missing", "anon-allowed", "deletes-everyone", "no-cascade", "deletes-nothing"]) {
      const { results } = await run({ deleteFn });
      const wrongGroups = new Set(results.filter((r) => !r.ok).map((r) => r.group));
      assert.deepEqual([...wrongGroups], ["Delete my account (migration 0003)"], deleteFn);
    }
  });
});

describe("setup problems stop before anything is written", () => {
  const base = { url: "https://abcdefghij.supabase.co", key: "sb_publishable_abcdefghijklmnop" };

  test("a wrong password", async () => {
    const { createClient } = makeDatabase();
    await assert.rejects(
      runChecks({ createClient, ...base, accountA: { ...ACCOUNT_A, password: "nope" }, accountB: ACCOUNT_B }),
      (e) => e instanceof SetupProblem && /account A/.test(e.message) && !e.message.includes("nope")
    );
  });

  test("the same account twice", async () => {
    const { createClient } = makeDatabase();
    await assert.rejects(runChecks({ createClient, ...base, accountA: ACCOUNT_A, accountB: ACCOUNT_A }), SetupProblem);
  });

  test("an account that already holds data is refused, and nothing is deleted or written", async () => {
    const seed = { pieces: [{ user_id: ID_A, id: "real-piece", data: { name: "Someone's real piece" }, revision: 3, updated_at: "x", deleted_at: null }] };
    const { db, createClient } = makeDatabase({}, seed);
    await assert.rejects(runChecks({ createClient, ...base, accountA: ACCOUNT_A, accountB: ACCOUNT_B }), /isn't a throwaway account/);
    assert.equal(db.users.has(ID_A), true);
    assert.equal(db.tables.pieces.length, 1);
    assert.equal(db.tables.pieces[0].data.name, "Someone's real piece");
  });
});

describe("[Pass 130] only accounts made for this are touched (the last group deletes account A)", () => {
  const base = { url: "https://abcdefghij.supabase.co", key: "sb_publishable_abcdefghijklmnop" };
  const REAL = { id: "00000000-0000-4000-8000-0000000000c1", email: "newly.invited@gmail.com", password: "their-own-pw-1" };

  test("[regression, Pass 130] a real account that is merely EMPTY is refused, never signed in to, never deleted", async () => {
    // A just-invited person's account holds no pieces, so the "holds no data" check alone would
    // have let it through and the last group would have deleted it.
    const { db, createClient } = makeDatabase({}, {}, [REAL]);
    await assert.rejects(
      runChecks({ createClient, ...base, accountA: { email: REAL.email, password: REAL.password }, accountB: ACCOUNT_B }),
      (e) => e instanceof SetupProblem && /account A/i.test(e.message) && /rls-check/.test(e.message) && /DELETES account A/.test(e.message) && !e.message.includes(REAL.password)
    );
    assert.equal(db.users.has(REAL.id), true);
    assert.equal(db.signIns, 0, "nothing may sign in before the address is accepted");
    assert.equal(db.tables.pieces.length + db.tables.technique.length, 0);
  });

  test("account B must be a throwaway too (test rows are written into it)", async () => {
    const { db, createClient } = makeDatabase({}, {}, [REAL]);
    await assert.rejects(
      runChecks({ createClient, ...base, accountA: ACCOUNT_A, accountB: { email: REAL.email, password: REAL.password } }),
      (e) => e instanceof SetupProblem && /account B/i.test(e.message)
    );
    assert.equal(db.signIns, 0);
    assert.equal(db.users.has(ID_A), true);
  });

  test("which addresses count: the part before the @ starts with rls-check, any letter case", () => {
    assert.equal(THROWAWAY_PREFIX, "rls-check");
    for (const ok of ["rls-check-a@example.com", "RLS-Check-B@Example.COM", "  rls-check@x.y ", "rls-check123@gmail.com"]) assert.equal(isThrowawayEmail(ok), true, ok);
    for (const bad of ["", "naomi@example.com", "xrls-check@example.com", "a@rls-check.com", "rls-check", "rls_check-a@example.com", "check-rls-a@example.com", null, undefined]) {
      assert.equal(isThrowawayEmail(bad), false, String(bad));
    }
  });

  test("the guard sits in runChecks itself, so the --yes shortcut and the environment-variable path can't skip it", async () => {
    const { db, createClient } = makeDatabase({}, {}, [REAL]);
    await assert.rejects(runChecks({ createClient, ...base, accountA: { email: REAL.email, password: REAL.password }, accountB: ACCOUNT_B, log: () => {} }), SetupProblem);
    assert.equal(db.signIns, 0);
  });
});

describe("the helpers", () => {
  test("refused() counts only a permission refusal", () => {
    assert.equal(refused({ error: { code: "42501" } }), true);
    assert.equal(refused({ error: { code: "x" }, status: 401 }), true);
    assert.equal(refused({ error: { code: "x" }, status: 403 }), true);
    assert.equal(refused({ error: { code: "23505" }, status: 409 }), false);
    assert.equal(refused({ error: { code: "PGRST202" }, status: 404 }), false);
    assert.equal(refused({ data: [], error: null }), false);
    assert.equal(refused(null), false);
  });

  test("a secret key is refused, the public one accepted", () => {
    assert.match(keyProblem("sb_secret_abcdefghijklmnop"), /SECRET/);
    assert.equal(keyProblem("sb_publishable_abcdefghijklmnop"), null);
    assert.match(keyProblem(""), /no key/);
    assert.match(keyProblem("nonsense"), /public key/);
    const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;
    assert.equal(keyProblem(jwt("anon")), null);
    assert.match(keyProblem(jwt("service_role")), /service_role/);
  });

  test("project address and masked email", () => {
    assert.equal(projectRefFromUrl("https://abcdefghij.supabase.co"), "abcdefghij");
    assert.equal(projectRefFromUrl("http://abcdefghij.supabase.co"), null);
    assert.equal(projectRefFromUrl("https://example.com"), null);
    assert.equal(maskEmail("naomi@example.org"), "na***@example.org");
    assert.equal(maskEmail("nonsense"), "(no address)");
  });
});
