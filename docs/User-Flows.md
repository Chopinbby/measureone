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
promoted into a work later by typing a work title there). Choosing "Multiple
movements" makes the work title itself required to advance — `canAdvance()`
blocks "Next" if it's blank, the same way a blank piece name or zero measures
already did. Settings' "Save changes" enforces the identical rule when
editing an existing piece. See
[Decisions.md](Decisions.md#multi-movement-works) for why (clearing an
existing multi-movement piece's title in Settings used to silently detach it
from its work).

**Since Pass 24, step 1 also carries four optional extras that don't gate
advancing past it:** target tempo (BPM) is now a `BasicsFields` field, so it
moved here from the Timeline step; below it, three collapsible-by-scrolling
panels offer Tempo zones (`BpmZonesEditor`), Recordings (`RecordingsEditor`),
and Documents (`DocumentsEditor`) — the same components Settings uses,
rendered directly in `Wizard.jsx` rather than folded into `BasicsFields`
itself, specifically so they don't *also* duplicate into Settings' "Piece"
panel (Settings keeps its own separate "Tempo zones"/"Recordings"/"Documents"
panels, unchanged, for editing after setup). None of the four gate advancing
past step 1 — `canAdvance()` there checks name and total measures always,
plus the work title specifically when "Multiple movements" is selected (see
above); target tempo, tempo zones, recordings, and documents stay fully
optional. The Timeline step no longer has a target-tempo field; it only sets
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

Entry point: the Today tab, clicking a day card in Timeline
(`handleSelectDay`, which sets `dayOverride` and jumps to Today), or —
since the same session as Pass 43/45 — Overview's "Continue learning" /
"Continue maintenance" button, which resets to real-time tracking rather
than jumping to a specific day.

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
4. `SectionRunThroughPanel` appears once it has anything to show — since
   Pass 49, that's not a one-time unlock but a repeating gate (due, then
   not due, then due again as practice continues), plus a locked/grayed
   preview the day before the next threshold is crossed; see
   [Algorithms.md](Algorithms.md#section-run-throughs) for exactly when.
5. **Since Pass 57**, `RandomStartPanel` appears once 2+ chunks/transitions/
   combos in the piece have 2+ logged sessions each — "Pick a starting
   point" picks one at random, so a practice session doesn't always start
   from the same place. Hidden entirely below that threshold.
6. **Since Pass 56**, `ColdStartPanel` appears once every section's own
   run-through has been logged at least once, at a widening gap (3, 7,
   14, 28, ... days) since the piece was last touched at all — a
   whole-piece cold play-through (no warm-up), logging average BPM and
   free-text notes. Not a persistent checklist item: it only renders on
   the day a new gap threshold is actually crossed, then goes quiet again
   until the next one. **Since Pass 58**, logging one also offers a
   short, optional "rate the piece overall right now?" prompt (five
   quick-tap options, or Skip) that feeds Progress's new "Overall
   confidence" stat — see flow 3 below.
7. `ReassessPanel` is available for re-rating difficulty on today's measure
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
  bar broken down by `computeProgressTier`. Since the same session as Pass
  43/45: a "Continue learning" / "Continue maintenance" button under the
  title card jumps straight into practice (see flow 2 above); and the
  "first week" list grays out past days and strikes through only the ones
  actually completed, with today's row noting "(behind N chunks)" when
  applicable — see [Decisions.md](Decisions.md#ux).
- **Progress**: "how is it actually going" — **since Pass 58, a piece-level
  "Overall confidence" stat sits at the top of the tab**: an
  effort-weighted average of every practice chunk's confidence, with an
  inline manual-override control (set/clear, same pattern as the Piece
  Map's per-chunk override) — see
  [Algorithms.md](Algorithms.md#overall-piece-confidence-pass-58). Below
  that: rolling-window consistency, consistency heatmap,
  most-improved-this-week, actual-vs-planned chart, **since Pass 51** an
  estimated-vs-actual practice time chart (every recently-practiced
  chunk/transition/combo/section-run-through, estimate vs. real logged
  minutes), projected finish date, tempo trend sparklines, outcome
  breakdown, confidence-by-difficulty, and recent practice
  history.

**There was a third tab, Analytics — it is gone as of Pass 20.** Its
confidence-by-difficulty panel sits near the bottom of Progress, after the
outcome breakdown and before the practice log; the metric was relocated
unchanged, not redesigned. See [Decisions.md](Decisions.md#ux) for the
placement reasoning. (The other Pass 20 fold-in, recurring-material
payoff, was removed outright in Pass 32b — see
[Decisions.md](Decisions.md#ux).)

**Since Pass 42, both of the above answer "how is *this* piece doing" —
a third, narrower question ("how is everything doing, at a glance") has a
first answer too: a "View all pieces" button on Progress opens
`AllPiecesTab`** — one row per piece (progress %, confidence %, days since
last touched, time practiced *this week*), a this-week-total stat, and a
14-day cross-piece consistency heatmap (any piece touched counts that
day). Not a sidebar tab — reached only from that button, same pattern the
Revival tab uses; a "Back to {current piece}" button in its own header
returns the way you'd expect. Clicking a row calls `switchToPiece`,
landing on that piece's Overview. See
[Decisions.md](Decisions.md#cross-piece-views) for what this still
doesn't do (no lifecycle health scoring) and the reasoning behind the
week-vs-all-time and heatmap-window choices.

## 4. Falling behind and rescheduling

1. `computeScheduleStatus` flags a chunk as missed only once its scheduled
   introduction day has passed with zero logged sessions (see
   [Algorithms.md](Algorithms.md#behind-schedule-detection) — this is a
   deliberately narrow trigger, not a same-day comparison).
2. `ScheduleBanner` surfaces the count and a "Reschedule remaining days"
   action, shown on Overview, Today, and (**since Pass 46**) Timeline — but
   only while the plan itself isn't *actually* finished yet
   (`isPlanActuallyComplete`, Pass 39). This is no longer just "has the
   calendar run out": a piece whose target date has already passed with
   real work still outstanding keeps showing this banner instead of going
   quiet. **Since Pass 47, Today's version of this same banner can carry a
   second button** — "Go to Day N" — that jumps to the earliest day with
   real incomplete work instead of rebalancing the plan; an alternative
   action, not a replacement, shown only when a chunk introduced before
   today is still untouched (Overview and Timeline don't get this second
   button, and render the banner exactly as before).
3. `handleReschedule` estimates whether the remaining material can
   realistically fit in the remaining days at the current pace. If it
   can't, the confirmation dialog names the shortfall and offers a way past
   it, branching by `scheduleMode` **and, as of Pass 39, by whether the
   piece's own plan has already fully elapsed**:
   - `"days"` mode, still inside its own plan (just tight): two buttons —
     change the target date to a suggested one, or reschedule into the
     existing window.
   - `"days"` mode, target date already fully passed: **one button
     only** — "Change target date." Cramming everything into what's
     effectively a single already-past day isn't offered here; it doesn't
     help and can leave the piece permanently unrecognized as behind
     schedule afterward (see [Decisions.md](Decisions.md#open-questions)).
   - `"minutes"` mode: always a single action — extend the plan to fit at
     the same pace, since this mode never had a target date to offer
     protecting.

   See [Decisions.md](Decisions.md#scheduling) for why these differ by
   `scheduleMode`.
4. Confirming sets `piece.rescheduleMarker` (and, when the dialog offered an
   extension, `daysToLearn`/`targetDate` too); `getEffectiveTimeline` then
   keeps every already-passed day as it stood the last time the schedule
   was actually recomputed, and repacks only the untouched chunks into the
   days that remain. **Since Pass 48**, a past day whose entire original
   task list ended up moved by this repacking — Timeline and Today's
   Practice alike — collapses to a plain "Tasks rescheduled" line instead
   of re-showing content that's now a stale duplicate of wherever it
   actually landed; a day with any real remaining content (done or still
   legitimately scheduled) is unaffected and renders in full. **Since the
   same pass's follow-up**, rescheduling the *same* piece more than once
   correctly carries forward what an earlier reschedule had actually placed
   — a real bug, not a hypothetical, where a second reschedule used to
   silently discard the first one's placements for the days in between,
   including a session someone had genuinely logged there. See
   [Algorithms.md](Algorithms.md#rescheduling) and
   [Decisions.md](Decisions.md#scheduling) for both mechanisms.

**Since Pass 39, Today's Practice can also show a second, separate banner**
below the "N chunks behind schedule" one: a `"days"`-mode piece whose
calendar has run out with real work still left, but where every *practice
chunk* specifically has already been touched (only a transition or focus
block is what's actually outstanding). In that narrower case there's
nothing the reschedule mechanism can act on — no day-placement problem
left to solve — so the banner says so plainly ("Nothing to reschedule —
check 'View all' to find it") with a button that switches to the "View
all" list instead of offering a Reschedule button that would do nothing.
A `"minutes"`-mode piece never gets either banner in this state — it
self-heals silently instead (below).

**Since Pass 39, Master Agenda mirrors the same distinction.** A
`"days"`-mode piece past its target date with real work remaining gets a
matching "Past its target date" card (previously it was simply omitted). A
`"minutes"`-mode piece in the equivalent state — including one sitting
inactive in the background, not the piece currently open — instead shows
its real, current scheduled content, computed live for display only
(nothing written to storage from Master Agenda itself); the actual,
persisted extension happens once that piece is opened directly. **Also
since Pass 39**, "Log practice" and "Pick a random piece to practice" on
Master Agenda land directly on Today's Practice for that piece rather than
Piece Overview — see flow 6 below.

**Since Pass 21, this also has a multi-piece form.** Master Agenda's
Learning-phase tab shows a "Reschedule all" panel whenever one or more
active pieces are behind, naming the count. Confirming it applies the same
`rescheduleMarker` write to every eligible piece at once — each anchored to
its *own* current day, not a shared one — behind a single confirmation that
names which pieces (if any) probably won't fit at the current pace, same
underlying `estimateRescheduleFit` check the single-piece dialog uses.
**Since Pass 39**, a `"days"`-mode piece whose plan has already fully
elapsed is no longer excluded from this list (it used to be, on the same
calendar-only check fixed everywhere else this pass) — and the bulk action
now also pushes its target date out automatically as part of the same
confirmation, named in its own sentence separately from pieces that are
merely tight. See [Decisions.md](Decisions.md#scheduling) for the
eligibility rules (paused/archived/mid-revival/actually-finished pieces are
still left out) and the storage-safety fix behind it.

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

`switchToPiece` normally lands on Piece Overview — the default second
argument. **Since Pass 39**, Master Agenda's "Log practice" (on any
learning-phase, maintenance-due, or "needs reschedule" card) and "Pick a
random piece to practice" pass `"today"` instead, landing directly on
Today's Practice for that piece rather than the dashboard — you clicked
something that means "go practice," so you land where you'd actually log
it. Revival's "Open piece →" button deliberately still lands on Overview,
unchanged — a revival-mode piece has its own separate tab, and Today's
Practice isn't a meaningful destination for it mid-revival.

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

**Since Pass 32a**, that list is user-reorderable: up/down controls on each
row move a standalone piece or an entire work as one block (never an
individual movement within a work — those stay ordered by creation date,
already grouped together regardless), writing a persisted `piece.sortOrder`
that the switcher — and every other piece-listing surface, including the
Export picker — sorts by instead of creation date. See
[Decisions.md](Decisions.md#ux).

## 7. Backup and restore

Settings exposes **Export all** (`handleExportAll`, downloads every piece as
a single JSON file) and **Import a backup** (`handleImportClick` →
`handleImportFile`, also reachable from the empty state when there's no
active piece). This is the only backup mechanism — there is no cloud sync
(see [Roadmap.md](Roadmap.md)), so this JSON export is the only way data
survives clearing browser storage or moving to a new browser/device.

**Since Pass 32a**, importing a backup that matches existing pieces also
offers a "keep what's here" / "use the imported order" choice for switcher
order — one pick for the whole import, not per piece, shown only when at
least one candidate actually matches something already here. See
[Decisions.md](Decisions.md#ux).
