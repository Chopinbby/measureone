import { useState, useEffect } from "react";
import { Plus, Download, Upload, Pencil, RotateCcw, Check, Pause, Play, Archive, ArchiveRestore } from "lucide-react";
import { BasicsFields } from "../fields/BasicsFields";
import { SectionsEditor } from "../fields/SectionsEditor";
import { DifficultyEditor } from "../fields/DifficultyEditor";
import { RecurringEditor } from "../fields/RecurringEditor";
import { ScheduleFields } from "../fields/ScheduleFields";
import { BpmZonesEditor } from "../fields/BpmZonesEditor";
import { LadderConfigEditor } from "../fields/LadderConfigEditor";
import { RecordingsEditor } from "../fields/RecordingsEditor";
import { RecordingsList } from "../fields/RecordingsList";
import { DocumentsEditor } from "../fields/DocumentsEditor";
import { DocumentsList } from "../fields/DocumentsList";
import { autoChunkSize } from "../../lib/chunking";
import { isPlanActuallyComplete } from "../../lib/scheduling";
import { formatMinutes } from "../../lib/utils";

// The grayed-out look for the plan-incomplete Archive button comes from the
// shared .ghost-btn:disabled rule (App.jsx CSS, Pass 85) — this used to need
// an inline style here because that rule didn't exist yet. No
// pointerEvents: "none" on the button below — that would also remove it
// from :hover hit-testing, which silently kills this title tooltip
// (confirmed: disabled alone already blocks clicks/keyboard, so it isn't
// needed for that).
const ARCHIVE_LOCKED_TITLE = "Available once this piece's learning plan is actually finished";

export function SettingsTab({ piece, chunkSet, timeline, editDraft, setEditDraft, onSave, onDelete, editing, onStartEdit, onDiscard, onAddPiece, onExportClick, onImportClick, onSetStatus }) {
  // Mirrors BasicsFields' own local "multiple movements" toggle state, the
  // same way Wizard.jsx does — needed here too so Save can be blocked when
  // the toggle is on but the work title is blank (same rule as the Wizard,
  // see CLAUDE.md). Unlike Wizard, SettingsTab itself never unmounts between
  // edit sessions (editDraft/editing live in App.jsx precisely so switching
  // tabs mid-edit doesn't lose the draft), so this can't just be a useState
  // initializer the way BasicsFields' own copy is — it has to be reset
  // explicitly whenever a new edit session starts.
  const [multiPart, setMultiPart] = useState(false);
  useEffect(() => {
    if (editing) setMultiPart(!!(editDraft?.workId || editDraft?.workName));
  }, [editing]);

  if (!editing || !editDraft) {
    const status = piece.status || "active";
    const planComplete = isPlanActuallyComplete(piece, chunkSet, timeline);
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
          <h3>Practice status</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>
            {status === "archived"
              ? "This piece is archived: it won't appear on your Master Agenda, and its confidence will keep quietly fading the longer it goes untouched — the same recency decay that applies to any chunk you stop practicing."
              : status === "paused"
                ? "This piece is paused: it won't appear on your Master Agenda and won't flag chunks as behind schedule. Confidence still fades exactly as it would if the piece were active."
                : "Active pieces appear on your Master Agenda and can flag chunks as behind schedule. Pause a piece you're setting aside mid-plan, or archive one you're done learning — either way it drops off your daily agenda until you bring it back."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status === "active" && (
              <>
                <button className="ghost-btn" onClick={() => onSetStatus("paused")}>
                  <Pause size={14} /> Pause piece
                </button>
                <button
                  className="ghost-btn"
                  disabled={!planComplete}
                  title={planComplete ? undefined : ARCHIVE_LOCKED_TITLE}
                  onClick={() => onSetStatus("archived")}
                >
                  <Archive size={14} /> Archive piece
                </button>
              </>
            )}
            {status === "paused" && (
              <>
                <button className="ghost-btn" onClick={() => onSetStatus("active")}>
                  <Play size={14} /> Resume piece
                </button>
                <button
                  className="ghost-btn"
                  disabled={!planComplete}
                  title={planComplete ? undefined : ARCHIVE_LOCKED_TITLE}
                  onClick={() => onSetStatus("archived")}
                >
                  <Archive size={14} /> Archive piece
                </button>
              </>
            )}
            {status === "archived" && (
              <button className="ghost-btn" onClick={() => onSetStatus("active")}>
                <ArchiveRestore size={14} /> Reactivate piece
              </button>
            )}
          </div>
          {status !== "archived" && !planComplete && (
            <p className="wizard-hint" style={{ marginTop: 8 }}>
              Archive unlocks once this piece's plan is actually finished — this one still has
              practicing left to do. Pause it instead if you want it off your daily agenda for now.
            </p>
          )}
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
          {piece.documents && piece.documents.length > 0 && (
            <div className="piece-notes">
              <h4>Documents</h4>
              <DocumentsList documents={piece.documents} />
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
      <div className="panel"><h3>Piece</h3><BasicsFields draft={editDraft} set={setEditDraft} onMultiPartChange={setMultiPart} /></div>
      <div className="panel"><h3>Sections</h3><SectionsEditor draft={editDraft} set={setEditDraft} /></div>
      {/* Tempo zones sits right after Sections, matching the Wizard's order
          — sections are the more natural thing to set first, and tempo
          zones can copy their ranges from them (BpmZonesEditor's "Copy
          ranges from sections" button). */}
      <div className="panel"><h3>Tempo zones</h3><BpmZonesEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Difficulty</h3><DifficultyEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Recurring material</h3><RecurringEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Schedule</h3><ScheduleFields draft={editDraft} set={setEditDraft} isRevival={!!editDraft.revival?.active} /></div>
      <div className="panel"><h3>Maintenance ladder</h3><LadderConfigEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Recordings</h3><RecordingsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Documents</h3><DocumentsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="edit-actions">
        <button className="ghost-btn" onClick={onDiscard}>Discard changes</button>
        <button className="primary-btn" disabled={multiPart && !editDraft.workName.trim()} onClick={() => onSave(editDraft)}>
          <Check size={15} /> Save changes
        </button>
      </div>
    </div>
  );
}
