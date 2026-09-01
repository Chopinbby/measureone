import { useState } from "react";
import { ChecklistItem } from "./ChecklistItem";
import { NumberInput } from "../../NumberInput";
import { formatMinutes } from "../../../lib/utils";

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

  if (items.length === 0) {
    return (
      <div className="panel">
        <h3>Day {day.dayNumber}</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>Nothing scheduled.</p>
      </div>
    );
  }

  // A day before the reschedule's asOfDay still carries its pre-reschedule
  // newChunkIds/specialChunkIds/reviewChunkIds — getEffectiveTimeline
  // (lib/scheduling.js) only replaces days from asOfDay onward, so an
  // untouched day further back keeps showing the exact list that got swept
  // into the reschedule, duplicating tasks that now also appear on their new
  // day. Collapse only when EVERY item this day originally scheduled ended
  // up moved — a day with any real remaining content (done or still
  // legitimately scheduled) renders normally. Re-derived from the live
  // marker on every render, same as everything else here — no separate
  // persisted flag. Shared by both View all (one DayChecklist per timeline
  // day) and the single-day view — day nav has no logic that skips a
  // fully-swept day, so this same check is what keeps that reachable case
  // from showing stale duplicates too.
  //
  // remainingChunkOrder (computeScheduleStatus) only ever lists
  // *practice*-chunk ids, but specialChunkIds/reviewChunkIds routinely hold
  // a transition or combo id instead (its role here comes through as
  // "transition"/"combo" from chunkById[id].kind above) — never itself in
  // remainingChunkOrder, even when it genuinely got carried into the
  // rescheduled remainder (getEffectiveTimeline moves a transition whenever
  // either linked chunk remains, and a combo whenever its one linked chunk
  // does — the same linkedIds check mirrored here). Bare membership alone
  // would treat almost every day past the very first as "still has real
  // content" purely because of this id-namespace gap, not because anything
  // on it was actually left behind.
  //
  // remainingConnectorIds (Pass 73 follow-up to Pass 65) checks a
  // connector's own logged status directly, alongside — not instead of —
  // the neighbor-based check above: a connector whose neighbors are both
  // already practiced but whose own doneDays is still empty used to be
  // invisible to this check entirely, unmovable by any reschedule no
  // matter how many times the piece was rescheduled again.
  const marker = piece.rescheduleMarker;
  const isMovedId = (id) => {
    if (!marker) return false;
    if (marker.remainingChunkOrder.includes(id)) return true;
    if (marker.remainingConnectorIds && marker.remainingConnectorIds.includes(id)) return true;
    const c = chunkById[id];
    if (!c || !c.linkedIds) return false;
    return c.kind === "combo"
      ? marker.remainingChunkOrder.includes(c.linkedIds[0])
      : c.linkedIds.some((lid) => marker.remainingChunkOrder.includes(lid));
  };
  const isFullySwept =
    marker != null &&
    day.dayNumber < marker.asOfDay &&
    items.every((item) => isMovedId(item.id));

  if (isFullySwept) {
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
    </div>
  );
}
