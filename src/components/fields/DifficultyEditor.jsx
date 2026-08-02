import { NumberInput } from "../NumberInput";
import { clamp } from "../../lib/utils";
import { DIFFICULTY_META, LEVEL_LABEL } from "../../lib/constants";

export function DifficultyEditor({ draft, set }) {
  const total = draft.totalMeasures;
  const arr = draft.measureDifficulty;
  const mode = draft.diffMode;

  const cycle = (idx) => {
    const next = arr.map((v, i) => (i === idx ? (v % 3) + 1 : v));
    set({ measureDifficulty: next });
  };

  const easyCount = arr.filter((v) => v === 1).length;
  const mediumCount = arr.filter((v) => v === 2).length;
  const hardCount = total - easyCount - mediumCount;

  const applySimple = (newEasy, newMedium) => {
    newEasy = clamp(newEasy, 0, total);
    newMedium = clamp(newMedium, 0, total - newEasy);
    const hardN = total - newEasy - newMedium;
    const next = [...Array(newEasy).fill(1), ...Array(newMedium).fill(2), ...Array(hardN).fill(3)];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    set({ measureDifficulty: next });
  };

  return (
    <div>
      <div className="segmented" style={{ marginBottom: 14 }}>
        <button className={mode === "grid" ? "active" : ""} onClick={() => set({ diffMode: "grid" })}>
          Precise grid
        </button>
        <button className={mode === "simple" ? "active" : ""} onClick={() => set({ diffMode: "simple" })}>
          Quick counts
        </button>
      </div>

      {mode === "grid" ? (
        <>
          <p className="wizard-hint">
            Click a measure to cycle Easy → Medium → Hard. Mark the trouble spots wherever they
            actually fall — the ending, the middle, wherever.
          </p>
          <div className="diff-grid-wrap">
            <div className="diff-grid">
              {arr.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  className={`diff-cell diff-${v}`}
                  onClick={() => cycle(i)}
                  title={`Measure ${i + 1}: ${DIFFICULTY_META[LEVEL_LABEL[v]].label}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="wizard-hint">
            We'll spread these counts across the piece rather than assuming a strict order —
            pieces are rarely easy-to-hard in a straight line. Use the precise grid if you want to
            place difficulty exactly.
          </p>
          <div className="field-row">
            <label className="field">
              <span>Easy measures</span>
              <NumberInput value={easyCount} min={0} max={total} onCommit={(n) => applySimple(n, mediumCount)} />
            </label>
            <label className="field">
              <span>Medium measures</span>
              <NumberInput value={mediumCount} min={0} max={total} onCommit={(n) => applySimple(easyCount, n)} />
            </label>
            <label className="field">
              <span>Hard measures</span>
              <input type="number" value={hardCount} readOnly disabled />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
