// Pass 117: merging a piece by part (src/lib/pieceMerge.js). The engine only:
// pure functions, nothing wired into the app. Two halves: small hand-made
// pieces for each rule, and a seeded, deterministic simulation of two devices
// that start from one piece, edit it offline in random ways and sync in random
// orders, checking six invariants after every merge.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import { generateAllChunks, splitPracticeChunk, canSplitChunk } from "../src/lib/chunking.js";
import {
  insertSplitHalfIntoMarkerChain,
  computeRemainingConnectorIds,
  computeRescheduleRemainder,
  getEffectiveTimeline,
  computeScheduleStatus,
  countBehindDays,
  classifyDayCompletion,
  movedIdsForDay,
} from "../src/lib/scheduling.js";
import { computeLadderAdvance } from "../src/lib/ladder.js";
import { addDaysISO, todayISODate, elapsedDay } from "../src/lib/utils.js";
import {
  fingerprint as pieceMergeFingerprint,
  canonicalPiece,
  pieceParts,
  piecePartFingerprints,
  planPieceMerge,
  STRUCTURE_FIELDS,
  unionProgressEntries,
  isValidChoice,
  WHOLE_PIECE_PART,
  SOFT_PARTS,
  compareSwitcherOrder,
  isOrderNote,
  compareOrderNotes,
  laterOrderNote,
  latestSwitcherOrder,
  nextOrderStamp,
  makeOrderNote,
  sortPiecesForSwitcher,
  planSwitcherMove,
} from "../src/lib/pieceMerge.js";
import { fingerprint as accountSyncFingerprint } from "../src/lib/accountSync.js";

/* ------------------------------------------------------------------ */
/*  Helpers: pieces, sessions, a seeded random source                  */
/* ------------------------------------------------------------------ */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => isDeepStrictEqual(clone(a), clone(b));

// A complete piece, in the shape the app saves, loaded the way the app loads it.
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

// mulberry32: a small seeded generator, so a run is a pure function of its seed.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickOf = (rng, list) => list[Math.floor(rng() * list.length)];
const intIn = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// What a reload does to a piece that was just edited: through JSON and the
// loader, with a fresh updatedAt stamp (the app stamps every change).
function reload(piece, stamp) {
  return { ...validateAndMigratePiece(clone(piece)), updatedAt: stamp };
}

// Logs one session on a chunk the way App.jsx's handleLogSession does: the
// session record (with its ladder snapshot), the day, the ladder advance.
// `loggedAt` must be unique: it is how the simulation tells sessions apart.
function logSession(piece, chunkId, { day, loggedAt, bpm = 80, cleanReps = 3, outcome = "pass" }) {
  const loggedDate = addDaysISO(piece.startDate, day - 1);
  const prev = piece.progress[chunkId] || { doneDays: [] };
  const ladderSnapshot = {
    stage: prev.stage ?? null,
    consecutivePasses: prev.consecutivePasses ?? 0,
    consecutiveStabilizingFails: prev.consecutiveStabilizingFails ?? 0,
    practiceBPM: prev.practiceBPM ?? null,
    nextDueDate: prev.nextDueDate ?? null,
    tier1Done: prev.tier1Done ?? false,
    needsRelearning: prev.needsRelearning ?? false,
    currentBPM: prev.currentBPM ?? null,
  };
  const advance = computeLadderAdvance(
    {
      stage: prev.stage,
      consecutivePasses: prev.consecutivePasses,
      consecutiveStabilizingFails: prev.consecutiveStabilizingFails,
      practiceBPM: prev.practiceBPM != null ? prev.practiceBPM : bpm,
      targetBPM: null,
      tier1Done: prev.tier1Done,
      needsRelearning: prev.needsRelearning,
      stabilizingEntryBPM: prev.stabilizingEntryBPM,
      settlingEntryBPM: prev.settlingEntryBPM,
      holdingEntryBPM: prev.holdingEntryBPM,
      tempoRatchetK: prev.tempoRatchetK,
      holdingReviewCount: prev.holdingReviewCount,
    },
    { result: outcome, effectiveness: outcome === "fail" ? "low" : outcome === "pass" ? "high" : "good", asOfDate: loggedDate, cleanReps, bpm },
    piece.ladderConfig
  );
  const entry = {
    ...prev,
    doneDays: (prev.doneDays || []).includes(day) ? prev.doneDays : [...(prev.doneDays || []), day],
    sessions: [...(prev.sessions || []), { day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds: 120, ladderSnapshot }],
    currentBPM: bpm,
    stage: advance.stage,
    consecutivePasses: advance.consecutivePasses,
    consecutiveStabilizingFails: advance.consecutiveStabilizingFails,
    practiceBPM: advance.practiceBPM,
    nextDueDate: advance.nextDueDate,
    tier1Done: advance.tier1Done,
    needsRelearning: advance.needsRelearning,
    stabilizingEntryBPM: advance.stabilizingEntryBPM,
    settlingEntryBPM: advance.settlingEntryBPM,
    holdingEntryBPM: advance.holdingEntryBPM,
    tempoRatchetK: advance.tempoRatchetK,
    holdingReviewCount: advance.holdingReviewCount,
  };
  return { ...piece, progress: { ...piece.progress, [chunkId]: entry }, lastLoggedAt: loggedDate };
}

// Undoes the most recent session for `day`, like handleUnlogSession (restores
// the ladder from the session's snapshot when it is the latest one). Note the
// app's undo leaves lastLoggedAt as it was; a reload re-derives it.
function unlogSession(piece, chunkId, day) {
  const prev = piece.progress[chunkId];
  if (!prev) return piece;
  const sessions = [...(prev.sessions || [])];
  const idx = sessions.map((s) => s.day).lastIndexOf(day);
  if (idx === -1) return piece;
  const isLatest = idx === sessions.length - 1;
  const snapshot = sessions[idx].ladderSnapshot;
  sessions.splice(idx, 1);
  const doneDays = sessions.some((s) => s.day === day) ? prev.doneDays : (prev.doneDays || []).filter((d) => d !== day);
  let entry = { ...prev, doneDays, sessions };
  if (isLatest && snapshot) entry = { ...entry, ...snapshot };
  return { ...piece, progress: { ...piece.progress, [chunkId]: entry } };
}

const partsOfTruth = (piece) => {
  const out = {};
  Object.keys(piece).forEach((k) => {
    if (k === "progress" || k === "updatedAt" || k === "lastLoggedAt") return;
    out[k] = piece[k];
  });
  Object.keys(piece.progress || {}).forEach((id) => {
    out["progress:" + id] = piece.progress[id];
  });
  return out;
};

// Every session either list of sessions holds, as a key: the chunk entry (or
// focus spot) it sits in plus its unique loggedAt.
function sessionKeys(piece) {
  const keys = new Set();
  Object.keys(piece.progress || {}).forEach((id) => {
    const entry = piece.progress[id] || {};
    (entry.sessions || []).forEach((s) => keys.add(`${id}|${s.loggedAt}`));
    (entry.troubleSpots || []).forEach((spot) => (spot.sessions || []).forEach((s) => keys.add(`${id}|spot:${spot.id}|${s.loggedAt}`)));
  });
  return keys;
}
function sessionKeysInPart(partKey, value) {
  if (!partKey.startsWith("progress:") || !value) return new Set();
  return sessionKeys({ progress: { [partKey.slice("progress:".length)]: value } });
}

/* ------------------------------------------------------------------ */
/*  The parts of a piece                                               */
/* ------------------------------------------------------------------ */

describe("parts of a piece (Pass 117)", () => {
  test("every top-level field except progress, updatedAt and lastLoggedAt is a part, and each progress entry is its own", () => {
    const p = makePiece({
      progress: {
        c1: { doneDays: [1], sessions: [] },
        __consolidation__: { doneDays: [], sessions: [] },
        __cold_start__: { sessions: [] },
        sr_s1: { doneDays: [], sessions: [] },
      },
    });
    const parts = pieceParts(canonicalPiece(p));
    const keys = Object.keys(parts);
    assert.equal(keys.includes("progress"), false, "the container isn't a part");
    assert.equal(keys.includes("updatedAt"), false);
    assert.equal(keys.includes("lastLoggedAt"), false);
    ["name", "totalMeasures", "sections", "rescheduleMarker", "ladderConfig", "revival", "status", "chunkSplitPoints", "id", "createdAt"].forEach((k) => assert.ok(keys.includes(k), `${k} is a part`));
    ["progress:c1", "progress:__consolidation__", "progress:__cold_start__", "progress:sr_s1"].forEach((k) => assert.ok(keys.includes(k), `${k} is a part`));
    const fingerprints = piecePartFingerprints(p);
    assert.deepEqual(Object.keys(fingerprints).sort(), keys.sort(), "one fingerprint per part, nothing more");
    Object.values(fingerprints).forEach((f) => assert.match(f, /^[0-9a-f]+-[0-9a-f]+$/));
  });

  test("a fingerprint ignores key order and is the same after a reload", () => {
    const p = makePiece({ progress: { c1: { doneDays: [1], sessions: [{ day: 1, loggedAt: 5, loggedDate: "2026-03-01" }] } } });
    const reordered = JSON.parse(JSON.stringify(p), (k, v) => v);
    reordered.progress = { c1: { sessions: [{ loggedDate: "2026-03-01", loggedAt: 5, day: 1 }], doneDays: [1] } };
    assert.deepEqual(piecePartFingerprints(reordered)["progress:c1"], piecePartFingerprints(p)["progress:c1"]);
    // a chunk's first record as the app builds it lacks tier1Done/troubleSpots; loading adds them
    const raw = { ...p, progress: { c1: { doneDays: [1], sessions: [{ day: 1, loggedAt: 5, loggedDate: "2026-03-01" }] } } };
    assert.deepEqual(piecePartFingerprints(raw), piecePartFingerprints(validateAndMigratePiece(clone(raw))));
  });

  test("a part fingerprint is the same label fingerprint() gives the same value (one hash, defined once)", () => {
    const p = makePiece({ progress: { c1: { doneDays: [1], sessions: [] } } });
    const parts = pieceParts(canonicalPiece(p));
    const fps = piecePartFingerprints(p);
    Object.keys(parts).forEach((k) => assert.equal(fps[k], pieceMergeFingerprint(parts[k]), k));
    assert.equal(accountSyncFingerprint({ a: 1, b: [1, 2] }), pieceMergeFingerprint({ b: [1, 2], a: 1 }), "accountSync re-exports the very same function");
  });

  test("changing one thing changes exactly one part's fingerprint", () => {
    const p = makePiece({ progress: { c1: { doneDays: [1], sessions: [] }, c5: { doneDays: [], sessions: [] } } });
    const before = piecePartFingerprints(p);
    const after = piecePartFingerprints({ ...p, name: "Renamed", progress: { ...p.progress, c5: { doneDays: [2], sessions: [] } } });
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]).sort();
    assert.deepEqual(changed, ["name", "progress:c5"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Each rule, on small hand-made pieces                               */
/* ------------------------------------------------------------------ */

describe("merging by part: each rule (Pass 117)", () => {
  const base = () =>
    makePiece({
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, loggedAt: 100, loggedDate: "2026-03-01", cleanReps: 3, bpm: 80, outcome: "pass" }] },
        c5: { doneDays: [], sessions: [] },
      },
      updatedAt: 10,
    });
  const edit = (piece, patch, stamp = 20) => ({ ...piece, ...patch, updatedAt: stamp });
  const plan = (local, remote, from) => planPieceMerge({ local, remote, base: piecePartFingerprints(from) });

  test("unchanged on both sides: nothing to do, the piece comes back untouched", () => {
    const b = base();
    const r = plan(b, clone(b), b);
    assert.equal(r.status, "identical");
    assert.equal(r.merged, b, "the very same object");
    assert.deepEqual([r.conflicts, r.fromRemote, r.fromLocal, r.agreed], [[], [], [], []]);
  });

  test("changed on one side only: that side's value is taken, whichever side this device is", () => {
    const b = base();
    const mine = edit(b, { name: "My name" }, 30);
    const theirs = edit(b, { notes: "Their notes", status: "paused" }, 40);
    const r = plan(mine, theirs, b);
    assert.equal(r.status, "merged");
    assert.equal(r.merged.name, "My name");
    assert.equal(r.merged.notes, "Their notes");
    assert.equal(r.merged.status, "paused");
    assert.deepEqual(r.fromLocal, ["name"]);
    assert.deepEqual(r.fromRemote, ["notes", "status"]);
    assert.equal(r.merged.updatedAt, 40, "updatedAt is the later of the two");
    // and the other way round
    const back = plan(theirs, mine, b);
    assert.equal(back.merged.name, "My name");
    assert.equal(back.merged.notes, "Their notes");
    assert.deepEqual(back.fromRemote, ["name"]);
  });

  test("two sessions logged on different chunks, one on each side: both are kept, no conflict", () => {
    const b = base();
    const mine = logSession(b, "c9", { day: 2, loggedAt: 201 });
    const theirs = logSession(b, "c13", { day: 2, loggedAt: 301 });
    for (const [local, remote] of [[mine, theirs], [theirs, mine]]) {
      const r = plan(local, remote, b);
      assert.equal(r.status, "merged");
      assert.deepEqual([...sessionKeys(r.merged)].sort(), ["c13|301", "c1|100", "c9|201"].sort());
      assert.deepEqual(r.conflicts, []);
    }
  });

  test("changed on both sides to the SAME value is agreement, not a conflict", () => {
    const b = base();
    const mine = edit(b, { status: "paused", name: "Mine" }, 30);
    const theirs = edit(b, { status: "paused", name: "Theirs" }, 40);
    const r = plan(mine, theirs, b);
    assert.deepEqual(r.agreed, ["status"]);
    assert.deepEqual(r.conflicts.map((c) => c.part), ["name"], "only the part they differ on");
    assert.equal(r.merged.status, "paused");
  });

  test("changed on both to different values: a conflict for that part only, this device's value kept, both values listed", () => {
    const b = base();
    const mine = edit({ ...b, notes: "my notes" }, { name: "Mine" }, 30);
    const theirs = edit({ ...b, status: "archived" }, { name: "Theirs" }, 40);
    const r = plan(mine, theirs, b);
    assert.equal(r.status, "conflicts");
    assert.deepEqual(r.conflicts.map((c) => [c.part, c.kind, c.field, c.local, c.remote]), [["name", "field", "name", "Mine", "Theirs"]]);
    assert.equal(r.merged.name, "Mine", "this device's value is kept, never the remote's");
    assert.equal(r.merged.notes, "my notes");
    assert.equal(r.merged.status, "archived", "the rest still merges");
    // it is returned, not resolved: from the other device's side the roles swap
    const back = plan(theirs, mine, b);
    assert.equal(back.merged.name, "Theirs");
    assert.deepEqual(back.conflicts.map((c) => [c.local, c.remote]), [["Theirs", "Mine"]]);
  });

  test("a chunk logged on both sides is a conflict for that chunk only; the sessions of both stay available", () => {
    const b = base();
    const mine = logSession(b, "c5", { day: 2, loggedAt: 211 });
    const theirs = logSession(logSession(b, "c5", { day: 2, loggedAt: 311 }), "c9", { day: 2, loggedAt: 312 });
    const r = plan(mine, theirs, b);
    assert.equal(r.status, "conflicts");
    assert.deepEqual(r.conflicts.map((c) => [c.part, c.kind, c.id]), [["progress:c5", "progress", "c5"]]);
    assert.deepEqual([...sessionKeys({ progress: { c5: r.conflicts[0].remote } })], ["c5|311"], "their session is in the conflict");
    assert.ok(sessionKeys(r.merged).has("c5|211"), "this device's is in the merged piece");
    assert.ok(sessionKeys(r.merged).has("c9|312"), "the unconflicted chunk came across");
  });

  test("a part one side removed and the other left alone is removed (a chunk entry can disappear)", () => {
    const b = base();
    const theirs = { ...b, progress: { c1: b.progress.c1 }, updatedAt: 40 };
    const r = plan(b, theirs, b);
    assert.equal("c5" in r.merged.progress, false);
    assert.deepEqual(r.fromRemote, ["progress:c5"]);
  });

  test("updatedAt is the later of the two and lastLoggedAt follows the merged sessions", () => {
    const b = base();
    const mine = { ...logSession(b, "c9", { day: 3, loggedAt: 221 }), updatedAt: 50 };
    const theirs = { ...logSession(b, "c13", { day: 5, loggedAt: 321 }), updatedAt: 40 };
    const r = plan(mine, theirs, b);
    assert.equal(r.merged.updatedAt, 50);
    assert.equal(r.merged.lastLoggedAt, "2026-03-05");
    assert.equal(r.merged.lastLoggedAt, validateAndMigratePiece(clone(r.merged)).lastLoggedAt, "what a reload would compute");
    // the later date belongs to a session the merged piece doesn't hold (their undo): it is not claimed
    const undone = { ...unlogSession(b, "c1", 1), updatedAt: 60 };
    const noDate = plan(b, undone, b);
    assert.equal(noDate.merged.lastLoggedAt, null);
  });

  test("a structure change on one side plus a progress change on the other is one whole-piece conflict", () => {
    const b = base();
    const chunkSet = generateAllChunks(b);
    const split = splitPracticeChunk(b, "c9");
    assert.ok(canSplitChunk(chunkSet.practiceChunks.find((c) => c.id === "c9")) && split);
    const splitter = reload({ ...b, chunkSplitPoints: split.chunkSplitPoints, progress: split.progress }, 30);
    const logger = { ...logSession(b, "c13", { day: 2, loggedAt: 331 }), updatedAt: 40 };
    for (const [local, remote] of [[splitter, logger], [logger, splitter]]) {
      const r = plan(local, remote, b);
      assert.equal(r.status, "whole-piece-conflict");
      assert.equal(r.merged, local, "this device's piece, untouched");
      assert.deepEqual(r.conflicts, []);
      assert.equal(r.wholePiece.reason, "structure-and-progress");
      assert.deepEqual(r.wholePiece.structure, ["chunkSplitPoints"]);
      assert.ok(r.wholePiece.progress.includes("progress:c13") || r.wholePiece.progress.includes("progress:c11"));
      assert.ok(same(r.wholePiece.remote, canonicalPiece(remote)));
    }
  });

  test("the same, for each structure field, and for a reschedule marker on the other side", () => {
    const b = base();
    const logger = { ...logSession(b, "c13", { day: 2, loggedAt: 341 }), updatedAt: 40 };
    const marker = { asOfDay: 3, remainingChunkOrder: ["c5", "c9"], remainingConnectorIds: [], previous: null };
    const rescheduler = { ...b, rescheduleMarker: marker, updatedAt: 40 };
    ["totalMeasures", "chunkMode", "customChunkSize"].forEach((field) => {
      assert.ok(STRUCTURE_FIELDS.includes(field));
      const changed = { ...b, [field]: field === "totalMeasures" ? 34 : field === "chunkMode" ? "custom" : 8, updatedAt: 30 };
      assert.equal(plan(changed, logger, b).status, "whole-piece-conflict", `${field} vs a logged session`);
      assert.equal(plan(logger, changed, b).status, "whole-piece-conflict", `a logged session vs ${field}`);
      assert.equal(plan(changed, rescheduler, b).status, "whole-piece-conflict", `${field} vs a reschedule`);
    });
  });

  test("a structure change with nothing changed in progress or the marker on the other side merges normally", () => {
    const b = base();
    const grown = { ...b, customChunkSize: 8, chunkMode: "custom", updatedAt: 30 };
    const renamed = { ...b, name: "Renamed", updatedAt: 40 };
    const r = plan(grown, renamed, b);
    assert.equal(r.status, "merged");
    assert.equal(r.merged.customChunkSize, 8);
    assert.equal(r.merged.name, "Renamed");
  });

  test("two devices that made the identical structure change agree; it is not a whole-piece conflict", () => {
    const b = base();
    const split = splitPracticeChunk(b, "c9");
    const a = reload({ ...b, chunkSplitPoints: split.chunkSplitPoints, progress: split.progress }, 30);
    const c = reload({ ...b, chunkSplitPoints: split.chunkSplitPoints, progress: split.progress }, 40);
    // the same split, and each also logged a (different) session on a chunk the split did not touch
    const withA = { ...logSession(a, "c13", { day: 2, loggedAt: 351 }), updatedAt: 50 };
    const withC = { ...logSession(c, "c17", { day: 2, loggedAt: 352 }), updatedAt: 60 };
    const r = plan(withA, withC, b);
    assert.equal(r.status, "merged", "the grid is the same on both sides, so their progress entries mean the same chunks");
    assert.ok(r.agreed.includes("chunkSplitPoints"));
    assert.deepEqual([...sessionKeys(r.merged)].sort(), ["c1|100", "c13|351", "c17|352"].sort());
  });

  test("a piece with no recorded parts asks (it can't tell who changed what); identical pieces don't", () => {
    const b = base();
    const mine = edit(b, { name: "Mine" }, 30);
    const theirs = edit(b, { notes: "Theirs" }, 40);
    for (const noBase of [undefined, null, {}]) {
      const r = planPieceMerge({ local: mine, remote: theirs, base: noBase });
      assert.equal(r.status, "ask");
      assert.equal(r.reason, "no-base");
      assert.equal(r.merged, mine);
    }
    assert.equal(planPieceMerge({ local: b, remote: clone(b), base: undefined }).status, "identical");
  });

  test("two different pieces are never merged", () => {
    const b = base();
    const other = { ...clone(b), id: "p2" };
    const r = planPieceMerge({ local: b, remote: other, base: piecePartFingerprints(b) });
    assert.equal(r.status, "ask");
    assert.equal(r.reason, "different-ids");
    assert.equal(planPieceMerge({ local: null, remote: b, base: {} }).reason, "not-pieces");
  });

  test("when the remote copy is what the base was, this device's piece comes back untouched", () => {
    const b = base();
    const mine = { ...logSession(b, "c9", { day: 2, loggedAt: 261 }), name: "Mine", updatedAt: 30 };
    const r = planPieceMerge({ local: mine, remote: clone(b), base: piecePartFingerprints(b) });
    assert.equal(r.status, "local-only");
    assert.equal(r.merged, mine, "the same object, not a copy");
    // even when the remote's updatedAt is later (it was touched without changing anything)
    const touched = { ...clone(b), updatedAt: 999 };
    assert.equal(planPieceMerge({ local: mine, remote: touched, base: piecePartFingerprints(b) }).merged, mine);
  });

  test("when this device hasn't changed anything, the remote's changes are simply taken", () => {
    const b = base();
    const theirs = { ...logSession(b, "c9", { day: 2, loggedAt: 271 }), name: "Theirs", updatedAt: 40 };
    const r = plan(b, theirs, b);
    assert.equal(r.status, "merged");
    assert.deepEqual(r.merged.progress, canonicalPiece(theirs).progress);
    assert.equal(r.merged.name, "Theirs");
  });

  test("the inputs are never changed, and the result shares nothing with them", () => {
    const b = base();
    const mine = edit(logSession(b, "c9", { day: 2, loggedAt: 281 }), { name: "Mine" }, 30);
    const theirs = edit(logSession(b, "c13", { day: 2, loggedAt: 381 }), { name: "Theirs" }, 40);
    const snapshot = [clone(mine), clone(theirs), clone(piecePartFingerprints(b))];
    const baseParts = piecePartFingerprints(b);
    const r = planPieceMerge({ local: mine, remote: theirs, base: baseParts });
    assert.ok(same(mine, snapshot[0]) && same(theirs, snapshot[1]) && same(baseParts, snapshot[2]));
    r.merged.progress.c9.sessions.push({ nope: true });
    r.conflicts[0].local = "scribbled";
    assert.ok(same(mine, snapshot[0]), "writing to the result doesn't reach the input");
    assert.equal(planPieceMerge({ local: mine, remote: theirs, base: baseParts }).conflicts[0].local, "Mine");
  });

  test("a piece in the app's own shape (not yet through a reload) merges into the shape a reload would give", () => {
    const b = base();
    // a chunk's first record as the app builds it: no tier1Done, no troubleSpots, no ladder fields
    const rawLocal = { ...clone(b), name: "Mine", progress: { ...clone(b.progress), c9: { doneDays: [2], sessions: [{ day: 2, loggedAt: 291, loggedDate: "2026-03-02" }] } }, updatedAt: 30 };
    const rawRemote = { ...clone(b), notes: "Theirs", updatedAt: 40 };
    const r = planPieceMerge({ local: rawLocal, remote: rawRemote, base: piecePartFingerprints(b) });
    assert.equal(r.status, "merged");
    assert.ok(same(r.merged, validateAndMigratePiece(clone(r.merged))), "the merged piece is already in the form a reload gives");
    assert.equal(r.merged.progress.c9.tier1Done, false);
  });

  test("in minutes mode daysToLearn is derived, never a conflict, and keeps a reschedule's extension", () => {
    const b = makePiece({ scheduleMode: "minutes", minutesPerDay: 30, daysToLearn: 21 });
    const harder = reload({ ...b, measureDifficulty: Array(32).fill(3) }, 30); // a longer plan
    const fewerDays = reload({ ...b, practiceDaysPerWeek: 3 }, 40); // a different longer plan
    assert.ok(harder.daysToLearn !== b.daysToLearn && fewerDays.daysToLearn !== b.daysToLearn && harder.daysToLearn !== fewerDays.daysToLearn, "each side derived its own, different day count");
    const r = plan(harder, fewerDays, b);
    assert.deepEqual(r.conflicts, [], "daysToLearn is not a conflict even though both sides derived a different one");
    assert.deepEqual(r.derived, ["daysToLearn"]);
    assert.ok(same(r.merged, validateAndMigratePiece(clone(r.merged))), "the merged piece is what a reload would give");
    assert.equal(r.merged.measureDifficulty[0], 3);
    assert.equal(r.merged.practiceDaysPerWeek, 3);
    assert.ok(r.merged.daysToLearn >= Math.max(harder.daysToLearn, fewerDays.daysToLearn), "built from both changes, not just one");
    // a reschedule's extension (marker + longer plan) on the other side is kept, not snapped back
    const extended = { ...b, daysToLearn: 40, rescheduleMarker: { asOfDay: 4, remainingChunkOrder: ["c5"], remainingConnectorIds: [], previous: null }, updatedAt: 50 };
    const e = plan(reload({ ...b, name: "Renamed" }, 31), reload(extended, 50), b);
    assert.equal(e.merged.daysToLearn, 40);
    assert.ok(same(e.merged, validateAndMigratePiece(clone(e.merged))));
  });
});

/* ------------------------------------------------------------------ */
/*  Device A reschedules, device B logs a chunk A's marker still lists  */
/* ------------------------------------------------------------------ */

// The pass's required test. A reschedule marker is a snapshot of which chunks
// were untouched when it was made. Device B, not knowing, logs one of them, and
// the two are merged part by part: the merged piece lists the chunk in the marker
// AND has it done. A single device can't reach that state (it only logs a chunk on
// its own card, and a marker lists only untouched chunks), so the scheduler used to
// read a past day as "behind" because of a chunk that is done. The scheduler now
// reads a chunk done EARLIER than the day it is placed on as not owed on that day
// (classifyDayCompletion), so the merge needs no question and no change to the marker.
describe("a reschedule on one device, a session on another (Pass 117)", () => {
  // Today is day 12 of a 21-day plan: day 1 was eleven days ago.
  const startDate = addDaysISO(todayISODate(), -11);
  const fresh = () => makePiece({ startDate, targetDate: addDaysISO(startDate, 20), daysToLearn: 21, progress: {}, updatedAt: 10 });
  const doneOn = (...days) => ({
    doneDays: days,
    sessions: days.map((d, i) => ({ day: d, loggedAt: 1000 + d * 10 + i, loggedDate: addDaysISO(startDate, d - 1), cleanReps: 3, bpm: 80, outcome: "pass" })),
  });

  // What "Reschedule" saves: the marker the app itself computes.
  function rescheduled(piece) {
    const chunkSet = generateAllChunks(piece);
    const { marker } = computeRescheduleRemainder(piece, chunkSet, getEffectiveTimeline(piece, chunkSet));
    return { ...piece, rescheduleMarker: marker, updatedAt: 30 };
  }
  const reading = (piece, dayNumber, currentDay) => {
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    const chunkById = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));
    const day = timeline.days.find((d) => d.dayNumber === dayNumber);
    return {
      listed: [...day.newChunkIds, ...day.specialChunkIds],
      verdict: classifyDayCompletion(day, piece, currentDay, chunkById),
      behind: countBehindDays(piece, timeline, currentDay, chunkById),
      remaining: computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, currentDay).remainingChunkIds,
    };
  };
  // Everything the plan puts on days 12 and 13 is done on its own day, except c9.
  const work = { c1: doneOn(12), c5: doneOn(12), c13: doneOn(13), t_c1_c5: doneOn(13) };

  for (const [label, loggedDay] of [["on a day before A rescheduled", 11], ["on the day A rescheduled", 12]]) {
    test(`B logs a chunk A's marker still lists (${label}): merged cleanly, from either side, and it reads exactly as one device that logged first and rescheduled second`, () => {
      const b0 = fresh();
      const a = { ...rescheduled(b0), progress: work, updatedAt: 40 }; // A carried on after rescheduling
      assert.ok(a.rescheduleMarker.remainingChunkOrder.includes("c9") && a.rescheduleMarker.asOfDay === 12);
      const b = { ...b0, progress: { c9: doneOn(loggedDay) }, lastLoggedAt: addDaysISO(startDate, loggedDay - 1), name: "Renamed by B", updatedAt: 50 };
      // the same facts on ONE device: c9 logged first, then rescheduled, then the other work
      const loggedFirst = { ...b0, progress: { c9: doneOn(loggedDay) } };
      const cs = generateAllChunks(loggedFirst);
      const oracle = { ...loggedFirst, progress: { ...work, c9: doneOn(loggedDay) }, rescheduleMarker: computeRescheduleRemainder(loggedFirst, cs, getEffectiveTimeline(loggedFirst, cs)).marker };

      for (const [local, remote] of [[a, b], [b, a]]) {
        const r = planPieceMerge({ local, remote, base: piecePartFingerprints(b0) });
        assert.equal(r.status, "merged", "no conflict, no question");
        assert.deepEqual(r.conflicts, []);
        assert.ok(same(r.merged.rescheduleMarker, a.rescheduleMarker), "the marker is A's, untouched");
        assert.deepEqual(r.merged.progress.c9.doneDays, [loggedDay], "c9 is B's");
        assert.equal(r.merged.name, "Renamed by B");
        const merged = r.merged;
        // today (day 12 is the marker's first day, so nothing is past yet), and well after
        for (const currentDay of [14, 20]) {
          const got = reading(merged, 13, currentDay);
          const want = reading(oracle, 13, currentDay);
          assert.deepEqual(got.listed, ["c9", "c13", "t_c1_c5"], "the marker still re-places c9 on day 13 (the merge doesn't rewrite a plan)");
          assert.equal(got.verdict, "done", `day 13 is not behind because of c9 (current day ${currentDay})`);
          assert.equal(want.verdict, "done");
          assert.equal(reading(merged, 12, currentDay).verdict, "done");
          assert.equal(got.remaining.includes("c9"), false, "c9 reads as done");
        }
      }
    });
  }

  test("what the scheduler still treats as behind: a chunk the marker lists that nobody has done, and one done LATER than the day it is placed on", () => {
    const b0 = fresh();
    const a = { ...rescheduled(b0), progress: work, updatedAt: 40 };
    assert.equal(reading(a, 13, 14).verdict, "behind", "untouched c9: day 13 owes it, as before");
    const late = { ...a, progress: { ...work, c9: doneOn(14) } };
    assert.equal(reading(late, 13, 15).verdict, "behind", "done on day 14 against a day-13 placement: late is late, as before");
    const onTime = { ...a, progress: { ...work, c9: doneOn(13) } };
    assert.equal(reading(onTime, 13, 15).verdict, "done");
  });

  test("a reschedule that was already synced (the marker unchanged since the base) doesn't stop sessions on different chunks merging", () => {
    const b0 = rescheduled(fresh());
    const mine = { ...b0, progress: { c1: doneOn(12) }, updatedAt: 50 };
    const theirs = { ...b0, progress: { c5: doneOn(12) }, updatedAt: 60 };
    const r = planPieceMerge({ local: mine, remote: theirs, base: piecePartFingerprints(b0) });
    assert.equal(r.status, "merged");
    assert.deepEqual(Object.keys(r.merged.progress).sort(), ["c1", "c5"]);
  });

  test("a marker changed on both sides to different values is an ordinary conflict on the marker", () => {
    const b0 = fresh();
    const a = rescheduled(b0);
    const c = { ...rescheduled(b0), rescheduleMarker: { ...a.rescheduleMarker, asOfDay: 9 }, updatedAt: 40 };
    const r = planPieceMerge({ local: a, remote: c, base: piecePartFingerprints(b0) });
    assert.deepEqual(r.conflicts.map((x) => [x.part, x.kind]), [["rescheduleMarker", "field"]]);
  });
});

/* ------------------------------------------------------------------ */
/*  The simulation                                                     */
/* ------------------------------------------------------------------ */

// Two simulated devices start from one piece, edit it offline in random ways,
// and sync in random orders, merging by part. Every merge is checked against
// seven invariants:
//   1. no session logged on either device since the base is missing: it is in
//      the merged piece or, for a conflicted part, in the conflict's values
//   2. a part changed on one side only ends with that side's value
//   3. a part changed on both to different values is reported as a conflict,
//      never silently chosen (and the merged piece keeps this device's value);
//      except piece order and date added (7)
//   4. the merged piece is unchanged by validateAndMigratePiece
//   5. merging the same inputs again gives the same result
//   6. merging when the remote equals the base returns this device's piece
//      untouched
//   7. (Pass 122b) piece order, the note a reorder leaves and date added are
//      never a conflict: changed on both to different values, the side with the
//      more recent reorder note wins the order (the other copy's value wins
//      where the notes cannot tell, and the date) and the result says so
//      (softSettled)
// "Changed" below is judged from the real pieces (a deep comparison of values),
// not from the engine's fingerprints, so the checks don't depend on the code
// they check.
describe("two simulated devices (Pass 117)", () => {
  const RUNS = 300;
  const ROUNDS = 6;

  function startingPiece(rng) {
    const totalMeasures = pickOf(rng, [16, 24, 32, 40, 48]);
    const sectionCount = intIn(rng, 1, 3);
    const cut = [0, ...Array.from({ length: sectionCount - 1 }, () => intIn(rng, 2, totalMeasures - 2)).sort((x, y) => x - y), totalMeasures];
    const sections = [];
    for (let i = 0; i < cut.length - 1; i++) {
      const start = i === 0 ? 1 : cut[i] + 1;
      const end = cut[i + 1];
      if (start <= end) sections.push({ id: `s${i + 1}`, name: "", start, end });
    }
    const minutes = rng() < 0.3;
    return makePiece({
      totalMeasures,
      measureDifficulty: Array.from({ length: totalMeasures }, () => intIn(rng, 1, 3)),
      sections,
      scheduleMode: minutes ? "minutes" : "days",
      daysToLearn: pickOf(rng, [21, 28]),
      troubleSpotsEnabled: rng() < 0.5,
      targetBPM: rng() < 0.5 ? 120 : null,
      updatedAt: 1,
    });
  }

  // Every kind of edit the spec names, each shaped like the app's own handler.
  // How often each kind of edit is made. EVERY_KIND gives each of the spec's
  // edits a real share (so every rule is exercised often); EVERYDAY is mostly
  // practice sessions, which is closer to how the app is actually used.
  // Pass 122b added "reorder" (the piece's place in the switcher) and "dated" (its date added).
  const EVERY_KIND = [["log", 30], ["undo", 8], ["schedule", 8], ["difficulty", 8], ["status", 5], ["describe", 6], ["split", 8], ["reschedule", 8], ["spot", 8], ["spotTime", 4], ["reorder", 8], ["dated", 3]];
  const EVERYDAY = [["log", 80], ["undo", 3], ["schedule", 3], ["difficulty", 3], ["status", 1], ["describe", 3], ["split", 1], ["reschedule", 1], ["spot", 3], ["spotTime", 2], ["reorder", 3], ["dated", 1]];

  function edit(piece, rng, ctx) {
    const kinds = ctx.weights;
    let roll = rng() * kinds.reduce((n, [, w]) => n + w, 0);
    let kind = "log";
    for (const [k, w] of kinds) {
      if ((roll -= w) < 0) {
        kind = k;
        break;
      }
    }
    const chunkSet = generateAllChunks(piece);
    const practice = chunkSet.practiceChunks;
    const loggable = rng() < 0.8 ? practice : [...chunkSet.transitions, ...chunkSet.combos, ...practice];
    const withSessions = Object.keys(piece.progress).filter((id) => (piece.progress[id].sessions || []).length > 0 && id !== "__cold_start__");
    const stamp = ctx.next();
    let next = piece;
    if (kind === "undo" && withSessions.length) {
      const id = pickOf(rng, withSessions);
      const sessions = piece.progress[id].sessions;
      next = unlogSession(piece, id, sessions[sessions.length - 1].day);
    } else if (kind === "schedule") {
      if (piece.scheduleMode === "minutes") next = { ...piece, minutesPerDay: pickOf(rng, [20, 30, 45, 60]), practiceDaysPerWeek: pickOf(rng, [5, 6, 7]) };
      else {
        const daysToLearn = pickOf(rng, [14, 21, 28, 35]);
        next = { ...piece, daysToLearn, targetDate: addDaysISO(piece.startDate, daysToLearn - 1), practiceDaysPerWeek: pickOf(rng, [5, 6, 7]) };
      }
    } else if (kind === "difficulty") {
      const measureDifficulty = [...piece.measureDifficulty];
      for (let i = 0; i < intIn(rng, 1, 4); i++) measureDifficulty[intIn(rng, 0, measureDifficulty.length - 1)] = intIn(rng, 1, 3);
      next = { ...piece, measureDifficulty };
    } else if (kind === "status") {
      next = { ...piece, status: pickOf(rng, ["active", "paused", "archived"]) };
    } else if (kind === "describe") {
      next = rng() < 0.5 ? { ...piece, notes: `notes ${stamp}` } : { ...piece, name: `Ballade ${stamp}` };
    } else if (kind === "reorder") {
      // like moveGroupTo (App.jsx, planSwitcherMove): a new rank in the switcher and a dated note of
      // the whole arrangement; one time in four without the note, as a device on the previous
      // version would leave it
      const sortOrder = intIn(rng, 0, 9);
      const ids = ["p1", "p2", "p3"].sort(() => rng() - 0.5);
      next = rng() < 0.75 ? { ...piece, sortOrder, switcherOrder: { at: stamp, ids } } : { ...piece, sortOrder };
    } else if (kind === "dated") {
      next = { ...piece, createdAt: 1000 + intIn(rng, 1, 9) };
    } else if (kind === "split") {
      const options = practice.filter(canSplitChunk);
      if (options.length) {
        const result = splitPracticeChunk(piece, pickOf(rng, options).id);
        if (result) {
          next = {
            ...piece,
            chunkSplitPoints: result.chunkSplitPoints,
            progress: result.progress,
            rescheduleMarker: insertSplitHalfIntoMarkerChain(piece.rescheduleMarker, result.firstHalfId, result.secondHalfId),
          };
        }
      }
    } else if (kind === "reschedule") {
      const remaining = practice.filter((c) => !((piece.progress[c.id] || {}).doneDays || []).length).map((c) => c.id);
      const remainingConnectorIds = computeRemainingConnectorIds(piece, chunkSet);
      if (remaining.length || remainingConnectorIds.length) {
        const marker = { asOfDay: intIn(rng, 1, piece.daysToLearn), remainingChunkOrder: remaining, remainingConnectorIds, previous: piece.rescheduleMarker || null };
        next = { ...piece, rescheduleMarker: marker };
        if (rng() < 0.3) {
          const daysToLearn = piece.daysToLearn + intIn(rng, 1, 10);
          next = piece.scheduleMode === "minutes" ? { ...next, daysToLearn } : { ...next, daysToLearn, targetDate: addDaysISO(piece.startDate, daysToLearn - 1) };
        }
      }
    } else if (kind === "spot") {
      const chunk = pickOf(rng, practice);
      const startMeasure = intIn(rng, chunk.start, chunk.end);
      const spot = {
        id: `fs_${stamp}`, name: `spot ${stamp}`, position: `${startMeasure}`, startMeasure, endMeasure: startMeasure, length: null,
        fromSetup: false, resolved: false, resolvedBpm: null, resolvedAt: null, sessions: [],
      };
      const prev = piece.progress[chunk.id] || { doneDays: [] };
      next = { ...piece, troubleSpotsEnabled: true, progress: { ...piece.progress, [chunk.id]: { ...prev, troubleSpots: [...(prev.troubleSpots || []), spot] } } };
    } else if (kind === "spotTime") {
      const holders = Object.keys(piece.progress).filter((id) => (piece.progress[id].troubleSpots || []).length > 0);
      if (holders.length) {
        const id = pickOf(rng, holders);
        const spots = piece.progress[id].troubleSpots;
        const target = pickOf(rng, spots);
        const day = intIn(rng, 1, piece.daysToLearn);
        const nextSpots = spots.map((s) => (s.id === target.id ? { ...s, sessions: [...(s.sessions || []), { loggedAt: stamp, loggedDate: addDaysISO(piece.startDate, day - 1), durationSeconds: 300 }] } : s));
        next = { ...piece, progress: { ...piece.progress, [id]: { ...piece.progress[id], troubleSpots: nextSpots } } };
      }
    }
    if (next === piece) {
      // "log" (and anything that had nothing to act on)
      const target = pickOf(rng, loggable);
      const day = intIn(rng, 1, piece.daysToLearn);
      next = logSession(piece, target.id, {
        day,
        loggedAt: stamp,
        bpm: intIn(rng, 50, 110),
        cleanReps: intIn(rng, 1, 5),
        outcome: pickOf(rng, ["pass", "pass", "soft-miss", "fail"]),
      });
    }
    return reload(next, stamp);
  }

  function runOne(seed, tally, weights) {
    const rng = seeded(seed);
    let clock = 1000;
    const ctx = { next: () => ++clock, weights };
    let start = startingPiece(rng);
    for (let i = 0, n = intIn(rng, 0, 6); i < n; i++) start = edit(start, rng, ctx);
    const account = { piece: start };
    const devices = ["A", "B"].map((name) => ({ name, piece: start, basePiece: start, base: piecePartFingerprints(start) }));

    // One sync: merge the account's copy into this device, check the merge, upload.
    const sync = (d, where) => {
      const local = d.piece;
      const remote = account.piece;
      const input = { local: clone(local), remote: clone(remote), base: clone(d.base) };
      const r = planPieceMerge({ local, remote, base: d.base });
      tally.merges += 1;
      tally[r.status] = (tally[r.status] || 0) + 1;
      tally.partConflicts += r.conflicts.length;
      tally.chunkConflicts += r.conflicts.filter((c) => c.kind === "progress").length;

      // the inputs are untouched
      assert.ok(same(local, input.local) && same(remote, input.remote) && same(d.base, input.base), `inputs unchanged (${where})`);

      const L = canonicalPiece(clone(local));
      const R = canonicalPiece(clone(remote));
      const B = canonicalPiece(clone(d.basePiece));
      const lt = partsOfTruth(L);
      const rt = partsOfTruth(R);
      const bt = partsOfTruth(B);
      const keys = new Set([...Object.keys(lt), ...Object.keys(rt), ...Object.keys(bt)]);
      const changed = (side, k) => !same(side[k], bt[k]);

      // the chunk-grid rule, judged independently of the engine
      const STRUCT = ["totalMeasures", "chunkMode", "customChunkSize", "chunkSplitPoints"];
      const structDiffers = STRUCT.filter((f) => !same(lt[f], rt[f]));
      const progDiffers = [...keys].filter((k) => (k.startsWith("progress:") || k === "rescheduleMarker") && !same(lt[k], rt[k]));
      const identical = same(lt, rt);
      const remoteIsBase = same(rt, bt);
      const wholeExpected =
        !identical &&
        !remoteIsBase &&
        ((structDiffers.some((f) => changed(lt, f)) && progDiffers.some((k) => changed(rt, k))) ||
          (structDiffers.some((f) => changed(rt, f)) && progDiffers.some((k) => changed(lt, k))));
      if (identical) assert.equal(r.status, "identical", `identical (${where})`);
      else if (remoteIsBase) assert.equal(r.status, "local-only", `remote equals base (${where})`);
      else if (wholeExpected) assert.equal(r.status, "whole-piece-conflict", `structure rule (${where})`);
      assert.notEqual(r.status, "ask", `there is always a base here (${where})`);

      // (6) merging when the remote equals the base returns this device's piece untouched
      const probe = planPieceMerge({ local, remote: clone(d.basePiece), base: d.base });
      assert.ok(probe.status === "local-only" || probe.status === "identical", `remote = base is local-only or identical (${where})`);
      assert.equal(probe.merged, local, `(6) untouched (${where})`);

      // (5) the same inputs again give the same result
      const again = planPieceMerge({ local: input.local, remote: input.remote, base: input.base });
      assert.ok(same(again, r), `(5) deterministic (${where})`);

      const merged = r.merged;
      if (r.status === "merged" || r.status === "conflicts") {
        // (4) nothing a reload would change
        assert.ok(same(merged, validateAndMigratePiece(clone(merged))), `(4) unchanged by validateAndMigratePiece (${where})`);
        assert.equal(merged.updatedAt, Math.max(local.updatedAt, remote.updatedAt), `updatedAt is the later of the two (${where})`);
        const mt = partsOfTruth(merged);
        const derivedKeys = new Set(r.derived);
        const partConflicts = r.conflicts;
        const conflictKeys = new Set(partConflicts.map((c) => c.part));
        keys.forEach((k) => {
          if (derivedKeys.has(k)) return;
          // In a minutes-per-day schedule `daysToLearn` is worked out from the other schedule parts
          // on every load, so after a merge it can differ from both sides' copy even when neither
          // changed it (one side changed minutes per day, the other split a chunk). The engine
          // reconciles the merged schedule so that a reload gives the same piece (invariant 4);
          // this check would otherwise call that a lost part. Found by running wider than seed 300
          // (seed 311 on the code before Pass 122b; the engine is right, the check was too strict).
          if (k === "daysToLearn" && mt.scheduleMode === "minutes") return;
          const cl = changed(lt, k);
          const cr = changed(rt, k);
          if (!cl && !cr) assert.ok(same(mt[k], lt[k]), `unchanged part ${k} (${where})`);
          else if (cl && !cr) assert.ok(same(mt[k], lt[k]), `(2) ${k}: only this device changed it (${where})`);
          else if (!cl && cr) assert.ok(same(mt[k], rt[k]), `(2) ${k}: only the other side changed it (${where})`);
          else if (same(lt[k], rt[k])) {
            assert.ok(same(mt[k], lt[k]), `agreed ${k} (${where})`);
            assert.equal(conflictKeys.has(k), false, `${k} is agreement, not a conflict (${where})`);
          } else if (SOFT_PARTS.includes(k)) {
            // (7) Pass 122b: piece order, its note and date added are never a conflict. Changed on
            // both to different values, the engine settles them itself: the side holding the more
            // recent reorder note for the note and the rank (judged here from the notes' own
            // moments, not from the engine), the other copy's value otherwise and for the date.
            const atOf = (t) => (t.switcherOrder && Number.isFinite(t.switcherOrder.at) ? t.switcherOrder.at : null);
            const la = atOf(lt);
            const ra = atOf(rt);
            const orderSide = la !== null && (ra === null || la > ra) ? "local" : "remote";
            const side = k === "createdAt" ? "remote" : orderSide;
            assert.equal(conflictKeys.has(k), false, `(7) ${k}: never a conflict (${where})`);
            assert.ok(same(mt[k], (side === "local" ? lt : rt)[k]), `(7) ${k}: the ${side} copy's value wins (${where})`);
            assert.ok(r.softSettled.some((s) => s.part === k && s.side === side), `(7) ${k}: said so in softSettled (${where})`);
            tally.softSettled = (tally.softSettled || 0) + 1;
            if (k !== "createdAt" && side === "local") tally.orderByNote = (tally.orderByNote || 0) + 1;
          } else {
            assert.ok(conflictKeys.has(k), `(3) ${k}: changed on both to different values is reported (${where})`);
            assert.ok(same(mt[k], lt[k]), `(3) ${k}: this device's value is kept (${where})`);
            const c = partConflicts.find((x) => x.part === k);
            assert.ok(same(c.local, lt[k]) && same(c.remote, rt[k]), `(3) ${k}: the conflict lists both values (${where})`);
          }
        });
        // nothing is in softSettled that was not a soft part changed on both sides
        r.softSettled.forEach((s) => assert.ok(SOFT_PARTS.includes(s.part) && changed(lt, s.part) && changed(rt, s.part) && !same(lt[s.part], rt[s.part]), `(7) no false softSettled on ${s.part} (${where})`));
        conflictKeys.forEach((k) => assert.ok(changed(lt, k) && changed(rt, k) && !same(lt[k], rt[k]), `no false conflict on ${k} (${where})`));
        // (1) every session either side logged since the base is in the merged piece or in a conflict
        const have = sessionKeys(merged);
        r.conflicts.forEach((c) => {
          sessionKeysInPart(c.part, c.local).forEach((x) => have.add(x));
          sessionKeysInPart(c.part, c.remote).forEach((x) => have.add(x));
        });
        const inBase = sessionKeys(B);
        [...sessionKeys(L), ...sessionKeys(R)].filter((x) => !inBase.has(x)).forEach((x) => assert.ok(have.has(x), `(1) session ${x} is not missing (${where})`));
      } else if (r.status === "whole-piece-conflict") {
        assert.equal(merged, local, `whole-piece conflict keeps this device's piece (${where})`);
        assert.ok(same(r.wholePiece.remote, R), `the whole-piece conflict carries the remote copy (${where})`);
        const have = new Set([...sessionKeys(local), ...sessionKeys(r.wholePiece.remote)]);
        const inBase = sessionKeys(B);
        [...sessionKeys(L), ...sessionKeys(R)].filter((x) => !inBase.has(x)).forEach((x) => assert.ok(have.has(x), `(1) session ${x} is not missing (${where})`));
      } else {
        assert.equal(merged, local, `${r.status} returns this device's piece untouched (${where})`);
      }

      // what happens next, standing in for the person's answer to a question
      if (r.status === "whole-piece-conflict" && rng() < 0.5) d.piece = remote;
      else d.piece = merged;
      account.piece = d.piece;
      d.basePiece = d.piece;
      d.base = piecePartFingerprints(d.piece);
    };

    for (let round = 0; round < ROUNDS; round++) {
      // offline: each device works on its own copy
      devices.forEach((d) => {
        if (rng() < 0.85) for (let i = 0, n = intIn(rng, 1, 4); i < n; i++) d.piece = edit(d.piece, rng, ctx);
      });
      // then they sync, in a random order; a device may skip a round (a longer gap) or sync twice
      (rng() < 0.5 ? devices : [...devices].reverse()).forEach((d) => {
        if (rng() < 0.85) sync(d, `seed ${seed}, round ${round}, device ${d.name}`);
        if (rng() < 0.15) sync(d, `seed ${seed}, round ${round}, device ${d.name} again`);
      });
    }
  }

  function simulate(label, weights, runs) {
    const tally = { merges: 0, partConflicts: 0, chunkConflicts: 0 };
    const t0 = Date.now();
    for (let seed = 1; seed <= runs; seed++) runOne(seed, tally, weights);
    const withConflict = (tally.conflicts || 0) + (tally["whole-piece-conflict"] || 0);
    const real = (tally.merged || 0) + withConflict; // syncs that had something of the other side's to put together
    console.log(
      `pieceMerge simulation (${label}): ${runs} runs (seeds 1 to ${runs}), ${tally.merges} syncs ` +
        `[nothing to bring in: local-only ${tally["local-only"] || 0}, identical ${tally.identical || 0}; ` +
        `merged cleanly ${tally.merged || 0}; with part conflicts ${tally.conflicts || 0} (holding ${tally.partConflicts} single-part conflicts, ${tally.chunkConflicts} of them one chunk logged on both sides); ` +
        `whole-piece conflicts ${tally["whole-piece-conflict"] || 0}]. ` +
        `Conflict rate: ${(tally.merges ? (withConflict / tally.merges) * 100 : 0).toFixed(1)}% of all syncs, ${(real ? (withConflict / real) * 100 : 0).toFixed(1)}% of the ${real} syncs that had changes from both sides to put together. ${Date.now() - t0} ms`
    );
    return tally;
  }

  test(`${RUNS} seeded runs of ${ROUNDS} rounds, every kind of edit: the seven invariants hold after every merge`, () => {
    const tally = simulate("every kind of edit", EVERY_KIND, RUNS);
    assert.ok(tally.merges > RUNS, "the simulation really merged");
    assert.ok((tally.merged || 0) > 0 && (tally.conflicts || 0) > 0 && (tally["whole-piece-conflict"] || 0) > 0, "it exercised clean merges, part conflicts and whole-piece conflicts");
    assert.ok(tally.partConflicts > 0 && tally.chunkConflicts > 0, "and single-part conflicts");
    assert.ok((tally.softSettled || 0) > 0, "and piece order or date added changed on both sides (settled by the engine, never a conflict)");
    assert.ok((tally.orderByNote || 0) > 0, "and a reorder note on this device beat the other copy's order (the more recent reorder wins)");
  });

  test("100 more runs with an everyday mix (mostly practice sessions): the same seven invariants", () => {
    const tally = simulate("everyday mix", EVERYDAY, 100);
    assert.ok((tally.merged || 0) > 0);
  });
});

/* ------------------------------------------------------------------ */
/*  Settling a conflict: the person's answer, applied (Pass 121)       */
/* ------------------------------------------------------------------ */

describe("both devices' sessions for one chunk (Pass 121)", () => {
  const sess = (day, loggedAt, over = {}) => ({ day, loggedAt, loggedDate: `2026-03-0${day}`, cleanReps: 3, bpm: 80, outcome: "pass", durationSeconds: 120, ...over });
  const entryOf = (sessions, over = {}) => ({ doneDays: [...new Set(sessions.map((s) => s.day))], sessions, ...over });
  const LADDER = ["stage", "consecutivePasses", "consecutiveStabilizingFails", "practiceBPM", "nextDueDate", "tier1Done", "needsRelearning", "currentBPM", "stabilizingEntryBPM", "settlingEntryBPM", "holdingEntryBPM", "tempoRatchetK", "holdingReviewCount"];
  const ladderOf = (e) => Object.fromEntries(LADDER.map((k) => [k, e[k]]));
  const early = { stage: "stabilizing", consecutivePasses: 1, consecutiveStabilizingFails: 0, practiceBPM: 80, nextDueDate: "2026-03-05", tier1Done: true, needsRelearning: false, currentBPM: 80, stabilizingEntryBPM: 70, settlingEntryBPM: null, holdingEntryBPM: null, tempoRatchetK: 0.3, holdingReviewCount: null };
  const advanced = { stage: "settling", consecutivePasses: 4, consecutiveStabilizingFails: 0, practiceBPM: 104, nextDueDate: "2026-03-14", tier1Done: true, needsRelearning: false, currentBPM: 104, stabilizingEntryBPM: 70, settlingEntryBPM: 100, holdingEntryBPM: null, tempoRatchetK: 0.1, holdingReviewCount: null };

  test("every session from both sides is kept, a session both hold once, the days added together, in the order they were logged", () => {
    const mine = entryOf([sess(1, 100), sess(2, 300, { bpm: 90 })], early);
    // the shared first session arrives from the database with its keys in another order
    const shared = { outcome: "pass", durationSeconds: 120, bpm: 80, cleanReps: 3, loggedDate: "2026-03-01", loggedAt: 100, day: 1 };
    const theirs = entryOf([shared, sess(3, 200, { bpm: 70 })], advanced);
    const out = unionProgressEntries(mine, theirs);
    assert.deepEqual(out.sessions.map((s) => s.loggedAt), [100, 200, 300], "three sessions, the shared one once, most recent last");
    assert.deepEqual(out.doneDays, [1, 2, 3]);
  });

  test("the ladder state comes from the side whose latest session is LATER, whichever side that is", () => {
    const mine = entryOf([sess(1, 100)], early);
    const theirs = entryOf([sess(2, 500)], advanced);
    assert.deepEqual(ladderOf(unionProgressEntries(mine, theirs)), ladderOf(advanced), "the other device practiced last");
    assert.deepEqual(ladderOf(unionProgressEntries(theirs, mine)), ladderOf(advanced), "and it is about time, not about which side is 'this device'");
    const laterHere = entryOf([sess(1, 900)], early);
    assert.deepEqual(ladderOf(unionProgressEntries(laterHere, theirs)), ladderOf(early), "this device practiced last");
  });

  test("a tie goes to this device, and so does a record that says when on neither side", () => {
    const tieMine = entryOf([sess(2, 400, { bpm: 70 })], early);
    const tieTheirs = entryOf([sess(3, 400, { bpm: 95 })], advanced);
    assert.deepEqual(ladderOf(unionProgressEntries(tieMine, tieTheirs)), ladderOf(early), "same moment: this device's");
    assert.deepEqual(ladderOf(unionProgressEntries(tieTheirs, tieMine)), ladderOf(advanced), "...and from the other device's side, theirs is 'this device'");
    const undatedMine = entryOf([{ day: 1, bpm: 80, outcome: "pass" }], early);
    const undatedTheirs = entryOf([{ day: 2, bpm: 99, outcome: "pass" }], advanced);
    const out = unionProgressEntries(undatedMine, undatedTheirs);
    assert.deepEqual(ladderOf(out), ladderOf(early));
    assert.deepEqual(out.sessions.map((s) => s.day), [1, 2], "nobody guesses an order for sessions that don't say when");
  });

  test("a side with no judged session at all has no ladder to offer: the other side's counts", () => {
    const onlySkipped = entryOf([{ day: 1, loggedAt: 900, loggedDate: "2026-03-01", skipped: true, durationSeconds: 60 }], early);
    const judged = entryOf([sess(2, 50)], advanced);
    assert.deepEqual(ladderOf(unionProgressEntries(onlySkipped, judged)), ladderOf(advanced));
    assert.deepEqual(ladderOf(unionProgressEntries(judged, onlySkipped)), ladderOf(advanced), "whichever side is 'this device'");
  });

  test("a skipped or unconfirmed attempt never makes a side's ladder state the later one", () => {
    const mine = entryOf([sess(1, 100)], early);
    const theirs = entryOf([sess(2, 50), { day: 2, loggedAt: 900, loggedDate: "2026-03-02", skipped: true, durationSeconds: 60 }, sess(2, 950, { provisional: true, outcome: "fail" })], advanced);
    assert.deepEqual(ladderOf(unionProgressEntries(mine, theirs)), ladderOf(early), "their only judged session (50) is earlier than mine (100)");
    assert.equal(unionProgressEntries(mine, theirs).sessions.length, 4, "but the skipped and unconfirmed sessions are still sessions, and are kept");
  });

  test("one side with no record for the chunk: the other's, as a copy; neither: nothing", () => {
    const only = entryOf([sess(1, 100)], early);
    assert.equal(unionProgressEntries(undefined, undefined), undefined);
    const a = unionProgressEntries(only, undefined);
    const b = unionProgressEntries(undefined, only);
    assert.deepEqual(a, clone(only));
    assert.deepEqual(b, clone(only));
    assert.notEqual(a, only, "a copy: nothing a caller does to it reaches the inputs");
    a.sessions.push({ day: 9 });
    assert.equal(only.sessions.length, 1);
  });

  test("focus spots keep the practice time logged on either side, and a spot only one side has", () => {
    const spot = (id, sessions, over = {}) => ({ id, name: id, position: "9", sessions, resolved: false, ...over });
    const mine = entryOf([sess(1, 100)], { ...early, troubleSpots: [spot("a", [{ minutes: 5, loggedAt: 110 }])] });
    const theirs = entryOf([sess(2, 200)], { ...advanced, troubleSpots: [spot("a", [{ minutes: 5, loggedAt: 110 }, { minutes: 7, loggedAt: 210 }], { resolved: true }), spot("b", [{ minutes: 3, loggedAt: 220 }])] });
    const out = unionProgressEntries(mine, theirs);
    const a = out.troubleSpots.find((x) => x.id === "a");
    assert.deepEqual(a.sessions.map((x) => x.loggedAt), [110, 210], "both sides' minutes, the shared one once");
    assert.equal(a.resolved, true, "a spot's own fields follow the side that practiced last");
    assert.ok(out.troubleSpots.some((x) => x.id === "b"), "a spot only the other side has is not lost");
    // ...also when it is THIS device that practiced last and holds the smaller list
    const leadMine = entryOf([sess(1, 900)], { ...early, troubleSpots: [spot("a", [{ minutes: 5, loggedAt: 110 }], { resolved: false })] });
    const out2 = unionProgressEntries(leadMine, theirs);
    const a2 = out2.troubleSpots.find((x) => x.id === "a");
    assert.deepEqual(a2.sessions.map((x) => x.loggedAt), [110, 210]);
    assert.equal(a2.resolved, false, "this device practiced last, so its spot's own fields count");
    assert.ok(out2.troubleSpots.some((x) => x.id === "b"));
    // a record with no spots on either side stays as it is (the loader's null)
    assert.equal(unionProgressEntries(entryOf([sess(1, 1)], { troubleSpots: null }), entryOf([sess(2, 2)], { troubleSpots: null })).troubleSpots, null);
  });

  test("a stored value that is not a list (damaged or hand-edited data) reads as having none, and never makes the union throw", () => {
    const real = entryOf([sess(1, 100)], early);
    // a side whose sessions or days are not lists keeps the other side's, and invents nothing
    const damaged = { sessions: "not a list", doneDays: 3, stage: "stabilizing" };
    const out = unionProgressEntries(real, damaged);
    assert.deepEqual(out.sessions.map((s) => s.loggedAt), [100]);
    assert.deepEqual(out.doneDays, [1]);
    const flipped = unionProgressEntries(damaged, real);
    assert.deepEqual(flipped.sessions.map((s) => s.loggedAt), [100]);
    // both sides damaged: an empty record, not an exception
    const both = unionProgressEntries({ sessions: "x", doneDays: 3 }, { sessions: 7, doneDays: "y" });
    assert.deepEqual([both.sessions, both.doneDays], [[], []]);
    // a focus spot whose own sessions are not a list
    const spot = (sessions) => ({ id: "a", name: "a", position: "9", sessions, resolved: false });
    const spots = unionProgressEntries(entryOf([sess(1, 100)], { troubleSpots: [spot("x")] }), entryOf([sess(2, 200)], { troubleSpots: [spot(5)] })).troubleSpots;
    assert.deepEqual(spots.map((x) => x.sessions), [[]]);
    // and a piece that is not an object at all is still "no record"
    assert.equal(unionProgressEntries("junk", 5), undefined);
  });

  test("only a chunk's practice record can be answered 'both'", () => {
    assert.equal(isValidChoice("progress", "both"), true);
    assert.equal(isValidChoice("field", "both"), false);
    assert.equal(isValidChoice("whole-piece", "both"), false);
    ["local", "remote"].forEach((c) => ["progress", "field", "whole-piece"].forEach((k) => assert.equal(isValidChoice(k, c), true)));
    ["", "mine", null, undefined, 1, "BOTH"].forEach((c) => assert.equal(isValidChoice("progress", c), false));
  });
});

describe("settling each conflict the way the person said (Pass 121)", () => {
  const base0 = () =>
    makePiece({
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, loggedAt: 100, loggedDate: "2026-03-01", cleanReps: 3, bpm: 80, outcome: "pass" }] },
        c5: { doneDays: [], sessions: [] },
      },
      updatedAt: 10,
    });
  const edit = (piece, patch, stamp) => ({ ...piece, ...patch, updatedAt: stamp });
  const fromBase = (b) => piecePartFingerprints(b);
  // A real conflict: the same chunk (c5) practiced on both sides, and the name changed on both.
  const conflicted = () => {
    const b = base0();
    const mine = edit(logSession(b, "c5", { day: 2, loggedAt: 211, bpm: 70 }), { name: "Mine" }, 30);
    const theirs = edit(logSession(b, "c5", { day: 3, loggedAt: 311, bpm: 90 }), { name: "Theirs" }, 40);
    return { b, mine, theirs, base: fromBase(b) };
  };
  const settle = (local, remote, base, choices) => planPieceMerge({ local, remote, base, choices });

  test("no answers at all: exactly what the engine always gave (conflicts listed, this device's values kept)", () => {
    const { mine, theirs, base } = conflicted();
    const without = planPieceMerge({ local: mine, remote: theirs, base });
    const withEmpty = settle(mine, theirs, base, {});
    assert.equal(without.status, "conflicts");
    assert.deepEqual(without.conflicts.map((c) => c.part).sort(), ["name", "progress:c5"]);
    assert.deepEqual(without.settled, []);
    assert.deepEqual(without.unusedChoices, []);
    assert.deepEqual(withEmpty, without, "an empty set of answers is no answers");
    assert.equal(without.merged.name, "Mine");
  });

  test("a chunk, 'both devices' sessions': every session from both, the days added, the ladder from the later session, nothing left to ask", () => {
    const { mine, theirs, base } = conflicted();
    const r = settle(mine, theirs, base, { "progress:c5": "both", name: "local" });
    assert.equal(r.status, "merged");
    assert.deepEqual(r.conflicts, []);
    assert.deepEqual(r.settled.map((x) => [x.part, x.kind, x.choice]).sort(), [["name", "field", "local"], ["progress:c5", "progress", "both"]]);
    assert.deepEqual([...sessionKeys(r.merged)].sort(), ["c1|100", "c5|211", "c5|311"], "this device's session and the other device's, plus the chunk nobody touched");
    const c5 = r.merged.progress.c5;
    assert.deepEqual(c5.doneDays, [2, 3]);
    assert.equal(c5.currentBPM, 90, "the other device practiced last (311 is after 211), so its ladder state counts");
    assert.equal(c5.practiceBPM, theirs.progress.c5.practiceBPM);
    assert.equal(c5.nextDueDate, theirs.progress.c5.nextDueDate);
    assert.equal(r.merged.lastLoggedAt, "2026-03-03", "the newest date of any session the merged piece holds");
    // and the same from the other device's side: the ladder follows the clock, not the role
    const back = settle(theirs, mine, base, { "progress:c5": "both", name: "local" });
    assert.deepEqual([...sessionKeys(back.merged)].sort(), ["c1|100", "c5|211", "c5|311"]);
    assert.equal(back.merged.progress.c5.currentBPM, 90);
  });

  test("a chunk, 'this device's' / 'the other device's': exactly that side's record, nothing of the other's", () => {
    const { mine, theirs, base } = conflicted();
    const local = settle(mine, theirs, base, { "progress:c5": "local", name: "remote" });
    assert.equal(local.status, "merged");
    assert.deepEqual(local.merged.progress.c5, canonicalPiece(mine).progress.c5);
    assert.deepEqual([...sessionKeys(local.merged)].sort(), ["c1|100", "c5|211"], "their session is not there");
    assert.equal(local.merged.name, "Theirs");
    const remote = settle(mine, theirs, base, { "progress:c5": "remote", name: "local" });
    assert.deepEqual(remote.merged.progress.c5, canonicalPiece(theirs).progress.c5);
    assert.deepEqual([...sessionKeys(remote.merged)].sort(), ["c1|100", "c5|311"], "mine is not there");
    assert.equal(remote.merged.name, "Mine");
  });

  test("an ordinary field: this device's or the other device's, 'both' is not an answer for it", () => {
    const b = base0();
    const mine = edit(b, { targetDate: "2026-04-01" }, 30);
    const theirs = edit(b, { targetDate: "2026-04-15" }, 40);
    const base = fromBase(b);
    assert.equal(settle(mine, theirs, base, { targetDate: "local" }).merged.targetDate, "2026-04-01");
    assert.equal(settle(mine, theirs, base, { targetDate: "remote" }).merged.targetDate, "2026-04-15");
    const both = settle(mine, theirs, base, { targetDate: "both" });
    assert.equal(both.status, "conflicts", "'both' means nothing for a date, so it is not an answer");
    assert.deepEqual(both.conflicts.map((c) => c.part), ["targetDate"]);
    assert.equal(both.merged.targetDate, "2026-04-01", "and this device's value is kept, as ever");
    assert.deepEqual(both.settled, []);
  });

  test("some answered, some not: the answered ones are applied, the rest stay conflicts with this device's value", () => {
    const { mine, theirs, base } = conflicted();
    const r = settle(mine, theirs, base, { "progress:c5": "remote" });
    assert.equal(r.status, "conflicts");
    assert.deepEqual(r.conflicts.map((c) => c.part), ["name"], "exactly the one still to ask");
    assert.equal(r.merged.name, "Mine");
    assert.deepEqual(r.merged.progress.c5, canonicalPiece(theirs).progress.c5, "the answered one is applied");
    assert.deepEqual(r.settled.map((x) => x.part), ["progress:c5"]);
  });

  test("an answer for a part that is not in conflict is ignored and said so, and changes nothing", () => {
    const { mine, theirs, base } = conflicted();
    const plain = settle(mine, theirs, base, { "progress:c5": "both", name: "local" });
    const withStale = settle(mine, theirs, base, { "progress:c5": "both", name: "local", notes: "remote", "progress:c99": "both", daysToLearn: "remote" });
    assert.deepEqual(withStale.unusedChoices.sort(), ["daysToLearn", "notes", "progress:c99"]);
    assert.deepEqual({ ...withStale, unusedChoices: [] }, plain, "the same piece and the same record of what was settled");
  });

  test("an answer that is not 'local', 'remote' or (for practice) 'both' is not an answer", () => {
    const { mine, theirs, base } = conflicted();
    const r = settle(mine, theirs, base, { "progress:c5": "yes", name: "other" });
    assert.equal(r.status, "conflicts");
    assert.deepEqual(r.conflicts.map((c) => c.part).sort(), ["name", "progress:c5"]);
    assert.deepEqual(r.settled, []);
  });

  test("a settled piece is stable: loading it again changes nothing, and what wasn't in conflict still merged", () => {
    const b = base0();
    const mine = edit(logSession(logSession(b, "c5", { day: 2, loggedAt: 211 }), "c9", { day: 2, loggedAt: 212 }), { name: "Mine", notes: "my notes" }, 30);
    const theirs = edit(logSession(b, "c5", { day: 3, loggedAt: 311 }), { name: "Theirs", status: "paused" }, 40);
    const r = settle(mine, theirs, fromBase(b), { "progress:c5": "both", name: "remote" });
    assert.equal(r.status, "merged");
    assert.equal(r.merged.notes, "my notes", "changed here only");
    assert.equal(r.merged.status, "paused", "changed there only");
    assert.ok(sessionKeys(r.merged).has("c9|212"), "the chunk only this device practiced");
    assert.equal(r.merged.updatedAt, 40);
    assert.deepEqual(piecePartFingerprints(validateAndMigratePiece(clone(r.merged))), piecePartFingerprints(r.merged), "unchanged by a reload");
    assert.equal(validateAndMigratePiece(clone(r.merged)).lastLoggedAt, r.merged.lastLoggedAt);
  });

  test("a schedule mode settled 'the other device's' is the mode the merged schedule is worked out in", () => {
    const b = base0();
    const mine = edit(b, { scheduleMode: "minutes" }, 30);
    const theirs = edit(b, { scheduleMode: "days" }, 40);
    // a base that neither side still holds, so both read as having changed it
    const base = { ...fromBase(b), scheduleMode: "an-older-value" };
    assert.deepEqual(planPieceMerge({ local: mine, remote: theirs, base }).conflicts.map((c) => c.part), ["scheduleMode"]);
    assert.equal(settle(mine, theirs, base, { scheduleMode: "remote" }).merged.scheduleMode, "days");
    assert.equal(settle(mine, theirs, base, { scheduleMode: "local" }).merged.scheduleMode, "minutes");
  });

  test("a conflict over the target date: days to learn and minutes per day follow the answer as a unit, never one device's date with the other's days", () => {
    const b = base0();
    // this device changed the date (the app worked out new days and minutes from it); the other device changed the date and the minutes, not the days
    const mine = edit(b, { targetDate: "2026-04-01", daysToLearn: 16, minutesPerDay: 20 }, 30);
    const theirs = edit(b, { targetDate: "2026-04-15", minutesPerDay: 10 }, 40);
    const base = fromBase(b);
    const open = settle(mine, theirs, base, {});
    assert.deepEqual(open.conflicts.map((c) => c.part).sort(), ["minutesPerDay", "targetDate"], "asked nothing: exactly as before");
    assert.deepEqual(open.linkedToDate, ["daysToLearn", "minutesPerDay"], "and the engine says which numbers go with the date");
    const local = settle(mine, theirs, base, { targetDate: "local" });
    assert.equal(local.status, "merged", "the minutes are not a second question");
    assert.deepEqual([local.merged.targetDate, local.merged.daysToLearn, local.merged.minutesPerDay], ["2026-04-01", 16, 20]);
    const remote = settle(mine, theirs, base, { targetDate: "remote" });
    assert.equal(remote.status, "merged");
    assert.deepEqual(
      [remote.merged.targetDate, remote.merged.daysToLearn, remote.merged.minutesPerDay],
      ["2026-04-15", 21, 10],
      "their date comes with THEIR days (the unchanged 21), not this device's 16 that was only changed here"
    );
    assert.deepEqual(piecePartFingerprints(validateAndMigratePiece(clone(remote.merged))), piecePartFingerprints(remote.merged), "stable after a reload");
  });

  test("the reschedule marker is regenerated by a date edit, so it follows the date too (a different one on each side is not a second question)", () => {
    const b = base0();
    const markerHere = { asOfDay: 3, remainingChunkOrder: ["c9", "c13"], previous: null };
    const markerThere = { asOfDay: 3, remainingChunkOrder: ["c13", "c9"], previous: null };
    const mine = edit(b, { targetDate: "2026-04-01", rescheduleMarker: markerHere }, 30);
    const theirs = edit(b, { targetDate: "2026-04-15", rescheduleMarker: markerThere }, 40);
    const base = fromBase(b);
    const open = settle(mine, theirs, base, {});
    assert.deepEqual(open.conflicts.map((c) => c.part).sort(), ["rescheduleMarker", "targetDate"]);
    assert.deepEqual(open.linkedToDate, ["rescheduleMarker"]);
    const local = settle(mine, theirs, base, { targetDate: "local" });
    assert.equal(local.status, "merged");
    assert.deepEqual(local.merged.rescheduleMarker.remainingChunkOrder, ["c9", "c13"]);
    const remote = settle(mine, theirs, base, { targetDate: "remote" });
    assert.equal(remote.status, "merged");
    assert.deepEqual(remote.merged.rescheduleMarker.remainingChunkOrder, ["c13", "c9"], "their date comes with their plan");
    // a reschedule made on purpose with no date change anywhere is an ordinary part, still askable
    const a = edit(b, { rescheduleMarker: markerHere }, 30);
    const c = edit(b, { rescheduleMarker: markerThere }, 40);
    assert.deepEqual(settle(a, c, base, {}).conflicts.map((x) => x.part), ["rescheduleMarker"]);
    assert.deepEqual(settle(a, c, base, {}).linkedToDate, []);
  });

  test("in a minutes-per-day schedule the minutes are what the person sets, so a conflict over the date does not carry them", () => {
    const b = makePiece({ scheduleMode: "minutes", minutesPerDay: 30, progress: {}, updatedAt: 10 });
    const mine = edit(b, { targetDate: "2026-04-01", minutesPerDay: 40 }, 30);
    const theirs = edit(b, { targetDate: "2026-04-15" }, 40);
    const base = fromBase(b);
    const open = settle(mine, theirs, base, {});
    assert.deepEqual(open.linkedToDate, [], "not a days-mode schedule: nothing goes with the date");
    const remote = settle(mine, theirs, base, { targetDate: "remote" });
    assert.equal(remote.status, "merged");
    assert.equal(remote.merged.targetDate, "2026-04-15");
    assert.equal(remote.merged.minutesPerDay, 40, "changed on this device only, so this device's minutes stay");
  });

  test("the numbers worked out from the date are ordinary parts when the date is not in conflict, and an answer about them alone is unused", () => {
    const b = base0();
    const mine = edit(b, { daysToLearn: 16 }, 30);
    const theirs = edit(b, { minutesPerDay: 10 }, 40);
    const base = fromBase(b);
    const r = settle(mine, theirs, base, {});
    assert.equal(r.status, "merged", "each changed on one side only, so each is taken");
    assert.deepEqual([r.merged.daysToLearn, r.merged.minutesPerDay], [16, 10]);
    assert.deepEqual(r.linkedToDate, [], "no conflict over the date: nothing is linked");
    // both changed the minutes differently, the date untouched: still an ordinary conflict, still askable
    const a = edit(b, { minutesPerDay: 20 }, 30);
    const c = edit(b, { minutesPerDay: 10 }, 40);
    assert.deepEqual(settle(a, c, base, {}).conflicts.map((x) => x.part), ["minutesPerDay"]);
    assert.equal(settle(a, c, base, { minutesPerDay: "remote" }).merged.minutesPerDay, 10);
    // an answer about a linked number when the date has not been answered is not an answer to the date
    const dateOpen = settle(edit(b, { targetDate: "2026-04-01", daysToLearn: 16, minutesPerDay: 20 }, 30), edit(b, { targetDate: "2026-04-15", minutesPerDay: 10 }, 40), base, { minutesPerDay: "remote" });
    assert.equal(dateOpen.status, "conflicts");
    assert.deepEqual(dateOpen.conflicts.map((x) => x.part).sort(), ["targetDate"], "the minutes were settled by their own answer; the date is still open");
  });

  test("a minutes-per-day schedule settled 'the other device's' is worked out as one, so it is the same after a reload", () => {
    const b = base0();
    const mine = edit(b, { scheduleMode: "days" }, 30);
    const theirs = edit(b, { scheduleMode: "minutes", minutesPerDay: 120 }, 40); // 120 a day needs far fewer than the 21 days
    const base = { ...fromBase(b), scheduleMode: "an-older-value" };
    const r = settle(mine, theirs, base, { scheduleMode: "remote" });
    assert.equal(r.status, "merged");
    assert.equal(r.merged.scheduleMode, "minutes");
    assert.notEqual(r.merged.daysToLearn, 21, "the schedule was re-derived from the minutes, not left as the days piece's 21");
    assert.equal(validateAndMigratePiece(clone(r.merged)).daysToLearn, r.merged.daysToLearn, "a reload would not change it");
  });

  test("a schedule mode settled 'the other device's' also makes days-to-learn derived, not a second question", () => {
    const b = base0();
    const mine = edit(b, { scheduleMode: "days", daysToLearn: 30 }, 30);
    const theirs = edit(b, { scheduleMode: "minutes", minutesPerDay: 120 }, 40);
    const base = { ...fromBase(b), scheduleMode: "an-older-value" };
    const r = settle(mine, theirs, base, { scheduleMode: "remote" });
    assert.equal(r.status, "merged", "in minutes mode days-to-learn is worked out from the minutes, never asked");
    assert.deepEqual(r.derived, ["daysToLearn"]);
  });

  test("the whole-piece conflict: this device's whole piece, or the other device's, never a mix; no other answer means anything", () => {
    const b = base0();
    const split = splitPracticeChunk(b, "c9");
    const splitter = reload({ ...b, chunkSplitPoints: split.chunkSplitPoints, progress: split.progress }, 30);
    const logger = { ...logSession(b, "c13", { day: 2, loggedAt: 331 }), updatedAt: 40 };
    const base = fromBase(b);
    const open = settle(splitter, logger, base, {});
    assert.equal(open.status, "whole-piece-conflict");
    const keepMine = settle(splitter, logger, base, { [WHOLE_PIECE_PART]: "local" });
    assert.equal(keepMine.status, "merged");
    assert.deepEqual(keepMine.settled.map((x) => [x.part, x.kind, x.choice]), [[WHOLE_PIECE_PART, "whole-piece", "local"]]);
    assert.deepEqual(keepMine.merged.chunkSplitPoints, canonicalPiece(splitter).chunkSplitPoints);
    assert.equal(sessionKeys(keepMine.merged).has("c13|331"), false, "the other device's practice goes with the other device's piece");
    assert.equal(keepMine.merged.updatedAt, 40, "the later stamp, as in every merge");
    const keepTheirs = settle(splitter, logger, base, { [WHOLE_PIECE_PART]: "remote" });
    assert.deepEqual(keepTheirs.merged.chunkSplitPoints, canonicalPiece(logger).chunkSplitPoints);
    assert.ok(sessionKeys(keepTheirs.merged).has("c13|331"));
    const notAnAnswer = settle(splitter, logger, base, { [WHOLE_PIECE_PART]: "both" });
    assert.equal(notAnAnswer.status, "whole-piece-conflict");
    assert.deepEqual(notAnAnswer.unusedChoices, [WHOLE_PIECE_PART]);
    assert.deepEqual(piecePartFingerprints(validateAndMigratePiece(clone(keepTheirs.merged))), piecePartFingerprints(keepTheirs.merged), "stable after a reload");
  });
});

describe("150 seeded pairs of copies, every conflict settled a random valid way (Pass 121)", () => {
  const CHUNKS = ["c1", "c5", "c9", "c13", "c17"];
  const latestJudged = (entry) => Math.max(-1, ...((entry && entry.sessions) || []).filter((s) => !s.skipped && !s.provisional).map((s) => s.loggedAt));

  test("the answer is applied exactly as given, only the answered parts change, and the result survives a reload", () => {
    let withConflicts = 0;
    let bothAnswers = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const rng = seeded(seed);
      const b0 = makePiece({
        progress: { c1: { doneDays: [1], sessions: [{ day: 1, loggedAt: 100, loggedDate: "2026-03-01", cleanReps: 3, bpm: 80, outcome: "pass" }] } },
        updatedAt: 10,
      });
      let at = 1000;
      const practice = (piece, n) => {
        let p = piece;
        for (let i = 0; i < n; i++) {
          p = logSession(p, pickOf(rng, CHUNKS), { day: intIn(rng, 2, 6), loggedAt: at++, bpm: intIn(rng, 60, 120), outcome: pickOf(rng, ["pass", "soft-miss", "fail"]) });
        }
        return p;
      };
      let A = practice(b0, intIn(rng, 1, 4));
      let B = practice(b0, intIn(rng, 1, 4));
      if (rng() < 0.6) A = { ...A, name: `A${seed}` };
      if (rng() < 0.6) B = { ...B, name: `B${seed}` };
      if (rng() < 0.5) A = { ...A, targetDate: `2026-04-${String(intIn(rng, 10, 19))}` };
      if (rng() < 0.5) B = { ...B, targetDate: `2026-04-${String(intIn(rng, 20, 28))}` };
      A = { ...A, updatedAt: 100 + intIn(rng, 0, 50) };
      B = { ...B, updatedAt: 100 + intIn(rng, 0, 50) };
      const base = piecePartFingerprints(b0);
      const first = planPieceMerge({ local: A, remote: B, base });
      if (first.status !== "conflicts") continue;
      withConflicts++;
      const choices = {};
      first.conflicts.forEach((c) => {
        choices[c.part] = pickOf(rng, c.kind === "progress" ? ["local", "remote", "both"] : ["local", "remote"]);
      });
      const done = planPieceMerge({ local: A, remote: B, base, choices });
      const where = `seed ${seed}`;
      assert.equal(done.status, "merged", where);
      assert.deepEqual(done.conflicts, [], where);
      assert.deepEqual(done.unusedChoices, [], where);
      assert.equal(done.settled.length, first.conflicts.length, `every conflict settled once (${where})`);
      first.conflicts.forEach((c) => {
        const choice = choices[c.part];
        const got = c.kind === "progress" ? done.merged.progress[c.id] : done.merged[c.field];
        if (choice === "local") assert.deepEqual(got, c.local, `${c.part}: this device's (${where})`);
        else if (choice === "remote") assert.deepEqual(got, c.remote, `${c.part}: the other device's (${where})`);
        else {
          bothAnswers++;
          const wanted = new Set([...sessionKeysInPart(c.part, c.local), ...sessionKeysInPart(c.part, c.remote)]);
          const have = sessionKeysInPart(c.part, got);
          assert.deepEqual([...have].sort(), [...wanted].sort(), `${c.part}: every session from both sides (${where})`);
          assert.equal(got.sessions.length, wanted.size, `${c.part}: none twice (${where})`);
          const later = latestJudged(c.remote) > latestJudged(c.local) ? c.remote : c.local;
          ["stage", "practiceBPM", "nextDueDate", "currentBPM", "consecutivePasses"].forEach((k) => assert.equal(got[k], later[k], `${c.part}.${k} follows the later session (${where})`));
        }
      });
      // only the answered parts differ from the engine's own merge
      const answered = new Set(first.conflicts.map((c) => c.part));
      Object.keys(first.merged).forEach((k) => {
        if (k === "progress" || k === "lastLoggedAt" || answered.has(k)) return;
        assert.deepEqual(done.merged[k], first.merged[k], `${k} untouched (${where})`);
      });
      Object.keys(first.merged.progress).forEach((id) => {
        if (answered.has("progress:" + id)) return;
        assert.deepEqual(done.merged.progress[id], first.merged.progress[id], `progress.${id} untouched (${where})`);
      });
      assert.deepEqual(piecePartFingerprints(validateAndMigratePiece(clone(done.merged))), piecePartFingerprints(done.merged), `stable after a reload (${where})`);
    }
    assert.ok(withConflicts >= 60, `the seeds really made conflicts (${withConflicts})`);
    assert.ok(bothAnswers >= 30, `and exercised 'both' (${bothAnswers})`);
  });
});

/* ------------------------------------------------------------------ */
/*  Piece order and date added are never a conflict (Pass 122b)        */
/* ------------------------------------------------------------------ */

describe("piece order and date added are never a conflict (Pass 122b)", () => {
  const base0 = makePiece({ sortOrder: 5, createdAt: 1000 });
  const baseParts = piecePartFingerprints(base0);
  const edited = (over, updatedAt = 50) => ({ ...base0, ...over, updatedAt });

  test("the parts the engine settles by itself are exactly piece order, the note a reorder leaves and date added", () => {
    assert.deepEqual([...SOFT_PARTS].sort(), ["createdAt", "sortOrder", "switcherOrder"]);
  });

  test("changed on one side only, the order travels like any part, whichever side moved it", () => {
    const moved = edited({ sortOrder: 2 });
    const here = planPieceMerge({ local: moved, remote: base0, base: baseParts });
    assert.equal(here.status, "local-only");
    assert.equal(here.merged.sortOrder, 2);
    assert.deepEqual(here.softSettled, []);
    const there = planPieceMerge({ local: base0, remote: moved, base: baseParts });
    assert.equal(there.status, "merged");
    assert.equal(there.merged.sortOrder, 2, "the other device reordered: this one follows");
    assert.deepEqual(there.softSettled, [], "nothing to settle: only one side changed it");
    assert.deepEqual(there.fromRemote, ["sortOrder"]);
  });

  test("changed on both sides to different values: no conflict, the other copy's order wins, and the result says so", () => {
    const r = planPieceMerge({ local: edited({ sortOrder: 1 }), remote: edited({ sortOrder: 3 }), base: baseParts });
    assert.equal(r.status, "merged", "not 'conflicts'");
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.merged.sortOrder, 3);
    assert.deepEqual(r.softSettled, [{ part: "sortOrder", side: "remote" }]);
  });

  test("softWins 'local' keeps this device's value instead (the rule between two tabs of one browser)", () => {
    const r = planPieceMerge({ local: edited({ sortOrder: 1 }), remote: edited({ sortOrder: 3 }), base: baseParts, softWins: "local" });
    assert.equal(r.status, "merged");
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.merged.sortOrder, 1);
    assert.deepEqual(r.softSettled, [{ part: "sortOrder", side: "local" }]);
    // anything else for softWins means the default
    const odd = planPieceMerge({ local: edited({ sortOrder: 1 }), remote: edited({ sortOrder: 3 }), base: baseParts, softWins: "nonsense" });
    assert.equal(odd.merged.sortOrder, 3);
  });

  test("date added is settled the same way", () => {
    const r = planPieceMerge({ local: edited({ createdAt: 1111 }), remote: edited({ createdAt: 2222 }), base: baseParts });
    assert.equal(r.status, "merged");
    assert.deepEqual(r.conflicts, []);
    assert.equal(r.merged.createdAt, 2222);
    assert.deepEqual(r.softSettled, [{ part: "createdAt", side: "remote" }]);
    const mine = planPieceMerge({ local: edited({ createdAt: 1111 }), remote: edited({ createdAt: 2222 }), base: baseParts, softWins: "local" });
    assert.equal(mine.merged.createdAt, 1111);
  });

  test("both changed to the SAME value is agreement: nothing for the engine to settle", () => {
    const r = planPieceMerge({ local: edited({ sortOrder: 4 }), remote: edited({ sortOrder: 4, notes: "x" }), base: baseParts });
    assert.equal(r.status, "merged");
    assert.deepEqual(r.softSettled, []);
    assert.ok(r.agreed.includes("sortOrder"));
    assert.equal(r.merged.sortOrder, 4);
  });

  test("with a real conflict beside them, only the real one is a conflict; the order and the date are still settled", () => {
    const local = edited({ sortOrder: 1, createdAt: 1111, name: "Mine" });
    const remote = edited({ sortOrder: 3, createdAt: 2222, name: "Theirs" });
    const r = planPieceMerge({ local, remote, base: baseParts });
    assert.equal(r.status, "conflicts");
    assert.deepEqual(r.conflicts.map((c) => c.part), ["name"], "only the name is a conflict");
    assert.equal(r.merged.name, "Mine", "a real conflict still keeps this device's value");
    assert.equal(r.merged.sortOrder, 3);
    assert.equal(r.merged.createdAt, 2222);
    assert.deepEqual(r.softSettled.map((s) => s.part).sort(), ["createdAt", "sortOrder"]);
  });

  test("an answer given for the order or the date is not an answer: it is unused and changes nothing", () => {
    const r = planPieceMerge({
      local: edited({ sortOrder: 1 }),
      remote: edited({ sortOrder: 3 }),
      base: baseParts,
      choices: { sortOrder: "local" },
    });
    assert.deepEqual(r.unusedChoices, ["sortOrder"]);
    assert.equal(r.merged.sortOrder, 3, "the engine's own rule, not the answer");
    assert.deepEqual(r.settled, []);
  });

  test("the merged piece is the same after a reload, and the inputs are never changed", () => {
    const local = edited({ sortOrder: 1, createdAt: 1111 });
    const remote = edited({ sortOrder: 3, createdAt: 2222 });
    const before = [clone(local), clone(remote)];
    const r = planPieceMerge({ local, remote, base: baseParts });
    assert.deepEqual(piecePartFingerprints(validateAndMigratePiece(clone(r.merged))), piecePartFingerprints(r.merged));
    assert.ok(same(local, before[0]) && same(remote, before[1]));
  });

  test("a structure change against progress is still one whole-piece conflict (order and date change nothing about that)", () => {
    const grid = { ...edited({ sortOrder: 1 }), totalMeasures: 40, measureDifficulty: Array(40).fill(1), sections: [{ id: "s1", name: "", start: 1, end: 40 }] };
    const practiced = logSession(edited({ sortOrder: 3 }), "c1", { day: 2, loggedAt: 7 });
    const r = planPieceMerge({ local: grid, remote: practiced, base: baseParts });
    assert.equal(r.status, "whole-piece-conflict");
    assert.equal(r.merged, grid, "this device's whole piece, untouched");
  });
});

describe("two devices that reorder end up with the same order (Pass 122b)", () => {
  // A model of the account: one shared copy. A sync merges it into the device and the
  // merged result becomes the shared copy (what an upload does). Each round both devices
  // reorder (or not) and then every device syncs, A then B then A again, a full exchange.
  const RUNS = 300;
  const ROUNDS = 6;

  function runOne(seed) {
    const rng = seeded(seed);
    let clock = 100;
    const start = makePiece({ sortOrder: intIn(rng, 0, 9), createdAt: 1000 });
    const account = { piece: start };
    const devices = [0, 1].map(() => ({ piece: start, base: piecePartFingerprints(start) }));
    let settledByEngine = 0;
    const sync = (d, where) => {
      const r = planPieceMerge({ local: d.piece, remote: account.piece, base: d.base });
      assert.notEqual(r.status, "ask", `there is always a base (${where})`);
      assert.equal(r.conflicts.some((c) => c.part === "sortOrder" || c.part === "createdAt"), false, `never a conflict on order or date (${where})`);
      settledByEngine += r.softSettled.length;
      d.piece = r.merged;
      account.piece = d.piece;
      d.base = piecePartFingerprints(d.piece);
    };
    for (let round = 0; round < ROUNDS; round++) {
      devices.forEach((d) => {
        if (rng() < 0.7) d.piece = { ...d.piece, sortOrder: intIn(rng, 0, 9), updatedAt: ++clock };
        if (rng() < 0.2) d.piece = { ...d.piece, createdAt: 1000 + intIn(rng, 1, 9), updatedAt: ++clock };
        if (rng() < 0.3) d.piece = { ...d.piece, notes: `notes ${++clock}`, updatedAt: clock }; // a real conflict now and then
      });
      const order = rng() < 0.5 ? [0, 1] : [1, 0];
      order.forEach((i) => {
        if (rng() < 0.85) sync(devices[i], `seed ${seed}, round ${round}, device ${i}`);
      });
      // a full exchange: nobody changes anything in between
      const where = `seed ${seed}, round ${round}, exchange`;
      sync(devices[0], where);
      sync(devices[1], where);
      sync(devices[0], where);
      [0, 1].forEach((i) => {
        assert.equal(devices[i].piece.sortOrder, account.piece.sortOrder, `device ${i} holds the account's order (${where})`);
        assert.equal(devices[i].piece.createdAt, account.piece.createdAt, `device ${i} holds the account's date added (${where})`);
      });
    }
    return settledByEngine;
  }

  test(`${RUNS} seeded runs: after a full exchange both devices hold the same order and the same date added, whatever each did`, () => {
    let settled = 0;
    for (let seed = 1; seed <= RUNS; seed++) settled += runOne(seed);
    console.log(`order convergence: ${RUNS} runs of ${ROUNDS} rounds, the engine settled ${settled} order or date conflicts by itself`);
    assert.ok(settled > 50, `the runs really made order conflicts (${settled})`);
  });
});

describe("the switcher shows the same list on every device (Pass 122b)", () => {
  const piece = (id, sortOrder, createdAt) => ({ id, sortOrder, createdAt });

  test("by rank first, then (for a tie) by date added, then by id, whatever order the pieces were loaded in", () => {
    const list = [piece("c", 2, 300), piece("a", 1, 500), piece("d", 2, 100), piece("b", 2, 100), piece("e", 0, 900)];
    const expected = ["e", "a", "b", "d", "c"]; // rank 0, 1, then the three 2s: 100 (b before d by id), then 300
    const rng = seeded(7);
    for (let i = 0; i < 50; i++) {
      const shuffled = [...list].sort(() => rng() - 0.5);
      assert.deepEqual(shuffled.sort(compareSwitcherOrder).map((p) => p.id), expected, `shuffle ${i}`);
    }
  });

  test("a piece with no rank sorts by when it was added, as it always did; nothing throws on gaps", () => {
    const list = [piece("x", undefined, 50), piece("y", 10, 1), piece("z", null, 5)];
    // the old rule: sortOrder ?? createdAt ?? 0, so z is 5, y is 10 and x is 50
    assert.deepEqual([...list].sort(compareSwitcherOrder).map((p) => p.id), ["z", "y", "x"]);
    assert.deepEqual([{}, { id: "q" }, null].sort(compareSwitcherOrder).length, 3);
  });

  test("wherever two pieces do not tie, it orders exactly as the old sort did (it only ends ties)", () => {
    const old = (a, b) => (a.sortOrder ?? a.createdAt ?? 0) - (b.sortOrder ?? b.createdAt ?? 0);
    const rng = seeded(11);
    for (let run = 0; run < 100; run++) {
      const ranks = [...new Set(Array.from({ length: 12 }, () => intIn(rng, 0, 40)))];
      const list = ranks.map((r, i) => (rng() < 0.7 ? piece(`p${i}`, r, intIn(rng, 1, 900)) : piece(`p${i}`, undefined, r)));
      assert.deepEqual([...list].sort(compareSwitcherOrder).map((p) => p.id), [...list].sort(old).map((p) => p.id), `run ${run}`);
    }
  });

  test("two devices that hold the same ranks (a merge by piece can leave a tie) end with the same list", () => {
    // device one loaded p1 first, device two loaded p2 first; both hold rank 4 for both pieces
    const one = [piece("p1", 4, 1000), piece("p2", 4, 1000)];
    const two = [piece("p2", 4, 1000), piece("p1", 4, 1000)];
    assert.deepEqual(one.sort(compareSwitcherOrder).map((p) => p.id), two.sort(compareSwitcherOrder).map((p) => p.id));
  });
});

/* ------------------------------------------------------------------ */
/*  The most recent reorder wins (Pass 122b)                           */
/* ------------------------------------------------------------------ */

describe("the reorder note: what it is, and which of two is later (Pass 122b)", () => {
  const note = (at, ...ids) => ({ at, ids });

  test("a note is { at: a finite number, ids: an array of strings }; anything else is not one", () => {
    assert.equal(isOrderNote(note(5, "a", "b")), true);
    assert.equal(isOrderNote(note(0)), true, "an empty arrangement is still a note");
    [undefined, null, 5, "x", [], {}, { at: 5 }, { ids: [] }, { at: "5", ids: [] }, { at: NaN, ids: [] }, { at: Infinity, ids: [] }, { at: 5, ids: ["a", 7] }, { at: 5, ids: "ab" }].forEach((n) =>
      assert.equal(isOrderNote(n), false, JSON.stringify(n))
    );
  });

  test("the later moment is the later note; a real note beats a missing or malformed one; neither is a tie", () => {
    assert.equal(compareOrderNotes(note(9, "a"), note(5, "b")), 1);
    assert.equal(compareOrderNotes(note(5, "b"), note(9, "a")), -1);
    assert.equal(compareOrderNotes(note(5, "a"), undefined), 1);
    assert.equal(compareOrderNotes(null, note(5, "a")), -1);
    assert.equal(compareOrderNotes(note(5, "a"), { at: "x" }), 1);
    assert.equal(compareOrderNotes(undefined, null), 0);
    assert.equal(compareOrderNotes({ at: 1 }, "junk"), 0);
    assert.equal(compareOrderNotes(note(5, "a", "b"), note(5, "a", "b")), 0, "the same note");
  });

  test("the same moment with a different arrangement is settled by the arrangement's text, the same way round on every device", () => {
    const x = note(5, "a", "b");
    const y = note(5, "b", "a");
    assert.notEqual(compareOrderNotes(x, y), 0);
    assert.equal(compareOrderNotes(x, y), -compareOrderNotes(y, x), "swapping the two flips the answer");
  });

  test("laterOrderNote gives back the later note itself, a real one over a missing one, or undefined when neither is a note", () => {
    const a = note(5, "a");
    const b = note(9, "b");
    assert.equal(laterOrderNote(a, b), b);
    assert.equal(laterOrderNote(b, a), b);
    assert.equal(laterOrderNote(a, undefined), a);
    assert.equal(laterOrderNote(null, b), b);
    assert.equal(laterOrderNote(a, { ...a }) !== undefined, true);
    assert.equal(laterOrderNote(undefined, "junk"), undefined);
    assert.equal(laterOrderNote({ at: "x" }, null), undefined);
  });

  test("latestSwitcherOrder finds the latest note held by any piece, in an array or an id-keyed map, ignoring malformed ones", () => {
    const early = note(10, "a", "b");
    const late = note(30, "b", "a");
    const middle = note(20, "a", "b");
    const pieces = [{ id: "a", switcherOrder: early }, { id: "b" }, { id: "c", switcherOrder: late }, { id: "d", switcherOrder: middle }, { id: "e", switcherOrder: { at: 99 } }, null];
    assert.equal(latestSwitcherOrder(pieces), late);
    assert.equal(latestSwitcherOrder(Object.fromEntries(pieces.filter(Boolean).map((p) => [p.id, p]))), late);
    assert.equal(latestSwitcherOrder([{ id: "a" }, { id: "b", switcherOrder: "x" }]), null);
    assert.equal(latestSwitcherOrder([]), null);
    assert.equal(latestSwitcherOrder(undefined), null);
  });

  test("a new reorder is stamped now, but never at or before one this device has already seen (a clock that runs behind still wins after receiving)", () => {
    const pieces = [{ id: "a", switcherOrder: note(500, "a") }];
    assert.equal(nextOrderStamp([{ id: "a" }], 1000), 1000, "no note yet: now");
    assert.equal(nextOrderStamp(pieces, 1000), 1000, "a note in the past: now");
    assert.equal(nextOrderStamp(pieces, 400), 501, "this clock is behind the note it holds: just after it");
    assert.equal(nextOrderStamp(pieces, 500), 501, "the same moment: just after");
    assert.ok(nextOrderStamp(pieces) >= 501, "it works without a clock argument (the real clock)");
    assert.equal(nextOrderStamp([], NaN), 0, "a clock that gives nothing: 0, not NaN");
  });

  test("makeOrderNote is the whole arrangement in the order given, stamped as above", () => {
    const ordered = [{ id: "c" }, { id: "a" }, { id: "b" }];
    assert.deepEqual(makeOrderNote({ ordered, now: 77 }), { at: 77, ids: ["c", "a", "b"] });
    const all = [{ id: "a", switcherOrder: note(900, "a") }, { id: "b" }, { id: "c" }];
    assert.deepEqual(makeOrderNote({ ordered, all, now: 77 }), { at: 901, ids: ["c", "a", "b"] });
  });
});

describe("the switcher list: the latest note decides (Pass 122b)", () => {
  const piece = (id, sortOrder, createdAt, switcherOrder) => ({ id, sortOrder, createdAt, ...(switcherOrder ? { switcherOrder } : {}) });
  const ids = (list) => list.map((p) => p.id);

  test("with no note anywhere it is exactly the old order, for any pieces", () => {
    const rng = seeded(21);
    for (let run = 0; run < 100; run++) {
      const list = Array.from({ length: 10 }, (_, i) => (rng() < 0.7 ? piece(`p${i}`, intIn(rng, 0, 12), intIn(rng, 1, 900)) : piece(`p${i}`, undefined, intIn(rng, 1, 900))));
      assert.deepEqual(ids(sortPiecesForSwitcher(list)), ids([...list].sort(compareSwitcherOrder)), `run ${run}`);
    }
  });

  test("with a note, the pieces are in the note's order, whatever their ranks say", () => {
    const n = { at: 5, ids: ["c", "a", "b"] };
    const list = [piece("a", 0, 1, n), piece("b", 1, 2, n), piece("c", 2, 3, n)];
    assert.deepEqual(ids(sortPiecesForSwitcher(list)), ["c", "a", "b"]);
  });

  test("a piece the note does not list follows the listed ones, and those that are not listed keep the old order among themselves", () => {
    const n = { at: 5, ids: ["b", "a"] };
    const list = [piece("z", 1, 900), piece("a", 0, 1, n), piece("y", 0, 800), piece("b", 5, 2)];
    assert.deepEqual(ids(sortPiecesForSwitcher(list)), ["b", "a", "y", "z"], "y before z: rank 0 before rank 1");
  });

  test("an id in the note that no piece has is ignored, and an id listed twice counts at its first place", () => {
    const n = { at: 5, ids: ["gone", "b", "a", "b", "also-gone"] };
    assert.deepEqual(ids(sortPiecesForSwitcher([piece("a", 0, 1, n), piece("b", 1, 2)])), ["b", "a"]);
  });

  test("the LATEST note among all the pieces decides, not the first one found, and not the one on the piece that is listed first", () => {
    const old = { at: 5, ids: ["a", "b", "c"] };
    const fresh = { at: 9, ids: ["c", "b", "a"] };
    const list = [piece("a", 0, 1, old), piece("b", 1, 2, old), piece("c", 2, 3, fresh)];
    assert.deepEqual(ids(sortPiecesForSwitcher(list)), ["c", "b", "a"]);
    assert.deepEqual(ids(sortPiecesForSwitcher([...list].reverse())), ["c", "b", "a"]);
  });

  test("the same list whatever order the pieces were loaded in; an array or a map; nothing given is changed", () => {
    const n = { at: 5, ids: ["d", "b", "a"] };
    const list = [piece("a", 0, 1, n), piece("b", 1, 2), piece("c", 7, 3), piece("d", 2, 4, n), piece("e", 7, 3)];
    const expected = ["d", "b", "a", "c", "e"];
    const rng = seeded(5);
    for (let i = 0; i < 30; i++) assert.deepEqual(ids(sortPiecesForSwitcher([...list].sort(() => rng() - 0.5))), expected, `shuffle ${i}`);
    const snapshot = clone(list);
    assert.deepEqual(ids(sortPiecesForSwitcher(Object.fromEntries(list.map((p) => [p.id, p])))), expected);
    sortPiecesForSwitcher(list);
    assert.deepEqual(list, snapshot);
  });

  test("a malformed note on a piece is ignored; pieces without ids or notes do not throw", () => {
    const list = [{ id: "a", sortOrder: 1, switcherOrder: { at: "x", ids: ["b", "a"] } }, { id: "b", sortOrder: 0 }, {}, null];
    assert.equal(sortPiecesForSwitcher(list).length, 4);
    assert.deepEqual(ids(sortPiecesForSwitcher(list).filter(Boolean).filter((p) => p.id)), ["b", "a"]);
  });
});

describe("what a drag writes (Pass 122b)", () => {
  const piece = (id, sortOrder, switcherOrder) => ({ id, sortOrder, createdAt: 1, ...(switcherOrder ? { switcherOrder } : {}) });
  const applied = (pieces, updates) => pieces.map((p) => ({ ...p, ...(updates.find((u) => u.id === p.id) || {}) }));

  test("moving one piece up one place: the two pieces whose rank changed get the new rank and the note; the others are not written", () => {
    const before = [piece("a", 0), piece("b", 1), piece("c", 2), piece("d", 3)];
    const ordered = [before[0], before[2], before[1], before[3]]; // c up above b
    const updates = planSwitcherMove({ ordered, movedIds: ["c"], all: before, now: 100 });
    assert.deepEqual(updates.map((u) => u.id).sort(), ["b", "c"]);
    assert.deepEqual(updates.map((u) => [u.id, u.sortOrder]).sort(), [["b", 2], ["c", 1]]);
    updates.forEach((u) => assert.deepEqual(u.switcherOrder, { at: 100, ids: ["a", "c", "b", "d"] }));
  });

  test("the note is the whole arrangement in the new order, a separate copy for each piece, and the list then shows it", () => {
    const before = [piece("a", 0), piece("b", 1), piece("c", 2)];
    const ordered = [before[2], before[0], before[1]];
    const updates = planSwitcherMove({ ordered, movedIds: ["c"], all: before, now: 50 });
    assert.equal(updates.length, 3, "every rank changed");
    assert.notEqual(updates[0].switcherOrder, updates[1].switcherOrder);
    assert.notEqual(updates[0].switcherOrder.ids, updates[1].switcherOrder.ids);
    assert.deepEqual(sortPiecesForSwitcher(applied(before, updates)).map((p) => p.id), ["c", "a", "b"]);
  });

  test("the piece that was dragged is always written, even if its rank came out the same (the note has to exist somewhere)", () => {
    // ranks already equal the new order's positions (they were out of step with the list the person saw)
    const stale = [piece("a", 0), piece("b", 1), piece("c", 2)];
    const updates = planSwitcherMove({ ordered: stale, movedIds: ["b"], all: stale, now: 9 });
    assert.deepEqual(updates.map((u) => u.id), ["b"]);
    assert.deepEqual(updates[0].switcherOrder, { at: 9, ids: ["a", "b", "c"] });
  });

  test("a drag made after receiving a later note than this clock reads is still stamped after it, and so wins", () => {
    const seen = { at: 5000, ids: ["a", "b", "c"] };
    const before = [piece("a", 0, seen), piece("b", 1), piece("c", 2)];
    const updates = planSwitcherMove({ ordered: [before[1], before[0], before[2]], movedIds: ["b"], all: before, now: 1200 });
    assert.equal(updates[0].switcherOrder.at, 5001);
    assert.deepEqual(sortPiecesForSwitcher(applied(before, updates)).map((p) => p.id), ["b", "a", "c"]);
  });

  test("two drags in a row: the second is later, and the list shows the second arrangement", () => {
    let pieces = [piece("a", 0), piece("b", 1), piece("c", 2), piece("d", 3)];
    const drag = (from, to, now) => {
      const list = sortPiecesForSwitcher(pieces);
      const ordered = [...list];
      const [m] = ordered.splice(from, 1);
      ordered.splice(to, 0, m);
      pieces = applied(pieces, planSwitcherMove({ ordered, movedIds: [m.id], all: pieces, now }));
    };
    drag(3, 0, 10); // d first
    assert.deepEqual(sortPiecesForSwitcher(pieces).map((p) => p.id), ["d", "a", "b", "c"]);
    drag(1, 3, 20); // a down to the end
    assert.deepEqual(sortPiecesForSwitcher(pieces).map((p) => p.id), ["d", "b", "c", "a"]);
    assert.equal(latestSwitcherOrder(pieces).at, 20);
  });

  test("a move that changes nothing writes only the piece it was told was moved; no pieces: no writes", () => {
    assert.deepEqual(planSwitcherMove({ ordered: [], movedIds: [], now: 1 }), []);
    assert.deepEqual(planSwitcherMove({ now: 1 }), []);
  });
});

describe("two copies that were both reordered: the more recent reorder wins (Pass 122b)", () => {
  const base0 = makePiece({ sortOrder: 5, createdAt: 1000 });
  const baseParts = piecePartFingerprints(base0);
  const edited = (over, updatedAt = 50) => ({ ...base0, ...over, updatedAt });
  const noteA = { at: 100, ids: ["p1", "p2", "p3"] };
  const noteB = { at: 200, ids: ["p3", "p2", "p1"] };
  const sides = (r) => r.softSettled.map((s) => `${s.part}:${s.side}`).sort();

  test("both copies reordered: the later note and its rank win, whichever copy is 'local', and softWins has no say", () => {
    const a = edited({ sortOrder: 1, switcherOrder: noteA });
    const b = edited({ sortOrder: 3, switcherOrder: noteB });
    ["remote", "local"].forEach((softWins) => {
      const here = planPieceMerge({ local: a, remote: b, base: baseParts, softWins });
      assert.equal(here.status, "merged");
      assert.deepEqual(here.conflicts, []);
      assert.deepEqual(here.merged.switcherOrder, noteB);
      assert.equal(here.merged.sortOrder, 3);
      assert.deepEqual(sides(here), ["sortOrder:remote", "switcherOrder:remote"]);
      const there = planPieceMerge({ local: b, remote: a, base: baseParts, softWins });
      assert.deepEqual(there.merged.switcherOrder, noteB);
      assert.equal(there.merged.sortOrder, 3);
      assert.deepEqual(sides(there), ["sortOrder:local", "switcherOrder:local"]);
    });
  });

  test("the same two copies merged from either side give the same order: two devices cannot disagree", () => {
    const a = edited({ sortOrder: 1, switcherOrder: noteA });
    const b = edited({ sortOrder: 3, switcherOrder: noteB });
    const one = planPieceMerge({ local: a, remote: b, base: baseParts }).merged;
    const two = planPieceMerge({ local: b, remote: a, base: baseParts }).merged;
    assert.deepEqual([one.sortOrder, one.switcherOrder], [two.sortOrder, two.switcherOrder]);
  });

  test("one copy was reordered with a note, the other by a device on the previous version (a rank and no note): the noted copy wins both", () => {
    const noted = edited({ sortOrder: 1, switcherOrder: noteA });
    const plain = edited({ sortOrder: 3 });
    const r = planPieceMerge({ local: plain, remote: noted, base: baseParts });
    assert.equal(r.status, "merged");
    assert.equal(r.merged.sortOrder, 1, "the noted copy's rank, not the other copy's by default");
    assert.deepEqual(r.merged.switcherOrder, noteA);
    const back = planPieceMerge({ local: noted, remote: plain, base: baseParts });
    assert.equal(back.merged.sortOrder, 1);
    assert.deepEqual(back.merged.switcherOrder, noteA);
  });

  test("no note on either side: exactly the earlier rule (the account's order, or this device's for a tab)", () => {
    const r = planPieceMerge({ local: edited({ sortOrder: 1 }), remote: edited({ sortOrder: 3 }), base: baseParts });
    assert.equal(r.merged.sortOrder, 3);
    assert.equal(r.merged.switcherOrder, undefined);
    assert.deepEqual(sides(r), ["sortOrder:remote"]);
    const tab = planPieceMerge({ local: edited({ sortOrder: 1 }), remote: edited({ sortOrder: 3 }), base: baseParts, softWins: "local" });
    assert.equal(tab.merged.sortOrder, 1);
  });

  test("only one copy was reordered: it travels whichever side that is, and nothing needs settling", () => {
    const moved = edited({ sortOrder: 2, switcherOrder: noteA });
    const here = planPieceMerge({ local: base0, remote: moved, base: baseParts });
    assert.deepEqual([here.merged.sortOrder, here.merged.switcherOrder], [2, noteA]);
    assert.deepEqual(here.softSettled, []);
    assert.deepEqual(here.fromRemote.sort(), ["sortOrder", "switcherOrder"]);
    const there = planPieceMerge({ local: moved, remote: base0, base: baseParts });
    assert.equal(there.status, "local-only");
    assert.deepEqual(there.merged.switcherOrder, noteA);
  });

  test("the date added is not part of a reorder: it still follows softWins even when a note decides the order", () => {
    const a = edited({ sortOrder: 1, switcherOrder: noteA, createdAt: 1111 });
    const b = edited({ sortOrder: 3, switcherOrder: noteB, createdAt: 2222 });
    const r = planPieceMerge({ local: b, remote: a, base: baseParts });
    assert.equal(r.merged.sortOrder, 3, "the later note is local's");
    assert.equal(r.merged.createdAt, 1111, "the date added is the other copy's, as before");
    assert.deepEqual(sides(r), ["createdAt:remote", "sortOrder:local", "switcherOrder:local"]);
  });

  test("a real conflict beside a reorder is still the only conflict; the merged piece is the same after a reload; the inputs are never changed", () => {
    const local = edited({ sortOrder: 1, switcherOrder: noteB, name: "Mine" });
    const remote = edited({ sortOrder: 3, switcherOrder: noteA, name: "Theirs" });
    const before = [clone(local), clone(remote)];
    const r = planPieceMerge({ local, remote, base: baseParts });
    assert.equal(r.status, "conflicts");
    assert.deepEqual(r.conflicts.map((c) => c.part), ["name"]);
    assert.equal(r.merged.sortOrder, 1);
    assert.deepEqual(r.merged.switcherOrder, noteB);
    assert.deepEqual(piecePartFingerprints(validateAndMigratePiece(clone(r.merged))), piecePartFingerprints(r.merged));
    assert.ok(same(local, before[0]) && same(remote, before[1]));
  });

  test("an answer given for the note is not an answer: it is unused and changes nothing", () => {
    const r = planPieceMerge({
      local: edited({ sortOrder: 1, switcherOrder: noteA }),
      remote: edited({ sortOrder: 3, switcherOrder: noteB }),
      base: baseParts,
      choices: { switcherOrder: "local" },
    });
    assert.deepEqual(r.unusedChoices, ["switcherOrder"]);
    assert.deepEqual(r.merged.switcherOrder, noteB);
  });

  test("a malformed note counts as no note: the other copy's real note wins, and two malformed ones fall back to the earlier rule", () => {
    const junk = edited({ sortOrder: 1, switcherOrder: { at: "x" } });
    const real = edited({ sortOrder: 3, switcherOrder: noteA });
    assert.equal(planPieceMerge({ local: real, remote: junk, base: baseParts }).merged.sortOrder, 3);
    assert.equal(planPieceMerge({ local: junk, remote: real, base: baseParts }).merged.sortOrder, 3);
    const junk2 = edited({ sortOrder: 4, switcherOrder: "?" });
    assert.equal(planPieceMerge({ local: junk, remote: junk2, base: baseParts }).merged.sortOrder, 4);
  });
});

// The whole-list property, the one the owner asked for. Two or three devices each hold every piece
// of one list, drag pieces around while apart (some drags made before the device has seen the
// others', some after), log practice (so that real merges happen), and sync with one shared copy
// of each piece. Whatever happened, after a full exchange every device shows the SAME list, and it
// is exactly the arrangement of the reorder with the latest note: not a blend of two drags.
describe("devices that reorder apart end with the most recent reorder, as a whole (Pass 122b)", () => {
  const RUNS = 300;
  const ROUNDS = 6;
  const later = (a, b) => a.at > b.at || (a.at === b.at && a.ids.join("\u0001") > b.ids.join("\u0001"));

  function runOne(seed, tally) {
    const rng = seeded(seed);
    const ids = Array.from({ length: intIn(rng, 3, 6) }, (_, i) => `p${i + 1}`);
    const deviceCount = intIn(rng, 2, 3);
    let clock = 100000; // real time, shared
    let stamp = 0; // unique labels for edits
    const skew = Array.from({ length: deviceCount }, (_, i) => (i === 0 ? 0 : intIn(rng, -400, 400))); // each device's clock reads a little off
    const start = Object.fromEntries(ids.map((id, i) => [id, makePiece({ id, name: `Piece ${i + 1}`, createdAt: 1000 + i, sortOrder: 1000 + i })]));
    const account = { ...start };
    const devices = Array.from({ length: deviceCount }, (_, n) => ({ n, pieces: { ...start }, bases: Object.fromEntries(ids.map((id) => [id, piecePartFingerprints(start[id])])) }));
    const made = []; // every note a drag made, with the arrangement it stands for
    const listOf = (d) => sortPiecesForSwitcher(Object.values(d.pieces)).map((p) => p.id);

    const drag = (d) => {
      const list = sortPiecesForSwitcher(Object.values(d.pieces));
      const from = intIn(rng, 0, list.length - 1);
      const to = intIn(rng, 0, list.length - 1);
      if (from === to) return false;
      const ordered = [...list];
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      clock += intIn(rng, 1, 40);
      const seen = latestSwitcherOrder(Object.values(d.pieces));
      const updates = planSwitcherMove({ ordered, movedIds: [moved.id], all: Object.values(d.pieces), now: clock + skew[d.n] });
      assert.ok(updates.length >= 1, "a drag writes something");
      if (seen) assert.ok(updates[0].switcherOrder.at > seen.at, "a drag is stamped after every reorder this device has seen");
      updates.forEach((u) => {
        d.pieces[u.id] = { ...d.pieces[u.id], sortOrder: u.sortOrder, switcherOrder: u.switcherOrder, updatedAt: 500000 + ++stamp };
      });
      made.push({ at: updates[0].switcherOrder.at, ids: ordered.map((p) => p.id) });
      return true;
    };
    const practice = (d) => {
      const id = pickOf(rng, ids);
      const p = d.pieces[id];
      const target = pickOf(rng, generateAllChunks(p).practiceChunks);
      d.pieces[id] = reload(logSession(p, target.id, { day: intIn(rng, 1, p.daysToLearn), loggedAt: ++stamp, bpm: intIn(rng, 50, 110) }), 500000 + ++stamp);
    };
    const sync = (d, where) => {
      ids.forEach((id) => {
        const r = planPieceMerge({ local: d.pieces[id], remote: account[id], base: d.bases[id] });
        assert.notEqual(r.status, "ask", `there is always a base (${where})`);
        assert.notEqual(r.status, "whole-piece-conflict", `nothing here changes the grid (${where})`);
        assert.equal(r.conflicts.some((c) => SOFT_PARTS.includes(c.part)), false, `the order is never a conflict (${where})`);
        tally.settled += r.softSettled.length;
        d.pieces[id] = r.merged;
        account[id] = r.merged;
        d.bases[id] = piecePartFingerprints(r.merged);
      });
    };

    for (let round = 0; round < ROUNDS; round++) {
      let drags = 0;
      devices.forEach((d) => {
        for (let i = 0, n = intIn(rng, 0, 2); i < n; i++) practice(d);
        if (rng() < 0.7 && drag(d)) drags += 1;
        if (rng() < 0.2 && drag(d)) drags += 1;
      });
      tally.drags += drags;
      if (drags >= 2) tally.apart += 1;
      (rng() < 0.5 ? devices : [...devices].reverse()).forEach((d) => {
        if (rng() < 0.85) sync(d, `seed ${seed}, round ${round}, device ${d.n}`);
      });
      const where = `seed ${seed}, round ${round}, exchange`;
      for (let pass = 0; pass < 2; pass++) devices.forEach((d) => sync(d, where));
      const winner = made.reduce((best, m) => (best === null || later(m, best) ? m : best), null);
      const expected = winner ? winner.ids : ids;
      devices.forEach((d) => {
        const shown = listOf(d);
        assert.equal(new Set(shown).size, ids.length, `every piece appears once (${where})`);
        assert.deepEqual(shown, expected, `device ${d.n} shows the most recent reorder, whole (${where})`);
      });
    }
  }

  test(`${RUNS} seeded runs of ${ROUNDS} rounds, two or three devices: after a full exchange everyone shows the latest reorder as a whole`, () => {
    const tally = { drags: 0, apart: 0, settled: 0 };
    for (let seed = 1; seed <= RUNS; seed++) runOne(seed, tally);
    console.log(`reorder simulation: ${RUNS} runs of ${ROUNDS} rounds, ${tally.drags} drags, ${tally.apart} rounds with two or more drags made apart, the engine settled ${tally.settled} order parts by itself`);
    assert.ok(tally.drags > 500, `drags were made (${tally.drags})`);
    assert.ok(tally.apart > 100, `devices really dragged apart (${tally.apart})`);
    assert.ok(tally.settled > 100, `and the engine really settled order parts (${tally.settled})`);
  });
});
