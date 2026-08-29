import {
  atSchoolLevel,
  requireSchoolId,
} from "./academic.service";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  CreateSubjectInput,
  UpdateSubjectInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import { subjects } from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";

/**
 * SUBJECTS — the school's subject catalogue. Phase 2 slice 1.
 *
 * Knows nothing about HTTP. Every read takes a DataScope as a REQUIRED argument
 * and filters by it (hard rule 1), so a forgotten tenancy filter is a compile
 * error rather than a leak. Input types come from `@repo/contracts` — the type
 * chain is db → contracts → services, and a service that declares its own input
 * shapes creates a second definition of the same thing that will drift from the
 * Zod schema the router actually validates against.
 *
 * Subjects are SCHOOL-level: like a class, "Mathematics" is the same subject
 * every year — the year and class dimensions live on sections, enrollments and
 * `class_subject_mappings` later in this phase. So the scope widens with
 * `atSchoolLevel` (same entity-shape reasoning as `academic_years`, documented
 * there): a section-scoped teacher listing their school's subjects is asking
 * about the same set as the principal, not a wider one.
 *
 * NOT in the scope tree — no `scope_nodes` row on create (hard rule 12 names
 * school/class/section only), hence no transaction: a teacher's subject
 * authority is a `section_teacher_assignments` fact (ADR-012), checked by
 * `checkSubjectAccess` when marks arrive, never by `can()`.
 */

const SUBJECT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: subjects.organizationId,
  schoolId: subjects.schoolId,
};

export class SubjectService {
  /**
   * Creates a subject. No scope node (see the file comment), so no transaction
   * and no parent re-read: there is no parent FK to smuggle across tenants —
   * both tenancy columns come from the caller's own scope, not the input.
   *
   * A duplicate name within the school is refused by the
   * `subjects_school_name_uq` unique index, not pre-checked here (ADR-022):
   * a check between our SELECT and our INSERT would still race, the constraint
   * holds by construction, and `translateErrors` on the builders words it.
   */
  async createSubject(scope: DataScope, input: CreateSubjectInput) {
    const schoolId = requireSchoolId(scope);

    const [subject] = await db
      .insert(subjects)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
      })
      .returning();

    if (!subject) {
      throw new Error("Failed to create subject.");
    }

    return subject;
  }

  /**
   * Lists the school's active subjects. Takes the PLURAL scopes: a user may
   * hold grants in several branches, and no single DataScope can express
   * "school A or school B".
   *
   * Active only, like `listClasses` — the inactive rows are history the
   * results and fee structures still point at (hard rule 2), not options for
   * tomorrow's timetable. When a screen needs to show closed subjects, that is
   * a new method with its own decision, not an optional flag here: a default
   * `includeInactive` at a list that feeds pickers would sprinkle deactivated
   * subjects through every form that was not thinking about them.
   *
   * Alphabetical: a subject picker is scanned by eye far more than by id, and
   * unlike classes there is no numeric order to preserve.
   */
  async listSubjects(scopes: DataScope[]) {
    return db
      .select()
      .from(subjects)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), SUBJECT_SCOPE_COLUMNS),
          eq(subjects.isActive, true),
        ),
      )
      .orderBy(asc(subjects.name));
  }

  /**
   * Reads one subject. No active-only filter here, unlike the list: a subject
   * deactivated mid-year must still resolve for the results and fee rows that
   * reference it, so whether history is visible is the caller's decision (and
   * the router's gate), not this query's.
   */
  async getSubjectById(scope: DataScope, subjectId: string) {
    const [subject] = await db
      .select()
      .from(subjects)
      .where(
        and(
          eq(subjects.id, subjectId),
          scopeWhere(atSchoolLevel(scope), SUBJECT_SCOPE_COLUMNS),
        ),
      );

    return subject ?? null;
  }

  async updateSubject(
    scope: DataScope,
    subjectId: string,
    input: UpdateSubjectInput,
  ) {
    const [subject] = await db
      .update(subjects)
      .set(input)
      .where(
        and(
          eq(subjects.id, subjectId),
          scopeWhere(atSchoolLevel(scope), SUBJECT_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return subject ?? null;
  }

  /** Never a DELETE (hard rule 2) — results and fee structures point at it. */
  async deactivateSubject(scope: DataScope, subjectId: string) {
    const [subject] = await db
      .update(subjects)
      .set({ isActive: false })
      .where(
        and(
          eq(subjects.id, subjectId),
          scopeWhere(atSchoolLevel(scope), SUBJECT_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return subject ?? null;
  }

  /**
   * The owning branch of a subject — the B6 resolution layer's adapter, same
   * shape as `getAcademicYearOwnerId` (ADR-028 context). A subject is not a
   * scope node: its owning node must be LOOKED UP from its schoolId column
   * before the gate can judge coverage. Filtered by org so a cross-tenant id
   * and a nonexistent one are indistinguishable — both return null, both become
   * NOT_FOUND, and neither confirms the id exists elsewhere.
   *
   * Authorization-neutral by design: this answers "who owns it", never "may
   * you see it".
   */
  async getSubjectOwnerId(
    organizationId: string,
    subjectId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: subjects.schoolId })
      .from(subjects)
      .where(
        and(
          eq(subjects.id, subjectId),
          eq(subjects.organizationId, organizationId),
        ),
      );

    return row?.schoolId ?? null;
  }
}

export const subjectService = new SubjectService();
