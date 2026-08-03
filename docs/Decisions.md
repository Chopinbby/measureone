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
- **What formally defines a piece as "learned"?** No such state exists
  today. See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-informally-defined-today).
- **Exact placement of the Analytics panels once folded into Progress** —
  agreed in general terms ("near effectiveness calibration, somewhere
  unobtrusive") but never pinned down. See [Roadmap.md](Roadmap.md).
- **Should "projected finish date" ever show a real calendar date** (derived
  from `piece.createdAt`) instead of staying in day-number terms? Day-number
  was chosen as the safer default when the Progress redesign shipped, but a
  calendar date wasn't ruled out as a future option.
