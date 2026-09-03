"use client";

import { FeesTabs } from "@/features/fees/tabs";
import { FeeHeadsSection } from "@/features/fees/fee-heads-section";
import { useActiveContext } from "@/features/session/active-context";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/**
 * SETUP — the configuration tab. Fee heads first (what the school charges);
 * structures (the per-class bill) join in UI3 and stack under the heads
 * section, each an own-titled <section> so the page reads as two lists,
 * not one long anonymous one.
 */
export default function FeesSetupPage() {
  const { has } = useActiveContext();

  return (
    <>
      <PageHeader title={copy.fees.tabs.setup} description={copy.fees.subtitle} />
      <FeesTabs has={has} />
      <FeeHeadsSection />
    </>
  );
}
