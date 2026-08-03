import { formatRange } from "../../lib/utils";

export function TimelineTab({ chunks, timeline, onSelectDay }) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
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

      {weeks.map((week, wi) => (
        <div key={wi} className="panel">
          <h3>Week {wi + 1}</h3>
          <div className="week-grid">
            {week.map((d) => (
              <button key={d.dayNumber} className={`day-card clickable ${d.type}`} onClick={() => onSelectDay(d.dayNumber)}>
                <div className="day-card-head">
                  <span className="mono">Day {d.dayNumber}</span>
                  <span className="mono day-card-min">{d.minutes}m</span>
                </div>
                {d.type === "consolidation" ? (
                  <p className="day-card-note">Full run-through of the piece</p>
                ) : (
                  <>
                    {d.newChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag new">New</span>
                        {d.newChunkIds.map((id) => (
                          <span key={id} className="chip">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                    {d.specialChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag special">
                          {d.specialChunkIds.some((id) => chunkById[id].kind === "combo") ? "Focus" : "Review"}
                        </span>
                        {d.specialChunkIds.map((id) => (
                          <span key={id} className="chip transition">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                    {d.reviewChunkIds.length > 0 && (
                      <div className="day-card-group">
                        <span className="day-card-tag review">Review</span>
                        {d.reviewChunkIds.map((id) => (
                          <span key={id} className="chip subtle">{formatRange(chunkById[id].start, chunkById[id].end)}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
