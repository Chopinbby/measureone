// A small skull-and-crossbones icon for the Settings "Danger zone" (Pass 130 follow-up).
// lucide-react has a skull but no crossbones, so this is drawn here in lucide's own style
// (24 x 24, 2px round strokes, currentColor) so it sits beside the other icons and takes
// its colour from the text around it. Decorative: the heading it sits in says what it is.
export function SkullCrossbones({ size = 16, strokeWidth = 2, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {/* the crossbones, behind and below the skull, with a knob at each end */}
      <path d="M4.5 16.5 19.5 21.5" />
      <path d="M19.5 16.5 4.5 21.5" />
      <circle cx="4" cy="16" r="1" />
      <circle cx="20" cy="16" r="1" />
      <circle cx="4" cy="22" r="1" />
      <circle cx="20" cy="22" r="1" />
      {/* the skull */}
      <path d="M12 2a6.5 6.5 0 0 0-4 11.6V15a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1.4A6.5 6.5 0 0 0 12 2z" />
      {/* eyes and nose */}
      <circle cx="9.5" cy="8.5" r="1" />
      <circle cx="14.5" cy="8.5" r="1" />
      <path d="m12 11-.6 1.3h1.2z" />
    </svg>
  );
}
