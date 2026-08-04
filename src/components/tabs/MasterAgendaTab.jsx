import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { generateAllChunks } from "../../lib/chunking";
import { getEffectiveTimeline, computeScheduleStatus } from "../../lib/scheduling";
import { todayISODate, addDaysISO, getCurrentDay, formatRange, mergeRanges, formatMinutes } from "../../lib/utils";

export function MasterAgendaTab({ pieces, onSelectPiece, onSelectDay }) {
  const [selectedDate, setSelectedDate] = useState(todayISODate());

  // Compute aggregated data for all pieces on the selected date
  const agendaData = useMemo(() => {
    try {
      const items = [];
      let totalMinutes = 0;

      // Offset (in days) of the selected date from real "today" — applied on
      // top of each piece's own current-day anchor below, rather than as an
      // absolute calendar calculation per piece. A piece's "current day" is
      // already elapsed-days-since-created clamped into its plan (see
      // getCurrentDay in lib/utils), the same anchor Today's Practice and
      // Overview use — so a plan whose window has technically passed still
      // parks on its last scheduled day instead of vanishing here.
      const todayMs = new Date(`${todayISODate()}T00:00:00`).getTime();
      const selectedDateMs = new Date(`${selectedDate}T00:00:00`).getTime();
      const daysFromToday = Math.round((selectedDateMs - todayMs) / 86400000);

      Object.entries(pieces).forEach(([pieceId, piece]) => {
        try {
          if (!piece) return;

          const chunkSet = generateAllChunks(piece);
          const timeline = getEffectiveTimeline(piece, chunkSet);
          const chunkById = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));

          if (!timeline || !timeline.days || !timeline.days.length) return;

          const realCurrentDay = getCurrentDay(piece, timeline.days.length);
          const dayNumber = realCurrentDay + daysFromToday;

          if (dayNumber < 1 || dayNumber > timeline.days.length) return;

          const day = timeline.days[dayNumber - 1];
          if (!day) return;

          totalMinutes += day.minutes;

          // Combine same-role chunks into contiguous measure ranges, same as
          // the Timeline tab's day cards — a row per role (new/special/review)
          // instead of one row per 4-measure chunk.
          const mergedRangesFor = (ids) => mergeRanges(ids.map((id) => chunkById[id]).filter(Boolean));
          const newRanges = mergedRangesFor(day.newChunkIds);
          const specialRanges = mergedRangesFor(day.specialChunkIds);
          const reviewRanges = mergedRangesFor(day.reviewChunkIds);
          const specialIsCombo = day.specialChunkIds.some((id) => chunkById[id]?.kind === "combo");

          // How many chunks are behind schedule for this piece as of this day —
          // same computation ScheduleBanner uses, called once per piece (not
          // per chunk: computeScheduleStatus already walks all practiceChunks).
          const { missedCount } = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, dayNumber);

          items.push({
            pieceId,
            piece,
            dayNumber,
            day,
            newRanges,
            specialRanges,
            reviewRanges,
            specialIsCombo,
            totalTime: day.minutes,
            missedCount,
          });
        } catch (e) {
          console.error(`Error processing piece ${pieceId}:`, e);
        }
      });

      return { items, totalMinutes };
    } catch (e) {
      console.error('Error in agendaData computation:', e);
      return { items: [], totalMinutes: 0 };
    }
  }, [pieces, selectedDate]);

  const handleDateChange = (days) => {
    setSelectedDate(addDaysISO(selectedDate, days));
  };

  const handleDatePick = (e) => {
    setSelectedDate(e.target.value);
  };

  // Format date for display
  const dateObj = new Date(`${selectedDate}T00:00:00`);
  const dateStr = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const status =
    agendaData.totalMinutes > 60
      ? `Busy day — ${agendaData.items.length} pieces scheduled`
      : agendaData.totalMinutes > 30
        ? `Moderate — ${agendaData.items.length} pieces scheduled`
        : agendaData.items.length > 0
          ? `Light — ${agendaData.items.length} pieces scheduled`
          : "Nothing scheduled";

  return (
    <div className="tab-pane">
      <div className="tab-header day-nav">
        <div>
          <h1>Master Practice Agenda</h1>
          <p className="hero-sub">{dateStr}</p>
        </div>
        <div className="day-nav-controls">
          <button className="icon-btn" onClick={() => handleDateChange(-1)} aria-label="Previous day">
            <ChevronLeft size={16} />
          </button>
          <input type="date" value={selectedDate} onChange={handleDatePick} />
          <button className="icon-btn" onClick={() => handleDateChange(1)} aria-label="Next day">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="time-summary-banner">
        <div className="time-summary-item">
          <div className="time-summary-label">Total planned</div>
          <div className="time-summary-num">{formatMinutes(agendaData.totalMinutes)}</div>
        </div>
        <div className="time-summary-item">
          <div className="time-summary-label">Status</div>
          <div className={`time-status ${agendaData.totalMinutes > 60 ? "busy" : ""}`}>{status}</div>
        </div>
      </div>

      {agendaData.items.length === 0 ? (
        <div className="panel">
          <h3>Nothing scheduled</h3>
          <p className="wizard-hint" style={{ margin: 0 }}>
            No active pieces have practice scheduled for this day.
          </p>
        </div>
      ) : (
        <div className="master-agenda-cards">
          {agendaData.items.map(({ pieceId, piece, day, newRanges, specialRanges, reviewRanges, specialIsCombo, totalTime, missedCount }) => (
            <div key={pieceId} className="piece-card">
              <div className="piece-card-head">
                <div>
                  <h3 className="piece-title">{piece.name}</h3>
                  {piece.composer && <p style={{ fontSize: "12px", color: "var(--ink-faint)", margin: "4px 0 0" }}>{piece.composer}</p>}
                </div>
                <div className="piece-meta">
                  {missedCount > 0 && <span className="badge busy">{missedCount} behind</span>}
                  <div className="piece-time">{formatMinutes(totalTime)}</div>
                </div>
              </div>

              {day.type === "consolidation" ? (
                <p className="day-card-note">Full run-through of the piece</p>
              ) : (
                <>
                  {newRanges.length > 0 && (
                    <div className="day-card-group">
                      <span className="day-card-tag new">New</span>
                      {newRanges.map((r) => (
                        <span key={`new-${r.start}-${r.end}`} className="chip">{formatRange(r.start, r.end)}</span>
                      ))}
                    </div>
                  )}
                  {specialRanges.length > 0 && (
                    <div className="day-card-group">
                      <span className="day-card-tag special">{specialIsCombo ? "Focus" : "Review"}</span>
                      {specialRanges.map((r) => (
                        <span key={`special-${r.start}-${r.end}`} className="chip transition">{formatRange(r.start, r.end)}</span>
                      ))}
                    </div>
                  )}
                  {reviewRanges.length > 0 && (
                    <div className="day-card-group">
                      <span className="day-card-tag review">Review</span>
                      {reviewRanges.map((r) => (
                        <span key={`review-${r.start}-${r.end}`} className="chip subtle">{formatRange(r.start, r.end)}</span>
                      ))}
                    </div>
                  )}
                  {newRanges.length === 0 && specialRanges.length === 0 && reviewRanges.length === 0 && (
                    <div style={{ fontSize: "13px", color: "var(--ink-soft)" }}>No tasks scheduled</div>
                  )}
                </>
              )}

              <div className="piece-footer">
                <span style={{ fontSize: "12px", color: missedCount > 0 ? "var(--brick)" : "var(--ink-soft)" }}>
                  {missedCount > 0 ? `${missedCount} chunk${missedCount === 1 ? "" : "s"} behind schedule` : "On schedule"}
                </span>
                <button className="link-btn" onClick={() => onSelectPiece(pieceId)}>
                  Log practice →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
