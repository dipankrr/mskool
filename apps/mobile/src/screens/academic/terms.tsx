import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { EntityCard } from "../../components/entity-card";
import { formatReadableDateRange } from "../../lib/format";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { AcademicListFrame } from "./list-frame";

type TermRow = inferRouterOutputs<AppRouter>["academic"]["term"]["list"][number];

/** The running session's terms (Step 2 chunk B) — no delete: a childless term
 * is removed on the web, terms with children never leave. */
export function TermsScreen() {
  const { organizationId, academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("academic_year:read");
  const canCreate = has("academic_year:create");
  const canOpen = has("academic_year:update");

  const list = trpc.academic.term.list.useQuery(
    { organizationId: organizationId ?? "", academicYearId: academicYear?.id ?? "" },
    {
      enabled:
        ready && Boolean(organizationId) && canRead && Boolean(academicYear?.id),
    },
  );

  return (
    <AcademicListFrame
      title={copy.academic.terms.title}
      meta={branchName}
      canRead={canRead}
      deniedTitle={copy.academic.denied.termsReadTitle}
      deniedPermission="academic_year:read"
      needsSession
      academicYear={Boolean(academicYear)}
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={list.isPending}
      error={list.error ?? null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={(list.data ?? []).length === 0}
      emptyTitle={copy.academic.terms.emptyTitle}
      emptyBody={copy.academic.terms.emptyBody}
      emptyIcon="calendar"
      emptyAction={
        canCreate ? (
          <CapsuleButton
            title={copy.academic.terms.add}
            icon="add"
            onPress={() => router.push("/term-form")}
            testID="terms-empty-add"
          />
        ) : null
      }
      action={
        canRead && canCreate
          ? {
              label: copy.academic.terms.add,
              icon: "add" as const,
              onPress: () => router.push("/term-form"),
              accessibilityHint: copy.academic.terms.addHint,
              testID: "terms-add",
            }
          : undefined
      }
      titleTestID="terms-title"
    >
      {(list.data ?? [])
        .slice()
        .sort((a: TermRow, b: TermRow) => a.sequenceNumber - b.sequenceNumber)
        .map((row: TermRow) => (
          <EntityCard
            key={row.id}
            title={row.name}
            meta={[
              formatReadableDateRange(row.startDate, row.endDate),
              copy.academic.terms.feeShare(Number(row.weightage)),
            ]
              .filter(Boolean)
              .join(" · ")}
            icon="calendar"
            onPress={
              canOpen
                ? () =>
                    router.push({
                      pathname: "/term-form",
                      params: { id: row.id },
                    })
                : undefined
            }
            accessibilityHint={canOpen ? copy.academic.terms.openHint : undefined}
            testID={`term-card-${row.id}`}
          />
        ))}
    </AcademicListFrame>
  );
}
