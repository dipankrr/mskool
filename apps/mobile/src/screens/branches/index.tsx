import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { EntityCard } from "../../components/entity-card";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { useActiveContext, useActiveOrganizationName } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";
import { copy } from "../../lib/copy";
import { spacing } from "../../theme/tokens";

/**
 * The trust's branches (Step 1 chunk B). Read is every staff member's grant
 * (ADR-044); add is org-admin work and edit is the principal's or the trust's.
 * The screen gates on the permission strings, never on a role name, and the
 * server re-checks every call.
 *
 * `school.list` is active-only, so there is no closed-branch toggle: closing is
 * one-way in this UI and the copy on the form says so.
 */
export function BranchesScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const organizationName = useActiveOrganizationName();
  const { has } = usePermissions();

  const canRead = has("school:read");
  const canCreate = has("school:create");
  const canOpen = has("school:update") || has("school:delete");

  const list = trpc.school.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  const addAction =
    canRead && canCreate
      ? {
          label: copy.branches.add,
        icon: "add" as const,
        onPress: () => router.push("/branch-form"),
        accessibilityHint: copy.branches.addTitle,
        testID: "branches-add",
      }
    : undefined;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.branches.title}
      meta={organizationName}
      backAccessibilityLabel={copy.common.back}
      action={addAction}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="branches-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.branchesReadTitle}
        message={copy.denied.branchesReadBody}
        testID="branches-denied"
      />,
    );
  }

  if (!ready || (organizationId && list.isPending)) {
    return frame(
      <View
        style={styles.list}
        accessibilityLabel={copy.branches.loading}
        accessibilityLiveRegion="polite"
      >
        {[0, 1, 2].map((key) => (
          <Card key={key} style={styles.skeletonCard}>
            <View style={styles.skeletonRow}>
              <Skeleton width={40} height={40} />
              <View style={styles.skeletonText}>
                <Skeleton width="62%" height={16} />
                <Skeleton width="44%" height={12} />
              </View>
            </View>
          </Card>
        ))}
      </View>,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="branches"
        title={copy.branches.noOrgTitle}
        message={copy.branches.noOrgBody}
        testID="branches-no-org"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="branches-error"
      />,
    );
  }

  const branches = list.data ?? [];

  if (branches.length === 0) {
    return frame(
      <EmptyState
        icon="branches"
        title={copy.branches.emptyTitle}
        message={copy.branches.emptyBody}
        testID="branches-empty"
      >
        {canCreate ? (
          <CapsuleButton
            title={copy.branches.add}
            icon="add"
            onPress={() => router.push("/branch-form")}
            testID="branches-empty-add"
          />
        ) : null}
      </EmptyState>,
    );
  }

  return frame(
    <View style={styles.list}>
      {branches.map((branch) => {
        const meta = [
          branch.code,
          copy.branches.boards[branch.board],
          branch.city,
        ]
          .filter(Boolean)
          .join(" · ");
        const isCurrent = branch.id === schoolId;
        return (
          <EntityCard
            key={branch.id}
            title={branch.name}
            meta={meta}
            icon="branches"
            emphasis={isCurrent ? "accent" : "neutral"}
            status={
              isCurrent
                ? { label: copy.branches.current, tone: "positive" }
                : null
            }
            onPress={
              canOpen
                ? () =>
                    router.push({
                      pathname: "/branch-form",
                      params: { id: branch.id },
                    })
                : undefined
            }
            accessibilityHint={canOpen ? copy.branches.openHint : undefined}
            testID={`branch-card-${branch.id}`}
          />
        );
      })}
    </View>,
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  skeletonCard: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  skeletonText: {
    flex: 1,
    gap: spacing.sm,
  },
});
