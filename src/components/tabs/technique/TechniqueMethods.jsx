import { useState } from "react";
import { StarButton } from "./StarButton";
import { APPLIES_TO_LABEL } from "./format";
import { TECHNIQUE_TAGS, resolveMethods } from "../../../lib/technique";

// Methods (Pass 101): the 13 built-ins plus the user's own, grouped by
// technique, each with a star (global per method), an on/off switch and
// its "applies to" line; then "Add your own method".
export function TechniqueMethods({ technique, onToggleStarMethod, onToggleMethod, onAddMethod }) {
  const methods = resolveMethods(technique.methodState, technique.customMethods);
  const onCount = methods.filter((m) => m.enabled).length;

  const [name, setName] = useState("");
  const [tag, setTag] = useState(TECHNIQUE_TAGS[0]);
  const [description, setDescription] = useState("");
  const [appliesTo, setAppliesTo] = useState("both");
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name first");
      setAdded("");
      return;
    }
    if (onAddMethod({ name: trimmed, technique: tag, description, appliesTo })) {
      setAdded(`Added "${trimmed}".`);
      setName("");
      setDescription("");
    }
  };

  return (
    <>
      <div className="panel tq-panel">
        <div className="tq-panel-head">
          <h3 className="tq-panel-title">Practice methods</h3>
          <span className="tq-meta">{methods.length} methods · {onCount} on</span>
        </div>
        <p className="tq-panel-sub">
          Each time you practice a scale, 3 or 4 of these are suggested and rotate so you do not repeat
          the same ones. Star the ones you want more often. Turn off any you do not want.
        </p>
        {TECHNIQUE_TAGS.map((t) => {
          const group = methods.filter((m) => m.technique === t);
          if (!group.length) return null;
          return (
            <div key={t}>
              <div className="tq-group-label">{t}</div>
              {group.map((m) => (
                <div key={m.id} className={`tq-method-item${m.enabled ? "" : " off"}`}>
                  <StarButton on={m.starred} onClick={() => onToggleStarMethod(m.id)} label="Suggest this method more often" />
                  <div className="tq-method-item-body">
                    <div className="tq-title">
                      {m.name}
                      {m.custom && <span className="tq-mine">Yours</span>}
                    </div>
                    {m.description && <div className="tq-method-desc">{m.description}</div>}
                    <div className="tq-meta">{APPLIES_TO_LABEL[m.appliesTo] || APPLIES_TO_LABEL.both}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.enabled}
                    aria-label={`Include ${m.name}`}
                    className={`tq-switch${m.enabled ? " on" : ""}`}
                    onClick={() => onToggleMethod(m.id)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="panel tq-panel">
        <h3 className="tq-panel-title">Add your own method</h3>
        <p className="tq-panel-sub">It joins the rotation right away.</p>
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            placeholder="Left hand alone, eyes closed"
            onChange={(e) => { setName(e.target.value); setError(""); setAdded(""); }}
          />
        </label>
        <label className="field">
          <span>Technique</span>
          <select className="tq-select" value={tag} onChange={(e) => setTag(e.target.value)}>
            {TECHNIQUE_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span>How to play it</span>
          <input
            type="text"
            value={description}
            placeholder="Play the left hand alone without looking"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Applies to</span>
          <select className="tq-select" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
            {Object.entries(APPLIES_TO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="tq-add-row">
          <button type="button" className="primary-btn sm" onClick={add}>Add method</button>
          {error && <span className="tq-error">{error}</span>}
          {added && <span className="tq-ok">{added}</span>}
        </div>
      </div>
    </>
  );
}
