/* ------------------------------------------------------------------ */
/*  "The most recent change wins": the dated note on a setting         */
/*  (Pass 126). docs/Decisions.md "Pass 126 step 1" and "the list of   */
/*  settings".                                                         */
/*                                                                     */
/*  Pure functions, no React, no network, and no clock of their own    */
/*  (callers pass `now`). This file imports nothing from the merge     */
/*  engines, so both can import it.                                    */
/*                                                                     */
/*  A piece's SINGLE-VALUE settings (the list below) each get a dated  */
/*  note, `piece.settingTimes[field]`, when they change: "the target   */
/*  tempo was last changed at this moment". When two devices changed   */
/*  the same setting to different values, the later note wins. Where a */
/*  setting has no note (the piece predates them, or the change was    */
/*  made on a device running the previous version) the piece's own     */
/*  `updatedAt` stands in for it. A tie (the same moment) is never     */
/*  guessed: it stays a question, as before.                           */
/*                                                                     */
/*  Collections and whole shapes (per-chunk notes, recordings,         */
/*  documents, per-measure difficulty, sections, the recurring         */
/*  material, tempo zones, the ladder settings, revival, other keys)   */
/*  and the chunk grid are deliberately NOT in the list: recency would */
/*  let one device's whole set replace the other's and silently drop   */
/*  an item someone added.                                             */
/* ------------------------------------------------------------------ */

// The settings recency settles. `workId` is not here: it is worked out from `workName`
// and follows it. `daysToLearn` is not here either: it is worked out from the schedule.
export const RECENCY_FIELDS = [
  "name",
  "composer",
  "workName",
  "notes",
  "status",
  "markedLearnedElsewhere",
  "targetBPM",
  "homeKey",
  "manualOverallConfidence",
  "lastPlayedDate",
  "startDate",
  "scheduleMode",
  "targetDate",
  "minutesPerDay",
  "practiceDaysPerWeek",
  "troubleSpotsEnabled",
  "troubleSpotDefaultMinutes",
];

const RECENCY_SET = new Set(RECENCY_FIELDS);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isTime = (t) => typeof t === "number" && Number.isFinite(t) && t > 0;

// undefined and null are the same "nothing" here: a field a load fills in with null is not
// a change a person made.
const norm = (v) => (v === undefined ? null : v);

// Same value, key order ignored. Written here (not imported) so this file has no imports.
function sameValue(a, b) {
  a = norm(a);
  b = norm(b);
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
}

// A stored `settingTimes` as the app holds it: only known settings, only real times. Null
// when nothing is left, so a piece without any carries no field at all.
export function cleanSettingTimes(raw) {
  if (!isObj(raw)) return null;
  const out = {};
  RECENCY_FIELDS.forEach((k) => {
    if (isTime(raw[k])) out[k] = raw[k];
  });
  return Object.keys(out).length > 0 ? out : null;
}

// The time a setting was last changed, as far as this copy of the piece can say: its own
// note, else the piece's `updatedAt`, else 0 (no idea).
export function settingTime(piece, field) {
  if (!isObj(piece)) return 0;
  const note = isObj(piece.settingTimes) ? piece.settingTimes[field] : undefined;
  if (isTime(note)) return note;
  return isTime(piece.updatedAt) ? piece.updatedAt : 0;
}

// Does this copy hold a note of its own for the setting (not the fallback)?
export function hasSettingNote(piece, field) {
  return isObj(piece) && isObj(piece.settingTimes) && isTime(piece.settingTimes[field]);
}

// 1 if `local` changed the setting more recently, -1 if `remote` did, 0 if the notes (or the
// fallbacks) say the same moment, or say nothing at all.
export function compareRecency(local, remote, field) {
  const a = settingTime(local, field);
  const b = settingTime(remote, field);
  return a > b ? 1 : a < b ? -1 : 0;
}

// The latest note this copy holds, or 0.
export function latestSettingNote(piece) {
  let latest = 0;
  if (isObj(piece) && isObj(piece.settingTimes)) {
    Object.keys(piece.settingTimes).forEach((k) => {
      if (isTime(piece.settingTimes[k]) && piece.settingTimes[k] > latest) latest = piece.settingTimes[k];
    });
  }
  return latest;
}

// The moment to write on a change: now, but never at or before a note the piece already holds
// (its own, or one that came from another device), so a device whose clock runs behind still
// stamps AFTER the changes it has received. Only two changes made without either device
// having seen the other are judged by the clocks.
export function nextSettingStamp(piece, now = Date.now()) {
  const base = Number.isFinite(now) ? now : 0;
  const latest = latestSettingNote(piece);
  return latest > 0 ? Math.max(base, latest + 1) : base;
}

// `next` is `prev` after a change. Returns `next` carrying a fresh note for every setting in
// the list whose value differs from `prev`'s; the very same object when none did. Only
// settings a person (or a feature acting for them) changed through updatePiece ever get here;
// a merge writes its own notes (pieceMerge.js) and never calls this.
export function stampChangedSettings(prev, next, now = Date.now()) {
  if (!isObj(prev) || !isObj(next) || prev === next) return next;
  const changed = RECENCY_FIELDS.filter((k) => prev[k] !== next[k] && !sameValue(prev[k], next[k]));
  if (changed.length === 0) return next;
  const at = nextSettingStamp(next, now);
  const times = { ...(cleanSettingTimes(next.settingTimes) || {}) };
  changed.forEach((k) => {
    times[k] = at;
  });
  return { ...next, settingTimes: times };
}

export const isRecencyField = (field) => RECENCY_SET.has(field);

/* ------------------------------------------------------------------ */
/*  The technique library (Pass 126)                                   */
/* ------------------------------------------------------------------ */

// The library keeps its notes in one field, `partTimes: { [part key]: time }`, for the parts
// recency settles that have a bounded number of keys: a scale's `octaves:<id>` and `hands:<id>`,
// and the two settings. (A task's method plan has none: its keys would grow with every day's
// list, so it falls back to the library's `updatedAt`.) The keys are the engine's own part keys
// (lib/techniqueMerge.js, techniquePartKey).
const PART_TIME_KEY = /^(octaves:.+|hands:.+|setting:(scalesPerDay|minutesPerScale))$/;

export const isTimedTechniquePart = (key) => typeof key === "string" && PART_TIME_KEY.test(key);

export function cleanPartTimes(raw) {
  if (!isObj(raw)) return null;
  const out = {};
  Object.keys(raw).forEach((k) => {
    if (isTimedTechniquePart(k) && isTime(raw[k])) out[k] = raw[k];
  });
  return Object.keys(out).length > 0 ? out : null;
}

// The time a technique part was last changed, as far as this copy can say: its own note, else
// the library's `updatedAt`, else 0.
export function partTime(library, key) {
  if (!isObj(library)) return 0;
  const note = isObj(library.partTimes) ? library.partTimes[key] : undefined;
  if (isTime(note)) return note;
  return isTime(library.updatedAt) ? library.updatedAt : 0;
}

export function latestPartNote(library) {
  let latest = 0;
  if (isObj(library) && isObj(library.partTimes)) {
    Object.keys(library.partTimes).forEach((k) => {
      if (isTime(library.partTimes[k]) && library.partTimes[k] > latest) latest = library.partTimes[k];
    });
  }
  return latest;
}

// As nextSettingStamp, for the library: never at or before a note it already holds.
export function nextPartStamp(library, now = Date.now()) {
  const base = Number.isFinite(now) ? now : 0;
  const latest = latestPartNote(library);
  return latest > 0 ? Math.max(base, latest + 1) : base;
}
