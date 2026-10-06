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

/** Four-point sparkle, the reference's confetti motif. */
export function DoodleSparkle({ className = "", color = "#F5B301" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 1c.9 5.6 2.9 8.5 10 10-7.1 1.5-9.1 4.4-10 10-.9-5.6-2.9-8.5-10-10 7.1-1.5 9.1-4.4 10-10z"
        fill={color}
      />
    </svg>
  );
}

/** Organic blob, for tucking behind photos and avatars. */
export function DoodleBlob({ className = "", color = "#F5B301" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className={className}>
      <path
        d="M43.9,-63.9C56.8,-55.1,67.2,-42.6,73.4,-28.2C79.6,-13.8,81.5,2.5,77.2,16.9C72.9,31.3,62.4,43.8,49.6,53.1C36.8,62.4,21.7,68.5,5.4,71.2C-10.9,73.9,-28.4,73.2,-42.4,65.2C-56.4,57.2,-66.9,41.9,-72.3,25.1C-77.7,8.3,-78,-10,-72.3,-25.6C-66.6,-41.2,-54.9,-54.1,-41.3,-62.8C-27.7,-71.5,-13.9,-76,0.7,-77C15.3,-78,31,-75.5,43.9,-63.9Z"
        transform="translate(100 100)"
        fill={color}
      />
    </svg>
  );
}

/** Hand-drawn loop-the-loop arrow, like the reference hero. */
export function DoodleArrow({ className = "", color = "#F5B301" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 120 60" aria-hidden="true" className={className}>
      <path
        d="M6 50 C 20 10, 48 6, 50 24 C 52 42, 24 44, 34 26 C 44 8, 84 12, 108 22 M96 14 L110 22 L98 32"
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Little smiley, for photo-less faculty avatars. */
export function DoodleFace({ className = "", color = "var(--site-primary)" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="22" cy="26" r="3.4" fill={color} />
      <circle cx="42" cy="26" r="3.4" fill={color} />
      <path d="M20 42 Q 32 52 44 42" fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}
