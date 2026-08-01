# MeasureOne — Project Context

## What this app is

MeasureOne is a practice-planning tool for musicians learning a new piece. The
core problem it solves: turn "I have to learn 120 measures in 3 weeks" into a
concrete, day-by-day plan — what to practice each day, in what order, how
much repetition it actually needs, and whether the learner is falling behind
in a way that requires adjusting the plan (not just guilt).

It is **not** a metronome, notation app, or recording tool. It's a planner
and tracker that sits alongside actual practice.

The single most important idea in the app: **confidence is earned, not
assumed**. A chunk isn't "done" because a day passed — it has a computed
confidence score driven by logged reps, tempo, and self-reported difficulty,
and the schedule (spaced review, rescheduling, what to focus on) reacts to
that score rather than to a fixed calendar.

## Tech stack

- React 18 (function components + hooks only, no class components)
- `lucide-react` for icons
- No CSS framework — a single hand-written CSS string (`const CSS = \`...\``)
  injected via a `<style>` tag inside the root component. All colors go
  through CSS custom properties defined on `.measureone-app` (see "Design
  tokens" below). There is no Tailwind and no CSS modules.
- No backend. All persistence is client-side `localStorage`.
- No React Router — navigation is a simple `activeTab` string in state,
  switched via a sidebar.

## Running it locally

```
npm install
npm run dev
```

Vite dev server, default port 5173. `npm run build` produces a static
`dist/` — this app has no server-side requirements and can be hosted on
any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, etc.).

## File structure

```
measureone-app/
├── CLAUDE.md
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx      # ReactDOM entry point, just mounts <App />
    └── App.jsx        # Everything else. See below.
```

**`App.jsx` is currently a single ~2,600-line file** containing all
components, all business logic, and all styles. This is a holdover from the
app's origin as a single-file Claude.ai artifact. It works, but it is the
first thing worth splitting up if you're going to keep extending this —
see "Suggested refactor" at the bottom.

## Data model

Everything hangs off a **piece** object. The app can hold multiple pieces;
each is stored under its own `localStorage` key (`measureone-piece:<id>`),
and `measureone-active_piece_id` tracks which one is currently open.

```js
piece = {
  id,                    // string, e.g. "p_1699999999999"
  name,                  // string
  totalMeasures,         // number
  measureDifficulty,     // number[totalMeasures], each 1|2|3 (easy/medium/hard)
  diffMode,               // 'grid' | 'simple' — just remembers which editor UI was last used
  sections,               // [{ id, name, start, end }] — user-defined musical form
                           // (Exposition/Development/etc). Purely descriptive;
                           // NOT the same thing as practice "chunks" below.
  recurringMode,          // 'none' | 'basic' | 'advanced'
  recurringMeasures,      // number, used when recurringMode === 'basic'
  recurringPairs,         // [{ repeatStart, repeatEnd, sourceStart, sourceEnd }]
                           // used when recurringMode === 'advanced'
  scheduleMode,            // 'days' | 'minutes' — which constraint the user fixed
  daysToLearn,             // number
  minutesPerDay,           // number
  chunkMode,                // 'auto' | 'custom'
  customChunkSize,          // number, measures per chunk when chunkMode === 'custom'
  targetBPM,                 // number | null — whole-piece default tempo target
  bpmZones,                  // [{ id, start, end, bpm }] — per-range tempo overrides
  createdAt,                  // epoch ms, used to compute "what day is it in the plan"
  progress,                    // { [chunkId]: ChunkProgress } — see below
  rescheduleMarker,             // null | { asOfDay, remainingChunkOrder } — see "Rescheduling"
}

ChunkProgress = {
  doneDays: number[],        // plan-day numbers this chunk was marked done on
  sessions: [{               // one entry per day it was logged, most recent last
    day, cleanReps, bpm, effectiveness, durationSeconds
  }],
  currentBPM,                 // number | undefined — last logged tempo
  targetBPM,                   // number | undefined — explicit per-chunk override;
                                 // falls back to piece.targetBPM / bpmZones if unset
  manualConfidence,             // number | null — user override, wins over the
                                  // computed score entirely when set
}
```

**Practice chunks vs. sections — this distinction matters and is easy to
get backwards:**
- `piece.sections` = musical form, defined by the user, purely descriptive.
  Shown as a count on the dashboard. Never scheduled.
- **Practice chunks** = generated automatically by `generatePracticeChunks()`
  from `measureDifficulty` + `chunkMode`/`customChunkSize`. These are the
  actual units that get scheduled, logged, and scored. Internally these
  carry `kind: "section"` (a naming collision with `piece.sections` left
  over from an earlier iteration — worth renaming if you touch this code,
  see refactor notes).
- **Transitions** (`kind: "transition"`) — auto-generated 2-measure-ish
  blocks spanning the seam between two adjacent practice chunks. Exist
  because practicing chunks in isolation doesn't teach you to play through
  the join between them. Displayed to the user as "Review" (not
  "Transition") — the label was deliberately softened, but the underlying
  `kind` and scheduling logic still treat it as its own category.
- **Combos** (`kind: "combo"`, shown as "Focus block") — auto-generated
  larger blocks anchored on hard practice chunks, spanning from the
  midpoint of the previous chunk to the midpoint of the next. Purpose: give
  the learner a "start cold from a different point" drill, not just the
  same chunk boundaries every time. Reserved for the back half of the plan.

`generateAllChunks(piece)` returns
`{ practiceChunks, transitions, combos, all }` — `all` is what most UI and
scheduling code iterates over; `practiceChunks` alone is what
dashboard/timeline-coverage stats use.

## Core algorithms

All of this lives near the top of `App.jsx`, before any component
definitions.

### `generatePracticeChunks(piece)` / `generateTransitionChunks()` / `generateComboChunks()`
Pure functions, piece → chunk arrays. Chunk size comes from
`autoChunkSize(totalMeasures)` (tiered: 2/4/8/12 measures by piece length)
or `customChunkSize`. Each chunk's difficulty is the average of its
measures' difficulty ratings (`weightedDifficultyFromArray`), bucketed into
easy/medium/hard. Recurring material reduces a chunk's `effort` (the unit
the scheduler budgets against) via `effortMultiplier`.

### `computeTimeline(piece, chunkSet)`
The scheduler. Key rules, deliberately encoded as constraints rather than
just "spread everything evenly":
1. **The entire piece gets introduced within the first 50% of learning
   days** (`halfPoint`). Section chunks are bin-packed by effort against a
   daily minute budget, but capped to that first half — if the budget would
   naturally take longer, the day just gets overloaded rather than pushing
   coverage past the halfway point.
2. **Transitions are scheduled as soon as both flanking chunks have been
   introduced** — not batched into the back half. (This was a bug fixed
   later in development — an early version delayed transitions
   unnecessarily via an index-based spread; if you see `i % backSpan`-style
   offsets reappear on the transitions loop, that's the bug coming back.)
3. **Combos are reserved for the back half**, spread across it round-robin.
4. **Spaced review** uses `REVIEW_OFFSETS = [1, 3, 7, 14]` days after a
   chunk's introduction, but see "Adaptive review" below — this isn't
   actually fixed.
5. **Only the final day** (if the plan is ≥5 days) is a pure "no new
   material, full run-through" consolidation day. Earlier iterations
   reserved a much bigger tail for this; that was deliberately walked back
   because it wasted the back half on nothing but run-throughs instead of
   targeted work.

### Adaptive review — `adaptiveReviewOffsets(chunk, progress)`
Not fully learned/tuned yet (see Roadmap), but the mechanism is in place:
the fixed `[1,3,7,14]` offsets get multiplied by 0.6 if the chunk's most
recent logged session had `effectiveness: "low"`, or 1.4 if `"high"` —
i.e., struggling sessions pull the next review closer, easy ones push it
out. This is recomputed every time `computeTimeline` runs, which is on
every `piece` change (see State management) — so review placement can
shift for not-yet-happened days as new session data comes in. It never
touches days that have already passed.

### Confidence — `computeAutoConfidence(chunk, piece, currentDay)`
The scoring is intentionally **not** "did you touch it" — it's
reps-quality-weighted:
- Each logged session contributes `repRatio * (0.5 + 0.5 * bpmRatio)` where
  `repRatio = cleanReps / requiredReps` (required reps come from
  `REQUIRED_REPS = { easy: 3, medium: 4, hard: 5 }`) and `bpmRatio =
  bpm / targetBPM` (or a neutral 0.6 if no target BPM exists anywhere for
  that chunk). Fewer clean reps at a lower tempo genuinely scores lower —
  this was a specific bug fix; don't let this regress into "any session =
  full credit."
- Recency decays the score if it's been several days since last practiced.
- The learner's self-reported `effectiveness` on their most recent session
  ("Needs more work" / "Good" / "Too easy") applies a final multiplier
  (0.8× / 1× / 1.15×).
- Hard chunks get a small penalty (need more to feel "solid"); recurring
  chunks get a small boost (already-familiar material).
- `computeConfidence()` wraps this and short-circuits entirely if
  `progress[chunkId].manualConfidence` is set — manual override always wins.
- `getDefaultTargetBPM(piece, chunk)` resolves the effective tempo target
  for a chunk when it has no explicit per-chunk target: checks
  `piece.bpmZones` for a measure-range match first, then falls back to
  `piece.targetBPM`.

### "Behind schedule" — `computeScheduleStatus(piece, practiceChunks, timeline, currentDay)`
A chunk only counts as **missed** if its scheduled introduction day
(`timeline.introducedDay[chunkId]`) has already passed (`< currentDay`) and
it still has zero logged sessions. This was also a deliberate fix — an
earlier version compared cumulative planned-vs-actual counts, which
incorrectly flagged "behind schedule" on the very day something was
completed, before the day was even over. Don't reintroduce same-day
cumulative comparison as the trigger for the reschedule banner.

### Rescheduling — `getEffectiveTimeline(piece, chunkSet)`
When the user hits "Reschedule remaining days," `piece.rescheduleMarker =
{ asOfDay, remainingChunkOrder }` gets set (`remainingChunkOrder` is the
ordered list of practice-chunk ids with zero sessions logged).
`getEffectiveTimeline` then: keeps every day before `asOfDay` exactly as
originally computed, and re-runs `computeTimeline` on just the remaining
chunks packed into whatever days are left, splicing the two together. The
reschedule confirmation dialog also estimates whether the remaining
material can realistically fit in the remaining time at the current pace,
and shows a stronger warning (not just a mild confirm) if it can't.

## Main UI components (all in `App.jsx`, top to bottom in the file)

| Component | Purpose |
|---|---|
| `NumberInput` | Every numeric field in the app uses this instead of a raw `<input type="number">`. It decouples the displayed text from the committed value (commits on blur/Enter) specifically to avoid a controlled-input bug where clearing a field to retype gets fought by React re-rendering the old value mid-keystroke. **Always use this for numeric fields**, not a raw input. |
| `ManuscriptDoodle` / `ManuscriptStrip` | Decorative SVG (hand-drawn staff/clef band) and the colored horizontal strip of practice chunks shown on the dashboard and wizard review step. |
| `BasicsFields`, `SectionsEditor`, `DifficultyEditor`, `RecurringEditor`, `ScheduleFields`, `BpmZonesEditor` | Shared field-editor components. Each is used in **both** the setup `Wizard` and the Settings edit form — this sharing is intentional so the two flows can't drift apart. When adding a new piece-level field, add it to one of these (or a new one) rather than duplicating markup in Wizard and Settings separately. |
| `Wizard` | Multi-step modal for creating a new piece. Steps: Piece → Sections → Difficulty → Repeats → Timeline → Review. Only used for *creating* a piece — editing an existing one goes through Settings, not this modal. |
| `ScheduleBanner` | The "N chunks behind schedule" banner shown on Overview and Today's Practice. |
| `OverviewTab` | The dashboard / landing screen once a piece is loaded. |
| `TimelineTab` | Full day-by-day schedule, grouped by week. Day cards are clickable and jump straight to that day in Today's Practice. |
| `PieceMapTab` | Grid of every chunk (practice + transition + combo) colored by confidence. Clicking a tile opens a **modal** (not an inline panel — this was a UX fix; don't revert it to rendering the detail view inline below the grid) with BPM inputs and the manual-confidence override. |
| `ChecklistItem` / `DayChecklist` | The actual practice-logging UI. Each item has a Start/Stop timer, clean-reps + BPM + "how did it feel" inputs, and a checkbox that **also** submits the log directly once those three inputs are valid (not just the "Log practice" button — both do the same thing, `submitLog()`). |
| `FocusPanel` | "Needs the most work right now" — ranks everything touched so far by confidence, independent of what's on today's schedule. This is the app's answer to "don't over-practice easy stuff." |
| `ReassessPanel` | Lets the user re-rate difficulty for a specific measure range (not a whole chunk) after practicing — matches how difficulty was entered at setup (per-measure). Apply both commits the change and closes the panel in one action. |
| `TodayTab` | Composes `ScheduleBanner`, `FocusPanel`, `DayChecklist` (or all days at once in "View all" mode), and `ReassessPanel`. |
| `ProgressTab`, `AnalyticsTab` | Charts/stats: actual-vs-planned progress, tempo progress, practice history, confidence-by-difficulty breakdown. |
| `SettingsTab` | View mode shows a read-only summary + "Edit piece" / "Delete this piece" / "Add new piece". Edit mode reuses the shared field-editor components listed above. |
| `App` | Root component. Owns all state (see below) and renders the sidebar + whichever tab is active, or the empty-state / loading screens. |

## State management

Everything lives in `App`'s `useState`/`useEffect` — there's no external
state library.

- `pieces` (object, id → piece) + `activePieceId` — the multi-piece
  collection. `piece = activePieceId ? pieces[activePieceId] : null` is
  derived, not stored separately.
- `updatePiece(updaterFnOrValue)` — the one function every mutation goes
  through. Always updates `pieces[activePieceId]`. **Use this, not
  `setPieces` directly**, for any change to the active piece.
- `editDraft` (+ `setEditDraftState`) — lives at the `App` level
  specifically so that navigating away from Settings mid-edit and coming
  back doesn't lose in-progress changes (it used to live inside
  `SettingsTab`, which unmounts on tab switch and was silently discarding
  edits — fixed by lifting it up).
- `dayOverride` — lets the user browse other days in Today's Practice
  without changing which day is "actually" today; `null` means "follow
  real time." `getCurrentDay(piece, totalDays)` derives the real day from
  `piece.createdAt` vs. `Date.now()`.
- `wizardOpen`, `switcherOpen`, `settingsEditing`, `activeTab`, `loaded` —
  straightforward UI state.

`chunkSet` and `timeline` are `useMemo`'d off `piece` — they are **pure
derivations**, never stored in `piece` itself. If you need something
schedule-related to persist (like the reschedule marker), it goes on
`piece` as input data, and the derivation recomputes from it.

## Design tokens (for consistent styling if you extend the UI)

Defined as CSS custom properties on `.measureone-app` at the top of the
`CSS` string: `--paper`, `--paper-card`, `--ink`, `--ink-soft`,
`--ink-faint`, `--line`, `--brass`/`--brass-deep` (primary accent),
`--teal` (easy / confident / positive), `--brick` (hard / needs-work /
danger). Fonts: Fraunces (headings), Inter (body/UI), IBM Plex Mono
(numbers — measures, BPM, day counts, percentages).

## Known simplifications worth knowing about

- The effort→minutes conversion (`EFFORT_TO_MIN = 2.5`) and the "liberal"
  schedule-estimate padding (`LIBERAL_FACTOR = 1.2`) are hand-picked
  constants, not derived from any real practice-time study.
- `adaptiveReviewOffsets`'s 0.6×/1.4× multipliers and the confidence
  formula's weights are similarly hand-picked, not learned from outcomes.
- BPM zones and per-chunk difficulty reassessment both write directly into
  `piece.measureDifficulty` / `piece.bpmZones` — there's no undo history.

## Roadmap — what's intentionally not built yet

Everything in "Phase 1" (setup, chunking, timeline, piece map, BPM
tracking, confidence, rescheduling, multi-piece) is done. Explicitly
deferred, in rough priority order discussed with the product owner:

1. **Practice journal** — free-text notes per session.
2. **Long-term / maintenance scheduling** — what happens after a piece is
   "learned" (spaced maintenance reviews, repertoire rotation).
3. Printable/exportable reports, teacher mode, calendar integration —
   explicitly deprioritized until the adaptive scheduling above is solid.
4. A genuinely *learned* (not hand-tuned) confidence/interval model — the
   current adaptive offsets are a fixed heuristic, not something that
   improves from outcome data. Making the 0.6×/1.4×/0.8×/1.15× constants
   actually adapt per-user is the natural next step once there's enough
   session history to tune against.
5. Cloud sync / accounts / multi-device — everything is `localStorage`
   today, single browser only.

## Suggested refactor (not done, but worth doing before this grows further)

`App.jsx` is a single file because it started as a Claude.ai artifact,
where that's a hard constraint. It no longer needs to be. If you're going
to keep building on this, splitting along these lines would help:

```
src/
  lib/
    chunking.js       # generatePracticeChunks, generateTransitionChunks,
                        generateComboChunks, generateAllChunks
    scheduling.js      # computeTimeline, getEffectiveTimeline,
                         computeScheduleStatus, adaptiveReviewOffsets
    confidence.js       # computeAutoConfidence, computeConfidence,
                          isManualConfidence, getDefaultTargetBPM
    storage.js           # the localStorage load/save effects, extracted
                           into plain functions
  components/
    NumberInput.jsx
    fields/             # BasicsFields, SectionsEditor, DifficultyEditor,
                          RecurringEditor, ScheduleFields, BpmZonesEditor
    Wizard.jsx
    tabs/               # OverviewTab, TimelineTab, PieceMapTab, TodayTab,
                          ProgressTab, AnalyticsTab, SettingsTab
  App.jsx               # just state + layout, imports everything above
```

Also worth renaming while you're in there: practice chunks currently carry
`kind: "section"`, which collides in name (not in code — just in a human's
head) with `piece.sections` (the user-defined musical form). Renaming the
chunk kind to something like `"chunk"` would remove a recurring source of
confusion.
