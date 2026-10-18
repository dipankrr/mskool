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
  redTint: "#FEF3F2",
  amber: "#B54708",
  amberTint: "#FFFAEB",
  slate: "#475467",
  slateTint: "#F2F4F7",
  field: "#ECEEF3",
  chip: "#E9EDF3",
  chevron: "#98A2B3",
  scrim: "rgba(16, 24, 40, 0.45)",
  grabber: "#D5DAE2",
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
  /** Input and segmented fills. */
  field: palette.field,
  /** Neutral avatar and chip fills. */
  chip: palette.chip,
  /** Disclosure chevrons (decorative — contrast floor waived). */
  chevron: palette.chevron,
  /** Modal scrim. */
  scrim: palette.scrim,
  /** Sheet grabber. */
  grabber: palette.grabber,
  tone,
} as const;

export type Tone = keyof typeof colors.tone;
