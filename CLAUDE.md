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
- **`Wizard` is create-only.** Editing an existing piece always goes through
  `SettingsTab`, never the wizard.
- **Piece Map chunk detail is a modal, not inline** — this was a deliberate
  UX fix (inline rendering was invisible below the fold); don't revert it.
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
zones or difficulty reassessment, and no first-class "this piece is
learned" state yet — a definition is decided but not implemented, see
[`docs/Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md).

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
defined as every chunk reaching Holding, though nothing yet queries that
roll-up. The live "what's due" query that works beyond the current plan's
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
SettingsTab's "Maintenance ladder" panel). Still not built: the
piece-level "learned" rollup (nothing queries "every chunk at Holding"
yet), a second Tier 1 rung, and Stage 5 repertoire rotation.
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
the purpose blurb. The revival-mode UI still does not display why this
revival was started (`revival.purpose`) or when the piece was last played
anywhere — flagged as a possible follow-up, not treated as settled.

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

**Also this session:** the reschedule confirmation dialog (`handleReschedule`,
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
