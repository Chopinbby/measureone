import { formatRange } from "./utils";
import { sectionLabel } from "./chunking";

/* ------------------------------------------------------------------ */
/*  Practice history: turning persisted progress back into readable    */
/*  day-by-day labels.                                                 */
/*                                                                     */
/*  This lives here rather than in ProgressTab because of the mismatch */
/*  it has to absorb: `piece.progress` is PERSISTED and keyed by chunk */
/*  id, while the chunk set itself is RE-DERIVED on every render. The  */
/*  two can disagree, and resolving that disagreement is calculation,  */
/*  not presentation. It was inline in the component and untestable    */
/*  when the crash below shipped.                                      */
/* ------------------------------------------------------------------ */

// A logged id can fail to resolve against the current chunk set for two
// quite different reasons. The original inline version assumed neither
// could happen and did `chunkById[id].start` directly, which threw on the
// undefined and crashed the *entire* Progress tab — every panel, not just
// the history row.
//
// 1. Section run-throughs (`sr_<sectionId>`) are real, current, perfectly
//    valid items — but `computeSectionRunThroughs` derives them fresh from
//    live progress and they are deliberately NOT part of
//    `generateAllChunks`'s `all` array (see the block comment in
//    chunking.js), so they are *never* in the chunk set on any piece.
//    Resolved straight off `piece.sections` instead, mirroring the sort
//    order `computeSectionRunThroughs` uses so the name matches what
//    Today's Practice showed when the session was logged.
// 2. Genuinely stale ids: editing a piece's measures, sections, or
//    difficulty regenerates chunk ids, so sessions logged before that edit
//    point at divisions that no longer exist.
//
// Case 2 keeps its day — the practice really happened — but the measures
// can't be named any more and are never guessed at. Those are counted and
// collapsed into a single trailing note rather than repeated once per id,
// which would swamp the row on a heavily-edited piece. Deliberately no
// console.warn for either case: unlike the malformed ladder snapshots in
// App.jsx, both are expected states, not a sign anything went wrong.
function sectionRunThroughLabel(orderedSections, id) {
  const sectionId = id.slice("sr_".length);
  const index = orderedSections.findIndex((s) => String(s.id) === sectionId);
  if (index === -1) return null;
  const section = orderedSections[index];
  return `Play through: ${sectionLabel(section, index)} (${formatRange(section.start, section.end)})`;
}

// The plan's final whole-piece run-through is logged against a synthetic
// progress key rather than a real chunk (handleLogRunThrough, App.jsx), so
// it never resolves through the chunk set and is handled before either
// lookup is attempted. Its stop count, when present, comes off the last
// session logged that day.
function consolidationLabel(piece, day) {
  const sessions = ((piece.progress.__consolidation__ || {}).sessions || []).filter((s) => s.day === day);
  const last = sessions[sessions.length - 1];
  return last && last.stopCount != null ? `Full run-through (stopped ${last.stopCount}x)` : "Full run-through";
}

function describeDay(piece, chunkById, orderedSections, ids, day) {
  const items = [];
  let unresolvedCount = 0;

  ids.forEach((id) => {
    if (id === "__consolidation__") {
      items.push(consolidationLabel(piece, day));
    } else if (chunkById[id]) {
      items.push(formatRange(chunkById[id].start, chunkById[id].end));
    } else {
      // A deleted section leaves its `sr_` id unresolvable too, so this
      // falls through to the unresolved bucket rather than assuming every
      // `sr_` prefix still points at a live section.
      const runThrough = id.startsWith("sr_") ? sectionRunThroughLabel(orderedSections, id) : null;
      if (runThrough) items.push(runThrough);
      else unresolvedCount++;
    }
  });

  const labels = [...items];
  if (unresolvedCount) {
    labels.push(`${unresolvedCount} passage${unresolvedCount === 1 ? "" : "s"} from an earlier version of this plan`);
  }

  return { day, label: labels.join(", "), unresolvedCount };
}

/**
 * Recent practice history, newest day first.
 *
 * `unresolvedCount` is returned alongside the display label so callers (and
 * tests) can reason about how many entries couldn't be named without having
 * to parse the copy back out of the label.
 *
 * @param {object} piece  the piece, read for `progress` and `sections`
 * @param {Array}  chunks the current chunk set (`chunkSet.all`)
 * @param {number} limit  how many days to return, newest first
 * @returns {Array<{day: number, label: string, unresolvedCount: number}>}
 */
export function computePracticeHistory(piece, chunks, limit = 10) {
  const chunkById = Object.fromEntries((chunks || []).map((c) => [c.id, c]));
  const orderedSections = [...((piece && piece.sections) || [])].sort((a, b) => a.start - b.start);

  const idsByDay = {};
  Object.entries((piece && piece.progress) || {}).forEach(([id, entry]) => {
    ((entry || {}).doneDays || []).forEach((d) => {
      if (!idsByDay[d]) idsByDay[d] = [];
      idsByDay[d].push(id);
    });
  });

  return Object.keys(idsByDay)
    .map(Number)
    .sort((a, b) => b - a)
    .slice(0, limit)
    .map((day) => describeDay(piece, chunkById, orderedSections, idsByDay[day], day));
}
