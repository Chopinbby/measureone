import { useState, useMemo } from "react";
import { X, Upload } from "lucide-react";
import { PieceCheckRow } from "./PieceCheckRow";
import { findMatchingPiece } from "../lib/storage";

// candidates: the raw piece objects parsed out of the chosen backup file,
// before any of them have actually been added or merged. existingPieces:
// current `pieces` state, used only to preview which candidates will match
// an existing piece (findMatchingPiece) so the user can see "New" vs.
// "Update existing" before committing — the real match/merge happens again
// on confirm, against whatever `pieces` looks like at that moment.
export function ImportPiecesModal({ candidates, existingPieces, onCancel, onImport }) {
  const [selected, setSelected] = useState(() => new Set(candidates.map((_, i) => i)));

  const rows = useMemo(
    () => candidates.map((piece, index) => ({ piece, index, isUpdate: !!findMatchingPiece(existingPieces, piece) })),
    [candidates, existingPieces]
  );
  const updateCount = rows.filter((r) => r.isUpdate).length;
  const newCount = rows.length - updateCount;

  const toggle = (index) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>Import pieces</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="wizard-hint">
            Found {rows.length} piece{rows.length === 1 ? "" : "s"} in this file — {newCount} new,{" "}
            {updateCount} matching a piece you already have. Choose which to import; a match updates the
            existing piece instead of duplicating it.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button className="ghost-btn" onClick={() => setSelected(new Set(candidates.map((_, i) => i)))}>Select all</button>
            <button className="ghost-btn" onClick={() => setSelected(new Set())}>Select none</button>
          </div>
          <div className="checklist">
            {rows.map(({ piece, index, isUpdate }) => (
              <PieceCheckRow
                key={index}
                piece={piece}
                checked={selected.has(index)}
                onToggle={() => toggle(index)}
                badge={<span className={`tag ${isUpdate ? "subtle" : "tag-new"}`}>{isUpdate ? "Update existing" : "New"}</span>}
              />
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="primary-btn" disabled={selected.size === 0} onClick={() => onImport([...selected])}>
            <Upload size={15} /> Import {selected.size} piece{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
