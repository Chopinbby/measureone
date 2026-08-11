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
  fixed — see [Data-Model.md](Data-Model.md#known-simplifications).

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
  [Algorithms.md](Algorithms.md#deriving-daystolearn-from-minutesperday-scheduleMode-minutes).
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

**Status: the stage-math engine, Tier 1/Tier 2 review scheduling, and
post-run-through logging (stop count + the rough/lost flag mode) are built
and live (Passes 1–6); a live "what's due" query beyond the current plan's
bounded length and Revival's auto-triggers off that logged data are still
designed, not built (Pass 7).** Full design:
[Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built](Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built).
Evidence behind several choices below: [Research.md](Research.md).

**Decision: "learned" is redefined as every practice chunk's
spaced-repetition ladder card reaching Holding, not a calendar date
(`daysToLearn` running out).**

- **Why:** Closes the long-standing gap flagged in
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented) —
  nothing previously rolled per-chunk state up into a piece-level "done"
  milestone. A piece that consolidates fast now genuinely graduates fast;
  one that doesn't, doesn't, regardless of what the original plan guessed.
- **Consequence:** `computeProgressTier` and `computeConfidence` are
  unaffected — this doesn't resolve which of the app's "how good is this
  chunk" signals is canonical, it just defines a separate, piece-level
  "done" condition on top of whichever chunk-level signal(s) end up
  mattering.

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
  section of [Algorithms.md](Algorithms.md#deriving-daystolearn-from-minutesperday-scheduleMode-minutes)).
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

**Decision: revival gets three independent, separately-checked auto-trigger
conditions (stop count > 5 on a run-through; a combo or 2+ regular chunks
flagged lost in one run-through; 60+ days since anything logged) rather
than one unified formula.**

- **Why:** Conditions 1 and 2 can only fire if a run-through was actually
  attempted and logged. A piece nobody's touched in two months has no data
  to trip those even though it would almost certainly meet them if
  attempted — condition 3 is a distinct fallback for exactly that case,
  not a diluted version of the other two. Unifying them into one formula
  would hide that a piece can fail this test for a reason none of the
  logged-data conditions can see.

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
will eventually feed is Revival's separate stop-count/lost-flag
auto-trigger conditions above, once Pass 7 wires the check itself in —
a different mechanism from combo escalation.

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

- **Why:** [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built)
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
  reassessment (see Data-Model.md's known simplifications).

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
  [Data-Model.md](Data-Model.md#known-simplifications).

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
  (`ensureWorkId`), same as any other edit.
- **Alternative considered:** matching by id only. Rejected on its own — the
  fallback name+composer match matters too, e.g. a piece shared from another
  device/session that never had the chance to collide on id but is
  obviously "the same song."

**Decision: on import, a chunk's ladder state (stage, consecutive-pass
streak, current practice tempo, next review date) always keeps the
existing piece's value over the imported one, rather than picking
whichever is actually more advanced.**

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
- **Known issue, deliberately deferred: this is a blunt rule, not real
  conflict resolution.** It fixes the common case (re-importing an older
  copy of the *same* piece) but "existing always wins" is wrong for the
  opposite case — restoring a backup that's genuinely more advanced than
  what's on this device (e.g. importing from a second device practiced on
  more recently). In that case the import's more-advanced state is
  silently discarded instead, still with no warning shown either way. The
  correct fix needs the app to actually know which side is ahead — most
  likely by rebuilding ladder state from the merged, deduplicated session
  history (`sessions` already merges correctly today) rather than
  trusting either side's stored snapshot outright — and/or a real
  "choose which history to keep" step shown to the user when both sides
  have genuinely diverged, instead of a silent rule in either direction.
  Not built; planned for a later pass.

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

- **Should `computeConfidence` and `computeProgressTier` be unified?** They
  currently measure different things (weighted session history vs.
  most-recent-session rep count only) and can disagree. It's not decided
  whether that's intentional (Overview wants something coarser) or drift
  that should be resolved. See
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
- **Import/backup merge conflicts are resolved by a fixed rule, not a real
  user choice.** When both the existing piece and an imported backup have
  progress on the same chunk, ladder state (stage, tempo, next review
  date) always keeps the existing value — correct for the common
  "re-importing an older copy of the same piece" case, silently wrong for
  the opposite one (restoring a genuinely more-advanced backup from
  another device). No warning is shown either way today. Planned fix: a
  "choose which history to keep" step surfaced to the user when the two
  sides have actually diverged, rather than a silent rule in either
  direction — not built yet. See [Data model](#data-model) above.
