/* ------------------------------------------------------------------ */
/*  Technique practice engine (Pass 99) — scales and arpeggios.        */
/*  Pure functions only: no React, no storage, and no clock. Every     */
/*  function that needs a date takes `today` (an ISO "YYYY-MM-DD"      */
/*  string) as an argument; nothing here reads the current date.       */
/*                                                                     */
/*  Design: docs/Technique-Practice.md. Mechanics:                     */
/*  docs/Algorithms.md#technique-practice-engine-pass-99.              */
/*  Technique data is app-level, never part of a piece — nothing here  */
/*  touches `piece`. Repertoire keys come in as an argument.           */
/* ------------------------------------------------------------------ */

import {
  TECHNIQUE_WALK_LAP_DAYS,
  TECHNIQUE_STARRED_DAYS_PER_WEEK,
  TECHNIQUE_REPERTOIRE_DAYS_PER_WEEK,
  TECHNIQUE_BOTH_DAYS_PER_WEEK_EVEN,
  TECHNIQUE_BOTH_DAYS_PER_WEEK_ODD,
  TECHNIQUE_WEEK_PARITY_EPOCH,
  TECHNIQUE_PACE_MIN_GAP_DAYS,
  TECHNIQUE_STARTING_TEMPO_FRACTION,
  TECHNIQUE_TASKS_PER_DAY,
  TECHNIQUE_METHODS_PER_SCALE_MIN,
  TECHNIQUE_METHODS_PER_SCALE_MAX,
  TECHNIQUE_MAX_METHODS_PER_TECHNIQUE,
  TECHNIQUE_STARRED_METHOD_WEIGHT,
  TECHNIQUE_SLOW_FRACTION,
  TECHNIQUE_SLOW_COOLDOWN_DAYS,
  TECHNIQUE_WALK_ITEMS_PER_KEY_MAX,
} from "./constants";
import { addDaysISO, daysBetweenInclusive, startOfWeekISO } from "./utils";

/* ---------------------------- Method catalog ---------------------------- */

export const TECHNIQUE_TAGS = [
  "Rhythm",
  "Dynamics",
  "Articulation",
  "Motion",
  "Hand coordination",
  "Fingering",
  "Memory",
];

// appliesTo: "both" (scales and arpeggios) | "scale" | "arpeggio" |
// "together" (hands together only). Ids are stable — saved user state
// (starred/enabled) and last-used dates key off them, so never rename one.
// Names, tags and instructions follow the approved mockup
// (docs/mockups/technique-practice.html).
export const BUILT_IN_METHODS = [
  { id: "dotted", name: "Dotted rhythm, then its inverse", technique: "Rhythm", appliesTo: "both",
    description: "Long-short, then short-long, up and down the scale." },
  { id: "qqee", name: "Every order of quarter, quarter, eighth, eighth", technique: "Rhythm", appliesTo: "both",
    description: "Cycle through all the orderings of the four-note cell across the scale." },
  { id: "halfq", name: "Half notes against quarter notes", technique: "Rhythm", appliesTo: "both",
    description: "Half notes in one hand, quarter notes in the other, then swap." },
  { id: "eighthtrip", name: "Eighths against triplets", technique: "Rhythm", appliesTo: "both",
    description: "Eighths in one hand, triplets in the other. Feel where the beats line up." },
  { id: "ladder", name: "Subdivision ladder", technique: "Rhythm", appliesTo: "both",
    description: "Quarters, then eighths, then triplets, then sixteenths, keeping the beat steady." },
  { id: "pf", name: "One hand piano, the other forte", technique: "Dynamics", appliesTo: "both",
    description: "Right hand soft and left hand loud, then swap." },
  { id: "stac", name: "One hand staccato, the other legato", technique: "Articulation", appliesTo: "both",
    description: "Right hand staccato and left hand legato, then swap." },
  { id: "contrary", name: "Contrary motion from opposite ends", technique: "Motion", appliesTo: "together",
    description: "Start the hands at opposite ends of the keyboard and meet in the middle." },
  { id: "formula", name: "Formula (Russian) pattern", technique: "Motion", appliesTo: "scale",
    description: "Play the scale using the formula (Russian) pattern." },
  { id: "stagger", name: "Staggered entry", technique: "Hand coordination", appliesTo: "together",
    description: "One hand plays up to the third, fourth, fifth, or sixth scale degree, then the other hand starts its scale on the first." },
  { id: "cross", name: "Touch before the thumb crossing", technique: "Fingering", appliesTo: "both",
    description: "Stop on the finger before each thumb crossing and rest the thumb on its next note without playing it. Then continue." },
  { id: "eyes", name: "Eyes closed", technique: "Memory", appliesTo: "both",
    description: "Play it without looking at your hands." },
  { id: "chain", name: "Chaining", technique: "Memory", appliesTo: "both",
    description: "Build the passage one note at a time: notes 1–2, then 1–3, then 1–4, and so on." },
];

// Built-ins plus custom methods, each with the user's saved state applied.
// `methodState` is { [methodId]: { starred, enabled } }; a method with no
// saved state is unstarred and enabled.
export function resolveMethods(methodState = {}, customMethods = []) {
  return [...BUILT_IN_METHODS, ...customMethods].map((m) => {
    const s = methodState[m.id] || {};
    return { ...m, starred: !!s.starred, enabled: s.enabled !== false };
  });
}

// "Hands together only" means hands === "together" — a third or sixth
// apart is its own hand position, and contrary motion / staggered entry
// don't make sense there.
export function methodFitsItem(method, item) {
  switch (method.appliesTo) {
    case "scale": return item.form === "scale";
    case "arpeggio": return item.form === "arpeggio";
    case "together": return item.hands === "together";
    default: return true;
  }
}

/* ------------------------------- Key math ------------------------------- */

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Pitch class 0-11 of a tonic spelled "C", "F#", "F♯", "Gb", "G♭", ...
// Enharmonic spellings give the same number. null if unparseable.
export function pitchClass(tonic) {
  if (typeof tonic !== "string") return null;
  const m = tonic.trim().match(/^([A-Ga-g])([#♯b♭]*)$/);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const acc of m[2]) pc += acc === "#" || acc === "♯" ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

// Accepts { tonic, quality } or a string like "G minor" / "F# major".
// Returns { pc, quality } or null.
export function normalizeKey(key) {
  if (!key) return null;
  let tonic, quality;
  if (typeof key === "string") {
    const parts = key.trim().split(/\s+/);
    tonic = parts[0];
    quality = (parts[1] || "major").toLowerCase();
  } else {
    tonic = key.tonic;
    quality = key.quality;
  }
  const pc = pitchClass(tonic);
  if (pc == null || (quality !== "major" && quality !== "minor")) return null;
  return { pc, quality };
}

export function sameKey(a, b) {
  const x = normalizeKey(a);
  const y = normalizeKey(b);
  return !!x && !!y && x.pc === y.pc && x.quality === y.quality;
}

export function relativeMinorPc(majorPc) {
  return (majorPc + 9) % 12;
}

// Majors around the circle of fifths, by pitch class:
// C G D A E B F#/Gb Db Ab Eb Bb F.
const CIRCLE_MAJOR_PCS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// The 24-day walk: each major, then its relative minor. Position 0 is C
// major, 1 is A minor, ... 23 is D minor, then back to C.
export const WALK_KEYS = CIRCLE_MAJOR_PCS.flatMap((pc) => [
  { pc, quality: "major" },
  { pc: relativeMinorPc(pc), quality: "minor" },
]);

function itemKey(item) {
  return normalizeKey({ tonic: item.tonic, quality: item.quality });
}

function itemInKey(item, key) {
  const k = itemKey(item);
  return !!k && k.pc === key.pc && k.quality === key.quality;
}

function rotationItems(items) {
  return (items || []).filter((it) => it.inRotation !== false);
}

// First walk position at or after `walkPosition` (wrapping around the lap)
// whose key has at least one in-rotation item. null if no key does.
export function effectiveWalkPosition(walkPosition, items) {
  const pool = rotationItems(items);
  for (let i = 0; i < TECHNIQUE_WALK_LAP_DAYS; i++) {
    const pos = (((walkPosition || 0) + i) % TECHNIQUE_WALK_LAP_DAYS + TECHNIQUE_WALK_LAP_DAYS) % TECHNIQUE_WALK_LAP_DAYS;
    if (pool.some((it) => itemInKey(it, WALK_KEYS[pos]))) return pos;
  }
  return null;
}

// For the Technique page's walk hint ("Circle of fifths: D major today,
// B minor next."). Both skip keys with no in-rotation items; `next` wraps
// across the end of the lap. Returns null if the library has no keys at
// all. `next` equals `today` when only one key has items.
export function walkKeyOfDay(items, walkPosition) {
  const todayPos = effectiveWalkPosition(walkPosition, items);
  if (todayPos == null) return null;
  const nextPos = effectiveWalkPosition(todayPos + 1, items);
  return {
    today: { position: todayPos, ...WALK_KEYS[todayPos] },
    next: { position: nextPos, ...WALK_KEYS[nextPos] },
  };
}

// What the Technique page's walk hint should say ("Circle of fifths: D
// major today, B minor next."), or null to hide it. Returns
// { today: { position, pc, quality }, next: { … } }.
//
// - If a walk-advancing task was already checked off today, "today" is the
//   key that task finished (read from its undo snapshot) and "next" is where
//   the walk sits now — so the hint doesn't vanish or jump ahead the moment
//   the key of the day is done (Pass 101 review fix). If several advanced
//   the walk today, the first one's key is today's.
// - Otherwise the hint shows only if a task on today's list is in the key of
//   the day. On a day when starred, repertoire or slow scales fill every
//   slot, the walk doesn't run, and naming a key nobody is practicing would
//   be wrong.
export function walkHint(items, walkPosition, dayList) {
  const current = effectiveWalkPosition(walkPosition, items);
  if (current == null || !dayList) return null;
  const byId = new Map((items || []).map((it) => [it.id, it]));
  const keyAt = (pos) => ({ position: pos, ...WALK_KEYS[pos] });

  const advancing = dayList.tasks.filter((t) => t.done && t.undo && t.undo.advancedTo != null && byId.has(t.itemId));
  if (advancing.length) {
    const advancedTo = new Set(advancing.map((t) => t.undo.advancedTo));
    const first = advancing.find((t) => !advancedTo.has(t.undo.walkPosition)) || advancing[0];
    const item = byId.get(first.itemId);
    const todayPos = WALK_KEYS.findIndex((k) => itemInKey(item, k));
    if (todayPos >= 0) return { today: keyAt(todayPos), next: keyAt(current) };
  }

  const onList = dayList.tasks.some((t) => byId.has(t.itemId) && itemInKey(byId.get(t.itemId), WALK_KEYS[current]));
  if (!onList) return null;
  const next = effectiveWalkPosition(current + 1, items);
  return { today: keyAt(current), next: keyAt(next) };
}

/* --------------------------------- Pace --------------------------------- */

// Is this item in one of the given keys (the active pieces' keys)?
export function isRepertoireItem(item, repertoireKeys) {
  const k = itemKey(item);
  if (!k) return false;
  return (repertoireKeys || []).some((rk) => {
    const r = normalizeKey(rk);
    return !!r && r.pc === k.pc && r.quality === k.quality;
  });
}

function weekParity(today) {
  const weeks = Math.round((daysBetweenInclusive(TECHNIQUE_WEEK_PARITY_EPOCH, startOfWeekISO(today)) - 1) / 7);
  return ((weeks % 2) + 2) % 2;
}

// Target practice days this calendar week (Monday–Sunday) for a starred
// and/or repertoire-key item; 0 for an ordinary item.
export function paceDaysPerWeek(item, repertoireKeys, today) {
  const rep = isRepertoireItem(item, repertoireKeys);
  const star = !!item.starred;
  if (rep && star) {
    return weekParity(today) === 0 ? TECHNIQUE_BOTH_DAYS_PER_WEEK_EVEN : TECHNIQUE_BOTH_DAYS_PER_WEEK_ODD;
  }
  if (rep) return TECHNIQUE_REPERTOIRE_DAYS_PER_WEEK;
  if (star) return TECHNIQUE_STARRED_DAYS_PER_WEEK;
  return 0;
}

// Days since `dateStr` (0 = today, 1 = yesterday); Infinity if never.
function daysSince(dateStr, today) {
  if (!dateStr) return Infinity;
  return daysBetweenInclusive(dateStr, today) - 1;
}

// Is a paced item due today, and how urgent is it? Due while it still has
// days left in this week's target, and either it wasn't practiced
// yesterday (min gap) or the rest of the week can't hold its remaining
// days otherwise. `urgency` is remaining days ÷ days left in the week —
// "most overdue first" sorts on it.
export function paceStatus(item, repertoireKeys, today) {
  const target = paceDaysPerWeek(item, repertoireKeys, today);
  if (target === 0) return { due: false, target, remaining: 0, urgency: 0 };
  const weekStart = startOfWeekISO(today);
  const practicedThisWeek = new Set(
    (item.practicedDates || []).filter((d) => d >= weekStart && d < today)
  ).size;
  const remaining = target - practicedThisWeek;
  const daysLeft = daysBetweenInclusive(today, addDaysISO(weekStart, 6));
  if (remaining <= 0) return { due: false, target, remaining: 0, urgency: 0 };
  const gapOk = daysSince(item.lastPracticedDate, today) >= TECHNIQUE_PACE_MIN_GAP_DAYS;
  const forced = remaining >= daysLeft;
  return { due: gapOk || forced, target, remaining, urgency: remaining / daysLeft };
}

/* ------------------------------ Slow tier ------------------------------- */

// The slowest third of the in-rotation items, by count, ordered by even
// tempo ascending — "relative to the user's own range" means against
// their own other items, not an absolute BPM. No tempo yet counts as
// slowest. The third is taken first, then the cooldown filters it, so an
// item just practiced doesn't let a faster one in behind it.
//
// By count, not by position in the tempo range: with a range cut, a new
// library with no tempos saved (or all tempos equal) would make every
// item "slow" and this tier would crowd out the walk for weeks.
export function slowItems(items, today) {
  const pool = rotationItems(items);
  const sorted = [...pool].sort((a, b) =>
    (a.evenTempo ?? -Infinity) - (b.evenTempo ?? -Infinity) ||
    String(a.id).localeCompare(String(b.id)));
  const third = sorted.slice(0, Math.ceil(pool.length * TECHNIQUE_SLOW_FRACTION));
  return third.filter((it) => daysSince(it.lastPracticedDate, today) >= TECHNIQUE_SLOW_COOLDOWN_DAYS);
}

/* ------------------------------- Methods -------------------------------- */

// The methods this item's most recent completed session used — every
// method with the item's latest last-used date.
function lastSessionMethodIds(lastUsedForItem) {
  const dates = Object.values(lastUsedForItem || {});
  if (!dates.length) return new Set();
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  return new Set(Object.keys(lastUsedForItem).filter((id) => lastUsedForItem[id] === latest));
}

// 3-4 methods for one item: fit (form/hands) and switched on; longest
// since used on this item first, starred counting double; at most two of
// one technique; the last session's methods skipped. If skipping the last
// session would leave fewer than the minimum, those come back in at the
// end rather than showing a short list. `lastUsedForItem` is
// { [methodId]: ISO date }, written only when a task is completed.
export function pickMethods(item, methods, lastUsedForItem = {}, today) {
  const fitting = methods.filter((m) => m.enabled !== false && methodFitsItem(m, item));
  const skip = lastSessionMethodIds(lastUsedForItem);
  const order = new Map(methods.map((m, i) => [m.id, i]));
  const score = (m) => {
    const since = daysSince(lastUsedForItem[m.id], today);
    return since * (m.starred ? TECHNIQUE_STARRED_METHOD_WEIGHT : 1);
  };
  const rank = (a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sb - sa;
    if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
    return order.get(a.id) - order.get(b.id);
  };
  const fresh = fitting.filter((m) => !skip.has(m.id)).sort(rank);
  const repeat = fitting.filter((m) => skip.has(m.id)).sort(rank);

  const picked = [];
  const perTechnique = {};
  const take = (pool, limit) => {
    for (const m of pool) {
      if (picked.length >= limit) break;
      if (picked.includes(m)) continue;
      if ((perTechnique[m.technique] || 0) >= TECHNIQUE_MAX_METHODS_PER_TECHNIQUE) continue;
      picked.push(m);
      perTechnique[m.technique] = (perTechnique[m.technique] || 0) + 1;
    }
  };
  take(fresh, TECHNIQUE_METHODS_PER_SCALE_MAX);
  if (picked.length < TECHNIQUE_METHODS_PER_SCALE_MIN) take(repeat, TECHNIQUE_METHODS_PER_SCALE_MIN);
  return picked.map((m) => m.id);
}

/* ------------------------------ Day list -------------------------------- */

// Builds today's list (at most TECHNIQUE_TASKS_PER_DAY tasks):
//   0. carried over — the previous list's unfinished tasks, same methods;
//   1. pace — starred / repertoire-key items due today, most urgent first;
//   2. slow — slowest third, not practiced in the cooldown window;
//   3. walk — 1-2 items in the key of the day.
// If `previousList` is already today's list it's returned unchanged, so the
// list is stable across screens and re-renders. Items not in rotation (or
// deleted) are never added and are dropped from carry-over.
//
// state: { items, methods (resolved), methodLastUsed: { [itemId]:
//   { [methodId]: date } }, walkPosition, previousList, repertoireKeys }
// Returns { date, tasks: [{ itemId, methodIds, done, tier }] }.
export function buildDayList(state, today, tasksPerDay = TECHNIQUE_TASKS_PER_DAY) {
  const { previousList = null } = state;
  if (previousList && previousList.date === today) return previousList;
  return { date: today, tasks: fillTasks(state, today, tasksPerDay, [], previousList?.tasks || []) };
}

// Fills the free slots of today's list without touching what's already on
// it (done or not, in the same order). Used when a scale is added or put
// back in rotation mid-day, so a short or empty list doesn't have to wait
// until tomorrow (Pass 101, on direct request). Items already on the list
// are never added twice. Returns the list unchanged if it's full, missing,
// or not today's.
export function topUpDayList(state, dayList, today, tasksPerDay = TECHNIQUE_TASKS_PER_DAY) {
  if (!dayList || dayList.date !== today || dayList.tasks.length >= tasksPerDay) return dayList;
  const tasks = fillTasks(state, today, tasksPerDay, dayList.tasks, []);
  return tasks.length === dayList.tasks.length ? dayList : { ...dayList, tasks };
}

// Shared by buildDayList and topUpDayList: starts from `startTasks` (kept
// as-is), then carry-over, pace, slow, walk, up to the cap.
function fillTasks(state, today, tasksPerDay, startTasks, carryTasks) {
  const { items = [], methods = [], methodLastUsed = {}, walkPosition = 0, repertoireKeys = [] } = state;
  const pool = rotationItems(items);
  const byId = new Map(pool.map((it) => [it.id, it]));
  const tasks = [...startTasks];
  const onList = new Set(startTasks.map((t) => t.itemId));
  const add = (item, tier, methodIds) => {
    if (tasks.length >= tasksPerDay || onList.has(item.id)) return;
    onList.add(item.id);
    tasks.push({
      itemId: item.id,
      methodIds: methodIds || pickMethods(item, methods, methodLastUsed[item.id], today),
      done: false,
      tier,
    });
  };

  // 0. Carry-over.
  for (const t of carryTasks) {
    if (t.done || !byId.has(t.itemId)) continue;
    add(byId.get(t.itemId), "carried", t.methodIds);
  }

  // 1. Pace (starred / repertoire key).
  pool
    .map((it) => ({ it, p: paceStatus(it, repertoireKeys, today) }))
    .filter(({ p }) => p.due)
    .sort((a, b) =>
      b.p.urgency - a.p.urgency ||
      daysSince(b.it.lastPracticedDate, today) - daysSince(a.it.lastPracticedDate, today) ||
      String(a.it.id).localeCompare(String(b.it.id)))
    .forEach(({ it }) => add(it, "pace"));

  // 2. Slow.
  slowItems(pool, today).forEach((it) => add(it, "slow"));

  // 3. Walk.
  const pos = effectiveWalkPosition(walkPosition, pool);
  if (pos != null) {
    pool
      .filter((it) => itemInKey(it, WALK_KEYS[pos]) && !onList.has(it.id))
      .sort((a, b) =>
        daysSince(b.lastPracticedDate, today) - daysSince(a.lastPracticedDate, today) ||
        String(a.id).localeCompare(String(b.id)))
      .slice(0, TECHNIQUE_WALK_ITEMS_PER_KEY_MAX)
      .forEach((it) => add(it, "walk"));
  }

  return tasks;
}

// Takes an item's unfinished task off today's list — used when the item is
// switched out of rotation mid-day, so it doesn't sit there checkable until
// tomorrow. A done task stays: it's a record of practice that happened.
// Returns the list unchanged if there's nothing to remove.
export function removeUnfinishedTask(dayList, itemId) {
  if (!dayList || !dayList.tasks.some((t) => t.itemId === itemId && !t.done)) return dayList;
  return { ...dayList, tasks: dayList.tasks.filter((t) => t.itemId !== itemId || t.done) };
}

/* ---------------------------- Completing a task ------------------------- */

const PRACTICED_DATES_KEPT = 14; // two calendar weeks is all paceStatus reads

// Marks a task on today's list done. A check with a tempo sets the item's
// new even-tempo baseline; a bare check-off (tempo null/undefined) counts
// as done and practiced but leaves the saved tempo alone. The task's
// methods are recorded as used only here, on completion. The walk advances
// when the completed item is in the key of the day — completion, never the
// calendar, moves it.
//
// state: { items, dayList, methodLastUsed, walkPosition }
// Returns a new state object; inputs are not mutated.
export function completeTask(state, itemId, today, tempo = null) {
  const { items = [], dayList, methodLastUsed = {}, walkPosition = 0 } = state;
  const task = dayList?.tasks.find((t) => t.itemId === itemId);
  if (!task || task.done) return state;

  const keyOfDayPos = effectiveWalkPosition(walkPosition, items);
  const hasTempo = typeof tempo === "number" && Number.isFinite(tempo) && tempo > 0;

  let completedItem = null;
  const nextItems = items.map((it) => {
    if (it.id !== itemId) return it;
    const dates = [...new Set([...(it.practicedDates || []), today])]
      .sort()
      .filter((d) => d >= addDaysISO(today, -(PRACTICED_DATES_KEPT - 1)));
    completedItem = {
      ...it,
      lastPracticedDate: today,
      practicedDates: dates,
      ...(hasTempo ? { evenTempo: tempo, lastCheckedDate: today } : {}),
    };
    return completedItem;
  });

  const previousUsed = methodLastUsed[itemId] || {};
  const usedForItem = { ...previousUsed };
  for (const mid of task.methodIds) usedForItem[mid] = today;

  let nextWalk = walkPosition;
  let advancedTo = null;
  if (completedItem && keyOfDayPos != null && itemInKey(completedItem, WALK_KEYS[keyOfDayPos])) {
    nextWalk = (keyOfDayPos + 1) % TECHNIQUE_WALK_LAP_DAYS;
    advancedTo = nextWalk;
  }

  // Everything this completion changes, so uncompleteTask can put it back.
  const before = items.find((it) => it.id === itemId) || {};
  const undo = {
    walkPosition,
    advancedTo,
    // The check octaves the tempo belongs to — see uncompleteTask.
    checkOctaves: before.checkOctaves ?? null,
    item: {
      lastPracticedDate: before.lastPracticedDate ?? null,
      practicedDates: before.practicedDates || [],
      evenTempo: before.evenTempo ?? null,
      lastCheckedDate: before.lastCheckedDate ?? null,
    },
    methodLastUsed: Object.fromEntries(task.methodIds.map((mid) => [mid, previousUsed[mid] ?? null])),
  };

  return {
    ...state,
    items: nextItems,
    dayList: {
      ...dayList,
      tasks: dayList.tasks.map((t) => (t.itemId === itemId ? { ...t, done: true, tempo: hasTempo ? tempo : null, undo } : t)),
    },
    methodLastUsed: { ...methodLastUsed, [itemId]: usedForItem },
    walkPosition: nextWalk,
  };
}

// Reverses completeTask for one task on today's list (Pass 101, on direct
// request): the item's practice dates and tempo, the task's method
// last-used dates, and the walk step go back to what they were. The walk
// is only stepped back if nothing has moved it since (a later completion
// in the next key stays put). Fields the user changed separately (star,
// rotation, octaves) are left alone, and so is the tempo if the check
// octaves changed in between. A done task with no snapshot (none
// exists today, but a hand-edited save could have one) can't be undone
// and returns the state unchanged.
export function uncompleteTask(state, itemId) {
  const { items = [], dayList, methodLastUsed = {}, walkPosition = 0 } = state;
  const task = dayList?.tasks.find((t) => t.itemId === itemId);
  if (!task || !task.done || !task.undo) return state;
  const { undo } = task;

  // If the check octaves changed since the check-off (Library → keep or
  // start fresh), the tempo in the snapshot was measured over a different
  // number of octaves than the item now uses — putting it back would undo
  // the user's keep/start-fresh choice. The dates still go back; the tempo
  // fields stay as they are now (Pass 101 review fix).
  const octavesChanged = (it) => undo.checkOctaves != null && it.checkOctaves !== undo.checkOctaves;
  const nextItems = items.map((it) => {
    if (it.id !== itemId) return it;
    const { evenTempo, lastCheckedDate, ...dates } = undo.item;
    return octavesChanged(it) ? { ...it, ...dates } : { ...it, ...undo.item };
  });

  const used = { ...(methodLastUsed[itemId] || {}) };
  for (const [mid, prev] of Object.entries(undo.methodLastUsed || {})) {
    if (prev == null) delete used[mid];
    else used[mid] = prev;
  }
  const nextUsed = { ...methodLastUsed };
  if (Object.keys(used).length) nextUsed[itemId] = used;
  else delete nextUsed[itemId];

  const nextWalk = undo.advancedTo != null && walkPosition === undo.advancedTo ? undo.walkPosition : walkPosition;

  return {
    ...state,
    items: nextItems,
    dayList: {
      ...dayList,
      tasks: dayList.tasks.map((t) => {
        if (t.itemId !== itemId) return t;
        const { undo: _drop, ...rest } = t;
        return { ...rest, done: false, tempo: null };
      }),
    },
    methodLastUsed: nextUsed,
    walkPosition: nextWalk,
  };
}

/* --------------------------- Tempo and octaves -------------------------- */

// 85% of the last verified even tempo, rounded; null when there is none.
export function startingTempo(item) {
  if (item?.evenTempo == null) return null;
  return Math.round(item.evenTempo * TECHNIQUE_STARTING_TEMPO_FRACTION);
}

// Changing an item's even-rhythm check octaves. With no `choice`, an item
// that has a saved tempo returns status "needs-prompt" and is unchanged
// (the UI asks "keep as a starting point, or start fresh?"; leaving without
// choosing discards the change). choice "keep" applies the new octaves and
// keeps the tempo; "fresh" applies them and clears the tempo so the next
// check sets it. No saved tempo: applied directly, no prompt.
export function changeCheckOctaves(item, newOctaves, choice) {
  if (newOctaves === item.checkOctaves) return { status: "unchanged", item };
  if (item.evenTempo == null) return { status: "applied", item: { ...item, checkOctaves: newOctaves } };
  if (choice === "keep") return { status: "applied", item: { ...item, checkOctaves: newOctaves } };
  if (choice === "fresh") return { status: "applied", item: { ...item, checkOctaves: newOctaves, evenTempo: null } };
  return { status: "needs-prompt", item };
}
