import { Sparkline } from "../Sparkline";
import { NumberInput } from "../NumberInput";
import { computePracticeHistory } from "../../lib/history";
import { formatRange, loggedSessions } from "../../lib/utils";
import { SESSION_OUTCOME_META, DIFFICULTY_META, EFFORT_TO_MIN } from "../../lib/constants";
import {
  computeConfidence,
  computeConfidenceAsOf,
  getDefaultTargetBPM,
  sessionOutcome,
  allJudgedSessions,
  computeOverallConfidence,
  isManualOverallConfidence,
} from "../../lib/confidence";
import { sectionLabel, weightedDifficultyFromArray } from "../../lib/chunking";

export function ProgressTab({ piece, chunks, timeline, currentDay, onViewAllPieces, onSetOverallConfidence }) {
  const practiceChunks = chunks.filter((c) => c.kind === "section");

  // #1 Rolling-window consistency — not a streak: a plain fraction of the
  // last N days with any logged activity, no "best ever" shown alongside it.
  const practicedDays = new Set();
  Object.entries(piece.progress).forEach(([id, entry]) => {
    // Pass 29 — a skipped session (Interleaved mode) isn't counted as a
    // day "practiced" here, same as everywhere else on this tab: it saved
    // time but wasn't a judged attempt. See lib/utils.js's loggedSessions.
    loggedSessions(entry.sessions).forEach((s) => practicedDays.add(s.day));
    if (id === "__consolidation__") (entry.doneDays || []).forEach((d) => practicedDays.add(d));
  });
  const consistencyWindow = Math.min(14, currentDay);
  const consistencyStart = Math.max(1, currentDay - consistencyWindow + 1);
  let consistencyCount = 0;
  for (let d = consistencyStart; d <= currentDay; d++) {
    if (practicedDays.has(d)) consistencyCount++;
  }

  // #6 Most improved this week — biggest positive confidence delta over the
  // trailing 7 days. Absence of a positive delta is shown neutrally.
  const asOfDay = Math.max(1, currentDay - 7);
  const mostImproved = chunks
    .map((c) => ({ chunk: c, delta: computeConfidence(c, piece, currentDay) - computeConfidenceAsOf(c, piece, asOfDay) }))
    .filter((x) => x.delta > 0)
    .sort((a, b) => b.delta - a.delta)[0];

  // #3 Tempo trend — sparkline of logged BPM per chunk with 2+ sessions and
  // a resolvable target, across practice chunks, transitions, and combos.
  const tempoTrends = chunks
    .map((c) => {
      const entry = piece.progress[c.id] || {};
      // A skipped session has no bpm to plot — excluded so it can't show up
      // as a bogus point on the tempo sparkline. See lib/utils.js.
      const sessions = loggedSessions(entry.sessions).sort((a, b) => a.day - b.day);
      const targetBPM = entry.targetBPM || getDefaultTargetBPM(piece, c);
      return { chunk: c, sessions, targetBPM };
    })
    .filter((t) => t.sessions.length >= 2 && t.targetBPM);

  // #4 Outcome breakdown — % distribution of pass/soft-miss/fail across
  // every logged, JUDGED session in the piece (allJudgedSessions,
  // lib/confidence.js — see there for why loggedSessions() alone isn't
  // enough). Replaces the old free-standing "how did it feel" self-report,
  // folded into this same judgment — see
  // docs/Decisions.md#spaced-repetition--maintenance. sessionOutcome()
  // also covers sessions logged before that change.
  const allSessions = allJudgedSessions(piece);
  const outcomeBreakdown = Object.entries(SESSION_OUTCOME_META).map(([value, meta]) => {
    const count = allSessions.filter((s) => sessionOutcome(s) === value).length;
    return { value, ...meta, count, pct: allSessions.length ? Math.round((count / allSessions.length) * 100) : 0 };
  });

  // Actual vs. planned progress — how many practice chunks were planned to
  // be introduced by each day vs. how many actually were.
  const firstDoneDay = {};
  practiceChunks.forEach((c) => {
    const dd = (piece.progress[c.id] || {}).doneDays || [];
    if (dd.length) firstDoneDay[c.id] = Math.min(...dd);
  });
  const plannedByDay = {};
  let cumPlanned = 0;
  timeline.days.forEach((d) => {
    cumPlanned += d.newChunkIds.length;
    plannedByDay[d.dayNumber] = cumPlanned;
  });
  const actualByDay = {};
  let cumActual = 0;
  for (let d = 1; d <= timeline.days.length; d++) {
    cumActual += Object.values(firstDoneDay).filter((fd) => fd === d).length;
    actualByDay[d] = cumActual;
  }
  const maxCum = Math.max(plannedByDay[timeline.days.length] || 1, 1);
  const chartDays = timeline.days.slice(0, Math.min(timeline.days.length, Math.max(currentDay + 3, 14)));

  // Estimated vs. actual practice time — "recently practiced" reuses the
  // Consistency panel's own trailing window (consistencyWindow/Start,
  // computed above) rather than a second, independently-chosen number, per
  // the pass's own instruction to match an existing recency window if one
  // exists on this tab.
  //
  // Covers practice chunks, transitions, and combos (all three already
  // carry a precomputed `effort`) plus single-section run-throughs. It does
  // NOT cover the whole-piece "__consolidation__" run-through: that entry's
  // sessions carry a stopCount, not cleanReps/bpm, and — more fundamentally
  // — it isn't a real chunk object at all, so there's no `effort` (or
  // measureCount/avgDifficulty to derive one from) to estimate against in
  // the first place. It also does NOT cover combined section-pair
  // run-throughs (kind: "section-transition", "Sections combined" in the
  // UI) — the pass's own enumerated list of covered kinds names single
  // "section run-throughs" specifically, and this app's docs already treat
  // single-section and section-pair run-throughs as two distinct,
  // separately-named mechanisms (see docs/Algorithms.md#section-run-throughs).
  const timeSessions = (sessions) => (sessions || []).filter((s) => s.day >= consistencyStart && s.day <= currentDay);
  const actualMinutesFor = (sessions) => timeSessions(sessions).reduce((sum, s) => sum + (s.durationSeconds || 0), 0) / 60;

  const regularTimeItems = chunks
    .map((c) => {
      const entry = piece.progress[c.id] || {};
      if (!timeSessions(entry.sessions).length) return null;
      return {
        id: c.id,
        label: formatRange(c.start, c.end),
        start: c.start,
        estimatedMinutes: c.effort * EFFORT_TO_MIN,
        actualMinutes: actualMinutesFor(entry.sessions),
      };
    })
    .filter(Boolean);

  // Section run-throughs (lib/chunking.js's computeSectionRunThroughs)
  // don't carry a stored `effort` field the way the other three kinds do —
  // built directly here instead, from piece.sections + the same
  // measureCount * avgDifficulty math transitions/combos already use for
  // theirs (neither of those has a recurring-material discount to apply
  // either, so no effortMultiplier term is missing here). See this
  // session's summary for why this isn't computeSectionRunThroughs' own
  // gated output: that function only returns a section currently due or
  // about to be — a section practiced inside this window but not due
  // again right now would otherwise silently vanish from this panel.
  const runThroughTimeItems = (piece.sections || [])
    .map((section, i) => {
      const entry = piece.progress[`sr_${section.id}`] || {};
      if (!timeSessions(entry.sessions).length) return null;
      const measureCount = section.end - section.start + 1;
      // A section saved with end < start (SectionsEditor now normalizes
      // this on every edit, but an already-malformed one can still reach
      // here — an old save, or a hand-edited/imported backup) has no valid
      // range to average a difficulty over: weightedDifficultyFromArray
      // would divide by a zero or negative count and hand back NaN/-0.
      // Same reasoning as excluding the whole-piece run-through above —
      // no real estimate to compare against, so this item is left out
      // entirely rather than shown with a nonsense number.
      if (measureCount < 1) return null;
      const { avg } = weightedDifficultyFromArray(piece.measureDifficulty, section.start, section.end);
      return {
        id: `sr_${section.id}`,
        label: `Play through: ${sectionLabel(section, i)}`,
        start: section.start,
        estimatedMinutes: measureCount * avg * EFFORT_TO_MIN,
        actualMinutes: actualMinutesFor(entry.sessions),
      };
    })
    .filter(Boolean);

  const timeComparisonItems = [...regularTimeItems, ...runThroughTimeItems].sort((a, b) => a.start - b.start);

  // #5 Projected finish at current pace — a forward-looking companion to
  // the chart above, based on recent (not average) velocity.
  const velocityWindow = Math.min(7, currentDay);
  const velocityStart = Math.max(1, currentDay - velocityWindow + 1);
  const recentlyIntroducedCount = Object.values(firstDoneDay).filter((d) => d >= velocityStart && d <= currentDay).length;
  const recentVelocity = recentlyIntroducedCount / velocityWindow;
  const remainingChunks = practiceChunks.length - Object.keys(firstDoneDay).length;
  let projectionText;
  if (remainingChunks <= 0) {
    projectionText = "Every chunk has been introduced at least once.";
  } else if (recentVelocity <= 0) {
    projectionText = "No recent pace to project from yet — log a few sessions to see a projection.";
  } else {
    const projectedDay = currentDay + Math.ceil(remainingChunks / recentVelocity);
    projectionText = `At your recent pace, full coverage projects to around day ${projectedDay}.`;
  }

  // Folded in from the former Analytics tab (Pass 20). Pure relocation —
  // the metrics themselves are unchanged, only where they live. Note both
  // read across *all* chunks / all practice chunks rather than a trailing
  // window, so they're standing facts about the plan rather than trends;
  // that's why they sit below the time-based charts. See
  // docs/Decisions.md#ux.
  const byDifficulty = ["easy", "medium", "hard"].map((level) => {
    const list = chunks.filter((c) => c.difficultyLabel === level);
    const avg = list.length
      ? Math.round(list.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / list.length)
      : 0;
    return { level, count: list.length, avg };
  });

  // Recent practice history. The work of matching persisted progress keys
  // back to the freshly-derived chunk set lives in lib/history.js — see the
  // block comment there for why an id can fail to resolve and what each
  // case means.
  const history = computePracticeHistory(piece, chunks);

  // Overall piece confidence (Pass 58) — see lib/confidence.js for the
  // effort-weighted rollup and the manual-override precedence.
  const overallConfidence = computeOverallConfidence(piece, practiceChunks, currentDay);
  const isOverallManual = isManualOverallConfidence(piece);

  return (
    <div className="tab-pane">
      <div className="tab-header day-nav">
        <h1>Progress</h1>
        <button className="ghost-btn" onClick={onViewAllPieces}>View all pieces</button>
      </div>

      <div className="panel">
        <h3>Overall confidence</h3>
        <div className="field">
          <span>Confidence override</span>
          {isOverallManual ? (
            <div className="manual-conf-row">
              <NumberInput
                value={piece.manualOverallConfidence}
                min={0}
                max={100}
                onCommit={(n) => onSetOverallConfidence(n)}
              />
              <button className="ghost-btn" onClick={() => onSetOverallConfidence(null)}>
                Reset to automatic
              </button>
            </div>
          ) : (
            <div className="manual-conf-row">
              <p className="wizard-hint" style={{ margin: 0, flex: 1 }}>
                Effort-weighted average across every practice chunk — auto-calculated at {overallConfidence}% right
                now.
              </p>
              <button className="ghost-btn" onClick={() => onSetOverallConfidence(overallConfidence)}>
                Set manually
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="stat-grid-2">
        <div className="stat-card">
          <span className="stat-num mono">{consistencyCount}</span>
          <span className="stat-lbl">of last {consistencyWindow} day{consistencyWindow === 1 ? "" : "s"} practiced</span>
        </div>
        <div className="stat-card">
          <span className="stat-num mono">{mostImproved ? `+${mostImproved.delta}%` : "—"}</span>
          <span className="stat-lbl">
            {mostImproved ? `Most improved: ${formatRange(mostImproved.chunk.start, mostImproved.chunk.end)}` : "No standout improvement this week"}
          </span>
        </div>
      </div>

      <div className="panel">
        <h3>Consistency</h3>
        <div className="heatmap-row">
          {timeline.days.map((d) => (
            <div
              key={d.dayNumber}
              className="heatmap-cell"
              title={`Day ${d.dayNumber}${practicedDays.has(d.dayNumber) ? " — practiced" : ""}`}
              style={{ background: practicedDays.has(d.dayNumber) ? "var(--teal)" : "var(--paper)" }}
            />
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Actual vs. planned progress</h3>
        <div className="progress-chart">
          {chartDays.map((d) => {
            const p = plannedByDay[d.dayNumber];
            const a = actualByDay[d.dayNumber];
            return (
              <div key={d.dayNumber} className="progress-chart-col" title={`Day ${d.dayNumber}: ${a} actual / ${p} planned`}>
                <div className="progress-chart-bars">
                  <div className="progress-chart-bar planned" style={{ height: `${(p / maxCum) * 100}%` }} />
                  <div className="progress-chart-bar actual" style={{ height: `${(a / maxCum) * 100}%` }} />
                </div>
                {d.dayNumber % 5 === 0 && <span className="progress-chart-label mono">{d.dayNumber}</span>}
              </div>
            );
          })}
        </div>
        <div className="chart-legend">
          <span><i className="dot" style={{ background: "var(--ink-faint)" }} />Planned</span>
          <span><i className="dot" style={{ background: "var(--brass)" }} />Actual</span>
        </div>
      </div>

      <div className="panel">
        <h3>Estimated vs. actual practice time</h3>
        {timeComparisonItems.length === 0 ? (
          <p className="wizard-hint" style={{ margin: 0 }}>
            Nothing logged in the last {consistencyWindow} day{consistencyWindow === 1 ? "" : "s"} yet.
          </p>
        ) : (
          <>
            <p className="wizard-hint" style={{ marginTop: 0 }}>
              Items with a logged session in the last {consistencyWindow} day{consistencyWindow === 1 ? "" : "s"}.
              Each pair is scaled to its own taller bar, not a shared scale, so a quick chunk and a long
              run-through are equally readable side by side.
            </p>
            <div className="progress-chart">
              {timeComparisonItems.map((item) => {
                const maxOfPair = Math.max(item.estimatedMinutes, item.actualMinutes, 0.01);
                return (
                  <div
                    key={item.id}
                    className="progress-chart-col"
                    title={`${item.label}: ${Math.round(item.actualMinutes)}m actual / ${Math.round(item.estimatedMinutes)}m estimated`}
                  >
                    <div className="progress-chart-bars">
                      <div className="progress-chart-bar planned" style={{ height: `${(item.estimatedMinutes / maxOfPair) * 100}%` }} />
                      <div className="progress-chart-bar actual" style={{ height: `${(item.actualMinutes / maxOfPair) * 100}%` }} />
                    </div>
                    <span className="progress-chart-label mono">{item.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="chart-legend">
              <span><i className="dot" style={{ background: "var(--ink-faint)" }} />Estimated</span>
              <span><i className="dot" style={{ background: "var(--brass)" }} />Actual</span>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h3>Projected finish</h3>
        <p className="wizard-hint" style={{ margin: 0 }}>{projectionText}</p>
      </div>

      <div className="panel">
        <h3>Tempo trend</h3>
        {tempoTrends.length === 0 ? (
          <p className="wizard-hint">Log a second session on any chunk with a target BPM to see a tempo trend here.</p>
        ) : (
          <div className="tempo-trend-list">
            {tempoTrends.map(({ chunk, sessions, targetBPM }) => (
              <div key={chunk.id} className="tempo-trend-row">
                <span className="mono">{formatRange(chunk.start, chunk.end)}</span>
                <Sparkline values={sessions.map((s) => s.bpm)} />
                <span className="mono tempo-trend-nums">{sessions[sessions.length - 1].bpm} / {targetBPM}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Outcome breakdown</h3>
        {allSessions.length === 0 ? (
          <p className="wizard-hint">Nothing logged yet — check items off in Daily Practice.</p>
        ) : (
          <div className="analytics-bars">
            {outcomeBreakdown.map((o) => (
              <div key={o.value} className="analytics-bar-row">
                <span className="analytics-bar-label">{o.label} ({o.count})</span>
                <div className="analytics-bar-track"><div className="analytics-bar-fill" style={{ width: `${o.pct}%`, background: o.color }} /></div>
                <span className="mono">{o.pct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Folded in from the former Analytics tab (Pass 20), placed directly
          after Outcome breakdown: "Confidence by difficulty" is the same
          horizontal-distribution chart shape, so the two read as one group,
          and both folded-in panels stay above "Recent practice history" —
          the raw log belongs at the bottom of the page. See
          docs/Decisions.md#ux for the full placement rationale. */}
      <div className="panel">
        <h3>Confidence by difficulty</h3>
        <div className="analytics-bars">
          {byDifficulty.map((d) => (
            <div key={d.level} className="analytics-bar-row">
              <span className="analytics-bar-label">{DIFFICULTY_META[d.level].label} ({d.count})</span>
              <div className="analytics-bar-track"><div className="analytics-bar-fill" style={{ width: `${d.avg}%`, background: DIFFICULTY_META[d.level].color }} /></div>
              <span className="mono">{d.avg}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Recent practice history</h3>
        {history.length === 0 ? (
          <p className="wizard-hint">Nothing logged yet — check items off in Daily Practice.</p>
        ) : (
          <div className="history-list">
            {history.map(({ day, label }) => (
              <div key={day} className="history-row">
                <span className="mono history-day">Day {day}</span>
                <span className="history-items">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
