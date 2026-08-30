# MeasureOne — Project Context

## Read this first

The full product vision, design philosophy, data model, algorithms, and
decision history live in [`docs/`](docs/README.md) — start there for
anything beyond "how do I run this thing." In particular, read
[`docs/AI-GUIDELINES.md`](docs/AI-GUIDELINES.md) before proposing a product
change or adding a feature; it tells you which document in `docs/` answers
which kind of question, and what to do (record a decision, update a doc)
alongside a code change.

This file (`CLAUDE.md`) is the fast, auto-loaded orientation layer: tech
stack, how to run it, where things live in the code, and the handful of
operational rules that matter every session. It intentionally does **not**
duplicate the deep reference material in `docs/` — if something here and
something in `docs/` ever disagree, `docs/` is canonical for product/design
reasoning, and the actual source code under `src/` is canonical for
implementation fact.

## What this app is

MeasureOne is a practice-planning tool for musicians learning a new piece:
it turns "I have to learn 120 measures in 3 weeks" into a concrete,
day-by-day plan, and reacts to how practice is actually going rather than to
a fixed calendar. It is **not** a metronome, notation app, or recording
tool. See [`docs/Vision.md`](docs/Vision.md) for the full mission and
[`docs/Product-Principles.md`](docs/Product-Principles.md) for the design
philosophy — most importantly, **confidence is earned, not assumed**, and
**there are no streaks or punishment mechanics, permanently**.

## Tech stack

- React 18 (function components + hooks only, no class components)
- `lucide-react` for icons
- No CSS framework — a single hand-written CSS string (`const CSS = \`...\``)
  injected via a `<style>` tag inside the root component, using CSS custom
  properties defined on `.measureone-app`. No Tailwind, no CSS modules.
- No backend. All persistence is client-side `localStorage`.
- No React Router — navigation is a simple `activeTab` string in state.

## Running it locally

```
npm install
npm run dev
```

Vite dev server, default port 5173. `npm run build` produces a static
`dist/` — no server-side requirements, deployable to any static host.

## Where things live

```
MeasureOne.jsx/
├── CLAUDE.md
├── docs/              # canonical product/design/architecture reference
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx        # ReactDOM entry point, just mounts <App />
    ├── App.jsx         # state + layout only — owns updatePiece and every
    │                   # handler, renders the sidebar + active tab
    ├── lib/            # pure functions: chunking, scheduling, confidence,
    │                   # revival, storage, shared constants/utils — no JSX
    └── components/     # everything with JSX: NumberInput, Wizard, field
                         # editors (fields/), and every tab (tabs/)
```

`App.jsx` used to be a single ~3,900-line file holding every component, all
business logic, and all styles — a holdover from the app's origin as a
single-file Claude.ai artifact. It's since been split along the lines
[`docs/Architecture.md`](docs/Architecture.md) describes; that doc has the
full file tree and the reasoning behind where things landed.

For the full component map and state-management conventions, see
[`docs/Architecture.md`](docs/Architecture.md). For the complete `piece` /
`ChunkProgress` schema, see [`docs/Data-Model.md`](docs/Data-Model.md) — the
literal source of truth for the schema is `defaultPiece()` in
`src/components/Wizard.jsx` (the only place it's consumed). For how
chunking, scheduling, and confidence are actually computed, see
[`docs/Algorithms.md`](docs/Algorithms.md).

## Rules that matter every session

- **Use `updatePiece(updaterFnOrValue)` for any change to the active
  piece — never `setPieces` directly.** Every mutation goes through it.
- **Use `NumberInput` for every numeric field, never a raw
  `<input type="number">`.** It decouples displayed text from the committed
  value (commits on blur/Enter) to avoid a controlled-input bug where
  clearing a field to retype gets fought by React re-rendering the old value
  mid-keystroke.
- **Setup and editing share the same field-editor components**
  (`BasicsFields`, `SectionsEditor`, `DifficultyEditor`, `RecurringEditor`,
  `ScheduleFields`, `BpmZonesEditor`, `RecordingsEditor`, `DocumentsEditor`)
  between `Wizard` and `SettingsTab`. Add new piece-level fields to one of
  these, not to a parallel implementation in each flow.
- **Two specific regressions to watch for** if you touch scheduling —
  full context in [`docs/Algorithms.md`](docs/Algorithms.md#timeline--scheduler)
  and [`docs/Decisions.md`](docs/Decisions.md#scheduling):
  - Transitions must be scheduled as soon as both flanking chunks are
    introduced. If an index-based spread (`i % backSpan`-style) reappears on
    the *transitions* loop, that's a past bug coming back (it belongs only
    on the combos loop).
  - "Behind schedule" must trigger only when a chunk's scheduled day has
    already passed with zero sessions logged — never a same-day cumulative
    planned-vs-actual comparison.
  - For a `scheduleMode: "minutes"` piece, `reconcileMinutesPerDaySchedule`
    (`lib/scheduling.js`) recomputes `daysToLearn` from scratch on every
    load. A reschedule that deliberately extends `daysToLearn` past that
    (App.jsx's `handleReschedule`, "doesn't fit" branch, minutes-mode path)
    relies on that function's `rescheduleMarker`-gated floor to not get
    silently reverted on the next reload — found as a real bug (extension
    worked in-session, vanished on reload) before the floor existed. If you
    touch this function, keep the floor or the reschedule-extend feature
    silently breaks again.
  - **"The calendar ran out" is not the same question as "the plan is
    actually finished" (Pass 39).** Every surface that decides whether a
    piece has run past its plan — `TodayTab`'s `pastPlan`, `MasterAgendaTab`'s
    per-piece day lookup, `ScheduleBanner`'s suppression, `planRescheduleForPieces`'
    eligibility, `SettingsTab`'s Archive-button gate, and `OverviewTab`'s
    "Continue learning"/"Continue maintenance" relabel — must go through
    `isPlanActuallyComplete(piece, chunkSet,
    timeline)` (`lib/scheduling.js`), never a raw `elapsedDay(piece) >
    timeline.days.length` comparison. A `scheduleMode: "days"` piece whose
    target date passed with real work still outstanding is *behind*, not
    *done* — the raw calendar comparison used to conflate the two, which is
    exactly the bug this function exists to fix; if a new call site reaches
    for the raw comparison instead, that's this regression coming back. See
    [`docs/Algorithms.md`](docs/Algorithms.md#detecting-that-a-piece-has-run-past-its-plan).
- **`Wizard` is create-only.** Editing an existing piece always goes through
  `SettingsTab`, never the wizard.
- **Piece Map chunk detail is a modal, not inline** — this was a deliberate
  UX fix (inline rendering was invisible below the fold); don't revert it.
- **Piece Map's grid shows only base practice chunks — this is deliberate,
  not a bug to "fix" by restoring transitions/combos to it.** Reach those
  through the chunk-detail modal's "Related chunks" field instead (Pass
  50). The one exception: `PieceMapTab`'s `sequentialMode` (Revival's
  reassessment pass) renders the grid unfiltered on purpose, since it walks
  a different, transition-inclusive list via its own Previous/Next — don't
  filter that branch too.
- **Section run-throughs must stay a computed-fresh-every-render gate, not
  a persisted "unlocked" flag.** As of Pass 49, `sectionRunThroughGate`
  (`lib/chunking.js`) recomputes due/locked state from live session counts
  on every call — reintroducing any persisted "has this been unlocked"
  state would silently bring back the exact bug that pass fixed (a
  run-through that, once available, sat permanently available forever
  after, whether or not it still made sense). See
  [`docs/Algorithms.md`](docs/Algorithms.md#section-run-throughs).
- **`piece.sections` must always have `start <= end` — if you add a second
  way to create or edit sections, normalize it the same way
  `SectionsEditor.jsx` does** (a min/max swap on every commit, mirroring
  `resizeSections` in `lib/utils.js`). Every consumer of section start/end
  (`weightedDifficultyFromArray`, `chunksBySectionId`, section run-through
  gating, Piece Map, Progress's estimated-vs-actual panel) assumes this and
  doesn't re-check it — a backwards section was previously silently
  save-able through the Settings/Wizard editor with zero validation error,
  and produced a real `NaN` in the UI before this was fixed.
- **`chunkSet` and `timeline` are pure derivations** (`useMemo`'d off
  `piece`), never persisted. If something schedule-related needs to persist
  (like the reschedule marker), it goes on `piece` as input data, and the
  derivation recomputes from it.
- **A key in `piece.progress` may not exist in the chunk set — always
  handle the miss.** `piece.progress` is persisted; the chunk set is
  re-derived. Three kinds of key won't resolve: `__consolidation__`,
  `sr_<sectionId>` section run-throughs (deliberately never in
  `generateAllChunks(...).all`, so this is *routine*, not an edge case),
  and ids orphaned when a piece edit regenerated chunk ids. An unguarded
  `chunkById[id].start` on one of these crashed the whole Progress tab
  (Pass 20). Iterating `timeline.days[]` ids instead is safe by
  construction. See
  [`docs/Data-Model.md`](docs/Data-Model.md#pieceprogress-keys-are-not-guaranteed-to-exist-in-the-chunk-set).
- **Logic that needs a regression test belongs in `src/lib/`.** The test
  suite (`npm test`, `node:test`) is lib-level only — there is no harness
  for rendering components, so nothing in `components/` can be tested.
  Move the logic rather than leaving it untested (`lib/history.js` exists
  for exactly this reason). When you add a regression test, verify it can
  actually *fail* by re-introducing the bug — see
  [`docs/Decisions.md`](docs/Decisions.md#ux).

## Revival

MeasureOne includes a Revival workflow — recovering a piece that was
learned once and has gone stale (entry point on Piece Overview →
`RevivalTab`).
It's built additively on top of the existing data model, not a parallel
one: reassessment **is** `progress[id].manualConfidence` (exposed through a
fast preset UI), weak-spot flagging is a new `progress[id].weakSpot`
boolean, and `computeRevivalPlan` is a distinct function from
`computeTimeline` (revival has no "introduction" concept, so it doesn't
reuse that scheduler — see [`docs/Decisions.md`](docs/Decisions.md#revival)
for why). New `piece` fields: `lastPlayedDate`, `memoryAnchors`, `revival`.
Full detail: [`docs/Data-Model.md#revival`](docs/Data-Model.md#revival),
[`docs/Algorithms.md#revival`](docs/Algorithms.md#revival).

## Known simplifications

Several constants driving scheduling and confidence (`EFFORT_TO_MIN`,
`LIBERAL_FACTOR`, the review-offset multipliers, required-reps thresholds)
are hand-picked, not derived from any study — see
[`docs/Research.md`](docs/Research.md) for the full inventory and what
would need to be true to replace them. There's also no undo history for BPM
zones or difficulty reassessment. **"This piece is learned" is now
implemented, as of Pass 39** — `isPieceLearned(piece, chunkSet)`
(`src/lib/ladder.js`) is a live derivation (every practice chunk's ladder
`stage` at Holding), not a persisted field on `piece`, so there is still no
first-class piece-level "learned" *state* to gate other features on (e.g.
the still-unbuilt "gate revival entry behind maintenance" item — see
[`docs/Decisions.md`](docs/Decisions.md#open-questions)). See
[`docs/Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented).

## Roadmap

See [`docs/Roadmap.md`](docs/Roadmap.md) — no single item is currently
singled out as "next"; pick from the priority-ordered backlog there. The
Analytics fold-in that used to occupy that slot **shipped in Pass 20**:
Analytics is gone as a tab and its "Confidence by difficulty" panel lives
in Progress (the other folded-in panel, "Recurring material payoff", was
removed outright in Pass 32b — see below). The
biggest maintenance-ladder item is now **substantially built, not just
designed**: a continuous Stabilizing/Settling/Holding cadence has replaced
the old fixed `REVIEW_OFFSETS` review (`computeTimeline` now schedules
reviews straight off each chunk's live ladder due-date), and "learned" is
defined as every chunk reaching Holding — **and as of Pass 39, something
finally queries that roll-up**: `isPieceLearned(piece, chunkSet)`
(`src/lib/ladder.js`). It's load-bearing, not just a future display label —
`isPlanActuallyComplete` (`src/lib/scheduling.js`) reads it to decide, for a
`scheduleMode: "minutes"` piece, whether the plan should keep auto-extending
itself or finally read as complete; see
[`docs/Algorithms.md`](docs/Algorithms.md#detecting-that-a-piece-has-run-past-its-plan).
The live "what's due" query that works beyond the current plan's
bounded length is built as of Pass 8 (`computeDueReviews` in
`src/lib/maintenance.js`, surfaced in Master Agenda and the Today tab), as
is post-run-through logging (stop count / rough-lost flag, Pass 6). The
"short structured re-learning pass" that consumes `needsRelearning` is
also now built (Pass 11) — two consecutive Stabilizing fails sets a
persisted, sticky per-chunk flag that replaces review entirely (zero due
reviews from either `computeTimeline` or `computeDueReviews` while set),
exits on 4 consecutive passes or a manual override, reuses the `lost`
demote-and-pin mechanism under the label "Needs reinforcement," and resets
`practiceBPM` to `getSuggestedStartingBPM`. A Settings editor for
`ladderConfig` is built too (Pass 17 — `LadderConfigEditor`, under
SettingsTab's "Maintenance ladder" panel). Still not built: a
first-class *persisted* "learned" piece state to gate other features on
(the roll-up above is a live derivation, not a stored field — see
[`docs/Decisions.md`](docs/Decisions.md#open-questions) for the
"gate revival entry behind maintenance" item this still blocks), a second
Tier 1 rung, and Stage 5 repertoire rotation.
If you're about to touch scheduling, confidence,
or the practice-logging UI, check
[`docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built`](docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built)
first — this mechanism is now live, not a future replacement to design
around. One invariant from that design worth internalizing early: **a
review arriving late is schedule slack, never a failure** — only the
logged outcome (pass/soft-miss/fail) may ever affect the ladder, not
timing.

**Since Pass 29**, Today's Practice has a fourth view mode, **Interleaved**
— rotates chunks past Stabilizing, with a "skip" action and a
**provisional** logging state (a rough auto-classified attempt is saved
but doesn't touch the ladder until confirmed or discarded) — see
[`docs/Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29`](docs/Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29).
Leaving Interleaved mode with an unconfirmed provisional now warns and, on
confirmation, discards it — gated through one shared function
(`confirmAndDiscardProvisional`/`guardLeavingInterleaved`, `App.jsx`) at
every place `activeTab`/`activePieceId` can change, not just the obvious
ones; two sidebar controls ("Edit piece," finishing the "Add new piece"
wizard) were missed on the first pass and only caught on review — if you
add another way to navigate away from Interleaved mode, route it through
that same function rather than adding a new `setActiveTab`/
`setActivePieceId` call site unguarded. **Since Pass 30**, Piece Map also
surfaces a live-derived "tempo climbing" nudge (`hasClimbingTempo`,
`lib/confidence.js`) — no new persisted state, same pattern as the
existing flag/needsRelearning tile markers.

**Since Pass 31**, `ChecklistItem` no longer shows a per-chunk
method-suggestion tip line — `suggestMethods()` was removed in favor of
static instructional copy (a fixed requirement line, "Spaced Repetition"
in place of "Ladder," and a "Needs more work" checkbox that states what a
manual fail actually does). Don't reintroduce a dynamic technique
suggestion by resurrecting that function; it's gone. **Since Pass 38**,
Overview's "Start/Continue revival" button is a `primary-btn` (was
`ghost-btn`), and Revival-mode copy was reworked to read less clinically:
the Revival tab's title-card subheading dropped the purpose/last-played
recap in favor of a plain "Returning '{piece}' to its former glory," the
Overview stat cards and first-week list relabel during an active revival
("revived" instead of "learned," "Revive"/"reconsolidate" instead of
"Learn new"/"review"), and Master Agenda's revival cards no longer show
the purpose blurb. The revival-mode UI still does not display when the
piece was last played anywhere — flagged as a possible follow-up, not
treated as settled. (This paragraph originally also flagged that
`revival.purpose` — why the revival was started — had no display surface
either; moot as of Pass 55, which removed the field from collection
entirely rather than just from display. See that entry below.)

**Since Pass 32a**, every piece carries a persisted `sortOrder` (number) that
the sidebar piece switcher and other piece-listing surfaces sort by instead
of `createdAt`, reorderable via up/down controls on each switcher row.
Reordering only ever moves a *whole* row — a standalone piece, or an entire
multi-movement work as one block — never an individual movement within a
work; movement order inside a work is still `createdAt`-driven
(`groupPiecesByWork`/`partsOfWork`, `lib/works.js`), untouched by this
field, and stays visually contiguous "for free" regardless. Existing pieces
migrate to a `createdAt`-derived default so nothing reshuffles on first
load. Re-importing a backup gets its own explicit "keep what's here" /
"use the imported order" choice rather than the usual most-recently-updated
rule — order is display arrangement, not data an `updatedAt` comparison
should settle. See [`docs/Data-Model.md`](docs/Data-Model.md#the-piece-object).

**Since Pass 32b**, Progress's "Recurring material payoff" panel (folded in
from the old Analytics tab back in Pass 20) is gone — a pure removal, along
with the four variables that only fed it. Recurring material's actual
scheduling-effort discount (`lib/chunking.js`) and any related confidence
handling are untouched; only the display panel went.

**Since Pass 36**, the reschedule confirmation dialog (`handleReschedule`,
`App.jsx`) fixed its "day(s)" pluralization, and — when the remaining work
doesn't fit the days left — now offers a concrete way out instead of just a
warning. For a `scheduleMode: "days"` piece: change the target date to a
suggested one (derived from the same `requiredDays` estimate already
computed) or reschedule into the existing window. For `scheduleMode:
"minutes"`: there's no target date to suggest changing (one was never set
in that mode) and no "cram into what's left" alternative worth offering
(no calendar deadline to protect there), so it's a single action — extend
`daysToLearn` to fit, at the same `minutesPerDay`. See the regression note
above for the reload-persistence fix this required.

**Since Pass 39**, "the calendar ran out" and "the plan is actually
finished" are no longer the same question anywhere in the app — see the
new regression note above (`isPlanActuallyComplete`) for the mechanics.
Built alongside it: `isPieceLearned` (Stage 3's rollup, see the Roadmap
paragraph above), a `scheduleMode: "minutes"` piece now auto-extends its
own plan (no dialog, no button — `computeMinutesModeAutoExtend`, applied by
an effect in `App.jsx` scoped to the active piece) once it's past its own
day count but not yet learned, and a `scheduleMode: "days"` piece in the
equivalent state gets a new "Past your target date" prompt on Today's
Practice instead of silently reading as complete. Master Agenda's per-piece
day lookup uses the same `isPlanActuallyComplete` check, shows a matching
card for an affected `"days"`-mode piece instead of quietly dropping it,
and computes a *display-only* version of the minutes-mode auto-extension so
a `"minutes"`-mode piece in the background (not the currently-open one)
still shows real, current content rather than going invisible — nothing is
written to storage from that computation; the real write only happens via
the `App.jsx` effect once that piece is actually opened. Master Agenda's
"Log practice" and "Pick a random piece" buttons now land on Today's
Practice, not Overview (`switchToPiece` takes an optional target tab).

**Also since Pass 39** (a follow-up round, same session): the single-piece
reschedule dialog no longer offers "reschedule into current plan days" once
a piece's target date has *already fully passed* — only "push the target
date out," since there's no real "current plan days" left to pack into once
the deadline's already gone (`suggestion.singleChoice`, `App.jsx`). The
bulk "Reschedule all" button now does the equivalent for its whole batch:
a `scheduleMode: "days"` piece already past its own plan gets its target
date pushed out automatically as part of the bulk action, not just repacked
within a plan length that was never going to fit it
(`computeReschedulePastPlanExtension`, shared by both the single-piece and
bulk paths — `lib/scheduling.js`). **A real, pre-existing bug was found
(not fixed) while verifying this**: a piece that's *already* been
rescheduled once via "cram into what's left" while fully past its own plan
can permanently stop being recognized as behind schedule at all, which
silently drops it from "Reschedule all" forever after — see
[`docs/Decisions.md`](docs/Decisions.md#scheduling) for the mechanism and
why only half of the two-part fix shipped this session.

**In the same session as Pass 42 (below), several smaller fixes also
shipped, none individually pass-numbered:** `ChecklistItem`'s practice
timer now computes elapsed time from a wall-clock timestamp captured at
the moment "Log practice" is clicked, instead of trusting whatever the
last per-second tick had left `durationSeconds` at — the old approach
could undercount by up to a second, more if a `window.confirm` shortfall
dialog delayed the actual save. The multi-movement summary line
("N movements, N plans") now sits at the actual bottom edge of the title
card's content, after Recordings/Documents, correcting where Pass 38 had
actually left it (under the measure-count line — not the bottom edge;
those two are not the same spot). `PartSwitcher` no longer renders its own
`<h3>{workName}</h3>` heading — the hero card's eyebrow already names the
work, so a multi-movement piece's Overview was showing the same title
twice, in two different cards. Master Agenda's Learning/Maintenance/Revival
subtab buttons no longer stretch to the page's full width. Every
notes-style field's label dropped the "— optional" suffix, everywhere
`MemoryAnchorField` renders. **Work title is now required, in both the
Wizard and Settings, whenever "Multiple movements" is selected** — blank
titles used to silently produce a confusing dead-end (Wizard: piece never
actually joined the work; Settings: clearing an existing multi-movement
piece's title silently demoted it out of its work, `ensureWorkId`,
detaching it from its siblings with no warning). See
[`docs/Decisions.md`](docs/Decisions.md#multi-movement-works) for the full
reasoning behind both title-related fixes.

**Since Pass 42**, there's a first, deliberately bounded cross-piece
summary: `AllPiecesTab` — one row per piece (progress %, confidence %, days
since last touched, time practiced) plus a total-time-practiced stat,
reached via a "View all pieces" button on Progress rather than a new
sidebar entry (same button-triggered-tab pattern `revival` already uses,
not in `NAV_BASE`). Every number comes from an existing per-piece function
called once per piece — no new aggregation logic. Confidence deliberately
uses `elapsedDay` (real, unclamped calendar days) rather than the
timeline-clamped `getCurrentDay` other screens use for the *active* piece,
so a neglected piece keeps reading as more stale over time instead of
freezing once it falls off its own plan — a considered choice, not an
oversight; see [`docs/Decisions.md`](docs/Decisions.md#cross-piece-views)
for why, and what switching to `getCurrentDay` would actually cost. Not the
full "cross-piece repertoire health dashboard" mentioned earlier in this
file — no lifecycle-state detection — still scoped out; see
[`docs/Roadmap.md`](docs/Roadmap.md).

**Also since Pass 42** (a same-session follow-up, once the user actually
tried the page): three additions to `AllPiecesTab`. A "Back to {piece
name}" button in the header, reusing the same `onSelectPiece` navigation
the rows already use. "Time practiced" is now **this week only** (Monday
through today), not all-time — both the per-row column and the header
total — via two new `lib/utils.js` functions, `startOfWeekISO` and
`sumPracticeSecondsSince` (no existing helper did week-boundary math). And
the consistency/streak view named above as explicitly deferred **was
built after all**, once actually requested: a 14-day cross-piece heatmap
(`computeCrossPieceConsistency`, `lib/utils.js`) where touching *any*
piece counts a calendar day as practiced — reads each session's
`loggedDate` directly rather than the plan-relative day numbers
`ProgressTab`'s per-piece heatmap uses, since day numbers aren't
comparable across pieces with different start dates. All three are tested
at the `lib/` level (`test/utils.test.mjs`), including a DST-boundary
regression for the Monday calculation.

**In the same session as Pass 43/45 below**, Settings' "Archive piece"
control (Practice status panel) stopped being unconditional: it's now
disabled — grayed, with an inline reason and a hover title — until
`isPlanActuallyComplete(piece, chunkSet, timeline)` says the piece's plan
is actually finished. Pause is untouched, still available any time, no
condition attached. A real, deliberately unresolved gap this opened: a
piece the learner has genuinely abandoned mid-plan (not finished, never
going to be) has no clean way to archive under this rule — see
[`docs/Decisions.md`](docs/Decisions.md#lifecycle) for the reasoning and
[`docs/Decisions.md`](docs/Decisions.md#open-questions) for the gap.
`SettingsTab` now receives `chunkSet`/`timeline` as props from `App.jsx`,
the same way every other tab already does, instead of recomputing them
locally — an early version of this fix recomputed them locally, before
being corrected to reuse the existing values.

**Since Pass 43**, Overview has a "Continue learning" shortcut under the
title card that jumps straight to Today's Practice (`onSelectDay(null)`,
the same reset-to-real-time path `onJumpToday` already uses) — hidden
during an active revival (`"Start/Continue revival"` already covers that
slot in the same area), and relabeled "Continue maintenance" once
`isPlanActuallyComplete` says the plan is done.

**Since Pass 45**, a new shared `classifyDayCompletion(day, piece,
currentDay)` (`lib/scheduling.js`) reports `"future" | "done" | "behind" |
"empty"` for a single timeline day, written once so a future Timeline-tab
pass can reuse it instead of duplicating the logic. Overview's "first
week" list uses it: a past day is grayed regardless of which of the three
non-`"future"` states it's in, but struck through only when genuinely
`"done"` — an empty/rest day is `"empty"`, not `"done"`, specifically so
it grays without reading as crossed-off work that never happened (it
shipped the other way first and was corrected once the struck-through
"Nothing scheduled" row was pointed out — see
[`docs/Decisions.md`](docs/Decisions.md#ux)). Today's row also gets a
"(behind N chunks)" note, reusing `computeScheduleStatus`'s existing
`missedCount` rather than a new count. Two gaps flagged, not fixed: a
consolidation day's logged run-through doesn't satisfy the per-chunk
`doneDays` check `classifyDayCompletion` does (so a logged consolidation
day still reads `"behind"`), and neither this note nor the graying is
revival-aware — a piece mid-revival can show "(behind N chunks)" against
its *original*, pre-revival plan, not the revival plan actually being
followed. See [`docs/Decisions.md`](docs/Decisions.md#open-questions) for
both.

**Since Pass 49**, a single-section run-through no longer unlocks once and
stays available forever — it's a repeating gate (`sectionRunThroughGate`,
`lib/chunking.js`): due whenever the section's slowest-progressing chunk's
*confirmed* session count is odd (1, 3, 5, 7, ... — a flat "+2" step
forever, matching the pre-existing threshold of 1 for the first unlock),
gone between thresholds, and shown as a distinct locked/grayed preview row
on the one day before a chunk's next session would cross it into being
newly due. "Confirmed" means `loggedSessions()`-filtered — a skipped
Interleaved attempt or an unconfirmed provisional one must not advance the
gate, a fix made after the first cut used raw `sessions.length` the same
way `isSectionLearned` still does (deliberately unchanged; the two
functions now answer different questions and are allowed to disagree).
Section-**pair** run-throughs (`kind: "section-transition"`, "Sections
combined") are untouched — still the original one-time "unlock and stay"
gate; whether they should get the same repeating treatment is an open
question, not decided — see
[`docs/Decisions.md`](docs/Decisions.md#open-questions). See
[`docs/Algorithms.md`](docs/Algorithms.md#section-run-throughs) for the
full mechanics.

**Since Pass 50**, Piece Map's grid shows only base practice chunks
(`kind: "section"`) — no gaps, m.1 through the piece's last measure, no
transition/combo tiles. Transitions and combos are reached instead through
a new "Related chunks" field in the chunk-detail modal: every
transition/combo (or, symmetrically, base chunk) whose range overlaps the
selected one, as clickable links that open that chunk's own detail in the
same modal — including *its* related chunks in turn, so navigating never
dead-ends. `findRelatedChunks` (`lib/utils.js`) is
`findComboUnderlyingChunks` (`lib/revival.js`) run in reverse. **The grid
filter is skipped when `sequentialMode` is set** (Revival's reassessment
pass, embedded in `RevivalTab`, which walks a deliberately different,
unfiltered chunk list including transitions via its own Previous/Next) —
filtering unconditionally would have silently dropped transitions from
that flow. If you touch `PieceMapTab`'s grid again, preserve that
`sequentialMode` branch.

**Since Pass 51**, Progress has an "Estimated vs. actual practice time"
panel: for every item with a logged session in the last N days (same
trailing window Consistency already uses), a paired-bar comparison of
estimated time (`effort * EFFORT_TO_MIN`) against actual logged time
(summed `durationSeconds`, skipped/provisional sessions included — same
"the time was genuinely spent either way" rule `sumPracticeSeconds`
already uses). Covers practice chunks, transitions, combos, and
single-section run-throughs; deliberately excludes the whole-piece
`"__consolidation__"` run-through (not a real chunk object — no `effort`
to estimate against) and section-pair run-throughs (a distinct mechanism
per Pass 49 above). **Section run-throughs don't carry a stored `effort`
field the way the other three kinds do** — this panel derives one locally
from the same `measureCount * avgDifficulty` math transitions/combos
already use, guarded against a section whose range is (or was) backwards,
see the fix below.

**Also since Pass 51** (a same-session follow-up, found via a critical
review of the panel above, not a Pass 51 requirement itself): fixed
`SectionsEditor.jsx` silently accepting a section's `end` before its
`start` — each start/end `NumberInput` commits independently, so nothing
previously stopped a section from being saved backwards (e.g. mm. 2–1), no
validation error, no visual indication anything was wrong. Reproduced
live: it made `weightedDifficultyFromArray` divide by a zero/negative
count, producing `NaN` that poisoned *both* bars in the new Progress panel
for that item, including the otherwise-valid actual-minutes one, via a
shared denominator. Fixed at the root — `SectionsEditor.jsx` now
normalizes start/end with the same min/max swap `resizeSections`
(`lib/utils.js`) already uses for the analogous "total measures changed"
case — plus a defensive guard in the Progress panel itself for data
already malformed before that fix existed (an old save, a hand-edited
import). **If you ever add a second way to create or edit
`piece.sections`, it must reuse that same normalization** — every consumer
of section start/end (`weightedDifficultyFromArray`, `chunksBySectionId`,
section run-through gating, Piece Map) assumes `start <= end` and doesn't
re-check it.

**Since Pass 52**, `DIFFICULTY_META`'s display labels are Workable /
Challenging / Difficult, not Easy / Medium / Hard — display only. The
internal `difficultyLabel` enum values (`'easy' | 'medium' | 'hard'`) are
unchanged and still drive scheduling/confidence/ladder logic
(`REQUIRED_REPS`, tempo-floor lookups, etc.) — don't confuse the two, and
don't rename the enum values to match the new labels.

**Since Pass 53**, `NumberInput` has two new optional props, both
additive — the commit-on-blur/Enter behavior this component exists for is
untouched for every consumer that doesn't opt in. `onDraftChange(text)`
fires on every keystroke with the raw, uncommitted text, for a
gating-only signal (e.g. "has the user typed *something*") that shouldn't
wait for blur. `acceptPlaceholderOnTab` (boolean prop) makes tabbing out
of an empty field commit the shown placeholder as if it had been typed —
only fires when the placeholder is actually a parseable number, so a
format hint like "e.g. 10" is never affected. `ChecklistItem`'s reps/BPM
fields use both: the Log button now gates on `hasRepsDraft && hasBpmDraft`
(set via `onDraftChange`) instead of the committed `reps`/`bpm` values, so
it enables the instant you start typing rather than waiting for blur —
what actually gets logged still reads from the committed state,
unaffected. This also fixes a real tab-order bug: a disabled button is
removed from the browser's tab sequence entirely, so the old commit-gated
Log button being disabled at the moment tab-order was computed could
overshoot straight into the next card. **Residual, deliberately not
chased further:** tab order still isn't literally reps→BPM→Log adjacent —
the "+ Add a note" button and the "Needs more work" checkbox, both always
enabled, still sit between BPM and Log in DOM order, so two extra stops
remain even though the "escapes to the next card" failure is gone. Every
fix considered for full adjacency (manual `tabIndex`, reordering the DOM,
hiding those two controls from keyboard tab order) costs something not
authorized by that pass — a visual layout change, or making two currently
keyboard-reachable controls mouse-only — so it was left as a known,
reported gap rather than resolved unilaterally. `acceptPlaceholderOnTab`
is also wired into `InterleavePanel`'s twin reps/BPM fields (same pattern,
requested separately) — but that panel never got the draft-gating change
above; its Log button still gates on the committed `reps`/`bpm` values
directly, which is fine since `NumberInput`'s Tab handler calls `commit()`
either way.

**Since Pass 54**, `PieceMapTab`'s "Run-through flag" field is hidden
specifically when `sequentialMode` is true (revival's reassessment pass) —
`{!sequentialMode && (...)}`, the same scoping precedent Pass 37 already
established for this shared component. Ordinary (non-revival) Piece Map's
flag toggle is completely untouched, still cycling
untouched→rough→lost→untouched. `CONFIDENCE_PRESETS` (`lib/constants.js`)
is relabeled Shaky/Rough/OK/Solid/Rock solid → Lost/Rough/OK/Comfortable/
Solid, same five 0/25/50/75/100 values. `RevivalTab`'s reassessment intro
copy dropped the flagging instructions (nothing left to describe) and
gained a new opening sentence, "Play through the piece from beginning to
end." **`computeRevivalPlan`'s flagged-first-then-confidence sort is
completely unchanged** — it still reads `progress[id].flag` exactly as
before; this pass only removed one of the two ways that field could get
set (revival's own reassessment), not the field, the sort, or `RevivalTab`'s
"Flagged chunks" summary panel below it. **Real, visible consequence, not
a bug:** since revival's reassessment can no longer set `flag` directly,
that panel will typically stay empty going forward unless a chunk gets
flagged separately through ordinary Piece Map outside of revival. A chunk
rated "Lost" via Quick Rate (`manualConfidence: 0`) still sorts to the
front of the plan on its own — confidence is the second tiebreaker, and
0 wins it unassisted. Same-session follow-up: the now-dead `onSetFlag`
prop threading (`App.jsx` → `RevivalTab` → `PieceMapTab`'s embedded,
`sequentialMode` instance) was removed, since nothing in that render path
can call it anymore; `handleSetFlag` itself and ordinary Piece Map's own
`onSetFlag` wiring are untouched.

**Since Pass 55**, `RevivalEntryModal` no longer asks "What's this
revival for?" — the `purpose` state, `REVIVAL_PURPOSE_OPTIONS`
(`lib/constants.js`), and the `disabled={!purpose}` gate on "Begin
revival" are all gone, so that button is now always clickable, gated on
nothing. `piece.revival.purpose` itself stays defined-but-always-`null`
on the schema (`storage.js`'s fallback, `Wizard.jsx`'s `defaultPiece()`)
rather than being stripped — dormant, not removed, matching this
codebase's usual migration philosophy for a field nothing reads. **If you
touch `handleStartRevival` (`App.jsx`):** it hardcodes `purpose: null`
directly rather than reading it from the modal's payload — it used to
destructure `purpose` straight through, and once the modal stopped
sending that key, this would have started writing brand-new revival
objects with *no* `purpose` key at all (`undefined` doesn't survive
`JSON.stringify`) rather than an explicit `null`, a real shape
inconsistency between a freshly-migrated piece and a freshly-started
revival that was caught and fixed the same session. Same-session
follow-up, per direct request: both places that collect
`tempoLadderStartFraction` — `RevivalEntryModal` at revival entry, and
`RevivalTab`'s "Revival settings" panel mid-revival — now take a straight
BPM value ("Tempo ladder starting point (BPM)") instead of a percentage
of target. The fraction is derived from `BPM / targetBPM` on commit; the
field's own `min`/`max` mirror the old 10%–95%-of-target bounds
(expressed in BPM) so the result can't land outside that range no matter
what's typed. Falls back to a flat 60% default with an explanatory
tip-line when a piece has no `targetBPM` to be a fraction of — typing
into the field in that state doesn't do anything, by design, not a bug.
`computeTempoLadder` itself and everything downstream of the stored
fraction are completely unchanged; only the input widget changed.

**Since Pass 66**, `computeDueReviews` (`lib/maintenance.js`) runs
unconditionally at both call sites (`TodayTab`, `MasterAgendaTab`) instead
of only once a piece has run out its whole bounded plan — a review overdue
*inside* an active plan now has a live surface immediately, not just once
the plan is exhausted. `mergeLiveDueReviews(day, dueItems)`
(`lib/maintenance.js`) folds the result into a plan day's own
`reviewChunkIds`, de-duplicated against a review already placed there
because it's due exactly today. Scoped to real "today" only in both tabs —
day-nav/date-picker browsing a different day is unaffected. The review's
original, now-past placement day still reads "behind" via
`classifyDayCompletion` exactly as before; only the "can I see and act on
this today" gap closed.

**Same-session follow-up, per direct request:** reviews are now priced by
difficulty everywhere, not just in `computeDueReviews`. Implementing the
merge above surfaced a genuine pre-existing inconsistency: `computeTimeline`
priced a review at a flat 3 minutes regardless of the chunk's own
difficulty, while `computeDueReviews` already priced one at
`chunk.effort * EFFORT_TO_MIN` (the same rate new-chunk introduction uses).
**If you touch review-cost estimation, both of these now agree and must
keep agreeing:**
- `computeTimeline`'s `minutesFor` (`lib/scheduling.js`) prices
  `reviewChunkIds` the same way as `newChunkIds`/`specialChunkIds` —
  `chunk.effort * EFFORT_TO_MIN` — not a flat per-touch minute figure.
- `computeDaysNeededForMinutesPerDay` (`lib/scheduling.js`, the
  `scheduleMode: "minutes"` day-count estimator) prices each chunk's
  review padding the same way: `c.effort * REVIEW_TOUCHES_PER_ITEM`
  (`REVIEW_TOUCHES_PER_ITEM = 2`, unchanged from before — only what each
  touch costs changed), not a flat-minutes constant converted into
  effort-points. Underestimating a hard chunk's review cost here directly
  risks a `scheduleMode: "minutes"` plan not actually fitting its own
  stated daily budget once review load lands on top of introduction — the
  reason this was worth fixing alongside the display-only case, not
  deferred.
- `mergeLiveDueReviews` now folds a merged item's `minutes` into
  `day.minutes` too (previously left deliberately unmerged, back when the
  two sides disagreed) — safe now that both sides price a review
  identically.
- Two pre-existing regression tests in `test/scheduling.test.mjs` had
  their expected numbers change as a direct, verified consequence (not a
  sign either fix was undone) — see their updated comments for the exact
  before/after math: the Tier 2 same-day-pileup smoothing test (heavier
  real review cost means the smoothing pass now relocates the full pileup,
  not just some of it) and the `computeDaysNeededForMinutesPerDay` padding
  test (the correct day-count padding for that fixture is legitimately
  larger once review cost stops being under-counted).

**Same-session follow-up, found in a self-review before committing:**
`mergeLiveDueReviews` (`lib/maintenance.js`) skips consolidation ("full
run-through") days entirely — `if (day.type === "consolidation") return
day;`. Neither `TodayTab`'s `ConsolidationPanel` nor `MasterAgendaTab`'s
card renders `reviewChunkIds` or `minutes` for a consolidation day at all,
so merging a transition/combo's overdue live-due review in on that day
type was silently inflating `day.minutes` (and therefore Master Agenda's
total-planned figure) with no line item anywhere on screen to explain the
extra time — a real number-doesn't-match-what's-shown bug, not a
theoretical one, confirmed live in the browser both before and after the
fix. **If you touch `mergeLiveDueReviews` or either consolidation-day
render branch:** the guard belongs in `mergeLiveDueReviews` itself, not
duplicated at each call site, since both callers rely on it unconditionally
to decide what's safe to merge.
