"use client";

import { CalendarDaysIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/** Placeholder. Chunk 9 builds the real list, preset create, edit and setCurrent. */
export default function SessionsPage() {
  return (
    <>
      <PageHeader title={copy.terms.sessions} description={copy.sessions.subtitle} />
      <EmptyState
        icon={CalendarDaysIcon}
        title={copy.common.notBuiltYetTitle}
        description={copy.common.notBuiltYetBody}
      />
    </>
  );
}
