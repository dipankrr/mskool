import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  CreateRubricInput,
  EvaluateStudentAssignmentInput,
  GrantExtensionInput,
  PortalSubmitAssignmentInput,
  PostAssignmentCommentInput,
  UpdateAssignmentInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  assignmentAcknowledgements,
  assignmentComments,
  assignmentEvaluations,
  assignmentExtensions,
  assignmentResources,
  assignmentRevisions,
  assignmentRubricScores,
  assignmentSettings,
  assignmentTargets,
  assignments,
  classes,
  gradingScales,
  rubricCriteria,
  rubricLevels,
  rubrics,
  sections,
  studentAssignments,  studentEnrollments,
  students,
  storageObjects,
  studentPortalAccess,
  subjects,
  submissions,
  submissionFiles,
  user,
} from "@repo/db/schema";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

/**
 * HOMEWORK / ASSIGNMENTS (ADR-039) — the daily homework-diary domain.
 *
 * Spine: Assignment (authored) → StudentAssignment (resolved per student, THE
 * authoritative record) → Submission (versioned) → Evaluation (append-only).
 * Knows nothing about HTTP; every scoped read takes a DataScope or a scope
 * list as a REQUIRED argument (hard rule 1), and every write re-reads its
 * parents through the caller's scope INSIDE the transaction (the section
 * service's pattern — a foreign key proves existence, not tenancy).
 *
 * No grading impact: nothing here touches exams or report cards.
 * Nothing is hard-deleted: cancel sets status, evaluations append and flip
 * is_current, corrections extend deadlines via append-only rows.
 */

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/** School-level tables: widen a section/class scope to its school. */
function atSchoolLevel(scope: DataScope): DataScope {
  return { ...scope, classId: null, sectionId: null };
}

const ASSIGNMENT_COLS = {
  organizationId: assignments.organizationId,
  schoolId: assignments.schoolId,
} as const;

const STUDENT_ASSIGNMENT_COLS = {
  organizationId: studentAssignments.organizationId,
  schoolId: studentAssignments.schoolId,
} as const;

const SECTION_COLS = {
  organizationId: sections.organizationId,
  schoolId: sections.schoolId,
} as const;

const SUBJECT_COLS = {
  organizationId: subjects.organizationId,
  schoolId: subjects.schoolId,
} as const;

const RUBRIC_COLS = {
  organizationId: rubrics.organizationId,
  schoolId: rubrics.schoolId,
} as const;

const SETTINGS_COLS = {
  organizationId: assignmentSettings.organizationId,
  schoolId: assignmentSettings.schoolId,
} as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Platform fallback when a school has never saved a settings row. */
const PLATFORM_DEFAULT_SETTINGS = {
  allowedSubmissionTypes: ["none", "tick", "offline", "text", "file", "link", "questions"],
  studentsCanSubmit: true,
  parentsCanSubmit: true,
  maxFilesPerSubmission: 5,
  maxFileSizeMb: 10,
  allowedMimeTypes: null,
  defaultLatePolicy: "allowed" as const,
  defaultLateWindowHours: 48,
  maxAssignmentsPerDay: null,
  allowWeekendAssignments: true,
  questionsEnabled: true,
};

const ACTIVE_ENROLLMENT_STATUSES = ["active", "section_assigned"] as const;

function requireSchoolId(scope: DataScope): string {
  const schoolId = atSchoolLevel(scope).schoolId;
  if (!schoolId) {
    throw new Error(
      "Homework needs a school. The caller's scope must resolve to a school node.",
    );
  }
  return schoolId;
}

function toDate(iso: string, field: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} is not a valid date.`);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HomeworkService {
  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /** The school default row, or null when the school never saved one. */
  async getSchoolSettings(scope: DataScope) {
    const schoolId = requireSchoolId(scope);
    const [row] = await db
      .select()
      .from(assignmentSettings)
      .where(
        and(
          eq(assignmentSettings.schoolId, schoolId),
          isNull(assignmentSettings.classId),
          scopeWhere(atSchoolLevel(scope), SETTINGS_COLS),
        ),
      );
    return row ?? null;
  }

  /** Creates or updates the school default (classId null) or a class override. */
  async upsertSettings(scope: DataScope, userId: string, input: {
    classId?: string | null;
    allowedSubmissionTypes?: string[];
    studentsCanSubmit?: boolean;
    parentsCanSubmit?: boolean;
    maxFilesPerSubmission?: number;
    maxFileSizeMb?: number;
    allowedMimeTypes?: string[] | null;
    defaultLatePolicy?: "not_allowed" | "allowed";
    defaultLateWindowHours?: number;
    maxAssignmentsPerDay?: number | null;
    allowWeekendAssignments?: boolean;
    questionsEnabled?: boolean;
  }) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    const classId = input.classId ?? null;

    if (classId) {
      const [cls] = await db
        .select({ id: classes.id })
        .from(classes)
        .where(
          and(
            eq(classes.id, classId),
            eq(classes.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), {
              organizationId: classes.organizationId,
              schoolId: classes.schoolId,
            }),
          ),
        );
      if (!cls) {
        throw new Error("Class not found in this school.");
      }
    }

    // Settings are admin-edited and rare — a plain find-then-write inside a
    // transaction instead of ON CONFLICT, which cannot target our PARTIAL
    // unique indexes (school-default vs per-class) without inference WHEREs.
    const defined = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Partial<typeof assignmentSettings.$inferInsert>;

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: assignmentSettings.id })
        .from(assignmentSettings)
        .where(
          and(
            eq(assignmentSettings.schoolId, schoolId),
            classId === null
              ? isNull(assignmentSettings.classId)
              : eq(assignmentSettings.classId, classId),
          ),
        );

      if (existing) {
        const [row] = await tx
          .update(assignmentSettings)
          .set(defined)
          .where(eq(assignmentSettings.id, existing.id))
          .returning();
        if (!row) throw new Error("Failed to save assignment settings.");
        return row;
      }

      const [row] = await tx
        .insert(assignmentSettings)
        .values({ organizationId, schoolId, classId, ...defined, createdBy: userId })
        .returning();
      if (!row) throw new Error("Failed to save assignment settings.");
      return row;
    });
  }

  /**
   * The EFFECTIVE settings for a class: the class override wins field by
   * field, the school default fills the rest, the platform fallback fills
   * everything if the school never saved a row. Publish-time checks read THIS.
   */
  async resolveSettings(schoolId: string, classId: string | null) {
    const rows = await db
      .select()
      .from(assignmentSettings)
      .where(
        and(
          eq(assignmentSettings.schoolId, schoolId),
          classId
            ? or(
                isNull(assignmentSettings.classId),
                eq(assignmentSettings.classId, classId),
              )
            : isNull(assignmentSettings.classId),
        ),
      );

    const schoolDefault = rows.find((r) => r.classId === null) ?? null;
    const classOverride = classId
      ? (rows.find((r) => r.classId === classId) ?? null)
      : null;

    const merged = {
      ...PLATFORM_DEFAULT_SETTINGS,
      ...(schoolDefault ?? {}),
      ...(classOverride ?? {}),
    };
    // These three are identity columns, not settings — drop whatever the
    // spread dragged in so the shape matches the contract's effective schema.
    delete (merged as Record<string, unknown>).id;
    delete (merged as Record<string, unknown>).organizationId;
    delete (merged as Record<string, unknown>).schoolId;
    delete (merged as Record<string, unknown>).classId;
    delete (merged as Record<string, unknown>).createdBy;
    delete (merged as Record<string, unknown>).createdAt;
    delete (merged as Record<string, unknown>).updatedAt;
    // The platform defaults guarantee every settings field is present; the
    // spread's optional types cannot see that, so the shape is asserted.
    return merged as {
      allowedSubmissionTypes: ("none" | "tick" | "offline" | "text" | "file" | "link" | "questions")[];
      studentsCanSubmit: boolean;
      parentsCanSubmit: boolean;
      maxFilesPerSubmission: number;
      maxFileSizeMb: number;
      allowedMimeTypes: string[] | null;
      defaultLatePolicy: "not_allowed" | "allowed";
      defaultLateWindowHours: number;
      maxAssignmentsPerDay: number | null;
      allowWeekendAssignments: boolean;
      questionsEnabled: boolean;
    };
  }

  // -------------------------------------------------------------------------
  // Rubrics
  // -------------------------------------------------------------------------

  async createRubric(scope: DataScope, userId: string, input: CreateRubricInput) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      const [rubric] = await tx
        .insert(rubrics)
        .values({
          organizationId,
          schoolId,
          name: input.name,
          description: input.description,
          createdBy: userId,
        })
        .returning();
      if (!rubric) throw new Error("Failed to create rubric.");

      for (const criterion of input.criteria) {
        const [c] = await tx
          .insert(rubricCriteria)
          .values({
            organizationId,
            schoolId,
            rubricId: rubric.id,
            name: criterion.name,
            description: criterion.description,
            sortOrder: criterion.sortOrder,
          })
          .returning();
        if (!c) throw new Error("Failed to create rubric criterion.");
        await tx.insert(rubricLevels).values(
          criterion.levels.map((l) => ({
            organizationId,
            schoolId,
            criterionId: c.id,
            label: l.label,
            description: l.description,
            points: l.points,
            sortOrder: l.sortOrder,
          })),
        );
      }
      return rubric;
    });
  }

  async listRubrics(scopes: DataScope[]) {
    return db
      .select()
      .from(rubrics)
      .where(scopeWhere(scopes.map(atSchoolLevel), RUBRIC_COLS))
      .orderBy(asc(rubrics.name));
  }

  async getRubricDetail(scope: DataScope, rubricId: string) {
    const [rubric] = await db
      .select()
      .from(rubrics)
      .where(
        and(eq(rubrics.id, rubricId), scopeWhere(atSchoolLevel(scope), RUBRIC_COLS)),
      );
    if (!rubric) return null;

    const criteria = await db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubricId))
      .orderBy(asc(rubricCriteria.sortOrder));

    const criterionIds = criteria.map((c) => c.id);
    const levels = criterionIds.length
      ? await db
          .select()
          .from(rubricLevels)
          .where(inArray(rubricLevels.criterionId, criterionIds))
          .orderBy(asc(rubricLevels.sortOrder))
      : [];

    return {
      ...rubric,
      criteria: criteria.map((c) => ({
        ...c,
        levels: levels.filter((l) => l.criterionId === c.id),
      })),
    };
  }

  /** Soft-retire (hard rule 2's spirit): assignments keep referencing it. */
  async setRubricActive(scope: DataScope, rubricId: string, isActive: boolean) {
    const [row] = await db
      .update(rubrics)
      .set({ isActive })
      .where(
        and(eq(rubrics.id, rubricId), scopeWhere(atSchoolLevel(scope), RUBRIC_COLS)),
      )
      .returning();
    return row ?? null;
  }

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------

  /**
   * Creates a DRAFT. The section (the gate pair's section) is the primary
   * target; explicit student enrollments may add individual targets.
   * closeAt absent = dueAt + the effective settings' late window.
   */
  async createAssignment(scope: DataScope, userId: string, input: {
    academicYearId: string;
    termId?: string | null;
    subjectId: string;
    sectionId: string;
    studentEnrollmentIds?: string[];
    kind?: string;
    title: string;
    description?: string | null;
    topic?: string | null;
    estimatedMinutes?: number | null;
    submissionTypes: string[];
    gradingMode: string;
    maxMarks?: string | null;
    gradingScaleId?: string | null;
    rubricId?: string | null;
    dueAt: string;
    closeAt?: string | null;
    latePolicy?: "not_allowed" | "allowed" | null;
    allowResubmission?: boolean;
    maxSubmissions?: number | null;
    resources?: {
      resourceType: "file" | "link" | "video";
      objectId?: string;
      url?: string;
      title?: string;
      sortOrder?: number;
    }[];
  }) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      // The section is the anchor: year and class come from it.
      const [section] = await tx
        .select({
          id: sections.id,
          classId: sections.classId,
          academicYearId: sections.academicYearId,
        })
        .from(sections)
        .where(
          and(
            eq(sections.id, input.sectionId),
            eq(sections.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), SECTION_COLS),
          ),
        );
      if (!section) {
        throw new Error("Section not found in this school.");
      }
      if (input.academicYearId !== section.academicYearId) {
        throw new Error(
          "Academic year does not match the section's year. Assign homework in the session the section belongs to.",
        );
      }

      const [subject] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(
          and(
            eq(subjects.id, input.subjectId),
            eq(subjects.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), SUBJECT_COLS),
          ),
        );
      if (!subject) {
        throw new Error("Subject not found in this school.");
      }

      if (input.rubricId) {
        const [r] = await tx
          .select({ id: rubrics.id })
          .from(rubrics)
          .where(and(eq(rubrics.id, input.rubricId), eq(rubrics.schoolId, schoolId)));
        if (!r) throw new Error("Rubric not found in this school.");
      }
      if (input.gradingScaleId) {
        const [s] = await tx
          .select({ id: gradingScales.id })
          .from(gradingScales)
          .where(
            and(
              eq(gradingScales.id, input.gradingScaleId),
              eq(gradingScales.schoolId, schoolId),
            ),
          );
        if (!s) throw new Error("Grading scale not found in this school.");
      }

      const settings = await this.resolveSettings(schoolId, section.classId);

      const dueAt = toDate(input.dueAt, "dueAt");
      const latePolicy = input.latePolicy ?? settings.defaultLatePolicy;
      const closeAt = input.closeAt
        ? toDate(input.closeAt, "closeAt")
        : latePolicy === "allowed"
          ? new Date(dueAt.getTime() + settings.defaultLateWindowHours * 3600_000)
          : dueAt;
      if (closeAt.getTime() < dueAt.getTime()) {
        throw new Error("The closing time cannot be before the due time.");
      }
      if (latePolicy === "not_allowed" && closeAt.getTime() !== dueAt.getTime()) {
        throw new Error(
          "A no-late-submissions assignment closes exactly when it is due.",
        );
      }

      const [assignment] = await tx
        .insert(assignments)
        .values({
          organizationId,
          schoolId,
          academicYearId: section.academicYearId,
          termId: input.termId ?? null,
          subjectId: input.subjectId,
          kind: (input.kind ?? "homework") as typeof assignments.$inferInsert.kind,
          title: input.title,
          description: input.description ?? null,
          topic: input.topic ?? null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          submissionTypes: input.submissionTypes as typeof assignments.$inferInsert.submissionTypes,
          gradingMode: input.gradingMode as typeof assignments.$inferInsert.gradingMode,
          maxMarks: input.maxMarks ?? null,
          gradingScaleId: input.gradingScaleId ?? null,
          rubricId: input.rubricId ?? null,
          publishAt: null,
          dueAt,
          closeAt,
          latePolicy,
          allowResubmission: input.allowResubmission ?? true,
          maxSubmissions: input.maxSubmissions ?? null,
          status: "draft",
          createdBy: userId,
        })
        .returning();
      if (!assignment) throw new Error("Failed to create the assignment.");

      await tx.insert(assignmentTargets).values({
        organizationId,
        schoolId,
        assignmentId: assignment.id,
        targetType: "section",
        sectionId: input.sectionId,
      });

      if (input.studentEnrollmentIds?.length) {
        const enrollments = await tx
          .select({
            id: studentEnrollments.id,
            sectionId: studentEnrollments.sectionId,
          })
          .from(studentEnrollments)
          .where(
            and(
              inArray(studentEnrollments.id, input.studentEnrollmentIds),
              eq(studentEnrollments.schoolId, schoolId),
              eq(studentEnrollments.sectionId, input.sectionId),
            ),
          );
        if (enrollments.length !== input.studentEnrollmentIds.length) {
          throw new Error(
            "One or more students are not enrolled in the targeted section.",
          );
        }
        await tx.insert(assignmentTargets).values(
          enrollments.map((e) => ({
            organizationId,
            schoolId,
            assignmentId: assignment.id,
            targetType: "student" as const,
            studentEnrollmentId: e.id,
          })),
        );
      }

      if (input.resources?.length) {
        await tx.insert(assignmentResources).values(
          input.resources.map((r) => ({
            organizationId,
            schoolId,
            assignmentId: assignment.id,
            resourceType: r.resourceType,
            objectId: r.objectId ?? null,
            url: r.url ?? null,
            title: r.title ?? null,
            sortOrder: r.sortOrder ?? 0,
          })),
        );
      }

      return assignment;
    });
  }

  /**
   * PATCH, with the post-publish integrity rule: any material edit to a
   * PUBLISHED assignment snapshots the previous row into `assignment_
   * revisions` first. The due/close pair follows the same rules as create.
   */
  async updateAssignment(scope: DataScope, userId: string, input: UpdateAssignmentInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.id, input.id),
            eq(assignments.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), ASSIGNMENT_COLS),
          ),
        );
      if (!existing) throw new Error("Assignment not found in this school.");
      if (existing.subjectId !== input.subjectId) {
        throw new Error("The named subject does not match this assignment.");
      }
      if (["closed", "cancelled"].includes(existing.status)) {
        throw new Error(
          `A ${existing.status} assignment can no longer be edited.`,
        );
      }

      const [target] = await tx
        .select({ sectionId: assignmentTargets.sectionId })
        .from(assignmentTargets)
        .where(
          and(
            eq(assignmentTargets.assignmentId, existing.id),
            eq(assignmentTargets.targetType, "section"),
          ),
        )
        .limit(1);
      if (!target?.sectionId || target.sectionId !== input.sectionId) {
        throw new Error("The named section is not a target of this assignment.");
      }

      const dueAt = input.dueAt ? toDate(input.dueAt, "dueAt") : existing.dueAt;
      let closeAt = input.closeAt ? toDate(input.closeAt, "closeAt") : existing.closeAt;
      const latePolicy = input.latePolicy ?? existing.latePolicy;
      if (closeAt.getTime() < dueAt.getTime()) {
        if (latePolicy === "allowed" && !input.closeAt) {
          const settings = await this.resolveSettings(schoolId, null);
          closeAt = new Date(dueAt.getTime() + settings.defaultLateWindowHours * 3600_000);
        } else {
          throw new Error("The closing time cannot be before the due time.");
        }
      }
      if (latePolicy === "not_allowed" && closeAt.getTime() !== dueAt.getTime()) {
        throw new Error(
          "A no-late-submissions assignment closes exactly when it is due.",
        );
      }

      // The revision is the PRE-image, written only for published rows whose
      // material content actually changed.
      const materialChanged =
        existing.status === "published" &&
        (input.title !== undefined ||
          input.description !== undefined ||
          input.topic !== undefined ||
          input.dueAt !== undefined ||
          input.closeAt !== undefined ||
          input.resources !== undefined ||
          (input.submissionTypes !== undefined &&
            input.submissionTypes.join() !== existing.submissionTypes.join()));
      if (materialChanged) {
        const [revRow] = await tx
          .select({ value: count() })
          .from(assignmentRevisions)
          .where(eq(assignmentRevisions.assignmentId, existing.id));
        const prevResources = await tx
          .select()
          .from(assignmentResources)
          .where(eq(assignmentResources.assignmentId, existing.id))
          .orderBy(asc(assignmentResources.sortOrder));
        await tx.insert(assignmentRevisions).values({
          organizationId: existing.organizationId,
          schoolId: existing.schoolId,
          assignmentId: existing.id,
          revisionNo: Number(revRow?.value ?? 0) + 1,
          snapshot: { ...existing, resources: prevResources },
          changeSummary: input.changeSummary ?? "Assignment edited after publish.",
          changedBy: userId,
        });
      }

      const [updated] = await tx
        .update(assignments)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.topic !== undefined ? { topic: input.topic } : {}),
          ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
          ...(input.submissionTypes !== undefined
            ? { submissionTypes: input.submissionTypes as typeof assignments.$inferInsert.submissionTypes }
            : {}),
          dueAt,
          closeAt,
          latePolicy,
          ...(input.allowResubmission !== undefined ? { allowResubmission: input.allowResubmission } : {}),
          ...(input.maxSubmissions !== undefined ? { maxSubmissions: input.maxSubmissions } : {}),
        })
        .where(eq(assignments.id, existing.id))
        .returning();
      if (!updated) throw new Error("Failed to update the assignment.");

      if (input.resources !== undefined) {
        await tx
          .delete(assignmentResources)
          .where(eq(assignmentResources.assignmentId, existing.id));
        if (input.resources.length) {
          await tx.insert(assignmentResources).values(
            input.resources.map((r) => ({
              organizationId: existing.organizationId,
              schoolId: existing.schoolId,
              assignmentId: existing.id,
              resourceType: r.resourceType,
              objectId: r.objectId ?? null,
              url: r.url ?? null,
              title: r.title ?? null,
              sortOrder: r.sortOrder ?? 0,
            })),
          );
        }
      }

      return updated;
    });
  }

  /**
   * PUBLISH — the resolution moment. Active enrollments in the target section
   * become `student_assignments` rows with deadlines snapshotted; publish-time
   * caps (per-day, weekend) are checked against the effective settings.
   */
  async publishAssignment(scope: DataScope, userId: string, assignmentId: string) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.id, assignmentId),
            eq(assignments.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), ASSIGNMENT_COLS),
          ),
        );
      if (!assignment) throw new Error("Assignment not found in this school.");
      if (assignment.status !== "draft" && assignment.status !== "scheduled") {
        throw new Error(`A ${assignment.status} assignment cannot be published.`);
      }

      const targets = await tx
        .select({ sectionId: assignmentTargets.sectionId })
        .from(assignmentTargets)
        .where(
          and(
            eq(assignmentTargets.assignmentId, assignment.id),
            eq(assignmentTargets.targetType, "section"),
          ),
        );
      if (targets.length === 0) {
        throw new Error("The assignment has no section target to resolve.");
      }
      const sectionIds = targets.map((t) => t.sectionId as string);

      const [section] = await tx
        .select({ classId: sections.classId })
        .from(sections)
        .where(and(inArray(sections.id, sectionIds), eq(sections.schoolId, schoolId)))
        .limit(1);

      const settings = await this.resolveSettings(schoolId, section?.classId ?? null);

      // Publish-time caps (application-level rules from the reference).
      const dueDay = assignment.dueAt.toISOString().slice(0, 10);
      const weekday = assignment.dueAt.getUTCDay();
      if (!settings.allowWeekendAssignments && (weekday === 0 || weekday === 6)) {
        throw new Error(
          "This school does not allow homework due on a weekend. Move the due date to a weekday.",
        );
      }
      if (settings.maxAssignmentsPerDay !== null) {
        const sameDayIds = await tx
          .select({ id: assignments.id })
          .from(assignments)
          .where(
            and(
              eq(assignments.schoolId, schoolId),
              inArray(assignments.status, ["published", "scheduled"]),
              ne(assignments.id, assignment.id),
              sql`${assignments.dueAt}::date = ${dueDay}::date`,
            ),
          );
        if (sameDayIds.length) {
          const [sharedRow] = await tx
            .select({ value: count() })
            .from(assignmentTargets)
            .where(
              and(
                inArray(assignmentTargets.assignmentId, sameDayIds.map((r) => r.id)),
                inArray(assignmentTargets.sectionId, sectionIds),
              ),
            );
          if (Number(sharedRow?.value ?? 0) >= settings.maxAssignmentsPerDay) {
            throw new Error(
              `The per-day limit (${settings.maxAssignmentsPerDay}) for this class is already reached on ${dueDay}.`,
            );
          }
        }
      }

      // Resolve: every active enrollment in the target sections.
      const enrollments = await tx
        .select({
          id: studentEnrollments.id,
          sectionId: studentEnrollments.sectionId,
        })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.schoolId, schoolId),
            eq(studentEnrollments.academicYearId, assignment.academicYearId),
            inArray(studentEnrollments.sectionId, sectionIds),
            inArray(studentEnrollments.enrollmentStatus, [...ACTIVE_ENROLLMENT_STATUSES]),
          ),
        );

      // Plus the explicitly targeted individuals (their enrollment rows).
      const individualTargets = await tx
        .select({ studentEnrollmentId: assignmentTargets.studentEnrollmentId })
        .from(assignmentTargets)
        .where(
          and(
            eq(assignmentTargets.assignmentId, assignment.id),
            eq(assignmentTargets.targetType, "student"),
          ),
        );
      const individualIds = individualTargets
        .map((t) => t.studentEnrollmentId as string)
        .filter((id) => !enrollments.some((e) => e.id === id));
      const individuals = individualIds.length
        ? await tx
            .select({
              id: studentEnrollments.id,
              sectionId: studentEnrollments.sectionId,
            })
            .from(studentEnrollments)
            .where(
              and(
                inArray(studentEnrollments.id, individualIds),
                eq(studentEnrollments.schoolId, schoolId),
              ),
            )
        : [];

      const rows = [...enrollments, ...individuals];
      if (rows.length) {
        await tx
          .insert(studentAssignments)
          .values(
            rows.map((e) => ({
              organizationId: assignment.organizationId,
              schoolId: assignment.schoolId,
              assignmentId: assignment.id,
              studentEnrollmentId: e.id,
              sectionId: e.sectionId as string,
              effectiveDueAt: assignment.dueAt,
              effectiveCloseAt: assignment.closeAt,
            })),
          )
          .onConflictDoNothing();
      }

      const [published] = await tx
        .update(assignments)
        .set({ status: "published", publishAt: new Date() })
        .where(eq(assignments.id, assignment.id))
        .returning();
      void userId;
      return published ?? assignment;
    });
  }

  /** Cancel — nothing is deleted; open rows keep their history. */
  async cancelAssignment(scope: DataScope, userId: string, assignmentId: string, reason: string) {
    const schoolId = requireSchoolId(scope);
    const [row] = await db
      .update(assignments)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: reason,
      })
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.schoolId, schoolId),
          scopeWhere(atSchoolLevel(scope), ASSIGNMENT_COLS),
          inArray(assignments.status, ["draft", "scheduled", "published"]),
        ),
      )
      .returning();
    void userId;
    if (!row) throw new Error("Assignment not found, or already closed/cancelled.");
    return row;
  }

  /** Close — stop submissions without cancelling the record. */
  async closeAssignment(scope: DataScope, assignmentId: string) {
    const schoolId = requireSchoolId(scope);
    const [row] = await db
      .update(assignments)
      .set({ status: "closed" })
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.schoolId, schoolId),
          scopeWhere(atSchoolLevel(scope), ASSIGNMENT_COLS),
          eq(assignments.status, "published"),
        ),
      )
      .returning();
    if (!row) throw new Error("Assignment not found, or not open for closing.");
    return row;
  }

  /** The staff list — the year's homework with subject names, scope-clipped. */
  async listAssignments(scopes: DataScope[], input: {
    academicYearId: string;
    subjectId?: string;
    status?: "draft" | "scheduled" | "published" | "closed" | "cancelled";
    dueFrom?: string;
    dueTo?: string;
  }) {
    const rows = await db
      .select({
        assignment: assignments,
        subjectName: subjects.name,
      })
      .from(assignments)
      .innerJoin(subjects, eq(assignments.subjectId, subjects.id))
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), ASSIGNMENT_COLS),
          eq(assignments.academicYearId, input.academicYearId),
          input.subjectId ? eq(assignments.subjectId, input.subjectId) : undefined,
          input.status ? eq(assignments.status, input.status) : undefined,
          input.dueFrom ? gte(assignments.dueAt, toDate(input.dueFrom, "dueFrom")) : undefined,
          input.dueTo ? lte(assignments.dueAt, toDate(input.dueTo, "dueTo")) : undefined,
        ),
      )
      .orderBy(desc(assignments.dueAt));
    return rows.map((r) => ({ ...r.assignment, subjectName: r.subjectName }));
  }

  async getAssignmentDetail(scope: DataScope, assignmentId: string) {
    const [assignment] = await db
      .select({
        assignment: assignments,
        subjectName: subjects.name,
      })
      .from(assignments)
      .innerJoin(subjects, eq(assignments.subjectId, subjects.id))
      .where(
        and(
          eq(assignments.id, assignmentId),
          scopeWhere(atSchoolLevel(scope), ASSIGNMENT_COLS),
        ),
      );
    if (!assignment) return null;

    const targets = await db
      .select()
      .from(assignmentTargets)
      .where(eq(assignmentTargets.assignmentId, assignmentId));
    const [revCountRow] = await db
      .select({ value: count() })
      .from(assignmentRevisions)
      .where(eq(assignmentRevisions.assignmentId, assignmentId));

    return {
      ...assignment.assignment,
      subjectName: assignment.subjectName,
      targets,
      revisionCount: Number(revCountRow?.value ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // Student assignments — the grading grid + lifecycle acts
  // -------------------------------------------------------------------------

  async listStudentAssignments(scopes: DataScope[], assignmentId: string, status?: string) {
    const rows = await db
      .select({
        sa: studentAssignments,
        firstName: students.firstName,
        lastName: students.lastName,
        admissionNumber: students.admissionNumber,
        rollNumber: studentEnrollments.rollNumber,
      })
      .from(studentAssignments)
      .innerJoin(studentEnrollments, eq(studentAssignments.studentEnrollmentId, studentEnrollments.id))
      .innerJoin(students, eq(studentEnrollments.studentId, students.id))
      .where(
        and(
          eq(studentAssignments.assignmentId, assignmentId),
          scopeWhere(scopes.map(atSchoolLevel), STUDENT_ASSIGNMENT_COLS),
          status
            ? eq(studentAssignments.status, status as typeof studentAssignments.$inferSelect.status)
            : undefined,
        ),
      )
      .orderBy(asc(sql`NULLIF(${studentEnrollments.rollNumber}, '')::int`), asc(students.firstName));

    return rows.map((r) => ({
      ...r.sa,
      studentName: [r.firstName, r.lastName].filter(Boolean).join(" "),
      admissionNumber: r.admissionNumber,
      rollNumber: r.rollNumber,
    }));
  }

  async getStudentAssignmentDetail(scope: DataScope, studentAssignmentId: string) {
    const [sa] = await db
      .select()
      .from(studentAssignments)
      .where(
        and(
          eq(studentAssignments.id, studentAssignmentId),
          scopeWhere(atSchoolLevel(scope), STUDENT_ASSIGNMENT_COLS),
        ),
      );
    if (!sa) return null;

    const submissionRows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.studentAssignmentId, studentAssignmentId))
      .orderBy(desc(submissions.versionNo));
    const evaluationRows = await db
      .select()
      .from(assignmentEvaluations)
      .where(eq(assignmentEvaluations.studentAssignmentId, studentAssignmentId))
      .orderBy(desc(assignmentEvaluations.evaluatedAt));

    return { ...sa, submissions: submissionRows, evaluations: evaluationRows };
  }

  /**
   * Append an EXTENSION row and move the student's effective deadlines. A
   * missing sweep may already have flagged the row — the extension revives it
   * to `assigned` so the student can actually use the new window.
   */
  async grantExtension(scope: DataScope, userId: string, input: GrantExtensionInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [sa] = await tx
        .select()
        .from(studentAssignments)
        .where(
          and(
            eq(studentAssignments.id, input.id),
            eq(studentAssignments.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), STUDENT_ASSIGNMENT_COLS),
          ),
        );
      if (!sa) throw new Error("Student assignment not found in this school.");

      const newDueAt = toDate(input.newDueAt, "newDueAt");
      const newCloseAt = toDate(input.newCloseAt, "newCloseAt");
      if (newCloseAt.getTime() < newDueAt.getTime()) {
        throw new Error("The extended closing time cannot be before its due time.");
      }

      await tx.insert(assignmentExtensions).values({
        organizationId: sa.organizationId,
        schoolId: sa.schoolId,
        studentAssignmentId: sa.id,
        previousDueAt: sa.effectiveDueAt,
        previousCloseAt: sa.effectiveCloseAt,
        newDueAt,
        newCloseAt,
        reason: input.reason ?? null,
        grantedBy: userId,
      });

      const [updated] = await tx
        .update(studentAssignments)
        .set({
          effectiveDueAt: newDueAt,
          effectiveCloseAt: newCloseAt,
          ...(sa.status === "missing"
            ? { status: "assigned" as const, missingMarkedAt: null }
            : {}),
          statusChangedAt: new Date(),
        })
        .where(eq(studentAssignments.id, sa.id))
        .returning();
      return updated ?? sa;
    });
  }

  /** Excuse a student from the assignment — refused once work exists. */
  async excuseStudentAssignment(scope: DataScope, userId: string, input: {
    id: string;
    reason: string;
  }) {
    const schoolId = requireSchoolId(scope);
    const [updated] = await db
      .update(studentAssignments)
      .set({
        status: "excused",
        excusedBy: userId,
        excusedReason: input.reason,
        excusedAt: new Date(),
        statusChangedAt: new Date(),
      })
      .where(
        and(
          eq(studentAssignments.id, input.id),
          eq(studentAssignments.schoolId, schoolId),
          scopeWhere(atSchoolLevel(scope), STUDENT_ASSIGNMENT_COLS),
          // A submitted or reviewed row has work on record — grade it instead.
          inArray(studentAssignments.status, [
            "assigned",
            "in_progress",
            "missing",
            "resubmit_requested",
          ]),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error(
        "This student already has work on record — grade the submission instead of excusing it.",
      );
    }
    return updated;
  }

  // -------------------------------------------------------------------------
  // Evaluations — append-only; the current row is denormalised onto the
  // student assignment
  // -------------------------------------------------------------------------

  async evaluateStudentAssignment(scope: DataScope, userId: string, input: EvaluateStudentAssignmentInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ sa: studentAssignments, assignment: assignments })
        .from(studentAssignments)
        .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
        .where(
          and(
            eq(studentAssignments.id, input.id),
            eq(studentAssignments.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), STUDENT_ASSIGNMENT_COLS),
          ),
        );
      if (!row) throw new Error("Student assignment not found in this school.");
      const { sa, assignment } = row;

      // The gate pair must describe THIS row — otherwise the subject-gate
      // fact a teacher legitimately holds could grade a stranger's work.
      if (sa.sectionId !== input.sectionId || assignment.subjectId !== input.subjectId) {
        throw new Error("The named section/subject do not match this student's assignment.");
      }

      if (!["published", "closed"].includes(assignment.status)) {
        throw new Error("Only a published assignment can be graded.");
      }
      if (sa.status === "excused") {
        throw new Error("An excused student is not graded.");
      }

      let marks = input.marks ?? null;
      if (input.outcome === "resubmit_requested") {
        marks = null;
      } else if (assignment.gradingMode === "marks") {
        if (marks === null) {
          throw new Error("This assignment is graded out of marks — enter a score.");
        }
        const max = Number(assignment.maxMarks);
        if (Number(marks) > max) {
          throw new Error(`The score cannot exceed the maximum (${max}).`);
        }
      } else if (assignment.gradingMode === "rubric") {
        if (!input.rubricScores?.length) {
          throw new Error("Score every rubric criterion before saving.");
        }
        const criteria = await tx
          .select({ id: rubricCriteria.id })
          .from(rubricCriteria)
          .where(
            and(
              eq(rubricCriteria.rubricId, assignment.rubricId as string),
              eq(rubricCriteria.schoolId, schoolId),
            ),
          );
        const validIds = new Set(criteria.map((c) => c.id));
        if (input.rubricScores.some((s) => !validIds.has(s.criterionId))) {
          throw new Error("A rubric score names a criterion outside this rubric.");
        }
        marks = String(
          input.rubricScores.reduce((sum, s) => sum + Number(s.points), 0),
        );
      } else {
        // none / grade / completion: marks only via the grade field.
        marks = null;
      }

      const [latestSubmission] = await tx
        .select({ id: submissions.id })
        .from(submissions)
        .where(eq(submissions.studentAssignmentId, sa.id))
        .orderBy(desc(submissions.versionNo))
        .limit(1);

      if (
        input.outcome === "reviewed" &&
        !latestSubmission &&
        !["none", "completion"].includes(assignment.gradingMode)
      ) {
        throw new Error("There is nothing to review yet — no submission exists.");
      }

      // Flip the current row, then append (the partial unique index holds
      // this honest even under a race).
      await tx
        .update(assignmentEvaluations)
        .set({ isCurrent: false })
        .where(
          and(
            eq(assignmentEvaluations.studentAssignmentId, sa.id),
            eq(assignmentEvaluations.isCurrent, true),
          ),
        );

      const [evaluation] = await tx
        .insert(assignmentEvaluations)
        .values({
          organizationId: sa.organizationId,
          schoolId: sa.schoolId,
          studentAssignmentId: sa.id,
          submissionId: latestSubmission?.id ?? null,
          outcome: input.outcome,
          marks,
          grade: input.grade ?? null,
          feedback: input.feedback ?? null,
          isCurrent: true,
          evaluatedBy: userId,
        })
        .returning();
      if (!evaluation) throw new Error("Failed to save the evaluation.");

      if (input.rubricScores?.length) {
        await tx.insert(assignmentRubricScores).values(
          input.rubricScores.map((s) => ({
            organizationId: sa.organizationId,
            schoolId: sa.schoolId,
            evaluationId: evaluation.id,
            criterionId: s.criterionId,
            levelId: s.levelId ?? null,
            points: s.points,
            comment: s.comment ?? null,
          })),
        );
      }

      const now = new Date();
      const [updatedSa] = await tx
        .update(studentAssignments)
        .set({
          currentEvaluationId: evaluation.id,
          currentMarks: marks,
          currentGrade: input.grade ?? null,
          reviewedAt: input.outcome === "reviewed" ? now : null,
          status:
            input.outcome === "reviewed" ? ("reviewed" as const) : ("resubmit_requested" as const),
          completionSource:
            !latestSubmission && input.outcome === "reviewed"
              ? ("teacher_verified" as const)
              : sa.completionSource,
          statusChangedAt: now,
        })
        .where(eq(studentAssignments.id, sa.id))
        .returning();

      return { evaluation, studentAssignment: updatedSa ?? sa };
    });
  }

  // -------------------------------------------------------------------------
  // PORTAL — the family door. Every query filters by the login's OWNED
  // studentIds; the answer keys of slice B never appear in these shapes.
  // -------------------------------------------------------------------------

  /** Family list: the children's homework across the login's owned students. */
  async portalList(studentIds: string[], filters: {
    studentId?: string;
    status?: string;
  } = {}) {
    const owned = filters.studentId
      ? studentIds.includes(filters.studentId)
        ? [filters.studentId]
        : []
      : studentIds;
    if (owned.length === 0) return [];

    const rows = await db
      .select({
        sa: studentAssignments,
        assignment: assignments,
        subjectName: subjects.name,
        teacherName: user.name,
      })
      .from(studentAssignments)
      .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
      .innerJoin(subjects, eq(assignments.subjectId, subjects.id))
      .innerJoin(user, eq(assignments.createdBy, user.id))
      .innerJoin(
        studentEnrollments,
        eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          inArray(studentEnrollments.studentId, owned),
          inArray(assignments.status, ["published", "closed"]),
          filters.status
            ? eq(studentAssignments.status, filters.status as typeof studentAssignments.$inferSelect.status)
            : undefined,
        ),
      )
      .orderBy(asc(assignments.dueAt))
      .limit(500);

    return rows.map((r) => ({
      studentAssignmentId: r.sa.id,
      assignmentId: r.assignment.id,
      subjectName: r.subjectName,
      teacherName: r.teacherName,
      title: r.assignment.title,
      description: r.assignment.description,
      kind: r.assignment.kind,
      topic: r.assignment.topic,
      estimatedMinutes: r.assignment.estimatedMinutes,
      submissionTypes: r.assignment.submissionTypes,
      status: r.sa.status,
      dueAt: r.sa.effectiveDueAt,
      closeAt: r.sa.effectiveCloseAt,
      isLate: r.sa.isLate,
      submittedAt: r.sa.submittedAt,
      submissionCount: r.sa.submissionCount,
      currentMarks: r.sa.currentMarks,
      currentGrade: r.sa.currentGrade,
      feedback: null,
      reviewedAt: r.sa.reviewedAt,
      firstViewedAt: r.sa.firstViewedAt,
    }));
  }

  /** One family view: assignment + own submissions + evaluations + acks. */
  async portalGet(studentIds: string[], studentAssignmentId: string) {
    const [row] = await db
      .select({
        sa: studentAssignments,
        assignment: assignments,
        subjectName: subjects.name,
        teacherName: user.name,
      })
      .from(studentAssignments)
      .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
      .innerJoin(subjects, eq(assignments.subjectId, subjects.id))
      .innerJoin(user, eq(assignments.createdBy, user.id))
      .innerJoin(
        studentEnrollments,
        eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(studentAssignments.id, studentAssignmentId),
          inArray(studentEnrollments.studentId, studentIds),
          inArray(assignments.status, ["published", "closed"]),
        ),
      );
    if (!row) return null;
    const { sa, assignment } = row;

    const [submissionRows, evaluationRows, resourceRows, ackRows] = await Promise.all([
      db
        .select()
        .from(submissions)
        .where(eq(submissions.studentAssignmentId, sa.id))
        .orderBy(desc(submissions.versionNo)),
      db
        .select()
        .from(assignmentEvaluations)
        .where(eq(assignmentEvaluations.studentAssignmentId, sa.id))
        .orderBy(desc(assignmentEvaluations.evaluatedAt)),
      db
        .select()
        .from(assignmentResources)
        .where(eq(assignmentResources.assignmentId, assignment.id))
        .orderBy(asc(assignmentResources.sortOrder)),
      db
        .select({ guardianUserId: assignmentAcknowledgements.guardianUserId })
        .from(assignmentAcknowledgements)
        .where(eq(assignmentAcknowledgements.studentAssignmentId, sa.id)),
    ]);

    const fileRows = submissionRows.length
      ? await db
          .select({
            submissionId: submissionFiles.submissionId,
            objectId: submissionFiles.objectId,
            sortOrder: submissionFiles.sortOrder,
          })
          .from(submissionFiles)
          .where(inArray(submissionFiles.submissionId, submissionRows.map((s) => s.id)))
      : [];

    return {
      studentAssignmentId: sa.id,
      assignmentId: assignment.id,
      subjectName: row.subjectName,
      teacherName: row.teacherName,
      title: assignment.title,
      description: assignment.description,
      kind: assignment.kind,
      topic: assignment.topic,
      estimatedMinutes: assignment.estimatedMinutes,
      submissionTypes: assignment.submissionTypes,
      status: sa.status,
      dueAt: sa.effectiveDueAt,
      closeAt: sa.effectiveCloseAt,
      isLate: sa.isLate,
      submittedAt: sa.submittedAt,
      submissionCount: sa.submissionCount,
      currentMarks: sa.currentMarks,
      currentGrade: sa.currentGrade,
      feedback: evaluationRows.find((e) => e.isCurrent)?.feedback ?? null,
      reviewedAt: sa.reviewedAt,
      firstViewedAt: sa.firstViewedAt,
      resources: resourceRows.map((r) => ({
        resourceType: r.resourceType,
        objectId: r.objectId,
        url: r.url,
        title: r.title,
      })),
      submissions: submissionRows.map((s) => ({
        id: s.id,
        versionNo: s.versionNo,
        bodyText: s.bodyText,
        linkUrl: s.linkUrl,
        submittedByRole: s.submittedByRole,
        isLate: s.isLate,
        submittedAt: s.submittedAt,
        files: fileRows
          .filter((f) => f.submissionId === s.id)
          .map((f) => ({ objectId: f.objectId, sortOrder: f.sortOrder })),
      })),
      evaluations: evaluationRows.map((e) => ({
        outcome: e.outcome,
        marks: e.marks,
        grade: e.grade,
        feedback: e.feedback,
        evaluatedAt: e.evaluatedAt,
        isCurrent: e.isCurrent,
      })),
      acknowledgedBy: ackRows.map((a) => a.guardianUserId),
    };
  }

  /** firstViewedAt is set once — the diary's "opened it" fact. */
  async portalMarkViewed(studentIds: string[], studentAssignmentId: string) {
    const [sa] = await db
      .select({ id: studentAssignments.id, firstViewedAt: studentAssignments.firstViewedAt })
      .from(studentAssignments)
      .innerJoin(
        studentEnrollments,
        eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(studentAssignments.id, studentAssignmentId),
          inArray(studentEnrollments.studentId, studentIds),
        ),
      );
    if (!sa) return null;
    if (sa.firstViewedAt) return sa;
    const [updated] = await db
      .update(studentAssignments)
      .set({ firstViewedAt: new Date() })
      .where(eq(studentAssignments.id, sa.id))
      .returning({ id: studentAssignments.id, firstViewedAt: studentAssignments.firstViewedAt });
    return updated ?? null;
  }

  /**
   * Whether this login acts as a PARENT for this child (a guardian-linked
   * portal row), which decides the submission's author role.
   */
  async isParentLogin(userId: string, studentId: string): Promise<boolean> {
    const [row] = await db
      .select({ guardianId: studentPortalAccess.guardianId })
      .from(studentPortalAccess)
      .where(
        and(
          eq(studentPortalAccess.userId, userId),
          eq(studentPortalAccess.studentId, studentId),
          eq(studentPortalAccess.isActive, true),
          isNotNull(studentPortalAccess.guardianId),
        ),
      )
      .limit(1);
    return !!row;
  }

  /**
   * The family submit: versioned, late-checked, cap-checked. The student
   * assignment row is the single thing that moves; submissions are immutable.
   * The author role (parent vs the student's own login) comes from the portal
   * access row's guardian link, and the per-role submit switches are honored.
   */
  async portalSubmit(userId: string, studentIds: string[], input: PortalSubmitAssignmentInput) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          sa: studentAssignments,
          assignment: assignments,
          studentId: studentEnrollments.studentId,
          classId: sections.classId,
        })
        .from(studentAssignments)
        .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
        .innerJoin(
          studentEnrollments,
          eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
        )
        .innerJoin(sections, eq(studentAssignments.sectionId, sections.id))
        .where(
          and(
            eq(studentAssignments.id, input.studentAssignmentId),
            inArray(studentEnrollments.studentId, studentIds),
          ),
        );
      if (!row) throw new Error("Student assignment not found.");
      const { sa, assignment, studentId, classId } = row;
      if (!["published", "closed"].includes(assignment.status)) {
        throw new Error("This assignment is not open for submissions.");
      }
      if (sa.status === "excused") {
        throw new Error("This student was excused from the assignment.");
      }
      if (sa.status === "reviewed" && !assignment.allowResubmission) {
        throw new Error("This assignment does not accept resubmissions.");
      }

      // Which channels the family used must be channels the assignment allows.
      const types = assignment.submissionTypes;
      const used = [
        input.bodyText ? "text" : null,
        input.linkUrl ? "link" : null,
        input.fileObjectIds?.length ? "file" : null,
      ].filter(Boolean);
      if (used.some((u) => !types.includes(u as (typeof types)[number]))) {
        throw new Error("This assignment does not accept that submission type.");
      }

      // The caller's role for THIS child, from their portal access rows: a
      // guardian-linked row means the parent is submitting.
      const accessRows = await tx
        .select({ guardianId: studentPortalAccess.guardianId })
        .from(studentPortalAccess)
        .where(
          and(
            eq(studentPortalAccess.userId, userId),
            eq(studentPortalAccess.studentId, studentId),
            eq(studentPortalAccess.isActive, true),
          ),
        );
      if (accessRows.length === 0) {
        throw new Error("This login has no portal access for the student.");
      }
      const isParent = accessRows.some((r) => r.guardianId !== null);
      const authorRole = isParent ? ("parent" as const) : ("student" as const);

      const settings = await this.resolveSettings(row.sa.schoolId, classId);
      if (isParent && !settings.parentsCanSubmit) {
        throw new Error("This school does not allow parents to submit homework.");
      }
      if (!isParent && !settings.studentsCanSubmit) {
        throw new Error("This school does not allow student submissions.");
      }

      // Late logic: past close is never allowed; past due only under the
      // allowed policy.
      const now = new Date();
      const isLate = now.getTime() > sa.effectiveDueAt.getTime();
      if (now.getTime() > sa.effectiveCloseAt.getTime()) {
        throw new Error(
          "The submission window closed. Ask the teacher for an extension.",
        );
      }
      if (isLate && assignment.latePolicy === "not_allowed") {
        throw new Error("Late submissions are not allowed for this assignment.");
      }

      // Versioning + caps.
      const versionNo = sa.submissionCount + 1;
      if (!assignment.allowResubmission && sa.submissionCount > 0) {
        throw new Error("This assignment does not accept resubmissions.");
      }
      if (assignment.maxSubmissions !== null && versionNo > assignment.maxSubmissions) {
        throw new Error(
          `This assignment allows at most ${assignment.maxSubmissions} submission(s).`,
        );
      }

      // Files: count cap + the objects must exist in THIS org (a foreign-org
      // object id must not become this school's homework).
      const fileObjectIds = input.fileObjectIds ?? [];
      if (fileObjectIds.length > settings.maxFilesPerSubmission) {
        throw new Error(
          `At most ${settings.maxFilesPerSubmission} file(s) per submission.`,
        );
      }
      if (fileObjectIds.length) {
        const objects = await tx
          .select({ id: storageObjects.id })
          .from(storageObjects)
          .where(
            and(
              inArray(storageObjects.id, fileObjectIds),
              eq(storageObjects.organizationId, sa.organizationId),
            ),
          );
        if (objects.length !== fileObjectIds.length) {
          throw new Error("One or more attached files could not be found.");
        }
      }

      const [submission] = await tx
        .insert(submissions)
        .values({
          organizationId: sa.organizationId,
          schoolId: sa.schoolId,
          studentAssignmentId: sa.id,
          versionNo,
          bodyText: input.bodyText ?? null,
          linkUrl: input.linkUrl ?? null,
          submittedByUserId: userId,
          submittedByRole: authorRole,
          isLate,
          submittedAt: now,
        })
        .returning();
      if (!submission) throw new Error("Failed to save the submission.");

      if (fileObjectIds.length) {
        await tx.insert(submissionFiles).values(
          fileObjectIds.map((objectId, i) => ({
            organizationId: sa.organizationId,
            schoolId: sa.schoolId,
            submissionId: submission.id,
            objectId,
            sortOrder: i,
          })),
        );
      }

      const [updatedSa] = await tx
        .update(studentAssignments)
        .set({
          status: "submitted",
          submittedAt: now,
          submissionCount: versionNo,
          isLate,
          completionSource: isParent ? "parent" : "student",
          statusChangedAt: now,
        })
        .where(eq(studentAssignments.id, sa.id))
        .returning();

      return { submission, studentAssignment: updatedSa ?? sa };
    });
  }

  /** The digital diary signature — one per guardian login, idempotent. */
  async portalAcknowledge(userId: string, studentIds: string[], studentAssignmentId: string) {
    const [sa] = await db
      .select({
        id: studentAssignments.id,
        organizationId: studentAssignments.organizationId,
        schoolId: studentAssignments.schoolId,
      })
      .from(studentAssignments)
      .innerJoin(
        studentEnrollments,
        eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(studentAssignments.id, studentAssignmentId),
          inArray(studentEnrollments.studentId, studentIds),
        ),
      );
    if (!sa) throw new Error("Student assignment not found.");

    const [row] = await db
      .insert(assignmentAcknowledgements)
      .values({
        organizationId: sa.organizationId,
        schoolId: sa.schoolId,
        studentAssignmentId: sa.id,
        guardianUserId: userId,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? { studentAssignmentId: sa.id, alreadyAcknowledged: true as const };
  }

  // -------------------------------------------------------------------------
  // Comments — class-wide Q&A (studentAssignmentId null) or the private
  // student↔teacher thread
  // -------------------------------------------------------------------------

  /** Staff post: class-wide or into any thread of the assignment. */
  async staffPostComment(scope: DataScope, userId: string, input: PostAssignmentCommentInput) {
    const schoolId = requireSchoolId(scope);
    const [assignment] = await db
      .select({ id: assignments.id, organizationId: assignments.organizationId })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, input.assignmentId),
          eq(assignments.schoolId, schoolId),
          scopeWhere(atSchoolLevel(scope), ASSIGNMENT_COLS),
        ),
      );
    if (!assignment) throw new Error("Assignment not found in this school.");

    if (input.studentAssignmentId) {
      const [sa] = await db
        .select({ id: studentAssignments.id })
        .from(studentAssignments)
        .where(
          and(
            eq(studentAssignments.id, input.studentAssignmentId),
            eq(studentAssignments.assignmentId, assignment.id),
          ),
        );
      if (!sa) {
        throw new Error("That student is not part of this assignment.");
      }
    }

    return this.insertComment(assignment.organizationId, schoolId, userId, input);
  }

  /** Family post: only into their OWN private thread. */
  async portalPostComment(userId: string, studentIds: string[], input: PostAssignmentCommentInput) {
    if (!input.studentAssignmentId) {
      throw new Error("Families post into their own thread with the teacher.");
    }
    const [sa] = await db
      .select({
        organizationId: studentAssignments.organizationId,
        schoolId: studentAssignments.schoolId,
        assignmentId: studentAssignments.assignmentId,
      })
      .from(studentAssignments)
      .innerJoin(
        studentEnrollments,
        eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
      )
      .where(
        and(
          eq(studentAssignments.id, input.studentAssignmentId),
          inArray(studentEnrollments.studentId, studentIds),
        ),
      );
    if (!sa) throw new Error("Student assignment not found.");

    return this.insertComment(sa.organizationId, sa.schoolId, userId, {
      assignmentId: sa.assignmentId,
      studentAssignmentId: input.studentAssignmentId,
      parentCommentId: input.parentCommentId,
      body: input.body,
    });
  }

  private async insertComment(
    organizationId: string,
    schoolId: string,
    userId: string,
    input: PostAssignmentCommentInput,
  ) {
    const [row] = await db
      .insert(assignmentComments)
      .values({
        organizationId,
        schoolId,
        assignmentId: input.assignmentId,
        studentAssignmentId: input.studentAssignmentId ?? null,
        parentCommentId: input.parentCommentId ?? null,
        authorUserId: userId,
        body: input.body,
      })
      .returning();
    if (!row) throw new Error("Failed to post the comment.");
    return row;
  }

  /**
   * The thread list with author names. Staff get a class-wide thread plus any
   * private one they ask for; families get the class-wide thread plus their
   * own. The staff flag is resolved by joining the staff register — a family
   * login has no staff row, a teacher does.
   */
  async listComments(args: {
    scopes?: DataScope[];
    studentIds?: string[];
    assignmentId: string;
    studentAssignmentId?: string | null;
  }) {
    const { scopes, studentIds, assignmentId } = args;

    // Family path: verify the assignment belongs to one of their children.
    if (studentIds) {
      const [owned] = await db
        .select({ id: assignments.id })
        .from(assignments)
        .innerJoin(assignmentTargets, eq(assignmentTargets.assignmentId, assignments.id))
        .innerJoin(sections, eq(assignmentTargets.sectionId, sections.id))
        .innerJoin(
          studentEnrollments,
          and(
            eq(studentEnrollments.sectionId, sections.id),
            inArray(studentEnrollments.studentId, studentIds),
          ),
        )
        .where(eq(assignments.id, assignmentId))
        .limit(1);
      if (!owned) throw new Error("Assignment not found.");
      // Families see the class-wide thread plus their own private threads.
      const ownSas = await db
        .select({ id: studentAssignments.id })
        .from(studentAssignments)
        .innerJoin(
          studentEnrollments,
          eq(studentAssignments.studentEnrollmentId, studentEnrollments.id),
        )
        .where(inArray(studentEnrollments.studentId, studentIds));
      const ownIds = ownSas.map((r) => r.id);
      return this.selectComments(assignmentId, {
        studentAssignmentId: args.studentAssignmentId
          ? ownIds.includes(args.studentAssignmentId)
            ? args.studentAssignmentId
            : undefined
          : undefined,
        ownThreadIds: ownIds,
      });
    }

    // Staff path: scope-checked.
    const [assignment] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          scopeWhere((scopes ?? []).map(atSchoolLevel), ASSIGNMENT_COLS),
        ),
      );
    if (!assignment) throw new Error("Assignment not found in this school.");
    return this.selectComments(assignmentId, {
      studentAssignmentId: args.studentAssignmentId ?? undefined,
      ownThreadIds: null,
    });
  }

  private async selectComments(
    assignmentId: string,
    opts: {
      studentAssignmentId?: string;
      ownThreadIds: string[] | null;
    },
  ) {
    // The staff flag resolves per comment author with an EXISTS on the staff
    // register — a family login has no staff row in the org, a teacher does.
    const rows = await db
      .select({
        id: assignmentComments.id,
        assignmentId: assignmentComments.assignmentId,
        studentAssignmentId: assignmentComments.studentAssignmentId,
        parentCommentId: assignmentComments.parentCommentId,
        authorUserId: assignmentComments.authorUserId,
        body: assignmentComments.body,
        isDeleted: assignmentComments.isDeleted,
        createdAt: assignmentComments.createdAt,
        editedAt: assignmentComments.editedAt,
        authorName: user.name,
        authorIsStaff: sql<boolean>`EXISTS (
          SELECT 1 FROM staff s
          WHERE s.user_id = ${assignmentComments.authorUserId}
            AND s.organization_id = ${assignmentComments.organizationId}
        )`,
      })
      .from(assignmentComments)
      .innerJoin(user, eq(assignmentComments.authorUserId, user.id))
      .where(
        and(
          eq(assignmentComments.assignmentId, assignmentId),
          // Class-wide, own threads (family), or the one asked for (staff).
          opts.ownThreadIds
            ? or(
                isNull(assignmentComments.studentAssignmentId),
                inArray(assignmentComments.studentAssignmentId, opts.ownThreadIds),
              )
            : opts.studentAssignmentId
              ? or(
                  isNull(assignmentComments.studentAssignmentId),
                  eq(assignmentComments.studentAssignmentId, opts.studentAssignmentId),
                )
              : undefined,
        ),
      )
      .orderBy(asc(assignmentComments.createdAt));
    return rows;
  }

  // -------------------------------------------------------------------------
  // B6 owner resolvers — the router's gate resolves the row's owning school
  // -------------------------------------------------------------------------

  async getAssignmentOwnerId(
    organizationId: string,
    assignmentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: assignments.schoolId })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, assignmentId),
          eq(assignments.organizationId, organizationId),
        ),
      );
    return row?.schoolId ?? null;
  }

  async getStudentAssignmentOwnerId(
    organizationId: string,
    studentAssignmentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: studentAssignments.schoolId })
      .from(studentAssignments)
      .where(
        and(
          eq(studentAssignments.id, studentAssignmentId),
          eq(studentAssignments.organizationId, organizationId),
        ),
      );
    return row?.schoolId ?? null;
  }
}

export const homeworkService = new HomeworkService();
