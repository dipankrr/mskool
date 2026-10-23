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

type ClassRow = inferRouterOutputs<AppRouter>["academic"]["class"]["list"][number];

/** The school's classes (Step 2 chunk B) — the structure list, ordered by the server. */
export function ClassesScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("class:read");
  const canCreate = has("class:create");
  const canOpen = has("class:update") || has("class:delete");

  const list = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canRead },
  );

  return (
    <AcademicListFrame
      title={copy.academic.classes.title}
      meta={branchName}
      canRead={canRead}
      deniedTitle={copy.academic.denied.classesReadTitle}
      deniedPermission="class:read"
      ready={ready}
      hasOrg={Boolean(organizationId)}
      pending={list.isPending}
      error={list.error ?? null}
      onRetry={() => void list.refetch()}
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
      isEmpty={(list.data ?? []).length === 0}
      emptyTitle={copy.academic.classes.emptyTitle}
      emptyBody={copy.academic.classes.emptyBody}
      emptyIcon="stack"
      emptyAction={
        canCreate ? (
          <CapsuleButton
            title={copy.academic.classes.add}
            icon="add"
            onPress={() => router.push("/class-form")}
            testID="classes-empty-add"
          />
        ) : null
      }
      action={
        canRead && canCreate
          ? {
              label: copy.academic.classes.add,
              icon: "add" as const,
              onPress: () => router.push("/class-form"),
              accessibilityHint: copy.academic.classes.addHint,
              testID: "classes-add",
            }
          : undefined
      }
      titleTestID="classes-title"
    >
      {(list.data ?? []).map((row: ClassRow) => (
        <EntityCard
          key={row.id}
          title={row.name}
          meta={[copy.academic.classes.meta(row.numericOrder), row.description]
            .filter(Boolean)
            .join(" · ")}
          icon="stack"
          onPress={
            canOpen
              ? () =>
                  router.push({
                    pathname: "/class-form",
                    params: { id: row.id },
                  })
              : undefined
          }
          accessibilityHint={canOpen ? copy.academic.classes.openHint : undefined}
          testID={`class-card-${row.id}`}
        />
      ))}
    </AcademicListFrame>
  );
}
