import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { copy } from "../../lib/copy";
import { spacing } from "../../theme/tokens";

/**
 * The academic forms' shared gate ladder — context → permission → edit-load —
 * resolved once so the six forms stay body-only. Every early exit wraps its
 * own bare ScreenFrame; when the gates pass, the children render (and each
 * body owns its ScreenFrame + sticky footer, the student-form architecture).
 */
export function AcademicFormGates({
  title,
  ready,
  hasOrg,
  allowed,
  deniedTitle,
  deniedPermission,
  editing,
  editPending,
  editError,
  editMissing,
  onRetryEdit,
  backTestID,
  children,
}: {
  title: string;
  ready: boolean;
  hasOrg: boolean;
  allowed: boolean;
  deniedTitle: string;
  deniedPermission: string;
  editing: boolean;
  editPending?: boolean;
  editError?: unknown;
  editMissing?: boolean;
  onRetryEdit?: () => void;
  backTestID: string;
  children: ReactNode;
}) {
  const frame = (content: ReactNode) => (
    <ScreenFrame
      title={title}
      backAccessibilityLabel={copy.common.back}
      backTestID={backTestID}
    >
      {content}
    </ScreenFrame>
  );

  if (!ready) {
    return frame(<Skeleton height={220} />);
  }

  if (!hasOrg) {
    return frame(
      <EmptyState
        icon="stack"
        title={copy.students.noOrgTitle}
        message={copy.students.noOrgBody}
      />,
    );
  }

  if (!allowed) {
    return frame(
      <EmptyState
        icon="shield"
        title={deniedTitle}
        message={copy.academic.denied.writeBody(deniedPermission)}
        testID={`${backTestID}-denied`}
      />,
    );
  }

  if (editing && editPending) {
    return frame(
      <View style={styles.skeleton} accessibilityLabel={copy.academic.loading}>
        <Skeleton height={28} width="56%" />
        <Skeleton height={180} />
        <Skeleton height={180} />
      </View>,
    );
  }

  if (editing && editError) {
    return frame(
      <ErrorCard
        cause={editError}
        onRetry={onRetryEdit}
        testID={`${backTestID}-error`}
      />,
    );
  }

  if (editing && editMissing) {
    return frame(
      <ErrorCard
        cause={new Error(copy.errors.notFound)}
        onRetry={onRetryEdit}
        testID={`${backTestID}-missing`}
      />,
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  skeleton: {
    gap: spacing.md,
  },
});
