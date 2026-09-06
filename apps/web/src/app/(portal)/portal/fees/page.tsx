"use client";

import { ClipboardCheckIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/**
 * The fees link's honest destination: the portal fees slice (dues,
 * receipts, payment history for the owned children) is recorded as the
 * next portal slice in docs/TASKS.md. A stub that says so beats a dead
 * link that looks broken — and beats silently dropping the nav item,
 * which is how "incomplete" happens without anyone deciding it.
 */
export default function PortalFeesPage() {
  return (
    <>
      <PageHeader title={copy.portal.fees} description={undefined} />
      <EmptyState
        icon={ClipboardCheckIcon}
        title={copy.common.notBuiltYetTitle}
        description={copy.common.notBuiltYetBody}
      />
    </>
  );
}
