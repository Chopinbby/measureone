import { formatRange } from "../lib/utils";
import { DIFFICULTY_META } from "../lib/constants";

/* ------------------------------------------------------------------ */
/*  Decorative                                                        */
/* ------------------------------------------------------------------ */

export function ManuscriptDoodle({ className }) {
  return (
    <svg
      className={`manuscript-doodle ${className || ""}`}
      viewBox="0 0 600 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {[18, 32, 46, 60, 74].map((y, i) => (
        <path
          key={i}
          d={`M0,${y} C100,${y - 3} 200,${y + 3} 300,${y - 2} S500,${y + 2} 600,${y}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      ))}
      <text x="10" y="84" fontSize="76" fontFamily="Georgia, serif" fill="var(--ink)">
        &#119070;
      </text>
      <g fill="var(--ink)">
        <circle cx="230" cy="55" r="6" />
        <rect x="234" y="18" width="2" height="38" />
        <circle cx="280" cy="40" r="6" />
        <rect x="284" y="8" width="2" height="34" />
        <circle cx="370" cy="62" r="6" />
        <rect x="374" y="24" width="2" height="40" />
        <circle cx="440" cy="46" r="6" />
        <rect x="444" y="12" width="2" height="36" />
      </g>
      <path d="M225,70 Q300,95 450,68" fill="none" stroke="var(--ink)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function ManuscriptStrip({ chunks, compact }) {
  if (!chunks.length) return null;
  return (
    <div className={`manuscript-strip ${compact ? "compact" : ""}`}>
      {chunks.map((c) => (
        <div
          key={c.id}
          className="manuscript-block"
          style={{ flex: c.measureCount, background: DIFFICULTY_META[c.difficultyLabel].color }}
        >
          {c.recurring && <span className="recurring-dot" />}
          <span className="block-tooltip">
            {formatRange(c.start, c.end)} — {DIFFICULTY_META[c.difficultyLabel].label}
            {c.recurring ? " — recurring" : ""}
          </span>
        </div>
      ))}
      <div className="final-barline" />
    </div>
  );
}
