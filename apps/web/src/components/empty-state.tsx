import type { ComponentType, ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * The screen a user meets *most* often during setup, so it is treated as a
 * destination rather than a failure.
 *
 * An empty list is the normal state of a school that has just been created, and
 * the person looking at it is mid-task. So the description says what the thing is
 * for and the action offers the next step — never a bare "No data".
 *
 * `action` is optional because the caller decides whether the user may act:
 * wrapping the button in `PermissionGate` means a principal sees an explanation
 * where an admin sees a button, and neither sees a control that fails.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
