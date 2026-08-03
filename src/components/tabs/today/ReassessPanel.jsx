import { useState } from "react";
import { NumberInput } from "../../NumberInput";
import { formatRange } from "../../../lib/utils";
import { DIFFICULTY_META } from "../../../lib/constants";

export function ReassessPanel({ piece, todaysRanges, onReassessRange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [level, setLevel] = useState("medium");

  if (todaysRanges.length === 0) return null;

  return (
    <div className="panel reassess-panel">
      {!open ? (
        <div className="reassess-prompt">
          <p className="wizard-hint" style={{ margin: 0 }}>Practiced something today? You can reassess difficulty for specific measures.</p>
          <button className="ghost-btn" onClick={() => setOpen(true)}>Reassess difficulty</button>
        </div>
      ) : (
        <>
          <h3>Reassess difficulty by measure</h3>
          <p className="wizard-hint">Pick a range and a new rating — difficulty is tracked measure by measure, same as setup.</p>
          <div className="reassess-quickpicks">
            {todaysRanges.map((r) => (
              <button key={`${r.start}-${r.end}`} className="chip subtle" onClick={() => { setFrom(r.start); setTo(r.end); }}>
                {formatRange(r.start, r.end)}
              </button>
            ))}
          </div>
          <div className="field-row">
            <label className="field">
              <span>From measure</span>
              <NumberInput value={from} min={1} max={piece.totalMeasures} onCommit={setFrom} />
            </label>
            <label className="field">
              <span>To measure</span>
              <NumberInput value={to} min={1} max={piece.totalMeasures} onCommit={setTo} />
            </label>
          </div>
          <div className="segmented" style={{ marginBottom: 16 }}>
            {["easy", "medium", "hard"].map((lvl) => (
              <button key={lvl} className={level === lvl ? "active" : ""} onClick={() => setLevel(lvl)}>
                {DIFFICULTY_META[lvl].label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="primary-btn"
              onClick={() => {
                onReassessRange(Math.min(from, to), Math.max(from, to), level);
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  );
}
