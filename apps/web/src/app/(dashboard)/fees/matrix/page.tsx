"use client";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { FeeStatusMatrix } from "@/features/fees/fee-status-matrix";
import { FeesTabs } from "@/features/fees/tabs";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";

export default function FeesMatrixPage() {
  const { has, activeSession } = useActiveContext();

  return (
    <>
      <PageHeader
        title={`${copy.fees.matrix.title}${activeSession ? ` · ${activeSession.name}` : ""}`}
        description={copy.fees.matrix.subtitle}
      />
      <FeesTabs has={has} />
      {has("fee_report:read") ? (
        <FeeStatusMatrix />
      ) : (
        <EmptyState title={copy.errors.forbidden} description={copy.errors.forbidden} />
      )}
    </>
  );
}
