"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

/**
 * The attendance area's three surfaces under one nav entry. Tab labels are
 * nouns, not verbs — the screen you are ON is not offered as an action.
 */
const TABS = [
  { href: "/attendance/calendar", label: copy.attendance.title },
  { href: "/attendance/mark", label: copy.attendance.marking.tabLabel },
  { href: "/attendance/policy", label: copy.attendance.policy.title },
] as const;

export function AttendanceTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-4 flex gap-1 rounded-lg border p-1" role="tablist">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          role="tab"
          aria-current={pathname.startsWith(tab.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            pathname.startsWith(tab.href)
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
