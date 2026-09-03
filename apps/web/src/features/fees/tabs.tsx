"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission } from "@repo/authz";

import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

/**
 * The fees area's five surfaces under one nav entry, permission-filtered
 * per tab: a class teacher's Dues is the whole area, a principal sees
 * everything but the Setup tab they cannot create in is still readable —
 * the LIST permissions decide what renders, the ACTION permissions are
 * handled by each screen. Hidden, never disabled, per the standing rule.
 *
 * Tab labels are nouns, not verbs — same rule as the attendance tabs.
 */
const TABS: ReadonlyArray<{
  href: string;
  label: string;
  permission: Permission;
}> = [
  { href: "/fees/setup", label: copy.fees.tabs.setup, permission: "fee_structure:read" },
  { href: "/fees/dues", label: copy.fees.tabs.dues, permission: "student_fee_assignment:read" },
  { href: "/fees/counter", label: copy.fees.tabs.counter, permission: "fee_payment:create" },
  { href: "/fees/payments", label: copy.fees.tabs.payments, permission: "fee_payment:read" },
  { href: "/fees/ledger", label: copy.fees.tabs.ledger, permission: "fee_report:read" },
];

export function FeesTabs({ has }: { has: (permission: Permission) => boolean }) {
  const pathname = usePathname();
  const visible = TABS.filter((tab) => has(tab.permission));

  if (visible.length <= 1) return null;

  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border p-1" role="tablist">
      {visible.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          role="tab"
          aria-current={pathname.startsWith(tab.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
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

/** The href `/fees` should land on: the first tab the caller may see. */
export function firstPermittedFeeTab(has: (permission: Permission) => boolean): string {
  return TABS.find((tab) => has(tab.permission))?.href ?? "/fees/dues";
}
