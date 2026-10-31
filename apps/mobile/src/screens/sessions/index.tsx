import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { EntityCard } from "../../components/entity-card";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import {
  useBranchMeta,
  useActiveContext,
  type AcademicYear,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { formatReadableDateRange } from "../../lib/format";
import { copy } from "../../lib/copy";
import { sessionStatus } from "../../lib/session-dates";
import { trpc } from "../../lib/trpc";
import type { Tone } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";

/** Status word + tone for a row. "Running" beats the calendar (session-dates). */
function statusOf(year: AcademicYear): { label: string; tone: Tone } {
  switch (sessionStatus(year)) {
    case "running":
      return { label: copy.sessions.statuses.running, tone: "positive" };
    case "upcoming":
      return { label: copy.sessions.statuses.upcoming, tone: "neutral" };
    case "not_running":
      return { label: copy.sessions.statuses.not_running, tone: "caution" };
    case "past":
      return { label: copy.sessions.statuses.past, tone: "neutral" };
  }
}

/**
 * The active branch's academic sessions (Step 1 chunk B).
 *
 * Reads the same `academic.year.list` cache entry as the active-context
 * provider — the provider wants "which one is current?", this screen wants
 * "all of them" — and narrows to the branch in view. Sessions are per branch
 * (the `isCurrent` flag is unique per school), so an org-wide list without
 * this filter would mix two branches' years.
 *
 * History is a server decision: without `academic_year:read_history` the list
 * returns only the current year. The screen does not guess whether older years
 * exist; it explains the absence instead.
 */
export function SessionsScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useBranchMeta();
  const { has } = usePermissions();

  const canRead = has("academic_year:read");
  const canCreate = has("academic_year:create");
  const canUpdate = has("academic_year:update");
  const canReadHistory = has("academic_year:read_history");

  const list = trpc.academic.year.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: ready && Boolean(organizationId) && canRead,
      // The active context already treats this as a reference list; sharing
      // the key means a session write refreshes both observers at once.
      staleTime: 300_000,
    },
  );

  const addAction =
    canRead && canCreate && schoolId
      ? {
          label: copy.sessions.add,
          icon: "add" as const,
          onPress: () => router.push("/session-form"),
          accessibilityHint: copy.sessions.addTitle,
          testID: "sessions-add",
        }
      : undefined;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.sessions.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      action={addAction}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="sessions-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!ready) {
    return frame(skeletons());
  }

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.sessionsReadTitle}
        message={copy.denied.sessionsReadBody}
        testID="sessions-denied"
      />,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="sessions"
        title={copy.branches.noOrgTitle}
        message={copy.branches.noOrgBody}
        testID="sessions-no-org"
      />,
    );
  }

  // Sessions are per branch. Without one, create cannot name its parent, so an
  // honest "choose a branch" is better than a form that cannot be sent.
  if (!schoolId) {
    return frame(
      <EmptyState
        icon="branches"
        title={copy.sessions.noBranchTitle}
        message={copy.sessions.noBranchBody}
        testID="sessions-no-branch"
      >
        <CapsuleButton
          title={copy.sessions.noBranchAction}
          variant="secondary"
          onPress={() => router.replace("/more")}
          testID="sessions-no-branch-action"
        />
      </EmptyState>,
    );
  }

  if (list.isPending) {
    return frame(skeletons());
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="sessions-error"
      />,
    );
  }

  const rows = (list.data ?? []).filter((year) => year.schoolId === schoolId);

  if (rows.length === 0) {
    return frame(
      <EmptyState
        icon="sessions"
        title={copy.sessions.emptyTitle}
        message={copy.sessions.emptyBody}
        testID="sessions-empty"
      >
        {canCreate ? (
          <CapsuleButton
            title={copy.sessions.add}
            icon="add"
            onPress={() => router.push("/session-form")}
            testID="sessions-empty-add"
          />
        ) : null}
      </EmptyState>,
    );
  }

  const running = rows.filter((year) => year.isCurrent);
  const others = rows
    .filter((year) => !year.isCurrent)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const card = (year: AcademicYear) => {
    const status = statusOf(year);
    return (
      <EntityCard
        key={year.id}
        title={year.name}
        meta={formatReadableDateRange(year.startDate, year.endDate)}
        icon="sessions"
        emphasis={year.isCurrent ? "accent" : "neutral"}
        status={status}
        onPress={
          canUpdate
            ? () =>
                router.push({
                  pathname: "/session-form",
                  params: { id: year.id },
                })
            : undefined
        }
        accessibilityHint={canUpdate ? copy.sessions.openHint : undefined}
        testID={`session-card-${year.id}`}
      />
    );
  };

  return frame(
    <View style={styles.body}>
      {running.length === 0 ? (
        <Notice
          tone="caution"
          title={copy.sessions.noCurrentTitle}
          message={copy.sessions.noCurrentBody}
          testID="sessions-no-current"
        />
      ) : null}

      {running.length > 0 ? (
        <>
          <SectionLabel>{copy.sessions.runningGroup}</SectionLabel>
          <View style={styles.group}>{running.map(card)}</View>
        </>
      ) : null}

      {others.length > 0 ? (
        <>
          <SectionLabel>
            {copy.sessions.otherGroupCount(others.length)}
          </SectionLabel>
          <View style={styles.group}>{others.map(card)}</View>
        </>
      ) : null}

      {!canReadHistory ? (
        <Notice
          tone="neutral"
          title={copy.sessions.historyHiddenTitle}
          message={copy.sessions.historyHiddenBody}
          testID="sessions-history-hidden"
          style={styles.history}
        />
      ) : null}
    </View>,
  );
}

function skeletons() {
  return (
    <View
      style={styles.skeletons}
      accessibilityLabel={copy.sessions.loading}
      accessibilityLiveRegion="polite"
    >
      {[0, 1].map((key) => (
        <Card key={key} style={styles.skeletonCard}>
          <View style={styles.skeletonRow}>
            <Skeleton width={40} height={40} />
            <View style={styles.skeletonText}>
              <Skeleton width="56%" height={16} />
              <Skeleton width="72%" height={12} />
            </View>
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
  },
  group: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  history: {
    marginTop: spacing.xxl,
  },
  skeletons: {
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
