// Pass 142 — whole-piece run-throughs on the new review plan (review model 2).
//
// Everything about a run-through that is a DECISION lives here, in one pure file
// with no JSX and no clock, so it can be tested: which days carry one, what one
// is priced at, and what the "how did that feel?" number is and is not.
//
// What a run-through does NOT do (the owner's decision, 2026-11-22, which
// overturns rule 5's credit in the review model design): it is not a review for
// any chunk. It gives no pass, restarts no review window and changes nothing
// about a chunk's ladder, whether it is clean or not. The rough/lost flags on the
// Piece Map are unchanged and unrelated. A run-through is practice time on the
// schedule plus a stop count, a time and a "how did that feel?" number.
//
// The number is INCONSEQUENTIAL on purpose: nothing in the app may read `feel`
// to decide anything (the schedule, confidence, the ladder, reviews, revival).
// It exists so the person can see how the previous run-through felt. A test pins
// that changing it changes no plan.

// A run-through every this many PRACTICE days (rest days do not count), counted
// from the practice day after the last chunk is introduced. A guess, tracked in
// docs/Research.md.
export const RUN_THROUGH_EVERY_PRACTICE_DAYS = 3;

// The price of a run-through when the piece has no run time of its own and fewer
// than two timed run-throughs: minutes per 100 measures. A guess (Research.md).
export const RUN_THROUGH_GUESS_MIN_PER_100_MEASURES = 8;

// Two or more logged run-throughs with a time replace the estimate with their
// median.
export const RUN_THROUGH_MEDIAN_AFTER = 2;

export const FEEL_MIN = 1;
export const FEEL_MAX = 10;

// A whole number from 1 to 10. Anything else is not a rating and is never saved.
export function isValidFeel(n) {
  return Number.isInteger(n) && n >= FEEL_MIN && n <= FEEL_MAX;
}

// Every logged whole-piece run-through, oldest first as logged. The synthetic
// "__consolidation__" key holds them (App.jsx's handleLogRunThrough); the
// Cold-Start check has its own key and is not read here.
export function runThroughSessions(piece) {
  const entry = piece && piece.progress && piece.progress["__consolidation__"];
  const sessions = entry && Array.isArray(entry.sessions) ? entry.sessions : [];
  return sessions.filter((s) => s && typeof s === "object");
}

// The practice days (calendar day numbers) that carry an early run-through.
// `learningDaysCalendar` is the plan's practice days before the final day (rest
// days and the final run-through day are not in it), `lastIntroDay` the day the
// last chunk is introduced and `learningDays` the last of those practice days.
// The first run-through is the practice day AFTER the last introduction, then one
// every RUN_THROUGH_EVERY_PRACTICE_DAYS practice days. One that would fall on the
// last practice day is dropped: the final-day run-through comes right after it.
export function runThroughPlanDays({ learningDaysCalendar, lastIntroDay, learningDays }) {
  if (!Array.isArray(learningDaysCalendar) || !(lastIntroDay > 0)) return [];
  const after = learningDaysCalendar.filter((d) => d > lastIntroDay);
  const out = [];
  for (let i = 0; i < after.length; i += RUN_THROUGH_EVERY_PRACTICE_DAYS) {
    if (after[i] === learningDays) continue;
    out.push(after[i]);
  }
  return out;
}

function medianOf(sortedAscending) {
  const n = sortedAscending.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sortedAscending[mid] : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

// The median of the piece's timed run-throughs, in seconds, or null with fewer
// than RUN_THROUGH_MEDIAN_AFTER of them. A session without a time (the timer was
// not used and no minutes were typed) does not count.
export function medianLoggedRunSeconds(piece) {
  const seconds = runThroughSessions(piece)
    .map((s) => Number(s.durationSeconds))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return seconds.length >= RUN_THROUGH_MEDIAN_AFTER ? medianOf(seconds) : null;
}

const measuresOf = (c) => (Number.isFinite(c.measureCount) ? c.measureCount : Number.isFinite(c.end) && Number.isFinite(c.start) ? c.end - c.start + 1 : 0);

// The tempo the piece is being played at now: the tempos of the chunks that have
// one, weighted by their measures. A chunk's tempo is its last logged tempo
// (`currentBPM`), else the tempo the ladder is asking for (`practiceBPM`); a chunk
// with neither does not count. null when no chunk has one.
export function currentTempoFor(piece, chunks) {
  const progress = (piece && piece.progress) || {};
  let weighted = 0;
  let weight = 0;
  (chunks || []).forEach((c) => {
    if (!c || c.kind !== "section") return;
    const e = progress[c.id];
    if (!e) return;
    const tempo = Number(e.currentBPM) > 0 ? Number(e.currentBPM) : Number(e.practiceBPM);
    const m = measuresOf(c);
    if (!(tempo > 0) || !(m > 0)) return;
    weighted += tempo * m;
    weight += m;
  });
  return weight > 0 ? weighted / weight : null;
}

// What a whole-piece run-through is priced at, in order:
//   1. two or more logged run-throughs with a time: their median, as it is (each
//      time was already played at the tempo of its day);
//   2. the piece's "Typical run time at target tempo" (`typicalRunSeconds`),
//      scaled by target tempo over the tempo played now (never faster than the
//      target, so never less than the run time itself). With no target tempo, or
//      no chunk with a tempo yet, the run time as it is;
//   3. a guess: RUN_THROUGH_GUESS_MIN_PER_100_MEASURES per 100 measures.
// `source` is "logged", "field" or "guess" so a card can say which it is;
// `tempoScaled` is true only when the ratio in 2 was applied. `minutes` is a whole
// number of minutes, at least 1: the plan places a run-through by it, and a figure
// that changed by seconds with every logged session would move the day's other
// work for no reason.
export function runThroughPrice(piece, chunks) {
  let seconds;
  let source;
  let tempoScaled = false;
  const median = medianLoggedRunSeconds(piece);
  const typical = Number(piece && piece.typicalRunSeconds);
  if (median != null) {
    seconds = median;
    source = "logged";
  } else if (Number.isFinite(typical) && typical > 0) {
    seconds = typical;
    source = "field";
    const target = Number(piece.targetBPM);
    const current = currentTempoFor(piece, chunks);
    if (target > 0 && current > 0) {
      seconds = typical * (target / Math.min(current, target));
      tempoScaled = true;
    }
  } else {
    const total = Number(piece && piece.totalMeasures);
    const measures = total > 0 ? total : (chunks || []).filter((c) => c && c.kind === "section").reduce((s, c) => s + measuresOf(c), 0);
    seconds = (measures / 100) * RUN_THROUGH_GUESS_MIN_PER_100_MEASURES * 60;
    source = "guess";
  }
  return { seconds, minutes: Math.max(1, Math.round(seconds / 60)), source, tempoScaled };
}

// The card's one line about price: "about 12 min at your current tempo".
export function runThroughPriceText(price) {
  if (!price) return "";
  const base = `about ${price.minutes} min`;
  if (price.source === "logged") return `${base} (the middle of your logged run-throughs)`;
  if (price.source === "guess") return `${base} (a guess: set a typical run time in Settings)`;
  return price.tempoScaled ? `${base} at your current tempo` : base;
}

// The number from the most recent EARLIER run-through that has one: sessions
// logged on a plan day before `day`, the latest day first, the latest attempt on
// that day. A session without a number is skipped (it says nothing about how
// that run-through felt). Returns { feel, day, loggedDate } or null.
export function previousFeel(sessions, day) {
  let best = null;
  (sessions || []).forEach((s, i) => {
    if (!s || !isValidFeel(s.feel) || !(Number(s.day) < Number(day))) return;
    const key = [Number(s.day), Number(s.loggedAt) || 0, i];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) {
      best = { key, feel: s.feel, day: Number(s.day), loggedDate: s.loggedDate || null };
    }
  });
  return best ? { feel: best.feel, day: best.day, loggedDate: best.loggedDate } : null;
}
