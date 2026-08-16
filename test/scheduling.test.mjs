// Tests for Pass 5 — Tier 1 / Tier 2 introduction-window scheduling
// (src/lib/scheduling.js's computeTimeline/getEffectiveTimeline). See
// docs/Repertoire-Lifecycle.md#introduction-window-review-scheduling-tier-1--tier-2
// for the design this implements.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateAllChunks } from "../src/lib/chunking.js";
import {
  computeTimeline,
  getEffectiveTimeline,
  computeScheduleStatus,
  computeDaysNeededForMinutesPerDay,
  shouldShowScheduleBanner,
  planRescheduleForPieces,
} from "../src/lib/scheduling.js";
import { addDaysISO, todayISODate } from "../src/lib/utils.js";

function basePiece(overrides) {
  return {
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
    progress: {},
    ...overrides,
  };
}

describe("Tier 1 — near-mandatory first-touch review", () => {
  test("under a heavy-introduction collision, every chunk still gets a Tier 1 review placed somewhere, and introduction is untouched", () => {
    // 10 practice chunks + 9 transitions (19 total) crammed into a 5-day
    // plan (4 learning days + 1 consolidation day) — a genuine collision
    // between introduction load and Tier 1 placement.
    const piece = basePiece({
      totalMeasures: 40,
      customChunkSize: 4,
      daysToLearn: 5,
      minutesPerDay: 500,
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);

    // Introduction wins its day's budget unconditionally: every practice
    // chunk appears in exactly one day's newChunkIds, regardless of Tier 1
    // pressure — nothing about Tier 1 placement below ever touches
    // newChunkIds.
    const totalNewChunkIds = timeline.days.reduce((s, d) => s + d.newChunkIds.length, 0);
    assert.equal(totalNewChunkIds, chunkSet.practiceChunks.length, "every practice chunk is still introduced exactly once");

    // Tier 1 still lands for every chunk (none dropped) — collected from
    // the 4 learning days only; day 5 is the consolidation day, whose
    // reviewChunkIds get overwritten with the full practice-chunk list by
    // unrelated pre-existing logic, not Tier 1 placement.
    const reviewedIds = new Set();
    timeline.days.forEach((d, i) => {
      if (d.type === "consolidation") return;
      d.reviewChunkIds.forEach((id) => reviewedIds.add(id));
    });
    const allIds = chunkSet.all.map((c) => c.id);
    const missing = allIds.filter((id) => !reviewedIds.has(id));
    assert.deepEqual(missing, [], "no chunk's Tier 1 review was silently dropped");
    assert.equal(reviewedIds.size, allIds.length);
  });

  test("a chunk already on the ladder (stage set) does not get a redundant Tier 1 review", () => {
    const piece = basePiece({
      daysToLearn: 14,
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" },
      },
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    // c1 should show up via Tier 2 (its nextDueDate), never at
    // introducedDay+1 (where Tier 1 would have placed it).
    const day2 = timeline.days[1]; // introducedDay[c1] + 1 == day 2
    assert.ok(!day2.reviewChunkIds.includes("c1"), "c1 already has ladder state, so no Tier 1 placement at intro+1");
  });

  test("[regression, Codex review] a chunk with real pre-ladder session history does not get a spurious Tier 1 review just because stage is null", () => {
    // backfillProgressLadderState (storage.js) sets stage:null on every
    // pre-existing progress entry that predates the ladder feature —
    // including one with a long, real practice history logged before
    // ladder state existed at all. stage:null alone must not be read as
    // "never touched," or every already-in-use piece would get told to
    // do a "first touch" review on chunks the learner has already
    // practiced extensively, the moment this scheduling model runs.
    const piece = basePiece({
      daysToLearn: 14,
      progress: {
        c1: {
          doneDays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          sessions: Array.from({ length: 10 }, (_, i) => ({ day: i + 1, outcome: "pass", cleanReps: 5, bpm: 90 })),
          currentBPM: 90,
          stage: null,
          consecutivePasses: 0,
          consecutiveStabilizingFails: 0,
          practiceBPM: null,
          nextDueDate: null,
          tier1Done: false,
        },
      },
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    const found = timeline.days.some((d) => d.type !== "consolidation" && d.reviewChunkIds.includes("c1"));
    assert.equal(found, false, "a heavily-practiced legacy chunk must not be scheduled a first-touch review");
  });

  test("a chunk truly never touched (no stage, no sessions) still gets Tier 1 — confirms the fix above didn't overcorrect", () => {
    const piece = basePiece({ daysToLearn: 14, progress: { c1: { doneDays: [], sessions: [] } } });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    const day2 = timeline.days[1];
    assert.ok(day2.reviewChunkIds.includes("c1"), "a genuinely untouched chunk must still get its Tier 1 review");
  });
});

describe("[regression] Tier 2 smoothing must never drift a review earlier than its own due day", () => {
  test("multi-hop smoothing across the 3-pass loop must not cascade a review backward past its computed due day", () => {
    // Reproduces a real bug found via manual browser verification, not by
    // any hand-constructed unit test above: with an uneven effort
    // distribution (here, one heavier chunk from a single harder measure)
    // introduction can land tightly enough that a chunk's Tier 2 review,
    // correctly placed on its actual due day, gets progressively nudged
    // *backward* across multiple smoothing passes (day 5 -> day 3 -> day
    // 2) chasing whichever neighboring day is least loaded at each step —
    // ending up a full 3 days before it was ever actually due, on the
    // single day right after its own introduction. The smoothing pass was
    // reused from the old REVIEW_OFFSETS-era code, which nudged ±1/±2 days
    // in either direction because it had no notion of a specific "due"
    // date to respect; Tier 2's candidates are forward-only for exactly
    // this reason (see the comment above the candidates array in
    // scheduling.js).
    const piece = basePiece({
      totalMeasures: 40,
      measureDifficulty: [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      ],
      chunkMode: "auto",
      recurringMode: "advanced",
      daysToLearn: 21,
      minutesPerDay: 20,
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-05" },
      },
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);

    // c1's actual due day (before any smoothing) is 2026-01-05 relative to
    // startDate 2026-01-01 — 5 days inclusive. The regression is
    // specifically about smoothing never pushing the review to a day
    // *before* that number, wherever it actually lands.
    const rawDueDay = 5;
    // Excludes the consolidation day deliberately: its reviewChunkIds gets
    // unconditionally overwritten with every practice chunk regardless of
    // ladder state (a separate, pre-existing "full run-through" listing,
    // not a Tier 2 placement) — including it here would always find c1
    // there and mask whether the real (buggy) early placement happened.
    let placedDay = null;
    timeline.days.forEach((d, i) => {
      if (d.type === "consolidation") return;
      if (d.reviewChunkIds.includes("c1")) placedDay = i + 1;
    });
    assert.ok(placedDay !== null, "c1's Tier 2 review must still be placed somewhere");
    assert.ok(placedDay >= rawDueDay, `c1 landed on day ${placedDay}, before its actual due day ${rawDueDay} — smoothing drifted it backward`);
  });
});

describe("Tier 2 — flexes under budget contention, rolls forward, never drops in-bounds items", () => {
  test("three chunks due on the same overloaded day: none are dropped, and at least one rolls to a lighter day", () => {
    const piece = basePiece({
      daysToLearn: 14,
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" },
        c5: { doneDays: [2], sessions: [{ day: 2, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" },
        c9: { doneDays: [3], sessions: [{ day: 3, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" },
      },
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);

    // All three share nextDueDate 2026-01-09 == day 9 (Jan 1 through Jan 9
    // inclusive). Confirm none were dropped: each of c1/c5/c9 appears in
    // exactly one learning day's reviewChunkIds.
    const dayOf = {};
    timeline.days.forEach((d, i) => {
      if (d.type === "consolidation") return;
      ["c1", "c5", "c9"].forEach((id) => {
        if (d.reviewChunkIds.includes(id)) {
          assert.ok(!(id in dayOf), `${id} must not appear on more than one day`);
          dayOf[id] = i + 1;
        }
      });
    });
    assert.deepEqual(Object.keys(dayOf).sort(), ["c1", "c5", "c9"], "all three chunks' Tier 2 reviews are placed somewhere, none dropped");

    // Confirm the smoothing pass actually did something: not all three are
    // still clustered on day 9 (the naive, unsmoothed placement).
    const stillOnDay9 = Object.values(dayOf).filter((d) => d === 9).length;
    assert.ok(stillOnDay9 < 3, "at least one of the three rolled off day 9 to relieve the overload");
    assert.ok(stillOnDay9 >= 1, "at least one review stays on day 9 (the smoothing pass's own diminishing-returns cutoff)");
  });

  test("a rolled/late Tier 2 review never counts toward computeScheduleStatus's missed count", () => {
    const piece = basePiece({
      daysToLearn: 14,
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" },
        c5: { doneDays: [2], sessions: [{ day: 2, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" },
        c9: { doneDays: [3], sessions: [{ day: 3, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" },
      },
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    // Evaluate "today" as day 12 — past every chunk's due day (9) and past
    // whatever day the smoothing pass rolled a review to — the scenario
    // CLAUDE.md's standing rule is meant to guard: lateness must never
    // trigger "behind schedule" off review timing.
    const status = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, 12);
    assert.equal(status.missedCount, 0, "chunks with a logged session are never counted as missed, regardless of review lateness/rolling");
  });
});

describe("Pass 16 — shouldShowScheduleBanner suppresses the banner once a piece has run past its plan", () => {
  const timeline = { days: Array(10) }; // a 10-day plan; only .days.length is read

  test("elapsedDay past the plan length hides the banner even with a real missedCount", () => {
    assert.equal(shouldShowScheduleBanner(11, timeline, 3), false, "one day past the plan, 3 chunks missed — still hidden");
    assert.equal(shouldShowScheduleBanner(40, timeline, 1), false, "long past the plan, 1 chunk missed — still hidden");
  });

  test("elapsedDay past the plan length with nothing missed stays hidden (unaffected either way)", () => {
    assert.equal(shouldShowScheduleBanner(11, timeline, 0), false);
  });

  test("still within the plan, a real missedCount shows the banner (unchanged behavior)", () => {
    assert.equal(shouldShowScheduleBanner(5, timeline, 2), true);
  });

  test("still within the plan, nothing missed hides the banner (unchanged behavior)", () => {
    assert.equal(shouldShowScheduleBanner(5, timeline, 0), false);
  });

  test("boundary: elapsedDay exactly at the plan's last day is not yet 'past' it — missedCount still governs", () => {
    assert.equal(shouldShowScheduleBanner(10, timeline, 2), true, "day 10 of a 10-day plan is still in the plan, not past it");
  });
});

describe("Tier 2 — due dates beyond this plan's own days[] are dropped from this bounded view, not clamped in wrong or crashed on", () => {
  test("a Holding-stage chunk due months out doesn't appear anywhere in a 10-day plan, and nothing crashes", () => {
    const piece = basePiece({
      totalMeasures: 8,
      customChunkSize: 4,
      daysToLearn: 10,
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, outcome: "pass" }], stage: "holding", nextDueDate: "2026-06-01" },
      },
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    const foundOutsideConsolidation = timeline.days.some((d, i) => d.type !== "consolidation" && d.reviewChunkIds.includes("c1"));
    assert.equal(foundOutsideConsolidation, false, "c1's far-future due date must not be clamped into this plan's bounded days[]");
  });
});

describe("Regression: computeTimeline never crashes on missing ladder fields (guard, not a reachable post-migration state)", () => {
  test("a progress entry with real sessions but no stage/nextDueDate at all does not throw", () => {
    const piece = basePiece({
      totalMeasures: 8,
      customChunkSize: 4,
      daysToLearn: 10,
      progress: {
        c1: { doneDays: [1], sessions: [{ day: 1, cleanReps: 3, bpm: 60 }] }, // no ladder fields whatsoever
      },
    });
    const chunkSet = generateAllChunks(piece);
    assert.doesNotThrow(() => computeTimeline(piece, chunkSet));
  });

  test("piece.progress entirely empty (nothing logged, no ladder data anywhere) does not throw", () => {
    const piece = basePiece({ totalMeasures: 8, customChunkSize: 4, daysToLearn: 10, progress: {} });
    const chunkSet = generateAllChunks(piece);
    assert.doesNotThrow(() => computeTimeline(piece, chunkSet));
  });

  test("piece.startDate itself missing does not throw (defensive — startDate is always backfilled post-migration)", () => {
    const piece = basePiece({ totalMeasures: 8, customChunkSize: 4, daysToLearn: 10 });
    delete piece.startDate;
    piece.progress = { c1: { doneDays: [1], sessions: [{ day: 1, outcome: "pass" }], stage: "stabilizing", nextDueDate: "2026-01-09" } };
    const chunkSet = generateAllChunks(piece);
    assert.doesNotThrow(() => computeTimeline(piece, chunkSet));
  });
});

describe("getEffectiveTimeline — Tier 2 date math must re-anchor to the reschedule point, not the original plan's day 1", () => {
  // Under today's real invariant, rescheduleMarker.remainingChunkOrder only
  // ever contains chunks with ZERO logged sessions (computeScheduleStatus's
  // remainingChunkIds, App.jsx's handleReschedule) — meaning a remaining
  // chunk's ladder `stage` is always still null in practice, so it always
  // takes the Tier 1 path, never Tier 2, inside getEffectiveTimeline's
  // rescheduled sub-timeline. This test deliberately constructs a
  // synthetic case that violates that invariant (giving a "remaining"
  // chunk real ladder state anyway) purely to pressure-test the date-frame
  // fix in isolation, since nothing in today's actual app flow can
  // otherwise reach this code path. See the pass summary for why this
  // matters regardless of the invariant holding today.
  test("a remaining chunk's nextDueDate resolves relative to the reschedule day, not the original startDate", () => {
    const remainingIds = ["c1", "c5", "c9", "c13", "c17", "c21", "c25", "c29", "c33", "c37"];
    const piece = basePiece({
      totalMeasures: 40,
      customChunkSize: 4,
      daysToLearn: 30,
      minutesPerDay: 500,
      progress: {
        c1: { doneDays: [], sessions: [], stage: "stabilizing", nextDueDate: "2026-01-20" },
      },
      rescheduleMarker: { asOfDay: 15, remainingChunkOrder: remainingIds },
    });
    const chunkSet = generateAllChunks(piece);
    const effective = getEffectiveTimeline(piece, chunkSet);
    assert.equal(effective.days.length, 30);

    // asOfDay(15)'s calendar date is 2026-01-15 (day 15 of a plan starting
    // 2026-01-01); nextDueDate 2026-01-20 is 6 days after that, so it
    // should land on original-plan day 20 (asOfDay + (6 - 1)) — never
    // dropped, and never resolved against the ORIGINAL day-1 anchor
    // (which would try to place it at day 20 relative to Jan 1, an
    // entirely different, coincidentally-plausible-looking day number this
    // assertion would not by itself catch — the real guard against that is
    // the second half of this test).
    const day20 = effective.days[19];
    assert.ok(day20.reviewChunkIds.includes("c1"), "c1's Tier 2 review lands on the day 2026-01-20 actually maps to post-reschedule");

    // Prove the fix is load-bearing, not coincidental: recompute the same
    // remaining-chunk sub-timeline the OLD (unfixed) code would have,
    // using the original startDate instead of the reschedule-shifted one.
    // Confirm that WITHOUT the fix, c1's due review would have silently
    // vanished from the whole 16-day remaining window (except the
    // unrelated day-16 consolidation override, which lists every
    // remaining chunk regardless of ladder state and isn't a real "due"
    // signal).
    const remainingChunks = chunkSet.practiceChunks.filter((c) => remainingIds.includes(c.id));
    const remainingTransitions = chunkSet.transitions.filter((t) => t.linkedIds.some((id) => remainingIds.includes(id)));
    const remainingCombos = chunkSet.combos.filter((c) => remainingIds.includes(c.linkedIds[0]));
    const subChunkSet = { practiceChunks: remainingChunks, transitions: remainingTransitions, combos: remainingCombos, all: [...remainingChunks, ...remainingTransitions, ...remainingCombos] };
    const unfixedSubPiece = { ...piece, daysToLearn: 16 }; // startDate left as the ORIGINAL 2026-01-01 — the bug being guarded against
    const unfixedSubTimeline = computeTimeline(unfixedSubPiece, subChunkSet);
    const foundUnfixed = unfixedSubTimeline.days.some((d, i) => i + 1 !== 16 && d.reviewChunkIds.includes("c1"));
    assert.equal(foundUnfixed, false, "confirms the bug this fix guards against was real: unfixed date math drops the review entirely");
  });

  test("days before the reschedule point are kept byte-for-byte from the original computation (unaffected by the fix)", () => {
    const piece = basePiece({
      totalMeasures: 40,
      customChunkSize: 4,
      daysToLearn: 30,
      minutesPerDay: 500,
      rescheduleMarker: { asOfDay: 15, remainingChunkOrder: ["c21", "c25", "c29", "c33", "c37"] },
    });
    const chunkSet = generateAllChunks(piece);
    const original = computeTimeline(piece, chunkSet);
    const effective = getEffectiveTimeline(piece, chunkSet);
    for (let i = 0; i < 14; i++) {
      assert.deepEqual(effective.days[i], original.days[i], `day ${i + 1} must be untouched by the reschedule`);
    }
  });
});

describe("[regression, Codex review] computeDaysNeededForMinutesPerDay's review-cost padding must reflect the new one-touch-at-a-time model", () => {
  test("a piece with many chunks gets a smaller day-count estimate than the old fixed-four-reviews-per-item assumption would have produced", () => {
    // 80 measures / 4-measure chunks = 20 chunks, at a minutesPerDay
    // budget (100) large enough that the per-item review-padding
    // constant actually changes how many items fit per day (at smaller
    // budgets, introduction cost alone already dominates the per-day
    // budget regardless of the review constant, so the two formulas
    // would coincidentally agree — this input was chosen by actually
    // comparing old vs. new output across a range of budgets, not
    // guessed). Asserting the exact expected value (14, computed from the
    // fixed source) rather than a vague "some number," and separately
    // confirmed by temporarily reverting the fix and re-running this test
    // to see it fail (28) before restoring it.
    const piece = basePiece({ totalMeasures: 80, customChunkSize: 4, recurringMode: "none" });
    const chunkSet = generateAllChunks(piece);
    const days = computeDaysNeededForMinutesPerDay(chunkSet, 100, 7);
    assert.equal(days, 14, "the old REVIEW_OFFSETS.length-based formula would have produced 28 days for this same input — half again as much padding as actually needed under the new one-touch-at-a-time model");
  });

  test("still pads for some review load, not zero — a budget that fits introduction alone but leaves no room for any review still gets padded to more days", () => {
    const piece = basePiece({ totalMeasures: 40, customChunkSize: 4, recurringMode: "none" });
    const chunkSet = generateAllChunks(piece);
    const totalIntroEffortOnly = chunkSet.all.reduce((s, c) => s + c.effort, 0);
    // A minutesPerDay budget sized to exactly fit total introduction
    // effort with zero slack would, with no review padding at all,
    // return the smallest possible day count — confirming padding is
    // still real (not accidentally zeroed out) means this must ask for
    // more than that bare minimum.
    const tightMinutesPerDay = Math.ceil((totalIntroEffortOnly * 2.5) / 0.65);
    const days = computeDaysNeededForMinutesPerDay(chunkSet, tightMinutesPerDay, 7);
    assert.ok(days > 1, "some review padding must still inflate the day count beyond the bare introduction-only minimum");
  });
});

describe("[regression] getEffectiveTimeline must re-base introducedDay onto asOfDay, or the behind-schedule banner never clears", () => {
  // Reported as "the Reschedule remaining days button isn't working on any
  // of my pieces". It was working — the marker saved and the plan really was
  // rebalanced — but computeScheduleStatus is the only external reader of
  // introducedDay, and it counts a chunk as behind when
  // `introducedDay[id] < currentDay`. The rescheduled sub-timeline numbers
  // its days from 1 (where 1 means asOfDay); days[] was re-based on merge,
  // introducedDay was not. So every rescheduled chunk reported day 1, 2, 3...
  // against a currentDay of asOfDay or later and stayed "behind" forever.
  //
  // The previous suite in this file covers the same function's Tier 2 date
  // math and still passed throughout — the gap was never an uncovered
  // function, it was an unasserted return value. See
  // docs/Algorithms.md#rescheduling.
  const CURRENT_DAY = 8;

  function behindPiece(overrides) {
    // 24 measures / 4 = 6 practice chunks, a 14-day plan, nothing logged —
    // by day 8 most chunks are past their scheduled introduction.
    return basePiece({ totalMeasures: 24, customChunkSize: 4, daysToLearn: 14, minutesPerDay: 20, ...overrides });
  }

  test("rescheduling actually clears the behind-schedule count", () => {
    const piece = behindPiece();
    const chunkSet = generateAllChunks(piece);
    const before = computeScheduleStatus(piece, chunkSet.practiceChunks, getEffectiveTimeline(piece, chunkSet), CURRENT_DAY);
    assert.ok(before.missedCount > 0, "precondition: the piece must actually be behind before rescheduling");

    // Exactly what App.jsx's handleConfirmReschedule writes.
    const rescheduled = {
      ...piece,
      rescheduleMarker: { asOfDay: CURRENT_DAY, remainingChunkOrder: before.remainingChunkIds },
    };
    const after = computeScheduleStatus(
      rescheduled,
      chunkSet.practiceChunks,
      getEffectiveTimeline(rescheduled, chunkSet),
      CURRENT_DAY
    );
    assert.equal(after.missedCount, 0, "after rescheduling nothing is behind — this is the user-visible promise of the button");
  });

  test("no rescheduled chunk claims an introduction day earlier than the reschedule point", () => {
    const piece = behindPiece();
    const chunkSet = generateAllChunks(piece);
    const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, getEffectiveTimeline(piece, chunkSet), CURRENT_DAY);
    const rescheduled = { ...piece, rescheduleMarker: { asOfDay: CURRENT_DAY, remainingChunkOrder: remainingChunkIds } };
    const effective = getEffectiveTimeline(rescheduled, chunkSet);

    for (const id of remainingChunkIds) {
      assert.ok(
        effective.introducedDay[id] >= CURRENT_DAY,
        `${id} was re-placed by the reschedule, so it cannot report an introduction day (${effective.introducedDay[id]}) before asOfDay (${CURRENT_DAY})`
      );
    }
  });

  test("an already-practiced chunk keeps its original introduction day", () => {
    // The button's stated promise: "Chunks you've already practiced stay
    // where they are." Only re-placed chunks shift.
    const piece = behindPiece({
      progress: { c1: { doneDays: [1], sessions: [{ day: 1, cleanReps: 4, bpm: 80, outcome: "pass" }] } },
    });
    const chunkSet = generateAllChunks(piece);
    const original = computeTimeline(piece, chunkSet);
    const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, getEffectiveTimeline(piece, chunkSet), CURRENT_DAY);
    assert.ok(!remainingChunkIds.includes("c1"), "a practiced chunk is never part of the rescheduled remainder");

    const rescheduled = { ...piece, rescheduleMarker: { asOfDay: CURRENT_DAY, remainingChunkOrder: remainingChunkIds } };
    const effective = getEffectiveTimeline(rescheduled, chunkSet);
    assert.equal(effective.introducedDay.c1, original.introducedDay.c1, "c1 was already practiced, so its introduction day must survive the reschedule untouched");
  });

  test("confirms the bug this guards against was real: an un-shifted merge leaves everything behind", () => {
    // Reconstructs the old merge (sub-plan introducedDay spread in without
    // the asOfDay offset) and asserts the banner would NOT have cleared —
    // so this suite fails loudly if the shift is ever dropped again.
    const piece = behindPiece();
    const chunkSet = generateAllChunks(piece);
    const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, getEffectiveTimeline(piece, chunkSet), CURRENT_DAY);
    const rescheduled = { ...piece, rescheduleMarker: { asOfDay: CURRENT_DAY, remainingChunkOrder: remainingChunkIds } };
    const effective = getEffectiveTimeline(rescheduled, chunkSet);

    const unshifted = { ...effective, introducedDay: {} };
    for (const [id, day] of Object.entries(effective.introducedDay)) {
      unshifted.introducedDay[id] = remainingChunkIds.includes(id) ? day - (CURRENT_DAY - 1) : day;
    }
    const wouldBe = computeScheduleStatus(rescheduled, chunkSet.practiceChunks, unshifted, CURRENT_DAY);
    assert.ok(wouldBe.missedCount > 0, "without the re-base, rescheduled chunks still read as behind — the symptom that made the button look broken");
  });
});

/* ------------------------------------------------------------------ */
/*  Pass 21 — "Reschedule all" across every behind-schedule piece      */
/* ------------------------------------------------------------------ */

describe("planRescheduleForPieces — the multi-piece form of Reschedule", () => {
  // These pieces are anchored to the *real* today, because
  // planRescheduleForPieces asks each piece what day it's on (elapsedDay /
  // getCurrentDay read the clock). A fixed startDate would make every
  // assertion below drift as the calendar moves.
  const startedDaysAgo = (n) => addDaysISO(todayISODate(), -n);

  function behindPieceOnDay6(overrides) {
    // 5 days elapsed before today => currentDay 6 of a 10-day plan, with
    // nothing ever logged, so every chunk introduced on days 1-5 is behind.
    return basePiece({ daysToLearn: 10, startDate: startedDaysAgo(5), ...overrides });
  }

  test("picks out behind-schedule active pieces and skips ones that are on track", () => {
    const behind = behindPieceOnDay6({ name: "Behind" });
    const onTrack = basePiece({ name: "On track", daysToLearn: 10, startDate: todayISODate() });

    const plans = planRescheduleForPieces({ behind, onTrack });

    assert.equal(plans.length, 1, "only the behind-schedule piece is included");
    assert.equal(plans[0].pieceId, "behind");
    assert.ok(plans[0].missedCount > 0);
  });

  test("each piece's marker is anchored to its own current day, not a shared one", () => {
    // Two pieces started on different dates — the whole reason asOfDay is
    // computed per piece rather than passed in once from the caller.
    const older = behindPieceOnDay6({ name: "Older" });
    const newer = basePiece({ name: "Newer", daysToLearn: 10, startDate: startedDaysAgo(2) });

    const plans = planRescheduleForPieces({ older, newer });
    const byId = Object.fromEntries(plans.map((p) => [p.pieceId, p]));

    assert.equal(byId.older.marker.asOfDay, 6, "started 5 days ago => day 6");
    assert.equal(byId.newer.marker.asOfDay, 3, "started 2 days ago => day 3");
  });

  test("the marker it builds matches what the single-piece path would have built", () => {
    const piece = behindPieceOnDay6({ name: "Solo" });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, 6);

    const [plan] = planRescheduleForPieces({ piece });

    assert.deepEqual(plan.marker, { asOfDay: 6, remainingChunkOrder: remainingChunkIds });
  });

  test("paused and archived pieces are left alone", () => {
    const paused = behindPieceOnDay6({ name: "Paused", status: "paused" });
    const archived = behindPieceOnDay6({ name: "Archived", status: "archived" });
    const active = behindPieceOnDay6({ name: "Active" });

    const plans = planRescheduleForPieces({ paused, archived, active });

    assert.deepEqual(plans.map((p) => p.pieceId), ["active"]);
  });

  test("a piece mid-revival is left alone — revival replaces the plan's pacing", () => {
    const reviving = behindPieceOnDay6({
      name: "Reviving",
      revival: { active: true, startedAt: Date.now(), reassessmentComplete: false, plan: null },
    });

    assert.deepEqual(planRescheduleForPieces({ reviving }), []);
  });

  test("a piece past the end of its own plan is left alone", () => {
    // The same boundary shouldShowScheduleBanner uses. Without it, every
    // long-finished piece would be swept in forever: getCurrentDay clamps to
    // the plan's last day, so computeScheduleStatus keeps reporting the same
    // stale misses no matter how much later it's asked.
    const finishedLongAgo = basePiece({ name: "Old", daysToLearn: 10, startDate: startedDaysAgo(100) });
    const chunkSet = generateAllChunks(finishedLongAgo);
    const timeline = getEffectiveTimeline(finishedLongAgo, chunkSet);
    const { missedCount } = computeScheduleStatus(finishedLongAgo, chunkSet.practiceChunks, timeline, 10);
    assert.ok(missedCount > 0, "computeScheduleStatus alone still calls this piece behind…");

    assert.deepEqual(planRescheduleForPieces({ finishedLongAgo }), [], "…but a bulk reschedule must not touch it");
  });

  test("a piece with every chunk already practiced has nothing to reschedule", () => {
    const piece = behindPieceOnDay6({ name: "Done" });
    const chunkSet = generateAllChunks(piece);
    piece.progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1] }]));

    assert.deepEqual(planRescheduleForPieces({ piece }), []);
  });

  test("one malformed piece is skipped without taking the whole bulk action down", () => {
    const good = behindPieceOnDay6({ name: "Good" });
    // measureDifficulty null with real measures throws inside chunk
    // generation — stands in for any corrupted record.
    const broken = { name: "Broken", status: "active", totalMeasures: 12, measureDifficulty: null, progress: {} };

    const realError = console.error;
    console.error = () => {};
    let plans;
    try {
      plans = planRescheduleForPieces({ broken, good });
    } finally {
      console.error = realError;
    }

    assert.deepEqual(plans.map((p) => p.pieceId), ["good"]);
  });

  test("furthest behind is listed first", () => {
    const fewer = behindPieceOnDay6({ name: "Fewer", totalMeasures: 8, measureDifficulty: Array(8).fill(1) });
    const more = behindPieceOnDay6({ name: "More", totalMeasures: 40, measureDifficulty: Array(40).fill(1) });

    const plans = planRescheduleForPieces({ fewer, more });

    assert.ok(plans[0].missedCount >= plans[plans.length - 1].missedCount);
    assert.equal(plans[0].pieceId, "more");
  });
});
