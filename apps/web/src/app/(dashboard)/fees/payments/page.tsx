"use client";

import { FeesTabs } from "@/features/fees/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/** PAYMENTS — the lifecycle list + transitions (UI8). Skeleton until its chunk lands. */
export default function FeesPaymentsPage() {
  const { has } = useActiveContext();

  return (
    <>
      <PageHeader title={copy.fees.payments.title} description={copy.fees.payments.subtitle} />
      <FeesTabs has={has} />
      <EmptyState title={copy.common.notBuiltYetTitle} description={copy.common.notBuiltYetBody} />
    </>
  );
}
