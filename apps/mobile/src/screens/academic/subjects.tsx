import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../components/capsule-button";
import { EntityCard } from "../../components/entity-card";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { AcademicListFrame } from "./list-frame";

type SubjectRow = inferRouterOutputs<AppRouter>["subject"]["list"][number];

/** The school's subjects (Step 2 chunk B). */
export function SubjectsScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("subject:read");
  const canCreate = has("subject:create");
  const canOpen = has("subject:update") || has("subject:delete");

  const list = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  return (
    <AcademicListFrame
      title={copy.academic.subjects.title}
      meta={branchName}
      canRead={canRead}
      deniedTitle={copy.academic.denied.subjectsReadTitle}
      deniedPermission="subject:read"
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={list.isPending}
      error={list.error ?? null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={(list.data ?? []).length === 0}
      emptyTitle={copy.academic.subjects.emptyTitle}
      emptyBody={copy.academic.subjects.emptyBody}
      emptyIcon="edit"
      emptyAction={
        canCreate ? (
          <CapsuleButton
            title={copy.academic.subjects.add}
            icon="add"
            onPress={() => router.push("/subject-form")}
            testID="subjects-empty-add"
          />
        ) : null
      }
      action={
        canRead && canCreate
          ? {
              label: copy.academic.subjects.add,
              icon: "add" as const,
              onPress: () => router.push("/subject-form"),
              accessibilityHint: copy.academic.subjects.addHint,
              testID: "subjects-add",
            }
          : undefined
      }
      titleTestID="subjects-title"
    >
      {(list.data ?? []).map((row: SubjectRow) => (
        <EntityCard
          key={row.id}
          title={row.name}
          meta={[row.shortName, row.code].filter(Boolean).join(" · ") || null}
          icon="edit"
          onPress={
            canOpen
              ? () =>
                  router.push({
                    pathname: "/subject-form",
                    params: { id: row.id },
                  })
              : undefined
          }
          accessibilityHint={canOpen ? copy.academic.subjects.openHint : undefined}
          testID={`subject-card-${row.id}`}
        />
      ))}
    </AcademicListFrame>
  );
}
