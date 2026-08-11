# Repertoire Lifecycle

> **Purpose:** Describe the full lifecycle a piece moves through — including the
> phases that don't exist yet — so new features get placed in the right phase
> instead of bolted onto whichever phase happens to be built already.
> **Audience:** Anyone planning "what happens after a piece is learned" work;
> future Claude Code sessions deciding where a new concept belongs.
> **Scope:** The lifecycle stages of a single piece, and how multiple pieces
> relate to the lifetime-repertoire vision. Not the day-to-day mechanics within
> the "active learning" stage — see [User-Flows.md](User-Flows.md) and
> [Algorithms.md](Algorithms.md) for those.
> **Related:** [Vision.md](Vision.md#long-horizon-vision) ·
> [Product-Principles.md](Product-Principles.md) · [Roadmap.md](Roadmap.md)
> **Update when:** A new lifecycle stage is built, or the definition of
> "learned" changes.

## Stage 1 — Setup

A piece enters the system through the Wizard: measures, sections, difficulty,
recurring material, a timeline or time-budget constraint, optional tempo
targets and reference recordings. See
[User-Flows.md](User-Flows.md#1-setting-up-a-new-piece).

## Stage 2 — Active learning

The built core of the product. Two phases within the plan itself:

- **Introduction** (first half of the learning days): every practice chunk
  in the piece gets introduced.
- **Consolidation** (back half): transitions, combos, and spaced review —
  see [Algorithms.md](Algorithms.md#timeline--scheduler).

Confidence per chunk rises and falls with logged practice throughout this
stage; there is no single moment the *piece* transitions out of "active
learning" — see the gap noted below.

## Stage 3 — "Learned" (defined; not yet implemented)

**Decided** (see [Decisions.md](Decisions.md#spaced-repetition--maintenance)):
a piece is "learned" once every practice chunk's ladder card has reached
Holding — the resting stage of the spaced-repetition ladder described in
Stage 4 below. This replaces the earlier informal, calendar-based reading
(implicitly, "the plan's `daysToLearn` ran out") with a consolidation-based
one: a piece that consolidates fast graduates fast, one that doesn't,
doesn't, regardless of what `daysToLearn` originally guessed. **Per-chunk
ladder state now exists and advances live** — `computeLadderAdvance`
(`src/lib/ladder.js`) is called from `handleLogSession` (`App.jsx`) on
every logged session (Pass 2/3 of the maintenance-ladder build). **What's
still not implemented** is the piece-level rollup itself: nothing yet
queries "is every chunk's `stage` at `holding`" to actually compute a
piece's "learned" flag — see
[Data-Model.md](Data-Model.md#known-simplifications).

`computeProgressTier` (buckets a chunk by its most recent session's
clean-rep count) and `computeConfidence` (continuous 0–100 score) are
unaffected by this decision and continue to answer their own separate
questions — see
[Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them).
Whether ladder stage becomes a third such signal, replaces one of the
existing two, or stays deliberately separate is **not decided** — flagged
there, not resolved here.

## Revival (built, MVP)

A recovery workflow for a piece that was learned once and has gone stale —
see [Decisions.md](Decisions.md#revival) and
[Algorithms.md](Algorithms.md#revival) for how it's built. Deliberately
**not** a new lifecycle stage: it doesn't require or set any formal "learned"
state (which still doesn't exist — see Stage 3 below), and it exits back to
whatever informal state the piece was already in. Practically, it slots in
after Stage 2 has produced *some* practice history worth reassessing, but
nothing enforces that.

Two entry points, both landing in the same reassessment flow:
- **Manually from the Overview dashboard**, whenever the user decides an
  existing piece needs it — the original entry point.
- **At piece creation**, via a toggle on the Wizard's final step ("Learning
  it fresh" vs. "I already know this piece"). Covers repertoire the user
  already knew before ever using the app — Setup still runs in full (a
  chunk structure is required regardless, since revival planning reuses
  `generateAllChunks`/`effort`), but completion opens the revival entry
  modal immediately instead of landing on Overview, so the piece starts in
  revival mode with zero practice history — reassessment works the same
  either way, since it only reads `piece.progress` (empty is a valid start).

Scoped deliberately narrow for this pass — explicitly **not** built as part
of it: Maintenance mode (Stage 4 below), Performance Preparation mode,
automatic lifecycle-state detection, cross-piece repertoire health
dashboards, or reading/memory/technical diagnosis tagging beyond the manual
weak-spot flag. Revival's weak-spot flag and memory anchors are the
lightweight, manual precursor to whatever that deeper tagging might look
like, not a replacement for it.

Automatic entry triggers (rather than manual-only, as today) are now
designed — see [Stage 4 → Revival auto-triggers](#revival-auto-triggers)
below.

## Pause / Archive (built)

A piece can carry `piece.status: 'active' | 'paused' | 'archived'`, set only
by the user from Settings ("Practice status") — never inferred. Both
non-active states pull a piece off the Master Agenda and suppress the
"behind schedule" banner (`computeScheduleStatus` forces `missedCount` to 0
whenever `status !== 'active'`); the piece and every other tab stay fully
reachable via the piece switcher, just no longer part of the daily rotation.

- **Paused** — for a piece mid-plan that the learner is deliberately setting
  aside. Nothing about the schedule or confidence math changes: the plan's
  days keep ticking by underneath, and `computeAutoConfidence`'s existing
  recency decay keeps fading untouched chunks exactly as it would for an
  active piece (there's no separate frozen/paused confidence path — see
  [Algorithms.md](Algorithms.md#confidence)). Resuming (back to `active`)
  simply lets the schedule banner reappear if chunks are now genuinely
  behind; the existing reschedule flow handles that the same way it always
  has.
- **Archived** — for a piece past its learning or revival plan that the
  learner isn't actively working from day to day. Same mechanism as paused
  (off the agenda, no schedule warning); the "whole piece slowly degrades"
  behavior described in product conversations about this feature is just
  that same recency decay compounding over a longer untouched stretch, not
  a distinct decay curve.

**Deliberately not this feature**: an automatic "learned" detector, or any
scheduled maintenance-review mechanic. Pause/archive is a manual visibility
toggle only — it answers "keep this off my daily plate," not "tell me when
to revisit it." That's still Stage 4 below — now designed, still not built.

## Stage 4 — Maintenance (designed, not built)

Roadmap item 2. Once a piece is "learned" (Stage 3), it needs periodic
maintenance review to avoid the memory decay that would otherwise erase the
practice investment — this is the direct mechanism behind the
["time invested should compound"](Product-Principles.md#time-invested-should-compound-over-a-musicians-lifetime)
principle. The review-interval model is now fully designed (decision
records: [Decisions.md](Decisions.md#spaced-repetition--maintenance);
evidence behind several specific choices below: [Research.md](Research.md)).
**The stage-math engine is built and wired into logging** (see "The ladder:
three stages" below), **and `computeTimeline` itself now schedules reviews
off it** (Pass 5 — see "Introduction-window review scheduling: Tier 1 /
Tier 2" below). **Post-run-through logging — stop count and the rough/lost
flag mode — is also now built** (Pass 6, see that subsection below). What's
*not* built is everything past that: a live "what's due" query that works
beyond the current plan's bounded `daysToLearn` window, and Revival's three
auto-triggers that would consume the stop-count/lost-flag data this pass
produces (Pass 7 — see "Revival auto-triggers" below). See each subsection
below for what's actually implemented today vs. still just designed.

### The unifying idea

Learning-review and maintenance are **not two separate systems** — they're
one continuous card-based ladder that every practice chunk, transition, and
combo rides after its initial introduction. What changes between "a piece
in learning" and "a piece in maintenance" is just how many of its cards
have reached the top of the ladder, not a different mechanism. Introduction
itself (first exposure — front-loaded, effort-budgeted, tied to
`daysToLearn`) stays exactly as it works today
([Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler))
and is not part of the ladder. Maintenance mode, for a piece where every
chunk already holds, is just what the ladder looks like once nothing needs
graduating anymore — a live "what's due" view, not a fixed calendar plan.

This was a bigger architectural shift than a formula change, which is
worth understanding even now that it's built. Post-introduction review
used to be a **pure, stateless derivation** (`computeTimeline` /
`adaptiveReviewOffsets`) — recomputed from scratch on every render from
`introducedDay` and the single most-recent session's `effectiveness`,
consistent with `chunkSet`/`timeline` being `useMemo`'d off `piece` and
never persisted (see `CLAUDE.md`). There was no persisted "stage" or
"consecutive pass count" anywhere in the data model. The ladder couldn't be
bolted onto that pattern — it needed genuinely persisted, event-driven
state per chunk (stage, consecutive passes, `practiceBPM`, next-due date),
advanced by explicit logged outcomes, structurally closer to the existing
append-only `progress[id].sessions` log than to how `timeline` is computed.
**This is exactly what got built across Passes 1–5**: real new
`ChunkProgress` fields plus a migration path for every already-saved piece
(Pass 1), a stage-math engine that advances that state on every logged
session (`computeLadderAdvance`, Pass 2/3), and — Pass 5 — `computeTimeline`
itself now reads that persisted state to place reviews, via
`adaptiveReviewOffsets`'s replacement (see
[Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler) rule
4). `chunkSet`/`timeline` are still pure, unpersisted derivations exactly
as before — what changed is that they now derive from real ladder state
sitting on `piece.progress`, not that the derivation pattern itself
changed.

### The ladder: three stages

| Stage | Interval | Graduates after | Tempo floor |
|---|---|---|---|
| Stabilizing | every 4 days | 4 consecutive full passes | none |
| Settling | every 7 days | 4 consecutive full passes | ~70–75% of target |
| Holding | starts 14 days, expands ~1.5–2× per pass, capped ~8–12 weeks | no ceiling — the resting state | starts ~85%, +5 points per successful pass, caps 100% |

**Implemented and wired into logging**: `computeLadderAdvance` in
`src/lib/ladder.js` is called from `handleLogSession` (`App.jsx`) on every
logged session, and its result is persisted — every chunk's `stage` etc.
now actually advances as the learner practices. **Tier 1/Tier 2 review
scheduling is also now built** (Pass 5 — see the next section), so
`nextDueDate` genuinely drives what shows up in the plan, not just
computed-and-ignored data. A few points below are noted
as confirmed, superseding the original sketch, once building this made the
ambiguity concrete:

- A fail drops a chunk back exactly **one** stage, never to zero.
- Two consecutive fails specifically while in Stabilizing is a distinct
  signal ("this was never actually consolidated," not normal decay) — now
  surfaced as a `needsRelearning` flag on the chunk's returned ladder
  state. **Confirmed with the user: this does not plug into Revival** —
  Revival's three auto-triggers (below) are all piece-wide, this signal is
  chunk-scoped, and folding a single-chunk problem into a whole-piece
  recovery flow was never part of that design. What (if anything) should
  read this flag, and what "a short structured re-learning pass" concretely
  means, is still undecided — it's currently just data, not a route to
  anywhere.
- Holding's interval expansion reuses the effectiveness multiplier already
  built for `adaptiveReviewOffsets` (0.6×/1×/1.4× —
  [Algorithms.md#adaptive-review](Algorithms.md#adaptive-review)) as its
  **only** growth mechanism — no second, independently-tuned growth
  constant exists alongside it (an early draft of `ladderConfig` briefly
  had one; removed once redundant). One consequence, confirmed intentional:
  a "low" effectiveness full pass in Holding can make the *next* interval
  shorter than the one that just elapsed (0.6× is below 1), not just
  slower-growing — a technically-passing but shaky review is exactly when
  the next check-in should come sooner, not later.
- Stage lengths, graduation pass-counts, tempo floors, **and the
  practiceBPM ratchet step sizes below** are **piece-level tunable data,
  not hardcoded constants** (a future per-chunk override is explicitly
  flagged as a want, not built yet). No editing UI exists yet — the values
  just need to be stored so UI can be additive later.

### Introduction-window review scheduling: Tier 1 / Tier 2

**Implemented** (Pass 5 of the maintenance-ladder build) — `computeTimeline`
(`src/lib/scheduling.js`) places both tiers directly; full mechanics:
[Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler) rule
4. The design below is what motivated it; a few specifics only became
concrete once actually building it did, called out inline.

A chunk introduced on day 1 has its first due review on day 4 under the
ladder — while the app is still trying to introduce every other chunk
across those same days to hit the "whole piece touched by the halfway
point" rule ([Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler),
rule 1). Every day in that window has to fund both new introductions and a
growing queue of due reviews out of the same daily budget. If reviews
always won that contention, introduction would slow and coverage targets
would get missed; if introduction always won, reviews would get skipped or
crammed, and earlier-introduced chunks would get worse odds of cleanly
stabilizing than later ones — undermining the point of a
consolidation-driven ladder.

**Resolution, scoped specifically to the front-loaded introduction window**
(once nothing new is being introduced, this stops applying and due reviews
simply compete oldest-due-first): new-chunk introduction gets first claim
on the day's budget; due reviews are slotted in after, and anything that
doesn't fit rolls to the next day rather than counting as missed. **A late
review is schedule slack, not a scheduling failure — lateness never fails a
review or affects the ladder; only the actual outcome (pass/soft-miss/fail),
whenever the review happens, does.** The ladder's stage math is untouched
by this; a chunk's due-date doesn't move because of budget pressure, it's
just reached on a different day than originally targeted.

Within that resolution, reviews split into two tiers with different flex:

- **Tier 1 — the first-touch review.** A one-time event per chunk,
  inserted immediately after introduction (around day 1), before
  Stabilizing's normal 4-day cadence begins. Near-mandatory — cheap enough
  that it should almost always happen regardless of that day's
  introduction pressure, because a single unreinforced exposure has a
  short shelf life (see [Research.md](Research.md)) and skipping it risks
  losing the chunk before Stabilizing's first real review would otherwise
  catch it. Each chunk passes through Tier 1 exactly once, then moves into
  Tier 2 for the rest of its life on the ladder.
- **Tier 2 — the standard ladder stages**, mechanically unchanged
  (Stabilizing's 4-day cadence onward through Settling and Holding), but
  allowed to **flex** during the introduction window — rolling to the next
  day under budget pressure, no penalty. This is where schedule pressure
  gets absorbed; Tier 1 is where it explicitly does not, per the asymmetry
  in [Research.md](Research.md) (reviewing late costs gradually more,
  reviewing early costs almost nothing).

**Three specifics that only became concrete once this was actually built,
not obvious from the design above:**

- **A chunk with real practice history predating the ladder is not Tier
  1-eligible, even though its `stage` reads `null` just like a genuinely
  untouched chunk does.** Migration (`backfillProgressLadderState`,
  `lib/storage.js`) sets `stage: null` on every pre-existing progress
  entry regardless of how much it's actually been practiced — `stage`
  alone can't distinguish "never touched" from "practiced a lot before
  this feature existed." Found via Codex review of the Pass 5 diff: without
  an additional check for existing session history, an already-practiced
  legacy chunk got wrongly scheduled a "first touch" review, as if none of
  that history had ever happened. Such a chunk now simply gets no review
  placed at all until it's next logged, at which point it picks up real
  ladder state and starts taking the Tier 2 path like any other chunk.
- **"Rolls to the next day" is enforced as strictly forward-only, not a
  bidirectional nudge.** The review-load-smoothing mechanism Tier 2 reuses
  (Algorithms.md#timeline--scheduler, rule 5) was inherited from the
  pre-ladder fixed-offset system, which nudged a review ±1 or ±2 days in
  *either* direction — harmless there, since it had no specific "due date"
  to respect. Discovered via manual browser verification during the Pass 5
  build: reused unchanged, that same bidirectional nudge could cascade a
  Tier 2 review *backward* across the smoothing pass's 3 iterations,
  chasing whichever neighboring day was least loaded at each step — a
  review genuinely due on day 5 landing on day 2, three days before it was
  ever due. Fixed by restricting Tier 2's candidate days to later-only.
- **Only the *next* due review ever shows up, not a running schedule of
  future ones.** `computeTimeline` reruns from scratch on every piece
  change and reads whatever `nextDueDate` currently says — since the
  ladder only ever knows a chunk's one *next* due date (not a
  precomputed future sequence), that's all a single recompute can place.
  This is a real behavior change from the old fixed-offset system, which
  front-loaded up to four review instances per chunk into the plan at
  once. A due date landing beyond this plan's own `daysToLearn` isn't
  placed in this bounded view at all (see "Explicitly not designed/built
  here" below) — not a bug, just outside what a fixed-length plan array
  can represent.

**Open, monitored rather than assumed**: whether a single Tier 1 touch is
sufficient, or a chunk needs a second short rung (day 1, then day 3, before
the normal 4-day cadence) before it reliably survives to Stabilizing's
first real review. Plan: track the fail rate specifically on each chunk's
*second* ladder review (the first real Stabilizing check, right after Tier
1) — if that fails disproportionately versus later reviews, that's the
signal a second rung is needed. Not being built preemptively without that
evidence.

### Per-chunk tempo target: `practiceBPM`

**Implemented.** A field distinct from the existing `targetBPM`
([Data-Model.md](Data-Model.md)), live in `ChunkProgress` and stepped by
`computeLadderAdvance` on every logged session:

- `targetBPM` = the eventual goal — performance tempo, or a deliberately
  inflated overlearn tempo chosen on purpose.
- `practiceBPM` = the tempo the app is *currently* asking the learner to
  attempt for that specific chunk. Starts low, ratchets toward `targetBPM`
  over sessions — the fix for grading every session against a distant
  fixed target (e.g. an overlearn tempo 10 BPM above performance)
  producing repeated "almost but not quite" sessions that read as failure
  when the target itself was fine, just ungraded incrementally.
- Step sizes (`ladderConfig.bpmSteps`, tunable, defaults): **+2 BPM** on a
  full pass, **−2 BPM** on a soft miss, **−2 BPM** pullback on a real fail
  too — not the steeper ~8-10 BPM drop originally sketched here. Confirmed
  with the user while building the ladder engine (`lib/ladder.js`): a real
  fail should cost the same as the other two outcomes, not a distinctly
  larger penalty. See [Decisions.md](Decisions.md#spaced-repetition--maintenance).
- **What actually shipped, different from the original sketch above:**
  `ChecklistItem.jsx` kept free-text "clean reps" and "BPM achieved"
  `NumberInput` fields rather than replacing them with a fixed "attempt at
  `practiceBPM`" action — `practiceBPM` (when set) only shows as the BPM
  field's placeholder/suggestion, and as a "Practice tempo: N BPM" tip
  line. `classifySessionOutcome` reads whatever the learner actually typed
  against `practiceBPM`, so the free-text field already doubles as the
  "lightweight manual override" this bullet asked for — a separate
  override control was never needed. Progress's tempo-trend sparkline
  reads `currentBPM` (last logged tempo) either way, so it gets real data
  regardless of whether the typed value matched `practiceBPM`.

### Session outcomes: three tiers, not two

**Implemented**: `classifySessionOutcome` in `src/lib/confidence.js`,
called from `ChecklistItem.jsx` on every log and passed to
`handleLogSession` already classified. Replaces the old flat pass/fail:

1. **Full pass** — required clean reps hit at/above current `practiceBPM`.
   `practiceBPM` steps up; counts toward stage graduation only once
   `practiceBPM` has cleared that stage's tempo floor (the floor gates
   `practiceBPM`, not the per-session pass/fail itself).
2. **Soft miss** — some clean reps, not enough in a row at that tempo.
   `practiceBPM` steps down, consecutive-pass count resets, **stage does
   not change**. New tier — the fix for "plateau via frustration": no
   honest way existed to log "close, but not quite" without it reading as
   failure against a fixed distant number.
3. **Real fail** — self-report override ("needs more work"), failing reps
   at a tempo previously cleared (genuine regression), or repeated
   soft-misses even after `practiceBPM` has already backed off. One-stage
   demotion, per the ladder rules above.

Plateau (reps consistently met, `practiceBPM` not climbing) should be rare
by construction now, since tempo increase is built into what a full pass
means. The residual case — oscillating with no new high-water mark over
several recent attempts — should surface a note rather than silence.

**Resolved**: the same-day-overwrite gotcha this section used to flag is
fixed. `handleLogSession` (`src/App.jsx`) now appends every logged
session rather than overwriting by `(chunkId, day)`, keyed by a precise
`loggedAt` timestamp — a placeholder scheme (see the decision record).
Tier 1/Tier 2 review *scheduling* is now built (Pass 5 — see
"Introduction-window review scheduling" above), but that's a separate
thing from what this bullet originally wanted: a *logged session* still
isn't tagged with which kind of review it actually was (a Tier 1 touch, a
due Tier 2 review, a same-day re-attempt) — `loggedAt` distinguishes
multiple same-day records from each other, but doesn't label what any one
of them represents. That semantic tagging wasn't part of Pass 5 and
remains not built.

**Resolved**: the old "how did it feel" three-tap effectiveness input
(`EFFECTIVENESS_OPTIONS`) is gone, folded into a single "needs more work"
override — a checkbox in the logging UI that forces the outcome to `fail`
regardless of clean reps, per the lean this section originally sketched.
`session.effectiveness` no longer gets written by new sessions;
`session.outcome` ('pass'/'soft-miss'/'fail') is the new field. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance).

### Post-run-through logging

**Implemented** (Pass 6). The old consolidation-day UI was a bare "mark
complete" checkbox with no data captured, stored under the synthetic
`piece.progress["__consolidation__"]` entry
([Data-Model.md](Data-Model.md)) — that storage location is unchanged, it
just now holds real data. Shared by both learning-phase consolidation days
and maintenance run-throughs (one mechanism, not two — `DayChecklist.jsx`
doesn't distinguish which):

- **Stop count** — numeric input ("Times stopped"): how many times the
  run-through got stopped and restarted. `handleLogRunThrough` (`App.jsx`)
  appends `{ day, stopCount, loggedAt, loggedDate }` to
  `progress["__consolidation__"].sessions`, mirroring
  `handleLogSession`'s shape (multiple same-day attempts allowed, each its
  own record) rather than overwriting. `handleUnlogRunThrough` undoes the
  most recent entry, matching `handleUnlogSession`'s convention. Visible
  on Progress's "Recent practice history" as "Full run-through (stopped
  Nx)".
- **Flag mode on the Piece Map** — a 3-state cycle per chunk on the
  existing grid: `untouched` (default, shown as no icon) → **rough**
  (demotes one stage, pins the next review to today regardless of what the
  demoted stage's normal cadence would produce) → **lost** (demotes fully
  to Stabilizing, same pin) → back to `untouched`. The demote-and-pin
  operation is `applyRunThroughFlag` (`src/lib/ladder.js`), a sibling to
  `computeLadderAdvance` — reuses its private `demote()` helper directly
  rather than duplicating the stage-transition rule, and resets
  `consecutivePasses` to 0 for the same reason a fail does (passes accrued
  at the old, higher stage shouldn't carry over toward graduating back out
  of the demoted one). Deliberately doesn't touch `practiceBPM` or
  `consecutiveStabilizingFails`/`needsRelearning` — those are tied to
  classified session outcomes, and a manual run-through flag isn't one.
  **Resolved, superseding the plan below: this field is `progress[id].flag`
  (`undefined | 'rough' | 'lost'`), and it *replaces* `weakSpot` rather
  than sitting alongside it** — confirmed with the user before
  implementation started (this was the pass's one explicit blocking
  question). `weakSpot`'s only two consumers both treated it as
  "flagged or not," so both became "is `flag` set at all," not a rewrite:
  `computeRevivalPlan`'s weak-spots-first sort
  (`lib/revival.js`) and `RevivalTab`'s "flagged" list/count — neither
  distinguishes rough from lost, by design (not a redesign into a
  three-tier lost-before-rough sort). Revival's sequential reassessment
  modal now sets the same tri-state flag the Piece Map does (same
  underlying field, same control), rather than a separate weak-spot
  toggle.
- **Confidence cap, not a `stage`/ladder read.** Rough/lost flags must
  immediately affect displayed confidence everywhere it shows (Overview,
  Progress, Piece Map, and everywhere else `computeConfidence` is called —
  Analytics, the Today checklist's confidence pill, `FocusPanel`) — a
  chunk just flagged "lost" showing an unchanged confidence number
  elsewhere would be a visible contradiction. Implemented as a cap inside
  `computeConfidence` itself (`lib/confidence.js`) — `Math.min(score, 55)`
  for rough, `Math.min(score, 20)` for lost, applied *after* either the
  manual-override or auto-computed branch, so a stale manual override from
  before the flag lands can't paper over it either. Every caller reads
  through this one function, so the cap propagates for free with no
  per-tab changes needed beyond it. The caps sit inside the Piece Map's
  own tier boundaries (34/67) so a flagged chunk's grid color changes too,
  not just its number. This doesn't read `stage` — `computeAutoConfidence`
  still deliberately doesn't factor in ladder stage (see Stage 3 above);
  the demote-and-pin operation and the confidence cap are two independent
  effects of the same flag, not one implemented in terms of the other.
- **Old `weakSpot` data reads forward as `flag: 'rough'`, not silently
  orphaned.** Found in review after Pass 6 shipped: the merge above only
  covered code reading `weakSpot` going forward — it didn't address
  already-saved pieces that had `weakSpot: true` set before this pass, and
  since nothing reads that field anymore, that data would otherwise have
  quietly stopped showing up anywhere (the Piece Map icon, Revival's
  flagged list, `computeRevivalPlan`'s prioritization) with no error and
  no visible sign it had happened. Fixed in migration
  (`backfillProgressLadderState`, `lib/storage.js`): a progress entry with
  `weakSpot: true` and no `flag` already set converts to `flag: 'rough'`
  on load (covers regular app load, fresh imports, and merged imports,
  since all three funnel through `validateAndMigratePiece`); an explicit
  `flag` already present always wins, so this can't clobber a flag set
  after Pass 6 shipped. `weakSpot` itself is deleted once converted rather
  than left sitting unread.
- **Clearing a flag reverts the schedule change it caused, not just the
  flag itself.** Found in review: the original implementation demoted
  `stage`/`nextDueDate` on flagging but never reversed it on un-flagging,
  so cycling rough → lost → untouched left a chunk permanently demoted
  even though "untouched" is meant to mean "held fine." Fixed via
  `progress[id].flagSnapshot` (see [Data-Model.md](Data-Model.md)):
  `handleSetFlag` (`App.jsx`) captures `{ stage, consecutivePasses,
  nextDueDate }` once, on the untouched→rough transition only, and
  restores from it when the flag clears back to untouched. Not recaptured
  on rough→lost, so it always reflects the state from before *any* flag in
  the current cycle, not the intermediate rough demotion. Guarded against
  discarding real progress: if a session gets logged for real while
  flagged, `handleLogSession` deletes the snapshot, so a later "never
  mind" on the flag leaves the genuinely-earned advance in place instead
  of reverting past it — clearing the flag at that point just leaves
  `stage`/`nextDueDate` wherever the flag's demotion last set them.

### Revival auto-triggers

[Revival](#revival-built-mvp) above is entry-only manual today. The data
these triggers would read now exists — stop count and the rough/lost flag
(Pass 6, "Post-run-through logging" above) — but nothing yet checks it
against these conditions or offers a revival automatically; that's Pass 7,
still not built. Planned: three independent conditions, any one of which
offers a revival rather than requiring the learner to remember to start
one themselves:

1. Stop count > 5 on a single logged run-through.
2. "Large chunks lost": any `combo`-kind chunk flagged lost in a
   run-through, or 2+ regular practice chunks flagged lost in the same
   run-through (reuses the existing `combo` kind as the "large chunk"
   concept rather than a separate size threshold).
3. 60+ days since anything was logged on the piece at all.

Condition 3 is a **distinct fallback**, not a diluted version of 1/2 — 1
and 2 can only fire if a run-through was actually attempted and logged, so
a piece nobody has touched in two months has no data to trip the other two
even though it would almost certainly meet them if attempted. Kept as
three separately-checked conditions, deliberately not unified into one
formula.

**Combo handling within revival, once triggered** (implemented — supersedes
the old `computeRevivalPlan` code comment, which statically excluded
combos; see [Decisions.md](Decisions.md#spaced-repetition--maintenance)
for the full alternatives-considered record): combos don't get their own
revival task by default. Revival relearns the underlying content
normally — the anchor hard chunk, plus whichever neighboring chunk(s) the
combo's range overlaps (a combo spans midpoint-to-midpoint across its
neighbors, so this is partial territory in both, not just the anchor;
`findComboUnderlyingChunks`, `src/lib/revival.js`, computes this fresh via
`rangesOverlap` rather than trusting `combo.linkedIds`, which only stores
the anchor). If any of that underlying content produces a real fail during
revival, the combo escalates into its own explicit revival task, shown in
`RevivalTab.jsx` as a "Needs another look" panel. If everything relearns
cleanly, no combo-specific task is ever generated. **Resolved: escalation
fires on a single real fail**, not the ladder's two-consecutive-fails
threshold — confirmed with the user: revival is already "something's
wrong" mode by the time it's running, unlike ordinary practice, where that
dampening exists specifically to avoid overreacting to one bad day.

This is also what will resolve condition 2's "combo flagged lost" trigger
once Pass 7 wires the auto-trigger check itself in — but not in the way
this section originally assumed. Escalation (`computeComboEscalations`) is a
*live derivation* off logged session history, not a task written into
`piece.revival.plan` and later cleared. That sidesteps the "clearing"
problem entirely: there's no flag being set that needs unsetting, so
nothing can get stuck permanently flagged or re-trigger falsely — the
function simply stops returning a combo once nothing in the qualifying
history is a fail. One concrete consequence: `computeRevivalPlan` did
*not* need to become a dynamic, outcome-dependent structure after all —
its output is still exactly the same fixed list generated once upfront
that it always was (confirmed by a regression check: identical plan
output whether or not any fails occurred during the run). The escalated
task lives entirely outside that stored plan, as a parallel derivation
computed the same way `chunkSet`/`timeline` already are (CLAUDE.md).

### Explicitly not designed/built here

- Revival's internal structure/pacing beyond the trigger conditions and
  combo-handling above — those are the first concrete pieces of that spec,
  not the whole of it.
- Manual UI for tuning stage lengths / tempo floors / step sizes — stored
  as tunable data so UI can be additive later, but no editing interface is
  planned for this pass.
- A second Tier 1 rung — not built preemptively; ship the single-touch
  version and monitor per the plan above.
- **How maintenance surfaces in the UI** — still genuinely undecided. The
  most likely shape is folding "what's due" into the existing Master
  Agenda ([Architecture.md](Architecture.md)) and per-piece Today tab
  rather than a new tab, since both already render day-shaped chunk lists
  — but both currently source their data by indexing a fixed-length,
  `daysToLearn`-bounded `timeline.days[]` array
  ([Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler)),
  and that's a sharper problem than it first looks: `getCurrentDay`
  (`src/lib/utils.js`) doesn't just happen to be array-bounded, it
  explicitly `clamp`s to `[1, totalDays]` — day-numbering itself has no
  unbounded concept anywhere in the app today, not just an
  indexing convenience. A chunk's ladder due-date can't be expressed as
  "a bigger plan-day number" once a piece runs past its plan (which
  happens well before the whole piece reaches Holding — Holding's
  interval alone runs 8–12 weeks); it needs an actual reference frame
  outside plan-day numbers entirely, e.g. a real calendar date. Surfacing
  maintenance in either tab needs a live "what's due" query keyed off
  each chunk's own due-date in that frame, not an index into
  `timeline.days[]` — a new function operating in different units, not a
  bigger loop over the existing one.

## Stage 5 — Repertoire rotation (not built)

The long-horizon vision from [Vision.md](Vision.md): multiple pieces, each
potentially in maintenance simultaneously, competing for a limited daily
practice budget. Multi-piece support today is single-piece-at-a-time (you
switch between pieces; there's no cross-piece scheduling). Rotation would
need to decide how to allocate limited practice time across several
"maintain, don't lose this" pieces at once — genuinely undesigned.

## Open questions

**Resolved by the spaced-repetition ladder design** (Stage 4 above; not yet
implemented) — kept here for the record rather than deleted:

- ~~What formally defines "learned"?~~ Every chunk's ladder card reaching
  Holding — see Stage 3.
- ~~Does maintenance scheduling need its own lifecycle-stage field?~~ No —
  it's derived (every chunk at Holding), not stored as a separate
  `piece.stage` field.
- ~~Should stage transitions be automatic or user-confirmed?~~ Automatic,
  driven by logged session outcomes — with the existing manual-escape-hatch
  pattern (confidence override) and the new rough/lost flag mode as the
  override paths, consistent with
  [Product-Principles.md](Product-Principles.md#always-provide-a-manual-escape-hatch).
- ~~Does the two-consecutive-Stabilizing-fails signal plug into Revival?~~
  No — confirmed with the user while building `lib/ladder.js`. Revival's
  auto-triggers are piece-wide; this signal is chunk-scoped and stays a
  standalone flag (`needsRelearning`) with no destination yet.
- ~~Does the existing "how did it feel" effectiveness input survive
  alongside pass/soft-miss/fail?~~ No — folded into a single "needs more
  work" fail override, confirmed with the user while wiring logging in.
  See Stage 4 → Session outcomes.
- ~~Does ladder stage feed into confidence?~~ No, deliberately, for now —
  confirmed with the user. `computeAutoConfidence` doesn't read `stage`/
  `consecutivePasses`; revisit once Stage 3 ("learned") is actually
  defined against real data rather than guessing at the weighting now.
- ~~Does a combo's revival escalation fire on a single real fail, or the
  ladder's two-consecutive-fails threshold?~~ A single real fail —
  confirmed with the user while building `computeComboEscalations`
  (`src/lib/revival.js`). See "Combo handling within revival" above.
- ~~Should the new rough/lost flag field merge with the existing
  `progress[id].weakSpot`, given both are manual "needs attention"
  flags?~~ Merged — confirmed with the user before Pass 6 started (the
  pass's one blocking question). `weakSpot` (boolean) is gone; both Piece
  Map and Revival's reassessment modal now set the same tri-state
  `progress[id].flag`. See Stage 4 → Post-run-through logging.

**Still open:**

- What "a short structured re-learning pass" (the response to two
  consecutive Stabilizing fails) concretely means, now that it's confirmed
  *not* to be Revival — nothing else in the app defines this mechanic yet.
  Currently just a data flag (`needsRelearning`) with nothing reading it.
- Whether a second Tier 1 rung is needed before a chunk reliably survives
  to Stabilizing's first real review — gated on fail-rate data once built,
  not decided preemptively.
- How maintenance surfaces in the UI — most likely Master Agenda and the
  per-piece Today tab, but the data-plumbing implication (a live "what's
  due" query replacing the fixed-length `timeline.days[]` index) isn't
  designed — see Stage 4 → Explicitly not designed/built here.
