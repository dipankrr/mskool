import type { ReactNode } from "react";

import { ScreenFrame } from "../../../components/screen-frame";
import { copy } from "../../../lib/copy";

/**
 * The attendance manage screens' frame (chunk 3): the shared pushed-screen
 * frame, padded for the attendance stack's floating tab bar and keeping the
 * `manage-back` test id the E2E flows address.
 */
export function ManageFrame({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string | null;
  children: ReactNode;
}) {
  return (
    <ScreenFrame
      title={title}
      meta={meta}
      backAccessibilityLabel={copy.attendance.manage.back}
      backTestID="manage-back"
      padForTabBar
    >
      {children}
    </ScreenFrame>
  );
}
