// Pass 110: the first backup to the account (src/lib/accountSync.js). No
// network: a fake client stands in for Supabase's, and a small in-memory
// object for localStorage.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PIECE_SCHEMA_VERSION,
  MATCHES,
  DIFFERS,
  NOT_IN_ACCOUNT,
  compareWithAccount,
  fingerprint,
  changePieceRow,
  changeTechniqueRow,
  accountRecordFor,
  hasRecordedBackup,
  withBackupRecorded,
  readDeviceRecord,
  saveDeviceRecord,
  backUpDevice,
  backupQuestion,
  describeBackupResult,
  ACCOUNT_SYNC_KEY,
} from "../src/lib/accountSync.js";

const memoryStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
  };
};
const piece = (id, extra = {}) => ({ id, name: `Piece ${id}`, totalMeasures: 32, progress: {}, ...extra });
const viaJson = (v) => JSON.parse(JSON.stringify(v));
// What the database does to an object: same content, keys in another order.
function reorder(v) {
  if (Array.isArray(v)) return v.map(reorder);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])]));
  return v;
}
const pieceRow = (p, extra = {}) => ({ user_id: "u1", id: p.id, data: reorder(viaJson(p)), revision: 1, deleted_at: null, ...extra });

// Just enough of Supabase's query builder for what accountSync.js calls, with
// the database's revision rule (1 on insert, +1 on update) built in.
function fakeClient({ userId = "u1", pieceRows = [], techniqueRows = [], readError = null, corruptInserts = false } = {}) {
  const rows = { pieces: pieceRows.map((r) => ({ ...r })), technique: techniqueRows.map((r) => ({ ...r })) };
  const calls = { insert: [], update: [], select: [] };
  const from = (table) => {
    const q = { op: "select", filters: [], values: null, range: null };
    const hit = (row) => q.filters.every(([c, v]) => row[c] === v);
    const run = () => {
      if (q.op === "select") {
        calls.select.push(table);
        if (readError) return { data: null, error: readError };
        let out = rows[table].filter(hit);
        if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
        return { data: out.map(viaJson), error: null };
      }
      if (q.op === "insert") {
        calls.insert.push({ table, values: q.values });
        const dup = rows[table].some((r) => r.user_id === q.values.user_id && (table === "technique" || r.id === q.values.id));
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key value" } };
        const data = reorder(viaJson(q.values.data));
        rows[table].push({ ...q.values, data: corruptInserts ? { ...data, corrupted: true } : data, revision: 1, deleted_at: null });
        return { data: null, error: null };
      }
      calls.update.push({ table, filters: q.filters, values: q.values });
      const changed = rows[table].filter(hit);
      changed.forEach((r) => {
        r.data = reorder(viaJson(q.values.data));
        r.revision += 1;
      });
      return { data: changed.map((r) => ({ revision: r.revision })), error: null };
    };
    const api = {
      select: () => api,
      insert: (v) => ((q.op = "insert"), (q.values = v), api),
      update: (v) => ((q.op = "update"), (q.values = v), api),
      eq: (c, v) => (q.filters.push([c, v]), api),
      order: () => api,
      range: (a, b) => ((q.range = [a, b]), api),
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return api;
  };
  const client = { from, auth: { getSession: async () => ({ data: { session: { user: { id: userId } } }, error: null }) } };
  return { client, rows, calls };
}

const technique = { schemaVersion: 1, items: [], settings: { scalesPerDay: 3 } };

describe("compareWithAccount", () => {
  test("the same data with its keys in another order, and an undefined field, matches", () => {
    const local = piece("p1", { sections: [{ id: "s1", name: "A" }], note: undefined });
    const out = compareWithAccount({ p1: local }, technique, {
      pieces: [pieceRow(local)],
      technique: { revision: 1, data: reorder(technique) },
    });
    assert.equal(out.pieces.p1.status, MATCHES);
    assert.equal(out.technique.status, MATCHES);
  });

  test("one extra session differs", () => {
    const local = piece("p1", { progress: { c1: { sessions: [{ day: 1 }] } } });
    const inAccount = piece("p1", { progress: { c1: { sessions: [] } } });
    const out = compareWithAccount({ p1: local }, technique, { pieces: [pieceRow(inAccount)], technique: null });
    assert.equal(out.pieces.p1.status, DIFFERS);
  });

  test("a piece with no row is not in the account", () => {
    const out = compareWithAccount({ p9: piece("p9") }, technique, { pieces: [], technique: null });
    assert.equal(out.pieces.p9.status, NOT_IN_ACCOUNT);
    assert.equal(out.technique.status, NOT_IN_ACCOUNT);
  });

  test("a row marked deleted differs even when the data is the same", () => {
    const local = piece("p1");
    const out = compareWithAccount({ p1: local }, technique, { pieces: [pieceRow(local, { deleted_at: "2026-09-30T00:00:00Z" })], technique: null });
    assert.equal(out.pieces.p1.status, DIFFERS);
    assert.equal(out.pieces.p1.deleted, true);
  });
});

describe("saving only if still at revision N", () => {
  test("no row back reports a conflict, once, and is not retried", async () => {
    const fake = fakeClient({ pieceRows: [pieceRow(piece("p1"), { revision: 2 })] });
    const r = await changePieceRow(fake.client, "u1", "p1", piece("p1", { name: "Mine" }), 1);
    assert.equal(r.ok, false);
    assert.equal(r.conflict, true);
    assert.equal(fake.calls.update.length, 1);
    assert.equal(fake.rows.pieces[0].revision, 2);
  });

  test("at the right revision it saves, and the database raises the revision", async () => {
    const fake = fakeClient({ pieceRows: [pieceRow(piece("p1"))], techniqueRows: [{ user_id: "u1", data: technique, revision: 1 }] });
    const r = await changePieceRow(fake.client, "u1", "p1", piece("p1", { name: "Mine" }), 1);
    assert.deepEqual(r, { ok: true, revision: 2 });
    const t = await changeTechniqueRow(fake.client, "u1", technique, 5);
    assert.equal(t.conflict, true);
  });
});

describe("the device record", () => {
  test("a different account on the same browser starts with an empty record", () => {
    const storage = memoryStorage();
    const a = withBackupRecorded(readDeviceRecord(storage), "user-a", { pieces: { p1: { revision: 1, fingerprint: "x" } }, technique: null, checkedAt: 5 });
    assert.equal(saveDeviceRecord(a, storage).ok, true);
    const loaded = readDeviceRecord(storage);
    assert.equal(hasRecordedBackup(loaded, "user-a"), true);
    assert.equal(hasRecordedBackup(loaded, "user-b"), false);
    assert.deepEqual(accountRecordFor(loaded, "user-b"), { pieces: {}, technique: null, checkedAt: null });
    const both = withBackupRecorded(loaded, "user-b", { pieces: {}, technique: null, checkedAt: 9 });
    assert.deepEqual(accountRecordFor(both, "user-a").pieces, { p1: { revision: 1, fingerprint: "x" } });
  });

  test("an unreadable record is treated as empty", () => {
    const storage = memoryStorage();
    storage.setItem(ACCOUNT_SYNC_KEY, "{not json");
    assert.deepEqual(readDeviceRecord(storage).accounts, {});
  });
});

describe("backUpDevice", () => {
  const run = (fake, pieces, storage = memoryStorage()) =>
    backUpDevice({ pieces, technique, userId: "u1", getClient: async () => fake.client, storage, now: () => 1000 }).then((result) => ({ result, storage }));

  test("adds only what the account lacks, never changes a row, records only what matched", async () => {
    const pieces = { p1: piece("p1"), p2: piece("p2"), p3: piece("p3") };
    const fake = fakeClient({ pieceRows: [pieceRow(pieces.p2), pieceRow(pieces.p3, { data: { ...pieces.p3, name: "Changed elsewhere" } })] });
    const { result, storage } = await run(fake, pieces);
    assert.equal(result.status, "done");
    assert.equal(fake.calls.update.length, 0);
    assert.deepEqual(fake.calls.insert.map((c) => c.table + ":" + (c.values.id || "-")), ["pieces:p1", "technique:-"]);
    assert.equal(result.backedUp, 2);
    assert.equal(result.added, 1);
    assert.equal(result.alreadyThere, 1);
    assert.deepEqual(result.different.map((d) => d.id), ["p3"]);
    assert.equal(result.technique, "backedUp");
    const rec = accountRecordFor(readDeviceRecord(storage), "u1");
    assert.deepEqual(Object.keys(rec.pieces).sort(), ["p1", "p2"]);
    assert.equal(rec.checkedAt, 1000);
    assert.equal(fake.rows.pieces.find((r) => r.id === "p3").revision, 1);
  });

  test("a write that doesn't read back the same is reported and not recorded", async () => {
    const fake = fakeClient({ corruptInserts: true });
    const { result, storage } = await run(fake, { p1: piece("p1") });
    assert.deepEqual(result.mismatched.map((d) => d.id), ["p1"]);
    assert.equal(result.technique, "mismatched");
    assert.equal(hasRecordedBackup(readDeviceRecord(storage), "u1"), false);
  });

  test("no connection on the first read stops and records nothing", async () => {
    const fake = fakeClient({ readError: { message: "TypeError: Failed to fetch", code: "" } });
    const { result, storage } = await run(fake, { p1: piece("p1") });
    assert.equal(result.status, "stopped");
    assert.equal(result.reason, "connection");
    assert.equal(fake.calls.insert.length, 0);
    assert.equal(storage.getItem(ACCOUNT_SYNC_KEY), null);
  });
});

describe("fingerprint and words", () => {
  test("a fingerprint ignores key order and changes with content", () => {
    const a = piece("p1", { x: 1, y: [1, 2] });
    assert.equal(fingerprint(a), fingerprint(reorder(a)));
    assert.notEqual(fingerprint(a), fingerprint({ ...a, y: [1, 2, 3] }));
  });

  test("the question and the result use the card's words", () => {
    assert.equal(backupQuestion(12, "name@example.com"), "Back up the 12 pieces and the technique library on this device to name@example.com?");
    const done = { status: "done", total: 12, backedUp: 12, added: 12, alreadyThere: 0, different: [], mismatched: [], notSent: [], technique: "backedUp", recordSaved: true };
    assert.equal(describeBackupResult(done)[0].text, "Backed up and checked: 12 of 12 pieces and the technique library.");
    const diff = { ...done, backedUp: 11, added: 0, alreadyThere: 11, different: [{ id: "p3", name: "Sonata" }] };
    assert.ok(describeBackupResult(diff).some((l) => l.text.startsWith("Already in your account and different, left as it is: Sonata")));
  });

  test("PIECE_SCHEMA_VERSION matches storage.js's CURRENT_SCHEMA_VERSION", () => {
    const m = readFileSync("src/lib/storage.js", "utf8").match(/const CURRENT_SCHEMA_VERSION = (\d+)/);
    assert.ok(m);
    assert.equal(Number(m[1]), PIECE_SCHEMA_VERSION);
  });
});
