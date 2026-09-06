"use client";

import { CalendarCheckIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

/**
 * The attendance link's honest destination: the family attendance view
 * (the child's summary rows, the same attendance_summary the reports
 * read) is recorded as the next portal slice in docs/TASKS.md. The stub
 * states the truth; the link is the promise.
 */
export default function PortalAttendancePage() {
  return (
    <>
      <PageHeader title={copy.portal.attendance} description={undefined} />
      <EmptyState
        icon={CalendarCheckIcon}
        title={copy.common.notBuiltYetTitle}
        description={copy.common.notBuiltYetBody}
      />
    </>
  );
}
