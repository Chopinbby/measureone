# Product Principles

> **Purpose:** The operating principles that should settle any product
> decision — "should MeasureOne do X" is usually answerable by checking it
> against this list.
> **Audience:** Anyone proposing or reviewing a feature — future Claude Code
> sessions especially, since these principles are what "matches the existing
> design philosophy" cashes out to concretely.
> **Scope:** Principles about *what the product does and why*. Presentation-
> level principles (how things look and feel) live in
> [UX-Principles.md](UX-Principles.md) instead. Historical rationale and
> alternatives considered live in [Decisions.md](Decisions.md); this doc
> states the principle, not the debate that produced it.
> **Related:** [Vision.md](Vision.md) · [UX-Principles.md](UX-Principles.md) ·
> [Algorithms.md](Algorithms.md) · [Decisions.md](Decisions.md)
> **Update when:** A new recurring principle emerges from a design discussion
> (add it here), or an existing principle is deliberately overturned (move
> the old one to Decisions.md as superseded, with why).

Each principle below links to where it's actually implemented, so it stays
checkable against the code rather than becoming aspirational text.

## Confidence is earned, not assumed

A chunk isn't "done" because a day passed or a box got checked. Confidence is
a computed score driven by logged reps, tempo achieved, and self-reported
difficulty, and it decays with time since last practiced. The schedule
reacts to that score, not to the calendar.

This is the single most load-bearing idea in the app — see
[Algorithms.md](Algorithms.md#confidence) for the exact formula, and
[Decisions.md](Decisions.md) for the specific bug fix (fewer clean reps at a
lower tempo must genuinely score lower) that makes this principle non-negotiable
in the implementation.

## Always provide a manual escape hatch

The confidence formula is a hand-tuned heuristic (see
[Research.md](Research.md)), not ground truth. When the user disagrees with
it, they win: `manualConfidence` overrides the computed score entirely,
everywhere it's used. The same pattern applies to difficulty (reassess any
measure range directly) and tempo targets (per-chunk override beats the
piece-wide default). Hand-tuned automation should never trap the user with an
answer they know is wrong.

## Practice should reduce overwhelm

"Learn 120 measures in 3 weeks" is overwhelming as stated. The app's job is
to turn it into "here's what to do today," and to keep the day-to-day view
uncluttered:

- The Overview tab is a glanceable, point-in-time read (four numbers, three
  seconds) — trend and diagnosis are deliberately pushed to a separate
  Progress tab rather than crammed into the dashboard. See
  [UX-Principles.md](UX-Principles.md).
- `FocusPanel` answers "what needs the most work right now" directly, so the
  learner doesn't have to scan the whole piece map to figure out where to
  spend a limited practice session.

## Practice is adaptive, not static

The plan is a living thing, not a printed schedule:

- Spaced review timing bends based on how the last session actually went
  (`adaptiveReviewOffsets`) — struggling pulls the next review closer, ease
  pushes it out.
- "Behind schedule" is detected from actual logged sessions vs. scheduled
  introduction days, and surfaces a rebalancing option
  (`getEffectiveTimeline`) rather than letting the plan silently drift from
  reality.

See [Algorithms.md](Algorithms.md) for both mechanisms.

## Recommend the highest-impact next action

Rather than asking the learner to figure out what to practice, the app
ranks: `FocusPanel` sorts everything touched so far by confidence;
`suggestMethods()` recommends a practice technique matched to the chunk's
specific situation (hard and unconfident vs. recurring vs. a seam
transition); the reschedule dialog tells the learner *before* it's too late
whether their remaining pace can actually finish the plan.

## Maximize long-term repertoire, not just today's session

Practicing chunks in isolation doesn't teach you to play through the seams
between them, and re-entering material from the same boundary every time
doesn't build real security. This is why the chunking model has three tiers,
not one — see [Data-Model.md](Data-Model.md#practice-chunks-vs-sections):

- **Transitions** drill the join between adjacent chunks, scheduled as soon
  as both sides are introduced (not batched to the end).
- **Combos** ("Focus blocks") re-enter hard material from a different
  starting point than the original chunk boundary.
- The entire piece is introduced within the first half of the plan — the
  back half is spent on transitions, combos, and review, not held in reserve
  for a single cram at the end.

Recurring material is credited (`effortMultiplier`) so already-familiar
passages don't eat schedule budget meant for genuinely new material.

## Time invested should compound over a musician's lifetime

Multi-piece support exists so the app reflects how musicians actually work —
several pieces in flight, not one at a time in isolation. This principle is
also the reason "what happens after a piece is learned" (maintenance review,
repertoire rotation) is a real roadmap item and not an afterthought — see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) and
[Roadmap.md](Roadmap.md). The maintenance mechanism itself is now designed
(a continuous spaced-repetition ladder, not a separate mode) — see
[Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built](Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built).
The stage-math engine is built and live (every logged session advances a
chunk's ladder card); what's not yet built is anything that surfaces that
state back to the learner as "here's what's due" — see that section for
the current implemented/not-implemented split.

## No punishment mechanics

**This is treated as permanent product policy, not a preference to
revisit.** There is no streak counter, no "days since last practiced," no
streak-freeze mechanic, anywhere in the app. A broken streak discourages
exactly when discouragement is least helpful, and a long streak becomes
something to anxiously protect rather than a healthy signal.

The replacement is a **rolling-window consistency** stat ("9 of last 14 days
practiced") and a **non-alarming heatmap** — teal for practiced days, neutral
(not red or grey-as-warning) for untouched ones. See
[UX-Principles.md](UX-Principles.md) for the visual language and
[Decisions.md](Decisions.md) for the full rationale.

If you are asked to add a streak, a "longest streak," or any mechanic that
frames a missed day as a loss: don't, and point to this section.

## Shared editors, not divergent flows

Anything the user can configure at setup (Wizard), they can revisit later
(Settings) — through the *same* editor component, not a parallel
reimplementation. `BasicsFields`, `SectionsEditor`, `DifficultyEditor`,
`RecurringEditor`, `ScheduleFields`, `BpmZonesEditor`, and `RecordingsEditor`
are each used in both places by design. This is as much a product principle
(setup and editing should never quietly diverge in what's possible or how it
behaves) as an engineering one — see [Architecture.md](Architecture.md) for
the implementation convention.
