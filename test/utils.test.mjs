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
import { daysBetweenInclusive, elapsedDay, getCurrentDay, todayISODate } from "../src/lib/utils.js";

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
