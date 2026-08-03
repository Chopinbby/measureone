import { useMemo, useEffect } from "react";
import { NumberInput } from "../NumberInput";
import { autoChunkSize, generateAllChunks } from "../../lib/chunking";
import {
  EFFORT_TO_MIN,
  LIBERAL_FACTOR,
  MIN_PRACTICE_DAYS_PER_WEEK,
  MAX_PRACTICE_DAYS_PER_WEEK,
  MAX_RECOMMENDED_MINUTES_PER_DAY,
} from "../../lib/constants";
import { todayISODate, addDaysISO, daysUntilInclusive, clamp } from "../../lib/utils";

const PRACTICE_DAYS_OPTIONS = Array.from(
  { length: MAX_PRACTICE_DAYS_PER_WEEK - MIN_PRACTICE_DAYS_PER_WEEK + 1 },
  (_, i) => MIN_PRACTICE_DAYS_PER_WEEK + i
);

export function ScheduleFields({ draft, set }) {
  const chunkSet = useMemo(
    () => generateAllChunks(draft),
    [
      draft.totalMeasures,
      draft.measureDifficulty,
      draft.chunkMode,
      draft.customChunkSize,
      draft.recurringMode,
      draft.recurringMeasures,
      draft.recurringPairs,
    ]
  );
  const totalMinutesNeeded = useMemo(
    () => (chunkSet.all.reduce((s, c) => s + c.effort, 0) * EFFORT_TO_MIN) / 0.65,
    [chunkSet]
  );

  const practiceDaysPerWeek = clamp(draft.practiceDaysPerWeek || MAX_PRACTICE_DAYS_PER_WEEK, MIN_PRACTICE_DAYS_PER_WEEK, MAX_PRACTICE_DAYS_PER_WEEK);

  useEffect(() => {
    if (draft.scheduleMode === "days") {
      const calendarDays = Math.max(1, daysUntilInclusive(draft.targetDate) || 1);
      const practiceDayCount = Math.max(1, Math.round((calendarDays * practiceDaysPerWeek) / 7));
      const consolidationDays = practiceDayCount >= 5 ? 1 : 0;
      const learningDays = Math.max(1, practiceDayCount - consolidationDays);
      const needed = Math.max(10, Math.ceil((totalMinutesNeeded * LIBERAL_FACTOR) / learningDays / 5) * 5);
      if (calendarDays !== draft.daysToLearn) set({ daysToLearn: calendarDays });
      if (needed !== draft.minutesPerDay) set({ minutesPerDay: needed });
    } else {
      const minutes = Math.max(5, draft.minutesPerDay || 30);
      const newBudget = (minutes * 0.65) / EFFORT_TO_MIN;
      let learningDaysNeeded = 1;
      let acc = 0;
      chunkSet.all.forEach((c) => {
        if (acc + c.effort > newBudget && acc > 0) {
          learningDaysNeeded++;
          acc = 0;
        }
        acc += c.effort;
      });
      const practiceDaysNeeded = Math.max(1, Math.ceil((learningDaysNeeded / 0.88) * LIBERAL_FACTOR));
      const calendarDaysNeeded = Math.max(1, Math.ceil((practiceDaysNeeded * 7) / practiceDaysPerWeek));
      if (calendarDaysNeeded !== draft.daysToLearn) set({ daysToLearn: calendarDaysNeeded });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.scheduleMode, draft.targetDate, draft.daysToLearn, draft.minutesPerDay, practiceDaysPerWeek, totalMinutesNeeded, chunkSet.all.length]);

  const overloaded = draft.scheduleMode === "days" && draft.minutesPerDay > MAX_RECOMMENDED_MINUTES_PER_DAY;
  const estFinishDate = addDaysISO(todayISODate(), Math.max(0, (draft.daysToLearn || 1) - 1));

  return (
    <>
      <div className="field">
        <span>Which is fixed?</span>
        <div className="segmented">
          <button className={draft.scheduleMode === "days" ? "active" : ""} onClick={() => set({ scheduleMode: "days" })}>
            Learn by fixed date
          </button>
          <button className={draft.scheduleMode === "minutes" ? "active" : ""} onClick={() => set({ scheduleMode: "minutes" })}>
            Minutes per day
          </button>
        </div>
      </div>

      {draft.scheduleMode === "days" ? (
        <>
          <label className="field">
            <span>Learn it by</span>
            <input
              type="date"
              min={todayISODate()}
              value={draft.targetDate || ""}
              onChange={(e) => set({ targetDate: e.target.value })}
            />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{draft.minutesPerDay}</strong> minutes/day needed at this pace
          </p>
          {overloaded && (
            <p className="wizard-hint" style={{ color: "var(--brick)" }}>
              You'll need to spend at least 2 hours per day on this piece at your current pace. Set
              the date farther out or practice more days per week to lighten your daily practice
              load.
            </p>
          )}
        </>
      ) : (
        <>
          <label className="field">
            <span>Minutes available per day</span>
            <NumberInput value={draft.minutesPerDay} min={5} max={600} onCommit={(n) => set({ minutesPerDay: n })} />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{draft.daysToLearn}</strong> days needed at this pace —
            around <strong className="mono">{new Date(`${estFinishDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong>
          </p>
        </>
      )}

      <div className="field" style={{ marginTop: 8 }}>
        <span>How many days per week do you want to practice?</span>
        <div className="segmented" style={{ alignSelf: "flex-start" }}>
          {PRACTICE_DAYS_OPTIONS.map((n) => (
            <button
              key={n}
              className={practiceDaysPerWeek === n ? "active" : ""}
              onClick={() => set({ practiceDaysPerWeek: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="wizard-hint" style={{ marginTop: 8 }}>
          We recommend practicing at least 3 days a week to make consistent progress. Fewer
          practice days per week will build rest days into your plan's timeline.
        </p>
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <span>Chunk size</span>
        <div className="segmented">
          <button className={draft.chunkMode === "custom" ? "active" : ""} onClick={() => set({ chunkMode: "custom" })}>
            Custom
          </button>
          <button className={draft.chunkMode === "auto" ? "active" : ""} onClick={() => set({ chunkMode: "auto" })}>
            Determine automatically
          </button>
        </div>
        <p className="wizard-hint" style={{ marginTop: 8 }}>
          This determines how many measures will be assigned per practice task.
        </p>
        {draft.chunkMode === "auto" ? (
          <p className="wizard-hint">
            {draft.totalMeasures} measures → chunks of {autoChunkSize(draft.totalMeasures)} measures
          </p>
        ) : (
          <div style={{ maxWidth: 140 }}>
            <NumberInput value={draft.customChunkSize} min={1} max={draft.totalMeasures} onCommit={(n) => set({ customChunkSize: n })} />
          </div>
        )}
      </div>

      <label className="field" style={{ marginTop: 8 }}>
        <span>Target tempo (BPM) — optional</span>
        <NumberInput value={draft.targetBPM || ""} min={20} max={400} onCommit={(n) => set({ targetBPM: n })} />
      </label>
    </>
  );
}
