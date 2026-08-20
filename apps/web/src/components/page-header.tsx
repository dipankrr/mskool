import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The title block every screen opens with.
 *
 * Actions sit beside the title on a desktop and wrap underneath it on a phone,
 * which is why this is `flex-wrap` rather than a two-column grid: a long branch
 * name and a "Add branch" button cannot share 360px, and truncating either one
 * loses information the user needs.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  /** Usually a Button, often wrapped in `PermissionGate`. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b pb-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-sm/relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
