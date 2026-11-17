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
/*                                                                     */
/*  stabilizingEntryBPM/settlingEntryBPM/holdingEntryBPM (Pass 26         */
/*  follow-up) persist the practiceBPM a chunk had the moment it most     */
/*  recently, freshly entered each stage. A real fail resets practiceBPM  */
/*  to the recorded entry tempo for the stage it demotes INTO, replacing  */
/*  the flat bpmSteps.fail step for any chunk that has one recorded —     */
/*  three flat scalar fields, not one nested object, so storage.js's      */
/*  ladderStateDiffers/mergeProgress can compare each by `!==` like every */
/*  other ladder field, rather than needing deep-equality handling for an */
/*  object. Reused by the caller the same way targetBPM/suggestedStartingBPM */
/*  are — chunkLadderState in, and the (possibly updated) value back out. */
/*  See Decisions.md#spaced-repetition--maintenance.                      */
/*                                                                     */
/*  holdingReviewCount (Pass 61) replaces Holding's old escalating tempo  */
/*  floor (ladderConfig.holding.tempoFloor*, now unread — Holding's       */
/*  clearsStageFloor branch always returns true) with a periodic rep-only */
/*  harder check instead: every 4th logged Holding review needs one more  */
/*  clean rep than usual (resolveRequiredReps, lib/confidence.js). Resets */
/*  to 0 the moment a chunk freshly enters Holding, same convention the   */
/*  entryBPM fields above use. See Decisions.md#spaced-repetition--maintenance. */
/*                                                                     */
/*  simulateTempoConvergence (Pass 62) is the one function in this file   */
/*  that doesn't advance real state — it forward-projects a chunk's own   */
/*  current ladder card through computeLadderAdvance under an all-"pass"  */
/*  assumption, to estimate how many calendar days away its tempo goal    */
/*  actually is. A pure, live-recomputed derivation (no persisted "warned"*/
/*  flag), surfaced in PieceMapTab's chunk-detail modal. See              */
/*  Decisions.md#spaced-repetition--maintenance.                          */
/* ------------------------------------------------------------------ */

import { daysBetweenInclusive } from "./utils";

export const STAGES = ["stabilizing", "settling", "holding"];

// Interleaved practice mode (Pass 29, TodayTab) only rotates in chunks that
// have actually left Stabilizing — a chunk still building its first
// consecutive-pass streak (including one that hasn't cleared Tier 1 at
// all, i.e. stage null/undefined) isn't solid enough yet to be quizzed
// cold in rotation with others. A simple per-chunk lookup against
// `piece.progress[id]`, not new state — kept here alongside STAGES since
// it's the same stage ordering this eligibility rule is defined against.
export function isInterleaveEligible(entry) {
  const stage = entry && entry.stage;
  return stage === "settling" || stage === "holding";
}

// Pass 138 (every piece, model 1 or 2): the timer alert's words. The alert
// itself fires when a card's running timer reaches its planned time, held to
// at least 5 minutes (timerAlertMinutes, lib/scheduling.js; the planned time
// is the same price the plan and Pass 137's "planned about N min" use), so
// there is no table of limits here: the owner changed it from fixed
// 20/15/15/10 minute limits to the card's own planned time on 2026-11-16,
// then asked for the 5 minute floor and for these words (the number is the
// time on the timer, not the plan). Text only: nothing about it changes how a
// session counts, and a review that runs past it still counts toward moving up.
//
// The "mark the exact spot" half and its button are only offered where a
// focus spot can actually be added (the piece has focus spots turned on and
// the card is a base chunk), so the alert never points at something that
// isn't there. `noun` is "chunk" for a base chunk, "task" for a review or
// focus block card.
export function timerAlertMessage(minutes, { canAddFocusSpot = false, noun = "chunk" } = {}) {
  const advice = canAddFocusSpot ? "try a slower tempo, or mark the exact spot that's going wrong." : "try a slower tempo.";
  return `You've been on this ${noun} for ${minutes} minute${minutes === 1 ? "" : "s"}. If clean reps aren't coming, ${advice}`;
}

// Stage 3's "learned" rollup
// (Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented) —
// decided long before this existed as a real function: a piece is
// "learned" once every practice chunk's ladder card has reached Holding.
// Pass 39 implements it as this one function rather than leaving every
// caller to write its own inline check, since it's now load-bearing for
// scheduling behavior (isPlanActuallyComplete, lib/scheduling.js), not
// just a future display label.
//
// Deliberately chunkSet.practiceChunks only, not chunkSet.all — Stage 3's
// definition has always been stated in terms of the piece's practice
// chunks specifically; transitions/combos ride the same ladder mechanics
// but were never part of what "learned" means here.
export function isPieceLearned(piece, chunkSet) {
  const practiceChunks = (chunkSet && chunkSet.practiceChunks) || [];
  if (!practiceChunks.length) return false;
  return practiceChunks.every((c) => (((piece && piece.progress) || {})[c.id] || {}).stage === "holding");
}

/* ------------------------------------------------------------------ */
/*  Review model v2: the pass table and pass credit (Pass 139)         */
/*  docs/Algorithms.md#review-model-v2-planned, rules 1 and 2.         */
/* ------------------------------------------------------------------ */

// Rule 1: how many passes a base practice chunk needs to leave Stabilizing,
// and again to leave Settling (the same count for both), by the chunk's
// difficulty and the plan's length. The owner's table, 2026-11-16; the
// boundaries are 30, 60 and 90 calendar days with each upper bound included,
// so a plan of exactly 30 days reads the first row. Only a piece on
// `reviewModel` 2 reads it (ladderContextFor, lib/scheduling.js builds the
// context computeLadderAdvance takes); a piece on today's plan keeps
// `ladderConfig.stabilizing/settling.graduationPasses`.
export const PASS_TABLE_ROWS = [
  { upToDays: 30, easy: 1, medium: 2, hard: 3 },
  { upToDays: 60, easy: 2, medium: 3, hard: 3 },
  { upToDays: 90, easy: 3, medium: 4, hard: 4 },
  { upToDays: null, easy: 3, medium: 4, hard: 5 },
];

// The row's plan length, as the Settings table labels it ("the plan length it follows").
export const PASS_TABLE_ROW_LABELS = ["up to 30 days", "over 30 up to 60 days", "over 60 up to 90 days", "over 90 days"];

// The two stages the table covers (Holding has no stage above it to move up to).
export const PASS_TABLE_STAGES = ["stabilizing", "settling"];
// `easy`/`medium`/`hard` are the stored names; the screen says Workable,
// Challenging and Difficult (DIFFICULTY_META, constants.js).
export const PASS_TABLE_DIFFICULTIES = ["easy", "medium", "hard"];

// Rule 2: a Full pass at or above this share of the chunk's target tempo
// counts as two passes (the owner confirmed it 2026-11-15). Deliberately its
// own constant: the tempo-maintenance threshold
// (`ladderConfig.tempoRatchet.tempoAchievedThreshold`) is a different
// question that happens to share the number 0.85 today.
export const STRONG_PASS_FRACTION = 0.85;

// What a join (a transition) adds to each chunk it covers when it is a Full
// pass (rule 4). Nothing in the app calls addHalfPass yet; Pass 141 does.
export const HALF_PASS_CREDIT = 0.5;

// Rule 6: the longest a Holding review may wait, for every plan length. It
// governs nothing until Pass 140 builds the review windows; the Settings
// editor already lets the owner change it (`ladderConfig.overrides`).
export const HOLDING_MAX_DAYS_V2 = 30;

// Which row of the table a plan reads. A plan set by minutes per day uses the
// last row (the owner's word, "assume the longest plan length"); so does a
// plan whose length can't be read.
export function passTableRowIndex(daysToLearn, scheduleMode) {
  if (scheduleMode === "minutes") return PASS_TABLE_ROWS.length - 1;
  const days = Number(daysToLearn);
  if (!Number.isFinite(days) || days <= 0) return PASS_TABLE_ROWS.length - 1;
  const idx = PASS_TABLE_ROWS.findIndex((row) => row.upToDays != null && days <= row.upToDays);
  return idx === -1 ? PASS_TABLE_ROWS.length - 1 : idx;
}

// A difficulty the table doesn't know (a chunk with no label) reads the middle
// column, the same fall-back direction as REQUIRED_REPS' "|| 4".
function passTableDifficulty(difficultyLabel) {
  return PASS_TABLE_DIFFICULTIES.includes(difficultyLabel) ? difficultyLabel : "medium";
}

// The table's own number, before any override.
export function autoPassesNeeded(difficultyLabel, daysToLearn, scheduleMode) {
  return PASS_TABLE_ROWS[passTableRowIndex(daysToLearn, scheduleMode)][passTableDifficulty(difficultyLabel)];
}

// The owner's own number for one cell of the table, or null when the cell
// follows the plan. `ladderConfig.overrides.passesNeeded` is absent on every
// piece until she changes a cell, and holds only the cells she changed:
// `{ stabilizing: { hard: 4 } }`. A value that isn't a whole number of at
// least 1 is ignored (a hand-edited backup must not stop a chunk moving up).
export function passesOverrideFor(ladderConfig, stage, difficultyLabel) {
  const table = ladderConfig && ladderConfig.overrides && ladderConfig.overrides.passesNeeded;
  const v = table && table[stage] ? table[stage][passTableDifficulty(difficultyLabel)] : null;
  return Number.isInteger(v) && v >= 1 ? v : null;
}

// Passes needed to leave `stage` for a chunk of this difficulty on a plan of
// this length: the owner's override for that cell, else the table. null for
// Holding (nothing above it to move up to).
export function resolvePassesNeeded({ stage, difficultyLabel, daysToLearn, scheduleMode }, ladderConfig) {
  if (!PASS_TABLE_STAGES.includes(stage)) return null;
  const override = passesOverrideFor(ladderConfig, stage, difficultyLabel);
  return override != null ? override : autoPassesNeeded(difficultyLabel, daysToLearn, scheduleMode);
}

// The longest Holding review may wait on the new plan: the owner's number
// (`ladderConfig.overrides.holdingMaxDays`) or 30 days.
export function effectiveHoldingMaxDaysV2(ladderConfig) {
  const v = ladderConfig && ladderConfig.overrides && ladderConfig.overrides.holdingMaxDays;
  return Number.isInteger(v) && v >= 1 ? v : HOLDING_MAX_DAYS_V2;
}

// The plan length a piece's table row follows, in words for the Settings
// editor ("labelled with the plan length it follows").
export function passTableRowLabelFor(daysToLearn, scheduleMode) {
  if (scheduleMode === "minutes") return "a plan set by minutes per day (it reads the longest row, " + PASS_TABLE_ROW_LABELS[PASS_TABLE_ROWS.length - 1] + ")";
  return PASS_TABLE_ROW_LABELS[passTableRowIndex(daysToLearn, scheduleMode)];
}

// --- Editing the owner's numbers (Settings' ladder editor) ---------------
// `ladderConfig.overrides` is absent until she changes a number and absent
// again once nothing is changed, so a piece she has reset is byte-for-byte
// the piece she had before (a stored empty object would change its
// fingerprint and upload it again). Each helper returns a new config.

function withOverrides(ladderConfig, overrides) {
  const { overrides: _dropped, ...rest } = ladderConfig;
  const clean = { ...overrides };
  if (clean.passesNeeded) {
    const cells = {};
    for (const stage of Object.keys(clean.passesNeeded)) {
      const row = clean.passesNeeded[stage];
      if (row && Object.keys(row).length) cells[stage] = row;
    }
    if (Object.keys(cells).length) clean.passesNeeded = cells;
    else delete clean.passesNeeded;
  }
  if (clean.holdingMaxDays == null) delete clean.holdingMaxDays;
  return Object.keys(clean).length ? { ...rest, overrides: clean } : rest;
}

// Set one cell of the table. A number equal to what the table gives is not an
// override (it follows the plan again), so typing the automatic value back in
// clears the cell, and the screen's "set by you" marker goes with it.
export function withPassesOverride(ladderConfig, stage, difficultyLabel, value, autoValue) {
  const key = passTableDifficulty(difficultyLabel);
  const current = (ladderConfig.overrides && ladderConfig.overrides.passesNeeded) || {};
  const row = { ...(current[stage] || {}) };
  const whole = Math.max(1, Math.round(Number(value)));
  if (!Number.isFinite(whole) || whole === autoValue) delete row[key];
  else row[key] = whole;
  return withOverrides(ladderConfig, { ...(ladderConfig.overrides || {}), passesNeeded: { ...current, [stage]: row } });
}

// "Reset to automatic" for the whole table.
export function withPassesOverridesCleared(ladderConfig) {
  const { passesNeeded: _dropped, ...others } = ladderConfig.overrides || {};
  return withOverrides(ladderConfig, others);
}

// Any cell of the table changed by the owner?
export function hasPassesOverride(ladderConfig) {
  const table = ladderConfig && ladderConfig.overrides && ladderConfig.overrides.passesNeeded;
  return !!table && PASS_TABLE_STAGES.some((stage) => PASS_TABLE_DIFFICULTIES.some((d) => passesOverrideFor(ladderConfig, stage, d) != null));
}

// The Holding maximum on the new plan: a whole number of days, or null to
// follow the automatic 30.
export function withHoldingMaxOverride(ladderConfig, days) {
  const whole = days == null ? null : Math.max(1, Math.round(Number(days)));
  return withOverrides(ladderConfig, { ...(ladderConfig.overrides || {}), holdingMaxDays: Number.isFinite(whole) ? whole : null });
}

// A Full pass played at 85% or more of the chunk's target tempo. `bpm` is the
// tempo logged for the session; a chunk with no target tempo has nothing to
// be close to, so it never earns one.
export function isStrongPass(result, bpm, targetBPM) {
  if (result !== "pass" || bpm == null || targetBPM == null || !(targetBPM > 0)) return false;
  return bpm >= targetBPM * STRONG_PASS_FRACTION;
}

// Rule 4's half credit: a join that was a Full pass adds half a pass to each
// chunk it covers. It only ever adds to the count; the stage is left alone
// (a chunk moves up only inside computeLadderAdvance, on its own turn), and
// a chunk outside Stabilizing and Settling is returned as it was. The count
// can therefore be fractional.
export function addHalfPass(chunkLadderState, credit = HALF_PASS_CREDIT) {
  if (!chunkLadderState || !PASS_TABLE_STAGES.includes(chunkLadderState.stage)) return chunkLadderState;
  return { ...chunkLadderState, consecutivePasses: (chunkLadderState.consecutivePasses || 0) + credit };
}

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

// Gap-proportional step size for the tempo ratchet (Pass 59) — replaces
// the flat bpmSteps.pass/softMiss deltas on the pass/soft-miss branches
// below with a step scaled to how far practiceBPM still has to go, at the
// chunk's own persisted rate (tempoRatchetK) and capped by
// ladderConfig.tempoRatchet.kCapBpm. The 1bpm floor keeps a chunk that's
// already at or past targetBPM (gap <= 0) still nudging forward by a
// token amount rather than stalling outright. Returns null when there's
// no targetBPM (or no practiceBPM yet) to be proportional against, so
// callers fall back to the flat ladderConfig.bpmSteps step instead of
// inventing a gap-based number from nothing — the fail branch keeps using
// that flat step unconditionally and is untouched by this helper.
function tempoRatchetStepSize(practiceBPM, targetBPM, k, kCapBpm) {
  if (practiceBPM == null || targetBPM == null) return null;
  const gap = targetBPM - practiceBPM;
  return Math.min(kCapBpm, Math.max(1, Math.round(k * gap)));
}

// Pass 60 — "tempo maintenance mode": once practiceBPM is already close
// enough to targetBPM, the tempo ratchet doesn't need to keep chasing the
// remaining gap at the chunk's own (possibly still-large) adaptive rate —
// a small, pinned rate (ladderConfig.tempoRatchet.maintenanceK) is enough
// to keep nudging forward without the risk of an oversized step near the
// top. Computed live wherever needed, never persisted: naturally exits the
// moment practiceBPM drops back below the threshold (e.g. a fail's
// entry-BPM reset), so there's no explicit "exit maintenance mode" code
// path and nothing that can flap or go stale. Unrelated to ladder `stage`
// (Stabilizing/Settling/Holding) or its demotion-on-fail — demote() below
// is untouched; this is a tempo-stepping-rate concept only, and a chunk
// can be in maintenance mode at any stage.
export function isInTempoMaintenance(practiceBPM, targetBPM, ladderConfig) {
  return practiceBPM != null && targetBPM != null && practiceBPM >= targetBPM * ladderConfig.tempoRatchet.tempoAchievedThreshold;
}

// Absolute BPM a chunk's practiceBPM must be at/above for a full pass to
// count toward stage graduation ("the floor gates practiceBPM, not the
// per-session pass/fail itself" — doc). Stabilizing has no floor. Settling
// uses a flat fraction of targetBPM.
//
// Pass 61 — Holding's escalating tempo floor (which used to gate here on
// `tempoFloorStartFraction`/`tempoFloorStepFraction`/`tempoFloorCapFraction`,
// growing with `consecutivePasses`) is retired: a Holding pass now counts
// toward interval growth as soon as it meets the rep requirement, full
// stop — the rep side alone (including the new periodic harder check,
// resolveRequiredReps in lib/confidence.js) is sufficient on its own.
// Stabilizing/Settling below are completely unchanged. The three
// now-unread `ladderConfig.holding.tempoFloor*` fields themselves were
// left in the schema for a while after this, then removed outright in a
// later session, on direct request — see docs/Decisions.md#open-questions.
function clearsStageFloor(stage, practiceBPM, targetBPM, ladderConfig) {
  if (stage === "holding") return true;
  if (targetBPM == null) return true;
  const floorFraction = stage === "stabilizing" ? ladderConfig.stabilizing.tempoFloorFraction : ladderConfig.settling.tempoFloorFraction;
  if (floorFraction == null) return true;
  return practiceBPM != null && practiceBPM >= targetBPM * floorFraction;
}

// Pass 61 — progress[id].holdingReviewCount's next value, given this
// session's incoming/outgoing stage. One shared rule for all three
// computeLadderAdvance outcome branches below (fail passes demote(stage)
// as newStage; soft-miss passes stage for both, since it never changes
// stage; pass passes whatever it actually computed newStage as):
//   - Freshly promoted into Holding this session (newStage is "holding",
//     stage wasn't) → 0. Only reachable from the pass branch (Holding has
//     no ceiling to promote out of and no floor to fail out of without
//     also leaving Holding), but stated generally rather than assuming
//     which branch calls it.
//   - Already in Holding when this session was logged (incoming
//     `stage === "holding"`) → increments, regardless of outcome
//     (pass/soft-miss/fail all count — confirmed explicitly, not passes
//     only) and regardless of where the chunk ends up (a fail out of
//     Holding still increments the count for the review that just
//     happened; the field simply stops being read the moment stage
//     isn't "holding" and resets to 0 on the next re-promotion anyway,
//     so this has no practical consequence either way).
//   - Otherwise (never touched Holding this call) → unchanged.
function nextHoldingReviewCount(stage, newStage, holdingReviewCount) {
  if (newStage === "holding" && stage !== "holding") return 0;
  if (stage === "holding") return holdingReviewCount + 1;
  return holdingReviewCount;
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
//   stabilizingEntryBPM,          // number | null — practiceBPM the last time this chunk freshly
//   settlingEntryBPM,             // entered each named stage (Pass 26 follow-up, see header note).
//   holdingEntryBPM,              // Defensively treated as null if absent (pre-existing chunks).
//   tempoRatchetK,                // number | null — this chunk's own current tempo-ratchet rate
//                                 // (Pass 59), persisted the same flat-scalar way as the three
//                                 // entryBPM fields above. Defensively defaulted to
//                                 // ladderConfig.tempoRatchet.k when absent/null (a fresh chunk,
//                                 // or one migrated in before this field existed).
//   holdingReviewCount,           // number — count of logged Holding reviews since this chunk
//                                 // most recently, freshly entered Holding (Pass 61). Defensively
//                                 // defaulted to 0 when absent (never been in Holding, or migrated
//                                 // in before this field existed). See nextHoldingReviewCount above.
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
//
// ladderContext (Pass 139) is null for a piece on today's plan, and then
// nothing below differs from before this pass (`test/ladder-table.test.mjs`
// compares it with the earlier code on a table of cases). For a base chunk of
// a piece on review model 2, lib/scheduling.js's ladderContextFor builds it:
//   passesNeeded — the passes to leave the chunk's current stage (the pass
//                  table, or the owner's override); null means "read
//                  ladderConfig[stage].graduationPasses as before"
//   canPromote   — false on the chunk's first session and on any session
//                  before the day its next review is due (the learning day,
//                  the next-day touch, an early look): a chunk moves up only
//                  on its own turn. Passes are still counted.
//   maxCredit    — the most one pass may count for (1 for the touch, so a
//                  fast touch is still one pass); null means no cap
// A pass at or above STRONG_PASS_FRACTION of the target tempo counts as two
// whenever a context is given. The three outcome rules otherwise stand: a
// Partial pass starts the count over, Needs rework steps back one stage.
export function computeLadderAdvance(chunkLadderState, outcome, ladderConfig, ladderContext = null) {
  const stage = STAGES.includes(chunkLadderState.stage) ? chunkLadderState.stage : "stabilizing";
  const consecutivePasses = chunkLadderState.consecutivePasses || 0;
  const consecutiveStabilizingFails = chunkLadderState.consecutiveStabilizingFails || 0;
  const wasFlagged = !!chunkLadderState.needsRelearning;
  const { practiceBPM, targetBPM, tier1Done, suggestedStartingBPM } = chunkLadderState;
  // Pass 59 — this chunk's own current tempo-ratchet rate, defensively
  // defaulted the same way targetBPM/entryBPM fields are elsewhere in this
  // function (a fresh chunk, or one migrated in before this field existed,
  // has nothing recorded yet).
  const currentTempoRatchetK = chunkLadderState.tempoRatchetK ?? ladderConfig.tempoRatchet.k;
  // Pass 61 — count of logged Holding reviews so far; see
  // nextHoldingReviewCount above for how each branch below advances it.
  const holdingReviewCount = chunkLadderState.holdingReviewCount || 0;
  // Pass 60 — evaluated once off the pre-session practiceBPM/targetBPM
  // (the same inputs already in scope), then substituted for the tracked
  // rate at each point a step size actually gets computed below. The
  // tracked rate itself (currentTempoRatchetK, and its halved/recovered/
  // reset descendants) is never overwritten by this — only what feeds
  // tempoRatchetStepSize changes.
  const inTempoMaintenance = isInTempoMaintenance(practiceBPM, targetBPM, ladderConfig);

  // Pass 26 follow-up (see header note): a local lookup grouping the three
  // flat entry-BPM fields by stage name, purely for convenience inside
  // this function — inputs/outputs stay flat scalars.
  let entryBPM = {
    stabilizing: chunkLadderState.stabilizingEntryBPM ?? null,
    settling: chunkLadderState.settlingEntryBPM ?? null,
    holding: chunkLadderState.holdingEntryBPM ?? null,
  };
  // The chunk's raw incoming stage (not the `stage` const above, which
  // already defaults null to "stabilizing") is null exactly when this is
  // the very first call for this chunk — either a brand-new chunk, or one
  // migrating in with real history from before the ladder existed (same
  // "not on the ladder yet" convention documented on the chunkLadderState
  // shape below). Either way, this call itself IS Stabilizing's first
  // entry, so its baseline is whatever practiceBPM was just seeded to —
  // there's no earlier moment to have recorded.
  if (chunkLadderState.stage == null && entryBPM.stabilizing == null) {
    entryBPM = { ...entryBPM, stabilizing: practiceBPM };
  }

  if (outcome.result === "fail") {
    const newStage = demote(stage);
    const newFailStreak = stage === "stabilizing" ? consecutiveStabilizingFails + 1 : 0;
    // Rule 1 (Decisions.md#spaced-repetition--maintenance): the signal
    // fires exactly once, on the fail that pushes the streak to 2 while
    // already in Stabilizing — not re-fired on every fail thereafter.
    const becomesFlagged = !wasFlagged && stage === "stabilizing" && newFailStreak >= 2;
    const newNeedsRelearning = wasFlagged || becomesFlagged;
    // The stage this fail demotes INTO already has a recorded entry tempo
    // (set the last time the chunk freshly arrived there — including the
    // common case where a Stabilizing fail doesn't actually change stage
    // at all, so this is just Stabilizing's own baseline) — reset there
    // instead of the flat bpmSteps.fail step. Falls back to the old step
    // when nothing's recorded yet (a chunk migrated in without this field).
    // Rule 4 still wins outright when it applies — a stale/broken chunk
    // getting flagged is a bigger, more deliberate reset than "go back to
    // where this stage last was."
    const resetTarget = entryBPM[newStage];
    const newPracticeBPM =
      becomesFlagged && suggestedStartingBPM != null
        ? suggestedStartingBPM
        : resetTarget != null
        ? resetTarget
        : stepBPM(practiceBPM, targetBPM, ladderConfig.bpmSteps.fail);
    // A genuine stage change re-baselines that stage's entry tempo to what
    // the chunk now actually has, for a LATER demotion back into it. When
    // the stage doesn't change (the ordinary already-in-Stabilizing fail),
    // this is a no-op — newPracticeBPM just equals the value already
    // recorded there.
    const newEntryBPM = newStage !== stage ? { ...entryBPM, [newStage]: newPracticeBPM } : entryBPM;
    return {
      stage: newStage,
      consecutivePasses: 0,
      consecutiveStabilizingFails: newFailStreak,
      practiceBPM: newPracticeBPM,
      // Pass 61 — a fail out of Holding still counts as a logged Holding
      // review for the count (see nextHoldingReviewCount above); demote()
      // never leaves a chunk in Holding on a fail, so this can never also
      // need the fresh-entry reset.
      holdingReviewCount: nextHoldingReviewCount(stage, newStage, holdingReviewCount),
      // Pass 59 — a real fail resets the tempo ratchet's adaptive rate
      // back to default, alongside whatever practiceBPM reset just
      // happened above. Nothing to preserve here: no adaptive-rate state
      // existed before this pass for a fail to have meaningfully touched.
      tempoRatchetK: ladderConfig.tempoRatchet.k,
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
      stabilizingEntryBPM: newEntryBPM.stabilizing,
      settlingEntryBPM: newEntryBPM.settling,
      holdingEntryBPM: newEntryBPM.holding,
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
    // Pass 59 — a soft-miss halves the chunk's adaptive tempo-ratchet rate
    // before stepping, so practiceBPM still moves forward on a soft-miss
    // (never backward, unlike the old flat bpmSteps.softMiss delta below,
    // which only remains reachable when there's no targetBPM to be
    // gap-proportional against) — just at half the usual pace. Two clean
    // passes afterward (see the pass branch below) restore the default.
    const halvedTempoRatchetK = currentTempoRatchetK / 2;
    // Pass 60 — the step-size calculation reads through maintenanceK while
    // in maintenance mode; halvedTempoRatchetK is still what persists to
    // progress[id].tempoRatchetK below, completely unaffected — Pass 59's
    // halve-on-soft-miss bookkeeping keeps running exactly as it already
    // does, whether or not this particular step used it.
    const stepK = inTempoMaintenance ? ladderConfig.tempoRatchet.maintenanceK : halvedTempoRatchetK;
    const ratchetStep = tempoRatchetStepSize(practiceBPM, targetBPM, stepK, ladderConfig.tempoRatchet.kCapBpm);
    return {
      stage,
      consecutivePasses: 0,
      consecutiveStabilizingFails: 0,
      practiceBPM:
        demonstrated != null
          ? demonstrated
          : ratchetStep != null
          ? stepBPM(practiceBPM, targetBPM, ratchetStep)
          : stepBPM(practiceBPM, targetBPM, ladderConfig.bpmSteps.softMiss),
      tempoRatchetK: halvedTempoRatchetK,
      // Pass 61 — stage never changes on a soft-miss, so this only ever
      // increments (if already in Holding) or stays put.
      holdingReviewCount: nextHoldingReviewCount(stage, stage, holdingReviewCount),
      nextDueDate: addDaysISO(outcome.asOfDate, intervalForStage(stage, ladderConfig, consecutivePasses, outcome.effectiveness)),
      tier1Done,
      stabilizingEntryBPM: entryBPM.stabilizing,
      settlingEntryBPM: entryBPM.settling,
      holdingEntryBPM: entryBPM.holding,
      graduated: false,
      demoted: false,
      // Neither sets nor clears the flag — a soft-miss isn't a fail (so it
      // can't trigger rule 1) and isn't a full pass (so it can't graduate
      // rule 2's exit) — it just carries whatever was already there.
      needsRelearning: wasFlagged,
    };
  }

  // outcome.result === "pass"
  const clearsFloor = clearsStageFloor(stage, practiceBPM, targetBPM, ladderConfig);
  // Pass 139 (review model 2 only; with no context this is exactly the old
  // "+1, then compare with graduationPasses"): a strong pass counts as two,
  // capped where the context says so (the next-day touch is one pass), and the
  // promotion itself can be held back (first session, before the due day)
  // while the count keeps growing, so the chunk moves up at its next own turn
  // if it still has enough.
  const ctx = ladderContext;
  // Only in the two stages the table covers: in Holding the count drives how
  // far the next review gap grows (intervalForStage), and doubling it there
  // would stretch the gaps; Pass 140 rebuilds Holding's gaps on its own terms.
  const strongPass = ctx != null && PASS_TABLE_STAGES.includes(stage) && isStrongPass(outcome.result, outcome.bpm, targetBPM);
  const rawCredit = strongPass ? 2 : 1;
  const passCredit = ctx != null && ctx.maxCredit != null ? Math.min(ctx.maxCredit, rawCredit) : rawCredit;
  const passesIfCounted = clearsFloor ? consecutivePasses + passCredit : consecutivePasses;
  const graduationPasses = ctx != null && ctx.passesNeeded != null ? ctx.passesNeeded : ladderConfig[stage].graduationPasses;
  const enoughPasses = clearsFloor && graduationPasses != null && passesIfCounted >= graduationPasses;
  const promotionHeld = enoughPasses && ctx != null && ctx.canPromote === false;
  const shouldGraduate = enoughPasses && !promotionHeld;
  const newStage = shouldGraduate ? promote(stage) : stage;
  const passesAfter = shouldGraduate ? 0 : passesIfCounted;
  const demonstratedOnPass = computeDemonstratedTempoBaseline({
    outcome: outcome.result,
    cleanReps: outcome.cleanReps,
    bpm: outcome.bpm,
    practiceBPM,
    targetBPM,
  });
  // Pass 59 — replaces the flat bpmSteps.pass delta with a step
  // proportional to the remaining gap to targetBPM, at the chunk's own
  // adaptive rate (falls back to the flat step when there's no targetBPM
  // to be proportional against). When the learner's logged bpm actually
  // beat what was asked (outcome.bpm > practiceBPM, not just met it), an
  // overlearning bonus can widen the step further — computed and capped
  // separately from stepBPM's normal cap-at-target, since this bonus is
  // deliberately allowed to push practiceBPM up to 1.15x targetBPM (see
  // the ChecklistItem "overlearning" note, which reads that same
  // condition straight off the persisted practiceBPM/targetBPM). Neither
  // of these run when computeDemonstratedTempoBaseline already produced a
  // value below — that mechanism keeps taking priority exactly as it did
  // before this pass.
  // Pass 60 — same substitution as the soft-miss branch above: the step
  // calculation (and, through ratchetStep, the overlearning bonus below,
  // which is built on top of it) reads through maintenanceK while in
  // maintenance mode. currentTempoRatchetK / its k-recovery bookkeeping
  // just below is untouched by this — nothing to restore, since the real
  // rate was never overwritten.
  const stepK = inTempoMaintenance ? ladderConfig.tempoRatchet.maintenanceK : currentTempoRatchetK;
  const ratchetStep = tempoRatchetStepSize(practiceBPM, targetBPM, stepK, ladderConfig.tempoRatchet.kCapBpm);
  const beatTheAsk = ratchetStep != null && outcome.bpm != null && outcome.bpm > practiceBPM;
  const newPracticeBPM =
    demonstratedOnPass != null
      ? demonstratedOnPass
      : beatTheAsk
      ? // Math.round guards against float noise from 1.15 * targetBPM (e.g.
        // 1.15 * 100 === 114.99999999999999 in JS) — practiceBPM is always
        // a clean integer everywhere else in this module, so the cap must
        // resolve to one too.
        Math.round(Math.max(0, Math.min(practiceBPM + Math.max(ratchetStep, Math.round(0.5 * (outcome.bpm - practiceBPM))), 1.15 * targetBPM)))
      : ratchetStep != null
      ? stepBPM(practiceBPM, targetBPM, ratchetStep)
      : stepBPM(practiceBPM, targetBPM, ladderConfig.bpmSteps.pass);
  // Pass 59 k-recovery — "two clean passes in a row" reuses
  // consecutivePasses rather than a new counter: computeLadderAdvance
  // already resets it to 0 on every soft-miss and demote (see those
  // branches above), so reaching 2 here already means two qualifying
  // passes actually happened back to back. Read from passesIfCounted
  // (before graduation zeroes it below), so a graduating pass that also
  // happens to be the 2nd still recovers k.
  const recoversTempoRatchetK = passesIfCounted >= 2;
  // Graduating into a new stage records its fresh entry tempo, same as a
  // fail-driven demotion does above — this is what a LATER fail out of
  // that stage will reset back to.
  const newEntryBPM = shouldGraduate ? { ...entryBPM, [newStage]: newPracticeBPM } : entryBPM;

  return {
    stage: newStage,
    consecutivePasses: passesAfter,
    consecutiveStabilizingFails: 0,
    practiceBPM: newPracticeBPM,
    tempoRatchetK: recoversTempoRatchetK ? ladderConfig.tempoRatchet.k : currentTempoRatchetK,
    // Pass 61 — 0 on the pass that freshly promotes into Holding
    // (Settling → Holding is the only way in, since Holding has no
    // ceiling to graduate out of), incremented on every other pass logged
    // while already in Holding, unchanged for a pass anywhere else.
    holdingReviewCount: nextHoldingReviewCount(stage, newStage, holdingReviewCount),
    nextDueDate: addDaysISO(outcome.asOfDate, intervalForStage(newStage, ladderConfig, passesAfter, outcome.effectiveness)),
    tier1Done,
    stabilizingEntryBPM: newEntryBPM.stabilizing,
    settlingEntryBPM: newEntryBPM.settling,
    holdingEntryBPM: newEntryBPM.holding,
    graduated: shouldGraduate,
    demoted: false,
    // Rule 2's auto exit: graduating out of Stabilizing (the only stage a
    // flagged chunk can be in) clears the flag same as a manual override
    // would. Any other pass just carries the flag through unchanged.
    needsRelearning: stage === "stabilizing" && shouldGraduate ? false : wasFlagged,
    // Pass 139 informational flags (not persisted, like graduated/demoted),
    // present only when a context was given so a piece on today's plan gets
    // back exactly the object it always did.
    ...(ctx != null ? { strongPass, promotionHeld } : {}),
  };
}

// Pass 62 — forward-simulates a chunk's ladder card from its CURRENT
// persisted state, under a neutral, best-case assumption: every future
// review between now and the tempo goal is a clean full pass, logged at
// "good" effectiveness (not "high" — that would stack a second optimistic
// assumption on top of "always passes"). Reuses computeLadderAdvance
// itself for every simulated step rather than re-deriving its math
// separately, so this can never independently drift from the real ladder
// engine it's projecting.
//
// The "tempo goal" this aims for is tempoAchievedThreshold's fraction of
// targetBPM (Pass 60's "tempo maintenance mode" bar — Decisions.md#spaced-
// repetition--maintenance), not targetBPM outright: practiceBPM crossing
// that threshold is what actually flips the chunk's own step size down to
// the tiny, pinned maintenanceK rate (isInTempoMaintenance above), so
// demanding a literal 100%-of-target finish line here would be simulating
// past the point this module's own math already treats the chunk as
// "there."
//
// Applies to every piece regardless of scheduleMode — this only ever reads
// the chunk's ladder state and ladderConfig, never piece.targetDate or
// piece.daysToLearn, so there's no days-mode/minutes-mode branch anywhere
// in here.
//
// MAX_SIMULATION_STEPS guarantees termination regardless of chunk/config
// shape. Under the current tempo-ratchet math a pass's step size floors at
// 1 BPM whenever there's a real gap to close (tempoRatchetStepSize's own
// `Math.max(1, ...)`), so in practice this loop already terminates well
// under the cap for realistic BPM ranges — but the cap isn't decorative:
// ladderConfig.tempoRatchet.kCapBpm is user-editable (Settings'
// LadderConfigEditor, Pass 17), and a kCapBpm of exactly 0 collapses that
// floor's outer `Math.min` to 0, forcing every step to 0 forever with no
// way for practiceBPM to ever close the gap. A chunk in that state
// genuinely cannot converge — the cap is what stops the loop from hanging
// rather than reporting that honestly.
export const MAX_SIMULATION_STEPS = 500;

// The fixed warning bar a simulation's projected duration is compared
// against — a flat 3 calendar months, not derived from piece.targetDate or
// any other piece-specific value. Deliberately the same for every piece
// regardless of scheduleMode.
export const TEMPO_CONVERGENCE_WARNING_DAYS = 90;

// chunkLadderState — same shape computeLadderAdvance documents above
// (targetBPM/practiceBPM are the two fields this function itself reads
// directly; the rest just ride along into computeLadderAdvance unchanged
// on the first simulated step). startDate — 'YYYY-MM-DD', the calendar
// date the simulation starts counting forward from (the caller's "now").
//
// Returns:
//   applicable — false when there's no targetBPM (nothing to aim for) or
//     no practiceBPM yet (no baseline to project forward from, e.g. a
//     chunk that's never been practiced) — the caller's cue that there's
//     nothing to show, not a warning.
//   converged — true once the simulated practiceBPM reaches the tempo
//     goal within MAX_SIMULATION_STEPS.
//   days — total calendar days simulated forward until convergence (0 if
//     the chunk is already at/past the goal right now); null when not
//     applicable or when the cap was hit without converging.
//   iterations — how many simulated passes it took (0 for "already there"
//     or "not applicable").
//
// passesNeededByStage (Pass 139, optional) — for a base chunk of a piece on
// review model 2, `{ stabilizing: n, settling: n }` (what passesNeededByStageFor,
// lib/scheduling.js, returns), so the projection promotes the chunk after the
// passes the new plan asks for instead of the old graduationPasses. Omitted
// (or null) for a piece on today's plan, and then nothing here differs.
export function simulateTempoConvergence(chunkLadderState, ladderConfig, startDate, passesNeededByStage = null) {
  const { targetBPM, practiceBPM } = chunkLadderState;
  if (targetBPM == null || practiceBPM == null) {
    return { applicable: false, converged: false, days: null, iterations: 0 };
  }
  const goalBPM = targetBPM * ladderConfig.tempoRatchet.tempoAchievedThreshold;
  if (practiceBPM >= goalBPM) {
    return { applicable: true, converged: true, days: 0, iterations: 0 };
  }

  let state = chunkLadderState;
  let asOfDate = startDate;
  let totalDays = 0;

  for (let i = 1; i <= MAX_SIMULATION_STEPS; i++) {
    const stepContext = passesNeededByStage
      ? { passesNeeded: passesNeededByStage[STAGES.includes(state.stage) ? state.stage : "stabilizing"] ?? null, canPromote: true, maxCredit: null }
      : null;
    const advance = computeLadderAdvance(state, { result: "pass", effectiveness: "good", asOfDate }, ladderConfig, stepContext);
    totalDays += daysBetweenInclusive(asOfDate, advance.nextDueDate) - 1;
    asOfDate = advance.nextDueDate;
    state = { ...state, ...advance };

    if (state.practiceBPM != null && state.practiceBPM >= goalBPM) {
      return { applicable: true, converged: true, days: totalDays, iterations: i };
    }
  }

  return { applicable: true, converged: false, days: null, iterations: MAX_SIMULATION_STEPS };
}

// Whether a simulateTempoConvergence result should actually surface as a
// warning: not applicable never warns; hitting the iteration cap without
// converging always warns (strictly worse than any finite projection); a
// finite projection warns only past TEMPO_CONVERGENCE_WARNING_DAYS.
export function tempoConvergenceExceedsWarning(simulation) {
  if (!simulation || !simulation.applicable) return false;
  if (!simulation.converged) return true;
  return simulation.days > TEMPO_CONVERGENCE_WARNING_DAYS;
}
