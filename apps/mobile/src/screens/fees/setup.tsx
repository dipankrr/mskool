import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";

import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { LinkRow } from "../../components/link-row";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { GenerationCard } from "./generation-card";

/**
 * Fee setup (Step 5E) — the configuration hub.
 *
 * Configuration is read-mostly and infrequent, so it is a short destination
 * list rather than a sixth tab: fee heads (the vocabulary), structures (each
 * class's bill), and per-student services. Each destination owns its own
 * list, forms and states; this screen only answers "where do I change what?".
 *
 * The intro states the consequence that matters: edits affect future
 * assignments, never a bill already generated.
 */
export function FeeSetupScreen() {
  const { organizationId, academicYear, yearPending, ready } =
    useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canReadHeads = has("fee_head:read");
  const canReadStructures = has("fee_structure:read");
  const canReadAny = canReadHeads || canReadStructures;

  const heads = trpc.fees.head.list.useQuery(
    { organizationId: organizationId ?? "" },
    {
      enabled: ready && canReadHeads && Boolean(organizationId),
      staleTime: 60_000,
    },
  );

  const structures = trpc.fees.structure.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      includeHistory: false,
    },
    {
      enabled:
        ready &&
        canReadStructures &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
      staleTime: 60_000,
    },
  );

  const loadError =
    (canReadHeads && heads.isError) ||
    (canReadStructures && structures.isError);

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.setup.title}
      meta={academicYear ? copy.fees.setup.meta(academicYear.name) : branchName}
      backAccessibilityLabel={copy.common.back}
      onRefresh={
        canReadAny
          ? () => {
              if (canReadHeads) void heads.refetch();
              if (canReadStructures) void structures.refetch();
            }
          : undefined
      }
      refreshing={heads.isRefetching || structures.isRefetching}
      titleTestID="fee-setup-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canReadAny) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.setup.deniedTitle}
        message={copy.fees.setup.deniedBody}
        testID="fee-setup-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={100} />
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </View>,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fee-setup-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.ledger.noYearTitle}
        message={copy.fees.ledger.noYearBody}
        testID="fee-setup-no-year"
      />,
    );
  }

  if (loadError) {
    return frame(
      <ErrorCard
        cause={canReadHeads && heads.isError ? heads.error : structures.error}
        onRetry={() => {
          if (canReadHeads) void heads.refetch();
          if (canReadStructures) void structures.refetch();
        }}
        testID="fee-setup-error"
      />,
    );
  }

  const pending =
    (canReadHeads && heads.isPending) ||
    (canReadStructures && structures.isPending);

  if (pending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={100} />
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </View>,
    );
  }

  return frame(
    <View style={styles.body}>
      <Notice
        tone="neutral"
        message={copy.fees.setup.intro}
        testID="fee-setup-intro"
      />

      <Card padless>
        {canReadHeads ? (
          <LinkRow
            first
            icon="fees"
            title={copy.fees.setup.headsRow}
            detail={
              heads.data
                ? copy.fees.setup.headsDetail(heads.data.length)
                : copy.fees.setup.headsHint
            }
            accessibilityHint={copy.fees.setup.headsHint}
            onPress={() => router.push("/fees/setup/heads")}
            testID="fee-setup-heads"
          />
        ) : null}
        {canReadStructures ? (
          <LinkRow
            first={!canReadHeads}
            icon="stack"
            title={copy.fees.setup.structuresRow}
            detail={
              structures.data
                ? copy.fees.setup.structuresDetail(structures.data.length)
                : copy.fees.setup.structuresHint
            }
            accessibilityHint={copy.fees.setup.structuresHint}
            onPress={() => router.push("/fees/setup/structures")}
            testID="fee-setup-structures"
          />
        ) : null}
        {canReadStructures ? (
          <LinkRow
            first={false}
            icon="collect"
            title={copy.fees.setup.servicesRow}
            detail={copy.fees.setup.servicesDetail}
            accessibilityHint={copy.fees.setup.servicesHint}
            onPress={() => router.push("/fees/setup/services")}
            testID="fee-setup-services"
          />
        ) : null}
      </Card>

      <GenerationCard />
    </View>,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
});
