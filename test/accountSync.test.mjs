// Pass 110: the first backup to the account (src/lib/accountSync.js). No
// network: a fake client stands in for Supabase's, and a small in-memory
// object for localStorage.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAndMigratePiece, validateAndMigrateTechnique } from "../src/lib/storage.js";
import {
  PIECE_SCHEMA_VERSION,
  MATCHES,
  DIFFERS,
  NOT_IN_ACCOUNT,
  compareWithAccount,
  sameData,
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
  // Pass 111
  SYNC_QUIET_MS,
  SYNC_MAX_WAIT_MS,
  RETRY_GAPS_MS,
  NOT_ANSWERING_AFTER,
  quietDelayMs,
  retryGapMs,
  nextFailureCount,
  syncOutcome,
  pieceFingerprint,
  techniqueFingerprint,
  canonicalPiece,
  canonicalTechnique,
  samePiece,
  sameTechnique,
  withPieceUploaded,
  withPieceHeld,
  withPieceForgotten,
  withTechniqueUploaded,
  withTechniqueHeld,
  reconcileLocalDeletions,
  computeWaiting,
  syncSnapshot,
  syncWaitingChanges,
  deletePieceRow,
  describeAgo,
  describeSyncStatus,
  describeHeld,
  describeHeldBanner,
  // Pass 112
  fetchAccountCopy,
  countLiveAccountPieces,
  describeFetchProblem,
  describeRestoreButton,
  accountRowsToCandidates,
  nothingWaitingHere,
  accountHasNewerCopy,
  canTakeAccountCopyWithoutAsking,
  planAccountMerge,
  planNeedsQuestion,
  applyAccountMerge,
  withAccountCopyRecorded,
  markOtherCopiesDeleted,
  describeAccountMergeResult,
  restrictCandidatesToHeld,
  withPieceDropped,
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
function fakeClient({ userId = "u1", pieceRows = [], techniqueRows = [], readError = null, corruptInserts = false, alterInserts = null } = {}) {
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
        const stored = alterInserts ? alterInserts(table, data) : corruptInserts ? { ...data, corrupted: true } : data;
        rows[table].push({ ...q.values, data: stored, revision: 1, deleted_at: null });
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
    assert.deepEqual(accountRecordFor(loaded, "user-b"), { pieces: {}, technique: null, checkedAt: null, syncedAt: null });
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

  test("when the account already holds a different copy of every piece, it says nothing was added, not that it failed", () => {
    const base = { status: "done", total: 3, backedUp: 0, added: 0, alreadyThere: 0, mismatched: [], notSent: [], technique: "different", recordSaved: true };
    const different = ["Etude in C minor, Op. 10, No. 12", "Nocturne", "Waltz"].map((name, i) => ({ id: `p${i}`, name }));
    const lines = describeBackupResult({ ...base, different });
    assert.equal(lines[0].text, "Nothing was added: your account already has a copy of each of these pieces.");
    assert.equal(lines[0].plain, true);
    assert.equal(lines[0].problem, false);
    // names with commas stay readable: separated by semicolons
    assert.equal(lines[1].text, "Already in your account and different, left as it is: Etude in C minor, Op. 10, No. 12; Nocturne; Waltz.");
    assert.equal(describeBackupResult({ ...base, total: 1, different: [different[1]] })[0].text, "Nothing was added: your account already has a copy of this piece.");
  });

  test("a long list of names is cut short, and a real failure still says nothing was backed up", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `Piece ${i + 1}` }));
    const base = { status: "done", total: 7, backedUp: 0, added: 0, alreadyThere: 0, technique: "backedUp", recordSaved: true };
    const cut = describeBackupResult({ ...base, backedUp: 0, different: seven, mismatched: [], notSent: [], technique: "different" });
    assert.equal(cut[1].text, "Already in your account and different, left as it is: Piece 1; Piece 2; Piece 3; Piece 4; Piece 5; and 2 more.");
    const failed = describeBackupResult({ ...base, technique: "notSent", different: [], mismatched: [], notSent: seven });
    assert.equal(failed[0].text, "Nothing was backed up.");
    assert.equal(failed[0].plain, undefined);
    assert.ok(failed.some((l) => l.problem && l.text.startsWith("Couldn't be sent: Piece 1; Piece 2")));
    // some matched: the usual headline, unchanged
    const some = describeBackupResult({ ...base, backedUp: 5, alreadyThere: 5, different: seven.slice(0, 2), mismatched: [], notSent: [], technique: "backedUp" });
    assert.equal(some[0].text, "Backed up and checked: 5 of 7 pieces and the technique library.");
  });

  test("PIECE_SCHEMA_VERSION matches storage.js's CURRENT_SCHEMA_VERSION", () => {
    const m = readFileSync("src/lib/storage.js", "utf8").match(/const CURRENT_SCHEMA_VERSION = (\d+)/);
    assert.ok(m);
    assert.equal(Number(m[1]), PIECE_SCHEMA_VERSION);
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 111: keeping the backup current                               */
/* ------------------------------------------------------------------ */

const USER = "u1";

// Stands in for a device whose first backup has been checked: every piece and
// the technique object recorded at revision 1, as it would be after Pass 110.
function afterFirstBackup(pieces, tech, storage, checkedAt = 1000) {
  const entries = Object.fromEntries(Object.entries(pieces).map(([id, p]) => [id, { revision: 1, fingerprint: pieceFingerprint(p) }]));
  saveDeviceRecord(
    withBackupRecorded(readDeviceRecord(storage), USER, { pieces: entries, technique: { revision: 1, fingerprint: techniqueFingerprint(tech) }, checkedAt }),
    storage
  );
}
const recordOf = (storage) => accountRecordFor(readDeviceRecord(storage), USER);
const accountHolding = (pieces, tech) => ({
  pieceRows: Object.values(pieces).map((p) => pieceRow(p)),
  techniqueRows: [{ user_id: USER, data: reorder(viaJson(tech)), revision: 1 }],
});

// A fake database like the first one, but it answers like the real one does:
// inserts can come back with the new row's revision, every answer carries an
// HTTP status, and `inject(call, rows)` can fail or change any request.
function syncFake({ pieceRows = [], techniqueRows = [], inject = null } = {}) {
  const rows = { pieces: pieceRows.map((r) => ({ ...r })), technique: techniqueRows.map((r) => ({ ...r })) };
  const calls = [];
  const from = (table) => {
    const q = { op: "select", filters: [], values: null, selected: false };
    const hit = (row) => q.filters.every(([c, v]) => row[c] === v);
    const run = () => {
      const filterId = (q.filters.find(([c]) => c === "id") || [])[1];
      const call = { table, op: q.op, id: q.op === "insert" ? q.values.id : filterId, values: q.values, filters: q.filters };
      calls.push(call);
      const injected = inject && inject(call, rows);
      if (injected) return injected;
      if (q.op === "select") return { data: rows[table].filter(hit).map(viaJson), error: null, status: 200 };
      if (q.op === "insert") {
        const dup = rows[table].some((r) => r.user_id === q.values.user_id && (table === "technique" || r.id === q.values.id));
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key value" }, status: 409 };
        rows[table].push({ ...q.values, data: reorder(viaJson(q.values.data)), revision: 1, deleted_at: null });
        return { data: q.selected ? [{ revision: 1 }] : null, error: null, status: 201 };
      }
      const changed = rows[table].filter(hit);
      changed.forEach((r) => {
        const v = viaJson(q.values);
        if (v.data) v.data = reorder(v.data);
        Object.assign(r, v);
        r.revision += 1;
      });
      return { data: changed.map((r) => ({ revision: r.revision })), error: null, status: 200 };
    };
    const api = {
      select: () => ((q.selected = true), api),
      insert: (v) => ((q.op = "insert"), (q.values = v), api),
      update: (v) => ((q.op = "update"), (q.values = v), api),
      eq: (c, v) => (q.filters.push([c, v]), api),
      order: () => api,
      range: () => api,
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return api;
  };
  const client = { from, auth: { getSession: async () => ({ data: { session: { user: { id: USER } } }, error: null }) } };
  return { client, rows, calls, writes: () => calls.filter((c) => c.op !== "select") };
}

const noConnection = () => ({ data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 });
const runSync = (pieces, tech, fake, storage, extra = {}) =>
  syncWaitingChanges({ pieces, technique: tech, userId: USER, getClient: async () => fake.client, storage, now: () => 5000, ...extra });

const three = () => ({ p1: piece("p1"), p2: piece("p2"), p3: piece("p3") });

describe("what's waiting (Pass 111)", () => {
  const plan = (pieces, tech, storage) => computeWaiting({ pieces, technique: tech, accountRecord: recordOf(storage) });

  test("nothing has changed since the last upload: nothing is waiting", () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const w = plan(pieces, technique, storage);
    assert.equal(w.count, 0);
    assert.deepEqual(w.items, []);
    assert.equal(w.firstBackupDone, true);
  });

  test("one piece changed: it is waiting, at the revision the device last saw", () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const changed = { ...pieces, p2: { ...pieces.p2, progress: { c1: { sessions: [{ day: 1 }] } } } };
    const w = plan(changed, technique, storage);
    assert.deepEqual(w.items, [{ kind: "piece", action: "change", id: "p2", name: "Piece p2", expectedRevision: 1 }]);
  });

  test("a piece created after the first backup is waiting to be added", () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const w = plan({ ...pieces, p4: piece("p4") }, technique, storage);
    assert.deepEqual(w.items, [{ kind: "piece", action: "add", id: "p4", name: "Piece p4" }]);
  });

  test("the technique object changed: it is waiting", () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const w = plan(pieces, { ...technique, walkPosition: 4 }, storage);
    assert.deepEqual(w.items, [{ kind: "technique", action: "change", expectedRevision: 1 }]);
  });

  test("a piece deleted here is waiting to be marked deleted, but only once its deletion was noticed", () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const { p3, ...without } = pieces;
    // missing from the pieces map but never seen leaving it (a failed load, say): NOT a deletion
    assert.equal(plan(without, technique, storage).count, 0);
    // noticed: now it is
    const { record, changed } = reconcileLocalDeletions(readDeviceRecord(storage), { removedIds: ["p3"], presentIds: ["p1", "p2"] });
    assert.equal(changed, true);
    saveDeviceRecord(record, storage);
    assert.deepEqual(plan(without, technique, storage).items, [{ kind: "piece", action: "delete", id: "p3", expectedRevision: 1 }]);
  });

  test("before any first backup nothing is waiting, however much is different", () => {
    const storage = memoryStorage();
    const w = plan(three(), technique, storage);
    assert.equal(w.firstBackupDone, false);
    assert.equal(w.count, 0);
    // a record with entries but no checked backup doesn't count either
    saveDeviceRecord({ version: 1, accounts: { [USER]: { pieces: { p1: { revision: 1, fingerprint: "x" } }, technique: null, checkedAt: null, syncedAt: null } } }, storage);
    assert.equal(plan(three(), technique, storage).count, 0);
  });

  test("a held piece is listed as held, not as waiting, even after it changes again", () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    saveDeviceRecord(withPieceHeld(readDeviceRecord(storage), USER, "p2"), storage);
    const changed = { ...pieces, p2: { ...pieces.p2, name: "Edited again" }, p1: { ...pieces.p1, name: "Also edited" } };
    const w = plan(changed, technique, storage);
    assert.deepEqual(w.held.pieces, [{ id: "p2", name: "Edited again", deletedHere: false }]);
    assert.deepEqual(w.items.map((i) => i.id), ["p1"]);
  });

  test("reconcileLocalDeletions marks every account's entry, clears stale marks, and leaves an unchanged record alone", () => {
    const entry = { revision: 3, fingerprint: "f" };
    const record = { version: 1, accounts: { a: { pieces: { x: entry, y: { ...entry, deletedHere: true } }, technique: null, checkedAt: 1, syncedAt: null }, b: { pieces: { x: entry }, technique: null, checkedAt: 1, syncedAt: null } } };
    const out = reconcileLocalDeletions(record, { removedIds: ["x"], presentIds: ["y"] });
    assert.equal(out.changed, true);
    assert.equal(out.record.accounts.a.pieces.x.deletedHere, true);
    assert.equal(out.record.accounts.b.pieces.x.deletedHere, true);
    assert.equal(out.record.accounts.a.pieces.y.deletedHere, undefined);
    assert.equal(record.accounts.a.pieces.x.deletedHere, undefined, "the original record isn't edited");
    const again = reconcileLocalDeletions(out.record, { removedIds: ["x"], presentIds: ["y"] });
    assert.equal(again.changed, false);
    assert.equal(again.record, out.record);
    // an entry that never recorded a revision can't be a deletion
    assert.equal(reconcileLocalDeletions({ version: 1, accounts: { a: { pieces: { z: { held: true } }, technique: null, checkedAt: 1, syncedAt: null } } }, { removedIds: ["z"] }).changed, false);
  });

  test("the record keeps `held`, `deletedHere` and `syncedAt` across a reload", () => {
    const storage = memoryStorage();
    const record = { version: 1, accounts: { [USER]: { pieces: { a: { revision: 2, fingerprint: "f", held: true, deletedHere: true }, b: { held: true } }, technique: { held: true }, checkedAt: 5, syncedAt: 9 } } };
    saveDeviceRecord(record, storage);
    assert.deepEqual(readDeviceRecord(storage), record);
  });

  test("syncSnapshot gives the status what it needs, from the record alone", () => {
    const storage = memoryStorage(), pieces = three();
    assert.equal(syncSnapshot({ pieces, technique, userId: USER, storage }).firstBackupDone, false);
    afterFirstBackup(pieces, technique, storage, 1000);
    saveDeviceRecord(withPieceUploaded(readDeviceRecord(storage), USER, "p1", { revision: 2, fingerprint: pieceFingerprint(pieces.p1) }, 4000), storage);
    const snap = syncSnapshot({ pieces: { ...pieces, p4: piece("p4") }, technique, userId: USER, storage });
    assert.equal(snap.waiting, 1);
    assert.equal(snap.backedUpAt, 4000);
  });
});

// ---------------------------------------------------------------------------
// "The same" means the same after a reload. The app builds a chunk's first
// practice record without `tier1Done` and `troubleSpots`, and a technique task
// without a `tempo`; loading adds them. Found in the browser: a piece uploaded
// that way and then simply reloaded looked changed and went up again (an extra
// revision with nothing changed), and the real technique block in the owner's
// own backups shows the same difference.
// ---------------------------------------------------------------------------
const reloadedPiece = (id = "p1") =>
  validateAndMigratePiece({
    id,
    name: `Piece ${id}`,
    totalMeasures: 32,
    startDate: "2026-09-01",
    createdAt: 1,
    updatedAt: 1,
    sortOrder: 1,
    measureDifficulty: Array(32).fill(1),
    sections: [{ id: "s1", name: "A", start: 1, end: 32 }],
    status: "active",
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    chunkMode: "auto",
    progress: { c1: { sessions: [{ day: 1, loggedDate: "2026-09-02", reps: 3, bpm: 60, durationSeconds: 120 }], doneDays: [1], currentBPM: 60 } },
  });
const inSessionPiece = (id = "p1") => {
  const p = viaJson(reloadedPiece(id));
  delete p.progress.c1.tier1Done;
  delete p.progress.c1.troubleSpots;
  return p;
};
const reloadedTechnique = () =>
  validateAndMigrateTechnique({
    schemaVersion: 1,
    items: [{ id: "t1", tonic: "C", quality: "major" }],
    dayList: { date: "2026-10-01", tasks: [{ itemId: "t1", methodIds: [], done: false, tier: "a" }] },
  });
const inSessionTechnique = () => {
  const t = viaJson(reloadedTechnique());
  delete t.dayList.tasks[0].tempo;
  return t;
};

describe("the same after a reload (Pass 111)", () => {
  test("the fixtures differ as they stand but not once loaded (so the tests below can't pass by accident)", () => {
    assert.equal(sameData(inSessionPiece(), reloadedPiece()), false);
    assert.equal(samePiece(inSessionPiece(), reloadedPiece()), true);
    assert.equal(sameData(inSessionTechnique(), reloadedTechnique()), false);
    assert.equal(sameTechnique(inSessionTechnique(), reloadedTechnique()), true);
    assert.equal(reloadedPiece().progress.c1.tier1Done, false);
    assert.equal(reloadedTechnique().dayList.tasks[0].tempo, null);
  });

  test("a piece or technique uploaded in the app's shape, then reloaded with nothing changed, has nothing waiting", () => {
    const storage = memoryStorage();
    afterFirstBackup({ p1: inSessionPiece() }, inSessionTechnique(), storage);
    const w = computeWaiting({ pieces: { p1: reloadedPiece() }, technique: reloadedTechnique(), accountRecord: recordOf(storage) });
    assert.equal(w.count, 0);
    assert.deepEqual(w.items, []);
  });

  test("the other way round (recorded after a reload, then the app builds it its own way) is also nothing", () => {
    const storage = memoryStorage();
    afterFirstBackup({ p1: reloadedPiece() }, reloadedTechnique(), storage);
    const w = computeWaiting({ pieces: { p1: inSessionPiece() }, technique: inSessionTechnique(), accountRecord: recordOf(storage) });
    assert.equal(w.count, 0);
  });

  test("a real change is still waiting, whatever shape the rest is in", () => {
    const storage = memoryStorage();
    afterFirstBackup({ p1: inSessionPiece() }, inSessionTechnique(), storage);
    const moreWork = reloadedPiece();
    moreWork.progress.c1 = { ...moreWork.progress.c1, sessions: [...moreWork.progress.c1.sessions, { day: 2, loggedDate: "2026-09-03", reps: 3, bpm: 62, durationSeconds: 90 }] };
    const tech = { ...reloadedTechnique(), walkPosition: 3 };
    const w = computeWaiting({ pieces: { p1: moreWork }, technique: tech, accountRecord: recordOf(storage) });
    assert.deepEqual(w.items.map((i) => `${i.kind}:${i.action}`), ["piece:change", "technique:change"]);
  });

  test("a changed value hidden among defaults can't hide: a different default-able field still counts", () => {
    const storage = memoryStorage();
    afterFirstBackup({ p1: reloadedPiece() }, reloadedTechnique(), storage);
    const edited = { ...reloadedPiece(), progress: { c1: { ...reloadedPiece().progress.c1, tier1Done: true } } };
    assert.equal(computeWaiting({ pieces: { p1: edited }, technique: reloadedTechnique(), accountRecord: recordOf(storage) }).count, 1);
  });

  test("a piece with no updatedAt or startDate reads the same from one moment to the next (loading would stamp 'now' on it)", async () => {
    const bare = { id: "p1", name: "Bare", totalMeasures: 32, progress: {} };
    const first = canonicalPiece(bare);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(canonicalPiece(bare), first);
    assert.equal(samePiece(bare, { ...bare }), true);
    assert.equal(pieceFingerprint({ ...bare }), pieceFingerprint({ ...bare }));
  });

  test("odd values are used as they are and never throw", () => {
    assert.equal(canonicalPiece(null), null);
    assert.deepEqual(canonicalPiece({}), {});
    assert.equal(canonicalPiece("x"), "x");
    assert.deepEqual(canonicalPiece([1]), [1]);
    assert.equal(canonicalTechnique(null), null);
    assert.deepEqual(canonicalTechnique([1]), [1]);
    assert.equal(canonicalTechnique("x"), "x");
    assert.equal(typeof pieceFingerprint(null), "string");
  });

  test("comparing with the account: a row in the app's shape matches once loaded, and says it isn't exact", () => {
    const out = compareWithAccount({ p1: reloadedPiece() }, reloadedTechnique(), {
      pieces: [pieceRow(inSessionPiece())],
      technique: { revision: 1, data: reorder(inSessionTechnique()) },
    });
    assert.equal(out.pieces.p1.status, MATCHES);
    assert.equal(out.pieces.p1.exact, false);
    assert.equal(out.technique.status, MATCHES);
    assert.equal(out.technique.exact, false);
    const same = compareWithAccount({ p1: inSessionPiece() }, inSessionTechnique(), {
      pieces: [pieceRow(inSessionPiece())],
      technique: { revision: 1, data: reorder(inSessionTechnique()) },
    });
    assert.equal(same.pieces.p1.exact, true);
    assert.equal(same.technique.exact, true);
  });

  test("a row marked deleted is still not a match, however alike", () => {
    const out = compareWithAccount({ p1: reloadedPiece() }, reloadedTechnique(), {
      pieces: [pieceRow(inSessionPiece(), { deleted_at: "2026-09-30T00:00:00Z" })],
      technique: null,
    });
    assert.equal(out.pieces.p1.status, DIFFERS);
    assert.equal(out.pieces.p1.exact, false);
  });

  test("the first backup: a row already there in the app's shape counts as already there, not 'different'", async () => {
    const fake = fakeClient({ pieceRows: [pieceRow(inSessionPiece())], techniqueRows: [{ user_id: "u1", data: reorder(inSessionTechnique()), revision: 1 }] });
    const result = await backUpDevice({ pieces: { p1: reloadedPiece() }, technique: reloadedTechnique(), userId: "u1", getClient: async () => fake.client, storage: memoryStorage(), now: () => 1000 });
    assert.equal(result.alreadyThere, 1);
    assert.deepEqual(result.different, []);
    assert.equal(result.technique, "backedUp");
    assert.equal(fake.calls.insert.length, 0);
  });

  test("the first backup: a row just written must read back exactly, so a quietly dropped field is still caught", async () => {
    const dropsFields = (table, data) => {
      const d = viaJson(data);
      if (table === "pieces") delete d.progress.c1.tier1Done; // loading would put this back and hide the loss
      else delete d.dayList.tasks[0].tempo;
      return d;
    };
    const fake = fakeClient({ alterInserts: dropsFields });
    const storage = memoryStorage();
    const result = await backUpDevice({ pieces: { p1: reloadedPiece() }, technique: reloadedTechnique(), userId: "u1", getClient: async () => fake.client, storage, now: () => 1000 });
    assert.deepEqual(result.mismatched.map((d) => d.id), ["p1"]);
    assert.equal(result.technique, "mismatched");
    assert.equal(result.backedUp, 0);
    assert.equal(hasRecordedBackup(readDeviceRecord(storage), "u1"), false);
  });

  test("a refusal that finds this device's own earlier upload, in the app's shape, is adopted rather than held", async () => {
    // The upload landed (the row is at revision 2 and holds the change as the
    // app built it) but the note of it didn't, so the record still says
    // revision 1. After a reload this device holds the loaded shape, and the
    // "only if still at revision 1" upload is refused.
    const storage = memoryStorage();
    afterFirstBackup({ p1: reloadedPiece() }, reloadedTechnique(), storage);
    const edited = reloadedPiece();
    edited.progress.c1 = { ...edited.progress.c1, tier1Done: true };
    const rowAsBuilt = viaJson(edited);
    delete rowAsBuilt.progress.c1.troubleSpots;
    const fake = syncFake({
      pieceRows: [pieceRow(rowAsBuilt, { user_id: USER, revision: 2 })],
      techniqueRows: [{ user_id: USER, data: reorder(viaJson(reloadedTechnique())), revision: 1 }],
    });
    const r = await runSync({ p1: edited }, reloadedTechnique(), fake, storage);
    assert.equal(r.newlyHeld.length, 0, "not held as 'changed on another device'");
    assert.equal(r.resolved, 1);
    assert.deepEqual(recordOf(storage).pieces.p1, { revision: 2, fingerprint: pieceFingerprint(edited) });
  });
});

describe("uploading what's waiting (Pass 111)", () => {
  test("a changed piece goes up only if still at its revision, and the record takes the revision the database returns", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const changed = { ...pieces, p2: { ...pieces.p2, progress: { c1: { sessions: [{ day: 1 }] } } } };
    const r = await runSync(changed, technique, fake, storage);
    assert.equal(r.status, "done");
    assert.equal(r.uploaded, 1);
    const writes = fake.writes();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].op, "update");
    assert.deepEqual(writes[0].filters.filter(([c]) => c === "revision"), [["revision", 1]]); // "only if still at revision 1"
    const row = fake.rows.pieces.find((x) => x.id === "p2");
    assert.equal(row.revision, 2);
    assert.equal(sameData(row.data, changed.p2), true);
    const rec = recordOf(storage);
    assert.deepEqual(rec.pieces.p2, { revision: 2, fingerprint: pieceFingerprint(changed.p2) });
    assert.equal(rec.syncedAt, 5000);
    assert.equal(computeWaiting({ pieces: changed, technique, accountRecord: rec }).count, 0);
  });

  test("with nothing waiting, nothing is sent and the account library isn't even asked for", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    let asked = 0;
    const fake = syncFake(accountHolding(pieces, technique));
    const r = await syncWaitingChanges({ pieces, technique, userId: USER, storage, getClient: async () => (asked++, fake.client) });
    assert.equal(r.status, "done");
    assert.equal(asked, 0);
    assert.equal(fake.calls.length, 0);
  });

  test("before any first backup nothing uploads by itself, and the library isn't asked for", async () => {
    const storage = memoryStorage();
    let asked = 0;
    const fake = syncFake();
    const r = await syncWaitingChanges({ pieces: three(), technique, userId: USER, storage, getClient: async () => (asked++, fake.client) });
    assert.equal(r.status, "done");
    assert.equal(r.uploaded, 0);
    assert.equal(asked, 0);
    assert.equal(fake.calls.length, 0);
  });

  test("a piece deleted here is marked deleted in the account: the row stays, only deleted_at is sent", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const { p3, ...without } = pieces;
    saveDeviceRecord(reconcileLocalDeletions(readDeviceRecord(storage), { removedIds: ["p3"], presentIds: ["p1", "p2"] }).record, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const r = await runSync(without, technique, fake, storage);
    assert.equal(r.uploaded, 1);
    const row = fake.rows.pieces.find((x) => x.id === "p3");
    assert.ok(row, "the row is still in the table");
    assert.ok(row.deleted_at, "and is marked deleted");
    assert.equal(row.revision, 2);
    assert.equal(sameData(row.data, p3), true, "its data is untouched");
    const writes = fake.writes();
    assert.equal(writes.length, 1);
    assert.deepEqual(Object.keys(writes[0].values), ["deleted_at"]);
    assert.deepEqual(writes[0].filters.filter(([c]) => c === "revision"), [["revision", 1]]);
    assert.equal(recordOf(storage).pieces.p3, undefined, "the device has nothing left to remember about it");
    assert.equal(computeWaiting({ pieces: without, technique, accountRecord: recordOf(storage) }).count, 0);
  });

  test("a piece created after the first backup is added, and the record takes the revision the database returns", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const withNew = { ...pieces, p4: piece("p4") };
    const r = await runSync(withNew, technique, fake, storage);
    assert.equal(r.uploaded, 1);
    assert.equal(fake.writes()[0].op, "insert");
    assert.deepEqual(recordOf(storage).pieces.p4, { revision: 1, fingerprint: pieceFingerprint(withNew.p4) });
    assert.equal(sameData(fake.rows.pieces.find((x) => x.id === "p4").data, withNew.p4), true);
  });

  test("the technique object goes up the same way", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const tech2 = { ...technique, walkPosition: 4 };
    const r = await runSync(pieces, tech2, fake, storage);
    assert.equal(r.uploaded, 1);
    assert.equal(fake.rows.technique[0].revision, 2);
    assert.deepEqual(recordOf(storage).technique, { revision: 2, fingerprint: techniqueFingerprint(tech2) });
  });

  test("several changes go up in one run, and a second run has nothing left to do", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const changed = { p1: { ...pieces.p1, name: "A" }, p2: { ...pieces.p2, name: "B" }, p3: pieces.p3, p4: piece("p4") };
    const tech2 = { ...technique, walkPosition: 7 };
    const r = await runSync(changed, tech2, fake, storage);
    assert.equal(r.uploaded, 4);
    assert.equal(r.remaining, 0);
    const calls = fake.calls.length;
    await runSync(changed, tech2, fake, storage);
    assert.equal(fake.calls.length, calls, "nothing sent twice");
  });

  test("deletePieceRow sends only deleted_at, only if still at the revision, and reports a conflict if it moved", async () => {
    const pieces = three();
    const fake = syncFake(accountHolding(pieces, technique));
    fake.rows.pieces.find((x) => x.id === "p1").revision = 4;
    const stale = await deletePieceRow(fake.client, USER, "p1", 1, "2026-10-02T00:00:00.000Z");
    assert.deepEqual(stale, { ok: false, conflict: true });
    assert.equal(fake.rows.pieces.find((x) => x.id === "p1").deleted_at, null);
    const fresh = await deletePieceRow(fake.client, USER, "p1", 4, "2026-10-02T00:00:00.000Z");
    assert.deepEqual(fresh, { ok: true, revision: 5 });
    assert.equal(fake.rows.pieces.find((x) => x.id === "p1").deleted_at, "2026-10-02T00:00:00.000Z");
  });
});

describe("refusals and failures (Pass 111)", () => {
  // Another device changed a piece's row: its revision went up and its content differs.
  const movedOn = (fake, id, name = "Edited on another device") => {
    const row = fake.rows.pieces.find((x) => x.id === id);
    row.revision += 1;
    row.data = { ...row.data, name };
    return row;
  };

  test("a refusal holds the piece, leaves this device's copy alone, and is never retried", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const row = movedOn(fake, "p2");
    const mine = { ...pieces.p2, name: "Edited here" };
    const changed = { ...pieces, p2: mine };

    const r = await runSync(changed, technique, fake, storage);
    assert.equal(r.status, "done");
    assert.equal(r.uploaded, 0);
    assert.deepEqual(r.newlyHeld, [{ kind: "piece", id: "p2", name: "Edited here" }]);
    assert.equal(recordOf(storage).pieces.p2.held, true);
    assert.equal(row.data.name, "Edited on another device", "the account's copy is untouched");
    assert.equal(changed.p2, mine, "this device's copy is exactly as it was");
    assert.equal(syncOutcome(r), "success", "a refusal is held, not retried, so it isn't a failure either");

    // never retried: however many times it runs, nothing more is sent
    const sent = fake.calls.length;
    await runSync(changed, technique, fake, storage);
    await runSync(changed, technique, fake, storage);
    assert.equal(fake.calls.length, sent);
    assert.deepEqual(computeWaiting({ pieces: changed, technique, accountRecord: recordOf(storage) }).held.pieces.map((p) => p.id), ["p2"]);
  });

  test("a held piece doesn't stop the others, whichever comes first", async () => {
    for (const refused of ["p1", "p2"]) {
      const other = refused === "p1" ? "p2" : "p1";
      const storage = memoryStorage(), pieces = three();
      afterFirstBackup(pieces, technique, storage);
      const fake = syncFake(accountHolding(pieces, technique));
      movedOn(fake, refused);
      const changed = { ...pieces, [refused]: { ...pieces[refused], name: "Mine" }, [other]: { ...pieces[other], name: "Also mine" } };
      const r = await runSync(changed, technique, fake, storage);
      assert.equal(r.uploaded, 1, `the other piece went up (refused: ${refused})`);
      assert.deepEqual(r.newlyHeld.map((h) => h.id), [refused]);
      assert.equal(fake.rows.pieces.find((x) => x.id === other).revision, 2);
      assert.equal(recordOf(storage).pieces[other].revision, 2);
    }
  });

  test("a refusal where the account already holds exactly this device's copy is not a conflict", async () => {
    // another tab of this browser uploaded it first, or this device's own upload landed but its note of it didn't
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const mine = { ...pieces.p2, name: "Edited here" };
    const row = fake.rows.pieces.find((x) => x.id === "p2");
    row.revision = 2;
    row.data = reorder(viaJson(mine));
    const r = await runSync({ ...pieces, p2: mine }, technique, fake, storage);
    assert.equal(r.resolved, 1);
    assert.deepEqual(r.newlyHeld, []);
    assert.deepEqual(recordOf(storage).pieces.p2, { revision: 2, fingerprint: pieceFingerprint(mine) });
  });

  test("a refusal because the row is gone puts it back, and a deletion with no row has nothing to delete", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    fake.rows.pieces = fake.rows.pieces.filter((x) => x.id !== "p2" && x.id !== "p3"); // wiped in the dashboard
    saveDeviceRecord(reconcileLocalDeletions(readDeviceRecord(storage), { removedIds: ["p3"], presentIds: ["p1", "p2"] }).record, storage);
    const mine = { ...pieces.p2, name: "Edited here" };
    const r = await runSync({ p1: pieces.p1, p2: mine }, technique, fake, storage);
    assert.equal(r.uploaded, 1);
    assert.equal(r.resolved, 1);
    assert.deepEqual(r.newlyHeld, []);
    assert.equal(sameData(fake.rows.pieces.find((x) => x.id === "p2").data, mine), true);
    assert.equal(recordOf(storage).pieces.p3, undefined);
  });

  test("a piece the device has no entry for is never uploaded over a row that's already there", async () => {
    // e.g. a piece the first backup listed as "already in your account and different"
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const theirs = { ...piece("p4"), name: "Their p4" };
    const fake = syncFake({ ...accountHolding(pieces, technique), pieceRows: [...accountHolding(pieces, technique).pieceRows, pieceRow(theirs)] });
    const mine = { ...piece("p4"), name: "My p4" };
    const r = await runSync({ ...pieces, p4: mine }, technique, fake, storage);
    assert.deepEqual(r.newlyHeld, [{ kind: "piece", id: "p4", name: "My p4" }]);
    assert.equal(fake.rows.pieces.find((x) => x.id === "p4").data.name, "Their p4", "the account's copy is untouched");
    assert.equal(recordOf(storage).pieces.p4.held, true);
  });

  test("a refused technique upload is held the same way", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    fake.rows.technique[0].revision = 3;
    fake.rows.technique[0].data = { ...fake.rows.technique[0].data, walkPosition: 9 };
    const r = await runSync(pieces, { ...technique, walkPosition: 4 }, fake, storage);
    assert.deepEqual(r.newlyHeld, [{ kind: "technique" }]);
    assert.equal(recordOf(storage).technique.held, true);
    assert.equal(fake.rows.technique[0].data.walkPosition, 9);
  });

  test("no connection leaves everything waiting: nothing is held, the record is unchanged, the rest isn't tried", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake({ ...accountHolding(pieces, technique), inject: (call) => (call.op === "update" ? noConnection() : null) });
    const changed = { ...pieces, p1: { ...pieces.p1, name: "A" }, p2: { ...pieces.p2, name: "B" } };
    const before = JSON.stringify(readDeviceRecord(storage));
    const r = await runSync(changed, technique, fake, storage);
    assert.equal(r.status, "stopped");
    assert.equal(r.reason, "connection");
    assert.equal(r.remaining, 2);
    assert.deepEqual(r.newlyHeld, []);
    assert.equal(JSON.stringify(readDeviceRecord(storage)), before);
    assert.equal(fake.calls.filter((c) => c.op === "update").length, 1, "it stopped at the first one");
    assert.equal(syncOutcome(r), "failure");
  });

  test("a server error means the service isn't answering (retried later), not a refusal", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const down = () => ({ data: null, error: { message: "Service Unavailable", code: "" }, status: 503 });
    const fake = syncFake({ ...accountHolding(pieces, technique), inject: (call) => (call.op === "update" ? down() : null) });
    const r = await runSync({ ...pieces, p1: { ...pieces.p1, name: "A" } }, technique, fake, storage);
    assert.equal(r.status, "stopped");
    assert.equal(r.reason, "connection");
    assert.deepEqual(r.newlyHeld, []);
    assert.equal(recordOf(storage).pieces.p1.held, undefined);
  });

  test("something else the database objects to on one piece leaves that piece waiting, and the others still go", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const bad = () => ({ data: null, error: { message: "unsupported Unicode escape sequence", code: "22P05" }, status: 400 });
    const fake = syncFake({ ...accountHolding(pieces, technique), inject: (call) => (call.op === "update" && call.id === "p1" ? bad() : null) });
    const changed = { ...pieces, p1: { ...pieces.p1, name: "A" }, p2: { ...pieces.p2, name: "B" } };
    const r = await runSync(changed, technique, fake, storage);
    assert.equal(r.status, "done");
    assert.equal(r.failed, 1);
    assert.equal(r.uploaded, 1);
    assert.equal(r.remaining, 1);
    assert.equal(syncOutcome(r), "failure");
    assert.equal(recordOf(storage).pieces.p1.held, undefined, "failing isn't being refused");
  });

  test("signed out (or into another account): nothing is sent", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    fake.client.auth.getSession = async () => ({ data: { session: null }, error: null });
    const r = await runSync({ ...pieces, p1: { ...pieces.p1, name: "A" } }, technique, fake, storage);
    assert.equal(r.status, "stopped");
    assert.equal(r.reason, "signed-out");
    assert.equal(fake.calls.length, 0);
    assert.equal(syncOutcome(r), "idle");
    fake.client.auth.getSession = async () => ({ data: { session: { user: { id: "someone-else" } } }, error: null });
    assert.equal((await runSync({ ...pieces, p1: { ...pieces.p1, name: "A" } }, technique, fake, storage)).reason, "signed-out");
  });

  test("signing out mid-run stops before the next item", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    let cancelled = false;
    const changed = { ...pieces, p1: { ...pieces.p1, name: "A" }, p2: { ...pieces.p2, name: "B" } };
    fake.client.auth.getSession = async () => ({ data: { session: { user: { id: USER } } }, error: null });
    const r = await runSync(changed, technique, fake, storage, { isCancelled: () => cancelled || (cancelled = fake.writes().length >= 1) });
    assert.equal(r.status, "stopped");
    assert.equal(r.reason, "cancelled");
    assert.equal(fake.writes().length, 1);
    assert.equal(syncOutcome(r), "idle");
  });

  test("an item another tab has already uploaded is skipped, not uploaded twice", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const changed = { ...pieces, p1: { ...pieces.p1, name: "A" }, p2: { ...pieces.p2, name: "B" } };
    const fake = syncFake({
      ...accountHolding(pieces, technique),
      inject: (call) => {
        if (call.op === "update" && call.id === "p1") {
          // while p1 goes up, "another tab" records p2 as already uploaded
          saveDeviceRecord(withPieceUploaded(readDeviceRecord(storage), USER, "p2", { revision: 2, fingerprint: pieceFingerprint(changed.p2) }, 4000), storage);
        }
        return null;
      },
    });
    const r = await runSync(changed, technique, fake, storage);
    assert.equal(r.uploaded, 1);
    assert.deepEqual(fake.writes().map((c) => c.id), ["p1"]);
  });
});

describe("a second browser (Pass 111)", () => {
  // A fresh browser signed in to an account that already has a library: its
  // own technique library is empty (or at least different), the account holds
  // the real one. That's the situation the owner's preview checks start from.
  const accountLibrary = () => ({ ...reloadedTechnique(), walkPosition: 5 });
  const emptyLibrary = () => validateAndMigrateTechnique({});

  test("the first backup adds this browser's piece and leaves the account's technique library alone; the automatic upload then holds that library and still sends the piece", async () => {
    const storage = memoryStorage();
    const fake = syncFake({
      pieceRows: [pieceRow(piece("old"), { user_id: USER })],
      techniqueRows: [{ user_id: USER, data: reorder(viaJson(accountLibrary())), revision: 1 }],
    });
    const mine = { n1: piece("n1") };
    const first = await backUpDevice({ pieces: mine, technique: emptyLibrary(), userId: USER, getClient: async () => fake.client, storage, now: () => 1000 });
    assert.equal(first.added, 1);
    assert.equal(first.technique, "different");
    assert.equal(fake.rows.technique[0].revision, 1, "the account's library is untouched");

    // Nothing waits for the piece; the library has no record, so it's an add.
    const waiting = computeWaiting({ pieces: mine, technique: emptyLibrary(), accountRecord: recordOf(storage) });
    assert.deepEqual(waiting.items.map((i) => `${i.kind}:${i.action}`), ["technique:add"]);

    // The add is refused (the row exists), read again, found different: held.
    const lib = emptyLibrary();
    const r = await runSync(mine, lib, fake, storage);
    assert.deepEqual(r.newlyHeld, [{ kind: "technique" }]);
    assert.equal(fake.rows.technique[0].revision, 1);
    assert.equal(recordOf(storage).technique.held, true);
    assert.equal(describeSyncStatus({ now: 9000, firstBackupDone: true, backedUpAt: 1000, waiting: 0, held: computeWaiting({ pieces: mine, technique: lib, accountRecord: recordOf(storage) }).held, failures: 0 }).text, "The technique library changed on another device");

    // A change to the piece still goes up, and the held library isn't tried again.
    const callsBefore = fake.calls.length;
    const changed = { n1: { ...mine.n1, name: "Renamed" } };
    const r2 = await runSync(changed, lib, fake, storage);
    assert.equal(r2.uploaded, 1);
    assert.deepEqual(r2.newlyHeld, []);
    assert.equal(fake.calls.slice(callsBefore).filter((c) => c.table === "technique").length, 0, "the held library isn't touched again");
    assert.equal(fake.rows.pieces.find((row) => row.id === "n1").revision, 2);
  });
});

describe("timing and the status line (Pass 111)", () => {
  test("it waits a few seconds after the last change, but never keeps a change waiting more than a minute", () => {
    assert.equal(SYNC_QUIET_MS, 5000);
    assert.equal(quietDelayMs(100000, null), 5000, "a change that just arrived");
    assert.equal(quietDelayMs(100000, 100000), 5000);
    assert.equal(quietDelayMs(100000, 100000 - 58000), 2000, "the oldest unsent change is 58 seconds old");
    assert.equal(quietDelayMs(100000, 100000 - SYNC_MAX_WAIT_MS), 0);
    assert.equal(quietDelayMs(100000, 100000 - 5 * SYNC_MAX_WAIT_MS), 0, "long overdue still isn't negative");
  });

  test("retry gaps grow (30 seconds, 2 minutes, 10 minutes) and start over after a success", () => {
    assert.deepEqual(RETRY_GAPS_MS, [30000, 120000, 600000]);
    let failures = 0;
    const gaps = [];
    for (let i = 0; i < 5; i++) {
      failures = nextFailureCount(failures, "failure");
      gaps.push(retryGapMs(failures));
    }
    assert.deepEqual(gaps, [30000, 120000, 600000, 600000, 600000]);
    failures = nextFailureCount(failures, "success");
    assert.equal(failures, 0);
    assert.equal(retryGapMs(nextFailureCount(failures, "failure")), 30000, "the next failure starts at 30 seconds again");
    assert.equal(nextFailureCount(2, "idle"), 2, "signing out is neither");
  });

  test("what counts as a failed run, a good one, or neither", () => {
    assert.equal(syncOutcome({ status: "done", failed: 0, newlyHeld: [{ kind: "piece" }] }), "success", "a held piece is not retried, so it is not a failure");
    assert.equal(syncOutcome({ status: "done", failed: 1 }), "failure");
    assert.equal(syncOutcome({ status: "stopped", reason: "connection" }), "failure");
    assert.equal(syncOutcome({ status: "stopped", reason: "other" }), "failure");
    assert.equal(syncOutcome({ status: "stopped", reason: "signed-out" }), "idle");
    assert.equal(syncOutcome({ status: "stopped", reason: "cancelled" }), "idle");
    assert.equal(syncOutcome(null), "failure");
  });

  test("times read the way a person would say them", () => {
    assert.equal(describeAgo(0), "just now");
    assert.equal(describeAgo(59000), "just now");
    assert.equal(describeAgo(60000), "1 minute ago");
    assert.equal(describeAgo(5 * 60000 + 30000), "5 minutes ago");
    assert.equal(describeAgo(60 * 60000), "1 hour ago");
    assert.equal(describeAgo(3 * 3600000 + 59 * 60000), "3 hours ago");
    assert.equal(describeAgo(24 * 3600000), "1 day ago");
    assert.equal(describeAgo(3 * 24 * 3600000), "3 days ago");
    assert.equal(describeAgo(-5000), "just now", "a clock that moved back never says a negative time");
  });

  const none = { pieces: [], technique: false };
  const status = (over) => describeSyncStatus({ now: 1000000, firstBackupDone: true, backedUpAt: 1000000, waiting: 0, held: none, failures: 0, ...over });

  test("the status line, for each state", () => {
    assert.equal(status({ firstBackupDone: false }), null, "before the first backup there's no status at all");
    assert.deepEqual(status({}), { tone: "ok", text: "Backed up just now" });
    assert.equal(status({ backedUpAt: 1000000 - 3 * 3600000 }).text, "Backed up 3 hours ago");
    assert.equal(status({ backedUpAt: null }), null);
    assert.deepEqual(status({ waiting: 1 }), { tone: "quiet", text: "1 change waiting to back up" });
    assert.equal(status({ waiting: 2 }).text, "2 changes waiting to back up");
    assert.deepEqual(status({ failures: NOT_ANSWERING_AFTER }), {
      tone: "quiet",
      text: "The account service isn't answering. Everything is still saved on this device.",
    });
    assert.equal(status({ failures: NOT_ANSWERING_AFTER - 1, waiting: 2 }).text, "2 changes waiting to back up", "one failure isn't enough to say so");
  });

  test("a piece held as changed on another device is named", () => {
    const one = { pieces: [{ id: "b", name: "Ballade No. 1", deletedHere: false }], technique: false };
    assert.deepEqual(status({ held: one }), { tone: "problem", text: "1 piece changed on another device: Ballade No. 1" });
    const two = { pieces: [{ id: "a", name: "Etude" }, { id: "b", name: "Waltz" }], technique: false };
    assert.equal(status({ held: two }).text, "2 pieces changed on another device: Etude; Waltz");
    const many = { pieces: ["A", "B", "C", "D", "E"].map((name, i) => ({ id: `p${i}`, name })), technique: false };
    assert.equal(status({ held: many }).text, "5 pieces changed on another device: A; B; C; and 2 more");
    assert.equal(status({ held: { pieces: [], technique: true } }).text, "The technique library changed on another device");
    assert.equal(status({ held: { pieces: one.pieces, technique: true } }).text, "1 piece and the technique library changed on another device: Ballade No. 1");
    const gone = { pieces: [{ id: "x", name: null, deletedHere: true }], technique: false };
    assert.equal(status({ held: gone }).text, "1 piece changed on another device: a piece deleted here");
  });

  test("which line wins when more than one is true", () => {
    const held = { pieces: [{ id: "b", name: "Ballade No. 1" }], technique: false };
    assert.match(status({ held, waiting: 3 }).text, /changed on another device/, "held beats waiting");
    assert.match(status({ held, waiting: 3, failures: NOT_ANSWERING_AFTER }).text, /isn't answering/, "not answering beats held");
    assert.match(status({ waiting: 3 }).text, /waiting/, "waiting beats backed up");
  });

  test("the banner names what's held and says what happens next", () => {
    const b = describeHeldBanner({ pieces: [{ id: "b", name: "Ballade No. 1" }], technique: false });
    assert.equal(b.title, "1 piece changed on another device");
    assert.match(b.sub, /^Ballade No\. 1\. This device's copy is unchanged and hasn't been uploaded over the account's\./);
    assert.match(b.sub, /Everything else keeps backing up\./);
    assert.match(b.sub, /Press Review to settle it\.$/);
    assert.equal(describeHeldBanner({ pieces: [], technique: true }).title, "The technique library changed on another device");
    assert.equal(describeHeld({ pieces: [], technique: false }), "The technique library changed on another device", "never blank even if asked about nothing");
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 112: restore, get changes, settle                             */
/* ------------------------------------------------------------------ */

// A realistic piece (the same function a load uses), with whatever's given.
const pieceOf = (id, extra = {}) =>
  validateAndMigratePiece({
    id,
    name: `Piece ${id}`,
    totalMeasures: 32,
    startDate: "2026-09-01",
    createdAt: 1000,
    updatedAt: 1000,
    sortOrder: 1,
    measureDifficulty: Array(32).fill(1),
    sections: [{ id: "s1", name: "A", start: 1, end: 32 }],
    status: "active",
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    chunkMode: "auto",
    progress: { c1: { sessions: [{ day: 1, loggedDate: "2026-09-02", reps: 3, bpm: 60, durationSeconds: 120 }], doneDays: [1], currentBPM: 60 } },
    ...extra,
  });
// The same piece with one more logged session, and a later updatedAt.
const withMore = (p, day, updatedAt = (p.updatedAt || 0) + 1000) =>
  validateAndMigratePiece({
    ...viaJson(p),
    updatedAt,
    progress: { ...viaJson(p).progress, c1: { ...viaJson(p).progress.c1, sessions: [...viaJson(p).progress.c1.sessions, { day, loggedDate: `2026-09-0${day + 1}`, reps: 3, bpm: 60 + day, durationSeconds: 90 }], doneDays: [1, day] } },
  });
// Account rows, as readAccountRows gives them.
const acctRow = (p, revision = 1, extra = {}) => ({ id: p.id, revision, deleted_at: null, data: reorder(viaJson(p)), ...extra });
// A device record in which each piece is recorded as synced at a revision.
const syncedRecord = (entries, { checkedAt = 1000, technique = null } = {}) => ({
  pieces: Object.fromEntries(Object.entries(entries).map(([id, [p, revision]]) => [id, { revision, fingerprint: pieceFingerprint(p) }])),
  technique,
  checkedAt,
  syncedAt: null,
});

describe("rows from the account become import candidates (Pass 112)", () => {
  test("rows marked deleted are skipped (and listed), and every other row is validated", () => {
    const live = pieceOf("p1");
    const bare = { id: "p2", name: "Needs backfilling", totalMeasures: 16, progress: {} }; // an older, sparse shape
    const out = accountRowsToCandidates({
      pieces: [acctRow(live, 3), acctRow(bare, 2), acctRow(pieceOf("p3"), 5, { deleted_at: "2026-10-01T00:00:00Z" })],
      technique: null,
    });
    assert.deepEqual(out.pieces.map((c) => [c.id, c.revision]), [["p1", 3], ["p2", 2]]);
    assert.deepEqual(out.deleted.map((d) => [d.id, d.revision, d.name]), [["p3", 5, "Piece p3"]]);
    // validated: the sparse piece got the backfill a stored piece gets on load
    assert.ok(out.pieces[1].piece.ladderConfig, "ladderConfig backfilled");
    assert.ok(Array.isArray(out.pieces[1].piece.sections));
    assert.equal(out.pieces[0].piece.name, "Piece p1");
  });

  test("the row's id is the piece's id, and a row that can't be read is reported, not dropped silently", () => {
    const wrongId = { ...viaJson(pieceOf("p1")), id: "something-else" };
    const out = accountRowsToCandidates({
      pieces: [{ id: "p1", revision: 1, deleted_at: null, data: wrongId }, { id: "p9", revision: 4, deleted_at: null, data: { nope: true } }, { id: "p8", revision: 1, deleted_at: null, data: null }],
      technique: null,
    });
    assert.equal(out.pieces.length, 1);
    assert.equal(out.pieces[0].piece.id, "p1");
    assert.deepEqual(out.unreadable.map((u) => u.id), ["p9", "p8"]);
  });

  test("the technique row is read the way a backup's technique block is", () => {
    const ok = accountRowsToCandidates({ pieces: [], technique: { revision: 2, data: reorder(viaJson(reloadedTechnique())) } });
    assert.equal(ok.technique.revision, 2);
    assert.equal(ok.technique.unreadable, false);
    assert.equal(ok.technique.technique.items.length, 1);
    const bad = accountRowsToCandidates({ pieces: [], technique: { revision: 2, data: { items: "not a list" } } });
    assert.equal(bad.technique.unreadable, true);
    assert.equal(bad.technique.technique, null);
    const skipped = accountRowsToCandidates({ pieces: [], technique: { revision: 2, data: { items: [{ id: "t1", tonic: "C", quality: "major" }, { nonsense: true }] } } });
    assert.equal(skipped.technique.skippedItems, 1);
    assert.equal(accountRowsToCandidates({ pieces: [], technique: null }).technique.technique, null);
  });
});

describe("the no-ask rule (Pass 112)", () => {
  const base = pieceOf("p1");
  const row = (revision) => ({ revision });

  test("nothing waiting here and the account changed since: take it without asking", () => {
    const entry = { revision: 3, fingerprint: pieceFingerprint(base) };
    assert.equal(nothingWaitingHere(base, entry), true);
    assert.equal(accountHasNewerCopy(row(4), entry), true);
    assert.equal(canTakeAccountCopyWithoutAsking({ localPiece: base, entry, row: row(4) }), true);
  });

  test("a change waiting here means ask, even though the account is newer", () => {
    const entry = { revision: 3, fingerprint: pieceFingerprint(base) };
    const changedHere = withMore(base, 2);
    assert.equal(nothingWaitingHere(changedHere, entry), false);
    assert.equal(canTakeAccountCopyWithoutAsking({ localPiece: changedHere, entry, row: row(4) }), false);
  });

  test("the account not having changed (same revision) is not 'newer'", () => {
    const entry = { revision: 3, fingerprint: pieceFingerprint(base) };
    assert.equal(canTakeAccountCopyWithoutAsking({ localPiece: base, entry, row: row(3) }), false);
    assert.equal(canTakeAccountCopyWithoutAsking({ localPiece: base, entry, row: row(2) }), false);
  });

  test("a piece this device has no record of, or only a held mark for, can't be vouched for: ask", () => {
    assert.equal(canTakeAccountCopyWithoutAsking({ localPiece: base, entry: undefined, row: row(9) }), false);
    assert.equal(canTakeAccountCopyWithoutAsking({ localPiece: base, entry: { held: true }, row: row(9) }), false);
  });
});

describe("planning what a restore / get changes would do (Pass 112)", () => {
  const plan = ({ local = {}, rows, record, tech = reloadedTechnique() }) =>
    planAccountMerge({ candidates: accountRowsToCandidates(rows), localPieces: local, localTechnique: tech, accountRecord: record || syncedRecord({}) });
  const kinds = (p) => Object.fromEntries(p.items.map((i) => [i.id, i.kind]));

  test("every kind: new, same, take, ask", () => {
    const same = pieceOf("same"), takeBase = pieceOf("take"), askBase = pieceOf("ask");
    const local = { same, take: takeBase, ask: withMore(askBase, 2) };
    const record = syncedRecord({ same: [same, 1], take: [takeBase, 1], ask: [askBase, 1] });
    const p = plan({
      local,
      record,
      rows: { pieces: [acctRow(pieceOf("new"), 1), acctRow(same, 1), acctRow(withMore(takeBase, 2), 2), acctRow(withMore(askBase, 3), 2)], technique: null },
    });
    assert.deepEqual(kinds(p), { new: "new", same: "same", take: "take", ask: "ask" });
    assert.equal(planNeedsQuestion(p), true);
  });

  test("taking and matching alone need no question", () => {
    const same = pieceOf("same"), takeBase = pieceOf("take");
    const p = plan({
      local: { same, take: takeBase },
      record: syncedRecord({ same: [same, 1], take: [takeBase, 1] }),
      rows: { pieces: [acctRow(same, 1), acctRow(withMore(takeBase, 2), 2)], technique: null },
    });
    assert.deepEqual(kinds(p), { same: "same", take: "take" });
    assert.equal(planNeedsQuestion(p), false);
  });

  test("a piece that matches except for its created date is 'same' (a file import re-stamps it)", () => {
    const original = pieceOf("p1", { createdAt: 1000 });
    const restamped = { ...viaJson(original), createdAt: 999999 };
    const p = plan({ local: { p1: restamped }, rows: { pieces: [acctRow(original, 4)], technique: null } });
    assert.equal(p.items[0].kind, "same");
    assert.equal(p.items[0].alignCreatedAt, true);
  });

  test("two copies of one piece under different ids are matched by name: combine, with the account's other row to mark deleted", () => {
    const here = { ...viaJson(pieceOf("L1")), name: "Ballade No. 1", composer: "Chopin" };
    const there = { ...viaJson(pieceOf("R1")), name: "ballade no. 1", composer: "Chopin" };
    const p = plan({ local: { L1: validateAndMigratePiece(here) }, rows: { pieces: [acctRow(validateAndMigratePiece(there), 7)], technique: null } });
    assert.equal(p.items.length, 1);
    assert.equal(p.items[0].kind, "combine");
    assert.equal(p.items[0].matchId, "L1");
    assert.deepEqual(p.items[0].otherRow, { id: "R1", revision: 7 });
  });

  test("two account rows with the same name collapse into one new piece and one combine", () => {
    const a = validateAndMigratePiece({ ...viaJson(pieceOf("A1")), name: "Same Name" });
    const b = validateAndMigratePiece({ ...viaJson(pieceOf("B1")), name: "Same Name" });
    const p = plan({ rows: { pieces: [acctRow(a, 1), acctRow(b, 2)], technique: null } });
    assert.deepEqual(p.items.map((i) => [i.id, i.kind, i.matchId]), [["A1", "new", null], ["B1", "combine", "A1"]]);
  });

  test("a piece that's marked deleted in the account but still here is listed as 'deleted on another device'", () => {
    const here = pieceOf("gone");
    const changedHere = withMore(pieceOf("gone2"), 2);
    const p = plan({
      local: { gone: here, gone2: changedHere },
      record: syncedRecord({ gone: [here, 1], gone2: [pieceOf("gone2"), 1] }),
      rows: { pieces: [acctRow(here, 2, { deleted_at: "2026-10-01T00:00:00Z" }), acctRow(changedHere, 2, { deleted_at: "2026-10-01T00:00:00Z" }), acctRow(pieceOf("elsewhere"), 3, { deleted_at: "2026-10-01T00:00:00Z" })], technique: null },
    });
    assert.deepEqual(p.deletedElsewhere.map((d) => [d.id, d.name, d.hasUnsyncedChanges]), [["gone", "Piece gone", false], ["gone2", "Piece gone2", true]]);
    assert.equal(p.items.length, 0, "a deleted row is never a candidate");
    assert.equal(planNeedsQuestion(p), true);
  });

  test("the extra copy that was marked deleted when two were combined elsewhere is never what the surviving copy is combined into", () => {
    // Device A combined its Ballade with this device's (bal_b) and kept bal_a. Here: bal_b is still
    // on this device, and the account marks it deleted. The live bal_a must come in as a NEW piece,
    // not be "combined" into bal_b (which would mark the surviving row deleted too).
    const stale = validateAndMigratePiece({ ...viaJson(pieceOf("bal_b")), name: "Ballade No. 1", composer: "Chopin" });
    const survivor = validateAndMigratePiece({ ...viaJson(pieceOf("bal_a")), name: "Ballade No. 1", composer: "Chopin" });
    const p = plan({
      local: { bal_b: stale },
      record: syncedRecord({ bal_b: [stale, 1] }),
      rows: { pieces: [acctRow(survivor, 2), acctRow(stale, 2, { deleted_at: "2026-10-04T00:00:00Z" })], technique: null },
    });
    assert.deepEqual(p.items.map((i) => [i.id, i.kind]), [["bal_a", "new"]]);
    assert.deepEqual(p.deletedElsewhere.map((d) => d.id), ["bal_b"]);
    const out = applyAccountMerge({ candidates: accountRowsToCandidates({ pieces: [acctRow(survivor, 2), acctRow(stale, 2, { deleted_at: "2026-10-04T00:00:00Z" })], technique: null }), localPieces: { bal_b: stale }, localTechnique: reloadedTechnique(), accountRecord: syncedRecord({ bal_b: [stale, 1] }) });
    assert.deepEqual(out.markDeleted, [], "no row is marked deleted");
    assert.deepEqual(Object.keys(out.pieces).sort(), ["bal_a", "bal_b"], "nothing here is removed");
  });

  test("a piece deleted here whose deletion hasn't gone up yet is not brought back", () => {
    const p = plan({
      record: { ...syncedRecord({}), pieces: { p1: { revision: 2, fingerprint: "x", deletedHere: true } } },
      rows: { pieces: [acctRow(pieceOf("p1"), 3)], technique: null },
    });
    assert.deepEqual(p.items, []);
    assert.deepEqual(p.skippedDeletedHere.map((s) => s.id), ["p1"]);
  });

  test("the technique row is reported as available, and as the same when it already matches", () => {
    const tech = reloadedTechnique();
    const same = plan({ rows: { pieces: [], technique: { revision: 2, data: reorder(viaJson(tech)) } }, tech });
    assert.deepEqual([same.technique.available, same.technique.same, same.technique.revision], [true, true, 2]);
    const different = plan({ rows: { pieces: [], technique: { revision: 2, data: { ...viaJson(tech), walkPosition: 5 } } }, tech: validateAndMigrateTechnique({}) });
    assert.deepEqual([different.technique.available, different.technique.same], [true, false]);
    assert.equal(plan({ rows: { pieces: [], technique: null } }).technique.available, false);
  });
});

describe("merging what the account holds (Pass 112)", () => {
  const apply = (o) => applyAccountMerge({ localTechnique: reloadedTechnique(), ...o });

  test("restoring onto an empty device adds every piece with the account's created date, records it as synced, and nothing is left waiting", () => {
    const a = pieceOf("a", { createdAt: 5000 }), b = pieceOf("b", { createdAt: 6000 });
    const rows = { pieces: [acctRow(a, 3), acctRow(b, 1)], technique: null };
    const out = apply({ candidates: accountRowsToCandidates(rows), localPieces: {}, accountRecord: syncedRecord({}, { checkedAt: null }), now: 999 });
    assert.deepEqual(Object.keys(out.pieces).sort(), ["a", "b"]);
    assert.equal(out.pieces.a.createdAt, 5000);
    assert.equal(out.pieces.b.createdAt, 6000);
    assert.equal(out.counts.added, 2);
    assert.equal(out.firstNewId, "a");
    assert.equal(out.becomesChecked, true, "restoring onto an empty device is this device's first, checked backup");
    assert.deepEqual(out.entries.a, { revision: 3, fingerprint: pieceFingerprint(a) });
    const record = withAccountCopyRecorded({ version: 1, accounts: {} }, USER, { entries: out.entries, checkedAt: 2000 });
    const w = computeWaiting({ pieces: out.pieces, technique: null, accountRecord: recordFrom(record) });
    assert.equal(w.firstBackupDone, true);
    assert.equal(w.items.length, 0, "the restored pieces equal the account's, so nothing goes back up");
  });

  test("a device that already holds pieces is not marked as having made its first backup", () => {
    const out = apply({ candidates: accountRowsToCandidates({ pieces: [acctRow(pieceOf("a"), 1)], technique: null }), localPieces: { x: pieceOf("x") }, accountRecord: syncedRecord({}, { checkedAt: null }) });
    assert.equal(out.becomesChecked, false);
  });

  test("a clean newer copy replaces this device's piece outright and leaves nothing waiting", () => {
    const base = pieceOf("p1");
    const newer = withMore(base, 2);
    const out = apply({
      candidates: accountRowsToCandidates({ pieces: [acctRow(newer, 4)], technique: null }),
      localPieces: { p1: base },
      accountRecord: syncedRecord({ p1: [base, 3] }),
    });
    assert.equal(out.counts.took.length, 1);
    assert.equal(samePiece(out.pieces.p1, newer), true);
    const record = withAccountCopyRecorded({ version: 1, accounts: { [USER]: syncedRecord({ p1: [base, 3] }) } }, USER, { entries: out.entries });
    assert.equal(computeWaiting({ pieces: out.pieces, technique: null, accountRecord: recordFrom(record) }).items.length, 0);
  });

  test("a piece changed on both sides is merged: practice history from both is kept, the mark clears, and the rest goes up as an ordinary change", () => {
    const base = pieceOf("p1");
    const here = withMore(base, 2);           // this device logged a session
    const there = withMore(base, 3);          // the account got a different one
    const record = { ...syncedRecord({ p1: [base, 3] }), pieces: { p1: { revision: 3, fingerprint: pieceFingerprint(base), held: true } } };
    const out = apply({
      candidates: accountRowsToCandidates({ pieces: [acctRow(there, 4)], technique: null }),
      localPieces: { p1: here },
      accountRecord: record,
      ladderChoices: { p1: "existing" },
    });
    const days = out.pieces.p1.progress.c1.sessions.map((s) => s.day).sort();
    assert.deepEqual(days, [1, 2, 3], "sessions from both sides survive");
    assert.deepEqual(out.counts.merged, ["Piece p1"]);
    assert.equal(out.counts.clearedHeld, 1);
    const recorded = withAccountCopyRecorded({ version: 1, accounts: { [USER]: record } }, USER, { entries: out.entries });
    const w = computeWaiting({ pieces: out.pieces, technique: null, accountRecord: recordFrom(recorded) });
    assert.deepEqual(w.held.pieces, [], "no longer held");
    assert.deepEqual(w.items.map((i) => [i.action, i.id, i.expectedRevision]), [["change", "p1", 4]], "goes up only if the account is still at revision 4");
  });

  test("the merged result of a settled piece really does go up, and the account ends holding it", async () => {
    const base = pieceOf("p1");
    const here = withMore(base, 2), there = withMore(base, 3);
    const storage = memoryStorage();
    saveDeviceRecord({ version: 1, accounts: { [USER]: { ...syncedRecord({ p1: [base, 3] }), pieces: { p1: { revision: 3, fingerprint: pieceFingerprint(base), held: true } } } } }, storage);
    const out = apply({ candidates: accountRowsToCandidates({ pieces: [acctRow(there, 4)], technique: null }), localPieces: { p1: here }, accountRecord: recordOf(storage) });
    saveDeviceRecord(withAccountCopyRecorded(readDeviceRecord(storage), USER, { entries: out.entries }), storage);
    const fake = syncFake({ pieceRows: [pieceRow(there, { user_id: USER, revision: 4 })], techniqueRows: [] });
    const r = await syncWaitingChanges({ pieces: out.pieces, technique: null, userId: USER, getClient: async () => fake.client, storage, now: () => 5000 });
    assert.equal(r.uploaded, 1);
    assert.deepEqual(r.newlyHeld, []);
    assert.equal(fake.rows.pieces[0].revision, 5);
    assert.deepEqual(fake.rows.pieces[0].data.progress.c1.sessions.map((s) => s.day).sort(), [1, 2, 3]);
    assert.equal(recordOf(storage).pieces.p1.held, undefined);
  });

  test("two copies of one piece are combined into this device's piece, and the other account row is named to be marked deleted", () => {
    const here = validateAndMigratePiece({ ...viaJson(pieceOf("L1")), name: "Ballade No. 1", composer: "Chopin", createdAt: 10 });
    const there = validateAndMigratePiece({ ...viaJson(withMore(pieceOf("R1"), 2)), name: "Ballade No. 1", composer: "Chopin", createdAt: 20 });
    const out = apply({
      candidates: accountRowsToCandidates({ pieces: [acctRow(there, 7)], technique: null }),
      localPieces: { L1: here },
      accountRecord: syncedRecord({ L1: [here, 1] }),
    });
    assert.deepEqual(Object.keys(out.pieces), ["L1"], "this device ends with one copy, under its own id");
    assert.equal(out.pieces.L1.createdAt, 10);
    assert.deepEqual(out.pieces.L1.progress.c1.sessions.map((s) => s.day).sort(), [1, 2], "the other copy's history is merged in");
    assert.deepEqual(out.markDeleted, [{ id: "R1", revision: 7, name: "Ballade No. 1", intoId: "L1" }]);
    assert.deepEqual(out.counts.combined, ["Ballade No. 1"]);
    assert.equal(out.entries.R1, undefined, "the other row is never recorded as a piece here");
  });

  test("a piece the person unticked is left alone, and so is its held mark", () => {
    const a = pieceOf("a"), b = pieceOf("b");
    const record = { ...syncedRecord({}), pieces: { b: { held: true } } };
    const out = apply({ candidates: accountRowsToCandidates({ pieces: [acctRow(a, 1), acctRow(b, 2)], technique: null }), localPieces: {}, accountRecord: record, selectedIds: ["a"] });
    assert.deepEqual(Object.keys(out.pieces), ["a"]);
    assert.equal(out.entries.b, undefined);
  });

  test("what's decided is re-worked from what's here now: a piece changed after the plan was made is merged, not replaced", () => {
    const base = pieceOf("p1");
    const record = syncedRecord({ p1: [base, 3] });
    const rows = { pieces: [acctRow(withMore(base, 3), 4)], technique: null };
    const candidates = accountRowsToCandidates(rows);
    const planned = planAccountMerge({ candidates, localPieces: { p1: base }, accountRecord: record });
    assert.equal(planned.items[0].kind, "take");
    const loggedMeanwhile = withMore(base, 2);
    const out = apply({ candidates, localPieces: { p1: loggedMeanwhile }, accountRecord: record });
    assert.equal(out.counts.took.length, 0);
    assert.deepEqual(out.counts.merged, ["Piece p1"]);
    assert.deepEqual(out.pieces.p1.progress.c1.sessions.map((s) => s.day).sort(), [1, 2, 3], "the session logged meanwhile is not lost");
  });

  test("a piece deleted here that hasn't gone up yet is not brought back by a restore", () => {
    const record = { ...syncedRecord({}), pieces: { a: { revision: 2, fingerprint: "x", deletedHere: true } } };
    const out = apply({ candidates: accountRowsToCandidates({ pieces: [acctRow(pieceOf("a"), 3), acctRow(pieceOf("b"), 1)], technique: null }), localPieces: {}, accountRecord: record });
    assert.deepEqual(Object.keys(out.pieces), ["b"]);
    assert.deepEqual(out.skippedDeletedHere.map((s) => s.id), ["a"]);
  });

  test("the technique merge never removes an item, adds the account's, and writes back only when something changed", () => {
    const local = validateAndMigrateTechnique({
      schemaVersion: 1,
      items: [{ id: "mine1", tonic: "C", quality: "major" }, { id: "mine2", tonic: "G", quality: "major" }],
      walkPosition: 2,
    });
    const account = validateAndMigrateTechnique({
      schemaVersion: 1,
      items: [{ id: "theirs1", tonic: "C", quality: "major", lastCheckedDate: "2026-09-30", evenTempo: 90, checkOctaves: 2 }, { id: "theirs2", tonic: "D", quality: "minor", minorForm: "natural" }],
    });
    const out = applyAccountMerge({
      candidates: accountRowsToCandidates({ pieces: [], technique: { revision: 5, data: reorder(viaJson(account)) } }),
      localPieces: {},
      localTechnique: local,
      accountRecord: syncedRecord({}),
    });
    const ids = out.technique.value.items.map((i) => i.id);
    assert.ok(ids.includes("mine1") && ids.includes("mine2"), "nothing here was removed");
    assert.equal(out.technique.value.items.length, 3, "the account's new scale is added; the shared one is one item");
    assert.equal(out.technique.stats.itemsAdded, 1);
    assert.equal(out.technique.stats.temposUpdated, 1);
    assert.equal(out.technique.changed, true);
    assert.deepEqual(out.technique.entry, { revision: 5, fingerprint: techniqueFingerprint(account) });
    // a library that already holds everything in the account's is not rewritten
    const again = applyAccountMerge({
      candidates: accountRowsToCandidates({ pieces: [], technique: { revision: 5, data: reorder(viaJson(account)) } }),
      localPieces: {},
      localTechnique: out.technique.value,
      accountRecord: syncedRecord({}),
    });
    assert.equal(again.technique.changed, false);
    assert.equal(again.technique.value.items.length, 3);
  });

  test("a held technique library is cleared by merging it", () => {
    const record = { ...syncedRecord({}), technique: { held: true } };
    const out = applyAccountMerge({
      candidates: accountRowsToCandidates({ pieces: [], technique: { revision: 2, data: reorder(viaJson(reloadedTechnique())) } }),
      localPieces: {},
      localTechnique: validateAndMigrateTechnique({}),
      accountRecord: record,
    });
    assert.equal(out.technique.clearedHeld, true);
    const recorded = withAccountCopyRecorded({ version: 1, accounts: { [USER]: record } }, USER, { technique: out.technique.entry });
    assert.equal(recordFrom(recorded).technique.held, undefined);
    assert.equal(recordFrom(recorded).technique.revision, 2);
  });
});

// accountRecordFor on a whole record, for the tests above
const recordFrom = (deviceRecord) => accountRecordFor(deviceRecord, USER);

describe("the device record after a merge (Pass 112)", () => {
  test("merged entries replace the old ones (a held mark goes), others are kept, and the first backup is marked only when asked and not already set", () => {
    const before = {
      version: 1,
      accounts: { [USER]: { pieces: { a: { revision: 1, fingerprint: "old", held: true }, b: { revision: 2, fingerprint: "keep" } }, technique: null, checkedAt: null, syncedAt: 777 } },
    };
    const after = withAccountCopyRecorded(before, USER, { entries: { a: { revision: 5, fingerprint: "new" } }, technique: { revision: 3, fingerprint: "t" }, checkedAt: 4000 });
    const a = recordFrom(after);
    assert.deepEqual(a.pieces.a, { revision: 5, fingerprint: "new" });
    assert.deepEqual(a.pieces.b, { revision: 2, fingerprint: "keep" });
    assert.deepEqual(a.technique, { revision: 3, fingerprint: "t" });
    assert.equal(a.checkedAt, 4000);
    assert.equal(a.syncedAt, 777, "only an upload changes when the last upload was");
    const again = withAccountCopyRecorded(after, USER, { checkedAt: 9999 });
    assert.equal(recordFrom(again).checkedAt, 4000, "an existing first-backup mark is never moved");
    const none = withAccountCopyRecorded(before, USER, { entries: {} });
    assert.equal(recordFrom(none).checkedAt, null, "not asked: not marked");
    assert.equal(accountRecordFor(after, "someone-else").checkedAt, null, "a different account is untouched");
  });

  test("dropping a piece forgets it without touching when the last upload was", () => {
    const before = { version: 1, accounts: { [USER]: { pieces: { a: { revision: 1, fingerprint: "x" }, b: { revision: 2, fingerprint: "y" } }, technique: null, checkedAt: 5, syncedAt: 777 } } };
    const after = recordFrom(withPieceDropped(before, USER, "a"));
    assert.deepEqual(Object.keys(after.pieces), ["b"]);
    assert.equal(after.syncedAt, 777);
  });
});

describe("Review looks only at what's held (Pass 112)", () => {
  test("only held pieces (and their deleted rows) are kept, and the technique row only if it's held", () => {
    const candidates = accountRowsToCandidates({
      pieces: [acctRow(pieceOf("held"), 4), acctRow(pieceOf("fine"), 2), acctRow(pieceOf("heldgone"), 3, { deleted_at: "2026-10-01T00:00:00Z" }), acctRow(pieceOf("othergone"), 3, { deleted_at: "2026-10-01T00:00:00Z" })],
      technique: { revision: 2, data: reorder(viaJson(reloadedTechnique())) },
    });
    const record = { ...syncedRecord({}), pieces: { held: { held: true }, heldgone: { held: true }, fine: { revision: 1, fingerprint: "x" } }, technique: { revision: 1, fingerprint: "t" } };
    const only = restrictCandidatesToHeld(candidates, record);
    assert.deepEqual(only.pieces.map((c) => c.id), ["held"]);
    assert.deepEqual(only.deleted.map((d) => d.id), ["heldgone"]);
    assert.equal(only.technique.technique, null, "a technique library that isn't held isn't part of a review");
    const withHeldTechnique = restrictCandidatesToHeld(candidates, { ...record, technique: { held: true } });
    assert.equal(withHeldTechnique.technique.revision, 2);
  });
});

describe("marking the other copy deleted (Pass 112)", () => {
  test("only deleted_at is sent, only if the row is still at the revision it was read at, and the row stays", async () => {
    const other = pieceOf("R1");
    const fake = syncFake({ pieceRows: [pieceRow(other, { user_id: USER, revision: 7 })] });
    const r = await markOtherCopiesDeleted({ items: [{ id: "R1", revision: 7, name: "Ballade No. 1" }], userId: USER, getClient: async () => fake.client, now: () => Date.UTC(2026, 9, 3) });
    assert.deepEqual(r.marked.map((m) => m.id), ["R1"]);
    assert.deepEqual(r.failed, []);
    const call = fake.calls.find((c) => c.op === "update");
    assert.deepEqual(Object.keys(call.values), ["deleted_at"], "nothing but deleted_at is sent");
    assert.ok(call.filters.some(([c, v]) => c === "revision" && v === 7), "only if still at revision 7");
    assert.equal(fake.rows.pieces.length, 1, "the row is not erased");
    assert.equal(fake.rows.pieces[0].deleted_at, "2026-10-03T00:00:00.000Z");
    assert.deepEqual(fake.rows.pieces[0].data.name, "Piece R1", "its data is still there");
  });

  test("a row someone changed meanwhile is left alone and reported", async () => {
    const fake = syncFake({ pieceRows: [pieceRow(pieceOf("R1"), { user_id: USER, revision: 9 })] });
    const r = await markOtherCopiesDeleted({ items: [{ id: "R1", revision: 7, name: "X" }], userId: USER, getClient: async () => fake.client });
    assert.deepEqual(r.marked, []);
    assert.deepEqual(r.failed.map((f) => [f.id, f.reason]), [["R1", "refused"]]);
    assert.equal(fake.rows.pieces[0].deleted_at, null);
  });

  test("no connection reports every one as not done, and nothing to do does nothing", async () => {
    const down = syncFake({ pieceRows: [pieceRow(pieceOf("R1"), { user_id: USER, revision: 1 })], inject: () => ({ data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 }) });
    const r = await markOtherCopiesDeleted({ items: [{ id: "R1", revision: 1, name: "X" }], userId: USER, getClient: async () => down.client });
    assert.deepEqual(r.failed.map((f) => f.reason), ["connection"]);
    let asked = false;
    const none = await markOtherCopiesDeleted({ items: [], userId: USER, getClient: async () => { asked = true; return null; } });
    assert.deepEqual(none, { marked: [], failed: [] });
    assert.equal(asked, false, "the library isn't even asked for");
  });
});

describe("reading the account (Pass 112)", () => {
  test("every row comes back, deleted ones too, and the live count leaves them out", async () => {
    const fake = syncFake({
      pieceRows: [pieceRow(pieceOf("a"), { user_id: USER }), pieceRow(pieceOf("b"), { user_id: USER, deleted_at: "2026-10-01T00:00:00Z" }), pieceRow(pieceOf("c"), { user_id: USER })],
      techniqueRows: [{ user_id: USER, data: reorder(viaJson(reloadedTechnique())), revision: 2 }],
    });
    const got = await fetchAccountCopy({ userId: USER, getClient: async () => fake.client });
    assert.equal(got.status, "ok");
    assert.equal(got.rows.pieces.length, 3);
    assert.equal(got.rows.technique.revision, 2);
    const n = await countLiveAccountPieces({ userId: USER, getClient: async () => fake.client });
    assert.deepEqual(n, { status: "ok", count: 2 });
  });

  test("signed out, no library, or a failed read stops with a reason", async () => {
    const fake = syncFake({ pieceRows: [] });
    assert.deepEqual(await fetchAccountCopy({ userId: "someone-else", getClient: async () => fake.client }), { status: "stopped", reason: "signed-out" });
    assert.deepEqual(await fetchAccountCopy({ userId: USER, getClient: async () => null }), { status: "stopped", reason: "connection" });
    const failing = syncFake({ inject: () => ({ data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 }) });
    assert.deepEqual(await countLiveAccountPieces({ userId: USER, getClient: async () => failing.client }), { status: "stopped", reason: "connection" });
    assert.match(describeFetchProblem("connection"), /Couldn't reach the account service/);
    assert.match(describeFetchProblem("signed-out"), /signed out/);
    assert.match(describeFetchProblem("other"), /Try again/);
  });

  test("the welcome screen's button names the count", () => {
    assert.equal(describeRestoreButton(12), "Restore 12 pieces from your account");
    assert.equal(describeRestoreButton(1), "Restore 1 piece from your account");
  });
});

describe("the result in plain words (Pass 112)", () => {
  const counts = (o = {}) => ({ added: 0, took: [], merged: [], combined: [], same: 0, aligned: 0, clearedHeld: 0, ...o });
  const text = (lines) => lines.map((l) => l.text);

  test("a restore, a clean take, a merge and a combine each say so", () => {
    assert.deepEqual(text(describeAccountMergeResult({ mode: "restore", applied: counts({ added: 12 }) })), ["Restored 12 pieces from your account."]);
    assert.deepEqual(text(describeAccountMergeResult({ applied: counts({ took: ["Etude No. 3"] }) })), ["Took your account's newer copy of 1 piece: Etude No. 3."]);
    assert.match(text(describeAccountMergeResult({ applied: counts({ merged: ["A", "B"] }) }))[0], /Merged 2 pieces changed in both places: A; B\./);
    assert.deepEqual(text(describeAccountMergeResult({ applied: counts({ combined: ["Ballade No. 1"] }), marked: { marked: [{ id: "R1", name: "Ballade No. 1" }], failed: [] } })), [
      "Combined the two copies of Ballade No. 1. The extra copy in your account is marked deleted, not erased.",
    ]);
  });

  test("a combine whose other copy couldn't be marked, or was left, says that instead", () => {
    const failed = describeAccountMergeResult({ applied: counts({ combined: ["X"] }), marked: { marked: [], failed: [{ id: "R1", name: "X", reason: "refused" }] } });
    assert.equal(failed[0].problem, true);
    assert.match(failed[0].text, /couldn't be marked deleted \(it changed meanwhile\)/);
    const left = describeAccountMergeResult({ applied: counts({ combined: ["X"] }), notMarked: ["X"] });
    assert.match(left[0].text, /left as it is until this device has made its first backup/);
  });

  test("nothing to do, cleared marks, matched dates and unreadable rows", () => {
    assert.deepEqual(text(describeAccountMergeResult({ applied: counts({ same: 3 }) })), ["Everything here already matches your account."]);
    const lines = text(describeAccountMergeResult({ applied: counts({ aligned: 25, clearedHeld: 26 }), unreadable: 1 }));
    assert.deepEqual(lines, ["Matched the created date of 25 pieces to your account.", 'Cleared "changed on another device" on 26 items.', "1 piece in your account couldn't be read and was skipped."]);
  });

  test("the technique library line says what was added and that nothing was removed", () => {
    const lines = text(describeAccountMergeResult({ applied: counts(), technique: { stats: { itemsAdded: 3, temposUpdated: 1, methodsAdded: 0, methodStatesAdded: 0 } }, skippedItems: 2 }));
    assert.equal(lines[0], "Technique library merged (3 scales added, 1 newer tempo, 0 methods added, 2 unreadable scales skipped). Nothing was removed.");
  });
});
