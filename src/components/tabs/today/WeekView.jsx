import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysISO, todayISODate, formatRange, mergeRanges, formatMinutes, clamp } from "../../../lib/utils";
import { totalDueMinutes, computeDueOnDate } from "../../../lib/maintenance";
import { isDayFullySwept } from "../../../lib/scheduling";

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

export function WeekView({ piece, chunks, timeline, currentDay, isRealToday, pastPlan, dueItems, onSelectDay, onDayChange }) {
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
  // Forward-looking, on direct request (docs/Decisions.md#open-questions)
  // — the "due-in-N-days" query originally scoped out (the stated concern:
  // showing "due Thursday" might invite practising it Wednesday, exactly
  // the massed-practice pattern spacing exists to prevent) is built here
  // via computeDueOnDate (lib/maintenance.js). Today's cell still uses the
  // `dueItems` prop (computeDueReviews — the real backlog, everything due
  // *as of* today); each day *after* today uses computeDueOnDate's exact
  // nextDueDate match instead, so a real backlog doesn't silently
  // re-count into every future cell too. Days *before* today are left as
  // "—", same as before this — a forward week doesn't imply a backward
  // one, and what was due then is either logged already or already folded
  // into today's own backlog.
  if (pastPlan) {
    const today = todayISODate();
    const days = Array.from({ length: WINDOW }, (_, i) => addDaysISO(today, i - 3));
    const chunkSetShim = { all: chunks };

    return (
      <div className="panel">
        <h3>This week</h3>
        <p className="wizard-hint">
          This piece has finished its bounded plan — maintenance reviews now come due one day at a
          time, on each chunk's own spaced-repetition schedule.
        </p>
        <div className="week-grid">
          {days.map((date, i) => {
            const isToday = i === 3;
            const isPast = i < 3;
            const dayItems = isPast ? [] : isToday ? dueItems : computeDueOnDate(piece, chunkSetShim, date);
            const dayRanges = mergedRangesFor(dayItems.map((it) => it.chunk.id));
            const body = isPast ? (
              <p className="day-card-note" style={{ color: "var(--ink-faint)" }}>—</p>
            ) : dayItems.length ? (
              <div className="day-card-group">
                <span className="day-card-tag review">Due</span>
                {dayRanges.map((r) => (
                  <span key={`due-${r.start}-${r.end}`} className="chip subtle">{formatRange(r.start, r.end)}</span>
                ))}
              </div>
            ) : (
              <p className="day-card-note">Nothing due</p>
            );

            if (!isToday) {
              return (
                <div key={date} className="day-card" style={{ background: "var(--paper)" }}>
                  <div className="day-card-head">
                    <span className="mono">{formatCellDate(date)}</span>
                    {!isPast && dayItems.length > 0 && (
                      <span className="mono day-card-min">{formatMinutes(totalDueMinutes(dayItems))}</span>
                    )}
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
          Days ahead show what's newly due that day — anything already overdue stays counted in
          today's total, not repeated into every day after it.
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
  // Pagination reuses windowFor's own recentering rather than tracking a
  // separate offset: shifting currentDay by a full week and letting
  // windowFor recompute {start, count} around the new value is sufficient,
  // clamped here too (not just relying on windowFor's internal clamp, or
  // App.jsx's own onDayChange clamp) so Previous/Next never requests a day
  // outside the plan in the first place. Calls onDayChange directly, NOT
  // onSelectDay — onSelectDay is TodayTab's handleSelectWeekDay, which
  // also does setViewMode("day") unconditionally (it's built for "click a
  // day cell to jump into it"). Reusing it here landed you back on Day
  // view on every Previous/Next click, defeating the point of paging
  // through the week without leaving it — confirmed live before this fix.
  // onDayChange is the plain, view-mode-agnostic day setter TodayTab
  // itself already receives from App.jsx, threaded straight through.
  const atFirstWindow = start === 1;
  const atLastWindow = start + count - 1 === totalDays;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>This week</h3>
          <p className="wizard-hint" style={{ margin: "4px 0 0" }}>
            Days {start}–{start + count - 1} of {totalDays}. Click any day to open it.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="icon-btn"
            disabled={atFirstWindow}
            onClick={() => onDayChange(clamp(currentDay - WINDOW, 1, totalDays))}
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={atLastWindow}
            onClick={() => onDayChange(clamp(currentDay + WINDOW, 1, totalDays))}
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="week-grid">
        {days.map((d) => {
          const isCurrent = d.dayNumber === currentDay;
          const specialIsCombo = d.specialChunkIds.some((id) => chunkById[id]?.kind === "combo");
          // Pass 75 — same isDayFullySwept check DayChecklist/TodayTab's
          // own single-day view/TimelineTab already apply (Pass 48, widened
          // Pass 73): a day before the reschedule marker's asOfDay still
          // carries its stale pre-reschedule newChunkIds/specialChunkIds/
          // reviewChunkIds, duplicating tasks that now also appear on their
          // new day. Week view had never had this check at all, so a
          // rescheduled day showed real, clickable-looking tasks here that
          // clicking into (Day view) already knew to collapse to "Tasks
          // rescheduled" — the exact report this pass exists to fix.
          const isFullySwept = isDayFullySwept(d, piece, chunkById);
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
              ) : isFullySwept ? (
                <p className="day-card-note"><em>Tasks rescheduled</em></p>
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
                  {/* withLiveReviewStatus (lib/scheduling.js) already
                      pulled a passed-due review out of d.reviewChunkIds
                      above — it's already live and actionable on today's
                      own screen (mergeLiveDueReviews), not stuck here.
                      This just says so instead of it silently vanishing. */}
                  {d.staleReviewIds && d.staleReviewIds.length > 0 && (
                    <p className="day-card-note" style={{ fontSize: 11, fontStyle: "italic" }}>Now due — see today</p>
                  )}
                  {d.newChunkIds.length === 0 && d.specialChunkIds.length === 0 && d.reviewChunkIds.length === 0 &&
                    !(d.staleReviewIds && d.staleReviewIds.length > 0) && (
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
