# Research

> **Purpose:** Track which of the app's numeric behavior is backed by real
> practice-science evidence vs. hand-picked by feel, and hold open research
> questions that would improve the algorithms if answered.
> **Audience:** Anyone tuning a constant in [Algorithms.md](Algorithms.md), or
> deciding whether a proposed change needs evidence or just a product judgment
> call.
> **Scope:** Evidence backing (or lack of it) for MeasureOne's scheduling and
> confidence heuristics. Not the algorithms themselves — see
> [Algorithms.md](Algorithms.md). Not future features — see
> [Roadmap.md](Roadmap.md).
> **Related:** [Algorithms.md](Algorithms.md) · [Data-Model.md](Data-Model.md) ·
> [Roadmap.md](Roadmap.md)
> **Update when:** A constant below gets real backing (cite it and remove it
> from the "hand-picked" list), or a new hand-picked constant is introduced
> anywhere in the codebase (add it here so it doesn't go untracked).

**Status: this document is a placeholder with real content, not a finished
literature review.** No formal practice-science research has been conducted
for this project yet — the entries below are the honest inventory of what's
hand-tuned, so that inventory doesn't silently live only in scattered code
comments.

## Hand-picked constants (not derived from any study)

| Constant | Value | Where | What it should eventually be backed by |
|---|---|---|---|
| `EFFORT_TO_MIN` | 2.5 | scheduler | Actual minutes-per-repetition data, likely varying by instrument and skill level |
| `LIBERAL_FACTOR` | 1.2 | schedule-estimate padding | Real variance in practice efficiency across users |
| efficiency ratio | 0.65 | reschedule feasibility, wizard time estimate | Same as above — currently a magic number repeated in three places, not even centralized as a named constant |
| `REVIEW_OFFSETS` | [1, 3, 7, 14] | spaced review | Spacing-effect / forgetting-curve literature (Ebbinghaus-derived intervals are a reasonable starting guess, but untested here) |
| adaptive review multipliers | 0.6× / 1.4× | `adaptiveReviewOffsets` | Outcome data correlating self-reported effectiveness with actual retention |
| effectiveness multipliers | 0.8× / 1× / 1.15× | confidence formula | Same |
| `REQUIRED_REPS` | easy: 3, medium: 4, hard: 5 | confidence formula | Motor-learning research on repetitions-to-consolidation, likely instrument- and passage-dependent |
| progress-tier thresholds | ≥5 comfortable, ≥10 mastered | `computeProgressTier` | Same, and also: whether rep-count alone is even the right single signal (see [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them)) |

## Open research questions

- **Does the spacing-effect literature (typically studied on verbal/declarative
  recall) actually transfer to motor/procedural skill learning at the
  fidelity this app assumes?** The `[1,3,7,14]` offsets are borrowed from
  general spaced-repetition practice, not validated for instrumental
  practice specifically.
- **Is clean-rep count at a given tempo actually a good proxy for
  durable learning**, or does it reward fluent-but-shallow repetition over
  slower, more effortful practice known to produce better retention
  ("desirable difficulties")?
- **What forgetting-curve shape actually fits a practiced-but-unreviewed
  musical passage?** This directly determines what the recency-decay term
  in `computeAutoConfidence` should look like, and it's currently a guess.
- **What does "maintenance" cadence look like for a piece already learned**
  (relevant to [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) Stage 4) —
  almost certainly much longer intervals than active-learning review, but
  by how much is unknown.

## Why this matters now

[Roadmap.md](Roadmap.md) item 4 — a genuinely *learned* (not hand-tuned)
confidence/interval model — is explicitly gated on having enough session
history to tune against. This document is where that tuning should start:
before building a learned model, get an honest answer to "which of today's
hand-picked constants would a learned model even need to replace," which is
exactly the table above.
