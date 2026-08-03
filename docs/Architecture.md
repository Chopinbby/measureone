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
    ├── App.jsx                  # state + layout only — ~900 lines; renders
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
    │   ├── confidence.js              # computeConfidence and friends
    │   ├── revival.js                  # computeRevivalPlan and friends
    │   └── storage.js                   # localStorage load/save/export/import
    └── components/
        ├── NumberInput.jsx, MemoryAnchorField.jsx, Manuscript.jsx,
        │   ScheduleBanner.jsx, Sparkline.jsx    # small standalone pieces
        ├── Wizard.jsx                            # create-only piece setup
        ├── RevivalEntryModal.jsx
        ├── fields/                                # editors shared by
        │   │                                       # Wizard and SettingsTab
        │   └── BasicsFields.jsx, SectionsEditor.jsx, DifficultyEditor.jsx,
        │       RecurringEditor.jsx, ScheduleFields.jsx, BpmZonesEditor.jsx,
        │       RecordingsEditor.jsx, RecordingsList.jsx
        └── tabs/
            ├── OverviewTab.jsx, TimelineTab.jsx, PieceMapTab.jsx,
            │   ProgressTab.jsx, AnalyticsTab.jsx, SettingsTab.jsx
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
| `Wizard` | Multi-step modal for creating a new piece (create-only — see [User-Flows.md](User-Flows.md#1-setting-up-a-new-piece)). |
| `ScheduleBanner` | The "N chunks behind schedule" banner (Overview, Today). |
| `OverviewTab` | The dashboard / landing screen. |
| `TimelineTab` | Full day-by-day schedule, grouped by week; day cards jump to that day in Today. |
| `PieceMapTab` | Grid of every chunk colored by confidence. Clicking a tile opens a **modal** (not inline — see [UX-Principles.md](UX-Principles.md#detail-on-demand-uses-a-real-modal-not-inline-expansion)) with BPM inputs, manual-confidence override, a weak-spot toggle, and a memory-anchor field. Also used embedded (with `hideHeader`/`sequentialMode`/`initialSelectedId`/`onFinishSequential`) by `RevivalTab` for the fast reassessment pass — see [Algorithms.md](Algorithms.md#revival) — rather than a second grid component. |
| `MemoryAnchorField` | Small commit-on-blur textarea, same decouple-from-render pattern as `NumberInput`, for the modal's memory-anchor field. |
| `ChecklistItem` / `DayChecklist` | The practice-logging UI: timer, reps/BPM/effectiveness inputs, checkbox that submits directly (`submitLog()`). `ChecklistItem` also accepts optional `tempoLadder`/`memoryAnchor` props (rendered as extra tip lines when present) — used by revival plan items, absent everywhere else. |
| `FocusPanel` | Ranks everything touched so far by confidence, independent of today's schedule. |
| `SectionRunThroughPanel` | Surfaces unlocked section run-throughs/combined run-throughs — see [Algorithms.md](Algorithms.md#section-run-throughs). |
| `ReassessPanel` | Re-rate difficulty for a measure range; Apply commits and closes in one action. |
| `TodayTab` | Composes `ScheduleBanner`, `FocusPanel`, `DayChecklist` (or all days in "View all" mode), `SectionRunThroughPanel`, `ReassessPanel`. |
| `RevivalEntryModal` | Collects `lastPlayedDate`, optional `performanceTempo`, and required `purpose` before a revival cycle starts. Styled like `Wizard`'s modal shell. |
| `RandomStartPanel` | Revival-only: picks a uniformly random chunk, transition, or section and displays it (plus its memory anchor, if any) for a cold-start warm-up. |
| `RevivalTab` | Composes the revival flow end to end: settings (performance tempo, tempo ladder start fraction), the embedded `PieceMapTab` reassessment pass, flagged-weak-spot summary, `RandomStartPanel`, and the generated plan (day-grouped `ChecklistItem`s with tempo ladders/memory anchors). See [Algorithms.md](Algorithms.md#revival). |
| `ProgressTab` | Trend/diagnosis charts — rolling-window consistency, heatmap, actual-vs-planned, projected finish, tempo trend, effectiveness calibration, recent history. |
| `AnalyticsTab` | Confidence-by-difficulty, recurring-material payoff. **Slated to be folded into `ProgressTab` and removed** — not yet done; see [Roadmap.md](Roadmap.md). Check the sidebar `NAV` array for current truth before assuming either state. |
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
  `piece.createdAt` vs. `Date.now()`.
- `wizardOpen`, `switcherOpen`, `settingsEditing`, `activeTab`, `loaded`,
  `revivalModalOpen` — straightforward UI state.
- `navItems` — `NAV_BASE` with `REVIVAL_NAV_ITEM` spliced in (before
  Progress) only while `piece.revival.active` is true; the sidebar renders
  this instead of `NAV_BASE` directly.
- Backup: `handleExportAll` downloads every piece as one JSON file;
  `handleImportClick`/`handleImportFile` restore from one.

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
