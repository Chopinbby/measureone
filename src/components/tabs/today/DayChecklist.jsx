import { useState } from "react";
import { ChecklistItem } from "./ChecklistItem";
import { NumberInput } from "../../NumberInput";
import { formatMinutes } from "../../../lib/utils";
import { isDayFullySwept } from "../../../lib/scheduling";

// Consolidation-day logging: stop count replaces the old bare "mark
// complete" checkbox (Repertoire-Lifecycle.md's "Post-run-through
// logging"). Chunk-level rough/lost flagging for what caught during this
// run-through happens separately, on the Piece Map.
function ConsolidationPanel({ piece, day, onLogRunThrough, onUnlogRunThrough }) {
  const entry = piece.progress["__consolidation__"] || {};
  const done = (entry.doneDays || []).includes(day);
  const sessionsToday = (entry.sessions || []).filter((s) => s.day === day);
  const lastSession = sessionsToday[sessionsToday.length - 1];
  const [stopCount, setStopCount] = useState("");

  const submit = () => {
    if (stopCount === "") return;
    onLogRunThrough(day, Number(stopCount));
    setStopCount("");
  };

  return (
    <div className="panel">
      <h3>Day {day} — Full run-through</h3>
      <p className="wizard-hint">No new material today. Play through the whole piece and note where it still catches.</p>
      {lastSession && (
        <p className="tip-line">
          Logged: stopped {lastSession.stopCount} time{lastSession.stopCount === 1 ? "" : "s"}
          {sessionsToday.length > 1 ? ` (attempt ${sessionsToday.length} today)` : ""}
        </p>
      )}
      <div className="log-row">
        <label>
          <span>Times stopped</span>
          <NumberInput value={stopCount} min={0} onCommit={(n) => setStopCount(n)} placeholder="0" />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button className="primary-btn sm" disabled={stopCount === ""} onClick={submit}>
          {done ? "Log another run-through" : "Log run-through"}
        </button>
        {done && (
          <button className="ghost-btn" onClick={() => onUnlogRunThrough(day)}>
            Undo most recent
          </button>
        )}
      </div>
      <p className="wizard-hint" style={{ marginTop: 10, marginBottom: 0 }}>
        Flag any chunk that caught on the <strong>Piece Map</strong> — rough or lost.
      </p>
    </div>
  );
}

export function DayChecklist({
  piece,
  chunks,
  day,
  onLogSession,
  onUnlogSession,
  onConfirmProvisionalSession,
  onDiscardProvisionalSession,
  onLogRunThrough,
  onUnlogRunThrough,
  onSetMemoryAnchor,
}) {
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));

  if (day.type === "consolidation") {
    return (
      <ConsolidationPanel
        piece={piece}
        day={day.dayNumber}
        onLogRunThrough={onLogRunThrough}
        onUnlogRunThrough={onUnlogRunThrough}
      />
    );
  }

  const items = [
    ...day.newChunkIds.map((id) => ({ id, role: "new" })),
    ...day.specialChunkIds.map((id) => ({ id, role: chunkById[id].kind })),
    ...day.reviewChunkIds.map((id) => ({ id, role: "review" })),
  ];
  // Combos ("Focus block") span several chunks and take longer than a single
  // chunk's worth of practice — always last, after every atomic task. Sort is
  // stable, so relative order otherwise is unaffected.
  items.sort((a, b) => (a.role === "combo" ? 1 : 0) - (b.role === "combo" ? 1 : 0));

  // withLiveReviewStatus (lib/scheduling.js) already stripped any review
  // here whose due date has passed out of day.reviewChunkIds before this
  // component ever saw it — it's already live and actionable on today's
  // own screen (mergeLiveDueReviews), so re-showing it here as a
  // still-open task would just duplicate it. staleReviewIds is what got
  // pulled, kept around only so this note can say so instead of the item
  // silently vanishing with no explanation.
  const staleReviewNote = day.staleReviewIds && day.staleReviewIds.length > 0 && (
    <p className="wizard-hint" style={{ fontStyle: "italic", margin: "8px 0 0" }}>
      {day.staleReviewIds.length === 1 ? "1 review" : `${day.staleReviewIds.length} reviews`} originally scheduled
      here {day.staleReviewIds.length === 1 ? "is" : "are"} now tracked as due — see Daily Practice.
    </p>
  );

  if (items.length === 0) {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>
          {staleReviewNote ? <em>Already due — see Daily Practice</em> : "Nothing scheduled."}
        </p>
      </div>
    );
  }

  // A day before the reschedule's asOfDay still carries its pre-reschedule
  // newChunkIds/specialChunkIds/reviewChunkIds — getEffectiveTimeline
  // (lib/scheduling.js) only replaces days from asOfDay onward, so an
  // untouched day further back keeps showing the exact list that got swept
  // into the reschedule, duplicating tasks that now also appear on their new
  // day. isDayFullySwept (lib/scheduling.js, shared with TodayTab.jsx and
  // TimelineTab.jsx — Pass 74 follow-up consolidated what used to be three
  // separate copies of this exact check) collapses this only when EVERY
  // item this day originally scheduled ended up moved — a day with any real
  // remaining content (done or still legitimately scheduled) renders
  // normally. Shared by both View all (one DayChecklist per timeline day)
  // and the single-day view — day nav has no logic that skips a
  // fully-swept day, so this same check is what keeps that reachable case
  // from showing stale duplicates too. `items` maps 1:1 off the same
  // newChunkIds/specialChunkIds/reviewChunkIds isDayFullySwept reads
  // directly off `day`, just relabeled with a role — passing `day` itself
  // checks the identical id set.
  if (isDayFullySwept(day, piece, chunkById)) {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        <p className="wizard-hint" style={{ margin: 0 }}><em>Tasks rescheduled</em></p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Day {day.dayNumber} — {formatMinutes(day.minutes)} planned</h3>
      <div className="checklist">
        {items.map(({ id, role }) => (
          <ChecklistItem
            key={id + role}
            chunk={chunkById[id]}
            role={role}
            piece={piece}
            day={day.dayNumber}
            onLogSession={onLogSession}
            onUnlogSession={onUnlogSession}
            onConfirmProvisionalSession={onConfirmProvisionalSession}
            onDiscardProvisionalSession={onDiscardProvisionalSession}
            onSetMemoryAnchor={onSetMemoryAnchor}
          />
        ))}
      </div>
      {staleReviewNote}
    </div>
  );
}
