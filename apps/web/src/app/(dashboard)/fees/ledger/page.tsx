"use client";

import { FeesTabs } from "@/features/fees/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/** LEDGER — the append-only money history (UI9). Skeleton until its chunk lands. */
export default function FeesLedgerPage() {
  const { has } = useActiveContext();

  return (
    <>
      <PageHeader title={copy.fees.ledger.title} description={copy.fees.ledger.subtitle} />
      <FeesTabs has={has} />
      <EmptyState title={copy.common.notBuiltYetTitle} description={copy.common.notBuiltYetBody} />
    </>
  );
}
