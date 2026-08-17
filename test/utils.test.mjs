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
  loggedSessions,
  sumPracticeSeconds,
  hasPendingProvisionalSession,
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
