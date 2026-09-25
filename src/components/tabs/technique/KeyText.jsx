// Renders a key or scale name with its ♯/♭ in a font that has a tight
// glyph for them. Inter has no ♭, so the browser falls back to a system
// font whose ♭ sits in a full-em box with a wide blank left side — it
// read as "E ♭ major" (a visible gap). Since the Pass 103 follow-up the
// app-wide font list names Helvetica Neue / Segoe UI Symbol after Inter and
// Fraunces, which fixes that everywhere (piece names, placeholders); .tq-acc
// here does the same thing explicitly. Still needed for the other reason:
// everything is wrapped in one span so a flex parent with a `gap` (like
// .tq-title) treats the name as a single item — otherwise the gap lands
// between "E" and "♭".
export function KeyText({ text }) {
  const parts = String(text).split(/([♯♭])/);
  return (
    <span className="tq-keytext">
      {parts.map((p, i) => (p === "♯" || p === "♭" ? <span key={i} className="tq-acc">{p}</span> : p))}
    </span>
  );
}
