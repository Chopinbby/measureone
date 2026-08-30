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
`SectionRunThroughPanel`. A single-section run-through and a section-pair
run-through are gated by two genuinely different mechanisms (Pass 49) — see
the two subsections below.

### Single-section run-throughs: a repeating gate, not a one-time unlock

**As of Pass 49, a single-section run-through (`kind: "section-runthrough"`)
does not just unlock once and stay available.** It goes due → not due → due
again as the section's slowest-progressing chunk picks up more sessions,
computed fresh on every call from live session counts — no persisted state,
same pattern as everything else scheduling-related in this codebase.

`sectionRunThroughGate(section, piece, bySectionId)` (`lib/chunking.js`) is
the gate itself, returning `{ minCount, due, lockedPreview }`:

- **The gating metric** is each assigned chunk's count of *confirmed,
  logged* sessions — `loggedSessions(sessions).length` (`lib/utils.js`),
  not raw `sessions.length`. A skipped Interleaved attempt or an
  unconfirmed provisional one is stored in the same array
  (`handleLogSession`, `App.jsx`) but isn't a completed rep, so it must not
  advance a chunk toward unlocking or re-unlocking a run-through — fixed
  after initial review caught that the first cut of this gate used raw
  `sessions.length`, the same way `isSectionLearned` still does, and so
  counted skips/provisionals too. This is a **deliberate divergence** from
  `isSectionLearned` (unchanged, still raw `sessions.length`, out of scope
  for this fix): a chunk touched only via a skip or an unconfirmed
  provisional can read as "learned" (Overview's stat) while contributing 0
  toward this gate — "has this chunk been touched at all" and "how many
  real reps does this chunk have" are different questions, so the two
  functions are allowed to disagree. The section's own count, `minCount`,
  is the **minimum across its chunks** — the run-through is a play-through
  of the *whole* section, so it's only meaningful once every included chunk
  has actually reached that count; the slowest chunk sets the pace for the
  whole section, not an average or the fastest chunk.
- **Threshold sequence: 1, 3, 5, 7, ...** — first unlock at 1 (matches the
  pre-Pass-49 condition exactly, so nothing changed about *when a section
  first becomes eligible*), then a flat "+2" step forever. This is exactly
  the odd positive integers, so `due` reduces to a parity check —
  `minCount % 2 === 1` — rather than needing an explicit threshold list or
  any memory of which thresholds were already consumed. One consequence
  worth internalizing: logging the run-through itself does **not** advance
  `minCount` (it writes to the synthetic `sr_<sectionId>` progress key, not
  to any practice chunk's `sessions`), so a section can sit due
  indefinitely if its chunks aren't practiced again — there is no
  "complete it to dismiss it" interaction, only "the underlying chunks
  advance past it."
- **`lockedPreview`** covers the day before a new threshold is crossed:
  every chunk except a single slowest one has already reached the upcoming
  threshold, so that one chunk's next logged session is what crosses the
  whole section into being newly due. This requires the minimum to be held
  **uniquely** by one chunk — if two or more chunks tie for slowest, a
  session on just one of them can't cross the section yet (the other still
  holds it back), so there is no single "next session" to preview.
  `lockedPreview` and `due` are mutually exclusive by construction (the
  parity check only runs on the `!due` branch).

`computeSectionRunThroughs` includes a single-section entry whenever
`gate.due || gate.lockedPreview`, carrying a `locked: gate.lockedPreview`
field `SectionRunThroughPanel` reads to pick one of two render branches: a
normal, loggable `ChecklistItem` when due, or a grayed/disabled preview row
(a small component local to that file, not `ChecklistItem` itself) when
locked — styled off the same `disabled`-state CSS classes `ChecklistItem`
already uses for its own checkbox and "Log practice" button before required
input is filled in, so a locked task reads as a preview of the same kind of
row rather than a visually distinct one. When neither `due` nor
`lockedPreview` holds, the section contributes nothing to the list at all —
this is what makes the panel now read as a real, appearing/disappearing day
task instead of a permanently-available option sitting in the background
once unlocked, which was the pre-Pass-49 behavior this replaced.

### Section-pair run-throughs: still a one-time unlock

A combined section-pair run-through (`kind: "section-transition"`) between
two adjacent, already-learned sections unlocks only once **every practice
chunk in the entire piece** has at least one logged session — deliberately
a later-stage drill, not an early one, per the code comment at the top of
the function — and, once unlocked, **stays available**, unlike the
repeating gate above. This is the original, pre-Pass-49 mechanism, left
untouched: `computeSectionRunThroughs` still gates it on
`allChunksPracticed` (every chunk in the whole piece) plus `isSectionLearned`
on both neighboring sections (the plain ">= 1 session per chunk" check,
unaffected by `sectionRunThroughGate`), the same way it always has.

**Open question, deliberately not resolved by Pass 49:** whether section-pair
run-throughs should get the same repeating threshold once they first
unlock, or whether staying a one-time "unlock and forget" drill is actually
right for them (arguably more defensible here — they're already a
late-stage, whole-piece-touched drill, not an early check-in). Flagged for a
product decision rather than guessed at — recorded in
[Decisions.md](Decisions.md#open-questions), which whichever future pass
resolves this should update alongside the actual change.

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
   effort** across that first-half window, not greedily packed to
   `minutesPerDay` and moved on. Greedy packing tends to finish early and
   cram most of the piece into just the first few days, which then piles up
   all of *those* chunks' transitions and spaced reviews onto the same
   handful of later days too — spreading the introduction itself is what
   actually prevents that pile-up, while still guaranteeing full coverage
   by `halfPoint`.
   - **Cumulative-boundary assignment, not a per-day-reset accumulator.**
     Each front day owns an equal proportional slice of the piece's total
     new-chunk effort (`totalNewEffort * (dayIndex + 1) / numFrontDays`),
     and a chunk is assigned to whichever slice it falls into by where it
     *starts* — its running total *before* being added, walked forward with
     a running total that's never reset per day. The chunk's start (not its
     midpoint) is what's compared against each boundary: the running total
     is 0 before the very first chunk, which is always less than a positive
     boundary, so day one always gets at least the first chunk regardless
     of how large a single chunk's effort is relative to the per-day slice.
   - **Past bug, fixed:** an earlier version reset an accumulator to 0 at
     each day advance and capped `dayIdx` at the last front day once it got
     there. That gave it no way to correct for its own drift — any chunk
     that didn't evenly divide into a day's target just kept accumulating,
     and once the last front day was reached it couldn't advance further,
     so *all* remaining drift piled onto that one day alone (observed
     concretely: 10 equal-effort chunks across 8 front days landed 7 days
     with 1 chunk each and the 8th with 3). Anchoring each day's boundary to
     the whole remaining total, rather than to however much the previous
     day happened to absorb, is what actually prevents that pile-up. A
     midpoint-based first draft of this fix traded that bug for a different
     one — a single large chunk's midpoint could exceed day one's boundary
     and leave day one with nothing introduced at all — which is why the
     comparison uses each chunk's start, not its midpoint. **If overflow
     starts piling onto the last front day again, or day one goes empty
     despite there being material and days available, one of these two
     regressions is back.** Regression tests for both:
     `test/scheduling.test.mjs`, describe block "new-chunk introduction
     spreads overflow evenly, not onto the last front day". See
     [Decisions.md](Decisions.md#scheduling).
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
touches, each priced the same as introducing the chunk fresh —
`c.effort * REVIEW_TOUCHES_PER_ITEM`, `REVIEW_TOUCHES_PER_ITEM = 2`) —
omitting that would under-count what a day actually costs once
`computeTimeline`'s spaced review lands on top of introduction, and the day
count would come out "technically sufficient" for introduction alone while
still running well over budget in practice. **Each touch was priced at a
flat 3 minutes, regardless of the chunk's own difficulty, before a
same-session follow-up to Pass 66** — found while wiring that pass's live
due-review merge into a plan day's own minutes total and discovered to
disagree with `computeDueReviews`, which already priced a review at
`chunk.effort * EFFORT_TO_MIN`; underestimating a hard chunk's review cost
here specifically risked a `scheduleMode: "minutes"` plan under-provisioning
days for exactly the material most likely to need real review time. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance) for the full
before/after. **The "2 touches" figure was 4
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
matches — see the floor exception below). `ScheduleFields` already
performed this same derivation live, as
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

**Floor exception (added for the reschedule "extend the plan" feature —
see [Rescheduling](#rescheduling) below):** the recomputed value is never
allowed to shrink `daysToLearn` below whatever it already is *while
`piece.rescheduleMarker` is set*. Without this, a reschedule that
deliberately extends `daysToLearn` past what a from-scratch recompute
would give (to make up for days that already elapsed without practice,
which the from-scratch formula has no way to know about) would get
silently reverted the very next time the piece loads — this was a real
bug, not a hypothetical, found on critical review: the extension worked
immediately in-session and vanished on reload. The floor is a genuine
no-op whenever there's no active marker, or the marker's present but
`daysToLearn` was never actually pushed past the recomputed value (the
ordinary, non-extending reschedule path) — it only ever matters for a
piece mid-extension. It also stops mattering the moment the piece is next
saved from Settings, since that already clears `rescheduleMarker`.

## Import merge

`mergeImportedPiece(existing, imported, ladderChoice = "existing")`
(`lib/storage.js`) merges a freshly-imported piece into the existing piece
`findMatchingPiece` matched it to. Most fields follow
`preferPresent`/`preferByRecency` (below); a few are handled separately and
documented at their own field in
[Data-Model.md](Data-Model.md#the-piece-object) — `progress` (per-chunk,
per-session merge, see below), `sections`/`recordings`/`bpmZones`
(additive by id, `mergeById`), `revival` (an active revival always wins over
whatever the import has), and `id`/`createdAt` (never touched by a merge —
the piece already exists).

`preferByRecency(importedVal, existingVal, importIsStale)` governs
`piece.status`, and — inside `mergeProgress` — a chunk's
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
than it actually is on a later comparison. Note `preferByRecency` treats
"import is strictly newer" the same as "tied" — both take the *not-stale*
branch, so on an exact `updatedAt` tie these three fields silently prefer the
import. That's a different tie-breaking rule than ladder state uses (below),
carried over unchanged from before Pass 13 — see
[Decisions.md](Decisions.md#data-model) for why this inconsistency was
found and deliberately left alone rather than fixed as a drive-by.

**A chunk's *ladder* state — `stage`, `consecutivePasses`,
`consecutiveStabilizingFails`, `practiceBPM`, `nextDueDate`, `tier1Done` — is
resolved separately, wholesale per piece, via `diffImportedPiece(existing,
imported)` (Pass 13; previously this always kept the existing piece's value
unconditionally — see [Decisions.md](Decisions.md#data-model) for that
history).** `diffImportedPiece` compares `updatedAt` first — exactly the
same `existingUpdatedAt`/`importedUpdatedAt` values `mergeImportedPiece`
itself computes, but strict on both sides rather than folding a tie into
"not stale": whichever side is *strictly* newer wins outright
(`{ hasDivergence: false, resolution: "existing" | "imported" }`), no
further input needed. Only when the two are exactly tied (including both
missing `updatedAt` entirely) does it check whether the two sides'
ladder-state fields actually disagree on any chunk **both** have progress on
(`__consolidation__` excluded, `null`/`undefined` on a field treated as
equivalent). If they do, it reports real divergence
(`{ hasDivergence: true, resolution: null }`) instead of guessing.
`ImportPiecesModal` surfaces a per-piece "keep what's here" / "use the
imported version" picker exactly when `hasDivergence` is true (defaulting to
"existing" until the user picks); `App.jsx`'s `handleConfirmImport`
re-derives the diff at confirm time — same "re-check against current state,
don't trust the modal's opening snapshot" pattern `findMatchingPiece` already
uses — and passes the resolved side into `mergeImportedPiece`'s
`ladderChoice` parameter. Inside `mergeProgress`, that parameter picks one
side's ladder-state fields *wholesale* for every overlapping chunk in the
piece (not a per-field or per-chunk merge — see
[Decisions.md](Decisions.md#data-model) for why per-chunk granularity was
deliberately not built) — `doneDays`/`sessions` still merge additively
underneath regardless of which side "wins" the ladder fields, so practice
history itself is never at risk either way.

What this fixes, concretely: a plain older backup (the common case —
re-importing your own earlier export, or accidentally re-importing an old
file) can no longer silently revert `status` (e.g. un-pausing/un-archiving a
piece), a recently-logged `currentBPM`/`manualConfidence`, or ladder state,
with no warning in any direction — and restoring a *genuinely more-advanced*
backup (e.g. from a second device) no longer silently loses that advanced
ladder state to the "existing always wins" rule the way it used to.

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
"did you touch it" — it's reps-quality-weighted, and (Pass 29) it's also
not "every record in `sessions`": it reads through `lib/utils.js`'s
`loggedSessions(sessions)` (`!s.skipped`) rather than the raw array, so a
skipped session — Interleaved mode's "skip, just save time" action,
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29)
— contributes nothing here: no rep-quality term, and critically it can't
become the "most recent session" the last-outcome multiplier below reads,
which would otherwise mute that multiplier (a skip has no
`outcome`/`effectiveness`, so `sessionOutcome` returns `null` for it) even
though nothing about the chunk's actual mastery changed. The same helper
gates `computeProgressTier`, `formatLadderStatus`'s history check, and the
Progress tab's consistency/tempo-trend/outcome-breakdown stats — anywhere
`sessions` is read as evidence of judged practice, not just here.

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
`progress[chunkId].manualConfidence` is set. After that (manual or auto), two
independent caps can pull the result down further, combined via `Math.min`
of whichever apply (a chunk could in principle carry both at once):
a rough/lost `progress[chunkId].flag` — set from the Piece Map's post-run-through
flag cycle, [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)
— caps at `Math.min(score, 55)` for rough, `Math.min(score, 20)` for lost;
and `progress[chunkId].needsRelearning` (Pass 11) caps at `Math.min(score, 20)`,
the same value as `lost` since it's the same underlying ladder state
(forced to Stabilizing) reached a different way — see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built).
Both caps apply even on top of a manual override, so a stale "I know
better than the algorithm" value from before the flag landed can't hide
it. Every caller of `computeConfidence` (Overview, Progress — including
its confidence-by-difficulty bars, folded in from the former Analytics tab
in Pass 20 — Piece Map, the Today checklist, `FocusPanel`) gets this for
free, since none of them compute confidence independently — this is deliberately a cap
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

### Tempo-climbing nudge (Pass 30)

`hasClimbingTempo(entry)` (`lib/confidence.js`) is a pure, stateless
predicate — true when a chunk's most recent *judged* sessions
(`loggedSessions(entry.sessions)`, same helper `computeAutoConfidence`
above uses to exclude a skipped or still-open provisional session — Pass
29/29-follow-up) show a monotonic-ish rising BPM trend. It takes `entry`
directly (`piece.progress[chunk.id]`), the same shape `formatLadderStatus`
takes, rather than `(chunk, piece, currentDay)` — nothing here needs the
chunk's own fields or a target to compare against, only session history.

Three tunable constants sit above it in the file (`CLIMBING_TEMPO_WINDOW =
4`, `CLIMBING_TEMPO_MIN_SESSIONS = 3`, `CLIMBING_TEMPO_MIN_RISE_BPM = 4`),
hand-picked the same way every other constant of this kind in this file is
(see `docs/Research.md`'s inventory — this one isn't added there yet; not
in this pass's Touches list, see the pass summary rather than treating the
omission as settled). The check itself, over the trailing `WINDOW`
sessions with a numeric `bpm`:

1. Fewer than `MIN_SESSIONS` such sessions → false. Two points can't show
   a trend the way three-plus in a row can.
2. Any consecutive pair where BPM *drops* → false outright. This is where
   "monotonic-ish" stops short of "strictly monotonic": a same-BPM repeat
   in the middle of an otherwise-rising run doesn't break it (real
   practice rarely climbs on every single session), but an actual dip
   does.
3. The window's last BPM minus its first must be `>= MIN_RISE_BPM` → a
   flat run (non-decreasing, but not rising) correctly reads as *not*
   climbing; a monotonic-but-negligible rise (e.g. +1 BPM twice) does too.

**Notification model, decided before writing any code (per the pass's own
instruction to resolve this first):** a live-derived marker, not a
dismissible toast — same pattern `progress[id].flag` and
`progress[id].needsRelearning` already use for the Piece Map's tile icons.
No new persisted field: the marker (`PieceMapTab`'s tile grid, an inline
`TrendingUp` icon next to the confidence percentage — same slot the
"manual override" pencil mark already occupies) and the chunk-detail
modal's suggestion line both call `hasClimbingTempo` fresh on every
render, so they appear exactly while the trend holds and disappear the
moment it doesn't. Chosen over a one-time toast because the underlying
condition is inherently transient — a dismissed toast could go stale
(trend ends, dismissal lingers meaninglessly) or never resurface (trend
restarts after being dismissed once), and a persisted "seen" flag adds
real schema surface for a case the existing marker pattern already
handles cleanly with none.

**Placement note:** the Piece Map tile already uses all four corner slots
(`map-cell-diff-dot` top-right, `map-cell-recurring` bottom-right,
`map-cell-flag` bottom-left, `map-cell-relearning` top-left) — there was no
fifth open corner to give this marker the same `position: absolute`
treatment those four use. It's inline instead, in the same flow position
the existing manual-override pencil mark already occupies (right after the
confidence percentage) — same small-icon-plus-title visual language, just
not literally a corner badge. Worth a look if a future pass wants the tile
markers rationalized into one consistent placement system rather than
"whichever slot was free when each one was added."

The marker is two icons, not one (follow-up, same pass): a `Metronome`
icon sits beside the `TrendingUp` arrow, in both the tile marker and the
modal line, disambiguating what's climbing (tempo specifically, not
confidence or anything else the arrow alone could imply). Briefly stood in
as `Gauge` (a speedometer dial — the closest available metaphor at the
time) because `lucide-react` didn't yet expose a real `Metronome` icon at
the version this project had installed (`^0.383.0`); lucide added one in
`0.575.0`, so the dependency was bumped to `^0.577.0` (the latest 0.x
release — deliberately not the 1.x line, to pick up the new icon without
also taking on an unrelated major-version bump) and the placeholder
swapped for the real icon. Verified via `npx vite build` that every other
`lucide-react` import already used across the app (32 distinct icons)
still resolved after the bump, not just this one.

The modal's suggestion (`selectedClimbing` in `PieceMapTab`) shows a
target range of `currentBPM + 15` to `currentBPM + 30`, reading
`entry.currentBPM` directly — the same field the "Current BPM" input right
above it edits, not a separate computation. A second, fixed line of
caution sits underneath it — "Only try it at this speed a couple times.
Extensive practice at BPM higher than you can play accurately will hurt
your progress." — reworded (follow-up, same pass) from an earlier draft
that repeated "once or twice" verbatim from the suggestion line right
above it; not conditioned on anything beyond the marker itself. This is a
**suggestion overlay only**: nothing here reads into or writes
`practiceBPM`, `computeLadderAdvance`, or any other ladder field — a chunk
with a climbing trend is scored and advanced exactly as it would be
without this function existing at all.

## Session outcomes & the maintenance ladder

Data shapes: [Data-Model.md](Data-Model.md#the-piece-object) (`ChunkProgress.stage`
etc., `piece.ladderConfig`). Design: [Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built).
Replaces the old flat pass/fail and free-standing "how did it feel"
self-report with an objective three-tier judgment, and advances a
per-chunk spaced-repetition ladder on every logged session — with one
exception (Pass 29 follow-up): a soft-miss/fail classified during
Interleaved mode is deferred, not applied on the spot. `classifySessionOutcome`
itself is unchanged and still runs immediately (InterleavePanel needs the
resulting outcome to decide whether to defer at all); what's deferred is
only the write to `piece.progress[id]`'s ladder fields —
`handleLogSession`'s `provisional: true` branch saves the classified
outcome without calling `computeLadderAdvance`, and
`handleConfirmProvisionalSession` calls it later, on demand. See
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29)
for the full mechanism and why.

`classifySessionOutcome({ cleanReps, bpm, requiredReps, practiceBPM,
manualFail, previousOutcome, previousCleanReps })` (`lib/confidence.js`) —
called from `ChecklistItem` before logging, not from `handleLogSession`
itself (it needs the full chunk's `difficultyLabel` and the piece's
`bpmZones` to resolve `requiredReps`/the effective target, neither of
which the handler has from just a chunk id):

`requiredReps` itself is resolved by `resolveRequiredReps(chunk, stage,
holdingReviewCount)` (`lib/confidence.js`, Pass 27; `stage`/
`holdingReviewCount` added Pass 61, both optional — see
[Holding's periodic harder check](#holdings-periodic-harder-check-pass-61)
below) — normally `REQUIRED_REPS[chunk.difficultyLabel]`
(3/4/5), but a flat **2** for `chunk.kind === "section-runthrough"` or
`"section-transition"` (a whole section, or two combined sections, played
straight through), regardless of difficulty label. A run-through's
`difficultyLabel` is a *weighted average* across its whole span
(`computeSectionRunThroughs`, `lib/chunking.js`), so gating it through the
normal table would ask for *more* reps the longer/harder-averaging the
run-through gets — backwards for a drill whose difficulty is already the
span's length, not its rep count. Reps only; the tempo side
(`practiceBPM`/`clearsTempo`) is untouched for these chunks. The
whole-piece `"__consolidation__"` run-through (the plan's final "Full
run-through" day) never reaches `resolveRequiredReps` or
`classifySessionOutcome` at all — `handleLogRunThrough` (`App.jsx`) logs a
`stopCount` against a synthetic progress key, not `cleanReps`, and isn't a
real chunk object either.
- `manualFail` (the UI's "needs more work" checkbox — the folded-in
  replacement for the old effectiveness input) always wins as `"fail"`.
- Zero clean reps is always `"fail"`.
- Required reps hit **and** at/above `practiceBPM` is `"pass"`.
- A repeat `"soft-miss"` escalates to `"fail"` **only when both the
  current and the previous shortfall were reps-driven** (`cleanReps` below
  `requiredReps` in both sessions, checked via the new `previousCleanReps`
  param) — a tempo-only shortfall (required reps hit, just under
  `practiceBPM`) can never be the fail trigger, in either session of the
  pair, no matter how many times it repeats. Fixed a false-fail case in
  Pass 14: the original rule escalated off `previousOutcome`'s label alone,
  which couldn't distinguish a genuine reps shortfall from a learner who
  kept meeting required reps but logged a little under an already-adjusting
  `practiceBPM`. See [Decisions.md](Decisions.md#spaced-repetition--maintenance).
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
- **Full pass:** `practiceBPM` steps up by the gap-proportional tempo
  ratchet ([Tempo ratchet](#tempo-ratchet-pass-59) below; falls back to the
  flat `ladderConfig.bpmSteps.pass`, default +2, only when there's no
  `targetBPM` to be proportional against) — *unless* this session also
  clears the demonstrated-tempo override below, in which case `practiceBPM`
  jumps straight to the achieved bpm instead. Counts toward graduation only
  once `practiceBPM` clears the current stage's tempo floor (Stabilizing
  has none; Settling gates on a flat fraction of `targetBPM`; **Holding's
  own floor is retired as of Pass 61** — a Holding pass counts
  unconditionally, meeting the rep requirement already being enough on its
  own — see [Holding's periodic harder check](#holdings-periodic-harder-check-pass-61)
  below) — the floor gates progress, not the pass/fail judgment itself, and
  for Stabilizing/Settling is evaluated against `practiceBPM` *before* this
  session's step/override.
  Graduating resets the pass counter and moves to the next stage (Holding
  has no ceiling — it just keeps accruing passes, which drives its interval
  growth, below; **not** a tempo floor any more, as of Pass 61).
  **Known gap, re-reviewed in Pass 14 and deliberately left open (the
  user's explicit call):** because the floor check runs against the
  *pre-session* `practiceBPM`, a session whose demonstrated-tempo jump
  would clearly clear the floor doesn't get credit toward graduation in
  that same call — e.g. `practiceBPM` jumping 50→100 against a 70 floor
  still evaluates the floor at 50 and fails it. Confirmed by direct
  reproduction, not just inferred. Not corrupting — the chunk graduates
  one session later than it should, self-correcting on the next logged
  session — but a real inconsistency between "demonstrated tempo replaces
  the baseline outright" and "that same session should also count toward
  graduation." Reordering `computeLadderAdvance` to fix it was judged not
  worth the risk relative to the symptom; revisit if it actually shows up
  in real use. See [Decisions.md](Decisions.md#spaced-repetition--maintenance).
- **Soft miss:** as of Pass 59, `practiceBPM` steps **forward** (never
  backward, unlike the old flat `ladderConfig.bpmSteps.softMiss` default of
  −2, which only remains reachable with no `targetBPM` to ratchet against)
  at half the chunk's current tempo-ratchet rate ([Tempo
  ratchet](#tempo-ratchet-pass-59) below) — the pass counter still resets,
  and stage still does not change — unless this session also clears the
  demonstrated-tempo override below, in which case `practiceBPM` jumps up
  to the achieved bpm despite the overall miss (see rationale below).
- **Real fail:** `practiceBPM` resets to the recorded entry tempo for the
  stage this fail demotes INTO —
  `stabilizingEntryBPM`/`settlingEntryBPM`/`holdingEntryBPM`, whichever the
  new stage is (Pass 26 follow-up, reopening an earlier decision at the
  user's request; see [Decisions.md](Decisions.md#spaced-repetition--maintenance)
  for the three options presented and why this one needed new persisted
  state). Falls back to the flat −2 step (deliberately the same magnitude
  as a soft-miss, not the steeper pullback an earlier design sketch had)
  only when nothing's recorded for that stage yet — a chunk migrated in
  without this history, for instance. This covers the ordinary
  already-in-Stabilizing fail too, not just a fail that actually crosses
  stages: `demote("stabilizing")` returns `"stabilizing"` (no stage
  change), so the reset target is Stabilizing's own recorded entry tempo.
  A chunk's very first-ever session seeds `stabilizingEntryBPM` from
  whatever tempo the learner just chose — that session IS Stabilizing's
  first entry, nothing earlier to record. A graduating pass records the
  new stage's entry tempo the same way, so a later fail back down has a
  real value to reset to. This fail also demotes exactly one stage (never
  below Stabilizing), and — specifically for a *second consecutive* fail while
  still in Stabilizing — turns on `needsRelearning`. As of Pass 11 this is
  a **persisted, sticky boolean**, not just a per-call informational
  return value: `computeLadderAdvance` reads it back in via
  `chunkLadderState.needsRelearning` on every call, so once set it stays
  set across subsequent sessions until either 4 consecutive full passes
  graduate the chunk out of Stabilizing (the pass branch clears it
  automatically) or a manual override does (`handleClearRelearning`,
  `App.jsx`). The exact fail that turns it on also does two more things in
  the same call, only on that one transition — not reapplied on later
  fails while already flagged: `nextDueDate` pins to `outcome.asOfDate`
  (reusing `applyRunThroughFlag`'s `lost` pin-to-today semantics inline,
  since that function itself deliberately never touches
  `practiceBPM`/`consecutiveStabilizingFails`), and `practiceBPM` resets
  to the caller-supplied `chunkLadderState.suggestedStartingBPM`
  (`getSuggestedStartingBPM(piece, chunk)`, concept 1 below) instead of
  the entry-tempo reset described above, when that suggestion is
  available — this rule wins outright over the entry-tempo one, a
  stale/broken chunk getting flagged being a bigger, more deliberate reset
  than "go back to where this stage last was." A piece with no target BPM
  configured has nothing to suggest, so `computeLadderAdvance` falls back
  to the entry-tempo reset (or its own −2 fallback) in that case rather
  than resetting to nothing. As of Pass 59, a real fail also resets the
  chunk's `tempoRatchetK` back to `ladderConfig.tempoRatchet.k`, regardless
  of which of the three `practiceBPM`-reset paths above actually fired —
  see [Tempo ratchet](#tempo-ratchet-pass-59) below. While flagged,
  `computeTimeline` and `computeDueReviews` both
  skip the chunk outright — see
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built)
  for the full four-rule design and
  [Decisions.md](Decisions.md#spaced-repetition--maintenance) for why each
  rule landed where it did.
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

### Holding's periodic harder check (Pass 61)

Replaces Holding's old escalating tempo floor (`clearsStageFloor`'s Holding
branch now always returns `true` — Stabilizing/Settling below are
unchanged) with a rep-only mechanism: every 4th logged Holding review since
the chunk's most recent fresh entry into Holding needs one more clean rep
than the baseline requirement, reverting to baseline on every other review.

- **`progress[id].holdingReviewCount`** (`lib/ladder.js`) is the new
  persisted counter this reads. `nextHoldingReviewCount(stage, newStage,
  holdingReviewCount)` is the one rule all three `computeLadderAdvance`
  outcome branches (fail/soft-miss/pass) route through: resets to `0` the
  moment `newStage === "holding"` while the incoming `stage` wasn't (a
  fresh promotion — only reachable from Settling, since Holding has no
  ceiling to promote out of and no floor to fail out of without also
  leaving Holding); increments by 1 whenever the incoming `stage` already
  was `"holding"`, **regardless of outcome** — a fail counts too, even
  though it demotes the chunk out of Holding in the same call (the review
  that just happened was still logged while in Holding; the field simply
  stops being read once `stage` isn't `"holding"` and resets again on the
  next re-promotion, so this has no practical consequence either way);
  otherwise carried through unchanged (a chunk never touching Holding this
  call). Note this `0` is `computeLadderAdvance`'s own *point-of-use*
  resolution once a chunk is actually active in Holding — the *persisted*
  default for a chunk that's never touched Holding at all is `null`, not
  `0` (`storage.js`'s migration backfill, and both of `App.jsx`'s
  `ladderSnapshot` capture sites); a real fix, found and applied the same
  session — see [Decisions.md](Decisions.md#spaced-repetition--maintenance)
  for the false-import-conflict bug this avoids, the exact same class
  `tempoRatchetK` already had once.
- **`resolveRequiredReps(chunk, stage, holdingReviewCount)`**
  (`lib/confidence.js`) is where the count actually turns into a harder
  requirement for one specific session. Both new parameters are optional
  and default to "no bump" when omitted (`stage !== "holding"` short-circuits
  to the plain baseline) — this matters for backward compatibility:
  `computeAutoConfidence`'s own call site (below) is deliberately
  **unchanged**, still calling `resolveRequiredReps(chunk)` with no stage
  awareness at all, since that function scores *every past session*
  retrospectively and applying today's `holdingReviewCount` backward onto
  sessions logged before the chunk was ever in Holding would be wrong, not
  requested by this pass. `ChecklistItem`'s call site
  (`resolveRequiredReps(chunk, entry.stage, entry.holdingReviewCount)`)
  needed no new prop threaded in — `entry` (`piece.progress[chunk.id]`) was
  already in scope there, with both fields already on it.
- **The math:** `holdingReviewCount` as stored is the count of *prior*
  Holding reviews (0 before the chunk has ever had one), so the review
  about to be logged — the one `resolveRequiredReps` is being asked about,
  before it's actually logged — is `holdingReviewCount + 1`. When that
  number is a multiple of 4 (4, 8, 12, ...), the resolved requirement is
  `baseline + 1`; every other review resolves to plain `baseline`. Applies
  on top of whatever `resolveRequiredReps` already resolves as the
  baseline, including the flat 2-rep run-through override (Pass 27) — a
  run-through chunk's 4th Holding review needs 3, not 2.
- **Deliberately rep-only, not tempo-related at all.**
  `classifySessionOutcome`'s separate `clearsTempo` check (`bpm >=
  practiceBPM`, deciding whether a session counts as a pass in the first
  place) is completely untouched by this pass — the two mechanisms answer
  different questions (whether a session clears the tempo bar at all, vs.
  whether an already-classified pass counts toward Holding's interval
  growth), and only the latter changed here.
- **The old `ladderConfig.holding.tempoFloorStartFraction`/
  `tempoFloorStepFraction`/`tempoFloorCapFraction` fields are left in
  place, not removed** — `clearsStageFloor` simply no longer reads them for
  Holding. Flagged, not silently cleaned up: they're still part of the
  saved schema, and still directly exposed and editable — correctly
  labeled "Tempo floor, starting fraction" / "step per pass" / "cap
  fraction" — under `LadderConfigEditor`'s "Holding" heading. A user can
  find and "tune" a setting that now does nothing, with no indication
  anywhere in that UI that it's gone inert. See
  [Decisions.md](Decisions.md#spaced-repetition--maintenance) for the full
  discovery.

### Tempo ratchet (Pass 59)

Before this pass, a full pass or soft-miss stepped `practiceBPM` by a flat
`ladderConfig.bpmSteps` delta (+2 / −2) regardless of how far `practiceBPM`
actually was from `targetBPM` — a chunk 40 BPM below target crept up at the
same 2-BPM-per-session pace as one already 2 BPM away. `tempoRatchetStepSize`
(`lib/ladder.js`, not exported — internal to `computeLadderAdvance`) replaces
that flat delta on the **pass** and **soft-miss** branches only; the **fail**
branch's flat `bpmSteps.fail` step is untouched (see below for why).

```
gap  = targetBPM - practiceBPM
step = clamp(round(k * gap), 1, ladderConfig.tempoRatchet.kCapBpm)
```

- `k` is `progress[id].tempoRatchetK` — a new persisted per-chunk flat
  scalar field, alongside (not nested inside) `stage`/`practiceBPM`/the
  three `...EntryBPM` fields, so `storage.js`'s ladder-state diffing/merge
  (`ladderStateDiffers`/`mergeProgress`'s `LADDER_STATE_FIELDS`) compares it
  by `!==` the same way as every other flat ladder field. Defaults to
  `ladderConfig.tempoRatchet.k` (0.3) when absent — `computeLadderAdvance`
  itself resolves that at read time (`chunkLadderState.tempoRatchetK ??
  ladderConfig.tempoRatchet.k`), and `storage.js`'s
  `backfillProgressLadderState` backfills a chunk with none recorded to
  `null`, same as the entry-BPM fields, **not** to the literal default
  number. **Corrected after review, same session:** the first version of
  this backfill wrote the literal `0.3` instead, reasoning "there's no
  sane non-null default the way entry-BPM has" — true numerically, but it
  meant an untouched, migrated chunk carried a real `0.3` while a backup
  exported before this field existed had no `tempoRatchetK` key at all;
  `ladderStateDiffers`' `!==` comparison read that as a genuine
  disagreement and forced the import-conflict picker on an otherwise
  byte-identical re-import (reproduced directly, not theoretical — see
  [Decisions.md](Decisions.md#spaced-repetition--maintenance)). `null` on
  both sides avoids the false conflict the same way it already does for
  the entry-BPM fields.
- The 1-BPM floor (`max(..., 1)`) keeps a pass/soft-miss always moving
  `practiceBPM` forward by at least 1, even when `gap` is at or below zero
  (a chunk already at or past `targetBPM`) — it never *stalls* a session's
  worth of progress to zero, though `stepBPM`'s own existing
  cap-at-`targetBPM` can still flatten the net *result* back down to
  `targetBPM` regardless (see the overlearning bonus below for the one path
  that's allowed to exceed that cap).
- `ladderConfig.tempoRatchet.kCapBpm` (default 8) is the ceiling — without
  it, a chunk very far from target (e.g. `targetBPM` set well above a
  freshly-lowered `practiceBPM`) could take an implausibly large single-session
  jump.
- **No `targetBPM`** (a piece with nothing to be proportional against)
  falls back to the pre-existing flat `bpmSteps.pass`/`bpmSteps.softMiss`
  step exactly as before this pass — `tempoRatchetStepSize` returns `null`
  in that case rather than inventing a gap-based number from nothing, and
  the caller branches on that.

**Soft-miss now moves `practiceBPM` forward, not backward** — a genuine
behavior change from the flat `bpmSteps.softMiss` (default −2) it replaces.
Confirmed with the user: a soft-miss still isn't a full pass and shouldn't
progress the chunk at the normal rate, but penalizing tempo on a
soft-miss (as the old flat step did) fought against the ratchet's own logic
once the step became gap-proportional, so a soft-miss instead **halves
`tempoRatchetK`** before computing the step, applying the step at that
newly-halved rate — forward, just slower. The halved value is what
persists to `progress[id].tempoRatchetK`, so a *second* consecutive
soft-miss halves again (0.3 → 0.15 → 0.075 → …), asymptotically approaching
(but never reaching) the 1-BPM floor rather than ever reversing direction.

**k-recovery** reuses `consecutivePasses` rather than introducing a new
counter — `computeLadderAdvance` already resets that counter to 0 on every
soft-miss and demote, so two qualifying passes in a row (the same
floor-clearing count graduation itself uses, read as `passesIfCounted`
before graduation potentially zeroes it) is already directly observable as
that counter reaching 2 within the same stage. When it does,
`tempoRatchetK` is restored to `ladderConfig.tempoRatchet.k` outright — a
no-op if it was already at the default, a real recovery if a recent
soft-miss had halved it.

**A real fail resets `tempoRatchetK` to the default**, unconditionally,
alongside whichever of the three existing `practiceBPM`-reset paths fired
(the per-stage entry-tempo reset, rule 4's `suggestedStartingBPM` reset, or
the flat `bpmSteps.fail` fallback) — the fail branch's `practiceBPM` logic
itself is untouched by this pass; only `tempoRatchetK` is new state added
alongside it. There was no adaptive-rate state for a fail to touch before
this pass existed.

#### Overlearning bonus

When a full pass's logged `bpm` clearly beats what was actually asked for
that session (`outcome.bpm > practiceBPM` — not just meets it), the step
widens: `max(normalStep, round(0.5 * (outcome.bpm - practiceBPM)))`. The
**result** (`practiceBPM` after applying that widened step), not the bonus
amount itself, is capped at `1.15 * targetBPM` — computed and capped
separately from `stepBPM`'s own `Math.min(stepped, targetBPM)`, since this
bonus is deliberately the one path allowed to push `practiceBPM` *above*
`targetBPM` (rounded to a clean integer — `1.15 * targetBPM` is not always
a whole number, and raw JS float arithmetic can land a hair under the
intended cap, e.g. `1.15 * 100 === 114.99999999999999`). This bonus only
applies when there's a `targetBPM` to cap against, and only in the branch
where `computeDemonstratedTempoBaseline` (below) does **not** already
apply — that mechanism keeps taking priority exactly as it did before this
pass, including its own cap-at-`targetBPM` (never `1.15×`), so a
demonstrated-tempo override can never itself read as "overlearning."

`ChecklistItem` (`src/components/tabs/today/ChecklistItem.jsx`) surfaces an
"Overlearning" note whenever the chunk's current `practiceBPM` sits above
`targetBPM` — reading the persisted values directly rather than a flag
returned by `computeLadderAdvance`, since the bonus is the *only* path that
can produce that state (every other path — the flat step, the ratchet step,
and `computeDemonstratedTempoBaseline` — caps at `targetBPM`, never above
it), so the condition alone is an exact proxy for "the bonus fired and is
still in effect." It stops showing again the moment an ordinary
(non-overlearning) pass steps `practiceBPM` back down to `targetBPM` — see
the note in [Decisions.md](Decisions.md#spaced-repetition--maintenance) about that being an
accepted, deliberate consequence of the formula rather than something this
pass tries to prevent.

`ladderConfig.tempoRatchet = { k, kCapBpm }` joins `DEFAULT_LADDER_CONFIG`
and is merged field-by-field in `mergeLadderConfig` (`storage.js`), the
same way `bpmSteps` already is — so a piece with an existing `ladderConfig`
saved before this field existed doesn't crash on the next logged session.
No editing UI yet (same as `bpmSteps` before Pass 17's `LadderConfigEditor`
existed) — see [Decisions.md](Decisions.md#spaced-repetition--maintenance).

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

     This calibration only covers targets >= 100 BPM. Below a
     difficulty-dependent threshold (~70 BPM for easy, ~50 for medium —
     hard never crosses in practice since its `base` of 45 is already
     low), the curve's fixed `base` dominates `k`'s sub-linear falloff and
     the raw formula can equal or exceed target itself — found as a real
     bug (a 65 BPM easy-chunk target suggesting 67, i.e. "start faster
     than your goal tempo") once a piece with a target under 100 BPM was
     actually tried. `MIN_STARTING_TEMPO_BUFFER` (15) clamps the return
     value to `min(raw, target - 15)`, guaranteeing the suggestion always
     lands meaningfully under target regardless of how low target is. It
     only ever lowers the raw curve's output, never raises it, so the
     >=100 BPM calibration table above is unaffected (every value there
     already clears a 15 BPM gap on its own).
   - Modeled on, but distinct from, Revival's `tempoLadderStartFraction`
     idea (`computeTempoLadder`, `lib/revival.js`): that fraction paces a
     *return* to an already-learned piece; this one paces *first-time*
     ladder entry.
   - Surfaced in `ChecklistItem` as the "BPM achieved" field's placeholder
     only, gated on **first encounter** (no session ever logged for the
     chunk, i.e. `practiceBPM == null` and `entry.sessions` is empty) —
     every later session falls through to `practiceBPM` as the placeholder
     instead. A dedicated one-line note ("Suggested starting tempo: N
     BPM…") and the piece's own "Target tempo: N BPM" line used to sit
     next to the reps requirement on first encounter too, but both were
     removed: stated as prose right beside "Need N clean reps," they read
     as a tempo requirement on the very first attempt, when the actual
     requirement (`requirementText`, same first-encounter check) is
     explicitly reps-only — `classifySessionOutcome` treats a null
     `practiceBPM` as already-cleared, so no tempo is enforced yet either.
     The placeholder alone (ghost text in an empty input, not an assertion
     in prose) still nudges toward a sane starting point without reading
     as a rule.
   - As of Pass 11, `ChecklistItem` also resolves this value **unconditionally**
     (every render, not just first encounter) and threads it through
     `sessionInput.suggestedStartingBPM` on every `onLogSession` call — a
     second consumer beyond the first-encounter UI note above.
     `needsRelearning`'s rule 4 (below, and
     [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built))
     needs this value the moment a chunk gets flagged, which can happen
     long after its first encounter — `lib/ladder.js` has no `piece`/`chunk`
     access to compute it itself, so the caller resolves it unconditionally
     and passes it down, same pattern `targetBPM` already uses.
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
   usual gap-proportional tempo-ratchet step ([Tempo
   ratchet](#tempo-ratchet-pass-59) above; the old flat `+2` before Pass 59).
   Applies on
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
carries a `session.ladderSnapshot`: the ladder fields
(`stage`/`consecutivePasses`/`consecutiveStabilizingFails`/`practiceBPM`/
`nextDueDate`/`tier1Done`, plus `needsRelearning` since Pass 11,
`currentBPM` since Pass 14, and `stabilizingEntryBPM`/`settlingEntryBPM`/
`holdingEntryBPM` since the Pass 26 follow-up — all four optional, so
older snapshots still restore rather than failing validation) exactly as
they stood *immediately before* that session — the same
snapshot-and-restore shape `flagSnapshot` already used for rough/lost
flags (below), just never extended to session logging until now.
`handleUnlogSession` restores that snapshot when undoing a session,
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
the original six required fields (defensive, warns rather than partially
restoring — the four optional fields above are deliberately not part of
that requirement).
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

**Resolved:** a full undo now also reverts `currentBPM` (the "what was
last actually played" display field, distinct from the ladder's
`practiceBPM`) — found as a gap in review, then fixed the same session by
adding it to `ladderSnapshot` (see the optional fields listed above).
Before the fix, undoing a chunk's only session could leave
`computeAutoConfidence` reading a stale, nonzero `currentBPM` and
producing a nonzero confidence score for a chunk that otherwise looked
fully untouched (`stage: null`, no sessions). See
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
the Piece Overview tab's "Practice progress" bar and `PartSwitcher`'s
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
- a piece with an **active revival** — tested via `isInRevival(piece)`
  ([below](#isinrevival--one-definition-of-in-revival)), not by reading a
  `piece.revival` field directly — since revival is already "something's
  wrong, working through it" mode and routine maintenance shown alongside
  it would compete for attention with no clear priority.

Both call sites (`MasterAgendaTab`, `TodayTab`) use this one function
rather than each running its own query — Master Agenda just renders less of
the same result. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance).

**Since Pass 66, both call sites run this query unconditionally — not just
once a piece has run out its whole bounded plan.** Before this, a review
whose `nextDueDate` had already passed while the piece was still
comfortably inside its active plan had no live surface at all: its
placement day (`computeTimeline`'s own once-per-piece scheduling — see
[Timeline / scheduler](#timeline--scheduler)) had already gone by, and the
query itself only ever ran once `dayNumber > timeline.days.length`
(`TodayTab`'s `pastPlan`, `MasterAgendaTab`'s equivalent check). Paging
day-nav back to that exact past day was the only way to see it, and there
was no way to log it from "today" at all.

`mergeLiveDueReviews(day, dueItems)` (`lib/maintenance.js`) is the merge
this now runs through: it folds `computeDueReviews`'s result into a plan
day's own `reviewChunkIds`, filtering out any chunk id already present —
a review due *exactly* today is already placed there by `computeTimeline`
itself, so without the filter it would render (and count) twice. Both
`TodayTab`'s day-view checklist and `MasterAgendaTab`'s per-piece review
chip row call it the same way, scoped to real "today" only (day-nav
browsing a past or future day, or Master Agenda's date picker on a
non-today date, shows that day's own plan as scheduled — live "as of
today" due-ness has no meaning for a day that isn't today). Also folds
each merged item's `minutes` into `day.minutes`/`totalTime` — safe because
`computeTimeline`'s `minutesFor` and `computeDueReviews` now price a
review identically (`chunk.effort * EFFORT_TO_MIN`, the same rate
introducing the chunk fresh uses). **This wasn't always true**: at first
`minutesFor` priced a review at a flat 3 minutes regardless of difficulty,
which disagreed with `computeDueReviews`'s difficulty-based estimate —
`mergeLiveDueReviews` originally left `minutes` deliberately unmerged for
exactly that reason, until a same-session follow-up brought the two rates
into agreement (see [Decisions.md](Decisions.md#spaced-repetition--maintenance)
and the `computeDaysNeededForMinutesPerDay` note above, which had the same
flat-rate assumption baked into its day-count math).

**`mergeLiveDueReviews` skips consolidation ("full run-through") days
entirely** (`if (day.type === "consolidation") return day;`), found in a
self-review after the merge above shipped: neither `TodayTab`'s
`ConsolidationPanel` nor `MasterAgendaTab`'s card renders `reviewChunkIds`
or `minutes` for that day type at all, so merging a transition/combo's
overdue live-due review in would have silently inflated `day.minutes` (and
Master Agenda's total-planned figure) with no line item anywhere
accounting for it — reproduced live, not theoretical. The item still
surfaces normally on any other day, or via the unrelated past-plan path.
See [Decisions.md](Decisions.md#spaced-repetition--maintenance).

The review's *original* placement day is untouched by this and keeps
reading "behind" via [`classifyDayCompletion`](#detecting-that-a-piece-has-run-past-its-plan)
exactly as before — that's accurate history (the review really did come
due on that day and wasn't logged), not the bug. Only "is there a live,
current way to see and act on this today" was missing, and that's what
Pass 66 closes.

### `isInterleaveEligible` — Interleaved mode's eligibility rule (Pass 29)

`isInterleaveEligible(entry)` (`lib/ladder.js`) is the one-line predicate
behind the Today tab's Interleaved mode
([Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29)):
`entry.stage === "settling" || entry.stage === "holding"`. It's a plain
per-chunk lookup against the same `ChunkProgress.stage` the ladder already
maintains, not new derived or persisted state. `TodayTab` applies it as a
filter over whichever "today" item list is already in scope — the
newChunkIds/specialChunkIds/reviewChunkIds triple mid-plan, or
`computeDueReviews`'s `dueItems` past the plan — rather than computing a
separate rotation set.

### `isInRevival` — one definition of "in revival"

`isInRevival(piece)` (`lib/revival.js`) is the **single source of truth**
for whether a piece is currently in revival, and returns a real boolean
(never a truthy object) for any input, including `null`.

`piece.revival` records an in-progress run two ways — the `active` boolean
and the `startedAt` timestamp — always set and cleared together by
`handleStartRevival` / `handleEndRevival` (`App.jsx`). Because both were
live, call sites had drifted into checking different ones: most of the UI
read `active`, while `computeDueReviews` and `TodayTab` read `startedAt`.
They could not disagree through any path the app itself takes, so this was
never a live bug — but the same rule was written down twice, in two
shapes, with nothing keeping them in step.

**Standardized on `active`**, because answering this yes/no question is
that field's entire job. `startedAt` has a real second one: it is the
cutoff `computeComboEscalations` uses to decide which logged sessions
belong to the current run, and that function still reads it directly — as
a timestamp, not as a flag. Each field now does only what it is for.

Every boolean revival gate routes through this function: `App.jsx` (nav
item, revival tab render, `handleOpenRevival`), `OverviewTab`, `TodayTab`,
`MasterAgendaTab`, `computeDueReviews`, `getRevivalTargetBPM`, and
`storage.js`'s `mergeImportedPiece`. Behaviour is unchanged at every one.
See [Decisions.md](Decisions.md#revival).

> **Known gap, not fixed:** `validateAndMigratePiece` restores
> `piece.revival` all-or-nothing (`piece.revival || {…defaults}`), so a
> *partial* revival object never has its missing sub-fields filled in —
> the same shape-gap `mergeLadderConfig` exists to fix for ladder settings.
> Unreachable through normal use (both fields always move together), but a
> hand-edited backup carrying only one of them would now resolve
> differently than before. Logged in
> [Decisions.md](Decisions.md#open-questions).

### Detecting that a piece has run past its plan

Both surfaces need to know "is this piece past its plan?" before they can
switch to the due list, and **`getCurrentDay` cannot answer it** — it
`clamp`s to `[1, totalDays]`, so a 10-day plan that started three months
ago still reports day 10.

`elapsedDay(piece)` (`lib/utils.js`) is the unclamped form: the same
day-1-is-`startDate` arithmetic, floored at 1 (so a future `startDate`
reads as "day 1, not started" rather than a negative day) but with no
upper bound. **`getCurrentDay` is now derived from it**
(`clamp(elapsedDay(piece), 1, totalDays)`) rather than repeating the date
arithmetic, so the clamped and unclamped forms cannot drift apart.

This clamp is also why Master Agenda's pre-Pass-8 `dayNumber >
timeline.days.length` guard **never fired for today**: a piece past its
plan silently re-rendered its last scheduled day, every day, indefinitely.
Fixing the detection fixed that too.

**`elapsedDay(piece) > timeline.days.length` alone is no longer "the plan
is over" (Pass 39).** Through Pass 38, both surfaces compared `elapsedDay`
against `timeline.days.length` directly and switched straight to the due
list the moment it tipped over — purely a calendar question, with no
regard for whether the plan's actual content had been touched. That
conflated two different things: a piece whose target date passed with real
work still outstanding isn't *done*, it's *behind* — and the old check
couldn't tell the two apart. See
[Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented)
for the definition this now implements, and
[Decisions.md](Decisions.md#scheduling) for the days-vs-minutes asymmetry
below.

`isPlanActuallyComplete(piece, chunkSet, timeline)` (`lib/scheduling.js`)
is the replacement — the one function both `TodayTab`'s `pastPlan` and
`MasterAgendaTab`'s per-piece day-lookup now call, so the definition can't
drift between the two surfaces the way two independent inline checks
eventually would have. Gated on `elapsedDay(piece) > timeline.days.length`
first (still necessary — the calendar has to have actually elapsed before
"is it finished" is even a meaningful question), then splits by
`scheduleMode`:

- **`"days"`** — the deadline was a deliberate choice, so running past it
  doesn't excuse unfinished work. Every item `computeTimeline` actually
  scheduled — `chunkSet.all`: practice chunks, transitions, and combos —
  must have at least one logged session (`doneDays.length > 0`). Section
  run-throughs and the synthetic `"__consolidation__"` entry are **not**
  included — `generateAllChunks` never puts either one in `all` to begin
  with (see [Chunking](#chunking) and
  [Section run-throughs](#section-run-throughs) above), so this reads as
  "not part of what a plan-completeness check evaluates" by the same
  structural fact that already excludes them from Tier 1/Tier 2 review
  placement. **Flagged, not fully resolved:** whether a piece should also
  require the final "Full run-through" consolidation day to be logged
  before counting as complete was left an open product question rather
  than guessed at — see [Decisions.md](Decisions.md#scheduling).
- **`"minutes"`** — there was never a deadline to run past in the first
  place, so "finished" is Stage 3's real definition instead:
  `isPieceLearned(piece, chunkSet)` (`lib/ladder.js`) — every practice
  chunk's ladder card at Holding. `isPieceLearned` reads only
  `chunkSet.practiceChunks`, matching Stage 3's definition as stated in
  Repertoire-Lifecycle.md (transitions/combos ride the same ladder
  mechanics but were never part of what "learned" means).

**`computeMinutesModeAutoExtend(piece, chunkSet, timeline)`
(`lib/scheduling.js`)** is what keeps a `"minutes"`-mode piece from ever
needing the days-mode reschedule prompt in the first place: once
`elapsedDay(piece) > timeline.days.length` and `isPieceLearned` is still
false, it returns a `{ daysToLearn, rescheduleMarker }` patch that grows
the plan by `elapsedDay(piece) + 14` days (14 is arbitrary runway, matching
Holding's own default `startIntervalDays` rather than being a bare
number — sized off `elapsedDay`, not the old `daysToLearn`, so a piece left
unopened far longer than one step still catches up in a single extension).
`App.jsx` applies this from a `useEffect` scoped to the active piece,
mirroring `handleReschedule`'s own minutes-mode branch but self-triggered
instead of button-triggered — see [Decisions.md](Decisions.md#scheduling).

This reuses `reconcileMinutesPerDaySchedule`'s existing
`rescheduleMarker`-gated floor (above) to make the extension stick across
reload, with one deliberate difference from how `handleReschedule` itself
builds a marker: **the marker's `asOfDay` is pinned to the *new* final day,
not the current one.** By the time this auto-extend fires at all,
`computeTimeline`'s own halfPoint rule has normally long since finished
introducing every chunk, so `remainingChunkIds` (chunks with zero sessions)
is typically empty — and `getEffectiveTimeline` gives a chunk no presence
at all in a re-packed sub-plan unless it's named in `remainingChunkOrder`.
Anchoring `asOfDay` at the *old* final day with an empty
`remainingChunkOrder` would blank Tier 1/2 review placement for the entire
newly-extended region; anchoring it at the *new* final day instead means
only that single trailing day goes unplaced, and everything else keeps the
full, real placement `computeTimeline` produces against the larger
`daysToLearn`. Verified live in the browser, not just reasoned about: a
seeded minutes-mode piece with every chunk touched but still in
Settling/Stabilizing correctly kept showing real, due Tier 2 reviews deep
into the auto-extended region rather than an empty day.

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

## Practice history labels

`computePracticeHistory(piece, chunks, limit = 10)` (`lib/history.js`,
**Pass 20**) builds ProgressTab's "Recent practice history": it groups every
`doneDays` entry across `piece.progress` by day, sorts newest-first, keeps
the most recent `limit` days, and returns
`[{ day, label, unresolvedCount }]`.

This lives in `lib/` rather than in the component because it absorbs a real
mismatch, not just formatting. **`piece.progress` is persisted and keyed by
chunk id; the chunk set is re-derived on every render. The two can
disagree**, and a logged id can fail to resolve for two quite different
reasons. Each id is resolved in this order:

1. **`__consolidation__`** — the synthetic whole-piece run-through key
   (`handleLogRunThrough`, `App.jsx`), never a real chunk. Labelled "Full
   run-through", with "(stopped Nx)" when that day's most recent session
   carries a `stopCount`. A `stopCount` of **0** is shown, not treated as
   absent — a clean run-through is the best outcome and must not read the
   same as one that was never counted.
2. **A live chunk id** — labelled with its measure range via `formatRange`.
3. **A section run-through (`sr_<sectionId>`)** — resolved off
   `piece.sections`, *not* the chunk set. These are valid, current items,
   but `computeSectionRunThroughs` derives them fresh from live progress and
   they are deliberately **not** part of `generateAllChunks`'s `all` array
   (see [Section run-throughs](#section-run-throughs)), so they are *never*
   in `chunks` on any piece. Labelled `Play through: <section> (mm. a–b)`,
   using the same `start`-sorted ordering `computeSectionRunThroughs` uses,
   so positional names ("Section 2") match what Today's Practice showed when
   the session was logged.
4. **Anything else** — genuinely stale. Editing a piece's measures,
   sections, or difficulty regenerates chunk ids, so sessions logged before
   that edit point at divisions that no longer exist. A deleted section
   lands here too, via its now-unresolvable `sr_` id.

Stale entries **keep their day** — the practice really happened — but are
never given an invented measure range. They are counted and collapsed into
one trailing note ("N passages from an earlier version of this plan")
rather than repeated per id, which would swamp the row on a heavily-edited
piece. `unresolvedCount` is returned alongside the label so callers and
tests can reason about how many entries couldn't be named without parsing
the copy back out. Deliberately **no `console.warn`** for either
unresolvable case: unlike the malformed ladder snapshots in `App.jsx`, both
are expected states, not a sign anything went wrong.

> **This is the corrected behavior, not the original.** Before Pass 20 the
> logic was inline in `ProgressTab` and did `chunkById[id].start` with no
> guard — which threw on the undefined and crashed the **entire Progress
> tab**, every panel, not just the history row. Case 3 above is not an edge
> case: any piece with a logged section run-through hit it. See
> [Decisions.md](Decisions.md#ux).

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

**`classifyDayCompletion(day, piece, currentDay)` (Pass 45)** is a sibling
function, not a replacement — a *per-day* completion status rather than a
piece-wide missed count. Returns `"future"` for `day.dayNumber >=
currentDay`; otherwise `"empty"` if the day's `newChunkIds` +
`specialChunkIds` + `reviewChunkIds` are all empty (nothing was ever
scheduled there — a rest day, or any other empty day); otherwise `"done"`
if every one of those ids has `day.dayNumber` in its own `doneDays`, else
`"behind"`. Written standalone, off the same `timeline.days[]` shape
`computeScheduleStatus` reads, so a future Timeline-tab pass can reuse it
instead of duplicating the logic — currently consumed only by Overview's
"first week" list (grays a past day regardless of `"done"` / `"behind"` /
`"empty"`, strikes it through only when `"done"`).

The `"exact day"` check is deliberately stricter than `computeScheduleStatus`'s
own "ever touched" test (`doneDays.length > 0`) — a chunk logged on some
*other* day still leaves the day being classified incomplete. `"empty"` is
its own state rather than folding into `"done"` (a day with nothing
scheduled trivially satisfies "every item is done" over zero items) —
kept separate specifically so a caller can gray an empty day out without
implying real work was completed there; see
[Decisions.md](Decisions.md#ux) for why this wasn't the original shape.

**Known gap, not fixed:** a consolidation day's `reviewChunkIds` lists
every practice chunk (so it can never land on the `"empty"` branch), but
logging that day's run-through (`handleLogRunThrough`, `App.jsx`) only
ever writes the synthetic `"__consolidation__"` progress entry, never each
individual chunk's own `doneDays`. A logged consolidation day therefore
still classifies as `"behind"` here unless those same chunks separately
happen to have a same-day regular practice session. See
[Decisions.md](Decisions.md#open-questions).

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

The feasibility check shown in the reschedule confirmation dialog —
`estimateRescheduleFit(piece, practiceChunks, timeline, asOfDay,
remainingChunkIds)` (`lib/scheduling.js`, not part of `getEffectiveTimeline`
itself) — estimates required vs. available days using `EFFORT_TO_MIN` and
the 0.65 efficiency constant — see
[Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about).
**Since Pass 21** this is a standalone function rather than inline logic in
`App.jsx`'s `handleReschedule`, specifically so the multi-piece bulk
reschedule below can reuse the exact same formula instead of a second copy
drifting out of sync with it.

**When `estimateRescheduleFit` says it doesn't fit, `handleReschedule`
offers a concrete way past it, branching on `piece.scheduleMode` and, as of
Pass 39, on whether the piece's own plan has already fully elapsed:**

- **`"days"` mode, still inside its own plan (just tight):** two buttons,
  unchanged since Pass 36. "Reschedule into the current plan days" packs
  the remaining chunks into whatever's left. "Change target date" extends
  the plan via `computeReschedulePastPlanExtension` (below) and writes both
  `daysToLearn`/`targetDate` plus `rescheduleMarker` in one `updatePiece`
  call, so `getEffectiveTimeline`'s recompute already has the room the
  marker's `remainingChunkOrder` needs.
- **`"days"` mode, but the piece's target date has *already fully
  passed*
  (`elapsedDay(piece) > timeline.days.length`; Pass 39 follow-up):** only
  one button — "Change target date." "Reschedule into the current plan
  days" is not offered here: `estimateRescheduleFit`'s `availableDays`
  floors at 1 in this state, so that option would pack every remaining
  chunk onto what's effectively a single already-past day. Confirmed as a
  real, not hypothetical, consequence during manual verification: doing
  exactly that once is what lets a piece stop being recognized as behind
  schedule *at all*, ever again (see
  [Decisions.md](Decisions.md#scheduling) for the mechanism and why it's
  logged as an open issue rather than also fixed this session). Signaled to
  the modal via `suggestion.singleChoice = true`, alongside the same
  `daysToLearn`/`targetDate` the two-button case computes.
- **`"minutes"` mode:** unchanged since Pass 36 — a single button
  regardless of how far past the plan the piece is, since this mode never
  had a target date or a "protect the tight deadline" alternative to begin
  with. Writes the same computed `daysToLearn` (`targetDate` left alone)
  plus `rescheduleMarker`. This write only actually sticks because of the
  `reconcileMinutesPerDaySchedule` floor described above — without it, the
  very next load would silently recompute `daysToLearn` back down, since
  that function has no way to know an extension was ever deliberate. See
  [Decisions.md](Decisions.md#scheduling) for the bug this was found to
  cause before the floor existed.

`computeReschedulePastPlanExtension(piece, anchorDay, requiredDays)` (Pass
39, `lib/scheduling.js`) is the shared formula behind every "push the
deadline out" button above and the bulk case below: `daysToLearn = anchorDay
- 1 + requiredDays`, `targetDate = addDaysISO(piece.startDate, daysToLearn -
1)` for anything other than `"minutes"` mode. Callers pass
`elapsedDay(piece)` as `anchorDay`, never the clamped `currentDay`/`asOfDay`
— sizing off the clamped value could leave the freshly-extended plan still
short of *today* for a piece genuinely far past its plan, needing several
more reschedule actions to actually converge (confirmed in manual testing:
a piece 10 days past a 5-day plan took three successive clicks to converge
before this fix). Extracted into one function specifically so the
single-piece and bulk paths can't drift apart the way `currentDay` vs.
`elapsedDay` already had before this fix existed.

**`planRescheduleForPieces(pieces)`** (Pass 21, `lib/scheduling.js`) is the
multi-piece form of the flow above — Master Agenda's "Reschedule all". For
every piece it builds the same `{ asOfDay, remainingChunkOrder }` marker
`handleReschedule` would, anchored to *that piece's own* current day (not a
single shared day number, since pieces in a bulk reschedule usually started
on different dates), and calls `estimateRescheduleFit` per piece so the
confirmation can name which ones probably won't fit. A piece is included
only if it's active, not mid-revival, its plan isn't *actually* finished yet
(`isPlanActuallyComplete` — see
[Detecting that a piece has run past its plan](#detecting-that-a-piece-has-run-past-its-plan);
**was the raw `elapsedDay(piece) <= timeline.days.length` check through
Pass 38**, the same calendar-only bug fixed everywhere else this pass), and
actually has both a miss and remaining chunks; results are ordered
furthest-behind first. One malformed piece is skipped (logged, not thrown)
rather than failing the whole bulk action.

**Since Pass 39**, each plan entry also carries an `extend` field —
`computeReschedulePastPlanExtension(piece, elapsedDay(piece),
fit.requiredDays)` when the piece is a `"days"`-mode piece whose own plan
has *already fully elapsed* (`elapsedDay(piece) > timeline.days.length`),
`null` otherwise. Deliberately excludes `"minutes"`-mode pieces even when
they'd otherwise qualify — such a piece already has its own separate,
automatic fix (`computeMinutesModeAutoExtend`, applied the moment it's next
opened, no button involved), and computing a *second*, differently-sized
extension for it here would just reintroduce two formulas answering the
same question. `App.jsx`'s `handleRescheduleAll` uses the presence of
`extend` to build the confirmation message — pieces getting their target
date pushed out are named separately from pieces that are merely tight
(the pre-existing "probably won't fit" warning, now only shown for the
latter group) — and `handleConfirmReschedule` applies `extend`'s
`daysToLearn`/`targetDate` alongside the marker, the same way the
single-piece "Change target date" button always has. `App.jsx`'s
`handleConfirmReschedule` applies the resulting markers (and, since Pass
39, extensions) by writing the active piece through the normal
`updatePiece` path and every other piece directly to `localStorage` (the
save effect only ever persists the active piece) — see
[Decisions.md](Decisions.md#scheduling) for why that ordering (save first,
apply only what saved) matters and what it protects against.

## Revival

Data shapes: [Data-Model.md](Data-Model.md#revival). Recovering a piece that
was learned once but has gone stale — see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md).

`getRevivalTargetBPM(piece, chunk)` resolves the effective tempo target
during an active revival: `entry.targetBPM || getDefaultTargetBPM(piece,
chunk)` — exactly the same target-resolution rule as normal (non-revival)
practice, with no revival-specific override. (Through Pass 34,
`piece.revival.performanceTempo` — a piece-wide tempo collected at revival
entry — won over even a chunk's own explicit `targetBPM`; reverted in Pass
35, see [Decisions.md](Decisions.md#revival). A piece saved before Pass 35
may still carry that field, but nothing reads it.)

`computeTempoLadder(targetBPM, startFraction, steps)` returns a small
(default 5-step) array of BPM values from `targetBPM * startFraction`
(default 0.6, adjustable via `piece.revival.tempoLadderStartFraction`) up to
`targetBPM` itself, inclusive. Rounding can collapse steps together when
`startFraction` is close to 1; the result is deduplicated rather than
showing a misleading run of repeated values. `tempoLadderStartFraction` is
collected once at revival entry (`RevivalEntryModal`) and stays editable
afterward from a "Revival settings" panel in `RevivalTab` — see
[Decisions.md](Decisions.md#revival).

`computeRevivalPlan(piece, chunkSet, currentDay)` builds the ordered
day-by-day revival plan: practice chunks and transitions (**not** combos —
a combo relearns through its underlying content, which is already in this
list as ordinary practice chunks), sorted flagged-first (rough or lost —
`progress[id].flag`, as of Pass 6; was `weakSpot` before) then
lowest-confidence-first. This sort itself is untouched by Pass 54, which
only changed *where* `flag` can be set from — the toggle is hidden on the
`sequentialMode` reassessment card now (ordinary Piece Map only), so a
chunk reaches this sort's flagged branch only if it was flagged outside
revival; a "Lost" quick-rate during reassessment reaches the front of the
plan through the confidence tiebreaker instead, unassisted. Greedily
packed into days against
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

#### Surfacing revival on Master Agenda (highest-priority items)

Master Agenda's Revival subtab shows chunk-level detail, matching the
granularity of its other two subtabs — but it **cannot show "today's
work,"** and this is the load-bearing consequence of the paragraph above.
The learning and maintenance subtabs can, because a learning plan is dated
(day 1, day 2, day 3) and due-ness is a calendar comparison. A revival
plan is neither: its day numbers are pacing buckets, and everything in it
is loggable any day in any order. There is no "today's revival measures"
to compute.

It therefore surfaces the **highest-priority items**, labelled *Start
here* rather than with a date-implying tag. The first plan day already
*is* the top-priority block, since `computeRevivalPlan` sorts flagged
first, then weakest confidence, then packs greedily to the daily budget —
so this is `planDays[0].itemIds`, run through the same `mergeRanges` the
other subtabs use to collapse adjacent chunks into contiguous measure
ranges.

Which plan it reads depends on whether one exists yet:

- **Plan generated** → the **stored** `piece.revival.plan.days`, so Master
  Agenda agrees with what `RevivalTab` displays rather than silently
  diverging if progress has moved on since the plan was generated.
- **Mid-reassessment** (no plan yet) → a live `computeRevivalPlan(piece,
  chunkSet, currentDay)` call. This works because that function is a pure
  function of `progress` + `chunkSet` and never reads `revival.plan`, so
  it yields the same priority order off partially-reassessed data. The
  card says "Reassessment in progress" above the items.

Revival cards deliberately carry **no time estimate**, and revival minutes
stay out of the "Total planned" banner: that number means committed daily
work, and revival items are explicitly not scheduled to a day. Showing a
time would imply a commitment the plan does not make.

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
