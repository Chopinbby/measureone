import { clamp, rangesOverlap, daysBetweenInclusive, loggedSessions } from "./utils";
import { REQUIRED_REPS, STAGE_LABEL } from "./constants";
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

// The curve above was calibrated at targets >= 100 BPM (see table above)
// and isn't guaranteed to stay below target as target drops — below a
// difficulty-dependent threshold (~70 BPM for easy, ~50 for medium) `base`
// dominates and the raw curve output can equal or exceed target itself.
// This floor guarantees a suggestion is always at least this far under
// target, regardless of difficulty or how low target is.
const MIN_STARTING_TEMPO_BUFFER = 15;

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
  const raw = curve.base * Math.pow(targetBPM / 100, curve.k);
  return Math.round(Math.min(raw, targetBPM - MIN_STARTING_TEMPO_BUFFER));
}

// Chunk kinds representing a continuity run-through — a whole section, or
// two combined sections, played straight through — rather than a normal
// practice rep. See resolveRequiredReps below. Deliberately excludes plain
// "transition" (an ordinary two-chunk seam) and "combo" (a focus block) —
// only the two run-through kinds get the flat override.
const RUN_THROUGH_KINDS = ["section-runthrough", "section-transition"];
const RUN_THROUGH_REQUIRED_REPS = 2;

// How many clean reps `chunk` actually needs to count as a full pass —
// single source of truth for ChecklistItem's requirement display, its
// input field's label, AND its classifySessionOutcome call (Pass 15's
// comment on `requiredReps` there), so what the learner reads before
// logging always matches what's actually judged against.
//
// Run-through kinds (RUN_THROUGH_KINDS above) use a flat,
// difficulty-independent count instead of REQUIRED_REPS[difficultyLabel] —
// Pass 27. The point of a run-through is continuity over a much longer
// span, not the same rep count a single chunk needs; its difficultyLabel is
// a weighted average across that whole span (computeSectionRunThroughs,
// lib/chunking.js), so gating it through the normal table would ask for
// MORE reps on a longer, harder-averaging run-through — backwards for a
// drill that's already a bigger ask by virtue of its length alone. Reps
// only, per this pass's scope — the tempo side (practiceBPM/clearsTempo,
// below) is unchanged for these chunks.
//
// The whole-piece "__consolidation__" run-through (the plan's final "Full
// run-through" day) never reaches this at all: handleLogRunThrough
// (App.jsx) logs a stopCount against a synthetic progress key, never
// cleanReps, and never calls classifySessionOutcome — confirmed by reading
// the code, not assumed, since there's no requiredReps to resolve there in
// the first place, and no chunk object either (it isn't a real chunk).
export function resolveRequiredReps(chunk) {
  return RUN_THROUGH_KINDS.includes(chunk.kind) ? RUN_THROUGH_REQUIRED_REPS : REQUIRED_REPS[chunk.difficultyLabel] || 4;
}

// Classifies one logged attempt into the three-tier outcome model
// (Repertoire-Lifecycle.md's "Session outcomes: three tiers, not two"):
// - full pass: required clean reps hit, at/above the tempo currently asked
//   for (practiceBPM). manualFail always wins regardless.
// - real fail: zero clean reps (a genuine miss, not "some but not enough"),
//   OR a manual "needs more work" override (self-report escape hatch — the
//   folded-in replacement for the old separate "how did it feel" input,
//   catching what the numbers alone can't: memory slips, poor technique
//   despite clean reps), OR a repeat soft-miss right after a previous
//   soft-miss, but ONLY when both shortfalls were reps-driven (see below).
// - soft-miss: some clean reps, just not enough (or not at the asked
//   tempo) to count as a full pass — the default middle case.
//
// A soft-miss caused purely by tempo (required reps hit, just under
// practiceBPM) never escalates to "fail," in either session of the pair —
// practiceBPM already steps down on its own after a tempo-only soft-miss,
// so a learner who keeps meeting required reps hasn't regressed on the
// thing that actually matters, no matter how many times in a row they log
// a hair under an already-adjusting target. Escalation is reserved for a
// genuine reps shortfall, twice in a row. Fixes a false-fail case found
// while building this rule — see
// docs/Decisions.md#spaced-repetition--maintenance (Pass 14).
// `practiceBPM` may be null (chunk not yet seeded onto the ladder); a null
// floor is treated as already cleared, same convention as lib/ladder.js.
export function classifySessionOutcome({
  cleanReps,
  bpm,
  requiredReps,
  practiceBPM,
  manualFail,
  previousOutcome,
  previousCleanReps,
}) {
  if (manualFail) return "fail";
  if (!cleanReps || cleanReps <= 0) return "fail";
  const clearsTempo = practiceBPM == null || bpm >= practiceBPM;
  if (cleanReps >= requiredReps && clearsTempo) return "pass";
  const thisIsRepsShortfall = cleanReps < requiredReps;
  const previousWasRepsShortfall = previousCleanReps != null && previousCleanReps < requiredReps;
  if (thisIsRepsShortfall && previousOutcome === "soft-miss" && previousWasRepsShortfall) return "fail";
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

// Every logged, judged session across the whole piece — the denominator
// Progress's Outcome Breakdown panel needs. loggedSessions() alone isn't
// enough: it drops skipped/provisional sessions, but a "__consolidation__"
// or "__cold_start__" session is neither of those — it's a synthetic,
// non-chunk progress entry with no outcome/effectiveness at all (a
// stopCount or an avgBpm instead), so sessionOutcome() returns null for
// it. Left in, it would inflate the denominator without ever landing in
// any pass/soft-miss/fail bucket, silently pulling every real percentage
// down — the same dilution bug already fixed once for skipped sessions
// (see docs/Decisions.md#spaced-repetition--maintenance), reappearing via
// a session shape that fix didn't anticipate. Found in review, not by the
// original Cold-Start pass. See docs/Decisions.md#cold-start-check.
export function allJudgedSessions(piece) {
  return Object.values((piece && piece.progress) || {})
    .flatMap((entry) => loggedSessions(entry.sessions))
    .filter((s) => sessionOutcome(s) !== null);
}

// Tuning knobs for hasClimbingTempo below — hand-picked, not derived from
// any study, same status as every other constant of this kind in this file
// (see docs/Research.md's inventory of these; this one isn't added there
// yet — Research.md wasn't in this pass's Touches list, flagged rather than
// folded in, see the pass summary).
//   WINDOW: how many of the chunk's most recent judged sessions to look at.
//   MIN_SESSIONS: fewer than this can't show a trend at all — two points
//     can't be told apart from noise the way three-plus in a row can.
//   MIN_RISE_BPM: the window must climb by at least this many BPM
//     end-to-end, so a flat run (which is non-decreasing but not "rising")
//     doesn't trigger — see the non-decreasing-but-flat guard below.
const CLIMBING_TEMPO_WINDOW = 4;
const CLIMBING_TEMPO_MIN_SESSIONS = 3;
const CLIMBING_TEMPO_MIN_RISE_BPM = 4;

// True when a chunk's most recent judged sessions show a monotonic-ish
// upward BPM trend — a live-derived signal (no new persisted field, same
// pattern `progress[id].flag`/`needsRelearning` already use for the Piece
// Map's tile markers), so it appears exactly while the trend holds and
// disappears the moment it doesn't, without needing separate "seen" state.
//
// Reads straight off `entry` (piece.progress[chunk.id]), not chunk/piece —
// same shape formatLadderStatus takes, since this only ever needs session
// history, never the chunk's own fields. Only `loggedSessions(entry.sessions)`
// counts: a skipped session (Pass 29) has no bpm at all, and a still-open
// provisional one (Pass 29 follow-up) hasn't been judged yet — neither
// should count as evidence of a real, resolved climb.
//
// "Monotonic-ish" rather than strictly monotonic: any real dip (a BPM
// lower than the one right before it) breaks the trend outright — this
// isn't trying to smooth out noise, just to avoid demanding a perfectly
// unbroken climb when a same-BPM repeat in the middle of an otherwise
// rising run is still obviously "climbing." A flat run (every session at
// the same BPM) is non-decreasing but isn't a climb — MIN_RISE_BPM below
// is what actually distinguishes the two.
export function hasClimbingTempo(entry) {
  if (!entry) return false;
  const bpmSessions = loggedSessions(entry.sessions).filter((s) => typeof s.bpm === "number");
  if (bpmSessions.length < CLIMBING_TEMPO_MIN_SESSIONS) return false;
  const recent = bpmSessions.slice(-CLIMBING_TEMPO_WINDOW);
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].bpm < recent[i - 1].bpm) return false;
  }
  return recent[recent.length - 1].bpm - recent[0].bpm >= CLIMBING_TEMPO_MIN_RISE_BPM;
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

  // Pass 27 follow-up: was its own separate REQUIRED_REPS[difficultyLabel]
  // lookup, which disagreed with the pass/fail judgment for run-through
  // kinds once those got a flat 2-rep requirement (resolveRequiredReps
  // above) — a run-through logged with 2 clean reps at full tempo was
  // classified a "Full pass" but still scored confidence as if 2 reps out
  // of 5 were needed. Confirmed with the user rather than left silently
  // divergent: this now reads the same resolved value classifySessionOutcome
  // judges against, so a run-through that passes also scores as fully done.
  const requiredReps = resolveRequiredReps(chunk);
  const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, chunk);
  // A skipped session (Interleaved mode, Pass 29) has no reps/BPM/outcome
  // to score and was deliberately never "logged" in the judged sense — see
  // lib/utils.js's loggedSessions. Without this, a skip as the most recent
  // session would null out sessionOutcome() below (no outcome/effectiveness
  // field), silently dropping the pass/fail multiplier a real last session
  // would have applied.
  const sessions = loggedSessions(entry.sessions);

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
    sessions: loggedSessions(entry.sessions).filter((s) => s.day <= asOfDay),
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
  const sessions = loggedSessions(entry.sessions);
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

// Plain-language summary of a chunk's position on the spaced-repetition
// maintenance ladder (lib/ladder.js) — Pass 15, the first UI surface for
// stage/consecutivePasses/nextDueDate (previously computed and persisted on
// every logged session but never displayed anywhere, per lib/ladder.js's own
// header comment). One shared function so PieceMapTab's chunk-detail modal
// and ChecklistItem's tip line can't drift on the graduation math or the
// due-date phrasing. Returns null only when the chunk has no session history
// at all — callers read that as truly "not started." A chunk with real
// history but no recorded stage (see hasHistory below) still gets a status,
// not null.
//
// `asOfDate` is an explicit "YYYY-MM-DD" param rather than an internal
// todayISODate() call — this file already threads currentDay/asOfDay through
// explicitly everywhere else (computeConfidenceAsOf above), same reason
// computeDueReviews (lib/maintenance.js) takes asOfDate rather than reading
// the clock itself.
//
// Found in review: a chunk practiced before the ladder feature existed has
// real sessions but `stage: null` (backfillProgressLadderState, storage.js,
// leaves it null rather than guessing at unrecoverable history) — the
// original version of this function read that as "never touched" and showed
// "Not started" right beside a nonzero "Sessions logged" count. Fixed by
// checking session history, same signal computeProgressTier above already
// uses to tell the two cases apart, and falling back to "stabilizing" for
// display — the exact default computeLadderAdvance/applyRunThroughFlag
// (lib/ladder.js) already use for this same shape the moment a new session
// gets logged, so this reads as "about to start," not a guess at history
// that can't be reconstructed.
//
// needsRelearning gets special handling: its nextDueDate is still a real
// stored date (pinned to the day the flag turned on), but Algorithms.md/
// Data-Model.md are explicit that this value is "never actually surfaced
// anywhere while the flag is set" — computeDueReviews and computeTimeline
// both skip the chunk outright regardless of what it holds. Showing the raw
// date here would read as "overdue," which is wrong: review isn't late,
// it's paused. dueLabel reports that instead of the date. stageLabel/
// progressLabel are unaffected — consecutivePasses is genuinely 0/graduationPasses
// while flagged (any fail resets it), so showing it is accurate, not a leak.
export function formatLadderStatus(entry, ladderConfig, asOfDate) {
  if (!entry) return null;
  const hasHistory = loggedSessions(entry.sessions).length > 0;
  if (!STAGES.includes(entry.stage) && !hasHistory) return null;
  const stage = STAGES.includes(entry.stage) ? entry.stage : "stabilizing";
  const consecutivePasses = entry.consecutivePasses || 0;
  const nextStage = STAGES[STAGES.indexOf(stage) + 1] || null;
  const graduationPasses = ladderConfig && ladderConfig[stage] ? ladderConfig[stage].graduationPasses : null;

  // Holding has no next stage (STAGES' ceiling) and no graduationPasses in
  // DEFAULT_LADDER_CONFIG — "N consecutive passes" instead of a fraction
  // that would divide by nothing to progress toward.
  const progressLabel =
    nextStage && graduationPasses != null
      ? `${consecutivePasses}/${graduationPasses} to ${STAGE_LABEL[nextStage]}`
      : `${consecutivePasses} consecutive pass${consecutivePasses === 1 ? "" : "es"}`;

  let dueLabel = null;
  if (entry.needsRelearning) {
    dueLabel = "paused — needs reinforcement";
  } else if (entry.nextDueDate) {
    // Same daysOverdue direction/off-by-one as computeDueReviews
    // (lib/maintenance.js), reused rather than reinvented so "N days" means
    // the same thing in both places.
    const daysOverdue = daysBetweenInclusive(entry.nextDueDate, asOfDate) - 1;
    const dateLabel = new Date(`${entry.nextDueDate}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    if (daysOverdue > 0) dueLabel = `was due ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago (${dateLabel})`;
    else if (daysOverdue === 0) dueLabel = `due today (${dateLabel})`;
    else dueLabel = `in ${-daysOverdue} day${daysOverdue === -1 ? "" : "s"} (${dateLabel})`;
  }

  return { stageLabel: STAGE_LABEL[stage], progressLabel, dueLabel };
}

export function isManualConfidence(chunk, progress) {
  const entry = progress[chunk.id] || {};
  return entry.manualConfidence !== undefined && entry.manualConfidence !== null;
}
