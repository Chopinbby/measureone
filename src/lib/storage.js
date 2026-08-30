import { PIECE_KEY_PREFIX, ACTIVE_KEY } from "./constants";
import { todayISODate, addDaysISO } from "./utils";
import { reconcileMinutesPerDaySchedule } from "./scheduling";
import { isInRevival } from "./revival";

/* ------------------------------------------------------------------ */
/*  Schema versioning and migration                                   */
/* ------------------------------------------------------------------ */

const CURRENT_SCHEMA_VERSION = 1;

// Default tunable config for the spaced-repetition maintenance ladder
// (Repertoire-Lifecycle.md#stage-4--maintenance-designed-not-built) —
// stage lengths, graduation pass-counts, tempo floors, and practiceBPM
// ratchet step sizes. Hand-picked defaults, same spirit as EFFORT_TO_MIN /
// LIBERAL_FACTOR (see docs/Research.md). No editing UI reads or writes
// this yet; stored now purely so a later pass's UI is additive. Written as
// a literal default here and in Wizard.jsx's defaultPiece(), matching the
// existing pattern for `revival`'s default object rather than a shared
// constants.js export.
//
// bpmSteps.fail is -2, not the ~8-10 pullback Repertoire-Lifecycle.md
// originally sketched — overridden in conversation with the user while
// building the ladder engine (lib/ladder.js): a real fail should cost the
// same 2 BPM as a soft-miss/pass step, not a steep drop. See
// Decisions.md#spaced-repetition--maintenance.
//
// holding.intervalGrowthFactor from the original draft of this config was
// removed (not just left unused) — Holding's interval growth is driven
// entirely by the reused pass/soft-miss/fail effectiveness multiplier
// (lib/ladder.js), and a second, independent growth constant would be
// exactly the "second multiplier system" the source design doc says not
// to build. See Decisions.md#spaced-repetition--maintenance.
const DEFAULT_LADDER_CONFIG = {
  stabilizing: { intervalDays: 4, graduationPasses: 4, tempoFloorFraction: null },
  settling: { intervalDays: 7, graduationPasses: 4, tempoFloorFraction: 0.7 },
  holding: {
    startIntervalDays: 14,
    maxIntervalDays: 70,
    tempoFloorStartFraction: 0.85,
    tempoFloorStepFraction: 0.05,
    tempoFloorCapFraction: 1,
  },
  bpmSteps: { pass: 2, softMiss: -2, fail: -2 },
  // Pass 59 — the tempo-ratchet's default adaptive rate and its per-session
  // BPM cap. Replaces the flat bpmSteps.pass/softMiss deltas above with a
  // step proportional to the remaining gap to targetBPM (lib/ladder.js);
  // bpmSteps itself is untouched and stays the fallback for a chunk with no
  // targetBPM to be proportional against.
  //
  // Pass 60 — tempoAchievedThreshold and maintenanceK extend this same
  // object rather than a separate namespace. tempoAchievedThreshold (0.85,
  // adjustable up to 1.0) is the fraction of targetBPM at/above which a
  // chunk is considered to be in "tempo maintenance mode"
  // (isInTempoMaintenance, lib/ladder.js) — computed live off
  // practiceBPM/targetBPM, never persisted per chunk. maintenanceK (0.05)
  // is the small, pinned step-size rate substituted for the chunk's own
  // tracked tempoRatchetK while in that mode; the tracked rate itself keeps
  // updating underneath exactly as Pass 59 already has it
  // stepping/halving/recovering, unaffected by this substitution.
  tempoRatchet: { k: 0.3, kCapBpm: 8, tempoAchievedThreshold: 0.85, maintenanceK: 0.05 },
};

// Merges DEFAULT_LADDER_CONFIG into whatever a piece already has, field by
// field, rather than only defaulting when `ladderConfig` is missing
// entirely. A piece migrated once while `bpmSteps` didn't exist yet (saved
// back to storage with a `ladderConfig` that has stabilizing/settling/
// holding but no bpmSteps) would otherwise keep that incomplete shape
// forever — `piece.ladderConfig || DEFAULT_LADDER_CONFIG` only helps when
// the whole object is absent. computeLadderAdvance (lib/ladder.js) reads
// `ladderConfig.bpmSteps.pass/softMiss/fail` unconditionally, so a missing
// `bpmSteps` throws on the very next logged session — a real crash on
// real already-saved data, not just a theoretical gap.
export function mergeLadderConfig(existing) {
  if (!existing) return DEFAULT_LADDER_CONFIG;
  return {
    stabilizing: { ...DEFAULT_LADDER_CONFIG.stabilizing, ...existing.stabilizing },
    settling: { ...DEFAULT_LADDER_CONFIG.settling, ...existing.settling },
    holding: { ...DEFAULT_LADDER_CONFIG.holding, ...existing.holding },
    bpmSteps: { ...DEFAULT_LADDER_CONFIG.bpmSteps, ...existing.bpmSteps },
    // Pass 59 — same field-by-field reasoning as bpmSteps above: a piece
    // migrated once before tempoRatchet existed would otherwise keep an
    // incomplete ladderConfig forever, and computeLadderAdvance reads
    // ladderConfig.tempoRatchet.k/kCapBpm unconditionally. Pass 60's
    // tempoAchievedThreshold/maintenanceK ride along on this same
    // field-by-field spread automatically — no separate merge line needed
    // for them, same as bpmSteps needed none when Pass 59 added
    // tempoRatchet itself alongside it.
    tempoRatchet: { ...DEFAULT_LADDER_CONFIG.tempoRatchet, ...existing.tempoRatchet },
  };
}

// Backfills a single logged session with a real calendar date. Old sessions
// only carry `day` (a plan-day int, App.jsx:335-345), which stops being a
// stable reference frame once maintenance review runs past a piece's fixed-
// length plan (see Repertoire-Lifecycle.md's "How maintenance surfaces in
// the UI"). `startDate` anchors day 1, so a pre-existing session's date is
// reconstructed as `startDate + (day - 1)` — an approximation (doesn't
// account for non-practice/rest days), but the only data available to
// backfill from for sessions logged before this field existed.
function backfillSessionDate(session, startDate) {
  if (session.loggedDate) return session;
  const loggedDate = typeof session.day === "number" ? addDaysISO(startDate, session.day - 1) : null;
  return { ...session, loggedDate };
}

// Backfills per-chunk ladder state (stage/consecutivePasses/practiceBPM/
// nextDueDate/tier1Done — Repertoire-Lifecycle.md's "The ladder: three
// stages") onto every existing progress entry, and each entry's sessions
// with a real calendar date. Every already-saved piece has no ladder state
// to backfill from, so defaults are the ladder's "not on the ladder yet"
// values, not derived from session history — same non-destructive spirit as
// the rest of this migration. Skips the synthetic "__consolidation__" key
// (Data-Model.md#the-piece-object) since it isn't a real chunk.
function backfillProgressLadderState(progress, startDate) {
  const result = {};
  Object.entries(progress || {}).forEach(([key, entry]) => {
    if (key === "__consolidation__") {
      result[key] = entry;
      return;
    }
    // Old boolean `weakSpot` (pre-Pass-6) is read forward as the new
    // tri-state `flag`'s middle rung, 'rough' — not left orphaned once
    // `flag` becomes the only field anything actually reads. Only applies
    // when `flag` itself isn't already set, so it can never clobber a flag
    // set after this pass shipped. `weakSpot` itself isn't carried forward
    // once converted — nothing reads it anymore. See
    // Decisions.md#spaced-repetition--maintenance.
    const { weakSpot, ...entryWithoutWeakSpot } = entry;
    const flag = entry.flag !== undefined ? entry.flag : weakSpot ? "rough" : undefined;
    result[key] = {
      ...entryWithoutWeakSpot,
      flag,
      sessions: (entry.sessions || []).map((s) => backfillSessionDate(s, startDate)),
      stage: entry.stage !== undefined ? entry.stage : null,
      consecutivePasses: entry.consecutivePasses !== undefined ? entry.consecutivePasses : 0,
      // Tracks fails logged back-to-back while stage === 'stabilizing', the
      // "this was never actually consolidated" signal (ladder.js's
      // needsRelearning) — distinct from consecutivePasses, which only
      // counts passes and can't tell a 1st fail from a 2nd.
      consecutiveStabilizingFails: entry.consecutiveStabilizingFails !== undefined ? entry.consecutiveStabilizingFails : 0,
      // Persisted re-learning flag (Pass 11) — see lib/ladder.js's
      // needsRelearning. Unlike the other fields above, a piece saved
      // before this flag existed isn't backfilled to a blank default:
      // consecutiveStabilizingFails has been persisted since Pass 1, so a
      // piece already sitting at >=2 while still in Stabilizing gets the
      // flag switched on retroactively here, matching
      // Repertoire-Lifecycle.md's note that this was always possible once
      // the counter existed. Only applies when `needsRelearning` itself
      // isn't already present, so it can never override a value this pass
      // (or a later manual clear) already wrote.
      needsRelearning:
        entry.needsRelearning !== undefined
          ? entry.needsRelearning
          : entry.stage === "stabilizing" && (entry.consecutiveStabilizingFails || 0) >= 2,
      practiceBPM: entry.practiceBPM !== undefined ? entry.practiceBPM : null,
      nextDueDate: entry.nextDueDate !== undefined ? entry.nextDueDate : null,
      tier1Done: entry.tier1Done !== undefined ? entry.tier1Done : false,
      // Per-stage tempo baselines (Pass 26 follow-up, lib/ladder.js) — no
      // real per-stage history exists to reconstruct for a piece saved
      // before this field existed, so the backfill treats "right now" as
      // if the chunk just freshly entered whatever stage it's currently
      // sitting at (its own current practiceBPM), same non-destructive,
      // no-real-history-to-lose spirit as the rest of this migration. The
      // other two stages stay null — the ordinary bpmSteps.fail step
      // covers a fail into either of those until a real entry gets
      // recorded going forward. `entry.stage == null` (not yet on the
      // ladder at all) defaults to Stabilizing, same as `stage` itself
      // does everywhere else in this migration.
      stabilizingEntryBPM:
        entry.stabilizingEntryBPM !== undefined
          ? entry.stabilizingEntryBPM
          : entry.stage === "stabilizing" || entry.stage == null
          ? entry.practiceBPM ?? null
          : null,
      settlingEntryBPM:
        entry.settlingEntryBPM !== undefined
          ? entry.settlingEntryBPM
          : entry.stage === "settling"
          ? entry.practiceBPM ?? null
          : null,
      holdingEntryBPM:
        entry.holdingEntryBPM !== undefined
          ? entry.holdingEntryBPM
          : entry.stage === "holding"
          ? entry.practiceBPM ?? null
          : null,
      // Tempo-ratchet adaptive rate (Pass 59, lib/ladder.js). Backfills to
      // null, same as the entry-BPM fields above — NOT to
      // DEFAULT_LADDER_CONFIG.tempoRatchet.k, even though that's the
      // numerically correct rate for an untouched chunk. computeLadderAdvance
      // already resolves null to that same default at read time
      // (`chunkLadderState.tempoRatchetK ?? ladderConfig.tempoRatchet.k`),
      // so persisting the literal number here bought nothing — and it cost
      // real correctness elsewhere: diffImportedPiece/ladderStateDiffers
      // compares this field by `!==` against a raw (unmigrated) imported
      // piece, where an old export predating this field is `undefined`. A
      // migrated `0.3` vs. an import's missing field read as "these two
      // genuinely disagree" and forced the import-conflict picker on an
      // otherwise byte-identical re-import — reproduced directly, not
      // theoretical. `null` on both sides (`?? null` in the comparison)
      // avoids that false conflict, exactly like the entry-BPM fields
      // already do for the same reason.
      tempoRatchetK: entry.tempoRatchetK !== undefined ? entry.tempoRatchetK : null,
    };
  });
  return result;
}

// Most recent session date across every chunk, or null if nothing's ever
// been logged. Recomputed fresh on every load (like daysToLearn
// reconciliation below), not backfilled-and-locked-in like startDate,
// since new sessions keep changing what "most recent" means. Includes
// "__consolidation__" (full run-through sessions, Pass 6) — a run-through
// is a real touch on the piece, and Revival's 60+-days-untouched auto-
// trigger (Pass 7, lib/revival.js) reads this value, so excluding
// run-throughs here would make a piece practiced only via run-throughs
// look falsely stale after every reload.
function computeLastLoggedAt(progress) {
  let latest = null;
  Object.values(progress).forEach((entry) => {
    (entry.sessions || []).forEach((s) => {
      if (s.loggedDate && (!latest || s.loggedDate > latest)) latest = s.loggedDate;
    });
  });
  return latest;
}

export function validateAndMigratePiece(piece) {
  if (!piece || typeof piece !== "object") return null;

  // Ensure critical fields exist; missing optional fields are fine
  if (!piece.id || !piece.name || typeof piece.totalMeasures !== "number") {
    return null;
  }

  const startDate = piece.startDate || todayISODate();
  const progress = backfillProgressLadderState(piece.progress || {}, startDate);

  // Default missing fields to safe values (non-destructive for old data)
  const migrated = {
    ...piece,
    // Ensure nested objects exist even if old data is incomplete
    progress,
    ladderConfig: mergeLadderConfig(piece.ladderConfig),
    lastLoggedAt: computeLastLoggedAt(progress),
    // Bumped on every local mutation (App.jsx's updatePiece) and carried
    // through export/import unchanged otherwise. Lets mergeImportedPiece
    // tell "an older backup being re-imported" apart from "an intentional
    // hand-edit of a fresh export" — see mergeImportedPiece below. A piece
    // with no updatedAt yet (every piece saved before this field existed)
    // defaults to "now" rather than 0: treating pre-existing local data as
    // freshly touched is the safe direction, since the alternative (0) would
    // make it look infinitely stale and let any import silently overwrite it.
    updatedAt: piece.updatedAt || Date.now(),
    // Persisted piece-switcher/list display order (Pass 32a) — sorted on
    // instead of createdAt wherever pieces are listed. A piece saved before
    // this field existed defaults to its own createdAt value rather than a
    // freshly-computed cross-piece rank: since every other already-loaded
    // piece gets the same treatment, sorting by sortOrder reproduces exactly
    // the createdAt order those pieces already had, so nothing shuffles on
    // first load — only an explicit reorder (App.jsx's moveGroup) ever
    // moves a piece off its createdAt-derived slot after that.
    sortOrder: typeof piece.sortOrder === "number" ? piece.sortOrder : piece.createdAt || 0,
    sections: piece.sections || [{ id: "s1", name: "", start: 1, end: piece.totalMeasures }],
    bpmZones: piece.bpmZones || [],
    recordings: piece.recordings || [],
    // { id, label, url } — same shape, same backfill-on-load rule, and
    // (as of the Pass 24 follow-up) same additive-by-id import merge as
    // recordings above — see MERGE_FIELDS_HANDLED_SEPARATELY and the
    // mergeById call in mergeImportedPiece below.
    documents: piece.documents || [],
    revival: piece.revival || {
      active: false,
      startedAt: null,
      purpose: null,
      tempoLadderStartFraction: 0.6,
      reassessmentComplete: false,
      plan: null,
    },
    memoryAnchors: piece.memoryAnchors || {},
    // Pieces saved before pause/archive existed default to active.
    status: piece.status || "active",
    // Plans saved before startDate existed (or backups that predate it)
    // start "today" rather than inheriting createdAt — see getCurrentDay in
    // lib/utils for why createdAt was never a safe stand-in for day 1.
    startDate,
  };

  // A "minutes per day" piece's daysToLearn must stay derived from its
  // minutesPerDay budget, not just whatever value happened to be sitting on
  // the stored/imported object — see reconcileMinutesPerDaySchedule for why
  // this can't just live in the Wizard/Settings UI. Runs on every load, not
  // just once, since editing difficulty/measures/recurring material via
  // Settings legitimately changes how many days the same budget needs.
  return reconcileMinutesPerDaySchedule(migrated);
}

/* ------------------------------------------------------------------ */
/*  localStorage load/save, extracted into plain functions so the      */
/*  App component's effects just call these rather than touching       */
/*  localStorage directly. Every call is wrapped defensively since      */
/*  storage can be unavailable (e.g. private browsing).                 */
/* ------------------------------------------------------------------ */

export function loadPiecesFromStorage() {
  const found = {};
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PIECE_KEY_PREFIX));
    keys.forEach((key) => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const p = JSON.parse(raw);
          const migrated = validateAndMigratePiece(p);
          if (migrated) {
            found[migrated.id] = migrated;
            // Write the backfilled shape straight back so a piece the user
            // never revisits doesn't keep re-deriving (and drifting) a
            // fresh startDate on every future load — this locks it in once.
            // daysToLearn is different: it's re-checked (not just backfilled
            // once) every load since it's meant to track minutesPerDay, but
            // still only actually re-saved when reconciliation changed it.
            // !p.ladderConfig catches a piece with no ladder state yet (every
            // piece saved before this migration existed); !p.ladderConfig
            // ?.bpmSteps additionally catches a piece that already has a
            // ladderConfig but from before bpmSteps existed on it (see
            // mergeLadderConfig above) — either way the one-time backfill of
            // ladderConfig/lastLoggedAt/per-chunk ladder fields and session
            // loggedDates actually gets persisted, not just recomputed in
            // memory and discarded on the next load. !p.updatedAt catches a
            // piece saved before that field existed, same one-time-backfill
            // reasoning as startDate.
            if (
              !p.startDate ||
              !p.ladderConfig ||
              !p.ladderConfig.bpmSteps ||
              !p.updatedAt ||
              typeof p.sortOrder !== "number" ||
              migrated.daysToLearn !== p.daysToLearn
            ) {
              savePieceToStorage(migrated.id, migrated);
            }
          }
        }
      } catch (e) {
        /* skip unreadable entry */
      }
    });
  } catch (e) {
    /* storage unavailable (e.g. private browsing) */
  }
  return found;
}

export function loadActivePieceId(pieces) {
  let active = null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw) active = JSON.parse(raw);
  } catch (e) {
    /* nothing saved yet */
  }
  if (!active || !pieces[active]) {
    const ids = Object.keys(pieces);
    active = ids.length ? ids[0] : null;
  }
  return active;
}

// Returns { ok: true } or { ok: false, error } instead of swallowing the
// failure — a write that silently doesn't happen (most commonly
// QuotaExceededError, since session history only ever grows) used to be
// indistinguishable from a successful save. App.jsx surfaces a persistent
// banner when this comes back false, so a lost write is visible instead of
// discovered later as "why did my session disappear."
export function savePieceToStorage(id, piece) {
  try {
    localStorage.setItem(PIECE_KEY_PREFIX + id, JSON.stringify(piece));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function saveActivePieceIdToStorage(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, JSON.stringify(id));
    else localStorage.removeItem(ACTIVE_KEY);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function removePieceFromStorage(id) {
  try {
    localStorage.removeItem(PIECE_KEY_PREFIX + id);
  } catch (e) {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------ */
/*  Export reminder — nudges toward a backup export since this app has  */
/*  no server-side persistence at all (see CLAUDE.md's "no backend").   */
/*  App-level, not per-piece: a single export already bundles every     */
/*  piece together, so there's only one "last exported" instant to      */
/*  track, not one per piece.                                           */
/* ------------------------------------------------------------------ */

const LAST_EXPORTED_AT_KEY = "measureone-last_exported_at";
const FIRST_USE_AT_KEY = "measureone-first_use_at";
const EXPORT_REMINDER_INTERVAL_MS = 1 * 24 * 60 * 60 * 1000; // 1 day

export function loadLastExportedAt() {
  try {
    const raw = localStorage.getItem(LAST_EXPORTED_AT_KEY);
    return raw ? Number(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveLastExportedAt(timestamp) {
  try {
    localStorage.setItem(LAST_EXPORTED_AT_KEY, String(timestamp));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

// Lazily seeds the anchor the reminder falls back to for a piece/app that's
// never been exported at all — written once, the first time anything reads
// it, so a user upgrading into this feature isn't retroactively treated as
// already overdue just because they've had the app open for a while.
// Missing/unavailable storage reads as null, same conservative-no-reminder
// direction as isExportReminderDue takes below.
export function loadOrInitFirstUseAt() {
  try {
    const raw = localStorage.getItem(FIRST_USE_AT_KEY);
    if (raw) return Number(raw);
    const now = Date.now();
    localStorage.setItem(FIRST_USE_AT_KEY, String(now));
    return now;
  } catch (e) {
    return null;
  }
}

// Pure so it's cheaply unit-testable without a localStorage shim (see
// test/storage.test.mjs, which otherwise only exercises pure functions from
// this file). lastExportedAt is the anchor whenever an export has actually
// happened; firstUseAt is only consulted as a fallback for "never exported
// yet." Neither anchor available (e.g. storage unavailable entirely) means
// there's nothing to measure elapsed time against, so no reminder rather
// than a false positive.
export function isExportReminderDue(lastExportedAt, firstUseAt, now = Date.now()) {
  const anchor = lastExportedAt || firstUseAt;
  if (!anchor) return false;
  return now - anchor >= EXPORT_REMINDER_INTERVAL_MS;
}

export function downloadBackup(pieces) {
  const backup = {
    exportedAt: new Date().toISOString(),
    version: 1,
    pieces: Object.values(pieces),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `measureone-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Returns the array of pieces found in a parsed backup file, or null if the
// shape doesn't look like a backup. Throws if `rawText` isn't valid JSON —
// callers should catch that separately to show a "not valid JSON" message
// distinct from "valid JSON but no pieces in it."
export function parseBackupPieces(rawText) {
  const data = JSON.parse(rawText);
  return Array.isArray(data.pieces) ? data.pieces : Array.isArray(data) ? data : null;
}

/* ------------------------------------------------------------------ */
/*  Import matching & merging — re-importing a backup (e.g. after      */
/*  hand-editing scheduling fields in the exported JSON) should update */
/*  the piece it already matches, not create a second copy of it, and  */
/*  should never let an import that's missing/blank on some field      */
/*  silently erase what's already there — especially practice history. */
/* ------------------------------------------------------------------ */

function normalizeMatchKey(s) {
  return (s || "").trim().toLowerCase();
}

// Finds the existing piece a freshly-imported piece should merge into, if
// any. Exact id match covers the common case (re-importing your own
// previously-exported, unedited-by-hand data). Falling back to name+composer
// ("song identity") covers a piece re-created independently or shared from
// elsewhere, which would otherwise get a fresh id and show up as a duplicate
// even though it's clearly the same piece. Composer is only compared when
// both sides actually have one, so a sparse composer field on either side
// doesn't block an otherwise-obvious name match.
export function findMatchingPiece(existingPieces, imported) {
  if (existingPieces[imported.id]) return existingPieces[imported.id];
  const name = normalizeMatchKey(imported.name);
  if (!name) return null;
  const importedComposer = normalizeMatchKey(imported.composer);
  return (
    Object.values(existingPieces).find((p) => {
      if (normalizeMatchKey(p.name) !== name) return false;
      const existingComposer = normalizeMatchKey(p.composer);
      if (importedComposer && existingComposer && importedComposer !== existingComposer) return false;
      return true;
    }) || null
  );
}

// Shared rule for most piece-level fields: an imported value that's actually
// populated wins — this is what lets an intentional edit made directly in
// an exported file (e.g. changing minutesPerDay) take effect on re-import —
// but a field the import left blank, null, or empty never overwrites
// something the existing piece already has.
function preferPresent(importedVal, existingVal) {
  if (importedVal === undefined || importedVal === null) return existingVal;
  if (typeof importedVal === "string" && importedVal.trim() === "") return existingVal;
  if (Array.isArray(importedVal) && importedVal.length === 0 && Array.isArray(existingVal) && existingVal.length > 0) {
    return existingVal;
  }
  return importedVal;
}

// preferPresent alone can't tell "an intentional hand-edit of a fresh
// export" apart from "a stale backup being re-imported by accident" — both
// look like "the import has a value, use it." That distinction used to not
// exist at all: re-importing an old backup would silently revert whatever
// scalar fields it happened to carry, including piece.status (an old
// backup re-imported after pausing/archiving a piece would silently make it
// active again) and per-chunk currentBPM/targetBPM/manualConfidence. This
// wraps preferPresent with the one extra bit `mergeImportedPiece` now
// tracks: importIsStale, true when the imported piece's updatedAt predates
// the existing piece's. When stale, the preference direction flips —
// existing wins if both sides have a value, imported only fills in a gap
// existing doesn't have. Still not a schema change for most fields (no new
// "protected" list to maintain); when the import isn't stale (including the
// no-timestamp-available case, preserved for pieces saved before updatedAt
// existed), behavior is unchanged from before.
function preferByRecency(importedVal, existingVal, importIsStale) {
  return importIsStale ? preferPresent(existingVal, importedVal) : preferPresent(importedVal, existingVal);
}

// Additive merge for arrays of {id, ...} records (sections, recordings,
// bpmZones): existing entries are kept, imported entries are added or
// overlay an existing entry with the same id. Never drops an existing entry
// just because the import doesn't happen to repeat it.
function mergeById(existingList, importedList) {
  const byId = Object.fromEntries((existingList || []).map((item) => [item.id, item]));
  (importedList || []).forEach((item) => {
    if (item && item.id) byId[item.id] = { ...byId[item.id], ...item };
  });
  return Object.values(byId);
}

function mergeSessionArrays(existingSessions, importedSessions) {
  const combined = [...(existingSessions || []), ...(importedSessions || [])];
  const seen = new Set();
  return combined.filter((s) => {
    const key = JSON.stringify(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Ladder-state fields a chunk carries once it's on the spaced-repetition
// ladder (Repertoire-Lifecycle.md's "The ladder: three stages"). Ladder
// state is *derived* from practice history (computeLadderAdvance,
// lib/ladder.js), not something anyone hand-edits in an exported file the
// way minutesPerDay might be, so mergeProgress below never per-field-merges
// it the way it does most other fields — it's always taken wholesale from
// one side or the other (see `ladderChoice` on mergeProgress/
// mergeImportedPiece and `diffImportedPiece` below for how that side gets
// picked). "__consolidation__" (Pass 6 run-through sessions) isn't a real
// chunk and carries none of these, so callers skip it rather than compare it.
const LADDER_STATE_FIELDS = [
  "stage",
  "consecutivePasses",
  "consecutiveStabilizingFails",
  "practiceBPM",
  "nextDueDate",
  "tier1Done",
  // Pass 26 follow-up (lib/ladder.js) — flat scalars, so `!==` below still
  // does a correct comparison, unlike it would for a nested object.
  "stabilizingEntryBPM",
  "settlingEntryBPM",
  "holdingEntryBPM",
  // Pass 59 (lib/ladder.js) — same flat-scalar treatment as the three
  // entryBPM fields above.
  "tempoRatchetK",
];

// True when the existing piece and a freshly-imported candidate actually
// disagree on ladder state for some chunk *both* sides have progress on —
// the one situation `diffImportedPiece` (below) can't resolve by `updatedAt`
// alone. A chunk only one side has touched is never a conflict (mergeProgress
// just takes that side's entry outright, same as it always has), so only
// chunks present on both sides are compared. `null`/`undefined` on a field
// are treated as the same "not set" value so a field that's merely absent on
// one side (e.g. an older export) doesn't register as a false conflict.
function ladderStateDiffers(existingProgress, importedProgress) {
  const existing = existingProgress || {};
  const imported = importedProgress || {};
  return Object.keys(existing).some((chunkId) => {
    if (chunkId === "__consolidation__") return false;
    const e = existing[chunkId];
    const i = imported[chunkId];
    if (!e || !i) return false;
    return LADDER_STATE_FIELDS.some((field) => (e[field] ?? null) !== (i[field] ?? null));
  });
}

// Pass 13: resolves the open question logged in Decisions.md — a chunk's
// ladder state used to always keep the existing piece's value on import,
// silently wrong when the *imported* backup was actually the more-advanced
// copy (e.g. restoring from a second device practiced on more recently).
// Whenever `updatedAt` alone can tell which side is ahead, that's a "clean"
// case (one side is unambiguously a stale copy of the other) and is resolved
// automatically here — same spirit as `preferByRecency` already applies to
// status/BPM/confidence, just extended to ladder state, which that mechanism
// never covered. Only a genuine tie (including both sides missing
// `updatedAt` entirely) combined with real per-chunk ladder differences
// counts as actual divergence: `resolution` comes back null, and the caller
// (ImportPiecesModal) is expected to ask the user which side to keep rather
// than silently picking one.
export function diffImportedPiece(existing, imported) {
  const existingUpdatedAt = typeof existing.updatedAt === "number" ? existing.updatedAt : 0;
  const importedUpdatedAt = typeof imported.updatedAt === "number" ? imported.updatedAt : 0;

  if (importedUpdatedAt < existingUpdatedAt) return { hasDivergence: false, resolution: "existing" };
  if (importedUpdatedAt > existingUpdatedAt) return { hasDivergence: false, resolution: "imported" };

  if (ladderStateDiffers(existing.progress, imported.progress)) {
    return { hasDivergence: true, resolution: null };
  }
  return { hasDivergence: false, resolution: "existing" };
}

// Practice history is the one thing that must never silently disappear, so
// it merges per chunk and per session rather than one side replacing the
// other outright — e.g. sessions logged in the app after a backup was
// exported (but before it was hand-edited and re-imported) survive the
// re-import instead of being wiped by the now-stale exported snapshot.
// `importIsStale` (see preferByRecency above) governs currentBPM/targetBPM/
// manualConfidence the same way it governs piece-level fields in
// mergeImportedPiece — those three are the per-chunk fields a stale import
// could otherwise silently roll back (e.g. a manual confidence override set
// today, reverted by re-importing last month's export).
//
// `ladderChoice` ("existing" or "imported") says which side's whole-piece
// ladder state (see LADDER_STATE_FIELDS above) wins for every chunk both
// sides have progress on — resolved automatically by `diffImportedPiece`
// when updatedAt alone can decide it, or by the user's explicit pick in
// ImportPiecesModal when it's real divergence. It's a single per-piece
// choice, not per chunk (see Decisions.md — deliberately not built more
// granular than that).
function mergeProgress(existingProgress, importedProgress, importIsStale, ladderChoice) {
  const existing = existingProgress || {};
  const imported = importedProgress || {};
  const merged = {};
  new Set([...Object.keys(existing), ...Object.keys(imported)]).forEach((chunkId) => {
    const e = existing[chunkId];
    const i = imported[chunkId];
    if (!e) { merged[chunkId] = i; return; }
    if (!i) { merged[chunkId] = e; return; }
    const ladderSource = ladderChoice === "imported" ? i : e;
    merged[chunkId] = {
      ...e,
      ...i,
      doneDays: [...new Set([...(e.doneDays || []), ...(i.doneDays || [])])].sort((a, b) => a - b),
      sessions: mergeSessionArrays(e.sessions, i.sessions),
      currentBPM: preferByRecency(i.currentBPM, e.currentBPM, importIsStale),
      targetBPM: preferByRecency(i.targetBPM, e.targetBPM, importIsStale),
      manualConfidence: preferByRecency(i.manualConfidence, e.manualConfidence, importIsStale),
      flag: i.flag !== undefined ? i.flag : e.flag,
      stage: ladderSource.stage,
      consecutivePasses: ladderSource.consecutivePasses,
      consecutiveStabilizingFails: ladderSource.consecutiveStabilizingFails,
      practiceBPM: ladderSource.practiceBPM,
      nextDueDate: ladderSource.nextDueDate,
      tier1Done: ladderSource.tier1Done,
      stabilizingEntryBPM: ladderSource.stabilizingEntryBPM,
      settlingEntryBPM: ladderSource.settlingEntryBPM,
      holdingEntryBPM: ladderSource.holdingEntryBPM,
      tempoRatchetK: ladderSource.tempoRatchetK,
      // Undo-scratch data for "revert this chunk's schedule if the flag gets
      // cleared" (see App.jsx's handleSetFlag) — always the existing side,
      // not something an exported file should be trusted to set, and not
      // part of "ladder state" a user would consciously choose between.
      flagSnapshot: e.flagSnapshot,
    };
  });
  return merged;
}

const MERGE_FIELDS_HANDLED_SEPARATELY = [
  "id", "createdAt", "workId", "progress", "sections", "recordings", "documents",
  "bpmZones", "revival", "memoryAnchors", "measureDifficulty", "totalMeasures",
  // sortOrder is display arrangement, not "data" in the sense preferByRecency
  // was built for — an unstale re-import silently reshuffling the switcher
  // (e.g. syncing a backup from a second device after manually reordering
  // here) shouldn't win just because its updatedAt happens to be newer. Left
  // to the same explicit existing/imported choice as ladder state, not
  // recency — see orderChoice below.
  "sortOrder",
];

// Merges a freshly-imported piece into the existing piece it matched,
// non-destructively — see the field-level helpers above for the reasoning
// on each piece. Caller is responsible for re-deriving workId (ensureWorkId)
// and clearing rescheduleMarker afterward, same as any other schedule edit.
//
// importIsStale: whether the imported snapshot predates whatever's already
// on this device, by piece.updatedAt (bumped on every local mutation —
// App.jsx's updatePiece). Missing timestamp on either side reads as 0, so:
// an import with no updatedAt at all (a backup exported before this field
// existed) is always treated as stale against a piece that has one — the
// conservative direction, since there's no way to actually know its age;
// an existing piece with no updatedAt yet (shouldn't happen once loaded
// through validateAndMigratePiece, which backfills it) never counts an
// import as stale, since there's nothing to protect. This is what fixes the
// "importing an older backup silently overwrites newer progress" failure
// mode — previously *any* field the import had a value for won outright,
// including piece.status (silently un-pausing/un-archiving a piece) and
// per-chunk currentBPM/targetBPM/manualConfidence.
//
// ladderChoice ("existing" or "imported", default "existing"): which side's
// ladder state wins for chunks both sides have progress on — see
// diffImportedPiece/mergeProgress above. Defaults to "existing" so a caller
// that doesn't pass one at all (including every pre-Pass-13 call site and
// test) gets exactly the behavior this function always had.
//
// orderChoice ("existing" or "imported", default "existing"): which side's
// sortOrder (Pass 32a) wins for a matched piece. A single per-import choice,
// not per-piece like ladderChoice — order is a whole-list arrangement, not
// independent per-chunk data, so there's no meaningful "divergence" to
// detect per row the way diffImportedPiece does for ladder state; the user
// just picks once in ImportPiecesModal and it applies to every matched
// piece in that import. Defaults to "existing" so an import never silently
// reshuffles the switcher — an imported sortOrder only ever applies when the
// user explicitly asks for it, and even then only if the import actually
// carries one (a pre-Pass-32 backup has no sortOrder to apply, so this falls
// back to existing regardless of the choice).
export function mergeImportedPiece(existing, imported, ladderChoice = "existing", orderChoice = "existing") {
  const importedUpdatedAt = typeof imported.updatedAt === "number" ? imported.updatedAt : 0;
  const existingUpdatedAt = typeof existing.updatedAt === "number" ? existing.updatedAt : 0;
  const importIsStale = importedUpdatedAt < existingUpdatedAt;

  const merged = { ...existing };

  Object.keys(imported).forEach((key) => {
    if (MERGE_FIELDS_HANDLED_SEPARATELY.includes(key)) return;
    merged[key] = preferByRecency(imported[key], existing[key], importIsStale);
  });
  // Whichever side is more recent should win going forward regardless of
  // which fields above changed — otherwise a stale import (imported.updatedAt
  // preserved as-is) could make this piece look older than it actually is on
  // the very next comparison.
  merged.updatedAt = Math.max(importedUpdatedAt, existingUpdatedAt) || undefined;

  merged.sortOrder =
    orderChoice === "imported" && typeof imported.sortOrder === "number" ? imported.sortOrder : existing.sortOrder;

  // totalMeasures and measureDifficulty must move together — mixing sources
  // would leave measureDifficulty the wrong length for totalMeasures.
  if (imported.totalMeasures && imported.measureDifficulty && imported.measureDifficulty.length && !importIsStale) {
    merged.totalMeasures = imported.totalMeasures;
    merged.measureDifficulty = imported.measureDifficulty;
  }

  merged.sections = mergeById(existing.sections, imported.sections);
  merged.recordings = mergeById(existing.recordings, imported.recordings);
  merged.documents = mergeById(existing.documents, imported.documents);
  merged.bpmZones = mergeById(existing.bpmZones, imported.bpmZones);
  merged.memoryAnchors = { ...(existing.memoryAnchors || {}), ...(imported.memoryAnchors || {}) };
  merged.progress = mergeProgress(existing.progress, imported.progress, importIsStale, ladderChoice);
  // An in-progress revival is live session state — protect it from being
  // overwritten by a stale import even if the import's revival looks
  // "present" by the generic rule above.
  merged.revival = isInRevival(existing) ? existing.revival : (imported.revival || existing.revival);

  merged.id = existing.id;
  merged.createdAt = existing.createdAt;

  return merged;
}
