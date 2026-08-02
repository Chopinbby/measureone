import { clamp } from "./utils";
import { EFFORT_TO_MIN } from "./constants";
import { computeConfidence, getDefaultTargetBPM } from "./confidence";

/* ------------------------------------------------------------------ */
/*  Revival: recovering a piece that was learned once but has gone     */
/*  stale. Deliberately reuses the existing chunk/transition/          */
/*  confidence/progress data model rather than a parallel one — see    */
/*  docs/Data-Model.md#revival and docs/Algorithms.md#revival.         */
/* ------------------------------------------------------------------ */

// During an active revival, a piece-wide performance tempo (collected at
// revival entry) takes priority over whatever target was set while first
// learning the piece — the point of revival is often to land at a real
// performance tempo that differs from the original learning target, and that
// intent should win even where a chunk already has its own explicit target.
export function getRevivalTargetBPM(piece, chunk) {
  const entry = piece.progress[chunk.id] || {};
  if (piece.revival && piece.revival.active && piece.revival.performanceTempo) {
    return piece.revival.performanceTempo;
  }
  return entry.targetBPM || getDefaultTargetBPM(piece, chunk);
}

// A small number of evenly-spaced steps from a conservative starting tempo up
// to the real target, inclusive of the target itself. Rounding can collapse
// steps together when the starting fraction is close to 1 — deduped rather
// than shown as a misleading run of repeated BPM values.
export function computeTempoLadder(targetBPM, startFraction, steps) {
  if (!targetBPM) return [];
  const frac = clamp(startFraction ?? 0.6, 0.1, 0.95);
  const stepCount = Math.max(2, steps || 5);
  const start = Math.round(targetBPM * frac);
  const ladder = [];
  for (let i = 0; i < stepCount - 1; i++) {
    ladder.push(Math.round(start + (targetBPM - start) * (i / (stepCount - 1))));
  }
  ladder.push(targetBPM);
  return [...new Set(ladder)];
}

// The revival plan is intentionally a distinct, simpler function rather than
// an adaptation of computeTimeline: computeTimeline's defining behaviors
// (spread new-chunk introduction across the first half, defer combos to the
// back half, adaptive review offsets keyed off introduction day) all exist to
// manage *first-time introduction* of material, which has no equivalent
// concept in revival — everything here was already learned once. What's
// reused instead are the same primitives computeTimeline itself is built on:
// generateAllChunks's practice chunks/transitions (with their effort scores),
// EFFORT_TO_MIN, and piece.minutesPerDay, packed greedily the same way
// ScheduleFields already estimates day counts elsewhere in this file.
// Combos are intentionally excluded — revival reassessment only covers
// practice chunks and transitions (seams), per the product scope.
export function computeRevivalPlan(piece, chunkSet, currentDay) {
  const items = [...chunkSet.practiceChunks, ...chunkSet.transitions].map((c) => ({
    id: c.id,
    effort: c.effort,
    confidence: computeConfidence(c, piece, currentDay),
    weakSpot: !!(piece.progress[c.id] || {}).weakSpot,
  }));

  // Weak spots first, then lowest confidence first — the two prioritization
  // signals the product asks for, in that order.
  items.sort((a, b) => {
    if (a.weakSpot !== b.weakSpot) return a.weakSpot ? -1 : 1;
    return a.confidence - b.confidence;
  });

  const minutesPerDay = Math.max(5, Number(piece.minutesPerDay) || 30);
  const dailyBudget = minutesPerDay / EFFORT_TO_MIN;

  const days = [];
  let current = { itemIds: [], effort: 0 };
  items.forEach((item) => {
    if (current.effort > 0 && current.effort + item.effort > dailyBudget) {
      days.push(current);
      current = { itemIds: [], effort: 0 };
    }
    current.itemIds.push(item.id);
    current.effort += item.effort;
  });
  if (current.itemIds.length) days.push(current);

  return {
    days: days.map((d, i) => ({ dayNumber: i + 1, itemIds: d.itemIds, minutes: Math.round(d.effort * EFFORT_TO_MIN) })),
    totalItems: items.length,
    generatedAt: Date.now(),
  };
}
