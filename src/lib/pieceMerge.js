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
/*  for that part only. A conflict is never resolved here: the merged  */
/*  piece keeps THIS device's value for it and the result lists it     */
/*  with both values (Pass 121 asks the person).                       */
/*                                                                     */
/*  This file also owns the primitives the account code compares with  */
/*  (fingerprint, canonicalPiece), so that the engine never has to     */
/*  import the account code and the account code can import the        */
/*  engine without a cycle. lib/accountSync.js re-exports them.        */
/* ------------------------------------------------------------------ */

import { validateAndMigratePiece } from "./storage";
import { reconcileMinutesPerDaySchedule } from "./scheduling";

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

// Never parts: `progress` itself (its entries are the parts), and the two
// stamps that merge by "the later of the two" (updatedAt) or are derived from
// the sessions themselves (lastLoggedAt, which every load recomputes).
const NEVER_PARTS = new Set(["progress", "updatedAt", "lastLoggedAt"]);

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
//   reason       for "ask": "no-base" | "different-ids" | "not-pieces"
//
// `base` is the entry's `parts` ({ key: fingerprint }). `local` and `remote`
// are pieces in any shape the app holds them; both are read in the form
// loading would give them, and the merged piece is built in that form.
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
export function planPieceMerge({ local, remote, base }) {
  const result = (status, extra = {}) => ({
    status,
    merged: local,
    conflicts: [],
    wholePiece: null,
    fromRemote: [],
    fromLocal: [],
    agreed: [],
    derived: [],
    reason: null,
    ...extra,
  });

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
    return result("whole-piece-conflict", {
      wholePiece: {
        reason: "structure-and-progress",
        structure: sorted(new Set([...structureChangedL, ...structureChangedR])),
        progress: sorted(new Set([...progressChangedL, ...progressChangedR])),
        local: toJsonValue(L),
        remote: toJsonValue(R),
      },
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

  // Which schedule mode the merged piece ends up in: the remote's if only the
  // remote changed it, this device's otherwise (a conflict keeps this device's).
  const modeAfter = fromRemote.includes("scheduleMode") ? R.scheduleMode : L.scheduleMode;
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

  const merged = { ...L };
  const progress = isObject(L.progress) ? { ...L.progress } : {};
  const takeFromRemote = (k) => {
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
  if (daysToLearnFromRemote) takeFromRemote("daysToLearn");
  merged.progress = progress;

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
  const conflicts = conflictKeys.map((k) => ({
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
  });
}
