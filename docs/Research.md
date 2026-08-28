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
| rough/lost confidence caps | 55 / 20 | `computeConfidence` (Pass 6) | Real data on how much a single rough/lost run-through should actually discount confidence, vs. these hand-picked values chosen to land the display in the Piece Map's existing "Developing"/"Needs work" tiers |
| tempo-climbing trend window | last 4 judged sessions, min 3 to evaluate, min +4 BPM net rise to count as "climbing" | `hasClimbingTempo` (Pass 30, `lib/confidence.js`) | Real data on what window size and rise threshold actually separates a genuine tempo trend from ordinary session-to-session noise — picked as a plausible default, explicitly flagged in code as "a small tuning detail, not worth pre-deciding" at the time |
| minutes-mode auto-extend step | 14 days | `computeMinutesModeAutoExtend` (Pass 39, `lib/scheduling.js`) — how far a `scheduleMode: "minutes"` piece's plan grows each time it auto-extends past its own day count while not yet learned | Not derived from anything; picked to roughly match Holding's own default `startIntervalDays` so the number isn't arbitrary-looking, but there's no actual coupling between the two. Real backing would mean data on how often re-extending this often actually keeps pace with how long a piece typically takes to reach Holding once introduction is done |
| section run-through repeating threshold | 1, 3, 5, 7, ... (a flat "+2" step forever) | `sectionRunThroughGate` (Pass 49, `lib/chunking.js`) — how many more confirmed sessions on a section's slowest chunk it takes before that section's run-through comes due again | Specified directly by the feature request, not derived from anything. Real backing would mean data on whether a flat +2 step is the right cadence for a whole-section check-in regardless of section length/difficulty, or whether it should scale with either |

`computeProgressTier`'s old ≥5/≥10 clean-rep thresholds (a hand-picked
constant in this same spirit) no longer exist — Pass 6 replaced them with
bucketing straight off the spaced-repetition ladder's `stage`, so the
open "is rep-count alone the right signal" question this row used to
flag is resolved in one direction: it isn't, and it's no longer used.
Whether *stage* is the right signal is a live, un-decided question in
its own right (see [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them))
— but it isn't an unvalidated hand-picked *number* the way the old
thresholds were, so it isn't inventoried as one here; the ladder's own
stage-length/graduation constants below are the relevant inventory entry
for it.

## Spaced-repetition ladder (stage math built; UI surfacing not yet implemented)

Design: [Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built).
Decision records: [Decisions.md#spaced-repetition--maintenance](Decisions.md#spaced-repetition--maintenance).
The stage-transition math (`computeLadderAdvance`, `lib/ladder.js`) is
built and wired into logging; Tier 1/Tier 2 review scheduling and a live
"what's due" query are not. Not required reading to implement what's
left, but preserved here since it's the actual justification for several
specific choices rather than pure intuition:

- **Why the Tier 1 first-touch review exists at all**: a single
  unreinforced exposure has a short shelf life — general forgetting-curve
  findings suggest something learned once may only be reliably remembered
  for about a day without reinforcement. Waiting until Stabilizing's
  normal day-4 review risks losing freshly-introduced material before the
  ladder ever gets a chance to reinforce it.
- **Why "a single Tier 1 touch is probably sufficient" is a reasonable
  working assumption, not a guarantee**: a documented real-world
  graduated-interval implementation schedules its first review one day
  after initial learning and its second review four days after *that* —
  landing around day 5 overall, close to what Tier 1 (day ~1) followed by
  Stabilizing's existing day-4 cadence already produces. Precedent, not
  proof for this specific case — see
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#introduction-window-review-scheduling-tier-1--tier-2)
  for the monitoring plan this justifies instead of building a second rung
  preemptively.
- **Why Tier 2 is allowed to flex (roll later) instead of failing when
  delayed under introduction-window budget pressure**: research on spacing
  found that as the gap between study and review increases past the
  optimal point, performance costs rise slowly and gradually — but
  reviewing *too early* costs very little. That asymmetry is why it's safe
  to let Tier 2 reviews absorb schedule pressure by rolling later, while
  Tier 1 (protecting against the steep, fast early-decay window) is
  treated as far less flexible.
- **Independent validation for transitions/combos**
  ([Data-Model.md#practice-chunks-vs-sections-vs-transitions-vs-combos-vs-run-throughs](Data-Model.md#practice-chunks-vs-sections-vs-transitions-vs-combos-vs-run-throughs)):
  a well-documented study of an expert concert pianist's practice found she
  relied heavily on retrieval practice — repeatedly testing recall from
  memory rather than passively repeating — organized around the piece's
  formal structure, to make retrieval automatic from memory rather than
  rote. A genuine, independent research basis for why transitions (seam
  drills) and combos (odd-entry-point blocks,
  [Product-Principles.md#maximize-long-term-repertoire-not-just-todays-session](Product-Principles.md#maximize-long-term-repertoire-not-just-todays-session))
  matter, beyond the intuition they were originally designed from.

New hand-picked constants this design introduces (not yet in code — will
need the same "not derived from a study" tracking as the table above once
implemented):

| Constant | Value | What it should eventually be backed by |
|---|---|---|
| Ladder stage intervals | Stabilizing 4d / Settling 7d / Holding starts 14d, expands ~1.5–2×, caps ~8–12wk | Same forgetting-curve-shape question already open below, specifically for a *practiced-then-consolidated* passage rather than a freshly-introduced one |
| Graduation pass-count | 4 consecutive full passes (Stabilizing and Settling) | Motor-learning research on repetitions-to-consolidation, same open question as `REQUIRED_REPS` above |
| Tempo floors | Settling ~70–75%, Holding starts ~85% +5/pass, caps 100% | Real data on what tempo fraction predicts durable retention vs. just current fluency |
| `practiceBPM` step sizes | +2 full pass / −2 soft miss / ~−8 to −10 real fail | Real variance in how learners actually respond to incremental tempo pressure |
| Revival auto-trigger thresholds | stop count > 5; 2+ chunks (or 1 combo) lost in a run-through; 60+ days untouched | Product judgment calls, not research-backed — flagged here so that's explicit |

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
  (relevant to [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) Stage 4)
  — a candidate answer is now designed (the Holding stage: 14 days
  expanding to an 8–12 week cap, see the spaced-repetition ladder section
  above), but it's a hand-picked starting guess, not validated against any
  real retention data yet.

## Why this matters now

[Roadmap.md](Roadmap.md) item 4 — a genuinely *learned* (not hand-tuned)
confidence/interval model — is explicitly gated on having enough session
history to tune against. This document is where that tuning should start:
before building a learned model, get an honest answer to "which of today's
hand-picked constants would a learned model even need to replace," which is
exactly the table above.
