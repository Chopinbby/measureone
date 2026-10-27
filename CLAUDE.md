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
implementation fact. **It is rules and orientation, not a changelog:** what each
pass added is one line each in "What each pass added" at the end, and the full
story is in `docs/` and `git log`. (It was compacted on 2026-10-16 from a
2,500-line pass-by-pass log. If a rule or a detail you expected is missing, the old
text is `git show 209d77a:CLAUDE.md`; check there and in `docs/` before assuming it
never existed.)

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
- No backend of our own. The working copy is always client-side `localStorage`.
  An optional, invitation-only account sign-in (Supabase) exists on sites
  connected to an account service (the live site too, since Pass 114): signed in,
  this browser's pieces and technique library are copied to the account and kept
  current, can be restored or brought back with "Get changes", and the app notices
  when another device changed something. **Changes from other devices arrive by
  themselves only if the person turns on a switch that is OFF by default (Pass 120);**
  otherwise they are noticed and "Get changes" is the way in. See "Accounts, sync
  and deploys" below.
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
├── DEPLOYMENT.md      # Vercel setup, the live site's settings, rolling back
├── scripts/           # check-rls.mjs: the account security check (Pass 114);
│                      # not part of the app or of `npm test`
├── supabase/migrations/   # the account database's two SQL files; applied by
│                          # hand in the Supabase SQL Editor, never by the app
├── test/              # `npm test`: node:test over lib/ only
└── src/
    ├── main.jsx        # ReactDOM entry point, just mounts <App />
    ├── App.jsx         # state + layout only — owns updatePiece and every
    │                   # handler, renders the sidebar + active tab
    ├── lib/            # pure functions: chunking, scheduling, confidence,
    │                   # revival, storage, technique, shared constants/utils,
    │                   # and the account code (backend.js, accountSync.js,
    │                   # pieceMerge.js, techniqueMerge.js, tabSync.js, settleFlow.js,
    │                   # recentlyDeleted.js) — no JSX
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
  mid-keystroke. Its optional `onDraftChange` and `acceptPlaceholderOnTab`
  props are described in [`docs/Architecture.md`](docs/Architecture.md#main-ui-components).
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
    `isPlanActuallyComplete(piece, chunkSet, timeline)` (`lib/scheduling.js`),
    never a raw `elapsedDay(piece) > timeline.days.length` comparison. A
    `scheduleMode: "days"` piece whose target date passed with real work still
    outstanding is *behind*, not *done*; a new call site that reaches for the raw
    comparison brings this regression back. See
    [`docs/Algorithms.md`](docs/Algorithms.md#detecting-that-a-piece-has-run-past-its-plan).
  - **Rescheduling a piece more than once must chain through its whole
    reschedule history (Pass 48 follow-up).** `getEffectiveTimeline`
    (`lib/scheduling.js`) recurses through each `rescheduleMarker`'s `previous`
    link to compute what came before the *current* marker's `asOfDay`, rather than
    always calling `computeTimeline` fresh; without that, a second reschedule
    silently discards what the first placed for the days in between, including a
    session genuinely logged there. Every place that constructs a new marker
    (`App.jsx`'s `handleReschedule`; `planRescheduleForPieces` and
    `computeMinutesModeAutoExtend`, both `lib/scheduling.js`) must set
    `previous: piece.rescheduleMarker || null`, or this regression comes back for
    that path. A piece rescheduled twice before this fix has no `previous` link to
    recover; it corrects itself on its next reschedule. See
    [`docs/Algorithms.md`](docs/Algorithms.md#rescheduling) and
    [`docs/Decisions.md`](docs/Decisions.md#scheduling).
  - **Introduction placement must be fully settled (including Pass 90's
    load-smoothing) before transitions/combos/reviews compute anything from
    `introducedDay` (Pass 90).** `computeTimeline`'s Phase A.5 (introduction-only
    smoothing, scoped to `frontDays`) runs immediately after chunks are placed and
    *before* the `transitions.forEach`/`combos.forEach` loops, never after: if a
    chunk's introduction day could still change once those loops have read it, a
    transition/combo ends up anchored to a day its dependency has since moved away
    from. See [`docs/Algorithms.md`](docs/Algorithms.md#timeline--scheduler) rule 1
    and [`docs/Decisions.md`](docs/Decisions.md#scheduling).
  - **The daily-workload smoothing pass (`smoothOverloadedDays`, rule 5) must
    never move a Tier 1 item, in either of its two call sites (Pass 90).** Tier 1
    is where schedule pressure deliberately never gets absorbed; a movable-items
    pool that includes Tier 1 by accident would silently reintroduce what that
    design rejected. See [`docs/Algorithms.md`](docs/Algorithms.md#timeline--scheduler).
  - **`sortPracticeChunksForIntroduction`'s hard-chunk-neighbor check matches by
    measure boundary (`prev.end + 1 === c.start`), never by raw array index
    (Pass 89).** Array-index adjacency is only right for the pristine, gapless list
    `generateAllChunks` produces; a rescheduled remainder
    (`getEffectiveTimeline`'s `subChunkSet.practiceChunks`) is a *filtered*
    subsequence with gaps, and index adjacency there calls two chunks neighbors
    because whatever sat between them is gone. A real, reproduced bug. Keep the
    boundary-based match. See
    [`docs/AI-GUIDELINES.md`](docs/AI-GUIDELINES.md#position-based-logic-is-only-correct-for-the-caller-whose-list-it-was-written-against)
    for the general lesson and [`docs/Decisions.md`](docs/Decisions.md#scheduling).
  - **`reassociateTroubleSpots` (`lib/chunking.js`) matches a focus spot to its
    chunk by measure position (`startMeasure`), never by trusting the chunk id it's
    nested under (Pass 91).** The same lesson as the bullet above: chunk ids are
    `c${start}`, so a chunking-scheme edit (`customChunkSize` 8 → 4) can produce an
    id that still exists but now covers different measures (a "c9" meaning 9–16,
    then 9–12), and an id-existence check reads that as continuity.
    `migrateOrphanedProgress` reattaches whole entries by best overlap; this function
    catches what that one can't. Keep the measure-position check — simplifying it to
    "does this id still exist" silently reintroduces the spot-orphaning bug it was
    built to fix. See [`docs/Algorithms.md`](docs/Algorithms.md#focus-spots-v1).
- **`Wizard` is create-only.** Editing an existing piece always goes through
  `SettingsTab`, never the wizard.
- **Piece Map chunk detail is a modal, not inline** — this was a deliberate
  UX fix (inline rendering was invisible below the fold); don't revert it.
- **Piece Map's grid shows only base practice chunks — this is deliberate,
  not a bug to "fix" by restoring transitions/combos to it (Pass 50).** Reach
  those through the chunk-detail modal's "Related chunks" field instead.
  `PieceMapTab` is ordinary (non-revival) Piece Map only: Revival's reassessment
  has its own `ReassessSequencePanel`, so the grid filter is unconditional. A chunk
  split in two is drawn beside its other half inside one dashed box, derived live
  from `piece.chunkSplitPoints` (display only).
- **Section run-throughs must stay a computed-fresh-every-render gate, not
  a persisted "unlocked" flag.** `sectionRunThroughGate` (`lib/chunking.js`)
  recomputes due/locked state from live session counts on every call (Pass 49);
  reintroducing any persisted "has this been unlocked" state would silently bring
  back the exact bug that pass fixed (a run-through that, once available, sat
  available forever, whether or not it still made sense). The count is of
  *confirmed* sessions, i.e. `loggedSessions()`-filtered: a skipped Interleaved
  attempt or an unconfirmed provisional one must not advance the gate
  (`isSectionLearned` still counts raw `sessions.length`, deliberately; the two now
  answer different questions). Neither `sectionRunThroughGate` nor
  `computeSectionRunThroughs` takes a day parameter — both answer "is this due right
  now," not "was this due on day N." The day-scoping lives one layer up (Pass 68):
  `SectionRunThroughPanel` only renders when `isRealToday`, so a browsed past/future
  day never shows (or lets you log against) today's live due-state. Don't try to fix
  a future "wrong day" symptom by adding a day parameter to the two functions — the
  fix belongs at the display layer. See
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
- **`countBehindDays`/`isDayFullySwept`/`classifyDayCompletion` (`lib/scheduling.js`)
  take an optional fourth `chunkById` argument — pass it.** It defaults to `{}` so a
  caller that omits it degrades gracefully instead of crashing, but degrading means
  *silently under-detecting* a reschedule sweep (a connector that rode along via a
  linked practice chunk, rather than being listed directly on the marker, won't be
  recognized as moved) — the same symptom class Pass 74's follow-up fix exists to
  prevent, just reintroduced quietly at whichever call site forgets the argument. Every
  current call site (`ScheduleBanner`, `OverviewTab`, `TimelineTab`, `TodayTab`'s
  catch-up scan, `MasterAgendaTab`'s two sites, `findStuckBehindPieces`) builds
  `chunkById` from whatever chunk set it already has in scope — a new call site should
  do the same rather than relying on the default.
- **A chunk done EARLIER than the rescheduled-remainder day it is placed on isn't
  owed on that day (Pass 117, `classifyDayCompletion`).** Only introductions and
  connectors (never reviews), only on a day at or after the marker's `asOfDay`, only
  for an EARLIER done-day (a later one was late and stays behind, as before), and
  never without a marker. It exists for merged pieces (one device can't reach that
  state); narrowing or widening it fails a `[regression, Pass 117]` test in
  `test/scheduling.test.mjs`. See
  [`docs/Algorithms.md`](docs/Algorithms.md#a-chunk-done-earlier-than-the-remainder-day-its-placed-on-pass-117).
- **A past day is judged only on what's still *owed* on it — tasks a
  reschedule already moved away never count against it.**
  `classifyDayCompletion` drops every id `movedIdsForDay` reports before
  deciding `"done"`/`"behind"` (nothing left → `"empty"`), and
  `countBehindDays` is just "how many days classify as `"behind"`." The bug this
  prevents: a day where some tasks were done on time and the rest were moved by a
  reschedule was neither "fully swept" nor "done," so it read "behind" forever —
  the "N days behind" banner survived every reschedule, and "Reschedule" changed
  nothing. If you add another "is this day behind/done" check, route it through
  `classifyDayCompletion` rather than reading `doneDays` against a day's raw id
  lists, or the same symptom comes back for that surface. See
  [`docs/Algorithms.md`](docs/Algorithms.md#rescheduling) and
  [`docs/Decisions.md`](docs/Decisions.md#scheduling).
- **A key in `piece.progress` may not exist in the chunk set — always
  handle the miss.** `piece.progress` is persisted; the chunk set is
  re-derived. Four kinds of key won't resolve: `__consolidation__`,
  `__cold_start__`, `sr_<sectionId>` section run-throughs (deliberately never in
  `generateAllChunks(...).all`, so this is *routine*, not an edge case),
  and ids orphaned when a piece edit regenerated chunk ids. An unguarded
  `chunkById[id].start` on one of these crashed the whole Progress tab
  (Pass 20). Iterating `timeline.days[]` ids instead is safe by
  construction. The two synthetic keys are listed in `NON_CHUNK_PROGRESS_KEYS`
  (`lib/storage.js`, Pass 56): the ladder-state backfill/diff functions read that one
  list (the first cut checked `__consolidation__` by name in two places and missed
  the other key), and `computePracticeHistory` (`lib/history.js`) indexes
  `__cold_start__` sessions off their own `day` field, because that key deliberately
  carries no `doneDays`. See
  [`docs/Data-Model.md`](docs/Data-Model.md#pieceprogress-keys-are-not-guaranteed-to-exist-in-the-chunk-set).
- **The Cold-Start check logs to `piece.progress["__cold_start__"]`, deliberately not
  into `"__consolidation__"`'s sessions (Pass 56):** `computeRevivalTriggers` reads
  every `"__consolidation__"` session's `stopCount`, and a Cold-Start session has none.
  It unlocks once `coldStartGateMet` (`lib/coldStart.js`) says every section's own
  run-through has been logged. Its prompt (`coldStartDueThreshold`, escalating at 3, 7,
  14, 28, ... days since anything was logged) is a live derivation with no persisted
  "already shown" flag, the same spirit as `sectionRunThroughGate`. See
  [`docs/Algorithms.md`](docs/Algorithms.md#cold-start-check).
- **No regex lookbehind (`(?<=…)`, `(?<!…)`) anywhere in `src/`.** The
  build targets Safari 14, which can't parse it and esbuild can't rewrite
  it — one instance blanks the whole app there, not just one screen.
  `test/browser-compat.test.mjs` fails if it appears (Pass 101).
- **No em dashes (—) in anything the app displays.** Rework the sentence
  with a period, comma, colon, or parentheses instead — see
  [`docs/AI-GUIDELINES.md`](docs/AI-GUIDELINES.md#no-em-dashes-in-user-facing-copy).
  Comments and docs are exempt (and full of them, which is why new copy
  keeps picking them up). `test/copy-style.test.mjs` fails if one appears
  in copy (Pass 80, redone after Pass 104).
- **Technique data is app-level — never `setPieces`/`updatePiece`.** It
  lives in `App.jsx`'s `technique` state and its own localStorage key
  (`measureone-technique`), and every change goes through `updateTechnique` (Pass 100).
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
- **Chunk splitting (Pass 97): three traps.** (1) **Two different
  split-point checks exist and must never be swapped.** `survivingSplitPoints`
  answers the *resize* question ("does the NEW grid already land on this
  measure?") and lives on the Settings-save path via
  `splitPointsAfterStructureEdit`; `validSplitPoints` answers the *load*
  question ("could the app itself have made this on the CURRENT grid?") and
  runs in `validateAndMigratePiece`. A real split is never on the uniform
  grid, so using the resize rule at load time wipes every legitimate split on
  every reload — this exact mistake was made and only a test caught it. (2)
  **The first half keeps the parent's id** (`c${start}` — its start measure
  doesn't move), so only the second half gets a new progress entry, built as a
  spread of the parent's minus `sessions` (stays first-half-only, so time
  isn't double-counted) and `troubleSpots` (re-homed by measure position via
  `reassociateTroubleSpots`). Because it's a spread, a new per-chunk field is
  carried to the second half automatically — no hand-maintained list, unlike
  the three App.jsx session handlers. (3) **`chunkSplitPoints` is not in
  `CHUNK_STRUCTURE_FIELDS`** on purpose (the Settings form never edits it);
  a split keeps `rescheduleMarker` instead of nulling it, patched by
  `insertSplitHalfIntoMarkerChain` — don't "fix" that back to
  `handleSavePiece`'s null-the-marker behavior. The "midpoint" gives the extra
  measure to the SECOND half (5 → 2+3, `Math.floor`); test the odd count.
  See [`docs/Algorithms.md`](docs/Algorithms.md#splitting-a-chunk-pass-97).
- **A review arriving late is schedule slack, never a failure.** Only the logged
  outcome (pass / soft-miss / fail) may ever affect the maintenance ladder, never
  timing. Before touching scheduling, confidence or the practice-logging UI, read
  [`docs/Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built):
  the ladder is live, not a future replacement to design around.
- **Leaving Interleaved mode with an unconfirmed provisional session must go
  through `confirmAndDiscardProvisional` / `guardLeavingInterleaved` (`App.jsx`)**,
  at every place `activeTab` or `activePieceId` can change (two sidebar controls
  were missed on the first pass). A new way to navigate away must route through the
  same function, never an unguarded `setActiveTab`/`setActivePieceId`.
- **Master Agenda's minutes-mode auto-extension is display-only.**
  `computeMinutesModeAutoExtend` is also computed in `MasterAgendaTab` so a
  background piece shows real, current content; nothing is written to storage from
  that. The real write happens only in the `App.jsx` effect, once that piece is
  opened (Pass 39).
- **`AllPiecesTab` confidence uses `elapsedDay` (real, unclamped days), not
  `getCurrentDay`, on purpose (Pass 42):** a neglected piece keeps reading staler
  instead of freezing once it falls off its own plan. See
  [`docs/Decisions.md`](docs/Decisions.md#cross-piece-views) before changing it.
- **`DIFFICULTY_META`'s labels (Workable / Challenging / Difficult) are display
  only (Pass 52).** The `difficultyLabel` enum values (`'easy' | 'medium' | 'hard'`)
  still drive scheduling, confidence and the ladder (`REQUIRED_REPS`, tempo-floor
  lookups): don't rename them to match.
- **`handleStartRevival` (`App.jsx`) hardcodes `purpose: null`** rather than reading
  it from the modal payload (Pass 55): the modal stopped sending that key, and
  reading it would write revival objects with no `purpose` key at all (`undefined`
  doesn't survive `JSON.stringify`). `piece.revival.purpose` stays
  defined-but-always-`null` on the schema, dormant, not removed.
- **`resolveRequiredReps` has two callers, `ChecklistItem` and `InterleavePanel`
  (Pass 61).** Change both, or a chunk's 4th/8th/12th Holding review is judged by a
  different requirement depending on which screen logged it.
- **Review cost is priced the same way in three places, and they must keep
  agreeing (Pass 66):** `computeTimeline`'s `minutesFor` (`chunk.effort *
  EFFORT_TO_MIN`, for reviews as for new chunks), `computeDaysNeededForMinutesPerDay`
  (review padding `c.effort * REVIEW_TOUCHES_PER_ITEM`, which is 2) and
  `computeDueReviews`. Underestimating a hard chunk's review in the estimator risks a
  `scheduleMode: "minutes"` plan not fitting its own daily budget.
- **`mergeLiveDueReviews` (`lib/maintenance.js`) skips consolidation ("full
  run-through") days itself** (`if (day.type === "consolidation") return day;`):
  neither `ConsolidationPanel` nor Master Agenda's card renders `reviewChunkIds` or
  `minutes` for that day type, so merging a review in there would inflate
  `day.minutes` with no line item to explain it. Keep the guard in the function, not
  at the two call sites that rely on it.
- **The "done on another day" check in `isDayFullySwept` must never apply to
  `reviewChunkIds` unless `progress[id].nextDueDate` is set (Pass 75).** A genuine
  Tier 2 review always has one; a Tier 1 "first touch" review (a chunk never logged)
  never does, and checking `doneDays` alone strips every never-touched chunk's
  review. A review whose due date has passed is handled centrally by
  `withLiveReviewStatus` (`lib/scheduling.js`), applied wherever the timeline is
  built, so every screen gets it.
- **Show key names through `KeyText.jsx`** (♯/♭ in a tighter font inside one span, so
  a flex `gap` can't split "E♭" into "E ♭"), and wrap it together with its
  surrounding words when the parent is a flex row with a gap (buttons are) (Pass 101).
- **Technique stays out of every schedule path (Pass 102):** no behind-schedule
  count, `ScheduleBanner`, reschedule dialog or piece-progress code may read it. It
  isn't part of any piece.

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
zones or difficulty reassessment. The three `ladderConfig.holding.tempoFloor*` fields
(retired in Pass 61) are still in the schema and editable in Settings, and do nothing:
a deliberately flagged loose end.

**"This piece is learned" is a live derivation, not a stored state.**
`isPieceLearned(piece, chunkSet)` (`src/lib/ladder.js`, Pass 39) is true when every
practice chunk's ladder `stage` is Holding; nothing is persisted on `piece`. What the
app gates on instead is `isPlanActuallyComplete`: both "Start revival" buttons and all
three of `computeRevivalTriggers`' conditions (`lib/revival.js`) read it (Pass 83), and
`piece.markedLearnedElsewhere` (Settings' "Mark as learned elsewhere") is an
unconditional override it checks first, so setting it unlocks Archive, "Start revival"
and every other `isPlanActuallyComplete`-gated behavior at once, with no per-surface
wiring. See [`docs/Decisions.md`](docs/Decisions.md#revival),
[`docs/Decisions.md`](docs/Decisions.md#open-questions) and
[`docs/Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented).

**Don't confuse `isPieceLearned` with Pass 58's `computeOverallConfidence`**
(`lib/confidence.js`, with its own manual override `piece.manualOverallConfidence`):
that is a continuous, always-moving 0–100 stat built from `computeConfidence`,
deliberately not the same question as `isPieceLearned`'s strict "every chunk at
Holding" boolean, and the two are never read from each other.

## Accounts, sync and deploys: rules for working on them

**What exists.** An optional, invitation-only account (Supabase). Signed in, this
browser's pieces and technique library are copied to the account (the first backup,
Pass 110), every later change goes up by itself (Pass 111), restore / "Get changes" /
Review bring things back (Pass 112), the person can change their password and sign out
of all devices (Pass 113), and since Pass 116 the app notices, quietly, that another
device changed something ("Changes from another device: 3 pieces. Press Get changes.";
it applies nothing). Live on the real site since Pass 114 (2026-10-10), with the
owner's account the only one. **Phase 2:** the two merge-by-part engines (Passes 117 and
118) are called between tabs of one browser (Pass 119) and, since Pass 120, by an
automatic update from other devices that is **off by default**. **Decided 2026-10-15,
only partly built:** the most recent change winning item by item, with practice sessions
and scales always kept (Pass 120 holds a conflicting part and Pass 121 asks the person about it
instead, so "most recent wins" is still not built; Pass 122 settled one case by the owner's
2026-10-23 rule: a deleted piece is deleted everywhere, practice and all, with a 30-day way back;
Pass 122b stopped the app asking twice: what is left unticked is remembered, piece order follows
the person with no question (the most recent reorder wins), and a refused-upload piece gets Review's
plain questions)
([`docs/Decisions.md`](docs/Decisions.md#open-questions), "When two copies disagree").
Design: [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md); what a person
sees: [`docs/User-Flows.md`](docs/User-Flows.md#10-signing-in-optional-pass-109) (flows
10 to 17).

### The account code (Passes 109 to 116)

- **The app must keep working with the backend unconfigured, and nothing
  account-related may render then.** `isBackendConfigured()` (`lib/backend.js`) is
  false when `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing (a fresh
  checkout, `npm test`). `authEnabled` in `App.jsx` gates every account surface: the
  Account panel, the welcome-screen link, both windows. A new account surface must
  check it.
- **Auth state lives in `App.jsx`** (`authSession`, only `{ email, userId }`; the
  library holds the real session), kept current by one `onAuthStateChange` listener
  (`attachAuthListener`). Never store or log the password (the windows keep it in
  component state only while open). Sign out is this device only (`scope: "local"`)
  and leaves local data alone. "Forgot password?" always answers the same sentence,
  and a wrong email and a wrong password get one message, so the forms can't reveal
  who has an account.
- **`lib/backend.js` is the only file that may touch the library, and never through
  a top-level import** (Design K): the library is a separate ~59 KB download fetched
  by `loadBackend()` only when needed, so a signed-out visitor downloads what they
  always did. `lib/accountSync.js` imports only `lib/backend.js`'s helpers. An
  invitation link is announced by the library only as an ordinary sign-in, so its
  `type` is read from the address (`authLink`, captured at file load).
- **The first backup only ever ADDS (Pass 110).** `backUpDevice`
  (`lib/accountSync.js`) inserts the rows the account lacks and nothing else; an
  existing row (a piece that differs, a piece the account marks deleted, the technique
  row) is compared and reported, never overwritten. It writes nothing to pieces or
  technique data; the only thing it writes on this device is the device record
  (`measureone-account-sync`, filed under the account's user id). **A piece that
  differs gets no device-record entry, on purpose:** a row that exists with no entry for
  it is HELD (never uploaded over), and the technique row follows the same rule. The
  first backup to an account asks first, in the Account panel (`backupAsking`), unless
  `hasRecordedBackup` says this device already holds a checked backup for that account.
  The asking lives in the handler (`handleBackUpDevice`), not in `backUpDevice`, so a
  new caller must ask for itself.
- **Never make a required step depend on a browser pop-up** (`window.confirm`/`alert`):
  the first version of the first-backup question used one and did nothing on its first
  real try, because a blocked pop-up reads as "No". Ask in the page and show results
  in the page ([`docs/UX-Principles.md`](docs/UX-Principles.md)).
- **Uploads (Pass 111).** The upload hook is one `useEffect` on `[pieces, technique,
  loaded]` declared AFTER both save effects (the pieces one via `savePieceChanges`),
  in the block headed "Keeping the backup current (Pass 111)" in `App.jsx`, so what it
  looks at is already saved on this device. It only schedules: it works out what's
  waiting (`syncSnapshot`, no network), notes a deleted piece (`noteLocalDeletions`)
  and restarts a quiet-period timer (5 seconds, never more than a minute after the
  first unsent change). Timers and listeners read refs such as `syncLatestRef`, never
  state captured when they were set up; nothing in it goes through
  `setPieces`/`updatePiece`; `lib/accountSync.js` decides everything else. Signing out
  stops a run (`syncGenRef`) and leaves the record alone, so signing back in finds
  what's waiting by comparing.
- **An account row changes only through "save only if still at revision N"**
  (`changePieceRow`, `changeTechniqueRow`, `deletePieceRow`), never an overwrite and
  never a revision of the app's own (the database counts revisions,
  `supabase/migrations/0002_revision_counter.sql`). **A refusal is not a failure and is
  never retried:** the row is read again and judged (`judgeRefusal`). The same as this
  device's copy, or any fingerprint in `sent` (below), adopts the row's revision; gone
  is put back; different (or marked deleted) HOLDS the item, marked in the device
  record, never uploaded again, this device's copy untouched, the others keep going.
  Don't "fix" a held piece by retrying: that is the overwrite the design exists to
  prevent. **The one exception (Pass 122) is a DELETION:** refused because the row is live
  but has moved on, it is tried once more at the revision just read (only `deleted_at` is
  set, nothing is erased), and refused again it stays waiting, never held. Don't extend
  that to a change.
- **A deletion counts only if this session SAW the piece leave `pieces`**
  (`reconcileLocalDeletions`, flag `deletedHere`), never merely "in the record but not
  in `pieces`": a failed load would otherwise mark the account's copy of everything
  deleted. A deleted piece is sent as `deleted_at` set and stays (Design D).
- **"The same" means the same after a reload.** Never fingerprint or compare a piece or
  technique raw in `lib/accountSync.js`: use `canonicalPiece` / `canonicalTechnique`
  through `pieceFingerprint`/`techniqueFingerprint`/`samePiece`/`sameTechnique` (the
  load's own `validateAndMigrate*` after a JSON round trip), and compare as data, never
  as text (`sameData`; the database reorders keys, and `test/accountSync.test.mjs` fails
  if it is switched to text). Why: the app builds a chunk's first practice record
  without `tier1Done`/`troubleSpots`, and a technique task without `tempo`, and loading
  adds them, so compared as-is a reloaded piece looked changed and went up again. What's
  sent is still the app's own copy. `mergeSessionArrays` (`lib/storage.js`) compares
  sessions by content, key order ignored (Pass 115); anything else that merges data that
  has been through the database has the same trap. **The technique library's `updatedAt`
  is left out of `sameTechnique` and `techniqueFingerprint` only**
  (`techniqueForComparison`); `dayList` and `walkPosition` stay in. Don't compare
  technique through `canonicalTechnique` directly.
- **Nothing here may run, and the library may not be loaded, unless the device is
  signed in AND its first backup is checked** (`computeWaiting` returns nothing
  before then). A new caller of the upload keeps that gate. Retry timing and status
  wording live in `lib/accountSync.js` (`RETRY_GAPS_MS`, `describeSyncStatus`; the
  constants are tracked in [`docs/Research.md`](docs/Research.md#account-sync-timings)).
  The Account status line shows the held message and the normal line together; "not
  answering" replaces both. The held banner reuses `.storage-error-banner` and shows on
  every screen while anything is held.
- **`sent` and the device record (Pass 115).** An upload attempt first writes the
  fingerprint of what it's about to send into that item's device-record entry (`sent`,
  the last 5; `withSentRecorded`), cleared when the account confirms a revision (the
  `with...Uploaded` functions replace the whole entry). `cleanEntry` drops fields it
  doesn't know, so a new entry field must be added there too.
- **Restore, Get changes and Review (Pass 112)** are one flow decided in
  `lib/accountSync.js` and run by `App.jsx` (`fetchAccountCopy`,
  `accountRowsToCandidates`, `planAccountMerge`, `applyAccountMerge`, with the import
  path's own `findMatchingPiece` / `mergeImportedPiece` / `mergeImportedTechnique`;
  `openAccountFlow` / `applyAccountFlow` / `handleConfirmAccountImport`, shown in the
  same `ImportPiecesModal` with `source="account"`): a decision rule belongs in the
  library with a test, never in the component. **The no-ask rule is
  `canTakeAccountCopyWithoutAsking`:** nothing waiting here AND the account changed it
  since this device last synced it, by the account's revision, never by a clock
  (confirmed 2026-10-03). Weakening it would replace work that was never uploaded, and
  eight tests fail if you do. **Superseded in direction on 2026-10-15:** the owner chose
  "most recent wins, item by item" and automatic updates. Pass 120 built the automatic
  updates and KEPT this rule (a clean newer copy still applies under it), adding Pass
  117's engine beside it for a piece changed on both sides; Pass 121 asks about a conflicting
  part instead of deciding it. **"Most recent wins" is still not built; don't weaken or remove
  this rule until something replaces it on purpose.**
- **`applyAccountFlow` saves the device record BEFORE any state changes**
  (`withAccountCopyRecorded`); reverse it and the upload hook sees merged pieces with
  no record, takes them for new, and holds each one. Combining marks the account's
  other row deleted (`markOtherCopiesDeleted` -> `markPieceRowCombined`: `deleted_at` plus,
  since Pass 122, a `mergedInto` note added to the row's data as read; only if still at the
  revision read), never erases it, and only once this device has made its first
  backup. A piece the account marks deleted is never a combine target
  (`walkAccountCandidates` leaves it out of the matching). "Delete it here too"
  (`handleDeleteHereToo`) is the only way Get changes and Review remove anything (since
  Pass 122 the automatic update removes a deletion from the last 30 days: see "Deletions"
  below): the device forgets the piece first (`withPieceDropped`), so no second "deleted"
  is sent, and
  deleting the open piece goes through `guardLeavingActiveWork`. Results are shown in
  the page (`accountNotice`), and `accountFlowBusyRef` makes the automatic upload and a
  manual backup wait while the flow runs. Restoring onto an EMPTY device is that
  device's first, checked backup (`becomesChecked`).
- **Account settings (Pass 113).** Change password is `ChoosePasswordModal` in
  `mode="change"`, opened by `openChangePassword`. "Require current password when
  updating" must stay OFF in the Supabase Email provider (it is, on both projects): the
  app sends no current password, so with it on Change password fails with the generic
  "Couldn't save your password". "Secure password change" is off too; if it's ever on, a
  sign-in older than 24 hours gets "For your security, sign in again". "Sign out of all
  devices" (`handleSignOutAll`) asks in the panel (never a pop-up) and reports honestly
  (`describeSignOutAll`); other devices keep working until their access token's hour is
  up. No in-app email change or account deletion (Phase 3): the owner does them in the
  dashboard.
- **Noticing other devices (Pass 116).** The check only notices; it applies nothing
  by itself unless the person turned on Pass 120's switch (below); otherwise "Get changes"
  is the way a change arrives. It reads only
  `id, revision, deleted_at` from `pieces` (paged like `countLiveAccountPieces`) and
  only `revision` from `technique`, never the `data` column (`checkAccountChanges`); a
  test asserts the recorded selects, and the check repeats every minute (Pass 120; it
  was five). When it
  runs is decided in the library (`createAccountChecker`/`checkIsDue`); `App.jsx`'s
  `requestCheck` only adds the gates that need app state, and a new trigger goes through
  `requestCheck`, never straight to `checkAccountChanges`. `classifyAccountChanges` is
  revision-only, and "own upload is never newer" rests on the record taking the revision
  when the account confirms an upload, so a result is not believed if an upload, backup
  or "Get changes" ran while it was reading (`checkRowsUsable`). Held pieces go in
  `held` only, never also `newer`/`deleted`, and a piece this device deleted is never
  `added`. Keep the light rows (`checkRowsRef`; `refreshSyncInfo` re-sorts them against
  the device record every time), not the sentence; a failed check shares the uploads'
  failure count and shows no error of its own.

### The merge engines (Passes 117 and 118; called by tabs of one browser and by Pass 120's automatic update)

- **What they are.** `lib/pieceMerge.js` and `lib/techniqueMerge.js` merge two copies
  **by part**. The device record's entries carry `parts` (a fingerprint per part, never
  a copy of the data), the base the engines compare against. **A new place that records
  a piece or the technique library must record its parts**, or that item will "ask". A
  quiet startup step (`withPartsRecorded`, `App.jsx`) records pieces' parts (an adopted
  row that is only an earlier version of this device's own piece records none, on
  purpose); `withTechniquePartsRecorded` is built and tested but `App.jsx` does not call
  it yet (Pass 120).
- **What a part is.** Piece: every top-level field except `progress`, `updatedAt` and
  `lastLoggedAt`, and each `progress` entry on its own (`progress:<id>`). A NEW
  top-level field is a part automatically; a new field that is derived on load (like
  `lastLoggedAt`) must be re-derived by the engine or the simulation's invariant 4
  fails. Technique (`techniquePartKey`): per scale its settings (`starred`, `rotation`,
  `octaves`, `hands`), its tempo check (tempo, check date, exact time and check octaves,
  together), practiced dates (each on its own) and last-used date per method; per method
  its star and switch; custom methods; the settings; the walk; per task its done state
  and plan. **A new field on a scale, method, setting or task must be given a part
  (`partsOfCanonical`)**, or a change to it is invisible to a merge and the simulation's
  per-field checks must learn it. A part holding its default is left out.
- **`fingerprint` and `canonicalPiece` live in `pieceMerge.js`, `canonicalTechnique` in
  `techniqueMerge.js`** (re-exported by `accountSync.js`): the engines never import the
  account code. `canonicalPiece` caches per object and returns a SHARED result: treat
  it as read-only.
- **Per part:** changed on one side only, take that side; same value on both,
  agreement; different values: a piece part is a conflict for that part only (this
  device's value kept, both listed, never resolved in the engine; `status:
  "local-only"` returns `local` itself, untouched), a technique part follows a rule per
  kind. **Pass 120 did not change this** (an automatic update holds a conflicting piece
  part instead of resolving it, and Pass 121 asks the person, see below); "the most recent
  change wins" (decided 2026-10-15) is still not built. **One exception since Pass 122b:**
  `sortOrder`, `switcherOrder` and `createdAt` (`SOFT_PARTS`) are never a conflict: changed on both
  sides to different values the engine settles them itself and lists it in `softSettled`: the
  rank and the reorder note go to the side holding the MORE RECENT reorder, and where the notes
  cannot tell (and always for `createdAt`) to the side `softWins` names (default the other copy,
  i.e. the account's; tabs pass `"local"`). See "What the person said no to" below. Scales and
  custom methods are never removed by a merge, and an empty tempo never replaces a real one.
- **Piece engine.** The "travel together" rule: the sides disagree about
  `totalMeasures`/`chunkMode`/`customChunkSize`/`chunkSplitPoints` and the other side
  changed progress or the marker: one whole-piece conflict. **The reschedule marker is
  not a merge rule** (the scheduler reads a chunk done earlier than its remainder day
  as not owed instead; see the Pass 117 rule above); don't rewrite the marker at merge
  time, it re-flows every other chunk the marker places. `lastLoggedAt` is recomputed
  from the merged sessions, and in minutes mode `daysToLearn` is the larger of the two
  and then reconciled (both forced by invariant 4).
- **Technique engine.** `lastCheckedAt` (the exact time a tempo was logged) is a stored
  scale field (in `normalizeTechniqueItem` and the undo snapshot, `lib/storage.js`), set
  by `completeTask(state, itemId, today, tempo, now)` (`lib/technique.js` has no clock;
  `App.jsx`'s `handleTechniqueComplete` passes `Date.now()`) and moved with the tempo in
  `mergeImportedTechnique`. **Any new place that logs a tempo must pass the time**, or
  that tempo can't win a same-day tie; null means "saved before this existed", never
  guess it. The walk's advance step is one function, `nextWalkPosition` / `walkStepPast`
  (`lib/technique.js`), used by `completeTask` and the merge: don't inline it again. The
  merge steps the walk once (`settleWalk`), only for a step whose completion came from
  the OTHER side than the walk's value and which still stands where it began: two
  devices that did the day's task agree on one step, and "advance once per side" breaks
  that. Don't add a rule that drops an unfinished task of a switched-off scale. A done
  task puts its scale's day, last practiced date and last-used methods back if the merge
  left them out. `status: "identical"` means identical BY PARTS, not by fingerprint,
  and is treated as in sync (`applyAccountMerge` records the fingerprint of the library
  it keeps when that equals the account's by parts, so nothing reads as waiting). Pass
  120 first shipped without this and, with the switch on, two devices re-uploaded the
  library to each other indefinitely; found in its own review, pinned by a test. No
  recorded `parts` answers `"ask"` and the caller falls back to
  `mergeImportedTechnique`.
- **The simulations are the safety net** (`test/pieceMerge.test.mjs`,
  `test/techniqueMerge.test.mjs`: seeded two-device runs, invariants checked after every
  merge). Any change to an engine must keep them green on seeds 1 to 300 (every kind of
  edit) and 1 to 100 (everyday mix), and a re-break that doesn't fail them means a hole
  in the simulation. **Run it wider before trusting a change** (copy the test and raise
  `RUNS`): the technique engine's last bug only showed past seed 2400. Design:
  [`docs/Algorithms.md`](docs/Algorithms.md#merging-by-part-pass-117) and
  [`docs/Algorithms.md`](docs/Algorithms.md#merging-the-technique-library-by-part-pass-118).
  Read [`docs/Decisions.md`](docs/Decisions.md#open-questions) ("When two copies
  disagree" and Pass 118 open items 7 and 9) before changing how a conflict is settled.

### Several tabs of one browser (Pass 119)

Every tab shares one `localStorage` but keeps its own `pieces`. Until Pass 119 the tab
that saved last silently replaced the other's work and a deleted piece came back
(reproduced with the real load/save functions). All the deciding is in `lib/tabSync.js`
(pure, `test/tabSync.test.mjs`); `App.jsx` only schedules it. Rules:

- **`reconcileFromStorage` decides per piece:** nothing; **reload** (through
  `validateAndMigratePiece`) when nothing is unsaved here; **remove** when another tab
  deleted it (never written back, even with an unsaved change here); **add**; **merge** by
  part (Pass 117's engine, base = the copy this tab last saved, this tab winning a
  same-part conflict); **keep** when it can't be put together. "Unsaved" means different
  CONTENT, never a different object. A tab's own pending delete beats another tab's
  change. Storage that can't be read, or an unusable entry, is never a deletion. The
  technique library follows the same cases with `planTechniqueMerge`'s roles swapped.
- **The same chunk logged in two tabs is a conflict in the engine** (one chunk's whole
  progress entry is one part) and it would keep ONE entry whole, dropping a session.
  `foldConflictedProgress` (`tabSync.js`, not exported) adds the other tab's sessions,
  done days and focus-spot sessions back (by content; an undo is not undone). **Pass 120
  meets the same thing with the account's copy: move the fold into `pieceMerge.js` or
  export it**, or "most recent wins" drops sessions. A grid change in one tab against
  progress in the other is still a whole-piece conflict (this tab's copy kept, the other
  side's sessions dropped, console warning only; Decisions.md open item (i)).
- **The write guard (`guardPieceWrites`, `guardTechniqueWrite`) holds a save when storage
  moved under it** and the tab reconciles instead (`runTabSync`, via `requestTabSync`). It
  checks byte-identical text first (0.22 ms on a 180 KB piece; the full comparison is
  4.5 ms). **Any new place that writes a piece key must pass the guard:** import and
  "Reschedule all" use `writePieceDirect`. `lastSavedPiecesRef` moves only through the
  save effect, `settleBaselines` or `writePieceDirect`, **never by assignment from a
  reconcile**: a reconcile registers a promise (`baselinesFor`) that settles only when the
  committed state really holds the new copy, and a result is applied only to a copy that
  is still the one it was worked out from (`applyPiecesResult`). Don't "fix" a held write
  by writing anyway; it is the overwrite this pass exists to stop.
- **`isPieceBusy` is the one "in use" test, shared with Pass 120:** an unconfirmed
  Interleaved attempt, a running reassessment timer, an open settings draft for that
  piece. Nothing is applied to a busy piece; the change is remembered
  (`deferredTabSyncRef`) and applied when idle, and its own writes are held while storage
  has moved (so its in-flight changes aren't on disk until it is idle).
- **The lease (`createTabLease`):** one tab at a time uploads and looks at the account
  (`runSync`, `requestCheck`; both re-check `holdsLease()` when they run). Record
  `measureone-tab-lease` `{ tabId, at }`: heartbeat every 10 s, takeover after 30 s without
  one (never later than 32 s: every tab looks every 2 s), released on `pagehide`; a tab
  claims, waits 250 ms and looks again, and **a look during the wait does not cut it
  short**. Only while signed in to an account service (otherwise no lease key, nothing
  changes). A tab without it still follows storage. Taking it first does a full catch-up.
  **Pass 120's automatic apply must run only where `holdsLease()` is true and skip busy
  pieces.** Not gated, on purpose: the buttons a person presses (Back up, Get changes,
  Review) and two small device-record writes (`noteLocalDeletions`, startup
  `withPartsRecorded`).
- **To check "only one tab uploads" by hand, put two tabs in separate windows side by
  side** (both visible), and show the Network panel's Method column. Not verified: a
  browser may slow a tab that is out of sight, which could pass the lease to the visible
  tab; if requests ever show in both tabs of ONE window, that is the first thing to rule
  out. The preview check in Safari (2026-10-18) used two windows and passed.
- **Left open:** no catch-up when a tab regains focus; a few milliseconds of cross-process
  `localStorage` delay in the guard; a dead holder waits out 30 s; a tab on the old version
  (a phone left open) ignores all of this until reloaded. Design, checks and the Safari
  preview results:
  [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#several-tabs-of-one-browser-pass-119).

### Changes from other devices arrive by themselves (Pass 120)

A switch in the Account panel, **"Update automatically from other devices", OFF by
default** (Pass 124 may change that). **With it off the app behaves exactly as after Pass
116** (it notices; Get changes is the way in). Rules:

- **The switch is in the device record, per account** (`accounts[userId].autoUpdate`, kept
  only while on), never in the account. **Every function that rebuilds an account's entry
  (`changeAccount`, `withBackupRecorded`) must carry it over**, or the next upload switches
  the person's choice off; a test pins it.
- **One apply step.** `runAutoUpdate` (App.jsx) fetches ONLY the changed rows
  (`fetchChangedAccountRows`) and calls `applyAccountFlow({ automatic: true })`, **the same
  function Get changes uses; do not write a second.** The record is saved before any piece
  changes (Pass 112). `automatic` changes WHAT is done (`applyAccountMerge`), never how.
  Get changes and Review **do not use the engines**; only `automatic` does.
- **By itself:** new pieces, "same", a clean newer copy (the Pass 112 no-ask rule), a piece
  changed on both sides whose every part merges cleanly (Pass 117's engine, base = the
  entry's recorded `parts`), the technique library (`mergeTechniqueFromAccount`), and (Pass
  122) a piece the account marked deleted within the last 30 days. **Never by
  itself:** a piece with a conflicting part (it is HELD, its conflicts kept in the record
  entry; Review asks about it one question at a time, Pass 121), the engine unable to tell
  ("ask"), a piece matched by
  name under another id ("combine"), an already held piece, a deletion older than 30 days or
  a combine's duplicate (both listed, Pass 122).
- **Merge before upload.** With the switch on `runSync` takes one fresh light look first (the
  latest check can be a minute old, and two devices logging seconds apart would then be
  refused and held), stops if it brought anything in (the merged result goes up next
  round), and leaves a piece that still can't be merged out of the run
  (`needsMergeBeforeUpload`, `skipPieceIds`) rather than sending it to be refused. A refusal
  is still judged and held as the last safety net. **Don't send a piece whose merge was
  deferred: it will be refused.**
- **A piece in use waits** (`isPieceBusy`, Pass 119): the change is not applied and **not
  recorded**, so the next run finds it again; an effect applies it when idle. **Never record
  an account copy for a piece you didn't apply it to:** the record would say "synced" while
  this device holds an older copy, and the next upload would overwrite the account's newer
  one. Running practice timers and half-typed reps/BPM on a card survive the piece being
  replaced (cards are keyed by chunk and role), so they are NOT in the busy test.
- **Notes are quiet:** the Account panel's "Updated from another device: ..." line (never the
  page-wide banner Get changes uses), one line at the top only if the OPEN piece changed, and
  the "will be applied when you're done" line (proposed, to be confirmed).
- **The check runs every minute** (`CHECK_EVERY_MS` 60 s, `CHECK_TICK_MS` 15 s so drift can't
  space checks 1 to 2 minutes apart), with the switch on or off. Each check is about 3 KB of
  ids, revisions and deleted dates; the Free plan has unlimited API requests.
- **Re-broken on purpose, each caught:** applying while a piece is in use (1 test fails),
  uploading before merging (2), the switch ignored (1). Seen in a browser against a local
  stand-in service (two addresses as two devices): arrives by itself in 62 and 79 s, only
  the changed row fetched, different chunks merge quietly with identical stored data, the
  same chunk is held with nothing lost, a deletion is only listed, a piece with a settings
  draft open waits and then arrives within seconds, switch off only notices.
  **Not seen on the real preview, and not tried with an unconfirmed Interleaved attempt.**
- **Found and fixed in the pass's own review (2026-10-19):** with the switch on, two devices
  whose technique libraries were the same by parts but not by fingerprint re-uploaded the
  library to each other without end (the "identical" note under the merge engines). A
  test that only used the SAME library on both sides could not have seen it; a device
  simulation (eight rounds) did.
- **Left open** (details in
  [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#changes-from-your-other-devices-arrive-by-themselves-pass-120)):
  the "applied when you're done" line is rarely visible; a piece held by a REFUSAL is not
  settled automatically (Review asks about one since Pass 122b); a hidden page skips the fresh look before an upload; two upload
  runs can overlap during it; a piece waiting because it is in use is downloaded again every
  minute; a failed automatic update leaves only a console line; `App.jsx`'s wiring has no
  automated test.

### Settling a held piece, one question at a time (Pass 121)

Review used to hand every held piece to the whole-piece picker (`ImportPiecesModal`). A
piece held WITH a recorded list of conflicting parts (Pass 120 records it) now gets one plain
question per conflicting part instead; everything else is unchanged. Rules:

- **Which pieces:** `heldIdsWithConflicts` (held, with `conflicts` in the device record). A
  piece held without a list (a refused upload, an import), a file import and the technique
  library keep the picker, exactly as before. `planSettle` also hands back `fallbackIds` it
  can't ask about (no readable account row, no recorded base) and they go to the picker too.
  When both kinds are held the questions run first, then `finishSettleFlow` opens the picker
  for the rest (`restrictCandidatesToHeld(..., exclude)` leaves out the pieces that had their
  turn, "Decide later" ones included) and keeps what was settled at the top of the result
  (`leadLines`).
- **The questions are made again when Review opens**, from the account's copy as it is now
  (`planSettle` re-runs the engine with the recorded base; pure). The recorded list only
  decides WHICH pieces go this way. **Every conflict is one question** (`buildSettleQuestions`),
  except the numbers that follow a conflicting target date (below).
- **One apply step, again.** An answer goes through `applyAccountFlow({ mode: "settle", settle:
  { [id]: answers } })` -> `applyAccountMerge({ settle })` -> `planPieceMerge({ choices })`. The
  record is saved first and the held mark and its list go with it (the account's copy is
  recorded in their place); what the device holds beyond it uploads as an ordinary change.
  **Only when the answers settle EVERY conflict is anything applied;** otherwise (an answer
  missing, or a new conflict appeared since the questions were asked) the piece and the record
  are exactly as they were (`unsettled`, each with a `reason`: "changed", "gone" or "error", and
  the page says which). Don't write a second apply step.
- **Settling acts only on what it was asked about.** In settle mode `applyAccountMerge` skips
  any piece whose walk kind isn't "settle", "same" or "take" (`SETTLE_KINDS`): it never adds a
  piece this device no longer has (a piece deleted in another tab used to be brought back and
  reported as settled), never combines by name and so never marks an account row deleted. A
  requested piece it didn't reach is `unsettled` with reason "gone", not dropped.
- **Opening Review, choosing an option, Next, Back, Decide later and Close change nothing**
  (unit-tested; seen in the browser as byte-identical storage). Only the summary's button (or
  "Bring it up to date") applies a piece, and `settleNext(...).applies` is true from nowhere else.
- **The walk through a piece's screens is plain data in `lib/settleFlow.js`** (tested in
  `test/settleFlow.test.mjs`): `startSettle`, `settleChoose`, `settleNext`, `settleBack`,
  `settleView`. `App.jsx` calls them and `SettleConflictModal` draws `settleView`'s result; put
  any new "what comes next" rule there, not in the component. Screens: a **first screen** when
  `BULK_MIN` (3) or more practice-record questions offer "both" ("Both devices' sessions for all
  N" / "Decide each one"; it is a shortcut to the same answers), the questions, then the
  **summary** (what is kept, one line for the first screen's group; in a red box what the chosen
  answers **remove**, from the options flagged `removes`), then the apply. Nothing is chosen
  for the person.
- **The account is read again at the summary's button** (`rereadSettleItem`,
  `fetchChangedAccountRows` for that one id), because the questions were made when Review opened
  and a stale row made the settled piece's upload be refused and the piece held again with no
  list. Planned afresh from the row and this device's copy as they are NOW: the same questions
  (`sameSettleQuestions`, down to the numbers in the hints) apply the answers to the NEW row (the
  record takes the new revision); different questions start the walk over with a note and apply
  nothing; a row that is gone is "gone". **If the account can't be read, nothing is applied** and
  the summary stays with a message (applying to a copy that may be old is what this exists to
  stop). Don't make "same questions" looser: a changed number of sessions that would be removed
  is a different question.
- **What an answer removes is said plainly and counted** (`removalHint`): keeping this device's
  record removes the other device's sessions from the account too; keeping the other's removes
  this device's, which the account never had. Nothing is said when no session would go. The
  whole-piece answers are always flagged `removes`.
- **"Both devices' sessions"** is `unionProgressEntries` (`lib/pieceMerge.js`): the sessions,
  the days practiced and focus spots' own sessions are unioned by content (Pass 115's
  comparison); everything else in the chunk's record (the ladder state, tempo, but also a
  rating or flag) comes from the side whose latest JUDGED session is later (a skipped or
  unconfirmed attempt doesn't move the ladder, so it doesn't count), a tie to this device.
  It does not replay sessions to rebuild the ladder, and a session one side had undone comes
  back if the other still holds it. A **whole-piece conflict** has two answers only: this
  device's whole piece or the other's.
- **Numbers worked out from the target date follow it** (`DATE_LINKED_FIELDS`: days to learn,
  minutes per day, the reschedule marker). In a days-mode schedule a date edit regenerates
  them, so when the DATE is in conflict they go with the date the person keeps and are not
  asked about (the date's question says so). Found in the browser: taking one device's date
  with the other's days gave a piece that didn't add up. With no answer, or no conflict over
  the date, they are ordinary parts (`linkedToDate` in `planPieceMerge`'s result).
- **The wording is partly proposed:** the two sentences are the pass card's; the hints under each
  option, the "Recommended" tag and the whole-piece sentence are additions. **Confirmed
  2026-10-21:** "removed" for what an answer throws away, and the first screen.
- **`planSettle` never throws** (a piece it fails on is in `errored` and goes to the picker, and
  the page says so); it takes `build` so a test can make one fail.
- **Left open:** a piece held by a REFUSAL with no recorded base still goes to the picker (one
  that knows what it last synced gets questions since Pass 122b); `foldConflictedProgress` (`tabSync.js`) and
  `unionProgressEntries` are two implementations of "keep both"; **size and schedule travel
  together is not done** (a resize on one device against a difficulty edit on the other still
  gives a piece whose measure count and difficulty list disagree; practice days per week and
  minutes per day could too, not run), proposed as its own pass; no remembered answers
  ("always keep both": deferred, no owner); deletions are Pass 122; `App.jsx`'s `handleSettleNext` (the re-read and the result lines) has no
  automated test: it was checked in a browser against a stand-in service (every outcome except a
  failed question build and the "error" message).
  Design and checks:
  [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#settling-a-held-piece-one-question-at-a-time-pass-121).

### Deletions: a piece deleted on one device is deleted everywhere (Pass 122)

**Since Pass 122** the owner's rule (2026-10-23) is in force: *a piece deleted on one device is
deleted on every device, and the practice goes with it*, with a 30-day way back. It qualifies two
older rules ("practice sessions are always kept" and "nothing is removed by itself"); both are
edited above. Design D (a deletion only MARKS the row, nothing is erased) is unchanged, and it is
what makes this safe. Rules:

- **Five cases for a piece this device holds that the account marks deleted.** Switch ON,
  deleted within 30 days, and this device synced the piece before: removed by itself, even with
  practice never backed up. Switch OFF, or older than 30 days, or a combine's duplicate, or a piece
  this device never synced: listed (Account panel + one quiet banner), with **Delete it here too**
  and **Keep it**; the duplicate gets only the first in Get changes. The
  window is `RECENTLY_DELETED_DAYS` and **one function, `isRecentlyDeleted`
  (`lib/recentlyDeleted.js`), decides it for the automatic removal AND for the Recently deleted
  list** (`deletedCutoffIso`): change one without the other and something is removed that the
  list will not show, which is the hole in the safety net.
- **A piece this device never synced is never removed by itself (2026-10-25, the owner's call:
  "imports can't be removed").** `wasSyncedHere(entry)` (a recorded revision in the device record)
  is the one test, used by `deletionsElsewhere` (such a piece goes in `unsynced`, not `recent`, so it
  is not fetched to be removed) AND by `applyAccountMerge` (checked again before removing). A file
  import keeps a piece's id, so a piece you deleted and imported again matches the account's deleted
  row; after the deletion the record keeps nothing for it and the refused re-upload leaves only a
  bare `{ held: true }`. A held piece that WAS synced keeps its revision and is still removed. An
  import merged into a piece already synced stays an ordinary change (no "imported" mark exists:
  that would change the stored format). Don't weaken either check.
- **Removal is the automatic path only** (`applyAccountMerge`, behind `automatic`); Get changes and
  Review never remove anything this way, and there is no second apply step. The record's entry is
  dropped first (`withPieceDropped`) so no second "deleted" goes up; a piece in use waits and is
  **not recorded** (as in Pass 120); the open piece moves the app to another one. A piece held as
  "changed on another device" because the deletion refused its upload is removed too.
- **Keep it and Restore are one thing:** `bringBackDeletedPiece` (reads the row, refuses `moved`
  / `combined` / `gone`, clears `deleted_at` ONLY if still at the revision read) and then the
  ordinary apply step (`bringBackThroughApply` -> `applyAccountFlow`), so a differing local copy
  is merged, never replaced. **Never write the mark and insert the piece locally yourself.**
  `bringBackThroughApply` first corrects the last light look's row for that piece, or the banner
  and the "Changes from another device" line keep showing a deletion that is no longer true.
- **A combine's duplicate carries `mergedInto`** (`markPieceRowCombined`: the row's data exactly as
  read plus that one key). Anything that reads a deleted row's data must treat it as "nobody
  deleted this": the automatic path leaves it, Recently deleted omits it, Keep it refuses it. **A
  new place that marks a row deleted because of a combine must write the note.** Combines made
  before Pass 122 have none and look like deletions.
- **A deletion is not held up by practice elsewhere:** see the changed refusal rule above
  (`syncWaitingChanges`; a deleted piece can no longer be held).
- **Notices:** red page banner only if `sessionsOnlyHere(...)` > 0 (the sessions this device has
  that the deleted row's own data lacks, by content) or the open piece was removed (one plain
  line); otherwise only the Account panel's quiet line (`describeAutoUpdate`, `describeAutoRemoved`).
- **The words come from tested functions** (`deleteWindowCopy`, `describeDeletedBanner`,
  `describeBringBack`, `describeAutoRemoved`); the delete window says "Delete everywhere" only when
  signed in with a checked first backup (`syncsToAccount`), otherwise it is the old permanent wording.
- **Recently deleted** asks the account only for rows deleted in the last 30 days
  (`fetchDeletedPieces`, `gte`), changes nothing by being opened, and restores only through the
  step above.
- **Checks.** 1476 tests; 51 deliberate breakages, all caught; seen in a browser against a local
  stand-in service (two to four addresses as devices): removal, the quiet line, the red banner,
  the open piece, a piece in use, the retried deletion, Keep it (also on a copy with unsent
  changes), Recently deleted and Restore, the 31-day case, a combine's duplicate, a deleted piece
  imported again through the real Import window (left alone), signed out and no account service.
  **Not seen on the real preview with the real test project** (the card's "Yours" checks).
- **Left open** (details and owners in
  [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#a-piece-deleted-on-one-device-is-deleted-everywhere-with-a-way-back-pass-122)):
  a piece in use is downloaded again every 5 seconds while an upload round repeats (Pass 120's
  item, not fixed); the banner and the panel offer "Keep it" on a duplicate (the light look has no
  data); pre-Pass-122 combines look like deletions (the owner has made none in the last 30 days,
  so nothing in her account is affected); a card being typed
  into or timed is not "in use", so a removal takes it; the 30 days use this device's clock;
  Restore next to a same-named piece combines; a deletion held before Pass 122 stays held. (122b,
  the other half of the card, is built: next section.)

### What the person said no to is remembered, and order follows them (Pass 122b)

The app must not ask the same question twice. Rules:

- **The answers are a device-record field, `accounts[userId].declined = { pieces, pairs }`**
  (`cleanDeclined`, `lib/accountSync.js`): per account, this device only (never in the account),
  kept only when something is in it, 500 of each at most (the newest kept), pairs sorted so either
  way round is one. **It sits beside `autoUpdate`: every function that rebuilds an account's entry
  (`changeAccount`, `withBackupRecorded`, `readDeviceRecord`) must carry it over**, or the next
  upload takes the person's "no" back; a test goes through every kind of update. A new place that
  rebuilds an entry must be added to that test.
- **One place honors them: `walkAccountCandidates`.** A piece they left off that is not here is
  skipped (`skippedDeclined`); a declined pair is never matched by name (`matchPoolFor`), so the
  other copy is an ordinary new piece. Get changes, Restore, Review and the automatic update all go
  through it. `classifyAccountChanges` keeps a declined piece out of `added` (so the "Changes from
  another device" line and the automatic fetch leave it alone). **A new way of listing or
  applying account pieces must go through the walk, or it will offer what was refused.** A piece
  that IS here is never hidden by a stale answer.
- **What unticking means is `planDeclines`** (pure, tested): an unticked NEW row is "not on this
  device" (`pieces`); an unticked "same piece, other copy" row is "different pieces" (the pair, and
  in Get changes also the copy: `pieces`, so no window opens for it again); in a RESTORE that copy
  arrives as its own piece when the copy it would have been combined with is coming too
  (`arrivingIds`). "Newer in your account" and "changed in both places" rows remember nothing.
  `handleConfirmAccountImport` records the answers BEFORE the apply; Cancel records nothing. The
  window says what unticking means, and its button works with nothing ticked ("Leave these off").
  A "maybe the same piece" row (`uncertain`: a name match where either side has no composer) starts
  unticked; **file import and `findMatchingPiece` are unchanged.**
- **"Ask me again" is `withDeclinedCleared`** (no request; the last light look is sorted against the
  record again by `refreshSyncInfo`). **Asking for a piece by name beats an old no:**
  `bringBackThroughApply` calls `withDeclinedRemoved` first, so Keep it and Restore always bring the
  piece here. A new way to bring a piece back by name must do the same. **Opening a RESTORE forgets
  earlier answers** (the welcome screen has no Settings, so there would be no "Ask me again").
- **Piece order follows the person; no account flow asks.** `SOFT_PARTS` (`sortOrder`,
  `switcherOrder`, `createdAt`) are never an engine conflict. The account's flows pass
  `orderChoice: "follow"` (`orderChoiceFor`, for a piece merged through the import merge, which
  has no base: the more recent reorder note, when either side has one; else same order, nothing
  to choose; only this device reordered since the recorded base, this device's; otherwise the
  account's; two combined copies keep the place of the one that is here, and its note). The
  window has no piece-order question for the account (the file import keeps its own).
- **The most recent reorder wins, as a whole list (the owner's answer, 2026-10-25).** Every drag
  leaves a small dated note, `piece.switcherOrder = { at, ids }` (the moment, and EVERY piece's id
  in the new order), in the pieces it changes: `planSwitcherMove` (`lib/pieceMerge.js`) decides what
  is written, `App.jsx`'s `moveGroupTo` writes it, and the ranks are written as before. **The
  switcher shows `sortPiecesForSwitcher(pieces)`, never `Object.values(pieces).sort(...)`:** the
  arrangement of the LATEST note held by any piece, pieces it does not list after it by
  `compareSwitcherOrder` (ties by date added, then id), no note anywhere exactly the old order.
  A merge keeps the later of two notes (`compareOrderNotes`; same moment: the arrangement's text,
  one answer everywhere) and the rank with it; `mergeInto` and `orderChoiceFor` apply the same
  rule, and a combine keeps the note of the piece that is here. **A new reorder is stamped by
  `nextOrderStamp`** (after every note this device has seen, so a slow clock still wins after
  receiving the other's reorder; only two reorders made apart are judged by the clocks). **A backup
  file never brings a note in** (`handleConfirmImport` drops it); "Use the imported order" writes a
  fresh note. Don't stamp every piece on a drag (it uploads and holds every piece) and don't make
  it a time per piece (two drags made apart blend into a list neither device showed): both were
  considered and rejected, and a simulation (`test/pieceMerge.test.mjs`, "devices that reorder apart
  end with the most recent reorder, as a whole") fails on the blend.
- **A piece held by a refused upload that still knows what it last synced gets Review's plain
  questions** (`heldIdsToSettle`, used by `planSettle`: held with a recorded list, or held with
  recorded `parts`). One with no recorded base goes to the picker as before; the automatic update
  still never settles it.
- **Checks.** 1,554 tests; 54 deliberate breakages, all caught; the merge simulations at seeds 1
  to 3,000 / 1 to 1,000, a convergence run of 3,000 and the whole-list reorder simulation at 3,000
  runs. **Running them wider found a check that was too strict on `main` too** (minutes-mode
  `daysToLearn`, seed 311): the engine re-works it so a reload gives the same piece; the check was
  relaxed for that one part and says why. Seen in a real browser against a local stand-in for the
  account service (two devices dragging apart, switch off and on, a file import, a work dragged as a
  block, signed out); **not seen on the real preview** (the card's "Yours" checks: the owner
  reported only the first, on 2026-10-26, and merged the pass on 2026-10-27).
- **Left open** (details and owners in
  [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#what-the-person-said-no-to-is-remembered-and-order-follows-them-pass-122b)):
  "Select none" leaves everything off and remembers it; the answers belong to this device and a
  tab or phone on the previous version drops them when it saves the record (and writes a rank with
  no note, which a noted reorder beats); they are not pruned; two reorders made apart are judged
  by the devices' clocks; and **an unexplained "pieces changed on another device" banner seen on
  the owner's first preview run (2026-10-26), not reproduced and not fixed** (the first item of
  the Pass 122b entry in [`docs/Decisions.md`](docs/Decisions.md#open-questions)'s open
  questions; the two facts that would decide it are the piece names it listed and whether
  other windows were open on that account).

### Deploying and operating (Pass 114 on)

- **A merge to `main` now ships to real accounts.** Anything touching
  `lib/accountSync.js`, `lib/backend.js` or the database must be tried on a
  preview (the test project) first, and a new migration file goes to the test
  project, then to production by hand in its SQL Editor (the app can't run
  it). **Never tick Preview on a production setting, and never put the secret
  key anywhere** (Vercel, `.env.local`, the repo). Deleting the two Production
  settings and redeploying takes accounts off the live site again. Production has the
  production project's two settings (`measureone-prod`); Preview and local development
  keep the test project's. Accounts appear on a site only while
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` were present when it was built. The
  owner's own account is the only one.
- **Two things learned shipping Passes 115 to 118 (2026-10-15).** (1) **"Merged" on
  GitHub means merged into that pull request's own base.** A pass built on another
  unmerged pass's branch and merged "separately" lands in that branch, not `main`
  (116 and 117 sat off `main` for two days). After the owner says she merged, check
  `git merge-base --is-ancestor <sha> origin/main`, the pull request's base, and that
  a file from the pass exists on `origin/main`. (2) **A change to what
  `canonicalPiece`, `canonicalTechnique` or `techniqueForComparison` return changes
  every fingerprint, so every device uploads once after the deploy.** A second device
  left open (her phone) can then collide with the first and show "The technique
  library changed on another device" even though nothing is lost; Review clears it
  (Pass 118 open item 9, which also proposes avoiding the forced upload). Say so in
  the hand-off, and ask about phones and old tabs by name.
- **One build, three addresses, separate pieces.** `measureone.vercel.app`,
  `measureone-git-main-measure-one.vercel.app` and
  `measureone-measure-one.vercel.app` serve the same deployment, but the
  browser keeps pieces per address and per browser. **The owner's real pieces
  are at `measureone-git-main-measure-one.vercel.app`**; the clean address
  opens empty. That address is also the production project's Site URL and its only
  redirect URL. A verification must not write to, or clear, storage at that address in
  the owner's browser, and "the live site looks empty" usually means another address
  or another browser.
- **`scripts/check-rls.mjs` is the security check** (37 checks, two throwaway
  accounts created and deleted in the dashboard; it refuses a secret key or an
  account that already holds data, and takes the key and passwords hidden).
  Run it against the test project and then production after any migration or
  sign-in setting change, and delete the accounts afterwards (production
  should read 0 accounts, 0 pieces, 0 technique rows until real accounts
  exist). It is not part of the app or of `npm test`.
- **Invitation and reset links die after one hour** (production's Email OTP
  expiration is 3600 seconds), so an invitation is sent only when its person
  can open it at once.
- **The way back is in `DEPLOYMENT.md` ("Rolling back")**, with the go-live rollback
  point and the rollback points since. A change to a Vercel setting only takes effect
  with a new deployment.
- **The Free plan applies to both projects:** an idle project pauses after a week
  (practice is unaffected; restore it in the dashboard) and Supabase keeps no backups
  of it, **so since 2026-10-12 a free GitHub job copies the production database every
  day into a separate PRIVATE repository, `Chopinbby/measureone-backups`** (this
  repository is public: never put data here). Check it by opening that repository's
  `LAST_BACKUP.txt` (today or yesterday counts as expected) and its Actions tab. A
  failed run, a drop in the row counts, or a newest backup over 36 hours old (a second
  check there) fails a run, and **GitHub emails the owner about failed runs only once
  the owner has switched on Settings, Notifications, Actions** (done and confirmed
  2026-10-12 by a deliberate failure; the email landed in Gmail's Updates tab; repeat
  with limit 0, see that README). GitHub's timer is best effort: the job can start
  hours late, and a skipped day sends no email by itself. It saves only the app's two
  tables, never Supabase's sign-in tables. Re-run its restore fire drill now and then
  (`tests/restore-drill.mjs` there). Manual export and the export reminder stay. See
  [`docs/Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#setup-production-project)
  and [`DEPLOYMENT.md`](DEPLOYMENT.md#rolling-back).

## Open threads and what's next

See [`docs/Roadmap.md`](docs/Roadmap.md) — no single item is currently singled out as
"next"; pick from the priority-ordered backlog there. **The accounts work is the one
thread in motion:** it is mid-Phase 2 (Passes 115 to 118 are built and live; 119, tabs of
one browser, and 120, automatic updates behind a switch that is off by default, are built),
121 (a held piece asks one plain question per conflicting part in Review) is built, 122
(a piece deleted on one device is deleted everywhere, with a 30-day way back) is built, and so is
122b (what the person said no to is remembered, order follows them, a refused-upload piece gets
Review's questions; live since 2026-10-27); the passes the docs name next are 123 (what happens offline) and 124 (turning
the switch on by default). The owner's 2026-10-15 "most recent
wins" decision is only partly built (a deletion and the piece list's order follow it; a
conflicting part of a piece is held and asked about). Read [`docs/Decisions.md`](docs/Decisions.md#open-questions) ("When two
copies disagree" and Pass 118 open item 9) first. Phase 3 (open sign-up, a privacy
policy and terms, a real email provider, monitoring, in-app change of email and
account deletion) is separate; see Roadmap.md and Accounts-and-Backend.md. Still not
built elsewhere: a persisted "learned" state, a second Tier 1 rung and repertoire
rotation (Stage 5); see
[`docs/Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built).

## Find things

| Question | Where |
|---|---|
| How is the plan scheduled, rescheduled, smoothed? | [`Algorithms.md`](docs/Algorithms.md#timeline--scheduler), [`#rescheduling`](docs/Algorithms.md#rescheduling); `lib/scheduling.js` |
| Chunking, splitting, section run-throughs, focus spots | [`Algorithms.md`](docs/Algorithms.md#splitting-a-chunk-pass-97), [`#section-run-throughs`](docs/Algorithms.md#section-run-throughs), [`#focus-spots-v1`](docs/Algorithms.md#focus-spots-v1); `lib/chunking.js` |
| Confidence and the maintenance ladder | [`Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built), [`Algorithms.md`](docs/Algorithms.md); `lib/confidence.js`, `lib/ladder.js`, `lib/maintenance.js` |
| Revival | [`Algorithms.md`](docs/Algorithms.md#revival); `lib/revival.js`, `TodayTab.jsx` |
| Technique practice (scales) | [`Technique-Practice.md`](docs/Technique-Practice.md); `lib/technique.js`, `components/tabs/technique/` |
| Backups, import/export, merging a backup | [`Algorithms.md`](docs/Algorithms.md#import-merge); `lib/storage.js` |
| Accounts, sync, the device record, the merge engines, deletions | [`Accounts-and-Backend.md`](docs/Accounts-and-Backend.md); `lib/backend.js`, `lib/accountSync.js`, `lib/pieceMerge.js`, `lib/techniqueMerge.js`, `lib/recentlyDeleted.js` |
| Deploys, rolling back, the live addresses | [`DEPLOYMENT.md`](DEPLOYMENT.md) |
| What a piece or progress field means | [`Data-Model.md`](docs/Data-Model.md) |
| Why something was built this way, what was rejected, what is still open | [`Decisions.md`](docs/Decisions.md) ([`#open-questions`](docs/Decisions.md#open-questions)) |
| What a person clicks through | [`User-Flows.md`](docs/User-Flows.md) |
| How things should look and behave; the product's rules | [`UX-Principles.md`](docs/UX-Principles.md), [`Product-Principles.md`](docs/Product-Principles.md) |
| Which constants are hand-picked | [`Research.md`](docs/Research.md) |
| Terminology | The UI says **Daily Practice**; the tab id and the component are still `today` / `TodayTab`. |
| Tests | `npm test` (`node:test`; lib-level only, nothing in `components/` is tested) |

## What each pass added

One line per pass that earlier versions of this file described at length; the detail
is in `docs/` (start with the Decisions entry for the pass) and in `git log`. **Keep it
that way:** a new pass adds one line here and its detail goes in `docs/`; a new rule
goes under "Rules that matter every session" only if forgetting it breaks something
silently.

- **Pass 29** — Interleaved practice mode on Daily Practice (rotates chunks past
  Stabilizing; provisional logging). [`Repertoire-Lifecycle.md`](docs/Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29)
- **Pass 30** — Piece Map "tempo climbing" nudge (`hasClimbingTempo`).
- **Pass 31** — `ChecklistItem` shows static instructional copy instead of a per-chunk
  method tip.
- **Pass 32a** — persisted `sortOrder` and a reorderable piece switcher (whole rows only).
- **Pass 32b** — the "Recurring material payoff" panel was removed from Progress.
- **Pass 36** — the reschedule dialog offers a concrete way out when the remaining work
  doesn't fit.
- **Pass 38** — revival copy softened; "Start/Continue revival" became a primary button.
- **Pass 39** — `isPlanActuallyComplete` and `isPieceLearned`; minutes-mode plans
  auto-extend; days-mode pieces get a "Past your target date" prompt.
- **Pass 42** — `AllPiecesTab` (cross-piece summary, week-only time, 14-day heatmap);
  work title required for multi-movement works.
- **Pass 43** — Overview "Continue learning / maintenance" shortcut; Archive gated on a
  finished plan.
- **Pass 45** — `classifyDayCompletion` and day states on Overview's first-week list.
- **Pass 46** — the same day states on the Timeline, plus a reschedule banner there.
- **Pass 47** — Daily Practice's "Go to Day N" catch-up button.
- **Pass 48** — a day swept into a reschedule collapses to "Tasks rescheduled";
  reschedule history chains through `previous`.
- **Pass 49** — section run-throughs became a repeating due/locked gate.
- **Pass 50** — Piece Map shows base chunks only; "Related chunks" in the detail modal.
- **Pass 51** — Progress "Estimated vs. actual practice time"; `piece.sections` kept
  `start <= end`.
- **Pass 52** — difficulty display labels Workable / Challenging / Difficult.
- **Pass 53** — `NumberInput` gained `onDraftChange` and `acceptPlaceholderOnTab`.
- **Pass 54** — revival presets relabeled (Lost / Rough / OK / Comfortable / Solid).
- **Pass 55** — the "what's this revival for?" question was removed.
- **Pass 56** — the Cold-Start check (`__cold_start__`). [`Algorithms.md`](docs/Algorithms.md#cold-start-check)
- **Pass 57** — `RandomStartPanel` on Daily Practice.
- **Pass 58** — piece-level "Overall confidence" (`computeOverallConfidence`) with a
  manual override.
- **Pass 59** — gap-proportional tempo ratchet. [`Algorithms.md`](docs/Algorithms.md#tempo-ratchet-pass-59)
- **Pass 60** — tempo maintenance mode near the target tempo.
- **Pass 61** — Holding's tempo floor retired; `holdingReviewCount`.
- **Pass 66** — due reviews surface inside active plans (`mergeLiveDueReviews`); reviews
  priced by difficulty everywhere.
- **Pass 67** — the "Go to Day N" scan is the single source for whether the button shows.
- **Pass 68** — section run-throughs render only on real today.
- **Pass 69** — Interleaved needs two graduated chunks, grades its rotation by
  difficulty, and draws from the whole piece.
- **Pass 74** — reschedule anchors to `realCurrentDay`.
- **Pass 75** — Week view and Master Agenda collapse swept days; `withLiveReviewStatus`.
- **Passes 76 to 82** — revival reassessment and small UI work (see `git log`).
- **Pass 83** — revival gated on plan completion; the abandoned-plan reminder.
  [`Algorithms.md`](docs/Algorithms.md#the-abandoned-plan-reminder-pass-83)
- **Pass 84** — the "today" tab is called **Daily Practice** everywhere it is named.
- **Pass 85** — `.ghost-btn:disabled` got a real visual treatment.
- **Pass 87** — `ReassessSequencePanel`: revival reassessment left Piece Map.
- **Pass 88** — Revival folded into Daily Practice (no tab of its own).
- **Pass 89** — difficulty-first introduction order (`sortPracticeChunksForIntroduction`).
- **Pass 90** — unified workload smoothing (`smoothOverloadedDays`); read-only historical
  cards. [`Algorithms.md`](docs/Algorithms.md#historical-cards-on-daily-practice)
- **Pass 91** — focus spots, experimental v1. [`Algorithms.md`](docs/Algorithms.md#focus-spots-v1)
- **Pass 92** — shared `classifyDayEmptyState` on every day-list surface.
- **Pass 93** — Settings split into a landing page and an edit page; `mergeEditedPiece`.
- **Pass 94** — five small UI fixes (shared button-width rule, Exit interleaved, and more).
- **Pass 96** — Piece Map's chunk detail links focus spots into Daily Practice (display
  and navigation only: spots are still added, resolved and deleted only from Daily
  Practice or the Wizard).
- **Pass 97** — the "Split a chunk" panel. [`Algorithms.md`](docs/Algorithms.md#splitting-a-chunk-pass-97)
- **Pass 101** — the Technique page (daily scales and arpeggios): `TechniqueTab.jsx`, in
  `NAV_BASE`.
- **Pass 102** — the shared `TechniquePanel` on Master Agenda and Daily Practice (when it
  shows and the Status wording are `techniqueTodaySummary` / `agendaStatusLabel`,
  `lib/technique.js`).
- **Pass 103** — piece keys (`homeKey`, `otherKeys`) tag matching scales.
- **Pass 104** — backups carry the technique library. (Pass 80, redone after this:
  no em dashes in app copy.)
- **Pass 109** — optional account sign-in (Supabase).
- **Pass 110** — "Back up this device": a first backup, checked by reading it back.
- **Pass 111** — every later change goes up by itself.
- **Pass 112** — restore, "Get changes" and Review.
- **Pass 113** — change password; sign out of all devices.
- **Pass 114** — the live site connected to accounts (2026-10-10).
- **Pass 115** — "same" and "changed" made trustworthy (`sent` fingerprints).
- **Pass 116** — the app notices, quietly, that another device changed something.
- **Pass 117** — the merge-by-part engine for a piece.
- **Pass 118** — the merge-by-part engine for the technique library.
- **Pass 119** — tabs of one browser stay in step; only one does the account work.
  [`Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#several-tabs-of-one-browser-pass-119)
- **Pass 120** — changes from other devices arrive by themselves, behind a switch that is
  off by default; the check runs every minute.
  [`Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#changes-from-your-other-devices-arrive-by-themselves-pass-120)
- **Pass 121** — a piece held with recorded conflicts asks one plain question per conflicting
  part in Review ("both devices' sessions", this device's, the other device's), with a first
  screen for many practice records at once and a summary (including what would be removed)
  before anything is applied; the account is read again at the last step; "Decide later"
  changes nothing.
  [`Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#settling-a-held-piece-one-question-at-a-time-pass-121)
- **Pass 122** — a piece deleted on one device is deleted everywhere (the owner's 2026-10-23
  rule; the practice goes with it), with a 30-day "Recently deleted" and a "Keep it" button; with
  the automatic switch on a deletion from the last 30 days removes the piece by itself, otherwise
  it is listed; a deletion is no longer held up by practice elsewhere; a combine's duplicate
  carries a `mergedInto` note. Deletions only: the rest of its card is Pass 122b.
  [`Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#a-piece-deleted-on-one-device-is-deleted-everywhere-with-a-way-back-pass-122)
- **Pass 122b** — what the person leaves unticked in Get changes or Restore is remembered (a new
  piece is left off, "same piece, other copy" means different pieces), with one "Ask me again about
  what I said no to" button; a name match with no composer is "maybe the same piece" and starts
  unticked; piece order follows the person between devices with no question (when both reordered,
  the most recent reorder wins as a whole list, by a dated note every drag leaves); a piece held by
  a refused upload gets Review's plain questions.
  [`Accounts-and-Backend.md`](docs/Accounts-and-Backend.md#what-the-person-said-no-to-is-remembered-and-order-follows-them-pass-122b)
- **Pass 125** — the sidebar's piece list scrolls by itself while a piece is dragged near its top or
  bottom edge, so a piece can be moved to any row in one drag (it shows about seven rows and could
  only be dragged to rows already in view). `lib/dragScroll.js`; what a drop does is unchanged.
  [`Decisions.md`](docs/Decisions.md#ux)
