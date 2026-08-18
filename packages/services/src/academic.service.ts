import {
  insertScopeNode,
  scopeWhere,
  type DataScope,
  type ScopeColumns,
} from "@repo/authz";
import type {
  CreateAcademicYearInput,
  CreateClassInput,
  CreateSectionInput,
  UpdateAcademicYearInput,
  UpdateClassInput,
  UpdateSectionInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import { academicYears, classes, sections } from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";

/**
 * ACADEMIC STRUCTURE — Phase 2 slice 1.
 *
 * Academic years, classes, and sections. Services know nothing about HTTP:
 * every read takes a DataScope as a REQUIRED argument and filters by it (hard
 * rule 1), so a forgotten tenancy filter is a compile error rather than a leak.
 *
 * Input types come from `@repo/contracts` — the type chain is
 * db → contracts → services, and a service that declares its own input shapes
 * creates a second definition of the same thing that will drift from the Zod
 * schema the router actually validates against.
 *
 * Three things here that `organization.service.ts` does not have to deal with,
 * each explained where it is enforced:
 *
 *   1. Year visibility is a permission, not a scope inference. `read_history`
 *      decides who may open a closed session; the router passes the answer in
 *      as `includeHistory`. See `yearVisibilityWhere` (ADR-024).
 *   2. Not every table can express every scope level, and `scopeWhere` throws
 *      rather than widen. See `atSchoolLevel`.
 *   3. A foreign key proves a row EXISTS, not that it belongs to your tenant.
 *      See `createSection`.
 */

// ---------------------------------------------------------------------------
// Year visibility
// ---------------------------------------------------------------------------

/**
 * The extra WHERE term year visibility implies, or undefined for no restriction.
 *
 * `includeHistory` answers one question about the caller: may they address a
 * NON-current session at all. It is decided at the router by the
 * `academic_year:read_history` permission (ADR-024), not inferred from the
 * caller's scope. The router asks it two ways, mirroring ADR-017: strictly via
 * `can()` for a single-resource read, permissively via `getDataScopes()` for a
 * list — a school principal holds `read_history` at their branch, not the org
 * node they address to list years, so the strict question would wrongly deny
 * them.
 *
 * When false, every year-scoped read is pinned to the current session, so a
 * stale or guessed id for a closed year returns nothing regardless of where it
 * came from. `and()` ignores undefined, so this composes without a branch at
 * each call.
 *
 * **It is a required argument, not an option with a default.** Either default
 * is wrong invisibly: `true` hands a class teacher the school's history, `false`
 * hides it from the accountant chasing last year's arrears. Requiring it means
 * a new year-scoped read cannot forget the question exists.
 */
function yearVisibilityWhere(includeHistory: boolean) {
  return includeHistory ? undefined : eq(academicYears.isCurrent, true);
}

// ---------------------------------------------------------------------------
// Scope levels these tables can express
// ---------------------------------------------------------------------------

/**
 * `academic_years` is a SCHOOL-level fact: a session belongs to a school, not
 * to a class within it. There is no `class_id` here to filter on, and none
 * would be meaningful.
 */
const ACADEMIC_YEAR_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
};

/** A class IS its id, so the class level maps to the primary key. */
const CLASS_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: classes.organizationId,
  schoolId: classes.schoolId,
  classId: classes.id,
};

/** Sections are the only table here that can express all four levels. */
const SECTION_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: sections.organizationId,
  schoolId: sections.schoolId,
  classId: sections.classId,
  sectionId: sections.id,
};

/**
 * Widens a scope to the school level, dropping any class and section
 * restriction.
 *
 * **Read this before copying it anywhere else.** `scopeWhere` deliberately
 * throws when a scope restricts a level the table has no column for (ADR-017),
 * because silently dropping the restriction is what turned "you may see one
 * section" into "you may see the whole organization". That default is right.
 *
 * But it makes a class-scoped teacher unable to ask a question they are plainly
 * entitled to ask: *which academic year is my school in?* Their scope restricts
 * `classId`; `academic_years` has no such column; the call throws and the
 * teacher gets a 500 for reading a school-level reference table.
 *
 * The distinction that makes widening safe here is a property of the ENTITY,
 * not a convenience for the caller: an academic year has no class dimension at
 * all, so "the years of my class" is not a narrower set than "the years of my
 * school" — it is the same set, asked with a word the table does not have.
 * Nothing is widened except in the literal SQL sense.
 *
 * That reasoning does **not** transfer to any row a person owns. Students,
 * attendance, marks, and fees all have a real class dimension, so widening
 * there hands a class teacher the whole school. If you find yourself reaching
 * for this in one of those services, the answer is a join, not a wider filter.
 */
function atSchoolLevel(scope: DataScope): DataScope {
  return {
    organizationId: scope.organizationId,
    schoolId: scope.schoolId,
    classId: null,
    sectionId: null,
  };
}

/**
 * Widens a scope to the class level. Same reasoning as `atSchoolLevel`: a class
 * is not subdivided by section — 6-A and 6-B are both "Class 6" — so a
 * section-scoped teacher asking which class they teach is asking about the one
 * row their scope already names.
 */
function atClassLevel(scope: DataScope): DataScope {
  return {
    organizationId: scope.organizationId,
    schoolId: scope.schoolId,
    classId: scope.classId,
    sectionId: null,
  };
}

/**
 * Every row here belongs to exactly one school, so a write needs one named.
 *
 * An org-scoped admin has `schoolId: null` — legitimately, since they cover
 * every branch — which is fine for reading and useless for writing: we would
 * have to guess which branch the class is for. The caller names a school in the
 * request, `staffProcedure` resolves that to the school node, and the scope
 * arrives populated. Reaching this error means the input carried no school.
 */
function requireSchoolId(scope: DataScope): string {
  if (!scope.schoolId) {
    throw new Error(
      "This operation needs a school. The request must name a schoolId so the " +
        "scope resolves to that school rather than the whole organization.",
    );
  }
  return scope.schoolId;
}

// ---------------------------------------------------------------------------

export class AcademicService {
  // -------------------------------------------------------------------------
  // Academic years
  // -------------------------------------------------------------------------

  /**
   * Creates an academic year.
   *
   * No scope node: the authorization tree is org → school → class → section
   * (ADR-015), and a year is not a rung on it. Nobody is ever "scoped to
   * 2025-26" — they are scoped to a school, across whichever years it runs. So
   * hard rule 12 does not apply here, and no transaction is needed.
   *
   * Three things the database refuses on our behalf, so this method does not
   * re-check them (ADR-022): a year overlapping another in the same school, a
   * second `is_current` year, and `end_date < start_date`. Re-implementing
   * those here would add a race — between our SELECT and our INSERT another
   * request can commit the row that makes ours invalid — while the constraints
   * hold under concurrency by construction.
   */
  async createAcademicYear(scope: DataScope, input: CreateAcademicYearInput) {
    const schoolId = requireSchoolId(scope);

    const [academicYear] = await db
      .insert(academicYears)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
        // Frozen at creation, never accepted from input and never updated. If
        // the year is later extended, `endDate` moves and this stays put.
        originalEndDate: input.endDate,
      })
      .returning();

    if (!academicYear) {
      throw new Error("Failed to create academic year.");
    }

    return academicYear;
  }

  /**
   * Lists academic years the caller may see.
   *
   * Takes the PLURAL scopes: a user may hold grants in several branches, and no
   * single DataScope can express "school A or school B".
   *
   * Without `includeHistory` this returns at most one row per school. That is
   * intended — the year picker should not offer a class teacher a session they
   * cannot open anything inside.
   */
  async listAcademicYears(scopes: DataScope[], includeHistory: boolean) {
    return db
      .select()
      .from(academicYears)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), ACADEMIC_YEAR_SCOPE_COLUMNS),
          yearVisibilityWhere(includeHistory),
        ),
      )
      .orderBy(asc(academicYears.startDate));
  }

  /**
   * The school's current year — what almost every other query needs before it
   * can ask anything useful.
   *
   * No `includeHistory` argument: the current year is visible to every scope by
   * definition, so there is nothing for the caller to decide.
   */
  async getCurrentAcademicYear(scope: DataScope) {
    const [academicYear] = await db
      .select()
      .from(academicYears)
      .where(
        and(
          eq(academicYears.isCurrent, true),
          scopeWhere(atSchoolLevel(scope), ACADEMIC_YEAR_SCOPE_COLUMNS),
        ),
      );

    return academicYear ?? null;
  }

  /**
   * Reads one year, filtered by scope AND by visibility. Fetching by id alone
   * would let a principal at one branch read another branch's by guessing an
   * id, and would hand a closed session to a caller restricted to the current
   * one.
   */
  async getAcademicYearById(
    scope: DataScope,
    academicYearId: string,
    includeHistory: boolean,
  ) {
    const [academicYear] = await db
      .select()
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, academicYearId),
          scopeWhere(atSchoolLevel(scope), ACADEMIC_YEAR_SCOPE_COLUMNS),
          yearVisibilityWhere(includeHistory),
        ),
      );

    return academicYear ?? null;
  }

  /**
   * Amends a year — its label, its dates, its status.
   *
   * No `includeHistory`: editing a year is an org-level act by policy, so the gate
   * is the `academic_year:update` permission at the router, not a row filter
   * here. Adding one would imply school-level roles can edit the current year,
   * which is a different decision than the one about reading history.
   */
  async updateAcademicYear(
    scope: DataScope,
    academicYearId: string,
    input: UpdateAcademicYearInput,
  ) {
    const [academicYear] = await db
      .update(academicYears)
      .set(input)
      .where(
        and(
          eq(academicYears.id, academicYearId),
          scopeWhere(atSchoolLevel(scope), ACADEMIC_YEAR_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return academicYear ?? null;
  }

  /**
   * Moves the "current year" flag to another year of the same school.
   *
   * Two statements in one transaction, and **the order is load-bearing**. The
   * `academic_years_one_current_excl` constraint is not deferrable, so it is
   * checked at the end of each statement rather than at commit: setting the new
   * year first would collide with the outgoing one and abort. Clear, then set.
   *
   * This is also the switch that changes what every `current-only` caller can
   * see, so it is an org-level act — one row moving reassigns a whole school's
   * visible history.
   */
  async setCurrentAcademicYear(scope: DataScope, academicYearId: string) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      // Verify the target is inside the caller's scope BEFORE clearing
      // anything. Without this, naming another school's year would still clear
      // this school's flag and then fail to set the new one, leaving the school
      // with no current year at all — and every current-only caller locked out.
      const [target] = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(
          and(
            eq(academicYears.id, academicYearId),
            scopeWhere(atSchoolLevel(scope), ACADEMIC_YEAR_SCOPE_COLUMNS),
          ),
        );

      if (!target) return null;

      await tx
        .update(academicYears)
        .set({ isCurrent: false })
        .where(
          and(
            eq(academicYears.schoolId, schoolId),
            eq(academicYears.isCurrent, true),
          ),
        );

      const [academicYear] = await tx
        .update(academicYears)
        .set({ isCurrent: true })
        .where(eq(academicYears.id, academicYearId))
        .returning();

      return academicYear ?? null;
    });
  }

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  /**
   * Creates a class AND its scope node in ONE transaction — hard rule 12.
   *
   * These cannot be split. A committed class with no scope node is invisible to
   * authorization: `loadScopeNode` returns null and every request against it
   * 403s, including from the admin who just created it. The failure presents as
   * a permissions bug and is painful to trace back to a missing row.
   */
  async createClass(scope: DataScope, input: CreateClassInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [cls] = await tx
        .insert(classes)
        .values({ ...input, organizationId: scope.organizationId, schoolId })
        .returning();

      if (!cls) {
        throw new Error("Failed to create class.");
      }

      // Same transaction. Do not move this out.
      // A class node carries schoolId as ancestry; the CHECK constraint from
      // ADR-019 rejects it without one.
      await insertScopeNode(tx, {
        id: cls.id,
        type: "class",
        organizationId: scope.organizationId,
        schoolId,
      });

      return cls;
    });
  }

  /**
   * Lists classes. No year visibility — classes are deliberately not year-scoped
   * (Class 6 is the same rung of the ladder every year), so there is no history
   * here to restrict. The year dimension lives on `sections`.
   *
   * Ordered by `numericOrder`: "Class 10" must not sort before "Class 2", and
   * Nursery/LKG/UKG have no numeral to sort on at all.
   */
  async listClasses(scopes: DataScope[]) {
    return db
      .select()
      .from(classes)
      .where(
        and(
          scopeWhere(scopes.map(atClassLevel), CLASS_SCOPE_COLUMNS),
          eq(classes.isActive, true),
        ),
      )
      .orderBy(asc(classes.numericOrder));
  }

  async getClassById(scope: DataScope, classId: string) {
    const [cls] = await db
      .select()
      .from(classes)
      .where(
        and(
          eq(classes.id, classId),
          scopeWhere(atClassLevel(scope), CLASS_SCOPE_COLUMNS),
        ),
      );

    return cls ?? null;
  }

  async updateClass(
    scope: DataScope,
    classId: string,
    input: UpdateClassInput,
  ) {
    const [cls] = await db
      .update(classes)
      .set(input)
      .where(
        and(
          eq(classes.id, classId),
          scopeWhere(atClassLevel(scope), CLASS_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return cls ?? null;
  }

  /**
   * Deactivates a class. Never a DELETE (hard rule 2) — historical enrollments,
   * fee structures, and results all point at it.
   */
  async deactivateClass(scope: DataScope, classId: string) {
    const [cls] = await db
      .update(classes)
      .set({ isActive: false })
      .where(
        and(
          eq(classes.id, classId),
          scopeWhere(atClassLevel(scope), CLASS_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return cls ?? null;
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  /**
   * Creates a section AND its scope node in ONE transaction — hard rule 12.
   *
   * **The parent checks are the substance of this method, not ceremony.** A
   * section points at a class and an academic year, and both foreign keys prove
   * only that the row exists *somewhere* — Postgres will happily let a section
   * in school A reference a class in school B, because the FK never mentions
   * `school_id`. That row then sits in the tree with one school's ancestry on
   * its scope node and another school's data hanging off it, which is a
   * cross-tenant link no later query has any reason to doubt.
   *
   * So both parents are re-read through the caller's scope inside the
   * transaction: a parent outside the caller's school comes back null and the
   * write is refused before it happens.
   *
   * (The stronger fix is a composite foreign key — `UNIQUE (id, school_id)` on
   * the parents, then `FOREIGN KEY (class_id, school_id)` — which makes the
   * mismatch unrepresentable rather than merely checked. Worth doing when the
   * remaining Phase 2 tables repeat the same shape a third time.)
   */
  async createSection(scope: DataScope, input: CreateSectionInput) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [parentClass] = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(
          and(
            eq(classes.id, input.classId),
            eq(classes.schoolId, schoolId),
            scopeWhere(atClassLevel(scope), CLASS_SCOPE_COLUMNS),
          ),
        );

      if (!parentClass) {
        throw new Error(
          "Class not found in this school. A section cannot be attached to a " +
            "class belonging to another school.",
        );
      }

      const [parentYear] = await tx
        .select({ id: academicYears.id })
        .from(academicYears)
        .where(
          and(
            eq(academicYears.id, input.academicYearId),
            eq(academicYears.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), ACADEMIC_YEAR_SCOPE_COLUMNS),
          ),
        );

      if (!parentYear) {
        throw new Error(
          "Academic year not found in this school. A section cannot be " +
            "attached to another school's academic year.",
        );
      }

      const [section] = await tx
        .insert(sections)
        .values({ ...input, organizationId: scope.organizationId, schoolId })
        .returning();

      if (!section) {
        throw new Error("Failed to create section.");
      }

      // Same transaction. A section node needs BOTH schoolId and classId as
      // ancestry — ADR-019's constraint rejects it without them, which is what
      // stops a section node resolving to a DataScope that spans the org.
      await insertScopeNode(tx, {
        id: section.id,
        type: "section",
        organizationId: scope.organizationId,
        schoolId,
        classId: input.classId,
      });

      return section;
    });
  }

  /**
   * Sections for one academic year, optionally narrowed to one class.
   *
   * The year is required rather than optional: sections are re-created every
   * year, so an unfiltered list returns 6-A for every session the school has
   * ever run, and the caller almost certainly wanted this year's.
   *
   * `classId` is optional and answers the two shapes the UI actually needs from
   * one method: omitted, it is the school-wide roster of every section in the
   * year (the timetable grid, a teacher-assignment picker, dashboards); present,
   * it is "the sections of Class 6" for a class detail page. `and()` ignores an
   * undefined term, so the school-wide path composes without a branch. It is not
   * a tenancy control — `scopeWhere` already bounds the rows to what the caller
   * may see — only a convenience filter, so a `classId` in another school simply
   * returns nothing rather than erroring.
   *
   * **This is where "the current year and its content" is actually enforced.**
   * Restricting `listAcademicYears` alone would be theatre — a `current-only`
   * caller holding a stale id from a browser tab, a bookmark, or a guess could
   * still list last year's sections and walk into last year's students from
   * there. The join makes the year's own `is_current` flag part of the
   * predicate, so a non-current id yields nothing regardless of where it came
   * from. Every later domain (attendance, marks, fees) reaches its rows through
   * a section or a year, so enforcing it at both ends of this edge is what the
   * rest inherits.
   */
  async listSections(
    scopes: DataScope[],
    academicYearId: string,
    includeHistory: boolean,
    classId?: string,
  ) {
    const rows = await db
      .select({ section: sections })
      .from(sections)
      .innerJoin(academicYears, eq(sections.academicYearId, academicYears.id))
      .where(
        and(
          eq(sections.academicYearId, academicYearId),
          // Optional narrowing to one class. undefined when omitted, which
          // and() drops — see the docstring.
          classId ? eq(sections.classId, classId) : undefined,
          scopeWhere(scopes, SECTION_SCOPE_COLUMNS),
          eq(sections.status, "active"),
          yearVisibilityWhere(includeHistory),
        ),
      )
      .orderBy(asc(sections.name));

    return rows.map((r) => r.section);
  }


  /**
   * Reads one section. Same join as the list, for the same reason: a section id
   * is the entry point to a year's students, attendance, and marks, so a
   * `current-only` caller must not resolve one belonging to a closed session.
   */
  async getSectionById(
    scope: DataScope,
    sectionId: string,
    includeHistory: boolean,
  ) {
    const [row] = await db
      .select({ section: sections })
      .from(sections)
      .innerJoin(academicYears, eq(sections.academicYearId, academicYears.id))
      .where(
        and(
          eq(sections.id, sectionId),
          scopeWhere(scope, SECTION_SCOPE_COLUMNS),
          yearVisibilityWhere(includeHistory),
        ),
      );

    return row?.section ?? null;
  }

  /**
   * `academicYearId` and `classId` are absent from the input type, not merely
   * ignored here. Moving a section between classes or years would silently
   * relocate every student, attendance record, and result already attached to
   * it, and would leave its scope node's denormalised ancestry pointing at the
   * old class (ADR-015). A section in the wrong place is deactivated and
   * re-created; students move by transfer, which is `section_transfer_log`
   * later in this phase.
   */
  async updateSection(
    scope: DataScope,
    sectionId: string,
    input: UpdateSectionInput,
  ) {
    const [section] = await db
      .update(sections)
      .set(input)
      .where(
        and(
          eq(sections.id, sectionId),
          scopeWhere(scope, SECTION_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return section ?? null;
  }

  /** Never a DELETE (hard rule 2) — a year's attendance and results hang off it. */
  async deactivateSection(scope: DataScope, sectionId: string) {
    const [section] = await db
      .update(sections)
      .set({ status: "inactive" })
      .where(
        and(
          eq(sections.id, sectionId),
          scopeWhere(scope, SECTION_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return section ?? null;
  }
}

export const academicService = new AcademicService();
