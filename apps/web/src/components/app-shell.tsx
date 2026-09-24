"use client";

import {
  BookOpenIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  EllipsisIcon,
  GraduationCapIcon,
  HomeIcon,
  LandmarkIcon,
  MenuIcon,
  NotebookPenIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  ShieldCheckIcon,
  TablePropertiesIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { ModeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
 * Bottom tabs rather than a hamburger for the everyday destinations, because that
 * is what these users already know: every Android app they use daily puts its
 * destinations within thumb reach at the bottom of the screen. A drawer hides
 * navigation behind a gesture that has to be learned, and this app is used by
 * people who did not choose to use software. Thirteen tabs do not fit on a phone,
 * so the bottom bar holds at most five — Home, the daily trio (Students,
 * Attendance, Fees) and a More tab that opens one sheet with every remaining
 * destination AND the context controls. One mobile menu, not two.
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
 *
 * Two more surfaces live here: the sidebar's expandable items (a chevron folds
 * their sub-destinations away; the same list feeds the command palette) and the
 * Ctrl+K palette itself, so the sidebar and the palette can never disagree about
 * what the app contains.
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
  /**
   * Second-level destinations, rendered indented beneath the item. Each carries
   * its own permission and is filtered independently; a sub-item never rescues a
   * hidden parent.
   *
   * An item with sub-items is expandable: the chevron beside it folds them away,
   * and the open state derives from the pathname (navigating to one of the item's
   * routes auto-expands it) merged with the user's own toggles.
   */
  subItems?: NavItem[];
};

/** Home sits above the groups — it is where you are, not a section of the app. */
const HOME_ITEM: NavItem = { href: "/", label: copy.nav.home, icon: HomeIcon };

/**
 * The sidebar's sections. Labels are what the day looks like to the person using
 * it — the work they do daily, the teaching material, and the once-a-term setup —
 * not the database's five domains.
 */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: copy.nav.groupDaily,
    items: [
      {
        href: "/students",
        label: copy.nav.students,
        icon: UsersIcon,
        permission: "student:read",
        subItems: [
          {
            href: "/students",
            label: copy.nav.allStudents,
            icon: UsersIcon,
            permission: "student:read",
          },
          {
            href: "/students?create=1",
            label: copy.nav.admitStudent,
            icon: PlusIcon,
            permission: "student:create",
          },
        ],
      },
      {
        href: "/attendance/calendar",
        label: copy.nav.attendance,
        icon: CalendarCheckIcon,
        permission: "attendance:read",
        /*
         * Each sub-item mirrors the gate its own page uses, not the parent's
         * read: the calendar page's PermissionGate is `attendance:update` (it is
         * the editing surface), Mark needs `attendance:create`, and Policy and
         * Reports have no gate of their own, so they inherit `attendance:read`.
         */
        subItems: [
          {
            href: "/attendance/calendar",
            label: copy.nav.attendanceCalendar,
            icon: CalendarDaysIcon,
            permission: "attendance:update",
          },
          {
            href: "/attendance/mark",
            label: copy.nav.attendanceMark,
            icon: NotebookPenIcon,
            permission: "attendance:create",
          },
          {
            href: "/attendance/policy",
            label: copy.nav.attendancePolicy,
            icon: Settings2Icon,
            permission: "attendance:read",
          },
          {
            href: "/attendance/reports",
            label: copy.nav.attendanceReports,
            icon: ClipboardListIcon,
            permission: "attendance:read",
          },
        ],
      },
      {
        href: "/fees",
        label: copy.nav.fees,
        icon: LandmarkIcon,
        /*
         * Any-of: the area's tabs gate on five reads (structure, assignment,
         * payment:create, payment:read, report). Anyone who can see ONE tab needs
         * the entry; the tabs filter the rest server-independently.
         */
        permission: [
          "fee_structure:read",
          "student_fee_assignment:read",
          "fee_payment:create",
          "fee_payment:read",
          "fee_report:read",
        ] as const satisfies readonly Permission[],
        /*
         * The tabs the /fees page renders, mirrored as sub-items. Each is gated on
         * that tab's own permission — the same names `FeesTabs` gates with — and
         * Overview is the pseudo-tab: the area home, gated on the parent's
         * any-of, because `/fees` IS the Overview.
         */
        subItems: [
          {
            href: "/fees",
            label: copy.fees.tabs.overview,
            icon: LandmarkIcon,
            permission: [
              "fee_structure:read",
              "student_fee_assignment:read",
              "fee_payment:create",
              "fee_payment:read",
              "fee_report:read",
            ] as const satisfies readonly Permission[],
          },
          {
            href: "/fees/matrix",
            label: copy.fees.tabs.statusMatrix,
            icon: TablePropertiesIcon,
            permission: "fee_report:read",
          },
          {
            href: "/fees/collect",
            label: copy.fees.tabs.collect,
            icon: PlusIcon,
            permission: "fee_payment:create",
          },
          {
            href: "/fees/outstanding",
            label: copy.fees.tabs.outstanding,
            icon: ClipboardListIcon,
            permission: "student_fee_assignment:read",
          },
          {
            href: "/fees/payments",
            label: copy.fees.tabs.payments,
            icon: NotebookPenIcon,
            permission: "fee_payment:read",
          },
          {
            href: "/fees/ledger",
            label: copy.fees.tabs.ledger,
            icon: BookOpenIcon,
            permission: "fee_report:read",
          },
          {
            href: "/fees/setup",
            label: copy.fees.tabs.setup,
            icon: Settings2Icon,
            permission: "fee_structure:read",
          },
        ],
      },
    ],
  },
  {
    label: copy.nav.groupAcademics,
    items: [
      {
        href: "/classes",
        label: copy.nav.classes,
        icon: GraduationCapIcon,
        permission: "class:read",
        subItems: [
          {
            href: "/classes",
            label: copy.nav.allClasses,
            icon: GraduationCapIcon,
            permission: "class:read",
          },
          {
            href: "/classes?create=1",
            label: copy.nav.createClass,
            icon: PlusIcon,
            permission: "class:create",
          },
        ],
      },
      {
        href: "/subjects",
        label: copy.nav.subjects,
        icon: BookOpenIcon,
        permission: "subject:read",
      },
      {
        href: "/exams",
        label: copy.nav.exams,
        icon: ClipboardListIcon,
        permission: "exam:read",
        /*
         * Three exam screens used to be three top-level entries — two thirds of
         * the sidebar's noise for most of the year. The parent stays /exams and
         * `isActiveHref` prefix-matches, so it stays lit on every sub-route.
         */
        subItems: [
          {
            href: "/exams/grades",
            label: copy.nav.termGrades,
            icon: NotebookPenIcon,
            permission: "exam:read",
          },
          {
            href: "/exams/setup",
            label: copy.nav.examSetup,
            icon: Settings2Icon,
            // Any-of: configuring the exam world needs create OR update.
            permission: ["exam:create", "exam:update"] as const satisfies readonly Permission[],
          },
          {
            href: "/exams?create=1",
            label: copy.nav.createExam,
            icon: PlusIcon,
            permission: "exam:create",
          },
        ],
      },
    ],
  },
  {
    label: copy.nav.groupAdministration,
    items: [
      {
        href: "/branches",
        label: copy.nav.branches,
        icon: Building2Icon,
        permission: "school:read",
        subItems: [
          // Labels follow branchWord — rewritten in withBranchLabel below.
          {
            href: "/branches",
            label: copy.nav.branches,
            icon: Building2Icon,
            permission: "school:read",
          },
          {
            href: "/branches?create=1",
            label: copy.branches.add,
            icon: PlusIcon,
            permission: "school:create",
          },
        ],
      },
      {
        href: "/sessions",
        label: copy.nav.sessions,
        icon: CalendarDaysIcon,
        permission: "academic_year:read",
        subItems: [
          {
            href: "/sessions",
            label: copy.nav.allSessions,
            icon: CalendarDaysIcon,
            permission: "academic_year:read",
          },
          {
            href: "/sessions?create=1",
            label: copy.nav.createSession,
            icon: PlusIcon,
            permission: "academic_year:create",
          },
        ],
      },
      {
        href: "/staff",
        label: copy.nav.staff,
        icon: BriefcaseIcon,
        permission: ["staff:read", "role_assignment:read"] as const satisfies readonly Permission[],
      },
      {
        href: "/roles",
        label: copy.nav.roles,
        icon: ShieldCheckIcon,
        permission: "role_permission:read",
      },
    ],
  },
];

/** The Profile destination is not a nav row — see the sidebar footer / More sheet. */
const PROFILE_ITEM: NavItem = { href: "/profile", label: copy.nav.profile, icon: UserIcon };

/** Mobile bottom tabs: Home plus the daily trio; everything else lives in More. */
const MOBILE_PRIMARY_HREFS = ["/", "/students", "/attendance/calendar", "/fees"];

/** Which sidebar sections are folded away, persisted after mount. */
const GROUPS_STORAGE_KEY = "mskool.nav.groups.v1";

/** Exact match for Home; prefix match elsewhere so /classes/<id> keeps Classes lit. */
function isActiveHref(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const state = useActiveContextState();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  /**
   * Branches is the one item whose label is contextual — its sub-items' labels
   * with it: "All Branches" vs "All Schools", "Create Branch" vs "Create School".
   */
  const withBranchLabel = (item: NavItem): NavItem => {
    if (item.href !== "/branches" || !ready) return item;
    return {
      ...item,
      label: branchWord(schoolCount, true),
      subItems: item.subItems?.map((sub) =>
        sub.href === "/branches"
          ? { ...sub, label: `${copy.nav.allPrefix} ${branchWord(schoolCount, true)}` }
          : sub.href === "/branches?create=1"
            ? { ...sub, label: `${copy.common.create} ${branchWord(schoolCount)}` }
            : sub,
      ),
    };
  };

  /** Drop an item the caller cannot read, and prune any sub-items with it. */
  const filterItem = (item: NavItem): NavItem | null => {
    if (!ready) return item;
    if (!hasSome(item.permission)) return null;
    if (!item.subItems) return item;
    const subItems = item.subItems.filter((sub) => hasSome(sub.permission));
    return subItems.length === item.subItems.length ? item : { ...item, subItems };
  };

  const visibleGroups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .map(filterItem)
      .filter((item): item is NavItem => item !== null)
      .map(withBranchLabel),
  })).filter((group) => group.items.length > 0);

  const homeItem = filterItem(HOME_ITEM) ?? HOME_ITEM;

  /** Every top-level destination the caller can reach, in sidebar order. */
  const topLevelItems = [
    homeItem,
    ...visibleGroups.flatMap((group) => group.items),
  ];

  /**
   * The bottom bar keeps the four destinations a school day is made of and hands
   * the rest to More. Tabs the caller lacks permission for are dropped from the
   * primary set, so a class teacher's bar is shorter, not broken.
   */
  const primaryTabs = topLevelItems.filter((item) =>
    MOBILE_PRIMARY_HREFS.includes(item.href),
  );
  const moreItems = [
    ...topLevelItems.filter((item) => !MOBILE_PRIMARY_HREFS.includes(item.href)),
    PROFILE_ITEM,
  ];
  const moreActive = moreItems.some(
    (item) =>
      isActiveHref(pathname, item.href) ||
      (item.subItems ?? []).some((sub) => isActiveHref(pathname, sub.href)),
  );

  /** A route change closes the sheet; leaving it open over the new page is a trap. */
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  /**
   * Collapsible groups: all open by default; what the user folded away is read
   * from localStorage in an effect, never during the initial render — the server
   * has no localStorage, so seeding state from it would split the first paint in
   * two and throw the whole tree away on hydration. The one-effect read means a
   * stored fold applies a moment after hydration, which is invisible next to the
   * session resolution the shell already waits for.
   */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GROUPS_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      setOpenGroups((prev) => ({ ...prev, ...(parsed as Record<string, boolean>) }));
    } catch {
      // Private browsing or stale JSON — the all-open default stands.
    }
  }, []);

  const isGroupOpen = (label: string): boolean => openGroups[label] ?? true;

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !(prev[label] ?? true) };
      try {
        window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable — the fold still works for this session.
      }
      return next;
    });
  };

  /**
   * Expandable nav items: open state derives from the pathname (navigating to any
   * of the item's routes auto-expands it) merged with the user's own toggles, so
   * the route — not the last click — decides what is open on arrival.
   */
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  const isItemExpanded = (item: NavItem): boolean => {
    const routeOpen =
      isActiveHref(pathname, item.href) ||
      (item.subItems ?? []).some((sub) => isActiveHref(pathname, sub.href));
    return openItems[item.href] ?? routeOpen;
  };

  const toggleItem = (item: NavItem) => {
    const next = !isItemExpanded(item);
    setOpenItems((prev) => ({ ...prev, [item.href]: next }));
  };

  /**
   * Ctrl+K / Cmd+K toggles the command palette. Registered on document, ignoring
   * keystrokes aimed at a field — typing "k" into the student search must never
   * open a dialog. The palette is desktop-first UX, but a global listener is
   * harmless on mobile, where the palette is reachable from the More sheet.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (inField) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * The palette's contents: every nav destination AND every quick action, with
   * its group as a section heading. Built from the same permission-filtered
   * groups the sidebar renders, so the two can never disagree. While the session
   * is loading nothing is listed — a flash of unfiltered items would promise
   * destinations the caller cannot open.
   */
  type CommandEntry = { href: string; label: string; icon: NavItem["icon"] };
  const commandSections: { heading: string; entries: CommandEntry[] }[] = (() => {
    if (!ready) return [];
    const sections: { heading: string; entries: CommandEntry[] }[] = [
      {
        heading: copy.nav.home,
        entries: [{ href: homeItem.href, label: homeItem.label, icon: homeItem.icon }],
      },
    ];
    for (const group of visibleGroups) {
      const entries: CommandEntry[] = [];
      const seen = new Set<string>();
      for (const item of group.items) {
        // The "All <area>" sub-item duplicates the parent's href; list the parent once.
        if (!seen.has(item.href)) {
          seen.add(item.href);
          entries.push({ href: item.href, label: item.label, icon: item.icon });
        }
        for (const sub of item.subItems ?? []) {
          if (seen.has(sub.href)) continue;
          seen.add(sub.href);
          entries.push({ href: sub.href, label: sub.label, icon: sub.icon });
        }
      }
      if (entries.length > 0) sections.push({ heading: group.label, entries });
    }
    sections.push({
      heading: copy.nav.profile,
      entries: [
        { href: PROFILE_ITEM.href, label: PROFILE_ITEM.label, icon: PROFILE_ITEM.icon },
      ],
    });
    return sections;
  })();

  /** Palette selection: navigate, close, and let the ?create=1 deep links land. */
  const runCommand = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };

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

  /** Shared by every row of the More sheet, so active and hover stay consistent. */
  const sheetRowClass = (active: boolean) =>
    cn(
      "flex items-center gap-3 rounded-md px-2 py-2.5 text-sm",
      /*
        Outline, not a ring. The base layer in globals.css already sets
        `outline-ring/50` on every element, so an outline only needs a width to
        become visible — whereas a `ring-*` utility here computed to a transparent
        shadow and left keyboard users with no indication of where they were.
      */
      "focus-visible:outline-2 focus-visible:-outline-offset-2",
      active ? "text-primary font-medium" : "text-foreground hover:bg-muted",
    );

  const paletteTriggerClass = cn(
    "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    "focus-visible:outline-2 focus-visible:-outline-offset-2",
    "flex h-8 items-center gap-2 rounded-lg px-2 text-sm",
  );

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
            <button
              type="button"
              aria-label={copy.common.search}
              onClick={() => setPaletteOpen(true)}
              className={paletteTriggerClass}
            >
              <SearchIcon data-icon="inline-start" />
              {copy.nav.searchPlaceholder}
              <kbd className="bg-muted border-border ml-auto rounded border px-1.5 font-mono text-[10px] tracking-widest">
                {copy.nav.searchKbdHint}
              </kbd>
            </button>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isActiveHref(pathname, homeItem.href)}
                      render={<Link href={homeItem.href} />}
                    >
                      <homeItem.icon data-icon="inline-start" />
                      {homeItem.label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {visibleGroups.map((group) => {
              const groupOpen = isGroupOpen(group.label);

              return (
                <SidebarGroup key={group.label}>
                  {/*
                    The section label is a toggle: the chevron turns, the items fold.
                    Persistence is handled after mount (see the storage effect above).
                  */}
                  <SidebarGroupLabel
                    render={
                      <button
                        type="button"
                        aria-expanded={groupOpen}
                        onClick={() => toggleGroup(group.label)}
                      />
                    }
                  >
                    {group.label}
                    <ChevronDownIcon
                      className={cn(
                        "ml-auto transition-transform",
                        groupOpen ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </SidebarGroupLabel>
                  {groupOpen ? (
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {group.items.map((item) => {
                          const subItems =
                            item.subItems && item.subItems.length > 0
                              ? item.subItems
                              : undefined;
                          const expanded = subItems ? isItemExpanded(item) : false;

                          return (
                            <SidebarMenuItem key={item.href}>
                              {/*
                                The row still navigates to the item's home, so the
                                parent stays lit on every sub-route (isActiveHref
                                prefix-matches). The chevron — a sibling button, not
                                a child of the link — is what folds the sub-items.
                              */}
                              <SidebarMenuButton
                                isActive={isActiveHref(pathname, item.href)}
                                render={<Link href={item.href} />}
                              >
                                <item.icon data-icon="inline-start" />
                                {item.label}
                              </SidebarMenuButton>
                              {subItems ? (
                                <SidebarMenuAction
                                  aria-expanded={expanded}
                                  onClick={() => toggleItem(item)}
                                  className={cn(
                                    "transition-transform",
                                    expanded ? "rotate-180" : "rotate-0",
                                  )}
                                >
                                  <ChevronDownIcon />
                                </SidebarMenuAction>
                              ) : null}
                              {subItems && expanded ? (
                                <SidebarMenuSub>
                                  {subItems.map((sub) => (
                                    <SidebarMenuSubItem key={sub.href}>
                                      <SidebarMenuSubButton
                                        isActive={isActiveHref(pathname, sub.href)}
                                        render={<Link href={sub.href} />}
                                      >
                                        {sub.label}
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  ))}
                                </SidebarMenuSub>
                              ) : null}
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  ) : null}
                </SidebarGroup>
              );
            })}
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
                <Link
                  href="/profile"
                  className={cn(
                    "text-muted-foreground hover:text-foreground mt-1 flex items-center gap-2 text-xs",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2",
                  )}
                >
                  <UserIcon data-icon="inline-start" />
                  {copy.nav.profile}
                </Link>
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
              ONE mobile menu — navigation and the branch/session controls together.
              A bare hamburger would hide the branch and session a user needs to see
              before they trust what is on screen.
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
              At most five columns: the primary tabs that survived permission
              filtering, plus More. A hardcoded grid-cols-5 would leave a dead gap
              for a teacher who cannot see Students.
            */
            style={{
              gridTemplateColumns: `repeat(${primaryTabs.length + 1}, minmax(0, 1fr))`,
            }}
            className="bg-background fixed inset-x-0 bottom-0 z-20 grid border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
          >
            {primaryTabs.map((item) => {
              const active = isActiveHref(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 px-1 py-2 text-xs",
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

            {/*
              A button, not a Link: More opens the one menu sheet. It lights up when
              the current route is any destination that lives only inside it, so a
              user deep in Exams can see where the "Exams" tab went.
            */}
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-current={moreActive ? "page" : undefined}
              onClick={() => setMenuOpen(true)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-1 py-2 text-xs",
                "focus-visible:outline-2 focus-visible:-outline-offset-2",
                moreActive || menuOpen
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <EllipsisIcon className="size-5" />
              <span className="truncate">{copy.nav.more}</span>
            </button>
          </nav>
        </div>

        {/*
          The ONE mobile menu: every destination the bottom bar cannot hold, then
          the context controls — which trust, branch and session the screens apply
          to — behind a border. The desktop sidebar owns navigation above 1024px;
          this sheet is only painted when the header button or More opens it.
          Sub-items render indented, mirroring the desktop sidebar's structure.
        */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto">
            <SheetHeader className="p-0">
              <SheetTitle>{copy.nav.contextTitle}</SheetTitle>
              <SheetDescription>{copy.nav.contextSubtitle}</SheetDescription>
            </SheetHeader>

            {/*
              The same palette the sidebar header opens — navigation by typing,
              permission-filtered identically.
            */}
            <button
              type="button"
              aria-label={copy.common.search}
              onClick={() => setPaletteOpen(true)}
              className={cn(sheetRowClass(false), "mt-3")}
            >
              <SearchIcon className="size-5 shrink-0" />
              <span className="truncate">{copy.common.search}</span>
              <kbd className="bg-muted border-border text-muted-foreground ml-auto rounded border px-1.5 font-mono text-[10px] tracking-widest">
                {copy.nav.searchKbdHint}
              </kbd>
            </button>

            {moreItems.length > 0 ? (
              <nav aria-label={copy.nav.menu} className="flex flex-col gap-0.5 pt-3">
                {moreItems.map((item) => (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={
                        isActiveHref(pathname, item.href) ? "page" : undefined
                      }
                      className={sheetRowClass(isActiveHref(pathname, item.href))}
                    >
                      <item.icon className="size-5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                    {item.subItems && item.subItems.length > 0 ? (
                      <div className="border-border/60 ml-10 flex flex-col gap-0.5 border-l pl-3">
                        {item.subItems.map((sub) => {
                          const subActive = isActiveHref(pathname, sub.href);
                          return (
                            <Link
                              key={sub.href}
                              href={sub.href}
                              aria-current={subActive ? "page" : undefined}
                              className={cn(
                                sheetRowClass(subActive),
                                "py-2 text-sm",
                              )}
                            >
                              <span className="truncate">{sub.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </nav>
            ) : null}

            {ready ? (
              <div className="mt-3 flex flex-col gap-4 border-t pt-4">
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

                <div className="flex flex-col gap-1.5">
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

        {/*
          The command palette. The Dialog primitive owns the portal, focus trap,
          backdrop and Escape; cmdk owns the filtering and keyboard selection.
          Sections come from the same permission-filtered nav data as the sidebar.
        */}
        <CommandDialog
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          title={copy.common.search}
          description={copy.nav.searchPlaceholder}
        >
          <CommandInput
            placeholder={copy.nav.searchPlaceholder}
            aria-label={copy.common.search}
          />
          <CommandList>
            {ready ? (
              <>
                {commandSections.map((section) => (
                  <CommandGroup key={section.heading} heading={section.heading}>
                    {section.entries.map((entry) => (
                      <CommandItem
                        key={entry.href}
                        value={`${section.heading} ${entry.label}`}
                        onSelect={() => runCommand(entry.href)}
                      >
                        <entry.icon />
                        <span className="truncate">{entry.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
                <CommandEmpty>{copy.nav.searchNoResults}</CommandEmpty>
              </>
            ) : null}
          </CommandList>
        </CommandDialog>
      </SidebarProvider>
    </TooltipProvider>
  );
}
