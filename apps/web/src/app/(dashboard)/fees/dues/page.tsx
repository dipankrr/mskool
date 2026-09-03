"use client";

import { FeesTabs } from "@/features/fees/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/** DUES — the arrears view (UI6). Skeleton until its chunk lands. */
export default function FeesDuesPage() {
  const { has } = useActiveContext();

  return (
    <>
      <PageHeader title={copy.fees.dues.title} description={copy.fees.dues.subtitle} />
      <FeesTabs has={has} />
      <EmptyState title={copy.common.notBuiltYetTitle} description={copy.common.notBuiltYetBody} />
    </>
  );
}
