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

All of the functions below live in `src/lib/*.js` (chunking.js,
scheduling.js, confidence.js, revival.js, ladder.js, storage.js) as pure
functions of `piece` (and, for chunk-level functions, a specific chunk) —
see [Architecture.md](Architecture.md#file-structure-current) for the
current file layout. `App.jsx` calls these from its state handlers; it
doesn't define them.

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
4. **Spaced review is driven by the maintenance ladder, not a fixed
   offset.** `computeTimeline` places at most one upcoming review per chunk
   per recompute, in one of two tiers (Pass 5 of the maintenance-ladder
   build; full design and decision record:
   [Repertoire-Lifecycle.md#introduction-window-review-scheduling-tier-1--tier-2](Repertoire-Lifecycle.md#introduction-window-review-scheduling-tier-1--tier-2),
   [Decisions.md](Decisions.md#spaced-repetition--maintenance)):
   - **Tier 1** — a chunk that's never been logged (`ChunkProgress.stage`
     still `null` **and** no session history at all — see the note below)
     gets a near-mandatory first-touch review placed at `introducedDay + 1`,
     snapped forward off a rest day. Guaranteed a slot (clamped into the
     plan, never dropped) and never moved once placed — schedule pressure
     doesn't get absorbed here, only in Tier 2 below.
   - **Tier 2** — a chunk already on the ladder gets its review placed from
     its real `ChunkProgress.nextDueDate` (a calendar date set by
     `computeLadderAdvance`/`handleLogSession` — see
     [Session outcomes & the maintenance ladder](#session-outcomes--the-maintenance-ladder)
     below), converted to a day number via `piece.startDate`. A due date
     that falls beyond this plan's own `daysToLearn` simply isn't placed in
     this bounded view at all — surfacing it is the job of
     [`computeDueReviews`](#whats-due--the-live-maintenance-query) (Pass 8),
     a separate query that reads `nextDueDate` against a real calendar date
     rather than indexing `days[]`.
   - The old fixed `REVIEW_OFFSETS = [1, 3, 7, 14]`-days-after-introduction
     mechanism this rule used to describe is **no longer called by
     `computeTimeline`** — `adaptiveReviewOffsets` (below) still exists as a
     function but is now dead code with respect to scheduling.
   - **Legacy-data correction (found via Codex review of the Pass 5 diff):**
     `stage === null` alone doesn't mean "never touched" — migration
     (`backfillProgressLadderState`, `lib/storage.js`) sets `stage: null` on
     *every* progress entry that predates the ladder, including one with a
     long real session history logged before this feature existed. Tier 1
     additionally checks for zero logged sessions, so an already-practiced
     legacy chunk isn't wrongly told to do a "first touch" review — it
     simply gets no review placed until it's next logged, at which point it
     picks up real ladder state and starts taking the Tier 2 path.
5. **Review-load smoothing**: after initial placement, a bounded pass (up to
   3 iterations) looks for learning days sitting more than 10% above the
   plan's average load and, for each such day's most expensive Tier 2 review
   item, tries nudging it 1 or 2 days **later** (never before the day after
   its introduction, never past the end of the plan, never onto a day that
   already has that same chunk) if doing so meaningfully reduces the
   overloaded day's load. Tier 1 items are excluded from this pass entirely
   (see rule 4). This exists because naive placement causes any day with a
   lot of new introductions to also have a disproportionately heavy review
   day soon after — the smoothing pass exists specifically to flatten those
   swings without ever reviewing something before it's actually due.
   **Forward-only, not ±1/±2 days both ways** — an earlier version of this
   pass (inherited unchanged from the old `REVIEW_OFFSETS`-based mechanism,
   which had no specific "due date" to respect) could nudge a Tier 2 review
   *earlier* than its real due date, discovered via manual browser
   verification during the Pass 5 build: a chunk due on day 5 could
   cascade backward across the 3-iteration loop to as early as day 2,
   chasing whichever neighboring day was least loaded at each step. Fixed
   by restricting the candidate days to `day + 1`/`day + 2` only.
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
effort but a rough estimate of the review load it will generate later (2
touches at a flat 3 minutes each, converted to effort-point units) —
omitting that would under-count what a day actually costs once
`computeTimeline`'s spaced review lands on top of introduction, and the day
count would come out "technically sufficient" for introduction alone while
still running well over budget in practice. **The "2 touches" figure was 4
(`REVIEW_OFFSETS.length`) before Pass 5 of the maintenance-ladder build** —
that fixed four-touch assumption matched the old `REVIEW_OFFSETS`-based
placement, but `computeTimeline` no longer guarantees any fixed number of
reviews per item (each recompute shows at most one upcoming review per
chunk, driven by its live ladder due-date — see
[Timeline / scheduler](#timeline--scheduler) rule 4). Left at a deliberately
rough, conservative 2 rather than dropped to 1, so this estimate doesn't
under-provision and reintroduce the "technically sufficient but still runs
over budget" failure it exists to prevent — not a precise count, since the
real number depends on how the plan actually gets used, which this function
can't see (found stale by Codex review of the Pass 5 diff). The resulting
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

## Import merge

`mergeImportedPiece(existing, imported)` (`lib/storage.js`) merges a
freshly-imported piece into the existing piece `findMatchingPiece` matched it
to. Most fields follow `preferPresent`/`preferByRecency` (below); a few are
handled separately and documented at their own field in
[Data-Model.md](Data-Model.md#the-piece-object) — `progress` (per-chunk,
per-session merge, see below), `sections`/`recordings`/`bpmZones`
(additive by id, `mergeById`), `revival` (an active revival always wins over
whatever the import has), and `id`/`createdAt` (never touched by a merge —
the piece already exists).

`preferByRecency(importedVal, existingVal, importIsStale)` governs
everything else: `piece.status`, and — inside `mergeProgress` — a chunk's
`currentBPM`/`targetBPM`/`manualConfidence`. `importIsStale` is computed once
per merge in `mergeImportedPiece`, from each side's `updatedAt`
(`typeof x.updatedAt === "number" ? x.updatedAt : 0` — a missing timestamp,
i.e. a backup exported before this field existed, reads as 0 and is always
stale against a piece that has a real one). When the import is stale, the
preference direction flips: the existing value wins if both sides have one,
the import only fills a gap the existing piece doesn't have — the same
`preferPresent` logic as before, just with the two sides swapped. `merged.updatedAt`
is set to `Math.max(importedUpdatedAt, existingUpdatedAt)`, so a stale
import's own (older) timestamp can never make the merged piece look older
than it actually is on a later comparison.

**This is deliberately narrower than real conflict resolution.** It answers
"is the import older than what's already here," not "which side actually has
more practice history" — a chunk's *ladder* state (`stage`,
`consecutivePasses`, `consecutiveStabilizingFails`, `practiceBPM`,
`nextDueDate`, `tier1Done`) is untouched by this and still always keeps the
existing piece's value unconditionally, same as before this fix (see
[Decisions.md](Decisions.md#data-model)) — genuinely reconciling ladder state
across two diverged copies needs either replaying merged session history or a
real "choose which side to keep" UI, neither of which this builds. What this
does fix: a plain older backup (the common case — re-importing your own
earlier export, or accidentally re-importing an old file) can no longer
silently revert `status` (e.g. un-pausing/un-archiving a piece) or a
recently-logged `currentBPM`/`manualConfidence` with no warning in either
direction.

## Adaptive review

**Superseded as of Pass 5 of the maintenance-ladder build — kept in this
doc for the 0.6×/1×/1.4× multiplier it still lends to Holding, below.**
`adaptiveReviewOffsets(chunk, progress)` (`lib/scheduling.js`) is **no
longer called by `computeTimeline`** — Tier 1/Tier 2 placement (see
[Timeline / scheduler](#timeline--scheduler) rule 4) reads each chunk's
real ladder due-date instead of this function's fixed-offset-with-a-bend
output. It's still defined and exported (nothing currently deletes it), so
it remains accurate to describe, just no longer part of the live scheduling
path:

The fixed `[1,3,7,14]` offsets it computes are multiplied by 0.6 if the
chunk's most recent logged session's outcome (see
[Session outcomes & the maintenance ladder](#session-outcomes--the-maintenance-ladder)
below) was a real fail, or 1.4 if it was a full pass. Was keyed off a
free-standing self-reported `effectiveness` field ("how did it feel");
that field was folded into the pass/soft-miss/fail judgment, and this reads
the classified outcome instead (`sessionOutcome()`, `lib/confidence.js`).

**The 0.6×/1×/1.4× multiplier *values* are still very much live**, just not
via this function: `lib/ladder.js` keeps its own duplicated copy
(`effectivenessMultiplier`, a deliberate, commented duplication rather than
an import — see that file) for the ladder engine's Holding-stage interval
expansion — see
[Session outcomes & the maintenance ladder](#session-outcomes--the-maintenance-ladder)
below.

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
- The most recent session's classified outcome (pass/soft-miss/fail — see
  [Session outcomes & the maintenance ladder](#session-outcomes--the-maintenance-ladder)
  below) applies a final multiplier: 0.8× on a real fail, 1.15× on a full
  pass, unchanged on a soft-miss. Was keyed off a free-standing
  self-reported `effectiveness` field; folded into the outcome judgment,
  same change as Adaptive review above.
- Hard chunks get a small penalty (need more to feel "solid"); recurring
  chunks get a small boost (already-familiar material).

`computeConfidence()` wraps this and short-circuits entirely if
`progress[chunkId].manualConfidence` is set. After that (manual or auto), a
rough/lost `progress[chunkId].flag` — set from the Piece Map's post-run-through
flag cycle, [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)
— caps the result: `Math.min(score, 55)` for rough, `Math.min(score, 20)`
for lost. Applied even on top of a manual override, so a stale "I know
better than the algorithm" value from before the flag landed can't hide
it. Every caller of `computeConfidence` (Overview, Progress, Piece Map,
Analytics, the Today checklist, `FocusPanel`) gets this for free, since
none of them compute confidence independently — this is deliberately a cap
inside the shared function, not a per-tab display adjustment. Does not
read `stage` — see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented)
on why ladder stage still doesn't feed into confidence.

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

## Session outcomes & the maintenance ladder

Data shapes: [Data-Model.md](Data-Model.md#the-piece-object) (`ChunkProgress.stage`
etc., `piece.ladderConfig`). Design: [Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built).
Replaces the old flat pass/fail and free-standing "how did it feel"
self-report with an objective three-tier judgment, and advances a
per-chunk spaced-repetition ladder on every logged session.

`classifySessionOutcome({ cleanReps, bpm, requiredReps, practiceBPM,
manualFail, previousOutcome })` (`lib/confidence.js`) — called from
`ChecklistItem` before logging, not from `handleLogSession` itself (it
needs the full chunk's `difficultyLabel` and the piece's `bpmZones` to
resolve `requiredReps`/the effective target, neither of which the handler
has from just a chunk id):
- `manualFail` (the UI's "needs more work" checkbox — the folded-in
  replacement for the old effectiveness input) always wins as `"fail"`.
- Zero clean reps is always `"fail"`.
- Required reps hit **and** at/above `practiceBPM` is `"pass"`.
- A repeat `"soft-miss"` right after the previous one (some reps, but not
  enough, twice in a row) escalates to `"fail"`.
- Anything else with at least one clean rep is `"soft-miss"`.

`sessionOutcome(session)` (`lib/confidence.js`) reads `session.outcome` if
present, or maps an old session's `effectiveness` value if not (`"low"` →
`"fail"`, `"high"` → `"pass"`, `"good"` → `"soft-miss"`) — the shared
read path `computeAutoConfidence`, `adaptiveReviewOffsets`, and
`computeComboEscalations` (see [Revival](#revival) below) all go through,
so history logged before this model shipped still contributes real
signal instead of reading as neutral.

`computeLadderAdvance(chunkLadderState, outcome, ladderConfig)`
(`lib/ladder.js`) — a pure function, called from `handleLogSession`
(`App.jsx`) on every logged session, implementing the Stabilizing →
Settling → Holding stages:
- **Full pass:** `practiceBPM` steps up (`ladderConfig.bpmSteps.pass`,
  default +2) — *unless* this session also clears the demonstrated-tempo
  override below, in which case `practiceBPM` jumps straight to the
  achieved bpm instead of stepping by +2. Counts toward graduation only
  once `practiceBPM` clears the current stage's tempo floor (Stabilizing
  has none; Settling/Holding gate on a fraction of `targetBPM`) — the
  floor gates progress, not the pass/fail judgment itself, and is
  evaluated against `practiceBPM` *before* this session's step/override.
  Graduating resets the pass counter and moves to the next stage (Holding
  has no ceiling — it just keeps accruing passes, which drives its own
  escalating tempo floor and interval growth, below).
  **Known gap, not yet fixed:** because the floor check runs against the
  *pre-session* `practiceBPM`, a session whose demonstrated-tempo jump
  would clearly clear the floor doesn't get credit toward graduation in
  that same call — e.g. `practiceBPM` jumping 50→100 against a 70 floor
  still evaluates the floor at 50 and fails it. Confirmed by direct
  reproduction, not just inferred. Not corrupting — the chunk graduates
  one session later than it should — but a real inconsistency between
  "demonstrated tempo replaces the baseline outright" and "that same
  session should also count toward graduation." See
  [Decisions.md](Decisions.md#spaced-repetition--maintenance).
- **Soft miss:** `practiceBPM` steps down (default −2), the pass counter
  resets, stage does not change — unless this session also clears the
  demonstrated-tempo override below, in which case `practiceBPM` still
  jumps up despite the overall miss (see rationale below).
- **Real fail:** `practiceBPM` steps down (default −2 — deliberately the
  same magnitude as the other two steps, not the steeper pullback an
  earlier design sketch had), demotes exactly one stage (never below
  Stabilizing), and — specifically for a *second consecutive* fail while
  still in Stabilizing — sets `needsRelearning: true` on the result. That
  flag is not read anywhere yet; see
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-ladder-three-stages).
- **Holding's review interval** starts at `startIntervalDays` (default
  14) and grows by the same 0.6×/1×/1.4× effectiveness multiplier
  [Adaptive review](#adaptive-review) uses, raised to the power of the
  accrued pass count — reused deliberately, not a second multiplier
  system. A "low" effectiveness pass can make the *next* interval
  shorter than the last one, on purpose: a technically-passing but shaky
  review is exactly when the next check-in should come sooner.
  `effectiveness` here is derived in `App.jsx` from the classified
  outcome (fail→low, pass→high, soft-miss→good), not collected as its
  own input.

`nextDueDate` is now load-bearing, not just computed and ignored: Pass 5 of
the maintenance-ladder build reads it directly to place each chunk's Tier 2
review in `computeTimeline` (see
[Timeline / scheduler](#timeline--scheduler) rule 4). `stage` and
`consecutivePasses` themselves are still not surfaced anywhere in the UI as
visible numbers — only their downstream effects are: `practiceBPM` (shown
as "Practice tempo" in `ChecklistItem`) and, indirectly, which day a review
lands on. A live "what's due" query that works *outside* the current plan's
bounded `daysToLearn` window is built as of Pass 8 — see
[What's due — the live maintenance query](#whats-due--the-live-maintenance-query)
below.

### Starting, suggested, and demonstrated tempo

There are three distinct tempo concepts feeding `practiceBPM`, not one —
an earlier version of this section conflated them into a single
system-computed "starting tempo" that got written straight into
`practiceBPM`, which is exactly the mistake this section now documents how
to avoid:

1. **Suggested starting tempo** — `getSuggestedStartingBPM(piece, chunk)`
   (`lib/confidence.js`). A pure system recommendation from the chunk's
   effective target BPM (`getDefaultTargetBPM`/`entry.targetBPM`) and
   `difficultyLabel` alone. **Guidance only** — surfaced to the learner
   (see below) but never written into `piece.progress` by anything.
   - Formula: `suggested = base_d * (target / 100) ^ k_d`, a per-difficulty
     diminishing-returns curve — `{ easy: {base: 75, k: 0.27}, medium:
     {base: 60, k: 0.18}, hard: {base: 45, k: 0.12} }`. Replaces an
     earlier flat-fraction formula (75%/65%/55% of target, at *every*
     target) that scaled linearly and got unreasonable at high targets —
     a 240 BPM "easy" chunk doesn't belong starting near 180. The
     power-law shape keeps the suggestion growing far slower than target
     as target increases (sub-linear, `k < 1`), while still landing on a
     round, sensible number right at a 100 BPM target where `k` has no
     effect (`base` itself). Hand-fit against four product-supplied
     calibration points, not derived from a study — same status as every
     other tunable constant in this codebase (see
     [Research.md](Research.md)):
     | target BPM | easy | medium | hard |
     |---|---|---|---|
     | 100 | 75 | 60 | 45 |
     | 140 | ~80–85 | ~60–70 | ~45–50 |
     | 180 | ~85–90 | ~65–70 | ~45–50 |
     | 240 | ~90–100 | ~65–75 | ~45–55 |
   - Modeled on, but distinct from, Revival's `tempoLadderStartFraction`
     idea (`computeTempoLadder`, `lib/revival.js`): that fraction paces a
     *return* to an already-learned piece; this one paces *first-time*
     ladder entry.
   - Surfaced in `ChecklistItem` two ways, both gated on **first
     encounter only** (no session ever logged for the chunk, i.e.
     `practiceBPM == null` and `entry.sessions` is empty) — every later
     session shows neither: as the "BPM achieved" field's placeholder,
     and as a one-line note ("Suggested starting tempo: N BPM — choose
     whatever tempo lets you play accurately and comfortably, slower is
     fine") that disappears the moment a real session exists.
2. **User-selected starting tempo** — whatever the learner actually logs
   the first time they touch a chunk, whether or not it matches the
   suggestion. `handleLogSession` (`App.jsx`) seeds `practiceBPM` from
   this — `prevEntry.practiceBPM != null ? prevEntry.practiceBPM : bpm` —
   never from `getSuggestedStartingBPM` directly. This is the real
   baseline every later floor/step/goal calculation reads, until superseded
   by (3). `practiceBPM` values seeded before this three-concept split
   existed, under the earlier conflated behavior, are left as-is — not
   backfilled — for the same reason given below (rewriting lived practice
   history is worse than leaving an old placeholder value in place).
3. **Demonstrated tempo** — `computeDemonstratedTempoBaseline` (`lib/ladder.js`),
   wired into `computeLadderAdvance`'s `pass` and `soft-miss` branches. A
   session with **3 or more clean reps at a bpm above the chunk's current
   `practiceBPM`** replaces the baseline outright with the achieved bpm
   (capped at `targetBPM`, same cap the normal step uses), instead of the
   usual incremental `ladderConfig.bpmSteps.pass` (+2) nudge. Applies on
   both `pass` and `soft-miss` outcomes (both log a real `cleanReps` count
   — a `soft-miss` can still genuinely demonstrate a higher tempo, e.g. a
   hard chunk needing 5 reps for a full pass but already showing 3 clean
   reps well above baseline) — never on `fail` (including a manual "needs
   more work" self-report or a repeat-soft-miss auto-fail), mirroring
   `classifySessionOutcome`'s own "manualFail always wins" precedent. The
   "3 perfect reps" threshold (`DEMONSTRATED_TEMPO_MIN_CLEAN_REPS`) is a
   fixed product-spec number, deliberately independent of
   `REQUIRED_REPS`'s per-difficulty pass threshold (3/4/5). **Confirmed with
   the user: "perfect rep" means "clean rep"** (`session.cleanReps`) — not a
   stricter, separate concept this codebase would need to introduce. See
   [Decisions.md](Decisions.md#spaced-repetition--maintenance).

All future goal calculations — the tempo floor a stage gates on
(`clearsStageFloor`), the next ratchet step, what `ChecklistItem` shows as
"Practice tempo" — read `practiceBPM` (concept 2, later superseded by
concept 3) and never concept 1. A suggestion the learner ignores has zero
effect on anything.

The first-4-passes tempo-gating exemption (Stabilizing has no tempo floor —
`ladderConfig.stabilizing.tempoFloorFraction: null`, `graduationPasses: 4`
— see the "Full pass" bullet above) predates this section and needed no
change here; it already means a chunk's first 4 graduating passes never
need to clear a tempo floor at all, regardless of which of the three tempo
concepts above set `practiceBPM`.

`handleLogSession` also appends sessions keyed by a precise `loggedAt`
timestamp rather than overwriting by plan-day — so logging the same chunk
twice in one day (e.g. an early touch, then a later re-attempt) produces
two distinct records instead of one silently replacing the other.

**Session undo (`handleUnlogSession`, `App.jsx`) fully reverses the ladder
— Pass 10, built.** Every session `handleLogSession` writes now also
carries a `session.ladderSnapshot`: the six ladder fields
(`stage`/`consecutivePasses`/`consecutiveStabilizingFails`/`practiceBPM`/
`nextDueDate`/`tier1Done`) exactly as they stood *immediately before* that
session — the same snapshot-and-restore shape `flagSnapshot` already used
for rough/lost flags (below), just never extended to session logging until
now. `handleUnlogSession` restores that snapshot when undoing a session,
**but only when the session being undone is the chunk's most recent
session overall** (`lastIdx === sessions.length - 1` against the *entire*
`sessions` array, not just the sessions on the `day` being undone —
working ahead and then going back to undo an earlier day's session is
correctly treated as non-latest). Restoring a snapshot rewinds to a moment
in time, so undoing a non-latest session would silently erase every later
session's effects too — out of scope by design (see
[Decisions.md](Decisions.md#spaced-repetition--maintenance)); it falls
back to removing the record only, same as a session logged before this
field existed (no snapshot to restore from) or a snapshot missing one of
the six fields (defensive, warns rather than partially restoring).
`ChecklistItem`'s undo control recomputes this same
latest-session-plus-valid-snapshot check client-side and shows distinct
copy/tooltips *before* the click ("Undo most recent log" vs. "Remove most
recent log") — the control never claims to reverse more than it actually
will.

A full reversal also clears a rough/lost `flag`/`flagSnapshot` if one was
applied on top of the undone session, so a flag doesn't outlive the ladder
state it was based on — `flagSnapshot` itself is documented in
[Data-Model.md](Data-Model.md#the-piece-object) and
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging);
see [Decisions.md](Decisions.md#spaced-repetition--maintenance) for how
this is proven safe (reusing the existing "a real session log always
clears `flagSnapshot`" invariant, not a new check).

**Known gap, not yet fixed:** a full undo does not revert `currentBPM` (the
"what was last actually played" display field, distinct from the ladder's
`practiceBPM`) — it's not one of the six snapshotted fields. After undoing
a chunk's only session, `computeAutoConfidence` can still read a stale,
nonzero `currentBPM` and produce a nonzero confidence score for a chunk
that otherwise looks fully untouched (`stage: null`, no sessions). Found in
review, not fixed; see
[Decisions.md](Decisions.md#spaced-repetition--maintenance).

`computeProgressTier(chunk, piece)` is a **separate, simpler** score from
confidence — see [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)
for why the two shouldn't be conflated. **As of Pass 6**, it buckets a
chunk into `untouched / learned / comfortable / mastered` off the
chunk's spaced-repetition ladder `stage`
([Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-ladder-three-stages)):
`holding` → mastered, `settling` → comfortable, anything else with at
least one logged session (`stabilizing`, or `null` from real pre-ladder
history) → learned, no sessions at all → untouched. Superseded the
original most-recently-logged-session clean-rep-count bucketing
(≥10 → mastered, ≥5 → comfortable) — see
[Decisions.md](Decisions.md#spaced-repetition--maintenance) for why: a
chunk demoted by a rough/lost flag ([Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging))
now drops a tier here too, through the same `stage` write every other
consumer reads, rather than needing its own separate check. It drives
the Overview tab's "Practice progress" bar and `PartSwitcher`'s
untouched-measure count for multi-movement works. **Defensive, not
silent**: a `stage` value outside the known set (`null`, `'stabilizing'`,
`'settling'`, `'holding'`) still falls through to "learned" rather than
crashing, but logs a `console.warn` first — found in self-review as a
silent-failure risk (a corrupted or future stage value would otherwise
misclassify with no trace).

## What's due — the live maintenance query

`computeDueReviews(piece, chunkSet, asOfDate)` (`lib/maintenance.js`,
Pass 8) is the query that finally *reads* the `nextDueDate` the ladder has
been writing since Pass 1. It walks `chunkSet.all`, keeps every chunk whose
`progress[id].nextDueDate` is on or before `asOfDate`, and returns them
sorted most-overdue-first (ties broken by measure order, so the list reads
front-to-back through the piece). Each item carries `chunkId`, `chunk`,
`dueDate`, `stage`, `daysOverdue` (0 on the day it comes due) and
`minutes` (the chunk's effort through `EFFORT_TO_MIN`, the same conversion
every other time estimate uses; `totalDueMinutes(items)` sums it).

**It is deliberately independent of `computeTimeline` and
`timeline.days[]`.** That's the whole point: `nextDueDate` is a real
calendar date, so this answers correctly for a piece whose plan ran out
weeks ago, which the bounded `days[]` array structurally cannot
([Timeline / scheduler](#timeline--scheduler) rule 4).

**Strictly "due as of `asOfDate`" — there is no forward-looking window.** A
chunk due tomorrow does not appear anywhere, and Master Agenda's date
picker does not turn into an upcoming-due view (it only computes due items
for the real today).

**Suppression** — returns `[]`, never null, for:

- a **paused or archived** piece, consistent with pause/archive already
  meaning "off my daily plate" for schedule pressure generally; and
- a piece with an **active revival** (`piece.revival.startedAt` set), since
  revival is already "something's wrong, working through it" mode and
  routine maintenance shown alongside it would compete for attention with
  no clear priority.

Both call sites (`MasterAgendaTab`, `TodayTab`) use this one function
rather than each running its own query — Master Agenda just renders less of
the same result. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance).

### Detecting that a piece has run past its plan

Both surfaces need to know "is this piece past its plan?" before they can
switch to the due list, and **`getCurrentDay` cannot answer it** — it
`clamp`s to `[1, totalDays]`, so a 10-day plan that started three months
ago still reports day 10.

`elapsedDay(piece)` (`lib/utils.js`) is the unclamped form: the same
day-1-is-`startDate` arithmetic, floored at 1 (so a future `startDate`
reads as "day 1, not started" rather than a negative day) but with no
upper bound. Both surfaces call it and compare against
`timeline.days.length`. **`getCurrentDay` is now derived from it**
(`clamp(elapsedDay(piece), 1, totalDays)`) rather than repeating the date
arithmetic, so the clamped and unclamped forms cannot drift apart.

This clamp is also why Master Agenda's pre-Pass-8 `dayNumber >
timeline.days.length` guard **never fired for today**: a piece past its
plan silently re-rendered its last scheduled day, every day, indefinitely.
Fixing the detection fixed that too.

**All day counting goes through `daysBetweenInclusive`** — `elapsedDay`
calls it rather than doing its own arithmetic. This is load-bearing, not
tidiness. It previously floored the millisecond gap between two *local*
midnights, which undercounts by a day across a DST boundary (a
spring-forward day is 23 hours, so `n × 24 − 1` floors to `n − 1`) and
stayed wrong for the whole ~8 months between transitions.

That mattered because `computeTimeline` converts `nextDueDate` to a plan
day with `daysBetweenInclusive` (`Math.round`) — so the app ran **two
different day-numbering conventions at once**, disagreeing by one for any
piece started before the spring transition. Because both numbers advance
together each day, a review genuinely due today was placed permanently one
day ahead and never arrived: the app showed "Day 191 of 250 — Nothing
scheduled" while the review due that day sat on day 192. One shared
counting function is what keeps "what day is it" and "what day is this
date" in agreement.

> **Stored day numbers were not migrated.** `doneDays` and `sessions[].day`
> were recorded under the old counting and now sit one behind for affected
> pieces. `computeScheduleStatus` tests `doneDays.length > 0` rather than
> day equality, so behind-schedule detection is unaffected;
> `computeAutoConfidence`'s recency term reads one day staler (negligible).
> The one visible artifact is a session logged *today, before the fix
> landed* losing its checkmark. See
> [Decisions.md](Decisions.md#spaced-repetition--maintenance).

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

**Invariant: everything coming back from that nested call is numbered from
1 and must be re-based to `asOfDay` before it's merged.** The sub-plan is a
complete plan in its own right — its day 1 *is* `asOfDay` — so both
`days[].dayNumber` and `introducedDay` need the same `asOfDay - 1` offset.
Chunks that aren't in the remainder (already practiced) keep their original
introduction day untouched.

This was a real bug, not a hypothetical: `introducedDay` was merged
un-shifted while `days[]` was re-based correctly, so every rescheduled
chunk reported an introduction day of 1, 2, 3… against a `currentDay` of
`asOfDay` or later. `computeScheduleStatus` counts a chunk as behind when
`introducedDay[id] < currentDay`, so **every rescheduled chunk stayed
"behind schedule" forever and the banner never cleared** — making the
Reschedule button appear to do nothing, even though the marker saved
correctly and the plan really had been rebalanced. `computeScheduleStatus`
is the only external reader of `introducedDay`, which is why the symptom
was confined to that banner.

The feasibility check shown in the reschedule confirmation dialog
(`handleReschedule` in the `App` component, not part of `getEffectiveTimeline`
itself) estimates required vs. available days using `EFFORT_TO_MIN` and the
0.65 efficiency constant — see [Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about).

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
a combo relearns through its underlying content, which is already in this
list as ordinary practice chunks), sorted flagged-first (rough or lost —
`progress[id].flag`, as of Pass 6; was `weakSpot` before) then
lowest-confidence-first, greedily packed into days against
`piece.minutesPerDay` using each item's existing `effort` and
`EFFORT_TO_MIN`. This stays a fixed list, generated once and never mutated
afterward — turned out not to need dynamic/outcome-dependent restructuring
after all, contrary to what an earlier draft of this design expected. What
combos DO get is handled by a separate function sitting alongside this
one, not inside it:

`computeComboEscalations(piece, chunkSet)` and its helper
`findComboUnderlyingChunks(combo, practiceChunks)` (also `lib/revival.js`)
compute, live, which combos should currently show up as their own
explicit task — a combo whose anchor chunk or an overlapping neighbor
(found via `rangesOverlap` against the combo's `start`/`end`, since
`combo.linkedIds` only stores the anchor) has logged a real fail since
`piece.revival.startedAt`. This is a pure derivation off `piece.progress`,
recomputed on every render (same pattern as `chunkSet`/`timeline`) rather
than a task written into and later cleared from `revival.plan` — which is
exactly what let `computeRevivalPlan` above stay static. `RevivalTab`
renders any escalated combos as a separate "Needs another look" panel, not
folded into the day-by-day list. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance) and
[Repertoire-Lifecycle.md#revival-auto-triggers](Repertoire-Lifecycle.md#revival-auto-triggers)
for the design and decision record.

**`computeRevivalPlan` is deliberately a distinct, simpler function, not
an adaptation of `computeTimeline`.** `computeTimeline`'s defining
behaviors —
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
[Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about) generally for why this
codebase avoids parallel data model concepts.

Reassessment itself does not have a dedicated compute function — it *is*
`progress[id].manualConfidence`, set through `PieceMapTab`'s existing
confidence-override UI (extended with `CONFIDENCE_PRESETS`, a 5-button fast
path over the same 0-100 field, plus a `sequentialMode` Prev/Next/Finish
flow so the same grid-and-modal component can be stepped through
chunk-by-chunk instead of reopened per cell). See
[Decisions.md](Decisions.md#revival) for why this reuses `manualConfidence`
rather than introducing a separate scale.

### Revival auto-triggers (Pass 7)

`computeRevivalTriggers(piece, chunkSet)` (`lib/revival.js`) is what
`OverviewTab` calls to decide whether to surface the "This piece might be
due for a revival" banner. It checks three independent conditions — see
[Repertoire-Lifecycle.md#revival-auto-triggers](Repertoire-Lifecycle.md#revival-auto-triggers)
for the full design and [Decisions.md](Decisions.md#spaced-repetition--maintenance)
for why they're three separately-checked conditions rather than one
formula — and returns `{ triggered, reasons }`, where `reasons` is every
condition that independently fired (not just the first), each as
`{ key, label }` for direct display:

1. **Stop count > 5 on a single logged run-through** — reads
   `progress["__consolidation__"].sessions`, the synthetic run-through log
   Pass 6 added (`handleLogRunThrough`, `App.jsx`).
2. **A combo, or 2+ regular practice chunks, currently flagged `'lost'`** —
   reads the live `progress[id].flag` state across `chunkSet.combos` and
   `chunkSet.practiceChunks` (Pass 6's rough/lost flag). This is a
   current-state check, not a per-run-through log, so it reflects whatever
   is flagged lost right now, however that flag got set. A transition
   flagged lost does not count toward either half of this condition — only
   practice chunks and combos are "regular"/"large" chunks by this
   condition's definition.
3. **60+ days since anything was logged on the piece at all** — reads
   `piece.lastLoggedAt`, a real calendar date (`daysBetweenInclusive`
   against `todayISODate()`), not a plan-day number, since a stale piece
   may be well past its plan's bounded day range. If `lastLoggedAt` is
   `null` (nothing has ever been logged), this condition does not fire —
   it's a fallback for a piece with real but aging activity, not a
   catch-all for a piece with zero data.

`piece.lastLoggedAt` itself is not stamped by this function — it comes
from `computeLastLoggedAt` (`lib/storage.js`), recomputed on every piece
load as the max `loggedDate` across every progress entry's `sessions`,
**including** `"__consolidation__"`'s run-through sessions. Excluding them
was a real bug fixed alongside this pass: before the fix, a piece
practiced only via full run-throughs (no individual chunk sessions) would
have `lastLoggedAt` silently stuck at `null` (or a stale pre-run-through
date) on every reload, since the pre-fix version explicitly skipped that
key when scanning for the most recent session — making condition 3 above
either never fire or fire on stale information for exactly the pieces most
likely to be revival candidates via condition 1. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance) for the fuller
account.

The banner itself is suppressed whenever `piece.revival.active` is
already true — `OverviewTab` already shows "Continue revival" in that
state, so there's nothing to additionally suggest.
