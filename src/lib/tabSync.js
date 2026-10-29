/* ------------------------------------------------------------------ */
/*  Keeping every tab of one browser in step (Pass 119).               */
/*  docs/Architecture.md "Persistence" and docs/Accounts-and-Backend.md */
/*  "Several tabs of one browser".                                     */
/*                                                                     */
/*  Every tab of one browser shares one localStorage but keeps its own */
/*  copy of the pieces in memory, and until this pass nothing listened */
/*  for another tab's writes. So the tab that saved last silently      */
/*  replaced the other's work, and a piece deleted in one tab came     */
/*  back when the other tab changed its stale copy (reproduced with   */
/*  the real load/save functions; docs/Accounts-and-Backend.md).       */
/*                                                                     */
/*  Three jobs, all plain functions with no React and no clock of      */
/*  their own:                                                         */
/*   1. DECIDING what a tab should do about what storage now holds     */
/*      (`reconcileFromStorage`, and the helpers that read storage and  */
/*      apply the answer).                                             */
/*   2. THE BUSY TEST (`isPieceBusy`): a piece in use is never swapped */
/*      out from under the person. Pass 120 uses the same function.    */
/*   3. THE LEASE (`createTabLease`): one tab at a time does the       */
/*      account work (the automatic upload and the look at what other  */
/*      devices changed). The Web Locks API would be the textbook tool */
/*      but it isn't in Safari 14, the build target, so this is a      */
/*      heartbeat in localStorage.                                     */
/*                                                                     */
/*  Nothing here talks to the account, and nothing here knows about    */
/*  React: App.jsx only schedules it.                                  */
/* ------------------------------------------------------------------ */

import { PIECE_KEY_PREFIX } from "./constants";
import { validateAndMigratePiece, validateAndMigrateTechnique, TECHNIQUE_KEY } from "./storage";
import { isObject, canonicalPiece, piecePartFingerprints, planPieceMerge } from "./pieceMerge";
import { techniquePartFingerprints, planTechniqueMerge } from "./techniqueMerge";

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function sameParts(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  The busy test (shared with Pass 120)                               */
/* ------------------------------------------------------------------ */

// Is this piece in use right now? Three things count, each already tracked in
// App.jsx: an unconfirmed Interleaved attempt (`interleaveRisk`), a running
// reassessment timer (`assessmentTimerRisk`) and an open "Edit piece settings"
// draft (`settingsEditing` with `editDraft`). The first two belong to the piece
// Daily Practice is showing, which is the active piece; the draft names its
// own piece. A busy piece is never reloaded, merged into, removed or written
// over by another tab (or, from Pass 120, by the account): the change waits
// and applies when the piece is idle.
export function isPieceBusy(pieceId, context) {
  if (!pieceId || !context) return false;
  const { activePieceId, interleaveRisk, assessmentTimerRisk, settingsEditing, editDraft } = context;
  if (interleaveRisk && pieceId === activePieceId) return true;
  if (assessmentTimerRisk && pieceId === activePieceId) return true;
  if (settingsEditing && editDraft && editDraft.id === pieceId) return true;
  return false;
}

export function busyPieceIds(pieceIds, context) {
  return (pieceIds || []).filter((id) => isPieceBusy(id, context));
}

/* ------------------------------------------------------------------ */
/*  Reading storage                                                    */
/* ------------------------------------------------------------------ */

function defaultStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null;
  }
}

export function pieceIdFromKey(key) {
  return typeof key === "string" && key.startsWith(PIECE_KEY_PREFIX) ? key.slice(PIECE_KEY_PREFIX.length) : null;
}

// What a `storage` event's key means for this tab: which pieces to look at and
// whether to look at the technique library. null for a key this pass doesn't
// follow (the active piece id is per tab on purpose; the device record, the
// export reminder and the lease have their own handling). A null key is
// `localStorage.clear()`: look at everything.
export function keyScope(key) {
  if (key === null || key === undefined) return { pieceIds: null, technique: true };
  const id = pieceIdFromKey(key);
  if (id) return { pieceIds: [id], technique: false };
  if (key === TECHNIQUE_KEY) return { pieceIds: [], technique: true };
  return null;
}

export function listStoredPieceIds(storage = defaultStorage()) {
  const ids = [];
  if (!storage) return ids;
  try {
    for (let i = 0; i < storage.length; i++) {
      const id = pieceIdFromKey(storage.key(i));
      if (id) ids.push(id);
    }
  } catch (e) {
    /* storage unavailable */
  }
  return ids;
}

// The parsed (not yet migrated) contents of storage for these pieces, and for
// the technique library. An id that is simply not there is absent from
// `pieces`; one that is there but unreadable goes in `unreadable` and is NEVER
// taken for a deletion. `pieceIds` null means every piece key.
export function readStorageSnapshot({ pieceIds = null, technique = true, storage = defaultStorage() } = {}) {
  const out = { pieces: {}, unreadable: [], technique: undefined, techniqueUnreadable: false, available: !!storage };
  if (!storage) return out;
  const ids = pieceIds || listStoredPieceIds(storage);
  ids.forEach((id) => {
    let raw;
    try {
      raw = storage.getItem(PIECE_KEY_PREFIX + id);
    } catch (e) {
      out.unreadable.push(id);
      return;
    }
    if (raw === null || raw === undefined) return;
    try {
      const parsed = JSON.parse(raw);
      if (isObject(parsed)) out.pieces[id] = parsed;
      else out.unreadable.push(id);
    } catch (e) {
      out.unreadable.push(id);
    }
  });
  if (technique) {
    try {
      const raw = storage.getItem(TECHNIQUE_KEY);
      if (raw !== null && raw !== undefined) {
        const parsed = JSON.parse(raw);
        if (isObject(parsed)) out.technique = parsed;
        else out.techniqueUnreadable = true;
      }
    } catch (e) {
      out.techniqueUnreadable = true;
    }
  }
  return out;
}

// A stored piece as a normal load would give it, or null when it is not a
// usable piece (which is NOT a deletion: it is left alone).
function migrateStoredPiece(raw, id) {
  if (!isObject(raw)) return null;
  try {
    const migrated = validateAndMigratePiece(raw);
    return migrated && migrated.id === id ? migrated : null;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Practice both tabs logged                                          */
/* ------------------------------------------------------------------ */

// A chunk's practice record that BOTH tabs changed is combined by Pass 117's engine (since Pass
// 126; before that this file had a fold of its own, and the account path had none): every
// session either tab added, the days practiced, the focus spots' own sessions. It is given the
// copy this tab last saved (`baseProgress`), so a session one tab undid since then stays undone
// and is not brought back by the other tab still holding it. What the engine cannot do is
// rebuild the ladder state (stage, due date, tempo) from the sessions: it comes from the record
// whose latest judged session is later (docs/Algorithms.md).
// How many sessions the combined record added to this tab's own, per chunk, for the report.
function foldedReport(plan, mine) {
  const mineProgress = (mine && mine.progress) || {};
  return (plan.combinedPractice || []).map((c) => {
    const before = ((mineProgress[c.id] && mineProgress[c.id].sessions) || []).length;
    const after = ((plan.merged.progress[c.id] && plan.merged.progress[c.id].sessions) || []).length;
    return { id: c.id, sessions: after - before };
  });
}

/* ------------------------------------------------------------------ */
/*  The decision                                                       */
/* ------------------------------------------------------------------ */

// What should this tab do about ONE piece? M is this tab's copy (undefined when
// it has none), S what storage holds now (migrated; undefined when absent), L the
// copy this tab last saved or loaded. "Unsaved" always means a different CONTENT
// (the parts Pass 117 compares), not a different object: a no-op update, or one
// that only moved `updatedAt`, is not a change.
function decidePiece(M, S, L) {
  const hasM = M !== undefined;
  const hasS = S !== undefined;
  const hasL = L !== undefined;

  if (!hasS) {
    // Not in storage. If this tab ever saved or loaded it, another tab removed
    // it: remove it here too, and never write it back (an unsaved change to it
    // does not bring it back). If this tab never saved it, it is simply new here.
    return hasL && hasM ? { kind: "remove" } : { kind: "none" };
  }

  const fpS = piecePartFingerprints(S);
  if (hasL && sameParts(fpS, piecePartFingerprints(L))) return { kind: "none" }; // storage is as this tab left it

  // Storage holds something this tab hasn't seen.
  if (!hasM) {
    // This tab deleted it and hasn't written that yet (the save is about to
    // remove the key): the delete the person asked for wins.
    return hasL ? { kind: "none" } : { kind: "add", storagePiece: S };
  }
  const fpM = piecePartFingerprints(M);
  if (sameParts(fpS, fpM)) return { kind: "reload", storagePiece: S }; // the same content: take storage's copy
  if (!hasL) return { kind: "keep", storagePiece: S, status: "ask", reason: "no-base", conflicts: [], wholePiece: null };
  if (sameParts(fpM, piecePartFingerprints(L))) return { kind: "reload", storagePiece: S }; // nothing unsaved here: reload

  // Changed in both: keep this tab's copy and fold the other's changes in, part
  // by part, from the base this tab last saved. (Pass 122b: piece order and date added
  // are never a conflict; between two tabs of one browser, where the person is working
  // in THIS one, this tab's value is the one kept, exactly as it was when they were
  // listed as conflicts and this tab's value was kept.)
  // (Pass 126: a setting both tabs changed goes to the more recent change; a tie keeps this
  // tab's value. A chunk both tabs logged is combined, with this tab's last save as the base.)
  const plan = planPieceMerge({ local: M, remote: S, base: piecePartFingerprints(L), softWins: "local", baseProgress: canonicalPiece(L).progress || {} });
  if (plan.status === "identical") return { kind: "reload", storagePiece: S };
  if (plan.status === "merged" || plan.status === "conflicts") {
    return { kind: "merge", piece: plan.merged, storagePiece: S, status: plan.status, conflicts: plan.conflicts, folded: foldedReport(plan, canonicalPiece(M)) };
  }
  // A grid change against progress, or nothing to compare from: it can't be put
  // together here. This tab's copy is kept (and will be written over storage's);
  // the result says so, and docs/Decisions.md keeps it open.
  return { kind: "keep", storagePiece: S, status: plan.status, reason: plan.reason, conflicts: [], wholePiece: plan.wholePiece };
}

function decideTechnique(M, S, L) {
  if (!isObject(M) || S === undefined) return { action: "none" };
  const partsS = techniquePartFingerprints(S);
  if (!isObject(L)) {
    // No record of what this tab saved: it can't tell what changed, so it
    // doesn't act (its first save is the old, unconditional one).
    return { action: "none" };
  }
  if (sameParts(partsS, techniquePartFingerprints(L))) return { action: "none" };
  const partsM = techniquePartFingerprints(M);
  if (sameParts(partsS, partsM)) return { action: "reload", storageTechnique: S };
  if (sameParts(partsM, techniquePartFingerprints(L))) return { action: "reload", storageTechnique: S };
  // The library's engine keeps the REMOTE side's value where both changed the
  // same thing. Here this tab's unsaved change is the one to keep, so storage is
  // passed as "local" and this tab's copy as "remote".
  const plan = planTechniqueMerge({ local: S, remote: M, base: techniquePartFingerprints(L) });
  if (plan.status === "merged") return { action: "merge", technique: plan.merged, storageTechnique: S, status: plan.status, notices: plan.notices };
  if (plan.status === "identical" || plan.status === "local-only") return { action: "reload", storageTechnique: S };
  return { action: "keep", memory: M, storageTechnique: S, status: plan.status, reason: plan.reason };
}

// What should a tab do about what another tab wrote to storage?
//
//   inMemory   { pieces: { id: piece }, technique }   this tab's state
//   inStorage  readStorageSnapshot's answer (parsed, not yet migrated)
//   lastSaved  { pieces: { id: piece }, technique }   what this tab last saved or loaded
//   busy       ids of pieces in use (isPieceBusy): nothing is applied to them
//   pieceIds   which pieces to look at (default: every id any of the three knows)
//   technique  look at the technique library (default true)
//
// Per piece (`result.pieces`):
//   reload   changed in storage, nothing unsaved here: replace this tab's copy
//            (through validateAndMigratePiece, as a normal load does)
//   add      new in storage: add it
//   remove   gone from storage (another tab deleted it): remove it here too
//   merge    changed in storage AND unsaved here: this tab's copy with the
//            other's changes folded in, part by part (Pass 117's engine, base =
//            the copy this tab last saved), never dropping either side's sessions
//   keep     changed in both but can't be put together: this tab's copy is kept
//   deferred in use (busy): nothing applied, try again when it is idle
// and `result.technique` ({ action: "none"|"reload"|"merge"|"keep", ... }).
export function reconcileFromStorage({ inMemory, inStorage, lastSaved, busy = [], pieceIds = null, technique = true } = {}) {
  // Storage that can't be read at all says nothing: it must never read as
  // "every piece was deleted".
  if (inStorage && inStorage.available === false) return { pieces: { reload: {}, add: {}, remove: [], merge: {}, keep: {}, deferred: [] }, technique: { action: "none" } };
  const memPieces = (inMemory && inMemory.pieces) || {};
  const lastPieces = (lastSaved && lastSaved.pieces) || {};
  const stored = (inStorage && inStorage.pieces) || {};
  const unreadable = new Set((inStorage && inStorage.unreadable) || []);
  const busySet = new Set(busy || []);
  const pieces = { reload: {}, add: {}, remove: [], merge: {}, keep: {}, deferred: [] };

  const ids = pieceIds || [...new Set([...Object.keys(memPieces), ...Object.keys(lastPieces), ...Object.keys(stored)])];
  ids.forEach((id) => {
    if (unreadable.has(id)) return;
    const rawS = has(stored, id) ? stored[id] : undefined;
    const S = rawS === undefined ? undefined : migrateStoredPiece(rawS, id);
    if (rawS !== undefined && S === null) return; // not a usable piece: never a reason to delete anything
    const M = has(memPieces, id) ? memPieces[id] : undefined;
    const L = has(lastPieces, id) ? lastPieces[id] : undefined;
    const d = decidePiece(M, S, L);
    if (d.kind === "none") return;
    if (busySet.has(id)) {
      pieces.deferred.push(id);
      return;
    }
    if (d.kind === "remove") pieces.remove.push(id);
    else if (d.kind === "reload") pieces.reload[id] = d.storagePiece;
    else if (d.kind === "add") pieces.add[id] = d.storagePiece;
    else if (d.kind === "merge") pieces.merge[id] = { piece: d.piece, storagePiece: d.storagePiece, status: d.status, conflicts: d.conflicts, folded: d.folded };
    else if (d.kind === "keep") pieces.keep[id] = { piece: M, storagePiece: d.storagePiece, status: d.status, reason: d.reason, conflicts: d.conflicts, wholePiece: d.wholePiece };
  });

  let tech = { action: "none" };
  if (technique && inStorage && !inStorage.techniqueUnreadable && inStorage.technique !== undefined) {
    let S;
    try {
      S = isObject(inStorage.technique) ? validateAndMigrateTechnique(inStorage.technique) : undefined;
    } catch (e) {
      S = undefined;
    }
    tech = decideTechnique(inMemory && inMemory.technique, S, lastSaved && lastSaved.technique);
  }
  return { pieces, technique: tech };
}

// True when the answer asks for anything at all.
export function hasReconcileWork(result) {
  const p = result.pieces;
  return (
    Object.keys(p.reload).length > 0 ||
    Object.keys(p.add).length > 0 ||
    p.remove.length > 0 ||
    Object.keys(p.merge).length > 0 ||
    Object.keys(p.keep).length > 0 ||
    result.technique.action !== "none"
  );
}

/* ------------------------------------------------------------------ */
/*  Applying the answer                                                */
/* ------------------------------------------------------------------ */

// The new `pieces` map. `snapshot` is the map the answer was worked out from:
// an id whose current copy is no longer the one that was looked at (an update
// React hadn't applied yet) is left alone, so nothing newer is overwritten; the
// write guard notices the difference and asks again. Pure, so a React updater
// can call it.
export function applyPiecesResult(current, snapshot, result) {
  const r = result.pieces;
  const unchanged = (id) => (has(current, id) ? current[id] : undefined) === (has(snapshot, id) ? snapshot[id] : undefined);
  let next = current;
  const set = (id, value) => {
    if (!unchanged(id)) return;
    if (next === current) next = { ...current };
    if (value === undefined) delete next[id];
    else next[id] = value;
  };
  Object.keys(r.reload).forEach((id) => set(id, r.reload[id]));
  Object.keys(r.add).forEach((id) => set(id, r.add[id]));
  Object.keys(r.merge).forEach((id) => set(id, r.merge[id].piece));
  r.remove.forEach((id) => set(id, undefined));
  return next;
}

export function applyTechniqueResult(current, snapshot, result) {
  const t = result.technique;
  if (current !== snapshot) return current;
  if (t.action === "reload") return t.storageTechnique;
  if (t.action === "merge") return t.technique;
  return current;
}

// What this tab's "last saved" map should say once the answer has landed. These
// are promises, not changes: "once this tab's copy of `id` IS `memory`, the copy
// last saved is `saved`". They are settled only when the committed state really
// holds `memory` (settleBaselines), so a result that couldn't be applied (it was
// skipped above) never moves the baseline, and the next write can't slip past.
export function baselinesFor(result) {
  const r = result.pieces;
  const pieces = {};
  Object.keys(r.reload).forEach((id) => (pieces[id] = { memory: r.reload[id], saved: r.reload[id] }));
  Object.keys(r.add).forEach((id) => (pieces[id] = { memory: r.add[id], saved: r.add[id] }));
  // The other tab's copy is what storage holds, so it is the "last saved" one:
  // this tab's merged copy then differs from it and is written.
  Object.keys(r.merge).forEach((id) => (pieces[id] = { memory: r.merge[id].piece, saved: r.merge[id].storagePiece }));
  Object.keys(r.keep).forEach((id) => (pieces[id] = { memory: r.keep[id].piece, saved: r.keep[id].storagePiece }));
  r.remove.forEach((id) => (pieces[id] = { memory: null, saved: undefined }));
  const t = result.technique;
  let technique = null;
  if (t.action === "reload") technique = { memory: t.storageTechnique, saved: t.storageTechnique };
  else if (t.action === "merge") technique = { memory: t.technique, saved: t.storageTechnique };
  else if (t.action === "keep") technique = { memory: t.memory, saved: t.storageTechnique };
  return { pieces, technique };
}

// Pure: settle the promises against the committed state. Returns the new
// "last saved" pieces map and the promises still waiting.
export function settleBaselines({ pieces, lastSavedPieces, pending }) {
  let next = lastSavedPieces;
  const waiting = {};
  Object.keys(pending || {}).forEach((id) => {
    const p = pending[id];
    const holds = p.memory === null ? !has(pieces, id) : has(pieces, id) && pieces[id] === p.memory;
    if (!holds) {
      waiting[id] = p;
      return;
    }
    if (next === lastSavedPieces) next = { ...lastSavedPieces };
    if (p.saved === undefined) delete next[id];
    else next[id] = p.saved;
  });
  return { lastSavedPieces: next, pending: waiting };
}

// The technique library's twin of settleBaselines: the library last saved, once
// the committed state holds the copy the promise names.
export function settleTechniqueBaseline({ technique, lastSavedTechnique, pending }) {
  if (!pending) return { lastSavedTechnique, pending: null };
  if (technique !== pending.memory) return { lastSavedTechnique, pending };
  return { lastSavedTechnique: pending.saved, pending: null };
}

// One call for the whole job: read storage, decide, and say what to do.
//   memory / lastSaved   { pieces, technique } as App.jsx holds them
// Returns the answer, the promises to settle, and a short summary for the log.
export function syncFromStorage({ memory, lastSaved, busy = [], pieceIds = null, technique = true, storage = defaultStorage() }) {
  const inStorage = readStorageSnapshot({ pieceIds, technique, storage });
  const result = reconcileFromStorage({ inMemory: memory, inStorage, lastSaved, busy, pieceIds, technique });
  const p = result.pieces;
  return {
    result,
    changed: hasReconcileWork(result),
    baselines: baselinesFor(result),
    deferred: p.deferred,
    removedIds: p.remove,
    addedIds: Object.keys(p.add),
    // Anything that could not be put together cleanly, for a log line.
    conflicts: [
      ...Object.keys(p.merge).filter((id) => p.merge[id].conflicts.length).map((id) => ({ id, kind: "parts", parts: p.merge[id].conflicts.map((c) => c.part) })),
      ...Object.keys(p.keep).map((id) => ({ id, kind: p.keep[id].status === "whole-piece-conflict" ? "whole-piece" : "kept", reason: p.keep[id].reason || p.keep[id].status })),
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  The write-time guard                                               */
/* ------------------------------------------------------------------ */

// Does storage hold exactly the text this tab would have written for `piece`?
function storedTextIs(storage, id, piece) {
  if (!storage) return false;
  try {
    const raw = storage.getItem(PIECE_KEY_PREFIX + id);
    return typeof raw === "string" && raw === JSON.stringify(piece);
  } catch (e) {
    return false;
  }
}

// Before this tab writes a piece it checks that storage still holds what this
// tab last saved or loaded. If another tab wrote in between, the write is held
// back (the caller then reconciles) instead of overwriting. It uses the same
// decision as the storage event, so the two can't disagree.
//
// Returns the map to pass to savePieceChanges (a held piece shows its last-saved
// copy there, so it counts as unchanged) and the ids held.
export function guardPieceWrites({ pieces, lastSaved, busy = [], storage = defaultStorage() }) {
  const changed = Object.keys(pieces).filter((id) => !has(lastSaved, id) || lastSaved[id] !== pieces[id]);
  if (!changed.length) return { writable: pieces, hold: [] };
  // Almost every save finds storage exactly as this tab left it. Then the stored
  // text IS what JSON.stringify gives for the copy this tab last saved (it is
  // what it wrote), and the full comparison below (parse, migrate, fingerprint:
  // about 4.5 ms for a 180 KB piece) would only conclude "unchanged". Identical
  // text reaches the same conclusion for a few tenths of a millisecond. A copy
  // that was loaded rather than saved isn't byte-identical to its text and simply
  // takes the full comparison once.
  const needLook = changed.filter((id) => !(has(lastSaved, id) && storedTextIs(storage, id, lastSaved[id])));
  if (!needLook.length) return { writable: pieces, hold: [] };
  const inStorage = readStorageSnapshot({ pieceIds: needLook, technique: false, storage });
  const result = reconcileFromStorage({
    inMemory: { pieces },
    inStorage,
    lastSaved: { pieces: lastSaved },
    busy,
    pieceIds: needLook,
    technique: false,
  });
  const p = result.pieces;
  const hold = [...new Set([...Object.keys(p.reload), ...Object.keys(p.add), ...Object.keys(p.merge), ...Object.keys(p.keep), ...p.remove, ...p.deferred])];
  if (!hold.length) return { writable: pieces, hold: [] };
  const writable = { ...pieces };
  hold.forEach((id) => {
    if (has(lastSaved, id)) writable[id] = lastSaved[id];
    else delete writable[id];
  });
  return { writable, hold };
}

// The technique library's twin: hold the write when storage moved under it.
export function guardTechniqueWrite({ technique, lastSaved, storage = defaultStorage() }) {
  if (!technique || !lastSaved) return { hold: false };
  const inStorage = readStorageSnapshot({ pieceIds: [], technique: true, storage });
  const result = reconcileFromStorage({ inMemory: { technique }, inStorage, lastSaved: { technique: lastSaved }, pieceIds: [], technique: true });
  return { hold: result.technique.action !== "none" };
}

/* ------------------------------------------------------------------ */
/*  The lease: one tab does the account work                           */
/* ------------------------------------------------------------------ */

export const LEASE_KEY = "measureone-tab-lease";
export const LEASE_HEARTBEAT_MS = 10 * 1000; // the holder writes its heartbeat this often
export const LEASE_STALE_MS = 30 * 1000; // a lease not renewed for this long may be taken over
export const LEASE_CHECK_MS = 2 * 1000; // how often every tab looks (the holder renews, the others watch): a takeover is never later than STALE + this
export const LEASE_CONFIRM_MS = 250; // after claiming, wait this long and look again before believing it

function readLease(storage) {
  try {
    const raw = storage.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isObject(parsed) && typeof parsed.tabId === "string" && Number.isFinite(parsed.at) ? { tabId: parsed.tabId, at: parsed.at } : null;
  } catch (e) {
    return null;
  }
}

// A lease nobody can hold any more: not renewed for LEASE_STALE_MS, or stamped
// in the future (a clock set back would otherwise keep it "fresh" for hours).
function leaseIsLive(record, now) {
  if (!record) return false;
  if (record.at > now + LEASE_HEARTBEAT_MS) return false;
  return now - record.at < LEASE_STALE_MS;
}

// A lease in localStorage: { tabId, at } where `at` is the holder's last
// heartbeat. The Web Locks API isn't in Safari 14 (the build target), and
// localStorage has no atomic "create if absent", so a tab CLAIMS (writes its id),
// waits a moment and looks again: only if the record still names it does it
// believe it holds the lease. Two tabs that claim at the same moment both write;
// the last write stands and the other, seeing that on its second look, backs off.
//
// `storage` and `now` are injected so the whole thing runs against a fake clock.
// Timers belong to the caller: call check() every LEASE_CHECK_MS, and confirm()
// LEASE_CONFIRM_MS after a check that returns claiming, and release() when the
// page closes. Each returns { holder, claiming }.
export function createTabLease({ storage, tabId, now = Date.now }) {
  let holder = false;
  let claiming = false;
  let claimedAt = 0;

  const write = (at) => {
    try {
      storage.setItem(LEASE_KEY, JSON.stringify({ tabId, at }));
    } catch (e) {
      /* storage unavailable: this tab never gets the lease, and does no account work */
    }
  };
  const state = () => ({ holder, claiming });
  const claim = (t) => {
    holder = false;
    claiming = true;
    claimedAt = t;
    write(t);
    return state();
  };
  const confirm = () => {
    const record = readLease(storage);
    claiming = false;
    holder = !!record && record.tabId === tabId && leaseIsLive(record, now());
    return state();
  };
  const check = () => {
    // A look that comes in during the wait (a storage event, the tab becoming
    // visible) must not cut it short: the wait is what lets a competing claim
    // that is still on its way become visible. confirm() is the timer's call.
    if (claiming) return now() - claimedAt >= LEASE_CONFIRM_MS ? confirm() : state();
    const t = now();
    const record = readLease(storage);
    if (holder) {
      if (record && record.tabId === tabId) {
        // Renew a little before it is due, so the 2-second looks give a
        // heartbeat every 10 seconds rather than every 11 or 12.
        if (t - record.at >= LEASE_HEARTBEAT_MS - LEASE_CHECK_MS / 2) write(t);
        return state();
      }
      holder = false; // someone else took it (this tab was too slow to renew), or it was removed
    }
    if (!leaseIsLive(record, t)) return claim(t);
    return state();
  };
  // Used right before the account work itself, not just on the timer: a tab
  // that was asleep may have lost the lease since its last look. Looks again.
  const holdsNow = () => {
    if (!holder) return false;
    const record = readLease(storage);
    if (record && record.tabId === tabId && leaseIsLive(record, now())) return true;
    holder = false;
    return false;
  };
  // The page is closing: hand it on at once rather than making the others
  // wait for the lease to go stale.
  const release = () => {
    const record = readLease(storage);
    if (record && record.tabId === tabId) {
      try {
        storage.removeItem(LEASE_KEY);
      } catch (e) {
        /* nothing to do */
      }
    }
    holder = false;
    claiming = false;
    return state();
  };
  return { check, confirm, holdsNow, release, isHolder: () => holder };
}
