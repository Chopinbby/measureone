import { Check } from "lucide-react";

// Shared checklist row for the export/import piece pickers — a custom
// checkbox (not a native <input>) so the whole row is one click target,
// matching the ChecklistItem pattern used in Today's Practice.
export function PieceCheckRow({ piece, checked, onToggle, badge }) {
  return (
    <div
      className={`checklist-item ${checked ? "checked" : ""}`}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{ cursor: "pointer" }}
    >
      <span className={checked ? "checklist-check" : "checklist-check-empty"}>
        {checked && <Check size={13} />}
      </span>
      <div className="checklist-body">
        <div className="checklist-row">
          <span className="checklist-label">{piece.name || "Untitled piece"}</span>
          {badge}
        </div>
        {piece.composer && <p className="tip-line">{piece.composer}</p>}
      </div>
    </div>
  );
}
