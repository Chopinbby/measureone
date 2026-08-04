import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { generateAllChunks } from "../../lib/chunking";
import { getEffectiveTimeline, computeScheduleStatus } from "../../lib/scheduling";
import { todayISODate, addDaysISO } from "../../lib/utils";

export function MasterAgendaTab({ pieces, onSelectPiece, onSelectDay }) {
  const [selectedDate, setSelectedDate] = useState(todayISODate());

  // Compute aggregated data for all pieces on the selected date
  const agendaData = useMemo(() => {
    try {
      const items = [];
      let totalMinutes = 0;

      Object.entries(pieces).forEach(([pieceId, piece]) => {
        try {
          if (!piece || !piece.createdAt) return;

          const chunkSet = generateAllChunks(piece);
          const timeline = getEffectiveTimeline(piece, chunkSet);
          const chunkById = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));

          // Map selectedDate to a day number in this piece's timeline
          if (!timeline || !timeline.days || !timeline.days.length) return;

          const selectedDateMs = new Date(`${selectedDate}T00:00:00`).getTime();
          const createdDateMs = typeof piece.createdAt === 'number' ? piece.createdAt : new Date(piece.createdAt).getTime();
          const dayOffset = Math.floor((selectedDateMs - createdDateMs) / 86400000);
          const dayNumber = dayOffset + 1;

          if (dayNumber < 1 || dayNumber > timeline.days.length) return;

          const day = timeline.days[dayNumber - 1];
          if (!day) return;

          totalMinutes += day.minutes;

          // Gather tasks for this piece on this day
          const tasks = [
            ...day.newChunkIds.map((id) => ({ id, role: "new" })),
            ...day.specialChunkIds.map((id) => ({ id, role: chunkById[id]?.kind || "special" })),
            ...day.reviewChunkIds.map((id) => ({ id, role: "review" })),
          ].sort((a, b) => (a.role === "combo" ? 1 : 0) - (b.role === "combo" ? 1 : 0));

          // How many chunks are behind schedule for this piece as of this day —
          // same computation ScheduleBanner uses, called once per piece (not
          // per chunk: computeScheduleStatus already walks all practiceChunks).
          const { missedCount } = computeScheduleStatus(piece, chunkSet.practiceChunks, timeline, dayNumber);

          items.push({
            pieceId,
            piece,
            dayNumber,
            day,
            tasks: tasks.filter((t) => chunkById[t.id]),
            totalTime: day.minutes,
            missedCount,
            chunkById,
            timeline,
            chunkSet,
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
          <div className="time-summary-num">{agendaData.totalMinutes} min</div>
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
          {agendaData.items.map(({ pieceId, piece, day, tasks, totalTime, missedCount, chunkById }) => (
            <div key={pieceId} className="piece-card">
              <div className="piece-card-head">
                <div>
                  <h3 className="piece-title">{piece.name}</h3>
                  {piece.composer && <p style={{ fontSize: "12px", color: "var(--ink-faint)", margin: "4px 0 0" }}>{piece.composer}</p>}
                </div>
                <div className="piece-meta">
                  {missedCount > 0 && <span className="badge busy">{missedCount} behind</span>}
                  <div className="piece-time">{totalTime} min</div>
                </div>
              </div>

              {day.type === "consolidation" ? (
                <div className="tasks-list">
                  <div className="task-item">
                    <span className="task-tag" style={{ background: "var(--brass)" }}>Full</span>
                    <span>Full run-through (consolidation day)</span>
                  </div>
                </div>
              ) : (
                <div className="tasks-list">
                  {tasks.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "var(--ink-soft)" }}>No tasks scheduled</div>
                  ) : (
                    tasks.map(({ id, role }) => {
                      const chunk = chunkById[id];
                      if (!role) return null;
                      return (
                        <div key={id + role} className="task-item">
                          <span className={`task-tag tag-${role}`}>{role === "combo" ? "Focus" : role}</span>
                          <span>{chunk.displayName || `${chunk.kind} (m. ${chunk.start}–${chunk.end})`}</span>
                        </div>
                      );
                    })
                  )}
                </div>
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
