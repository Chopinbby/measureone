import { useState, useEffect } from "react";
import { NumberInput } from "../../NumberInput";
import { coldStartDueThreshold } from "../../../lib/coldStart";
import { CONFIDENCE_PRESETS } from "../../../lib/constants";

// Offered once every section's own single-section run-through has been
// logged at least once (coldStartGateMet, lib/coldStart.js) — a signal
// the whole piece has genuinely been covered, not just started — and then
// re-offered at a widening gap since anything was last logged on the
// piece at all (3, 7, 14, 28, ... days). Unlike SectionRunThroughPanel's
// items or the past-plan due-review list, this isn't a persistent
// checklist entry: coldStartDueThreshold reads as "due" only on the day a
// new threshold is actually crossed, so this panel renders — and then
// disappears again — on its own as time passes, with nothing to
// dismiss. See docs/Algorithms.md#cold-start-check.
//
// Deliberately just two fields (average tempo + free-text notes), no
// structured stop-count the way ConsolidationPanel's "__consolidation__"
// logging has — the point of a cold-start check is one uninterrupted
// play-through, with stops/memory breaks/anything else worth remembering
// folded into the notes afterward rather than tallied live.
export function ColdStartPanel({ piece, day, onLogColdStart, onUnlogColdStart, onSetOverallConfidence }) {
  const dueThreshold = coldStartDueThreshold(piece);
  const [avgBpm, setAvgBpm] = useState("");
  const [notes, setNotes] = useState("");
  // Set right after a successful log, so the optional "rate the piece
  // overall" follow-up below has somewhere to render — logging always
  // moves piece.lastLoggedAt to today, which immediately makes
  // dueThreshold go back to null (see coldStartDueThreshold), so without
  // this the whole panel would vanish the instant you log, with no chance
  // to see the follow-up at all. Reset on skip/pick, or simply lost on
  // navigating away (this tab unmounts) — nothing persisted, since a
  // skipped nudge should just quietly go away, not nag later.
  const [justLogged, setJustLogged] = useState(false);

  // TodayTab always renders this component — it's this function's own
  // `null` return that makes it disappear, not an unmount — so avgBpm/
  // notes are ordinary component state that would otherwise survive a
  // "goes quiet, becomes due again days later" cycle untouched. Found in
  // review: a note typed but never submitted could silently reappear
  // pre-filled the next time a threshold fires, rather than starting
  // fresh. Cleared every time the panel newly has something to show.
  useEffect(() => {
    if (dueThreshold != null) {
      setAvgBpm("");
      setNotes("");
    }
  }, [dueThreshold]);

  if (dueThreshold == null && !justLogged) return null;

  const entry = piece.progress["__cold_start__"] || {};
  const sessions = entry.sessions || [];
  const lastSession = sessions[sessions.length - 1];

  const submit = () => {
    if (avgBpm === "") return;
    onLogColdStart(day, Number(avgBpm), notes);
    setAvgBpm("");
    setNotes("");
    setJustLogged(true);
  };

  // Optional follow-up (Pass 58) — a completed Cold-Start check is a
  // natural moment to also update the piece's overall confidence rating,
  // but this must not turn into a second required form: picking a preset
  // applies it immediately (same instant-apply escape-hatch pattern
  // PieceMapTab's own "Quick rate" already uses), and Skip dismisses with
  // no trace — no partial state, nothing to come back to later.
  if (justLogged) {
    return (
      <div className="panel">
        <h3>Cold-start check</h3>
        {lastSession && (
          <p className="tip-line">
            Logged: {lastSession.avgBpm} BPM average
            {lastSession.notes ? ` — "${lastSession.notes}"` : ""}
          </p>
        )}
        <div className="field">
          <span>How would you rate the piece overall right now? (optional)</span>
          <div className="segmented">
            {CONFIDENCE_PRESETS.map((p) => (
              <button
                key={p.value}
                className={piece.manualOverallConfidence === p.value ? "active" : ""}
                onClick={() => {
                  onSetOverallConfidence(p.value);
                  setJustLogged(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <button className="ghost-btn" onClick={() => setJustLogged(false)}>
          Skip
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Cold-start check</h3>
      <p className="wizard-hint">
        It's been {dueThreshold}+ days since you last touched this piece. Play all the way through,
        cold — no warm-up, no stopping to fix anything — then jot down roughly how it went.
      </p>
      {lastSession && (
        <p className="tip-line">
          Last logged: {lastSession.avgBpm} BPM average
          {lastSession.notes ? ` — "${lastSession.notes}"` : ""}
        </p>
      )}
      <div className="log-row">
        <label>
          <span>Average BPM</span>
          <NumberInput value={avgBpm} min={0} onCommit={(n) => setAvgBpm(n)} placeholder="e.g. 96" />
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea
          placeholder="e.g. how many times you stopped, what felt shaky, any memory breaks"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="primary-btn sm" disabled={avgBpm === ""} onClick={submit}>
          {sessions.length > 0 ? "Log another cold-start check" : "Log cold-start check"}
        </button>
        {sessions.length > 0 && (
          <button className="ghost-btn" onClick={onUnlogColdStart}>
            Undo most recent
          </button>
        )}
      </div>
    </div>
  );
}
