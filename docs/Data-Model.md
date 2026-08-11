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
  name,                  // string — what this plan is for. For a movement of a
                         // multi-movement work, this is the movement ("I. Allegro"),
                         // not the work title. See #works below.
  workId,                // string | null — groups sibling movements. Derived from
                         // workName, never entered directly. See #works below.
  workName,              // string — title of the whole work; "" for a standalone piece
  composer,              // string, optional
  notes,                 // string, optional — free text about the piece itself
                         // (not a per-session practice journal — see Roadmap.md item 1)
  status,                // 'active' | 'paused' | 'archived' — user-set, never inferred.
                         // Paused/archived pieces drop off the Master Agenda and stop
                         // triggering "behind schedule" (computeScheduleStatus short-
                         // circuits missedCount to 0 for either). Confidence is
                         // unaffected either way — computeAutoConfidence's existing
                         // recency decay already makes an untouched piece's confidence
                         // fade on its own; status doesn't add a second decay path. See
                         // Repertoire-Lifecycle.md and Decisions.md#lifecycle.
  totalMeasures,         // number
  measureDifficulty,     // number[totalMeasures], each 1|2|3 (easy/medium/hard)
  diffMode,              // 'grid' | 'simple' — legacy; 'simple' (the quick-count
                         // UI) was removed from DifficultyEditor, which now only
                         // renders the grid, but the field and its old value are
                         // left as-is on already-saved pieces. See Decisions.md#ux.
  sections,              // [{ id, name, start, end }] — user-defined musical form
                         // (Exposition/Development/etc). Purely descriptive;
                         // NOT the same thing as practice "chunks" below.
  recurringMode,         // 'none' | 'basic' | 'advanced' — 'basic' (the quick-count
                         // UI) was similarly removed from RecurringEditor; only
                         // 'none'/'advanced' are reachable from the UI now, but
                         // generatePracticeChunks still honors 'basic' for
                         // already-saved pieces. See Decisions.md#ux.
  recurringMeasures,     // number, used when recurringMode === 'basic'
  recurringPairs,        // [{ repeatStart, repeatEnd, sourceStart, sourceEnd }]
                         // used when recurringMode === 'advanced'
  scheduleMode,          // 'days' | 'minutes' — which constraint the user fixed
  daysToLearn,           // number — total *calendar* days the plan spans (see
                         // practiceDaysPerWeek below; not every one of these is
                         // necessarily a practice day)
  minutesPerDay,         // number
  startDate,             // string ("YYYY-MM-DD") — day 1 of the plan; the anchor
                         // getCurrentDay uses to compute "what day is it in the
                         // plan today." Editable on the Schedule tab; defaults to
                         // today at creation. Distinct from createdAt below — an
                         // imported piece keeps whatever startDate the backup had
                         // (so an in-progress plan doesn't jump back to day 1),
                         // but falls back to the import date if the backup didn't
                         // have one. Pieces saved before this field existed are
                         // backfilled to today on load (see storage.js) rather
                         // than inferred from createdAt, which was never a safe
                         // stand-in for it (see Decisions.md#scheduling).
  targetDate,            // string ("YYYY-MM-DD") | null — deadline the user picked
                         // in 'days' scheduleMode; daysToLearn is derived from
                         // this (startDate through targetDate, inclusive)
  practiceDaysPerWeek,   // number, 3-7 — how many of the 7 days in a week are
                         // practice days; computeTimeline bakes (7 - this many)
                         // rest days evenly into the generated plan. Missing on
                         // pieces created before this field existed, treated as 7
                         // (no rest days) — see Algorithms.md#timeline--scheduler
  chunkMode,             // 'auto' | 'custom'
  customChunkSize,       // number, measures per chunk when chunkMode === 'custom'
  targetBPM,             // number | null — whole-piece default tempo target
  bpmZones,              // [{ id, start, end, bpm }] — per-range tempo overrides
  recordings,            // [{ id, label, url }] — reference recordings (YouTube, Spotify, etc.),
                         // shown as links on the dashboard; purely referential, not embedded playback
  createdAt,             // epoch ms — when this piece record was created in this
                         // browser/instance. Sort-order bookkeeping only (piece
                         // switcher, work grouping) — NOT the scheduling anchor;
                         // see startDate above for that.
  progress,              // { [chunkId]: ChunkProgress } — see below. One key isn't
                         // a real chunk id: "__consolidation__" holds the
                         // whole-piece consolidation-day run-through's history —
                         // `doneDays` plus `sessions: [{ day, stopCount, loggedAt,
                         // loggedDate }]` (Pass 6, Repertoire-Lifecycle.md's
                         // "Post-run-through logging"). DayChecklist.jsx and
                         // ProgressTab.jsx key off this literal string directly; as of
                         // Pass 7, computeRevivalTriggers (lib/revival.js) reads its
                         // `sessions[].stopCount` too (the > 5 auto-trigger condition), and
                         // storage.js's computeLastLoggedAt reads its `sessions[].loggedDate`
                         // like any other entry's — it used to skip this key specially, which
                         // was a bug (see the `lastLoggedAt` field below). A synthetic entry
                         // in the same map, not a documented exception until now.
  rescheduleMarker,      // null | { asOfDay, remainingChunkOrder } — see Algorithms.md#rescheduling
  lastPlayedDate,        // string ("YYYY-MM-DD") | null — collected at revival entry; purely
                         // informational (displayed on Overview), not used by any automatic
                         // staleness detection — see Repertoire-Lifecycle.md and #revival below.
  lastLoggedAt,          // string ("YYYY-MM-DD") | null — most recent session.loggedDate across
                         // every progress entry (INCLUDING "__consolidation__"'s run-through
                         // sessions — excluding them was a real bug, fixed alongside Pass 7),
                         // recomputed on every load (not backfilled-and-locked-in like
                         // startDate). Read by Revival's 60+-days-untouched auto-trigger
                         // condition (computeRevivalTriggers, lib/revival.js, Pass 7) — a piece
                         // whose only activity is run-throughs must not look falsely stale here.
                         // See Repertoire-Lifecycle.md#revival-auto-triggers and
                         // Decisions.md#spaced-repetition--maintenance.
  ladderConfig,          // { stabilizing, settling, holding, bpmSteps } — piece-level tunable
                         // config for the spaced-repetition maintenance ladder (stage lengths,
                         // graduation pass-counts, tempo floors, practiceBPM ratchet step sizes).
                         // Hardcoded defaults set at creation (Wizard.jsx) and backfilled on
                         // migration (storage.js); no editing UI yet. Read by the stage-math
                         // engine in lib/ladder.js (computeLadderAdvance), called on every
                         // logged session (handleLogSession, App.jsx) and, since Pass 5, also
                         // consulted indirectly via ChunkProgress.nextDueDate when
                         // computeTimeline places each chunk's next review — see #ladder-config
                         // below and Algorithms.md#session-outcomes--the-maintenance-ladder.
  memoryAnchors,         // { [id]: string } — free-text cue ("descending sequence", "watch
                         // left-hand leap") keyed by *either* a practice-chunk/transition id or a
                         // piece.sections id. One flat map because chunk ids (`c…`/`t_…`) and
                         // section ids (`s…`) never collide. Editable from the Piece Map modal;
                         // surfaced in ChecklistItem during both normal practice and revival.
  revival,               // see #revival below
}

ChunkProgress = {
  doneDays: number[],       // plan-day numbers this chunk was marked done on at least once —
                            // a count of distinct DAYS touched, not of sessions logged (see
                            // sessions below; PieceMapTab's "Sessions logged" reads this field
                            // and is really showing days-touched, a pre-existing label that
                            // predates same-day multi-session support and hasn't been
                            // reworded — a known small inaccuracy, not a bug).
  sessions: [{              // one entry per LOGGED ATTEMPT, most recent last. Multiple entries
                            // can now share the same `day` (a Tier 1 touch, a due review, a
                            // re-attempt) — never overwritten by day alone; see loggedAt below.
    day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds
  }],                       // durationSeconds comes from the ChecklistItem timer, or from
                            // the manual minutes field when the user typed one instead.
                            // loggedAt (epoch ms) is what actually distinguishes same-day
                            // entries — a precise timestamp, set by handleLogSession
                            // (App.jsx) at log time. A placeholder keying scheme, not the
                            // semantic Tier-1/due-review/re-attempt distinction the design
                            // notes eventually want — Tier 1/Tier 2 review *scheduling* is
                            // now built (Pass 5), but tagging which kind a given logged
                            // session actually was is a separate, still-unbuilt piece; see
                            // Decisions.md#spaced-repetition--maintenance. loggedDate ("YYYY-MM-DD") is the calendar date
                            // derived from loggedAt for sessions logged going forward, or
                            // backfilled from `day` + piece.startDate for sessions that
                            // predate the field — see storage.js. outcome ('pass' | 'soft-miss'
                            // | 'fail') replaces the old free-standing `effectiveness` field —
                            // see Decisions.md#spaced-repetition--maintenance. Old sessions
                            // that only have `effectiveness` are read through
                            // lib/confidence.js's sessionOutcome(), not migrated in place.
  currentBPM,               // number | undefined — last logged tempo (what was actually played)
  targetBPM,                // number | undefined — explicit per-chunk override;
                             // falls back to piece.targetBPM / bpmZones if unset
  manualConfidence,         // number | null — user override, wins over the
                             // computed score entirely when set. No recorded
                             // set-date — see Algorithms.md's computeConfidenceAsOf
                             // known limitation.
  flag,                      // undefined | 'rough' | 'lost' — manual per-chunk flag, cycled on the
                              // Piece Map (untouched -> rough -> lost -> untouched) or from
                              // Revival's sequential reassessment modal (same control, same field).
                              // Replaces the old boolean `weakSpot` (Pass 6,
                              // Repertoire-Lifecycle.md's "Post-run-through logging" — merged, not
                              // kept alongside it, confirmed with the user before that pass
                              // started). Landing on 'rough' or 'lost' also demotes this chunk's
                              // ladder stage and pins nextDueDate to today, via
                              // lib/ladder.js's applyRunThroughFlag — see #ladder-config below.
                              // Also caps computeConfidence's result (55 for rough, 20 for lost,
                              // applied after either the manual or auto branch) so a flagged
                              // chunk can't show stale-high confidence anywhere it's displayed —
                              // see Algorithms.md#confidence. Indirectly affects
                              // computeProgressTier too, via the `stage` demotion above rather
                              // than reading `flag` itself — a flagged chunk drops a Practice
                              // Progress tier on Overview through the same mechanism, not a
                              // separate check. Persists independently of any
                              // revival cycle; computeRevivalPlan prioritizes any flagged chunk
                              // first (rough and lost treated alike for that ordering, not a
                              // three-tier sort). A 'lost' flag specifically (not 'rough') also
                              // feeds Revival's "large chunks lost" auto-trigger condition (Pass
                              // 7, computeRevivalTriggers, lib/revival.js) — a live read of
                              // whatever's flagged lost right now, not a per-event log. See
                              // #revival below. A pre-Pass-6 piece with the
                              // old `weakSpot: true` reads that forward as `flag: 'rough'` on
                              // migration (storage.js's backfillProgressLadderState) — `weakSpot`
                              // itself does not survive migration once converted, and never wins
                              // over an already-set `flag`.
  flagSnapshot,               // { stage, consecutivePasses, nextDueDate } | undefined — captured
                              // by App.jsx's handleSetFlag the moment `flag` is first set (the
                              // untouched->rough transition only; not re-captured on rough->lost,
                              // so it always holds the state from before *any* flag in the current
                              // cycle). Clearing the flag back to untouched restores these three
                              // fields from here and deletes it, undoing exactly the schedule
                              // change the flag caused. If a real session gets logged while
                              // flagged, handleLogSession deletes this instead — a genuinely
                              // earned ladder advance must never be discarded by a later "never
                              // mind" on the flag. Backup-merge (storage.js's mergeProgress) treats
                              // it like the other ladder fields below: the existing piece's value
                              // always wins over an imported file's. handleSetFlag verifies all
                              // three fields are present before trusting a snapshot to restore
                              // from — on a malformed one it warns and skips the restore rather
                              // than writing undefined into stage/nextDueDate, since this is the
                              // only write site today but a future one could shape it differently.
  stage,                     // null | 'stabilizing' | 'settling' | 'holding' — this chunk's rung
                              // on the spaced-repetition maintenance ladder. null means "not on
                              // the ladder" — no entry/Tier-1 mechanic exists yet to move a chunk
                              // off null, so every chunk starts and stays here until logged.
                              // Advanced live by handleLogSession (App.jsx) calling
                              // lib/ladder.js's computeLadderAdvance on every logged session.
                              // See #ladder-config below.
  consecutivePasses,          // number, default 0 — consecutive full passes at the current stage
                               // that cleared that stage's tempo floor. Live, via
                               // computeLadderAdvance on every logged session (see stage above).
  consecutiveStabilizingFails, // number, default 0 — fails logged back-to-back while
                                // stage === 'stabilizing'. Distinct from consecutivePasses, which
                                // only counts passes and can't tell a 1st fail from a 2nd (a fail
                                // always resets it to 0). Drives lib/ladder.js's needsRelearning
                                // signal ("this was never actually consolidated" — two Stabilizing
                                // fails in a row) — confirmed NOT wired to Revival (chunk-scoped,
                                // Revival's triggers are piece-wide); currently just a data flag
                                // nothing reads. See Decisions.md.
  practiceBPM,                // number | null — the tempo the ladder is currently asking for on
                               // this chunk, distinct from targetBPM (the eventual goal). Seeded
                               // to whatever tempo was first attempted (a placeholder — see
                               // handleLogSession, App.jsx; there's still no deliberate
                               // ladder-entry seeding mechanic, distinct from the Tier 1
                               // *scheduling* concept below, which is built), then ratchets via
                               // ladderConfig.bpmSteps (+2 pass / -2 soft-miss / -2 fail) on
                               // every logged session.
  nextDueDate,                 // string ("YYYY-MM-DD") | null — this chunk's next scheduled ladder
                                // review, recomputed on every logged session. Load-bearing since
                                // Pass 5: computeTimeline reads this directly to place the chunk's
                                // Tier 2 review (Algorithms.md#timeline--scheduler rule 4). Also read
                                // *outside* the plan's bounded days[] since Pass 8, by
                                // computeDueReviews(piece, chunkSet, asOfDate) (lib/maintenance.js),
                                // which compares it against a real calendar date to drive the due
                                // lists in Master Agenda and the Today tab — the reason this field
                                // was specified as a date rather than a plan-day int in the first
                                // place. See Algorithms.md#whats-due--the-live-maintenance-query.
  tier1Done,                   // boolean, default false — whether the one-time first-touch review
                                // (Repertoire-Lifecycle.md's "Tier 1") has happened for this chunk.
                                // Read/passed through unchanged by computeLadderAdvance; still
                                // never set true by anything. Pass 5's Tier 1 scheduling is a live,
                                // recomputed-every-time decision (stage:null and zero sessions) —
                                // it doesn't write back to this field, so tier1Done stays
                                // permanently false and unused even now that Tier 1 itself exists.
}
```

### Ladder config (`piece.ladderConfig`) {#ladder-config}

Piece-level tunable data for the spaced-repetition maintenance ladder — see
[Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built)
for the full design. Hardcoded defaults for now (no editing UI); stored so a
later UI pass is additive rather than needing its own migration.

```js
ladderConfig = {
  stabilizing: { intervalDays, graduationPasses, tempoFloorFraction },
  // intervalDays: 4 — review cadence. graduationPasses: 4 — consecutive
  // full passes needed to graduate. tempoFloorFraction: null — Stabilizing
  // has no tempo floor.
  settling: { intervalDays, graduationPasses, tempoFloorFraction },
  // intervalDays: 7. graduationPasses: 4. tempoFloorFraction: 0.7 — a
  // hand-picked point within the doc's ~70–75%-of-target range.
  holding: {
    startIntervalDays, maxIntervalDays,
    tempoFloorStartFraction, tempoFloorStepFraction, tempoFloorCapFraction,
  },
  // startIntervalDays: 14. maxIntervalDays: 70 (10 weeks) — hand-picked
  // point within the doc's ~8–12-week cap range. tempoFloorStartFraction:
  // 0.85, tempoFloorStepFraction: 0.05 ("+5 points per successful pass"),
  // tempoFloorCapFraction: 1. No growth-rate field here — Holding's
  // interval growth is computed entirely from the same 0.6×/1×/1.4×
  // effectiveness multiplier concept adaptiveReviewOffsets introduced
  // (scheduling.js) — lib/ladder.js keeps its own small duplicated copy of
  // the multiplier itself now, per the doc's "not a second multiplier
  // system" instruction — see Decisions.md#spaced-repetition--maintenance.
  bpmSteps: { pass, softMiss, fail },
  // pass: 2, softMiss: -2, fail: -2 — how much practiceBPM moves per
  // outcome. fail matches the other two rather than the doc's original
  // ~8-10 pullback — a user decision, see Decisions.md.
}
```

All values are hand-picked, not derived from any study — same spirit
as `EFFORT_TO_MIN`/`LIBERAL_FACTOR` (see [Research.md](Research.md)). The
stage-transition math and BPM ratcheting that read this config
(`computeLadderAdvance` in `lib/ladder.js`) are wired into logging:
`handleLogSession` (`App.jsx`) calls it on every session and persists the
result. `computeTimeline` (`lib/scheduling.js`) also now reads the
resulting `nextDueDate` directly to schedule each chunk's Tier 1/Tier 2
review (Pass 5 — see
[Algorithms.md#timeline--scheduler](Algorithms.md#timeline--scheduler)).
As of Pass 8 the resulting `nextDueDate` is read a second way, outside the
plan entirely: `computeDueReviews` (`lib/maintenance.js`) compares it
against a real calendar date to drive the due lists in Master Agenda and
the Today tab, so a review still reaches the learner once a piece runs past
its original `daysToLearn` — see
[Algorithms.md](Algorithms.md#whats-due--the-live-maintenance-query) and
[Decisions.md](Decisions.md#spaced-repetition--maintenance).

Still not built against this config: any editing UI for the values below
(stage lengths, tempo floors, BPM step sizes) — they remain hardcoded
defaults, stored per-piece so a later UI pass is additive.

`defaultPiece()` in `src/components/Wizard.jsx` is the literal source of truth
for this shape and its defaults — read it directly if this table and the code
ever disagree.

## Works (multi-movement pieces)

A **work** is a grouping label over ordinary pieces, nothing more. Each
movement is a complete, self-contained piece: its own chunks, timeline,
schedule, `progress`, and `revival` state, in its own `localStorage` key.
Movements are linked only by a shared `workId`, so chunking, scheduling,
confidence, revival and storage need no awareness that works exist.

- `workName` is the only thing the user types. `workId` is derived from it by
  `ensureWorkId` in `src/lib/works.js`, called on piece creation and on save
  from `SettingsTab`. Typing a work title on a standalone piece promotes it
  into a (single-movement) work; clearing the title drops it back out.
- `piece.name` stays the movement name, so every screen that already renders
  `piece.name` keeps working unchanged. Overview shows `workName` in the
  eyebrow above it; the sidebar switcher groups movements under it.
- There is deliberately **no** rolled-up "work progress" number. Movements
  differ enormously in length and difficulty, so a single combined percentage
  would be misleading; `PartSwitcher` shows each movement's own
  measures-touched figure side by side instead. See
  [Decisions.md](Decisions.md#multi-movement-works).

Helpers live in `src/lib/works.js`: `ensureWorkId`, `partsOfWork` (siblings in
creation order), `groupPiecesByWork` (ordered groups for the switcher).

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
  this code; see [Architecture.md](Architecture.md#module-layout-the-old-suggested-refactor--now-done).
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
| Inputs | full session history: reps, tempo vs. target, recency decay, self-reported effectiveness, difficulty/recurring adjustments, a rough/lost flag cap | the chunk's spaced-repetition ladder `stage` (as of Pass 6 — see below) |
| Overridable | yes, via `manualConfidence` | no |
| Used by | Piece Map, Focus Panel, Progress ("most improved"), Analytics | Overview's "Practice progress" bar, `PartSwitcher`'s untouched-measure count |

This is a real open question, not a documented design decision — see
[Decisions.md](Decisions.md#open-questions). If you're adding a new
"how confident is the learner in this chunk" surface, check both before
assuming which one is canonical.

Worth knowing why they disagree at all: they were never designed
together. `computeConfidence` has existed since the app's very first
commit. `computeProgressTier` was added much later (commit `45414ea`,
*"Replace difficulty balance with practice progress bar on dashboard"*)
to replace an unrelated, purely static Overview panel — the piece's fixed
easy/medium/hard measure split — with a practice-progress bar, and was
originally written for that one widget using the simplest available
signal at the time (most-recent clean-rep count), not to complement or
check against confidence. The disagreement isn't drift from a shared
design; there never was one — and Pass 6 didn't unify the two, it just
gave `computeProgressTier` a better single input to work from (see
below). They can still disagree in every other way they always could
(e.g. a `manualConfidence` override with no corresponding ladder
movement) — this remains the same real, open, unresolved question.

A spaced-repetition ladder (per-chunk `stage`/`practiceBPM` state — see
[Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built](Repertoire-Lifecycle.md#stage-4--maintenance-mostly-built))
was flagged here as a related, third signal once its schema landed. The
stage-math is built (`computeLadderAdvance`, `lib/ladder.js`) and live —
every logged session advances it (`handleLogSession`, `App.jsx`).
**Confirmed inert with respect to *confidence*, deliberately**:
`computeAutoConfidence` still does not read `stage`/`consecutivePasses` at
all — a decision made explicitly while wiring the ladder in, not an
oversight, and unchanged by Pass 6. See
[Decisions.md](Decisions.md#spaced-repetition--maintenance). **It is,
however, no longer inert with respect to `computeProgressTier`**: Pass 6
rewired that function to bucket directly off `stage` instead of raw
rep-count, specifically so a chunk demoted by a rough/lost flag drops a
tier in the Overview bar the same way its confidence number drops
elsewhere — see [Algorithms.md](Algorithms.md#confidence) and
[Decisions.md](Decisions.md#spaced-repetition--maintenance) for the
reasoning. Whether the ladder eventually replaces one of the two scores
above outright, becomes a new canonical third one, or stays split exactly
like this (feeding one, not the other) long-term is still not decided —
revisit once Stage 3 ("learned") is actually defined against real data,
per that same decision.

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
it does **not** clear `progress[id].flag`, `progress[id].manualConfidence`,
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
- The 0.6×/1.4× multiplier values (originally `adaptiveReviewOffsets`'s;
  `adaptiveReviewOffsets` itself is no longer called by `computeTimeline`
  as of Pass 5, superseded by Tier 1/Tier 2 review placement — see
  [Algorithms.md#adaptive-review](Algorithms.md#adaptive-review)) and the
  confidence formula's weights are similarly hand-picked, not learned from
  outcomes. Both now key off `session.outcome` (pass/soft-miss/fail) rather
  than the old free-standing `effectiveness` self-report — see
  [Decisions.md](Decisions.md#spaced-repetition--maintenance).
- BPM zones and per-chunk difficulty reassessment both write directly into
  `piece.measureDifficulty` / `piece.bpmZones` — there's no undo history.
  Same is now true of a logged session's ladder effects: undoing a session
  (`handleUnlogSession`, `App.jsx`) removes the session record but does not
  roll back the `stage`/`practiceBPM`/etc. that session's outcome already
  advanced.
- `manualConfidence` has no recorded set-date, which is why
  `computeConfidenceAsOf` (used for "most improved this week") can't
  correctly exclude a manual override that was set *after* the historical
  cutoff being reconstructed — see [Algorithms.md](Algorithms.md#confidence).
- There is no first-class "piece is learned" state yet. The definition is
  decided (every chunk's ladder card reaching Holding), and the mechanism
  that advances `stage` is live (`computeLadderAdvance` called from
  `handleLogSession` on every logged session) — but nothing yet queries
  "is every chunk at Holding" to actually compute the piece-level "learned"
  flag itself. See
  [Repertoire-Lifecycle.md](Repertoire-Lifecycle.md#stage-3--learned-defined-not-yet-implemented).
- `piece.progress[id].doneDays.length` (surfaced in PieceMapTab as
  "Sessions logged") counts distinct days touched, not sessions logged —
  pre-existing behavior that was a distinction without a difference before
  same-day multi-session logging existed, but is now a mildly misleading
  label PieceMapTab.jsx hasn't been updated to reflect.
- `diffMode: 'simple'` and `recurringMode: 'basic'` are reachable only on
  pieces saved before their quick-count UI was removed — see
  [Decisions.md](Decisions.md#ux).
