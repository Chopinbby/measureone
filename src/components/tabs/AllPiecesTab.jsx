import { generateAllChunks } from "../../lib/chunking";
import { computeConfidence, computeProgressTier } from "../../lib/confidence";
import { sumPracticeSeconds, formatHoursMinutes, elapsedDay, daysBetweenInclusive, todayISODate } from "../../lib/utils";
import { PIECE_STATUS_LABEL } from "../../lib/constants";

// Bounded first version (Pass 42): a per-piece summary row (progress %,
// confidence, days since last touched, time practiced) for every piece in
// `pieces`, plus a total-time-practiced stat above the list. Deliberately
// does not attempt a cross-piece consistency/streak view — see
// docs/Roadmap.md for why that's a separate, later decision.
//
// Confidence uses elapsedDay(piece) (real calendar days since startDate,
// unclamped) rather than the timeline-clamped getCurrentDay MasterAgendaTab
// and OverviewTab use for the *active* piece. For a piece still inside its
// own plan window the two are identical, so most rows match what that
// piece's own Overview tab would show. They diverge only for a piece that's
// run past its own plan and hasn't been reopened since (which is exactly
// when MasterAgendaTab reaches for computeMinutesModeAutoExtend's
// display-only extension for "background" pieces) — this view doesn't
// replicate that, so such a piece's confidence here keeps decaying with
// real time rather than freezing at the plan's last day. Narrow, and
// arguably more correct for a pure confidence read, but flagged rather than
// silently assumed equivalent.
function summarizePiece(piece) {
  const chunkSet = generateAllChunks(piece);
  const practiceChunks = chunkSet.practiceChunks;
  const currentDay = elapsedDay(piece);

  const tierMeasures = { untouched: 0, learned: 0, comfortable: 0, mastered: 0 };
  practiceChunks.forEach((c) => {
    tierMeasures[computeProgressTier(c, piece)] += c.measureCount;
  });
  const measuresLearned = piece.totalMeasures - tierMeasures.untouched;
  const progressPct = piece.totalMeasures ? Math.round((measuresLearned / piece.totalMeasures) * 100) : 0;

  const confidence = practiceChunks.length
    ? Math.round(practiceChunks.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / practiceChunks.length)
    : 0;

  const daysSinceTouched = piece.lastLoggedAt ? daysBetweenInclusive(piece.lastLoggedAt, todayISODate()) - 1 : null;

  const totalSeconds = sumPracticeSeconds(piece);

  return { progressPct, confidence, daysSinceTouched, totalSeconds };
}

// One malformed piece shouldn't take down a view whose whole point is
// showing every piece at once — same reasoning, and the same two-layer
// shape (per-piece try/catch inside an outer one), as MasterAgendaTab's
// agendaData computation.
function summarizeRows(pieces) {
  const rows = [];
  try {
    (pieces || []).forEach((piece) => {
      try {
        rows.push({ piece, ...summarizePiece(piece) });
      } catch (e) {
        console.error(`Error summarizing piece ${piece && piece.id}:`, e);
      }
    });
  } catch (e) {
    console.error("Error in AllPiecesTab row computation:", e);
    return [];
  }
  return rows;
}

export function AllPiecesTab({ pieces, onSelectPiece }) {
  const rows = summarizeRows(pieces);
  const totalSeconds = rows.reduce((s, r) => s + r.totalSeconds, 0);

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>All Pieces</h1>
      </div>

      <div className="stat-grid-2">
        <div className="stat-card">
          <span className="stat-num mono">{formatHoursMinutes(totalSeconds)}</span>
          <span className="stat-lbl">Total time practiced, across {rows.length} piece{rows.length === 1 ? "" : "s"}</span>
        </div>
        <div className="stat-card">
          <span className="stat-num mono">{rows.length}</span>
          <span className="stat-lbl">Piece{rows.length === 1 ? "" : "s"} in your rotation</span>
        </div>
      </div>

      <div className="panel">
        <h3>Every piece</h3>
        {rows.length === 0 ? (
          <p className="wizard-hint">Add a piece to see it summarized here.</p>
        ) : (
          <div className="day-preview-list">
            <div className="day-preview-row all-pieces-head">
              <span className="day-desc">Piece</span>
              <span className="mono all-pieces-col">Progress</span>
              <span className="mono all-pieces-col">Confidence</span>
              <span className="mono all-pieces-col">Last touched</span>
              <span className="mono all-pieces-col">Time</span>
            </div>
            {rows.map(({ piece, progressPct, confidence, daysSinceTouched, totalSeconds: pieceSeconds }) => (
              <button
                key={piece.id}
                type="button"
                className="day-preview-row clickable"
                onClick={() => onSelectPiece(piece.id)}
              >
                <span className="day-desc">
                  {piece.name}
                  {piece.status && piece.status !== "active" && (
                    <span className={`badge ${piece.status}`}>{PIECE_STATUS_LABEL[piece.status]}</span>
                  )}
                </span>
                <span className="mono all-pieces-col">{progressPct}%</span>
                <span className="mono all-pieces-col">{confidence}%</span>
                <span className="mono all-pieces-col">
                  {daysSinceTouched === null ? "Never" : daysSinceTouched === 0 ? "Today" : `${daysSinceTouched}d ago`}
                </span>
                <span className="mono all-pieces-col">{formatHoursMinutes(pieceSeconds)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
