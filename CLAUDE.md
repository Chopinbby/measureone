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
- **Specific regressions to watch for** if you touch scheduling —
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
  - **Rescheduling a piece more than once must chain through its whole
    reschedule history, not just re-derive from the raw, never-rescheduled
    schedule (Pass 48 follow-up).** `getEffectiveTimeline`
    (`lib/scheduling.js`) recurses through each `rescheduleMarker`'s
    `previous` link to compute what came before the *current* marker's
    `asOfDay`, rather than always calling `computeTimeline` fresh. Without
    that chain, a second reschedule silently discards everything the first
    one actually placed for the days in between — including a session
    someone genuinely logged there, which then displays as a completely
    different, unstarted chunk (confirmed live, not hypothetical). Every
    place that constructs a new marker (`App.jsx`'s `handleReschedule`;
    `planRescheduleForPieces` and `computeMinutesModeAutoExtend`, both
    `lib/scheduling.js`) must set `previous: piece.rescheduleMarker ||
    null`, or this regression comes back for that path specifically. A
    piece whose second reschedule already happened *before* this fix
    existed has no `previous` link to recover — that piece's history is
    genuinely unrecoverable, not just unfixed; it corrects itself only once
    rescheduled again. See
    [`docs/Algorithms.md`](docs/Algorithms.md#rescheduling) and
    [`docs/Decisions.md`](docs/Decisions.md#scheduling).
  - **Introduction placement must be fully settled (including Pass 90's
    load-smoothing) before transitions/combos/reviews compute anything
    from `introducedDay` (Pass 90).** `computeTimeline`'s Phase A.5
    (introduction-only smoothing, scoped to `frontDays`) runs immediately
    after chunks are placed and *before* the `transitions.forEach`/
    `combos.forEach` loops — never after. If a chunk's own introduction
    day could still change once those loops have already read it, a
    transition/combo ends up anchored to a day its own dependency has
    since moved away from. This was a real architectural fork, confirmed
    before building rather than guessed at: the alternative (let anything
    move, then reflow whatever was anchored to it) would need a kind of
    re-derivation this codebase has never built. See
    [`docs/Algorithms.md`](docs/Algorithms.md#timeline--scheduler) rule 1
    and [`docs/Decisions.md`](docs/Decisions.md#scheduling).
  - **The daily-workload smoothing pass (`smoothOverloadedDays`,
    rule 5) must never move a Tier 1 item, in either of its two call
    sites (Pass 90).** Tier 1 is where schedule pressure deliberately
    never gets absorbed (see the Tier 1 entry above) — a movable-items
    pool built for a future extension of this pass that includes Tier 1
    by accident would silently reintroduce exactly what that design
    already rejected.
  - **`sortPracticeChunksForIntroduction`'s hard-chunk-neighbor check
    matches by measure boundary (`prevChunk.end + 1 === c.start`), never
    by raw array index (Pass 89, fixed same broader session as Pass 90).**
    Array-index adjacency is only correct when `practiceChunks` is the
    pristine, gapless list `generateAllChunks` produces — a rescheduled
    remainder (`getEffectiveTimeline`'s `subChunkSet.practiceChunks`) is a
    *filtered* subsequence with gaps wherever an already-practiced chunk
    was removed, and array-index adjacency there can call two chunks
    neighbors purely because whatever used to sit between them is gone.
    Confirmed as a real, reproduced bug, not hypothetical. If you touch
    this function's neighbor logic, keep the boundary-based match — see
    [`docs/AI-GUIDELINES.md`](docs/AI-GUIDELINES.md#position-based-logic-is-only-correct-for-the-caller-whose-list-it-was-written-against)
    for the general lesson and
    [`docs/Decisions.md`](docs/Decisions.md#scheduling) for the incident.
  - **`reassociateTroubleSpots` (`lib/chunking.js`) matches a focus spot to
    its chunk by measure position (`startMeasure`), never by trusting the
    chunk id it's nested under (Pass 91, experimental v1).** The same
    general lesson as the bullet above, a second instance of it: chunk ids
    are `c${start}`, so a chunking-scheme edit (`customChunkSize` 8 → 4)
    can produce an id that still exists in the new chunk set but now
    covers different measures entirely (a "c9" meaning 9–16, then 9–12) —
    an id-existence check alone reads that as continuity.
    `migrateOrphanedProgress` is correct for what it does (whole-entry
    reattachment by best overlap); this function exists specifically to
    catch what that one can't. If you touch this function's matching
    logic, keep the measure-position check — simplifying it down to "does
    this id still exist" silently reintroduces the exact spot-orphaning
    bug it was built to fix. See
    [`docs/Algorithms.md`](docs/Algorithms.md#focus-spots-v1).
- **`Wizard` is create-only.** Editing an existing piece always goes through
  `SettingsTab`, never the wizard.
- **Piece Map chunk detail is a modal, not inline** — this was a deliberate
  UX fix (inline rendering was invisible below the fold); don't revert it.
- **Piece Map's grid shows only base practice chunks — this is deliberate,
  not a bug to "fix" by restoring transitions/combos to it.** Reach those
  through the chunk-detail modal's "Related chunks" field instead (Pass
  50). `PieceMapTab` is ordinary (non-revival) Piece Map only, as of Pass
  87 — Revival's reassessment pass no longer shares this component at all
  (it used to, via a `sequentialMode` prop that rendered this same grid
  unfiltered underneath its own modal; that's retired in favor of a
  dedicated `ReassessSequencePanel`, see the Revival section below), so
  there's no second caller of this grid to keep in sync with anymore.
- **Section run-throughs must stay a computed-fresh-every-render gate, not
  a persisted "unlocked" flag.** As of Pass 49, `sectionRunThroughGate`
  (`lib/chunking.js`) recomputes due/locked state from live session counts
  on every call — reintroducing any persisted "has this been unlocked"
  state would silently bring back the exact bug that pass fixed (a
  run-through that, once available, sat permanently available forever
  after, whether or not it still made sense). Neither `sectionRunThroughGate`
  nor `computeSectionRunThroughs` takes a day parameter — both deliberately
  answer "is this due right now," not "was this due on day N." As of Pass
  68, the day-scoping instead lives one layer up: `SectionRunThroughPanel`
  only renders when `isRealToday`, so a browsed past/future day never shows
  (or lets you log against) today's live due-state. Don't try to fix a
  future "wrong day" symptom by adding a day parameter to the two functions
  above — the fix belongs at the display layer, same as this pass. See
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
- **`countBehindDays`/`isDayFullySwept` (`lib/scheduling.js`) take an
  optional fourth `chunkById` argument — pass it.** It defaults to `{}` so
  a caller that omits it degrades gracefully instead of crashing, but
  degrading means *silently under-detecting* a reschedule sweep (a
  connector that rode along via a linked practice chunk, rather than being
  listed directly on the marker, won't be recognized as moved) — the same
  symptom class Pass 74's follow-up fix exists to prevent, just reintroduced
  quietly at whichever call site forgets the argument. Every current call
  site (`ScheduleBanner`, `OverviewTab`, `MasterAgendaTab`'s two sites,
  `findStuckBehindPieces`) builds `chunkById` from whatever chunk set it
  already has in scope — a new call site should do the same rather than
  relying on the default.
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
- **A new field on `chunkLadderState`/`computeLadderAdvance`'s return
  shape is not done once `lib/ladder.js` is correct.** It also needs
  threading through all three of `App.jsx`'s session handlers (hand-
  maintained field lists, not a spread) and a `null` — not a materialized
  value — backfill default in `storage.js`, or the feature silently never
  persists / a clean re-import falsely reads as a conflict. Confirmed to
  bite twice, independently, in the same broader session
  (`tempoRatchetK`, then `holdingReviewCount`) — see
  [`docs/AI-GUIDELINES.md`](docs/AI-GUIDELINES.md) for the checklist.
- **`realCurrentDay` and `currentDay` are not interchangeable — reschedule
  eligibility, fit estimation, and a new marker's `asOfDay` must always
  anchor to `realCurrentDay` (Pass 74).** `currentDay = dayOverride ||
  realCurrentDay` is whichever day Timeline/day-nav happens to be
  browsing; `realCurrentDay` is the real, unclamped elapsed day. Before
  this fix, `handleReschedule` (`App.jsx`) and `ScheduleBanner`'s own
  `countBehindDays` call both read `currentDay`, so clicking Reschedule
  while paged to a past day anchored the new marker to that past day
  instead of today (reported precisely: a marker anchored at day 19 while
  real-today was day 29). The two values are only interchangeable while
  nobody is browsing away from today, which is exactly the condition that
  let this bug hide — if you add a new reschedule-eligibility or
  schedule-status computation, anchor it to `realCurrentDay`, not
  whichever `currentDay` the surrounding component happens to be showing.
  See [`docs/Decisions.md`](docs/Decisions.md#scheduling).
- **Saving the "Edit piece settings" form must never write the whole
  draft back over the live piece (Pass 93).** The edit page works on a
  draft — a copy of the piece taken when editing started, kept in
  `App.jsx` so switching tabs mid-edit doesn't lose it. By the time Save
  is clicked, the live piece may have moved on: practice logged, a rating
  changed, a Pause/Archive done from the same page, a revival ended
  elsewhere. `mergeEditedPiece` (`lib/pieceEdit.js`) builds the saved
  piece by taking *only* the fields the form actually owns
  (`EDIT_FORM_FIELDS`, an allow-list) from the draft, and everything else
  — `progress`, `memoryAnchors`, `status`, the rest of `revival`, etc. —
  from the live piece. **This is deliberately an allow-list, not a
  block-list:** forgetting to add a new form field to it fails loud (the
  edit just doesn't save, caught immediately); the opposite mistake —
  forgetting to protect a new non-form field on a block-list — fails
  silent, and would reintroduce the exact data-loss bug this exists to
  fix. If you add a new field to the edit form (`SettingsTab.jsx` or any
  of the shared field-editor components), add it to `EDIT_FORM_FIELDS`
  too. See [`docs/Decisions.md`](docs/Decisions.md#ux).

## Revival

MeasureOne includes a Revival workflow — recovering a piece that was
learned once and has gone stale. **As of Pass 88, Revival has no tab of
its own** — entry point is Piece Overview's "Start/Continue revival"
button, and while `isInRevival(piece)` is true, `TodayTab.jsx` (Daily
Practice) renders the whole thing itself: the reassessment phase
(`ReassessSequencePanel`, `components/tabs/revival/` — **since a
same-session follow-up, walks base practice chunks only, not
transitions**) while `!revival.reassessmentComplete`, then the generated
plan (Random start, Flagged chunks, the "Needs another look"
combo-escalation panel, the day-by-day plan list — transitions are still
scheduled here for practice, just not individually reassessed above) once
it's true. The ordinary calendar-driven view (Day/Week/Interleaved/All
Tasks, `ScheduleBanner`, the past-target-date nudge) doesn't render at all
during a revival — none of it applies without a calendar. `RevivalTab.jsx`
is gone; there is no `activeTab === "revival"` value and no sidebar nav
item for it, matching how Interleaved mode has never had its own nav item
either.

It's built additively on top of the existing data model, not a parallel
one: reassessment **is** `progress[id].manualConfidence` (exposed through a
fast preset UI), weak-spot flagging **is** `progress[id].flag`
(`undefined | 'rough' | 'lost'` — a tri-state, not the boolean `weakSpot`
this paragraph used to name; that field was replaced back in Pass 6 and is
now migration-only, read forward from old saves in `storage.js` but never
written), and `computeRevivalPlan` is a distinct function from
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
first-class piece-level "learned" *state* to gate other features on. **As
of Pass 83, "gate revival entry behind maintenance" no longer needs that
persisted state to fix the actual problem it was raised for**: both "Start
revival" buttons and all three of `computeRevivalTriggers`' conditions
(`lib/revival.js`) are now gated on the already-existing live
`isPlanActuallyComplete` derivation instead of a stored `piece.stage`
field — see [`docs/Decisions.md`](docs/Decisions.md#revival). The original
item's *other* half — a manual Settings control to move a piece "finished
away from the app" into maintenance — **is now built too, in a later
session, directly on request**: `piece.markedLearnedElsewhere` (Settings'
"Mark as learned elsewhere") is an unconditional override
`isPlanActuallyComplete` checks first, ahead of its normal calendar/
per-chunk logic — so setting it unlocks Archive, "Start revival," and
every other `isPlanActuallyComplete`-gated behavior at once, with no
per-surface wiring needed, closing the regression Pass 83's gate had
otherwise introduced for exactly this piece shape. See
[`docs/Decisions.md`](docs/Decisions.md#open-questions) for the full
resolution. See
[`docs/Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented)
for the "learned" rollup itself.
**Don't confuse this with Pass 58's `computeOverallConfidence`** (see the
Roadmap section below) — that's a continuous, always-moving 0–100 stat
built from `computeConfidence`, deliberately not the same question as
`isPieceLearned`'s strict "every chunk at Holding" boolean, and the two
are never read from each other.

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
(the roll-up above is a live derivation, not a stored field) — **though as
of Pass 83, "gate revival entry behind maintenance" no longer needs that
field to fix the contradiction it was raised over**; see
[`docs/Decisions.md`](docs/Decisions.md#revival) for what shipped instead
and [`docs/Decisions.md`](docs/Decisions.md#open-questions) for what's
still genuinely open (a manual Settings maintenance-transition, and the
new gap that creates for a piece never fully logged in-app) — a second
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
ones; two sidebar controls ("Edit piece settings," finishing the "Add new piece"
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
why only half of the two-part fix shipped this session. **Resolved by
Pass 70**, for an unrelated reason (the "N days behind" display rework
needed the same cutoff fix) — see
[`docs/Decisions.md`](docs/Decisions.md#open-questions) for the
after-the-fact confirmation.

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
`missedCount` rather than a new count. Two gaps flagged at the time, not
fixed in this pass: a consolidation day's logged run-through didn't
satisfy the per-chunk `doneDays` check `classifyDayCompletion` does (so a
logged consolidation day still read `"behind"`) — **resolved in a later
session, on direct request: `classifyDayCompletion` now checks
`"__consolidation__"`'s own `doneDays` for a consolidation day instead of
the per-chunk list, see [`docs/Decisions.md`](docs/Decisions.md#scheduling)**
— and neither this note nor the graying was revival-aware — a piece
mid-revival could show "(behind N chunks)" against its *original*,
pre-revival plan, not the revival plan actually being followed. **The
note half is resolved, also in a later session, on direct request:**
`OverviewTab` now suppresses it while `isInRevival(piece)`. The "graying"
half turned out not to be a distinct, separately-suppressable thing —
Overview/Timeline gray any non-`"future"` day identically, `"behind"` and
`"empty"` alike, so there's nothing behind-specific to hide beyond the
text note. See [`docs/Decisions.md`](docs/Decisions.md#open-questions).

**Since Pass 46**, the Timeline tab applies Pass 45's
`classifyDayCompletion` to every day card: a past day grays out, and a
fully-done one gets a small, transparent-styled check mark next to its day
number — a card-grid analog of Pass 45's strikethrough, not literally the
same treatment, since a card grid reads differently than a text list even
though the underlying classification is shared. Timeline also gained its
first reschedule entry point, having had none before, by rendering the
existing `ScheduleBanner` component rather than building a second
button/modal pairing.

**Since Pass 47**, Today's Practice has a second way to act on being
behind: a "Go to Day N" button that jumps to the earliest day with real
incomplete work, reusing the same `onDayChange` day-navigation Today's
Practice's own Previous/Next-day controls already use. It's explicitly an
alternative to rescheduling, not a replacement — on request, it was folded
into the *same* `ScheduleBanner` the Reschedule button already renders (two
buttons, one banner, new copy) rather than stacking a second banner
underneath. `ScheduleBanner` (`components/ScheduleBanner.jsx`) now takes
two optional props, `earliestBehindDay`/`onDayChange`, passed only by
Today's Practice — Overview and Timeline are unaffected and still render
the original single-button banner.

**Since Pass 48**, a day whose entire original task list was swept into a
reschedule — on both Timeline and Today's Practice (single-day view and
"View all") — collapses to a plain italic "Tasks rescheduled" line instead
of re-showing content that's since moved elsewhere. A day with a mix of
done, still-legitimately-scheduled, and moved items is untouched by this;
only a day where *every* original item moved collapses. The check has to
recognize a transition or combo as "moved" too, even though
`rescheduleMarker.remainingChunkOrder` only ever lists practice-chunk ids —
a transition/combo id is never itself in that list, even when it genuinely
rode along with an untouched neighbor into the rescheduled remainder
(mirrors `getEffectiveTimeline`'s own relocation filter via `linkedIds`,
rather than a bare list-membership check that would have left almost every
day past the first showing as "still has real content" purely from this
id-namespace gap, not from anything actually left behind).

**Two more bugs were found and fixed in the same session, as a direct
consequence of building the above:**
- The Pass 47 catch-up button's day search had no way to know a day it
  found had since been collapsed by Pass 48 — it kept finding the earliest
  *original* behind day (reliably day 1, once any reschedule has happened),
  sending the user to a screen with nothing on it. Fixed by having that
  search skip a day the same collapse check applies to and keep scanning
  forward.
- Rescheduling a piece a *second* time used to discard whatever the first
  reschedule had actually placed for the days in between — see the new
  regression note above (`rescheduleMarker.previous` chaining,
  `getEffectiveTimeline`) for the mechanism and fix.

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
combined") were untouched by Pass 49 itself — still the original one-time
"unlock and stay" gate at the time. **Resolved in a later session, on
direct request:** once a pair clears its own separate first-unlock gate
(unchanged), it now gets the same repeating due/locked-preview rhythm —
`sectionPairRunThroughGate` (`lib/chunking.js`), sharing a private helper
with `sectionRunThroughGate` — see
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
filter was skipped when `sequentialMode` was set** (Revival's reassessment
pass, embedded in `RevivalTab` at the time, which walked a deliberately
different, unfiltered chunk list including transitions via its own
Previous/Next) — filtering unconditionally would have silently dropped
transitions from that flow. **As of Pass 87, this no longer applies**:
`sequentialMode` is gone from `PieceMapTab` entirely (revival's
reassessment moved to its own dedicated component,
`ReassessSequencePanel` — see the Revival section below), so there is no
branch left to preserve here. `PieceMapTab`'s grid filter is now
unconditional.

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

**Since Pass 56**, a piece that's had every section's own single-section
run-through logged at least once (`coldStartGateMet`, `lib/coldStart.js` —
this one check already implies the whole piece has been covered, no
separate check needed) gets a periodic, escalating nudge to test itself
cold: a whole-piece play-through, no warm-up, logged as average BPM +
free-text notes to a new synthetic `piece.progress["__cold_start__"]` key
— deliberately **not** folded into `"__consolidation__"`'s sessions, since
`computeRevivalTriggers` reads every `"__consolidation__"` session's
`stopCount` indiscriminately and a Cold-Start session has none. The prompt
escalates at 3, 7, 14, 28, ... days (doubling past 14) since anything was
logged on the piece at all, computed as a **live derivation with no
persisted "already shown" flag** (`coldStartDueThreshold`, comparing
today's crossed threshold against the same computation one day earlier) —
same "computed fresh every call, never a persisted unlocked flag" spirit
as `sectionRunThroughGate` above. See
[`docs/Algorithms.md`](docs/Algorithms.md#cold-start-check). **Two real
gaps were found and fixed in the same session** — worth knowing if you
touch synthetic progress keys again: `lib/storage.js`'s ladder-state
backfill/diff functions now read from a shared `NON_CHUNK_PROGRESS_KEYS`
list rather than checking `"__consolidation__"` by name in two separate
places (the first cut missed `"__cold_start__"` from one of the two), and
`lib/history.js`'s `computePracticeHistory` now also indexes
`"__cold_start__"` sessions off their own `day` field — that key
deliberately carries no `doneDays`, which is what the indexing used to
rely on exclusively, so a logged check never showed up on Progress's
history list at all until this was fixed.

**Since Pass 57**, Today's Practice also renders a `RandomStartPanel` of
its own (previously Revival- and Master-Agenda-only) — every practice
chunk/transition/combo in the current piece with 2+ logged sessions,
hidden entirely below 2 qualifying entries (matching Master Agenda's own
threshold for the same component). No changes to `RandomStartPanel`
itself were needed. **Known, low-severity gap, not fixed**: the pool
filters on raw `sessions.length`, not `loggedSessions()`-filtered, so a
chunk with one real session plus a stray Interleaved skip or unconfirmed
provisional attempt can appear in the pool too, reading as more-practiced
than it actually is.

**Since Pass 58**, Progress has a piece-level "Overall confidence" stat —
`computeOverallConfidence(piece, practiceChunks, currentDay)`
(`lib/confidence.js`), an **effort-weighted** average of `computeConfidence`
across every practice chunk (confirmed with the user before building, over
a plain-average alternative — consistent with how this codebase already
weights everything else time/effort-related via `chunk.effort`), with its
own manual override field (`piece.manualOverallConfidence`, same
undefined/null-means-auto escape-hatch precedence as per-chunk
`manualConfidence`). **This is a continuous stat, not a replacement for
`isPieceLearned`** (see "Known simplifications" below) — the two answer
different questions and are deliberately not wired together either
direction. Same-session follow-up, built once explicitly requested:
`ColdStartPanel` now shows a short, genuinely optional "how would you rate
the piece overall right now?" prompt right after a Cold-Start log — five
quick-tap presets (reusing `PieceMapTab`'s existing revival "Quick rate"
values) or Skip, which writes nothing at all. Wiring this touched
`App.jsx` even though it wasn't in that pass's originally-listed
touched-file set — there's no way to build a working manual-override
control without a handler that calls `updatePiece`, and every piece
mutation in this app funnels through one owned by `App.jsx`. See
[`docs/Decisions.md`](docs/Decisions.md#overall-piece-confidence) for the
full reasoning on both of those calls.

**Since Pass 59**, `practiceBPM`'s pass/soft-miss step is gap-proportional
(a "tempo ratchet," `ladderConfig.tempoRatchet`) instead of the old flat
`bpmSteps` delta, which is now only the fallback for a chunk with no
`targetBPM` — see
[`docs/Algorithms.md#tempo-ratchet-pass-59`](docs/Algorithms.md#tempo-ratchet-pass-59).
A soft-miss now steps tempo *forward*, at half the chunk's own adaptive
rate (`progress[id].tempoRatchetK`), rather than backward. **Since Pass
60**, once `practiceBPM` is close enough to `targetBPM`
(`tempoAchievedThreshold`, default 85%), the step-size calculation
substitutes a small pinned rate (`maintenanceK`) for that tracked rate at
the point of use only — the tracked rate itself is never overwritten, so
there's nothing to restore when a chunk drops back out ("tempo maintenance
mode," `isInTempoMaintenance`, `lib/ladder.js`). **If you add a new field
to `chunkLadderState`/`computeLadderAdvance`'s return shape, it is not
enough to change `lib/ladder.js` alone** — this bit twice in the same
broader session (`tempoRatchetK` here, `holdingReviewCount` below): the
field also needs threading through all three of `App.jsx`'s session
handlers (`handleLogSession`, `handleUnlogSession`,
`handleConfirmProvisionalSession` — each hand-maintains its own field
list, not a wholesale spread) and needs a `null`, not a materialized-value,
backfill default in `storage.js` (`backfillProgressLadderState`,
`LADDER_STATE_FIELDS`, `mergeProgress`) or a byte-identical re-import
falsely reads as a conflict. See
[`docs/AI-GUIDELINES.md`](docs/AI-GUIDELINES.md) for the full checklist and
[`docs/Decisions.md`](docs/Decisions.md#spaced-repetition--maintenance) for
both incidents.

**Since Pass 61**, Holding's escalating tempo floor is retired outright —
`clearsStageFloor`'s Holding branch (`lib/ladder.js`) always returns
`true` now; meeting the rep requirement is sufficient on its own for a
Holding pass to count toward interval growth. Stabilizing/Settling are
unchanged. In its place, a new `progress[id].holdingReviewCount` counts
every logged Holding review (pass, soft-miss, *or* fail all count),
resetting on fresh entry into Holding; `resolveRequiredReps`
(`lib/confidence.js`) now requires one extra clean rep on every 4th review
since that entry, reverting to baseline otherwise.
`classifySessionOutcome`'s separate tempo check (`bpm >= practiceBPM`,
deciding whether a session is a pass at all) is completely untouched — a
different mechanism from the retired floor. The three old
`ladderConfig.holding.tempoFloor*` config fields are left in the schema
and stay directly editable in Settings, doing nothing — a deliberately
flagged loose end, not cleaned up. `InterleavePanel.jsx`'s own
`resolveRequiredReps` call needed the identical fix `ChecklistItem.jsx`
got, or a chunk's 4th/8th/12th Holding review would be judged by a
different, easier requirement depending on which screen logged it. See
[`docs/Decisions.md`](docs/Decisions.md#spaced-repetition--maintenance)
for the full trace, including the found-and-fixed `App.jsx`/null-default
bugs.

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

**Since Pass 67**, Today's Practice's "Go to Day N" catch-up button
(`findEarliestBehindDay`, `TodayTab.jsx`, Pass 47) no longer sits behind a
second, narrower pre-check (`hasBehindWork`, removed) that only looked at
practice chunks. The scan itself is now the sole source of truth for both
whether the button shows and which day it targets — it already handled
every scheduled item type correctly (transitions, combos, reviews) via
`classifyDayCompletion`, but a piece with every practice chunk logged and
only a past transition/review still incomplete used to hide the button
anyway, since the old pre-check couldn't see anything but practice chunks.
`ScheduleBanner.jsx` needed no change — it already gated its own button on
`earliestBehindDay` alone. One side effect worth knowing: this also makes
the pre-existing, still-open Pass 45 consolidation-day gap (a logged
run-through still reads `"behind"` — see
[`docs/Decisions.md`](docs/Decisions.md#ux)) more likely to actually
surface to a learner, since the old pre-check was accidentally masking it
whenever every practice chunk was otherwise caught up.

**Since Pass 68**, `SectionRunThroughPanel` only renders on real "today" —
threaded down via a new `isRealToday` prop from `TodayTab`. Browsing to a
completed past day (or a future one) used to still show whatever section
run-through was due *right now*, mislabeled as that day's own status,
since `sectionRunThroughGate`/`computeSectionRunThroughs` (Pass 49) answer
"is this due right now" with no day parameter — correct for what they're
asked, but wrong to display unscoped. Logging one from a past day would
also have silently attributed the session to `currentDay`, backdating it;
fixed for free by the same gate, since `currentDay` at render time is now
always the real current day by construction. Neither of the two `lib/
chunking.js` functions changed. See
[`docs/Decisions.md`](docs/Decisions.md#ux) for why the fix is a `useMemo`
that short-circuits internally plus an early return after it, not a
literal early return before the `useMemo` call (the latter would violate
React's rules of hooks, since this component never unmounts across a day
change).

**Since Pass 69**, Interleaved practice needs two chunks graduated past
Stabilizing to unlock, not one (`interleaveItems.length < 2`, not
`=== 0`) — a single chunk can't actually rotate against anything. Its
rotation duration is graded by the *current* chunk's own difficulty
(`ROTATION_SECONDS_BY_DIFFICULTY` in `InterleavePanel.jsx`: 2/3/4 minutes
for easy/medium/hard, "hard" keeping the original flat value) instead of
a flat 4 minutes for every chunk — fixing this correctly required adding
`current?.id` to the rotation-trigger effect's dependency array, or a
mid-session rotation would silently keep checking the previous chunk's
threshold. **Same-session follow-up, per direct request:** the eligible
pool (`TodayTab`'s `interleaveItems`) is no longer scoped to whatever the
currently-viewed day happens to schedule — it's every chunk in the whole
piece that's graduated past Stabilizing, so a chunk that graduated on an
earlier day is immediately available, not only once it comes back due.
This also appears to close an older, separately-flagged gap for free (a
live-due-only review never showing up in `interleaveItems`) — reasoned
through, not separately confirmed; see
[`docs/Decisions.md`](docs/Decisions.md#spaced-repetition--maintenance)
for both decisions and the confirmed-safe check against `needsRelearning`
chunks.

**Since Pass 74**, reschedule and the schedule banner anchor to real
"today" (`realCurrentDay`), never to whichever day Timeline/day-nav
happens to be browsing (`currentDay`) — see the new "regressions to watch
for" bullet above for the mechanism. A successful reschedule now also
resets `dayOverride` to `null` (`App.jsx`), landing the user back on real
today automatically, the same reset `onJumpToday` already used.

**Since Pass 75**, Week view and Master Agenda apply the same
"was this day fully swept into a reschedule" collapse Day view and
Timeline already had (`isDayFullySwept`, `lib/scheduling.js`) — a
rescheduled day used to still show real, clickable-looking tasks on these
two surfaces specifically. **Two same-session follow-ups, both found
during critical review before commit, not shipped as originally scoped:**
first, `isDayFullySwept` itself had a real gap — it only ever checked the
*most recent* `rescheduleMarker`, so a task moved by an earlier reschedule
and then completed before a later one was never recognized as "moved" on
its original day. The fix is **not** to walk the whole reschedule chain
(the first fix proposed, and rejected once asked whether that was really
the most efficient option) — it's simpler and doesn't reference markers
at all: has this id been done on some day *other* than the one being
checked? One `doneDays` lookup, same cost regardless of how many times the
piece has been rescheduled. Second: a review whose due date has passed
used to sit on its original bounded-timeline day forever, looking like a
still-open task — this turned out to have nothing to do with rescheduling
at all (`computeTimeline` has no notion of "today"), fixed centrally via
`withLiveReviewStatus` (`lib/scheduling.js`), applied once wherever the
timeline gets built so every screen gets the fix for free. Both follow-ups
had a real bug caught before shipping, not just an initial pass: the
"done elsewhere" check must never apply to `reviewChunkIds` the way it can
to `newChunkIds`/`specialChunkIds` — it only counts an id as stale when
`piece.progress[id].nextDueDate` is actually set, since a genuine Tier 2
review always has one but a Tier 1 "first touch" review (a chunk never
logged at all) never does; checking only `doneDays` wrongly stripped every
never-touched chunk's first-touch review in testing, before this guard
existed. See
[`docs/Decisions.md`](docs/Decisions.md#scheduling) and
[`docs/Decisions.md`](docs/Decisions.md#open-questions) for the full
investigation trail on both.

> Passes 76-82 (revival reassessment's difficulty-reassess button and
> per-chunk assessment timer; Interleaved/revival-plan reassess buttons and
> a cross-tab timer guard; a fix for Today's Practice showing the wrong
> plan mid-revival; assorted revival/reassess copy fixes; small UI fixes
> across FocusPanel, Week view, and Master Agenda; and a "Set new target
> date" reschedule-dialog button) shipped and were committed before this
> changelog was brought back up to date — see `git log` for their own
> commit messages, which have the per-pass detail this file's format would
> otherwise carry. Not backfilled here to avoid reconstructing history
> from summary rather than from having actually done the work this
> session.

**Since Pass 83**, both "Start revival" buttons (`OverviewTab`'s title
card and its own auto-trigger banner) are disabled, with an explanatory
title, until the piece's plan is actually complete
(`isPlanActuallyComplete`) — revival is for a piece already learned, not
one still mid-learning. Reviewing that live surfaced a real contradiction:
`computeRevivalTriggers`' three auto-trigger conditions (a rough
run-through's stop count, a lost flag, 60+ days of silence) didn't check
plan completion at all, so an unfinished piece could still show "this
piece might be due for a revival" right next to its own now-disabled
button. Fixed by gating all three conditions behind the same
`planComplete` check (a single early return, not three separate guards,
once it was pointed out mid-session that gating only the staleness
condition — the literal first ask — left the other two just as capable of
reproducing the same contradiction) — see
[`docs/Decisions.md`](docs/Decisions.md#revival) and
[`docs/Algorithms.md`](docs/Algorithms.md#revival-auto-triggers-pass-7-gated-on-plan-completion-since-pass-83).

A still-unfinished, quiet piece needs its own message instead of
revival's: new `computeAbandonedPlanReminder` (`lib/scheduling.js`) fires
for an active, non-revival piece with real practice history that's gone
14+ days without a session, still with real work left in its plan —
surfaced as an Overview banner ("No practice logged for '\<piece\>' in N
days. Would you like to reschedule remaining practice items, or pause this
plan?") with Reschedule and Pause actions, the latter a new `onPausePiece`
prop wired to the existing pause handler. The displayed day count steps in
flat weekly increments (14, 21, 28, ...) rather than creeping up daily.
Master Agenda gets the equivalent surface for a piece whose entire plan
calendar has run out with real work left, via a new banner built on that
file's own pre-existing `needsReschedule` per-piece flag — kept
independent of the pre-existing "N days behind schedule" banner rather
than merged into it, since a stuck piece (see the reschedule open question
above) can read `behindDaysCount === 0` and silently drop out of that
banner's count. See
[`docs/Algorithms.md`](docs/Algorithms.md#the-abandoned-plan-reminder-pass-83).

**Since Pass 84**, the "today" tab is relabeled **Daily Practice**
everywhere it's named — the sidebar nav item (`NAV_BASE`, `App.jsx`) and
the three reschedule alert/confirm strings that reference it by name. Its
own `<h1>` now renders only on the real current day (`isRealToday`,
gating the element the same way Pass 68 gated `SectionRunThroughPanel`),
disappearing entirely — no empty gap, nothing left in its place — when
browsing to any other day via day-nav or Timeline; the "Day X of Y" line
right below it lost its `" (viewing)"` suffix at the same time; that line
alone still shows on a browsed day, just without the qualifier, since the
heading's own absence already signals "not today." Every earlier "Since
Pass N" entry above still says "Today's Practice" — that's accurate
history (it was called that at the time), not a leftover to fix. Only
`App.jsx`/`TodayTab.jsx` were touched by the pass itself; two same-session
follow-ups renamed the remaining user-visible mentions the pass had left
out of its stated scope — `DayChecklist.jsx`'s two "see Today's Practice"
stale-review notes, then `ProgressTab.jsx`'s two "check items off in
Today's Practice" empty-state hints (the second one found only while
verifying the first) — so those all now say "Daily Practice" too. A
handful of code-comment-only mentions (`PieceCheckRow.jsx`,
`ScheduleBanner.jsx`, `lib/chunking.js`, `lib/history.js`,
`lib/scheduling.js`) are still unrenamed — not user-visible, low priority,
see [`docs/Decisions.md`](docs/Decisions.md#open-questions).

**Since Pass 85**, `.ghost-btn:disabled` finally has a real visual
treatment (`{ opacity: 0.45; cursor: not-allowed; }`, `App.jsx` CSS) —
matching the existing `.primary-btn`/`.danger-btn:disabled` pattern. Before
this, a disabled ghost-btn looked pixel-identical to an enabled one. A
quick audit (not just the Interleaved button named in the request) found
three real sites this affects: the Interleaved practice button
(`TodayTab.jsx`), Revival reassessment's chunk-nav "Previous" button
(`PieceMapTab.jsx`, `sequentialMode`), and Settings' "Archive piece"
button. The Archive button already had a bespoke inline-style workaround
for this exact gap (`ARCHIVE_LOCKED_STYLE`, `SettingsTab.jsx`) — a
same-session follow-up removed it once it became redundant, keeping only
the `title` tooltip text. See
[`docs/Decisions.md`](docs/Decisions.md#ux) for the full writeup,
including a live-hover-tested finding worth knowing before touching
`.ghost-btn` again: an old code comment claimed a disabled ghost-btn still
shows the brass hover tint as a "harmless quirk" (since `.ghost-btn:hover`
isn't guarded with `:not(:disabled)`, unlike the other two button
classes) — a real mouse hover in this session's test browser showed no
such tint despite `:hover` technically matching, so that quirk doesn't
reproduce there. Not verified across other browsers, and the un-guarded
hover rule itself was deliberately left untouched either way.

**Since Pass 87**, Revival's reassessment phase no longer reuses
`PieceMapTab` at all — the old `sequentialMode` prop (grid hidden behind a
mode flag, one-chunk detail wrapped in a modal layered over that hidden
grid, its own Previous/Next/Finish footer and assessment timer) is gone.
`PieceMapTab` is ordinary (non-revival) Piece Map only now, and is
meaningfully smaller for it — every sequentialMode-only branch, prop, and
piece of state (the assessment timer, `bpmOverrideOpen`, the leaving-timer
guard, `onReassessRange`/`onLogSession`/`onAssessmentTimerRiskChange`/
`onConfirmLeaveAssessmentTimer`) is gone from this file, not just disabled.
In its place, a new dedicated component,
`ReassessSequencePanel` (`components/tabs/revival/`), owns the whole
reassessment UI: one chunk shown inline in a `.panel` at a time (no grid
underneath, no modal-over-grid layering), with its own "Reassess" header,
an "N of M rated" count next to a real per-chunk segmented bar (one small
gray block per chunk, filled once that chunk is rated — not a smooth
percentage-width bar), and a small grid-icon button that opens a separate
"Progress" modal (a real floating overlay, `.modal-overlay`/`.modal`, not
another grid-under-a-modal) — one square per chunk, difficulty-tinted,
black-checkmarked once rated, faded when not, hover-only for the measure
range (no in-cell numbers, one consistent rule regardless of piece size —
see [`docs/Decisions.md`](docs/Decisions.md#revival)). Clicking a square
jumps straight to that chunk and closes the modal, through the same
timer-leaving guard Previous/Next/Finish already use. Every other carried-
over control (Quick rate, the per-chunk difficulty-reassess panel, Current/
Target BPM including the override flow, Related chunks, Notes, the
collapsible Chunk Info stats, the climbing-tempo hint, Previous/Next/
Finish reassessment) behaves exactly as it did inside `PieceMapTab`'s old
`sequentialMode` branch — this was a relocation, not a redesign of any of
those controls. **One pre-existing gap carried over unfixed, not
introduced by this pass:** the "Clear, resume review" button on a
`needsRelearning` chunk has been a silent no-op during reassessment since
before this pass — `RevivalTab` has never threaded an `onClearRelearning`
handler through to this part of the UI, old `sequentialMode` branch
included. `ReassessSequencePanel` reproduces this exactly (same
do-nothing default) rather than silently fixing or silently dropping the
button — flagged here as a real, pre-existing bug worth a decision, not
fixed as a drive-by. See
[`docs/Decisions.md`](docs/Decisions.md#revival) for the full design
writeup, including why the new panel's visual grid/bar styling is inline
CSS rather than new `App.jsx` CSS-string rules.

**Same-session follow-up, per direct request — superseded by Pass 88
below, kept here as accurate history of that session rather than rewritten:**
the "Revival settings" card (the tempo ladder's starting-BPM field) is gone
from `RevivalTab` entirely — that value is now collected once, at revival
entry (`RevivalEntryModal`, unchanged), and from then on is only editable
from Settings' new "Revival settings" panel (`SettingsTab.jsx`, shown only
while `isInRevival(piece)`), not from the Revival tab itself. Same
`onSetTempoLadderFraction` handler (`App.jsx`'s `handleUpdateRevival`),
just re-threaded to `SettingsTab` instead of `RevivalTab`. **Pass 88 removed
this Settings panel too, then a later same-session follow-up put it back**
— see both entries below; net result as of the most recent one, it's in
Settings, same as described in this paragraph. Also fixed in
the same pass: `ReassessSequencePanel`'s intro line ("Play through the
piece from beginning to end...") moved inside the "Reassess" card itself
instead of sitting as bare, card-less text above it — a visual
inconsistency with every other section on the tab, introduced by Pass 87
and caught on review, not shipped as originally designed. And
`ReassessSequencePanel` now falls back to the list's first chunk
(`chunks[0]`) if the currently selected chunk's id ever stops resolving,
instead of silently rendering nothing with no way back in — closes a
fragility gap Pass 87 flagged but didn't fix.

**Since Pass 88**, Revival is folded entirely into Daily Practice —
`RevivalTab.jsx` is deleted, there is no `"revival"` `activeTab` value, and
the sidebar has no Revival nav item at all (the `REVIVAL_NAV_ITEM`/
`navItems` splice that used to insert one while a revival was active is
gone; the sidebar is just `NAV_BASE`, always). This matches the precedent
Interleaved mode already set — a mode reached from *within* a tab, never
its own nav entry. `handleOpenRevival` (`App.jsx`) still opens the
start-revival modal for a piece not yet in revival; for a piece already in
revival it now calls `setActiveTab("today")` instead of `"revival"`, and
`handleStartRevival` does the same once a fresh revival begins. Every
existing caller (Overview's "Start/Continue revival" button and its
`revivalTriggers` banner, both already just calling `onStartRevival`)
needed no changes — confirmed live, not assumed, since the copy ("Start
revival"/"Continue revival") reads exactly as true pointing at Today's
Practice as it did pointing at a dedicated tab.

`TodayTab.jsx` now renders the actual revival content instead of the old
Pass 78 "set aside, go to Revival" redirect card: while
`isInRevival(piece)`, it returns a `Revival` header (piece name, "Returning
to its former glory," "End revival") followed by either
`ReassessSequencePanel` (while `!revival.reassessmentComplete`) or the
generated plan (Random start, Flagged chunks, the "Needs another look"
combo-escalation panel, the day-by-day `revival.plan.days` checklist) —
all lifted verbatim from the retired `RevivalTab.jsx`, not redesigned. The
ordinary view (Day/Week/Interleaved/All Tasks selector, `ScheduleBanner`,
the past-target-date nudge, `FocusPanel`, everything) never renders during
a revival, same early-return mechanism the old redirect used, just with
real content instead of a link elsewhere. `TodayTab` gained a `chunkSet`
prop (the real one from `App.jsx`, replacing a locally-reconstructed
partial `{ all, practiceChunks }` shape that lacked `.transitions`/
`.combos` — revival needs both) and several new props
(`onUpdateBPM`/`onSetManualConfidence`/`onFinishReassessment`/
`onReopenReassessment`/`onEndRevival`/`onAssessmentTimerRiskChange`/
`onConfirmLeaveAssessmentTimer`) that used to go straight to `RevivalTab`
from `App.jsx`; `onOpenRevival` (the redirect button's only consumer) is
gone, since there's nothing left in `TodayTab` for it to do.

**Resolved, per direct follow-up in the same pass: finishing reassessment
now generates the plan in the same action, not as a separate manual
step.** `onFinishReassessment` (`App.jsx`) is now
`handleUpdateRevival({ reassessmentComplete: true, plan:
computeRevivalPlan(piece, chunkSet, currentDay) })` — one `updatePiece`
call, not two. This also covers a redo: `onReopenReassessment` only ever
sets `reassessmentComplete: false`, so finishing again after a "Redo
reassessment" runs through the exact same `onFinishReassessment` path and
computes a fresh plan the same way — verified live by redoing and
re-finishing a real revival, not just reasoned through. The old
"Reassessment complete" interstitial panel (rated-count summary, "Redo
reassessment," "Generate/Regenerate revival plan") is gone — there's no
state anymore where `reassessmentComplete` is true but `revival.plan` is
still null, so nothing needs to gate that gap. `handleGenerateRevivalPlan`
(`App.jsx`) had no caller left and was deleted rather than kept dead.
**"Redo reassessment" itself wasn't dropped** — relocated to `TodayTab`'s
new Revival header, next to "End revival," shown only once
`reassessmentComplete` is true; this placement wasn't specified by the
request and is a judgment call, flagged as such rather than assumed
obviously correct. The rated-count summary text that panel also used to
show ("N of M rated, N flagged rough or lost") has no replacement anywhere
in the plan view — a deliberate simplification, not an oversight, but
worth knowing if it's missed.

**Resolved, per direct follow-up at the time: the tempo-ladder-starting-point
control is gone from the app entirely, not relocated — including out of
Settings, superseding the same-session follow-up entry just above this
one, which had put it there one session earlier.** `piece.revival.tempoLadderStartFraction`
keeps its existing stored value and `?? 0.6` fallback everywhere
`computeTempoLadder` reads it — only the on-page control to change it
disappeared. Collection at revival entry (`RevivalEntryModal`) is
completely unchanged; that's the only place this value is ever set now.
`onSetTempoLadderFraction` had no caller left (removed from both
`RevivalTab` and `SettingsTab`) and was deleted from `App.jsx` rather than
left dead. **Reversed in turn, later the same session, on direct
request** — see the "six UI adjustments" entry near the end of this
Roadmap section: the Settings panel is back, `onSetTempoLadderFraction` is
back. Both this paragraph and the one above it are accurate history of
what was true when each was written, not a contradiction to resolve —
just don't take either one, on its own, as describing where this control
lives *now* without checking the entry that comes after it.

**Confirmed, not assumed:** Master Agenda's Learning/Maintenance/Revival
piece grouping (`MasterAgendaTab.jsx`'s `subTab === "revival"`) is a filter
over `revival.active`, not a link to a screen — its "Open piece →" button
calls `switchToPiece(pieceId)` with no second argument, which defaults to
`"overview"`. It never referenced the retired `"revival"` `activeTab`
value and needed no changes; verified live by opening a mid-revival piece
from that subtab and confirming it lands on Piece Overview, not a blank
screen. A stale status string in that same subtab ("Reassessment complete
— plan not generated yet") describes a state that can no longer occur now
that finishing reassessment always generates a plan in the same step —
left as-is since `MasterAgendaTab.jsx` isn't touched by this pass; flagged
for whoever next touches that file.

**Same-session follow-up, per direct request — six UI adjustments to the
Pass 88 revival flow, none touching data shape or scheduling logic:**

- **The tempo-ladder-starting-point control is back in Settings**,
  reversing the "gone entirely, not relocated" half of Pass 88's own
  decision from earlier the same session — put back exactly as it was
  (same field, same `isInRevival(piece)` gate, same `onSetTempoLadderFraction`
  wiring) once asked directly. The lesson from Pass 88's own writeup
  still holds for the *next* time this kind of call gets made: a
  same-session UI decision can be revisited by a later, more specific
  request in the same session without it being a sign anything was wrong
  the first time.
- **Per-card "Reassess difficulty" buttons are gone from the revival
  plan's `ChecklistItem` cards** (both the day-by-day list and the "Needs
  another look" combo-escalation list) — `onReassessRange` is no longer
  passed to either. In its place, one shared `ReassessPanel` sits at the
  very bottom of the plan view, exactly mirroring how `DayChecklist`/
  `DueReviewPanel` already work in ordinary (non-revival) Daily Practice.
  `RandomStartPanel` moved to sit just above it, also now at the bottom —
  it used to sit between "Flagged chunks" and "Needs another look."
  `ChecklistItem`'s own `onReassessRange` opt-in (`components/tabs/
  today/ChecklistItem.jsx`) is untouched and still works for any future
  caller that wants a per-item control again; nothing currently passes it.
- **`ReassessPanel` (`components/tabs/today/ReassessPanel.jsx`) gained an
  opt-in `compact` prop**, default `false` — every existing caller
  (ordinary Daily Practice's own bottom panel, the new revival-plan bottom
  panel above) is unaffected. `compact` drops the wrapping `.panel
  reassess-panel` card and the collapsed-state explanatory blurb, leaving
  just a bare "Reassess difficulty" button; the expanded form itself is
  identical either way. `ReassessSequencePanel` (Pass 87) is the only
  caller that passes it, and also moved its own reassess control from the
  middle of the card (right after Quick rate) down to the bottom, right
  before the Previous/Next/Finish footer.
- **`ReassessSequencePanel`'s "Log assessed time" button is gone** —
  stopping the timer now logs it directly (`toggleTimer`, replacing the
  old separate `logAssessedTime`): starting the timer starts it, stopping
  it stops *and* logs in one action, since (per direct request) the two
  were "essentially the same thing" already. Always actually stops
  (`setTimerRunning(false)` runs unconditionally) even on a near-instant
  start/stop with nothing worth logging, so the button can never get
  stuck reading "Stop timer." `hasAssessmentTimerRisk`'s reporting up to
  `App.jsx` (the cross-tab leaving-guard) is unchanged and, if anything,
  simpler now — a "stopped but not yet logged" limbo state can no longer
  happen via this button at all, only via still-running-when-you-navigate-
  away, which was already covered.
- **`ReassessSequencePanel`'s Notes field collapses to a "+ Add a note"
  button when empty**, matching the identical pattern `ChecklistItem`'s
  own note field already used elsewhere in this app — an always-open empty
  textarea was eating card space for a field most chunks don't need. Same
  `noteOpen`-resets-on-chunk-switch pattern the existing `bpmOverrideOpen`
  state already used in this file.

**Same-session follow-up, per direct request — more small adjustments to
the same reassessment panel, plus one scope change to what reassessment
itself covers:**

- **The intro copy dropped "from beginning to end"** — now just "Play
  through the piece. Rate your confidence on each chunk to set a fresh
  baseline for practice."
- **The timer field moved above Quick rate** (previously below it), and
  its label changed from "Assessment timer" to **"Log time"** — copy
  only; nothing about `toggleTimer`, `hasAssessmentTimerRisk`, or the
  cross-tab leaving-guard changed.
- **The difficulty signal-bar icon next to the chunk header is bigger** —
  `size={13}` → `size={14}`, matching `.hero-sub`'s own 14px font-size it
  sits inline with (it read as too small next to the text it labels).
- **Revival's reassessment sequence now walks base practice chunks
  only** — a transition (labelled "Review" elsewhere in this same UI) is
  no longer something you individually Quick-rate during reassessment,
  raised directly after one showed up mid-sequence. `TodayTab.jsx` gained
  `revivalBaseChunks` (`chunkSet.practiceChunks`, no transitions) and
  passes it as `ReassessSequencePanel`'s `chunks`/the `ratedCount` it
  drives. The broader `revivalItems` (practice chunks + transitions)
  keeps doing exactly what it did before everywhere else: the generated
  day-by-day plan (a transition still gets scheduled there for practice),
  Random start, and the ad hoc "Reassess difficulty" quick-pick panel at
  the bottom of the plan view.
- **"Related chunks" was briefly relocated into a new "Chunk Info"
  dropdown earlier in this same round of changes, then removed outright,
  same session, on direct follow-up request** ("for now" — read as
  temporary, not a permanent call that this field has no value here; a
  future request could bring it back). `ReassessSequencePanel` no longer
  imports `findRelatedChunks`, computes a `relatedChunks` list, or accepts
  a `relatedChunkPool` prop; `TodayTab.jsx` no longer passes one.
  `PieceMapTab`'s own "Related chunks" field (ordinary, non-revival Piece
  Map) is completely unaffected — a separate render path, never a shared
  component. See [`docs/Decisions.md`](docs/Decisions.md#revival) for the
  full writeup.

**Since Pass 89**, `computeTimeline`'s introduction loop feeds on a
difficulty-first order, not raw measure order —
`sortPracticeChunksForIntroduction` (`lib/scheduling.js`) sorts a copy of
`practiceChunks` into 4 tiers before the existing effort-spreading
placement loop ever sees it (the loop itself, and transitions'/combos' own
placement, are untouched — only the order chunks are fed in changes): tier
0 (a chunk whose trouble spots just resolved — no data source yet at the
time, since the Trouble-spot pass hadn't shipped; **populated as of Pass
91** by `troubleSpotResolvedIds`, built early specifically so that pass
didn't need to touch this sort again — see
[`docs/Algorithms.md`](docs/Algorithms.md#focus-spots-v1)), tier 1 (hard chunks),
tier 2 (a hard chunk's immediate measure-neighbor, matched the same way
`generateComboChunks` already defines adjacency — confirmed, not assumed,
before building), tier 3 (everything else). Deliberate UX consequence: day
one of a plan no longer necessarily shows the piece's literal opening
measures. Accepted, not chased: a hard chunk's neighbor's own neighbor
(one degree further out) stays tier 3. See
[`docs/Algorithms.md`](docs/Algorithms.md#timeline--scheduler) and
[`docs/Decisions.md`](docs/Decisions.md#scheduling).

**Since Pass 90**, a single unified daily-workload smoothing pass
(`smoothOverloadedDays`, `lib/scheduling.js`) replaces what used to be a
narrower, reviews-only version of the same idea — confirmed before
building, not guessed at, since running both side by side risked one
undoing the other's fix on the same day. It runs **twice**: once right
after chunks are placed (introduction-only, scoped to `frontDays`, before
transitions/combos/reviews compute anything from `introducedDay` — see the
new regression note above for why this sequencing is load-bearing), and
once at the end (transitions + combos + Tier 2 reviews together, Tier 1
never included). The acceptable load band is scheduleMode-aware — 125%/80%
of average for `scheduleMode: "days"`, 110%/90% of `minutesPerDay` for
`scheduleMode: "minutes"` — and a move only happens if it strictly reduces
total distance outside that band; a move that would just relocate the same
overshoot elsewhere is declined outright. See
[`docs/Algorithms.md`](docs/Algorithms.md#timeline--scheduler) rule 5 and
[`docs/Decisions.md`](docs/Decisions.md#scheduling).

**Same broader session, once rescheduling was checked against Pass 89's
reorder:** a real bug was found and fixed — see the new regression note
above (`sortPracticeChunksForIntroduction`'s neighbor check, array index
vs. measure boundary). Not "rescheduling doesn't apply the new rules" (it
does; it calls the same `computeTimeline`) — narrower than that, and easy
to conflate with the broader claim at first.

**Also since Pass 90, on direct request:** Daily Practice (`DayChecklist`)
can show a read-only card for something genuinely completed on a day whose
*current* live schedule no longer lists it there — a transition/combo this
pass's own smoothing relocated, or a review whose due date has since
advanced past that occurrence. The underlying session record
(`doneDays`/`sessions[]`) was never actually lost; only the live,
recomputed-every-render projection had nowhere left to show it.
`findHistoricalItemsForDay`/`findNextOccurrenceDay` (`lib/history.js`) are
plain, reusable `lib/` functions — not wired into `DayChecklist`'s own
state — specifically so a later pass extending this to Week view doesn't
need to redo the lookup. `ChecklistItem`'s new `historical` prop hides the
timer, reps/BPM inputs, fail checkbox, log/undo controls, and note
editing; **same-session follow-up, once seen actually rendered**, it also
hides the requirement line and the Spaced Repetition line (both answer
"what's needed going forward," not this card's question) and drops the
separate `Completed here` tag entirely (sitting on a specific day already
implies that) — leaving just the "Logged: ..." line and a `Go to next
scheduled practice (Day N) →` link. Daily Practice only for now — Timeline/
Week view/Master Agenda don't render individual item cards, only rolled-up
range badges. See
[`docs/Algorithms.md`](docs/Algorithms.md#historical-cards-on-daily-practice)
and [`docs/Decisions.md`](docs/Decisions.md#ux).

**Since Pass 91 (experimental v1),** MeasureOne has a **focus spots**
mechanism: a specific passage inside a practice chunk that needs slow,
minutes-based drilling before it's ready for the chunk's normal reps/BPM
tracking. A spot flagged at Wizard setup time (`fromSetup: true`) holds its
whole chunk back from introduction entirely — no day, no `introducedDay`,
transitions/combos touching it excluded too, the whole-piece consolidation
run-through excluded too; a spot added later from a chunk's own Daily
Practice card (`fromSetup: false`) never retroactively pulls an
already-scheduled chunk back off the plan. `focusSpotGate`
(`lib/scheduling.js`) is the one predicate everything else reads. Resolving
a chunk's last open spot seeds its `practiceBPM` as the minimum
`resolvedBpm` across every spot on it. A new "Focus spots" Wizard step (5
of 7, between Difficulty and Timeline) and a matching Settings panel gate
whether the "add a spot" affordance is offered at all
(`piece.troubleSpotsEnabled`); a `FocusSpotsPanel` on Daily Practice shows
one `FocusSpotCard` per unresolved spot anywhere in the piece, reading
`piece.progress` directly rather than the current day's schedule. See
[`docs/Algorithms.md`](docs/Algorithms.md#focus-spots-v1),
[`docs/Data-Model.md`](docs/Data-Model.md#focus-spots-v1), and
[`docs/Decisions.md`](docs/Decisions.md#focus-spots-v1).

**A spot's chunk association is anchored to a real, validated measure
position, not just the chunk id it happens to be nested under.** `position`
is required (not optional) and validated at both entry points via
`parseMeasurePosition` (`lib/utils.js` — "24", "24a", or "24-25", checked
against the piece's own `totalMeasures`); the parsed numbers
(`startMeasure`/`endMeasure`) are what `reassociateTroubleSpots`
(`lib/chunking.js`) matches against a chunk's own range to find a spot's
real current home, rather than trusting the id it's nested under. **This
matters because chunk ids are just `c${start}`** — a chunking-scheme edit
can produce an id that still exists but now covers different measures
entirely (`customChunkSize` 8 → 4 both produce a "c9," just at 9–16 then
9–12), which reads as pure continuity to `migrateOrphanedProgress`'s
existence check alone. **If you touch `reassociateTroubleSpots`, keep the
measure-position match — don't simplify it down to an id-existence check**,
or this exact bug (a spot silently orphaned by a chunking edit, the thing
this function was built to fix) comes back. Wired into three places: the
Wizard, reactively, so the Focus spots step never shows a stale association
even mid-setup; `App.jsx`'s `handleSavePiece`, chained right after
`migrateOrphanedProgress`; and `validateAndMigratePiece` unconditionally on
every load, as a self-healing safety net (guarded on
`Array.isArray(migrated.measureDifficulty)` specifically, since that field
was never defaulted in this migration before and calling
`generatePracticeChunks` without it throws — found by the test suite, not
assumed safe).

**A focus-spot practice card gates on a minimum practice time before
either action enables** (`piece.troubleSpotDefaultMinutes`, default 5,
`min={1}` enforced in both editors) — a countdown timer counts down to
that target, then flips to counting up past it once met, checked against
whichever is larger, the running timer or a manually-typed minutes value.
Closes a real gap found by direct question ("what happens if you log under
the default"): before this, nothing enforced it at all, and a spot could
be resolved — permanently seeding the parent chunk's `practiceBPM` — off
zero seconds of actual drilling.

**Two real bugs were found in critical review, before this was ever
committed, and both are worth knowing if you touch this feature again:**
`ChecklistItem`'s leading "mark done" checkmark button sits outside every
`isPaused`-gated block in that component (the reps/BPM form, the log
button — all simple conditional rendering — are not the same code path as
this button), so pausing a chunk mid-practice-session used to leave that
one control still live; fixed by folding `!isPaused` directly into
`canLog` itself, the single value the button's `disabled`, tooltip, and
`submitLog`'s own guard all already read. And the `.checklist-item.paused`
CSS existed but the class was never actually applied to the element — a
paused card only ever showed the inline note, never the dashed-border
visual treatment the CSS was written for.

**"logged today" is "does any session exist for today," never "was the
most recent action today"** — worth remembering if you build another
undo control keyed to a boolean like this. `FocusSpotCard`'s own checkbox
undo first shipped clearing only the *most recent* today-dated session,
which left it looking stuck checked the moment a second session got logged
the same day (log some time, come back later, log more — an ordinary
thing to do), since at least one still matched "today." Found from a
direct user report of "inconsistent" behavior, not caught in initial
testing. Fixed by clearing every today-dated session in one click, not
just the last one — the boolean and the undo action now agree about what
"today" means.

**Since Pass 92**, the four day-list surfaces (Day view/`DayChecklist`,
Timeline, Week view, Master Agenda) that each grew their own slightly
different "there's nothing left to show here" check now share one:
`classifyDayEmptyState(day, piece, chunkById)` (`lib/scheduling.js`)
reuses `isDayFullySwept` internally and returns `null` (render normally),
`"rescheduled"`, or `"empty"`. Every surface now renders exactly one of
two strings for a non-null result — "Tasks rescheduled" (unchanged) or
"Nothing scheduled." (period included) — and the staleness-specific notes
that used to explain a day emptied by a stale review going live elsewhere
("Now due — see today," "Already due — see Daily Practice") are gone
outright: that case now reads the same as any other empty day. Timeline
gained a real empty-day fallback it never had before (it used to render
no text at all there), and Timeline/Week view stopped special-casing rest
days with their own "Rest day" label — Interleaved practice and section
run-throughs stay reachable from Daily Practice regardless of what a day
has scheduled, so a rest day reads the same as any other empty one now.
See [`docs/Algorithms.md`](docs/Algorithms.md#timeline--scheduler) (end
of section) and [`docs/Decisions.md`](docs/Decisions.md#scheduling).

**Since Pass 93**, Settings is two things, not one. The Settings tab
itself now shows only what isn't about the current piece — "Pieces" (Add
new piece) and "Backup & restore" — plus a read-only "Current piece
details" summary sitting directly above a prominent "Edit piece settings"
button, which is now in the sidebar on every tab (previously Overview
only). Everything about the current piece lives on that edit page
instead: the shared field-editor components as before, plus three panels
that used to apply immediately and are now ordinary draft fields saved
with "Save changes" — Focus spots, the revival tempo field, and "Mark as
learned elsewhere" (which now asks for confirmation before marking, since
it can reclassify a piece's whole schedule state). Only Practice status
and Delete stayed as an "Applies immediately" group below the Save/
Discard row, since they still act on the live piece the instant they're
clicked. Building this surfaced a real, separate data-loss bug — see the
new "Rules that matter every session" bullet above (`mergeEditedPiece`) —
fixed in the same pass. See
[`docs/Architecture.md`](docs/Architecture.md#main-ui-components) (the
`SettingsTab` row) and [`docs/Decisions.md`](docs/Decisions.md#ux).

**Since Pass 94**, five small UI fixes. One shared CSS rule
(`.field > .segmented`/`.ghost-btn`/`.primary-btn`/`.danger-btn`,
`.pairs-list > .ghost-btn`) replaces every per-site inline `alignSelf:
"flex-start"` patch for a toggle or standalone button that used to
stretch to its column's full width — text inputs/selects/textareas are
unaffected, and the sidebar's `.ghost-btn.full` stays intentionally full
width. "Interleaved practice" is now also the way out of Interleaved
mode: it reads "Exit interleaved practice" while active and returns to
Day View through `leaveInterleaved`, so an unconfirmed provisional
session still gets the warn-and-discard prompt; its "needs two
qualifying chunks" disable now applies only to entering, not exiting.
`ScheduleBanner`'s "Go to Day N" button (and its matching "or pick up
where you left off" sub-copy) is hidden while already browsing that exact
day. `.modal-foot` gained a gap and wraps, fixing the reschedule dialog's
buttons touching when all four show. And `LadderConfigEditor` dropped its
dead "Tempo ratchet" sub-section (the three `ladderConfig.bpmSteps`
fields) — unreachable UI since Pass 59's gap-proportional `tempoRatchet`
replaced it as the live mechanism; `bpmSteps` itself is untouched in
config/storage/`lib/ladder.js`, still live as the no-target-BPM fallback,
just no longer editable. See
[`docs/Decisions.md`](docs/Decisions.md#ux) and
[`docs/Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built).

**Since Pass 96**, Piece Map's chunk-detail modal has a Focus spots
column. The "Run-through flag" label is gone (the button's own text
already says what it does), and the button moved down to sit directly
above the Current BPM/Target BPM row — which puts "Related chunks"
directly under the card details instead, now beside a new "Focus spots"
field in a two-column row that stacks only once the modal is too narrow
for both. Each spot links into Daily Practice: an open spot always lands
on real today, scrolled to its `FocusSpotCard`; a resolved spot lands on
its chunk's next scheduled day (`findNextScheduledDay`, `lib/history.js`)
scrolled to its `ChecklistItem`, or shows the same muted "Not currently
scheduled again within this plan." text `ChecklistItem`'s historical
cards already use when there isn't one; mid-revival, every spot is plain
text, no link, since Today's Practice shows neither a day view nor the
Focus spots panel then. Landing uses one shared mechanism: `onSelectDay`
(`handleSelectDay`, `App.jsx`) gained an optional `scrollTargetId`
argument, and a new `scrollToOnArrival` state/effect scrolls to and
briefly highlights (`.arrival-highlight`, a `box-shadow` pulse — not
`background`/`border-color`, both already meaningful state on these
cards) the target once Today's Practice has actually rendered, mirroring
the existing `focusTargetDateOnSettings` pattern exactly. Display and
navigation only — adding, resolving, or deleting a spot is still only
ever done from Daily Practice or the Wizard. See
[`docs/Algorithms.md`](docs/Algorithms.md#piece-map-focus-spots-linked-to-todays-practice-pass-96)
and [`docs/Decisions.md`](docs/Decisions.md#focus-spots-v1).
