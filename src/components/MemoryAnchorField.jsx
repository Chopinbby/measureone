import { useState } from "react";

// Same decouple-and-commit-on-blur approach as NumberInput, for the same
// reason: committing a free-text field straight to piece state on every
// keystroke would re-render the whole map grid (and write to localStorage)
// per character. Render with a `key` tied to the item being edited so the
// local buffer resets when the selected item changes.
//
// Labelled "Notes" as of Pass 23, not "Memory anchor". The data was never
// revival-specific — piece.memoryAnchors is durable per-item metadata
// (docs/Data-Model.md), read during ordinary practice as well as revival —
// but the old label described one *use* of the field (a mnemonic hook for
// recall) rather than the field itself, which discouraged writing down the
// ordinary "watch this" observations that come up while learning a piece.
// The component/prop names still say memoryAnchor: renaming those would
// touch every call site and the persisted key itself, which is a data
// migration, not a copy change.
export function MemoryAnchorField({ value, onCommit }) {
  const [text, setText] = useState(value || "");

  return (
    <label className="field">
      <span>Notes — optional</span>
      <textarea
        // Leads with an associative/mnemonic example because that's the
        // kind of note people don't think to write down; the structural
        // ones after it are the original copy, kept because they're the
        // other half of what this field is good for.
        placeholder="e.g. the octave leap in m.24 sounds like the Star Wars theme; same pattern as m.16; watch the left-hand leap"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(text)}
        rows={2}
      />
    </label>
  );
}
