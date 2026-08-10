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

**Status: designed, not yet implemented.** Full design:
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

**Decision: during the front-loaded introduction window, reviews split
into a near-mandatory Tier 1 (one-time, ~day 1) and a flexible Tier 2 (the
normal ladder cadence, allowed to roll later under budget pressure) —
lateness is schedule slack, never a review failure.**

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
  `practiceBPM` ratchets incrementally (+2 full pass / −2 soft miss / ~−8
  to −10 real fail) so tempo progress is graded against where the learner
  actually is, not the eventual goal.
- **Known open item, not decided:** whether the existing "how did it feel"
  effectiveness input survives as a separate input alongside the new
  pass/soft-miss/fail judgment — see Open questions below.

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
"Needs another look" panel. The "lost" flag mentioned below doesn't exist
yet (that's Pass 6, per the maintenance-ladder build order) — the
clearing behavior described was designed around that flag existing, but
what's built now (escalation itself) doesn't depend on it: escalation is
computed live from session history, so there's nothing to "clear" in the
first place — see the consequence note below.

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
  `adaptiveReviewOffsets` (`scheduling.js`) both read `outcome` now instead,
  via a shared `sessionOutcome()` helper that falls back to mapping old
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
  needs Tier 1/Tier 2 review scheduling — a later, explicitly deferred
  pass. Timestamp keying is buildable now without guessing at that
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
- **Does the "how did it feel" effectiveness input survive as a separate
  input once the spaced-repetition ladder's pass/soft-miss/fail judgment
  exists?** Leaning toward folding it into a single optional
  override-toward-fail, not locked in. Worth knowing this is a bigger
  behavior change than it sounds: today `ChecklistItem`
  (`src/components/tabs/today/ChecklistItem.jsx`) hard-gates the log
  button on it — `canLog = reps !== "" && bpm !== "" && !!feel` — so
  "make it optional" means removing a submit-blocking requirement, not
  just relabeling a field. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#session-outcomes-three-tiers-not-two).
- **Does the ladder's new rough/lost flag merge with the existing
  `progress[id].weakSpot`?** Both are manual "this chunk needs attention"
  flags with real overlap; not reconciled. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging).
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
