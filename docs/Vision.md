# Vision

> **Purpose:** State what MeasureOne is for, at the level that should survive any
> individual feature or redesign.
> **Audience:** Anyone deciding whether a proposed feature belongs in this product —
> future Claude Code sessions, human developers, future-you, collaborators.
> **Scope:** Mission, target user, what the product is and isn't. Not *how* it
> achieves this (see [Product-Principles.md](Product-Principles.md)) and not the
> current feature list (see [Roadmap.md](Roadmap.md)).
> **Related:** [Product-Principles.md](Product-Principles.md) ·
> [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) · [Roadmap.md](Roadmap.md)
> **Update when:** The core mission or target user changes — this should be rare.
> A new feature does not require an update here unless it changes what MeasureOne
> *is*.

## Mission

Turn "I have to learn 120 measures in 3 weeks" into a concrete, day-by-day
practice plan — and keep that plan honest by reacting to how practice is
actually going, not to how many days have passed on a calendar.

## The problem

Learning a substantial piece of music is a scheduling problem as much as a
technical one. Musicians default to two failure modes: no plan at all (panic
in the final week), or a rigid plan that ignores reality (falling behind
silently until it's too late to recover, or grinding material that's already
solid because "the schedule says so"). MeasureOne exists to replace both with
a plan that is concrete up front and adaptive in practice.

## What MeasureOne is

- A **practice planner**: given a piece's length, difficulty, and a timeline
  or time budget, it produces a day-by-day schedule of what to practice.
- A **practice tracker**: it logs reps, tempo, and how a session felt, and
  turns that into a confidence score per chunk of music — see
  [Product-Principles.md](Product-Principles.md#confidence-is-earned-not-assumed).
- A **course-correction tool**: it detects when the learner is falling behind
  the schedule they set for themselves and offers to rebalance the remaining
  work, rather than letting the plan silently drift from reality.

## What MeasureOne is not

- **Not a metronome, notation app, or recording tool.** It sits alongside
  those tools; it doesn't replace them. (It does let you link out to
  reference recordings — see [Data-Model.md](Data-Model.md) — but it doesn't
  play or record audio itself.)
- **Not a fixed calendar.** A MeasureOne plan is a starting point that the
  scheduler continuously revises based on logged practice, not a printed
  itinerary.
- **Not (yet) a teacher-facing or multi-user tool.** Teacher mode and
  collaboration are explicitly deferred — see [Roadmap.md](Roadmap.md).
- **Not (yet) cloud-connected.** Everything lives in one browser's
  `localStorage`. See [Roadmap.md](Roadmap.md) and
  [Architecture.md](Architecture.md).

## Long-horizon vision

The single-piece planner is the part that's built. The larger goal is bigger
than any one piece: help a musician build and retain a **lifetime
repertoire** — a growing body of music they can actually still play, not just
music they once learned and then forgot. That means:

- Practice time invested in a piece should **compound** rather than evaporate
  once the piece is "done." A piece that's been learned and then abandoned to
  memory decay isn't a completed investment — it's a deferred loss.
- The planner's job doesn't stop at "learned." What happens after — spaced
  maintenance review, rotating attention across a repertoire of pieces — is
  the natural next chapter of this product, not a separate one. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) and item 2 of
  [Roadmap.md](Roadmap.md).

## Who it's for

An individual musician (any instrument, any level past complete beginner)
who has decided to learn a specific piece and wants a plan more concrete than
"practice it every day." Multi-piece support exists today because musicians
rarely work on just one piece at a time.
