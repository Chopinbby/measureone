import { clamp, rangesOverlap, daysBetweenInclusive, todayISODate } from "./utils";
import { EFFORT_TO_MIN } from "./constants";
import { computeConfidence, getDefaultTargetBPM, sessionOutcome } from "./confidence";

/* ------------------------------------------------------------------ */
/*  Revival: recovering a piece that was learned once but has gone     */
/*  stale. Deliberately reuses the existing chunk/transition/          */
/*  confidence/progress data model rather than a parallel one — see    */
/*  docs/Data-Model.md#revival and docs/Algorithms.md#revival.         */
/* ------------------------------------------------------------------ */

// The single source of truth for "is this piece currently in revival?".
//
// `piece.revival` records an in-progress run two ways — the `active`
// boolean and the `startedAt` timestamp — always set and cleared together
// (handleStartRevival / handleEndRevival, App.jsx). Because both were
// live, call sites drifted into checking different ones: most of the UI
// read `active`, while computeDueReviews and TodayTab read `startedAt`.
// They can't disagree through any path the app itself takes, so this was
// never a live bug — but it left the same rule written down twice, in two
// shapes, with nothing keeping them in step.
//
// Standardized on `active`: answering this yes/no question is that
// field's entire job, whereas `startedAt` has a real second one — it's
// the cutoff computeComboEscalations uses to tell which logged sessions
// belong to the current run. Each field now does only what it's for.
export function isInRevival(piece) {
  return !!(piece && piece.revival && piece.revival.active);
}

// Same target-resolution rule as the non-revival path (confidence.js's
// getSuggestedStartingBPM): a chunk's own explicit target wins, falling
// back to the piece-wide default. Revival used to let a piece-wide
// `revival.performanceTempo`, collected at entry, override this — reverted
// (Pass 35) because it silently beat an explicit per-chunk target with no
// way to tell from the tempo ladder alone which source it came from. See
// docs/Decisions.md#revival.
export function getRevivalTargetBPM(piece, chunk) {
  const entry = piece.progress[chunk.id] || {};
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
// Combos don't get their own base-plan task here — they relearn through
// their underlying content (the anchor hard chunk, already a practice
// chunk in `items` below, plus whichever neighbor(s) the combo's range
// overlaps), not as a separate item. A combo only gets an explicit task
// if that underlying content actually goes wrong during this run — see
// computeComboEscalations below. (The static code comment that used to
// exclude combos unconditionally was an unreviewed assumption, not a
// settled decision — see Decisions.md#spaced-repetition--maintenance.)
export function computeRevivalPlan(piece, chunkSet, currentDay) {
  const items = [...chunkSet.practiceChunks, ...chunkSet.transitions].map((c) => ({
    id: c.id,
    effort: c.effort,
    confidence: computeConfidence(c, piece, currentDay),
    // `flag` used to be the boolean-only `weakSpot` field; widened to
    // 'rough' | 'lost' | undefined by the post-run-through logging design
    // (Repertoire-Lifecycle.md), but prioritization here stays exactly the
    // binary "flagged at all vs not" it always was — not a redesign into a
    // three-tier lost-before-rough sort.
    flagged: !!(piece.progress[c.id] || {}).flag,
  }));

  // Flagged chunks first, then lowest confidence first — the two
  // prioritization signals the product asks for, in that order.
  items.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
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

// A combo's `linkedIds` only stores its anchor hard chunk's id — not the
// flanking chunk(s) that actually define its start/end range (a combo
// spans midpoint-to-midpoint across its neighbors, chunking.js's
// generateComboChunks). "Underlying content" for revival purposes means
// every practice chunk the combo's range genuinely overlaps, computed
// fresh here rather than trusted from linkedIds — that field means
// something narrower elsewhere (e.g. scheduling.js's timeline-readiness
// gating, which only cares about the anchor) and was never meant to be
// "the whole story" for a combo.
export function findComboUnderlyingChunks(combo, practiceChunks) {
  return practiceChunks.filter((c) => rangesOverlap(combo.start, combo.end, c.start, c.end));
}

// The most recent session logged on `sessions` at/after `startedAt`, or
// null if none qualify.
function latestQualifyingSession(sessions, startedAt) {
  const qualifying = (sessions || []).filter((s) => s.loggedAt >= startedAt);
  if (!qualifying.length) return null;
  return qualifying.reduce((latest, s) => (s.loggedAt > latest.loggedAt ? s : latest));
}

// Which combos should currently show up as their own explicit revival
// task. Combos don't get one by default (see computeRevivalPlan above) —
// only while some underlying chunk's *own* most recent attempt this
// revival run is a real fail, or the combo's own dedicated task's most
// recent attempt is. A single real fail is enough (not the maintenance
// ladder's two-consecutive-fails threshold, lib/ladder.js) — confirmed
// with the user: revival is already "something's wrong" mode by the time
// it's running, unlike ordinary practice, where that dampening exists
// specifically to avoid overreacting to one bad day.
//
// Each underlying chunk is judged strictly by its OWN latest qualifying
// session, never compared against a different chunk's timestamp. (An
// earlier version pooled every underlying chunk's sessions together with
// the combo's own and picked one single globally-newest session across
// all of them — so if chunk A failed and chunk B was later passed, B's
// unrelated pass would incorrectly clear A's still-standing failure. A
// version before that scanned for "any fail ever," which had the
// opposite problem: one early fail pinned the combo escalated for the
// rest of the run even after being cleanly relearned. Both fixed here —
// per-chunk recency, not global recency, and not "any fail ever.")
//
// The combo's own sessions (the dedicated "Needs another look" task,
// RevivalTab.jsx — logged under `combo.id`, not fanned out across the
// chunks it overlaps, which would corrupt their independent histories)
// get a distinct role, not just another source pooled in with the rest:
// a fail there always (re-)escalates, same as any underlying chunk's own
// fail. A PASS there is the one thing allowed to override a still-failing
// underlying chunk — but only if it's actually more recent than every
// underlying chunk's own latest fail, so a stale combo-task pass from
// before a chunk's most recent failure can't paper over it.
//
// Deliberately a live derivation off `piece`, not a task written into and
// persisted on `piece.revival.plan` — same spirit as `chunkSet`/`timeline`
// being pure, unpersisted derivations (CLAUDE.md). A written task would
// need an explicit removal path once the underlying content is later
// relearned cleanly; a derivation just stops returning it once nothing
// currently qualifies, so "the flag clears automatically" (the doc's own
// phrasing for this) falls out for free rather than needing to be built.
// Revival's three documented auto-trigger conditions (Repertoire-
// Lifecycle.md#revival-auto-triggers), each checked independently — any
// one firing is enough to offer a revival. Deliberately not unified into
// one formula: condition 3 is a distinct fallback for a piece nobody has
// touched, not a diluted version of 1/2, which can only fire off data a
// logged run-through actually produced.
//
// All three require `planComplete` (the caller's own
// `isPlanActuallyComplete` result) — revival is "a piece you've already
// learned that's gone stale, gone rough, or lost a chunk," not a signal
// for a piece still mid-learning. A rough run-through, a lost flag, or
// weeks of silence on an *unfinished* piece isn't this condition; that's
// `computeAbandonedPlanReminder`'s question instead (lib/scheduling.js),
// which offers reschedule/pause rather than revival. (Condition 3 was the
// first of the three gated this way; conditions 1 and 2 followed once it
// was pointed out that a piece still mid-learning could otherwise trip
// them just as easily as a finished one — same gap, same fix, applied to
// all three rather than left half-closed.)
//
// 1. Stop count > 5 on a single logged run-through — reads the
//    section-run-through sessions Pass 6 logs onto the synthetic
//    "__consolidation__" progress entry (handleLogRunThrough, App.jsx).
// 2. "Large chunks lost" — any combo-kind chunk currently flagged 'lost',
//    or 2+ regular practice chunks currently flagged 'lost'. Flags are a
//    persistent current-state field (progress[id].flag), not a per-
//    run-through log, so this reads the live flag state across the piece
//    rather than a specific run-through event.
// 3. 60+ days since anything was logged on the piece at all — reads
//    piece.lastLoggedAt (an ISO calendar date, stamped by every logged
//    session/run-through), not a plan-day number, since a stale piece may
//    be well past its plan's bounded day range.
//
// Returns { triggered, reasons } — reasons is a list of { key, label }
// for every condition that independently fired, for display.
export function computeRevivalTriggers(piece, chunkSet, planComplete) {
  if (!planComplete) return { triggered: false, reasons: [] };

  const reasons = [];
  const progress = piece.progress || {};

  const runThroughSessions = (progress["__consolidation__"] || {}).sessions || [];
  if (runThroughSessions.some((s) => (s.stopCount || 0) > 5)) {
    reasons.push({ key: "stopCount", label: "A recent run-through needed more than 5 stops" });
  }

  const comboLost = (chunkSet.combos || []).some((c) => (progress[c.id] || {}).flag === "lost");
  const lostPracticeChunkCount = (chunkSet.practiceChunks || []).filter(
    (c) => (progress[c.id] || {}).flag === "lost"
  ).length;
  if (comboLost || lostPracticeChunkCount >= 2) {
    reasons.push({
      key: "largeChunksLost",
      label: comboLost
        ? "A large section was flagged lost in a run-through"
        : "Multiple chunks were flagged lost in a run-through",
    });
  }

  if (piece.lastLoggedAt) {
    const daysSinceLogged = daysBetweenInclusive(piece.lastLoggedAt, todayISODate()) - 1;
    if (daysSinceLogged >= 60) {
      reasons.push({ key: "staleness", label: `It's been ${daysSinceLogged} days since anything was logged` });
    }
  }

  return { triggered: reasons.length > 0, reasons };
}

export function computeComboEscalations(piece, chunkSet) {
  const startedAt = (piece.revival || {}).startedAt;
  if (!startedAt) return [];
  return (chunkSet.combos || []).filter((combo) => {
    const underlying = findComboUnderlyingChunks(combo, chunkSet.practiceChunks);

    const failingChunkTimestamps = underlying
      .map((c) => latestQualifyingSession((piece.progress[c.id] || {}).sessions, startedAt))
      .filter((s) => s && sessionOutcome(s) === "fail")
      .map((s) => s.loggedAt);

    const comboLatest = latestQualifyingSession((piece.progress[combo.id] || {}).sessions, startedAt);

    if (comboLatest && sessionOutcome(comboLatest) === "fail") return true;
    if (!failingChunkTimestamps.length) return false;

    const mostRecentUnderlyingFail = Math.max(...failingChunkTimestamps);
    if (comboLatest && sessionOutcome(comboLatest) === "pass" && comboLatest.loggedAt >= mostRecentUnderlyingFail) {
      return false;
    }
    return true;
  });
}
