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
  estimateRescheduleFit,
  reconcileMinutesPerDaySchedule,
  isPlanActuallyComplete,
  computeMinutesModeAutoExtend,
  computeReschedulePastPlanExtension,
  classifyDayCompletion,
  countBehindDays,
  findStuckBehindPieces,
  computeRemainingConnectorIds,
  isDayFullySwept,
  withLiveReviewStatus,
  computeAbandonedPlanReminder,
} from "../src/lib/scheduling.js";
import { addDaysISO, todayISODate, elapsedDay, getCurrentDay } from "../src/lib/utils.js";

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

describe("[regression] new-chunk introduction spreads overflow evenly, not onto the last front day", () => {
  // Reproduces the bug directly: 10 equal-effort chunks (40 measures / 4)
  // across 8 front days doesn't divide evenly (10/8 = 1.25 per day). The
  // old reset-per-day accumulator, capped at the last front day once
  // dayIdx got there, dumped every bit of that drift onto day 8 alone (7
  // days with 1 chunk, day 8 with 3) — confirmed by temporarily reverting
  // the fix and re-running this test to see it fail (day 8 got 3, this
  // assertion's bound is 2). The cumulative-boundary fix instead lets any
  // front day absorb one extra chunk, never concentrating all the drift on
  // one day.
  test("no single front day absorbs more than one extra chunk over the even share", () => {
    const piece = basePiece({
      totalMeasures: 40,
      measureDifficulty: Array(40).fill(1),
      customChunkSize: 4,
      daysToLearn: 16,
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    assert.equal(chunkSet.practiceChunks.length, 10);
    assert.equal(timeline.halfPoint, 8, "test setup sanity check: 8 front days for 10 chunks");

    const counts = timeline.days.slice(0, 8).map((d) => d.newChunkIds.length);
    const evenShare = Math.ceil(10 / 8); // 2
    counts.forEach((count, i) => {
      assert.ok(count <= evenShare, `day ${i + 1} got ${count} new chunks, more than the even share of ${evenShare} — overflow piled up instead of spreading`);
    });
    assert.equal(counts.reduce((s, c) => s + c, 0), 10, "every chunk is still introduced exactly once");
  });

  test("the very first front day still gets at least one chunk, even when a single chunk's effort is large relative to the per-day slice", () => {
    // 3 chunks spread across 7 front days (12 measures / 4, 14-day plan) —
    // few chunks, many days. A midpoint-based version of the boundary fix
    // (an earlier draft of it) could push even the first chunk past day
    // one's boundary and leave day one with nothing introduced at all;
    // comparing each chunk's *starting* cumulative effort instead
    // guarantees day one always gets the first chunk. Confirmed by
    // temporarily reverting to the midpoint comparison to see this fail.
    const piece = basePiece({ daysToLearn: 14 });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    assert.ok(timeline.days[0].newChunkIds.length > 0, "day one has no new chunks introduced despite material and days being available");
  });
});

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
    //
    // Before the difficulty-based review-cost follow-up (minutesFor pricing
    // a review at chunk.effort * EFFORT_TO_MIN instead of a flat 3
    // minutes), this same fixture left exactly one review behind on day 9 —
    // three flat 3-minute reviews (9 minutes total) weren't overloaded
    // enough for the smoothing pass's own diminishing-returns cutoff (the
    // "+6" move-worth-it margin) to bother relocating all three. Now each of
    // these 4-measure chunks reviews at 10 minutes (matching its own
    // introduction cost), so day 9's real pileup is 30 minutes — clearly
    // over budget — and every one of the three clears the relocation
    // threshold, landing on three separate later days instead. Re-verified
    // by temporarily reverting the review-pricing fix and re-running this
    // test to see the old "exactly one stays" outcome return.
    const stillOnDay9 = Object.values(dayOf).filter((d) => d === 9).length;
    assert.equal(stillOnDay9, 0, "all three rolled off day 9 — a 30-minute same-day review pileup is enough to clear the smoothing pass's relocation threshold for every one of them");
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

describe("Pass 45 — classifyDayCompletion (per-day completion, for Overview's first week / Pass 46's Timeline tab)", () => {
  test("a day at or after currentDay is always 'future', regardless of what it scheduled", () => {
    const piece = basePiece({ progress: {} });
    const day = { dayNumber: 5, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] };
    assert.equal(classifyDayCompletion(day, piece, 5), "future", "dayNumber === currentDay");
    assert.equal(classifyDayCompletion(day, piece, 3), "future", "dayNumber > currentDay");
  });

  test("a past day is 'done' only when every scheduled chunk logged *that exact day*", () => {
    const piece = basePiece({
      progress: {
        c1: { doneDays: [2] },
        c5: { doneDays: [2, 3] },
      },
    });
    const day = { dayNumber: 2, newChunkIds: ["c1"], specialChunkIds: ["c5"], reviewChunkIds: [] };
    assert.equal(classifyDayCompletion(day, piece, 4), "done");
  });

  // Distinguishes this from computeScheduleStatus's broader "ever touched"
  // check (any doneDays entry at all) — a day is only "done" if the chunk
  // was logged on *that* day, not merely logged at some point.
  test("a chunk logged on a different day still leaves this day 'behind'", () => {
    const piece = basePiece({ progress: { c1: { doneDays: [3] } } });
    const day = { dayNumber: 2, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] };
    assert.equal(classifyDayCompletion(day, piece, 4), "behind");
  });

  test("one incomplete chunk among several is enough to mark the whole day 'behind'", () => {
    const piece = basePiece({
      progress: {
        c1: { doneDays: [2] },
        c5: { doneDays: [] },
      },
    });
    const day = { dayNumber: 2, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: ["c5"] };
    assert.equal(classifyDayCompletion(day, piece, 4), "behind");
  });

  // "empty" is deliberately its own state, not folded into "done" — a
  // caller (Overview's first-week list) still grays an empty past day out,
  // but shouldn't cross off a "Nothing scheduled" row as if real work were
  // completed there. Was "done" ("vacuously," nothing to miss) until that
  // read as misleading on request; kept as a named case here so a future
  // change can't silently re-collapse the two.
  test("a past day with nothing scheduled at all (e.g. a rest day) is 'empty', not 'done'", () => {
    const piece = basePiece({ progress: {} });
    const day = { dayNumber: 2, newChunkIds: [], specialChunkIds: [], reviewChunkIds: [] };
    assert.equal(classifyDayCompletion(day, piece, 4), "empty");
  });

  test("a chunk with no progress entry at all counts as not done, same as computeScheduleStatus's own || {} guard", () => {
    const piece = basePiece({ progress: {} });
    const day = { dayNumber: 2, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] };
    assert.equal(classifyDayCompletion(day, piece, 4), "behind");
  });
});

describe("Pass 70 — countBehindDays (day-count sibling to computeScheduleStatus's chunk-count missedCount)", () => {
  test("counts exactly the days classifyDayCompletion reports as 'behind', ignoring done/empty/future days", () => {
    const piece = basePiece({
      progress: {
        c1: { doneDays: [1] }, // day 1: done
        // day 2: c2 never logged -> behind
        c3: { doneDays: [3] }, // day 3: done
        // day 4: nothing scheduled -> empty
        // day 5: c5 never logged -> behind
        // day 6: currentDay itself -> future
      },
    });
    const timeline = {
      days: [
        { dayNumber: 1, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] },
        { dayNumber: 2, newChunkIds: ["c2"], specialChunkIds: [], reviewChunkIds: [] },
        { dayNumber: 3, newChunkIds: ["c3"], specialChunkIds: [], reviewChunkIds: [] },
        { dayNumber: 4, newChunkIds: [], specialChunkIds: [], reviewChunkIds: [] },
        { dayNumber: 5, newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c5"] },
        { dayNumber: 6, newChunkIds: ["c6"], specialChunkIds: [], reviewChunkIds: [] },
      ],
    };
    // Sanity: matches classifyDayCompletion's own per-day verdicts.
    assert.equal(classifyDayCompletion(timeline.days[0], piece, 6), "done");
    assert.equal(classifyDayCompletion(timeline.days[1], piece, 6), "behind");
    assert.equal(classifyDayCompletion(timeline.days[2], piece, 6), "done");
    assert.equal(classifyDayCompletion(timeline.days[3], piece, 6), "empty");
    assert.equal(classifyDayCompletion(timeline.days[4], piece, 6), "behind");
    assert.equal(classifyDayCompletion(timeline.days[5], piece, 6), "future");
    assert.equal(countBehindDays(piece, timeline, 6), 2);
  });

  test("multiple missed chunks piled onto the same day count as one behind day, not one per chunk", () => {
    const piece = basePiece({ progress: {} });
    const timeline = {
      days: [
        { dayNumber: 1, newChunkIds: ["c1", "c2", "c3"], specialChunkIds: [], reviewChunkIds: ["c4"] },
      ],
    };
    assert.equal(countBehindDays(piece, timeline, 2), 1);
  });

  // computeScheduleStatus's missedCount > 0 implies a chunk was introduced
  // on some day before currentDay with zero doneDays — that exact
  // introduction day must itself classify as "behind", so countBehindDays
  // must also be > 0 whenever missedCount is. Guarantees the banner never
  // reads "0 days behind" while it's still showing at all.
  test("whenever computeScheduleStatus reports missedCount > 0, countBehindDays is also > 0", () => {
    const piece = basePiece({
      totalMeasures: 16,
      measureDifficulty: Array(16).fill(1),
      customChunkSize: 4,
      minutesPerDay: 5, // small budget forces the plan to spread across multiple days
      progress: {},
    });
    const chunkSet = generateAllChunks(piece);
    const timeline = computeTimeline(piece, chunkSet);
    const currentDay = timeline.days.length + 10; // well past every introduction, nothing logged
    const status = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, currentDay);
    assert.ok(status.missedCount > 0, "fixture must actually have missed chunks for this check to mean anything");
    assert.ok(countBehindDays(piece, timeline, currentDay) > 0);
  });
});

describe("Pass 74 follow-up — countBehindDays excludes days fully swept into a reschedule", () => {
  // Reproduces the exact symptom found during Pass 74's manual verification:
  // immediately after a reschedule, every pre-reschedule day still carries
  // its stale (never-logged) ids — getEffectiveTimeline only replaces days
  // from the marker's asOfDay onward — so without isDayFullySwept's filter,
  // countBehindDays kept counting all of them as still "behind" even though
  // TodayTab/TimelineTab already collapsed those same days to "Tasks
  // rescheduled" and the earliest-behind-day catch-up scan (which does
  // apply this filter) correctly found nothing left.
  test("a day whose ids are all listed on the reschedule marker reads as moved, not behind, even with zero logged sessions", () => {
    const piece = basePiece({
      progress: {}, // nothing logged anywhere — the pre-fix bug counted every day below as behind
      rescheduleMarker: { asOfDay: 3, remainingChunkOrder: ["c1", "c2"], remainingConnectorIds: [], previous: null },
    });
    const timeline = {
      days: [
        { dayNumber: 1, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] },
        { dayNumber: 2, newChunkIds: ["c2"], specialChunkIds: [], reviewChunkIds: [] },
      ],
    };
    // Sanity: classifyDayCompletion alone (with no sweep awareness) still
    // calls both "behind" — isDayFullySwept is a separate filter layered
    // on top, not a change to classifyDayCompletion itself.
    assert.equal(classifyDayCompletion(timeline.days[0], piece, 5), "behind");
    assert.equal(classifyDayCompletion(timeline.days[1], piece, 5), "behind");
    assert.equal(countBehindDays(piece, timeline, 5), 0);
  });

  test("a day with a genuine mix of swept and still-real content still counts as behind — only a FULLY swept day is excluded", () => {
    const piece = basePiece({
      progress: {},
      rescheduleMarker: { asOfDay: 3, remainingChunkOrder: ["c1"], remainingConnectorIds: [], previous: null },
    });
    const timeline = {
      days: [
        // c1 was swept (listed on the marker); c2 was NOT — c2 still has
        // real, unaddressed content on this day, so it must stay "behind".
        { dayNumber: 1, newChunkIds: ["c1", "c2"], specialChunkIds: [], reviewChunkIds: [] },
      ],
    };
    assert.equal(countBehindDays(piece, timeline, 5), 1);
  });

  test("a day at or after the marker's asOfDay is never treated as swept — getEffectiveTimeline only replaces days from asOfDay onward", () => {
    const piece = basePiece({
      progress: {},
      rescheduleMarker: { asOfDay: 1, remainingChunkOrder: ["c1"], remainingConnectorIds: [], previous: null },
    });
    const timeline = {
      days: [{ dayNumber: 1, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] }],
    };
    // dayNumber (1) >= asOfDay (1): this is a day the rescheduled remainder
    // itself placed c1 onto, not a stale pre-reschedule day — must still
    // read as behind if untouched.
    assert.equal(countBehindDays(piece, timeline, 5), 1);
  });

  test("a connector that rode along via a linked practice chunk is only recognized as swept when chunkById is supplied", () => {
    // t1 is a transition whose own id is never placed on the marker (only
    // practice-chunk ids ever are) — it only reads as "moved" via its
    // linkedIds pointing at c1, which chunkById is needed to resolve.
    const piece = basePiece({
      progress: {},
      rescheduleMarker: { asOfDay: 3, remainingChunkOrder: ["c1"], remainingConnectorIds: [], previous: null },
    });
    const timeline = {
      days: [{ dayNumber: 1, newChunkIds: [], specialChunkIds: ["t1"], reviewChunkIds: [] }],
    };
    const chunkById = { t1: { kind: "transition", linkedIds: ["c1", "c5"] } };
    // Without chunkById (defaults to {}), t1 can't be resolved to a chunk
    // at all — isMovedId's `if (!c || !c.linkedIds) return false` bails,
    // so the day is (correctly, conservatively) still counted as behind.
    assert.equal(countBehindDays(piece, timeline, 5), 1);
    // With chunkById supplied, the linkedIds fallback recognizes t1 as
    // having ridden along with c1 into the rescheduled remainder.
    assert.equal(countBehindDays(piece, timeline, 5, chunkById), 0);
  });
});

describe("Pass 75 follow-up — isDayFullySwept also recognizes an id done on a different day, not just one still 'remaining' on the current marker", () => {
  // The gap this closes: an id swept by an *earlier* reschedule and then
  // genuinely completed before a *later* one drops out of the later
  // marker's remainingChunkOrder (correctly — it's done), so checking only
  // the current marker misses that its original, pre-first-reschedule day
  // was ever swept at all. Rather than walking the whole chain of past
  // markers to answer "was this ever swept by *any* reschedule" (an O(number
  // of reschedules) question), the fix asks a simpler, equivalent question
  // that doesn't reference markers at all: has this id been done on some
  // OTHER day? If so, its presence here is stale regardless of *why* — one
  // O(1) doneDays lookup, same cost no matter how many times the piece has
  // been rescheduled.
  test("an id done on a different day than the one being checked reads as moved, even with no rescheduleMarker.previous chain to walk", () => {
    const piece = basePiece({
      progress: { c1: { doneDays: [5] } }, // done, but on day 5 — not day 1
      rescheduleMarker: { asOfDay: 3, remainingChunkOrder: [], remainingConnectorIds: [], previous: null },
    });
    const timeline = {
      days: [{ dayNumber: 1, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] }],
    };
    // c1 isn't in remainingChunkOrder (it's done, not "remaining") — before
    // this fix, that alone meant day 1 read as still behind.
    assert.equal(isDayFullySwept(timeline.days[0], piece), true);
    assert.equal(countBehindDays(piece, timeline, 5), 0);
  });

  test("[regression] the exact two-reschedule scenario: a chunk relocated by an earlier reschedule and completed before a later one", () => {
    // Mirrors a direct script repro against the real scheduler functions,
    // not just a hand-built fixture: reschedule A relocates c1 off day 1;
    // c1 gets logged done on its new day; reschedule B then correctly
    // excludes c1 from ITS OWN remainingChunkOrder (it's done) — the
    // question is whether day 1 (untouched by either marker's own
    // recompute, since it's before both asOfDays) still learns c1 was
    // ever swept.
    const markerA = { asOfDay: 5, remainingChunkOrder: ["c1"], remainingConnectorIds: [], previous: null };
    const piece = basePiece({
      progress: { c1: { doneDays: [5] } }, // completed on day 5, the day markerA relocated it to
      rescheduleMarker: { asOfDay: 10, remainingChunkOrder: [], remainingConnectorIds: [], previous: markerA },
    });
    const day1 = { dayNumber: 1, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] };
    assert.equal(isDayFullySwept(day1, piece), true);
  });

  test("does NOT over-collapse: an id done exactly on the day being checked still renders as real, done content", () => {
    const piece = basePiece({
      progress: { c1: { doneDays: [1] } }, // done, and on day 1 itself
      rescheduleMarker: { asOfDay: 3, remainingChunkOrder: [], remainingConnectorIds: [], previous: null },
    });
    const day1 = { dayNumber: 1, newChunkIds: ["c1"], specialChunkIds: [], reviewChunkIds: [] };
    // c1's own completion day matches this day exactly — this is genuine,
    // current content (classifyDayCompletion already calls it "done"), not
    // a stale leftover, so it must NOT collapse to "Tasks rescheduled".
    assert.equal(isDayFullySwept(day1, piece), false);
  });

  test("a mixed day (an introduction id done elsewhere, plus a genuine still-open review) still renders normally, not swept", () => {
    const piece = basePiece({
      progress: {
        c1: { doneDays: [5] }, // introduced here, but done on day 5 — stale here
        c9: { doneDays: [1] }, // c9's own introduction, logged day 1 — now due for review again
      },
      rescheduleMarker: { asOfDay: 3, remainingChunkOrder: [], remainingConnectorIds: [], previous: null },
    });
    const day1 = {
      dayNumber: 1,
      newChunkIds: ["c1"],
      specialChunkIds: [],
      // c9's review is due today (day 1) but hasn't been logged today —
      // c9's own doneDays ([1]) is from its original introduction, not
      // this review, which is exactly the shape that would trip the
      // "done elsewhere" check if it weren't scoped away from reviews.
      reviewChunkIds: ["c9"],
    };
    // c1 alone would satisfy isMovedId (done elsewhere), but c9's review
    // is real, unaddressed, still-due work — the day must render
    // normally, not collapse.
    assert.equal(isDayFullySwept(day1, piece), false);
  });

  test("[regression] a genuine, not-yet-logged Tier 2 review must never read as swept, no matter how stale its chunk's prior doneDays look", () => {
    // The bug this guards against: a chunk under review always has SOME
    // prior doneDays (that's why it's due for review again), almost never
    // including this specific review day until it's actually logged.
    // Naively applying the same "done elsewhere" test used for
    // introductions to reviewChunkIds would misread nearly every
    // legitimate, still-open review as stale.
    const piece = basePiece({
      progress: { c1: { doneDays: [2] } }, // introduced/practiced day 2 only
      rescheduleMarker: { asOfDay: 20, remainingChunkOrder: [], remainingConnectorIds: [], previous: null },
    });
    const day8 = { dayNumber: 8, newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c1"] };
    assert.equal(isDayFullySwept(day8, piece), false);
  });
});

describe("withLiveReviewStatus — a review whose due date has passed shouldn't look like a still-open task on its original day", () => {
  // The bug this fixes has nothing to do with rescheduling:
  // computeTimeline's Tier 2 placement has no notion of "today", so once a
  // review's placement day is in the past, it just sits there forever,
  // unaddressed — duplicating what mergeLiveDueReviews (lib/maintenance.js,
  // Pass 66) already, separately, surfaces on today's own screen.
  test("a review not logged on its own (past) placement day gets pulled out of reviewChunkIds and reported as staleReviewIds", () => {
    const piece = basePiece({ progress: { c1: { doneDays: [2], nextDueDate: "2026-01-08" } } });
    const timeline = {
      days: [
        { dayNumber: 8, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c1"] },
      ],
    };
    const result = withLiveReviewStatus(timeline, piece, 15); // "today" is day 15 — day 8 is in the past
    assert.deepEqual(result.days[0].reviewChunkIds, []);
    assert.deepEqual(result.days[0].staleReviewIds, ["c1"]);
  });

  test("a review actually logged on its own placement day is left alone — it's genuine, current content, not stale", () => {
    const piece = basePiece({ progress: { c1: { doneDays: [8] } } }); // logged exactly on day 8
    const timeline = {
      days: [{ dayNumber: 8, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c1"] }],
    };
    const result = withLiveReviewStatus(timeline, piece, 15);
    assert.deepEqual(result.days[0].reviewChunkIds, ["c1"]);
    assert.equal(result.days[0].staleReviewIds, undefined);
  });

  test("a review on today or a future day is never touched, even if unlogged", () => {
    const piece = basePiece({ progress: {} });
    const timeline = {
      days: [
        { dayNumber: 15, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c1"] }, // today
        { dayNumber: 20, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c5"] }, // future
      ],
    };
    const result = withLiveReviewStatus(timeline, piece, 15);
    assert.deepEqual(result.days[0].reviewChunkIds, ["c1"]);
    assert.deepEqual(result.days[1].reviewChunkIds, ["c5"]);
  });

  test("a mixed day: only the stale review is pulled, real newChunkIds/specialChunkIds content is untouched", () => {
    const piece = basePiece({ progress: { c1: { doneDays: [2], nextDueDate: "2026-01-08" } } });
    const timeline = {
      days: [{ dayNumber: 8, type: "learning", newChunkIds: ["c9"], specialChunkIds: ["t1"], reviewChunkIds: ["c1"] }],
    };
    const result = withLiveReviewStatus(timeline, piece, 15);
    assert.deepEqual(result.days[0].newChunkIds, ["c9"]);
    assert.deepEqual(result.days[0].specialChunkIds, ["t1"]);
    assert.deepEqual(result.days[0].reviewChunkIds, []);
    assert.deepEqual(result.days[0].staleReviewIds, ["c1"]);
  });

  test("[regression] a Tier 1 'first touch' review (never logged at all, no nextDueDate) is never treated as stale", () => {
    // Found live, not hypothetical: a Tier 1 review is placed the day
    // after a chunk's introduction for a chunk that's NEVER been logged
    // (computeTimeline, above) — such a chunk has no progress entry at
    // all, so an earlier version of this fix (checking only doneDays,
    // no nextDueDate) treated it exactly like a stale Tier 2 review and
    // stripped it — but computeDueReviews' own gate requires
    // entry.nextDueDate to surface anything live, so a Tier 1 review
    // pulled this way would vanish with literally nothing live to point
    // to instead. Reproduced against a real 16-measure, 4-chunk piece in
    // the browser before this guard existed: every never-touched chunk's
    // first-touch review disappeared from Timeline/Week view/Master
    // Agenda, mislabeled "Now due — see today" even though nothing
    // showed there.
    const piece = basePiece({ progress: {} }); // c9 has no progress entry at all
    const timeline = {
      days: [{ dayNumber: 2, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c9"] }],
    };
    const result = withLiveReviewStatus(timeline, piece, 15);
    assert.deepEqual(result.days[0].reviewChunkIds, ["c9"]);
    assert.equal(result.days[0].staleReviewIds, undefined);
  });

  test("[regression] a consolidation day's reviewChunkIds (every practice chunk, regardless of ladder state) is never touched", () => {
    // Consolidation days blanket reviewChunkIds with every practice chunk
    // (computeTimeline) — a completely different mechanism (the
    // synthetic "__consolidation__" progress key, not each chunk's own
    // doneDays) that happens to reuse the same field name. Confirmed this
    // doesn't get misread as a pile of stale Tier 2 reviews.
    const piece = basePiece({ progress: {} }); // nothing logged for c1/c5 anywhere
    const timeline = {
      days: [{ dayNumber: 8, type: "consolidation", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c1", "c5"] }],
    };
    const result = withLiveReviewStatus(timeline, piece, 15);
    assert.deepEqual(result.days[0].reviewChunkIds, ["c1", "c5"]);
    assert.equal(result.days[0].staleReviewIds, undefined);
  });

  test("a paused piece is left entirely untouched — its live due list is suppressed too, so stripping here would leave nothing to point to", () => {
    const piece = basePiece({ status: "paused", progress: {} });
    const timeline = {
      days: [{ dayNumber: 8, type: "learning", newChunkIds: [], specialChunkIds: [], reviewChunkIds: ["c1"] }],
    };
    const result = withLiveReviewStatus(timeline, piece, 15);
    assert.strictEqual(result, timeline);
  });
});

describe("Pass 16 — shouldShowScheduleBanner, redefined in Pass 39 around isPlanActuallyComplete", () => {
  // timeline.days.length is the only field isPlanActuallyComplete reads off
  // timeline itself — a 10-entry array stands in for a 10-day plan.
  const timeline = { days: Array(10) };
  const startedDaysAgo = (n) => addDaysISO(todayISODate(), -n);

  test("[fix — the exact symptom this pass exists for] past the plan but real work remains: keeps warning instead of going silent", () => {
    // Pre-Pass-39, this suppressed purely on elapsedDay > days.length,
    // regardless of whether anything was actually missed — a piece behind
    // schedule with its calendar days elapsed went silent instead of
    // continuing to warn. Nothing logged at all, 11 days elapsed on a
    // 10-day plan: isPlanActuallyComplete must read false here.
    const piece = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(10) });
    const chunkSet = generateAllChunks(piece);
    assert.equal(shouldShowScheduleBanner(piece, chunkSet, timeline, 3), true, "one day past the plan, 3 chunks missed — must not go silent");
    assert.equal(shouldShowScheduleBanner(piece, chunkSet, timeline, 1), true, "long past the plan, 1 chunk missed — must not go silent");
  });

  test("past the plan and genuinely complete (every scheduled item logged): hidden, regardless of what missedCount claims", () => {
    const piece0 = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(10) });
    const chunkSet = generateAllChunks(piece0);
    const progress = Object.fromEntries(chunkSet.all.map((c) => [c.id, { doneDays: [1] }]));
    const piece = { ...piece0, progress };
    // isPlanActuallyComplete short-circuits shouldShowScheduleBanner before
    // missedCount is ever consulted — a nonzero value here couldn't happen
    // in real use (computeScheduleStatus derives missedCount from the same
    // doneDays data), but proves the completeness check really does take
    // precedence rather than happening to agree with missedCount by luck.
    assert.equal(shouldShowScheduleBanner(piece, chunkSet, timeline, 3), false);
  });

  test("still within the plan, a real missedCount shows the banner (unchanged behavior)", () => {
    const piece = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(4) }); // day 5 of 10
    const chunkSet = generateAllChunks(piece);
    assert.equal(shouldShowScheduleBanner(piece, chunkSet, timeline, 2), true);
  });

  test("still within the plan, nothing missed hides the banner (unchanged behavior)", () => {
    const piece = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(4) });
    const chunkSet = generateAllChunks(piece);
    assert.equal(shouldShowScheduleBanner(piece, chunkSet, timeline, 0), false);
  });

  test("boundary: elapsedDay exactly at the plan's last day is not yet 'past' it — missedCount still governs", () => {
    const piece = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(9) }); // day 10 of 10
    const chunkSet = generateAllChunks(piece);
    assert.equal(shouldShowScheduleBanner(piece, chunkSet, timeline, 2), true, "day 10 of a 10-day plan is still in the plan, not past it");
  });

  // Same-session follow-up to Pass 70: ScheduleBanner.jsx now passes
  // countBehindDays here instead of computeScheduleStatus's missedCount —
  // this proves why. missedCount only ever looks at base practice chunks,
  // so a piece that's touched every one of those but left a transition,
  // combo, or review sitting unlogged past its day used to read as fully
  // caught up and suppress the banner entirely.
  test("[fix, same-session follow-up] a piece with every practice chunk touched but a transition/combo/review still stuck: the old missedCount signal stayed silent, the new day-count signal correctly still flags it", () => {
    const piece0 = basePiece({
      totalMeasures: 12,
      measureDifficulty: Array(12).fill(1),
      customChunkSize: 4, // 3 practice chunks -> 2 transitions between them
      minutesPerDay: 5,
      startDate: todayISODate(), // keeps isPlanActuallyComplete's own elapsedDay check trivially false
      daysToLearn: 30,
      progress: {},
    });
    const chunkSet = generateAllChunks(piece0);
    const fullTimeline = computeTimeline(piece0, chunkSet);
    const currentDay = fullTimeline.days.length + 5;

    // Touch every practice chunk on the exact day it was introduced — but
    // never touch a transition/combo, so nothing but those is left open.
    const progress = {};
    fullTimeline.days.forEach((day) => {
      day.newChunkIds.forEach((id) => {
        progress[id] = progress[id] || { doneDays: [] };
        progress[id].doneDays.push(day.dayNumber);
      });
    });
    const piece = { ...piece0, progress };

    const status = computeScheduleStatus(piece, chunkSet.practiceChunks, fullTimeline, currentDay);
    assert.equal(status.missedCount, 0, "fixture must have zero missed practice chunks for this check to mean anything");

    const behindDays = countBehindDays(piece, fullTimeline, currentDay);
    assert.ok(behindDays > 0, "an unlogged transition/combo left past its day should still register as a behind day");

    assert.equal(
      shouldShowScheduleBanner(piece, chunkSet, fullTimeline, status.missedCount),
      false,
      "the old, narrower signal wrongly went silent here"
    );
    assert.equal(
      shouldShowScheduleBanner(piece, chunkSet, fullTimeline, behindDays),
      true,
      "the new, wider signal correctly still flags this piece as behind"
    );
  });
});

describe("isPlanActuallyComplete — Pass 39: what 'the plan is actually finished' means per scheduleMode", () => {
  const startedDaysAgo = (n) => addDaysISO(todayISODate(), -n);

  describe("scheduleMode: 'days'", () => {
    test("still within the plan: never complete, regardless of progress", () => {
      const piece = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(4) }); // day 5 of 10
      const chunkSet = generateAllChunks(piece);
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), false);
    });

    test("past the target date with incomplete chunks: not complete", () => {
      const piece = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(10) }); // day 11 of 10, nothing logged
      const chunkSet = generateAllChunks(piece);
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), false);
    });

    test("past the target date with every scheduled item (practice chunks, transitions, combos) logged: complete", () => {
      const piece0 = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(10) });
      const chunkSet = generateAllChunks(piece0);
      const progress = Object.fromEntries(chunkSet.all.map((c) => [c.id, { doneDays: [1] }]));
      const piece = { ...piece0, progress };
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), true);
    });

    test("past the target date but a single item (e.g. a transition) still untouched: not complete", () => {
      const piece0 = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(10) });
      const chunkSet = generateAllChunks(piece0);
      assert.ok(chunkSet.all.length > 1, "test setup sanity check — needs at least one item to leave untouched");
      const progress = Object.fromEntries(chunkSet.all.slice(1).map((c) => [c.id, { doneDays: [1] }]));
      const piece = { ...piece0, progress };
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), false);
    });
  });

  describe("scheduleMode: 'minutes'", () => {
    test("past the original day count with a chunk not yet at Holding: not complete, even though every chunk has been logged", () => {
      const piece0 = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(10) });
      const chunkSet = generateAllChunks(piece0);
      const progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1], stage: "settling" }]));
      const piece = { ...piece0, progress };
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), false);
    });

    test("past the original day count with every practice chunk at Holding: complete", () => {
      const piece0 = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(10) });
      const chunkSet = generateAllChunks(piece0);
      const progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1], stage: "holding" }]));
      const piece = { ...piece0, progress };
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), true);
    });

    test("still within the plan: not complete even with every chunk already at Holding — the calendar gate comes first", () => {
      const piece0 = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(4) });
      const chunkSet = generateAllChunks(piece0);
      const progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1], stage: "holding" }]));
      const piece = { ...piece0, progress };
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), false);
    });
  });
});

describe("computeAbandonedPlanReminder — a still-unfinished plan gone quiet for 14+ days, escalating weekly", () => {
  const daysAgo = (n) => addDaysISO(todayISODate(), -n);
  // Long enough plan that a piece can be 14-30+ days stale and still be
  // well inside its own calendar window (targetDatePassed: false cases).
  const midPlanPiece = (overrides) =>
    basePiece({ daysToLearn: 100, startDate: daysAgo(40), lastLoggedAt: daysAgo(14), ...overrides });

  test("returns null when fewer than 14 days have passed since lastLoggedAt", () => {
    const piece = midPlanPiece({ lastLoggedAt: daysAgo(13) });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeAbandonedPlanReminder(piece, chunkSet, timeline), null);
  });

  test("fires at exactly 14 days stale, mid-plan (target date not yet passed)", () => {
    const piece = midPlanPiece({ lastLoggedAt: daysAgo(14) });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    const result = computeAbandonedPlanReminder(piece, chunkSet, timeline);
    assert.equal(result.daysSinceLogged, 14);
    assert.equal(result.milestoneDays, 14);
    assert.equal(result.targetDatePassed, false);
  });

  // Message 2's literal ask: "fire this reminder every week after (21
  // days, 28 days, etc)" — milestoneDays should hold at the same value for
  // a whole week, then step, not creep up every single day.
  for (const [daysSinceLogged, expectedMilestone] of [
    [14, 14],
    [15, 14],
    [20, 14],
    [21, 21],
    [27, 21],
    [28, 28],
  ]) {
    test(`daysSinceLogged=${daysSinceLogged} reports milestoneDays=${expectedMilestone}`, () => {
      const piece = midPlanPiece({ lastLoggedAt: daysAgo(daysSinceLogged) });
      const chunkSet = generateAllChunks(piece);
      const timeline = getEffectiveTimeline(piece, chunkSet);
      assert.equal(computeAbandonedPlanReminder(piece, chunkSet, timeline).milestoneDays, expectedMilestone);
    });
  }

  test("targetDatePassed is true once the plan's own day count has elapsed, with real work still left", () => {
    const piece0 = basePiece({ daysToLearn: 10, startDate: daysAgo(20), lastLoggedAt: daysAgo(20) });
    const chunkSet = generateAllChunks(piece0);
    const timeline = getEffectiveTimeline(piece0, chunkSet);
    // Nothing logged — isPlanActuallyComplete is false, so the reminder
    // still applies; it just also reports the target date as passed.
    const result = computeAbandonedPlanReminder(piece0, chunkSet, timeline);
    assert.ok(result);
    assert.equal(result.targetDatePassed, true);
  });

  test("returns null once the plan is actually complete — that's revival's staleness reason's territory instead", () => {
    const piece0 = basePiece({ daysToLearn: 10, startDate: daysAgo(20), lastLoggedAt: daysAgo(20) });
    const chunkSet = generateAllChunks(piece0);
    const progress = Object.fromEntries(chunkSet.all.map((c) => [c.id, { doneDays: [1] }]));
    const piece = { ...piece0, progress };
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(isPlanActuallyComplete(piece, chunkSet, timeline), true);
    assert.equal(computeAbandonedPlanReminder(piece, chunkSet, timeline), null);
  });

  test("returns null when lastLoggedAt is unset — a piece never logged at all is a different situation, not extended via createdAt", () => {
    const piece = midPlanPiece({ lastLoggedAt: null });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeAbandonedPlanReminder(piece, chunkSet, timeline), null);
  });

  test("returns null for a paused piece", () => {
    const piece = midPlanPiece({ status: "paused" });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeAbandonedPlanReminder(piece, chunkSet, timeline), null);
  });

  test("returns null for an archived piece", () => {
    const piece = midPlanPiece({ status: "archived" });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeAbandonedPlanReminder(piece, chunkSet, timeline), null);
  });

  test("returns null for a piece mid-revival — revival is its own recovery flow with its own messaging", () => {
    const piece = midPlanPiece({ revival: { active: true } });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeAbandonedPlanReminder(piece, chunkSet, timeline), null);
  });
});

describe("computeMinutesModeAutoExtend — Pass 39: keeps a minutes-mode plan producing real tasks until the piece is actually learned", () => {
  const startedDaysAgo = (n) => addDaysISO(todayISODate(), -n);

  test("wrong scheduleMode: no-op", () => {
    const piece = basePiece({ daysToLearn: 10, startDate: startedDaysAgo(10) }); // "days" mode (default)
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeMinutesModeAutoExtend(piece, chunkSet, timeline), null);
  });

  test("still within the plan: no-op regardless of ladder state", () => {
    const piece = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(4) });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeMinutesModeAutoExtend(piece, chunkSet, timeline), null);
  });

  test("past the original day count with every chunk already at Holding: no-op, the piece is actually done", () => {
    const piece0 = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(10) });
    const chunkSet = generateAllChunks(piece0);
    const progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1], stage: "holding" }]));
    const piece = { ...piece0, progress };
    const timeline = getEffectiveTimeline(piece, chunkSet);
    assert.equal(computeMinutesModeAutoExtend(piece, chunkSet, timeline), null);
  });

  test("past the original day count with a chunk not yet at Holding: extends daysToLearn, anchors the marker at the new final day", () => {
    const piece0 = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(10) }); // elapsedDay 11
    const chunkSet = generateAllChunks(piece0);
    // Every practice chunk already touched (so remainingChunkIds comes out
    // empty, below) but not yet graduated — the realistic trigger case,
    // since computeTimeline guarantees full introduction well within the
    // *original* plan.
    const progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1], stage: "settling" }]));
    const piece = { ...piece0, progress };
    const timeline = getEffectiveTimeline(piece, chunkSet);

    const result = computeMinutesModeAutoExtend(piece, chunkSet, timeline);
    assert.ok(result, "an extension patch is returned");
    assert.ok(result.daysToLearn > piece.daysToLearn, "daysToLearn actually grows");
    assert.ok(result.daysToLearn >= 11, "grows at least far enough to cover today (elapsedDay 11)");
    assert.deepEqual(result.rescheduleMarker.remainingChunkOrder, [], "nothing is actually untouched here");
    assert.equal(
      result.rescheduleMarker.asOfDay,
      result.daysToLearn,
      "anchored at the *new* final day (not the old one) so an empty remainingChunkOrder can't blank the whole extended region — see the comment on this function"
    );
  });

  test("applying the extension makes the plan catch up to today in one step, even after a long absence", () => {
    const piece0 = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(30) }); // elapsedDay 31
    const chunkSet = generateAllChunks(piece0);
    const progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1], stage: "settling" }]));
    const piece = { ...piece0, progress };
    const timeline = getEffectiveTimeline(piece, chunkSet);

    const result = computeMinutesModeAutoExtend(piece, chunkSet, timeline);
    const extended = { ...piece, ...result };
    const extendedChunkSet = generateAllChunks(extended);
    const extendedTimeline = getEffectiveTimeline(extended, extendedChunkSet);

    assert.ok(extendedTimeline.days.length >= 31, "the plan itself now covers today, in one shot rather than several reactive re-fires");
    assert.equal(
      isPlanActuallyComplete(extended, extendedChunkSet, extendedTimeline),
      false,
      "still not learned, so still correctly not 'complete' — only the calendar gate moved"
    );
  });

  // Same gap as handleReschedule/planRescheduleForPieces (Pass 65/73) —
  // flagged as deliberately unfixed at the time, then fixed here on
  // request. Every practice chunk touched (remainingChunkOrder empty,
  // matching this function's own "typically empty here" comment) but one
  // transition genuinely never logged — the marker this function builds
  // must carry it via remainingConnectorIds, not just silently strand it.
  test("[fix] a stuck, never-logged transition is carried into the marker via remainingConnectorIds, not stranded", () => {
    const piece0 = basePiece({ scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(10) }); // elapsedDay 11
    const chunkSet = generateAllChunks(piece0);
    const progress = Object.fromEntries(chunkSet.practiceChunks.map((c) => [c.id, { doneDays: [1], stage: "settling" }]));
    const piece = { ...piece0, progress };
    const timeline = getEffectiveTimeline(piece, chunkSet);

    const result = computeMinutesModeAutoExtend(piece, chunkSet, timeline);
    assert.ok(result, "an extension patch is returned");
    assert.deepEqual(
      result.rescheduleMarker.remainingConnectorIds.sort(),
      chunkSet.transitions.map((t) => t.id).sort(),
      "every never-touched transition is carried, since none of them have been logged at all"
    );

    // Confirm it's not just present in the marker but actually re-placed —
    // the same relocation check used for the other two call sites.
    const rescheduled = { ...piece, ...result };
    const after = getEffectiveTimeline(rescheduled, chunkSet);
    const stuckId = result.rescheduleMarker.remainingConnectorIds[0];
    const newOccurrence = after.days.find(
      (d) =>
        d.dayNumber >= result.rescheduleMarker.asOfDay &&
        [...d.newChunkIds, ...d.specialChunkIds, ...d.reviewChunkIds].includes(stuckId)
    );
    assert.ok(newOccurrence, "the stuck transition must be re-placed somewhere in the extended remainder");
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
    // 2026-01-01); nextDueDate 2026-01-20 is 6 days after that, so its raw
    // due day (before any smoothing) is original-plan day 20 (asOfDay +
    // (6 - 1)) — never dropped, and never resolved against the ORIGINAL
    // day-1 anchor (which would try to place it at day 20 relative to
    // Jan 1, an entirely different, coincidentally-plausible-looking day
    // number this assertion would not by itself catch — the real guard
    // against that is the second half of this test).
    //
    // Asserting "found, on or after day 20" rather than exactly day 20:
    // the review-load smoothing pass (rule 5, forward-only — never
    // earlier than due) can legitimately nudge it a little later still to
    // relieve an overloaded day, and which days end up overloaded depends
    // on the introduction-day distribution, not on this date-anchoring fix
    // — an exact-day assertion would incidentally couple this test to that
    // distribution instead of the thing it's actually guarding.
    let foundDay = null;
    effective.days.forEach((d, i) => {
      if (d.type !== "consolidation" && d.reviewChunkIds.includes("c1")) foundDay = i + 1;
    });
    assert.ok(foundDay !== null, "c1's Tier 2 review must land somewhere in the rescheduled window");
    assert.ok(foundDay >= 20, `c1 landed on day ${foundDay}, before its raw due day 20 relative to the reschedule anchor — smoothing must never drift a review earlier than due`);

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

describe("[regression] getEffectiveTimeline must chain through a piece's reschedule history, not just its latest marker", () => {
  // Found via manual double-reschedule testing (not a hypothetical): a
  // chunk placed by a first reschedule, then actually practiced and logged
  // there, went on to display as an entirely different, never-touched
  // chunk once a second reschedule ran — see the day-5 assertion below,
  // which reproduces that exact swap. Root cause: `original` (the source
  // for every day before the *current* marker's asOfDay) was always the
  // raw, never-rescheduled computeTimeline result, with no memory of what
  // an earlier reschedule had actually placed there. The fix chains each
  // marker to the one before it (`previous`) so `original` is computed
  // recursively off the marker chain instead of always starting from
  // scratch.
  test("a chunk placed by the first reschedule and then practiced still shows there after a second reschedule", () => {
    const allTenIds = ["c1", "c5", "c9", "c13", "c17", "c21", "c25", "c29", "c33", "c37"];
    const marker1 = { asOfDay: 5, remainingChunkOrder: allTenIds };
    // c1 is excluded from marker2's remainingChunkOrder because it's now
    // touched — exactly how App.jsx's handleReschedule builds a real second
    // marker (computeScheduleStatus only ever lists untouched chunks).
    const marker2 = {
      asOfDay: 7,
      remainingChunkOrder: allTenIds.filter((id) => id !== "c1"),
      previous: marker1,
    };
    const piece = basePiece({
      totalMeasures: 40,
      customChunkSize: 4,
      daysToLearn: 30,
      minutesPerDay: 500,
      // The first reschedule placed c1 on day 5 (asserted via the
      // "sanity check" below, computed independently); this is what
      // actually logging it there looks like.
      progress: { c1: { doneDays: [5], sessions: [{ day: 5, cleanReps: 3, bpm: 60, outcome: "pass" }] } },
      rescheduleMarker: marker2,
    });
    const chunkSet = generateAllChunks(piece);

    // Sanity check, independent of the fix: confirms c1 really does land on
    // day 5 under marker1 alone, so the rest of this test is exercising the
    // exact placement a real user would have practiced against.
    const afterFirstReschedule = getEffectiveTimeline({ ...piece, progress: {}, rescheduleMarker: marker1 }, chunkSet);
    assert.deepEqual(afterFirstReschedule.days[4].newChunkIds, ["c1"], "test setup sanity check: first reschedule alone must place c1 on day 5");

    const effective = getEffectiveTimeline(piece, chunkSet);
    assert.deepEqual(effective.days[4].newChunkIds, ["c1"], "day 5 must still show c1 — where it was actually placed and practiced — not revert to whatever day 5 held before any reschedule ever ran");
    assert.equal(effective.introducedDay.c1, 5, "c1's introducedDay must stay anchored to where it was actually placed (day 5), not fall back to its original pre-any-reschedule introduction day");

    // Prove the fix is load-bearing, not coincidental: recompute what the
    // OLD (unfixed) code would have shown for day 5 — the raw, never-
    // rescheduled schedule, exactly what `original` fell back to before
    // this fix existed. It doesn't just show c1 as unstarted; it shows a
    // completely different, unrelated chunk in its place, which is the
    // more dramatic real symptom this test guards against.
    const unfixedOriginal = computeTimeline(piece, chunkSet);
    assert.notDeepEqual(unfixedOriginal.days[4].newChunkIds, ["c1"], "confirms the bug this fix guards against was real: the unfixed raw original disagrees with what was actually placed and practiced on day 5");
  });
});

describe("[regression, Codex review] computeDaysNeededForMinutesPerDay's review-cost padding must reflect the new one-touch-at-a-time model", () => {
  test("a piece with many chunks gets a smaller day-count estimate than the stale fixed-four-reviews-per-item assumption would have produced", () => {
    // 80 measures / 4-measure chunks = 20 chunks, at a minutesPerDay
    // budget (100) large enough that the per-item review-padding
    // constant actually changes how many items fit per day (at smaller
    // budgets, introduction cost alone already dominates the per-day
    // budget regardless of the review constant, so the two formulas
    // would coincidentally agree — this input was chosen by actually
    // comparing old vs. new output across a range of budgets, not
    // guessed).
    //
    // Expected value updated by a later, separate fix (difficulty-based
    // review costing — minutesFor and this function now both price a
    // review touch at chunk.effort * EFFORT_TO_MIN, not a flat 3 minutes).
    // That fix legitimately raised this number back up from 14 to 28: the
    // original 14 was itself computed on top of a since-corrected
    // under-estimate (every review costing a flat, difficulty-blind 3
    // minutes), so once review cost was corrected to scale with how hard
    // the chunk actually is, the true amount of day-count padding needed
    // came out higher again — this is the fixed-touches-per-item guard
    // (2, not the stale REVIEW_OFFSETS.length of 4) reflected through the
    // corrected per-touch cost, not a reversion of the touches-per-item
    // fix itself. That the result (28) happens to match what the truly
    // stale 4-touches/flat-3-min formula would have produced is a
    // numeric coincidence for this specific input, not a sign either fix
    // was undone — the two formulas disagree in general (8.8 vs. 12
    // effort-points padding per item here) and only land on the same
    // final day count after several rounding/ceiling steps. Re-verified
    // by temporarily reverting the review-pricing fix and re-running this
    // test to see it fail back to 14.
    const piece = basePiece({ totalMeasures: 80, customChunkSize: 4, recurringMode: "none" });
    const chunkSet = generateAllChunks(piece);
    const days = computeDaysNeededForMinutesPerDay(chunkSet, 100, 7);
    assert.equal(days, 28, "difficulty-based review costing raises the padding for this input back up from the old flat-cost estimate of 14 days");
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
    const remainingConnectorIds = computeRemainingConnectorIds(piece, chunkSet);

    const [plan] = planRescheduleForPieces({ piece });

    assert.deepEqual(plan.marker, { asOfDay: 6, remainingChunkOrder: remainingChunkIds, remainingConnectorIds, previous: null });
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

  test("[fix, Pass 39] a piece past the end of its own plan with real work remaining is no longer swept aside — it needs the bulk reschedule most", () => {
    // Through Pass 38 this gated on elapsedDay(piece) > timeline.days.length
    // alone — the same calendar-only bug shouldShowScheduleBanner had, just
    // in this sibling function. A days-mode piece whose target date passed
    // with nothing ever logged is exactly the piece "Reschedule all" should
    // catch, not exclude.
    const finishedLongAgo = basePiece({ name: "Old", daysToLearn: 10, startDate: startedDaysAgo(100) });
    const chunkSet = generateAllChunks(finishedLongAgo);
    const timeline = getEffectiveTimeline(finishedLongAgo, chunkSet);
    const { missedCount } = computeScheduleStatus(finishedLongAgo, chunkSet.practiceChunks, timeline, 10);
    assert.ok(missedCount > 0, "test setup sanity check — real work is genuinely outstanding");

    const plans = planRescheduleForPieces({ finishedLongAgo });
    assert.equal(plans.length, 1, "no longer excluded — real work outstanding means it belongs in the bulk reschedule");
    assert.equal(plans[0].pieceId, "finishedLongAgo");
  });

  test("[fix] a days-mode piece already past its own target date gets an `extend` patch, not just a repack", () => {
    // Being included (the fix above) isn't enough on its own: applying only
    // the marker leaves daysToLearn untouched, so the piece stays past its
    // own plan even after a "successful" bulk reschedule — the piece's
    // Master Agenda card would never actually clear. `extend` is what
    // closes that: same formula (elapsedDay - 1 + requiredDays) the
    // single-piece "Change target date" button uses, via
    // computeReschedulePastPlanExtension.
    const piece = basePiece({ name: "Old", daysToLearn: 10, startDate: startedDaysAgo(20) });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, 10);
    const { requiredDays } = estimateRescheduleFit(piece, chunkSet.practiceChunks, timeline, 10, remainingChunkIds);

    const [plan] = planRescheduleForPieces({ piece });
    assert.ok(plan.extend, "an extend patch is present");
    assert.equal(
      plan.extend.daysToLearn,
      elapsedDay(piece) - 1 + requiredDays,
      "anchored to the real elapsedDay, not the clamped asOfDay (10) — the two differ here since the piece is 20 days past a 10-day plan"
    );
    assert.ok(plan.extend.daysToLearn > piece.daysToLearn, "the plan actually grows");
    assert.equal(plan.extend.targetDate, addDaysISO(piece.startDate, plan.extend.daysToLearn - 1));
  });

  test("a piece that's merely tight but still inside its own plan gets no `extend` — unchanged pack-into-what's-left behavior", () => {
    const piece = behindPieceOnDay6({ name: "Tight", totalMeasures: 200, measureDifficulty: Array(200).fill(1) });

    const [plan] = planRescheduleForPieces({ piece });
    assert.equal(plan.extend, null, "still within its own plan — nothing to extend, whether or not it happens to fit");
  });

  test("a minutes-mode piece past its own day count gets no `extend` from the bulk path — it has its own separate, automatic fix", () => {
    // computeMinutesModeAutoExtend (App.jsx's effect) already handles this
    // the moment the piece is opened, with its own formula
    // (elapsedDay + 14). Giving it a second, differently-sized fix here
    // would just reintroduce two answers to the same question.
    const piece0 = basePiece({ name: "MinutesOld", scheduleMode: "minutes", daysToLearn: 10, startDate: startedDaysAgo(20) });
    const chunkSet = generateAllChunks(piece0);
    // Leave one practice chunk genuinely untouched so this piece clears the
    // remainingChunkIds.length === 0 guard and actually reaches the extend
    // computation, rather than being excluded earlier for an unrelated
    // reason.
    const progress = Object.fromEntries(chunkSet.practiceChunks.slice(1).map((c) => [c.id, { doneDays: [1], stage: "settling" }]));
    const piece = { ...piece0, progress };

    const [plan] = planRescheduleForPieces({ piece });
    assert.ok(plan, "test setup sanity check — the piece is included");
    assert.equal(plan.extend, null);
  });

  test("a piece whose plan is actually finished (every item logged) is still left alone", () => {
    // The behavior the old elapsedDay-only check was *trying* to protect —
    // preserved, just gated on real completeness (isPlanActuallyComplete)
    // instead of the calendar alone.
    const piece0 = basePiece({ name: "Old", daysToLearn: 10, startDate: startedDaysAgo(100) });
    const chunkSet = generateAllChunks(piece0);
    const progress = Object.fromEntries(chunkSet.all.map((c) => [c.id, { doneDays: [1] }]));
    const finishedLongAgo = { ...piece0, progress };

    assert.deepEqual(planRescheduleForPieces({ finishedLongAgo }), [], "genuinely done — a bulk reschedule must not touch it");
  });

  test("a piece with every chunk — practice AND every transition/combo — already practiced has nothing to reschedule", () => {
    const piece = behindPieceOnDay6({ name: "Done" });
    const chunkSet = generateAllChunks(piece);
    // Pass 73 follow-up to Pass 65: touching only practiceChunks here used
    // to still leave every transition/combo untouched — under the old,
    // neighbor-only inference that didn't matter (a reschedule couldn't see
    // them either way), but now that connectors are checked directly, a
    // piece with an untouched transition genuinely does have something to
    // reschedule. This test's own name promises "every chunk" — so the
    // fixture has to actually touch every chunk, including connectors, to
    // mean what it says.
    piece.progress = Object.fromEntries(chunkSet.all.map((c) => [c.id, { doneDays: [1] }]));

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

  // [fix, found in review] the sort used to key on missedCount alone, which
  // is always 0 for a connector-only piece by construction — meaning such
  // a piece always sorted dead last, no matter how many stuck connectors it
  // actually had. This proves connector count now genuinely affects
  // ordering between two otherwise-tied (missedCount 0) pieces.
  test("[fix] a connector-only piece with more stuck connectors sorts before one with fewer, not by insertion order", () => {
    function connectorOnlyPiece(overrides) {
      const piece0 = basePiece({
        minutesPerDay: 5,
        daysToLearn: 30,
        startDate: startedDaysAgo(20),
        progress: {},
        ...overrides,
      });
      const chunkSet = generateAllChunks(piece0);
      const timeline = getEffectiveTimeline(piece0, chunkSet);
      const progress = {};
      timeline.days.forEach((day) => {
        day.newChunkIds.forEach((id) => {
          progress[id] = progress[id] || { doneDays: [] };
          progress[id].doneDays.push(day.dayNumber);
        });
      });
      return { ...piece0, progress };
    }

    // 12 measures / customChunkSize 4 -> 3 practice chunks -> 2 transitions.
    const fewerStuck = connectorOnlyPiece({ name: "FewerStuck", totalMeasures: 12, measureDifficulty: Array(12).fill(1) });
    // 20 measures -> 5 practice chunks -> 4 transitions.
    const moreStuck = connectorOnlyPiece({ name: "MoreStuck", totalMeasures: 20, measureDifficulty: Array(20).fill(1) });

    const plans = planRescheduleForPieces({ fewerStuck, moreStuck });

    assert.equal(plans.length, 2, "test setup sanity check — both are reschedulable via their stuck connectors");
    assert.ok(plans.every((p) => p.missedCount === 0), "test setup sanity check — both tie at missedCount 0");
    assert.equal(plans[0].pieceId, "moreStuck", "more stuck connectors must sort first, not whichever was inserted first");
  });
});

describe("findStuckBehindPieces — same-session follow-up: which pieces Master Agenda's widened 'behind' panel counts but planRescheduleForPieces can never move", () => {
  const startedDaysAgo = (n) => addDaysISO(todayISODate(), -n);

  function pieceWithOnlyATransitionStuck(overrides) {
    // 3 practice chunks (customChunkSize 4 over 12 measures) -> 2
    // transitions between them, generated regardless of section layout.
    // Touch every practice chunk on the day it was actually introduced but
    // never touch a transition, so missedCount reads 0 (nothing a
    // reschedule could move) while a real day is still behind.
    const piece0 = basePiece({
      totalMeasures: 12,
      measureDifficulty: Array(12).fill(1),
      customChunkSize: 4,
      minutesPerDay: 5,
      daysToLearn: 30,
      startDate: startedDaysAgo(20),
      progress: {},
      ...overrides,
    });
    const chunkSet = generateAllChunks(piece0);
    const timeline = getEffectiveTimeline(piece0, chunkSet);
    const progress = {};
    timeline.days.forEach((day) => {
      day.newChunkIds.forEach((id) => {
        progress[id] = progress[id] || { doneDays: [] };
        progress[id].doneDays.push(day.dayNumber);
      });
    });
    return { ...piece0, progress };
  }

  // Pass 73 follow-up to Pass 65: this test used to characterize the OLD,
  // buggy behavior — planRescheduleForPieces couldn't see a stuck,
  // never-logged transition at all (it only ever inferred a connector's
  // status indirectly from its neighbors), so findStuckBehindPieces had to
  // exist purely to keep such a piece from silently vanishing from the
  // bulk reschedule flow. Now that computeRemainingConnectorIds checks a
  // connector's own logged status directly, planRescheduleForPieces
  // correctly finds this piece itself — so it must NOT also appear here,
  // or it would show up in both "reschedulable" and "nothing to
  // reschedule" at once.
  test("a piece with every practice chunk touched but a transition still stuck is now handled by planRescheduleForPieces directly, not by this function", () => {
    const piece = pieceWithOnlyATransitionStuck({ name: "StuckOnly" });

    const plans = planRescheduleForPieces({ piece });
    assert.equal(plans.length, 1, "the stuck transition is now a real, direct reason to reschedule");
    assert.equal(plans[0].pieceId, "piece");
    assert.ok(plans[0].marker.remainingConnectorIds.length > 0, "the marker actually carries the stuck connector's id");

    const stuck = findStuckBehindPieces({ piece });
    assert.deepEqual(stuck, [], "already covered by planRescheduleForPieces — must not also appear as stuck");
  });

  // Verifies the *bulk* path doesn't just clear its eligibility check — the
  // marker it actually produces must, once applied, give the connector a
  // real new placement. Eligibility passing and relocation happening are
  // two different claims; the old neighbor-only filter could never have
  // satisfied this even if eligibility had somehow let the piece through.
  test("[fix, Pass 73] applying planRescheduleForPieces' own marker actually re-places the stuck connector, not just clears eligibility", () => {
    const piece = pieceWithOnlyATransitionStuck({ name: "RelocateBulk" });
    const chunkSet = generateAllChunks(piece);
    const [plan] = planRescheduleForPieces({ piece });

    const rescheduled = { ...piece, rescheduleMarker: plan.marker };
    const after = getEffectiveTimeline(rescheduled, chunkSet);

    const stuckId = plan.marker.remainingConnectorIds[0];
    const newOccurrence = after.days.find(
      (d) =>
        d.dayNumber >= plan.marker.asOfDay &&
        [...d.newChunkIds, ...d.specialChunkIds, ...d.reviewChunkIds].includes(stuckId)
    );
    assert.ok(newOccurrence, "the stuck connector must be re-placed somewhere in the rescheduled remainder, not left stranded");
  });

  // handleReschedule itself lives in App.jsx (a React component — no
  // render harness in this test suite, per CLAUDE.md's "logic that needs a
  // regression test belongs in lib/" rule), so this mirrors its exact
  // guard/marker-building logic line for line against the same shared
  // functions, rather than testing App.jsx directly. Covers the
  // single-piece path's guard (does it stop alerting?) AND relocation
  // (does the connector actually move?) in one test, matching the pass's
  // own two-part verification requirement.
  test("[fix, Pass 73] the single-piece path's own guard/marker logic: no longer blocks, and actually relocates the stuck connector", () => {
    const piece = pieceWithOnlyATransitionStuck({ name: "RelocateSolo" });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    const currentDay = getCurrentDay(piece, timeline.days.length);

    const status = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, currentDay);
    const remainingConnectorIds = computeRemainingConnectorIds(piece, chunkSet);
    const qualifyingConnectorIds = remainingConnectorIds.filter(
      (id) => timeline.introducedDay[id] && timeline.introducedDay[id] < currentDay
    );

    // The exact condition handleReschedule's guard now checks — both being
    // true here means the "nothing to reschedule" alert would NOT fire,
    // where before this fix it always would have (remainingChunkIds alone
    // was empty).
    assert.equal(status.remainingChunkIds.length, 0, "test setup sanity check — no untouched practice chunks");
    assert.ok(qualifyingConnectorIds.length > 0, "test setup sanity check — a real, overdue, never-logged connector exists");

    const marker = {
      asOfDay: currentDay,
      remainingChunkOrder: status.remainingChunkIds,
      remainingConnectorIds,
      previous: piece.rescheduleMarker || null,
    };
    const rescheduled = { ...piece, rescheduleMarker: marker };
    const after = getEffectiveTimeline(rescheduled, chunkSet);

    const stuckId = qualifyingConnectorIds[0];
    const newOccurrence = after.days.find(
      (d) =>
        d.dayNumber >= currentDay && [...d.newChunkIds, ...d.specialChunkIds, ...d.reviewChunkIds].includes(stuckId)
    );
    assert.ok(newOccurrence, "the stuck connector must be re-placed somewhere in the rescheduled remainder");
  });

  test("a piece that's genuinely on schedule (nothing behind at all) appears in neither list", () => {
    const piece = basePiece({ name: "OnTrack", daysToLearn: 10, startDate: todayISODate() });
    assert.deepEqual(planRescheduleForPieces({ piece }), []);
    assert.deepEqual(findStuckBehindPieces({ piece }), []);
  });

  test("a piece planRescheduleForPieces already handles (real untouched chunks) is not double-counted here", () => {
    const piece = basePiece({ name: "Behind", daysToLearn: 10, startDate: startedDaysAgo(5) });
    assert.ok(planRescheduleForPieces({ piece }).length > 0, "test setup sanity check");
    assert.deepEqual(findStuckBehindPieces({ piece }), [], "already covered by the reschedulable list — must not also appear as stuck");
  });

  test("paused, archived, and mid-revival pieces are excluded here too — same eligibility as planRescheduleForPieces", () => {
    const paused = pieceWithOnlyATransitionStuck({ name: "Paused", status: "paused" });
    const archived = pieceWithOnlyATransitionStuck({ name: "Archived", status: "archived" });
    const reviving = pieceWithOnlyATransitionStuck({
      name: "Reviving",
      revival: { active: true, startedAt: Date.now(), reassessmentComplete: false, plan: null },
    });
    assert.deepEqual(findStuckBehindPieces({ paused, archived, reviving }), []);
  });

  test("a genuinely finished plan (every item logged) is excluded here too", () => {
    const piece0 = basePiece({ name: "Finished", daysToLearn: 10, startDate: startedDaysAgo(100) });
    const chunkSet = generateAllChunks(piece0);
    const progress = Object.fromEntries(chunkSet.all.map((c) => [c.id, { doneDays: [1] }]));
    const piece = { ...piece0, progress };
    assert.deepEqual(findStuckBehindPieces({ piece }), []);
  });
});

describe("estimateRescheduleFit — the 'will this actually fit' warning", () => {
  // Shared by the per-piece Reschedule dialog and the bulk "Reschedule all"
  // confirmation. It decides only whether the user gets a heads-up — the
  // reschedule itself packs things in as tightly as it can either way.
  function fitFor(overrides, asOfDay) {
    const piece = basePiece({ daysToLearn: 14, ...overrides });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    const { remainingChunkIds } = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, asOfDay);
    return estimateRescheduleFit(piece, chunkSet.practiceChunks, timeline, asOfDay, remainingChunkIds);
  }

  test("plenty of time left: fits", () => {
    const fit = fitFor({ totalMeasures: 8, measureDifficulty: Array(8).fill(1), minutesPerDay: 60 }, 2);
    assert.equal(fit.fits, true);
    assert.ok(fit.requiredDays <= fit.availableDays);
  });

  test("a lot of untouched work and almost no days left: does not fit", () => {
    const fit = fitFor({ totalMeasures: 60, measureDifficulty: Array(60).fill(3), minutesPerDay: 10 }, 13);
    assert.equal(fit.fits, false);
    assert.ok(fit.requiredDays > fit.availableDays);
  });

  test("availableDays counts the current day itself, not the days after it", () => {
    // Day 14 of a 14-day plan still leaves one day to work in, not zero.
    const fit = fitFor({ totalMeasures: 8, measureDifficulty: Array(8).fill(1) }, 14);
    assert.equal(fit.availableDays, 1);
  });

  test("both numbers floor at 1 — never zero or negative days", () => {
    const past = fitFor({ totalMeasures: 8, measureDifficulty: Array(8).fill(1) }, 99);
    assert.equal(past.availableDays, 1);
    assert.ok(past.requiredDays >= 1);
  });

  test("chunks already practiced don't count toward what still has to fit", () => {
    const piece = basePiece({ totalMeasures: 24, measureDifficulty: Array(24).fill(2), daysToLearn: 14, minutesPerDay: 20 });
    const chunkSet = generateAllChunks(piece);
    const timeline = getEffectiveTimeline(piece, chunkSet);
    const allIds = chunkSet.practiceChunks.map((c) => c.id);

    const everything = estimateRescheduleFit(piece, chunkSet.practiceChunks, timeline, 7, allIds);
    const halfDone = estimateRescheduleFit(piece, chunkSet.practiceChunks, timeline, 7, allIds.slice(0, 2));

    assert.ok(halfDone.requiredDays < everything.requiredDays, "less left to do needs fewer days");
    assert.equal(halfDone.availableDays, everything.availableDays, "days remaining is unaffected by what's done");
  });

  test("planRescheduleForPieces carries the same verdict per piece", () => {
    const startedDaysAgo = (n) => addDaysISO(todayISODate(), -n);
    const roomy = basePiece({ name: "Roomy", daysToLearn: 14, startDate: startedDaysAgo(2), totalMeasures: 8, measureDifficulty: Array(8).fill(1), minutesPerDay: 60 });
    const crammed = basePiece({ name: "Crammed", daysToLearn: 14, startDate: startedDaysAgo(12), totalMeasures: 60, measureDifficulty: Array(60).fill(3), minutesPerDay: 10 });

    const byId = Object.fromEntries(planRescheduleForPieces({ roomy, crammed }).map((p) => [p.pieceId, p]));

    assert.equal(byId.roomy.fit.fits, true);
    assert.equal(byId.crammed.fit.fits, false);
  });
});

describe("computeReschedulePastPlanExtension — shared by handleReschedule (App.jsx) and planRescheduleForPieces' bulk extend", () => {
  test("days-mode: daysToLearn is anchorDay - 1 + requiredDays, targetDate follows from it", () => {
    const piece = basePiece({ startDate: "2026-01-01" });
    const result = computeReschedulePastPlanExtension(piece, 21, 5);
    assert.equal(result.daysToLearn, 25);
    assert.equal(result.targetDate, addDaysISO("2026-01-01", 24));
  });

  test("minutes-mode: targetDate is null — never set in this mode", () => {
    const piece = basePiece({ scheduleMode: "minutes", startDate: "2026-01-01" });
    const result = computeReschedulePastPlanExtension(piece, 21, 5);
    assert.equal(result.daysToLearn, 25);
    assert.equal(result.targetDate, null);
  });
});

describe("reconcileMinutesPerDaySchedule — rescheduleMarker floor", () => {
  // A "minutes" mode piece's daysToLearn is normally a pure function of
  // total effort and pace, recomputed from scratch on every load — no
  // memory of days that already elapsed without practice. App.jsx's
  // reschedule "doesn't fit" branch deliberately extends daysToLearn past
  // that recomputed value to make up for exactly that lost time, at the
  // same minutesPerDay. Without a floor, this function would silently
  // erase that extension the very next time the piece loads — the bug this
  // guards against (found in manual browser testing: daysToLearn extended
  // to 181 in-session, reverted to 135 on reload).
  test("no rescheduleMarker: recomputes normally, exactly like before this floor existed", () => {
    const piece = basePiece({
      scheduleMode: "minutes", minutesPerDay: 30, daysToLearn: 999, rescheduleMarker: null,
    });
    const reconciled = reconcileMinutesPerDaySchedule(piece);
    const expected = computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7);
    assert.equal(reconciled.daysToLearn, expected);
  });

  test("a rescheduleMarker present: an extended daysToLearn is never shrunk back down", () => {
    const piece = basePiece({ scheduleMode: "minutes", minutesPerDay: 30 });
    const needed = computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7);
    const extended = { ...piece, daysToLearn: needed + 50, rescheduleMarker: { asOfDay: 5, remainingChunkOrder: [] } };
    const reconciled = reconcileMinutesPerDaySchedule(extended);
    assert.equal(reconciled.daysToLearn, needed + 50);
  });

  test("a rescheduleMarker present but daysToLearn was never actually extended: still just recomputes, no phantom floor", () => {
    // Mirrors the ordinary (non-extending) "reschedule anyway" path, which
    // sets rescheduleMarker without ever touching daysToLearn — the floor
    // must be a true no-op here, not an accidental one-way ratchet.
    const piece = basePiece({ scheduleMode: "minutes", minutesPerDay: 30 });
    const needed = computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7);
    const rescheduledOnly = { ...piece, daysToLearn: needed, rescheduleMarker: { asOfDay: 5, remainingChunkOrder: [] } };
    const reconciled = reconcileMinutesPerDaySchedule(rescheduledOnly);
    assert.equal(reconciled.daysToLearn, needed);
  });

  test("pace genuinely slows down further after an extension: still grows past the floor, never stuck below what's actually needed", () => {
    // A large piece with small chunks so pace actually moves the day count
    // across a wide range (a piece whose chunks are each already bigger
    // than a day's budget saturates to "1 chunk = 1 day" regardless of
    // pace, which would make `needed` pace-independent and defeat the
    // point of this test).
    const piece = basePiece({ totalMeasures: 400, measureDifficulty: Array(400).fill(1), customChunkSize: 2, scheduleMode: "minutes", minutesPerDay: 300 });
    const needed = computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 300, 7);
    const extendedThenSlower = {
      ...piece, minutesPerDay: 30, daysToLearn: needed + 10, rescheduleMarker: { asOfDay: 5, remainingChunkOrder: [] },
    };
    const reconciled = reconcileMinutesPerDaySchedule(extendedThenSlower);
    const neededAtSlowerPace = computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7);
    assert.ok(neededAtSlowerPace > needed + 10, "test setup sanity check: the slower pace must genuinely need more days than the floor");
    assert.equal(reconciled.daysToLearn, neededAtSlowerPace);
  });

  test("clearing rescheduleMarker (a Settings save, per App.jsx's handleSavePiece) drops the floor immediately", () => {
    const piece = basePiece({ scheduleMode: "minutes", minutesPerDay: 30 });
    const needed = computeDaysNeededForMinutesPerDay(generateAllChunks(piece), 30, 7);
    const extendedNoLongerMarked = { ...piece, daysToLearn: needed + 50, rescheduleMarker: null };
    const reconciled = reconcileMinutesPerDaySchedule(extendedNoLongerMarked);
    assert.equal(reconciled.daysToLearn, needed);
  });
});
