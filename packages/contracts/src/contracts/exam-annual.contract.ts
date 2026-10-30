import { annualResultPolicies } from "@repo/db/schema";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { reportCardSnapshotV1 } from "./exam.contract";

/**
 * THE ANNUAL RESULT (ADR-053) - the policy a school saves, the readiness /
 * table / generate / publish shapes the staff apps read, and the versioned
 * annual card (`snapshotVersion: 2`).
 *
 * Decimal columns are STRINGS (hard rule 4's cousin). Everything the screens
 * print is computed server-side and shipped as words or numbers - the
 * clients hold no result maths.
 */

const pct100 = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Use a percentage between 0 and 100.")
  .refine((v) => Number(v) <= 100, { message: "Use a percentage between 0 and 100." });

export const annualMethodValues = ["weighted", "single_term", "best_n"] as const;
export type AnnualMethodValue = (typeof annualMethodValues)[number];
export const annualTotalDisplayValues = ["average", "sum"] as const;
export const promotionStatusValues = ["promoted", "compartment", "detained"] as const;
export type PromotionStatusValue = (typeof promotionStatusValues)[number];

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

export const annualPolicyTermInput = z.object({
  termId: z.uuid(),
  /** The policy's own academic weight; only the weighted method reads it. */
  weightage: pct100.nullable().optional(),
});

/** Hundredths from a "12.5" style string - validation only, never stored. */
const hundredths = (v: string | null | undefined) => Math.round(Number(v ?? "0") * 100);

export const saveAnnualPolicyInput = z
  .object({
    /** Present = edit this policy; absent = create (refused if the scope already has one). */
    id: z.uuid().optional(),
    academicYearId: z.uuid(),
    /** NULL = the school's default for the year; set = that class's own policy. */
    classId: z.uuid().nullable(),
    method: z.enum(annualMethodValues),
    /** best_n only: how many of the included terms count. */
    bestN: z.number().int().min(1).max(12).nullable().optional(),
    totalDisplay: z.enum(annualTotalDisplayValues).optional().default("average"),
    annualSubjectPassPercent: pct100,
    useOwnPassRules: z.boolean().optional().default(false),
    minSubjectsToPass: z.number().int().min(1).max(50).nullable().optional(),
    mandatoryPassSubjectIds: z.array(z.uuid()).optional().default([]),
    compartmentAllowed: z.boolean().optional().default(false),
    maxSubjectsForCompartment: z.number().int().min(1).max(20).nullable().optional(),
    minAttendancePct: pct100.optional().default("75.00"),
    terms: z.array(annualPolicyTermInput).min(1, "Pick at least one term.").max(12),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: "custom", message, path });

    if (new Set(v.terms.map((t) => t.termId)).size !== v.terms.length) {
      issue("A term can be picked only once.", ["terms"]);
    }
    if (v.method === "weighted") {
      if (v.terms.some((t) => t.weightage == null || t.weightage === "")) {
        issue("Give every picked term a weight.", ["terms"]);
      } else {
        const total = v.terms.reduce((acc, t) => acc + hundredths(t.weightage), 0);
        if (total !== 10000) {
          issue(
            `The weights add up to ${(total / 100).toFixed(2).replace(/\.00$/, "")}% - they must total exactly 100%.`,
            ["terms"],
          );
        }
      }
    }
    if (v.method === "single_term" && v.terms.length !== 1) {
      issue("Pick exactly one term.", ["terms"]);
    }
    if (v.method === "best_n") {
      if (v.bestN == null) issue("Say how many terms count.", ["bestN"]);
      else if (v.bestN > v.terms.length) {
        issue(`Only ${v.terms.length} term${v.terms.length === 1 ? " is" : "s are"} picked - N cannot be ${v.bestN}.`, ["bestN"]);
      }
    } else if (v.bestN != null) {
      issue("Only the best-N method uses a count.", ["bestN"]);
    }
    if (v.totalDisplay === "sum" && v.method !== "best_n") {
      issue("A printed sum only makes sense when the terms are added up (best N).", ["totalDisplay"]);
    }
    if (v.useOwnPassRules && v.compartmentAllowed && (v.maxSubjectsForCompartment ?? 0) < 1) {
      issue("A compartment rule needs a subject cap.", ["maxSubjectsForCompartment"]);
    }
  });
export type SaveAnnualPolicyInput = z.infer<typeof saveAnnualPolicyInput>;
export type SaveAnnualPolicyFormInput = z.input<typeof saveAnnualPolicyInput>;

export const annualPolicyOutputSchema = createSelectSchema(annualResultPolicies).extend({
  terms: z.array(z.object({ termId: z.uuid(), weightage: z.string().nullable() })),
  /** The policy in one sentence - the one wording the cards and screens share. */
  summary: z.string(),
});
export type AnnualPolicyOutput = z.infer<typeof annualPolicyOutputSchema>;

export const listAnnualPoliciesInput = z.object({ academicYearId: z.uuid() });
export const deleteAnnualPolicyInput = z.object({ id: z.uuid() });

// ---------------------------------------------------------------------------
// One class, one year: readiness, generate, table
// ---------------------------------------------------------------------------

export const annualClassInput = z.object({
  academicYearId: z.uuid(),
  classId: z.uuid(),
});
export type AnnualClassInput = z.infer<typeof annualClassInput>;

export const annualStudentInput = annualClassInput.extend({ studentId: z.uuid() });

export const annualOverviewInput = z.object({ academicYearId: z.uuid() });

/** One row per class that has a generated year - the class list's status chips. */
export const annualOverviewOutputSchema = z.array(
  z.object({
    classId: z.uuid(),
    students: z.number().int(),
    publishedStudents: z.number().int(),
    computedAt: z.date(),
  }),
);
export type AnnualOverviewOutput = z.infer<typeof annualOverviewOutputSchema>;

const governingPolicySchema = z
  .object({
    id: z.uuid(),
    scope: z.enum(["class", "default"]),
    summary: z.string(),
    useOwnPassRules: z.boolean(),
  })
  .nullable();

export const annualIssueSchema = z.object({
  code: z.enum([
    "no_policy",
    "missing_result",
    "stale_inputs",
    "term_not_published",
    "term_corrections_open",
    "renormalized",
    "no_paper_for_section",
    "excused",
    "predates_correction",
    "no_students",
  ]),
  message: z.string(),
  count: z.number().int(),
  /** The exam whose class results screen fixes it, when there is one. */
  examId: z.uuid().nullable(),
});
export type AnnualIssue = z.infer<typeof annualIssueSchema>;

export const annualStatusValues = ["none", "draft", "stale", "published"] as const;

export const annualReadinessOutputSchema = z.object({
  policy: governingPolicySchema,
  status: z.enum(annualStatusValues),
  generatedAt: z.date().nullable(),
  studentCount: z.number().int(),
  blockers: z.array(annualIssueSchema),
  warnings: z.array(annualIssueSchema),
  /** Why Publish is not available, in words; null when it is. */
  publishBlockedReason: z.string().nullable(),
});
export type AnnualReadinessOutput = z.infer<typeof annualReadinessOutputSchema>;

export const annualGenerateOutputSchema = z.object({
  generated: z.number().int(),
  promoted: z.number().int(),
  compartment: z.number().int(),
  detained: z.number().int(),
  renormalized: z.number().int(),
});
export type AnnualGenerateOutput = z.infer<typeof annualGenerateOutputSchema>;

export const annualSourceTermSchema = z.object({
  termId: z.uuid(),
  /** The term's score for this subject; null when none (no paper) or graded-only. */
  score: z.string().nullable(),
  /** Graded-only subjects: the term's grade. */
  grade: z.string().nullable(),
  nominalWeight: z.string().nullable(),
  effectiveWeight: z.string(),
  used: z.boolean(),
});
export type AnnualSourceTerm = z.infer<typeof annualSourceTermSchema>;

export const annualSubjectRowSchema = z.object({
  subjectId: z.uuid(),
  percentage: z.string().nullable(),
  grade: z.string().nullable(),
  gradePoint: z.string().nullable(),
  isPassed: z.boolean(),
  isExempted: z.boolean(),
  isGradedOnly: z.boolean(),
  countsTowardResult: z.boolean(),
  renormalized: z.boolean(),
  /** With the `sum` display: Σ used term scores and the matching maximum. */
  displayMarks: z.string().nullable(),
  displayMax: z.string().nullable(),
  sources: z.array(annualSourceTermSchema),
});
export type AnnualSubjectRow = z.infer<typeof annualSubjectRowSchema>;

export const annualStudentRowSchema = z.object({
  studentId: z.uuid(),
  name: z.string(),
  rollNumber: z.string().nullable(),
  sectionId: z.uuid().nullable(),
  sectionName: z.string().nullable(),
  percentage: z.string().nullable(),
  grade: z.string().nullable(),
  gradePoint: z.string().nullable(),
  isPassed: z.boolean(),
  promotionStatus: z.enum(promotionStatusValues),
  failedSubjectIds: z.array(z.uuid()),
  compartmentSubjectIds: z.array(z.uuid()),
  rankInClass: z.number().int().nullable(),
  rankInSection: z.number().int().nullable(),
  attendancePercentage: z.string().nullable(),
  renormalized: z.boolean(),
  /** The most terms any of the student's subjects used, out of the policy's. */
  termsUsed: z.number().int(),
  published: z.boolean(),
  subjects: z.array(annualSubjectRowSchema),
});
export type AnnualStudentRow = z.infer<typeof annualStudentRowSchema>;

export const annualTableOutputSchema = z.object({
  status: z.enum(annualStatusValues),
  computedAt: z.date().nullable(),
  policy: governingPolicySchema,
  totalDisplay: z.enum(annualTotalDisplayValues),
  terms: z.array(z.object({ id: z.uuid(), name: z.string(), sequence: z.number().int() })),
  subjects: z.array(z.object({ id: z.uuid(), name: z.string() })),
  students: z.array(annualStudentRowSchema),
});
export type AnnualTableOutput = z.infer<typeof annualTableOutputSchema>;

export const annualPublishOutputSchema = z.object({
  published: z.number().int(),
  skipped: z.number().int(),
});
export type AnnualPublishOutput = z.infer<typeof annualPublishOutputSchema>;

// ---------------------------------------------------------------------------
// The annual card - snapshotVersion 2 (ADR-053 §10)
// ---------------------------------------------------------------------------

/**
 * snapshot_data, version 2 - the ANNUAL card. V1 is never touched; every
 * reader accepts both through `reportCardSnapshot`. A reader that cannot
 * render a version it does not know must say so, never guess.
 */
export const reportCardSnapshotV2 = z.object({
  snapshotVersion: z.literal(2),
  kind: z.literal("annual"),
  student: z.object({
    name: z.string(),
    admissionNumber: z.string(),
    className: z.string(),
    sectionName: z.string().nullable(),
    rollNumber: z.string().nullable(),
  }),
  school: z.object({ name: z.string() }),
  academicYear: z.object({ name: z.string() }),
  policy: z.object({
    method: z.enum(annualMethodValues),
    totalDisplay: z.enum(annualTotalDisplayValues),
    annualSubjectPassPercent: z.string(),
    /** The same sentence the staff screens print. */
    summary: z.string(),
  }),
  /** The year's terms, in order, with how each stood on its own. */
  terms: z.array(
    z.object({
      termId: z.uuid(),
      name: z.string(),
      sequence: z.number().int(),
      percentage: z.string().nullable(),
      grade: z.string().nullable(),
      rankInClass: z.number().int().nullable(),
      nominalWeight: z.string().nullable(),
    }),
  ),
  subjects: z.array(
    z.object({
      subjectId: z.uuid(),
      subjectName: z.string(),
      widgetName: z.string().nullable(),
      widgetSequence: z.number().int().nullable(),
      percentage: z.string().nullable(),
      displayMarks: z.string().nullable(),
      displayMax: z.string().nullable(),
      grade: z.string().nullable(),
      gradePoint: z.string().nullable(),
      isPassed: z.boolean(),
      isExempted: z.boolean(),
      isGradedOnly: z.boolean(),
      countsTowardResult: z.boolean(),
      renormalized: z.boolean(),
      /** One entry per included term: its score here and whether it counted. */
      byTerm: z.array(
        z.object({
          termId: z.uuid(),
          score: z.string().nullable(),
          grade: z.string().nullable(),
          used: z.boolean(),
        }),
      ),
    }),
  ),
  totals: z.object({
    totalMarks: z.string().nullable(),
    maxMarks: z.string().nullable(),
    percentage: z.string().nullable(),
    grade: z.string().nullable(),
    gradePoint: z.string().nullable(),
    isPassed: z.boolean(),
    rankInSection: z.number().int().nullable(),
    rankInClass: z.number().int().nullable(),
  }),
  verdict: z.object({
    promotionStatus: z.enum(promotionStatusValues),
    failedSubjects: z.array(z.object({ subjectId: z.uuid(), subjectName: z.string() })),
    compartmentSubjects: z.array(z.object({ subjectId: z.uuid(), subjectName: z.string() })),
    renormalized: z.boolean(),
  }),
  attendance: z
    .object({
      workingDays: z.number().int(),
      daysPresent: z.number().int(),
      percentage: z.string().nullable(),
    })
    .nullable(),
  generatedAt: z.string(),
});
export type ReportCardSnapshotV2 = z.infer<typeof reportCardSnapshotV2>;

/** Every version a reader may meet. */
export const reportCardSnapshot = z.discriminatedUnion("snapshotVersion", [
  reportCardSnapshotV1,
  reportCardSnapshotV2,
]);
export type ReportCardSnapshot = z.infer<typeof reportCardSnapshot>;

export const annualCardOutputSchema = z
  .object({
    status: z.enum(["draft", "published"]),
    version: z.number().int().nullable(),
    snapshotData: z.unknown(),
  })
  .nullable();
export type AnnualCardOutput = z.infer<typeof annualCardOutputSchema>;
