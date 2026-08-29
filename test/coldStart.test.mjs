// Tests for Pass 56 — the Cold-Start check: a whole-piece cold
// play-through offered once every section's run-through has been logged
// at least once, then re-offered at a widening gap (3, 7, 14, 28, ...
// days) since the piece was last touched. See
// docs/Algorithms.md#cold-start-check for the design.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  coldStartGateMet,
  highestColdStartThreshold,
  coldStartDueThreshold,
  applyColdStartLog,
  applyColdStartUnlog,
} from "../src/lib/coldStart.js";
import { addDaysISO, todayISODate } from "../src/lib/utils.js";

const srSessions = (n) => Array.from({ length: n }, (_, i) => ({ day: i + 1 }));

function piece({ sections, progress = {}, lastLoggedAt = null }) {
  return { sections, progress, lastLoggedAt };
}

describe("coldStartGateMet — every section's run-through must have >= 1 session", () => {
  const sections = [
    { id: "s1", name: "", start: 1, end: 8 },
    { id: "s2", name: "", start: 9, end: 16 },
  ];

  test("false when no section run-through has ever been logged", () => {
    const p = piece({ sections, progress: {} });
    assert.equal(coldStartGateMet(p), false);
  });

  test("false when only SOME sections have a logged run-through, not all", () => {
    const p = piece({ sections, progress: { sr_s1: { sessions: srSessions(1) } } }); // s2 untouched
    assert.equal(coldStartGateMet(p), false);
  });

  test("[regression] a piece with one section never run through does not qualify, regardless of how much history the other section has", () => {
    // s1 has 9 logged run-throughs; s2 has zero. If the gate accidentally
    // checked "at least one section done" or averaged across sections
    // instead of requiring every one, this would wrongly pass.
    const p = piece({ sections, progress: { sr_s1: { sessions: srSessions(9) } } });
    assert.equal(coldStartGateMet(p), false);
  });

  test("true once every section has at least one logged run-through", () => {
    const p = piece({
      sections,
      progress: { sr_s1: { sessions: srSessions(1) }, sr_s2: { sessions: srSessions(3) } },
    });
    assert.equal(coldStartGateMet(p), true);
  });

  test("a single-section piece qualifies off that one section alone", () => {
    const p = piece({ sections: [sections[0]], progress: { sr_s1: { sessions: srSessions(1) } } });
    assert.equal(coldStartGateMet(p), true);
  });

  test("no sections at all does not qualify (defensive — not reachable through the normal editor)", () => {
    const p = piece({ sections: [], progress: {} });
    assert.equal(coldStartGateMet(p), false);
  });

  test("an unrelated progress key (a real chunk id, or __consolidation__) doesn't satisfy the gate", () => {
    const p = piece({
      sections,
      progress: { c1: { sessions: srSessions(5) }, __consolidation__: { sessions: srSessions(5) } },
    });
    assert.equal(coldStartGateMet(p), false);
  });
});

describe("highestColdStartThreshold — the escalation sequence itself", () => {
  test("null below the first threshold (3)", () => {
    [null, 0, 1, 2].forEach((n) => assert.equal(highestColdStartThreshold(n), null));
  });

  test("3, 7, 14, then doubling forever — boundaries land on the lower threshold, not the upper one", () => {
    assert.equal(highestColdStartThreshold(3), 3);
    assert.equal(highestColdStartThreshold(6), 3);
    assert.equal(highestColdStartThreshold(7), 7);
    assert.equal(highestColdStartThreshold(13), 7);
    assert.equal(highestColdStartThreshold(14), 14);
    assert.equal(highestColdStartThreshold(27), 14);
    assert.equal(highestColdStartThreshold(28), 28);
    assert.equal(highestColdStartThreshold(55), 28);
    assert.equal(highestColdStartThreshold(56), 56);
    assert.equal(highestColdStartThreshold(111), 56);
    assert.equal(highestColdStartThreshold(112), 112);
  });
});

describe("coldStartDueThreshold — gate + escalating prompt, combined", () => {
  const sections = [{ id: "s1", name: "", start: 1, end: 8 }];
  const gateMetProgress = { sr_s1: { sessions: srSessions(1) } };

  test("null when the gate isn't met, no matter how many days have elapsed", () => {
    const p = piece({ sections, progress: {}, lastLoggedAt: addDaysISO(todayISODate(), -100) });
    assert.equal(coldStartDueThreshold(p), null);
  });

  test("null with no lastLoggedAt at all, even if the gate is met", () => {
    const p = piece({ sections, progress: gateMetProgress, lastLoggedAt: null });
    assert.equal(coldStartDueThreshold(p), null);
  });

  test("null before the first threshold (gap < 3 days)", () => {
    [0, 1, 2].forEach((n) => {
      const p = piece({ sections, progress: gateMetProgress, lastLoggedAt: addDaysISO(todayISODate(), -n) });
      assert.equal(coldStartDueThreshold(p), null, `gap of ${n} days should not be due yet`);
    });
  });

  test("fires at 3, then again at 7 — quiet every day in between, not a daily re-fire", () => {
    const base = { sections, progress: gateMetProgress };
    assert.equal(coldStartDueThreshold({ ...base, lastLoggedAt: addDaysISO(todayISODate(), -3) }), 3);
    [4, 5, 6].forEach((n) => {
      const p = { ...base, lastLoggedAt: addDaysISO(todayISODate(), -n) };
      assert.equal(coldStartDueThreshold(p), null, `day ${n} (still under the 7-day threshold) must stay quiet`);
    });
    assert.equal(coldStartDueThreshold({ ...base, lastLoggedAt: addDaysISO(todayISODate(), -7) }), 7);
  });

  test("continues escalating at 14, quiet in between 7 and 14 too", () => {
    const base = { sections, progress: gateMetProgress };
    [8, 9, 10, 11, 12, 13].forEach((n) => {
      const p = { ...base, lastLoggedAt: addDaysISO(todayISODate(), -n) };
      assert.equal(coldStartDueThreshold(p), null, `day ${n} must stay quiet`);
    });
    assert.equal(coldStartDueThreshold({ ...base, lastLoggedAt: addDaysISO(todayISODate(), -14) }), 14);
  });

  test("[regression] logging any new session resets the prompt-tracking state — a fresh 3-day gap fires again even though an earlier gap cycle had already escalated well past it", () => {
    // This function carries no memory of "the highest threshold already
    // shown" across gap cycles — it's a live derivation off
    // piece.lastLoggedAt alone. Simulate the "already escalated to 14"
    // piece first, on its actual firing day (14 days since logged; day 20
    // would be a quiet in-between day and wouldn't prove anything) —
    // proving the old cycle really would have fired at a higher
    // threshold...
    const base = { sections, progress: gateMetProgress };
    assert.equal(coldStartDueThreshold({ ...base, lastLoggedAt: addDaysISO(todayISODate(), -14) }), 14);
    // ...then simulate that same piece right after a brand new session was
    // finally logged (lastLoggedAt jumps forward to a 3-day-old gap). If
    // "already shown" state had leaked across the reset, 3 would be
    // wrongly suppressed by memory of the prior cycle's higher threshold.
    assert.equal(coldStartDueThreshold({ ...base, lastLoggedAt: addDaysISO(todayISODate(), -3) }), 3);
  });
});

describe("applyColdStartLog", () => {
  test("persists avgBpm/notes/gapDays, stamps lastLoggedAt, and appends rather than overwrites", () => {
    const p = {
      lastLoggedAt: addDaysISO(todayISODate(), -5),
      progress: {},
    };
    const result = applyColdStartLog(p, 40, 96, "a bit shaky in the coda");
    assert.equal(result.lastLoggedAt, todayISODate());
    const sessions = result.progress["__cold_start__"].sessions;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].day, 40);
    assert.equal(sessions[0].avgBpm, 96);
    assert.equal(sessions[0].notes, "a bit shaky in the coda");
    assert.equal(sessions[0].gapDays, 5);
    assert.equal(sessions[0].loggedDate, todayISODate());
    assert.equal(typeof sessions[0].loggedAt, "number");
  });

  test("gapDays is 0 when the piece has never been logged before (lastLoggedAt null)", () => {
    const p = { lastLoggedAt: null, progress: {} };
    const result = applyColdStartLog(p, 1, 100, "");
    assert.equal(result.progress["__cold_start__"].sessions[0].gapDays, 0);
  });

  test("[regression] does not touch __consolidation__'s existing sessions", () => {
    const consolidationEntry = {
      doneDays: [3],
      sessions: [{ day: 3, stopCount: 2, loggedAt: 12345, loggedDate: "2026-01-01" }],
    };
    const p = {
      lastLoggedAt: addDaysISO(todayISODate(), -5),
      progress: { __consolidation__: consolidationEntry },
    };
    const result = applyColdStartLog(p, 10, 88, "felt solid");
    assert.deepEqual(result.progress["__consolidation__"], consolidationEntry);
    assert.ok(result.progress["__cold_start__"], "a separate __cold_start__ key must exist");
    assert.notEqual(result.progress["__cold_start__"], result.progress["__consolidation__"]);
  });

  test("multiple logs append, each with their own gapDays relative to the piece's lastLoggedAt at that moment", () => {
    let p = { lastLoggedAt: null, progress: {} };
    const first = applyColdStartLog(p, 1, 100, "first");
    p = { ...p, ...first };
    const second = applyColdStartLog(p, 2, 110, "second");
    assert.equal(second.progress["__cold_start__"].sessions.length, 2);
    assert.equal(second.progress["__cold_start__"].sessions[0].notes, "first");
    assert.equal(second.progress["__cold_start__"].sessions[1].notes, "second");
  });
});

describe("applyColdStartUnlog", () => {
  test("removes only the most recently logged session", () => {
    const p = {
      progress: {
        __cold_start__: {
          sessions: [
            { day: 1, avgBpm: 90, notes: "" },
            { day: 5, avgBpm: 100, notes: "" },
          ],
        },
      },
    };
    const result = applyColdStartUnlog(p);
    assert.equal(result.progress["__cold_start__"].sessions.length, 1);
    assert.equal(result.progress["__cold_start__"].sessions[0].avgBpm, 90);
  });

  test("returns null (a no-op signal) when nothing has ever been logged", () => {
    assert.equal(applyColdStartUnlog({ progress: {} }), null);
  });

  test("returns null when the entry exists but its sessions array is already empty", () => {
    assert.equal(applyColdStartUnlog({ progress: { __cold_start__: { sessions: [] } } }), null);
  });
});
