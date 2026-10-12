import type { SiteFooter as SiteFooterContent } from "@repo/contracts";

/**
 * The signature footer of the ujjwal-kids preset: the org name set huge in
 * the primary color block, columns of links beneath, copyright last.
 */
export function SiteFooter({
  footer,
  wordmark,
}: {
  footer: SiteFooterContent;
  wordmark: string;
}) {
  return (
    <footer data-region="footer" className="bg-[var(--site-primary)] pb-10 text-[var(--site-on-primary)]">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        {footer.blurb ? (
          <p data-cpath="blurb" className="max-w-[62ch] pt-14 text-base leading-relaxed text-[var(--site-on-primary)]/80">
            {footer.blurb}
          </p>
        ) : null}

        {/* The wordmark displays chrome.orgName, so it resolves to the chrome
            region even though it renders inside the footer. */}
        <div
          aria-hidden="true"
          data-region="chrome"
          data-cpath="orgName"
          className="site-heading mt-8 select-none text-[13.5vw] leading-[0.95] text-[var(--site-on-primary)] md:text-[9rem]"
        >
          {wordmark}
        </div>

        {footer.columns.length > 0 ? (
          <div className="mt-12 grid grid-cols-2 gap-8 border-t border-white/15 pt-10 sm:grid-cols-4">
            {footer.columns.map((col, ci) => (
              <div key={`${col.heading}-${ci}`}>
                <h3 data-cpath={`columns.${ci}.heading`} className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--site-on-primary)]/60">
                  {col.heading}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link, li) => (
                    <li key={`${link.href}-${link.label}-${li}`}>
                      <a
                        data-cpath={`columns.${ci}.links.${li}.label`}
                        href={link.href}
                        className="text-[15px] font-medium text-[var(--site-on-primary)]/85 transition-colors hover:text-[var(--site-on-primary)] hover:underline"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-12 flex flex-col gap-4 border-t border-white/15 pt-8 text-sm text-[var(--site-on-primary)]/70 sm:flex-row sm:items-center sm:justify-between">
          <p data-cpath="copyright">{footer.copyright}</p>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
            {footer.tagline ? <p data-cpath="tagline" className="font-bold">{footer.tagline}</p> : null}
            {footer.social.length > 0 ? (
              <p className="flex gap-4">
                {footer.social.map((s, i) => (
                  <a key={`${s.label}-${i}`} data-cpath={`social.${i}.label`} href={s.href} className="font-semibold hover:text-[var(--site-on-primary)] hover:underline">
                    {s.label}
                  </a>
                ))}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
