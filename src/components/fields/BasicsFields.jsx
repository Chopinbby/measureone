import { useState } from "react";
import { NumberInput } from "../NumberInput";
import { resizeDifficulty, resizeSections } from "../../lib/utils";

// Shared by the Wizard and SettingsTab, so a piece can be declared part of a
// multi-movement work either at setup or later on.
//
// A part is an ordinary piece — `name` always means "what this plan is for",
// which for a part is the movement. `workName` is the only extra input; the
// grouping id is derived from it in lib/works.js. `lockWork` is used when
// adding a part to a work that already exists, so the title can't drift
// between siblings and the piece can't be pulled back out by accident.
export function BasicsFields({ draft, set, lockWork = false, afterWorkMode = null }) {
  const [multiPart, setMultiPart] = useState(lockWork || !!(draft.workId || draft.workName));

  const chooseMultiPart = (on) => {
    setMultiPart(on);
    if (!on) set({ workName: "" });
  };

  return (
    <>
      {!lockWork && (
        <div className="field">
          <span>Is this a single piece, or a work with several movements?</span>
          <div className="segmented">
            <button type="button" className={!multiPart ? "active" : ""} onClick={() => chooseMultiPart(false)}>
              A single piece
            </button>
            <button type="button" className={multiPart ? "active" : ""} onClick={() => chooseMultiPart(true)}>
              Multiple movements
            </button>
          </div>
          {multiPart && (
            <p className="wizard-hint" style={{ marginTop: 8 }}>
              Set up the first movement now, then add the rest from the Piece Overview tab
              whenever you're ready. Each movement will get its own practice plan, schedule, and
              progress to help you learn.
            </p>
          )}
        </div>
      )}

      {afterWorkMode}

      {multiPart && (
        <label className="field">
          <span>Work title</span>
          <input
            type="text"
            placeholder="e.g. Brahms – Sonata in F minor, Op. 120 No. 1"
            value={draft.workName || ""}
            disabled={lockWork}
            onChange={(e) => set({ workName: e.target.value })}
          />
        </label>
      )}
      <label className="field">
        <span>{multiPart ? "Movement or part name" : "Piece name"}</span>
        <input
          type="text"
          placeholder={multiPart ? "e.g. I. Allegro appassionato" : "e.g. Chopin – Nocturne in E♭ major, Op. 9 No. 2"}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Composer</span>
        <input
          type="text"
          placeholder="e.g. Frédéric Chopin"
          value={draft.composer || ""}
          onChange={(e) => set({ composer: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{multiPart ? "Measures in this movement" : "Total measures"}</span>
        <NumberInput
          value={draft.totalMeasures}
          min={1}
          max={5000}
          onCommit={(total) =>
            set({
              totalMeasures: total,
              measureDifficulty: resizeDifficulty(draft.measureDifficulty, total),
              sections: resizeSections(draft.sections, total),
            })
          }
        />
      </label>
      <label className="field">
        {/* Moved here from ScheduleFields (was step 4 in the Wizard) per
            user request: this is the one number most of the app's tempo
            math keys off (getDefaultTargetBPM/getSuggestedStartingBPM,
            confidence.js), so it belongs with the piece's basic identity,
            not buried in the scheduling step. Still fully optional — see
            the comment on getDefaultTargetBPM for what's lost without it:
            no suggested starting tempo, no "Target tempo" hint, and the
            Settling/Holding stage's tempo-floor safety check becomes a
            no-op (targetBPM * floorFraction reduces to 0, so the floor is
            trivially satisfied) rather than blocking premature graduation. */}
        <span>Target tempo (BPM) — optional</span>
        <NumberInput value={draft.targetBPM || ""} min={20} max={400} onCommit={(n) => set({ targetBPM: n })} />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          placeholder="Context, history, teacher notes — anything worth remembering about this piece…"
          value={draft.notes || ""}
          onChange={(e) => set({ notes: e.target.value })}
          rows={4}
        />
      </label>
    </>
  );
}
