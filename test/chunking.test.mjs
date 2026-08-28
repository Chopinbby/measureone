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
import { computeSectionRunThroughs, sectionRunThroughGate, chunksBySectionId } from "../src/lib/chunking.js";

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

describe("computeSectionRunThroughs — section-transition (kind: section-transition) stays unaffected", () => {
  // Deliberately a distinct, still one-time gate per Pass 49's scope — see
  // docs/Algorithms.md#section-run-throughs for why this wasn't changed.
  const sections = [
    { id: "s1", name: "", start: 1, end: 4 },
    { id: "s2", name: "", start: 5, end: 8 },
  ];
  const chunks = [chunk("c1", 1, 4), chunk("c2", 5, 8)];

  test("still waits for every chunk in the whole piece to have a session before appearing", () => {
    const p = piece({ sections, progress: { c1: { sessions: sessions(3) } } }); // c2 untouched
    const items = computeSectionRunThroughs(p, chunks);
    assert.ok(!items.some((it) => it.kind === "section-transition"));
  });

  test("stays available at an even session count, unlike a single-section run-through", () => {
    const p = piece({ sections, progress: { c1: { sessions: sessions(4) }, c2: { sessions: sessions(4) } } });
    const items = computeSectionRunThroughs(p, chunks);
    const transition = items.find((it) => it.kind === "section-transition");
    assert.ok(transition, "a section-transition must not vanish at an even count — it isn't gated by the new repeating threshold");
    assert.equal(transition.locked, undefined, "section-transition items don't carry the locked field at all");
  });
});
