import { daysBetweenInclusive, todayISODate } from "./utils";

/* ------------------------------------------------------------------ */
/*  Cold-Start check (Pass 56) — a whole-piece cold play-through,      */
/*  offered once every section has had its own single-section          */
/*  run-through logged at least once, then re-offered at a widening    */
/*  gap since the piece was last touched at all. See                   */
/*  docs/Algorithms.md#cold-start-check and                            */
/*  docs/Repertoire-Lifecycle.md for the full design.                  */
/* ------------------------------------------------------------------ */

// The gate: every section's single-section run-through
// (piece.progress["sr_" + section.id]) has at least one logged session.
// Deliberately the exact literal formula this pass specifies — raw
// `sessions.length`, matching isSectionLearned's convention, NOT
// loggedSessions()-filtered the way sectionRunThroughGate (lib/chunking.js)
// is. Those two already diverge on purpose for a different reason (see
// chunking.js); this gate sides with isSectionLearned's simpler reading
// because the pass's own reasoning for why no separate "whole piece
// covered" check is needed leans on isSectionLearned specifically. No
// section-pair (kind: "section-transition") run-throughs are considered
// here — single-section only, per the pass.
//
// `piece.sections` is never actually empty in practice (SectionsEditor
// floors at 1, defaultPiece() seeds one), but every() on an empty array is
// vacuously true — guarded the same way chunking.js's countLearnedSections
// already guards the same edge case, so a hand-edited/malformed import
// with zero sections can't misread as "gate met" with nothing to back it.
export function coldStartGateMet(piece) {
  const sections = piece.sections || [];
  if (!sections.length) return false;
  return sections.every((s) => ((piece.progress["sr_" + s.id] || {}).sessions || []).length > 0);
}

// Escalation sequence, in days-since-last-logged: 3, 7, 14 (fixed by the
// pass), then doubling forever (28, 56, 112, ...) — this pass's own
// reasonable-default choice for the unspecified tail, matching the spirit
// of the maintenance ladder's own Holding-stage interval growth. Not
// derived from any study, same hand-picked status as this app's other
// scheduling constants (docs/Research.md).
const FIXED_THRESHOLDS = [3, 7, 14];

function thresholdsCrossedBy(daysSinceLogged) {
  const seq = FIXED_THRESHOLDS.filter((t) => t <= daysSinceLogged);
  let next = FIXED_THRESHOLDS[FIXED_THRESHOLDS.length - 1] * 2;
  while (next <= daysSinceLogged) {
    seq.push(next);
    next *= 2;
  }
  return seq;
}

// The highest escalation threshold `daysSinceLogged` has reached, or null
// if it hasn't reached even the first one (3) yet.
export function highestColdStartThreshold(daysSinceLogged) {
  if (daysSinceLogged == null || daysSinceLogged < FIXED_THRESHOLDS[0]) return null;
  const seq = thresholdsCrossedBy(daysSinceLogged);
  return seq.length ? seq[seq.length - 1] : null;
}

// Returns the threshold that should be surfaced right now (one of
// 3/7/14/28/...), or null if the gate isn't met or nothing new is due.
//
// Deliberately a pure, uncached recomputation — including "was this
// already shown" — rather than a persisted shown/dismissed flag on
// `piece`. Comparing today's crossed threshold against YESTERDAY's (the
// same computation one day earlier, i.e. `daysSinceLogged - 1`) is enough
// to know whether *today* is the day a threshold was newly crossed: it's
// due only the one day the crossed value actually changes, then reads as
// "nothing new" every day after until the next threshold — satisfying
// "doesn't re-fire daily once crossed" with no stored state to go stale
// across gap cycles, and no risk of a write-driven effect hiding the
// panel the instant it renders (a real timing hazard: an automatic
// "mark as shown" write, applied the way Pass 39's
// computeMinutesModeAutoExtend effect applies its patch, would trigger a
// re-render whose *very next* computation reads its own just-written
// state and immediately un-shows the panel it had only just decided to
// show). Because this is a live derivation off `piece.lastLoggedAt` alone,
// "reset it whenever any new session gets logged" (the pass's framing)
// falls out for free — a new session moves `lastLoggedAt` forward
// (App.jsx's usual stamping, unchanged by this feature), collapsing
// `daysSinceLogged` back near zero with nothing to explicitly reset. Same
// "computed fresh every call, never a persisted unlocked flag" spirit as
// sectionRunThroughGate (lib/chunking.js) and this codebase's other
// schedule-derived state.
//
// `today` defaults to the real todayISODate() but is injectable, mirroring
// isExportReminderDue's `now` parameter (lib/storage.js), so tests can
// simulate the passage of days without mocking the system clock.
export function coldStartDueThreshold(piece, today = todayISODate()) {
  if (!coldStartGateMet(piece)) return null;
  if (!piece.lastLoggedAt) return null;
  const daysSinceLogged = daysBetweenInclusive(piece.lastLoggedAt, today) - 1;
  const crossedToday = highestColdStartThreshold(daysSinceLogged);
  if (crossedToday == null) return null;
  const crossedYesterday = highestColdStartThreshold(daysSinceLogged - 1);
  return crossedToday !== crossedYesterday ? crossedToday : null;
}

// Pure core of App.jsx's handleLogColdStart — a synthetic
// piece.progress["__cold_start__"] entry, deliberately NOT
// "__consolidation__" (see docs/Data-Model.md): computeRevivalTriggers
// reads every "__consolidation__" session's stopCount indiscriminately for
// its ">5 stops" trigger, and this session shape carries no stopCount at
// all, so blending the two would both corrupt that trigger's meaning and
// mix a deliberately-cold gap test into routine consolidation-day history
// on Progress's recent-history list. Mirrors handleLogRunThrough's
// append-and-restamp shape. `gapDays` captures the gap that actually
// motivated this test — computed from the piece's *pre-log* lastLoggedAt,
// since this same call is about to overwrite it, and the live value would
// otherwise be lost the moment the session lands.
export function applyColdStartLog(piece, day, avgBpm, notes, today = todayISODate()) {
  const progress = { ...piece.progress };
  const prevEntry = progress["__cold_start__"] || { sessions: [] };
  const gapDays = piece.lastLoggedAt ? daysBetweenInclusive(piece.lastLoggedAt, today) - 1 : 0;
  const sessions = [
    ...(prevEntry.sessions || []),
    { day, avgBpm, notes, gapDays, loggedAt: Date.now(), loggedDate: today },
  ];
  progress["__cold_start__"] = { ...prevEntry, sessions };
  return { progress, lastLoggedAt: today };
}

// Removes only the most recently logged Cold-Start session — same
// "undo the last attempt" convention as handleUnlogRunThrough/
// handleUnlogSession. Returns null (a no-op signal) when there is nothing
// to undo, so the caller can leave the piece untouched rather than writing
// back an unchanged object.
export function applyColdStartUnlog(piece) {
  const prevEntry = (piece.progress || {})["__cold_start__"];
  if (!prevEntry || !(prevEntry.sessions || []).length) return null;
  const progress = { ...piece.progress };
  const sessions = [...prevEntry.sessions];
  sessions.pop();
  progress["__cold_start__"] = { ...prevEntry, sessions };
  return { progress };
}
