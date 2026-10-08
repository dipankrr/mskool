"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { SiteChrome, SiteLink } from "@repo/contracts";

/**
 * The tenant site's header: a slim contact strip that scrolls away, then a
 * FLOATING GLASS navbar (the owner's explicit ask) — a detached pill with
 * backdrop blur that follows the scroll. Glass is a labeled web
 * approximation (see site.css); reduced-transparency falls back to solid.
 */
export function SiteNav({ chrome, nav }: { chrome: SiteChrome; nav: SiteLink[] }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const hasTopbar = Boolean(
    chrome.topbar && (chrome.topbar.phone || chrome.topbar.email || chrome.topbar.hours),
  );

  return (
    <header className="relative z-40">
      {hasTopbar ? (
        <div data-region="chrome" className="bg-[color-mix(in_srgb,var(--site-primary)_88%,black)] px-4 py-1.5 text-center text-xs text-[var(--site-on-primary)] sm:text-sm">
          <span className="inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
            {chrome.topbar?.phone ? (
              <a
                data-cpath="topbar.phone"
                href={`tel:${chrome.topbar.phone.replace(/\s/g, "")}`}
                className="hover:underline"
              >
                {chrome.topbar.phone}
              </a>
            ) : null}
            {chrome.topbar?.email ? (
              <a data-cpath="topbar.email" href={`mailto:${chrome.topbar.email}`} className="hidden hover:underline sm:inline">
                {chrome.topbar.email}
              </a>
            ) : null}
            {chrome.topbar?.hours ? <span data-cpath="topbar.hours">{chrome.topbar.hours}</span> : null}
          </span>
        </div>
      ) : null}

      {/* The floating pill: below the contact strip at rest, tightens to the
          top edge once you scroll. */}
      <div
        className={`pointer-events-none fixed left-1/2 z-50 w-[min(1120px,94vw)] -translate-x-1/2 transition-all duration-300 ${
          scrolled ? "top-3" : hasTopbar ? "top-10" : "top-3"
        }`}
      >
        <nav
          aria-label="Main"
          className={`site-glass pointer-events-auto flex items-center justify-between gap-4 py-2 pl-4 pr-2 transition-shadow sm:pl-5 ${
            scrolled ? "shadow-[0_18px_50px_rgba(0,0,0,0.35)]" : ""
          }`}
        >
          <a href="#top" data-region="chrome" data-cpath="logoUrl" className="flex items-center gap-2.5">
            {chrome.logoUrl ? (
              <Image
                src={chrome.logoUrl}
                alt={`${chrome.orgName} logo`}
                width={40}
                height={40}
                className="size-10 rounded-full bg-white object-contain p-0.5"
              />
            ) : null}
            <span data-cpath="orgName" className="site-heading text-lg text-[var(--site-on-primary)] sm:text-xl">
              {chrome.orgName}
            </span>
          </a>

          <div data-region="nav" className="hidden items-center gap-6 lg:flex">
            {nav.map((item, i) => (
              <a
                key={item.href + item.label}
                data-cpath={`${i}.label`}
                href={item.href}
                className="site-nav-link text-[15px] font-semibold text-[var(--site-on-primary)]/85"
              >
                {item.label}
              </a>
            ))}
          </div>

          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-[var(--site-on-primary)] transition-colors hover:bg-white/20 lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </nav>

        {open ? (
          <div data-region="nav" className="site-glass pointer-events-auto mt-2 rounded-3xl p-3 lg:hidden">
            {nav.map((item, i) => (
              <a
                key={item.href + item.label}
                data-cpath={`${i}.label`}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-3 text-base font-semibold text-[var(--site-on-primary)]/90 transition-colors hover:bg-white/10"
              >
                {item.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
