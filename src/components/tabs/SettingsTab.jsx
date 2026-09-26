import { useState, useEffect } from "react";
import { Plus, Download, Upload, Pencil, RotateCcw, Check, Pause, Play, Archive, ArchiveRestore, BadgeCheck, Undo2, Target } from "lucide-react";
import { NumberInput } from "../NumberInput";
import { BasicsFields } from "../fields/BasicsFields";
import { KeyText } from "./technique/KeyText";
import { keyOptionFor } from "./technique/format";

// "D major", or "F♯/G♭ major" for an enharmonic pair, as in the key list.
const keyLabel = (k) => keyOptionFor(k)?.label || `${k.tonic} ${k.quality}`;
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
import { isPlanActuallyComplete } from "../../lib/scheduling";
import { isInRevival } from "../../lib/revival";
import { formatMinutes } from "../../lib/utils";

// The grayed-out look for the plan-incomplete Archive button comes from the
// shared .ghost-btn:disabled rule (App.jsx CSS, Pass 85) — this used to need
// an inline style here because that rule didn't exist yet. No
// pointerEvents: "none" on the button below — that would also remove it
// from :hover hit-testing, which silently kills this title tooltip
// (confirmed: disabled alone already blocks clicks/keyboard, so it isn't
// needed for that).
const ARCHIVE_LOCKED_TITLE = "Available once this piece's learning plan is actually finished";

export function SettingsTab({
  piece,
  chunkSet,
  timeline,
  editDraft,
  setEditDraft,
  onSave,
  onDelete,
  editing,
  onStartEdit,
  onDiscard,
  onAddPiece,
  onExportClick,
  onImportClick,
  onSetStatus,
}) {
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
            switching browsers or devices. You can import it back in later. Both let you choose
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
        {/* Read-only summary of whichever piece "Edit piece settings" will
            open — everything else about the current piece (status, revival,
            focus spots, delete, every editable field) lives behind that
            button. Sections/chunk size/recurring material used to be rows
            here too; they're editable on the edit page, so they're no longer
            repeated in this summary. */}
        <div className="panel">
          <h3>Current piece details</h3>
          <dl className="def-list">
            <div><dt>Name</dt><dd>{piece.name}</dd></div>
            {piece.composer && <div><dt>Composer</dt><dd>{piece.composer}</dd></div>}
            <div><dt>Measures</dt><dd className="mono">{piece.totalMeasures}</dd></div>
            <div><dt>Schedule</dt><dd className="mono">{piece.daysToLearn} days, {formatMinutes(piece.minutesPerDay)}/day</dd></div>
            {piece.homeKey && <div><dt>Key</dt><dd><KeyText text={keyLabel(piece.homeKey)} /></dd></div>}
            {piece.otherKeys?.length > 0 && (
              <div><dt>Other keys</dt><dd><KeyText text={piece.otherKeys.map(keyLabel).join(", ")} /></dd></div>
            )}
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
            <Pencil size={15} /> Edit piece settings
          </button>
        </div>
      </div>
    );
  }

  // Practice status and Delete are the only two controls on this page that
  // still act on the live piece the moment they're clicked (they have gating
  // and side effects, so they were deliberately not folded into editDraft).
  // Everything else here, including Focus spots, Revival settings and Mark as
  // learned elsewhere, edits editDraft and is saved or discarded with the
  // form. handleSavePiece (App.jsx) keeps the live `status` over the draft's
  // stale copy, so Save can't quietly undo a Pause/Archive done from here.
  const status = piece.status || "active";
  const planComplete = isPlanActuallyComplete(piece, chunkSet, timeline);
  // Whether the plan would read as finished WITHOUT the manual override —
  // the "Mark as learned elsewhere" button is only offered when it isn't.
  const naturallyComplete = isPlanActuallyComplete({ ...piece, markedLearnedElsewhere: false }, chunkSet, timeline);

  const confirmMarkLearned = () => {
    const ok = window.confirm(
      `Mark "${editDraft.name || "this piece"}" as learned elsewhere?\n\n` +
        "Once you save, this piece is treated as finished, whatever is logged in the app: " +
        "Daily Practice and Master Agenda switch it to maintenance reviews instead of the rest of " +
        "its learning plan, it stops being flagged as behind schedule, and Archive and Start " +
        "revival unlock.\n\n" +
        "Nothing is deleted or rescheduled, and you can undo this any time. " +
        "Nothing changes until you click Save changes."
    );
    if (ok) setEditDraft({ markedLearnedElsewhere: true });
  };

  return (
    <div className="tab-pane">
      <div className="tab-header"><h1>Edit piece settings</h1></div>
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
      {/* Pass 91 (experimental v1) — shown unconditionally, unlike the
          revival panel below: this is the "can change later" affordance the
          Wizard's own yes/no step promises, so it has to be reachable
          regardless of what was chosen at setup, not just once the feature
          is already on. Toggling it only ever changes whether the "add a
          focus spot" UI is offered — it never touches (or hides) an
          already-flagged spot's own gating/pausing, which reads straight off
          progress[id].troubleSpots (lib/scheduling.js's focusSpotGate), not
          off this flag. Pass 93: now a draft field, saved with Save changes. */}
      <div className="panel">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><Target size={15} /> Focus spots</h3>
        <p className="wizard-hint" style={{ marginBottom: 12 }}>
          Flag passages that need slow, deliberate drilling before they're ready for normal-tempo
          work. A chunk with unresolved focus spots is held back from your regular schedule until
          every spot on it resolves.
        </p>
        <div className="field">
          <span>Track focus spots for this piece</span>
          <div className="segmented">
            <button
              type="button"
              className={!editDraft.troubleSpotsEnabled ? "active" : ""}
              onClick={() => setEditDraft({ troubleSpotsEnabled: false })}
            >
              Off
            </button>
            <button
              type="button"
              className={editDraft.troubleSpotsEnabled ? "active" : ""}
              onClick={() => setEditDraft({ troubleSpotsEnabled: true })}
            >
              On
            </button>
          </div>
        </div>
        {editDraft.troubleSpotsEnabled && (
          <label className="field" style={{ maxWidth: 340, marginBottom: 0 }}>
            <span>Default focus-spot session length (minutes)</span>
            <NumberInput
              value={editDraft.troubleSpotDefaultMinutes}
              min={1}
              max={120}
              onCommit={(n) => setEditDraft({ troubleSpotDefaultMinutes: n })}
            />
            <p className="tip-line">Applies to new focus spots going forward. Existing ones keep the value they were created with.</p>
          </label>
        )}
      </div>
      {isInRevival(editDraft) && (
        <div className="panel">
          <h3>Revival settings</h3>
          <label className="field">
            <span>Tempo ladder starting point (BPM)</span>
            <NumberInput
              value={editDraft.targetBPM ? Math.round((editDraft.revival.tempoLadderStartFraction ?? 0.6) * editDraft.targetBPM) : ""}
              min={editDraft.targetBPM ? Math.round(editDraft.targetBPM * 0.1) : 20}
              max={editDraft.targetBPM ? Math.round(editDraft.targetBPM * 0.95) : 400}
              onCommit={(n) =>
                setEditDraft({
                  revival: { ...editDraft.revival, tempoLadderStartFraction: editDraft.targetBPM ? n / editDraft.targetBPM : 0.6 },
                })
              }
              placeholder={editDraft.targetBPM ? undefined : "e.g. 88"}
            />
            {!editDraft.targetBPM && (
              <p className="tip-line">
                The tempo ladder starts at a fraction of the target tempo. This piece has no given
                target tempo, so there's nothing to start a fraction of. Set it below, or practice
                tasks will suggest a flat default to start.
              </p>
            )}
          </label>
        </div>
      )}
      {(editDraft.markedLearnedElsewhere || !naturallyComplete) && (
        <div className="panel">
          <h3>Learned elsewhere</h3>
          {!editDraft.markedLearnedElsewhere ? (
            <>
              <p className="wizard-hint" style={{ marginBottom: 8 }}>
                Already know this piece from before you started tracking it here, or learned it
                away from the app entirely? You can mark it finished manually instead of logging
                every chunk retroactively. This unlocks Archive and Start revival and stops the
                schedule from flagging it as behind, the same as genuinely finishing the plan
                would.
              </p>
              <button className="ghost-btn" onClick={confirmMarkLearned}>
                <BadgeCheck size={14} /> Mark as learned elsewhere
              </button>
            </>
          ) : (
            <>
              <p className="wizard-hint" style={{ marginBottom: 8 }}>
                Marked as learned elsewhere. This piece is treated as finished regardless of
                what's actually logged in-app.
              </p>
              <button className="ghost-btn" onClick={() => setEditDraft({ markedLearnedElsewhere: false })}>
                <Undo2 size={14} /> Undo: treat as still in progress
              </button>
            </>
          )}
        </div>
      )}
      <div className="panel"><h3>Recordings</h3><RecordingsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="panel"><h3>Documents</h3><DocumentsEditor draft={editDraft} set={setEditDraft} /></div>
      <div className="edit-actions">
        <button className="ghost-btn" onClick={onDiscard}>Discard changes</button>
        <button
          className="primary-btn"
          disabled={!(editDraft.name.trim().length > 0 && editDraft.totalMeasures > 0) || (multiPart && !editDraft.workName.trim())}
          onClick={() => onSave(editDraft)}
        >
          <Check size={15} /> Save changes
        </button>
      </div>
      <div style={{ borderTop: "2px solid var(--line)", paddingTop: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h3 style={{ fontSize: 17, marginBottom: 4 }}>Applies immediately</h3>
          <p className="wizard-hint" style={{ margin: 0 }}>
            Changes in this section take effect as soon as you make them. They aren't part of Save
            changes or Discard changes.
          </p>
        </div>
        <div className="panel">
          <h3>Practice status</h3>
          <p className="wizard-hint" style={{ marginBottom: 12 }}>
            {status === "archived"
              ? "This piece is archived: it won't appear on your Master Agenda, and its confidence will keep quietly fading the longer it goes untouched, the same recency decay that applies to any chunk you stop practicing."
              : status === "paused"
                ? "This piece is paused: it won't appear on your Master Agenda and won't flag chunks as behind schedule. Confidence still fades exactly as it would if the piece were active."
                : "Active pieces appear on your Master Agenda and can flag chunks as behind schedule. Pause a piece you're setting aside mid-plan, or archive one you're done learning. Either way it drops off your daily agenda until you bring it back."}
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
            <p className="wizard-hint" style={{ marginTop: 8, marginBottom: 0 }}>
              Archive unlocks once this piece's plan is actually finished. This one still has
              practicing left to do. Pause it instead if you want it off your daily agenda for now.
            </p>
          )}
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
    </div>
  );
}
