import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Reusable number input that doesn't fight you while typing         */
/* ------------------------------------------------------------------ */

export function NumberInput({ value, onCommit, min, max, style, placeholder }) {
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
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.target.value);
      }}
    />
  );
}
