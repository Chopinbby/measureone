// Data-migration safety tests for validateAndMigratePiece and the ladder
// config merge (src/lib/storage.js). This is the function every saved
// piece passes through on every app load — if it doesn't correctly
// backfill an old/incomplete piece, the whole app can crash on load or
// silently drop data. See docs/AI-GUIDELINES.md and CLAUDE.md for context.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateAndMigratePiece, parseBackupPieces, mergeImportedPiece, findMatchingPiece } from "../src/lib/storage.js";

const fresh = {
  id: "p_fresh",
  name: "Nocturne",
  totalMeasures: 40,
  startDate: "2026-07-01",
  progress: {},
};

const midPlan = {
  id: "p_mid",
  name: "Sonata",
  totalMeasures: 80,
  startDate: "2026-06-01",
  progress: {
    c1: {
      doneDays: [1, 2, 5],
      sessions: [
        { day: 1, cleanReps: 3, bpm: 60, effectiveness: "good", durationSeconds: 120 },
        { day: 5, cleanReps: 4, bpm: 66, effectiveness: "high", durationSeconds: 90 },
      ],
      currentBPM: 66,
    },
    c2: {
      doneDays: [2],
      sessions: [{ day: 2, cleanReps: 2, bpm: 50, effectiveness: "low", durationSeconds: 60 }],
    },
    __consolidation__: { doneDays: [3] },
  },
};

const revivalEntered = {
  id: "p_revival",
  name: "Ballade",
  totalMeasures: 120,
  startDate: "2026-01-15",
  lastPlayedDate: "2025-12-01",
  progress: {
    c1: {
      doneDays: [1],
      sessions: [{ day: 1, cleanReps: 5, bpm: 80, effectiveness: "high", durationSeconds: 200 }],
      manualConfidence: 25,
      weakSpot: true,
    },
  },
  revival: {
    active: true,
    startedAt: 1750000000000,
    purpose: "performance",
    performanceTempo: 120,
    tempoLadderStartFraction: 0.6,
    reassessmentComplete: false,
    plan: null,
  },
};

const archived = {
  id: "p_archived",
  name: "Prelude",
  totalMeasures: 24,
  startDate: "2025-01-01",
  status: "archived",
  progress: {
    c1: {
      doneDays: [1, 4, 10],
      sessions: [
        { day: 1, cleanReps: 3, bpm: 90, effectiveness: "good", durationSeconds: 100 },
        { day: 4, cleanReps: 3, bpm: 92, effectiveness: "good", durationSeconds: 100 },
        { day: 10, cleanReps: 5, bpm: 96, effectiveness: "high", durationSeconds: 150 },
      ],
    },
  },
};

const LADDER_STAGE_KEYS = ["stage", "consecutivePasses", "consecutiveStabilizingFails", "practiceBPM", "nextDueDate", "tier1Done"];

function assertLadderConfigShape(cfg) {
  assert.ok(cfg, "ladderConfig missing");
  assert.ok(cfg.stabilizing && cfg.settling && cfg.holding, "ladderConfig missing a stage");
  assert.equal(typeof cfg.stabilizing.intervalDays, "number");
  assert.equal(typeof cfg.settling.tempoFloorFraction, "number");
  assert.equal(typeof cfg.holding.startIntervalDays, "number");
  assert.equal(typeof cfg.bpmSteps.pass, "number");
  assert.equal(typeof cfg.bpmSteps.softMiss, "number");
  assert.equal(typeof cfg.bpmSteps.fail, "number");
}

function assertChunkBackfilled(entry) {
  LADDER_STAGE_KEYS.forEach((k) => assert.ok(k in entry, `missing ${k}`));
  assert.equal(entry.stage, null);
  assert.equal(entry.consecutivePasses, 0);
  assert.equal(entry.consecutiveStabilizingFails, 0);
  assert.equal(entry.practiceBPM, null);
  assert.equal(entry.nextDueDate, null);
  assert.equal(entry.tier1Done, false);
}

describe("validateAndMigratePiece — representative old piece shapes", () => {
  test("fresh piece migrates without throwing and gets sane ladder defaults", () => {
    const m = validateAndMigratePiece(fresh);
    assert.ok(m);
    assertLadderConfigShape(m.ladderConfig);
    assert.equal(m.lastLoggedAt, null, "no sessions logged yet");
  });

  test("mid-plan piece backfills ladder state on every real chunk, not the synthetic consolidation entry", () => {
    const m = validateAndMigratePiece(midPlan);
    assertChunkBackfilled(m.progress.c1);
    assertChunkBackfilled(m.progress.c2);
    assert.deepEqual(m.progress.__consolidation__, { doneDays: [3] });
  });

  test("mid-plan piece backfills session loggedDate from day + startDate, preserving old fields", () => {
    const m = validateAndMigratePiece(midPlan);
    assert.equal(m.progress.c1.sessions[0].loggedDate, "2026-06-01");
    assert.equal(m.progress.c1.sessions[1].loggedDate, "2026-06-05");
    assert.equal(m.progress.c1.sessions[1].cleanReps, 4);
    assert.equal(m.progress.c1.sessions[1].bpm, 66);
  });

  test("mid-plan piece derives lastLoggedAt as the max session date across chunks", () => {
    const m = validateAndMigratePiece(midPlan);
    assert.equal(m.lastLoggedAt, "2026-06-05");
  });

  test("revival-entered piece keeps revival state and manualConfidence intact, and old weakSpot converts to the new 'rough' flag", () => {
    const m = validateAndMigratePiece(revivalEntered);
    assert.equal(m.revival.active, true);
    assert.equal(m.progress.c1.flag, "rough", "pre-Pass-6 weakSpot:true should read forward as flag:'rough'");
    assert.equal("weakSpot" in m.progress.c1, false, "weakSpot should not survive migration once converted");
    assert.equal(m.progress.c1.manualConfidence, 25);
    assertChunkBackfilled(m.progress.c1);
  });

  test("a piece that already has a real flag set is not clobbered by a leftover weakSpot value", () => {
    const withBoth = {
      ...revivalEntered,
      progress: { c1: { ...revivalEntered.progress.c1, flag: "lost", weakSpot: true } },
    };
    const m = validateAndMigratePiece(withBoth);
    assert.equal(m.progress.c1.flag, "lost", "an explicit flag should win over a stale weakSpot");
  });

  test("a piece with no weakSpot and no flag migrates with flag left undefined, not falsely set to 'rough'", () => {
    const m = validateAndMigratePiece(midPlan);
    assert.equal(m.progress.c1.flag, undefined);
    assert.equal(m.progress.c2.flag, undefined);
  });

  test("archived piece keeps status and gets ladder state + lastLoggedAt", () => {
    const m = validateAndMigratePiece(archived);
    assert.equal(m.status, "archived");
    assertChunkBackfilled(m.progress.c1);
    assert.equal(m.lastLoggedAt, "2025-01-10");
  });

  test("migration is idempotent — running it twice on already-migrated output changes nothing further", () => {
    const once = validateAndMigratePiece(midPlan);
    const twice = validateAndMigratePiece(once);
    assert.deepEqual(twice.ladderConfig, once.ladderConfig);
    assert.deepEqual(twice.progress.c1, once.progress.c1);
    assert.equal(twice.lastLoggedAt, once.lastLoggedAt);
  });

  test("a piece with already-set custom ladder state is not clobbered back to defaults", () => {
    const custom = {
      ...fresh,
      id: "p_custom",
      progress: {
        c1: {
          doneDays: [1],
          sessions: [{ day: 1, cleanReps: 3, bpm: 60, effectiveness: "good", durationSeconds: 100, loggedDate: "2026-07-01" }],
          stage: "settling",
          consecutivePasses: 2,
          consecutiveStabilizingFails: 1,
          practiceBPM: 72,
          nextDueDate: "2026-07-08",
          tier1Done: true,
        },
      },
    };
    const m = validateAndMigratePiece(custom);
    assert.equal(m.progress.c1.stage, "settling");
    assert.equal(m.progress.c1.consecutivePasses, 2);
    assert.equal(m.progress.c1.practiceBPM, 72);
  });
});

describe("mergeLadderConfig — the P1 crash fix (field-by-field merge, not all-or-nothing)", () => {
  test("a piece with an existing but INCOMPLETE ladderConfig (missing bpmSteps) gets it merged in", () => {
    // Real scenario, not hypothetical: any piece saved between the
    // ladderConfig migration landing and bpmSteps being added to it later
    // would have exactly this shape — and computeLadderAdvance reads
    // ladderConfig.bpmSteps.pass/softMiss/fail unconditionally, so a
    // missing bpmSteps throws on the very next logged session.
    const partiallyMigrated = {
      ...fresh,
      id: "p_partial_ladder",
      ladderConfig: {
        stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
        settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
        holding: { startIntervalDays: 14, maxIntervalDays: 70, tempoFloorStartFraction: 0.85, tempoFloorStepFraction: 0.05, tempoFloorCapFraction: 1 },
        // bpmSteps deliberately absent.
      },
    };
    const m = validateAndMigratePiece(partiallyMigrated);
    assert.ok(m.ladderConfig.bpmSteps, "bpmSteps should be backfilled, not left undefined");
    assert.equal(m.ladderConfig.bpmSteps.pass, 2);
    assert.equal(m.ladderConfig.settling.tempoFloorFraction, 0.7, "untouched fields must survive the merge unchanged");
  });

  test("a customized ladderConfig sub-field is preserved, not overwritten by the default", () => {
    const custom = {
      ...fresh,
      id: "p_custom_ladder",
      ladderConfig: {
        stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
        settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
        holding: { startIntervalDays: 14, maxIntervalDays: 70, tempoFloorStartFraction: 0.85, tempoFloorStepFraction: 0.05, tempoFloorCapFraction: 1 },
        bpmSteps: { pass: 3, softMiss: -3, fail: -10 }, // hand-edited by the user
      },
    };
    const m = validateAndMigratePiece(custom);
    assert.equal(m.ladderConfig.bpmSteps.pass, 3);
    assert.equal(m.ladderConfig.bpmSteps.fail, -10);
  });
});

describe("Import path — validateAndMigratePiece protects imported pieces too", () => {
  test("parseBackupPieces reads a standard export file shape", () => {
    const text = JSON.stringify({ exportedAt: new Date().toISOString(), version: 1, pieces: [fresh] });
    const pieces = parseBackupPieces(text);
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].id, "p_fresh");
  });

  test("a brand-new imported piece with no ladderConfig at all gets one after validateAndMigratePiece (App.jsx's import path)", () => {
    const imported = { ...fresh, id: "p_imported", ladderConfig: undefined };
    const migrated = validateAndMigratePiece(imported);
    assertLadderConfigShape(migrated.ladderConfig);
  });

  test("findMatchingPiece matches an existing piece by id first", () => {
    const existing = { p_fresh: fresh };
    const match = findMatchingPiece(existing, { id: "p_fresh", name: "Nocturne (renamed)" });
    assert.equal(match.id, "p_fresh");
  });

  // Regression test for a real data-loss bug found and fixed after this
  // suite first shipped: mergeProgress's per-chunk merge protects
  // currentBPM/targetBPM/manualConfidence (via preferPresent) and weakSpot
  // (explicit undefined-check) from being overwritten by a blank/stale
  // import, but originally left the ladder fields (stage/consecutivePasses/
  // consecutiveStabilizingFails/practiceBPM/nextDueDate/tier1Done)
  // unprotected — re-importing an older backup silently rolled back
  // more-advanced in-app ladder progress to the stale export's values.
  test("[regression] re-importing an older backup preserves newer ladder progress instead of overwriting it", () => {
    const existingPiece = {
      ...fresh,
      id: "p_regress",
      progress: {
        c1: {
          doneDays: [1],
          sessions: [{ day: 1, loggedAt: 2000, loggedDate: "2026-07-02", cleanReps: 4, bpm: 90, outcome: "pass" }],
          stage: "settling",
          consecutivePasses: 3,
          consecutiveStabilizingFails: 0,
          practiceBPM: 90,
          nextDueDate: "2026-07-10",
          tier1Done: true,
        },
      },
    };
    const staleImport = {
      ...fresh,
      id: "p_regress",
      progress: {
        c1: {
          doneDays: [1],
          sessions: [{ day: 1, loggedAt: 1000, loggedDate: "2026-07-01", cleanReps: 0, bpm: 60, outcome: "fail" }],
          stage: "stabilizing",
          consecutivePasses: 0,
          consecutiveStabilizingFails: 1,
          practiceBPM: 60,
          nextDueDate: "2026-07-05",
          tier1Done: false,
        },
      },
    };
    const merged = mergeImportedPiece(existingPiece, staleImport);
    assert.equal(merged.progress.c1.stage, "settling", "the more-advanced existing state must survive the import");
    assert.equal(merged.progress.c1.consecutivePasses, 3);
    assert.equal(merged.progress.c1.consecutiveStabilizingFails, 0);
    assert.equal(merged.progress.c1.practiceBPM, 90);
    assert.equal(merged.progress.c1.nextDueDate, "2026-07-10");
    assert.equal(merged.progress.c1.tier1Done, true);
    // The stale import's own session still merges in additively — session
    // *history* always accumulates, only the derived ladder snapshot is
    // protected from regressing.
    assert.equal(merged.progress.c1.sessions.length, 2);
  });

  test("a chunk with real progress only in the import (existing piece never touched it) still takes the import's ladder state", () => {
    // The protection above only applies when BOTH sides already have an
    // entry for a chunk — a chunk absent from the existing piece entirely
    // still takes the import's data wholesale (handled by the `!e` branch
    // in mergeProgress, not the ladder-field overrides).
    const existingPiece = { ...fresh, id: "p_new_chunk", progress: {} };
    const importedPiece = {
      ...fresh,
      id: "p_new_chunk",
      progress: {
        c9: {
          doneDays: [1],
          sessions: [{ day: 1, loggedAt: 1000, loggedDate: "2026-07-01", cleanReps: 4, bpm: 80, outcome: "pass" }],
          stage: "stabilizing",
          consecutivePasses: 1,
          consecutiveStabilizingFails: 0,
          practiceBPM: 82,
          nextDueDate: "2026-07-05",
          tier1Done: false,
        },
      },
    };
    const merged = mergeImportedPiece(existingPiece, importedPiece);
    assert.equal(merged.progress.c9.stage, "stabilizing");
    assert.equal(merged.progress.c9.practiceBPM, 82);
  });
});
