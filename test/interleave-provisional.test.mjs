// Tests for Pass 29 follow-up's provisional-logging mechanism (Interleaved
// mode): App.jsx's handleLogSession `provisional` branch, plus the two new
// handlers handleConfirmProvisionalSession / handleDiscardProvisionalSession.
//
// Same constraint as session-undo.test.mjs and interleave-skip.test.mjs:
// these are closures inside the App component, not exported pure functions,
// and this repo has no React render harness. The mirrors below are
// line-for-line copies of App.jsx's actual reducer bodies as of this pass,
// reusing the real computeLadderAdvance (lib/ladder.js) for the ladder math
// itself — what's under test here is the provisional-record bookkeeping
// (save without committing, confirm-applies-later, discard-removes-clean),
// not a reimplementation of the ladder.
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
  tempoRatchet: { k: 0.3, kCapBpm: 8 },
};

// Mirrors App.jsx's handleLogSession `provisional` branch only.
function logProvisionalSession(progress, chunkId, day, sessionInput, loggedAt, loggedDate) {
  const { cleanReps, bpm, outcome, durationSeconds } = sessionInput;
  const prevEntry = progress[chunkId] || { doneDays: [] };
  const sessions = [
    ...(prevEntry.sessions || []),
    { day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds, provisional: true },
  ];
  return { ...progress, [chunkId]: { ...prevEntry, sessions } };
}

// Mirrors App.jsx's handleConfirmProvisionalSession.
function confirmProvisionalSession(progress, chunkId, day, { targetBPM, suggestedStartingBPM } = {}, loggedDate) {
  const prevEntry = progress[chunkId];
  if (!prevEntry) return progress;
  const sessions = [...(prevEntry.sessions || [])];
  const idx = sessions.map((s) => s.day === day && !!s.provisional).lastIndexOf(true);
  if (idx === -1) return progress;
  const target = sessions[idx];

  const ladderSnapshot = {
    stage: prevEntry.stage ?? null,
    consecutivePasses: prevEntry.consecutivePasses ?? 0,
    consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails ?? 0,
    practiceBPM: prevEntry.practiceBPM ?? null,
    nextDueDate: prevEntry.nextDueDate ?? null,
    tier1Done: prevEntry.tier1Done ?? false,
    needsRelearning: prevEntry.needsRelearning ?? false,
  };

  const seededPracticeBPM = prevEntry.practiceBPM != null ? prevEntry.practiceBPM : target.bpm;
  const effectiveness = target.outcome === "fail" ? "low" : target.outcome === "pass" ? "high" : "good";
  const advance = computeLadderAdvance(
    {
      stage: prevEntry.stage,
      consecutivePasses: prevEntry.consecutivePasses,
      consecutiveStabilizingFails: prevEntry.consecutiveStabilizingFails,
      practiceBPM: seededPracticeBPM,
      targetBPM,
      tier1Done: prevEntry.tier1Done,
      needsRelearning: prevEntry.needsRelearning,
      suggestedStartingBPM,
    },
    { result: target.outcome, effectiveness, asOfDate: loggedDate, cleanReps: target.cleanReps, bpm: target.bpm },
    LADDER_CONFIG
  );

  sessions[idx] = { ...target, provisional: false, ladderSnapshot };
  const doneDays = prevEntry.doneDays.includes(target.day) ? prevEntry.doneDays : [...prevEntry.doneDays, target.day];

  return {
    ...progress,
    [chunkId]: {
      ...prevEntry,
      doneDays,
      sessions,
      currentBPM: target.bpm,
      stage: advance.stage,
      consecutivePasses: advance.consecutivePasses,
      practiceBPM: advance.practiceBPM,
      nextDueDate: advance.nextDueDate,
    },
  };
}

// Mirrors App.jsx's handleDiscardProvisionalSession.
function discardProvisionalSession(progress, chunkId, day) {
  const prevEntry = progress[chunkId];
  if (!prevEntry) return progress;
  const sessions = [...(prevEntry.sessions || [])];
  const idx = sessions.map((s) => s.day === day && !!s.provisional).lastIndexOf(true);
  if (idx === -1) return progress;
  sessions.splice(idx, 1);
  return { ...progress, [chunkId]: { ...prevEntry, sessions } };
}

describe("handleLogSession's provisional branch", () => {
  test("saves real cleanReps/bpm/outcome, but does not touch doneDays, stage, practiceBPM, or nextDueDate", () => {
    let progress = {
      c1: { doneDays: [3], sessions: [], stage: "settling", consecutivePasses: 1, practiceBPM: 80, nextDueDate: "2026-08-01" },
    };
    progress = logProvisionalSession(
      progress,
      "c1",
      5,
      { cleanReps: 1, bpm: 78, outcome: "soft-miss", durationSeconds: 90 },
      1000,
      "2026-08-16"
    );
    const entry = progress.c1;
    assert.equal(entry.sessions.length, 1);
    const s = entry.sessions[0];
    assert.equal(s.provisional, true);
    assert.equal(s.cleanReps, 1);
    assert.equal(s.bpm, 78);
    assert.equal(s.outcome, "soft-miss");
    assert.deepEqual(entry.doneDays, [3], "day 5 NOT added — not marked done until confirmed");
    assert.equal(entry.stage, "settling", "untouched");
    assert.equal(entry.practiceBPM, 80, "untouched");
    assert.equal(entry.nextDueDate, "2026-08-01", "untouched");
  });
});

describe("handleConfirmProvisionalSession", () => {
  test("applies the saved outcome through computeLadderAdvance, marks the original attempt day done, and clears the provisional flag", () => {
    let progress = {
      c1: { doneDays: [3], sessions: [], stage: "settling", consecutivePasses: 3, practiceBPM: 80, nextDueDate: "2026-08-01" },
    };
    progress = logProvisionalSession(
      progress,
      "c1",
      5,
      { cleanReps: 4, bpm: 82, outcome: "pass", durationSeconds: 90 },
      1000,
      "2026-08-10"
    );
    // Confirmed days later — asOfDate for the ladder math is the
    // CONFIRM date, not the original attempt date.
    progress = confirmProvisionalSession(progress, "c1", 5, { targetBPM: 100 }, "2026-08-16");

    const entry = progress.c1;
    assert.equal(entry.sessions[0].provisional, false, "no longer provisional");
    assert.ok(entry.sessions[0].ladderSnapshot, "confirming stamps a ladderSnapshot, same as a normal log, so undo can fully reverse it");
    assert.deepEqual(entry.doneDays, [3, 5], "day 5 (the ORIGINAL attempt day) is now marked done");
    assert.equal(entry.stage, "holding", "4th consecutive pass graduates Settling -> Holding");
    assert.equal(entry.nextDueDate, "2026-08-30", "scheduled from the CONFIRM date (Aug 16), not the original attempt date (Aug 10) — 14 days out for fresh Holding");
  });

  test("a confirmed soft-miss/fail demotes the ladder exactly like a normal logged one would", () => {
    let progress = { c1: { doneDays: [], sessions: [], stage: "settling", consecutivePasses: 2, practiceBPM: 80 } };
    progress = logProvisionalSession(progress, "c1", 1, { cleanReps: 0, bpm: 70, outcome: "fail", durationSeconds: 60 }, 1000, "2026-08-16");
    progress = confirmProvisionalSession(progress, "c1", 1, { targetBPM: 100 }, "2026-08-16");
    assert.equal(progress.c1.stage, "stabilizing", "a confirmed fail demotes exactly one stage, same as computeLadderAdvance always does");
    assert.equal(progress.c1.consecutivePasses, 0);
  });

  test("no-op (returns the same progress) when there is no pending provisional session for that day", () => {
    const progress = { c1: { doneDays: [1], sessions: [{ day: 1, cleanReps: 4, bpm: 90, outcome: "pass" }], stage: "settling" } };
    const result = confirmProvisionalSession(progress, "c1", 1, { targetBPM: 100 }, "2026-08-16");
    assert.deepEqual(result, progress);
  });

  test("confirming targets only the most recent PROVISIONAL session for that day, not an already-resolved session logged the same day", () => {
    let progress = { c1: { doneDays: [5], sessions: [{ day: 5, cleanReps: 4, bpm: 90, outcome: "pass" }], stage: "settling", consecutivePasses: 1, practiceBPM: 90 } };
    progress = logProvisionalSession(progress, "c1", 5, { cleanReps: 1, bpm: 85, outcome: "soft-miss", durationSeconds: 60 }, 2000, "2026-08-16");
    progress = confirmProvisionalSession(progress, "c1", 5, { targetBPM: 100 }, "2026-08-16");
    assert.equal(progress.c1.sessions.length, 2);
    assert.equal(progress.c1.sessions[0].provisional, undefined, "the earlier real session was never provisional — untouched");
    assert.equal(progress.c1.sessions[1].provisional, false, "the provisional one is now resolved");
  });
});

describe("handleDiscardProvisionalSession", () => {
  test("removes the provisional record outright, with no ladder change (it never advanced the ladder to begin with)", () => {
    let progress = { c1: { doneDays: [3], sessions: [], stage: "settling", consecutivePasses: 2, practiceBPM: 80, nextDueDate: "2026-08-01" } };
    progress = logProvisionalSession(progress, "c1", 5, { cleanReps: 1, bpm: 75, outcome: "soft-miss", durationSeconds: 60 }, 1000, "2026-08-16");
    progress = discardProvisionalSession(progress, "c1", 5);

    const entry = progress.c1;
    assert.equal(entry.sessions.length, 0, "the provisional record is gone, as if it never happened");
    assert.deepEqual(entry.doneDays, [3], "unaffected — it was never added");
    assert.equal(entry.stage, "settling", "unaffected");
    assert.equal(entry.practiceBPM, 80, "unaffected");
  });

  test("no-op when there is no pending provisional session for that day", () => {
    const progress = { c1: { doneDays: [1], sessions: [{ day: 1, cleanReps: 4, bpm: 90, outcome: "pass" }], stage: "settling" } };
    const result = discardProvisionalSession(progress, "c1", 1);
    assert.deepEqual(result, progress);
  });

  test("discard-then-relog is how a rough interleaved attempt gets 'redone'", () => {
    let progress = { c1: { doneDays: [], sessions: [], stage: "holding", practiceBPM: 100 } };
    progress = logProvisionalSession(progress, "c1", 1, { cleanReps: 1, bpm: 90, outcome: "soft-miss", durationSeconds: 60 }, 1000, "2026-08-16");
    progress = discardProvisionalSession(progress, "c1", 1);
    // A fresh, non-provisional log now stands alone.
    progress = { ...progress, c1: { ...progress.c1, sessions: [...progress.c1.sessions, { day: 1, cleanReps: 3, bpm: 100, outcome: "pass" }] } };
    assert.equal(progress.c1.sessions.length, 1, "only the redo remains — the discarded rough attempt left no trace");
  });
});

describe("loggedSessions (lib/utils.js) also excludes provisional sessions", () => {
  test("a provisional session is excluded from what counts as judged practice, same as a skipped one", async () => {
    const { loggedSessions } = await import("../src/lib/utils.js");
    const sessions = [
      { day: 1, cleanReps: 4, bpm: 90, outcome: "pass" },
      { day: 2, cleanReps: 1, bpm: 80, outcome: "soft-miss", provisional: true },
    ];
    const result = loggedSessions(sessions);
    assert.equal(result.length, 1);
    assert.equal(result[0].outcome, "pass");
  });
});
