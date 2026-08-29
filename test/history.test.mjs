// Tests for src/lib/history.js — turning persisted progress keys back into
// readable practice-history labels.
//
// The regression these exist for: `piece.progress` is persisted and keyed by
// chunk id, while the chunk set is re-derived on every render, so a logged id
// can fail to resolve. The original inline version did `chunkById[id].start`
// with no guard, which threw on the undefined and crashed the ENTIRE Progress
// tab — every panel, not just the history row. Two distinct causes, and the
// first one is not an edge case at all:
//
//   1. Section run-throughs (`sr_<sectionId>`) are valid and current, but are
//      deliberately excluded from generateAllChunks()'s `all` array, so they
//      are never in the chunk set on ANY piece.
//   2. Genuinely stale ids left behind when a piece edit regenerates chunk ids.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computePracticeHistory } from "../src/lib/history.js";

// Minimal fixtures — computePracticeHistory only reads `progress` and
// `sections` off the piece, and `id`/`start`/`end` off each chunk.
const chunk = (id, start, end) => ({ id, start, end });
const logged = (...days) => ({ doneDays: days });

const piece = (progress, sections = [{ id: "s1", name: "", start: 1, end: 8 }]) => ({ progress, sections });

describe("computePracticeHistory — resolving logged ids", () => {
  test("a live chunk id is named by its measure range", () => {
    const history = computePracticeHistory(piece({ c1: logged(1) }), [chunk("c1", 1, 4)]);
    assert.deepEqual(history, [{ day: 1, label: "mm. 1–4", unresolvedCount: 0 }]);
  });

  test("a single-measure chunk uses the singular form", () => {
    const history = computePracticeHistory(piece({ c1: logged(1) }), [chunk("c1", 7, 7)]);
    assert.equal(history[0].label, "m. 7");
  });

  test("several ids logged on one day are joined in order", () => {
    const history = computePracticeHistory(
      piece({ c1: logged(1), c2: logged(1) }),
      [chunk("c1", 1, 4), chunk("c2", 5, 8)]
    );
    assert.equal(history[0].label, "mm. 1–4, mm. 5–8");
    assert.equal(history[0].unresolvedCount, 0);
  });
});

describe("computePracticeHistory — section run-throughs are valid, not stale", () => {
  // The actual cause of the shipped crash. `sr_*` ids are never in the chunk
  // set, so treating "not in the chunk set" as "stale" would mislabel a real,
  // current run-through as a leftover from an old plan.
  test("an sr_ id resolves off piece.sections instead of the chunk set", () => {
    const history = computePracticeHistory(piece({ sr_s1: logged(1) }), []);
    assert.equal(history[0].label, "Play through: Section 1 (mm. 1–8)");
    assert.equal(history[0].unresolvedCount, 0, "a live run-through must never count as unresolved");
  });

  test("a named section uses its name rather than a positional fallback", () => {
    const sections = [{ id: "s1", name: "Exposition", start: 1, end: 8 }];
    const history = computePracticeHistory(piece({ sr_s1: logged(1) }, sections), []);
    assert.equal(history[0].label, "Play through: Exposition (mm. 1–8)");
  });

  test("positional names follow measure order, not array order", () => {
    // computeSectionRunThroughs sorts by `start` before labelling, so an
    // out-of-order sections array must not shift the numbers the learner saw.
    const sections = [
      { id: "s2", name: "", start: 9, end: 16 },
      { id: "s1", name: "", start: 1, end: 8 },
    ];
    const history = computePracticeHistory(piece({ sr_s2: logged(1) }, sections), []);
    assert.equal(history[0].label, "Play through: Section 2 (mm. 9–16)");
  });

  test("an sr_ id whose section was deleted is unresolved, not assumed live", () => {
    const history = computePracticeHistory(piece({ sr_gone: logged(1) }), []);
    assert.equal(history[0].unresolvedCount, 1);
    assert.equal(history[0].label, "1 passage from an earlier version of this plan");
  });
});

describe("computePracticeHistory — genuinely stale ids", () => {
  test("[regression] an unresolvable id does not throw", () => {
    // The whole point: this used to take down every panel on the tab.
    assert.doesNotThrow(() => computePracticeHistory(piece({ c99: logged(1) }), []));
  });

  test("a stale id keeps its day but is never given invented measures", () => {
    const history = computePracticeHistory(piece({ c99: logged(3) }), []);
    assert.equal(history.length, 1, "the day the practice happened is not erased");
    assert.equal(history[0].day, 3);
    assert.equal(history[0].label, "1 passage from an earlier version of this plan");
  });

  test("multiple stale ids collapse into one pluralized note, not one note each", () => {
    const history = computePracticeHistory(piece({ c97: logged(1), c98: logged(1), c99: logged(1) }), []);
    assert.equal(history[0].unresolvedCount, 3);
    assert.equal(history[0].label, "3 passages from an earlier version of this plan");
  });

  test("stale entries trail the resolved ones rather than displacing them", () => {
    const history = computePracticeHistory(
      piece({ c1: logged(1), c98: logged(1), c99: logged(1) }),
      [chunk("c1", 1, 4)]
    );
    assert.equal(history[0].label, "mm. 1–4, 2 passages from an earlier version of this plan");
  });
});

describe("computePracticeHistory — the whole-piece run-through", () => {
  const consolidation = (sessions) => ({ __consolidation__: { doneDays: [4], sessions } });

  test("a bare run-through is labelled without a stop count", () => {
    const history = computePracticeHistory(piece(consolidation([{ day: 4 }])), []);
    assert.equal(history[0].label, "Full run-through");
  });

  test("a logged stop count is shown", () => {
    const history = computePracticeHistory(piece(consolidation([{ day: 4, stopCount: 3 }])), []);
    assert.equal(history[0].label, "Full run-through (stopped 3x)");
  });

  test("a zero stop count is shown rather than treated as missing", () => {
    // A clean run-through is the best possible outcome — it must not read the
    // same as one that was never counted.
    const history = computePracticeHistory(piece(consolidation([{ day: 4, stopCount: 0 }])), []);
    assert.equal(history[0].label, "Full run-through (stopped 0x)");
  });

  test("the most recent attempt that day supplies the stop count", () => {
    const history = computePracticeHistory(
      piece(consolidation([{ day: 4, stopCount: 9 }, { day: 4, stopCount: 2 }])),
      []
    );
    assert.equal(history[0].label, "Full run-through (stopped 2x)");
  });

  test("only that day's sessions are considered", () => {
    const progress = {
      __consolidation__: { doneDays: [4, 5], sessions: [{ day: 4, stopCount: 9 }, { day: 5, stopCount: 1 }] },
    };
    const history = computePracticeHistory(piece(progress), []);
    assert.deepEqual(history.map((h) => h.label), ["Full run-through (stopped 1x)", "Full run-through (stopped 9x)"]);
  });
});

describe("computePracticeHistory — the Cold-Start check (Pass 56)", () => {
  // Unlike __consolidation__, a __cold_start__ entry deliberately carries
  // no doneDays (a Cold-Start check isn't tied to a specific scheduled
  // plan day) — computePracticeHistory indexes it straight off each
  // session's own `day` field instead. Found missing and fixed as a
  // follow-up: the first cut of Pass 56 left this key invisible to
  // history entirely, since the doneDays-only indexing loop silently
  // skipped it (same as the "an entry with no doneDays contributes
  // nothing" rule above) — a __cold_start__ entry legitimately having no
  // doneDays.
  const coldStart = (sessions) => ({ __cold_start__: { sessions } });

  test("[regression] a __cold_start__ entry with no doneDays still appears — the general 'no doneDays, no history' rule must not swallow it", () => {
    const history = computePracticeHistory(piece(coldStart([{ day: 4, avgBpm: 90 }])), []);
    assert.equal(history.length, 1);
    assert.equal(history[0].day, 4);
  });

  test("a bare cold-start check is labelled without a BPM figure", () => {
    const history = computePracticeHistory(piece(coldStart([{ day: 4 }])), []);
    assert.equal(history[0].label, "Cold-start check");
  });

  test("a logged average BPM is shown", () => {
    const history = computePracticeHistory(piece(coldStart([{ day: 4, avgBpm: 96 }])), []);
    assert.equal(history[0].label, "Cold-start check (96 BPM avg)");
  });

  test("a zero avgBpm is shown rather than treated as missing", () => {
    const history = computePracticeHistory(piece(coldStart([{ day: 4, avgBpm: 0 }])), []);
    assert.equal(history[0].label, "Cold-start check (0 BPM avg)");
  });

  test("the most recent attempt that day supplies the BPM figure", () => {
    const history = computePracticeHistory(
      piece(coldStart([{ day: 4, avgBpm: 70 }, { day: 4, avgBpm: 96 }])),
      []
    );
    assert.equal(history[0].label, "Cold-start check (96 BPM avg)");
  });

  test("only that day's sessions are considered", () => {
    const history = computePracticeHistory(
      piece({ __cold_start__: { sessions: [{ day: 4, avgBpm: 70 }, { day: 9, avgBpm: 96 }] } }),
      []
    );
    assert.deepEqual(history.map((h) => h.label), ["Cold-start check (96 BPM avg)", "Cold-start check (70 BPM avg)"]);
  });

  test("two same-day sessions collapse into one history entry, not one per session", () => {
    const history = computePracticeHistory(
      piece(coldStart([{ day: 4, avgBpm: 70 }, { day: 4, avgBpm: 96 }])),
      []
    );
    assert.equal(history.length, 1, "one row for the day, not one per attempt");
  });

  test("joins with a real chunk logged the same day, in order", () => {
    const history = computePracticeHistory(
      piece({ c1: logged(4), __cold_start__: { sessions: [{ day: 4, avgBpm: 96 }] } }),
      [chunk("c1", 1, 4)]
    );
    assert.equal(history[0].label, "mm. 1–4, Cold-start check (96 BPM avg)");
  });

  test("a __cold_start__ session with no day is ignored rather than producing an invalid history row", () => {
    assert.doesNotThrow(() => computePracticeHistory(piece(coldStart([{ avgBpm: 96 }])), []));
    assert.deepEqual(computePracticeHistory(piece(coldStart([{ avgBpm: 96 }])), []), []);
  });
});

describe("computePracticeHistory — day ordering and limit", () => {
  test("days come back newest first", () => {
    const history = computePracticeHistory(piece({ c1: logged(1, 5, 3) }), [chunk("c1", 1, 4)]);
    assert.deepEqual(history.map((h) => h.day), [5, 3, 1]);
  });

  test("only the most recent `limit` days are returned", () => {
    const days = Array.from({ length: 14 }, (_, i) => i + 1);
    const history = computePracticeHistory(piece({ c1: logged(...days) }), [chunk("c1", 1, 4)]);
    assert.equal(history.length, 10);
    assert.deepEqual(history.map((h) => h.day), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  });

  test("the limit is overridable", () => {
    const history = computePracticeHistory(piece({ c1: logged(1, 2, 3) }), [chunk("c1", 1, 4)], 2);
    assert.deepEqual(history.map((h) => h.day), [3, 2]);
  });
});

describe("computePracticeHistory — empty and malformed input", () => {
  test("a piece with nothing logged returns no days", () => {
    assert.deepEqual(computePracticeHistory(piece({}), []), []);
  });

  test("an entry with no doneDays contributes nothing", () => {
    assert.deepEqual(computePracticeHistory(piece({ c1: { sessions: [{ day: 1 }] } }), [chunk("c1", 1, 4)]), []);
  });

  test("missing progress/sections/chunks are tolerated rather than throwing", () => {
    // Reachable from a hand-edited backup or a piece written by an older
    // version of the app — the same class of externally-produced data that
    // put the stale ids there in the first place.
    assert.doesNotThrow(() => computePracticeHistory({}, undefined));
    assert.deepEqual(computePracticeHistory({}, undefined), []);
  });
});
