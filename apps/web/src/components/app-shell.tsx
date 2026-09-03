"use client";

import {
  Building2Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  GraduationCapIcon,
  HomeIcon,
  LandmarkIcon,
  MenuIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { ModeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
// Type-only, per the CONVENTIONS.md sanction — nothing reaches the bundle.
import type { Permission } from "@repo/authz";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ActiveContextGate,
  useActiveContextState,
} from "@/features/session/active-context";
import {
  BranchSwitcher,
  OrgSwitcher,
  SessionPicker,
} from "@/features/session/switchers";
import { branchWord, copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * THE SHELL. Sidebar on a desktop, bottom tabs on a phone.
 *
 * Bottom tabs ra/orgs/{o}/schools/{s}/classes/{c}/sections/{x} nestingther than a hamburger for navigation, because that is what these
 * users already know: every Android app they use daily puts its destinations within
 * thumb reach at the bottom of the screen. A drawer hides navigation behind a
 * gesture that has to be learned, and this app is used by people who did not choose
 * to use software.
 *
 * **The breakpoint is 1024px, and the switch is CSS.** Both branches are in the
 * markup; `hidden lg:flex` and `lg:hidden` decide which is painted. That matters
 * more here than anywhere else in the app — measuring the viewport in JavaScript
 * would make the server render one navigation and the client another, and React
 * would throw the whole tree away on hydration.
 *
 * `Sidebar` is used with `collapsible="none"`, which is what makes this possible:
 * in that mode it renders a plain flex column and never consults `useIsMobile`,
 * whose 768px breakpoint would otherwise fight the 1024px one and turn the sidebar
 * into a second, competing drawer between 768 and 1023px.
 *
 * **The shell renders in every state, including the failures.** It reads
 * `useActiveContextState()` rather than the resolved context, so a cold database
 * start shows chrome with skeletons in the switcher slots instead of a blank page —
 * `ActiveContextGate` holds back only the page content.
 */

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Hide the destination when the caller lacks this permission.
   *
   * Not cosmetic. A class-scoped teacher holds `class:read` and `section:read` but not
   * `school:read`, so Branches was a dead end for them: the list 403s and the screen
   * can only apologise. A navigation item that cannot work is worse than an absent one,
   * for the same reason `PermissionGate` hides actions rather than disabling them.
   *
   * An array is ANY-OF: the item shows when at least one permission is held. Fees is
   * the reason this exists — its five tabs gate on five different reads, and a
   * class teacher holding only `student_fee_assignment:read` still needs the area
   * reachable for the Dues tab, while a vice-principal with `fee_report:read` alone
   * still needs it for the Ledger.
   */
  permission?: Permission | readonly Permission[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: copy.nav.home, icon: HomeIcon },
  {
    href: "/branches",
    label: copy.nav.branches,
    icon: Building2Icon,
    permission: "school:read",
  },
  {
    href: "/sessions",
    label: copy.nav.sessions,
    icon: CalendarDaysIcon,
    permission: "academic_year:read",
  },
  {
    href: "/classes",
    label: copy.nav.classes,
    icon: GraduationCapIcon,
    permission: "class:read",
  },
  {
    href: "/students",
    label: copy.nav.students,
    icon: UsersIcon,
    permission: "student:read",
  },
  {
    href: "/attendance/calendar",
    label: copy.nav.attendance,
    icon: CalendarCheckIcon,
    permission: "attendance:read",
  },
  {
    href: "/fees/dues",
    label: copy.nav.fees,
    icon: LandmarkIcon,
    /*
     * Any-of: the area's five tabs gate on five reads (structure, assignment,
     * payment:create, payment:read, report). Anyone who can see ONE tab needs
     * the entry; the /fees redirect + tabs filter the rest server-independently.
     */
    permission: [
      "fee_structure:read",
      "student_fee_assignment:read",
      "fee_payment:read",
      "fee_report:read",
    ] as const satisfies readonly Permission[],
  },
  { href: "/profile", label: copy.nav.profile, icon: UserIcon },
];

/** Exact match for Home; prefix match elsewhere so /classes/<id> keeps Classes lit. */
function isActiveHref(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const state = useActiveContextState();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const ready = state.status === "ready";

  /**
   * The label for Branches follows what the user can see: one school is "School",
   * several are "Branches". Falls back to the plural while `me` is still loading,
   * since guessing wrong for a moment is worse than being generic.
   *
   * Destinations the caller has no permission to read are dropped entirely. While
   * `me` is still resolving nothing is dropped, because the permission list is not
   * known yet and a nav bar that reshuffles as it loads is worse than one that waits.
   * A permission may be an array — ANY-OF, the Fees case (see NavItem).
   */
  const schoolCount = ready ? state.value.schools.length : 0;
  const hasSome = (permission?: NavItem["permission"]): boolean => {
    if (!ready) return true;
    if (!permission) return true;
    // Array.isArray does not narrow `readonly Permission[]`, so discriminate on the single case.
    if (typeof permission === "string") {
      return state.value.has(permission);
    }
    return permission.some((p) => state.value.has(p));
  };
  const navItems = NAV_ITEMS.filter((item) => !ready || hasSome(item.permission)).map((item) =>
    item.href === "/branches" && ready
      ? { ...item, label: branchWord(schoolCount, true) }
      : item,
  );

  /** A route change closes the sheet; leaving it open over the new page is a trap. */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  /** What the mobile menu button says, so its purpose is not a mystery icon. */
  const contextLabel = !ready
    ? copy.common.loading
    : [
        state.value.schools.find((s) => s.id === state.value.schoolId)?.code ??
          (state.value.schools.length > 1 ? copy.nav.chooseBranch : null),
        state.value.activeSession?.name,
      ]
        .filter(Boolean)
        .join(" · ") || copy.nav.menu;

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar
          collapsible="none"
          className="sticky top-0 hidden h-svh border-r lg:flex"
        >
          <SidebarHeader className="gap-2">
            <span className="font-heading px-2 text-lg font-semibold tracking-tight">
              {copy.app.name}
            </span>
            {ready ? (
              <OrgSwitcher className="px-2" />
            ) : (
              <Skeleton className="mx-2 h-5 w-32" />
            )}
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActiveHref(pathname, item.href)}
                        render={<Link href={item.href} />}
                      >
                        <item.icon data-icon="inline-start" />
                        {item.label}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            {ready ? (
              <div className="flex flex-col gap-1 px-2 pb-1">
                <span className="truncate text-sm font-medium">
                  {state.value.me.user.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {state.value.me.user.email ?? copy.common.none}
                </span>
              </div>
            ) : (
              <Skeleton className="mx-2 mb-1 h-8 w-40" />
            )}
          </SidebarFooter>
        </Sidebar>

        <div className="flex min-h-svh w-full min-w-0 flex-col">
          <header className="bg-background sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-6">
            {/*
              Mobile: one control that both states the current context and opens the
              place to change it. A bare hamburger would hide the branch and session
              a user needs to see before they trust what is on screen.
            */}
            <Button
              variant="outline"
              size="sm"
              className="max-w-56 lg:hidden"
              aria-label={copy.nav.openMenu}
              onClick={() => setMenuOpen(true)}
            >
              <MenuIcon data-icon="inline-start" />
              <span className="truncate">{contextLabel}</span>
            </Button>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center gap-2 lg:flex">
                {ready ? (
                  <>
                    <BranchSwitcher />
                    <SessionPicker />
                  </>
                ) : (
                  <>
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-8 w-28" />
                  </>
                )}
              </div>
              <ModeToggle />
            </div>
          </header>

          {/*
            `pb-24` clears the fixed bottom tabs. Without it the last row of every
            list sits under the navigation, which is the classic mobile-shell bug and
            invisible on a desktop.
          */}
          <main className="flex-1 pb-24 lg:pb-10">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
              <ActiveContextGate>{children}</ActiveContextGate>
            </div>
          </main>

          <nav
            aria-label={copy.nav.menu}
            /*
              Column count follows the item count, since permission filtering can drop
              a destination. A hardcoded grid-cols-5 would leave a dead gap for a
              teacher who cannot see Branches.
            */
            style={{
              gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))`,
            }}
            className="bg-background fixed inset-x-0 bottom-0 z-20 grid border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
          >
            {navItems.map((item) => {
              const active = isActiveHref(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 px-1 py-2 text-xs",
                    /*
                      Outline, not a ring. The base layer in globals.css already sets
                      `outline-ring/50` on every element, so an outline only needs a
                      width to become visible — whereas a `ring-*` utility here
                      computed to a transparent shadow and left keyboard users with
                      no indication of where they were.
                    */
                    "focus-visible:outline-2 focus-visible:-outline-offset-2",
                    active
                      ? "text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <item.icon className="size-5" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/*
          The mobile counterpart of the sidebar header and the desktop switchers.
          Navigation is not repeated here — the bottom tabs own it — so this sheet is
          only about which trust, branch and session the screens apply to.
        */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto">
            <SheetHeader className="p-0">
              <SheetTitle>{copy.nav.contextTitle}</SheetTitle>
              <SheetDescription>{copy.nav.contextSubtitle}</SheetDescription>
            </SheetHeader>

            {ready ? (
              <div className="flex flex-col gap-4 pt-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-xs font-medium">
                    {copy.nav.organization}
                  </span>
                  <OrgSwitcher />
                </div>

                {state.value.schools.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-xs font-medium">
                      {branchWord(state.value.schools.length)}
                    </span>
                    <BranchSwitcher />
                  </div>
                ) : null}

                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-xs font-medium">
                    {copy.terms.session}
                  </span>
                  <SessionPicker />
                </div>

                <div className="flex flex-col gap-1.5 border-t pt-4">
                  <span className="text-muted-foreground text-xs">
                    {copy.nav.signedInAs} {state.value.me.user.name}
                  </span>
                  <SignOutButton />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 pt-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
          </SheetContent>
        </Sheet>
      </SidebarProvider>
    </TooltipProvider>
  );
}
