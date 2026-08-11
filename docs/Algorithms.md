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
     this bounded view at all — surfacing it is a live "what's due" query
     that doesn't exist yet (Repertoire-Lifecycle.md's "Explicitly not
     designed/built here").
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
etc., `piece.ladderConfig`). Design: [Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built](Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built).
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
  default +2); counts toward graduation only once `practiceBPM` clears
  the current stage's tempo floor (Stabilizing has none; Settling/Holding
  gate on a fraction of `targetBPM`) — the floor gates progress, not the
  pass/fail judgment itself. Graduating resets the pass counter and moves
  to the next stage (Holding has no ceiling — it just keeps accruing
  passes, which drives its own escalating tempo floor and interval
  growth, below).
- **Soft miss:** `practiceBPM` steps down (default −2), the pass counter
  resets, stage does not change.
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
bounded `daysToLearn` window is a separate, not-yet-built piece of this
design — see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built).

`handleLogSession` also seeds `practiceBPM` from whatever tempo was first
attempted, the first time a chunk is logged (since there's no designed
ladder-entry/Tier-1 mechanic yet to do this deliberately), and appends
sessions keyed by a precise `loggedAt` timestamp rather than overwriting
by plan-day — so logging the same chunk twice in one day (e.g. an early
touch, then a later re-attempt) produces two distinct records instead of
one silently replacing the other. `handleUnlogSession` removes only the
most recently logged session for a day, not every session that day, and
does not roll back the ladder state that session's outcome already
advanced (same "no undo history" spirit as BPM zones and difficulty
reassessment — see [Data-Model.md](Data-Model.md#known-simplifications)).

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
