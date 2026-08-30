// Tests for src/lib/utils.js's day counting — the arithmetic every
// plan-day number in the app is built on.
//
// TZ is pinned to a DST-observing zone on purpose. The bug these guard
// against (a spring-forward day is 23 hours, so flooring the millisecond
// gap between two local midnights undercounts by one) is invisible in UTC,
// so without pinning, a CI machine running UTC would pass either way. See
// docs/Decisions.md#spaced-repetition--maintenance and
// docs/Algorithms.md#detecting-that-a-piece-has-run-past-its-plan.
process.env.TZ = "America/Denver";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetweenInclusive,
  elapsedDay,
  getCurrentDay,
  todayISODate,
  addDaysISO,
  loggedSessions,
  sumPracticeSeconds,
  sumPracticeSecondsSince,
  startOfWeekISO,
  computeCrossPieceConsistency,
  hasPendingProvisionalSession,
  findRelatedChunks,
} from "../src/lib/utils.js";

describe("loggedSessions (Pass 29) — filters out skipped sessions, keeps real ones", () => {
  test("drops sessions with skipped: true", () => {
    const sessions = [
      { day: 1, cleanReps: 4, bpm: 90, outcome: "pass" },
      { day: 2, skipped: true, durationSeconds: 120 },
      { day: 3, cleanReps: 2, bpm: 80, outcome: "soft-miss" },
    ];
    const result = loggedSessions(sessions);
    assert.equal(result.length, 2);
    assert.ok(result.every((s) => !s.skipped));
  });

  test("handles null/undefined/empty without throwing", () => {
    assert.deepEqual(loggedSessions(undefined), []);
    assert.deepEqual(loggedSessions(null), []);
    assert.deepEqual(loggedSessions([]), []);
  });
});

describe("sumPracticeSeconds still counts skipped sessions' time — saving the time was the point", () => {
  test("a skipped session's durationSeconds counts toward total time practiced", () => {
    const piece = {
      progress: {
        c1: { sessions: [{ day: 1, cleanReps: 4, bpm: 90, outcome: "pass", durationSeconds: 60 }] },
        c2: { sessions: [{ day: 1, skipped: true, durationSeconds: 120 }] },
      },
    };
    assert.equal(sumPracticeSeconds(piece), 180, "both the real session's and the skipped session's time count");
  });
});

describe("sumPracticeSecondsSince (Pass 43) — same as sumPracticeSeconds, bounded by loggedDate", () => {
  test("excludes sessions before the cutoff, includes on/after", () => {
    const piece = {
      progress: {
        c1: { sessions: [{ loggedDate: "2026-08-23", durationSeconds: 60 }] },
        c2: { sessions: [{ loggedDate: "2026-08-24", durationSeconds: 90 }] },
        c3: { sessions: [{ loggedDate: "2026-08-26", durationSeconds: 30 }] },
      },
    };
    assert.equal(sumPracticeSecondsSince(piece, "2026-08-24"), 120, "the day-before session is excluded");
  });

  test("a skipped session's time still counts if it's in range — only the date matters here", () => {
    const piece = {
      progress: {
        c1: { sessions: [{ loggedDate: "2026-08-25", skipped: true, durationSeconds: 200 }] },
      },
    };
    assert.equal(sumPracticeSecondsSince(piece, "2026-08-24"), 200);
  });

  test("a session with no loggedDate is excluded rather than assumed in-range", () => {
    const piece = { progress: { c1: { sessions: [{ durationSeconds: 500 }] } } };
    assert.equal(sumPracticeSecondsSince(piece, "2026-08-24"), 0);
  });
});

describe("startOfWeekISO (Pass 43) — the Monday on or before a date", () => {
  test("a mid-week date resolves to that week's Monday", () => {
    assert.equal(startOfWeekISO("2026-08-26"), "2026-08-24", "2026-08-26 is a Wednesday");
  });

  test("Monday itself is unchanged", () => {
    assert.equal(startOfWeekISO("2026-08-24"), "2026-08-24");
  });

  test("Sunday resolves to the Monday six days earlier, not the following week", () => {
    assert.equal(startOfWeekISO("2026-08-30"), "2026-08-24", "2026-08-30 is a Sunday, same week as Aug 24");
  });

  test("[regression] a week spanning the spring-forward DST transition still resolves correctly", () => {
    // 2026-03-08 is a Sunday (the DST transition itself); its Monday is
    // 2026-03-02. addDaysISO's setDate() arithmetic operates on calendar
    // days, not milliseconds, so this should be unaffected by the class of
    // bug daysBetweenInclusive had — pinned here so a future rewrite that
    // reintroduces millisecond math gets caught.
    assert.equal(startOfWeekISO("2026-03-08"), "2026-03-02");
  });
});

describe("computeCrossPieceConsistency (Pass 43) — touching ANY piece counts as that day being practiced", () => {
  // Anchored to todayISODate()/addDaysISO rather than a literal date string,
  // so this doesn't quietly start failing the day after it's written — see
  // docs/AI-GUIDELINES.md's note on deriving expected values from the same
  // primitives the code under test uses, not a second hand-typed date.
  const targetDate = addDaysISO(todayISODate(), -2);

  test("a session on one piece marks the day touched even if no other piece was touched that day", () => {
    const pieceA = { progress: { c1: { sessions: [{ day: 1, loggedDate: targetDate, cleanReps: 3, bpm: 90, outcome: "pass" }] } } };
    const pieceB = { progress: {} };
    const days = computeCrossPieceConsistency([pieceA, pieceB], 5);
    const found = days.find((d) => d.date === targetDate);
    assert.ok(found, "targetDate should be within a 5-day window ending today");
    assert.equal(found.touched, true);
  });

  test("a skipped session does not count as touched, same rule as the per-piece heatmap", () => {
    const piece = { progress: { c1: { sessions: [{ day: 1, loggedDate: targetDate, skipped: true, durationSeconds: 60 }] } } };
    const days = computeCrossPieceConsistency([piece], 5);
    assert.equal(days.find((d) => d.date === targetDate).touched, false);
  });

  test("returns exactly windowDays entries, contiguous, ending on today", () => {
    const days = computeCrossPieceConsistency([], 5);
    assert.equal(days.length, 5);
    assert.equal(days[days.length - 1].date, todayISODate());
    assert.equal(days[0].date, addDaysISO(todayISODate(), -4));
  });

  test("handles empty/null pieces without throwing", () => {
    assert.doesNotThrow(() => computeCrossPieceConsistency([], 3));
    assert.doesNotThrow(() => computeCrossPieceConsistency(null, 3));
  });
});

describe("hasPendingProvisionalSession — the 'leave Interleaved with an unresolved log' warning check", () => {
  test("true when a session on the given day is still provisional", () => {
    const entry = { sessions: [{ day: 5, cleanReps: 1, bpm: 80, outcome: "soft-miss", provisional: true }] };
    assert.equal(hasPendingProvisionalSession(entry, 5), true);
  });

  test("false once that session has been confirmed (provisional: false)", () => {
    const entry = { sessions: [{ day: 5, cleanReps: 1, bpm: 80, outcome: "soft-miss", provisional: false }] };
    assert.equal(hasPendingProvisionalSession(entry, 5), false);
  });

  test("false for a normal, never-provisional session", () => {
    const entry = { sessions: [{ day: 5, cleanReps: 4, bpm: 90, outcome: "pass" }] };
    assert.equal(hasPendingProvisionalSession(entry, 5), false);
  });

  test("false for a skipped session (no provisional flag at all)", () => {
    const entry = { sessions: [{ day: 5, skipped: true, durationSeconds: 60 }] };
    assert.equal(hasPendingProvisionalSession(entry, 5), false);
  });

  test("only matches the specified day — a pending provisional from a different day doesn't count", () => {
    const entry = { sessions: [{ day: 3, cleanReps: 1, bpm: 80, outcome: "soft-miss", provisional: true }] };
    assert.equal(hasPendingProvisionalSession(entry, 5), false);
  });

  test("true if ANY session on that day is provisional, even alongside other resolved ones", () => {
    const entry = {
      sessions: [
        { day: 5, cleanReps: 4, bpm: 90, outcome: "pass" },
        { day: 5, cleanReps: 1, bpm: 70, outcome: "fail", provisional: true },
      ],
    };
    assert.equal(hasPendingProvisionalSession(entry, 5), true);
  });

  test("handles a missing/null entry or missing sessions without throwing", () => {
    assert.equal(hasPendingProvisionalSession(null, 5), false);
    assert.equal(hasPendingProvisionalSession(undefined, 5), false);
    assert.equal(hasPendingProvisionalSession({}, 5), false);
  });
});

describe("[regression] day counting must not undercount across a DST boundary", () => {
  // Hand-counted from a calendar: 2026-02-01 through 2026-08-11 inclusive is
  // 192 days (28 + 31 + 30 + 31 + 30 + 31 + 11 = 192, counting Feb 1 itself).
  // The old Math.floor arithmetic returned 191 in any DST-observing zone,
  // because the span crosses one spring-forward and loses an hour.
  test("a span crossing the spring transition counts every day", () => {
    assert.equal(daysBetweenInclusive("2026-02-01", "2026-08-11"), 192);
  });

  test("a longer span crossing a transition also counts correctly", () => {
    // 2025-12-01 through 2026-08-11 inclusive = 254 days. Old code: 253.
    assert.equal(daysBetweenInclusive("2025-12-01", "2026-08-11"), 254);
  });

  test("a span with no transition in it is unaffected (guards against over-correcting)", () => {
    // 2026-04-01 through 2026-08-11 inclusive = 133 days. Both the old and
    // new arithmetic agree here — asserted so a future 'fix' that shifts
    // every span by one gets caught rather than looking like an improvement.
    assert.equal(daysBetweenInclusive("2026-04-01", "2026-08-11"), 133);
  });

  test("a span that crosses both transitions nets out to the plain calendar count", () => {
    // 2025-11-01 through 2026-11-01: the fall-back hour gained and the
    // spring-forward hour lost cancel, so this was never skewed — included
    // so the cancelling case stays pinned too. 2026 is not a leap year.
    assert.equal(daysBetweenInclusive("2025-11-01", "2026-11-01"), 366);
  });
});

describe("[regression] elapsedDay and getCurrentDay must share one counting implementation", () => {
  // The real defect was not the rounding on its own — it was that
  // getCurrentDay counted one way while computeTimeline's Tier 2 placement
  // counted another (via daysBetweenInclusive), so the two disagreed by a
  // day and a due review was placed permanently out of reach. These pin the
  // agreement rather than any particular arithmetic, so they keep holding
  // if the counting is ever deliberately changed — as long as it's changed
  // in one place.
  const startDates = ["2026-02-01", "2026-04-01", "2025-12-01", "2025-06-15"];

  for (const startDate of startDates) {
    test(`elapsedDay matches daysBetweenInclusive for a piece started ${startDate}`, () => {
      assert.equal(
        elapsedDay({ startDate }),
        daysBetweenInclusive(startDate, todayISODate()),
        "elapsedDay must not do its own date arithmetic"
      );
    });
  }

  test("getCurrentDay is elapsedDay clamped to the plan length", () => {
    const piece = { startDate: "2026-02-01" };
    const elapsed = elapsedDay(piece);
    assert.equal(getCurrentDay(piece, elapsed + 10), elapsed, "below the cap, it reports the elapsed day unchanged");
    assert.equal(getCurrentDay(piece, 5), 5, "above the cap, it clamps to the plan length");
  });

  test("a piece whose startDate is in the future reads as day 1, never zero or negative", () => {
    const future = { startDate: "2099-01-01" };
    assert.equal(elapsedDay(future), 1);
    assert.equal(getCurrentDay(future, 30), 1);
  });
});

describe("findRelatedChunks (Pass 50) — findComboUnderlyingChunks (lib/revival.js) run in reverse", () => {
  // Same measure layout as lib/revival.js's own findComboUnderlyingChunks
  // fixture (test/revival.test.mjs), plus a transition, for direct
  // comparability: c1(1-4), c5(5-8, hard anchor), c9(9-12); combo spans
  // midpoint-to-midpoint (3-10); a transition between c1 and c5 spans 3-6.
  const c1 = { id: "c1", kind: "section", start: 1, end: 4 };
  const c5 = { id: "c5", kind: "section", start: 5, end: 8 };
  const c9 = { id: "c9", kind: "section", start: 9, end: 12 };
  const combo = { id: "x_c5", kind: "combo", start: 3, end: 10 };
  const transition = { id: "t_c1_c5", kind: "transition", start: 3, end: 6 };
  const allChunks = [c1, c5, c9, combo, transition];

  test("from a base chunk, finds the transition/combo touching it, not other base chunks", () => {
    const related = findRelatedChunks(c1, allChunks).map((c) => c.id).sort();
    assert.deepEqual(related, ["t_c1_c5", "x_c5"], "c1 doesn't overlap c5 or c9 — only the transition and combo reaching back into it");
  });

  test("excludes a chunk truly outside its range", () => {
    const farChunk = { id: "c99", start: 50, end: 54 };
    const related = findRelatedChunks(c1, [...allChunks, farChunk]);
    assert.ok(!related.some((c) => c.id === "c99"));
  });

  test("never includes the pivot chunk itself", () => {
    const related = findRelatedChunks(c5, allChunks);
    assert.ok(!related.some((c) => c.id === "c5"));
  });

  test("run in reverse — from the combo, finds every base chunk it underlies (matches findComboUnderlyingChunks)", () => {
    const related = findRelatedChunks(combo, allChunks).map((c) => c.id).sort();
    assert.deepEqual(related, ["c1", "c5", "c9", "t_c1_c5"], "the combo overlaps all three base chunks and the transition");
  });

  test("run from a transition, finds its two flanking base chunks (and the combo, since it also spans this range)", () => {
    const related = findRelatedChunks(transition, allChunks).map((c) => c.id).sort();
    assert.deepEqual(related, ["c1", "c5", "x_c5"]);
  });

  test("results are sorted by start measure ascending", () => {
    const related = findRelatedChunks(combo, allChunks);
    const starts = related.map((c) => c.start);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  });
});
