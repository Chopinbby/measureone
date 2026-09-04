# Decisions

> **Purpose:** A durable log of significant product/design decisions — what
> was decided, why, and what alternatives were considered — so reasoning isn't
> lost when the person who made the call isn't in the room (or the chat) anymore.
> **Audience:** Anyone about to revisit a past decision — future-you especially,
> since "why did we do it this way" is the question this doc exists to answer
> without re-deriving it from scratch.
> **Scope:** Decisions with lasting rationale. Not a changelog (see `git log`
> for that) and not current feature status (see [Roadmap.md](Roadmap.md)).
> **Related:** [Product-Principles.md](Product-Principles.md) ·
> [UX-Principles.md](UX-Principles.md) · [Roadmap.md](Roadmap.md)
> **Update when:** A significant decision is made — especially one that
> overturns a previous entry here (mark the old one superseded, don't delete
> it) — or an open question below gets resolved.

Entries are grouped by theme, newest-relevant first within each group. Each
entry: the decision, why, and alternatives considered where known.

## Punishment mechanics

**Decision: no streak concept anywhere in the app — no "current streak,"
"longest streak," streak-freeze mechanics, or "days since last practiced."
Treated as permanent product policy, not a one-off preference.**

- **Why:** A broken streak discourages exactly when discouragement is least
  helpful, and a long streak becomes something to anxiously protect rather
  than a healthy signal to act on.
- **Alternative shipped instead:** rolling-window consistency ("9 of last 14
  days") and a non-alarming heatmap (teal for practiced, neutral — not red —
  for untouched days).
- See [Product-Principles.md](Product-Principles.md#no-punishment-mechanics)
  and [UX-Principles.md](UX-Principles.md#visual-language-is-never-punitive).

## Confidence scoring

**Decision: confidence must be reps-and-tempo-quality-weighted, not "a
session happened."**

- **Why:** An earlier version let any logged session count as full credit
  regardless of how few clean reps or how slow the tempo — logging fewer
  clean reps at a lower BPM didn't move the score at all, which defeated the
  entire point of "confidence is earned."
- See [Algorithms.md](Algorithms.md#confidence).

**Decision: a manual override (`manualConfidence`) always wins over the
computed score, with no conditions.**

- **Why:** The formula is a hand-tuned heuristic (see
  [Research.md](Research.md)), not ground truth; the learner's own judgment
  about their own playing should never be overridden by an approximation.
- **Known accepted gap:** no set-date is recorded for the override, so
  historical reconstruction (`computeConfidenceAsOf`) can't correctly
  exclude an override that didn't exist yet at the reconstructed date. Not
  fixed — see [Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about).

## Scheduling

**Decision: "behind schedule" triggers only on a chunk whose scheduled day
has already passed with zero sessions logged — never a same-day cumulative
comparison.**

- **Why:** The earlier cumulative planned-vs-actual comparison incorrectly
  flagged "behind schedule" on the very day something was completed, before
  the day was even over.
- See [Algorithms.md](Algorithms.md#behind-schedule-detection).

**Decision: transitions are scheduled as soon as both flanking chunks are
introduced, not batched into the back half.**

- **Why:** An early version delayed transitions unnecessarily via an
  index-based spread (`i % backSpan`-style), which meant seam-practice was
  needlessly deferred even when both sides were already learnable.
- **Watch for regression:** that same offset pattern legitimately belongs on
  the *combos* loop — if it reappears on the *transitions* loop, that's the
  bug returning. See [Algorithms.md](Algorithms.md#timeline--scheduler).

**Decision: add a bounded review-load smoothing pass to the scheduler.**

- **Why:** Fixed-offset spaced review (`[1,3,7,14]` days after introduction)
  meant any day with a lot of new introductions produced a correspondingly
  overloaded review day later on — daily practice time swung heavily even
  though the plan's *average* load was reasonable.
- **Approach chosen:** nudge individual overloaded review instances ±1–2
  days within their valid window (never before intro+1, never past the plan
  end) rather than redesigning the offset system itself — a targeted fix
  over a bigger rework, since the offsets themselves work fine on average.
- See [Algorithms.md](Algorithms.md#timeline--scheduler).

**Decision: reserve only the final day as a pure consolidation/run-through
day, not a larger tail.**

- **Why:** Earlier iterations reserved a much bigger tail for pure
  run-throughs, which wasted the back half of the plan on repetition instead
  of targeted transitions/combos/review work.

**Decision: the Timeline wizard step fixes a real calendar deadline date
(`piece.targetDate`) rather than a raw day count, and a separate
`piece.practiceDaysPerWeek` (3–7) bakes actual rest days into the generated
plan instead of assuming every calendar day is a practice day.**

- **Why:** Asking for "days to learn it" as a bare number forced the user to
  do the date math themselves, and silently assumed 7-day-a-week practice —
  unrealistic for most learners and in tension with
  [Product-Principles.md](Product-Principles.md#no-punishment-mechanics)'s
  spirit of not designing around an idealized, uninterrupted practice
  schedule. This is a separate calendar-date surface from the open question
  below about Progress's velocity-based projection — see that entry for how
  the two now relate.
- **Approach chosen:** `computeTimeline`'s day array still spans
  `daysToLearn` as a plain 1..N sequence — `daysToLearn` now just means
  *calendar* days instead of *practice* days. Rest days are computed once
  (`computeRestDayFlags`, spreading `7 - practiceDaysPerWeek` rest days
  evenly across every rolling 7-day window via the same running-accumulator
  technique already used for spreading new-chunk introduction by effort) and
  every placement step — new-chunk introduction, transitions, combos, spaced
  review — walks the filtered list of non-rest day indices instead of the
  raw range. This kept `getCurrentDay` (calendar-day-since-plan-start —
  originally `createdAt`, now `startDate`, see the entry below) completely
  unchanged, since "day N" is still exactly N calendar days after the plan
  began; only *what gets scheduled onto* a given day number changed.
- **Alternative considered:** keeping `daysToLearn` as a practice-day count
  and giving `getCurrentDay` its own weekly-pattern-aware calendar mapping.
  Rejected — every UI surface that reads `timeline.days[i].dayNumber`
  (Timeline, Progress, Today) treats it as an opaque plan index, so pushing
  the rest-day logic into `computeTimeline` alone touched far less of the
  app than teaching `getCurrentDay` and every calendar-facing consumer about
  a weekly cadence.
- See [Algorithms.md](Algorithms.md#timeline--scheduler).

**Decision: `getCurrentDay` anchors on an explicit `piece.startDate`, not
`piece.createdAt`.**

- **Why:** `createdAt` is set once, at record-creation time, and — critically
  — an *imported* piece's `createdAt` came from whatever the source backup
  file had, unmodified. A backup containing pieces set up weeks or months
  earlier would import with that stale `createdAt` intact, so `getCurrentDay`
  (calendar-day-since-`createdAt`) immediately computed an elapsed-day count
  far past the plan's length — the piece landed on its last scheduled day (or
  the final consolidation/run-through day) the moment it was imported, even
  though the user hadn't practiced it yet in this app. The Master Agenda tab
  surfaced this loudly (see below) because it evaluates every piece's current
  day at once, but the same bug affected the single-piece Today/Overview
  views too, just less visibly since there was nothing to compare against.
- **Approach chosen:** added `piece.startDate` (an explicit "YYYY-MM-DD",
  editable on the Schedule tab, defaulting to today) as the sole scheduling
  anchor. `createdAt` reverts to pure bookkeeping — sort order in the piece
  switcher and work grouping, nothing else. On import, `createdAt` is always
  reset to the import moment (staggered per piece to preserve relative
  order), while `startDate` is *kept* if the source already had one (so
  restoring your own backup of an in-progress piece doesn't reset it to day
  1) and otherwise defaults to the import date. Pieces already saved without
  `startDate` are backfilled to today and immediately re-persisted at load
  time (`validateAndMigratePiece` / `loadPiecesFromStorage` in storage.js) —
  a transient per-render fallback would have meant a never-revisited piece's
  "day 1" kept drifting forward to whatever day it happened to load on,
  since there'd be nothing durable to diff against.
- **Alternative considered:** deriving `startDate` from `createdAt` on
  legacy/imported pieces instead of defaulting to today. Rejected — that's
  exactly the bug being fixed; a stale `createdAt` is stale regardless of
  which field reads it.
- See [Data-Model.md](Data-Model.md), [Algorithms.md](Algorithms.md#timeline--scheduler).

**Decision: `autoChunkSize()` always returns 4 measures, regardless of piece
length — the previous 2/4/8/12 tiering by `totalMeasures` (≤32/≤80/≤160/>160)
was removed.**

- **Why:** User-directed simplification after noticing "Determine
  automatically" gave an 106-measure piece 8-measure chunks instead of the
  4 they expected everywhere. Explicitly chose the flat-4 option over either
  leaving the tiering as-is or only changing the wizard's starting value.
- **Consequence:** existing pieces using `chunkMode: 'auto'` on longer pieces
  (>80 measures) will regenerate with smaller, more numerous practice chunks
  than before the next time their timeline recomputes — this is a real
  change to those pieces' schedule structure, not just new-piece defaults.

**Decision: `daysToLearn` reconciliation for `scheduleMode: "minutes"` moved
out of `ScheduleFields`'s `useEffect` into a pure function
(`reconcileMinutesPerDaySchedule`, `lib/scheduling.js`) called from piece
load (`validateAndMigratePiece`) and from the backup-import merge, not just
from the Wizard/Settings UI.**

- **Why:** A user reported importing several pieces set to a fixed
  `minutesPerDay` (e.g. 15) that instead showed tasks far exceeding that
  per day, with every piece landing on the same ~14-day plan regardless of
  its actual size. Root cause: `computeTimeline` treats `daysToLearn` as a
  given input and never checks it against `minutesPerDay`; the code that
  derives "how many days does this budget actually need" only existed as a
  React `useEffect` inside `ScheduleFields`, which is only mounted while a
  human has the Wizard's or Settings' Schedule panel open. A piece loaded
  from storage or merged in from an imported backup never passed through
  that component, so `daysToLearn` just kept whatever value the stored/
  imported data happened to carry — including a backup hand-edited to
  change `minutesPerDay` without updating `daysToLearn` to match, a
  workflow this project's own docs already call out as legitimate (see the
  import-matching decision above).
- **Approach chosen:** extracted the derivation as a pure function taking
  `chunkSet` directly (matching the existing convention of
  `computeTimeline(piece, chunkSet)` and friends), reused by both the live
  UI effect and the two non-UI entry points. Also folded an estimate of
  spaced-review load into the day-count derivation, which the original
  `ScheduleFields` version didn't account for at all — without it, the
  derived day count was "enough" for introduction alone but still ran over
  budget once review load landed on top. See
  [Algorithms.md](Algorithms.md#deriving-daystolearn-from-minutesperday-schedulemode-minutes).
- **Known limitation, not fixed here:** this derivation estimates a day
  count, it doesn't cap any individual day. `computeTimeline`'s own
  placement (new-chunk introduction spread only across the first half of
  learning days, per the rule above) means early days can still run
  somewhat over `minutesPerDay`, and a piece whose chunk size is large
  relative to a very tight budget can have a single introduction cost more
  than the entire daily budget on its own — no number of extra days fixes
  that specific case; only a smaller chunk size would. Redesigning
  `computeTimeline`'s placement itself to hard-cap daily minutes was judged
  out of scope for this fix.

**Decision (Pass 21): "Reschedule all" (Master Agenda) is the multi-piece
form of the existing per-piece Reschedule button — same marker shape, same
rebalancing logic, applied across every eligible piece behind a single
confirmation.**

- **`planRescheduleForPieces` (`lib/scheduling.js`)** selects the
  behind-schedule pieces and builds each one's `rescheduleMarker` anchored
  to *that piece's own* current day, not a single shared day number —
  pieces in a bulk reschedule started on different dates. It deliberately
  leaves alone: paused/archived pieces, pieces mid-revival (revival
  replaces the plan's pacing entirely), pieces past the end of their own
  plan (no meaningful "behind schedule" once a piece has moved to
  maintenance), and pieces with every chunk already practiced. One
  malformed piece is skipped rather than taking the whole bulk action
  down. Results are ordered furthest-behind first.
- **Follow-up fix, same pass:** the bulk confirmation originally gave
  *less* information than doing the same pieces one at a time — the
  per-piece dialog checks whether the not-yet-started work actually fits
  in the days left and says so, the bulk path didn't. Fixed by lifting
  that check into a shared `estimateRescheduleFit` (`lib/scheduling.js`)
  used by both dialogs, so they can't drift apart; the bulk dialog names
  the pieces that won't fit and points at the per-piece button for detail,
  rather than stacking one full warning per piece.
- **Follow-up fix, same pass — the more serious one:** non-active pieces
  have to be saved to `localStorage` by hand during a bulk reschedule,
  because the app's save effect only ever persists the *active* piece.
  The original write happened *after* the in-memory state update and
  reported failure through the storage-error banner — but that same state
  change re-runs the save effect, which re-derives the banner purely from
  the active piece's result, silently clearing a failure that belonged to
  a different piece. A partly-failed bulk reschedule would look
  successful on screen and revert on the next reload. Fixed: the
  hand-written pieces are now saved *first*, only what actually saved is
  applied to state, and a failure is reported via `window.alert` (which
  the save effect can't overwrite) naming the piece that failed. Verified
  by stubbing `localStorage` to reject one non-active piece mid-bulk-save.
- **Consequence noted here at the time, since resolved (see below):** at
  the time of this pass, the app only ever auto-persisted the active
  piece, so this fix had to save non-active pieces by hand — any future
  multi-piece-writing feature would have needed to do the same. **That's
  no longer true.** A Pass 29 follow-up generalized the save effect itself
  to persist every entry in `pieces` on any change, not just the active
  one, closing this gap at the root rather than leaving each feature to
  work around it locally — see the [UX](#ux) section below for that fix.
  Pass 32a's sidebar-reorder feature (`moveGroup`, `App.jsx`) writes to
  multiple non-active pieces and relies on that generalized effect
  directly, with no hand-written `savePieceToStorage` calls of its own —
  confirmed working via an actual reload, not just this note.

**Decision (Pass 21): "Pick a random piece to practice" (Master Agenda)
picks only from pieces with actual work today.**

Eligible pool is every piece with a scheduled learning day or a due
maintenance review as of the date being viewed — the same pieces already
shown as cards on that day's agenda. Pieces mid-revival are excluded, same
reasoning as everywhere else revival opts out of day-based scheduling:
revival work isn't scheduled to a day, so "practice this today" doesn't
apply to it. Offered only from two or more eligible pieces — picking "at
random" from a single candidate is just a slower way to click its card.

**Decision (Pass 21): `RandomStartPanel` (originally revival-only) now
also covers a maintenance due-review session, on the same "don't let
yourself choose the starting point" reasoning.**

Generalized rather than duplicated: it accepts either a ready-made
cross-piece pool (built via the exported `chunkEntry` helper, so labelling
can't drift between the revival and maintenance callers) or the original
single-piece props, which `RevivalTab` still passes unchanged. Sections
stay in the pool only in the single-piece (revival) form — a section that
isn't due isn't part of a due-review session, so including it there would
misrepresent what's actually due.

**Decision: the single-piece reschedule confirmation, when the remaining
work doesn't fit the days left, offers a concrete way out instead of just a
warning — different concrete actions depending on `scheduleMode`.**

- **`scheduleMode: "days"`:** two buttons — change the target date to a
  suggested one, or reschedule into the existing (tighter) window. The
  suggested date is computed from the same `requiredDays` estimate
  `estimateRescheduleFit` already returns (`newDaysToLearn = currentDay -
  1 + requiredDays`, then that many days out from `piece.startDate`) — not
  a second, independently-tuned calculation. "Reschedule into the existing
  window" is the pre-existing single-button behavior, unchanged.
- **`scheduleMode: "minutes"`:** a single button, not a choice. There is no
  target date to offer changing — one was never set in this mode
  (`minutesPerDay` is the fixed input, `daysToLearn` the derived output),
  and there's no "protect the tight deadline" alternative worth offering
  either, since minutes-mode has no calendar deadline to protect in the
  first place. The only sensible action is to extend `daysToLearn` to fit,
  at the same `minutesPerDay` — decided directly by the user (not inferred)
  after the first version of this feature surfaced a real bug (below).
- **The day/days pluralization in this dialog was also fixed** — plural
  except for exactly 1 ("1 day remains" / "N days remain"), no parenthesized
  "day(s)".
- **A real bug, found on critical review of the first version (which only
  built the "days" mode path, extended verbatim to "minutes" mode by
  writing `daysToLearn` directly): the extension silently reverted on the
  next reload for a `scheduleMode: "minutes"` piece.** `daysToLearn` in
  that mode is unconditionally recomputed from total effort and pace by
  `reconcileMinutesPerDaySchedule` (`lib/scheduling.js`) on every load,
  with no notion of days already elapsed without practice — it doesn't
  know a reschedule just extended the plan, so it silently overwrote the
  extension back down. Verified concretely (not just reasoned about):
  seeded a behind-schedule minutes-mode piece, extended it, confirmed
  `daysToLearn` was correct immediately, reloaded, watched it revert. The
  banner gave no sign anything was wrong either way — "behind schedule"
  correctly waits for a day to actually lapse before flagging misses, so
  the reverted extension wouldn't have shown a symptom until days later.
- **The fix:** `reconcileMinutesPerDaySchedule` now floors its recomputed
  value at the piece's existing `daysToLearn` *while a `rescheduleMarker`
  is in effect* — never shrinks a deliberate extension back down, but
  changes nothing when there's no marker (every pre-existing minutes-mode
  piece) or when the marker is present but `daysToLearn` was never actually
  extended (the ordinary "reschedule anyway" path, which never touches
  `daysToLearn` at all — the floor is a true no-op there). The floor clears
  itself the moment the piece is next saved from Settings, since that
  already clears `rescheduleMarker` — so an intentional pace/measure edit
  still recomputes from scratch as it always did. Verified with 5 new
  `lib/scheduling.js` tests (CLAUDE.md: lib-level regression coverage,
  the component layer has none), one of which was confirmed to actually
  fail by reverting the floor and watching it go red.
- **Consequence for later work:** `piece.targetDate` is a `scheduleMode:
  "days"`-only *input* to the scheduler, never itself read by
  `computeTimeline` — `daysToLearn` is the only field that actually drives
  plan length, in both modes. A feature that writes `targetDate` expecting
  it to change the schedule on its own, without also touching
  `daysToLearn`, will silently do nothing.

**Decision: fix `computeTimeline`'s new-chunk introduction spread from a
per-day-reset accumulator to a cumulative-boundary assignment.**

- **Why:** User-reported: when a piece's material doesn't divide evenly
  across the front-half window, the overflow was piling onto the last
  day(s) instead of spreading out. Root cause: the accumulator reset to 0
  at every day advance and was capped at the last front day, so once
  `dayIdx` reached it there was nowhere else for the remainder to go — every
  chunk from that point on landed on that one day. Confirmed concretely, not
  just reasoned about: 10 equal-effort chunks across 8 front days landed 7
  days with 1 chunk each and the 8th with 3.
- **Approach chosen:** each front day now owns an equal proportional slice
  of `totalNewEffort`, and a chunk is assigned to whichever slice it falls
  into by comparing its running total *before* being added against those
  slice boundaries — walked forward with a running total that's never reset
  per day, so drift corrects against the whole remaining total instead of
  compounding onto whatever day happens to be last.
- **A first draft of this fix traded one bug for another:** comparing each
  chunk's *midpoint* against the boundaries (rather than its start) fixed
  the last-day pile-up but could push even the very first chunk past day
  one's boundary, leaving day one with nothing introduced at all — found
  while testing the fix, not assumed. Comparing each chunk's *start*
  instead guarantees day one always gets at least the first chunk: the
  running total is 0 before it, and 0 is always less than a positive
  boundary.
- **Consequence:** a placement-only change inside `computeTimeline`, a pure
  derivation off `piece` — nothing persisted changed. Any existing piece
  with chunks not yet introduced will get different (more even)
  introduction-day placements the next time its schedule recomputes — the
  same category of consequence as the `autoChunkSize` flattening decision
  above: a real change to derived schedule structure for already-in-progress
  pieces, not just new-piece behavior. Not verified against a real piece
  with partial practice history reloaded under the new placement — only
  reasoned through (progress/sessions are untouched by this change) and
  covered indirectly by the full existing scheduling test suite.
- **Verified:** two new `lib/scheduling.js` tests (CLAUDE.md: lib-level
  regression coverage only, no component-layer harness) — one reproducing
  the last-day pile-up directly, one guarding the start-vs-midpoint
  distinction — both confirmed to actually fail against the pre-fix code.
- See [Algorithms.md](Algorithms.md#timeline--scheduler).

**Decision (Pass 39): "the calendar ran out" and "the plan is actually
finished" are not the same question — and what counts as "finished" itself
splits by `scheduleMode`, generalizing the same days-vs-minutes asymmetry
the reschedule-confirmation decision above already established for the
"doesn't fit" case.**

- **Why:** the motivating symptom, reported directly: a piece behind
  schedule whose calendar days had elapsed went *silent* instead of
  continuing to warn — `shouldShowScheduleBanner` suppressed the "N chunks
  behind schedule" banner the moment `elapsedDay(piece) >
  timeline.days.length`, with no regard for whether anything was actually
  missed, and both `TodayTab`'s `pastPlan` and `MasterAgendaTab`'s
  per-piece day lookup made the identical calendar-only judgment to switch
  into the maintenance/due-list view. All three were really asking "has
  the clock run out," when the question that actually matters is "is there
  still real work left."
- **Stage 3 was decided but never built as a real rollup** (see
  [Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented)):
  "a piece is learned once every practice chunk's ladder card has reached
  Holding" existed only as prose. This pass implements it as
  `isPieceLearned(piece, chunkSet)` (`lib/ladder.js`) and builds the
  piece-level "is the plan actually finished" rollup,
  `isPlanActuallyComplete(piece, chunkSet, timeline)` (`lib/scheduling.js`),
  on top of it — see [Algorithms.md](Algorithms.md#detecting-that-a-piece-has-run-past-its-plan)
  for the mechanics. `shouldShowScheduleBanner`, `TodayTab`'s `pastPlan`,
  and `MasterAgendaTab`'s per-piece day lookup all now call this one
  function rather than each repeating (and eventually drifting from) the
  same calendar-only comparison — the same "one function, every surface
  calls it" pattern `computeDueReviews` already established
  ([Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#how-maintenance-surfaces-in-the-ui-built)).
- **The asymmetry, generalized rather than reinvented:** the existing
  reschedule-confirmation decision above already splits `"doesn't fit"`
  by `scheduleMode` — `"days"` offers the learner a choice (change the
  target date, or cram into what's left) because the deadline was a
  deliberate one worth protecting or deliberately abandoning; `"minutes"`
  just extends automatically, since there was never a deadline to protect
  in the first place. This pass applies that identical reasoning to the
  calendar-*elapsed* case instead of the plan-doesn't-*fit* case:
  - **`"days"`** — running past a deliberately-chosen deadline doesn't
    excuse unfinished work, so it doesn't quietly graduate to "complete."
    `isPlanActuallyComplete` additionally requires every item
    `computeTimeline` actually scheduled (`chunkSet.all`) to have at least
    one logged session. When that's not yet true, `TodayTab` surfaces a
    new banner ("Past your target date… Reschedule to pick a new target
    date, or fit what's left into the time you have") that calls the
    *existing* `onReschedule` prop — already wired to `handleReschedule`,
    already opening the Pass 36 reschedule-confirmation modal with exactly
    the days-mode choice this needs. **No new modal or flow was built**,
    per the pass's own explicit scope — see "Deliberately deferred," below.
  - **`"minutes"`** — there was never a deadline to protect, so instead of
    a prompt, the plan just keeps growing automatically
    (`computeMinutesModeAutoExtend`, reusing
    `reconcileMinutesPerDaySchedule`'s existing `rescheduleMarker`-gated
    floor — CLAUDE.md's explicit warning not to break that floor is why
    this pass touches `lib/scheduling.js` rather than adding a second,
    parallel extension mechanism) until `isPieceLearned` is true, at which
    point — and only then — the piece reads as actually complete and
    switches to maintenance.
- **Scope, deliberately narrow (per the pass's own instruction):**
  - Building a brand-new reschedule-prompt UI for the days-mode case was
    explicitly out — Pass 36 already shipped the enhanced confirmation
    modal (pluralization fix, target-date suggestion); this pass triggers
    it, rather than duplicating it.
  - `computeLadderAdvance` (how a chunk's `stage` itself advances) is
    untouched — this pass only *reads* the existing `stage` field via
    `isPieceLearned`.
  - Whether section run-throughs or the synthetic `"__consolidation__"`
    entry should count toward a `"days"`-mode piece's completeness was
    flagged rather than guessed at (see
    [Algorithms.md](Algorithms.md#detecting-that-a-piece-has-run-past-its-plan)) —
    `generateAllChunks` structurally excludes both from `chunkSet.all`
    already, so `isPlanActuallyComplete` doesn't require either one, but
    whether it *should* — e.g. whether a piece is really "done" without
    ever logging the final full run-through — is an open product question,
    not a technical one this pass had grounds to resolve on its own.
- **Two real gaps found during implementation, deliberately left
  unfixed and flagged here rather than folded in as drive-by scope:**
  1. `handleReschedule`'s own "anything left to reschedule?" guard
     (`status.remainingChunkIds.length === 0` → no-op) is
     *practice-chunks-only*, matching `computeScheduleStatus` — but the
     new days-mode completeness bar this pass adds is *`chunkSet.all`*
     (practice chunks, transitions, **and** combos). In the narrow case
     where every practice chunk is touched but a transition or combo
     isn't, `isPlanActuallyComplete` correctly still shows the new
     reschedule nudge, but clicking its button would currently no-op
     silently, since `handleReschedule` sees nothing to reschedule.
     Widening `handleReschedule`'s own definition of "remaining work" — and
     by extension what `rescheduleMarker.remainingChunkOrder` and
     `getEffectiveTimeline`'s tail-splice mean — was judged too large a
     change to make as a side effect of this pass, since it's an existing,
     working mechanism with its own established (practice-chunk-scoped)
     semantics used well beyond just this new banner.
  2. `planRescheduleForPieces` (Master Agenda's bulk "Reschedule all")
     still excludes any piece with `elapsedDay(piece) > timeline.days.length`
     outright — the exact same calendar-only judgment this whole pass
     exists to correct, just in a sibling code path this pass's Touches
     didn't name. Left as-is rather than folded in: `MasterAgendaTab`'s own
     per-piece card, once past its plan with real work remaining, is now
     simply omitted from the agenda that day (see the next bullet) rather
     than contributing a `missedCount`, so it never actually reaches
     `behindItems`/the bulk button in the first place — the two gaps don't
     currently compound into a visibly broken promise, but they're the
     same bug and worth fixing together in a follow-up pass rather than
     independently.
- **`MasterAgendaTab`'s per-piece card, for a `"days"`-mode piece past its
  target date with real work remaining, is an omission, not a new prompt.**
  Before this pass, once `dayNumber > timeline.days.length`, the function
  either showed a (possibly misleadingly partial or empty) maintenance-due
  card or silently dropped the piece — `computeDueReviews` only ever
  returns *ladder* reviews for chunks already logged at least once, so a
  piece with real never-touched material left could show 0 due items and
  vanish, or show a due list that looks like "everything left" when it
  isn't. This pass's fix — gate that whole branch on
  `isPlanActuallyComplete` instead of the raw day comparison — stops the
  misrepresentation, but doesn't replace it with a new "needs reschedule"
  card: building one would have meant a second, novel UI surface for a
  case the pass's own "deliberately deferred" list explicitly ruled out
  building fresh prompt UI for. The piece is simply left off the agenda
  for that day, the same way every other "nothing to show" guard already
  in that function behaves. A learner in this state still gets the new
  `TodayTab` prompt once they open the piece directly (or, for a
  minutes-mode piece, the plan just keeps extending on its own) — Master
  Agenda not also surfacing it is a real, narrower gap than the
  reschedule-not-fully-fitting case above, flagged for a deliberate human
  decision on a follow-up pass rather than resolved unilaterally here.
- **A real, pre-existing interaction surfaced (not caused) by manual
  browser verification:** `handleReschedule`'s extension size
  (`estimateRescheduleFit`) sizes relative to the *clamped* current day
  (`getCurrentDay`), not the real unclamped `elapsedDay`. For a piece only
  slightly behind, one click is enough. For a piece far enough past its
  plan that this pass's new banner fires, a single click may only close
  part of the gap — `elapsedDay` can still exceed the freshly-extended
  `timeline.days.length`, leaving both the "N chunks behind schedule"
  banner and the new "Past your target date" banner still showing, needing
  another click. Confirmed concretely: a piece seeded 10 real days past a
  5-day plan took three successive "Change target date" clicks (5→7→9→11
  days) before `elapsedDay` finally cleared `timeline.days.length`. This is
  existing `handleReschedule`/`estimateRescheduleFit` sizing behavior, not
  something this pass changed — every click *does* make real, correct
  progress (the remaining chunks re-pack into genuinely new days each
  time) — but it's a mildly surprising UX property now that this pass's
  own banner makes "still not caught up" visible in a way it wasn't
  before. Not fixed here (`estimateRescheduleFit`'s sizing formula isn't
  in this pass's Touches); flagged for whoever next touches that formula.
- **Verified:** new `lib/scheduling.js` tests for `isPlanActuallyComplete`
  (both `scheduleMode`s, including the "calendar gate comes first" case —
  every chunk already at Holding but still within the plan reads as *not*
  complete) and `computeMinutesModeAutoExtend` (no-op cases, the real
  extension case, and that applying its own output actually clears the
  "past plan" condition in one step even after a long absence); new
  `lib/ladder.js` tests for `isPieceLearned`; the Pass 16
  `shouldShowScheduleBanner` suite rewritten around the new
  `(piece, chunkSet, timeline, missedCount)` signature, including the
  specific case that used to be the bug ("past the plan but real work
  remains" now asserts the banner **shows**, where it used to assert the
  opposite). **Also verified live in the browser**, not just via unit
  tests, for both `scheduleMode`s: a seeded `"days"`-mode piece push past
  its target date with nothing logged showed the new reschedule nudge
  (not "plan complete"), and clicking through it into the existing modal
  and confirming an extension worked exactly as the per-piece Reschedule
  button always has; the same piece with every `chunkSet.all` item logged
  correctly read as complete and switched to the maintenance/due-list view
  with both banners gone; a seeded `"minutes"`-mode piece well past its
  original day count with chunks still in Settling/Stabilizing had
  `daysToLearn` auto-extend on load (confirmed via `localStorage`, not
  just the rendered UI) and kept showing real, currently-due Tier 2
  reviews inside the newly-extended region; marking every chunk Holding
  and reloading stopped the auto-extend (`daysToLearn` unchanged on a
  further reload) and switched the same piece to "Plan complete —
  maintenance" with a live due-reviews list. `npm test`: 388/388.
- See [Algorithms.md](Algorithms.md#detecting-that-a-piece-has-run-past-its-plan)
  and
  [Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented).

**Decision (Pass 39 follow-up): a critical review of the Pass 39 build,
requested by the user before committing, found three real gaps — all three
fixed the same session rather than logged and left.**

- **Why a review at all:** the user asked for a skeptical second-engineer
  pass over just the session's changed files before committing, explicitly
  not the implementer re-confirming their own summary. The review found no
  P1s (nothing broken or silently wrong), but did surface concrete P2s,
  three of which were worth fixing immediately rather than deferring:
  1. **`handleReschedule` could silently no-op.** `isPlanActuallyComplete`'s
     `"days"`-mode bar covers `chunkSet.all` (practice chunks, transitions,
     combos), but the reschedule mechanism itself only ever knows how to
     re-place *practice chunks* — a transition/combo rides along with its
     neighboring chunk's touched status, not its own. So the new "past your
     target date" nudge (`TodayTab`) could correctly say real work remains
     while every practice chunk was actually touched (only a transition or
     combo left) — in which case clicking its Reschedule button did
     nothing, silently, since `handleReschedule`'s own guard
     (`remainingChunkIds.length === 0`) saw nothing to act on. **Fixed**:
     `TodayTab` now distinguishes the two cases (`hasReschedulableWork`) and
     shows different copy — "Nothing to reschedule, check View all" with a
     button that switches view mode, instead of a Reschedule button, when
     only a transition/combo is left. `handleReschedule` also got a plain
     `window.alert` backstop for the same state, in case it's ever reached
     some other way. Widening the reschedule mechanism itself to also
     independently re-place transitions/combos (rather than working around
     the gap in the UI) was considered and rejected as too large a change
     to make as a side effect of this fix — see
     [Algorithms.md](Algorithms.md#rescheduling) for why `getEffectiveTimeline`'s
     splice logic makes that non-trivial.
  2. **Master Agenda didn't mirror Today's Practice.** A `"days"`-mode piece
     past its target date with real work remaining got a card on Today's
     Practice (Pass 39's build) but was simply omitted from Master Agenda —
     not wrong, but a real gap the user asked to close. **Fixed**: Master
     Agenda now shows a matching "needs reschedule" card for the same
     state. Fixing this correctly also required swapping
     `planRescheduleForPieces`' own stale `elapsedDay(piece) >
     timeline.days.length` exclusion for `isPlanActuallyComplete` (the same
     fix applied everywhere else this pass) — otherwise the new card would
     drive the "N pieces are behind schedule" bulk banner into naming a
     piece that "Reschedule all" would then silently skip.
  3. **A `"minutes"`-mode piece sitting inactive in the background could go
     invisible on Master Agenda.** The auto-extend effect
     (`computeMinutesModeAutoExtend`) only ever runs for the *active*
     piece — a background piece past its own (stale) day count and not yet
     learned would hit the same `isPlanActuallyComplete === false` path the
     fix above uses for `"days"`-mode pieces, but showing it a "needs
     reschedule" card would be wrong: `"minutes"`-mode never shows a
     reschedule prompt anywhere else, it just self-heals. **Fixed**: Master
     Agenda now computes the same extension *for display only* (a pure,
     in-memory patch to the piece object used just for that render, nothing
     written to storage) so the piece shows real, current scheduled content
     — exactly what it would show once actually opened — rather than a
     prompt or an omission. The real, persisted extension still only
     happens via the existing `App.jsx` effect once the piece is opened.
  - **A related, explicitly requested change bundled into the same fix:**
    "Log practice" and "Pick a random piece to practice" on Master Agenda
    now always land on Today's Practice for that piece, not Piece
    Overview — landing on the dashboard when you clicked something that
    says "practice" was an unnecessary extra step. `switchToPiece` (App.jsx)
    took an optional target-tab parameter rather than adding a parallel
    function; Revival's "Open piece →" button deliberately keeps routing to
    Overview, unchanged — Revival has its own separate entry surface, and
    Today's Practice isn't a meaningful landing spot for a piece mid-revival
    (it can show a stale bounded-plan view, or the maintenance-suppressed
    state, neither of which is what a revival-mode piece needs).
- **A fourth, independently reported gap, same review round: the reschedule
  sizing quirk.** `handleReschedule`'s "doesn't fit" extension sized off
  `currentDay` (clamped to the plan's length via `getCurrentDay` once
  you're past it), not the real unclamped `elapsedDay`. For a piece only
  slightly behind, the two are identical; for a piece genuinely far past
  its plan, sizing off the clamped value could leave the
  freshly-extended plan still short of *today*, needing several more
  clicks to actually converge. **Confirmed concretely, not just reasoned
  about**: a piece seeded 10 real days past a 5-day plan took three
  successive "Change target date" clicks (5→7→9→11 days) before `elapsedDay`
  finally cleared `timeline.days.length`. **Fixed**: the formula now
  anchors to `elapsedDay(piece)`. Re-verified live with a more extreme case
  (16 days past a 5-day plan) — one click now fully converges.
- **Verified:** `npm test`: 394/394 (17 new tests across the four fixes,
  covering `isPlanActuallyComplete`'s minutes-vs-days split, the new
  `hasReschedulableWork` logic is component-level and untestable per
  CLAUDE.md's lib-only test policy, so verified live in-browser instead).
  Manually verified in-browser, for each of the four fixes independently:
  the transition-only banner correctly shows "Nothing to reschedule" with a
  working "View all" button and no dead Reschedule button; a days-mode
  piece past its target date got the new Master Agenda card, and clicking
  "Log practice" on it landed directly on Today's Practice, showing both
  the existing "N chunks behind schedule" banner and the new nudge
  together; a seeded background (inactive) minutes-mode piece past its
  stale day count showed real, current Day-N content on Master Agenda
  rather than a prompt or nothing; the sizing fix confirmed via the
  10-days-past-a-5-day-plan case above. Revival's "Open piece →" button
  confirmed still routing to Overview, unchanged.
- See [Algorithms.md](Algorithms.md#rescheduling).

**Decision (Pass 39 follow-up, second round): bulk "Reschedule all" now
pushes a piece's target date out when its plan has already fully elapsed,
rather than only ever repacking within days that no longer exist.**

- **Why:** found during the same critical-review pass above, but judged
  worth a separate round rather than folding in: applying only a
  `rescheduleMarker` (what "Reschedule all" always did) leaves `daysToLearn`
  untouched, so a `"days"`-mode piece whose target date has already fully
  passed stays past its own plan even after a "successful" bulk
  reschedule — its Master Agenda "needs reschedule" card (the fix above)
  would never actually clear. The single-piece "Change target date" button
  already solves exactly this for one piece at a time; the bulk button had
  no equivalent.
- **Fix:** `planRescheduleForPieces` now computes an `extend` patch
  (`computeReschedulePastPlanExtension`, the same formula the single-piece
  sizing fix above uses — extracted into one shared function specifically
  so the two paths can't drift apart the way `currentDay` vs. `elapsedDay`
  already had) for any `"days"`-mode piece whose own plan has fully
  elapsed; `null` for everything else, including a `"minutes"`-mode piece
  in the equivalent state (which already has its own separate, automatic
  fix and doesn't need a second one from this path — see
  [Algorithms.md](Algorithms.md#rescheduling)). `handleConfirmReschedule`
  applies `extend`'s `daysToLearn`/`targetDate` alongside the marker, for
  both the active piece and every other piece in the batch.
- **The confirmation wording was drafted and shown to the user before
  writing any code**, per their explicit ask. Final wording: pieces getting
  an automatic extension are named in their own sentence ("N of these — X,
  Y — are past their target date entirely. Rescheduling will also push
  their target dates out to fit, at the same pace."), separately from the
  pre-existing "probably won't fit" warning, which now only applies to
  pieces that are merely tight but still inside their own plan — the base
  sentence's blanket "and each piece keeps its own target date" is dropped
  whenever any piece in the batch is actually having its date moved, so it
  never states something false.
- **A real, pre-existing bug was found while verifying this — not fixed,
  logged as an open issue below.** See [Open questions](#open-questions).
- **Verified:** new `lib/scheduling.js` tests for `planRescheduleForPieces`'s
  `extend` field (a genuinely past-plan `"days"`-mode piece gets one sized
  correctly; a merely-tight-but-within-plan piece gets `null`; a
  `"minutes"`-mode piece past its own plan gets `null` even with real
  untouched work, confirming the deliberate exclusion) and a standalone
  `computeReschedulePastPlanExtension` describe block. Manually verified in
  the browser: the exact proposed wording rendered correctly (singular
  case, "Pass39c Bulk Test is past its target date entirely..."); clicking
  through extended `daysToLearn`/`targetDate` correctly and the piece
  immediately showed real, current tasks instead of the reschedule card.
  `npm test`: 394/394.

**Decision (Pass 39 follow-up, third round): the single-piece reschedule
dialog no longer offers "reschedule into current plan days" once a piece's
target date has already fully passed.**

- **Why:** the open issue found while verifying the bulk-extend fix above
  (full mechanism in [Open questions](#open-questions)) traces back to a
  single root cause — a piece whose plan has *already fully elapsed* still
  had "reschedule into current plan days" offered as if it were a real
  alternative to extending. Choosing it packs every remaining chunk onto
  what's effectively a single already-past day (`estimateRescheduleFit`'s
  `availableDays` floors at 1 there), which is exactly the state that later
  makes the piece permanently unrecognizable as behind schedule. Asked to
  restate the bug in plain language and propose a fix; two options were
  offered — (1) stop offering the trap-creating choice in the first place,
  and (2) make "Reschedule all" resilient to a piece already stuck this
  way, so it stays discoverable even after the fact. **The user chose (1)
  only** — the safer, narrower fix; (2) remains open (see below).
- **Fix:** when `handleReschedule` detects the piece is a `"days"`-mode
  piece whose own plan has already fully elapsed (`elapsedDay(piece) >
  timeline.days.length`, not just "doesn't fit"), the suggestion carries
  `singleChoice: true`. The confirmation modal renders one button —
  "Change target date to X" — instead of two, and the message states
  plainly that the target date has already passed rather than framing it
  as a choice. A piece that's merely tight but still inside its own plan is
  completely unaffected — both buttons still show, exactly as before.
- **Verified:** manually in the browser, both cases side by side — a piece
  seeded 15 days past its own 10-day plan showed exactly one button
  ("Change target date to Sep 19"); a piece merely tight but still on day 5
  of a 20-day plan showed both buttons, unchanged. `npm test`: 394/394,
  build clean.
- See [Algorithms.md](Algorithms.md#rescheduling).

**Decision (Pass 48 follow-up): `getEffectiveTimeline` now chains through
a piece's whole reschedule history via `rescheduleMarker.previous`, instead
of always re-deriving the pre-reschedule portion from the raw, never-
rescheduled schedule.**

- **Why:** found while investigating a P2 issue flagged during Pass 48's
  own code review, then reproduced live, not left as a hypothetical.
  Rescheduling a piece a *second* time discarded whatever the *first*
  reschedule had actually placed for every day between the old `asOfDay`
  and the new one — `original` (the source for everything before the
  *current* marker's `asOfDay` inside `getEffectiveTimeline`) was always
  `computeTimeline(piece, chunkSet)`, the plan as if zero reschedules had
  ever happened, no matter how many times the piece actually had been.
  Confirmed with a real sequence: reschedule once, practice and log a
  chunk on its new placement, reschedule again — the day that chunk was
  practiced on reverted to showing a completely different, unrelated,
  never-touched chunk instead. The underlying session was never lost
  (`piece.progress[id].doneDays` stayed correct throughout); this was
  purely `getEffectiveTimeline`'s display losing track of it.
- **Fix:** each new `rescheduleMarker` now also carries `previous` — the
  marker that was in effect immediately before it, or `null` for a piece's
  first-ever reschedule. `getEffectiveTimeline`'s internal helper
  (`computeEffectiveTimeline(piece, chunkSet, marker)`) computes the
  pre-`asOfDay` portion by recursing on `marker.previous` instead of always
  calling `computeTimeline` directly — a once-rescheduled piece (the
  overwhelmingly common case) hits the same base case as before, so nothing
  changes for it. All three places that construct a marker
  (`App.jsx`'s `handleReschedule`; `planRescheduleForPieces` and
  `computeMinutesModeAutoExtend`, both `lib/scheduling.js`) now set
  `previous: piece.rescheduleMarker || null`.
- **A real, deliberately-accepted limit: this can't repair a piece whose
  second reschedule already happened before this fix existed.** That
  piece's marker was saved without a `previous` link, and the intermediate
  placement it would need to recover was never persisted anywhere — the
  history is genuinely gone, not just unfixed. Confirmed directly: a piece
  from this same session's own earlier testing, already rescheduled twice
  under the old code, still shows the reverted content after the fix
  landed; a *freshly* double-rescheduled piece shows correctly. It corrects
  itself the next time that piece is rescheduled again, since that
  reschedule's marker is built fresh, under the fixed code.
- **No cap on the `previous` chain's length** — a piece rescheduled 20
  times carries 20 links. Accepted as the simpler fix: rescheduling is a
  deliberate, occasional action, not something expected to run often enough
  for chain length or recursion depth to matter in practice. Worth
  revisiting only if that assumption turns out wrong.
- **Verified:** a new regression test
  (`test/scheduling.test.mjs`, "getEffectiveTimeline must chain through a
  piece's reschedule history") reproduces the exact scenario above —
  confirmed it actually fails with the fix reverted (temporarily restored
  the old single-`computeTimeline` base case, watched the test fail, then
  restored the fix and watched it pass), per
  [AI-GUIDELINES.md](AI-GUIDELINES.md#verify-a-regression-test-can-actually-fail).
  `npm test`: 412/412 (one pre-existing test's expected marker shape
  updated to include `previous: null`, not weakened — brought in line with
  what the single-piece path now correctly produces too). Manually
  reproduced live in the browser: a chunk practiced on its first-reschedule
  placement displayed as unstarted, on the wrong day, after a second
  reschedule with the bug present; displayed correctly, checked, with its
  real logged session, after the fix.
- See [Algorithms.md](Algorithms.md#rescheduling).

**Decision (Pass 49): single-section run-throughs become a repeating gate
(due → not due → due again) instead of unlocking once and staying
available forever.**

- **Why:** the prior behavior — `computeSectionRunThroughs` showing a
  section's run-through permanently once every chunk had a single logged
  session — meant the run-through panel was a permanently-available option
  sitting in the background rather than a real task tied to actual
  progress. Requested: a section's run-through should become due again
  every two further sessions per chunk after the first (threshold
  sequence 1, 3, 5, 7, ... — a flat "+2" step forever), with a
  locked/grayed preview on the day before the next threshold is crossed.
- **Mechanism:** `sectionRunThroughGate(section, piece, bySectionId)`
  (`lib/chunking.js`), computed fresh on every call from live session
  counts, no persisted "unlocked" state. `minCount` (the section's slowest
  chunk's session count) odd ⇒ due; `due` reduces to a parity check since
  1/3/5/7/... are exactly the odd numbers. `lockedPreview` covers the day
  a single uniquely-slowest chunk's next session would cross the section
  into being newly due. See
  [Algorithms.md](Algorithms.md#section-run-throughs) for the full
  mechanics, including why the two states are mutually exclusive by
  construction.
- **Fixed in the same pass, before ever committing:** the first cut of the
  gating metric used raw `sessions.length`, the same value
  `isSectionLearned` checks — which meant a skipped Interleaved attempt or
  an unconfirmed provisional session (both stored in the same array)
  advanced the gate as if it were a completed rep. Switched to
  `loggedSessions(sessions).length` (`lib/utils.js`). Deliberately **not**
  applied to `isSectionLearned` itself — that function is asking a
  different question ("has this chunk been touched at all," used by
  Overview's "sections learned" stat) and the two are allowed to disagree.
- **Deliberately not decided:** whether section-**pair** run-throughs
  (`kind: "section-transition"`, "Sections combined") should get this same
  repeating treatment once they first unlock, or whether staying a
  one-time "unlock and forget" drill is actually correct for them (they're
  already a later-stage, whole-piece-touched drill, arguably a different
  kind of thing than an early check-in). Left untouched on purpose — see
  [Open questions](#open-questions).
- **Verified:** `npm test` green (5 new regression tests, confirmed to
  actually fail by reverting the `loggedSessions()` fix before landing
  it — 3 of 5 caught the reverted bug immediately, the other 2 were
  strengthened after passing by coincidence on the first attempt). Manually
  in the browser: practiced a real section's chunks across several
  sessions and confirmed the run-through appeared/locked/reappeared at the
  exact expected thresholds (1, then hidden at 2, then locked at the
  penultimate session, then due again at 3), including the combo/transition
  case for a section spanning a hard-difficulty chunk.
- See [Algorithms.md](Algorithms.md#section-run-throughs).

**Decision (Pass 50): Piece Map's grid shows only base practice chunks;
transitions and combos are reached through a new "Related chunks" field
in the chunk-detail modal instead of their own grid tiles.**

- **Why:** the grid previously interleaved practice chunks, transitions,
  and combos as separate tiles, so it didn't run cleanly m.1 through the
  piece's last measure. Filtering to `kind === "section"` chunks alone
  gives that for free, since practice chunks are generated as contiguous,
  non-overlapping ranges.
- **Mechanism:** `findRelatedChunks(chunk, allChunks)` (`lib/utils.js`) —
  `findComboUnderlyingChunks` (`lib/revival.js`) run in reverse, reusing
  `rangesOverlap`. No `kind` filter needed to keep it correct in both
  directions: base chunks can never overlap each other by construction, so
  the same one function finds a base chunk's transitions/combos, or a
  transition/combo's base chunks, without special-casing. Clicking a
  related-chunk link opens *that* chunk's own detail in the same modal
  (`setSelected`, unchanged mechanism) — including its own related chunks
  in turn, so navigation never dead-ends even though a transition/combo
  has no grid tile of its own to return to.
- **Deliberate exception:** the filter is skipped when `PieceMapTab`'s
  `sequentialMode` prop is set — Revival's reassessment pass
  (`RevivalTab`) passes a different, already-curated chunk list
  (practice chunks + transitions, no combos) that it walks one at a time
  via its own Previous/Next, and unconditionally filtering would have
  silently dropped transitions from that flow entirely. Discovered by
  tracing `RevivalTab`'s usage before implementing, not after — a blanket
  filter would have been a real, silent regression to a feature this pass
  never intended to touch.
- **Verified:** `npm test` green (6 new tests for `findRelatedChunks`,
  mirroring `findComboUnderlyingChunks`'s existing test style). Manually
  in the browser: confirmed a 64-measure piece's grid ran mm.1–4 through
  mm.61–64 with no gaps and no transition/combo tiles; confirmed a
  base-chunk-to-transition-to-base-chunk round trip through "Related
  chunks," and a base-chunk-to-combo-to-all-three-base-chunks round trip
  for a section containing a hard-difficulty chunk.
- See [Architecture.md](Architecture.md).

**Decision (Pass 51): Progress's new "Estimated vs. actual practice time"
panel covers practice chunks, transitions, combos, and single-section
run-throughs — not the whole-piece consolidation run-through, and not
section-pair run-throughs.**

- **Why excluded, whole-piece run-through:** `"__consolidation__"` isn't a
  real chunk object — no `effort`, no `measureCount`, nothing to derive an
  estimate from. Structural, not a judgment call.
- **Why excluded, section-pair run-throughs:** the request's own enumerated
  list of covered kinds named single-section run-throughs specifically,
  and this codebase already treats single-section and section-pair
  run-throughs as two distinct, separately-named mechanisms (Pass 49
  above). Taken at face value rather than assumed to mean both.
- **Mechanism:** estimate is `effort * EFFORT_TO_MIN` for the three kinds
  that already carry a stored `effort`. Section run-throughs don't (see
  [Data-Model.md](Data-Model.md#practice-chunks-vs-sections-vs-transitions-vs-combos-vs-run-throughs))
  — their estimate is derived locally in `ProgressTab.jsx` from the same
  `measureCount * avgDifficulty` math transitions/combos already use
  (neither of those has a recurring-material discount either, so no
  `effortMultiplier` term is missing). "Recently practiced" reuses the
  Consistency panel's own trailing window rather than a second,
  independently-chosen number. Actual time sums *all* sessions'
  `durationSeconds`, skipped/provisional included — same "the time was
  genuinely spent either way" rule `sumPracticeSeconds` already
  established, not `loggedSessions()`-filtered like judgment-based
  metrics elsewhere on this same tab.
- **Chart scaling deliberately diverges from "Actual vs. planned
  progress"** (the pattern this panel reuses the visual language of): each
  item's pair is scaled to its own taller bar, not one shared scale across
  every item. A shared scale would make a two-minute chunk invisible next
  to a forty-minute run-through; the point here is each item's own
  estimate-to-actual ratio, not relative magnitude across different items.
- **Found and fixed in a follow-up, before this shipped in the sense of
  being trusted:** a critical review surfaced (by reproducing it live, not
  just reasoning about it) that a section with a backwards range
  (`end < start`) made the derived-effort math return `NaN`, which then
  poisoned *both* bars for that item via a shared `Math.max` denominator —
  including the otherwise-valid actual-minutes bar. Root-caused to
  `SectionsEditor.jsx` accepting a backwards range with zero validation
  (see the entry immediately below); this panel also got its own local
  guard (skip the item entirely if `measureCount < 1`) as defense for data
  already malformed before that fix existed.
- **Verified:** `npm test` green. Manually in the browser: built a real
  test piece, logged genuine sessions with real minutes across all four
  covered kinds, and hand-checked every resulting estimate against the
  underlying formula by hand — all matched exactly, including the derived
  section-run-through estimate. Separately reproduced the `NaN` case live
  (a backwards section with a real logged session), confirmed the exact
  predicted failure, then reproduced the fix removing it.
- See [Data-Model.md](Data-Model.md#practice-chunks-vs-sections-vs-transitions-vs-combos-vs-run-throughs).

**Decision/bug fix (same session as Pass 51): `SectionsEditor.jsx`
accepted a section's `end` before its `start` with no validation at all —
fixed by normalizing on every edit, not just flagged.**

- **What was wrong:** each start/end `NumberInput` in the Sections editor
  (Wizard and Settings both use this shared component) commits
  independently on blur. Nothing checked the pair together, so setting
  `end` below the section's current `start` (or vice versa) saved
  cleanly — no error, no red outline, no visual sign anything was wrong.
  Reachable through completely ordinary use, not a contrived edge case.
- **Why it mattered:** every consumer of `piece.sections[].start/end`
  (`weightedDifficultyFromArray`, `chunksBySectionId`, section run-through
  gating, Piece Map, and now Progress's estimated-vs-actual panel) assumes
  `start <= end` and never re-checks it. A backwards range made
  `weightedDifficultyFromArray` divide by a zero-or-negative count,
  producing `NaN` or `-0` depending on exactly how backwards it was.
- **Fix:** `updateSection` (`SectionsEditor.jsx`) now normalizes with a
  min/max swap on every commit — `{ start: Math.min(start, end), end:
  Math.max(start, end) }` — the same pattern `resizeSections`
  (`lib/utils.js`) already uses for the analogous "total measures
  changed" case, rather than inventing a new one. A valid edit (the
  common case) is unaffected; only an edit that would leave the pair
  backwards gets auto-corrected.
- **Verified live, before and after:** reproduced the exact bug (set a
  12-measure section to `mm. 2–1`, saved, confirmed the `NaN` appeared in
  Progress's new panel and visibly collapsed both of that item's bars),
  then applied the fix and reproduced the *same* edit sequence
  self-correcting to `mm. 1–2` on commit instead. `npm test` green, build
  clean.
- See [`CLAUDE.md`](../CLAUDE.md)'s "Rules that matter every session" for
  the standing invariant this establishes.

**Decision (Pass 70 + same-session follow-ups): "N chunks behind" became
"N days behind" everywhere it's shown, and the shared reschedule banner's
own visibility widened to match.**

- **What changed:** a new `countBehindDays(piece, timeline, currentDay)`
  (`lib/scheduling.js`) counts distinct timeline days `classifyDayCompletion`
  calls `"behind"`, as a day-count sibling to `computeScheduleStatus`'s
  chunk-count `missedCount`. `ScheduleBanner`, Master Agenda's per-piece
  badge/footer, and Overview's first-week note all display this instead of
  `missedCount` now — several missed chunks piled on one day used to
  inflate the shown number past the actual number of days a learner needs
  to catch up on.
- **Found in review, before commit, and fixed the same session:** switching
  Master Agenda's badge/footer *text* to `behindDaysCount` without also
  switching its footer *color* left the two disagreeing — a piece could
  read "N days behind schedule" in plain ink instead of the alarming
  brick color every other "behind" state uses. Fixed by driving all three
  (badge, text, color) off `behindDaysCount` — `missedCount` is no longer
  read anywhere inside `MasterAgendaTab`'s `renderPieceCard`.
- **A deeper, deliberately-requested follow-up:** `missedCount` only ever
  looks at base practice chunks (`computeScheduleStatus`'s `practiceChunks`
  loop) — it has no visibility into transitions, combos, or reviews. That
  meant a piece with every practice chunk touched at least once, but a
  transition/combo/review still sitting unlogged past its scheduled day,
  read as fully caught up to `shouldShowScheduleBanner` — the shared
  banner (Overview, Today's Practice, Timeline) went completely silent,
  even though Today's Practice's own "Go to Day N" catch-up button
  (`findEarliestBehindDay`, Pass 67) had *already* found a real day to
  jump to via the same `classifyDayCompletion` scan `countBehindDays` now
  reuses — the button was computed correctly and then hidden behind this
  narrower gate. `shouldShowScheduleBanner` now takes `countBehindDays`
  instead of `missedCount`, closing that dead end.
- **Initially left un-widened, then fixed the same session on direct
  request: the bulk "Reschedule all" mechanism** (`behindItems` filter on
  `MasterAgendaTab`, and `planRescheduleForPieces`/`handleRescheduleAll` in
  `App.jsx`). The risk that stopped this the first time was real: a piece
  whose only open item is a transition/combo/review genuinely has no
  untouched practice-chunk material for a reschedule to move (same
  reasoning the single-piece `handleReschedule` already encodes in its own
  graceful-empty-state alert — "there's nothing left to reschedule... check
  View all"). Widening `behindItems` to `behindDaysCount` without also
  widening the click-time path would let a piece appear in the "N pieces
  are behind schedule" panel yet contribute nothing to
  `handleRescheduleAll`'s plan list — and if it were the *only* qualifying
  piece, clicking "Reschedule all" would silently do nothing at all, with
  no explanatory message the way the single-piece path has.
  - **The actual fix, once asked for:** a new `findStuckBehindPieces(pieces)`
    (`lib/scheduling.js`) finds exactly the pieces `planRescheduleForPieces`
    will never include — same eligibility gate (active, not mid-revival,
    real timeline, plan not actually complete), refactored into a shared
    internal `eligiblePieceContext(piece)` helper so the two functions
    can't drift apart on *that* question — but where
    `remainingChunkIds.length === 0` and `countBehindDays(...) > 0`.
    `planRescheduleForPieces` itself is otherwise unchanged (same public
    contract, same return shape — its existing test suite passed unmodified
    after the refactor). `MasterAgendaTab`'s `behindItems` now reads
    `behindDaysCount`, matching its own per-card badges. `handleRescheduleAll`
    calls both functions: if `planRescheduleForPieces` finds nothing at all
    but `findStuckBehindPieces` does, an explanatory `window.alert` names
    those pieces and points at "View all" on Today's Practice — the bulk
    form of `handleReschedule`'s existing single-piece message. If
    `planRescheduleForPieces` finds *some* pieces but not all of what the
    panel counted, the confirmation dialog gets an extra paragraph naming
    the excluded ones and why, so its count can never silently diverge from
    what the panel promised.
- **Verified:** `npm test` green — 572 tests, including five new
  `findStuckBehindPieces` tests (a piece with every practice chunk touched
  but a transition stuck is found here and *not* by
  `planRescheduleForPieces`; a piece with real reschedulable material is
  *not* double-counted here; paused/archived/mid-revival/genuinely-finished
  pieces are excluded, matching `planRescheduleForPieces`' own exclusions)
  and the `shouldShowScheduleBanner` regression test noted above.
  Re-ran the full suite again after the `planRescheduleForPieces` refactor
  specifically to confirm its existing ~15 tests still passed unmodified —
  they did. Manually in the browser: the existing behind-schedule test
  piece (real untouched chunks, not the stuck-only case) still shows "1
  piece is behind schedule" and a "Reschedule all" confirmation dialog with
  no stuck-note paragraph, confirming the ordinary case is unaffected by
  this widening. The stuck-only scenario (every practice chunk touched,
  only a transition/combo left) was verified via the regression tests
  above rather than hand-built in the browser — reproducing it through the
  UI would mean manually logging every chunk in a real multi-chunk piece
  while deliberately never logging one specific transition, which the
  fixture-based test proves more reliably and repeatably than a one-off
  manual pass could.
- **Verified (Pass 70's original day-count display change):** `npm test`
  green (a regression test constructs a piece with every practice chunk
  logged but its transitions never touched, and asserts
  `shouldShowScheduleBanner` returns `false` with the old `missedCount`
  signal and `true` with the new `countBehindDays` one — see
  `test/scheduling.test.mjs`). Manually in the browser: the existing
  behind-schedule test piece shows the identical "11 days behind" figure
  across Overview, Today's Practice, Timeline, and Master Agenda's badge
  and footer (color included) after this change, confirming no regression
  in the common case.
- See [Algorithms.md](Algorithms.md#behind-schedule-detection).

**Decision (Pass 65, mitigated but not fixed; Pass 73, the actual fix): a
connector's own logged status is now checked directly, instead of being
inferred from its neighbors.**

- **The bug, reported precisely by the user and confirmed directly against
  the code:** `computeScheduleStatus` — the function every reschedule path
  uses to decide what's "remaining" — was called with
  `chunkSet.practiceChunks` only, at every call site
  (`handleReschedule`/`App.jsx`, `planRescheduleForPieces`/`lib/scheduling.js`).
  Transitions and combos never entered its "remaining" concept at all.
  Worse, `getEffectiveTimeline`'s own `remainingTransitions`/`remainingCombos`
  filters didn't check a transition's or combo's own logged status either —
  they inferred it indirectly, from whether at least one of its
  flanking/linked chunks was still untouched. Once both flanking chunks had
  been practiced at least once, a transition dropped out of that filter —
  even with zero `doneDays` of its own — and was never re-placed by any
  future reschedule. It just kept whatever day the original
  `computeTimeline` call gave it, permanently, no matter how many times the
  piece was rescheduled. A partial, deliberate mitigation already existed
  in `handleReschedule`: when literally every practice chunk was touched,
  it showed an explanatory alert instead of silently doing nothing — but
  that only covered the case where nothing else was left at all. When
  other chunks were still genuinely remaining elsewhere in the piece, a
  reschedule proceeded normally and stranded the transition/combo with no
  warning whatsoever. Pass 65 shipped as scoped, confirmed by the user — a
  closer look afterward found real coordination gaps this scope didn't
  cover, spun off as Pass 73.
- **What Pass 73 initially assumed, and where that assumption broke:**
  Pass 73's own build order treated Pass 65's neighbor-inference filter as
  the *shipped fix* to coordinate other code around, not as the mitigation
  Pass 65's own bug report already named it. Attempting the originally
  scoped build (widen `handleReschedule`'s guard, keep
  `remainingChunkOrder` practice-chunk-only) surfaced a real, verified
  mechanical contradiction: an empty `remainingChunkOrder` can never
  satisfy a neighbor-membership filter, so "let the reschedule proceed"
  under that scope would have changed nothing observable for the
  connector. This was presented back to the user rather than guessed
  through, together with the two narrower options considered (suppress the
  alert without relocating anything; force an already-touched neighbor's
  id into `remainingChunkOrder` anyway, risking that chunk being
  re-scheduled as if newly unlearned). **The user asked for a third
  option: fix the actual root cause Pass 65's report identified.**
- **The fix:** `computeRemainingConnectorIds(piece, chunkSet)`
  (`lib/scheduling.js`) is `computeScheduleStatus`'s "ever touched" check
  applied directly to `chunkSet.transitions`/`chunkSet.combos` — no
  neighbor inference. Every marker constructor
  (`handleReschedule`/`planRescheduleForPieces`) now carries this as a new
  `marker.remainingConnectorIds` field, and `computeEffectiveTimeline`
  checks it *alongside* (not instead of) the original neighbor-inference
  filter, so a connector whose neighbor genuinely is still remaining still
  rides along exactly as before. Verified this doesn't misplace anything
  even when a connector's own neighbors are absent from the rescheduled
  remainder's chunk set (because they're already touched): `computeTimeline`'s
  transition/combo placement already falls back to the sub-plan's own
  halfway point when a linked chunk isn't present in that specific call's
  own chunk set — confirmed directly against a real piece, not just
  reasoned about. The one alternative rejected: forcing an already-touched
  neighbor's id into `remainingChunkOrder` just to give the old filter
  something to match, which would have re-scheduled that neighbor as if
  newly unlearned.
- **Coordinated alongside the fix:** `handleReschedule`'s guard and
  `planRescheduleForPieces`' eligibility check both now treat a
  "qualifying connector" (untouched AND actually overdue — the same
  `introducedDay < currentDay` gate `missedCount` applies to practice
  chunks) as an independent reason to proceed instead of
  alerting/excluding. The confirmation dialog for a connector-only
  reschedule now says "N transition(s)/focus block(s)" instead of the old,
  literal "0 chunk(s)". The three "is this moved" display checks
  (`DayChecklist.jsx`/`TodayTab.jsx`/`TimelineTab.jsx`) each now also check
  `marker.remainingConnectorIds` directly, alongside their pre-existing
  (and already-correct) neighbor check. `findStuckBehindPieces` (Pass 70's
  own follow-up) was updated to exclude a piece now handled via a
  qualifying connector, so it can't appear in both "reschedulable" and
  "nothing to reschedule" in the same confirmation flow.
- **Same-session follow-up, flagged then requested:**
  `computeMinutesModeAutoExtend`'s own marker construction
  (`lib/scheduling.js`) also builds a `rescheduleMarker` — initially left
  out of scope and flagged as a related gap, then fixed once asked for.
  This is arguably the call site where the bug matters most: this
  function's own existing comment already notes that `remainingChunkIds`
  is "typically empty here," since `computeTimeline`'s halfPoint rule
  guarantees every practice chunk was introduced well within the
  *original* plan by the time a minutes-mode piece needs auto-extending —
  meaning a connector's own logged status was the *only* signal that could
  ever have caught a stuck one on this path. Fixed with the identical
  pattern: `computeRemainingConnectorIds(piece, chunkSet)` computed
  alongside `remainingChunkIds`, carried as
  `rescheduleMarker.remainingConnectorIds`. `estimateRescheduleFit`'s
  effort estimate stays practice-chunk-only — a connector-only reschedule's
  "does this fit" check doesn't factor in the connector's own time cost (in
  practice this doesn't produce a wrong "doesn't fit" warning, since zero
  remaining practice-chunk effort trivially always "fits").
- **Verified:** `npm test` green — 575 tests, including three new tests
  that confirm actual *relocation* (not just that eligibility/guard logic
  passes), one per marker-constructing call site
  (`handleReschedule`, `planRescheduleForPieces`,
  `computeMinutesModeAutoExtend`): a piece with every practice chunk
  touched but one transition genuinely stuck is rescheduled/extended, and
  the transition is confirmed present in the resulting remainder's own
  days, not just absent from an alert. Three pre-existing tests were
  updated to match the new, correct behavior — one asserted a
  stuck-connector piece had "nothing to reschedule" (that was the bug; now
  it correctly finds something), one needed its expected marker shape
  updated for the new field, and one needed its fixture to actually touch
  every chunk (including transitions) to mean what its name claimed.
  Manually in the browser: built a real 12-measure piece, logged every
  practice chunk while deliberately leaving its two transitions untouched,
  confirmed the reschedule dialog said "2 transition(s)/focus block(s)"
  (not "0 chunk(s)"), applied it, and confirmed across Timeline, "View
  all", and single Day view that the transitions' old single-item days
  collapsed to "Tasks rescheduled" while old days with a genuine mix of
  moved and still-legitimate content correctly stayed live (Pass 48's
  partial-day rule, unaffected) — and that the transitions reappeared as
  live, loggable content on new days within the rescheduled remainder. The
  `computeMinutesModeAutoExtend` fix itself was verified at the unit-test
  level only (not separately reproduced live in the browser) — its
  trigger condition (a minutes-mode piece already past its own day count)
  is the same mechanism already covered end-to-end for the other two call
  sites, and the fix is line-for-line the same pattern.
- **Same-session follow-up, found in a critical second-pass review before
  commit, all three fixed on request:**
  1. **`handleRescheduleAll` (`App.jsx`) had the identical "0 chunk(s)"
     wording bug** the single-piece dialog had already been fixed for —
     missed the first time because that message wasn't touched during the
     original fix, and before this pass, `planRescheduleForPieces` could
     never have included a connector-only piece in the first place, so the
     bug was unreachable until the fix above made it reachable. Now sums
     `remainingConnectorIds` across every included piece the same way
     `totalChunks` already summed `remainingChunkOrder`, and names both
     ("N chunk(s) and N transition(s)/focus block(s)") using the identical
     three-way phrasing the single-piece dialog uses. Verified live: built
     a second connector-only test piece, triggered "Reschedule all" across
     it plus a genuinely-missed-chunks piece, and confirmed the dialog read
     "16 chunk(s) and 17 transition(s)/focus block(s)" — the connector
     count checked out exactly against both pieces' own untouched
     transitions, including the ordinary piece's, which had never been
     specifically exercised before.
  2. **`planRescheduleForPieces`'s eligibility guard had a second,
     provably-redundant OR'd condition** left over from an earlier,
     more defensive first draft of the connector fix — whenever the first
     half of the check was false, the second half always was too (a
     missed practice chunk implies `remainingChunkIds > 0`; a qualifying
     connector implies `remainingConnectorIds > 0`), so it never
     independently changed the outcome. Simplified to the one condition
     that actually does the work; full test suite re-confirmed unchanged
     behavior.
  3. **The "furthest behind first" sort in the same function keyed on
     `missedCount` alone**, which is always exactly 0 for a
     connector-only piece by construction — meaning such a piece always
     sorted dead last in the bulk confirmation's naming order, no matter
     how long its connector had actually been stuck. Now sorts on
     `missedCount + remainingConnectorIds.length`, a simple combined
     weight that at least gives a stuck connector some influence on the
     order instead of an implicit "least behind" default. New regression
     test: two connector-only pieces with different connector counts,
     confirming the one with more sorts first rather than by insertion
     order (the previous behavior when both tied at `missedCount === 0`).
  - **Verified:** `npm test` green — 576 tests. Manual browser
    verification of fix (1) as described above; fixes (2) and (3) are
    pure logic/ordering changes with no new browser-observable surface
    beyond what the existing verification already covered.
- See [Algorithms.md](Algorithms.md#rescheduling).

**Decision (Pass 74): reschedule and the schedule banner anchor to the
real current day, not whichever day is currently being browsed.**

- **The bug, reported precisely: a reschedule confirmed while browsing a
  past day (via Timeline or Today's Practice's day-nav) saved a marker
  anchored to that past day, not today** — e.g. clicking Reschedule while
  paged to day 19 wrote `rescheduleMarker.asOfDay: 19` even though real
  elapsed time put "today" at day 29. `App.jsx` had always computed two
  separate values — `realCurrentDay` (real elapsed time, clamped to the
  plan) and `currentDay = dayOverride || realCurrentDay` (whichever day
  Timeline/day-nav is currently showing) — but `handleReschedule`'s
  `computeScheduleStatus` call, its overdue-connector filter,
  `estimateRescheduleFit`, and the marker's own `asOfDay` all read the
  browsed `currentDay`. `ScheduleBanner`'s `countBehindDays` call inherited
  the same bug at one remove, since it just took whatever `currentDay` its
  caller passed straight through.
- **The fix:** every one of those reads now uses `realCurrentDay` instead.
  `ScheduleBanner` takes a `realCurrentDay` prop and no longer accepts
  `currentDay` at all — nothing else in the component read it, so once its
  one internal use switched, the prop itself was removable rather than
  merely unused. `OverviewTab`, `TodayTab`, and `TimelineTab` (the three
  `ScheduleBanner` call sites) each gained a `realCurrentDay` prop threaded
  from `App.jsx`'s existing variable. `TodayTab`'s `findEarliestBehindDay`
  (the Pass 47 catch-up-button scan) got the identical fix for the
  identical reason — its scan boundary and `classifyDayCompletion` call
  now use `realCurrentDay`, so the button's target can't shift depending
  on what's on screen. Every *other* `currentDay` use in those three
  components — the day-list display, week-index selection, and per-day
  completion checks for whichever day is actually being browsed — is
  deliberately untouched; those are correctly about the browsed day, and
  conflating them with schedule-eligibility was never the bug.
- **Checked and confirmed still safe, not changed reflexively:**
  `TodayTab`'s `needsRescheduleNudge`/`hasReschedulableWork` (the "past
  your target date" prompt, and the practice-chunk-only reschedulability
  gate feeding it) both compute off `currentDay`, matching the pattern this
  pass fixed everywhere else — but `needsRescheduleNudge` is itself gated
  on `isRealToday`, which is only ever true when `currentDay === realCurrentDay`
  by construction. Verified this by reading the surrounding code rather
  than trusting the variable name alone, per the pass's own instruction not
  to change it reflexively just because it matched the pattern.
- **On successful confirm, `App.jsx` now also resets `dayOverride` to
  `null`** (`handleConfirmReschedule` and
  `handleConfirmRescheduleWithExtension`) — the same reset `onJumpToday`
  already used. Once a reschedule anchors correctly to `realCurrentDay`,
  there's nothing incomplete left before today for a browsed past day to
  keep showing, so landing back on today automatically is both the fix's
  natural consequence and what the original bug report actually wanted.
- **Same-session follow-up, found during this pass's manual verification
  and fixed on request:** `countBehindDays` had no notion of Pass 48's
  "fully swept into a reschedule" collapse the way `TodayTab`/
  `TimelineTab`'s own day lists do (they apply an `isFullySwept` check
  before calling `classifyDayCompletion`; `countBehindDays` didn't).
  Confirmed live: immediately after a reschedule that swept every
  pre-reschedule day, `ScheduleBanner` still read "18 days behind
  schedule" — the same figure as before the reschedule — even though every
  one of those days now correctly showed "Tasks rescheduled" and the
  earliest-behind-day scan (which does apply the sweep filter) correctly
  found nothing, so the "Go to Day N" button disappeared while the
  adjacent day-count kept citing the stale number. Not something
  `realCurrentDay` anchoring caused — `countBehindDays` was already
  anchored to the correct day both before and after that fix; it simply
  never learned about the sweep.
  - **The fix:** `isDayFullySwept(day, piece, chunkById = {})`
    (`lib/scheduling.js`) extracts the one rule `TodayTab`/`TimelineTab`/
    `DayChecklist` each already duplicated locally — a day before the
    marker's `asOfDay` whose every scheduled id is accounted for on the
    marker (directly, or a connector riding along via a linked practice
    chunk) reads as moved, not behind. `countBehindDays` gained a fourth,
    optional `chunkById` parameter and now excludes a fully-swept day from
    its count. Every call site (`ScheduleBanner`, `OverviewTab`,
    `MasterAgendaTab`'s two sites, `findStuckBehindPieces`) was updated to
    supply a `chunkById` built from whatever chunk set it already had in
    scope — none needed a new one computed just for this. The three
    existing local `isFullySwept` implementations were deliberately left
    alone: they already worked correctly and weren't the reported bug, so
    folding them into the shared function too would have been an
    unrequested refactor riding along with a bug fix.
  - **Verified:** four new regression tests
    (`test/scheduling.test.mjs`, "Pass 74 follow-up — countBehindDays
    excludes days fully swept into a reschedule") — a fully-swept day
    excluded even with nothing logged; a day with a genuine mix of swept
    and still-real content still counts (only a *fully* swept day is
    excluded); a day at or after the marker's `asOfDay` is never treated
    as swept; and the connector-linkedIds fallback only fires when
    `chunkById` is actually supplied. Confirmed each of the two
    exclusion-behavior tests can actually fail: temporarily reverted
    `countBehindDays` to drop the `isDayFullySwept` filter, re-ran the
    suite, watched both fail with the exact stale counts the bug produced
    (2 instead of 0, 1 instead of 0), then restored the fix. Manual,
    in-browser: rebuilt the same reproduction piece as the anchoring fix
    above, rescheduled it from "18 days behind," and confirmed the banner
    disappeared entirely afterward (the piece is genuinely no longer
    behind) on Overview, Timeline, and Today's Practice alike — instead of
    the stale "18 days behind schedule" it showed before this follow-up.
- **Verified (the `realCurrentDay`-anchoring fix itself):** `npm test`
  green — 580 tests total, including the four new ones above (the
  anchoring fix itself changed no `lib/`-level behavior — every edit there
  is either prop threading or which already-existing variable a call site
  reads, both living in `App.jsx`/component props). Manual, in-browser,
  with a real piece (`startDate` set ~18 days in the past, 39-day plan,
  zero sessions logged): confirmed the banner read "18 days behind
  schedule" identically whether browsing day 1 (past), day 30 (future), or
  real-today (day 19); confirmed the "Go to Day 1" catch-up target didn't
  move across any of those browsed days; clicked Reschedule while parked
  on day 1 and confirmed via `localStorage` that the saved
  `rescheduleMarker.asOfDay` was `19` (real today), not `1`; confirmed the
  confirm landed back on "Day 19 of 39" with no "(viewing)" suffix, and
  that the catch-up button was gone (nothing left for it to point at, now
  that Pass 73 is also shipped); confirmed Overview's and Timeline's
  banners read correctly ("18 days behind schedule") even when switched to
  directly from Today's Practice while still parked on a past day, without
  returning to today first.
- See [Algorithms.md](Algorithms.md#rescheduling).

**Decision (Pass 75, follow-up to Pass 73): Week view and Master Agenda
get the same reschedule-sweep collapse Day view and Timeline already had —
built as calls to the existing shared `isDayFullySwept`, not new local
logic.**

- **The report:** a rescheduled day still showed its stale, real-looking
  tasks in Week view; clicking into the identical day (Day view) already
  correctly read "Tasks rescheduled." The pass's own build instruction was
  explicit that a *partial* port (Pass 73's own-state connector check
  alone, without the original Pass 48 neighbor-based condition, or vice
  versa) would still be wrong for the ordinary case — these two surfaces
  had never had *either* half.
- **Why this came out simpler than the instruction implied:** the same
  session's earlier Pass 74 follow-up had already consolidated the three
  existing duplicated `isMovedId`/`isFullySwept` closures
  (`DayChecklist`/`TodayTab`/`TimelineTab`) into one shared
  `isDayFullySwept(day, piece, chunkById)` (`lib/scheduling.js`), which
  already carries both halves — the direct marker-membership check and the
  connector-linkedIds fallback. So "build the full logic" here meant
  calling that one function from two more places, not writing a fourth and
  fifth copy of it. Worth flagging as a genuine, if small, build-order
  discovery: had Pass 75 been written before that consolidation happened,
  its own instruction to "build the full logic, not a partial port" would
  have been asking for a real port of ~15 lines of duplicated closure code
  into two more files, not a two-line call site addition — the actual
  work this pass needed was smaller than the pass description anticipated,
  purely as a downstream benefit of an unrelated same-session refactor.
- **`WeekView.jsx`:** computes `isFullySwept` per day inline (next to the
  existing `specialIsCombo` line) and branches on it in the same order
  Timeline's day cards already use — `consolidation` → `rest` →
  `isFullySwept` → normal content. No new prop needed; `piece` was already
  passed in from `TodayTab`.
- **`MasterAgendaTab.jsx`:** computes `isFullySwept` once per piece inside
  the `agendaData` `useMemo` (where `chunkById` is already built for this
  piece) and carries it as a new field on the pushed item, the same
  pattern `behindDaysCount` already uses. `renderPieceCard` — the one
  render function shared by both the Learning-phase and Maintenance-due
  card lists, so both get the fix from a single change — branches on it
  right after its existing `consolidation` check.
- **The "review" question — initially flagged, not built, per the pass's
  own instruction; resolved later the same session once the user came
  back and asked for it directly.** The pass offered two readings of
  "review should be pulled forward the same way" and required confirming
  which was meant before writing any review-specific code. Confirming it
  directly with the user surfaced a third, more precise framing, and
  tracing the actual mechanism (`computeTimeline`'s Tier 2 placement,
  `lib/scheduling.js`) showed the real issue isn't reschedule-specific at
  all — a review's placement day can go stale relative to today
  regardless of whether a reschedule ever happened, since `computeTimeline`
  has no concept of "today" to begin with. Fixing it properly touched
  every past-day display surface in the app, not just this pass's two
  files — the user chose to scope it out as its own effort at first,
  rather than build it under an expanded, unplanned scope, then asked for
  exactly that effort once Pass 75 itself was done and committed. See
  [Open questions](#open-questions) for the full write-up, including the
  fix and a real Tier-1-review bug found and corrected before it shipped.
- **Verified:** full test suite green (580 tests — no `lib/`-level code
  changed, `isDayFullySwept` itself untouched, only two new callers) and
  `npm run build` clean. Manual, in-browser, reproducing the original
  report: built a test piece 18 days behind schedule, confirmed Week view
  showed real content pre-reschedule, rescheduled it, and confirmed every
  swept day (16, 17, 18) now reads "Tasks rescheduled" in Week view,
  matching Day view exactly for the same day (16) checked side by side.
  Same check for Master Agenda: browsing its date picker to a swept day
  (Aug 30) showed "Tasks rescheduled" on the piece's card; browsing to a
  genuinely still-scheduled day (Sep 5, post-reschedule) showed real
  content and a correct "3 days behind" badge — confirming the new check
  doesn't over-collapse a day with legitimate remaining work.
- See [Algorithms.md](Algorithms.md#rescheduling).

## Spaced repetition & maintenance

**Status: the stage-math engine, Tier 1/Tier 2 review scheduling,
post-run-through logging (stop count + the rough/lost flag mode), and
Revival's three auto-trigger conditions off that logged data are built and
live (Passes 1–7). A live "what's due" query beyond the current plan's
bounded length is now scoped (see the Pass 8 decision at the end of this
section) but not built.** Full design:
[Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built).
Evidence behind several choices below: [Research.md](Research.md).

**Decision: "learned" is redefined as every practice chunk's
spaced-repetition ladder card reaching Holding, not a calendar date
(`daysToLearn` running out).**

- **Why:** Closes the long-standing gap flagged in
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented) —
  nothing previously rolled per-chunk state up into a piece-level "done"
  milestone. A piece that consolidates fast now genuinely graduates fast;
  one that doesn't, doesn't, regardless of what the original plan guessed.
- **Consequence:** at the time this decision was made, `computeProgressTier`
  and `computeConfidence` were both unaffected — this doesn't resolve
  which of the app's "how good is this chunk" signals is canonical, it
  just defines a separate, piece-level "done" condition on top of
  whichever chunk-level signal(s) end up mattering. **Partially superseded
  by Pass 6**: `computeProgressTier` now reads `stage` directly too (see
  the decision below), so it's no longer independent of this one in the
  literal sense — both now key off the same ladder rung. Still true,
  though: this remains a piece-level rollup (every chunk at Holding) that
  nothing yet computes, distinct from `computeProgressTier`'s existing
  per-chunk bucketing that merely happens to also read `stage` now.
  `computeConfidence` itself is still unaffected, unchanged from the
  original claim.

**Decision: learning-review and maintenance are one continuous ladder
mechanism, not two separate systems.**

- **Why:** Avoids exactly the "parallel systems" pitfall
  [AI-GUIDELINES.md](AI-GUIDELINES.md#prefer-extending-existing-systems-over-creating-parallel-systems)
  warns about — a piece doesn't switch into a differently-built
  "maintenance mode," it just has more of its cards sitting at the top of
  the same ladder every chunk has ridden since introduction.

**Decision (implemented, Pass 5): during the front-loaded introduction
window, reviews split into a near-mandatory Tier 1 (one-time, ~day 1) and
a flexible Tier 2 (the normal ladder cadence, allowed to roll later under
budget pressure) — lateness is schedule slack, never a review failure.**

- **Why:** New-chunk introduction and due reviews compete for the same
  daily budget while the piece is still being introduced. Letting reviews
  always win risks missing the "whole piece touched by the halfway point"
  coverage rule; letting introduction always win risks losing
  freshly-introduced material before it's ever reinforced. The two-tier
  split resolves the contention asymmetrically instead of picking one
  side outright: Tier 1 protects the fast, steep early-forgetting window
  (near-mandatory); Tier 2 absorbs the actual schedule pressure (flexible),
  because research on spacing found reviewing late costs gradually more
  while reviewing early costs almost nothing — see
  [Research.md](Research.md).
- **Alternatives considered:** reviews always take priority over
  introduction (rejected — breaks the coverage guarantee); introduction
  always takes priority (rejected — risks losing freshly-introduced chunks
  before Stabilizing's first real review).
- **Scope:** only applies during the front-loaded introduction window.
  Once nothing new is being introduced, due reviews simply compete
  oldest-due-first.
- **What actually shipped, beyond the design above** — three specifics
  three separate follow-up entries below cover in full:
  Tier 1 has to check for existing session history, not just ladder stage,
  to avoid mis-scheduling a "first touch" for an already-practiced legacy
  chunk; Tier 2's "rolls later under pressure" had to be made strictly
  forward-only after a bug let it drift a review earlier than its actual
  due date; and only ever the *next* due review is shown per chunk, not a
  precomputed future sequence, since that's all `nextDueDate` can express
  at any given moment. See
  [Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler)
  rule 4 for the mechanics.

**Decision: Tier 1 requires zero logged sessions, not just `stage === null`,
before it schedules a chunk a "first touch" review.**

- **Why:** Found via a Codex review of the Pass 5 diff, not anticipated in
  the original design. Migration (`backfillProgressLadderState`,
  `lib/storage.js`) sets `stage: null` on *every* pre-existing progress
  entry that predates the ladder feature — including a chunk with a long,
  real practice history logged before this feature existed. `stage` alone
  can't tell "genuinely never touched" apart from "practiced a lot, just
  not by this system yet." Without the additional check, every
  already-in-use piece would have had its practiced chunks wrongly
  scheduled a "first touch" review the moment this scheduling model went
  live — confirmed as reproducible with a test piece carrying 10 real
  logged sessions on a `stage: null` chunk.
- **Consequence:** a chunk in that state (real history, no ladder state
  yet) gets no review placed at all until it's next logged — at which
  point `handleLogSession` gives it real ladder state and it starts
  taking the Tier 2 path like any other chunk already on the ladder. No
  review is worse than a wrong one here; there was no principled due-date
  to derive for a chunk the ladder has no record of, short of retroactively
  replaying its whole pre-ladder session history through
  `computeLadderAdvance` — judged out of scope for this fix, not built.

**Decision: Tier 2's review-load smoothing only ever moves a review
*later*, never earlier than its actual due date.**

- **Why:** Found via manual browser verification during the Pass 5 build,
  not a Codex finding. The smoothing pass was reused unchanged from the
  pre-ladder fixed-offset system, which nudged a review ±1 or ±2 days in
  either direction — harmless there, since a fixed-offset review had no
  specific "due date" to violate. Reused as-is for Tier 2, that same
  bidirectional nudge could cascade a review *backward* across the
  smoothing pass's 3 iterations, chasing whichever neighboring day was
  least loaded at each step: a chunk with a real, correctly-computed due
  date of day 5 ended up placed on day 2 in one observed case — three days
  before it was ever due.
- **Consequence:** the smoothing pass's candidate days for a Tier 2 item
  are `day + 1`/`day + 2` only, never `day - 1`/`day - 2`. Matches the
  design's own framing — "rolls to the next day under budget contention"
  — literally, not just in spirit.

**Decision: `computeDaysNeededForMinutesPerDay`'s per-item review-cost
padding is reduced from a fixed 4 touches (`REVIEW_OFFSETS.length`) to a
rough 2.**

- **Why:** Found via Codex review of the Pass 5 diff. This estimate
  budgets extra effort per introduced item to account for review load
  landing on top of introduction later, so a "minutes per day" plan's
  length doesn't undercount what a day actually costs. It was written
  against the old fixed-offset scheduler, which guaranteed every item
  exactly 4 future review touches; `computeTimeline` no longer guarantees
  any fixed count (Tier 1/Tier 2 above), so the old constant systematically
  overestimated how many days a plan needs.
- **Why 2, not 1 or 0:** this function has no visibility into how a plan
  will actually be used (how often a chunk gets logged, how it performs),
  so there's no way to compute an exact figure here — only a deliberately
  rough, conservative one. Dropping all the way to 1 (or 0) risked
  under-provisioning and reintroducing the exact "technically enough for
  introduction alone, still runs over budget once review lands" bug this
  estimate exists to prevent (see the "days" mode's own padding, same
  section of [Algorithms.md](Algorithms.md#deriving-daystolearn-from-minutesperday-schedulemode-minutes)).
  2 was chosen as a middle ground, not derived — same "hand-picked, not a
  hard cap" spirit as the rest of this estimate.
- **Consequence:** "minutes per day" pieces set up after this change get a
  meaningfully shorter estimated plan length than before for the same
  inputs (roughly half, in one measured case) — not a bug, correcting an
  estimate that had been overshooting since Pass 5 landed.

**Decision: Holding's interval expansion reuses `adaptiveReviewOffsets`'s
existing 0.6×/1×/1.4× effectiveness multiplier rather than a new
multiplier system.**

- **Why:** Same reasoning as the Tier 1/2 split above — a second,
  independently-tuned multiplier system doing essentially the same job
  would be exactly the kind of duplication
  [AI-GUIDELINES.md](AI-GUIDELINES.md#prefer-extending-existing-systems-over-creating-parallel-systems)
  flags.

**Decision: replace the flat pass/fail session outcome with three tiers —
full pass, soft miss, real fail — and add `practiceBPM`, a per-chunk
"currently being asked for" tempo distinct from `targetBPM`.**

- **Why:** Grading every session against a distant fixed `targetBPM`
  (e.g. a deliberate overlearn tempo) produced repeated "almost but not
  quite" sessions that read as failure when the target itself was fine,
  just ungraded incrementally — the "plateau via frustration" problem.
  `practiceBPM` ratchets incrementally so tempo progress is graded against
  where the learner actually is, not the eventual goal — originally
  sketched here as +2 full pass / −2 soft miss / ~−8 to −10 real fail, but
  the real fail step shipped at −2 as well, the same magnitude as the
  other two; see the dedicated decision on this later in this section
  ("a real fail costs `practiceBPM` the same 2 BPM as a soft-miss").
- **Resolved:** the existing "how did it feel" effectiveness input does
  not survive as a separate input — folded into a single fail-only
  override instead. See the dedicated decision on this later in this
  section ("the old free-standing 'how did it feel' 3-tap effectiveness
  input... is removed").

**Decision (implemented, Pass 7): revival gets three independent,
separately-checked auto-trigger conditions (stop count > 5 on a
run-through; a combo or 2+ regular chunks flagged lost, checked as
current-state, not per-event; 60+ days since anything logged) rather than
one unified formula.**

`computeRevivalTriggers(piece, chunkSet)` (`src/lib/revival.js`)
implements this, called from `OverviewTab` to drive the "This piece might
be due for a revival" banner (suppressed while a revival is already
active). Returns every condition that independently fired, not just the
first — see [Algorithms.md](Algorithms.md#revival-auto-triggers-pass-7)
for the full mechanics.

- **Why:** Conditions 1 and 2 can only fire if a run-through was actually
  attempted and logged. A piece nobody's touched in two months has no data
  to trip those even though it would almost certainly meet them if
  attempted — condition 3 is a distinct fallback for exactly that case,
  not a diluted version of the other two. Unifying them into one formula
  would hide that a piece can fail this test for a reason none of the
  logged-data conditions can see.
- **Note on condition 2's scope:** "regular practice chunks" and "a combo"
  deliberately excludes transitions — a transition flagged lost doesn't
  count toward either half of this condition, even though it's a real
  chunk-shaped entity with the same `flag` field. Transitions are seams
  between chunks, not independent practice content, so a transition alone
  going lost isn't the "large chunk lost" signal this condition is for.
- **Note on `lastLoggedAt: null`:** condition 3 deliberately does not fire
  when nothing has ever been logged at all. It reads as a fallback for a
  piece with real but aging activity, not a catch-all for a
  freshly-created piece with zero data — a brand-new piece isn't "overdue
  for revival," it just hasn't started.

**Bug fix (found and fixed while building condition 3 above): `lastLoggedAt`
was silently excluding run-through activity, which would have made
condition 3 fire falsely for exactly the pieces most likely to be revival
candidates via condition 1.**

- **What was wrong:** `computeLastLoggedAt` (`src/lib/storage.js`), which
  recomputes `piece.lastLoggedAt` fresh on every piece load, explicitly
  skipped the `"__consolidation__"` progress key when scanning for the
  most recent session date. That exclusion predates Pass 7 — it was
  originally written for `backfillProgressLadderState`'s ladder-state
  backfill, where skipping the synthetic entry is correct (it isn't a real
  chunk, so it has no ladder stage to backfill), and `computeLastLoggedAt`
  copied the same `key === "__consolidation__"` guard without it actually
  applying to what that function does.
- **The consequence:** a piece practiced *only* via full run-throughs
  (Pass 6's stop-count logging, no individual chunk sessions at all) would
  have `lastLoggedAt` stuck at whatever it last was before the exclusion
  — `null` for a piece that had never logged a real chunk session — on
  every reload, even immediately after logging a run-through. In a single
  browser session this wasn't visible (`handleLogRunThrough` in `App.jsx`
  sets `piece.lastLoggedAt` directly in memory on every call, independent
  of the storage-layer recompute), but the discrepancy surfaced the moment
  the page reloaded and `validateAndMigratePiece` recomputed it from
  scratch. That's exactly the scenario condition 1 (stop count > 5) is
  built to catch, so the piece most likely to actually need this fix was
  also the piece most likely to give condition 3 a wrong answer.
- **The fix:** removed the `"__consolidation__"` special case from
  `computeLastLoggedAt` entirely — it now scans every progress entry's
  `sessions` uniformly, `"__consolidation__"` included. Verified with new
  regression tests (`test/storage.test.mjs`) covering a piece whose only
  activity is a run-through, and a run-through that is/isn't more recent
  than a real chunk session.
- **Why this wasn't a two-line silent patch:** discovered during manual
  browser verification of condition 3 (setting `piece.lastLoggedAt`
  directly in `localStorage`, then finding it reset on reload) — flagged
  to the user as a discovery per the pass's own "surface it, don't
  silently adjust" instruction, then fixed as a separate, explicit step
  once confirmed. See [Data-Model.md](Data-Model.md#the-piece-object)'s
  `lastLoggedAt`/`progress` field comments for the corrected behavior.
- **Separate, smaller fix caught in self-review:** `computeRevivalTriggers`
  itself originally guarded `piece.progress` with `|| {}` for condition 1
  but dereferenced `piece.progress[c.id]` directly (unguarded) for
  condition 2 — inconsistent, and a real (if unreachable in practice,
  since `App.jsx` always passes a post-migration piece) crash risk if ever
  called with a bare `piece` object. Fixed by deriving `progress = piece.progress || {}`
  once and using it throughout the function; covered by a regression test
  passing `{}` as the whole piece.

**Decision (implemented): combos do not get their own revival task by
default. Revival relearns the underlying content normally (the anchor hard
chunk, plus whichever neighboring chunk(s) the combo's midpoint-to-midpoint
range overlaps); if any of that underlying content produces a real fail,
the combo escalates into its own explicit revival task; if everything
relearns cleanly, no task is ever generated.**

`computeComboEscalations` and `findComboUnderlyingChunks`
(`src/lib/revival.js`) implement this, rendered in `RevivalTab.jsx` as a
"Needs another look" panel. The "lost" flag mentioned below (now
`progress[id].flag === 'lost'`, built in Pass 6) doesn't drive this
escalation mechanism at all — escalation is computed live from session
outcomes regardless of any flag, so there's nothing to "clear" in the
first place — see the consequence note below. What Pass 6's flag data
feeds instead is Revival's separate stop-count/lost-flag auto-trigger
conditions above (`computeRevivalTriggers`, built in Pass 7) — a
different mechanism from combo escalation, reading the same field for a
different purpose (deciding whether to *offer* a revival at all, not
what to relearn once one's running).

- **Why:** This supersedes the current `computeRevivalPlan` code comment
  (`src/lib/revival.js`), which excludes combos from revival statically
  and unconditionally — investigated directly: that comment was written
  confidently, alongside the code, in the commit that first built Revival,
  but has no trace anywhere (this doc included) of the exclusion
  specifically being surfaced and confirmed, unlike every other
  genuinely-discussed revival scoping call below, which lists alternatives
  considered. Treated as an unreviewed assumption, not a settled decision,
  and now superseded by the dynamic behavior above.
- **Alternatives considered:** (a) exclude combos entirely, as the current
  code does — rejected because it leaves a "lost" flag with no path to
  clearing, risking either a permanently-flagged combo or revival
  re-triggering immediately after it just finished, since the condition
  that caused the trigger is never actually resolved. (b) always give
  combos their own dedicated revival task — rejected as likely redundant,
  since a combo isn't independent content, it's composite territory
  already covered by relearning its constituent chunks.
- **Resolved: a single real fail is enough**, confirmed with the user —
  not the ladder's two-consecutive-fails threshold. Revival is already
  "something's wrong" mode by the time it's running, unlike ordinary
  practice, where that dampening exists specifically to avoid overreacting
  to one bad day.
- **Resolved: escalation is a live derivation, not a task written into
  `piece.revival.plan`.** `computeComboEscalations(piece, chunkSet)`
  recomputes on every render from `piece.progress` session history
  (filtered to `loggedAt >= revival.startedAt`) — it isn't stored
  anywhere, and `computeRevivalPlan`'s stored output is never mutated to
  insert it. Confirmed with the user over the alternative (append a new
  day to `revival.plan.days`): matches this codebase's existing rule that
  `chunkSet`/`timeline` are pure, unpersisted derivations off `piece`
  (CLAUDE.md) — a derivation can't drift out of sync with what actually
  happened, and automatically stops returning a combo once nothing in the
  qualifying history is a fail, so "the flag clears automatically" (this
  decision's original framing, written before the "lost" flag it assumed
  existed was actually built) falls out for free rather than needing an
  explicit clear step. Rendered in `RevivalTab.jsx` as a separate "Needs
  another look" panel, not folded into the day-by-day list — so no
  fabricated "day N+1" that would misleadingly imply it's genuinely
  scheduled/ordered rather than an urgent flag.
- **Architectural note, superseded by the above:** the original write-up
  of this decision assumed a revival plan couldn't stay a fixed list
  generated once upfront, the way `computeRevivalPlan` builds it
  ([Algorithms.md#revival](Algorithms.md#revival)) — expecting a decision
  point mid-revival that could *insert* a task that wasn't there at the
  start. What got built sidesteps that entirely: `computeRevivalPlan`'s
  output is still exactly that fixed, once-generated list (confirmed by a
  regression check — identical output whether or not any fails occurred),
  and the escalated task lives entirely outside it as a parallel, live
  derivation. Worth knowing for [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-unifying-idea)'s
  broader claim that the ladder and revival share "the same shape of
  problem" needing persisted, event-driven state instead of a pure
  derivation — the ladder genuinely does (Pass 2's `computeLadderAdvance`
  writes real state), but revival's combo-escalation piece of that claim
  turned out not to, once actually built. This is still the first concrete
  piece of revival's "not fully specced" internal structure, and whatever
  replaces or extends
  `computeRevivalPlan` needs to account for it generally, not just for
  combo-handling. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#revival-auto-triggers)
  for the full write-up.

**Decision: `computeComboEscalations` judges each underlying chunk strictly
by its own latest qualifying session, never by a single global
"most recent session across everything" — took three iterations to land
correctly, worth recording why.**

- **Why:** the first version pooled every underlying chunk's sessions
  together with the combo's own dedicated-task sessions and picked one
  globally-newest session across all of them to decide pass/fail. That's
  wrong whenever the chunks disagree: if chunk A failed and chunk B was
  *later* passed, B's unrelated pass incorrectly cleared A's still-standing
  failure — the combo would stop showing as "Needs another look" even
  though the content that actually failed was never relearned. A second
  version (in reaction to that bug) swung to the opposite failure mode:
  scanning for "any fail ever" during the revival run, with no recency
  check at all — this fixed the false-clear but introduced a new bug, a
  combo pinned permanently escalated for the rest of the run even after
  the chunk that failed was subsequently relearned cleanly, because one
  early fail could never be outweighed by anything later.
- **Landed on:** each underlying chunk is judged independently by its own
  latest qualifying session (`latestQualifyingSession`, filtered to
  `loggedAt >= revival.startedAt`) — never compared against a different
  chunk's timestamp. The combo's own dedicated-task sessions get a
  separate, distinct role rather than being pooled in as just another
  source: a fail there always (re-)escalates same as any underlying
  chunk's fail, and a pass there is the *one* thing allowed to override a
  still-failing underlying chunk — but only if that pass is more recent
  than every underlying chunk's own latest fail, so a stale combo-task
  pass logged before a chunk's most recent failure can't paper over it.
  See `src/lib/revival.js`'s `computeComboEscalations` — the code comment
  there records this same history in more implementation detail.
- **Consequence:** this is why `computeComboEscalations` is structured as
  per-chunk `latestQualifyingSession` lookups plus a distinct combo-task
  check, rather than one pooled-and-sorted session list — that shape looks
  more complex than "just check the newest session," but the simpler shape
  is the one that was tried twice and found wrong.

**Decision: starting tempo is three distinct concepts — suggested, user-selected,
and demonstrated — not the single system-computed "starting tempo" an earlier
version of this decision described. Superseded below; see
[Algorithms.md](Algorithms.md#starting-suggested-and-demonstrated-tempo) for
the full mechanics.**

- **Why revised:** the first pass at this (a `getStartingBPM(piece, chunk)`
  function, a flat 75%/65%/55%-of-target fraction by difficulty, written
  straight into `practiceBPM` on first log) resolved the old "starting
  practice tempo" open question but conflated three things a later review
  asked to be kept separate: a system *recommendation*, the learner's own
  *choice*, and later *proof* they can go faster. Auto-writing the
  recommendation into `practiceBPM` meant the "suggestion" silently became
  a decision the learner never actually made.
- **1. Suggested starting tempo** (`getSuggestedStartingBPM`,
  `lib/confidence.js`) — guidance only, never written into
  `piece.progress` by anything. The flat-fraction formula is also revised:
  a diminishing-returns power-law curve (`base * (target/100)^k`,
  per-difficulty) replaces the flat fraction, because a flat percentage of
  target scaled linearly and got unreasonable at high targets (a 240 BPM
  "easy" chunk suggesting ~180 is not a gentle starting point). `base`/`k`
  per difficulty are hand-fit against four product-supplied
  (target, difficulty) → suggested-BPM calibration points — hand-picked,
  not derived from a study, same status as every other tunable constant
  here (see [Research.md](Research.md)).
- **2. User-selected starting tempo** — `handleLogSession` (`App.jsx`)
  seeds `practiceBPM` from whatever the learner actually logs the first
  time they touch a chunk, exactly like the pre-`getStartingBPM`
  placeholder behavior — but no longer "an accident of the first session":
  `ChecklistItem` now surfaces the suggestion as both a field placeholder
  and an explicit one-time note ("choose whatever tempo lets you play
  accurately and comfortably, slower is fine") on first encounter only, so
  the learner is actually choosing, informed, rather than anchoring on
  whatever they happened to type. **`practiceBPM` values already seeded
  under the earlier conflated behavior are left as-is, not backfilled** —
  unchanged from the original reasoning: backfilling would rewrite lived
  practice history based on a number that was never really chosen, and
  there's no clean way to tell whether a chunk's *current* `practiceBPM`
  still reflects that seed or has long since ratcheted past it.
- **3. Demonstrated tempo** (`computeDemonstratedTempoBaseline`,
  `lib/ladder.js`) — new. 3+ clean reps at a bpm above the chunk's current
  `practiceBPM`, on a `pass` or `soft-miss` outcome (never `fail`),
  replaces the baseline outright instead of the usual +2 incremental step.
  **Confirmed with the user: "perfect rep" means "clean rep"**
  (`session.cleanReps`) — not a stricter, separate concept. The equivalence
  this codebase already used (no finer-grained per-rep quality signal
  exists in the data model) was the correct reading, not just a stand-in
  for a missing one.
- **Consequence:** the re-learning design's rule 4 (resetting a chunk's
  tempo to "whatever it would start at during introduction") resets to the
  *suggestion* (concept 1) specifically, now that it's cleanly separated
  from the learner's actual baseline — built in Pass 11, not Pass 14 as
  this entry originally expected; see the `needsRelearning` decision below.

**Decision: stage lengths, graduation pass-counts, tempo floors, and
practiceBPM ratchet step sizes (`ladderConfig.bpmSteps`) are all stored as
piece-level tunable data from the start, with no editing UI built yet.**

- **Why:** Keeps a future tuning UI additive rather than requiring a data
  migration later — same rationale as other tunable-but-hand-picked
  constants in this codebase (see [Research.md](Research.md)). The step
  sizes were added to this list after the fact (the ladder engine build,
  `lib/ladder.js`, initially hardcoded them as local constants, matching
  the doc's original "hand-picked, not a study" framing) — moved into
  `ladderConfig` once the user asked for them to be tunable too, same as
  everything else on this list.

**Decision (superseded — see the Pass 26 follow-up decision later in this
section): a real fail costs `practiceBPM` the same 2 BPM as a soft-miss
or the step a full pass gains — not the ~8–10 BPM pullback originally
sketched in [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#per-chunk-tempo-target-practicebpm).**

- **Why:** User call, made while reviewing the ladder engine build. The
  original range was a placeholder guess, not derived from anything; this
  simplifies the three outcomes to one consistent step size rather than
  three differently-scaled ones. `ladderConfig.bpmSteps.fail` defaults to
  `-2`, `.pass` to `2`, `.softMiss` to `-2`.
- **Consequence:** since it's stored as tunable data (see decision above),
  a future per-piece override could still reintroduce a steeper fail
  penalty without a code change if that turns out to matter in practice.
- **Superseded:** the user asked to revisit this after Pass 26 shipped —
  a real fail no longer uses this flat step at all; it resets `practiceBPM`
  to the recorded per-stage entry tempo instead, falling back to this
  `-2` step only when no entry tempo is recorded yet for the stage it
  demotes into. `.softMiss` and `.pass` are unaffected — this decision
  still governs those two. See the "Decision (Pass 26 follow-up): a real
  fail resets practiceBPM..." entry later in this section.

**Decision: Holding's interval-growth math reuses the existing 0.6×/1×/1.4×
effectiveness multiplier (the same one `adaptiveReviewOffsets` already
uses) as its *only* growth mechanism — the piece-level
`holding.intervalGrowthFactor` field from the config's first draft was
removed, not just left unused.**

- **Why:** [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built)
  explicitly says Holding's growth should reuse the existing multiplier
  "rather than introducing a second multiplier system" — a standalone
  `intervalGrowthFactor` tunable sitting alongside that reused multiplier
  would have been exactly the duplication the doc warned against, even
  though it was harmless (unread) as first drafted. Removed once the
  ladder engine (`lib/ladder.js`) made the redundancy concrete rather than
  theoretical.

**Decision: a "low effectiveness" full pass while in Holding can make the
*next* review interval shorter than the one that just elapsed (the 0.6×
multiplier applies below 1, same as it does for ordinary review), and this
is intentional, not a bug to guard against.**

- **Why:** Confirmed with the user: if a review is technically a full pass
  but felt shaky, that's exactly when the next check-in should come
  *sooner*, not later — an early-warning signal folded into the existing
  interval math rather than a separate mechanism. Holding otherwise reads
  as pure growth in the stage table (["expands ~1.5–2× per pass"](Repertoire-Lifecycle.md#the-ladder-three-stages)),
  which could easily have been read as "never shrinks" — worth recording
  explicitly since that reading was the more obvious one.

**Decision: the "two consecutive fails while in Stabilizing" signal
(`needsRelearning` in `lib/ladder.js`) stays a standalone flag on that one
chunk's ladder state — it is *not* wired into Revival as a fourth
auto-trigger condition.**

- **Why:** Confirmed with the user. Revival's three documented auto-trigger
  conditions ([Repertoire-Lifecycle.md#revival-auto-triggers](Repertoire-Lifecycle.md#revival-auto-triggers))
  are all piece-wide (a run-through's stop count, a lost combo/chunks, 60+
  days of no logging at all); this signal is chunk-scoped, and folding a
  single-chunk problem into a whole-piece recovery flow was never part of
  that design. What (if anything) reads this flag — and what "a short
  structured re-learning pass" (the doc's original phrasing) concretely
  means — is still undecided; this only resolves that it isn't Revival.
- **Consequence:** `ChunkProgress` gained a new field,
  `consecutiveStabilizingFails`, to make this signal computable at all —
  `consecutivePasses` alone can't distinguish a first fail from a second,
  since a fail always resets it to 0. Added to the migration in
  `storage.js` and `Wizard.jsx`'s `defaultPiece()` alongside the ladder
  engine build. See [Data-Model.md](Data-Model.md#the-piece-object).
- **Superseded:** the "what should read this flag" question above is now
  answered and built — see the next entry.

**Decision: what the `needsRelearning` signal should actually do — four
rules, agreed with the user. Built in Pass 11.**

Answers the question the entry above deliberately left open.

- **1. Re-learning *replaces* review, never runs alongside it.** Confirmed
  with the user, whose reasoning is the rule worth keeping: *"it's either
  ready for longer interval review or it's not."* A chunk cannot
  simultaneously be something you're rebuilding and something you're
  testing retention on. **Concrete consequence:** while a chunk is in this
  state it must produce **no due reviews at all** — both `computeTimeline`'s
  review placement and `computeDueReviews` (`lib/maintenance.js`) have to
  skip it. Worth stating explicitly, since "leave the reviews running too"
  is the easy accidental implementation. **Built**: `progress[id].needsRelearning`
  is now a persisted, sticky boolean (set the moment the fail streak hits
  2, carried forward across subsequent calls via `computeLadderAdvance`'s
  `chunkLadderState.needsRelearning` input) — both `computeTimeline`'s Tier
  2 loop and `computeDueReviews` check it first and skip the chunk outright.
- **2. Exit is dual — the normal graduation rule *or* a manual override.**
  No special exit criterion is needed. Stabilizing already graduates on 4
  consecutive full passes and is the **only** stage with no tempo floor
  (`ladderConfig.stabilizing.tempoFloorFraction: null`), so its passes
  count on reps alone regardless of speed — already tempo-agnostic, and
  therefore already compatible with a rebuilding phase that isn't about
  tempo. The manual override on top follows the existing
  automatic-with-a-manual-escape-hatch pattern (`manualConfidence` over
  `computeAutoConfidence` — see
  [Product-Principles.md](Product-Principles.md#always-provide-a-manual-escape-hatch)).
  **Built**: `computeLadderAdvance`'s pass branch clears the flag itself
  when a graduation-out-of-Stabilizing pass fires; `handleClearRelearning`
  (`App.jsx`) is the manual half — a direct field write, the same shape as
  `handleSetManualConfidence`, no snapshot to restore. **Also resets
  `consecutiveStabilizingFails` to 0**, confirmed with the user after the
  fact: without this, the streak that triggered the flag (already at 2)
  survives a manual clear, so the very next fail reads as fail #3 (still
  `>= 2`) and re-flags instantly instead of behaving like an ordinary
  single fail. The automatic exit path needs no equivalent fix — any real
  pass already resets the streak to 0 on its own, so by the time 4 of them
  graduate a chunk out, the streak has long since been at 0 regardless.
- **3. Reuse the `lost` mechanism, but never show the user that word.**
  Functionally this lands a chunk in the same state Pass 6's manual `lost`
  flag already produces (forced to Stabilizing, `nextDueDate` pinned to
  today), so the mechanism is reused (the fail branch pins `nextDueDate` to
  `outcome.asOfDate` at the moment the flag turns on) rather than calling
  `applyRunThroughFlag` itself — reusing that function directly wasn't
  possible without also clobbering `consecutiveStabilizingFails`/
  `practiceBPM`, which it deliberately never touches (see Post-run-through
  logging above), so `computeLadderAdvance`'s own fail branch reproduces
  just the pin-to-today part inline instead. **Label, confirmed with the
  user: "Needs reinforcement"** — history-agnostic, reads correctly whether
  the chunk was once solid and decayed, or never consolidated in the first
  place. Surfaced on the Piece Map: a small icon on the grid cell, plus a
  labeled row with a "Clear, resume review" button in the chunk detail
  modal (`PieceMapTab.jsx`) — the rule-2 manual override control.
- **4. The practice tempo resets.** A rebuilding chunk restarts at a
  genuinely slow tempo rather than keeping its ratcheted `practiceBPM` (two
  fails step it down only 4 BPM in total, nowhere near "start over").
  **Built, now that Pass 9 closed the blocking gap**: resets to
  `getSuggestedStartingBPM(piece, chunk)` (concept 1 of the three-concept
  tempo split above) — the same moment `needsRelearning` turns on, not
  reapplied on later fails while already flagged. `getSuggestedStartingBPM`
  needs the full `piece`/`chunk`, which `lib/ladder.js` doesn't have, so —
  same pattern as `targetBPM` — the caller resolves it: `ChecklistItem.jsx`
  computes it unconditionally (not just on first encounter) and passes it
  through `sessionInput.suggestedStartingBPM` to `handleLogSession`.
- Built in Pass 11. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-ladder-three-stages).

**Decision: `needsRelearning` caps displayed confidence the same way the
`rough`/`lost` flags do — `Math.min(score, 20)`, added in the same pass
after a post-implementation review caught the gap, not part of the
original four rules above.**

- **Why:** The rough/lost cap exists specifically so a stale manual
  override can't paper over a flag the learner is actively looking at (see
  Post-run-through logging above). `needsRelearning` reuses the exact same
  underlying ladder state (forced to Stabilizing) that `lost` produces —
  leaving it uncapped would reopen precisely the contradiction that
  earlier decision closed, just reachable by a different route (two
  Stabilizing fails instead of a manual run-through flag) that happened to
  not exist yet when that cap was first built.
- **Value, confirmed with the user:** same 20 as `lost`, not a distinct
  number — functionally the same state, so no reason to invent a third
  tier. Combined with any `flag` cap via `Math.min` of both, so a chunk
  carrying both `flag: 'rough'` and `needsRelearning: true` at once (not
  reachable through the shipped UI today, but not prevented by the data
  model either) shows the stricter of the two rather than one silently
  overriding the other.
- **Verified live, not just unit-tested**: manually forced a chunk into
  `needsRelearning` in the browser, set a manual confidence override of
  90, and confirmed the displayed number stayed at 20 — see the browser
  verification note in [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built).

**Decision: the old free-standing "how did it feel" 3-tap effectiveness
input (`EFFECTIVENESS_OPTIONS`) is removed, folded into a single "needs
more work" checkbox that overrides the objective pass/soft-miss/fail
judgment straight to `fail`.**

- **Why:** Matches the lean already recorded in
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#session-outcomes-three-tiers-not-two)
  and the wording of the pass that built this ("...pass/soft-miss/fail,
  with manual override"). The old input overlapped heavily with the new
  objective judgment; keeping both would mean logging asks the same
  question twice in different words.
- **Consequence:** `session.effectiveness` stops being written by new
  sessions — `session.outcome` ('pass'/'soft-miss'/'fail') is the field
  going forward. `computeAutoConfidence` (`confidence.js`) and
  `adaptiveReviewOffsets` (`scheduling.js` — no longer itself called by
  `computeTimeline` as of Pass 5, but still exported and still correct if
  called) both read `outcome` now instead, via a shared `sessionOutcome()`
  helper that falls back to mapping old
  `effectiveness` values for sessions logged before this change (low→fail,
  good→soft-miss, high→pass — chosen to preserve each value's old
  0.6/1/1.4 multiplier effect, not as a claim that "good" truly meant
  "soft-miss"). Nothing recomputes or migrates old sessions in place; they
  keep reading correctly through the fallback instead.

**Decision: ProgressTab's effectiveness-distribution panel is updated in
the same pass, not left stale — renamed "Outcome breakdown," charting
pass/soft-miss/fail instead of low/good/high.**

- **Why:** It reads `session.effectiveness` directly; leaving it
  untouched after the decision above would mean it silently stops
  reflecting anything real for every session logged going forward. Small,
  contained change (`constants.js` gained `SESSION_OUTCOME_META` in place
  of `EFFECTIVENESS_OPTIONS`; `ProgressTab.jsx` swapped the field it reads
  and the labels it shows) — confirmed with the user as worth doing now
  rather than flagging as a gap, given how cheap it was once the fold-in
  decision above was made.

**Decision: same-day multi-session logging is keyed by a precise
timestamp (`session.loggedAt`, epoch ms) — every logged attempt is kept as
its own record, none overwritten by day alone.**

- **Why:** The design notes wanted a semantic Tier-1/due-review/re-attempt
  keying scheme, but classifying which of those a given log action *is*
  is a distinct problem from Tier 1/Tier 2 review *scheduling* (built in
  Pass 5) — scheduling decides what to show as upcoming; this would mean
  tagging what a session *was*, after the fact, which nothing does yet.
  Timestamp keying is buildable now without guessing at that
  classification, and doesn't foreclose adding the semantic scheme later
  (a `loggedAt`-keyed record can still gain a `kind` tag once that exists).
- **Consequence:** `ChecklistItem.jsx` had to change beyond just the
  logging form — its "checked" state used to hide the form entirely once
  a session existed for the day, which would have made a second same-day
  log unreachable through the UI even though the data model now supports
  it. The form now stays visible alongside the "Logged: ..." summary, and
  the mark-done icon becomes an "undo most recent" control rather than a
  toggle. Discovered by testing in-browser, not anticipated when scoping
  the pass — worth remembering that a data-layer fix doesn't automatically
  mean the UI path to exercise it exists.
- **Known limitation, not addressed here:** undoing a session
  (`handleUnlogSession`) removes the record but does not roll back the
  ladder state (`stage`/`practiceBPM`/etc.) that session's outcome already
  advanced — same "no undo history" spirit as BPM zones and difficulty
  reassessment (see Data-Model.md's known simplifications). **Now scoped as
  a defect rather than an accepted limitation — see the next entry.**

**Decision (built, Pass 10): session undo should fully reverse the
ladder, via a per-session snapshot — and until it does, the UI must stop
implying that it already has.**

Raised by the user, whose framing is the point: the checkbox reads as
"this didn't happen," so a partial undo is a UI honesty problem as much as
a data one.

- **Why this is a defect, not a limitation:** undo predates the ladder.
  When a session was only a record, deleting the record *was* a complete
  undo. The ladder later gave sessions lasting consequences —
  `stage`, `consecutivePasses`, `consecutiveStabilizingFails`,
  `practiceBPM`, `nextDueDate` — and undo was never revisited. The
  behaviour was carried forward as "no undo history," alongside BPM zones
  and difficulty reassessment, but it isn't really the same thing: those
  never claimed to reverse anything.
- **User-visible harm:** the two "how good is this chunk" scores fall out
  of sync — `computeConfidence` reads sessions and drops, while
  `computeProgressTier` reads `stage` and stays high
  ([Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)).
  Worse, a mis-logged pass that pushed `nextDueDate` weeks out keeps that
  date after the undo, so the chunk silently leaves the review rotation
  while its history says it was never practised. On a Holding chunk that
  can be the difference between a 14-day and a ~70-day gap.
- **Approach:** snapshot the pre-session ladder state and store it **on the
  session record itself** (not on the chunk entry), so multiple sessions in
  one day each carry their own "before" picture and undo simply pops the
  last one. Six small fields; storage cost is negligible. This is the same
  snapshot-and-restore pattern `flagSnapshot` already uses successfully for
  rough/lost flags in `handleSetFlag` (`App.jsx`) — proven in the same
  file, just never extended to session logging.
- **The genuinely hard corner, and the scope that avoids it:** restoring a
  snapshot rewinds to a moment in time, so undoing a *non-latest* session
  would silently erase every later session's effects too — inherent to any
  forward-moving state machine, not a flaw here. Full generality needs
  replaying everything after the undone point, which is impossible today:
  manual actions (`applyRunThroughFlag` for rough/lost, `handleUpdateBPM`)
  also move the ladder and are not recorded as replayable events. **Scope
  the fix to the most recent session only** — which covers the real case
  ("I just mistyped that") — and leave older sessions on today's partial
  behaviour, stated plainly in the UI.
- **Do the honest label regardless.** Even before the data work, the undo
  control should not imply the schedule rewinds. That half is cheap,
  independent, and worth having on its own.
- **Migration:** sessions logged before this exists carry no snapshot.
  Undo on those must fall back to current behaviour rather than guess at a
  reconstruction — the same "don't guess, say so" rule applied to
  `flagSnapshot`'s malformed-shape guard.
- **Related:** pairs naturally with the starting-BPM open question, since
  both are ladder-entry concerns.
- **Built as designed above, Pass 10 — implementation notes:** the field is
  named `session.ladderSnapshot` (see [Data-Model.md](Data-Model.md#the-piece-object)).
  "Most recent session only" is checked against the chunk's *entire*
  `sessions` array (`lastIdx === sessions.length - 1`), not just the
  sessions logged on the `day` being undone — a session for an earlier
  plan-day logged after a later plan-day's session (e.g. working ahead,
  then going back to log something missed) is correctly treated as
  non-latest and falls back, exactly per the scoping above. The honest-UI
  half lives in `ChecklistItem.jsx`: it recomputes the same
  latest-session-plus-valid-snapshot check the handler will use and shows
  distinct copy ("Undo most recent log" vs. "Remove most recent log," with
  matching tooltips) *before* the click, not just distinct behavior after
  it.
- **Follow-up fix (found in review, same pass): a full undo also clears a
  rough/lost flag applied on top of the undone session.** Without this, a
  session could be flagged rough/lost, then undone — reverting the ladder
  state but leaving the flag standing on top of a ladder state that no
  longer existed, and leaving `flagSnapshot` pointing at a restore point
  (the post-session, pre-flag state) that was itself now invalid. Fixed by
  reusing an existing invariant rather than inventing a new check:
  `handleLogSession` already unconditionally clears `flagSnapshot` on
  every real session log, so `flagSnapshot` still being present at
  full-undo time *proves* the flag was applied after this session with
  nothing logged in between — safe to clear both `flag` and
  `flagSnapshot` in that case. A flag with no `flagSnapshot` (predates
  this session, or survived a later real log — the same "genuine progress
  can't be discarded by the flag cycle" rule `handleLogSession` already
  enforces) is left untouched, same as before this fix.

**Decision: ladder stage/consecutivePasses do not feed into
`computeAutoConfidence` — confidence and the ladder stay two independent
signals, at least for now.**

- **Why:** Confirmed with the user, matching this pass's own stated
  recommendation. Folding stage into confidence would mean guessing at a
  weighting before Stage 3 ("learned") is actually defined — premature,
  and avoidable by just not doing it yet. Keeps `computeAutoConfidence`
  and `computeLadderAdvance` fully independent: one reads `session.outcome`
  history for its own purposes, the other is driven by the same outcomes
  through `handleLogSession`, but neither reads the other's derived state.
- **Revisit when:** Stage 3 ("learned") is actually implemented — see
  [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them).

**Decision: the post-run-through rough/lost flag (Pass 6) merges into and
replaces the existing `progress[id].weakSpot` boolean, rather than living
alongside it as a separate field.**

- **Why:** Flagged as this pass's one blocking question — resolved with
  the user before implementation started, not silently picked during it.
  `weakSpot`'s only two consumers (`computeRevivalPlan`'s weak-spots-first
  sort in `lib/revival.js`, and `RevivalTab`'s flagged-chunks list/count)
  both already treated it as a plain boolean — "flagged or not" — with no
  code anywhere distinguishing degrees of flagged-ness. Widening that same
  field to a tri-state `undefined | 'rough' | 'lost'` and updating both
  call sites to check "is anything set" instead of "is it `true`" is a
  one-line change at each site, not a redesign — versus keeping two
  separate manual "this chunk needs attention" flags per chunk, which
  would mean Revival's reassessment modal and the Piece Map's run-through
  flag independently claiming to mean roughly the same thing.
- **Consequence:** `progress[id].weakSpot` no longer exists;
  `progress[id].flag` is the single field. Revival's sequential
  reassessment modal now sets the same field the Piece Map's flag cycle
  does (same control, `PieceMapTab`'s "Run-through flag" button, reused
  as-is rather than duplicated) instead of a dedicated weak-spot toggle.
  `computeRevivalPlan`'s prioritization is unchanged in effect (flagged
  chunks first, then lowest confidence) — rough and lost are treated alike
  for that ordering, not a three-tier sort, per the same "no behavioral
  redesign" reasoning above.
- See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)
  and [Data-Model.md](Data-Model.md#the-piece-object).

**Decision: an already-saved piece with the old `weakSpot: true` reads
that forward as `flag: 'rough'` on migration, rather than the field
silently going unread.**

- **Why:** Found in a post-ship diagnostic, not anticipated when the merge
  decision above was made. The merge only changed which field *new* code
  reads; it didn't address data saved *before* the merge shipped.
  `weakSpot: true` on an old piece isn't deleted by that change, but
  nothing reads it anymore either — a silent, no-error loss of visibility
  (the flag icon, Revival's flagged list, `computeRevivalPlan`'s
  prioritization all stop showing it) rather than a crash, which is why it
  wasn't caught by build or tests. 'rough' rather than 'lost' because the
  old field only ever meant "needs attention," carrying no severity signal
  to map onto lost's stronger "demote to the floor" meaning.
- **Consequence:** `backfillProgressLadderState` (`lib/storage.js`)
  converts on load — covers a regular app load, a brand-new import, and a
  merged import alike, since all three funnel through
  `validateAndMigratePiece`. An already-set `flag` always wins over a
  leftover `weakSpot`, so this can't overwrite a flag set after Pass 6.
  `weakSpot` is deleted once converted, not left sitting unread — this
  codebase's general lean against keeping dead fields around (CLAUDE.md).
- See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging).

**Decision: clearing a rough/lost flag reverts the ladder schedule change
the flag caused, not just the flag value itself.**

- **Why:** Found in the same diagnostic. The original implementation
  demoted `stage`/`nextDueDate` on flagging but never reversed it on
  clearing — "untouched" is documented to mean "held fine"
  (Repertoire-Lifecycle.md), but a chunk cycled through rough and back
  stayed permanently demoted, contradicting that. User confirmed the
  fix direction directly: clearing should revert the chunk's schedule to
  what it would be without the flag.
- **Consequence:** `progress[id].flagSnapshot` (see
  [Data-Model.md](Data-Model.md#the-piece-object)) captures
  `{ stage, consecutivePasses, nextDueDate }` once, on the untouched→rough
  transition only — not re-captured on rough→lost, so it always holds the
  state from before *any* flag in the cycle. Restored and deleted when the
  flag clears. **Known edge case, deliberately handled conservatively:**
  if a real session gets logged while flagged, `handleLogSession` deletes
  the snapshot instead of letting it linger — a genuinely-earned ladder
  advance must never be silently discarded by a later "never mind" on the
  flag. In that case, clearing the flag leaves `stage`/`nextDueDate`
  wherever the flag's demotion last set them rather than reverting past
  the real progress; there's no attempt to reconstruct what the schedule
  "should" be by replaying history.
- See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging).

**Decision: `computeProgressTier` (the Overview "Practice progress" bar)
buckets a chunk by its spaced-repetition ladder `stage`, not its
most-recently-logged session's clean-rep count.**

- **Why:** Found in the same diagnostic. The rep-count version was
  entirely independent of the new rough/lost flag — a chunk with strong
  practice history could get flagged "lost" (capping its confidence low
  everywhere else) and still show as "Mastered" in this one bar, the
  exact "visible contradiction" [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)
  explicitly rules out, just via a display path Pass 6's own verification
  checklist hadn't named. Confirmed with the user: use `stage` rather
  than `computeConfidence` for this specific bar, since the ladder is the
  more meaningful long-term-retention signal for a bar that's always
  meant "how much of this is really learned," where confidence's
  recency-weighted, session-to-session read was always a coarser proxy
  for that same question.
- **Known landmine, confirmed acceptable rather than blocking:** a chunk
  with real practice history from before the ladder existed migrates in
  with `stage: null` (`backfillProgressLadderState`,
  [Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about) — the same reason
  Tier 1 review scheduling has an equivalent guard,
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#introduction-window-review-scheduling-tier-1--tier-2)).
  Such a chunk reads as "Learned" (the lowest touched tier) rather than
  "Untouched" or "Mastered" until it's logged again and picks up a real
  stage. User confirmed this isn't worth guarding further given how
  little existing user data there is to be affected by it — noted here
  rather than silently accepted, in case that changes once real usage
  exists.
- **Consequence:** `PROGRESS_TIER_META`'s four labels are unchanged;
  only what feeds the bucketing changed. `PartSwitcher`'s untouched-measure
  count (the only other caller) is unaffected, since it only ever checked
  the `untouched` bucket, whose own condition (`sessions.length === 0`)
  didn't change.
- See [Algorithms.md](Algorithms.md#confidence) and
  [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them).

**Decision: two silent-failure risks caught in self-review get a
`console.warn` and a safe fallback, not a silent misclassification.**

- **Why:** A skeptical self-review (requested explicitly, before
  committing) flagged that `computeProgressTier`'s stage bucketing
  treated any unrecognized `stage` value the same as a legitimate one —
  wrong data would silently land in "Learned" with no trace. Separately,
  `handleSetFlag`'s `flagSnapshot` restore trusted the snapshot's shape
  unconditionally — a future write path producing a differently-shaped
  snapshot would silently write `undefined` into a chunk's `stage`/
  `nextDueDate` rather than fail visibly. Neither was reachable through
  today's UI, but both were real gaps a future change could hit.
- **Consequence:** `computeProgressTier` (`lib/confidence.js`) now imports
  the same `STAGES` list `lib/ladder.js` already used internally
  (exported for this reuse) and warns if `stage` isn't `null` or one of
  the three known values, before falling back to "learned" exactly as
  before. `handleSetFlag` (`App.jsx`) now checks the snapshot has all
  three expected fields before trusting it; on a malformed snapshot it
  warns and skips the restore entirely, leaving `stage`/`nextDueDate`
  wherever the flag's last demotion set them rather than overwriting them
  with `undefined`. Both keep this codebase's existing "never crash on
  bad data" convention (e.g. `lib/ladder.js`'s own defensive fallback to
  `'stabilizing'`) — the fix is closing the *silent* part, not
  introducing a throw.
- See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging).

**Decision (built — Pass 8): the live "what's due beyond the plan"
maintenance query surfaces in both Master Agenda and the per-piece Today
tab, via one function shared by both, not a new tab or Master Agenda
alone.**

- **Why:** [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#explicitly-not-designedbuilt-here)
  left this genuinely undecided even after Pass 7 shipped — which UI
  surface(s) show due-maintenance reviews changes how big this pass is and
  which files it touches, so it wasn't safe to guess going in. Scoped with
  the user before starting implementation: a new dedicated tab would
  duplicate Master Agenda's existing cross-piece daily view; Master Agenda
  alone would leave the per-piece Today tab dead-ending at "Day N of N"
  forever for a piece past its plan, with no way to see what's actually
  due for that one piece.
- **Consequence:** one new pure function, `computeDueReviews(piece,
  chunkSet, asOfDate)` (`src/lib/maintenance.js`), reads
  `progress[id].nextDueDate` — already a real calendar date, not a
  plan-day int (see the `ChunkProgress` entry, Data-Model.md) — directly
  against `asOfDate`, entirely independent of `timeline.days[]` /
  `computeTimeline`. Both surfaces call the *same* function rather than
  Master Agenda getting its own lightweight summary query — confirmed with
  the user: one source of truth, Master Agenda just renders less of the
  same result than Today tab does. `TodayTab.jsx` gained a second render
  branch for the past-plan case (prev/next day nav disabled in that mode —
  there's no bounded plan grid left to page through; "View all" still
  reaches the original plan); `MasterAgendaTab.jsx`'s "skip if `dayNumber >
  timeline.days.length`" guard became a call into this function instead of
  a skip. Due items log through the same `ChecklistItem` the bounded plan
  uses, keyed to the elapsed day number, so there's one
  logging/undo/ladder-advance path rather than two.
- **Suppression rules, confirmed rather than assumed:** a paused or
  archived piece never surfaces due-maintenance items — consistent with
  pause/archive already meaning "off my daily plate" for schedule pressure
  generally ([Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#pause--archive-built)),
  not a special case invented for this pass. A piece with an active
  revival (`piece.revival.startedAt` set) also suppresses ordinary
  due-maintenance items, since revival is already "something's wrong,
  working through it" mode and showing routine maintenance items alongside
  it would compete for attention with no clear priority between them.
- **Scoped out:** any forward-looking window (due-in-N-days) — strictly
  "due as of today," matching what [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built)
  actually asks for; nothing in the design calls for a maintenance
  calendar view.
- **Built in Pass 8**, essentially as scoped above. This entry was
  originally recorded ahead of implementation (same as the original ladder
  design was recorded before Pass 1) and has since been reconciled against
  what actually shipped; the one place the scoping was wrong is the
  next decision below.
- See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#explicitly-not-designedbuilt-here)
  and [Algorithms.md](Algorithms.md#whats-due--the-live-maintenance-query).

**Decision (Pass 8): "has this piece run past its plan?" is answered by an
unclamped elapsed-day derivation in each surface, not by `getCurrentDay`
— which structurally cannot answer it.**

- **Why:** the scoping above (and the pass description written from it)
  assumed the past-plan case could be detected as "`currentDay` exceeds
  `timeline.days.length`". That state **cannot occur**: `getCurrentDay`
  (`lib/utils.js`) `clamp`s to `[1, totalDays]`, so a 10-day plan that
  started three months ago still reports day 10. Detection therefore has
  to come from elapsed calendar days since `piece.startDate`, compared
  against `timeline.days.length`, without the clamp.
- **Consequence — this fixed a latent bug nobody had filed.** Because of
  the clamp, Master Agenda's pre-existing `dayNumber >
  timeline.days.length` guard *never fired for today*: a piece past its
  plan silently re-rendered its last scheduled day, every day,
  indefinitely (in testing, a stale "Full run-through of the piece" as
  today's task). Correcting the detection removed that as a side effect,
  so Pass 8 is a bug fix as well as a feature.
- **Resolved (follow-up commit):** Pass 8 shipped this derivation inline in
  both `TodayTab.jsx` and `MasterAgendaTab.jsx`, with the two copies
  differing slightly (Master Agenda floored at 1 for a future `startDate`,
  TodayTab didn't) — flagged rather than folded in, since `lib/utils.js`
  was outside the pass's stated scope. It's since been extracted to
  `elapsedDay(piece)` in `lib/utils.js`, and **`getCurrentDay` is now
  derived from it** (`clamp(elapsedDay(piece), 1, totalDays)`) rather than
  repeating the same date arithmetic a third time — so the clamped and
  unclamped forms can't drift. Behaviour verified unchanged on both
  surfaces, in-plan and past-plan. The counting itself has since been fixed
  too — see the DST decision immediately below.
- **Related, unchanged:** `ScheduleBanner` still runs off the clamped
  `currentDay`, so a piece past its plan can show "N chunks behind
  schedule" above its maintenance due list. Pre-existing, not a Pass 8
  regression, and arguably wrong next to a completed plan given the
  "a late review is slack, never a failure" rule — but out of scope.

**Decision (built — Pass 66): `computeDueReviews` runs unconditionally at
both call sites, not just once a piece is past its whole bounded plan —
closing the gap where a review overdue *inside* an active plan had no live
surface until the plan ran out.**

- **Why:** a chunk's `nextDueDate` is a real calendar date (the Pass 8
  decision above), and `computeTimeline` places each review on exactly one
  plan day at generation time. If that placement day passed without the review being
  logged, the review was stuck: `computeDueReviews` — the function built
  specifically to answer "what's due" independent of the bounded plan —
  only ever *ran* once the whole plan had run out (`TodayTab`'s `pastPlan`
  gate, `MasterAgendaTab`'s equivalent `dayNumber > timeline.days.length`
  branch). A piece with 50 days left in a 60-day plan and one review 9 days
  overdue had no way to see or log it from "today" at all — only by paging
  day-nav back to the exact day it was originally placed on.
- **Two ways to close it, resolved before starting:** (a) drop the
  `pastPlan`/past-plan gate on the existing call and merge its result into
  the current day's own `reviewChunkIds`; or (b) teach `computeTimeline`
  itself to roll a past-due review forward onto today. (b) was rejected:
  it would give `computeTimeline` a `currentDay`/"now" input it has never
  needed, complicating its signature and meaning `chunkSet`/`timeline`'s
  existing memoization (a pure derivation off `piece` alone — see
  `CLAUDE.md`) would need to key on the current day too. It also wouldn't
  cover the already-past-plan case on its own — `computeDueReviews` would
  still be needed there regardless — so (b) likely builds two mechanisms
  for one problem. (a) reuses a function that's already correct and
  already tested, and touches nothing about `computeTimeline`'s contract.
- **Consequence:** `mergeLiveDueReviews(day, dueItems)`
  (`lib/maintenance.js`) folds `computeDueReviews`'s result into a plan
  day's own `reviewChunkIds`, filtering out any id already present so a
  review due *exactly* today (already placed there by `computeTimeline`)
  doesn't render twice. Both `TodayTab`'s day-view checklist and
  `MasterAgendaTab`'s per-piece review chip row call it, scoped to real
  "today" only — day-nav browsing a different day, or Master Agenda's date
  picker on a non-today date, still shows that day's plan as originally
  scheduled, since due-ness is "as of today" only (the Pass 8 decision
  above's "scoped out" note is unchanged by this pass). `minutes`/`totalTime`
  deliberately isn't merged: a plan day costs a review at a flat 3 minutes
  (`computeTimeline`'s `minutesFor`) while `computeDueReviews` costs one at
  `chunk.effort * EFFORT_TO_MIN` — genuinely two different estimates, and
  folding them together would mix rather than reconcile them. Flagged, not
  resolved: which of the two should govern if this is ever reconciled is
  an open question.
- **Untouched by this pass:** the review's original, now-past placement
  day still reads "behind" via `classifyDayCompletion` exactly as before —
  that's accurate history, not the bug this pass fixes. `computeScheduleStatus`'s
  "never counts a review as missed" policy (no-penalty design, see the
  Pass 5 decision above) is also untouched — this pass is about
  visibility, not about making a late review count against the schedule.
  Interleaved mode's eligible-item list (`TodayTab`'s `interleaveItems`)
  and the Reassess panel's `todaysRanges` still read the plan day's
  *original*, unmerged `reviewChunkIds` — a newly-surfaced live-due item
  is loggable from the day checklist but doesn't yet appear in either of
  those; flagged as a possible follow-up, not decided. **Update, Pass
  69's same-session follow-up (see the Interleaved-mode decision
  below):** `interleaveItems` no longer reads any day's `reviewChunkIds`
  at all, merged or not — it's now a piece-wide filter over live ladder
  `stage`, which appears to close this half of the gap as a side effect
  (reasoned through, not separately reproduced against this exact
  scenario). `todaysRanges` is untouched and still has the gap described
  here.
- See [Algorithms.md](Algorithms.md#whats-due--the-live-maintenance-query).

**Same-session follow-up, per direct request: a review is now priced by
difficulty everywhere, not just in `computeDueReviews` — closing the exact
`minutes`/`totalTime` disagreement flagged above, and correcting a
day-count risk in `scheduleMode: "minutes"` planning that the disagreement
had been masking.**

- **Why:** underestimating how long a hard chunk's review actually takes
  isn't just a cosmetic display gap — for a `scheduleMode: "minutes"`
  piece, the day-count estimator (`computeDaysNeededForMinutesPerDay`) folds
  an assumed review cost into how many days it decides the plan needs. If
  that assumption runs low specifically for the hardest chunks, the
  estimator can under-provision days for exactly the material most likely
  to need real review time — a plan that looks like it fits the stated
  daily budget on paper but doesn't once review load actually lands.
- **Consequence:** `computeTimeline`'s `minutesFor` (`lib/scheduling.js`)
  now prices `reviewChunkIds` with the identical formula it already used
  for `newChunkIds`/`specialChunkIds` — `chunk.effort * EFFORT_TO_MIN` —
  replacing a flat 3-minutes-per-touch figure that ignored the chunk's own
  difficulty. `computeDaysNeededForMinutesPerDay` gets the matching fix:
  each chunk's review-padding term changes from a flat, difficulty-blind
  constant (`(2 * 3) / EFFORT_TO_MIN`, added once per item) to
  `c.effort * REVIEW_TOUCHES_PER_ITEM` (`REVIEW_TOUCHES_PER_ITEM = 2`,
  unchanged — only what each touch costs changed, not how many touches are
  assumed). `mergeLiveDueReviews` (the Pass 66 decision immediately above)
  now folds a merged item's `minutes` into `day.minutes` too, since the two
  sides no longer disagree.
- **Consequence for existing tests, verified as expected rather than a
  regression:** two pre-existing tests in `test/scheduling.test.mjs` had
  their expected numeric outputs change. A Tier 2 same-day-review-pileup
  smoothing test previously left exactly one of three same-day reviews
  behind (three flat-3-minute reviews, 9 minutes total, wasn't enough of an
  overload to relocate all of them); with accurate per-chunk pricing the
  same pileup is 30 minutes, clearing the smoothing pass's relocation
  threshold for all three. A `computeDaysNeededForMinutesPerDay` padding
  test's expected day count rose from 14 back to 28 for its fixture — the
  14 was itself computed on top of the same under-costed assumption being
  fixed here, so once review cost is corrected, the true padding this
  fixture needs is legitimately higher; both tests' comments were rewritten
  with the exact math rather than just the new numbers, and both were
  confirmed to fail back to their old values when the fix was temporarily
  reverted.
- **Untouched:** `REVIEW_TOUCHES_PER_ITEM`'s value (2, a deliberately rough
  stand-in for "the first couple of ladder touches a chunk will likely
  pick up") — this fix changed what each touch costs, not how many touches
  are assumed. The `+6`-minute move-worth-it threshold in Tier 2's
  smoothing pass (`lib/scheduling.js`) is also untouched — a general
  anti-churn margin, not itself derived from the per-review cost figure,
  so it wasn't in scope for this fix even though its practical effect
  shifted as a result of reviews now costing more on heavy-pileup days.

**Same-session follow-up, found in a critical self-review before
committing (not part of the original request): `mergeLiveDueReviews`
skips consolidation days entirely, closing a silent minutes-inflation gap
the merge itself introduced.**

- **Why:** neither `TodayTab`'s `ConsolidationPanel` nor
  `MasterAgendaTab`'s card renders `reviewChunkIds` or `minutes` for a
  consolidation ("full run-through") day — it's just "play through the
  whole piece," by design, unrelated to this pass. Before this guard, a
  transition or combo with an overdue live-due review landing on a piece's
  consolidation day would still get merged in, silently adding its minutes
  to `day.minutes` — and therefore Master Agenda's total-planned figure —
  with no line item anywhere on screen accounting for the extra time. Not
  a hypothetical: reproduced live (a 60-day piece whose consolidation day
  landed on "today," with an overdue transition review) — the total read
  higher than `minutesPerDay` with nothing on the card explaining why,
  before the fix; confirmed reading back to exactly `minutesPerDay` after
  it.
- **Consequence:** `mergeLiveDueReviews(day, dueItems)` now returns `day`
  unchanged, untouched, when `day.type === "consolidation"` — before doing
  anything else. The overdue item isn't lost: it still surfaces normally
  on any other day, or once the piece is past its whole plan (the
  unrelated `pastPlan`/`DueReviewPanel` path, which never reads a `day`
  object at all). This only stops it from being double-counted into a day
  that was never going to itemize it either way.
- **Consequence for tests:** one new regression test in
  `test/maintenance.test.mjs` asserts `mergeLiveDueReviews` returns the
  *exact same object* (not just an equal one) for a consolidation day fed
  a genuinely overdue item — confirming no merge is attempted at all,
  not just that the visible result happens to look unchanged.

**Decision: day counting goes through `daysBetweenInclusive` everywhere —
fixing a DST undercount that made due reviews permanently invisible for
pieces started before the spring transition.**

- **The bug:** `elapsedDay`/`getCurrentDay` (`lib/utils.js`) floored the
  millisecond gap between two *local* midnights. A spring-forward day is 23
  hours, so the interval is `n × 24 − 1` and the floor lands a day short.
  Not a changeover-day glitch — it held for the whole ~8 months between the
  March and November transitions.
- **Why it mattered more than an off-by-one label:** `computeTimeline`
  converts a chunk's `nextDueDate` to a plan day with `daysBetweenInclusive`
  (`Math.round`, `scheduling.js`), so the app was running *two different
  day-numbering conventions at once*. For a piece started before the spring
  transition they disagreed by one — and since both advance together each
  day, a review genuinely due today was placed permanently one day ahead
  and **never became visible**. Reproduced before the fix (`America/Denver`,
  2026-08-11, piece started 2026-02-01): the app read "Day 191 of 250 —
  Nothing scheduled" while the review due *that day* sat on day 192.
- **The fix:** `elapsedDay` now calls `daysBetweenInclusive` instead of
  doing its own arithmetic, so one counting function backs both "what day
  is it" and "what plan day is this date". `getCurrentDay` stays derived
  from `elapsedDay`. Verified after: the same piece reads day 192 and the
  due review appears today; pieces started after the transition are
  unaffected and render byte-identically.
- **Stored day numbers were deliberately not migrated.** `doneDays` and
  `sessions[].day` hold plan-day ints recorded under the old counting, so
  for affected pieces they now sit one behind. Checked each consumer:
  `computeScheduleStatus` tests `doneDays.length > 0`, not day equality, so
  behind-schedule detection is unaffected; `computeAutoConfidence`'s
  recency term reads one day staler, which is negligible; the only visible
  artifact is that a session logged *today, before the fix landed* loses
  its checkmark. Rewriting historical session data to chase that was judged
  the riskier option — sessions already carry an authoritative `loggedDate`,
  and `day` is a convenience key.
- **Found** while verifying the `elapsedDay` extraction above, not by a
  user report; logged as an open question first, then fixed as its own pass
  rather than folded into unrelated work. See
  [Algorithms.md](Algorithms.md#detecting-that-a-piece-has-run-past-its-plan).

**Decision (Pass 14): a repeat soft-miss only escalates to a real fail when
both the current and the previous shortfall were reps-driven — a tempo-only
shortfall (required reps hit, just under `practiceBPM`) can never be the
fail trigger, in either session of the pair, no matter how many times it
repeats.**

- **The bug:** `classifySessionOutcome`'s escalation rule
  (`previousOutcome === "soft-miss" → "fail"`) read only the previous
  session's *outcome label*, not *why* it was a soft-miss. A soft-miss can
  come from two different signals — insufficient clean reps, or full reps
  but under tempo — and the rule treated them identically. A learner who
  hit every required rep, twice in a row, but logged a couple BPM under a
  `practiceBPM` that was already stepping down in their favor (soft-miss
  steps it down by 2) got auto-classified `"fail"` on the second session —
  a real stage demotion, and after two such fails while in Stabilizing,
  `needsRelearning` fires and resets `practiceBPM` back to the suggested
  starting tempo. Nothing about their playing regressed; they were
  penalized for a tempo technicality the ladder was already correcting
  for on its own.
- **Options considered, presented to the user before writing any code:**
  1. Raise the repeat threshold from 2 to a tunable N before escalating.
     Simplest patch, but doesn't remove the false-fail case — just delays
     it, and adds another hand-picked constant to the pile in
     [Research.md](Research.md).
  2. **(Chosen)** Only let a reps-driven repeat escalate to fail; a
     tempo-only shortfall never can, however many times it repeats.
  3. Remove BPM from the pass/fail gate entirely — "pass" becomes
     reps-only, and tempo only paces how `practiceBPM` steps. The most
     thorough fix to the underlying philosophy, but the widest blast
     radius: it would have required changing `computeLadderAdvance`'s pass
     branch (which currently always steps `practiceBPM` up on a pass), and
     would change what counts as `effectiveness: "high"`, what can
     graduate a stage, and what `revival.js`'s combo-escalation can ever
     see as a fail from tempo alone (`sessionOutcome(s) === "fail"`,
     `computeComboEscalations`).
- **Why option 2:** it fully eliminates the false-fail case (not just
  delays it, unlike option 1) while keeping the change contained to
  `classifySessionOutcome` and its one caller (`ChecklistItem.jsx`) — it
  doesn't touch what "pass" means, what graduates a stage, or what revival
  can see, unlike option 3. It also preserves the original rule's intent:
  genuine stagnation (reps not coming together, session after session)
  should still surface as a real fail; it just no longer conflates that
  with a learner who is solidly meeting reps and only needs a little more
  time on tempo.
- **The fix:** `classifySessionOutcome` (`src/lib/confidence.js`) gained a
  `previousCleanReps` parameter. Escalation now requires
  `cleanReps < requiredReps` on **both** the current session and the
  previous one (`previousCleanReps < requiredReps`) — checking only the
  previous session's reps would have let an asymmetric case slip through:
  a reps-solid-but-slow session right after a genuinely bad one would
  still have wrongly escalated if the check only looked backward. No
  schema change was needed — `previousCleanReps` is read off the previous
  session's already-stored `cleanReps`, mirroring how `ladderSnapshot`
  already exposes the previous `practiceBPM`. `ChecklistItem.jsx` passes
  it through from `priorSessions[priorSessions.length - 1]`. `ladder.js`
  needed no change — it only ever consumed the returned outcome label, and
  that label's meaning (pass/soft-miss/fail) didn't change, only *when*
  "fail" gets assigned did.
- **Known limitation, reviewed and accepted — not a defect to fix:**
  `previousCleanReps` is compared against the `requiredReps` in force
  *now*, not the one that applied when that earlier session was actually
  logged. So reassessing a chunk's difficulty between two sessions makes
  the look-back judge the earlier session by the newer standard. Confirmed
  acceptable with the user: a difficulty reassessment realistically happens
  either within the first couple of encounters with a chunk or later once
  tempo has risen substantially, and in both cases what matters is that the
  chunk is *eventually* judged by the appropriate standard — which it is,
  from the reassessment onward. Recording the per-session standard would
  mean a new persisted field on every session record plus a backfill rule
  for all existing history; deliberately not built. The direction of the
  error is safe regardless: the Pass 14 rule escalates on a strict subset
  of what the pre-Pass-14 rule escalated on, so it can never produce a
  `"fail"` the old code wouldn't have produced too.
- Verified with new unit tests in `test/confidence.test.mjs`, including a
  direct reproduction of the original false-fail scenario and the
  asymmetric-repeat cases above. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#session-outcomes-three-tiers-not-two).

**Decision (Pass 14): `currentBPM` joins `ladderSnapshot` and is reverted by
session undo — the contained patch, not the larger "remove the field and
derive it from `sessions`" rewrite.**

- **The bug (previously logged as an open question, now closed):**
  `currentBPM` (the tempo last actually *played*, distinct from the
  ladder's `practiceBPM`) wasn't one of the six fields Pass 10's
  `ladderSnapshot` captured — "six small fields" was a deliberate scope
  call then, not an oversight. The consequence: after undoing a chunk's
  only session, `stage`/`practiceBPM`/`sessions` all correctly read as
  untouched, but `currentBPM` still held the undone session's value, and
  `computeAutoConfidence` reads it directly — so a fully-reverted chunk
  could still show a nonzero confidence score off a tempo no remaining
  session justified.
- **Two routes were possible, and the user picked the contained one:** add
  `currentBPM` to the snapshot (done), versus deleting the stored field
  entirely and deriving it from `sessions` (last session's `bpm`, or
  absent). The second is cleaner in principle — it removes this whole
  class of bug rather than patching one instance — but it touches every
  consumer of `currentBPM` (`computeAutoConfidence`, Progress's tempo-trend
  sparkline, the import merge's field-level recency rules) and wants its
  own pass with its own verification. Still available as a future
  simplification; nothing here forecloses it.
- **Backward compatibility was the real trap, and is the reason this
  wasn't a two-line change.** `handleUnlogSession` gates the full restore
  behind an `isValidSnapshot` check that requires specific keys to be
  present. Adding `currentBPM` to that check would have made *every
  already-saved session* fail validation at once, silently downgrading all
  existing logged sessions to record-only removal — a real regression on
  live data, in the exact code path that exists to protect it. Instead
  `currentBPM` follows `needsRelearning`'s established precedent: restored
  when present, deliberately *not* part of the validity check.
- **Unlike `needsRelearning`, there's no correct constant to fall back
  to.** An older snapshot restores `needsRelearning` as `false` because
  `false` was true of every such snapshot (the flag didn't exist yet to be
  set). No equivalent exists for a tempo — an older snapshot simply never
  recorded it. Reconstructing it from the remaining sessions was rejected
  as a guess: `currentBPM` can also be set by hand through
  `handleUpdateBPM`, so the last remaining session's `bpm` isn't reliably
  what the field held. A snapshot missing the key therefore leaves
  `currentBPM` untouched — exactly the pre-Pass-14 behavior, no better and
  no worse — consistent with the same "does not guess or reconstruct" rule
  the non-latest-session fallback already follows.
- Verified with new tests in `test/session-undo.test.mjs`: undoing a
  chunk's only session clears `currentBPM`, undoing the latest of several
  restores the previous session's tempo, and a regression test proves an
  older snapshot without the key still restores the six original fields
  instead of failing validation.

**Decision (Pass 26): task-card clarity is display/confirmation-only —
state the requirement up front, confirm before an under-logged attempt
saves silently, and rename the "soft-miss"/"fail" display labels. No
change to `classifySessionOutcome` or `computeLadderAdvance` — Pass 14's
classification stands exactly as shipped.**

- **Requirement line and confirm-before-save:** implemented as scoped, no
  open questions. See the build note in
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#session-outcomes-three-tiers-not-two)
  for the exact mechanics and the deliberate exclusions (zero-rep attempts,
  attempts already meeting the requirement, and attempts where
  `manualFail` is already checked all skip the confirm step).
- **The label renames were an explicit user decision, not a guess** — the
  request that scoped this pass named the requirement ("rename soft-miss")
  but cut off before naming a replacement, so implementation paused and
  presented options rather than picking one:
  - `"soft-miss"` → **"Partial pass"**, chosen from
    {"Partial pass", "Not yet", "Close, not yet"} — picked for reading as a
    plain, literal statement of what happened (matching "Full pass"/"Real
    fail" as one consistent naming pattern) rather than an editorialized
    one.
  - `"fail"` → **"Needs rework"** (was "Real fail") — raised mid-pass, not
    originally in scope: the user's first suggestion for this label
    ("try again next time at a slower tempo") was checked against what a
    real fail actually does and found to describe only the tempo pullback,
    not that a fail *also* demotes the chunk a stage on the ladder (and,
    on a second consecutive fail while already in Stabilizing, resets
    `practiceBPM` outright via `needsRelearning`) — exactly the kind of
    "chunk doesn't progress without the learner knowing why" gap this pass
    exists to catch. Re-presented as {"Step back", "Needs rework", keep
    "Real fail"}; "Needs rework" chosen. It doesn't spell out the stage
    demotion any more literally than "Real fail" did, but was confirmed
    acceptable — seeing the chunk again soon isn't a surprise once it
    reads as needing rework.
  - Both are display-label-only changes. The internal outcome values
    stay `"soft-miss"`/`"fail"` everywhere in code (`classifySessionOutcome`'s
    return value, `computeLadderAdvance`'s branches, `session.outcome`
    persisted on every session record) — renaming those would be a
    classification-adjacent change, explicitly deferred, and unnecessary
    besides: `SESSION_OUTCOME_META` (`src/lib/constants.js`) is the only
    place either display string lived, read dynamically by both
    `ChecklistItem.jsx` and `ProgressTab.jsx` — confirmed by grep, not
    assumed.
- **Flagged during this pass, resolved the same day — see the dedicated
  decision below:** choosing two distinct labels made an existing
  asymmetry visible that the old "Soft miss"/"Real fail" pairing didn't
  surface as clearly: a partial pass and a real fail step `practiceBPM`
  down by the *same* amount. The user asked for this to be looked into —
  see "Decision (Pass 26 follow-up): a real fail resets practiceBPM to the
  recorded tempo..." below for the three options presented and the one
  chosen.
- **Other technical wording reviewed at the time, one item acted on the
  same day:** `PieceMapTab.jsx`'s needs-relearning hint read "...rebuilds
  consistency in Stabilizing" — an internal ladder-stage name leaking
  directly into user-facing copy. Flagged, not fixed, when this pass
  shipped (renaming it read as a separate wording question). The user
  settled it immediately after — see "Decision (Pass 26 follow-up):
  rename the Piece Map's stage-name leak" below. Separately, and NOT
  revisited: a tempo-only shortfall (full reps, under `practiceBPM`)
  originally didn't trigger the confirm step, reasoned at the time that
  the requirement line already states the tempo floor up front — the user
  disagreed and asked for it to be added; see the same follow-up decision.

**Decision (Pass 26 follow-up, same day): widen the confirm-before-save
step to also cover a tempo-only shortfall, and rename the Piece Map's
"Stabilizing" leak to "the Introductory phase."**

- **Confirm step widened:** `submitLog` (`ChecklistItem.jsx`) now also
  confirms when reps fully meet the requirement but the achieved tempo is
  under `practiceBPM` — "You logged 3 clean reps at 90 BPM — under the
  102+ BPM needed to progress this chunk. Save anyway?" Reverses the
  original Pass 26 reasoning above ("the requirement line already states
  the tempo floor, nothing new to surface") on the user's explicit
  pushback: stating a requirement up front doesn't guarantee it was read
  or registered in the moment, and it's easy to log a tempo a little under
  target without noticing that doing so is what turns the session into a
  `"soft-miss"`. The two shortfall checks (reps, tempo-only) are mutually
  exclusive by construction — a reps shortfall is checked and handled
  first, so an attempt that's short on *both* still only sees the reps
  message, unchanged from the original Pass 26 behavior. Still skipped
  when `manualFail` is checked or on a zero-rep attempt, same reasoning as
  the original bullet. Still display/confirmation-only — no change to
  `classifySessionOutcome`.
- **"Stabilizing" renamed:** the literal string in
  `PieceMapTab.jsx`'s needs-relearning hint changed from "Stabilizing" to
  "the Introductory phase." Confirmed by grep that this was the only
  user-facing occurrence of any internal stage name anywhere in the app —
  `STAGES`, every `stage: "stabilizing"` value, and every code comment
  stay exactly as they are; only the one rendered JSX string changed. No
  `STAGE_LABEL`-style lookup table was introduced for this — "Settling"
  and "Holding" aren't displayed to a learner anywhere today, so building
  a mapping for values that don't have a second use yet would be
  speculative, not requested.
- Verified in-browser against a piece with real ladder state (two
  consecutive manual fails to trigger `needsRelearning: true`, confirmed
  in `localStorage` before checking the UI): the Piece Map's chunk detail
  modal shows the new phrase, and `npm test` stays at 223/223 (neither
  change touches tested pure functions).

**Decision (Pass 26 follow-up): a real fail resets `practiceBPM` to the
recorded tempo the chunk had the last time it freshly entered the stage
the fail demotes it INTO — not the flat −2 step a partial pass gets.**

- **Reopens a decision made once already, at the user's explicit
  request.** `lib/ladder.js` originally shipped with "a real fail costs
  `practiceBPM` the same 2 BPM as a soft-miss, not the steeper ~8–10 BPM
  pullback originally sketched" (see the dedicated decision earlier in
  this section). The user asked to revisit it directly. Presented back
  three concrete readings rather than guessing which one "the original
  demoted stage's tempo" meant:
  1. Reuse `getSuggestedStartingBPM` (the same reset `needsRelearning`'s
     rule 4 already applies) on *every* real fail.
  2. Restore something closer to the original pre-launch sketch: a flat,
     steeper pullback (e.g. −8 to −10 BPM), not tied to any specific past
     value.
  3. Track and restore the `practiceBPM` a chunk had the last time it was
     newly *at* the stage a fail demotes it *into*.
  The user picked **option 3** — the most literal reading, and the only
  one of the three that needed new persisted state, since nothing before
  this recorded "tempo at stage entry."
- **New fields: `stabilizingEntryBPM` / `settlingEntryBPM` /
  `holdingEntryBPM` on `ChunkProgress`** — the `practiceBPM` a chunk had
  the moment it most recently, freshly entered each named stage. Three
  flat scalar fields, not one nested `stageEntryBPM` object — deliberately,
  not an oversight: `storage.js`'s `ladderStateDiffers`/`mergeProgress`
  compare every ladder field with `!==`, which does *reference* equality
  on an object (two freshly-parsed JSON objects with identical contents
  are never `===`), so a nested object would have made every chunk with
  this field look like a false-positive import conflict. Flat scalars
  compare correctly by value, same as every other ladder field already
  does — caught in review before it shipped, not found as a bug after.
- **The mechanics (`lib/ladder.js`'s `computeLadderAdvance`):** a real
  fail looks up the recorded entry tempo for the stage it demotes INTO —
  `entryBPM[newStage]` — and resets `practiceBPM` there when a value is
  recorded, falling back to the ordinary −2 step when nothing's recorded
  yet (a chunk migrated in without history for that stage). This covers
  the ordinary case too, not just a "real" demotion between different
  stages: a fail while already in Stabilizing (`demote("stabilizing")`
  returns `"stabilizing"` — no stage change) resets to Stabilizing's own
  recorded entry tempo, which is exactly what you'd want a fail there to
  do. A chunk's very first-ever session seeds `stabilizingEntryBPM` from
  the just-chosen starting tempo, since that session IS Stabilizing's
  first entry — there's no earlier moment to have recorded. A graduating
  pass records the new stage's entry tempo the same way a fail-driven
  demotion does, so a later fail back down has something real to reset to.
  Rule 4 (`needsRelearning`'s `suggestedStartingBPM` reset) still wins
  outright over this — a stale/broken chunk getting flagged is a bigger,
  more deliberate reset than "go back to where this stage last was," and
  the two mechanisms were kept independent rather than merged.
- **Migration:** `backfillProgressLadderState` (`storage.js`) has no real
  per-stage history to reconstruct for a piece saved before this existed,
  so it treats "right now" as if the chunk just froze-entered whichever
  stage it's currently at — its current `practiceBPM` becomes that one
  stage's entry tempo; the other two stay `null` until a real transition
  gets recorded going forward. Same non-destructive, no-history-to-lose
  spirit as the rest of this migration.
- **Undo:** the three fields joined `ladderSnapshot`
  (`App.jsx`'s `handleLogSession`/`handleUnlogSession`) the same way
  `currentBPM` did earlier this pass — optional, not part of the
  `isValidSnapshot` gate, so a session logged before this existed still
  fully undoes rather than silently downgrading to record-only removal.
- Verified with new tests in `test/ladder.test.mjs` (including the full
  round trip: graduate into Settling at one tempo, climb well past it,
  fail back down to Stabilizing, confirm it resets to Stabilizing's own
  recorded entry tempo — not Settling's, and not a flat −2 off the climbed
  value), `test/storage.test.mjs` (migration backfill), and
  `test/session-undo.test.mjs` (full reversal, plus the same
  backward-compatibility regression `currentBPM` got: an older snapshot
  missing the new keys still restores everything else normally). Also
  verified manually in-browser against the real UI end to end — graduated
  a live chunk into Settling, climbed further, triggered the fail, and
  confirmed `practiceBPM` reset to the recorded Stabilizing entry tempo
  (not Settling's, not a flat step), then confirmed undo fully restored
  the pre-fail state. `npm test`: 237/237.

**Decision: Interleaved mode's "skip, just save time" action gets a
dedicated `skipped: true` branch inside `handleLogSession`, not a
zero-rep/zero-BPM call through the normal path (Pass 29).**

- **Why:** `classifySessionOutcome` treats a session with no clean reps as
  a genuine fail (`!cleanReps` short-circuits to `"fail"`). Someone
  declining to report an outcome mid-rotation is not the same event as a
  reported failed attempt, and silently recording a fail (which demotes
  the chunk's stage) would be actively wrong. The branch appends a session
  record (time, `loggedDate`) and sets the piece's `lastLoggedAt`, but
  returns before `computeLadderAdvance` runs — `stage`/`practiceBPM`/
  `nextDueDate` are left exactly as they were.
- **Alternative considered:** a separate handler
  (`handleLogSkippedSession`) alongside `handleLogSession`. Rejected —
  both write to the same `progress[id].sessions`/`doneDays` shape
  `handleLogSession` already owns, and forking that into two functions
  would mean two places could drift on that shape over time. One function,
  one new early-return branch.
- **Revised after code review, same pass — "log time without marking
  completed" is a general rule, not an Interleaved-only quirk:** the first
  version of this branch still added the day to `doneDays`, on the theory
  that Recent Practice History needed it to be visible. Two problems, both
  raised in review and fixed together rather than patched separately:
  1. Marking a chunk "done" with no outcome recorded misrepresents what
     happened — the user should be able to log time on any chunk without
     that being treated as completing it, and decide separately, during or
     outside Interleaved mode, whether/when to actually log a real
     attempt. Fixed by dropping the `doneDays` write from the skip branch
     entirely; a skip only ever appends to `sessions`.
  2. That same `sessions` array is what `computeAutoConfidence`,
     `computeProgressTier`, `formatLadderStatus`, and several Progress-tab
     stats (consistency days, tempo trend, outcome breakdown) all read as
     evidence of *judged* practice. A skipped record has no
     `outcome`/`effectiveness`, so `sessionOutcome` returns `null` for it —
     as the most recent session it silently muted `computeAutoConfidence`'s
     last-outcome pass/fail multiplier, and it inflated the outcome
     breakdown's denominator without landing in any of the three buckets,
     pulling every real percentage down. Fixed with one shared predicate,
     `loggedSessions(sessions)` (`lib/utils.js`, `!s.skipped`), read by
     every one of those consumers instead of the raw `entry.sessions`.
     `sumPracticeSeconds` deliberately does **not** use it — a skip's time
     still counts toward total time practiced, since saving that time was
     the whole point of the button.
  3. (Caught in the same pass, not user-reported but a direct consequence
     of the above.) `ChecklistItem` renders whichever session is most
     recent for a given chunk/day regardless of which view surfaced it —
     Day view, Week, View all, and the past-plan due-review panel all
     share it. A skipped session has no `cleanReps`/`bpm`, so it rendered
     literally `"Logged: undefined consecutive clean reps at undefined
     BPM"` if that chunk/day was viewed anywhere outside Interleaved mode.
     Fixed with a dedicated render branch for `session.skipped` ("Skipped
     in Interleaved practice — not marked done").
- Verified with `test/interleave-skip.test.mjs` (doneDays explicitly
  asserted unchanged by a skip, both alone and followed by a real log the
  same day), `test/confidence.test.mjs` (a trailing skip doesn't move
  `computeAutoConfidence`'s score, `computeProgressTier` reads a
  skip-only chunk as "untouched", `formatLadderStatus` treats it as no
  history), `test/utils.test.mjs` (`loggedSessions` filters correctly;
  `sumPracticeSeconds` still counts a skip's time), and
  `test/old-piece-interleave-compat.test.mjs` (the whole path — real
  `validateAndMigratePiece`, then eligibility, then a skip — run against a
  piece shaped like a genuine pre-ladder save, not a fixture built to
  already match this pass's assumptions). Every new test was confirmed to
  actually fail when the corresponding fix was reverted, not just pass
  against the fixed code. Also verified manually in-browser end to end
  against a hand-seeded old-format piece (no `ladderConfig`, no `stage`,
  legacy `effectiveness`-keyed sessions): migrated cleanly, showed the
  correct backfilled time-practiced total, became Interleave-eligible once
  advanced to Settling exactly like a native chunk, skip left `doneDays`/
  confidence/ladder state untouched and correctly excluded the skip from
  Recent Practice History and the outcome breakdown, the Day view
  rendered the new "Skipped in Interleaved practice" line instead of the
  old "undefined" text, and a follow-up real log then marked the day done
  normally. `npm test`: 315/315.

**Decision: a soft-miss/fail AUTO-classified during Interleaved practice is
saved provisionally — real reps/BPM recorded, but not applied to the
ladder until the learner confirms or discards it — rather than committing
immediately like a normal logged session (Pass 29 follow-up).**

- **Why:** raised directly by the user — interleaved retrieval practice
  routinely produces worse-looking results than the same chunk would get
  in focused, blocked practice, while still being the more effective
  practice for long-term retention. Auto-demoting a chunk's stage the
  instant a rougher-than-usual interleaved attempt lands would punish
  exactly the practice this feature exists to encourage, and would cut
  against [Product-Principles.md](Product-Principles.md)'s permanent "no
  punishment mechanics" rule in a new, narrower way this codebase hadn't
  had to consider before (existing punishment-avoidance work — "a review
  arriving late is schedule slack, never a failure" — is about *timing*,
  not about discounting a worse-than-usual *result*).
- **Options considered, from the user directly:**
  1. Block and prompt right when the rough result lands ("save as-is or
     redo?"). Rejected — it interrupts the rotation's flow every time an
     interleaved attempt comes out worse than blocked practice would,
     which per the whole premise here is expected and common, not
     exceptional.
  2. Commit as-is, no special handling (today's behavior at the time).
     Rejected — doesn't address the actual concern; a real fail still
     demotes the chunk immediately regardless of context.
  3. **Chosen: save the attempt, don't auto-commit it.** No blocking
     dialog — the rotation keeps moving. Resolution happens later, on that
     chunk's own card, wherever it's next viewed (Day view, Week, View
     all, the due-review panel, Revival, or the same chunk's own turn
     coming back around in Interleaved mode) — same "not marked completed
     until resolved" shape the skip fix (above) already established, just
     with real numbers attached instead of none.
  A companion question — should a full PASS get the same provisional
  treatment? — was asked and answered explicitly: no. Only soft-miss/fail
  go provisional; a clean pass has nothing worth deferring a decision
  about.
- **Mechanism, reusing what already existed rather than inventing new
  ladder semantics:** `handleLogSession` gets one more branch,
  `provisional: true` (same shape as the `skipped` branch it sits beside —
  save the record, return before `computeLadderAdvance`, don't touch
  `doneDays`), and two small new handlers —
  `handleConfirmProvisionalSession` (finally runs the saved outcome through
  `computeLadderAdvance`, dated to the confirm moment, and stamps a
  `ladderSnapshot` so the **existing, unmodified** `handleUnlogSession` can
  still fully reverse it later) and `handleDiscardProvisionalSession`
  (removes the record, no ladder snapshot needed since nothing was ever
  applied). No new session-history data structure, no parallel logging
  path, no changes to `computeLadderAdvance` or `classifySessionOutcome`
  themselves.
- **UI, threaded through the existing shared component rather than
  built new:** `ChecklistItem` — used by Day view, Week, View all, the
  due-review panel, and Revival — gets a third render branch alongside
  the existing session/skip ones: reps/BPM logged, what outcome it would
  register as, and Confirm/Discard buttons. `InterleavePanel` shows the
  same summary inline (not a popup) if the currently-rotating chunk
  already has an unresolved provisional session from an earlier turn, so
  it isn't silently lost mid-session either. `SectionRunThroughPanel` was
  deliberately left unwired — it only ever renders synthetic `sr_`-id
  run-through chunks, which are excluded from `chunkSet.all` by design
  (`CLAUDE.md`), so they can never reach Interleaved mode and can never
  carry a provisional session; wiring props into an unreachable path
  would be dead code, not defensiveness.
- Verified with `test/interleave-provisional.test.mjs` (provisional save
  leaves doneDays/stage/practiceBPM/nextDueDate untouched; confirm applies
  the saved outcome and dates the ladder math to the confirm moment, not
  the original attempt; confirm targets only the most recent *provisional*
  session for that day, not an already-resolved one logged the same day;
  discard removes cleanly with no ladder effect; both are no-ops with
  nothing pending) — each test confirmed to actually fail when the
  corresponding behavior was reverted. Also verified manually in-browser
  end to end: logged a reps-shortfall attempt in Interleaved mode, confirmed
  no blocking dialog appeared and the ladder (stage/practiceBPM/nextDueDate)
  stayed untouched while the real reps/BPM were saved; saw the same
  "Unresolved from earlier" summary in both InterleavePanel (the chunk's
  next turn) and Day view (`ChecklistItem`); clicked Confirm and watched
  `computeLadderAdvance` apply for real (consecutivePasses reset,
  practiceBPM stepped down, nextDueDate rescheduled 7 days from the confirm
  date, `doneDays` gained the original attempt day, a `ladderSnapshot` was
  stamped) with the due-review item correctly dropping off today's list
  once its due date moved to the future; seeded a second provisional
  attempt and clicked Discard, confirming the record vanished with zero
  effect on stage/practiceBPM and the Progress tab's outcome breakdown/
  practice history reflecting only the two real, resolved sessions.
  `npm test`: 324/324.

**Decision: leaving Interleaved mode with an unconfirmed provisional log warns and, on confirmation, discards it — reversing the "resolve whenever, no deadline" model the provisional-logging decision above just established (user-directed follow-up, same lineage).**

- **Why:** raised directly by the user, as a deliberate narrowing of the earlier design — an unresolved provisional session left open indefinitely was judged more likely to be silently forgotten than genuinely revisited later.
- **Scope, decided narrowly rather than broadly (user's explicit choice between two offered options):** the warning fires only while Interleaved mode is *actively on screen* (`viewMode === "interleave"`) with a provisional from *that* rotation still pending — not for any older, unrelated provisional sitting unresolved elsewhere in the piece. Leaving means any of: switching to Day view/Week/View all, navigating to a different app tab, or switching to a different piece. Confirming discards every pending chunk in that rotation and lets the navigation proceed; cancelling blocks the navigation and touches nothing.
- **A real technical ceiling, surfaced before writing any code:** modern browsers force their own generic wording on the native "close this tab" (`beforeunload`) dialog and ignore any custom message a page supplies — a limitation of the browser, not this app. Given that, the user chose (their explicit call, offered as a tradeoff) to only warn for in-app navigation, where the exact requested wording *does* show, and to not attempt a `beforeunload` handler that could only ever show generic browser text.
- **Mechanism:** `TodayTab` (which owns `viewMode` and the eligible-chunk list) computes the live risk and reports it up to `App.jsx` via `onInterleaveRiskChange` (lifted `useState`, not a ref — see the implementation note below on why a ref-registration version of this was tried first and abandoned), since `App.jsx` is what actually owns sidebar/piece-switcher navigation (`CLAUDE.md`: "App.jsx: state + layout only"). One shared function, `confirmAndDiscardProvisional`, is used both by `App.jsx` itself (sidebar nav, `switchToPiece`) and passed down to `TodayTab` (its own segmented-control buttons) as `onConfirmLeaveInterleaved`, so the warning text and discard behavior can never drift between the two call sites.
- **Two real bugs found and fixed while building this, both only surfaced by manual browser testing, not by code review:**
  1. **An infinite render loop.** The first version of the risk-reporting effect ran on every render with no dependency array, and called `onInterleaveRiskChange` with a freshly-constructed `{ chunkIds, day }` object literal every time — a *new object reference* even when the actual chunk ids and day hadn't changed. React's state setter saw that as a real change every time, re-rendering, re-running the effect, sending yet another new object: `Maximum update depth exceeded`, reproduced live, not theoretical. Fixed by keying the effect's dependency array on `interleavePendingChunkIds.join(",")` (a stable string derived from the actual content) instead of either the raw array or no dependency array at all.
  2. **A silent persistence bug**, found only by explicitly reloading the page after a piece-switch discard and checking whether it survived — the in-memory result looked correct the whole time, which is exactly why this needed a reload check, not just a post-click assertion. `switchToPiece` discards the *old* piece's provisional session and reassigns `activePieceId` to the *new* piece inside the same event handler, so both land in the same React batch. The auto-save `useEffect` (`App.jsx`) had been scoped to "persist only the active piece when it changes" since it was first written — a reasonable assumption right up until this pass, since nothing before it ever mutated a piece other than the currently-active one in the same tick a piece-switch also happened. By the time that effect re-ran, `activePieceId` already pointed at the *new* piece, so it saved the new piece and never separately re-saved the old one — the discard was computed correctly in `pieces` state but never reached `localStorage`, silently reverting on the next reload. Fixed at the root rather than special-cased for this one call site: the effect now saves every entry in `pieces` whenever that object changes, removing the "only active" assumption entirely rather than teaching one more handler to route around it (bulk reschedule, elsewhere in `App.jsx`, had already independently hit the same "only active" gap and worked around it locally — this fix is the generalized version of that same fix). Verified with an actual page reload after the discard, not just an immediate read. Trade-off, not fully load-tested: every piece in `pieces` is now re-serialized and re-written to `localStorage` on any single piece's change, not just the changed one — fine for the handful of pieces a musician realistically has open, untested at a large piece count or against a piece with a very long session history.
- **A third gap, found on critical review after the above shipped, not during the original build: two more sidebar controls changed `activeTab`/`activePieceId` without going through the guard at all.** The "Edit piece" button (`startEditing`) and finishing the "+ Add new piece" wizard (`handleComplete`) both live in the persistent sidebar, visible from Interleaved mode same as the nav list and piece switcher, and both were missed in the original implementation because the review-then-build pass only exercised the three routes it had explicitly set out to test, not an exhaustive audit of every place `setActiveTab`/`setActivePieceId` is called in `App.jsx`. Not a data-loss bug — neither path discarded anything on its own, they just silently skipped the warning — but squarely inside what "a different app tab, or a different piece" was already understood to mean. Fixed the same way as the other three: one `if (!guardLeavingInterleaved()) return;` line at the top of each handler. For `handleComplete` specifically, gating at the very top means a cancelled leave attempt also skips creating the new piece — verified deliberately, not incidentally: the wizard modal stays open (`wizardOpen` is only set to `false` further down in the same function, which a `return` above it never reaches) with the learner's already-entered fields intact, so cancelling costs nothing beyond having to click "Generate my plan" again once the pending log is dealt with.
- **Verification note:** the persistence bug specifically is not something a pure-function unit test would have caught or would meaningfully validate — it lived entirely in *React's state-batching order relative to an effect's dependency array*, not in any computable input/output logic. This repo has no React render harness (`CLAUDE.md`), so the real verification for all three bugs was live browser testing: reproducing the infinite loop via the console warning, then confirming it was gone; reproducing the lost discard via an actual reload, then confirming the reload preserved it after the fix; and for the two missed routes, confirming both the cancel path (nothing created/discarded, wizard data preserved) and the confirm path (discards, proceeds, survives a reload) same as the original three.
- Verified with `test/utils.test.mjs` (`hasPendingProvisionalSession` — the day-scoped pending check) and `test/interleave-leave-warning.test.mjs` (mirrors of `confirmAndDiscardProvisional`/`guardLeavingInterleaved`, since both are closures inside `App.jsx`: prompts with the exact wording, discards every pending chunk id on confirm, discards *nothing* on cancel, no-ops with nothing pending). Both confirmed to actually fail when the corresponding behavior was reverted — this coverage is at the shared-function level, so it already covered the two routes found in review without needing new tests once they were wired to the same function. Manually verified in-browser, end to end, for all **five** leave routes (Today's Practice's own Day view/Week/View all buttons, the sidebar nav list, the piece switcher, the "Edit piece" button, and finishing the "Add new piece" wizard) — for each: the cancel path blocks the action and preserves the provisional; the confirm path shows the exact requested wording, discards, proceeds, and survives a real reload; and normal navigation with nothing pending proceeds with zero `confirm()` calls at all, confirmed via an instrumented call counter. `npm test`: 352/352.

**Decision (Pass 69): Interleaved practice needs two graduated chunks to unlock, not one, and its rotation duration is graded by the current chunk's own difficulty instead of a flat 4 minutes.**

- **Why the threshold moved:** a single qualifying chunk can't actually
  rotate against anything — Interleaved practice's whole premise is
  switching between different material. The old `interleaveItems.length
  === 0` gate let the button enable the instant exactly one chunk
  graduated, into a mode with nothing to interleave. Moved to `< 2`
  (`TodayTab.jsx`); the lock hint now distinguishes "no chunks have
  graduated" from "only one chunk has graduated" — a state the old gate
  never needed to describe, since it only ever had one locked state to
  explain.
- **Why the duration is graded:** requested directly, as a tuning
  refinement to the flat interval Pass 29 shipped with (still explicitly
  not user-configurable — see
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29)).
  `ROTATION_SECONDS_BY_DIFFICULTY = { easy: 120, medium: 180, hard: 240 }`
  (`InterleavePanel.jsx`) replaces the flat `ROTATION_SECONDS = 240`;
  `hard` keeps the exact original value, `easy`/`medium` rotate faster.
- **A real bug caught before shipping, not shipped as scoped:** the
  rotation-trigger `useEffect`'s dependency array was `[running,
  items.length]` — it doesn't include `index`/`current`, so the
  `setInterval` closure keeps whatever chunk was current when the effect
  last (re)ran. `advance()` moves `index`/`current` forward *without*
  this effect re-running, so a naive read of
  `current.chunk.difficultyLabel` inside the existing closure would keep
  checking a stale chunk's threshold against a live chunk's elapsed time
  after a mid-session rotation. Fixed by adding `current?.id` to the
  dependency array, tearing the interval down and rebuilding it on every
  rotation — `resetTurn()` (already called from `advance()`) already
  zeroes `elapsedSeconds`, so this doesn't change any existing reset
  behavior, it only fixes which chunk's threshold the rebuilt interval
  checks against.
- **Verified:** manually, in-browser, using a `Date.now()` override to
  fast-forward real elapsed time without waiting out actual 2/3/4-minute
  intervals — confirmed each difficulty's rotation fires at its own
  threshold (not the old flat 240s, and not another difficulty's
  threshold): an easy chunk advanced at ~125s, a medium chunk advanced at
  ~183s but was confirmed to *not* advance at 185s while showing as hard
  (proving the check is genuinely per-chunk, not "whichever is
  shortest"), and a hard chunk correctly waited past 240s. `npm test`:
  592/592 — no `lib/` changes, both touched files are components.

**Same-session follow-up, per direct request: the eligible-chunk pool
(`TodayTab`'s `interleaveItems`) is scoped to every graduated chunk in the
whole piece, not just whatever the currently-viewed day happens to
schedule.**

- **Why:** raised directly by the user, immediately after this pass's own
  summary flagged — as a discovery, not a decision — that the pool was
  today-scoped. Previously built from `todaysIds`
  (`[...day.newChunkIds, ...day.specialChunkIds, ...day.reviewChunkIds]`,
  de-duplicated) filtered by `isInterleaveEligible` — meaning a chunk that
  graduated past Stabilizing on an earlier day was invisible to
  Interleaved mode entirely unless it also happened to be scheduled (or,
  for a past-plan piece, live-due) on the exact day being viewed.
- **The fix:** `interleaveItems` now filters `chunks` (`chunkSet.all` —
  every practice chunk, transition, and combo in the piece, already a
  prop this component receives) directly by `isInterleaveEligible`, with
  no day-scoping and no de-duplication needed (`chunks` has no duplicate
  ids the way `todaysIds` could). Nothing downstream needed to change:
  session logging already attributes to `todaysDayNumber` independent of
  which chunk from the pool is being practiced, and the
  pending-provisional check (`hasPendingProvisionalSession`) is keyed the
  same way.
- **Confirmed safe against one specific worry, not just assumed:** could a
  chunk flagged `needsRelearning` now wrongly surface piece-wide? Traced
  through `computeLadderAdvance` (`lib/ladder.js`) directly — the flag can
  only be *set* while `stage === "stabilizing"` (rule 1's own condition),
  and `demote("stabilizing")` is a floor (stays at `stabilizing`), so a
  freshly-flagged chunk never has `stage` advance past Stabilizing at the
  moment it's flagged. Graduating a flagged chunk *out* of Stabilizing
  auto-clears the flag in that same transition (the pass branch's own
  comment: "graduating out of Stabilizing (the only stage a flagged chunk
  can be in)"). The two states — `needsRelearning: true` and `stage` past
  Stabilizing — are mutually exclusive by construction, so
  `isInterleaveEligible` already excludes every flagged chunk regardless
  of pool scope; this wasn't a gap to fix.
- **A likely, not separately verified, side effect on an older flagged
  gap:** a Pass 66 follow-up entry above flagged that a review only
  surfaced *live* (via `mergeLiveDueReviews`, folded into
  `dayForChecklist` — not the plan day's own original, unmerged
  `reviewChunkIds`) never appeared in `interleaveItems`, since the old
  pool read the unmerged `day` directly. Since the pool is no longer
  built from any day's placement at all — only from live ladder `stage`
  — a chunk with a live-due review that's past Stabilizing is now
  included unconditionally, which appears to close that gap as a side
  effect. Not deliberately reproduced against that exact original
  scenario, so this is a reasoned inference from reading both mechanisms,
  not a confirmed fix — worth a direct check before relying on it.
- **Verified:** manually, in-browser — built a piece where only one chunk
  was scheduled for the day being viewed, with all three chunks marked
  graduated (their next reviews weeks away, not due that day or any day
  soon). Confirmed Interleaved mode unlocked immediately ("1 OF 3") and
  rotation correctly stepped through all three, despite only one being on
  that day's own schedule. `npm test`: 592/592.
- See [Algorithms.md](Algorithms.md#isinterleaveeligible--interleaved-modes-eligibility-rule-pass-29).

**Decision: `practiceBPM`'s pass/soft-miss step becomes gap-proportional (a "tempo ratchet"), replacing the flat `ladderConfig.bpmSteps` deltas that had driven it since Pass 1 — and a soft-miss now steps `practiceBPM` forward instead of backward.**

- **Why:** the flat `+2`/`−2` step moved a chunk 40 BPM below target at
  exactly the same pace as one only 2 BPM away — the ladder's stage/interval
  math already scales with how solid a chunk is, but the actual tempo climb
  never did. Requested directly by the user as Pass 59.
- **Formula:** `gap = targetBPM - practiceBPM`; `step = clamp(round(k *
  gap), 1, kCapBpm)`, with `k` defaulting to 0.3 and `kCapBpm` to 8
  (`ladderConfig.tempoRatchet`, merged field-by-field in
  `mergeLadderConfig` the same way `bpmSteps` already is). The 1-BPM floor
  means a pass/soft-miss always moves `practiceBPM` at least 1 BPM forward,
  even for a chunk already at or past `targetBPM` — though `stepBPM`'s
  pre-existing cap-at-`targetBPM` can still flatten the *net result* back
  down regardless (see the overlearning bonus below for the one path
  allowed past that cap). No `targetBPM` to be proportional against falls
  straight back to the old flat `bpmSteps.pass`/`bpmSteps.softMiss` step,
  unchanged — this pass doesn't invent a gap-based number from nothing.
- **A soft-miss no longer costs tempo.** Once the step became
  gap-proportional, a flat backward step on soft-miss fought against the
  ratchet's own logic (a chunk struggling on reps but still near target
  would get yanked disproportionately far back). Instead, a soft-miss
  **halves the chunk's own adaptive rate** (a new persisted per-chunk flat
  scalar, `progress[id].tempoRatchetK`, alongside — not nested inside —
  `practiceBPM`/the `...EntryBPM` fields, following that exact precedent so
  `storage.js`'s ladder-state diffing/merge keeps comparing every field by
  `!==`) and applies the step at that halved rate: still forward, just
  slower. Two consecutive qualifying passes afterward restore `k` to the
  configured default — reusing `consecutivePasses` rather than a new
  counter, since that counter already resets to 0 on every soft-miss and
  demote, so reaching 2 within the same stage already means "two clean
  passes back to back" with no new bookkeeping needed. A real fail resets
  `k` to default outright too, regardless of which of the three existing
  `practiceBPM`-reset paths fired — new state, since none of those paths
  had any adaptive rate to reset before this pass.
- **Overlearning bonus, and why its cap is deliberately looser than
  everything else:** when a logged `bpm` clearly beats what was actually
  asked (`outcome.bpm > practiceBPM`, not merely equals it), the step
  widens to `max(normalStep, round(0.5 * (bpm - practiceBPM)))` — rewarding
  a learner who's clearly capable of more than the ladder was asking for
  that session, rather than making them wait out several more
  ratchet-sized steps to get there. The **result** is capped at `1.15 ×
  targetBPM`, computed and capped separately from `stepBPM`'s normal
  `Math.min(stepped, targetBPM)`, since this is the one path deliberately
  allowed to push `practiceBPM` *above* target — a small headroom margin so
  a chunk that's already demonstrably solid isn't immediately re-capped
  down to exactly `targetBPM` the moment it's clearly exceeded it. Never
  applies on top of `computeDemonstratedTempoBaseline` (which still takes
  priority exactly as before this pass, including its own cap-at-`target`,
  never `1.15×`) and never applies with no `targetBPM` (nothing to cap
  against). `ChecklistItem` surfaces an "Overlearning" note whenever the
  chunk's persisted `practiceBPM` currently sits above `targetBPM` — every
  other path (the flat step, the ratchet step, the demonstrated-tempo
  override) caps at `targetBPM` and never exceeds it, so that condition
  alone is an exact proxy for "the bonus fired and is still in effect,"
  with no new flag needed from `computeLadderAdvance` itself. **A known,
  accepted consequence, not a bug to chase:** once `practiceBPM` sits above
  `targetBPM` from a bonus, the very next *ordinary* (non-bonus) pass —
  gap now negative, ratchet step floors at 1, `stepBPM`'s own cap-at-target
  applies — snaps `practiceBPM` straight back down to exactly `targetBPM`,
  and the note disappears. This is the direct, intended consequence of
  only the bonus path being allowed past `stepBPM`'s cap; making the
  overlearning state "sticky" across an ordinary pass wasn't part of what
  was asked for, and wasn't built.
- **Deliberately untouched:** the fail branch's flat `bpmSteps.fail` step
  itself (already effectively dead in practice — `stabilizingEntryBPM` gets
  seeded the moment a chunk first enters Stabilizing, and a fail's
  `demote()` always lands back on Stabilizing as the floor, so the
  entry-tempo reset almost always wins over the flat step long before this
  pass, and nothing about that priority order changed here);
  `computeDemonstratedTempoBaseline` itself; and exposing `k`/`kCapBpm` in
  Pass 17's `LadderConfigEditor` (`SettingsTab`) — a natural follow-up, not
  required for the mechanism to function with sane defaults.
- Verified with `test/ladder.test.mjs` (the gap-proportional formula across
  a range of gaps, respecting both the 1-BPM floor and the `kCapBpm`
  ceiling; a soft-miss halving `k` and still stepping forward at the halved
  rate; two consecutive clean passes fully restoring `k`; a fail resetting
  `k` via all three `practiceBPM`-reset paths; the overlearning bonus
  applying only when `bpm` beats `practiceBPM`, capping the result at
  `1.15×targetBPM` — including a float-precision guard, since
  `1.15 * 100 === 114.99999999999999` in raw JS — and never overriding
  `computeDemonstratedTempoBaseline`; a `null` `targetBPM` falling back to
  the untouched flat step). Every pre-existing `ladder.js`/`session-undo`/
  `storage.js` test that hardcoded a flat `+2`/`−2` step's exact resulting
  `practiceBPM` was individually re-derived under the new formula and
  updated (not just re-run for a green suite) — the step magnitude
  genuinely changed for any chunk with a `targetBPM` set, which is most of
  them, so a large fraction of pre-existing ladder tests needed their
  expected numbers recomputed, not just re-confirmed. `npm test`:
  458/458.
- **Two real bugs found on review after the above shipped, both fixed the
  same session, not deferred:**
  1. **`Wizard.jsx`'s `defaultPiece()` would crash a brand-new piece's
     first logged session.** It hardcodes a literal `ladderConfig` (not
     run through `mergeLadderConfig` — `App.jsx`'s `handleComplete`
     deliberately doesn't put a freshly-created piece through
     `validateAndMigratePiece`) that had been updated with `bpmSteps` long
     ago but was missed for `tempoRatchet` when this pass first shipped —
     so `ladderConfig.tempoRatchet.k` was `undefined` for any piece
     created via the Wizard until its next reload. Fixed by mirroring
     `tempoRatchet` into that literal, same as `bpmSteps` already is.
  2. **`App.jsx` never actually threaded `tempoRatchetK` through
     `handleLogSession`/`handleUnlogSession`/`handleConfirmProvisionalSession`
     when this pass first shipped** — the pure `computeLadderAdvance`
     function and its persistence contract were correct and fully tested,
     but the three closures that call it (mirrored in
     `test/session-undo.test.mjs`/`test/interleave-provisional.test.mjs`
     for exactly this reason — no React render harness exists) never read
     `prevEntry.tempoRatchetK` in, never wrote `advance.tempoRatchetK`
     back out, and never captured it in `ladderSnapshot`. In the real app
     this meant `k` silently reset to the default on every single call
     instead of persisting — no crash, but the entire halve/recover/reset
     lifecycle never actually took effect. Fixed by adding `tempoRatchetK`
     to the same seven spots `stabilizingEntryBPM` already occupies across
     those three handlers (in, out, and the optional/not-`isValidSnapshot`
     snapshot-restore treatment), plus updating `session-undo.test.mjs`'s
     mirror (the one file whose own mirror is exhaustive across every
     ladder field, unlike `interleave-skip.test.mjs`/
     `interleave-provisional.test.mjs`'s narrower, already-partial
     mirrors) and adding three new undo-reversal tests for it. Verified
     live in-browser end to end, not just via the mirrored tests: created
     a real piece through the Wizard (confirming fix 1), seeded a
     non-default `tempoRatchetK`, logged a real pass through the actual
     UI and confirmed via `localStorage` that the resulting step size used
     the seeded rate (not silently the default), logged a second
     consecutive pass and confirmed `k` recovered to default, then clicked
     Undo and confirmed `k` reverted to the pre-recovery value — the exact
     mechanism `session-undo.test.mjs`'s new tests check, reproduced for
     real. `npm test`: 461/461.
- **A skeptical second-engineer review (user-requested, same session) of
  every file this pass touched found three more real issues.** One fixed
  outright, one left alone on the user's explicit call (a standing
  decision this pass shouldn't override unilaterally), one left as
  documented, tested behavior rather than given new persisted state it
  didn't need:
  1. **Fixed: the migration backfill for `tempoRatchetK` caused a real
     false-positive import conflict, described above under "Corrected
     after review, same session" — see
     [Algorithms.md](Algorithms.md#tempo-ratchet-pass-59) for the
     mechanics and `test/storage.test.mjs`'s two new
     `diffImportedPiece` regression tests (one proving the false conflict
     is gone, one proving a genuine `tempoRatchetK` disagreement is still
     caught).
  2. **Left alone, on the user's explicit choice:** the overlearning bonus
     can trigger the already-known, already-reviewed-twice "a same-session
     tempo jump doesn't get graduation credit until the next session"
     quirk (see the `clearsStageFloor`-ordering item in
     [Open questions](#open-questions) below) through a second path —
     confirmed by direct reproduction (a bonus-driven jump from 50 to 73
     against a 70 floor: `practiceBPM` correctly lands at 73, but
     `graduated: false` and the pass isn't counted, exactly the
     pre-existing symptom). Presented to the user as a real choice, not
     assumed: the actual fix means reordering `computeLadderAdvance`'s
     floor-check timing, which is exactly the change the standing
     decision already declined twice, on the grounds that a one-session,
     self-correcting delay doesn't justify the risk of reordering an
     already-dense function. **The user chose to leave it.** The open
     item below is updated to note the bonus as a second trigger path,
     not treated as a new, separate issue.
  3. **Left as documented/tested behavior, not given new state:** `k`
     recovery (`passesIfCounted >= 2`) is gated by the same stage-floor
     check graduation counting already uses — reusing
     `consecutivePasses` (as this pass was explicitly asked to do, rather
     than adding a new counter) means a chunk sitting below its stage's
     tempo floor doesn't advance that counter at all, floor-clearing or
     not. Consequence, confirmed by direct simulation: a chunk that
     soft-misses while well below Settling/Holding's tempo floor keeps
     ratcheting at the halved rate for as long as it takes `practiceBPM`
     to *climb* to that floor — which, being at the halved rate, takes
     longer than it otherwise would. Self-correcting (it does recover,
     once floor-clearing), not data-destructive, and Stabilizing has no
     floor so this can't happen there. A real, independent fix (decoupling
     recovery from the floor) would need a second persisted counter,
     which directly contradicts this pass's own "reuse the existing
     counter, don't add a new one" instruction — judged disproportionate
     for a cosmetic recovery-speed delay, not put to the user as a
     from-scratch choice the way item 2 was, since there's no standing
     decision here to override, just this session's own engineering
     judgment. Documented here and covered by a new regression test in
     `test/ladder.test.mjs` (`Pass 59: tempo ratchet — k recovery is
     gated by the same stage floor graduation uses`) so the exact
     contour is asserted, not just narrated.
  - `npm test`: 465/465 (462 before this round: 2 new `diffImportedPiece`
    tests, 1 new k-recovery-floor-gating test).

**Decision (built — Pass 60): "tempo maintenance mode" is computed live off
`practiceBPM`/`targetBPM`, never persisted per chunk — confirmed exitable
by construction, not something needing explicit exit or flapping-prevention
logic.**

- **Why:** once a chunk's `practiceBPM` is already close to `targetBPM`,
  the tempo ratchet's gap-proportional step (Pass 59, above) doesn't need
  to keep chasing the gap at the chunk's own adaptive rate — a small,
  pinned rate is enough to keep nudging forward near the top without risk
  of an oversized single-session step. `ladderConfig.tempoRatchet` gains
  two new fields for this, extending the same object Pass 59 introduced
  rather than a separate namespace: `tempoAchievedThreshold` (default 0.85,
  adjustable up to 1.0 — the fraction of `targetBPM` at/above which a chunk
  is "in maintenance") and `maintenanceK` (default 0.05 — the pinned rate
  substituted at that point).
- **Resolved before building anything, not assumed: no new persisted
  per-chunk field.** `inTempoMaintenance = targetBPM != null && practiceBPM
  != null && practiceBPM >= targetBPM * tempoAchievedThreshold`
  (`isInTempoMaintenance`, `lib/ladder.js`) is recomputed every time it's
  needed, matching this codebase's existing preference for computed-live
  over persisted-and-tracked wherever the inputs are already available
  (the same spirit as `chunkSet`/`timeline` being pure derivations, never
  persisted — `CLAUDE.md`). This makes exit free: a fail's existing
  entry-BPM reset (Pass 26 follow-up) dropping `practiceBPM` back below the
  threshold means the very next check simply reads `false` again — no
  explicit "exit maintenance mode" code path, and nothing that can go stale
  or flap, since it's never state to begin with.
- **The substitution happens only at the point a step size is computed,
  never overwrites what's tracked.** `progress[id].tempoRatchetK` — the
  chunk's own adaptive rate — keeps stepping/halving/recovering exactly as
  Pass 59 already has it, on every branch, regardless of whether
  maintenance mode is active for that particular session. Only the `k`
  value fed into `tempoRatchetStepSize` at the two call sites (the
  soft-miss and pass branches) is swapped for `maintenanceK` while
  `inTempoMaintenance` is true. Concretely: a soft-miss in maintenance mode
  still halves the *tracked* rate and persists the halved value, same as
  always — but the *step actually taken* that session uses `maintenanceK`,
  not the halved rate. There's nothing to "restore" once maintenance mode
  exits, since the tracked rate was never touched by it in the first place.
- **Explicitly not connected to ladder `stage`.** Raised directly by the
  user during scoping and stated here for the record: this has nothing to
  do with Stabilizing/Settling/Holding or `demote()`'s fail-driven
  demotion, which already happens today independent of anything in this
  decision. `inTempoMaintenance` is a tempo-*stepping-rate* concept only —
  a chunk can be in maintenance mode at any stage, and demotion on fail is
  completely unaffected by it.
- **Explicitly not connected to `isPieceLearned`/`isPlanActuallyComplete`,
  on purpose, not an oversight.** The pass description that scoped this
  work mentions a chunk in maintenance mode should eventually "stop
  counting toward the plan being not done yet" — genuinely unresolved, and
  the user has said explicitly they'll define what that means once they
  reach it; this pass does not guess, and does not wire `inTempoMaintenance`
  into either function regardless of what it turns out to mean. Likely
  candidate when it is resolved, per the user: Pass 30's "tempo climbing"
  nudge (`hasClimbingTempo`, `lib/confidence.js`) — a chunk in maintenance
  mode has, by definition, already climbed as far as it currently needs to.
  Tracked as an explicit open item below, not silently decided.
- **"Keeps its normal review frequency" and "still has to earn its way
  through remaining stage-graduation requirements at the usual pace" are
  satisfied by non-interference, not new code.** `nextDueDate`/interval
  math (`intervalForStage`) and `consecutivePasses`/`clearsStageFloor`
  read/write exactly the same fields this pass doesn't touch — stated here
  explicitly, per the pass description's own instruction, rather than
  adding code that would just duplicate something already true by
  construction. **Flagged for Pass 61, if that pass reworks Holding's
  floor mechanism**: this claim is only verified against *today's*
  escalating-tempo-floor design; Pass 61 will need to re-check it once
  what Holding's floor means actually changes, rather than assuming it
  still holds.
  **Re-checked (Pass 61): still holds, and is now simpler, not weaker.**
  Pass 61 retired Holding's tempo floor entirely (`clearsStageFloor`'s
  Holding branch always returns `true`), so there's no floor left for
  `isInTempoMaintenance` to interact with at all — the two mechanisms
  (which `k` a step uses, vs. whether a Holding pass counts toward
  interval growth) were already fully independent before this pass and
  remain so after it, with one fewer moving part on the Holding side.
  `intervalForStage` itself is untouched by Pass 61, so review frequency
  is unaffected either way. See the Pass 61 decision immediately below.
- **`Wizard.jsx` follow-up, found in review and fixed the same session, per
  direct request — originally flagged rather than fixed outright, since it
  fell outside this pass's stated Touches list.** `Wizard.jsx`'s
  `defaultPiece()` hardcodes a literal `ladderConfig` (used as-is for a
  brand-new piece — `App.jsx`'s `handleComplete` doesn't run a
  freshly-created piece through `mergeLadderConfig`, exactly the mechanism
  Pass 59 itself already found and fixed once for its own fields, same
  section above). Its `tempoRatchet: { k: 0.3, kCapBpm: 8 }` literal hadn't
  been updated with this pass's two new fields. Traced through rather than
  assumed before fixing: this was **not a crash** the way the Pass 59
  version of this bug was — `targetBPM * undefined` is `NaN`, and any
  comparison against `NaN` is `false`, so `isInTempoMaintenance` simply
  read `false` unconditionally for a brand-new piece, and `maintenanceK`
  (only read inside the `inTempoMaintenance ? ... : ...` branch) was never
  actually dereferenced. The real consequence was narrower: a piece created
  via the Wizard silently couldn't enter tempo maintenance mode for its
  first session, until the app was reloaded once
  (`loadPiecesFromStorage`'s `mergeLadderConfig` backfills the two fields
  into the in-memory piece on every load, whether or not the persisted JSON
  itself was ever re-saved with them). **Fixed**: `tempoRatchet` now reads
  `{ k: 0.3, kCapBpm: 8, tempoAchievedThreshold: 0.85, maintenanceK: 0.05 }`
  in `Wizard.jsx`, the exact same one-line mirror Pass 59 already made once
  for its own fields.
- Verified with `test/ladder.test.mjs` (`Pass 60: tempo maintenance mode`):
  `isInTempoMaintenance`'s true/false boundary at the threshold and with
  missing inputs; flipping back to `false` after a fail, off the same live
  formula with no special-cased exit branch; a pass's step size using
  `maintenanceK` in maintenance mode vs. the chunk's own tracked `k`
  outside it (same starting chunk, only the threshold config differs,
  isolating the substitution as the one variable); the persisted
  `tempoRatchetK` staying exactly what Pass 59's own bookkeeping would
  produce regardless of which `k` the step itself used; and a soft-miss in
  maintenance mode still halving and persisting the real tracked rate while
  the step taken uses `maintenanceK`. Deliberately did **not** add
  `tempoAchievedThreshold`/`maintenanceK` to this test file's shared
  `LADDER_CONFIG` fixture used by every pre-existing test (including every
  Pass 59 test above) — without those two fields the live check
  deterministically reads `false` there (same `NaN`-comparison reasoning as
  the `Wizard.jsx` finding above), so every pre-existing test's behavior is
  provably unaffected; this pass's own tests use a local config override
  instead, the same pattern the file already used for one-off
  `tempoRatchet` overrides (e.g. `smallCapConfig`). `npm test`: 476/476.
- See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#session-outcomes-three-tiers-not-two).

**Decision (built — Pass 61): Holding's escalating tempo floor is retired
outright — meeting the rep requirement is sufficient on its own for a
Holding pass to count toward interval growth — replaced by a periodic
rep-only harder check every 4th review, tracked by a new
`progress[id].holdingReviewCount`.**

- **Why:** requested directly by the user — Holding no longer needs its
  own tempo gate on top of the rep requirement; the harder-to-satisfy
  check moves to reps instead, on a fixed cadence rather than an
  escalating tempo threshold.
- **Precisely what retired, and what didn't:** `clearsStageFloor`'s
  Holding branch (`lib/ladder.js`) now always returns `true` —
  Stabilizing (already no floor) and Settling (flat fraction of
  `targetBPM`) are completely unchanged, both in code and in every
  existing test. This is **not** the same thing as
  `classifySessionOutcome`'s `clearsTempo` check (`bpm >= practiceBPM`,
  deciding whether a session is a pass/soft-miss/fail at all) — that
  function is untouched, confirmed by a new pair of regression tests
  (`test/confidence.test.mjs`) rather than left to be assumed from the
  fact that the file wasn't edited there.
- **The new mechanism:** `progress[id].holdingReviewCount` counts every
  logged Holding review (pass, soft-miss, *or* fail — confirmed explicitly,
  not passes only), via one shared rule,
  `nextHoldingReviewCount(stage, newStage, holdingReviewCount)`
  (`lib/ladder.js`), used identically by all three `computeLadderAdvance`
  outcome branches: `0` on a fresh promotion into Holding, `+1` on any
  review logged while already in Holding, unchanged otherwise. On the
  review where the count-about-to-be-logged is a multiple of 4 (the 4th,
  8th, 12th... since the chunk's most recent fresh entry into Holding),
  `resolveRequiredReps` (`lib/confidence.js`) resolves one more clean rep
  than the baseline; every other review resolves to baseline. Applies on
  top of the existing flat 2-rep run-through override (Pass 27) too, not
  just the difficulty-based table.
- **A real architectural touch-point, not a one-function change — matched
  what the pass description warned it might be.** `resolveRequiredReps`
  gained two new, optional parameters (`stage`, `holdingReviewCount`),
  defaulting to "no bump" when omitted. `ChecklistItem.jsx`'s call site
  needed updating to actually pass them — but turned out to need **no new
  prop threaded in**: `entry` (`piece.progress[chunk.id]`) was already in
  scope there for unrelated reasons, and both new fields live on it. This
  is a discovery worth flagging on its own — the pass description
  hedged "ChecklistItem.jsx, if resolveRequiredReps' call site needs new
  data passed in that it doesn't already have," and it turned out it
  already had everything needed.
- **`computeAutoConfidence`'s own `resolveRequiredReps(chunk)` call
  (`lib/confidence.js`) is deliberately left unchanged, not extended to
  pass `stage`/`holdingReviewCount`.** That function scores *every past
  session* retrospectively for a chunk's confidence percentage; applying
  today's live `holdingReviewCount` backward onto sessions logged before
  the chunk was ever in Holding (or before this pass existed at all) isn't
  what "the required-clean-reps threshold for *that one session*" (the
  pass description's own framing) asked for, and doing so wasn't part of
  this pass's Builds. The optional-parameter design makes this the default
  behavior for any call site that doesn't opt in, rather than something
  that needed a separate carve-out.
- **Migration/storage, following the exact pattern `tempoRatchetK`
  (Pass 59) already established** — three spots in `lib/storage.js`, not
  one, all in scope since the file itself was already in this pass's
  Touches list: `backfillProgressLadderState` (defaults to `0`, same
  "no real history to reconstruct, treat an already-in-Holding chunk as if
  it just arrived" spirit as the entry-BPM fields), `LADDER_STATE_FIELDS`
  (so import-conflict detection considers it), and `mergeProgress`'s
  explicit per-field list (so a re-import actually carries it through per
  `ladderChoice`, rather than silently taking whichever side's raw value
  the `{...e, ...i}` spread happened to land on regardless of the user's
  choice — the exact class of bug `tempoRatchetK` was added there to
  avoid).
- **The three now-unread `ladderConfig.holding.tempoFloorStartFraction`/
  `tempoFloorStepFraction`/`tempoFloorCapFraction` fields are left in the
  schema, not removed, and `LadderConfigEditor` still exposes them,
  correctly labeled, under its "Holding" heading — found in review, not
  fixed, since neither `storage.js`'s config defaults nor
  `LadderConfigEditor.jsx` were in this pass's Touches list for removal.**
  A user can now "tune" a setting that has zero effect, with nothing in
  that UI indicating it's gone inert. Left as a flagged gap rather than
  silently cleaned up or silently left undocumented. See
  [Open questions](#open-questions) below.
- **Two more real gaps found in review, initially left unfixed (outside
  this pass's Touches list), then fixed the same session per direct
  request as an explicit same-session follow-up:**
  1. **`App.jsx` wasn't updated at first, and the feature didn't actually
     work end to end without it.** `handleLogSession`, `handleUnlogSession`
     (restoring from `ladderSnapshot`), and `handleConfirmProvisionalSession`
     all read/write ladder fields through **explicit, hand-maintained
     field lists**, not a wholesale object spread — confirmed by reading
     the code, not assumed, and confirmed to be exactly the same pattern
     that caused Pass 59's own real bug ("`App.jsx` never actually
     threaded `tempoRatchetK` through," found and fixed the same session
     Pass 59 shipped — see above). `holdingReviewCount` was a brand-new
     field on `computeLadderAdvance`'s input/output shape, and none of
     those three lists included it at first: `prevEntry.holdingReviewCount`
     was never read into `computeLadderAdvance`'s input, and
     `advance.holdingReviewCount` was never written back into
     `progress[chunkId]`. **Fixed**: all seven of the same spots
     `tempoRatchetK` already needed (three in `handleLogSession` —
     `ladderSnapshot`, the `computeLadderAdvance` input, the persisted
     output; one optional-restore line in `handleUnlogSession`; the same
     three in `handleConfirmProvisionalSession`) now carry
     `holdingReviewCount` the same way. `test/session-undo.test.mjs` —
     described elsewhere in this doc as the one App.jsx mirror file that's
     "exhaustive across every ladder field," since there's no React render
     harness to test the real closures directly — was updated to match at
     all four of its own mirrored spots, plus three new regression tests
     (logging increments and undo restores the pre-session count; undoing
     a fresh promotion into Holding restores a *leftover* count from an
     earlier Holding stint, not `0`; an older snapshot missing the field
     restores everything else normally, same optional-field convention as
     `tempoRatchetK`). `test/interleave-provisional.test.mjs` and
     `test/interleave-skip.test.mjs` were deliberately **not** extended to
     mirror this field — both were already narrower, partial mirrors
     before this pass (missing the entry-BPM fields and `tempoRatchetK`
     too, not just this new one), and their own tests don't exercise it;
     matching their pre-existing scope rather than making them
     inconsistently more complete than their siblings. Verified live, not
     just via the mirrored tests: seeded a Holding chunk at
     `holdingReviewCount: 3` (so review #4 needs the bump), confirmed the
     UI correctly asked for 5 reps, logged a real session through the
     actual app, and confirmed via `localStorage` that the persisted count
     advanced to `4` — before this fix, the identical steps left it frozen
     at `3` forever, reproduced directly.
  2. **`InterleavePanel.jsx`'s own `resolveRequiredReps(chunk)` call
     (line ~87) also wasn't updated at first, and it performs real
     classification** (feeds `requiredReps` straight into
     `classifySessionOutcome`, same as `ChecklistItem`), not just display.
     `isInterleaveEligible` explicitly includes chunks at
     `stage === "holding"`, so a chunk on its 4th/8th/12th Holding review
     reachable through Interleaved mode was judged against the plain
     baseline there, while the exact same review logged through the
     normal Day-view checklist correctly required one more rep — a real,
     reachable inconsistency between two logging paths for the identical
     review, not a hypothetical. **Fixed**: the call now reads
     `resolveRequiredReps(chunk, entry.stage, entry.holdingReviewCount)`,
     the identical one-line fix `ChecklistItem.jsx` already had — `entry`
     was already in scope there too, so this needed no new prop either.
     Not separately unit-tested (a `.jsx` component, same "no render
     harness" constraint as the rest of this codebase's UI layer) — the
     underlying `resolveRequiredReps` logic this now correctly feeds is
     already exhaustively tested in `test/confidence.test.mjs`.
- **A third real bug, found in a user-requested skeptical second-engineer
  review of this session's diff, and fixed the same session: the migration
  backfill for `holdingReviewCount` defaulted an untouched chunk to the
  literal `0` instead of `null` — the exact same false-positive
  import-conflict bug `tempoRatchetK` already had once (see the Pass 59
  decision above), reintroduced here for a new field by not following that
  precedent.** A piece migrated through `validateAndMigratePiece` (as every
  already-loaded piece is) would carry a real `0` on a chunk that had never
  touched Holding, while a raw backup exported before this field existed
  has no `holdingReviewCount` key at all — `0 !== null` (`undefined` reads
  as `null` in the comparison) registered as genuine ladder-state
  divergence, forcing the import-conflict picker on an otherwise
  byte-identical re-import. **Reproduced directly before fixing**, not
  just inferred from reading the code — a standalone script called the
  real `diffImportedPiece` with exactly this shape and confirmed
  `hasDivergence: true` where it should have been `false`, then confirmed
  the real `validateAndMigratePiece` itself now backfills to `null`.
  **Fixed** at every spot that materializes this field with a fallback:
  `storage.js`'s backfill (`null`, not `0`), and both of `App.jsx`'s
  `ladderSnapshot` capture sites (`handleLogSession`,
  `handleConfirmProvisionalSession`, plus their `test/session-undo.test.mjs`
  mirror) — the same "chunk that's never touched Holding has no count to
  be `0` of" fix, since a materialized `0` written into a session's own
  undo-snapshot would resurface the identical bug via undo instead of via
  migration. **Deliberately unchanged**: `computeLadderAdvance`'s own
  `chunkLadderState.holdingReviewCount || 0` (and `resolveRequiredReps`'s
  matching `(holdingReviewCount || 0) + 1`) — both already treat `null`
  and `0` identically at the one point that actually needs a real number,
  so this fix changes nothing about the real ladder math, only the
  backfilled/snapshotted shape. Covered by three new regression tests in
  `test/storage.test.mjs`, mirroring the exact `tempoRatchetK` pair this
  bug reproduced: the false-conflict case now resolves cleanly, a genuine
  disagreement between two real numbers is still caught, and — the one
  case the fix could plausibly have overcorrected — `0` (a chunk that has
  genuinely entered Holding, zero reviews in) vs. absent (never entered at
  all) is confirmed to still register as real divergence, not swallowed by
  treating every falsy value as equivalent.
- Verified with `test/ladder.test.mjs` (Holding no longer gates on tempo
  regardless of how far `practiceBPM` is from `targetBPM`; a fresh
  promotion into Holding resets `holdingReviewCount` to `0`; all three
  outcomes increment it while already in Holding; an integration test
  chaining five real `computeLadderAdvance` calls and checking
  `resolveRequiredReps` at each step lines up exactly [4, 4, 4, 5, 4]),
  `test/confidence.test.mjs` (`resolveRequiredReps`'s boundary at every
  multiple of 4, backward-compatible omission, the run-through-baseline
  interaction, and `classifySessionOutcome`'s tempo check proven
  unaffected), `test/session-undo.test.mjs` (the three App.jsx-mirror undo
  tests described above), and `test/storage.test.mjs` (the three
  null-vs-zero regression tests described just above). Re-ran the full
  pre-existing test suite rather than assuming — **found, while doing so,
  that no pre-existing automated test actually exercised Holding's old
  escalating floor at all** (the "Tempo floor gating" describe block in
  `test/ladder.test.mjs` covered Settling, Stabilizing, and the
  no-`targetBPM` case, but never Holding specifically) — so this pass's
  own new tests are genuinely new coverage for that mechanism's
  replacement, not a modification of an existing, passing test. `npm
  test`: 497/497.
- See [Algorithms.md](Algorithms.md#holdings-periodic-harder-check-pass-61)
  and [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-ladder-three-stages).

**Decision (built — Pass 62): a live-derived "tempo goal projected N+ days
away" warning, forward-simulating the real ladder math under a neutral
best-case assumption, with a fixed 90-day bar — not compared against
`piece.targetDate` at all.**

- **Why:** requested directly by the user — nothing before this pass could
  answer "at the current pace, is this chunk's tempo goal even realistic
  on any reasonable timeline?" `formatLadderStatus` (Pass 15) shows the
  *next* review date, one step ahead; nothing projected further than that.
- **The simulation reuses `computeLadderAdvance` itself, not a
  reimplementation** — `simulateTempoConvergence` (`lib/ladder.js`) calls
  it in a loop, feeding a synthetic `{ result: "pass", effectiveness:
  "good" }` outcome each time. "Good," not "high": "always passes" is
  already one optimistic assumption; effectiveness "high" would stack a
  second one on top of it for no product reason. Confirmed by a direct
  cross-check test (`test/ladder.test.mjs`): a fixture engineered to
  converge in exactly one simulated step produces a `days` value that
  matches an independent, direct `computeLadderAdvance` call's own
  `nextDueDate` exactly — proof the simulation is driving the real
  function's math, not separate arithmetic that happens to agree.
- **The tempo goal is `tempoAchievedThreshold` × `targetBPM` (Pass 60's
  maintenance-mode bar), not `targetBPM` outright** — confirmed with the
  user rather than assumed. Once `practiceBPM` crosses that threshold, the
  chunk's own step size already drops to the pinned `maintenanceK` rate
  (`isInTempoMaintenance`); demanding a literal 100%-of-target finish line
  in the simulation would mean projecting past the point this module's own
  math already treats the chunk as "there."
- **`MAX_SIMULATION_STEPS` (500) is a real guarantee, not a defensive
  nicety for cases that were always going to converge anyway.** Under the
  current tempo-ratchet math a pass's step size floors at 1 BPM whenever
  there's a real gap left to close, so ordinary chunks converge in well
  under the cap. But `ladderConfig.tempoRatchet.kCapBpm` is user-editable
  (Settings' `LadderConfigEditor`, Pass 17) — set to exactly `0`, it
  collapses the step-size formula's outer clamp to `0` for every step,
  forever, and `practiceBPM` can never move again. Reproduced directly in
  `test/ladder.test.mjs` (a `kCapBpm: 0` fixture runs the full cap and
  returns `converged: false` promptly, not a hang) — this is the scenario
  the cap exists for, not a hypothetical.
- **The 90-day warning bar (`TEMPO_CONVERGENCE_WARNING_DAYS`) is fixed,
  the same for every piece regardless of `scheduleMode`** — explicitly
  requested this way, not derived from `piece.targetDate`,
  `piece.daysToLearn`, or any other piece-specific value.
  `simulateTempoConvergence` doesn't take a `piece` argument at all and
  never reads a scheduling field, so there's no days-mode/minutes-mode
  branch anywhere in it — verified directly with a test that runs the same
  chunk ladder state through two fixtures standing in for a days-mode piece
  (`targetDate` set, no `minutesPerDay`) and a minutes-mode piece
  (`daysToLearn`/`minutesPerDay` set, no `targetDate`) and asserts
  byte-identical (`deepEqual`) output.
- **Live-derived, not persisted — no "warned" flag.** Same pattern
  `hasClimbingTempo` (Pass 30) and `isPieceLearned` (Pass 39) already use:
  `PieceMapTab`'s chunk-detail modal recomputes the simulation fresh on
  every render from whatever's currently in `piece.progress[id]` /
  `piece.ladderConfig`, starting from `todayISODate()`. Verified live in
  the browser, not just by reasoning about the code: a chunk seeded at
  practiceBPM 20 / target 200 in Holding read "266+ days away — over 3
  months at this pace" in the modal; logging one more real full-pass
  session on that same chunk (no page reload) updated it to "252+ days
  away" on the very next render.
- **Placement: `PieceMapTab`'s chunk-detail modal**, in the same
  `detail-stats` block Pass 15 already surfaces Stage/Next review in — the
  pass description's own suggested location, confirmed rather than
  second-guessed since nothing about the investigation surfaced a reason
  to prefer somewhere else. Renders as a "Tempo goal" row using the same
  `--brick` warning color `needsRelearning`'s hint already uses, but only
  when `tempoConvergenceExceedsWarning` is true — unlike Stage/Next review,
  which always show, this row is a warning, not a permanent stat, so it
  disappears entirely once the projection is a non-issue (not applicable,
  or under the bar).
- **Explicitly deferred, not decided:** any comparison against
  `piece.targetDate` (a days-mode-relative version of this warning) —
  the pass description was explicit that the fixed 90-day bar is the whole
  mechanism, not a placeholder for a deadline-aware one. Whether a
  deadline-relative version would also be useful (e.g. "this chunk's
  tempo goal is projected past your target date," distinct from "this
  chunk's tempo goal is projected to take a long time regardless") is an
  open product question, not ruled out — just genuinely out of scope for
  this pass.
- Verified with `test/ladder.test.mjs` (`Pass 62: simulateTempoConvergence`):
  the direct cross-check against `computeLadderAdvance` described above;
  both the convergent and non-convergent (`kCapBpm: 0`) cases terminate
  within `MAX_SIMULATION_STEPS`; a fixture under 90 days shows no warning
  and one over 90 days does; hitting the cap always counts as exceeding
  the warning bar; the days-mode/minutes-mode `deepEqual` cross-check; and
  the three "not applicable" cases (no `targetBPM`, no `practiceBPM` yet,
  already at/above goal). `npm test`: 507/507.
- See [Algorithms.md](Algorithms.md#tempo-convergence-simulation-pass-62).

## UX

**Decision: Piece Map chunk detail opens as a real modal, not inline below
the grid.**

- **Why:** The inline version put detail below the fold, making it
  effectively invisible without scrolling — a real usability bug, not a
  style preference.
- See [UX-Principles.md](UX-Principles.md#detail-on-demand-uses-a-real-modal-not-inline-expansion).

**Decision (Pass 37): the chunk-detail modal's card redesign (stats
collapsed into a bottom "Chunk Info" section, Target BPM shown as a
read-only setup value instead of an always-open input, "Set manually" and
the "Confidence override" heading/auto-calculated note removed) is scoped
to `sequentialMode` only — i.e. revival's reassessment pass. Ordinary
(non-revival) Piece Map editing keeps the modal's original layout,
unchanged.**

- **The scoping question:** `PieceMapTab` (`components/tabs/PieceMapTab.jsx`)
  is one shared component rendering this modal in two places — the
  ordinary Piece Map tab, and embedded (with `sequentialMode`) inside
  `RevivalTab`'s reassessment pass. Pass 37's brief asked for the redesign
  without settling whether it should land in both call sites or just one.
- **Why sequentialMode only, not both:** the brief justifies removing "Set
  manually" as "redundant with the 5-tier quick-rate system directly above
  it" — but Quick rate (`CONFIDENCE_PRESETS`, a `sequentialMode`-gated
  block) has never rendered outside `sequentialMode`. Removing "Set
  manually" everywhere would have deleted the *only* way to move a chunk
  from auto-calculated confidence into a manual override in ordinary Piece
  Map, with nothing there to replace it — a real functional loss, not a
  redundant control. That alone settles the question: the redesign
  (all of it, not just the confidence-override piece, since presenting the
  two call sites inconsistently would be its own confusion) is gated to
  `sequentialMode`.
- **One shared dependency needed a narrow exception:** the "remove the word
  'optional' next to the notes field" part of the brief lives in
  `MemoryAnchorField.jsx`'s hardcoded label, a component also used by
  `ChecklistItem`/`DayChecklist` (ordinary practice logging), which Pass 37
  wasn't scoped to touch. Rather than duplicate the field just to vary one
  word, `MemoryAnchorField` gained an `optional` prop (default `true`,
  preserving "Notes — optional" everywhere it isn't passed); `PieceMapTab`
  passes `optional={!sequentialMode}`. This is a one-line, backward-compatible
  addition to a file outside Pass 37's stated Touches list — flagged here
  rather than silently folded in.
- **What's actually new, sequentialMode only:** the existing stats block
  (difficulty/confidence/sessions/stage/etc.) moves from the top of the
  card into a collapsed `<details className="chunk-info">Chunk Info`
  section at the bottom; Target BPM defaults to a read-only line ("N BPM —
  set at piece setup") with a "Change for this chunk" button that reveals
  the input, rather than an always-open `NumberInput` (state resets on
  every chunk switch, so Next/Previous doesn't leave the editor open on the
  next chunk); a `tip-line` note next to Current BPM clarifies it means the
  fastest tempo playable *accurately right now*, not the eventual goal;
  "Set manually" and the "Confidence override" heading/auto-calculated-%
  note are gone (the manual-value `NumberInput` + "Reset to automatic"
  still render, unlabeled, whenever a chunk already has a manual value from
  Quick rate). See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#revival-built-mvp).

**Decision: the practice-log checkbox submits the log directly, not just a
"done" toggle.**

- **Why:** Users kept reaching for the checkbox out of habit expecting it to
  log the session; the "Log practice" button was a second, easily-missed
  step. Made the checkbox do what users already expected instead of
  correcting the habit.

**Decision: Reassess-difficulty's Apply both commits and closes the panel in
one action.**

- **Why:** It used to be two separate steps, which read as an unfinished
  flow rather than a deliberate one.

**Decision: clean-reps target widened to 3–5 depending on difficulty (from a
flat 2–4).**

- **Why:** Better matched to per-difficulty repetition needs rather than one
  range for every chunk regardless of difficulty.

**Decision: removed the "quick counts" alternative UI from both
`DifficultyEditor` (a total easy/medium/hard count, randomly scattered
across the piece) and `RecurringEditor` (a bare count of recurring
measures, `recurringMode: "basic"`) — the measure-precise grid / mapped-pairs
UI is now the only option in the wizard and Settings.**

- **Why:** Difficulty and recurring material are never actually evenly or
  randomly distributed across a real piece — the quick-count modes existed
  as a faster-entry shortcut, but the randomized/approximate placement they
  produced didn't reflect anything true about the piece, undermining the
  whole point of difficulty-aware and recurring-aware scheduling.
- **Backward compatibility:** `piece.diffMode` and `recurringMode: "basic"`
  / `recurringMeasures` remain in the data model and `generatePracticeChunks`
  still honors them — this only removed the UI to *choose* those modes going
  forward, so pieces already saved with them keep working unchanged. See
  [Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about).

**Decision (Pass 20): the Analytics tab is gone. Its two panels now live in
Progress, in this exact order — "Confidence by difficulty" immediately after
"Outcome breakdown," then "Recurring material payoff," then "Recent practice
history" last as before.**

This pins down the placement that was previously agreed only as "near
effectiveness calibration, somewhere unobtrusive" (the panel since renamed
"Outcome breakdown" — see [Spaced repetition & maintenance](#spaced-repetition--maintenance)
above). Progress's full panel order is now:

1. Headline stat cards (consistency count, most improved)
2. Consistency heatmap
3. Actual vs. planned progress
4. Projected finish
5. Tempo trend
6. Outcome breakdown
7. **Confidence by difficulty** ← folded in
8. ~~Recurring material payoff~~ ← folded in, **removed again in Pass 32b**
   (see below) — item 9 now follows item 7 directly
9. Recent practice history

- **Why here:** "Confidence by difficulty" renders the same horizontal
  distribution bars (`analytics-bars`) as "Outcome breakdown" — putting them
  adjacent makes the page read as one group of "how is the work distributed"
  charts, after the group of time-based trend charts (2–5) and before the raw
  log (9). It also satisfies "unobtrusive" literally: both folded-in panels
  are below the fold, after everything that answers *am I on track*.
- **Why "Recurring material payoff" goes second of the pair:** it's a single
  standing sentence about the plan, with no per-day or per-chunk dimension —
  not a trend and not a distribution. Placing it after the charts keeps it
  from splitting them, and keeps the raw practice log at the bottom of the
  page where it belongs.
- **Deliberately not done:** the metrics themselves were not redesigned.
  This was pure relocation — same computations, same copy, same markup, only
  the `<h1>Analytics</h1>` tab header dropped (Progress already has one).
  Whether either panel is measuring the right thing is a separate question,
  untouched here.
- **Consequence:** `AnalyticsTab.jsx` is deleted and the `analytics` entry is
  out of `NAV_BASE` (`src/App.jsx`). The `.analytics-*` CSS classes stay —
  they were always shared with Progress's outcome bars and are not
  Analytics-specific despite the name.

**Decision (Pass 32b, supersedes part of Pass 20 above): the "Recurring
material payoff" panel is removed from Progress outright, not just
relocated again.**

- **What went:** the panel itself, and the four variables that only fed it
  (`recurringChunks`, `fullEffort`, `actualEffort`, `minutesSaved` in
  `ProgressTab.jsx`), plus the now-unused `EFFORT_TO_MIN` import that only
  those variables consumed.
- **What stayed:** recurring material's actual effect on scheduling —
  the reduced effort cost baked into `lib/chunking.js` — is completely
  untouched. This was a display-only removal; recurring chunks still cost
  less scheduling effort, the app just no longer shows a sentence saying
  so on Progress. "Confidence by difficulty" (the other Pass 20 fold-in)
  stays exactly where Pass 20 put it, now followed directly by "Recent
  practice history."
- **Why not addressed here:** no rationale was recorded for *why* the
  panel was removed (the pass instructions specified the removal directly,
  without discussion) — if that reasoning matters later, it isn't captured
  in this doc.
- **Consequence:** the numbered panel-order list above is stale as written
  for item 8 — left in place with a strikethrough rather than renumbered,
  since renumbering would make a past decision read as if it always
  matched today's page, which it didn't.

**Decision (Pass 20): an unresolvable id in "Recent practice history" is
handled by *category*, not by a blanket null check — and section
run-throughs are a valid category, not a failure.**

Found while verifying the fold-in above: Progress crashed outright on a real
piece. `ProgressTab` did `chunkById[id].start` with no guard, so an
unresolvable id threw and React unmounted the **whole tab** — every panel,
not just the offending row.

- **Why it mattered more than it looked:** the trigger wasn't corrupt data.
  `sr_<sectionId>` run-through ids are written into `piece.progress` by
  normal logging but are deliberately excluded from `generateAllChunks`'s
  `all` array, so they are *never* resolvable through the chunk set on any
  piece. **Every user who ever ticked off a section run-through had a dead
  Progress tab.** Confirmed pre-existing by reverting `ProgressTab.jsx` to
  its committed version and reproducing the identical crash.
- **The rejected first fix:** guard the lookup and label everything
  unresolvable as stale. This *worked* and *stopped the crash*, but was
  wrong — it silently relabels a real, current run-through as a leftover
  from an old plan. Caught only by checking the rendered output against
  known data rather than trusting "no longer crashes" as success. **A guard
  that stops an exception is not automatically a correct fix.**
- **What shipped instead:** four ordered cases —
  `__consolidation__`, live chunk, `sr_` resolved off `piece.sections`, then
  genuinely stale. Full rules in
  [Algorithms.md](Algorithms.md#practice-history-labels).
- **Stale entries keep their day but never get invented measures.** The
  practice really happened, so erasing the row would be a lie; naming
  measures we can't derive would be a bigger one. They collapse into one
  "N passages from an earlier version of this plan" note rather than
  repeating per id.
- **No `console.warn` on either unresolvable path.** Both are expected
  states — unlike the malformed ladder snapshots in `App.jsx`, which do warn
  because they indicate something genuinely wrong.

**Decision (Pass 20): the history logic moved into `lib/history.js` and got
22 tests, at the user's explicit request, after the fix was already
working.**

- **Why:** the fix was verified only by hand in a browser, because the test
  suite is lib-level and there is no harness for rendering components —
  so nothing would have caught a re-break. Rather than build a component
  test setup, the logic moved to where testability already exists.
  `computePracticeHistory(piece, chunks, limit)` returns
  `[{ day, label, unresolvedCount }]`; `unresolvedCount` is exposed
  specifically so tests can assert behavior without pinning display copy.
- **The tests were verified to be capable of failing.** Both bugs were
  deliberately re-introduced and the suite re-run: the unguarded lookup
  produced 8 failures (exactly the run-through and stale-id tests), and
  forcing section lookups to fail produced 3 (exactly the naming tests).
  A test that passes without being able to fail proves nothing — this check
  is worth repeating whenever a regression test is added here.
- **Consequence / precedent:** this is the standing answer to "component
  logic can't be tested." Move it to `lib/`. `npm test`: 256 → 278.

**Decision (Pass 22): the week view is navigation-only — no logging happens
from it, in either mode.**

A third view mode ("Week", between "Day view" and "View all" in
`TodayTab`) showing 7 days as cards, current day ringed, each card a link
into that day's own view. `components/tabs/today/WeekView.jsx`.

- **Why read-only, decided at the start of the pass rather than after
  building it:** two reasons, and the second is the one that settles it.
  A logging row needs clean reps, BPM, a timer and the suggested-tempo
  line — more than a 7-across grid can hold without becoming the day view
  again. More importantly, **a session logged from a cell that isn't today
  would be keyed to the wrong day**, and the maintenance ladder reads those
  day numbers to decide when a chunk next comes due. A grid invites
  clicking any cell, so inline logging there is an invitation to write
  ladder-corrupting data. The day view stays the single place work is
  recorded.
- **The window slides rather than paging fixed weeks:** it centres on the
  current day (day 7 of 21 shows days 4–10) and clamps at both ends, so
  the current day is always visible and the window is always a full 7 days
  when the plan has them. A plan shorter than 7 days shows all of itself.
  Deliberately different from `TimelineTab`, which pages *fixed* week
  blocks (days 1–7, 8–14) because it's showing the whole plan, not
  answering "what's around me now".
- **The highlighted cell is labelled "Today" or "Viewing"**, matching the
  tab header's existing `(viewing)` suffix — the current day can be a
  browsed day, and the two must not look alike.
- **Known duplication, accepted rather than fixed:** the card body — the
  New/Focus/Review groups with merged ranges — is now written twice, here
  and in `TimelineTab`. Not extracted to a shared card, because
  `TimelineTab` was outside the pass's scope and the two cards have
  genuinely different heads (plan-day + calendar date + highlight vs. plan
  day alone). **Anything changing day-card presentation must now change
  both files.** Extract if a third caller ever appears.
- **No CSS was added** — `.week-grid` and `.day-card` already existed for
  `TimelineTab`, so this reuses them; the current-day ring is an inline
  style. If that highlight is wanted elsewhere it should become a real
  class in `App.jsx`'s stylesheet rather than a third inline copy.

**Decision (Pass 22): in maintenance mode the week shows only today, and
says so — it does not leave the days ahead looking empty.**

Past the end of a bounded plan there are no plan days left, so the week
view falls back to 7 calendar days around today. Only today's cell can
carry content (the live due list); the days ahead read "Not due yet" and
the panel states plainly that maintenance reviews come due one day at a
time.

- **Why it can't do better:** `computeDueReviews` answers "what is due as
  of this date" and nothing answers "what will be due on Thursday" — a
  forward-looking window is explicitly scoped out (see
  [Spaced repetition & maintenance](#spaced-repetition--maintenance),
  "Scoped out"). This is a design boundary, not an unfinished cell.
- **Why not just leave them blank:** a blank cell reads as "nothing due
  Thursday," which is a promise this data cannot make — the honest state is
  "not known yet." Same principle as the rest of the app: don't imply
  information the model doesn't have. See the open question below on
  whether that boundary should move.

**Decision (Pass 23): learning-phase logging (`ChecklistItem`) gets an
inline, editable free-text note per chunk, reusing `piece.memoryAnchors`
rather than a new field — and the field's visible label changes from
"Memory anchor" to "Notes" everywhere it appears.**

- **No new data shape.** `piece.memoryAnchors` was already a flat
  `{ [id]: string }` map keyed by chunk/transition/section id, editable
  only from the Piece Map modal and previously shown only during revival.
  Confirmed against the actual code before writing anything new against
  it (the pass's own first instruction) rather than trusting
  Data-Model.md's existing description at face value. `lib/storage.js` is
  untouched by this pass — nothing about the shape needed to change.
- **The read became universal; the edit control did not.** `ChecklistItem`
  now reads a chunk's note straight off `piece.memoryAnchors` unconditionally,
  instead of requiring an explicit `memoryAnchor` prop from each caller.
  Editing is offered only where a write handler (`onSetMemoryAnchor`) is
  actually passed in — currently only `DayChecklist`, i.e. ordinary
  learning-phase logging. **Side effect worth knowing:** because the read
  is unconditional, notes now also surface (read-only) in the maintenance
  due-review panel, which never showed them before. Not deliberately
  scoped in — a consequence of reading straight off the piece rather than
  threading a second prop through every caller. Harmless, but a change in
  where this data is visible.
- **"Notes," not "Memory anchor," in the UI — component/prop names
  unchanged.** The data was never actually revival-specific (durable
  per-chunk metadata, read during ordinary practice too per
  Data-Model.md), but the old label described one *use* of the field (a
  mnemonic recall hook) rather than the field itself, discouraging the
  ordinary "watch this" observations that come up while learning. Renaming
  the component/prop (`MemoryAnchorField`, `memoryAnchor`,
  `onSetMemoryAnchor`) was deliberately left alone — that would touch every
  call site for a cosmetic win, not the persisted key itself, so there's
  no data-migration reason to do it now.
- **Known, pre-existing quirk this pass extends rather than introduces:**
  `ChecklistItem` is keyed by chunk id + role, not remounted on plan-day
  navigation, so if the same chunk+role reappears the next day, React
  reuses the component instance and the note editor's open/closed state
  can carry over, showing stale unsaved text. Reps/BPM/timer inputs
  already had this; the note editor is one more piece of state riding the
  same pre-existing pattern, not a new one.

**Decision (Pass 32a): the sidebar piece switcher sorts by a new persisted
`piece.sortOrder`, not `createdAt`, and is user-reorderable.**

- **Reorder UI moves whole switcher rows, not individual pieces within a
  work.** A row is either a standalone piece or an entire multi-movement
  work; up/down controls swap two adjacent rows and re-rank every piece to
  a fresh `0..n-1` sequence. Movement order *within* a work is untouched —
  still `createdAt`-driven via `groupPiecesByWork`/`partsOfWork`
  (`lib/works.js`) — confirmed before building anything special-cased for
  it that a work's movements already stay visually contiguous "for free":
  `groupPiecesByWork` groups on the position of a work's first-encountered
  movement in the sorted list, regardless of that movement's own
  `sortOrder`, so no work-specific reorder logic was needed at all.
- **Migration defaults `sortOrder` to the piece's own `createdAt`** rather
  than a freshly-computed cross-piece rank — since every already-loaded
  piece gets the same treatment, sorting by `sortOrder` reproduces exactly
  the `createdAt` order those pieces already had, so nothing reshuffles on
  first load after this shipped.
- **Import gets its own explicit order choice, not the usual
  most-recently-updated rule.** Every other scalar field on a matched
  piece resolves import conflicts by comparing `updatedAt` (see
  `mergeImportedPiece` above) — right for practice data, wrong for display
  arrangement. An unstale re-import (e.g. syncing a backup from a second
  device right after manually reordering here) must never silently
  reshuffle the switcher just because its timestamp happens to be newer.
  `sortOrder` was pulled out of that generic recency rule into its own
  per-import "keep what's here" / "use the imported order" pick in
  `ImportPiecesModal`, applied uniformly to every matched piece in that
  import (a single choice, not per-piece — order is a whole-list
  arrangement, no meaningful per-row "divergence" the way ladder state
  has one). Defaults to "existing" so an import never moves anything
  unless asked.
- **Found and fixed on critical review, not during the original build:**
  the reorder handler's `updatePiece` calls originally built the updated
  piece from a variable captured at render time instead of from the
  `current` value React hands the updater function — every other call
  site in `App.jsx` uses the live value. Not reachable as a live bug given
  this app's synchronous, single-tab architecture, but inconsistent with
  the established pattern and a landmine if that ever changes; fixed to
  match convention.
- **Deliberately deferred, flagged rather than folded in:** cross-work
  reordering semantics beyond what's obviously already free (this pass
  confirmed contiguity is free; it did not investigate whether more
  elaborate cross-work ordering rules are needed).

**Decision (user-directed): a chunk's first-encounter card states no BPM at
all — not the piece's target tempo, not a suggested starting tempo — next
to its reps requirement. Only reps are stated as a requirement there.**

- **Trigger:** two issues surfaced back-to-back in the same conversation.
  First, `getSuggestedStartingBPM`'s diminishing-returns curve (see
  [Algorithms.md](Algorithms.md#starting-suggested-and-demonstrated-tempo))
  was only calibrated at targets >= 100 BPM and could recommend a tempo
  *above* a low target (65 BPM target → 67 BPM "suggestion") — fixed with
  `MIN_STARTING_TEMPO_BUFFER` (15 BPM, `lib/confidence.js`), clamping the
  suggestion to `min(raw curve, target - 15)`. Second, once that was fixed,
  the user pointed out the deeper issue: `ChecklistItem` was showing
  "Target tempo: 65 BPM" and "Suggested starting tempo: 50 BPM" as prose
  lines sitting right next to "Need 3 clean reps to progress this chunk" —
  reading as a tempo requirement on the very first attempt, even though
  `requirementText` already correctly states a reps-only requirement then
  (`practiceBPM == null`), and `classifySessionOutcome` treats a null
  `practiceBPM` as already-cleared, so no tempo is actually enforced yet.
  The suggestion undermines its own disclaimer ("slower is fine") by being
  stated as a specific number in the same breath as a stated requirement.
- **Fix, scoped precisely to first encounter.** Both lines in
  `ChecklistItem` (`src/components/tabs/today/ChecklistItem.jsx`) are now
  gated on `!isFirstEncounter` — the same flag (`practiceBPM == null &&
  entry.sessions.length === 0`) already used elsewhere in this component,
  not a new concept. Once a real session is logged (or, for the Target
  tempo line, even after just a skipped/provisional Interleaved-mode
  entry — `isFirstEncounter` is `false` the moment `sessions.length > 0`,
  stricter than the old `practiceBPM == null` check that line alone used),
  both lines can show again exactly as before.
- **The "BPM achieved" input's placeholder deliberately keeps showing
  `suggestedStartingBPM`.** Ghost text in an empty input is a different UX
  register from an assertive sentence — it doesn't read as a stated rule,
  and removing it entirely would leave a first-time learner with zero
  starting-point guidance. Only the prose lines were removed.
- **`getSuggestedStartingBPM`'s return value is untouched and still fully
  wired through** — `handleLogSession`'s persisted `suggestedStartingBPM`,
  `needsRelearning`'s rule 4, and the placeholder above all still consume
  it; only its *first-encounter visible sentence* is gone. `InterleavePanel`
  needed no change: by construction (chunks there have already graduated
  past Stabilizing) `isFirstEncounter` is never true in that surface, and
  it never rendered either line to begin with.

**Decision (Pass 43): Overview gets a one-click "Continue learning"
shortcut into Today's Practice, under the title card — hidden during an
active revival, relabeled "Continue maintenance" once the plan is actually
finished.**

- **Why:** Overview previously had no way to jump into practice itself,
  only into Revival (via "Start/Continue revival") or via the sidebar's
  own "Today's Practice" nav item.
- **Destination, not a new navigation concept:** the button calls the
  existing `onSelectDay(null)` — the same "reset to real-time" sentinel
  `onJumpToday` already uses — instead of a new handler, so it lands
  exactly where the sidebar's own nav item would, including resetting any
  stale day the app happened to be showing.
- **Hidden, not relabeled, during revival:** "Start/Continue revival" is
  already the primary action for that state in the same area; showing
  both would be two competing primary buttons at once.
- **Relabel, not hide, once the plan is actually finished
  (`isPlanActuallyComplete`, Pass 39):** the destination (Today's Practice)
  is still meaningful in maintenance — `computeDueReviews` still surfaces
  content there — so hiding the shortcut would remove something still
  useful. "Continue maintenance" reuses Master Agenda's existing
  Learning/Maintenance/Revival vocabulary rather than inventing new terms.

**Decision (Pass 45): Overview's "first week" list now shows which past
days were actually completed, via a new shared
`classifyDayCompletion(day, piece, currentDay)` (`lib/scheduling.js`) —
written standalone so the Timeline tab can reuse it instead of duplicating
the logic.**

- **What it returns:** `"future"` (day ≥ currentDay), `"done"` (every chunk
  the day scheduled has that exact day in its own `doneDays`), `"behind"`
  (something scheduled, not all done), or `"empty"` (nothing scheduled at
  all — a rest day, or any other empty day). A past day is grayed whether
  `"done"`, `"behind"`, or `"empty"`; only `"done"` gets struck through.
- **`"empty"` is deliberately its own state, not folded into `"done"`.**
  Grayed-but-not-struck reads as "nothing to do here"; struck-through
  "Nothing scheduled" read as claiming work was completed that never
  existed. It was actually built the first way (empty collapsed into
  `"done"`) and corrected to a separate `"empty"` state once the
  struck-through "Nothing scheduled" row was pointed out — not designed
  right from the start.
- **Today's row gets a "(behind N chunks)" note** when
  `computeScheduleStatus`'s existing `missedCount` is nonzero — reused
  directly, not recomputed, per
  [AI-GUIDELINES.md](AI-GUIDELINES.md#prefer-extending-existing-systems-over-creating-parallel-systems).
- **Known gap, not fixed:** a consolidation day's `reviewChunkIds` lists
  every practice chunk, but logging that day's run-through
  (`handleLogRunThrough`, `App.jsx`) only ever writes the synthetic
  `"__consolidation__"` progress entry, never each individual chunk's own
  `doneDays` — so a logged consolidation day still reads `"behind"` here.
  See [Algorithms.md](Algorithms.md#behind-schedule-detection). **Since
  Pass 46**, the Timeline tab reuses this same `classifyDayCompletion` call
  for its own past-day graying/check mark, so this gap now reads the same
  way on a third surface, not just Overview's first-week list. **Since
  Pass 67, more likely to actually surface to a learner, not just a fourth
  surface:** Today's Practice's catch-up-button scan (`findEarliestBehindDay`)
  now runs unconditionally instead of behind a practice-chunk-only
  pre-check (`hasBehindWork`, removed). That old pre-check accidentally
  masked this exact gap whenever every practice chunk was otherwise done —
  the button simply never showed. With the pre-check gone, a piece that's
  fully caught up except for this consolidation-day quirk can now show
  "Go to Day N" and send the learner to a day they already logged. Not
  destructive (no data is touched, and the day's own content still shows
  it was done) — just a more visible instance of a gap that was already
  here, found during Pass 67's own review rather than newly introduced by
  it.
- **Known gap, not fixed: not revival-aware.** A piece that's both
  mid-revival and behind on its *original* (pre-revival) schedule still
  shows the "(behind N chunks)" note and first-week graying against that
  original plan, not the revival plan the learner is actually following.
  Not a new inconsistency on its own — `ScheduleBanner` already shows "N
  chunks behind schedule" during revival today — but it's a second surface
  carrying the same one. **Since Pass 46, make that three surfaces**: the
  Timeline tab's own past-day graying/check mark reuses the same
  `classifyDayCompletion` call, with the same lack of revival-awareness.
  See [Open questions](#open-questions).

**Decision (Pass 46): the Timeline tab gets completion states and its own
reschedule entry point — a direct application of Pass 45's shared
classifier plus one new entry point, nothing more.**

- **Completion states:** every day card runs `classifyDayCompletion(d,
  piece, currentDay)`. A non-`"future"` day gets a `day-past` class
  (opacity 0.55, matching the weight Overview already uses); a `"done"` day
  additionally gets a small, muted `Check` icon next to its day number —
  not a strikethrough, since a card grid reads differently than Pass 45's
  text list even though the classification itself is identical, reused
  rather than duplicated.
- **Reschedule entry point:** Timeline had none before this. Rather than
  build a second button/modal pairing, it renders the same `ScheduleBanner`
  component Overview and Today already do, passed the same
  `piece`/`chunkSet`/`timeline`/`currentDay`/`onReschedule` props.
- **Verified:** manually in the browser — a piece rescheduled behind
  schedule showed matching gray/check states across every past day, and
  the reschedule banner appeared and worked identically to Overview's.
  `npm test`: 411/411.
- See [Algorithms.md](Algorithms.md#behind-schedule-detection).

**Decision (Pass 47): Today's Practice gets a "Go to Day N" catch-up
button — an alternative to Reschedule, not a replacement — folded into the
same `ScheduleBanner`, not a second banner.**

- **Why:** the point is to always have a way to get to the last incomplete
  task, regardless of whether the learner wants to actually rebalance the
  plan or just go finish what's sitting there. Rescheduling changes the
  plan itself; this just moves the learner to old, still-valid work.
- **Visibility (original gate, superseded by Pass 67 below):** shows
  whenever `computeScheduleStatus`'s `remainingChunkIds` is non-empty and
  at least one of those chunks was introduced on a day before today —
  **deliberately fires even when today's own checklist also has
  incomplete items**, not only when today's checklist is empty. Raised
  directly by the user after the first version read a stricter, "only when
  today is otherwise done" condition from the pass prose; corrected on the
  spot ("it should definitely show up if there are incomplete tasks"). The
  "fires even with other incomplete items" intent survives Pass 67's
  change intact — only the practice-chunk-only scope of the pre-check was
  the problem, and that check is gone outright, not narrowed.
- **Target-finding:** scans `timeline.days` from day 1 forward, using
  `classifyDayCompletion` (Pass 45) to find the first `"behind"` day,
  reusing the same definition of "incomplete" every other completion
  surface already uses rather than inventing a second one.
- **Merged into `ScheduleBanner`, not a second banner:** built as its own
  standalone banner first, directly below `ScheduleBanner`; on request,
  folded into the same banner instead once both existed side by side and
  visibly stacked. `ScheduleBanner` (`components/ScheduleBanner.jsx`) took
  two new optional props, `earliestBehindDay`/`onDayChange` — Overview and
  Timeline don't pass them and render exactly as before; Today's Practice
  passes both, gets a second button and different copy ("Life happens.
  Rebalance incomplete tasks across your remaining plan days, or pick up
  where you left off.") in the same banner. Placed above the first task
  card, not below the checklist, per explicit request — the point is to be
  seen without scrolling past everything else first.
- **Verified:** manually in the browser, both before and after the merge —
  button appears/hides correctly, jumps to the correct day, and Overview/
  Timeline's banner is provably unchanged (same copy, same single button).
  `npm test`: 411/411 throughout.
- **A real bug found here, fixed in the Pass 48 entry below:** the day
  search above has no idea a day it finds might later be collapsed by Pass
  48's fix — see that entry.
- See [Algorithms.md](Algorithms.md#behind-schedule-detection).

**Decision (Pass 48): a day whose entire original task list was swept
into a reschedule collapses to a plain "Tasks rescheduled" line — Timeline
and Today's Practice (single-day view and "View all") alike — instead of
re-showing content that's since moved elsewhere.**

- **Why:** `getEffectiveTimeline` only replaces days from the reschedule's
  `asOfDay` onward; an untouched day further back keeps its exact
  pre-reschedule `newChunkIds`/`specialChunkIds`/`reviewChunkIds`, which is
  now a stale duplicate of wherever that same content actually got moved.
- **Only collapses when EVERY original item moved.** A day with any mix of
  done, still-legitimately-scheduled, and moved items renders completely
  normally — no per-item filtering within a day, by design (a mixed day
  can still show a moved item's stale chip alongside its real, current
  placement elsewhere; accepted as the trade-off for keeping this a
  whole-day decision, not a per-task one).
- **No destination reference on the collapsed line** ("Tasks rescheduled,"
  never "moved to day N") and **no special-casing for more than one
  reschedule** — re-evaluated against whatever `piece.rescheduleMarker`
  currently holds on every render, same as everything else here.
- **A day's list routinely contains a transition or combo id, which is
  never itself in `rescheduleMarker.remainingChunkOrder`** (that list —
  built by `computeScheduleStatus` — only ever tracks *practice*-chunk
  ids), even when the transition/combo genuinely rode along with an
  untouched neighbor into the rescheduled remainder. A day-1-style day
  with zero specials is the only case a bare "is this id in
  `remainingChunkOrder`" check would ever collapse correctly — nearly
  every day past the first has at least one transition, since a
  transition is always introduced the day right after both its flanking
  chunks. Confirmed by direct calculation before deciding the scope:
  literal list-membership alone would have satisfied this pass's own
  "several fully-untouched past days" verification criterion for exactly
  one day. Fixed by recognizing a transition/combo as "moved" whenever its
  linked practice chunk(s) are in `remainingChunkOrder` — mirroring
  `getEffectiveTimeline`'s own relocation filter (including combos'
  asymmetric "only `linkedIds[0]`" rule) rather than inventing a new
  definition of "moved."
- **Verified TodayTab's single-day view can reach a fully-swept day** —
  the pass's own description flagged this as something to check, not
  assume ("it shouldn't, day nav should skip past it"). It can: Previous/
  Next-day are plain ±1 steps with no skip logic at all, confirmed by
  navigating there directly. Not an extra bug to fix — `DayChecklist.jsx`
  is the same component behind both View all and the single-day view, so
  the one collapse check already covers this reachable path.
- **A real bug found and fixed in the same session:** the Pass 47 catch-up
  button's day search had no idea a day it found could since be collapsed
  by this — it kept finding the earliest *original* behind day (reliably
  day 1, once any reschedule has happened) and sending the learner to a
  screen with nothing on it. Confirmed live: after a reschedule and enough
  simulated time passing, the button read "Go to Day 1" and led to a bare
  "Tasks rescheduled" line. Fixed by giving that search the same
  `isMovedId`/`isFullySwept` check and having it skip a day the check
  applies to, continuing to scan forward — confirmed live again afterward:
  the button correctly read "Go to Day 3" (the actual earliest day with
  real incomplete content) and led there.
- **Verified:** built a piece with a mixed day (one done chunk, two moved
  ones) alongside several fully-swept days, rescheduled it, and confirmed
  in the browser on both Timeline and Today's Practice: fully-swept days
  read "Tasks rescheduled," the mixed day still rendered its full real
  checklist, and the moved chunks correctly appeared on their new day.
  `npm test`: 412/412 (see the getEffectiveTimeline entry above for the
  regression test).
- See [Algorithms.md](Algorithms.md#rescheduling) and
  [Algorithms.md](Algorithms.md#behind-schedule-detection).

**Decision (Pass 67): the Pass 47 catch-up button's `hasBehindWork`
pre-check is removed — `findEarliestBehindDay`'s own scan is now the sole
source of truth for both whether the button shows and which day it
targets.**

- **Why:** the Pass 47 entry above's "Visibility" bullet describes the
  original gate — `computeScheduleStatus`'s `remainingChunkIds` non-empty
  and at least one of those chunks introduced before today — which only
  ever looked at *practice chunks*. A piece where every practice chunk had
  a logged session, but a past transition, combo, or live-due review still
  had zero `doneDays` for its day, read as "nothing behind" and hid the
  button even though `findEarliestBehindDay`'s own scan (via
  `classifyDayCompletion`, item-type-agnostic since Pass 45) would have
  found and pointed at that day correctly on its own.
- **Fix:** delete `hasBehindWork` entirely; call `findEarliestBehindDay()`
  unconditionally. Its own `dayNumber >= currentDay` boundary and existing
  `isFullySwept` skip (Pass 48) already do everything the pre-check was
  trying to do, just correctly and for every scheduled item type.
  `ScheduleBanner.jsx` needed no change — its `hasCatchUp` gate already
  keyed off `earliestBehindDay` alone; the narrower precondition was only
  ever layered on in `TodayTab.jsx`.
- **Verified:** a scratch script reproducing `findEarliestBehindDay`
  verbatim over real `computeTimeline`/`generateAllChunks` fixtures (the
  component itself has no test harness — see
  [AI-GUIDELINES.md](AI-GUIDELINES.md)) confirmed the button now renders
  and targets the correct day when every practice chunk is logged but a
  transition is behind, still doesn't render when nothing is behind, and
  still skips a fully-swept rescheduled day. `npm test`: 563/563.
- See [Algorithms.md](Algorithms.md#behind-schedule-detection).

**Decision (Pass 68): `SectionRunThroughPanel` only renders on real
"today" — `sectionRunThroughGate`/`computeSectionRunThroughs` themselves
are untouched.**

- **Why:** those two functions (`lib/chunking.js`) answer "is this due
  right now" off current, live session counts, with no day parameter —
  correct for what they're actually asked, per the Pass 49 decision above.
  But `SectionRunThroughPanel` rendered that same live answer regardless of
  which day the learner was actually looking at, so browsing back to a
  completed past day (or forward past today) showed *today's* due/locked
  state mislabeled as that day's own — and logging one from a past day
  would have silently attributed the session to `currentDay`, backdating
  it, since `SectionRunThroughPanel` passes `currentDay` straight through
  to `ChecklistItem` as the day a logged session gets attributed to.
- **Fix:** thread `isRealToday` (already computed by `TodayTab` for other
  panels) into `SectionRunThroughPanel`, and return `null` — skipping the
  `computeSectionRunThroughs` call itself, not just hiding its result —
  whenever it's false. The backdating risk is closed for free by the same
  gate: once the panel only ever renders when `isRealToday`, `currentDay`
  at render time is always the real current day by construction, so it
  needed no separate fix.
- **Deliberately not touched:** `sectionRunThroughGate`'s due/locked math
  and the parity-check threshold sequence (Pass 49) — the bug was entirely
  in *when* the answer got displayed, not in the answer itself, so no day
  parameter was added to either function.
- **One implementation deviation from how this was scoped:** doing the
  early return literally *before* the existing `useMemo` call (skipping
  the hook itself on a non-today render) would violate React's rules of
  hooks — this component never unmounts when the learner navigates days,
  so `isRealToday` flips on the same mounted instance across renders,
  and conditionally skipping a hook call between renders of one instance
  throws ("Rendered fewer hooks than expected"). Implemented instead as
  `useMemo(() => (isRealToday ? computeSectionRunThroughs(...) : []), […,
  isRealToday])` followed by the early return — same "skip the real
  computation" property, no crash risk.
- **Verified:** manually in the browser with a throwaway test piece —
  confirmed the panel shows (unlocked, loggable) on today; disappears when
  browsing to a completed past day; does not retroactively appear on a day
  before a session that had just pushed the section's count to its next
  due threshold; and stays hidden on a non-today day across Week view,
  View all, and Interleaved mode alike (not just Day view), since the
  panel sits outside `TodayTab`'s `viewMode` conditional entirely and this
  one gate covers all of them. `npm test`: 563/563, unchanged (no `lib/`
  logic changed).
- See [Algorithms.md](Algorithms.md#section-run-throughs).

## Data model

**Decision: `piece.sections` (musical form) and practice chunks are kept as
fully separate concepts, even though practice chunks carry the legacy
internal `kind: "section"` — accepted as a known naming wart rather than
fixed immediately.**

- **Why not fixed yet:** Renaming touches scheduling/generation code broadly
  for a purely cosmetic (to a reader, not the user) improvement; correctly
  filed as [Roadmap.md](Roadmap.md) housekeeping rather than urgent.

**Decision: storage is real `localStorage`, not the Claude.ai-artifact-only
`window.storage` API used during the app's original artifact phase.**

- **Why:** `window.storage` doesn't exist outside the Claude.ai sandbox;
  swapped during the migration to a real Vite project so the app can run
  anywhere.

**Decision: importing a backup matches each imported piece against existing
pieces (by id, then by name+composer) and merges non-destructively into the
match, instead of always creating a new piece.**

- **Why:** The only edit surface for some fields (before a matching Settings
  UI exists, or for anyone comfortable hand-editing JSON) is to export,
  change the file, and re-import — e.g. changing every piece's
  `minutesPerDay` at once. Re-importing an *unmodified* backup used to append
  a full second copy of every piece, because id collision was treated as "a
  different piece that happens to reuse an id" and given a fresh random id
  rather than as "this is the same piece" — so the single most natural
  round-trip (export, edit, re-import) reliably produced duplicates of
  everything.
- **Approach chosen:** `findMatchingPiece` / `mergeImportedPiece` in
  `lib/storage.js`. A field the import actually provides wins (so an
  intentional edit like `minutesPerDay` takes effect), but a field the import
  leaves blank/missing never erases what the existing piece already has.
  `progress` (practice history) merges per chunk and per session rather than
  one side replacing the other, specifically so a *stale* re-import (edited
  by hand from an older export) can't wipe out sessions logged in the app
  since that export was taken. `id`/`createdAt` are never touched by a
  merge — the piece already exists; only `workId` gets re-derived
  (`ensureWorkId`), same as any other edit. **Revised — "the import wins
  whenever it's present" no longer applies unconditionally to every field.**
  A subset (`status`, and per-chunk `currentBPM`/`targetBPM`/
  `manualConfidence`) now goes through `preferByRecency` instead of plain
  `preferPresent`, gated on each side's `updatedAt` — see the entry below and
  [Algorithms.md](Algorithms.md#import-merge). `minutesPerDay` and most other
  scalar fields are unaffected by that change and still follow the original
  "present wins" rule described above.
- **Alternative considered:** matching by id only. Rejected on its own — the
  fallback name+composer match matters too, e.g. a piece shared from another
  device/session that never had the chance to collide on id but is
  obviously "the same song."

**Decision (superseded by Pass 13, below): on import, a chunk's ladder
state (stage, consecutive-pass streak, current practice tempo, next
review date) always keeps the existing piece's value over the imported
one, rather than picking whichever is actually more advanced.**

- **Why:** `mergeProgress` (`lib/storage.js`) was found silently
  regressing this exact state — re-importing an older backup rolled a
  chunk's stage/tempo/etc. back to whatever that old file had, even when
  the piece had since progressed further in the app, with no warning
  shown. Unlike `minutesPerDay` or similar fields (where an intentional
  hand-edit in the export file is expected to win on re-import), there's
  no legitimate case for hand-editing ladder state directly in an
  exported JSON file, so protecting it outright — rather than letting an
  import's value win whenever it's merely "present," the way
  `preferPresent` treats other fields — was judged the safer default.
- **Known issue, since resolved by Pass 13 (below):** this was a blunt
  rule, not real conflict resolution. It fixed the common case
  (re-importing an older copy of the *same* piece) but "existing always
  wins" was wrong for the opposite case — restoring a backup that's
  genuinely more advanced than what's on this device (e.g. importing from
  a second device practiced on more recently) — where the import's
  more-advanced state was silently discarded instead, with no warning
  shown either way.

**Decision: Pass 13 replaces that blunt rule with `diffImportedPiece`
(`lib/storage.js`) — updatedAt alone resolves the common "one side is
cleanly the older copy" cases automatically (in *either* direction, fixing
the "opposite case" gap above along the way), and only a genuine
tie/unknown-timestamp combined with real per-chunk ladder differences
counts as actual divergence, surfaced to the user as a "keep what's here"
vs. "use the imported version" picker in `ImportPiecesModal`.**

- **Why:** the blunt rule above was safe but wrong roughly half the time
  it mattered; the alternative sketched at the time this was deferred
  (rebuild ladder state from merged session history instead of trusting
  either snapshot) would have meant recomputing `computeLadderAdvance`
  fresh from every merged session — a much larger change, and still
  wouldn't resolve the case where the two sides *genuinely* diverged
  (both progressed independently since a common point) rather than one
  simply being stale. A real user choice, only asked for when there's
  actually something to choose between, was judged the more direct fix.
- **Approach:** `diffImportedPiece(existing, imported)` compares
  `updatedAt` first — whichever side is strictly newer wins outright, no
  picker shown, same spirit as `preferByRecency` already applies to
  status/BPM/confidence (see above) but now extended to ladder state,
  which that mechanism never covered. Only when `updatedAt` is tied
  (including both sides missing it entirely) *and* the two sides'
  `stage`/`consecutivePasses`/`consecutiveStabilizingFails`/`practiceBPM`/
  `nextDueDate`/`tier1Done` actually differ on some chunk both have
  progress on does it report real divergence — `ImportPiecesModal` then
  shows the picker per matched piece, and `App.jsx`'s
  `handleConfirmImport` re-derives the diff at confirm time (same
  "re-check against current state, don't trust the modal's opening
  snapshot" pattern `findMatchingPiece` already uses) and passes the
  resolved side into `mergeImportedPiece`'s new `ladderChoice` parameter.
- **Deliberately scoped to one whole-piece choice, not per chunk** —
  matches the original framing of this question ("choose which history
  to keep"), and a piece with genuine divergence on multiple chunks
  simultaneously is expected to be rare enough that per-chunk granularity
  wasn't worth the added UI. Flagged as a possible future refinement, not
  built.
- **Not addressed by this pass:** `flagSnapshot` (undo-scratch data) and
  `flag` itself are unaffected — neither is "ladder state" in the sense
  this question was ever about. `needsRelearning` (Pass 11) is also not
  part of the divergence comparison or the picker's resolution — it isn't
  in `mergeProgress`'s existing protected-fields list either, so it was
  left exactly as it already behaved (plain "imported wins if present")
  rather than silently folding it into this fix. Worth a deliberate look
  in a later pass.

**Decision: `piece.status` and a chunk's `currentBPM`/`targetBPM`/
`manualConfidence` are protected from a stale re-import by a real recency
comparison (`piece.updatedAt`), not just by whether the import happens to
have a value.**

- **Why:** Found alongside the ladder-state issue above, but distinct from
  it — these fields went through plain `preferPresent`, so *any* backup
  with a value for them won outright, including a plainly older one.
  Concretely: re-importing an old backup after pausing a piece could
  silently make it active again; re-importing after a manual confidence
  override or a fresh tempo log could silently roll either back — with no
  warning shown in either direction, the exact failure mode a prior
  data-reliability review flagged as a real (not hypothetical) risk.
- **Approach:** `piece.updatedAt` (new field, [Data-Model.md](Data-Model.md#the-piece-object))
  is bumped on every local mutation via `updatePiece` (`App.jsx`) — the
  single funnel every piece change already goes through. `mergeImportedPiece`
  computes `importIsStale` from comparing each side's `updatedAt` (missing
  reads as 0, so an import from before this field existed is always treated
  as the older side) and threads it into a new `preferByRecency` helper,
  which `preferPresent`'s callers for these specific fields now use instead.
  Full mechanics: [Algorithms.md](Algorithms.md#import-merge).
- **Deliberately narrower than the ladder-state problem above, at the time:**
  this did not touch ladder state at all (`stage`/`consecutivePasses`/
  `practiceBPM`/`nextDueDate`/etc. still always kept the existing value,
  unconditionally). This fix only closed the narrower, blunter gap: a plain
  older backup no longer won by accident on fields where "present" and
  "correct" used to be treated as the same thing. Ladder state itself was
  left unconditional until Pass 13 (below), which extends this same
  recency-based idea to it and adds a real "choose which history to keep"
  picker for the cases recency alone can't resolve.
- Regression-tested: `test/storage.test.mjs`.

**Decision: a failed `localStorage` write is surfaced to the user, not
silently discarded.**

- **Why:** `savePieceToStorage`/`saveActivePieceIdToStorage` (`lib/storage.js`)
  caught every write exception and did nothing else with it — most likely to
  actually fire as `QuotaExceededError`, since session history only ever
  grows and there's no server-side backup to fall back on. A save that
  silently didn't happen was indistinguishable from one that did; a learner
  could keep practicing for weeks believing everything was recorded.
- **Approach:** both functions now return `{ ok: true }` or
  `{ ok: false, error }` instead of swallowing the exception. `App.jsx`'s
  active-piece persistence effect checks the result and sets a
  `storageError` flag; a banner ("Your last change couldn't be saved…") with
  an Export-backup shortcut shows whenever it's true, and clears itself the
  next time a save actually succeeds — no manual dismissal needed, since the
  underlying condition (storage full/unavailable) either resolves or it
  doesn't.
- **Scoped narrowly:** this surfaces the failure; it doesn't retry the write,
  free up space automatically, or change what triggers `QuotaExceededError`
  in the first place — that was the separate auto-backup-reminder idea,
  **built in Pass 12, below.**
- Verified in-browser with a simulated quota failure (see the session that
  shipped this fix) as well as `test/storage.test.mjs`.

**Decision: a recurring "back up your data" nudge (Pass 12), separate from
the storage-error banner above — surfaced once a day-plus has passed since
the last export (or since first use, if never exported), and dismissible
only per-instance, not permanently.**

- **Why:** the storage-error banner above only fires *after* a write has
  already failed — useful, but reactive. With no server-side persistence at
  all, a backup that's stale or has never been taken is a real risk before
  anything actually breaks, not just after. This is the item the previous
  entry above deferred as "a separate, not-yet-built item."
- **Approach:** a single app-level `measureone-last_exported_at` timestamp
  (not per-piece — one export already bundles every piece together), with
  `measureone-first_use_at` as a lazily-seeded fallback anchor for a
  piece/app that's never been exported at all, so upgrading into this
  feature doesn't retroactively treat a long-time never-exported user as
  instantly overdue. `isExportReminderDue` (`lib/storage.js`) is a pure
  function over those two anchors plus "now," kept separate from the
  localStorage reads themselves so it's cheaply unit-testable the same way
  the rest of this file's pure functions are.
- **Dismissible without being permanently silenceable:** the dismissed flag
  is plain in-memory React state, never persisted — reloading the page (or
  the reminder becoming due again later) always re-surfaces it. Deliberately
  not a "don't show again" checkbox — a recurring reminder about a real,
  ongoing risk (no server-side backup) shouldn't be quietly opt-out-able
  once, the same reasoning behind the storage-error banner above never
  offering a permanent dismissal either.
- **Found and fixed in the same session's code review, before this was
  first committed:** the banner's "Export backup" action originally had no
  guard against a piece-less state — reachable (unlike the pre-existing
  Settings export button, which only ever renders once a piece exists) the
  moment `exportReminderDue` goes true on a fresh install with nothing
  created yet, or after deleting a last remaining piece. Fixed by gating the
  banner on `pieceList.length > 0`. Separately, `handleConfirmExport`
  originally ignored whether `saveLastExportedAt` actually succeeded — a
  quota failure there would have silently claimed "you're backed up" for
  the rest of the session. Fixed by checking the result and setting the
  existing `storageError` flag on failure, reusing the mechanism above
  rather than inventing a second one.
- Verified: `test/storage.test.mjs` (the reminder-due cadence — stale,
  recent, missing, and boundary-exact cases) plus a manual in-browser pass
  forcing an old `lastExportedAt`, confirming the banner appears, dismisses
  per-instance but returns on reload, and clears (with the timer reset) once
  a real export completes.

**Decision (Pass 24): `piece.documents` — reference documents (sheet music
PDF, fingerings, program notes) hosted elsewhere — follows `recordings`'
shape and pattern exactly: `[{ id, label, url }]`, its own `DocumentsEditor`/
`DocumentsList` pair modeled on (not sharing code with) `RecordingsEditor`/
`RecordingsList`, migrated the same way (`documents: piece.documents || []`
on load).**

- **Not generalized into one shared component with recordings**, despite
  being structurally identical (`{id, label, url}`, same add/update/remove
  shape) — the pass's own instruction was to generalize only if it turned
  out trivial, and recordings/documents are different enough in intent (a
  reference to listen to vs. one to read) that sharing now would make a
  later divergence — a document-type field, upload support — an awkward
  prop-threading exercise instead of a local edit. Revisit if a third list
  like this ever appears.
- **Follow-up fix, same pass: documents now merge additively on import,
  matching every other `{id, ...}` list.** Originally shipped without being
  added to `MERGE_FIELDS_HANDLED_SEPARATELY` / given a `mergeById` call in
  `mergeImportedPiece` (`lib/storage.js`) — found in review before this was
  ever committed. Without the fix, an imported backup would silently
  *replace* the existing documents list wholesale rather than merge it by
  id, unlike `recordings`/`bpmZones`/`sections`. Fixed to match; regression
  test added (`test/storage.test.mjs`) and verified capable of failing by
  reverting the fix and re-running it.
- **Explicitly deferred, not this pass:** actual file upload/storage of the
  PDF itself, or any in-app viewing/annotation — a much larger feature
  (real file storage, likely IndexedDB or a backend, not `localStorage`).
  This field is purely a link out; the file is never fetched or stored by
  the app.

**Decision (Pass 24 follow-up, user-directed): Target tempo (BPM) moved
from the "Schedule" step/panel to the "Piece" step/panel — genuinely
relocated, not duplicated — and Tempo zones, Recordings, and Documents
became directly reachable from the Wizard's first step too, without
touching Settings.**

- **What actually moved vs. what got added.** `targetBPM`'s `NumberInput`
  moved out of `ScheduleFields` and into `BasicsFields` — since
  `BasicsFields` is genuinely shared between `Wizard` and `SettingsTab`,
  this single change relocated the field in *both* places at once: it now
  lives in Settings' "Piece" panel (previously "Schedule"), and in the
  Wizard's step 1 ("Piece," previously step 5 "Set your schedule").
  Verified no duplication: exactly one panel in the edit form has the
  field, not two.
- **Tempo zones/Recordings/Documents were deliberately *not* folded into
  `BasicsFields`** the same way, even though the ask was "add them on this
  tab" for the wizard specifically. `BasicsFields` also renders inside
  Settings' "Piece" panel — folding these three editors into it would have
  made them render a *second* time there, on top of Settings' existing
  dedicated "Tempo zones"/"Recordings"/"Documents" panels. Instead, all
  three are rendered directly inside `Wizard.jsx`'s step-1 JSX, reusing the
  exact same editor components Settings uses, so Settings is completely
  unaffected — confirmed by reading the actual rendered panel list (9
  panels, no duplicate titles) after the change.
  All three stay fully optional; `canAdvance()` for step 1 never checked
  them and still doesn't.
- **Corrects a doc claim that was true in intent but false in the code.**
  `CLAUDE.md`, `Architecture.md`, and `Product-Principles.md` all already
  claimed `BpmZonesEditor` and `RecordingsEditor` were "shared, used in
  both Wizard and Settings" — checked against the actual git history of
  `Wizard.jsx` and found this was never true; neither component (nor
  `ScheduleFields`'s BPM field, before this pass) had ever been rendered
  in the wizard. Not a regression, just aspirational documentation that
  outran the code. This pass is what makes the claim true, and the three
  docs were updated to also list `DocumentsEditor`.
- **Answers a question raised during this pass: what happens to tempo
  tracking with no target BPM configured anywhere?** Traced through
  `getDefaultTargetBPM`/`getSuggestedStartingBPM`/`clearsStageFloor`
  (`lib/confidence.js`, `lib/ladder.js`) rather than guessed: the first
  logged session always seeds a chunk's own `practiceBPM` regardless of
  target, and every session after that is graded against that
  self-referential value, not an absolute one. The one place an actual
  target matters is the Settling/Holding stage's tempo-floor graduation
  check — with no target anywhere, that check's math reduces to comparing
  against zero, so it's satisfied automatically. Net effect: nothing
  crashes without a target, but the floor safeguard silently becomes a
  no-op, and the "suggested starting tempo" / "Target tempo: X BPM" hints
  never appear. Independently confirmed by an existing test,
  `test/ladder.test.mjs`'s "No targetBPM configured means no floor to gate
  against — pass always counts". This is itself part of the argument for
  moving the field somewhere more visible.
- **Found and closed in the same pass, not left as debt:** the code review
  before this landed found `docs/User-Flows.md` and `docs/UX-Principles.md`
  state the same "shared editor components" list `CLAUDE.md`/
  `Architecture.md`/`Product-Principles.md` do, but had been missed when
  those three were updated — still only the original six editors. Closed:
  both now list `DocumentsEditor` too, and `UX-Principles.md` gained a note
  on the Tempo-zones/Recordings/Documents exception (rendered directly in
  `Wizard.jsx`, not folded into the shared `BasicsFields` wrapper).

## Multi-movement works

**Decision: a multi-movement work is a grouping label over ordinary pieces —
each movement is a full, self-contained piece sharing a `workId` — not a
nested structure inside one piece.**

- **Why:** movements differ in length, difficulty, section layout, deadline
  and readiness; a violin sonata's slow movement may be revival material while
  the finale is being learned from scratch. Modelling each as a piece means
  chunking, scheduling, confidence, rescheduling, revival and storage all work
  on movements for free, with no branching. The alternative — parts nested
  inside a piece — would have forced every one of those systems to learn about
  parts, for no gain.
- **Consequence accepted:** setting up a five-movement work means running the
  wizard five times. That's real friction, but each run is genuinely different
  data (measures, sections, difficulty, schedule), so a combined flow would
  mostly be the same wizard in a loop. "Add a movement" preseeds and locks
  what actually is shared (work title, composer) to cut the repetition.

**Decision: no rolled-up "work progress" percentage.**

- **Why:** averaging a 300-measure Allegro with a 40-measure Menuetto produces
  a number that means nothing musically, and inviting comparison between
  movements at different stages is exactly the kind of pressure
  [Product-Principles.md](Product-Principles.md#no-punishment-mechanics) rules
  out. `PartSwitcher` shows each movement's own figure instead.

**Decision: `workId` is derived from `workName`, never entered directly.**

- **Why:** it keeps the user-facing model to one field ("what's the work
  called?") and makes promotion free — typing a work title on an existing
  standalone piece in Settings groups it, clearing the title ungroups it, with
  no separate "convert to work" action to build or explain.

**Decision: the work title is shown exactly once on a movement's Overview —
in the hero card's eyebrow — not also as `PartSwitcher`'s own heading.**

- **Why:** `PartSwitcher` used to render `<h3>{workName}</h3>` at the top of
  its own panel, directly below the hero card, whose eyebrow already names
  the work (`piece.workId && piece.workName ? piece.workName : "Now
  practicing"`). A multi-movement piece's Overview was showing the same
  title twice, in two visually separate cards, one screen height apart.
  `PartSwitcher` dropped the heading; the `workName` prop it used to take is
  gone from both `PartSwitcher` and its one call site (`OverviewTab`). A
  `margin-top` on `.part-switcher .part-list` that existed only to space
  content below the removed heading was trimmed too, so the panel's top
  padding matches every other panel's instead of reading as extra-generous.
- **Found via:** a code-review pass explicitly asked to be skeptical of a
  prior pass's own claim that a *different* line (the "N movements, N
  plans" summary under the measure-count line) contained the duplicate
  title. It didn't — checked against the actual Pass 38 commit and live
  rendering, that line has never had title text in it. The real duplication
  was one card down, not in the line the original instructions named. Don't
  stop at disproving a specific claim if the underlying complaint it was
  gesturing at ("I see the title twice") is still real — keep looking for
  where it actually lives.

**Decision: once "Multiple movements" is selected, a blank work title now
blocks proceeding — in both the Wizard ("Next") and Settings ("Save
changes").**

- **Why:** the Wizard case is a straightforward confusing-dead-end
  prevention — nothing catastrophic happens (the piece would just silently
  never join a work despite the toggle showing "Multiple movements"), but
  it's confusing and easy to not notice. The Settings case is more serious:
  `ensureWorkId` (`lib/works.js`) demotes a piece with a blank work title
  back to standalone — `workId: null` — even if it already had siblings.
  Clearing an existing multi-movement piece's title in Settings (by
  accident, or by not realizing the field was blank) silently detaches it
  from its work, with no warning, while its sibling movements keep pointing
  at the same `workId` and simply lose that one piece from their
  `PartSwitcher` list. The single-piece "switch back to 'A single piece'"
  path is unaffected — that's a deliberate, explicit demotion action (it
  clears `workName` itself as part of the toggle), not an accidental blank.
- **Mechanism:** `BasicsFields` owns the single/multi toggle as local
  `useState`, invisible to either `Wizard`'s or `SettingsTab`'s own
  `canAdvance()`/save-gating logic. Both gained an optional
  `onMultiPartChange` callback prop on `BasicsFields` to mirror that state
  up. `Wizard` mirrors it into a plain `useState` (correct on first mount,
  since Wizard itself remounts fresh every time it opens). `SettingsTab`
  can't rely on that same trick — `editDraft`/`editing` deliberately live in
  `App.jsx`, not `SettingsTab`, specifically so switching tabs mid-edit
  doesn't lose the draft — so `SettingsTab` never unmounts between edit
  sessions and needs an explicit `useEffect` keyed on `editing` to reset the
  mirrored value each time a new edit session starts.
- **Known parallel gap, not fixed:** Settings' "Save changes" still isn't
  gated on piece name or total measures being non-blank/non-zero, the way
  the Wizard already was before this session. See
  [Open questions](#open-questions).

## Revival

**Decision: revival reassessment reuses `manualConfidence` (via a fast
5-preset UI) rather than introducing a separate 0-4 confidence scale.**

- **Why:** The Revival brief asked for a re-rating flow "using the existing
  0-4-style confidence scale already in the app" — but no such scale exists
  in the codebase; confidence is a continuous 0-100 score
  (`computeConfidence`) with a 0-100 manual override (`manualConfidence`)
  that already wins over the computed score unconditionally. Rather than
  inventing a new persisted scale to match a brief that assumed one, revival
  reassessment exposes the existing override through `CONFIDENCE_PRESETS`
  (originally Shaky/Rough/OK/Solid/Rock solid → 0/25/50/75/100; relabeled
  Lost/Rough/OK/Comfortable/Solid in Pass 54, same five values — see
  below), which is exactly what the brief's "sets a new current confidence
  baseline, separate from the historical log" requirement already
  describes. See
  [AI-GUIDELINES.md](AI-GUIDELINES.md#prefer-extending-existing-systems-over-creating-parallel-systems).
- **Alternative considered:** a new `progress[id].revivalConfidence` field
  on a literal 0-4 scale. Rejected — would have created a third "how good is
  this chunk" score alongside `computeConfidence` and `computeProgressTier`,
  which [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)
  already flags as an unresolved problem, not a pattern to repeat.

**Decision (Pass 54): revival's sequential reassessment no longer sets
`progress[id].flag` — the flag toggle is removed from `PieceMapTab`'s
chunk-detail modal specifically when `sequentialMode` is true, and
`CONFIDENCE_PRESETS` is relabeled to match.**

- **What actually changed:** the "Run-through flag" field (`PieceMapTab.jsx`)
  is now wrapped in `!sequentialMode`, following the exact scoping
  precedent Pass 37 already established for this same shared component
  (see the Pass 37 decision below) — ordinary (non-revival) Piece Map
  keeps the flag toggle exactly as it was, cycling
  untouched→rough→lost→untouched. Separately (same values, labels only),
  `CONFIDENCE_PRESETS` (`lib/constants.js`) is now
  Lost/Rough/OK/Comfortable/Solid — safe as one shared constant rather
  than a revival-specific copy, since the "Quick rate" row that renders it
  has always been gated to `sequentialMode`, never shared with non-revival
  UI.
- **What this does *not* touch:** `progress[id].flag` itself, its
  demote-and-pin ladder effect (`applyRunThroughFlag`, see
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)'s
  "Flag mode on the Piece Map"), its confidence cap, and both of its
  consumers — `computeRevivalPlan`'s flagged-first sort and `RevivalTab`'s
  "Flagged chunks" summary panel — are all unchanged. This pass removes
  one of the two ways `flag` could be set (revival's own sequential
  reassessment, added alongside Piece Map's own toggle in Pass 6), not the
  field, the sort, or the panel.
- **Real, visible consequence, not an oversight:** since revival's
  reassessment can no longer set `flag` directly, `RevivalTab`'s "Flagged
  chunks" panel will typically stay empty going forward unless a chunk
  gets flagged separately through ordinary Piece Map outside of revival.
  A chunk rated "Lost" via Quick Rate still gets prioritized to the front
  of the generated plan on its own — `computeRevivalPlan` sorts flagged
  chunks first, then lowest confidence first, and a "Lost" rating
  (`manualConfidence: 0`) wins that second tiebreaker unassisted, with no
  flag involved. Verified live: rating a chunk "Lost" and generating a
  plan puts it first, with the "Flagged chunks" panel correctly absent
  (nothing flagged).
- **Intro copy simplified to match:** "Reassess where things stand" no
  longer mentions flagging chunks "rough" or "lost" (removed along with
  the control it described), and gained a new opening instruction — "Play
  through the piece from beginning to end" — that wasn't there before.

**Decision: `computeRevivalPlan` is a new, separate function — not a reuse
or parameterization of `computeTimeline`.**

- **Why:** `computeTimeline`'s core behaviors (spread new-chunk introduction
  across the first half, defer combos to the back half, adaptive review
  offsets keyed off introduction day) exist specifically to manage
  first-time introduction of material. Revival has no "introduction" concept
  — everything was already learned once — so adapting `computeTimeline`
  would mean threading a `isRevival` flag through most of its branches for
  behavior that doesn't apply. Reused instead: the same underlying
  primitives (`generateAllChunks`, `effort`, `EFFORT_TO_MIN`,
  `piece.minutesPerDay`) and the same greedy day-packing pattern
  `ScheduleFields` already uses. See [Algorithms.md](Algorithms.md#revival).

**~~Decision: during an active revival, `piece.revival.performanceTempo`
overrides even an explicit per-chunk `targetBPM`, not just the piece-wide
default.~~ — reverted, Pass 35.**

- **Original why:** A performance tempo collected at revival entry
  represents a deliberate, current intent (e.g. "this needs to be 120 for
  the recital") that should supersede tempos set while first learning the
  piece, even where a chunk already has its own explicit target from that
  earlier phase.
- **Why reverted:** the override was silent and total — a chunk's own
  explicit target vanished from the tempo ladder with no visible indication
  of which source (`performanceTempo` vs. the chunk's own `targetBPM`) was
  actually driving it, and there was no way to opt a single chunk out. On
  reflection this created more confusion than the "deliberate intent" case
  it was meant to serve. `getRevivalTargetBPM` (`lib/revival.js`) now
  resolves exactly like the non-revival path: `entry.targetBPM ||
  getDefaultTargetBPM(piece, chunk)`. See
  [Algorithms.md](Algorithms.md#revival).
- **What happened to the field:** `piece.revival.performanceTempo` is left
  stored-but-unread on any piece saved before Pass 35, rather than actively
  migrated away — non-destructive, and nothing reads it, so there's no
  correctness reason to touch already-saved data. New pieces
  (`defaultPiece()`, Wizard.jsx) and pieces getting a from-scratch
  `revival` default (storage.js, for a piece with no `revival` object at
  all) no longer include the field going forward. The UI that collected and
  edited it — a "Performance tempo" input in both `RevivalEntryModal`
  (entry) and `RevivalTab`'s "Revival settings" panel (mid-revival) — is
  removed outright, not just disconnected, since keeping either would
  imply the value still does something.
- **`tempoLadderStartFraction` moved to revival entry:** previously
  hardcoded to `0.6` at `handleStartRevival` (App.jsx) and only editable
  from `RevivalTab`'s mid-revival settings panel. As of Pass 35 it's
  collected in `RevivalEntryModal` at the same point `purpose` and
  `lastPlayedDate` already were, and stays editable afterward from
  `RevivalTab`'s "Revival settings" panel (now holding just this one
  field). The Wizard's "reviving an old piece" toggle (Wizard.jsx step 0)
  doesn't collect this itself — it only sets `startAsRevival`, which opens
  `RevivalEntryModal` on completion (`App.jsx`'s `handleComplete`), so that
  single modal is the actual entry point for both ways a revival can start.

**Decision: allow starting a piece directly in revival mode from the Wizard,
not just from an existing piece via the Piece Overview dashboard.**

- **Why:** Not every piece a musician wants to track was originally learned
  *through this app* — someone might want to add a piece they learned years
  ago and haven't touched since, without pretending to "learn it fresh"
  first. A toggle on the Wizard's final Review step lets Setup run
  normally (still required — revival planning reuses `generateAllChunks`/
  `effort`) and then opens the revival entry modal on completion instead of
  landing on Piece Overview.
- **Why this didn't need new machinery:** `RevivalTab`'s reassessment flow
  already only reads `piece.progress`, which is empty for a new piece by
  default — "zero sessions logged" was already a valid starting state, not
  a special case to build for.

**Decision (built — Pass 19, extended in a follow-up): Master Agenda's
Revival subtab shipped as piece-level cards only, then gained chunk-level
detail — shown as highest-priority items, not as "today's work."**

- **Why this needed deciding at all:** Pass 19 was scoped as a pure
  presentation split of data Master Agenda already computed, into three
  subtabs (learning / maintenance / revival). The first two were exactly
  that. The third was not: **Master Agenda computed no revival data at
  all**, and by documented design never had — `computeDueReviews` excludes
  pieces in revival ("revival is already 'something's wrong' mode"), and
  such pieces are usually past their original plan window, so they simply
  didn't appear. There was no existing bucket to split out.
- **Consequence, as originally shipped:** rather than pull per-chunk items
  from `computeRevivalPlan` (new computation, and squarely inside what the
  pass had deferred), the subtab listed each in-revival piece with its
  purpose, where it is in the flow (reassessment / plan ready), and a link
  into the piece. `MasterAgendaTab` also skips in-revival pieces when
  building the other two lists, so a piece appears in exactly one subtab
  rather than showing stale original-plan content alongside its revival
  card. That skip still stands; only the card's detail level changed.
- **~~Deliberately left open — revisit~~ — resolved, built as a follow-up:**
  the Revival subtab now *does* show chunk-level detail, matching the
  granularity of the other two subtabs, per the user's call.
  - **The mismatch that had to be resolved first:** the other subtabs show
    "today's work" because a learning plan is dated — day 1, day 2, day 3.
    A revival plan is not. It's a priority-ordered list, and RevivalTab
    states outright that everything in it is loggable any day, in any
    order. So there is no "today's revival measures" to display. Resolved
    by showing the **highest-priority items** instead, labelled *Start
    here* rather than a date-implying tag — the first plan day is exactly
    the top-priority block, since `computeRevivalPlan` sorts flagged
    first, then weakest confidence, then packs to the daily budget.
  - **Mid-reassessment** (no plan generated yet) the card says
    "Reassessment in progress" and then shows the same priority items,
    computed live: `computeRevivalPlan` is a pure function of progress +
    chunks and never reads `revival.plan`, so it works off
    partially-reassessed data. Once a plan exists, the **stored** plan is
    preferred, so this agrees with what RevivalTab shows rather than
    silently diverging from it if progress has moved on since generation.
  - **No time estimate on these cards, and revival minutes stay out of the
    "Total planned" banner** — that number means committed daily work, and
    revival items are explicitly not scheduled to a day. Showing a time
    would imply a commitment the plan doesn't make.
- **Known consequence of the skip, not yet decided:** starting a revival on
  a piece that is still mid-learning now hides that piece's ordinary
  plan-day card while the revival runs. Consistent with the existing
  suppression philosophy, but nothing prevents that combination today, and
  it has not been confirmed as the wanted behaviour.

**Decision (built — Pass 19 follow-up): "is this piece in revival?" has one
definition, `isInRevival(piece)` in `lib/revival.js`, standardized on
`revival.active`.**

- **Why:** `piece.revival` records an in-progress run two ways — the
  `active` boolean and the `startedAt` timestamp — and both are set and
  cleared together by `handleStartRevival`/`handleEndRevival` (App.jsx).
  Because both were live, call sites drifted into checking different ones:
  App.jsx's nav, `OverviewTab`, and `storage.js`'s import merge read
  `active`, while `computeDueReviews` (`lib/maintenance.js`) and
  `TodayTab`'s suppression copy read `startedAt`. **This was never a live
  bug** — the two cannot disagree through any path the app itself takes —
  but it left one rule written down twice, in two shapes, with nothing
  keeping them in step. Caught in self-review while building Pass 19's
  Master Agenda subtabs, which would otherwise have added a third copy.
- **Why `active` and not `startedAt`:** answering this yes/no question is
  `active`'s entire job, whereas `startedAt` has a real second one — it's
  the cutoff `computeComboEscalations` uses to decide which logged sessions
  belong to the current run. Each field now does only what it's for, and
  `computeComboEscalations` deliberately still reads `startedAt` directly,
  as a timestamp rather than as a flag.
- **Consequence:** every boolean revival gate in the app now routes through
  `isInRevival` — `App.jsx` (nav item, tab render, `handleOpenRevival`),
  `OverviewTab`, `TodayTab`, `MasterAgendaTab`, `computeDueReviews`,
  `getRevivalTargetBPM`, and `storage.js`'s `mergeImportedPiece`. Behaviour
  is unchanged in every case; the only reachable difference would be
  externally-produced data (a hand-edited backup) setting one field without
  the other, which now resolves consistently instead of per-call-site.
  Locked with regression tests in `test/revival.test.mjs`, including one
  asserting `computeDueReviews` suppresses maintenance for exactly the
  pieces `isInRevival` reports.
- **Manually verified end-to-end (follow-up).** Initially this shipped
  covered by unit test only, with the five UI gates unverified at the
  wiring level. That gap has since been closed: a throwaway piece was
  created, driven into revival, and each gate checked in both states —
  `App.jsx`'s nav item (absent → "Revival" appears), its revival tab
  render, `OverviewTab`'s button ("Start revival" → "Continue revival"),
  `TodayTab`'s suppression copy, and `MasterAgendaTab`'s filter (the piece
  moving from the learning list to the revival list, with the total across
  subtabs unchanged). All five correct. The throwaway was deleted and the
  real saved piece confirmed byte-identical afterwards.
- **Found while verifying:** `TodayTab`'s revival suppression copy is only
  reachable once a piece is *past its plan*, since that message lives in
  the past-plan branch. For a piece still inside its plan, an active
  revival does not change the Today tab at all — it keeps showing the
  normal day-by-day plan. See the open question on gating revival, below,
  for why that matters.
- **The scope note that produced this:** the fix touches `lib/maintenance.js`,
  which Pass 19 had explicitly placed out of scope ("no change to
  `computeDueReviews`"). It was flagged rather than folded into that pass,
  and done separately once confirmed — the pass boundary held.

**Decision (Pass 38): the Revival tab's title-card subheading drops the
purpose/last-played recap in favor of a plain "Returning '{piece}' to its
former glory," as part of a broader pass making revival-mode copy read
less clinical (user-directed — flagged as "too jargon-y/clinical" after a
copy audit; see also Pass 24's rewrites to the reassessment and
"needs another look" panel hints, same motivation).**

- **Consequence, not explicitly decided:** `revival.purpose` (why this
  revival was started — performance/lesson/enjoyment/checking) and
  `piece.lastPlayedDate` are still collected at revival entry
  (`RevivalEntryModal`) but are no longer displayed anywhere during an
  active revival — the Revival tab header showed them before this pass;
  `MasterAgendaTab`'s revival card also dropped its purpose blurb in the
  same pass. `lastPlayedDate` is still shown on Piece Overview
  independent of revival state (see
  [Data-Model.md](Data-Model.md#the-piece-object)), so that field isn't
  orphaned; `revival.purpose` now has no display surface at all. Whether
  that's fine (the purpose mattered only at entry, to shape tone/tempo) or
  a real information loss (a returning user forgets why they started this
  revival) wasn't explicitly weighed — flagged here rather than decided.

**Decision (Pass 78): Today's Practice redirects to a single panel while a
revival is active, instead of showing the piece's regular bounded plan
underneath it.**

- **The bug this fixes:** `DueReviewPanel` (the past-the-plan due-reviews
  view) already had its own `isInRevival` suppression copy — "Maintenance
  reviews are set aside while a revival is running" — but that was the
  *only* place in `TodayTab` that checked revival state. Every other view
  mode (Day, Week, Interleaved, All Tasks) kept rendering the piece's
  regular plan, with its own checklist items, review due-dates, and
  section run-throughs, completely independent of — and stale relative to
  — the separate plan Revival was actually generating and tracking. A
  learner mid-revival who opened Today's Practice by habit would see and
  could log against a plan that had nothing to do with what they were
  actually supposed to be doing.
- **Why a redirect panel, not removing "Today" from the sidebar:**
  considered and rejected as a bigger UX change than this pass needed —
  removing a persistent nav item is a more disruptive, more visible change
  than swapping what appears under an item that's still there, and it
  would have made "Today's Practice" behave differently from every other
  tab (all of which stay in the nav regardless of piece state). The
  redirect panel is the same idea `DueReviewPanel` already established for
  its own narrower case, generalized to the whole tab rather than
  reinvented — "Today" stays visible and clickable throughout a revival,
  it just lands on an explanation-plus-button instead of a checklist.
  `DueReviewPanel`'s own copy and behavior are untouched by this pass.
- **Mechanics:** the check
  (`isInRevival(piece)`, already imported) sits in `TodayTab.jsx` after
  every Hook call — never before one, which would violate React's rules of
  hooks — but before the `return` that branches on `viewMode`, so it's
  independent of which mode was last selected and of whether
  reassessment/plan-generation has happened yet (`isInRevival` only reads
  `revival.active`). See
  [Algorithms.md](Algorithms.md#isinrevival--one-definition-of-in-revival).

## Lifecycle

**Decision — superseded for Archive specifically (see below): pause/archive
(`piece.status`) is a manual, user-set toggle with no automatic
transitions — not a computed "this piece is learned" state.**

- **Why:** at the time, [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented)
  flagged "what formally defines learned" as unresolved (since resolved in
  design, not yet implemented — see
  [Spaced repetition & maintenance](#spaced-repetition--maintenance) above),
  and
  [AI-GUIDELINES.md](AI-GUIDELINES.md#when-youre-not-sure) says not to
  silently resolve an open question while building something adjacent to
  it. Pause/archive doesn't need that question answered — it's scoped to
  "take this off my daily agenda," which the user is always in the best
  position to decide, consistent with
  [Product-Principles.md](Product-Principles.md#always-provide-a-manual-escape-hatch).
- **Alternative considered:** auto-suggesting archive once every chunk hits
  some confidence threshold. Rejected for the same reason `computeProgressTier`
  and `computeConfidence` were never unified into one "done" signal — see
  [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them) —
  there isn't yet a single trustworthy number to threshold against.
- **Consequence:** pause and archive behave identically everywhere except
  their Settings copy and button set — both suppress the schedule banner and
  drop the piece from the Master Agenda. Confidence decay is untouched by
  either: `computeAutoConfidence`'s existing recency term already fades an
  untouched piece whether or not `status` exists, so no second decay
  mechanism was built. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#pause--archive-built) and
  [Algorithms.md](Algorithms.md#behind-schedule-detection).

**Superseding decision: "Archive piece" (Settings' "Practice status" panel)
is now disabled — grayed, with an inline reason and a hover title — until
`isPlanActuallyComplete(piece, chunkSet, timeline)` (Pass 39) says the
piece's plan is actually finished. Pause is untouched.**

- **Why:** requested directly — archiving was previously possible at any
  point in a piece's plan, with no signal that the plan itself wasn't done.
  Reuses `isPlanActuallyComplete` directly rather than a new check, per
  [AI-GUIDELINES.md](AI-GUIDELINES.md#prefer-extending-existing-systems-over-creating-parallel-systems).
- **Only Archive changed.** Pause keeps behaving exactly as the decision
  above describes — no computed condition, available any time. The two
  buttons sit side by side in the same panel and now deliberately behave
  differently.
- **Tension flagged, not resolved:** a piece the learner has genuinely
  abandoned mid-plan — not finished, never going to be — can't be archived
  under this rule until it either finishes, or (for a `scheduleMode:
  "days"` piece) runs past its calendar with every scheduled item logged.
  Pause is the only escape hatch for that case today, and it isn't a
  semantic match ("set this aside for now" vs. "I'm done with this,
  permanently"). Not decided which way to resolve — see
  [Open questions](#open-questions).
- **Consequence:** `chunkSet`/`timeline` are now passed into `SettingsTab`
  as props from `App.jsx`, the same way every other tab already receives
  them, rather than recomputed locally inside `SettingsTab` — an early
  version of this fix recomputed them locally (to stay within a
  narrowly-scoped file-touch instruction) before being corrected to reuse
  the existing values instead. See [Architecture.md](Architecture.md).

## Cross-piece views

**Decision (Pass 42): the first cross-piece summary (`AllPiecesTab`) is
deliberately bounded — a per-piece row (progress %, confidence %, days
since last touched, time practiced) plus a total-time stat, nothing more.**

- **Scope explicitly settled with the user before building**, rather than
  guessed at: candidates on the table were this summary table, a
  consistency/streak view (which calendar days across pieces were touched
  by *any* piece), or both. The consistency view was scoped out entirely —
  no existing `lib/` function computes it, so building it would mean new
  aggregation logic from scratch, which the pass was explicitly asked to
  avoid. This is *not* the "cross-piece repertoire health dashboards" item
  already listed under Maintenance mode in [Roadmap.md](Roadmap.md) — no
  lifecycle-state detection, no health scoring, just a summary table.
- **Placement:** reached via a "View all pieces" button on `ProgressTab`,
  using a button-triggered `activeTab` value ("all-pieces") never added to
  `NAV_BASE` — the same shape `revival` already uses. Chosen over a new
  sidebar entry because it's a smaller IA commitment and matches the user's
  own request; can be promoted to a real nav item later if the view earns
  its place.

**Decision: `AllPiecesTab`'s per-piece confidence uses `elapsedDay(piece)`
(real, unclamped calendar days since `startDate`), not the timeline-clamped
`getCurrentDay(piece, timeline.days.length)` other screens use for whichever
piece is currently active.**

- **Why not just match the other screens:** `getCurrentDay` clamps to the
  plan's last day and *stays pinned there forever* once a piece runs past
  its own plan — it doesn't just read differently, it freezes. Two pieces
  neglected for very different lengths of time (two weeks overdue vs. six
  months overdue, neither reopened since) would show the exact same
  confidence number under `getCurrentDay`, because both clamp to the same
  day. For a view whose purpose includes surfacing which pieces have gone
  stale, that's a real cost, not a cosmetic difference — `elapsedDay`'s
  "keep decaying with real time" behavior is the more informative default
  here, even though it's the one that doesn't match `OverviewTab`.
- **What matching the other screens would actually require:** not a one-line
  swap. `getCurrentDay` needs `timeline.days.length` as its clamp bound,
  which means computing a real timeline per piece
  (`getEffectiveTimeline`/`computeTimeline`), not just `generateAllChunks` —
  `MasterAgendaTab` already pays this cost for every piece, so it's not
  prohibitive, just more than what's here now. Doing it *correctly*, matching
  what `MasterAgendaTab` actually shows for a "background" piece (one that
  isn't the currently-open one), would also mean replicating
  `computeMinutesModeAutoExtend`'s display-only extension — otherwise an
  overdue `scheduleMode: "minutes"` piece would show a stale, frozen number
  here instead of the "keeps growing" one Master Agenda deliberately built
  for exactly that case (see the Pass 39 notes in [CLAUDE.md](../CLAUDE.md)).
  Switching to `getCurrentDay` without that second piece would trade one
  small inconsistency (drifts from Overview for an overdue piece) for a
  different, arguably worse one (freezes exactly where that mechanism was
  built to stop freezing).
- **Explicitly confirmed with the user, not a unilateral call**: raised as a
  flagged trade-off after a code review; the user chose to keep `elapsedDay`
  rather than have the fuller `getCurrentDay`-plus-auto-extend version built.
  Revisit if this view's purpose shifts toward "match every other screen
  exactly" rather than "surface staleness honestly."
- Practical effect for most pieces, most of the time: no difference at all —
  the two functions agree for any piece still inside its own plan window,
  which is the common case. They diverge only for a piece that's fallen
  behind its own schedule and hasn't been reopened since.

**Includes per-piece error isolation** (a `try`/`catch` around each piece's
row computation, plus an outer one around the whole loop) — the same
two-layer shape `MasterAgendaTab`'s `agendaData` computation already uses
for the same "loop over every piece at once" risk: one malformed piece
shouldn't be able to take down a view whose entire point is showing every
piece. Added after a code review flagged its absence (found by comparison
against `MasterAgendaTab`'s existing pattern, then verified by actually
injecting a piece with `measureDifficulty: null` into `localStorage` and
confirming it was skipped with a logged error rather than crashing the
page).

**Decision (same-session follow-up): the consistency/streak view scoped
out of `AllPiecesTab`'s first version, above, was built after all — the
user tried the page and asked for it directly, along with two smaller
additions (a "Back to current piece" button, and narrowing "time
practiced" to the current week).**

- **The consistency heatmap reads `session.loggedDate` directly, not the
  plan-relative day numbers `ProgressTab`'s own per-piece heatmap uses.**
  Different pieces have different `startDate`s, so plan-day 5 on one piece
  and plan-day 5 on another aren't the same calendar day — a cross-piece
  view needs a shared axis, and every session already carries a real
  calendar date. This turned out simpler than the per-piece version, not
  harder: no `__consolidation__` special-casing was needed (its sessions
  carry `loggedDate` too, confirmed by checking `App.jsx`'s run-through
  logging directly rather than assuming), where `ProgressTab`'s version
  has to read `doneDays` separately for that case.
- **Window is a fixed trailing 14 calendar days**, not the piece's own plan
  length (which doesn't exist at the cross-piece level) — 14 was chosen to
  match the existing "of last N days practiced" stat `ProgressTab` already
  uses, not picked freshly.
- **"Touched" excludes skipped and provisional sessions**, via the
  existing `loggedSessions()` — the same rule the per-piece heatmap
  already uses. Time practiced (a separate stat, below) is more generous
  on purpose: a skipped session still spent real time, even though it
  isn't a judged attempt.
- **"Time practiced" changed from all-time to the current week (Monday
  through today)**, both the per-row figure and the header total. No
  existing helper did week-boundary math (checked before writing one); new
  `startOfWeekISO`/`sumPracticeSecondsSince` (`lib/utils.js`) do only that,
  reusing `sumPracticeSeconds`'s existing "skipped time still counts" rule
  rather than introducing a second philosophy about what counts as
  practice time on the same page.
- **"Back to current piece"** reuses the exact `onSelectPiece` callback the
  table's own rows already call — no new navigation mechanism, just a new
  place to trigger the existing one, passed the currently-open piece's id.
- All three pieces of new `lib/` logic are tested (`test/utils.test.mjs`),
  including a DST-transition regression for the Monday calculation and a
  case that would have caught the two-line `startOfWeekISO` bug this pass
  actually reintroduced and caught during its own verification.

## Documentation

**Decision: fold the standalone `measureone-context-summary.md` (previously
kept outside the repo, in a local Downloads folder) into this `docs/`
directory rather than keeping it as a separate, un-tracked file.**

- **Why:** Product-decision history that lives outside the repository is
  invisible to anyone (human or AI) working from the repo alone, and is one
  lost file away from disappearing entirely. Its content now lives here (this
  file) and in [Roadmap.md](Roadmap.md); nothing from it should be treated as
  living only in that external file going forward.

## Cold-Start check

**Decision (Pass 56): the escalating 3/7/14/28/... "prompt due" check is
implemented as a pure, uncached recomputation off `piece.lastLoggedAt`
alone — comparing today's crossed threshold against the same computation
one day earlier — rather than a persisted "which threshold was last shown"
flag written by an automatic effect.**

- **Why:** the pass's own text suggested a fairly specific mechanism —
  "track which threshold has already been shown this gap cycle (e.g. a
  `lastPromptedThreshold` value)... reset it to null whenever any new
  session gets logged," and named Pass 39's `computeMinutesModeAutoExtend`
  effect (auto-applied, scoped to the active piece) as the established
  pattern for this class of problem. Building that literally first
  surfaced a real timing hazard: an effect that writes "this was shown"
  the moment a threshold becomes due triggers a re-render whose *very
  next* computation reads its own just-written state and immediately
  un-shows the panel it had only just decided to show — functionally
  never visible to a real user, despite technically rendering for one
  React commit. Making that work at all requires either (a) extra
  same-day-tolerance bookkeeping (a `lastPromptedDate` alongside the
  threshold, so the write doesn't retroactively hide the render that
  triggered it) *and* a separate cross-cycle anchor (so a stale
  high-water-mark from an old, escalated cycle doesn't wrongly suppress a
  lower threshold in a brand new one — three persisted fields in total,
  worked through and rejected in favor of), or (b) the live-derivation
  approach actually shipped, which needs no stored state and has no
  self-cancellation hazard to guard against in the first place, per
  [AI-GUIDELINES.md](AI-GUIDELINES.md#prefer-extending-existing-systems-over-creating-parallel-systems)'s
  spirit of not introducing a new kind of persisted "unlocked" state when
  an existing pattern already covers it — see the very similar reasoning
  for [Algorithms.md's section run-throughs](Algorithms.md#section-run-throughs)-style live derivations
  throughout this codebase (`sectionRunThroughGate`, `chunkSet`/`timeline`,
  `isPlanActuallyComplete`).
- **What's preserved, what's different:** every literal behavior the pass
  asked for still holds — fires once on the day a threshold is newly
  crossed, stays quiet through the days in between, escalates through
  3 → 7 → 14 → 28 → ..., and a fresh gap cycle after any new session is
  logged is never suppressed by memory of an old, more-escalated cycle
  (verified in `test/coldStart.test.mjs`, including a regression test for
  exactly that cross-cycle case). What's different is purely internal:
  `piece` gains no new persisted field for this at all — `App.jsx` needed
  no new `useState`/`useEffect` beyond the two log/unlog handlers
  (`handleLogColdStart`/`handleUnlogColdStart`), since `TodayTab`/
  `ColdStartPanel` compute `coldStartDueThreshold(piece)` fresh on every
  render, the same way `TodayTab` already computes `elapsedDay`/
  `pastPlan`/`dueItems` locally without needing App.jsx to precompute and
  thread them down.
- **Consequence:** this is an interpretive judgment call on an
  underspecified implementation detail, not a product-behavior deviation —
  flagged here explicitly per
  [AI-GUIDELINES.md](AI-GUIDELINES.md#when-youre-not-sure) so a human can
  course-correct if a literal persisted-flag mechanism was actually
  wanted for some reason not visible from the pass description alone
  (e.g. wanting the "already shown" state visible/editable in an exported
  backup). See [Algorithms.md](Algorithms.md#the-repeating-escalating-prompt)
  for the full mechanics.

**Decision: Cold-Start sessions write to a new synthetic
`piece.progress["__cold_start__"]` key, never appended to
`"__consolidation__"`'s existing sessions array.**

- **Why:** `computeRevivalTriggers` (`lib/revival.js`) already reads every
  `"__consolidation__"` session's `stopCount` indiscriminately for its
  ">5 stops" trigger. A Cold-Start session's shape carries no `stopCount`
  at all (see the feedback-shape decision below) — blending the two would
  silently corrupt that trigger's meaning the moment a Cold-Start session
  landed among consolidation-day ones. Separately, Progress's recent
  practice-history list would blend a deliberately-cold gap test in with
  routine scheduled consolidation days, losing a distinction worth
  keeping (the two answer different questions: "did today's scheduled
  run-through go smoothly" vs. "how does this piece hold up after being
  left alone for a while").
- **Consequence, since fixed (same session, on review):** `lib/storage.js`'s
  `backfillProgressLadderState` and `ladderStateDiffers` special-cased
  `"__consolidation__"` by name and were initially **not** updated to do
  the same for `"__cold_start__"` — `lib/storage.js` wasn't in the
  originating pass's touched-file list. Harmless in practice (every
  backfilled ladder field landed on the same deterministic default
  regardless of key) but inconsistent, and found during a follow-up
  critical review. Fixed by introducing a shared `NON_CHUNK_PROGRESS_KEYS`
  list both functions read from, so a third such key later only needs
  adding in one place. See
  [Data-Model.md](Data-Model.md#pieceprogress-keys-are-not-guaranteed-to-exist-in-the-chunk-set).
  The same review pass found `computePracticeHistory` (`lib/history.js`)
  had an analogous, actually-user-visible gap — `"__cold_start__"`
  deliberately carries no `doneDays`, and that function indexed purely off
  `doneDays`, so a logged Cold-Start session never appeared on Progress's
  "Recent practice history" list at all. Fixed by indexing
  `"__cold_start__"` sessions off their own `day` field instead (deduped
  per day, mirroring `doneDays`' own semantics) — see
  [Algorithms.md](Algorithms.md#logging-a-separate-synthetic-key-not-__consolidation__).

**Decision: the feedback form is exactly two fields — `avgBpm` (a number)
and `notes` (free text) — with no structured stop-count/memory-break/used-score
inputs, and the result is log-and-display only; nothing computes off it
yet.**

- **Why:** simplified from a richer first scoping pass, resolved before
  implementation started (not a call made during this session). Stops and
  memory breaks are folded into the free-text notes instead of tallied
  live, which is also why this pass's logging panel doesn't reuse
  `"__consolidation__"`'s dedicated "Times stopped" `NumberInput` — a
  cold-start check is meant to be one uninterrupted play-through, with
  reflection afterward, not a live tally during it.
- **Since built (Pass 58, same session):** the manual "overall piece
  confidence" override this bullet originally deferred now exists
  (`piece.manualOverallConfidence`), and the connection it anticipated —
  a completed Cold-Start result prompting an update to it — was built as
  a same-session follow-up once explicitly requested. See
  [Overall piece confidence](#overall-piece-confidence) below for both.
  Comparing `avgBpm` against `targetBPM`/`practiceBPM` and surfacing a
  derived delta remains explicitly deferred, not built.

**Decision (same session, found via an independent critical review pass):
`ProgressTab`'s "Outcome breakdown" panel silently diluted its own
percentages whenever a `"__consolidation__"` or `"__cold_start__"` session
existed — fixed by excluding both from the denominator, not just skipped/
provisional sessions.**

- **Why:** `allSessions` there was built from `loggedSessions(entry.sessions)`
  across every progress entry, which only drops `skipped`/`provisional`
  sessions. A `"__consolidation__"` or `"__cold_start__"` session is
  neither — it's a synthetic, non-chunk entry with a `stopCount` or
  `avgBpm` instead of an `outcome`/`effectiveness`, so `sessionOutcome()`
  returns `null` for it. Left in, it inflated the denominator
  (`allSessions.length`) without ever landing in the pass/soft-miss/fail
  numerator, silently pulling every real percentage down — bars that no
  longer summed to 100%, with no error anywhere. **This is not a new class
  of bug**: the identical mechanism was already found and fixed once for
  skipped sessions specifically (see
  [Spaced repetition & maintenance](#spaced-repetition--maintenance),
  "Outcome breakdown" item) — that fix (routing through `loggedSessions()`)
  just never anticipated a session that's neither skipped/provisional NOR
  chunk-shaped. `"__consolidation__"` has silently had this exact problem
  since Pass 6; Cold-Start added a second source of it, which is what
  surfaced it on review.
- **Fix:** a new `allJudgedSessions(piece)` (`lib/confidence.js`, next to
  `sessionOutcome`) — `loggedSessions()` plus a
  `.filter(s => sessionOutcome(s) !== null)` — replaces the inline
  computation in `ProgressTab.jsx`. Extracted to `lib/` rather than left
  inline specifically so the fix has a regression test
  (`test/confidence.test.mjs`), per CLAUDE.md's "logic that needs a
  regression test belongs in `src/lib/`" rule — a component-level inline
  computation can't be unit-tested at all in this codebase (no rendering
  harness). Verified live: a piece with 4 real pass sessions, 1 real fail,
  and 1 `"__cold_start__"` session now correctly shows 80%/0%/20% (summing
  to 100%), not diluted by the cold-start session sitting in neither
  bucket.
- **Not otherwise audited**: whether any *other* Progress-tab stat has the
  same class of gap for `"__consolidation__"`/`"__cold_start__"` wasn't
  exhaustively re-checked beyond what this review pass happened to trace
  (the Consistency panel's separate `practicedDays` counter was checked
  and found to already handle both keys correctly, via its own generic
  `loggedSessions` pass — no fix needed there).

**Decision: `ColdStartPanel`'s `avgBpm`/`notes` form fields are cleared by
a `useEffect` keyed on `coldStartDueThreshold`, not left as plain
component state.**

- **Why:** found via review — `TodayTab` always renders
  `<ColdStartPanel>` unconditionally; it's the component's own `null`
  return (not an unmount) that makes it disappear once due-threshold logic
  says nothing's currently due. Without an explicit reset, a note typed
  but never submitted would survive the panel going quiet (e.g. the user
  logs a different, regular session on the piece, resetting the gap) and
  could silently reappear pre-filled the next time a threshold fires days
  later, in the same continuous browser session.
- **Not independently verified end-to-end**: reproducing the exact
  multi-day, no-reload sequence live isn't practical (the app has no
  "advance the calendar" affordance to test with), so this is verified by
  code inspection — the effect's dependency (`dueThreshold`, a primitive)
  correctly re-fires on every null→non-null transition — plus a live check
  that the change doesn't regress the normal show/submit/clear flow.
  Flagged rather than asserted with full confidence, per
  [AI-GUIDELINES.md](AI-GUIDELINES.md#when-youre-not-sure).

## Overall piece confidence

**Decision (Pass 58): the aggregation formula is an effort-weighted
average of `computeConfidence` across every practice chunk, confirmed with
the user before writing any code (the pass's own explicit instruction,
since the request itself left this open).**

- **Why:** offered two candidates — a plain (unweighted) mean, or
  weighting each chunk by its `effort` value. Recommended effort-weighted
  for consistency with how this codebase already weights everything else
  time/effort-related (`EFFORT_TO_MIN`-based scheduling, revival, and
  maintenance math) — a long or hard passage should move a piece-level
  confidence number more than a short easy one, the same way it already
  commands more of the practice budget everywhere else. Confirmed by the
  user before implementation started.
- **Consequence:** `computeAutoOverallConfidence(piece, practiceChunks,
  currentDay)` (`lib/confidence.js`) reads each chunk through
  `computeConfidence` (not `computeAutoConfidence`), so a per-chunk manual
  override or rough/lost/`needsRelearning` cap already shapes the rollup —
  no separate handling needed for those cases. See
  [Algorithms.md](Algorithms.md#overall-piece-confidence-pass-58) for the
  formula itself and
  [Data-Model.md](Data-Model.md#overall-piece-confidence-a-rollup-not-a-third-independent-score)
  for why this isn't a third entrant in the existing "two scores" table.

**Decision: touched `App.jsx` even though it wasn't in this pass's listed
touched-file set.**

- **Why:** the pass's own "Builds" text requires "a way to set/clear the
  manual override inline" on `ProgressTab` — that control cannot write
  `piece.manualOverallConfidence` anywhere without a handler that calls
  `updatePiece`, and every piece mutation in this app funnels through an
  App.jsx-owned handler (CLAUDE.md's rule). There was no way to build the
  explicitly-requested control without this touch. A prior, similar
  situation (see [Lifecycle](#lifecycle) above) already found that
  contorting code to avoid a narrowly-scoped touch instruction produces
  worse code than just making the necessary, minimal touch — the same
  call was made here: one small handler
  (`handleSetManualOverallConfidence`), mirroring the existing
  `handleSetManualConfidence` exactly, one prop threaded into the existing
  `<ProgressTab>` call. Nothing else in `App.jsx` was touched.

**Decision: initially shipped without the Cold-Start-completion nudge —
despite Pass 56 having already shipped by the time this pass ran, the
pass's own stated trigger condition for building it — then built it as an
explicit same-session follow-up once asked for directly.**

- **Why held back at first:** the pass's own Touches list didn't include
  `ColdStartPanel.jsx` or the rest of Pass 56's files, and building the
  nudge meant reaching into an already-shipped, already-committed pass's
  code for a piece of work the pass description itself framed in
  explicitly softer language than the override control ("soft
  connection... not a dependency either direction," "a natural moment to
  prompt," an "e.g." example) — read as the optional half of this pass,
  not its structural core, unlike the override control (which is
  genuinely unbuildable without touching `App.jsx`, per the decision
  above). Flagged rather than folded in, per this project's own
  scope-fence instruction.
- **What shipped once asked for:** `ColdStartPanel` (`src/components/tabs/today/ColdStartPanel.jsx`)
  now shows a short, genuinely optional "How would you rate the piece
  overall right now?" prompt immediately after a successful Cold-Start
  log — five quick-tap presets (`CONFIDENCE_PRESETS`, the same ones
  `PieceMapTab`'s revival "Quick rate" control already uses) plus a
  "Skip" button. Picking a preset calls
  `handleSetManualOverallConfidence` immediately (same instant-apply
  escape-hatch shape as every other manual-confidence control in this
  app); Skip dismisses with no trace — nothing is written, and nothing
  persists to be resumed later if the learner navigates away without
  answering either way. Explicitly asked to be optional, not just
  softly-worded as such — confirmed there's no way to reach this prompt
  that blocks or delays anything else on the page.
- **Mechanism, not obvious from the diff alone**: logging a Cold-Start
  session immediately updates `piece.lastLoggedAt` to today, which on the
  very next render makes `coldStartDueThreshold` go back to `null` (see
  [Algorithms.md](Algorithms.md#the-repeating-escalating-prompt)) — without
  a small `justLogged` flag held in local component state, the entire
  panel (including this new prompt) would vanish the instant you log,
  before the prompt could ever be seen. `justLogged` is deliberately not
  persisted anywhere — losing it (by skipping, answering, or just
  navigating away) is harmless by design, matching "optional" in the
  strongest sense: there is nothing to come back to later.

## Open questions

These are unresolved — don't treat the absence of a decision as an
oversight to silently fix; surface it instead.

- **A piece that's already been rescheduled once via "cram it into what's
  left" while its own plan was already fully elapsed can permanently stop
  being recognized as behind schedule — and "Reschedule all" then silently
  drops it forever, even though nothing about it ever got fixed.** Found
  (not caused) while verifying the Pass 39 follow-up bulk-extend fix above,
  by testing against pieces that had genuinely been through the *old*
  "reschedule into current plan days" button while already past their own
  plan. Root cause: that button packs every remaining chunk onto what's
  effectively a single day (`asOfDay`, clamped to the plan's last day, since
  `availableDays` floors at 1 once you're past the plan). From then on,
  `computeScheduleStatus`'s "is this missed" test —
  `timeline.introducedDay[id] < currentDay` — compares that same clamped
  day to itself: `currentDay` (`getCurrentDay`, also clamped to the plan's
  length) can never exceed it, so the comparison is never strictly true,
  ever again, no matter how many more real days pass. `missedCount` reads
  `0` permanently. `planRescheduleForPieces` requires `missedCount > 0` to
  include a piece, so the piece silently stops qualifying for "Reschedule
  all" from that point on — invisible to the bulk button, though still
  fixable by opening the piece directly and clicking its own Reschedule
  button (that path checks `remainingChunkIds.length`, built from
  `doneDays`, not the broken `introducedDay`/`currentDay` comparison, so
  it's unaffected).
  - **Two-part fix proposed to the user; only the first part was asked
    for.** (1) Stop the trap from being created going forward — the
    single-piece dialog no longer offers "reschedule into current plan
    days" once a piece's target date has already fully passed (**built,
    see the decision above**), so no *new* piece can fall into this state
    via that path again. (2) Make "Reschedule all" itself resilient to a
    piece already stuck this way — for a piece whose plan has already
    fully elapsed, trust the simpler, unbreakable "real work is still
    untouched" signal (`remainingChunkIds.length > 0`, from `doneDays`)
    instead of the day-by-day comparison that can get permanently stuck at
    zero, rather than requiring `missedCount > 0` too. **The user chose
    part (1) only** ("just 1") — part (2) is unbuilt and this issue stays
    open until it (or some other repair) lands.
  - **Still reachable today** by any piece that went through the old
    "reschedule into current plan days" button while already past its own
    plan, before this session's part-(1) fix existed — including, found
    during this same testing, real pieces already sitting in this
    session's own local test data. Not urgent (the single-piece escape
    hatch still works), but a piece stuck this way will silently never
    reappear in a bulk reschedule until a human notices and opens it
    directly.
  - See [Algorithms.md](Algorithms.md#detecting-that-a-piece-has-run-past-its-plan)
    for `computeScheduleStatus`, and the three decisions immediately above
    this section for the fixes that did ship this session.
- ~~Should Revival's "performance tempo override" field move into Settings
  (reusing the piece's existing target tempo) instead of living at the top
  of the Revival tab, and should "tempo ladder starting point" move to
  revival setup time (Wizard/`RevivalEntryModal`) instead of only being
  editable from Revival settings after the fact?~~ **Resolved by Pass 35 —
  never cross-referenced back to close this entry until now.** Raised by
  the user during Pass 24's copy audit, deferred as out of scope for that
  pass. The first half is moot: `performanceTempo` was removed outright by
  Pass 35 (see the decision above), not relocated — there's no field left
  to move into Settings. The second half is exactly what Pass 35 did:
  `tempoLadderStartFraction` is collected at `RevivalEntryModal` (revival
  setup time) and stays editable afterward from `RevivalTab`'s "Revival
  settings" panel — see the Pass 35 decision above for the mechanics, and
  [Algorithms.md](Algorithms.md#revival) for how the field is read.
- **`RecordingsEditor` and `DocumentsEditor` generate each new row's id from
  `` `rec${Date.now()}` `` / `` `doc${Date.now()}` `` — millisecond
  resolution, so two rows added in the same millisecond would share an id.**
  Surfaced in code review of Pass 24 (which copied the pattern faithfully
  from the pre-existing `RecordingsEditor`, so this isn't new to that pass —
  just now in two places instead of one). Not currently reachable through
  normal clicking (the two add-buttons aren't rapid-fire in practice), and
  `updateDocument`/`removeDocument`/their recordings equivalents operate by
  array index, not by matching id, so a collision wouldn't corrupt data —
  the only consequence would be React's `key` prop misrendering the two
  rows if it ever happened. Low severity, narrow trigger; not fixed.
  Worth switching to a proper unique-id generator if a third list ever
  copies this pattern, rather than propagating it a third time.
- **Should a piece in maintenance get a genuinely forward-looking week, and
  therefore the due-in-N-days query that was scoped out?** Surfaced by
  Pass 22's week view (see the two decisions in [UX](#ux) above). Inside a
  bounded plan the week is fully populated, because `timeline.days[]`
  already holds every future day. Past the plan it structurally cannot be:
  `computeDueReviews` is strictly "due as of this date," so six of the
  seven cells can only say "not due yet." A learner in maintenance —
  which is the *long-term* state of every piece they finish — therefore
  gets a much thinner week than one still learning, exactly inverting who
  benefits from planning ahead.
  - **What it would take:** the forward-looking window deliberately ruled
    out when the maintenance query was built. That exclusion was not an
    oversight; the stated concern is that showing "due Thursday" invites
    practising it Wednesday, which is precisely the massed-practice
    behaviour spacing exists to prevent, and the ladder's due dates move
    as sessions are logged, so a week-ahead forecast is a projection that
    will often be wrong by the time it arrives.
  - **The narrower version worth considering first:** not a full forecast,
    but a count — "3 reviews expected in the next 7 days" — which conveys
    load without naming a day to practise early. Undecided whether even
    that crosses the line.
  - **Not started.** Recorded because the honest-but-thin maintenance week
    is the visible symptom of this, and a future pass looking at it should
    know the emptiness is a decision, not a bug.

- **Nothing prunes orphaned `piece.progress` entries after a piece edit, and
  it's undecided whether anything should.** Surfaced in Pass 20 while fixing
  the history crash (see [UX](#ux) above). Editing measures/sections/
  difficulty regenerates chunk ids, leaving progress entries that no longer
  match any chunk. Today they survive forever and Progress reports them
  honestly as "N passages from an earlier version of this plan" — but they
  also still count toward `allSessions` in the outcome breakdown and toward
  the practiced-days set feeding the consistency stat, which is arguably
  correct (the practice happened) or arguably double-counting against a plan
  that no longer contains it. **Deliberately not resolved in Pass 20**,
  which was a relocation pass: deciding this means deciding whether
  orphaned history is data to preserve, migrate onto the new chunks, or
  discard — a data-lifecycle question, and the discard option is
  irreversible. Not urgent; the visible behavior is already honest.
- **Gate revival entry behind a piece being in maintenance — blocked until
  "maintenance" is an actual mode.** Agreed in principle with the user
  (Pass 19 follow-up): the "Start revival" entry point should not be
  offered while a piece is still being learned. Revival would become
  reachable only once a piece is in maintenance; a piece finished away
  from the app would be moved into maintenance manually in Settings, and
  *that* transition would prompt the revival sequence — which is also what
  would place it on the Master Agenda under Revival.
  - **Why it's wanted:** starting a revival mid-learning currently puts a
    piece in a half-state. Master Agenda drops its learning card (the
    piece moves to the Revival subtab, losing its day-by-day detail),
    while the piece's own Today tab keeps showing the full learning plan
    unchanged — the suppression copy there only exists in the past-plan
    branch. So two surfaces disagree about whether that piece has daily
    work. Confirmed by manual verification (see the `isInRevival` decision
    above).
  - **What blocked it, and what changed (Pass 39):** "learned" *is* now
    both defined and queried — `isPieceLearned(piece, chunkSet)`
    (`src/lib/ladder.js`) computes "is every chunk at Holding" for real, no
    longer just prose (see
    [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented)).
    That resolves the *technical* blocker named here. What's still
    missing, and still blocks this specific item: `isPieceLearned` is a
    live derivation, not a first-class *persisted* piece state — nothing
    writes a `piece.stage`/`piece.mode` field a Settings control could set
    manually, which the "a piece finished away from the app would be moved
    into maintenance manually in Settings" half of this design explicitly
    needs. Wiring the gate itself, and that manual Settings control, were
    not in scope for Pass 39 (which built the rollup for a different
    reason — see [Scheduling](#scheduling) — not for this item) and remain
    unbuilt. This is queued **behind** that remaining piece, not alongside
    it.
  - **Three existing behaviours it must reconcile, none of which are
    oversights:**
    1. The Wizard deliberately allows starting a piece *directly* in
       revival, for pieces learned before the user ever had this app — see
       the decision on that in [Revival](#revival) above. A strict gate
       breaks that path; the manual-Settings-transition idea is the
       proposed replacement for it, and needs to actually cover that case.
    2. Auto-trigger 3 (60+ days since anything was logged,
       `computeRevivalTriggers`) fires for a piece *abandoned* mid-learning
       — precisely the state a gate would forbid. Either the trigger stops
       firing there, or the gate admits an exception.
    3. Auto-triggers 1 and 2 read run-through data (stop count, chunks
       flagged lost), which implies some learning already happened but not
       necessarily completion.
  - **Not started.** Recorded so the gate is designed *with* the
    maintenance-mode work rather than bolted on afterwards.

- **`piece.revival` is restored all-or-nothing on load, unlike
  `ladderConfig` — the same shape-gap that caused a documented P1 crash.**
  `validateAndMigratePiece` (`lib/storage.js`) does
  `revival: piece.revival || { …defaults }`, so a saved piece carrying a
  *partial* revival object never gets its missing sub-fields filled in.
  This is precisely the pattern `mergeLadderConfig` exists to fix for
  ladder settings ("a missing `bpmSteps` throws on the very next logged
  session — a real crash on real already-saved data"), and revival was
  never given the same field-by-field treatment. Surfaced in review of the
  Pass 19 follow-up above, because that change made `isInRevival` (and
  therefore `computeDueReviews`) read `revival.active` where the
  maintenance query previously read `revival.startedAt` — so for a piece
  carrying only one of the two, suppression behaviour changes. Normal use
  never produces that shape (both fields are set and cleared together), so
  this is reachable only via externally-produced data: a hand-edited
  backup, or a piece written by an app version predating one of the
  fields. **Not fixed** — it's migration code touching every saved piece,
  and the safe fix (mirror `mergeLadderConfig`) deserves its own pass with
  its own verification rather than being folded into a UI change.
- **Graduation's tempo-floor check uses `practiceBPM` from *before* the
  current session, even when that same session's demonstrated-tempo
  override (see [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder))
  would clearly clear the floor.** Found in code review this session, via
  direct reproduction (`practiceBPM` jumping 50→100 against a Settling-stage
  70 floor: `practiceBPM` after the call is correctly 100, but
  `graduated: false` and the pass isn't counted — the floor check ran
  against the stale pre-jump 50). Not corrupting: the chunk just graduates
  one session later than it ideally should, and self-corrects next
  session. Deferred rather than fixed immediately — narrow trigger
  (requires Settling/Holding stage, where a floor exists at all, plus a
  same-session demonstrated-tempo jump), and fixing it means deciding
  whether `clearsStageFloor` should read the *post*-override `practiceBPM`
  within the same `computeLadderAdvance` call, which touches the ordering
  of an already-dense function (`lib/ladder.js`) — worth a deliberate pass,
  not a quick patch. **Re-reviewed in Pass 14 and deliberately left open,
  the user's explicit call:** the one-session delay self-corrects on the
  next logged session, and reordering that function preemptively carries
  more risk than the symptom warrants. Revisit if it actually shows up in
  real use.
  - **Re-reviewed a third time after Pass 59 (the tempo ratchet), same
    conclusion.** Pass 59's overlearning bonus (see
    [Spaced repetition & maintenance](#spaced-repetition--maintenance)
    above) can trigger this exact same symptom through a second path — a
    bonus-driven same-session jump that crosses a stage's tempo floor
    doesn't get graduation credit either, confirmed by direct
    reproduction (50→73 against Settling's 70 floor: `practiceBPM` is
    correctly 73, but `graduated: false`, the pass uncounted). Presented
    to the user directly as a choice (fix the ordering now vs. leave it)
    rather than assumed either way; **the user chose to leave it**, same
    reasoning as the first two reviews. Two trigger paths now
    (`computeDemonstratedTempoBaseline` and the overlearning bonus), one
    fix, still not applied.
- ~~**A full session undo doesn't revert `currentBPM`.**~~ **Resolved
  (Pass 14)** — see the dedicated decision in
  [Spaced repetition & maintenance](#spaced-repetition--maintenance) above.
  `currentBPM` is now captured in `ladderSnapshot` and restored on undo.
- **Should `computeConfidence` and `computeProgressTier` be unified?** They
  currently measure different things (weighted session history vs. the
  spaced-repetition ladder's `stage`, as of Pass 6 — see
  [Decisions.md](Decisions.md#spaced-repetition--maintenance)) and can
  still disagree. It's not decided whether that's intentional (Overview
  wants something coarser) or drift that should be resolved. See
  [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them).
- ~~**Exact placement of the Analytics panels once folded into Progress**~~
  — **Resolved (Pass 20)**: pinned down and built. See the dedicated
  decision in [UX](#ux) above for the exact panel order and why.
- **Should Progress's velocity-based "projected finish" stat (`ProgressTab`,
  `projectedDay`) ever show a real calendar date instead of staying in
  day-number terms?** Still open — day-number was chosen as the safer
  default when the Progress redesign shipped. Note this is now inconsistent
  with the Wizard's Timeline step, which *does* work in real calendar dates
  (`piece.targetDate`, an estimated finish date in "minutes per day" mode —
  see [Algorithms.md](Algorithms.md#timeline--scheduler)); worth revisiting
  whether Progress should follow suit for consistency.
- **Is a single Tier 1 touch enough**, or does a chunk need a second short
  rung before Stabilizing's first real review reliably survives? Gated on
  fail-rate data once built, not decided preemptively. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#introduction-window-review-scheduling-tier-1--tier-2).
- **How does maintenance surface in the UI** — folded into Master Agenda
  and the per-piece Today tab (most likely), a new tab, or something else?
  Not designed; also has a real data-plumbing consequence (a live
  "what's due" query replacing `timeline.days[]` indexing) that isn't
  designed either. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#explicitly-not-designedbuilt-here).
- **On an exact `updatedAt` tie during import merge, ladder state and
  status/BPM/confidence resolve in opposite directions.** Found in code
  review after Pass 13 shipped `diffImportedPiece` (see
  [Data model](#data-model) above). `preferByRecency` (governing
  `piece.status` and a chunk's `currentBPM`/`targetBPM`/`manualConfidence`)
  treats "import is strictly newer" and "exactly tied" the same way — both
  take the not-stale branch, so a tie silently prefers the import.
  `diffImportedPiece` (governing ladder state) treats a tie as genuinely
  ambiguous — it either surfaces the picker (if the two sides' ladder state
  actually differs) or defaults to keeping the existing side. So the same
  merge, on the same tied timestamp, can silently prefer the import for one
  field family and default to "keep what's here" (or ask) for another.
  Deliberately not fixed same-session: reachable only when both sides carry
  the literal same millisecond `updatedAt` — in practice this needs either
  hand-crafted data or two saves landing on the exact same instant, not
  something normal use is expected to hit — and reviewed live with the
  user, who judged it not worth chasing given how narrow the trigger is.
  Worth unifying if `preferByRecency` and `diffImportedPiece` are ever
  revisited together, rather than independently again.
- **`hasClimbingTempo` (Pass 30) can silently miss a real climb if a
  session's `bpm` is `NaN`.** Found in critical review after the pass
  shipped, not fixed. The function's `typeof s.bpm === "number"` guard lets
  `NaN` through (`typeof NaN` really is `"number"`), and `NaN` comparisons
  are always `false` — so a `NaN` landing at the start or end of the
  trailing window can neither register as a dip nor contribute to a real
  rise, silently suppressing the marker rather than showing a false
  positive. Not reachable through the app's own UI (`NumberInput` never
  commits a non-numeric BPM), only through hand-edited or corrupted
  `localStorage` data. Wrong-but-conservative, not wrong-and-misleading; not
  urgent, but worth a defensive `Number.isFinite` check if this function is
  touched again.
- **The tempo-climbing marker (Pass 30) doesn't know about a pending
  provisional session (Pass 29 follow-up) on the same chunk.** Found in the
  same review. `hasClimbingTempo` reads `loggedSessions`, which correctly
  excludes an unconfirmed provisional — but that means a chunk can show
  "tempo's climbing, try faster" while an unresolved rough attempt sits
  right there in its history, and if the learner later confirms that
  attempt, the "climbing" read could flip false immediately. Neither
  feature is wrong on its own; they just don't cross-reference each other.
  Not currently visible together on one screen — `PieceMapTab`'s
  chunk-detail modal (where the climbing suggestion shows) doesn't surface
  provisional confirm/discard UI at all, that's `ChecklistItem`-only — so
  the practical exposure is narrow today, but worth knowing about before
  either feature is extended.
- **The broadened piece-save effect (Pass 29 follow-up — see the
  persistence-bug fix above) re-writes every piece to `localStorage` on any
  single piece's change, not just the one that changed.** Untested at
  scale: fine for the handful of pieces one musician realistically has
  open, unverified against a large piece count or a piece with a very long
  session history. Not a correctness question, a performance one — worth
  measuring if it's ever revisited, but not urgent enough to have gated
  landing the correctness fix itself.
- **Settings' "Save changes" isn't gated on piece name or total measures
  being present/non-zero, the way the Wizard's "Next" already was before
  this session and still is.** Surfaced while adding the work-title
  requirement to both surfaces (see
  [Multi-movement works](#multi-movement-works)) — that fix only closed the
  one gap it was asked to close (a blank work title while "Multiple
  movements" is selected); it didn't touch, and this session wasn't asked
  to touch, whether Settings should also require the fields the Wizard
  already treats as mandatory. Not urgent (clearing a piece's name or
  measures in Settings isn't a normal editing action, and nothing currently
  demonstrates a user actually hitting this), but a real, asymmetric gap
  between the two surfaces that
  [UX-Principles.md](UX-Principles.md#editors-are-shared-so-the-ui-cant-drift-from-itself)
  says to treat as a bug, not a stylistic choice. Not started.
- **Should Archive have its own path for a piece the learner has genuinely
  abandoned mid-plan, distinct from "the plan is done"?** Raised directly
  by the user while gating Archive behind `isPlanActuallyComplete` (see
  [Lifecycle](#lifecycle)) — that gate has no way to distinguish "not done
  yet, still working on it" from "not done, and never going to be." Pause
  is the only thing available today for the second case, and its own
  copy ("set aside for now") doesn't match that intent. Two directions
  raised, neither decided: give Archive its own "abandon this" path
  distinct from plan-completion, or lean on Pause as the real answer and
  fix its copy/semantics to say so explicitly. Not started.
- **The "(behind N chunks)" note and graying on Overview's first-week list
  (Pass 45, `classifyDayCompletion`) aren't revival-aware.** A piece that's
  both mid-revival and behind on its *original* (pre-revival) schedule
  still shows this note and graying against that original plan — not the
  revival plan actually being followed. See [UX](#ux) for the mechanism.
  Not a new problem on its own (`ScheduleBanner` already surfaces original-
  plan "behind schedule" messaging during revival today), but this adds a
  second surface carrying it — **and since Pass 46, a third: the Timeline
  tab's own past-day graying/check mark reuses the same
  `classifyDayCompletion` call.** Worth deciding whether any of these
  surfaces should suppress itself during revival, or whether all of them
  referencing the original plan is actually fine since revival doesn't
  replace that history. Not started.
- **A consolidation day's logged run-through doesn't satisfy
  `classifyDayCompletion`'s (Pass 45) per-chunk check.** The consolidation
  day's `reviewChunkIds` lists every practice chunk, but
  `handleLogRunThrough` only writes the synthetic `"__consolidation__"`
  progress entry, never each chunk's own `doneDays` — so a logged
  consolidation day still classifies as "behind" on Overview's first-week
  list, and, **since Pass 46, on Timeline too.** See
  [Algorithms.md](Algorithms.md#behind-schedule-detection) and
  [UX](#ux). Fixing it means deciding whether `classifyDayCompletion`
  should also accept `"__consolidation__"`'s `doneDays` as satisfying a
  consolidation day's practice-chunk ids — not decided. Not started.
- **Should section-pair run-throughs (`kind: "section-transition"`,
  "Sections combined") get the same repeating due/locked-preview gate
  single-section run-throughs got in Pass 49, once a pair first unlocks?**
  Explicitly flagged rather than guessed at when the repeating gate was
  built — the pass's own scope named single-section run-throughs
  specifically. Left as the original one-time "unlock once every chunk in
  the whole piece has a session, then stay available forever" gate. Case
  for leaving it: a section-pair run-through is already a late-stage,
  whole-piece-touched drill, not an early check-in, so "repeat forever"
  may just be noise there in a way it wasn't for the early, per-section
  case. Case for extending it: consistency — a learner who came to expect
  the repeating check-in rhythm from single sections might reasonably
  expect the same from combined ones. Not started. See
  [Algorithms.md](Algorithms.md#section-run-throughs) and
  [Scheduling](#scheduling) (Pass 49 decision).
- **`ChecklistItem`'s tab order still isn't literally reps → BPM → Log,
  even after Pass 53's fix.** Pass 53 fixed the severe symptom — a
  disabled Log button gets skipped entirely in the browser's tab
  computation, so tabbing from BPM could overshoot straight into the next
  card's controls — by gating the button on draft state instead of
  committed state, so it's enabled well before any tabbing happens.
  Confirmed live that this closes the "escapes to the next card" failure.
  What it doesn't close: the "+ Add a note" button and the "Needs more
  work" checkbox, both unconditionally enabled, still sit between the BPM
  field and Log in DOM order, so two extra tab stops remain — the actual
  order is BPM → note button → checkbox → Log, not BPM → Log directly.
  Three fixes were considered and rejected, each for a real cost: manual
  `tabIndex` values break globally across every other `ChecklistItem` on
  the page (positive tab indices are visited page-wide before any default
  one); reordering the DOM to put Log first would also move it visually,
  changing the card's layout, which wasn't asked for; giving those two
  controls `tabIndex={-1}` would fix the sequence but make them permanently
  unreachable by keyboard, an accessibility regression nothing asked for
  either. Not started — a product call on whether strict adjacency is
  worth one of those costs, not a technical gap.
- **What "a chunk in tempo maintenance mode stops counting toward the plan
  being not done yet" actually means is genuinely undefined (Pass 60).**
  The user has said explicitly they'll define this once they reach it —
  not guessed at here. `isInTempoMaintenance` (`lib/ladder.js`) is
  deliberately not wired into `isPieceLearned` or `isPlanActuallyComplete`
  regardless of what this turns out to mean. The most likely candidate
  when it is resolved, per the user: Pass 30's "tempo climbing" nudge
  (`hasClimbingTempo`, `lib/confidence.js`) — a chunk in maintenance mode
  has, by definition, already climbed as far as it currently needs to, so
  that nudge no longer applies to it. See
  [Spaced repetition & maintenance](#spaced-repetition--maintenance) (Pass
  60 decision).
- **(Pass 61) Holding's retired tempo-floor config fields are still live,
  editable, and silently inert.** `ladderConfig.holding.tempoFloorStartFraction`/
  `tempoFloorStepFraction`/`tempoFloorCapFraction` are still part of the
  saved schema and still exposed, correctly labeled, under
  `LadderConfigEditor`'s "Holding" heading — but `clearsStageFloor` no
  longer reads any of them for Holding. A user can "tune" a setting with
  zero effect and get no indication it's inert. Not started — neither
  `storage.js`'s config defaults nor `LadderConfigEditor.jsx` were in Pass
  61's Touches list for removal, and removing a saved/editable config
  field is a bigger, more deliberate call than this pass was scoped to
  make unilaterally. See
  [Spaced repetition & maintenance](#spaced-repetition--maintenance) (Pass
  61 decision).
- ~~`countBehindDays`'s "N days behind" figure doesn't know about Pass 48's
  "fully swept into a reschedule" collapse, so it can cite a stale count
  immediately after a reschedule.~~ **Resolved the same session, once
  asked for directly.** `isDayFullySwept` (`lib/scheduling.js`) now shares
  the identical rule `TodayTab`/`TimelineTab`/`DayChecklist` already
  applied locally, and `countBehindDays` excludes a fully-swept day from
  its count instead of citing it as still behind — a piece that's just
  been rescheduled now correctly shows no banner at all, rather than the
  same stale "N days behind" it read before the reschedule. **Follow-up in
  the same session, from a critical self-review before commit:** those
  three components' own local `isMovedId`/`isFullySwept` closures — until
  then left as independent, unrefactored duplicates of the exact rule
  `isDayFullySwept` was extracted from — were replaced with direct calls
  to the shared function, so the "is this day swept" rule now has exactly
  one implementation instead of four. Re-verified manually across all
  three rendering paths (Timeline's day cards, Today's single-Day view,
  Today's "All Tasks" view) both before and after a reschedule; `npm run
  build` and the full test suite stayed green throughout. See
  [Scheduling](#scheduling) (Pass 74 decision, same-session follow-up) and
  [Algorithms.md](Algorithms.md#rescheduling) (Pass 74 note) for the
  mechanics, and
  [Behind-schedule detection](Algorithms.md#behind-schedule-detection) for
  `classifyDayCompletion`'s own still-open, unrelated gap (a logged
  consolidation-day run-through) that this did not touch.
- ~~`isDayFullySwept` only checks the *current* (most recent)
  `rescheduleMarker`, never its `previous` chain — so a chunk relocated by
  an *earlier* reschedule and then genuinely completed before a *later*
  one leaves its original, pre-first-reschedule day un-collapsed.~~
  **Resolved the same session, once the user directly asked whether it
  could be.** Originally logged here as a design question rather than a
  mechanical fix, since the obvious fix (walk the whole `previous` chain,
  checking every past marker) is a real architectural choice, not
  something to make unilaterally. The user's follow-up question — is
  walking the whole history really the most efficient option, especially
  once a piece has been rescheduled many times? — led to a materially
  better fix instead of the originally-proposed one: rather than asking
  "was this id ever swept by *any* past reschedule," `isMovedId` now asks
  a simpler, marker-history-free question — has this id been done on some
  day *other* than the one being checked? That's a single `doneDays`
  lookup, O(1) regardless of reschedule count, and it's a strict
  improvement over chain-walking, not just a faster equivalent: it also
  catches a chunk logged ahead of schedule with **no** reschedule
  involved at all, which walking the marker chain never would have.
  Verified equivalent-or-better by direct reasoning (walking the chain can
  only ever find an id in some past marker's `remainingChunkOrder` when
  that id is *currently* done — `remainingChunkOrder` always includes
  every untouched chunk, so "in an old marker's list but not the new one"
  reduces exactly to "now done") — not just asserted; see
  [Algorithms.md](Algorithms.md#rescheduling) for the reduction spelled
  out in full.
  - **A second, real bug found while building this fix, not shipped:**
    naively applying "done elsewhere" to every id on a day — including
    `reviewChunkIds` — would have misread nearly every genuine, still-open
    Tier 2 review as stale. A chunk under review always has *some* prior
    `doneDays` (that's why it's due for review again), almost never
    including that specific review's own day until actually logged, so
    the same check that correctly catches a stale introduction would have
    incorrectly swallowed a live review into "Tasks rescheduled" too.
    Caught by deliberately writing a regression test to probe exactly
    this shape before considering the fix done — confirmed failing
    against the naive version, confirmed passing once the check was
    scoped to `newChunkIds`/`specialChunkIds` only. Reviews were never
    tracked by `remainingChunkOrder`/`remainingConnectorIds` to begin
    with (Tier 2 placement is a wholly separate mechanism), so excluding
    them here isn't a workaround — it's the check correctly staying
    within the boundary of what a reschedule marker was ever meant to
    describe.
  - **Verified:** two new regression tests confirmed to fail without the
    fix and pass with it (the original "done elsewhere" gap, and the
    two-reschedule scenario), plus two more guarding against
    over-collapse (a chunk done exactly on the day being checked; the
    review-scoping case above) — full suite green (585 tests). Manual,
    in-browser: rebuilt the exact two-reschedule scenario (reschedule once,
    log the relocated chunk on its new day via direct state — clicking
    through 15 remaining chunks isn't necessary to reach this state, only
    the one that matters — reschedule again by constructing the chained
    marker the same way `handleReschedule` would) and confirmed the
    chunk's original day now reads "Tasks rescheduled" consistently across
    Timeline, Today's Practice (both Day view and Week view), and Master
    Agenda — where, before this fix, it would have shown the chunk as a
    still-open task in all four.
  - See [Algorithms.md](Algorithms.md#rescheduling) for the full mechanism
    and the code-level comment explaining the review-scoping guard.
- ~~A review sitting on a past, unaddressed day reads as an open task
  there forever — and this turns out to have nothing to do with
  rescheduling.~~ **Resolved the same session, once the user directly
  asked to come back and build it.** Originally flagged (Pass 75) per its
  own instruction to confirm before writing any review-specific code;
  confirming it led to a real, investigated finding, not just a restated
  question, and was deliberately deferred as its own scoped effort rather
  than folded into Pass 75. Full history below, kept intact since the
  investigation is what made the eventual fix small and correct.
  - **What was asked, and what it actually turned out to be:** the pass
    offered two readings — (a) the original report was really about a
    transition/combo loosely called "review" (already covered, nothing to
    build), or (b) a genuine Tier 2 review's own scheduled placement
    should become reschedule-*relocatable*, the same way an un-started
    chunk now is. Neither was quite it. The user's own framing, once
    asked directly, was narrower and more accurate: a review that's
    overdue shouldn't just sit on its original day looking like a
    still-open task once it's *also* being tracked live elsewhere —
    "just stop showing it as stale," not "physically move it."
  - **Why even that turned out bigger than it looked:** tracing
    `computeTimeline`'s Tier 2 placement (`lib/scheduling.js`) shows this
    isn't reschedule-specific at all. A review's placement day comes from
    `daysBetweenInclusive(piece.startDate, entry.nextDueDate)` — a live
    calendar date converted to a plan-day number — computed fresh on
    every render, with or without any `rescheduleMarker`. If that date has
    already passed, the review sits on that (now past) day exactly as
    described, whether or not a reschedule ever happened; `computeTimeline`
    has no concept of "today" at all, so it has no way to know the
    placement is stale. Meanwhile `computeDueReviews`/`mergeLiveDueReviews`
    (Pass 66, `lib/maintenance.js`) already surfaces the exact same review
    as due, live, on today's screen — de-duplicated only against *today's*
    own bounded-timeline slot, never against the old day it originally
    sat on. So the same review can genuinely show twice: once, correctly,
    as live and actionable today; once, statically, as an apparently
    still-open task on whatever day it first became due, with nothing
    connecting the two. Rescheduling is just one way a learner would
    notice this, not the cause.
  - **Why building it touches more than two files, but not the "late
    review is fine" principle:** the fix had to reach every surface that
    renders a past day (Timeline, Day view, Week view, Master Agenda,
    Overview's first-week list), not just Pass 75's two files. It does
    *not* contradict "a review arriving late is schedule slack, never a
    failure" (`DueReviewPanel`'s own copy) — that principle is about the
    *ladder* never penalizing lateness, which this doesn't touch at all;
    what's fixed here is purely a display duplicate, and the review stays
    exactly as available, unpenalized, and logged from today's live list
    as it always was.
  - **The fix:** `withLiveReviewStatus(timeline, piece, realCurrentDay)`
    (`lib/scheduling.js`) is applied once, centrally, to whatever
    `getEffectiveTimeline` already produced — at its two real call sites
    (`App.jsx`, `MasterAgendaTab.jsx`) — rather than as a per-surface
    check. Every consumer of `timeline.days[]` gets the corrected
    `reviewChunkIds` for free: a review not logged on its own placement
    day, before real "today", is pulled out and reported separately as
    `day.staleReviewIds`, so the four rendering surfaces that already had
    an "explain what happened to this content" precedent
    (`isDayFullySwept`'s "Tasks rescheduled") could each add a small
    "Now due — see today" / "Already due — see Today's Practice" note
    instead of the item just vanishing unexplained. Overview's first-week
    list needed *no* code change at all — it already just reads
    `reviewMeasures` off `reviewChunkIds`, so it automatically stops
    counting a stale review without a special note (a smaller, and
    arguably better, resolution than adding a fifth copy of the same
    wording, discussed and left as a deliberate asymmetry rather than
    something to chase for consistency's own sake).
  - **A real bug found and fixed before shipping, not shipped as scoped:**
    the first version of the check only asked "has this id been done on
    some day other than this one" — which also caught, and wrongly pulled,
    every Tier 1 "first touch" review (placed for a chunk that's *never*
    been logged at all, per `computeTimeline` above). Reproduced live: a
    fresh 16-measure, 4-chunk piece showed every never-touched chunk's
    Tier 1 review vanish, mislabeled "Now due — see today" — but
    `computeDueReviews` requires `entry.nextDueDate` to surface anything
    live at all, and a Tier 1 chunk never has one, so nothing was actually
    there to point to. Fixed by requiring `entry.nextDueDate` truthy
    before considering an id stale — a Tier 2 review always has one by
    construction (`computeTimeline`'s own placement gate), a Tier 1 review
    never does, so this cleanly separates the two without needing to know
    which tier placed a given id.
  - **A second guard, carried over from the investigation rather than
    found fresh:** consolidation days blanket `reviewChunkIds` with every
    practice chunk regardless of ladder state — a different mechanism
    entirely (the synthetic `"__consolidation__"` progress key) that
    happens to reuse the same field name. Mirrors `mergeLiveDueReviews`'s
    own identical skip for the same reason.
  - **Verified:** 6 new regression tests (`withLiveReviewStatus` describe
    block, `test/scheduling.test.mjs`), including dedicated ones for both
    bugs above — each confirmed to fail without its guard and pass with
    it, not just written and trusted. Full suite green (592 tests), clean
    build. Manual, in-browser: built a real 16-measure/4-chunk piece,
    injected one chunk (`c1`) with a genuine Tier 2 ladder state
    (`nextDueDate` several days past, matching a real logged-then-overdue
    chunk) alongside three never-touched chunks (each carrying their own
    Tier 1 first-touch review) — confirmed only `c1`'s review was pulled
    (all three Tier 1 reviews rendered normally, real content, unaffected)
    across all four touched surfaces (Timeline, Today's Practice Day
    view + Week view + "All Tasks", Master Agenda's date-browsed card),
    and confirmed `c1`'s review still correctly appeared live on today's
    own screen with its real overdue count ("Next review was due 12 days
    ago").
  - See [Algorithms.md](Algorithms.md#rescheduling) for the mechanism and
    [Scheduling](#scheduling) (Pass 75 decision) for where this was first
    scoped out.
