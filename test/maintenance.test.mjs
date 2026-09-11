// Pass 66 — a review overdue while a piece is still comfortably inside its
// own active plan now reaches Today's Practice / Master Agenda, not just
// once the piece has run its whole bounded plan out
// (docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built).
//
// computeDueReviews itself (lib/maintenance.js) never depended on plan
// state — the gate that made it past-plan-only lived entirely at the call
// site in TodayTab.jsx/MasterAgendaTab.jsx. This file exercises the two
// lib-level pieces of that fix: computeDueReviews finding an overdue chunk
// on a piece nowhere near past-plan, and mergeLiveDueReviews folding that
// result into a plan day's own reviewChunkIds without duplicating a review
// that's due exactly today. The tabs themselves have no render harness
// (see test/session-undo.test.mjs's note on this), so the merge logic was
// written here specifically so it could be tested at all.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateAllChunks } from "../src/lib/chunking.js";
import { computeDueReviews, mergeLiveDueReviews, computeDueOnDate } from "../src/lib/maintenance.js";

function basePiece(overrides) {
  return {
    id: "p1",
    name: "Test piece",
    totalMeasures: 12,
    measureDifficulty: Array(12).fill(1),
    chunkMode: "custom",
    customChunkSize: 4,
    recurringMode: "none",
    recurringMeasures: 0,
    recurringPairs: [],
    practiceDaysPerWeek: 7,
    minutesPerDay: 30,
    startDate: "2026-01-01",
    status: "active",
    progress: {},
    ...overrides,
  };
}

// A chunk sitting on the ladder — same shape test/relearning.test.mjs uses.
function ladderEntry(overrides) {
  return {
    doneDays: [1],
    sessions: [{ day: 1, outcome: "pass", loggedDate: "2026-01-01" }],
    stage: "holding",
    consecutivePasses: 0,
    consecutiveStabilizingFails: 0,
    practiceBPM: 60,
    nextDueDate: "2026-01-09",
    tier1Done: false,
    ...overrides,
  };
}

describe("computeDueReviews reaches Today's Practice without the piece running out its plan", () => {
  test("finds an overdue chunk on a 60-day plan that's nowhere near past-plan, and mergeLiveDueReviews folds it into a plan day's own reviewChunkIds", () => {
    const piece = basePiece({
      daysToLearn: 60,
      progress: { c1: ladderEntry({ nextDueDate: "2026-01-05" }) }, // 15 days before "today"
    });
    const chunkSet = generateAllChunks(piece);
    const due = computeDueReviews(piece, chunkSet, "2026-01-20");
    assert.deepEqual(
      due.map((d) => d.chunkId),
      ["c1"],
      "the overdue chunk surfaces on its own — computeDueReviews never needed the plan to be exhausted"
    );

    // Simulate the plan day currently on screen: c1's own scheduled
    // placement day has already come and gone, so it isn't among what
    // computeTimeline put on today's day.
    const day = { dayNumber: 20, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c2"], minutes: 10 };
    const merged = mergeLiveDueReviews(day, due);
    assert.deepEqual(
      merged.reviewChunkIds,
      ["c2", "c1"],
      "the overdue review is folded in alongside whatever was already scheduled for today"
    );
    // c1 is a 4-measure, difficulty-1 chunk: effort 4, so its due-review
    // estimate is round(4 * EFFORT_TO_MIN) = 10 minutes — folded on top of
    // the day's existing 10, since a review is now priced the same way as
    // introducing a chunk fresh (same formula computeDueReviews already
    // used), so the two numbers agree instead of disagreeing.
    assert.equal(merged.minutes, 20, "the overdue review's own estimated time is folded into the day's total, not just its checklist entry");
  });

  test("a review due exactly today, already placed by computeTimeline, isn't duplicated by the merge — reviewChunkIds or minutes", () => {
    const piece = basePiece({
      daysToLearn: 60,
      progress: { c1: ladderEntry({ nextDueDate: "2026-01-20" }) }, // due exactly "today"
    });
    const chunkSet = generateAllChunks(piece);
    const due = computeDueReviews(piece, chunkSet, "2026-01-20");
    assert.deepEqual(due.map((d) => d.chunkId), ["c1"]);

    // c1 is already in today's own plan-day reviewChunkIds — computeTimeline
    // placed it there itself, since its due date lands exactly on today.
    // Its 10 minutes is presumably already folded into this day's total the
    // same way computeTimeline priced it, so the merge must not add it a
    // second time.
    const day = { dayNumber: 20, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c1"], minutes: 10 };
    const merged = mergeLiveDueReviews(day, due);
    assert.deepEqual(merged.reviewChunkIds, ["c1"], "renders exactly once, not duplicated between the day's own placement and the live due-query");
    assert.equal(merged.minutes, 10, "already-counted minutes aren't added again for a chunk that was already in reviewChunkIds");
  });

  test("a paused piece and a piece mid-revival still surface nothing — the merge doesn't bypass computeDueReviews' own suppression", () => {
    const paused = basePiece({
      daysToLearn: 60,
      status: "paused",
      progress: { c1: ladderEntry({ nextDueDate: "2026-01-05" }) },
    });
    const pausedChunkSet = generateAllChunks(paused);
    const pausedDue = computeDueReviews(paused, pausedChunkSet, "2026-01-20");
    assert.deepEqual(pausedDue, [], "paused pieces still suppress due reviews, unconditional call or not");

    const day = { dayNumber: 20, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c2"], minutes: 10 };
    assert.deepEqual(mergeLiveDueReviews(day, pausedDue), day, "nothing to merge when the suppressed query returns empty");

    const inRevival = basePiece({
      daysToLearn: 60,
      revival: { active: true },
      progress: { c1: ladderEntry({ nextDueDate: "2026-01-05" }) },
    });
    const revivalChunkSet = generateAllChunks(inRevival);
    const revivalDue = computeDueReviews(inRevival, revivalChunkSet, "2026-01-20");
    assert.deepEqual(revivalDue, [], "a piece mid-revival still suppresses due reviews, unconditional call or not");
    assert.deepEqual(mergeLiveDueReviews(day, revivalDue), day, "nothing to merge here either");
  });

  test("[regression] a consolidation day is never merged into — its minutes must not silently absorb an overdue item nothing renders", () => {
    // Found in self-review, not the original pass: neither TodayTab's
    // ConsolidationPanel nor MasterAgendaTab's card renders reviewChunkIds
    // or minutes for a consolidation ("full run-through") day at all — it's
    // just "play through the whole piece." Before this guard, merging a
    // transition/combo's overdue live-due review into one would have
    // inflated day.minutes (and therefore Master Agenda's total-planned
    // figure) with no line item anywhere to explain the extra time.
    const day = {
      dayNumber: 14,
      type: "consolidation",
      newChunkIds: [],
      specialChunkIds: [],
      reviewChunkIds: ["c1", "c5", "c9"], // computeTimeline's blanket "every practice chunk" override
      minutes: 30,
    };
    const due = [{ chunkId: "t_c1_c5", chunk: { id: "t_c1_c5" }, minutes: 10 }]; // an overdue transition, not among the blanket ids
    const merged = mergeLiveDueReviews(day, due);
    assert.equal(merged, day, "the exact same object comes back — no merge attempted on a consolidation day");
    assert.equal(merged.minutes, 30, "minutes stays exactly as computeTimeline set it, no silent inflation");
  });
});

// The once-scoped-out "due-in-N-days" query (docs/Decisions.md#open-questions),
// built on direct request to power a genuinely forward-looking maintenance
// week (WeekView.jsx). Deliberately an *exact* nextDueDate match, not
// "due by this date" — that distinction is the whole reason it's a
// separate function from computeDueReviews rather than a thin wrapper
// around it (see the function's own comment in lib/maintenance.js).
describe("computeDueOnDate — a single future day's newly-due items, not the accumulated backlog", () => {
  test("finds a chunk whose nextDueDate lands exactly on the given date", () => {
    const piece = basePiece({ daysToLearn: 60, progress: { c1: ladderEntry({ nextDueDate: "2026-01-25" }) } });
    const chunkSet = generateAllChunks(piece);
    const due = computeDueOnDate(piece, chunkSet, "2026-01-25");
    assert.deepEqual(due.map((d) => d.chunkId), ["c1"]);
  });

  test("a chunk overdue *before* the given date is not re-counted — exact match only, not <=", () => {
    const piece = basePiece({ daysToLearn: 60, progress: { c1: ladderEntry({ nextDueDate: "2026-01-05" }) } });
    const chunkSet = generateAllChunks(piece);
    const due = computeDueOnDate(piece, chunkSet, "2026-01-25");
    assert.deepEqual(due, [], "already overdue as of 1-05 — must not also appear as newly due on 1-25, or a real backlog would double-count into every future day");
  });

  test("a chunk due *after* the given date doesn't appear yet either", () => {
    const piece = basePiece({ daysToLearn: 60, progress: { c1: ladderEntry({ nextDueDate: "2026-02-01" }) } });
    const chunkSet = generateAllChunks(piece);
    const due = computeDueOnDate(piece, chunkSet, "2026-01-25");
    assert.deepEqual(due, []);
  });

  test("respects the same suppression rules as computeDueReviews: paused piece, revival, needsRelearning", () => {
    const chunkSet0 = generateAllChunks(basePiece({ daysToLearn: 60 }));

    const paused = basePiece({ daysToLearn: 60, status: "paused", progress: { c1: ladderEntry({ nextDueDate: "2026-01-25" }) } });
    assert.deepEqual(computeDueOnDate(paused, chunkSet0, "2026-01-25"), []);

    const reviving = basePiece({
      daysToLearn: 60,
      progress: { c1: ladderEntry({ nextDueDate: "2026-01-25" }) },
      revival: { active: true, startedAt: Date.now(), reassessmentComplete: false, plan: null },
    });
    assert.deepEqual(computeDueOnDate(reviving, chunkSet0, "2026-01-25"), []);

    const relearning = basePiece({ daysToLearn: 60, progress: { c1: ladderEntry({ nextDueDate: "2026-01-25", needsRelearning: true }) } });
    assert.deepEqual(computeDueOnDate(relearning, chunkSet0, "2026-01-25"), []);
  });

  test("no piece/chunkSet/date returns [] without throwing", () => {
    assert.deepEqual(computeDueOnDate(null, {}, "2026-01-25"), []);
    assert.deepEqual(computeDueOnDate(basePiece({}), null, "2026-01-25"), []);
    assert.deepEqual(computeDueOnDate(basePiece({}), {}, null), []);
  });
});
