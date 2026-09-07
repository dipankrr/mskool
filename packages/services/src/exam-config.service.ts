import {
  atSchoolLevel,
  requireSchoolId,
  yearVisibilityWhere,
} from "./academic.service";
import { examMarksService } from "./exam-marks.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import { fromHundredths, toHundredths } from "./exams-maths";import type {
  CreateExamInput,
  CreateGradingScaleInput,
  CreatePassCriteriaInput,
  CreateSubjectTypeInput,
  ExamTransitionInput,
  SaveExamComponentsInput,
  SaveExamSchedulesInput,
  UpdateExamInput,
  UpdatePassCriteriaInput,
  UpdateSubjectTypeInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classSubjectMappings,
  examClassPublication,
  examComponents,
  examSubjectSchedules,
  exams,
  gradingScaleBands,
  gradingScales,
  passCriteria,
  studentComponentResults,
  studentEnrollments,
  subjectTypes,
  termAssessments,
  terms,
} from "@repo/db/schema";
import { and, asc, eq, inArray, sql, type AnyColumn } from "drizzle-orm";

/**
 * EXAM CONFIG + BLUEPRINT + LIFECYCLE — B4a of Phase 5 (ADR-032).
 *
 * Knows nothing about HTTP. Every read takes a DataScope / DataScope[] as a
 * REQUIRED first argument and filters by it (hard rule 1); input types come
 * from `@repo/contracts`. School-level scope widening (`atSchoolLevel`) is
 * used for entities without a class dimension; schedules/components inherit
 * the exam's school and are filtered by their own denormalized columns.
 *
 * **Template locks (ADR-032 §4).** Blueprint facts (weightages, coverage,
 * components, pass criteria) must not change under a live exam: schedule and
 * component writes are refused once the exam's entry has opened (status
 * marks_entry+) or any component result exists; exam weight/count changes
 * are refused once component results exist. The subject-type flag/mode lock
 * is the same principle one level up.
 *
 * **Lifecycle.** The 7-state exam status moves ONLY through `transition`,
 * which consults the explicit transition map below — preconditions are
 * checked, illegal moves throw with the reason. Publication itself is NOT a
 * transition here: `exam-publication.service.ts` writes per-class
 * publication records and flips the exam to `published` when the last class
 * is done.
 *
 * **No delete, ever** (hard rule 2): subject types, scales, criteria and
 * exams deactivate via `isActive`/status; components are replaced by the
 * batch save while the blueprint is still editable.
 */

const EXAM_SCOPE_COLUMNS = {
  organizationId: exams.organizationId,
  schoolId: exams.schoolId,
} as const;

const SUBJECT_TYPE_SCOPE_COLUMNS = {
  organizationId: subjectTypes.organizationId,
  schoolId: subjectTypes.schoolId,
} as const;

const SCALE_SCOPE_COLUMNS = {
  organizationId: gradingScales.organizationId,
  schoolId: gradingScales.schoolId,
} as const;

const CRITERIA_SCOPE_COLUMNS = {
  organizationId: passCriteria.organizationId,
  schoolId: passCriteria.schoolId,
} as const;

const SCHEDULE_SCOPE_COLUMNS = {
  organizationId: examSubjectSchedules.organizationId,
  schoolId: examSubjectSchedules.schoolId,
} as const;

const COMPONENT_SCOPE_COLUMNS = {
  organizationId: examComponents.organizationId,
  schoolId: examComponents.schoolId,
} as const;

/** States at or past marks entry — the blueprint is frozen from here. */
const ENTRY_OPEN_STATES = ["marks_entry", "under_verification", "published", "locked"] as const;

export class ExamConfigService {
  // -------------------------------------------------------------------------
  // Subject types (ADR-032 §1)
  // -------------------------------------------------------------------------

  async listSubjectTypes(scopes: DataScope[]) {
    const rows = await db
      .select()
      .from(subjectTypes)
      .where(
        and(
          eq(subjectTypes.isActive, true),
          scopeWhere(scopes.map(atSchoolLevel), SUBJECT_TYPE_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(subjectTypes.sequence), asc(subjectTypes.name));
    if (rows.length === 0) return [];
    // Lock flags, batched: type ids with assessment data behind them —
    // component results AND term assessments (term_grade types never touch
    // the exam pipeline). Any history counts, deliberately: the flags feed
    // frozen snapshots, so repurposing a used type rewrites the past.
    const schoolIds = [...new Set(scopes.map((s) => s.schoolId).filter((id): id is string => id != null))];
    const orgIds = [...new Set(scopes.map((s) => s.organizationId))];
    const tenantFilter = (orgCol: AnyColumn, schoolCol: AnyColumn) =>
      schoolIds.length > 0
        ? inArray(schoolCol, schoolIds)
        : inArray(orgCol, orgIds);
    const viaExams = await db
      .selectDistinct({ typeId: classSubjectMappings.subjectTypeId })
      .from(studentComponentResults)
      .innerJoin(
        examSubjectSchedules,
        eq(studentComponentResults.scheduleId, examSubjectSchedules.id),
      )
      .innerJoin(
        classSubjectMappings,
        and(
          eq(classSubjectMappings.subjectId, examSubjectSchedules.subjectId),
          eq(classSubjectMappings.classId, examSubjectSchedules.classId),
        ),
      )
      .where(
        tenantFilter(
          studentComponentResults.organizationId,
          studentComponentResults.schoolId,
        ),
      );
    const viaTerms = await db
      .selectDistinct({ typeId: classSubjectMappings.subjectTypeId })
      .from(termAssessments)
      .innerJoin(
        classSubjectMappings,
        eq(termAssessments.mappingId, classSubjectMappings.id),
      )
      .where(
        tenantFilter(termAssessments.organizationId, termAssessments.schoolId),
      );
    const locked = new Set(
      [...viaExams, ...viaTerms].map((r) => r.typeId),
    );
    return rows.map((row) => ({
      ...row,
      hasAssessmentData: locked.has(row.id),
    }));
  }

  async getSubjectTypeById(scope: DataScope, id: string) {
    const [row] = await db
      .select()
      .from(subjectTypes)
      .where(
        and(
          eq(subjectTypes.id, id),
          scopeWhere(atSchoolLevel(scope), SUBJECT_TYPE_SCOPE_COLUMNS),
        ),
      );
    return row ?? null;
  }

  async createSubjectType(scope: DataScope, input: CreateSubjectTypeInput) {
    const schoolId = requireSchoolId(scope);
    return db
      .insert(subjectTypes)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  /**
   * Name/sequence are always editable; `countsTowardResult`, `isGradedOnly`
   * and `assessmentMode` lock the first time any (class, year, subject)
   * mapped to this type has assessment data — the ADR-032 §1 flag lock.
   */
  async updateSubjectType(scope: DataScope, id: string, input: UpdateSubjectTypeInput) {
    const schoolId = requireSchoolId(scope);
    const touchesFlags =
      input.countsTowardResult !== undefined ||
      input.isGradedOnly !== undefined ||
      input.assessmentMode !== undefined;

    return db.transaction(async (tx) => {
      if (touchesFlags) {
        const [used] = await tx
          .select({ id: studentComponentResults.id })
          .from(studentComponentResults)
          .innerJoin(
            examSubjectSchedules,
            eq(studentComponentResults.scheduleId, examSubjectSchedules.id),
          )
          .innerJoin(
            classSubjectMappings,
            and(
              eq(classSubjectMappings.subjectId, examSubjectSchedules.subjectId),
              eq(classSubjectMappings.classId, examSubjectSchedules.classId),
            ),
          )
          .where(
            and(
              eq(classSubjectMappings.subjectTypeId, id),
              eq(studentComponentResults.schoolId, schoolId),
            ),
          )
          .limit(1);
        // Term-grade types never touch the exam pipeline — their data
        // lives in term_assessments, checked separately.
        const [termUsed] = await tx
          .select({ id: termAssessments.id })
          .from(termAssessments)
          .innerJoin(
            classSubjectMappings,
            eq(termAssessments.mappingId, classSubjectMappings.id),
          )
          .where(
            and(
              eq(classSubjectMappings.subjectTypeId, id),
              eq(termAssessments.schoolId, schoolId),
            ),
          )
          .limit(1);
        if (used ?? termUsed) {
          throw new Error(
            "This subject type already has assessment data — its result flags and assessment mode are locked. Assign a different type to the class instead.",
          );
        }
      }

      const [row] = await tx
        .update(subjectTypes)
        .set(input)
        .where(
          and(
            eq(subjectTypes.id, id),
            eq(subjectTypes.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), SUBJECT_TYPE_SCOPE_COLUMNS),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  async deactivateSubjectType(scope: DataScope, id: string) {
    const [row] = await db
      .update(subjectTypes)
      .set({ isActive: false })
      .where(
        and(
          eq(subjectTypes.id, id),
          scopeWhere(atSchoolLevel(scope), SUBJECT_TYPE_SCOPE_COLUMNS),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * The CBSE-flavored starter set (ADR-032 §1): Main Subjects (marked,
   * counted), Co-curricular (graded-only, not counted), and Personality
   * (term-grade areas — Discipline/Life Skills class of subjects). Idempotent
   * per name: existing types are left alone.
   */
  async applyCbsePreset(scope: DataScope, userId?: string) {
    const schoolId = requireSchoolId(scope);
    const preset = [
      { name: "Main Subjects", countsTowardResult: true, isGradedOnly: false, assessmentMode: "exam" as const, sequence: 0 },
      { name: "Co-curricular", countsTowardResult: false, isGradedOnly: true, assessmentMode: "exam" as const, sequence: 1 },
      { name: "Personality", countsTowardResult: false, isGradedOnly: true, assessmentMode: "term_grade" as const, sequence: 2 },
    ];
    const created = [];
    for (const p of preset) {
      const [existing] = await db
        .select({ id: subjectTypes.id, isActive: subjectTypes.isActive })
        .from(subjectTypes)
        .where(and(eq(subjectTypes.schoolId, schoolId), eq(subjectTypes.name, p.name)));
      // A deactivated preset row reactivates instead of blocking silently.
      if (existing?.isActive) continue;
      if (existing) {
        const [revived] = await db
          .update(subjectTypes)
          .set({ ...p, isActive: true })
          .where(eq(subjectTypes.id, existing.id))
          .returning();
        if (revived) created.push(revived);
        continue;
      }
      created.push(
        await db
          .insert(subjectTypes)
          .values({ ...p, organizationId: scope.organizationId, schoolId, createdBy: userId ?? null })
          .returning(),
      );
    }
    return created.flat();
  }

  // -------------------------------------------------------------------------
  // Grading scales + bands (ADR-032 §5)
  // -------------------------------------------------------------------------

  async listGradingScales(scopes: DataScope[]) {
    const scales = await db
      .select()
      .from(gradingScales)
      .where(
        and(
          eq(gradingScales.isActive, true),
          scopeWhere(scopes.map(atSchoolLevel), SCALE_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(gradingScales.name));
    if (scales.length === 0) return [];

    const bands = await db
      .select()
      .from(gradingScaleBands)
      .where(
        inArray(
          gradingScaleBands.gradingScaleId,
          scales.map((s) => s.id),
        ),
      )
      .orderBy(asc(gradingScaleBands.sequenceNumber));

    return scales.map((s) => ({
      ...s,
      bands: bands.filter((b) => b.gradingScaleId === s.id),
    }));
  }

  /**
   * A scale is created WITH its bands, atomically. v1 refuses
   * `percentile_rank` (ADR-032 §5) and validates that the bands are
   * contiguous 0–100 with no gaps or overlaps — a percentage must land in
   * exactly one band, or grades become arbitrary.
   */
  async createGradingScale(scope: DataScope, input: CreateGradingScaleInput) {
    const schoolId = requireSchoolId(scope);
    const isDefault = input.isDefault ?? false;

    const sorted = input.bands
      // Exact integer-hundredths — binary float makes "90.10"*100 ≠ 9010
      // and valid decimal bands fail contiguity on dust.
      .map((b) => ({
        ...b,
        min: Number(toHundredths(b.minMarks)),
        max: Number(toHundredths(b.maxMarks)),
      }))
      .sort((a, b) => a.min - b.min);
    if (sorted[0]!.min !== 0) {
      throw new Error("Bands must start at 0.");
    }
    for (let i = 0; i < sorted.length; i++) {
      const band = sorted[i]!;
      if (i > 0 && band.min !== sorted[i - 1]!.max) {
        throw new Error("Bands must be contiguous — no gaps or overlaps between bands.");
      }
    }
    if (sorted[sorted.length - 1]!.max !== 10000) {
      throw new Error("Bands must end at 100.");
    }

    return db.transaction(async (tx) => {
      // The default swap lives INSIDE the insert transaction: a failure
      // after an outside unset used to leave the school with no default.
      if (isDefault) {
        await tx
          .update(gradingScales)
          .set({ isDefault: false })
          .where(and(eq(gradingScales.schoolId, schoolId), eq(gradingScales.isDefault, true)));
      }
      const [scale] = await tx
        .insert(gradingScales)
        .values({
          organizationId: scope.organizationId,
          schoolId,
          name: input.name,
          description: input.description,
          isDefault,
        })
        .returning();
      if (!scale) throw new Error("Failed to create grading scale.");

      await tx.insert(gradingScaleBands).values(
        input.bands.map((b, i) => ({
          organizationId: scope.organizationId,
          schoolId,
          gradingScaleId: scale.id,
          minMarks: b.minMarks,
          maxMarks: b.maxMarks,
          gradeLabel: b.gradeLabel,
          gradePoint: b.gradePoint ?? null,
          descriptor: b.descriptor ?? null,
          sequenceNumber: b.sequenceNumber ?? i,
        })),
      );
      return { ...scale, bands: await tx.select().from(gradingScaleBands).where(eq(gradingScaleBands.gradingScaleId, scale.id)) };
    });
  }

  /**
   * Makes a scale the school default — unset + set in one transaction, so
   * the school never sits with none (or two). Safe on locked scales: the
   * switch only steers FUTURE computes; frozen results keep grading as
   * they did.
   */
  async makeDefaultGradingScale(scope: DataScope, id: string) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [scale] = await tx
        .select()
        .from(gradingScales)
        .where(and(eq(gradingScales.id, id), eq(gradingScales.schoolId, schoolId)));
      if (!scale) return null;
      await tx
        .update(gradingScales)
        .set({ isDefault: false })
        .where(and(eq(gradingScales.schoolId, schoolId), eq(gradingScales.isDefault, true)));
      const [row] = await tx
        .update(gradingScales)
        .set({ isDefault: true })
        .where(eq(gradingScales.id, id))
        .returning();
      if (!row) return null;
      const bands = await tx
        .select()
        .from(gradingScaleBands)
        .where(eq(gradingScaleBands.gradingScaleId, id))
        .orderBy(asc(gradingScaleBands.sequenceNumber));
      return { ...row, bands };
    });
  }

  /**
   * A used (locked) scale changes NOTHING — name/description excepted —
   * because any result computed against it must grade the same way forever.
   */
  async updateGradingScale(
    scope: DataScope,
    id: string,
    input: { name?: string; description?: string; isActive?: boolean },
  ) {
    const [scale] = await db
      .select()
      .from(gradingScales)
      .where(
        and(
          eq(gradingScales.id, id),
          scopeWhere(atSchoolLevel(scope), SCALE_SCOPE_COLUMNS),
        ),
      );
    if (!scale) return null;
    if (scale.isLocked && (input.isActive === false)) {
      throw new Error("A locked scale cannot be deactivated — results reference it.");
    }
    const [row] = await db
      .update(gradingScales)
      .set(input)
      .where(eq(gradingScales.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Replaces ALL bands of an unlocked scale (the edit surface mirrors
   * create — contiguity is re-validated). Locked scales refuse.
   */
  async replaceGradingScaleBands(
    scope: DataScope,
    id: string,
    input: { bands: CreateGradingScaleInput["bands"] },
  ) {
    const schoolId = requireSchoolId(scope);
    const [scale] = await db
      .select()
      .from(gradingScales)
      .where(
        and(
          eq(gradingScales.id, id),
          scopeWhere(atSchoolLevel(scope), SCALE_SCOPE_COLUMNS),
        ),
      );
    if (!scale) return null;
    if (scale.isLocked) {
      throw new Error(
        "This grading scale is locked — results have been computed against it. Create a new scale instead.",
      );
    }
    const sorted = input.bands
      .map((b) => ({
        min: Number(toHundredths(b.minMarks)),
        max: Number(toHundredths(b.maxMarks)),
      }))
      .sort((a, b) => a.min - b.min);
    if (sorted[0]!.min !== 0 || sorted[sorted.length - 1]!.max !== 10000) {
      throw new Error("Bands must be contiguous and cover 0-100.");
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.min !== sorted[i - 1]!.max) {
        throw new Error("Bands must be contiguous — no gaps or overlaps between bands.");
      }
    }

    return db.transaction(async (tx) => {
      await tx.delete(gradingScaleBands).where(eq(gradingScaleBands.gradingScaleId, id));
      await tx.insert(gradingScaleBands).values(
        input.bands.map((b, i) => ({
          organizationId: scope.organizationId,
          schoolId,
          gradingScaleId: id,
          minMarks: b.minMarks,
          maxMarks: b.maxMarks,
          gradeLabel: b.gradeLabel,
          gradePoint: b.gradePoint ?? null,
          descriptor: b.descriptor ?? null,
          sequenceNumber: b.sequenceNumber ?? i,
        })),
      );
      const bands = await tx.select().from(gradingScaleBands).where(eq(gradingScaleBands.gradingScaleId, id));
      return { ...scale, bands };
    });
  }

  // -------------------------------------------------------------------------
  // Pass criteria (school default + class overrides, per year)
  // -------------------------------------------------------------------------

  async listPassCriteria(scopes: DataScope[], academicYearId: string) {
    return db
      .select()
      .from(passCriteria)
      .where(
        and(
          eq(passCriteria.academicYearId, academicYearId),
          scopeWhere(scopes.map(atSchoolLevel), CRITERIA_SCOPE_COLUMNS),
        ),
      );
  }

  async createPassCriteria(scope: DataScope, academicYearId: string, input: CreatePassCriteriaInput) {
    const schoolId = requireSchoolId(scope);
    return db
      .insert(passCriteria)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
        academicYearId,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async updatePassCriteria(scope: DataScope, id: string, input: UpdatePassCriteriaInput) {
    const [row] = await db
      .update(passCriteria)
      .set(input)
      .where(
        and(
          eq(passCriteria.id, id),
          scopeWhere(atSchoolLevel(scope), CRITERIA_SCOPE_COLUMNS),
        ),
      )
      .returning();
    return row ?? null;
  }

  // -------------------------------------------------------------------------
  // Exams + the lifecycle state machine
  // -------------------------------------------------------------------------

  async listExams(scopes: DataScope[], academicYearId?: string) {
    const rows = await db
      .select()
      .from(exams)
      .where(
        and(
          academicYearId ? eq(exams.academicYearId, academicYearId) : undefined,
          scopeWhere(scopes.map(atSchoolLevel), EXAM_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(exams.name));
    if (rows.length === 0) return [];
    // Hub progress: scheduled vs published classes per exam, batched.
    const ids = rows.map((e) => e.id);
    const scheduled = await db
      .selectDistinct({
        examId: examSubjectSchedules.examId,
        classId: examSubjectSchedules.classId,
      })
      .from(examSubjectSchedules)
      .where(inArray(examSubjectSchedules.examId, ids));
    const published = await db
      .selectDistinct({
        examId: examClassPublication.examId,
        classId: examClassPublication.classId,
      })
      .from(examClassPublication)
      .where(inArray(examClassPublication.examId, ids));
    const termRows = await db
      .select({ id: terms.id, name: terms.name })
      .from(terms)
      .where(
        inArray(
          terms.id,
          [...new Set(rows.map((e) => e.termId))],
        ),
      );
    const termById = new Map(termRows.map((t) => [t.id, t.name]));
    return rows.map((exam) => ({
      ...exam,
      termName: termById.get(exam.termId) ?? "",
      scheduledClasses: new Set(
        scheduled.filter((s) => s.examId === exam.id).map((s) => s.classId),
      ).size,
      publishedClasses: new Set(
        published.filter((p) => p.examId === exam.id).map((p) => p.classId),
      ).size,
    }));
  }

  /** One exam with its schedules and each schedule's components — the detail screen's shape. */
  async getExamById(scope: DataScope, examId: string) {
    const [exam] = await db
      .select()
      .from(exams)
      .where(
        and(
          eq(exams.id, examId),
          scopeWhere(atSchoolLevel(scope), EXAM_SCOPE_COLUMNS),
        ),
      );
    if (!exam) return null;

    const schedules = await db
      .select()
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.examId, examId))
      .orderBy(asc(examSubjectSchedules.examDate), asc(examSubjectSchedules.id));
    const components = schedules.length
      ? await db
          .select()
          .from(examComponents)
          .where(
            inArray(
              examComponents.scheduleId,
              schedules.map((s) => s.id),
            ),
          )
          .orderBy(asc(examComponents.sequenceNumber))
      : [];

    return {
      exam,
      schedules: schedules.map((s) => ({
        ...s,
        components: components.filter((c) => c.scheduleId === s.id),
      })),
    };
  }

  async createExam(scope: DataScope, input: CreateExamInput) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      // Parent verification (the section-service pattern): the term must
      // belong to this school AND to the named year — the FK alone would
      // accept another branch's term.
      const [term] = await tx
        .select({ id: terms.id, academicYearId: terms.academicYearId })
        .from(terms)
        .innerJoin(academicYears, eq(terms.academicYearId, academicYears.id))
        .where(
          and(
            eq(terms.id, input.termId),
            eq(terms.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), { organizationId: terms.organizationId, schoolId: terms.schoolId }),
            yearVisibilityWhere(true),
          ),
        );
      if (!term) {
        throw new Error("Term not found in this school and year.");
      }
      // The exam's year is DERIVED from its term — the client never supplies
      // it, so an exam can never claim a year its term does not belong to.
      // Mock and test papers run the full pipeline but never count toward
      // the term: the server forces the flag rather than trusting the
      // client, so a crafted request cannot smuggle a practice paper into
      // the term aggregate.
      const countsTowardTermResult =
        input.examType === "mock" || input.examType === "test"
          ? false
          : (input.countsTowardTermResult ?? true);
      const [exam] = await tx
        .insert(exams)
        .values({ ...input, organizationId: scope.organizationId, schoolId, academicYearId: term.academicYearId, countsTowardTermResult })
        .returning();
      return exam ?? null;
    });
  }

  async updateExam(scope: DataScope, examId: string, input: UpdateExamInput) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)));
      if (!exam) return null;

      // Weight/count changes move every future result's denominator — once
      // marks exist, they are frozen (the revision window is the correction
      // path, not this). The lock keys on the RESULTING counting state, not
      // the stored one: flipping a non-counting exam to counting with a new
      // weight restates history exactly as badly as editing a counting one.
      const willCount =
        input.countsTowardTermResult ?? exam.countsTowardTermResult;
      if (
        (input.weightageInTerm !== undefined ||
          input.countsTowardTermResult !== undefined) &&
        willCount
      ) {
        const [anyResult] = await tx
          .select({ id: studentComponentResults.id })
          .from(studentComponentResults)
          .where(eq(studentComponentResults.examId, examId))
          .limit(1);
        if (anyResult) {
          throw new Error(
            "This exam already has marks — its weight in the term can no longer change.",
          );
        }
      }

      const [row] = await tx
        .update(exams)
        .set(input)
        .where(and(eq(exams.id, examId), eq(exams.schoolId, schoolId)))
        .returning();
      return row ?? null;
    });
  }

  /**
   * THE STATE MACHINE. Legal transitions and their preconditions; anything
   * else throws with the reason. `published` and `locked` are reached
   * through the publication service (per-class records), not this map —
   * attempting them here is refused with that explanation.
   */
  private static readonly TRANSITIONS: Record<string, string[]> = {
    draft: ["scheduled"],
    scheduled: ["ongoing", "draft"],
    ongoing: ["marks_entry"],
    marks_entry: ["under_verification"],
    under_verification: ["marks_entry"], // back to entry = refused corrections found
    published: ["locked"],
    locked: [],
  };

  async transition(scope: DataScope, input: ExamTransitionInput) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, input.id), eq(exams.schoolId, schoolId)));
      if (!exam) return null;

      const allowed = ExamConfigService.TRANSITIONS[exam.status] ?? [];
      if (!allowed.includes(input.target)) {
        throw new Error(
          `Cannot move an exam from ${exam.status} to ${input.target}.`,
        );
      }

      if (input.target === "scheduled") {
        const schedules = await tx
          .select({ id: examSubjectSchedules.id })
          .from(examSubjectSchedules)
          .where(eq(examSubjectSchedules.examId, exam.id));
        if (schedules.length === 0) {
          throw new Error("Schedule at least one subject before scheduling the exam.");
        }
        const gaps = await this.findCoverageGaps(tx, exam.id, exam.academicYearId);
        if (gaps.length > 0) {
          throw new Error(
            `Coverage incomplete: ${gaps.length} counted subject(s) of some class(es) are missing from this exam. Every counted subject must be scheduled.`,
          );
        }
        // Counting exams of a term sum to exactly 100 — misconfiguration
        // fails loudly at blueprint time, never hides inside the term
        // maths' renormalization. Non-counting exams (mocks, tests) skip.
        if (exam.countsTowardTermResult) {
          const termExams = await tx
            .select({
              weightageInTerm: exams.weightageInTerm,
              countsTowardTermResult: exams.countsTowardTermResult,
            })
            .from(exams)
            .where(
              and(
                eq(exams.termId, exam.termId),
                eq(exams.schoolId, schoolId),
                eq(exams.countsTowardTermResult, true),
              ),
            );
          const sum = termExams.reduce(
            (acc, e) => acc + toHundredths(e.weightageInTerm),
            0n,
          );
          if (sum !== 10000n) {
            throw new Error(
              `Counting exams of this term weigh ${fromHundredths(sum)} — they must sum to exactly 100. Adjust the weightages first.`,
            );
          }
        }
      }

      if (input.target === "under_verification") {
        const gaps = await this.findEntryGaps(tx, exam.id, exam.academicYearId);
        if (gaps > 0) {
          throw new Error(
            `${gaps} mark entries are still missing — every student must have every component entered (or marked absent) before verification.`,
          );
        }
      }

      const [row] = await tx
        .update(exams)
        .set({ status: input.target })
        .where(eq(exams.id, exam.id))
        .returning();
      // ADR-032 §9: eligibility recomputes on state transitions. marks_entry
      // is the moment the advisory must be fresh — the readiness screen and
      // the below-bar list read it from here on. Same transaction: a failed
      // recompute rolls the transition back, never a moved exam with stale
      // advice.
      if (input.target === "marks_entry") {
        await examMarksService.recomputeCohortEligibility(
          tx,
          exam.id,
          exam.termId,
          exam.academicYearId,
          schoolId,
          scope.organizationId,
        );
      }
      return row ?? null;
    });
  }

  /**
   * Coverage gaps: counted subjects mapped to a class that has schedules in
   * this exam, but no schedule row of its own (strict validation, ADR-032
   * §4 — relaxable later only additively).
   */
  private async findCoverageGaps(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    examId: string,
    academicYearId: string,
  ): Promise<{ classId: string; subjectId: string }[]> {
    const scheduled = await tx
      .select({
        classId: examSubjectSchedules.classId,
        subjectId: examSubjectSchedules.subjectId,
      })
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.examId, examId));
    if (scheduled.length === 0) return [];

    const classIds = [...new Set(scheduled.map((s) => s.classId))];
    const mappings = await tx
      .select({
        classId: classSubjectMappings.classId,
        subjectId: classSubjectMappings.subjectId,
        counts: subjectTypes.countsTowardResult,
        mode: subjectTypes.assessmentMode,
      })
      .from(classSubjectMappings)
      .innerJoin(subjectTypes, eq(classSubjectMappings.subjectTypeId, subjectTypes.id))
      .where(
        and(
          eq(classSubjectMappings.academicYearId, academicYearId),
          inArray(classSubjectMappings.classId, classIds),
        ),
      );

    const scheduledKeys = new Set(scheduled.map((s) => `${s.classId}:${s.subjectId}`));
    return mappings
      .filter(
        (m) =>
          m.counts &&
          m.mode === "exam" &&
          !scheduledKeys.has(`${m.classId}:${m.subjectId}`),
      )
      .map((m) => ({ classId: m.classId, subjectId: m.subjectId }));
  }

  /**
   * Entry gaps: cohort students (active enrollments of each schedule's class
   * — section NULL means all sections of the class) missing a component
   * result row, plus rows still in draft.
   */
  private async findEntryGaps(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    examId: string,
    academicYearId: string,
  ): Promise<number> {
    const schedules = await tx
      .select({
        id: examSubjectSchedules.id,
        classId: examSubjectSchedules.classId,
        sectionId: examSubjectSchedules.sectionId,
      })
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.examId, examId));
    if (schedules.length === 0) return 0;

    let gaps = 0;
    for (const schedule of schedules) {
      const cohortWhere = schedule.sectionId
        ? eq(studentEnrollments.sectionId, schedule.sectionId)
        : eq(studentEnrollments.classId, schedule.classId);
      const [cohort] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.classId, schedule.classId),
            eq(studentEnrollments.academicYearId, academicYearId),
            inArray(studentEnrollments.enrollmentStatus, ["active", "admitted", "section_assigned"]),
            cohortWhere,
          ),
        );
      const [entered] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(studentComponentResults)
        .where(
          and(
            eq(studentComponentResults.scheduleId, schedule.id),
            sql`${studentComponentResults.resultStatus} <> 'draft'`,
          ),
        );
      const [components] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(examComponents)
        .where(eq(examComponents.scheduleId, schedule.id));
      const componentCount = components?.count ?? 0;
      // ROWS, not distinct students: one entered cell per student is still
      // a half-empty grid. A partially-entered class must not verify.
      const expected = (cohort?.count ?? 0) * componentCount;
      const actual = entered?.count ?? 0;
      gaps += Math.max(0, expected - actual);
    }
    return gaps;
  }

  // -------------------------------------------------------------------------
  // Schedules + components (batch saves; the screens edit grids)
  // -------------------------------------------------------------------------

  async listSchedules(scopes: DataScope[], examId: string) {
    return db
      .select()
      .from(examSubjectSchedules)
      .where(
        and(
          eq(examSubjectSchedules.examId, examId),
          scopeWhere(scopes.map(atSchoolLevel), SCHEDULE_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(examSubjectSchedules.examDate));
  }

  /**
   * Replaces a class's schedules for the exam. Refused once entry is open or
   * any component result exists (the template lock). Coverage is NOT
   * re-validated here (partial saves are legitimate while drafting); the
   * `scheduled` transition validates the whole exam.
   */
  async saveSchedules(scope: DataScope, input: SaveExamSchedulesInput) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [exam] = await tx
        .select()
        .from(exams)
        .where(and(eq(exams.id, input.id), eq(exams.schoolId, schoolId)));
      if (!exam) return null;
      if ((ENTRY_OPEN_STATES as readonly string[]).includes(exam.status)) {
        throw new Error("Marks entry has opened — the exam blueprint is frozen.");
      }

      const classIds = [...new Set(input.schedules.map((s) => s.classId))];
      const existing = await tx
        .select({ id: examSubjectSchedules.id })
        .from(examSubjectSchedules)
        .where(
          and(
            eq(examSubjectSchedules.examId, input.id),
            inArray(examSubjectSchedules.classId, classIds),
          ),
        );
      const [anyResult] = existing.length
        ? await tx
            .select({ id: studentComponentResults.id })
            .from(studentComponentResults)
            .where(
              inArray(
                studentComponentResults.scheduleId,
                existing.map((s) => s.id),
              ),
            )
            .limit(1)
        : [];
      if (anyResult) {
        throw new Error("Marks exist for this exam's schedules — they can no longer be restructured.");
      }

      if (existing.length > 0) {
        // Components first: they FK to their schedules with no cascade,
        // and deleting schedules under them 500s on the FK. Safe here —
        // the results check above proved no marks reference them.
        await tx
          .delete(examComponents)
          .where(
            inArray(
              examComponents.scheduleId,
              existing.map((s) => s.id),
            ),
          );
        await tx
          .delete(examSubjectSchedules)
          .where(
            inArray(
              examSubjectSchedules.id,
              existing.map((s) => s.id),
            ),
          );
      }
      if (input.schedules.length > 0) {
        await tx.insert(examSubjectSchedules).values(
          input.schedules.map((s) => ({
            ...s,
            organizationId: scope.organizationId,
            schoolId,
            examId: input.id,
          })),
        );
      }
      return db
        .select()
        .from(examSubjectSchedules)
        .where(eq(examSubjectSchedules.examId, input.id));
    });
  }

  async listComponents(scopes: DataScope[], scheduleId: string) {
    return db
      .select()
      .from(examComponents)
      .where(
        and(
          eq(examComponents.scheduleId, scheduleId),
          scopeWhere(scopes.map(atSchoolLevel), COMPONENT_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(examComponents.sequenceNumber));
  }

  /**
   * Replaces a schedule's components. Weightages must sum to exactly 100 —
   * a cross-row rule the service owns (a CHECK cannot span rows). Refused
   * once the schedule is locked or any component result exists.
   */
  async saveComponents(scope: DataScope, input: SaveExamComponentsInput) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [schedule] = await tx
        .select()
        .from(examSubjectSchedules)
        .where(
          and(eq(examSubjectSchedules.id, input.id), eq(examSubjectSchedules.schoolId, schoolId)),
        );
      if (!schedule) return null;
      if (schedule.isLocked) {
        throw new Error("This schedule is locked — marks entry has begun.");
      }

      const weightSum = input.components.reduce(
        (acc, c) => acc + toHundredths(c.weightagePercentage),
        0n,
      );
      if (weightSum !== 10000n) {
        const shown = input.components.reduce(
          (acc, c) => acc + Number(c.weightagePercentage),
          0,
        );
        throw new Error(
          `Component weightages must sum to exactly 100 (currently ${shown}).`,
        );
      }

      const [anyResult] = await tx
        .select({ id: studentComponentResults.id })
        .from(studentComponentResults)
        .where(eq(studentComponentResults.scheduleId, input.id))
        .limit(1);
      if (anyResult) {
        throw new Error("Marks exist against these components — they can no longer be restructured.");
      }

      await tx.delete(examComponents).where(eq(examComponents.scheduleId, input.id));
      await tx.insert(examComponents).values(
        input.components.map((c, i) => ({
          ...c,
          organizationId: scope.organizationId,
          schoolId,
          scheduleId: input.id,
          sequenceNumber: c.sequenceNumber ?? i,
        })),
      );
      return db
        .select()
        .from(examComponents)
        .where(eq(examComponents.scheduleId, input.id))
        .orderBy(asc(examComponents.sequenceNumber));
    });
  }

  // -------------------------------------------------------------------------
  // Owner resolvers — the B6/B5 single-resource adapters (getTermOwnerId shape)
  // -------------------------------------------------------------------------

  async getExamOwnerId(organizationId: string, examId: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: exams.schoolId })
      .from(exams)
      .where(and(eq(exams.id, examId), eq(exams.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }

  async getSubjectTypeOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: subjectTypes.schoolId })
      .from(subjectTypes)
      .where(and(eq(subjectTypes.id, id), eq(subjectTypes.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }

  async getGradingScaleOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: gradingScales.schoolId })
      .from(gradingScales)
      .where(and(eq(gradingScales.id, id), eq(gradingScales.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }

  async getScheduleOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: examSubjectSchedules.schoolId })
      .from(examSubjectSchedules)
      .where(and(eq(examSubjectSchedules.id, id), eq(examSubjectSchedules.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }

  async getComponentOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: examComponents.schoolId })
      .from(examComponents)
      .where(and(eq(examComponents.id, id), eq(examComponents.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }
}

export const examConfigService = new ExamConfigService();
