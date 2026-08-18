import { Sparkline } from "../Sparkline";
import { computePracticeHistory } from "../../lib/history";
import { formatRange, loggedSessions } from "../../lib/utils";
import { SESSION_OUTCOME_META, DIFFICULTY_META } from "../../lib/constants";
import { computeConfidence, computeConfidenceAsOf, getDefaultTargetBPM, sessionOutcome } from "../../lib/confidence";

export function ProgressTab({ piece, chunks, timeline, currentDay }) {
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
  // every logged session in the piece. Replaces the old free-standing
  // "how did it feel" self-report, folded into this same judgment — see
  // docs/Decisions.md#spaced-repetition--maintenance. sessionOutcome()
  // also covers sessions logged before that change. Excludes skipped
  // sessions entirely (Pass 29) — they weren't judged, so they shouldn't
  // sit in the denominator pulling every real percentage down.
  const allSessions = Object.values(piece.progress).flatMap((entry) => loggedSessions(entry.sessions));
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

  return (
    <div className="tab-pane">
      <div className="tab-header">
        <h1>Progress</h1>
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
          <p className="wizard-hint">Nothing logged yet — check items off in Today's Practice.</p>
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
          <p className="wizard-hint">Nothing logged yet — check items off in Today's Practice.</p>
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
