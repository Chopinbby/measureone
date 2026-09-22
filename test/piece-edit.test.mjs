// Tests for saving the "Edit piece settings" form (src/lib/pieceEdit.js).
//
// The bug these guard against: Save used to write the edit form's whole
// draft (a copy taken when editing started) back over the live piece, so
// anything that changed elsewhere in between — logged practice, ratings,
// chunk notes, a Pause/Archive, an ended revival — was silently undone.
// Reproduced live: open the edit page, rate a chunk on Daily Practice,
// return and Save: the rating was gone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeEditedPiece, EDIT_FORM_FIELDS } from "../src/lib/pieceEdit.js";
import { migrateOrphanedProgress } from "../src/lib/chunking.js";

function basePiece(overrides) {
  return {
    id: "p1",
    name: "Sonata",
    composer: "",
    workName: "",
    workId: null,
    notes: "",
    status: "active",
    totalMeasures: 16,
    measureDifficulty: Array(16).fill(1),
    sections: [{ id: "s1", name: "", start: 1, end: 16 }],
    recurringMode: "none",
    recurringMeasures: 0,
    recurringPairs: [],
    chunkMode: "custom",
    customChunkSize: 4,
    startDate: "2026-01-01",
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    practiceDaysPerWeek: 7,
    targetBPM: 80,
    troubleSpotsEnabled: false,
    troubleSpotDefaultMinutes: 5,
    markedLearnedElsewhere: false,
    progress: {},
    memoryAnchors: {},
    lastLoggedAt: null,
    sortOrder: 1,
    revival: { active: false },
    ...overrides,
  };
}

describe("mergeEditedPiece — the form's fields come from the draft, everything else stays live", () => {
  test("[regression] work done elsewhere while the form was open survives Save", () => {
    // The draft was taken before any of this happened.
    const draft = basePiece({ name: "Sonata in C" }); // the user's actual edit
    const live = basePiece({
      progress: { c1: { manualConfidence: 100, doneDays: [2] } },
      memoryAnchors: { c1: "watch the left hand" },
      lastLoggedAt: "2026-01-05",
      sortOrder: 3,
    });
    const merged = mergeEditedPiece(live, draft);
    assert.equal(merged.name, "Sonata in C", "the form's edit is applied");
    assert.deepEqual(merged.progress, live.progress, "logged practice / ratings must not be wiped");
    assert.deepEqual(merged.memoryAnchors, live.memoryAnchors, "chunk notes must not be wiped");
    assert.equal(merged.lastLoggedAt, "2026-01-05");
    assert.equal(merged.sortOrder, 3);
  });

  test("[regression] a Pause/Archive done from the same page survives Save", () => {
    const draft = basePiece({ status: "active" }); // stale copy
    const live = basePiece({ status: "paused" });
    assert.equal(mergeEditedPiece(live, draft).status, "paused");
  });

  test("every form-owned field is taken from the draft", () => {
    const live = basePiece();
    const draft = { ...live };
    EDIT_FORM_FIELDS.forEach((f) => {
      draft[f] = { marker: f }; // distinct sentinel per field
    });
    const merged = mergeEditedPiece(live, draft);
    EDIT_FORM_FIELDS.forEach((f) => assert.deepEqual(merged[f], { marker: f }, `${f} should come from the draft`));
  });

  test("a form field the draft doesn't have keeps its live value (old saved pieces)", () => {
    const live = basePiece({ troubleSpotDefaultMinutes: 9 });
    const draft = basePiece();
    delete draft.troubleSpotDefaultMinutes;
    assert.equal(mergeEditedPiece(live, draft).troubleSpotDefaultMinutes, 9);
  });

  test("a field that isn't on the form defaults to the live value, including one that doesn't exist yet", () => {
    const live = basePiece({ someFutureField: "live" });
    const draft = basePiece({ someFutureField: "stale draft copy" });
    assert.equal(mergeEditedPiece(live, draft).someFutureField, "live");
  });

  test("does not mutate its inputs", () => {
    const live = basePiece({ progress: { c1: { doneDays: [1] } } });
    const draft = basePiece({ name: "X" });
    const liveBefore = JSON.stringify(live);
    const draftBefore = JSON.stringify(draft);
    mergeEditedPiece(live, draft);
    assert.equal(JSON.stringify(live), liveBefore);
    assert.equal(JSON.stringify(draft), draftBefore);
  });
});

describe("mergeEditedPiece — revival", () => {
  const liveRevival = { active: true, reassessmentComplete: true, plan: { days: ["real plan"] }, tempoLadderStartFraction: 0.6 };
  const staleRevival = { active: true, reassessmentComplete: false, plan: null, tempoLadderStartFraction: 0.6 };

  test("the tempo starting point is applied, and the rest of the live revival state is kept", () => {
    const live = basePiece({ revival: liveRevival });
    const draft = basePiece({ revival: { ...staleRevival, tempoLadderStartFraction: 0.5 } });
    const merged = mergeEditedPiece(live, draft);
    assert.equal(merged.revival.tempoLadderStartFraction, 0.5);
    assert.equal(merged.revival.reassessmentComplete, true, "live reassessment state must not be rolled back");
    assert.deepEqual(merged.revival.plan, liveRevival.plan, "the generated plan must not be wiped");
  });

  test("[regression] ending revival elsewhere while the form was open is not undone by Save", () => {
    const live = basePiece({ revival: { active: false } }); // ended on Daily Practice
    const draft = basePiece({ revival: { ...staleRevival, tempoLadderStartFraction: 0.5 } });
    const merged = mergeEditedPiece(live, draft);
    assert.equal(merged.revival.active, false);
    assert.deepEqual(merged.revival, { active: false });
  });

  test("a piece that was never in revival is left alone", () => {
    const live = basePiece();
    assert.deepEqual(mergeEditedPiece(live, basePiece()).revival, { active: false });
  });
});

describe("saving a chunk-size change keeps practice logged since the form opened", () => {
  // handleSavePiece runs migrateOrphanedProgress(livePiece, mergedPiece),
  // which re-homes progress from chunk ids the edit removed onto the new
  // chunks by measure overlap. It reads progress off its second argument,
  // so that argument's progress has to be the LIVE progress.
  test("[regression] progress logged after the form opened is re-homed, not lost", () => {
    // Chunk size 4 → ids c1, c5, c9, c13. The user logs c5 AFTER opening the
    // form; the draft never saw it.
    const live = basePiece({ progress: { c5: { doneDays: [2], manualConfidence: 75 } } });
    const draft = basePiece({ chunkMode: "custom", customChunkSize: 8, progress: {} });

    // What Save did before the fix: migrate from the stale draft as-is.
    const before = migrateOrphanedProgress(live, draft);
    assert.deepEqual(before, {}, "sanity: the old path really did lose it");

    // What Save does now: migrate from the merged piece.
    const merged = mergeEditedPiece(live, draft);
    assert.equal(merged.customChunkSize, 8, "the chunk-size edit itself is applied");
    const after = migrateOrphanedProgress(live, merged);
    // Size 8 → ids c1 (mm 1–8), c9 (mm 9–16). Old c5 (mm 5–8) overlaps c1.
    assert.equal(after.c5, undefined, "the removed chunk id is gone");
    assert.deepEqual(after.c1, { doneDays: [2], manualConfidence: 75 }, "its practice is re-homed onto the chunk covering the same measures");
  });

  test("with nothing logged in between, the result is the same as before the fix", () => {
    const live = basePiece({ progress: { c5: { doneDays: [2] } } });
    const draft = basePiece({ customChunkSize: 8, progress: { c5: { doneDays: [2] } } }); // fresh snapshot
    const viaDraft = migrateOrphanedProgress(live, draft);
    const viaMerge = migrateOrphanedProgress(live, mergeEditedPiece(live, draft));
    assert.deepEqual(viaMerge, viaDraft);
  });
});
