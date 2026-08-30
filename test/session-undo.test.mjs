// Tests for Pass 10's full-ladder-reversal session undo
// (docs/Decisions.md's "session undo should fully reverse the ladder" entry).
//
// handleLogSession/handleUnlogSession are closures inside the App
// component (App.jsx), not exported pure functions, and this repo has no
// React render harness (no jsdom/testing-library dependency) — same
// constraint noted for earlier ladder/tempo passes. These helpers are a
// line-for-line mirror of App.jsx's actual reducer bodies (as of this
// pass), re-using the real computeLadderAdvance (lib/ladder.js) for the
// actual ladder math, so what's under test here is the snapshot-capture-
// and-restore mechanics this pass adds, not a reimplementation of the
// ladder itself.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLadderAdvance, applyRunThroughFlag } from "../src/lib/ladder.js";

const LADDER_CONFIG = {
  stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
  settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
  holding: {
    startIntervalDays: 14,
    maxIntervalDays: 70,
    tempoFloorStartFraction: 0.85,
    tempoFloorStepFraction: 0.05,
    tempoFloorCapFraction: 1,
  },
  bpmSteps: { pass: 2, softMiss: -2, fail: -2 },
  tempoRatchet: { k: 0.3, kCapBpm: 8 },
};

// Mirrors App.jsx's handleLogSession.
function logSession(progress, chunkId, day, sessionInput, loggedAt) {
  const { cleanReps, bpm, outcome, durationSeconds, targetBPM } = sessionInput;
  const prevEntry = progress[chunkId] || { doneDays: [] };
  const doneDays = prevEntry.doneDays.includes(day) ? prevEntry.doneDays : [...prevEntry.doneDays, day];
  const loggedDate = "2026-01-01";

  const ladderSnapshot = {
    stage: prevEntry.stage ?? null,
    consecutivePasses: prevEntry.consecutivePasses ?? 0,
    consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails ?? 0,
    practiceBPM: prevEntry.practiceBPM ?? null,
    nextDueDate: prevEntry.nextDueDate ?? null,
    tier1Done: prevEntry.tier1Done ?? false,
    currentBPM: prevEntry.currentBPM ?? null,
    stabilizingEntryBPM: prevEntry.stabilizingEntryBPM ?? null,
    settlingEntryBPM: prevEntry.settlingEntryBPM ?? null,
    holdingEntryBPM: prevEntry.holdingEntryBPM ?? null,
    tempoRatchetK: prevEntry.tempoRatchetK ?? null,
    holdingReviewCount: prevEntry.holdingReviewCount ?? null,
  };
  const sessions = [
    ...(prevEntry.sessions || []),
    { day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds, ladderSnapshot },
  ];

  const seededPracticeBPM = prevEntry.practiceBPM != null ? prevEntry.practiceBPM : bpm;
  const effectiveness = outcome === "fail" ? "low" : outcome === "pass" ? "high" : "good";

  const advance = computeLadderAdvance(
    {
      stage: prevEntry.stage,
      consecutivePasses: prevEntry.consecutivePasses,
      consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails,
      practiceBPM: seededPracticeBPM,
      targetBPM,
      tier1Done: prevEntry.tier1Done,
      stabilizingEntryBPM: prevEntry.stabilizingEntryBPM,
      settlingEntryBPM: prevEntry.settlingEntryBPM,
      holdingEntryBPM: prevEntry.holdingEntryBPM,
      tempoRatchetK: prevEntry.tempoRatchetK,
      holdingReviewCount: prevEntry.holdingReviewCount,
    },
    { result: outcome, effectiveness, asOfDate: loggedDate, cleanReps, bpm },
    LADDER_CONFIG
  );

  return {
    ...progress,
    [chunkId]: {
      ...prevEntry,
      doneDays,
      sessions,
      currentBPM: bpm,
      stage: advance.stage,
      consecutivePasses: advance.consecutivePasses,
      consecutiveStabilizingFails: advance.consecutiveStabilizingFails,
      practiceBPM: advance.practiceBPM,
      nextDueDate: advance.nextDueDate,
      tier1Done: advance.tier1Done,
      stabilizingEntryBPM: advance.stabilizingEntryBPM,
      settlingEntryBPM: advance.settlingEntryBPM,
      holdingEntryBPM: advance.holdingEntryBPM,
      tempoRatchetK: advance.tempoRatchetK,
      holdingReviewCount: advance.holdingReviewCount,
      flagSnapshot: undefined,
    },
  };
}

// Mirrors App.jsx's handleUnlogSession.
function unlogSession(progress, chunkId, day) {
  const prevEntry = progress[chunkId];
  if (!prevEntry) return progress;
  const sessions = [...(prevEntry.sessions || [])];
  const lastIdx = sessions.map((s) => s.day).lastIndexOf(day);
  if (lastIdx === -1) return progress;

  const isLatestSession = lastIdx === sessions.length - 1;
  const snapshot = sessions[lastIdx].ladderSnapshot;

  sessions.splice(lastIdx, 1);
  const stillHasDay = sessions.some((s) => s.day === day);
  const doneDays = stillHasDay ? prevEntry.doneDays : (prevEntry.doneDays || []).filter((d) => d !== day);

  let entry = { ...prevEntry, doneDays, sessions };
  if (isLatestSession && snapshot) {
    const isValidSnapshot =
      "stage" in snapshot &&
      "consecutivePasses" in snapshot &&
      "consecutiveStabilizingFails" in snapshot &&
      "practiceBPM" in snapshot &&
      "nextDueDate" in snapshot &&
      "tier1Done" in snapshot;
    if (isValidSnapshot) {
      entry = {
        ...entry,
        stage: snapshot.stage,
        consecutivePasses: snapshot.consecutivePasses,
        consecutiveStabilizingFails: snapshot.consecutiveStabilizingFails,
        practiceBPM: snapshot.practiceBPM,
        nextDueDate: snapshot.nextDueDate,
        tier1Done: snapshot.tier1Done,
        // Optional, exactly as in App.jsx: an older snapshot without the
        // key leaves currentBPM untouched rather than guessing a value.
        ...("currentBPM" in snapshot ? { currentBPM: snapshot.currentBPM } : {}),
        ...("stabilizingEntryBPM" in snapshot ? { stabilizingEntryBPM: snapshot.stabilizingEntryBPM } : {}),
        ...("settlingEntryBPM" in snapshot ? { settlingEntryBPM: snapshot.settlingEntryBPM } : {}),
        ...("holdingEntryBPM" in snapshot ? { holdingEntryBPM: snapshot.holdingEntryBPM } : {}),
        ...("tempoRatchetK" in snapshot ? { tempoRatchetK: snapshot.tempoRatchetK } : {}),
        ...("holdingReviewCount" in snapshot ? { holdingReviewCount: snapshot.holdingReviewCount } : {}),
      };
      // A flag whose flagSnapshot is still present can only have been
      // applied after this session (handleLogSession always clears
      // flagSnapshot on a real log) — undoing the session undoes that flag too.
      if (entry.flag && entry.flagSnapshot) {
        entry.flag = undefined;
        entry.flagSnapshot = undefined;
      }
    }
  }
  return { ...progress, [chunkId]: entry };
}

// Mirrors App.jsx's handleSetFlag, trimmed to just the fields this test
// file cares about (stage/consecutivePasses/nextDueDate/flag/flagSnapshot).
function setFlag(progress, chunkId, flag, asOfDate) {
  const prevEntry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
  const entry = { ...prevEntry, flag };
  if (flag === "rough" || flag === "lost") {
    if (!prevEntry.flag) {
      entry.flagSnapshot = {
        stage: prevEntry.stage ?? null,
        consecutivePasses: prevEntry.consecutivePasses ?? 0,
        nextDueDate: prevEntry.nextDueDate ?? null,
      };
    }
    const advance = applyRunThroughFlag({ stage: prevEntry.stage, consecutivePasses: prevEntry.consecutivePasses }, flag, asOfDate);
    entry.stage = advance.stage;
    entry.consecutivePasses = advance.consecutivePasses;
    entry.nextDueDate = advance.nextDueDate;
  } else if (prevEntry.flagSnapshot) {
    const snap = prevEntry.flagSnapshot;
    entry.stage = snap.stage;
    entry.consecutivePasses = snap.consecutivePasses;
    entry.nextDueDate = snap.nextDueDate;
    entry.flagSnapshot = undefined;
  }
  return { ...progress, [chunkId]: entry };
}

describe("Full-ladder-reversal undo — the pre-session state is restored exactly", () => {
  test("undoing a session logged as a full pass restores stage/consecutivePasses/consecutiveStabilizingFails/practiceBPM/nextDueDate/tier1Done", () => {
    let progress = {};
    progress = logSession(
      progress,
      "c1",
      1,
      { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 },
      1000
    );
    const before = { ...progress };
    // Confirm the pass actually moved the ladder, so the undo is a real test.
    assert.equal(before.c1.consecutivePasses, 1);
    // Pass 59: gap-proportional step (gap=120-80=40, k=0.3 -> 12, capped
    // at kCapBpm 8) — not the old flat +2.
    assert.equal(before.c1.practiceBPM, 88);

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.stage, null);
    assert.equal(progress.c1.consecutivePasses, 0);
    assert.equal(progress.c1.consecutiveStabilizingFails, 0);
    assert.equal(progress.c1.practiceBPM, null);
    assert.equal(progress.c1.nextDueDate, null);
    assert.equal(progress.c1.tier1Done, false);
    assert.equal(progress.c1.sessions.length, 0);
  });

  test("undoing a session logged as a soft-miss restores the exact pre-session ladder state", () => {
    // Post-migration real pieces always have a concrete tier1Done boolean
    // (storage.js backfills it), never undefined — start from that
    // realistic shape so the round-trip below is exact rather than
    // comparing a defaulted `false` against a JSON-serialization artifact.
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: false } };
    // Seed a first pass so there's real non-default state to revert to.
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    const stateBeforeSoftMiss = JSON.parse(JSON.stringify(progress.c1));

    progress = logSession(progress, "c1", 2, { cleanReps: 1, bpm: 78, outcome: "soft-miss", durationSeconds: 0, targetBPM: 120 }, 2000);
    assert.notEqual(progress.c1.practiceBPM, stateBeforeSoftMiss.practiceBPM); // confirm it actually moved

    progress = unlogSession(progress, "c1", 2);
    assert.equal(progress.c1.stage, stateBeforeSoftMiss.stage);
    assert.equal(progress.c1.consecutivePasses, stateBeforeSoftMiss.consecutivePasses);
    assert.equal(progress.c1.consecutiveStabilizingFails, stateBeforeSoftMiss.consecutiveStabilizingFails);
    assert.equal(progress.c1.practiceBPM, stateBeforeSoftMiss.practiceBPM);
    assert.equal(progress.c1.nextDueDate, stateBeforeSoftMiss.nextDueDate);
    assert.equal(progress.c1.tier1Done, stateBeforeSoftMiss.tier1Done);
  });

  test("undoing a session logged as a real fail restores the exact pre-session ladder state", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: false } };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    const stateBeforeFail = JSON.parse(JSON.stringify(progress.c1));

    progress = logSession(progress, "c1", 2, { cleanReps: 0, bpm: 70, outcome: "fail", durationSeconds: 0, targetBPM: 120 }, 2000);
    assert.notEqual(progress.c1.practiceBPM, stateBeforeFail.practiceBPM); // confirm it actually moved

    progress = unlogSession(progress, "c1", 2);
    assert.equal(progress.c1.stage, stateBeforeFail.stage);
    assert.equal(progress.c1.consecutivePasses, stateBeforeFail.consecutivePasses);
    assert.equal(progress.c1.consecutiveStabilizingFails, stateBeforeFail.consecutiveStabilizingFails);
    assert.equal(progress.c1.practiceBPM, stateBeforeFail.practiceBPM);
    assert.equal(progress.c1.nextDueDate, stateBeforeFail.nextDueDate);
    assert.equal(progress.c1.tier1Done, stateBeforeFail.tier1Done);
  });
});

describe("Fallback behavior — record removed only, ladder state untouched", () => {
  test("undoing a NON-latest session does not corrupt state: removes only that record, leaves the ladder as the later session left it", () => {
    let progress = {};
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    progress = logSession(progress, "c1", 2, { cleanReps: 4, bpm: 82, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 2000);
    const stateAfterBothSessions = JSON.parse(JSON.stringify(progress.c1));

    // Undo the FIRST (non-latest) session.
    progress = unlogSession(progress, "c1", 1);

    // The record for day 1 is gone...
    assert.equal(progress.c1.sessions.length, 1);
    assert.equal(progress.c1.sessions[0].day, 2);
    // ...but the ladder state is untouched (still reflects both sessions'
    // combined effect) — not reverted, and not corrupted/thrown.
    assert.equal(progress.c1.stage, stateAfterBothSessions.stage);
    assert.equal(progress.c1.consecutivePasses, stateAfterBothSessions.consecutivePasses);
    assert.equal(progress.c1.practiceBPM, stateAfterBothSessions.practiceBPM);
    assert.equal(progress.c1.nextDueDate, stateAfterBothSessions.nextDueDate);
  });

  test("undoing a pre-migration session with no ladderSnapshot falls back safely without throwing", () => {
    let progress = {
      c1: {
        doneDays: [1],
        sessions: [{ day: 1, loggedAt: 1000, loggedDate: "2026-01-01", cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0 }],
        stage: "stabilizing",
        consecutivePasses: 1,
        consecutiveStabilizingFails: 0,
        practiceBPM: 82,
        nextDueDate: "2026-01-05",
        tier1Done: false,
      },
    };

    assert.doesNotThrow(() => {
      progress = unlogSession(progress, "c1", 1);
    });
    // Record removed...
    assert.equal(progress.c1.sessions.length, 0);
    assert.equal(progress.c1.doneDays.includes(1), false);
    // ...but ladder state left exactly as it was (no snapshot to restore from).
    assert.equal(progress.c1.stage, "stabilizing");
    assert.equal(progress.c1.consecutivePasses, 1);
    assert.equal(progress.c1.practiceBPM, 82);
    assert.equal(progress.c1.nextDueDate, "2026-01-05");
  });

  test("a malformed/partial ladderSnapshot (missing a field) falls back safely rather than partially restoring", () => {
    let progress = {
      c1: {
        doneDays: [1],
        sessions: [
          {
            day: 1,
            loggedAt: 1000,
            loggedDate: "2026-01-01",
            cleanReps: 4,
            bpm: 80,
            outcome: "pass",
            durationSeconds: 0,
            ladderSnapshot: { stage: null, consecutivePasses: 0 }, // missing several required fields
          },
        ],
        stage: "stabilizing",
        consecutivePasses: 1,
        consecutiveStabilizingFails: 0,
        practiceBPM: 82,
        nextDueDate: "2026-01-05",
        tier1Done: false,
      },
    };

    assert.doesNotThrow(() => {
      progress = unlogSession(progress, "c1", 1);
    });
    assert.equal(progress.c1.stage, "stabilizing");
    assert.equal(progress.c1.practiceBPM, 82);
    assert.equal(progress.c1.nextDueDate, "2026-01-05");
  });
});

// currentBPM is the last tempo actually PLAYED, distinct from the ladder's
// practiceBPM (the tempo currently being asked for). It was deliberately
// left out of Pass 10's six-field snapshot; the consequence, logged as an
// open question in docs/Decisions.md and fixed here, was that
// computeAutoConfidence reads currentBPM directly, so a fully-undone chunk
// could still show a nonzero confidence score off a tempo it no longer had
// any session to justify.
describe("Undo reverses currentBPM too, not just the ladder fields", () => {
  test("undoing a chunk's ONLY session clears currentBPM back to its pre-session value (null)", () => {
    let progress = {};
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    assert.equal(progress.c1.currentBPM, 80, "sanity: logging sets currentBPM to the played tempo");

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.currentBPM, null, "a chunk with no sessions left must not still hold a played tempo");
    assert.equal(progress.c1.sessions.length, 0);
  });

  test("undoing the latest of several sessions restores the PREVIOUS session's tempo, not null", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: false } };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    progress = logSession(progress, "c1", 2, { cleanReps: 4, bpm: 95, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 2000);
    assert.equal(progress.c1.currentBPM, 95);

    progress = unlogSession(progress, "c1", 2);
    assert.equal(progress.c1.currentBPM, 80, "rolls back to the tempo the remaining session was played at");
  });

  test("[regression] an older snapshot missing currentBPM still restores the six original fields — it does not fail validation", () => {
    // The exact backward-compatibility trap this fix had to avoid: adding a
    // seventh key to the strict isValidSnapshot check would have made every
    // already-saved session fail it at once, silently downgrading them all
    // to record-only removal.
    let progress = {
      c1: {
        doneDays: [1],
        sessions: [
          {
            day: 1,
            loggedAt: 1000,
            cleanReps: 4,
            bpm: 90,
            outcome: "pass",
            ladderSnapshot: {
              stage: "stabilizing",
              consecutivePasses: 1,
              consecutiveStabilizingFails: 0,
              practiceBPM: 82,
              nextDueDate: "2026-01-05",
              tier1Done: false,
              // no currentBPM — logged before this fix existed
            },
          },
        ],
        stage: "settling",
        consecutivePasses: 2,
        practiceBPM: 92,
        currentBPM: 90,
      },
    };

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.stage, "stabilizing", "the six original fields still restore normally");
    assert.equal(progress.c1.practiceBPM, 82);
    assert.equal(progress.c1.nextDueDate, "2026-01-05");
    // Left untouched rather than guessed at — the old snapshot never recorded it.
    assert.equal(progress.c1.currentBPM, 90);
  });
});

// Pass 26 follow-up (lib/ladder.js) — the per-stage entry-BPM fields join
// ladderSnapshot the same way currentBPM did above: a fail can rewrite
// stabilizingEntryBPM/settlingEntryBPM/holdingEntryBPM (whenever it causes
// a genuine stage transition), so undoing that fail must roll them back
// too, or a later fail into the same stage would reset to a baseline that
// was only ever real because of the session that got undone.
describe("Undo reverses the per-stage entry-BPM fields too", () => {
  test("undoing the pass that graduated a chunk into Settling also reverses the freshly-recorded settlingEntryBPM", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: true, consecutivePasses: 3, stage: "stabilizing", practiceBPM: 40 } };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 40, outcome: "pass", durationSeconds: 0, targetBPM: 100 }, 1000);
    assert.equal(progress.c1.stage, "settling", "sanity: the 4th consecutive pass graduated it");
    // Pass 59: gap-proportional step (gap=100-40=60, k=0.3 -> 18, capped
    // at kCapBpm 8) — not the old flat +2.
    assert.equal(progress.c1.settlingEntryBPM, 48, "sanity: Settling's entry tempo was just recorded as the graduating tempo");

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.stage, "stabilizing");
    assert.equal(progress.c1.settlingEntryBPM, null, "no Settling entry was ever recorded before this now-undone graduation");
  });

  test("undoing a fail that reset practiceBPM to a recorded stage-entry tempo restores the PRE-fail practiceBPM, not the reset value", () => {
    let progress = {
      c1: { doneDays: [], sessions: [], tier1Done: true, stage: "stabilizing", practiceBPM: 90, stabilizingEntryBPM: 40 },
    };
    progress = logSession(progress, "c1", 1, { cleanReps: 0, bpm: 0, outcome: "fail", durationSeconds: 0, targetBPM: 100 }, 1000);
    assert.equal(progress.c1.practiceBPM, 40, "sanity: the fail reset all the way back to the recorded Stabilizing baseline");

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.practiceBPM, 90, "restores the tempo the chunk actually had before this fail, not the reset value");
    assert.equal(progress.c1.stabilizingEntryBPM, 40, "the baseline itself is unchanged either way — this fail never touched it (no stage transition)");
  });

  test("[regression] an older snapshot missing the three entry-BPM keys still restores normally, not a validation failure", () => {
    let progress = {
      c1: {
        doneDays: [1],
        sessions: [
          {
            day: 1,
            loggedAt: 1000,
            cleanReps: 4,
            bpm: 90,
            outcome: "pass",
            ladderSnapshot: {
              stage: "stabilizing",
              consecutivePasses: 1,
              consecutiveStabilizingFails: 0,
              practiceBPM: 82,
              nextDueDate: "2026-01-05",
              tier1Done: false,
              // no entry-BPM keys — logged before this fix existed
            },
          },
        ],
        stage: "settling",
        consecutivePasses: 2,
        practiceBPM: 92,
        stabilizingEntryBPM: 40,
        settlingEntryBPM: 92,
      },
    };

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.stage, "stabilizing", "the original fields still restore normally");
    assert.equal(progress.c1.practiceBPM, 82);
    // Left untouched rather than guessed at — the old snapshot never recorded them.
    assert.equal(progress.c1.stabilizingEntryBPM, 40);
    assert.equal(progress.c1.settlingEntryBPM, 92);
  });
});

// Pass 59 (lib/ladder.js) — tempoRatchetK joins ladderSnapshot the same way
// the per-stage entry-BPM fields did above: a soft-miss halves it, so
// undoing that soft-miss must roll the halving back too, or a later
// soft-miss would halve an already-halved rate that was only ever real
// because of the session that got undone.
describe("Undo reverses tempoRatchetK too", () => {
  test("undoing a soft-miss that halved tempoRatchetK restores the PRE-session rate, not the halved value", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: true, stage: "settling", practiceBPM: 80 } };
    progress = logSession(progress, "c1", 1, { cleanReps: 1, bpm: 78, outcome: "soft-miss", durationSeconds: 0, targetBPM: 100 }, 1000);
    assert.equal(progress.c1.tempoRatchetK, 0.15, "sanity: the soft-miss halved k from the default 0.3");

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.tempoRatchetK, null, "restores the pre-session value (unset, since this was the chunk's first session)");
  });

  test("undoing the 2nd of two consecutive passes restores tempoRatchetK to what it was after the 1st, not the fully-recovered default", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: true, stage: "settling", practiceBPM: 80, tempoRatchetK: 0.15 } };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 100 }, 1000);
    assert.equal(progress.c1.tempoRatchetK, 0.15, "one clean pass alone doesn't recover k yet");

    progress = logSession(progress, "c1", 2, { cleanReps: 4, bpm: 82, outcome: "pass", durationSeconds: 0, targetBPM: 100 }, 2000);
    assert.equal(progress.c1.tempoRatchetK, 0.3, "sanity: the 2nd consecutive pass recovered k to the default");

    progress = unlogSession(progress, "c1", 2);
    assert.equal(progress.c1.tempoRatchetK, 0.15, "restores the rate as it stood after the 1st pass, before recovery");
  });

  test("[regression] an older snapshot missing tempoRatchetK still restores the other fields normally, not a validation failure", () => {
    let progress = {
      c1: {
        doneDays: [1],
        sessions: [
          {
            day: 1,
            loggedAt: 1000,
            cleanReps: 4,
            bpm: 90,
            outcome: "pass",
            ladderSnapshot: {
              stage: "stabilizing",
              consecutivePasses: 1,
              consecutiveStabilizingFails: 0,
              practiceBPM: 82,
              nextDueDate: "2026-01-05",
              tier1Done: false,
              // no tempoRatchetK — logged before this pass existed
            },
          },
        ],
        stage: "settling",
        consecutivePasses: 2,
        practiceBPM: 92,
        tempoRatchetK: 0.15,
      },
    };

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.stage, "stabilizing", "the original fields still restore normally");
    assert.equal(progress.c1.practiceBPM, 82);
    // Left untouched rather than guessed at — the old snapshot never recorded it.
    assert.equal(progress.c1.tempoRatchetK, 0.15);
  });
});

// Pass 61 (lib/ladder.js) — holdingReviewCount joins ladderSnapshot the
// same way tempoRatchetK/the entry-BPM fields did above: it changes on
// every logged Holding review, so undoing one must roll that change back
// too, or a later review's harder-check cadence (resolveRequiredReps,
// lib/confidence.js) would be computed off a count that includes a review
// that no longer actually happened.
describe("Undo reverses holdingReviewCount too", () => {
  test("undoing a Holding review restores the pre-session count, not the incremented one", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: true, stage: "holding", practiceBPM: 100, holdingReviewCount: 2 } };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 100, outcome: "pass", durationSeconds: 0, targetBPM: 100 }, 1000);
    assert.equal(progress.c1.holdingReviewCount, 3, "sanity: the review incremented the count");

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.holdingReviewCount, 2, "restores the pre-session count");
  });

  test("undoing the pass that freshly promoted a chunk into Holding restores whatever holdingReviewCount was before — a leftover from an earlier Holding stint, not 0", () => {
    // A chunk that was demoted out of Holding once before still has its old
    // holdingReviewCount sitting on the entry (nothing reads or resets it
    // until the chunk re-enters Holding) — the snapshot must capture that
    // leftover value, not assume it was already 0 going in.
    let progress = {
      c1: { doneDays: [], sessions: [], tier1Done: true, stage: "settling", consecutivePasses: 3, practiceBPM: 70, holdingReviewCount: 5 },
    };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 70, outcome: "pass", durationSeconds: 0, targetBPM: 100 }, 1000);
    assert.equal(progress.c1.stage, "holding", "sanity: this pass graduated into Holding");
    assert.equal(progress.c1.holdingReviewCount, 0, "sanity: fresh entry into Holding resets the count");

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.stage, "settling", "back to Settling");
    assert.equal(progress.c1.holdingReviewCount, 5, "restores the leftover count from before this call — not 0, and not the reset value");
  });

  test("[regression] an older snapshot missing holdingReviewCount still restores the other fields normally, not a validation failure", () => {
    let progress = {
      c1: {
        doneDays: [1],
        sessions: [
          {
            day: 1,
            loggedAt: 1000,
            cleanReps: 4,
            bpm: 100,
            outcome: "pass",
            ladderSnapshot: {
              stage: "holding",
              consecutivePasses: 3,
              consecutiveStabilizingFails: 0,
              practiceBPM: 98,
              nextDueDate: "2026-01-15",
              tier1Done: true,
              // no holdingReviewCount — logged before this pass existed
            },
          },
        ],
        stage: "holding",
        consecutivePasses: 4,
        practiceBPM: 100,
        holdingReviewCount: 4,
      },
    };

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.stage, "holding", "the original fields still restore normally");
    assert.equal(progress.c1.practiceBPM, 98);
    // Left untouched rather than guessed at — the old snapshot never recorded it.
    assert.equal(progress.c1.holdingReviewCount, 4);
  });
});

describe("Undo also undoes a rough/lost flag applied on top of the undone session", () => {
  test("flagging a chunk after logging a session, then undoing that session, clears the flag too", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: false } };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    const stateBeforeSession = { stage: null, consecutivePasses: 0, consecutiveStabilizingFails: 0, practiceBPM: null, nextDueDate: null, tier1Done: false };

    progress = setFlag(progress, "c1", "rough", "2026-01-02");
    assert.equal(progress.c1.flag, "rough");
    assert.ok(progress.c1.flagSnapshot, "flagSnapshot should be captured on the untouched->rough transition");

    progress = unlogSession(progress, "c1", 1);

    // The flag is gone, not just the ladder state.
    assert.equal(progress.c1.flag, undefined);
    assert.equal(progress.c1.flagSnapshot, undefined);
    // And the ladder state is the true pre-session state, not the
    // post-session-pre-flag state flagSnapshot itself would have restored.
    assert.equal(progress.c1.stage, stateBeforeSession.stage);
    assert.equal(progress.c1.consecutivePasses, stateBeforeSession.consecutivePasses);
    assert.equal(progress.c1.practiceBPM, stateBeforeSession.practiceBPM);
    assert.equal(progress.c1.nextDueDate, stateBeforeSession.nextDueDate);
  });

  test("a flag that survived a LATER real session log (flagSnapshot already cleared) is left untouched by undo", () => {
    let progress = { c1: { doneDays: [], sessions: [], tier1Done: false } };
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    progress = setFlag(progress, "c1", "rough", "2026-01-02");
    // A real session logged AFTER the flag clears flagSnapshot (handleLogSession's
    // existing behavior — genuine progress must not be discardable by the flag cycle).
    progress = logSession(progress, "c1", 2, { cleanReps: 4, bpm: 85, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 2000);
    assert.equal(progress.c1.flagSnapshot, undefined);
    assert.equal(progress.c1.flag, "rough");

    progress = unlogSession(progress, "c1", 2);

    // The flag predates (well, survived past) this session — undo leaves it alone.
    assert.equal(progress.c1.flag, "rough");
  });

  test("undoing a session that predates the flag entirely (flag set on an untouched chunk, before any session) leaves the flag alone", () => {
    // Flag first, chunk never touched — flagSnapshot captured from the
    // untouched defaults.
    let progress = setFlag({}, "c1", "lost", "2026-01-01");
    assert.equal(progress.c1.flag, "lost");
    assert.ok(progress.c1.flagSnapshot);

    // A session logged afterward clears flagSnapshot exactly as it would in the app.
    progress = logSession(progress, "c1", 1, { cleanReps: 4, bpm: 80, outcome: "pass", durationSeconds: 0, targetBPM: 120 }, 1000);
    assert.equal(progress.c1.flagSnapshot, undefined);

    progress = unlogSession(progress, "c1", 1);
    assert.equal(progress.c1.flag, "lost");
  });
});
