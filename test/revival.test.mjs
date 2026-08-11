// Tests for revival's combo escalation (src/lib/revival.js). This logic
// went through three rounds of bug fixes after it first shipped — see
// docs/Decisions.md#spaced-repetition--maintenance — so the regression
// cases below are as important as the "happy path" ones.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeComboEscalations, findComboUnderlyingChunks } from "../src/lib/revival.js";

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
