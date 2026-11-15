import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";

/**
 * Every read Home makes (ADR-072), each gated on the permission hint that
 * makes its card possible. The hints only decide whether to ask; the server
 * decides what comes back (a teacher's `attendanceToday` is her sections, a
 * principal's the branch). A read that fails takes only its own card down.
 */
export function useHomeData({ allBranches }: { allBranches: boolean }) {
  const { me } = useMe();
  const { organizationId, schoolId, academicYear, currentYear } = useActiveContext();
  const { has, hasAny } = usePermissions();
  const today = todayIso();

  const orgId = organizationId ?? "";
  const branch = schoolId ?? "";
  // Today's cards belong to the running session; a past session hides them.
  const running = Boolean(academicYear && currentYear && academicYear.id === currentYear.id);
  const yearId = currentYear?.id ?? "";
  const branchReady = Boolean(organizationId && schoolId && currentYear) && running && !allBranches;

  const membership = me?.memberships.find((m) => m.organization.id === organizationId);

  const can = {
    readAttendance: has("attendance:read"),
    markAttendance: has("attendance:create"),
    readHomework: has("homework:read"),
    readFees: has("fee_report:read"),
    collect: has("fee_payment:create"),
    approvePayments: has("fee_payment:approve"),
    assignTeachers: has("teacher_assignment:create"),
    readStaff: has("staff:read"),
    placeStudents: has("enrollment:update"),
    admit: has("student:create"),
    readStudents: has("student:read"),
    readExams: has("exam:read"),
    publishResults: hasAny("report_card:publish", "marks:publish"),
  };

  const mine = trpc.assignment.mine.useQuery(
    { organizationId: orgId, schoolId: branch },
    { enabled: Boolean(organizationId && schoolId) && running && !allBranches, staleTime: 60_000 },
  );
  const teaches = (mine.data?.length ?? 0) > 0;
  const hasPairs = (mine.data ?? []).some((row) => row.subjectId);

  const attendance = trpc.home.attendanceToday.useQuery(
    { organizationId: orgId, schoolId: branch, academicYearId: yearId, date: today },
    { enabled: branchReady && can.readAttendance, staleTime: 30_000, refetchOnWindowFocus: true },
  );

  const papers = trpc.home.myPapers.useQuery(
    { organizationId: orgId, schoolId: branch, date: today },
    { enabled: branchReady && hasPairs, staleTime: 60_000 },
  );

  // The homework home answers for the caller's own teaching; only a teacher asks.
  const homework = trpc.homework.home.useQuery(
    { organizationId: orgId, schoolId: branch },
    { enabled: branchReady && can.readHomework && teaches, staleTime: 60_000 },
  );

  const fees = trpc.fees.dashboard.overview.useQuery(
    { organizationId: orgId, schoolId: branch, academicYearId: yearId },
    { enabled: branchReady && can.readFees, staleTime: 60_000, retry: false },
  );

  const teaching = trpc.assignment.overview.useQuery(
    { organizationId: orgId, schoolId: branch, academicYearId: yearId },
    { enabled: branchReady && can.assignTeachers, staleTime: 120_000, retry: false },
  );

  const roster = trpc.student.rosterSummary.useQuery(
    { organizationId: orgId, schoolId: branch, academicYearId: yearId },
    { enabled: branchReady && can.readStudents && (can.placeStudents || can.admit), staleTime: 120_000, retry: false },
  );

  const staff = trpc.staff.list.useQuery(
    { organizationId: orgId, schoolId: branch },
    { enabled: branchReady && can.readStaff, staleTime: 120_000, retry: false },
  );

  const org = trpc.home.org.useQuery(
    { organizationId: orgId, date: today },
    { enabled: Boolean(organizationId) && allBranches, staleTime: 120_000, retry: false },
  );

  return {
    today,
    running,
    membership,
    can,
    mine,
    teaches,
    attendance,
    papers,
    homework,
    fees,
    teaching,
    roster,
    staff,
    org,
  };
}

export type HomeData = ReturnType<typeof useHomeData>;
