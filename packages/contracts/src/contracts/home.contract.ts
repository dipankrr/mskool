import { z } from "zod";

/**
 * STAFF HOME READS (ADR-072). Home is put together from the caller's
 * assignments, permissions and scope; these are the three reads that no other
 * screen already had. Everything else on Home reuses an existing read.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const calendarDayKindSchema = z.enum(["working", "holiday", "half_day", "weekend", "exam_day"]);
export type CalendarDayKind = z.infer<typeof calendarDayKindSchema>;

// ---------------------------------------------------------------------------
// home.attendanceToday
// ---------------------------------------------------------------------------

export const homeAttendanceTodayInputSchema = z.object({
  academicYearId: z.uuid(),
  /** The day to read, in the school's time (IST). */
  date: isoDate,
});
export type HomeAttendanceTodayInput = z.infer<typeof homeAttendanceTodayInputSchema>;

export const homeSectionDaySchema = z.object({
  sectionId: z.uuid(),
  sectionName: z.string(),
  classId: z.uuid(),
  className: z.string(),
  /** Students enrolled in the section this session (admitted, studying). */
  students: z.number().int(),
  /** Students with a status for the day. 0 = not marked. */
  marked: z.number().int(),
  /** Present, late or half day. */
  present: z.number().int(),
  /** Who first marked this section today, and when. Null while unmarked. */
  markedBy: z.object({ userId: z.string(), name: z.string(), at: z.string() }).nullable(),
});
export type HomeSectionDay = z.infer<typeof homeSectionDaySchema>;

export const homeAttendanceTodaySchema = z.object({
  date: isoDate,
  /** What the calendar says today is; null when the day isn't on it. */
  day: z.object({ kind: calendarDayKindSchema, reason: z.string().nullable() }).nullable(),
  /** True when one of the caller's grants covers the whole branch. */
  wholeSchool: z.boolean(),
  sections: z.array(homeSectionDaySchema),
  /** The next days that aren't ordinary school days, up to 30 days ahead. */
  upcoming: z.array(z.object({ date: isoDate, kind: calendarDayKindSchema, reason: z.string().nullable() })),
});
export type HomeAttendanceToday = z.infer<typeof homeAttendanceTodaySchema>;

// ---------------------------------------------------------------------------
// home.myPapers
// ---------------------------------------------------------------------------

export const homeMyPapersInputSchema = z.object({
  organizationId: z.uuid(),
  schoolId: z.uuid(),
  date: isoDate,
});
export type HomeMyPapersInput = z.infer<typeof homeMyPapersInputSchema>;

export const homePaperSchema = z.object({
  examId: z.uuid(),
  examName: z.string(),
  scheduleId: z.uuid(),
  sectionId: z.uuid(),
  sectionName: z.string(),
  className: z.string(),
  subjectId: z.uuid(),
  subjectName: z.string(),
  examDate: isoDate,
  /** Students in the section who sit this paper. */
  students: z.number().int(),
  /** Of those, how many have every part of the paper entered. */
  entered: z.number().int(),
});
export type HomePaper = z.infer<typeof homePaperSchema>;

export const homeMyPapersSchema = z.object({
  /** Papers of exams open for marks, on the caller's own subject pairs. */
  open: z.array(homePaperSchema),
  /** The caller's papers still to be sat, from the date sheet, next 30 days. */
  upcoming: z.array(
    z.object({
      examName: z.string(),
      examDate: isoDate,
      sectionName: z.string(),
      className: z.string(),
      subjectName: z.string(),
    }),
  ),
});
export type HomeMyPapers = z.infer<typeof homeMyPapersSchema>;

// ---------------------------------------------------------------------------
// home.org — the All branches view
// ---------------------------------------------------------------------------

export const homeOrgInputSchema = z.object({ date: isoDate });
export type HomeOrgInput = z.infer<typeof homeOrgInputSchema>;

export const homeBranchSchema = z.object({
  schoolId: z.uuid(),
  name: z.string(),
  /** The branch's running session; branches can run different sessions. */
  session: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** Each part is null when the caller may not read it at this branch. */
  students: z.number().int().nullable(),
  attendance: z
    .object({
      present: z.number().int(),
      marked: z.number().int(),
      sectionsMarked: z.number().int(),
      sections: z.number().int(),
    })
    .nullable(),
  fees: z
    .object({
      collectedToday: z.string(),
      receiptsToday: z.number().int(),
      collectedThisMonth: z.string(),
      billedThisMonth: z.string(),
      paidOnThisMonth: z.string(),
    })
    .nullable(),
  staff: z.object({ total: z.number().int(), notJoined: z.number().int() }).nullable(),
});
export type HomeBranch = z.infer<typeof homeBranchSchema>;

export const homeOrgSchema = z.object({ branches: z.array(homeBranchSchema) });
export type HomeOrg = z.infer<typeof homeOrgSchema>;
