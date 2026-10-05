import type { PublicSiteContent } from "@repo/contracts";
import { themeStyle } from "./theme";
import { SiteNav } from "./site-nav";
import { SiteFooter } from "./site-footer";
import { renderSection } from "./registry";

/**
 * Composes a tenant site: theme variables on the root, chrome (nav), the
 * org's ordered sections, the footer. Pure composition — every visual
 * decision lives in a section renderer or the theme tokens.
 */
export function SiteRenderer({ content }: { content: PublicSiteContent }) {
  return (
    <div style={themeStyle(content.theme)} className="site-root min-h-[100dvh]">
      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--site-primary)] focus:px-5 focus:py-2 focus:text-[var(--site-on-primary)]"
      >
        Skip to content
      </a>
      <div id="top">
        <SiteNav chrome={content.chrome} nav={content.nav} />
      </div>
      <main>{content.sections.map(renderSection)}</main>
      <SiteFooter footer={content.footer} wordmark={content.chrome.orgName} />
    </div>
  );
}
