import { Plus, Download, Upload, Pencil, RotateCcw, Check } from "lucide-react";
import { BasicsFields } from "../fields/BasicsFields";
import { SectionsEditor } from "../fields/SectionsEditor";
import { DifficultyEditor } from "../fields/DifficultyEditor";
import { RecurringEditor } from "../fields/RecurringEditor";
import { ScheduleFields } from "../fields/ScheduleFields";
import { BpmZonesEditor } from "../fields/BpmZonesEditor";
import { RecordingsEditor } from "../fields/RecordingsEditor";
import { RecordingsList } from "../fields/RecordingsList";
import { autoChunkSize } from "../../lib/chunking";
import { formatMinutes } from "../../lib/utils";

export function SettingsTab({ piece, editDraft, setEditDraft, onSave, onDelete, editing, onStartEdit, onDiscard, onAddPiece, onExportClick, onImportClick }) {
  if (!editing || !editDraft) {
    return (
      <div className="tab-pane">
        <div className="tab-header"><h1>Settings</h1></div>
        <div className="panel">
          <h3>Pieces</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>Add another piece to your practice rotation.</p>
          <button className="ghost-btn" onClick={onAddPiece}>
            <Plus size={14} /> Add new piece
          </button>
        </div>
        <div className="panel">
          <h3>Backup & restore</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>
            Everything is saved only in this browser. Export a backup file now and then, or before
            switching browsers or devices — you can import it back in later. Both let you choose
            which pieces to include.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="ghost-btn" onClick={onExportClick}>
              <Download size={14} /> Export pieces
            </button>
            <button className="ghost-btn" onClick={onImportClick}>
              <Upload size={14} /> Import backup
            </button>
          </div>
        </div>
        <div className="panel">
          <h3>Piece details</h3>
          <dl className="def-list">
            <div><dt>Name</dt><dd>{piece.name}</dd></div>
            {piece.composer && <div><dt>Composer</dt><dd>{piece.composer}</dd></div>}
            <div><dt>Measures</dt><dd className="mono">{piece.totalMeasures}</dd></div>
            <div><dt>Sections</dt><dd className="mono">{piece.sections.length}</dd></div>
            <div><dt>Chunk size</dt><dd className="mono">{piece.chunkMode === "auto" ? `${autoChunkSize(piece.totalMeasures)} (auto)` : `${piece.customChunkSize} (custom)`}</dd></div>
            <div><dt>Recurring material</dt><dd>{piece.recurringMode === "none" ? "None" : piece.recurringMode === "basic" ? `${piece.recurringMeasures} measures (quick count)` : `${piece.recurringPairs.length} passage(s) mapped`}</dd></div>
            <div><dt>Schedule</dt><dd className="mono">{piece.daysToLearn} days, {formatMinutes(piece.minutesPerDay)}/day</dd></div>
          </dl>
          {piece.notes && (
            <div className="piece-notes">
              <h4>Notes</h4>
              <p>{piece.notes}</p>
            </div>
          )}
          {piece.recordings && piece.recordings.length > 0 && (
            <div className="piece-notes">
              <h4>Recordings</h4>
              <RecordingsList recordings={piece.recordings} />
            </div>
          )}
          <button className="primary-btn" onClick={onStartEdit}>
            <Pencil size={15} /> Edit piece
          </button>
        </div>
        <div className="panel danger">
          <h3>Delete this piece</h3>
          <p className="wizard-hint">
            Removes "{piece.name || "this piece"}" and its practice history from this browser. Your
            other pieces aren't affected.
          </p>
          <button className="danger-btn" onClick={onDelete}>
            <RotateCcw size={15} /> Delete this piece
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-pane">
      <div className="tab-header"><h1>Edit piece</h1></div>
      <div className="panel"><h3>Piece</h3><BasicsFields draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Sections</h3><SectionsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Difficulty</h3><DifficultyEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Recurring material</h3><RecurringEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Schedule</h3><ScheduleFields draft={editDraft} set={setEditDraft} isRevival={!!editDraft.revival?.active} /></div>
      <div className="panel"><h3>Tempo zones</h3><BpmZonesEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Recordings</h3><RecordingsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="edit-actions">
        <button className="ghost-btn" onClick={onDiscard}>Discard changes</button>
        <button className="primary-btn" onClick={() => onSave(editDraft)}>
          <Check size={15} /> Save changes
        </button>
      </div>
    </div>
  );
}
