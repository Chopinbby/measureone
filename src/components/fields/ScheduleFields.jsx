import { useMemo, useEffect } from "react";
import { NumberInput } from "../NumberInput";
import { autoChunkSize, generateAllChunks } from "../../lib/chunking";
import { EFFORT_TO_MIN, LIBERAL_FACTOR } from "../../lib/constants";

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

  useEffect(() => {
    if (draft.scheduleMode === "days") {
      const days = Math.max(1, draft.daysToLearn || 1);
      const consolidationDays = days >= 5 ? 1 : 0;
      const learningDays = Math.max(1, days - consolidationDays);
      const needed = Math.max(10, Math.ceil((totalMinutesNeeded * LIBERAL_FACTOR) / learningDays / 5) * 5);
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
      const estTotal = Math.max(1, Math.ceil((learningDaysNeeded / 0.88) * LIBERAL_FACTOR));
      if (estTotal !== draft.daysToLearn) set({ daysToLearn: estTotal });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.scheduleMode, draft.daysToLearn, draft.minutesPerDay, totalMinutesNeeded, chunkSet.all.length]);

  return (
    <>
      <div className="field">
        <span>Which is fixed?</span>
        <div className="segmented">
          <button className={draft.scheduleMode === "days" ? "active" : ""} onClick={() => set({ scheduleMode: "days" })}>
            Days I have
          </button>
          <button className={draft.scheduleMode === "minutes" ? "active" : ""} onClick={() => set({ scheduleMode: "minutes" })}>
            Minutes per day
          </button>
        </div>
      </div>

      {draft.scheduleMode === "days" ? (
        <>
          <label className="field">
            <span>Days to learn it</span>
            <NumberInput value={draft.daysToLearn} min={1} max={3650} onCommit={(n) => set({ daysToLearn: n })} />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{draft.minutesPerDay}</strong> minutes/day needed at this pace
          </p>
        </>
      ) : (
        <>
          <label className="field">
            <span>Minutes available per day</span>
            <NumberInput value={draft.minutesPerDay} min={5} max={600} onCommit={(n) => set({ minutesPerDay: n })} />
          </label>
          <p className="derived-stat">
            At least <strong className="mono">{draft.daysToLearn}</strong> days needed at this pace
          </p>
        </>
      )}

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
        {draft.chunkMode === "auto" ? (
          <p className="wizard-hint" style={{ marginTop: 8 }}>
            {draft.totalMeasures} measures → chunks of {autoChunkSize(draft.totalMeasures)} measures
          </p>
        ) : (
          <div style={{ marginTop: 8, maxWidth: 140 }}>
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
