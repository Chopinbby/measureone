# Algorithms

> **Purpose:** The canonical description of every non-trivial computation in
> MeasureOne — what it does, why it's shaped that way, and what regression to
> watch for if you touch it. This is the doc to read before changing any
> function listed here.
> **Audience:** Anyone modifying scheduling, confidence, or chunking logic —
> future Claude Code sessions especially. Several sections below exist
> specifically because a past regression needs a name so it doesn't quietly
> reappear.
> **Scope:** The computations themselves. Data shapes live in
> [Data-Model.md](Data-Model.md); which UI surfaces call these functions
> lives in [User-Flows.md](User-Flows.md) and [Architecture.md](Architecture.md);
> which constants are hand-tuned vs. evidence-based lives in
> [Research.md](Research.md).
> **Related:** [Data-Model.md](Data-Model.md) · [Research.md](Research.md) ·
> [Decisions.md](Decisions.md)
> **Update when:** Any function named here changes behavior — this doc should
> describe the *current* algorithm, not the original one. If you're fixing a
> bug that this doc already warns about, that's a signal the doc did its job;
> update it to describe the fix, don't just delete the warning.

All of the functions below live near the top of `src/App.jsx`, before any
component definitions, as pure functions of `piece` (and, for chunk-level
functions, a specific chunk).

## Chunking

`generatePracticeChunks(piece)` / `generateTransitionChunks()` /
`generateComboChunks()` / `generateAllChunks(piece)` — pure functions,
`piece` → chunk arrays.

- Chunk size comes from `autoChunkSize()` (flat 4 measures, regardless of
  piece length — previously tiered 2/4/8/12 by piece length, simplified per
  [Decisions.md](Decisions.md#scheduling)) or `piece.customChunkSize`.
- Each chunk's difficulty is the average of its measures' difficulty
  ratings (`weightedDifficultyFromArray`), bucketed into easy/medium/hard.
- Recurring material reduces a chunk's `effort` (the unit the scheduler
  budgets against) via `effortMultiplier` — already-familiar passages don't
  consume schedule budget meant for genuinely new material.

See [Data-Model.md](Data-Model.md#practice-chunks-vs-sections-vs-transitions-vs-combos-vs-run-throughs)
for what each generated `kind` means.

## Section run-throughs

`computeSectionRunThroughs(piece, practiceChunks)` — computed live (not
persisted, not part of `generateAllChunks`'s output), used only by
`SectionRunThroughPanel`.

- A single-section run-through (`kind: "section-runthrough"`) unlocks for a
  given `piece.sections` entry once **every practice chunk within that
  section** has at least one logged session.
- A combined section-pair run-through (`kind: "section-transition"`) between
  two adjacent, already-learned sections unlocks only once **every practice
  chunk in the entire piece** has at least one logged session —
  deliberately a later-stage drill, not an early one, per the code comment
  at the top of the function.

## Timeline / scheduler

`computeTimeline(piece, chunkSet)` is the scheduler. It runs on every
`piece` change (see [Architecture.md](Architecture.md#state-management)),
so it always reflects the latest logged sessions. `piece.daysToLearn` is a
count of *calendar* days, not practice days — the first thing
`computeTimeline` does is compute which of those calendar days are rest
days (`computeRestDayFlags`, based on `piece.practiceDaysPerWeek`) and build
`learningDaysCalendar`, the ordered list of calendar day numbers that are
actually available for practice. Every placement step below walks that
filtered list — via `snapCapped`/`snapOrDrop`, which snap a raw calendar-day
offset forward to the next real practice day — instead of the raw
`1..daysToLearn` range, so new-chunk introduction, transitions, combos, and
spaced review never land content on a rest day. `days[i].type` is `"rest"`
for those days (0 minutes, nothing scheduled) alongside the existing
`"learning"`/`"consolidation"` types. See
[Decisions.md](Decisions.md#scheduling) for why this lives inside
`computeTimeline` rather than in `getCurrentDay`.

Key scheduling rules, deliberately encoded as constraints rather than "just
spread everything evenly" (all of them now operate in terms of practice-day
positions within `learningDaysCalendar`, not raw calendar offsets):

1. **The entire piece is introduced within the first half of the learning
   days** (`halfPoint`). New-chunk introduction is spread **evenly by total
   effort** across that first-half window (`totalNewEffort / halfPoint` per
   day), not greedily packed to `minutesPerDay` and moved on. Greedy
   packing tends to finish early and cram most of the piece into just the
   first few days, which then piles up all of *those* chunks' transitions
   and spaced reviews onto the same handful of later days too — spreading
   the introduction itself is what actually prevents that pile-up, while
   still guaranteeing full coverage by `halfPoint`.
2. **Transitions are scheduled as soon as both flanking chunks have been
   introduced** — not batched into the back half. This was a bug fixed
   during development: an early version delayed transitions unnecessarily
   via an index-based spread. **If you see an `i % backSpan`-style offset
   reappear on the transitions loop (as opposed to the combos loop, where
   it belongs), that regression is back.**
3. **Combos are reserved for the back half**, spread across it round-robin
   over the pool of remaining back-half practice days (`i % candidates.length`
   — this is where an index-based offset legitimately belongs).
4. **Spaced review** uses `REVIEW_OFFSETS = [1, 3, 7, 14]` calendar days
   after a chunk's introduction, snapped forward to the next practice day if
   the raw offset lands on a rest day, bent per-chunk by
   `adaptiveReviewOffsets` (below). **This fixed-offset mechanism is
   designed to be superseded by a spaced-repetition ladder** (continuous
   Stabilizing/Settling/Holding stages, replacing this rule's one-shot
   four-review burst with an indefinite per-chunk cadence) — not yet
   implemented; see
   [Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built](Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built)
   for the design and [Decisions.md](Decisions.md#spaced-repetition--maintenance)
   for why. This section describes what's actually implemented today.
5. **Review-load smoothing**: after initial placement, a bounded pass (up to
   3 iterations) looks for learning days sitting more than 10% above the
   plan's average load and, for each such day's most expensive review item,
   tries nudging it ±1 or ±2 days (never before the day after its
   introduction, never past the end of the plan, never onto a day that
   already has that same chunk) if doing so meaningfully reduces the
   overloaded day's load. This exists because naive fixed-offset placement
   causes any day with a lot of new introductions to also have a
   disproportionately heavy review day 1/3/7/14 days later — the smoothing
   pass exists specifically to flatten those swings without abandoning the
   intended review spacing.
6. **Only the final day** (if the plan is ≥5 days) is a pure "no new
   material, full run-through" consolidation day. Earlier iterations
   reserved a much bigger tail for this; that was deliberately walked back
   because it wasted the back half on run-throughs instead of targeted
   work.

## Deriving daysToLearn from minutesPerDay (scheduleMode: "minutes")

`computeTimeline` treats `piece.daysToLearn` purely as an input — it never
asks "is this actually enough days for this piece's effort at this pace,"
it just lays the plan out across however many days it's given. For
`scheduleMode: "days"` that's correct (the user fixed a deadline;
`daysToLearn` *is* the fixed quantity, and `minutesPerDay` is what's
derived from it). For `scheduleMode: "minutes"` it's backwards:
`minutesPerDay` is the fixed quantity the user actually set, and
`daysToLearn` is supposed to be *derived* from it — expand the plan until
the piece's effort fits inside that daily budget.

`computeDaysNeededForMinutesPerDay(chunkSet, minutesPerDay, practiceDaysPerWeek)`
does that derivation: a greedy pass over `chunkSet.all` (practice chunks,
transitions, combos) accumulating effort until adding the next item would
exceed the effort-equivalent of one day's budget, at which point a new day
starts. Each item's accumulated cost includes not just its own introduction
effort but an estimate of the review load it will generate later
(`REVIEW_OFFSETS.length` reviews at a flat 3 minutes each, converted to
effort-point units) — omitting that would under-count what a day actually
costs once `computeTimeline`'s spaced review lands on top of introduction,
and the day count would come out "technically sufficient" for introduction
alone while still running well over budget in practice. The resulting
day-bucket count is padded the same way the "days" mode's own estimate is
(`LIBERAL_FACTOR`, an assumed 0.88 practice-day-to-calendar-day ratio, then
`practiceDaysPerWeek`) to get a calendar-day count.

**This is not a hard per-day cap.** `computeTimeline`'s own placement design
(new-chunk introduction spread only across the *first half* of learning
days — see rule 1 above) means early introduction-heavy days can still run
somewhat over `minutesPerDay`, especially for a piece whose chunk size is
large relative to a very tight budget (a single chunk's raw introduction
cost can itself exceed a small `minutesPerDay`, in which case no amount of
extra days fixes that single day — only a smaller chunk size would). What
this derivation guarantees is that the *plan length itself* actually
tracks the stated budget instead of ignoring it, which is what was broken
before this existed.

`reconcileMinutesPerDaySchedule(piece)` wraps that derivation into a
piece-level fixup: for a `scheduleMode: "minutes"` piece, replace
`daysToLearn` with what `computeDaysNeededForMinutesPerDay` says is needed
(no-op for `scheduleMode: "days"`, and a no-op if the value already
matches). `ScheduleFields` already performed this same derivation live, as
a `useEffect` reacting to `draft.minutesPerDay`/`draft.daysToLearn` — but
that only ever ran while a human had the Schedule panel mounted (Wizard or
Settings edit mode). A piece arriving any other way — loaded from
`localStorage`, or merged in from an imported backup — skipped it entirely,
so `daysToLearn` stayed at whatever value the stored/imported data
happened to carry, with computeTimeline packing the piece's full effort
into that count regardless of whether it fit the stated `minutesPerDay`.
`reconcileMinutesPerDaySchedule` is now called from
`validateAndMigratePiece` (`lib/storage.js`, so it runs on every load — not
just once, since editing difficulty/measures/recurring material
legitimately changes how many days the same budget needs) and from the
import merge in `App.jsx`'s `handleConfirmImport` (so a same-session import
doesn't have to wait for a reload to get corrected). See
[Decisions.md](Decisions.md#scheduling) for why this couldn't just stay a
UI-only concern.

## Adaptive review

`adaptiveReviewOffsets(chunk, progress)` — not fully learned/tuned yet (see
[Research.md](Research.md)), but the mechanism is in place: the fixed
`[1,3,7,14]` offsets are multiplied by 0.6 if the chunk's most recent logged
session had `effectiveness: "low"`, or 1.4 if `"high"` — struggling sessions
pull the next review closer, easy ones push it out. Recomputed on every
`computeTimeline` run; it never touches days that have already passed.

The 0.6×/1×/1.4× multiplier here is planned to be reused (not replaced) by
the designed-but-unimplemented spaced-repetition ladder's Holding-stage
interval expansion, per
[Decisions.md](Decisions.md#spaced-repetition--maintenance) — deliberately
avoiding a second, parallel multiplier system for the same job.

## Confidence

`computeAutoConfidence(chunk, piece, currentDay)` is intentionally **not**
"did you touch it" — it's reps-quality-weighted:

- Each logged session contributes `repRatio * (0.5 + 0.5 * bpmRatio)` where
  `repRatio = cleanReps / requiredReps` (`REQUIRED_REPS = { easy: 3,
  medium: 4, hard: 5 }`) and `bpmRatio = bpm / targetBPM` (or a neutral 0.6
  if no target BPM exists anywhere for that chunk). **Fewer clean reps at a
  lower tempo must genuinely score lower — this was a specific bug fix; do
  not let this regress into "any session = full credit."**
- Recency decays the score if it's been several days since last practiced.
- The learner's self-reported `effectiveness` on their most recent session
  applies a final multiplier (0.8× / 1× / 1.15×).
- Hard chunks get a small penalty (need more to feel "solid"); recurring
  chunks get a small boost (already-familiar material).

`computeConfidence()` wraps this and short-circuits entirely if
`progress[chunkId].manualConfidence` is set.

`computeConfidenceAsOf(chunk, piece, asOfDay)` reconstructs what
`computeConfidence` would have returned on a past plan-day: it filters
`doneDays`/`sessions` to `<= asOfDay` and runs recency decay relative to
`asOfDay` instead of today. Used by the Progress tab's "most improved this
week" stat. **Known limitation** (documented in the code): `manualConfidence`
has no recorded set-date, so if one is present it applies regardless of
`asOfDay` rather than being correctly excluded for cutoffs before it was
actually set.

`getDefaultTargetBPM(piece, chunk)` resolves the effective tempo target for
a chunk with no explicit per-chunk target: checks `piece.bpmZones` for a
measure-range match first, then falls back to `piece.targetBPM`.

`computeProgressTier(chunk, piece)` is a **separate, simpler** score from
confidence — see [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)
for why the two shouldn't be conflated. It buckets a chunk into
`untouched / learned / comfortable / mastered` based purely on the **most
recently logged** session's clean-rep count (≥10 → mastered, ≥5 →
comfortable, any sessions at all → learned), with no tempo, recency, or
effectiveness input. It drives only the Overview tab's "Practice progress"
bar.

## Behind-schedule detection

`computeScheduleStatus(piece, practiceChunks, timeline, currentDay)`: a
chunk only counts as **missed** if its scheduled introduction day
(`timeline.introducedDay[chunkId]`) has already passed (`< currentDay`) and
it still has zero logged sessions. **This was a deliberate fix — an earlier
version compared cumulative planned-vs-actual counts, which incorrectly
flagged "behind schedule" on the very day something was completed, before
the day was even over. Do not reintroduce same-day cumulative comparison as
the trigger for the reschedule banner.**

If `piece.status` is anything other than `"active"` (i.e. `"paused"` or
`"archived"`), `missedCount` is forced to 0 regardless of how many
introduction days have passed — a paused/archived piece never shows the
"N chunks behind schedule" banner or the Master Agenda "N behind" badge.
`remainingChunkIds` is still computed either way, since `handleReschedule`
needs it once the piece goes active again. See
[Decisions.md](Decisions.md#lifecycle) and
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#pause--archive-built).

## Rescheduling

`getEffectiveTimeline(piece, chunkSet)`: when the user confirms "Reschedule
remaining days" (see [User-Flows.md](User-Flows.md#4-falling-behind-and-rescheduling)),
`piece.rescheduleMarker = { asOfDay, remainingChunkOrder }` is set
(`remainingChunkOrder` is the ordered list of practice-chunk ids with zero
sessions logged). `getEffectiveTimeline` then keeps every day before
`asOfDay` exactly as originally computed, and re-runs `computeTimeline` on
just the remaining chunks packed into whatever days are left, splicing the
two together.

The feasibility check shown in the reschedule confirmation dialog
(`handleReschedule` in the `App` component, not part of `getEffectiveTimeline`
itself) estimates required vs. available days using `EFFORT_TO_MIN` and the
0.65 efficiency constant — see [Data-Model.md](Data-Model.md#known-simplifications).

## Revival

Data shapes: [Data-Model.md](Data-Model.md#revival). Recovering a piece that
was learned once but has gone stale — see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md).

`getRevivalTargetBPM(piece, chunk)` resolves the effective tempo target
during an active revival: `piece.revival.performanceTempo` (if the revival
is active and a performance tempo was set) wins over everything, including a
chunk's own explicit `targetBPM` — the point of collecting a performance
tempo at revival entry is that it should override tempos set while first
learning the piece, even at the per-chunk level. Falls back to
`entry.targetBPM || getDefaultTargetBPM(piece, chunk)` otherwise, same as
normal practice.

`computeTempoLadder(targetBPM, startFraction, steps)` returns a small
(default 5-step) array of BPM values from `targetBPM * startFraction`
(default 0.6, adjustable via `piece.revival.tempoLadderStartFraction`) up to
`targetBPM` itself, inclusive. Rounding can collapse steps together when
`startFraction` is close to 1; the result is deduplicated rather than
showing a misleading run of repeated values.

`computeRevivalPlan(piece, chunkSet, currentDay)` builds the ordered
day-by-day revival plan: practice chunks and transitions (**not** combos —
revival reassessment scope is chunks and seams only), sorted weak-spots-first
then lowest-confidence-first, greedily packed into days against
`piece.minutesPerDay` using each item's existing `effort` and
`EFFORT_TO_MIN`. **This description matches what's implemented today, but
the combo exclusion is planned to change to a dynamic, outcome-dependent
rule** (combos escalate into their own task only if their underlying
content fails during revival) **that this function doesn't support yet** —
see [Decisions.md](Decisions.md#spaced-repetition--maintenance) and
[Repertoire-Lifecycle.md#revival-auto-triggers](Repertoire-Lifecycle.md#revival-auto-triggers)
for the design; it also means this function can no longer stay a
fixed-list-generated-once shape once built. **This is deliberately a
distinct, simpler function, not an adaptation of `computeTimeline`.** `computeTimeline`'s defining behaviors —
spreading new-chunk introduction across the first half, deferring combos to
the back half, adaptive review offsets keyed off introduction day — all
exist to manage *first-time introduction* of material, which has no
equivalent in revival (everything was already learned once). What's reused
instead are the same underlying primitives `computeTimeline` itself is built
on (`generateAllChunks`'s effort-scored chunks/transitions, `EFFORT_TO_MIN`,
`piece.minutesPerDay`) and the same greedy day-packing pattern
`ScheduleFields` already uses elsewhere in this file — not `computeTimeline`
or `getEffectiveTimeline` directly.

A revival plan's `dayNumber` is a **suggested pacing bucket only** — it does
not map onto the main timeline's day numbers, and logging a revival item
does not require "being on" its suggested day. `RevivalTab` passes the
piece's real `currentDay` (the same value `TodayTab` uses) to every
`ChecklistItem` it renders, regardless of which plan day that item sits
under, so session recency math (`computeAutoConfidence`'s day-since-last-
practice decay) stays correct. There is intentionally no revival-specific
session-day numbering — see
[Data-Model.md](Data-Model.md#known-simplifications) generally for why this
codebase avoids parallel data model concepts.

Reassessment itself does not have a dedicated compute function — it *is*
`progress[id].manualConfidence`, set through `PieceMapTab`'s existing
confidence-override UI (extended with `CONFIDENCE_PRESETS`, a 5-button fast
path over the same 0-100 field, plus a `sequentialMode` Prev/Next/Finish
flow so the same grid-and-modal component can be stepped through
chunk-by-chunk instead of reopened per cell). See
[Decisions.md](Decisions.md#revival) for why this reuses `manualConfidence`
rather than introducing a separate scale.
