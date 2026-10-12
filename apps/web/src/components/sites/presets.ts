import type { PublicSiteContent } from "@repo/contracts";

/**
 * Preset: "ujjwal-kids" (ADR-041) — the first template in the section
 * library, art-directed from the reference in
 * docs/reference/design/school_landing_design.webp. A preset is DATA: theme
 * tokens + the function that builds its sample page. Renderers are shared
 * across presets.
 *
 * The sample page is owned by the template and written generically — it
 * never reads any org's row (a template must not derive from its children).
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

/**
 * The template catalog the empty state offers. One entry today; a second
 * preset is a new entry here (theme + its own starter builder, renderers
 * shared) with zero editor changes. `id` is what `org_public_sites.preset`
 * stores; `version` is stamped onto the row at creation so template updates
 * can be offered to existing sites later (opt-in, never automatic).
 */
export interface PresetDescriptor {
  id: string;
  name: string;
  blurb: string;
  version: number;
  theme: PublicSiteContent["theme"];
}

export const PRESETS: PresetDescriptor[] = [
  {
    id: "ujjwal-kids",
    name: "Playful Kindergarten",
    blurb: "Cheerful kindergarten look — deep green, coral CTAs, warm cream sections.",
    version: 1,
    theme: UJJWAL_KIDS_THEME,
  },
];

/**
 * Font tokens are resolved to loaded next/font variables by theme.tsx; the
 * preset only carries the token NAMES.
 */
