// import { z } from "zod/v4";
// import { eq } from "drizzle-orm";
// import { exams, examCycles } from "@repo/db/schema";
// import { CreateExamInput, CreateExamCycleInput, ExamResponse, ExamCycleResponse } from "@repo/contracts";
// import { router, publicProcedure } from "../trpc";
// import { requirePermission } from "../middleware/require-permission";

// export const examRouter = router({
//   // org_admin (or any role with exam:create in org_role_permissions) creates
//   // an exam definition ("BTSC Junior Talent Search"). The permission gate is
//   // requirePermission; no extra policy call needed here because create
//   // doesn't need a DataScope — it writes the org from the input directly.
//   create: requirePermission("exam:create")
//     .meta({ openapi: { method: "POST", path: "/exams", tags: ["exams"], protect: true } })
//     .input(CreateExamInput.extend({ organizationId: z.string().uuid() }))
//     .output(ExamResponse)
//     .mutation(async ({ ctx, input }) => {
//       const { organizationId, ...rest } = input;
//       const [created] = await ctx.db
//         .insert(exams)
//         .values({ ...rest, organizationId })
//         .returning();
//       return created!;
//     }),

//   list: requirePermission("exam:read")
//     .meta({ openapi: { method: "GET", path: "/exams", tags: ["exams"], protect: true } })
//     .input(z.object({ organizationId: z.string().uuid() }))
//     .output(z.array(ExamResponse))
//     .query(async ({ ctx, input }) => {
//       // can() already passed — this user has exam:read in this org.
//       // For org-wide roles the full list is correct; for narrower roles
//       // (e.g. exam_manager scoped to one examId), you'd filter by
//       // getDataScope here. Kept simple for the demo.
//       return ctx.db.select().from(exams).where(eq(exams.organizationId, input.organizationId));
//     }),

//   createCycle: requirePermission("exam:create")
//     .meta({ openapi: { method: "POST", path: "/exams/{examId}/cycles", tags: ["exams"], protect: true } })
//     .input(CreateExamCycleInput.extend({ organizationId: z.string().uuid() }))
//     .output(ExamCycleResponse)
//     .mutation(async ({ ctx, input }) => {
//       const { organizationId: _org, config, ...rest } = input;
//       const [created] = await ctx.db
//         .insert(examCycles)
//         .values({ ...rest, config: JSON.stringify(config), status: "draft" })
//         .returning();
//       return created!;
//     }),

//   // Public — no auth required. A school portal can show open cycles
//   // without forcing school_incharge to log in just to read the list.
//   // listOpenCyclesPublic: publicProcedure
//   //   .meta({ openapi: { method: "GET", path: "/public/exam-cycles", tags: ["exams"], protect: false } })
//   //   .input(z.object({ organizationId: z.string().uuid() }))
//   //   .output(z.array(ExamCycleResponse))
//   //   .query(async ({ ctx, input }) => {
//   //     const rows = await ctx.db.query.examCycles.findMany({
//   //       where: (c, { eq }) => eq(c.status, "registration_open"),
//   //       with: { exam: { where: (e, { eq }) => eq(e.organizationId, input.organizationId) } },
//   //     });
//   //     return rows.filter((r) => r.exam !== null);
//   //   }),
// });
