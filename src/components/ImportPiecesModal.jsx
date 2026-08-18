import { useState, useMemo } from "react";
import { X, Upload } from "lucide-react";
import { PieceCheckRow } from "./PieceCheckRow";
import { findMatchingPiece, diffImportedPiece } from "../lib/storage";

// candidates: the raw piece objects parsed out of the chosen backup file,
// before any of them have actually been added or merged. existingPieces:
// current `pieces` state, used only to preview which candidates will match
// an existing piece (findMatchingPiece) so the user can see "New" vs.
// "Update existing" before committing — the real match/merge happens again
// on confirm, against whatever `pieces` looks like at that moment. Same
// preview-only reasoning applies to `hasDivergence` (diffImportedPiece) below
// — App.jsx's handleConfirmImport re-derives it at confirm time rather than
// trusting this snapshot.
export function ImportPiecesModal({ candidates, existingPieces, onCancel, onImport }) {
  const [selected, setSelected] = useState(() => new Set(candidates.map((_, i) => i)));
  // Per-piece "keep what's here" vs "use the imported version" pick, keyed
  // by candidate index — only ever read for a row diffImportedPiece flagged
  // as real divergence (see `rows` below); every other row's ladder state is
  // resolved automatically, no entry needed here. Missing entry for a
  // divergent row defaults to "existing" (the safer, pre-Pass-13 behavior)
  // until the user actually picks.
  const [ladderChoices, setLadderChoices] = useState({});
  // Single choice for the whole import, not per-piece like ladderChoices —
  // sortOrder is a list-wide arrangement, not independent per-piece data, so
  // there's no per-row "divergence" to flag the way hasDivergence does for
  // ladder state. Defaults to "existing" (keep the order already here); only
  // shown at all when at least one candidate matches an existing piece,
  // since a pure "all new pieces" import has no existing order to conflict
  // with. See mergeImportedPiece's orderChoice param (lib/storage.js).
  const [orderChoice, setOrderChoice] = useState("existing");

  const rows = useMemo(
    () =>
      candidates.map((piece, index) => {
        const match = findMatchingPiece(existingPieces, piece);
        const hasDivergence = !!match && diffImportedPiece(match, piece).hasDivergence;
        return { piece, index, isUpdate: !!match, hasDivergence };
      }),
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

  const chooseLadder = (index, choice) => {
    setLadderChoices((prev) => ({ ...prev, [index]: choice }));
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
          {updateCount > 0 && (
            <div style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
              <p className="wizard-hint" style={{ margin: "0 0 8px" }}>
                Piece order — this file may list your pieces in a different order than they're
                arranged here. Which order should the switcher use for matched pieces?
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={orderChoice === "existing" ? "primary-btn sm" : "ghost-btn"}
                  onClick={() => setOrderChoice("existing")}
                >
                  Keep what's here
                </button>
                <button
                  type="button"
                  className={orderChoice === "imported" ? "primary-btn sm" : "ghost-btn"}
                  onClick={() => setOrderChoice("imported")}
                >
                  Use the imported order
                </button>
              </div>
            </div>
          )}
          <div className="checklist">
            {rows.map(({ piece, index, isUpdate, hasDivergence }) => (
              <div key={index}>
                <PieceCheckRow
                  piece={piece}
                  checked={selected.has(index)}
                  onToggle={() => toggle(index)}
                  badge={<span className={`tag ${isUpdate ? "subtle" : "tag-new"}`}>{isUpdate ? "Update existing" : "New"}</span>}
                />
                {hasDivergence && selected.has(index) && (
                  <div style={{ margin: "6px 0 0 34px", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
                    <p className="wizard-hint" style={{ margin: "0 0 8px" }}>
                      This piece's practice progress differs here from what's in the file — which one should
                      count?
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className={(ladderChoices[index] || "existing") === "existing" ? "primary-btn sm" : "ghost-btn"}
                        onClick={() => chooseLadder(index, "existing")}
                      >
                        Keep what's here
                      </button>
                      <button
                        type="button"
                        className={ladderChoices[index] === "imported" ? "primary-btn sm" : "ghost-btn"}
                        onClick={() => chooseLadder(index, "imported")}
                      >
                        Use the imported version
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="primary-btn" disabled={selected.size === 0} onClick={() => onImport([...selected], ladderChoices, orderChoice)}>
            <Upload size={15} /> Import {selected.size} piece{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
