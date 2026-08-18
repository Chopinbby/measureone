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
> `src/components/Wizard.jsx` is the single most likely way these docs go
> stale — check it first when auditing.

## The piece object

Everything hangs off a **piece**. The app can hold multiple pieces; each is
stored under its own `localStorage` key (`measureone-piece:<id>`), and
`measureone-active_piece_id` tracks which one is currently open. Two more
app-level (not per-piece) keys exist purely to drive the export-reminder
banner (**Pass 12** — `lib/storage.js`; see
[Decisions.md](Decisions.md#data-model)): `measureone-last_exported_at`
(epoch ms, written whenever a backup export actually completes) and
`measureone-first_use_at` (epoch ms, lazily seeded the first time anything
reads it — the fallback anchor for "never exported yet," so upgrading into
this feature doesn't make a long-time user look instantly overdue).

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
                         // this (startDate through targetDate, inclusive).
                         // NOT itself read by the scheduler (computeTimeline
                         // only ever reads daysToLearn) — it's a UI-facing
                         // input that ScheduleFields.jsx's own effect turns
                         // into daysToLearn, only in 'days' mode. A feature
                         // that writes targetDate expecting the schedule to
                         // change on its own, without also writing
                         // daysToLearn, will silently do nothing — found the
                         // hard way while building the reschedule "extend
                         // the plan" feature (Decisions.md#scheduling). In
                         // 'minutes' mode this field is carried along inert;
                         // nothing reads or derives from it.
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
  documents,             // [{ id, label, url }] — same shape and purpose as recordings, for reference
                         // documents (sheet music PDF, fingerings, program notes) hosted elsewhere —
                         // Drive, Dropbox, IMSLP. Pass 24. Purely a link out: the file itself is never
                         // fetched, stored, or rendered by the app — no upload, no in-app viewer, no
                         // annotation. That's a separate, much larger feature (real file storage —
                         // IndexedDB or a backend, not localStorage) deliberately deferred, not designed
                         // here — see Roadmap.md if adding it later.
  createdAt,             // epoch ms — when this piece record was created in this
                         // browser/instance. Sort-order bookkeeping only (piece
                         // switcher, work grouping) — NOT the scheduling anchor;
                         // see startDate above for that.
  sortOrder,             // number — persisted display order for the piece switcher
                         // and any other piece-listing surface (Pass 32a); these sort
                         // by this instead of createdAt. User-reorderable via
                         // up/down controls on each switcher row (App.jsx's
                         // moveGroup), which re-rank every piece to a fresh 0..n-1
                         // sequence on each move. A piece saved before this field
                         // existed defaults to its own createdAt (validateAndMigratePiece,
                         // lib/storage.js) so migration reproduces the existing
                         // createdAt order rather than shuffling on first load.
                         // Reordering only ever moves a *switcher row* — a
                         // standalone piece, or an entire multi-movement work as one
                         // block — not individual movements within a work: which
                         // movement shows first inside a work is still governed by
                         // createdAt via groupPiecesByWork/partsOfWork
                         // (src/lib/works.js), untouched by this field. That's
                         // deliberate, not an oversight — see the "Works" section
                         // below for why contiguity already falls out of workId
                         // grouping without sortOrder needing to know works exist.
                         // On import (ImportPiecesModal/mergeImportedPiece,
                         // lib/storage.js), sortOrder is deliberately NOT governed
                         // by the usual updatedAt-recency rule every other scalar
                         // field uses — display arrangement isn't "data" in that
                         // sense, so an unstale re-import (e.g. syncing a backup
                         // from a second device right after manually reordering
                         // here) must never silently reshuffle the switcher just
                         // because its timestamp happens to be newer. Instead it's
                         // a single explicit user choice per import ("Keep what's
                         // here" / "Use the imported order"), applied uniformly to
                         // every matched piece — same spirit as ladderChoice, but
                         // one choice for the whole import rather than per piece,
                         // since order is a whole-list arrangement, not independent
                         // per-piece data. Defaults to "existing" so an import
                         // never moves anything unless the user asks it to.
  updatedAt,             // epoch ms — bumped on every local mutation (App.jsx's
                         // updatePiece, the single funnel every piece change goes
                         // through per CLAUDE.md). Exists to let mergeImportedPiece
                         // (lib/storage.js) tell "this device has moved on since this
                         // backup was exported" apart from "this file really is the
                         // newer copy," when re-importing — see Decisions.md#data-model.
                         // Since Pass 13, also the sole input to diffImportedPiece's
                         // ladder-state divergence check (Algorithms.md#import-merge):
                         // strictly newer wins outright on either side; only an exact
                         // tie (or both missing) falls back to comparing actual
                         // per-chunk ladder content.
                         // Missing on pieces saved before this field existed;
                         // backfilled to "now" on the next load (validateAndMigratePiece,
                         // lib/storage.js), the same one-time-backfill treatment
                         // startDate gets. Unlike lastLoggedAt, this tracks *any* edit
                         // (settings changes, flags, pause/archive), not just logged
                         // practice sessions.
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
                         // informational (displayed on Piece Overview), not used by any automatic
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
                         // computeTimeline places each chunk's next review — see "Ladder config"
                         // below and Algorithms.md#session-outcomes--the-maintenance-ladder.
  memoryAnchors,         // { [id]: string } — free-text cue ("descending sequence", "watch
                         // left-hand leap") keyed by *either* a practice-chunk/transition id or a
                         // piece.sections id. One flat map because chunk ids (`c…`/`t_…`) and
                         // section ids (`s…`) never collide. Editable from the Piece Map modal, and
                         // (since Pass 23) inline from ChecklistItem during ordinary learning-phase
                         // logging too — same field, same component (MemoryAnchorField), just a
                         // second entry point. Labeled "Notes" in the UI as of Pass 23 (was "Memory
                         // anchor"); the field/prop names on this object are unchanged. Read
                         // (read-only where no write handler is passed) in ChecklistItem across every
                         // caller — normal practice, maintenance due-review, and revival alike.
  revival,               // see #revival below
}

ChunkProgress = {
  doneDays: number[],       // plan-day numbers this chunk was marked done on at least once —
                            // a count of distinct DAYS touched, not of sessions logged (see
                            // sessions below; PieceMapTab's "Sessions logged" reads this field
                            // and is really showing days-touched, a pre-existing label that
                            // predates same-day multi-session support and hasn't been
                            // reworded — a known small inaccuracy, not a bug).
  sessions: [{              // one entry per LOGGED ATTEMPT (see skipped/provisional below for
                            // two exceptions to "judged attempt"), most recent last. Multiple
                            // entries can now share the same `day` (a Tier 1 touch, a due review, a
                            // re-attempt) — never overwritten by day alone; see loggedAt below.
    day, loggedAt, loggedDate, cleanReps, bpm, outcome, durationSeconds, ladderSnapshot,
    skipped, provisional,  // both optional booleans, Pass 29/29-follow-up, Interleaved mode only —
                            // see below and Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29.
                            // Never both true on the same record.
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
                            // ladderSnapshot ({ stage, consecutivePasses,
                            // consecutiveStabilizingFails, practiceBPM, nextDueDate, tier1Done,
                            // needsRelearning, currentBPM, stabilizingEntryBPM, settlingEntryBPM,
                            // holdingEntryBPM } | undefined, Pass 10; needsRelearning added Pass 11,
                            // currentBPM added Pass 14, the three entry-BPM fields added Pass 26
                            // follow-up) — the eleven ladder fields below, captured as they
                            // stood immediately BEFORE this session was logged. Stored per-session
                            // (not on the chunk entry) so same-day multi-session logging keeps
                            // each session's own "before" picture distinct — same
                            // snapshot-and-restore shape `flagSnapshot` below already uses.
                            // handleUnlogSession (App.jsx) restores it when undoing this session,
                            // but ONLY when it's this chunk's most recent session overall — undoing
                            // an earlier session while a later one still stands would silently
                            // erase that later session's effects, so that case (and any session
                            // logged before this field existed, which carries no snapshot) falls
                            // back to removing the record only. The validity check that gates this
                            // restore still only requires the original six fields (not
                            // needsRelearning, currentBPM, or the three entry-BPM fields) — a
                            // snapshot missing needsRelearning entirely (any session logged before
                            // Pass 11) restores it as false rather than failing validation, since
                            // false was correct for every such snapshot anyway (the flag didn't
                            // exist yet to be true). currentBPM (Pass 14) and the three entry-BPM
                            // fields (Pass 26 follow-up) are optional for the same
                            // backward-compatibility reason but have NO correct constant to fall
                            // back to — an older snapshot simply never recorded them — so a
                            // snapshot missing any of them leaves that field untouched rather than
                            // inventing a value. See Decisions.md#spaced-repetition--maintenance.
                            //
                            // `skipped: true` (Pass 29, Interleaved mode's "skip, just save time")
                            // — no cleanReps/bpm/outcome/ladderSnapshot at all, just day/loggedAt/
                            // loggedDate/durationSeconds. Records that time was spent without
                            // judging it: does NOT add `day` to doneDays above, does NOT run
                            // computeLadderAdvance. `provisional: true` (Pass 29 follow-up) — the
                            // opposite trade: DOES carry a real cleanReps/bpm/outcome (an
                            // auto-classified soft-miss/fail from an interleaved attempt), but
                            // still doesn't touch doneDays or the ladder until
                            // handleConfirmProvisionalSession flips it to `provisional: false` and
                            // stamps a ladderSnapshot at that point (or
                            // handleDiscardProvisionalSession removes the record outright).
                            // Every reader that treats `sessions` as evidence of *judged* practice
                            // — confidence scoring, ladder-status display, the Progress tab's
                            // stats — reads through lib/utils.js's `loggedSessions(sessions)`
                            // (`!s.skipped && !s.provisional`) rather than this raw array.
                            // `sumPracticeSeconds` (total time practiced) deliberately does NOT
                            // filter — a skipped or still-provisional session's time still counts.
                            // See Repertoire-Lifecycle.md#interleaved-practice-mode-built-pass-29
                            // and Decisions.md#spaced-repetition--maintenance.
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
                              // lib/ladder.js's applyRunThroughFlag — see "Ladder config" below.
                              // Also caps computeConfidence's result (55 for rough, 20 for lost,
                              // applied after either the manual or auto branch) so a flagged
                              // chunk can't show stale-high confidence anywhere it's displayed —
                              // see Algorithms.md#confidence. `needsRelearning` below caps the same
                              // way (also 20) via a completely separate field — the two caps combine
                              // via Math.min rather than either overriding the other. Indirectly affects
                              // computeProgressTier too, via the `stage` demotion above rather
                              // than reading `flag` itself — a flagged chunk drops a Practice
                              // Progress tier on Piece Overview through the same mechanism, not a
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
                              // mind" on the flag. Symmetrically, handleUnlogSession (Pass 10)
                              // clears both `flag` and `flagSnapshot` when it fully reverses a
                              // session — flagSnapshot still being present at undo time proves
                              // (via the same clear-on-log rule above) the flag was applied after
                              // that session with nothing logged since, so undoing the session
                              // undoes the flag with it rather than leaving it pointing at a
                              // ladder state that no longer exists. Backup-merge (storage.js's
                              // mergeProgress) always keeps the existing piece's value here,
                              // unconditionally — unlike the actual ladder fields below (since
                              // Pass 13, those follow diffImportedPiece/ladderChoice instead, see
                              // Algorithms.md#import-merge), this is undo-scratch data an imported
                              // file was never meant to set, so there's no "which side should win"
                              // question to resolve for it at all. handleSetFlag verifies all
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
                              // See "Ladder config" below.
  consecutivePasses,          // number, default 0 — consecutive full passes at the current stage
                               // that cleared that stage's tempo floor. Live, via
                               // computeLadderAdvance on every logged session (see stage above).
  consecutiveStabilizingFails, // number, default 0 — fails logged back-to-back while
                                // stage === 'stabilizing'. Distinct from consecutivePasses, which
                                // only counts passes and can't tell a 1st fail from a 2nd (a fail
                                // always resets it to 0). Drives needsRelearning below: hitting 2
                                // sets it. Reset to 0 by any pass, and also by a manual
                                // needsRelearning clear (handleClearRelearning, App.jsx) — see that
                                // field for why the manual clear needed this too.
  needsRelearning,             // boolean, default false — the "this was never actually
                                // consolidated" re-learning signal (Pass 11), set the moment
                                // consecutiveStabilizingFails hits 2. Unlike stage/practiceBPM/etc,
                                // this is a STICKY flag: computeLadderAdvance reads it back in via
                                // chunkLadderState.needsRelearning on every call and carries it
                                // forward unchanged (fail or soft-miss) until either a graduating
                                // pass clears it automatically or a manual clear
                                // (handleClearRelearning, App.jsx — resets consecutiveStabilizingFails
                                // to 0 too, confirmed with the user, so a manual clear doesn't leave
                                // the chunk one fail away from instantly re-flagging) clears it by
                                // hand. While true: computeTimeline (lib/scheduling.js) and
                                // computeDueReviews (lib/maintenance.js) both skip this chunk
                                // outright, regardless of nextDueDate — see nextDueDate below;
                                // computeConfidence caps displayed confidence at 20, same value and
                                // mechanism as a 'lost' flag (see `flag` above), independently
                                // combined via Math.min if both happen to be set. Confirmed NOT
                                // wired to Revival — chunk-scoped, Revival's triggers are piece-wide.
                                // User-facing label: "Needs reinforcement" (Piece Map grid icon +
                                // chunk detail modal), deliberately never the word "lost," since the
                                // material may never have been consolidated in the first place. See
                                // Repertoire-Lifecycle.md#the-short-structured-re-learning-pass-built
                                // and Decisions.md#spaced-repetition--maintenance.
  practiceBPM,                // number | null — the tempo the ladder is currently asking for on
                               // this chunk, distinct from targetBPM (the eventual goal). Seeded
                               // from whatever the learner actually logs the first time they touch
                               // a chunk — the USER-SELECTED starting tempo, one of three distinct
                               // tempo concepts (suggested / user-selected / demonstrated) split
                               // apart in lib/confidence.js's getSuggestedStartingBPM block comment
                               // and Algorithms.md#starting-suggested-and-demonstrated-tempo. Then
                               // ratchets via ladderConfig.bpmSteps (+2 pass / -2 soft-miss / -2
                               // fail) on every logged session — except a session with 3+ clean
                               // reps at a bpm above the current value jumps practiceBPM straight
                               // to that bpm instead (computeDemonstratedTempoBaseline,
                               // lib/ladder.js), the third ("demonstrated") tempo concept.
                               // Two more exceptions on a real fail: (Pass 11) the exact fail that
                               // turns needsRelearning on resets practiceBPM to
                               // getSuggestedStartingBPM instead, when that suggestion is available;
                               // otherwise (Pass 26 follow-up) a real fail resets practiceBPM to
                               // stabilizingEntryBPM/settlingEntryBPM/holdingEntryBPM (below) for
                               // whichever stage it demotes INTO, falling back to the ordinary -2
                               // step only when nothing's recorded there yet. Rule priority:
                               // needsRelearning's reset wins outright over the entry-tempo one when
                               // both would apply.
  stabilizingEntryBPM,         // number | null, default null (Pass 26 follow-up) — the practiceBPM
  settlingEntryBPM,            // this chunk had the moment it most recently, freshly entered each
  holdingEntryBPM,             // named stage (via promotion, or the chunk's very first-ever session
                                // for stabilizingEntryBPM specifically — that call IS Stabilizing's
                                // first entry). A real fail resets practiceBPM to the value recorded
                                // here for the stage it demotes INTO — see practiceBPM above and
                                // lib/ladder.js's computeLadderAdvance. Three flat scalar fields, not
                                // one nested object: storage.js's ladderStateDiffers/mergeProgress
                                // compare every ladder field with `!==`, which is reference equality
                                // for an object (always "different" across a fresh JSON parse even
                                // with identical contents) — flat scalars compare correctly by value,
                                // same as every other ladder field already does. A piece migrated
                                // from before this field existed backfills each null except the one
                                // matching its current stage, seeded from its current practiceBPM —
                                // see storage.js's backfillProgressLadderState. See
                                // Decisions.md#spaced-repetition--maintenance.
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
                                // Both readers check needsRelearning FIRST and skip the chunk if
                                // true, regardless of what this value holds — a flagged chunk's
                                // nextDueDate still gets pinned to today the moment the flag turns
                                // on (see needsRelearning above), but that value is never actually
                                // surfaced anywhere while the flag is set; it's what a manual clear
                                // resumes review against.
  tier1Done,                   // boolean, default false — whether the one-time first-touch review
                                // (Repertoire-Lifecycle.md's "Tier 1") has happened for this chunk.
                                // Read/passed through unchanged by computeLadderAdvance; still
                                // never set true by anything. Pass 5's Tier 1 scheduling is a live,
                                // recomputed-every-time decision (stage:null and zero sessions) —
                                // it doesn't write back to this field, so tier1Done stays
                                // permanently false and unused even now that Tier 1 itself exists.
}
```

### Ladder config (`piece.ladderConfig`)

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

`groupPiecesByWork` groups a work's movements together the moment it meets
the first one in the (now `sortOrder`-sorted, Pass 32a) piece list — a group's
position follows wherever its earliest-appearing movement sits, and every
movement joins that same group regardless of its own `sortOrder`. So a work's
movements stay visually contiguous in the switcher "for free," without
`sortOrder` or its reorder UI needing any work-specific logic — see
`sortOrder` above.

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
separately by `computeSectionRunThroughs()`, since they aren't scheduled to
a specific day.

### `piece.progress` keys are not guaranteed to exist in the chunk set

This is the trap that caused a real crash (Pass 20), and it follows directly
from the split above. **`piece.progress` is persisted; the chunk set is
re-derived from `piece` on every render.** So a key in `piece.progress` may
have no matching entry in `generateAllChunks(...).all`, for three distinct
reasons:

- **`__consolidation__`** — a synthetic key for whole-piece run-throughs
  (`handleLogRunThrough`), never a chunk at all. Long-established; most code
  that walks `piece.progress` already special-cases it explicitly.
- **`sr_<sectionId>`** — a section run-through. Logging one writes a normal
  progress entry under this id, but per the paragraph above it is *never* in
  `all`, on any piece. **This is not an edge case** — it happens the first
  time any user ticks off a section run-through.
- **Genuinely stale ids** — editing measures, sections, or difficulty
  regenerates chunk ids, orphaning progress entries logged before the edit.
  Nothing prunes them, deliberately: they're the only record that the
  practice happened.

**Any code that iterates `piece.progress` keys and looks them up against the
chunk set must handle a miss.** Code that iterates `timeline.days[]` ids
instead is safe by construction, since the timeline is derived from the same
chunk set — that's why `TimelineTab`, `OverviewTab` and `DayChecklist` need
no guard while `ProgressTab`'s history did. `computePracticeHistory`
(`lib/history.js`) is the worked example of handling all three; see
[Algorithms.md](Algorithms.md#practice-history-labels).

## The two "how good is this chunk" scores — don't conflate them

There are two independent scores, computed differently, used in different
places, and they can disagree:

| | `computeConfidence` | `computeProgressTier` |
|---|---|---|
| Shape | continuous 0–100 | one of `untouched / learned / comfortable / mastered` |
| Inputs | full session history: reps, tempo vs. target, recency decay, self-reported effectiveness, difficulty/recurring adjustments, a rough/lost flag cap | the chunk's spaced-repetition ladder `stage` (as of Pass 6 — see below) |
| Overridable | yes, via `manualConfidence` | no |
| Used by | Piece Map, Focus Panel, Progress ("most improved" and the confidence-by-difficulty bars) | Overview's "Practice progress" bar, `PartSwitcher`'s untouched-measure count |

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
  active,                    // boolean — an entry/reassessment/plan cycle is in progress.
                              // NEVER read this field directly to ask "is this piece in
                              // revival" — call isInRevival(piece) (lib/revival.js), the
                              // single source of truth every gate in the app routes
                              // through. See Algorithms.md#isinrevival--one-definition-of-in-revival
  startedAt,                 // epoch ms | null — a TIMESTAMP, not a second in-revival flag.
                              // Set and cleared in lockstep with `active`, but its actual
                              // job is being the cutoff computeComboEscalations uses to
                              // decide which logged sessions belong to the current run.
                              // That is the only thing that should read it
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

`handleEndRevival` resets this object back to its `active: false` defaults
(clearing `startedAt` in the same write); it does **not** clear
`progress[id].flag`, `progress[id].manualConfidence`, or
`piece.memoryAnchors` — those are treated as durable chunk metadata, not
scoped to a single revival cycle.

**`active` and `startedAt` always move together** — `handleStartRevival`
sets both, `handleEndRevival` clears both — so no code should ever need to
check both, and none does. `isInRevival(piece)` is the one function that
answers "is this piece in revival"; `startedAt` is read only as a
timestamp, by `computeComboEscalations`. One caveat worth knowing before
touching migration: `validateAndMigratePiece` restores this object
**all-or-nothing** (`piece.revival || {…defaults}`), unlike `ladderConfig`,
which gets a field-by-field `mergeLadderConfig`. A *partial* `revival`
object therefore keeps its holes. Not reachable through normal use, but
logged as an open issue — see
[Decisions.md](Decisions.md#open-questions).

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
  `piece.measureDifficulty` / `piece.bpmZones` — there's no undo history,
  and none is planned; this is an accepted simplification, not a defect.
  **A logged session's ladder effects are a different story — resolved,
  not a simplification.** Undoing a session (`handleUnlogSession`,
  `App.jsx`) now fully reverses `stage`/`practiceBPM`/`nextDueDate`/every
  other ladder field it advanced, via the `ladderSnapshot` each session
  carries (Pass 10, built) — see
  [Algorithms.md](Algorithms.md#session-outcomes--the-maintenance-ladder)
  for the exact mechanics, including which fields are required for a full
  reversal versus optional/backward-compatible.
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
