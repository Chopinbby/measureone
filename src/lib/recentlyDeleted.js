// Pass 122: a piece deleted on one device is deleted everywhere, with a way back.
//
// The owner's rule (2026-10-23): a deletion always wins, even over practice logged on
// another device; the practice goes with the piece. The safety net is the account's own
// copy: a piece is only ever MARKED deleted there (Design D, the row and its data stay),
// and for RECENTLY_DELETED_DAYS days it can be brought back from "Recently deleted".
//
// Everything here is pure and tested (test/recentlyDeleted.test.mjs). lib/accountSync.js
// does the reading, the removing and the writing; it imports this file, never the other
// way round, so nothing here may import it.

import { canonicalPiece, fingerprint, isObject } from "./pieceMerge";

// Hand-picked, tracked in docs/Research.md ("Account sync timings"). It is both the
// window "Recently deleted" lists and the window inside which a deletion arrives by
// itself on another device: whatever is removed automatically can be brought back.
export const RECENTLY_DELETED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Was this deleted (the account's `deleted_at`, an ISO time) within the window? A time
// that can't be read is never "recent": nothing is ever removed on a guess. A time a
// little in the future (a device clock that is ahead) counts as recent.
export function isRecentlyDeleted(deletedAt, now = Date.now()) {
  const t = typeof deletedAt === "string" ? Date.parse(deletedAt) : NaN;
  if (!Number.isFinite(t)) return false;
  return now - t <= RECENTLY_DELETED_DAYS * DAY_MS;
}

// The oldest `deleted_at` the list asks the account for (an ISO time).
export function deletedCutoffIso(now = Date.now()) {
  return new Date(now - RECENTLY_DELETED_DAYS * DAY_MS).toISOString();
}

// Has this device ever synced this piece with the account? True when the device record
// holds a recorded revision for it (an upload the account confirmed, or the account's copy
// taken here). A piece with no such record only SITS here: brought in by hand from a backup
// file (an import keeps the piece's id, so a piece you deleted and then imported again
// matches the account's deleted row), or a copy from before this device signed in. A bare
// "held" note (what a refused first upload leaves) is not a sync either. The device record
// keeps a revision only together with the fingerprint it belongs to (`cleanEntry`).
export function wasSyncedHere(entry) {
  return !!entry && Number.isFinite(entry.revision);
}

// Of the account's light rows (`id, revision, deleted_at`): the pieces this device still
// HOLDS that the account marks deleted, split three ways:
//   recent    deleted within the window, and this device synced the piece before: with the
//             switch on these are removed by themselves
//   older     deleted before the window: only ever listed
//   unsynced  deleted within the window, but this device never synced the piece (a piece
//             brought in by hand from a file, a copy from before it signed in): only ever
//             listed, never removed by itself. Taking away what a person just imported is the
//             one thing a deletion elsewhere must not do.
// A piece already held as "changed on another device" counts too (its upload was probably
// refused by the deletion), and stays `recent` if it was synced before. A piece this device
// deleted itself (a record entry marked `deletedHere`) is not one: it is already gone here.
//   { ids, recent, older, unsynced }   all sorted; every id is in `ids` and in exactly one other
export function deletionsElsewhere({ rows, entries, localPieceIds, now = Date.now() }) {
  const out = { ids: [], recent: [], older: [], unsynced: [] };
  const here = new Set(localPieceIds || []);
  const seen = new Set();
  ((rows && rows.pieces) || []).forEach((row) => {
    if (!row || row.id == null || seen.has(row.id)) return;
    seen.add(row.id);
    if (row.deleted_at == null || !here.has(row.id)) return;
    const entry = entries && entries[row.id];
    if (entry && entry.deletedHere) return;
    out.ids.push(row.id);
    if (!isRecentlyDeleted(row.deleted_at, now)) out.older.push(row.id);
    else if (!wasSyncedHere(entry)) out.unsynced.push(row.id);
    else out.recent.push(row.id);
  });
  ["ids", "recent", "older", "unsynced"].forEach((k) => out[k].sort());
  return out;
}

// Which of those the person is told about, with the two buttons ("Delete it here too",
// "Keep it"). With the automatic switch OFF: all of them (nothing is removed by itself).
// With it ON: only the ones that are NOT about to be removed, that is the ones older than
// the window, the ones this device never synced, and the ones the automatic path looked at
// and left alone (`leftIds`: a duplicate that a combine marked deleted).
export function deletedForPerson({ deletions, autoOn, leftIds }) {
  if (!deletions) return [];
  if (!autoOn) return [...deletions.ids];
  const left = new Set(leftIds || []);
  const recent = new Set(deletions.recent);
  return deletions.ids.filter((id) => !recent.has(id) || left.has(id));
}

const sessionListsOf = (piece) => {
  // One list per chunk (or run-through) record, and one per focus spot's own log.
  const lists = {};
  const progress = isObject(piece) && isObject(piece.progress) ? piece.progress : {};
  Object.keys(progress).forEach((key) => {
    const entry = progress[key];
    if (!isObject(entry)) return;
    if (Array.isArray(entry.sessions)) lists[`s:${key}`] = entry.sessions;
    if (Array.isArray(entry.troubleSpots)) {
      entry.troubleSpots.forEach((spot, i) => {
        if (isObject(spot) && Array.isArray(spot.sessions)) lists[`t:${key}:${spot.id != null ? spot.id : i}`] = spot.sessions;
      });
    }
  });
  return lists;
};

// How many logged sessions this device has for a piece that the account does not have:
// the practice that goes with it when a deletion arrives (it was never backed up). Both
// sides are read the way a load reads them (canonicalPiece), and sessions are compared by
// content, key order ignored (fingerprint), so a copy that came back through the database
// is not counted as different. `accountData` is the deleted row's saved data.
export function sessionsOnlyHere(localPiece, accountData) {
  try {
    const mine = sessionListsOf(canonicalPiece(localPiece));
    const theirs = isObject(accountData) ? sessionListsOf(canonicalPiece({ ...accountData, id: localPiece && localPiece.id })) : {};
    let count = 0;
    Object.keys(mine).forEach((key) => {
      const there = new Set((theirs[key] || []).map((s) => fingerprint(s)));
      mine[key].forEach((s) => {
        if (!there.has(fingerprint(s))) count += 1;
      });
    });
    return count;
  } catch (e) {
    return 0;
  }
}

const countSessions = (data) => Object.values(sessionListsOf(data)).reduce((n, list) => n + list.length, 0);

// "today", "yesterday", "3 days ago".
export function describeDeletedAgo(deletedAt, now = Date.now()) {
  const t = typeof deletedAt === "string" ? Date.parse(deletedAt) : NaN;
  if (!Number.isFinite(t)) return "recently";
  const days = Math.max(0, Math.floor((now - t) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// The "Recently deleted" list from the account's deleted rows (`id, revision, deleted_at,
// data`): the pieces deleted within the window, newest first. A duplicate that a combine
// marked deleted (the row says which piece it went into, `mergedInto`) is not a piece
// anyone deleted, so it is never listed, and a row whose data can't be read is left out
// rather than offered as something that can't be brought back.
//   [{ id, revision, name, deletedAt, measures, sessions }]
export function recentlyDeletedList(rows, { now = Date.now() } = {}) {
  const items = [];
  const seen = new Set();
  (rows || []).forEach((row) => {
    if (!row || row.id == null || seen.has(row.id) || row.deleted_at == null) return;
    seen.add(row.id);
    if (!isRecentlyDeleted(row.deleted_at, now)) return;
    const data = isObject(row.data) ? row.data : null;
    if (!data) return;
    if (typeof data.mergedInto === "string" && data.mergedInto !== "") return;
    items.push({
      id: row.id,
      revision: row.revision,
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled piece",
      deletedAt: row.deleted_at,
      measures: Number.isFinite(data.totalMeasures) ? data.totalMeasures : null,
      sessions: countSessions(data),
    });
  });
  items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || String(a.id).localeCompare(String(b.id)));
  return items;
}

// The delete window's one-line pointer to the way of keeping a piece's practice history
// (2026-10-28). History is worked out from the pieces that exist, so deleting a piece
// removes it from every chart; an archived piece keeps it. Archive is locked until the
// piece's plan is finished (Settings), so Pause is named for a piece that is still mid-plan.
export const KEEP_HISTORY_HINT =
  "Want to keep its practice history? Archive the piece instead, or pause it if its plan isn't finished yet.";

// The delete window's words. Signed in with a checked first backup the deletion goes to
// the account and every other device, and can be undone for a while; otherwise it is
// what it always was (this browser only, permanent). `hint` is the same in both cases.
export function deleteWindowCopy({ name, syncs }) {
  const shown = typeof name === "string" && name !== "" ? name : "this piece";
  const lead = `Are you sure you want to delete this piece and all its progress? This removes "${shown}" (every chunk, session log, and revival history) from`;
  if (!syncs) return { body: `${lead} this browser, permanently. It can't be undone.`, hint: KEEP_HISTORY_HINT, confirmLabel: "Delete permanently" };
  return {
    body: `${lead} this device and from every other device on your account. You can bring it back from Recently deleted in Settings for ${RECENTLY_DELETED_DAYS} days, without any practice that was never backed up.`,
    hint: KEEP_HISTORY_HINT,
    confirmLabel: "Delete everywhere",
  };
}
