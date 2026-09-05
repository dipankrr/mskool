import {
  examClassPublication,
  examComponents,
  examEligibility,
  examSubjectSchedules,
  exams,
  gradingScaleBands,
  gradingScales,
  passCriteria,
  publishedReportCards,
  reportCardTemplates,
  studentComponentResultRevisions,
  studentComponentResults,
  subjectTypes,
  termAssessments,
} from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * EXAMS — Phase 5 (ADR-032).
 *
 * Same derivation as every other contract: schemas come from the Drizzle
 * tables via drizzle-zod, so a column change surfaces as a validation-type
 * error rather than drifting silently (the type chain in AGENTS.md).
 *
 * Marks are STRINGS in code (numeric columns read back as strings; hard
 * rule 4's cousin — no float ever touches a mark). The DB CHECKs and the
 * ADR-013 trigger are the authority on bounds; these schemas carry the
 * field-level messages.
 *
 * The snapshot schema at the bottom is the ONE hand-written shape: it is
 * the versioned contract of `published_report_cards.snapshot_data` —
 * `snapshotVersion: 1` here; v2 may add fields, v1 never changes.
 */

/** Shared with academic/term contracts — a calendar date is `YYYY-MM-DD`. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

/**
 * A mark or a weight: decimal string, up to 2 places, negatives allowed
 * (negative marking). The component max and the ADR-013 trigger bound it.
 */
const marksString = z
  .string()
  .regex(/^-?\d{1,4}(\.\d{1,2})?$/, "Use a decimal like 62 or 62.5.");

const pct100 = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Use a percentage between 0 and 100.");

const omitTenant = {
  id: true,
  organizationId: true,
  schoolId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ---------------------------------------------------------------------------
// Subject types — the report-card widget + the result flags (ADR-032 §1)
// ---------------------------------------------------------------------------

export const subjectTypeSelectSchema = createSelectSchema(subjectTypes);
export type SubjectType = z.infer<typeof subjectTypeSelectSchema>;

export const createSubjectTypeSchema = createInsertSchema(subjectTypes, {
  name: z.string().min(1).max(100),
  sequence: z.number().int().min(0).max(999),
  assessmentMode: z.enum(["exam", "term_grade"]),
})
  .omit(omitTenant)
  .refine(
    (v) => v.assessmentMode !== "term_grade" || !v.isGradedOnly === false || true,
    // Term-grade types are graded-only by nature; the service normalizes —
    // no hard constraint here, any flag combo is legitimate (ADR-031's
    // independence principle, now on the type).
  );
export type CreateSubjectTypeInput = z.infer<typeof createSubjectTypeSchema>;

export const updateSubjectTypeSchema = createInsertSchema(subjectTypes, {
  name: z.string().min(1).max(100),
  sequence: z.number().int().min(0).max(999),
})
  .omit(omitTenant)
  .partial();
export type UpdateSubjectTypeInput = z.infer<typeof updateSubjectTypeSchema>;

// ---------------------------------------------------------------------------
// Grading scales — percentage bands, contiguous 0-100 (ADR-032 §5)
// ---------------------------------------------------------------------------

export const gradingScaleSelectSchema = createSelectSchema(gradingScales);
export type GradingScale = z.infer<typeof gradingScaleSelectSchema>;

export const gradingScaleBandSelectSchema = createSelectSchema(gradingScaleBands);
export type GradingScaleBand = z.infer<typeof gradingScaleBandSelectSchema>;

export const gradingScaleBandInput = z
  .object({
    minMarks: pct100,
    maxMarks: pct100,
    gradeLabel: z.string().min(1).max(10),
    gradePoint: pct100.nullable().optional(),
    descriptor: z.string().max(100).optional(),
    sequenceNumber: z.number().int().min(0).max(999).optional(),
  })
  .refine((v) => v.maxMarks >= v.minMarks, {
    message: "A band cannot end before it starts.",
    path: ["maxMarks"],
  });
export type GradingScaleBandInput = z.infer<typeof gradingScaleBandInput>;

/**
 * A scale is created WITH its bands (atomic — a bandless scale is useless
 * and the contiguity check needs all of them). The service validates
 * contiguity 0-100 and refuses `percentile_rank` in v1.
 */
export const createGradingScaleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
  isDefault: z.boolean().optional().default(false),
  bands: z.array(gradingScaleBandInput).min(1, "A scale needs at least one band."),
});
export type CreateGradingScaleInput = z.infer<typeof createGradingScaleSchema>;

// ---------------------------------------------------------------------------
// Pass criteria — school default + class overrides (per year)
// ---------------------------------------------------------------------------

export const passCriteriaSelectSchema = createSelectSchema(passCriteria);
export type PassCriteria = z.infer<typeof passCriteriaSelectSchema>;

export const createPassCriteriaSchema = createInsertSchema(passCriteria, {
  minSubjectsToPass: z.number().int().min(1).max(50).nullable().optional(),
  graceMarksAllowed: z.boolean().optional().default(false),
  maxGracePerSubject: pct100.nullable().optional(),
  maxGraceTotal: pct100.nullable().optional(),
  compartmentAllowed: z.boolean().optional().default(false),
  maxSubjectsForCompartment: z.number().int().min(1).max(20).nullable().optional(),
  minAttendancePct: pct100,
})
  .omit({ ...omitTenant, academicYearId: true })
  .refine(
    (v) =>
      !v.compartmentAllowed ||
      (v.maxSubjectsForCompartment ?? 0) >= 1,
    { message: "A compartment policy needs a subject cap." },
  );
export type CreatePassCriteriaInput = z.infer<typeof createPassCriteriaSchema>;

export const updatePassCriteriaSchema = createInsertSchema(passCriteria, {
  minSubjectsToPass: z.number().int().min(1).max(50).nullable(),
  minAttendancePct: pct100,
})
  .omit({ ...omitTenant, academicYearId: true })
  .partial();
export type UpdatePassCriteriaInput = z.infer<typeof updatePassCriteriaSchema>;

// ---------------------------------------------------------------------------
// Exams + blueprint
// ---------------------------------------------------------------------------

export const examSelectSchema = createSelectSchema(exams);
export type Exam = z.infer<typeof examSelectSchema>;

export const examStatusValues = [
  "draft",
  "scheduled",
  "ongoing",
  "marks_entry",
  "under_verification",
  "published",
  "locked",
] as const;

export const createExamSchema = createInsertSchema(exams, {
  name: z.string().min(1).max(150),
  weightageInTerm: pct100,
})
  .omit({ ...omitTenant, academicYearId: true, status: true })
  .refine(
    (v) => v.examType !== "supplementary" || v.linkedExamId !== undefined,
    { message: "A supplementary exam must link the exam it redeems." },
  );
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = createInsertSchema(exams, {
  name: z.string().min(1).max(150),
  weightageInTerm: pct100,
})
  .omit({
    ...omitTenant,
    academicYearId: true,
    termId: true,
    status: true,
    linkedExamId: true,
    examType: true,
  })
  .partial();
export type UpdateExamInput = z.infer<typeof updateExamSchema>;

/**
 * Lifecycle transitions are a SERVICE decision (the transition map with
 * preconditions, ADR-032 §4); the contract only names the target. Illegal
 * moves get worded errors, never a silent flip.
 */
export const examTransitionInput = z.object({
  examId: z.uuid(),
  target: z.enum(examStatusValues),
});
export type ExamTransitionInput = z.infer<typeof examTransitionInput>;

export const examScheduleSelectSchema = createSelectSchema(examSubjectSchedules);
export type ExamSchedule = z.infer<typeof examScheduleSelectSchema>;

export const examScheduleInput = createInsertSchema(examSubjectSchedules, {
  examDate: isoDate,
  durationMinutes: z.number().int().min(5).max(600),
  venue: z.string().max(150).optional(),
  // Optional: the service derives the weighted default from the components;
  // a school override (the ">=50/100 total" rule) lands here.
  passMarks: marksString.optional(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    isLocked: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine((v) => v.startTime.length >= 4, {
    message: "Use HH:MM (24-hour).",
    path: ["startTime"],
  });
export type ExamScheduleInput = z.infer<typeof examScheduleInput>;

/** A schedule save is a BATCH: the setup screen edits the class's whole grid. */
export const saveExamSchedulesInput = z.object({
  examId: z.uuid(),
  schedules: z.array(examScheduleInput),
});
export type SaveExamSchedulesInput = z.infer<typeof saveExamSchedulesInput>;

export const examComponentSelectSchema = createSelectSchema(examComponents);
export type ExamComponent = z.infer<typeof examComponentSelectSchema>;

export const examComponentInput = createInsertSchema(examComponents, {
  name: z.string().min(1).max(100),
  maxMarks: marksString,
  passMarks: marksString,
  weightagePercentage: pct100,
  negativeMarksPerWrong: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/)
    .nullable()
    .optional(),
})
  .omit({ id: true, organizationId: true, schoolId: true, createdAt: true, updatedAt: true })
  .refine((v) => Number(v.passMarks) <= Number(v.maxMarks), {
    message: "Pass marks cannot exceed the maximum.",
    path: ["passMarks"],
  });
export type ExamComponentInput = z.infer<typeof examComponentInput>;

export const saveExamComponentsInput = z.object({
  scheduleId: z.uuid(),
  components: z.array(examComponentInput).min(1),
});
export type SaveExamComponentsInput = z.infer<typeof saveExamComponentsInput>;

// ---------------------------------------------------------------------------
// Eligibility — advisory; the override is the normal path (ADR-032 §9)
// ---------------------------------------------------------------------------

export const examEligibilitySelectSchema = createSelectSchema(examEligibility);
export type ExamEligibility = z.infer<typeof examEligibilitySelectSchema>;

export const overrideEligibilityInput = z.object({
  examId: z.uuid(),
  studentId: z.uuid(),
  overrideEligible: z.boolean(),
  reason: z.string().min(3).max(500),
});
export type OverrideEligibilityInput = z.infer<typeof overrideEligibilityInput>;

// ---------------------------------------------------------------------------
// Marks entry — autosave per cell (ADR-032 §11)
// ---------------------------------------------------------------------------

export const componentResultSelectSchema = createSelectSchema(
  studentComponentResults,
);
export type ComponentResult = z.infer<typeof componentResultSelectSchema>;

/**
 * One autosave cell. The row is created lazily on first save; the response
 * carries the fresh `updatedAt` + `resultStatus` so the grid updates without
 * a refetch. Clearing every field reverts the row to an empty draft.
 * `expectedUpdatedAt` drives the optimistic-concurrency guard (two writers
 * on one cell → worded conflict, no lost update).
 */
export const saveComponentResultInput = z
  .object({
    examId: z.uuid(),
    scheduleId: z.uuid(),
    componentId: z.uuid(),
    studentId: z.uuid(),
    marks: marksString.nullable().optional(),
    grade: z.string().max(10).nullable().optional(),
    isAbsent: z.boolean().optional().default(false),
    isExempted: z.boolean().optional().default(false),
    exemptionType: z.enum(["medical", "disability", "board_approved", "other"]).nullable().optional(),
    expectedUpdatedAt: z.string().optional(),
  })
  .refine((v) => !v.isExempted || v.exemptionType != null, {
    message: "An exemption needs its type.",
    path: ["exemptionType"],
  });
export type SaveComponentResultInput = z.infer<typeof saveComponentResultInput>;

/**
 * The verify action: batch of component-result ids → Verified. Who may hold
 * `marks:verify` is role configuration; verifier == enterer is allowed but
 * logged (small schools wear multiple hats).
 */
export const verifyComponentResultsInput = z.object({
  componentResultIds: z.array(z.uuid()).min(1),
});
export type VerifyComponentResultsInput = z.infer<typeof verifyComponentResultsInput>;

// ---------------------------------------------------------------------------
// Revisions — the hard-rule-7 ledger + windows (ADR-032 §8)
// ---------------------------------------------------------------------------

export const componentRevisionSelectSchema = createSelectSchema(
  studentComponentResultRevisions,
);
export type ComponentRevision = z.infer<typeof componentRevisionSelectSchema>;

export const submitRevisionInput = z.object({
  componentResultId: z.uuid(),
  revisedMarks: marksString.nullable().optional(),
  revisedGrade: z.string().max(10).nullable().optional(),
  revisionType: z.enum(["marks_correction", "re_evaluation", "data_entry_error", "other"]),
  reason: z.string().min(3).max(500),
});
export type SubmitRevisionInput = z.infer<typeof submitRevisionInput>;

/** The approval dialog's data: what changes, who else's rank moves. */
export const revisionImpactSchema = z.object({
  componentResultId: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  subjectName: z.string(),
  previousMarks: z.string().nullable(),
  revisedMarks: z.string().nullable(),
  previousFinal: z.string().nullable(),
  revisedFinal: z.string().nullable(),
  previousRankInSection: z.number().int().nullable(),
  revisedRankInSection: z.number().int().nullable(),
  /** Other students whose published cards will be re-versioned. */
  affectedCards: z.array(
    z.object({
      studentId: z.uuid(),
      studentName: z.string(),
      previousRank: z.number().int().nullable(),
      revisedRank: z.number().int().nullable(),
    }),
  ),
});
export type RevisionImpact = z.infer<typeof revisionImpactSchema>;

// ---------------------------------------------------------------------------
// Publication — per-class records, whole-exam loop, windows
// ---------------------------------------------------------------------------

export const publishClassInput = z.object({
  examId: z.uuid(),
  classId: z.uuid(),
});
export type PublishClassInput = z.infer<typeof publishClassInput>;

export const publishExamInput = z.object({ examId: z.uuid() });
export type PublishExamInput = z.infer<typeof publishExamInput>;

export const revisionWindowInput = z.object({
  examId: z.uuid(),
  classId: z.uuid(),
});
export type RevisionWindowInput = z.infer<typeof revisionWindowInput>;

export const examClassPublicationSelectSchema = createSelectSchema(
  examClassPublication,
);
export type ExamClassPublication = z.infer<typeof examClassPublicationSelectSchema>;

// ---------------------------------------------------------------------------
// Published cards + the versioned snapshot
// ---------------------------------------------------------------------------

export const publishedReportCardSelectSchema = createSelectSchema(
  publishedReportCards,
);
export type PublishedReportCard = z.infer<typeof publishedReportCardSelectSchema>;

export const reportCardTemplateSelectSchema = createSelectSchema(
  reportCardTemplates,
);
export type ReportCardTemplate = z.infer<typeof reportCardTemplateSelectSchema>;

export const reportCardTemplateInput = createInsertSchema(reportCardTemplates, {
  name: z.string().min(1).max(100),
  layoutConfig: z.record(z.string(), z.unknown()),
})
  .omit({ id: true, organizationId: true, schoolId: true, createdBy: true, createdAt: true, updatedAt: true })
  .partial();
export type ReportCardTemplateInput = z.infer<typeof reportCardTemplateInput>;

/**
 * snapshot_data, version 1 — THE frozen card. The portal renders this and
 * nothing else (hard rule 8). Never mutate this shape: a change is a new
 * `snapshotVersion` literal alongside it, so old cards keep validating.
 */
export const reportCardSnapshotV1 = z.object({
  snapshotVersion: z.literal(1),
  student: z.object({
    name: z.string(),
    admissionNumber: z.string(),
    className: z.string(),
    sectionName: z.string().nullable(),
    rollNumber: z.string().nullable(),
  }),
  school: z.object({ name: z.string() }),
  academicYear: z.object({ name: z.string() }),
  term: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** One row per assessed subject, grouped client-side by widget. */
  subjects: z.array(
    z.object({
      subjectId: z.uuid(),
      subjectName: z.string(),
      subjectTypeId: z.uuid().nullable(),
      widgetName: z.string().nullable(),
      widgetSequence: z.number().int().nullable(),
      marksObtained: z.string().nullable(),
      maxMarks: z.string().nullable(),
      grade: z.string().nullable(),
      gradePoint: z.string().nullable(),
      isAbsent: z.boolean(),
      isExempted: z.boolean(),
      countsTowardResult: z.boolean(),
    }),
  ),
  totals: z.object({
    totalMarks: z.string().nullable(),
    maxMarks: z.string().nullable(),
    percentage: z.string().nullable(),
    grade: z.string().nullable(),
    gradePoint: z.string().nullable(),
    isPassed: z.boolean().nullable(),
    rankInSection: z.number().int().nullable(),
    rankInClass: z.number().int().nullable(),
  }),
  attendance: z
    .object({
      workingDays: z.number().int(),
      daysPresent: z.number().int(),
      percentage: z.string().nullable(),
    })
    .nullable(),
  /** Term-grade subjects (areas) + their remarks — never in the math. */
  termAssessments: z.array(
    z.object({
      mappingId: z.uuid(),
      areaName: z.string(),
      widgetName: z.string().nullable(),
      grade: z.string(),
      remarks: z.string().nullable(),
    }),
  ),
  generatedAt: z.string(),
});
export type ReportCardSnapshotV1 = z.infer<typeof reportCardSnapshotV1>;

// ---------------------------------------------------------------------------
// Term assessments — grades for term_grade subjects (areas)
// ---------------------------------------------------------------------------

export const termAssessmentSelectSchema = createSelectSchema(termAssessments);
export type TermAssessment = z.infer<typeof termAssessmentSelectSchema>;

export const saveTermAssessmentInput = z.object({
  studentId: z.uuid(),
  termId: z.uuid(),
  mappingId: z.uuid(),
  grade: z.string().min(1).max(10),
  descriptor: z.string().max(100).optional(),
  teacherRemarks: z.string().max(500).optional(),
});
export type SaveTermAssessmentInput = z.infer<typeof saveTermAssessmentInput>;
