import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Shuffle } from "lucide-react";
import { RandomStartPanel, chunkEntry } from "./revival/RandomStartPanel";
import { generateAllChunks } from "../../lib/chunking";
import { getEffectiveTimeline, computeScheduleStatus, isPlanActuallyComplete, computeMinutesModeAutoExtend } from "../../lib/scheduling";
import { computeDueReviews, totalDueMinutes, mergeLiveDueReviews } from "../../lib/maintenance";
import { todayISODate, addDaysISO, elapsedDay as computeElapsedDay, getCurrentDay, formatRange, mergeRanges, formatMinutes } from "../../lib/utils";
import { isInRevival, computeRevivalPlan } from "../../lib/revival";
import { isPieceLearned } from "../../lib/ladder";

// Which sub-view was last open. This component unmounts whenever you
// navigate to another main tab, so plain useState would reset the choice
// every time you came back. Deliberately module-level rather than lifted
// into App.jsx or written to localStorage: it's transient view state, not
// piece data — it should survive tab switches within a session, but a
// fresh page load starting back at Learning phase is the right default.
let lastSubTab = "learning";

export function MasterAgendaTab({ pieces, onSelectPiece, onSelectPieceToday, onSelectDay, onRescheduleAll }) {
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
          let timeline = getEffectiveTimeline(piece, chunkSet);
          const chunkById = Object.fromEntries(chunkSet.all.map((c) => [c.id, c]));

          if (!timeline || !timeline.days || !timeline.days.length) return;

          // Deliberately *not* getCurrentDay: that clamps into the plan, so
          // a piece whose plan ran out weeks ago would park on its last
          // scheduled day forever and re-show already-finished work. The
          // unclamped elapsed day is what lets us tell "past the plan" from
          // "on the last day of the plan".
          let dayNumber = computeElapsedDay(piece) + daysFromToday;

          if (dayNumber < 1) return;

          // scheduleMode: "minutes" past its own (possibly stale)
          // daysToLearn that isn't learned yet would auto-extend itself
          // the instant it's opened (App.jsx's effect,
          // computeMinutesModeAutoExtend) — there's no deadline to prompt
          // about here, per docs/Decisions.md#scheduling's days-vs-minutes
          // asymmetry. Rather than let such a piece go invisible on this
          // agenda until someone happens to open it directly (the gap this
          // replaces), compute the same extension *for display only* —
          // nothing persisted, a pure rendering-time patch — so the card
          // shows exactly the real, current content it would show once
          // actually opened. `piece`/`timeline`/`dayNumber` are reassigned
          // in place so every read below (missedCount, the day itself,
          // what's pushed into `items`) automatically reflects it. Only
          // for real "today" — browsing the date picker elsewhere has
          // nothing to do with whether *today's* plan needs to grow.
          if (
            dayNumber > timeline.days.length &&
            selectedDate === todayISODate() &&
            piece.scheduleMode === "minutes" &&
            !isPieceLearned(piece, chunkSet)
          ) {
            const extension = computeMinutesModeAutoExtend(piece, chunkSet, timeline);
            if (extension) {
              piece = { ...piece, ...extension };
              timeline = getEffectiveTimeline(piece, chunkSet);
              dayNumber = computeElapsedDay(piece) + daysFromToday;
            }
          }

          // Past the end of the bounded plan there is no timeline day to
          // render — the live maintenance ladder takes over (see
          // lib/maintenance.js). Only ever for real "today": due-ness is
          // strictly "as of today", and asking the picker about a future
          // date must not become an upcoming-due window.
          if (dayNumber > timeline.days.length) {
            // Pass 39: the calendar running out is no longer sufficient to
            // call the plan done — see isPlanActuallyComplete
            // (lib/scheduling.js) and docs/Decisions.md#scheduling. A
            // days-mode piece past its target date with real work still
            // outstanding isn't finished, and falling through to the
            // maintenance-due branch below would misrepresent it:
            // computeDueReviews only ever returns *ladder* reviews for
            // chunks already touched at least once, so a piece with
            // never-touched material left could show an incomplete (or
            // empty) due list and read as "nothing left" when it isn't.
            if (!isPlanActuallyComplete(piece, chunkSet, timeline)) {
              // Reaching here with scheduleMode "minutes" means the
              // extension attempt above either found nothing to extend
              // (already learned — heading into the due-list branch below
              // instead) or was skipped because this isn't real "today" —
              // either way there's nothing to prompt about for this mode,
              // mirroring TodayTab's own days-mode-only nudge.
              if (piece.scheduleMode === "minutes") return;
              if (selectedDate !== todayISODate()) return;
              const { missedCount } = computeScheduleStatus(
                piece,
                chunkSet.practiceChunks,
                timeline,
                timeline.days.length + 1
              );
              items.push({ pieceId, piece, needsReschedule: true, missedCount, totalTime: 0 });
              return;
            }
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
              // The unmerged chunks behind those display ranges — the
              // random-start pool below picks one actual due spot, which a
              // merged range can no longer identify.
              dueChunks: dueItems.map((i) => i.chunk),
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

          const rawDay = timeline.days[dayNumber - 1];
          if (!rawDay) return;

          // Pass 66: fold the live due-reviews query into this day's own
          // reviewChunkIds (and, since a review is now priced the same way
          // as introducing a chunk fresh — see minutesFor/computeDueReviews
          // — its minutes too), same mergeLiveDueReviews helper TodayTab
          // uses — a review whose nextDueDate has already passed while the
          // piece is still inside its active plan otherwise has no surface
          // here either. Only for real "today", matching the due-list
          // branch above (computeDueReviews is "as of today" only, never a
          // forward-looking window for a browsed date).
          const liveDue = selectedDate === todayISODate() ? computeDueReviews(piece, chunkSet, selectedDate) : [];
          const day = mergeLiveDueReviews(rawDay, liveDue);

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

  // Every action below is about what to do *now*, so all three are gated on
  // the picker actually showing today. Browsing to another date is a
  // look-ahead/look-back view: rescheduling from it would act on today's
  // real misses while the screen showed a different day's counts, and
  // "practice this piece" for a day that isn't today is meaningless.
  const isToday = selectedDate === todayISODate();

  // Pieces the agenda is already flagging as behind on the cards below.
  // This only decides whether to *offer* the button — App.jsx recomputes
  // the real set (planRescheduleForPieces) before touching anything.
  const behindItems = learningItems.filter((item) => item.missedCount > 0);

  // Anything with work attached today: a scheduled learning day or due
  // maintenance. Revival pieces are deliberately out, the same way they're
  // out of the "Total planned" banner — their work isn't scheduled to a day,
  // so "practice this today" doesn't apply to them.
  const practiceablePieceIds = agendaData.items.map((item) => item.pieceId);

  const pickRandomPiece = () => {
    if (!practiceablePieceIds.length) return;
    onSelectPieceToday(practiceablePieceIds[Math.floor(Math.random() * practiceablePieceIds.length)]);
  };

  // The maintenance random-start pool: every individual due spot across
  // every piece with due work, each labelled with its piece since this list
  // spans pieces (unlike the revival panel, which lives inside one piece).
  const dueEntries = maintenanceItems.flatMap(({ piece, dueChunks }) =>
    (dueChunks || []).map((c) =>
      chunkEntry(c, piece.memoryAnchors && piece.memoryAnchors[c.id], piece.name || "Untitled piece")
    )
  );

  const renderPieceCard = ({ pieceId, piece, day, newRanges, specialRanges, reviewRanges, specialIsCombo, totalTime, missedCount, isDueList, dueRanges, dueCount, dueOverdueCount, needsReschedule }) => (
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

      {needsReschedule ? (
        <p className="day-card-note">Past its target date with real work still left in the plan.</p>
      ) : isDueList ? (
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
        <span style={{ fontSize: "12px", color: needsReschedule || (!isDueList && missedCount > 0) ? "var(--brick)" : "var(--ink-soft)" }}>
          {needsReschedule
            ? `Past target date${missedCount > 0 ? ` — ${missedCount} chunk${missedCount === 1 ? "" : "s"} behind` : ""}`
            : isDueList
              ? `Maintenance — ${dueCount} spot${dueCount === 1 ? "" : "s"} due${dueOverdueCount > 0 ? ", some waiting a few days" : ""}`
              : missedCount > 0
                ? `${missedCount} chunk${missedCount === 1 ? "" : "s"} behind schedule`
                : "On schedule"}
        </span>
        <button className="link-btn" onClick={() => onSelectPieceToday(pieceId)}>
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

      {isToday && practiceablePieceIds.length > 1 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {/* Offered only from two pieces up — "picking at random" from a
              single candidate is just a slower way to click its card. */}
          <button className="ghost-btn" onClick={pickRandomPiece}>
            <Shuffle size={14} /> Pick a random piece to practice
          </button>
        </div>
      )}

      <div className="segmented" style={{ marginBottom: 16, alignSelf: "flex-start" }}>
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

      {subTab === "learning" && isToday && behindItems.length > 0 && onRescheduleAll && (
        <div className="panel">
          <h3>
            {behindItems.length} piece{behindItems.length === 1 ? " is" : "s are"} behind schedule
          </h3>
          <p className="wizard-hint">
            Rebalance what you haven't started yet across the days each plan has left — in one go, rather
            than piece by piece. Chunks you've already practiced stay where they are, and every piece keeps
            its own target date.
          </p>
          <button className="ghost-btn" onClick={onRescheduleAll}>
            <RefreshCw size={14} /> Reschedule all
          </button>
        </div>
      )}

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
          <>
            {/* The same panel the Revival tab uses, on the same reasoning:
                left to yourself you start a review session at the top of the
                list, so the same spots always get your freshest attention.
                Pools every due spot across every piece — a due-review session
                here spans pieces, so each pick names its piece too. */}
            {dueEntries.length > 1 && (
              <RandomStartPanel
                entries={dueEntries}
                hint="Start somewhere you wouldn't have picked yourself — otherwise the top of the list always gets your freshest attention. Picks from every spot due right now, across all your pieces."
              />
            )}
            <div className="master-agenda-cards">{maintenanceItems.map(renderPieceCard)}</div>
          </>
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
                  <p className="day-card-note">{statusText}</p>

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
