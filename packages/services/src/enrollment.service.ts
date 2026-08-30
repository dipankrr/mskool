import { atSchoolLevel } from "./academic.service";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  CreateEnrollmentInput,
  UpdateEnrollmentInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  enrollmentStatusEnum,
  sections,
  studentEnrollments,
  students,
} from "@repo/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

/**
 * STUDENT ENROLLMENTS — the year anchor. Phase 2 slice 5.
 *
 * Knows nothing about HTTP. The staff track takes a DataScope as a REQUIRED
 * argument and filters by it (hard rule 1); the portal track filters by owned
 * `studentId`s only (ADR-005 — guardians have no login, and a student's rows
 * are read through ownership, never through `can()`).
 *
 * **Hard rule 6 — never mutate year-over-year.** The unique index makes a
 * second (student, year) row unrepresentable; this service is the interface
 * half: creation derives the initial status, identity fields are absent from
 * the update contract, and the only sanctioned section change is the FIRST
 * assignment (`assignSection`, allowed while `sectionId` is still NULL).
 * Mid-year MOVES are transfers — they must land in `section_transfer_log`,
 * which does not exist yet, so this service simply has no way to re-point a
 * section that already has one. A silent re-point is unrepresentable rather
 * than forbidden.
 *
 * **Scope shape: NO widening, deliberately.** Unlike years/subjects/mappings,
 * an enrollment has a REAL class and section dimension — the academic
 * service's widening warning names this exact case. The scope columns carry
 * all four levels, so a section-scoped teacher sees exactly her section's
 * students and a class teacher hers, without any helper deciding otherwise.
 *
 * **Parent verification (the section-service pattern, fourth repetition).**
 * The FKs to student/year/class/section do not mention `school_id`, so
 * Postgres would happily link an enrollment in school A to a student in
 * school B. Every write re-reads each parent through the caller's scope
 * INSIDE the transaction. Scope columns are per-TABLE (the S2.4 lesson): a
 * column set borrowed from another table is a runtime "missing FROM-clause
 * entry" error that `tsc` cannot see.
 */

const ENROLLMENT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: studentEnrollments.organizationId,
  schoolId: studentEnrollments.schoolId,
  classId: studentEnrollments.classId,
  sectionId: studentEnrollments.sectionId,
} as const;

const STUDENT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: students.organizationId,
  schoolId: students.schoolId,
} as const;

const YEAR_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
} as const;

const CLASS_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: classes.organizationId,
  schoolId: classes.schoolId,
} as const;

const SECTION_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: sections.organizationId,
  schoolId: sections.schoolId,
} as const;

/**
 * The legal status transitions, derived from the schema's enum so a new state
 * cannot be added without this map answering for it. ADMITTED leaves only by
 * withdrawing (the first section assignment is `assignSection`, not a
 * transition); TRANSFERRED_OUT and WITHDRAWN are terminal — a student who
 * left does not resume; PASSED_OUT closes the year. Declared as a map so the
 * transition operation is a lookup, not a branch thicket, and so S5.4's tests
 * can pin the machine itself.
 */
export type EnrollmentStatus = (typeof enrollmentStatusEnum.enumValues)[number];

export const ENROLLMENT_TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> =
  {
    admitted: ["withdrawn"],
    section_assigned: ["active", "withdrawn"],
    active: ["transferred_out", "withdrawn", "passed_out"],
    transferred_out: [],
    withdrawn: [],
    passed_out: [],
  };

export class EnrollmentService {
  /**
   * Admits a student into a year (and optionally a section, in which case the
   * row is born `section_assigned` — the status is DERIVED from whether a
   * section was named, never client-supplied). Re-reads all four parents
   * through the caller's scope inside the transaction, and verifies the
   * section agrees with the year AND the class it is being enrolled under:
   * an enrollment claiming Class 6 while pointing at a Class 7 section would
   * pass every FK.
   *
   * A duplicate (student, year) is refused by the unique index, not
   * pre-checked (ADR-022) — the constraint holds by construction and
   * `translateErrors` words it.
   */
  async createEnrollment(scope: DataScope, input: CreateEnrollmentInput) {
    const schoolId = scope.schoolId;
    if (!schoolId) {
      throw new Error(
        "A school is required to enroll a student. The caller's scope must resolve to a school node.",
      );
    }
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(
          and(
            eq(students.id, input.studentId),
            eq(students.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
          ),
        );
      if (!student) {
        throw new Error(
          "Student not found in this school. A student cannot be enrolled across branches.",
        );
      }

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
          "Academic year not found in this school. A student cannot be enrolled into another school's year.",
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
          "Class not found in this school. A student cannot be enrolled into another school's class.",
        );
      }

      let section: { id: string; academicYearId: string; classId: string } | undefined;
      if (input.sectionId) {
        [section] = await tx
          .select({
            id: sections.id,
            academicYearId: sections.academicYearId,
            classId: sections.classId,
          })
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
            "Section not found in this school. A student cannot be enrolled into another school's section.",
          );
        }
        if (section.academicYearId !== input.academicYearId) {
          throw new Error(
            "The section's year does not match the enrollment's year. Enroll into the year the section belongs to.",
          );
        }
        if (section.classId !== input.classId) {
          throw new Error(
            "The section belongs to a different class than the enrollment. Enroll under the class the section teaches.",
          );
        }
      }

      const [enrollment] = await tx
        .insert(studentEnrollments)
        .values({
          ...input,
          organizationId,
          schoolId,
          // Derived, never supplied: a section named at admission means the
          // student already has somewhere to sit.
          enrollmentStatus: input.sectionId ? "section_assigned" : "admitted",
        })
        .returning();
      if (!enrollment) {
        throw new Error("Failed to create enrollment.");
      }
      return enrollment;
    });
  }

  /**
   * One year's roster, optionally narrowed to a class or a section. NO
   * widening: the table carries all four scope levels, so each caller sees
   * exactly the students their grant reaches — a section teacher her section,
   * a class teacher her class, a principal the whole year.
   */
  async listEnrollments(
    scopes: DataScope[],
    academicYearId: string,
    classId?: string,
    sectionId?: string,
  ) {
    return db
      .select()
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.academicYearId, academicYearId),
          classId ? eq(studentEnrollments.classId, classId) : undefined,
          sectionId ? eq(studentEnrollments.sectionId, sectionId) : undefined,
          scopeWhere(scopes, ENROLLMENT_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(studentEnrollments.rollNumber), asc(studentEnrollments.id));
  }

  /**
   * Reads one enrollment. Same no-widening filter as the list: an out-of-scope
   * id is null, and the router makes that the same NOT_FOUND as a made-up one.
   */
  async getEnrollmentById(scope: DataScope, enrollmentId: string) {
    const [enrollment] = await db
      .select()
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.id, enrollmentId),
          scopeWhere(scope, ENROLLMENT_SCOPE_COLUMNS),
        ),
      );

    return enrollment ?? null;
  }

  /**
   * Labels only (the contract omits everything else — see its docstring for
   * what is deliberately unpatchable and why).
   */
  async updateEnrollment(
    scope: DataScope,
    enrollmentId: string,
    input: UpdateEnrollmentInput,
  ) {
    const [enrollment] = await db
      .update(studentEnrollments)
      .set(input)
      .where(
        and(
          eq(studentEnrollments.id, enrollmentId),
          scopeWhere(scope, ENROLLMENT_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return enrollment ?? null;
  }

  /**
   * FIRST section assignment — allowed only while `sectionId` is still NULL.
   * Sets the section and moves the status to `section_assigned` in one
   * transaction, verifying the section through the caller's scope and against
   * the enrollment's own year and class (the same consistency checks creation
   * makes; an enrollment cannot be assigned into a section of another year or
   * class any more than it could be created that way).
   *
   * A row that ALREADY has a section is refused: changing it is a mid-year
   * TRANSFER, which must land in `section_transfer_log` before this service
   * will perform one. The refusal is the hard rule 6 spirit made operational —
   * the history-preserving path is unrepresentable to skip.
   */
  async assignSection(
    scope: DataScope,
    enrollmentId: string,
    input: { sectionId: string; rollNumber?: string },
  ) {
    const schoolId = scope.schoolId;
    if (!schoolId) {
      throw new Error(
        "A school is required to assign a section. The caller's scope must resolve to a school node.",
      );
    }
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      const [enrollment] = await tx
        .select()
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.id, enrollmentId),
            eq(studentEnrollments.schoolId, schoolId),
            scopeWhere(scope, ENROLLMENT_SCOPE_COLUMNS),
          ),
        );
      if (!enrollment) {
        throw new Error("Enrollment not found in this school.");
      }
      if (enrollment.sectionId) {
        throw new Error(
          "This enrollment already has a section. Moving a student mid-year is a transfer, and transfers are logged — that flow is not built yet.",
        );
      }
      if (
        enrollment.enrollmentStatus !== "admitted" &&
        enrollment.enrollmentStatus !== "section_assigned"
      ) {
        throw new Error(
          "Only an admitted enrollment can be assigned a section. This enrollment has left the admission flow.",
        );
      }

      const [section] = await tx
        .select({
          id: sections.id,
          academicYearId: sections.academicYearId,
          classId: sections.classId,
        })
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
          "Section not found in this school. A student cannot be assigned into another school's section.",
        );
      }
      if (section.academicYearId !== enrollment.academicYearId) {
        throw new Error(
          "The section's year does not match the enrollment's year. Assign a section from the year the student is enrolled in.",
        );
      }
      if (section.classId !== enrollment.classId) {
        throw new Error(
          "The section belongs to a different class than the enrollment. Assign a section of the class the student is enrolled under.",
        );
      }

      const [updated] = await tx
        .update(studentEnrollments)
        .set({
          sectionId: input.sectionId,
          ...(input.rollNumber !== undefined ? { rollNumber: input.rollNumber } : {}),
          enrollmentStatus: "section_assigned",
        })
        .where(
          and(
            eq(studentEnrollments.id, enrollmentId),
            // Re-checked in the UPDATE itself: two concurrent assignments race
            // on the NULL, and the loser must update nothing.
            isNull(studentEnrollments.sectionId),
          ),
        )
        .returning();
      if (!updated) {
        throw new Error(
          "This enrollment was assigned a section a moment ago. Refresh to see the current state.",
        );
      }
      return updated;
    });
  }

  /**
   * Moves an enrollment through the status machine (`ENROLLMENT_TRANSITIONS`).
   * The legal map is a lookup, so an illegal transition is refused in words
   * ("an enrollment that has left the admission flow cannot return"), not by
   * a status field anyone can set.
   */
  async transitionEnrollment(
    scope: DataScope,
    enrollmentId: string,
    to: EnrollmentStatus,
  ) {
    const [enrollment] = await db
      .select()
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.id, enrollmentId),
          scopeWhere(scope, ENROLLMENT_SCOPE_COLUMNS),
        ),
      );
    if (!enrollment) {
      throw new Error("Enrollment not found in this school.");
    }

    const legal = ENROLLMENT_TRANSITIONS[enrollment.enrollmentStatus] ?? [];
    if (!legal.includes(to)) {
      throw new Error(
        `An enrollment cannot move from ${enrollment.enrollmentStatus} to ${to}. Check the student's current state.`,
      );
    }

    const [updated] = await db
      .update(studentEnrollments)
      .set({ enrollmentStatus: to })
      .where(
        and(
          eq(studentEnrollments.id, enrollmentId),
          eq(studentEnrollments.enrollmentStatus, enrollment.enrollmentStatus),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error(
        "This enrollment changed state a moment ago. Refresh to see the current state.",
      );
    }
    return updated;
  }

  /**
   * The owning branch of an enrollment — the B6 adapter S5.3's byId gate
   * resolves with. The row's own schoolId column, org-filtered like every
   * owner lookup.
   */
  async getEnrollmentOwnerId(
    organizationId: string,
    enrollmentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: studentEnrollments.schoolId })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.id, enrollmentId),
          eq(studentEnrollments.organizationId, organizationId),
        ),
      );
    return row?.schoolId ?? null;
  }

  /**
   * The PORTAL track: every enrollment of the given students, filtered by the
   * owned-`studentId` list and NOTHING else. No DataScope — ownership is the
   * filter (ADR-005), and the router has already asserted the caller owns
   * every id on this list. A student's own enrollments are the one view of
   * this table that never passes through `can()`.
   */
  async listEnrollmentsForStudents(studentIds: string[]) {
    if (studentIds.length === 0) return [];

    return db
      .select()
      .from(studentEnrollments)
      .where(inArray(studentEnrollments.studentId, studentIds))
      .orderBy(asc(studentEnrollments.academicYearId));
  }
}
