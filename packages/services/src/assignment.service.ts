import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  CreateClassSubjectMappingInput,
  CreateSectionTeacherAssignmentInput,
  UpdateClassSubjectMappingInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classSubjectMappings,
  classes,
  sectionTeacherAssignments,
  sections,
  subjects,
} from "@repo/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

/**
 * THE TEACHING-ASSIGNMENT LAYER — Phase 2 slice 2.
 *
 * Two tables, one workflow: map subjects onto classes for a year
 * (`class_subject_mappings`), then staff the sections
 * (`section_teacher_assignments`). Knows nothing about HTTP; every read takes
 * a DataScope as a REQUIRED argument and filters by it (hard rule 1).
 *
 * Scope shape: both tables are SCHOOL-level — a mapping is (year, class,
 * subject), all of which are school-scoped and none of which is a scope node,
 * so the scope widens with `atSchoolLevel` (same entity-shape reasoning as
 * `academic_years`, documented there). A section-scoped teacher answering
 * "which subjects does my class take?" is asking about the class's set, not a
 * wider one.
 *
 * **Parent verification (the section-service pattern, now repeated here).** A
 * foreign key proves a parent EXISTS, not that it belongs to your school. A
 * School-B class id pointed at a School-A subject id would pass both FKs and
 * create a cross-tenant mapping invisible to every scope. So every write
 * re-reads its parents through the caller's scope INSIDE the transaction —
 * the same shape as `createSection` in academic.service.ts — and the schoolId
 * comes from the caller's own school node, never the input.
 *
 * **Append-on-change.** Ending an assignment closes the open row
 * (`effectiveTo` = today) and inserts the successor — the one sanctioned
 * UPDATE, owned by `endAssignment`. The date-range model means "who taught
 * this in September" is answerable without ever touching the past.
 */

// ---------------------------------------------------------------------------
// Scope helper
// ---------------------------------------------------------------------------

/** School-level tables: widen a section/class scope to its school. */
function atSchoolLevel(scope: DataScope): DataScope {
  return { ...scope, classId: null, sectionId: null };
}

const MAPPING_SCOPE_COLUMNS = {
  organizationId: classSubjectMappings.organizationId,
  schoolId: classSubjectMappings.schoolId,
} as const;

const ASSIGNMENT_SCOPE_COLUMNS = {
  organizationId: sectionTeacherAssignments.organizationId,
  schoolId: sectionTeacherAssignments.schoolId,
} as const;

// The parent re-reads filter the PARENT's own table, so each needs its own
// column set — scopeWhere compiles the columns it is handed into that query's
// SQL, and a column from the wrong table is a "missing FROM-clause entry"
// error at runtime, invisible to the type checker. (Caught live by the first
// integration run of the create path.)
const YEAR_SCOPE_COLUMNS = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
} as const;

const CLASS_SCOPE_COLUMNS = {
  organizationId: classes.organizationId,
  schoolId: classes.schoolId,
} as const;

const SUBJECT_SCOPE_COLUMNS = {
  organizationId: subjects.organizationId,
  schoolId: subjects.schoolId,
} as const;

const SECTION_SCOPE_COLUMNS = {
  organizationId: sections.organizationId,
  schoolId: sections.schoolId,
} as const;

const M = classSubjectMappings;
const STA = sectionTeacherAssignments;

export class AssignmentService {
  // -------------------------------------------------------------------------
  // Class-subject mappings
  // -------------------------------------------------------------------------

  /** Creates a mapping, verifying the year/class/subject all belong to the caller's school. */
  async createClassSubjectMapping(
    scope: DataScope,
    input: CreateClassSubjectMappingInput,
  ) {
    const schoolId = atSchoolLevel(scope).schoolId;
    if (!schoolId) {
      throw new Error(
        "A school is required to map a subject onto a class. The caller's scope must resolve to a school node.",
      );
    }
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      // Re-read every parent through the caller's scope inside the transaction.
      const [year] = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(
          and(
            eq(academicYears.id, input.academicYearId),
            eq(academicYears.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), YEAR_SCOPE_COLUMNS),
          ),
        );
      if (!year) {
        throw new Error(
          "Academic year not found in this school. A mapping cannot reference another school's year.",
        );
      }

      const [cls] = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(
          and(
            eq(classes.id, input.classId),
            eq(classes.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), CLASS_SCOPE_COLUMNS),
          ),
        );
      if (!cls) {
        throw new Error(
          "Class not found in this school. A mapping cannot reference another school's class.",
        );
      }

      const [subject] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(
          and(
            eq(subjects.id, input.subjectId),
            eq(subjects.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), SUBJECT_SCOPE_COLUMNS),
          ),
        );
      if (!subject) {
        throw new Error(
          "Subject not found in this school. A mapping cannot reference another school's subject.",
        );
      }

      const [mapping] = await tx
        .insert(classSubjectMappings)
        .values({ ...input, organizationId, schoolId })
        .returning();
      if (!mapping) {
        throw new Error("Failed to create class-subject mapping.");
      }
      return mapping;
    });
  }

  /** The open mappings for a class in a year, ordered for the report card. */
  async listClassSubjectMappings(
    scopes: DataScope[],
    academicYearId: string,
    classId: string,
  ) {
    return db
      .select()
      .from(classSubjectMappings)
      .where(
        and(
          eq(classSubjectMappings.academicYearId, academicYearId),
          eq(classSubjectMappings.classId, classId),
          scopeWhere(scopes.map(atSchoolLevel), MAPPING_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(classSubjectMappings.sequenceNumber));
  }

  async getClassSubjectMappingById(scope: DataScope, mappingId: string) {
    const [mapping] = await db
      .select()
      .from(classSubjectMappings)
      .where(
        and(
          eq(classSubjectMappings.id, mappingId),
          scopeWhere(atSchoolLevel(scope), MAPPING_SCOPE_COLUMNS),
        ),
      );
    return mapping ?? null;
  }

  /** `isElective`/`sequenceNumber` are patchable; the (year, class, subject) triple is not (contract). */
  async updateClassSubjectMapping(
    scope: DataScope,
    mappingId: string,
    input: UpdateClassSubjectMappingInput,
  ) {
    const [mapping] = await db
      .update(classSubjectMappings)
      .set(input)
      .where(
        and(
          eq(classSubjectMappings.id, mappingId),
          scopeWhere(atSchoolLevel(scope), MAPPING_SCOPE_COLUMNS),
        ),
      )
      .returning();
    return mapping ?? null;
  }

  /**
   * The owning branch of a mapping (B6 adapter) — its schoolId column. No
   * DELETE, ever (hard rule 2) and no fake "removal": a wrong mapping is fixed
   * by ending its year's structure, not by mutating this row into meaning
   * something else — `isElective` is a real flag, not a tombstone.
   */
  async getClassSubjectMappingOwnerId(
    organizationId: string,
    mappingId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: classSubjectMappings.schoolId })
      .from(classSubjectMappings)
      .where(
        and(
          eq(classSubjectMappings.id, mappingId),
          eq(classSubjectMappings.organizationId, organizationId),
        ),
      );
    return row?.schoolId ?? null;
  }

// -------------------------------------------------------------------------
  // Section-teacher assignments
  // -------------------------------------------------------------------------

  /**
   * Assigns a teacher to a section — the delivery-layer insert. Verifies the
   * section (and, for a subject_teacher, the subject) belongs to the caller's
   * school inside the transaction, like `createClassSubjectMapping`. The
   * subject/role pairing is the database's CHECK, not re-checked here.
   */
  async createSectionTeacherAssignment(
    scope: DataScope,
    input: CreateSectionTeacherAssignmentInput,
  ) {
    return db.transaction((tx) => this.insertAssignment(tx, scope, input));
  }

  /**
   * The transactional core both callers share. Takes the OPEN transaction
   * rather than opening its own: a nested `db.transaction` on postgres.js is
   * an INDEPENDENT transaction on another connection, so if `endAssignment`
   * inserted its successor that way, the successor could commit while the
   * close rolls back — two open rows for one seat, and "atomically" a lie.
   */
  private async insertAssignment(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    scope: DataScope,
    input: CreateSectionTeacherAssignmentInput,
  ) {
    const schoolId = atSchoolLevel(scope).schoolId;
    if (!schoolId) {
      throw new Error(
        "A school is required to assign a teacher. The caller's scope must resolve to a school node.",
      );
    }
    const organizationId = scope.organizationId;

    const [section] = await tx
      .select({ id: sections.id, academicYearId: sections.academicYearId })
      .from(sections)
      .where(
        and(
          eq(sections.id, input.sectionId),
          eq(sections.schoolId, schoolId),
          scopeWhere(atSchoolLevel(scope), SECTION_SCOPE_COLUMNS),
        ),
      );
    if (!section) {
      throw new Error(
        "Section not found in this school. A teacher cannot be assigned to another school's section.",
      );
    }

    // The year denormalised alongside the section's own — verify the input
    // does not disagree with the section it points at.
    if (input.academicYearId && input.academicYearId !== section.academicYearId) {
      throw new Error(
        "Academic year does not match the section's year. An assignment's year must equal its section's.",
      );
    }

    if (input.subjectId) {
      const [subject] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(
          and(
            eq(subjects.id, input.subjectId),
            eq(subjects.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), SUBJECT_SCOPE_COLUMNS),
          ),
        );
      if (!subject) {
        throw new Error(
          "Subject not found in this school. A subject_teacher cannot be assigned another school's subject.",
        );
      }
    }

    const [assignment] = await tx
      .insert(sectionTeacherAssignments)
      .values({ ...input, organizationId, schoolId })
      .returning();
    if (!assignment) {
      throw new Error("Failed to create section-teacher assignment.");
    }
    return assignment;
  }

  /** The open assignments for a section — "who teaches here now". */
  async listSectionTeacherAssignments(scopes: DataScope[], sectionId: string) {
    return db
      .select()
      .from(sectionTeacherAssignments)
      .where(
        and(
          eq(sectionTeacherAssignments.sectionId, sectionId),
          scopeWhere(scopes.map(atSchoolLevel), ASSIGNMENT_SCOPE_COLUMNS),
          isNull(sectionTeacherAssignments.effectiveTo),
        ),
      )
      .orderBy(asc(sectionTeacherAssignments.createdAt));
  }

  async getSectionTeacherAssignmentById(scope: DataScope, assignmentId: string) {
    const [assignment] = await db
      .select()
      .from(sectionTeacherAssignments)
      .where(
        and(
          eq(sectionTeacherAssignments.id, assignmentId),
          scopeWhere(atSchoolLevel(scope), ASSIGNMENT_SCOPE_COLUMNS),
        ),
      );
    return assignment ?? null;
  }

/**
   * The one sanctioned UPDATE — append-on-change. Closes the currently-OPEN
   * assignment (`effectiveTo` = today) and, if a successor is supplied, inserts
   * it. Both happen atomically so the section is never left unmanned mid-swap.
   */
  async endAssignment(
    scope: DataScope,
    assignmentId: string,
    successor?: {
      sectionId: string;
      academicYearId: string;
      userId: string;
      role: "class_teacher" | "subject_teacher" | "co_teacher" | "activity_teacher";
      subjectId?: string | null;
    },
  ) {
    const schoolId = atSchoolLevel(scope).schoolId;
    if (!schoolId) {
      throw new Error("A school is required to end an assignment.");
    }
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sectionTeacherAssignments)
        .where(
          and(
            eq(sectionTeacherAssignments.id, assignmentId),
            eq(sectionTeacherAssignments.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), ASSIGNMENT_SCOPE_COLUMNS),
          ),
        );
      if (!existing) {
        throw new Error("Assignment not found in this school.");
      }

      // UTC date — the same clock as effective_from's CURRENT_DATE default,
      // so a row's open and close agree on what "today" is.
      const closed = await tx
        .update(sectionTeacherAssignments)
        .set({ effectiveTo: new Date().toISOString().slice(0, 10) })
        .where(
          and(
            eq(sectionTeacherAssignments.id, assignmentId),
            isNull(sectionTeacherAssignments.effectiveTo),
          ),
        )
        .returning();
      if (!closed[0]) {
        throw new Error("Assignment is not currently open; nothing to end.");
      }

      let created: (typeof sectionTeacherAssignments.$inferSelect) | undefined;
      if (successor) {
        // Same transaction, same connection — see insertAssignment's comment.
        created = await this.insertAssignment(tx, scope, successor);
      }

      return { closed: closed[0], successor: created ?? null };
    });
  }

  /** The owning branch of an assignment (B6 adapter) — schoolId column. */
  async getSectionTeacherAssignmentOwnerId(
    organizationId: string,
    assignmentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: sectionTeacherAssignments.schoolId })
      .from(sectionTeacherAssignments)
      .where(
        and(
          eq(sectionTeacherAssignments.id, assignmentId),
          eq(sectionTeacherAssignments.organizationId, organizationId),
        ),
      );
    return row?.schoolId ?? null;
  }

  /**
   * ADR-029's fact: does THIS user hold an OPEN subject_teacher assignment on
   * THIS (section, subject)? Org-filtered, so a foreign-org id and a
   * nonexistent one are the same false.
   *
   * Authorization-NEUTRAL by design (the B6 adapter shape): it answers "is
   * the fact so", never "may you act". The builder composes it AFTER the
   * permission gate and owns the refusal's wording — NOT_FOUND, generic, so
   * an unassigned pair is indistinguishable from a nonexistent one and
   * probing (section, subject) combinations reveals nothing. The role filter
   * is not paranoia: `sta_subject_matches_role` binds subject_id to
   * subject_teacher rows, but this query IS the authorization fact and states
   * its own terms rather than borrowing the schema's.
   *
   * Deliberately uncached (ADR-029): the auth cache caches ROLE grants
   * because they are slow-changing; assignment facts are timetable data that
   * changes mid-term — a teacher swapped periods must lose access
   * immediately, not in five minutes. One indexed query per write
   * (`section_teacher_assignments_active_idx` helps only the section-first
   * lookups; this one filters all sides) is the price of immediacy.
   */
  async hasSubjectAssignment(
    organizationId: string,
    userId: string,
    sectionId: string,
    subjectId: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: sectionTeacherAssignments.id })
      .from(sectionTeacherAssignments)
      .where(
        and(
          eq(sectionTeacherAssignments.organizationId, organizationId),
          eq(sectionTeacherAssignments.userId, userId),
          eq(sectionTeacherAssignments.sectionId, sectionId),
          eq(sectionTeacherAssignments.subjectId, subjectId),
          eq(sectionTeacherAssignments.role, "subject_teacher"),
          isNull(sectionTeacherAssignments.effectiveTo),
        ),
      );

    return row !== undefined;
  }
}

export const assignmentService = new AssignmentService();