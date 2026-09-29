"use client";

import { useParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { copy } from "@/lib/copy";

import { TemplateDesigner } from "@/features/id-cards/template-designer";

/**
 * THE DESIGNER ROUTE (slice 2b) — `/students/id-cards/[templateId]/design`.
 * Reached from the ID-cards page's Edit control on an adopted template, not
 * from the sidebar: it is a sub-surface of the ID-cards area, and the
 * template picker is where template management lives.
 */
export default function TemplateDesignerPage() {
  const params = useParams<{ templateId: string }>();
  const templateId = Array.isArray(params.templateId)
    ? params.templateId[0]
    : params.templateId;

  if (!templateId) {
    return (
      <>
        <PageHeader
          title={copy.idCards.designer.title}
          description={copy.idCards.designer.subtitle}
        />
        <EmptyState
          title={copy.idCards.designer.loadFailed}
          description={copy.idCards.designer.loadFailedBody}
        />
      </>
    );
  }

  return <TemplateDesigner templateId={templateId} />;
}
