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

export function computeConfidence(chunk, piece, currentDay) {
  const entry = piece.progress[chunk.id] || {};
  const score =
    entry.manualConfidence !== undefined && entry.manualConfidence !== null
      ? clamp(Math.round(entry.manualConfidence), 0, 100)
      : computeAutoConfidence(chunk, piece, currentDay);
  const cap = FLAG_CONFIDENCE_CAP[entry.flag];
  return cap !== undefined ? Math.min(score, cap) : score;
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
