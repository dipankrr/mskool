import type { SiteTheme } from "@repo/contracts";

/**
 * Turns a site's theme tokens into the CSS variables every section reads.
 * One place, so a new token is added to SiteTheme and lands here once.
 *
 * Fonts: the (public) layout exposes each preset font as a next/font
 * variable (--site-font-baloo2, --site-font-nunito). A theme token naming a
 * loaded font resolves to that variable first; anything else falls through
 * to the literal family name (a future preset ships its own next/font and
 * adds its own mapping here).
 */
const LOADED_FONTS: Record<string, string> = {
  "Baloo 2": "var(--site-font-baloo2)",
  Nunito: "var(--site-font-nunito)",
};

function fontValue(name: string): string {
  const loaded = LOADED_FONTS[name];
  return loaded ? `${loaded}, '${name}'` : `'${name}'`;
}

export function themeStyle(theme: SiteTheme): React.CSSProperties {
  return {
    "--site-primary": theme.colorPrimary,
    "--site-accent": theme.colorAccent,
    "--site-surface": theme.colorSurface,
    "--site-surface-alt": theme.colorSurfaceAlt,
    "--site-ink": theme.colorInk,
    "--site-on-primary": theme.colorOnPrimary,
    "--site-font-display": `${fontValue(theme.fontHeading)}, system-ui, sans-serif`,
    fontFamily: `${fontValue(theme.fontBody)}, system-ui, sans-serif`,
    color: "var(--site-ink)",
    background: "var(--site-surface)",
  } as React.CSSProperties;
}
