// Pass 122 (src/lib/recentlyDeleted.js): the pure rules behind "a piece deleted on one
// device is deleted everywhere, with a way back": the 30-day window, which pieces a
// deletion reaches, the list of recently deleted pieces, the count of practice that goes
// with a removed piece, and the delete window's words.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import {
  RECENTLY_DELETED_DAYS,
  isRecentlyDeleted,
  deletedCutoffIso,
  wasSyncedHere,
  deletionsElsewhere,
  deletedForPerson,
  sessionsOnlyHere,
  describeDeletedAgo,
  recentlyDeletedList,
  deleteWindowCopy,
} from "../src/lib/recentlyDeleted.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-24T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const viaJson = (v) => JSON.parse(JSON.stringify(v));
// What the database does to an object: same content, keys in another order.
function reorder(v) {
  if (Array.isArray(v)) return v.map(reorder);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])]));
  return v;
}
const session = (day, loggedAt, durationSeconds = 60) => ({ day, loggedAt, loggedDate: `2026-10-${String(day + 10).padStart(2, "0")}`, cleanReps: 3, reps: 3, bpm: 60 + day, outcome: "pass", durationSeconds });
const pieceOf = (id, progress = {}, extra = {}) =>
  validateAndMigratePiece({
    id,
    name: `Piece ${id}`,
    totalMeasures: 32,
    startDate: "2026-10-01",
    createdAt: 1000,
    updatedAt: 1000,
    sortOrder: 1,
    measureDifficulty: Array(32).fill(1),
    sections: [{ id: "s1", name: "A", start: 1, end: 32 }],
    status: "active",
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    chunkMode: "auto",
    progress,
    ...extra,
  });

describe("the 30-day window (Pass 122)", () => {
  test("it is 30 days, and the boundary day is inside", () => {
    assert.equal(RECENTLY_DELETED_DAYS, 30);
    assert.equal(isRecentlyDeleted(ago(30 * DAY), NOW), true, "exactly 30 days ago");
    assert.equal(isRecentlyDeleted(ago(30 * DAY + 1), NOW), false, "a millisecond past it");
    assert.equal(isRecentlyDeleted(ago(DAY), NOW), true);
    assert.equal(isRecentlyDeleted(ago(0), NOW), true);
  });

  test("a time that can't be read is never recent, and a time a little ahead (a clock that is early) is", () => {
    [null, undefined, "", "not a date", 12345, {}, [], true].forEach((v) => assert.equal(isRecentlyDeleted(v, NOW), false, String(v)));
    assert.equal(isRecentlyDeleted(new Date(NOW + 5 * 60000).toISOString(), NOW), true);
  });

  test("the cutoff the list asks the account for is exactly the window's start", () => {
    assert.equal(deletedCutoffIso(NOW), ago(30 * DAY));
    assert.equal(isRecentlyDeleted(deletedCutoffIso(NOW), NOW), true, "the cutoff itself is still inside");
  });
});

describe("which deleted pieces this device still holds (Pass 122)", () => {
  const live = (id) => ({ id, revision: 2, deleted_at: null });
  const gone = (id, at, revision = 5) => ({ id, revision, deleted_at: at });

  // what the device record holds for a piece this device synced before (a recorded revision)
  const synced = (revision = 2) => ({ revision, fingerprint: "f" });

  test("recent and older are told apart, in order, and only pieces this device holds count", () => {
    const rows = { pieces: [gone("b", ago(2 * DAY)), gone("a", ago(40 * DAY)), gone("c", ago(1 * DAY)), gone("nothere", ago(DAY)), live("d")], technique: null };
    const entries = { a: synced(), b: synced(), c: synced(), d: synced() };
    const out = deletionsElsewhere({ rows, entries, localPieceIds: ["a", "b", "c", "d"], now: NOW });
    assert.deepEqual(out, { ids: ["a", "b", "c"], recent: ["b", "c"], older: ["a"], unsynced: [] });
  });

  test("a piece already held as 'changed on another device' counts too; one this device deleted itself does not", () => {
    const rows = { pieces: [gone("held", ago(DAY)), gone("mine", ago(DAY))], technique: null };
    const entries = { held: { revision: 2, fingerprint: "f", held: true }, mine: { revision: 2, fingerprint: "f", deletedHere: true } };
    const out = deletionsElsewhere({ rows, entries, localPieceIds: ["held", "mine"], now: NOW });
    assert.deepEqual(out.ids, ["held"]);
    assert.deepEqual(out.recent, ["held"], "held, but synced before: the deletion is why its upload was refused, so it goes with the rest");
  });

  test("a row listed twice counts once; no rows, no piece list and odd rows are nothing", () => {
    assert.deepEqual(deletionsElsewhere({ rows: { pieces: [gone("a", ago(DAY)), gone("a", ago(DAY))] }, entries: { a: synced() }, localPieceIds: ["a"], now: NOW }).ids, ["a"]);
    const empty = { ids: [], recent: [], older: [], unsynced: [] };
    assert.deepEqual(deletionsElsewhere({ rows: null, entries: null, localPieceIds: null, now: NOW }), empty);
    assert.deepEqual(deletionsElsewhere({ rows: { pieces: [null, { revision: 1 }, { id: "x" }] }, entries: {}, localPieceIds: ["x"], now: NOW }), empty);
  });

  test("a deleted mark with an unreadable time is listed, but never as recent", () => {
    const out = deletionsElsewhere({ rows: { pieces: [gone("a", "garbage")] }, entries: { a: synced() }, localPieceIds: ["a"], now: NOW });
    assert.deepEqual(out, { ids: ["a"], recent: [], older: ["a"], unsynced: [] });
  });

  test("what the person is told about: everything with the switch off; only the ones not about to go with it on", () => {
    const deletions = { ids: ["a", "b", "c"], recent: ["b", "c"], older: ["a"], unsynced: [] };
    assert.deepEqual(deletedForPerson({ deletions, autoOn: false, leftIds: [] }), ["a", "b", "c"]);
    assert.deepEqual(deletedForPerson({ deletions, autoOn: true, leftIds: [] }), ["a"], "the recent ones are removed by themselves");
    assert.deepEqual(deletedForPerson({ deletions, autoOn: true, leftIds: ["c"] }), ["a", "c"], "unless the automatic path looked and left one alone");
    assert.deepEqual(deletedForPerson({ deletions: null, autoOn: true, leftIds: [] }), []);
    assert.deepEqual(deletedForPerson({ deletions, autoOn: false, leftIds: ["c"] }), ["a", "b", "c"]);
  });
});

describe("a piece this device never synced is never removed by itself (Pass 122)", () => {
  const gone = (id, at, revision = 5) => ({ id, revision, deleted_at: at });
  const synced = (revision = 2) => ({ revision, fingerprint: "f" });

  test("has this device ever synced it: only a recorded revision says so", () => {
    assert.equal(wasSyncedHere(synced()), true);
    assert.equal(wasSyncedHere({ ...synced(), held: true }), true, "held, but synced before");
    [undefined, null, {}, { held: true }, { held: true, sent: ["x"] }, { revision: "3" }, { revision: NaN }, { fingerprint: "f" }].forEach((e) => assert.equal(wasSyncedHere(e), false, JSON.stringify(e)));
  });

  test("no record, or only a bare hold: deleted yesterday, but only listed (a piece brought in from a file)", () => {
    const rows = { pieces: [gone("fresh", ago(DAY)), gone("bareHold", ago(DAY)), gone("synced", ago(DAY))], technique: null };
    const entries = { bareHold: { held: true, sent: ["abc"] }, synced: synced() };
    const out = deletionsElsewhere({ rows, entries, localPieceIds: ["fresh", "bareHold", "synced"], now: NOW });
    assert.deepEqual(out, { ids: ["bareHold", "fresh", "synced"], recent: ["synced"], older: [], unsynced: ["bareHold", "fresh"] });
  });

  test("a piece never synced and deleted long ago is simply older", () => {
    const out = deletionsElsewhere({ rows: { pieces: [gone("x", ago(40 * DAY))] }, entries: {}, localPieceIds: ["x"], now: NOW });
    assert.deepEqual(out, { ids: ["x"], recent: [], older: ["x"], unsynced: [] });
  });

  test("with the switch on the person is still told about it, because nothing is about to remove it", () => {
    const rows = { pieces: [gone("fresh", ago(DAY)), gone("synced", ago(DAY))], technique: null };
    const deletions = deletionsElsewhere({ rows, entries: { synced: synced() }, localPieceIds: ["fresh", "synced"], now: NOW });
    assert.deepEqual(deletedForPerson({ deletions, autoOn: true, leftIds: [] }), ["fresh"]);
    assert.deepEqual(deletedForPerson({ deletions, autoOn: false, leftIds: [] }), ["fresh", "synced"]);
  });
});

describe("practice that goes with a piece when a deletion arrives (Pass 122)", () => {
  const withSessions = (ids) => pieceOf("p1", { c1: { doneDays: [1], sessions: ids.map((n) => session(n, 100 + n, 60 + n)) } });

  test("only the sessions the account never got are counted", () => {
    const here = withSessions([1, 2, 3]);
    const account = reorder(viaJson(withSessions([1])));
    assert.equal(sessionsOnlyHere(here, account), 2);
  });

  test("a copy that came back through the database (keys in another order) counts as the same", () => {
    const here = withSessions([1, 2]);
    assert.equal(sessionsOnlyHere(here, reorder(viaJson(here))), 0);
  });

  test("a chunk the account has no record of: all of it counts; no readable data: all of it counts", () => {
    const here = pieceOf("p1", { c1: { doneDays: [1], sessions: [session(1, 1)] }, c5: { doneDays: [1], sessions: [session(1, 2), session(2, 3)] } });
    const account = reorder(viaJson(pieceOf("p1", { c1: { doneDays: [1], sessions: [session(1, 1)] } })));
    assert.equal(sessionsOnlyHere(here, account), 2);
    assert.equal(sessionsOnlyHere(here, null), 3);
    assert.equal(sessionsOnlyHere(here, "junk"), 3);
  });

  test("run-through records and a focus spot's own log count as practice too", () => {
    const spot = (n) => ({ id: "t1", name: "spot", position: "5", sessions: Array.from({ length: n }, (_, i) => ({ minutes: 5, loggedAt: 900 + i })), resolved: false });
    const here = pieceOf("p1", { c1: { doneDays: [1], sessions: [session(1, 1)], troubleSpots: [spot(3)] }, __consolidation__: { sessions: [session(2, 7)] } });
    const account = reorder(viaJson(pieceOf("p1", { c1: { doneDays: [1], sessions: [session(1, 1)], troubleSpots: [spot(1)] } })));
    assert.equal(sessionsOnlyHere(here, account), 3, "two spot logs and one run-through session");
  });

  test("nothing practiced, or data that is not a list of sessions, is zero and never throws", () => {
    assert.equal(sessionsOnlyHere(pieceOf("p1"), {}), 0);
    assert.equal(sessionsOnlyHere(null, {}), 0);
    assert.equal(sessionsOnlyHere(undefined, undefined), 0);
    // (a piece the loader itself would refuse: handed in as it is, not built through the loader)
    const odd = { id: "p1", name: "Odd", progress: { c1: { doneDays: [1], sessions: "not a list" } } };
    assert.doesNotThrow(() => sessionsOnlyHere(odd, { progress: { c1: { sessions: 7 } } }));
    assert.equal(sessionsOnlyHere(odd, { progress: { c1: { sessions: 7 } } }), 0);
  });
});

describe("the Recently deleted list (Pass 122)", () => {
  const row = (id, at, data, revision = 4) => ({ id, revision, deleted_at: at, data });
  const piece = (name, measures = 32, sessions = 0) => ({ name, totalMeasures: measures, progress: { c1: { sessions: Array.from({ length: sessions }, (_, i) => session(1, i)) } } });

  test("only pieces deleted within the window, newest first, with what a person recognizes them by", () => {
    const rows = [
      row("old", ago(31 * DAY), piece("Too old")),
      row("a", ago(5 * DAY), piece("Ballade No. 1", 264, 12)),
      row("b", ago(1 * DAY), piece("Etude", 64, 0)),
      row("edge", ago(30 * DAY), piece("Edge day")),
    ];
    const list = recentlyDeletedList(rows, { now: NOW });
    assert.deepEqual(list.map((i) => i.id), ["b", "a", "edge"]);
    assert.deepEqual(list[1], { id: "a", revision: 4, name: "Ballade No. 1", deletedAt: ago(5 * DAY), measures: 264, sessions: 12 });
  });

  test("a duplicate that a combine marked deleted, a row with no readable data, a live row and a repeat are not listed", () => {
    const rows = [
      row("dup", ago(DAY), { ...piece("Etude"), mergedInto: "p1" }),
      row("junk", ago(DAY), "not an object"),
      row("nodata", ago(DAY), null),
      { id: "live", revision: 2, deleted_at: null, data: piece("Alive") },
      row("a", ago(DAY), piece("Once")),
      row("a", ago(DAY), piece("Twice")),
    ];
    assert.deepEqual(recentlyDeletedList(rows, { now: NOW }).map((i) => [i.id, i.name]), [["a", "Once"]]);
  });

  test("a blank or missing name reads as 'Untitled piece'; equal times fall back to the id", () => {
    const at = ago(DAY);
    const list = recentlyDeletedList([row("z", at, { totalMeasures: 8 }), row("m", at, { name: "   " })], { now: NOW });
    assert.deepEqual(list.map((i) => [i.id, i.name, i.measures]), [["m", "Untitled piece", null], ["z", "Untitled piece", 8]]);
  });

  test("how long ago, in days", () => {
    assert.equal(describeDeletedAgo(ago(1000), NOW), "today");
    assert.equal(describeDeletedAgo(ago(DAY + 1000), NOW), "yesterday");
    assert.equal(describeDeletedAgo(ago(3 * DAY + 1000), NOW), "3 days ago");
    assert.equal(describeDeletedAgo(ago(-DAY), NOW), "today", "a clock that is ahead");
    assert.equal(describeDeletedAgo("garbage", NOW), "recently");
  });
});

describe("the delete window's words (Pass 122)", () => {
  test("signed out it is exactly what it always said", () => {
    const c = deleteWindowCopy({ name: "Etude", syncs: false });
    assert.equal(
      c.body,
      `Are you sure you want to delete this piece and all its progress? This removes "Etude" (every chunk, session log, and revival history) from this browser, permanently. It can't be undone.`
    );
    assert.equal(c.confirmLabel, "Delete permanently");
  });

  test("signed in with a checked backup it says it is everywhere, and that there is a way back", () => {
    const c = deleteWindowCopy({ name: "Etude", syncs: true });
    assert.equal(
      c.body,
      `Are you sure you want to delete this piece and all its progress? This removes "Etude" (every chunk, session log, and revival history) from this device and from every other device on your account. You can bring it back from Recently deleted in Settings for 30 days, without any practice that was never backed up.`
    );
    assert.equal(c.confirmLabel, "Delete everywhere");
  });

  test("a blank name reads as 'this piece', and nothing here has an em dash", () => {
    assert.match(deleteWindowCopy({ name: "", syncs: false }).body, /removes "this piece"/);
    [true, false].forEach((syncs) => {
      const c = deleteWindowCopy({ name: "X", syncs });
      assert.equal(/—/.test(c.body + c.confirmLabel), false);
    });
    [describeDeletedAgo(ago(DAY), NOW), describeDeletedAgo(ago(5 * DAY), NOW)].forEach((t) => assert.equal(/—/.test(t), false));
  });
});
