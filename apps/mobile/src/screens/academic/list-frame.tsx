import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import type { AppIconName } from "../../components/app-icon";
import { Skeleton } from "../../components/skeleton";
import { copy } from "../../lib/copy";
import { spacing } from "../../theme/tokens";

/** The header action shape ScreenFrame expects (branches' add, etc.). */
type HeaderAction = {
  label: string;
  onPress: () => void;
  icon?: AppIconName;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * The academic surfaces' shared list scaffolding: read denial, skeleton,
 * error, and the two empty states (no rows at all vs no rows for the current
 * filter) resolved once here so the six lists stay row-only. The children
 * render only when there is something to show — every branch above them is
 * exhaustive.
 */
export function AcademicListFrame({
  title,
  meta,
  canRead,
  deniedTitle,
  deniedPermission,
  needsSession,
  academicYear,
  ready,
  hasOrg,
  pending,
  error,
  onRetry,
  onRefresh,
  refreshing,
  isEmpty,
  isFilteredEmpty,
  emptyTitle,
  emptyBody,
  filteredEmptyTitle,
  filteredEmptyBody,
  emptyIcon,
  emptyAction,
  action,
  header,
  stickyHeader,
  children,
  titleTestID,
}: {
  title: string;
  meta?: string | null;
  canRead: boolean;
  /** The denial's wording: "Classes aren't in your account" + its permission. */
  deniedTitle: string;
  deniedPermission: string;
  /** The surface hangs off the running session; without one it says so. */
  needsSession?: boolean;
  ready: boolean;
  hasOrg: boolean;
  /** The branch's running session, when the surface is session-bound. */
  academicYear?: boolean;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  isEmpty: boolean;
  isFilteredEmpty?: boolean;
  emptyTitle: string;
  emptyBody: string;
  filteredEmptyTitle?: string;
  filteredEmptyBody?: string;
  emptyIcon: "stack" | "school" | "edit" | "calendar" | "sort" | "person";
  emptyAction?: ReactNode;
  action?: HeaderAction;
  /** Filter rows that must stay reachable in the empty state too (pickers). */
  header?: ReactNode;
  /** Tabs that stay on screen while the list scrolls. */
  stickyHeader?: ReactNode;
  children: ReactNode;
  titleTestID: string;
}) {
  const frame = (content: ReactNode) => (
    <ScreenFrame
      title={title}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      action={action}
      stickyHeader={stickyHeader}
      onRefresh={canRead ? onRefresh : undefined}
      refreshing={refreshing}
      titleTestID={titleTestID}
    >
      {content}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={deniedTitle}
        message={copy.academic.denied.readBody(deniedPermission)}
        testID={`${titleTestID}-denied`}
      />,
    );
  }

  if (!ready || (hasOrg && pending)) {
    return frame(
      <View style={styles.list} accessibilityLabel={copy.academic.loading}>
        {[0, 1, 2].map((key) => (
          <Card key={key} style={styles.skeletonCard}>
            <Skeleton width={40} height={40} />
            <View style={styles.skeletonText}>
              <Skeleton width="58%" height={16} />
              <Skeleton width="38%" height={12} />
            </View>
          </Card>
        ))}
      </View>,
    );
  }

  if (!hasOrg) {
    return frame(
      <EmptyState
        icon={emptyIcon}
        title={copy.students.noOrgTitle}
        message={copy.students.noOrgBody}
        testID={`${titleTestID}-no-org`}
      />,
    );
  }

  if (needsSession && !academicYear) {
    return frame(
      <EmptyState
        icon="sessions"
        title={copy.academic.noSessionTitle}
        message={copy.academic.noSessionBody}
        testID={`${titleTestID}-no-session`}
      />,
    );
  }

  if (error) {
    return frame(
      <ErrorCard cause={error} onRetry={onRetry} testID={`${titleTestID}-error`} />,
    );
  }

  if (isEmpty) {
    return frame(
      <View>
        {header}
        <EmptyState
          icon={emptyIcon}
          title={
            isFilteredEmpty && filteredEmptyTitle ? filteredEmptyTitle : emptyTitle
          }
          message={
            isFilteredEmpty && filteredEmptyBody ? filteredEmptyBody : emptyBody
          }
          testID={`${titleTestID}-empty`}
        >
          {emptyAction}
        </EmptyState>
      </View>,
    );
  }

  return frame(
    <View style={styles.list}>
      {header}
      {children}
    </View>,
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  skeletonText: {
    flex: 1,
    gap: spacing.sm,
  },
});
