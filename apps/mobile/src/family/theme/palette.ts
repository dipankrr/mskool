/**
 * Layer 1 of the family theme: raw values. The ONLY place a hex code, a
 * radius number or a font file name for the family side lives. Nothing
 * outside `family/theme/` imports this file; components read roles
 * (`roles.ts`) and their own block (`components.ts`) through
 * `useFamilyTheme()`.
 *
 * Today's values follow the simple reference
 * (`docs/design/mobile/student-side-theme-ref-only.png`): white ground, warm
 * grey rows, near-black pills, very heavy grotesk type. The premium pass
 * changes values here, or one component block at a time.
 */

import { bookie } from "../../theme/brand-bookie";

export const palette = {
  white: "#FFFFFF",
  ink: "#1B1B1A",
  inkSoft: "#3A3A38",
  muted: "#6E6E6A",
  faint: "#A3A39E",
  stone: "#F3F3F0",
  stoneDeep: "#E9E9E4",
  hairline: "rgba(27, 27, 26, 0.08)",
  scrim: "rgba(27, 27, 26, 0.40)",

  green: "#1F7A4A",
  greenTint: "#E6F4EC",
  amber: "#A15C07",
  amberTint: "#FDF3E2",
  red: "#C2410C",
  redTint: "#FDEDE6",
  slate: "#55565A",
  slateTint: "#EFEFEC",
  blue: "#2F6BFF",
  blueTint: "#EAF0FF",

  /** The reference's stamp colour, kept for highlights. */
  coral: "#F2705A",
  coralTint: "#FDE9E4",
  coralEdge: "#FBDCD3",
  grape: "#7A4DE8",
  grapeTint: "#EFE8FF",
  greenEdge: "#CFEBDC",
  blueEdge: "#D5E1FF",
  /** The teacher's sticky note. */
  note: "#FFF4B8",
  noteInk: "#3B3320",
  noteMuted: "#7A6A33",

  /** The faint cool-to-warm wash behind screens. */
  washTop: "#EEF3FF",
  washMid: "#FFFFFF",
  washBottom: "#FFF6EF",
  /** Behind the status bar while content scrolls under it. */
  statusBar: "rgba(238, 243, 255, 0.94)",

  bookie,
} as const;

export const radii = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  full: 999,
} as const;

/** Font files per script. A new script adds its family here. */
export const fontFiles = {
  latin: {
    regular: "ClashGrotesk-Regular",
    medium: "ClashGrotesk-Medium",
    semibold: "ClashGrotesk-Semibold",
    bold: "ClashGrotesk-Bold",
  },
} as const;

/**
 * Line height per script, as a multiple of the font size. Indian scripts
 * need more room for marks above and below the line (about 1.5).
 */
/** The handwriting face for Bookie's short notes (Caveat, OFL). Latin only. */
export const handFont = "Caveat-Bold";

export const lineHeightScale = {
  latin: { tight: 1.08, normal: 1.32 },
} as const;
