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

> **Heading kept as-is deliberately** — it's linked from a number of other
> places in `docs/` and from code comments by its exact anchor
> (`#stage-3--learned-defined-not-yet-implemented`), and renaming it would
> break every one of those without a coordinated fix across files this
> pass didn't touch. Read the body below, not the heading, for the current
> state: **the rollup is now built.**

**Decided** (see [Decisions.md](Decisions.md#spaced-repetition--maintenance)):
a piece is "learned" once every practice chunk's ladder card has reached
Holding — the resting stage of the spaced-repetition ladder described in
Stage 4 below. This replaces the earlier informal, calendar-based reading
(implicitly, "the plan's `daysToLearn` ran out") with a consolidation-based
one: a piece that consolidates fast graduates fast, one that doesn't,
doesn't, regardless of what `daysToLearn` originally guessed. **Per-chunk
ladder state now exists and advances live** — `computeLadderAdvance`
(`src/lib/ladder.js`) is called from `handleLogSession` (`App.jsx`) on
every logged session (Pass 2/3 of the maintenance-ladder build).

**The piece-level rollup itself is now built too (Pass 39):**
`isPieceLearned(piece, chunkSet)` (`src/lib/ladder.js`) is the real
function that queries "is every practice chunk's `stage` at `holding`" —
no longer just prose. It's genuinely load-bearing, not a future display
label: `isPlanActuallyComplete` (`src/lib/scheduling.js`) calls it to
decide, for a `scheduleMode: "minutes"` piece, whether the plan should keep
extending itself or finally read as complete — see
[Stage 4 → this pass's build](#stage-4--maintenance-mostly-built) below
and [Algorithms.md](Algorithms.md#detecting-that-a-piece-has-run-past-its-plan)
for the mechanics, [Decisions.md](Decisions.md#scheduling) for why. It is
**not yet surfaced anywhere as a user-visible "this piece is learned"
label or state** — only its scheduling *consequences* are visible so far,
the same way ladder `stage` itself has always been felt through its
downstream effects (`practiceBPM`, which day a review lands on) rather
than shown as a raw value.

**Still queued behind this work, now unblocked but not built:** gating
revival entry so a revival can only be started once a piece is in
maintenance (i.e. learned), with a manual Settings transition for pieces
finished away from the app. Agreed in principle, and no longer blocked on
"there's no mode to gate on" — `isPieceLearned` is exactly that mode now —
but this pass's Builds list didn't include wiring it into Revival entry,
so that gate still doesn't exist. It also has to reconcile with the
Wizard's start-directly-in-revival path and with the staleness
auto-trigger, which fires for pieces *abandoned* mid-learning. Design it
together with this state rather than bolting it on afterwards; full detail
in [Decisions.md](Decisions.md#open-questions).

`computeProgressTier` (buckets a chunk into untouched/learned/comfortable/
mastered) and `computeConfidence` (continuous 0–100 score) both continue
to answer their own separate, chunk-level questions from this piece-level
"learned" rollup (`isPieceLearned`, now built — see above) — see
[Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them).
**As of Pass 6, `computeProgressTier` buckets directly off the chunk's
ladder `stage`** rather than its most-recent session's clean-rep count
(the original signal) — so ladder stage already *is* a live input to one
of the two existing "how good is this chunk" scores, just not the piece-
level "learned" rollup this section is about, and still not
`computeConfidence`, which remains deliberately stage-inert. Whether
ladder stage eventually replaces one of the two chunk-level scores
outright, becomes a fully independent third one, or stays split exactly
like this (feeding one, not the other) is **not decided** — flagged in
[Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them),
not resolved here.

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
- **Manually from the Piece Overview dashboard**, whenever the user decides an
  existing piece needs it — the original entry point. As of Pass 7, this
  same button can also be proactively *suggested*: a banner surfaces above
  it whenever `computeRevivalTriggers` (see "Revival auto-triggers" below)
  finds a reason to — clicking through still lands on the exact same entry
  modal, so this isn't a third distinct flow, just the existing manual
  entry point with a reason attached instead of requiring the learner to
  remember on their own.
- **At piece creation**, via a toggle on the Wizard's final step ("Learning
  it fresh" vs. "I already know this piece"). Covers repertoire the user
  already knew before ever using the app — Setup still runs in full (a
  chunk structure is required regardless, since revival planning reuses
  `generateAllChunks`/`effort`), but completion opens the revival entry
  modal immediately instead of landing on Piece Overview, so the piece
  starts in revival mode with zero practice history — reassessment works the same
  either way, since it only reads `piece.progress` (empty is a valid start).

Scoped deliberately narrow for this pass — explicitly **not** built as part
of it: Maintenance mode (Stage 4 below), Performance Preparation mode,
automatic lifecycle-state detection, cross-piece repertoire health
dashboards, or reading/memory/technical diagnosis tagging beyond the manual
flag. Revival's flag (a plain boolean weak-spot toggle at the time; merged
into Pass 6's tri-state rough/lost `progress[id].flag` — see "Post-run-
through logging" below) and memory anchors are the lightweight, manual
precursor to whatever that deeper tagging might look like, not a
replacement for it.

Automatic entry triggers (rather than manual-only, as it was before Pass
7) are now built — see [Stage 4 → Revival auto-triggers](#revival-auto-triggers)
below.

**Since Pass 37**, the reassessment card (the embedded `PieceMapTab` modal,
`sequentialMode`) looks different from ordinary Piece Map's chunk-detail
card, not just narrower: stats (difficulty/confidence/sessions/stage) move
into a collapsed "Chunk Info" section at the bottom instead of sitting at
the top; Target BPM shows as a read-only "N BPM — set at piece setup" line
with a "Change for this chunk" button, rather than an always-open input,
since most chunks just inherit the piece's setup-time tempo; a note next to
Current BPM clarifies it means the fastest tempo playable accurately right
now, not the eventual target; and "Set manually"/the "Confidence override"
heading are gone, since Quick rate is already the manual-entry path here.
Ordinary (non-revival) Piece Map keeps the original card — see
[Decisions.md](Decisions.md#ux) for why the redesign didn't land in both
places.

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
  a distinct decay curve. **Since the same session as Pass 43/45**, setting
  a piece to archived is no longer unconditional — the control is disabled
  until `isPlanActuallyComplete(piece, chunkSet, timeline)` (Pass 39) says
  the plan is actually finished, with an inline reason shown while it's
  locked. Pause is unaffected — still available any time, no condition.
  See [Decisions.md](Decisions.md#lifecycle) for why, and
  [Decisions.md](Decisions.md#open-questions) for the resulting gap (a
  piece genuinely abandoned mid-plan, not finished and never going to be,
  has no clean path to archive).

**Deliberately not this feature, still**: any scheduled maintenance-review
mechanic — that's Stage 4 below, not this. Pause remains a pure manual
visibility toggle with no computed condition attached. Archive is a
partial exception to "manual toggle only" as of the change above: setting
it now depends on a computed check, though the check is "is the plan
actually finished," not "is this piece learned" in the Stage 3 sense —
still not an automatic *detector* that decides archival on its own, just a
gate on the learner's own manual action. Stage 4 is now mostly built (the
ladder, Tier 1/2 scheduling, post-run-through logging, and Revival's
auto-triggers are all live); what's still missing is a live "what's due"
query that surfaces maintenance in the UI beyond the current plan's
bounded length — see "Explicitly not designed/built here" below.

## Stage 4 — Maintenance (mostly built)

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
flag mode — is also now built** (Pass 6, see that subsection below), **and
so are Revival's three auto-triggers that consume that stop-count/lost-flag
data** (Pass 7 — see "Revival auto-triggers" below). **The live "what's
due" query that works beyond the current plan's bounded `daysToLearn`
window is also built** — `computeDueReviews` (`lib/maintenance.js`),
shared by Master Agenda and the Today tab, Pass 8; see "How maintenance
surfaces in the UI" below. What remains unbuilt at this stage is the
piece-level "learned" rollup itself (Stage 3) and Stage 5 rotation. See
each subsection below for what's actually implemented today vs. still just
designed.

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
| Holding | starts 14 days, expands ~1.5–2× per pass, capped ~8–12 weeks | no ceiling — the resting state | **retired (Pass 61)** — meeting the rep requirement is sufficient on its own; see the periodic harder check below |

**Since Pass 61**, Holding no longer has a tempo floor at all — the
escalating ~85%-to-100%-of-target gate in the table's original design (and
built, before this pass, as `tempoFloorStartFraction`/
`tempoFloorStepFraction`/`tempoFloorCapFraction`) is gone from
`clearsStageFloor`'s Holding branch, which now always returns true. In its
place: every 4th logged Holding review (the 4th, 8th, 12th... since the
chunk's most recent fresh entry into Holding) needs one more clean rep than
usual, tracked by a new `progress[id].holdingReviewCount` and resolved by
`resolveRequiredReps` (`lib/confidence.js`) at the point `ChecklistItem`
displays and judges the requirement — see
[Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder) for
the full mechanics. This is a rep-only mechanism; `classifySessionOutcome`'s
separate tempo check (`bpm >= practiceBPM`, deciding whether a session
counts as a pass at all) is completely untouched.

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
  signal ("this was never actually consolidated," not normal decay) —
  surfaced as a persisted, sticky `needsRelearning` flag
  (`progress[id].needsRelearning`). **Confirmed with the user: this does
  not plug into Revival** — Revival's three auto-triggers (below) are all
  piece-wide, this signal is chunk-scoped, and folding a single-chunk
  problem into a whole-piece recovery flow was never part of that design.
  **Built in Pass 11** — see "The short structured re-learning pass" below
  for what actually reads and reacts to the flag now.
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
  flagged as a want, not built yet).
- **Editing UI built (Pass 17).** `LadderConfigEditor`
  (`src/components/fields/LadderConfigEditor.jsx`), wired into
  `SettingsTab`'s edit view only (not the Wizard — no setup-time use case
  for a ladder a piece hasn't joined yet), exposes every field above
  through the same `{draft, set}` pattern `BpmZonesEditor`/`ScheduleFields`
  already use. `lib/storage.js`'s `mergeLadderConfig` needed no change — its
  existing field-by-field partial-override merge (built for the
  incomplete-migrated-data case) turned out to be exactly what a Settings
  edit needs too, confirmed with a new test rather than assumed. This pass
  deliberately didn't re-derive or validate the defaults themselves — see
  [Research.md](Research.md) — only made them adjustable. The one nullable
  field (`stabilizing.tempoFloorFraction`, default `null` — "no floor")
  gets a "Clear (no floor)" button next to it, the same pattern
  `PieceMapTab`'s manual-confidence override already uses to get back to
  `null`, since a plain `NumberInput` can't commit a cleared field to
  `null` on its own.

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
  attempt for that specific chunk. Ratchets toward `targetBPM` over
  sessions (or jumps straight there — see below) — the fix for grading
  every session against a distant fixed target (e.g. an overlearn tempo 10
  BPM above performance) producing repeated "almost but not quite" sessions
  that read as failure when the target itself was fine, just ungraded
  incrementally.
- **How `practiceBPM` gets its starting value is three distinct concepts,
  not one** (a later revision — see
  [Algorithms.md](Algorithms.md#starting-suggested-and-demonstrated-tempo)
  for the full mechanics): a system-*suggested* starting tempo (guidance
  only, from target BPM + difficulty), the learner's own *chosen* starting
  tempo (whatever they actually log first — this is what `practiceBPM`
  actually seeds from), and a *demonstrated* tempo that can later replace
  the baseline outright (3+ clean reps at a bpm above the current value,
  on a pass or soft-miss) instead of the usual +2-per-pass ratchet.
- Step sizes (`ladderConfig.bpmSteps`, tunable, defaults): **+2 BPM** on a
  full pass, **−2 BPM** on a soft miss — not the steeper ~8-10 BPM drop
  originally sketched here. Confirmed with the user while building the
  ladder engine (`lib/ladder.js`): a soft miss's cost shouldn't be a
  distinctly larger penalty than a pass's gain.
  **Superseded (Pass 26 follow-up):** a real fail no longer uses this flat
  step at all — it resets `practiceBPM` to the recorded tempo the chunk
  had the last time it freshly entered the stage the fail demotes it
  INTO (`stabilizingEntryBPM`/`settlingEntryBPM`/`holdingEntryBPM`),
  falling back to the old −2 step only when nothing's recorded for that
  stage yet. Reopened at the user's explicit request; see
  [Decisions.md](Decisions.md#spaced-repetition--maintenance) for the
  three options presented and why this one needed new persisted state.
  **Superseded again (Pass 59) for the pass/soft-miss steps specifically —
  the flat `bpmSteps.pass`/`bpmSteps.softMiss` deltas above are now only a
  fallback for a chunk with no `targetBPM` to measure against.** The normal
  case ratchets `practiceBPM` by a step *proportional to the remaining gap*
  to `targetBPM` (a new per-chunk adaptive rate, `progress[id].tempoRatchetK`,
  defaulting to 0.3, capped at `ladderConfig.tempoRatchet.kCapBpm`, default
  8 BPM) — and, as part of the same pass, **a soft miss no longer steps
  `practiceBPM` down at all**; it halves the chunk's own ratchet rate and
  still steps forward, just more slowly. See
  [Algorithms.md](Algorithms.md#tempo-ratchet-pass-59) for the full
  mechanics (including the overlearning bonus for a session that clearly
  beats what was asked) and
  [Decisions.md](Decisions.md#spaced-repetition--maintenance) for why.
  **Extended (Pass 60) with "tempo maintenance mode":** once `practiceBPM`
  is already at or above `ladderConfig.tempoRatchet.tempoAchievedThreshold`
  (default 85%) of `targetBPM`, the pass/soft-miss step-size calculation
  substitutes a small, pinned rate (`ladderConfig.tempoRatchet.maintenanceK`,
  default 0.05) for the chunk's own tracked `tempoRatchetK` at the moment
  the step is computed — **not persisted anywhere**; it's a live check
  (`isInTempoMaintenance`, `lib/ladder.js`) recomputed off `practiceBPM`/
  `targetBPM` every time it's needed, so it exits on its own the instant a
  fail's `practiceBPM` reset drops back below the threshold, no separate
  exit logic required. The chunk's own `tempoRatchetK` keeps
  stepping/halving/recovering underneath exactly as described just above,
  completely unaffected — maintenance mode only ever substitutes at the
  point a step size is actually computed, never overwrites what's tracked.
  **Deliberately not connected to anything else yet**: not `isPieceLearned`,
  not `isPlanActuallyComplete`, not Pass 30's "tempo climbing" nudge —
  see [Decisions.md](Decisions.md#spaced-repetition--maintenance) for what's
  still an open question here and why it's staying open on purpose.
- **What actually shipped, different from the original sketch above:**
  `ChecklistItem.jsx` kept free-text "clean reps" and "BPM achieved"
  `NumberInput` fields rather than replacing them with a fixed "attempt at
  `practiceBPM`" action — `practiceBPM` (when set) shows as the BPM
  field's placeholder/suggestion, and (Pass 26) as part of the task card's
  stated requirement, "Need N clean reps at `practiceBPM`+ BPM to progress
  this chunk" (superseding an earlier plain "Practice tempo: N BPM" tip
  line — see "Session outcomes: three tiers, not two" above).
  `classifySessionOutcome` reads whatever the learner actually typed
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
   `practiceBPM` steps up (or jumps straight to the achieved tempo, if 3+
   clean reps at a bpm above the current value qualifies as "demonstrated" —
   see above); counts toward stage graduation only once `practiceBPM` (as
   it stood *before* this session) has cleared that stage's tempo floor
   (the floor gates `practiceBPM`, not the per-session pass/fail itself).
   **Known gap:** a same-session demonstrated-tempo jump doesn't get
   graduation credit for clearing the floor it just jumped past, since the
   check runs before the jump — see
   [Decisions.md](Decisions.md#spaced-repetition--maintenance).
2. **Soft miss** — some clean reps, not enough in a row at that tempo.
   Consecutive-pass count resets, **stage does not change**. New tier — the
   fix for "plateau via frustration": no honest way existed to log "close,
   but not quite" without it reading as failure against a fixed distant
   number. **As of Pass 59, `practiceBPM` no longer steps down here** — it
   still moves, just forward, at half the chunk's normal ratchet rate (see
   [Algorithms.md](Algorithms.md#tempo-ratchet-pass-59)); the tier's own
   meaning ("close, but not quite — not a fail") is unchanged, only which
   direction the tempo consequence moves.
3. **Real fail** — self-report override ("needs more work"), zero clean
   reps, or repeated soft-misses — but **only when both the current and the
   previous shortfall were reps-driven** (fewer than the required clean
   reps), not merely a tempo miss. One-stage demotion, per the ladder rules
   above.

   **Resolved (Pass 14) — the BPM-gating false-fail fix:** the original
   escalation rule fired off the previous session's *outcome label* alone
   (`previousOutcome === "soft-miss"`), which didn't distinguish *why* that
   soft-miss happened. A learner who hit every required rep but logged a
   couple BPM under `practiceBPM` — itself already stepping down after a
   miss — got auto-classified `"fail"` on the second such session, even
   though nothing about their playing had regressed. `classifySessionOutcome`
   now also takes `previousCleanReps`, and the escalation only fires when
   this session's own reps also fell short of `requiredReps` *and* the
   previous soft-miss was itself reps-driven — a tempo-only shortfall can
   never be the fail trigger, in either session of the pair, no matter how
   many times it repeats. See
   [Decisions.md](Decisions.md#spaced-repetition--maintenance) for the
   options considered and why this one was chosen over delaying the
   threshold or removing BPM from the pass/fail gate entirely.

**Implemented (Pass 26) — task card clarity: the requirement stated up
front, a confirm step before an under-logged attempt saves silently, and
plainer display labels.** Three separate, display-only changes (the
classification above is unchanged):

- **The task card states its actual requirement before logging**
  (`ChecklistItem.jsx`): "Need N clean reps at M+ BPM to progress this
  chunk," reusing the exact `requiredReps`/`practiceBPM` values
  `classifySessionOutcome` itself judges against — no separate,
  independently-maintained copy of the number to drift out of sync. No
  tempo clause when `practiceBPM` hasn't been seeded yet (a first attempt
  genuinely has no tempo floor to clear — see
  [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder)),
  so the stated requirement never claims a floor that isn't actually being
  enforced.
- **A shortfall on reps, or on tempo alone with reps otherwise met, now
  confirms before saving** instead of saving silently — "You logged 2 of
  the 3 reps needed... Save anyway?" or, for a tempo-only shortfall, "You
  logged 3 clean reps at 90 BPM — under the 102+ BPM needed... Save
  anyway?" A clarity checkpoint, not a gate: confirming saves exactly what
  was entered, same as before this pass. Deliberately does NOT fire on a
  zero-rep attempt (already unambiguous) or on an attempt that already
  meets/exceeds the requirement in full (nothing to confirm), and
  deliberately does NOT fire when the "needs more work" manual-fail
  checkbox is already checked — that checkbox is itself already an
  explicit "this counts as a fail" choice, so a second confirmation on top
  of it would be friction, not clarity.

  **Widened immediately after shipping, same day:** the tempo-only case
  was originally left out on purpose — reasoned at the time that the
  requirement line above already states the tempo floor, so nothing new
  needed surfacing. The user disagreed and asked for it to be added too:
  it's easy to log a tempo a little under `practiceBPM` without registering
  that doing so is what turns a `"pass"` into a `"soft-miss"`/"Partial
  pass," and the requirement line being visible beforehand doesn't
  guarantee it was actually read. Both shortfall types now share one
  `window.confirm` gate in `submitLog`, mutually exclusive by construction
  (a reps shortfall can't also be a tempo-only shortfall, since the reps
  check runs first) — see [Decisions.md](Decisions.md#spaced-repetition--maintenance).
- **Display labels only, not the internal outcome values** (which stay
  `"soft-miss"`/`"fail"` everywhere in code): `SESSION_OUTCOME_META`
  (`src/lib/constants.js`) now shows "Partial pass" where it used to show
  "Soft miss," and "Needs rework" where it used to show "Real fail" —
  confirmed with the user rather than guessed, since the request that
  scoped this pass didn't name a replacement. "Real fail" only named the
  consequence a learner would directly notice (the tempo pullback); it
  didn't name that a fail also demotes the chunk a stage on the
  maintenance ladder, which "Needs rework" doesn't spell out literally
  either, but was confirmed as acceptable on the reasoning that seeing the
  chunk again soon isn't a surprise once it reads as needing rework. Both
  labels are read dynamically everywhere they're shown
  (`ChecklistItem.jsx`'s logged-session line, `ProgressTab.jsx`'s outcome
  breakdown) — no other file had a second, hardcoded copy of either
  string. See
  [Decisions.md](Decisions.md#spaced-repetition--maintenance) for the
  full option sets presented for each rename.
- **`PieceMapTab.jsx`'s needs-relearning hint renamed too, same day:** the
  internal ladder-stage name "Stabilizing" was leaking directly into the
  one place it's shown to a learner ("...rebuilds consistency in
  Stabilizing") — flagged as a finding when this pass shipped, not fixed
  at the time since it read as a separate wording question. The user
  settled it immediately after: display text now reads "the Introductory
  phase." Display-only, same pattern as the outcome-label renames above —
  `STAGES`/`stage: "stabilizing"` and every other internal reference stay
  exactly as they are; the string literal only changed in the one JSX
  line that renders it, since grep confirms nothing else displays a stage
  name to the learner at all (`"Settling"`/`"Holding"` never appear as
  user-facing text anywhere in the app today).
- **Flagged when this pass shipped, resolved the same day:** picking
  distinct labels for "Partial pass" and "Needs rework" made a
  pre-existing asymmetry visible that the old "Soft miss"/"Real fail"
  labels didn't surface as clearly — both outcomes used to step
  `practiceBPM` down by the identical flat amount. The user asked to
  revisit this — see the next section, "Per-chunk tempo target:
  practiceBPM," for what a real fail does now, and
  [Decisions.md](Decisions.md#spaced-repetition--maintenance) for the
  three options presented and why the chosen one needed new persisted
  state.

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
  most recent entry, same append-and-remove-most-recent shape
  `handleUnlogSession` uses — but not full parity as of Pass 10: a
  run-through entry carries no ladder state (`__consolidation__` isn't a
  real chunk, has no `stage`/`practiceBPM`) to reverse in the first place,
  so there's nothing for it to fully undo the way `handleUnlogSession` now
  fully reverses a regular chunk's ladder state — see
  [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder).
  Visible on Progress's "Recent practice history" as "Full run-through
  (stopped Nx)".
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
  **Since Pass 54, this is no longer true**: the flag toggle is removed
  from the chunk-detail modal specifically when `sequentialMode` is true
  (revival's reassessment), so revival can no longer set this field
  directly — ordinary (non-revival) Piece Map is now the only way to set
  `flag`. `computeRevivalPlan`'s flagged-first sort and `RevivalTab`'s
  "Flagged chunks" panel (below) still read the same field, unchanged —
  they just won't have anything to show unless a chunk was flagged outside
  of revival. See [Decisions.md](Decisions.md#revival).
- **Confidence cap, not a `stage`/ladder read.** Rough/lost flags must
  immediately affect displayed confidence everywhere it shows (Overview,
  Progress — including its confidence-by-difficulty bars — Piece Map, and
  everywhere else `computeConfidence` is called: the Today checklist's
  confidence pill, `FocusPanel`) — a
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
  **`needsRelearning` gets the same cap, added in Pass 11 once that flag
  existed** — `Math.min(score, 20)`, same value as `lost`, since it reuses
  the same underlying demote-and-pin mechanism just reached a different way
  (two Stabilizing fails, not a manual run-through flag). Independent of
  `entry.flag`: a chunk can in principle carry both at once, and the two
  caps are combined with `Math.min` rather than one overriding the other,
  so whichever is stricter always wins.
- **Overview's "Practice progress" bar was still contradicting the flag
  after the confidence cap shipped.** Found in review: `computeProgressTier`
  (the Mastered/Comfortable/Learned bar) read only a chunk's most-recently-
  logged clean-rep count, entirely independent of `flag` — a chunk with
  strong history could get flagged "lost" and still read "Mastered" right
  next to its now-capped, low confidence number, the exact contradiction
  this feature exists to prevent. Fixed by switching that function to
  bucket off `stage` instead (`holding`→mastered, `settling`→comfortable,
  else→learned) — a chunk demoted by `applyRunThroughFlag` above drops a
  tier here automatically, through the same `stage` write, not a
  redundant separate flag check. See
  [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)
  for why this doesn't fully unify `computeConfidence` and
  `computeProgressTier` — it closes this one contradiction, not the
  general "two independent scores" question.
- **Two silent-failure risks caught in a pre-commit self-review, both
  fixed before shipping.** `computeProgressTier`'s new `stage` check
  silently treated any unrecognized value the same as a real one — now
  warns (`console.warn`) before falling back to "learned," rather than
  misclassifying with no trace. `handleSetFlag`'s `flagSnapshot` restore
  trusted the snapshot's shape unconditionally — now verifies all three
  expected fields are present first; on a malformed snapshot it warns and
  skips the restore (leaving `stage`/`nextDueDate` wherever the flag's
  last demotion set them) rather than overwriting good data with
  `undefined`. Neither was reachable through the shipped UI at the time,
  but both were real gaps a future change could have hit silently.
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
- **Undoing a session also undoes a flag applied on top of it — found in
  Pass 10's code review, fixed same session.** Symmetric to the point
  above: if a chunk is flagged rough/lost *after* a session (no session
  logged since), then that session gets undone, `handleUnlogSession` now
  clears `flag`/`flagSnapshot` too, not just the ladder state — otherwise
  the flag would outlive the ladder state it was based on, and
  `flagSnapshot` would point at a restore value that no longer exists.
  Safe because `flagSnapshot` still being present at undo time *proves*
  (via the clear-on-log rule above) the flag came after this session with
  nothing logged in between; a flag with no `flagSnapshot` (predates the
  session, or survived a later real log) is left untouched. See
  [Decisions.md](Decisions.md#spaced-repetition--maintenance).

### The short structured re-learning pass (built)

**Implemented (Pass 11).** Two consecutive fails while in Stabilizing sets
`progress[id].needsRelearning` — a persisted, sticky boolean, not just the
per-call informational flag `computeLadderAdvance` used to return. Four
rules, agreed with the user and recorded ahead of implementation in
[Decisions.md](Decisions.md#spaced-repetition--maintenance):

1. **Replaces review, never runs alongside it.** `computeTimeline`'s Tier 2
   loop (`lib/scheduling.js`) and `computeDueReviews`
   (`lib/maintenance.js`) both check the flag first and skip the chunk
   outright — a flagged chunk produces zero due reviews anywhere.
2. **Exit is dual.** The normal 4-consecutive-full-pass Stabilizing
   graduation clears it automatically (inside `computeLadderAdvance`
   itself); a manual override — `handleClearRelearning` (`App.jsx`), the
   same escape-hatch shape as `handleSetManualConfidence` — clears it on
   demand from the Piece Map. The manual clear also resets
   `consecutiveStabilizingFails` to 0 (confirmed with the user): otherwise
   the streak that triggered the flag survives the clear, and the very next
   fail re-flags instantly instead of behaving like an ordinary first fail.
3. **Reuses the `lost` demote-and-pin mechanism, never shows the word
   "lost."** The moment the flag turns on, `nextDueDate` pins to today,
   same as `applyRunThroughFlag`'s `lost` case — reproduced inline in
   `computeLadderAdvance`'s fail branch rather than calling
   `applyRunThroughFlag` directly, since that function deliberately never
   touches `practiceBPM`/`consecutiveStabilizingFails` and this rule needs
   both. User-facing label, confirmed with the user: **"Needs
   reinforcement"** — a small icon on the Piece Map grid cell, plus a
   labeled row with a "Clear, resume review" button in the chunk detail
   modal (`PieceMapTab.jsx`).
4. **`practiceBPM` resets.** To `getSuggestedStartingBPM(piece, chunk)`
   (concept 1 of the [starting/suggested/demonstrated tempo
   split](Algorithms.md#starting-suggested-and-demonstrated-tempo)) at the
   exact moment the flag turns on — not reapplied on later fails while
   already flagged. This was blocked until Pass 9 gave the app a real
   "suggested starting tempo" concept to reset to; unblocked once that
   landed. Since `lib/ladder.js` is a pure module without `piece`/`chunk`
   access, the caller resolves this value the same way it already resolves
   `targetBPM`: `ChecklistItem.jsx` computes
   `getSuggestedStartingBPM(piece, chunk)` unconditionally (not just on
   first encounter, since a chunk can be flagged well past its first
   session) and passes it through `sessionInput.suggestedStartingBPM` to
   `handleLogSession`.

Migration note: `consecutiveStabilizingFails` has been persisted since
Pass 1, so a piece already sitting at 2+ while still in Stabilizing gets
`needsRelearning` switched on retroactively on load
(`backfillProgressLadderState`, `lib/storage.js`), rather than defaulting
every already-saved piece to "not flagged" regardless of its real state.

Confidence cap: added on top of the four rules once the flag existed, same
mechanism the rough/lost flags already use — see "Confidence cap, not a
`stage`/ladder read" above.

**Verified manually in the browser**, not just via unit tests: forced the
flag via two real consecutive Stabilizing fails, confirmed the chunk drops
out of the Timeline's review slots entirely (reappearing once cleared),
confirmed the Piece Map badge/label/confidence cap render correctly
(including against a manual override), confirmed the manual-clear button
and the automatic 4-pass graduation both clear the flag, and confirmed
`practiceBPM` resets to the real `getSuggestedStartingBPM` value (not the
normal −2 step) once a piece has a target BPM configured — the earlier
in-plan test had none, so that first pass only exercised the fallback
step, not the actual reset; a second chunk with a real target BPM
confirmed the reset itself.

Deliberately not built here: a second Tier 1 rung, and anything wiring
this signal into Revival (unchanged from the earlier decision above — it's
chunk-scoped, Revival's triggers are piece-wide).

### Revival auto-triggers

**Implemented (Pass 7).** [Revival](#revival-built-mvp) above used to be
entry-only manual; `computeRevivalTriggers(piece, chunkSet)`
(`src/lib/revival.js`), called from `OverviewTab`, now checks three
independent conditions on every render and surfaces a "This piece might be
due for a revival" banner (with every condition that fired listed, not
just the first) whenever any one of them is true and no revival is already
active:

1. Stop count > 5 on a single logged run-through — reads
   `progress["__consolidation__"].sessions` (Pass 6, "Post-run-through
   logging" above).
2. "Large chunks lost": any `combo`-kind chunk flagged lost, or 2+ regular
   practice chunks flagged lost — reads the live, current-state
   `progress[id].flag` (Pass 6) across `chunkSet.combos` and
   `chunkSet.practiceChunks` directly, not per a specific logged
   run-through event (reuses the existing `combo` kind as the "large
   chunk" concept rather than a separate size threshold; a transition
   flagged lost does not count toward either half of this condition).
3. 60+ days since anything was logged on the piece at all — reads
   `piece.lastLoggedAt`. Does **not** fire when `lastLoggedAt` is `null`
   (nothing ever logged) — it's a fallback for a piece with real but aging
   activity, not a catch-all for a brand-new piece.

Condition 3 is a **distinct fallback**, not a diluted version of 1/2 — 1
and 2 can only fire if a run-through was actually attempted and logged, so
a piece nobody has touched in two months has no data to trip the other two
even though it would almost certainly meet them if attempted. Kept as
three separately-checked conditions, deliberately not unified into one
formula.

**Bug found and fixed while building condition 3:** `piece.lastLoggedAt`
is recomputed fresh on every piece load (`computeLastLoggedAt`,
`lib/storage.js`) from the max `loggedDate` across every progress entry's
sessions. That function used to explicitly skip the synthetic
`"__consolidation__"` entry — meaning a piece practiced *only* via
run-throughs would have `lastLoggedAt` stuck at `null` (or a stale date)
on every reload, exactly the scenario condition 1 is built to catch. Fixed
by removing that exclusion; see
[Decisions.md](Decisions.md#spaced-repetition--maintenance) for the full
account and [Data-Model.md](Data-Model.md#the-piece-object) for the
corrected field description.

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

**Correction: this turned out to be unrelated to condition 2, not the
mechanism behind it — an assumption this section made before Pass 7 was
actually built.** The original plan here expected the "combo flagged
lost" auto-trigger to resolve *through* `computeComboEscalations`, since
both are about a combo and "lost." What actually got built keeps them
completely separate: `computeRevivalTriggers`' condition 2 reads
`progress[id].flag === 'lost'` directly — the same manual, persistent flag
the Piece Map cycles — with no dependency on `computeComboEscalations` or
session-outcome history at all. The two mechanisms just happen to live in
the same file and both key off "a combo went badly," for genuinely
different purposes: escalation (below) decides what to actively relearn
*during* a revival that's already running, off live fail history since
`revival.startedAt`; the trigger decides whether to *offer* a revival in
the first place, off whatever's flagged right now, revival-independent.
Confusing the two would have been a real design mistake — escalation
requires `piece.revival.startedAt` to mean anything (there's no "revival
run" to measure fails against otherwise), which makes no sense as a
precondition for *deciding whether to start one*.

Escalation (`computeComboEscalations`) is, on its own terms, a
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

### How maintenance surfaces in the UI (built)

The ladder had been writing each chunk's `nextDueDate` since Pass 1, but
until Pass 8 **nothing read it outside the plan** — so a review the ladder
scheduled past the end of a piece's `daysToLearn` window could never reach
the learner. This is what closed that loop.

Due maintenance surfaces in **two places, both calling one shared query**
(`computeDueReviews` — [Algorithms.md](Algorithms.md#whats-due--the-live-maintenance-query)),
rather than a new tab or Master Agenda alone:

- **Master Agenda** — a per-piece summary card: merged measure ranges under
  a "Due" tag, plus a count and a time estimate. **Since Pass 19 this lives
  in its own "Maintenance due" subtab**, separate from "Learning phase" and
  "Revival," rather than intermixed in one cross-piece list. That split is
  presentational only — both card types still come from the same
  `agendaData` computation, partitioned on the flag that already
  distinguished them, and the combined count is unchanged.
- **The per-piece Today tab** — full detail. Once a piece runs past its
  plan, "Day N of N" becomes "Plan complete — maintenance, day N" and the
  day checklist is replaced by the due list. Day nav is disabled there (no
  bounded grid left to page through); "View all" still shows the original
  plan.

Due items are logged through the **same** `ChecklistItem` the bounded plan
uses, so a maintenance review advances the ladder by exactly the same path
a plan-day session does — no parallel logging mechanic.

Three rules this obeys, each load-bearing:

- **Strictly "due as of today."** No forward-looking window, no
  due-in-N-days, no maintenance calendar. A chunk due in three days appears
  nowhere until it's due.
- **A review arriving late is schedule slack, never a failure.** Overdue
  items are stated plainly and sorted most-overdue-first, with no penalty
  styling and no effect on the ladder — and because the next due date is
  computed forward from the day you actually practice, lateness costs
  nothing (see [Product-Principles.md](Product-Principles.md#no-punishment-mechanics)).
- **Suppressed** for paused/archived pieces and for any piece with an
  active revival — reasoning in
  [Decisions.md](Decisions.md#spaced-repetition--maintenance).

What made this harder than it looks is that day-numbering in this app has
no unbounded concept — `getCurrentDay` explicitly `clamp`s to
`[1, totalDays]`, so "past the plan" isn't a state it can report. The due
query sidesteps plan-day numbering entirely by working from
`ChunkProgress.nextDueDate`, which was specified as a real calendar date
back in Pass 1 precisely so this would be possible. The surfaces detect
"past the plan" from elapsed calendar days instead — see the decision
record for that and for the known duplication it left behind.

### Interleaved practice mode (built, Pass 29)

A toggleable mode on the Today tab (`viewMode === "interleave"`, alongside
Day view/Week/View all) that rotates practice through several chunks in
turn rather than working one checklist top-to-bottom — the retrieval-
practice benefit interleaving is known for only applies to material that's
actually somewhat consolidated, so this deliberately doesn't open up to
every chunk in the piece regardless of ladder stage — only ones that have
actually left Stabilizing.

- **Eligibility**: a chunk rotates in only once it's left Stabilizing —
  `isInterleaveEligible` (`src/lib/ladder.js`) checks
  `entry.stage === "settling" || entry.stage === "holding"`. A chunk still
  building its first consecutive-pass streak, including one that hasn't
  cleared Tier 1 at all (`stage` null/undefined), stays out of rotation.
  Plain per-chunk lookup against existing ladder state — no new persisted
  field.
- **Item source (since Pass 69, previously today-only):** every chunk in
  the whole piece (practice chunks, transitions, combos — `chunkSet.all`)
  that passes the eligibility check above, regardless of whether anything
  about it is scheduled for whichever day is currently being viewed. Built
  in Pass 29 as exactly the "today" list the rest of the tab already
  computes (`[...day.newChunkIds, ...day.specialChunkIds,
  ...day.reviewChunkIds]` mid-plan, or `computeDueReviews`'s `dueItems`
  past the plan) filtered to eligible chunks — narrowed to piece-wide on
  direct request once that day-scoping was flagged as a discovery. A
  chunk that graduated past Stabilizing on an earlier day is now
  immediately available to interleave against, not only once it happens
  to come back due. See
  [Decisions.md](Decisions.md#spaced-repetition--maintenance) (Pass 69,
  same-session follow-up).
- **Rotation timer**: mode-level, not per-item — one `setInterval`/
  `durationSeconds` counter (`InterleavePanel`,
  `src/components/tabs/today/InterleavePanel.jsx`) mirroring the pattern
  `ChecklistItem`'s own per-chunk timer already uses. **Since Pass 69**,
  the interval is graded by the *current* chunk's own difficulty
  (`ROTATION_SECONDS_BY_DIFFICULTY`: 2/3/4 minutes for easy/medium/hard)
  rather than the original flat 4 minutes for every chunk — "hard" keeps
  that original value. A configurable-per-user interval is still
  explicitly deferred; this only varies the fixed duration by difficulty.
- **Logging**: a rotation prompts the same rep/BPM/`manualFail` inputs and
  the same `onLogSession` call the regular checklist uses — a real logged
  attempt mid-rotation advances the ladder identically to logging it from
  Day view, no parallel path.
- **Skip ("skip, just save time")**: opting out of reporting an outcome
  for the current turn. A zero-rep session fed through the normal path
  would classify as a real fail (`classifySessionOutcome` treats
  `!cleanReps` as `"fail"`), which would be wrong for someone who simply
  chose not to report anything. `handleLogSession` (`App.jsx`) has one new
  `skipped: true` branch for this: it appends a session record (time,
  `loggedDate`, and the piece's `lastLoggedAt`) and returns *before*
  `computeLadderAdvance` runs, so `stage`/`practiceBPM`/`nextDueDate` are
  left untouched. **It also deliberately does NOT add the day to
  `doneDays`** — a skip is explicitly not "marked completed": the chunk
  stays open on the regular checklist so it can be logged for real later,
  during or outside Interleaved mode, same as if nothing had happened yet.
  The skipped record still lands in `progress[id].sessions` (so the time
  spent counts toward total time practiced, `sumPracticeSeconds`), but
  every consumer that treats `sessions` as evidence of *judged* practice —
  confidence scoring, the Progress tab's history/consistency/outcome
  stats, ladder-status display — reads through `lib/utils.js`'s
  `loggedSessions(sessions)` helper instead of the raw array, so a skip
  can't silently masquerade as a pass/fail/soft-miss, or as "this chunk
  was practiced today," anywhere that matters. `ChecklistItem` also has a
  dedicated render branch for a skipped session (a plain "Skipped in
  Interleaved practice — not marked done" line) rather than falling into
  the normal "Logged: N reps at X BPM" line, which has no reps/BPM to show
  for a skip.
- **Empty/locked state (since Pass 69, threshold widened from one)**: the
  "Interleaved" toggle needs *two* eligible chunks in the piece-wide pool
  to unlock, not one — a single chunk can't actually rotate against
  anything. Disabled with an inline reason rather than switching into a
  one-item or empty rotation, same disabled-with-explanation pattern used
  elsewhere in the app; the reason now distinguishes zero qualifying
  chunks ("No chunks have graduated past Stabilizing yet") from exactly
  one ("only one chunk has graduated past Stabilizing so far") — a state
  that couldn't occur under the original one-chunk threshold.
- **Provisional logging for a rough interleaved attempt (follow-up, same
  pass)**: interleaved retrieval practice often *looks* worse than the same
  chunk would in focused, blocked practice, while still being the more
  effective long-term practice — so an outcome InterleavePanel
  auto-classifies as soft-miss or fail (via `classifySessionOutcome`, NOT a
  manual "needs more work" override, which is already a deliberate fail
  decision the learner made on purpose) doesn't commit to the ladder the
  moment it's logged. `handleLogSession` (`App.jsx`) has a second new
  branch for this, `provisional: true`: it saves the real
  `cleanReps`/`bpm`/`outcome` (unlike a skip, which saves none), but — same
  as skip — does not add the day to `doneDays` and does not run
  `computeLadderAdvance`. Two new handlers resolve it later, from
  `ChecklistItem` (so from Day view, Week, View all, the past-plan
  due-review panel, or Revival — wherever that chunk is next viewed, not
  only from Interleaved mode) or from InterleavePanel's own card if the
  same chunk comes back around in rotation before it's resolved:
  - `handleConfirmProvisionalSession(chunkId, day, { targetBPM,
    suggestedStartingBPM })` finally runs the saved outcome through
    `computeLadderAdvance`, marks the *original* attempt's day done, and
    stamps a `ladderSnapshot` on the now-resolved session — so undoing it
    later goes through the existing `handleUnlogSession` mechanism
    unmodified; nothing new was needed there. The ladder math is dated to
    the *confirm* date, not the original attempt date — a confirmed
    soft-miss/fail schedules its next review from when the outcome was
    actually accepted, not backdated to a tentative attempt that may have
    sat unresolved for a while.
  - `handleDiscardProvisionalSession(chunkId, day)` removes the record
    outright, as if it never happened — no ladder snapshot to restore,
    since a provisional session never touched the ladder to begin with.
    This is also how a rough attempt gets "redone": discard, then log a
    fresh one normally.
  - A full pass never goes through this path — only soft-miss/fail do; a
    clean pass has no "would this even count" question to defer.
  - `loggedSessions` (`lib/utils.js`) excludes a pending provisional
    session from confidence/progress-tab reads the same way it excludes a
    skipped one — it hasn't been judged yet either.
  - **Narrowed by a later follow-up**: "resolve it whenever" above is no
    longer unconditional. Leaving Interleaved mode itself — switching to
    Day view/Week/View all, a different app tab, switching to a different
    piece, opening the "Edit piece" settings, or finishing the "Add new
    piece" wizard (the last two added on a subsequent review pass, after
    being missed in the original build — same warning, same guard function,
    just two more call sites) — while a provisional from the current
    rotation is still pending now warns first ("Practice data is tracked
    but not logged. Are you sure you want to leave before logging your
    progress?") and, if confirmed, discards it. Resolving it *before*
    leaving Interleaved mode is unaffected — nothing about ChecklistItem's
    Confirm/Discard UI changed. See
    [Decisions.md](Decisions.md#spaced-repetition--maintenance) for
    the full mechanism, the deliberate scope (only while actively viewing
    Interleaved mode, not any older pending provisional elsewhere in the
    piece), and a real persistence bug this surfaced in `App.jsx`'s
    piece-save effect.
- **Deferred**: a configurable rotation interval; relaxing the ladder's
  consecutive-clean-reps requirement in early stages (a separate,
  unresolved design question); cross-piece interleaving (stays
  single-piece like the rest of the Today tab).

### Cold-Start check (built, Pass 56)

A whole-piece cold play-through — no warm-up, no stopping to fix
anything — offered once every section has genuinely been covered, then
re-offered at a widening gap since the piece was last touched at all.
Answers a question none of the mechanisms above answer: section
run-throughs above only ever check *practice-chunk* coverage per section;
Stage 3's `isPieceLearned` (every chunk at ladder Holding) is a much
stricter bar, aimed at a different question ("is the learning plan
itself done"). A piece can clear this gate well before it's "learned" in
that sense — the two are deliberately independent, never combined into
one check.

- **The gate**: `coldStartGateMet(piece)` (`src/lib/coldStart.js`) —
  every section's own single-section run-through
  (`piece.progress["sr_" + section.id]`) has at least one logged session.
  Section-**pair** run-throughs aren't part of this gate — single-section
  coverage only. Because a section's run-through can only ever become due
  once every chunk assigned to it has been touched
  (`isSectionLearned`, above), this one check already implies the whole
  piece has been covered once too — no separate "every chunk in the piece
  has a session" check needed alongside it.
- **The prompt**: `coldStartDueThreshold(piece, today)` escalates through
  **3, 7, 14, then doubling forever** (28, 56, 112, ...) days since
  anything was logged on the piece (`piece.lastLoggedAt`, same
  `daysBetweenInclusive`-based gap `computeRevivalTriggers`'s staleness
  trigger already uses). A periodic nudge, not a persistent due-item like
  the section run-throughs above or the maintenance due-list: it's due
  only on the exact day a new threshold is crossed, then reads as
  "nothing new" every day after that until the next one — a live
  recomputation (comparing today's crossed threshold against the same
  computation one day earlier), not a persisted "already shown" flag, so
  a fresh gap cycle after any new session is logged just falls out for
  free rather than needing an explicit reset. See
  [Algorithms.md](Algorithms.md#the-repeating-escalating-prompt) for the
  full mechanics, including a write-timing hazard a more literal
  "persisted `lastPromptedThreshold`, explicitly reset" design would have
  hit.
- **Logging**: `ColdStartPanel`
  (`src/components/tabs/today/ColdStartPanel.jsx`), surfaced on Today's
  Practice below the section run-throughs, offers exactly two fields —
  **average BPM** (a single number) and **notes** (free text, with a
  transparent suggestion placeholder: *"e.g. how many times you stopped,
  what felt shaky, any memory breaks"*, same convention as the
  memory-anchor/notes field elsewhere in the app). Deliberately no
  separate structured stop-count input the way `"__consolidation__"`'s
  consolidation-day logging has — the point of a cold-start check is one
  uninterrupted play-through, with anything worth remembering about it
  folded into the notes afterward rather than tallied live. Writes to a
  new synthetic `piece.progress["__cold_start__"]` key
  (`applyColdStartLog`/`applyColdStartUnlog`), sessions shaped
  `{ day, avgBpm, notes, gapDays, loggedAt, loggedDate }` —
  **deliberately not folded into `"__consolidation__"`'s existing
  sessions**, since `computeRevivalTriggers` already reads every
  `"__consolidation__"` session's `stopCount` indiscriminately — mixing in
  a `stopCount`-less session shape would corrupt that trigger, and would
  also have blurred a deliberately-cold gap test into
  `"__consolidation__"`'s routine consolidation-day entries on Progress's
  "Recent practice history" list, since that list *does* pick up
  `"__consolidation__"` sessions (it wouldn't have picked up `
  "__cold_start__"` ones on its own either way — see the gap noted just
  below). `gapDays` snapshots the gap that actually motivated the test,
  since the same log call immediately overwrites `piece.lastLoggedAt` with
  today.
- **`avgBpm`/`notes` themselves are still log-and-display only** — stored
  and shown (the panel's own "last logged" line, and Progress's "Recent
  practice history" list), but nothing computes off `avgBpm` specifically:
  no comparison against `targetBPM`/`practiceBPM`, no effect on
  `computeRevivalTriggers` or confidence math. There's no clean structured
  number left to feed those once the feedback shape was simplified to just
  two free-form-ish fields (stops/memory-breaks live in free text, not a
  dedicated count).
- **Now shown on Progress's "Recent practice history" list** — a gap
  found while first documenting this feature (`computePracticeHistory`
  indexed purely by `doneDays`, which `"__cold_start__"` entries
  deliberately don't have, so a logged check never appeared there at
  all), fixed in the same session it was found: `computePracticeHistory`
  (`lib/history.js`) now also indexes `"__cold_start__"` sessions off
  their own `day` field. See
  [Algorithms.md](Algorithms.md#logging-a-separate-synthetic-key-not-__consolidation__).
- **Connected to Pass 58's overall-confidence stat, once Pass 58 shipped.**
  A successful Cold-Start log now shows a short, genuinely optional "How
  would you rate the piece overall right now?" prompt — five quick-tap
  presets (the same ones `PieceMapTab`'s revival "Quick rate" already
  uses) plus "Skip." Picking one immediately sets
  `piece.manualOverallConfidence`; Skip writes nothing at all, and the
  prompt itself is never persisted or resumed later if left unanswered.
  Originally scoped out of Pass 58's own build (reaching into this file
  wasn't in that pass's touched-file list), then added as an explicit
  same-session follow-up once directly requested — see
  [Decisions.md](Decisions.md#overall-piece-confidence) for the full
  reasoning and
  [Algorithms.md](Algorithms.md#overall-piece-confidence-pass-58) for the
  mechanics.
- **Deferred**: the exact escalation sequence past 14 days (doubling is a
  default, not a considered tuning choice); any equivalent "cold test" for
  a piece still learning or mid-revival — this is scoped to the
  post-full-coverage case specifically; comparing `avgBpm` against
  `targetBPM`/`practiceBPM` or surfacing a derived delta; extending the
  repeating-threshold treatment to section-pair run-throughs (a separate
  open question from Pass 49, untouched here).

### Explicitly not designed/built here

- Revival's internal structure/pacing beyond the trigger conditions and
  combo-handling above — those are the first concrete pieces of that spec,
  not the whole of it.
- ~~Manual UI for tuning stage lengths / tempo floors / step sizes~~ —
  **built in Pass 17**, moved out of this list. `LadderConfigEditor`
  (`src/components/fields/LadderConfigEditor.jsx`) renders under a
  "Maintenance ladder" panel in `SettingsTab`, editing `piece.ladderConfig`
  directly. The "stored as tunable data so UI can be additive later"
  prediction held — no data-model change was needed to add it.
- A second Tier 1 rung — not built preemptively; ship the single-touch
  version and monitor per the plan above.
- ~~How maintenance surfaces in the UI~~ — **built in Pass 8**, moved out
  of this list. See [How maintenance surfaces in the UI](#how-maintenance-surfaces-in-the-ui-built)
  below.

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
  No — confirmed with the user while building `lib/ladder.js`, unchanged
  once the signal's own behavior was built out in Pass 11. Revival's
  auto-triggers are piece-wide; this signal is chunk-scoped and stays a
  standalone flag (`needsRelearning`) — see "The short structured
  re-learning pass" above for what it now actually does.
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
- ~~How should maintenance surface in the UI?~~ Both Master Agenda and the
  per-piece Today tab, via one shared `computeDueReviews` query rather
  than a new tab or Master Agenda alone — **built in Pass 8**. See Stage 4
  → [How maintenance surfaces in the UI](#how-maintenance-surfaces-in-the-ui-built)
  and [Decisions.md](Decisions.md#spaced-repetition--maintenance).
- ~~What "a short structured re-learning pass" concretely means~~ — four
  rules agreed with the user, **built in Pass 11**: it *replaces* review
  rather than running alongside it; it exits on either the normal 4-pass
  graduation or a manual override; it reuses the `lost` mechanism but never
  shows the user that word (label: "Needs reinforcement"); and the practice
  tempo resets to `getSuggestedStartingBPM`, unblocked once Pass 9 gave the
  app a real starting-tempo concept to reset to. See "The short structured
  re-learning pass" above and
  [Decisions.md](Decisions.md#spaced-repetition--maintenance).

**Still open:**

- Whether a second Tier 1 rung is needed before a chunk reliably survives
  to Stabilizing's first real review — gated on fail-rate data once built,
  not decided preemptively.
