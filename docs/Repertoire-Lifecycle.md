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

## Stage 3 — "Learned" (informally defined today)

**There is currently no first-class "this piece is learned" state in the
data model.** What exists instead:

- `computeProgressTier` buckets individual chunks into
  `untouched → learned → comfortable → mastered` based on the most recent
  session's clean-rep count.
- `computeConfidence` gives each chunk a continuous 0–100 score.

Nothing rolls these up into a piece-level "done" milestone, and nothing
triggers when a piece crosses into it. This is a real gap — see
[Decisions.md](Decisions.md) for the open question, and treat any
maintenance-scheduling work (Stage 4) as blocked on deciding this first.

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

## Stage 4 — Maintenance (not built)

Roadmap item 2. Once a piece is "learned," it needs periodic maintenance
review to avoid the memory decay that would otherwise erase the practice
investment — this is the direct mechanism behind the
["time invested should compound"](Product-Principles.md#time-invested-should-compound-over-a-musicians-lifetime)
principle. Not yet designed: the review-interval model, whether it reuses
`adaptiveReviewOffsets`-style logic or needs something with much longer
horizons, and how it surfaces in the UI (a new tab? folded into Today?).

## Stage 5 — Repertoire rotation (not built)

The long-horizon vision from [Vision.md](Vision.md): multiple pieces, each
potentially in maintenance simultaneously, competing for a limited daily
practice budget. Multi-piece support today is single-piece-at-a-time (you
switch between pieces; there's no cross-piece scheduling). Rotation would
need to decide how to allocate limited practice time across several
"maintain, don't lose this" pieces at once — genuinely undesigned.

## Open questions

- What formally defines "learned"? A confidence threshold across all
  practice chunks? A user-initiated "mark as learned" action? Something
  else?
- Does maintenance scheduling belong on the existing `piece` object, or does
  it need its own lifecycle-stage field (e.g. `piece.stage: 'learning' |
  'maintenance'`)?
- Should transitioning stages be automatic (computed) or user-confirmed
  (matching the [manual-escape-hatch principle](Product-Principles.md#always-provide-a-manual-escape-hatch))?
