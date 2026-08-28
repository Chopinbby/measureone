import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Reusable number input that doesn't fight you while typing         */
/* ------------------------------------------------------------------ */

export function NumberInput({ value, onCommit, onDraftChange, min, max, style, placeholder, acceptPlaceholderOnTab }) {
  const [text, setText] = useState(String(value ?? ""));

  useEffect(() => {
    setText(String(value ?? ""));
  }, [value]);

  const commit = (raw) => {
    if (raw === "" || isNaN(Number(raw))) {
      setText(String(value ?? ""));
      return;
    }
    let n = Number(raw);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    onCommit(n);
  };

  return (
    <input
      type="number"
      style={style}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (onDraftChange) onDraftChange(e.target.value);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.target.value);
        // Tabbing out of an empty field accepts the shown placeholder as if
        // it had been typed — only when it's a real number (never fires for
        // a format hint like "e.g. 10"), and only for callers that opt in,
        // since a placeholder elsewhere may just be an example, not a
        // suggestion worth auto-filling.
        if (e.key === "Tab" && acceptPlaceholderOnTab && text === "" && placeholder && !isNaN(Number(placeholder))) {
          if (onDraftChange) onDraftChange(placeholder);
          commit(placeholder);
        }
      }}
    />
  );
}
