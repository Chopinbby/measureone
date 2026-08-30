import { DIFFICULTY_META, LEVEL_LABEL } from "../../lib/constants";

export function DifficultyEditor({ draft, set }) {
  const arr = draft.measureDifficulty;

  const cycle = (idx) => {
    const next = arr.map((v, i) => (i === idx ? (v % 3) + 1 : v));
    set({ measureDifficulty: next });
  };

  return (
    <div>
      <p className="wizard-hint">
        Below is a grid of all the measures in your piece. Click a measure to cycle Workable →
        Challenging → Difficult, so the plan knows where to schedule extra practice.
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
    </div>
  );
}
