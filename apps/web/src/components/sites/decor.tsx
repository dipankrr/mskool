/**
 * Decorative primitives of the ujjwal-kids design language (the reference
 * art direction in docs/reference/design/): squiggle underlines on accent
 * words, cloud and wave section dividers, doodle stars. These are the brand
 * art of the preset, drawn inline so they inherit the theme colors.
 *
 * All are aria-hidden; they carry no information.
 */

export function Squiggle({ color = "var(--site-accent)" }: { color?: string }) {
  return (
    <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M2 8 Q 10 2, 20 7 T 40 7 T 60 7 T 80 7 T 100 7 T 118 6"
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Accent word inside a heading, with the hand-drawn underline. */
export function AccentWord({ children }: { children: string }) {
  return (
    <span className="site-squiggle inline-block">
      {children}
      <Squiggle />
    </span>
  );
}

/** Cloud divider: white clouds rising out of a colored block below. */
export function CloudDivider({
  fill = "var(--site-surface)",
  className = "",
}: {
  fill?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 1440 90"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`block w-full ${className}`}
    >
      <path
        d="M0 90 L0 55 C 40 20 110 15 150 45 C 190 5 280 5 320 40 C 360 12 430 10 470 42 C 520 0 610 2 650 40 C 700 8 780 6 820 42 C 870 14 940 12 980 44 C 1030 6 1120 4 1160 40 C 1210 12 1280 14 1320 46 C 1360 22 1410 26 1440 52 L1440 90 Z"
        fill={fill}
      />
    </svg>
  );
}

/** Gentle wave divider between two same-theme sections. */
export function WaveDivider({
  from,
  to,
  flip = false,
}: {
  from: string;
  to: string;
  flip?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 1440 70"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`block w-full ${flip ? "rotate-180" : ""}`}
    >
      <path d="M0 70 L0 40 C 240 0 480 60 720 34 C 960 8 1200 52 1440 26 L1440 70 Z" fill={to} />
      <rect width="1440" height="70" fill="none" />
      <path d="M0 0 L1440 0 L1440 26 C 1200 52 960 8 720 34 C 480 60 240 0 0 40 Z" fill={from} />
    </svg>
  );
}

export function DoodleStar({ className = "", color = "var(--site-accent)" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 2c.6 4.8 2.4 7.4 8 8-5.6.6-7.4 3.2-8 8-.6-4.8-2.4-7.4-8-8 5.6-.6 7.4-3.2 8-8z"
        fill={color}
      />
    </svg>
  );
}
