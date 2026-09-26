import { rangesOverlap, formatRange, loggedSessions } from "./utils";

/* ------------------------------------------------------------------ */
/*  Chunk generation: practice chunks (the scheduling unit), plus     */
/*  transitions (seams between adjacent chunks) and combos (larger    */
/*  blocks around hard chunks, entered from a different point than    */
/*  the original chunk boundary) for later-stage practice. These are  */
/*  distinct from the user's own musical "sections" (piece.sections). */
/* ------------------------------------------------------------------ */

// Was tiered by piece length (2/4/8/12 measures); simplified to a flat
// default per user decision — see docs/Decisions.md#scheduling.
export function autoChunkSize() {
  return 4;
}

// The uniform grid's step, from a piece's (or draft's) own settings — one
// place for the formula generatePracticeChunks and the two split-point
// checks below all need, so they can't drift apart.
export function chunkGridSize({ chunkMode, customChunkSize, totalMeasures }) {
  return chunkMode === "auto" ? autoChunkSize(totalMeasures) : Math.max(1, Number(customChunkSize) || 4);
}

export function weightedDifficultyFromArray(measureDifficulty, start, end) {
  let sum = 0;
  const count = end - start + 1;
  for (let m = start; m <= end; m++) sum += measureDifficulty[m - 1] || 1;
  const avg = sum / count;
  const label = avg < 1.67 ? "easy" : avg < 2.34 ? "medium" : "hard";
  return { avg, label };
}

export function generatePracticeChunks(piece) {
  const {
    totalMeasures,
    measureDifficulty,
    chunkMode,
    customChunkSize,
    recurringMode,
    recurringMeasures,
    recurringPairs,
    chunkSplitPoints,
  } = piece;

  const size = chunkGridSize(piece);

  // Pass 97 — a piece can carry extra chunk-boundary measures on top of the
  // uniform `size` stepping (a learner splitting a chunk in two from Daily
  // Practice, see splitPracticeChunk below). Merged into one sorted, deduped
  // boundary list rather than special-cased, so a split point that happens
  // to coincide with the uniform grid anyway (see survivingSplitPoints
  // below) is just a harmless no-op instead of needing its own branch.
  const boundarySet = new Set();
  for (let start = 1; start <= totalMeasures; start += size) boundarySet.add(start);
  (chunkSplitPoints || []).forEach((m) => {
    if (Number.isInteger(m) && m > 1 && m <= totalMeasures) boundarySet.add(m);
  });
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  const chunks = [];
  boundaries.forEach((start, index) => {
    const end = index + 1 < boundaries.length ? boundaries[index + 1] - 1 : totalMeasures;
    const { avg, label } = weightedDifficultyFromArray(measureDifficulty, start, end);

    let recurring = false;
    let recurringNote = null;
    let effortMultiplier = 1;

    if (recurringMode === "advanced") {
      const match = (recurringPairs || []).find((p) =>
        rangesOverlap(start, end, p.repeatStart, p.repeatEnd)
      );
      if (match) {
        recurring = true;
        recurringNote = `Similar to ${formatRange(match.sourceStart, match.sourceEnd)}`;
        effortMultiplier = 0.5;
      }
    } else if (recurringMode === "basic" && recurringMeasures > 0) {
      effortMultiplier = 1 - 0.5 * Math.min(1, recurringMeasures / totalMeasures);
    }

    const measureCount = end - start + 1;
    const effort = measureCount * avg * effortMultiplier;

    chunks.push({
      id: `c${start}`,
      kind: "section",
      index,
      start,
      end,
      measureCount,
      avgDifficulty: avg,
      difficultyLabel: label,
      recurring,
      recurringNote,
      effort,
      linkedIds: [],
    });
  });
  return chunks;
}

// Pass 97 — a base practice chunk of 2+ measures can be split in two from
// Daily Practice; a 1-measure chunk offers no split (1 is the smallest
// chunk this app allows). Transitions, combos, and section run-throughs
// never reach this check — only a `kind: "section"` chunk is ever offered.
export function canSplitChunk(chunk) {
  return !!chunk && chunk.kind === "section" && chunk.measureCount >= 2;
}

// The midpoint measure a split creates a new boundary at — the extra
// measure on an odd count goes to the SECOND half (5 -> 2+3, not 3+2), so
// the first half's own size is the floor, not the ceiling, of half the
// chunk's measure count. Matches CLAUDE.md's stated rule.
export function computeSplitMeasure(chunk) {
  return chunk.start + Math.floor(chunk.measureCount / 2);
}

// Which of a piece's existing split points remain valid chunk boundaries
// under a NEW chunkMode/customChunkSize/totalMeasures — used by App.jsx's
// handleSavePiece to decide, on a structural Settings edit, which splits
// survive silently and which must be cleared with a confirmation. A split
// point survives when the new uniform grid already lands on that exact
// measure on its own (e.g. resizing 4 -> 2, since a midpoint split of a
// 4-measure chunk sits exactly on a 2-measure boundary too) — carrying it
// forward is then a pure no-op, not a guess at how the old boundary maps
// onto a new one it doesn't actually align with. See CLAUDE.md's
// "Interaction with later Settings edits."
export function survivingSplitPoints(points, { totalMeasures, chunkMode, customChunkSize }) {
  const size = chunkGridSize({ totalMeasures, chunkMode, customChunkSize });
  return (points || []).filter(
    (m) => Number.isInteger(m) && m > 1 && m <= totalMeasures && (m - 1) % size === 0
  );
}

// Load-time validity check for stored split points — a DIFFERENT question
// from survivingSplitPoints above, and the two must not be swapped. That
// one asks "does a NEW grid reproduce this measure by itself" (right for a
// resize, where the old grid is gone); this one asks "could the app itself
// have produced this set of points on the piece's CURRENT grid." A real
// split is by definition NOT on the uniform grid (it's an extra boundary),
// so reusing the grid-coincidence rule at load time would wipe every
// legitimate split — caught by a test before it shipped.
//
// The app only ever creates a split at a chunk's own midpoint
// (computeSplitMeasure), and a half can only be split after its parent was,
// so every legitimate set is a downward-closed tree of midpoints inside a
// uniform-grid chunk: walk each grid chunk, keep its midpoint only if
// stored, then recurse into both halves. A point the walk never reaches
// (a stale point from a different grid, a deep point missing its parent, a
// point already on the grid, past the last measure) is one the app could
// not have made on this grid — dropped. A mismatched point that happens to
// LOOK like a valid midpoint of some current chunk can't be told apart from
// a real one and is kept, which is harmless: it yields an ordinary
// midpoint-shaped chunk pair.
export function validSplitPoints(points, { totalMeasures, chunkMode, customChunkSize }) {
  const wanted = new Set((points || []).filter((m) => Number.isInteger(m)));
  if (!wanted.size) return [];
  const size = chunkGridSize({ totalMeasures, chunkMode, customChunkSize });
  const found = [];
  const walk = (start, end) => {
    const count = end - start + 1;
    if (count < 2) return;
    const mid = start + Math.floor(count / 2);
    if (!wanted.has(mid)) return;
    found.push(mid);
    walk(start, mid - 1);
    walk(mid, end);
  };
  for (let start = 1; start <= totalMeasures; start += size) {
    walk(start, Math.min(start + size - 1, totalMeasures));
  }
  return found.sort((a, b) => a - b);
}

// Which of a piece's split points a Settings structure edit (totalMeasures /
// chunkMode / customChunkSize) keeps, and which it loses — the save-time
// decision handleSavePiece (App.jsx) acts on.
//
// If the uniform grid itself didn't move (same step — e.g. only totalMeasures
// changed, or auto -> custom 4), every existing chunk and split stays exactly
// where it is: the added measures simply extend the grid, and only a split
// that's no longer a legitimate midpoint on the new grid is lost (validSplitPoints
// — e.g. a split inside a short last chunk that the new measures then
// lengthen, or one past a shortened end). If the step DID change, the old
// grid is gone, so the resize rule applies: a split survives only where the
// new grid already lands on that exact measure (survivingSplitPoints), never
// guessed at.
//
// Only points that actually meant something before are considered: a stored
// point the old grid couldn't have produced, or one already sitting on it, was
// a no-op and is never reported "lost" (the load-time heal in storage.js
// drops those anyway). `oldPiece`/`newPiece` need only the three structure
// fields plus oldPiece.chunkSplitPoints.
export function splitPointsAfterStructureEdit(oldPiece, newPiece) {
  const meaningful = validSplitPoints(oldPiece.chunkSplitPoints, oldPiece);
  const sameGrid = chunkGridSize(oldPiece) === chunkGridSize(newPiece);
  const kept = sameGrid ? validSplitPoints(meaningful, newPiece) : survivingSplitPoints(meaningful, newPiece);
  return { kept, lost: meaningful.filter((m) => !kept.includes(m)) };
}

export function generateTransitionChunks(practiceChunks, measureDifficulty) {
  const transitions = [];
  const span = 2;
  for (let i = 0; i < practiceChunks.length - 1; i++) {
    const a = practiceChunks[i];
    const b = practiceChunks[i + 1];
    const start = Math.max(a.start, a.end - span + 1);
    const end = Math.min(b.end, b.start + span - 1);
    if (end < start) continue;
    const { avg, label } = weightedDifficultyFromArray(measureDifficulty, start, end);
    transitions.push({
      id: `t_${a.id}_${b.id}`,
      kind: "transition",
      start,
      end,
      measureCount: end - start + 1,
      avgDifficulty: avg,
      difficultyLabel: label,
      recurring: false,
      recurringNote: null,
      effort: (end - start + 1) * avg,
      linkedIds: [a.id, b.id],
    });
  }
  return transitions;
}

export function generateComboChunks(practiceChunks, measureDifficulty) {
  const combos = [];
  const seen = new Set();
  practiceChunks.forEach((c, i) => {
    if (c.difficultyLabel !== "hard") return;
    const prev = practiceChunks[i - 1];
    const next = practiceChunks[i + 1];
    const start = prev ? Math.ceil((prev.start + prev.end) / 2) : c.start;
    const end = next ? Math.floor((next.start + next.end) / 2) : c.end;
    const key = `${start}-${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { avg, label } = weightedDifficultyFromArray(measureDifficulty, start, end);
    combos.push({
      id: `x_${c.id}`,
      kind: "combo",
      start,
      end,
      measureCount: end - start + 1,
      avgDifficulty: avg,
      difficultyLabel: label,
      recurring: false,
      recurringNote: null,
      effort: (end - start + 1) * avg,
      linkedIds: [c.id],
    });
  });
  return combos;
}

export function generateAllChunks(piece) {
  const practiceChunks = generatePracticeChunks(piece);
  const transitions = generateTransitionChunks(practiceChunks, piece.measureDifficulty);
  const combos = generateComboChunks(practiceChunks, piece.measureDifficulty);
  return { practiceChunks, transitions, combos, all: [...practiceChunks, ...transitions, ...combos] };
}

// Migrates piece.progress entries whose chunk id no longer exists in the
// piece's current chunk set — an edit to totalMeasures/chunkMode/
// customChunkSize regenerates ids from measure position (`c${start}`, see
// generatePracticeChunks above), which can orphan every practice chunk's
// history at once — onto whichever new chunk best covers the same measure
// range, instead of leaving them permanently orphaned. Resolves an open
// question (docs/Decisions.md#open-questions) on direct request: migrate,
// don't discard or leave forever.
//
// Deliberately conservative — this is a heuristic, not a guaranteed-correct
// remapping (there often isn't one: boundaries genuinely moved, so "the
// same content" can legitimately now span two new chunks, or two old
// chunks can collapse into one new one). Three rules keep it from ever
// making things worse than the pre-existing status quo (an orphaned entry
// simply stays orphaned, exactly as before this function existed):
//   1. Only ever attaches an old entry to a new chunk that has NO progress
//      of its own already — never overwrites real, existing history.
//   2. Only ever claims a new chunk for ONE old entry — if two old chunks
//      would both map to the same new one (chunk size grew, merging two
//      old chunks into one new one), the old chunk earliest in measure
//      order wins; the other stays orphaned rather than being silently
//      discarded or guessed at.
//   3. Matched by greatest measure-range overlap, ties broken by the
//      earliest-starting candidate — a plain, explainable "most of this
//      old chunk's content is now in this new chunk" reading, not the only
//      defensible rule but a deterministic one.
//
// Scoped to base practice chunks (kind: "section") only — transitions and
// combos derive their ids from practice-chunk ids (`t_${a.id}_${b.id}` /
// `x_${c.id}`), so remapping those too would mean applying the same
// heuristic a second time over a dependent, derived id space; not
// attempted here. A connector's progress orphaned by the same edit stays
// orphaned, exactly as it always has.
//
// `oldPiece` is the piece as it exists before the edit (its progress and
// its still-current totalMeasures/chunkMode/customChunkSize); `newPiece`
// is the edited draft about to be saved (new totalMeasures/chunkMode/
// customChunkSize, but still carrying the *old*, unmigrated
// `newPiece.progress` — editing a piece's schedule never touches progress
// itself). Returns the progress object to actually save — the same
// reference as `newPiece.progress` when there's nothing to migrate, a new
// object otherwise.
export function migrateOrphanedProgress(oldPiece, newPiece) {
  const oldChunks = generatePracticeChunks(oldPiece);
  const newChunks = generatePracticeChunks(newPiece);
  const newById = new Set(newChunks.map((c) => c.id));
  const progress = newPiece.progress || {};

  const orphaned = oldChunks.filter((c) => progress[c.id] && !newById.has(c.id));
  if (!orphaned.length) return progress;

  const overlapAmount = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1);
  const claimed = new Set();
  const migrated = { ...progress };

  [...orphaned]
    .sort((a, b) => a.start - b.start)
    .forEach((oldChunk) => {
      const candidate = newChunks
        .filter((nc) => !claimed.has(nc.id) && !progress[nc.id] && overlapAmount(oldChunk, nc) > 0)
        .sort((a, b) => overlapAmount(oldChunk, b) - overlapAmount(oldChunk, a) || a.start - b.start)[0];
      if (!candidate) return;
      claimed.add(candidate.id);
      migrated[candidate.id] = migrated[oldChunk.id];
      delete migrated[oldChunk.id];
    });

  return migrated;
}

// Focus spots (Pass 91 follow-up) — re-homes every trouble spot onto
// whichever CURRENT chunk's measure range actually contains that spot's
// own recorded startMeasure, rather than trusting the chunk id it happens
// to be nested under. migrateOrphanedProgress above only catches an id
// that's disappeared outright; it can't catch one that still exists but
// now means a *different* measure range — chunk ids are `c${start}`, so
// e.g. customChunkSize 8 -> 4 produces a "c9" both before and after
// (measures 9-16, then 9-12), which reads as pure continuity to that
// function even though nothing about the actual content lined up.  A
// spot's own startMeasure is ground truth here in a way a chunk id never
// can be, since chunk ids are themselves just a byproduct of the current
// chunking scheme.
//
// A spot with no startMeasure at all (saved before this validation
// existed, and not recoverable by re-parsing its old position text either
// — see backfillProgressLadderState, lib/storage.js) has no ground truth
// to check against, so it's left exactly where it already is. Same for a
// spot whose startMeasure no longer falls inside ANY current chunk (the
// piece itself got shorter) — genuinely nothing to reattach to. Both
// mirror migrateOrphanedProgress's own precedent: never make an
// already-orphaned entry worse, just leave it be.
//
// Returns the same `progress` reference when nothing actually needs to
// move, so a caller can cheaply tell whether anything changed via `!==`.
export function reassociateTroubleSpots(progress, practiceChunks) {
  const spotted = Object.entries(progress || {}).filter(([, e]) => e && e.troubleSpots && e.troubleSpots.length);
  if (!spotted.length) return progress;

  const byNewChunk = {};
  let changed = false;
  spotted.forEach(([chunkId, entry]) => {
    entry.troubleSpots.forEach((spot) => {
      const home =
        (spot.startMeasure != null &&
          practiceChunks.find((c) => spot.startMeasure >= c.start && spot.startMeasure <= c.end)) ||
        practiceChunks.find((c) => c.id === chunkId);
      const homeId = home ? home.id : chunkId;
      if (homeId !== chunkId) changed = true;
      if (!byNewChunk[homeId]) byNewChunk[homeId] = [];
      byNewChunk[homeId].push(spot);
    });
  });
  if (!changed) return progress;

  const next = { ...progress };
  spotted.forEach(([chunkId, entry]) => {
    next[chunkId] = { ...entry, troubleSpots: byNewChunk[chunkId] || [] };
    delete byNewChunk[chunkId];
  });
  Object.entries(byNewChunk).forEach(([chunkId, spots]) => {
    next[chunkId] = { ...(next[chunkId] || progress[chunkId] || { doneDays: [] }), troubleSpots: spots };
  });
  return next;
}

// Pass 97 — splits an existing base practice chunk into two. Returns the
// fields App.jsx's handler (handleSplitChunk) needs to write onto the piece,
// or null if `chunkId` doesn't currently identify a splittable base
// practice chunk. Pure: the caller applies these via updatePiece and
// separately handles any rescheduleMarker chaining (a piece-level concern —
// see docs/Algorithms.md#rescheduling — not something this function
// touches).
//
// The FIRST half always keeps the parent's own id (`c${start}` doesn't
// change when the start measure doesn't move) — only the second half is
// ever a genuinely new id. That's why only the second half needs a fresh
// progress entry at all: the first half's history, including its session
// log, simply continues to exist under the same key it always has.
export function splitPracticeChunk(piece, chunkId) {
  const practiceChunks = generatePracticeChunks(piece);
  const chunk = practiceChunks.find((c) => c.id === chunkId);
  if (!canSplitChunk(chunk)) return null;

  const splitMeasure = computeSplitMeasure(chunk);
  const firstHalfId = chunk.id;
  const secondHalfId = `c${splitMeasure}`;
  const chunkSplitPoints = [...new Set([...(piece.chunkSplitPoints || []), splitMeasure])].sort((a, b) => a - b);
  const newPracticeChunks = generatePracticeChunks({ ...piece, chunkSplitPoints });

  const progress = { ...piece.progress };
  const parentEntry = progress[firstHalfId] || { doneDays: [] };
  // Ladder state, doneDays, BPMs, manual confidence, the flag — every
  // per-chunk field EXCEPT sessions[] (stays exclusive to the first half,
  // so practice-time totals/session counts aren't double-counted) and
  // troubleSpots (re-homed below by measure position, not duplicated onto
  // both halves).
  const { sessions, troubleSpots, ...restEntry } = parentEntry;
  progress[secondHalfId] = { ...restEntry, sessions: [] };

  // "Start fresh" for a combo anchored to the parent's own id (CLAUDE.md's
  // Connectors rule) — the first half keeps that id, but its neighbor
  // context has changed (its immediate "next" is now the second half, not
  // whatever used to follow the whole original chunk), so a combo
  // recomputed at this id post-split describes a structurally different
  // block than whatever history, if any, was logged against it before.
  delete progress[`x_${firstHalfId}`];

  // The one cheap connector exception: the seam between the second half and
  // whatever follows it covers the exact same measures the parent's own
  // seam-to-next did, whenever the second half is 2+ measures — checked by
  // comparing the two computed ranges directly rather than asserting the
  // condition analytically (a 1-measure second half shifts the transition's
  // own span by one measure and must NOT carry over).
  const oldTransitions = generateTransitionChunks(practiceChunks, piece.measureDifficulty);
  const oldNext = oldTransitions.find((t) => t.linkedIds[0] === firstHalfId);
  if (oldNext && progress[oldNext.id]) {
    const newTransitions = generateTransitionChunks(newPracticeChunks, piece.measureDifficulty);
    const newNext = newTransitions.find((t) => t.linkedIds[0] === secondHalfId);
    if (newNext && newNext.start === oldNext.start && newNext.end === oldNext.end) {
      progress[newNext.id] = progress[oldNext.id];
      delete progress[oldNext.id];
    }
  }

  const reassociated = reassociateTroubleSpots(progress, newPracticeChunks);

  return { chunkSplitPoints, progress: reassociated, firstHalfId, secondHalfId, splitMeasure };
}

// Pass 97 follow-up — Piece Map's persistent "these two came from one
// split" visual grouping, requested after reviewing the pre-build mockup.
// Derived live from piece.chunkSplitPoints, not a separate persisted
// relationship — nothing about a split chunk's own data needs to remember
// it was ever split (CLAUDE.md's "after this one-time copy the halves are
// ordinary, independent chunks"); this reads the same boundary list
// generatePracticeChunks already consumes, purely for display grouping.
//
// Returns `gridChunks` laid out one item per render slot, in the same
// left-to-right order: `{ first, second: null }` for a standalone chunk, or
// `{ first, second }` for two chunks whose shared boundary is one of the
// piece's own split points.
//
// A chunk can only ever be shown paired with ONE neighbor, even though a
// chunk re-split more than once can sit at two different split boundaries
// at once (its own boundary with whatever's now on its other side, from an
// earlier split of the same original chunk) — split points are processed
// in ascending measure order and the first pairing to claim a chunk wins;
// the second pairing that would also claim it is simply skipped, leaving
// that neighbor standalone rather than attempting a three-way (or deeper)
// grouping this two-box visual has no way to represent. A cosmetic
// simplification, not a data question — chunkSplitPoints itself is
// completely unaffected either way.
export function computeSplitDisplayGroups(gridChunks, chunkSplitPoints) {
  const secondByFirst = new Map();
  const claimed = new Set();
  [...(chunkSplitPoints || [])]
    .sort((a, b) => a - b)
    .forEach((m) => {
      const second = gridChunks.find((c) => c.start === m);
      const first = gridChunks.find((c) => c.end === m - 1);
      if (!first || !second || claimed.has(first.id) || claimed.has(second.id)) return;
      secondByFirst.set(first.id, second);
      claimed.add(first.id);
      claimed.add(second.id);
    });

  const skip = new Set();
  const items = [];
  gridChunks.forEach((c) => {
    if (skip.has(c.id)) return;
    const second = secondByFirst.get(c.id) || null;
    if (second) skip.add(second.id);
    items.push({ first: c, second });
  });
  return items;
}

/* ------------------------------------------------------------------ */
/*  Section run-throughs: unlike chunks/transitions/combos above,     */
/*  these are NOT part of the precomputed timeline and carry no       */
/*  scheduled day. A single-section run-through repeatedly becomes    */
/*  due as its slowest chunk's logged-session count crosses 1, 3, 5,  */
/*  7, ... (sectionRunThroughGate, below) — not just "scheduled to be */
/*  introduced" — so this is derived fresh from live progress on      */
/*  every render and surfaced dynamically in Today's Practice, rather */
/*  than pinned to a day the way transitions/combos are. A section-   */
/*  PAIR run-through (sectionPairRunThroughGate, below) has its own   */
/*  separate one-time first-unlock gate, but once unlocked gets the   */
/*  same repeating rhythm.                                            */
/* ------------------------------------------------------------------ */

export function chunksBySectionId(piece, practiceChunks) {
  const map = {};
  piece.sections.forEach((s) => { map[s.id] = []; });
  practiceChunks.forEach((c) => {
    const mid = (c.start + c.end) / 2;
    const owner = piece.sections.find((s) => mid >= s.start && mid <= s.end);
    if (owner) map[owner.id].push(c);
  });
  return map;
}

export function sectionLabel(section, index) {
  return (section.name && section.name.trim()) || `Section ${index + 1}`;
}

export function isSectionLearned(section, piece, bySectionId) {
  const assigned = bySectionId[section.id] || [];
  if (!assigned.length) return false;
  return assigned.every((c) => ((piece.progress[c.id] || {}).sessions || []).length > 0);
}

// The repeating gate for a single-section run-through (Pass 49). The
// relevant count per chunk is its logged-session count, via loggedSessions()
// (lib/utils.js) rather than raw sessions.length — a skipped Interleaved
// attempt or an unconfirmed provisional one doesn't represent a completed,
// confirmed rep, so it must not advance a chunk toward unlocking or
// re-unlocking a run-through. This deliberately diverges from
// isSectionLearned, which still checks raw sessions.length (unchanged,
// out of scope for this fix) — so a chunk touched only via a skip or an
// unconfirmed provisional can read as "learned" (Overview's stat) while
// still contributing 0 toward this gate's count; the two questions are
// different ("has this chunk been touched at all" vs. "how many real reps
// does this chunk actually have"), so the divergence is intentional, not
// a bug to reconcile. The section's own count is the MINIMUM across its
// assigned chunks, since the run-through is only meaningful once every
// included chunk has actually reached that count — the slowest-progressing
// chunk sets the pace.
//
// Threshold sequence is 1, 3, 5, 7, ... (first unlock, then a flat "+2"
// step forever) — exactly the odd positive integers, so "due" reduces to a
// parity check on the section's minimum count rather than needing an
// explicit threshold list. No persisted state: this is recomputed fresh
// from live session counts every time it's called, so a section's
// run-through goes due -> not due -> due again as its slowest chunk picks
// up more sessions, instead of unlocking once and staying available
// forever (the previous, replaced behavior).
//
// `lockedPreview` covers the day before a new threshold is crossed: every
// chunk except a single slowest one has already reached the upcoming
// threshold, so that one chunk's next logged session is what crosses the
// whole section into being newly due. Requires the minimum to be held
// uniquely by one chunk — if two or more chunks tie for slowest, a session
// on just one of them can't cross the section yet, so there is no single
// "next session" that unlocks it.
// Shared core of the repeating gate — takes whatever flat chunk list the
// caller assembled (one section's, or a pair's two sections combined) and
// answers the identical due/lockedPreview question off it. Pulled out once
// sectionPairRunThroughGate (below) needed the exact same computation over
// a different chunk list, rather than copying the four lines a second time.
function runThroughGateFromChunks(assigned, piece) {
  if (!assigned.length) return { minCount: 0, due: false, lockedPreview: false };
  const counts = assigned.map((c) => loggedSessions((piece.progress[c.id] || {}).sessions).length);
  const minCount = Math.min(...counts);
  const due = minCount % 2 === 1;
  const atMin = counts.filter((n) => n === minCount).length;
  const lockedPreview = !due && atMin === 1;
  return { minCount, due, lockedPreview };
}

export function sectionRunThroughGate(section, piece, bySectionId) {
  return runThroughGateFromChunks(bySectionId[section.id] || [], piece);
}

// The section-PAIR equivalent (Decisions.md#open-questions, resolved on
// direct request: yes, once a pair first unlocks it should get the same
// repeating due/locked-preview rhythm single sections got in Pass 49, for
// consistency with the check-in rhythm a learner already expects). The
// pair's own count is the minimum logged-session count across BOTH
// sections' assigned chunks combined — the slowest chunk anywhere in the
// pair sets the pace, same reasoning sectionRunThroughGate already applies
// within one section. Only ever called once a pair has already cleared its
// own one-time first-unlock gate (computeSectionRunThroughs, below) —
// this governs re-due behavior *after* that, not the initial unlock.
export function sectionPairRunThroughGate(sectionA, sectionB, piece, bySectionId) {
  const assigned = [...(bySectionId[sectionA.id] || []), ...(bySectionId[sectionB.id] || [])];
  return runThroughGateFromChunks(assigned, piece);
}

export function countLearnedSections(piece, practiceChunks) {
  if (!piece.sections.length) return 0;
  const bySectionId = chunksBySectionId(piece, practiceChunks);
  return piece.sections.filter((s) => isSectionLearned(s, piece, bySectionId)).length;
}

export function computeSectionRunThroughs(piece, practiceChunks) {
  if (!piece.sections.length || !practiceChunks.length) return [];
  const bySectionId = chunksBySectionId(piece, practiceChunks);
  const ordered = [...piece.sections].sort((a, b) => a.start - b.start);
  const isLearned = (section) => isSectionLearned(section, piece, bySectionId);

  const runThroughs = [];
  ordered.forEach((section, i) => {
    const gate = sectionRunThroughGate(section, piece, bySectionId);
    if (!gate.due && !gate.lockedPreview) return;
    const { avg, label } = weightedDifficultyFromArray(piece.measureDifficulty, section.start, section.end);
    runThroughs.push({
      id: `sr_${section.id}`,
      kind: "section-runthrough",
      label: `Play through: ${sectionLabel(section, i)}`,
      start: section.start,
      end: section.end,
      measureCount: section.end - section.start + 1,
      avgDifficulty: avg,
      difficultyLabel: label,
      recurring: false,
      recurringNote: null,
      linkedIds: [section.id],
      // true on the day one chunk's next session would cross the section
      // into being newly due — rendered locked/grayed, not loggable yet.
      locked: gate.lockedPreview,
    });
  });

  // Combined section-pair run-throughs wait until every chunk in the whole
  // piece has been practiced at least once, AND both sections in the pair
  // are individually learned — these are meant as a late-stage "play
  // through two sections back to back" drill, not an early one. That's the
  // one-time first-unlock gate. Once a pair clears it, it gets the same
  // repeating due/lockedPreview rhythm single sections already have
  // (sectionPairRunThroughGate, above) — resolved, no longer the original
  // unlock-once-and-stay gate this used to be. See
  // docs/Algorithms.md#section-run-throughs.
  const allChunksPracticed = practiceChunks.every((c) => ((piece.progress[c.id] || {}).sessions || []).length > 0);
  const transitions = [];
  if (allChunksPracticed) {
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (!isLearned(a) || !isLearned(b)) continue;
      const gate = sectionPairRunThroughGate(a, b, piece, bySectionId);
      if (!gate.due && !gate.lockedPreview) continue;
      const { avg, label } = weightedDifficultyFromArray(piece.measureDifficulty, a.start, b.end);
      transitions.push({
        id: `st_${a.id}_${b.id}`,
        kind: "section-transition",
        label: `Play through: ${sectionLabel(a, i)} → ${sectionLabel(b, i + 1)}`,
        start: a.start,
        end: b.end,
        measureCount: b.end - a.start + 1,
        avgDifficulty: avg,
        difficultyLabel: label,
        recurring: false,
        recurringNote: null,
        linkedIds: [a.id, b.id],
        // true on the day one chunk's next session would cross the pair
        // into being newly due again — same rendered locked/grayed preview
        // treatment single sections already get.
        locked: gate.lockedPreview,
      });
    }
  }

  return [...runThroughs, ...transitions];
}
