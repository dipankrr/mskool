"use client";

import { FeesTabs } from "@/features/fees/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/** COUNTER — the collection desk (UI7). Skeleton until its chunk lands. */
export default function FeesCounterPage() {
  const { has } = useActiveContext();

  return (
    <>
      <PageHeader title={copy.fees.counter.title} description={copy.fees.counter.subtitle} />
      <FeesTabs has={has} />
      <EmptyState title={copy.common.notBuiltYetTitle} description={copy.common.notBuiltYetBody} />
    </>
  );
}
