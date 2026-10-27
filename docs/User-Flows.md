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

`Wizard` walks through seven steps: **Piece → Sections → Repeats →
Difficulty → Focus spots → Timeline → Review**. Every step but one reuses
the same shared editor components Settings uses later (`BasicsFields`,
`SectionsEditor`, `RecurringEditor`, `DifficultyEditor`, `ScheduleFields`,
`BpmZonesEditor`, `RecordingsEditor`, `DocumentsEditor`) — see
[Product-Principles.md](Product-Principles.md#shared-editors-not-divergent-flows).
**Focus spots (Pass 91, experimental v1) is the one exception**: a yes/no
toggle for `piece.troubleSpotsEnabled`, and — only when "Yes" — a
paginated, chunk-by-chunk spot editor (`FocusSpotsStep`) that exists only
in `Wizard.jsx`, not in Settings' shared `fields/` — see
[Decisions.md](Decisions.md#focus-spots-v1) for why this one step doesn't
follow the shared-editor pattern. The Review step shows a `ManuscriptStrip`
preview of the generated chunks before the piece is created. Completing the
wizard calls `generateAllChunks` + `computeTimeline` for the first time and
persists the new piece to `localStorage`.

Step 1 is also where the user says whether this is a single piece or one
movement of a larger work, and whether they're learning it fresh or reviving
it. Both toggles are on the same step as the basics; the multi-movement one
lives inside `BasicsFields` so Settings gets it too (a standalone piece can be
promoted into a work later by typing a work title there). Choosing "Multiple
movements" makes the work title itself required to advance — `canAdvance()`
blocks "Next" if it's blank, the same way a blank piece name or zero measures
already did. Settings' "Save changes" enforces the identical work-title
rule when editing an existing piece — see
[Decisions.md](Decisions.md#multi-movement-works) for why (clearing an
existing multi-movement piece's title in Settings used to silently detach it
from its work). **Since a later session, "Save changes" also mirrors the
Wizard's other two `canAdvance()` conditions** — a blank piece name or zero
total measures blocks saving there too, not just at setup time; see
[Decisions.md](Decisions.md#open-questions).

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
week, chunk size). **Since Pass 103**, `BasicsFields` also offers the
piece's key and other keys it passes through (both optional; also on
Settings' edit page) — scales in those keys get the "Repertoire in this
key" tag and come up more often on the Technique list (flow 9).

The Wizard is **create-only** — an existing piece is never edited through it;
editing always goes through Settings instead.

**Since Pass 93, Settings is split in two.** The Settings tab itself keeps
only what isn't about the current piece — "Pieces" (Add new piece) and
"Backup & restore" — plus a read-only "Current piece details" summary sitting
directly above the "Edit piece settings" button. Everything about the
current piece lives behind that button, on the "Edit piece settings" page,
which is also reachable from the sidebar on every tab (previously Overview
only). That page is a draft-and-save form (Save changes / Discard changes) —
including Focus spots, Revival settings (only while in revival) and "Mark as
learned elsewhere" (which asks "are you sure?" before it marks the draft) —
followed by a separate, clearly labelled **"Applies immediately"** group
below the Save/Discard row holding Practice status (Pause/Archive/Resume/
Reactivate) and Delete this piece, which act on the live piece the moment
they're clicked and are unaffected by Discard. The button was called "Edit
piece" before this pass.

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
than jumping to a specific day. **Since Pass 102**, on the real today the
shared Technique panel (today's scales, flow 9) sits right under the page
header, before the piece's own tasks — in the revival view too.

1. `ScheduleBanner` shows if any chunks are behind schedule
   (`computeScheduleStatus`) and offers rescheduling — see flow 4.
2. `FocusPanel` surfaces what most needs attention right now, independent of
   what's scheduled for today.
3. **Since Pass 91 (experimental v1)**, `FocusSpotsPanel` renders next,
   whenever any practice chunk has an unresolved focus spot — a
   `FocusSpotCard` per spot (not per chunk), reading `piece.progress`
   directly rather than the current day's own schedule, so a spot on a
   chunk that isn't introduced yet is still reachable. Each card gates on
   a minimum practice time (`piece.troubleSpotDefaultMinutes`, default 5)
   before either action button enables — a countdown timer counting down
   to that target, then up past it once met. "Not yet, log time" logs the
   time and leaves the spot open; "Yes, log BPM" resolves it. See
   [Algorithms.md](Algorithms.md#focus-spots-v1).
4. `DayChecklist` lists today's actual scheduled items (new chunks, reviews,
   transitions, combos). Each `ChecklistItem` has a start/stop timer (or a
   manual minutes field, which wins over the timer when filled) and clean
   reps / BPM-achieved inputs, auto-classified into a pass/soft-miss/fail
   outcome (not a free-standing "effectiveness" rating); checking it off
   calls `submitLog()` directly once those inputs are valid (see
   [UX-Principles.md](UX-Principles.md#direct-manipulation-over-confirmation-ceremony)).
   **Since Pass 23**, each item also carries an inline, editable free-text
   note (reusing `piece.memoryAnchors`, labeled "Notes" in the UI) — "+ Add
   a note" / "Edit note," committing on blur. **Since Pass 90**, a day can
   also show read-only cards for something genuinely completed there that
   the live schedule no longer lists on that day (a transition/combo
   Pass 90's own smoothing relocated, or a review whose due date has since
   moved past this occurrence) — no timer/inputs/log button, just the
   logged outcome and a link to wherever the item is scheduled now. See
   [Algorithms.md](Algorithms.md#historical-cards-on-daily-practice).
5. `SectionRunThroughPanel` appears once it has anything to show — since
   Pass 49, that's not a one-time unlock but a repeating gate (due, then
   not due, then due again as practice continues), plus a locked/grayed
   preview the day before the next threshold is crossed; see
   [Algorithms.md](Algorithms.md#section-run-throughs) for exactly when.
   **Since Pass 68**, it only appears while looking at real "today" —
   browsing to a past or future day hides it entirely, in every view mode
   (Day view, Week, View all, Interleaved alike), rather than showing
   today's live due-state mislabeled as that day's own.
6. **Since Pass 57**, `RandomStartPanel` appears once 2+ chunks/transitions/
   combos in the piece have 2+ logged sessions each — "Pick a starting
   point" picks one at random, so a practice session doesn't always start
   from the same place. Hidden entirely below that threshold.
7. **Since Pass 56**, `ColdStartPanel` appears once every section's own
   run-through has been logged at least once, at a widening gap (3, 7,
   14, 28, ... days) since the piece was last touched at all — a
   whole-piece cold play-through (no warm-up), logging average BPM and
   free-text notes. Not a persistent checklist item: it only renders on
   the day a new gap threshold is actually crossed, then goes quiet again
   until the next one. **Since Pass 58**, logging one also offers a
   short, optional "rate the piece overall right now?" prompt (five
   quick-tap options, or Skip) that feeds Progress's new "Overall
   confidence" stat — see flow 3 below.
8. `ReassessPanel` is available for re-rating difficulty on today's measure
   ranges after practicing them — see flow 5.
9. **Since Pass 97**, right below it, a "Split a chunk" panel appears when at
   least one chunk practiced today is 2+ measures — see flow 5a. It's absent
   otherwise (no empty message), and never shown in Interleaved mode.

Today has four view modes, not just one: **Day view** (the numbered steps
above), **Week** (added Pass 22 — 7 day-cards, current day highlighted,
read-only; click a day to jump into Day view for it — see
[Decisions.md](Decisions.md#ux) for why it's navigation-only, never a second
place to log), **"View all"**, which shows every day's checklist at once
instead of just the current day, and **Interleaved** (added Pass 29 —
rotates through chunks that have graduated past Stabilizing, one at a time
on a timer sized to the chunk's own difficulty since Pass 69, reusing the
same rep/BPM inputs as Day view; **since Pass 69**, needs at least two
qualifying chunks anywhere in the piece to enable, with a distinct inline
hint below that threshold). Interleaved mode adds two things
Day view doesn't have: "Skip, just save time" (records the time without
logging an outcome), and a rough auto-classified result gets saved
*provisionally* — the learner confirms or discards it later, from that
chunk's card anywhere it's shown, rather than it silently affecting the
ladder right away. Leaving Interleaved mode with an unresolved provisional
still pending (switching view, tab, or piece) prompts a confirmation first.
**Since Pass 94**, the "Interleaved practice" button is also the way out: in
Interleaved mode it reads "Exit interleaved practice" and returns to Day
View, through the same leave-confirmation as every other exit. The
"needs two qualifying chunks" disable applies only to *entering* — if the
pool drops below two mid-session the exit button stays clickable.
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
  actually completed, with today's row noting "(behind N days)" — a
  day-count, not a chunk-count, **since Pass 70** — when applicable. **Since
  a later session, that note is suppressed while a revival is active** —
  it's judged against the piece's original, pre-revival plan, which isn't
  the plan actually being followed mid-revival — see
  [Decisions.md](Decisions.md#ux) and
  [Decisions.md](Decisions.md#open-questions).
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
day). Not a sidebar tab — reached only from that button (the old Revival
tab worked the same way, before Pass 88 folded revival into Daily
Practice itself — see [Decisions.md](Decisions.md#revival)); a "Back to {current piece}" button in its own header
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
   action, not a replacement. **As of Pass 67, shown whenever the
   earliest-behind-day scan itself finds a day** (`classifyDayCompletion`-
   based, covers every scheduled item type — new chunks, reviews,
   transitions, combos) — not gated on the narrower, practice-chunk-only
   pre-check this used to have, which could hide the button even when a
   past transition or review was genuinely still incomplete (Overview and
   Timeline don't get this second button, and render the banner exactly as
   before). **Since Pass 94, it's hidden while you're already browsing that
   earliest day** — the button would jump nowhere, and the banner's "or pick
   up where you left off" half of its copy goes with it; browse anywhere else
   and both return.
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

**Since Pass 83, a piece that's gone quiet — not necessarily "behind" in
the day-by-day sense above, just untouched — gets its own banner on
Overview**, distinct from `ScheduleBanner`: an active, non-revival piece
with real practice history and at least 14 days since anything was
logged, still with real work left in its plan, shows "No practice logged
for '\<piece\>' in N days. Would you like to reschedule remaining
practice items, or pause this plan?" with both actions offered directly —
Reschedule opens the same dialog as item 3 above; Pause sets the piece to
`"paused"` immediately, no dialog. The displayed day count holds steady
for a week at a time (14, then 21, then 28, ...) rather than changing
daily. This can appear alongside `ScheduleBanner` — they're independent
conditions and a piece can meet both at once. See
[Algorithms.md](Algorithms.md#the-abandoned-plan-reminder-pass-83).

4. Confirming sets `piece.rescheduleMarker` (and, when the dialog offered an
   extension, `daysToLearn`/`targetDate` too); `getEffectiveTimeline` then
   keeps every already-passed day as it stood the last time the schedule
   was actually recomputed, and repacks only the untouched chunks into the
   days that remain. **Since Pass 48** (and, for Week view and Master
   Agenda too, **Pass 75**), a past day whose entire original task list
   ended up moved by this repacking — Timeline, Daily Practice, Week
   view, and Master Agenda alike — collapses to a plain "Tasks rescheduled"
   line instead
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

**Since Pass 75, a stale review no longer just sits, unaddressed, on the
past day it was originally placed on** — Timeline, Week view, Daily
Practice, and Master Agenda all stop listing a Tier 2 review there once
it's overdue and wasn't logged that day, since it's already live and
actionable on today's own screen instead. **Since Pass 92, a day emptied
this way reads exactly like any other day with nothing scheduled**
("Nothing scheduled.") — the two notes this originally shipped with
("Now due — see today," Daily Practice's own longer "…now tracked as due
— see Daily Practice") are gone; a day emptied purely by staleness
doesn't get its own explanation any more than a day that was simply never
scheduled does. Unrelated to rescheduling — this fires whether or not the
piece has ever been rescheduled. A Tier 1 "first touch" review and a
consolidation day are both untouched by this. See
[Algorithms.md](Algorithms.md#timeline--scheduler) for the mechanism
(`withLiveReviewStatus`, `classifyDayEmptyState`) and
[Decisions.md](Decisions.md#scheduling) for the Pass 92 decision.

**Since Pass 39, Daily Practice can also show a second, separate banner**
below the "N days behind schedule" one (a day-count since Pass 70, not the
earlier chunk-count): a `"days"`-mode piece whose
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
Master Agenda land directly on Daily Practice for that piece rather than
Piece Overview — see flow 6 below.

**Since Pass 83, the individual "Past its target date" cards above also
get an aggregate banner** above the Learning-phase list — "N piece(s)
[has/have] passed [its/their] target date" — whenever one or more of them
exist for today, with its own "Reschedule all" action (the same
mechanism the "N pieces are behind schedule" banner below already uses).
Deliberately a *separate* banner from that one, not merged into it, even
though the two conditions usually overlap in practice — see
[Decisions.md](Decisions.md#scheduling) for why (a piece already stuck by
a documented reschedule-recognition bug can silently vanish from the
"behind schedule" count specifically, so folding this into that count
would hide it from both).

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
panel (the same mechanism revival's own plan view uses to suggest a
starting point — see flow 8 below) pooling every due spot across every
piece, so a review session doesn't always start at the top of the same
list.

## 5. Reassessing difficulty mid-practice

From `ReassessPanel` (surfaced in Today, scoped to today's measure ranges):
pick a measure range and a new difficulty level, hit Apply. This writes
directly into `piece.measureDifficulty` for that range and closes the panel
in the same action — matching how difficulty was originally entered at setup
(per-measure, not per-chunk). There is no undo for this — see
[Data-Model.md](Data-Model.md#known-simplifications-worth-knowing-about).

## 5a. Splitting a chunk that turned out too dense (Pass 97)

After practicing a chunk today, Today's Practice shows "Found a particularly
dense passage? Split a chunk into two independent chunks." with one button per
eligible chunk (a chunk of 2+ measures you logged today). Click one and a
browser confirmation names the exact result — *"Split mm. 9-12 into 9-10 and
11-12? This can't be undone."* On OK, the chunk becomes two independent chunks
at its midpoint (an odd count puts the extra measure in the second half: 5 →
2+3). Both halves start with the original's stage, tempo, confidence and
"done today" status, so nothing looks newly behind; the practice-session log
stays with the first half, so time practiced isn't counted twice. Either half
can be split again; a 1-measure chunk can't be split. **There is no undo and no
way to merge two halves back together yet** (deferred).

On Piece Map the two halves sit together in one dashed box so it's visible they
came from one chunk. Afterward, the two halves usually show up as read-only
"historical" cards for today (they aren't in today's live schedule any more),
which is also why the Split panel disappears until something else is
practiced.

**Interaction with Settings** ("Edit piece settings" → Save changes): adding
measures to the end of a piece (chunk size unchanged) keeps every split —
the new measures just become new chunks. Changing the chunk size keeps splits
the new size already lines up with (4 → 2 keeps them all, silently) and asks
before dropping any it can't (4 → 3), naming each one. See
[Algorithms.md](Algorithms.md#interaction-with-a-later-settings-structure-edit).

## 6. Multi-piece switching

The sidebar's piece-switcher trigger opens a list of every piece in
`pieces`; selecting one calls `switchToPiece`, which updates `activePieceId`
(and the persisted `measureone-active_piece_id` key). "Add new piece" is
reachable from the switcher, the Overview top row, and Settings.

`switchToPiece` normally lands on Piece Overview — the default second
argument. **Since Pass 39**, Master Agenda's "Log practice" (on any
learning-phase, maintenance-due, or "needs reschedule" card) and "Pick a
random piece to practice" pass `"today"` instead, landing directly on
Daily Practice for that piece rather than the dashboard — you clicked
something that means "go practice," so you land where you'd actually log
it. Master Agenda's Revival subtab is the exception: its "Open piece →"
still lands on Overview, not Daily Practice — unchanged by Pass 88, which
folded revival's actual content *into* Daily Practice (see flow 8 below).
That makes this button inconsistent with the other two subtabs' own
"land where you'd act on it" reasoning above; not fixed here — see
[Decisions.md](Decisions.md#open-questions) for why it wasn't treated as
an obvious bug to silently correct.

**Since Pass 29 follow-up**, switching pieces (or navigating to a different
sidebar tab, or clicking "Edit piece settings") while the piece you're leaving has
Interleaved mode open with an unresolved provisional log first asks for
confirmation — see flow 2 above and
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29).
Every other case is unaffected: switching pieces with nothing pending still
happens in one click, no confirmation.

Movements of the same work are grouped under the work title in that list
(`groupPiecesByWork`), and are additionally switchable from the `PartSwitcher`
strip on the Overview of any movement — same `switchToPiece` call, just a
closer-to-hand entry point while working within one work.

**Since Pass 32a**, that list is user-reorderable: dragging the grip on a row
moves a standalone piece or an entire work as one block (never an
individual movement within a work — those stay ordered by creation date,
already grouped together regardless), writing a persisted `piece.sortOrder`
that the switcher — and every other piece-listing surface, including the
Export picker — sorts by instead of creation date. **Since Pass 125**, the list
(which shows about seven rows and scrolls inside that window) also scrolls by
itself while a piece is held near its top or bottom edge, faster the closer to
the edge, and stops when the piece is dropped or leaves the list, so a piece can
be moved to any row in one drag. See [Decisions.md](Decisions.md#ux).

## 7. Backup and restore

Settings' "Backup & restore" panel has **Export pieces**
(`handleExportClick` → `ExportPiecesModal`: pick which pieces to include,
then one JSON file) and **Import backup** (`handleImportClick` →
`handleImportFile` → `ImportPiecesModal`, also reachable from the empty
state when there's no active piece). **Since Pass 104**, both also have a
"Technique library" row: on by default for export; on import it previews
what will be added and merges into the library here without removing
anything, and says so if the file's technique library can't be read. This is the only backup mechanism — there is no cloud sync
(see [Roadmap.md](Roadmap.md)), so this JSON export is the only way data
survives clearing browser storage or moving to a new browser/device.
**On sites connected to an account service, signing in and backing up to an
account ([flow 10](#10-signing-in-optional-pass-109),
[flow 11](#11-backing-up-this-device-optional-pass-110)) add a second copy but
don't change any of this:** export and the export reminder work exactly as
before, and a site with no account service shows none of it.

**Since Pass 32a**, importing a backup that matches existing pieces also
offers a "keep what's here" / "use the imported order" choice for switcher
order — one pick for the whole import, not per piece, shown only when at
least one candidate actually matches something already here. See
[Decisions.md](Decisions.md#ux).

## 8. Revival

Entry: Piece Overview's "Start/Continue revival" button (a `primary-btn`),
enabled once a piece's plan is actually complete (`isPlanActuallyComplete`)
— disabled with an inline reason before that, since revival is for a piece
already learned, not one still mid-plan. Also auto-suggested via a banner
on Overview whenever `computeRevivalTriggers` fires (a rough run-through's
high stop count, a chunk or combo flagged "lost," or 60+ days since
anything was logged — see
[Algorithms.md](Algorithms.md#revival-auto-triggers-pass-7-gated-on-plan-completion-since-pass-83)).
Starting one opens `RevivalEntryModal` — collects the tempo ladder's
starting point as a straight BPM value — and "Begin revival" sets
`piece.revival.active`.

**Since Pass 88, revival has no tab of its own.** While
`piece.revival.active` is true, the sidebar's "Daily Practice" item
renders the entire revival flow itself, in place of its ordinary
Day/Week/Interleaved/All Tasks view (which doesn't apply — a revival plan
isn't scheduled to a calendar):

1. **Reassessment** (while `!revival.reassessmentComplete`):
   `ReassessSequencePanel` walks every base practice chunk in the piece
   (transitions/combos are not part of this pass — see
   [Decisions.md](Decisions.md#revival)), one at a time: a "Log time"
   timer (stopping it logs the time in one action, no separate log step),
   Quick rate (five presets, Lost through Solid), Current/Target BPM, an
   optional note (collapsed to "+ Add a note" until opened), and a
   collapsible "Chunk Info" stats dropdown. An "N of M rated" count and a
   grid-icon button (opens a "Progress" modal — a difficulty-tinted,
   checkmark-when-rated grid, click a square to jump to it) track progress
   through the pass. Previous/Next move between chunks; "Finish
   reassessment" generates the plan immediately, no separate step, whether
   this is the first pass or a redo.
2. **The plan** (once reassessment is complete): a "Flagged chunks"
   summary (from ordinary, non-revival Piece Map's rough/lost flag —
   revival's own reassessment can't set that field), a "Needs another
   look" panel for any combo whose underlying content has failed recently,
   then the day-by-day suggested list itself (`revival.plan.days`,
   flagged-then-weakest-confidence first) — its day numbers are pacing
   buckets, not calendar days, and every item is loggable on any visit
   regardless of which suggested day it's under. Below that: "Random
   start" (jump to a spot you wouldn't have picked yourself) and a shared
   "Reassess difficulty" quick-pick panel for re-rating any item — chunk,
   transition, or combo — on the fly, separate from and unscoped by the
   reassessment pass above. "Redo reassessment" (once reassessment is
   complete) and "End revival" sit in the header throughout.

`piece.revival.tempoLadderStartFraction` is editable after entry only from
the "Edit piece settings" page's own "Revival settings" panel (a draft field, saved with Save changes), shown while a revival is active —
nowhere inside the revival flow itself. Ending revival (`onEndRevival`)
resets `piece.revival` to its inactive defaults; flags and manual
confidence set during the run are **not** cleared — they're durable chunk
metadata, not scoped to a single revival cycle.

See [Algorithms.md](Algorithms.md#revival) and
[Decisions.md](Decisions.md#revival) for the full mechanics and design
history, including everything this flow used to look like as a standalone
tab before Pass 88.

## 9. Technique practice (scales and arpeggios)

Since Passes 101–104. App-level, not tied to the open piece. Design:
[Technique-Practice.md](Technique-Practice.md).

1. **Sidebar → Technique** (second item, after Master Agenda). A new
   library starts empty; "Add scale or arpeggio" (form, key, minor type,
   octaves, hands, check octaves, optional starting tempo and star) adds
   one, and it joins today's list at once if there's room.
2. **Today** tab: up to 3 task cards (carried-over first, then starred /
   repertoire-key scales that are due, slow scales, then the
   circle-of-fifths walk, with a walk hint when its key is on the list).
   Each card shows 3–4 practice methods; expanding it shows instructions,
   a starting tempo (85% of the last check), and "Finish with an
   even-rhythm check" (tempo 30–300 → Log check sets the baseline). The
   circle checks a task off without a tempo; clicking it again undoes it.
3. **Library** tab: filter, three sorts, star a scale, switch it in/out of
   rotation, click a row to edit octaves / hands / check octaves (changing
   check octaves on a scale with a tempo asks "keep as a starting point, or
   start fresh?").
4. **Methods** tab: star or switch off any method; add your own.
5. The same list shows on **Master Agenda** (under Total planned, which
   adds 5 minutes per task) and every piece's **Daily Practice**, real today
   only, hidden when the list is empty. A check-off anywhere shows
   everywhere. Scales are never "behind": unfinished ones carry to tomorrow.
6. A piece's key (flow 1) tags matching scales "Repertoire in this key" and
   paces them about 4 days a week while the piece is active.

## 10. Signing in (optional, Pass 109)

**Only on sites connected to an account service.** That's preview sites,
local development and, since go-live (Pass 114, 2026-10-10), the live site.
A site that isn't connected (a fresh checkout, the test suite) shows nothing
below and is exactly as it was before accounts. Signing in itself **moves no
data** (nothing is uploaded or downloaded,
and no piece, technique data or banner changes); it only says who's signed
in. Copying this device's data to the account is a separate, explicit step
([flow 11](#11-backing-up-this-device-optional-pass-110)).
Accounts are **by invitation for now**: there's no sign-up form. See
[Accounts-and-Backend.md](Accounts-and-Backend.md).

**Two ways in** (`SignInModal`, opened by `openSignIn`, `App.jsx`):
1. Settings → **Account** panel (after "Backup & restore") → **Sign in**.
2. The welcome screen, when there are no pieces yet (a new device has no
   sidebar): a quiet **Sign in** link under "Start a new piece".

**The sign-in window:**
1. Email and password, then **Sign in**. A wrong email or password gets one
   plain message ("That email and password don't match..."), the same for
   both, so the form can't be used to find out who has an account. No
   connection gets its own plain message. Neither changes any local data.
2. **Forgot password?** asks for the email and sends a reset link. It
   always answers "If that address has an account, a reset link is on its
   way.", whether or not the address has one. Only a failed connection
   says something different.

**Arriving from a link in an email** (an invitation from the Supabase
dashboard, or a reset link):
1. The link opens the app and signs the person in. An invitation opens the
   project's Site URL (on the live site, the address where the owner's pieces
   live; on the test project, a preview address); a reset link returns to
   whichever site asked for it.
2. The **Choose a password** window opens: the new password twice (at least
   6 characters; the service's own minimum is the real rule), then **Save
   password**. **Not now** closes it and leaves the person signed in,
   without a new password.
3. A link that has expired or was already used opens the sign-in window with
   a plain note saying so, where a fresh reset link can be asked for. On the
   live site a link lasts one hour, so an invitation should be opened as soon
   as it arrives; a late one needs a fresh invitation from the project owner.

**Signed in:** Settings → Account shows the email address, **Back up this
device** ([flow 11](#11-backing-up-this-device-optional-pass-110)) and
**Sign out**. **Sign out**
signs out this device only, and leaves this device's pieces and technique
data exactly as they are. The person stays signed in across reloads (the
account library keeps the session, never the password). **Change password** and
**Sign out of all devices** are in [flow 13](#13-account-settings-optional-pass-113).

## 11. Backing up this device (optional, Pass 110)

**Only when signed in, and only on sites connected to an account service**
(preview sites, local development and, since go-live (Pass 114), the live site;
on a site with no account service nothing below appears anywhere). It **copies** this browser's pieces and technique library
to the account and checks the copy. It never changes anything on this device,
never replaces or deletes anything the account already holds. Once that first
backup has been checked, every later change goes up by itself (Pass 111, see
[Keeping the backup current](Accounts-and-Backend.md#keeping-the-backup-current-pass-111)),
and getting things back is [flow 12](#12-getting-things-from-your-account-optional-pass-112).
Design:
[Accounts-and-Backend.md](Accounts-and-Backend.md#first-backup-behavior-pass-110).

1. Settings → **Account** → **Back up this device** (`handleBackUpDevice`,
   `App.jsx`).
2. **The first time for an account on this device, a question first**, right
   in the Account panel (not a browser pop-up, which some browsers block):
   "Back up the 12 pieces and the technique library on this device to
   name@example.com?" with **Back up** and **Not now** buttons. **Not now**
   closes the question and does nothing. Once a checked backup is recorded on
   this device for that account, pressing again skips the question, since all
   it can do is add what's missing. A different account signing in on the same
   browser is asked again.
3. While it runs the button reads **Backing up...** and both buttons are
   disabled. Leaving Settings and coming back doesn't interrupt it.
4. **The result**, in plain words, under the buttons:
   - **Backed up and checked: 12 of 12 pieces and the technique library.**
     Everything was read back from the account and matched what this device
     holds. Beneath it: how many were added this time and how many were
     already there, and when it was checked.
   - **Already in your account and different, left as it is: ...** for a piece
     the account already had that doesn't match this device (or that the
     account marks deleted). It's neither counted as backed up nor touched;
     settling those is a later update. The technique library gets its own
     sentence when it's the one that differs.
   - **Nothing was added: your account already has a copy of each of these
     pieces.** When none of the pieces matched because the account already
     holds a different copy of every one (for example, it was backed up earlier
     from another browser, and importing a backup gives each piece a new
     created date). It's followed by the "already in your account and
     different" line, with names separated by semicolons and a long list cut
     after five ("...; and 20 more"). Nothing failed and nothing was changed.
   - **Didn't match when read back from your account: ...** or **Couldn't be
     sent: ...**, in red, with "Press Back up this device to try again."
   - **No connection** ("Couldn't reach the account service..."), signed out,
     or an unexpected failure: it says so, in red, and records nothing.
     Pressing again is safe.
5. Pressing again after something changed on this device reports that changed
   piece as "already in your account and different, left as it is": this
   update never overwrites, so the account copy stays as it was. Keeping it
   current is Pass 111.

Nothing on this device changes in any of these cases. Manual export and the
export reminder are unaffected.

## 12. Getting things from your account (optional, Pass 112)

**Only when signed in, and only on sites connected to an account service**
(on a site with no account service nothing below appears). One flow, three
ways in. It reads
your account and **adds to or updates what's on this device; it never removes
anything from this device** unless you click "Delete it here too" (with the
automatic switch of flow 14 on, a deletion from the last 30 days also removes the
piece by itself: flow 16). The only things it ever writes to the account are
marking a duplicate copy deleted (the row stays) and, if you press **Keep it**,
clearing a deleted mark. Design:
[Accounts-and-Backend.md](Accounts-and-Backend.md#restore-get-changes-and-settle-pass-112).

**Three ways in**

1. **Restore, on a new device.** On the welcome screen, signed in, when your
   account holds pieces: **Restore 12 pieces from your account** (only appears
   once the count has come back; none if the account is empty or can't be
   reached). It opens the modal below.
2. **Get changes, any time.** Settings → **Account** → **Get changes from your
   account**. Since Pass 116 the Account panel also says when there is something
   to get (see the status lines below); it only notices, and **nothing arrives until
   you press the button, unless you turned on "Update automatically from other
   devices"** (Pass 120, section 14 below; it is off unless you choose it).
3. **Review, for a piece held as "changed on another device".** The red banner
   and the Account panel show **Review** while anything is held. It looks only at
   what's held. **A piece that the automatic update held because both devices changed
   the same thing is asked about one question at a time (flow 15, Pass 121);** any other
   held piece (a refused upload, an imported file) opens the window described below.

**The status lines in the Account panel** (Passes 111, 115 and 116). One quiet
line sits under the buttons, and the first of these that applies is shown:

- **"The account service isn't answering. Everything is still saved on this
  device."** after two failed attempts in a row. It replaces everything below.
- **The held message, with the normal line after it**, for example "The technique
  library changed on another device. Everything else backed up 1 minute ago." or
  "1 piece changed on another device: Ballade No. 1. 2 changes waiting to back up."
  Something is held when the account's copy was changed by another device since
  this device last synced it: this device's copy is untouched and hasn't been
  uploaded over the account's, and everything else keeps backing up. A red banner
  with **Review** shows on every screen while anything is held. **Pressing Review
  settles it without a question when the merge needs none, and can clear a hold
  with nothing to merge** (the copies already match by then): the result then says
  only `Cleared "changed on another device" on 1 item.`
- **"N changes waiting to back up"**, then **"Backed up just now"** or "Backed up 6
  minutes ago" once nothing is waiting. Changes go up a few seconds after you stop
  logging, and are retried by themselves if the connection fails.
- **"Changes from another device: 3 pieces. Press Get changes."** (Pass 116), an
  extra line under the others (also "...: 1 piece and the technique library." or
  "...: the technique library."). It counts pieces another device changed, added or
  deleted that this device doesn't have yet, and goes away by itself once **Get
  changes** brings them in. No banner, no sidebar mark.

**What happens**

- The button reads **Reading your account...** while it works (and the other
  account buttons are disabled). No connection, signed out, or an unexpected
  failure is said in the page and nothing changes.
- **Nothing to decide:** when your account only has newer copies of pieces you
  haven't changed here, or things that already match, it's applied at once and
  the result says what happened, for example "Took your account's newer copy of 1
  piece: Etude No. 3." You press nothing else. "Everything here already matches
  your account." when there's nothing to do. An account with nothing in it says
  "Your account has nothing yet. Press Back up this device...".
- **Something to decide:** the **import window** opens ("Restore from your
  account", "Get changes from your account" or "Review changes from your
  account"), with each piece ticked and tagged:
  - **New here**: not on this device.
  - **Newer in your account**: nothing here was waiting, so it's taken as it is.
  - **Changed in both places** (and **(held)** if it was held): you've changed it
    here and the account changed it too. A picker asks which practice progress
    should count ("Keep what's here" or "Use my account's version"); practice
    logged on either side is kept either way.
  - **Same piece, other copy**: the same piece under a different id (matched by
    name), shown with the piece it will be combined with. Combining merges the
    other copy into the one here, and the extra copy in your account is then
    **marked deleted, not erased**. Unticking it leaves that copy out, and it's
    offered again the next time you press Get changes (nothing remembers that you
    said no), so the window keeps opening until it's combined.
  - A **Piece order** question appears when any piece is merged.
  - The **Technique library** row appears when merging it would add something.
    Nothing here is ever removed from it.
  - **Deleted on another device**: pieces your account has marked deleted that are
    still here, each with **Delete it here too** and, since Pass 122, **Keep it**
    (flow 16). Nothing is removed unless you click it. A note says when the piece
    has changes your account never got. A copy that was removed by combining two
    copies of a piece gets only **Delete it here too**.
  The button reads **Restore N pieces**, or **Bring in N pieces**.
- **The result**, in plain words in the page (never a browser pop-up): on Settings,
  under the Account buttons; elsewhere (including the welcome screen) as a
  dismissible banner. For example "Restored 12 pieces from your account.",
  "Merged 1 piece changed in both places: ...", "Combined the two copies of
  Ballade No. 1. The extra copy in your account is marked deleted, not erased.",
  "Matched the created date of 25 pieces to your account.", 'Cleared "changed on
  another device" on 3 items.', "Technique library merged (1 scale added, ...).
  Nothing was removed."
- **After it**, whatever this device holds beyond your account's copy goes up by
  itself as an ordinary change, a few seconds later. A held piece that was
  merged is no longer held.
- **Restoring onto an empty device** opens a piece and shows the regular app
  (sidebar included), and starts automatic backup without the first-backup
  question, since everything on it came from this account. On a device that
  already holds pieces, the first-backup question still comes first, and the
  other copy of a combined piece isn't marked deleted until that backup is made.

Importing a backup **file** is unchanged (flow 7): a file's pieces still get a
new created date. That's why a piece imported from a file shows as held, once it
meets its copy in your account, until you press **Get changes**, which matches the
created date and clears the mark.

## 13. Account settings (optional, Pass 113)

**Only on sites connected to an account service, and only signed in** (signed out,
Settings → Account still shows only the sign-in prompt, exactly as before). Two
buttons sit in a group of their own at the bottom of the Account panel, under a
thin line: **Change password** and **Sign out of all devices**, then one plain line:
"Changing your email or deleting your account isn't available in the app yet."
Neither button touches a piece, the technique library or anything else stored on
this device. See [Accounts-and-Backend.md](Accounts-and-Backend.md#account-settings-pass-113)
for the dashboard steps to change an email or delete an account by hand.

**Change password**
1. **Change password** opens the **Change password** window: "Choose a new password
   for your account. You'll stay signed in on this device." The new password twice,
   at least 6 characters, with the same messages as the invitation and reset windows
   ("That's too short...", "The two passwords don't match.", the service's own
   message if its minimum is higher, "Choose a different password from your current
   one."). No current password is asked for. **Cancel** closes it.
2. **Save password.** The window says "Your password is changed. You're still signed
   in on this device." and **Done** closes it. The old password stops working, the new
   one signs in, and this device stays signed in. (The invitation and reset windows,
   which close at once, are unchanged.)
3. If the service wants a recent sign-in first (its "secure password change"
   setting), the window says "For your security, sign in again before changing your
   password." with a **Sign in again** button. That closes the window and opens the
   sign-in window with the note "Sign in again to change your password. Then choose
   Change password once more." Sign in, then choose **Change password** again. The
   same button appears if this sign-in has already ended elsewhere ("You're not
   signed in any more. Sign in again to change your password.").
4. With no connection: "Couldn't reach the account service. Check your connection
   and try again." The window stays open, with what was typed.

**Sign out of all devices**
1. The button asks first, right there in the panel (never a browser pop-up): "This
   signs you out on every device, including this one. Nothing is deleted from any
   device." with **Sign out of all devices** and **Cancel**. Cancel sends nothing.
2. Confirmed, this device signs out at once. The panel shows "You're signed out of all
   devices. Other devices can stay signed in for up to an hour. Nothing was deleted
   from any device." with **Dismiss**, above the usual Sign in prompt. Signing in
   again clears it.
3. **Other devices** keep working until their current sign-in runs out (up to an hour
   at Supabase's default), then show signed out. Every piece and the technique
   library on them is still there.
4. If the service can't be reached, the app says what actually happened rather than
   "done": "You're signed out on this device, but the account service couldn't be
   reached, so your other devices may still be signed in. Sign in and try again when
   you're connected. Nothing was deleted from any device." (This device is always
   signed out by then: the library does that even when it couldn't tell the
   service.) If this device somehow stayed signed in, it says nothing was changed and
   to try again.

## 14. Updating automatically from other devices (optional, Pass 120)

**Only on sites connected to an account service, signed in, once this device's first
backup is checked.** Under the buttons in the Account panel there is one checkbox,
**Update automatically from other devices**, **off by default**, and a line that says
what it does. The choice is for this device only (it is kept in this browser, not in
your account), so each device decides for itself.

**Off (what you get unless you choose otherwise).** Nothing changes from before: about
once a minute the app looks at your account and, if another device changed something, the
Account panel says so ("Changes from another device: 3 pieces. Press Get changes.").
Nothing arrives until you press **Get changes from your account**, which asks what it
always asked.

**On.** The same look, about once a minute while this page is open, and then what needs no
decision is brought in by itself, with no button:
1. A piece another device added, or changed while you hadn't, simply arrives.
2. A piece changed in **both** places arrives merged **if the changes don't overlap**
   (different chunks, a note on one side and a tempo on the other). Whatever your device
   holds beyond your account's copy goes up as usual a few seconds later.
3. The technique library is merged the same way.
4. **What never arrives by itself:** a piece changed in both places where the **same**
   thing was changed (for example the same chunk practiced on both devices at once). It
   is **held**: your device keeps its own copy untouched, nothing is lost on either side,
   and the red banner "1 piece changed on another device" with **Review** appears, exactly
   as before. **Review** then asks one plain question for each thing that was changed in both
   places (flow 15). A piece **deleted on another device** within the last 30 days
   is removed by itself (flow 16); an older deletion is only listed, never removed.
   A piece that may be the same one under a different name is always asked.
5. **A piece you are in the middle of waits.** If you have an unconfirmed Interleaved
   attempt, a reassessment timer running, or Edit piece settings open for that piece,
   another device's change to it is not applied until you are done (confirm or discard the
   attempt, stop the timer, save or discard the settings). Your half-typed reps and BPM
   and a running practice timer on a checklist card are not disturbed when a piece is
   updated. The Account panel then says "Changes to Ballade No. 1 will be applied when
   you're done with it." (you will mostly see it only briefly: the Settings tab shows the
   edit form while a settings draft is open).

**What you are told** (proposed; to be confirmed)
- In the Account panel, a line you can dismiss: **"Updated from another device: Ballade
  No. 1, and the technique library."**
- If the piece that is **open** changed, one quiet blue line at the top of the page, which
  you can dismiss and which goes when you open another piece: **"This piece was updated
  from another device."** No other piece makes a banner.

**Two devices practicing at the same moment.** Before an upload goes up the app takes one
light look at your account first. If the other device has just uploaded, yours merges its
changes in and uploads the merged result once, a few seconds later; you see no refusal and
no banner when the two changed different parts.

**Turning it off again** stops all of this at once (what is waiting for a piece is
forgotten); the next look only notices, and Get changes works as before.

**Signed out, or on a site with no account service:** there is no checkbox and nothing
changes.

## 15. Settling a piece changed in the same place on both devices (optional, Pass 121)

**Only on sites connected to an account service, signed in.** It is the second half of flow 14:
when "Update automatically from other devices" finds a piece that **both** devices changed in
the same place (the same chunk practiced on both, or the same setting changed on both), it
can't merge the two for you, so it **holds** the piece: your device keeps its own copy,
nothing is lost on either side, and the red banner "1 piece changed on another device" with
**Review** appears (also under the Account buttons in Settings). Pressing **Review** now asks
**one plain question for each thing that was changed on both**, instead of the whole-piece
window. Design:
[Accounts-and-Backend.md](Accounts-and-Backend.md#settling-a-held-piece-one-question-at-a-time-pass-121).

**What you see.** A window with the piece's name (and "Piece 1 of 2" if several pieces are
waiting). The first line says the piece was changed on both of your devices and that nothing
changes until the last step. Then one question and its answers. Devices have no names, so it is
always "this device" and "your other device".

**The first screen, only when it helps.** If you practiced **three or more** parts of the piece
on both devices, the window starts with one question for all of them: "You practiced 6 parts of
this piece on both devices since you last synced." You choose **Both devices' sessions for all
6** (recommended) or **Decide each one**. The first keeps every session from both devices for
all of them and skips those questions; whatever else was changed on both (a setting, say) is
still asked one by one. Nothing is chosen for you: **Next** stays grey until you choose.
With fewer than three, there is no first screen and you go straight to the questions.

**The questions** ("Question 2 of 5"):

- **A chunk you practiced on both devices:** "You practiced mm. 1–4 on both devices since you
  last synced." You keep **Both devices' sessions** (recommended: every session from both is
  kept, and the rest of the record, such as tempo and next review, follows whichever device
  practiced last), **This device's** or **The other device's**. When an answer would throw
  sessions away it says so, with the number: "The 2 sessions logged on your other device will
  be removed, from your account too. This can't be undone." (keeping this device's) or "The
  session logged on this device will be removed. This can't be undone." (keeping the other's).
  An answer that would remove no session says nothing.
- **Any other setting:** "Target date: Nov 1 on this device, Nov 15 on your other device." You
  keep **This device's** or **The other device's**. For the target date it also says that days
  to learn and the reschedule follow the date you keep, so you are not asked about them.
- **A chunk layout changed on one device while practice was logged on the other:** one
  question, **This device's piece** or **The other device's piece**. The two can't be put
  together, so whichever you don't keep, its practice and changes are removed; each answer says
  so ("...will be removed ... This can't be undone.").

**The last step.** After the last question the window shows what you are about to do: "Nothing
has changed yet." and "You are keeping:", one line per answer (everything you chose on the first
screen is one line: "Both devices' sessions for all 6 practice records"). If any answer
removes sessions, a red box says "Please check before you settle:" and repeats each one by the
measures it is about (for example "For mm. 1–4: the session logged on your other device will be
removed, from your account too. This can't be undone."). The buttons are **Decide later**,
**Back** and **Settle this piece**.

**Moving through it.** Choosing an answer changes nothing. **Next** goes on, **Back** goes to the
one before (your answers are still there). **Decide later** leaves the piece exactly as it is,
still held, and moves on to the next waiting piece (the next time you press Review it asks
again). The **×** does the same for everything. **Nothing is changed until you press Settle this
piece.** A piece with nothing left to decide shows "Bring it up to date?" instead, with the same
rule.

**What happens when you settle.** The app first reads that piece in your account again, in case
your other device changed it while you were deciding. If nothing you decided on has changed,
your answers are put together with everything the two copies already agreed on (using the
newest copy), the piece is brought up to date with your account, and whatever your device holds
beyond your account's copy goes up by itself a few seconds later. The red banner goes away. The
page says, for example: "Settled Etude No. 3: kept the other device's target date and both
devices' sessions for all 6 practice records." The three ways it can end without changing
anything, each saying which it was:

- **Something changed while you were deciding:** the window starts over with a note ("Something
  changed while you were deciding, so the questions are asked again. Your earlier choices were
  cleared and nothing was changed."), because an answer to the old question may not mean the
  same thing now (the number of sessions an answer would remove may be different, for one).
- **Your account can't be reached at that moment:** the window stays on the last step with
  "Nothing was changed. Couldn't reach the account service. Check your connection and try
  again. You can also choose Decide later." Press the button again, or choose Decide later.
- **The piece is no longer waiting** (deleted, or settled in another window): the page says
  "... is no longer waiting to be settled here (it may have been deleted, or settled in another
  window), so nothing was changed."

If something else goes wrong the page says "Something went wrong while settling ..., so nothing
was changed and it is still held. Press Review to try again." If the questions for a piece
can't be prepared at all, it goes through the whole-piece window instead and the page says so.

**Other held things.** A piece held for another reason (an upload that was refused, a file you
imported), and the technique library, still open the window from flow 12, exactly as before.
If both kinds are waiting, the questions come first and that window follows.

**Signed out, or on a site with no account service:** none of this appears.

**Not covered yet:** remembering an answer ("always keep both"): see Roadmap.md and
Accounts-and-Backend.md. (Deleting a piece on one device while practicing it on the other is
flow 16.)

## 16. Deleting a piece on every device, and bringing it back (optional, Pass 122)

**Only when signed in with a checked first backup, on a site connected to an account
service.** Signed out, or on a site with no account service, deleting a piece works exactly as
before (this browser only, permanently) and nothing below appears. Design:
[Accounts-and-Backend.md](Accounts-and-Backend.md#a-piece-deleted-on-one-device-is-deleted-everywhere-with-a-way-back-pass-122).
The rule is the owner's (2026-10-23): a piece deleted on one device is deleted everywhere, and
the practice goes with it. The way back is her addition.

**Deleting.** Settings, **Delete this piece**. The window says the piece is removed "from this
device and from every other device on your account", that you can bring it back from **Recently
deleted** in Settings for 30 days, "without any practice that was never backed up". You type the
piece's name to confirm, and the button reads **Delete everywhere** (signed out it reads **Delete
permanently**). Your account keeps the piece's data, marked deleted: nothing is erased.

**On your other devices**, what happens depends on the switch of flow 14:
1. **Switch on, deleted in the last 30 days:** the piece is removed by itself within about a
   minute, with no button. The Account panel says "Removed because it was deleted on another
   device: Ballade No. 1." If the piece was the one you had open, the app moves you to another
   piece and one line at the top says why ("Ballade No. 1 was deleted on another device, so it
   was removed here too."). A piece you are in the middle of (an unconfirmed Interleaved attempt,
   a reassessment timer running, Edit piece settings open) waits until you are done.
2. **That device had practice that was never backed up:** it goes with the piece, and a red
   banner says how many sessions: "Ballade No. 1 was deleted on another device, so it was removed
   here too. 1 session you logged here since your last backup went with it. You can bring the
   piece back from Recently deleted in Settings for 30 days, but not that session." With nothing
   lost there is no banner, only the quiet line in the Account panel.
3. **Switch off, or the deletion is older than 30 days:** nothing is removed. A quiet banner
   says "Ballade No. 1 was deleted on another device. It's still on this device. Delete it here
   too, or keep it: it comes back in your account and on every device." with two buttons (for
   several pieces it names them and has **Open Settings**). If this device holds changes the
   account never got, the banner says so before you choose ("It's still on this device, and it
   has changes your account never got. If you delete it here too, those changes are lost. If you
   keep it, the piece comes back in your account and on every device, with those changes.").
   The Account panel lists each one under "Deleted on another device" with the same two buttons
   (and a line when it has practice the account never got), and the **Get changes** window has
   them too.
   - **Delete it here too** removes the piece here, as before.
   - **Keep it** brings the piece back in your account and, within a minute or on **Get
     changes**, on your other devices. If this device's copy differs from the account's, they
     are merged, not replaced. If the account's copy changed since you looked, nothing is
     changed and the page says so ("... changed in your account since you looked, so nothing was
     changed. Look again, then try once more.").
4. **A copy removed by combining two copies of one piece** is never removed by itself, and can't
   be kept on its own. In the **Get changes** window it gets only **Delete it here too**. The
   banner and the Account panel's list are built without reading the piece's data, so they can't
   tell and show both buttons; **Keep it** there answers "... was combined into another piece, so
   it can't be kept on its own." and changes nothing.
5. **A piece you brought in by hand is never removed by itself.** If you delete a piece and then
   import it again from a backup file (an import keeps the piece's id), or this device holds a
   copy it never synced with your account, the piece stays even with the switch on and even
   though your account marks it deleted. It is listed like case 3 (banner, Account panel, Get
   changes window) with **Delete it here too** and **Keep it**; **Keep it** is what you want here
   (it brings the piece back in your account, merged with the copy you imported). The wording
   says "deleted on another device" because the app cannot tell which device did it. An import
   merged into a piece this device had already synced with your account is an ordinary change to
   it, and a deletion made elsewhere still wins over it.

**Deleting while another device is practicing.** The deletion goes through (it is no longer
held as "a piece deleted here"). Practice that device had already backed up stays in the
account's copy, so Restore brings it back; practice it had not backed up is lost, as above.

**Recently deleted.** Settings, under Account, **Recently deleted**. It lists the pieces deleted
from any of your devices in the last 30 days, newest first: the name, when ("Deleted today",
"Deleted yesterday", "Deleted 3 days ago"), and how many measures and sessions your account's
copy holds, each with **Restore**. Restore does what **Keep it** does: the piece comes back here
and, within a minute or on **Get changes**, on your other devices, as your account last had it.
Opening the list changes nothing. A copy removed by combining is not listed. An older deletion is
not listed either; the account still holds it, but only the dashboard can reach it.

**Not covered:** bringing back a piece deleted more than 30 days ago; removing a piece from just
one device while the switch is on; deleting your account (Phase 3). Whether "Keep it" should be
offered on a combined copy (it answers that it can't be kept) is open: see
Accounts-and-Backend.md, Pass 122 found item 2.

## 17. Saying no, and having the app remember it (optional, Pass 122b)

**Only when signed in with a checked first backup, on a site connected to an account
service.** Signed out, or on a site with no account service, nothing below appears and the file
import works exactly as before. Design:
[Accounts-and-Backend.md](Accounts-and-Backend.md#what-the-person-said-no-to-is-remembered-and-order-follows-them-pass-122b).

**What leaving a row unticked means.** In the **Get changes** and **Restore** windows (flow 12)
every row is ticked, except a "maybe" row (below). A line under the intro says it plainly: "A
piece you leave unticked stays off this device, and the app stops mentioning it. "Ask me again"
in Settings, under Account, brings it back." (In a restore: "isn't restored".)

- **A new piece** you untick stays off this device. "Changes from another device" stops counting
  it, Get changes stops listing it, and the automatic update leaves it alone.
- **"Same piece, other copy"** says what each choice does: ticked, the two are combined (the extra
  copy in your account is marked deleted, not erased); unticked, they are **different pieces**
  and this copy stays off this device (in a restore, "both are restored": the unticked copy comes
  in as its own piece, as long as the copy it would have been combined with is coming too). Either
  way, the window does not open again for it.
- **"Maybe the same piece"** is the same row when the name matches but one of the two has no
  composer, so the app can't be sure. It starts **unticked**; tick it to combine. Left alone, the
  two are treated as different pieces. A match where both have a composer is as before. A file
  import is not affected.
- **Nothing else** is remembered: an unticked "Newer in your account" or "Changed in both places"
  row is a piece you already have, and it keeps being noticed as before.
- **"Select none"** unticks everything, so everything is left off. Cancel remembers nothing. If you
  leave rows off, the button reads **Leave these off** when nothing is ticked.

After a window (and after a Get changes that opens none) the result says what stayed off: "1 piece
you said no to stays off this device."

**Ask me again.** Settings, under Account, **Ask me again about what I said no to** (it appears
only while something is remembered, with a line saying what: "You said no to 2 pieces, and that 1
pair of pieces is different. Pressing this makes the app ask about all of it again."). Pressing it
forgets every answer on this device and nothing else, makes no request, and the pieces you said no
to show up at once in "Changes from another device"; the next Get changes offers them again
(including the question whether two are the same piece). Asking for a piece by name, with **Keep it**
or **Restore** (flow 16), forgets any answer about that piece too, and so does opening **Restore**
on the welcome screen (it starts afresh). The answers belong to this device: another device asks
once for itself.

**Piece order follows you.** Reorder the list on one device and your other devices follow it (by
themselves with "Update automatically" on, or on Get changes), with no question: the "Piece order"
question that used to appear in the Get changes window is gone. If you reordered differently on two
devices before they synced, **the most recent reorder wins, as a whole list**, without asking: each
time you drag a piece the app leaves a dated note of the whole arrangement in the pieces it changed,
and every device shows the arrangement of the latest note. (Two reorders made without either device
having seen the other are judged by the devices' clocks.) Pieces added since that reorder follow the
listed ones. Two pieces that end up with the same place in the list are shown in the order they were
added, the same on every device. A file import still asks about order, as before, and a file's own
older arrangement never rearranges your list; "Use the imported order" counts as a reorder you made
just now.

**A piece held because an upload was refused** (it shows as "changed on another device" with
**Review**) now gets the same one-question-at-a-time Review as any held piece (flow 15), when the
app still knows what the piece looked like when it last synced. If only the order differed the
screen says "Nothing is left to decide for this piece". A piece that has never synced still goes
through the whole-piece choice.

**Not covered:** a way to say "not now" instead of "no" (a row left unticked is a no, and Ask me
again undoes all of them at once); answers that follow you to your other devices.
