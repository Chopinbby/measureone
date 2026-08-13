import { clamp, rangesOverlap } from "./utils";
import { REQUIRED_REPS } from "./constants";
import { STAGES } from "./ladder";

// A measure-range tempo target set in Settings (or the whole-piece default)
// applies to any chunk whose measures fall in that zone, unless the chunk has
// its own explicit target set from the Piece Map.
export function getDefaultTargetBPM(piece, chunk) {
  const zone = (piece.bpmZones || []).find((z) => rangesOverlap(chunk.start, chunk.end, z.start, z.end));
  if (zone) return zone.bpm;
  return piece.targetBPM || null;
}

// ------------------------------------------------------------------
// Starting tempo has three distinct concepts, not one (see
// docs/Algorithms.md's "Starting, suggested, and demonstrated tempo" and
// docs/Decisions.md for the full writeup — this replaces an earlier,
// conflated single-function version of this):
//
//   1. SUGGESTED starting tempo (this function) — a system recommendation
//      from target BPM + difficulty alone. Guidance only: it is shown to
//      the learner (ChecklistItem's first-encounter note) but never
//      silently written into a chunk's actual practice state.
//   2. USER-SELECTED starting tempo — whatever the learner actually logs
//      the first time they touch a chunk, whether that matches the
//      suggestion or not. This — not the suggestion — is what
//      handleLogSession (App.jsx) seeds `practiceBPM` from.
//   3. DEMONSTRATED tempo — practiceBPM is later overridden outright by a
//      session that proves the chunk can go faster than the ladder's
//      normal incremental step would suggest (see
//      computeDemonstratedTempoBaseline, lib/ladder.js).
//
// All future goal calculations (tempo floors, the next ratchet step, etc.)
// read `practiceBPM` — i.e. concept 2, later superseded by concept 3 — and
// never concept 1. This function only ever produces concept 1.
// ------------------------------------------------------------------

// Per-difficulty diminishing-returns curve: suggested = base * (target/100)^k.
// `base` is the exact recommendation at a 100 BPM target; `k` (< 1,
// sub-linear) controls how much more slowly the suggestion grows than the
// target as target increases — a fast piece shouldn't ask an "easy" chunk
// to start anywhere near as fast as its target, but a merely-fast easy
// chunk and a very-fast one shouldn't get wildly different suggestions
// either. Replaces an earlier flat-fraction version (75%/65%/55% of target,
// every target) that was too aggressive at high target tempos — a 240 BPM
// "easy" chunk doesn't belong starting near 180.
//
// Hand-fit (not derived from a study — same status as every other tunable
// constant here, see docs/Research.md) against four product-supplied
// calibration points; `k` solved from the 100→240 BPM pair, then checked
// against 140/180:
//   target 100 → easy 75   / medium 60   / hard 45    (exact, k has no effect at target=100)
//   target 140 → easy ~82  / medium ~64  / hard ~47   (spec range 80–85 / 60–70 / 45–50)
//   target 180 → easy ~88  / medium ~67  / hard ~48   (spec range 85–90 / 65–70 / 45–50)
//   target 240 → easy ~95  / medium ~70  / hard ~50   (spec range 90–100 / 65–75 / 45–55)
const SUGGESTED_STARTING_TEMPO_CURVE = {
  easy: { base: 75, k: 0.27 },
  medium: { base: 60, k: 0.18 },
  hard: { base: 45, k: 0.12 },
};

// Concept 1 (see block comment above): a system-recommended starting tempo
// from target BPM + difficulty only. Guidance only — see getDefaultTargetBPM
// for the target-resolution rule this reuses. Without a target BPM there's
// nothing to calibrate against, so this returns null, same convention as
// getDefaultTargetBPM.
export function getSuggestedStartingBPM(piece, chunk) {
  const entry = piece.progress[chunk.id] || {};
  const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, chunk);
  if (!targetBPM) return null;
  const curve = SUGGESTED_STARTING_TEMPO_CURVE[chunk.difficultyLabel] || SUGGESTED_STARTING_TEMPO_CURVE.medium;
  return Math.round(curve.base * Math.pow(targetBPM / 100, curve.k));
}

// Classifies one logged attempt into the three-tier outcome model
// (Repertoire-Lifecycle.md's "Session outcomes: three tiers, not two"):
// - full pass: required clean reps hit, at/above the tempo currently asked
//   for (practiceBPM). manualFail always wins regardless.
// - real fail: zero clean reps (a genuine miss, not "some but not enough"),
//   OR a manual "needs more work" override (self-report escape hatch — the
//   folded-in replacement for the old separate "how did it feel" input,
//   catching what the numbers alone can't: memory slips, poor technique
//   despite clean reps), OR a repeat soft-miss right after the previous one
//   (repeated soft-misses even after backing off — see the doc).
// - soft-miss: some clean reps, just not enough (or not at the asked
//   tempo) to count as a full pass — the default middle case.
// `practiceBPM` may be null (chunk not yet seeded onto the ladder); a null
// floor is treated as already cleared, same convention as lib/ladder.js.
export function classifySessionOutcome({ cleanReps, bpm, requiredReps, practiceBPM, manualFail, previousOutcome }) {
  if (manualFail) return "fail";
  if (!cleanReps || cleanReps <= 0) return "fail";
  const clearsTempo = practiceBPM == null || bpm >= practiceBPM;
  if (cleanReps >= requiredReps && clearsTempo) return "pass";
  if (previousOutcome === "soft-miss") return "fail";
  return "soft-miss";
}

// Sessions logged before the pass/soft-miss/fail model only carry
// `effectiveness` ('low'/'good'/'high'), not `outcome` — this maps between
// them so history logged before this model shipped keeps contributing real
// signal to confidence/scheduling/classification instead of reading as
// silently neutral. Not a semantic claim that "good" truly meant
// "soft-miss" — just the mapping that preserves each value's old 0.6/1/1.4
// multiplier effect (see adaptiveReviewOffsets, scheduling.js).
export function sessionOutcome(session) {
  if (session.outcome) return session.outcome;
  if (session.effectiveness === "low") return "fail";
  if (session.effectiveness === "high") return "pass";
  if (session.effectiveness === "good") return "soft-miss";
  return null;
}

// Auto-computed confidence blends: how many clean reps were actually logged
// relative to the target (not just that a session happened), how close the
// achieved tempo was to the goal BPM, recency of last practice, the
// learner's own feedback on how their last session felt, difficulty, and
// recurring status.
export function computeAutoConfidence(chunk, piece, currentDay) {
  const entry = piece.progress[chunk.id] || {};
  const doneDays = entry.doneDays || [];
  if (doneDays.length === 0 && !entry.currentBPM) return 0;

  const requiredReps = REQUIRED_REPS[chunk.difficultyLabel] || 4;
  const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, chunk);
  const sessions = entry.sessions || [];

  let repQuality = 0;
  sessions.forEach((s) => {
    const repRatio = clamp((s.cleanReps || 0) / requiredReps, 0, 1);
    const bpmRatio = targetBPM ? clamp((s.bpm || 0) / targetBPM, 0, 1) : 0.6;
    repQuality += repRatio * (0.5 + 0.5 * bpmRatio);
  });
  const repsScore = Math.min(55, repQuality * 18);

  const lastDay = doneDays.length ? Math.max(...doneDays) : currentDay;
  const daysSince = Math.max(0, currentDay - lastDay);
  const recencyScore = Math.max(0, 20 - daysSince * 3);

  let tempoScore = 0;
  if (targetBPM && entry.currentBPM) {
    tempoScore = clamp(entry.currentBPM / targetBPM, 0, 1) * 25;
  }

  let score = repsScore + recencyScore + tempoScore;

  if (sessions.length) {
    const outcome = sessionOutcome(sessions[sessions.length - 1]);
    if (outcome === "fail") score *= 0.8;
    else if (outcome === "pass") score *= 1.15;
  }

  if (chunk.difficultyLabel === "hard") score *= 0.9;
  if (chunk.recurring) score *= 1.1;
  return Math.round(clamp(score, 0, 100));
}

// Rough/lost flags (Repertoire-Lifecycle.md's "Post-run-through logging")
// cap displayed confidence, on top of either the manual or auto score —
// including on top of a manual override, since a stale "I know better than
// the algorithm" override from before a chunk just went lost is exactly
// the "visible contradiction" the design explicitly rules out. Caps sit
// inside PieceMapTab's own tier boundaries (34/67) so a flagged chunk's
// grid color changes too, not just its number: 'lost' forces "Needs work",
// 'rough' forces at most "Developing".
const FLAG_CONFIDENCE_CAP = { rough: 55, lost: 20 };

// needsRelearning (Repertoire-Lifecycle.md's "The short structured
// re-learning pass") gets the same treatment, for the same reason: it
// reuses the `lost` demote-and-pin mechanism under the hood
// (lib/ladder.js's computeLadderAdvance fail branch), so a stale manual
// override showing high confidence while a chunk sits flagged for
// reinforcement would be exactly the same "visible contradiction" the
// rough/lost cap exists to prevent. Same cap value as 'lost' — it's the
// same underlying ladder state (forced to Stabilizing), just reached via a
// different route (two Stabilizing fails, not a manual run-through flag).
// Independent of `entry.flag`: a chunk could in principle carry both, and
// the lower of the two applicable caps should win either way.
const NEEDS_RELEARNING_CONFIDENCE_CAP = 20;

export function computeConfidence(chunk, piece, currentDay) {
  const entry = piece.progress[chunk.id] || {};
  const score =
    entry.manualConfidence !== undefined && entry.manualConfidence !== null
      ? clamp(Math.round(entry.manualConfidence), 0, 100)
      : computeAutoConfidence(chunk, piece, currentDay);
  const caps = [FLAG_CONFIDENCE_CAP[entry.flag], entry.needsRelearning ? NEEDS_RELEARNING_CONFIDENCE_CAP : undefined].filter(
    (c) => c !== undefined
  );
  return caps.length ? Math.min(score, ...caps) : score;
}

// What computeConfidence would have returned if evaluated on a past plan-day:
// only counts doneDays/sessions that existed by asOfDay, and runs recency
// decay relative to asOfDay instead of today. Used to measure improvement
// over a trailing window (e.g. "this week") rather than confidence's usual
// "right now" reading.
// Known limitation: manualConfidence has no recorded set-date, so if one is
// present it applies regardless of asOfDay rather than being excluded for
// cutoffs before it was actually set.
export function computeConfidenceAsOf(chunk, piece, asOfDay) {
  const entry = piece.progress[chunk.id] || {};
  const filteredEntry = {
    ...entry,
    doneDays: (entry.doneDays || []).filter((d) => d <= asOfDay),
    sessions: (entry.sessions || []).filter((s) => s.day <= asOfDay),
  };
  const asOfPiece = { ...piece, progress: { ...piece.progress, [chunk.id]: filteredEntry } };
  return computeConfidence(chunk, asOfPiece, asOfDay);
}

export const PROGRESS_TIER_META = {
  untouched: { label: "Not touched", color: "var(--ink-faint)" },
  learned: { label: "Learned", color: "var(--brick)" },
  comfortable: { label: "Comfortable", color: "var(--brass)" },
  mastered: { label: "Mastered", color: "var(--teal)" },
};

// Buckets a chunk by its rung on the spaced-repetition maintenance ladder
// (Repertoire-Lifecycle.md's "The ladder: three stages"), not a single
// last-session rep count — the ladder is what "how consolidated is this,
// really" now means, where a last-session snapshot was always a coarse
// proxy for it. A chunk demoted by a rough/lost flag (lib/ladder.js's
// applyRunThroughFlag writes `stage` directly) drops a tier here
// automatically, through the same mechanism as everywhere else — not a
// separate check. A chunk with real history from before the ladder
// existed migrates in with `stage: null` (can't tell "never touched" from
// "practiced a lot before this existed" from stage alone — same landmine
// already documented for Tier 1 review scheduling,
// Algorithms.md#timeline--scheduler); such a chunk reads as "learned"
// (the lowest touched tier) until it's logged again and picks up a real
// stage, rather than "untouched" or jumping straight to "mastered."
export function computeProgressTier(chunk, piece) {
  const entry = piece.progress[chunk.id] || {};
  const sessions = entry.sessions || [];
  if (sessions.length === 0) return "untouched";
  if (entry.stage === "holding") return "mastered";
  if (entry.stage === "settling") return "comfortable";
  // null (pre-ladder history, see comment above) and 'stabilizing' both
  // fall through to "learned" legitimately — anything else is a value
  // this function doesn't know about (a typo, hand-edited data, a future
  // stage this wasn't updated for) silently landing in the same bucket.
  // Warn instead of misclassifying without a trace.
  if (entry.stage != null && !STAGES.includes(entry.stage)) {
    console.warn(`computeProgressTier: chunk ${chunk.id} has unrecognized stage "${entry.stage}" — defaulting to "learned"`);
  }
  return "learned";
}

export function isManualConfidence(chunk, progress) {
  const entry = progress[chunk.id] || {};
  return entry.manualConfidence !== undefined && entry.manualConfidence !== null;
}

export function suggestMethods(chunk, confidence) {
  if (chunk.kind === "section-runthrough" || chunk.kind === "section-transition")
    return ["Full run-through without stopping", "Note where it still catches, fix it separately after"];
  if (chunk.kind === "transition") return ["Slow practice at the seam", "Backward chaining into it"];
  if (chunk.kind === "combo") return ["Start cold at the top of the block", "Slow practice", "Tempo ladder"];
  if (chunk.difficultyLabel === "hard" && confidence < 50)
    return ["Backward chaining", "Hands-separate practice", "Slow practice"];
  if (chunk.recurring) return ["Interleaving", "Retrieval practice"];
  if (confidence >= 70) return ["Tempo ladder", "Full run-throughs"];
  if (chunk.difficultyLabel === "hard") return ["Slow practice", "Deliberate repetitions"];
  return ["Deliberate repetitions", "Spaced repetition"];
}
