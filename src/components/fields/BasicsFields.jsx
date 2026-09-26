import { useState } from "react";
import { NumberInput } from "../NumberInput";
import { resizeDifficulty, resizeSections } from "../../lib/utils";
import { sameSpelledKey, normalizeOtherKeys } from "../../lib/technique";
import { KEY_OPTIONS, keyOptionFor } from "../tabs/technique/format";
import { KeyText } from "../tabs/technique/KeyText";

// Index into KEY_OPTIONS (24 keys, enharmonic pairs as one entry, in
// circle-of-fifths walk order) of a stored { tonic, quality } key; "" if none.
function keyOptionIndex(key) {
  return keyOptionFor(key)?.value ?? "";
}
const keyFromOption = (value) => {
  const o = KEY_OPTIONS[Number(value)];
  return o ? { tonic: o.tonic, quality: o.quality } : null;
};

// Shared by the Wizard and SettingsTab, so a piece can be declared part of a
// multi-movement work either at setup or later on.
//
// A part is an ordinary piece — `name` always means "what this plan is for",
// which for a part is the movement. `workName` is the only extra input; the
// grouping id is derived from it in lib/works.js. `lockWork` is used when
// adding a part to a work that already exists, so the title can't drift
// between siblings and the piece can't be pulled back out by accident.
export function BasicsFields({ draft, set, lockWork = false, afterWorkMode = null, onMultiPartChange }) {
  const [multiPart, setMultiPart] = useState(lockWork || !!(draft.workId || draft.workName));

  const chooseMultiPart = (on) => {
    setMultiPart(on);
    onMultiPartChange?.(on);
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
        <span>Target tempo (BPM, optional)</span>
        <NumberInput value={draft.targetBPM || ""} min={20} max={400} onCommit={(n) => set({ targetBPM: n })} />
      </label>
      {/* Pass 103 — the piece's keys. Links the piece to Technique practice
          by KEY, never by specific scale (docs/Technique-Practice.md,
          Decided 1), and by the key as written: a G♭ major piece tags G♭
          major scales, not F♯ major. Every scale or arpeggio in these keys
          gets the "Repertoire in this key" tag and comes up more often while
          this piece is active. No group heading (removed on direct request);
          shared by the Wizard and Settings, like the rest of this component. */}
      <div className="field key-fields">
        <label className="field">
          <span>Key of the piece (optional)</span>
          <select
            className="tq-select"
            value={keyOptionIndex(draft.homeKey)}
            onChange={(e) => {
              const homeKey = e.target.value === "" ? null : keyFromOption(e.target.value);
              set({ homeKey, otherKeys: normalizeOtherKeys(draft.otherKeys, homeKey) });
            }}
          >
            <option value="">Not set</option>
            {KEY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="field-hint">
            Scales in this key are tagged "Repertoire in this key" on your Technique cards. These scales
            will show up more often in your practice routine.
          </span>
        </label>
        <div className="field">
          <span>Other keys in this piece (optional)</span>
          <div className="key-chips">
            {(draft.otherKeys || []).map((k) => {
              const label = keyOptionFor(k)?.label || `${k.tonic} ${k.quality}`;
              return (
                <span key={label} className="key-chip">
                  <KeyText text={label} />
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => set({ otherKeys: normalizeOtherKeys((draft.otherKeys || []).filter((o) => !sameSpelledKey(o, k)), draft.homeKey) })}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <select
              className="tq-select"
              value=""
              aria-label="Add a key"
              onChange={(e) => {
                if (e.target.value === "") return;
                set({ otherKeys: normalizeOtherKeys([...(draft.otherKeys || []), keyFromOption(e.target.value)], draft.homeKey) });
              }}
            >
              <option value="">Add a key…</option>
              {KEY_OPTIONS.filter((o) => keyOptionIndex(draft.homeKey) !== o.value && !(draft.otherKeys || []).some((k) => keyOptionIndex(k) === o.value)).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <span className="field-hint">For keys the piece passes through, like a second theme.</span>
        </div>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea
          placeholder="Context, history, teacher notes: anything worth remembering about this piece…"
          value={draft.notes || ""}
          onChange={(e) => set({ notes: e.target.value })}
          rows={4}
        />
      </label>
    </>
  );
}
