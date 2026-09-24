import { Star } from "lucide-react";

// The lucide Star, never a text star (those render off-center). Filled via
// CSS (.tq-star.on svg) when on.
export function StarButton({ on, onClick, label }) {
  return (
    <button
      type="button"
      className={`tq-star${on ? " on" : ""}`}
      aria-pressed={!!on}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Star size={16} />
    </button>
  );
}
