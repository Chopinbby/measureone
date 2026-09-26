import { Check } from "lucide-react";
import { formatRange, mergeRanges, formatMinutes } from "../../lib/utils";
import { classifyDayCompletion, classifyDayEmptyState, movedIdsForDay } from "../../lib/scheduling";
import { ScheduleBanner } from "../ScheduleBanner";

export function TimelineTab({ chunks, chunkSet, timeline, piece, currentDay, realCurrentDay, onSelectDay, onReschedule }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const mergedRangesFor = (ids) => mergeRanges(ids.map((id) => chunkById[id]));
  const weeks = [];
  for (let i = 0; i < timeline.days.length; i += 7) weeks.push(timeline.days.slice(i, i + 7));

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Timeline</h1>
        <p className="hero-sub">
          Touch the whole piece by day {timeline.halfPoint}. Review and master until day{" "}
          {timeline.learningDays}. Click a day to see your practice agenda.
        </p>
      </div>

      <ScheduleBanner piece={piece} chunkSet={chunkSet} timeline={timeline} realCurrentDay={realCurrentDay} onReschedule={onReschedule} />

      {weeks.map((week, wi) => (
        <div key={wi} className="panel">
          <h3>Week {wi + 1}</h3>
          <div className="week-grid">
            {week.map((d) => {
              const completion = classifyDayCompletion(d, piece, currentDay, chunkById);
              // A day before the reschedule's asOfDay still carries its
              // pre-reschedule newChunkIds/specialChunkIds/reviewChunkIds —
              // getEffectiveTimeline (lib/scheduling.js) only replaces days
              // from asOfDay onward, so an untouched day further back keeps
              // showing the exact list that got swept into the reschedule,
              // duplicating tasks that now also appear on their new day.
              // classifyDayEmptyState (lib/scheduling.js, shared across all
              // four day-list surfaces as of Pass 92) collapses this card
              // only when EVERY id the day originally scheduled ended up
              // moved — a day with any real remaining content (done or
              // still legitimately scheduled) renders normally.
              const emptyState = classifyDayEmptyState(d, piece, chunkById);
              // A day that ISN'T fully swept (e.g. a genuinely still-open
              // review keeps it from collapsing above) can still have SOME
              // of its own ids individually relocated elsewhere by the
              // reschedule — filtered out here so a moved chunk doesn't
              // also render on its old day, duplicating the same range
              // that now legitimately shows on its new one.
              const movedIds = movedIdsForDay(d, piece, chunkById);
              const visibleNewIds = d.newChunkIds.filter((id) => !movedIds.has(id));
              const visibleSpecialIds = d.specialChunkIds.filter((id) => !movedIds.has(id));
              const visibleReviewIds = d.reviewChunkIds.filter((id) => !movedIds.has(id));
              return (
                <button
                  key={d.dayNumber}
                  className={`day-card clickable ${d.type}${completion !== "future" ? " day-past" : ""}`}
                  onClick={() => onSelectDay(d.dayNumber)}
                >
                  <div className="day-card-head">
                    <span className="mono day-card-day">
                      Day {d.dayNumber}
                      {completion === "done" && <Check size={13} className="day-card-check" />}
                    </span>
                    <span className="mono day-card-min">{formatMinutes(d.minutes)}</span>
                  </div>
                  {d.type === "consolidation" ? (
                    <p className="day-card-note">Full run-through of the piece</p>
                  ) : emptyState === "rescheduled" ? (
                    <p className="day-card-note"><em>Tasks rescheduled</em></p>
                  ) : emptyState === "empty" ? (
                    <p className="day-card-note">Nothing scheduled.</p>
                  ) : (
                    <>
                      {visibleNewIds.length > 0 && (
                        <div className="day-card-group">
                          <span className="day-card-tag new">New</span>
                          {mergedRangesFor(visibleNewIds).map((r) => (
                            <span key={`${r.start}-${r.end}`} className="chip">{formatRange(r.start, r.end)}</span>
                          ))}
                        </div>
                      )}
                      {visibleSpecialIds.length > 0 && (
                        <div className="day-card-group">
                          <span className="day-card-tag special">
                            {visibleSpecialIds.some((id) => chunkById[id].kind === "combo") ? "Focus" : "Review"}
                          </span>
                          {mergedRangesFor(visibleSpecialIds).map((r) => (
                            <span key={`${r.start}-${r.end}`} className="chip transition">{formatRange(r.start, r.end)}</span>
                          ))}
                        </div>
                      )}
                      {visibleReviewIds.length > 0 && (
                        <div className="day-card-group">
                          <span className="day-card-tag review">Review</span>
                          {mergedRangesFor(visibleReviewIds).map((r) => (
                            <span key={`${r.start}-${r.end}`} className="chip subtle">{formatRange(r.start, r.end)}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
