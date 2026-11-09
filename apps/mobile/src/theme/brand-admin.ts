/**
 * The staff shell's palette — "restrained" per MOBILE_PLAN: one accent
 * (emerald, the app's own action colour and the colour of "present"), and
 * semantic red / amber / slate used strictly as status information, never
 * decoration. Values are the owner-approved probe set
 * (`docs/design/mobile/prototype/native.html` v3, approved 2026-10-18).
 *
 * `brand-family.ts` (step 9) reuses these role names with its own emphasis;
 * both sit on `tokens.ts`. Components read semantic roles from here and never
 * the raw `palette`.
 */

/** Raw approved values. Do not import outside the theme. */
const palette = {
  canvas: "#F2F3F7",
  ink: "#101828",
  muted: "#5D6674",
  hairline: "rgba(16, 24, 40, 0.08)",
  white: "#FFFFFF",
  emerald: "#0F7A44",
  emeraldDeep: "#0B6B3A",
  emeraldTint: "#E8F5EE",
  /** Active-tab wash; the only translucent accent fill. */
  emeraldStrong: "rgba(15, 122, 68, 0.12)",
  red: "#B42318",
  redSoftFg: "rgba(180, 35, 24, 0.2)",
  redTint: "#FEF3F2",
  /** A due that exists but isn't owed yet: red, held back. */
  redSoft: "rgba(180, 35, 24, 0.10)",
  /** Marks "now" across a grid (the year view's current month). */
  blueWash: "rgba(21, 112, 239, 0.10)",
  /** A future month already paid: green, held back like a due-later red. */
  emeraldSoft: "rgba(15, 122, 68, 0.14)",
  emeraldSoftFg: "rgba(15, 122, 68, 0.4)",
  /** A tick or cross on a solid year-view box: present, not shouting. */
  glyphSoft: "rgba(255, 255, 255, 0.6)",
  amber: "#B54708",
  amberTint: "#FFFAEB",
  slate: "#475467",
  slateTint: "#F2F4F7",
  field: "#ECEEF3",
  chip: "#E9EDF3",
  chevron: "#98A2B3",
  scrim: "rgba(16, 24, 40, 0.45)",
  grabber: "#D5DAE2",
  /** Fills, text and rules on the student profile's coloured band. */
  bandWash: "rgba(255, 255, 255, 0.14)",
  bandMuted: "rgba(255, 255, 255, 0.75)",
  bandLine: "rgba(255, 255, 255, 0.18)",
} as const;

/**
 * Status tones: every piece of colour that means something is one of these
 * four. Mapping domain statuses (present / late / …) onto tones happens in
 * the domain component, not here.
 */
const tone = {
  positive: { fg: palette.emeraldDeep, bg: palette.emeraldTint },
  caution: { fg: palette.amber, bg: palette.amberTint },
  critical: { fg: palette.red, bg: palette.redTint },
  neutral: { fg: palette.slate, bg: palette.slateTint },
} as const;

export const colors = {
  /** App background behind cards. */
  canvas: palette.canvas,
  /** Cards, sheets, solid (Android) tab bar. */
  surface: palette.white,
  /** Primary text. */
  ink: palette.ink,
  /** Secondary text: subs, metas, hints. */
  muted: palette.muted,
  /** 1px separators on surfaces. */
  hairline: palette.hairline,
  /** The one accent — primary actions, active tab. */
  accent: palette.emerald,
  /** Accent text/icons on tints and white. */
  accentDeep: palette.emeraldDeep,
  /** Accent-tinted fills. */
  accentTint: palette.emeraldTint,
  /** Selected-pill wash on the tab bar. */
  accentStrong: palette.emeraldStrong,
  /** Text/icons on accent fills. */
  onAccent: palette.white,
  /** Segmented and quiet fills. */
  field: palette.field,
  /** Text inputs: the grey fill, outlined so they never melt into the grey page. */
  input: palette.field,
  inputLine: "rgba(16, 24, 40, 0.16)",
  /** Neutral avatar and chip fills. */
  chip: palette.chip,
  /** Disclosure chevrons (decorative — contrast floor waived). */
  chevron: palette.chevron,
  /** Modal scrim. */
  scrim: palette.scrim,
  /** A future due not paid yet: lighter than an owed one, never mistaken for none. */
  dueLater: palette.redSoft,
  dueLaterFg: palette.redSoftFg,
  /** A future month already paid, and its tick. */
  paidLater: palette.emeraldSoft,
  paidLaterFg: palette.emeraldSoftFg,
  /** Ticks and crosses on solid year-view boxes. */
  glyphSoft: palette.glyphSoft,
  /** The current month's column in the year view. */
  nowWash: palette.blueWash,
  /**
   * The student profile's header band: deep emerald while studying, slate once
   * they've left, with white text, a translucent wash for chips and a faint rule.
   */
  band: palette.emeraldDeep,
  bandLeft: palette.slate,
  onBand: palette.white,
  onBandMuted: palette.bandMuted,
  onBandWash: palette.bandWash,
  onBandLine: palette.bandLine,
  /** Sheet grabber. */
  grabber: palette.grabber,
  tone,
} as const;

export type Tone = keyof typeof colors.tone;
