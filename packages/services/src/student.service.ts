import {
  atSchoolLevel,
  requireSchoolId,
} from "./academic.service";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  CreateStudentInput,
  UpdateStudentInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import { students } from "@repo/db/schema";
import { and, asc, eq, ilike, or } from "drizzle-orm";

/**
 * STUDENTS — the identity registry. Written once at admission; a student's
 * class, section, and roll number live on `student_enrollments` (the year
 * anchor), never here. Phase 2's admission slice gives this service its CRUD;
 * it entered life with only the B6 resolution adapter (S4.2).
 *
 * Knows nothing about HTTP. The staff track takes a DataScope as a REQUIRED
 * argument and filters by it (hard rule 1); input types come from
 * `@repo/contracts`.
 *
 * **Scope shape: SCHOOL-level, `atSchoolLevel` widening.** The students table
 * has no class or section columns — those belong to the year anchor — so a
 * section-scoped teacher listing students is asking about the school's
 * registry, the same entity-shape reasoning as academic years (documented in
 * academic.service.ts). The ROSTER — "the students of 6-A this year" — is an
 * ENROLLMENT query (enrollment.service), where the class dimension is real
 * and no widening happens.
 *
 * NOT in the scope tree — no `scope_nodes` row (hard rule 12 names
 * school/class/section only). Carries the denormalised `organizationId` +
 * `schoolId` for `scopeWhere` like every academic table.
 *
 * Scope columns are per-TABLE (the S2.4 lesson): `scopeWhere` compiles the
 * columns it is handed into that query's SQL.
 */

const STUDENT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: students.organizationId,
  schoolId: students.schoolId,
} as const;

export class StudentService {
  /**
   * Admits a student into the registry. No parent FKs and no scope node, so
   * no transaction and no parent re-read: both tenancy columns come from the
   * caller's scope, not the input. A duplicate admission number within the
   * school is refused by `students_school_admission_number_uq`, not
   * pre-checked (ADR-022); `translateErrors` words it.
   */
  async createStudent(scope: DataScope, input: CreateStudentInput) {
    const schoolId = requireSchoolId(scope);

    const [student] = await db
      .insert(students)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
      })
      .returning();

    if (!student) {
      throw new Error("Failed to create student.");
    }

    return student;
  }

  /**
   * The school's ACTIVE students. Takes the PLURAL scopes (a user may hold
   * grants in several branches). Active only: the registry's inactive rows
   * are history (hard rule 2), not options for tomorrow's admission form —
   * the same reasoning as the subject catalogue's list.
   *
   * `q` is an optional text search across name parts and the admission
   * number — the one lookup a front desk actually performs ("the Sharma
   * child, admission DEMO-00…"). Deactivated students stay findable by id
   * (see `getStudentById`) but not by search: a leaving student should not
   * surface in an admission officer's picker.
   */
  async listStudents(scopes: DataScope[], q?: string) {
    return db
      .select()
      .from(students)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), STUDENT_SCOPE_COLUMNS),
          eq(students.status, "active"),
          q
            ? or(
                ilike(students.firstName, `%${q}%`),
                ilike(students.middleName, `%${q}%`),
                ilike(students.lastName, `%${q}%`),
                ilike(students.admissionNumber, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName));
  }

  /**
   * Reads one student. No active filter, unlike the list: a student who left
   * must still resolve for the enrollments, fee rows, and documents that
   * reference her (hard rule 2 — the registry is history, not a larder).
   */
  async getStudentById(scope: DataScope, studentId: string) {
    const [student] = await db
      .select()
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
        ),
      );

    return student ?? null;
  }

  /**
   * Demographics and contact details are correctable; identity is not (the
   * contract omits the admission number and the status — see its docstring).
   */
  async updateStudent(
    scope: DataScope,
    studentId: string,
    input: UpdateStudentInput,
  ) {
    const [student] = await db
      .update(students)
      .set(input)
      .where(
        and(
          eq(students.id, studentId),
          scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return student ?? null;
  }

  /**
   * The registry's soft delete (hard rule 2): the student becomes `inactive`,
   * and every enrollment, fee row, and result keeps pointing at her. The
   * enrollment/TC flow drives the richer departures (transferred_out with a
   * TC); this is the plain "this record should not act" switch.
   */
  async deactivateStudent(scope: DataScope, studentId: string) {
    const [student] = await db
      .update(students)
      .set({ status: "inactive" })
      .where(
        and(
          eq(students.id, studentId),
          scopeWhere(atSchoolLevel(scope), STUDENT_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return student ?? null;
  }

  /**
   * The owning branch of a student — the B6 resolution layer's adapter, same
   * shape as `getSubjectOwnerId`. Authorization-neutral by design: this
   * answers "who owns it", never "may you see it".
   */
  async getStudentOwnerId(
    organizationId: string,
    studentId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: students.schoolId })
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          eq(students.organizationId, organizationId),
        ),
      );

    return row?.schoolId ?? null;
  }
}

export const studentService = new StudentService();
