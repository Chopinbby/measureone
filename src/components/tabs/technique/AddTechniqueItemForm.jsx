import { useState } from "react";
import { NumberInput } from "../../NumberInput";
import { KeyText } from "./KeyText";
import { KEY_OPTIONS, MINOR_FORMS, HANDS_OPTIONS, itemTitle, handsText } from "./format";
import { sameSpelledKey } from "../../../lib/technique";
import { TECHNIQUE_MIN_TEMPO, TECHNIQUE_MAX_TEMPO } from "../../../lib/constants";

// "Add scale or arpeggio" (Pass 101). Not drawn in the mockup, so built from
// the brief's field list — form, key, type (minor form), octaves, hands,
// check octaves, optional starting tempo, optional star — in the same field
// style as the Library row editor.
export function AddTechniqueItemForm({ items, onAdd, onClose }) {
  const [form, setForm] = useState("scale");
  const [keyIndex, setKeyIndex] = useState("0");
  const [minorForm, setMinorForm] = useState("natural");
  const [octaves, setOctaves] = useState(2);
  const [hands, setHands] = useState("together");
  const [checkOctaves, setCheckOctaves] = useState(2);
  const [checkTouched, setCheckTouched] = useState(false);
  const [tempo, setTempo] = useState(null);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState("");

  const key = KEY_OPTIONS[Number(keyIndex)];
  const isMinorScale = form === "scale" && key.quality === "minor";
  const draft = {
    form,
    tonic: key.tonic,
    quality: key.quality,
    minorForm: isMinorScale ? minorForm : null,
    octaves,
    hands,
    checkOctaves,
    evenTempo: tempo,
    starred,
  };
  const duplicate = items.find(
    // Matched as spelled: a G♭ major scale and an F♯ major scale are two
    // different library items (pieces link to scales by the key as written).
    (it) => it.form === draft.form && sameSpelledKey(it, draft) && (it.minorForm || null) === draft.minorForm && it.hands === draft.hands
  );

  const submit = () => {
    if (tempo != null && (tempo < TECHNIQUE_MIN_TEMPO || tempo > TECHNIQUE_MAX_TEMPO)) {
      setError(`Enter a starting tempo between ${TECHNIQUE_MIN_TEMPO} and ${TECHNIQUE_MAX_TEMPO}, or leave it blank.`);
      return;
    }
    if (duplicate) {
      setError(`${itemTitle(duplicate)}, ${handsText(duplicate.hands)}, is already in your library.`);
      return;
    }
    if (onAdd(draft)) onClose();
  };

  return (
    <div className="panel tq-panel tq-add-panel">
      <h3 className="tq-panel-title">Add scale or arpeggio</h3>
      <div className="tq-editor-grid tq-add-grid">
        <div className="tq-editor-field">
          <span>Form</span>
          <div className="segmented tq-seg-sm">
            {[["scale", "Scale"], ["arpeggio", "Arpeggio"]].map(([v, l]) => (
              <button key={v} type="button" className={form === v ? "active" : ""} onClick={() => { setForm(v); setError(""); }}>{l}</button>
            ))}
          </div>
        </div>
        <label className="tq-editor-field">
          <span>Key</span>
          <select className="tq-select" value={keyIndex} onChange={(e) => { setKeyIndex(e.target.value); setError(""); }}>
            {KEY_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        {isMinorScale && (
          <label className="tq-editor-field">
            <span>Type</span>
            <select className="tq-select" value={minorForm} onChange={(e) => { setMinorForm(e.target.value); setError(""); }}>
              {MINOR_FORMS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        )}
        <label className="tq-editor-field">
          <span>Octaves</span>
          <NumberInput
            value={octaves}
            min={1}
            max={4}
            onCommit={(n) => { setOctaves(n); if (!checkTouched) setCheckOctaves(n); }}
          />
        </label>
        <label className="tq-editor-field">
          <span>Hands</span>
          <select className="tq-select" value={hands} onChange={(e) => { setHands(e.target.value); setError(""); }}>
            {HANDS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="tq-editor-field">
          <span>Even-rhythm check</span>
          <NumberInput value={checkOctaves} min={1} max={4} onCommit={(n) => { setCheckOctaves(n); setCheckTouched(true); }} />
        </label>
        <label className="tq-editor-field">
          <span>Starting tempo (optional)</span>
          <NumberInput
            value={tempo ?? ""}
            placeholder="♩ ="
            onDraftChange={(t) => { setError(""); if (t === "") setTempo(null); }}
            onCommit={(n) => setTempo(n)}
          />
        </label>
      </div>
      <label className="tq-checkbox">
        <input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} />
        Practice this scale more often
      </label>
      <div className="tq-add-row">
        <button type="button" className="primary-btn sm" onClick={submit}>
          {/* One span: .primary-btn is a flex row with a gap, which would
              otherwise land between "Add" and the key name. */}
          <span>Add <KeyText text={itemTitle(draft)} /></span>
        </button>
        <button type="button" className="ghost-btn tq-xs" onClick={onClose}>Cancel</button>
        {error && <span className="tq-error">{error}</span>}
      </div>
    </div>
  );
}
