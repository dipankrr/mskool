import type { TextStyle } from "react-native";

/**
 * The one token system (MOBILE_PLAN "One token system"): spacing on a 4-pt
 * grid, the nine-step type scale, radii, elevation, motion and touch floors.
 * Values are lifted from the owner-approved probe
 * (`docs/design/mobile/prototype/native.html` v3, approved 2026-10-18).
 *
 * Rules: nothing here decides colour (see `brand-admin.ts`); screens and
 * components never hardcode a px value that exists here; styles live in
 * `StyleSheet.create` at the bottom of the file that owns the anatomy.
 */

/** 4-pt grid. `xxs` (2) is reserved for hairline offsets inside dense rows. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/** Horizontal screen gutter — every screen frame uses it (probe: 20). */
export const gutter = spacing.xl;

/** The nine-step type scale. The only font sizes allowed in the app. */
export const fontSize = {
  /** Tab labels. */
  micro: 11,
  /** Pills, uppercase labels, hints. */
  caption: 12,
  /** Metas under names, avatar initials. */
  fine: 13,
  /** Small buttons, large avatar initials. */
  small: 14,
  /** List titles, subs, buttons on CTA. */
  body: 15,
  /** Row names, the CTA label. */
  callout: 16,
  /** Stat-tile numbers. */
  title: 20,
  /** Screen titles (h1). */
  large: 30,
  /** Big money / hero numbers (fees). */
  hero: 34,
} as const;

export const fontWeight = {
  medium: "500",
  semibold: "600",
  bold: "700",
} as const satisfies Record<string, TextStyle["fontWeight"]>;

/**
 * Clash Grotesk (Fontshare) — the app face. Each key names a separate family
 * because the weight lives in the file, not in `fontWeight`. On Android,
 * pairing a custom `fontFamily` with a numeric `fontWeight` silently falls
 * back to the system font — so never set both; the family name alone is the
 * weight. Names are the useFonts keys in `src/app/_layout.tsx` and the file
 * names in `assets/fonts/`.
 */
export const fontFamily = {
  regular: "ClashGrotesk-Regular",
  medium: "ClashGrotesk-Medium",
  semibold: "ClashGrotesk-Semibold",
  bold: "ClashGrotesk-Bold",
} as const;

/** `letterSpacing` in px, tuned at the three sizes that carry it. */
export const tracking = {
  /** Screen titles. */
  tight: -0.6,
  /** Row names. */
  snug: -0.2,
  /** Uppercase section labels (0.07em at 12). */
  label: 0.8,
} as const;

export const radius = {
  /** Fields, search bars. */
  sm: 12,
  /** Stat tiles, mode cards. */
  md: 14,
  /** Cards, grouped lists. */
  lg: 16,
  /** Sheet top corners. */
  xl: 24,
  /** Capsules, pills, avatars. */
  full: 999,
} as const;

/**
 * Soft elevation (string `boxShadow`, New Architecture). Two lights per the
 * probe: floating actions (CTA / saved bar) and the tab bar; the sheet light
 * was added for the sheet surfaces.
 */
export const shadow = {
  floating: "0 10px 24px rgba(16, 24, 40, 0.16)",
  tabBar: "0 14px 34px rgba(16, 24, 40, 0.12)",
  sheet: "0 -12px 40px rgba(16, 24, 40, 0.18)",
} as const;

/**
 * Motion. Press feedback is a scale that never delays the state change; the
 * durations are for transitions that genuinely communicate something.
 */
export const motion = {
  pressScale: 0.98,
  quick: 120,
  base: 200,
  slow: 320,
} as const;

/** Hard floors from MOBILE_PLAN: touch targets and row heights. */
export const touch = {
  /** iOS minimum target (Android floors resolve through hitSlop on top). */
  min: 44,
  /** Comfortable row/target height used by primary controls. */
  comfortable: 48,
  /** Interactive list rows (attendance hint line promises whole-row taps). */
  row: 56,
  /** Roster row height from the approved probe. */
  rosterRow: 62,
} as const;
