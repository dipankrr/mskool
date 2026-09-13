// The health check lives in trpc.ts beside the builders it needs — see the
// comment there for why no ungated builder is exported instead.
import { healthRouter, router } from "./trpc";
import { academicRouter } from "./routers/academic.router";
import { assignmentRouter } from "./routers/assignment.router";
import { attendanceRouter } from "./routers/attendance.router";
import { enrollmentRouter, portalRouter } from "./routers/enrollment.router";
import { examRouter, portalExamRouter } from "./routers/exam.router";
import { feesRouter } from "./routers/fees.router";
import { meRouter } from "./routers/me.router";
import { portalAccessRouter } from "./routers/portal-access.router";
import { roleRouter } from "./routers/role.router";
import { schoolRouter } from "./routers/school.router";
import { staffRouter } from "./routers/staff.router";
import { studentRouter } from "./routers/student.router";
import { subjectRouter } from "./routers/subject.router";

// Domain routers land here as each phase ships — see docs/TASKS.md.
// Staff routers are namespaced <domain>.*; student portal routers portal.*.
export const appRouter = router({
  health: healthRouter,
  // Not namespaced by domain: `me` is about the caller, not a domain, and it is
  // the call that supplies the organizationId every other staff route requires.
  me: meRouter,
  school: schoolRouter,
  // Academic structure: academic.year.*, academic.class.*, academic.section.*.
  academic: academicRouter,
  // The school's subject catalogue: subject.list, subject.byId, …
  subject: subjectRouter,
  // The identity registry: student.list/byId/create/update/deactivate. The
  // year anchor (rosters) lives on the enrollment router beside it.
  student: studentRouter,
  // The teaching-assignment layer: assignment.subjectMapping.* (which subjects
  // a class takes in a year) and assignment.teacherAssignment.* (who teaches
  // what where, append-on-change).
  assignment: assignmentRouter,
  // The year anchor: enrollment.* on the staff track.
  enrollment: enrollmentRouter,
  // Attendance: attendance.calendar.* (the marking gate), attendance.policy.*,
  // attendance.period.* — marking/status/summary join in C6.
  attendance: attendanceRouter,
  // Fees: fee.head.*, fee.structure.* (lines + late-fee rules),
  // fee.subscription.*, fee.assignment.* (assign + generate + concessions),
  // fee.installment.* (dues + waive), fee.payment.* (record + transitions +
  // refunds), fee.ledger.* (the ledger + opening balances).
  fees: feesRouter,
  // The student portal: portal.enrollment.* — ownership only, no can(). More
  // portal domains join this sub-router as they land.
  portal: portalRouter,
  // Exams: exam.subjectTypes.* / gradingScales.* / passCriteria.* / exam.* /
  // schedules.* / components.* / eligibility.* / marks.* (the autosave cell
  // is subject-gated, ADR-029) / results.* / publication.* / cards.* — and
  // the portal's ONLY exam door, portal.exam.results.*, reading published
  // snapshots exclusively (hard rule 8).
  exam: examRouter,
  portalExam: portalExamRouter,
  // Staff administration of the family login's credential (ADR-007): each
  // action is its own permission; audit rows + session revocation are the
  // service's business.
  portalAccess: portalAccessRouter,
  // The employment register and its login provisioning (ADR-008, ADR-035):
  // staff.list/byId/create/update/deactivate + the login acts.
  staff: staffRouter,
  // Role assignments: grant at the addressed scope, revoke with a reason,
  // and the read-only permission matrix (ADR-005, ADR-035).
  role: roleRouter,
});





export type AppRouter = typeof appRouter;
export { createContext } from "./context";
