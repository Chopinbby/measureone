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
export const EFFECTIVENESS_OPTIONS = [
  { value: "low", label: "Needs more work" },
  { value: "good", label: "Good" },
  { value: "high", label: "Too easy" },
];

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
