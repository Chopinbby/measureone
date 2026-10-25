/* ------------------------------------------------------------------ */
/*  The account copy: a first backup, checked by reading it back       */
/*  (Pass 110), then kept current by itself (Pass 111).                */
/*  docs/Accounts-and-Backend.md, Design A to F and J.                 */
/*                                                                     */
/*  No React here. The Supabase client comes only from loadBackend()   */
/*  (lib/backend.js), so the library is still downloaded on demand.    */
/*  Every function that talks to the account takes the client as its   */
/*  first argument, so a test can hand it a fake.                      */
/*                                                                     */
/*  The first backup (Pass 110) only ever ADDS rows: a row that's      */
/*  already there is compared and reported, never overwritten. The     */
/*  automatic upload (Pass 111, the last section) changes a row only   */
/*  through changePieceRow / changeTechniqueRow, "save only if still   */
/*  at revision N" (Design C), and a piece deleted here is marked      */
/*  deleted, never erased (Design D). A refusal is never retried: the  */
/*  piece is held until the person settles it (Pass 112, the last      */
/*  section: restore, "Get changes", and Review, all one flow that     */
/*  hands the account's rows to the import path's own merge functions).*/
/*  The one exception is a deletion (Pass 122): it wins over practice  */
/*  logged on another device, so a refused deletion is tried once more */
/*  against the newer revision.                                        */
/* ------------------------------------------------------------------ */

import { loadBackend, isConnectionProblem, NO_CONNECTION_MESSAGE } from "./backend";
import {
  validateAndMigratePiece,
  findMatchingPiece,
  mergeImportedPiece,
  mergeImportedTechnique,
  readBackupTechnique,
} from "./storage";
import { ensureWorkId } from "./works";
// The comparing primitives live in pieceMerge.js (Pass 117), which the account
// code imports and never the other way round; they're re-exported from here so
// everything that already imports them from this file is unchanged.
import { isObject, toJsonValue, fingerprint, canonicalPiece, piecePartFingerprints, planPieceMerge, WHOLE_PIECE_PART, DATE_LINKED_FIELDS } from "./pieceMerge";
// Pass 121: naming a chunk by its measures, for the questions a held piece asks.
import { generateAllChunks } from "./chunking";
import { formatRange } from "./utils";
// The same for the technique library (Pass 118): lib/techniqueMerge.js owns its
// canonical form and its parts, and is imported here and never the other way.
import { canonicalTechnique, techniquePartFingerprints, planTechniqueMerge } from "./techniqueMerge";
// Pass 122: the 30-day window and the pure rules about deleted pieces. This file imports
// them; recentlyDeleted.js never imports this one.
import { RECENTLY_DELETED_DAYS, isRecentlyDeleted, wasSyncedHere, deletedCutoffIso, sessionsOnlyHere } from "./recentlyDeleted";

export { fingerprint, canonicalPiece, piecePartFingerprints, canonicalTechnique, techniquePartFingerprints };

// Mirrors CURRENT_SCHEMA_VERSION in storage.js, which doesn't export it.
// test/accountSync.test.mjs fails if the two ever disagree.
export const PIECE_SCHEMA_VERSION = 1;
export const ACCOUNT_SYNC_KEY = "measureone-account-sync";
const ACCOUNT_SYNC_VERSION = 1;

export const MATCHES = "matches";
export const DIFFERS = "differs";
export const NOT_IN_ACCOUNT = "not-in-account";

const PAGE_SIZE = 50;
const MAX_PAGES = 2000;

/* ------------------------------------------------------------------ */
/*  Comparing as data                                                  */
/* ------------------------------------------------------------------ */

function deepEqualJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualJson(item, b[i]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqualJson(a[k], b[k]));
  }
  return false;
}

// The database reorders an object's keys and JSON drops undefined fields, so
// two copies of the same piece are never the same TEXT. Compare the data.
export function sameData(a, b) {
  return deepEqualJson(toJsonValue(a), toJsonValue(b));
}

/* ---- "the same" means the same after a reload (Pass 111) ------------ */

// Pieces are fingerprinted and compared in the form loading would give them
// (canonicalPiece, pieceMerge.js); the technique library the same way
// (canonicalTechnique, techniqueMerge.js, re-exported above).
// A technique task is built without a `tempo`, which loading adds as null.
// Compared as they stand, a technique library that was uploaded and then simply
// reloaded would look changed and go up again, so it is compared in the form
// the load gives it: the same function the load uses, after the same trip
// through JSON that saving and loading make. What's SENT is still the app's own
// copy, untouched. A value that can't be put in that form is used as it is.

// What counts as a CHANGE to the technique library (Pass 115): everything
// except `updatedAt`. It's a stamp the app writes on every change, so two
// devices that hold identical practice data but stamped it at different times
// would each read the other as "changed". It stays in the row and in the app;
// it's only left out of the comparison. Today's list (`dayList`) and the walk
// position stay IN on purpose (Pass 118's engine, lib/techniqueMerge.js, merges
// them by part; nothing calls it until Pass 120).
export function techniqueForComparison(technique) {
  const canon = canonicalTechnique(technique);
  if (!isObject(canon)) return canon;
  const { updatedAt, ...rest } = canon;
  return rest;
}

export const samePiece = (a, b) => sameData(canonicalPiece(a), canonicalPiece(b));
export const sameTechnique = (a, b) => sameData(techniqueForComparison(a), techniqueForComparison(b));

// A fingerprint is worked out once per object. That's exact because pieces and
// the technique object are replaced, never edited in place (Pass 106's rule),
// so an object's fingerprint can't go stale; it also keeps "what's waiting"
// cheap enough to ask after every save.
const fingerprintCache = new WeakMap();
function cachedFingerprint(value, canonical) {
  if (value === null || typeof value !== "object") return fingerprint(value);
  let found = fingerprintCache.get(value);
  if (found === undefined) {
    found = fingerprint(canonical(value));
    fingerprintCache.set(value, found);
  }
  return found;
}
export const pieceFingerprint = (piece) => cachedFingerprint(piece, canonicalPiece);
export const techniqueFingerprint = (technique) => cachedFingerprint(technique, techniqueForComparison);

// Pure. This device's pieces (a map of id to piece) and technique object
// against the rows read back from the account: for each piece, and for the
// technique row, "matches", "differs" or "not in the account". A row marked
// deleted never counts as a match: the account says the piece is gone.
// "Matches" means the same once loaded (see canonicalPiece); `exact` says it's
// also identical as it stands. A row this very call's caller just wrote has to
// be exact (the read-back check), one that was already there only has to
// match.
export function compareWithAccount(pieces, technique, accountRows) {
  const rows = accountRows || {};
  const byId = new Map((rows.pieces || []).map((r) => [r.id, r]));
  const out = { pieces: {}, technique: null };
  Object.keys(pieces || {}).forEach((id) => {
    const row = byId.get(id);
    if (!row) {
      out.pieces[id] = { status: NOT_IN_ACCOUNT, revision: null, deleted: false };
      return;
    }
    const deleted = row.deleted_at != null;
    const exact = !deleted && sameData(pieces[id], row.data);
    out.pieces[id] = {
      status: exact || (!deleted && samePiece(pieces[id], row.data)) ? MATCHES : DIFFERS,
      revision: row.revision,
      deleted,
      exact,
    };
  });
  const trow = rows.technique;
  if (!trow) {
    out.technique = { status: NOT_IN_ACCOUNT, revision: null, exact: false };
  } else {
    const exact = sameData(technique, trow.data);
    out.technique = { status: exact || sameTechnique(technique, trow.data) ? MATCHES : DIFFERS, revision: trow.revision, exact };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Talking to the account                                             */
/* ------------------------------------------------------------------ */

// Every row this account holds: { ok: true, pieces, technique } or
// { ok: false, error }. Pieces come a page at a time.
export async function readAccountRows(client, userId) {
  const pieces = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await client
      .from("pieces")
      .select("id, revision, deleted_at, data")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { ok: false, error };
    const got = data || [];
    got.forEach((r) => pieces.push(r));
    if (got.length < PAGE_SIZE) break;
  }
  const t = await client.from("technique").select("revision, data").eq("user_id", userId);
  if (t.error) return { ok: false, error: t.error };
  return { ok: true, pieces, technique: (t.data && t.data[0]) || null };
}

// A new row. If one with this id is already there (23505, another device got
// there first) that's reported as `exists`, never overwritten. `revision` is
// what the database says the new row is at (its rule makes that 1). `status`
// is the HTTP status, which Pass 111 needs to tell a service that isn't
// answering (a server error) from a refusal.
function addResult({ data, error, status }) {
  if (!error) return { ok: true, revision: data && data[0] && Number.isFinite(data[0].revision) ? data[0].revision : 1 };
  if (error.code === "23505") return { ok: false, exists: true, error, status };
  return { ok: false, error, status };
}

export async function addPieceRow(client, userId, id, piece) {
  return addResult(
    await client
      .from("pieces")
      .insert({ user_id: userId, id, data: piece, schema_version: PIECE_SCHEMA_VERSION })
      .select("revision")
  );
}

export async function addTechniqueRow(client, userId, technique) {
  return addResult(await client.from("technique").insert({ user_id: userId, data: technique }).select("revision"));
}

// Save only if the row is still at the revision this device last saw. The
// filter on revision is what makes it safe: no row back means another device
// changed it first, so this reports a conflict. It never retries, and the
// caller must not retry blindly either. The database raises the revision.
function changeResult({ data, error, status }) {
  if (error) return { ok: false, error, status };
  if (!data || data.length === 0) return { ok: false, conflict: true };
  return { ok: true, revision: data[0].revision };
}

export async function changePieceRow(client, userId, id, piece, expectedRevision) {
  return changeResult(
    await client
      .from("pieces")
      .update({ data: piece, schema_version: PIECE_SCHEMA_VERSION })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("revision", expectedRevision)
      .select("revision")
  );
}

export async function changeTechniqueRow(client, userId, technique, expectedRevision) {
  return changeResult(
    await client
      .from("technique")
      .update({ data: technique })
      .eq("user_id", userId)
      .eq("revision", expectedRevision)
      .select("revision")
  );
}

// Pass 111: a piece deleted on this device is marked deleted in the account,
// never erased (Design D; the database refuses deletes anyway). Like any
// change it's "only if still at revision N", and only deleted_at is sent: the
// piece's data stays in the row, so it can be recovered by hand.
export async function deletePieceRow(client, userId, id, expectedRevision, deletedAtIso) {
  return changeResult(
    await client
      .from("pieces")
      .update({ deleted_at: deletedAtIso })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("revision", expectedRevision)
      .select("revision")
  );
}

// Pass 122: the other half of Design D. A piece marked deleted can be brought back by
// clearing the mark, nothing else: the row's data was never touched. Like every change
// it is "only if still at revision N".
export async function restorePieceRow(client, userId, id, expectedRevision) {
  return changeResult(
    await client
      .from("pieces")
      .update({ deleted_at: null })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("revision", expectedRevision)
      .select("revision")
  );
}

// Pass 122: a combine marks the other copy deleted, and now also notes where it went
// (`mergedInto`, inside the row's saved data, which is otherwise sent back exactly as it
// was read), so no device ever takes that duplicate for a piece somebody deleted. Still
// "only if still at revision N", and nothing is erased.
export async function markPieceRowCombined(client, userId, id, expectedRevision, deletedAtIso, rawData, intoId) {
  return changeResult(
    await client
      .from("pieces")
      .update({ deleted_at: deletedAtIso, data: { ...rawData, mergedInto: intoId } })
      .eq("user_id", userId)
      .eq("id", id)
      .eq("revision", expectedRevision)
      .select("revision")
  );
}

/* ------------------------------------------------------------------ */
/*  The device record (stays on this device, Design E)                 */
/*                                                                     */
/*  { version, accounts: { [userId]: { pieces: { [id]: entry },        */
/*  technique: entry | null, checkedAt, syncedAt } } }. An entry is    */
/*  { revision, fingerprint } (what this device last saw and uploaded) */
/*  plus, since Pass 111, `held` (the account moved on, so nothing is  */
/*  uploaded for it) and `deletedHere` (this device deleted it, and    */
/*  the deletion hasn't gone up yet), and, since Pass 115, `sent` (the */
/*  fingerprints of the last 5 uploads attempted since the account     */
/*  last confirmed a revision; cleared by the next confirmation), and, */
/*  since Pass 117, `parts` ({ part: fingerprint }: one for every      */
/*  top-level field except progress and one for each progress entry,   */
/*  as last synced with the account; lib/pieceMerge.js. No copy of the */
/*  piece is kept. A piece recorded before Pass 117 has none; the      */
/*  technique entry carries the same, since Pass 118, for the library: */
/*  lib/techniqueMerge.js). Filed under the signed-in                  */
/*  account's user id, so a different account on this browser starts   */
/*  empty. `checkedAt` is the first backup's read-back check (Pass     */
/*  110); `syncedAt` is the last time an upload landed (Pass 111).     */
/* ------------------------------------------------------------------ */

export function emptyAccountRecord() {
  return { pieces: {}, technique: null, checkedAt: null, syncedAt: null };
}

// How many of an item's most recent upload attempts are remembered (`sent`).
export const MAX_SENT = 5;

const MAX_CONFLICTS = 200;
const CONFLICT_KINDS = ["field", "progress", "whole-piece"];
const printOrNull = (v) => (typeof v === "string" ? v : null);
function cleanConflicts(list) {
  return list
    .filter((c) => isObject(c) && typeof c.part === "string" && CONFLICT_KINDS.includes(c.kind))
    .slice(0, MAX_CONFLICTS)
    .map((c) => ({ part: c.part, kind: c.kind, local: printOrNull(c.local), remote: printOrNull(c.remote), base: printOrNull(c.base) }));
}

function cleanEntry(e) {
  if (!isObject(e)) return null;
  const out = {};
  if (Number.isFinite(e.revision) && typeof e.fingerprint === "string") {
    out.revision = e.revision;
    out.fingerprint = e.fingerprint;
  }
  if (e.held === true) out.held = true;
  // Pass 120: the parts that conflicted when an automatic update held this piece,
  // kept for the question Pass 121 will ask. Fingerprints only (never a copy of the
  // data): the values are read again from the account's copy when it is wanted.
  if (out.held && Array.isArray(e.conflicts)) {
    const conflicts = cleanConflicts(e.conflicts);
    if (conflicts.length) out.conflicts = conflicts;
  }
  if (e.deletedHere === true && out.revision !== undefined) out.deletedHere = true;
  if (Array.isArray(e.sent)) {
    const sent = e.sent.filter((x) => typeof x === "string").slice(-MAX_SENT);
    if (sent.length) out.sent = sent;
  }
  // Only meaningful beside a recorded revision and fingerprint: it describes
  // the same synced state.
  if (isObject(e.parts) && out.revision !== undefined) {
    const parts = {};
    Object.keys(e.parts).forEach((k) => {
      if (typeof e.parts[k] === "string") parts[k] = e.parts[k];
    });
    if (Object.keys(parts).length) out.parts = parts;
  }
  return Object.keys(out).length ? out : null;
}

// Never throws; anything unreadable is treated as empty (the only cost is
// that the question is asked again and matching pieces are re-recorded).
export function readDeviceRecord(storage) {
  const empty = { version: ACCOUNT_SYNC_VERSION, accounts: {} };
  try {
    const raw = (storage || localStorage).getItem(ACCOUNT_SYNC_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !isObject(parsed.accounts)) return empty;
    const accounts = {};
    Object.keys(parsed.accounts).forEach((uid) => {
      const a = parsed.accounts[uid];
      if (!isObject(a)) return;
      const pieces = {};
      if (isObject(a.pieces)) {
        Object.keys(a.pieces).forEach((id) => {
          const entry = cleanEntry(a.pieces[id]);
          if (entry) pieces[id] = entry;
        });
      }
      accounts[uid] = {
        pieces,
        technique: cleanEntry(a.technique),
        checkedAt: Number.isFinite(a.checkedAt) ? a.checkedAt : null,
        syncedAt: Number.isFinite(a.syncedAt) ? a.syncedAt : null,
        // Pass 120: "Update automatically from other devices". Kept only when on, so
        // a record that never had the switch reads exactly as before.
        ...(a.autoUpdate === true ? { autoUpdate: true } : {}),
      };
    });
    return { version: ACCOUNT_SYNC_VERSION, accounts };
  } catch (e) {
    return empty;
  }
}

export function accountRecordFor(deviceRecord, userId) {
  const found = deviceRecord && deviceRecord.accounts && userId ? deviceRecord.accounts[userId] : null;
  return found || emptyAccountRecord();
}

// Has this device recorded a checked backup to this account? (The first
// backup asks first; a different account never counts.)
export function hasRecordedBackup(deviceRecord, userId) {
  return accountRecordFor(deviceRecord, userId).checkedAt != null;
}

// Pure: the record with these backed-up entries added for this account.
// Entries for pieces not named here are kept as they were.
export function withBackupRecorded(deviceRecord, userId, { pieces, technique, checkedAt }) {
  const before = accountRecordFor(deviceRecord, userId);
  return {
    version: ACCOUNT_SYNC_VERSION,
    accounts: {
      ...(deviceRecord && deviceRecord.accounts ? deviceRecord.accounts : {}),
      [userId]: {
        pieces: { ...before.pieces, ...pieces },
        technique: technique || before.technique,
        checkedAt,
        syncedAt: before.syncedAt,
        ...(before.autoUpdate ? { autoUpdate: true } : {}),
      },
    },
  };
}

export function saveDeviceRecord(deviceRecord, storage) {
  try {
    (storage || localStorage).setItem(ACCOUNT_SYNC_KEY, JSON.stringify(deviceRecord));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/* ------------------------------------------------------------------ */
/*  The first backup                                                   */
/* ------------------------------------------------------------------ */

const plural = (n, one, many) => (n === 1 ? one : many);
const reasonFor = (error) => (isConnectionProblem(error) ? "connection" : "other");

function blankResult(userId, total) {
  return {
    userId,
    status: "done", // or "stopped": couldn't finish, see `reason`
    reason: null, // "connection" | "signed-out" | "other"
    total,
    backedUp: 0, // pieces that match the account after reading it back
    added: 0, // of those, added this time
    alreadyThere: 0, // of those, already in the account and matching
    different: [], // already in the account and different: left as it is
    mismatched: [], // sent, but didn't match when read back
    notSent: [], // couldn't be sent
    technique: null, // "backedUp" | "different" | "mismatched" | "notSent"
    recordSaved: null,
    sentAny: false,
  };
}

async function runBackup({ pieces, technique, userId, getClient = loadBackend, storage, now = Date.now }) {
  const ids = Object.keys(pieces || {}).sort();
  const result = blankResult(userId, ids.length);
  const stopped = (reason) => ({ ...result, status: "stopped", reason });
  const nameOf = (id) => (pieces[id] && typeof pieces[id].name === "string" && pieces[id].name.trim()) || "Untitled piece";
  if (!technique) return stopped("other");

  const client = await getClient();
  if (!client) return stopped("connection");

  // Only ever write as the account the person asked about.
  const session = await client.auth.getSession();
  const sessionUser = session && session.data && session.data.session && session.data.session.user;
  if (!sessionUser || sessionUser.id !== userId) {
    return stopped(session && session.error && isConnectionProblem(session.error) ? "connection" : "signed-out");
  }

  // What the account already holds decides what gets added.
  const before = await readAccountRows(client, userId);
  if (!before.ok) return stopped(reasonFor(before.error));
  const plan = compareWithAccount(pieces, technique, before);

  const tried = new Set();
  const sent = new Set();
  const existsNow = new Set();
  let halted = false;
  for (const id of ids) {
    if (plan.pieces[id].status !== NOT_IN_ACCOUNT) continue;
    tried.add(id);
    if (halted) continue;
    const r = await addPieceRow(client, userId, id, pieces[id]);
    if (r.ok) {
      sent.add(id);
      result.sentAny = true;
    } else if (r.exists) {
      existsNow.add(id);
    } else {
      console.warn("MeasureOne: a piece couldn't be added to the account.", r.error && r.error.message);
      if (isConnectionProblem(r.error)) halted = true;
    }
  }
  const techniqueMissing = plan.technique.status === NOT_IN_ACCOUNT;
  let techniqueSent = false;
  let techniqueExists = false;
  if (techniqueMissing && !halted) {
    const r = await addTechniqueRow(client, userId, technique);
    if (r.ok) {
      techniqueSent = true;
      result.sentAny = true;
    } else if (r.exists) {
      techniqueExists = true;
    } else {
      console.warn("MeasureOne: the technique library couldn't be added to the account.", r.error && r.error.message);
    }
  }

  // Read everything back and compare: the backup counts only if it matches.
  const after = await readAccountRows(client, userId);
  if (!after.ok) return stopped(reasonFor(after.error));
  const final = compareWithAccount(pieces, technique, after);

  const recordPieces = {};
  ids.forEach((id) => {
    const f = final.pieces[id];
    const wasSent = sent.has(id);
    if (f.status === MATCHES && (!wasSent || f.exact)) {
      result.backedUp += 1;
      if (wasSent) result.added += 1;
      else result.alreadyThere += 1;
      recordPieces[id] = { revision: f.revision, fingerprint: pieceFingerprint(pieces[id]), parts: piecePartFingerprints(pieces[id]) };
    } else if (f.status !== NOT_IN_ACCOUNT) {
      // Differs, or (for a row just written) matches only once loaded, which
      // isn't what was sent.
      (wasSent ? result.mismatched : result.different).push({ id, name: nameOf(id), deleted: f.deleted });
    } else if (tried.has(id) && !wasSent && !existsNow.has(id)) {
      result.notSent.push({ id, name: nameOf(id) });
    } else {
      result.mismatched.push({ id, name: nameOf(id), deleted: false });
    }
  });

  let recordTechnique = null;
  const ft = final.technique;
  if (ft.status === MATCHES && (!techniqueSent || ft.exact)) {
    result.technique = "backedUp";
    recordTechnique = { revision: ft.revision, fingerprint: techniqueFingerprint(technique), parts: techniquePartFingerprints(technique) };
  } else if (ft.status !== NOT_IN_ACCOUNT) {
    result.technique = techniqueSent ? "mismatched" : "different";
  } else if (techniqueMissing && !techniqueSent && !techniqueExists) {
    result.technique = "notSent";
  } else {
    result.technique = "mismatched";
  }

  // Recorded on this device only for what matched. A piece that differs gets
  // no entry on purpose: recording the revision it has now would let a later
  // pass write over it.
  if (result.backedUp > 0 || recordTechnique) {
    const next = withBackupRecorded(readDeviceRecord(storage), userId, {
      pieces: recordPieces,
      technique: recordTechnique,
      checkedAt: now(),
    });
    result.recordSaved = saveDeviceRecord(next, storage).ok;
  }
  return result;
}

// Uploads what the account lacks, reads everything back, compares, and
// records on this device only what matched. Never throws and never changes
// this device's pieces or technique data. `pieces` and `technique` are the
// snapshot the caller took when the person pressed the button.
export async function backUpDevice(options) {
  try {
    return await runBackup(options);
  } catch (e) {
    console.warn("MeasureOne: the backup stopped unexpectedly.", e && e.message);
    const ids = Object.keys((options && options.pieces) || {});
    return { ...blankResult(options && options.userId, ids.length), status: "stopped", reason: "other" };
  }
}

/* ------------------------------------------------------------------ */
/*  Words                                                              */
/* ------------------------------------------------------------------ */

export function backupQuestion(pieceCount, email) {
  return `Back up the ${pieceCount} ${plural(pieceCount, "piece", "pieces")} and the technique library on this device to ${email}?`;
}

const TRY_AGAIN = 'Press "Back up this device" to try again.';
// Piece names often contain commas ("Etude in C minor, Op. 10, No. 12"), so a
// list of them is separated by semicolons, and a long one is cut short.
const MAX_NAMES = 5;
const names = (list) => {
  const shown = list.slice(0, MAX_NAMES).map((p) => p.name).join("; ");
  return list.length > MAX_NAMES ? `${shown}; and ${list.length - MAX_NAMES} more` : shown;
};

// The result as plain lines: [{ text, problem, plain? }]. `plain` marks a line that
// shouldn't get the green "it worked" look.
export function describeBackupResult(result) {
  if (!result) return [];
  if (result.status === "stopped") {
    if (result.reason === "connection") {
      const extra = result.sentAny
        ? ' Some pieces may already be in your account. Press "Back up this device" again to finish and check them.'
        : "";
      return [{ problem: true, text: NO_CONNECTION_MESSAGE + extra }];
    }
    if (result.reason === "signed-out") {
      return [{ problem: true, text: "You're signed out of your account. Sign in again to back up." }];
    }
    return [{ problem: true, text: "Something went wrong while backing up. Nothing on this device was changed. Try again in a moment." }];
  }
  const lines = [];
  const techniqueOk = result.technique === "backedUp";
  if (result.backedUp === 0 && !techniqueOk) {
    if (result.different.length > 0 && result.mismatched.length === 0 && result.notSent.length === 0) {
      // Nothing failed: the account already holds a (different) copy of every
      // piece, so there was nothing to add. "Nothing was backed up" alone reads
      // like a failure, which is what it did the first time someone saw it.
      lines.push({
        problem: false,
        plain: true,
        text: result.different.length === 1
          ? "Nothing was added: your account already has a copy of this piece."
          : "Nothing was added: your account already has a copy of each of these pieces.",
      });
    } else {
      lines.push({ problem: false, text: "Nothing was backed up." });
    }
  } else {
    lines.push({
      problem: false,
      text: `Backed up and checked: ${result.backedUp} of ${result.total} ${plural(result.total, "piece", "pieces")}${techniqueOk ? " and the technique library" : ""}.`,
    });
    lines.push({ problem: false, text: `${result.added} added this time, ${result.alreadyThere} already in your account.` });
  }
  if (result.different.length) {
    lines.push({ problem: false, text: `Already in your account and different, left as it is: ${names(result.different)}.` });
  }
  if (result.mismatched.length) {
    lines.push({ problem: true, text: `Didn't match when read back from your account: ${names(result.mismatched)}. ${TRY_AGAIN}` });
  }
  if (result.notSent.length) {
    lines.push({ problem: true, text: `Couldn't be sent: ${names(result.notSent)}. ${TRY_AGAIN}` });
  }
  if (result.technique === "different") {
    lines.push({ problem: false, text: "The technique library in your account is different from this device's, left as it is." });
  } else if (result.technique === "mismatched") {
    lines.push({ problem: true, text: `The technique library didn't match when read back. ${TRY_AGAIN}` });
  } else if (result.technique === "notSent") {
    lines.push({ problem: true, text: `The technique library couldn't be sent. ${TRY_AGAIN}` });
  }
  if (result.recordSaved === false) {
    lines.push({ problem: false, text: "This device couldn't save a note of this backup. The copy in your account is fine." });
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/*  Keeping the backup current (Pass 111)                              */
/*                                                                     */
/*  Once this device's first backup has been checked (Pass 110), what  */
/*  changes here goes up to the account by itself. The deciding logic  */
/*  lives in this file, pure or taking a client, so it can be tested;  */
/*  App.jsx only schedules it. Rules that matter:                      */
/*  - Every change goes up as "save only if still at revision N"       */
/*    (Design C). A refusal is never retried and never forced: the     */
/*    piece is HELD (recorded as changed on another device) and this   */
/*    device's copy is left exactly as it is. Settling it is Pass 112. */
/*  - A piece is "deleted here" only when this session SAW it removed  */
/*    (reconcileLocalDeletions), never just because it's missing from  */
/*    the pieces map: a failed load would otherwise mark the account's */
/*    copy of everything deleted.                                      */
/*  - When nothing is waiting nothing is sent, and the account library */
/*    isn't even loaded.                                               */
/* ------------------------------------------------------------------ */

// Wait this long after the last change, so logging several things in a row
// becomes one upload; but never keep a change waiting longer than the max
// just because more keep arriving.
export const SYNC_QUIET_MS = 5 * 1000;
export const SYNC_MAX_WAIT_MS = 60 * 1000;
// After a failed attempt: how long before the next one (30 seconds, 2
// minutes, then every 10 minutes). Any success starts the count again, and the
// browser's online event retries at once.
export const RETRY_GAPS_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
// After this many failed attempts in a row the status stops saying "waiting"
// and says the account service isn't answering (a paused project looks just
// like no connection).
export const NOT_ANSWERING_AFTER = 2;

// How long to wait before the next upload run, given when the oldest unsent
// change arrived (null: just now).
export function quietDelayMs(now, pendingSince) {
  const since = pendingSince == null ? now : pendingSince;
  return Math.max(0, Math.min(SYNC_QUIET_MS, since + SYNC_MAX_WAIT_MS - now));
}

export function retryGapMs(failures) {
  const n = Math.min(Math.max(Math.floor(failures) || 1, 1), RETRY_GAPS_MS.length);
  return RETRY_GAPS_MS[n - 1];
}

// "success" (everything that could go up did; a refusal is not a failure, it's
// held and left alone), "failure" (no connection, or something the database
// objected to, so it stays waiting and is retried), or "idle" (signed out, or
// cancelled because of it: neither).
export function syncOutcome(result) {
  if (!result) return "failure";
  if (result.status === "stopped" && (result.reason === "signed-out" || result.reason === "cancelled")) return "idle";
  return result.status === "done" && !result.failed ? "success" : "failure";
}

export function nextFailureCount(failures, outcome) {
  if (outcome === "success") return 0;
  if (outcome === "failure") return failures + 1;
  return failures;
}

/* ---- the device record, updated (pure: each returns a new record) --- */

function changeAccount(deviceRecord, userId, change) {
  const before = accountRecordFor(deviceRecord, userId);
  // `autoUpdate` (Pass 120) must be carried over here: every upload goes through this
  // function, and a draft that forgot it would switch the person's choice off.
  const draft = { pieces: { ...before.pieces }, technique: before.technique, checkedAt: before.checkedAt, syncedAt: before.syncedAt };
  if (before.autoUpdate) draft.autoUpdate = true;
  change(draft);
  if (draft.autoUpdate === false) delete draft.autoUpdate;
  return {
    version: ACCOUNT_SYNC_VERSION,
    accounts: { ...(deviceRecord && deviceRecord.accounts ? deviceRecord.accounts : {}), [userId]: draft },
  };
}

// The account now holds this piece at `revision`, as fingerprinted. `parts`
// (Pass 117) is the fingerprint of each part of the piece as the account holds
// it now; left out when it isn't known (an adopted row that is only an earlier
// version of this device's own piece), in which case the next confirmed upload
// records it.
export function withPieceUploaded(deviceRecord, userId, id, { revision, fingerprint: print, parts }, at) {
  return changeAccount(deviceRecord, userId, (a) => {
    a.pieces[id] = parts ? { revision, fingerprint: print, parts } : { revision, fingerprint: print };
    a.syncedAt = at;
  });
}

// Pass 115. Written BEFORE an upload attempt: "this device is about to send
// content `print`". If the account then answers but the answer is lost, a later
// refusal that finds the row holding exactly this content knows it's this
// device's own earlier upload, not another device's change. Keeps the last
// MAX_SENT; a confirmed revision (withPieceUploaded/withTechniqueUploaded)
// replaces the whole entry, which clears it. `item` is { kind, id? }.
export function withSentRecorded(deviceRecord, userId, item, print) {
  return changeAccount(deviceRecord, userId, (a) => {
    const add = (entry) => {
      const sent = ((entry && entry.sent) || []).filter((x) => x !== print).concat(print).slice(-MAX_SENT);
      return { ...(entry || {}), sent };
    };
    if (item.kind === "technique") a.technique = add(a.technique);
    else a.pieces[item.id] = add(a.pieces[item.id]);
  });
}

// The account moved on without this device: nothing is uploaded for it until
// something settles it. Whatever the entry knew about the revision is kept.
export function withPieceHeld(deviceRecord, userId, id, conflicts = null) {
  return changeAccount(deviceRecord, userId, (a) => {
    const entry = { ...(a.pieces[id] || {}), held: true };
    // Pass 120: an automatic update that finds parts changed differently on both
    // sides holds the piece and keeps which parts, for Pass 121.
    if (Array.isArray(conflicts) && conflicts.length) entry.conflicts = cleanConflicts(conflicts);
    else delete entry.conflicts;
    a.pieces[id] = entry;
  });
}

// Pass 120: the switch "Update automatically from other devices". On this device
// only (it is in the device record, never in the account) and OFF unless chosen.
export function autoUpdateOn(deviceRecord, userId) {
  return accountRecordFor(deviceRecord, userId).autoUpdate === true;
}

export function withAutoUpdate(deviceRecord, userId, on) {
  return changeAccount(deviceRecord, userId, (a) => {
    a.autoUpdate = !!on;
  });
}

// Pass 117: a quiet step for pieces recorded before `parts` existed. A piece
// whose fingerprint still equals its record's has not changed since it was last
// synced, so this device's copy IS the synced state and its parts can be
// recorded from it. A piece with changes waiting is left alone (it gets parts at
// its next confirmed upload, and until then falls back to asking), as is any
// entry that already has them. Works for every account in the record: each
// compares the same local pieces with its own fingerprints. Pure.
// Returns { record, recorded } (the same record object when nothing changed).
export function withPartsRecorded(deviceRecord, pieces) {
  const accounts = (deviceRecord && deviceRecord.accounts) || {};
  const local = pieces || {};
  const nextAccounts = {};
  let recorded = 0;
  Object.keys(accounts).forEach((uid) => {
    const a = accounts[uid];
    let nextPieces = null; // copied only if something changes
    Object.keys(a.pieces || {}).forEach((id) => {
      const entry = a.pieces[id];
      const piece = local[id];
      if (!piece || !entry || entry.parts || entry.revision === undefined || typeof entry.fingerprint !== "string") return;
      if (pieceFingerprint(piece) !== entry.fingerprint) return;
      if (!nextPieces) nextPieces = { ...a.pieces };
      nextPieces[id] = { ...entry, parts: piecePartFingerprints(piece) };
      recorded += 1;
    });
    nextAccounts[uid] = nextPieces ? { ...a, pieces: nextPieces } : a;
  });
  return recorded > 0 ? { record: { ...deviceRecord, accounts: nextAccounts }, recorded } : { record: deviceRecord, recorded: 0 };
}

// A deleted piece's deletion has gone up (or there was nothing to delete): the
// device has nothing left to remember about it.
export function withPieceForgotten(deviceRecord, userId, id, at) {
  return changeAccount(deviceRecord, userId, (a) => {
    delete a.pieces[id];
    a.syncedAt = at;
  });
}

// The account now holds the technique library at `revision`, as fingerprinted.
// `parts` (Pass 118) is the fingerprint of each part of the library as the
// account holds it now (lib/techniqueMerge.js), left out when it isn't known,
// exactly as for a piece (withPieceUploaded).
export function withTechniqueUploaded(deviceRecord, userId, { revision, fingerprint: print, parts }, at) {
  return changeAccount(deviceRecord, userId, (a) => {
    a.technique = parts ? { revision, fingerprint: print, parts } : { revision, fingerprint: print };
    a.syncedAt = at;
  });
}

// Pass 118: the quiet step withPartsRecorded is for pieces, for the technique
// library: an entry recorded before `parts` existed whose fingerprint still
// equals this device's library has not changed since it was last synced, so this
// device's copy IS the synced state and its parts can be recorded from it. A
// library with changes waiting is left alone (it gets parts at its next
// confirmed upload), as is an entry that already has them. Works for every
// account in the record. Pure. Returns { record, recorded } (the same record
// object when nothing changed).
export function withTechniquePartsRecorded(deviceRecord, technique) {
  const accounts = (deviceRecord && deviceRecord.accounts) || {};
  if (!technique) return { record: deviceRecord, recorded: 0 };
  const nextAccounts = {};
  let recorded = 0;
  Object.keys(accounts).forEach((uid) => {
    const a = accounts[uid];
    const entry = a.technique;
    if (!entry || entry.parts || entry.revision === undefined || typeof entry.fingerprint !== "string" || techniqueFingerprint(technique) !== entry.fingerprint) {
      nextAccounts[uid] = a;
      return;
    }
    nextAccounts[uid] = { ...a, technique: { ...entry, parts: techniquePartFingerprints(technique) } };
    recorded += 1;
  });
  return recorded > 0 ? { record: { ...deviceRecord, accounts: nextAccounts }, recorded } : { record: deviceRecord, recorded: 0 };
}

export function withTechniqueHeld(deviceRecord, userId) {
  return changeAccount(deviceRecord, userId, (a) => {
    a.technique = { ...(a.technique || {}), held: true };
  });
}

// Deleting a piece is noticed, not inferred. `removedIds` are pieces this
// session saw leave the pieces map (the only path is deleting one on purpose);
// they're marked `deletedHere` on every account's entry for them, so the
// deletion survives a reload and can go up later, signed in or not.
// `presentIds` are the pieces that exist now: a stale mark on one of those
// (deleted, then imported back) is cleared. Returns { record, changed }.
export function reconcileLocalDeletions(deviceRecord, { removedIds = [], presentIds = [] } = {}) {
  const accounts = {};
  let changed = false;
  Object.keys((deviceRecord && deviceRecord.accounts) || {}).forEach((uid) => {
    const a = deviceRecord.accounts[uid];
    let pieces = null; // copied only if something changes
    const edit = (id, entry) => {
      if (!pieces) pieces = { ...a.pieces };
      pieces[id] = entry;
    };
    removedIds.forEach((id) => {
      const e = a.pieces[id];
      if (e && e.revision !== undefined && !e.deletedHere) edit(id, { ...e, deletedHere: true });
    });
    presentIds.forEach((id) => {
      const e = a.pieces[id];
      if (e && e.deletedHere) {
        const { deletedHere, ...rest } = e;
        edit(id, rest);
      }
    });
    accounts[uid] = pieces ? { ...a, pieces } : a;
    if (pieces) changed = true;
  });
  return changed ? { record: { ...deviceRecord, accounts }, changed: true } : { record: deviceRecord, changed: false };
}

/* ---- what's waiting ------------------------------------------------ */

const pieceName = (piece) => (piece && typeof piece.name === "string" && piece.name.trim()) || "Untitled piece";
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// What needs to go up, and what's held, for one account's record. Pure.
// Before this device's first backup has been checked nothing is waiting: the
// first backup is a deliberate, asked-first step (Pass 110), never automatic.
//   items: [{ kind: "piece"|"technique", action: "add"|"change"|"delete",
//             id?, name?, expectedRevision? }]   in upload order
//   held:  { pieces: [{ id, name, deletedHere }], technique: boolean }
// A piece with no entry is ADDED (a new piece, or one the first backup left as
// "different"): if the account already has that id the upload is refused and
// it's held, which is how "a row exists but this device has no entry for it"
// is never uploaded over. A piece whose fingerprint differs from its entry is
// CHANGED at the revision the entry holds. An entry whose piece is gone is
// only DELETED if this session saw the deletion (`deletedHere`).
export function computeWaiting({ pieces, technique, accountRecord }) {
  const acct = accountRecord || emptyAccountRecord();
  const out = { firstBackupDone: acct.checkedAt != null, items: [], held: { pieces: [], technique: false }, count: 0 };
  if (!out.firstBackupDone) return out;
  const local = pieces || {};
  Object.keys(local).sort().forEach((id) => {
    const entry = acct.pieces[id];
    const name = pieceName(local[id]);
    if (entry && entry.held) {
      out.held.pieces.push({ id, name, deletedHere: false });
    } else if (!entry || entry.revision === undefined) {
      out.items.push({ kind: "piece", action: "add", id, name });
    } else if (pieceFingerprint(local[id]) !== entry.fingerprint) {
      out.items.push({ kind: "piece", action: "change", id, name, expectedRevision: entry.revision });
    }
  });
  Object.keys(acct.pieces).sort().forEach((id) => {
    if (hasOwn(local, id)) return;
    const entry = acct.pieces[id];
    if (!entry.deletedHere) return;
    if (entry.held) out.held.pieces.push({ id, name: null, deletedHere: true });
    else out.items.push({ kind: "piece", action: "delete", id, expectedRevision: entry.revision });
  });
  if (technique) {
    const entry = acct.technique;
    if (entry && entry.held) out.held.technique = true;
    else if (!entry || entry.revision === undefined) out.items.push({ kind: "technique", action: "add" });
    else if (techniqueFingerprint(technique) !== entry.fingerprint) {
      out.items.push({ kind: "technique", action: "change", expectedRevision: entry.revision });
    }
  }
  out.count = out.items.length;
  return out;
}

// Everything App.jsx needs to show the status and decide whether to schedule an
// upload, from the device record as it is right now. No network.
// `accountRows` (Pass 116) is the last light read of the account
// (checkAccountChanges); with it, `changes` says what another device changed
// (classifyAccountChanges), worked out from the record as it is NOW, so it
// shrinks by itself as uploads and "Get changes" bring the record up to date.
export function syncSnapshot({ pieces, technique, userId, storage, accountRows = null }) {
  const acct = accountRecordFor(readDeviceRecord(storage), userId);
  const plan = computeWaiting({ pieces, technique, accountRecord: acct });
  const times = [acct.checkedAt, acct.syncedAt].filter((t) => t != null);
  return {
    firstBackupDone: plan.firstBackupDone,
    waiting: plan.count,
    held: plan.held,
    backedUpAt: times.length ? Math.max(...times) : null,
    changes:
      accountRows && plan.firstBackupDone
        ? classifyAccountChanges({ rows: accountRows, accountRecord: acct, localPieceIds: Object.keys(pieces || {}) })
        : null,
  };
}

/* ---- uploading ----------------------------------------------------- */

// A failed upload is "connection" (no connection, or a service that answers
// with a server error or not at all: a paused project looks like that, so it's
// retried later) or "other" (anything else the database objected to).
function failureKind(r) {
  if (isConnectionProblem(r.error)) return "connection";
  const s = r.status;
  if (typeof s === "number" && (s === 0 || s === 408 || s === 429 || s >= 500)) return "connection";
  return "other";
}

// One upload's answer, as one of: { ok, revision } it worked; { refused } the
// account refused it (a newer revision is there, or a row with that id is);
// { failed: "connection" | "other", error } it didn't go through.
function sortOut(r) {
  if (r.ok) return { ok: true, revision: r.revision };
  if (r.conflict) return { refused: true, why: "conflict" };
  if (r.exists) return { refused: true, why: "exists" };
  return { failed: failureKind(r), error: r.error };
}

async function uploadItem(client, userId, item, pieces, technique, nowMs) {
  try {
    if (item.kind === "technique") {
      return sortOut(
        item.action === "add"
          ? await addTechniqueRow(client, userId, technique)
          : await changeTechniqueRow(client, userId, technique, item.expectedRevision)
      );
    }
    if (item.action === "add") return sortOut(await addPieceRow(client, userId, item.id, pieces[item.id]));
    if (item.action === "delete") {
      return sortOut(await deletePieceRow(client, userId, item.id, item.expectedRevision, new Date(nowMs).toISOString()));
    }
    return sortOut(await changePieceRow(client, userId, item.id, pieces[item.id], item.expectedRevision));
  } catch (e) {
    return { failed: "other", error: e };
  }
}

// After a refusal: what does the account hold? { ok, row } (row is null if
// there isn't one) or { ok: false, failed } if even that can't be read.
async function readRow(client, userId, item) {
  try {
    const res =
      item.kind === "technique"
        ? await client.from("technique").select("revision, data").eq("user_id", userId)
        : await client.from("pieces").select("revision, deleted_at, data").eq("user_id", userId).eq("id", item.id);
    if (res.error) return { ok: false, failed: failureKind({ error: res.error, status: res.status }) };
    return { ok: true, row: (res.data && res.data[0]) || null };
  } catch (e) {
    return { ok: false, failed: "other" };
  }
}

// Was the refusal real? Only a row that differs from this device's copy (or
// that the account marks deleted) is: that's "changed on another device".
// - "same": the account's row is exactly what this device holds. Another tab
//   of this browser got there first, or this device's own earlier upload
//   landed but its note of it didn't. Not a conflict: adopt the row's revision.
// - "same" with `earlier` (Pass 115): the row is not what this device holds NOW
//   but is exactly something it SENT (`sent`, the fingerprints of recent
//   attempts): its own earlier upload landed, its confirmation was lost, and
//   more was logged since. Also not a conflict. `fingerprint` is the row's
//   content, so the piece stays waiting at the adopted revision.
// - "missing": the row is gone (a table wiped in the dashboard). Put it back,
//   or for a deletion there's nothing to delete.
// - "differs": the account moved on. Hold it.
function judgeRefusal(item, local, row, sent) {
  if (!row) return { kind: "missing" };
  if (item.action === "delete") return row.deleted_at ? { kind: "same", revision: row.revision } : { kind: "differs" };
  if (item.kind === "piece" && row.deleted_at) return { kind: "differs" };
  const same = item.kind === "technique" ? sameTechnique(local, row.data) : samePiece(local, row.data);
  if (same) return { kind: "same", revision: row.revision };
  const rowPrint = item.kind === "technique" ? techniqueFingerprint(row.data) : pieceFingerprint(row.data);
  if ((sent || []).includes(rowPrint)) return { kind: "same", revision: row.revision, earlier: true, fingerprint: rowPrint };
  return { kind: "differs" };
}

// Sends what's waiting, one item at a time, each "only if still at revision N".
// `pieces` and `technique` are the snapshot to compare and send (they're never
// edited in place, so a change that arrives mid-run is simply still waiting
// afterwards). Records on this device only what the account confirmed. Never
// throws, never changes this device's pieces or technique data.
//   status "done"    : ran to the end. `failed` items are still waiting and
//                      should be retried later; refused ones are held, not failed.
//   status "stopped" : reason "connection" (the rest stays waiting), "signed-out",
//                      or "cancelled" (the caller signed out mid-run).
//
// Pass 120: `skipPieceIds` / `skipTechnique` leave named items waiting this run,
// untouched and not counted: a piece that has to be merged with a newer copy
// from the account first but can't be yet (it is in use) must not be sent, or it
// would be refused and held. Everything else goes up as usual.
export async function syncWaitingChanges({ pieces, technique, userId, getClient = loadBackend, storage, now = Date.now, isCancelled = () => false, skipPieceIds = [], skipTechnique = false }) {
  const result = { status: "done", reason: null, uploaded: 0, resolved: 0, newlyHeld: [], failed: 0, remaining: 0 };
  const accountNow = () => accountRecordFor(readDeviceRecord(storage), userId);
  const skip = new Set(skipPieceIds || []);
  const planNow = () => {
    const w = computeWaiting({ pieces, technique, accountRecord: accountNow() });
    if (skip.size === 0 && !skipTechnique) return w;
    const items = w.items.filter((i) => !(i.kind === "technique" ? skipTechnique : skip.has(i.id)));
    return { ...w, items, count: w.count - (w.items.length - items.length) };
  };
  const stopped = (reason) => ({ ...result, status: "stopped", reason, remaining: planNow().count });

  const first = planNow();
  if (!first.firstBackupDone || first.items.length === 0) return result; // nothing to do: no library, no network

  const client = await getClient();
  if (!client) return stopped("connection");
  // Only ever write as the account this record belongs to.
  const session = await client.auth.getSession();
  const sessionUser = session && session.data && session.data.session && session.data.session.user;
  if (!sessionUser || sessionUser.id !== userId) {
    return stopped(session && session.error && isConnectionProblem(session.error) ? "connection" : "signed-out");
  }

  const save = (change) => saveDeviceRecord(change(readDeviceRecord(storage)), storage);
  const sameItem = (a, b) => a.kind === b.kind && a.id === b.id;
  const localOf = (item) => (item.kind === "technique" ? technique : pieces[item.id]);
  // The account now holds what this device holds (or, for a deletion, holds the deletion).
  // `print` (Pass 115): the fingerprint to record instead of this device's
  // current copy, when the row is this device's own EARLIER upload.
  const finish = (item, revision, print) => {
    const at = now();
    if (item.kind === "technique") {
      // As for a piece: `print` set means the account holds an earlier version
      // of the library that this device no longer has, so its parts are unknown.
      const parts = print ? undefined : techniquePartFingerprints(technique);
      save((r) => withTechniqueUploaded(r, userId, { revision, fingerprint: print || techniqueFingerprint(technique), parts }, at));
    } else if (item.action === "delete") {
      save((r) => withPieceForgotten(r, userId, item.id, at));
    } else {
      // `print` set means the account holds an earlier version of this piece
      // that this device no longer has, so its parts are unknown: left out.
      const parts = print ? undefined : piecePartFingerprints(pieces[item.id]);
      save((r) => withPieceUploaded(r, userId, item.id, { revision, fingerprint: print || pieceFingerprint(pieces[item.id]), parts }, at));
    }
  };
  const hold = (item) => {
    if (item.kind === "technique") save((r) => withTechniqueHeld(r, userId));
    else save((r) => withPieceHeld(r, userId, item.id));
    result.newlyHeld.push(item.kind === "technique" ? { kind: "technique" } : { kind: "piece", id: item.id, name: item.name || null });
  };
  const warn = (what, error) => console.warn(`MeasureOne: ${what}`, error && error.message);

  // Pass 115: note what's about to be sent BEFORE sending it, so that if the
  // answer is lost, a later refusal can recognize the row as this device's own.
  const upload = (item) => {
    if (item.action !== "delete") {
      const print = item.kind === "technique" ? techniqueFingerprint(technique) : pieceFingerprint(pieces[item.id]);
      save((r) => withSentRecorded(r, userId, item, print));
    }
    return uploadItem(client, userId, item, pieces, technique, now());
  };
  const sentOf = (item) => {
    const acct = accountNow();
    const entry = item.kind === "technique" ? acct.technique : acct.pieces[item.id];
    return (entry && entry.sent) || [];
  };

  for (const planned of first.items) {
    // An item whose refusal turned out to be this device's own earlier upload
    // is tried once more straight away, from the adopted revision, so what was
    // logged since goes up now rather than at the next change.
    let adoptedEarlier = false;
    for (;;) {
      if (isCancelled()) return stopped("cancelled");
      // Look again at the record as it is now: another tab may have done this one.
      const item = planNow().items.find((x) => sameItem(x, planned));
      if (!item) break;

      const out = await upload(item);
      if (out.ok) {
        finish(item, out.revision);
        result.uploaded += 1;
        break;
      }
      if (out.failed) {
        warn("an automatic backup upload didn't go through.", out.error);
        if (out.failed === "connection") return stopped("connection");
        result.failed += 1; // this one stays waiting; the others still go
        break;
      }

      // Refused. Never retried and never forced; first make sure it's real.
      const read = await readRow(client, userId, item);
      if (!read.ok) {
        if (read.failed === "connection") return stopped("connection");
        result.failed += 1;
        break;
      }
      const verdict = judgeRefusal(item, localOf(item), read.row, sentOf(item));
      if (verdict.kind === "same") {
        finish(item, verdict.revision, verdict.fingerprint);
        result.resolved += 1;
        if (verdict.earlier && !adoptedEarlier) {
          adoptedEarlier = true;
          continue;
        }
        break;
      }
      if (verdict.kind === "missing") {
        if (item.action === "delete") {
          finish(item, null);
          result.resolved += 1;
          break;
        }
        const again = await upload({ ...item, action: "add" });
        if (again.ok) {
          finish(item, again.revision);
          result.uploaded += 1;
          break;
        }
        if (again.failed) {
          if (again.failed === "connection") return stopped("connection");
          result.failed += 1;
          break;
        }
        // refused again: someone just added it. Fall through and hold it.
      }
      // Pass 122: a deletion wins over a change made on another device (the owner's rule,
      // 2026-10-23). The row is live but has moved on (practice logged elsewhere), so the
      // deletion is tried ONCE more against the revision just read, instead of being held.
      // Only deleted_at is set: nothing is erased, and what the other device logged stays in
      // the row, so the piece can still be brought back from "Recently deleted". The one
      // exception to "a refusal is never retried".
      if (item.action === "delete" && verdict.kind === "differs" && read.row && read.row.deleted_at == null) {
        const again = await upload({ ...item, expectedRevision: read.row.revision });
        if (again.ok) {
          finish(item, again.revision);
          result.uploaded += 1;
          break;
        }
        if (again.failed === "connection") return stopped("connection");
        // failed, or refused again (the row moved a second time): left waiting, not held,
        // so the next run tries again against what is there then
        result.failed += 1;
        break;
      }
      hold(item);
      break;
    }
  }
  result.remaining = planNow().count;
  return result;
}

/* ---- words --------------------------------------------------------- */

// "just now", "5 minutes ago", "3 hours ago", "2 days ago".
export function describeAgo(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${plural(minutes, "minute", "minutes")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour", "hours")} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "day", "days")} ago`;
}

const MAX_HELD_NAMES = 3;
function heldNames(held) {
  const names = held.pieces.map((p) => (p.deletedHere ? "a piece deleted here" : p.name));
  const shown = names.slice(0, MAX_HELD_NAMES).join("; ");
  return names.length > MAX_HELD_NAMES ? `${shown}; and ${names.length - MAX_HELD_NAMES} more` : shown;
}

function heldTitle(held) {
  const n = held.pieces.length;
  if (n > 0 && held.technique) return `${n} ${plural(n, "piece", "pieces")} and the technique library changed on another device`;
  if (n > 0) return `${n} ${plural(n, "piece", "pieces")} changed on another device`;
  return "The technique library changed on another device";
}

// The one case waiting won't fix: something was changed in the account by
// another device, so this device's copy hasn't been uploaded over it.
export function describeHeld(held) {
  const n = held.pieces.length;
  return n > 0 ? `${heldTitle(held)}: ${heldNames(held)}` : heldTitle(held);
}

// The banner's two lines. `held` is { pieces: [{ name, deletedHere }], technique }.
export function describeHeldBanner(held) {
  const names = held.pieces.length > 0 ? `${heldNames(held)}. ` : "";
  return {
    title: heldTitle(held),
    sub: `${names}This device's copy is unchanged and hasn't been uploaded over the account's. Everything else keeps backing up. Press Review to settle it.`,
  };
}

// The one quiet line in the Account panel, or null (before the first backup,
// or nothing to say). The account service not answering replaces everything
// (it's the more urgent message). Otherwise the held message (if any) and the
// normal line are shown TOGETHER (Pass 115): the held message, then what's
// true of everything else: changes waiting, else when it was last backed up.
//   tone: "ok" (backed up), "quiet" (waiting, or not answering), "problem" (held)
export function describeSyncStatus({ now, firstBackupDone, backedUpAt, waiting, held, failures }) {
  if (!firstBackupDone) return null;
  if (failures >= NOT_ANSWERING_AFTER) {
    return { tone: "quiet", text: "The account service isn't answering. Everything is still saved on this device." };
  }
  const isHeld = !!held && (held.pieces.length > 0 || !!held.technique);
  let rest = null;
  if (waiting > 0) rest = `${waiting} ${plural(waiting, "change", "changes")} waiting to back up`;
  else if (backedUpAt != null) rest = `Backed up ${describeAgo(now - backedUpAt)}`;
  if (isHeld) {
    // "Everything else" because the held item is the one thing not backing up.
    const tail = rest == null ? "" : waiting > 0 ? ` ${rest}.` : ` Everything else ${rest.charAt(0).toLowerCase()}${rest.slice(1)}.`;
    return { tone: "problem", text: `${describeHeld(held)}.${tail}` };
  }
  if (waiting > 0) return { tone: "quiet", text: rest };
  if (backedUpAt != null) return { tone: "ok", text: rest };
  return null;
}

/* ------------------------------------------------------------------ */
/*  Getting things from the account (Pass 112)                         */
/*                                                                     */
/*  Restore onto a device, "Get changes", and Review (settling a piece */
/*  held as "changed on another device") are ONE flow. It reads the    */
/*  account's rows, turns them into the same kind of candidates a      */
/*  backup file gives the import path, and merges them with the        */
/*  import's own functions (findMatchingPiece, mergeImportedPiece,     */
/*  mergeImportedTechnique), so what a merge does is already known and */
/*  tested. Nothing here removes anything from this device, and the    */
/*  only thing it writes to the account is marking a duplicate copy    */
/*  deleted (Design D: marked, never erased).                          */
/*                                                                     */
/*  Everything below the two network readers is pure.                  */
/* ------------------------------------------------------------------ */

// Reads the account's rows for a restore / get-changes / review. Never throws.
//   { status: "ok", rows: { pieces, technique } }   (rows as readAccountRows gives them)
//   { status: "stopped", reason: "connection" | "signed-out" | "other" }
export async function fetchAccountCopy({ userId, getClient = loadBackend }) {
  const client = await getClient();
  if (!client) return { status: "stopped", reason: "connection" };
  const session = await client.auth.getSession();
  const sessionUser = session && session.data && session.data.session && session.data.session.user;
  if (!sessionUser || sessionUser.id !== userId) {
    return { status: "stopped", reason: session && session.error && isConnectionProblem(session.error) ? "connection" : "signed-out" };
  }
  const read = await readAccountRows(client, userId);
  if (!read.ok) return { status: "stopped", reason: reasonFor(read.error) };
  return { status: "ok", rows: { pieces: read.pieces, technique: read.technique } };
}

// Pass 120: only the rows an automatic update is about: these pieces by id (a
// page of ids at a time, so the address stays short) and, when asked, the
// technique row. Same shape and reasons as fetchAccountCopy; never throws.
export async function fetchChangedAccountRows({ userId, ids = [], technique = false, getClient = loadBackend }) {
  try {
    const client = await getClient();
    if (!client) return { status: "stopped", reason: "connection" };
    const session = await client.auth.getSession();
    const sessionUser = session && session.data && session.data.session && session.data.session.user;
    if (!sessionUser || sessionUser.id !== userId) {
      return { status: "stopped", reason: session && session.error && isConnectionProblem(session.error) ? "connection" : "signed-out" };
    }
    const pieces = [];
    for (let i = 0; i < ids.length; i += PAGE_SIZE) {
      const { data, error } = await client
        .from("pieces")
        .select("id, revision, deleted_at, data")
        .eq("user_id", userId)
        .in("id", ids.slice(i, i + PAGE_SIZE));
      if (error) return { status: "stopped", reason: reasonFor(error) };
      (data || []).forEach((r) => pieces.push(r));
    }
    let trow = null;
    if (technique) {
      const t = await client.from("technique").select("revision, data").eq("user_id", userId);
      if (t.error) return { status: "stopped", reason: reasonFor(t.error) };
      trow = (t.data && t.data[0]) || null;
    }
    return { status: "ok", rows: { pieces, technique: trow } };
  } catch (e) {
    return { status: "stopped", reason: reasonFor(e) };
  }
}

// Reads this account's signed-in session the way every reader here does: the client, and
// that the session is THIS account's. Returns { client } or { stopped: { status, reason } }.
async function clientForAccount(userId, getClient) {
  const client = await getClient();
  if (!client) return { stopped: { status: "stopped", reason: "connection" } };
  const session = await client.auth.getSession();
  const sessionUser = session && session.data && session.data.session && session.data.session.user;
  if (!sessionUser || sessionUser.id !== userId) {
    return { stopped: { status: "stopped", reason: session && session.error && isConnectionProblem(session.error) ? "connection" : "signed-out" } };
  }
  return { client };
}

// Pass 122: the account's pieces deleted within the 30-day window, for "Recently deleted"
// (each row's saved data comes with it, so a name and a count can be shown). Same shape
// and reasons as fetchAccountCopy; never throws. Only rows marked deleted at or after
// the cutoff are asked for.
//   { status: "ok", rows: [{ id, revision, deleted_at, data }] } or { status: "stopped", reason }
export async function fetchDeletedPieces({ userId, now = Date.now(), getClient = loadBackend }) {
  try {
    const got = await clientForAccount(userId, getClient);
    if (got.stopped) return got.stopped;
    const { client } = got;
    const cutoff = deletedCutoffIso(now);
    const rows = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await client
        .from("pieces")
        .select("id, revision, deleted_at, data")
        .eq("user_id", userId)
        .gte("deleted_at", cutoff)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) return { status: "stopped", reason: reasonFor(error) };
      const list = data || [];
      list.forEach((r) => rows.push(r));
      if (list.length < PAGE_SIZE) break;
    }
    return { status: "ok", rows };
  } catch (e) {
    return { status: "stopped", reason: reasonFor(e) };
  }
}

// Pass 122: bring a deleted piece back, for "Keep it" (this device still holds it) and
// "Restore" (the list). Only deleted_at is cleared, and only "if still at revision N":
// `expectedRevision` is the revision the person was looking at (null: whatever is read
// here), and a row that has moved since is refused, never overwritten.
//   { status: "kept", revision, data }  the mark is cleared; `data` is the row's saved copy
//   { status: "live", revision, data }  it is not marked deleted any more (already back)
//   { status: "moved" }                 the row changed since the person looked; nothing changed
//   { status: "combined" }              a duplicate that a combine marked deleted: never brought back on its own
//   { status: "gone" }                  there is no such row
//   { status: "stopped", reason }       not reached ("connection" | "signed-out" | "other")
export async function bringBackDeletedPiece({ userId, id, expectedRevision = null, getClient = loadBackend }) {
  try {
    const got = await clientForAccount(userId, getClient);
    if (got.stopped) return got.stopped;
    const { client } = got;
    const read = await client.from("pieces").select("id, revision, deleted_at, data").eq("user_id", userId).eq("id", id);
    if (read.error) return { status: "stopped", reason: reasonFor(read.error) };
    const row = (read.data && read.data[0]) || null;
    if (!row) return { status: "gone" };
    if (row.deleted_at == null) return { status: "live", revision: row.revision, data: row.data };
    if (isObject(row.data) && typeof row.data.mergedInto === "string" && row.data.mergedInto !== "") return { status: "combined" };
    if (expectedRevision != null && row.revision !== expectedRevision) return { status: "moved" };
    const r = await restorePieceRow(client, userId, id, row.revision);
    if (r.ok) return { status: "kept", revision: r.revision, data: row.data };
    if (r.conflict) return { status: "moved" };
    return { status: "stopped", reason: failureKind(r) };
  } catch (e) {
    return { status: "stopped", reason: reasonFor(e) };
  }
}

// How many live (not marked deleted) pieces the account holds, without
// downloading any piece data: the welcome screen's "Restore 12 pieces" button.
//   { status: "ok", count } or { status: "stopped", reason }
export async function countLiveAccountPieces({ userId, getClient = loadBackend }) {
  const client = await getClient();
  if (!client) return { status: "stopped", reason: "connection" };
  const session = await client.auth.getSession();
  const sessionUser = session && session.data && session.data.session && session.data.session.user;
  if (!sessionUser || sessionUser.id !== userId) {
    return { status: "stopped", reason: session && session.error && isConnectionProblem(session.error) ? "connection" : "signed-out" };
  }
  let count = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await client
      .from("pieces")
      .select("id, deleted_at")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { status: "stopped", reason: reasonFor(error) };
    const got = data || [];
    count += got.filter((r) => r.deleted_at == null).length;
    if (got.length < PAGE_SIZE) break;
  }
  return { status: "ok", count };
}

export function describeFetchProblem(reason) {
  if (reason === "connection") return NO_CONNECTION_MESSAGE;
  if (reason === "signed-out") return "You're signed out. Sign in and try again.";
  return "Couldn't read your account. Try again in a moment.";
}

export function describeRestoreButton(count) {
  return `Restore ${count} ${plural(count, "piece", "pieces")} from your account`;
}

/* ------------------------------------------------------------------ */
/*  Noticing that another device changed something (Pass 116)          */
/*                                                                     */
/*  A light read of the account (each piece's id, revision and         */
/*  deleted mark, and the technique row's revision; NEVER a piece's    */
/*  data), repeated while someone is signed in, sorted by a pure       */
/*  function into what "Get changes" would bring. It only NOTICES:     */
/*  nothing here changes the account, this device's pieces or the      */
/*  device record, and nothing is applied or merged (Passes 117 on).   */
/*                                                                     */
/*  A device's own upload is never "newer": the record's revision is   */
/*  updated the moment the account confirms the upload, so the row     */
/*  and the record agree.                                              */
/* ------------------------------------------------------------------ */

// A window regaining focus (or the page becoming visible) starts a check at
// most this often; and while the page stays visible a check is due this often.
// Pass 120 (decided by the owner, 2026-10-15): every MINUTE, not every five, so
// a change made on another device shows up (or, with "Update automatically from
// other devices" on, arrives) in about a minute. Each check reads only ids,
// revision numbers and deleted dates, about 3 KB.
export const CHECK_FOCUS_GAP_MS = 60 * 1000;
export const CHECK_EVERY_MS = 60 * 1000;
// How often the page asks "is a check due?" (a local clock look, no request).
// Quarter of CHECK_EVERY_MS: a look every minute would, with timer drift, space
// checks one to two minutes apart instead of about one.
export const CHECK_TICK_MS = 15 * 1000;

// The light read. Same shape and reasons as the other reads, and like them it
// never throws:
//   { status: "ok", rows: { pieces: [{ id, revision, deleted_at }], technique: { revision } | null } }
//   { status: "stopped", reason: "connection" | "signed-out" | "other" }
// A server error (5xx), a timeout or no answer at all is "connection": the
// same "the service isn't answering" the uploads report.
export async function checkAccountChanges({ userId, getClient = loadBackend }) {
  try {
    const client = await getClient();
    if (!client) return { status: "stopped", reason: "connection" };
    const session = await client.auth.getSession();
    const sessionUser = session && session.data && session.data.session && session.data.session.user;
    if (!sessionUser || sessionUser.id !== userId) {
      return { status: "stopped", reason: session && session.error && isConnectionProblem(session.error) ? "connection" : "signed-out" };
    }
    const pieces = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const res = await client
        .from("pieces")
        .select("id, revision, deleted_at")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (res.error) return { status: "stopped", reason: failureKind(res) };
      const got = res.data || [];
      got.forEach((r) => pieces.push({ id: r.id, revision: r.revision, deleted_at: r.deleted_at == null ? null : r.deleted_at }));
      if (got.length < PAGE_SIZE) break;
    }
    const t = await client.from("technique").select("revision").eq("user_id", userId);
    if (t.error) return { status: "stopped", reason: failureKind(t) };
    const trow = t.data && t.data[0];
    return { status: "ok", rows: { pieces, technique: trow ? { revision: trow.revision } : null } };
  } catch (e) {
    return { status: "stopped", reason: reasonFor(e) };
  }
}

// Pure. Sorts the light rows against this device's record and the pieces it
// holds. Every piece lands in at most one list (ids, sorted):
//   held         the piece is already held as "changed on another device"
//                (Pass 111): known, shown by its own message, never counted again
//   newer        the account holds it (live) at a higher revision than the
//                record says this device last saw
//   added        a live row this device has neither a piece nor a record for
//   deleted      a row marked deleted that this device still holds
//   needsReview  this device holds it, the account has a live row, and the
//                record has no revision for it (Pass 110's "different at first
//                backup": nothing says the two ever matched)
// plus the technique row: `techniqueNewer` (its revision is above the record's)
// or `techniqueHeld` (already held, so not counted as newer).
// A piece this device deleted (a record entry, no piece) is never "added", and
// a row behind the record's revision is never "newer".
export function classifyAccountChanges({ rows, accountRecord, localPieceIds }) {
  const out = { newer: [], added: [], deleted: [], held: [], needsReview: [], techniqueNewer: false, techniqueHeld: false };
  const acct = accountRecord || emptyAccountRecord();
  const entries = acct.pieces || {};
  const here = new Set(localPieceIds || []);
  const seen = new Set();
  ((rows && rows.pieces) || []).forEach((row) => {
    if (!row || row.id == null || seen.has(row.id)) return;
    seen.add(row.id);
    const id = row.id;
    const entry = entries[id];
    const holdsIt = here.has(id);
    const hasRevision = !!entry && Number.isFinite(entry.revision);
    if (entry && entry.held && (holdsIt || entry.deletedHere)) {
      out.held.push(id);
    } else if (row.deleted_at != null) {
      if (holdsIt) out.deleted.push(id);
    } else if (holdsIt) {
      if (!hasRevision) out.needsReview.push(id);
      else if (Number.isFinite(row.revision) && row.revision > entry.revision) out.newer.push(id);
    } else if (!entry) {
      out.added.push(id);
    }
  });
  ["newer", "added", "deleted", "held", "needsReview"].forEach((k) => out[k].sort());
  const trow = rows && rows.technique;
  const tentry = acct.technique;
  if (trow && Number.isFinite(trow.revision)) {
    if (tentry && tentry.held) out.techniqueHeld = true;
    else if (tentry && Number.isFinite(tentry.revision) && trow.revision > tentry.revision) out.techniqueNewer = true;
  }
  return out;
}

// Is a check due? `trigger` says why it's being asked:
//   "startup" (sign-in is known) and "online" (the connection came back): always
//   "focus" (the window regained focus, or the page became visible): at most
//   once a minute, so the two events a return to the window can fire make one request
//   "interval" (the page asked on its own clock): every minute (CHECK_EVERY_MS)
// A clock that moved back makes a check due rather than hiding it for an hour.
export function checkIsDue({ trigger, now, lastStartedAt }) {
  if (trigger === "startup" || trigger === "online") return true;
  const since = lastStartedAt == null ? Infinity : now - lastStartedAt;
  if (since < 0) return true;
  if (trigger === "focus") return since >= CHECK_FOCUS_GAP_MS;
  if (trigger === "interval") return since >= CHECK_EVERY_MS;
  return false;
}

// Remembers when the last check started, so the throttle above is applied to
// every caller alike, and never runs two checks at once. `run` resolves to
// { ran: false, why } when it declined (the page is hidden, a check is already
// going, or it's too soon), else { ran: true, result } with checkAccountChanges'
// answer. `reset` forgets everything (signed out, or another account).
export function createAccountChecker({ getClient = loadBackend, now = Date.now } = {}) {
  let lastStartedAt = null;
  let running = false;
  return {
    async run({ trigger, userId, visible = true }) {
      if (!visible) return { ran: false, why: "hidden" };
      if (running) return { ran: false, why: "running" };
      const at = now();
      if (!checkIsDue({ trigger, now: at, lastStartedAt })) return { ran: false, why: "too-soon" };
      running = true;
      lastStartedAt = at;
      try {
        return { ran: true, result: await checkAccountChanges({ userId, getClient }) };
      } finally {
        running = false;
      }
    },
    reset() {
      lastStartedAt = null;
      running = false;
    },
  };
}

// "success" (the service answered), "failure" (it didn't: counts toward the
// same "isn't answering" count the uploads use, and shows no error of its own)
// or "idle" (nothing ran, or the person is signed out: neither).
export function checkOutcome(out) {
  if (!out || !out.ran || !out.result) return "idle";
  if (out.result.status === "ok") return "success";
  return out.result.reason === "signed-out" ? "idle" : "failure";
}

// A check's rows are only believed if nothing that writes the device record
// (an upload, a manual backup, "Get changes") ran while it was reading, and
// none is running now: otherwise the rows may already include this device's
// own upload while the record doesn't yet, which would read as "newer".
// `recordBefore` / `recordNow` are the account's entry of the device record.
export function checkRowsUsable({ recordBefore, recordNow, busy }) {
  return !busy && sameData(recordBefore, recordNow);
}

// The one added line in the Account panel, or null when there's nothing to say.
export function describeAccountChanges(changes) {
  if (!changes) return null;
  const pieces = changes.newer.length + changes.added.length + changes.deleted.length;
  const parts = [];
  if (pieces > 0) parts.push(`${pieces} ${plural(pieces, "piece", "pieces")}`);
  if (changes.techniqueNewer) parts.push("the technique library");
  if (parts.length === 0) return null;
  return `Changes from another device: ${parts.join(" and ")}. Press Get changes.`;
}

/* ---- automatic updates (Pass 120) --------------------------------- */

// What an automatic update is about, from the last check (classifyAccountChanges):
// the pieces the account holds at a higher revision, the ones it holds that this
// device doesn't, and the technique row if it is newer. With the switch OFF
// nothing is ever a target, so the app behaves exactly as after Pass 116: it
// notices (describeAccountChanges) and "Get changes" is the way in. Pieces held
// as "changed on another device" and pieces with no recorded revision
// (needsReview) are never targets.
//
// Pass 122: a piece the account marks deleted is a target, but only one deleted
// within the 30-day window (`deletions.recent`, from deletionsElsewhere; the owner's
// rule: a deletion always wins, and what is removed by itself can be brought back from
// Recently deleted). Older deletions are only listed, as they always were.
export function autoUpdateTargets({ deviceRecord, userId, changes, deletions = null }) {
  if (!changes || !autoUpdateOn(deviceRecord, userId)) return { on: false, pieceIds: [], technique: false };
  const removals = deletions && Array.isArray(deletions.recent) ? deletions.recent : [];
  return { on: true, pieceIds: [...new Set([...changes.added, ...changes.newer, ...removals])].sort(), technique: !!changes.techniqueNewer };
}

// Merge BEFORE upload. A piece with a change waiting here and a newer copy in the
// account would be refused by "save only if still at revision N" and held. With
// the switch on, the upload run first brings the account's copy in (merging the
// parts, or holding the piece if a part conflicts) and only then sends the merged
// result. Given the last check and what this device holds, these are the pieces
// (and whether the technique library) for which that has to happen first.
export function needsMergeBeforeUpload({ pieces, technique, accountRecord, changes }) {
  const none = { pieceIds: [], technique: false };
  if (!changes) return none;
  const entries = (accountRecord && accountRecord.pieces) || {};
  const have = pieces || {};
  const pieceIds = (changes.newer || []).filter((id) => hasOwn(have, id) && !nothingWaitingHere(have[id], entries[id]));
  const tentry = accountRecord && accountRecord.technique;
  const techniqueFirst = !!changes.techniqueNewer && !!technique && !!tentry && typeof tentry.fingerprint === "string" && techniqueFingerprint(technique) !== tentry.fingerprint;
  return { pieceIds, technique: techniqueFirst };
}

export const PIECE_UPDATED_NOTE = "This piece was updated from another device.";

export function andList(names, cap = 3) {
  const shown = names.slice(0, cap);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

// The Account panel's line after an automatic update, or null when nothing was
// changed here. `names` are the pieces that were added, replaced or merged; `removed`
// (Pass 122) the pieces taken away because they were deleted on another device.
//   "Updated from another device: Ballade No. 1, and the technique library."
//   "Removed because it was deleted on another device: Etude."
export function describeAutoUpdate({ names = [], technique = false, removed = [] }) {
  const pieces = [...new Set(names)];
  const gone = [...new Set(removed)];
  const lines = [];
  if (pieces.length > 0 || technique) {
    const list = pieces.length > 0 ? andList(pieces) : "";
    const text = pieces.length > 0 ? (technique ? `${list}, and the technique library` : list) : "the technique library";
    lines.push(`Updated from another device: ${text}.`);
  }
  if (gone.length > 0) lines.push(`Removed because ${gone.length === 1 ? "it was" : "they were"} deleted on another device: ${andList(gone)}.`);
  return lines.length > 0 ? lines.join(" ") : null;
}

// Pass 122: the page-wide lines after an automatic update removed pieces that were deleted
// on another device. A removal that took practice with it (sessions this device never
// backed up) gets a red line of its own that says how many, and that the piece can come
// back but those sessions can't; a removal of the piece that was OPEN gets one plain
// line, because the page just changed under the person. Anything else is only the quiet
// line in the Account panel (describeAutoUpdate), so this returns [] for most removals.
//   removed: [{ name, lostSessions }]   openName: the removed piece that was open, or null
export function describeAutoRemoved(removed, openName = null) {
  const lines = [];
  (removed || []).forEach((r) => {
    if (r.lostSessions > 0) {
      const many = r.lostSessions > 1;
      lines.push({
        text:
          `${r.name} was deleted on another device, so it was removed here too. ${many ? `${r.lostSessions} sessions` : "1 session"} you logged here since your last backup ` +
          `went with it. You can bring the piece back from Recently deleted in Settings for ${RECENTLY_DELETED_DAYS} days, but not ${many ? "those sessions" : "that session"}.`,
        problem: true,
      });
    } else if (openName && r.name === openName) {
      lines.push({ text: `${r.name} was deleted on another device, so it was removed here too.` });
    }
  });
  return lines;
}

// Pass 122: pieces the account marks deleted that the person is asked about (the switch is
// off, or the deletion is older than 30 days, or it was a duplicate left alone).
//   "Ballade No. 1 was deleted on another device."
export function describeDeletedElsewhere(names = []) {
  const list = [...new Set(names)];
  if (list.length === 0) return null;
  return list.length === 1 ? `${list[0]} was deleted on another device.` : `${list.length} pieces were deleted on another device: ${andList(list)}.`;
}

// The one quiet banner for them: a title and a line saying what the two buttons do.
// `unsynced`: this device holds changes the account never got for the piece (or, with
// several, for at least one). "Delete it here too" would throw those away with one click,
// so the banner says so, the way the Account panel's list and the "Get changes" window do.
export function describeDeletedBanner(names = [], { unsynced = false } = {}) {
  const title = describeDeletedElsewhere(names);
  if (!title) return null;
  const one = new Set(names).size === 1;
  let sub;
  if (one) {
    sub = unsynced
      ? "It's still on this device, and it has changes your account never got. If you delete it here too, those changes are lost. If you keep it, the piece comes back in your account and on every device, with those changes."
      : "It's still on this device. Delete it here too, or keep it: it comes back in your account and on every device.";
  } else {
    sub = unsynced
      ? "They're still on this device, and some have changes your account never got. Choose what to do with each one in Settings, under Account."
      : "They're still on this device. Choose what to do with each one in Settings, under Account.";
  }
  return { title, sub };
}

// Pass 122: what happened when someone pressed "Keep it" or "Restore" (bringBackDeletedPiece's
// answer), as one line for the page. `restored`: it came from Recently deleted.
//   { text, problem? }
export function describeBringBack({ status, name, restored = false, reason = null }) {
  const piece = name || "This piece";
  if (status === "kept") {
    return {
      text: restored
        ? `Restored ${piece}. It's back on this device and in your account, and it will reappear on your other devices.`
        : `Kept ${piece}. It's back in your account, and it will reappear on your other devices.`,
    };
  }
  if (status === "live") return { text: `${piece} is already back in your account.` };
  if (status === "moved") return { text: `${piece} changed in your account since you looked, so nothing was changed. Look again, then try once more.`, problem: true };
  if (status === "combined") return { text: `${piece} was combined into another piece, so it can't be kept on its own.`, problem: true };
  if (status === "gone") return { text: `${piece} is no longer in your account, so there is nothing to bring back.`, problem: true };
  return { text: `Nothing was changed. ${describeFetchProblem(reason)}`, problem: true };
}

// The line while a change waits for a piece to be free:
//   "Changes to Ballade No. 1 will be applied when you're done with it."
export function describeAutoPending(names = []) {
  const list = [...new Set(names)];
  if (list.length === 0) return null;
  return `Changes to ${andList(list)} will be applied when you're done with ${list.length === 1 ? "it" : "them"}.`;
}

// The account's rows as import candidates:
//   pieces:     [{ id, revision, piece }]   live rows, each run through
//               validateAndMigratePiece (the same as a local load), the row's
//               id being the piece's id
//   deleted:    [{ id, revision, name, deletedAt, mergedInto, data }]
//               rows marked deleted: never candidates
//   unreadable: [{ id, revision }]          live rows that couldn't be read
//   technique:  { technique, revision, unreadable, skippedItems }  the technique
//               row read the way a backup's technique block is (so an
//               unreadable block, or unreadable scales, are reported, not
//               skipped silently)
export function accountRowsToCandidates(accountRows) {
  const rows = accountRows || {};
  const out = { pieces: [], deleted: [], unreadable: [], technique: { technique: null, revision: null, unreadable: false, skippedItems: 0 } };
  (rows.pieces || []).forEach((row) => {
    if (!row || row.id == null) return;
    if (row.deleted_at != null) {
      out.deleted.push({
        id: row.id,
        revision: row.revision,
        name: row.data && typeof row.data.name === "string" ? row.data.name : null,
        // Pass 122: when it was deleted, which piece a combine put it into (a duplicate, not a
        // deletion anyone made), and the saved data (to count what was never backed up)
        deletedAt: row.deleted_at,
        mergedInto: isObject(row.data) && typeof row.data.mergedInto === "string" && row.data.mergedInto !== "" ? row.data.mergedInto : null,
        data: row.data,
      });
      return;
    }
    let piece = null;
    try {
      piece = isObject(row.data) ? validateAndMigratePiece({ ...row.data, id: row.id }) : null;
    } catch (e) {
      piece = null;
    }
    // `raw` (Pass 122) is the row's saved data exactly as read: a combine sends it back
    // with one note added when it marks this copy deleted
    if (piece) out.pieces.push({ id: row.id, revision: row.revision, piece, raw: row.data });
    else out.unreadable.push({ id: row.id, revision: row.revision });
  });
  const trow = rows.technique;
  if (trow && trow.data !== undefined) {
    const read = readBackupTechnique(JSON.stringify({ technique: trow.data }));
    out.technique = { technique: read.technique, revision: trow.revision, unreadable: read.unreadable, skippedItems: read.skippedItems };
  }
  return out;
}

/* ---- the no-ask rule ----------------------------------------------- */

// Does this device have nothing waiting to upload for this piece? Its
// fingerprint is what the device record says was last synced with the account.
export function nothingWaitingHere(localPiece, entry) {
  return !!entry && entry.revision !== undefined && typeof entry.fingerprint === "string" && pieceFingerprint(localPiece) === entry.fingerprint;
}

// Has the account changed this piece since this device last synced it? By the
// account's revision, not by either device's clock.
export function accountHasNewerCopy(row, entry) {
  return !!entry && entry.revision !== undefined && Number.isFinite(row.revision) && row.revision > entry.revision;
}

// THE no-ask rule: a piece matched by id, with nothing waiting here, that the
// account has changed since: take the account's copy without asking. Nothing
// on this device can be lost, because nothing here was waiting to upload. Any
// piece changed on both sides (or one this device can't vouch for) gets the
// picker instead.
export function canTakeAccountCopyWithoutAsking({ localPiece, entry, row }) {
  return nothingWaitingHere(localPiece, entry) && accountHasNewerCopy(row, entry);
}

// Review settles what's held, and only that: the account's rows for the pieces
// this device holds as "changed on another device" (and its technique row, if
// that's held). Rows marked deleted are kept only for held pieces, so a held
// piece whose row was deleted elsewhere is still offered "Delete it here too".
//
// Pass 121: `excludeIds` leaves named pieces out. The Review flow asks about a piece
// held with recorded conflicts one question at a time (planSettle) and never shows
// it in this whole-piece picker, so once it has had its turn it is excluded here.
export function restrictCandidatesToHeld(candidates, accountRecord, excludeIds = []) {
  const entries = (accountRecord && accountRecord.pieces) || {};
  const excluded = new Set(excludeIds || []);
  const isHeld = (id) => !!(entries[id] && entries[id].held) && !excluded.has(id);
  const techniqueHeld = !!(accountRecord && accountRecord.technique && accountRecord.technique.held);
  return {
    pieces: candidates.pieces.filter((c) => isHeld(c.id)),
    deleted: candidates.deleted.filter((d) => isHeld(d.id)),
    unreadable: candidates.unreadable.filter((u) => isHeld(u.id)),
    technique: techniqueHeld ? candidates.technique : { technique: null, revision: null, unreadable: false, skippedItems: 0 },
  };
}

// A piece this device deletes because the account already has it deleted: the
// device forgets the piece without it counting as an upload (syncedAt stays),
// so no second "deleted" is ever sent for a row that's already marked.
export function withPieceDropped(deviceRecord, userId, id) {
  return changeAccount(deviceRecord, userId, (a) => {
    delete a.pieces[id];
  });
}

/* ---- planning ------------------------------------------------------ */

// Pass 120, automatic updates only: a piece changed on both sides, with a
// recorded base (the fingerprint of each part as last synced), goes to Pass 117's
// engine instead of a question.
//   kind "merge"    every part merges cleanly: `merged` is the piece to keep
//   kind "conflict" a part (or the whole piece) was changed differently on both
//                   sides: nothing is merged, `conflicts` lists which parts
//                   (fingerprints only), to be held until Pass 121 asks
//   kind "same"     nothing of the account's changes anything here
//   kind "ask"      the engine can't tell (no usable base): left as it always was
function engineVerdict(local, remote, baseParts) {
  const plan = planPieceMerge({ local, remote, base: baseParts });
  if (plan.status === "merged") return { kind: "merge", merged: plan.merged };
  if (plan.status === "conflicts" || plan.status === "whole-piece-conflict") {
    const conflicts =
      plan.status === "whole-piece-conflict"
        ? [{ part: WHOLE_PIECE_PART, kind: "whole-piece", local: null, remote: null, base: null }]
        : plan.conflicts.map((c) => ({ part: c.part, kind: c.kind, local: c.localFingerprint, remote: c.remoteFingerprint, base: c.baseFingerprint }));
    return { kind: "conflict", conflicts };
  }
  if (plan.status === "identical" || plan.status === "local-only") return { kind: "same" };
  return { kind: "ask" };
}

// What a settling step may act on: a held piece answered about, or one that turned out to
// match (or to be a clean newer copy) by the time the answers came. Nothing else.
const SETTLE_KINDS = ["settle", "same", "take"];

// Walks the account's pieces in order against this device's, the way the
// import path does, so two account rows with the same name collapse into one
// piece here (the second is a "combine" with the first).
//   kind "new"     : not on this device
//   kind "same"    : already matches (alignCreatedAt: matches except for its
//                    created date, which a file import re-stamps)
//   kind "take"    : the no-ask rule: replace with the account's copy
//   kind "ask"     : changed on both sides, or this device can't vouch for its
//                    copy: the picker
//   kind "combine" : the same piece under a different id (matched by name):
//                    merged into this device's piece, the other row to be marked
//                    deleted (otherRow)
// A piece this device deleted whose deletion hasn't gone up yet is skipped
// (listed in skippedDeletedHere), never brought back.
//   kind "settle"  : (Pass 121, only when `settle` is given) a held piece the person is
//                    answering questions about: `plan` is Pass 117's engine run with
//                    their answers (`settle[id]`, { [part]: "local" | "remote" | "both" })
function walkAccountCandidates({ candidates, localPieces, accountRecord, only = null, automatic = false, settle = null }) {
  const entries = (accountRecord && accountRecord.pieces) || {};
  // A piece here that the account marks deleted is never what another copy is
  // combined into: it's the extra copy that was marked deleted when two were
  // combined elsewhere, so the surviving copy comes in as a new piece instead
  // (and this one is offered "Delete it here too").
  const markedDeleted = new Set(((candidates && candidates.deleted) || []).map((d) => d.id));
  const working = {};
  Object.keys(localPieces || {}).forEach((id) => {
    if (!markedDeleted.has(id)) working[id] = localPieces[id];
  });
  const items = [];
  const skippedDeletedHere = [];
  ((candidates && candidates.pieces) || []).forEach((c) => {
    if (only && !only.has(c.id)) return;
    const entry = entries[c.id];
    const name = pieceName(c.piece);
    if (entry && entry.deletedHere) {
      skippedDeletedHere.push({ id: c.id, name });
      return;
    }
    const base = { id: c.id, revision: c.revision, name, piece: c.piece, held: !!(entry && entry.held), matchId: null, alignCreatedAt: false, otherRow: null };
    const match = findMatchingPiece(working, c.piece);
    if (!match) {
      items.push({ ...base, kind: "new" });
      working[c.id] = c.piece;
      return;
    }
    if (match.id === c.id) {
      const sameOnceDatesMatch = Number.isFinite(c.piece.createdAt) && samePiece({ ...match, createdAt: c.piece.createdAt }, c.piece);
      if (samePiece(match, c.piece)) items.push({ ...base, kind: "same", matchId: match.id });
      else if (sameOnceDatesMatch) items.push({ ...base, kind: "same", matchId: match.id, alignCreatedAt: true });
      else if (canTakeAccountCopyWithoutAsking({ localPiece: match, entry, row: c })) items.push({ ...base, kind: "take", matchId: match.id });
      else if (settle && hasOwn(settle, c.id)) {
        items.push({ ...base, kind: "settle", matchId: match.id, plan: planPieceMerge({ local: match, remote: c.piece, base: entry && entry.parts, choices: settle[c.id] }) });
      } else if (automatic && entry && entry.parts) items.push({ ...base, ...engineVerdict(match, c.piece, entry.parts), matchId: match.id });
      else items.push({ ...base, kind: "ask", matchId: match.id });
      return;
    }
    items.push({ ...base, kind: "combine", matchId: match.id, otherRow: { id: c.id, revision: c.revision, raw: c.raw } });
  });
  return { items, skippedDeletedHere };
}

// What the flow would do, without doing it: per account piece, a kind (above);
// the pieces still here that the account marks deleted ("Deleted on another
// device"); the rows that couldn't be read; and the technique row.
export function planAccountMerge({ candidates, localPieces, localTechnique = null, accountRecord, automatic = false, settle = null }) {
  const local = localPieces || {};
  const entries = (accountRecord && accountRecord.pieces) || {};
  const { items, skippedDeletedHere } = walkAccountCandidates({ candidates, localPieces: local, accountRecord, automatic, settle });
  const deletedElsewhere = ((candidates && candidates.deleted) || [])
    .filter((d) => hasOwn(local, d.id))
    .map((d) => ({
      id: d.id,
      revision: d.revision,
      name: pieceName(local[d.id]),
      hasUnsyncedChanges: !nothingWaitingHere(local[d.id], entries[d.id]),
      deletedAt: d.deletedAt || null, // Pass 122
      mergedInto: d.mergedInto || null, // a duplicate that a combine marked deleted: only "Delete it here too"
    }));
  const t = (candidates && candidates.technique) || { technique: null, unreadable: false, skippedItems: 0 };
  const technique = {
    available: !!t.technique,
    same: !!t.technique && !!localTechnique && sameTechnique(localTechnique, t.technique),
    revision: t.revision == null ? null : t.revision,
    unreadable: !!t.unreadable,
    skippedItems: t.skippedItems || 0,
  };
  return { items, skippedDeletedHere, deletedElsewhere, unreadable: (candidates && candidates.unreadable) || [], technique };
}

// Does anything in the plan need a person to look at it? New pieces, pieces
// changed on both sides, copies to combine, and pieces deleted elsewhere do.
// Taking a clean newer copy, and matching what's already the same, don't.
export function planNeedsQuestion(plan) {
  return plan.items.some((i) => i.kind === "new" || i.kind === "ask" || i.kind === "combine") || plan.deletedElsewhere.length > 0;
}

/* ---- applying ------------------------------------------------------ */

// Does the merge, purely: this device's pieces (and technique) in, the merged
// ones out. It re-works the plan from what it's given (never trusting an
// earlier look), over only the pieces in `selectedIds` (null: all).
//   ladderChoices: { [rowId]: "existing" | "imported" } for pieces that were asked
//   orderChoice:   "existing" | "imported", for the switcher order of merged pieces
// Per kind: new pieces are added keeping the account's created date; a clean
// newer copy ("take") replaces this device's piece outright; a "same" piece
// only gets its created date matched; "ask" and "combine" pieces go through
// mergeImportedPiece (practice history is merged, never replaced). Returns
//   pieces        : the new pieces map (nothing removed)
//   firstNewId    : the first piece added, or null
//   entries       : { [pieceId]: { revision, fingerprint, parts } } for the device
//                   record: the account's copy as read, so whatever this device
//                   holds on top of it goes up as an ordinary change
//   markDeleted   : [{ id, revision, name, intoId }] account rows to mark deleted
//                   (the other copy of a combined piece)
//   technique     : { value, changed, stats, entry } or null
//   counts, skippedDeletedHere, becomesChecked (restoring onto an empty device
//   counts as this device's first, checked backup: everything on it came from
//   this account)
//
// `automatic` (Pass 120, "Update automatically from other devices") changes WHAT
// is done, never HOW: the same function, the same entries, the same record. It
// applies by itself only what needs no decision: new pieces, pieces that already
// match, a clean newer copy, a piece changed on both sides whose every part
// merges cleanly (Pass 117's engine, "merge"), and the technique library (Pass
// 118's engine where a base is recorded). It never applies by itself:
//   - a piece with a conflicting part: HELD (out.held, with its conflicts), this
//     device's copy untouched; Review settles it as it always has
//   - a piece the engine can't judge ("ask") or one matched by name under another
//     id ("combine"): left for the person (out.needsYou)
//   - a piece that is already held
//   - (Pass 122) a deletion older than 30 days, a duplicate that a combine marked deleted, and a
//     piece this device never synced (one brought in by hand from a file): listed for the person
//     (out.leftDeleted), never removed. A piece this device synced that the account marks deleted
//     within the window IS removed (out.removed): the owner's rule, a deletion always wins.
// and a piece named in `busyIds` (in use right now) is DEFERRED (out.deferred):
// nothing about it is recorded or changed, so the next run finds it again.
export function applyAccountMerge({
  candidates,
  localPieces,
  localTechnique = null,
  accountRecord,
  selectedIds = null,
  ladderChoices = {},
  orderChoice = "existing",
  includeTechnique = true,
  now = Date.now(),
  automatic = false,
  busyIds = [],
  settle = null,
}) {
  const local = localPieces || {};
  const prior = (accountRecord && accountRecord.pieces) || {};
  const only = selectedIds ? new Set(selectedIds) : null;
  const busy = new Set(busyIds || []);
  const { items, skippedDeletedHere } = walkAccountCandidates({ candidates, localPieces: local, accountRecord, only, automatic, settle });
  const next = { ...local };
  const entries = {};
  const markDeleted = [];
  const counts = { added: 0, took: [], merged: [], combined: [], same: 0, aligned: 0, clearedHeld: 0 };
  const deferred = [];
  const held = [];
  const needsYou = [];
  const names = { added: [], took: [], merged: [] };
  const updatedIds = []; // existing pieces whose copy here was replaced or merged
  const settledIds = []; // Pass 121: held pieces settled by the person's answers
  const upToDateIds = []; // Pass 121: already matching (or a clean newer copy) by the time the answers came: nothing to settle
  const unsettled = []; // Pass 121: answered, but not every conflict was (or a new one appeared), or the piece is gone: nothing changed
  let firstNewId = null;

  const mergeInto = (existing, d) => {
    const ladderChoice = ladderChoices[d.id] === "imported" ? "imported" : "existing";
    // Same as the import path: re-derive everything a stored piece gets on
    // load, and let the schedule re-derive itself (rescheduleMarker cleared).
    return validateAndMigratePiece(
      ensureWorkId({
        ...mergeImportedPiece(existing, d.piece, ladderChoice, orderChoice),
        rescheduleMarker: null,
      })
    );
  };

  items.forEach((d, index) => {
    // Settling answers for the pieces it was asked about and nothing else: it never adds a
    // piece this device no longer has (one deleted while the person was deciding), never
    // combines two pieces by name, and so never marks a row in the account deleted.
    if (settle && !SETTLE_KINDS.includes(d.kind)) return;
    if (automatic) {
      // Never by itself (see above). A held piece waits for Review.
      if (d.held) return;
      if (d.kind === "ask" || d.kind === "combine") {
        needsYou.push({ id: d.id, name: d.name, kind: d.kind });
        return;
      }
      if (d.kind === "conflict") {
        held.push({ id: d.id, name: d.name, conflicts: d.conflicts });
        return;
      }
      // In use right now: not even recorded, so the next run finds it again.
      if (busy.has(d.id) && d.kind !== "new") {
        deferred.push({ id: d.id, name: d.name });
        return;
      }
    }
    // The account's copy as read: its revision, fingerprint and (Pass 117) the
    // fingerprint of each of its parts: the state this device is now synced to.
    const rowEntry = { revision: d.revision, fingerprint: pieceFingerprint(d.piece), parts: piecePartFingerprints(d.piece) };
    if (d.kind === "merge") {
      // Every part merged cleanly. What this device holds beyond the account's
      // copy goes up as an ordinary change, "only if still at revision N". A piece
      // that comes from the account keeps the account's created date.
      next[d.id] = Number.isFinite(d.piece.createdAt) ? { ...d.merged, createdAt: d.piece.createdAt } : d.merged;
      entries[d.id] = rowEntry;
      counts.merged.push(d.name);
      names.merged.push(d.name);
      updatedIds.push(d.id);
    } else if (d.kind === "new") {
      const createdAt = Number.isFinite(d.piece.createdAt) ? d.piece.createdAt : now + index;
      next[d.id] = validateAndMigratePiece({ ...d.piece, createdAt });
      entries[d.id] = rowEntry;
      if (!firstNewId) firstNewId = d.id;
      counts.added += 1;
      names.added.push(d.name);
    } else if (d.kind === "same") {
      if (d.alignCreatedAt) {
        next[d.id] = { ...next[d.id], createdAt: d.piece.createdAt };
        counts.aligned += 1;
      }
      entries[d.id] = rowEntry;
      counts.same += 1;
      if (settle) upToDateIds.push(d.id);
    } else if (d.kind === "take") {
      next[d.id] = { ...d.piece };
      entries[d.id] = rowEntry;
      counts.took.push(d.name);
      names.took.push(d.name);
      updatedIds.push(d.id);
      if (settle) upToDateIds.push(d.id);
    } else if (d.kind === "settle") {
      // Pass 121. Only when the person's answers settle EVERY conflict is anything
      // applied; otherwise (an answer missing, or a new conflict appeared since the
      // questions were asked) the piece is left exactly as it is and stays held.
      const plan = d.plan;
      if (plan.status === "merged" || plan.status === "identical" || plan.status === "local-only") {
        // A piece that comes from the account keeps the account's created date.
        next[d.id] = Number.isFinite(d.piece.createdAt) ? { ...plan.merged, createdAt: d.piece.createdAt } : plan.merged;
        entries[d.id] = rowEntry;
        settledIds.push(d.id);
        updatedIds.push(d.id);
      } else {
        unsettled.push({ id: d.id, name: d.name, status: plan.status, reason: "changed" });
      }
    } else if (d.kind === "ask") {
      const merged = mergeInto(next[d.id], d);
      // A piece that comes from the account keeps the account's created date.
      next[d.id] = Number.isFinite(d.piece.createdAt) ? { ...merged, createdAt: d.piece.createdAt } : merged;
      entries[d.id] = rowEntry;
      counts.merged.push(d.name);
    } else if (d.kind === "combine" && next[d.matchId]) {
      next[d.matchId] = mergeInto(next[d.matchId], d);
      markDeleted.push({ id: d.otherRow.id, revision: d.otherRow.revision, name: d.name, intoId: d.matchId, raw: d.otherRow.raw });
      counts.combined.push(d.name);
    }
  });
  if (settle) {
    // A piece the person answered about that the walk could not settle at all (it is no
    // longer on this device, or this device deleted it and the account does not know yet):
    // said so, never silently dropped, and nothing is changed for it.
    const reached = new Set(items.filter((d) => SETTLE_KINDS.includes(d.kind)).map((d) => d.id));
    Object.keys(settle)
      .filter((id) => (!only || only.has(id)) && !reached.has(id))
      .forEach((id) => {
        const row = ((candidates && candidates.pieces) || []).find((c) => c.id === id);
        unsettled.push({ id, name: pieceName(row ? row.piece : local[id]), status: "gone", reason: "gone" });
      });
  }
  // Pass 122, automatic only: a piece the account marks deleted is removed here by itself,
  // even with practice on it that was never backed up (the owner's rule, 2026-10-23: a
  // deletion always wins). Four things are never removed by themselves and are left for the
  // person, as they always were (`leftDeleted`): a deletion older than the 30-day window
  // (so whatever is removed here can be brought back from Recently deleted), a duplicate
  // that a combine marked deleted (`mergedInto`: nobody deleted it, and this device may hold
  // practice on it that the combine never saw), a piece this device never synced (brought in
  // by hand from a file: the owner's rule is about a piece that lives on her devices, and
  // taking away what she just imported is not that; wasSyncedHere), and, for now, a piece in
  // use (`deferred`: not recorded, so the next run finds it again). The caller drops the
  // record's entry first (withPieceDropped), so no second "deleted" is ever sent, then
  // removes the piece.
  const removed = [];
  const leftDeleted = [];
  if (automatic) {
    ((candidates && candidates.deleted) || []).forEach((d) => {
      if (!hasOwn(local, d.id) || (only && !only.has(d.id))) return;
      const name = pieceName(local[d.id]);
      if (d.mergedInto || !isRecentlyDeleted(d.deletedAt, now) || !wasSyncedHere(prior[d.id])) {
        leftDeleted.push({ id: d.id, name, revision: d.revision });
        return;
      }
      if (busy.has(d.id)) {
        deferred.push({ id: d.id, name });
        return;
      }
      removed.push({ id: d.id, name, lostSessions: sessionsOnlyHere(local[d.id], d.data) });
      delete next[d.id];
    });
  }
  Object.keys(entries).forEach((id) => {
    if (prior[id] && prior[id].held) counts.clearedHeld += 1;
  });

  let technique = null;
  const t = candidates && candidates.technique;
  const techniqueEntry = accountRecord && accountRecord.technique;
  // An automatic update leaves a library that is held for Review.
  const techniqueHeldBack = automatic && !!(techniqueEntry && techniqueEntry.held);
  if (includeTechnique && t && t.technique && localTechnique && !techniqueHeldBack) {
    const merged = mergeImportedTechnique(localTechnique, t.technique);
    // Automatic: Pass 118's engine where a base is recorded (the import merge,
    // which never asks, where it isn't).
    if (automatic) merged.technique = mergeTechniqueFromAccount(localTechnique, t.technique, techniqueEntry && techniqueEntry.parts);
    const accountParts = techniquePartFingerprints(t.technique);
    // Automatic only (Pass 118 open item 5, owner Pass 120): the library kept here can
    // equal the account's BY PARTS and still differ by whole-library fingerprint (a
    // method switched on and off again leaves an entry holding the defaults: no part,
    // but a different fingerprint). Those are the same library, so the record keeps the
    // fingerprint of the one kept and nothing reads as waiting. Recording the account's
    // fingerprint instead made this device upload its own version, the other device do
    // the same, and the two trade the library back and forth while both were open.
    const inSyncByParts = automatic && sameData(techniquePartFingerprints(merged.technique), accountParts);
    technique = {
      value: merged.technique,
      // Only a merge that actually changed something is written back: writing
      // an identical library would still bump its updatedAt and go up again.
      changed: !sameTechnique(localTechnique, merged.technique),
      stats: merged.stats,
      // The account's copy as read, with (Pass 118) the fingerprint of each of
      // its parts, like a piece's entry above.
      entry: { revision: t.revision, fingerprint: techniqueFingerprint(inSyncByParts ? merged.technique : t.technique), parts: accountParts },
      clearedHeld: !!(accountRecord && accountRecord.technique && accountRecord.technique.held),
    };
    if (technique.clearedHeld) counts.clearedHeld += 1;
  }

  return {
    pieces: next,
    firstNewId,
    entries,
    markDeleted,
    technique,
    counts,
    skippedDeletedHere,
    becomesChecked: Object.keys(local).length === 0 && counts.added > 0,
    // Pass 120 (automatic only; empty otherwise)
    deferred,
    held,
    needsYou,
    names,
    updatedIds,
    // Pass 121 (settle only; empty otherwise)
    settledIds,
    upToDateIds,
    unsettled,
    // Pass 122 (automatic only; empty otherwise): [{ id, name, lostSessions }] removed here
    // because the account marks them deleted, and [{ id, name, revision }] left alone
    removed,
    leftDeleted,
  };
}

// Pass 120: an automatic update plans from the pieces this device held a moment
// ago. If one of them has been replaced since (an update React had not applied
// yet), the plan is stale for that piece. This redoes it against the copy that
// is there NOW, so a newer change is never overwritten: a clean merge from the
// recorded base is used, and anything else (a conflict, no base) leaves the
// current copy alone and says so, so the caller can hold the piece.
//   { piece, held: null | conflicts }
export function reapplyOnto({ current, accountPiece, baseParts }) {
  if (!baseParts || Object.keys(baseParts).length === 0) return { piece: current, held: [{ part: WHOLE_PIECE_PART, kind: "whole-piece", local: null, remote: null, base: null }] };
  const verdict = engineVerdict(current, accountPiece, baseParts);
  if (verdict.kind === "merge") {
    return { piece: Number.isFinite(accountPiece.createdAt) ? { ...verdict.merged, createdAt: accountPiece.createdAt } : verdict.merged, held: null };
  }
  if (verdict.kind === "same") return { piece: current, held: null };
  return { piece: current, held: verdict.conflicts || [{ part: WHOLE_PIECE_PART, kind: "whole-piece", local: null, remote: null, base: null }] };
}

// Pass 120: the technique library after an automatic update. Pass 118's engine
// where the record holds a base for it; where it doesn't, or the engine can't
// tell, the import merge that never asks and never removes anything. Never throws.
export function mergeTechniqueFromAccount(localTechnique, accountTechnique, baseParts) {
  try {
    if (baseParts && Object.keys(baseParts).length > 0) {
      const plan = planTechniqueMerge({ local: localTechnique, remote: accountTechnique, base: baseParts });
      if (plan.status === "merged") return plan.merged;
      if (plan.status === "identical" || plan.status === "local-only") return localTechnique;
    }
  } catch (e) {
    /* fall back to the import merge */
  }
  return mergeImportedTechnique(localTechnique, accountTechnique).technique;
}

// The device record after a merge: each merged piece (and the technique library)
// recorded at the revision the account was read at, with the fingerprint of the
// account's copy. That clears a "changed on another device" mark, and whatever
// this device holds beyond the account's copy is simply a change waiting, sent
// "only if still at revision N" like any other. `checkedAt` is set only when
// given and not already set (restoring onto an empty device).
export function withAccountCopyRecorded(deviceRecord, userId, { entries = {}, technique = null, checkedAt = null }) {
  return changeAccount(deviceRecord, userId, (a) => {
    Object.keys(entries).forEach((id) => {
      const e = entries[id];
      a.pieces[id] = e.parts ? { revision: e.revision, fingerprint: e.fingerprint, parts: e.parts } : { revision: e.revision, fingerprint: e.fingerprint };
    });
    if (technique) {
      a.technique = technique.parts
        ? { revision: technique.revision, fingerprint: technique.fingerprint, parts: technique.parts }
        : { revision: technique.revision, fingerprint: technique.fingerprint };
    }
    if (checkedAt != null && a.checkedAt == null) a.checkedAt = checkedAt;
  });
}

// Marks the account's other copy of a combined piece deleted: deleted_at, and (Pass 122)
// a note of which piece it went into inside the row's saved data (markPieceRowCombined),
// "only if still at the revision it was read at", so nothing is erased and a copy someone
// changed meanwhile is left alone.
//   { marked: [{ id, name }], failed: [{ id, name, reason: "refused" | "connection" | "other" }] }
export async function markOtherCopiesDeleted({ items, userId, getClient = loadBackend, now = Date.now }) {
  const out = { marked: [], failed: [] };
  if (!items || items.length === 0) return out;
  const client = await getClient();
  const fail = (item, reason) => out.failed.push({ id: item.id, name: item.name, reason });
  if (!client) {
    items.forEach((item) => fail(item, "connection"));
    return out;
  }
  const session = await client.auth.getSession();
  const sessionUser = session && session.data && session.data.session && session.data.session.user;
  if (!sessionUser || sessionUser.id !== userId) {
    items.forEach((item) => fail(item, "other"));
    return out;
  }
  for (const item of items) {
    try {
      const at = new Date(now()).toISOString();
      // Pass 122: with the row's data in hand, note where the duplicate went (see
      // markPieceRowCombined); without it, the plain mark as before.
      const r = isObject(item.raw) && item.intoId
        ? await markPieceRowCombined(client, userId, item.id, item.revision, at, item.raw, item.intoId)
        : await deletePieceRow(client, userId, item.id, item.revision, at);
      if (r.ok) out.marked.push({ id: item.id, name: item.name });
      else if (r.conflict) fail(item, "refused");
      else fail(item, failureKind(r));
    } catch (e) {
      fail(item, "other");
    }
  }
  return out;
}

/* ---- words --------------------------------------------------------- */

function nameList(names, cap = 5) {
  const shown = names.slice(0, cap).join("; ");
  return names.length > cap ? `${shown}; and ${names.length - cap} more` : shown;
}

// The result of a restore / get-changes / review, in plain words, as lines
// ({ text, problem? }) for the page (never a browser pop-up). `applied` is
// applyAccountMerge's counts; `technique` its technique part (or null);
// `marked` is markOtherCopiesDeleted's answer (null if none were due);
// `notMarked` says the other copies were left because this device hasn't done
// its first backup yet (so the combined piece can't go up to replace them).
export function describeAccountMergeResult({ mode = "changes", applied, technique = null, unreadable = 0, skippedItems = 0, techniqueUnreadable = false, marked = null, notMarked = [] }) {
  const lines = [];
  const c = applied;
  if (c.added > 0) {
    lines.push({
      text: mode === "restore" ? `Restored ${c.added} ${plural(c.added, "piece", "pieces")} from your account.` : `Added ${c.added} new ${plural(c.added, "piece", "pieces")} from your account.`,
    });
  }
  if (c.took.length > 0) {
    lines.push({ text: `Took your account's newer ${plural(c.took.length, "copy", "copies")} of ${c.took.length} ${plural(c.took.length, "piece", "pieces")}: ${nameList(c.took)}.` });
  }
  if (c.merged.length > 0) {
    lines.push({
      text: `Merged ${c.merged.length} ${plural(c.merged.length, "piece", "pieces")} changed in both places: ${nameList(c.merged)}. What's here beyond your account's copy goes up as an ordinary change.`,
    });
  }
  c.combined.forEach((name) => {
    const failed = marked && marked.failed.find((f) => f.name === name);
    const left = notMarked.includes(name);
    if (left) {
      lines.push({ text: `Combined the two copies of ${name} here. Your account's other copy is left as it is until this device has made its first backup; press Get changes from your account again afterwards to tidy it.` });
    } else if (failed) {
      lines.push({
        text: `Combined the two copies of ${name} here, but the other copy in your account couldn't be marked deleted${failed.reason === "refused" ? " (it changed meanwhile)" : ""}. Press Get changes from your account again to retry.`,
        problem: true,
      });
    } else {
      lines.push({ text: `Combined the two copies of ${name}. The extra copy in your account is marked deleted, not erased.` });
    }
  });
  if (c.aligned > 0) lines.push({ text: `Matched the created date of ${c.aligned} ${plural(c.aligned, "piece", "pieces")} to your account.` });
  if (c.clearedHeld > 0) lines.push({ text: `Cleared "changed on another device" on ${c.clearedHeld} ${plural(c.clearedHeld, "item", "items")}.` });
  if (technique && technique.stats) {
    const t = technique.stats;
    lines.push({
      text:
        `Technique library merged (${t.itemsAdded} ${plural(t.itemsAdded, "scale", "scales")} added, ` +
        `${t.temposUpdated} newer ${plural(t.temposUpdated, "tempo", "tempos")}, ${t.methodsAdded} ${plural(t.methodsAdded, "method", "methods")} added` +
        (skippedItems > 0 ? `, ${skippedItems} unreadable ${plural(skippedItems, "scale", "scales")} skipped` : "") +
        "). Nothing was removed.",
    });
  }
  if (techniqueUnreadable) lines.push({ text: "The technique library in your account couldn't be read, so it wasn't merged.", problem: true });
  if (unreadable > 0) {
    lines.push({ text: `${unreadable} ${plural(unreadable, "piece", "pieces")} in your account couldn't be read and ${plural(unreadable, "was", "were")} skipped.`, problem: true });
  }
  if (lines.length === 0) lines.push({ text: "Everything here already matches your account." });
  return lines;
}

/* ---- settling a held piece, one question at a time (Pass 121) --------- */

// What Pass 120's automatic update recorded about a held piece: the parts that
// conflicted (`{ part, kind, local, remote, base }`, fingerprints only). The
// values are not kept, so they are read again from the account's copy when a
// question is asked (planSettle). [] for a piece that isn't held, or is held
// without a list (a refused upload, an import).
export function heldConflicts(accountRecord, id) {
  const e = accountRecord && accountRecord.pieces && accountRecord.pieces[id];
  return e && e.held && Array.isArray(e.conflicts) ? e.conflicts : [];
}

// The pieces Review asks about one question at a time: held WITH a recorded list.
// A piece held without one still goes through the whole-piece picker, exactly as
// before (planSettle also hands back any it can't ask about, as `fallbackIds`).
export function heldIdsWithConflicts(accountRecord) {
  const entries = (accountRecord && accountRecord.pieces) || {};
  return Object.keys(entries)
    .filter((id) => heldConflicts(accountRecord, id).length > 0)
    .sort();
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-01" -> "Nov 1" (with the year when it isn't this year: "Nov 1, 2027").
function shortDate(iso, thisYear) {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m || !MONTH_NAMES[Number(m[2]) - 1]) return null;
  const text = `${MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[3])}`;
  return Number(m[1]) === thisYear ? text : `${text}, ${m[1]}`;
}

const quoted = (text, max = 60) => `"${text.length > max ? `${text.slice(0, max - 3)}...` : text}"`;
const countOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const humanize = (field) => {
  const words = String(field).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const describeKey = (k) => (isObject(k) && typeof k.tonic === "string" ? `${k.tonic}${k.quality ? ` ${k.quality}` : ""}` : null);

function describeDifficulty(v) {
  if (!Array.isArray(v)) return null;
  const hard = v.filter((x) => x === 3).length;
  const medium = v.filter((x) => x === 2).length;
  const parts = [];
  if (hard) parts.push(`${hard} difficult`);
  if (medium) parts.push(`${medium} challenging`);
  return parts.length ? `${parts.join(" and ")} ${hard + medium === 1 ? "measure" : "measures"}` : "every measure workable";
}

function describeSections(v) {
  if (!Array.isArray(v)) return null;
  if (v.length > 4) return countOf(v.length, "section", "sections");
  const named = v
    .filter((s) => isObject(s))
    .map((s) => `${typeof s.name === "string" && s.name.trim() ? `${s.name.trim()} ` : ""}(${formatRange(s.start, s.end)})`);
  return named.length ? named.join(", ") : "none";
}

const countField = (one, many) => (v) => (Array.isArray(v) ? (v.length ? countOf(v.length, one, many) : "none") : null);
const unitField = (one, many) => (v) => (Number.isFinite(v) ? countOf(v, one, many) : null);

// How a piece field is named and shown in a question. Anything not listed gets its
// name made readable and its value summarized (see describeFieldValue), so a field
// added later still produces a question that says something.
const FIELD_INFO = {
  name: { label: "Name" },
  workName: { label: "Work title" },
  composer: { label: "Composer" },
  notes: { label: "Notes" },
  status: { label: "Status", format: (v) => ({ active: "active", paused: "paused", archived: "archived" })[v] },
  markedLearnedElsewhere: { label: "Marked as learned elsewhere", format: (v) => (v === true ? "yes" : v === false ? "no" : null) },
  totalMeasures: { label: "Number of measures", format: unitField("measure", "measures") },
  measureDifficulty: { label: "Difficulty ratings", format: describeDifficulty },
  sections: { label: "Sections", format: describeSections },
  recurringPairs: { label: "Repeated passages", format: countField("passage", "passages") },
  startDate: { label: "Start date", date: true },
  scheduleMode: { label: "Schedule type", format: (v) => ({ days: "finish by a date", minutes: "minutes per day" })[v] },
  daysToLearn: { label: "Days to learn", format: unitField("day", "days") },
  minutesPerDay: { label: "Minutes per day", format: unitField("minute", "minutes") },
  targetDate: { label: "Target date", date: true },
  practiceDaysPerWeek: { label: "Practice days per week", format: unitField("day", "days") },
  chunkMode: { label: "Chunk size setting", format: (v) => ({ auto: "automatic", custom: "custom" })[v] },
  customChunkSize: { label: "Chunk size", format: unitField("measure", "measures") },
  chunkSplitPoints: { label: "Split chunks", format: countField("split", "splits") },
  targetBPM: { label: "Target tempo", format: (v) => (Number.isFinite(v) ? `${v} bpm` : null) },
  homeKey: { label: "Home key", format: describeKey },
  otherKeys: { label: "Other keys", format: (v) => (Array.isArray(v) ? (v.length ? v.map(describeKey).filter(Boolean).join(", ") : "none") : null) },
  bpmZones: { label: "Tempo zones", format: countField("zone", "zones") },
  recordings: { label: "Recordings", format: countField("recording", "recordings") },
  documents: { label: "Documents", format: countField("document", "documents") },
  sortOrder: { label: "Place in your piece list" },
  rescheduleMarker: {
    label: "Reschedule",
    format: (v) => (v === null || v === undefined ? "not rescheduled" : isObject(v) ? (Number.isFinite(v.asOfDay) ? `rescheduled on day ${v.asOfDay}` : "rescheduled") : null),
  },
  lastPlayedDate: { label: "Last played", date: true },
  memoryAnchors: { label: "Memory notes", format: (v) => (isObject(v) ? (Object.keys(v).length ? countOf(Object.keys(v).length, "note", "notes") : "none") : null) },
  ladderConfig: { label: "Maintenance ladder settings" },
  revival: { label: "Revival", format: (v) => (isObject(v) ? (v.active ? "in progress" : "not active") : null) },
  troubleSpotsEnabled: { label: "Focus spots", format: (v) => (v === true ? "on" : v === false ? "off" : null) },
  troubleSpotDefaultMinutes: { label: "Minutes per focus spot", format: unitField("minute", "minutes") },
  manualOverallConfidence: { label: "Overall confidence", format: (v) => (Number.isFinite(v) ? `${v}%` : null) },
};

function describeFieldValue(field, value, year) {
  const info = FIELD_INFO[field] || {};
  if (field === "createdAt" && Number.isFinite(value)) {
    try {
      return shortDate(new Date(value).toISOString().slice(0, 10), year) || "not set";
    } catch (e) {
      return "not set"; // a number no date can hold: say so rather than fail the whole question
    }
  }
  if (value === undefined || value === null) return (info.format && info.format(value)) || "not set";
  if (info.date) {
    const d = shortDate(value, year);
    if (d) return d;
  }
  if (info.format) {
    const t = info.format(value);
    if (t) return t;
  }
  if (typeof value === "string") return value.trim() === "" ? "blank" : quoted(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return countOf(value.length, "entry", "entries");
  if (isObject(value)) return countOf(Object.keys(value).length, "setting", "settings");
  return String(value);
}

const labelOfField = (field) => (field === "createdAt" ? "Date added" : (FIELD_INFO[field] && FIELD_INFO[field].label) || humanize(field));

// What a progress entry's key stands for, in words a person recognizes. `piece` is
// this device's copy (the chunk grid the question is about).
function describeProgressTarget(piece, id) {
  if (id === "__consolidation__") return "the full run-through";
  if (id === "__cold_start__") return "the cold-start check";
  if (typeof id === "string" && id.startsWith("sr_")) {
    const section = ((piece && piece.sections) || []).find((s) => s && `sr_${s.id}` === id);
    if (!section) return "a section run-through";
    return `the run-through of ${typeof section.name === "string" && section.name.trim() ? section.name.trim() : formatRange(section.start, section.end)}`;
  }
  if (typeof id === "string" && id.startsWith("st_")) return "a run-through of two sections together";
  try {
    const chunk = generateAllChunks(piece).all.find((c) => c.id === id);
    if (chunk) {
      if (chunk.kind === "transition") return `the transition at ${formatRange(chunk.start, chunk.end)}`;
      if (chunk.kind === "combo") return `the focus block at ${formatRange(chunk.start, chunk.end)}`;
      return formatRange(chunk.start, chunk.end);
    }
  } catch (e) {
    /* a piece that can't be chunked: fall through to the plain wording */
  }
  return "a chunk that is no longer in the plan";
}

// Where a progress entry sits in the piece (its first measure), to ask in order.
function progressOrder(piece, id) {
  try {
    const chunk = generateAllChunks(piece).all.find((c) => c.id === id);
    if (chunk) return chunk.start;
  } catch (e) {
    /* no order known */
  }
  return Number.MAX_SAFE_INTEGER;
}

const OPTION_LOCAL = "This device's";
const OPTION_REMOTE = "The other device's";

// "Days to learn, minutes per day and reschedule", as the start of a sentence
const followerWords = (fields) => {
  const names = fields.map((f) => labelOfField(f).toLowerCase());
  const text = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join("");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function fieldQuestion(c, year, followers = []) {
  const label = labelOfField(c.field);
  const here = describeFieldValue(c.field, c.local, year);
  const there = describeFieldValue(c.field, c.remote, year);
  // Two values that read the same but aren't (a reschedule "on day 3" on both) must not look like a
  // question with one answer: say so instead of printing the same words twice.
  const text =
    here === there
      ? `${label}: ${here} on both devices, but the two plans differ in detail.`
      : here.length + there.length <= 60
      ? `${label}: ${here} on this device, ${there} on your other device.`
      : `${label} is different on the two devices.\nThis device: ${here}\nYour other device: ${there}`;
  return {
    part: c.part,
    kind: "field",
    title: label,
    text,
    // Numbers worked out from this one (see DATE_LINKED_FIELDS) go with whichever is kept.
    ...(followers.length > 0 ? { detail: `${followerWords(followers)} follow${followers.length === 1 ? "s" : ""} the ${label.toLowerCase()} you keep.` } : {}),
    options: [
      { value: "local", label: OPTION_LOCAL },
      { value: "remote", label: OPTION_REMOTE },
    ],
    kept: { local: `this device's ${lowerFirst(label)}`, remote: `the other device's ${lowerFirst(label)}` },
  };
}

// The answers that throw away what one device logged. Said plainly (the person has
// asked for this, and "left out" understated it), and flagged `removes` so the screen
// before anything is applied can repeat it. Keeping THIS device's record also removes
// the other device's sessions from the account (the next upload replaces its copy);
// keeping the other device's removes only what this device logged, which the account
// never had. Nothing is said, and nothing flagged, when no session would go.
function removalHint(count, where, fromAccount) {
  if (!(count > 0)) return {};
  const who = count === 1 ? "The session" : `The ${count} sessions`;
  return { hint: `${who} logged on ${where} will be removed${fromAccount ? ", from your account too" : ""}. This can't be undone.`, removes: true };
}

function progressQuestion(c, piece) {
  const what = describeProgressTarget(piece, c.id);
  const mine = isObject(c.local) ? c.local : null;
  const theirs = isObject(c.remote) ? c.remote : null;
  const kept = {
    local: `this device's record of ${what}`,
    remote: `the other device's record of ${what}`,
    both: `both devices' sessions for ${what}`,
  };
  const keysOf = (entry) => new Set((Array.isArray(entry && entry.sessions) ? entry.sessions : []).map((s) => fingerprint(s)));
  const here = keysOf(mine);
  const there = keysOf(theirs);
  const onlyHere = [...here].filter((k) => !there.has(k)).length;
  const onlyThere = [...there].filter((k) => !here.has(k)).length;
  const two = [
    { value: "local", label: OPTION_LOCAL, ...removalHint(onlyThere, "your other device", true) },
    { value: "remote", label: OPTION_REMOTE, ...removalHint(onlyHere, "this device", false) },
  ];
  const base = { part: c.part, kind: "progress", title: `Practice record: ${what}`, target: what, kept };
  if (mine && theirs) {
    if (onlyHere > 0 && onlyThere > 0) {
      return {
        ...base,
        text: `You practiced ${what} on both devices since you last synced.`,
        options: [
          {
            value: "both",
            label: "Both devices' sessions",
            recommended: true,
            hint: "Every session from both devices is kept. The rest of the record (tempo, stage, next review) follows whichever device practiced last.",
          },
          ...two,
        ],
      };
    }
    return {
      ...base,
      text: `The practice record for ${what} was changed differently on the two devices.`,
      detail: `Sessions: ${here.size} on this device, ${there.size} on your other device.`,
      options: two,
    };
  }
  return {
    ...base,
    text: mine
      ? `The practice record for ${what} is on this device, but your other device no longer has it.`
      : `The practice record for ${what} is on your other device, but this device no longer has it.`,
    options: two,
  };
}

function wholePieceQuestion() {
  return {
    part: WHOLE_PIECE_PART,
    kind: "whole-piece",
    title: "Chunk layout and practice",
    text: "The chunk layout was changed on one device, while practice or a reschedule was recorded on the other, so the two can't be put together.",
    options: [
      {
        value: "local",
        label: "This device's piece",
        hint: "Practice and changes made on your other device will be removed, from your account too. This can't be undone.",
        removes: true,
      },
      {
        value: "remote",
        label: "The other device's piece",
        hint: "Practice and changes made on this device will be removed. This can't be undone.",
        removes: true,
      },
    ],
    kept: { local: "this device's whole piece", remote: "the other device's whole piece" },
  };
}

// EXACTLY one question per conflict the engine found, in a steady order: ordinary
// fields first (by name), then practice records in the order of the piece. The one
// exception is the numbers worked out from a conflicting target date (`plan.linkedToDate`):
// they go with the date the person keeps, so they are not asked about, and the date's
// question says so. `plan` is Pass 117's answer for the two copies (planPieceMerge);
// `piece` is this device's copy.
// A question: { part, kind, title, text, detail?, options: [{ value, label, hint?,
// recommended? }], kept: { local, remote, both? } } (`kept` finishes the sentence
// "Settled <piece>: kept ...", see describeKept).
export function buildSettleQuestions({ plan, piece, year = new Date().getFullYear() }) {
  if (!plan) return [];
  if (plan.status === "whole-piece-conflict") return [wholePieceQuestion()];
  const followers = new Set(plan.linkedToDate || []);
  const fields = plan.conflicts
    .filter((c) => c.kind !== "progress" && !followers.has(c.field))
    .sort((a, b) => labelOfField(a.field).localeCompare(labelOfField(b.field)));
  const practice = plan.conflicts
    .filter((c) => c.kind === "progress")
    .sort((a, b) => progressOrder(piece, a.id) - progressOrder(piece, b.id) || String(a.id).localeCompare(String(b.id)));
  return [
    ...fields.map((c) => fieldQuestion(c, year, c.field === "targetDate" ? DATE_LINKED_FIELDS.filter((f) => followers.has(f)) : [])),
    ...practice.map((c) => progressQuestion(c, piece)),
  ];
}

// Has every question an answer that is one of its own options?
export function answeredAll(questions, answers) {
  const given = answers || {};
  return questions.every((q) => q.options.some((o) => o.value === given[q.part]));
}

// The words for what was kept, one per answered question, in the order asked.
export function describeKept(questions, answers) {
  const given = answers || {};
  return questions.map((q) => (q.kept && q.kept[given[q.part]]) || null).filter(Boolean);
}

// What Review will ask, without doing anything: the account's rows for the pieces
// held WITH a recorded list, read against this device's copies (the engine is run
// again now, so the questions reflect both copies as they are today, not as they
// were when the piece was held). Pure: it changes nothing and writes nothing, and it
// never throws (a piece it fails on goes to `errored`, and to the picker).
//   ids: only these pieces (the re-read just before applying asks about one)
//   build: makes a piece's questions (a test can hand in one that fails)
//   items: [{ id, name, revision, status, questions, reason }]
//     status "questions": one question per conflict, to be answered one at a time
//     status "ready":     nothing left to decide (the copies fit together now, or
//                         match); still waits for the person to say go
//   fallbackIds: held-with-a-list pieces this can't ask about (no readable row in
//                the account, or the engine can't tell). They keep going through
//                the whole-piece picker, exactly as before.
//   errored:     [{ id, name }] the ones among them that failed unexpectedly (also in
//                fallbackIds), so the page can say they were not asked about
export function planSettle({ candidates, localPieces, accountRecord, now = Date.now(), ids: only = null, build = buildSettleQuestions }) {
  const out = { items: [], fallbackIds: [], errored: [] };
  const ids = heldIdsWithConflicts(accountRecord).filter((id) => !only || only.includes(id));
  if (ids.length === 0) return out;
  const wanted = new Set(ids);
  const rows = ((candidates && candidates.pieces) || []).filter((c) => wanted.has(c.id));
  const nameFor = (id) => {
    try {
      const row = rows.find((c) => c.id === id);
      return pieceName(row ? row.piece : localPieces && localPieces[id]);
    } catch (e) {
      return "This piece";
    }
  };
  const failed = (id) => {
    out.fallbackIds.push(id);
    out.errored.push({ id, name: nameFor(id) });
  };
  const subset = {
    pieces: rows,
    deleted: [],
    unreadable: [],
    technique: { technique: null, revision: null, unreadable: false, skippedItems: 0 },
  };
  const settle = Object.fromEntries(ids.map((id) => [id, {}]));
  let items;
  try {
    items = walkAccountCandidates({ candidates: subset, localPieces, accountRecord, settle }).items;
  } catch (e) {
    ids.forEach(failed);
    return out;
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const year = new Date(now).getFullYear();
  ids.forEach((id) => {
    const d = byId.get(id);
    if (!d) {
      out.fallbackIds.push(id);
      return;
    }
    try {
      const item = { id, name: d.name, revision: d.revision, questions: [], reason: d.kind };
      if (d.kind === "same" || d.kind === "take") {
        out.items.push({ ...item, status: "ready" });
      } else if (d.kind === "settle" && (d.plan.status === "conflicts" || d.plan.status === "whole-piece-conflict")) {
        out.items.push({ ...item, status: "questions", reason: d.plan.status, questions: build({ plan: d.plan, piece: localPieces[id], year }) });
      } else if (d.kind === "settle" && (d.plan.status === "merged" || d.plan.status === "identical" || d.plan.status === "local-only")) {
        out.items.push({ ...item, status: "ready", reason: d.plan.status });
      } else {
        out.fallbackIds.push(id);
      }
    } catch (e) {
      failed(id);
    }
  });
  return out;
}

// The result of settling, in plain words ({ text, problem? } lines for the page,
// never a browser pop-up).
//   settled:   [{ name, kept: [phrases from describeKept] }]  (kept empty: nothing was asked)
//   unsettled: [{ name, reason }]  nothing was applied, and the piece is as it was. The
//              reason says why, because "changed again" for everything misled:
//                "changed" (the default) the piece moved on while the person decided
//                "gone"    it is no longer there to settle (deleted, or settled elsewhere)
//                "error"   something failed on this device
//   fallback:  [{ name }]  pieces that could not be asked about one question at a time
//              and went through the whole-piece choice instead
export function describeSettleResult({ settled = [], unsettled = [], fallback = [] }) {
  const lines = [];
  settled.forEach((s) => {
    lines.push({ text: s.kept && s.kept.length > 0 ? `Settled ${s.name}: kept ${andList(s.kept, 6)}.` : `${s.name} is up to date with your other device.` });
  });
  if (settled.length > 0) lines.push({ text: "Anything here that your account doesn't have yet goes up by itself in a few seconds." });
  unsettled.forEach((u) => {
    const text =
      u.reason === "gone"
        ? `${u.name} is no longer waiting to be settled here (it may have been deleted, or settled in another window), so nothing was changed.`
        : u.reason === "error"
        ? `Something went wrong while settling ${u.name}, so nothing was changed and it is still held. Press Review to try again.`
        : `${u.name} changed again while you were deciding, so nothing was changed and it is still held. Press Review to look at it again.`;
    lines.push({ text, problem: true });
  });
  if (fallback.length > 0) {
    const names = andList(fallback.map((f) => f.name));
    lines.push({ text: `${names} couldn't be asked about one question at a time, so ${fallback.length === 1 ? "it" : "they"} went through the whole-piece choice instead.` });
  }
  return lines;
}

// Just before the last step, the account is read again. When that can't be done nothing
// is applied (the copy this device holds might be out of date), and the page says why in
// the same words as every other failure to reach the account.
export function describeSettleRereadProblem(reason) {
  return `Nothing was changed. ${describeFetchProblem(reason)} You can also choose Decide later.`;
}
