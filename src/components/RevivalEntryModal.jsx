import { useState } from "react";
import { X, ChevronLeft, RefreshCw } from "lucide-react";
import { NumberInput } from "./NumberInput";

/* ------------------------------------------------------------------ */
/*  Revival entry (collects context before the reassessment pass)     */
/* ------------------------------------------------------------------ */

export function RevivalEntryModal({ piece, onCancel, onStart }) {
  // computeTempoLadder (lib/revival.js) still wants a fraction of target —
  // asking the user to type a BPM instead and deriving the fraction here is
  // just a friendlier input for the same underlying value; nothing
  // downstream changes. min/max on the BPM field below mirror the old
  // 10%-95%-of-target bounds, expressed in BPM instead of percent, so this
  // can't produce a fraction outside that range while targetBPM is set.
  const targetBPM = piece.targetBPM || null;
  const [startBPM, setStartBPM] = useState(() => (targetBPM ? Math.round(targetBPM * 0.6) : ""));
  const [lastPlayedDate, setLastPlayedDate] = useState(piece.lastPlayedDate || new Date().toISOString().slice(0, 10));
  // No target BPM to be a fraction of — falls back to the old flat default
  // rather than computing a fraction against nothing.
  const tempoLadderStartFraction = targetBPM && startBPM !== "" ? Number(startBPM) / targetBPM : 0.6;

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
            Bring "{piece.name || "this piece"}" back after time away. Set the date you last played it
            and the average BPM you'd like to start practicing the piece.
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
            <span>Tempo ladder starting point (BPM)</span>
            <NumberInput
              value={startBPM}
              min={targetBPM ? Math.round(targetBPM * 0.1) : 20}
              max={targetBPM ? Math.round(targetBPM * 0.95) : 400}
              onCommit={(n) => setStartBPM(n)}
              placeholder={targetBPM ? String(Math.round(targetBPM * 0.6)) : "e.g. 88"}
            />
            {!targetBPM && (
              <p className="tip-line">
                This piece has no target tempo set, so there's nothing to start a fraction of — the
                tempo ladder will start at a flat default instead.
              </p>
            )}
          </label>
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onCancel}>
            <ChevronLeft size={16} /> Cancel
          </button>
          <button
            className="primary-btn"
            onClick={() =>
              onStart({
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
