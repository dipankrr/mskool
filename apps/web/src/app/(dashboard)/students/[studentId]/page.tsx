"use client";

import {
  ArrowLeftIcon,
  PencilIcon,
  UserRoundXIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AssignSectionDialog,
} from "@/features/students/assign-section-dialog";
import { EnrollDialog } from "@/features/students/enroll-dialog";
import { StudentEditDialog } from "@/features/students/student-edit-dialog";
import {
  useStudent,
  useStudentEnrollments,
  useStudentMutations,
} from "@/features/students/use-students";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";

/**
 * THE STUDENT'S RECORD — identity, this session's enrollment, and the
 * actions. The completion of the admission flow: admit (register) → enroll →
 * assign section.
 *
 * The enrollment card shows THE ACTIVE SESSION, the same year anchor the
 * switcher points at, because that is the session the user is working in.
 * Its three states match the status machine's admission track:
 *   - not enrolled   → the Enroll action (admitted, optionally with a section);
 *   - enrolled, no section → the Assign-section action;
 *   - sectioned      → the settled state, with NO re-pointing: moving a
 *     student mid-year is a transfer (section_transfer_log, not built), and
 *     the UI says so rather than offering an edit that would lie about history.
 */
export default function StudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId ?? "";
  const router = useRouter();

  const { has, activeSession } = useActiveContext();
  const student = useStudent(studentId);
  const enrollments = useStudentEnrollments();
  const classes = useClasses();
  const sections = useSections();
  const { update, deactivate, enroll, assignSection } = useStudentMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const canUpdate = has("student:update");
  const canDeactivate = has("student:delete");
  const canEnroll = has("enrollment:create");
  const canAssign = has("enrollment:update");

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const cls of classes.data ?? []) map.set(cls.id, cls.name);
    return map;
  }, [classes.data]);

  const sectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections.data ?? []) map.set(section.id, section.name);
    return map;
  }, [sections.data]);

  const enrollment = useMemo(
    () =>
      (enrollments.data ?? []).find((pair) => pair.student.id === studentId)?.enrollment,
    [enrollments.data, studentId],
  );

  if (student.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <span className="text-muted-foreground text-sm">{copy.common.loading}</span>
      </div>
    );
  }

  if (student.error || !student.data) {
    return (
      <EmptyState
        icon={UsersIcon}
        title={copy.students.noResultsTitle}
        description={copy.students.noResultsBody}
        action={
          <Link href="/students" className={buttonVariants({ variant: "outline" })}>
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  const row = student.data;

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/students" />}>
              {copy.nav.students}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{row.admissionNumber}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={[row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ")}
        description={copy.students.detailSubtitle}
        actions={
          <>
            <Link href="/students" className={buttonVariants({ variant: "outline" })}>
              <ArrowLeftIcon data-icon="inline-start" />
              {copy.common.back}
            </Link>
            <PermissionGate permission="student:update">
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon data-icon="inline-start" />
                {copy.students.edit}
              </Button>
            </PermissionGate>
            <PermissionGate permission="student:delete">
              <Button variant="destructive" onClick={() => setClosing(true)}>
                <UserRoundXIcon data-icon="inline-start" />
                {copy.students.deactivate}
              </Button>
            </PermissionGate>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{copy.students.fields.admissionNumber}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Detail label={copy.students.fields.admissionNumber}>
              <Badge variant="outline">{row.admissionNumber}</Badge>
            </Detail>
            <Detail label={copy.students.fields.gender}>
              {copy.students.genders[row.gender]}
            </Detail>
            <Detail label={copy.students.fields.dateOfBirth}>
              {formatIsoDate(row.dateOfBirth)}
            </Detail>
            {row.admissionDate ? (
              <Detail label={copy.students.fields.admissionDate}>
                {formatIsoDate(row.admissionDate)}
              </Detail>
            ) : null}
            {row.phone ? (
              <Detail label={copy.students.fields.phone}>{row.phone}</Detail>
            ) : null}
            {row.email ? (
              <Detail label={copy.students.fields.email}>{row.email}</Detail>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{copy.students.enrollment.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {activeSession ? (
              <Detail label={copy.terms.session}>{activeSession.name}</Detail>
            ) : null}

            {!enrollment ? (
              <>
                <p className="text-muted-foreground text-sm">
                  {copy.students.enrollment.none}
                </p>
                <PermissionGate permission="enrollment:create">
                  <Button
                    className="w-fit"
                    onClick={() => setEnrollOpen(true)}
                    disabled={!activeSession}
                  >
                    {copy.students.enrollment.enroll}
                  </Button>
                </PermissionGate>
              </>
            ) : (
              <>
                <Detail label={copy.students.enrollment.class}>
                  {classNameById.get(enrollment.classId) ?? copy.common.none}
                </Detail>
                <Detail label={copy.students.enrollment.section}>
                  {enrollment.sectionId ? (
                    sectionNameById.get(enrollment.sectionId) ?? copy.common.none
                  ) : (
                    <Badge variant="outline">{copy.students.enrollment.noSection}</Badge>
                  )}
                </Detail>
                {enrollment.rollNumber ? (
                  <Detail label={copy.students.enrollment.rollNumber}>
                    {enrollment.rollNumber}
                  </Detail>
                ) : null}
                <Detail label={copy.students.enrollment.statusLabel}>
                  <Badge variant="outline">
                    {
                      copy.students.enrollmentStatuses[
                        enrollment.enrollmentStatus as keyof typeof copy.students.enrollmentStatuses
                      ]
                    }
                  </Badge>
                </Detail>

                {!enrollment.sectionId && canAssign ? (
                  <>
                    <Separator />
                    <Button
                      className="w-fit"
                      variant="outline"
                      onClick={() => setAssignOpen(true)}
                    >
                      {copy.students.enrollment.assignSection}
                    </Button>
                  </>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <StudentEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        student={row}
        pending={update.isPending}
        onSubmit={async (data) => {
          try {
            await update.submit(studentId, data);
            setEditOpen(false);
          } catch {
            // The error toast is shown by the hook; the form stays.
          }
        }}
      />

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={copy.students.deactivateTitle}
        consequence={copy.students.deactivateBody}
        confirmLabel={copy.students.deactivateConfirm}
        destructive
        pending={deactivate.isPending}
        onConfirm={() => {
          deactivate.submit(studentId);
          setClosing(false);
          router.push("/students");
        }}
      />

      <EnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        pending={enroll.isPending}
        onSubmit={async ({ classId, sectionId }) => {
          try {
            await enroll.submit({
              studentId,
              academicYearId: activeSession?.id ?? "",
              classId,
              ...(sectionId ? { sectionId } : {}),
            });
            setEnrollOpen(false);
          } catch {
            // The error toast is shown by the hook; the form stays.
          }
        }}
      />

      <AssignSectionDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        pending={assignSection.isPending}
        onSubmit={async ({ sectionId, rollNumber }) => {
          try {
            await assignSection.submit(enrollment?.id ?? "", sectionId, rollNumber);
            setAssignOpen(false);
          } catch {
            // The error toast is shown by the hook; the form stays.
          }
        }}
      />
    </>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
