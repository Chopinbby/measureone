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

// Every other chunk (of any kind) whose range overlaps `chunk`'s —
// findComboUnderlyingChunks (lib/revival.js: practiceChunks filtered by
// overlap with one combo) run in reverse: one chunk filtered against the
// whole set. No kind filter is needed to keep this to "just the
// transitions/combos touching a base chunk": practice chunks are generated
// as contiguous, non-overlapping measure ranges (generatePracticeChunks,
// lib/chunking.js), so a base chunk can never overlap another base chunk —
// only a transition or combo ever will. That also makes this safe to call
// with a transition or combo as `chunk` itself (e.g. after following a
// related-chunk link to its own detail view): it correctly finds the base
// chunks back the other way, with the same one function either direction.
export function findRelatedChunks(chunk, allChunks) {
  return allChunks
    .filter((c) => c.id !== chunk.id && rangesOverlap(chunk.start, chunk.end, c.start, c.end))
    .sort((a, b) => a.start - b.start);
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

// Every practice-time display in the app goes through this — schedule
// minutes (piece.minutesPerDay, day.minutes, agenda totals) as well as
// logged-session totals below — so an hour-plus duration always reads as
// "1h 30m" rather than a bare "90m" the user has to do the math on.
export function formatMinutes(totalMinutes) {
  const m = Math.round(totalMinutes);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
}

export function formatHoursMinutes(totalSeconds) {
  return formatMinutes(totalSeconds / 60);
}

// A skipped session (Interleaved mode's "skip, just save time" action,
// Pass 29) records that time was spent but is deliberately not a completed
// practice attempt — no reps/BPM/outcome, and (per handleLogSession,
// App.jsx) never marked "done." A provisional session (Pass 29 follow-up —
// an auto-classified soft-miss/fail logged mid-rotation) DOES carry real
// reps/BPM/outcome, but is equally not yet a judged attempt: the user
// hasn't confirmed or discarded it, and it hasn't touched the ladder
// (handleConfirmProvisionalSession/handleDiscardProvisionalSession,
// App.jsx, resolve it one way or the other). Every consumer that treats
// `piece.progress[id].sessions` as evidence of real, judged practice
// (confidence scoring, the Progress tab's stats, ladder-status history)
// should read through this rather than the raw array, so neither kind can
// silently masquerade as a pass/fail/soft-miss, or as "this chunk has been
// practiced," anywhere that matters. `sumPracticeSeconds` below
// deliberately does NOT use this — a skipped OR provisional session's time
// still counts toward total time practiced; the time was spent either way.
export function loggedSessions(sessions) {
  return (sessions || []).filter((s) => !s.skipped && !s.provisional);
}

// True when `entry` has a session logged on `day` that's still sitting
// provisional (Interleaved mode's deferred soft-miss/fail logging — see
// App.jsx's handleLogSession `provisional` branch and
// handleDiscardProvisionalSession). Used to warn — and, if confirmed,
// discard — before leaving Interleaved mode with an unresolved attempt
// still hanging, rather than letting it silently sit there forever with
// no prompt either way.
export function hasPendingProvisionalSession(entry, day) {
  return ((entry && entry.sessions) || []).some((s) => s.day === day && s.provisional === true);
}

export function sumPracticeSeconds(piece) {
  return Object.values(piece.progress).reduce(
    (sum, entry) => sum + (entry.sessions || []).reduce((s, sess) => s + (sess.durationSeconds || 0), 0),
    0
  );
}

// Same as sumPracticeSeconds, bounded to sessions logged on or after
// `sinceDateStr` — still counts a skipped session's time (see the comment
// on loggedSessions above; this deliberately doesn't call it), just also
// date-filtered. A session with no loggedDate is excluded rather than
// assumed in-range — shouldn't happen in practice (validateAndMigratePiece
// backfills it on every load, storage.js), but a session that can't be
// placed on the calendar can't be claimed for "this week."
export function sumPracticeSecondsSince(piece, sinceDateStr) {
  return Object.values(piece.progress).reduce(
    (sum, entry) =>
      sum +
      (entry.sessions || []).reduce(
        (s, sess) => s + (sess.loggedDate && sess.loggedDate >= sinceDateStr ? sess.durationSeconds || 0 : 0),
        0
      ),
    0
  );
}

// Which of the last `windowDays` calendar days had a real session logged on
// ANY piece in `pieces` — a cross-piece consistency signal. Unlike
// ProgressTab's per-piece heatmap (plan-relative day numbers, only
// comparable within one piece's own timeline), this reads each session's
// loggedDate directly, so pieces with different start dates land on a
// shared calendar axis. Reuses loggedSessions() for the same "skipped or
// provisional isn't a real touch" rule the per-piece heatmap already uses.
export function computeCrossPieceConsistency(pieces, windowDays = 14) {
  const touchedDates = new Set();
  (pieces || []).forEach((piece) => {
    Object.values((piece && piece.progress) || {}).forEach((entry) => {
      loggedSessions(entry.sessions).forEach((s) => {
        if (s.loggedDate) touchedDates.add(s.loggedDate);
      });
    });
  });
  const today = todayISODate();
  const days = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = addDaysISO(today, -i);
    days.push({ date, touched: touchedDates.has(date) });
  }
  return days;
}

// Day 1 of a piece's plan is piece.startDate (an explicit date the user sets
// on the Schedule tab, or that's set automatically at creation/import time)
// — never piece.createdAt, which is just record-keeping bookkeeping (sort
// order in the piece switcher) and, for an imported piece, may predate when
// the plan should actually start. Falls back to today for pieces saved
// before startDate existed; that fallback is transient, so storage.js
// backfills and persists a real startDate on load rather than relying on
// this recomputing "today" fresh on every call.
//
// `elapsedDay` is the *unclamped* form: how many days the piece has been
// running, with no upper bound. It's what answers "has this piece run past
// its plan?" — a question `getCurrentDay` structurally cannot answer, since
// it clamps to the plan's length (a 10-day plan started three months ago
// still reports day 10). Used by the maintenance due-list surfaces; see
// Algorithms.md#whats-due--the-live-maintenance-query.
//
// Counts days via `daysBetweenInclusive` rather than its own arithmetic.
// That is load-bearing, not tidiness: this used to floor the millisecond
// gap between two *local* midnights, which undercounts by a day across a
// DST boundary (a spring-forward day is 23 hours, so `n × 24 − 1` floors
// to `n − 1`) — and it stayed wrong for the whole ~8 months between
// transitions, not just the changeover day. Meanwhile `computeTimeline`
// converts a chunk's `nextDueDate` to a plan day with `daysBetweenInclusive`
// (`Math.round`), so the two disagreed by one for any piece started before
// the spring transition: a review genuinely due today was placed one day
// ahead of the day the app thought it was, and — because both numbers
// advance together — it never arrived. Sharing one counting function is
// what keeps "what day is it" and "what day is this date" in agreement.
export function elapsedDay(piece) {
  const startDate = piece.startDate || todayISODate();
  // Floored at 1, so a piece with a future startDate reads as "day 1, not
  // started" rather than a negative day — matching getCurrentDay's own
  // lower clamp.
  return Math.max(1, daysBetweenInclusive(startDate, todayISODate()) || 1);
}

// getCurrentDay is elapsedDay capped to the plan's length. Derived from it
// rather than repeating the date arithmetic, so the two can't drift.
export function getCurrentDay(piece, totalDays) {
  return clamp(elapsedDay(piece), 1, totalDays);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISODate() {
  return formatISODate(new Date());
}

export function isoDateFromEpoch(ms) {
  return formatISODate(new Date(ms));
}

export function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatISODate(d);
}

// The Monday on or before `dateStr` (defaults to today) — the start of
// "this week," always Monday regardless of locale. Date.getDay() is
// 0=Sunday..6=Saturday; (getDay() + 6) % 7 maps Monday to 0 and walks
// forward from there, so Sunday (6) correctly resolves to 6 days back.
export function startOfWeekISO(dateStr = todayISODate()) {
  const daysSinceMonday = (new Date(`${dateStr}T00:00:00`).getDay() + 6) % 7;
  return addDaysISO(dateStr, -daysSinceMonday);
}

// Calendar days from `fromDateStr` through `toDateStr`, inclusive of the
// start — e.g. two equal dates returns 1, the next day returns 2. Negative
// or zero means `toDateStr` is before `fromDateStr`.
export function daysBetweenInclusive(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return null;
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T00:00:00`);
  return Math.round((to - from) / MS_PER_DAY) + 1;
}

// Calendar days from today through `dateStr`, inclusive of today — e.g. a
// target date of today returns 1, tomorrow returns 2. Negative/zero means
// the date has already passed.
export function daysUntilInclusive(dateStr) {
  return daysBetweenInclusive(todayISODate(), dateStr);
}
