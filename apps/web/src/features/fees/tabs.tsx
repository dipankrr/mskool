"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission } from "@repo/authz";

import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

/**
 * The fees area's task surfaces under one nav entry, permission-filtered
 * per tab (spec §2/§49): Overview first, then the jobs — Collect,
 * Outstanding, Payments, Ledger — with Setup last and visually separated
 * as configuration, not daily work. Hidden, never disabled.
 *
 * Overview is the pseudo-tab: visible to anyone who may see at least one
 * real tab. `/fees` IS the Overview — no redirect hop.
 */
const TABS: ReadonlyArray<{
  href: string;
  label: string;
  permission: Permission;
}> = [
  { href: "/fees/collect", label: copy.fees.tabs.collect, permission: "fee_payment:create" },
  { href: "/fees/outstanding", label: copy.fees.tabs.outstanding, permission: "student_fee_assignment:read" },
  { href: "/fees/payments", label: copy.fees.tabs.payments, permission: "fee_payment:read" },
  { href: "/fees/ledger", label: copy.fees.tabs.ledger, permission: "fee_report:read" },
  { href: "/fees/setup", label: copy.fees.tabs.setup, permission: "fee_structure:read" },
];

export function FeesTabs({ has }: { has: (permission: Permission) => boolean }) {
  const pathname = usePathname();
  const visible = TABS.filter((tab) => has(tab.permission));
  const showOverview = visible.length > 0;

  if (!showOverview) return null;

  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border p-1" role="tablist">
      <Link
        key="/fees"
        href="/fees"
        role="tab"
        aria-current={pathname === "/fees" ? "page" : undefined}
        className={cn(
          "inline-flex min-h-11 items-center rounded-md px-4 py-1.5 text-sm whitespace-nowrap transition-colors",
          pathname === "/fees"
            ? "bg-primary text-primary-foreground font-medium"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {copy.fees.tabs.overview}
      </Link>
      {visible.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          role="tab"
          aria-current={pathname.startsWith(tab.href) ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-md px-4 py-1.5 text-sm whitespace-nowrap transition-colors",
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

/** The href `/fees` should land on: the area home for anyone with a tab. */
export function firstPermittedFeeTab(has: (permission: Permission) => boolean): string {
  return TABS.some((tab) => has(tab.permission)) ? "/fees" : "/fees/outstanding";
}
