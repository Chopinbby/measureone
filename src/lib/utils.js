/* ------------------------------------------------------------------ */
/*  Generic, cross-cutting helpers — no piece-shape or algorithm       */
/*  knowledge lives here, just math/formatting/array utilities used by */
/*  more than one of chunking.js / scheduling.js / confidence.js.      */
/* ------------------------------------------------------------------ */

export const MS_PER_DAY = 86400000;

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function resizeDifficulty(arr, newTotal) {
  if (!arr) return Array(newTotal).fill(1);
  if (arr.length === newTotal) return arr;
  if (arr.length > newTotal) return arr.slice(0, newTotal);
  return [...arr, ...Array(newTotal - arr.length).fill(1)];
}

export function resizeSections(sections, newTotal) {
  return (sections || []).map((s) => {
    const start = clamp(s.start, 1, newTotal);
    const end = clamp(s.end, 1, newTotal);
    return { ...s, start: Math.min(start, end), end: Math.max(start, end) };
  });
}

export function formatRange(start, end) {
  return start === end ? `m. ${start}` : `mm. ${start}–${end}`;
}

// Collapses a list of {start,end} measure ranges into the smallest set of
// contiguous/overlapping spans, sorted ascending. Purely a display helper —
// never merges ranges that actually have a gap between them, so it never
// implies coverage of measures that aren't really part of the group.
export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  });
  return merged;
}

export function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatHoursMinutes(totalSeconds) {
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function sumPracticeSeconds(piece) {
  return Object.values(piece.progress).reduce(
    (sum, entry) => sum + (entry.sessions || []).reduce((s, sess) => s + (sess.durationSeconds || 0), 0),
    0
  );
}

export function getCurrentDay(piece, totalDays) {
  if (!piece.createdAt) return 1;
  const diff = Math.floor((Date.now() - piece.createdAt) / MS_PER_DAY);
  return clamp(diff + 1, 1, totalDays);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Calendar days from today through `dateStr`, inclusive of today — e.g. a
// target date of today returns 1, tomorrow returns 2. Negative/zero means
// the date has already passed.
export function daysUntilInclusive(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date(`${todayISODate()}T00:00:00`);
  return Math.round((target - today) / MS_PER_DAY) + 1;
}
