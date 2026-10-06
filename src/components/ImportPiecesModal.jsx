import { useState, useMemo } from "react";
import { X, Upload, CloudDownload } from "lucide-react";
import { PieceCheckRow } from "./PieceCheckRow";
import { findMatchingPiece, diffImportedPiece, mergeImportedTechnique } from "../lib/storage";

// candidates: the raw piece objects parsed out of the chosen backup file,
// before any of them have actually been added or merged. existingPieces:
// current `pieces` state, used only to preview which candidates will match
// an existing piece (findMatchingPiece) so the user can see "New" vs.
// "Update existing" before committing — the real match/merge happens again
// on confirm, against whatever `pieces` looks like at that moment. Same
// preview-only reasoning applies to `hasDivergence` (diffImportedPiece) below
// — App.jsx's handleConfirmImport re-derives it at confirm time rather than
// trusting this snapshot.
// techniqueCandidate (Pass 104): the backup's technique block
// (parseBackupTechnique), or null for a backup without one — then no
// "Technique library" row appears and the import behaves exactly as before.
// existingTechnique is only used to preview what the merge will add.
// techniqueUnreadable / techniqueSkippedItems (Pass 104 review fix): the
// file had a technique block that couldn't be read at all, or some of its
// scales couldn't be — said here instead of being skipped silently.
//
// Pass 112: the same modal also shows what comes from the person's ACCOUNT
// (restore, "Get changes", Review), where lib/accountSync.js has already
// worked out each piece's kind. `source` is "file" (everything above, exactly
// as before) or "account"; then `rowMeta[index]` is { kind, held, matchName }
// for each candidate (kind: "new" | "take" | "ask" | "combine"), and the
// wording says "your account" where it has to. `mode` is "restore" |
// "changes" | "review". `deletedElsewhere` lists pieces the account marks
// deleted that are still here, each with a "Delete it here too" button
// (onDeleteHere); nothing is removed unless that's clicked. A piece changed on
// both sides ("ask") or to be combined ("combine") always gets the picker.
export function ImportPiecesModal({
  candidates, existingPieces, techniqueCandidate = null, existingTechnique = null,
  techniqueUnreadable = false, techniqueSkippedItems = 0, onCancel, onImport,
  source = "file", mode = "changes", rowMeta = null, deletedElsewhere = [], onDeleteHere = null, unreadableCount = 0,
}) {
  const fromAccount = source === "account";
  const [selected, setSelected] = useState(() => new Set(candidates.map((_, i) => i)));
  const [includeTechnique, setIncludeTechnique] = useState(!!techniqueCandidate);
  const techniquePreview = useMemo(
    () => (techniqueCandidate && existingTechnique ? mergeImportedTechnique(existingTechnique, techniqueCandidate).stats : null),
    [techniqueCandidate, existingTechnique]
  );
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
        if (fromAccount) {
          const meta = (rowMeta && rowMeta[index]) || { kind: "new" };
          // Changed on both sides, or two copies to combine: the person decides.
          const hasDivergence = meta.kind === "ask" || meta.kind === "combine";
          return { piece, index, isUpdate: meta.kind !== "new", hasDivergence, meta };
        }
        const match = findMatchingPiece(existingPieces, piece);
        const hasDivergence = !!match && diffImportedPiece(match, piece).hasDivergence;
        return { piece, index, isUpdate: !!match, hasDivergence, meta: null };
      }),
    [candidates, existingPieces, fromAccount, rowMeta]
  );
  const updateCount = rows.filter((r) => r.isUpdate).length;
  const newCount = rows.length - updateCount;
  const kindCount = (kind) => rows.filter((r) => r.meta && r.meta.kind === kind).length;
  const pickerCount = rows.filter((r) => r.hasDivergence).length;

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
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19 }}>
            {!fromAccount
              ? "Import pieces"
              : mode === "restore"
              ? "Restore from your account"
              : mode === "review"
              ? "Review changes from your account"
              : "Get changes from your account"}
          </h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="wizard-hint">
            {fromAccount
              ? rows.length === 0
                ? techniqueCandidate
                  ? "Your account has nothing new for your pieces, only technique library changes."
                  : "Your account has nothing new to bring in."
                : mode === "restore"
                ? `Your account has ${rows.length} piece${rows.length === 1 ? "" : "s"}. Choose which to bring onto this device. Nothing here is removed.`
                : `Your account differs from this device for ${rows.length} piece${rows.length === 1 ? "" : "s"}: ` +
                  [
                    kindCount("new") && `${kindCount("new")} new here`,
                    kindCount("take") && `${kindCount("take")} newer in your account`,
                    kindCount("ask") && `${kindCount("ask")} changed in both places`,
                    kindCount("combine") && `${kindCount("combine")} to combine`,
                  ].filter(Boolean).join(", ") +
                  ". Choose which to bring in. Nothing here is removed."
              : rows.length === 0
              ? "This file has no pieces, only your technique library."
              : `Found ${rows.length} piece${rows.length === 1 ? "" : "s"} in this file: ${newCount} new, ${updateCount} matching a piece you already have. Choose which to import; a match updates the existing piece instead of duplicating it.`}
          </p>
          {fromAccount && unreadableCount > 0 && (
            <p className="wizard-hint import-warning">
              {unreadableCount} piece{unreadableCount === 1 ? "" : "s"} in your account couldn't be read and will be skipped.
            </p>
          )}
          {techniqueUnreadable && (
            <p className="wizard-hint import-warning">
              {fromAccount ? "Your account has a technique library" : "This file has a technique library"}, but it couldn't be read, so it won't be
              {fromAccount ? " merged" : " imported"}. Your technique library here stays as it is.
            </p>
          )}
          {techniqueCandidate && techniqueSkippedItems > 0 && (
            <p className="wizard-hint import-warning">
              {techniqueSkippedItems} scale{techniqueSkippedItems === 1 ? "" : "s"} in {fromAccount ? "your account's" : "this file's"} technique library
              couldn't be read and will be skipped. Everything else in it can still be {fromAccount ? "merged" : "imported"}.
            </p>
          )}
          {techniqueCandidate && (
            <div className="checklist" style={{ marginBottom: 14 }}>
              <PieceCheckRow
                piece={{
                  name: "Technique library",
                  composer: techniquePreview
                    ? `${techniqueCandidate.items.length} in ${fromAccount ? "your account" : "the file"}: ${techniquePreview.itemsAdded} new, ${techniquePreview.temposUpdated} newer tempo${techniquePreview.temposUpdated === 1 ? "" : "s"}. Nothing here is removed.`
                    : `${techniqueCandidate.items.length} scales and arpeggios`,
                }}
                checked={includeTechnique}
                onToggle={() => setIncludeTechnique((v) => !v)}
              />
            </div>
          )}
          {rows.length > 0 && <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button className="ghost-btn" onClick={() => setSelected(new Set(candidates.map((_, i) => i)))}>Select all</button>
            <button className="ghost-btn" onClick={() => setSelected(new Set())}>Select none</button>
          </div>}
          {(fromAccount ? pickerCount > 0 : updateCount > 0) && (
            <div style={{ margin: "0 0 14px", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
              <p className="wizard-hint" style={{ margin: "0 0 8px" }}>
                {fromAccount
                  ? "Piece order: your account may arrange your pieces differently than they're arranged here. Which order should the switcher use for the pieces you merge?"
                  : "Piece order: this file may list your pieces in a different order than they're arranged here. Which order should the switcher use for matched pieces?"}
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
                  {fromAccount ? "Use my account's order" : "Use the imported order"}
                </button>
              </div>
            </div>
          )}
          <div className="checklist">
            {rows.map(({ piece, index, isUpdate, hasDivergence, meta }) => (
              <div key={index}>
                <PieceCheckRow
                  piece={
                    fromAccount && meta && meta.kind === "combine"
                      ? { name: piece.name, composer: `Same piece as "${meta.matchName}" here. They'll be combined, and the extra copy in your account is then marked deleted, not erased.` }
                      : piece
                  }
                  checked={selected.has(index)}
                  onToggle={() => toggle(index)}
                  badge={
                    fromAccount && meta ? (
                      <span className={`tag ${meta.kind === "new" ? "tag-new" : "subtle"}`}>
                        {meta.kind === "new"
                          ? "New here"
                          : meta.kind === "take"
                          ? "Newer in your account"
                          : meta.kind === "combine"
                          ? "Same piece, other copy"
                          : meta.held
                          ? "Changed in both places (held)"
                          : "Changed in both places"}
                      </span>
                    ) : (
                      <span className={`tag ${isUpdate ? "subtle" : "tag-new"}`}>{isUpdate ? "Update existing" : "New"}</span>
                    )
                  }
                />
                {hasDivergence && selected.has(index) && (
                  <div style={{ margin: "6px 0 0 34px", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
                    <p className="wizard-hint" style={{ margin: "0 0 8px" }}>
                      {fromAccount
                        ? "This piece's practice progress differs here from what's in your account. Which one should count? Practice logged on either side is kept either way."
                        : "This piece's practice progress differs here from what's in the file. Which one should count?"}
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
                        {fromAccount ? "Use my account's version" : "Use the imported version"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {fromAccount && deletedElsewhere.length > 0 && (
            <div style={{ margin: "14px 0 0", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
              <p className="wizard-hint" style={{ margin: "0 0 8px" }}>
                <strong>Deleted on another device.</strong> Your account has these marked deleted, but they're still here.
                Nothing is removed unless you choose to.
              </p>
              {deletedElsewhere.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", padding: "6px 0" }}>
                  <span style={{ fontSize: 14 }}>
                    {d.name}
                    {d.hasUnsyncedChanges && <span className="tip-line" style={{ display: "block", margin: 0 }}>Has changes here that your account never got.</span>}
                  </span>
                  <button type="button" className="ghost-btn" onClick={() => onDeleteHere && onDeleteHere(d.id)}>
                    Delete it here too
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="ghost-btn" onClick={onCancel}>{fromAccount && rows.length === 0 && !techniqueCandidate ? "Close" : "Cancel"}</button>
          {!(fromAccount && rows.length === 0 && !techniqueCandidate) && (
            <button
              className="primary-btn"
              disabled={selected.size === 0 && !includeTechnique}
              onClick={() => onImport([...selected], ladderChoices, orderChoice, includeTechnique)}
            >
              {fromAccount ? <CloudDownload size={15} /> : <Upload size={15} />}
              {selected.size === 0
                ? fromAccount
                  ? "Merge technique library"
                  : "Import technique library"
                : fromAccount
                ? `${mode === "restore" ? "Restore" : "Bring in"} ${selected.size} piece${selected.size === 1 ? "" : "s"}${includeTechnique ? " and technique" : ""}`
                : `Import ${selected.size} piece${selected.size === 1 ? "" : "s"}${includeTechnique ? " and technique" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
