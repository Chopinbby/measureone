// Tests for Pass 49 — repeating threshold gate on single-section
// run-throughs (src/lib/chunking.js's sectionRunThroughGate /
// computeSectionRunThroughs). See
// docs/Algorithms.md#section-run-throughs for the design this implements:
// a section's run-through goes due -> not due -> due again as its
// slowest-progressing chunk's logged-session count crosses 1, 3, 5, 7, ...
// (a flat "+2" step forever), rather than unlocking once and staying
// available forever the way it used to.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeSectionRunThroughs,
  sectionRunThroughGate,
  sectionPairRunThroughGate,
  chunksBySectionId,
  migrateOrphanedProgress,
  reassociateTroubleSpots,
} from "../src/lib/chunking.js";

const chunk = (id, start, end) => ({ id, kind: "section", start, end });
const sessions = (n) => Array.from({ length: n }, (_, i) => ({ day: i + 1 }));
const skippedSessions = (n) => Array.from({ length: n }, (_, i) => ({ day: i + 1, skipped: true }));
const provisionalSessions = (n) => Array.from({ length: n }, (_, i) => ({ day: i + 1, cleanReps: 3, bpm: 80, provisional: true }));

function piece({ sections, progress = {}, totalMeasures = 16 }) {
  return { sections, progress, measureDifficulty: Array(totalMeasures).fill(1) };
}

describe("sectionRunThroughGate — the gating metric itself", () => {
  const section = { id: "s1", name: "", start: 1, end: 8 };
  const chunks = [chunk("c1", 1, 4), chunk("c2", 5, 8)];

  test("a section with no assigned chunks is neither due nor a locked preview", () => {
    const p = piece({ sections: [{ id: "empty", name: "", start: 100, end: 108 }] });
    const bySectionId = chunksBySectionId(p, chunks);
    const gate = sectionRunThroughGate(p.sections[0], p, bySectionId);
    assert.deepEqual(gate, { minCount: 0, due: false, lockedPreview: false });
  });

  test("minCount is the MINIMUM across assigned chunks, not the max or an average", () => {
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(9) }, c2: { sessions: sessions(1) } } });
    const bySectionId = chunksBySectionId(p, chunks);
    assert.equal(sectionRunThroughGate(section, p, bySectionId).minCount, 1);
  });

  test("due is true exactly when minCount is odd (1, 3, 5, 7, ...)", () => {
    const bySectionId = chunksBySectionId(piece({ sections: [section] }), chunks);
    [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => {
      const p = piece({ sections: [section], progress: { c1: { sessions: sessions(n) }, c2: { sessions: sessions(n) } } });
      const gate = sectionRunThroughGate(section, p, chunksBySectionId(p, chunks));
      assert.equal(gate.due, n % 2 === 1, `minCount=${n} due should be ${n % 2 === 1}`);
    });
  });
});

describe("sectionRunThroughGate — skipped/unconfirmed sessions don't count toward the gate", () => {
  // Only a chunk with real, confirmed reps should advance the gate. A
  // skipped Interleaved attempt or an unconfirmed provisional one is not a
  // completed rep, even though both are stored in the same `sessions`
  // array (App.jsx's handleLogSession) — loggedSessions() (lib/utils.js)
  // is what tells them apart, same helper already used elsewhere for "real
  // practice happened" (e.g. Progress's per-piece practice-time totals).
  const section = { id: "s1", name: "", start: 1, end: 8 };
  const chunks = [chunk("c1", 1, 4), chunk("c2", 5, 8)];

  test("a chunk with only skipped sessions contributes 0 to minCount, not the skip count", () => {
    const p = piece({
      sections: [section],
      progress: { c1: { sessions: sessions(3) }, c2: { sessions: skippedSessions(5) } },
    });
    const bySectionId = chunksBySectionId(p, chunks);
    const gate = sectionRunThroughGate(section, p, bySectionId);
    assert.equal(gate.minCount, 0, "5 skips must not read as 5 real reps");
    assert.equal(gate.due, false);
  });

  test("a chunk with only unconfirmed provisional sessions contributes 0 to minCount", () => {
    const p = piece({
      sections: [section],
      progress: { c1: { sessions: sessions(3) }, c2: { sessions: provisionalSessions(4) } },
    });
    const bySectionId = chunksBySectionId(p, chunks);
    const gate = sectionRunThroughGate(section, p, bySectionId);
    assert.equal(gate.minCount, 0, "an unconfirmed provisional attempt must not advance the gate");
    assert.equal(gate.due, false);
  });

  test("a mix of real, skipped, and provisional sessions on one chunk counts only the real ones", () => {
    // c1 has 9 stored entries but only 2 real ones; c2 has 5 real. If the
    // raw count leaked through, minCount would come from c2 (5) instead of
    // c1's real count (2) — chosen so the two interpretations produce a
    // different minCount, not the same number by coincidence.
    const mixed = [...sessions(2), ...skippedSessions(3), ...provisionalSessions(4)];
    const p = piece({
      sections: [section],
      progress: { c1: { sessions: mixed }, c2: { sessions: sessions(5) } },
    });
    const bySectionId = chunksBySectionId(p, chunks);
    const gate = sectionRunThroughGate(section, p, bySectionId);
    assert.equal(gate.minCount, 2, "c1's 9 stored entries include only 2 real ones — minCount must be 2, not 5 (c2) or anything derived from c1's raw count of 9");
  });

  test("[regression] a section touched only via skip/provisional never becomes due, however many times", () => {
    const p = piece({
      sections: [section],
      progress: { c1: { sessions: skippedSessions(7) }, c2: { sessions: provisionalSessions(7) } },
    });
    assert.deepEqual(computeSectionRunThroughs(p, chunks), [], "no real reps logged on either chunk — must not be offered at all, regardless of raw session count");
  });

  test("a chunk drowned in skips that finally gets one real rep unlocks the section, not stays hidden behind its skip count", () => {
    // c1 sits at 2 real sessions (even — not due on its own). c2 has been
    // skipped 5 times and just logged its first REAL session (raw count 6,
    // real count 1). Under the bug, c2 reads as 6 real reps, so minCount
    // would be min(2, 6) = 2 (even, not due) — the raw count would hide a
    // section that should just have unlocked. Fixed, minCount is
    // min(2, 1) = 1 (odd, due) — c2's real single rep correctly becomes
    // the bottleneck, and the section unlocks.
    const p = piece({
      sections: [section],
      progress: { c1: { sessions: sessions(2) }, c2: { sessions: [...skippedSessions(5), ...sessions(1)] } },
    });
    const bySectionId = chunksBySectionId(p, chunks);
    const gate = sectionRunThroughGate(section, p, bySectionId);
    assert.equal(gate.minCount, 1, "c2's real count is 1, not 6 — its 5 skips must not count");
    assert.equal(gate.due, true);

    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1);
    assert.equal(items[0].locked, false);
  });
});

describe("computeSectionRunThroughs — single-section run-through gating", () => {
  const section = { id: "s1", name: "", start: 1, end: 8 };
  const chunks = [chunk("c1", 1, 4), chunk("c2", 5, 8)];

  test("not offered at all until every chunk has at least one session", () => {
    const p = piece({ sections: [section] }); // no progress logged for either chunk
    assert.deepEqual(computeSectionRunThroughs(p, chunks), []);
  });

  test("becomes a task once the minimum reaches 1", () => {
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(1) }, c2: { sessions: sessions(1) } } });
    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "sr_s1");
    assert.equal(items[0].kind, "section-runthrough");
    assert.equal(items[0].locked, false);
  });

  test("disappears as a mandatory task once the minimum moves off a threshold (goes even)", () => {
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(2) }, c2: { sessions: sessions(2) } } });
    assert.deepEqual(computeSectionRunThroughs(p, chunks), []);
  });

  test("reappears once the minimum reaches 3", () => {
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(3) }, c2: { sessions: sessions(3) } } });
    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1);
    assert.equal(items[0].locked, false);
  });

  test("threshold sequence is a flat +2 forever: due at 1/3/5/7, absent at 0/2/4/6/8", () => {
    [1, 3, 5, 7].forEach((n) => {
      const p = piece({ sections: [section], progress: { c1: { sessions: sessions(n) }, c2: { sessions: sessions(n) } } });
      const items = computeSectionRunThroughs(p, chunks);
      assert.equal(items.length, 1, `expected a due task at minCount=${n}`);
      assert.equal(items[0].locked, false);
    });
    [0, 2, 4, 6, 8].forEach((n) => {
      const p = piece({ sections: [section], progress: { c1: { sessions: sessions(n) }, c2: { sessions: sessions(n) } } });
      assert.deepEqual(computeSectionRunThroughs(p, chunks), [], `expected no task at minCount=${n}`);
    });
  });
});

describe("computeSectionRunThroughs — locked-preview state", () => {
  const section = { id: "s1", name: "", start: 1, end: 8 };
  const chunks = [chunk("c1", 1, 4), chunk("c2", 5, 8)];

  test("shown, locked, when exactly one chunk is one session away from the next threshold", () => {
    // c1 has already reached the upcoming threshold (3); c2 is one session short of it.
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(3) }, c2: { sessions: sessions(2) } } });
    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1);
    assert.equal(items[0].locked, true);
  });

  test("unlocks the moment that last chunk's session is actually logged", () => {
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(3) }, c2: { sessions: sessions(3) } } });
    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1);
    assert.equal(items[0].locked, false);
  });

  test("the locked preview also covers the very first unlock (threshold 1)", () => {
    // c1 already has sessions; c2 has never been practiced (no progress entry at all).
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(4) } } });
    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1);
    assert.equal(items[0].locked, true);
  });

  test("no locked preview when two chunks tie for slowest — neither is 'the single slowest'", () => {
    const threeChunkSection = { id: "s2", name: "", start: 1, end: 12 };
    const threeChunks = [chunk("c1", 1, 4), chunk("c2", 5, 8), chunk("c3", 9, 12)];
    const p = piece({
      sections: [threeChunkSection],
      progress: { c1: { sessions: sessions(3) }, c2: { sessions: sessions(2) }, c3: { sessions: sessions(2) } },
    });
    assert.deepEqual(computeSectionRunThroughs(p, threeChunks), []);
  });

  test("no locked preview once already due — the two states are mutually exclusive", () => {
    const p = piece({ sections: [section], progress: { c1: { sessions: sessions(5) }, c2: { sessions: sessions(1) } } });
    const items = computeSectionRunThroughs(p, chunks);
    assert.equal(items.length, 1);
    assert.equal(items[0].locked, false, "minCount=1 is already due, not a preview of an upcoming threshold");
  });
});

// Once-open question (docs/Decisions.md#open-questions), resolved on
// direct request: yes, a section-PAIR run-through should get the same
// repeating due/locked-preview rhythm single sections got in Pass 49, once
// the pair has cleared its own separate one-time first-unlock gate. The
// first-unlock gate itself (every chunk in the whole piece practiced, both
// sections in the pair individually learned) is unchanged.
describe("sectionPairRunThroughGate — the gating metric itself, across both sections combined", () => {
  const sectionA = { id: "s1", name: "", start: 1, end: 8 };
  const sectionB = { id: "s2", name: "", start: 9, end: 16 };
  const chunks = [chunk("c1", 1, 4), chunk("c2", 5, 8), chunk("c3", 9, 12), chunk("c4", 13, 16)];

  test("minCount is the minimum across BOTH sections' chunks combined, not just one section", () => {
    const p = piece({
      sections: [sectionA, sectionB],
      progress: {
        c1: { sessions: sessions(5) },
        c2: { sessions: sessions(5) },
        c3: { sessions: sessions(5) },
        c4: { sessions: sessions(1) }, // the real bottleneck, in section B
      },
      totalMeasures: 16,
    });
    const bySectionId = chunksBySectionId(p, chunks);
    assert.equal(sectionPairRunThroughGate(sectionA, sectionB, p, bySectionId).minCount, 1);
  });

  test("due is true exactly when the combined minCount is odd", () => {
    [0, 1, 2, 3, 4].forEach((n) => {
      const p = piece({
        sections: [sectionA, sectionB],
        progress: { c1: { sessions: sessions(n) }, c2: { sessions: sessions(n) }, c3: { sessions: sessions(n) }, c4: { sessions: sessions(n) } },
        totalMeasures: 16,
      });
      const bySectionId = chunksBySectionId(p, chunks);
      const gate = sectionPairRunThroughGate(sectionA, sectionB, p, bySectionId);
      assert.equal(gate.due, n % 2 === 1, `minCount=${n} due should be ${n % 2 === 1}`);
    });
  });
});

describe("computeSectionRunThroughs — section-pair (kind: section-transition) now repeats after its first unlock", () => {
  const sectionA = { id: "s1", name: "", start: 1, end: 8 };
  const sectionB = { id: "s2", name: "", start: 9, end: 16 };
  const chunks = [chunk("c1", 1, 4), chunk("c2", 5, 8), chunk("c3", 9, 12), chunk("c4", 13, 16)];
  const sections = [sectionA, sectionB];
  const evenlyAt = (n) => ({
    c1: { sessions: sessions(n) },
    c2: { sessions: sessions(n) },
    c3: { sessions: sessions(n) },
    c4: { sessions: sessions(n) },
  });

  test("still waits for every chunk in the whole piece to have a session before ever appearing", () => {
    const p = piece({ sections, progress: { c1: { sessions: sessions(3) }, c2: { sessions: sessions(3) }, c3: { sessions: sessions(3) } }, totalMeasures: 16 }); // c4 untouched
    const items = computeSectionRunThroughs(p, chunks);
    assert.ok(!items.some((it) => it.kind === "section-transition"), "the whole-piece-practiced precondition is unchanged by this fix");
  });

  test("[fix] disappears once the minimum moves off a threshold (goes even) — no longer stays available forever once unlocked", () => {
    const p = piece({ sections, progress: evenlyAt(2), totalMeasures: 16 });
    const items = computeSectionRunThroughs(p, chunks);
    assert.ok(!items.some((it) => it.kind === "section-transition"), "an even combined count must not read as due, matching single sections' own rhythm");
  });

  test("[fix] reappears once the minimum reaches 3", () => {
    const p = piece({ sections, progress: evenlyAt(3), totalMeasures: 16 });
    const items = computeSectionRunThroughs(p, chunks);
    const transition = items.find((it) => it.kind === "section-transition");
    assert.ok(transition, "must come back due at minCount=3");
    assert.equal(transition.locked, false);
  });

  test("[fix] shown locked when exactly one chunk anywhere in the pair is one session short of the next threshold", () => {
    const p = piece({
      sections,
      progress: { c1: { sessions: sessions(3) }, c2: { sessions: sessions(3) }, c3: { sessions: sessions(3) }, c4: { sessions: sessions(2) } },
      totalMeasures: 16,
    });
    const items = computeSectionRunThroughs(p, chunks);
    const transition = items.find((it) => it.kind === "section-transition");
    assert.ok(transition, "the locked preview means it's shown, just not loggable yet");
    assert.equal(transition.locked, true);
  });

  test("the very first unlock (threshold 1) still requires both sections individually learned first", () => {
    // Every chunk in the whole piece has exactly 1 real session — the
    // pre-existing first-unlock gate (isLearned on both sections,
    // allChunksPracticed) is satisfied, and the new repeating gate agrees
    // (minCount=1, odd) — both conditions align at the very first unlock.
    const p = piece({ sections, progress: evenlyAt(1), totalMeasures: 16 });
    const items = computeSectionRunThroughs(p, chunks);
    const transition = items.find((it) => it.kind === "section-transition");
    assert.ok(transition);
    assert.equal(transition.locked, false);
  });
});

// Once-open question (docs/Decisions.md#open-questions), resolved on
// direct request: orphaned progress (a chunk id an edit regenerated —
// totalMeasures/chunkMode/customChunkSize changed) should be migrated onto
// the new chunk that best covers the same measures, not left permanently
// orphaned or discarded.
//
// Worth knowing before reading these fixtures: chunk ids are `c${start}`
// (generatePracticeChunks, lib/chunking.js), and chunking always starts
// fresh at measure 1 — so the very first chunk keeps id "c1" across *any*
// customChunkSize/chunkMode change, no matter how much its own range
// shifts. Only later chunks can actually become orphaned, and only when
// the new step size doesn't realign with the old start positions. Every
// fixture below is picked to land on a real orphaning case, not the "c1
// silently keeps its id, no migration even attempted" non-case.
describe("migrateOrphanedProgress — reattaching history after a chunk-id-shifting edit", () => {
  function mkPiece({ totalMeasures, customChunkSize, progress = {} }) {
    return {
      totalMeasures,
      measureDifficulty: Array(totalMeasures).fill(1),
      chunkMode: "custom",
      customChunkSize,
      recurringMode: "none",
      recurringMeasures: 0,
      recurringPairs: [],
      progress,
    };
  }
  const richEntry = (n) => ({ sessions: sessions(n), doneDays: [1], stage: "settling", practiceBPM: 90 });

  test("no chunk-id-affecting change at all: returns the exact same progress reference, no-op", () => {
    const oldPiece = mkPiece({ totalMeasures: 16, customChunkSize: 4, progress: { c1: richEntry(2), c5: richEntry(1) } });
    const newPiece = { ...oldPiece }; // e.g. only difficulty/notes changed elsewhere
    const result = migrateOrphanedProgress(oldPiece, newPiece);
    assert.equal(result, newPiece.progress, "same object reference — nothing to migrate");
  });

  test("[fix] a genuine boundary shift reattaches each orphaned chunk to whichever new chunk overlaps it most", () => {
    // customChunkSize 5 -> 4, totalMeasures 15. Old starts 1,6,11 (c1 1-5,
    // c6 6-10, c11 11-15); new starts 1,5,9,13 (c1 1-4, c5 5-8, c9 9-12,
    // c13 13-15) — "c1" persists either way, but "c6" and "c11" don't
    // exist in the new set at all. c6 (6-10) overlaps new c5 (5-8) by 3
    // measures and new c9 (9-12) by 2 — c5 wins. c11 (11-15) overlaps new
    // c9 by 2 and new c13 by 3 — c13 wins. No conflict between them (two
    // different targets), so both migrate cleanly.
    const oldPiece = mkPiece({ totalMeasures: 15, customChunkSize: 5, progress: { c6: richEntry(5), c11: richEntry(2) } });
    const newPiece = mkPiece({ totalMeasures: 15, customChunkSize: 4, progress: oldPiece.progress });
    const result = migrateOrphanedProgress(oldPiece, newPiece);
    assert.deepEqual(Object.keys(result).sort(), ["c13", "c5"]);
    assert.equal(result.c5, oldPiece.progress.c6, "old c6's entry reattaches to new c5 (best overlap), the exact same object");
    assert.equal(result.c13, oldPiece.progress.c11, "old c11's entry reattaches to new c13 (best overlap)");
  });

  test("[fix] two orphaned chunks merging into one new chunk: the earlier one (by measure order) wins, the later stays orphaned, not discarded", () => {
    // customChunkSize 4 -> 12, totalMeasures 12: old c1 (1-4, no progress
    // here so the merged target starts out free), c5 (5-8), c9 (9-12) all
    // collapse into a single new c1 (1-12). c5 and c9 are both orphaned
    // and both fully overlap the one available target — only one can
    // claim it.
    const oldPiece = mkPiece({ totalMeasures: 12, customChunkSize: 4, progress: { c5: richEntry(3), c9: richEntry(7) } });
    const newPiece = mkPiece({ totalMeasures: 12, customChunkSize: 12, progress: oldPiece.progress });
    const result = migrateOrphanedProgress(oldPiece, newPiece);
    assert.equal(result.c1, oldPiece.progress.c5, "c5 (earlier in measure order) claims the merged chunk");
    assert.equal(result.c9, oldPiece.progress.c9, "c9 survives, unmigrated, under its own old id — not discarded, not overwritten");
    assert.equal(Object.keys(result).length, 2);
  });

  test("[fix] never overwrites a new chunk that already carries its own real progress", () => {
    // customChunkSize 4 -> 12, totalMeasures 12: old c1 (1-4, HAS its own
    // progress) survives under the same id "c1", now covering the whole
    // merged 1-12 range. Old c5 (5-8) is orphaned, and its only possible
    // candidate is that same new c1 — but c1 is already taken by its own
    // real data, so c5 must not be allowed to clobber it.
    const oldPiece = mkPiece({ totalMeasures: 12, customChunkSize: 4, progress: { c1: richEntry(9), c5: richEntry(3) } });
    const newPiece = mkPiece({ totalMeasures: 12, customChunkSize: 12, progress: oldPiece.progress });
    const result = migrateOrphanedProgress(oldPiece, newPiece);
    assert.equal(result.c1, oldPiece.progress.c1, "c1's own real progress is untouched");
    assert.equal(result.c5, oldPiece.progress.c5, "c5 has nowhere safe to go — stays put under its own id, not lost");
  });

  test("content genuinely removed (totalMeasures shrinks past it): no candidate exists, stays orphaned", () => {
    const oldPiece = mkPiece({ totalMeasures: 16, customChunkSize: 4, progress: { c13: richEntry(2) } });
    const newPiece = mkPiece({ totalMeasures: 8, customChunkSize: 4, progress: oldPiece.progress });
    const result = migrateOrphanedProgress(oldPiece, newPiece);
    assert.equal(result.c13, oldPiece.progress.c13, "nothing to migrate onto — stays exactly as it was, not discarded");
  });
});

describe("[Pass 91 follow-up] reassociateTroubleSpots — re-homing focus spots by measure position, not by chunk-id continuity", () => {
  const spot = (id, startMeasure, overrides = {}) => ({
    id,
    name: `spot ${id}`,
    position: String(startMeasure),
    startMeasure,
    endMeasure: startMeasure,
    length: null,
    fromSetup: true,
    resolved: false,
    resolvedBpm: null,
    resolvedAt: null,
    sessions: [],
    ...overrides,
  });

  test("nothing to reassociate: no progress entries carry any trouble spots at all — same reference back", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c5", 5, 8)];
    const progress = { c1: { doneDays: [1], sessions: [] } };
    assert.equal(reassociateTroubleSpots(progress, chunks), progress);
  });

  test("already correctly homed: every spot's startMeasure already falls inside the chunk it's nested under — same reference back, no-op", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c5", 5, 8)];
    const progress = { c1: { doneDays: [], troubleSpots: [spot("fs1", 2)] } };
    assert.equal(reassociateTroubleSpots(progress, chunks), progress);
  });

  test("chunk id disappeared outright: the spot moves to whichever current chunk now contains its measure", () => {
    // Old chunking put a spot at measure 6 under "c5" (5-8); new chunking
    // (size 4 -> 3) no longer has a "c5" at all — measure 6 now falls
    // under "c4" (4-6). The old "c5" key can still exist afterward (this
    // function only ever relocates the troubleSpots array itself, not the
    // whole entry — see the "only the troubleSpots array itself relocates"
    // test below) but carries no spots anymore.
    const chunks = [chunk("c1", 1, 3), chunk("c4", 4, 6), chunk("c7", 7, 9)];
    const progress = { c5: { doneDays: [], troubleSpots: [spot("fs1", 6)] } };
    const result = reassociateTroubleSpots(progress, chunks);
    assert.notEqual(result, progress);
    assert.deepEqual(result.c5.troubleSpots, [], "the stale id keeps no spots once its one spot has a real new home");
    assert.deepEqual(result.c4.troubleSpots.map((s) => s.id), ["fs1"]);
  });

  test("[the actual bug] a chunk id that coincidentally still exists, but now covers different measures, is not mistaken for continuity", () => {
    // customChunkSize 8 -> 4: "c9" exists in BOTH chunkings, but means
    // measures 9-16 under the old size and only 9-12 under the new one.
    // migrateOrphanedProgress's id-existence check alone would call this
    // "nothing to migrate" — this is exactly the gap reassociateTroubleSpots
    // exists to close by checking the spot's own measure instead.
    const oldChunks = [chunk("c1", 1, 8), chunk("c9", 9, 16)];
    const newChunks = [chunk("c1", 1, 4), chunk("c5", 5, 8), chunk("c9", 9, 12), chunk("c13", 13, 16)];
    const progress = { c9: { doneDays: [], troubleSpots: [spot("fs1", 14)] } }; // 14 is in old c9, NOT new c9
    // sanity check: the id genuinely persists in the new chunk set, so this
    // scenario is real, not a typo in the fixture
    assert.ok(newChunks.some((c) => c.id === "c9"));
    const result = reassociateTroubleSpots(progress, newChunks);
    assert.notEqual(result, progress);
    assert.deepEqual((result.c9 && result.c9.troubleSpots) || [], [], "measure 14 is no longer covered by the reused c9 id");
    assert.deepEqual(result.c13.troubleSpots.map((s) => s.id), ["fs1"], "measure 14 now falls under c13 (13-16)");
    void oldChunks; // documents the old shape; not itself passed to the function under test
  });

  test("a spot with no startMeasure at all (saved before this validation existed) is left exactly where it is — no ground truth to check, no crash", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c5", 5, 8)];
    const progress = { c1: { doneDays: [], troubleSpots: [spot("fs1", null, { position: "" })] } };
    const result = reassociateTroubleSpots(progress, chunks);
    assert.equal(result, progress, "no position data to match on — treated as already in its only known home, not moved or dropped");
  });

  test("a spot whose measure no longer exists in any current chunk (the piece itself got shorter): stays under its old id rather than being dropped", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c5", 5, 8)];
    const progress = { c9: { doneDays: [], troubleSpots: [spot("fs1", 12)] } }; // measure 12 no longer exists at all
    const result = reassociateTroubleSpots(progress, chunks);
    assert.equal(result, progress, "genuinely nothing to reattach to — left in place, same as migrateOrphanedProgress's own precedent");
  });

  test("two spots on one chunk, only one of which actually needs to move: the other stays put, not just the whole entry moved wholesale", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c4", 4, 6), chunk("c7", 7, 9)];
    const progress = { c5: { doneDays: [], troubleSpots: [spot("stays", 5), spot("moves", 8)] } };
    // note: under the NEW chunking there is no "c5" at all (4-6 then 7-9),
    // so both spots are technically homeless under their current id —
    // "stays" (measure 5) belongs in c4, "moves" (measure 8) belongs in c7.
    const result = reassociateTroubleSpots(progress, chunks);
    assert.deepEqual(result.c4.troubleSpots.map((s) => s.id), ["stays"]);
    assert.deepEqual(result.c7.troubleSpots.map((s) => s.id), ["moves"]);
  });

  test("a spot moves into a chunk id that previously had no progress entry of its own at all", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c5", 5, 8)];
    const progress = { c9: { doneDays: [], troubleSpots: [spot("fs1", 6)] } }; // c5 has no entry yet
    const result = reassociateTroubleSpots(progress, chunks);
    assert.deepEqual(result.c5.troubleSpots.map((s) => s.id), ["fs1"]);
    assert.deepEqual(result.c5.doneDays, [], "a freshly-created entry still gets a sane doneDays default");
  });

  test("only the troubleSpots array itself relocates — a chunk's own doneDays/sessions/practiceBPM are a different question (whole-entry reattachment is migrateOrphanedProgress's job, run first at the real call sites) and stay where they are", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c4", 4, 6)];
    const progress = {
      c5: { doneDays: [3], sessions: [{ day: 3 }], practiceBPM: 90, troubleSpots: [spot("fs1", 5)] },
    };
    const result = reassociateTroubleSpots(progress, chunks);
    assert.deepEqual(result.c4.troubleSpots.map((s) => s.id), ["fs1"], "the spot itself moves to where measure 5 actually is");
    assert.equal(result.c5.doneDays, progress.c5.doneDays, "c5's own practice history is untouched by this function");
    assert.equal(result.c5.practiceBPM, 90);
    assert.deepEqual(result.c5.troubleSpots, [], "c5 keeps existing (its other fields are real data), just with no spots left");
  });

  test("a spot on an already-correct chunk keeps its own object identity even though a different chunk in the same progress object needed to move", () => {
    const chunks = [chunk("c1", 1, 4), chunk("c4", 4, 6), chunk("c7", 7, 9)];
    const progress = {
      c1: { doneDays: [], troubleSpots: [spot("stays1", 2)] },
      c5: { doneDays: [], troubleSpots: [spot("moves", 8)] },
    };
    const result = reassociateTroubleSpots(progress, chunks);
    assert.equal(result.c1.troubleSpots[0], progress.c1.troubleSpots[0], "c1's own spot object is carried through unchanged, not cloned or lost, just because c5's spot elsewhere needed reattaching");
    assert.deepEqual(result.c7.troubleSpots.map((s) => s.id), ["moves"]);
  });
});
