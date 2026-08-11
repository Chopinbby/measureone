import { PIECE_KEY_PREFIX, ACTIVE_KEY } from "./constants";
import { todayISODate, addDaysISO } from "./utils";
import { reconcileMinutesPerDaySchedule } from "./scheduling";

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
      practiceBPM: entry.practiceBPM !== undefined ? entry.practiceBPM : null,
      nextDueDate: entry.nextDueDate !== undefined ? entry.nextDueDate : null,
      tier1Done: entry.tier1Done !== undefined ? entry.tier1Done : false,
    };
  });
  return result;
}

// Most recent session date across every chunk, or null if nothing's ever
// been logged. Recomputed fresh on every load (like daysToLearn
// reconciliation below), not backfilled-and-locked-in like startDate,
// since new sessions keep changing what "most recent" means.
function computeLastLoggedAt(progress) {
  let latest = null;
  Object.entries(progress).forEach(([key, entry]) => {
    if (key === "__consolidation__") return;
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
    sections: piece.sections || [{ id: "s1", name: "", start: 1, end: piece.totalMeasures }],
    bpmZones: piece.bpmZones || [],
    recordings: piece.recordings || [],
    revival: piece.revival || {
      active: false,
      startedAt: null,
      purpose: null,
      performanceTempo: null,
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
            // memory and discarded on the next load.
            if (!p.startDate || !p.ladderConfig || !p.ladderConfig.bpmSteps || migrated.daysToLearn !== p.daysToLearn) {
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

export function savePieceToStorage(id, piece) {
  try {
    localStorage.setItem(PIECE_KEY_PREFIX + id, JSON.stringify(piece));
  } catch (e) {
    /* storage unavailable */
  }
}

export function saveActivePieceIdToStorage(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, JSON.stringify(id));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (e) {
    /* storage unavailable */
  }
}

export function removePieceFromStorage(id) {
  try {
    localStorage.removeItem(PIECE_KEY_PREFIX + id);
  } catch (e) {
    /* storage unavailable */
  }
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

// Practice history is the one thing that must never silently disappear, so
// it merges per chunk and per session rather than one side replacing the
// other outright — e.g. sessions logged in the app after a backup was
// exported (but before it was hand-edited and re-imported) survive the
// re-import instead of being wiped by the now-stale exported snapshot.
function mergeProgress(existingProgress, importedProgress) {
  const existing = existingProgress || {};
  const imported = importedProgress || {};
  const merged = {};
  new Set([...Object.keys(existing), ...Object.keys(imported)]).forEach((chunkId) => {
    const e = existing[chunkId];
    const i = imported[chunkId];
    if (!e) { merged[chunkId] = i; return; }
    if (!i) { merged[chunkId] = e; return; }
    merged[chunkId] = {
      ...e,
      ...i,
      doneDays: [...new Set([...(e.doneDays || []), ...(i.doneDays || [])])].sort((a, b) => a - b),
      sessions: mergeSessionArrays(e.sessions, i.sessions),
      currentBPM: preferPresent(i.currentBPM, e.currentBPM),
      targetBPM: preferPresent(i.targetBPM, e.targetBPM),
      manualConfidence: preferPresent(i.manualConfidence, e.manualConfidence),
      flag: i.flag !== undefined ? i.flag : e.flag,
      // Ladder state is *derived* from practice history (computeLadderAdvance,
      // lib/ladder.js), not something anyone hand-edits in an exported file
      // the way minutesPerDay might be — there's no legitimate "intentional
      // edit in the export should win" case for it the way there is for the
      // fields above. So unlike those, the import never overwrites it: the
      // existing piece's ladder progress always wins over whatever snapshot
      // happened to be sitting in the imported file, the same "must never
      // silently disappear" treatment doneDays/sessions already get above.
      // Known limitation: this means restoring a backup from a genuinely
      // more-advanced *other* device/browser (rather than re-importing an
      // older copy of the same piece) would keep this device's less-advanced
      // state instead of the more-advanced import — correctly recovering
      // that case would mean recomputing ladder state from the merged
      // session history instead of preferring either snapshot outright,
      // which is a bigger change than this fix; flagging, not building now.
      stage: e.stage,
      consecutivePasses: e.consecutivePasses,
      consecutiveStabilizingFails: e.consecutiveStabilizingFails,
      practiceBPM: e.practiceBPM,
      nextDueDate: e.nextDueDate,
      tier1Done: e.tier1Done,
      // Same reasoning as the ladder fields above: undo-scratch data for
      // "revert this chunk's schedule if the flag gets cleared" (see
      // App.jsx's handleSetFlag), not something an exported file should
      // be trusted to set.
      flagSnapshot: e.flagSnapshot,
    };
  });
  return merged;
}

const MERGE_FIELDS_HANDLED_SEPARATELY = [
  "id", "createdAt", "workId", "progress", "sections", "recordings",
  "bpmZones", "revival", "memoryAnchors", "measureDifficulty", "totalMeasures",
];

// Merges a freshly-imported piece into the existing piece it matched,
// non-destructively — see the field-level helpers above for the reasoning
// on each piece. Caller is responsible for re-deriving workId (ensureWorkId)
// and clearing rescheduleMarker afterward, same as any other schedule edit.
export function mergeImportedPiece(existing, imported) {
  const merged = { ...existing };

  Object.keys(imported).forEach((key) => {
    if (MERGE_FIELDS_HANDLED_SEPARATELY.includes(key)) return;
    merged[key] = preferPresent(imported[key], existing[key]);
  });

  // totalMeasures and measureDifficulty must move together — mixing sources
  // would leave measureDifficulty the wrong length for totalMeasures.
  if (imported.totalMeasures && imported.measureDifficulty && imported.measureDifficulty.length) {
    merged.totalMeasures = imported.totalMeasures;
    merged.measureDifficulty = imported.measureDifficulty;
  }

  merged.sections = mergeById(existing.sections, imported.sections);
  merged.recordings = mergeById(existing.recordings, imported.recordings);
  merged.bpmZones = mergeById(existing.bpmZones, imported.bpmZones);
  merged.memoryAnchors = { ...(existing.memoryAnchors || {}), ...(imported.memoryAnchors || {}) };
  merged.progress = mergeProgress(existing.progress, imported.progress);
  // An in-progress revival is live session state — protect it from being
  // overwritten by a stale import even if the import's revival looks
  // "present" by the generic rule above.
  merged.revival = existing.revival && existing.revival.active ? existing.revival : (imported.revival || existing.revival);

  merged.id = existing.id;
  merged.createdAt = existing.createdAt;

  return merged;
}
