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
// six invariants:
//   1. no session logged on either device since the base is missing: it is in
//      the merged piece or, for a conflicted part, in the conflict's values
//   2. a part changed on one side only ends with that side's value
//   3. a part changed on both to different values is reported as a conflict,
//      never silently chosen (and the merged piece keeps this device's value)
//   4. the merged piece is unchanged by validateAndMigratePiece
//   5. merging the same inputs again gives the same result
//   6. merging when the remote equals the base returns this device's piece
//      untouched
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
  const EVERY_KIND = [["log", 30], ["undo", 8], ["schedule", 8], ["difficulty", 8], ["status", 5], ["describe", 6], ["split", 8], ["reschedule", 8], ["spot", 8], ["spotTime", 4]];
  const EVERYDAY = [["log", 80], ["undo", 3], ["schedule", 3], ["difficulty", 3], ["status", 1], ["describe", 3], ["split", 1], ["reschedule", 1], ["spot", 3], ["spotTime", 2]];

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
          const cl = changed(lt, k);
          const cr = changed(rt, k);
          if (!cl && !cr) assert.ok(same(mt[k], lt[k]), `unchanged part ${k} (${where})`);
          else if (cl && !cr) assert.ok(same(mt[k], lt[k]), `(2) ${k}: only this device changed it (${where})`);
          else if (!cl && cr) assert.ok(same(mt[k], rt[k]), `(2) ${k}: only the other side changed it (${where})`);
          else if (same(lt[k], rt[k])) {
            assert.ok(same(mt[k], lt[k]), `agreed ${k} (${where})`);
            assert.equal(conflictKeys.has(k), false, `${k} is agreement, not a conflict (${where})`);
          } else {
            assert.ok(conflictKeys.has(k), `(3) ${k}: changed on both to different values is reported (${where})`);
            assert.ok(same(mt[k], lt[k]), `(3) ${k}: this device's value is kept (${where})`);
            const c = partConflicts.find((x) => x.part === k);
            assert.ok(same(c.local, lt[k]) && same(c.remote, rt[k]), `(3) ${k}: the conflict lists both values (${where})`);
          }
        });
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

  test(`${RUNS} seeded runs of ${ROUNDS} rounds, every kind of edit: the six invariants hold after every merge`, () => {
    const tally = simulate("every kind of edit", EVERY_KIND, RUNS);
    assert.ok(tally.merges > RUNS, "the simulation really merged");
    assert.ok((tally.merged || 0) > 0 && (tally.conflicts || 0) > 0 && (tally["whole-piece-conflict"] || 0) > 0, "it exercised clean merges, part conflicts and whole-piece conflicts");
    assert.ok(tally.partConflicts > 0 && tally.chunkConflicts > 0, "and single-part conflicts");
  });

  test("100 more runs with an everyday mix (mostly practice sessions): the same six invariants", () => {
    const tally = simulate("everyday mix", EVERYDAY, 100);
    assert.ok((tally.merged || 0) > 0);
  });
});
