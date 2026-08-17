// Tests for Pass 29's "skip, just save time" branch of App.jsx's
// handleLogSession (Interleaved mode, TodayTab).
//
// handleLogSession is a closure inside the App component (App.jsx), not an
// exported pure function, and this repo has no React render harness — same
// constraint documented in session-undo.test.mjs. `logSession` below is a
// line-for-line mirror of App.jsx's actual reducer body as of this pass,
// re-using the real computeLadderAdvance (lib/ladder.js) on the non-skipped
// path, so what's under test here is the skipped early-return itself, not a
// reimplementation of the ladder.
//
// Revised after initial review: a skip must NOT add `day` to `doneDays` —
// it is explicitly not "marked completed," so the chunk stays open on the
// regular checklist and can still be logged for real later. The first
// version of this branch did add doneDays, which the tests below would
// have caught if they'd asserted the negative case explicitly (they only
// checked `doneDays.includes(5)` was true, which was the bug, not a check
// against it) — so this revision asserts the corrected behavior AND keeps
// the historical assertion inverted, as a guard against regressing back.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLadderAdvance } from "../src/lib/ladder.js";

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
};

// Mirrors App.jsx's handleLogSession, including Pass 29's `skipped` branch.
function logSession(progress, chunkId, day, sessionInput, loggedAt, loggedDate) {
  const { cleanReps, bpm, outcome, durationSeconds, targetBPM, suggestedStartingBPM, skipped } = sessionInput;
  const prevEntry = progress[chunkId] || { doneDays: [] };

  if (skipped) {
    const sessions = [...(prevEntry.sessions || []), { day, loggedAt, loggedDate, skipped: true, durationSeconds }];
    return { progress: { ...progress, [chunkId]: { ...prevEntry, sessions } }, lastLoggedAt: loggedDate };
  }

  const doneDays = prevEntry.doneDays.includes(day) ? prevEntry.doneDays : [...prevEntry.doneDays, day];
  const effectiveness = outcome === "fail" ? "low" : outcome === "pass" ? "high" : "good";
  const advance = computeLadderAdvance(
    {
      stage: prevEntry.stage,
      consecutivePasses: prevEntry.consecutivePasses,
      consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails,
      practiceBPM: prevEntry.practiceBPM != null ? prevEntry.practiceBPM : bpm,
      targetBPM,
      tier1Done: prevEntry.tier1Done,
      needsRelearning: prevEntry.needsRelearning,
      suggestedStartingBPM,
    },
    { result: outcome, effectiveness, asOfDate: loggedDate, cleanReps, bpm },
    LADDER_CONFIG
  );
  const sessions = [...(prevEntry.sessions || []), { day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds }];
  return {
    progress: {
      ...progress,
      [chunkId]: {
        ...prevEntry,
        doneDays,
        sessions,
        currentBPM: bpm,
        stage: advance.stage,
        consecutivePasses: advance.consecutivePasses,
        practiceBPM: advance.practiceBPM,
        nextDueDate: advance.nextDueDate,
      },
    },
    lastLoggedAt: loggedDate,
  };
}

describe("handleLogSession's skipped branch (Pass 29, Interleaved mode)", () => {
  test("appends a session record with time/loggedDate, and sets lastLoggedAt, without touching the ladder", () => {
    const progress = {
      chunk1: {
        doneDays: [3],
        sessions: [{ day: 3, cleanReps: 4, bpm: 90, outcome: "pass" }],
        stage: "settling",
        consecutivePasses: 2,
        practiceBPM: 92,
        nextDueDate: "2026-08-10",
      },
    };
    const result = logSession(progress, "chunk1", 5, { skipped: true, durationSeconds: 180 }, 1723800000000, "2026-08-16");

    const entry = result.progress.chunk1;
    assert.equal(entry.sessions.length, 2, "session record appended");
    const skippedSession = entry.sessions[1];
    assert.equal(skippedSession.skipped, true);
    assert.equal(skippedSession.durationSeconds, 180);
    assert.equal(skippedSession.loggedDate, "2026-08-16");
    assert.equal(skippedSession.loggedAt, 1723800000000);

    assert.equal(result.lastLoggedAt, "2026-08-16", "time-tracking timestamp still advances");

    // stage/practiceBPM/nextDueDate untouched — computeLadderAdvance never ran.
    assert.equal(entry.stage, "settling");
    assert.equal(entry.consecutivePasses, 2);
    assert.equal(entry.practiceBPM, 92);
    assert.equal(entry.nextDueDate, "2026-08-10");
  });

  test("does NOT add the day to doneDays — a skip is explicitly not 'marked completed'", () => {
    const progress = { chunk1: { doneDays: [3], sessions: [], stage: "settling" } };
    const result = logSession(progress, "chunk1", 5, { skipped: true, durationSeconds: 180 }, 1000, "2026-08-16");
    assert.deepEqual(result.progress.chunk1.doneDays, [3], "day 5 is NOT added — doneDays unchanged from before the skip");
    assert.equal(result.progress.chunk1.doneDays.includes(5), false);
  });

  test("a skipped session on a brand-new chunk (no prior entry) doesn't crash, doesn't mark it done, and doesn't seed a ladder stage", () => {
    const result = logSession({}, "chunk9", 1, { skipped: true, durationSeconds: 60 }, 1000, "2026-08-16");
    const entry = result.progress.chunk9;
    assert.equal(entry.sessions.length, 1);
    assert.equal(entry.sessions[0].skipped, true);
    assert.equal(entry.stage, undefined, "no ladder entry created by a skip");
    assert.deepEqual(entry.doneDays, [], "still not marked done");
  });

  test("contrast: a real (non-skipped) session on the same starting state DOES advance the ladder and mark the day done", () => {
    const progress = {
      chunk1: {
        doneDays: [3],
        sessions: [],
        stage: "settling",
        consecutivePasses: 2,
        practiceBPM: 92,
        nextDueDate: "2026-08-10",
      },
    };
    const result = logSession(
      progress,
      "chunk1",
      5,
      { cleanReps: 5, bpm: 92, outcome: "pass", durationSeconds: 180, targetBPM: 100 },
      1000,
      "2026-08-16"
    );
    const entry = result.progress.chunk1;
    assert.notEqual(entry.nextDueDate, "2026-08-10", "a real logged pass does advance nextDueDate");
    assert.equal(entry.doneDays.includes(5), true, "a real log DOES mark the day done, unlike a skip");
  });

  test("a chunk skipped once, then really logged later the same day, ends up marked done (the real log, not the skip, does that)", () => {
    let progress = { chunk1: { doneDays: [], sessions: [], stage: "holding", consecutivePasses: 1, practiceBPM: 100, nextDueDate: "2026-08-01" } };
    let result = logSession(progress, "chunk1", 5, { skipped: true, durationSeconds: 60 }, 1000, "2026-08-16");
    assert.deepEqual(result.progress.chunk1.doneDays, [], "still not done after the skip alone");

    result = logSession(
      result.progress,
      "chunk1",
      5,
      { cleanReps: 3, bpm: 100, outcome: "pass", durationSeconds: 90, targetBPM: 100 },
      2000,
      "2026-08-16"
    );
    assert.deepEqual(result.progress.chunk1.doneDays, [5], "the follow-up real log marks it done");
    assert.equal(result.progress.chunk1.sessions.length, 2, "both the skip and the real log are preserved in history");
  });
});
