"use client";

import { ChevronRightIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  usePermissionDefaults,
  useRoleHolders,
  useRolePermissions,
} from "@/features/staff/use-staff";
import { ROLE_TYPES } from "@/features/staff/staff-roles-card";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import type { RoleType } from "@repo/contracts";

/**
 * THE ROLES AREA — access configuration at its own altitude (ADR-036).
 *
 * One row per role, ALWAYS all eight: configuration that is only reachable
 * through a role's holders disappears when the last holder leaves, which is
 * exactly when it needs editing. Holder names answer "who actually has this
 * power?", the permission count and the Modified badge answer "how far has
 * this drifted from the shipped defaults?", and the whole row opens the
 * role's detail page — where the editor lives.
 */
export default function RolesPage() {
  const { has } = useActiveContext();
  const canRead = has("role_permission:read");
  const matrix = useRolePermissions(canRead);
  const holders = useRoleHolders(canRead);
  const defaultsQuery = usePermissionDefaults(
    canRead && has("role_permission:update"),
  );

  const byRole = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of matrix.data ?? []) {
      map.set(row.roleType, (map.get(row.roleType) ?? 0) + 1);
    }
    return map;
  }, [matrix.data]);

  const holdersByRole = useMemo(() => {
    const map = new Map<string, { staffId: string; name: string }[]>();
    for (const row of holders.data ?? []) {
      const list = map.get(row.roleType) ?? [];
      list.push({ staffId: row.staffId, name: row.name });
      map.set(row.roleType, list);
    }
    return map;
  }, [holders.data]);

  const modifiedRoles = useMemo(() => {
    const defaults = defaultsQuery.data?.defaults ?? [];
    const byRoleDefaults = new Map<string, Set<string>>();
    for (const row of defaults) {
      const set = byRoleDefaults.get(row.roleType) ?? new Set<string>();
      set.add(row.permission);
      byRoleDefaults.set(row.roleType, set);
    }
    // Set difference, not count difference: a swap at equal size still
    // drifts from the shipped defaults (mirrors the detail page's check).
    const currentByRole = new Map<string, Set<string>>();
    for (const row of matrix.data ?? []) {
      const set = currentByRole.get(row.roleType) ?? new Set<string>();
      set.add(row.permission);
      currentByRole.set(row.roleType, set);
    }
    const modified = new Set<string>();
    for (const [roleType, current] of currentByRole) {
      const roleDefaults = byRoleDefaults.get(roleType);
      if (
        roleDefaults &&
        (roleDefaults.size !== current.size ||
          [...current].some((p) => !roleDefaults.has(p)))
      ) {
        modified.add(roleType);
      }
    }
    return modified;
  }, [defaultsQuery.data, matrix.data]);

  if (!canRead) {
    return (
      <EmptyState
        icon={ShieldCheckIcon}
        title={copy.errors.forbidden}
        description={copy.errors.forbidden}
        action={
          <Link href="/" className={buttonVariants({ variant: "outline" })}>
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader title={copy.nav.roles} description={copy.staff.rolesSubtitle} />

      <div className="flex flex-col gap-3">
        {ROLE_TYPES.map((roleType) => {
          const isBootstrap = roleType === "org_admin";
          const roleHolders = holdersByRole.get(roleType) ?? [];
          return (
            <Link
              key={roleType}
              href={`/roles/${roleType}`}
              className="flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-accent"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {copy.staff.roles[roleType as keyof typeof copy.staff.roles]}
                  </span>
                  {isBootstrap ? (
                    <Badge variant="outline">
                      {copy.staff.editorLockedBootstrap}
                    </Badge>
                  ) : null}
                  {modifiedRoles.has(roleType) ? (
                    <Badge variant="secondary">{copy.staff.editorModified}</Badge>
                  ) : null}
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {roleHolders.length > 0
                    ? roleHolders.map((h) => h.name).join(", ")
                    : copy.staff.holdersEmpty}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge variant="outline">
                  {byRole.get(roleType) ?? 0} {copy.staff.rolesTitle}
                </Badge>
                <ChevronRightIcon className="text-muted-foreground size-4" />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

