/* ------------------------------------------------------------------ */
/*  Merging the technique library by part (Pass 118).                  */
/*  docs/Algorithms.md "Merging the technique library by part".        */
/*                                                                     */
/*  The ENGINE only: pure functions, no React, no network, no clock,   */
/*  nothing wired into the app. It does for the technique library what */
/*  lib/pieceMerge.js (Pass 117) does for a piece: starting from what  */
/*  both devices last agreed on (the `base`), what changed on each     */
/*  side, and can the changes be put together without asking anyone?   */
/*  Unlike a piece, the answer here is ALWAYS yes: the library has no  */
/*  chunk grid to disagree about, and where both sides changed the     */
/*  same thing differently the account's value is kept and a notice    */
/*  says so (never a question).                                        */
/*                                                                     */
/*  The library is split into PARTS, each with a fingerprint. The      */
/*  device record keeps those fingerprints as of the last sync         */
/*  (`parts`, lib/accountSync.js); no copy of the library is kept.     */
/*  Comparing today's fingerprints with the recorded ones says which   */
/*  parts each side changed. The parts (see techniquePartKey):         */
/*    - per scale (by id): which scale it is, starred, switched on,    */
/*      octaves, hands, the tempo check (tempo, check date and check   */
/*      octaves, which only mean something together), the last         */
/*      practiced date, each practiced date on its own, and the date   */
/*      each method was last used on it, one by one                    */
/*    - per method: starred, switched on; per custom method: its       */
/*      definition                                                     */
/*    - the settings (scales per day, minutes per scale)               */
/*    - the walk position                                              */
/*    - per task on today's list (by date and scale): whether it's     */
/*      done (with its tempo and undo note), and which methods it      */
/*      uses and in which tier                                         */
/*  A part holding its default is left out, so "no part" and "the      */
/*  default" are the same thing.                                       */
/*                                                                     */
/*  Per part: unchanged on both sides, nothing to do; changed on one   */
/*  side only, take that side's value (an undo on one side travels the */
/*  same way, because it changes the same parts the check-off did);    */
/*  changed on both to the same value, agreement; changed on both to   */
/*  different values, a rule per kind of part:                         */
/*    - a scale's octaves or hands, and the settings: the account's    */
/*      (remote) value is kept, and a notice says so. (A yes/no part,  */
/*      starred or switched on, can't conflict: changed on both sides  */
/*      means changed to the same other value.)                        */
/*    - the tempo check: the newer check wins, an empty tempo never    */
/*      replaces a real one (mergeImportedTechnique's rules); on the   */
/*      same date a real tempo beats an empty one, and two different   */
/*      real tempos keep the account's, with a notice                  */
/*    - practiced dates: each date is a part of its own, so a date     */
/*      added on either side is kept and one undone on one side only   */
/*      is gone; the last practiced date is the later of the two       */
/*    - the date a method was last used on a scale: each is its own    */
/*      part, so a use added on either side is kept, one undone on one */
/*      side only is gone, and the later date wins when both changed   */
/*    - a task: done on either side wins (a completion survives unless */
/*      undone on one side ONLY); the account's for the rest           */
/*    - the walk position: the account's, then see "the walk" below    */
/*  Scales and custom methods are never removed by a merge: one that   */
/*  is on one side only is kept (the app has no way to delete one      */
/*  anyway; switching a scale off is a setting).                       */
/*                                                                     */
/*  Today's list: the same date merges task by task; different dates,  */
/*  the later date's list wins whole (what was done on the earlier day */
/*  is already in the scales' own parts). A task on one list only is   */
/*  kept if the base never had it (it was added there), or changed     */
/*  there; one the other side took off (the app does that when its     */
/*  scale is switched off) and this side left alone is taken off too.  */
/*  So two lists built apart on the same day can add up to more than   */
/*  scalesPerDay; trimming them is left for a later pass.              */
/*  A done task means its scale was practiced that day, so the merge   */
/*  puts that day back into the scale's practiced dates, last          */
/*  practiced date and last-used methods if it left them out (an undo  */
/*  on one side meeting a redo on the other). It only ever adds.       */
/*                                                                     */
/*  The walk: completing a task in the key of the day steps it once    */
/*  (lib/technique.js, nextWalkPosition). The walk is merged like any  */
/*  part, then checked against the done tasks: a done task keeps a     */
/*  note of the step it took, and if the walk was taken from one side  */
/*  while a completion that stepped it came from the other side, and   */
/*  the walk still stands where that step began, the step is taken     */
/*  ONCE, with the engine's own advance (see settleWalk). It never     */
/*  steps twice for one day: two devices that both did the day's task  */
/*  agree on one step, and a side's own walk already holds its own     */
/*  steps.                                                             */
/*                                                                     */
/*  This file also owns canonicalTechnique, which lib/accountSync.js   */
/*  re-exports, so the engine never imports the account code and the   */
/*  account code can import the engine without a cycle.                */
/* ------------------------------------------------------------------ */

import { validateAndMigrateTechnique } from "./storage";
import { isObject, toJsonValue, fingerprint } from "./pieceMerge";
import { nextWalkPosition } from "./technique";

/* ------------------------------------------------------------------ */
/*  The canonical form                                                 */
/* ------------------------------------------------------------------ */

// The library in the form loading would give it (the same function the load
// uses, after the same trip through JSON that saving and loading make), so a
// library that was uploaded and then simply reloaded reads as unchanged. What's
// SENT is still the app's own copy. A value that can't be put in that form is
// used as it is. Never cached: a caller may change an object between calls.
export function canonicalTechnique(technique) {
  const plain = toJsonValue(technique);
  if (!isObject(plain)) return plain;
  try {
    return toJsonValue(validateAndMigrateTechnique(plain));
  } catch (e) {
    return plain;
  }
}

/* ------------------------------------------------------------------ */
/*  Parts                                                              */
/* ------------------------------------------------------------------ */

// A part's key is its kind, a colon, then what it belongs to. Every kind has a
// name no other kind starts with, so a scale id can never collide with a kind.
export const techniquePartKey = {
  scale: (id) => `scale:${id}`, // which scale it is: form, tonic, quality, minor form
  starred: (id) => `starred:${id}`,
  rotation: (id) => `rotation:${id}`, // switched on or off
  octaves: (id) => `octaves:${id}`,
  hands: (id) => `hands:${id}`,
  check: (id) => `check:${id}`, // tempo, date and exact time of the check, octaves it was measured over
  lastPracticed: (id) => `lastPracticed:${id}`,
  practicedOn: (id, date) => `practicedOn:${id}:${date}`, // one practiced date, present or not
  usedOn: (id, methodId) => `usedOn:${id}:${methodId}`, // the date one method was last used on one scale
  methodStarred: (methodId) => `methodStarred:${methodId}`,
  methodOn: (methodId) => `methodOn:${methodId}`,
  customMethod: (methodId) => `customMethod:${methodId}`,
  setting: (name) => `setting:${name}`,
  walk: "walk",
  taskDone: (date, itemId) => `taskDone:${date}:${itemId}`, // done, tempo, undo note
  taskPlan: (date, itemId) => `taskPlan:${date}:${itemId}`, // methods and tier
};

// The parts of a canonical library as { key: value }. A part that holds its
// DEFAULT (a scale that isn't starred, a method that isn't starred or is
// switched on, a scale never practiced, a task that isn't done) is left out, so
// "no part" and "the default" are the same thing: the device record stays small,
// and a method toggled on and off again (the app keeps its entry) reads the same
// as one never touched.
function partsOfCanonical(T) {
  const parts = {};
  if (!isObject(T)) return parts;
  const K = techniquePartKey;

  (Array.isArray(T.items) ? T.items : []).forEach((it) => {
    const id = it.id;
    parts[K.scale(id)] = { form: it.form, tonic: it.tonic, quality: it.quality, minorForm: it.minorForm };
    if (it.starred) parts[K.starred(id)] = true;
    if (!it.inRotation) parts[K.rotation(id)] = false;
    parts[K.octaves(id)] = it.octaves;
    parts[K.hands(id)] = it.hands;
    parts[K.check(id)] = { evenTempo: it.evenTempo, lastCheckedDate: it.lastCheckedDate, lastCheckedAt: it.lastCheckedAt, checkOctaves: it.checkOctaves };
    if (it.lastPracticedDate) parts[K.lastPracticed(id)] = it.lastPracticedDate;
    (it.practicedDates || []).forEach((d) => {
      parts[K.practicedOn(id, d)] = true;
    });
  });

  const used = isObject(T.methodLastUsed) ? T.methodLastUsed : {};
  Object.keys(used).forEach((id) => {
    if (!isObject(used[id])) return;
    Object.keys(used[id]).forEach((mid) => {
      if (used[id][mid]) parts[K.usedOn(id, mid)] = used[id][mid];
    });
  });

  // A method with no saved state is unstarred and switched on.
  const state = isObject(T.methodState) ? T.methodState : {};
  Object.keys(state).forEach((mid) => {
    const st = isObject(state[mid]) ? state[mid] : {};
    if (st.starred) parts[K.methodStarred(mid)] = true;
    if (st.enabled === false) parts[K.methodOn(mid)] = false;
  });
  (Array.isArray(T.customMethods) ? T.customMethods : []).forEach((m) => {
    parts[K.customMethod(m.id)] = m;
  });

  const settings = isObject(T.settings) ? T.settings : {};
  parts[K.setting("scalesPerDay")] = settings.scalesPerDay;
  parts[K.setting("minutesPerScale")] = settings.minutesPerScale;
  parts[K.walk] = T.walkPosition;

  const list = isObject(T.dayList) ? T.dayList : null;
  if (list) {
    (Array.isArray(list.tasks) ? list.tasks : []).forEach((t) => {
      if (t.done) parts[K.taskDone(list.date, t.itemId)] = { tempo: t.tempo, ...(t.undo ? { undo: t.undo } : {}) };
      parts[K.taskPlan(list.date, t.itemId)] = { methodIds: t.methodIds, tier: t.tier };
    });
  }
  return parts;
}

function printParts(parts) {
  const out = {};
  Object.keys(parts).forEach((k) => {
    if (parts[k] !== undefined) out[k] = fingerprint(parts[k]);
  });
  return out;
}

// The parts of a library, as { key: value }, for the library as loading would
// give it.
export function techniqueParts(technique) {
  return partsOfCanonical(canonicalTechnique(technique));
}

// { key: fingerprint }: what the device record keeps (`parts`) for the library
// as the account holds it. Not cached: the library is small.
export function techniquePartFingerprints(technique) {
  return printParts(techniqueParts(technique));
}

/* ------------------------------------------------------------------ */
/*  Words (the same wording as components/tabs/technique/format.js)    */
/* ------------------------------------------------------------------ */

// lib/ never imports a component, so this repeats itemTitle's wording;
// test/techniqueMerge.test.mjs checks the two agree.
function prettyTonic(tonic) {
  return String(tonic || "").replace(/#/g, "♯").replace(/^([A-G])b/, "$1♭");
}

export function techniqueItemTitle(item) {
  const base = `${prettyTonic(item.tonic)} ${item.quality}`;
  if (item.form === "arpeggio") return `${base} arpeggio`;
  if (item.quality === "minor" && item.minorForm) return `${base}, ${item.minorForm}`;
  return base;
}

const SETTING_WORDS = {
  scalesPerDay: "the number of scales a day",
  minutesPerScale: "the minutes per scale",
};

/* ------------------------------------------------------------------ */
/*  The merge                                                          */
/* ------------------------------------------------------------------ */

const sorted = (list) => [...list].sort();
const hasBase = (base) => isObject(base) && Object.keys(base).length > 0;
const timestamp = (t) => (t && typeof t.updatedAt === "number" && t.updatedAt > 0 ? t.updatedAt : 0);
const laterDate = (a, b) => (!a ? b || null : !b ? a : a >= b ? a : b);
const copy = (v) => (v === undefined ? undefined : toJsonValue(v));

function sameFingerprints(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// Both sides changed one scale's tempo check to different values.
//  - A strictly newer check DATE wins, with its check octaves (a tempo only
//    means something over the octaves it was measured over).
//  - An EMPTY tempo never replaces a real one, even from a newer check (a
//    "start fresh" on the other device keeps the date but clears the tempo).
//  - The same date (or neither has one): a real tempo beats an empty one;
//    otherwise the one logged LATER wins, by the exact time saved with it
//    (lastCheckedAt). A tempo with a time beats one saved before times
//    existed, and where nothing says which is later the account's wins.
// `winner` is "local" or "remote". `dropped` says what of this device's was
// dropped for the account's on a same-date contest (the account's won and the
// two differed): "tempo" if two different tempos, "octaves" if only the check
// octaves differ, else null. Nothing is dropped when this device wins.
function mergeCheck(l, r) {
  const ld = l.lastCheckedDate;
  const rd = r.lastCheckedDate;
  const result = (winner, dropped = null) => ({ value: winner === "local" ? l : r, winner, dropped });
  if (ld !== rd) {
    const localNewer = !!(!rd || (ld && ld > rd));
    const newer = localNewer ? l : r;
    const older = localNewer ? r : l;
    const emptyOverReal = newer.evenTempo == null && older.evenTempo != null;
    return result(localNewer !== emptyOverReal ? "local" : "remote");
  }
  const lReal = l.evenTempo != null;
  const rReal = r.evenTempo != null;
  if (lReal && !rReal) return result("local");
  if (rReal && !lReal) return result("remote");
  const lt = l.lastCheckedAt;
  const rt = r.lastCheckedAt;
  if (lt != null && (rt == null || lt > rt)) return result("local");
  return result("remote", l.evenTempo !== r.evenTempo ? "tempo" : l.checkOctaves !== r.checkOctaves ? "octaves" : null);
}

// A done task keeps a note of the step it took (its undo note says advancedTo):
// the walk went from `undo.walkPosition` to `undo.advancedTo` when it was done.
// The walk is merged like any other part, so it can end up taken from one side
// while a completion that stepped it comes from the OTHER side (a completion
// undone on one device and done again on the other leaves the first device's
// walk stepped back; or the two walks conflict and the account's, the shorter,
// wins). Then a step is lost, and it is taken now: once, with the engine's own
// advance (nextWalkPosition, which skips a key with no scales), for each such
// task that stepped from where the walk stands, chaining while the next one
// starts where the last one ended.
//
// Only a step that came from the side the walk did NOT come from is looked at.
// That is what keeps it from stepping twice: two devices that did the day's
// task agree on one step (nothing is looked at), and a side's own walk already
// holds its own steps, including a library with so few keys that a day's steps
// go round in a circle.
function settleWalk(walk, items, tasks, otherSide, sideOfTask) {
  if (!otherSide) return walk;
  const steps = (tasks || []).filter(
    (t) => t.done && sideOfTask.get(t.itemId) === otherSide && t.undo && Number.isInteger(t.undo.advancedTo) && Number.isInteger(t.undo.walkPosition)
  );
  const used = new Set();
  let at = walk;
  for (;;) {
    const step = steps.find((t) => !used.has(t.itemId) && t.undo.walkPosition === at);
    if (!step) return at;
    used.add(step.itemId);
    const next = nextWalkPosition(items, at);
    if (next === at) return at;
    at = next;
  }
}

// What planTechniqueMerge returns:
//   status  "identical"  both sides hold the same parts; nothing to do
//           "local-only" the remote library hasn't changed since the base:
//                        nothing to bring in, `merged` IS `local`
//           "merged"     the remote changes were folded in (`notices` lists
//                        what of this device's was dropped for the account's)
//           "ask"        nothing says what changed on which side (no recorded
//                        parts): `merged` IS `local`. The caller falls back to
//                        mergeImportedTechnique, which needs no base.
//   merged       the library to keep. For every status except "merged" it is
//                `local` itself, untouched (same object).
//   notices      [{ kind: "kept-other-device", part: "scale"|"setting"|"tempo",
//                   id, title, fields?, text }]: where both sides changed the
//                same thing differently and the account's value was kept
//   resolved     [{ part, kept: "local"|"remote"|"both", local, remote }]: every
//                part both sides changed to different values, and whose value
//                came out (a notice can cover several of them)
//   fromRemote   parts taken from the remote library (changed there only)
//   fromLocal    parts kept from this device (changed here only)
//   agreed       parts both sides changed to the same value
//   derived      what the merge re-derived instead of choosing: "walk" when the
//                walk was stepped to match the done tasks, and "practiced:<id>"
//                when a done task's scale had its date or last-used methods put
//                back to agree with it
//   list         how today's list came out: "none" | "local" | "remote" |
//                "local-later" | "remote-later" | "same-date"
//   reason       for "ask": "no-base" | "not-libraries"
//
// `base` is the entry's `parts` ({ key: fingerprint }). `local` and `remote`
// are libraries in any shape the app holds them; both are read in the form
// loading would give them, and the merged library is built in that form.
//
// updatedAt is the later of the two. Nothing here reads the clock.
export function planTechniqueMerge({ local, remote, base }) {
  const result = (status, extra = {}) => ({
    status,
    merged: local,
    notices: [],
    resolved: [],
    fromRemote: [],
    fromLocal: [],
    agreed: [],
    derived: [],
    list: null,
    reason: null,
    ...extra,
  });

  if (!isObject(local) || !isObject(remote)) return result("ask", { reason: "not-libraries" });

  const L = canonicalTechnique(local);
  const R = canonicalTechnique(remote);
  const pL = partsOfCanonical(L);
  const pR = partsOfCanonical(R);
  const fpL = printParts(pL);
  const fpR = printParts(pR);

  if (sameFingerprints(fpL, fpR)) return result("identical");
  if (!hasBase(base)) return result("ask", { reason: "no-base" });
  // The remote library is what the base was: nothing of theirs to bring in.
  if (sameFingerprints(fpR, base)) return result("local-only");

  const K = techniquePartKey;

  // Did this side change `k` since the base? A part left out is a part holding
  // its default (see partsOfCanonical), so "left out on both" is unchanged, and
  // a task done on one side and fresh on the other (a new day's list built on
  // both) reads as a change on the done side only.
  const changedL = (k) => fpL[k] !== base[k];
  const changedR = (k) => fpR[k] !== base[k];

  const fromRemote = new Set();
  const fromLocal = new Set();
  const agreed = new Set();
  const resolved = [];

  // The value for part `k`: unchanged, one side's change, or agreement; where
  // both sides changed it to different values, `onConflict(local, remote, key)`
  // decides, and the conflict is listed in `resolved` with whose value came out
  // ("local", "remote", or "both" when the two were put together).
  const pick = (k, onConflict) => {
    const cl = changedL(k);
    const cr = changedR(k);
    if (!cl && !cr) return pL[k];
    if (cl && !cr) {
      fromLocal.add(k);
      return pL[k];
    }
    if (!cl && cr) {
      fromRemote.add(k);
      return pR[k];
    }
    if (fpL[k] === fpR[k]) {
      agreed.add(k);
      return pL[k];
    }
    const value = onConflict(pL[k], pR[k], k);
    const print = value === undefined ? undefined : fingerprint(value);
    resolved.push({
      part: k,
      kept: print === fpL[k] ? "local" : print === fpR[k] ? "remote" : "both",
      local: copy(pL[k]),
      remote: copy(pR[k]),
    });
    return value;
  };

  // The account's value (and, if `after` is given, a call to note that this
  // device's different change was dropped for it).
  const keepRemote = (after) => (l, r, k) => {
    if (after) after(k);
    return r;
  };
  const keepRemoteQuietly = keepRemote(null);

  /* ---- a completion one side undid and the other did again ---- */
  // Today's list, same date: both sides changed the same task (so a one-sided
  // undo isn't this), one done and one not. Whichever side's library changed
  // MOST RECENTLY (`updatedAt`) decides, and a tie keeps the completion. For the
  // scales where the undo wins, `undoWins` holds the side that undid it; the
  // tempo that completion logged goes back with it (see the tempo check below).
  const undoWins = new Map();
  if (L.dayList && R.dayList && L.dayList.date === R.dayList.date) {
    const date = L.dayList.date;
    const onRemote = new Set(R.dayList.tasks.map((t) => t.itemId));
    L.dayList.tasks.forEach((t) => {
      const k = K.taskDone(date, t.itemId);
      if (!onRemote.has(t.itemId) || !changedL(k) || !changedR(k) || !!pL[k] === !!pR[k]) return;
      const undoneSide = pL[k] ? "remote" : "local";
      const undoneAt = timestamp(undoneSide === "local" ? L : R);
      const doneAt = timestamp(undoneSide === "local" ? R : L);
      if (undoneAt > doneAt) undoWins.set(t.itemId, undoneSide);
    });
  }

  /* ---- scales ---- */
  const itemNotes = new Map(); // id -> Set of field names the account's value was kept for
  const note = (id, field) => {
    if (!itemNotes.has(id)) itemNotes.set(id, new Set());
    itemNotes.get(id).add(field);
  };
  const tempoTies = new Set();
  const checkFrom = new Map(); // scale id -> the side whose tempo check was taken ("local" or "remote"), where one side's was

  const lItems = new Map(L.items.map((it) => [it.id, it]));
  const rItems = new Map(R.items.map((it) => [it.id, it]));
  // Remote's order first, then what only this device has: the account is the
  // one order every device ends up with, so two devices settle on the same list.
  const itemOrder = [...new Set([...R.items.map((it) => it.id), ...L.items.filter((it) => !rItems.has(it.id)).map((it) => it.id)])];

  const items = itemOrder.map((id) => {
    const li = lItems.get(id);
    const ri = rItems.get(id);
    // On one side only: kept whole, whichever side it's on (nothing is removed).
    if (!li || !ri) {
      if (base[K.scale(id)] === undefined) (li ? fromLocal : fromRemote).add(K.scale(id));
      return copy(li || ri);
    }
    const scale = pick(K.scale(id), keepRemote(() => note(id, "scale")));
    // A yes/no part (starred, switched off) can't conflict: changed on both
    // sides means changed to the same other value, which is agreement.
    const starred = pick(K.starred(id), keepRemoteQuietly) === true;
    const inRotation = pick(K.rotation(id), keepRemoteQuietly) !== false;
    const octaves = pick(K.octaves(id), keepRemote(() => note(id, "octaves")));
    const hands = pick(K.hands(id), keepRemote(() => note(id, "hands")));
    let check;
    const kCheck = K.check(id);
    if (undoWins.has(id)) {
      // The completion was undone and the undo is the more recent change: the
      // tempo it logged goes back with it, so the scale takes the side that undid it.
      const side = undoWins.get(id);
      check = side === "local" ? pL[kCheck] : pR[kCheck];
      if (fpL[kCheck] !== fpR[kCheck]) {
        resolved.push({ part: kCheck, kept: side, local: copy(pL[kCheck]), remote: copy(pR[kCheck]) });
        checkFrom.set(id, side);
      }
    } else {
      check = pick(K.check(id), (l, r) => {
        const m = mergeCheck(l, r);
        if (m.dropped === "tempo") tempoTies.add(id);
        else if (m.dropped === "octaves") note(id, "checkOctaves");
        return m.value;
      });
      const conflict = resolved.find((x) => x.part === kCheck);
      const from = fromLocal.has(kCheck) ? "local" : fromRemote.has(kCheck) ? "remote" : conflict && conflict.kept !== "both" ? conflict.kept : null;
      if (from) checkFrom.set(id, from);
    }
    const lastPracticedDate = pick(K.lastPracticed(id), (l, r) => laterDate(l, r)) || null;
    const dates = [];
    new Set([...li.practicedDates, ...ri.practicedDates]).forEach((d) => {
      if (pick(K.practicedOn(id, d), keepRemoteQuietly) !== undefined) dates.push(d);
    });
    return {
      id,
      form: scale.form,
      tonic: scale.tonic,
      quality: scale.quality,
      minorForm: scale.minorForm,
      octaves,
      hands,
      evenTempo: check.evenTempo,
      checkOctaves: check.checkOctaves,
      lastCheckedDate: check.lastCheckedDate,
      lastCheckedAt: check.lastCheckedAt,
      lastPracticedDate,
      practicedDates: dates.sort(),
      starred,
      inRotation,
    };
  });

  /* ---- the date each method was last used, on each scale ---- */
  // One part for each (scale, method), so a use undone on one side is gone and a
  // use added on either side is kept, the same as a practiced date; where both
  // sides changed the same one, the later date.
  const methodLastUsed = {};
  const usedPairs = new Set();
  [L, R].forEach((T) =>
    Object.keys(T.methodLastUsed || {}).forEach((id) => Object.keys(T.methodLastUsed[id] || {}).forEach((mid) => usedPairs.add(JSON.stringify([id, mid]))))
  );
  sorted(usedPairs).forEach((pair) => {
    const [id, mid] = JSON.parse(pair);
    const date = pick(K.usedOn(id, mid), (l, r) => laterDate(l, r));
    if (date) {
      if (!methodLastUsed[id]) methodLastUsed[id] = {};
      methodLastUsed[id][mid] = date;
    }
  });

  /* ---- methods ---- */
  const lCustom = new Map(L.customMethods.map((m) => [m.id, m]));
  const rCustom = new Map(R.customMethods.map((m) => [m.id, m]));
  const customMethods = [...new Set([...R.customMethods.map((m) => m.id), ...L.customMethods.filter((m) => !rCustom.has(m.id)).map((m) => m.id)])].map((id) => {
    if (!lCustom.has(id) || !rCustom.has(id)) {
      if (base[K.customMethod(id)] === undefined) (lCustom.has(id) ? fromLocal : fromRemote).add(K.customMethod(id));
      return copy(lCustom.get(id) || rCustom.get(id));
    }
    return copy(pick(K.customMethod(id), keepRemoteQuietly));
  });

  // Yes/no parts again: never a conflict.
  const methodState = {};
  sorted(new Set([...Object.keys(L.methodState || {}), ...Object.keys(R.methodState || {})])).forEach((mid) => {
    const starred = pick(K.methodStarred(mid), keepRemoteQuietly);
    const enabled = pick(K.methodOn(mid), keepRemoteQuietly);
    methodState[mid] = { starred: starred === true, enabled: enabled !== false };
  });

  /* ---- settings ---- */
  const settingNotes = [];
  const settings = {};
  ["scalesPerDay", "minutesPerScale"].forEach((name) => {
    settings[name] = pick(K.setting(name), keepRemote(() => settingNotes.push(name)));
  });

  /* ---- today's list ---- */
  const LL = L.dayList;
  const RL = R.dayList;
  let dayList = null;
  let listHow = "none";
  // Which side each done task's completion came from ("local" or "remote"), for
  // the walk below. A task done the same on both sides, or left as the base had
  // it, comes from neither.
  const sideOfTask = new Map();
  const fpOf = (side) => (side === "local" ? fpL : fpR);
  const noteWholeList = (list, side) => {
    list.tasks.forEach((t) => {
      if (t.done && fpOf(side)[K.taskDone(list.date, t.itemId)] !== base[K.taskDone(list.date, t.itemId)]) sideOfTask.set(t.itemId, side);
    });
  };
  if (LL && !RL) {
    dayList = copy(LL);
    listHow = "local";
    noteWholeList(LL, "local");
  } else if (!LL && RL) {
    dayList = copy(RL);
    listHow = "remote";
    noteWholeList(RL, "remote");
  } else if (LL && RL && LL.date !== RL.date) {
    // The later day's list wins whole. What was done on the earlier day is
    // already in each scale's own parts (dates, tempo, last used).
    const localLater = LL.date > RL.date;
    dayList = copy(localLater ? LL : RL);
    listHow = localLater ? "local-later" : "remote-later";
    noteWholeList(localLater ? LL : RL, localLater ? "local" : "remote");
  } else if (LL && RL) {
    listHow = "same-date";
    const date = LL.date;
    const lTasks = new Map(LL.tasks.map((t) => [t.itemId, t]));
    const rTasks = new Map(RL.tasks.map((t) => [t.itemId, t]));
    const taskOrder = [...new Set([...RL.tasks.map((t) => t.itemId), ...LL.tasks.filter((t) => !rTasks.has(t.itemId)).map((t) => t.itemId)])];
    const tasks = [];
    taskOrder.forEach((itemId) => {
      const lt = lTasks.get(itemId);
      const rt = rTasks.get(itemId);
      if (!lt || !rt) {
        // On one list only. If the base had it, the other side took it off (the
        // app does that when its scale is switched off): that travels if this
        // side left it alone, but a task changed here (done, say) stays. A task
        // the base never had was added, and is kept.
        const plan = K.taskPlan(date, itemId);
        const fp = lt ? fpL : fpR;
        if (base[plan] !== undefined && fp[plan] === base[plan] && fp[K.taskDone(date, itemId)] === base[K.taskDone(date, itemId)]) return;
        if (base[plan] === undefined) (lt ? fromLocal : fromRemote).add(plan);
        if ((lt || rt).done && fp[K.taskDone(date, itemId)] !== base[K.taskDone(date, itemId)]) sideOfTask.set(itemId, lt ? "local" : "remote");
        tasks.push(copy(lt || rt));
        return;
      }
      const plan = pick(K.taskPlan(date, itemId), keepRemoteQuietly);
      // A completion survives unless it was undone on ONE side only: changed on
      // one side, that side's; changed on both, done if either is done.
      // (A part left out is a task that isn't done.)
      const kDone = K.taskDone(date, itemId);
      const lItem = lItems.get(itemId);
      const rItem = rItems.get(itemId);
      const done = pick(kDone, (l, r) => {
        if (l && r) {
          // Done on both, in different ways: the one that logged a tempo; of two tempos
          // the side the SCALE's tempo came from (so the task and the scale agree), else
          // the one logged later (the exact time saved with the scale's tempo); else the
          // account's.
          if ((l.tempo != null) !== (r.tempo != null)) return l.tempo != null ? l : r;
          if (checkFrom.has(itemId)) return checkFrom.get(itemId) === "local" ? l : r;
          const lt = l.tempo != null && lItem ? lItem.lastCheckedAt : null;
          const rt = r.tempo != null && rItem ? rItem.lastCheckedAt : null;
          return lt != null && (rt == null || lt > rt) ? l : r;
        }
        // One side undid it and the other did it again: the more recent change decides.
        const winner = undoWins.has(itemId) ? undefined : l || r;
        if (undoWins.has(itemId) ? undoWins.get(itemId) === "remote" : !!r) note(itemId, "checkedOff");
        return winner;
      });
      if (done) {
        const conflict = resolved.find((x) => x.part === kDone);
        const side = fromLocal.has(kDone) ? "local" : fromRemote.has(kDone) ? "remote" : conflict && conflict.kept !== "both" ? conflict.kept : null;
        if (side) sideOfTask.set(itemId, side);
      }
      tasks.push({
        itemId,
        methodIds: copy(plan.methodIds),
        done: !!done,
        tier: plan.tier,
        tempo: done ? done.tempo : null,
        ...(done && done.undo ? { undo: copy(done.undo) } : {}),
      });
    });
    dayList = { date, tasks };
  }
  const derived = [];
  if (dayList) {
    // A task of a scale that doesn't exist can't be shown, so it goes. (Nothing
    // is done about an unfinished task of a scale that's switched off: the app
    // itself leaves one when a done task of such a scale is undone. When one
    // side switched a scale off, its task leaving the list is that side's change
    // to the list, and travels like any other.)
    const byId = new Map(items.map((it) => [it.id, it]));
    dayList.tasks = dayList.tasks.filter((t) => byId.has(t.itemId));

    // A done task means its scale was practiced that day. Each part is merged
    // on its own, so a completion that stands on one side (done again after an
    // undo) can meet an undo of the same completion on the other, and the
    // scale's own dates and last-used methods would still say it wasn't. They
    // are put back to agree with the task, which only ever adds.
    dayList.tasks.forEach((t) => {
      const it = byId.get(t.itemId);
      if (!t.done || !it) return;
      const date = dayList.date;
      let touched = false;
      if (!it.practicedDates.includes(date)) {
        it.practicedDates = [...it.practicedDates, date].sort();
        touched = true;
      }
      if (!it.lastPracticedDate || it.lastPracticedDate < date) {
        it.lastPracticedDate = date;
        touched = true;
      }
      const used = { ...(methodLastUsed[t.itemId] || {}) };
      t.methodIds.forEach((mid) => {
        if (!used[mid] || used[mid] < date) {
          used[mid] = date;
          touched = true;
        }
      });
      if (Object.keys(used).length > 0) methodLastUsed[t.itemId] = used;
      if (touched) derived.push(`practiced:${t.itemId}`);
    });
  }

  /* ---- the walk ---- */
  const pickedWalk = pick(K.walk, keepRemoteQuietly);
  // Which side the walk's value came from: the one that changed it, or the
  // account's where both changed it differently. Where both agree, or neither
  // changed it, no step can be missing.
  const walkSide = fromLocal.has(K.walk) ? "local" : fromRemote.has(K.walk) || resolved.some((x) => x.part === K.walk) ? "remote" : null;
  const walkPosition = settleWalk(pickedWalk, items, dayList ? dayList.tasks : [], walkSide === "local" ? "remote" : walkSide === "remote" ? "local" : null, sideOfTask);
  if (walkPosition !== pickedWalk) derived.push("walk");

  /* ---- put together ---- */
  const lt = timestamp(local);
  const rt = timestamp(remote);
  const draft = {
    schemaVersion: L.schemaVersion,
    items,
    methodState,
    customMethods,
    methodLastUsed,
    walkPosition,
    dayList,
    settings,
    updatedAt: lt || rt ? Math.max(lt, rt) : null,
  };
  const merged = toJsonValue(validateAndMigrateTechnique(toJsonValue(draft)));

  /* ---- the notices ---- */
  const notices = [];
  const itemById = new Map(merged.items.map((it) => [it.id, it]));
  itemNotes.forEach((fields, id) => {
    const it = itemById.get(id);
    if (!it) return;
    const title = techniqueItemTitle(it);
    notices.push({ kind: "kept-other-device", part: "scale", id, title, fields: sorted(fields), text: `Your other device's change to ${title} was kept.` });
  });
  tempoTies.forEach((id) => {
    const it = itemById.get(id);
    if (!it) return;
    const title = techniqueItemTitle(it);
    notices.push({ kind: "kept-other-device", part: "tempo", id, title, text: `Your other device's tempo for ${title} was kept.` });
  });
  settingNotes.forEach((name) => {
    notices.push({ kind: "kept-other-device", part: "setting", id: name, title: SETTING_WORDS[name], text: `Your other device's change to ${SETTING_WORDS[name]} was kept.` });
  });

  return result("merged", {
    merged,
    notices,
    resolved,
    fromRemote: sorted(fromRemote),
    fromLocal: sorted(fromLocal),
    agreed: sorted(agreed),
    derived,
    list: listHow,
  });
}
