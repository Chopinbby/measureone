import { useState } from "react";
import { X, Download } from "lucide-react";
import { PieceCheckRow } from "./PieceCheckRow";

// pieceGroups: same shape groupPiecesByWork produces — standalone pieces as
// one-item groups, multi-movement works grouped under their workName.
export function ExportPiecesModal({ pieceGroups, onCancel, onExport }) {
  const allIds = pieceGroups.flatMap((g) => g.pieces.map((p) => p.id));
  const [selected, setSelected] = useState(() => new Set(allIds));

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>Export pieces</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="wizard-hint">Choose which pieces to include in the backup file.</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button className="ghost-btn" onClick={() => setSelected(new Set(allIds))}>Select all</button>
            <button className="ghost-btn" onClick={() => setSelected(new Set())}>Select none</button>
          </div>
          <div className="checklist">
            {pieceGroups.map((g) => (
              <div key={g.workId || g.pieces[0].id}>
                {g.workId && <div className="piece-switcher-work-name">{g.workName}</div>}
                {g.pieces.map((p) => (
                  <PieceCheckRow key={p.id} piece={p} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onCancel}>Cancel</button>
          <button className="primary-btn" disabled={selected.size === 0} onClick={() => onExport([...selected])}>
            <Download size={15} /> Export {selected.size} piece{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
