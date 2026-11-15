import type { ReactNode } from "react";

import { ScreenFrame } from "../../../components/screen-frame";
import type { HeaderAction } from "../../../components/screen-frame";
import { copy } from "../../../lib/copy";

/**
 * The attendance manage screens' frame (chunk 3): the shared pushed-screen
 * frame, padded for the attendance stack's floating tab bar and keeping the
 * `manage-back` test id the E2E flows address.
 */
export function ManageFrame({
  title,
  meta,
  footer,
  footerVariant,
  action,
  overflowAction,
  stickyHeader,
  children,
}: {
  title: string;
  meta?: string | null;
  footer?: ReactNode;
  footerVariant?: "bar" | "floating";
  action?: HeaderAction;
  overflowAction?: HeaderAction;
  stickyHeader?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScreenFrame
      title={title}
      meta={meta}
      backAccessibilityLabel={copy.attendance.manage.back}
      backTestID="manage-back"
      padForTabBar
      footer={footer}
      footerVariant={footerVariant}
      action={action}
      overflowAction={overflowAction}
      stickyHeader={stickyHeader}
    >
      {children}
    </ScreenFrame>
  );
}
