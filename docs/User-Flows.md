# User Flows

> **Purpose:** Walk through the main paths a user takes through the app, end to
> end, so a change's ripple effects across screens are visible before you make it.
> **Audience:** Human developers and future Claude Code sessions planning a
> feature or bug fix that touches more than one tab.
> **Scope:** What the user does and sees, screen by screen. The underlying
> computation for each step lives in [Algorithms.md](Algorithms.md); the exact
> data shapes live in [Data-Model.md](Data-Model.md); the component that renders
> each screen is named here but documented fully in [Architecture.md](Architecture.md).
> **Related:** [Algorithms.md](Algorithms.md) · [Data-Model.md](Data-Model.md) ·
> [UX-Principles.md](UX-Principles.md)
> **Update when:** A flow gains, loses, or reorders a step — this doc should
> always match what a user would actually experience clicking through the app.

## 1. Setting up a new piece

Entry points: "Start a new piece" (empty state), "Add new piece" (Overview,
sidebar switcher, Settings).

`Wizard` walks through six steps: **Piece → Sections → Difficulty → Repeats →
Timeline → Review**. Each step's fields are the same shared editor components
used later in Settings (`BasicsFields`, `SectionsEditor`, `DifficultyEditor`,
`RecurringEditor`, `ScheduleFields`, `BpmZonesEditor`, `RecordingsEditor`,
`DocumentsEditor`) — see
[Product-Principles.md](Product-Principles.md#shared-editors-not-divergent-flows).
The Review step shows a `ManuscriptStrip` preview of the generated chunks
before the piece is created. Completing the wizard calls
`generateAllChunks` + `computeTimeline` for the first time and persists the
new piece to `localStorage`.

Step 1 is also where the user says whether this is a single piece or one
movement of a larger work, and whether they're learning it fresh or reviving
it. Both toggles are on the same step as the basics; the multi-movement one
lives inside `BasicsFields` so Settings gets it too (a standalone piece can be
promoted into a work later by typing a work title there).

**Since Pass 24, step 1 also carries four optional extras that don't gate
advancing past it:** target tempo (BPM) is now a `BasicsFields` field, so it
moved here from the Timeline step; below it, three collapsible-by-scrolling
panels offer Tempo zones (`BpmZonesEditor`), Recordings (`RecordingsEditor`),
and Documents (`DocumentsEditor`) — the same components Settings uses,
rendered directly in `Wizard.jsx` rather than folded into `BasicsFields`
itself, specifically so they don't *also* duplicate into Settings' "Piece"
panel (Settings keeps its own separate "Tempo zones"/"Recordings"/"Documents"
panels, unchanged, for editing after setup). None of the four are required —
`canAdvance()` for step 1 only checks name and total measures, same as
before. The Timeline step no longer has a target-tempo field; it only sets
the schedule itself (start date, deadline vs. minutes/day, practice days per
week, chunk size).

The Wizard is **create-only** — an existing piece is never edited through it;
editing always goes through Settings instead.

### 1a. Adding a movement to an existing work

"Add a movement" on the Overview `PartSwitcher` reopens the same wizard with a
`joinWork` prop, so the new movement starts already attached: work title
preseeded and locked, composer inherited, single-vs-multi toggle hidden. Every
other step runs normally — a movement is set up exactly like any other piece,
because that's what it is. See
[Data-Model.md](Data-Model.md#works-multi-movement-pieces).

## 2. The daily practice loop

Entry point: the Today tab, or clicking a day card in Timeline
(`handleSelectDay`, which sets `dayOverride` and jumps to Today).

1. `ScheduleBanner` shows if any chunks are behind schedule
   (`computeScheduleStatus`) and offers rescheduling — see flow 4.
2. `FocusPanel` surfaces what most needs attention right now, independent of
   what's scheduled for today.
3. `DayChecklist` lists today's actual scheduled items (new chunks, reviews,
   transitions, combos). Each `ChecklistItem` has a start/stop timer (or a
   manual minutes field, which wins over the timer when filled) and clean
   reps / BPM-achieved inputs, auto-classified into a pass/soft-miss/fail
   outcome (not a free-standing "effectiveness" rating); checking it off
   calls `submitLog()` directly once those inputs are valid (see
   [UX-Principles.md](UX-Principles.md#direct-manipulation-over-confirmation-ceremony)).
   **Since Pass 23**, each item also carries an inline, editable free-text
   note (reusing `piece.memoryAnchors`, labeled "Notes" in the UI) — "+ Add
   a note" / "Edit note," committing on blur.
4. `SectionRunThroughPanel` appears once it has anything to show — see
   [Algorithms.md](Algorithms.md#section-run-throughs) for exactly when a
   run-through unlocks.
5. `ReassessPanel` is available for re-rating difficulty on today's measure
   ranges after practicing them — see flow 5.

Today has four view modes, not just one: **Day view** (the numbered steps
above), **Week** (added Pass 22 — 7 day-cards, current day highlighted,
read-only; click a day to jump into Day view for it — see
[Decisions.md](Decisions.md#ux) for why it's navigation-only, never a second
place to log), **"View all"**, which shows every day's checklist at once
instead of just the current day, and **Interleaved** (added Pass 29 —
rotates through chunks that have graduated past Stabilizing, one at a time
on a timer, reusing the same rep/BPM inputs as Day view; disabled with an
inline reason if nothing qualifies yet). Interleaved mode adds two things
Day view doesn't have: "Skip, just save time" (records the time without
logging an outcome), and a rough auto-classified result gets saved
*provisionally* — the learner confirms or discards it later, from that
chunk's card anywhere it's shown, rather than it silently affecting the
ladder right away. Leaving Interleaved mode with an unresolved provisional
still pending (switching view, tab, or piece) prompts a confirmation first.
See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29)
for the full mechanism.

## 3. Checking in: Overview vs. Progress

These two tabs answer different questions and are not interchangeable —
see [UX-Principles.md](UX-Principles.md#glanceable-state-vs-diagnostic-trend-are-different-screens):

- **Overview**: "where do things stand right now" — measures/sections
  learned, total time practiced, overall progress %, and a practice-progress
  bar broken down by `computeProgressTier`.
- **Progress**: "how is it actually going" — rolling-window consistency,
  consistency heatmap, most-improved-this-week, actual-vs-planned chart,
  projected finish date, tempo trend sparklines, outcome breakdown,
  confidence-by-difficulty, recurring-material time savings, and recent
  practice history.

**There was a third tab, Analytics — it is gone as of Pass 20.** Its two
panels (confidence-by-difficulty, recurring-material payoff) now sit near
the bottom of Progress, after the outcome breakdown and before the practice
log; the metrics were relocated unchanged, not redesigned. See
[Decisions.md](Decisions.md#ux) for the placement reasoning.

## 4. Falling behind and rescheduling

1. `computeScheduleStatus` flags a chunk as missed only once its scheduled
   introduction day has passed with zero logged sessions (see
   [Algorithms.md](Algorithms.md#behind-schedule-detection) — this is a
   deliberately narrow trigger, not a same-day comparison).
2. `ScheduleBanner` surfaces the count and a "Reschedule remaining days"
   action, shown on both Overview and Today.
3. `handleReschedule` estimates whether the remaining material can
   realistically fit in the remaining days at the current pace. If it can't,
   the confirmation dialog escalates from a mild confirm to an explicit
   warning naming the shortfall, and suggests extending the timeline in
   Settings instead.
4. Confirming sets `piece.rescheduleMarker`; `getEffectiveTimeline` then
   keeps every already-passed day exactly as it was and repacks only the
   untouched chunks into the days that remain.

**Since Pass 21, this also has a multi-piece form.** Master Agenda's
Learning-phase tab shows a "Reschedule all" panel whenever one or more
active pieces are behind, naming the count. Confirming it applies the same
`rescheduleMarker` write to every eligible piece at once — each anchored to
its *own* current day, not a shared one — behind a single confirmation that
names which pieces (if any) probably won't fit at the current pace, same
underlying `estimateRescheduleFit` check the single-piece dialog uses. See
[Decisions.md](Decisions.md#scheduling) for the eligibility rules (paused/
archived/mid-revival/past-plan pieces are left out) and the storage-safety
fix behind it.

**Also on Master Agenda, since Pass 21:** "Pick a random piece to practice"
switches the active piece to a random one that has real work today
(scheduled learning or a due maintenance review) — offered only once two or
more pieces qualify. The Maintenance-due tab has a parallel "Random start"
panel (the same mechanism `RevivalTab` already used to suggest a starting
point) pooling every due spot across every piece, so a review session
doesn't always start at the top of the same list.

## 5. Reassessing difficulty mid-practice

From `ReassessPanel` (surfaced in Today, scoped to today's measure ranges):
pick a measure range and a new difficulty level, hit Apply. This writes
directly into `piece.measureDifficulty` for that range and closes the panel
in the same action — matching how difficulty was originally entered at setup
(per-measure, not per-chunk). There is no undo for this — see
[Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about).

## 6. Multi-piece switching

The sidebar's piece-switcher trigger opens a list of every piece in
`pieces`; selecting one calls `switchToPiece`, which updates `activePieceId`
(and the persisted `measureone-active_piece_id` key). "Add new piece" is
reachable from the switcher, the Overview top row, and Settings.

**Since Pass 29 follow-up**, switching pieces (or navigating to a different
sidebar tab, or clicking "Edit piece") while the piece you're leaving has
Interleaved mode open with an unresolved provisional log first asks for
confirmation — see flow 2 above and
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29).
Every other case is unaffected: switching pieces with nothing pending still
happens in one click, no confirmation.

Movements of the same work are grouped under the work title in that list
(`groupPiecesByWork`), and are additionally switchable from the `PartSwitcher`
strip on the Overview of any movement — same `switchToPiece` call, just a
closer-to-hand entry point while working within one work.

## 7. Backup and restore

Settings exposes **Export all** (`handleExportAll`, downloads every piece as
a single JSON file) and **Import a backup** (`handleImportClick` →
`handleImportFile`, also reachable from the empty state when there's no
active piece). This is the only backup mechanism — there is no cloud sync
(see [Roadmap.md](Roadmap.md)), so this JSON export is the only way data
survives clearing browser storage or moving to a new browser/device.
