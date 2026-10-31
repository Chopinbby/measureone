// Pass 110: the first backup to the account (src/lib/accountSync.js). No
// network: a fake client stands in for Supabase's, and a small in-memory
// object for localStorage.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAndMigratePiece, validateAndMigrateTechnique, normalizeTechniqueItem, findMatchingPiece } from "../src/lib/storage.js";
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
  OFFLINE_STATUS_TEXT,
  describeHeld,
  describeHeldBanner,
  // Pass 117
  piecePartFingerprints,
  withPartsRecorded,
  // Pass 118
  techniquePartFingerprints,
  withTechniquePartsRecorded,
  // Pass 116
  CHECK_FOCUS_GAP_MS,
  CHECK_EVERY_MS,
  checkAccountChanges,
  classifyAccountChanges,
  checkIsDue,
  createAccountChecker,
  checkOutcome,
  checkRowsUsable,
  describeAccountChanges,
  // Pass 115
  MAX_SENT,
  withSentRecorded,
  techniqueForComparison,
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
  // Pass 120
  CHECK_TICK_MS,
  autoUpdateOn,
  withAutoUpdate,
  autoUpdateTargets,
  needsMergeBeforeUpload,
  uploadAfterLook,
  BEFORE_UPLOAD_RETRY_MS,
  mergeTechniqueFromAccount,
  fetchChangedAccountRows,
  describeAutoUpdate,
  describeAutoPending,
  PIECE_UPDATED_NOTE,
  reapplyOnto,
  // Pass 121
  heldConflicts,
  heldIdsWithConflicts,
  buildSettleQuestions,
  planSettle,
  answeredAll,
  describeKept,
  describeSettleResult,
  describeSettleRereadProblem,
  // Pass 122
  restorePieceRow,
  markPieceRowCombined,
  bringBackDeletedPiece,
  fetchDeletedPieces,
  describeAutoRemoved,
  describeDeletedElsewhere,
  describeDeletedBanner,
  describeBringBack,
  // Pass 122b
  declinedOf,
  declinedSummary,
  declinedCount,
  isDeclinedPair,
  withDeclined,
  withDeclinedCleared,
  withDeclinedRemoved,
  planDeclines,
  orderChoiceFor,
  heldIdsToSettle,
  describeUntickedNote,
  describeCombineRow,
  describeCombineBadge,
  describeLeftOff,
  describeAskMeAgainHint,
  describeAskMeAgain,
  ASK_ME_AGAIN_LABEL,
  MAX_DECLINED,
  describeRecencySettled,
  planTechniqueFromAccount,
} from "../src/lib/accountSync.js";
import { RECENTLY_DELETED_DAYS, deletionsElsewhere, deletedForPerson, recentlyDeletedList } from "../src/lib/recentlyDeleted.js";
import { planPieceMerge, WHOLE_PIECE_PART } from "../src/lib/pieceMerge.js";
import { generateAllChunks } from "../src/lib/chunking.js";

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
    const q = { op: "select", filters: [], ins: [], gtes: [], values: null, selected: false, columns: null, range: null };
    const hit = (row) =>
      q.filters.every(([c, v]) => row[c] === v) &&
      q.ins.every(([c, vals]) => vals.includes(row[c])) &&
      q.gtes.every(([c, v]) => row[c] != null && String(row[c]) >= String(v));
    const run = () => {
      const filterId = (q.filters.find(([c]) => c === "id") || [])[1];
      const call = { table, op: q.op, id: q.op === "insert" ? q.values.id : filterId, values: q.values, filters: q.filters, ins: q.ins, gtes: q.gtes, columns: q.columns };
      calls.push(call);
      const injected = inject && inject(call, rows);
      if (injected) return injected;
      if (q.op === "select") {
        // Like the real service: a page of rows (range), and only the columns asked for.
        let out = rows[table].filter(hit);
        if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
        const cols = q.columns ? q.columns.split(",").map((c) => c.trim()) : null;
        if (cols) out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
        return { data: out.map(viaJson), error: null, status: 200 };
      }
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
      select: (cols) => ((q.selected = true), (q.columns = typeof cols === "string" ? cols : null), api),
      insert: (v) => ((q.op = "insert"), (q.values = v), api),
      update: (v) => ((q.op = "update"), (q.values = v), api),
      eq: (c, v) => (q.filters.push([c, v]), api),
      in: (c, vals) => (q.ins.push([c, vals]), api),
      gte: (c, v) => (q.gtes.push([c, v]), api),
      order: () => api,
      range: (from, to) => ((q.range = [from, to]), api),
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return api;
  };
  const client = { from, auth: { getSession: async () => ({ data: { session: { user: { id: USER } } }, error: null }) } };
  return { client, rows, calls, writes: () => calls.filter((c) => c.op !== "select"), selects: () => calls.filter((c) => c.op === "select") };
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
    assert.deepEqual(recordOf(storage).pieces.p1, { revision: 2, fingerprint: pieceFingerprint(edited), parts: piecePartFingerprints(edited) });
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
    assert.deepEqual(rec.pieces.p2, { revision: 2, fingerprint: pieceFingerprint(changed.p2), parts: piecePartFingerprints(changed.p2) });
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
    assert.deepEqual(recordOf(storage).pieces.p4, { revision: 1, fingerprint: pieceFingerprint(withNew.p4), parts: piecePartFingerprints(withNew.p4) });
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
    assert.deepEqual(recordOf(storage).technique, { revision: 2, fingerprint: techniqueFingerprint(tech2), parts: techniquePartFingerprints(tech2) });
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
    assert.deepEqual(recordOf(storage).pieces.p2, { revision: 2, fingerprint: pieceFingerprint(mine), parts: piecePartFingerprints(mine) });
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
    // Since Pass 115 an attempt notes what it's about to send (`sent`); nothing else changes.
    const snapshot = () => JSON.stringify(readDeviceRecord(storage), (k, v) => (k === "sent" ? undefined : v));
    const before = snapshot();
    const r = await runSync(changed, technique, fake, storage);
    assert.equal(r.status, "stopped");
    assert.equal(r.reason, "connection");
    assert.equal(r.remaining, 2);
    assert.deepEqual(r.newlyHeld, []);
    assert.equal(snapshot(), before);
    assert.deepEqual(recordOf(storage).pieces.p1.sent, [pieceFingerprint(changed.p1)], "the one attempt was noted");
    assert.equal(recordOf(storage).pieces.p2.sent, undefined, "the one that wasn't tried wasn't");
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
    assert.equal(describeSyncStatus({ now: 9000, firstBackupDone: true, backedUpAt: 1000, waiting: 0, held: computeWaiting({ pieces: mine, technique: lib, accountRecord: recordOf(storage) }).held, failures: 0 }).text, "The technique library changed on another device. Everything else backed up just now.");

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
    assert.deepEqual(status({ held: one }), { tone: "problem", text: "1 piece changed on another device: Ballade No. 1. Everything else backed up just now." });
    const two = { pieces: [{ id: "a", name: "Etude" }, { id: "b", name: "Waltz" }], technique: false };
    assert.equal(status({ held: two }).text, "2 pieces changed on another device: Etude; Waltz. Everything else backed up just now.");
    const many = { pieces: ["A", "B", "C", "D", "E"].map((name, i) => ({ id: `p${i}`, name })), technique: false };
    assert.equal(status({ held: many }).text, "5 pieces changed on another device: A; B; C; and 2 more. Everything else backed up just now.");
    assert.equal(status({ held: { pieces: [], technique: true } }).text, "The technique library changed on another device. Everything else backed up just now.");
    assert.equal(status({ held: { pieces: one.pieces, technique: true } }).text, "1 piece and the technique library changed on another device: Ballade No. 1. Everything else backed up just now.");
    const gone = { pieces: [{ id: "x", name: null, deletedHere: true }], technique: false };
    assert.equal(status({ held: gone }).text, "1 piece changed on another device: a piece deleted here. Everything else backed up just now.");
  });

  test("which line wins when more than one is true", () => {
    const held = { pieces: [{ id: "b", name: "Ballade No. 1" }], technique: false };
    assert.match(status({ held, waiting: 3 }).text, /changed on another device/, "held beats waiting");
    assert.match(status({ held, waiting: 3, failures: NOT_ANSWERING_AFTER }).text, /isn't answering/, "not answering beats held");
    assert.match(status({ waiting: 3 }).text, /waiting/, "waiting beats backed up");
  });

  test("[Pass 123] with the browser saying there is no connection, a failed attempt says 'working offline'", () => {
    const text = "Working offline. Everything is saved on this device and will back up when you're connected.";
    assert.equal(OFFLINE_STATUS_TEXT, text, "the exact wording the owner confirmed");
    const quiet = { tone: "quiet", text };
    // offline + at least one failed attempt: the offline line, however many failures
    assert.deepEqual(status({ offline: true, failures: 1 }), quiet);
    assert.deepEqual(status({ offline: true, failures: NOT_ANSWERING_AFTER }), quiet);
    assert.deepEqual(status({ offline: true, failures: 9, waiting: 4 }), quiet, "changes waiting does not change it");
    // like "not answering", it replaces a held message (the more urgent thing to say)
    const held = { pieces: [{ id: "b", name: "Ballade No. 1" }], technique: false };
    assert.deepEqual(status({ offline: true, failures: 1, held }), quiet);
    // nothing has failed yet: the usual line, offline or not
    assert.deepEqual(status({ offline: true, failures: 0 }), { tone: "ok", text: "Backed up just now" });
    assert.equal(status({ offline: true, failures: 0, waiting: 2 }).text, "2 changes waiting to back up");
    // a plain failed check is still "isn't answering": the browser saying it is online, or not saying anything at all
    assert.match(status({ offline: false, failures: NOT_ANSWERING_AFTER }).text, /isn't answering/);
    assert.match(status({ failures: NOT_ANSWERING_AFTER }).text, /isn't answering/, "no offline flag, as before Pass 123");
    assert.equal(status({ offline: false, failures: 1, waiting: 2 }).text, "2 changes waiting to back up", "one failure while online says nothing new");
    // only when the browser really says so: anything that is not true does not count
    assert.equal(status({ offline: "yes", failures: 1, waiting: 2 }).text, "2 changes waiting to back up");
    // before the first backup there is no status line at all, offline or not
    assert.equal(status({ offline: true, failures: 3, firstBackupDone: false }), null);
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
// The same piece with a different list of recordings, and a later updatedAt. A recording list is a
// COLLECTION: since Pass 126 "the most recent change wins" never settles one (it would drop an
// item someone added), so two of these (different n) are a clash that is still asked about. A
// practice record is not (it is combined), and a single setting is not (the later change wins).
const withRecording = (p, n, updatedAt = (p.updatedAt || 0) + 1000) =>
  validateAndMigratePiece({ ...viaJson(p), updatedAt, recordings: [{ id: `r${n}`, label: `Take ${n}`, url: `https://example.test/${n}` }] });
// What the engine did before Pass 126 for the two rules that became answers (the more recent change
// settles a single setting; a practice record both devices changed is combined). Used where a test
// needs the old plan to exercise code that is kept but no longer reached (the practice question).
const LEGACY = { recency: false, combinePractice: false };
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
    const row = acctRow(validateAndMigratePiece(there), 7);
    const p = plan({ local: { L1: validateAndMigratePiece(here) }, rows: { pieces: [row], technique: null } });
    assert.equal(p.items.length, 1);
    assert.equal(p.items[0].kind, "combine");
    assert.equal(p.items[0].matchId, "L1");
    // (Pass 122: the other row also carries its saved data as read, so the combine can note where it went)
    assert.deepEqual(p.items[0].otherRow, { id: "R1", revision: 7, raw: row.data });
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
    assert.deepEqual(out.entries.a, { revision: 3, fingerprint: pieceFingerprint(a), parts: piecePartFingerprints(a) });
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
    const row = acctRow(there, 7);
    const out = apply({
      candidates: accountRowsToCandidates({ pieces: [row], technique: null }),
      localPieces: { L1: here },
      accountRecord: syncedRecord({ L1: [here, 1] }),
    });
    assert.deepEqual(Object.keys(out.pieces), ["L1"], "this device ends with one copy, under its own id");
    assert.equal(out.pieces.L1.createdAt, 10);
    assert.deepEqual(out.pieces.L1.progress.c1.sessions.map((s) => s.day).sort(), [1, 2], "the other copy's history is merged in");
    assert.deepEqual(out.markDeleted, [{ id: "R1", revision: 7, name: "Ballade No. 1", intoId: "L1", raw: row.data }]);
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
    assert.deepEqual(out.technique.entry, { revision: 5, fingerprint: techniqueFingerprint(account), parts: techniquePartFingerprints(account) });
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

/* ------------------------------------------------------------------ */
/*  Pass 115: "same" and "changed" you can trust                       */
/* ------------------------------------------------------------------ */

describe("a refusal that is this device's own earlier upload (Pass 115)", () => {
  // The account accepts an update but the answer never arrives.
  const lostConfirmation = (id) => {
    let done = false;
    return (call, rows) => {
      if (done || call.op !== "update" || call.id !== id) return null;
      done = true;
      const row = rows.pieces.find((x) => x.id === id);
      Object.assign(row, viaJson(call.values), { data: reorder(viaJson(call.values.data)) });
      row.revision += 1;
      return noConnection();
    };
  };

  test("the false hold: an upload lands, its confirmation is lost, more is logged, and the next attempt goes up instead of holding", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake({ ...accountHolding(pieces, technique), inject: lostConfirmation("p2") });
    const v2 = { ...pieces.p2, name: "Version 2" };
    const first = await runSync({ ...pieces, p2: v2 }, technique, fake, storage);
    assert.equal(first.reason, "connection");
    assert.equal(fake.rows.pieces.find((x) => x.id === "p2").revision, 2, "it did land");
    assert.equal(recordOf(storage).pieces.p2.revision, 1, "but the device never heard");

    const v3 = { ...v2, name: "Version 3" };
    const r = await runSync({ ...pieces, p2: v3 }, technique, fake, storage);
    assert.deepEqual(r.newlyHeld, [], "not held");
    assert.equal(r.resolved, 1);
    assert.equal(r.uploaded, 1);
    const row = fake.rows.pieces.find((x) => x.id === "p2");
    assert.equal(row.revision, 3);
    assert.equal(row.data.name, "Version 3");
    assert.deepEqual(recordOf(storage).pieces.p2, { revision: 3, fingerprint: pieceFingerprint(v3), parts: piecePartFingerprints(v3) }, "confirmed: the sent list is cleared");
    assert.equal(computeWaiting({ pieces: { ...pieces, p2: v3 }, technique, accountRecord: recordOf(storage) }).count, 0);
  });

  test("the row adopted is left waiting at that revision (the record holds the row's content, not the newer copy)", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const v2 = { ...pieces.p2, name: "Version 2" };
    const fake = syncFake({ ...accountHolding(pieces, technique), inject: lostConfirmation("p2") });
    await runSync({ ...pieces, p2: v2 }, technique, fake, storage);
    const v3 = { ...v2, name: "Version 3" };
    // stop after the adoption: the retry's update is also lost
    const stopAfterAdopt = syncFake({ pieceRows: fake.rows.pieces, techniqueRows: fake.rows.technique, inject: (c) => (c.op === "update" && c.filters.some(([k, v]) => k === "revision" && v === 2) ? noConnection() : null) });
    await runSync({ ...pieces, p2: v3 }, technique, stopAfterAdopt, storage);
    assert.equal(recordOf(storage).pieces.p2.revision, 2, "adopted the row's revision");
    assert.equal(recordOf(storage).pieces.p2.fingerprint, pieceFingerprint(v2), "recorded as what the row holds, so v3 is still waiting");
    assert.deepEqual(computeWaiting({ pieces: { ...pieces, p2: v3 }, technique, accountRecord: recordOf(storage) }).items.map((i) => [i.id, i.expectedRevision]), [["p2", 2]]);
  });

  test("a refused row equal to neither the current copy nor anything sent is held, as before", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const row = fake.rows.pieces.find((x) => x.id === "p2");
    row.revision = 2;
    row.data = { ...row.data, name: "Another device" };
    const r = await runSync({ ...pieces, p2: { ...pieces.p2, name: "Mine" } }, technique, fake, storage);
    assert.deepEqual(r.newlyHeld.map((h) => h.id), ["p2"]);
    assert.equal(recordOf(storage).pieces.p2.held, true);
    assert.equal(row.data.name, "Another device");
  });

  test("a row that matches something sent, but not within the last five, is held", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const old = { ...pieces.p2, name: "Sent long ago" };
    let record = readDeviceRecord(storage);
    record = withSentRecorded(record, USER, { kind: "piece", id: "p2" }, pieceFingerprint(old));
    for (let i = 0; i < MAX_SENT; i++) record = withSentRecorded(record, USER, { kind: "piece", id: "p2" }, `later-${i}`);
    saveDeviceRecord(record, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const row = fake.rows.pieces.find((x) => x.id === "p2");
    row.revision = 2;
    row.data = reorder(viaJson(old));
    const r = await runSync({ ...pieces, p2: { ...pieces.p2, name: "Now" } }, technique, fake, storage);
    assert.deepEqual(r.newlyHeld.map((h) => h.id), ["p2"]);
  });

  test("the sent list keeps the last five, without duplicates, and survives a reload of the record", () => {
    let record = readDeviceRecord(memoryStorage());
    for (let i = 1; i <= 7; i++) record = withSentRecorded(record, USER, { kind: "piece", id: "p1" }, `f${i}`);
    record = withSentRecorded(record, USER, { kind: "piece", id: "p1" }, "f5");
    assert.deepEqual(accountRecordFor(record, USER).pieces.p1.sent, ["f3", "f4", "f6", "f7", "f5"], "f5 re-sent moves to the end, not twice");
    const storage = memoryStorage();
    saveDeviceRecord(record, storage);
    assert.deepEqual(recordOf(storage).pieces.p1.sent, ["f3", "f4", "f6", "f7", "f5"]);
    assert.equal(recordOf(storage).pieces.p1.sent.length, MAX_SENT);
  });

  test("a confirmed revision clears the list, for a piece and for the technique library", () => {
    let record = readDeviceRecord(memoryStorage());
    record = withSentRecorded(record, USER, { kind: "piece", id: "p1" }, "a");
    record = withSentRecorded(record, USER, { kind: "technique" }, "t");
    assert.deepEqual(accountRecordFor(record, USER).technique.sent, ["t"]);
    record = withPieceUploaded(record, USER, "p1", { revision: 2, fingerprint: "x" }, 1);
    record = withTechniqueUploaded(record, USER, { revision: 2, fingerprint: "y" }, 1);
    assert.deepEqual(accountRecordFor(record, USER).pieces.p1, { revision: 2, fingerprint: "x" });
    assert.deepEqual(accountRecordFor(record, USER).technique, { revision: 2, fingerprint: "y" });
  });

  test("the technique row follows the same rule: its own earlier upload is adopted, someone else's is held", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const t2 = { ...technique, walkPosition: 4 };
    // lost confirmation for the technique row
    let done = false;
    const fake = syncFake({
      ...accountHolding(pieces, technique),
      inject: (call, rows) => {
        if (done || call.table !== "technique" || call.op !== "update") return null;
        done = true;
        Object.assign(rows.technique[0], viaJson(call.values), { data: reorder(viaJson(call.values.data)) });
        rows.technique[0].revision += 1;
        return noConnection();
      },
    });
    await runSync(pieces, t2, fake, storage);
    assert.equal(fake.rows.technique[0].revision, 2);
    const t3 = { ...t2, walkPosition: 6 };
    const r = await runSync(pieces, t3, fake, storage);
    assert.deepEqual(r.newlyHeld, []);
    assert.equal(fake.rows.technique[0].revision, 3);
    assert.deepEqual(recordOf(storage).technique, { revision: 3, fingerprint: techniqueFingerprint(t3), parts: techniquePartFingerprints(t3) });

    // a row nobody here sent
    fake.rows.technique[0].revision = 5;
    fake.rows.technique[0].data = { ...fake.rows.technique[0].data, walkPosition: 11 };
    const r2 = await runSync(pieces, { ...t3, walkPosition: 8 }, fake, storage);
    assert.deepEqual(r2.newlyHeld, [{ kind: "technique" }]);
  });
});

describe("the technique library's updatedAt is not a change (Pass 115)", () => {
  const base = { ...technique, items: [], walkPosition: 3, dayList: { date: "2026-10-01", tasks: [] } };

  test("two libraries that differ only in updatedAt are the same, with the same fingerprint", () => {
    const a = { ...base, updatedAt: 1000 }, b = { ...base, updatedAt: 99999 }, c = { ...base };
    assert.equal(sameTechnique(a, b), true);
    assert.equal(sameTechnique(a, c), true);
    assert.equal(techniqueFingerprint(a), techniqueFingerprint(b));
    assert.equal(techniqueFingerprint(a), techniqueFingerprint(c));
    assert.equal("updatedAt" in techniqueForComparison(a), false);
    assert.equal(canonicalTechnique(a).updatedAt, 1000, "it stays in the data itself");
  });

  test("today's list, the walk position and an item still count as changes", () => {
    const a = { ...base, updatedAt: 1 };
    assert.equal(sameTechnique(a, { ...a, dayList: { date: "2026-10-02", tasks: [] } }), false);
    assert.equal(sameTechnique(a, { ...a, walkPosition: 4 }), false);
    const item = { id: "i1", form: "scale", tonic: "C", quality: "major", octaves: 2, hands: "together", evenTempo: 60 };
    assert.equal(sameTechnique({ ...a, items: [item] }, { ...a, items: [{ ...item, evenTempo: 66 }] }), false);
    assert.notEqual(techniqueFingerprint(a), techniqueFingerprint({ ...a, walkPosition: 4 }));
  });

  test("the first time after this ships the library goes up once, then stays still", async () => {
    const storage = memoryStorage(), pieces = three();
    const tech = { ...base, updatedAt: 1234 };
    // a record written before Pass 115: the fingerprint included updatedAt
    const oldPrint = fingerprint(canonicalTechnique(tech));
    assert.notEqual(oldPrint, techniqueFingerprint(tech));
    const entries = Object.fromEntries(Object.entries(pieces).map(([id, p]) => [id, { revision: 1, fingerprint: pieceFingerprint(p) }]));
    saveDeviceRecord(withBackupRecorded(readDeviceRecord(storage), USER, { pieces: entries, technique: { revision: 1, fingerprint: oldPrint }, checkedAt: 1000 }), storage);
    const fake = syncFake(accountHolding(pieces, tech));
    assert.deepEqual(computeWaiting({ pieces, technique: tech, accountRecord: recordOf(storage) }).items.map((i) => `${i.kind}:${i.action}`), ["technique:change"]);
    const first = await runSync(pieces, tech, fake, storage);
    assert.equal(first.uploaded, 1);
    assert.equal(fake.rows.technique[0].revision, 2, "exactly one extra revision");
    assert.equal(fake.rows.pieces.every((r) => r.revision === 1), true, "no piece re-uploads");
    const calls = fake.calls.length;
    await runSync(pieces, tech, fake, storage);
    await runSync(pieces, { ...tech, updatedAt: 777 }, fake, storage);
    assert.equal(fake.calls.length, calls, "then nothing more, even with a new stamp");
    assert.equal(fake.rows.technique[0].revision, 2);
  });
});

describe("the status line with held and normal together (Pass 115)", () => {
  const one = { pieces: [{ id: "b", name: "Ballade No. 1", deletedHere: false }], technique: false };
  const none = { pieces: [], technique: false };
  const st = (over) => describeSyncStatus({ now: 10 * 3600000, firstBackupDone: true, backedUpAt: 7 * 3600000, waiting: 0, held: none, failures: 0, ...over });

  test("held only, waiting only, held and waiting, held and backed up, not answering", () => {
    assert.equal(st({ held: one }).text, "1 piece changed on another device: Ballade No. 1. Everything else backed up 3 hours ago.");
    assert.equal(st({ held: one }).tone, "problem");
    assert.equal(st({ waiting: 2 }).text, "2 changes waiting to back up");
    assert.equal(st({ held: one, waiting: 2 }).text, "1 piece changed on another device: Ballade No. 1. 2 changes waiting to back up.");
    assert.equal(st({ held: one, waiting: 1 }).tone, "problem");
    assert.equal(st({ held: one, backedUpAt: null }).text, "1 piece changed on another device: Ballade No. 1.", "held with nothing else to say");
    assert.equal(st({}).text, "Backed up 3 hours ago");
    assert.equal(st({ held: one, waiting: 2, failures: NOT_ANSWERING_AFTER }).text, "The account service isn't answering. Everything is still saved on this device.");
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 116: noticing, quietly, that another device changed something */
/* ------------------------------------------------------------------ */

describe("sorting what the account holds against this device (Pass 116)", () => {
  const rec = (pieces = {}, technique = null) => ({ pieces, technique, checkedAt: 1, syncedAt: 1 });
  const at = (revision, extra = {}) => ({ revision, fingerprint: "f", ...extra });
  const live = (id, revision) => ({ id, revision, deleted_at: null });
  const gone = (id, revision) => ({ id, revision, deleted_at: "2026-10-01T00:00:00Z" });
  const sort = ({ pieces = [], technique = null, record = rec(), here = [] }) =>
    classifyAccountChanges({ rows: { pieces, technique }, accountRecord: record, localPieceIds: here });
  const empty = { newer: [], added: [], deleted: [], held: [], needsReview: [], techniqueNewer: false, techniqueHeld: false };

  test("nothing changed gives an empty result", () => {
    const record = rec({ a: at(3), b: at(1) }, at(2));
    assert.deepEqual(sort({ pieces: [live("a", 3), live("b", 1)], technique: { revision: 2 }, record, here: ["a", "b"] }), empty);
    assert.deepEqual(sort({}), empty, "no rows at all");
    assert.deepEqual(classifyAccountChanges({ rows: null, accountRecord: null, localPieceIds: null }), empty, "nothing read yet");
  });

  test("this device's own upload is never newer: the record took the revision when the account confirmed it", () => {
    // device uploaded p1: the row went to 2, and the record says 2
    assert.deepEqual(sort({ pieces: [live("p1", 2)], record: rec({ p1: at(2) }), here: ["p1"] }), empty);
  });

  test("a piece the account holds at a higher revision than the record is newer", () => {
    const r = sort({ pieces: [live("p1", 4), live("p2", 3)], record: rec({ p1: at(3), p2: at(3) }), here: ["p1", "p2"] });
    assert.deepEqual(r.newer, ["p1"]);
    assert.deepEqual({ ...r, newer: [] }, empty, "and nothing else is reported");
  });

  test("a row behind the record's revision is not newer", () => {
    assert.deepEqual(sort({ pieces: [live("p1", 1)], record: rec({ p1: at(3) }), here: ["p1"] }), empty);
  });

  test("a live row this device has neither a piece nor a record for is added", () => {
    const r = sort({ pieces: [live("p9", 1), live("p8", 1)], record: rec({ p1: at(1) }), here: ["p1"] });
    assert.deepEqual(r.added, ["p8", "p9"], "sorted");
    assert.deepEqual({ ...r, added: [] }, empty);
  });

  test("a piece this device deleted is not 'added' (it has a record, no piece), and a deleted row it doesn't hold is nothing", () => {
    const record = rec({ gone: at(2, { deletedHere: true }) });
    assert.deepEqual(sort({ pieces: [live("gone", 2), gone("other", 5)], record, here: [] }), empty);
  });

  test("a row marked deleted that this device still holds is deleted", () => {
    const r = sort({ pieces: [gone("p2", 5)], record: rec({ p2: at(4) }), here: ["p2"] });
    assert.deepEqual(r.deleted, ["p2"]);
    assert.deepEqual({ ...r, deleted: [] }, empty);
    // and held here with no record at all
    assert.deepEqual(sort({ pieces: [gone("p3", 1)], here: ["p3"] }).deleted, ["p3"]);
  });

  test("the technique row is newer only when its revision is above the record's", () => {
    assert.equal(sort({ technique: { revision: 5 }, record: rec({}, at(2)) }).techniqueNewer, true);
    assert.equal(sort({ technique: { revision: 2 }, record: rec({}, at(2)) }).techniqueNewer, false, "own upload");
    assert.equal(sort({ technique: { revision: 1 }, record: rec({}, at(2)) }).techniqueNewer, false);
    assert.equal(sort({ technique: null, record: rec({}, at(2)) }).techniqueNewer, false, "no row");
    assert.equal(sort({ technique: { revision: 5 }, record: rec({}, null) }).techniqueNewer, false, "no record to compare with");
  });

  test("a piece already held is reported as held, and is not counted again as newer or deleted", () => {
    const record = rec({ a: at(2, { held: true }), b: at(2, { held: true }), c: { held: true } });
    const r = sort({ pieces: [live("a", 2), live("b", 7), gone("c", 3)], record, here: ["a", "b", "c"] });
    assert.deepEqual(r.held, ["a", "b", "c"], "held, held and newer, held and deleted");
    assert.deepEqual({ ...r, held: [] }, empty);
  });

  test("a held technique library is held, not newer", () => {
    const r = sort({ technique: { revision: 9 }, record: rec({}, at(2, { held: true })) });
    assert.equal(r.techniqueHeld, true);
    assert.equal(r.techniqueNewer, false);
  });

  test("a piece this device holds with no record entry, that the account has a live row for, needs review", () => {
    const r = sort({ pieces: [live("p1", 1)], record: rec({}), here: ["p1", "p2"] });
    assert.deepEqual(r.needsReview, ["p1"], "p2 has no row: it's just waiting to be added");
    assert.deepEqual({ ...r, needsReview: [] }, empty, "and it isn't also newer");
  });

  test("a piece appears in at most one list, even if the account lists a row twice", () => {
    const r = sort({ pieces: [live("p1", 4), live("p1", 4)], record: rec({ p1: at(3) }), here: ["p1"] });
    assert.deepEqual(r.newer, ["p1"]);
  });

  test("all of it together", () => {
    const record = rec({ n: at(1), h: at(1, { held: true }), d: at(1), ok: at(1) }, at(1));
    const r = sort({
      pieces: [live("n", 2), live("h", 3), gone("d", 2), live("ok", 1), live("a", 1), live("r", 1)],
      technique: { revision: 2 },
      record,
      here: ["n", "h", "d", "ok", "r"],
    });
    assert.deepEqual(r, { newer: ["n"], added: ["a"], deleted: ["d"], held: ["h"], needsReview: ["r"], techniqueNewer: true, techniqueHeld: false });
  });

  test("a device's own real upload, read back by the light check, is not newer", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const changed = { ...pieces, p2: { ...pieces.p2, name: "Edited here" } };
    const tech2 = { ...technique, walkPosition: 5 };
    await runSync(changed, tech2, fake, storage);
    assert.equal(fake.rows.pieces.find((x) => x.id === "p2").revision, 2);
    const read = await checkAccountChanges({ userId: USER, getClient: async () => fake.client });
    const r = classifyAccountChanges({ rows: read.rows, accountRecord: recordOf(storage), localPieceIds: Object.keys(changed) });
    assert.deepEqual(r, empty);
  });

  test("the word for it: pieces, the technique library, or both, and nothing to say", () => {
    const some = (over) => ({ ...empty, ...over });
    assert.equal(describeAccountChanges(some({ newer: ["a", "b"], added: ["c"] })), "Changes from another device: 3 pieces. Press Get changes.");
    assert.equal(describeAccountChanges(some({ deleted: ["a"] })), "Changes from another device: 1 piece. Press Get changes.");
    assert.equal(describeAccountChanges(some({ techniqueNewer: true })), "Changes from another device: the technique library. Press Get changes.");
    assert.equal(describeAccountChanges(some({ newer: ["a"], techniqueNewer: true })), "Changes from another device: 1 piece and the technique library. Press Get changes.");
    assert.equal(describeAccountChanges(empty), null);
    assert.equal(describeAccountChanges(some({ held: ["a"], needsReview: ["b"], techniqueHeld: true })), null, "held and needs-review have their own messages");
    assert.equal(describeAccountChanges(null), null);
  });

  test("what the Account panel is told shrinks by itself as the record catches up", () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const rows = { pieces: [live("p1", 2), live("p2", 1), live("p3", 1), live("p9", 1)], technique: { revision: 3 } };
    const first = syncSnapshot({ pieces, technique, userId: USER, storage, accountRows: rows });
    assert.deepEqual([first.changes.newer, first.changes.added, first.changes.techniqueNewer], [["p1"], ["p9"], true]);
    // "Get changes" records the account's revisions
    saveDeviceRecord(withPieceUploaded(readDeviceRecord(storage), USER, "p1", { revision: 2, fingerprint: pieceFingerprint(pieces.p1) }, 5), storage);
    saveDeviceRecord(withPieceUploaded(readDeviceRecord(storage), USER, "p9", { revision: 1, fingerprint: "x" }, 5), storage);
    saveDeviceRecord(withTechniqueUploaded(readDeviceRecord(storage), USER, { revision: 3, fingerprint: techniqueFingerprint(technique) }, 5), storage);
    const after = syncSnapshot({ pieces: { ...pieces, p9: piece("p9") }, technique, userId: USER, storage, accountRows: rows });
    assert.equal(describeAccountChanges(after.changes), null);
    assert.equal(syncSnapshot({ pieces, technique, userId: USER, storage }).changes, null, "no light read yet");
    assert.equal(syncSnapshot({ pieces, technique, userId: USER, storage: memoryStorage(), accountRows: rows }).changes, null, "before the first backup is checked");
  });
});

describe("the light read (Pass 116)", () => {
  const manyPieces = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${String(i).padStart(3, "0")}`, piece(`p${String(i).padStart(3, "0")}`)]));
  const readWith = (fake, extra = {}) => checkAccountChanges({ userId: USER, getClient: async () => fake.client, ...extra });

  test("it asks only for id, revision and deleted_at (and the technique row's revision), never the data column", async () => {
    const pieces = three();
    const fake = syncFake(accountHolding(pieces, technique));
    const r = await readWith(fake);
    assert.equal(r.status, "ok");
    const asked = fake.selects().map((c) => [c.table, c.columns]);
    assert.deepEqual(asked, [["pieces", "id, revision, deleted_at"], ["technique", "revision"]]);
    assert.equal(fake.writes().length, 0, "and writes nothing");
    assert.equal(fake.selects().every((c) => !/data/.test(c.columns)), true);
    r.rows.pieces.forEach((row) => assert.deepEqual(Object.keys(row).sort(), ["deleted_at", "id", "revision"]));
    assert.deepEqual(r.rows.technique, { revision: 1 });
    assert.deepEqual(r.rows.pieces.map((x) => x.id), ["p1", "p2", "p3"]);
  });

  test("it pages the way the count does: 50 rows a request, every page light", async () => {
    const pieces = manyPieces(120);
    const fake = syncFake(accountHolding(pieces, technique));
    const r = await readWith(fake);
    assert.equal(r.rows.pieces.length, 120);
    const pageCalls = fake.selects().filter((c) => c.table === "pieces");
    assert.equal(pageCalls.length, 3);
    assert.equal(pageCalls.every((c) => c.columns === "id, revision, deleted_at"), true);
    // exactly a full page ends with one more (empty) request, like the count does
    const exact = syncFake(accountHolding(manyPieces(50), technique));
    assert.equal((await readWith(exact)).rows.pieces.length, 50);
    assert.equal(exact.selects().filter((c) => c.table === "pieces").length, 2);
  });

  test("a row marked deleted and a missing technique row read as such", async () => {
    const pieces = three();
    const held = accountHolding(pieces, technique);
    held.pieceRows[1] = { ...held.pieceRows[1], deleted_at: "2026-10-01T00:00:00Z", revision: 4 };
    held.techniqueRows = [];
    const r = await readWith(syncFake(held));
    assert.deepEqual(r.rows.pieces.find((x) => x.id === "p2"), { id: "p2", revision: 4, deleted_at: "2026-10-01T00:00:00Z" });
    assert.equal(r.rows.technique, null);
  });

  test("a 503 (the service isn't answering) is a stopped check, either request", async () => {
    const down = { data: null, error: { message: "Service Unavailable", code: "" }, status: 503 };
    for (const table of ["pieces", "technique"]) {
      const fake = syncFake({ ...accountHolding(three(), technique), inject: (call) => (call.table === table ? down : null) });
      assert.deepEqual(await readWith(fake), { status: "stopped", reason: "connection" }, `503 on ${table}`);
    }
  });

  test("a dropped connection is a stopped check", async () => {
    const fake = syncFake({ ...accountHolding(three(), technique), inject: () => noConnection() });
    assert.deepEqual(await readWith(fake), { status: "stopped", reason: "connection" });
  });

  test("something else the database objects to is 'other'; a client that throws or can't load never throws out", async () => {
    const denied = { data: null, error: { message: "permission denied", code: "42501" }, status: 403 };
    const fake = syncFake({ ...accountHolding(three(), technique), inject: () => denied });
    assert.deepEqual(await readWith(fake), { status: "stopped", reason: "other" });
    assert.deepEqual(await checkAccountChanges({ userId: USER, getClient: async () => null }), { status: "stopped", reason: "connection" });
    assert.deepEqual(await checkAccountChanges({ userId: USER, getClient: async () => { throw new TypeError("Failed to fetch"); } }), { status: "stopped", reason: "connection" });
    assert.deepEqual(await checkAccountChanges({ userId: USER, getClient: async () => { throw new Error("odd"); } }), { status: "stopped", reason: "other" });
    const broken = { auth: { getSession: async () => ({ data: { session: { user: { id: USER } } } }) }, from: () => { throw new Error("boom"); } };
    assert.deepEqual(await checkAccountChanges({ userId: USER, getClient: async () => broken }), { status: "stopped", reason: "other" });
  });

  test("signed out, or signed in as someone else: stopped, and no request is made", async () => {
    const fake = syncFake(accountHolding(three(), technique));
    const other = { ...fake.client, auth: { getSession: async () => ({ data: { session: { user: { id: "someone-else" } } }, error: null }) } };
    assert.deepEqual(await checkAccountChanges({ userId: USER, getClient: async () => other }), { status: "stopped", reason: "signed-out" });
    const none = { ...fake.client, auth: { getSession: async () => ({ data: { session: null }, error: null }) } };
    assert.deepEqual(await checkAccountChanges({ userId: USER, getClient: async () => none }), { status: "stopped", reason: "signed-out" });
    assert.equal(fake.calls.length, 0);
  });
});

describe("when a check runs (Pass 116)", () => {
  // A clock the test moves by hand.
  const clock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
  };
  const checkerOver = (fake, c) => createAccountChecker({ getClient: async () => fake.client, now: c.now });
  const checks = (fake) => fake.selects().filter((x) => x.table === "pieces").length;

  test("two focus events inside a minute make one request", async () => {
    const fake = syncFake(accountHolding(three(), technique)), c = clock(), checker = checkerOver(fake, c);
    const a = await checker.run({ trigger: "focus", userId: USER });
    c.advance(5000); // the visibilitychange that comes with the same return to the window
    const b = await checker.run({ trigger: "focus", userId: USER });
    assert.equal(a.ran, true);
    assert.deepEqual(b, { ran: false, why: "too-soon" });
    assert.equal(checks(fake), 1);
    c.advance(CHECK_FOCUS_GAP_MS);
    assert.equal((await checker.run({ trigger: "focus", userId: USER })).ran, true, "a minute later it does");
    assert.equal(checks(fake), 2);
  });

  test("the page's own clock asks every minute (Pass 120: it was five), not before", async () => {
    assert.equal(CHECK_EVERY_MS, 60 * 1000);
    const fake = syncFake(accountHolding(three(), technique)), c = clock(), checker = checkerOver(fake, c);
    await checker.run({ trigger: "startup", userId: USER });
    c.advance(CHECK_EVERY_MS - 1000);
    assert.equal((await checker.run({ trigger: "interval", userId: USER })).ran, false);
    c.advance(1000);
    assert.equal((await checker.run({ trigger: "interval", userId: USER })).ran, true);
    assert.equal(checks(fake), 2);
  });

  test("startup and coming back online always run (once nothing is already running)", async () => {
    const fake = syncFake(accountHolding(three(), technique)), c = clock(), checker = checkerOver(fake, c);
    await checker.run({ trigger: "focus", userId: USER });
    assert.equal((await checker.run({ trigger: "online", userId: USER })).ran, true);
    assert.equal((await checker.run({ trigger: "startup", userId: USER })).ran, true);
    assert.equal(checks(fake), 3);
  });

  test("never while the page is hidden, and never two at once", async () => {
    const fake = syncFake(accountHolding(three(), technique)), c = clock(), checker = checkerOver(fake, c);
    assert.deepEqual(await checker.run({ trigger: "startup", userId: USER, visible: false }), { ran: false, why: "hidden" });
    assert.equal(fake.calls.length, 0);
    const first = checker.run({ trigger: "online", userId: USER });
    const second = await checker.run({ trigger: "online", userId: USER });
    assert.deepEqual(second, { ran: false, why: "running" });
    assert.equal((await first).ran, true);
    assert.equal(checks(fake), 1);
  });

  test("reset forgets the last check (signed out, or another account)", async () => {
    const fake = syncFake(accountHolding(three(), technique)), c = clock(), checker = checkerOver(fake, c);
    await checker.run({ trigger: "focus", userId: USER });
    checker.reset();
    assert.equal((await checker.run({ trigger: "focus", userId: USER })).ran, true);
  });

  test("a clock that moved back doesn't hide checks for an hour", () => {
    assert.equal(checkIsDue({ trigger: "focus", now: 1000, lastStartedAt: 1000 + 3600000 }), true);
    assert.equal(checkIsDue({ trigger: "nonsense", now: 1000, lastStartedAt: null }), false);
  });

  test("a failed check counts toward the same 'isn't answering' count the uploads use, and a good one starts it again", async () => {
    const down = { data: null, error: { message: "Service Unavailable", code: "" }, status: 503 };
    const fake = syncFake({ ...accountHolding(three(), technique), inject: () => down }), c = clock(), checker = checkerOver(fake, c);
    let failures = 0;
    for (let i = 0; i < NOT_ANSWERING_AFTER; i++) {
      const out = await checker.run({ trigger: "online", userId: USER });
      assert.equal(out.result.status, "stopped");
      assert.equal(checkOutcome(out), "failure");
      failures = nextFailureCount(failures, checkOutcome(out));
    }
    assert.equal(failures, NOT_ANSWERING_AFTER);
    const status = describeSyncStatus({ now: 9000, firstBackupDone: true, backedUpAt: 1000, waiting: 0, held: { pieces: [], technique: false }, failures });
    assert.match(status.text, /isn't answering/);
    // the service comes back
    const back = syncFake(accountHolding(three(), technique));
    const good = await createAccountChecker({ getClient: async () => back.client, now: c.now }).run({ trigger: "online", userId: USER });
    assert.equal(checkOutcome(good), "success");
    assert.equal(nextFailureCount(failures, checkOutcome(good)), 0);
  });

  test("what counts as a success, a failure, or neither", () => {
    assert.equal(checkOutcome({ ran: true, result: { status: "ok", rows: {} } }), "success");
    assert.equal(checkOutcome({ ran: true, result: { status: "stopped", reason: "connection" } }), "failure");
    assert.equal(checkOutcome({ ran: true, result: { status: "stopped", reason: "other" } }), "failure");
    assert.equal(checkOutcome({ ran: true, result: { status: "stopped", reason: "signed-out" } }), "idle");
    assert.equal(checkOutcome({ ran: false, why: "too-soon" }), "idle");
    assert.equal(checkOutcome(null), "idle");
  });

  test("a check's rows are believed only if nothing wrote the device record while it read, and nothing is running now", () => {
    const before = { pieces: { p1: { revision: 1, fingerprint: "a" } }, technique: null, checkedAt: 1, syncedAt: 1 };
    assert.equal(checkRowsUsable({ recordBefore: before, recordNow: { ...before, pieces: { p1: { fingerprint: "a", revision: 1 } } }, busy: false }), true, "same record, key order aside");
    assert.equal(checkRowsUsable({ recordBefore: before, recordNow: { ...before, pieces: { p1: { revision: 2, fingerprint: "b" } }, syncedAt: 9 }, busy: false }), false, "an upload was confirmed meanwhile");
    assert.equal(checkRowsUsable({ recordBefore: before, recordNow: before, busy: true }), false, "an upload, backup or Get changes is running now");
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 117: the record's parts                                       */
/* ------------------------------------------------------------------ */

describe("the device record's parts (Pass 117)", () => {
  // A piece with a few real chunk entries, so there are several parts to tell apart.
  const withWork = (id) =>
    validateAndMigratePiece({
      ...piece(id),
      measureDifficulty: Array(32).fill(1),
      startDate: "2026-09-01",
      createdAt: 1234, // every real piece has one; a restore stamps one on a copy that lacks it
      updatedAt: 5,
      progress: { c1: { doneDays: [1], sessions: [{ day: 1, loggedAt: 11, loggedDate: "2026-09-01", cleanReps: 3, bpm: 60, outcome: "pass" }] } },
    });
  const own = () => ({ p1: withWork("p1"), p2: withWork("p2") });

  test("parts are read from the record only beside a recorded revision, and only as text", () => {
    const storage = memoryStorage();
    saveDeviceRecord(
      {
        version: 1,
        accounts: {
          [USER]: {
            pieces: {
              a: { revision: 1, fingerprint: "f", parts: { name: "x", id: "y", bad: 5, worse: null } },
              b: { held: true, parts: { name: "x" } },
              c: { revision: 2, fingerprint: "g", parts: {} },
              d: { revision: 3, fingerprint: "h", parts: "nope" },
            },
            technique: null,
            checkedAt: 1,
            syncedAt: 1,
          },
        },
      },
      storage
    );
    const entries = recordOf(storage).pieces;
    assert.deepEqual(entries.a.parts, { name: "x", id: "y" });
    assert.equal(entries.b.parts, undefined, "no revision, so nothing for it to describe");
    assert.equal(entries.c.parts, undefined);
    assert.equal(entries.d.parts, undefined);
  });

  test("a record written before this pass reads back exactly as it was, with no parts invented", () => {
    const storage = memoryStorage();
    const old = { version: 1, accounts: { [USER]: { pieces: { p1: { revision: 4, fingerprint: "abc" } }, technique: { revision: 2, fingerprint: "t" }, checkedAt: 5, syncedAt: 9 } } };
    saveDeviceRecord(old, storage);
    assert.deepEqual(readDeviceRecord(storage), old);
  });

  test("withPieceUploaded records the parts it is given, and an entry without them drops any it had", () => {
    let record = withPieceUploaded(readDeviceRecord(memoryStorage()), USER, "p1", { revision: 2, fingerprint: "f", parts: { name: "x" } }, 1);
    assert.deepEqual(accountRecordFor(record, USER).pieces.p1, { revision: 2, fingerprint: "f", parts: { name: "x" } });
    record = withPieceUploaded(record, USER, "p1", { revision: 3, fingerprint: "g" }, 2);
    assert.deepEqual(accountRecordFor(record, USER).pieces.p1, { revision: 3, fingerprint: "g" }, "the old parts describe an older sync, so they go");
  });

  test("an upload that the account confirms records the parts of exactly what was sent", async () => {
    const storage = memoryStorage(), pieces = own();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const changed = { ...pieces, p2: { ...pieces.p2, name: "Edited here", updatedAt: 6 } };
    await runSync(changed, technique, fake, storage);
    const entry = recordOf(storage).pieces.p2;
    assert.equal(entry.revision, 2);
    assert.deepEqual(entry.parts, piecePartFingerprints(changed.p2));
    assert.ok(entry.parts["progress:c1"] && entry.parts.name && !("progress" in entry.parts) && !("updatedAt" in entry.parts));
    assert.equal(recordOf(storage).pieces.p1.parts, undefined, "a piece that wasn't uploaded isn't touched");
  });

  test("a new piece, once added, has its parts recorded too", async () => {
    const storage = memoryStorage(), pieces = own();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const withNew = { ...pieces, p3: withWork("p3") };
    await runSync(withNew, technique, fake, storage);
    assert.deepEqual(recordOf(storage).pieces.p3.parts, piecePartFingerprints(withNew.p3));
  });

  test("an adopted row that is only an earlier version of this device's piece has no parts (they would describe a copy this device no longer has), until the next confirmed upload", async () => {
    const storage = memoryStorage(), pieces = own();
    afterFirstBackup(pieces, technique, storage);
    // an upload lands on the account but its confirmation is lost
    let landed = false;
    const fake = syncFake({
      ...accountHolding(pieces, technique),
      inject: (call, rows) => {
        if (landed || call.op !== "update" || call.id !== "p2") return null;
        landed = true;
        const row = rows.pieces.find((x) => x.id === "p2");
        Object.assign(row, viaJson(call.values), { data: reorder(viaJson(call.values.data)) });
        row.revision += 1;
        return noConnection();
      },
    });
    const v2 = { ...pieces.p2, name: "Version 2" };
    await runSync({ ...pieces, p2: v2 }, technique, fake, storage);
    const v3 = { ...v2, name: "Version 3" };
    // adopt the earlier version, then the retry's own update is lost too, so only the adoption is recorded
    const stopAfterAdopt = syncFake({
      pieceRows: fake.rows.pieces,
      techniqueRows: fake.rows.technique,
      inject: (c) => (c.op === "update" && c.filters.some(([k, v]) => k === "revision" && v === 2) ? noConnection() : null),
    });
    await runSync({ ...pieces, p2: v3 }, technique, stopAfterAdopt, storage);
    assert.equal(recordOf(storage).pieces.p2.revision, 2, "the row's revision was adopted");
    assert.equal(recordOf(storage).pieces.p2.parts, undefined, "but no parts: this device doesn't hold that version");
    // the next confirmed upload records them
    await runSync({ ...pieces, p2: v3 }, technique, syncFake({ pieceRows: stopAfterAdopt.rows.pieces, techniqueRows: stopAfterAdopt.rows.technique }), storage);
    assert.deepEqual(recordOf(storage).pieces.p2.parts, piecePartFingerprints(v3));
  });

  test("the first backup records the parts of every piece it backed up", async () => {
    const storage = memoryStorage(), pieces = own();
    const fake = syncFake({});
    const result = await backUpDevice({ pieces, technique: reloadedTechnique(), userId: USER, getClient: async () => fake.client, storage, now: () => 1000 });
    assert.equal(result.backedUp, 2);
    ["p1", "p2"].forEach((id) => assert.deepEqual(recordOf(storage).pieces[id].parts, piecePartFingerprints(pieces[id]), id));
  });

  test("a copy taken from the account is recorded with the parts of the account's copy, not of whatever this device holds on top of it", () => {
    const account = withWork("p1");
    const candidates = accountRowsToCandidates({ pieces: [pieceRow(account, { revision: 4 })], technique: null });
    const local = { p1: { ...account, name: "Changed here", updatedAt: 99 } };
    const out = applyAccountMerge({ candidates, localPieces: local, localTechnique: null, accountRecord: { pieces: { p1: { revision: 3, fingerprint: "old" } } }, selectedIds: null, includeTechnique: false });
    const entry = out.entries.p1;
    assert.equal(entry.revision, 4);
    assert.deepEqual(entry.parts, piecePartFingerprints(account));
    const storage = memoryStorage();
    saveDeviceRecord(withAccountCopyRecorded(readDeviceRecord(storage), USER, { entries: out.entries }), storage);
    assert.deepEqual(recordOf(storage).pieces.p1.parts, piecePartFingerprints(account), "and the record keeps them");
    // an entry that has none (a caller that doesn't know) records none, not an empty object
    const bare = withAccountCopyRecorded(readDeviceRecord(memoryStorage()), USER, { entries: { p9: { revision: 1, fingerprint: "z" } } });
    assert.deepEqual(accountRecordFor(bare, USER).pieces.p9, { revision: 1, fingerprint: "z" });
  });

  test("restoring onto an empty device records every restored piece's parts", () => {
    const rows = [pieceRow(withWork("p1")), pieceRow(withWork("p2"))];
    const candidates = accountRowsToCandidates({ pieces: rows, technique: null });
    const out = applyAccountMerge({ candidates, localPieces: {}, localTechnique: null, accountRecord: null, selectedIds: null, includeTechnique: false });
    ["p1", "p2"].forEach((id) => assert.deepEqual(out.entries[id].parts, piecePartFingerprints(out.pieces[id]), id));
  });

  test("the quiet startup step records parts only for pieces that still equal their record", () => {
    const storage = memoryStorage(), pieces = own();
    afterFirstBackup(pieces, technique, storage); // a record from before parts existed
    const edited = { ...pieces, p2: { ...pieces.p2, name: "Changed since the last sync", updatedAt: 6 } };
    const { record, recorded } = withPartsRecorded(readDeviceRecord(storage), edited);
    assert.equal(recorded, 1);
    const entries = accountRecordFor(record, USER).pieces;
    assert.deepEqual(entries.p1.parts, piecePartFingerprints(pieces.p1), "unchanged since the last sync: the local copy IS the synced state");
    assert.equal(entries.p2.parts, undefined, "changes waiting: no parts, so a merge would ask");
    assert.deepEqual({ revision: entries.p1.revision, fingerprint: entries.p1.fingerprint }, { revision: 1, fingerprint: pieceFingerprint(pieces.p1) }, "nothing else about the entry changes");
    // the piece's whole record didn't need to be touched to know that
    assert.equal(computeWaiting({ pieces: edited, technique, accountRecord: accountRecordFor(record, USER) }).count, 1);
  });

  test("the startup step leaves entries that already have parts, entries with nothing recorded, and pieces this device no longer holds alone", () => {
    const pieces = own();
    const have = { revision: 1, fingerprint: pieceFingerprint(pieces.p1), parts: { name: "kept as it was" } };
    const record = {
      version: 1,
      accounts: {
        [USER]: {
          pieces: { p1: have, p2: { held: true }, gone: { revision: 1, fingerprint: "x" }, p3: { revision: 1, fingerprint: "mismatch" } },
          technique: null,
          checkedAt: 1,
          syncedAt: 1,
        },
      },
    };
    const out = withPartsRecorded(record, { ...pieces, p3: withWork("p3") });
    assert.equal(out.recorded, 0);
    assert.equal(out.record, record, "nothing to record: the very same record comes back");
  });

  test("the startup step works for every account in the record, and is idempotent", () => {
    const storage = memoryStorage(), pieces = own();
    afterFirstBackup(pieces, technique, storage);
    const other = withBackupRecorded(readDeviceRecord(storage), "user-b", { pieces: { p1: { revision: 7, fingerprint: pieceFingerprint(pieces.p1) } }, technique: null, checkedAt: 3 });
    const first = withPartsRecorded(other, pieces);
    assert.equal(first.recorded, 3, "two pieces for one account, one for the other");
    assert.deepEqual(accountRecordFor(first.record, "user-b").pieces.p1.parts, piecePartFingerprints(pieces.p1));
    const second = withPartsRecorded(first.record, pieces);
    assert.equal(second.recorded, 0);
    assert.equal(second.record, first.record);
    assert.equal(withPartsRecorded(null, pieces).recorded, 0, "no record at all is fine");
  });

  test("adding parts doesn't change what's waiting", () => {
    const storage = memoryStorage(), pieces = own();
    afterFirstBackup(pieces, technique, storage);
    const before = computeWaiting({ pieces, technique, accountRecord: recordOf(storage) });
    const { record } = withPartsRecorded(readDeviceRecord(storage), pieces);
    assert.deepEqual(computeWaiting({ pieces, technique, accountRecord: accountRecordFor(record, USER) }), before);
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 118: the technique library's parts in the record              */
/* ------------------------------------------------------------------ */

describe("the device record's technique parts (Pass 118)", () => {
  // A library with a few real parts: two scales, a starred one, a tempo, a done task.
  const library = () =>
    validateAndMigrateTechnique({
      schemaVersion: 1,
      items: [
        { id: "t1", tonic: "C", quality: "major", starred: true, evenTempo: 90, lastCheckedDate: "2026-10-01", lastPracticedDate: "2026-10-01", practicedDates: ["2026-10-01"] },
        { id: "t2", tonic: "D", quality: "minor", minorForm: "natural" },
      ],
      methodState: { eyes: { starred: true, enabled: true } },
      walkPosition: 3,
      dayList: { date: "2026-10-01", tasks: [{ itemId: "t1", methodIds: ["eyes"], done: true, tier: "pace", tempo: 90 }, { itemId: "t2", methodIds: [], done: false, tier: "walk" }] },
    });

  test("the parts are one fingerprint per part: each scale's, each method's state, the settings, the walk, each task", () => {
    const parts = techniquePartFingerprints(library());
    ["scale:t1", "starred:t1", "check:t1", "lastPracticed:t1", "practicedOn:t1:2026-10-01", "scale:t2", "octaves:t2", "hands:t2", "methodStarred:eyes",
      "setting:scalesPerDay", "setting:minutesPerScale", "walk", "taskDone:2026-10-01:t1", "taskPlan:2026-10-01:t1", "taskPlan:2026-10-01:t2"].forEach((k) => {
      assert.equal(typeof parts[k], "string", k);
    });
    assert.equal(parts["taskDone:2026-10-01:t2"], undefined, "a part holding its default (a task not done) is left out");
    assert.equal(parts["starred:t2"], undefined, "so is a scale that isn't starred");
    assert.equal("updatedAt" in parts || "schemaVersion" in parts, false, "stamps are not parts");
  });

  test("the parts are the same after a reload, and a record carries them for the technique entry like a piece's", () => {
    const storage = memoryStorage();
    const t = library();
    const parts = techniquePartFingerprints(t);
    assert.deepEqual(techniquePartFingerprints(validateAndMigrateTechnique(viaJson(t))), parts);
    saveDeviceRecord(withTechniqueUploaded(readDeviceRecord(storage), USER, { revision: 2, fingerprint: techniqueFingerprint(t), parts }, 1), storage);
    assert.deepEqual(recordOf(storage).technique, { revision: 2, fingerprint: techniqueFingerprint(t), parts });
  });

  test("parts are read back for the technique entry only beside a recorded revision, and only as text", () => {
    const storage = memoryStorage();
    const put = (technique) => saveDeviceRecord({ version: 1, accounts: { [USER]: { pieces: {}, technique, checkedAt: 1, syncedAt: 1 } } }, storage);
    put({ revision: 1, fingerprint: "f", parts: { walk: "x", bad: 5, worse: null } });
    assert.deepEqual(recordOf(storage).technique.parts, { walk: "x" });
    put({ held: true, parts: { walk: "x" } });
    assert.equal(recordOf(storage).technique.parts, undefined, "no revision, so nothing for it to describe");
    put({ revision: 2, fingerprint: "g", parts: "nope" });
    assert.equal(recordOf(storage).technique.parts, undefined);
  });

  test("withTechniqueUploaded records the parts it is given, and an entry without them drops any it had", () => {
    let record = withTechniqueUploaded(readDeviceRecord(memoryStorage()), USER, { revision: 2, fingerprint: "f", parts: { walk: "x" } }, 1);
    assert.deepEqual(accountRecordFor(record, USER).technique, { revision: 2, fingerprint: "f", parts: { walk: "x" } });
    record = withTechniqueUploaded(record, USER, { revision: 3, fingerprint: "g" }, 2);
    assert.deepEqual(accountRecordFor(record, USER).technique, { revision: 3, fingerprint: "g" }, "the old parts describe an older sync, so they go");
  });

  test("holding the library, or noting an attempt, keeps the parts it already had", () => {
    let record = withTechniqueUploaded(readDeviceRecord(memoryStorage()), USER, { revision: 2, fingerprint: "f", parts: { walk: "x" } }, 1);
    record = withTechniqueHeld(record, USER);
    assert.deepEqual(accountRecordFor(record, USER).technique, { revision: 2, fingerprint: "f", parts: { walk: "x" }, held: true });
    record = withSentRecorded(record, USER, { kind: "technique" }, "p1");
    assert.deepEqual(accountRecordFor(record, USER).technique.parts, { walk: "x" });
  });

  test("an upload the account confirms records the parts of exactly what was sent", async () => {
    const storage = memoryStorage(), pieces = three(), t1 = library();
    afterFirstBackup(pieces, t1, storage);
    const fake = syncFake(accountHolding(pieces, t1));
    const t2 = { ...t1, walkPosition: 5, items: t1.items.map((it) => (it.id === "t2" ? { ...it, starred: true } : it)) };
    await runSync(pieces, t2, fake, storage);
    assert.equal(recordOf(storage).technique.revision, 2);
    assert.deepEqual(recordOf(storage).technique.parts, techniquePartFingerprints(t2));
    assert.notDeepEqual(recordOf(storage).technique.parts, techniquePartFingerprints(t1));
  });

  test("an adopted row that is only an earlier version of this device's library has no parts, until the next confirmed upload", async () => {
    const storage = memoryStorage(), pieces = three(), t1 = library();
    afterFirstBackup(pieces, t1, storage);
    let landed = false;
    const fake = syncFake({
      ...accountHolding(pieces, t1),
      inject: (call, rows) => {
        if (landed || call.table !== "technique" || call.op !== "update") return null;
        landed = true;
        Object.assign(rows.technique[0], viaJson(call.values), { data: reorder(viaJson(call.values.data)) });
        rows.technique[0].revision += 1;
        return noConnection();
      },
    });
    const t2 = { ...t1, walkPosition: 4 };
    await runSync(pieces, t2, fake, storage);
    const t3 = { ...t2, walkPosition: 6 };
    const stopAfterAdopt = syncFake({
      pieceRows: fake.rows.pieces,
      techniqueRows: fake.rows.technique,
      inject: (c) => (c.table === "technique" && c.op === "update" && c.filters.some(([k, v]) => k === "revision" && v === 2) ? noConnection() : null),
    });
    await runSync(pieces, t3, stopAfterAdopt, storage);
    assert.equal(recordOf(storage).technique.revision, 2, "the row's revision was adopted");
    assert.equal(recordOf(storage).technique.parts, undefined, "but no parts: this device doesn't hold that version");
    await runSync(pieces, t3, syncFake({ pieceRows: stopAfterAdopt.rows.pieces, techniqueRows: stopAfterAdopt.rows.technique }), storage);
    assert.deepEqual(recordOf(storage).technique.parts, techniquePartFingerprints(t3));
  });

  test("the first backup records the parts of the library it backed up", async () => {
    const storage = memoryStorage();
    const t = reloadedTechnique();
    const result = await backUpDevice({ pieces: { p1: piece("p1") }, technique: t, userId: USER, getClient: async () => syncFake({}).client, storage, now: () => 1000 });
    assert.equal(result.technique, "backedUp");
    assert.deepEqual(recordOf(storage).technique.parts, techniquePartFingerprints(t));
  });

  test("a library taken from the account is recorded with the parts of the account's copy, not of whatever this device holds on top of it", () => {
    const account = library();
    const local = validateAndMigrateTechnique({ schemaVersion: 1, items: [{ id: "mine", tonic: "G", quality: "major" }] });
    const candidates = accountRowsToCandidates({ pieces: [], technique: { revision: 4, data: reorder(viaJson(account)) } });
    const out = applyAccountMerge({ candidates, localPieces: {}, localTechnique: local, accountRecord: syncedRecord({}) });
    assert.equal(out.technique.entry.revision, 4);
    assert.deepEqual(out.technique.entry.parts, techniquePartFingerprints(account));
    assert.notDeepEqual(out.technique.entry.parts, techniquePartFingerprints(out.technique.value), "this device holds more than the account's copy");
    const storage = memoryStorage();
    saveDeviceRecord(withAccountCopyRecorded(readDeviceRecord(storage), USER, { technique: out.technique.entry }), storage);
    assert.deepEqual(recordOf(storage).technique.parts, techniquePartFingerprints(account), "and the record keeps them");
    // an entry that has none (a caller that doesn't know) records none, not an empty object
    const bare = withAccountCopyRecorded(readDeviceRecord(memoryStorage()), USER, { technique: { revision: 1, fingerprint: "z" } });
    assert.deepEqual(accountRecordFor(bare, USER).technique, { revision: 1, fingerprint: "z" });
  });

  test("the quiet startup step records the library's parts only when it still equals its record", () => {
    const storage = memoryStorage(), pieces = three(), t = library();
    afterFirstBackup(pieces, t, storage); // a record from before technique parts existed
    const { record, recorded } = withTechniquePartsRecorded(readDeviceRecord(storage), t);
    assert.equal(recorded, 1);
    const entry = accountRecordFor(record, USER).technique;
    assert.deepEqual(entry.parts, techniquePartFingerprints(t), "unchanged since the last sync: the local copy IS the synced state");
    assert.deepEqual({ revision: entry.revision, fingerprint: entry.fingerprint }, { revision: 1, fingerprint: techniqueFingerprint(t) }, "nothing else about the entry changes");
    // changes waiting: left alone, so a merge would ask
    const edited = { ...t, walkPosition: 9 };
    const stored = readDeviceRecord(storage);
    const waiting = withTechniquePartsRecorded(stored, edited);
    assert.equal(waiting.recorded, 0);
    assert.equal(waiting.record, stored, "the very same record comes back");
    assert.equal(accountRecordFor(waiting.record, USER).technique.parts, undefined);
    assert.equal(computeWaiting({ pieces, technique: edited, accountRecord: accountRecordFor(waiting.record, USER) }).count, 1);
  });

  test("the startup step leaves an entry that already has parts, one with nothing recorded, and a missing library alone; it works for every account and is idempotent", () => {
    const t = library();
    const have = { revision: 1, fingerprint: techniqueFingerprint(t), parts: { walk: "kept as it was" } };
    const keep = { version: 1, accounts: { [USER]: { pieces: {}, technique: have, checkedAt: 1, syncedAt: 1 }, b: { pieces: {}, technique: { held: true }, checkedAt: 1, syncedAt: 1 }, c: { pieces: {}, technique: null, checkedAt: 1, syncedAt: 1 } } };
    const none = withTechniquePartsRecorded(keep, t);
    assert.equal(none.recorded, 0);
    assert.equal(none.record, keep);
    assert.equal(withTechniquePartsRecorded(keep, null).recorded, 0, "no library is fine");
    assert.equal(withTechniquePartsRecorded(null, t).recorded, 0, "no record at all is fine");

    const old = { version: 1, accounts: { a: { pieces: {}, technique: { revision: 3, fingerprint: techniqueFingerprint(t) }, checkedAt: 1, syncedAt: 1 }, b: { pieces: {}, technique: { revision: 8, fingerprint: techniqueFingerprint(t) }, checkedAt: 1, syncedAt: 1 }, c: { pieces: {}, technique: { revision: 2, fingerprint: "other" }, checkedAt: 1, syncedAt: 1 } } };
    const first = withTechniquePartsRecorded(old, t);
    assert.equal(first.recorded, 2, "the two accounts whose entry matches this library");
    assert.deepEqual(first.record.accounts.a.technique.parts, techniquePartFingerprints(t));
    assert.deepEqual(first.record.accounts.b.technique.parts, techniquePartFingerprints(t));
    assert.equal(first.record.accounts.c.technique.parts, undefined);
    const second = withTechniquePartsRecorded(first.record, t);
    assert.equal(second.recorded, 0);
    assert.equal(second.record, first.record);
  });

  test("adding parts doesn't change what's waiting", () => {
    const storage = memoryStorage(), pieces = three(), t = library();
    afterFirstBackup(pieces, t, storage);
    const before = computeWaiting({ pieces, technique: t, accountRecord: recordOf(storage) });
    const { record } = withTechniquePartsRecorded(readDeviceRecord(storage), t);
    assert.deepEqual(computeWaiting({ pieces, technique: t, accountRecord: accountRecordFor(record, USER) }), before);
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 120: changes from other devices arrive by themselves          */
/*  (switched off by default). The decisions live in accountSync.js;   */
/*  App.jsx only schedules them.                                       */
/* ------------------------------------------------------------------ */

// The piece with one session logged on `chunkId` (any chunk, not just c1).
const logOn = (p, chunkId, day, updatedAt = (p.updatedAt || 0) + 1000) =>
  validateAndMigratePiece({
    ...viaJson(p),
    updatedAt,
    progress: {
      ...viaJson(p).progress,
      [chunkId]: { doneDays: [day], currentBPM: 60 + day, sessions: [{ day, loggedDate: `2026-09-0${day + 1}`, reps: 3, bpm: 60 + day, durationSeconds: 60 * day, loggedAt: 1000 * day }] },
    },
  });
// A record entry for a piece as last synced: revision, fingerprint and parts (the base).
const syncedAs = (p, revision = 1) => ({ revision, fingerprint: pieceFingerprint(p), parts: piecePartFingerprints(p) });
const autoRec = (pieces, extra = {}) => ({ pieces, technique: null, checkedAt: 1000, syncedAt: null, ...extra });
const durations = (p) => Object.values(p.progress).flatMap((e) => (e.sessions || []).map((s) => s.durationSeconds)).sort((a, b) => a - b);

// Runs an automatic apply over [piece, revision] account rows.
const runAuto = ({ local, rows, record, busyIds = [], localTechnique = null, techniqueRow = null, includeTechnique = true }) => {
  const candidates = accountRowsToCandidates({ pieces: rows.map(([p, rev]) => acctRow(p, rev)), technique: techniqueRow });
  return applyAccountMerge({ candidates, localPieces: local, localTechnique, accountRecord: record, automatic: true, busyIds, includeTechnique });
};

describe("the switch is on this device only, off by default, and it stays (Pass 120)", () => {
  test("off unless chosen; per account; chosen state survives every kind of record update", () => {
    const empty = readDeviceRecord(memoryStorage());
    assert.equal(autoUpdateOn(empty, USER), false);
    const p = pieceOf("p1");
    let rec = withAutoUpdate(empty, USER, true);
    assert.equal(autoUpdateOn(rec, USER), true);
    assert.equal(autoUpdateOn(rec, "someone-else"), false, "a different account on this device has its own choice");
    // every function that rewrites an account's entry has to carry the switch over
    const after = [
      withPieceUploaded(rec, USER, "p1", syncedAs(p, 2), 5000),
      withSentRecorded(rec, USER, { kind: "piece", id: "p1" }, "abc"),
      withPieceHeld(rec, USER, "p1"),
      withAccountCopyRecorded(rec, USER, { entries: { p1: syncedAs(p, 3) }, checkedAt: 7 }),
      withBackupRecorded(rec, USER, { pieces: { p1: syncedAs(p) }, technique: null, checkedAt: 9 }),
      withTechniqueUploaded(rec, USER, { revision: 2, fingerprint: "f", parts: { a: "b" } }, 1),
      withPieceForgotten(rec, USER, "p1", 1),
      reconcileLocalDeletions(withPieceUploaded(rec, USER, "p1", syncedAs(p), 1), { removedIds: ["p1"] }).record,
    ];
    after.forEach((r, i) => assert.equal(autoUpdateOn(r, USER), true, `still on after update ${i}`));
  });

  test("it round-trips through storage, turning it off removes it, and anything but true reads as off", () => {
    const storage = memoryStorage();
    saveDeviceRecord(withAutoUpdate(readDeviceRecord(storage), USER, true), storage);
    assert.equal(autoUpdateOn(readDeviceRecord(storage), USER), true);
    saveDeviceRecord(withAutoUpdate(readDeviceRecord(storage), USER, false), storage);
    const off = readDeviceRecord(storage);
    assert.equal(autoUpdateOn(off, USER), false);
    assert.equal("autoUpdate" in accountRecordFor(off, USER), false, "left out, so an old record and a switched-off one read the same");
    storage.setItem(ACCOUNT_SYNC_KEY, JSON.stringify({ version: 1, accounts: { [USER]: { pieces: {}, technique: null, checkedAt: 1, syncedAt: null, autoUpdate: "yes" } } }));
    assert.equal(autoUpdateOn(readDeviceRecord(storage), USER), false);
  });

  test("a held piece keeps which parts conflicted (fingerprints only), and a settled one drops them", () => {
    const p = pieceOf("p1");
    const conflicts = [
      { part: "progress:c1", kind: "progress", local: "aa", remote: "bb", base: "cc" },
      { part: "notes", kind: "field", local: "aa", remote: "bb", base: null },
      { nonsense: true },
      { part: "x", kind: "not-a-kind" },
    ];
    const storage = memoryStorage();
    saveDeviceRecord(withPieceHeld(withPieceUploaded(readDeviceRecord(storage), USER, "p1", syncedAs(p, 4), 1), USER, "p1", conflicts), storage);
    const e = accountRecordFor(readDeviceRecord(storage), USER).pieces.p1;
    assert.equal(e.held, true);
    assert.equal(e.revision, 4, "what the entry knew is kept");
    assert.deepEqual(e.conflicts.map((c) => c.part), ["progress:c1", "notes"]);
    assert.equal(JSON.stringify(e).includes("nonsense"), false);
    const settled = withAccountCopyRecorded(readDeviceRecord(storage), USER, { entries: { p1: syncedAs(p, 5) } });
    assert.equal(accountRecordFor(settled, USER).pieces.p1.held, undefined);
    assert.equal(accountRecordFor(settled, USER).pieces.p1.conflicts, undefined);
    // conflicts without a hold mean nothing and are dropped on read
    storage.setItem(ACCOUNT_SYNC_KEY, JSON.stringify({ version: 1, accounts: { [USER]: { pieces: { p1: { revision: 1, fingerprint: "f", conflicts } }, technique: null, checkedAt: 1, syncedAt: null } } }));
    assert.equal(accountRecordFor(readDeviceRecord(storage), USER).pieces.p1.conflicts, undefined);
  });
});

describe("what an automatic update is about (Pass 120)", () => {
  const rows = {
    pieces: [
      { id: "p1", revision: 3, deleted_at: null }, // newer
      { id: "p2", revision: 1, deleted_at: null }, // not here: added
      { id: "p3", revision: 2, deleted_at: "2026-10-01T00:00:00Z" }, // deleted elsewhere
      { id: "p4", revision: 5, deleted_at: null }, // already held
      { id: "p5", revision: 2, deleted_at: null }, // here, no revision recorded
    ],
    technique: { revision: 3 },
  };
  const entry = (revision) => ({ revision, fingerprint: "f" });
  const record = (on) => {
    const r = { version: 1, accounts: { [USER]: autoRec({ p1: entry(1), p3: entry(1), p4: { ...entry(1), held: true } }, { technique: entry(1) }) } };
    return on ? withAutoUpdate(r, USER, true) : r;
  };
  const changes = (on) => classifyAccountChanges({ rows, accountRecord: accountRecordFor(record(on), USER), localPieceIds: ["p1", "p3", "p4", "p5"] });

  test("with the switch OFF nothing is ever a target: the app only notices, exactly as after Pass 116", () => {
    const c = changes(false);
    assert.deepEqual(c.newer, ["p1"]);
    assert.deepEqual(autoUpdateTargets({ deviceRecord: record(false), userId: USER, changes: c }), { on: false, pieceIds: [], technique: false });
    assert.match(describeAccountChanges(c), /Press Get changes/, "and the line that says so is unchanged");
  });

  test("with it ON: the newer and the added pieces, and the technique row; never a held, deleted or unmatched one", () => {
    const c = changes(true);
    assert.deepEqual(autoUpdateTargets({ deviceRecord: record(true), userId: USER, changes: c }), { on: true, pieceIds: ["p1", "p2"], technique: true });
    assert.deepEqual(c.deleted, ["p3"]);
    assert.deepEqual(c.held, ["p4"]);
    assert.deepEqual(c.needsReview, ["p5"]);
  });

  test("no check yet means no targets", () => {
    assert.deepEqual(autoUpdateTargets({ deviceRecord: record(true), userId: USER, changes: null }), { on: false, pieceIds: [], technique: false });
  });
});

describe("what applies by itself, what is held and what waits (Pass 120)", () => {
  const base = pieceOf("p1");
  const clean = pieceOf("pc"); // nothing waiting here, the account moved on
  const both = pieceOf("pb"); // changed on both sides, different chunks
  const clash = pieceOf("px"); // changed on both sides, the same chunk
  const noBase = pieceOf("pn"); // changed on both sides, but no recorded base
  const heldAlready = pieceOf("ph");
  const fresh = pieceOf("pf"); // only the account has it
  const same = pieceOf("ps");

  const local = {
    pc: clean,
    pb: logOn(both, "c5", 3),
    px: withRecording(clash, 2),
    pn: logOn(noBase, "c5", 3),
    ph: logOn(heldAlready, "c5", 3), // changed here too: it would merge, but it is already held
    ps: same,
  };
  const account = [
    [withMore(clean, 2), 2],
    [logOn(both, "c9", 4), 2],
    [withRecording(clash, 3), 2],
    [logOn(noBase, "c9", 4), 2],
    [logOn(heldAlready, "c9", 4), 2],
    [fresh, 1],
    [same, 2],
  ];
  const record = autoRec({
    pc: syncedAs(clean),
    pb: syncedAs(both),
    px: syncedAs(clash),
    pn: { revision: 1, fingerprint: pieceFingerprint(noBase) }, // no `parts`: nothing to compare from
    ph: { ...syncedAs(heldAlready), held: true },
    ps: syncedAs(same),
  });

  test("the plan: a clean newer copy is taken, parts that merge are merged, a clash is a conflict, no base still asks", () => {
    const candidates = accountRowsToCandidates({ pieces: account.map(([p, r]) => acctRow(p, r)), technique: null });
    const kinds = (automatic) => Object.fromEntries(planAccountMerge({ candidates, localPieces: local, accountRecord: record, automatic }).items.map((i) => [i.id, i.kind]));
    assert.deepEqual(kinds(true), { pc: "take", pb: "merge", px: "conflict", pn: "ask", ph: "merge", pf: "new", ps: "same" });
    // Get changes and Review (not automatic) are exactly as they were: a piece changed on both sides asks
    assert.deepEqual(kinds(false), { pc: "take", pb: "ask", px: "ask", pn: "ask", ph: "ask", pf: "new", ps: "same" });
  });

  test("applying: new, same, clean newer and cleanly merged pieces by themselves; the clash held; the rest left alone", () => {
    const out = runAuto({ local, rows: account, record });
    // by themselves
    assert.deepEqual(out.pieces.pc, { ...account[0][0] }, "taken as the account has it");
    assert.deepEqual(durations(out.pieces.pb), durations(logOn(both, "c5", 3)).concat(durations(logOn(both, "c9", 4))).filter((d, i, a) => a.indexOf(d) === i).sort((a, b) => a - b), "both sides' sessions are in the merged piece");
    assert.ok(out.pieces.pb.progress.c5 && out.pieces.pb.progress.c9);
    assert.equal(out.pieces.pf.id, "pf");
    assert.deepEqual(Object.keys(out.entries).sort(), ["pb", "pc", "pf", "ps"]);
    // what is recorded is the ACCOUNT's copy as read (so what this device holds beyond it goes up as an ordinary change)
    assert.deepEqual(out.entries.pb, { revision: 2, fingerprint: pieceFingerprint(account[1][0]), parts: piecePartFingerprints(account[1][0]) });
    assert.notEqual(pieceFingerprint(out.pieces.pb), out.entries.pb.fingerprint, "so the merged piece counts as a change waiting");
    // held, never applied
    assert.equal(out.pieces.px, local.px, "this device's copy untouched");
    assert.deepEqual(out.held.map((h) => h.id), ["px"]);
    assert.deepEqual(out.held[0].conflicts.map((c) => [c.part, c.kind]), [["recordings", "field"]]);
    assert.ok(out.held[0].conflicts[0].local && out.held[0].conflicts[0].remote && out.held[0].conflicts[0].base, "fingerprints kept for Pass 121");
    // left for the person, and a held piece waits for Review
    assert.equal(out.pieces.pn, local.pn);
    assert.deepEqual(out.needsYou.map((n) => [n.id, n.kind]), [["pn", "ask"]]);
    assert.equal(out.pieces.ph, local.ph);
    assert.equal(out.entries.ph, undefined);
    assert.deepEqual(out.deferred, []);
    assert.deepEqual([...out.names.added, ...out.names.took, ...out.names.merged].sort(), ["Piece pb", "Piece pc", "Piece pf"]);
  });

  test("a combine (the same piece under another id) is never applied by itself", () => {
    const renamed = pieceOf("other-id", { name: "Piece pc" }); // the account's copy of 'Piece pc' under a different id
    const out = runAuto({ local: { pc: clean }, rows: [[renamed, 4]], record: autoRec({ pc: syncedAs(clean) }) });
    assert.deepEqual(out.needsYou.map((n) => [n.id, n.kind]), [["other-id", "combine"]]);
    assert.deepEqual(out.pieces, { pc: clean });
    assert.deepEqual(out.markDeleted, []);
  });

  test("a piece in use waits: nothing about it is changed or recorded, and it applies when it is free", () => {
    const busy = runAuto({ local, rows: account, record, busyIds: ["pc", "pb"] });
    assert.deepEqual(busy.deferred.map((d) => d.id).sort(), ["pb", "pc"]);
    assert.equal(busy.pieces.pc, local.pc);
    assert.equal(busy.pieces.pb, local.pb);
    assert.equal(busy.entries.pc, undefined, "not recorded, so the next run finds it again");
    assert.equal(busy.entries.pb, undefined);
    assert.ok(busy.entries.pf && busy.entries.ps, "pieces not in use go ahead");
    assert.equal(busy.names.took.length + busy.names.merged.length, 0);
    const free = runAuto({ local: busy.pieces, rows: account, record });
    assert.deepEqual(free.deferred, []);
    assert.deepEqual(free.pieces.pc, { ...account[0][0] });
    assert.ok(free.pieces.pb.progress.c5 && free.pieces.pb.progress.c9);
    assert.ok(free.entries.pc && free.entries.pb);
  });

  test("a new piece is never in use, so it is never deferred", () => {
    const out = runAuto({ local: {}, rows: [[fresh, 1]], record: autoRec({}), busyIds: ["pf"] });
    assert.deepEqual(out.deferred, []);
    assert.ok(out.pieces.pf);
    assert.equal(out.becomesChecked, true);
  });
});

describe("the technique library in an automatic update (Pass 120)", () => {
  const item = (id, extra = {}) => ({ id, form: "scale", tonic: "C", quality: "major", octaves: 2, ...extra });
  const lib = (items, extra = {}) => validateAndMigrateTechnique({ schemaVersion: 1, items: items.map((i) => normalizeTechniqueItem(i)), updatedAt: 5, ...extra });
  const L0 = lib([item("a")]);
  const tEntry = (t, revision = 1) => ({ revision, fingerprint: techniqueFingerprint(t), parts: techniquePartFingerprints(t) });
  const apply = (localT, accountT, entry, extra = {}) =>
    runAuto({ local: {}, rows: [], record: autoRec({}, { technique: entry }), localTechnique: localT, techniqueRow: { revision: 2, data: reorder(viaJson(accountT)) }, ...extra });

  test("with a recorded base the engine merges both sides' changes", () => {
    const mine = lib([item("a", { starred: true })]);
    const theirs = lib([item("a"), item("b", { tonic: "G" })]);
    const out = apply(mine, theirs, tEntry(L0));
    assert.equal(out.technique.changed, true);
    const ids = out.technique.value.items.map((i) => i.id).sort();
    assert.deepEqual(ids, ["a", "b"]);
    assert.equal(out.technique.value.items.find((i) => i.id === "a").starred, true, "this device's own change is kept");
    assert.equal(out.technique.entry.revision, 2);
  });

  test("with no base, the import merge that never asks and never removes anything", () => {
    const out = apply(L0, lib([item("a"), item("b", { tonic: "G" })]), { revision: 1, fingerprint: techniqueFingerprint(L0) });
    assert.deepEqual(out.technique.value.items.map((i) => i.id).sort(), ["a", "b"]);
  });

  test("a library that is already the same is only recorded, not rewritten", () => {
    const out = apply(L0, lib([item("a")]), tEntry(L0));
    assert.equal(out.technique.changed, false);
    assert.equal(out.technique.entry.revision, 2);
    assert.equal(mergeTechniqueFromAccount(L0, lib([item("a")]), techniquePartFingerprints(L0)), L0, "the same object back");
  });

  test("a library held for Review is left for Review, and includeTechnique false leaves it alone", () => {
    const theirs = lib([item("a"), item("b", { tonic: "G" })]);
    assert.equal(apply(L0, theirs, { ...tEntry(L0), held: true }).technique, null);
    assert.equal(apply(L0, theirs, tEntry(L0), { includeTechnique: false }).technique, null);
  });

  // Pass 118 open item 5 (owner: Pass 120). The engine calls two libraries "identical" when
  // their PARTS match, and a method switched on and off again leaves an entry that holds the
  // defaults: no part, but a different whole-library fingerprint. If the record then keeps the
  // ACCOUNT's fingerprint, this device's own library reads as a change waiting, it uploads, the
  // other device does exactly the same, and the two trade the library back and forth (found in
  // the Pass 120 review: revision 2 to 10 in eight rounds, nothing ever changing).
  const switchedOnAndOff = (t) => validateAndMigrateTechnique(viaJson({ ...t, methodState: { ...t.methodState, eyes: { starred: false, enabled: true } } }));
  // What this device would send after the update: the record as the apply leaves it, read the way
  // an upload run reads it.
  const waitingAfter = (localT, out, entry) => {
    const before = { version: 1, accounts: { [USER]: autoRec({}, { technique: entry }) } };
    const after = withAccountCopyRecorded(before, USER, { entries: out.entries, technique: out.technique.entry, checkedAt: null });
    return computeWaiting({ pieces: {}, technique: out.technique.changed ? out.technique.value : localT, accountRecord: accountRecordFor(after, USER) });
  };

  test("identical by parts but a different fingerprint is IN SYNC: nothing waits to be sent, in either direction [regression, Pass 118 open item 5]", () => {
    const plain = lib([item("a")]);
    const toggled = switchedOnAndOff(plain);
    assert.notEqual(techniqueFingerprint(plain), techniqueFingerprint(toggled), "the premise: only the whole-library fingerprint tells them apart");
    assert.deepEqual(techniquePartFingerprints(plain), techniquePartFingerprints(toggled), "...and no part does");
    // this device holds the plain one, the account now holds the other
    const a = apply(plain, toggled, tEntry(plain));
    assert.equal(a.technique.changed, false, "nothing to bring in");
    assert.equal(a.technique.entry.revision, 2, "the account's revision is recorded");
    assert.equal(waitingAfter(plain, a, tEntry(plain)).count, 0, "and nothing is sent back");
    // and the other way round, which is the second half of the loop
    const b = apply(toggled, plain, tEntry(toggled));
    assert.equal(b.technique.changed, false);
    assert.equal(waitingAfter(toggled, b, tEntry(toggled)).count, 0);
  });

  test("two devices that differ only that way never trade uploads: eight rounds, the account's revision stays put [regression, Pass 118 open item 5]", () => {
    const plain = lib([item("a")]);
    const toggled = switchedOnAndOff(plain);
    const printed = (t, revision) => ({ revision, fingerprint: techniqueFingerprint(t), parts: techniquePartFingerprints(t) });
    // the account holds A's library at revision 2; B last synced `plain` at revision 1
    const account = { revision: 2, lib: toggled };
    const devices = { A: { lib: toggled, entry: printed(toggled, 2) }, B: { lib: plain, entry: printed(plain, 1) } };
    const uploads = [];
    ["B", "A", "B", "A", "B", "A", "B", "A"].forEach((who) => {
      const d = devices[who];
      // a check finds the account ahead: bring it in (automatic), as runAutoUpdate does
      if (d.entry.revision < account.revision) {
        const out = runAuto({ local: {}, rows: [], record: autoRec({}, { technique: d.entry }), localTechnique: d.lib, techniqueRow: { revision: account.revision, data: reorder(viaJson(account.lib)) } });
        const before = { version: 1, accounts: { [USER]: autoRec({}, { technique: d.entry }) } };
        d.entry = accountRecordFor(withAccountCopyRecorded(before, USER, { entries: out.entries, technique: out.technique.entry, checkedAt: null }), USER).technique;
        if (out.technique.changed) d.lib = out.technique.value;
      }
      // then whatever is waiting goes up, "only if still at the revision this device knows"
      if (computeWaiting({ pieces: {}, technique: d.lib, accountRecord: autoRec({}, { technique: d.entry }) }).count > 0) {
        account.revision += 1;
        account.lib = d.lib;
        d.entry = printed(d.lib, account.revision);
        uploads.push(who);
      }
    });
    assert.deepEqual(uploads, [], "nobody sends anything");
    assert.equal(account.revision, 2);
  });

  test("a real change this device made is still sent, even when the account's library also differs by that kind of entry", () => {
    const plain = lib([item("a")]);
    const starred = lib([item("a", { starred: true })]);
    const out = apply(starred, switchedOnAndOff(plain), tEntry(plain));
    assert.equal(waitingAfter(starred, out, tEntry(plain)).count, 1, "the starred scale is the account's to receive");
  });
});

describe("merge before upload (Pass 120)", () => {
  const tech = viaJson(technique);
  const base = pieceOf("p1");
  const mine = logOn(base, "c5", 3); // logged here, not uploaded yet
  const theirs = logOn(base, "c9", 4); // logged on another device, uploaded: the account is at revision 2

  const setup = () => {
    const storage = memoryStorage();
    saveDeviceRecord(
      { version: 1, accounts: { [USER]: { pieces: { p1: syncedAs(base) }, technique: { revision: 1, fingerprint: techniqueFingerprint(tech) }, checkedAt: 1000, syncedAt: null } } },
      storage
    );
    const fake = syncFake({ pieceRows: [pieceRow(theirs, { user_id: USER, revision: 2 })], techniqueRows: [{ user_id: USER, data: reorder(viaJson(tech)), revision: 1 }] });
    const rec = recordOf(storage);
    const changes = classifyAccountChanges({ rows: { pieces: [{ id: "p1", revision: 2, deleted_at: null }], technique: { revision: 1 } }, accountRecord: rec, localPieceIds: ["p1"] });
    return { storage, fake, rec, changes };
  };

  // What runSync does with the switch on: merge first (when the last check says it must), then upload.
  const uploadMergingFirst = async ({ storage, fake, rec, changes }) => {
    let pieces = { p1: mine };
    const first = needsMergeBeforeUpload({ pieces, technique: tech, accountRecord: rec, changes });
    if (first.pieceIds.length > 0) {
      const candidates = accountRowsToCandidates({ pieces: [acctRow(theirs, 2)], technique: null });
      const out = applyAccountMerge({ candidates, localPieces: pieces, localTechnique: tech, accountRecord: rec, automatic: true, includeTechnique: false });
      saveDeviceRecord(withAccountCopyRecorded(readDeviceRecord(storage), USER, { entries: out.entries }), storage);
      pieces = out.pieces;
    }
    return { pieces, result: await runSync(pieces, tech, fake, storage) };
  };

  test("which waiting pieces must be merged first: a change here plus a newer copy in the account", () => {
    const { rec, changes } = setup();
    assert.deepEqual(needsMergeBeforeUpload({ pieces: { p1: mine }, technique: tech, accountRecord: rec, changes }), { pieceIds: ["p1"], technique: false });
    // nothing waiting here: a plain newer copy is taken by the update, not merged before an upload that isn't happening
    assert.deepEqual(needsMergeBeforeUpload({ pieces: { p1: base }, technique: tech, accountRecord: rec, changes }), { pieceIds: [], technique: false });
    assert.deepEqual(needsMergeBeforeUpload({ pieces: { p1: mine }, technique: tech, accountRecord: rec, changes: null }), { pieceIds: [], technique: false });
  });

  test("merged first, the piece goes up ONCE, at the account's revision, with both sides' sessions, and is never held", async () => {
    const env = setup();
    const { pieces, result } = await uploadMergingFirst(env);
    assert.equal(result.status, "done");
    assert.equal(result.uploaded, 1);
    assert.deepEqual(result.newlyHeld, []);
    const writes = env.fake.writes();
    assert.equal(writes.length, 1, "one upload");
    assert.deepEqual(writes[0].filters.filter(([c]) => c === "revision"), [["revision", 2]], "only if still at the account's revision");
    const row = env.fake.rows.pieces.find((r) => r.id === "p1");
    assert.equal(row.revision, 3);
    assert.deepEqual(durations(row.data), durations(logOn(logOn(base, "c5", 3), "c9", 4)));
    const rec = recordOf(env.storage);
    assert.equal(rec.pieces.p1.held, undefined);
    assert.equal(rec.pieces.p1.revision, 3);
    assert.equal(computeWaiting({ pieces, technique: tech, accountRecord: rec }).count, 0);
  });

  test("uploaded WITHOUT merging first, the same piece is refused and held (the order is the point)", async () => {
    const env = setup();
    const result = await runSync({ p1: mine }, tech, env.fake, env.storage);
    assert.equal(result.uploaded, 0);
    assert.equal(result.newlyHeld.length, 1);
    assert.equal(recordOf(env.storage).pieces.p1.held, true);
  });

  test("a piece with a conflicting part is held, never uploaded over, and its conflicts are listed", async () => {
    const env = setup();
    const clashHere = withRecording(base, 2);
    const clashThere = withRecording(base, 3);
    const rows = [pieceRow(clashThere, { user_id: USER, revision: 2 })];
    env.fake.rows.pieces.splice(0, 1, ...rows);
    const candidates = accountRowsToCandidates({ pieces: [acctRow(clashThere, 2)], technique: null });
    const out = applyAccountMerge({ candidates, localPieces: { p1: clashHere }, localTechnique: tech, accountRecord: env.rec, automatic: true, includeTechnique: false });
    assert.deepEqual(out.held.map((h) => h.id), ["p1"]);
    assert.equal(out.pieces.p1, clashHere);
    saveDeviceRecord(out.held.reduce((r, h) => withPieceHeld(r, USER, h.id, h.conflicts), readDeviceRecord(env.storage)), env.storage);
    const e = recordOf(env.storage).pieces.p1;
    assert.equal(e.held, true);
    assert.deepEqual(e.conflicts.map((c) => c.part), ["recordings"]);
    const r = await runSync({ p1: clashHere }, tech, env.fake, env.storage);
    assert.equal(r.uploaded, 0, "a held piece is not uploaded");
    assert.equal(env.fake.writes().length, 0);
  });
});

describe("an upload run sends only after a fresh look (Pass 126 follow-up, the reconnect hold)", () => {
  // The look an upload run takes first, as App.jsx's requestCheck reports it.
  const fresh = { fresh: true, applied: false, why: null };
  const waitsShortly = { action: "wait", afterMs: BEFORE_UPLOAD_RETRY_MS };

  test("a fresh look: send. A look that also brought something in: stop, the merged result goes up in the next run", () => {
    assert.deepEqual(uploadAfterLook(fresh), { action: "send" });
    assert.deepEqual(uploadAfterLook({ fresh: true, applied: true, why: null }), { action: "stop" });
  });

  test("[regression, Pass 126 follow-up] no look is never 'send': a missing, declined, unbelieved or busy look waits and looks again", () => {
    // The bug: the browser's "online" event started a look and a run at the same moment, the
    // run's own look was declined ("running"), and the run went on from an old picture of the
    // account. The account refused the upload and the piece was held although the two copies
    // would have merged. A phone check found it on 2026-10-30; a two-device rig reproduced it.
    assert.deepEqual(uploadAfterLook(undefined), waitsShortly, "a caller that got nothing back");
    assert.deepEqual(uploadAfterLook(null), waitsShortly);
    assert.deepEqual(uploadAfterLook({}), waitsShortly);
    ["running", "too-soon", "unusable", "busy", "hidden"].forEach((why) => {
      assert.deepEqual(uploadAfterLook({ fresh: false, applied: false, why }), waitsShortly, why);
    });
  });

  test("a look the service didn't answer waits for the usual retry gap, not two seconds", () => {
    assert.deepEqual(uploadAfterLook({ fresh: false, applied: false, why: "failed" }), { action: "wait", afterFailure: true });
  });

  test("nothing to do here (another tab does the account work, not signed in, no checked backup yet): stop", () => {
    ["not-ready", "no-lease", "no-backup", "cancelled"].forEach((why) => {
      assert.deepEqual(uploadAfterLook({ fresh: false, applied: false, why }), { action: "stop" }, why);
    });
  });

  test("the short wait is shorter than the first failure gap and than a person's patience", () => {
    assert.ok(BEFORE_UPLOAD_RETRY_MS > 0 && BEFORE_UPLOAD_RETRY_MS < RETRY_GAPS_MS[0]);
    assert.ok(BEFORE_UPLOAD_RETRY_MS <= 5000);
  });
});

describe("pieces that must wait are skipped by the upload, the rest go up (Pass 120)", () => {
  const tech = viaJson(technique);
  test("a skipped piece is left waiting (not sent, not refused, not held); another piece with a change still goes up", async () => {
    const storage = memoryStorage();
    const a = pieceOf("a");
    const b = pieceOf("b");
    afterFirstBackup({ a, b }, tech, storage);
    const fake = syncFake({ pieceRows: [pieceRow(a, { user_id: USER, revision: 1 }), pieceRow(b, { user_id: USER, revision: 1 })], techniqueRows: [{ user_id: USER, data: reorder(viaJson(tech)), revision: 1 }] });
    const changed = { a: logOn(a, "c5", 3), b: logOn(b, "c5", 3) };
    const r = await runSync(changed, tech, fake, storage, { skipPieceIds: ["a"] });
    assert.equal(r.uploaded, 1);
    assert.deepEqual(r.newlyHeld, []);
    assert.deepEqual(fake.writes().map((w) => w.id), ["b"]);
    assert.equal(r.remaining, 0, "what was skipped is not counted as remaining work for this run");
    assert.equal(computeWaiting({ pieces: changed, technique: tech, accountRecord: recordOf(storage) }).items.some((i) => i.id === "a"), true, "still waiting for a later run");
  });

  test("nothing skipped means exactly the old behavior", async () => {
    const storage = memoryStorage();
    const a = pieceOf("a");
    afterFirstBackup({ a }, tech, storage);
    const fake = syncFake({ pieceRows: [pieceRow(a, { user_id: USER, revision: 1 })], techniqueRows: [{ user_id: USER, data: reorder(viaJson(tech)), revision: 1 }] });
    const r = await runSync({ a: logOn(a, "c5", 3) }, tech, fake, storage);
    assert.equal(r.uploaded, 1);
  });
});

describe("a plan that went stale is redone against what is there now (Pass 120)", () => {
  const base = pieceOf("p1");
  const theirs = logOn(base, "c9", 4);
  test("a newer change made meanwhile is kept and the account's change merged in", () => {
    const meanwhile = logOn(base, "c5", 3);
    const out = reapplyOnto({ current: meanwhile, accountPiece: theirs, baseParts: piecePartFingerprints(base) });
    assert.equal(out.held, null);
    assert.ok(out.piece.progress.c5 && out.piece.progress.c9);
  });
  test("a clash, or no recorded base, leaves the current copy alone and says it must be held", () => {
    const current = withRecording(base, 2);
    const clash = reapplyOnto({ current, accountPiece: withRecording(base, 3), baseParts: piecePartFingerprints(base) });
    assert.equal(clash.piece, current);
    assert.deepEqual(clash.held.map((c) => c.part), ["recordings"]);
    const noBase = reapplyOnto({ current, accountPiece: theirs, baseParts: null });
    assert.equal(noBase.piece, current);
    assert.ok(noBase.held.length > 0);
  });
  test("nothing of the account's changes anything here: the current copy stays", () => {
    const current = logOn(base, "c9", 4);
    const out = reapplyOnto({ current, accountPiece: theirs, baseParts: piecePartFingerprints(base) });
    assert.equal(out.held, null);
    assert.equal(out.piece, current);
  });
});

describe("fetching only what changed (Pass 120)", () => {
  const many = Array.from({ length: 120 }, (_, i) => pieceOf(`p${String(i).padStart(3, "0")}`));
  const rows = many.map((p) => pieceRow(p, { user_id: USER, revision: 1 }));

  test("only the named pieces are read, in pages of ids, and the technique row only when asked", async () => {
    const fake = syncFake({ pieceRows: rows, techniqueRows: [{ user_id: USER, data: reorder(viaJson(technique)), revision: 4 }] });
    const ids = ["p003", "p077"];
    const got = await fetchChangedAccountRows({ userId: USER, ids, getClient: async () => fake.client });
    assert.equal(got.status, "ok");
    assert.deepEqual(got.rows.pieces.map((r) => r.id).sort(), ids);
    assert.ok(got.rows.pieces.every((r) => r.data), "with their data");
    assert.equal(got.rows.technique, null);
    assert.deepEqual(fake.selects().map((c) => c.table), ["pieces"], "no technique read, no other piece read");
    assert.deepEqual(fake.selects()[0].ins, [["id", ids]]);
    const withT = await fetchChangedAccountRows({ userId: USER, ids: [], technique: true, getClient: async () => fake.client });
    assert.equal(withT.rows.technique.revision, 4);
    assert.deepEqual(withT.rows.pieces, []);
  });

  test("a long list of ids is asked for a page at a time, never every row", async () => {
    const fake = syncFake({ pieceRows: rows });
    const ids = many.slice(0, 101).map((p) => p.id);
    const got = await fetchChangedAccountRows({ userId: USER, ids, getClient: async () => fake.client });
    assert.equal(got.rows.pieces.length, 101);
    assert.deepEqual(fake.selects().map((c) => c.ins[0][1].length), [50, 50, 1]);
  });

  test("a signed-out or other account, a refusal and no connection are reported, not thrown", async () => {
    const fake = syncFake({ pieceRows: rows });
    const other = { ...fake.client, auth: { getSession: async () => ({ data: { session: { user: { id: "someone-else" } } }, error: null }) } };
    assert.deepEqual(await fetchChangedAccountRows({ userId: USER, ids: ["p001"], getClient: async () => other }), { status: "stopped", reason: "signed-out" });
    assert.deepEqual(await fetchChangedAccountRows({ userId: USER, ids: ["p001"], getClient: async () => null }), { status: "stopped", reason: "connection" });
    const failing = syncFake({ pieceRows: rows, inject: (call) => (call.op === "select" ? { data: null, error: { message: "boom", code: "42501" }, status: 403 } : null) });
    assert.deepEqual(await fetchChangedAccountRows({ userId: USER, ids: ["p001"], getClient: async () => failing.client }), { status: "stopped", reason: "other" });
    const down = syncFake({ pieceRows: rows, inject: (call) => (call.op === "select" ? noConnection() : null) });
    assert.deepEqual(await fetchChangedAccountRows({ userId: USER, ids: ["p001"], getClient: async () => down.client }), { status: "stopped", reason: "connection" });
  });
});

describe("what the person is told (Pass 120)", () => {
  test("the Account panel line", () => {
    assert.equal(describeAutoUpdate({ names: ["Ballade No. 1"], technique: true }), "Updated from another device: Ballade No. 1, and the technique library.");
    assert.equal(describeAutoUpdate({ names: ["Ballade No. 1"] }), "Updated from another device: Ballade No. 1.");
    assert.equal(describeAutoUpdate({ names: ["A", "B"] }), "Updated from another device: A and B.");
    assert.equal(describeAutoUpdate({ names: ["A", "B", "C", "D", "E"] }), "Updated from another device: A, B, C and 2 more.");
    assert.equal(describeAutoUpdate({ technique: true }), "Updated from another device: the technique library.");
    assert.equal(describeAutoUpdate({ names: ["A", "A"] }), "Updated from another device: A.");
    assert.equal(describeAutoUpdate({}), null, "nothing changed, nothing said");
  });

  test("the line while a change waits, and the quiet line on the open piece", () => {
    assert.equal(describeAutoPending(["Ballade No. 1"]), "Changes to Ballade No. 1 will be applied when you're done with it.");
    assert.equal(describeAutoPending(["A", "B"]), "Changes to A and B will be applied when you're done with them.");
    assert.equal(describeAutoPending([]), null);
    assert.equal(PIECE_UPDATED_NOTE, "This piece was updated from another device.");
  });
});

describe("the check runs every minute, and the page asks often enough (Pass 120)", () => {
  const clock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
  };
  // A page that asks "is a check due?" on its own timer, the way App.jsx does: every CHECK_TICK_MS.
  const countChecks = async ({ visible, minutes, driftMs = 0 }) => {
    const fake = syncFake(accountHolding(three(), technique));
    const c = clock();
    const checker = createAccountChecker({ getClient: async () => fake.client, now: c.now });
    await checker.run({ trigger: "startup", userId: USER, visible });
    const startedAt = [];
    for (let elapsed = 0; elapsed < minutes * 60 * 1000; elapsed += CHECK_TICK_MS + driftMs) {
      c.advance(CHECK_TICK_MS + driftMs);
      const out = await checker.run({ trigger: "interval", userId: USER, visible });
      if (out.ran) startedAt.push(c.now());
    }
    return { count: fake.selects().filter((x) => x.table === "pieces").length, startedAt };
  };

  test("an interval check is due after one minute, not five", () => {
    assert.equal(checkIsDue({ trigger: "interval", now: 60 * 1000, lastStartedAt: 0 }), true);
    assert.equal(checkIsDue({ trigger: "interval", now: 60 * 1000 - 1, lastStartedAt: 0 }), false);
    assert.equal(checkIsDue({ trigger: "interval", now: 5 * 60 * 1000 - 1, lastStartedAt: 0 }), true, "no longer waits five");
  });

  test("the page asks at least four times a minute", () => {
    assert.equal(CHECK_TICK_MS, 15 * 1000);
    assert.ok(CHECK_TICK_MS * 4 <= CHECK_EVERY_MS);
  });

  test("a visible page makes about one check a minute, evenly spaced, even with timer drift", async () => {
    for (const driftMs of [0, 400, 1500]) {
      const { count, startedAt } = await countChecks({ visible: true, minutes: 10, driftMs });
      assert.ok(count >= 1 + 9 && count <= 1 + 10, `drift ${driftMs}: ${count} checks in ten minutes plus the startup one`);
      startedAt.slice(1).forEach((t, i) => {
        const gap = t - startedAt[i];
        assert.ok(gap >= 60 * 1000 && gap < 60 * 1000 + CHECK_TICK_MS + driftMs + 1, `drift ${driftMs}: gap ${gap} ms`);
      });
    }
  });

  test("a page that is hidden makes none", async () => {
    const { count } = await countChecks({ visible: false, minutes: 10 });
    assert.equal(count, 0);
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 121: a held piece asks one plain question per conflicting     */
/*  part, and the answers are applied through the one apply step.      */
/* ------------------------------------------------------------------ */

describe("settling a held piece, one question at a time (Pass 121)", () => {
  const NOW = Date.parse("2026-10-19T12:00:00Z");
  const DASH = "\u2013"; // formatRange's en dash: "mm. 1\u20134"
  const base = pieceOf("p1", { targetDate: "2026-10-20" });
  const edited = (p, patch) => validateAndMigratePiece({ ...viaJson(p), ...patch, updatedAt: (p.updatedAt || 0) + 1000 });
  // The same chunk practiced differently on both devices (Pass 126: combined, never asked), and what IS
  // still asked: the target date, changed on both at the same moment so that "the more recent change
  // wins" cannot tell, and the list of recordings, a collection.
  const mine = edited(withRecording(withMore(base, 2), 2), { targetDate: "2026-11-01" });
  const theirs = edited(withRecording(withMore(base, 3), 3), {
    targetDate: "2026-11-15",
    recordings: [
      { id: "r3", label: "Take 3", url: "https://example.test/3" },
      { id: "r4", label: "Take 4", url: "https://example.test/4" },
    ],
  });
  const legacyPlan = (local = mine, remote = theirs) => planPieceMerge({ ...LEGACY, local, remote, base: accountRecordFor(heldDevice(), USER).pieces.p1.parts });
  const tech = viaJson(technique);

  // The device record as Pass 120 leaves it for a piece it held: synced at revision 1, held,
  // with the conflicting parts listed (fingerprints only).
  const heldDevice = (local = mine, remote = theirs) => {
    const device = { version: 1, accounts: { [USER]: autoRec({ p1: syncedAs(base, 1) }) } };
    const out = runAuto({ local: { p1: local }, rows: [[remote, 2]], record: accountRecordFor(device, USER) });
    return out.held.reduce((r, h) => withPieceHeld(r, USER, h.id, h.conflicts), device);
  };
  const candidatesOf = (remote = theirs, revision = 2) => accountRowsToCandidates({ pieces: [acctRow(remote, revision)], technique: null });
  const planFor = (over = {}) =>
    planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: accountRecordFor(heldDevice(), USER), now: NOW, ...over });
  const apply = (answers, { local = mine, remote = theirs, device = heldDevice() } = {}) =>
    applyAccountMerge({
      candidates: candidatesOf(remote),
      localPieces: { p1: local },
      localTechnique: tech,
      accountRecord: accountRecordFor(device, USER),
      selectedIds: ["p1"],
      includeTechnique: false,
      settle: { p1: answers },
    });

  test("reading a held piece's conflicts: the list Pass 120 recorded, for a held piece only", () => {
    const rec = accountRecordFor(heldDevice(), USER);
    assert.deepEqual(heldConflicts(rec, "p1").map((c) => c.part), ["recordings", "targetDate"]);
    assert.deepEqual(heldConflicts(rec, "nope"), []);
    assert.deepEqual(heldIdsWithConflicts(rec), ["p1"]);
    // held by a refused upload: no list, so it is not one of these (it keeps the whole-piece picker)
    const alsoRefused = withPieceHeld(heldDevice(), USER, "p2");
    assert.equal(accountRecordFor(alsoRefused, USER).pieces.p2.held, true);
    assert.deepEqual(heldIdsWithConflicts(accountRecordFor(alsoRefused, USER)), ["p1"]);
    // a hold that was cleared took its list with it
    const cleared = withAccountCopyRecorded(heldDevice(), USER, { entries: { p1: syncedAs(theirs, 2) } });
    assert.deepEqual(heldIdsWithConflicts(accountRecordFor(cleared, USER)), []);
  });

  test("EVERY conflict becomes exactly one question, in a steady order (by the name the person reads); practice is never one of them", () => {
    const rec = accountRecordFor(heldDevice(), USER);
    const plan = planFor();
    assert.deepEqual(plan.fallbackIds, []);
    assert.equal(plan.items.length, 1);
    const item = plan.items[0];
    assert.equal(item.status, "questions");
    const live = planPieceMerge({ local: mine, remote: theirs, base: rec.pieces.p1.parts }).conflicts.map((c) => c.part).sort();
    const recorded = heldConflicts(rec, "p1").map((c) => c.part).sort();
    assert.deepEqual(item.questions.map((q) => q.part).sort(), live, "one per conflict the engine finds today");
    assert.deepEqual(item.questions.map((q) => q.part).sort(), recorded, "and the same ones that were recorded when it was held");
    assert.equal(new Set(item.questions.map((q) => q.part)).size, item.questions.length, "none twice");
    assert.deepEqual(item.questions.map((q) => q.part), ["recordings", "targetDate"]);
    assert.equal(item.questions.some((q) => q.kind === "progress"), false, "both devices practiced the chunk, and nobody is asked");
  });

  test("the proposed wording, word for word: any other part, and (kept for the old rule) a chunk's practice record", () => {
    const [recordingsQ, dateQ] = planFor().items[0].questions;
    assert.equal(dateQ.text, "Target date: Nov 1 on this device, Nov 15 on your other device.");
    assert.equal(recordingsQ.text, "Recordings: 1 recording on this device, 2 recordings on your other device.");
    [recordingsQ, dateQ].forEach((q) => {
      assert.deepEqual(q.options.map((o) => [o.value, o.label]), [["local", "This device's"], ["remote", "The other device's"]]);
      assert.equal(/\u2014/.test(JSON.stringify(q)), false, "no em dash in anything the person reads");
    });
    // Since Pass 126 no real piece reaches the practice question (the engine combines a record both
    // devices changed), but the wording is kept and checked on the engine's old plan.
    const chunkQ = buildSettleQuestions({ plan: legacyPlan(), piece: mine }).find((q) => q.part === "progress:c1");
    assert.equal(chunkQ.text, `You practiced mm. 1${DASH}4 on both devices since you last synced.`);
    assert.deepEqual(chunkQ.options.map((o) => [o.value, o.label]), [["both", "Both devices' sessions"], ["local", "This device's"], ["remote", "The other device's"]]);
    assert.equal(chunkQ.options[0].recommended, true, "'both' is the recommended one");
    assert.equal(chunkQ.options.filter((o) => o.recommended).length, 1);
    assert.equal(/\u2014/.test(JSON.stringify(chunkQ)), false);
  });

  test("dates carry the year only when it isn't this year; long values get a line each", () => {
    const farther = edited(base, { targetDate: "2027-01-05", notes: "x".repeat(70) });
    const differently = edited(base, { targetDate: "2026-11-01", notes: "y".repeat(70) });
    const device = heldDevice(differently, farther);
    const q = planSettle({ candidates: candidatesOf(farther), localPieces: { p1: differently }, accountRecord: accountRecordFor(device, USER), now: NOW }).items[0].questions;
    assert.equal(q.find((x) => x.part === "targetDate").text, "Target date: Nov 1 on this device, Jan 5, 2027 on your other device.");
    const notes = q.find((x) => x.part === "notes").text.split("\n");
    assert.equal(notes.length, 3, "a heading line, then one line per device");
    assert.match(notes[0], /^Notes is different on the two devices\.$/);
    assert.match(notes[1], /^This device: "y+\.\.\."$/, "a long value is cut short with dots, never the whole paragraph");
    assert.match(notes[2], /^Your other device: "x+\.\.\."$/);
    assert.ok(notes[1].length < 80);
  });

  test("a field nobody wrote a label for still reads as a sentence; practice keys and chunk kinds are named", () => {
    const pure = buildSettleQuestions({
      plan: { status: "conflicts", conflicts: [{ part: "fooBarBaz", kind: "field", field: "fooBarBaz", local: 1, remote: 2 }] },
      piece: mine,
      year: 2026,
    });
    assert.equal(pure[0].text, "Foo bar baz: 1 on this device, 2 on your other device.");
    // each side has sessions the other lacks, which is what 'since you last synced' means here
    const entry = (n, start) => ({ doneDays: [1], sessions: Array.from({ length: n }, (_, i) => ({ day: 1, loggedAt: start + i, bpm: 60 + i })) });
    const nameOf = (id, local, remote) =>
      buildSettleQuestions({ plan: { status: "conflicts", conflicts: [{ part: `progress:${id}`, kind: "progress", id, local, remote }] }, piece: mine, year: 2026 })[0];
    assert.equal(nameOf("__consolidation__", entry(2, 10), entry(3, 100)).text, "You practiced the full run-through on both devices since you last synced.");
    assert.equal(nameOf("__cold_start__", entry(2, 10), entry(3, 100)).title, "Practice record: the cold-start check");
    assert.equal(nameOf("sr_s1", entry(2, 10), entry(3, 100)).title, "Practice record: the run-through of A", "a section by its name");
    const transition = generateAllChunks(mine).all.find((c) => c.kind === "transition");
    assert.match(nameOf(transition.id, entry(2, 10), entry(3, 100)).title, /^Practice record: the transition at mm\. /);
    assert.equal(nameOf("c999", entry(2, 10), entry(3, 100)).title, "Practice record: a chunk that is no longer in the plan");
  });

  test("numbers worked out from a conflicting target date are not a question of their own: the date's question says they follow it, and the answer settles all three", () => {
    const here = edited(base, { targetDate: "2026-11-01", daysToLearn: 16, minutesPerDay: 20 });
    const there = edited(base, { targetDate: "2026-11-15", minutesPerDay: 10 });
    const device = heldDevice(here, there);
    assert.deepEqual(heldConflicts(accountRecordFor(device, USER), "p1").map((c) => c.part).sort(), ["minutesPerDay", "targetDate"], "the engine does report the minutes as a conflict");
    const plan = planSettle({ candidates: candidatesOf(there), localPieces: { p1: here }, accountRecord: accountRecordFor(device, USER), now: NOW });
    const questions = plan.items[0].questions;
    assert.deepEqual(questions.map((q) => q.part), ["targetDate"], "...but only the date is asked");
    assert.equal(questions[0].detail, "Days to learn and minutes per day follow the target date you keep.");
    const remote = apply({ targetDate: "remote" }, { local: here, remote: there, device });
    assert.deepEqual(remote.settledIds, ["p1"], "nothing is left open");
    assert.deepEqual([remote.pieces.p1.targetDate, remote.pieces.p1.daysToLearn, remote.pieces.p1.minutesPerDay], ["2026-11-15", 21, 10], "their date with THEIR days and minutes");
    const local = apply({ targetDate: "local" }, { local: here, remote: there, device });
    assert.deepEqual([local.pieces.p1.targetDate, local.pieces.p1.daysToLearn, local.pieces.p1.minutesPerDay], ["2026-11-01", 16, 20], "this device's date with this device's days and minutes");
    // a question builder handed the engine's plan directly asks the same
    const live = planPieceMerge({ local: here, remote: there, base: accountRecordFor(device, USER).pieces.p1.parts });
    assert.deepEqual(buildSettleQuestions({ plan: live, piece: here, year: 2026 }).map((q) => q.part), ["targetDate"]);
  });

  test("a number no date can hold does not break the question, and a real created date reads as a date", () => {
    const ask = (local, remote) =>
      buildSettleQuestions({ plan: { status: "conflicts", conflicts: [{ part: "createdAt", kind: "field", field: "createdAt", local, remote }] }, piece: mine, year: 2026 })[0].text;
    assert.equal(ask(Date.parse("2026-10-03T12:00:00Z"), 9e18), "Date added: Oct 3 on this device, not set on your other device.");
    assert.equal(ask(Date.parse("2026-10-03T12:00:00Z"), Date.parse("2026-10-05T12:00:00Z")), "Date added: Oct 3 on this device, Oct 5 on your other device.");
  });

  test("a list of three things that follow the date reads as a list; two values that read alike are said to differ in detail", () => {
    const q = buildSettleQuestions({
      plan: {
        status: "conflicts",
        conflicts: [{ part: "targetDate", kind: "field", field: "targetDate", local: "2026-11-01", remote: "2026-11-15" }],
        linkedToDate: ["daysToLearn", "minutesPerDay", "rescheduleMarker"],
      },
      piece: mine,
      year: 2026,
    })[0];
    assert.equal(q.detail, "Days to learn, minutes per day and reschedule follow the target date you keep.");
    const same = buildSettleQuestions({
      plan: { status: "conflicts", conflicts: [{ part: "rescheduleMarker", kind: "field", field: "rescheduleMarker", local: { asOfDay: 3, a: 1 }, remote: { asOfDay: 3, a: 2 } }] },
      piece: mine,
      year: 2026,
    })[0];
    assert.equal(same.text, "Reschedule: rescheduled on day 3 on both devices, but the two plans differ in detail.");
  });

  test("when only one side added sessions there is no 'both'; when one side removed the record, only the two", () => {
    const shared = { day: 1, loggedAt: 10, bpm: 60 };
    const one = { doneDays: [1], sessions: [shared, { day: 2, loggedAt: 20, bpm: 70 }] };
    const other = { doneDays: [1], sessions: [shared], flag: "rough" };
    const q = buildSettleQuestions({ plan: { status: "conflicts", conflicts: [{ part: "progress:c1", kind: "progress", id: "c1", local: one, remote: other }] }, piece: mine, year: 2026 })[0];
    assert.equal(q.text, `The practice record for mm. 1${DASH}4 was changed differently on the two devices.`);
    assert.equal(q.detail, "Sessions: 2 on this device, 1 on your other device.");
    assert.deepEqual(q.options.map((o) => o.value), ["local", "remote"]);
    const gone = buildSettleQuestions({ plan: { status: "conflicts", conflicts: [{ part: "progress:c1", kind: "progress", id: "c1", local: one, remote: undefined }] }, piece: mine, year: 2026 })[0];
    assert.equal(gone.text, `The practice record for mm. 1${DASH}4 is on this device, but your other device no longer has it.`);
    assert.deepEqual(gone.options.map((o) => o.value), ["local", "remote"]);
  });

  test("the whole-piece conflict is one question, with what each choice removes said plainly (and flagged, so the summary can repeat it)", () => {
    const grid = edited(base, { chunkMode: "custom", customChunkSize: 8 });
    const logged = withMore(base, 3);
    const device = heldDevice(grid, logged);
    assert.deepEqual(heldConflicts(accountRecordFor(device, USER), "p1").map((c) => [c.part, c.kind]), [[WHOLE_PIECE_PART, "whole-piece"]]);
    const plan = planSettle({ candidates: candidatesOf(logged), localPieces: { p1: grid }, accountRecord: accountRecordFor(device, USER), now: NOW });
    const q = plan.items[0].questions;
    assert.equal(q.length, 1);
    assert.equal(q[0].part, WHOLE_PIECE_PART);
    assert.deepEqual(q[0].options.map((o) => o.value), ["local", "remote"]);
    assert.equal(q[0].options[0].hint, "Practice and changes made on your other device will be removed, from your account too. This can't be undone.");
    assert.equal(q[0].options[1].hint, "Practice and changes made on this device will be removed. This can't be undone.");
    assert.deepEqual(q[0].options.map((o) => o.removes), [true, true]);
    // and an answer applies as the whole piece of that side
    const kept = apply({ [WHOLE_PIECE_PART]: "remote" }, { local: grid, remote: logged, device });
    assert.deepEqual(kept.settledIds, ["p1"]);
    assert.equal(kept.pieces.p1.customChunkSize, logged.customChunkSize);
  });

  test("nothing left to decide: 'ready', which still waits for the person to say go", () => {
    // the account has not moved since this device last synced: only this device's changes remain
    const plan = planSettle({ candidates: candidatesOf(base, 2), localPieces: { p1: mine }, accountRecord: accountRecordFor(heldDevice(), USER), now: NOW });
    assert.equal(plan.items[0].status, "ready");
    assert.deepEqual(plan.items[0].questions, []);
    assert.equal(plan.items[0].reason, "local-only");
  });

  test("a piece it can't ask about goes back to the whole-piece picker: no account row, a deleted row, no recorded base", () => {
    const rec = accountRecordFor(heldDevice(), USER);
    const none = planSettle({ candidates: accountRowsToCandidates({ pieces: [], technique: null }), localPieces: { p1: mine }, accountRecord: rec, now: NOW });
    assert.deepEqual([none.items.length, none.fallbackIds], [0, ["p1"]]);
    const deleted = planSettle({ candidates: accountRowsToCandidates({ pieces: [acctRow(theirs, 3, { deleted_at: "2026-10-18T00:00:00Z" })], technique: null }), localPieces: { p1: mine }, accountRecord: rec, now: NOW });
    assert.deepEqual([deleted.items.length, deleted.fallbackIds], [0, ["p1"]]);
    const noBase = { version: 1, accounts: { [USER]: autoRec({ p1: { revision: 1, fingerprint: pieceFingerprint(base), held: true, conflicts: [{ part: "name", kind: "field", local: "a", remote: "b", base: "c" }] } }) } };
    const asked = planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: accountRecordFor(noBase, USER), now: NOW });
    assert.deepEqual([asked.items.length, asked.fallbackIds], [0, ["p1"]], "the engine can't tell without a base");
  });

  test("a piece held with no list AND no recorded base (a first upload that was refused, an import) is not planned here at all, and the picker's rows can leave a settled one out", () => {
    // (Pass 122b: a refused upload that still knows what it last synced IS planned, below.)
    const device = withPieceHeld({ version: 1, accounts: { [USER]: autoRec({}) } }, USER, "p2");
    const plan = planSettle({ candidates: accountRowsToCandidates({ pieces: [acctRow(pieceOf("p2", { name: "Other" }), 2)], technique: null }), localPieces: { p2: pieceOf("p2") }, accountRecord: accountRecordFor(device, USER), now: NOW });
    assert.deepEqual([plan.items, plan.fallbackIds], [[], []]);
    const both = withPieceHeld(heldDevice(), USER, "p2");
    const all = accountRowsToCandidates({ pieces: [acctRow(theirs, 2), acctRow(pieceOf("p2"), 2)], technique: null });
    const recBoth = accountRecordFor(both, USER);
    assert.deepEqual(restrictCandidatesToHeld(all, recBoth).pieces.map((c) => c.id).sort(), ["p1", "p2"]);
    assert.deepEqual(restrictCandidatesToHeld(all, recBoth, ["p1"]).pieces.map((c) => c.id), ["p2"], "p1 had its questions, so the picker leaves it out");
  });

  test("planning changes nothing: not the record, not the pieces, not the rows it was handed", () => {
    const device = heldDevice();
    const rec = accountRecordFor(device, USER);
    const candidates = candidatesOf();
    const local = { p1: mine };
    const snapshot = JSON.stringify({ device, rec, candidates, local });
    const first = planSettle({ candidates, localPieces: local, accountRecord: rec, now: NOW });
    const second = planSettle({ candidates, localPieces: local, accountRecord: rec, now: NOW });
    assert.equal(JSON.stringify({ device, rec, candidates, local }), snapshot);
    assert.deepEqual(first, second);
    assert.equal(local.p1, mine);
  });

  test("practice is combined without a question, and the answers settle the rest: every session, the days added, this device's date and recordings, a one-time record", () => {
    const out = apply({ recordings: "local", targetDate: "local" });
    assert.deepEqual(out.settledIds, ["p1"]);
    assert.deepEqual(out.unsettled, []);
    assert.deepEqual(durations(out.pieces.p1), [90, 90, 120], "the base session and one from each device");
    assert.deepEqual(out.pieces.p1.progress.c1.doneDays, [1, 2, 3]);
    assert.equal(out.pieces.p1.targetDate, "2026-11-01");
    assert.deepEqual(out.pieces.p1.recordings.map((r) => r.id), ["r2"]);
    assert.deepEqual(out.entries.p1, { revision: 2, fingerprint: pieceFingerprint(theirs), parts: piecePartFingerprints(theirs) }, "the account's copy as read: what this device is now synced to");
  });

  test("'the other device's' for everything asked: their date and recordings; practice is combined, so this device's own session still has to go up", () => {
    const out = apply({ recordings: "remote", targetDate: "remote" });
    assert.equal(out.pieces.p1.targetDate, "2026-11-15");
    assert.deepEqual(out.pieces.p1.recordings, canonicalPiece(theirs).recordings);
    assert.deepEqual(durations(out.pieces.p1), [90, 90, 120], "every session from both devices");
    const rec = accountRecordFor(withAccountCopyRecorded(heldDevice(), USER, { entries: out.entries }), USER);
    assert.equal(computeWaiting({ pieces: out.pieces, technique: null, accountRecord: rec }).count, 1, "this device's session is not in the account's copy: an ordinary change");
  });

  test("'this device's' for everything asked: this device's date and recordings, which then go up as an ordinary change", () => {
    const out = apply({ recordings: "local", targetDate: "local" });
    assert.deepEqual(out.pieces.p1.recordings, canonicalPiece(mine).recordings);
    assert.equal(out.pieces.p1.targetDate, "2026-11-01");
    const rec = accountRecordFor(withAccountCopyRecorded(heldDevice(), USER, { entries: out.entries }), USER);
    assert.equal(computeWaiting({ pieces: out.pieces, technique: null, accountRecord: rec }).count, 1);
  });

  test("answering clears the hold and its list (the account's copy is recorded in their place)", () => {
    const out = apply({ recordings: "remote", targetDate: "remote" });
    const rec = accountRecordFor(withAccountCopyRecorded(heldDevice(), USER, { entries: out.entries }), USER);
    assert.equal(rec.pieces.p1.held, undefined);
    assert.equal(rec.pieces.p1.conflicts, undefined);
    assert.equal(rec.pieces.p1.revision, 2);
    assert.deepEqual(heldIdsWithConflicts(rec), []);
  });

  test("'Decide later' changes nothing: no answers, or only some, apply nothing and the record is exactly as it was", () => {
    [{}, { recordings: "local" }, { targetDate: "remote" }, { recordings: "yes", targetDate: "no" }].forEach((answers) => {
      const before = heldDevice();
      const out = apply(answers, { device: before });
      assert.deepEqual(out.settledIds, [], JSON.stringify(answers));
      assert.deepEqual(out.unsettled.map((u) => u.id), ["p1"]);
      assert.equal(out.pieces.p1, mine, "the very same piece object");
      assert.deepEqual(out.entries, {});
      const after = withAccountCopyRecorded(before, USER, { entries: out.entries });
      assert.deepEqual(accountRecordFor(after, USER), accountRecordFor(before, USER), "still held, the list still there");
    });
  });

  test("an answer for a conflict that has since gone is ignored, and a new conflict that appeared is NOT settled by a guess", () => {
    // while the person decided, this device changed the notes too and so did the other one
    const moved = edited(mine, { notes: "changed here meanwhile" });
    const remoteMoved = edited(theirs, { notes: "changed there meanwhile" });
    const out = apply({ recordings: "local", targetDate: "local" }, { local: moved, remote: remoteMoved });
    assert.deepEqual(out.settledIds, []);
    assert.deepEqual(out.unsettled.map((u) => u.status), ["conflicts"], "notes is a question nobody was asked");
    assert.deepEqual(out.unsettled.map((u) => u.reason), ["changed"], "said as 'it moved on', not as 'it is gone'");
    assert.equal(out.pieces.p1, moved);
  });

  test("the words: what was kept, and the result in the page", () => {
    const questions = planFor().items[0].questions;
    assert.equal(answeredAll(questions, {}), false);
    assert.equal(answeredAll(questions, { targetDate: "remote" }), false);
    assert.equal(answeredAll(questions, { targetDate: "both", recordings: "local" }), false, "'both' is not an option for a date");
    assert.equal(answeredAll(questions, { targetDate: "remote", recordings: "local" }), true);
    const answers = { targetDate: "remote", recordings: "local" };
    assert.deepEqual(describeKept(questions, answers), ["this device's recordings", "the other device's target date"]);
    assert.deepEqual(describeSettleResult({ settled: [{ name: "Etude", kept: describeKept(questions, answers) }] }).map((l) => l.text), [
      "Settled Etude: kept this device's recordings and the other device's target date.",
      "Anything here that your account doesn't have yet goes up by itself in a few seconds.",
    ]);
    assert.deepEqual(describeSettleResult({ settled: [{ name: "Etude", kept: [] }] })[0].text, "Etude is up to date with your other device.");
    const bad = describeSettleResult({ unsettled: [{ name: "Etude" }] });
    assert.equal(bad.length, 1);
    assert.equal(bad[0].problem, true);
    assert.match(bad[0].text, /^Etude changed again while you were deciding, so nothing was changed and it is still held\./);
  });

  test("an answer that removes sessions says so, with the number, and is flagged; keeping both removes none (the old plan: no real piece reaches this since Pass 126)", () => {
    const chunkQ = buildSettleQuestions({ plan: legacyPlan(), piece: mine }).find((q) => q.part === "progress:c1"); // one extra session on each device
    const opt = (q, v) => q.options.find((o) => o.value === v);
    assert.equal(opt(chunkQ, "local").hint, "The session logged on your other device will be removed, from your account too. This can't be undone.");
    assert.equal(opt(chunkQ, "remote").hint, "The session logged on this device will be removed. This can't be undone.");
    assert.equal(opt(chunkQ, "local").removes, true);
    assert.equal(opt(chunkQ, "remote").removes, true);
    assert.equal(opt(chunkQ, "both").removes, undefined, "keeping both removes no session");
    assert.equal(chunkQ.target, `mm. 1${DASH}4`, "what the summary names the record by");
    // more than one: counted, and each side's own number
    const moreHere = withMore(withMore(base, 2), 4);
    const q = buildSettleQuestions({ plan: legacyPlan(moreHere, theirs), piece: moreHere }).find((x) => x.part === "progress:c1");
    assert.equal(opt(q, "local").hint, "The session logged on your other device will be removed, from your account too. This can't be undone.");
    assert.equal(opt(q, "remote").hint, "The 2 sessions logged on this device will be removed. This can't be undone.");
    assert.equal(/\u2014/.test(JSON.stringify(q)), false, "no em dash");
  });

  test("an answer that would remove nothing says nothing: the other side only changed the rest of the record, or has no record", () => {
    const shared = { day: 1, loggedAt: 10, bpm: 60 };
    const one = { doneDays: [1], sessions: [shared, { day: 2, loggedAt: 20, bpm: 70 }, { day: 3, loggedAt: 30, bpm: 80 }] };
    const other = { doneDays: [1], sessions: [shared], flag: "rough" };
    const ask = (local, remote) => buildSettleQuestions({ plan: { status: "conflicts", conflicts: [{ part: "progress:c1", kind: "progress", id: "c1", local, remote }] }, piece: mine, year: 2026 })[0];
    const hints = (q) => q.options.map((o) => [o.value, o.hint || null, !!o.removes]);
    assert.deepEqual(hints(ask(one, other)), [
      ["local", null, false],
      ["remote", "The 2 sessions logged on this device will be removed. This can't be undone.", true],
    ]);
    assert.deepEqual(hints(ask(one, undefined)), [
      ["local", null, false],
      ["remote", "The 3 sessions logged on this device will be removed. This can't be undone.", true],
    ]);
    assert.deepEqual(hints(ask(undefined, other)), [
      ["local", "The session logged on your other device will be removed, from your account too. This can't be undone.", true],
      ["remote", null, false],
    ]);
  });

  test("a practice record that is not a list of sessions does not break the question", () => {
    const ask = (local, remote) => buildSettleQuestions({ plan: { status: "conflicts", conflicts: [{ part: "progress:c1", kind: "progress", id: "c1", local, remote }] }, piece: mine, year: 2026 })[0];
    const q = ask({ sessions: "x", doneDays: 3 }, { sessions: 7 });
    assert.equal(q.text, `The practice record for mm. 1${DASH}4 was changed differently on the two devices.`);
    assert.equal(q.detail, "Sessions: 0 on this device, 0 on your other device.");
  });

  test("difficulty ratings are counted in the singular where there is one measure", () => {
    const ask = (local, remote) =>
      buildSettleQuestions({ plan: { status: "conflicts", conflicts: [{ part: "measureDifficulty", kind: "field", field: "measureDifficulty", local, remote }] }, piece: mine, year: 2026 })[0].text;
    assert.equal(ask([1, 3, 1], [1, 1, 1]), "Difficulty ratings: 1 difficult measure on this device, every measure workable on your other device.");
    assert.equal(ask([1, 3, 3], [2, 1, 1]), "Difficulty ratings: 2 difficult measures on this device, 1 challenging measure on your other device.");
    assert.equal(ask([3, 2], [1, 1]), "Difficulty ratings: 1 difficult and 1 challenging measures on this device, every measure workable on your other device.");
  });

  test("settling never brings back a piece this device deleted meanwhile, never combines by name, and never marks a row in the account deleted", () => {
    const answers = { recordings: "local", targetDate: "local" };
    const settleOnly = (localPieces, device = heldDevice()) =>
      applyAccountMerge({
        candidates: candidatesOf(),
        localPieces,
        localTechnique: tech,
        accountRecord: accountRecordFor(device, USER),
        selectedIds: ["p1"],
        includeTechnique: false,
        settle: { p1: answers },
      });
    // deleted here while the questions were open (the device record not yet told)
    const deleted = settleOnly({});
    assert.deepEqual(deleted.pieces, {}, "not put back");
    assert.deepEqual([deleted.entries, deleted.settledIds, deleted.markDeleted], [{}, [], []]);
    assert.deepEqual(deleted.unsettled.map((u) => [u.id, u.name, u.reason]), [["p1", "Piece p1", "gone"]]);
    // deleted here and already noted in the record: also said, not silently dropped
    const noted = heldDevice();
    noted.accounts[USER].pieces.p1.deletedHere = true;
    const notedOut = settleOnly({}, noted);
    assert.deepEqual(notedOut.pieces, {});
    assert.deepEqual(notedOut.unsettled.map((u) => u.reason), ["gone"]);
    // the same piece under another id on this device (matched by name): that is a combine, which settling never does
    const renamed = { ...viaJson(mine), id: "q9" };
    const combined = settleOnly({ q9: renamed });
    assert.deepEqual(combined.markDeleted, [], "no row in the account is marked deleted");
    assert.deepEqual(Object.keys(combined.pieces), ["q9"]);
    assert.equal(combined.pieces.q9, renamed, "the piece that is here is untouched");
    assert.deepEqual(combined.unsettled.map((u) => u.reason), ["gone"]);
    // a piece that is in the answers but was never read from the account at all
    const noRow = applyAccountMerge({ candidates: accountRowsToCandidates({ pieces: [], technique: null }), localPieces: { p1: mine }, localTechnique: tech, accountRecord: accountRecordFor(heldDevice(), USER), selectedIds: ["p1"], includeTechnique: false, settle: { p1: answers } });
    assert.deepEqual(noRow.unsettled.map((u) => [u.id, u.reason]), [["p1", "gone"]]);
    assert.equal(noRow.pieces.p1, mine);
  });

  test("a piece that already matches by the time the answers come is 'up to date', not 'settled'", () => {
    const out = apply({ recordings: "local", targetDate: "local" }, { local: theirs, remote: theirs });
    assert.deepEqual([out.settledIds, out.upToDateIds, out.unsettled], [[], ["p1"], []]);
    assert.deepEqual(out.entries.p1.revision, 2, "the account's copy is recorded, clearing the hold");
  });

  test("a clean newer copy by the time the answers come (nothing of this device's is waiting) is taken, and reported as 'up to date'", () => {
    // this device's copy is exactly what it last synced; the account has moved on since
    const out = apply({ recordings: "local", targetDate: "local" }, { local: base, remote: theirs, device: { version: 1, accounts: { [USER]: autoRec({ p1: { ...syncedAs(base, 1), held: true } }) } } });
    assert.deepEqual([out.settledIds, out.upToDateIds, out.unsettled], [[], ["p1"], []]);
    assert.equal(out.pieces.p1.targetDate, theirs.targetDate, "the account's copy came in");
    assert.equal(out.entries.p1.revision, 2);
  });

  test("only the pieces asked about are reported on: an answer for a piece that was not selected is not counted as gone", () => {
    const out = applyAccountMerge({
      candidates: candidatesOf(),
      localPieces: { p1: mine },
      localTechnique: tech,
      accountRecord: accountRecordFor(heldDevice(), USER),
      selectedIds: ["p1"],
      includeTechnique: false,
      settle: { p1: { recordings: "local", targetDate: "local" }, p2: { name: "local" } },
    });
    assert.deepEqual(out.settledIds, ["p1"]);
    assert.deepEqual(out.unsettled, [], "p2 was not part of this step");
  });

  test("a failure while preparing a piece's questions sends it to the whole-piece picker and names it, rather than failing", () => {
    const rec = accountRecordFor(heldDevice(), USER);
    const broken = {
      get p1() {
        throw new Error("a stored value this device cannot read");
      },
    };
    const plan = planSettle({ candidates: candidatesOf(), localPieces: broken, accountRecord: rec, now: NOW });
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.fallbackIds, ["p1"]);
    assert.deepEqual(plan.errored, [{ id: "p1", name: "Piece p1" }]);
    // an ordinary piece the engine merely cannot judge is a fallback, but not an error
    const noBase = { version: 1, accounts: { [USER]: autoRec({ p1: { revision: 1, fingerprint: pieceFingerprint(base), held: true, conflicts: [{ part: "name", kind: "field", local: "a", remote: "b", base: "c" }] } }) } };
    const calm = planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: accountRecordFor(noBase, USER), now: NOW });
    assert.deepEqual([calm.fallbackIds, calm.errored], [["p1"], []]);
    // and asking about just one piece leaves the others alone
    const withTwo = withPieceHeld(heldDevice(), USER, "p2", [{ part: "name", kind: "field", local: "a", remote: "b", base: "c" }]);
    assert.deepEqual(planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: accountRecordFor(withTwo, USER), now: NOW, ids: ["p1"] }).fallbackIds, []);
    assert.deepEqual(planSettle({ candidates: candidatesOf(), localPieces: { p1: mine }, accountRecord: accountRecordFor(withTwo, USER), now: NOW }).fallbackIds, ["p2"], "...which is not so when no piece is named");
    // one piece's questions failing to be built does not take the other pieces down with it
    const other = pieceOf("p2", { name: "Other" });
    const otherTheirs = edited(withMore(other, 3), { notes: "there" });
    const otherMine = edited(withMore(other, 2), { notes: "here" });
    const twoDevice = { version: 1, accounts: { [USER]: autoRec({ p1: syncedAs(base, 1), p2: syncedAs(other, 1) }) } };
    const twoRun = runAuto({ local: { p1: mine, p2: otherMine }, rows: [[theirs, 2], [otherTheirs, 2]], record: accountRecordFor(twoDevice, USER) });
    const twoHeld = twoRun.held.reduce((r, h) => withPieceHeld(r, USER, h.id, h.conflicts), twoDevice);
    const failsForP1 = ({ plan, piece, year }) => {
      if (piece === mine) throw new Error("this one cannot be built");
      return buildSettleQuestions({ plan, piece, year });
    };
    const mixed = planSettle({
      candidates: accountRowsToCandidates({ pieces: [acctRow(theirs, 2), acctRow(otherTheirs, 2)], technique: null }),
      localPieces: { p1: mine, p2: otherMine },
      accountRecord: accountRecordFor(twoHeld, USER),
      now: NOW,
      build: failsForP1,
    });
    assert.deepEqual(mixed.items.map((i) => i.id), ["p2"], "the other piece is still asked about");
    assert.deepEqual(mixed.fallbackIds, ["p1"]);
    assert.deepEqual(mixed.errored, [{ id: "p1", name: "Piece p1" }]);
  });

  test("the result in the page says WHY nothing was changed: it moved on, it is gone, or something failed; and which pieces fell back", () => {
    const text = (u) => describeSettleResult({ unsettled: [u] }).map((l) => l.text);
    assert.deepEqual(text({ name: "Etude", reason: "changed" }), ["Etude changed again while you were deciding, so nothing was changed and it is still held. Press Review to look at it again."]);
    assert.deepEqual(text({ name: "Etude" }), text({ name: "Etude", reason: "changed" }), "no reason given reads as 'changed'");
    assert.deepEqual(text({ name: "Etude", reason: "gone" }), ["Etude is no longer waiting to be settled here (it may have been deleted, or settled in another window), so nothing was changed."]);
    assert.deepEqual(text({ name: "Etude", reason: "error" }), ["Something went wrong while settling Etude, so nothing was changed and it is still held. Press Review to try again."]);
    ["changed", "gone", "error"].forEach((reason) => assert.equal(describeSettleResult({ unsettled: [{ name: "Etude", reason }] })[0].problem, true));
    const fell = describeSettleResult({ fallback: [{ name: "Etude" }, { name: "Nocturne" }] });
    assert.deepEqual(fell.map((l) => l.text), ["Etude and Nocturne couldn't be asked about one question at a time, so they went through the whole-piece choice instead."]);
    assert.equal(describeSettleResult({ fallback: [{ name: "Etude" }] })[0].text, "Etude couldn't be asked about one question at a time, so it went through the whole-piece choice instead.");
    [
      ...text({ name: "E", reason: "gone" }),
      ...text({ name: "E", reason: "error" }),
      ...fell.map((l) => l.text),
      describeSettleRereadProblem("connection"),
      describeSettleRereadProblem("signed-out"),
      describeSettleRereadProblem("other"),
    ].forEach((t) => assert.equal(/\u2014/.test(t), false, `no em dash: ${t}`));
    assert.equal(describeSettleRereadProblem("connection"), "Nothing was changed. Couldn't reach the account service. Check your connection and try again. You can also choose Decide later.");
    assert.match(describeSettleRereadProblem("signed-out"), /^Nothing was changed\. You're signed out\./);
  });

  test("end to end through the fake database: settled, the piece goes up ONCE at the account's revision with every session, and is never held", async () => {
    const storage = memoryStorage();
    // the technique library is in sync, so the only thing that can go up is the piece
    saveDeviceRecord(
      withAccountCopyRecorded(heldDevice(), USER, { entries: {}, technique: { revision: 1, fingerprint: techniqueFingerprint(tech), parts: techniquePartFingerprints(tech) } }),
      storage
    );
    const fake = syncFake({ pieceRows: [pieceRow(theirs, { user_id: USER, revision: 2 })], techniqueRows: [{ user_id: USER, data: reorder(viaJson(tech)), revision: 1 }] });
    // the person answers; the one apply step records the account's copy FIRST, then the piece changes
    const out = apply({ recordings: "local", targetDate: "local" }, { device: readDeviceRecord(storage) });
    saveDeviceRecord(withAccountCopyRecorded(readDeviceRecord(storage), USER, { entries: out.entries }), storage);
    const result = await runSync(out.pieces, tech, fake, storage);
    assert.equal(result.uploaded, 1);
    assert.deepEqual(result.newlyHeld, []);
    const writes = fake.writes();
    assert.equal(writes.length, 1, "one upload");
    assert.deepEqual(writes[0].filters.filter(([c]) => c === "revision"), [["revision", 2]], "only if the account is still where it was read");
    const row = fake.rows.pieces.find((r) => r.id === "p1");
    assert.equal(row.revision, 3);
    assert.deepEqual(durations(row.data), [90, 90, 120], "every session from both devices, in the account");
    assert.equal(row.data.targetDate, "2026-11-01");
    const rec = recordOf(storage);
    assert.equal(rec.pieces.p1.held, undefined);
    assert.equal(computeWaiting({ pieces: out.pieces, technique: tech, accountRecord: rec }).count, 0);
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 122: a piece deleted on one device is deleted everywhere,     */
/*  with a way back                                                    */
/* ------------------------------------------------------------------ */

const P122_NOW = Date.parse("2026-10-24T12:00:00Z");
const P122_DAY = 24 * 60 * 60 * 1000;
const p122ago = (ms) => new Date(P122_NOW - ms).toISOString();

describe("a piece deleted on another device is removed here by itself, within 30 days (Pass 122)", () => {
  const base = pieceOf("p1", { name: "Etude" });
  const gone = (p, revision, at, extra = {}) => acctRow(p, revision, { deleted_at: at, ...extra });
  const candidatesOf = (rows) => accountRowsToCandidates({ pieces: rows, technique: null });
  const rec = (extra = {}) => autoRec({ p1: syncedAs(base, 1), ...extra });
  const run = ({ local = { p1: base }, rows, record = rec(), busyIds = [], automatic = true }) =>
    applyAccountMerge({ candidates: candidatesOf(rows), localPieces: local, accountRecord: record, automatic, busyIds, now: P122_NOW, includeTechnique: false });

  test("a piece the account marked deleted yesterday is removed, with nothing recorded for it", () => {
    const out = run({ rows: [gone(base, 5, p122ago(P122_DAY))] });
    assert.deepEqual(out.removed, [{ id: "p1", name: "Etude", lostSessions: 0 }]);
    assert.deepEqual(Object.keys(out.pieces), []);
    assert.deepEqual(out.entries, {}, "no 'synced at revision 5' is recorded for something that is gone");
    assert.deepEqual([out.leftDeleted, out.deferred, out.held, out.needsYou], [[], [], [], []]);
  });

  test("practice that was never backed up goes with the piece and is counted; what the account already has is not", () => {
    const here = withMore(withMore(base, 2), 3);
    assert.equal(run({ local: { p1: here }, rows: [gone(base, 5, p122ago(P122_DAY))] }).removed[0].lostSessions, 2);
    assert.equal(run({ rows: [gone(base, 5, p122ago(P122_DAY))] }).removed[0].lostSessions, 0);
  });

  test("the window: exactly 30 days is inside; a millisecond older is only listed, and this device's copy is untouched", () => {
    assert.deepEqual(run({ rows: [gone(base, 5, p122ago(30 * P122_DAY))] }).removed.map((r) => r.id), ["p1"]);
    const outside = run({ rows: [gone(base, 5, p122ago(30 * P122_DAY + 1))] });
    assert.deepEqual([outside.removed, outside.leftDeleted], [[], [{ id: "p1", name: "Etude", revision: 5 }]]);
    assert.equal(outside.pieces.p1, base);
  });

  test("a deleted time that can't be read is never a reason to remove anything", () => {
    const out = run({ rows: [gone(base, 5, "garbage")] });
    assert.deepEqual([out.removed, out.leftDeleted.map((d) => d.id)], [[], ["p1"]]);
  });

  test("a duplicate that a combine marked deleted is never removed by itself", () => {
    const out = run({ rows: [gone({ ...viaJson(base), mergedInto: "L1" }, 5, p122ago(P122_DAY))] });
    assert.deepEqual([out.removed, out.leftDeleted.map((d) => d.id)], [[], ["p1"]]);
    assert.equal(out.pieces.p1, base);
  });

  test("a piece this device never synced (brought in from a file) is never removed by itself, even deleted yesterday", () => {
    // no record at all: the piece you deleted and then imported again from a backup file
    const noRecord = run({ rows: [gone(base, 5, p122ago(P122_DAY))], record: autoRec({}) });
    assert.deepEqual([noRecord.removed, noRecord.leftDeleted], [[], [{ id: "p1", name: "Etude", revision: 5 }]]);
    assert.equal(noRecord.pieces.p1, base);
    assert.deepEqual(noRecord.entries, {}, "nothing is recorded as synced for it either");
    // a bare hold (what a refused first upload leaves) is not a sync
    const bareHold = run({ rows: [gone(base, 5, p122ago(P122_DAY))], record: autoRec({ p1: { held: true, sent: ["abc"] } }) });
    assert.deepEqual([bareHold.removed, bareHold.leftDeleted.map((d) => d.id)], [[], ["p1"]]);
    assert.equal(bareHold.pieces.p1, base);
    // the same piece WITH a recorded sync still goes: the owner's rule, a deletion wins
    assert.deepEqual(run({ rows: [gone(base, 5, p122ago(P122_DAY))] }).removed.map((r) => r.id), ["p1"]);
  });

  test("a piece in use waits: not removed, not recorded, found again next time", () => {
    const out = run({ rows: [gone(base, 5, p122ago(P122_DAY))], busyIds: ["p1"] });
    assert.deepEqual([out.removed, out.deferred, out.entries], [[], [{ id: "p1", name: "Etude" }], {}]);
    assert.equal(out.pieces.p1, base);
  });

  test("a piece held as 'changed on another device' is removed too: the deletion is why its upload was refused", () => {
    const out = run({ rows: [gone(base, 5, p122ago(P122_DAY))], record: rec({ p1: { ...syncedAs(base, 1), held: true } }) });
    assert.deepEqual(out.removed.map((r) => r.id), ["p1"]);
  });

  test("a deleted row for a piece this device doesn't hold is nothing", () => {
    const out = run({ rows: [gone(pieceOf("p9"), 3, p122ago(P122_DAY))] });
    assert.deepEqual([out.removed, out.leftDeleted, out.pieces.p1 === base], [[], [], true]);
  });

  test("the rest of an automatic update goes on as before: a clean newer copy of another piece is still taken", () => {
    const two = pieceOf("p2", { name: "Nocturne" });
    const out = run({
      local: { p1: base, p2: two },
      rows: [gone(base, 5, p122ago(P122_DAY)), acctRow(withMore(two, 2), 3)],
      record: autoRec({ p1: syncedAs(base, 1), p2: syncedAs(two, 2) }),
    });
    assert.deepEqual(out.removed.map((r) => r.id), ["p1"]);
    assert.deepEqual(Object.keys(out.pieces), ["p2"]);
    assert.deepEqual(out.names.took, ["Nocturne"]);
  });

  test("by hand (Get changes) nothing is removed: it is listed with when it was deleted, and whether it was a combine's duplicate", () => {
    const rows = [gone(base, 5, p122ago(P122_DAY))];
    const manual = run({ rows, automatic: false });
    assert.deepEqual([manual.removed, manual.pieces.p1 === base], [[], true]);
    const plan = planAccountMerge({ candidates: candidatesOf(rows), localPieces: { p1: base }, localTechnique: null, accountRecord: rec() });
    assert.deepEqual(plan.deletedElsewhere.map((d) => [d.id, d.deletedAt, d.mergedInto, d.hasUnsyncedChanges]), [["p1", p122ago(P122_DAY), null, false]]);
    const dup = planAccountMerge({ candidates: candidatesOf([gone({ ...viaJson(base), mergedInto: "L1" }, 5, p122ago(P122_DAY))]), localPieces: { p1: base }, localTechnique: null, accountRecord: rec() });
    assert.equal(dup.deletedElsewhere[0].mergedInto, "L1");
  });

  test("the candidates carry what the rest needs: when, where a combine put it, its saved data; live rows carry theirs as read", () => {
    const live = acctRow(pieceOf("p2"), 3);
    const dead = gone({ ...viaJson(base), mergedInto: "L1" }, 5, p122ago(P122_DAY));
    const c = candidatesOf([live, dead]);
    assert.deepEqual(c.deleted.map((d) => [d.id, d.deletedAt, d.mergedInto, d.name]), [["p1", p122ago(P122_DAY), "L1", "Etude"]]);
    assert.equal(c.deleted[0].data, dead.data);
    assert.equal(c.pieces[0].raw, live.data);
    assert.equal(candidatesOf([gone(base, 5, p122ago(P122_DAY))]).deleted[0].mergedInto, null);
  });
});

describe("what an automatic update fetches, with deletions (Pass 122)", () => {
  const entry = (revision) => ({ revision, fingerprint: "f" });
  const rows = {
    pieces: [
      { id: "p1", revision: 3, deleted_at: null }, // newer
      { id: "p3", revision: 2, deleted_at: p122ago(P122_DAY) }, // deleted yesterday
      { id: "p4", revision: 2, deleted_at: p122ago(40 * P122_DAY) }, // deleted long ago
    ],
    technique: null,
  };
  const record = (on) => {
    const r = { version: 1, accounts: { [USER]: autoRec({ p1: entry(1), p3: entry(1), p4: entry(1) }) } };
    return on ? withAutoUpdate(r, USER, true) : r;
  };
  const inputs = (on) => {
    const acct = accountRecordFor(record(on), USER);
    const here = ["p1", "p3", "p4"];
    return {
      changes: classifyAccountChanges({ rows, accountRecord: acct, localPieceIds: here }),
      deletions: deletionsElsewhere({ rows, entries: acct.pieces, localPieceIds: here, now: P122_NOW }),
    };
  };

  test("with the switch on, a recent deletion is a target; one older than 30 days never is", () => {
    const { changes, deletions } = inputs(true);
    assert.deepEqual(deletions, { ids: ["p3", "p4"], recent: ["p3"], older: ["p4"], unsynced: [] });
    assert.deepEqual(autoUpdateTargets({ deviceRecord: record(true), userId: USER, changes, deletions }), { on: true, pieceIds: ["p1", "p3"], technique: false });
  });

  test("a recent deletion of a piece this device never synced is not a target: it is only listed", () => {
    // p3 sits here with no record (brought in from a file); p5 has only a bare hold (a refused first upload)
    const lightRows = {
      pieces: [
        { id: "p1", revision: 3, deleted_at: null },
        { id: "p3", revision: 2, deleted_at: p122ago(P122_DAY) },
        { id: "p5", revision: 2, deleted_at: p122ago(P122_DAY) },
      ],
      technique: null,
    };
    const rec2 = withAutoUpdate({ version: 1, accounts: { [USER]: autoRec({ p1: entry(1), p5: { held: true, sent: ["x"] } }) } }, USER, true);
    const acct = accountRecordFor(rec2, USER);
    const here = ["p1", "p3", "p5"];
    const deletions = deletionsElsewhere({ rows: lightRows, entries: acct.pieces, localPieceIds: here, now: P122_NOW });
    assert.deepEqual(deletions, { ids: ["p3", "p5"], recent: [], older: [], unsynced: ["p3", "p5"] });
    const changes = classifyAccountChanges({ rows: lightRows, accountRecord: acct, localPieceIds: here });
    assert.deepEqual(autoUpdateTargets({ deviceRecord: rec2, userId: USER, changes, deletions }).pieceIds, ["p1"]);
  });

  test("with the switch off nothing is ever a target, deletions included", () => {
    const { changes, deletions } = inputs(false);
    assert.deepEqual(autoUpdateTargets({ deviceRecord: record(false), userId: USER, changes, deletions }), { on: false, pieceIds: [], technique: false });
  });

  test("asked without deletions it is exactly what it was before this pass", () => {
    const { changes } = inputs(true);
    assert.deepEqual(autoUpdateTargets({ deviceRecord: record(true), userId: USER, changes }), { on: true, pieceIds: ["p1"], technique: false });
    assert.deepEqual(autoUpdateTargets({ deviceRecord: record(true), userId: USER, changes, deletions: { ids: [], recent: [], older: [] } }).pieceIds, ["p1"]);
  });

  test("a piece that is both newer and recently deleted is asked for once", () => {
    const { changes } = inputs(true);
    const out = autoUpdateTargets({ deviceRecord: record(true), userId: USER, changes, deletions: { ids: ["p1"], recent: ["p1"], older: [] } });
    assert.deepEqual(out.pieceIds, ["p1"]);
  });
});

describe("a deletion wins over practice logged on another device (Pass 122)", () => {
  const setup = () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const { p3, ...without } = pieces;
    saveDeviceRecord(reconcileLocalDeletions(readDeviceRecord(storage), { removedIds: ["p3"], presentIds: ["p1", "p2"] }).record, storage);
    return { storage, pieces, without, fake: syncFake(accountHolding(pieces, technique)) };
  };
  const movedOn = (fake, id) => {
    const row = fake.rows.pieces.find((x) => x.id === id);
    row.revision += 1;
    row.data = { ...row.data, name: "Practiced on another device" };
  };
  const revisionsOf = (writes) => writes.map((w) => w.filters.filter(([c]) => c === "revision")[0][1]);

  test("the account moved on after this device last saw the piece: the deletion goes through at the newer revision and is not held", async () => {
    const { storage, without, fake } = setup();
    movedOn(fake, "p3");
    const r = await runSync(without, technique, fake, storage, { now: () => P122_NOW });
    assert.equal(r.uploaded, 1);
    assert.deepEqual(r.newlyHeld, []);
    const row = fake.rows.pieces.find((x) => x.id === "p3");
    assert.equal(row.deleted_at, new Date(P122_NOW).toISOString());
    assert.equal(row.revision, 3);
    assert.equal(row.data.name, "Practiced on another device", "what the other device logged is still in the row");
    const writes = fake.writes();
    assert.deepEqual(revisionsOf(writes), [1, 2], "first at the revision this device saw, then at the one just read");
    assert.deepEqual(writes.map((w) => Object.keys(w.values)), [["deleted_at"], ["deleted_at"]], "only the deleted mark, both times");
    assert.equal(recordOf(storage).pieces.p3, undefined, "this device has nothing left to remember about it");
    assert.equal(computeWaiting({ pieces: without, technique, accountRecord: recordOf(storage) }).count, 0);
  });

  test("tried ONCE more, not forever: if the row moves again, the deletion stays waiting (not held) and the next run finishes it", async () => {
    const { storage, without, fake } = setup();
    movedOn(fake, "p3");
    let updates = 0;
    const flaky = syncFake({
      pieceRows: fake.rows.pieces,
      techniqueRows: fake.rows.technique,
      inject: (call, rows) => {
        if (call.table === "pieces" && call.op === "update" && (updates += 1) === 2) rows.pieces.find((x) => x.id === "p3").revision += 1;
        return null;
      },
    });
    const first = await runSync(without, technique, flaky, storage, { now: () => P122_NOW });
    assert.equal(first.uploaded, 0);
    assert.equal(first.failed, 1);
    assert.deepEqual(first.newlyHeld, []);
    assert.equal(recordOf(storage).pieces.p3.held, undefined, "not held");
    assert.equal(computeWaiting({ pieces: without, technique, accountRecord: recordOf(storage) }).count, 1, "still waiting");
    const second = await runSync(without, technique, flaky, storage, { now: () => P122_NOW });
    assert.equal(second.uploaded, 1);
    assert.ok(flaky.rows.pieces.find((x) => x.id === "p3").deleted_at);
    assert.equal(recordOf(storage).pieces.p3, undefined);
  });

  test("no connection on the second try stops the run with the deletion still waiting", async () => {
    const { storage, without, fake } = setup();
    movedOn(fake, "p3");
    let updates = 0;
    const down = syncFake({
      pieceRows: fake.rows.pieces,
      techniqueRows: fake.rows.technique,
      inject: (call) => (call.table === "pieces" && call.op === "update" && (updates += 1) === 2 ? noConnection() : null),
    });
    const r = await runSync(without, technique, down, storage, { now: () => P122_NOW });
    assert.equal(r.status, "stopped");
    assert.equal(r.reason, "connection");
    assert.equal(recordOf(storage).pieces.p3.deletedHere, true, "still waiting to go up");
    assert.equal(recordOf(storage).pieces.p3.held, undefined);
  });

  test("a row that someone else already marked deleted is simply adopted, as before", async () => {
    const { storage, without, fake } = setup();
    const row = fake.rows.pieces.find((x) => x.id === "p3");
    row.revision = 2;
    row.deleted_at = "2026-10-20T00:00:00.000Z";
    const r = await runSync(without, technique, fake, storage, { now: () => P122_NOW });
    assert.equal(r.resolved, 1);
    assert.equal(fake.writes().length, 1, "nothing more was sent");
    assert.equal(recordOf(storage).pieces.p3, undefined);
  });

  test("only a deletion is retried: a refused CHANGE to a piece is still held, exactly as before", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    movedOn(fake, "p2");
    const r = await runSync({ ...pieces, p2: { ...pieces.p2, name: "Mine" } }, technique, fake, storage);
    assert.deepEqual(r.newlyHeld.map((h) => h.id), ["p2"]);
    assert.equal(fake.writes().length, 1, "never retried");
  });

  test("a change this device made to a piece the account has deleted is held: removing it is the automatic update's job, not the upload's", async () => {
    const storage = memoryStorage(), pieces = three();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    const row = fake.rows.pieces.find((x) => x.id === "p2");
    row.revision = 2;
    row.deleted_at = "2026-10-20T00:00:00.000Z";
    const r = await runSync({ ...pieces, p2: { ...pieces.p2, name: "Practiced here" } }, technique, fake, storage);
    assert.deepEqual(r.newlyHeld.map((h) => h.id), ["p2"]);
    assert.equal(fake.rows.pieces.find((x) => x.id === "p2").deleted_at, "2026-10-20T00:00:00.000Z", "the account's deletion is untouched");
  });
});

describe("bringing a deleted piece back: Keep it and Restore (Pass 122)", () => {
  const deletedAt = "2026-10-23T10:00:00.000Z";
  const setup = (extra = {}, rowExtra = {}) => {
    const p = pieceOf("p1", { name: "Etude" });
    return { p, fake: syncFake({ pieceRows: [pieceRow(p, { user_id: USER, revision: 5, deleted_at: deletedAt, ...rowExtra })], ...extra }) };
  };
  const bring = (fake, over = {}) => bringBackDeletedPiece({ userId: USER, id: "p1", getClient: async () => fake.client, ...over });

  test("it clears deleted_at and nothing else, only if the row is still at the revision the person looked at", async () => {
    const { p, fake } = setup();
    const out = await bring(fake, { expectedRevision: 5 });
    assert.equal(out.status, "kept");
    assert.equal(out.revision, 6);
    assert.equal(sameData(out.data, p), true, "the row's saved copy comes back to the caller");
    const [write] = fake.writes();
    assert.deepEqual(write.values, { deleted_at: null });
    assert.deepEqual(write.filters.filter(([c]) => c === "revision"), [["revision", 5]]);
    const row = fake.rows.pieces[0];
    assert.deepEqual([row.deleted_at, row.revision], [null, 6]);
    assert.equal(sameData(row.data, p), true, "its data was never touched");
  });

  test("a row that moved since the person looked is refused, and nothing is written", async () => {
    const { fake } = setup();
    const out = await bring(fake, { expectedRevision: 4 });
    assert.deepEqual(out, { status: "moved" });
    assert.deepEqual(fake.writes(), []);
    assert.equal(fake.rows.pieces[0].deleted_at, deletedAt);
  });

  test("a row that moves between the read and the write is refused too: the write itself is conditional", async () => {
    const { fake } = setup({ inject: (call, rows) => { if (call.op === "update") rows.pieces[0].revision += 1; return null; } });
    const out = await bring(fake, { expectedRevision: 5 });
    assert.deepEqual(out, { status: "moved" });
    assert.equal(fake.rows.pieces[0].deleted_at, deletedAt, "still deleted");
  });

  test("with no revision to hold it to, it keeps whatever is read (the same conditional write)", async () => {
    const { fake } = setup();
    assert.equal((await bring(fake)).status, "kept");
  });

  test("a piece that is no longer marked deleted is 'live': nothing is written, and the caller still gets its copy", async () => {
    const { p, fake } = setup({}, { deleted_at: null, revision: 6 });
    const out = await bring(fake, { expectedRevision: 5 });
    assert.equal(out.status, "live");
    assert.equal(out.revision, 6);
    assert.equal(sameData(out.data, p), true);
    assert.deepEqual(fake.writes(), []);
  });

  test("a duplicate that a combine marked deleted is never brought back on its own", async () => {
    const dup = { ...viaJson(pieceOf("p1")), mergedInto: "L1" };
    const fake = syncFake({ pieceRows: [{ user_id: USER, id: "p1", data: reorder(dup), revision: 5, deleted_at: deletedAt }] });
    assert.deepEqual(await bring(fake, { expectedRevision: 5 }), { status: "combined" });
    assert.deepEqual(fake.writes(), []);
  });

  test("no such row, no connection and the wrong account are each said, and nothing is written", async () => {
    const { fake } = setup();
    assert.deepEqual(await bring(fake, { id: "nope" }), { status: "gone" });
    const down = setup({ inject: () => noConnection() });
    assert.deepEqual(await bring(down.fake), { status: "stopped", reason: "connection" });
    assert.deepEqual(await bring(fake, { userId: "someone-else" }), { status: "stopped", reason: "signed-out" });
    assert.deepEqual(fake.writes(), []);
  });

  test("restorePieceRow on its own: the right revision clears the mark, the wrong one is a conflict", async () => {
    const { fake } = setup();
    const wrong = await restorePieceRow(fake.client, USER, "p1", 4);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.conflict, true);
    const right = await restorePieceRow(fake.client, USER, "p1", 5);
    assert.deepEqual([right.ok, right.revision], [true, 6]);
  });
});

describe("the Recently deleted list reads only the last 30 days (Pass 122)", () => {
  test("it asks the account for rows deleted at or after the cutoff, with their saved data, and the list is shaped from them", async () => {
    const rows = [
      pieceRow(pieceOf("a", { name: "Ballade" }), { revision: 4, deleted_at: p122ago(2 * P122_DAY) }),
      pieceRow(pieceOf("b"), { revision: 3, deleted_at: p122ago(31 * P122_DAY) }),
      pieceRow(pieceOf("c"), { revision: 2, deleted_at: null }),
    ];
    const fake = syncFake({ pieceRows: rows });
    const out = await fetchDeletedPieces({ userId: USER, now: P122_NOW, getClient: async () => fake.client });
    assert.equal(out.status, "ok");
    assert.deepEqual(out.rows.map((r) => r.id), ["a"], "only what was asked for came back");
    const call = fake.calls[0];
    assert.deepEqual(call.gtes, [["deleted_at", p122ago(RECENTLY_DELETED_DAYS * P122_DAY)]]);
    assert.equal(call.columns, "id, revision, deleted_at, data");
    assert.deepEqual(recentlyDeletedList(out.rows, { now: P122_NOW }).map((i) => [i.id, i.name]), [["a", "Ballade"]]);
  });

  test("a read that fails is reported as stopped, never thrown; the wrong account is signed-out", async () => {
    const down = syncFake({ inject: () => noConnection() });
    assert.deepEqual(await fetchDeletedPieces({ userId: USER, now: P122_NOW, getClient: async () => down.client }), { status: "stopped", reason: "connection" });
    const fake = syncFake();
    assert.deepEqual(await fetchDeletedPieces({ userId: "someone-else", now: P122_NOW, getClient: async () => fake.client }), { status: "stopped", reason: "signed-out" });
    assert.deepEqual(await fetchDeletedPieces({ userId: USER, getClient: async () => null }), { status: "stopped", reason: "connection" });
  });
});

describe("a combine notes where its duplicate went (Pass 122)", () => {
  const NOW4 = Date.UTC(2026, 9, 4);
  const setup = () => {
    const dup = pieceOf("R1", { name: "Ballade No. 1" });
    const fake = syncFake({ pieceRows: [pieceRow(dup, { user_id: USER, revision: 7 })] });
    return { dup, fake, raw: fake.rows.pieces[0].data };
  };
  const mark = (fake, raw) =>
    markOtherCopiesDeleted({ items: [{ id: "R1", revision: 7, name: "Ballade No. 1", intoId: "L1", raw }], userId: USER, getClient: async () => fake.client, now: () => Date.UTC(2026, 9, 3) });

  test("the row is marked deleted and its data goes back as read with one note added, only if still at that revision", async () => {
    const { dup, fake, raw } = setup();
    const r = await mark(fake, raw);
    assert.deepEqual(r.marked.map((m) => m.id), ["R1"]);
    const call = fake.calls.find((c) => c.op === "update");
    assert.deepEqual(Object.keys(call.values).sort(), ["data", "deleted_at"]);
    assert.ok(call.filters.some(([c, v]) => c === "revision" && v === 7));
    const row = fake.rows.pieces[0];
    assert.ok(row.deleted_at);
    assert.equal(row.data.mergedInto, "L1");
    const { mergedInto, ...rest } = row.data;
    assert.equal(sameData(rest, dup), true, "everything else in the saved data is exactly what it was");
    assert.equal(fake.rows.pieces.length, 1, "nothing erased");
  });

  test("a row someone changed meanwhile is left alone, note and all", async () => {
    const { fake, raw } = setup();
    fake.rows.pieces[0].revision = 9;
    const r = await mark(fake, raw);
    assert.deepEqual(r.failed.map((f) => f.reason), ["refused"]);
    assert.equal(fake.rows.pieces[0].deleted_at, null);
    assert.equal(fake.rows.pieces[0].data.mergedInto, undefined);
  });

  test("everything downstream reads the note: the candidates, the list, and the automatic path", async () => {
    const { dup, fake, raw } = setup();
    await mark(fake, raw);
    const row = fake.rows.pieces[0];
    const c = accountRowsToCandidates({ pieces: [{ id: row.id, revision: row.revision, deleted_at: row.deleted_at, data: row.data }], technique: null });
    assert.equal(c.deleted[0].mergedInto, "L1");
    assert.deepEqual(recentlyDeletedList([row], { now: NOW4 }), [], "never listed as something a person deleted");
    const out = applyAccountMerge({ candidates: c, localPieces: { R1: dup }, accountRecord: autoRec({ R1: syncedAs(dup, 7) }), automatic: true, now: NOW4, includeTechnique: false });
    assert.deepEqual([out.removed, out.leftDeleted.map((d) => d.id)], [[], ["R1"]], "a device that still holds the duplicate leaves it alone");
    assert.equal(out.pieces.R1, dup);
  });

  test("markPieceRowCombined on its own: the note is added to what was read, never replacing it", async () => {
    const { fake, raw } = setup();
    const r = await markPieceRowCombined(fake.client, USER, "R1", 7, "2026-10-03T00:00:00.000Z", raw, "L1");
    assert.deepEqual([r.ok, r.revision], [true, 8]);
    assert.deepEqual(Object.keys(fake.rows.pieces[0].data).sort(), [...Object.keys(raw), "mergedInto"].sort());
  });

  test("end to end: a combine through the apply step names the duplicate's data, and the account row then reads as a combine's", async () => {
    const here = validateAndMigratePiece({ ...viaJson(pieceOf("L1")), name: "Ballade No. 1", composer: "Chopin", createdAt: 10 });
    const there = validateAndMigratePiece({ ...viaJson(pieceOf("R1")), name: "Ballade No. 1", composer: "Chopin", createdAt: 20 });
    const fake = syncFake({ pieceRows: [pieceRow(there, { user_id: USER, revision: 7 })] });
    const out = applyAccountMerge({
      candidates: accountRowsToCandidates({ pieces: [{ id: "R1", revision: 7, deleted_at: null, data: fake.rows.pieces[0].data }], technique: null }),
      localPieces: { L1: here },
      accountRecord: autoRec({ L1: syncedAs(here, 1) }),
      includeTechnique: false,
    });
    assert.equal(out.markDeleted.length, 1);
    const r = await markOtherCopiesDeleted({ items: out.markDeleted, userId: USER, getClient: async () => fake.client, now: () => NOW4 });
    assert.deepEqual(r.marked.map((m) => m.id), ["R1"]);
    assert.equal(fake.rows.pieces[0].data.mergedInto, "L1");
    assert.equal(fake.rows.pieces[0].deleted_at, new Date(NOW4).toISOString());
  });
});

describe("the whole chain through the fake database: one device deletes, another removes it (Pass 122)", () => {
  test("device A deletes a piece and it goes up; device B's automatic update removes it, and has nothing to send afterwards", async () => {
    const pieces = three();
    const storageA = memoryStorage(), storageB = memoryStorage();
    afterFirstBackup(pieces, technique, storageA);
    afterFirstBackup(pieces, technique, storageB);
    const fake = syncFake(accountHolding(pieces, technique));
    // A: p3 deleted, then uploaded
    const { p3, ...without } = pieces;
    saveDeviceRecord(reconcileLocalDeletions(readDeviceRecord(storageA), { removedIds: ["p3"], presentIds: ["p1", "p2"] }).record, storageA);
    await runSync(without, technique, fake, storageA, { now: () => P122_NOW - P122_DAY });
    // B: the light look, what an automatic update would fetch, the rows, the apply
    saveDeviceRecord(withAutoUpdate(readDeviceRecord(storageB), USER, true), storageB);
    const light = { pieces: fake.rows.pieces.map((r) => ({ id: r.id, revision: r.revision, deleted_at: r.deleted_at })), technique: { revision: 1 } };
    const acct = recordOf(storageB);
    const here = Object.keys(pieces);
    const deletions = deletionsElsewhere({ rows: light, entries: acct.pieces, localPieceIds: here, now: P122_NOW });
    assert.deepEqual(deletions.recent, ["p3"]);
    const targets = autoUpdateTargets({ deviceRecord: readDeviceRecord(storageB), userId: USER, changes: classifyAccountChanges({ rows: light, accountRecord: acct, localPieceIds: here }), deletions });
    assert.deepEqual(targets.pieceIds, ["p3"]);
    const got = await fetchChangedAccountRows({ userId: USER, ids: targets.pieceIds, getClient: async () => fake.client });
    assert.equal(got.status, "ok");
    const out = applyAccountMerge({ candidates: accountRowsToCandidates(got.rows), localPieces: pieces, accountRecord: acct, automatic: true, now: P122_NOW, includeTechnique: false });
    assert.deepEqual(out.removed, [{ id: "p3", name: "Piece p3", lostSessions: 0 }]);
    assert.deepEqual(Object.keys(out.pieces).sort(), ["p1", "p2"]);
    // the caller forgets the piece first (withPieceDropped), then removes it: nothing is left to send
    saveDeviceRecord(withPieceDropped(readDeviceRecord(storageB), USER, "p3"), storageB);
    assert.equal(computeWaiting({ pieces: out.pieces, technique, accountRecord: recordOf(storageB) }).count, 0);
    const writesBefore = fake.writes().length;
    await runSync(out.pieces, technique, fake, storageB);
    assert.equal(fake.writes().length, writesBefore, "B sent nothing: no second deletion goes up");
    assert.ok(fake.rows.pieces.find((x) => x.id === "p3").deleted_at, "and the account still has the deleted piece, marked, with its data");
  });

  test("a piece you deleted and then imported again from a backup file is never removed by itself", async () => {
    const pieces = three();
    const storage = memoryStorage();
    afterFirstBackup(pieces, technique, storage);
    const fake = syncFake(accountHolding(pieces, technique));
    // this device deletes p3 and the deletion goes up: the record keeps nothing about it
    const { p3, ...without } = pieces;
    saveDeviceRecord(reconcileLocalDeletions(readDeviceRecord(storage), { removedIds: ["p3"], presentIds: ["p1", "p2"] }).record, storage);
    await runSync(without, technique, fake, storage, { now: () => P122_NOW - P122_DAY });
    assert.equal(recordOf(storage).pieces.p3, undefined);
    assert.ok(fake.rows.pieces.find((x) => x.id === "p3").deleted_at);
    // importing a file that holds it again keeps its id, so it is back here; the account's deleted row refuses its upload
    const again = await runSync(pieces, technique, fake, storage, { now: () => P122_NOW });
    assert.deepEqual(again.newlyHeld.map((h) => h.id), ["p3"]);
    assert.equal(recordOf(storage).pieces.p3.revision, undefined, "held, but nothing says this device ever synced it");
    // with the switch on, the light look says it was deleted a day ago
    saveDeviceRecord(withAutoUpdate(readDeviceRecord(storage), USER, true), storage);
    const light = { pieces: fake.rows.pieces.map((r) => ({ id: r.id, revision: r.revision, deleted_at: r.deleted_at })), technique: { revision: 1 } };
    const acct = recordOf(storage);
    const here = Object.keys(pieces);
    const deletions = deletionsElsewhere({ rows: light, entries: acct.pieces, localPieceIds: here, now: P122_NOW });
    assert.deepEqual([deletions.recent, deletions.unsynced], [[], ["p3"]]);
    const targets = autoUpdateTargets({ deviceRecord: readDeviceRecord(storage), userId: USER, changes: classifyAccountChanges({ rows: light, accountRecord: acct, localPieceIds: here }), deletions });
    assert.equal(targets.pieceIds.includes("p3"), false, "not even fetched to be removed");
    // and if the apply step is handed the row anyway, it still leaves the piece alone
    const got = await fetchChangedAccountRows({ userId: USER, ids: ["p3"], getClient: async () => fake.client });
    const out = applyAccountMerge({ candidates: accountRowsToCandidates(got.rows), localPieces: pieces, accountRecord: acct, automatic: true, now: P122_NOW, includeTechnique: false });
    assert.deepEqual([out.removed, out.leftDeleted.map((d) => d.id)], [[], ["p3"]]);
    assert.equal(out.pieces.p3, pieces.p3);
    // and the person is told about it, switch on or off, with the two buttons
    assert.deepEqual(deletedForPerson({ deletions, autoOn: true, leftIds: [] }), ["p3"]);
    assert.deepEqual(deletedForPerson({ deletions, autoOn: false, leftIds: [] }), ["p3"]);
  });
});

describe("the words for deletions and for bringing a piece back (Pass 122)", () => {
  test("the Account panel's line: updated, removed, or both", () => {
    assert.equal(describeAutoUpdate({ names: ["Ballade"] }), "Updated from another device: Ballade.");
    assert.equal(describeAutoUpdate({ technique: true }), "Updated from another device: the technique library.");
    assert.equal(describeAutoUpdate({ removed: ["Etude"] }), "Removed because it was deleted on another device: Etude.");
    assert.equal(describeAutoUpdate({ removed: ["Etude", "Nocturne"] }), "Removed because they were deleted on another device: Etude and Nocturne.");
    assert.equal(describeAutoUpdate({ names: ["Ballade"], removed: ["Etude"] }), "Updated from another device: Ballade. Removed because it was deleted on another device: Etude.");
    assert.equal(describeAutoUpdate({ removed: ["Etude", "Etude"] }), "Removed because it was deleted on another device: Etude.", "a name once");
    assert.equal(describeAutoUpdate({}), null);
  });

  test("the page-wide lines: red when practice went with the piece (how many, and that it can't come back), plain when the open piece went, otherwise none", () => {
    const one = describeAutoRemoved([{ name: "Etude", lostSessions: 1 }]);
    assert.deepEqual(one, [
      {
        text: "Etude was deleted on another device, so it was removed here too. 1 session you logged here since your last backup went with it. You can bring the piece back from Recently deleted in Settings for 30 days, but not that session.",
        problem: true,
      },
    ]);
    const many = describeAutoRemoved([{ name: "Etude", lostSessions: 3 }]);
    assert.match(many[0].text, /^Etude was deleted on another device, so it was removed here too\. 3 sessions you logged here since your last backup went with it\./);
    assert.match(many[0].text, /but not those sessions\.$/);
    assert.deepEqual(describeAutoRemoved([{ name: "Etude", lostSessions: 0 }], "Etude"), [{ text: "Etude was deleted on another device, so it was removed here too." }]);
    assert.deepEqual(describeAutoRemoved([{ name: "Etude", lostSessions: 0 }], "Other"), [], "a quiet removal of a piece that was not open is only the Account panel's line");
    assert.deepEqual(describeAutoRemoved([{ name: "Etude", lostSessions: 2 }], "Etude").length, 1, "practice lost and open: the one red line, not two");
    assert.deepEqual(describeAutoRemoved([], null), []);
  });

  test("the banner for pieces the person is asked about", () => {
    assert.equal(describeDeletedElsewhere(["Ballade No. 1"]), "Ballade No. 1 was deleted on another device.");
    assert.equal(describeDeletedElsewhere(["A", "B", "C"]), "3 pieces were deleted on another device: A, B and C.");
    assert.equal(describeDeletedElsewhere([]), null);
    assert.deepEqual(describeDeletedBanner(["Ballade No. 1"]), {
      title: "Ballade No. 1 was deleted on another device.",
      sub: "It's still on this device. Delete it here too, or keep it: it comes back in your account and on every device.",
    });
    assert.match(describeDeletedBanner(["A", "B"]).sub, /^They're still on this device\. Choose what to do with each one in Settings, under Account\.$/);
    assert.equal(describeDeletedBanner([]), null);
  });

  test("the banner warns before a one-click 'Delete it here too' would throw away changes the account never got", () => {
    // one piece: says what each button does to those changes
    const one = describeDeletedBanner(["Ballade No. 1"], { unsynced: true });
    assert.equal(one.title, "Ballade No. 1 was deleted on another device.");
    assert.equal(
      one.sub,
      "It's still on this device, and it has changes your account never got. If you delete it here too, those changes are lost. If you keep it, the piece comes back in your account and on every device, with those changes."
    );
    // several: says that some have them, and points to the list that shows which
    assert.equal(
      describeDeletedBanner(["A", "B"], { unsynced: true }).sub,
      "They're still on this device, and some have changes your account never got. Choose what to do with each one in Settings, under Account."
    );
    // nothing waiting: exactly the words as before, with or without the option
    assert.equal(describeDeletedBanner(["A"], { unsynced: false }).sub, describeDeletedBanner(["A"]).sub);
    assert.equal(describeDeletedBanner(["A", "B"], { unsynced: false }).sub, describeDeletedBanner(["A", "B"]).sub);
    assert.equal(/—/.test(JSON.stringify([one, describeDeletedBanner(["A", "B"], { unsynced: true })])), false, "no em dash");
  });

  test("what Keep it and Restore say, for each way it can end", () => {
    assert.deepEqual(describeBringBack({ status: "kept", name: "Etude" }), { text: "Kept Etude. It's back in your account, and it will reappear on your other devices." });
    assert.deepEqual(describeBringBack({ status: "kept", name: "Etude", restored: true }), { text: "Restored Etude. It's back on this device and in your account, and it will reappear on your other devices." });
    assert.deepEqual(describeBringBack({ status: "live", name: "Etude" }), { text: "Etude is already back in your account." });
    assert.deepEqual(describeBringBack({ status: "moved", name: "Etude" }), { text: "Etude changed in your account since you looked, so nothing was changed. Look again, then try once more.", problem: true });
    assert.deepEqual(describeBringBack({ status: "combined", name: "Etude" }), { text: "Etude was combined into another piece, so it can't be kept on its own.", problem: true });
    assert.deepEqual(describeBringBack({ status: "gone", name: "Etude" }), { text: "Etude is no longer in your account, so there is nothing to bring back.", problem: true });
    assert.deepEqual(describeBringBack({ status: "stopped", name: "Etude", reason: "connection" }), { text: `Nothing was changed. ${describeFetchProblem("connection")}`, problem: true });
    assert.equal(describeBringBack({ status: "gone" }).text.startsWith("This piece"), true, "no name: 'This piece'");
  });

  test("nothing in any of it has an em dash", () => {
    const all = [
      describeAutoUpdate({ names: ["A"], removed: ["B"] }),
      ...describeAutoRemoved([{ name: "E", lostSessions: 2 }, { name: "F", lostSessions: 0 }], "F").map((l) => l.text),
      describeDeletedElsewhere(["A"]),
      describeDeletedElsewhere(["A", "B"]),
      JSON.stringify(describeDeletedBanner(["A"])),
      JSON.stringify(describeDeletedBanner(["A", "B"])),
      ...["kept", "live", "moved", "combined", "gone", "stopped"].flatMap((status) => [describeBringBack({ status, name: "X", reason: "other" }).text, describeBringBack({ status, name: "X", restored: true }).text]),
    ];
    all.forEach((t) => assert.equal(/—/.test(t), false, t));
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 122b: what the person said no to is remembered, so the app    */
/*  never asks twice.                                                  */
/* ------------------------------------------------------------------ */

describe("things the person said no to are remembered on this device (Pass 122b)", () => {
  const emptyDevice = () => readDeviceRecord(memoryStorage());
  const recOf = (device) => accountRecordFor(device, USER);
  const named = (id, name, composer = "Chopin", extra = {}) => validateAndMigratePiece({ ...viaJson(pieceOf(id)), name, composer, ...extra });
  const candidatesOf = (...ps) => accountRowsToCandidates({ pieces: ps.map(([p, rev = 1]) => acctRow(p, rev)), technique: null });
  const planFor = ({ local = {}, candidates, device = emptyDevice() }) => planAccountMerge({ candidates, localPieces: local, localTechnique: null, accountRecord: recOf(device) });
  const kinds = (plan) => plan.items.map((i) => [i.id, i.kind]);

  test("nothing is remembered until something is said; it is per account", () => {
    const device = emptyDevice();
    assert.equal("declined" in recOf(device), false);
    assert.equal(declinedCount(recOf(device)), 0);
    const said = withDeclined(device, USER, { pieces: ["b"], pairs: [["x", "y"]] });
    assert.deepEqual(recOf(said).declined, { pieces: ["b"], pairs: [["x", "y"]] });
    assert.deepEqual(declinedSummary(recOf(said)), { pieces: 1, pairs: 1 });
    assert.equal(declinedCount(recOf(said)), 2);
    assert.equal("declined" in accountRecordFor(said, "someone-else"), false, "another account on this device has its own answers");
  });

  test("a pair is the same either way round, said once or twice, and never a piece with itself", () => {
    const said = withDeclined(emptyDevice(), USER, { pairs: [["b", "a"], ["a", "b"], ["a", "a"], ["", "z"]] });
    assert.deepEqual(recOf(said).declined, { pairs: [["a", "b"]] });
    assert.equal(isDeclinedPair(recOf(said), "a", "b"), true);
    assert.equal(isDeclinedPair(recOf(said), "b", "a"), true, "either way round");
    assert.equal(isDeclinedPair(recOf(said), "a", "c"), false);
    const again = withDeclined(said, USER, { pieces: ["p", "p", "q"], pairs: [["b", "a"]] });
    assert.deepEqual(recOf(again).declined, { pieces: ["p", "q"], pairs: [["a", "b"]] });
  });

  test("every kind of record update carries the answers over (a draft that forgot them would take them back)", () => {
    const p = pieceOf("p1");
    const rec = withDeclined(emptyDevice(), USER, { pieces: ["b"], pairs: [["x", "y"]] });
    const before = recOf(rec).declined;
    const after = [
      withPieceUploaded(rec, USER, "p1", syncedAs(p, 2), 5000),
      withSentRecorded(rec, USER, { kind: "piece", id: "p1" }, "abc"),
      withPieceHeld(rec, USER, "p1"),
      withAccountCopyRecorded(rec, USER, { entries: { p1: syncedAs(p, 3) }, checkedAt: 7 }),
      withBackupRecorded(rec, USER, { pieces: { p1: syncedAs(p) }, technique: null, checkedAt: 9 }),
      withTechniqueUploaded(rec, USER, { revision: 2, fingerprint: "f", parts: { a: "b" } }, 1),
      withTechniqueHeld(rec, USER),
      withPieceForgotten(rec, USER, "p1", 1),
      withPieceDropped(rec, USER, "p1"),
      withAutoUpdate(rec, USER, true),
      withAutoUpdate(withAutoUpdate(rec, USER, true), USER, false),
      reconcileLocalDeletions(withPieceUploaded(rec, USER, "p1", syncedAs(p), 1), { removedIds: ["p1"] }).record,
      withPartsRecorded(withPieceUploaded(rec, USER, "p1", { revision: 1, fingerprint: pieceFingerprint(p) }, 1), { p1: p }).record,
      withDeclined(rec, USER, { pieces: [] }),
    ];
    after.forEach((r, i) => assert.deepEqual(recOf(r).declined, before, `still there after update ${i}`));
  });

  test("it round-trips through storage; anything unreadable reads as nothing said", () => {
    const storage = memoryStorage();
    saveDeviceRecord(withDeclined(readDeviceRecord(storage), USER, { pieces: ["b"], pairs: [["y", "x"]] }), storage);
    assert.deepEqual(recOf(readDeviceRecord(storage)).declined, { pieces: ["b"], pairs: [["x", "y"]] });
    [
      "yes",
      { pieces: "b" },
      { pieces: [1, null, ""], pairs: [["a"], "ab", [1, 2], ["a", "a"]] },
      { pieces: [], pairs: [] },
      null,
    ].forEach((junk) => {
      storage.setItem(ACCOUNT_SYNC_KEY, JSON.stringify({ version: 1, accounts: { [USER]: { pieces: {}, technique: null, checkedAt: 1, syncedAt: null, declined: junk } } }));
      assert.equal("declined" in recOf(readDeviceRecord(storage)), false, JSON.stringify(junk));
    });
  });

  test("there is a cap, and the newest answers are the ones kept", () => {
    const many = Array.from({ length: MAX_DECLINED + 25 }, (_, i) => `piece-${i}`);
    const said = withDeclined(emptyDevice(), USER, { pieces: many });
    const kept = recOf(said).declined.pieces;
    assert.equal(kept.length, MAX_DECLINED);
    assert.equal(kept[kept.length - 1], `piece-${MAX_DECLINED + 24}`, "the newest is kept");
    assert.equal(kept.includes("piece-0"), false, "the oldest goes");
  });

  test("'Ask me again' forgets every answer and nothing else", () => {
    const p = pieceOf("p1");
    let device = withAutoUpdate(withAccountCopyRecorded(emptyDevice(), USER, { entries: { p1: syncedAs(p, 4) }, checkedAt: 7 }), USER, true);
    device = withDeclined(device, USER, { pieces: ["b"], pairs: [["x", "y"]] });
    const cleared = withDeclinedCleared(device, USER);
    assert.equal("declined" in recOf(cleared), false);
    assert.equal(declinedCount(recOf(cleared)), 0);
    const { declined, ...rest } = recOf(device);
    assert.deepEqual(recOf(cleared), rest, "pieces, the switch, the dates: untouched");
    assert.equal(withDeclinedCleared(emptyDevice(), USER).accounts[USER].pieces !== undefined, true, "clearing nothing is harmless");
  });

  test("asking for a piece by name (Keep it, Restore) beats an old no about it: its answers go, everything else stays", () => {
    const said = withDeclined(emptyDevice(), USER, { pieces: ["a", "b", "c"], pairs: [["a", "x"], ["y", "z"]] });
    const asked = withDeclinedRemoved(said, USER, ["a"]);
    assert.deepEqual(recOf(asked).declined, { pieces: ["b", "c"], pairs: [["y", "z"]] }, "the piece and the pair it was in");
    assert.deepEqual(recOf(withDeclinedRemoved(said, USER, ["x"])).declined, { pieces: ["a", "b", "c"], pairs: [["y", "z"]] }, "a pair goes whichever of the two is asked for");
    assert.equal("declined" in recOf(withDeclinedRemoved(withDeclined(emptyDevice(), USER, { pieces: ["a"] }), USER, ["a"])), false, "nothing left: nothing kept");
    assert.deepEqual(withDeclinedRemoved(emptyDevice(), USER, ["a"]).accounts[USER].pieces, {}, "nothing said: nothing happens");
    // and the walk then brings the piece in as the new piece it is
    const nocturne = named("a", "Nocturne");
    const candidates = candidatesOf([nocturne]);
    assert.deepEqual(kinds(planFor({ candidates, device: said })), [], "skipped while the no stands");
    assert.deepEqual(kinds(planFor({ candidates, device: asked })), [["a", "new"]], "offered once it is asked for");
  });

  /* ---- the window and the walk ---- */

  test("a piece the person left off is never offered, never brought in, never counted; the plan says so", () => {
    const a = named("A1", "Nocturne"), b = named("B1", "Etude");
    const device = withDeclined(emptyDevice(), USER, { pieces: ["B1"] });
    const candidates = candidatesOf([a], [b]);
    const plan = planFor({ candidates, device });
    assert.deepEqual(kinds(plan), [["A1", "new"]]);
    assert.deepEqual(plan.skippedDeclined.map((d) => d.id), ["B1"]);
    const applied = applyAccountMerge({ candidates, localPieces: {}, localTechnique: null, accountRecord: recOf(device), selectedIds: null, orderChoice: "follow" });
    assert.deepEqual(Object.keys(applied.pieces), ["A1"]);
    assert.equal(applied.leftOff, 1);
    // by itself, with the switch on, it is no different
    const auto = applyAccountMerge({ candidates, localPieces: {}, localTechnique: null, accountRecord: recOf(device), automatic: true });
    assert.deepEqual(Object.keys(auto.pieces), ["A1"]);
    // asking for it by name changes nothing either: it is not walked as a candidate
    const named1 = applyAccountMerge({ candidates, localPieces: {}, localTechnique: null, accountRecord: recOf(device), selectedIds: ["A1", "B1"] });
    assert.deepEqual(Object.keys(named1.pieces), ["A1"]);
  });

  test("a stale answer never hides a piece that IS here: it is an ordinary piece again", () => {
    const here = named("B1", "Etude");
    const newer = withMore(here, 2);
    const device = withAccountCopyRecorded(withDeclined(emptyDevice(), USER, { pieces: ["B1"] }), USER, { entries: { B1: syncedAs(here, 1) }, checkedAt: 1 });
    const plan = planFor({ local: { B1: here }, candidates: candidatesOf([newer, 2]), device });
    assert.deepEqual(kinds(plan), [["B1", "take"]]);
    assert.deepEqual(plan.skippedDeclined, []);
  });

  test("two pieces said to be different are never matched by name, either way round: the other copy is a new piece", () => {
    const here = named("L1", "Ballade No. 1"), there = named("R1", "ballade no. 1");
    const candidates = candidatesOf([there, 3]);
    assert.deepEqual(kinds(planFor({ local: { L1: here }, candidates })), [["R1", "combine"]], "as before");
    [[["L1", "R1"]], [["R1", "L1"]]].forEach((pairs) => {
      const device = withDeclined(emptyDevice(), USER, { pairs });
      const plan = planFor({ local: { L1: here }, candidates, device });
      assert.deepEqual(kinds(plan), [["R1", "new"]]);
      assert.equal(plan.items[0].matchId, null);
    });
    // a pair about other pieces changes nothing
    const other = withDeclined(emptyDevice(), USER, { pairs: [["L1", "somebody-else"]] });
    assert.deepEqual(kinds(planFor({ local: { L1: here }, candidates, device: other })), [["R1", "combine"]]);
  });

  test("two account rows with the same name: said different, both come in as pieces", () => {
    const a = named("A1", "Same Name"), b = named("B1", "Same Name");
    const candidates = candidatesOf([a], [b]);
    assert.deepEqual(kinds(planFor({ candidates })), [["A1", "new"], ["B1", "combine"]]);
    const device = withDeclined(emptyDevice(), USER, { pairs: [["B1", "A1"]] });
    assert.deepEqual(kinds(planFor({ candidates, device })), [["A1", "new"], ["B1", "new"]]);
    const out = applyAccountMerge({ candidates, localPieces: {}, localTechnique: null, accountRecord: recOf(device) });
    assert.deepEqual(Object.keys(out.pieces).sort(), ["A1", "B1"], "both are restored");
    assert.deepEqual(out.markDeleted, [], "nothing in the account is marked deleted");
  });

  test("the automatic update never combines a pair; one said to be different arrives as the new piece it is", () => {
    const here = named("L1", "Ballade No. 1"), there = named("R1", "Ballade No. 1");
    const candidates = candidatesOf([there, 3]);
    const device = withAccountCopyRecorded(emptyDevice(), USER, { entries: { L1: syncedAs(here, 1) }, checkedAt: 1 });
    const asks = applyAccountMerge({ candidates, localPieces: { L1: here }, localTechnique: null, accountRecord: recOf(device), automatic: true });
    assert.deepEqual(asks.needsYou.map((n) => [n.id, n.kind]), [["R1", "combine"]], "left for the person, as before");
    assert.deepEqual(Object.keys(asks.pieces), ["L1"]);
    const said = withDeclined(device, USER, { pairs: [["L1", "R1"]] });
    const out = applyAccountMerge({ candidates, localPieces: { L1: here }, localTechnique: null, accountRecord: recOf(said), automatic: true });
    assert.deepEqual(out.needsYou, [], "no longer asked about");
    assert.deepEqual(Object.keys(out.pieces).sort(), ["L1", "R1"]);
    assert.deepEqual(out.markDeleted, []);
  });

  test("a name match where either side has no composer says so; two composers that agree do not", () => {
    const certain = (composerHere, composerThere) => {
      const here = named("L1", "Ballade", composerHere), there = named("R1", "Ballade", composerThere);
      return planFor({ local: { L1: here }, candidates: candidatesOf([there, 3]) }).items[0];
    };
    assert.deepEqual([certain("Chopin", "Chopin").kind, certain("Chopin", "Chopin").uncertain], ["combine", false]);
    assert.deepEqual([certain("Chopin", "chopin ").kind, certain("Chopin", "chopin ").uncertain], ["combine", false], "same composer, however it is typed");
    assert.equal(certain("", "Chopin").uncertain, true, "this device's has none");
    assert.equal(certain("Chopin", "").uncertain, true, "the account's has none");
    assert.equal(certain("", "").uncertain, true, "neither has one");
    assert.equal(certain("  ", "Chopin").uncertain, true, "blanks are blank");
    // two different composers are not a match at all
    assert.equal(certain("Chopin", "Liszt").kind, "new");
  });

  test("a file import still matches by name exactly as before (the 'maybe' is the account's window only)", () => {
    const here = named("L1", "Ballade", "");
    const file = named("R1", "Ballade", "Chopin");
    assert.equal(findMatchingPiece({ L1: here }, file), here);
  });

  /* ---- what the ticks mean ---- */

  test("an unticked NEW row is a no; an unticked combine row says 'different pieces' (and the copy stays off); ticked rows and other kinds say nothing", () => {
    const items = [
      { id: "n1", kind: "new" },
      { id: "n2", kind: "new" },
      { id: "c1", kind: "combine", matchId: "L1" },
      { id: "c2", kind: "combine", matchId: "L2" },
      { id: "t1", kind: "take" },
      { id: "a1", kind: "ask" },
    ];
    const out = planDeclines({ items, selectedIds: ["n2", "c2"], mode: "changes" });
    assert.deepEqual(out, { pairs: [["L1", "c1"]], pieces: ["n1", "c1"], arrivingIds: [] }, "in Get changes the other copy also stays off, so no window opens for it again");
    assert.deepEqual(planDeclines({ items, selectedIds: items.map((i) => i.id), mode: "changes" }), { pairs: [], pieces: [], arrivingIds: [] });
    assert.deepEqual(planDeclines({ items: [], selectedIds: [] }), { pairs: [], pieces: [], arrivingIds: [] });
    assert.deepEqual(planDeclines({ items: null, selectedIds: null }), { pairs: [], pieces: [], arrivingIds: [] });
  });

  test("in a restore, an unticked copy arrives as its own piece when the one it would be combined with is coming too", () => {
    const items = [{ id: "A1", kind: "new" }, { id: "B1", kind: "combine", matchId: "A1" }];
    assert.deepEqual(planDeclines({ items, selectedIds: ["A1"], mode: "restore" }), { pairs: [["A1", "B1"]], pieces: [], arrivingIds: ["B1"] });
    assert.deepEqual(planDeclines({ items, selectedIds: ["A1", "B1"], mode: "restore" }), { pairs: [], pieces: [], arrivingIds: [] }, "ticked: combined, as before");
    assert.deepEqual(planDeclines({ items, selectedIds: [], mode: "restore" }), { pairs: [], pieces: ["A1", "B1"], arrivingIds: [] }, "neither is wanted: both left off, nothing arrives");
  });

  test("said and applied: the pair stays different, both copies stay off, nothing is offered again, and 'Ask me again' brings it all back", () => {
    const here = named("L1", "Ballade No. 1"), there = named("R1", "Ballade No. 1"), extra = named("N1", "Etude");
    const candidates = candidatesOf([there, 3], [extra, 1]);
    const first = planFor({ local: { L1: here }, candidates });
    assert.deepEqual(kinds(first), [["N1", "new"], ["R1", "combine"]].sort((x, y) => first.items.findIndex((i) => i.id === x[0]) - first.items.findIndex((i) => i.id === y[0])));
    const said = planDeclines({
      items: first.items.map((i) => ({ id: i.id, kind: i.kind, matchId: i.matchId })),
      selectedIds: [],
      mode: "changes",
    });
    const device = withDeclined(emptyDevice(), USER, said);
    const second = planFor({ local: { L1: here }, candidates, device });
    assert.deepEqual(kinds(second), [], "nothing is offered a second time: no window");
    assert.deepEqual(second.skippedDeclined.map((d) => d.id).sort(), ["N1", "R1"], "the etude and the other Ballade both stay off");
    assert.equal(planNeedsQuestion(second), false);
    const asked = withDeclinedCleared(device, USER);
    assert.deepEqual(kinds(planFor({ local: { L1: here }, candidates, device: asked })), first.items.map((i) => [i.id, i.kind]), "back to the very first plan");
  });

  /* ---- the check ---- */

  test("the check stops counting a piece the person said no to, and counts it again once they ask again", () => {
    const rows = { pieces: [{ id: "n1", revision: 1, deleted_at: null }, { id: "n2", revision: 1, deleted_at: null }], technique: null };
    const device = withAccountCopyRecorded(emptyDevice(), USER, { entries: {}, checkedAt: 1 });
    assert.deepEqual(classifyAccountChanges({ rows, accountRecord: recOf(device), localPieceIds: [] }).added, ["n1", "n2"]);
    const said = withDeclined(device, USER, { pieces: ["n2"] });
    const changes = classifyAccountChanges({ rows, accountRecord: recOf(said), localPieceIds: [] });
    assert.deepEqual(changes.added, ["n1"]);
    assert.equal(describeAccountChanges({ ...changes, added: [] }), null, "nothing left to mention");
    assert.deepEqual(autoUpdateTargets({ deviceRecord: withAutoUpdate(said, USER, true), userId: USER, changes }).pieceIds, ["n1"], "the automatic update does not fetch it");
    assert.deepEqual(classifyAccountChanges({ rows, accountRecord: recOf(withDeclinedCleared(said, USER)), localPieceIds: [] }).added, ["n1", "n2"]);
    // a pair changes nothing about the count (the check sees only ids, so a copy of a piece is a new row until the person answers about it)
    const pair = withDeclined(device, USER, { pairs: [["n1", "n2"]] });
    assert.deepEqual(classifyAccountChanges({ rows, accountRecord: recOf(pair), localPieceIds: [] }).added, ["n1", "n2"]);
  });

  test("a declined piece that is here is not 'added' anyway, and a held or deleted one is sorted as it always was", () => {
    const rows = { pieces: [{ id: "n1", revision: 4, deleted_at: null }], technique: null };
    const device = withDeclined(withAccountCopyRecorded(emptyDevice(), USER, { entries: { n1: { revision: 2, fingerprint: "f" } }, checkedAt: 1 }), USER, { pieces: ["n1"] });
    const changes = classifyAccountChanges({ rows, accountRecord: recOf(device), localPieceIds: ["n1"] });
    assert.deepEqual([changes.newer, changes.added], [["n1"], []]);
  });

  /* ---- piece order ---- */

  test("piece order follows the person: nobody is asked, and the rule is the same everywhere", () => {
    const base = pieceOf("p1", { sortOrder: 5 });
    const baseParts = piecePartFingerprints(base);
    const at = (n) => validateAndMigratePiece({ ...viaJson(base), sortOrder: n });
    assert.equal(orderChoiceFor({ existing: at(5), imported: at(5), baseParts }), "existing", "the same: nothing to choose");
    assert.equal(orderChoiceFor({ existing: at(2), imported: at(5), baseParts }), "existing", "only this device reordered: kept");
    assert.equal(orderChoiceFor({ existing: at(5), imported: at(2), baseParts }), "imported", "only the account reordered: followed");
    assert.equal(orderChoiceFor({ existing: at(2), imported: at(7), baseParts }), "imported", "both: the account's order");
    assert.equal(orderChoiceFor({ existing: at(2), imported: at(7), baseParts: null }), "imported", "no base to tell: the account's order");
    assert.equal(orderChoiceFor({ existing: at(2), imported: at(7), baseParts: { name: "x" } }), "imported", "a base with no order in it: the account's");
    assert.equal(orderChoiceFor({ existing: at(2), imported: at(7), baseParts, kind: "combine" }), "existing", "two copies combined keep the place of the one that is here");
  });

  test("the more recent reorder wins: the dated note a drag leaves decides which side's rank is followed", () => {
    const base = pieceOf("p1", { sortOrder: 5 });
    const baseParts = piecePartFingerprints(base);
    const note = (at, ...ids) => ({ at, ids });
    const at = (n, noted) => validateAndMigratePiece({ ...viaJson(base), sortOrder: n, ...(noted ? { switcherOrder: noted } : {}) });
    assert.equal(orderChoiceFor({ existing: at(2, note(200, "p1")), imported: at(7, note(100, "p1")), baseParts }), "existing", "both reordered, this device's note is later: kept (it used to be the account's)");
    assert.equal(orderChoiceFor({ existing: at(2, note(100, "p1")), imported: at(7, note(200, "p1")), baseParts }), "imported", "both reordered, the account's note is later: followed");
    assert.equal(orderChoiceFor({ existing: at(2), imported: at(7, note(100, "p1")), baseParts }), "imported", "only the account's has a note: a rank with no note is dated by nothing");
    assert.equal(orderChoiceFor({ existing: at(2, note(100, "p1")), imported: at(7), baseParts }), "existing", "only this device's has a note");
    assert.equal(orderChoiceFor({ existing: at(2, note(100, "p1")), imported: at(7, note(100, "p1")), baseParts }), "imported", "the same note on both: the earlier rules, so the account's");
    assert.equal(orderChoiceFor({ existing: at(2, note(900, "p1")), imported: at(7, note(100, "p1")), baseParts, kind: "combine" }), "existing", "two copies combined keep the place of the one that is here, whatever the notes say");
    assert.equal(orderChoiceFor({ existing: at(2), imported: at(7), baseParts }), "imported", "no notes anywhere: exactly as before");
  });

  test("the more recent reorder wins through the real apply step: Get changes and the automatic update agree, and the note travels", () => {
    const base = pieceOf("p1", { sortOrder: 5 });
    const note = (at, ...ids) => ({ at, ids });
    const device = withAccountCopyRecorded(emptyDevice(), USER, { entries: { p1: syncedAs(base, 1) }, checkedAt: 1 });
    const make = (more, order, noted) => validateAndMigratePiece({ ...viaJson(more), sortOrder: order, ...(noted ? { switcherOrder: noted } : {}) });
    // different things changed on each side (so the automatic update merges them by part, no real conflict)
    const mineMore = validateAndMigratePiece({ ...viaJson(base), name: "Mine", updatedAt: 2000 });
    const theirsMore = validateAndMigratePiece({ ...viaJson(base), notes: "Theirs", updatedAt: 3000 });
    const run = (mine, theirs, automatic) =>
      applyAccountMerge({
        candidates: candidatesOf([theirs, 2]),
        localPieces: { p1: mine },
        localTechnique: null,
        accountRecord: recOf(device),
        selectedIds: ["p1"],
        orderChoice: "follow",
        automatic,
      });
    [false, true].forEach((automatic) => {
      const tag = automatic ? "automatic" : "Get changes";
      let out = run(make(mineMore, 1, note(200, "p1", "p2")), make(theirsMore, 2, note(100, "p2", "p1")), automatic);
      assert.deepEqual([out.pieces.p1.sortOrder, out.pieces.p1.switcherOrder], [1, note(200, "p1", "p2")], `${tag}: this device reordered last, so its order is kept`);
      out = run(make(mineMore, 1, note(100, "p1", "p2")), make(theirsMore, 2, note(200, "p2", "p1")), automatic);
      assert.deepEqual([out.pieces.p1.sortOrder, out.pieces.p1.switcherOrder], [2, note(200, "p2", "p1")], `${tag}: the other device reordered last, so its order is followed`);
      out = run(make(mineMore, 1), make(theirsMore, 2, note(100, "p2", "p1")), automatic);
      assert.deepEqual([out.pieces.p1.sortOrder, out.pieces.p1.switcherOrder], [2, note(100, "p2", "p1")], `${tag}: only the other has a note`);
      out = run(make(mineMore, 1, note(100, "p1", "p2")), make(theirsMore, 2), automatic);
      assert.deepEqual([out.pieces.p1.sortOrder, out.pieces.p1.switcherOrder], [1, note(100, "p1", "p2")], `${tag}: only this device has a note`);
      out = run(make(mineMore, 1), make(theirsMore, 2), automatic);
      assert.deepEqual([out.pieces.p1.sortOrder, "switcherOrder" in out.pieces.p1], [2, false], `${tag}: no note anywhere: the account's order, and no note appears`);
      assert.equal(out.counts.merged.length, 1, `${tag}: merged, with no question`);
    });
  });

  test("a new piece from the account arrives with its note, and a clean newer copy brings the account's", () => {
    const noted = pieceOf("n1", { sortOrder: 2, switcherOrder: { at: 50, ids: ["n1", "p1"] } });
    const fresh = applyAccountMerge({ candidates: candidatesOf([noted, 1]), localPieces: {}, localTechnique: null, accountRecord: recOf(emptyDevice()), selectedIds: null, orderChoice: "follow" });
    assert.deepEqual(fresh.pieces.n1.switcherOrder, { at: 50, ids: ["n1", "p1"] });
    const base = pieceOf("p1", { sortOrder: 5 });
    const theirs = validateAndMigratePiece({ ...viaJson(withMore(base, 2)), sortOrder: 1, switcherOrder: { at: 60, ids: ["p1", "n1"] } });
    const device = withAccountCopyRecorded(emptyDevice(), USER, { entries: { p1: syncedAs(base, 1) }, checkedAt: 1 });
    const took = applyAccountMerge({ candidates: candidatesOf([theirs, 2]), localPieces: { p1: base }, localTechnique: null, accountRecord: recOf(device), selectedIds: ["p1"], orderChoice: "follow" });
    assert.equal(took.counts.took.length, 1, "nothing waiting here: taken as it is");
    assert.deepEqual(took.pieces.p1.switcherOrder, { at: 60, ids: ["p1", "n1"] });
  });

  test("two copies being combined: the piece that is here keeps its own note, and the other copy's note (which lists the other copy's id) is not brought in", () => {
    const run = (hereNote, thereNote) => {
      const here = named("L1", "Ballade No. 1", "Chopin", { sortOrder: 3, ...(hereNote ? { switcherOrder: hereNote } : {}) });
      const there = named("R1", "Ballade No. 1", "Chopin", { sortOrder: 9, ...(thereNote ? { switcherOrder: thereNote } : {}) });
      return applyAccountMerge({
        candidates: candidatesOf([there, 3]),
        localPieces: { L1: here },
        localTechnique: null,
        accountRecord: recOf(withAccountCopyRecorded(emptyDevice(), USER, { entries: { L1: syncedAs(here, 1) }, checkedAt: 1 })),
        selectedIds: ["R1"],
        orderChoice: "follow",
      }).pieces.L1;
    };
    assert.deepEqual(run({ at: 10, ids: ["L1"] }, { at: 99, ids: ["R1"] }).switcherOrder, { at: 10, ids: ["L1"] });
    assert.equal("switcherOrder" in run(null, { at: 99, ids: ["R1"] }), false, "none here, one there: none");
    assert.equal(run({ at: 10, ids: ["L1"] }, null).sortOrder, 3);
  });

  test("a piece changed in both places is merged with the order followed, not asked: through the real apply step", () => {
    const base = pieceOf("p1", { sortOrder: 5 });
    const mineMore = validateAndMigratePiece({ ...viaJson(withMore(base, 2)), sortOrder: 5 });
    const theirsMore = validateAndMigratePiece({ ...viaJson(withMore(base, 3)), sortOrder: 5 });
    const device = withAccountCopyRecorded(emptyDevice(), USER, { entries: { p1: syncedAs(base, 1) }, checkedAt: 1 });
    const run = (mineOrder, theirOrder) =>
      applyAccountMerge({
        candidates: candidatesOf([validateAndMigratePiece({ ...viaJson(theirsMore), sortOrder: theirOrder }), 2]),
        localPieces: { p1: validateAndMigratePiece({ ...viaJson(mineMore), sortOrder: mineOrder }) },
        localTechnique: null,
        accountRecord: recOf(device),
        selectedIds: ["p1"],
        orderChoice: "follow",
      });
    assert.equal(run(5, 2).pieces.p1.sortOrder, 2, "the other device reordered: this one follows");
    assert.equal(run(1, 5).pieces.p1.sortOrder, 1, "only this device reordered: kept");
    assert.equal(run(1, 2).pieces.p1.sortOrder, 2, "both: the account's");
    assert.equal(run(1, 2).counts.merged.length, 1, "and it was a merge, with no question");
    // the old explicit choices still mean what they meant (the file import path and any caller that passes one)
    const explicit = applyAccountMerge({
      candidates: candidatesOf([validateAndMigratePiece({ ...viaJson(theirsMore), sortOrder: 2 }), 2]),
      localPieces: { p1: validateAndMigratePiece({ ...viaJson(mineMore), sortOrder: 1 }) },
      localTechnique: null,
      accountRecord: recOf(device),
      selectedIds: ["p1"],
      orderChoice: "existing",
    });
    assert.equal(explicit.pieces.p1.sortOrder, 1);
  });

  test("two copies being combined: the piece that is here keeps its place", () => {
    const here = named("L1", "Ballade No. 1", "Chopin", { sortOrder: 3 });
    const there = named("R1", "Ballade No. 1", "Chopin", { sortOrder: 9 });
    const out = applyAccountMerge({
      candidates: candidatesOf([there, 3]),
      localPieces: { L1: here },
      localTechnique: null,
      accountRecord: recOf(withAccountCopyRecorded(emptyDevice(), USER, { entries: { L1: syncedAs(here, 1) }, checkedAt: 1 })),
      selectedIds: ["R1"],
      orderChoice: "follow",
    });
    assert.equal(out.pieces.L1.sortOrder, 3);
  });

  /* ---- a piece held because an upload was refused ---- */

  test("a piece held by a refused upload that still knows what it last synced is asked about like any held piece", () => {
    const base = pieceOf("p2", { notes: "" });
    const device = withPieceHeld(withAccountCopyRecorded(emptyDevice(), USER, { entries: { p2: syncedAs(base, 1) }, checkedAt: 1 }), USER, "p2");
    const rec = recOf(device);
    assert.deepEqual(heldIdsWithConflicts(rec), [], "no recorded list of conflicts");
    assert.deepEqual(heldIdsToSettle(rec), ["p2"], "but it knows its base");
    const NOW = Date.parse("2026-10-19T12:00:00Z");
    // changed on the other device only: nothing to ask, ready to bring up to date
    const ready = planSettle({ candidates: candidatesOf([validateAndMigratePiece({ ...viaJson(base), name: "Other" }), 2]), localPieces: { p2: base }, accountRecord: rec, now: NOW });
    assert.deepEqual(ready.items.map((i) => [i.id, i.status]), [["p2", "ready"]]);
    assert.deepEqual(ready.fallbackIds, []);
    // the same thing changed on both: one question, about that
    const mine = validateAndMigratePiece({ ...viaJson(base), notes: "mine" });
    const theirs = validateAndMigratePiece({ ...viaJson(base), notes: "theirs" });
    const asked = planSettle({ candidates: candidatesOf([theirs, 2]), localPieces: { p2: mine }, accountRecord: rec, now: NOW });
    assert.deepEqual(asked.items.map((i) => [i.id, i.status]), [["p2", "questions"]]);
    assert.deepEqual(asked.items[0].questions.map((q) => q.part), ["notes"]);
    // the answer is applied through the one apply step, and settles it
    const out = applyAccountMerge({
      candidates: candidatesOf([theirs, 2]),
      localPieces: { p2: mine },
      localTechnique: null,
      accountRecord: rec,
      selectedIds: ["p2"],
      settle: { p2: { notes: "remote" } },
    });
    assert.deepEqual(out.settledIds, ["p2"]);
    assert.equal(out.pieces.p2.notes, "theirs");
    assert.deepEqual(out.unsettled, []);
    assert.equal(out.entries.p2.revision, 2, "the account's copy is what the record holds now");
  });

  test("a held piece with NO recorded base (a first upload refused, an import) still goes through the whole-piece picker", () => {
    const device = withPieceHeld({ version: 1, accounts: { [USER]: autoRec({}) } }, USER, "p3");
    assert.deepEqual(heldIdsToSettle(recOf(device)), []);
    const plan = planSettle({ candidates: candidatesOf([pieceOf("p3", { name: "Other" }), 2]), localPieces: { p3: pieceOf("p3") }, accountRecord: recOf(device), now: Date.now() });
    assert.deepEqual([plan.items, plan.fallbackIds], [[], []]);
    // one held WITH a list is asked about, exactly as before
    const listed = withPieceHeld(withAccountCopyRecorded(emptyDevice(), USER, { entries: { p4: syncedAs(pieceOf("p4"), 1) }, checkedAt: 1 }), USER, "p4", [{ part: "notes", kind: "field", local: "a", remote: "b", base: "c" }]);
    assert.deepEqual(heldIdsToSettle(recOf(listed)), ["p4"]);
    // and an entry that is not held at all is never planned
    assert.deepEqual(heldIdsToSettle(recOf(withAccountCopyRecorded(emptyDevice(), USER, { entries: { p5: syncedAs(pieceOf("p5"), 1) }, checkedAt: 1 }))), []);
  });

  /* ---- the words ---- */

  test("what a row says, what unticked means, and what stayed off: plain words, singular and plural, no em dashes", () => {
    const all = [
      describeUntickedNote("changes"),
      describeUntickedNote("restore"),
      describeCombineRow({ matchName: "Ballade No. 1" }),
      describeCombineRow({ matchName: "Ballade No. 1", mode: "restore" }),
      describeCombineRow({ matchName: "Ballade No. 1", uncertain: true }),
      describeCombineRow({ matchName: "Ballade No. 1", uncertain: true, mode: "restore" }),
      describeCombineRow({}),
      describeCombineBadge(true),
      describeCombineBadge(false),
      describeLeftOff(1),
      describeLeftOff(3),
      describeAskMeAgainHint({ pieces: 1, pairs: 0 }),
      describeAskMeAgainHint({ pieces: 2, pairs: 0 }),
      describeAskMeAgainHint({ pieces: 0, pairs: 1 }),
      describeAskMeAgainHint({ pieces: 0, pairs: 2 }),
      describeAskMeAgainHint({ pieces: 2, pairs: 1 }),
      ...describeAskMeAgain({ cleared: true }).map((l) => l.text),
      ...describeAskMeAgain({ cleared: false }).map((l) => l.text),
      ASK_ME_AGAIN_LABEL,
    ];
    all.forEach((t) => assert.equal(t.includes("—"), false, `no em dash: ${t}`));
    assert.match(describeCombineRow({ matchName: "Ballade No. 1" }), /Ticked: they're combined.*not erased.*Unticked: they're different pieces, and this one stays off this device\./);
    assert.match(describeCombineRow({ matchName: "Ballade No. 1", mode: "restore" }), /Unticked: they're different pieces, so both are restored/);
    assert.match(describeCombineRow({ matchName: "Ballade No. 1", uncertain: true }), /Maybe the same piece.*no composer.*Left unticked, they're different pieces, and this one stays off this device\./);
    assert.equal(describeCombineBadge(true), "Maybe the same piece");
    assert.equal(describeCombineBadge(false), "Same piece, other copy");
    assert.match(describeCombineRow({}), /"this piece"/);
    assert.match(describeLeftOff(1), /^1 piece you said no to stays off this device\..*brings it back\.$/);
    assert.match(describeLeftOff(3), /^3 pieces you said no to stay off this device\..*brings them back\.$/);
    assert.match(describeAskMeAgainHint({ pieces: 1, pairs: 0 }), /^You said no to 1 piece, so it's left off this device and not mentioned\./);
    assert.match(describeAskMeAgainHint({ pieces: 2, pairs: 0 }), /^You said no to 2 pieces, so they're left off/);
    assert.match(describeAskMeAgainHint({ pieces: 0, pairs: 1 }), /^You said 1 pair of pieces is different, so the app doesn't offer to combine them\./);
    assert.match(describeAskMeAgainHint({ pieces: 0, pairs: 2 }), /^You said 2 pairs of pieces are different, so the app doesn't offer to combine any of them\./);
    assert.match(describeAskMeAgainHint({ pieces: 2, pairs: 1 }), /^You said no to 2 pieces, and that 1 pair of pieces is different\./);
    assert.equal(ASK_ME_AGAIN_LABEL, "Ask me again about what I said no to");
    assert.match(describeUntickedNote("changes"), /^A piece you leave unticked stays off this device.*Ask me again/);
    assert.match(describeUntickedNote("restore"), /isn't restored.*Ask me again/);
  });

  test("a result that left something off says so after 'everything matches', and says nothing when nothing was left off", () => {
    const counts = { added: 0, took: [], merged: [], combined: [], same: 0, aligned: 0, clearedHeld: 0 };
    const quiet = describeAccountMergeResult({ applied: counts });
    assert.deepEqual(quiet.map((l) => l.text), ["Everything here already matches your account."]);
    const left = describeAccountMergeResult({ applied: counts, leftOff: 2 });
    assert.deepEqual(left.map((l) => l.text), ["Everything here already matches your account.", describeLeftOff(2)]);
    const added = describeAccountMergeResult({ applied: { ...counts, added: 1 }, leftOff: 1 });
    assert.deepEqual(added.map((l) => l.text), ["Added 1 new piece from your account.", describeLeftOff(1)]);
    // a restore is offered where there is no Settings, so it says how to choose again there
    const restored = describeAccountMergeResult({ mode: "restore", applied: { ...counts, added: 2 }, leftOff: 2 });
    assert.equal(restored[restored.length - 1].text, describeLeftOff(2, "restore"));
    assert.match(describeLeftOff(1, "restore"), /^1 piece you said no to was not restored\. Press Restore again, or use "Ask me again" in Settings, under Account, to choose again\.$/);
    assert.match(describeLeftOff(2, "restore"), /^2 pieces you said no to were not restored\./);
    assert.equal(describeLeftOff(2, "restore").includes("\u2014"), false);
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 126: the most recent change wins, and says so quietly         */
/* ------------------------------------------------------------------ */

describe("a piece changed on both devices that the more recent change can settle is merged by itself (Pass 126)", () => {
  const base = pieceOf("p1", { name: "Etude", targetBPM: 100 });
  // a change made at `at` (the piece's updatedAt), with the dated note updatePiece would write
  const changed = (p, patch, at, notes) =>
    validateAndMigratePiece({ ...viaJson(p), ...patch, updatedAt: at, ...(notes ? { settingTimes: { ...((p.settingTimes) || {}), ...notes } } : {}) });
  const rec = autoRec({ p1: syncedAs(base) });

  test("the later change wins and nothing is held: it used to be a conflict that waited for Review", () => {
    const mine = changed(base, { targetBPM: 120 }, 5000, { targetBPM: 4000 });
    const theirs = changed(base, { targetBPM: 140, name: "Etude in C" }, 6000, { targetBPM: 5500, name: 5500 });
    const out = runAuto({ local: { p1: mine }, rows: [[theirs, 2]], record: rec });
    assert.deepEqual(out.held, []);
    assert.equal(out.pieces.p1.targetBPM, 140);
    assert.equal(out.pieces.p1.name, "Etude in C");
    assert.deepEqual(out.counts.merged, ["Etude in C"], "the piece is named as it reads after the merge");
    assert.deepEqual(out.recency, [{ id: "p1", name: "Etude in C", parts: [{ part: "targetBPM", side: "remote" }] }]);
    assert.ok(out.entries.p1, "the account's copy is recorded, so what this device holds beyond it goes up as an ordinary change");
  });

  test("when the name itself is what the clock settled, the piece is named as it reads after the merge (found in the browser)", () => {
    const mine = changed(base, { name: "Etude (phone)" }, 6000, { name: 5500 });
    const theirs = changed(base, { name: "Etude (laptop)" }, 5000, { name: 4000 });
    const out = runAuto({ local: { p1: mine }, rows: [[theirs, 2]], record: rec });
    assert.equal(out.pieces.p1.name, "Etude (phone)");
    assert.deepEqual(out.recency, [{ id: "p1", name: "Etude (phone)", parts: [{ part: "name", side: "local" }] }], "not the account's old 'Etude (laptop)'");
    assert.deepEqual(out.names.merged, ["Etude (phone)"]);
  });

  test("this device's change wins when it is the later one, and is still reported (from this device)", () => {
    const mine = changed(base, { targetBPM: 120 }, 8000, { targetBPM: 7500 });
    const theirs = changed(base, { targetBPM: 140 }, 6000, { targetBPM: 5500 });
    const out = runAuto({ local: { p1: mine }, rows: [[theirs, 2]], record: rec });
    assert.equal(out.pieces.p1.targetBPM, 120);
    assert.deepEqual(out.recency[0].parts, [{ part: "targetBPM", side: "local" }]);
    assert.notEqual(pieceFingerprint(out.pieces.p1), out.entries.p1.fingerprint, "and it goes up: the account still holds the other value");
  });

  test("a tie is still held, with the part named, and nothing is reported as settled", () => {
    const mine = changed(base, { targetBPM: 120 }, 5000, { targetBPM: 4000 });
    const theirs = changed(base, { targetBPM: 140 }, 5000, { targetBPM: 4000 });
    const out = runAuto({ local: { p1: mine }, rows: [[theirs, 2]], record: rec });
    assert.deepEqual(out.held.map((h) => [h.id, h.conflicts.map((c) => c.part)]), [["p1", ["targetBPM"]]]);
    assert.deepEqual(out.recency, []);
    assert.equal(out.pieces.p1, mine, "this device's copy untouched");
  });

  test("a collection both devices changed is still held, however much later the other one was", () => {
    const mine = changed(base, { recordings: [{ id: "r1", label: "A", url: "https://example.test/a" }] }, 5000);
    const theirs = changed(base, { recordings: [{ id: "r2", label: "B", url: "https://example.test/b" }] }, 9000);
    const out = runAuto({ local: { p1: mine }, rows: [[theirs, 2]], record: rec });
    assert.deepEqual(out.held.map((h) => h.conflicts.map((c) => c.part)), [["recordings"]]);
  });

  test("a mix: the setting is settled by the clock, the collection is held, and the piece is held whole until the person answers", () => {
    const mine = changed(base, { targetBPM: 120, recordings: [{ id: "r1", label: "A", url: "https://example.test/a" }] }, 5000, { targetBPM: 4000 });
    const theirs = changed(base, { targetBPM: 140, recordings: [{ id: "r2", label: "B", url: "https://example.test/b" }] }, 6000, { targetBPM: 5500 });
    const out = runAuto({ local: { p1: mine }, rows: [[theirs, 2]], record: rec });
    assert.deepEqual(out.held.map((h) => h.conflicts.map((c) => c.part)), [["recordings"]], "only what the clock cannot settle is asked");
    assert.equal(out.pieces.p1, mine, "nothing is applied until it is answered");
  });

  test("practice logged on both devices is merged by itself and is never held", () => {
    const out = runAuto({ local: { p1: logOn(base, "c5", 3) }, rows: [[logOn(base, "c5", 4), 2]], record: rec });
    assert.deepEqual(out.held, []);
    assert.equal(out.pieces.p1.progress.c5.sessions.length, 2, "both devices' sessions");
    assert.deepEqual(out.recency, [], "nothing to say: practice is not settled by a clock");
  });

  test("Review's questions only name what the clock cannot settle", () => {
    const mine = changed(base, { targetBPM: 120, recordings: [{ id: "r1", label: "A", url: "https://example.test/a" }] }, 5000, { targetBPM: 4000 });
    const theirs = changed(base, { targetBPM: 140, recordings: [{ id: "r2", label: "B", url: "https://example.test/b" }] }, 6000, { targetBPM: 5500 });
    const q = buildSettleQuestions({ plan: planPieceMerge({ local: mine, remote: theirs, base: piecePartFingerprints(base) }), piece: mine });
    assert.deepEqual(q.map((x) => x.part), ["recordings"]);
  });
});

describe("two devices that hold the same values with different times do not trade the piece (Pass 126)", () => {
  test("after the automatic update nothing is waiting, on either device, however the times differ", () => {
    const base = pieceOf("p1", { name: "Etude" });
    const mk = (updatedAt, notes) => validateAndMigratePiece({ ...viaJson(base), name: "Same", updatedAt, ...(notes ? { settingTimes: notes } : {}) });
    const a = mk(2000, { name: 1500 });
    const b = mk(3000, { name: 2500 });
    const record = autoRec({ p1: syncedAs(base) });
    [[a, b], [b, a]].forEach(([local, account], i) => {
      const out = runAuto({ local: { p1: local }, rows: [[account, 2]], record });
      assert.deepEqual([out.held, out.needsYou], [[], []], `device ${i}`);
      const after = { ...record, pieces: { ...record.pieces, ...out.entries } };
      assert.equal(computeWaiting({ pieces: out.pieces, technique: null, accountRecord: after }).count, 0, `device ${i}: nothing waiting, so it does not upload and the other device does not either`);
    });
  });

  test("a piece the account has not moved on from (local-only) still has its own changes waiting", () => {
    const base = pieceOf("p1", { name: "Etude" });
    const mine = validateAndMigratePiece({ ...viaJson(base), name: "Mine", updatedAt: 5000, settingTimes: { name: 4000 } });
    const out = runAuto({ local: { p1: mine }, rows: [[base, 1]], record: autoRec({ p1: syncedAs(base) }) });
    const after = { ...autoRec({ p1: syncedAs(base) }), pieces: { p1: out.entries.p1 } };
    assert.equal(computeWaiting({ pieces: out.pieces, technique: null, accountRecord: after }).count, 1);
  });
});

describe("the quiet line: what the more recent change settled, and from which device (Pass 126)", () => {
  test("one piece: what was kept for each setting, and from which device", () => {
    assert.equal(
      describeRecencySettled({ pieces: [{ name: "Ballade No. 1", parts: [{ part: "targetBPM", side: "remote" }, { part: "notes", side: "local" }] }] }),
      "Kept the more recent change on Ballade No. 1: target tempo (from your other device) and notes (from this device)."
    );
    assert.equal(describeRecencySettled({ pieces: [{ name: "Etude", parts: [{ part: "status", side: "local" }] }] }), "Kept the more recent change on Etude: status (from this device).");
  });

  test("several pieces: named, not itemised; more than a few settings: the first ones and a count", () => {
    assert.equal(
      describeRecencySettled({ pieces: [{ name: "Etude", parts: [{ part: "name", side: "remote" }] }, { name: "Nocturne", parts: [{ part: "name", side: "remote" }] }, { name: "Ballade", parts: [{ part: "name", side: "local" }] }] }),
      "Kept the more recent change on Etude, Nocturne and Ballade."
    );
    const many = ["name", "composer", "notes", "status", "targetBPM", "targetDate"].map((part) => ({ part, side: "remote" }));
    assert.match(describeRecencySettled({ pieces: [{ name: "Etude", parts: many }] }), /^Kept the more recent change on Etude: name \(from your other device\), composer \(from your other device\), notes \(from your other device\), status \(from your other device\) and 2 more\.$/);
  });

  test("the technique library: which part, and from which device; both lines when both changed", () => {
    const notices = [
      { kind: "kept-more-recent", side: "remote", title: "D major" },
      { kind: "kept-more-recent", side: "local", title: "the number of scales a day" },
      { kind: "kept-other-device", title: "ignored: not a more-recent kind" },
    ];
    assert.equal(describeRecencySettled({ technique: notices }), "Kept the more recent change in the technique library: D major (from your other device) and the number of scales a day (from this device).");
    assert.equal(
      describeRecencySettled({ pieces: [{ name: "Etude", parts: [{ part: "name", side: "remote" }] }], technique: notices.slice(0, 1) }),
      "Kept the more recent change on Etude: name (from your other device). Kept the more recent change in the technique library: D major (from your other device)."
    );
  });

  test("nothing settled: no line at all (and no em dash in any wording)", () => {
    assert.equal(describeRecencySettled(), null);
    assert.equal(describeRecencySettled({ pieces: [], technique: [] }), null);
    assert.equal(describeRecencySettled({ pieces: [{ name: "Etude", parts: [] }] }), null);
    const text = describeRecencySettled({ pieces: [{ name: "Etude", parts: [{ part: "status", side: "remote" }] }], technique: [{ kind: "kept-more-recent", side: "local", title: "D major" }] });
    assert.equal(/—/.test(text), false);
  });

  test("a field with no label of its own still reads as words", () => {
    assert.equal(describeRecencySettled({ pieces: [{ name: "Etude", parts: [{ part: "fooBarBaz", side: "remote" }] }] }), "Kept the more recent change on Etude: foo bar baz (from your other device).");
  });
});

describe("the technique library after an automatic update says what the more recent change kept (Pass 126)", () => {
  const scale = (id, tonic, over = {}) => normalizeTechniqueItem({ id, form: "scale", tonic, quality: "major", octaves: 2, hands: "together", ...over });
  const lib = (over = {}) => validateAndMigrateTechnique({ schemaVersion: 1, items: [scale("c", "C"), scale("d", "D")], settings: { scalesPerDay: 3, minutesPerScale: 5 }, updatedAt: 100, ...over });
  const base = lib();
  const baseParts = techniquePartFingerprints(base);

  test("octaves changed on both: the later one is kept, whichever side it was, and the notice names the side", () => {
    const withOctaves = (n) => base.items.map((it) => (it.id === "c" ? normalizeTechniqueItem({ ...it, octaves: n }) : it));
    const mine = lib({ items: withOctaves(3), updatedAt: 500, partTimes: { "octaves:c": 400 } });
    const theirs = lib({ items: withOctaves(4), updatedAt: 300, partTimes: { "octaves:c": 300 } });
    const here = planTechniqueFromAccount(mine, theirs, baseParts);
    assert.equal(here.technique.items.find((i) => i.id === "c").octaves, 3, "this device's was later");
    assert.deepEqual(here.notices.map((n) => [n.kind, n.side, n.title]), [["kept-more-recent", "local", "C major"]]);
    const there = planTechniqueFromAccount(theirs, mine, baseParts);
    assert.equal(there.technique.items.find((i) => i.id === "c").octaves, 3);
    assert.deepEqual(there.notices.map((n) => [n.kind, n.side]), [["kept-more-recent", "remote"]]);
  });

  test("with no base recorded it is the import merge, which never asks and has nothing to report", () => {
    const out = planTechniqueFromAccount(lib(), lib({ settings: { scalesPerDay: 4, minutesPerScale: 5 } }), null);
    assert.deepEqual(out.notices, []);
  });

  test("applyAccountMerge carries the notices for the quiet line, only the more-recent kind", () => {
    const mine = lib({ settings: { scalesPerDay: 4, minutesPerScale: 5 }, updatedAt: 500, partTimes: { "setting:scalesPerDay": 450 } });
    const theirs = lib({ settings: { scalesPerDay: 2, minutesPerScale: 5 }, updatedAt: 300, partTimes: { "setting:scalesPerDay": 250 } });
    const out = applyAccountMerge({
      candidates: accountRowsToCandidates({ pieces: [], technique: { data: reorder(viaJson(theirs)), revision: 2 } }),
      localPieces: {},
      localTechnique: mine,
      accountRecord: { pieces: {}, technique: { revision: 1, fingerprint: "x", parts: baseParts }, checkedAt: 1, syncedAt: null },
      automatic: true,
    });
    assert.equal(out.technique.value.settings.scalesPerDay, 4);
    assert.deepEqual(out.technique.notices.map((n) => [n.side, n.title]), [["local", "the number of scales a day"]]);
  });
});
