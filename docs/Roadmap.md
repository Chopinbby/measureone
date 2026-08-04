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
effectiveness calibration), multi-piece support, rescheduling, section
run-throughs, reference recordings, multi-movement works (movements as
self-contained sibling pieces sharing a `workId` — see
[Decisions.md](Decisions.md#multi-movement-works)), backup export/import,
`computeConfidenceAsOf` (used by Progress's "most improved" stat), Revival
(MVP slice — entry flow, chunk/transition reassessment reusing
`manualConfidence`, weak-spot flagging, revival plan generation, tempo
ladder, random start generator, memory anchors — see
[Decisions.md](Decisions.md#revival) and
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md)).

Explicitly **not** part of that Revival slice, and still not built:
Maintenance mode, Performance Preparation mode, automatic lifecycle-state
detection (Learning / Performance Ready / At Risk / etc.), cross-piece
repertoire health dashboards, and reading/memory/technical diagnosis
tagging beyond the manual weak-spot flag. See
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md) for where these fit.

Pause/Archive (`piece.status`, set from Settings — pulls a piece off the
Master Agenda and suppresses "behind schedule," with no change to how
confidence decays; see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#pause--archive-built)) —
this is **not** Maintenance mode above, just a manual visibility toggle,
still blocked on the same "what does learned mean" question.

## Immediate next action

**Fold Analytics into Progress and remove the Analytics tab.** This was
agreed on but not yet executed — as of this writing `AnalyticsTab` still
exists and is still wired into the sidebar `NAV`. Scope, per the original
decision (see [Decisions.md](Decisions.md)):

- Move the confidence-by-difficulty panel and the recurring-material-payoff
  panel into `ProgressTab`.
- Remove the Analytics entry from `NAV` and delete `AnalyticsTab`.
- While in the same pass: the old "Tempo progress" BPM-bars panel (if any
  remnant remains) is superseded by Progress's tempo trend sparklines and
  should not coexist with them.
- Exact placement of the two folded-in panels within Progress's layout was
  never pinned down precisely beyond "near the effectiveness calibration
  panel, somewhere unobtrusive" — decide this when implementing rather than
  guessing from this doc.

## Priority-ordered backlog

1. **Practice journal** — free-text notes per session (distinct from
   `piece.notes`, which is about the piece as a whole, not a specific
   session).
2. **Long-term / maintenance scheduling** — what happens after a piece is
   "learned": spaced maintenance reviews, repertoire rotation. Blocked on
   resolving what "learned" formally means — see
   [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-informally-defined-today).
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
