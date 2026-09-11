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
  } = piece;

  const size =
    chunkMode === "auto"
      ? autoChunkSize(totalMeasures)
      : Math.max(1, Number(customChunkSize) || 4);

  const chunks = [];
  let index = 0;
  for (let start = 1; start <= totalMeasures; start += size) {
    const end = Math.min(start + size - 1, totalMeasures);
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
    index++;
  }
  return chunks;
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
