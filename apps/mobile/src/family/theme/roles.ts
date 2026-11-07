import { palette, radii } from "./palette";

/**
 * Layer 2 of the family theme: what a value MEANS. Components and blocks in
 * `components.ts` read these, never the palette.
 */

export const color = {
  /** Behind everything. */
  canvas: palette.white,
  /** Raised things on the canvas: tab bar, sheets. */
  surface: palette.white,
  /** Rows, cards, segment tracks. */
  surfaceMuted: palette.stone,
  /** Pressed rows and skeleton bars. */
  surfaceSunk: palette.stoneDeep,
  ink: palette.ink,
  inkSoft: palette.inkSoft,
  muted: palette.muted,
  faint: palette.faint,
  hairline: palette.hairline,
  scrim: palette.scrim,
  /** Primary actions and the active state. */
  accent: palette.ink,
  onAccent: palette.white,
  /** One warm highlight, used sparingly. */
  highlight: palette.coral,
  /** Screen background wash; `null` means flat canvas. */
  wash: `linear-gradient(180deg, ${palette.washTop} 0%, ${palette.washMid} 42%, ${palette.washBottom} 100%)` as
    | string
    | null,
} as const;

/** Status meaning. Domain states (present, overdue…) map to these in screens. */
export const tone = {
  positive: { fg: palette.green, bg: palette.greenTint },
  caution: { fg: palette.amber, bg: palette.amberTint },
  critical: { fg: palette.red, bg: palette.redTint },
  info: { fg: palette.blue, bg: palette.blueTint },
  neutral: { fg: palette.slate, bg: palette.slateTint },
} as const;

export type Tone = keyof typeof tone;

/** 4-pt grid. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = radii;

/** Text styles by purpose. `font` names a weight; the script picks the file. */
export const type = {
  display: { size: 40, font: "bold", tracking: -1.6, leading: "tight" },
  title: { size: 28, font: "bold", tracking: -0.9, leading: "tight" },
  heading: { size: 20, font: "bold", tracking: -0.4, leading: "tight" },
  label: { size: 16, font: "semibold", tracking: -0.2, leading: "normal" },
  body: { size: 16, font: "regular", tracking: 0, leading: "normal" },
  bodyStrong: { size: 16, font: "semibold", tracking: 0, leading: "normal" },
  meta: { size: 14, font: "medium", tracking: 0, leading: "normal" },
  caption: { size: 12, font: "semibold", tracking: 0.6, leading: "normal" },
  number: { size: 32, font: "bold", tracking: -1, leading: "tight" },
  numberHero: { size: 56, font: "bold", tracking: -2.4, leading: "tight" },
} as const;

export type TypeVariant = keyof typeof type;
export type FontWeightName = "regular" | "medium" | "semibold" | "bold";

/** Motion: one place to tune how the family side feels. */
export const motion = {
  pressScale: 0.97,
  quick: 140,
  base: 220,
  slow: 360,
  /** Delay between rows appearing in a list. */
  stagger: 40,
  /** Rows only stagger this many; the rest appear with the last. */
  staggerMax: 8,
  /** How far an entering item rises, in points. */
  rise: 8,
  countUp: 700,
  spring: { damping: 18, stiffness: 220, mass: 1 },
} as const;

/** Touch floors. */
export const touch = {
  min: 44,
  row: 64,
} as const;
