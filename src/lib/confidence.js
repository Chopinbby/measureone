import { clamp, rangesOverlap } from "./utils";
import { REQUIRED_REPS } from "./constants";

// A measure-range tempo target set in Settings (or the whole-piece default)
// applies to any chunk whose measures fall in that zone, unless the chunk has
// its own explicit target set from the Piece Map.
export function getDefaultTargetBPM(piece, chunk) {
  const zone = (piece.bpmZones || []).find((z) => rangesOverlap(chunk.start, chunk.end, z.start, z.end));
  if (zone) return zone.bpm;
  return piece.targetBPM || null;
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
    const last = sessions[sessions.length - 1];
    if (last.effectiveness === "low") score *= 0.8;
    else if (last.effectiveness === "high") score *= 1.15;
  }

  if (chunk.difficultyLabel === "hard") score *= 0.9;
  if (chunk.recurring) score *= 1.1;
  return Math.round(clamp(score, 0, 100));
}

export function computeConfidence(chunk, piece, currentDay) {
  const entry = piece.progress[chunk.id] || {};
  if (entry.manualConfidence !== undefined && entry.manualConfidence !== null) {
    return clamp(Math.round(entry.manualConfidence), 0, 100);
  }
  return computeAutoConfidence(chunk, piece, currentDay);
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

// Buckets a chunk by its most recently logged clean-rep count, not a peak
// ever achieved — same "what's true right now" convention as currentBPM.
export function computeProgressTier(chunk, piece) {
  const sessions = (piece.progress[chunk.id] || {}).sessions || [];
  if (sessions.length === 0) return "untouched";
  const lastReps = sessions[sessions.length - 1].cleanReps || 0;
  if (lastReps >= 10) return "mastered";
  if (lastReps >= 5) return "comfortable";
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
