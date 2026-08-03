import { rangesOverlap, formatRange } from "./utils";

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

/* ------------------------------------------------------------------ */
/*  Section run-throughs: unlike chunks/transitions/combos above,     */
/*  these are NOT part of the precomputed timeline and carry no       */
/*  scheduled day. A section only becomes eligible once every chunk   */
/*  assigned to it has an actual logged session (not just "scheduled  */
/*  to be introduced") — so this is derived fresh from live progress  */
/*  on every render and surfaced dynamically in Today's Practice,     */
/*  rather than pinned to a day the way transitions/combos are.       */
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
    if (!isLearned(section)) return;
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
    });
  });

  // Combined section-pair run-throughs wait until every chunk in the whole
  // piece has been practiced at least once — these are meant as a late-stage
  // "play through two sections back to back" drill, not an early one.
  const allChunksPracticed = practiceChunks.every((c) => ((piece.progress[c.id] || {}).sessions || []).length > 0);
  const transitions = [];
  if (allChunksPracticed) {
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (!isLearned(a) || !isLearned(b)) continue;
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
      });
    }
  }

  return [...runThroughs, ...transitions];
}
