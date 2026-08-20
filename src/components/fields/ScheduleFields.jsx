import { useMemo, useEffect } from "react";
import { NumberInput } from "../NumberInput";
import { autoChunkSize, generateAllChunks } from "../../lib/chunking";
import { computeDaysNeededForMinutesPerDay } from "../../lib/scheduling";
import {
  EFFORT_TO_MIN,
  LIBERAL_FACTOR,
  MIN_PRACTICE_DAYS_PER_WEEK,
  MAX_PRACTICE_DAYS_PER_WEEK,
  MAX_RECOMMENDED_MINUTES_PER_DAY,
  LONG_PLAN_DAYS_MINUTES_MODE,
} from "../../lib/constants";
import { todayISODate, addDaysISO, daysBetweenInclusive, clamp, formatMinutes } from "../../lib/utils";

const PRACTICE_DAYS_OPTIONS = Array.from(
  { length: MAX_PRACTICE_DAYS_PER_WEEK - MIN_PRACTICE_DAYS_PER_WEEK + 1 },
  (_, i) => MIN_PRACTICE_DAYS_PER_WEEK + i
);

export function ScheduleFields({ draft, set, isRevival = false }) {
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

  const startDate = draft.startDate || todayISODate();

  useEffect(() => {
    if (draft.scheduleMode === "days") {
      const calendarDays = Math.max(1, daysBetweenInclusive(startDate, draft.targetDate) || 1);
      const practiceDayCount = Math.max(1, Math.round((calendarDays * practiceDaysPerWeek) / 7));
      const consolidationDays = practiceDayCount >= 5 ? 1 : 0;
      const learningDays = Math.max(1, practiceDayCount - consolidationDays);
      const needed = Math.max(10, Math.ceil((totalMinutesNeeded * LIBERAL_FACTOR) / learningDays / 5) * 5);
      if (calendarDays !== draft.daysToLearn) set({ daysToLearn: calendarDays });
      if (needed !== draft.minutesPerDay) set({ minutesPerDay: needed });
    } else {
      const calendarDaysNeeded = computeDaysNeededForMinutesPerDay(chunkSet, draft.minutesPerDay, practiceDaysPerWeek);
      if (calendarDaysNeeded !== draft.daysToLearn) set({ daysToLearn: calendarDaysNeeded });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.scheduleMode, startDate, draft.targetDate, draft.daysToLearn, draft.minutesPerDay, practiceDaysPerWeek, totalMinutesNeeded, chunkSet.all.length]);

  // Same underlying condition in both modes — this piece has more material
  // than fits comfortably — surfaced differently per mode since "fits
  // comfortably" means something different depending on which quantity the
  // user actually fixed. "days" mode: minutesPerDay is derived to exactly
  // fit the fixed date, so overshooting a reasonable pace is the signal
  // (reuses the same threshold the inline pace warning below already
  // used — not a separate check). "minutes" mode: minutesPerDay is the
  // user's own fixed input, daysToLearn is what stretches to fit it, so
  // there's no pace to overshoot — an unusually long resulting plan is the
  // analogous signal instead.
  const overloaded = draft.scheduleMode === "days" && draft.minutesPerDay > MAX_RECOMMENDED_MINUTES_PER_DAY;
  const longPlan = draft.scheduleMode === "minutes" && (draft.daysToLearn || 0) > LONG_PLAN_DAYS_MINUTES_MODE;
  const estFinishDate = addDaysISO(startDate, Math.max(0, (draft.daysToLearn || 1) - 1));
  const estFinishLabel = new Date(`${estFinishDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const targetDateLabel = draft.targetDate
    ? new Date(`${draft.targetDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <>
      <label className="field">
        <span>Start date</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
      </label>
      <p className="wizard-hint">
        Day 1 of this plan. Defaults to today — set it earlier if you're already partway through,
        or later to start it in the future.
      </p>

      <div className="field">
        <span>Which is fixed?</span>
        <div className="segmented">
          <button className={draft.scheduleMode === "days" ? "active" : ""} onClick={() => set({ scheduleMode: "days" })}>
            {isRevival ? "Review by fixed date" : "Learn by fixed date"}
          </button>
          <button className={draft.scheduleMode === "minutes" ? "active" : ""} onClick={() => set({ scheduleMode: "minutes" })}>
            Minutes per day
          </button>
        </div>
      </div>

      {(overloaded || longPlan) && (
        <div className="plan-fit-banner">
          {draft.scheduleMode === "days" ? (
            <>
              <p className="plan-fit-banner-title">This plan will require spending over 2 hours/day on this piece</p>
              <p className="plan-fit-banner-sub">
                At this pace, you will need to practice this piece approximately{" "}
                <strong className="mono">{formatMinutes(draft.minutesPerDay)}</strong>/day to learn it by{" "}
                {targetDateLabel || "your target date"}. To lighten the daily load, set the date farther out
                {practiceDaysPerWeek < 7 ? " or practice more days per week" : ""}. Otherwise… get ready to lock
                in 🕶️
              </p>
            </>
          ) : (
            <>
              <p className="plan-fit-banner-title">This plan will take over 3 months to complete</p>
              <p className="plan-fit-banner-sub">
                At <strong className="mono">{formatMinutes(draft.minutesPerDay)}</strong>/day, this piece will
                take about <strong className="mono">{draft.daysToLearn}</strong> days to learn — projected to
                cover the whole piece around <strong className="mono">{estFinishLabel}</strong>. If you want to
                have it down sooner, increase your daily practice estimate.
              </p>
            </>
          )}
        </div>
      )}

      {draft.scheduleMode === "days" ? (
        <>
          <label className="field">
            <span>{isRevival ? "Review it by" : "Learn it by"}</span>
            <input
              type="date"
              min={startDate}
              value={draft.targetDate || ""}
              onChange={(e) => set({ targetDate: e.target.value })}
            />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{formatMinutes(draft.minutesPerDay)}</strong>/day needed at this pace
          </p>
        </>
      ) : (
        <>
          <label className="field">
            <span>Minutes available per day</span>
            <NumberInput value={draft.minutesPerDay} min={5} max={600} onCommit={(n) => set({ minutesPerDay: n })} />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{draft.daysToLearn}</strong> days needed at this pace —
            around <strong className="mono">{estFinishLabel}</strong>
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
    </>
  );
}
