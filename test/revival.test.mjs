// Tests for revival's combo escalation (src/lib/revival.js). This logic
// went through three rounds of bug fixes after it first shipped — see
// docs/Decisions.md#spaced-repetition--maintenance — so the regression
// cases below are as important as the "happy path" ones.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeComboEscalations, findComboUnderlyingChunks, computeRevivalTriggers, isInRevival, getRevivalTargetBPM } from "../src/lib/revival.js";
import { computeDueReviews } from "../src/lib/maintenance.js";
import { addDaysISO, todayISODate } from "../src/lib/utils.js";

// chunks c1(1-4), c5(5-8, hard, the anchor), c9(9-12) — combo spans
// midpoint-to-midpoint: start=ceil((1+4)/2)=3, end=floor((9+12)/2)=10.
const practiceChunks = [
  { id: "c1", kind: "section", start: 1, end: 4, difficultyLabel: "easy" },
  { id: "c5", kind: "section", start: 5, end: 8, difficultyLabel: "hard" },
  { id: "c9", kind: "section", start: 9, end: 12, difficultyLabel: "easy" },
];
const combo = { id: "x_c5", kind: "combo", start: 3, end: 10, difficultyLabel: "medium", linkedIds: ["c5"] };
const chunkSet = { practiceChunks, combos: [combo] };
const REVIVAL_START = 1_000_000;

describe("findComboUnderlyingChunks", () => {
  test("finds the anchor and both overlapping neighbors", () => {
    const underlying = findComboUnderlyingChunks(combo, practiceChunks).map((c) => c.id).sort();
    assert.deepEqual(underlying, ["c1", "c5", "c9"]);
  });

  test("excludes a chunk truly outside the combo's range", () => {
    const farChunk = { id: "c99", start: 50, end: 54 };
    const underlying = findComboUnderlyingChunks(combo, [...practiceChunks, farChunk]);
    assert.ok(!underlying.some((c) => c.id === "c99"));
  });
});

describe("computeComboEscalations — basic trigger/clear", () => {
  test("clean relearn (zero fails anywhere) never escalates the combo", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: {
        c1: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "pass" }] },
        c9: { sessions: [{ loggedAt: REVIVAL_START + 300, outcome: "pass" }] },
      },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet), []);
  });

  test("a real fail on the anchor chunk escalates the combo", () => {
    const piece = { revival: { startedAt: REVIVAL_START }, progress: { c5: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] } } };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"]);
  });

  test("a real fail on an overlapping neighbor (not the anchor) also escalates it", () => {
    const piece = { revival: { startedAt: REVIVAL_START }, progress: { c9: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] } } };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"]);
  });

  test("a fail logged BEFORE this revival run started does not count", () => {
    const piece = { revival: { startedAt: REVIVAL_START }, progress: { c1: { sessions: [{ loggedAt: REVIVAL_START - 500, outcome: "fail" }] } } };
    assert.deepEqual(computeComboEscalations(piece, chunkSet), []);
  });

  test("a fail on a chunk NOT overlapping the combo does not escalate it", () => {
    const farChunk = { id: "c99", start: 50, end: 54, difficultyLabel: "easy" };
    const localChunkSet = { practiceChunks: [...practiceChunks, farChunk], combos: [combo] };
    const piece = { revival: { startedAt: REVIVAL_START }, progress: { c99: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] } } };
    assert.deepEqual(computeComboEscalations(piece, localChunkSet), []);
  });

  test("a soft-miss alone (not a real fail) does not escalate the combo", () => {
    const piece = { revival: { startedAt: REVIVAL_START }, progress: { c5: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "soft-miss" }] } } };
    assert.deepEqual(computeComboEscalations(piece, chunkSet), []);
  });

  test("no revival.startedAt at all (defensive) returns no escalations rather than throwing", () => {
    const piece = { revival: {}, progress: { c5: { sessions: [{ loggedAt: 100, outcome: "fail" }] } } };
    assert.deepEqual(computeComboEscalations(piece, chunkSet), []);
  });

  test("old sessions with only `effectiveness` (pre-outcome-model) are still read via the legacy fallback", () => {
    const piece = { revival: { startedAt: REVIVAL_START }, progress: { c1: { sessions: [{ loggedAt: REVIVAL_START + 100, effectiveness: "low" }] } } };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"], "effectiveness 'low' maps to 'fail'");
  });
});

describe("[regression, fix round 1] a fail can be superseded by a later pass on the SAME chunk", () => {
  test("fail then later pass on the same chunk clears the escalation", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: { c1: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }, { loggedAt: REVIVAL_START + 200, outcome: "pass" }] } },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet), []);
  });

  test("pass then later fail on the same chunk still escalates (order matters, not just presence)", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: { c1: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "pass" }, { loggedAt: REVIVAL_START + 200, outcome: "fail" }] } },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"]);
  });
});

describe("[regression, fix round 2] the escalated task's own session (logged under combo.id) counts", () => {
  test("a successful recovery attempt logged on the COMBO itself clears an underlying chunk's fail", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: {
        c1: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] },
        x_c5: { sessions: [{ loggedAt: REVIVAL_START + 200, outcome: "pass" }] },
      },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet), []);
  });

  test("a fail logged on the combo itself escalates, even if no underlying chunk ever failed", () => {
    const piece = { revival: { startedAt: REVIVAL_START }, progress: { x_c5: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] } } };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"]);
  });
});

describe("[regression, fix round 3] per-chunk independence — one chunk's fix can't mask another's failure", () => {
  test("chunk A fails, then a DIFFERENT chunk B passes later — B's pass must NOT mask A's still-standing fail", () => {
    // The bug: an earlier version pooled every underlying chunk's sessions
    // with the combo's own into one list and picked the single overall
    // newest — so B's unrelated pass silently cleared A's failure.
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: {
        c1: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] }, // never retried
        c9: { sessions: [{ loggedAt: REVIVAL_START + 200, outcome: "pass" }] }, // unrelated, later
      },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"], "c1's fail must still escalate despite c9's later, unrelated pass");
  });

  test("all underlying chunks individually passing (in any relative order) clears the escalation", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: {
        c1: { sessions: [{ loggedAt: REVIVAL_START + 300, outcome: "pass" }] },
        c5: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "pass" }] },
        c9: { sessions: [{ loggedAt: REVIVAL_START + 200, outcome: "pass" }] },
      },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet), []);
  });

  test("a combo-task pass that PREDATES an underlying chunk's fail does not clear it", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: {
        x_c5: { sessions: [{ loggedAt: REVIVAL_START + 50, outcome: "pass" }] },
        c1: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] },
      },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"], "the earlier combo pass predates c1's fail");
  });

  test("a combo-task pass only clears escalation if it postdates the WORST (most recent) of multiple failing chunks", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: {
        c1: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "fail" }] },
        c9: { sessions: [{ loggedAt: REVIVAL_START + 300, outcome: "fail" }] }, // the more recent failure
        x_c5: { sessions: [{ loggedAt: REVIVAL_START + 200, outcome: "pass" }] }, // after c1's fail, before c9's
      },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"], "the combo pass is stale relative to c9's later fail");
  });

  test("a pass on the combo task, followed later by a fresh fail on an underlying chunk, re-escalates", () => {
    const piece = {
      revival: { startedAt: REVIVAL_START },
      progress: {
        x_c5: { sessions: [{ loggedAt: REVIVAL_START + 100, outcome: "pass" }] },
        c9: { sessions: [{ loggedAt: REVIVAL_START + 200, outcome: "fail" }] },
      },
    };
    assert.deepEqual(computeComboEscalations(piece, chunkSet).map((c) => c.id), ["x_c5"]);
  });
});

// computeRevivalTriggers (Pass 7) — the three independent auto-trigger
// conditions from docs/Repertoire-Lifecycle.md#revival-auto-triggers /
// docs/Decisions.md#spaced-repetition--maintenance. Condition 3 reads real
// calendar dates (todayISODate/addDaysISO), not the REVIVAL_START epoch
// numbers the combo-escalation tests above use, since it has nothing to do
// with an active revival run.
describe("computeRevivalTriggers", () => {
  // planComplete=true throughout this outer describe block (except the
  // dedicated gating block below) — every one of the three conditions now
  // requires it, so exercising each condition's own threshold logic needs
  // the gate held open, or every test would just be re-testing the gate.
  test("nothing logged, nothing flagged, no lastLoggedAt: no trigger fires", () => {
    const piece = { progress: {} };
    assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
  });

  test("[regression] piece.progress itself missing (not just empty) does not throw, on any condition", () => {
    const piece = {};
    assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
  });

  describe("condition 1 — stop count > 5 on a single logged run-through", () => {
    test("a stop count of 6 triggers", () => {
      const piece = { progress: { __consolidation__: { sessions: [{ day: 1, stopCount: 6 }] } } };
      const result = computeRevivalTriggers(piece, chunkSet, true);
      assert.equal(result.triggered, true);
      assert.deepEqual(result.reasons.map((r) => r.key), ["stopCount"]);
    });

    test("a stop count of exactly 5 does not trigger — the condition is strictly greater than 5", () => {
      const piece = { progress: { __consolidation__: { sessions: [{ day: 1, stopCount: 5 }] } } };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });

    test("across multiple run-throughs, only one needs to exceed 5", () => {
      const piece = {
        progress: { __consolidation__: { sessions: [{ day: 1, stopCount: 1 }, { day: 2, stopCount: 9 }] } },
      };
      assert.equal(computeRevivalTriggers(piece, chunkSet, true).triggered, true);
    });

    test("no __consolidation__ entry at all does not throw and does not trigger", () => {
      const piece = { progress: { c1: { sessions: [] } } };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });
  });

  describe("condition 2 — a combo, or 2+ regular practice chunks, currently flagged lost", () => {
    test("a combo-kind chunk flagged lost triggers on its own", () => {
      const piece = { progress: { x_c5: { flag: "lost" } } };
      const result = computeRevivalTriggers(piece, chunkSet, true);
      assert.deepEqual(result.reasons.map((r) => r.key), ["largeChunksLost"]);
    });

    test("2 regular practice chunks flagged lost triggers", () => {
      const piece = { progress: { c1: { flag: "lost" }, c5: { flag: "lost" } } };
      assert.equal(computeRevivalTriggers(piece, chunkSet, true).triggered, true);
    });

    test("only 1 practice chunk flagged lost does not trigger — the threshold is 2+", () => {
      const piece = { progress: { c1: { flag: "lost" } } };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });

    test("chunks flagged 'rough' (not 'lost') never count toward this condition, even 2+ of them", () => {
      const piece = { progress: { c1: { flag: "rough" }, c5: { flag: "rough" }, x_c5: { flag: "rough" } } };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });

    test("a transition flagged lost does not count — only practiceChunks/combos are 'regular'/'large' chunks, not transitions", () => {
      const piece = { progress: { t_c1_c5: { flag: "lost" } } };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });
  });

  describe("condition 3 — 60+ days since anything was logged on the piece at all", () => {
    test("lastLoggedAt exactly 60 days ago triggers", () => {
      const piece = { progress: {}, lastLoggedAt: addDaysISO(todayISODate(), -60) };
      const result = computeRevivalTriggers(piece, chunkSet, true);
      assert.deepEqual(result.reasons.map((r) => r.key), ["staleness"]);
      assert.equal(result.reasons[0].label, "It's been 60 days since anything was logged");
    });

    test("lastLoggedAt 59 days ago does not trigger — the threshold is 60+", () => {
      const piece = { progress: {}, lastLoggedAt: addDaysISO(todayISODate(), -59) };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });

    test("lastLoggedAt today does not trigger", () => {
      const piece = { progress: {}, lastLoggedAt: todayISODate() };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });

    test("lastLoggedAt null (never logged at all) does NOT trigger — this is a distinct fallback for a piece with real but old activity, not a catch-all for zero data", () => {
      const piece = { progress: {}, lastLoggedAt: null };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, true), { triggered: false, reasons: [] });
    });
  });

  describe("planComplete gating — applies to all three conditions, not just staleness", () => {
    // Added alongside computeAbandonedPlanReminder (lib/scheduling.js):
    // revival is "a piece you've already learned that's gone stale, gone
    // rough, or lost a chunk," so none of the three conditions should fire
    // for a piece still mid-learning — a still-unfinished piece going
    // quiet, having a rough run-through, or losing a chunk is
    // computeAbandonedPlanReminder's question instead (for the staleness
    // case) or simply not surfaced as a revival prompt at all (for the
    // other two), rather than suggesting a workflow ("revival") that's
    // explicitly for a piece already learned once.
    const allThreeConditionsData = {
      progress: {
        __consolidation__: { sessions: [{ day: 1, stopCount: 8 }] },
        c1: { flag: "lost" },
        c5: { flag: "lost" },
      },
      lastLoggedAt: addDaysISO(todayISODate(), -100),
    };

    test("planComplete=false suppresses all three conditions at once, even when every one of them has qualifying data", () => {
      const result = computeRevivalTriggers(allThreeConditionsData, chunkSet, false);
      assert.deepEqual(result, { triggered: false, reasons: [] });
    });

    test("omitting the planComplete argument entirely also suppresses everything (falsy default, not an opt-out)", () => {
      const result = computeRevivalTriggers(allThreeConditionsData, chunkSet);
      assert.deepEqual(result, { triggered: false, reasons: [] });
    });

    test("the same data triggers all three reasons once planComplete is true", () => {
      const result = computeRevivalTriggers(allThreeConditionsData, chunkSet, true);
      assert.equal(result.triggered, true);
      assert.deepEqual(result.reasons.map((r) => r.key).sort(), ["largeChunksLost", "staleness", "stopCount"]);
    });

    test("a lone stopCount reason is also suppressed by planComplete=false, not just staleness/largeChunksLost", () => {
      const piece = { progress: { __consolidation__: { sessions: [{ day: 1, stopCount: 8 }] } } };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, false), { triggered: false, reasons: [] });
    });

    test("a lone largeChunksLost reason is also suppressed by planComplete=false", () => {
      const piece = { progress: { x_c5: { flag: "lost" } } };
      assert.deepEqual(computeRevivalTriggers(piece, chunkSet, false), { triggered: false, reasons: [] });
    });
  });

  test("multiple independent conditions firing at once each produce their own reason, not just the first match", () => {
    const piece = {
      progress: {
        __consolidation__: { sessions: [{ day: 1, stopCount: 8 }] },
        c1: { flag: "lost" },
        c5: { flag: "lost" },
      },
      lastLoggedAt: addDaysISO(todayISODate(), -100),
    };
    const result = computeRevivalTriggers(piece, chunkSet, true);
    assert.equal(result.triggered, true);
    assert.deepEqual(result.reasons.map((r) => r.key).sort(), ["largeChunksLost", "staleness", "stopCount"]);
  });
});

// isInRevival — the single source of truth for "is this piece currently in
// revival?". Before this existed, the same rule was written twice in two
// shapes: most of the UI checked `revival.active`, while computeDueReviews
// and TodayTab checked `revival.startedAt`. Both fields are set and cleared
// together by handleStartRevival/handleEndRevival, so the two could never
// disagree through any path the app itself takes — this was a consistency
// fix, not a live bug. These tests exist so it stays that way.
describe("isInRevival — one definition of 'in revival'", () => {
  test("a piece mid-revival (both fields set, as the app always sets them) is in revival", () => {
    assert.equal(isInRevival({ revival: { active: true, startedAt: REVIVAL_START } }), true);
  });

  test("a piece whose revival was ended (both cleared, as handleEndRevival clears them) is not", () => {
    assert.equal(isInRevival({ revival: { active: false, startedAt: null } }), false);
  });

  test("a piece that has never had a revival is not", () => {
    assert.equal(isInRevival({ revival: {} }), false);
  });

  test("missing revival object entirely (pre-revival saved data) is not — and does not throw", () => {
    assert.equal(isInRevival({}), false);
  });

  test("null/undefined piece is not — and does not throw", () => {
    assert.equal(isInRevival(null), false);
    assert.equal(isInRevival(undefined), false);
  });

  test("always returns a real boolean, never a truthy object or undefined", () => {
    assert.strictEqual(isInRevival({ revival: { active: true } }), true);
    assert.strictEqual(isInRevival({}), false);
  });

  // The drift this consolidation exists to prevent: maintenance suppression
  // and the rest of the app must agree on whether a piece is in revival.
  test("[regression] computeDueReviews agrees with isInRevival — maintenance is suppressed for exactly the pieces isInRevival reports", () => {
    const dueChunkSet = { all: [{ id: "c1", kind: "section", start: 1, end: 4, effort: 1 }] };
    const progress = { c1: { nextDueDate: "2026-01-01" } };

    const inRevival = { status: "active", revival: { active: true, startedAt: REVIVAL_START }, progress };
    assert.equal(isInRevival(inRevival), true);
    assert.deepEqual(computeDueReviews(inRevival, dueChunkSet, "2026-01-20"), [], "suppressed while in revival");

    const notInRevival = { status: "active", revival: { active: false, startedAt: null }, progress };
    assert.equal(isInRevival(notInRevival), false);
    assert.equal(
      computeDueReviews(notInRevival, dueChunkSet, "2026-01-20").length,
      1,
      "the same piece, not in revival, still surfaces its due review"
    );
  });
});

// Pass 35: revival.performanceTempo no longer overrides the target — a
// piece-wide "performance tempo" collected at revival entry used to beat
// even an explicit per-chunk targetBPM (docs/Decisions.md#revival). That
// override is gone; getRevivalTargetBPM must now behave exactly like the
// non-revival path (confidence.js's getSuggestedStartingBPM): the chunk's
// own targetBPM wins, falling back to getDefaultTargetBPM.
describe("getRevivalTargetBPM", () => {
  const chunk = { id: "c1", start: 1, end: 4 };

  test("ignores a stale/leftover revival.performanceTempo even while active", () => {
    const piece = {
      revival: { active: true, performanceTempo: 200 },
      progress: { c1: { targetBPM: 90 } },
      targetBPM: 100,
      bpmZones: [],
    };
    assert.equal(getRevivalTargetBPM(piece, chunk), 90, "chunk's own explicit target wins, not performanceTempo");
  });

  test("falls back to the piece-wide targetBPM when the chunk has no explicit target", () => {
    const piece = {
      revival: { active: true, performanceTempo: 200 },
      progress: { c1: {} },
      targetBPM: 100,
      bpmZones: [],
    };
    assert.equal(getRevivalTargetBPM(piece, chunk), 100, "falls back to getDefaultTargetBPM, not performanceTempo");
  });

  test("a BPM zone covering the chunk still wins over the piece-wide default, same as non-revival", () => {
    const piece = {
      revival: { active: true, performanceTempo: 200 },
      progress: { c1: {} },
      targetBPM: 100,
      bpmZones: [{ start: 1, end: 4, bpm: 72 }],
    };
    assert.equal(getRevivalTargetBPM(piece, chunk), 72);
  });

  test("returns null when nothing at all is set (no explicit target anywhere)", () => {
    const piece = { revival: { active: true }, progress: { c1: {} }, targetBPM: null, bpmZones: [] };
    assert.equal(getRevivalTargetBPM(piece, chunk), null);
  });

  test("identical result whether or not the piece is currently in revival", () => {
    const base = { progress: { c1: {} }, targetBPM: 110, bpmZones: [] };
    const inRevival = { ...base, revival: { active: true, performanceTempo: 200 } };
    const notInRevival = { ...base, revival: { active: false } };
    assert.equal(getRevivalTargetBPM(inRevival, chunk), getRevivalTargetBPM(notInRevival, chunk));
  });
});
