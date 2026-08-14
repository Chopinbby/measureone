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

**Decision: a real fail costs `practiceBPM` the same 2 BPM as a soft-miss
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

## UX

**Decision: Piece Map chunk detail opens as a real modal, not inline below
the grid.**

- **Why:** The inline version put detail below the fold, making it
  effectively invisible without scrolling — a real usability bug, not a
  style preference.
- See [UX-Principles.md](UX-Principles.md#detail-on-demand-uses-a-real-modal-not-inline-expansion).

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
  (Shaky/Rough/OK/Solid/Rock solid → 0/25/50/75/100), which is exactly what
  the brief's "sets a new current confidence baseline, separate from the
  historical log" requirement already describes. See
  [AI-GUIDELINES.md](AI-GUIDELINES.md#prefer-extending-existing-systems-over-creating-parallel-systems).
- **Alternative considered:** a new `progress[id].revivalConfidence` field
  on a literal 0-4 scale. Rejected — would have created a third "how good is
  this chunk" score alongside `computeConfidence` and `computeProgressTier`,
  which [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)
  already flags as an unresolved problem, not a pattern to repeat.

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

**Decision: during an active revival, `piece.revival.performanceTempo`
overrides even an explicit per-chunk `targetBPM`, not just the piece-wide
default.**

- **Why:** A performance tempo collected at revival entry represents a
  deliberate, current intent (e.g. "this needs to be 120 for the recital")
  that should supersede tempos set while first learning the piece, even
  where a chunk already has its own explicit target from that earlier
  phase. See `getRevivalTargetBPM` in [Algorithms.md](Algorithms.md#revival).

**Decision: allow starting a piece directly in revival mode from the Wizard,
not just from an existing piece via the Overview dashboard.**

- **Why:** Not every piece a musician wants to track was originally learned
  *through this app* — someone might want to add a piece they learned years
  ago and haven't touched since, without pretending to "learn it fresh"
  first. A toggle on the Wizard's final Review step lets Setup run
  normally (still required — revival planning reuses `generateAllChunks`/
  `effort`) and then opens the revival entry modal on completion instead of
  landing on Overview.
- **Why this didn't need new machinery:** `RevivalTab`'s reassessment flow
  already only reads `piece.progress`, which is empty for a new piece by
  default — "zero sessions logged" was already a valid starting state, not
  a special case to build for.

## Lifecycle

**Decision: pause/archive (`piece.status`) is a manual, user-set toggle with
no automatic transitions — not a computed "this piece is learned" state.**

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

## Documentation

**Decision: fold the standalone `measureone-context-summary.md` (previously
kept outside the repo, in a local Downloads folder) into this `docs/`
directory rather than keeping it as a separate, un-tracked file.**

- **Why:** Product-decision history that lives outside the repository is
  invisible to anyone (human or AI) working from the repo alone, and is one
  lost file away from disappearing entirely. Its content now lives here (this
  file) and in [Roadmap.md](Roadmap.md); nothing from it should be treated as
  living only in that external file going forward.

## Open questions

These are unresolved — don't treat the absence of a decision as an
oversight to silently fix; surface it instead.

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
- **A full session undo doesn't revert `currentBPM`.** `currentBPM` (last
  actually-played tempo, distinct from the ladder's `practiceBPM`) isn't
  one of the six fields `ladderSnapshot` captures, by original design (see
  the "session undo should fully reverse the ladder" entry below — "six
  small fields" was deliberate, not an oversight at the time). Found as a
  real consequence in this session's review: after undoing a chunk's only
  session, `stage`/`practiceBPM`/`sessions` all correctly read as
  untouched, but `currentBPM` still holds the undone session's value, and
  `computeAutoConfidence` reads it directly — so a fully-reverted chunk can
  still show a nonzero confidence score. Deferred, not fixed: reverting it
  would need either a 7th snapshot field or a decision that `currentBPM`
  should just be derived from `sessions` (last session's `bpm`, or absent)
  rather than stored separately — the latter would remove the field
  entirely rather than patch around it, worth deciding deliberately.
- **Should `computeConfidence` and `computeProgressTier` be unified?** They
  currently measure different things (weighted session history vs. the
  spaced-repetition ladder's `stage`, as of Pass 6 — see
  [Decisions.md](Decisions.md#spaced-repetition--maintenance)) and can
  still disagree. It's not decided whether that's intentional (Overview
  wants something coarser) or drift that should be resolved. See
  [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them).
- **Exact placement of the Analytics panels once folded into Progress** —
  agreed in general terms ("near effectiveness calibration, somewhere
  unobtrusive") but never pinned down. See [Roadmap.md](Roadmap.md).
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
