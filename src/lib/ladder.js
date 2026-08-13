/* ------------------------------------------------------------------ */
/*  Spaced-repetition maintenance ladder — pure stage-math engine.     */
/*                                                                     */
/*  Implements the Stabilizing/Settling/Holding card math described in */
/*  docs/Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built */
/*  ("The ladder: three stages" / "Session outcomes: three tiers").    */
/*  This is a sibling to computeConfidenceAsOf (confidence.js): a pure */
/*  derivation, no clock reads or storage access. Called from          */
/*  handleLogSession (App.jsx) on every logged session, which persists */
/*  the result — not wired into the scheduler or surfaced in any UI    */
/*  yet (nothing reads nextDueDate to show "what's due").              */
/*                                                                     */
/*  Reads the ladderConfig shape from storage.js's DEFAULT_LADDER_CONFIG —  */
/*  see that file for the piece-level tunable stage lengths / graduation   */
/*  counts / tempo floors / BPM ratchet step sizes (ladderConfig.bpmSteps).*/
/*                                                                     */
/*  chunkLadderState reads/writes one field beyond ChunkProgress's     */
/*  persisted shape — `consecutiveStabilizingFails`, added to          */
/*  storage.js's migration and Wizard.jsx's defaultPiece() alongside   */
/*  this file so the "two fails in a row while still in Stabilizing"   */
/*  signal below has something to count from (consecutivePasses alone  */
/*  can't tell a 1st fail from a 2nd — a fail always resets it to 0).   */
/*                                                                     */
/*  needsRelearning is a persisted, sticky flag (Pass 11) — once a fail   */
/*  turns it on, it stays on across subsequent calls (passed back in via  */
/*  chunkLadderState.needsRelearning) until either the normal 4-pass      */
/*  Stabilizing graduation clears it or the caller applies a manual       */
/*  override (App.jsx). It still isn't one of Revival's three documented  */
/*  auto-trigger conditions (all piece-wide — stop count, a lost          */
/*  combo/chunks, 60+ days untouched); this signal stays chunk-scoped, so */
/*  folding it into Revival isn't part of that design. Confirmed with the */
/*  user while building this; see Decisions.md#spaced-repetition--maintenance. */
/* ------------------------------------------------------------------ */

export const STAGES = ["stabilizing", "settling", "holding"];

// Duplicated from adaptiveReviewOffsets (scheduling.js:94-100) rather than
// imported — factoring it into a shared helper would mean editing
// scheduling.js, which isn't in this pass's Touches list (new-file-only).
// Worth extracting to lib/utils.js or lib/constants.js once something
// actually wires this module in.
function effectivenessMultiplier(effectiveness) {
  return effectiveness === "low" ? 0.6 : effectiveness === "high" ? 1.4 : 1;
}

function demote(stage) {
  if (stage === "holding") return "settling";
  if (stage === "settling") return "stabilizing";
  return "stabilizing"; // already the floor — a fail never drops below Stabilizing
}

function promote(stage) {
  if (stage === "stabilizing") return "settling";
  if (stage === "settling") return "holding";
  return "holding"; // no ceiling — Holding is the resting state
}

function stepBPM(practiceBPM, targetBPM, delta) {
  // Nothing to ratchet from yet — practiceBPM hasn't been seeded (that's
  // ladder-entry/Tier-1 setup, a different, out-of-scope concern).
  if (practiceBPM == null) return practiceBPM;
  const stepped = practiceBPM + delta;
  const capped = targetBPM != null ? Math.min(stepped, targetBPM) : stepped;
  return Math.max(0, capped);
}

// Absolute BPM a chunk's practiceBPM must be at/above for a full pass to
// count toward stage graduation ("the floor gates practiceBPM, not the
// per-session pass/fail itself" — doc). Stabilizing has no floor. Settling
// uses a flat fraction of targetBPM. Holding's floor escalates with
// `consecutivePasses` (+tempoFloorStepFraction per qualifying pass, capped
// at tempoFloorCapFraction) — reusing the same counter that also drives
// Holding's interval growth below, since the doc doesn't specify a
// separate persisted counter for it and Pass 1's schema doesn't have one.
// Without a targetBPM to measure against, there's nothing to gate against,
// so the floor is treated as already cleared.
function clearsStageFloor(stage, practiceBPM, targetBPM, ladderConfig, consecutivePasses) {
  if (targetBPM == null) return true;
  let floorFraction;
  if (stage === "stabilizing") {
    floorFraction = ladderConfig.stabilizing.tempoFloorFraction;
  } else if (stage === "settling") {
    floorFraction = ladderConfig.settling.tempoFloorFraction;
  } else {
    const { tempoFloorStartFraction, tempoFloorStepFraction, tempoFloorCapFraction } = ladderConfig.holding;
    floorFraction = Math.min(tempoFloorCapFraction, tempoFloorStartFraction + tempoFloorStepFraction * consecutivePasses);
  }
  if (floorFraction == null) return true;
  return practiceBPM != null && practiceBPM >= targetBPM * floorFraction;
}

// Days until the next due review for `stage`, given how many qualifying
// consecutive passes have accrued and this outcome's self-reported
// effectiveness. Stabilizing/Settling are flat per ladderConfig. Holding
// compounds `startIntervalDays` by the reused 0.6x/1x/1.4x effectiveness
// multiplier, raised to the power of consecutivePasses.
//
// This reconstructs Holding's interval from consecutivePasses + this
// call's own effectiveness alone, rather than literally compounding each
// session's own past multiplier onto a persisted running interval — there's
// no field storing "current Holding interval," by design, not gap: the
// counter this already reuses is enough to reconstruct it deterministically.
//
// A "low" effectiveness full pass in Holding can make the next interval
// *shorter* than the previous one (0.6x) — confirmed intentional with the
// user, not a bug: a shaky pass is exactly when the next check-in should
// come sooner, not later, even though it still technically counts as a
// pass. See Decisions.md#spaced-repetition--maintenance.
function intervalForStage(stage, ladderConfig, consecutivePasses, effectiveness) {
  if (stage === "stabilizing") return ladderConfig.stabilizing.intervalDays;
  if (stage === "settling") return ladderConfig.settling.intervalDays;
  const { startIntervalDays, maxIntervalDays } = ladderConfig.holding;
  const multiplier = effectivenessMultiplier(effectiveness);
  const raw = startIntervalDays * Math.pow(multiplier, consecutivePasses);
  return Math.min(maxIntervalDays, Math.max(1, Math.round(raw)));
}

function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Concept 3 of the starting/suggested/demonstrated tempo split
// (docs/Algorithms.md, lib/confidence.js's getSuggestedStartingBPM block
// comment): a session that clearly proves a chunk can already go faster
// than the ladder's normal incremental step assumed should replace the
// baseline outright, rather than nudging toward it a couple of BPM at a
// time over many future sessions.
//
// `minCleanReps` (3) is a fixed threshold from the product spec — 3
// consecutive "perfect" reps at a higher tempo — deliberately independent
// of REQUIRED_REPS' per-difficulty pass threshold (constants.js: 3/4/5).
// Confirmed with the user: "perfect rep" means "clean rep"
// (`session.cleanReps`, classifySessionOutcome's own vocabulary throughout
// lib/confidence.js) — not a stricter, separate concept.
//
// Applies on both 'pass' and 'soft-miss' outcomes — both log a real
// cleanReps count, and a soft-miss can still legitimately demonstrate a
// higher tempo (e.g. a hard chunk needing 5 reps to fully pass, but 3
// clean reps already logged well above the current baseline). Never
// applies on 'fail' — including a manual "needs more work" self-report or
// a repeat-soft-miss auto-fail — since a fail is an explicit "this isn't
// solid yet" signal a raw rep/tempo count shouldn't override, mirroring
// classifySessionOutcome's own "manualFail always wins" rule
// (lib/confidence.js). Returns null when the override doesn't apply, so
// callers fall back to the normal per-outcome stepBPM nudge.
export const DEMONSTRATED_TEMPO_MIN_CLEAN_REPS = 3;

export function computeDemonstratedTempoBaseline({ outcome, cleanReps, bpm, practiceBPM, targetBPM }) {
  if (outcome === "fail") return null;
  if ((cleanReps || 0) < DEMONSTRATED_TEMPO_MIN_CLEAN_REPS) return null;
  if (practiceBPM != null && bpm <= practiceBPM) return null;
  if (bpm == null) return null;
  return targetBPM != null ? Math.min(bpm, targetBPM) : bpm;
}

// Manual override applied when a run-through's Piece Map flag lands on
// 'rough' or 'lost' (Repertoire-Lifecycle.md's "Post-run-through logging")
// — distinct from computeLadderAdvance above, which only ever advances off
// an actually-logged, classified session outcome. 'rough' demotes exactly
// one stage, same rule as a fail. 'lost' forces the floor (Stabilizing)
// regardless of current stage. Both pin nextDueDate to `asOfDate` itself
// rather than computing a normal-cadence interval, since the design's
// explicit requirement is "imminent, regardless of the demoted stage's
// normal cadence" — not a shorter-than-usual interval, but due now.
// consecutivePasses resets to 0 for the same reason a fail resets it: those
// passes accrued at the old (higher) stage and shouldn't carry over toward
// graduating back out of the demoted one. Deliberately doesn't touch
// practiceBPM or consecutiveStabilizingFails/needsRelearning — those are
// specifically tied to logged session outcomes, and this is a manual
// judgment call about a run-through, not a classified session.
export function applyRunThroughFlag(chunkLadderState, flag, asOfDate) {
  const stage = STAGES.includes(chunkLadderState.stage) ? chunkLadderState.stage : "stabilizing";
  const newStage = flag === "lost" ? "stabilizing" : demote(stage);
  return {
    stage: newStage,
    consecutivePasses: 0,
    nextDueDate: asOfDate,
  };
}

// Advances one chunk's ladder card by exactly one already-classified
// session outcome. Pure — no clock reads, no storage access; `asOfDate`
// (the calendar date this outcome was logged on) is supplied by the
// caller so results are fully deterministic and table-testable.
//
// chunkLadderState = {
//   stage,                       // 'stabilizing' | 'settling' | 'holding' — defensively
//                                 // treated as 'stabilizing' if null/unrecognized (a chunk
//                                 // migrates in with stage: null, meaning "not on the ladder
//                                 // yet" — entering the ladder for the first time is separate,
//                                 // out-of-scope entry logic, not this fn)
//   consecutivePasses,            // number
//   consecutiveStabilizingFails,  // number — see header note on why this exists
//   practiceBPM,                  // number | null
//   targetBPM,                    // number | null — the chunk's actual tempo goal, used to
//                                 // turn ladderConfig's fraction-based floors into a BPM value
//   tier1Done,                    // boolean — read/passed through only, not used by this fn
//   needsRelearning,              // boolean — persisted re-learning flag (Pass 11), read back in
//                                 // so it stays set across calls until graduation or a manual
//                                 // override clears it. Defensively treated as false if absent.
//   suggestedStartingBPM,         // number | null — caller-resolved getSuggestedStartingBPM
//                                 // result (lib/confidence.js), needed here only for the instant
//                                 // a fail newly sets needsRelearning (rule 4: practiceBPM resets
//                                 // to this value then, not the normal -2 step). Computing it
//                                 // requires the full piece/chunk, which this pure module doesn't
//                                 // have — same reason targetBPM above is caller-resolved.
// }
// outcome = {
//   result,        // 'pass' | 'soft-miss' | 'fail' — already classified by the caller
//   effectiveness, // 'low' | 'good' | 'high' | undefined — reused for Holding's interval math
//   asOfDate,      // 'YYYY-MM-DD' — the calendar date this outcome happened
//   cleanReps,     // number — this session's clean-rep count, read only for
//                  // computeDemonstratedTempoBaseline's "3 perfect reps" check below
//   bpm,           // number — this session's achieved tempo, same purpose as cleanReps above
// }
//
// Returns a new chunkLadderState-shaped object (same fields, plus
// `graduated/demoted/needsRelearning` informational flags for this call).
export function computeLadderAdvance(chunkLadderState, outcome, ladderConfig) {
  const stage = STAGES.includes(chunkLadderState.stage) ? chunkLadderState.stage : "stabilizing";
  const consecutivePasses = chunkLadderState.consecutivePasses || 0;
  const consecutiveStabilizingFails = chunkLadderState.consecutiveStabilizingFails || 0;
  const wasFlagged = !!chunkLadderState.needsRelearning;
  const { practiceBPM, targetBPM, tier1Done, suggestedStartingBPM } = chunkLadderState;

  if (outcome.result === "fail") {
    const newStage = demote(stage);
    const newFailStreak = stage === "stabilizing" ? consecutiveStabilizingFails + 1 : 0;
    // Rule 1 (Decisions.md#spaced-repetition--maintenance): the signal
    // fires exactly once, on the fail that pushes the streak to 2 while
    // already in Stabilizing — not re-fired on every fail thereafter.
    const becomesFlagged = !wasFlagged && stage === "stabilizing" && newFailStreak >= 2;
    const newNeedsRelearning = wasFlagged || becomesFlagged;
    return {
      stage: newStage,
      consecutivePasses: 0,
      consecutiveStabilizingFails: newFailStreak,
      // Rule 4: practiceBPM resets to the suggested starting tempo at the
      // exact moment the flag turns on, instead of the normal -2 step —
      // never re-applied on later fails while already flagged.
      practiceBPM:
        becomesFlagged && suggestedStartingBPM != null
          ? suggestedStartingBPM
          : stepBPM(practiceBPM, targetBPM, ladderConfig.bpmSteps.fail),
      // Rule 3: reuses applyRunThroughFlag's 'lost' pin-to-today semantics
      // at the moment of flagging (newStage is already 'stabilizing' here,
      // since only a fail already in Stabilizing can trigger this) —
      // functionally moot once the flag is on (computeTimeline/
      // computeDueReviews skip it regardless), but keeps the persisted
      // date consistent with what a manual clear would resume against.
      nextDueDate: becomesFlagged
        ? outcome.asOfDate
        : addDaysISO(outcome.asOfDate, intervalForStage(newStage, ladderConfig, 0, outcome.effectiveness)),
      tier1Done,
      graduated: false,
      demoted: true,
      needsRelearning: newNeedsRelearning,
    };
  }

  if (outcome.result === "soft-miss") {
    const demonstrated = computeDemonstratedTempoBaseline({
      outcome: outcome.result,
      cleanReps: outcome.cleanReps,
      bpm: outcome.bpm,
      practiceBPM,
      targetBPM,
    });
    return {
      stage,
      consecutivePasses: 0,
      consecutiveStabilizingFails: 0,
      practiceBPM: demonstrated != null ? demonstrated : stepBPM(practiceBPM, targetBPM, ladderConfig.bpmSteps.softMiss),
      nextDueDate: addDaysISO(outcome.asOfDate, intervalForStage(stage, ladderConfig, consecutivePasses, outcome.effectiveness)),
      tier1Done,
      graduated: false,
      demoted: false,
      // Neither sets nor clears the flag — a soft-miss isn't a fail (so it
      // can't trigger rule 1) and isn't a full pass (so it can't graduate
      // rule 2's exit) — it just carries whatever was already there.
      needsRelearning: wasFlagged,
    };
  }

  // outcome.result === "pass"
  const clearsFloor = clearsStageFloor(stage, practiceBPM, targetBPM, ladderConfig, consecutivePasses);
  const passesIfCounted = clearsFloor ? consecutivePasses + 1 : consecutivePasses;
  const graduationPasses = ladderConfig[stage].graduationPasses;
  const shouldGraduate = clearsFloor && graduationPasses != null && passesIfCounted >= graduationPasses;
  const newStage = shouldGraduate ? promote(stage) : stage;
  const passesAfter = shouldGraduate ? 0 : passesIfCounted;
  const demonstratedOnPass = computeDemonstratedTempoBaseline({
    outcome: outcome.result,
    cleanReps: outcome.cleanReps,
    bpm: outcome.bpm,
    practiceBPM,
    targetBPM,
  });

  return {
    stage: newStage,
    consecutivePasses: passesAfter,
    consecutiveStabilizingFails: 0,
    practiceBPM: demonstratedOnPass != null ? demonstratedOnPass : stepBPM(practiceBPM, targetBPM, ladderConfig.bpmSteps.pass),
    nextDueDate: addDaysISO(outcome.asOfDate, intervalForStage(newStage, ladderConfig, passesAfter, outcome.effectiveness)),
    tier1Done,
    graduated: shouldGraduate,
    demoted: false,
    // Rule 2's auto exit: graduating out of Stabilizing (the only stage a
    // flagged chunk can be in) clears the flag same as a manual override
    // would. Any other pass just carries the flag through unchanged.
    needsRelearning: stage === "stabilizing" && shouldGraduate ? false : wasFlagged,
  };
}
