// Pass 137 — what a practice card says about time (lib/plannedMinutes.js).
//
// The price on a card is the same price the schedule and the due-reviews list
// already use, rounded to a whole minute. These tests pin the three together, so
// a change to one of them fails here until the others follow, and cover the text
// the card shows and the wall-clock rule the two new timers share. The cards
// themselves have no render harness (see test/session-undo.test.mjs), which is
// why the logic lives in lib/.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EFFORT_TO_MIN } from "../src/lib/constants.js";
import { generateAllChunks, computeSectionRunThroughs } from "../src/lib/chunking.js";
import { computeTimeline } from "../src/lib/scheduling.js";
import { computeDueReviews } from "../src/lib/maintenance.js";
import {
  plannedMinutesFor,
  plannedAboutText,
  plannedSpentText,
  secondsSpentIn,
  elapsedSeconds,
  buildRunThroughSession,
} from "../src/lib/plannedMinutes.js";
import { validateAndMigratePiece } from "../src/lib/storage.js";
import { unionProgressEntries, canonicalPiece, fingerprint } from "../src/lib/pieceMerge.js";
import { sumPracticeSeconds, sumPracticeSecondsSince } from "../src/lib/utils.js";

// Blocks of four measures at difficulty 3, 1, 2, 3, 1, 2: enough hard chunks that
// combos exist, plus easy and medium ones.
const MD = Array.from({ length: 24 }, (_, i) => [3, 1, 2, 3, 1, 2][Math.floor(i / 4)]);
function basePiece(overrides) {
  return {
    id: "p1",
    name: "Test piece",
    totalMeasures: 24,
    measureDifficulty: MD,
    chunkMode: "custom",
    customChunkSize: 4,
    recurringMode: "none",
    recurringMeasures: 0,
    recurringPairs: [],
    practiceDaysPerWeek: 7,
    minutesPerDay: 40,
    scheduleMode: "days",
    daysToLearn: 30,
    startDate: "2026-01-01",
    status: "active",
    progress: {},
    sections: [],
    ...overrides,
  };
}

describe("plannedMinutesFor: the card's price is the schedule's price", () => {
  const piece = basePiece();
  const chunkSet = generateAllChunks(piece);

  test("the fixture really holds every kind of card the pass names (a chunk, a transition, a combo)", () => {
    assert.ok(chunkSet.practiceChunks.length > 0);
    assert.ok(chunkSet.transitions.length > 0);
    assert.ok(chunkSet.combos.length > 0, "the fixture must contain hard chunks, or the combo case below proves nothing");
  });

  test("every chunk, transition and combo reads effort times EFFORT_TO_MIN, rounded", () => {
    for (const c of chunkSet.all) {
      assert.equal(plannedMinutesFor(c), Math.round(c.effort * EFFORT_TO_MIN), `${c.id} (${c.kind})`);
      assert.ok(Number.isInteger(plannedMinutesFor(c)));
    }
  });

  test("it equals the minutes computeDueReviews prices the same chunk at (maintenance.js)", () => {
    const progress = {};
    for (const c of chunkSet.all) {
      progress[c.id] = { doneDays: [1], sessions: [{ day: 1, outcome: "pass", loggedDate: "2026-01-01" }], stage: "stabilizing", nextDueDate: "2026-01-05" };
    }
    const due = computeDueReviews(basePiece({ progress }), chunkSet, "2026-01-10");
    assert.equal(due.length, chunkSet.all.length);
    for (const d of due) assert.equal(plannedMinutesFor(d.chunk), d.minutes, d.chunkId);
  });

  test("it equals what computeTimeline charges a day that holds that one task", () => {
    const timeline = computeTimeline(piece, chunkSet);
    const byId = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));
    let singleItemDays = 0;
    for (const d of timeline.days) {
      if (d.type === "rest" || d.type === "consolidation") continue;
      const ids = [...(d.newChunkIds || []), ...(d.specialChunkIds || []), ...(d.reviewChunkIds || [])];
      // The day's total is the ROUNDED SUM of the unrounded prices.
      const sum = ids.reduce((s, id) => s + byId[id].effort * EFFORT_TO_MIN, 0);
      assert.equal(d.minutes, Math.round(sum), `day ${d.dayNumber}`);
      if (ids.length === 1) {
        singleItemDays += 1;
        assert.equal(d.minutes, plannedMinutesFor(byId[ids[0]]), `day ${d.dayNumber} holds only ${ids[0]}`);
      }
    }
    assert.ok(singleItemDays > 0, "the fixture should have at least one day holding a single task");
  });

  test("a card's rounded price can differ from the day's rounded total (known, chosen with the owner)", () => {
    // Three 2.5-minute tasks: each card says 3, the day says 8 (7.5 rounded), not 9.
    const c = { effort: 1 };
    assert.equal(EFFORT_TO_MIN, 2.5, "this test's arithmetic assumes the current constant");
    assert.equal(plannedMinutesFor(c) * 3, 9);
    assert.equal(Math.round(c.effort * EFFORT_TO_MIN * 3), 8);
  });

  test("a task that has no price today shows none: a section run-through is not invented a price", () => {
    const section = { id: "s1", name: "", start: 1, end: 8 };
    const chunks = [
      { id: "c1", kind: "section", start: 1, end: 4 },
      { id: "c2", kind: "section", start: 5, end: 8 },
    ];
    const sessions = [{ day: 1 }];
    const p = { sections: [section], measureDifficulty: Array(16).fill(1), progress: { c1: { sessions }, c2: { sessions } } };
    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1, "the fixture must produce a real run-through");
    assert.equal(items[0].kind, "section-runthrough");
    assert.equal(items[0].effort, undefined, "if a section run-through ever gets an effort, give it a card estimate and update this test");
    assert.equal(plannedMinutesFor(items[0]), null);
  });

  test("a missing, zero or non-numeric effort gives null, never a made-up number", () => {
    for (const bad of [null, undefined, {}, { effort: 0 }, { effort: -3 }, { effort: "abc" }, { effort: NaN }]) {
      assert.equal(plannedMinutesFor(bad), null);
    }
  });
});

describe("the words on a card", () => {
  test("before logging, beside the timer", () => {
    assert.equal(plannedAboutText(12), "planned about 12 min");
  });

  test("after logging: planned and spent side by side", () => {
    assert.equal(plannedSpentText(12, 15 * 60), "12 min planned, 15 min spent");
    assert.equal(plannedSpentText(12, 15 * 60 + 29), "12 min planned, 15 min spent");
    assert.equal(plannedSpentText(12, 15 * 60 + 30), "12 min planned, 16 min spent");
  });

  test("a short or missing time is stated plainly", () => {
    assert.equal(plannedSpentText(12, 0), "12 min planned");
    assert.equal(plannedSpentText(12, undefined), "12 min planned");
    assert.equal(plannedSpentText(12, 40), "12 min planned, under 1 min spent");
  });

  test("a longer time and a shorter time read the same way: no judging words", () => {
    const judging = /\b(over|late|slow|slower|behind|exceed|exceeded|longer|extra|too|only|just|more than|less than)\b/i;
    for (const seconds of [60, 5 * 60, 12 * 60, 30 * 60, 3 * 3600]) {
      const text = plannedSpentText(12, seconds);
      assert.doesNotMatch(text, judging, text);
      assert.match(text, /^12 min planned, \d+ min spent$/);
    }
  });

  test("the text never carries an em dash", () => {
    for (const t of [plannedAboutText(3), plannedSpentText(3, 0), plannedSpentText(3, 30), plannedSpentText(3, 600)]) assert.ok(!t.includes("—"));
  });
});

describe("secondsSpentIn adds up a card's attempts", () => {
  test("sums the durations, ignoring sessions with none or a bad one", () => {
    const sessions = [{ durationSeconds: 300 }, { durationSeconds: 0 }, {}, { durationSeconds: "abc" }, { durationSeconds: 120.5 }, null, { durationSeconds: -9 }];
    assert.equal(secondsSpentIn(sessions), 420.5);
    assert.equal(secondsSpentIn(undefined), 0);
    assert.equal(secondsSpentIn([]), 0);
  });
});

describe("elapsedSeconds: the wall-clock rule (Pass 72) the timers share", () => {
  test("reads the clock, not a count of ticks: a tab that skipped every tick is still right when it comes back", () => {
    const timer = { startedAt: 1_000_000, baseSeconds: 30 };
    // Ten minutes passed in the background with no tick at all.
    assert.equal(elapsedSeconds(timer, 1_000_000 + 600_000), 630);
  });

  test("starts from the seconds already held (pause and resume, or minutes typed in)", () => {
    assert.equal(elapsedSeconds({ startedAt: 5_000, baseSeconds: 120 }, 5_000), 120);
    assert.equal(elapsedSeconds({ startedAt: 5_000, baseSeconds: 120 }, 5_000 + 45_000), 165);
  });

  test("rounds for the live display and floors for the value saved at a click", () => {
    const timer = { startedAt: 0, baseSeconds: 0 };
    assert.equal(elapsedSeconds(timer, 125_600), 126);
    assert.equal(elapsedSeconds(timer, 125_600, Math.floor), 125);
  });

  test("never negative, and no timer reads as zero", () => {
    assert.equal(elapsedSeconds({ startedAt: 10_000, baseSeconds: 0 }, 5_000), 0);
    assert.equal(elapsedSeconds(null, 5_000), 0);
  });
});

describe("a whole-piece run-through session with and without a duration", () => {
  const base = { day: 30, stopCount: 2, loggedAt: 1_767_000_000_000, loggedDate: "2026-01-30" };
  const without = buildRunThroughSession(base);
  const timed = buildRunThroughSession({ ...base, loggedAt: base.loggedAt + 60_000, durationSeconds: 1084.6 });

  test("with no time it is exactly the session the app wrote before this pass (no new key)", () => {
    assert.deepEqual(without, base);
    for (const none of [undefined, null, 0, -5, "abc", NaN]) {
      const s = buildRunThroughSession({ ...base, durationSeconds: none });
      assert.deepEqual(s, base);
      assert.equal("durationSeconds" in s, false);
    }
  });

  test("with a time it keeps whole seconds beside the stop count", () => {
    assert.equal(timed.durationSeconds, 1085);
    assert.equal(timed.stopCount, 2);
    assert.ok(Number.isInteger(timed.durationSeconds));
  });

  const pieceWith = (sessions) => ({
    id: "p1",
    name: "Test piece",
    totalMeasures: 16,
    measureDifficulty: Array(16).fill(1),
    chunkMode: "custom",
    customChunkSize: 4,
    recurringMode: "none",
    recurringMeasures: 0,
    recurringPairs: [],
    practiceDaysPerWeek: 7,
    minutesPerDay: 30,
    startDate: "2026-01-01",
    daysToLearn: 30,
    scheduleMode: "days",
    status: "active",
    sections: [],
    progress: { __consolidation__: { doneDays: [30], sessions } },
  });

  test("loads and saves the same: a reload keeps both kinds of session untouched, twice over", () => {
    const stored = JSON.parse(JSON.stringify(pieceWith([without, timed])));
    const once = validateAndMigratePiece(stored);
    assert.deepEqual(once.progress.__consolidation__.sessions, [without, timed]);
    const twice = validateAndMigratePiece(JSON.parse(JSON.stringify(once)));
    assert.deepEqual(twice.progress.__consolidation__.sessions, [without, timed]);
    assert.equal(fingerprint(canonicalPiece(once)), fingerprint(canonicalPiece(twice)), "a reloaded piece must not look changed");
  });

  test("a piece with only old sessions has the same fingerprint as before: nothing is materialized", () => {
    const old = validateAndMigratePiece(JSON.parse(JSON.stringify(pieceWith([without]))));
    assert.equal("durationSeconds" in old.progress.__consolidation__.sessions[0], false);
  });

  test("merges the same: two devices that each logged one keep both, whichever side is 'this device'", () => {
    const a = pieceWith([without]).progress.__consolidation__;
    const b = pieceWith([timed]).progress.__consolidation__;
    const ab = unionProgressEntries(a, b);
    const ba = unionProgressEntries(b, a);
    const key = (s) => s.loggedAt;
    assert.deepEqual(ab.sessions.map(key).sort(), [without.loggedAt, timed.loggedAt].sort());
    assert.deepEqual(ba.sessions.map(key).sort(), [without.loggedAt, timed.loggedAt].sort());
    assert.deepEqual(ab.sessions.find((s) => s.loggedAt === timed.loggedAt), timed, "the time survives the merge");
    // The same session on both sides is one session, with or without a time.
    assert.equal(unionProgressEntries(a, a).sessions.length, 1);
    assert.equal(unionProgressEntries(b, b).sessions.length, 1);
  });

  test("time-practiced totals now include the run-through's time, and only from sessions that have one", () => {
    const p = validateAndMigratePiece(JSON.parse(JSON.stringify(pieceWith([without, timed]))));
    assert.equal(sumPracticeSeconds(p), 1085);
    assert.equal(sumPracticeSecondsSince(p, "2026-01-30"), 1085);
    assert.equal(sumPracticeSecondsSince(p, "2026-01-31"), 0);
  });
});
