import type { PublicSiteContent, SectionKey } from "@repo/contracts";

/**
 * Preset: "ujjwal-kids" (ADR-041) — the first template in the section
 * library, art-directed from the reference in
 * docs/reference/design/school_landing_design.webp and ported onto Ujjwal
 * Kids World's content. A preset is DATA: default theme tokens + default
 * section order. Renderers are shared across presets.
 */

/** Fallback theme when a site row predates a token or a new token lands. */
export const UJJWAL_KIDS_THEME: PublicSiteContent["theme"] = {
  colorPrimary: "#155E4B", // deep forest green (nav, footer, dark sections)
  colorAccent: "#E8542F", // coral (primary CTAs, highlights)
  colorSurface: "#FBF6DC", // warm cream page background
  colorSurfaceAlt: "#FDFBF0", // lighter cream for alternating sections
  colorInk: "#1E3A34", // deep green-black body text
  colorOnPrimary: "#FDFBF0", // cream text on green
  fontHeading: "Baloo 2",
  fontBody: "Nunito",
};

/** The section order the preset ships with; the org's row can reorder it. */
export const UJJWAL_KIDS_SECTION_ORDER: SectionKey[] = [
  "hero",
  "stats",
  "about",
  "cardGrid",
  "cardGrid",
  "faculty",
  "gallery",
  "faq",
  "ctaBanner",
  "contact",
];

/**
 * Font tokens are resolved to loaded next/font variables by theme.tsx; the
 * preset only carries the token NAMES.
 */
