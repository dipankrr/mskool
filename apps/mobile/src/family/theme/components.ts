import { palette } from "./palette";
import { color, radius, space, tone } from "./roles";

/**
 * Layer 3 of the family theme: one block per component. A component reads
 * ONLY its own block (plus roles for text), so redesigning one component is
 * a change to one block here, or a swap of that one component file, never a
 * screen change. Keep each block small and named by what it styles.
 */
export const components = {
  screen: {
    gutter: space.xl,
    bg: color.canvas,
    wash: color.wash,
    sectionGap: space.xxl,
    statusBarBg: palette.statusBar,
  },

  header: {
    paddingTop: space.sm,
    gap: space.xs,
    titleVariant: "title",
    contextColor: color.muted,
  },

  button: {
    radius: radius.full,
    gap: space.sm,
    iconSize: 18,
    pressedScale: 0.97,
    disabledOpacity: 0.45,
    height: { lg: 54, md: 46, sm: 36 },
    paddingX: { lg: space.xxl, md: space.xl, sm: space.lg },
    variant: {
      primary: { bg: color.accent, fg: color.onAccent, border: null },
      secondary: { bg: color.surfaceMuted, fg: color.ink, border: null },
      quiet: { bg: "transparent", fg: color.ink, border: null },
    },
  },

  field: {
    height: 56,
    radius: radius.lg,
    bg: color.surfaceMuted,
    focusBorder: color.ink,
    errorBorder: tone.critical.fg,
    paddingX: space.lg,
    gap: space.xs,
    placeholder: color.faint,
    text: color.ink,
  },

  card: {
    radius: radius.xl,
    bg: color.surfaceMuted,
    /** A hairline edge. Set width to 0 for no border. */
    border: { width: 1, color: color.hairline },
    /** A card that needs attention (the next exam day). */
    highlightBorder: { width: 1.5, color: color.ink },
    padding: space.xl,
    gap: space.md,
    pressedBg: color.surfaceSunk,
  },

  row: {
    radius: radius.lg,
    bg: color.surfaceMuted,
    border: { width: 1, color: color.hairline },
    pressedBg: color.surfaceSunk,
    paddingX: space.xl,
    paddingY: space.lg,
    minHeight: 72,
    gap: space.md,
    /** Space between stacked rows. */
    stackGap: space.md,
    chevronColor: color.faint,
  },

  segment: {
    height: 52,
    padding: 5,
    radius: radius.full,
    trackBg: color.surfaceMuted,
    activeBg: color.accent,
    activeFg: color.onAccent,
    fg: color.ink,
  },

  pill: {
    radius: radius.full,
    height: 28,
    paddingX: space.md,
    gap: space.xs,
    tone,
  },

  /** The attendance month grid. Each look maps to a fill and a text colour. */
  calendar: {
    gap: 6,
    cellRadius: radius.sm,
    todayBorder: color.ink,
    look: {
      present: { bg: tone.positive.bg, fg: tone.positive.fg },
      absent: { bg: tone.critical.bg, fg: tone.critical.fg },
      late: { bg: tone.caution.bg, fg: tone.caution.fg },
      halfDay: { bg: tone.caution.bg, fg: tone.caution.fg },
      leave: { bg: tone.info.bg, fg: tone.info.fg },
      holiday: { bg: "transparent", fg: color.faint },
      notMarked: { bg: color.surfaceSunk, fg: color.muted },
      upcoming: { bg: "transparent", fg: color.muted },
      notEnrolled: { bg: "transparent", fg: color.faint },
      none: { bg: "transparent", fg: color.faint },
    },
  },

  /** The fee months strip: one chip per month, tinted by its state. */
  monthChip: {
    width: 64,
    height: 64,
    radius: radius.md,
    gap: space.sm,
    selectedBorder: color.ink,
    tone,
  },

  rank: {
    youBg: color.surface,
    youBorder: color.ink,
    medalBg: color.accent,
    medalFg: color.onAccent,
  },

  number: {
    unitColor: color.muted,
  },

  tabBar: {
    height: 68,
    radius: radius.full,
    bg: color.surface,
    padding: 6,
    margin: space.lg,
    shadow: "0 10px 30px rgba(27, 27, 26, 0.10)",
    border: color.hairline,
    activeBg: color.accent,
    activeFg: color.onAccent,
    fg: color.muted,
    iconSize: 22,
    /** The pill behind the active icon. An exact radius (half the height):
     *  Android can draw a 999 radius square when the background toggles. */
    iconPill: { width: 56, height: 32, radius: radius.md },
  },

  sheet: {
    bg: color.surface,
    radius: radius.xl,
    padding: space.xl,
    grabber: palette.stoneDeep,
  },

  skeleton: {
    bg: color.surfaceMuted,
    highlight: color.surfaceSunk,
    radius: radius.sm,
    pulseMs: 900,
  },

  state: {
    gap: space.md,
    paddingY: space.huge,
    mascotSize: 96,
  },

  mascot: {
    body: palette.bookie.body,
    depth: palette.bookie.depth,
    ink: palette.bookie.ink,
    white: palette.bookie.white,
  },
} as const;
