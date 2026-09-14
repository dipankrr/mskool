"use client";

import { ArrowLeftIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  usePermissionDefaults,
  useRoleHolders,
  useRolePermissions,
} from "@/features/staff/use-staff";
import { ROLE_TYPES } from "@/features/staff/staff-roles-card";
import { PermissionEditorDialog } from "@/features/staff/permission-editor-dialog";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import type { RoleType } from "@repo/contracts";

/**
 * ONE ROLE'S CONFIGURATION — what it may do, and who holds it (ADR-036).
 *
 * The editor dialog from the staff pages is the same component; what changed
 * is the altitude: this page is the role's home, so configuration is
 * reachable even when the role has no holders, and "who holds this power"
 * sits beside "what this power is". The org_admin lock renders statically;
 * the self-role lock remains the server's honest refusal.
 */
export default function RoleDetailPage() {
  const params = useParams<{ roleType: string }>();
  const roleType = params.roleType as RoleType;
  const isValid = (ROLE_TYPES as readonly string[]).includes(roleType);

  const { has } = useActiveContext();
  const canRead = isValid && has("role_permission:read");
  const matrix = useRolePermissions(canRead);
  const holders = useRoleHolders(canRead);
  const defaultsQuery = usePermissionDefaults(
    canRead && has("role_permission:update"),
  );

  const [editorOpen, setEditorOpen] = useState(false);

  if (!isValid) {
    return (
      <EmptyState
        icon={ShieldCheckIcon}
        title={copy.staff.noResultsTitle}
        description={copy.staff.noResultsBody}
        action={
          <Link href="/roles" className={buttonVariants({ variant: "outline" })}>
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  if (!canRead) {
    return (
      <EmptyState
        icon={ShieldCheckIcon}
        title={copy.errors.forbidden}
        description={copy.errors.forbidden}
        action={
          <Link href="/roles" className={buttonVariants({ variant: "outline" })}>
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  const roleLabel =
    copy.staff.roles[roleType as keyof typeof copy.staff.roles];
  const permissions = (matrix.data ?? [])
    .filter((row) => row.roleType === roleType)
    .map((row) => row.permission);
  const roleHolders = (holders.data ?? []).filter(
    (row) => row.roleType === roleType,
  );

  const defaultsForRole = new Set(
    (defaultsQuery.data?.defaults ?? [])
      .filter((row) => row.roleType === roleType)
      .map((row) => row.permission),
  );
  const differsFromDefaults =
    defaultsForRole.size > 0 &&
    (permissions.length !== defaultsForRole.size ||
      permissions.some((p) => !defaultsForRole.has(p)));

  const isBootstrap = roleType === "org_admin";
  const canEdit = has("role_permission:update") && !isBootstrap;

  return (
    <>
      <Breadcrumb className="mb-2">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/roles" />}>
              {copy.nav.roles}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{roleLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={roleLabel}
        description={copy.staff.roleDetailSubtitle}
        actions={
          canEdit ? (
            <Button onClick={() => setEditorOpen(true)}>
              {copy.staff.editorEdit}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <ShieldCheckIcon className="size-4" />
              {copy.staff.matrixTitle}
              {differsFromDefaults ? (
                <Badge variant="secondary">{copy.staff.editorModified}</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {isBootstrap
                ? copy.staff.editorLockedBootstrap
                : copy.staff.editorHelp}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-1">
              {permissions.sort().map((permission) => (
                <li key={permission}>
                  <Badge variant="outline" className="font-mono text-xs">
                    {permission}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRoundIcon className="size-4" />
              {copy.staff.holdersTitle}
            </CardTitle>
            <CardDescription>{copy.staff.holdersEmpty}</CardDescription>
          </CardHeader>
          <CardContent>
            {roleHolders.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {copy.staff.holdersEmpty}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {roleHolders.map((holder) => (
                  <li key={holder.staffId}>
                    <Link
                      href={`/staff/${holder.staffId}`}
                      className="hover:bg-accent flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:underline"
                    >
                      {holder.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {editorOpen ? (
        <PermissionEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditorOpen(false);
          }}
          roleType={roleType}
          roleLabel={roleLabel}
          currentPermissions={permissions}
        />
      ) : null}

      {/* Back to the area */}
      <div className="mt-6">
        <Link href="/roles" className={buttonVariants({ variant: "ghost" })}>
          <ArrowLeftIcon data-icon="inline-start" />
          {copy.nav.roles}
        </Link>
      </div>
    </>
  );
}
