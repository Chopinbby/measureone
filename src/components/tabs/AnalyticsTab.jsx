import { DIFFICULTY_META, EFFORT_TO_MIN } from "../../lib/constants";
import { computeConfidence } from "../../lib/confidence";

export function AnalyticsTab({ piece, chunks, currentDay }) {
  const byDifficulty = ["easy", "medium", "hard"].map((level) => {
    const list = chunks.filter((c) => c.difficultyLabel === level);
    const avg = list.length
      ? Math.round(list.reduce((s, c) => s + computeConfidence(c, piece, currentDay), 0) / list.length)
      : 0;
    return { level, count: list.length, avg };
  });

  const practiceChunks = chunks.filter((c) => c.kind === "section");
  const recurringChunks = practiceChunks.filter((c) => c.recurring);
  const fullEffort = practiceChunks.reduce((s, c) => s + c.measureCount * c.avgDifficulty, 0);
  const actualEffort = practiceChunks.reduce((s, c) => s + c.effort, 0);
  const minutesSaved = Math.round((fullEffort - actualEffort) * EFFORT_TO_MIN);

  return (
    <div className="tab-pane">
      <div className="tab-header"><h1>Analytics</h1></div>

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
        <h3>Recurring material payoff</h3>
        <p className="wizard-hint" style={{ marginBottom: 0 }}>
          {recurringChunks.length} chunk{recurringChunks.length === 1 ? "" : "s"} marked as recurring saved an
          estimated <strong>{minutesSaved}</strong> minutes of practice time in this plan.
        </p>
      </div>
    </div>
  );
}
