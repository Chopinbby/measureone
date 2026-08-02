# Data Model

> **Purpose:** The canonical, current schema for everything MeasureOne persists
> or generates. If code and this doc disagree, treat that as a bug in whichever
> one is stale — verify against `src/App.jsx` and fix the doc.
> **Audience:** Anyone reading or writing `piece` data — future Claude Code
> sessions especially, since this is the doc to check before adding a field.
> **Scope:** Shape of persisted data (`piece`, `ChunkProgress`) and generated
> data (chunks, timeline). Not the computations that produce derived values —
> see [Algorithms.md](Algorithms.md) for those. Not *why* chunks/sections/
> transitions/combos exist as separate concepts at a product level — see
> [Product-Principles.md](Product-Principles.md#maximize-long-term-repertoire-not-just-todays-session).
> **Related:** [Algorithms.md](Algorithms.md) · [Architecture.md](Architecture.md)
> **Update when:** A field is added, removed, or its meaning changes on
> `piece` or `ChunkProgress`. This doc drifting from `defaultPiece()` in
> `src/App.jsx` is the single most likely way these docs go stale — check it
> first when auditing.

## The piece object

Everything hangs off a **piece**. The app can hold multiple pieces; each is
stored under its own `localStorage` key (`measureone-piece:<id>`), and
`measureone-active_piece_id` tracks which one is currently open.

```js
piece = {
  id,                    // string, e.g. "p_1699999999999"
  name,                  // string
  composer,              // string, optional
  notes,                 // string, optional — free text about the piece itself
                         // (not a per-session practice journal — see Roadmap.md item 1)
  totalMeasures,         // number
  measureDifficulty,     // number[totalMeasures], each 1|2|3 (easy/medium/hard)
  diffMode,              // 'grid' | 'simple' — remembers which difficulty-editor UI was last used
  sections,              // [{ id, name, start, end }] — user-defined musical form
                         // (Exposition/Development/etc). Purely descriptive;
                         // NOT the same thing as practice "chunks" below.
  recurringMode,         // 'none' | 'basic' | 'advanced'
  recurringMeasures,     // number, used when recurringMode === 'basic'
  recurringPairs,        // [{ repeatStart, repeatEnd, sourceStart, sourceEnd }]
                         // used when recurringMode === 'advanced'
  scheduleMode,          // 'days' | 'minutes' — which constraint the user fixed
  daysToLearn,           // number
  minutesPerDay,         // number
  chunkMode,             // 'auto' | 'custom'
  customChunkSize,       // number, measures per chunk when chunkMode === 'custom'
  targetBPM,             // number | null — whole-piece default tempo target
  bpmZones,              // [{ id, start, end, bpm }] — per-range tempo overrides
  recordings,            // [{ id, label, url }] — reference recordings (YouTube, Spotify, etc.),
                         // shown as links on the dashboard; purely referential, not embedded playback
  createdAt,             // epoch ms, used to compute "what day is it in the plan"
  progress,              // { [chunkId]: ChunkProgress } — see below
  rescheduleMarker,      // null | { asOfDay, remainingChunkOrder } — see Algorithms.md#rescheduling
  lastPlayedDate,        // string ("YYYY-MM-DD") | null — collected at revival entry; purely
                         // informational (displayed on Overview), not used by any automatic
                         // staleness detection — see Repertoire-Lifecycle.md and #revival below.
  memoryAnchors,         // { [id]: string } — free-text cue ("descending sequence", "watch
                         // left-hand leap") keyed by *either* a practice-chunk/transition id or a
                         // piece.sections id. One flat map because chunk ids (`c…`/`t_…`) and
                         // section ids (`s…`) never collide. Editable from the Piece Map modal;
                         // surfaced in ChecklistItem during both normal practice and revival.
  revival,               // see #revival below
}

ChunkProgress = {
  doneDays: number[],       // plan-day numbers this chunk was marked done on
  sessions: [{              // one entry per day it was logged, most recent last
    day, cleanReps, bpm, effectiveness, durationSeconds
  }],
  currentBPM,               // number | undefined — last logged tempo
  targetBPM,                // number | undefined — explicit per-chunk override;
                             // falls back to piece.targetBPM / bpmZones if unset
  manualConfidence,         // number | null — user override, wins over the
                             // computed score entirely when set. No recorded
                             // set-date — see Algorithms.md's computeConfidenceAsOf
                             // known limitation.
  weakSpot,                  // boolean | undefined — manual flag, set during revival
                              // reassessment (or from the regular Piece Map modal at any time).
                              // Persists independently of any revival cycle; computeRevivalPlan
                              // prioritizes flagged items first. See #revival below.
}
```

`defaultPiece()` in `src/App.jsx` is the literal source of truth for this
shape and its defaults — read it directly if this table and the code ever
disagree.

## Practice chunks vs. sections vs. transitions vs. combos vs. run-throughs

This distinction matters and is easy to get backwards:

- **`piece.sections`** — musical form, defined by the user, purely
  descriptive. Shown as a count on the dashboard. Never scheduled directly.
- **Practice chunks** (`kind: "section"`) — generated automatically by
  `generatePracticeChunks()` from `measureDifficulty` +
  `chunkMode`/`customChunkSize`. These are the actual units that get
  scheduled, logged, and scored. The `kind: "section"` name is a collision
  with `piece.sections` left over from an earlier iteration — a naming
  accident, not a relationship. Worth renaming to `"chunk"` if you touch
  this code; see [Architecture.md](Architecture.md#suggested-refactor).
- **Transitions** (`kind: "transition"`) — auto-generated blocks spanning
  the seam between two adjacent practice chunks. Shown to the user as
  **"Review"**, not "Transition" — the label is softened, but the internal
  `kind` and scheduling logic still treat it as its own category.
- **Combos** (`kind: "combo"`, shown as **"Focus block"**) — larger blocks
  anchored on hard chunks, spanning from the midpoint of the previous chunk
  to the midpoint of the next. Reserved for the back half of the plan.
- **Section run-throughs** (`kind: "section-runthrough"`, shown as
  **"Section run-through"**) — a play-through of one full user-defined
  section, generated once every chunk within it has at least one logged
  session. Not scheduled by `computeTimeline`; computed live by
  `computeSectionRunThroughs()` and surfaced only in
  `SectionRunThroughPanel`. See [Algorithms.md](Algorithms.md#section-run-throughs).
- **Section transitions** (`kind: "section-transition"`, shown as
  **"Sections combined"**) — a play-through spanning two adjacent sections
  back to back. Unlocks only once *every* chunk in the whole piece has been
  practiced at least once — a deliberately late-stage drill.

`generateAllChunks(piece)` returns
`{ practiceChunks, transitions, combos, all }` — `all` is what most UI and
scheduling code iterates over; `practiceChunks` alone is what
dashboard/timeline-coverage stats use. Section run-throughs and section
transitions are **not** part of this return value — they're computed
separately and only for display in Today's Practice, since they aren't
scheduled to a specific day.

## The two "how good is this chunk" scores — don't conflate them

There are two independent scores, computed differently, used in different
places, and they can disagree:

| | `computeConfidence` | `computeProgressTier` |
|---|---|---|
| Shape | continuous 0–100 | one of `untouched / learned / comfortable / mastered` |
| Inputs | full session history: reps, tempo vs. target, recency decay, self-reported effectiveness, difficulty/recurring adjustments | only the **most recent** session's clean-rep count |
| Overridable | yes, via `manualConfidence` | no |
| Used by | Piece Map, Focus Panel, Progress ("most improved"), Analytics | Overview's "Practice progress" bar only |

This is a real open question, not a documented design decision — see
[Decisions.md](Decisions.md#open-questions). If you're adding a new
"how confident is the learner in this chunk" surface, check both before
assuming which one is canonical.

## Revival

Revival (recovering a piece that was learned once but has gone stale — see
[Repertoire-Lifecycle.md](Repertoire-Lifecycle.md)) is additive: it reuses
`progress`, `manualConfidence`, and the existing chunk/transition data
model rather than introducing a parallel one. Its own state lives entirely
under `piece.revival`:

```js
revival = {
  active,                    // boolean — an entry/reassessment/plan cycle is in progress
  startedAt,                 // epoch ms | null
  purpose,                   // 'performance' | 'lesson' | 'enjoyment' | 'checking' | null
  performanceTempo,          // number | null — piece-wide tempo override collected at entry;
                              // see getRevivalTargetBPM in Algorithms.md#revival for precedence
  tempoLadderStartFraction,  // number, default 0.6 — adjustable starting point for
                              // computeTempoLadder, as a fraction of target BPM
  reassessmentComplete,      // boolean — gates the RevivalTab UI between the reassessment
                              // pass and the generated plan
  plan,                      // null | { days: [{ dayNumber, itemIds, minutes }], totalItems,
                              //          generatedAt } — see computeRevivalPlan, Algorithms.md#revival
}
```

`handleEndRevival` resets this object back to its `active: false` defaults;
it does **not** clear `progress[id].weakSpot`, `progress[id].manualConfidence`,
or `piece.memoryAnchors` — those are treated as durable chunk metadata, not
scoped to a single revival cycle.

There is deliberately no separate "reassessment confidence" field: the
revival reassessment pass **is** `progress[id].manualConfidence`, exposed
through a faster 5-preset UI (`CONFIDENCE_PRESETS` in `src/App.jsx`) rather
than a new 0-100 (or 0-4) field. See
[Decisions.md](Decisions.md#revival) for why.

## Known simplifications worth knowing about

- The effort→minutes conversion (`EFFORT_TO_MIN = 2.5`), the schedule-estimate
  padding (`LIBERAL_FACTOR = 1.2`), and the assumed on-task efficiency ratio
  (`0.65`, used as a literal magic number in three places — `ScheduleFields`
  and `handleReschedule` — rather than a single named constant) are
  hand-picked, not derived from any real practice-time study. See
  [Research.md](Research.md).
- `adaptiveReviewOffsets`'s 0.6×/1.4× multipliers and the confidence
  formula's weights are similarly hand-picked, not learned from outcomes.
- BPM zones and per-chunk difficulty reassessment both write directly into
  `piece.measureDifficulty` / `piece.bpmZones` — there's no undo history.
- `manualConfidence` has no recorded set-date, which is why
  `computeConfidenceAsOf` (used for "most improved this week") can't
  correctly exclude a manual override that was set *after* the historical
  cutoff being reconstructed — see [Algorithms.md](Algorithms.md#confidence).
- There is no first-class "piece is learned" state — see
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-informally-defined-today).
