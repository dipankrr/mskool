"use client";

import { Building2Icon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useActiveContext } from "@/features/session/active-context";
import { branchWord, copy } from "@/lib/copy";

/** Placeholder. Chunk 8 builds the real list, create, edit and close. */
export default function BranchesPage() {
  const { schools } = useActiveContext();

  return (
    <>
      <PageHeader
        title={branchWord(schools.length, true)}
        description={copy.branches.subtitle}
      />
      <EmptyState
        icon={Building2Icon}
        title={copy.common.notBuiltYetTitle}
        description={copy.common.notBuiltYetBody}
      />
    </>
  );
}
