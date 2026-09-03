"use client";

import { FeesTabs } from "@/features/fees/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/**
 * SETUP — the configuration tab: fee heads and fee structures (UI2/UI3).
 * This skeleton renders the honest not-built-yet state; the screens land
 * chunk by chunk and replace it.
 */
export default function FeesSetupPage() {
  const { has } = useActiveContext();

  return (
    <>
      <PageHeader title={copy.fees.tabs.setup} description={copy.fees.subtitle} />
      <FeesTabs has={has} />
      <EmptyState title={copy.common.notBuiltYetTitle} description={copy.common.notBuiltYetBody} />
    </>
  );
}
