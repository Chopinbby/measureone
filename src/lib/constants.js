/* ------------------------------------------------------------------ */
/*  Shared constants — single source of truth so values like          */
/*  EFFORT_TO_MIN or REQUIRED_REPS can't drift between the module that */
/*  computes with them and the components that display them.          */
/* ------------------------------------------------------------------ */

export const PIECE_KEY_PREFIX = "measureone-piece:";
export const ACTIVE_KEY = "measureone-active_piece_id";

// Hand-picked, not derived from a study — see docs/Research.md.
export const EFFORT_TO_MIN = 2.5; // minutes of practice per "effort point"
export const REVIEW_OFFSETS = [1, 3, 7, 14];
export const LIBERAL_FACTOR = 1.2; // pad schedule estimates rather than assume perfect efficiency

export const MIN_PRACTICE_DAYS_PER_WEEK = 3;
export const MAX_PRACTICE_DAYS_PER_WEEK = 7;
export const MAX_RECOMMENDED_MINUTES_PER_DAY = 120; // warn in the wizard past this pace

export const DIFFICULTY_META = {
  easy: { label: "Easy", color: "var(--teal)" },
  medium: { label: "Medium", color: "var(--brass)" },
  hard: { label: "Hard", color: "var(--brick)" },
};
export const LEVEL_LABEL = { 1: "easy", 2: "medium", 3: "hard" };
export const REQUIRED_REPS = { easy: 3, medium: 4, hard: 5 };
export const ROLE_LABEL = {
  new: "New",
  review: "Review",
  transition: "Review",
  combo: "Focus block",
  "section-runthrough": "Section run-through",
  "section-transition": "Sections combined",
};
// Replaces the old free-standing "how did it feel" 3-tap input
// (EFFECTIVENESS_OPTIONS) — folded into the pass/soft-miss/fail judgment
// itself per Decisions.md#spaced-repetition--maintenance. Labels/colors for
// `session.outcome` (lib/confidence.js's classifySessionOutcome), reused by
// both the logging UI (ChecklistItem) and Progress's outcome breakdown.
//
// The internal values stay "soft-miss"/"fail" (matched throughout
// confidence.js/ladder.js/scheduling.js) — only the DISPLAY labels changed
// (Pass 26, confirmed with the user; see
// docs/Decisions.md#spaced-repetition--maintenance):
// - "soft-miss" -> "Partial pass". Chosen over "Not yet" and "Close, not
//   yet" for reading as a plain, literal statement of what happened rather
//   than an editorialized one.
// - "fail" -> "Needs rework" (was "Real fail"). "Real fail" only named the
//   tempo pullback a learner would notice, not that it also demotes the
//   chunk a stage on the maintenance ladder (never below Stabilizing) and,
//   on a second consecutive fail while already in Stabilizing, resets
//   practiceBPM outright (needsRelearning) — "Needs rework" doesn't spell
//   that mechanism out either, but was confirmed acceptable: seeing the
//   chunk again soon isn't a surprise once it's read as needing rework.
export const SESSION_OUTCOME_META = {
  pass: { label: "Full pass", color: "var(--teal)" },
  "soft-miss": { label: "Partial pass", color: "var(--brass)" },
  fail: { label: "Needs rework", color: "var(--brick)" },
};

// Labels for piece.status values other than the default "active" — active
// pieces show no badge at all, so there's nothing to look up for them.
export const PIECE_STATUS_LABEL = {
  paused: "Paused",
  archived: "Archived",
};

// Display labels for progress[id].stage (lib/ladder.js's STAGES) — Pass 15,
// the first place Settling/Holding are shown to a learner at all (grep
// confirmed neither appeared anywhere before this). Plain capitalized stage
// names, NOT run through the same plain-language translation the Pass 26
// follow-up gave "Stabilizing" ("the Introductory phase") — that rename was
// scoped to one leaked mid-sentence hint ("...rebuilds consistency in
// Stabilizing"), not a general ban on the stage names themselves, and here
// they're shown as short labeled stats ("Stage: Settling"), not prose. Left
// as-is rather than guessed at a matching plain-language set for all three —
// flagged for the user to confirm, same as every other display-label
// decision in this codebase.
export const STAGE_LABEL = {
  stabilizing: "Stabilizing",
  settling: "Settling",
  holding: "Holding",
};

export const REVIVAL_PURPOSE_OPTIONS = [
  { value: "performance", label: "Performance" },
  { value: "lesson", label: "Lesson" },
  { value: "enjoyment", label: "Enjoyment" },
  { value: "checking", label: "Just checking" },
];
// Fast-tap presets over the existing 0-100 manualConfidence override — there's
// no separate persisted 0-4 scale; this just exposes the same field through a
// quicker few-taps interface for the revival reassessment pass. See
// docs/Decisions.md#revival.
export const CONFIDENCE_PRESETS = [
  { value: 0, label: "Shaky" },
  { value: 25, label: "Rough" },
  { value: 50, label: "OK" },
  { value: 75, label: "Solid" },
  { value: 100, label: "Rock solid" },
];
