/* ------------------------------------------------------------------ */
/*  Merging a piece by part, not by whole piece (Pass 117).            */
/*  docs/Algorithms.md "Merging by part".                              */
/*                                                                     */
/*  The ENGINE only: pure functions, no React, no network, no clock,   */
/*  nothing wired into the app. It answers one question for two        */
/*  copies of one piece: starting from what both last agreed on (the   */
/*  `base`), what changed on each side, and can the changes be put     */
/*  together without asking anyone?                                    */
/*                                                                     */
/*  A piece is split into PARTS: every top-level field except          */
/*  `progress`, and each entry of `progress` on its own (a chunk id,   */
/*  or a synthetic key: `__consolidation__`, `__cold_start__`,         */
/*  `sr_<sectionId>`, a transition or combo id). Each part gets a      */
/*  fingerprint. The device record keeps those fingerprints as of the  */
/*  last sync (`parts`, lib/accountSync.js); no copy of the piece is   */
/*  kept. Comparing today's fingerprints with the recorded ones says   */
/*  which parts each side changed.                                     */
/*                                                                     */
/*  One kind of change cannot be put together part by part: a change   */
/*  to the chunk grid on one side against a change to progress or the  */
/*  reschedule marker on the other (the whole piece is one conflict,   */
/*  see "travel together" below).                                      */
/*                                                                     */
/*  Per part: unchanged on both sides, nothing to do; changed on one   */
/*  side only, take that side's value; changed on both to the same     */
/*  value, agreement; changed on both to different values, a CONFLICT  */
/*  for that part only. Since Pass 126 two kinds of conflict are no    */
/*  longer questions: a SINGLE-VALUE setting (lib/settingTimes.js, the */
/*  list in RECENCY_FIELDS) is settled by whichever side changed it    */
/*  more recently, and a chunk's practice record is COMBINED (every    */
/*  session from both sides). Every other conflict is still left to    */
/*  the person: the merged piece keeps THIS device's value for it and  */
/*  the result lists it with both values. Pass 121 asks, and passes    */
/*  the answers back in as `choices`: only then is such a conflict     */
/*  settled, and only the way the person said ("local" or "remote").   */
/*                                                                     */
/*  This file also owns the primitives the account code compares with  */
/*  (fingerprint, canonicalPiece), so that the engine never has to     */
/*  import the account code and the account code can import the        */
/*  engine without a cycle. lib/accountSync.js re-exports them.        */
/* ------------------------------------------------------------------ */

import { validateAndMigratePiece, mergeSessionArrays } from "./storage";
import { reconcileMinutesPerDaySchedule } from "./scheduling";
import { RECENCY_FIELDS, compareRecency, settingTime, hasSettingNote } from "./settingTimes";

/* ------------------------------------------------------------------ */
/*  Primitives shared with lib/accountSync.js                          */
/* ------------------------------------------------------------------ */

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// What JSON would keep of a value: an undefined field vanishes, and the key
// order stops mattering once two values are compared key by key.
export function toJsonValue(value) {
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
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
// security: it's how the app can tell that something has changed since it was
// uploaded, without keeping a second copy of it on the device.
export function fingerprint(value) {
  const text = canon(toJsonValue(value));
  return hash53(text, 0).toString(16) + "-" + hash53(text, 1).toString(16);
}

// The same label for a value that is already plain JSON (so the trip through
// JSON that `fingerprint` makes would change nothing). Used on a canonical
// piece's parts, which are cut out of an already-cloned object.
function fingerprintOfCleanJson(value) {
  const text = canon(value);
  return hash53(text, 0).toString(16) + "-" + hash53(text, 1).toString(16);
}

/* ---- "the same" means the same after a reload (Pass 111) ------------ */

// The app doesn't always hold a piece in exactly the shape a reload gives it.
// A chunk's first practice record is created without `tier1Done` and
// `troubleSpots`, which loading then adds (as false and null). Compared as
// they stand, a piece that was uploaded and then simply reloaded would look
// changed. So pieces are fingerprinted and compared in the form loading would
// give them: the same validateAndMigratePiece the load uses, after the same
// trip through JSON that saving and loading make. What's SENT or kept is the
// app's own copy, untouched. A value that can't be put in that form is used as
// it is.
//
// The result is worked out once per piece object (pieces are replaced, never
// edited in place) and SHARED: treat it as read-only.
const canonicalCache = new WeakMap();

export function canonicalPiece(piece) {
  const cacheable = piece !== null && typeof piece === "object";
  if (cacheable && canonicalCache.has(piece)) return canonicalCache.get(piece);
  const plain = toJsonValue(piece);
  let out = plain;
  try {
    // validateAndMigratePiece stamps "now" on a piece with no updatedAt and
    // "today" on one with no startDate, which would make the same piece read
    // differently from one call to the next. A piece in this app always has
    // both; a hand-edited row might not, so give those a fixed stand-in.
    const steady = isObject(plain)
      ? { ...plain, ...(plain.updatedAt ? {} : { updatedAt: -1 }), ...(plain.startDate ? {} : { startDate: "1970-01-01" }) }
      : plain;
    const loaded = validateAndMigratePiece(steady);
    out = loaded ? toJsonValue(loaded) : plain;
  } catch (e) {
    out = plain;
  }
  if (cacheable) canonicalCache.set(piece, out);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Parts                                                              */
/* ------------------------------------------------------------------ */

// Never parts: `progress` itself (its entries are the parts), and the stamps that merge by
// their own rule: "the later of the two" (updatedAt), derived from the sessions themselves
// (lastLoggedAt, which every load recomputes), or the dated notes of Pass 126 (settingTimes:
// the notes decide a conflict, so they can never be a conflict themselves; this file writes
// the merged notes).
const NEVER_PARTS = new Set(["progress", "updatedAt", "lastLoggedAt", "settingTimes"]);

export const PROGRESS_PART_PREFIX = "progress:";

// The fields that decide what a chunk's id means (the chunk grid). A change to
// one of these on one side and a change to a progress entry or the reschedule
// marker on the other cannot be put together part by part: the other side's
// entries are keyed by ids from a grid that no longer exists.
export const STRUCTURE_FIELDS = ["totalMeasures", "chunkMode", "customChunkSize", "chunkSplitPoints"];

const isProgressPart = (key) => key.startsWith(PROGRESS_PART_PREFIX);
// Progress and the reschedule marker are the two things the structure rule
// protects (the marker's ids refer to the same grid).
const isProgressOrMarkerPart = (key) => isProgressPart(key) || key === "rescheduleMarker";

// The parts of a piece as { key: value }, cut from the piece you pass (pass a
// canonical piece to get canonical values). Top-level fields keep their own
// name; a progress entry's key is "progress:" + its id.
export function pieceParts(piece) {
  const parts = {};
  if (!isObject(piece)) return parts;
  Object.keys(piece).forEach((k) => {
    if (NEVER_PARTS.has(k) || piece[k] === undefined) return;
    parts[k] = piece[k];
  });
  const progress = isObject(piece.progress) ? piece.progress : {};
  Object.keys(progress).forEach((id) => {
    if (progress[id] === undefined) return;
    parts[PROGRESS_PART_PREFIX + id] = progress[id];
  });
  return parts;
}

// { key: fingerprint } for the piece as loading would give it. Worked out once
// per piece object, like canonicalPiece, and shared: read-only.
const partFingerprintCache = new WeakMap();

export function piecePartFingerprints(piece) {
  const cacheable = piece !== null && typeof piece === "object";
  if (cacheable && partFingerprintCache.has(piece)) return partFingerprintCache.get(piece);
  const parts = pieceParts(canonicalPiece(piece));
  const out = {};
  Object.keys(parts).forEach((k) => {
    out[k] = fingerprintOfCleanJson(parts[k]);
  });
  if (cacheable) partFingerprintCache.set(piece, out);
  return out;
}

/* ------------------------------------------------------------------ */
/*  The merge                                                          */
/* ------------------------------------------------------------------ */

// Most recent session date across every progress entry, or null: the rule
// validateAndMigratePiece applies on every load (storage.js,
// computeLastLoggedAt). The merged piece carries what a reload would compute
// for it, so a reload never changes it.
function latestLoggedDate(progress) {
  let latest = null;
  Object.keys(progress || {}).forEach((id) => {
    const entry = progress[id];
    ((entry && entry.sessions) || []).forEach((s) => {
      if (s && s.loggedDate && (!latest || s.loggedDate > latest)) latest = s.loggedDate;
    });
  });
  return latest;
}

const timestamp = (piece) => (piece && typeof piece.updatedAt === "number" && piece.updatedAt > 0 ? piece.updatedAt : 0);

const sorted = (list) => [...list].sort();

const hasBase = (base) => isObject(base) && Object.keys(base).length > 0;

function sameFingerprints(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Settling a conflict: the person's answer, applied (Pass 121)       */
/* ------------------------------------------------------------------ */

// The one conflict that is about the whole piece rather than a part of it: a
// change to the chunk grid on one device against practice (or a reschedule) on
// the other. It has no part key of its own in the fingerprints, so this is the
// label the device record and the question use for it.
export const WHOLE_PIECE_PART = "chunk layout and practice";

// Pass 122b: three parts are display arrangement, never data a person would want to be
// asked about: where the piece sits in the switcher (`sortOrder`), the date it was added
// (`createdAt`) and (below) the note a reorder leaves (`switcherOrder`). Changed on one side
// only they travel like any part (reorder the list on one device and the others follow).
// Changed to different values on both sides they are NOT a conflict: the engine settles them
// itself and lists what it did in `softSettled`. The note decides it: whichever side holds
// the MORE RECENT reorder wins, for the note and for `sortOrder` (they were written together).
// When there is nothing to tell them apart (no note on either side, or the same one) it is one
// fixed side that the caller names (`softWins`), never "whichever device happens to be
// merging": the account's copy for the account's flows (the default), so nothing about the
// order is left waiting to go up and two devices cannot take turns overwriting each other's
// order; a tab of one browser keeps its own value (tabSync.js): the person is working in that
// tab. `createdAt` always follows `softWins`. (A simulation in test/pieceMerge.test.mjs checks
// that devices that have exchanged copies end with the same order.)
export const SOFT_PARTS = ["sortOrder", "createdAt", "switcherOrder"];

// "The most recent reorder wins" (the owner, 2026-10-25). Pieces are stored one row each, so
// there is no single place to keep the order of the whole list. Instead every drag in the
// switcher leaves the same small note in the pieces it changes: { at, ids }, the moment of the
// drag and the whole arrangement (every piece's id, in order). A device shows the arrangement
// of the LATEST note it holds in any piece, and a merge keeps the later of two notes, so the
// last drag wins as a whole list however the rows travel and whichever of them reach a device
// first, and nothing has to be re-saved for the pieces the drag did not move. Pieces the note
// does not list (added after it) follow the listed ones, by the old rule. No note anywhere:
// exactly the old order, by `sortOrder`.
export function isOrderNote(n) {
  return !!n && typeof n === "object" && !Array.isArray(n) && Number.isFinite(n.at) && Array.isArray(n.ids) && n.ids.every((id) => typeof id === "string");
}

// 1 if `a` is the more recent note, -1 if `b` is, 0 if neither is (both missing or malformed) or
// they are the same. A real note beats a missing or malformed one. The same moment but a
// different arrangement (two devices with the same clock reading, which is all but impossible)
// is settled by the text of the arrangement, so it is one answer on every device.
export function compareOrderNotes(a, b) {
  const va = isOrderNote(a);
  const vb = isOrderNote(b);
  if (!va && !vb) return 0;
  if (va !== vb) return va ? 1 : -1;
  if (a.at !== b.at) return a.at > b.at ? 1 : -1;
  const ja = a.ids.join("\u0001");
  const jb = b.ids.join("\u0001");
  return ja === jb ? 0 : ja > jb ? 1 : -1;
}

// The later of two notes (a real one over a missing one), or undefined when neither is one.
export function laterOrderNote(a, b) {
  const c = compareOrderNotes(a, b);
  if (c === 0) return isOrderNote(a) ? a : isOrderNote(b) ? b : undefined;
  return c > 0 ? a : b;
}

// The latest reorder note held by any of these pieces (an array or an id-keyed map), or null.
export function latestSwitcherOrder(pieces) {
  const list = Array.isArray(pieces) ? pieces : Object.values(pieces || {});
  let best = null;
  list.forEach((p) => {
    const n = p && p.switcherOrder;
    if (isOrderNote(n) && (best === null || compareOrderNotes(n, best) > 0)) best = n;
  });
  return best;
}

// The moment to stamp a new reorder with: now, but never at or before a reorder this device
// has already SEEN (its own, or one that came from another device). A device whose clock runs
// behind still wins when it reorders after receiving the other's reorder; only two reorders
// made without either device having seen the other are judged by the clocks.
export function nextOrderStamp(pieces, now = Date.now()) {
  const latest = latestSwitcherOrder(pieces);
  const base = Number.isFinite(now) ? now : 0;
  return latest ? Math.max(base, latest.at + 1) : base;
}

// A fresh note for the arrangement `ordered` (the pieces, in the order the switcher should show).
export function makeOrderNote({ ordered, all = ordered, now = Date.now() }) {
  return { at: nextOrderStamp(all, now), ids: (ordered || []).map((p) => p.id) };
}

// The list the switcher shows, whole rows flattened: by the latest note where there is one, and
// the old rule (`compareSwitcherOrder`: rank, date added, id) for any piece it does not list and
// everywhere when no piece holds a note. A pure function of the pieces, so two devices that hold
// the same pieces show the same list.
export function sortPiecesForSwitcher(pieces) {
  const list = Array.isArray(pieces) ? [...pieces] : Object.values(pieces || {});
  const note = latestSwitcherOrder(list);
  if (!note) return list.sort(compareSwitcherOrder);
  const place = new Map();
  note.ids.forEach((id, i) => {
    if (!place.has(id)) place.set(id, i);
  });
  return list.sort((a, b) => {
    const pa = place.get(a && a.id);
    const pb = place.get(b && b.id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return compareSwitcherOrder(a, b);
  });
}

// What a drag in the switcher writes. `ordered` is every piece in its NEW order, `movedIds` the
// pieces of the row that was dragged. A piece gets the new rank when its rank changed (as it
// always did) and the note when it is one of those or one that was dragged: always at least
// the pieces that moved, so the note exists wherever the arrangement changed and nowhere else
// (no extra row is saved, or uploaded, for a drag). Returns [{ id, sortOrder, switcherOrder }].
export function planSwitcherMove({ ordered, movedIds = [], all = ordered, now = Date.now() }) {
  const moved = new Set(movedIds);
  const note = makeOrderNote({ ordered, all, now });
  return (ordered || []).flatMap((p, i) =>
    p.sortOrder !== i || moved.has(p.id) ? [{ id: p.id, sortOrder: i, switcherOrder: { at: note.at, ids: [...note.ids] } }] : []
  );
}

// The order the switcher shows pieces in (Pass 122b): by `sortOrder` (a piece with none sorts
// by when it was added, as it always did), and where two pieces hold the same rank by date
// added and then by id. Merging a reorder piece by piece can leave two pieces with the same
// number, and a plain sort would leave that tie to the order the pieces happened to be loaded
// in, which can differ between devices: this way two devices that hold the same pieces show the
// same list. The next reorder gives every piece a fresh rank and ends the tie for good.
export function compareSwitcherOrder(a, b) {
  const rank = (p) => (p && (p.sortOrder ?? p.createdAt)) ?? 0;
  const added = (p) => (p && p.createdAt) ?? 0;
  const id = (p) => String((p && p.id) ?? "");
  return rank(a) - rank(b) || added(a) - added(b) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);
}

// In a days-mode schedule the target date is the one thing a person sets. "Days to
// learn" and "minutes per day" are worked out FROM it whenever it is edited (Settings,
// Schedule), and so is the reschedule marker (handleSavePiece takes a fresh one on a
// schedule-only edit), so on whichever device the date was changed these changed with
// it. Merged one at a time they can come out as one device's date with the other
// device's days or plan, a piece that doesn't add up. So when the person settles a
// conflict over the target date these follow that answer as a unit and are not asked
// about separately (planPieceMerge, `linkedToDate`). Only then: with no answer, or no
// conflict over the date, they are merged and listed exactly as every other part.
// (A reschedule made on purpose, with no date change, is not touched by any of this.)
export const DATE_LINKED_FIELDS = ["daysToLearn", "minutesPerDay", "rescheduleMarker"];

// What a person can answer for one conflicting part. "local" keeps this device's
// value and "remote" takes the other device's. "both" exists only for a chunk's
// practice record, where the two sides' sessions can be added together.
export function isValidChoice(kind, choice) {
  if (choice === "local" || choice === "remote") return true;
  return choice === "both" && kind === "progress";
}

// When a session happened, as a number we can compare, or null if it doesn't say.
function sessionTime(s) {
  if (!isObject(s)) return null;
  if (Number.isFinite(s.loggedAt)) return s.loggedAt;
  if (typeof s.loggedDate === "string") {
    const t = Date.parse(s.loggedDate);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// The time of a chunk's latest JUDGED session, or null. A skipped attempt or an
// unconfirmed Interleaved one (utils.js, loggedSessions) never moves the ladder,
// so it can't make one side's ladder state the later one.
function latestJudgedSessionTime(entry) {
  let latest = null;
  const sessions = isObject(entry) && Array.isArray(entry.sessions) ? entry.sessions : [];
  sessions.forEach((s) => {
    if (!isObject(s) || s.skipped || s.provisional) return;
    const t = sessionTime(s);
    if (t !== null && (latest === null || t > latest)) latest = t;
  });
  return latest;
}

// Sessions are kept "most recent last" (docs/Data-Model.md), and every session the
// app logs says when. Added together they are put back in that order; if any
// session doesn't say when, nobody guesses and the order the union came in stays.
function inLoggedOrder(sessions) {
  if (!sessions.every((s) => isObject(s) && Number.isFinite(s.loggedAt))) return sessions;
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.loggedAt - b.s.loggedAt || a.i - b.i)
    .map((x) => x.s);
}

// A list, or an empty one for anything else: a stored value that is not a list (damaged
// or hand-edited data) must not make the union throw, only read as having none.
const listOf = (v) => (Array.isArray(v) ? v : []);

function unionDoneDays(a, b, before) {
  const A = (Array.isArray(a) ? a : []).filter((d) => Number.isFinite(d));
  const B = (Array.isArray(b) ? b : []).filter((d) => Number.isFinite(d));
  if (!Array.isArray(before)) return [...new Set([...A, ...B])].sort((x, y) => x - y);
  // With the copy both sides started from: a day that was there and is missing from ONE side
  // was taken away on that side (an undo), and stays away.
  const was = new Set(before);
  const inA = new Set(A);
  const inB = new Set(B);
  const days = [...A.filter((d) => !(was.has(d) && !inB.has(d))), ...B.filter((d) => !(was.has(d) && !inA.has(d)))];
  return [...new Set(days)].sort((x, y) => x - y);
}

// The sessions of two copies of one list, added together by content. With `before` (the copy
// both started from) a session that was there and is missing from ONE side was removed on that
// side (an undo), and stays removed; without it nothing can tell an undo from a session the
// other side never saw, so it comes back.
function unionSessionLists(a, b, before) {
  const A = listOf(a);
  const B = listOf(b);
  if (!Array.isArray(before)) return inLoggedOrder(mergeSessionArrays(A, B));
  const key = (x) => fingerprint(x);
  const was = new Set(before.map(key));
  const inA = new Set(A.map(key));
  const inB = new Set(B.map(key));
  return inLoggedOrder(
    mergeSessionArrays(
      A.filter((x) => !(was.has(key(x)) && !inB.has(key(x)))),
      B.filter((x) => !(was.has(key(x)) && !inA.has(key(x))))
    )
  );
}

// Focus spots (a chunk's `troubleSpots`) hold logged practice time of their own.
// A spot only one side has is kept; a spot both sides have keeps the leading
// side's own fields and gets both sides' sessions.
function unionSpots(lead, follow, before) {
  if (!Array.isArray(lead) && !Array.isArray(follow)) return lead;
  const first = Array.isArray(lead) ? lead : [];
  const second = Array.isArray(follow) ? follow : [];
  const prior = Array.isArray(before) ? before : null;
  const was = (spot) => (prior && isObject(spot) ? prior.find((p) => isObject(p) && p.id === spot.id) : undefined);
  const out = [];
  first.forEach((spot) => {
    const twin = isObject(spot) ? second.find((s) => isObject(s) && s.id === spot.id) : null;
    if (!twin) {
      // Only on the leading side. If both started with it, the other side removed it.
      if (was(spot)) return;
      out.push(spot);
      return;
    }
    const prev = was(spot);
    out.push({ ...spot, sessions: unionSessionLists(spot.sessions, twin.sessions, prev ? listOf(prev.sessions) : undefined) });
  });
  second.forEach((s) => {
    if (isObject(s) && !first.some((f) => isObject(f) && f.id === s.id) && !was(s)) out.push(s);
  });
  return out;
}

// "Both devices' sessions" for one chunk's practice record (Pass 121). The same
// chunk was practiced on both devices, so the engine can't tell which record is
// "the" record; the person said keep both. So:
//   sessions   every session either side holds, a session both hold counted once
//              (compared by content, key order ignored: Pass 115's comparison)
//   doneDays   the days practiced on either side
//   focus spots' own sessions, the same way
//   everything else in the record (the ladder state: stage, due date, tempo, the
//   passes counted so far; but also a rating or a flag) comes from the side whose
//   latest judged session is LATER. A tie, or no dated session on either side,
//   goes to this device (`mine`).
// What it cannot do is replay the sessions to rebuild the ladder state exactly:
// that is a later pass's job (Pass 121, "Deliberately deferred"). A session one
// side had undone comes back if the other side still holds it: there is no
// "before" copy here to tell an undo from a session the other side never saw.
// Returns a plain JSON value, or undefined when neither side has the entry.
//
// `before` (Pass 126, optional): the copy of the entry both sides started from, when the caller
// has one (tabs of one browser keep the piece they last saved). With it, an undo on one side is
// not undone: a session, a day or a focus spot that was in `before` and is missing from exactly
// one side stays removed. Without it (the account's device record keeps fingerprints, not
// copies) everything is added back, as described above.
export function unionProgressEntries(mine, theirs, before) {
  const a = isObject(mine) ? mine : null;
  const b = isObject(theirs) ? theirs : null;
  if (!a && !b) return undefined;
  if (!a) return toJsonValue(b);
  if (!b) return toJsonValue(a);
  const prior = isObject(before) ? before : null;
  const ta = latestJudgedSessionTime(a);
  const tb = latestJudgedSessionTime(b);
  const otherIsLater = tb !== null && (ta === null || tb > ta);
  const lead = otherIsLater ? b : a;
  const follow = otherIsLater ? a : b;
  const out = {
    ...lead,
    sessions: unionSessionLists(a.sessions, b.sessions, prior ? listOf(prior.sessions) : undefined),
    doneDays: unionDoneDays(a.doneDays, b.doneDays, prior ? prior.doneDays : undefined),
  };
  const spots = unionSpots(lead.troubleSpots, follow.troubleSpots, prior ? prior.troubleSpots : undefined);
  if (spots !== undefined) out.troubleSpots = spots;
  return toJsonValue(out);
}

// What planPieceMerge returns:
//   status  "identical"           both sides hold the same parts; nothing to do
//           "local-only"          the remote copy hasn't changed since the base:
//                                 nothing to bring in, `merged` IS `local`
//           "merged"              the remote changes were folded in; no conflict
//           "conflicts"           folded in, except the parts in `conflicts`,
//                                 where `merged` keeps this device's value
//           "whole-piece-conflict" a structure change on one side and a
//                                 progress/marker change on the other: the
//                                 whole piece is one conflict (`wholePiece`),
//                                 `merged` IS `local`
//           "ask"                 nothing says what changed on which side (no
//                                 recorded parts, or two different pieces):
//                                 `merged` IS `local`; the caller falls back
//                                 to asking about the whole piece
//   merged       the piece to keep. For every status except "merged" and
//                "conflicts" it is `local` itself, untouched (same object).
//   conflicts    [{ part, kind: "field"|"progress", field|id, local, remote,
//                   localFingerprint, remoteFingerprint, baseFingerprint }]
//                (a value is undefined where that side has no such part)
//   wholePiece   null, or { reason, structure: [fields], progress: [parts],
//                           local, remote }
//   fromRemote   parts taken from the remote copy (changed there only)
//   fromLocal    parts kept from this device (changed here only)
//   agreed       parts both sides changed to the same value
//   derived      parts the merge re-derived instead of choosing (see below)
//   settled      [{ part, kind: "field"|"progress"|"whole-piece", choice }]: the
//                conflicts the caller's `choices` settled (Pass 121); [] without any
//   unusedChoices  the parts named in `choices` that were not (or no longer) in
//                conflict, so nothing was applied for them
//   linkedToDate  (days-mode schedules, only when the target date IS in conflict) the
//                numbers worked out from the date that changed on either side
//                (DATE_LINKED_FIELDS). They are listed in `conflicts` or merged as
//                ever until the date is answered; once it is, they follow it as a unit
//                and drop out of `conflicts`, so a question about them is never needed
//   recencySettled (Pass 126) [{ part, side: "remote" | "local", localTime, remoteTime }]: the
//                single-value settings (RECENCY_FIELDS) both sides changed to different values,
//                settled by whichever side changed them MORE RECENTLY (the dated note on the
//                setting, else the piece's updatedAt: lib/settingTimes.js). A tie is not guessed:
//                it stays in `conflicts`. Settings that follow another (the work id follows the
//                work title; in a days-mode schedule the numbers worked out from the target
//                date follow the date) are not listed: they went with it
//   combinedPractice (Pass 126) [{ part, id }]: a chunk's practice record both sides changed,
//                combined (unionProgressEntries) instead of asked about
//   softSettled  (Pass 122b) [{ part, side: "remote" | "local" }]: the display parts
//                (SOFT_PARTS) both sides changed to different values, settled by the
//                engine itself: the side with the more recent reorder note for the note and
//                the rank, the side `softWins` names otherwise. Never in `conflicts`,
//                never asked about
//   reason       for "ask": "no-base" | "different-ids" | "not-pieces"
//
// `base` is the entry's `parts` ({ key: fingerprint }). `local` and `remote`
// are pieces in any shape the app holds them; both are read in the form
// loading would give them, and the merged piece is built in that form.
//
// `choices` (Pass 121, optional): the person's answers, { [part]: "local" |
// "remote" | "both" }, keyed by a conflict's `part` (or WHOLE_PIECE_PART for the
// whole-piece conflict, where only "local" and "remote" mean anything: the whole
// piece of that side is kept and the other side's changes go with it). A conflict
// with a valid answer is settled that way; one without stays in `conflicts` and
// keeps this device's value, exactly as when no `choices` are given. So the status
// is "merged" only when every conflict was answered, and a partial set of answers
// changes nothing the caller should apply. Without `choices` nothing differs.
//
// `softWins` (Pass 122b, "remote" by default): which side's value SOFT_PARTS take when
// both sides changed them to different values and the reorder notes cannot say which came
// last (and always for the date added). "remote" is the other copy (the account's, in every
// flow that reads the account); "local" is this device's (a tab of one browser, where the
// person is working in this tab). Always one fixed side, so that two devices that have
// exchanged copies end with the same order.
//
// `recency` (Pass 126, true by default): settle the single-value settings by the more recent
// change. false: they are conflicts, kept as this device's and listed, as before.
// `combinePractice` (Pass 126, true by default): combine a chunk's practice record that both
// sides changed. false: it is a conflict, as before. `baseProgress` (optional): the progress
// entries both sides started from ({ [chunk id]: entry }), for a caller that holds a copy of
// the base (tabs of one browser do); with it, a session removed on one side is not brought
// back by the other (see unionProgressEntries).
//
// Two stamps are not parts. updatedAt is the later of the two. lastLoggedAt is
// recomputed from the merged sessions (the later of the two unless that date
// belongs to a session the merged piece doesn't hold: an undo, or the remote
// side of a conflict), because every load recomputes it and the app's own undo
// doesn't, so "the later of the two" alone would not survive a reload.
//
// In scheduleMode "minutes", daysToLearn is not a choice either: every load
// re-derives it from minutesPerDay (reconcileMinutesPerDaySchedule), keeping a
// reschedule's extension as a floor. So it is taken like any part when one side
// changed it, the larger when both did, and the whole schedule is reconciled
// once more at the end.
export function planPieceMerge({ local, remote, base, choices = null, softWins = "remote", recency = true, combinePractice = true, baseProgress = null }) {
  const result = (status, extra = {}) => ({
    status,
    merged: local,
    conflicts: [],
    wholePiece: null,
    fromRemote: [],
    fromLocal: [],
    agreed: [],
    derived: [],
    settled: [],
    unusedChoices: [],
    linkedToDate: [],
    softSettled: [],
    recencySettled: [],
    combinedPractice: [],
    reason: null,
    ...extra,
  });
  const answers = isObject(choices) ? choices : {};

  if (!isObject(local) || !isObject(remote)) return result("ask", { reason: "not-pieces" });
  if (local.id !== remote.id) return result("ask", { reason: "different-ids" });

  const L = canonicalPiece(local);
  const R = canonicalPiece(remote);
  const fpL = piecePartFingerprints(local);
  const fpR = piecePartFingerprints(remote);

  if (sameFingerprints(fpL, fpR)) return result("identical");
  if (!hasBase(base)) return result("ask", { reason: "no-base" });
  // The remote copy is what the base was: nothing of theirs to bring in.
  if (sameFingerprints(fpR, base)) return result("local-only");

  const keys = sorted(new Set([...Object.keys(fpL), ...Object.keys(fpR), ...Object.keys(base)]));
  const changedL = (k) => fpL[k] !== base[k];
  const changedR = (k) => fpR[k] !== base[k];

  // The structure rule: the sides disagree about the chunk grid, and the side
  // that did not change the grid changed progress or the marker.
  const structureDiffers = STRUCTURE_FIELDS.filter((f) => fpL[f] !== fpR[f]);
  const structureChangedL = structureDiffers.filter(changedL);
  const structureChangedR = structureDiffers.filter(changedR);
  const progressDiffers = keys.filter((k) => isProgressOrMarkerPart(k) && fpL[k] !== fpR[k]);
  const progressChangedL = progressDiffers.filter(changedL);
  const progressChangedR = progressDiffers.filter(changedR);
  const structureVsProgress =
    (structureChangedL.length > 0 && progressChangedR.length > 0) || (structureChangedR.length > 0 && progressChangedL.length > 0);
  if (structureVsProgress) {
    const whole = answers[WHOLE_PIECE_PART];
    if (whole === "local" || whole === "remote") {
      // Pass 121: the person chose which WHOLE piece to keep. The two can't be put
      // together part by part (the other side's progress is keyed by ids from a grid
      // that no longer exists), so everything on the other side goes with it.
      const kept = { ...(whole === "local" ? L : R) };
      const lt0 = timestamp(local);
      const rt0 = timestamp(remote);
      if (lt0 || rt0) kept.updatedAt = Math.max(lt0, rt0);
      else delete kept.updatedAt;
      return result("merged", {
        merged: toJsonValue(kept),
        settled: [{ part: WHOLE_PIECE_PART, kind: "whole-piece", choice: whole }],
        unusedChoices: Object.keys(answers).filter((k) => k !== WHOLE_PIECE_PART),
      });
    }
    return result("whole-piece-conflict", {
      wholePiece: {
        reason: "structure-and-progress",
        structure: sorted(new Set([...structureChangedL, ...structureChangedR])),
        progress: sorted(new Set([...progressChangedL, ...progressChangedR])),
        local: toJsonValue(L),
        remote: toJsonValue(R),
      },
      unusedChoices: Object.keys(answers),
    });
  }

  const fromRemote = [];
  const fromLocal = [];
  const agreed = [];
  const conflictKeys = [];
  keys.forEach((k) => {
    const cl = changedL(k);
    const cr = changedR(k);
    if (!cl && !cr) return;
    if (cl && !cr) fromLocal.push(k);
    else if (!cl && cr) fromRemote.push(k);
    else if (fpL[k] === fpR[k]) agreed.push(k);
    else conflictKeys.push(k);
  });

  // Pass 122b: piece order, the note a reorder leaves and date added are never a conflict.
  // Changed on one side only they were taken above like any part; changed on both to
  // different values, the engine settles them itself and says so in `softSettled`. The note and
  // the rank (written together by one drag) go to the side that holds the MORE RECENT reorder;
  // with no way to tell (no note, or the same one) and for the date added, to the side
  // `softWins` names. Judged the same whichever copy is "local", so two devices agree.
  const softSide = softWins === "local" ? "local" : "remote";
  const noteCompared = compareOrderNotes(L.switcherOrder, R.switcherOrder);
  const orderSide = noteCompared > 0 ? "local" : noteCompared < 0 ? "remote" : softSide;
  const softSettled = [];
  SOFT_PARTS.forEach((k) => {
    const i = conflictKeys.indexOf(k);
    if (i < 0) return;
    conflictKeys.splice(i, 1);
    softSettled.push({ part: k, side: k === "createdAt" ? softSide : orderSide });
  });

  // Pass 126: a single-value setting both sides changed to different values goes to whichever
  // side changed it MORE RECENTLY (the dated note, else updatedAt: lib/settingTimes.js). A tie,
  // or nothing to compare, is not guessed: it stays a conflict. A setting the person has
  // already answered for is theirs to settle. Two settings decide how the others are read, so
  // they go first: the schedule mode (which fields the schedule uses) and the target date (the
  // numbers worked out from it, below).
  const recencySettled = [];
  const followsDateSide = []; // [{ part, side }] derived numbers that went with the one side that changed the date
  const timeOf = (piece, k) => settingTime(piece, k);
  const modeNow = () => {
    const r = recencySettled.find((x) => x.part === "scheduleMode");
    const remote_ = fromRemote.includes("scheduleMode") || (r && r.side === "remote") || (conflictKeys.includes("scheduleMode") && answers.scheduleMode === "remote");
    return remote_ ? R.scheduleMode : L.scheduleMode;
  };
  if (recency) {
    const order = ["scheduleMode", "targetDate", ...RECENCY_FIELDS.filter((k) => k !== "scheduleMode" && k !== "targetDate")];
    order.forEach((k) => {
      const i = conflictKeys.indexOf(k);
      if (i < 0 || isValidChoice("field", answers[k])) return;
      // The numbers worked out from the target date are not settled one by one in a days-mode
      // schedule: they go with the date, so one device's date is never paired with the other's
      // numbers. While the date is in play (a contest, settled below or left a tie) that is the
      // date's winner (below). When the date changed on ONE side only, the number goes with that
      // side (its Save worked the number out from the new date; the other side's was worked out
      // from the old one). Where the date changed on neither side, minutes per day is an ordinary
      // setting and the more recent change settles it.
      if (DATE_LINKED_FIELDS.includes(k) && modeNow() === "days") {
        const dateIn = conflictKeys.includes("targetDate") || recencySettled.some((x) => x.part === "targetDate");
        if (dateIn) return;
        const dateOnlyHere = changedL("targetDate") && !changedR("targetDate");
        const dateOnlyThere = changedR("targetDate") && !changedL("targetDate");
        if (dateOnlyHere || dateOnlyThere) {
          conflictKeys.splice(i, 1);
          followsDateSide.push({ part: k, side: dateOnlyHere ? "local" : "remote" });
          return;
        }
      }
      const cmp = compareRecency(L, R, k);
      if (cmp === 0) return;
      conflictKeys.splice(i, 1);
      recencySettled.push({ part: k, side: cmp > 0 ? "local" : "remote", localTime: timeOf(L, k), remoteTime: timeOf(R, k) });
    });
  }
  // The work id is worked out from the work title and goes with it.
  const titleSettled = recencySettled.find((x) => x.part === "workName");
  const idLinked = !!titleSettled && (changedL("workId") || changedR("workId"));
  if (idLinked) {
    [conflictKeys, fromLocal, fromRemote, agreed].forEach((list) => {
      const j = list.indexOf("workId");
      if (j >= 0) list.splice(j, 1);
    });
  }

  // Which schedule mode the merged piece ends up in: the remote's if only the
  // remote changed it, or if the person (or the more recent change) settled a
  // conflict over it that way; this device's otherwise (an unsettled conflict
  // keeps this device's).
  const modeAfter = modeNow();
  const derived = [];
  let daysToLearnFromRemote = false;
  if (modeAfter === "minutes" && (changedL("daysToLearn") || changedR("daysToLearn"))) {
    // Not a choice: whichever side changed it, the larger when both did, and
    // reconciled at the end. Never a conflict.
    [conflictKeys, fromLocal, fromRemote, agreed].forEach((list) => {
      const i = list.indexOf("daysToLearn");
      if (i >= 0) list.splice(i, 1);
    });
    derived.push("daysToLearn");
    daysToLearnFromRemote = changedR("daysToLearn") && (!changedL("daysToLearn") || (R.daysToLearn || 0) > (L.daysToLearn || 0));
  }

  // Pass 121: the numbers worked out from a conflicting target date (DATE_LINKED_FIELDS).
  // Answered, they follow that answer and are taken out of every list below, so what
  // was merged one by one a moment ago cannot pair one device's date with the other's.
  const dateRecency = recencySettled.find((x) => x.part === "targetDate");
  const dateLinkable = modeAfter === "days" && (conflictKeys.includes("targetDate") || !!dateRecency);
  const linkedToDate = dateLinkable ? DATE_LINKED_FIELDS.filter((k) => changedL(k) || changedR(k)) : [];
  const dateAnswer = dateLinkable ? (dateRecency ? dateRecency.side : isValidChoice("field", answers.targetDate) ? answers.targetDate : null) : null;
  if (dateAnswer) {
    [conflictKeys, fromLocal, fromRemote, agreed].forEach((list) => {
      linkedToDate.forEach((k) => {
        const i = list.indexOf(k);
        if (i >= 0) list.splice(i, 1);
      });
    });
  }

  // Pass 121: the person's answers, for the parts that really are in conflict. A part
  // with no valid answer stays a conflict and keeps this device's value, as ever.
  const settled = [];
  const stillOpen = [];
  const combinedPractice = [];
  conflictKeys.forEach((k) => {
    const kind = isProgressPart(k) ? "progress" : "field";
    if (isValidChoice(kind, answers[k])) settled.push({ part: k, kind, choice: answers[k] });
    // Pass 126: practice is never chosen between. A chunk's record both sides changed is
    // combined: every session from both, the rest from the side that practiced last.
    else if (kind === "progress" && combinePractice) combinedPractice.push({ part: k, id: k.slice(PROGRESS_PART_PREFIX.length) });
    else stillOpen.push(k);
  });
  const unusedChoices = Object.keys(answers).filter((k) => !conflictKeys.includes(k));

  const merged = { ...L };
  const progress = isObject(L.progress) ? { ...L.progress } : {};
  const tookRemote = new Set();
  const takeFromRemote = (k) => {
    tookRemote.add(k);
    if (isProgressPart(k)) {
      const id = k.slice(PROGRESS_PART_PREFIX.length);
      if (isObject(R.progress) && Object.prototype.hasOwnProperty.call(R.progress, id)) progress[id] = R.progress[id];
      else delete progress[id];
    } else if (Object.prototype.hasOwnProperty.call(R, k)) {
      merged[k] = R[k];
    } else {
      delete merged[k];
    }
  };
  fromRemote.forEach(takeFromRemote);
  softSettled.filter((s) => s.side === "remote").forEach((s) => takeFromRemote(s.part)); // "local": already in `merged`
  recencySettled.filter((s) => s.side === "remote").forEach((s) => takeFromRemote(s.part)); // "local": already in `merged`
  followsDateSide.filter((s) => s.side === "remote").forEach((s) => takeFromRemote(s.part)); // "local": already in `merged`
  if (idLinked && titleSettled.side === "remote") takeFromRemote("workId");
  if (daysToLearnFromRemote) takeFromRemote("daysToLearn");
  if (dateAnswer === "remote") linkedToDate.forEach(takeFromRemote); // "this device's": already in `merged`
  settled.forEach(({ part, choice }) => {
    if (choice === "remote") {
      takeFromRemote(part);
    } else if (choice === "both") {
      const id = part.slice(PROGRESS_PART_PREFIX.length);
      const joined = unionProgressEntries(isObject(L.progress) ? L.progress[id] : undefined, isObject(R.progress) ? R.progress[id] : undefined);
      if (joined === undefined) delete progress[id];
      else progress[id] = joined;
    }
    // "local": this device's value is already in `merged`
  });
  combinedPractice.forEach(({ id }) => {
    // A tie (neither record has a later judged session) goes to "this device" in
    // unionProgressEntries. Here "this device" is the record with the smaller fingerprint, the
    // same one whichever copy is local, so two devices that merge each other's copy end with
    // the same record.
    const mine = isObject(L.progress) ? L.progress[id] : undefined;
    const theirs = isObject(R.progress) ? R.progress[id] : undefined;
    const swap = mine !== undefined && theirs !== undefined && fingerprint(theirs) < fingerprint(mine);
    const joined = unionProgressEntries(swap ? theirs : mine, swap ? mine : theirs, isObject(baseProgress) ? baseProgress[id] : undefined);
    if (joined === undefined) delete progress[id];
    else progress[id] = joined;
  });
  merged.progress = progress;

  // Pass 126: the dated notes of the merged piece, worked out the same whichever copy is
  // "local", so two devices that merge each other's copies end with the same notes. For a
  // setting both copies hold the same value for: the later note either holds. For one that
  // came from a single side: that side's note (none if it had none; the piece's updatedAt
  // stands in for it from then on). For a conflict the more recent change settled: the moment
  // that decided it (the winner's note, or its updatedAt where it had none).
  const times = {};
  RECENCY_FIELDS.forEach((k) => {
    const winner = recencySettled.find((x) => x.part === k);
    let at = 0;
    if (fpL[k] === fpR[k]) {
      at = Math.max(hasSettingNote(L, k) ? L.settingTimes[k] : 0, hasSettingNote(R, k) ? R.settingTimes[k] : 0);
    } else {
      const fromR = tookRemote.has(k);
      const source = fromR ? R : L;
      if (winner) at = settingTime(source, k);
      else if (hasSettingNote(source, k)) at = source.settingTimes[k];
    }
    if (at > 0) times[k] = at;
  });
  if (Object.keys(times).length > 0) merged.settingTimes = times;
  else delete merged.settingTimes;

  const lt = timestamp(local);
  const rt = timestamp(remote);
  if (lt || rt) merged.updatedAt = Math.max(lt, rt);
  else delete merged.updatedAt;
  merged.lastLoggedAt = latestLoggedDate(progress);

  const final = toJsonValue(modeAfter === "minutes" ? reconcileMinutesPerDaySchedule(merged) : merged);

  const partOf = (piece, k) => (isProgressPart(k) ? (isObject(piece.progress) ? piece.progress[k.slice(PROGRESS_PART_PREFIX.length)] : undefined) : piece[k]);
  // Copies, so nothing a caller does to a result can reach the shared
  // canonical forms (an absent part stays undefined).
  const copy = (v) => (v === undefined ? undefined : toJsonValue(v));
  const conflicts = stillOpen.map((k) => ({
    part: k,
    kind: isProgressPart(k) ? "progress" : "field",
    ...(isProgressPart(k) ? { id: k.slice(PROGRESS_PART_PREFIX.length) } : { field: k }),
    local: copy(partOf(L, k)),
    remote: copy(partOf(R, k)),
    localFingerprint: fpL[k] === undefined ? null : fpL[k],
    remoteFingerprint: fpR[k] === undefined ? null : fpR[k],
    baseFingerprint: base[k] === undefined ? null : base[k],
  }));

  return result(conflicts.length > 0 ? "conflicts" : "merged", {
    merged: final,
    conflicts,
    fromRemote: sorted(fromRemote),
    fromLocal: sorted(fromLocal),
    agreed: sorted(agreed),
    derived: sorted(derived),
    settled,
    unusedChoices,
    linkedToDate,
    softSettled,
    recencySettled,
    combinedPractice,
  });
}
