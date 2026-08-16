import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { generateAllChunks } from "../../lib/chunking";
import { getEffectiveTimeline, computeScheduleStatus } from "../../lib/scheduling";
import { computeDueReviews, totalDueMinutes } from "../../lib/maintenance";
import { todayISODate, addDaysISO, elapsedDay as computeElapsedDay, getCurrentDay, formatRange, mergeRanges, formatMinutes } from "../../lib/utils";
import { REVIVAL_PURPOSE_OPTIONS } from "../../lib/constants";
import { isInRevival, computeRevivalPlan } from "../../lib/revival";

// Which sub-view was last open. This component unmounts whenever you
// navigate to another main tab, so plain useState would reset the choice
// every time you came back. Deliberately module-level rather than lifted
// into App.jsx or written to localStorage: it's transient view state, not
// piece data — it should survive tab switches within a session, but a
// fresh page load starting back at Learning phase is the right default.
let lastSubTab = "learning";

export function MasterAgendaTab({ pieces, onSelectPiece, onSelectDay }) {
  const [selectedDate, setSelectedDate] = useState(todayISODate());
  const [subTab, setSubTabState] = useState(lastSubTab);

  const setSubTab = (next) => {
    lastSubTab = next;
    setSubTabState(next);
  };

  // Compute aggregated data for all pieces on the selected date
  const agendaData = useMemo(() => {
    try {
      const items = [];
      let totalMinutes = 0;

      // Offset (in days) of the selected date from real "today" — applied on
      // top of each piece's own current-day anchor below, rather than as an
      // absolute calendar calculation per piece. A piece whose plan window
      // has passed no longer parks on its last scheduled day here — it
      // switches to the live maintenance due list instead (see below).
      const todayMs = new Date(`${todayISODate()}T00:00:00`).getTime();
      const selectedDateMs = new Date(`${selectedDate}T00:00:00`).getTime();
      const daysFromToday = Math.round((selectedDateMs - todayMs) / 86400000);

      Object.entries(pieces).forEach(([pieceId, piece]) => {
        try {
          if (!piece) return;
          // Paused/archived pieces are deliberately off the daily agenda —
          // that's the entire point of setting a piece aside. Behind-schedule
          // flagging is separately suppressed for them in
          // computeScheduleStatus, so this filter is really about visibility
          // here, not double-guarding the same rule.
          if ((piece.status || "active") !== "active") return;
          // Pieces mid-revival get their own subtab below instead of a
          // learning-phase or maintenance-due card — showing original
          // plan-day content here would be stale (revival doesn't follow
          // the bounded plan), and computeDueReviews already excludes
          // these pieces from the maintenance-due side for the same
          // "don't compete with revival for attention" reason
          // (lib/maintenance.js). Without this, a piece could otherwise
          // appear twice: once here with stale content, once in Revival.
          if (isInRevival(piece)) return;

          const chunkSet = generateAllChunks(piece);
          const timeline = getEffectiveTimeline(piece, chunkSet);
          const chunkById = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));

          if (!timeline || !timeline.days || !timeline.days.length) return;

          // Deliberately *not* getCurrentDay: that clamps into the plan, so
          // a piece whose plan ran out weeks ago would park on its last
          // scheduled day forever and re-show already-finished work. The
          // unclamped elapsed day is what lets us tell "past the plan" from
          // "on the last day of the plan".
          const dayNumber = computeElapsedDay(piece) + daysFromToday;

          if (dayNumber < 1) return;

          // Past the end of the bounded plan there is no timeline day to
          // render — the live maintenance ladder takes over (see
          // lib/maintenance.js). Only ever for real "today": due-ness is
          // strictly "as of today", and asking the picker about a future
          // date must not become an upcoming-due window.
          if (dayNumber > timeline.days.length) {
            if (selectedDate !== todayISODate()) return;
            const dueItems = computeDueReviews(piece, chunkSet, selectedDate);
            if (!dueItems.length) return;
            const dueMinutes = totalDueMinutes(dueItems);
            totalMinutes += dueMinutes;
            items.push({
              pieceId,
              piece,
              isDueList: true,
              dueRanges: mergeRanges(dueItems.map((i) => i.chunk)),
              // Counted off the items, not the merged display ranges —
              // two adjacent due chunks collapse into one chip but are
              // still two things to practice.
              dueCount: dueItems.length,
              dueOverdueCount: dueItems.filter((i) => i.daysOverdue > 0).length,
              totalTime: dueMinutes,
              missedCount: 0,
            });
            return;
          }

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

  // Pieces currently mid-revival, for the Revival subtab.
  //
  // Shows the highest-priority items rather than "today's work": a revival
  // plan is a priority-ordered list, not a dated schedule (RevivalTab says
  // as much — everything in it is loggable any day, in any order), so
  // there is no "today's revival measures" to display. The first plan day
  // is exactly the top-priority block (computeRevivalPlan sorts flagged
  // first, then weakest confidence, then packs to the daily budget), so
  // that's what gets surfaced.
  //
  // Prefers the stored plan so this agrees with what RevivalTab shows.
  // Before a plan is generated — i.e. mid-reassessment — computeRevivalPlan
  // is still a pure function of progress + chunks, so the same priority
  // order can be shown live off partially-reassessed data.
  //
  // Deliberately no time estimate on these cards, and revival minutes stay
  // out of the "Total planned" banner: that number means committed daily
  // work, and revival items explicitly aren't scheduled to a day.
  //
  // Guarded per-piece to the same standard as agendaData above: one piece
  // with malformed data gets skipped and logged, rather than throwing and
  // taking the whole tab down with it.
  const revivalPieces = useMemo(() => {
    try {
      const found = [];
      Object.entries(pieces).forEach(([pieceId, piece]) => {
        try {
          if (!piece) return;
          if ((piece.status || "active") !== "active") return;
          if (!isInRevival(piece)) return;

          const chunkSet = generateAllChunks(piece);
          const timeline = getEffectiveTimeline(piece, chunkSet);
          const dayCount = (timeline && timeline.days && timeline.days.length) || 1;
          const currentDay = getCurrentDay(piece, dayCount);

          const storedDays = piece.revival.plan && piece.revival.plan.days;
          const planDays = storedDays && storedDays.length
            ? storedDays
            : computeRevivalPlan(piece, chunkSet, currentDay).days;

          const topIds = (planDays[0] && planDays[0].itemIds) || [];
          const chunkById = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));
          const priorityRanges = mergeRanges(topIds.map((id) => chunkById[id]).filter(Boolean));

          found.push({ pieceId, piece, priorityRanges });
        } catch (e) {
          console.error(`Error processing revival piece ${pieceId}:`, e);
        }
      });
      return found;
    } catch (e) {
      console.error("Error in revivalPieces computation:", e);
      return [];
    }
  }, [pieces]);

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

  // Same agendaData.items array, split by the one flag that already
  // distinguishes the two shapes it produces — no new computation.
  const learningItems = agendaData.items.filter((item) => !item.isDueList);
  const maintenanceItems = agendaData.items.filter((item) => item.isDueList);

  const renderPieceCard = ({ pieceId, piece, day, newRanges, specialRanges, reviewRanges, specialIsCombo, totalTime, missedCount, isDueList, dueRanges, dueCount, dueOverdueCount }) => (
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

      {isDueList ? (
        <div className="day-card-group">
          <span className="day-card-tag review">Due</span>
          {dueRanges.map((r) => (
            <span key={`due-${r.start}-${r.end}`} className="chip subtle">{formatRange(r.start, r.end)}</span>
          ))}
        </div>
      ) : day.type === "consolidation" ? (
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
        {/* A review arriving late is schedule slack, never a
            failure — the due card states the count plainly and is
            never styled as "behind". */}
        <span style={{ fontSize: "12px", color: isDueList ? "var(--ink-soft)" : missedCount > 0 ? "var(--brick)" : "var(--ink-soft)" }}>
          {isDueList
            ? `Maintenance — ${dueCount} spot${dueCount === 1 ? "" : "s"} due${dueOverdueCount > 0 ? ", some waiting a few days" : ""}`
            : missedCount > 0
              ? `${missedCount} chunk${missedCount === 1 ? "" : "s"} behind schedule`
              : "On schedule"}
        </span>
        <button className="link-btn" onClick={() => onSelectPiece(pieceId)}>
          Log practice →
        </button>
      </div>
    </div>
  );

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

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button type="button" className={subTab === "learning" ? "active" : ""} onClick={() => setSubTab("learning")}>
          Learning phase ({learningItems.length})
        </button>
        <button type="button" className={subTab === "maintenance" ? "active" : ""} onClick={() => setSubTab("maintenance")}>
          Maintenance due ({maintenanceItems.length})
        </button>
        <button type="button" className={subTab === "revival" ? "active" : ""} onClick={() => setSubTab("revival")}>
          Revival ({revivalPieces.length})
        </button>
      </div>

      {subTab === "learning" && (
        learningItems.length === 0 ? (
          <div className="panel">
            <h3>Nothing scheduled</h3>
            <p className="wizard-hint" style={{ margin: 0 }}>
              No active pieces have practice scheduled for this day.
            </p>
          </div>
        ) : (
          <div className="master-agenda-cards">{learningItems.map(renderPieceCard)}</div>
        )
      )}

      {subTab === "maintenance" && (
        maintenanceItems.length === 0 ? (
          <div className="panel">
            <h3>Nothing due</h3>
            <p className="wizard-hint" style={{ margin: 0 }}>
              No maintenance reviews are due.
            </p>
          </div>
        ) : (
          <div className="master-agenda-cards">{maintenanceItems.map(renderPieceCard)}</div>
        )
      )}

      {subTab === "revival" && (
        revivalPieces.length === 0 ? (
          <div className="panel">
            <h3>No pieces in revival</h3>
            <p className="wizard-hint" style={{ margin: 0 }}>
              Start a revival from a piece's overview to see it here.
            </p>
          </div>
        ) : (
          <div className="master-agenda-cards">
            {revivalPieces.map(({ pieceId, piece, priorityRanges }) => {
              const revival = piece.revival || {};
              const purposeLabel = REVIVAL_PURPOSE_OPTIONS.find((o) => o.value === revival.purpose);
              const statusText = !revival.reassessmentComplete
                ? "Reassessment in progress"
                : revival.plan
                  ? "Plan ready — resume practicing"
                  : "Reassessment complete — plan not generated yet";
              return (
                <div key={pieceId} className="piece-card">
                  <div className="piece-card-head">
                    <div>
                      <h3 className="piece-title">{piece.name}</h3>
                      {piece.composer && <p style={{ fontSize: "12px", color: "var(--ink-faint)", margin: "4px 0 0" }}>{piece.composer}</p>}
                    </div>
                  </div>
                  <p className="day-card-note">
                    Bringing this piece back{purposeLabel ? ` for ${purposeLabel.label.toLowerCase()}` : ""}
                  </p>
                  <p className="day-card-note" style={{ marginTop: 4 }}>{statusText}</p>

                  {priorityRanges.length > 0 && (
                    <div className="day-card-group" style={{ marginTop: 10 }}>
                      {/* "Start here", not "today" — a revival plan is
                          priority-ordered, not scheduled to a date. */}
                      <span className="day-card-tag special">Start here</span>
                      {priorityRanges.map((r) => (
                        <span key={`rev-${r.start}-${r.end}`} className="chip transition">{formatRange(r.start, r.end)}</span>
                      ))}
                    </div>
                  )}

                  <div className="piece-footer" style={{ justifyContent: "flex-end" }}>
                    <button className="link-btn" onClick={() => onSelectPiece(pieceId)}>
                      Open piece →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
