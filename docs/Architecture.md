# Architecture

> **Purpose:** How the codebase is organized today — where a given
> concept's code actually lives.
> **Audience:** Human developers and future Claude Code sessions who need to
> find or place code, not just understand product behavior.
> **Scope:** Tech stack, file/component layout, state management conventions,
> and design tokens. Data shapes live in [Data-Model.md](Data-Model.md);
> computations live in [Algorithms.md](Algorithms.md). For day-to-day coding
> conventions and gotchas, see `CLAUDE.md` at the repo root — this doc is the
> reference, `CLAUDE.md` is the fast-orientation version.
> **Related:** [Data-Model.md](Data-Model.md) · [Algorithms.md](Algorithms.md) ·
> `../CLAUDE.md`
> **Update when:** A file is added, moved, or renamed — this doc should
> always match the real file tree, not describe a plan for it.

## Tech stack

- React 18 (function components + hooks only, no class components)
- `lucide-react` for icons
- No CSS framework — a single hand-written CSS string (`const CSS = \`...\``)
  injected via a `<style>` tag inside the root component. All colors go
  through CSS custom properties defined on `.measureone-app` (see
  "Design tokens" below). There is no Tailwind and no CSS modules.
- No backend. All persistence is client-side `localStorage`.
- No React Router — navigation is a simple `activeTab` string in state,
  switched via a sidebar.

Running locally: `npm install && npm run dev` (Vite, default port 5173).
`npm run build` produces a static `dist/` — no server-side requirements,
deployable to any static host.

## File structure (current)

```
MeasureOne.jsx/
├── CLAUDE.md
├── docs/                       # this directory
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx                 # ReactDOM entry point, just mounts <App />
    ├── App.jsx                  # state + layout only — ~1,510 lines; renders
    │                            # the sidebar and whichever tab is active,
    │                            # owns updatePiece and every handler passed
    │                            # down as props. The CSS string also still
    │                            # lives here (see "Design tokens" below).
    ├── lib/                      # pure functions — chunking, scheduling,
    │   │                         # confidence, revival, storage, shared
    │   │                         # constants/utils. No JSX, no React state.
    │   ├── utils.js               # clamp, formatting, resize helpers
    │   ├── constants.js            # EFFORT_TO_MIN, DIFFICULTY_META, etc. —
    │   │                           # single source of truth, see Research.md
    │   ├── chunking.js              # generatePracticeChunks and friends
    │   ├── scheduling.js             # computeTimeline and friends
    │   ├── confidence.js              # computeConfidence and friends; also
    │   │                               # getSuggestedStartingBPM — the
    │   │                               # system-recommended (guidance-only)
    │   │                               # starting tempo, one of three
    │   │                               # distinct tempo concepts, see
    │   │                               # Algorithms.md#starting-suggested-and-demonstrated-tempo
    │   ├── revival.js                  # computeRevivalPlan, computeComboEscalations,
    │   │                                # and computeRevivalTriggers (Pass 7's three
    │   │                                # independent auto-trigger conditions, read by
    │   │                                # OverviewTab — see Repertoire-Lifecycle.md#revival-auto-triggers)
    │   ├── ladder.js                     # computeLadderAdvance — spaced-repetition
    │   │                                  # maintenance stage math; called from
    │   │                                  # App.jsx's handleLogSession on every
    │   │                                  # logged session. Also applyRunThroughFlag
    │   │                                  # (Pass 6's rough/lost demote-and-pin,
    │   │                                  # called from handleSetFlag), STAGES
    │   │                                  # (exported for confidence.js's reuse),
    │   │                                  # and computeDemonstratedTempoBaseline
    │   │                                  # (Pass 10-adjacent: 3+ clean reps at a
    │   │                                  # bpm above the current baseline
    │   │                                  # overrides it outright — the third of
    │   │                                  # the three tempo concepts, see
    │   │                                  # Algorithms.md#starting-suggested-and-demonstrated-tempo).
    │   │                                  # needsRelearning (Pass 11) is a persisted,
    │   │                                  # sticky flag threaded through
    │   │                                  # chunkLadderState on every call, not just a
    │   │                                  # per-call return value — see
    │   │                                  # Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built
    │   ├── maintenance.js                 # computeDueReviews — the live "what's
    │   │                                  # due" query (Pass 8). Reads each chunk's
    │   │                                  # nextDueDate against a real calendar date,
    │   │                                  # entirely independent of computeTimeline /
    │   │                                  # timeline.days[], so it still answers for a
    │   │                                  # piece that has run past its plan. Skips a
    │   │                                  # chunk outright if needsRelearning is set
    │   │                                  # (Pass 11), regardless of nextDueDate. Called
    │   │                                  # by both MasterAgendaTab and TodayTab
    │   │                                  # (plus totalDueMinutes, the shared
    │   │                                  # effort→minutes total for a due list)
    │   ├── works.js                      # multi-movement grouping helpers
    │   └── storage.js                     # localStorage load/save/export/import
    └── components/
        ├── NumberInput.jsx, MemoryAnchorField.jsx, Manuscript.jsx,
        │   ScheduleBanner.jsx, Sparkline.jsx,
        │   PartSwitcher.jsx                     # small standalone pieces
        ├── Wizard.jsx                            # create-only piece setup
        ├── RevivalEntryModal.jsx, DeletePieceModal.jsx
        ├── ExportPiecesModal.jsx, ImportPiecesModal.jsx,
        │   PieceCheckRow.jsx                       # per-piece export/import picker
        ├── fields/                                # editors shared by
        │   │                                       # Wizard and SettingsTab
        │   └── BasicsFields.jsx, SectionsEditor.jsx, DifficultyEditor.jsx,
        │       RecurringEditor.jsx, ScheduleFields.jsx, BpmZonesEditor.jsx,
        │       RecordingsEditor.jsx, RecordingsList.jsx
        └── tabs/
            ├── OverviewTab.jsx, TimelineTab.jsx, PieceMapTab.jsx,
            │   ProgressTab.jsx, AnalyticsTab.jsx, SettingsTab.jsx,
            │   MasterAgendaTab.jsx
            ├── TodayTab.jsx
            │   └── today/  ChecklistItem.jsx, DayChecklist.jsx,
            │                FocusPanel.jsx, SectionRunThroughPanel.jsx,
            │                ReassessPanel.jsx
            └── RevivalTab.jsx
                └── revival/  RandomStartPanel.jsx
```

This split (see "Module layout" below for the reasoning) replaced the
original single ~3,900-line `App.jsx` inherited from the app's origin as a
single-file Claude.ai artifact.

## Main UI components

| Component | Purpose |
|---|---|
| `NumberInput` | Every numeric field uses this instead of a raw `<input type="number">` — decouples displayed text from committed value (commits on blur/Enter) to avoid a controlled-input bug where clearing a field to retype gets fought by React re-rendering the old value mid-keystroke. Always use this for numeric fields. |
| `ManuscriptDoodle` / `ManuscriptStrip` | Decorative SVG staff/clef band and the colored horizontal strip of practice chunks shown on the dashboard and wizard review step. `ManuscriptStrip` uses a custom tooltip, not native `title`. |
| `BasicsFields`, `SectionsEditor`, `DifficultyEditor`, `RecurringEditor`, `ScheduleFields`, `BpmZonesEditor`, `RecordingsEditor` | Shared field-editor components, used in both `Wizard` and Settings — see [Product-Principles.md](Product-Principles.md#shared-editors-not-divergent-flows). Add new piece-level fields to one of these rather than duplicating markup. |
| `RecordingsList` | Renders `piece.recordings` as clickable links; used on the Overview dashboard. |
| `PartSwitcher` | Strip of sibling movements on the Overview of any piece belonging to a multi-movement work, plus "Add a movement". Shows each movement's own measures-touched percentage — deliberately not a combined work total, see [Decisions.md](Decisions.md#multi-movement-works). |
| `Wizard` | Multi-step modal for creating a new piece (create-only — see [User-Flows.md](User-Flows.md#1-setting-up-a-new-piece)). |
| `ScheduleBanner` | The "N chunks behind schedule" banner (Overview, Today). |
| `OverviewTab` | The dashboard / landing screen. Renders `ScheduleBanner`, plus — since Pass 7 — a revival-suggestion banner driven by `computeRevivalTriggers(piece, chunkSet)` (`lib/revival.js`) whenever any of Revival's three auto-trigger conditions fire and no revival is already active; lists every reason that independently fired, not just the first. Takes `chunkSet` as a prop (passed down from `App.jsx` alongside `piece`) specifically for this check. See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#revival-auto-triggers). |
| `TimelineTab` | Full day-by-day schedule, grouped by week; day cards jump to that day in Today. |
| `PieceMapTab` | Grid of every chunk colored by confidence. Clicking a tile opens a **modal** (not inline — see [UX-Principles.md](UX-Principles.md#detail-on-demand-uses-a-real-modal-not-inline-expansion)) with BPM inputs, manual-confidence override, a run-through flag toggle (untouched/rough/lost — replaces the old boolean weak-spot toggle as of Pass 6, see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)), and a memory-anchor field. **Since Pass 11**, a flagged-for-relearning chunk also shows a small icon on its grid cell plus a "Needs reinforcement" ladder-status row in the modal, with a "Clear, resume review" button (`onClearRelearning` prop) — the manual half of `needsRelearning`'s dual exit, see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built). That prop defaults to a no-op, same defensive pattern `onSetFlag`/`onSetMemoryAnchor` already use — `RevivalTab`'s embedded usage below doesn't pass it, so the button renders but does nothing there; flagged as a known gap, not a deliberate design choice. Also used embedded (with `hideHeader`/`sequentialMode`/`initialSelectedId`/`onFinishSequential`) by `RevivalTab` for the fast reassessment pass — see [Algorithms.md](Algorithms.md#revival) — rather than a second grid component. |
| `MemoryAnchorField` | Small commit-on-blur textarea, same decouple-from-render pattern as `NumberInput`, for the modal's memory-anchor field. |
| `ChecklistItem` / `DayChecklist` | The practice-logging UI for a regular chunk: timer, reps/BPM inputs, a "needs more work" fail override, checkbox that submits directly (`submitLog()`). Reps/BPM are auto-classified into a pass/soft-miss/fail outcome — see [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder) — not a free-standing effectiveness rating. Stays visible (relabeled "Log another attempt") even once something's logged for the day, so a same-day re-attempt is reachable, not just supported by the data model. On a chunk's first-ever encounter (no session logged, no `practiceBPM` yet), the BPM field's placeholder shows `getSuggestedStartingBPM`'s recommendation and a one-line note invites the learner to pick their own tempo instead — gone once a real session exists. **Since Pass 11**, `ChecklistItem` also resolves `getSuggestedStartingBPM` unconditionally on every render (not just first encounter) and passes it through `sessionInput.suggestedStartingBPM` on every `onLogSession` call — `handleLogSession` (`App.jsx`) needs this value to reset `practiceBPM` the moment a chunk gets flagged for re-learning, which can happen well past its first session; see [Algorithms.md](Algorithms.md#starting-suggested-and-demonstrated-tempo). The undo control's label/tooltip differ depending on whether undo will fully reverse the session (stage/tempo/schedule) or only remove the log record — computed client-side from the same latest-session-plus-snapshot check `handleUnlogSession` uses, so the copy never promises more than it'll do; see [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder). `ChecklistItem` also accepts optional `tempoLadder`/`memoryAnchor` props (rendered as extra tip lines when present) — used by revival plan items, absent everywhere else. **On a consolidation day, `DayChecklist` renders a distinct internal `ConsolidationPanel` instead of a list of `ChecklistItem`s** — a stop-count input (Log/Undo, same append-and-remove-most-recent-record shape as regular logging, but no ladder state to fully reverse) rather than reps/BPM, since there's no new material to grade (Pass 6, see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)). |
| `FocusPanel` | Ranks everything touched so far by confidence, independent of today's schedule. |
| `SectionRunThroughPanel` | Surfaces unlocked section run-throughs/combined run-throughs — see [Algorithms.md](Algorithms.md#section-run-throughs). |
| `ReassessPanel` | Re-rate difficulty for a measure range; Apply commits and closes in one action. |
| `TodayTab` | Composes `ScheduleBanner`, `FocusPanel`, `DayChecklist` (or all days in "View all" mode), `SectionRunThroughPanel`, `ReassessPanel`. **Since Pass 8 it has a second day-view branch**: once the piece has run past the end of its bounded plan, the "Day N of N" header becomes "Plan complete — maintenance, day N" and `DayChecklist` is replaced by an internal `DueReviewPanel` listing `computeDueReviews(...)` output. Prev/next day nav is disabled in that state (no bounded grid left to page through); "View all" still shows the whole original plan, so the plan stays reachable. Due items render through the same `ChecklistItem` the plan uses, keyed to the elapsed day number, so logging, undo and the ladder advance are the one code path either way. |
| `RevivalEntryModal` | Collects `lastPlayedDate`, optional `performanceTempo`, and required `purpose` before a revival cycle starts. Styled like `Wizard`'s modal shell. |
| `DeletePieceModal` | Confirms permanent deletion by requiring the piece's exact name to be typed back, rather than a single `window.confirm()` — deletion has no undo and takes all practice history with it. |
| `ExportPiecesModal` / `ImportPiecesModal` / `PieceCheckRow` | Per-piece export/import picker — lets the user choose which pieces to include rather than an all-or-nothing backup file. `PieceCheckRow` is the shared checkbox-row list item both modals render. |
| `RandomStartPanel` | Revival-only: picks a uniformly random chunk, transition, or section and displays it (plus its memory anchor, if any) for a cold-start warm-up. |
| `RevivalTab` | Composes the revival flow end to end: settings (performance tempo, tempo ladder start fraction), the embedded `PieceMapTab` reassessment pass, flagged-chunks summary (rough/lost, same field the Piece Map's run-through flag sets — see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)), `RandomStartPanel`, and the generated plan (day-grouped `ChecklistItem`s with tempo ladders/memory anchors). See [Algorithms.md](Algorithms.md#revival). |
| `ProgressTab` | Trend/diagnosis charts — rolling-window consistency, heatmap, actual-vs-planned, projected finish, tempo trend, effectiveness calibration, recent history. |
| `AnalyticsTab` | Confidence-by-difficulty, recurring-material payoff. **Slated to be folded into `ProgressTab` and removed** — not yet done; see [Roadmap.md](Roadmap.md). Check the sidebar `NAV` array for current truth before assuming either state. |
| `MasterAgendaTab` | Cross-piece daily view — aggregates every *active* piece's scheduled tasks for a selected date (date-navigable, not locked to today) into one list, so a multi-piece user isn't switching between pieces to see the whole day. For a piece still inside its plan it reads `getEffectiveTimeline(...).days[dayNumber - 1]` directly, the same fixed-length, `daysToLearn`-bounded indexing `TodayTab` uses. **Since Pass 8, a piece that has run past its plan no longer falls out of that indexing** — it renders a due-maintenance summary from `computeDueReviews` (`lib/maintenance.js`) instead: merged measure ranges under a "Due" tag, plus a count. That branch only ever fires for the real today, since due-ness is strictly "as of today" and the date picker must not become a forward-looking window. |
| `SettingsTab` | View mode: read-only summary + Edit/Delete/Add-new-piece/Export/Import. Edit mode reuses the shared field-editor components. |
| `App` | Root component. Owns all state and renders the sidebar + active tab, or the empty-state/loading screens. |

## State management

Everything lives in `App`'s `useState`/`useEffect` — no external state
library.

- `pieces` (object, id → piece) + `activePieceId` — the multi-piece
  collection. `piece = activePieceId ? pieces[activePieceId] : null` is
  derived, not stored separately.
- `updatePiece(updaterFnOrValue)` — the one function every mutation goes
  through, always updating `pieces[activePieceId]`. **Use this, not
  `setPieces` directly**, for any change to the active piece.
- `editDraft` (+ `setEditDraftState`) — lives at the `App` level so
  navigating away from Settings mid-edit and back doesn't lose in-progress
  changes (it used to live inside `SettingsTab`, which unmounts on tab
  switch and silently discarded edits).
- `dayOverride` — lets the user browse other days in Today without changing
  which day is "actually" today; `null` means "follow real time."
  `getCurrentDay(piece, totalDays)` derives the real day from
  `piece.startDate` (day 1, editable on the Schedule tab) vs. today's date —
  not `piece.createdAt`, which is sort-order bookkeeping only. See
  Data-Model.md and Decisions.md#scheduling.
- `wizardOpen`, `switcherOpen`, `settingsEditing`, `activeTab`, `loaded`,
  `revivalModalOpen` — straightforward UI state.
- `navItems` — `NAV_BASE` with `REVIVAL_NAV_ITEM` spliced in (before
  Progress) only while `piece.revival.active` is true; the sidebar renders
  this instead of `NAV_BASE` directly.
- Backup: `handleExportClick` opens `ExportPiecesModal` (pick which pieces
  to include, then `downloadBackup` on that subset — not an all-or-nothing
  export); `handleImportClick`/`handleImportFile` open `ImportPiecesModal`,
  and `handleConfirmImport` restores the selected pieces, matching by id or
  by name+composer so re-importing a backup updates an existing piece
  instead of duplicating it.

`chunkSet` and `timeline` are `useMemo`'d off `piece` — pure derivations,
never stored in `piece` itself. Schedule-related state that must persist
(like the reschedule marker) goes on `piece` as input data, and the
derivation recomputes from it on every render where `piece` changed.

## Design tokens

CSS custom properties on `.measureone-app`: `--paper`, `--paper-card`,
`--ink`, `--ink-soft`, `--ink-faint`, `--line`, `--brass`/`--brass-deep`
(primary accent), `--teal` (easy/confident/positive), `--brick`
(hard/needs-work/danger). Fonts: Fraunces (headings), Inter (body/UI), IBM
Plex Mono (numbers). See [UX-Principles.md](UX-Principles.md) for the intent
behind this system, not just the token names.

## Module layout (the old "Suggested refactor" — now done)

The single-file `App.jsx` was split into `lib/` (pure functions, no JSX) and
`components/` (everything with JSX) along the lines this section used to
propose — see "File structure" above for the resulting tree. It was done
incrementally, one module at a time, with a build and a manual browser pass
through the affected screens after each move; the commit history has one
commit per module for exactly this reason, so `git log -- src/` is a
reasonable changelog of how the split happened if that's ever useful.

A few decisions made along the way that weren't spelled out in the original
plan:
- Two generic modules were added that the original plan didn't call out:
  `lib/utils.js` (cross-cutting helpers like `clamp` and formatting, needed
  by more than one of chunking/scheduling/confidence) and
  `lib/constants.js` (single source of truth for values like
  `EFFORT_TO_MIN` and `DIFFICULTY_META` that both `lib/` and `components/`
  need — centralizing them avoids the exact kind of accidental divergence
  [Research.md](Research.md) warns about).
- `ChecklistItem`, `DayChecklist`, `FocusPanel`, `SectionRunThroughPanel`,
  and `ReassessPanel` — all consumed only by `TodayTab` — live under
  `components/tabs/today/` rather than flat in `components/tabs/`, to keep
  that cluster visually grouped. `RandomStartPanel` (consumed only by
  `RevivalTab`) got the same treatment under `components/tabs/revival/`.
- The CSS string stays in `App.jsx` — splitting components into files
  doesn't change that styling is one global stylesheet regardless of where
  the JSX referencing a class name lives (see
  [UX-Principles.md](UX-Principles.md)); moving it to its own
  `src/styles.js` would shrink `App.jsx` further but wasn't done as part of
  this pass.

**Still open**, deliberately not part of this refactor: renaming
practice-chunk `kind: "section"` to something like `"chunk"` — it still
collides in name (not in code, just in a human's head) with
`piece.sections`. See
[Data-Model.md](Data-Model.md#practice-chunks-vs-sections-vs-transitions-vs-combos-vs-run-throughs)
and [Roadmap.md](Roadmap.md).
