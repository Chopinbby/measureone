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
├── test/                       # `npm test` — node:test, run against the
│                               # real lib/ modules via a small loader hook
│                               # (extensionless-loader.mjs) that lets Node
│                               # resolve lib/'s extensionless imports.
│                               # LIB-LEVEL ONLY: there is no harness for
│                               # rendering components, so nothing under
│                               # components/ is covered. Logic that needs
│                               # protecting belongs in lib/ — that's why
│                               # lib/history.js exists (Pass 20).
└── src/
    ├── main.jsx                 # ReactDOM entry point, just mounts <App />
    ├── App.jsx                  # state + layout only — ~1,950 lines; renders
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
    │   │                                # OverviewTab — see Repertoire-Lifecycle.md#revival-auto-triggers).
    │   │                                # Also isInRevival(piece) — the single source of
    │   │                                # truth for "is this piece in revival", reading
    │   │                                # revival.active. EVERY boolean revival gate in
    │   │                                # the app routes through it (App.jsx, OverviewTab,
    │   │                                # TodayTab, MasterAgendaTab, computeDueReviews,
    │   │                                # storage.js's mergeImportedPiece); the rule used
    │   │                                # to be written twice against two different
    │   │                                # fields — see Decisions.md#revival
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
    │   │                                  # Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built.
    │   │                                  # Pass 26 follow-up: a real fail resets
    │   │                                  # practiceBPM to the recorded per-stage entry
    │   │                                  # tempo (stabilizingEntryBPM/settlingEntryBPM/
    │   │                                  # holdingEntryBPM, also threaded through
    │   │                                  # chunkLadderState) for whichever stage it
    │   │                                  # demotes into, instead of a flat step — see
    │   │                                  # Decisions.md#spaced-repetition--maintenance
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
    │   ├── history.js                    # computePracticeHistory (Pass 20) —
    │   │                                  # turns persisted progress keys back
    │   │                                  # into readable day-by-day labels for
    │   │                                  # ProgressTab's "Recent practice
    │   │                                  # history". Lives in lib/ because it
    │   │                                  # absorbs a real mismatch, not just
    │   │                                  # formatting: piece.progress is
    │   │                                  # PERSISTED and keyed by chunk id,
    │   │                                  # while the chunk set is RE-DERIVED
    │   │                                  # every render, so the two can
    │   │                                  # disagree — see
    │   │                                  # Algorithms.md#practice-history-labels
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
        │       RecordingsEditor.jsx, RecordingsList.jsx,
        │       DocumentsEditor.jsx, DocumentsList.jsx
        └── tabs/
            ├── OverviewTab.jsx, TimelineTab.jsx, PieceMapTab.jsx,
            │   ProgressTab.jsx, SettingsTab.jsx,
            │   MasterAgendaTab.jsx, AllPiecesTab.jsx (Pass 42)
            ├── TodayTab.jsx
            │   └── today/  ChecklistItem.jsx, DayChecklist.jsx,
            │                FocusPanel.jsx, SectionRunThroughPanel.jsx,
            │                ReassessPanel.jsx, WeekView.jsx,
            │                InterleavePanel.jsx (Pass 29)
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
| `BasicsFields`, `SectionsEditor`, `DifficultyEditor`, `RecurringEditor`, `ScheduleFields`, `BpmZonesEditor`, `RecordingsEditor`, `DocumentsEditor` | Shared field-editor components, used in both `Wizard` and Settings — see [Product-Principles.md](Product-Principles.md#shared-editors-not-divergent-flows). Add new piece-level fields to one of these rather than duplicating markup. Target tempo lives in `BasicsFields`, not `ScheduleFields`, despite being schedule-adjacent — see the Product-Principles entry for why (it and the other Wizard-first-step extras don't gate plan generation, so they're grouped for convenience rather than by strict topical fit). Tempo zones, recordings, and documents are rendered directly in `Wizard.jsx`'s first step (not folded into `BasicsFields` itself), specifically so they don't also appear a second time in Settings' "Piece" panel — Settings keeps its own separate "Tempo zones"/"Recordings"/"Documents" panels for post-setup editing, unchanged. `BasicsFields` owns the "single piece / multiple movements" toggle as local state; an optional `onMultiPartChange` callback prop mirrors it up to whichever parent needs to see it — both `Wizard` and `SettingsTab` use this to block advancing/saving whenever the toggle is on and the work title is blank, see [Decisions.md](Decisions.md#multi-movement-works). |
| `RecordingsList`, `DocumentsList` | Render `piece.recordings` / `piece.documents` as clickable links; used on the Piece Overview dashboard and in Settings' read-only Piece Details. Identical component shape ({id, label, url}, filter-then-map, no empty-state placeholder) — `DocumentsList` differs only in icon (`FileText` vs `ExternalLink`), kept as a separate small component rather than a shared one with a prop-driven icon since the two are simple enough that the duplication costs less than the indirection would. |
| `PartSwitcher` | Strip of sibling movements on the Overview of any piece belonging to a multi-movement work, plus "Add a movement". Shows each movement's own measures-touched percentage — deliberately not a combined work total, see [Decisions.md](Decisions.md#multi-movement-works). Does **not** render a work-title heading of its own — the hero card's eyebrow directly above already names the work; a `workName` prop and an `<h3>` heading here were removed to stop showing that title twice on the same screen. |
| `Wizard` | Multi-step modal for creating a new piece (create-only — see [User-Flows.md](User-Flows.md#1-setting-up-a-new-piece)). |
| `ScheduleBanner` | The "N chunks behind schedule" banner (Overview, Today). |
| `OverviewTab` | The dashboard / landing screen. Renders `ScheduleBanner`, plus — since Pass 7 — a revival-suggestion banner driven by `computeRevivalTriggers(piece, chunkSet)` (`lib/revival.js`) whenever any of Revival's three auto-trigger conditions fire and no revival is already active; lists every reason that independently fired, not just the first. Takes `chunkSet`/`timeline` as props (passed down from `App.jsx` alongside `piece`, the same values every other tab already receives) — no longer just for the revival check: also `isPlanActuallyComplete` (gates the "Continue learning"/"Continue maintenance" button, same session as Pass 43/45), `computeScheduleStatus` (today's-row "behind N chunks" note), and `classifyDayCompletion` (graying/strikethrough on the "first week" list). See [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#revival-auto-triggers) and [Decisions.md](Decisions.md#ux). |
| `TimelineTab` | Full day-by-day schedule, grouped by week; day cards jump to that day in Today. |
| `PieceMapTab` | Grid of every chunk colored by confidence. Clicking a tile opens a **modal** (not inline — see [UX-Principles.md](UX-Principles.md#detail-on-demand-uses-a-real-modal-not-inline-expansion)) with BPM inputs, manual-confidence override, a run-through flag toggle (untouched/rough/lost — replaces the old boolean weak-spot toggle as of Pass 6, see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)), and a memory-anchor field. **Since Pass 11**, a flagged-for-relearning chunk also shows a small icon on its grid cell plus a "Needs reinforcement" ladder-status row in the modal, with a "Clear, resume review" button (`onClearRelearning` prop) — the manual half of `needsRelearning`'s dual exit, see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built). That prop defaults to a no-op, same defensive pattern `onSetFlag`/`onSetMemoryAnchor` already use — `RevivalTab`'s embedded usage below doesn't pass it, so the button renders but does nothing there; flagged as a known gap, not a deliberate design choice. Also used embedded (with `hideHeader`/`sequentialMode`/`initialSelectedId`/`onFinishSequential`) by `RevivalTab` for the fast reassessment pass — see [Algorithms.md](Algorithms.md#revival) — rather than a second grid component. |
| `MemoryAnchorField` | Small commit-on-blur textarea, same decouple-from-render pattern as `NumberInput`, for `piece.memoryAnchors`, labeled "Notes" in the UI (was "Memory anchor" before Pass 23). Used in the Piece Map modal, and **since Pass 23** inline in `ChecklistItem` during ordinary learning-phase logging — same component, two entry points. The label is a plain "Notes" everywhere now — the `optional` prop (added in Pass 37 as a narrow, one-call-site-only exception so PieceMapTab's `sequentialMode` rendering could drop the word "optional" without touching the label anywhere else this component is used) is gone; "— optional" no longer renders anywhere. |
| `ChecklistItem` / `DayChecklist` | The practice-logging UI for a regular chunk: timer, reps/BPM inputs, a "needs more work" fail override, checkbox that submits directly (`submitLog()`). Reps/BPM are auto-classified into a pass/soft-miss/fail outcome — see [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder) — not a free-standing effectiveness rating; the outcome's *display* label ("Full pass"/"Partial pass"/"Needs rework" as of Pass 26 — the internal values are still `pass`/`soft-miss`/`fail`) comes from `SESSION_OUTCOME_META` (`lib/constants.js`), not hardcoded here. **Since Pass 26**, the card also states its actual requirement before logging — "Need N clean reps at M+ BPM to progress this chunk," reusing the same `requiredReps`/`practiceBPM` values the classification itself judges against — and `submitLog` shows a `window.confirm` checkpoint (not a hard block) before saving an attempt that falls short: on reps (some but not all required, not zero), or on tempo alone with reps otherwise met. Both skip the checkpoint when the "needs more work" checkbox is already checked, since that's already an explicit fail declaration. Stays visible (relabeled "Log another attempt") even once something's logged for the day, so a same-day re-attempt is reachable, not just supported by the data model. On a chunk's first-ever encounter (no session logged, no `practiceBPM` yet), the BPM field's placeholder shows `getSuggestedStartingBPM`'s recommendation and a one-line note invites the learner to pick their own tempo instead — gone once a real session exists. **Since Pass 11**, `ChecklistItem` also resolves `getSuggestedStartingBPM` unconditionally on every render (not just first encounter) and passes it through `sessionInput.suggestedStartingBPM` on every `onLogSession` call — `handleLogSession` (`App.jsx`) needs this value to reset `practiceBPM` the moment a chunk gets flagged for re-learning, which can happen well past its first session; see [Algorithms.md](Algorithms.md#starting-suggested-and-demonstrated-tempo). The undo control's label/tooltip differ depending on whether undo will fully reverse the session (stage/tempo/schedule) or only remove the log record — computed client-side from the same latest-session-plus-snapshot check `handleUnlogSession` uses, so the copy never promises more than it'll do; see [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder). `ChecklistItem` accepts an optional `tempoLadder` prop (rendered as an extra tip line when present) — used by revival plan items only. **Since Pass 23, the notes line works differently and is no longer revival-only:** `ChecklistItem` reads a chunk's note straight off `piece.memoryAnchors` unconditionally (the `memoryAnchor` prop, still passed by `RevivalTab`, is an override that resolves to the same string, not a second source of truth), so notes now show up read-only everywhere a chunk renders — including the maintenance due-review panel, which never showed them before this. Editing (a "+ Add a note" / "Edit note" inline `MemoryAnchorField`, labeled "Notes" in the UI) is offered only where an `onSetMemoryAnchor` handler is actually passed in — currently just `DayChecklist`, i.e. ordinary learning-phase logging. See [Decisions.md](Decisions.md#ux) for why the read went universal while the edit control didn't. **On a consolidation day, `DayChecklist` renders a distinct internal `ConsolidationPanel` instead of a list of `ChecklistItem`s** — a stop-count input (Log/Undo, same append-and-remove-most-recent-record shape as regular logging, but no ladder state to fully reverse) rather than reps/BPM, since there's no new material to grade (Pass 6, see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)). The practice timer's per-second tick is display-only; `submitLog` computes the actual `durationSeconds` it saves from a wall-clock timestamp captured at the moment "Log practice" is clicked (`timerStartRef`), not from whatever the last tick happened to leave the displayed value at — the tick alone could undercount by up to a second, more if a `window.confirm` shortfall dialog delayed the save. |
| `FocusPanel` | Ranks everything touched so far by confidence, independent of today's schedule. |
| `SectionRunThroughPanel` | Surfaces unlocked section run-throughs/combined run-throughs — see [Algorithms.md](Algorithms.md#section-run-throughs). |
| `ReassessPanel` | Re-rate difficulty for a measure range; Apply commits and closes in one action. |
| `TodayTab` | Composes `ScheduleBanner`, `FocusPanel`, `DayChecklist` (or all days in "View all" mode), `SectionRunThroughPanel`, `ReassessPanel`. **Since Pass 8 it has a second day-view branch**: once the piece has run past the end of its bounded plan, the "Day N of N" header becomes "Plan complete — maintenance, day N" and `DayChecklist` is replaced by an internal `DueReviewPanel` listing `computeDueReviews(...)` output. Prev/next day nav is disabled in that state (no bounded grid left to page through); "View all" still shows the whole original plan, so the plan stays reachable. Due items render through the same `ChecklistItem` the plan uses, keyed to the elapsed day number, so logging, undo and the ladder advance are the one code path either way. **Since Pass 22, a third view mode ("Week", between "Day view" and "View all") renders `WeekView`** instead of `DayChecklist`/`DueReviewPanel` — see that component's own row below. **Since Pass 29, a fourth mode ("Interleaved") renders `InterleavePanel`** — disabled with an inline reason when nothing on today's list has graduated past Stabilizing, rather than switching into an empty rotation; see that component's own row below. |
| `WeekView` | Pass 22. Read-only 7-day-card view for `TodayTab`'s "Week" mode — see [Decisions.md](Decisions.md#ux) for why it never logs (a session logged from a non-today cell would be keyed to the wrong day). Inside a bounded plan, the window slides to keep the current day centered (clamped at both ends) rather than paging fixed week blocks like `TimelineTab` does; each card is a link into `TodayTab`'s Day view for that day. Past the plan, it falls back to 7 calendar days around today, of which only today's cell can carry content (`computeDueReviews` has no forward-looking form) — the days ahead read "Not due yet" rather than sitting blank. |
| `InterleavePanel` | Pass 29. `TodayTab`'s fourth view mode ("Interleaved") — rotates through chunks past Stabilizing on a mode-level timer (mirrors `ChecklistItem`'s own per-chunk timer pattern), reusing the same rep/BPM inputs and `onLogSession` call the regular checklist uses. Adds "Skip, just save time" and, when an auto-classified soft-miss/fail lands mid-rotation, saves it **provisionally** rather than committing it — see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29). Leaving this mode with an unresolved provisional is gated by `App.jsx`'s `guardLeavingInterleaved`, reported up via `onInterleaveRiskChange` since `TodayTab` is the only thing that knows whether this panel is actually on screen. |
| `RevivalEntryModal` | Collects `lastPlayedDate`, optional `performanceTempo`, and required `purpose` before a revival cycle starts. Styled like `Wizard`'s modal shell. |
| `DeletePieceModal` | Confirms permanent deletion by requiring the piece's exact name to be typed back, rather than a single `window.confirm()` — deletion has no undo and takes all practice history with it. |
| `ExportPiecesModal` / `ImportPiecesModal` / `PieceCheckRow` | Per-piece export/import picker — lets the user choose which pieces to include rather than an all-or-nothing backup file. `PieceCheckRow` is the shared checkbox-row list item both modals render. **Since Pass 13**, `ImportPiecesModal` also shows a small "keep what's here" / "use the imported version" chooser under any matched piece whose practice-ladder progress genuinely conflicts with what's already saved (`diffImportedPiece`, [Algorithms.md](Algorithms.md#import-merge)) — most matches never show it, since an updatedAt-based recency check already resolves the common cases automatically. |
| `RandomStartPanel` | Picks a uniformly random item from a pool and displays it (plus its memory anchor/note, if any) so a review session doesn't always start from the same place. Originally revival-only; **since Pass 21** also used by `MasterAgendaTab`'s Maintenance-due subtab, on the same "don't let yourself choose the starting point" reasoning. Two ways to supply the pool: a ready-made cross-piece list (built via the exported `chunkEntry` helper, so labels can't drift between callers — used by `MasterAgendaTab`, which needs to name each pick's piece since its pool spans several), or the original single-piece chunk/transition/section props, which `RevivalTab` still passes unchanged (sections stay in the pool only in this single-piece form). |
| `RevivalTab` | Composes the revival flow end to end: settings (performance tempo, tempo ladder start fraction), the embedded `PieceMapTab` reassessment pass, flagged-chunks summary (rough/lost, same field the Piece Map's run-through flag sets — see [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#post-run-through-logging)), `RandomStartPanel`, and the generated plan (day-grouped `ChecklistItem`s with tempo ladders/memory anchors). See [Algorithms.md](Algorithms.md#revival). |
| `ProgressTab` | Trend/diagnosis charts, in render order: rolling-window consistency + most-improved stat cards, consistency heatmap, actual-vs-planned, projected finish, tempo trend, outcome breakdown, **confidence by difficulty**, **recurring material payoff**, recent practice history. The last two were folded in from the former `AnalyticsTab` in **Pass 20**, which removed that tab entirely (file deleted, `analytics` entry gone from `NAV_BASE`) — the panels were relocated verbatim, not redesigned. Their placement is pinned down rather than incidental; see [Decisions.md](Decisions.md#ux). The `.analytics-*` CSS classes survive the rename and are **not** Analytics-specific — Progress's outcome bars always shared them. Recent practice history's labels come from `computePracticeHistory` (`lib/history.js`), not from logic inline here. **Since Pass 42**, a "View all pieces" button in the header links to `AllPiecesTab`. |
| `AllPiecesTab` (Pass 42) | Cross-piece summary: a "Practiced this week" stat, a piece count, a 14-day cross-piece consistency heatmap, and one row per piece in `pieces` — progress % (`computeProgressTier`, same measure-tier math `OverviewTab` uses for "Measures learned"), confidence % (`computeConfidence`, same averaging `OverviewTab` uses for "Total progress"), days since last touched (`piece.lastLoggedAt`), and time practiced *this week* (`sumPracticeSecondsSince`, Monday through today via `startOfWeekISO` — both `lib/utils.js`, Pass 42 follow-up). A "Back to {current piece}" button in the header reuses the same `onSelectPiece` (`switchToPiece`) call the rows use, just passed the currently-open piece's id instead of a row's. Clicking a row lands on that piece's Overview. Not in `NAV_BASE` — reached only via `ProgressTab`'s button, the same "button-triggered `activeTab`, no permanent nav entry" shape `revival` already uses (see the `MasterAgendaTab`/`RevivalTab` rows above and [Decisions.md](Decisions.md#revival)). Confidence is computed off `elapsedDay(piece)` (unclamped real calendar days), not the timeline-clamped `getCurrentDay` `OverviewTab`/`MasterAgendaTab` use for the piece currently open — see [Decisions.md](Decisions.md#cross-piece-views) for why. The consistency heatmap (`computeCrossPieceConsistency`, `lib/utils.js`) reads each session's `loggedDate` directly rather than `ProgressTab`'s plan-relative day numbers, so pieces with different start dates share one calendar axis; "touched" excludes skipped/provisional sessions via the existing `loggedSessions()`, the same rule `ProgressTab`'s own heatmap uses. |
| `MasterAgendaTab` | Cross-piece daily view — aggregates every *active* piece's scheduled tasks for a selected date (date-navigable, not locked to today) into one list, so a multi-piece user isn't switching between pieces to see the whole day. **First item in the sidebar as of Pass 18.** For a piece still inside its plan it reads `getEffectiveTimeline(...).days[dayNumber - 1]` directly, the same fixed-length, `daysToLearn`-bounded indexing `TodayTab` uses. **Since Pass 8, a piece that has run past its plan no longer falls out of that indexing** — it renders a due-maintenance summary from `computeDueReviews` (`lib/maintenance.js`) instead: merged measure ranges under a "Due" tag, plus a count. That branch only ever fires for the real today, since due-ness is strictly "as of today" and the date picker must not become a forward-looking window. **Since Pass 19 the content is split across three subtabs** — Learning phase / Maintenance due / Revival — with counts in the labels. The first two are a pure presentation split of the same `agendaData.items` array, partitioned on the `isDueList` flag that already distinguished the two card shapes; no new computation, and the combined count is unchanged. The Revival subtab is *not* such a split: pieces in revival are skipped when building the other two lists (`isInRevival`), so each piece appears in exactly one subtab, and revival cards are built from a separate derivation — status (reassessment in progress / plan ready) plus the **highest-priority items** as merged measure ranges under a "Start here" tag. Not "today's work": a revival plan is priority-ordered, not dated. Uses `piece.revival.plan` when one exists (so it agrees with `RevivalTab`) and falls back to a live `computeRevivalPlan` call mid-reassessment. Revival cards deliberately carry no time estimate and contribute nothing to the "Total planned" banner. The selected subtab persists across tab switches via a module-level variable (not state, not `localStorage`) — a fresh page load starts on Learning phase. See [Decisions.md](Decisions.md#revival). **Since Pass 21, three more controls, all gated to the real today (the date picker must not turn these into a forward-looking action):** a "Reschedule all" panel on the Learning-phase subtab, shown whenever `planRescheduleForPieces` finds any behind-schedule pieces, applying the bulk reschedule described in [Algorithms.md](Algorithms.md#rescheduling); a "Pick a random piece to practice" button (offered once two or more pieces have real work today) that switches the active piece; and a `RandomStartPanel` on the Maintenance-due subtab, pooling every due spot across every piece so a review session doesn't always start at the top of the same list — see [Decisions.md](Decisions.md#scheduling) for all three. |
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
  `setPieces` directly**, for any change to the active piece. Persistence
  itself, though, is **not** scoped to just the active piece: the
  auto-save `useEffect` writes every entry in `pieces` to `localStorage`
  whenever that object changes (**Pass 29 follow-up** — it used to persist
  only `pieces[activePieceId]`, which silently lost a discard applied to a
  *different* piece than the one a handler switched to in the same event —
  see [Decisions.md](Decisions.md#spaced-repetition--maintenance)). If you
  add a handler that mutates a piece other than the currently active one,
  it's already covered — nothing extra to remember at the call site.
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
- `interleaveRisk` (**Pass 29 follow-up**) — `{ chunkIds, day } | null`,
  reported up from `TodayTab` (via `onInterleaveRiskChange`) whenever
  Interleaved mode is actively showing an unconfirmed provisional session.
  `App.jsx` reads it to gate every place it owns that can navigate away
  (sidebar nav, the piece switcher, "Edit piece," finishing the "Add new
  piece" wizard) through one shared function,
  `confirmAndDiscardProvisional`/`guardLeavingInterleaved` — see
  [Decisions.md](Decisions.md#spaced-repetition--maintenance).
- `storageError` (a failed `localStorage` write) and `exportReminderDue` /
  `exportReminderDismissed` (**Pass 12** — a day-plus since the last export,
  or since first use if never exported; `isExportReminderDue`,
  `lib/storage.js`) each drive their own dismissible banner above the main
  content. `exportReminderDismissed` is plain in-memory state, not
  persisted — a reload always re-shows a still-due reminder, so dismissing
  it is per-session, not a permanent "don't ask again."
- `navItems` — `NAV_BASE` with `REVIVAL_NAV_ITEM` spliced in (before
  Progress) only while `isInRevival(piece)` (`lib/revival.js`); the sidebar
  renders this instead of `NAV_BASE` directly. The splice finds its
  insertion point by `key` lookup, not by index, so reordering `NAV_BASE`
  needs no change here — which is why **Pass 18**'s reorder (Master Agenda
  moved to first) touched only the array itself. That pass also renamed the
  `overview` entry's visible label to **"Piece Overview"**; its key and
  route stay `"overview"`, so every `setActiveTab("overview")` call site is
  unaffected.
- Backup: `handleExportClick` opens `ExportPiecesModal` (pick which pieces
  to include, then `downloadBackup` on that subset — not an all-or-nothing
  export); `handleConfirmExport` also records `saveLastExportedAt(Date.now())`
  (**Pass 12**), which is what clears the export-reminder banner above and
  resets its day-plus timer. `handleImportClick`/`handleImportFile` open
  `ImportPiecesModal`, and `handleConfirmImport` restores the selected
  pieces, matching by id or by name+composer so re-importing a backup
  updates an existing piece instead of duplicating it. **Since Pass 13**,
  it also re-derives each matched piece's ladder-state diff at confirm time
  and threads the resolved side (automatic, or the user's pick from the
  modal's divergence chooser) into `mergeImportedPiece`'s `ladderChoice`
  parameter — see [Algorithms.md](Algorithms.md#import-merge).

`chunkSet` and `timeline` are `useMemo`'d off `piece` — pure derivations,
never stored in `piece` itself. Schedule-related state that must persist
(like the reschedule marker) goes on `piece` as input data, and the
derivation recomputes from it on every render where `piece` changed.

- **Pass 39**: one more `useEffect`, scoped to the active piece only —
  watches `[loaded, piece, chunkSet, timeline, settingsEditing]` and, for a
  `scheduleMode: "minutes"` piece past its own day count but not yet
  learned, calls `updatePiece` with `computeMinutesModeAutoExtend`'s patch
  (`lib/scheduling.js`). Self-limiting by construction: applying the patch
  always grows `daysToLearn` past the piece's real elapsed day, so the next
  run of the same effect finds nothing left to do. Skipped while
  `settingsEditing` is true, so it can't write underneath an in-progress
  Settings edit. See [Algorithms.md](Algorithms.md#detecting-that-a-piece-has-run-past-its-plan).

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
  `ReassessPanel`, and (since Pass 22) `WeekView` — all consumed only by
  `TodayTab` — live under `components/tabs/today/` rather than flat in
  `components/tabs/`, to keep that cluster visually grouped.
  `RandomStartPanel` (consumed only by `RevivalTab`, though **since Pass
  21** `MasterAgendaTab` also imports it directly for the Maintenance-due
  tab's random-start pool) got the same treatment under
  `components/tabs/revival/` — the directory name now describes its
  origin, not its only consumer.
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
