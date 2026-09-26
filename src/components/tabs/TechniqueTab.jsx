import { useState } from "react";
import { Plus } from "lucide-react";
import { TechniquePanel } from "./technique/TechniquePanel";
import { TechniqueLibrary } from "./technique/TechniqueLibrary";
import { TechniqueMethods } from "./technique/TechniqueMethods";
import { AddTechniqueItemForm } from "./technique/AddTechniqueItemForm";
import { todayISODate } from "../../lib/utils";

// The Technique page (Pass 101): app-level, not scoped to the open piece.
// Layout and copy follow docs/mockups/technique-practice.html; behavior
// follows docs/Technique-Practice.md. All data comes from App.jsx's
// `technique` state and every change goes through its handlers (never
// setPieces/updatePiece).
export function TechniqueTab({
  technique, repertoireKeys,
  onCheckOff, onUncheck, onLogTempo, onToggleStarItem, onToggleRotation,
  onToggleStarMethod, onToggleMethod, onAddItem, onEditItem, onChangeCheckOctaves, onAddMethod,
}) {
  const [sub, setSub] = useState("today");
  const [adding, setAdding] = useState(false);
  const inRotation = technique.items.filter((it) => it.inRotation).length;
  const today = technique.dayList?.date || todayISODate();

  return (
    <div className="tab-pane">
      <div className="tq-page-head">
        <div>
          <p className="eyebrow">Technique</p>
          <h1 className="tq-h1">Scales and arpeggios</h1>
          <p className="hero-sub tq-page-sub">{inRotation} {inRotation === 1 ? "item" : "items"} in your rotation</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add scale or arpeggio
        </button>
      </div>

      {adding && (
        <AddTechniqueItemForm items={technique.items} onAdd={onAddItem} onClose={() => setAdding(false)} />
      )}

      <div className="segmented tq-subtabs">
        {[["today", "Today"], ["library", "Library"], ["methods", "Methods"]].map(([v, l]) => (
          <button key={v} type="button" className={sub === v ? "active" : ""} onClick={() => setSub(v)}>{l}</button>
        ))}
      </div>

      {sub === "today" && (
        <TechniquePanel
          technique={technique}
          repertoireKeys={repertoireKeys}
          variant="page"
          onAddItem={() => setAdding(true)}
          handlers={{ onCheckOff, onUncheck, onLogTempo, onToggleStarItem, onToggleStarMethod }}
        />
      )}
      {sub === "library" && (
        <TechniqueLibrary
          technique={technique}
          repertoireKeys={repertoireKeys}
          today={today}
          onToggleStarItem={onToggleStarItem}
          onToggleRotation={onToggleRotation}
          onEditItem={onEditItem}
          onChangeCheckOctaves={onChangeCheckOctaves}
        />
      )}
      {sub === "methods" && (
        <TechniqueMethods
          technique={technique}
          onToggleStarMethod={onToggleStarMethod}
          onToggleMethod={onToggleMethod}
          onAddMethod={onAddMethod}
        />
      )}
    </div>
  );
}
