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
/* ------------------------------------------------------------------ */

import { loadBackend, isConnectionProblem, NO_CONNECTION_MESSAGE } from "./backend";
import {
  validateAndMigratePiece,
  validateAndMigrateTechnique,
  findMatchingPiece,
  mergeImportedPiece,
  mergeImportedTechnique,
  readBackupTechnique,
} from "./storage";
import { ensureWorkId } from "./works";

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

// What JSON would keep of a value: an undefined field vanishes, and the key
// order stops mattering once the two sides are compared key by key.
function toJsonValue(value) {
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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

function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (isObject(v)) {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

function hash53(text, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// A short label for "exactly this content", independent of key order. Not
// security: it's how a later pass can tell that a piece has changed since it
// was uploaded, without keeping a second copy of it on the device.
export function fingerprint(value) {
  const text = canon(toJsonValue(value));
  return hash53(text, 0).toString(16) + "-" + hash53(text, 1).toString(16);
}

/* ---- "the same" means the same after a reload (Pass 111) ------------ */

// The app doesn't always hold a piece in exactly the shape a reload gives it.
// A chunk's first practice record is created without `tier1Done` and
// `troubleSpots`, which loading then adds (as false and null); a technique
// task is built without a `tempo`, which loading adds as null. Compared as
// they stand, a piece that was uploaded and then simply reloaded would look
// changed and go up again: a pointless extra revision after most days of
// practice, and, once a second device exists, a false "changed on another
// device". So pieces and the technique library are fingerprinted and compared
// in the form loading would give them: the same functions the load uses, after
// the same trip through JSON that saving and loading make. What's SENT is
// still the app's own copy, untouched. A value that can't be put in that form
// is used as it is.
export function canonicalPiece(piece) {
  const plain = toJsonValue(piece);
  try {
    // validateAndMigratePiece stamps "now" on a piece with no updatedAt and
    // "today" on one with no startDate, which would make the same piece read
    // differently from one call to the next. A piece in this app always has
    // both; a hand-edited row might not, so give those a fixed stand-in.
    const steady = isObject(plain)
      ? { ...plain, ...(plain.updatedAt ? {} : { updatedAt: -1 }), ...(plain.startDate ? {} : { startDate: "1970-01-01" }) }
      : plain;
    const loaded = validateAndMigratePiece(steady);
    return loaded ? toJsonValue(loaded) : plain;
  } catch (e) {
    return plain;
  }
}

export function canonicalTechnique(technique) {
  const plain = toJsonValue(technique);
  if (!isObject(plain)) return plain;
  try {
    return toJsonValue(validateAndMigrateTechnique(plain));
  } catch (e) {
    return plain;
  }
}

export const samePiece = (a, b) => sameData(canonicalPiece(a), canonicalPiece(b));
export const sameTechnique = (a, b) => sameData(canonicalTechnique(a), canonicalTechnique(b));

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
export const techniqueFingerprint = (technique) => cachedFingerprint(technique, canonicalTechnique);

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

/* ------------------------------------------------------------------ */
/*  The device record (stays on this device, Design E)                 */
/*                                                                     */
/*  { version, accounts: { [userId]: { pieces: { [id]: entry },        */
/*  technique: entry | null, checkedAt, syncedAt } } }. An entry is    */
/*  { revision, fingerprint } (what this device last saw and uploaded) */
/*  plus, since Pass 111, `held` (the account moved on, so nothing is  */
/*  uploaded for it) and `deletedHere` (this device deleted it, and    */
/*  the deletion hasn't gone up yet). Filed under the signed-in        */
/*  account's user id, so a different account on this browser starts   */
/*  empty. `checkedAt` is the first backup's read-back check (Pass     */
/*  110); `syncedAt` is the last time an upload landed (Pass 111).     */
/* ------------------------------------------------------------------ */

export function emptyAccountRecord() {
  return { pieces: {}, technique: null, checkedAt: null, syncedAt: null };
}

function cleanEntry(e) {
  if (!isObject(e)) return null;
  const out = {};
  if (Number.isFinite(e.revision) && typeof e.fingerprint === "string") {
    out.revision = e.revision;
    out.fingerprint = e.fingerprint;
  }
  if (e.held === true) out.held = true;
  if (e.deletedHere === true && out.revision !== undefined) out.deletedHere = true;
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
      [userId]: { pieces: { ...before.pieces, ...pieces }, technique: technique || before.technique, checkedAt, syncedAt: before.syncedAt },
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
      recordPieces[id] = { revision: f.revision, fingerprint: pieceFingerprint(pieces[id]) };
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
    recordTechnique = { revision: ft.revision, fingerprint: techniqueFingerprint(technique) };
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
  const draft = { pieces: { ...before.pieces }, technique: before.technique, checkedAt: before.checkedAt, syncedAt: before.syncedAt };
  change(draft);
  return {
    version: ACCOUNT_SYNC_VERSION,
    accounts: { ...(deviceRecord && deviceRecord.accounts ? deviceRecord.accounts : {}), [userId]: draft },
  };
}

// The account now holds this piece at `revision`, as fingerprinted.
export function withPieceUploaded(deviceRecord, userId, id, { revision, fingerprint: print }, at) {
  return changeAccount(deviceRecord, userId, (a) => {
    a.pieces[id] = { revision, fingerprint: print };
    a.syncedAt = at;
  });
}

// The account moved on without this device: nothing is uploaded for it until
// something settles it. Whatever the entry knew about the revision is kept.
export function withPieceHeld(deviceRecord, userId, id) {
  return changeAccount(deviceRecord, userId, (a) => {
    a.pieces[id] = { ...(a.pieces[id] || {}), held: true };
  });
}

// A deleted piece's deletion has gone up (or there was nothing to delete): the
// device has nothing left to remember about it.
export function withPieceForgotten(deviceRecord, userId, id, at) {
  return changeAccount(deviceRecord, userId, (a) => {
    delete a.pieces[id];
    a.syncedAt = at;
  });
}

export function withTechniqueUploaded(deviceRecord, userId, { revision, fingerprint: print }, at) {
  return changeAccount(deviceRecord, userId, (a) => {
    a.technique = { revision, fingerprint: print };
    a.syncedAt = at;
  });
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
export function syncSnapshot({ pieces, technique, userId, storage }) {
  const acct = accountRecordFor(readDeviceRecord(storage), userId);
  const plan = computeWaiting({ pieces, technique, accountRecord: acct });
  const times = [acct.checkedAt, acct.syncedAt].filter((t) => t != null);
  return {
    firstBackupDone: plan.firstBackupDone,
    waiting: plan.count,
    held: plan.held,
    backedUpAt: times.length ? Math.max(...times) : null,
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
// - "missing": the row is gone (a table wiped in the dashboard). Put it back,
//   or for a deletion there's nothing to delete.
// - "differs": the account moved on. Hold it.
function judgeRefusal(item, local, row) {
  if (!row) return { kind: "missing" };
  if (item.action === "delete") return row.deleted_at ? { kind: "same", revision: row.revision } : { kind: "differs" };
  if (item.kind === "piece" && row.deleted_at) return { kind: "differs" };
  const same = item.kind === "technique" ? sameTechnique(local, row.data) : samePiece(local, row.data);
  return same ? { kind: "same", revision: row.revision } : { kind: "differs" };
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
export async function syncWaitingChanges({ pieces, technique, userId, getClient = loadBackend, storage, now = Date.now, isCancelled = () => false }) {
  const result = { status: "done", reason: null, uploaded: 0, resolved: 0, newlyHeld: [], failed: 0, remaining: 0 };
  const accountNow = () => accountRecordFor(readDeviceRecord(storage), userId);
  const planNow = () => computeWaiting({ pieces, technique, accountRecord: accountNow() });
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
  const finish = (item, revision) => {
    const at = now();
    if (item.kind === "technique") {
      save((r) => withTechniqueUploaded(r, userId, { revision, fingerprint: techniqueFingerprint(technique) }, at));
    } else if (item.action === "delete") {
      save((r) => withPieceForgotten(r, userId, item.id, at));
    } else {
      save((r) => withPieceUploaded(r, userId, item.id, { revision, fingerprint: pieceFingerprint(pieces[item.id]) }, at));
    }
  };
  const hold = (item) => {
    if (item.kind === "technique") save((r) => withTechniqueHeld(r, userId));
    else save((r) => withPieceHeld(r, userId, item.id));
    result.newlyHeld.push(item.kind === "technique" ? { kind: "technique" } : { kind: "piece", id: item.id, name: item.name || null });
  };
  const warn = (what, error) => console.warn(`MeasureOne: ${what}`, error && error.message);

  for (const planned of first.items) {
    if (isCancelled()) return stopped("cancelled");
    // Look again at the record as it is now: another tab may have done this one.
    const item = planNow().items.find((x) => sameItem(x, planned));
    if (!item) continue;

    const out = await uploadItem(client, userId, item, pieces, technique, now());
    if (out.ok) {
      finish(item, out.revision);
      result.uploaded += 1;
      continue;
    }
    if (out.failed) {
      warn("an automatic backup upload didn't go through.", out.error);
      if (out.failed === "connection") return stopped("connection");
      result.failed += 1; // this one stays waiting; the others still go
      continue;
    }

    // Refused. Never retried and never forced; first make sure it's real.
    const read = await readRow(client, userId, item);
    if (!read.ok) {
      if (read.failed === "connection") return stopped("connection");
      result.failed += 1;
      continue;
    }
    const verdict = judgeRefusal(item, localOf(item), read.row);
    if (verdict.kind === "same") {
      finish(item, verdict.revision);
      result.resolved += 1;
      continue;
    }
    if (verdict.kind === "missing") {
      if (item.action === "delete") {
        finish(item, null);
        result.resolved += 1;
        continue;
      }
      const again = await uploadItem(client, userId, { ...item, action: "add" }, pieces, technique, now());
      if (again.ok) {
        finish(item, again.revision);
        result.uploaded += 1;
        continue;
      }
      if (again.failed) {
        if (again.failed === "connection") return stopped("connection");
        result.failed += 1;
        continue;
      }
      // refused again: someone just added it. Fall through and hold it.
    }
    hold(item);
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
// or nothing to say). First match wins: the account service not answering
// (everything is affected), then a piece held as changed on another device,
// then changes waiting, then when it was last backed up.
//   tone: "ok" (backed up), "quiet" (waiting, or not answering), "problem" (held)
export function describeSyncStatus({ now, firstBackupDone, backedUpAt, waiting, held, failures }) {
  if (!firstBackupDone) return null;
  if (failures >= NOT_ANSWERING_AFTER) {
    return { tone: "quiet", text: "The account service isn't answering. Everything is still saved on this device." };
  }
  if (held && (held.pieces.length > 0 || held.technique)) return { tone: "problem", text: describeHeld(held) };
  if (waiting > 0) return { tone: "quiet", text: `${waiting} ${plural(waiting, "change", "changes")} waiting to back up` };
  if (backedUpAt != null) return { tone: "ok", text: `Backed up ${describeAgo(now - backedUpAt)}` };
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

// The account's rows as import candidates:
//   pieces:     [{ id, revision, piece }]   live rows, each run through
//               validateAndMigratePiece (the same as a local load), the row's
//               id being the piece's id
//   deleted:    [{ id, revision, name }]    rows marked deleted: never candidates
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
      out.deleted.push({ id: row.id, revision: row.revision, name: row.data && typeof row.data.name === "string" ? row.data.name : null });
      return;
    }
    let piece = null;
    try {
      piece = isObject(row.data) ? validateAndMigratePiece({ ...row.data, id: row.id }) : null;
    } catch (e) {
      piece = null;
    }
    if (piece) out.pieces.push({ id: row.id, revision: row.revision, piece });
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
export function restrictCandidatesToHeld(candidates, accountRecord) {
  const entries = (accountRecord && accountRecord.pieces) || {};
  const isHeld = (id) => !!(entries[id] && entries[id].held);
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
function walkAccountCandidates({ candidates, localPieces, accountRecord, only = null }) {
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
      else items.push({ ...base, kind: "ask", matchId: match.id });
      return;
    }
    items.push({ ...base, kind: "combine", matchId: match.id, otherRow: { id: c.id, revision: c.revision } });
  });
  return { items, skippedDeletedHere };
}

// What the flow would do, without doing it: per account piece, a kind (above);
// the pieces still here that the account marks deleted ("Deleted on another
// device"); the rows that couldn't be read; and the technique row.
export function planAccountMerge({ candidates, localPieces, localTechnique = null, accountRecord }) {
  const local = localPieces || {};
  const entries = (accountRecord && accountRecord.pieces) || {};
  const { items, skippedDeletedHere } = walkAccountCandidates({ candidates, localPieces: local, accountRecord });
  const deletedElsewhere = ((candidates && candidates.deleted) || [])
    .filter((d) => hasOwn(local, d.id))
    .map((d) => ({ id: d.id, revision: d.revision, name: pieceName(local[d.id]), hasUnsyncedChanges: !nothingWaitingHere(local[d.id], entries[d.id]) }));
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

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeysDeep(value[k])]));
  return value;
}

// mergeImportedPiece (lib/storage.js) drops a session that both sides hold by
// comparing its JSON TEXT, which depends on the order of its keys. A backup file
// and this device were both written by this app, so the order agrees; the
// account's rows come back from the database with their keys reordered, so
// without this every session would be kept twice. Putting both sides' sessions
// in one key order first makes the same session read as the same. (The fix
// belongs in mergeSessionArrays itself; see the Pass 112 notes in
// docs/Accounts-and-Backend.md.)
function withComparableSessions(piece) {
  if (!piece || !isObject(piece.progress)) return piece;
  const progress = {};
  Object.keys(piece.progress).forEach((chunkId) => {
    const entry = piece.progress[chunkId];
    if (!isObject(entry)) {
      progress[chunkId] = entry;
      return;
    }
    const out = { ...entry };
    if (Array.isArray(entry.sessions)) out.sessions = entry.sessions.map(sortKeysDeep);
    if (Array.isArray(entry.troubleSpots)) {
      out.troubleSpots = entry.troubleSpots.map((spot) => (isObject(spot) && Array.isArray(spot.sessions) ? { ...spot, sessions: spot.sessions.map(sortKeysDeep) } : spot));
    }
    progress[chunkId] = out;
  });
  return { ...piece, progress };
}

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
//   entries       : { [pieceId]: { revision, fingerprint } } for the device
//                   record: the account's copy as read, so whatever this device
//                   holds on top of it goes up as an ordinary change
//   markDeleted   : [{ id, revision, name, intoId }] account rows to mark deleted
//                   (the other copy of a combined piece)
//   technique     : { value, changed, stats, entry } or null
//   counts, skippedDeletedHere, becomesChecked (restoring onto an empty device
//   counts as this device's first, checked backup: everything on it came from
//   this account)
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
}) {
  const local = localPieces || {};
  const prior = (accountRecord && accountRecord.pieces) || {};
  const only = selectedIds ? new Set(selectedIds) : null;
  const { items, skippedDeletedHere } = walkAccountCandidates({ candidates, localPieces: local, accountRecord, only });
  const next = { ...local };
  const entries = {};
  const markDeleted = [];
  const counts = { added: 0, took: [], merged: [], combined: [], same: 0, aligned: 0, clearedHeld: 0 };
  let firstNewId = null;

  const mergeInto = (existing, d) => {
    const ladderChoice = ladderChoices[d.id] === "imported" ? "imported" : "existing";
    // Same as the import path: re-derive everything a stored piece gets on
    // load, and let the schedule re-derive itself (rescheduleMarker cleared).
    return validateAndMigratePiece(
      ensureWorkId({
        ...mergeImportedPiece(withComparableSessions(existing), withComparableSessions(d.piece), ladderChoice, orderChoice),
        rescheduleMarker: null,
      })
    );
  };

  items.forEach((d, index) => {
    const rowEntry = { revision: d.revision, fingerprint: pieceFingerprint(d.piece) };
    if (d.kind === "new") {
      const createdAt = Number.isFinite(d.piece.createdAt) ? d.piece.createdAt : now + index;
      next[d.id] = validateAndMigratePiece({ ...d.piece, createdAt });
      entries[d.id] = rowEntry;
      if (!firstNewId) firstNewId = d.id;
      counts.added += 1;
    } else if (d.kind === "same") {
      if (d.alignCreatedAt) {
        next[d.id] = { ...next[d.id], createdAt: d.piece.createdAt };
        counts.aligned += 1;
      }
      entries[d.id] = rowEntry;
      counts.same += 1;
    } else if (d.kind === "take") {
      next[d.id] = { ...d.piece };
      entries[d.id] = rowEntry;
      counts.took.push(d.name);
    } else if (d.kind === "ask") {
      const merged = mergeInto(next[d.id], d);
      // A piece that comes from the account keeps the account's created date.
      next[d.id] = Number.isFinite(d.piece.createdAt) ? { ...merged, createdAt: d.piece.createdAt } : merged;
      entries[d.id] = rowEntry;
      counts.merged.push(d.name);
    } else if (d.kind === "combine" && next[d.matchId]) {
      next[d.matchId] = mergeInto(next[d.matchId], d);
      markDeleted.push({ id: d.otherRow.id, revision: d.otherRow.revision, name: d.name, intoId: d.matchId });
      counts.combined.push(d.name);
    }
  });
  Object.keys(entries).forEach((id) => {
    if (prior[id] && prior[id].held) counts.clearedHeld += 1;
  });

  let technique = null;
  const t = candidates && candidates.technique;
  if (includeTechnique && t && t.technique && localTechnique) {
    const merged = mergeImportedTechnique(localTechnique, t.technique);
    technique = {
      value: merged.technique,
      // Only a merge that actually changed something is written back: writing
      // an identical library would still bump its updatedAt and go up again.
      changed: !sameTechnique(localTechnique, merged.technique),
      stats: merged.stats,
      entry: { revision: t.revision, fingerprint: techniqueFingerprint(t.technique) },
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
  };
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
      a.pieces[id] = { revision: entries[id].revision, fingerprint: entries[id].fingerprint };
    });
    if (technique) a.technique = { revision: technique.revision, fingerprint: technique.fingerprint };
    if (checkedAt != null && a.checkedAt == null) a.checkedAt = checkedAt;
  });
}

// Marks the account's other copy of a combined piece deleted: only deleted_at
// is sent, "only if still at the revision it was read at" (deletePieceRow), so
// nothing is erased and a copy someone changed meanwhile is left alone.
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
      const r = await deletePieceRow(client, userId, item.id, item.revision, new Date(now()).toISOString());
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
