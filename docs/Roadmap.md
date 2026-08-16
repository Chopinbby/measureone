# Roadmap

> **Purpose:** What's built, what's next, and in what priority order — kept
> current rather than treated as a historical log (that's [Decisions.md](Decisions.md)'s
> job).
> **Audience:** Anyone deciding what to work on next — future-you, collaborators,
> future Claude Code sessions picking up unprompted work.
> **Scope:** Feature-level status and priority. Not the reasoning behind past
> decisions (see [Decisions.md](Decisions.md)) and not open design questions
> without a clear feature attached (see each doc's own "Open Questions").
> **Related:** [Decisions.md](Decisions.md) · [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) ·
> [Research.md](Research.md)
> **Update when:** A roadmap item ships (move it to "Done" or delete it and
> note it in [Decisions.md](Decisions.md) if the reasoning is worth keeping),
> or priority changes.

## Done

Setup wizard, chunking/timeline engine, Piece Map, Today's Practice (timer,
reps/BPM/effectiveness logging), Progress tab (rolling-window consistency,
consistency heatmap, actual-vs-planned, projected finish, tempo trend,
effectiveness calibration — plus, as of Pass 20, confidence-by-difficulty
and recurring-material payoff, folded in when the separate Analytics tab
was removed; see [Decisions.md](Decisions.md#ux)), multi-piece support, rescheduling, section
run-throughs, reference recordings, multi-movement works (movements as
self-contained sibling pieces sharing a `workId` — see
[Decisions.md](Decisions.md#multi-movement-works)), backup export/import,
`computeConfidenceAsOf` (used by Progress's "most improved" stat), Revival
(MVP slice — entry flow, chunk/transition reassessment reusing
`manualConfidence`, manual flagging (a boolean `weakSpot` at the time;
merged into Pass 6's tri-state rough/lost `progress[id].flag` — see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)),
revival plan generation, tempo ladder, random start generator, memory
anchors — see [Decisions.md](Decisions.md#revival) and
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md)).

Explicitly **not** part of that Revival slice, and still not built:
Maintenance mode, Performance Preparation mode, automatic lifecycle-state
detection (Learning / Performance Ready / At Risk / etc.), cross-piece
repertoire health dashboards, and reading/memory/technical diagnosis
tagging beyond the manual flag. See
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) for where these fit.

Pause/Archive (`piece.status`, set from Settings — pulls a piece off the
Master Agenda and suppresses "behind schedule," with no change to how
confidence decays; see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#pause--archive-built)) —
this is **not** Maintenance mode above, just a manual visibility toggle. The
"what does learned mean" question it used to be blocked on is now resolved
in design (see item 2 below) — Pause/Archive still doesn't need it answered,
though, since it's scoped to "take this off my daily agenda" regardless.

## Immediate next action

Nothing is currently singled out here. The previous occupant — "fold
Analytics into Progress and remove the Analytics tab" — **shipped in Pass
20** (see the Done section above and
[Decisions.md](Decisions.md#ux) for the pinned-down panel placement).
Pick the next thing from the priority-ordered backlog below rather than
assuming this section is stale.

## Priority-ordered backlog

1. **Practice journal** — free-text notes per session (distinct from
   `piece.notes`, which is about the piece as a whole, not a specific
   session).
2. **Long-term / maintenance scheduling** — what happens after a piece is
   "learned." **Fully designed; the stage-math engine is built and live**:
   a continuous spaced-repetition ladder (Stabilizing → Settling →
   Holding) that every chunk/transition/combo now actually advances
   along, driven by a three-tier session outcome (full pass/soft
   miss/real fail) with a per-chunk `practiceBPM` ratchet
   (`computeLadderAdvance`, `src/lib/ladder.js`, called from
   `handleLogSession` on every logged session) — see
   [Data-Model.md](Data-Model.md#the-piece-object) and
   [Algorithms.md#session-outcomes--the-maintenance-ladder](Algorithms.md#session-outcomes--the-maintenance-ladder).
   **The Tier 1/Tier 2 split resolving budget contention during the
   front-loaded introduction window is also built** (`computeTimeline`,
   `src/lib/scheduling.js` — see
   [Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler)
   rule 4). **Post-run-through logging is also built**: the consolidation-day
   checklist captures a stop count, and the Piece Map's rough/lost flag
   demotes a chunk's ladder stage and pins its next review to today (see
   [Repertoire-Lifecycle.md#post-run-through-logging](Repertoire-Lifecycle.md#post-run-through-logging)).
   **Revival's three independent auto-triggers are also built** (Pass 7):
   stop count > 5 on a run-through, a combo or 2+ regular chunks flagged
   lost, or 60+ days since anything logged — any one offers a revival from
   Overview rather than requiring the learner to remember to start one
   themselves (combo escalation *within* an already-triggered revival was
   already built separately — see
   [Repertoire-Lifecycle.md#revival-auto-triggers](Repertoire-Lifecycle.md#revival-auto-triggers)
   for both). **Still not implemented**: a live "what's due" query that
   works *beyond* the current plan's bounded length, so maintenance
   reviews can actually surface to the learner once a piece runs past its
   original plan. **Now scoped, ahead of building it (Pass 8)**: it
   surfaces in both Master Agenda and the per-piece Today tab via one
   shared function (`computeDueReviews`), suppressed for paused/archived
   pieces and pieces mid-revival. This is also what resolves "what does
   learned mean" (Stage 3), once
   something queries "is every chunk's stage at Holding" — see
   [Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built)
   for the full design and [Decisions.md](Decisions.md#spaced-repetition--maintenance)
   for the decision records. Repertoire rotation (multiple pieces
   competing for daily practice time while in maintenance) remains
   genuinely undesigned — see
   [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-5--repertoire-rotation-not-built).
3. Printable/exportable reports, teacher mode, calendar integration —
   explicitly deprioritized until adaptive scheduling (above) is solid.
4. A genuinely *learned* (not hand-tuned) confidence/interval model — see
   [Research.md](Research.md) for what groundwork this needs first. Gated on
   having enough session history to tune against.
5. Cloud sync / accounts / multi-device — everything is `localStorage`
   today, single browser only.

## Housekeeping (not urgent, but compounding)

- Rename practice-chunk `kind: "section"` to avoid the naming collision with
  `piece.sections`.
- Centralize the `0.65` efficiency constant (currently a magic number
  repeated in three places) as a named constant alongside `EFFORT_TO_MIN`
  and `LIBERAL_FACTOR` — see [Research.md](Research.md).
- Resolve whether `computeConfidence` and `computeProgressTier` should be
  unified, kept deliberately separate with clearer naming, or one should be
  retired — see [Data-Model.md](Data-Model.md#the-two-how-good-is-this-chunk-scores--dont-conflate-them).
