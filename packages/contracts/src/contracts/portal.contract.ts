import { z } from "zod";

/**
 * FAMILY READS (ADR-062): the narrow shapes a parent or student sees on the
 * `portalAttendance.*`, `portalFees.*` and `portalExam.schedule.*` routes.
 *
 * Hand-written on purpose, never derived from a table or a staff schema:
 * each field here is one the family is meant to see, and a new column on a
 * staff table must not reach a family by default. Parent and student logins
 * get exactly the same shapes.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month: YYYY-MM.");
/** Two decimals, as the percentage is shown everywhere ("92.50"). */
const percent = z.string();

// ---------------------------------------------------------------------------
// Inputs shared by every per-child read
// ---------------------------------------------------------------------------

export const portalChildInputSchema = z.object({
  studentId: z.uuid(),
  /** Default: the child's current session, else the latest one. */
  academicYearId: z.uuid().optional(),
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const portalAttendanceCountsSchema = z.object({
  workingDays: z.number().int(),
  daysPresent: z.number().int(),
  daysAbsent: z.number().int(),
  daysLate: z.number().int(),
  daysHalfDay: z.number().int(),
  daysOnLeave: z.number().int(),
  /** Present, plus late when the school counts late as present. */
  daysAttended: z.number().int(),
  percentage: percent,
});

export const portalAttendanceMonthInputSchema = portalChildInputSchema.extend({
  month: monthKey,
});

export const portalAttendanceDayStatusSchema = z.enum([
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
  "not_marked",
]);

export const portalAttendanceMonthSchema = z.object({
  month: monthKey,
  /** Counts stop at this day (today, IST). */
  asOf: isoDate,
  lateCountsAsPresent: z.boolean(),
  days: z.array(
    z.object({
      date: isoDate,
      dayType: z.enum(["working", "holiday", "half_day", "weekend", "exam_day"]).nullable(),
      /** The holiday's name, on non-working days only. */
      label: z.string().nullable(),
      enrolled: z.boolean(),
      status: portalAttendanceDayStatusSchema.nullable(),
    }),
  ),
  /** Null when nothing is marked yet this month. */
  counts: portalAttendanceCountsSchema.nullable(),
});

export const portalAttendanceOverviewSchema = z.object({
  academicYear: z.object({ id: z.uuid(), name: z.string(), isCurrent: z.boolean() }),
  asOf: isoDate,
  lateCountsAsPresent: z.boolean(),
  /** This month; null outside the session's dates. */
  month: z.object({ month: monthKey, counts: portalAttendanceCountsSchema.nullable() }).nullable(),
  terms: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      startDate: isoDate,
      endDate: isoDate,
      counts: portalAttendanceCountsSchema.nullable(),
    }),
  ),
  year: portalAttendanceCountsSchema.nullable(),
});

/** Flat, so it travels as plain query parameters: `month` goes with
 *  period=month, `termId` with period=term. */
export const portalAttendanceRankingInputSchema = portalChildInputSchema
  .extend({
    period: z.enum(["month", "term", "year"]),
    month: monthKey.optional(),
    termId: z.uuid().optional(),
  })
  .refine((v) => v.period !== "month" || v.month != null, {
    message: "Pick a month.",
    path: ["month"],
  })
  .refine((v) => v.period !== "term" || v.termId != null, {
    message: "Pick a term.",
    path: ["termId"],
  });

export const portalAttendanceRankingSchema = z.object({
  period: z.object({
    kind: z.enum(["month", "term", "year"]),
    month: monthKey.optional(),
    termId: z.uuid().optional(),
    from: isoDate,
    to: isoDate,
    isRunning: z.boolean(),
  }),
  /** The school's switch: off means the top list is empty. */
  topVisible: z.boolean(),
  /** Ranked 10th or better; more than 10 when ties straddle 10th. */
  top: z.array(
    z.object({
      rank: z.number().int(),
      name: z.string(),
      percentage: percent,
      isYou: z.boolean(),
    }),
  ),
  you: z.object({
    rank: z.number().int().nullable(),
    percentage: percent.nullable(),
    workingDays: z.number().int(),
    daysAttended: z.number().int(),
    /** Why there is no rank; null when ranked. */
    reason: z
      .enum(["no_section", "not_enrolled", "not_started", "no_marks", "too_few_days"])
      .nullable(),
  }),
  rankedCount: z.number().int(),
  sectionSize: z.number().int(),
  /** Counted working days needed to be ranked in this period. */
  minWorkingDays: z.number().int().nullable(),
});

export type PortalAttendanceMonth = z.infer<typeof portalAttendanceMonthSchema>;
export type PortalAttendanceOverview = z.infer<typeof portalAttendanceOverviewSchema>;
export type PortalAttendanceRanking = z.infer<typeof portalAttendanceRankingSchema>;

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/** Rupees as the database stores them: "1250.00". */
const money = z.string();

export const portalFeePaymentStatusSchema = z.enum([
  "pending",
  "cleared",
  "bounced",
  "reversed",
  "cancelled",
]);

export const portalFeePaymentRowSchema = z.object({
  id: z.uuid(),
  receiptNumber: z.string(),
  paymentDate: isoDate,
  paymentMode: z.string(),
  amount: money,
  lateFeeAmount: money,
  totalAmount: money,
  status: portalFeePaymentStatusSchema,
  refundedAmount: money,
});

export const portalFeeSummarySchema = z.object({
  student: z.object({
    id: z.uuid(),
    name: z.string(),
    className: z.string().nullable(),
    sectionName: z.string().nullable(),
    rollNumber: z.string().nullable(),
  }),
  academicYear: z.object({ id: z.uuid(), name: z.string(), isCurrent: z.boolean() }),
  /** False until the school assigns a fee structure to the child. */
  feeAssigned: z.boolean(),
  totals: z.object({
    dueNow: money,
    thisMonth: money,
    overdue: money,
    previousDues: money,
    later: money,
    paid: money,
    concession: money,
    discount: money,
  }),
  /** The same months the admin student fee page shows (owner F1). */
  months: z.array(
    z.object({
      month: z.string(),
      label: z.string(),
      net: money,
      paid: money,
      balance: money,
      state: z.enum(["overdue", "due", "upcoming", "paid", "none"]),
    }),
  ),
  dues: z.array(
    z.object({
      id: z.uuid(),
      feeHeadName: z.string(),
      description: z.string().nullable(),
      periodKey: z.string(),
      dueDate: isoDate,
      amount: money,
      concessionAmount: money,
      discountAmount: money,
      lateFeeAmount: money,
      netAmount: money,
      paidAmount: money,
      balance: money,
      status: z.enum(["unpaid", "partial", "paid", "waived", "cancelled"]),
    }),
  ),
  previousDues: z.array(
    z.object({
      id: z.uuid(),
      label: z.string().nullable(),
      amount: money,
      paidAmount: money,
      balance: money,
      status: z.enum(["unpaid", "partial", "paid", "waived", "cancelled"]),
    }),
  ),
  /** Type and amount only, never the reason (owner F2). */
  concessions: z.array(z.object({ concessionType: z.string(), amount: money })),
  /** Every payment this session, newest first, bounced and cancelled too (F3). */
  payments: z.array(portalFeePaymentRowSchema),
});

export const portalFeePaymentInputSchema = z.object({
  studentId: z.uuid(),
  paymentId: z.uuid(),
});

export const portalFeePaymentSchema = portalFeePaymentRowSchema.extend({
  allocations: z.array(
    z.object({
      feeHeadName: z.string(),
      description: z.string().nullable(),
      periodKey: z.string(),
      dueDate: isoDate,
      amount: money,
      lateFeeAmount: money,
    }),
  ),
  previousDues: z.array(
    z.object({
      label: z.string().nullable(),
      originAcademicYearName: z.string().nullable(),
      amount: money,
    }),
  ),
});

/** Finished HTML the phone prints or shares as a PDF (ADR-059). */
export const portalFeeDocumentSchema = z.object({
  html: z.string(),
  fileName: z.string(),
  width: z.number(),
  height: z.number(),
});

export type PortalFeeSummary = z.infer<typeof portalFeeSummarySchema>;
export type PortalFeePayment = z.infer<typeof portalFeePaymentSchema>;

// ---------------------------------------------------------------------------
// Exams: the date sheet
// ---------------------------------------------------------------------------

/** What the family is told about where an exam stands. */
export const portalExamStateSchema = z.enum([
  "upcoming",
  "ongoing",
  "marks_being_checked",
  "results_out",
]);

const portalExamBase = z.object({
  id: z.uuid(),
  name: z.string(),
  examType: z.enum(["regular", "supplementary", "improvement", "mock", "test"]),
  term: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  firstDate: isoDate.nullable(),
  lastDate: isoDate.nullable(),
  state: portalExamStateSchema,
});

export const portalExamListSchema = z.array(
  portalExamBase.extend({ paperCount: z.number().int() }),
);

export const portalExamDetailInputSchema = portalChildInputSchema.extend({
  examId: z.uuid(),
});

export const portalExamDetailSchema = portalExamBase.extend({
  papers: z.array(
    z.object({
      subjectName: z.string(),
      subjectCode: z.string().nullable(),
      examDate: isoDate,
      /** "09:30" */
      startTime: z.string(),
      durationMinutes: z.number().int(),
      venue: z.string().nullable(),
      /** Theory 80, Practical 20. */
      parts: z.array(z.object({ name: z.string(), maxMarks: money })),
      /** Sum of the parts; null when no parts are set yet. */
      maxMarks: money.nullable(),
    }),
  ),
});

export type PortalExamListItem = z.infer<typeof portalExamListSchema>[number];
export type PortalExamDetail = z.infer<typeof portalExamDetailSchema>;
