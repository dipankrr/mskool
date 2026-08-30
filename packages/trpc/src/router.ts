// The health check lives in trpc.ts beside the builders it needs — see the
// comment there for why no ungated builder is exported instead.
import { healthRouter, router } from "./trpc";
import { academicRouter } from "./routers/academic.router";
import { assignmentRouter } from "./routers/assignment.router";
import { meRouter } from "./routers/me.router";
import { schoolRouter } from "./routers/school.router";
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
  // The teaching-assignment layer: assignment.subjectMapping.* (which subjects
  // a class takes in a year) and assignment.teacherAssignment.* (who teaches
  // what where, append-on-change).
  assignment: assignmentRouter,
});





export type AppRouter = typeof appRouter;
export { createContext } from "./context";
