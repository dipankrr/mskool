"use client";

import { PencilIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
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
  useRoleMutations,
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

export const ROLE_TYPES = [
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
                  <Link
                    href={`/roles/${assignment.roleType}`}
                    className="font-medium hover:underline"
                  >
                    {copy.staff.roles[assignment.roleType]}
                  </Link>
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
