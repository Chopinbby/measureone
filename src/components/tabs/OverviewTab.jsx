import { Plus, RefreshCw, Play, Pause, RotateCcw } from "lucide-react";
import { ScheduleBanner } from "../ScheduleBanner";
import { ManuscriptDoodle, ManuscriptStrip } from "../Manuscript";
import { RecordingsList } from "../fields/RecordingsList";
import { DocumentsList } from "../fields/DocumentsList";
import { PartSwitcher } from "../PartSwitcher";
import { sumPracticeSeconds, formatHoursMinutes, formatMinutes } from "../../lib/utils";
import { countLearnedSections } from "../../lib/chunking";
import { computeConfidence, computeProgressTier, PROGRESS_TIER_META } from "../../lib/confidence";
import { computeRevivalTriggers, isInRevival } from "../../lib/revival";
import {
  isPlanActuallyComplete,
  computeScheduleStatus,
  classifyDayCompletion,
  countBehindDays,
  computeAbandonedPlanReminder,
} from "../../lib/scheduling";
import { PIECE_STATUS_LABEL } from "../../lib/constants";

// Same grayed-with-a-reason convention as SettingsTab.jsx's Archive button
// (Pass 43) — disabled, not hidden, so the reason is visible rather than
// the option just silently not being there.
const REVIVAL_LOCKED_TITLE =
  "Available once this piece's learning plan is actually finished. Revival is for a piece you've already learned.";

export function OverviewTab({
  piece,
  practiceChunks,
  chunks,
  chunkSet,
  timeline,
  currentDay,
  realCurrentDay,
  onReschedule,
  onAddPiece,
  onStartRevival,
  onPausePiece,
  workParts,
  onSelectPart,
  onAddPart,
  onSelectDay,
}) {
  const revivalActive = isInRevival(piece);
  // Past-plan (Pass 39's real "actually finished" check, not a raw calendar
  // comparison — CLAUDE.md) means there's nothing left to *learn*, so the
  // shortcut below relabels toward Master Agenda's existing "Maintenance"
  // vocabulary instead of implying new material is still being introduced.
  // Computed before revivalTriggers (not just below, where it was
  // originally introduced) so it can also gate computeRevivalTriggers'
  // own 60-day staleness reason — that reason is specifically about a
  // piece that's already been learned going quiet, not one still
  // mid-learning; a still-unfinished piece going quiet is
  // computeAbandonedPlanReminder's question instead (see the banner
  // below), not revival's.
  const planComplete = chunkSet && timeline ? isPlanActuallyComplete(piece, chunkSet, timeline) : false;
  const revivalTriggers = !revivalActive && chunkSet ? computeRevivalTriggers(piece, chunkSet, planComplete) : { triggered: false, reasons: [] };
  const abandonedPlanReminder =
    !revivalActive && chunkSet && timeline ? computeAbandonedPlanReminder(piece, chunkSet, timeline) : null;
  // Built here (not just below, where it was originally introduced) so it
  // can also feed countBehindDays' isDayFullySwept check just below —
  // lets a connector that rode along into a reschedule via a linked
  // practice chunk be recognized as moved, not just one directly listed
  // on the marker.
  const chunkById = Object.fromEntries(chunks.map((c) => [c.id, c]));
  // For "The first week"'s today-row note below — reused rather than a
  // separate count, per Pass 45's build note.
  const { missedCount } = computeScheduleStatus(piece, practiceChunks, timeline, currentDay);
  const behindDays = countBehindDays(piece, timeline, currentDay, chunkById);
  // Pass 64 — this panel used to always show days 1-7, forever, regardless
  // of how far into the plan the piece actually was. Now it follows
  // currentDay with the same week-grouping math TimelineTab already uses
  // for its own week-by-week grid (`for (let i = 0; i < timeline.days.length;
  // i += 7) weeks.push(timeline.days.slice(i, i + 7))`), just picking out
  // the one week containing currentDay instead of rendering every week.
  // currentDay is already the clamped value every other tab receives, so a
  // piece past its own plan (Pass 39) naturally keeps showing the plan's
  // final week rather than computing an out-of-bounds index, and a final
  // week shorter than 7 days is handled for free by slice() truncating at
  // the array's actual length — neither needs special-casing here.
  const weekIndex = Math.floor((currentDay - 1) / 7);
  const weekDays = timeline.days.slice(weekIndex * 7, weekIndex * 7 + 7);
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
        <button
          className="primary-btn"
          disabled={!revivalActive && !planComplete}
          title={!revivalActive && !planComplete ? REVIVAL_LOCKED_TITLE : undefined}
          onClick={onStartRevival}
        >
          <RefreshCw size={16} /> {revivalActive ? "Continue revival" : "Start revival"}
        </button>
        <button className="ghost-btn" onClick={onAddPiece}>
          <Plus size={14} /> Add new piece
        </button>
      </div>
      <ScheduleBanner piece={piece} chunkSet={chunkSet} timeline={timeline} realCurrentDay={realCurrentDay} onReschedule={onReschedule} />
      {abandonedPlanReminder && (
        <div className="schedule-banner">
          <div>
            <p className="schedule-banner-title">
              No practice logged for "{piece.name}" in {abandonedPlanReminder.milestoneDays} days
            </p>
            <p className="schedule-banner-sub">Would you like to reschedule remaining practice items, or pause this plan?</p>
          </div>
          <div className="schedule-banner-actions">
            <button className="primary-btn" onClick={onReschedule}>
              <RotateCcw size={15} /> Reschedule remaining days
            </button>
            <button className="ghost-btn" onClick={onPausePiece}>
              <Pause size={15} /> Pause this plan
            </button>
          </div>
        </div>
      )}
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
          {/* No !revivalActive check needed here (unlike the title-card
              button above) — revivalTriggers is computed as
              !revivalActive && computeRevivalTriggers(...), so this whole
              banner (and this button) can never render while a revival is
              already active in the first place. No disabled/title guard
              needed here either (unlike the title-card button, which can
              render for a piece with no triggers at all): every one of
              computeRevivalTriggers' three reasons now requires
              planComplete to fire — it returns { triggered: false,
              reasons: [] } outright when planComplete is false — so
              revivalTriggers.triggered being true already guarantees
              planComplete is true by the time this banner renders at all. */}
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
          {/* The "N movement(s), N plan(s)" summary line that used to sit
              here was removed once the actual chip list landed directly
              below it (Pass 71) — with the chips right there, showing
              real names and per-movement progress, the bare count read as
              the same fact stated twice. Same reasoning PartSwitcher.jsx's
              own comment already documents for dropping its redundant
              work-title heading once the eyebrow above already named the
              work. */}
          {piece.workId && workParts && workParts.length > 0 && (
            <PartSwitcher
              parts={workParts}
              activeId={piece.id}
              onSelectPart={onSelectPart}
              onAddPart={onAddPart}
              embedded
            />
          )}
        </div>
      </div>

      {/* Suppressed during revival — "Start/Continue revival" above is
          already the primary action for that state, and two competing
          primary buttons in the same area would be confusing (Pass 43). */}
      {!revivalActive && (
        <button
          className="primary-btn"
          style={{ alignSelf: "flex-start" }}
          onClick={() => onSelectDay(null)}
        >
          <Play size={16} /> {planComplete ? "Continue maintenance" : "Continue learning"}
        </button>
      )}

      {piece.status && piece.status !== "active" && (
        <div className="panel status-note">
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-soft)" }}>
            {piece.status === "archived"
              ? "Archived — off your Master Agenda, and confidence will keep quietly fading the longer it goes untouched. Reactivate it any time from Settings."
              : "Paused — off your Master Agenda and won't flag chunks as behind schedule. Confidence still fades the same as an active piece. Resume it any time from Settings."}
          </p>
        </div>
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
        {/* Week 1 keeps the friendlier onboarding wording; week 2+ reads
            as a plain "Week N", matching TimelineTab's own heading
            convention for every week after the first. */}
        <h3>{weekIndex === 0 ? "The first week" : `Week ${weekIndex + 1}`}</h3>
        <div className="day-preview-list">
          {weekDays.map((d) => {
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
            const completion = classifyDayCompletion(d, piece, currentDay);
            // Suppressed during an active revival, on direct request
            // (docs/Decisions.md#open-questions): missedCount/behindDays
            // are judged against the piece's *original*, pre-revival plan
            // — showing schedule pressure against a plan that's no longer
            // the one actually being followed. Revival has its own,
            // separate pacing; this note isn't about that.
            if (d.dayNumber === currentDay && missedCount > 0 && !revivalActive) {
              desc += ` (behind ${behindDays} day${behindDays === 1 ? "" : "s"})`;
            }
            return (
              <button
                key={d.dayNumber}
                type="button"
                className="day-preview-row clickable"
                style={completion === "future" ? undefined : { opacity: 0.55 }}
                onClick={() => onSelectDay(d.dayNumber)}
              >
                <span className="day-num mono">Day {d.dayNumber}</span>
                <span className="day-desc" style={completion === "done" ? { textDecoration: "line-through" } : undefined}>
                  {desc}
                </span>
                <span className="day-min mono">{formatMinutes(d.minutes)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
