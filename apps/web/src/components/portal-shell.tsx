"use client";

import {
  CalendarCheckIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  MenuIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";

import { ModeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * THE FAMILY SHELL (ADR-008) — the portal's own chrome, deliberately NOT
 * the staff AppShell: a family login has no organizations, no switchers,
 * no permission-gated nav. What it has is CHILDREN — the me payload's
 * ownership list — and the portal's small surface.
 *
 * v1 is intentionally minimal (results now; attendance and fees links
 * arrive with those portal slices). The product principle applies: this is
 * a family's view of their children, not an ERP with fewer buttons.
 */

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/portal/results", label: copy.portal.results, icon: FileTextIcon },
  // The next two render as "not built yet" until their portal slices land;
  // keeping them visible is the honest state (a stub beats a dead end).
  { href: "/portal/attendance", label: copy.portal.attendance, icon: CalendarCheckIcon },
  { href: "/portal/fees", label: copy.portal.fees, icon: ClipboardCheckIcon },
];

function isActiveHref(pathname: string, href: string): boolean {
  return pathname.startsWith(href);
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const me = trpc.me.get.useQuery(undefined);

  const portal = me.data?.portal;
  const childCount = portal?.studentIds.length ?? 0;
  const userName = me.data?.user.name ?? "";

  const nav = (
    <nav aria-label={copy.portal.title} className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActiveHref(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMenuOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-svh bg-background">
      {/* Top bar: who is signed in, the theme, the way out. */}
      <header className="bg-background sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-expanded={menuOpen}
            aria-controls="portal-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <XIcon className="size-5" /> : <MenuIcon className="size-5" />}
            <span className="sr-only">{copy.nav.menu}</span>
          </Button>
          <Link href="/portal/results" className="font-heading font-semibold">
            {copy.portal.title}
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {userName ? (
              <span className="text-muted-foreground hidden text-sm sm:block">
                {copy.nav.signedInAs} {userName}
                {childCount > 1 ? (
                  <span className="text-muted-foreground/70"> · {childCount} children</span>
                ) : null}
              </span>
            ) : null}
            <ModeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <aside
          id="portal-nav"
          className={cn(
            "md:flex md:w-56 md:shrink-0",
            menuOpen ? "block" : "hidden",
          )}
        >
          {nav}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
