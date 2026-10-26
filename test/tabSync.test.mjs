// Pass 119: keeping every tab of one browser in step (src/lib/tabSync.js).
// Three parts: the decision (reconcileFromStorage and what applies it), a small
// model of two tabs sharing one storage (it repeats the few lines of glue that
// App.jsx runs, around the real functions, including the real savePieceChanges),
// and the lease against a fake clock.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateAndMigratePiece, validateAndMigrateTechnique, savePieceChanges, TECHNIQUE_KEY, defaultTechnique, normalizeTechniqueItem } from "../src/lib/storage.js";
import { PIECE_KEY_PREFIX } from "../src/lib/constants.js";
import { piecePartFingerprints } from "../src/lib/pieceMerge.js";
import {
  isPieceBusy,
  busyPieceIds,
  keyScope,
  pieceIdFromKey,
  listStoredPieceIds,
  readStorageSnapshot,
  reconcileFromStorage,
  hasReconcileWork,
  applyPiecesResult,
  applyTechniqueResult,
  baselinesFor,
  settleBaselines,
  settleTechniqueBaseline,
  syncFromStorage,
  guardPieceWrites,
  guardTechniqueWrite,
  createTabLease,
  LEASE_KEY,
  LEASE_HEARTBEAT_MS,
  LEASE_STALE_MS,
  LEASE_CHECK_MS,
  LEASE_CONFIRM_MS,
} from "../src/lib/tabSync.js";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function makePiece(over = {}) {
  const totalMeasures = over.totalMeasures || 32;
  return validateAndMigratePiece({
    id: "p1",
    name: "Ballade No. 1",
    workId: null,
    workName: "",
    composer: "",
    notes: "",
    status: "active",
    markedLearnedElsewhere: false,
    totalMeasures,
    measureDifficulty: Array(totalMeasures).fill(1),
    diffMode: "grid",
    sections: [{ id: "s1", name: "", start: 1, end: totalMeasures }],
    recurringMode: "advanced",
    recurringMeasures: 0,
    recurringPairs: [],
    startDate: "2026-03-01",
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    targetDate: "2026-03-21",
    practiceDaysPerWeek: 7,
    chunkMode: "auto",
    customChunkSize: 4,
    chunkSplitPoints: [],
    targetBPM: null,
    homeKey: null,
    otherKeys: null,
    bpmZones: [],
    recordings: [],
    documents: [],
    createdAt: 1000,
    sortOrder: 1000,
    progress: {},
    rescheduleMarker: null,
    lastPlayedDate: null,
    lastLoggedAt: null,
    memoryAnchors: {},
    updatedAt: 1,
    troubleSpotsEnabled: false,
    troubleSpotDefaultMinutes: 5,
    ...over,
  });
}

// A logged session, the way handleLogSession writes one (`tag` is only for the
// tests to tell sessions apart).
const session = (at, tag) => ({ day: 1, loggedAt: at, loggedDate: "2026-03-01", cleanReps: 3, bpm: 80, outcome: "pass", durationSeconds: 60, tag });

// The piece with one more session on a chunk. Pieces are replaced, never edited.
function withSession(piece, chunkId, at, tag) {
  const prev = piece.progress[chunkId] || { doneDays: [] };
  return {
    ...piece,
    updatedAt: at,
    progress: { ...piece.progress, [chunkId]: { ...prev, doneDays: [...new Set([...(prev.doneDays || []), 1])], sessions: [...(prev.sessions || []), session(at, tag)] } },
  };
}

const tagsOf = (piece) =>
  Object.keys(piece.progress)
    .flatMap((c) => (piece.progress[c].sessions || []).map((s) => s.tag))
    .sort();

// What a piece looks like once loaded (all that the comparison cares about).
const asLoaded = (piece) => validateAndMigratePiece(clone(piece));

/* ------------------------------------------------------------------ */
/*  A world of tabs sharing one storage                                */
/* ------------------------------------------------------------------ */

function makeWorld() {
  const data = new Map();
  const tabs = [];
  const queue = [];
  const storageFor = (tab) => ({
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
      tabs.forEach((t) => t !== tab && queue.push({ to: t, key: k }));
    },
    removeItem: (k) => {
      if (data.delete(k)) tabs.forEach((t) => t !== tab && queue.push({ to: t, key: k }));
    },
  });
  return {
    data,
    tabs,
    storageFor,
    // Deliver every waiting `storage` event. A real event arrives after later
    // writes may have landed, and its handler reads storage as it is NOW.
    deliver() {
      // Tabs that keep rewriting each other's copy never settle: that is a failure, not a hang.
      for (let n = 0; queue.length; n++) {
        assert.ok(n < 500, "storage events never settle (the tabs keep writing over each other)");
        const { to, key } = queue.shift();
        to.onStorage(key);
      }
    },
    dropEvents() {
      queue.length = 0;
    },
    stored(id) {
      const raw = data.get(PIECE_KEY_PREFIX + id);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
    storedIds() {
      return listStoredPieceIds(storageFor(null)).sort();
    },
    storedTechnique() {
      const raw = data.get(TECHNIQUE_KEY);
      return raw === undefined ? undefined : JSON.parse(raw);
    },
  };
}

// One tab. It repeats the glue App.jsx runs around the library (the load, the
// two save effects with the write guard, the `storage` listener and the
// pending-baseline settle) so the library is exercised the way the app uses it.
function makeTab(world, name) {
  const storage = world.storageFor(null);
  const tab = {
    name,
    pieces: {},
    technique: null,
    lastSaved: { pieces: {}, technique: null },
    pending: { pieces: {}, technique: null },
    busyCtx: null,
    deferred: new Set(),
    storage: null,
    log: [],
  };
  tab.storage = world.storageFor(tab);
  world.tabs.push(tab);
  tab.busy = () => busyPieceIds(Object.keys(tab.pieces), tab.busyCtx);

  tab.load = () => {
    const snap = readStorageSnapshot({ storage: tab.storage });
    const found = {};
    Object.keys(snap.pieces).forEach((id) => {
      const m = validateAndMigratePiece(snap.pieces[id]);
      if (m) found[m.id] = m;
    });
    tab.pieces = found;
    tab.lastSaved.pieces = found;
    tab.technique = snap.technique ? validateAndMigrateTechnique(snap.technique) : defaultTechnique();
    tab.lastSaved.technique = tab.technique;
    return tab;
  };

  // The save effects.
  tab.flush = (depth = 0) => {
    const settled = settleBaselines({ pieces: tab.pieces, lastSavedPieces: tab.lastSaved.pieces, pending: tab.pending.pieces });
    tab.lastSaved.pieces = settled.lastSavedPieces;
    tab.pending.pieces = settled.pending;
    const { writable, hold } = guardPieceWrites({ pieces: tab.pieces, lastSaved: tab.lastSaved.pieces, busy: tab.busy(), storage: tab.storage });
    const { saved } = savePieceChanges(
      tab.lastSaved.pieces,
      writable,
      (id, p) => {
        tab.storage.setItem(PIECE_KEY_PREFIX + id, JSON.stringify(p));
        return { ok: true };
      },
      (id) => tab.storage.removeItem(PIECE_KEY_PREFIX + id)
    );
    tab.lastSaved.pieces = saved;

    if (tab.technique) {
      const t = settleTechniqueBaseline({ technique: tab.technique, lastSavedTechnique: tab.lastSaved.technique, pending: tab.pending.technique });
      tab.lastSaved.technique = t.lastSavedTechnique;
      tab.pending.technique = t.pending;
      if (tab.technique !== tab.lastSaved.technique) {
        const g = guardTechniqueWrite({ technique: tab.technique, lastSaved: tab.lastSaved.technique, storage: tab.storage });
        if (!g.hold) {
          tab.storage.setItem(TECHNIQUE_KEY, JSON.stringify(tab.technique));
          tab.lastSaved.technique = tab.technique;
        } else if (depth < 6) {
          tab.reconcile({ pieceIds: [], technique: true }, depth + 1);
        }
      }
    }
    if (hold.length && depth < 6) tab.reconcile({ pieceIds: hold, technique: false }, depth + 1);
  };

  // runTabSync in App.jsx.
  tab.reconcile = (scope = { pieceIds: null, technique: true }, depth = 0) => {
    const memory = { pieces: tab.pieces, technique: tab.technique };
    const out = syncFromStorage({ memory, lastSaved: tab.lastSaved, busy: tab.busy(), pieceIds: scope.pieceIds, technique: scope.technique, storage: tab.storage });
    out.deferred.forEach((id) => tab.deferred.add(id));
    if (!out.changed) return out;
    tab.log.push(out);
    tab.pending.pieces = { ...tab.pending.pieces, ...out.baselines.pieces };
    if (out.baselines.technique) tab.pending.technique = out.baselines.technique;
    tab.pieces = applyPiecesResult(tab.pieces, memory.pieces, out.result);
    tab.technique = applyTechniqueResult(tab.technique, memory.technique, out.result);
    tab.flush(depth);
    return out;
  };

  tab.onStorage = (key) => {
    const scope = keyScope(key);
    if (scope) tab.reconcile(scope);
  };
  // The person does something to a piece in this tab (updatePiece), then the effects run.
  tab.update = (id, fn) => {
    tab.pieces = { ...tab.pieces, [id]: fn(tab.pieces[id]) };
    tab.flush();
  };
  tab.remove = (id) => {
    const next = { ...tab.pieces };
    delete next[id];
    tab.pieces = next;
    tab.flush();
  };
  tab.add = (piece) => {
    tab.pieces = { ...tab.pieces, [piece.id]: piece };
    tab.flush();
  };
  // The person leaves a piece idle again.
  tab.setBusy = (ctx) => {
    tab.busyCtx = ctx;
  };
  tab.becameIdle = () => {
    const ids = [...tab.deferred];
    tab.deferred.clear();
    if (ids.length) tab.reconcile({ pieceIds: ids, technique: false });
  };
  return tab;
}

// A world with piece p1 saved in storage and two tabs that have both loaded it.
function twoTabs(piece = makePiece()) {
  const world = makeWorld();
  const seed = makeTab(world, "seed");
  seed.add(piece);
  world.tabs.length = 0; // the seed tab is gone
  world.dropEvents();
  const A = makeTab(world, "A").load();
  const B = makeTab(world, "B").load();
  return { world, A, B };
}

/* ------------------------------------------------------------------ */
/*  The busy test                                                      */
/* ------------------------------------------------------------------ */

describe("[Pass 119] the busy test", () => {
  const idle = { activePieceId: "p1", interleaveRisk: null, assessmentTimerRisk: false, settingsEditing: false, editDraft: null };
  test("nothing in use: not busy", () => {
    assert.equal(isPieceBusy("p1", idle), false);
    assert.equal(isPieceBusy("p1", null), false);
    assert.equal(isPieceBusy(null, idle), false);
  });
  test("an unconfirmed Interleaved attempt makes the active piece busy, and only that piece", () => {
    const ctx = { ...idle, interleaveRisk: { chunkIds: ["c1"], day: 1 } };
    assert.equal(isPieceBusy("p1", ctx), true);
    assert.equal(isPieceBusy("p2", ctx), false);
  });
  test("a running reassessment timer makes the active piece busy, and only that piece", () => {
    const ctx = { ...idle, assessmentTimerRisk: true };
    assert.equal(isPieceBusy("p1", ctx), true);
    assert.equal(isPieceBusy("p2", ctx), false);
  });
  test("an open Edit piece settings draft makes the piece the draft belongs to busy", () => {
    const ctx = { ...idle, settingsEditing: true, editDraft: { id: "p2" } };
    assert.equal(isPieceBusy("p2", ctx), true);
    assert.equal(isPieceBusy("p1", ctx), false, "the active piece is not the one being edited");
  });
  test("a draft that is not open (settings not being edited) is not busy", () => {
    assert.equal(isPieceBusy("p2", { ...idle, settingsEditing: false, editDraft: { id: "p2" } }), false);
    assert.equal(isPieceBusy("p2", { ...idle, settingsEditing: true, editDraft: null }), false);
  });
  test("busyPieceIds filters a list", () => {
    const ctx = { ...idle, assessmentTimerRisk: true, settingsEditing: true, editDraft: { id: "p3" } };
    assert.deepEqual(busyPieceIds(["p1", "p2", "p3"], ctx), ["p1", "p3"]);
    assert.deepEqual(busyPieceIds([], ctx), []);
  });
});

/* ------------------------------------------------------------------ */
/*  Reading storage                                                    */
/* ------------------------------------------------------------------ */

describe("[Pass 119] reading storage", () => {
  test("keyScope: which keys a tab follows", () => {
    assert.deepEqual(keyScope(PIECE_KEY_PREFIX + "p9"), { pieceIds: ["p9"], technique: false });
    assert.deepEqual(keyScope(TECHNIQUE_KEY), { pieceIds: [], technique: true });
    assert.deepEqual(keyScope(null), { pieceIds: null, technique: true }, "clear(): look at everything");
    assert.equal(keyScope("measureone-active_piece_id"), null, "the active piece is per tab on purpose");
    assert.equal(keyScope("measureone-account-sync"), null);
    assert.equal(keyScope(LEASE_KEY), null);
    assert.equal(pieceIdFromKey("measureone-piece:abc"), "abc");
    assert.equal(pieceIdFromKey("other"), null);
  });

  test("an unreadable entry is reported, never taken for an absent one", () => {
    const world = makeWorld();
    const s = world.storageFor(null);
    s.setItem(PIECE_KEY_PREFIX + "ok", JSON.stringify(makePiece({ id: "ok" })));
    s.setItem(PIECE_KEY_PREFIX + "bad", "{not json");
    s.setItem(PIECE_KEY_PREFIX + "num", "42");
    const snap = readStorageSnapshot({ pieceIds: ["ok", "bad", "num", "gone"], technique: false, storage: s });
    assert.deepEqual(Object.keys(snap.pieces), ["ok"]);
    assert.deepEqual(snap.unreadable.sort(), ["bad", "num"]);
    assert.equal(snap.technique, undefined);
  });

  test("storage that can't be read at all is no information: nothing is removed", () => {
    const p = makePiece();
    const out = syncFromStorage({ memory: { pieces: { p1: p }, technique: null }, lastSaved: { pieces: { p1: p }, technique: null }, storage: null });
    assert.equal(out.changed, false);
    assert.deepEqual(out.removedIds, []);
  });

  test("an unreadable or unusable stored piece is never a reason to remove or replace the one in memory", () => {
    const p = makePiece();
    for (const stored of [undefined]) {
      // unreadable: listed as such
      const out = reconcileFromStorage({
        inMemory: { pieces: { p1: p } },
        inStorage: { pieces: {}, unreadable: ["p1"] },
        lastSaved: { pieces: { p1: p } },
        technique: false,
      });
      assert.equal(hasReconcileWork(out), false);
    }
    // parsed, but not a usable piece (no name): treated the same way
    const out = reconcileFromStorage({
      inMemory: { pieces: { p1: p } },
      inStorage: { pieces: { p1: { id: "p1" } }, unreadable: [] },
      lastSaved: { pieces: { p1: p } },
      technique: false,
    });
    assert.equal(hasReconcileWork(out), false);
  });
});

/* ------------------------------------------------------------------ */
/*  reconcileFromStorage: each case                                    */
/* ------------------------------------------------------------------ */

describe("[Pass 119] reconcileFromStorage: pieces", () => {
  const base = makePiece();
  const reconcile = (mem, stored, last, extra = {}) =>
    reconcileFromStorage({ inMemory: { pieces: mem }, inStorage: { pieces: stored, unreadable: [] }, lastSaved: { pieces: last }, technique: false, ...extra });

  test("storage is as this tab left it: nothing to do, even with an unsaved change here", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const out = reconcile({ p1: mine }, { p1: clone(base) }, { p1: base });
    assert.equal(hasReconcileWork(out), false);
  });

  test("changed in storage and nothing unsaved here: reload it, through validateAndMigratePiece", () => {
    const theirs = withSession(base, "c1", 10, "theirs");
    // As stored: a piece written before a field existed (no ladderConfig), so the
    // reload has to be the migrated one, as a normal load gives it.
    const raw = clone(theirs);
    delete raw.ladderConfig;
    const out = reconcile({ p1: base }, { p1: raw }, { p1: base });
    assert.deepEqual(Object.keys(out.pieces.reload), ["p1"]);
    assert.deepEqual(out.pieces.reload.p1, validateAndMigratePiece(clone(raw)));
    assert.ok(out.pieces.reload.p1.ladderConfig, "migrated: the missing field is back");
    assert.deepEqual(tagsOf(out.pieces.reload.p1), ["theirs"]);
    assert.deepEqual(out.pieces.merge, {});
    assert.deepEqual(out.pieces.remove, []);
  });

  test("a no-op update here (same content, new object) is not an unsaved change: the other tab's copy is simply taken", () => {
    const theirs = withSession(base, "c1", 10, "theirs");
    const touched = { ...base, updatedAt: 99 }; // moved updatedAt only
    const out = reconcile({ p1: touched }, { p1: clone(theirs) }, { p1: base });
    assert.deepEqual(Object.keys(out.pieces.reload), ["p1"]);
    assert.deepEqual(out.pieces.merge, {});
  });

  test("gone from storage because another tab deleted it: remove it here too", () => {
    const out = reconcile({ p1: base }, {}, { p1: base });
    assert.deepEqual(out.pieces.remove, ["p1"]);
  });

  test("gone from storage while this tab has an unsaved change to it: still removed, never written back", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const out = reconcile({ p1: mine }, {}, { p1: base });
    assert.deepEqual(out.pieces.remove, ["p1"]);
    assert.deepEqual(out.pieces.merge, {});
    assert.deepEqual(out.pieces.keep, {});
  });

  test("a piece this tab never saved and storage doesn't have is just new here, not a deletion", () => {
    const out = reconcile({ p1: base }, {}, {});
    assert.equal(hasReconcileWork(out), false);
  });

  test("a new piece in storage: add it (migrated)", () => {
    const p2 = makePiece({ id: "p2", name: "Nocturne" });
    const raw = clone(p2);
    delete raw.ladderConfig;
    const out = reconcile({}, { p2: raw }, {});
    assert.deepEqual(Object.keys(out.pieces.add), ["p2"]);
    assert.ok(out.pieces.add.p2.ladderConfig);
  });

  test("this tab deleted a piece (not written yet) that another tab changed: the delete wins, nothing resurrects it", () => {
    const theirs = withSession(base, "c1", 10, "theirs");
    const out = reconcile({}, { p1: clone(theirs) }, { p1: base });
    assert.equal(hasReconcileWork(out), false);
  });

  test("changed in both, different chunks: merged by part, this tab's copy kept, no session dropped", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const theirs = withSession(base, "c5", 20, "theirs");
    const out = reconcile({ p1: mine }, { p1: clone(theirs) }, { p1: base });
    assert.deepEqual(Object.keys(out.pieces.merge), ["p1"]);
    const m = out.pieces.merge.p1;
    assert.equal(m.status, "merged");
    assert.deepEqual(tagsOf(m.piece), ["mine", "theirs"]);
    assert.deepEqual(m.conflicts, []);
    assert.deepEqual(out.pieces.keep, {});
  });

  test("changed in both, the SAME chunk: this tab's entry is kept and the other tab's session is added to it, not dropped", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const theirs = withSession(base, "c1", 20, "theirs");
    const out = reconcile({ p1: mine }, { p1: clone(theirs) }, { p1: base });
    const m = out.pieces.merge.p1;
    assert.equal(m.status, "conflicts");
    assert.deepEqual(m.conflicts.map((c) => c.part), ["progress:c1"]);
    assert.deepEqual(tagsOf(m.piece), ["mine", "theirs"]);
    // in the order they were logged
    assert.deepEqual(m.piece.progress.c1.sessions.map((s) => s.tag), ["mine", "theirs"]);
    assert.deepEqual(m.folded, [{ id: "c1", sessions: 1 }]);
    assert.equal(m.piece.lastLoggedAt, "2026-03-01");
  });

  test("changed in both, same chunk: a session the OTHER tab undid (it was in the last save) stays undone, not brought back", () => {
    // base holds session 'old' on c1; this tab undid it and logged 'mine'; the other
    // tab kept 'old' and logged 'theirs'
    const withOld = withSession(base, "c1", 5, "old");
    const mine = { ...withSession(withOld, "c1", 10, "mine"), progress: { c1: { ...withSession(withOld, "c1", 10, "mine").progress.c1, sessions: [session(10, "mine")] } } };
    const theirs = withSession(withOld, "c1", 20, "theirs");
    const out = reconcile({ p1: mine }, { p1: clone(theirs) }, { p1: withOld });
    assert.deepEqual(tagsOf(out.pieces.merge.p1.piece), ["mine", "theirs"], "'old' was undone here and is not re-added");
  });

  test("changed in both, same field, different values: this tab's value is kept and the conflict is listed", () => {
    const mine = { ...base, notes: "mine", updatedAt: 10 };
    const theirs = { ...base, notes: "theirs", updatedAt: 20 };
    const out = reconcile({ p1: mine }, { p1: clone(theirs) }, { p1: base });
    const m = out.pieces.merge.p1;
    assert.equal(m.piece.notes, "mine");
    assert.deepEqual(m.conflicts.map((c) => [c.part, c.local, c.remote]), [["notes", "mine", "theirs"]]);
  });

  test("[Pass 122b] both tabs reordered the list differently: this tab's order is kept, and it is no conflict (nobody is asked)", () => {
    const mine = { ...base, sortOrder: 1, updatedAt: 10 };
    const theirs = { ...base, sortOrder: 7, updatedAt: 20 };
    const out = reconcile({ p1: mine }, { p1: clone(theirs) }, { p1: base });
    const m = out.pieces.merge.p1;
    assert.equal(m.piece.sortOrder, 1, "this tab's order, as before");
    assert.deepEqual(m.conflicts, [], "not listed as a conflict any more");
    assert.equal(m.status, "merged");
  });

  test("[Pass 122b] both tabs reordered, each leaving its dated note: the more recent reorder wins, whichever tab it came from", () => {
    const mineNote = { at: 100, ids: ["p1", "p2"] };
    const theirNote = { at: 200, ids: ["p2", "p1"] };
    // the other tab's reorder is the later one: followed (before, this tab's was always kept)
    let out = reconcile({ p1: { ...base, sortOrder: 1, switcherOrder: mineNote, updatedAt: 10 } }, { p1: clone({ ...base, sortOrder: 7, switcherOrder: theirNote, updatedAt: 20 }) }, { p1: base });
    let m = out.pieces.merge.p1;
    assert.deepEqual([m.piece.sortOrder, m.piece.switcherOrder, m.conflicts, m.status], [7, theirNote, [], "merged"]);
    // this tab's is the later one: kept
    out = reconcile({ p1: { ...base, sortOrder: 1, switcherOrder: theirNote, updatedAt: 10 } }, { p1: clone({ ...base, sortOrder: 7, switcherOrder: mineNote, updatedAt: 20 }) }, { p1: base });
    m = out.pieces.merge.p1;
    assert.deepEqual([m.piece.sortOrder, m.piece.switcherOrder], [1, theirNote]);
  });

  test("[Pass 122b] a tab that did not reorder follows the tab that did", () => {
    const theirs = { ...base, sortOrder: 7, updatedAt: 20 };
    const out = reconcile({ p1: base }, { p1: clone(theirs) }, { p1: base });
    assert.equal((out.pieces.reload.p1 || {}).sortOrder, 7);
  });

  test("changed in both, a field here and a different one there: both survive", () => {
    const mine = { ...base, notes: "mine", updatedAt: 10 };
    const theirs = { ...withSession(base, "c5", 20, "theirs"), composer: "Chopin" };
    const out = reconcile({ p1: mine }, { p1: clone(theirs) }, { p1: base });
    const m = out.pieces.merge.p1;
    assert.equal(m.piece.notes, "mine");
    assert.equal(m.piece.composer, "Chopin");
    assert.deepEqual(tagsOf(m.piece), ["theirs"]);
  });

  test("a chunk-grid change against progress can't be put together: this tab's copy is kept and the conflict is reported, not hidden", () => {
    const mine = { ...base, chunkMode: "custom", customChunkSize: 8, updatedAt: 10 };
    const theirs = withSession(base, "c1", 20, "theirs");
    const out = reconcile({ p1: mine }, { p1: clone(theirs) }, { p1: base });
    assert.deepEqual(Object.keys(out.pieces.keep), ["p1"]);
    assert.equal(out.pieces.keep.p1.status, "whole-piece-conflict");
    assert.equal(out.pieces.keep.p1.piece, mine, "this tab's copy, untouched");
    assert.ok(out.pieces.keep.p1.wholePiece);
    const summary = syncFromStorage({
      memory: { pieces: { p1: mine } },
      lastSaved: { pieces: { p1: base } },
      storage: (() => {
        const w = makeWorld();
        const s = w.storageFor(null);
        s.setItem(PIECE_KEY_PREFIX + "p1", JSON.stringify(theirs));
        return s;
      })(),
      technique: false,
    });
    assert.deepEqual(summary.conflicts, [{ id: "p1", kind: "whole-piece", reason: "whole-piece-conflict" }]);
  });

  test("a piece in use is deferred: nothing is applied to it, for every kind of change", () => {
    const theirs = withSession(base, "c5", 20, "theirs");
    // would reload
    let out = reconcile({ p1: base }, { p1: clone(theirs) }, { p1: base }, { busy: ["p1"] });
    assert.deepEqual(out.pieces.deferred, ["p1"]);
    assert.deepEqual(out.pieces.reload, {});
    // would remove
    out = reconcile({ p1: base }, {}, { p1: base }, { busy: ["p1"] });
    assert.deepEqual(out.pieces.deferred, ["p1"]);
    assert.deepEqual(out.pieces.remove, []);
    // would merge
    out = reconcile({ p1: withSession(base, "c1", 10, "mine") }, { p1: clone(theirs) }, { p1: base }, { busy: ["p1"] });
    assert.deepEqual(out.pieces.deferred, ["p1"]);
    assert.deepEqual(out.pieces.merge, {});
    // another piece, not in use, still goes through
    const p2 = makePiece({ id: "p2", name: "Two" });
    out = reconcile({ p1: base }, { p1: clone(theirs), p2: clone(p2) }, { p1: base }, { busy: ["p1"] });
    assert.deepEqual(out.pieces.deferred, ["p1"]);
    assert.deepEqual(Object.keys(out.pieces.add), ["p2"]);
  });

  test("a busy piece with nothing to do is not reported as deferred", () => {
    const out = reconcile({ p1: base }, { p1: clone(base) }, { p1: base }, { busy: ["p1"] });
    assert.deepEqual(out.pieces.deferred, []);
  });
});

describe("[Pass 119] reconcileFromStorage: the technique library", () => {
  const lib = (items = []) => validateAndMigrateTechnique({ ...defaultTechnique(), items: items.map((i) => normalizeTechniqueItem(i)), updatedAt: 5 });
  const item = (id, extra = {}) => ({ id, form: "scale", tonic: "C", quality: "major", octaves: 2, ...extra });
  const reconcile = (mem, stored, last) =>
    reconcileFromStorage({ inMemory: { pieces: {}, technique: mem }, inStorage: { pieces: {}, unreadable: [], technique: stored }, lastSaved: { pieces: {}, technique: last }, pieceIds: [] });

  test("storage is as this tab left it: nothing", () => {
    const base = lib([item("a")]);
    assert.equal(reconcile(base, clone(base), base).technique.action, "none");
  });
  test("changed in storage, nothing unsaved here: reload (through the library's own load)", () => {
    const base = lib([item("a")]);
    const theirs = { ...clone(base), items: [...clone(base).items, item("b")], updatedAt: 9 };
    const out = reconcile(base, theirs, base).technique;
    assert.equal(out.action, "reload");
    assert.deepEqual(out.storageTechnique.items.map((i) => i.id), ["a", "b"]);
  });
  test("changed in both, different things: merged, both changes kept", () => {
    const base = lib([item("a")]);
    const mine = { ...base, items: base.items.map((i) => ({ ...i, starred: true })), updatedAt: 8 };
    const theirs = { ...clone(base), items: [...clone(base).items, item("b")], updatedAt: 9 };
    const out = reconcile(mine, theirs, base).technique;
    assert.equal(out.action, "merge");
    assert.deepEqual(out.technique.items.map((i) => i.id).sort(), ["a", "b"]);
    assert.equal(out.technique.items.find((i) => i.id === "a").starred, true);
  });
  test("changed in both, the same thing: this tab's value is kept (not the other's)", () => {
    const base = lib([item("a")]);
    const mine = { ...base, items: base.items.map((i) => ({ ...i, octaves: 3 })), updatedAt: 8 };
    const theirs = { ...clone(base), items: clone(base).items.map((i) => ({ ...i, octaves: 4 })), updatedAt: 9 };
    const out = reconcile(mine, theirs, base).technique;
    assert.equal(out.action, "merge");
    assert.equal(out.technique.items[0].octaves, 3, "this tab's unsaved choice stands");
  });
  test("nothing in storage, or nothing saved here to compare with: no action", () => {
    const base = lib([item("a")]);
    assert.equal(reconcile(base, undefined, base).technique.action, "none");
    assert.equal(reconcile(base, clone(base), null).technique.action, "none");
  });
});

/* ------------------------------------------------------------------ */
/*  Applying the answer                                                */
/* ------------------------------------------------------------------ */

describe("[Pass 119] applying the answer", () => {
  const base = makePiece();

  test("applyPiecesResult leaves a copy alone when it moved on since the answer was worked out", () => {
    const theirs = withSession(base, "c5", 20, "theirs");
    const snapshot = { p1: base };
    const out = reconcileFromStorage({ inMemory: { pieces: snapshot }, inStorage: { pieces: { p1: clone(theirs) }, unreadable: [] }, lastSaved: { pieces: snapshot }, technique: false });
    const newer = withSession(base, "c1", 30, "newer"); // an update that landed meanwhile
    const next = applyPiecesResult({ p1: newer }, snapshot, out);
    assert.equal(next.p1, newer, "not overwritten");
    const applied = applyPiecesResult({ p1: base }, snapshot, out);
    assert.deepEqual(tagsOf(applied.p1), ["theirs"]);
  });

  test("a removal and an addition apply; the input map is never edited", () => {
    const p2 = makePiece({ id: "p2", name: "Two" });
    const p3 = makePiece({ id: "p3", name: "Three" });
    const snapshot = { p1: base, p2 };
    const out = reconcileFromStorage({ inMemory: { pieces: snapshot }, inStorage: { pieces: { p2: clone(p2), p3: clone(p3) }, unreadable: [] }, lastSaved: { pieces: snapshot }, technique: false });
    const next = applyPiecesResult(snapshot, snapshot, out);
    assert.deepEqual(Object.keys(next).sort(), ["p2", "p3"]);
    assert.deepEqual(Object.keys(snapshot).sort(), ["p1", "p2"]);
  });

  test("settleBaselines moves the 'last saved' copy only once the state really holds the new copy", () => {
    const theirs = asLoaded(withSession(base, "c5", 20, "theirs"));
    const baselines = baselinesFor({ pieces: { reload: { p1: theirs }, add: {}, remove: [], merge: {}, keep: {}, deferred: [] }, technique: { action: "none" } });
    let r = settleBaselines({ pieces: { p1: base }, lastSavedPieces: { p1: base }, pending: baselines.pieces });
    assert.equal(r.lastSavedPieces.p1, base, "state doesn't hold it yet");
    assert.deepEqual(Object.keys(r.pending), ["p1"], "the promise waits");
    r = settleBaselines({ pieces: { p1: theirs }, lastSavedPieces: { p1: base }, pending: r.pending });
    assert.equal(r.lastSavedPieces.p1, theirs);
    assert.deepEqual(r.pending, {});
  });

  test("settleBaselines for a removal drops the piece from 'last saved' once it is gone from the state", () => {
    const baselines = baselinesFor({ pieces: { reload: {}, add: {}, remove: ["p1"], merge: {}, keep: {}, deferred: [] }, technique: { action: "none" } });
    const r = settleBaselines({ pieces: {}, lastSavedPieces: { p1: base }, pending: baselines.pieces });
    assert.deepEqual(r.lastSavedPieces, {});
  });

  test("technique results apply and settle the same way", () => {
    const a = validateAndMigrateTechnique({ ...defaultTechnique(), updatedAt: 1 });
    const b = validateAndMigrateTechnique({ ...defaultTechnique(), settings: { scalesPerDay: 5, minutesPerScale: 5 }, updatedAt: 2 });
    const res = { pieces: { reload: {}, add: {}, remove: [], merge: {}, keep: {}, deferred: [] }, technique: { action: "reload", storageTechnique: b } };
    assert.equal(applyTechniqueResult(a, a, res), b);
    assert.equal(applyTechniqueResult(a, { not: "the same" }, res), a, "moved on since: left alone");
    const pending = baselinesFor(res).technique;
    assert.equal(settleTechniqueBaseline({ technique: a, lastSavedTechnique: a, pending }).lastSavedTechnique, a);
    assert.equal(settleTechniqueBaseline({ technique: b, lastSavedTechnique: a, pending }).lastSavedTechnique, b);
  });
});

/* ------------------------------------------------------------------ */
/*  The write-time guard                                               */
/* ------------------------------------------------------------------ */

describe("[Pass 119] the write-time guard", () => {
  const base = makePiece();
  const storageWith = (pieces) => {
    const w = makeWorld();
    const s = w.storageFor(null);
    Object.keys(pieces).forEach((id) => s.setItem(PIECE_KEY_PREFIX + id, JSON.stringify(pieces[id])));
    return s;
  };

  test("storage as this tab last saved it: the write goes ahead", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const g = guardPieceWrites({ pieces: { p1: mine }, lastSaved: { p1: base }, storage: storageWith({ p1: base }) });
    assert.deepEqual(g.hold, []);
    assert.equal(g.writable.p1, mine);
  });
  test("storage holds the same content in another key order (not byte-identical): still not held", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(base).reverse()));
    assert.notEqual(reordered, JSON.stringify(base));
    const w = makeWorld();
    const s = w.storageFor(null);
    s.setItem(PIECE_KEY_PREFIX + "p1", reordered);
    const g = guardPieceWrites({ pieces: { p1: mine }, lastSaved: { p1: base }, storage: s });
    assert.deepEqual(g.hold, []);
    assert.equal(g.writable.p1, mine);
  });
  test("another tab wrote in between: the write is held, and the piece shows as unchanged so nothing is written", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const theirs = withSession(base, "c5", 20, "theirs");
    const g = guardPieceWrites({ pieces: { p1: mine }, lastSaved: { p1: base }, storage: storageWith({ p1: theirs }) });
    assert.deepEqual(g.hold, ["p1"]);
    assert.equal(g.writable.p1, base);
    const { changed } = savePieceChanges({ p1: base }, g.writable, () => assert.fail("must not write"), () => assert.fail("must not remove"));
    assert.deepEqual(changed, []);
  });
  test("another tab deleted it: the write is held (it would bring the piece back)", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const g = guardPieceWrites({ pieces: { p1: mine }, lastSaved: { p1: base }, storage: storageWith({}) });
    assert.deepEqual(g.hold, ["p1"]);
    assert.equal(g.writable.p1, base);
  });
  test("a brand-new piece (not in storage, never saved) is written", () => {
    const g = guardPieceWrites({ pieces: { p1: base }, lastSaved: {}, storage: storageWith({}) });
    assert.deepEqual(g.hold, []);
  });
  test("a busy piece whose storage moved is held too (its write waits for it to be idle)", () => {
    const mine = withSession(base, "c1", 10, "mine");
    const theirs = withSession(base, "c5", 20, "theirs");
    const g = guardPieceWrites({ pieces: { p1: mine }, lastSaved: { p1: base }, busy: ["p1"], storage: storageWith({ p1: theirs }) });
    assert.deepEqual(g.hold, ["p1"]);
  });
  test("an unreadable stored entry doesn't hold anything", () => {
    const w = makeWorld();
    const s = w.storageFor(null);
    s.setItem(PIECE_KEY_PREFIX + "p1", "{broken");
    const g = guardPieceWrites({ pieces: { p1: withSession(base, "c1", 10, "mine") }, lastSaved: { p1: base }, storage: s });
    assert.deepEqual(g.hold, []);
  });
  test("technique: held when storage moved, not otherwise", () => {
    const lib = validateAndMigrateTechnique({ ...defaultTechnique(), updatedAt: 1 });
    const theirs = { ...clone(lib), settings: { scalesPerDay: 6, minutesPerScale: 5 }, updatedAt: 2 };
    const mine = { ...lib, settings: { scalesPerDay: 4, minutesPerScale: 5 }, updatedAt: 3 };
    const w = makeWorld();
    const s = w.storageFor(null);
    s.setItem(TECHNIQUE_KEY, JSON.stringify(lib));
    assert.equal(guardTechniqueWrite({ technique: mine, lastSaved: lib, storage: s }).hold, false);
    s.setItem(TECHNIQUE_KEY, JSON.stringify(theirs));
    assert.equal(guardTechniqueWrite({ technique: mine, lastSaved: lib, storage: s }).hold, true);
    assert.equal(guardTechniqueWrite({ technique: mine, lastSaved: null, storage: s }).hold, false, "no record of what was saved: the old, unconditional write");
  });
});

/* ------------------------------------------------------------------ */
/*  Two tabs                                                           */
/* ------------------------------------------------------------------ */

describe("[Pass 119] two tabs of one browser", () => {
  test("a session logged in one tab shows up in the other (storage event)", () => {
    const { world, A, B } = twoTabs();
    A.update("p1", (p) => withSession(p, "c1", 10, "from-A"));
    world.deliver();
    assert.deepEqual(tagsOf(B.pieces.p1), ["from-A"]);
    assert.deepEqual(tagsOf(world.stored("p1")), ["from-A"]);
  });

  test("[the reproduced bug] a tab that was never told still can't overwrite: both sessions survive (write guard, no event delivered first)", () => {
    const { world, A, B } = twoTabs();
    A.update("p1", (p) => withSession(p, "c1", 10, "from-A"));
    // B hasn't heard (the event is still on its way) and logs on another chunk
    B.update("p1", (p) => withSession(p, "c5", 20, "from-B"));
    assert.deepEqual(tagsOf(world.stored("p1")), ["from-A", "from-B"], "storage holds both");
    assert.deepEqual(tagsOf(B.pieces.p1), ["from-A", "from-B"]);
    world.deliver();
    assert.deepEqual(tagsOf(A.pieces.p1), ["from-A", "from-B"], "and A has B's after the event");
    assert.deepEqual(tagsOf(world.stored("p1")), ["from-A", "from-B"]);
  });

  test("the same chunk in both tabs: neither session is lost", () => {
    const { world, A, B } = twoTabs();
    A.update("p1", (p) => withSession(p, "c1", 10, "from-A"));
    B.update("p1", (p) => withSession(p, "c1", 20, "from-B"));
    world.deliver();
    assert.deepEqual(tagsOf(world.stored("p1")), ["from-A", "from-B"]);
    assert.deepEqual(tagsOf(A.pieces.p1), ["from-A", "from-B"]);
    assert.deepEqual(tagsOf(B.pieces.p1), ["from-A", "from-B"]);
  });

  test("[the reproduced bug] a piece deleted in one tab is gone from the other and does not come back", () => {
    const { world, A, B } = twoTabs();
    A.remove("p1");
    assert.deepEqual(world.storedIds(), []);
    // B changes its stale copy BEFORE hearing about the deletion: it must not resurrect the piece
    B.update("p1", (p) => withSession(p, "c1", 20, "from-B"));
    assert.deepEqual(world.storedIds(), [], "not written back");
    assert.deepEqual(Object.keys(B.pieces), [], "removed from B");
    world.deliver();
    assert.deepEqual(Object.keys(A.pieces), []);
    assert.deepEqual(world.storedIds(), []);
  });

  test("a deletion heard by event removes the piece from the other tab and writes nothing", () => {
    const { world, A, B } = twoTabs();
    A.remove("p1");
    world.deliver();
    assert.deepEqual(Object.keys(B.pieces), []);
    assert.deepEqual(world.storedIds(), []);
  });

  test("a new piece in one tab appears in the other", () => {
    const { world, A, B } = twoTabs();
    A.add(makePiece({ id: "p2", name: "Nocturne" }));
    world.deliver();
    assert.deepEqual(Object.keys(B.pieces).sort(), ["p1", "p2"]);
  });

  test("a piece in use is left alone until it is idle, then the change applies", () => {
    const { world, A, B } = twoTabs();
    B.setBusy({ activePieceId: "p1", interleaveRisk: { chunkIds: ["c1"], day: 1 }, assessmentTimerRisk: false, settingsEditing: false, editDraft: null });
    A.update("p1", (p) => withSession(p, "c1", 10, "from-A"));
    world.deliver();
    assert.deepEqual(tagsOf(B.pieces.p1), [], "B is mid-attempt: untouched");
    // B's own change while busy is held back too (not written over A's), and not lost
    B.update("p1", (p) => withSession(p, "c5", 20, "from-B"));
    assert.deepEqual(tagsOf(world.stored("p1")), ["from-A"], "storage still has A's session, B didn't overwrite it");
    assert.deepEqual(tagsOf(B.pieces.p1), ["from-B"]);
    // B finishes: the two come together
    B.setBusy(null);
    B.becameIdle();
    assert.deepEqual(tagsOf(B.pieces.p1), ["from-A", "from-B"]);
    assert.deepEqual(tagsOf(world.stored("p1")), ["from-A", "from-B"]);
    world.deliver();
    assert.deepEqual(tagsOf(A.pieces.p1), ["from-A", "from-B"]);
  });

  test("a deletion of a piece in use waits too, and applies when idle", () => {
    const { world, A, B } = twoTabs();
    B.setBusy({ activePieceId: "p9", interleaveRisk: null, assessmentTimerRisk: false, settingsEditing: true, editDraft: { id: "p1" } });
    A.remove("p1");
    world.deliver();
    assert.deepEqual(Object.keys(B.pieces), ["p1"], "its settings are open: not pulled away");
    B.setBusy(null);
    B.becameIdle();
    assert.deepEqual(Object.keys(B.pieces), []);
    assert.deepEqual(world.storedIds(), []);
  });

  test("the technique library follows the other tab, and a race keeps both changes", () => {
    const { world, A, B } = twoTabs();
    const star = (t, id) => ({ ...t, items: t.items.map((i) => (i.id === id ? { ...i, starred: !i.starred } : i)), updatedAt: Date.now() });
    A.technique = { ...A.technique, items: [normalizeTechniqueItem({ id: "a", tonic: "C", quality: "major" }), normalizeTechniqueItem({ id: "b", tonic: "G", quality: "major" })], updatedAt: 1 };
    A.flush();
    world.deliver();
    assert.deepEqual(B.technique.items.map((i) => i.id), ["a", "b"]);
    // both change different scales before either hears
    A.technique = star(A.technique, "a");
    A.flush();
    B.technique = star(B.technique, "b");
    B.flush();
    world.deliver();
    const stored = validateAndMigrateTechnique(world.storedTechnique());
    assert.equal(stored.items.find((i) => i.id === "a").starred, true);
    assert.equal(stored.items.find((i) => i.id === "b").starred, true);
    assert.equal(A.technique.items.find((i) => i.id === "b").starred, true);
    assert.equal(B.technique.items.find((i) => i.id === "a").starred, true);
  });

  test("the other tab's copy is taken without writing anything back (no echo)", () => {
    const { world, A, B } = twoTabs();
    A.update("p1", (p) => withSession(p, "c1", 10, "from-A"));
    const before = JSON.stringify(world.stored("p1"));
    let writes = 0;
    const real = B.storage.setItem;
    B.storage.setItem = (k, v) => {
      writes++;
      return real(k, v);
    };
    world.deliver();
    assert.equal(writes, 0, "B only reloads");
    assert.equal(JSON.stringify(world.stored("p1")), before);
  });

  test("a clear() in another tab (key null) removes what is gone, and keeps nothing alive", () => {
    const { world, A, B } = twoTabs();
    world.data.clear();
    B.onStorage(null);
    assert.deepEqual(Object.keys(B.pieces), []);
    assert.deepEqual(world.storedIds(), []);
  });

  test("an unreadable entry in storage never removes the piece in this tab", () => {
    const { world, A, B } = twoTabs();
    world.data.set(PIECE_KEY_PREFIX + "p1", "{corrupt");
    B.onStorage(PIECE_KEY_PREFIX + "p1");
    assert.deepEqual(Object.keys(B.pieces), ["p1"]);
  });

  // Seeded runs: two tabs log sessions on random chunks, sometimes hearing about each other's
  // writes at once, sometimes late, sometimes only at the end. However it goes, no logged session
  // is ever missing from storage or from either tab afterwards.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  test("seeded runs: no logged session is ever lost, and both tabs and storage end up the same (seeds 1 to 200)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seeded(seed);
      const { world, A, B } = twoTabs();
      const logged = [];
      let at = 100;
      const steps = 6 + Math.floor(rng() * 14);
      for (let i = 0; i < steps; i++) {
        const tab = rng() < 0.5 ? A : B;
        const chunk = ["c1", "c5", "c9"][Math.floor(rng() * 3)];
        const tag = `${tab.name}${i}`;
        at += 10;
        tab.update("p1", (p) => withSession(p, chunk, at, tag));
        logged.push(tag);
        const r = rng();
        if (r < 0.5) world.deliver();
        else if (r < 0.6) world.dropEvents(); // an event that never arrives
      }
      world.deliver();
      const want = [...logged].sort();
      // The guard alone keeps everything in storage, even where an event never arrived.
      assert.deepEqual(tagsOf(world.stored("p1")), want, `seed ${seed}: storage`);
      // A tab that missed an event hears at its next catch-up (what taking the lease, or its own next write, does).
      A.reconcile();
      B.reconcile();
      world.deliver();
      A.reconcile();
      B.reconcile();
      assert.deepEqual(tagsOf(world.stored("p1")), want, `seed ${seed}: storage after catch-up`);
      assert.deepEqual(tagsOf(A.pieces.p1), want, `seed ${seed}: tab A`);
      assert.deepEqual(tagsOf(B.pieces.p1), want, `seed ${seed}: tab B`);
    }
  });
});

describe("[Pass 119] a lost event is made up for by the full catch-up", () => {
  test("a tab that missed every event catches up when it reconciles everything (what taking the lease does)", () => {
    const { world, A, B } = twoTabs();
    A.update("p1", (p) => withSession(p, "c1", 10, "from-A"));
    A.add(makePiece({ id: "p2", name: "Nocturne" }));
    world.dropEvents();
    assert.deepEqual(tagsOf(B.pieces.p1), []);
    B.reconcile({ pieceIds: null, technique: true });
    assert.deepEqual(tagsOf(B.pieces.p1), ["from-A"]);
    assert.deepEqual(Object.keys(B.pieces).sort(), ["p1", "p2"]);
  });
});

/* ------------------------------------------------------------------ */
/*  The lease                                                          */
/* ------------------------------------------------------------------ */

describe("[Pass 119] the lease", () => {
  function leaseWorld() {
    const data = new Map();
    const storage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => void data.set(k, String(v)),
      removeItem: (k) => void data.delete(k),
    };
    const clock = { t: 1_000_000 };
    const now = () => clock.t;
    const tab = (tabId, view = storage) => createTabLease({ storage: view, tabId, now });
    return { data, storage, clock, tab };
  }
  // The tab looks, and if it claimed, looks again after the short wait.
  const settle = (lease) => {
    let s = lease.check();
    if (s.claiming) s = lease.confirm();
    return s;
  };

  test("a lone tab takes the lease and renews it with a heartbeat every 10 seconds (looking every LEASE_CHECK_MS)", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    assert.equal(settle(a).holder, true);
    const first = JSON.parse(w.data.get(LEASE_KEY)).at;
    const beats = [];
    for (let elapsed = LEASE_CHECK_MS; elapsed <= 40 * 1000; elapsed += LEASE_CHECK_MS) {
      w.clock.t += LEASE_CHECK_MS;
      a.check();
      const at = JSON.parse(w.data.get(LEASE_KEY)).at;
      if (!beats.length || beats[beats.length - 1] !== at) beats.push(at);
    }
    // the claim itself is the first beat; the looks 2 s later don't renew; then a beat every 10 s
    assert.deepEqual(beats.slice(0, 4).map((t) => (t - first) / 1000), [0, 10, 20, 30]);
    assert.equal(a.holdsNow(), true);
  });

  test("only one holder: a second tab sees a live lease and does not take it", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    const b = w.tab("B");
    settle(a);
    for (let i = 0; i < 20; i++) {
      w.clock.t += LEASE_CHECK_MS;
      a.check();
      assert.equal(b.check().holder, false);
      assert.equal(b.check().claiming, false);
    }
    assert.equal(a.isHolder(), true);
    assert.equal(b.isHolder(), false);
    assert.equal(JSON.parse(w.data.get(LEASE_KEY)).tabId, "A");
  });

  test("two tabs that claim at the very same moment: exactly one ends up holding it", () => {
    const w = leaseWorld();
    let blind = true;
    // B looks at a copy of storage that hasn't caught up with A's write yet.
    const lagging = { ...w.storage, getItem: (k) => (blind ? null : w.storage.getItem(k)) };
    const A = w.tab("A");
    const B = w.tab("B", lagging);
    assert.equal(A.check().claiming, true, "A sees no lease and writes its claim");
    assert.equal(B.check().claiming, true, "B saw nothing yet and writes on top");
    blind = false; // by the second look the truth is visible: B wrote last
    const a = A.confirm();
    const b = B.confirm();
    assert.equal([a.holder, b.holder].filter(Boolean).length, 1, "exactly one holder");
    assert.equal(b.holder, true, "the last write stands");
    assert.equal(a.holder, false);
    assert.equal(JSON.parse(w.data.get(LEASE_KEY)).tabId, "B");
  });

  test("a look during the confirm wait does not cut the wait short (a competing claim may still be on its way)", () => {
    const w = leaseWorld();
    const data = w.data;
    // both tabs read only what they wrote themselves until the other's write has "propagated"
    const lagging = (own) => ({ getItem: (k) => (own.v !== undefined ? own.v : data.get(k) ?? null), setItem: (k, v) => { own.v = String(v); data.set(k, String(v)); }, removeItem: (k) => void data.delete(k) });
    const ownA = { v: null };
    const ownB = { v: null };
    const A = w.tab("A", lagging(ownA));
    const B = w.tab("B", lagging(ownB));
    B.check(); // B claims first
    A.check(); // A claims right after; A's write is the last one and stands
    const early = B.check(); // an event makes B look again before its wait is over
    assert.equal(early.holder, false, "not yet believed");
    assert.equal(early.claiming, true, "still waiting");
    delete ownA.v; // propagation catches up
    delete ownB.v;
    w.clock.t += LEASE_CONFIRM_MS;
    assert.equal(A.confirm().holder, true);
    assert.equal(B.confirm().holder, false, "B sees A's write when its wait ends");
  });

  test("a look after the confirm wait does confirm (a tab whose timer was throttled still settles)", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    assert.equal(a.check().claiming, true);
    w.clock.t += LEASE_CONFIRM_MS;
    assert.equal(a.check().holder, true);
  });

  test("a takeover happens only after 30 seconds without a heartbeat", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    const b = w.tab("B");
    settle(a); // A holds, then goes quiet (the tab hangs, or is closed without releasing)
    w.clock.t += LEASE_STALE_MS - 1;
    assert.equal(b.check().claiming, false, "29.999 s: still A's");
    assert.equal(b.isHolder(), false);
    w.clock.t += 1;
    assert.equal(b.check().claiming, true, "30 s: stale, B claims");
    assert.equal(b.confirm().holder, true);
    assert.equal(JSON.parse(w.data.get(LEASE_KEY)).tabId, "B");
  });

  test("the old holder, waking up late, finds it has lost the lease and does not take it back", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    const b = w.tab("B");
    settle(a);
    w.clock.t += LEASE_STALE_MS;
    settle(b);
    assert.equal(a.holdsNow(), false, "A re-reads before doing any work: B has it");
    assert.equal(a.check().holder, false);
    assert.equal(a.check().claiming, false);
    assert.equal(JSON.parse(w.data.get(LEASE_KEY)).tabId, "B");
  });

  test("a holder whose own heartbeat went stale (nobody took over) is not trusted for the work, and claims again at its next look", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    settle(a);
    w.clock.t += LEASE_STALE_MS + 5000;
    assert.equal(a.holdsNow(), false);
    assert.equal(settle(a).holder, true);
  });

  test("release on close: the others can take over at once", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    const b = w.tab("B");
    settle(a);
    assert.equal(b.check().claiming, false);
    a.release();
    assert.equal(w.data.has(LEASE_KEY), false);
    assert.equal(a.isHolder(), false);
    assert.equal(settle(b).holder, true, "no 30-second wait");
  });

  test("release by a tab that doesn't hold it leaves the holder's lease alone", () => {
    const w = leaseWorld();
    const a = w.tab("A");
    const b = w.tab("B");
    settle(a);
    b.release();
    assert.equal(JSON.parse(w.data.get(LEASE_KEY)).tabId, "A");
  });

  test("a lease stamped in the future (the clock was set back) is not honored", () => {
    const w = leaseWorld();
    w.data.set(LEASE_KEY, JSON.stringify({ tabId: "ghost", at: w.clock.t + 3 * 60 * 60 * 1000 }));
    const b = w.tab("B");
    assert.equal(settle(b).holder, true);
  });

  test("an unreadable lease record is treated as no lease", () => {
    const w = leaseWorld();
    w.data.set(LEASE_KEY, "{nope");
    assert.equal(settle(w.tab("B")).holder, true);
  });

  test("storage that throws never gives a tab the lease, and nothing throws", () => {
    const w = leaseWorld();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const a = w.tab("A", broken);
    assert.equal(settle(a).holder, false);
    assert.equal(a.holdsNow(), false);
    a.release();
  });

  test("a full life: A holds, A closes, B takes over; B hangs, C takes over after 30 seconds", () => {
    const w = leaseWorld();
    const [a, b, c] = ["A", "B", "C"].map((id) => w.tab(id));
    settle(a);
    a.release();
    settle(b);
    assert.equal(b.isHolder(), true);
    w.clock.t += LEASE_STALE_MS;
    assert.equal(settle(c).holder, true);
    assert.equal(b.holdsNow(), false);
  });
});
