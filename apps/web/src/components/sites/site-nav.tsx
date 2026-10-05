"use client";

import { Menu, Phone, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { SiteChrome, SiteLink } from "@repo/contracts";

/**
 * The tenant site's header: optional topbar (phone/email/hours), sticky nav
 * on the primary color, and a mobile menu. The only interactive chrome on
 * the public path — isolated as a client leaf, everything else stays a
 * server component.
 */
export function SiteNav({ chrome, nav }: { chrome: SiteChrome; nav: SiteLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="relative z-40">
      {chrome.topbar && (chrome.topbar.phone || chrome.topbar.email || chrome.topbar.hours) ? (
        <div className="bg-[color-mix(in_srgb,var(--site-primary)_88%,black)] px-4 py-1.5 text-center text-xs text-[var(--site-on-primary)] sm:text-sm">
          <span className="inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
            {chrome.topbar.phone ? (
              <a href={`tel:${chrome.topbar.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 hover:underline">
                <Phone className="size-3.5" strokeWidth={2} /> {chrome.topbar.phone}
              </a>
            ) : null}
            {chrome.topbar.email ? (
              <a href={`mailto:${chrome.topbar.email}`} className="hidden hover:underline sm:inline">
                {chrome.topbar.email}
              </a>
            ) : null}
            {chrome.topbar.hours ? <span>{chrome.topbar.hours}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="sticky top-0 bg-[var(--site-primary)] shadow-[0_2px_16px_rgba(0,0,0,0.18)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:h-[72px] md:px-6">
          <a href="#top" className="flex items-center gap-2.5">
            {chrome.logoUrl ? (
              <Image src={chrome.logoUrl} alt={`${chrome.orgName} logo`} width={44} height={44} className="size-11 rounded-full bg-white object-contain p-1" />
            ) : null}
            <span className="site-heading text-xl text-[var(--site-on-primary)] md:text-2xl">
              {chrome.orgName}
            </span>
          </a>

          <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
            {nav.map((item) => (
              <a
                key={item.href + item.label}
                href={item.href}
                className="text-[15px] font-semibold text-[var(--site-on-primary)]/85 transition-colors hover:text-[var(--site-on-primary)]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full text-[var(--site-on-primary)] transition-colors hover:bg-white/10 lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open ? (
          <nav aria-label="Mobile" className="border-t border-white/10 bg-[var(--site-primary)] px-4 pb-4 lg:hidden">
            {nav.map((item) => (
              <a
                key={item.href + item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-3 text-base font-semibold text-[var(--site-on-primary)]/90 hover:bg-white/10"
              >
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
