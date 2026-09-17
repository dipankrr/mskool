"use client";

import {
  KeyRoundIcon,
  PencilIcon,
  RotateCcwIcon,
  UserRoundXIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useActiveContext } from "@/features/session/active-context";
import {
  DeactivateStaffDialog,
  EditStaffDialog,
} from "@/features/staff/staff-form-dialogs";
import { StaffLoginDialog } from "@/features/staff/staff-login-dialog";
import { StaffRolesCard } from "@/features/staff/staff-roles-card";
import { useStaff, useStaffMutations } from "@/features/staff/use-staff";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";

/**
 * THE STAFF MEMBER'S RECORD — employment, login, roles.
 *
 * Three cards, each answering its own permission question on the students
 * detail model: the register fields (staff:read, edit under staff:update),
 * the login card (create/reset under staff:update — ADR-035's hand-off
 * copy states the forced change and the session revocation), and the roles
 * card (role_assignment:read/assign/revoke). A caller who can read but not
 * manage sees the record read-only, never a failed screen.
 */
export default function StaffDetailPage() {
  const params = useParams<{ staffId: string }>();
  const staffId = params.staffId ?? "";

  const { has } = useActiveContext();
  const staff = useStaff(staffId);
  const { update, deactivate, reactivate, createLogin, resetLogin } =
    useStaffMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<"create" | "reset" | null>(null);

  const canUpdate = has("staff:update");
  const canDeactivate = has("staff:delete");

  if (staff.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <span className="text-muted-foreground text-sm">{copy.common.loading}</span>
      </div>
    );
  }

  if (staff.error || !staff.data) {
    return (
      <EmptyState
        icon={UsersIcon}
        title={copy.staff.noResultsTitle}
        description={copy.staff.noResultsBody}
        action={
          <Link href="/staff" className={buttonVariants({ variant: "outline" })}>
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  const member = staff.data;
  const hasLogin = Boolean(member.userId);
  const isActive = member.status === "active";

  return (
    <>
      <Breadcrumb className="mb-2">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/staff" />}>
              {copy.nav.staff}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {[member.firstName, member.lastName].filter(Boolean).join(" ")}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={[member.firstName, member.middleName, member.lastName]
          .filter(Boolean)
          .join(" ")}
        description={`${member.designation ?? copy.common.none} · ${copy.staff.statuses[member.status]}`}
        actions={
          <>
            {canUpdate ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon data-icon="inline-start" />
                {copy.common.edit}
              </Button>
            ) : null}
            {canDeactivate && isActive ? (
              <Button variant="outline" onClick={() => setDeactivateOpen(true)}>
                <UserRoundXIcon data-icon="inline-start" />
                {copy.staff.deactivateLabel}
              </Button>
            ) : null}
            {canDeactivate && !isActive ? (
              <Button variant="outline" onClick={() => setReactivateOpen(true)}>
                <RotateCcwIcon data-icon="inline-start" />
                {copy.staff.reactivateLabel}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{copy.staff.subtitle}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Definition label={copy.staff.fields.employeeCode}>
                  <Badge variant="outline">{member.employeeCode}</Badge>
                </Definition>
                <Definition label={copy.staff.fields.designation}>
                  {member.designation ?? copy.common.none}
                </Definition>
                <Definition label={copy.staff.fields.department}>
                  {member.department ?? copy.common.none}
                </Definition>
                <Definition label={copy.staff.fields.qualification}>
                  {member.qualification ?? copy.common.none}
                </Definition>
                <Definition label={copy.staff.fields.dateOfJoining}>
                  {member.dateOfJoining ? formatIsoDate(member.dateOfJoining) : copy.common.none}
                </Definition>
                <Definition label={copy.staff.fields.dateOfBirth}>
                  {member.dateOfBirth ? formatIsoDate(member.dateOfBirth) : copy.common.none}
                </Definition>
                <Definition label={copy.staff.fields.phone}>
                  {member.phone ?? copy.common.none}
                </Definition>
                <Definition label={copy.staff.fields.email}>
                  {member.email ?? copy.common.none}
                </Definition>
                {member.dateOfLeaving ? (
                  <Definition label={copy.staff.fields.dateOfLeaving}>
                    {formatIsoDate(member.dateOfLeaving)}
                  </Definition>
                ) : null}
              </div>
              {member.status !== "active" ? (
                <>
                  <Separator />
                  <p className="text-muted-foreground text-sm">
                    {copy.staff.deactivateBody}
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>

          <StaffRolesCard userId={member.userId ?? ""} hasLogin={hasLogin} />
        </div>

        <div className="flex w-full flex-col gap-6 lg:w-80">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRoundIcon className="size-4" />
                {copy.staff.loginTitle}
              </CardTitle>
              <CardDescription>
                {!isActive && hasLogin
                  ? copy.staff.loginInactiveSessions
                  : hasLogin
                    ? copy.staff.loginActive
                    : copy.staff.loginNone}
              </CardDescription>
            </CardHeader>
            {canUpdate && (isActive || hasLogin) ? (
              <CardContent>
                {isActive && !hasLogin ? (
                  <Button
                    variant="default"
                    onClick={() => setLoginMode("create")}
                  >
                    {copy.staff.loginCreate}
                  </Button>
                ) : null}
                {hasLogin ? (
                  <Button
                    variant="outline"
                    onClick={() => setLoginMode("reset")}
                  >
                    {copy.staff.loginReset}
                  </Button>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        </div>
      </div>

      <EditStaffDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        staff={member}
        pending={update.isPending}
        onSubmit={async (data) => {
          try {
            await update.submit(member.id, data);
            setEditOpen(false);
          } catch {
            // The error toast is shown by the hook; the form stays.
          }
        }}
      />

      <DeactivateStaffDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        pending={deactivate.isPending}
        onConfirm={async (data) => {
          try {
            await deactivate.submit(member.id, data);
            setDeactivateOpen(false);
          } catch {
            // The error toast is shown by the hook; the form stays.
          }
        }}
      />

      <ConfirmDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        title={copy.staff.reactivateTitle}
        consequence={copy.staff.reactivateBody}
        confirmLabel={copy.staff.reactivateLabel}
        pending={reactivate.isPending}
        onConfirm={() => {
          reactivate
            .submit(member.id)
            .then(() => setReactivateOpen(false))
            .catch(() => {
              // The error toast is shown by the hook; the dialog stays.
            });
        }}
      />

      {loginMode ? (
        <StaffLoginDialog
          open
          onOpenChange={(open) => {
            if (!open) setLoginMode(null);
          }}
          mode={loginMode}
          staffName={[member.firstName, member.lastName].filter(Boolean).join(" ")}
          pending={loginMode === "create" ? createLogin.isPending : resetLogin.isPending}
          onSubmit={async (password) => {
            try {
              if (loginMode === "create") {
                await createLogin.submit(member.id, password);
              } else {
                await resetLogin.submit(member.id, password);
              }
              setLoginMode(null);
            } catch {
              // The error toast is shown by the hook; the form stays.
            }
          }}
        />
      ) : null}
    </>
  );
}

function Definition({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
