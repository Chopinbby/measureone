/* ------------------------------------------------------------------ */
/*  The account copy: a first backup, checked by reading it back       */
/*  (Pass 110). docs/Accounts-and-Backend.md, Design A to F and J.     */
/*                                                                     */
/*  No React here. The Supabase client comes only from loadBackend()   */
/*  (lib/backend.js), so the library is still downloaded on demand.    */
/*  Every function that talks to the account takes the client as its   */
/*  first argument, so a test can hand it a fake.                      */
/*                                                                     */
/*  This pass only ever ADDS rows. Nothing here changes a row the      */
/*  account already holds and nothing deletes: a row that's already    */
/*  there is compared and reported, never overwritten (Design C).      */
/*  changePieceRow / changeTechniqueRow ("save only if still at        */
/*  revision N") are built and tested now, but nothing calls them      */
/*  until Pass 111.                                                    */
/* ------------------------------------------------------------------ */

import { loadBackend, isConnectionProblem, NO_CONNECTION_MESSAGE } from "./backend";

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

// Pure. This device's pieces (a map of id to piece) and technique object
// against the rows read back from the account: for each piece, and for the
// technique row, "matches", "differs" or "not in the account". A row marked
// deleted never counts as a match: the account says the piece is gone.
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
    out.pieces[id] = {
      status: !deleted && sameData(pieces[id], row.data) ? MATCHES : DIFFERS,
      revision: row.revision,
      deleted,
    };
  });
  const trow = rows.technique;
  out.technique = !trow
    ? { status: NOT_IN_ACCOUNT, revision: null }
    : { status: sameData(technique, trow.data) ? MATCHES : DIFFERS, revision: trow.revision };
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
// there first) that's reported as `exists`, never overwritten.
function addResult(error) {
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, exists: true, error };
  return { ok: false, error };
}

export async function addPieceRow(client, userId, id, piece) {
  const { error } = await client
    .from("pieces")
    .insert({ user_id: userId, id, data: piece, schema_version: PIECE_SCHEMA_VERSION });
  return addResult(error);
}

export async function addTechniqueRow(client, userId, technique) {
  const { error } = await client.from("technique").insert({ user_id: userId, data: technique });
  return addResult(error);
}

// Save only if the row is still at the revision this device last saw. The
// filter on revision is what makes it safe: no row back means another device
// changed it first, so this reports a conflict. It never retries, and the
// caller must not retry blindly either. The database raises the revision.
function changeResult({ data, error }) {
  if (error) return { ok: false, error };
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

/* ------------------------------------------------------------------ */
/*  The device record (stays on this device, Design E)                 */
/*                                                                     */
/*  { version, accounts: { [userId]: { pieces: { [id]: { revision,     */
/*  fingerprint } }, technique: { revision, fingerprint } | null,      */
/*  checkedAt } } }. Filed under the signed-in account's user id, so a */
/*  different account on this browser starts empty.                    */
/* ------------------------------------------------------------------ */

export function emptyAccountRecord() {
  return { pieces: {}, technique: null, checkedAt: null };
}

function cleanEntry(e) {
  return isObject(e) && Number.isFinite(e.revision) && typeof e.fingerprint === "string"
    ? { revision: e.revision, fingerprint: e.fingerprint }
    : null;
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
      accounts[uid] = { pieces, technique: cleanEntry(a.technique), checkedAt: Number.isFinite(a.checkedAt) ? a.checkedAt : null };
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
      [userId]: { pieces: { ...before.pieces, ...pieces }, technique: technique || before.technique, checkedAt },
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
    if (f.status === MATCHES) {
      result.backedUp += 1;
      if (wasSent) result.added += 1;
      else result.alreadyThere += 1;
      recordPieces[id] = { revision: f.revision, fingerprint: fingerprint(pieces[id]) };
    } else if (f.status === DIFFERS) {
      (wasSent ? result.mismatched : result.different).push({ id, name: nameOf(id), deleted: f.deleted });
    } else if (tried.has(id) && !wasSent && !existsNow.has(id)) {
      result.notSent.push({ id, name: nameOf(id) });
    } else {
      result.mismatched.push({ id, name: nameOf(id), deleted: false });
    }
  });

  let recordTechnique = null;
  const ft = final.technique;
  if (ft.status === MATCHES) {
    result.technique = "backedUp";
    recordTechnique = { revision: ft.revision, fingerprint: fingerprint(technique) };
  } else if (ft.status === DIFFERS) {
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
const names = (list) => list.map((p) => p.name).join(", ");

// The result as plain lines: [{ text, problem }].
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
    lines.push({ problem: false, text: "Nothing was backed up." });
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
