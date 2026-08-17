import { addDaysISO, todayISODate, formatRange, mergeRanges, formatMinutes, clamp } from "../../../lib/utils";
import { totalDueMinutes } from "../../../lib/maintenance";

/* ------------------------------------------------------------------ */
/*  Week view — 7 days at a glance, current day highlighted.           */
/*                                                                     */
/*  Read-only by design (Pass 22): every cell is a link into the       */
/*  existing single-day view, never a place to log. Logging needs the  */
/*  full ChecklistItem — reps, BPM, outcome — per task, which is far   */
/*  more than a 7-across strip can hold; and a task logged from a cell */
/*  that isn't today would write a session against the wrong day, the  */
/*  one thing the ladder can't tolerate. So the week answers "what's   */
/*  coming", and the day view stays the single place work is recorded. */
/* ------------------------------------------------------------------ */

const WINDOW = 7;

// "Mon, Aug 17" — the same locale call Master Agenda's header uses, just
// with the short weekday so it fits a cell.
function formatCellDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// The 7 plan days to show: the current day, with up to 3 days of context
// either side, slid back inside the plan's bounds at both ends so the
// window is always a full 7 days when the plan is long enough to have
// them. A plan shorter than 7 days just shows all of itself.
function windowFor(currentDay, totalDays) {
  if (totalDays <= WINDOW) return { start: 1, count: totalDays };
  const start = clamp(currentDay - 3, 1, totalDays - WINDOW + 1);
  return { start, count: WINDOW };
}

export function WeekView({ piece, chunks, timeline, currentDay, isRealToday, pastPlan, dueItems, onSelectDay }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  // The filter(Boolean) is belt-and-braces, NOT a guard against a known
  // miss: ids taken from timeline.days[] always resolve, because the
  // timeline is derived from this same chunk set on the same render
  // (docs/Data-Model.md — it's `piece.progress` keys that can go stale,
  // not these). Matches MasterAgendaTab's form; TimelineTab omits it and
  // is equally correct.
  const mergedRangesFor = (ids) => mergeRanges(ids.map((id) => chunkById[id]).filter(Boolean));

  /* ---------------------------------------------------------------- */
  /*  Past the bounded plan: maintenance mode.                         */
  /* ---------------------------------------------------------------- */
  //
  // Only *today* can be filled in here, and that is a real limit rather
  // than an unfinished cell: computeDueReviews answers "what is due as of
  // this date" and nothing in the app answers "what will be due on
  // Thursday" — a forward-looking due window is explicitly scoped out in
  // docs/Decisions.md. Rather than leave six cells looking empty (which
  // would read as "nothing due Thursday" — a promise this data can't
  // make), the days ahead are marked plainly as not-yet-known.
  if (pastPlan) {
    const today = todayISODate();
    const days = Array.from({ length: WINDOW }, (_, i) => addDaysISO(today, i - 3));
    const dueRanges = mergedRangesFor(dueItems.map((i) => i.chunk.id));

    return (
      <div className="panel">
        <h3>This week</h3>
        <p className="wizard-hint">
          This piece has finished its bounded plan, so there's no day-by-day grid left to lay out —
          maintenance reviews come due one day at a time.
        </p>
        <div className="week-grid">
          {days.map((date, i) => {
            const isToday = i === 3;
            const body = isToday ? (
              dueItems.length ? (
                <div className="day-card-group">
                  <span className="day-card-tag review">Due</span>
                  {dueRanges.map((r) => (
                    <span key={`due-${r.start}-${r.end}`} className="chip subtle">{formatRange(r.start, r.end)}</span>
                  ))}
                </div>
              ) : (
                <p className="day-card-note">Nothing due</p>
              )
            ) : (
              <p className="day-card-note" style={{ color: "var(--ink-faint)" }}>
                {i < 3 ? "—" : "Not due yet"}
              </p>
            );

            if (!isToday) {
              return (
                <div key={date} className="day-card" style={{ background: "var(--paper)" }}>
                  <div className="day-card-head">
                    <span className="mono">{formatCellDate(date)}</span>
                  </div>
                  {body}
                </div>
              );
            }

            return (
              <button
                key={date}
                className="day-card clickable"
                style={{ borderColor: "var(--brass)", boxShadow: "inset 0 0 0 1px var(--brass)" }}
                onClick={() => onSelectDay(null)}
              >
                <div className="day-card-head">
                  <span className="mono">{formatCellDate(date)}</span>
                  <span className="mono day-card-min">{formatMinutes(totalDueMinutes(dueItems))}</span>
                </div>
                <span className="day-card-tag special" style={{ marginBottom: 6 }}>Today</span>
                {body}
              </button>
            );
          })}
        </div>
        <p className="wizard-hint" style={{ marginTop: 12, marginBottom: 0 }}>
          Days ahead fill in as reviews come due — nothing is hidden from you here.
        </p>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Inside the plan: 7 plan days around the current one.             */
  /* ---------------------------------------------------------------- */
  const totalDays = timeline.days.length;
  const { start, count } = windowFor(currentDay, totalDays);
  const days = timeline.days.slice(start - 1, start - 1 + count);
  const planStart = piece.startDate || todayISODate();

  return (
    <div className="panel">
      <h3>This week</h3>
      <p className="wizard-hint">
        Days {start}–{start + count - 1} of {totalDays}. Click any day to open it.
      </p>
      <div className="week-grid">
        {days.map((d) => {
          const isCurrent = d.dayNumber === currentDay;
          const specialIsCombo = d.specialChunkIds.some((id) => chunkById[id]?.kind === "combo");
          return (
            <button
              key={d.dayNumber}
              className={`day-card clickable ${d.type}`}
              style={isCurrent ? { borderColor: "var(--brass)", boxShadow: "inset 0 0 0 1px var(--brass)" } : undefined}
              onClick={() => onSelectDay(d.dayNumber)}
            >
              <div className="day-card-head">
                <span className="mono">Day {d.dayNumber}</span>
                <span className="mono day-card-min">{formatMinutes(d.minutes)}</span>
              </div>
              <div className="day-card-head" style={{ marginTop: -4 }}>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                  {formatCellDate(addDaysISO(planStart, d.dayNumber - 1))}
                </span>
              </div>
              {/* Labelled for what it actually is: real today, or a day
                  being browsed — the tab header makes the same distinction
                  with its "(viewing)" suffix. */}
              {isCurrent && (
                <span className="day-card-tag special" style={{ marginBottom: 6 }}>
                  {isRealToday ? "Today" : "Viewing"}
                </span>
              )}
              {d.type === "consolidation" ? (
                <p className="day-card-note">Full run-through of the piece</p>
              ) : d.type === "rest" ? (
                <p className="day-card-note">Rest day</p>
              ) : (
                <>
                  {d.newChunkIds.length > 0 && (
                    <div className="day-card-group">
                      <span className="day-card-tag new">New</span>
                      {mergedRangesFor(d.newChunkIds).map((r) => (
                        <span key={`new-${r.start}-${r.end}`} className="chip">{formatRange(r.start, r.end)}</span>
                      ))}
                    </div>
                  )}
                  {d.specialChunkIds.length > 0 && (
                    <div className="day-card-group">
                      <span className="day-card-tag special">{specialIsCombo ? "Focus" : "Review"}</span>
                      {mergedRangesFor(d.specialChunkIds).map((r) => (
                        <span key={`special-${r.start}-${r.end}`} className="chip transition">{formatRange(r.start, r.end)}</span>
                      ))}
                    </div>
                  )}
                  {d.reviewChunkIds.length > 0 && (
                    <div className="day-card-group">
                      <span className="day-card-tag review">Review</span>
                      {mergedRangesFor(d.reviewChunkIds).map((r) => (
                        <span key={`review-${r.start}-${r.end}`} className="chip subtle">{formatRange(r.start, r.end)}</span>
                      ))}
                    </div>
                  )}
                  {d.newChunkIds.length === 0 && d.specialChunkIds.length === 0 && d.reviewChunkIds.length === 0 && (
                    <p className="day-card-note">Nothing scheduled</p>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
