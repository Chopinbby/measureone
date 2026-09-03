import { Check } from "lucide-react";
import { formatRange, mergeRanges, formatMinutes } from "../../lib/utils";
import { classifyDayCompletion, isDayFullySwept } from "../../lib/scheduling";
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
              const completion = classifyDayCompletion(d, piece, currentDay);
              // A day before the reschedule's asOfDay still carries its
              // pre-reschedule newChunkIds/specialChunkIds/reviewChunkIds —
              // getEffectiveTimeline (lib/scheduling.js) only replaces days
              // from asOfDay onward, so an untouched day further back keeps
              // showing the exact list that got swept into the reschedule,
              // duplicating tasks that now also appear on their new day.
              // isDayFullySwept (lib/scheduling.js, shared with TodayTab.jsx
              // and DayChecklist.jsx — Pass 74 follow-up consolidated what
              // used to be three separate copies of this exact check)
              // collapses this card only when EVERY id the day originally
              // scheduled ended up moved — a day with any real remaining
              // content (done or still legitimately scheduled) renders
              // normally.
              const isFullySwept = isDayFullySwept(d, piece, chunkById);
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
                            <span key={`${r.start}-${r.end}`} className="chip">{formatRange(r.start, r.end)}</span>
                          ))}
                        </div>
                      )}
                      {d.specialChunkIds.length > 0 && (
                        <div className="day-card-group">
                          <span className="day-card-tag special">
                            {d.specialChunkIds.some((id) => chunkById[id].kind === "combo") ? "Focus" : "Review"}
                          </span>
                          {mergedRangesFor(d.specialChunkIds).map((r) => (
                            <span key={`${r.start}-${r.end}`} className="chip transition">{formatRange(r.start, r.end)}</span>
                          ))}
                        </div>
                      )}
                      {d.reviewChunkIds.length > 0 && (
                        <div className="day-card-group">
                          <span className="day-card-tag review">Review</span>
                          {mergedRangesFor(d.reviewChunkIds).map((r) => (
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
