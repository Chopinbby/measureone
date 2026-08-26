import { Plus, RefreshCw } from "lucide-react";
import { ScheduleBanner } from "../ScheduleBanner";
import { ManuscriptDoodle, ManuscriptStrip } from "../Manuscript";
import { RecordingsList } from "../fields/RecordingsList";
import { DocumentsList } from "../fields/DocumentsList";
import { PartSwitcher } from "../PartSwitcher";
import { sumPracticeSeconds, formatHoursMinutes, formatMinutes } from "../../lib/utils";
import { countLearnedSections } from "../../lib/chunking";
import { computeConfidence, computeProgressTier, PROGRESS_TIER_META } from "../../lib/confidence";
import { computeRevivalTriggers, isInRevival } from "../../lib/revival";
import { PIECE_STATUS_LABEL } from "../../lib/constants";

export function OverviewTab({
  piece,
  practiceChunks,
  chunks,
  chunkSet,
  timeline,
  currentDay,
  onReschedule,
  onAddPiece,
  onStartRevival,
  workParts,
  onSelectPart,
  onAddPart,
  onSelectDay,
}) {
  const revivalActive = isInRevival(piece);
  const revivalTriggers = !revivalActive && chunkSet ? computeRevivalTriggers(piece, chunkSet) : { triggered: false, reasons: [] };
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  const tierMeasures = { untouched: 0, learned: 0, comfortable: 0, mastered: 0 };
  practiceChunks.forEach((c) => {
    tierMeasures[computeProgressTier(c, piece)] += c.measureCount;
  });
  const measuresLearned = piece.totalMeasures - tierMeasures.untouched;
  const sectionsLearned = countLearnedSections(piece, practiceChunks);
  const totalPracticeSeconds = sumPracticeSeconds(piece);

  const totalProgressPct = practiceChunks.length
    ? Math.round(practiceChunks.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / practiceChunks.length)
    : 0;

  return (
    <div className="tab-pane">
      <div className="overview-top-row">
        <button className="primary-btn" onClick={onStartRevival}>
          <RefreshCw size={16} /> {revivalActive ? "Continue revival" : "Start revival"}
        </button>
        <button className="ghost-btn" onClick={onAddPiece}>
          <Plus size={14} /> Add new piece
        </button>
      </div>
      <ScheduleBanner piece={piece} chunkSet={chunkSet} timeline={timeline} currentDay={currentDay} onReschedule={onReschedule} />
      {revivalTriggers.triggered && (
        <div className="revival-banner">
          <div>
            <p className="revival-banner-title">This piece might be due for a revival</p>
            <ul className="revival-banner-reasons">
              {revivalTriggers.reasons.map((r) => (
                <li key={r.key}>{r.label}</li>
              ))}
            </ul>
          </div>
          <button className="primary-btn" onClick={onStartRevival}>
            <RefreshCw size={15} /> Start revival
          </button>
        </div>
      )}
      <div className="hero-card">
        <div className="hero-doodle-band">
          <ManuscriptDoodle />
        </div>
        <div className="hero-content">
          <p className="eyebrow">{piece.workId && piece.workName ? piece.workName : "Now practicing"}</p>
          <h1>
            {piece.name}
            {piece.status && piece.status !== "active" && (
              <span className={`badge ${piece.status}`}>{PIECE_STATUS_LABEL[piece.status]}</span>
            )}
          </h1>
          {piece.composer && <p className="hero-composer">{piece.composer}</p>}
          <p className="hero-sub">
            {piece.totalMeasures} measures, {piece.sections.length} sections, {piece.daysToLearn}-day plan
            {piece.lastPlayedDate ? ` · last played ${piece.lastPlayedDate}` : ""}
          </p>
          <RecordingsList recordings={piece.recordings} />
          <DocumentsList documents={piece.documents} />
          {piece.workId && workParts && workParts.length > 0 && (
            <p className="hero-sub">
              {workParts.length} movement{workParts.length === 1 ? "" : "s"}, {workParts.length} plan{workParts.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>

      {piece.status && piece.status !== "active" && (
        <div className="panel status-note">
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-soft)" }}>
            {piece.status === "archived"
              ? "Archived — off your Master Agenda, and confidence will keep quietly fading the longer it goes untouched. Reactivate it any time from Settings."
              : "Paused — off your Master Agenda and won't flag chunks as behind schedule. Confidence still fades the same as an active piece. Resume it any time from Settings."}
          </p>
        </div>
      )}

      {piece.workId && workParts && workParts.length > 0 && (
        <PartSwitcher
          parts={workParts}
          activeId={piece.id}
          onSelectPart={onSelectPart}
          onAddPart={onAddPart}
        />
      )}

      <ManuscriptStrip chunks={practiceChunks} />

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-num mono">{measuresLearned}/{piece.totalMeasures}</span><span className="stat-lbl">Measures {revivalActive ? "revived" : "learned"}</span></div>
        <div className="stat-card"><span className="stat-num mono">{sectionsLearned}/{piece.sections.length}</span><span className="stat-lbl">Sections {revivalActive ? "revived" : "learned"}</span></div>
        <div className="stat-card"><span className="stat-num mono">{formatHoursMinutes(totalPracticeSeconds)}</span><span className="stat-lbl">Time practiced</span></div>
        <div className="stat-card"><span className="stat-num mono">{totalProgressPct}%</span><span className="stat-lbl">Total {revivalActive ? "revival progress" : "progress"}</span></div>
      </div>

      <div className="panel">
        <h3>Practice progress</h3>
        <div className="bal-row">
          {Object.keys(PROGRESS_TIER_META).map((tier) => (
            <div key={tier} className="bal-seg" style={{ flex: tierMeasures[tier] || 0.001, background: PROGRESS_TIER_META[tier].color }} />
          ))}
        </div>
        <div className="diff-summary">
          {Object.keys(PROGRESS_TIER_META).map((tier) => (
            <div key={tier} className="diff-summary-item">
              <i className="dot" style={{ background: PROGRESS_TIER_META[tier].color }} />
              {PROGRESS_TIER_META[tier].label}: <strong>{Math.round((tierMeasures[tier] / piece.totalMeasures) * 100)}%</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>The first week</h3>
        <div className="day-preview-list">
          {timeline.days.slice(0, 7).map((d) => {
            let desc = "Nothing scheduled";
            if (d.type === "consolidation") {
              desc = "Full run-through & consolidation";
            } else {
              const newMeasures = d.newChunkIds.reduce((s, id) => s + chunkById[id].measureCount, 0);
              const reviewMeasures = [...d.specialChunkIds, ...d.reviewChunkIds].reduce(
                (s, id) => s + chunkById[id].measureCount,
                0
              );
              const parts = [];
              if (newMeasures > 0) parts.push(revivalActive ? `Revive ${newMeasures} measures` : `Learn ${newMeasures} new measures`);
              if (reviewMeasures > 0) parts.push(revivalActive ? `reconsolidate ${reviewMeasures} measures` : `review ${reviewMeasures} measures`);
              if (parts.length) {
                desc = parts.join(", ");
                desc = desc[0].toUpperCase() + desc.slice(1);
              }
            }
            return (
              <button
                key={d.dayNumber}
                type="button"
                className="day-preview-row clickable"
                onClick={() => onSelectDay(d.dayNumber)}
              >
                <span className="day-num mono">Day {d.dayNumber}</span>
                <span className="day-desc">{desc}</span>
                <span className="day-min mono">{formatMinutes(d.minutes)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
