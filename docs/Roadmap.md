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
reps/BPM/effectiveness logging — **since Pass 22** also a read-only "Week"
view alongside Day view/View all, see
[Decisions.md](Decisions.md#ux); **since Pass 23** a free-text note per
chunk, editable inline during logging, not just from the Piece Map), Progress
tab (rolling-window consistency, consistency heatmap, actual-vs-planned,
projected finish, tempo trend, effectiveness calibration — plus, as of Pass
20, confidence-by-difficulty, folded in when the separate Analytics tab was
removed; see [Decisions.md](Decisions.md#ux). The other folded-in panel,
recurring-material payoff, was removed again in Pass 32b — pure display
removal, the underlying scheduling-effort discount is untouched), multi-piece
support, rescheduling (**since Pass 21** also a multi-piece "Reschedule all"
from Master Agenda, plus "Pick a random piece to practice" and a
maintenance-due random-start panel — see
[Decisions.md](Decisions.md#scheduling); a piece whose remaining work
doesn't fit the days left now offers a concrete way out inline — extend the
target date, or extend the plan directly in "minutes per day" mode — rather
than just a warning, see [Decisions.md](Decisions.md#scheduling); **since
Pass 46–48**, the Timeline tab shows completion states and its own
reschedule entry point, Today's Practice has an alternative "go to the
earliest unfinished day" action alongside Reschedule, a fully-rescheduled
day collapses instead of showing its stale task list, and rescheduling the
same piece more than once now correctly chains through its whole history
instead of losing what an earlier reschedule had placed — see
[Decisions.md](Decisions.md#scheduling)), section
run-throughs, reference
recordings and (**since Pass 24**) reference documents (sheet music PDFs,
fingerings — same shape and pattern as recordings; see
[Data-Model.md](Data-Model.md#the-piece-object)), multi-movement works
(movements as self-contained sibling pieces sharing a `workId` — see
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
this is **not** Maintenance mode above, just a manual visibility toggle.
Pause is unconditional, still scoped to "take this off my daily agenda"
regardless of plan state. **Archive is not, as of the same session as Pass
43/45**: it's now disabled until `isPlanActuallyComplete` says the piece's
plan is actually finished (see
[Decisions.md](Decisions.md#lifecycle)) — a real, deliberately unresolved
gap this opened is that a piece genuinely abandoned mid-plan (not finished,
never going to be) can't be archived under this rule; see
[Decisions.md](Decisions.md#open-questions).

**Since Pass 29**, Today's Practice has a fourth view mode, **Interleaved
practice** — rotates chunks that have graduated past Stabilizing
(settling/holding), reusing the existing logging path; a "skip" action
saves time without marking a day done or touching the ladder; an
auto-classified soft-miss/fail logged mid-rotation is saved
**provisionally** (real reps/BPM, ladder untouched) until confirmed or
discarded, since interleaved retrieval often looks rougher than blocked
practice while still being more effective. Leaving Interleaved mode with
an unresolved provisional now warns and discards on confirmation. See
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29)
and [Decisions.md](Decisions.md#spaced-repetition--maintenance).
**Since Pass 30**, Piece Map also surfaces a live-derived "tempo climbing"
nudge (a tile marker plus a modal suggestion, +15–30 BPM) when a chunk's
recent sessions show a real upward BPM trend — no new persisted state,
suggestion overlay only, doesn't touch scoring or the ladder. See
[Algorithms.md](Algorithms.md#tempo-climbing-nudge-pass-30).

**Since Pass 31**, the per-chunk dynamic method-suggestion tip
(`suggestMethods()`) is gone, replaced with static instructional copy in
`ChecklistItem` — see
[Product-Principles.md](Product-Principles.md#recommend-the-highest-impact-next-action).
**Since Pass 38**, the Overview "Start/Continue revival" button is
promoted to a `primary-btn`, and revival-mode copy across Overview,
Revival, and Master Agenda was reworked to read less clinically — see
[Decisions.md](Decisions.md#revival) for what that dropped (the revival
tab no longer surfaces why a revival was started or when the piece was
last played, anywhere).

**Since Pass 32a**, the sidebar piece switcher is user-reorderable
(persisted `piece.sortOrder`, up/down controls per row, whole-work blocks
move together) — see [Decisions.md](Decisions.md#ux) and
[Data-Model.md](Data-Model.md#the-piece-object).

**Since Pass 42**, there's a first cross-piece summary: `AllPiecesTab`, one
row per piece (progress %, confidence %, days since last touched, time
practiced *this week*) plus a this-week-total stat, a 14-day cross-piece
consistency heatmap, and a "Back to {current piece}" button — reached via
a "View all pieces" button on Progress rather than a new `NAV_BASE` entry.
See [Architecture.md](Architecture.md) for the component and exactly which
functions it calls, and [Decisions.md](Decisions.md#cross-piece-views) for
the scope/placement reasoning, why confidence here can drift slightly from
other screens for an overdue piece, and why "time practiced" is scoped to
the current week rather than all-time. This is *not* the "cross-piece
repertoire health dashboards" item mentioned above under Maintenance mode
— no lifecycle-state detection, no health scoring, just a summary table
and a heatmap. The consistency view was originally deferred out of the
first version as new-aggregation-logic-from-scratch (see Decisions.md);
it was built once actually requested, reusing each session's `loggedDate`
rather than writing anything genuinely new to the confidence/scheduling
engine.

## Immediate next action

Nothing is currently singled out here. The previous occupant — "fold
Analytics into Progress and remove the Analytics tab" — **shipped in Pass
20** (see the Done section above and
[Decisions.md](Decisions.md#ux) for the pinned-down panel placement).
Pick the next thing from the priority-ordered backlog below rather than
assuming this section is stale.

## Priority-ordered backlog

1. **Practice journal** — free-text notes per *session* (distinct from
   `piece.notes`, about the piece as a whole, and from the **now-built**
   Pass 23 per-*chunk* note in `piece.memoryAnchors` — labeled "Notes,"
   editable inline from `ChecklistItem` or the Piece Map. A chunk note is
   one persistent string per chunk, shown the same way regardless of which
   session it was written during or after; this item is still about a
   note tied to one specific logged attempt, which nothing currently
   captures. Not started.
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
   for both). The live "what's due" query that works *beyond* the current
   plan's bounded length (Pass 8, `computeDueReviews`) surfaces in both
   Master Agenda and the per-piece Today tab, suppressed for
   paused/archived pieces and pieces mid-revival. **"What does learned
   mean" (Stage 3) is now resolved *and* implemented, not just resolved
   (Pass 39)**: `isPieceLearned(piece, chunkSet)` (`src/lib/ladder.js`)
   finally queries "is every chunk's stage at Holding" — it's a live
   derivation, not a persisted piece-level state, and it's already
   load-bearing: `isPlanActuallyComplete` (`src/lib/scheduling.js`) reads
   it to decide whether a `scheduleMode: "minutes"` piece should keep
   auto-extending its own plan or finally read as complete, and the same
   function replaced the old calendar-only "has this piece run past its
   plan" check everywhere that question is asked (Today's Practice, Master
   Agenda, the schedule-behind banner, bulk "Reschedule all" eligibility).
   See
   [Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built)
   and [Decisions.md](Decisions.md#scheduling) for the mechanics, and
   [Decisions.md](Decisions.md#open-questions) for what's still queued
   behind it — a first-class *persisted* "learned" state (gating revival
   entry behind maintenance needs one; the live derivation alone isn't
   that). Repertoire rotation (multiple pieces
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
