"use client";

import { GraduationCapIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/** Placeholder. Chunk 10 builds the list and the bulk class ladder. */
export default function ClassesPage() {
  return (
    <>
      <PageHeader title={copy.terms.classes} description={copy.classes.subtitle} />
      <EmptyState
        icon={GraduationCapIcon}
        title={copy.common.notBuiltYetTitle}
        description={copy.common.notBuiltYetBody}
      />
    </>
  );
}
