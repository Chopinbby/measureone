import { useState } from "react";
import { X, ChevronLeft, RefreshCw } from "lucide-react";
import { NumberInput } from "./NumberInput";
import { REVIVAL_PURPOSE_OPTIONS } from "../lib/constants";
import { clamp } from "../lib/utils";

/* ------------------------------------------------------------------ */
/*  Revival entry (collects context before the reassessment pass)     */
/* ------------------------------------------------------------------ */

export function RevivalEntryModal({ piece, onCancel, onStart }) {
  const [purpose, setPurpose] = useState(null);
  const [tempoLadderStartFraction, setTempoLadderStartFraction] = useState(0.6);
  const [lastPlayedDate, setLastPlayedDate] = useState(piece.lastPlayedDate || new Date().toISOString().slice(0, 10));

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>Start a revival</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="wizard-hint">
            Bring "{piece.name || "this piece"}" back after time away. A few quick questions, then we'll
            go through it chunk by chunk to see where things actually stand.
          </p>
          <label className="field">
            <span>When did you last play it?</span>
            <input
              type="date"
              value={lastPlayedDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setLastPlayedDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Tempo ladder starting point (% of target)</span>
            <NumberInput
              value={Math.round(tempoLadderStartFraction * 100)}
              min={10}
              max={95}
              onCommit={(n) => setTempoLadderStartFraction(clamp(n, 10, 95) / 100)}
            />
          </label>
          <div className="field">
            <span>What's this revival for?</span>
            <div className="segmented">
              {REVIVAL_PURPOSE_OPTIONS.map((o) => (
                <button key={o.value} className={purpose === o.value ? "active" : ""} onClick={() => setPurpose(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onCancel}>
            <ChevronLeft size={16} /> Cancel
          </button>
          <button
            className="primary-btn"
            disabled={!purpose}
            onClick={() =>
              onStart({
                purpose,
                tempoLadderStartFraction,
                lastPlayedDate,
              })
            }
          >
            <RefreshCw size={16} /> Begin revival
          </button>
        </div>
      </div>
    </div>
  );
}
