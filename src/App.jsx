import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BookOpen,
  LayoutGrid,
  CalendarDays,
  Music2,
  ListChecks,
  LineChart,
  BarChart3,
  Settings as SettingsIcon,
  Plus,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Download,
  Upload,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants & pure helpers                                          */
/* ------------------------------------------------------------------ */

const PIECE_KEY_PREFIX = "measureone-piece:";
const ACTIVE_KEY = "measureone-active_piece_id";
const EFFORT_TO_MIN = 2.5; // minutes of practice per "effort point"
const REVIEW_OFFSETS = [1, 3, 7, 14];
const MS_PER_DAY = 86400000;
const LIBERAL_FACTOR = 1.2; // pad schedule estimates rather than assume perfect efficiency

const DIFFICULTY_META = {
  easy: { label: "Easy", color: "var(--teal)" },
  medium: { label: "Medium", color: "var(--brass)" },
  hard: { label: "Hard", color: "var(--brick)" },
};
const LEVEL_LABEL = { 1: "easy", 2: "medium", 3: "hard" };
const REQUIRED_REPS = { easy: 3, medium: 4, hard: 5 };
const ROLE_LABEL = {
  new: "New",
  review: "Review",
  transition: "Review",
  combo: "Focus block",
  "section-runthrough": "Section run-through",
  "section-transition": "Sections combined",
};
const EFFECTIVENESS_OPTIONS = [
  { value: "low", label: "Needs more work" },
  { value: "good", label: "Good" },
  { value: "high", label: "Too easy" },
];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function formatRange(start, end) {
  return start === end ? `m. ${start}` : `mm. ${start}–${end}`;
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatHoursMinutes(totalSeconds) {
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function sumPracticeSeconds(piece) {
  return Object.values(piece.progress).reduce(
    (sum, entry) => sum + (entry.sessions || []).reduce((s, sess) => s + (sess.durationSeconds || 0), 0),
    0
  );
}

function autoChunkSize(totalMeasures) {
  if (totalMeasures <= 32) return 2;
  if (totalMeasures <= 80) return 4;
  if (totalMeasures <= 160) return 8;
  return 12;
}

function weightedDifficultyFromArray(measureDifficulty, start, end) {
  let sum = 0;
  const count = end - start + 1;
  for (let m = start; m <= end; m++) sum += measureDifficulty[m - 1] || 1;
  const avg = sum / count;
  const label = avg < 1.67 ? "easy" : avg < 2.34 ? "medium" : "hard";
  return { avg, label };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function resizeDifficulty(arr, newTotal) {
  if (!arr) return Array(newTotal).fill(1);
  if (arr.length === newTotal) return arr;
  if (arr.length > newTotal) return arr.slice(0, newTotal);
  return [...arr, ...Array(newTotal - arr.length).fill(1)];
}

function resizeSections(sections, newTotal) {
  return (sections || []).map((s) => {
    const start = clamp(s.start, 1, newTotal);
    const end = clamp(s.end, 1, newTotal);
    return { ...s, start: Math.min(start, end), end: Math.max(start, end) };
  });
}

/* ------------------------------------------------------------------ */
/*  Chunk generation: practice chunks (the scheduling unit), plus     */
/*  transitions (seams between adjacent chunks) and combos (larger    */
/*  blocks around hard chunks, entered from a different point than    */
/*  the original chunk boundary) for later-stage practice. These are  */
/*  distinct from the user's own musical "sections" (piece.sections). */
/* ------------------------------------------------------------------ */

function generatePracticeChunks(piece) {
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

function generateTransitionChunks(practiceChunks, measureDifficulty) {
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

function generateComboChunks(practiceChunks, measureDifficulty) {
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

function generateAllChunks(piece) {
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

function chunksBySectionId(piece, practiceChunks) {
  const map = {};
  piece.sections.forEach((s) => { map[s.id] = []; });
  practiceChunks.forEach((c) => {
    const mid = (c.start + c.end) / 2;
    const owner = piece.sections.find((s) => mid >= s.start && mid <= s.end);
    if (owner) map[owner.id].push(c);
  });
  return map;
}

function sectionLabel(section, index) {
  return (section.name && section.name.trim()) || `Section ${index + 1}`;
}

function isSectionLearned(section, piece, bySectionId) {
  const assigned = bySectionId[section.id] || [];
  if (!assigned.length) return false;
  return assigned.every((c) => ((piece.progress[c.id] || {}).sessions || []).length > 0);
}

function countLearnedSections(piece, practiceChunks) {
  if (!piece.sections.length) return 0;
  const bySectionId = chunksBySectionId(piece, practiceChunks);
  return piece.sections.filter((s) => isSectionLearned(s, piece, bySectionId)).length;
}

function computeSectionRunThroughs(piece, practiceChunks) {
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

/* ------------------------------------------------------------------ */
/*  Timeline engine                                                    */
/* ------------------------------------------------------------------ */

// Spaced review defaults to [1,3,7,14] days after a chunk is introduced, but
// bends based on the learner's own feedback on their most recent session:
// "needs more work" pulls the next review closer, "too easy" pushes it out.
// This is the first step toward the interval engine adapting on its own.
function adaptiveReviewOffsets(chunk, progress) {
  const sessions = ((progress || {})[chunk.id] || {}).sessions || [];
  if (!sessions.length) return REVIEW_OFFSETS;
  const last = sessions[sessions.length - 1];
  const factor = last.effectiveness === "low" ? 0.6 : last.effectiveness === "high" ? 1.4 : 1;
  return REVIEW_OFFSETS.map((o) => Math.max(1, Math.round(o * factor)));
}

// Rule: the whole piece gets introduced within the first half of the
// learning days. The back half mixes review, seam transitions, and
// hard-section focus blocks (entered from a different point than the
// original chunk boundary) instead of sitting empty until a final
// run-through.
function computeTimeline(piece, chunkSet) {
  const { practiceChunks, transitions, combos, all } = chunkSet;
  const totalDays = Math.max(1, Number(piece.daysToLearn) || 1);
  const consolidationDays = totalDays >= 5 ? 1 : 0;
  const learningDays = Math.max(1, totalDays - consolidationDays);
  const halfPoint = Math.max(1, Math.min(learningDays, Math.ceil(learningDays * 0.5)));
  const newBudgetPerDay = (Number(piece.minutesPerDay || 30) * 0.65) / EFFORT_TO_MIN;

  const days = Array.from({ length: totalDays }, (_, i) => ({
    dayNumber: i + 1,
    type: consolidationDays && i + 1 === totalDays ? "consolidation" : "learning",
    newChunkIds: [],
    specialChunkIds: [],
    reviewChunkIds: [],
    minutes: 0,
  }));

  const introducedDay = {};

  let dayIdx = 0;
  let acc = 0;
  practiceChunks.forEach((chunk) => {
    if (acc + chunk.effort > newBudgetPerDay && acc > 0 && dayIdx < halfPoint - 1) {
      dayIdx++;
      acc = 0;
    }
    days[dayIdx].newChunkIds.push(chunk.id);
    introducedDay[chunk.id] = dayIdx + 1;
    acc += chunk.effort;
  });
  const sectionsEndDay = Math.min(halfPoint, learningDays);
  const backSpan = Math.max(1, learningDays - sectionsEndDay);

  transitions.forEach((t) => {
    const readyDay = Math.max(
      introducedDay[t.linkedIds[0]] || sectionsEndDay,
      introducedDay[t.linkedIds[1]] || sectionsEndDay
    );
    const day = Math.min(learningDays, readyDay + 1);
    days[day - 1].specialChunkIds.push(t.id);
    introducedDay[t.id] = day;
  });

  combos.forEach((c, i) => {
    const readyDay = introducedDay[c.linkedIds[0]] || sectionsEndDay;
    const earliest = Math.min(learningDays, Math.max(sectionsEndDay + 1, readyDay + 1));
    const day = clamp(earliest + (i % backSpan), earliest, learningDays);
    days[day - 1].specialChunkIds.push(c.id);
    introducedDay[c.id] = day;
  });

  all.forEach((chunk) => {
    const start = introducedDay[chunk.id];
    if (!start) return;
    adaptiveReviewOffsets(chunk, piece.progress).forEach((off) => {
      const d = start + off;
      if (d <= learningDays) days[d - 1].reviewChunkIds.push(chunk.id);
    });
  });

  if (consolidationDays) {
    days[totalDays - 1].reviewChunkIds = practiceChunks.map((c) => c.id);
  }

  const chunkById = Object.fromEntries(all.map((c) => [c.id, c]));
  days.forEach((d) => {
    if (d.type === "consolidation") {
      d.minutes = Number(piece.minutesPerDay || 30);
    } else {
      const newMin = d.newChunkIds.reduce((s, id) => s + chunkById[id].effort * EFFORT_TO_MIN, 0);
      const specialMin = d.specialChunkIds.reduce((s, id) => s + chunkById[id].effort * EFFORT_TO_MIN, 0);
      const reviewMin = d.reviewChunkIds.length * 3;
      d.minutes = Math.round(newMin + specialMin + reviewMin);
    }
  });

  return { days, learningDays, consolidationDays, halfPoint, introducedDay };
}

function getEffectiveTimeline(piece, chunkSet) {
  const marker = piece.rescheduleMarker;
  if (!marker) return computeTimeline(piece, chunkSet);

  const original = computeTimeline(piece, chunkSet);
  const { practiceChunks, transitions, combos } = chunkSet;
  const chunkById = Object.fromEntries(practiceChunks.map((c) => [c.id, c]));
  const remainingChunks = marker.remainingChunkOrder.map((id) => chunkById[id]).filter(Boolean);
  const remainingIds = new Set(remainingChunks.map((c) => c.id));
  const remainingTransitions = transitions.filter((t) => t.linkedIds.some((id) => remainingIds.has(id)));
  const remainingCombos = combos.filter((c) => remainingIds.has(c.linkedIds[0]));

  const asOfDay = clamp(marker.asOfDay, 1, original.days.length);
  const remainingDayCount = Math.max(1, original.days.length - asOfDay + 1);
  const subPiece = { ...piece, daysToLearn: remainingDayCount };
  const subChunkSet = {
    practiceChunks: remainingChunks,
    transitions: remainingTransitions,
    combos: remainingCombos,
    all: [...remainingChunks, ...remainingTransitions, ...remainingCombos],
  };
  const sub = computeTimeline(subPiece, subChunkSet);

  const mergedDays = [
    ...original.days.slice(0, asOfDay - 1),
    ...sub.days.map((d, i) => ({ ...d, dayNumber: asOfDay + i })),
  ];

  return {
    days: mergedDays,
    learningDays: asOfDay - 1 + sub.learningDays,
    consolidationDays: sub.consolidationDays,
    halfPoint: sub.halfPoint,
    introducedDay: { ...original.introducedDay, ...sub.introducedDay },
  };
}

// A chunk only counts as "missed" once its scheduled day has actually passed
// and it still has zero logged sessions — not simply because it hasn't been
// checked off yet today, and not from a same-day confidence dip.
function computeScheduleStatus(piece, practiceChunks, timeline, currentDay) {
  const remainingChunkIds = [];
  let missedCount = 0;
  practiceChunks.forEach((c) => {
    const touched = ((piece.progress[c.id] || {}).doneDays || []).length > 0;
    if (touched) return;
    remainingChunkIds.push(c.id);
    const introducedOn = timeline.introducedDay[c.id];
    if (introducedOn && introducedOn < currentDay) missedCount++;
  });
  return { missedCount, remainingChunkIds };
}

// A measure-range tempo target set in Settings (or the whole-piece default)
// applies to any chunk whose measures fall in that zone, unless the chunk has
// its own explicit target set from the Piece Map.
function getDefaultTargetBPM(piece, chunk) {
  const zone = (piece.bpmZones || []).find((z) => rangesOverlap(chunk.start, chunk.end, z.start, z.end));
  if (zone) return zone.bpm;
  return piece.targetBPM || null;
}

// Auto-computed confidence blends: how many clean reps were actually logged
// relative to the target (not just that a session happened), how close the
// achieved tempo was to the goal BPM, recency of last practice, the
// learner's own feedback on how their last session felt, difficulty, and
// recurring status.
function computeAutoConfidence(chunk, piece, currentDay) {
  const entry = piece.progress[chunk.id] || {};
  const doneDays = entry.doneDays || [];
  if (doneDays.length === 0 && !entry.currentBPM) return 0;

  const requiredReps = REQUIRED_REPS[chunk.difficultyLabel] || 4;
  const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, chunk);
  const sessions = entry.sessions || [];

  let repQuality = 0;
  sessions.forEach((s) => {
    const repRatio = clamp((s.cleanReps || 0) / requiredReps, 0, 1);
    const bpmRatio = targetBPM ? clamp((s.bpm || 0) / targetBPM, 0, 1) : 0.6;
    repQuality += repRatio * (0.5 + 0.5 * bpmRatio);
  });
  const repsScore = Math.min(55, repQuality * 18);

  const lastDay = doneDays.length ? Math.max(...doneDays) : currentDay;
  const daysSince = Math.max(0, currentDay - lastDay);
  const recencyScore = Math.max(0, 20 - daysSince * 3);

  let tempoScore = 0;
  if (targetBPM && entry.currentBPM) {
    tempoScore = clamp(entry.currentBPM / targetBPM, 0, 1) * 25;
  }

  let score = repsScore + recencyScore + tempoScore;

  if (sessions.length) {
    const last = sessions[sessions.length - 1];
    if (last.effectiveness === "low") score *= 0.8;
    else if (last.effectiveness === "high") score *= 1.15;
  }

  if (chunk.difficultyLabel === "hard") score *= 0.9;
  if (chunk.recurring) score *= 1.1;
  return Math.round(clamp(score, 0, 100));
}

function computeConfidence(chunk, piece, currentDay) {
  const entry = piece.progress[chunk.id] || {};
  if (entry.manualConfidence !== undefined && entry.manualConfidence !== null) {
    return clamp(Math.round(entry.manualConfidence), 0, 100);
  }
  return computeAutoConfidence(chunk, piece, currentDay);
}

const PROGRESS_TIER_META = {
  untouched: { label: "Not touched", color: "var(--ink-faint)" },
  learned: { label: "Learned", color: "var(--brick)" },
  comfortable: { label: "Comfortable", color: "var(--brass)" },
  mastered: { label: "Mastered", color: "var(--teal)" },
};

// Buckets a chunk by its most recently logged clean-rep count, not a peak
// ever achieved — same "what's true right now" convention as currentBPM.
function computeProgressTier(chunk, piece) {
  const sessions = (piece.progress[chunk.id] || {}).sessions || [];
  if (sessions.length === 0) return "untouched";
  const lastReps = sessions[sessions.length - 1].cleanReps || 0;
  if (lastReps >= 10) return "mastered";
  if (lastReps >= 5) return "comfortable";
  return "learned";
}

function isManualConfidence(chunk, progress) {
  const entry = progress[chunk.id] || {};
  return entry.manualConfidence !== undefined && entry.manualConfidence !== null;
}

function suggestMethods(chunk, confidence) {
  if (chunk.kind === "section-runthrough" || chunk.kind === "section-transition")
    return ["Full run-through without stopping", "Note where it still catches, fix it separately after"];
  if (chunk.kind === "transition") return ["Slow practice at the seam", "Backward chaining into it"];
  if (chunk.kind === "combo") return ["Start cold at the top of the block", "Slow practice", "Tempo ladder"];
  if (chunk.difficultyLabel === "hard" && confidence < 50)
    return ["Backward chaining", "Hands-separate practice", "Slow practice"];
  if (chunk.recurring) return ["Interleaving", "Retrieval practice"];
  if (confidence >= 70) return ["Tempo ladder", "Full run-throughs"];
  if (chunk.difficultyLabel === "hard") return ["Slow practice", "Deliberate repetitions"];
  return ["Deliberate repetitions", "Spaced repetition"];
}

function getCurrentDay(piece, totalDays) {
  if (!piece.createdAt) return 1;
  const diff = Math.floor((Date.now() - piece.createdAt) / MS_PER_DAY);
  return clamp(diff + 1, 1, totalDays);
}

function defaultPiece() {
  const totalMeasures = 64;
  return {
    id: null,
    name: "",
    composer: "",
    notes: "",
    totalMeasures,
    measureDifficulty: Array(totalMeasures).fill(1),
    diffMode: "grid",
    sections: [{ id: "s1", name: "", start: 1, end: totalMeasures }],
    recurringMode: "advanced",
    recurringMeasures: 0,
    recurringPairs: [],
    scheduleMode: "days",
    daysToLearn: 21,
    minutesPerDay: 30,
    chunkMode: "custom",
    customChunkSize: 4,
    targetBPM: null,
    bpmZones: [],
    createdAt: null,
    progress: {},
    rescheduleMarker: null,
  };
}

/* ------------------------------------------------------------------ */
/*  Reusable number input that doesn't fight you while typing         */
/* ------------------------------------------------------------------ */

function NumberInput({ value, onCommit, min, max, style, placeholder }) {
  const [text, setText] = useState(String(value ?? ""));

  useEffect(() => {
    setText(String(value ?? ""));
  }, [value]);

  const commit = (raw) => {
    if (raw === "" || isNaN(Number(raw))) {
      setText(String(value ?? ""));
      return;
    }
    let n = Number(raw);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    onCommit(n);
  };

  return (
    <input
      type="number"
      style={style}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.target.value);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Decorative                                                        */
/* ------------------------------------------------------------------ */

function ManuscriptDoodle({ className }) {
  return (
    <svg
      className={`manuscript-doodle ${className || ""}`}
      viewBox="0 0 600 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {[18, 32, 46, 60, 74].map((y, i) => (
        <path
          key={i}
          d={`M0,${y} C100,${y - 3} 200,${y + 3} 300,${y - 2} S500,${y + 2} 600,${y}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ))}
      <text x="10" y="84" fontSize="76" fontFamily="Georgia, serif" fill="var(--ink)">
        &#119070;
      </text>
      <g fill="var(--ink)">
        <circle cx="230" cy="55" r="6" />
        <rect x="234" y="18" width="2" height="38" />
        <circle cx="280" cy="40" r="6" />
        <rect x="284" y="8" width="2" height="34" />
        <circle cx="370" cy="62" r="6" />
        <rect x="374" y="24" width="2" height="40" />
        <circle cx="440" cy="46" r="6" />
        <rect x="444" y="12" width="2" height="36" />
      </g>
      <path d="M225,70 Q300,95 450,68" fill="none" stroke="var(--ink)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ManuscriptStrip({ chunks, compact }) {
  if (!chunks.length) return null;
  return (
    <div className={`manuscript-strip ${compact ? "compact" : ""}`}>
      {chunks.map((c) => (
        <div
          key={c.id}
          className="manuscript-block"
          style={{ flex: c.measureCount, background: DIFFICULTY_META[c.difficultyLabel].color }}
        >
          {c.recurring && <span className="recurring-dot" />}
          <span className="block-tooltip">
            {formatRange(c.start, c.end)} — {DIFFICULTY_META[c.difficultyLabel].label}
            {c.recurring ? " — recurring" : ""}
          </span>
        </div>
      ))}
      <div className="final-barline" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared, reusable field editors (used by Wizard AND Settings)      */
/* ------------------------------------------------------------------ */

function BasicsFields({ draft, set }) {
  return (
    <>
      <label className="field">
        <span>Piece name</span>
        <input
          type="text"
          placeholder="e.g. Chopin – Nocturne in E♭ major, Op. 9 No. 2"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Composer</span>
        <input
          type="text"
          placeholder="e.g. Frédéric Chopin"
          value={draft.composer || ""}
          onChange={(e) => set({ composer: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Total measures</span>
        <NumberInput
          value={draft.totalMeasures}
          min={1}
          max={5000}
          onCommit={(total) =>
            set({
              totalMeasures: total,
              measureDifficulty: resizeDifficulty(draft.measureDifficulty, total),
              sections: resizeSections(draft.sections, total),
            })
          }
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          placeholder="Context, history, teacher notes — anything worth remembering about this piece…"
          value={draft.notes || ""}
          onChange={(e) => set({ notes: e.target.value })}
          rows={4}
        />
      </label>
    </>
  );
}

function SectionsEditor({ draft, set }) {
  const addSection = () =>
    set({
      sections: [...draft.sections, { id: `s${Date.now()}`, name: "", start: 1, end: draft.totalMeasures }],
    });
  const updateSection = (i, patch) =>
    set({ sections: draft.sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const removeSection = (i) => {
    if (draft.sections.length <= 1) return;
    set({ sections: draft.sections.filter((_, idx) => idx !== i) });
  };

  return (
    <div>
      <p className="wizard-hint">
        Mark the piece's musical sections (Exposition, Development, a chorus, whatever applies) as
        measure ranges. This is just how you think about the piece's form — separate from how it
        gets chunked for practice.
      </p>
      <div className="pairs-list">
        {draft.sections.map((s, i) => (
          <div key={s.id} className="pair-row">
            <input
              type="text"
              className="name-input"
              placeholder={`Section ${i + 1}`}
              value={s.name}
              onChange={(e) => updateSection(i, { name: e.target.value })}
            />
            <span className="pair-label">mm.</span>
            <NumberInput value={s.start} min={1} max={draft.totalMeasures} onCommit={(n) => updateSection(i, { start: n })} />
            <span>–</span>
            <NumberInput value={s.end} min={1} max={draft.totalMeasures} onCommit={(n) => updateSection(i, { end: n })} />
            {draft.sections.length > 1 && (
              <button className="icon-btn" onClick={() => removeSection(i)} aria-label="Remove">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        <button className="ghost-btn" onClick={addSection}>
          <Plus size={14} /> Add section
        </button>
      </div>
    </div>
  );
}

function DifficultyEditor({ draft, set }) {
  const total = draft.totalMeasures;
  const arr = draft.measureDifficulty;
  const mode = draft.diffMode;

  const cycle = (idx) => {
    const next = arr.map((v, i) => (i === idx ? (v % 3) + 1 : v));
    set({ measureDifficulty: next });
  };

  const easyCount = arr.filter((v) => v === 1).length;
  const mediumCount = arr.filter((v) => v === 2).length;
  const hardCount = total - easyCount - mediumCount;

  const applySimple = (newEasy, newMedium) => {
    newEasy = clamp(newEasy, 0, total);
    newMedium = clamp(newMedium, 0, total - newEasy);
    const hardN = total - newEasy - newMedium;
    const next = [...Array(newEasy).fill(1), ...Array(newMedium).fill(2), ...Array(hardN).fill(3)];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    set({ measureDifficulty: next });
  };

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={mode === "grid" ? "active" : ""} onClick={() => set({ diffMode: "grid" })}>
          Precise grid
        </button>
        <button className={mode === "simple" ? "active" : ""} onClick={() => set({ diffMode: "simple" })}>
          Quick counts
        </button>
      </div>

      {mode === "grid" ? (
        <>
          <p className="wizard-hint">
            Click a measure to cycle Easy → Medium → Hard. Mark the trouble spots wherever they
            actually fall — the ending, the middle, wherever.
          </p>
          <div className="diff-grid-wrap">
            <div className="diff-grid">
              {arr.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className={`diff-cell diff-${v}`}
                  onClick={() => cycle(i)}
                  title={`Measure ${i + 1}: ${DIFFICULTY_META[LEVEL_LABEL[v]].label}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="wizard-hint">
            We'll spread these counts across the piece rather than assuming a strict order —
            pieces are rarely easy-to-hard in a straight line. Use the precise grid if you want to
            place difficulty exactly.
          </p>
          <div className="field-row">
            <label className="field">
              <span>Easy measures</span>
              <NumberInput value={easyCount} min={0} max={total} onCommit={(n) => applySimple(n, mediumCount)} />
            </label>
            <label className="field">
              <span>Medium measures</span>
              <NumberInput value={mediumCount} min={0} max={total} onCommit={(n) => applySimple(easyCount, n)} />
            </label>
            <label className="field">
              <span>Hard measures</span>
              <input type="number" value={hardCount} readOnly disabled />
            </label>
          </div>
        </>
      )}
    </div>
  );
}

function RecurringEditor({ draft, set }) {
  const addPair = () =>
    set({
      recurringPairs: [
        ...draft.recurringPairs,
        { repeatStart: 1, repeatEnd: 1, sourceStart: 1, sourceEnd: 1 },
      ],
    });
  const updatePair = (i, patch) =>
    set({ recurringPairs: draft.recurringPairs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const removePair = (i) =>
    set({ recurringPairs: draft.recurringPairs.filter((_, idx) => idx !== i) });

  return (
    <div>
      <p className="wizard-hint">
        Even if the material isn't exactly identical, if the practice approach is similar enough,
        count it as recurring — it still needs less repetition to feel solid.
      </p>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={draft.recurringMode === "none" ? "active" : ""} onClick={() => set({ recurringMode: "none" })}>
          None
        </button>
        <button className={draft.recurringMode === "advanced" ? "active" : ""} onClick={() => set({ recurringMode: "advanced" })}>
          Map repeats <span className="badge">Recommended</span>
        </button>
        <button className={draft.recurringMode === "basic" ? "active" : ""} onClick={() => set({ recurringMode: "basic" })}>
          Quick count
        </button>
      </div>

      {draft.recurringMode === "basic" && (
        <label className="field">
          <span>Measures that repeat earlier material</span>
          <NumberInput
            value={draft.recurringMeasures}
            min={0}
            max={draft.totalMeasures}
            onCommit={(n) => set({ recurringMeasures: n })}
          />
          <p className="wizard-hint" style={{ marginBottom: 0, marginTop: 6 }}>
            Count only the repeat occurrence, not the original. If a 2-measure phrase appears again
            later, that's 2 recurring measures, not 4.
          </p>
        </label>
      )}

      {draft.recurringMode === "advanced" && (
        <div className="pairs-list">
          {draft.recurringPairs.map((p, i) => (
            <div key={i} className="pair-row">
              <span className="pair-label">mm.</span>
              <NumberInput value={p.repeatStart} min={1} onCommit={(n) => updatePair(i, { repeatStart: n })} />
              <span>–</span>
              <NumberInput value={p.repeatEnd} min={1} onCommit={(n) => updatePair(i, { repeatEnd: n })} />
              <span className="pair-label">is like</span>
              <NumberInput value={p.sourceStart} min={1} onCommit={(n) => updatePair(i, { sourceStart: n })} />
              <span>–</span>
              <NumberInput value={p.sourceEnd} min={1} onCommit={(n) => updatePair(i, { sourceEnd: n })} />
              <button className="icon-btn" onClick={() => removePair(i)} aria-label="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="ghost-btn" onClick={addPair}>
            <Plus size={14} /> Add repeated passage
          </button>
        </div>
      )}
    </div>
  );
}

function ScheduleFields({ draft, set }) {
  const chunkSet = useMemo(
    () => generateAllChunks(draft),
    [
      draft.totalMeasures,
      draft.measureDifficulty,
      draft.chunkMode,
      draft.customChunkSize,
      draft.recurringMode,
      draft.recurringMeasures,
      draft.recurringPairs,
    ]
  );
  const totalMinutesNeeded = useMemo(
    () => (chunkSet.all.reduce((s, c) => s + c.effort, 0) * EFFORT_TO_MIN) / 0.65,
    [chunkSet]
  );

  useEffect(() => {
    if (draft.scheduleMode === "days") {
      const days = Math.max(1, draft.daysToLearn || 1);
      const consolidationDays = days >= 5 ? 1 : 0;
      const learningDays = Math.max(1, days - consolidationDays);
      const needed = Math.max(10, Math.ceil((totalMinutesNeeded * LIBERAL_FACTOR) / learningDays / 5) * 5);
      if (needed !== draft.minutesPerDay) set({ minutesPerDay: needed });
    } else {
      const minutes = Math.max(5, draft.minutesPerDay || 30);
      const newBudget = (minutes * 0.65) / EFFORT_TO_MIN;
      let learningDaysNeeded = 1;
      let acc = 0;
      chunkSet.all.forEach((c) => {
        if (acc + c.effort > newBudget && acc > 0) {
          learningDaysNeeded++;
          acc = 0;
        }
        acc += c.effort;
      });
      const estTotal = Math.max(1, Math.ceil((learningDaysNeeded / 0.88) * LIBERAL_FACTOR));
      if (estTotal !== draft.daysToLearn) set({ daysToLearn: estTotal });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.scheduleMode, draft.daysToLearn, draft.minutesPerDay, totalMinutesNeeded, chunkSet.all.length]);

  return (
    <>
      <div className="field">
        <span>Which is fixed?</span>
        <div className="segmented">
          <button className={draft.scheduleMode === "days" ? "active" : ""} onClick={() => set({ scheduleMode: "days" })}>
            Days I have
          </button>
          <button className={draft.scheduleMode === "minutes" ? "active" : ""} onClick={() => set({ scheduleMode: "minutes" })}>
            Minutes per day
          </button>
        </div>
      </div>

      {draft.scheduleMode === "days" ? (
        <>
          <label className="field">
            <span>Days to learn it</span>
            <NumberInput value={draft.daysToLearn} min={1} max={3650} onCommit={(n) => set({ daysToLearn: n })} />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{draft.minutesPerDay}</strong> minutes/day needed at this pace
          </p>
        </>
      ) : (
        <>
          <label className="field">
            <span>Minutes available per day</span>
            <NumberInput value={draft.minutesPerDay} min={5} max={600} onCommit={(n) => set({ minutesPerDay: n })} />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{draft.daysToLearn}</strong> days needed at this pace
          </p>
        </>
      )}

      <div className="field" style={{ marginTop: 8 }}>
        <span>Chunk size</span>
        <div className="segmented">
          <button className={draft.chunkMode === "custom" ? "active" : ""} onClick={() => set({ chunkMode: "custom" })}>
            Custom
          </button>
          <button className={draft.chunkMode === "auto" ? "active" : ""} onClick={() => set({ chunkMode: "auto" })}>
            Determine automatically
          </button>
        </div>
        {draft.chunkMode === "auto" ? (
          <p className="wizard-hint" style={{ marginTop: 8 }}>
            {draft.totalMeasures} measures → chunks of {autoChunkSize(draft.totalMeasures)} measures
          </p>
        ) : (
          <div style={{ marginTop: 8, maxWidth: 140 }}>
            <NumberInput value={draft.customChunkSize} min={1} max={draft.totalMeasures} onCommit={(n) => set({ customChunkSize: n })} />
          </div>
        )}
      </div>

      <label className="field" style={{ marginTop: 8 }}>
        <span>Target tempo (BPM) — optional</span>
        <NumberInput value={draft.targetBPM || ""} min={20} max={400} onCommit={(n) => set({ targetBPM: n })} />
      </label>
    </>
  );
}

function BpmZonesEditor({ draft, set }) {
  const addZone = () =>
    set({
      bpmZones: [
        ...(draft.bpmZones || []),
        { id: `bz${Date.now()}`, start: 1, end: draft.totalMeasures, bpm: draft.targetBPM || 100 },
      ],
    });
  const updateZone = (i, patch) =>
    set({ bpmZones: draft.bpmZones.map((z, idx) => (idx === i ? { ...z, ...patch } : z)) });
  const removeZone = (i) => set({ bpmZones: draft.bpmZones.filter((_, idx) => idx !== i) });

  return (
    <div>
      <p className="wizard-hint">
        Optionally set a different tempo target for specific measure ranges — this overrides the
        whole-piece default (set under Schedule) for those measures.
      </p>
      <div className="pairs-list">
        {(draft.bpmZones || []).map((z, i) => (
          <div key={z.id} className="pair-row">
            <span className="pair-label">mm.</span>
            <NumberInput value={z.start} min={1} max={draft.totalMeasures} onCommit={(n) => updateZone(i, { start: n })} />
            <span>–</span>
            <NumberInput value={z.end} min={1} max={draft.totalMeasures} onCommit={(n) => updateZone(i, { end: n })} />
            <span className="pair-label">target</span>
            <NumberInput value={z.bpm} min={20} max={400} onCommit={(n) => updateZone(i, { bpm: n })} />
            <button className="icon-btn" onClick={() => removeZone(i)} aria-label="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button className="ghost-btn" onClick={addZone}>
          <Plus size={14} /> Add tempo zone
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Setup Wizard (new piece only)                                     */
/* ------------------------------------------------------------------ */

const STEPS = ["Piece", "Sections", "Difficulty", "Repeats", "Timeline", "Review"];

function Wizard({ onCancel, onComplete, hasPiece }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(defaultPiece());
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const chunkSet = useMemo(() => generateAllChunks(draft), [draft]);
  const timeline = useMemo(() => computeTimeline(draft, chunkSet), [draft, chunkSet]);
  const totalMinutes = timeline.days.reduce((s, d) => s + d.minutes, 0);
  const avgMinPerDay = Math.round(totalMinutes / draft.daysToLearn / 5) * 5;

  const canAdvance = () => {
    if (step === 0) return draft.name.trim().length > 0 && draft.totalMeasures > 0;
    if (step === 4) return draft.daysToLearn > 0 && draft.minutesPerDay > 0;
    return true;
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`modal-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
                <span className="modal-step-dot">{i < step ? <Check size={12} /> : i + 1}</span>
                {s}
              </div>
            ))}
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {step === 0 && (
            <div className="wizard-pane">
              <h2>What are you learning?</h2>
              <p className="wizard-hint">Start with the basics of the piece.</p>
              <BasicsFields draft={draft} set={set} />
            </div>
          )}
          {step === 1 && (
            <div className="wizard-pane">
              <h2>What are the piece's sections?</h2>
              <SectionsEditor draft={draft} set={set} />
            </div>
          )}
          {step === 2 && (
            <div className="wizard-pane">
              <h2>How hard is each part?</h2>
              <DifficultyEditor draft={draft} set={set} />
            </div>
          )}
          {step === 3 && (
            <div className="wizard-pane">
              <h2>Any recurring material?</h2>
              <RecurringEditor draft={draft} set={set} />
            </div>
          )}
          {step === 4 && (
            <div className="wizard-pane">
              <h2>Set the schedule</h2>
              <p className="wizard-hint">Fix the constraint that matters most — we'll work out the other one.</p>
              <ScheduleFields draft={draft} set={set} />
            </div>
          )}
          {step === 5 && (
            <div className="wizard-pane">
              <h2>Ready for measure one</h2>
              <p className="wizard-hint">
                The whole piece gets covered by day {timeline.halfPoint} — the rest of the time is
                transitions, focus blocks, and review.
              </p>
              <ManuscriptStrip chunks={chunkSet.practiceChunks} />
              <div className="review-grid">
                <div className="review-stat"><span className="num">{draft.sections.length}</span><span className="lbl">sections</span></div>
                <div className="review-stat"><span className="num">{draft.daysToLearn}</span><span className="lbl">days</span></div>
                <div className="review-stat"><span className="num">{avgMinPerDay}</span><span className="lbl">avg min/day</span></div>
                <div className="review-stat"><span className="num">{chunkSet.transitions.length + chunkSet.combos.length}</span><span className="lbl">transitions + focus blocks</span></div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="ghost-btn" onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}>
            <ChevronLeft size={16} /> {step === 0 ? (hasPiece ? "Return to Dashboard" : "Cancel") : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button className="primary-btn" disabled={!canAdvance()} onClick={() => setStep((s) => s + 1)}>
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button className="primary-btn" onClick={() => onComplete({ ...draft, createdAt: Date.now() })}>
              <Sparkles size={16} /> Generate my plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Schedule banner (shared by Overview + Today)                      */
/* ------------------------------------------------------------------ */

function ScheduleBanner({ piece, practiceChunks, timeline, currentDay, onReschedule }) {
  const status = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
  if (status.missedCount === 0) return null;
  return (
    <div className="schedule-banner">
      <div>
        <p className="schedule-banner-title">
          {status.missedCount} chunk{status.missedCount === 1 ? "" : "s"} behind schedule
        </p>
        <p className="schedule-banner-sub">
          Life happens. Rebalance what's left across the rest of your plan without losing what
          you've already learned.
        </p>
      </div>
      <button className="primary-btn" onClick={onReschedule}>
        <RotateCcw size={15} /> Reschedule remaining days
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

function OverviewTab({ piece, practiceChunks, timeline, currentDay, onReschedule, onAddPiece }) {
  const tierMeasures = { untouched: 0, learned: 0, comfortable: 0, mastered: 0 };
  practiceChunks.forEach((c) => {
    tierMeasures[computeProgressTier(c, piece)] += c.measureCount;
  });
  const measuresLearned = piece.totalMeasures - tierMeasures.untouched;
  const sectionsLearned = countLearnedSections(piece, practiceChunks);
  const totalPracticeSeconds = sumPracticeSeconds(piece);

  const totalProgressPct = practiceChunks.length
    ? Math.round(practiceChunks.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / practiceChunks.length)
    : 0;

  return (
    <div className="tab-pane">
      <div className="overview-top-row">
        <button className="ghost-btn" onClick={onAddPiece}>
          <Plus size={14} /> Add new piece
        </button>
      </div>
      <ScheduleBanner piece={piece} practiceChunks={practiceChunks} timeline={timeline} currentDay={currentDay} onReschedule={onReschedule} />
      <div className="hero-card">
        <div className="hero-doodle-band">
          <ManuscriptDoodle />
        </div>
        <div className="hero-content">
          <p className="eyebrow">Now practicing</p>
          <h1>{piece.name}</h1>
          {piece.composer && <p className="hero-composer">{piece.composer}</p>}
          <p className="hero-sub">
            {piece.totalMeasures} measures, {piece.sections.length} sections, {piece.daysToLearn}-day plan
          </p>
        </div>
      </div>

      <ManuscriptStrip chunks={practiceChunks} />

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-num mono">{measuresLearned}/{piece.totalMeasures}</span><span className="stat-lbl">Measures learned</span></div>
        <div className="stat-card"><span className="stat-num mono">{sectionsLearned}/{piece.sections.length}</span><span className="stat-lbl">Sections learned</span></div>
        <div className="stat-card"><span className="stat-num mono">{formatHoursMinutes(totalPracticeSeconds)}</span><span className="stat-lbl">Time practiced</span></div>
        <div className="stat-card"><span className="stat-num mono">{totalProgressPct}%</span><span className="stat-lbl">Total progress</span></div>
      </div>

      <div className="panel">
        <h3>Practice progress</h3>
        <div className="bal-row">
          {Object.keys(PROGRESS_TIER_META).map((tier) => (
            <div key={tier} className="bal-seg" style={{ flex: tierMeasures[tier] || 0.001, background: PROGRESS_TIER_META[tier].color }} />
          ))}
        </div>
        <div className="diff-summary">
          {Object.keys(PROGRESS_TIER_META).map((tier) => (
            <div key={tier} className="diff-summary-item">
              <i className="dot" style={{ background: PROGRESS_TIER_META[tier].color }} />
              {PROGRESS_TIER_META[tier].label}: <strong>{Math.round((tierMeasures[tier] / piece.totalMeasures) * 100)}%</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>The first week</h3>
        <div className="day-preview-list">
          {timeline.days.slice(0, 7).map((d) => (
            <div key={d.dayNumber} className="day-preview-row">
              <span className="day-num mono">Day {d.dayNumber}</span>
              <span className="day-desc">
                {d.type === "consolidation"
                  ? "Full run-through & consolidation"
                  : `${d.newChunkIds.length} new, ${d.specialChunkIds.length} transition/focus, ${d.reviewChunkIds.length} review`}
              </span>
              <span className="day-min mono">{d.minutes} min</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineTab({ chunks, timeline, onSelectDay }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const weeks = [];
  for (let i = 0; i < timeline.days.length; i += 7) weeks.push(timeline.days.slice(i, i + 7));

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Timeline</h1>
        <p className="hero-sub">
          Full piece covered by day {timeline.halfPoint}. After that: transitions, focus blocks, and
          spaced review. Click a day to open its tasks.
        </p>
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="panel">
          <h3>Week {wi + 1}</h3>
          <div className="week-grid">
            {week.map((d) => (
              <button key={d.dayNumber} className={`day-card clickable ${d.type}`} onClick={() => onSelectDay(d.dayNumber)}>
                <div className="day-card-head">
                  <span className="mono">Day {d.dayNumber}</span>
                  <span className="mono day-card-min">{d.minutes}m</span>
                </div>
                {d.type === "consolidation" ? (
                  <p className="day-card-note">Full run-through of the piece</p>
                ) : (
                  <>
                    {d.newChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag new">New</span>
                        {d.newChunkIds.map((id) => (
                          <span key={id} className="chip">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                    {d.specialChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag special">
                          {d.specialChunkIds.some((id) => chunkById[id].kind === "combo") ? "Focus" : "Review"}
                        </span>
                        {d.specialChunkIds.map((id) => (
                          <span key={id} className="chip transition">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                    {d.reviewChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag review">Review</span>
                        {d.reviewChunkIds.map((id) => (
                          <span key={id} className="chip subtle">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PieceMapTab({ piece, chunks, currentDay, onUpdateBPM, onSetManualConfidence }) {
  const [selected, setSelected] = useState(null);
  const selectedChunk = chunks.find((c) => c.id === selected);
  const selectedEntry = selectedChunk ? piece.progress[selectedChunk.id] || {} : {};
  const selectedIsManual = selectedChunk ? isManualConfidence(selectedChunk, piece.progress) : false;

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Piece Map</h1>
        <p className="hero-sub">Color shows confidence. Includes practice chunks, transitions, and focus blocks.</p>
      </div>

      <div className="confidence-legend">
        <span><i className="dot" style={{ background: "var(--brick)" }} /> Needs work</span>
        <span><i className="dot" style={{ background: "var(--brass)" }} /> Developing</span>
        <span><i className="dot" style={{ background: "var(--teal)" }} /> Confident</span>
      </div>

      <div className="map-grid">
        {chunks.map((c) => {
          const conf = computeConfidence(c, piece, currentDay);
          const manual = isManualConfidence(c, piece.progress);
          const tier = conf >= 67 ? "teal" : conf >= 34 ? "brass" : "brick";
          return (
            <button
              key={c.id}
              className={`map-cell tier-${tier} ${selected === c.id ? "selected" : ""}`}
              onClick={() => setSelected(selected === c.id ? null : c.id)}
            >
              {c.kind !== "section" && <span className="map-cell-kind">{c.kind === "combo" ? "Focus" : "Review"}</span>}
              <span className={`map-cell-diff-dot diff-dot-${c.difficultyLabel}`} title={DIFFICULTY_META[c.difficultyLabel].label} />
              <span className="map-cell-range mono">{formatRange(c.start, c.end)}</span>
              <span className="map-cell-conf mono">
                {conf}%{manual && <Pencil size={9} className="manual-mark" title="Set manually" />}
              </span>
              {c.recurring && <span className="map-cell-recurring" title="Recurring material">&#8635;</span>}
            </button>
          );
        })}
      </div>

      {selectedChunk && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-head">
              <h3>{formatRange(selectedChunk.start, selectedChunk.end)}</h3>
              <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-stats">
                <div><span className="lbl">Difficulty</span><span className="val">{DIFFICULTY_META[selectedChunk.difficultyLabel].label}</span></div>
                <div>
                  <span className="lbl">Confidence</span>
                  <span className="val">
                    {computeConfidence(selectedChunk, piece, currentDay)}%
                    {selectedIsManual && <span className="badge dark">Manual</span>}
                  </span>
                </div>
                <div><span className="lbl">Sessions logged</span><span className="val mono">{(selectedEntry.doneDays || []).length}</span></div>
                {selectedChunk.recurringNote && <div><span className="lbl">Repeats</span><span className="val">{selectedChunk.recurringNote}</span></div>}
              </div>

              <div className="field">
                <span>Confidence override</span>
                {selectedIsManual ? (
                  <div className="manual-conf-row">
                    <NumberInput
                      value={selectedEntry.manualConfidence}
                      min={0}
                      max={100}
                      onCommit={(n) => onSetManualConfidence(selectedChunk.id, n)}
                    />
                    <button className="ghost-btn" onClick={() => onSetManualConfidence(selectedChunk.id, null)}>
                      Reset to automatic
                    </button>
                  </div>
                ) : (
                  <div className="manual-conf-row">
                    <p className="wizard-hint" style={{ margin: 0, flex: 1 }}>
                      Auto-calculated at {computeAutoConfidence(selectedChunk, piece, currentDay)}% right now.
                    </p>
                    <button
                      className="ghost-btn"
                      onClick={() => onSetManualConfidence(selectedChunk.id, computeAutoConfidence(selectedChunk, piece, currentDay))}
                    >
                      Set manually
                    </button>
                  </div>
                )}
              </div>

              <div className="field-row">
                <label className="field">
                  <span>Current BPM</span>
                  <NumberInput value={selectedEntry.currentBPM || ""} min={20} max={400} onCommit={(n) => onUpdateBPM(selectedChunk.id, "currentBPM", n)} />
                </label>
                <label className="field">
                  <span>Target BPM</span>
                  <NumberInput
                    value={selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk) || ""}
                    min={20}
                    max={400}
                    onCommit={(n) => onUpdateBPM(selectedChunk.id, "targetBPM", n)}
                  />
                </label>
              </div>
              {(selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk)) > 0 && (
                <div className="bpm-track">
                  <div
                    className="bpm-fill"
                    style={{
                      width: `${Math.round(
                        clamp(
                          (selectedEntry.currentBPM || 0) / (selectedEntry.targetBPM || getDefaultTargetBPM(piece, selectedChunk)),
                          0,
                          1
                        ) * 100
                      )}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Today's Practice                                                   */
/* ------------------------------------------------------------------ */

function ChecklistItem({ chunk, role, piece, day, onLogSession, onUnlogSession }) {
  const entry = piece.progress[chunk.id] || {};
  const checked = (entry.doneDays || []).includes(day);
  const session = (entry.sessions || []).find((s) => s.day === day);
  const conf = computeConfidence(chunk, piece, day);
  const tips = suggestMethods(chunk, conf);
  const [reps, setReps] = useState("");
  const [bpm, setBpm] = useState("");
  const [feel, setFeel] = useState("");
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const canLog = reps !== "" && bpm !== "" && !!feel;

  const submitLog = () => {
    if (!canLog) return;
    onLogSession(chunk.id, day, Number(reps), Number(bpm), feel, elapsed);
    setReps("");
    setBpm("");
    setFeel("");
    setElapsed(0);
    setTimerRunning(false);
  };

  if (checked) {
    const feltLabel = session && EFFECTIVENESS_OPTIONS.find((o) => o.value === session.effectiveness);
    return (
      <div className="checklist-item checked">
        <button className="checklist-check" onClick={() => onUnlogSession(chunk.id, day)} aria-label="Undo">
          <Check size={13} />
        </button>
        <div className="checklist-body">
          <div className="checklist-row">
            {chunk.label && <span className="checklist-label">{chunk.label}</span>}
            <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
            <span className={`tag tag-${role}`}>{ROLE_LABEL[role]}</span>
            <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
            <span className="conf-pill mono">{conf}%</span>
          </div>
          {session && (
            <p className="tip-line">
              Logged: {session.cleanReps} consecutive clean rep{session.cleanReps === 1 ? "" : "s"} at {session.bpm} BPM
              {session.durationSeconds ? ` in ${formatDuration(session.durationSeconds)}` : ""}
              {feltLabel ? ` — ${feltLabel.label.toLowerCase()}` : ""}
            </p>
          )}
        </div>
      </div>
    );
  }

  const suggestedReps = REQUIRED_REPS[chunk.difficultyLabel];

  return (
    <div className="checklist-item">
      <button
        type="button"
        className="checklist-check-empty"
        disabled={!canLog}
        aria-label="Mark done"
        title={canLog ? "Mark done" : "Fill in reps, BPM, and how it felt first"}
        onClick={submitLog}
      />
      <div className="checklist-body">
        <div className="checklist-row">
          {chunk.label && <span className="checklist-label">{chunk.label}</span>}
          <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
          <span className={`tag tag-${role}`}>{ROLE_LABEL[role]}</span>
          <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
          <span className="conf-pill mono">{conf}%</span>
        </div>
        <p className="tip-line">Try: {tips.join(", ")}</p>

        <div className="timer-row">
          <button type="button" className={`timer-btn ${timerRunning ? "running" : ""}`} onClick={() => setTimerRunning((r) => !r)}>
            {timerRunning ? "Stop" : "Start"} timer
          </button>
          <span className="timer-display mono">{formatDuration(elapsed)}</span>
        </div>

        <div className="log-row">
          <label>
            <span>Clean reps (aim {suggestedReps})</span>
            <input type="number" min={0} value={reps} onChange={(e) => setReps(e.target.value)} placeholder={String(suggestedReps)} />
          </label>
          <label>
            <span>BPM achieved</span>
            <input type="number" min={20} value={bpm} onChange={(e) => setBpm(e.target.value)} placeholder="e.g. 88" />
          </label>
        </div>
        <div className="feel-row">
          <span>How did it feel?</span>
          <div className="segmented">
            {EFFECTIVENESS_OPTIONS.map((o) => (
              <button key={o.value} className={feel === o.value ? "active" : ""} onClick={() => setFeel(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <button className="primary-btn sm" disabled={!canLog} style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={submitLog}>
          Log practice
        </button>
      </div>
    </div>
  );
}

function DayChecklist({ piece, chunks, day, onLogSession, onUnlogSession, onToggleDone }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));

  if (day.type === "consolidation") {
    const done = ((piece.progress["__consolidation__"] || {}).doneDays || []).includes(day.dayNumber);
    return (
      <div className="panel">
        <h3>Day {day.dayNumber} — Full run-through</h3>
        <p className="wizard-hint">No new material today. Play through the whole piece and note where it still catches.</p>
        <button className={done ? "ghost-btn" : "primary-btn"} onClick={() => onToggleDone("__consolidation__", day.dayNumber)}>
          {done ? <><Check size={14} /> Marked complete</> : "Mark run-through complete"}
        </button>
      </div>
    );
  }

  const items = [
    ...day.newChunkIds.map((id) => ({ id, role: "new" })),
    ...day.specialChunkIds.map((id) => ({ id, role: chunkById[id].kind })),
    ...day.reviewChunkIds.map((id) => ({ id, role: "review" })),
  ];

  if (items.length === 0) {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>Nothing scheduled.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Day {day.dayNumber} — {day.minutes} min planned</h3>
      <div className="checklist">
        {items.map(({ id, role }) => (
          <ChecklistItem
            key={id + role}
            chunk={chunkById[id]}
            role={role}
            piece={piece}
            day={day.dayNumber}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ))}
      </div>
    </div>
  );
}

function FocusPanel({ piece, chunks, currentDay }) {
  const ranked = chunks
    .map((c) => ({ chunk: c, conf: computeConfidence(c, piece, currentDay) }))
    .filter((x) => ((piece.progress[x.chunk.id] || {}).doneDays || []).length > 0)
    .sort((a, b) => a.conf - b.conf)
    .slice(0, 5);

  if (ranked.length === 0) return null;

  return (
    <div className="panel focus-panel">
      <h3>Needs the most work right now</h3>
      <p className="wizard-hint">
        Ranked by confidence across everything you've touched so far — not just what's on today's
        schedule.
      </p>
      <div className="focus-list">
        {ranked.map(({ chunk, conf }) => (
          <div key={chunk.id} className="focus-row">
            <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
            {chunk.kind !== "section" && (
              <span className="tag subtle">{chunk.kind === "combo" ? "Focus block" : "Review"}</span>
            )}
            <span className="tag subtle">{DIFFICULTY_META[chunk.difficultyLabel].label}</span>
            <span className="focus-conf mono">{conf}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionRunThroughPanel({ piece, practiceChunks, currentDay, onLogSession, onUnlogSession }) {
  const items = useMemo(
    () => computeSectionRunThroughs(piece, practiceChunks),
    [piece, practiceChunks]
  );

  if (items.length === 0) return null;

  return (
    <div className="panel focus-panel">
      <h3>Section run-throughs</h3>
      <p className="wizard-hint">
        Unlocked once every chunk in a section has been practiced at least once — a chance to play
        through continuously instead of chunk by chunk. Combined section run-throughs unlock once
        the whole piece has been practiced in chunks.
      </p>
      <div className="checklist">
        {items.map((item) => (
          <ChecklistItem
            key={item.id}
            chunk={item}
            role={item.kind}
            piece={piece}
            day={currentDay}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
          />
        ))}
      </div>
    </div>
  );
}

function ReassessPanel({ piece, todaysRanges, onReassessRange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [level, setLevel] = useState("medium");

  if (todaysRanges.length === 0) return null;

  return (
    <div className="panel reassess-panel">
      {!open ? (
        <div className="reassess-prompt">
          <p className="wizard-hint" style={{ margin: 0 }}>Practiced something today? You can reassess difficulty for specific measures.</p>
          <button className="ghost-btn" onClick={() => setOpen(true)}>Reassess difficulty</button>
        </div>
      ) : (
        <>
          <h3>Reassess difficulty by measure</h3>
          <p className="wizard-hint">Pick a range and a new rating — difficulty is tracked measure by measure, same as setup.</p>
          <div className="reassess-quickpicks">
            {todaysRanges.map((r) => (
              <button key={`${r.start}-${r.end}`} className="chip subtle" onClick={() => { setFrom(r.start); setTo(r.end); }}>
                {formatRange(r.start, r.end)}
              </button>
            ))}
          </div>
          <div className="field-row">
            <label className="field">
              <span>From measure</span>
              <NumberInput value={from} min={1} max={piece.totalMeasures} onCommit={setFrom} />
            </label>
            <label className="field">
              <span>To measure</span>
              <NumberInput value={to} min={1} max={piece.totalMeasures} onCommit={setTo} />
            </label>
          </div>
          <div className="segmented" style={{ marginBottom: 16 }}>
            {["easy", "medium", "hard"].map((lvl) => (
              <button key={lvl} className={level === lvl ? "active" : ""} onClick={() => setLevel(lvl)}>
                {DIFFICULTY_META[lvl].label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="primary-btn"
              onClick={() => {
                onReassessRange(Math.min(from, to), Math.max(from, to), level);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TodayTab({
  piece,
  chunks,
  timeline,
  currentDay,
  onDayChange,
  isRealToday,
  onJumpToday,
  onLogSession,
  onUnlogSession,
  onToggleDone,
  onReschedule,
  onReassessRange,
}) {
  const [viewMode, setViewMode] = useState("day");
  const day = timeline.days[currentDay - 1];
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const practiceChunks = chunks.filter((c) => c.kind === "section");

  const todaysRanges = [...new Set(
    [...day.newChunkIds, ...day.specialChunkIds, ...day.reviewChunkIds]
  )]
    .filter((id) => ((piece.progress[id] || {}).doneDays || []).includes(currentDay))
    .map((id) => chunkById[id])
    .filter(Boolean)
    .map((c) => ({ start: c.start, end: c.end }));

  return (
    <div className="tab-pane">
      <ScheduleBanner piece={piece} practiceChunks={practiceChunks} timeline={timeline} currentDay={currentDay} onReschedule={onReschedule} />

      <div className="tab-header day-nav">
        <div>
          <h1>Today's Practice</h1>
          <p className="hero-sub">Day {currentDay} of {timeline.days.length}{!isRealToday ? " (viewing)" : ""}</p>
        </div>
        <div className="day-nav-controls">
          <div className="segmented">
            <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")}>Day view</button>
            <button className={viewMode === "all" ? "active" : ""} onClick={() => setViewMode("all")}>View all</button>
          </div>
          {viewMode === "day" && (
            <>
              <button className="icon-btn" disabled={currentDay <= 1} onClick={() => onDayChange(currentDay - 1)} aria-label="Previous day"><ChevronLeft size={16} /></button>
              {!isRealToday && <button className="ghost-btn" onClick={onJumpToday}>Jump to today</button>}
              <button className="icon-btn" disabled={currentDay >= timeline.days.length} onClick={() => onDayChange(currentDay + 1)} aria-label="Next day, or work ahead"><ChevronRight size={16} /></button>
            </>
          )}
        </div>
      </div>

      <FocusPanel piece={piece} chunks={chunks} currentDay={currentDay} />
      <SectionRunThroughPanel
        piece={piece}
        practiceChunks={practiceChunks}
        currentDay={currentDay}
        onLogSession={onLogSession}
        onUnlogSession={onUnlogSession}
      />

      {viewMode === "day" ? (
        <DayChecklist piece={piece} chunks={chunks} day={day} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onToggleDone={onToggleDone} />
      ) : (
        <div className="view-all-list">
          {timeline.days.map((d) => (
            <DayChecklist key={d.dayNumber} piece={piece} chunks={chunks} day={d} onLogSession={onLogSession} onUnlogSession={onUnlogSession} onToggleDone={onToggleDone} />
          ))}
        </div>
      )}

      <ReassessPanel piece={piece} todaysRanges={todaysRanges} onReassessRange={onReassessRange} />
    </div>
  );
}

function ProgressTab({ piece, chunks, timeline, currentDay }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const practiceChunks = chunks.filter((c) => c.kind === "section");

  const plannedByDay = {};
  let cum = 0;
  timeline.days.forEach((d) => {
    cum += d.newChunkIds.length;
    plannedByDay[d.dayNumber] = cum;
  });

  const firstDone = {};
  practiceChunks.forEach((c) => {
    const dd = (piece.progress[c.id] || {}).doneDays || [];
    if (dd.length) firstDone[c.id] = Math.min(...dd);
  });
  const actualByDay = {};
  let acum = 0;
  for (let d = 1; d <= timeline.days.length; d++) {
    acum += Object.values(firstDone).filter((fd) => fd === d).length;
    actualByDay[d] = acum;
  }

  const plannedToday = plannedByDay[currentDay] || 0;
  const actualToday = actualByDay[currentDay] || 0;
  const diff = actualToday - plannedToday;
  const scheduleStatus = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
  const statusLabel =
    scheduleStatus.missedCount > 0
      ? `${scheduleStatus.missedCount} chunk${scheduleStatus.missedCount === 1 ? "" : "s"} behind schedule`
      : diff > 0
      ? `${diff} chunk${diff === 1 ? "" : "s"} ahead of schedule`
      : "Right on schedule";

  const confidences = chunks.map((c) => computeConfidence(c, piece, currentDay));
  const avgConfidence = chunks.length ? Math.round(confidences.reduce((s, v) => s + v, 0) / chunks.length) : 0;
  const solidCount = confidences.filter((v) => v >= 67).length;

  const historyByDay = {};
  Object.entries(piece.progress).forEach(([id, entry]) => {
    (entry.doneDays || []).forEach((d) => {
      if (!historyByDay[d]) historyByDay[d] = [];
      historyByDay[d].push(id);
    });
  });
  const historyDays = Object.keys(historyByDay).map(Number).sort((a, b) => b - a).slice(0, 10);

  const bpmChunks = chunks.filter((c) => (piece.progress[c.id] || {}).targetBPM);
  const maxCum = Math.max(plannedByDay[timeline.days.length] || 1, 1);
  const chartDays = timeline.days.slice(0, Math.min(timeline.days.length, Math.max(currentDay + 3, 14)));

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Progress</h1>
        <p className="hero-sub">{statusLabel}</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-num mono">{avgConfidence}%</span><span className="stat-lbl">Avg. confidence</span></div>
        <div className="stat-card"><span className="stat-num mono">{solidCount}/{chunks.length}</span><span className="stat-lbl">Tasks solid</span></div>
        <div className="stat-card"><span className="stat-num mono">{actualToday}</span><span className="stat-lbl">Chunks introduced</span></div>
        <div className="stat-card"><span className="stat-num mono">{plannedToday}</span><span className="stat-lbl">Planned by now</span></div>
      </div>

      <div className="panel">
        <h3>Actual vs. planned progress</h3>
        <div className="progress-chart">
          {chartDays.map((d) => {
            const p = plannedByDay[d.dayNumber];
            const a = actualByDay[d.dayNumber];
            return (
              <div key={d.dayNumber} className="progress-chart-col" title={`Day ${d.dayNumber}: ${a} actual / ${p} planned`}>
                <div className="progress-chart-bars">
                  <div className="progress-chart-bar planned" style={{ height: `${(p / maxCum) * 100}%` }} />
                  <div className="progress-chart-bar actual" style={{ height: `${(a / maxCum) * 100}%` }} />
                </div>
                {d.dayNumber % 5 === 0 && <span className="progress-chart-label mono">{d.dayNumber}</span>}
              </div>
            );
          })}
        </div>
        <div className="chart-legend">
          <span><i className="dot" style={{ background: "var(--ink-faint)" }} />Planned</span>
          <span><i className="dot" style={{ background: "var(--brass)" }} />Actual</span>
        </div>
      </div>

      <div className="panel">
        <h3>Tempo progress</h3>
        {bpmChunks.length === 0 ? (
          <p className="wizard-hint">Log a session or set a target BPM on any chunk to track tempo here.</p>
        ) : (
          <div className="bpm-list">
            {bpmChunks.map((c) => {
              const entry = piece.progress[c.id];
              const pct = Math.round(clamp((entry.currentBPM || 0) / entry.targetBPM, 0, 1) * 100);
              return (
                <div key={c.id} className="bpm-row-item">
                  <span className="mono">{formatRange(c.start, c.end)}</span>
                  <div className="bpm-track"><div className="bpm-fill" style={{ width: `${pct}%` }} /></div>
                  <span className="mono bpm-nums">{entry.currentBPM || 0} / {entry.targetBPM}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Recent practice history</h3>
        {historyDays.length === 0 ? (
          <p className="wizard-hint">Nothing logged yet — check items off in Today's Practice.</p>
        ) : (
          <div className="history-list">
            {historyDays.map((d) => (
              <div key={d} className="history-row">
                <span className="mono history-day">Day {d}</span>
                <span className="history-items">
                  {historyByDay[d]
                    .map((id) => (id === "__consolidation__" ? "Full run-through" : formatRange(chunkById[id].start, chunkById[id].end)))
                    .join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsTab({ piece, chunks, currentDay }) {
  const byDifficulty = ["easy", "medium", "hard"].map((level) => {
    const list = chunks.filter((c) => c.difficultyLabel === level);
    const avg = list.length
      ? Math.round(list.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / list.length)
      : 0;
    return { level, count: list.length, avg };
  });

  const practiceChunks = chunks.filter((c) => c.kind === "section");
  const recurringChunks = practiceChunks.filter((c) => c.recurring);
  const fullEffort = practiceChunks.reduce((s, c) => s + c.measureCount * c.avgDifficulty, 0);
  const actualEffort = practiceChunks.reduce((s, c) => s + c.effort, 0);
  const minutesSaved = Math.round((fullEffort - actualEffort) * EFFORT_TO_MIN);

  return (
    <div className="tab-pane">
      <div className="tab-header"><h1>Analytics</h1></div>

      <div className="panel">
        <h3>Confidence by difficulty</h3>
        <div className="analytics-bars">
          {byDifficulty.map((d) => (
            <div key={d.level} className="analytics-bar-row">
              <span className="analytics-bar-label">{DIFFICULTY_META[d.level].label} ({d.count})</span>
              <div className="analytics-bar-track"><div className="analytics-bar-fill" style={{ width: `${d.avg}%`, background: DIFFICULTY_META[d.level].color }} /></div>
              <span className="mono">{d.avg}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Recurring material payoff</h3>
        <p className="wizard-hint" style={{ marginBottom: 0 }}>
          {recurringChunks.length} chunk{recurringChunks.length === 1 ? "" : "s"} marked as recurring saved an
          estimated <strong>{minutesSaved}</strong> minutes of practice time in this plan.
        </p>
      </div>
    </div>
  );
}

function SettingsTab({ piece, editDraft, setEditDraft, onSave, onDelete, editing, onStartEdit, onDiscard, onAddPiece, onExportAll, onImportClick }) {
  if (!editing || !editDraft) {
    return (
      <div className="tab-pane">
        <div className="tab-header"><h1>Settings</h1></div>
        <div className="panel">
          <h3>Pieces</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>Add another piece to your practice rotation.</p>
          <button className="ghost-btn" onClick={onAddPiece}>
            <Plus size={14} /> Add new piece
          </button>
        </div>
        <div className="panel">
          <h3>Backup & restore</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>
            Everything is saved only in this browser. Export a backup file now and then, or before
            switching browsers or devices — you can import it back in later.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ghost-btn" onClick={onExportAll}>
              <Download size={14} /> Export all pieces
            </button>
            <button className="ghost-btn" onClick={onImportClick}>
              <Upload size={14} /> Import backup
            </button>
          </div>
        </div>
        <div className="panel">
          <h3>Piece details</h3>
          <dl className="def-list">
            <div><dt>Name</dt><dd>{piece.name}</dd></div>
            {piece.composer && <div><dt>Composer</dt><dd>{piece.composer}</dd></div>}
            <div><dt>Measures</dt><dd className="mono">{piece.totalMeasures}</dd></div>
            <div><dt>Sections</dt><dd className="mono">{piece.sections.length}</dd></div>
            <div><dt>Chunk size</dt><dd className="mono">{piece.chunkMode === "auto" ? `${autoChunkSize(piece.totalMeasures)} (auto)` : `${piece.customChunkSize} (custom)`}</dd></div>
            <div><dt>Recurring material</dt><dd>{piece.recurringMode === "none" ? "None" : piece.recurringMode === "basic" ? `${piece.recurringMeasures} measures (quick count)` : `${piece.recurringPairs.length} passage(s) mapped`}</dd></div>
            <div><dt>Schedule</dt><dd className="mono">{piece.daysToLearn} days, {piece.minutesPerDay} min/day</dd></div>
          </dl>
          {piece.notes && (
            <div className="piece-notes">
              <h4>Notes</h4>
              <p>{piece.notes}</p>
            </div>
          )}
          <button className="primary-btn" onClick={onStartEdit}>
            <Pencil size={15} /> Edit piece
          </button>
        </div>
        <div className="panel danger">
          <h3>Delete this piece</h3>
          <p className="wizard-hint">
            Removes "{piece.name || "this piece"}" and its practice history from this browser. Your
            other pieces aren't affected.
          </p>
          <button className="danger-btn" onClick={onDelete}>
            <RotateCcw size={15} /> Delete this piece
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-pane">
      <div className="tab-header"><h1>Edit piece</h1></div>
      <div className="panel"><h3>Piece</h3><BasicsFields draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Sections</h3><SectionsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Difficulty</h3><DifficultyEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Recurring material</h3><RecurringEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Schedule</h3><ScheduleFields draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Tempo zones</h3><BpmZonesEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="edit-actions">
        <button className="ghost-btn" onClick={onDiscard}>Discard changes</button>
        <button className="primary-btn" onClick={() => onSave(editDraft)}>
          <Check size={15} /> Save changes
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App shell                                                          */
/* ------------------------------------------------------------------ */

const NAV = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "timeline", label: "Timeline", icon: CalendarDays },
  { key: "map", label: "Piece Map", icon: Music2 },
  { key: "today", label: "Today's Practice", icon: ListChecks },
  { key: "progress", label: "Progress", icon: LineChart },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [pieces, setPieces] = useState({});
  const [activePieceId, setActivePieceId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [editDraft, setEditDraftState] = useState(null);
  const [dayOverride, setDayOverride] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const importInputRef = useRef(null);

  const piece = activePieceId ? pieces[activePieceId] : null;

  // Load every saved piece, then whichever one was active last.
  useEffect(() => {
    const found = {};
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(PIECE_KEY_PREFIX));
      keys.forEach((key) => {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const p = JSON.parse(raw);
            found[p.id] = p;
          }
        } catch (e) {
          /* skip unreadable entry */
        }
      });
    } catch (e) {
      /* storage unavailable (e.g. private browsing) */
    }
    setPieces(found);

    let active = null;
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      if (raw) active = JSON.parse(raw);
    } catch (e) {
      /* nothing saved yet */
    }
    if (!active || !found[active]) {
      const ids = Object.keys(found);
      active = ids.length ? ids[0] : null;
    }
    setActivePieceId(active);
    setLoaded(true);
  }, []);

  // Persist only the active piece when it changes.
  useEffect(() => {
    if (!loaded || !activePieceId || !pieces[activePieceId]) return;
    try {
      localStorage.setItem(PIECE_KEY_PREFIX + activePieceId, JSON.stringify(pieces[activePieceId]));
    } catch (e) {
      /* storage unavailable */
    }
  }, [pieces, activePieceId, loaded]);

  // Persist which piece is active.
  useEffect(() => {
    if (!loaded) return;
    try {
      if (activePieceId) localStorage.setItem(ACTIVE_KEY, JSON.stringify(activePieceId));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {
      /* storage unavailable */
    }
  }, [activePieceId, loaded]);

  const updatePiece = (updater) => {
    if (!activePieceId) return;
    setPieces((prev) => {
      const current = prev[activePieceId];
      if (!current) return prev;
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...prev, [activePieceId]: next };
    });
  };

  const chunkSet = useMemo(() => (piece ? generateAllChunks(piece) : null), [piece]);
  const chunks = chunkSet ? chunkSet.all : [];
  const practiceChunks = chunkSet ? chunkSet.practiceChunks : [];
  const timeline = useMemo(() => (piece ? getEffectiveTimeline(piece, chunkSet) : null), [piece, chunkSet]);
  const realCurrentDay = useMemo(
    () => (piece && timeline ? getCurrentDay(piece, timeline.days.length) : 1),
    [piece, timeline]
  );
  const currentDay = dayOverride || realCurrentDay;

  const switchToPiece = (id) => {
    setActivePieceId(id);
    setSwitcherOpen(false);
    setActiveTab("overview");
    setDayOverride(null);
    setSettingsEditing(false);
    setEditDraftState(null);
  };

  const handleComplete = (finished) => {
    const id = `p_${Date.now()}`;
    const withId = { ...finished, id };
    setPieces((prev) => ({ ...prev, [id]: withId }));
    setActivePieceId(id);
    setWizardOpen(false);
    setSwitcherOpen(false);
    setActiveTab("overview");
    setDayOverride(null);
  };

  const handleDeletePiece = () => {
    if (!piece) return;
    if (!window.confirm(`Delete "${piece.name}" and all its practice history? This can't be undone.`)) return;
    const idToDelete = piece.id;
    const remainingIds = Object.keys(pieces).filter((id) => id !== idToDelete);
    setPieces((prev) => {
      const next = { ...prev };
      delete next[idToDelete];
      return next;
    });
    try {
      localStorage.removeItem(PIECE_KEY_PREFIX + idToDelete);
    } catch (e) {
      /* storage unavailable */
    }
    setActivePieceId(remainingIds[0] || null);
    setEditDraftState(null);
    setSettingsEditing(false);
    setActiveTab("overview");
    setDayOverride(null);
  };

  const handleExportAll = () => {
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
  };

  const handleImportClick = () => importInputRef.current?.click();

  const handleImportFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        window.alert("That file doesn't look like a valid MeasureOne backup.");
        return;
      }
      const importedPieces = Array.isArray(data.pieces) ? data.pieces : Array.isArray(data) ? data : null;
      if (!importedPieces || importedPieces.length === 0) {
        window.alert("No pieces found in that backup file.");
        return;
      }
      const next = { ...pieces };
      let firstNewId = null;
      importedPieces.forEach((p) => {
        if (!p || !p.id) return;
        const id = next[p.id] ? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : p.id;
        const withId = { ...p, id };
        next[id] = withId;
        if (!firstNewId) firstNewId = id;
        try {
          localStorage.setItem(PIECE_KEY_PREFIX + id, JSON.stringify(withId));
        } catch (e) {
          /* storage unavailable */
        }
      });
      setPieces(next);
      if (!activePieceId && firstNewId) setActivePieceId(firstNewId);
      window.alert(`Imported ${importedPieces.length} piece(s).`);
    };
    reader.readAsText(file);
  };

  // Editing state lives here, not inside SettingsTab, so switching tabs
  // mid-edit doesn't unmount (and lose) the in-progress draft.
  const startEditing = () => {
    setEditDraftState((d) => d || { ...piece });
    setSettingsEditing(true);
    setActiveTab("settings");
  };
  const setEditDraft = (patch) => setEditDraftState((d) => ({ ...d, ...patch }));
  const handleSavePiece = (updated) => {
    updatePiece({ ...updated, rescheduleMarker: null });
    setEditDraftState(null);
    setSettingsEditing(false);
  };
  const handleDiscardEdit = () => {
    setEditDraftState(null);
    setSettingsEditing(false);
  };

  const handleToggleDone = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId], doneDays: [...progress[chunkId].doneDays] } : { doneDays: [] };
      const idx = entry.doneDays.indexOf(day);
      if (idx >= 0) entry.doneDays.splice(idx, 1);
      else entry.doneDays.push(day);
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleLogSession = (chunkId, day, cleanReps, bpm, effectiveness, durationSeconds) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId] || { doneDays: [] };
      const doneDays = prevEntry.doneDays.includes(day) ? prevEntry.doneDays : [...prevEntry.doneDays, day];
      const sessions = (prevEntry.sessions || []).filter((s) => s.day !== day);
      sessions.push({ day, cleanReps, bpm, effectiveness, durationSeconds });
      progress[chunkId] = { ...prevEntry, doneDays, sessions, currentBPM: bpm };
      return { ...p, progress };
    });
  };

  const handleUnlogSession = (chunkId, day) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const prevEntry = progress[chunkId];
      if (!prevEntry) return p;
      const doneDays = (prevEntry.doneDays || []).filter((d) => d !== day);
      const sessions = (prevEntry.sessions || []).filter((s) => s.day !== day);
      progress[chunkId] = { ...prevEntry, doneDays, sessions };
      return { ...p, progress };
    });
  };

  const handleUpdateBPM = (chunkId, field, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry[field] = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleSetManualConfidence = (chunkId, value) => {
    updatePiece((p) => {
      const progress = { ...p.progress };
      const entry = progress[chunkId] ? { ...progress[chunkId] } : { doneDays: [] };
      entry.manualConfidence = value;
      progress[chunkId] = entry;
      return { ...p, progress };
    });
  };

  const handleReassessRange = (from, to, level) => {
    const levelNum = level === "easy" ? 1 : level === "medium" ? 2 : 3;
    updatePiece((p) => {
      const measureDifficulty = [...p.measureDifficulty];
      for (let m = from; m <= to; m++) {
        if (m >= 1 && m <= measureDifficulty.length) measureDifficulty[m - 1] = levelNum;
      }
      return { ...p, measureDifficulty };
    });
  };

  const handleSelectDay = (dayNumber) => {
    setDayOverride(dayNumber);
    setActiveTab("today");
  };

  const handleReschedule = () => {
    const status = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
    if (status.remainingChunkIds.length === 0) return;

    const remaining = practiceChunks.filter((c) => status.remainingChunkIds.includes(c.id));
    const remainingEffort = remaining.reduce((s, c) => s + c.effort, 0);
    const availableDays = Math.max(1, timeline.days.length - currentDay + 1);
    const requiredDays = Math.max(
      1,
      Math.ceil(((remainingEffort * EFFORT_TO_MIN) / 0.65) / Math.max(5, piece.minutesPerDay))
    );

    let message = `This will rebalance the ${status.remainingChunkIds.length} chunk(s) you haven't started yet across the days left in your plan. Chunks you've already practiced stay where they are. Continue?`;
    if (requiredDays > availableDays) {
      message = `Heads up: at your current pace (${piece.minutesPerDay} min/day), what's left realistically needs about ${requiredDays} more day(s), but only ${availableDays} day(s) remain in this plan. Rescheduling will pack things in as tightly as possible, but you likely won't finish everything by your target date. You could extend the timeline in Settings instead.\n\nReschedule anyway?`;
    }

    if (!window.confirm(message)) return;
    updatePiece((p) => ({
      ...p,
      rescheduleMarker: { asOfDay: currentDay, remainingChunkOrder: status.remainingChunkIds },
    }));
  };

  const pieceList = Object.values(pieces).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  return (
    <div className="measureone-app">
      <style>{CSS}</style>
      <input
        type="file"
        accept="application/json"
        ref={importInputRef}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files[0];
          if (file) handleImportFile(file);
          e.target.value = "";
        }}
      />

      {!loaded ? (
        <div className="empty-state">
          <p className="wizard-hint" style={{ margin: 0 }}>Loading your pieces…</p>
        </div>
      ) : !piece ? (
        <div className="empty-state">
          <div className="hero-card empty-hero-card">
            <div className="hero-doodle-band"><ManuscriptDoodle /></div>
            <div className="hero-content empty-hero-content">
              <p className="eyebrow">MeasureOne</p>
              <h1>A practice plan for the piece that feels impossible.</h1>
              <p className="empty-sub">
                Tell us the measures, the hard parts, and how long you've got. We'll turn it into
                a day-by-day plan you can actually follow.
              </p>
              <button className="primary-btn lg" onClick={() => setWizardOpen(true)}>
                <Plus size={18} /> Start a new piece
              </button>
              {pieceList.length > 0 && (
                <button className="ghost-btn" style={{ marginTop: 16 }} onClick={() => switchToPiece(pieceList[pieceList.length - 1].id)}>
                  Return to Dashboard
                </button>
              )}
              <button className="ghost-btn" style={{ marginTop: 16 }} onClick={handleImportClick}>
                <Upload size={14} /> Import a backup
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="app-shell">
          <nav className="sidebar">
            <div className="brand"><BookOpen size={20} /><span>MeasureOne</span></div>

            <button className="piece-switcher-trigger" onClick={() => setSwitcherOpen((o) => !o)}>
              <span className="piece-switcher-name">{piece.name || "Untitled piece"}</span>
              <ChevronDown size={14} className={switcherOpen ? "rotated" : ""} />
            </button>
            {switcherOpen && (
              <div className="piece-switcher-list">
                {pieceList.map((p) => (
                  <button
                    key={p.id}
                    className={`piece-switcher-item ${p.id === activePieceId ? "active" : ""}`}
                    onClick={() => switchToPiece(p.id)}
                  >
                    {p.name || "Untitled piece"}
                  </button>
                ))}
                <button className="piece-switcher-add" onClick={() => { setWizardOpen(true); setSwitcherOpen(false); }}>
                  <Plus size={14} /> Add new piece
                </button>
              </div>
            )}

            <div className="nav-list">
              {NAV.map((n) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.key}
                    className={`nav-item ${activeTab === n.key ? "active" : ""}`}
                    onClick={() => setActiveTab(n.key)}
                  >
                    <Icon size={17} />
                    <span>{n.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="sidebar-foot">
              <button className="ghost-btn full" onClick={startEditing}>
                <Pencil size={14} /> Edit piece
              </button>
            </div>
          </nav>

          <main className="main-content">
            {activeTab === "overview" && (
              <OverviewTab piece={piece} practiceChunks={practiceChunks} timeline={timeline} currentDay={currentDay} onReschedule={handleReschedule} onAddPiece={() => setWizardOpen(true)} />
            )}
            {activeTab === "timeline" && <TimelineTab chunks={chunks} timeline={timeline} onSelectDay={handleSelectDay} />}
            {activeTab === "map" && (
              <PieceMapTab
                piece={piece}
                chunks={chunks}
                currentDay={currentDay}
                onUpdateBPM={handleUpdateBPM}
                onSetManualConfidence={handleSetManualConfidence}
              />
            )}
            {activeTab === "today" && (
              <TodayTab
                piece={piece}
                chunks={chunks}
                timeline={timeline}
                currentDay={currentDay}
                isRealToday={currentDay === realCurrentDay}
                onDayChange={(d) => setDayOverride(clamp(d, 1, timeline.days.length))}
                onJumpToday={() => setDayOverride(null)}
                onLogSession={handleLogSession}
                onUnlogSession={handleUnlogSession}
                onToggleDone={handleToggleDone}
                onReschedule={handleReschedule}
                onReassessRange={handleReassessRange}
              />
            )}
            {activeTab === "progress" && <ProgressTab piece={piece} chunks={chunks} timeline={timeline} currentDay={currentDay} />}
            {activeTab === "analytics" && <AnalyticsTab piece={piece} chunks={chunks} currentDay={currentDay} />}
            {activeTab === "settings" && (
              <SettingsTab
                piece={piece}
                editDraft={editDraft}
                setEditDraft={setEditDraft}
                onSave={handleSavePiece}
                onDelete={handleDeletePiece}
                editing={settingsEditing}
                onStartEdit={startEditing}
                onDiscard={handleDiscardEdit}
                onAddPiece={() => setWizardOpen(true)}
                onExportAll={handleExportAll}
                onImportClick={handleImportClick}
              />
            )}
          </main>
        </div>
      )}

      {wizardOpen && <Wizard onCancel={() => setWizardOpen(false)} onComplete={handleComplete} hasPiece={!!piece} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');

.measureone-app {
  --paper: #EEF0EC;
  --paper-card: #F8F9F6;
  --ink: #202A33;
  --ink-soft: #57646F;
  --ink-faint: #8B96A0;
  --line: rgba(32,42,51,0.14);
  --brass: #B98A3E;
  --brass-deep: #8F6A2D;
  --teal: #2E6E63;
  --brick: #B5473A;
  --white: #FFFFFF;
  font-family: 'Inter', sans-serif;
  color: var(--ink);
  background: var(--paper);
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
}
.measureone-app *, .measureone-app *::before, .measureone-app *::after { box-sizing: border-box; }
.measureone-app h1, .measureone-app h2, .measureone-app h3 {
  font-family: 'Fraunces', serif; font-weight: 600; margin: 0; color: var(--ink);
}
.measureone-app .mono { font-family: 'IBM Plex Mono', monospace; }
.measureone-app button { font-family: inherit; cursor: pointer; }
.measureone-app input { font-family: inherit; }
.measureone-app :focus-visible { outline: 2px solid var(--brass-deep); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .measureone-app * { transition: none !important; animation: none !important; }
}

.app-shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 232px; flex-shrink: 0; background: var(--paper-card); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; padding: 20px 14px; position: sticky; top: 0; height: 100vh;
}
.brand { display: flex; align-items: center; gap: 8px; padding: 6px 10px 20px; font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; color: var(--brass-deep); }
.nav-list { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; border: none;
  background: transparent; color: var(--ink-soft); font-size: 14px; font-weight: 500; text-align: left;
  width: 100%; transition: background .15s, color .15s;
}
.nav-item span { flex: 1; }
.nav-item:hover { background: rgba(185,138,62,0.1); color: var(--ink); }
.nav-item.active { background: var(--brass); color: var(--white); }
.sidebar-foot { padding-top: 12px; border-top: 1px solid var(--line); margin-top: 8px; }

.piece-switcher-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--white); font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 10px; }
.piece-switcher-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.piece-switcher-trigger svg.rotated { transform: rotate(180deg); }
.piece-switcher-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; padding: 6px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; max-height: 240px; overflow-y: auto; }
.piece-switcher-item { text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; font-size: 13px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.piece-switcher-item:hover { background: rgba(185,138,62,0.08); }
.piece-switcher-item.active { background: var(--brass); color: var(--white); font-weight: 600; }
.piece-switcher-add { display: flex; align-items: center; gap: 6px; text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; font-size: 13px; color: var(--brass-deep); font-weight: 600; border-top: 1px solid var(--line); margin-top: 4px; padding-top: 10px; }
.piece-switcher-add:hover { background: rgba(185,138,62,0.08); }

.main-content { flex: 1; padding: 32px 40px 64px; max-width: 940px; }

@media (max-width: 820px) {
  .app-shell { flex-direction: column; }
  .sidebar { width: 100%; height: auto; position: static; flex-direction: row; align-items: center; overflow-x: auto; padding: 10px; gap: 10px; }
  .brand { padding: 6px 10px; }
  .nav-list { flex-direction: row; }
  .nav-item span { display: none; }
  .sidebar-foot { display: none; }
  .main-content { padding: 20px; }
}

.empty-state { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.empty-hero-card { max-width: 620px; }
.empty-hero-content { text-align: center; padding: 12px 36px 40px; }
.empty-hero-content h1 { font-size: clamp(26px, 4vw, 36px); line-height: 1.15; margin: 10px 0 16px; }
.empty-sub { color: var(--ink-soft); font-size: 15px; line-height: 1.6; margin: 0 0 26px; }

.eyebrow { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: var(--brass-deep); margin: 0 0 6px; font-weight: 600; }

.hero-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.hero-doodle-band { padding: 14px 24px 0; background: linear-gradient(180deg, rgba(185,138,62,0.07), rgba(185,138,62,0)); }
.manuscript-doodle { width: 100%; height: 64px; display: block; opacity: 0.16; }
.hero-content { padding: 6px 32px 32px; }
.hero-content h1 { font-size: clamp(22px, 3vw, 30px); line-height: 1.2; }
.hero-sub { color: var(--ink-soft); font-size: 14px; margin-top: 8px; }
.hero-composer { color: var(--ink-soft); font-size: 15px; font-style: italic; margin-top: 2px; }

.manuscript-strip { display: flex; height: 46px; border-radius: 8px; margin: 20px 0 4px; border: 1px solid var(--line); position: relative; }
.manuscript-strip.compact { height: 28px; }
.manuscript-block { position: relative; border-right: 2px solid var(--paper); min-width: 3px; }
.manuscript-block:first-child { border-top-left-radius: 7px; border-bottom-left-radius: 7px; }
.recurring-dot { position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.85); }
.final-barline { width: 4px; background: var(--ink); border-top-right-radius: 7px; border-bottom-right-radius: 7px; }
.block-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-6px);
  background: var(--ink);
  color: var(--paper);
  font-size: 11px;
  line-height: 1.3;
  padding: 4px 9px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  z-index: 20;
}
.manuscript-block:hover .block-tooltip, .manuscript-block:focus-visible .block-tooltip { opacity: 1; }
.manuscript-block:first-child .block-tooltip { left: 0; transform: translateY(-6px); }
.manuscript-block:nth-last-child(2) .block-tooltip { left: auto; right: 0; transform: translateY(-6px); }

.tab-pane { display: flex; flex-direction: column; gap: 22px; }
.overview-top-row { display: flex; justify-content: flex-end; margin-bottom: -8px; }
.tab-header { margin-bottom: -4px; }
.tab-header h1 { font-size: 26px; }
.day-nav { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.day-nav-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.panel { background: var(--paper-card); border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; }
.panel h3 { font-size: 15px; margin-bottom: 14px; }
.panel.danger { border-color: rgba(181,71,58,0.35); }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 640px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
.stat-card { background: var(--paper-card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 4px; }
.stat-num { font-size: 24px; font-weight: 600; color: var(--brass-deep); }
.stat-lbl { font-size: 12px; color: var(--ink-soft); }

.bal-row { display: flex; height: 14px; border-radius: 7px; overflow: hidden; }
.bal-seg { height: 100%; }
.diff-summary { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.diff-summary-item { font-size: 13.5px; color: var(--ink-soft); display: flex; align-items: center; }
.diff-summary-item strong { color: var(--ink); margin-left: 4px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; flex-shrink: 0; }

.day-preview-list { display: flex; flex-direction: column; }
.day-preview-row { display: flex; align-items: center; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.day-preview-row:last-child { border-bottom: none; }
.day-num { width: 56px; color: var(--brass-deep); flex-shrink: 0; }
.day-desc { flex: 1; color: var(--ink-soft); }
.day-min { color: var(--ink-faint); flex-shrink: 0; }

.def-list { display: flex; flex-direction: column; gap: 10px; margin: 0 0 18px; }
.def-list > div { display: flex; justify-content: space-between; font-size: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); gap: 12px; }
.def-list dt { color: var(--ink-soft); }
.def-list dd { margin: 0; text-align: right; }

.piece-notes { margin: 0 0 18px; }
.piece-notes h4 { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); margin: 0 0 6px; }
.piece-notes p { margin: 0; font-size: 14px; color: var(--ink); white-space: pre-wrap; line-height: 1.5; }
.edit-actions { display: flex; justify-content: flex-end; gap: 10px; padding-bottom: 20px; }

.week-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.day-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--white); }
.day-card.clickable { cursor: pointer; text-align: left; font: inherit; color: inherit; width: 100%; }
.day-card.clickable:hover { border-color: var(--brass); }
.day-card.consolidation { background: rgba(185,138,62,0.08); }
.day-card-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-soft); margin-bottom: 8px; }
.day-card-min { color: var(--brass-deep); }
.day-card-note { font-size: 12.5px; color: var(--ink-soft); margin: 0; }
.day-card-group { margin-bottom: 6px; }
.day-card-tag { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); margin-bottom: 4px; }
.day-card-tag.special { color: var(--brass-deep); }
.chip { display: inline-block; font-size: 11.5px; font-family: 'IBM Plex Mono', monospace; background: var(--teal); color: var(--white); padding: 2px 7px; border-radius: 5px; margin: 0 4px 4px 0; }
.chip.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.chip.transition { background: var(--brass); }

.diff-grid-wrap { border: 1px solid var(--line); border-radius: 10px; padding: 10px; max-height: 300px; overflow-y: auto; background: var(--white); }
.diff-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 4px; }
.diff-cell { aspect-ratio: 1; border: none; border-radius: 4px; font-size: 9px; font-family: 'IBM Plex Mono', monospace; color: var(--white); }
.diff-cell.diff-1 { background: var(--teal); }
.diff-cell.diff-2 { background: var(--brass); }
.diff-cell.diff-3 { background: var(--brick); }
.diff-cell:hover { filter: brightness(1.1); }

.badge { display: inline-block; font-size: 9.5px; background: rgba(255,255,255,0.25); padding: 1px 6px; border-radius: 20px; margin-left: 6px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.03em; }
.badge.dark { background: rgba(185,138,62,0.18); color: var(--brass-deep); }
.manual-mark { margin-left: 4px; vertical-align: middle; opacity: 0.6; }
.manual-conf-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.manual-conf-row input { width: 80px; flex-shrink: 0; }
.derived-stat { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; }
.derived-stat strong { color: var(--brass-deep); }

.schedule-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: rgba(181,71,58,0.08); border: 1px solid rgba(181,71,58,0.3); border-radius: 14px; padding: 16px 20px; }
.schedule-banner-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; margin: 0 0 4px; color: var(--brick); }
.schedule-banner-sub { font-size: 12.5px; color: var(--ink-soft); margin: 0; max-width: 480px; }

.confidence-legend { display: flex; gap: 18px; font-size: 13px; color: var(--ink-soft); flex-wrap: wrap; }
.confidence-legend span { display: flex; align-items: center; }
.map-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.map-cell { position: relative; border: 1px solid var(--line); border-radius: 10px; padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; background: var(--white); text-align: left; }
.map-cell.tier-teal { background: rgba(46,110,99,0.14); border-color: rgba(46,110,99,0.4); }
.map-cell.tier-brass { background: rgba(185,138,62,0.14); border-color: rgba(185,138,62,0.4); }
.map-cell.tier-brick { background: rgba(181,71,58,0.14); border-color: rgba(181,71,58,0.4); }
.map-cell.selected { outline: 2px solid var(--ink); outline-offset: -1px; }
.map-cell-kind { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-faint); }
.map-cell-range { font-size: 12.5px; font-weight: 600; }
.map-cell-conf { font-size: 15px; font-weight: 600; color: var(--ink); display: flex; align-items: center; }
.map-cell-diff-dot { position: absolute; top: 10px; right: 10px; width: 8px; height: 8px; border-radius: 50%; }
.diff-dot-easy { background: var(--teal); }
.diff-dot-medium { background: var(--brass); }
.diff-dot-hard { background: var(--brick); }
.map-cell-recurring { position: absolute; bottom: 10px; right: 10px; font-size: 13px; color: var(--ink-faint); }

.detail-panel { border-color: var(--ink); }
.detail-modal { max-width: 480px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.detail-modal .modal-body { padding: 22px 22px 24px; }
.detail-stats { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.detail-stats > div { display: flex; justify-content: space-between; font-size: 13.5px; border-bottom: 1px solid var(--line); padding-bottom: 7px; }
.detail-stats .lbl { color: var(--ink-soft); }
.detail-stats .val { font-weight: 600; }

.bpm-track { height: 10px; border-radius: 6px; background: var(--paper); overflow: hidden; flex: 1; }
.bpm-fill { height: 100%; background: var(--brass); border-radius: 6px; }
.bpm-list { display: flex; flex-direction: column; gap: 10px; }
.bpm-row-item { display: flex; align-items: center; gap: 12px; font-size: 12.5px; }
.bpm-row-item .mono:first-child { width: 90px; flex-shrink: 0; }
.bpm-nums { width: 90px; flex-shrink: 0; text-align: right; color: var(--ink-soft); }

.checklist { display: flex; flex-direction: column; gap: 10px; }
.checklist-item { display: flex; gap: 12px; align-items: flex-start; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--white); }
.checklist-item.checked { background: rgba(46,110,99,0.08); border-color: rgba(46,110,99,0.35); }
.checklist-check { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--teal); background: rgba(46,110,99,0.15); flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--teal); margin-top: 2px; }
.checklist-check-empty { width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--ink-faint); background: var(--white); flex-shrink: 0; margin-top: 2px; padding: 0; cursor: pointer; transition: border-color .15s, background .15s; }
.checklist-check-empty:hover:not(:disabled) { border-color: var(--teal); background: rgba(46,110,99,0.08); }
.checklist-check-empty:disabled { cursor: not-allowed; opacity: 0.6; }
.checklist-body { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.checklist-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.checklist-label { font-weight: 700; }
.tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 20px; font-weight: 600; }
.tag-new { background: var(--brass); color: var(--white); }
.tag-review { background: var(--ink-soft); color: var(--white); }
.tag-transition { background: var(--teal); color: var(--white); }
.tag-combo { background: var(--brick); color: var(--white); }
.tag-section-runthrough { background: var(--brass-deep); color: var(--white); }
.tag-section-transition { background: var(--ink); color: var(--white); }
.tag.subtle { background: transparent; border: 1px solid var(--line); color: var(--ink-soft); }
.conf-pill { margin-left: auto; font-size: 12px; color: var(--brass-deep); font-weight: 600; }
.tip-line { font-size: 12px; color: var(--ink-soft); margin: 0; }
.timer-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.timer-btn { border: 1px solid var(--line); background: var(--white); color: var(--ink-soft); border-radius: 7px; padding: 5px 12px; font-size: 12px; font-weight: 600; }
.timer-btn.running { background: var(--brick); border-color: var(--brick); color: var(--white); }
.timer-display { font-size: 13px; color: var(--ink-soft); min-width: 40px; }
.log-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.log-row label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--ink-soft); font-weight: 600; }
.log-row input { width: 90px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 13px; background: var(--white); color: var(--ink); font-family: 'IBM Plex Mono', monospace; }
.feel-row { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--ink-soft); font-weight: 600; margin-top: 8px; }
.primary-btn.sm { padding: 7px 14px; font-size: 12.5px; }

.view-all-list { display: flex; flex-direction: column; gap: 14px; }

.focus-panel { border-color: rgba(181,71,58,0.3); }
.focus-list { display: flex; flex-direction: column; gap: 8px; }
.focus-row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.focus-row:last-child { border-bottom: none; padding-bottom: 0; }
.focus-conf { margin-left: auto; font-weight: 600; color: var(--brick); }

.reassess-panel { border-color: rgba(185,138,62,0.35); }
.reassess-prompt { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.reassess-quickpicks { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }

.progress-chart { display: flex; align-items: flex-end; gap: 6px; height: 140px; padding-top: 10px; }
.progress-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
.progress-chart-bars { display: flex; gap: 2px; align-items: flex-end; height: 120px; width: 100%; justify-content: center; }
.progress-chart-bar { width: 6px; border-radius: 3px 3px 0 0; }
.progress-chart-bar.planned { background: var(--ink-faint); opacity: 0.5; }
.progress-chart-bar.actual { background: var(--brass); }
.progress-chart-label { font-size: 9px; color: var(--ink-faint); }
.chart-legend { display: flex; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--ink-soft); }
.chart-legend span { display: flex; align-items: center; }

.history-list { display: flex; flex-direction: column; gap: 8px; }
.history-row { display: flex; gap: 14px; font-size: 13px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.history-row:last-child { border-bottom: none; padding-bottom: 0; }
.history-day { color: var(--brass-deep); width: 56px; flex-shrink: 0; }
.history-items { color: var(--ink-soft); }

.analytics-bars { display: flex; flex-direction: column; gap: 14px; }
.analytics-bar-row { display: flex; align-items: center; gap: 12px; }
.analytics-bar-label { width: 110px; flex-shrink: 0; font-size: 13px; color: var(--ink-soft); }
.analytics-bar-track { flex: 1; height: 10px; border-radius: 6px; background: var(--paper); overflow: hidden; }
.analytics-bar-fill { height: 100%; border-radius: 6px; }

.primary-btn { display: inline-flex; align-items: center; gap: 8px; background: var(--brass); color: var(--white); border: none; border-radius: 9px; padding: 10px 18px; font-size: 14px; font-weight: 600; transition: background .15s; }
.primary-btn:hover:not(:disabled) { background: var(--brass-deep); }
.primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.primary-btn.lg { padding: 13px 24px; font-size: 15px; }

.ghost-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 9px; padding: 9px 16px; font-size: 13.5px; font-weight: 500; transition: border-color .15s, background .15s; }
.ghost-btn:hover { border-color: var(--brass); background: rgba(185,138,62,0.06); }
.ghost-btn.full { width: 100%; justify-content: center; }

.danger-btn { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--brick); color: var(--brick); border-radius: 9px; padding: 9px 16px; font-size: 13.5px; font-weight: 600; }
.danger-btn:hover { background: rgba(181,71,58,0.08); }

.icon-btn { background: transparent; border: none; color: var(--ink-soft); width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
.icon-btn:hover:not(:disabled) { background: rgba(32,42,51,0.06); color: var(--ink); }
.icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.modal-overlay { position: fixed; inset: 0; background: rgba(32,42,51,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { background: var(--paper-card); border-radius: 16px; width: 100%; max-width: 640px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--line); }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--line); }
.modal-steps { display: flex; gap: 16px; flex-wrap: wrap; }
.modal-step { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-faint); font-weight: 500; }
.modal-step.active { color: var(--brass-deep); }
.modal-step.done { color: var(--teal); }
.modal-step-dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
.modal-body { padding: 26px 26px 10px; overflow-y: auto; flex: 1; }
.modal-foot { display: flex; justify-content: space-between; padding: 18px 26px; border-top: 1px solid var(--line); }

.wizard-pane h2 { font-size: 20px; margin-bottom: 6px; }
.wizard-hint { color: var(--ink-soft); font-size: 13.5px; margin: 0 0 20px; line-height: 1.5; }

.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.field > span { font-size: 12.5px; font-weight: 600; color: var(--ink-soft); }
.field input[type="text"], .field input[type="number"] { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); }
.field textarea { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 14px; background: var(--white); color: var(--ink); font-family: inherit; resize: vertical; }
.field input:disabled { color: var(--ink-faint); background: var(--paper); }
.field-row { display: flex; gap: 16px; }
.field-row .field { flex: 1; }

.segmented { display: inline-flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; flex-wrap: wrap; }
.segmented button { border: none; background: var(--white); color: var(--ink-soft); padding: 8px 14px; font-size: 13px; font-weight: 500; border-right: 1px solid var(--line); }
.segmented button:last-child { border-right: none; }
.segmented button.active { background: var(--brass); color: var(--white); }

.pairs-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.pair-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); flex-wrap: wrap; }
.pair-row input { width: 52px; border: 1px solid var(--line); border-radius: 6px; padding: 6px; font-size: 13px; text-align: center; font-family: 'IBM Plex Mono', monospace; background: var(--white); color: var(--ink); }
.pair-row input.name-input { width: 120px; text-align: left; font-family: 'Inter', sans-serif; }
.pair-label { flex-shrink: 0; }

.review-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 20px; }
.review-stat { background: var(--white); border: 1px solid var(--line); border-radius: 10px; padding: 14px; text-align: center; }
.review-stat .num { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; color: var(--brass-deep); }
.review-stat .lbl { font-size: 11px; color: var(--ink-soft); }
`;
