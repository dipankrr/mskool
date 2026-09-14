"use client";

import { PencilIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBranches } from "@/features/branches/use-branches";
import {
  usePermissionDefaults,
  useRoleMutations,
  useRolePermissions,
  useStaffRoles,
} from "@/features/staff/use-staff";
import { PermissionEditorDialog } from "@/features/staff/permission-editor-dialog";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import type { RoleType } from "@repo/contracts";
import type { RoleAssignmentView } from "@/lib/trpc/types";

/**
 * ROLES — the staff member's assignments, the assign/revoke dialogs, and the
 * org's read-only permission matrix.
 *
 * The assign dialog addresses the TARGET node: an org-wide grant sends the
 * organization id as the addressed node, a branch grant sends the branch's
 * id — the server gates the grant against exactly that node, so the dialog
 * never offers a scope the caller cannot cover. Class/section-level grants
 * exist in the data model but are the timetable's business; HR grants at org
 * or branch level, which is what this picker offers.
 *
 * Revoke requires a REASON (the audit row is the point), so it opens a form
 * with a minimum-length field, not a bare confirm.
 */

const ROLE_TYPES = [
  "org_admin",
  "principal",
  "vice_principal",
  "class_teacher",
  "subject_teacher",
  "accountant",
  "librarian",
  "staff_coordinator",
] as const;

type ScopeChoice = "org" | "school";

export function StaffRolesCard({ userId }: { userId: string }) {
  const { has } = useActiveContext();
  const roles = useStaffRoles(userId);
  const { assign, revoke } = useRoleMutations();

  const [assignOpen, setAssignOpen] = useState(false);
  const [revoking, setRevoking] = useState<RoleAssignmentView | null>(null);

  const canAssign = has("role_assignment:assign");
  const canRevoke = has("role_assignment:revoke");

  const assignments = roles.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{copy.staff.rolesTitle}</CardTitle>
            <CardDescription>{copy.staff.roleAssignHelp}</CardDescription>
          </div>
          {canAssign ? (
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              {copy.staff.roleAssign}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.staff.rolesEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {copy.staff.roles[assignment.roleType]}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {assignment.scopeLabel}
                    {assignment.expiresAt
                      ? ` · ${formatIsoDate(assignment.expiresAt)}`
                      : ""}
                  </span>
                </div>
                {canRevoke ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevoking(assignment)}
                  >
                    {copy.staff.revoke}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {assignOpen ? (
        <AssignRoleDialog
          open
          onOpenChange={setAssignOpen}
          onSubmit={async (input) => {
            try {
              await assign.submit({ ...input, userId });
              setAssignOpen(false);
            } catch {
              // The error toast is shown by the hook; the form stays.
            }
          }}
          pending={assign.isPending}
        />
      ) : null}

      {revoking ? (
        <RevokeRoleDialog
          open
          onOpenChange={(open) => {
            if (!open) setRevoking(null);
          }}
          assignment={revoking}
          onSubmit={async (reason) => {
            try {
              await revoke.submit(revoking.id, reason);
              setRevoking(null);
            } catch {
              // The error toast is shown by the hook; the form stays.
            }
          }}
          pending={revoke.isPending}
        />
      ) : null}
    </Card>
  );
}

function AssignRoleDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    id: string;
    roleType: RoleType;
    scopeType: ScopeChoice;
    expiresAt?: string;
  }) => void;
  pending: boolean;
}) {
  const { scopeArgs } = useActiveContext();
  const branches = useBranches();

  const [roleType, setRoleType] = useState<RoleType>("subject_teacher");
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>("school");
  const [schoolId, setSchoolId] = useState<string>("");
  const [expires, setExpires] = useState("");
  const [touched, setTouched] = useState(false);

  const schools = branches.data ?? [];
  const branchMissing = scopeChoice === "school" && !schoolId;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.staff.roleAssignTitle}
      description={copy.staff.roleAssignHelp}
      submitLabel={copy.staff.roleAssign}
      pending={pending}
      onSubmit={() => {
        setTouched(true);
        const id =
          scopeChoice === "org"
            ? // An org grant's target IS the organization id (ADR-019).
              scopeArgs().organizationId
            : schoolId;
        if (!id) return;
        onSubmit({
          id,
          roleType,
          scopeType: scopeChoice,
          ...(expires
            ? { expiresAt: new Date(`${expires}T23:59:59`).toISOString() }
            : {}),
        });
      }}
    >
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="assign-role">{copy.staff.role}</FieldLabel>
          <Select value={roleType} onValueChange={(value) => value && setRoleType(value as RoleType)}>
            <SelectTrigger id="assign-role">
              <SelectValue>
                {(value: string | null) =>
                  value
                    ? copy.staff.roles[value as (typeof ROLE_TYPES)[number]]
                    : copy.common.none
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ROLE_TYPES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {copy.staff.roles[role]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="assign-scope">{copy.staff.scope}</FieldLabel>
          <Select
            value={scopeChoice}
            onValueChange={(value) => setScopeChoice(value as ScopeChoice)}
          >
            <SelectTrigger id="assign-scope">
              <SelectValue>
                {(value: string | null) =>
                  value === "org"
                    ? copy.staff.scopeOrg
                    : value === "school"
                      ? copy.staff.scopeSchool
                      : copy.common.none
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="org">{copy.staff.scopeOrg}</SelectItem>
                <SelectItem value="school">{copy.staff.scopeSchool}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        {scopeChoice === "school" ? (
          <Field data-invalid={touched && branchMissing ? true : undefined}>
            <FieldLabel htmlFor="assign-branch">{copy.staff.scopeBranchLabel}</FieldLabel>
            <Select value={schoolId} onValueChange={(value) => value && setSchoolId(value)}>
              <SelectTrigger
                id="assign-branch"
                aria-invalid={touched && branchMissing ? true : undefined}
              >
                <SelectValue>
                  {(value: string | null) =>
                    schools.find((s) => s.id === value)?.name ?? copy.common.none
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {touched && branchMissing ? (
              <FieldError>{copy.staff.scopeBranchLabel}</FieldError>
            ) : null}
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="assign-expires">{copy.staff.expires}</FieldLabel>
          <Input
            id="assign-expires"
            type="date"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
          <FieldDescription>{copy.staff.expiresHelp}</FieldDescription>
        </Field>
      </div>
    </FormDialog>
  );
}

function RevokeRoleDialog({
  open,
  onOpenChange,
  assignment,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: RoleAssignmentView;
  onSubmit: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const tooShort = reason.trim().length > 0 && reason.trim().length < 3;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.staff.revokeTitle}
      description={`${copy.staff.roles[assignment.roleType]} · ${assignment.scopeLabel}`}
      submitLabel={copy.staff.revoke}
      pending={pending}
      onSubmit={() => {
        if (tooShort || reason.trim().length === 0) return;
        onSubmit(reason.trim());
      }}
    >
      <Field data-invalid={tooShort ? true : undefined}>
        <FieldLabel htmlFor="revoke-reason">{copy.staff.revokeReason}</FieldLabel>
        <Input
          id="revoke-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-invalid={tooShort ? true : undefined}
        />
        <FieldDescription>{copy.staff.revokeHelp}</FieldDescription>
        {tooShort ? <FieldError>{copy.staff.revokeReason}</FieldError> : null}
      </Field>
    </FormDialog>
  );
}

/**
 * The org's permission matrix, degraded per permission, with ADR-036's
 * editor wired in per role. The `org_admin` lock renders statically (the
 * role's name is the lock); the self-role lock is the server's honest
 * refusal — the client does not know the caller's roles, and the worded
 * toast says exactly what to do.
 */
export function RoleMatrixCard({
  userId,
  enabled,
}: {
  userId: string;
  enabled: boolean;
}) {
  const { has } = useActiveContext();
  const canRead = enabled && has("role_permission:read");
  const matrix = useRolePermissions(canRead);
  const defaultsQuery = usePermissionDefaults(canRead && has("role_permission:update"));
  const roles = useStaffRoles(userId);

  const [editing, setEditing] = useState<string | null>(null);

  const canEdit = has("role_permission:update");

  const ownRoles = useMemo(
    () => new Set<string>((roles.data ?? []).map((a) => a.roleType)),
    [roles.data],
  );

  const byRole = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of matrix.data ?? []) {
      const list = map.get(row.roleType) ?? [];
      list.push(row.permission);
      map.set(row.roleType, list);
    }
    return map;
  }, [matrix.data]);

  const modifiedRoles = useMemo(() => {
    const defaults = defaultsQuery.data?.defaults ?? [];
    const byRoleDefaults = new Map<string, Set<string>>();
    for (const row of defaults) {
      const set = byRoleDefaults.get(row.roleType) ?? new Set<string>();
      set.add(row.permission);
      byRoleDefaults.set(row.roleType, set);
    }
    const modified = new Set<string>();
    for (const [roleType, permissions] of byRole) {
      const roleDefaults = byRoleDefaults.get(roleType);
      if (!roleDefaults) continue;
      if (
        permissions.length !== roleDefaults.size ||
        permissions.some((p) => !roleDefaults.has(p))
      ) {
        modified.add(roleType);
      }
    }
    return modified;
  }, [defaultsQuery.data, byRole]);

  if (!canRead) return null;

  if (byRole.size === 0) return null;

  const editingRoleType = editing as RoleType | null;
  const editingPermissions = editing ? (byRole.get(editing) ?? []) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4" />
          {copy.staff.matrixTitle}
        </CardTitle>
        <CardDescription>{copy.staff.matrixHelp}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {[...byRole.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([roleType, permissions]) => {
            const isBootstrap = roleType === "org_admin";
            const editable = canEdit && !isBootstrap;
            return (
              <details key={roleType} className="rounded-lg border p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  {copy.staff.roles[roleType as keyof typeof copy.staff.roles]}
                  {ownRoles.has(roleType) ? (
                    <Badge variant="secondary">{copy.staff.rolesTitle}</Badge>
                  ) : null}
                  {modifiedRoles.has(roleType) ? (
                    <Badge variant="outline">{copy.staff.editorModified}</Badge>
                  ) : null}
                  <span className="text-muted-foreground ml-auto text-xs">
                    {permissions.length}
                  </span>
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.preventDefault();
                        setEditing(roleType);
                      }}
                    >
                      <PencilIcon data-icon="inline-start" />
                      {copy.staff.editorEdit}
                    </Button>
                  ) : null}
                </summary>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {[...permissions].sort().map((permission) => (
                    <li key={permission}>
                      <Badge variant="outline" className="font-mono text-xs">
                        {permission}
                      </Badge>
                    </li>
                  ))}
                </ul>
                {isBootstrap ? (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {copy.staff.editorLockedBootstrap}
                  </p>
                ) : null}
              </details>
            );
          })}
      </CardContent>

      {editingRoleType ? (
        <PermissionEditorDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          roleType={editingRoleType}
          roleLabel={copy.staff.roles[editingRoleType as keyof typeof copy.staff.roles]}
          currentPermissions={editingPermissions}
        />
      ) : null}
    </Card>
  );
}
