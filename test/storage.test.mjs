// Data-migration safety tests for validateAndMigratePiece and the ladder
// config merge (src/lib/storage.js). This is the function every saved
// piece passes through on every app load — if it doesn't correctly
// backfill an old/incomplete piece, the whole app can crash on load or
// silently drop data. See docs/AI-GUIDELINES.md and CLAUDE.md for context.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateAndMigratePiece, parseBackupPieces, mergeImportedPiece, findMatchingPiece, isExportReminderDue, diffImportedPiece } from "../src/lib/storage.js";

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

  test("[regression, Pass 7 fix] a piece whose only logged activity is a run-through (__consolidation__) still gets a real lastLoggedAt, not null", () => {
    // Before the fix, computeLastLoggedAt explicitly skipped the
    // "__consolidation__" key, so a piece practiced only via full
    // run-throughs (Pass 6's stop-count logging) would look never-touched
    // to anything reading lastLoggedAt — including Revival's 60+-days
    // auto-trigger (Pass 7, lib/revival.js#computeRevivalTriggers).
    const consolidationOnly = {
      id: "p_consolidation_only",
      name: "Consolidation Only",
      totalMeasures: 32,
      startDate: "2026-05-01",
      progress: {
        __consolidation__: { doneDays: [1], sessions: [{ day: 1, stopCount: 2, loggedDate: "2026-06-01" }] },
      },
    };
    const m = validateAndMigratePiece(consolidationOnly);
    assert.equal(m.lastLoggedAt, "2026-06-01");
  });

  test("[regression, Pass 7 fix] a run-through logged more recently than any real chunk session wins as lastLoggedAt", () => {
    const withRecentRunThrough = {
      ...midPlan,
      progress: {
        ...midPlan.progress,
        __consolidation__: { doneDays: [3], sessions: [{ day: 3, stopCount: 1, loggedDate: "2026-07-01" }] },
      },
    };
    const m = validateAndMigratePiece(withRecentRunThrough);
    assert.equal(m.lastLoggedAt, "2026-07-01", "the run-through (2026-07-01) postdates c1's last real session (2026-06-05)");
  });

  test("[regression, Pass 7 fix] a run-through logged BEFORE the most recent real chunk session does not override it", () => {
    const withStaleRunThrough = {
      ...midPlan,
      progress: {
        ...midPlan.progress,
        __consolidation__: { doneDays: [3], sessions: [{ day: 3, stopCount: 1, loggedDate: "2026-06-02" }] },
      },
    };
    const m = validateAndMigratePiece(withStaleRunThrough);
    assert.equal(m.lastLoggedAt, "2026-06-05", "c1's real session is still the most recent overall");
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

// Pass 26 follow-up — per-stage tempo baselines (lib/ladder.js). No real
// per-stage history exists to reconstruct for a piece saved before this
// field existed, so the backfill treats "right now" as if the chunk just
// freshly entered whatever stage it's currently at.
describe("validateAndMigratePiece — per-stage entry-BPM backfill (Pass 26 follow-up)", () => {
  test("a chunk with no ladder state at all (pre-ladder history) backfills all three to null — there's no practiceBPM to seed from either", () => {
    const m = validateAndMigratePiece(midPlan);
    assert.equal(m.progress.c1.stabilizingEntryBPM, null);
    assert.equal(m.progress.c1.settlingEntryBPM, null);
    assert.equal(m.progress.c1.holdingEntryBPM, null);
  });

  test("a chunk already on the ladder in Settling, migrated before this field existed, backfills ONLY settlingEntryBPM from its current practiceBPM", () => {
    const custom = {
      id: "p_settling",
      name: "Étude",
      totalMeasures: 40,
      startDate: "2026-07-01",
      progress: {
        c1: {
          doneDays: [1],
          sessions: [],
          stage: "settling",
          consecutivePasses: 2,
          practiceBPM: 75,
        },
      },
    };
    const m = validateAndMigratePiece(custom);
    assert.equal(m.progress.c1.settlingEntryBPM, 75, "treated as if it just freshly entered Settling at its current tempo");
    assert.equal(m.progress.c1.stabilizingEntryBPM, null, "no fabricated history for a stage it isn't currently at");
    assert.equal(m.progress.c1.holdingEntryBPM, null);
  });

  test("a chunk already on the ladder in Holding backfills ONLY holdingEntryBPM", () => {
    const custom = {
      id: "p_holding",
      name: "Fugue",
      totalMeasures: 40,
      startDate: "2026-07-01",
      progress: {
        c1: { doneDays: [1], sessions: [], stage: "holding", practiceBPM: 118 },
      },
    };
    const m = validateAndMigratePiece(custom);
    assert.equal(m.progress.c1.holdingEntryBPM, 118);
    assert.equal(m.progress.c1.stabilizingEntryBPM, null);
    assert.equal(m.progress.c1.settlingEntryBPM, null);
  });

  test("explicit values already on a chunk (a piece saved by an app version that already has this feature) are never clobbered by the backfill", () => {
    const custom = {
      id: "p_already",
      name: "Waltz",
      totalMeasures: 40,
      startDate: "2026-07-01",
      progress: {
        c1: {
          doneDays: [1],
          sessions: [],
          stage: "holding",
          practiceBPM: 118,
          stabilizingEntryBPM: 40,
          settlingEntryBPM: 60,
          holdingEntryBPM: 90,
        },
      },
    };
    const m = validateAndMigratePiece(custom);
    assert.equal(m.progress.c1.stabilizingEntryBPM, 40);
    assert.equal(m.progress.c1.settlingEntryBPM, 60);
    assert.equal(m.progress.c1.holdingEntryBPM, 90, "the chunk's own recorded value wins, not a re-derived one from its current practiceBPM (118)");
  });

  test("the synthetic __consolidation__ entry is left alone, not given these fields either", () => {
    const m = validateAndMigratePiece(midPlan);
    assert.equal("stabilizingEntryBPM" in m.progress.__consolidation__, false);
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

  // documents (Pass 24) must merge exactly like the other {id, ...} lists
  // (sections, recordings, bpmZones) — additively by id, never a wholesale
  // replace. Follow-up fix: documents originally fell through to the
  // generic per-key preferByRecency merge below (missing from
  // MERGE_FIELDS_HANDLED_SEPARATELY and with no mergeById call), so an
  // import could silently drop a document the import didn't happen to
  // repeat. recordings gets no equivalent test in this suite — this one
  // stands in for both, since they now share the same merge call.
  test("documents merge additively by id — an import doesn't drop an existing document, and overlays a shared id", () => {
    const existingPiece = {
      ...fresh,
      id: "p_docs",
      documents: [
        { id: "d1", label: "Existing fingering chart", url: "https://existing.example/fingerings.pdf" },
        { id: "d2", label: "Old label", url: "https://existing.example/notes.pdf" },
      ],
    };
    const importedPiece = {
      ...fresh,
      id: "p_docs",
      documents: [
        { id: "d2", label: "Updated label from import", url: "https://existing.example/notes.pdf" },
        { id: "d3", label: "New from import", url: "https://imported.example/score.pdf" },
      ],
    };
    const merged = mergeImportedPiece(existingPiece, importedPiece);
    const byId = Object.fromEntries(merged.documents.map((d) => [d.id, d]));
    assert.equal(merged.documents.length, 3, "d1 (import-only-missing) survives, d2 overlays, d3 is added");
    assert.equal(byId.d1.label, "Existing fingering chart", "an existing document absent from the import is not dropped");
    assert.equal(byId.d2.label, "Updated label from import", "a shared id takes the import's fields");
    assert.equal(byId.d3.label, "New from import");
  });

  // Regression tests for the fix that follows the one above: mergeProgress
  // already protected the *ladder* fields unconditionally (stage,
  // consecutivePasses, etc. — never overwritten by an import at all), but
  // status/currentBPM/targetBPM/manualConfidence still went through plain
  // preferPresent, so a re-imported OLDER backup could silently un-pause/
  // un-archive a piece, or roll back a just-logged tempo or a manual
  // confidence override the user set today. mergeImportedPiece now compares
  // piece.updatedAt (bumped on every local mutation — App.jsx's updatePiece)
  // and only lets an import's value win when it isn't older than what's
  // already here.
  describe("mergeImportedPiece — importIsStale protects status/BPM/confidence from an older re-import", () => {
    test("[regression] re-importing an older backup does not silently un-pause a piece", () => {
      const existingPiece = { ...fresh, id: "p_status", status: "paused", updatedAt: 2000 };
      const staleImport = { ...fresh, id: "p_status", status: "active", updatedAt: 1000 };
      const merged = mergeImportedPiece(existingPiece, staleImport);
      assert.equal(merged.status, "paused", "the older import must not revert the piece back to active");
    });

    test("an import that is actually newer (e.g. status changed on another device) still wins", () => {
      const existingPiece = { ...fresh, id: "p_status2", status: "active", updatedAt: 1000 };
      const newerImport = { ...fresh, id: "p_status2", status: "archived", updatedAt: 2000 };
      const merged = mergeImportedPiece(existingPiece, newerImport);
      assert.equal(merged.status, "archived", "a genuinely newer import should still be allowed to change status");
    });

    test("[regression] re-importing an older backup does not roll back a chunk's currentBPM or manualConfidence", () => {
      const existingPiece = {
        ...fresh,
        id: "p_bpm",
        updatedAt: 2000,
        progress: { c1: { doneDays: [1], sessions: [], currentBPM: 100, manualConfidence: 80 } },
      };
      const staleImport = {
        ...fresh,
        id: "p_bpm",
        updatedAt: 1000,
        progress: { c1: { doneDays: [1], sessions: [], currentBPM: 40, manualConfidence: 10 } },
      };
      const merged = mergeImportedPiece(existingPiece, staleImport);
      assert.equal(merged.progress.c1.currentBPM, 100, "a stale import must not overwrite a more recent logged tempo");
      assert.equal(merged.progress.c1.manualConfidence, 80, "a stale import must not overwrite a more recent manual override");
    });

    test("a backup exported before piece.updatedAt existed is treated as stale, not as automatically winning", () => {
      // Missing imported.updatedAt reads as 0 — always older than any
      // existing piece that has a real timestamp (every piece loaded
      // through validateAndMigratePiece does). The conservative default:
      // an import we can't date is assumed to be the older copy.
      const existingPiece = { ...fresh, id: "p_no_ts", status: "archived", updatedAt: 5000 };
      const undatedImport = { ...fresh, id: "p_no_ts", status: "active" };
      const merged = mergeImportedPiece(existingPiece, undatedImport);
      assert.equal(merged.status, "archived");
    });

    test("merged.updatedAt is the max of both sides, so a later comparison isn't fooled by a stale import's own timestamp", () => {
      const existingPiece = { ...fresh, id: "p_ts", updatedAt: 5000 };
      const staleImport = { ...fresh, id: "p_ts", updatedAt: 1000 };
      const merged = mergeImportedPiece(existingPiece, staleImport);
      assert.equal(merged.updatedAt, 5000);
    });
  });
});

// Pass 12: the app-level "back up your data" nudge. lastExportedAt is the
// anchor whenever an export has actually happened; firstUseAt only matters
// as a fallback for a piece/app that's never been exported at all.
describe("isExportReminderDue — Pass 12 export reminder cadence", () => {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = 10_000_000; // arbitrary fixed "now" so tests don't depend on real time

  test("a lastExportedAt from over a day ago is due", () => {
    const lastExportedAt = now - ONE_DAY_MS - 1;
    assert.equal(isExportReminderDue(lastExportedAt, null, now), true);
  });

  test("a lastExportedAt from exactly one day ago is due (>=, not strictly >)", () => {
    const lastExportedAt = now - ONE_DAY_MS;
    assert.equal(isExportReminderDue(lastExportedAt, null, now), true);
  });

  test("a recent lastExportedAt (under a day old) is not due", () => {
    const lastExportedAt = now - (ONE_DAY_MS - 1);
    assert.equal(isExportReminderDue(lastExportedAt, null, now), false);
  });

  test("a lastExportedAt of right now is not due", () => {
    assert.equal(isExportReminderDue(now, null, now), false);
  });

  test("missing lastExportedAt falls back to firstUseAt", () => {
    const firstUseAt = now - ONE_DAY_MS - 1;
    assert.equal(isExportReminderDue(null, firstUseAt, now), true);
  });

  test("missing lastExportedAt with a recent firstUseAt is not due", () => {
    const firstUseAt = now - 1000;
    assert.equal(isExportReminderDue(null, firstUseAt, now), false);
  });

  test("lastExportedAt takes priority over firstUseAt when both are present", () => {
    // A piece exported recently but with an old firstUseAt (long-time user)
    // should not be nagged — the export, not the app's age, is what matters.
    const lastExportedAt = now - 1000;
    const firstUseAt = now - ONE_DAY_MS * 30;
    assert.equal(isExportReminderDue(lastExportedAt, firstUseAt, now), false);
  });

  test("both anchors missing (storage unavailable) is never due, not a false positive", () => {
    assert.equal(isExportReminderDue(null, null, now), false);
  });

  test("defaults `now` to Date.now() when omitted", () => {
    const lastExportedAt = Date.now() - ONE_DAY_MS - 5000;
    assert.equal(isExportReminderDue(lastExportedAt, null), true);
  });
});

// Pass 13: resolves the Decisions.md open question that a chunk's ladder
// state on import was always resolved by a silent "existing wins" rule.
// diffImportedPiece now tells apart "clean staleness" (updatedAt alone
// decides a winner, no user input needed) from "real divergence" (tied/
// unknown updatedAt plus an actual difference on a shared chunk — needs the
// ImportPiecesModal picker).
describe("diffImportedPiece — Pass 13 import divergence detection", () => {
  // A full six-field ladder-state chunk, with sane defaults so each test
  // only has to spell out the field(s) it actually cares about.
  function ladderChunk(overrides) {
    return {
      stage: "settling",
      consecutivePasses: 2,
      consecutiveStabilizingFails: 0,
      practiceBPM: 90,
      nextDueDate: "2026-07-10",
      tier1Done: true,
      ...overrides,
    };
  }

  test("clean staleness: import strictly older wins automatically for the existing side, no divergence", () => {
    const existing = { updatedAt: 5000, progress: { c1: ladderChunk({ stage: "settling" }) } };
    const imported = { updatedAt: 1000, progress: { c1: ladderChunk({ stage: "stabilizing" }) } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: false, resolution: "existing" });
  });

  test("clean staleness reversed: import strictly newer wins automatically for the imported side, no divergence (the historically-buggy 'opposite case')", () => {
    const existing = { updatedAt: 1000, progress: { c1: ladderChunk({ stage: "stabilizing" }) } };
    const imported = { updatedAt: 5000, progress: { c1: ladderChunk({ stage: "settling" }) } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: false, resolution: "imported" });
  });

  test("real divergence: tied updatedAt plus an actual difference on a shared chunk needs the picker", () => {
    const existing = { updatedAt: 3000, progress: { c1: ladderChunk({ stage: "settling", practiceBPM: 90 }) } };
    const imported = { updatedAt: 3000, progress: { c1: ladderChunk({ stage: "stabilizing", practiceBPM: 60 }) } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: true, resolution: null });
  });

  test("real divergence: both sides missing updatedAt entirely plus an actual difference also needs the picker", () => {
    const existing = { progress: { c1: ladderChunk({ consecutivePasses: 3 }) } };
    const imported = { progress: { c1: ladderChunk({ consecutivePasses: 0 }) } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: true, resolution: null });
  });

  test("tied updatedAt but identical ladder state on the shared chunk: no conflict to resolve, defaults to existing", () => {
    const existing = { updatedAt: 3000, progress: { c1: ladderChunk() } };
    const imported = { updatedAt: 3000, progress: { c1: ladderChunk() } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: false, resolution: "existing" });
  });

  test("tied updatedAt, differing chunks that don't overlap: not a conflict (nothing to compare)", () => {
    const existing = { updatedAt: 3000, progress: { c1: ladderChunk({ stage: "settling" }) } };
    const imported = { updatedAt: 3000, progress: { c2: ladderChunk({ stage: "stabilizing" }) } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: false, resolution: "existing" });
  });

  test("null and undefined on the same field are treated as equivalent, not a false divergence", () => {
    const existing = { updatedAt: 3000, progress: { c1: ladderChunk({ nextDueDate: null }) } };
    const imported = { updatedAt: 3000, progress: { c1: ladderChunk({ nextDueDate: undefined }) } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: false, resolution: "existing" });
  });

  test("the synthetic __consolidation__ entry is never compared, even if it differs", () => {
    const existing = { updatedAt: 3000, progress: { c1: ladderChunk(), __consolidation__: { doneDays: [1] } } };
    const imported = { updatedAt: 3000, progress: { c1: ladderChunk(), __consolidation__: { doneDays: [1, 2] } } };
    assert.deepEqual(diffImportedPiece(existing, imported), { hasDivergence: false, resolution: "existing" });
  });
});

describe("mergeImportedPiece — Pass 13 ladderChoice wiring", () => {
  const existing = {
    id: "p_ladder",
    name: "Ballade",
    totalMeasures: 40,
    startDate: "2026-01-01",
    updatedAt: 3000,
    progress: {
      c1: {
        doneDays: [1],
        sessions: [{ day: 1, loggedDate: "2026-01-01", cleanReps: 4, bpm: 90, outcome: "pass" }],
        stage: "settling",
        consecutivePasses: 3,
        consecutiveStabilizingFails: 0,
        practiceBPM: 90,
        nextDueDate: "2026-07-10",
        tier1Done: true,
      },
    },
  };
  const imported = {
    id: "p_ladder",
    name: "Ballade",
    totalMeasures: 40,
    startDate: "2026-01-01",
    updatedAt: 3000,
    progress: {
      c1: {
        doneDays: [1],
        sessions: [{ day: 1, loggedDate: "2026-01-01", cleanReps: 4, bpm: 90, outcome: "pass" }],
        stage: "stabilizing",
        consecutivePasses: 0,
        consecutiveStabilizingFails: 1,
        practiceBPM: 60,
        nextDueDate: "2026-07-01",
        tier1Done: false,
      },
    },
  };

  test("no ladderChoice argument at all keeps the pre-Pass-13 default (existing wins) — backward compatible with every existing call site", () => {
    const merged = mergeImportedPiece(existing, imported);
    assert.equal(merged.progress.c1.stage, "settling");
    assert.equal(merged.progress.c1.practiceBPM, 90);
  });

  test("explicit ladderChoice 'existing' behaves the same as omitting it", () => {
    const merged = mergeImportedPiece(existing, imported, "existing");
    assert.equal(merged.progress.c1.stage, "settling");
    assert.equal(merged.progress.c1.nextDueDate, "2026-07-10");
  });

  test("explicit ladderChoice 'imported' switches the whole piece's ladder state to the imported side", () => {
    const merged = mergeImportedPiece(existing, imported, "imported");
    assert.equal(merged.progress.c1.stage, "stabilizing");
    assert.equal(merged.progress.c1.consecutivePasses, 0);
    assert.equal(merged.progress.c1.consecutiveStabilizingFails, 1);
    assert.equal(merged.progress.c1.practiceBPM, 60);
    assert.equal(merged.progress.c1.nextDueDate, "2026-07-01");
    assert.equal(merged.progress.c1.tier1Done, false);
  });

  test("ladderChoice 'imported' still merges sessions/doneDays additively, not a wholesale swap of the chunk", () => {
    const withExtraSession = {
      ...imported,
      progress: {
        c1: {
          ...imported.progress.c1,
          doneDays: [1, 2],
          sessions: [...imported.progress.c1.sessions, { day: 2, loggedDate: "2026-01-02", cleanReps: 5, bpm: 65, outcome: "pass" }],
        },
      },
    };
    const merged = mergeImportedPiece(existing, withExtraSession, "imported");
    assert.deepEqual(merged.progress.c1.doneDays, [1, 2]);
    assert.equal(merged.progress.c1.sessions.length, 2);
  });
});

describe("mergeImportedPiece — Pass 32a follow-up: orderChoice wiring", () => {
  // existing.updatedAt < imported.updatedAt on purpose: the import is NOT
  // stale, so if sortOrder were still governed by the generic
  // preferByRecency loop (the pre-fix behavior), the imported value would
  // win outright with no orderChoice needed at all. That's exactly the
  // "re-importing an unstale backup silently reshuffles the switcher" bug
  // this test guards against — sortOrder must stay on `existing` here
  // regardless of which side is newer, unless the caller explicitly asks
  // for "imported".
  const existing = {
    id: "p_order", name: "Nocturne", totalMeasures: 40, startDate: "2026-01-01",
    updatedAt: 1000, sortOrder: 5,
  };
  const imported = {
    id: "p_order", name: "Nocturne", totalMeasures: 40, startDate: "2026-01-01",
    updatedAt: 2000, sortOrder: 2,
  };

  test("no orderChoice argument at all keeps the existing order, even though the import is newer", () => {
    const merged = mergeImportedPiece(existing, imported);
    assert.equal(merged.sortOrder, 5);
  });

  test("explicit orderChoice 'existing' behaves the same as omitting it", () => {
    const merged = mergeImportedPiece(existing, imported, "existing", "existing");
    assert.equal(merged.sortOrder, 5);
  });

  test("explicit orderChoice 'imported' switches to the imported side's sortOrder", () => {
    const merged = mergeImportedPiece(existing, imported, "existing", "imported");
    assert.equal(merged.sortOrder, 2);
  });

  test("orderChoice 'imported' falls back to existing when the import predates Pass 32a and has no sortOrder at all", () => {
    const { sortOrder, ...importedWithoutOrder } = imported;
    const merged = mergeImportedPiece(existing, importedWithoutOrder, "existing", "imported");
    assert.equal(merged.sortOrder, 5);
  });
});
