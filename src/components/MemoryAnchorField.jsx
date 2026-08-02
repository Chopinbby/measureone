import { useState } from "react";

// Same decouple-and-commit-on-blur approach as NumberInput, for the same
// reason: committing a free-text field straight to piece state on every
// keystroke would re-render the whole map grid (and write to localStorage)
// per character. Render with a `key` tied to the item being edited so the
// local buffer resets when the selected item changes.
export function MemoryAnchorField({ value, onCommit }) {
  const [text, setText] = useState(value || "");

  return (
    <label className="field">
      <span>Memory anchor — optional</span>
      <textarea
        placeholder="e.g. descending sequence, same pattern as m.16, watch left-hand leap"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(text)}
        rows={2}
      />
    </label>
  );
}
