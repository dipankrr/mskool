import {
  atSchoolLevel,
  requireSchoolId,
  yearVisibilityWhere,
} from "./academic.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import type { CreateTermInput, UpdateTermInput } from "@repo/contracts";
import { db } from "@repo/db";
import { academicYears, terms } from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";

/**
 * TERMS — the subdivisions of an academic year. Phase 2 slice 3.
 *
 * Knows nothing about HTTP. Every read takes a DataScope as a REQUIRED argument
 * and filters by it (hard rule 1); input types come from `@repo/contracts` — a
 * service that declares its own input shapes creates a second definition of
 * the same thing that will drift from the Zod schema the router validates
 * against.
 *
 * School-level: like a year, a term has no class dimension — "Term 1 of
 * 2025-26" is the same fact for every class and section in the school — so the
 * scope widens with `atSchoolLevel` (the entity-shape reasoning documented in
 * academic.service.ts, imported from there: one definition). NOT in the scope
 * tree — no `scope_nodes` row on create (hard rule 12 names school/class/
 * section only).
 *
 * **Parent verification (the section-service pattern).** A foreign key proves
 * the year EXISTS, not that it belongs to this school — the academic_years FK
 * is precisely the one that does not mention `school_id`. So `createTerm`
 * re-reads the parent year through the caller's scope INSIDE the transaction
 * before inserting. The `terms_dates_within_year_trg` trigger would catch the
 * lie too, but only by refusing an insert that the FK let through, worded for
 * the database rather than the user.
 *
 * Scope columns are per-TABLE (the S2.4 lesson now written where the next
 * author will copy it): `scopeWhere` compiles the columns it is handed into
 * that query's SQL, so a column set borrowed from another table is a runtime
 * "missing FROM-clause entry" error that `tsc` cannot see.
 *
 * **No remove-procedure.** Terms have no `isActive` column and no delete: a
 * term is childless for exactly one phase — exams, attendance days, and fee
 * installments hang off it from Phase 3 onward — and a wrong term is corrected
 * by updating its name or dates while it is still empty. This matches the
 * mapping layer's decision; if removal is ever wanted, that is a new decision,
 * not an optional flag here.
 */

const TERM_SCOPE_COLUMNS = {
  organizationId: terms.organizationId,
  schoolId: terms.schoolId,
} as const;

const YEAR_SCOPE_COLUMNS = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
} as const;

export class TermService {
  /**
   * Creates a term for one academic year. The year-sum-of-weightage rule is
   * deliberately not checked here (or anywhere in app code): it spans rows,
   * so a pre-check would race, and the term screen owns it as a soft
   * invariant — see the schema comment.
   */
  async createTerm(scope: DataScope, input: CreateTermInput) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      // Re-read the parent year through the caller's scope inside the
      // transaction. The dates-within-year trigger re-checks against the REAL
      // parent row anyway, but only after the FK has let the row through —
      // this re-read refuses first and words it for the caller.
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
          "Academic year not found in this school. A term cannot reference another school's year.",
        );
      }

      const [term] = await tx
        .insert(terms)
        .values({ ...input, organizationId, schoolId })
        .returning();
      if (!term) {
        throw new Error("Failed to create term.");
      }
      return term;
    });
  }

  /**
   * One year's terms in report-card order. Takes the PLURAL scopes (a user
   * may hold grants in several branches), and the year input pins the school
   * the way it does for sections.
   *
   * `includeHistory` is required, not optional — either default is wrong
   * invisibly (the yearVisibilityWhere docstring owns that argument). A term
   * is the entry point to a year's exam schedule, so a caller without
   * `academic_year:read_history` must not reach a closed year's terms by
   * naming its id: the join with `yearVisibilityWhere` pins the answer to the
   * current year, the same mechanism the section reads use. This is the other
   * side of the year→term edge the ADR-024 note calls load-bearing.
   */
  async listTerms(
    scopes: DataScope[],
    academicYearId: string,
    includeHistory: boolean,
  ) {
    const rows = await db
      .select({ term: terms })
      .from(terms)
      .innerJoin(academicYears, eq(terms.academicYearId, academicYears.id))
      .where(
        and(
          eq(terms.academicYearId, academicYearId),
          scopeWhere(scopes.map(atSchoolLevel), TERM_SCOPE_COLUMNS),
          yearVisibilityWhere(includeHistory),
        ),
      )
      .orderBy(asc(terms.sequenceNumber));

    return rows.map((r) => r.term);
  }

  /**
   * Reads one term. Same join as the list, for the same reason: out of scope,
   * wrong tenant, and closed-year-without-read_history all collapse to null —
   * the router makes them the same NOT_FOUND, so nothing here confirms an id
   * exists somewhere the caller may not look.
   */
  async getTermById(
    scope: DataScope,
    termId: string,
    includeHistory: boolean,
  ) {
    const [row] = await db
      .select({ term: terms })
      .from(terms)
      .innerJoin(academicYears, eq(terms.academicYearId, academicYears.id))
      .where(
        and(
          eq(terms.id, termId),
          scopeWhere(atSchoolLevel(scope), TERM_SCOPE_COLUMNS),
          yearVisibilityWhere(includeHistory),
        ),
      );

    return row?.term ?? null;
  }

  /**
   * Renames, re-sequences, re-dates, re-weights, or switches the result mode.
   * The dates-within-year trigger guards every date change against the year
   * the term already belongs to (`academicYearId` is not patchable — see the
   * contract), and the unique index refuses a colliding sequence (ADR-022).
   */
  async updateTerm(scope: DataScope, termId: string, input: UpdateTermInput) {
    const [term] = await db
      .update(terms)
      .set(input)
      .where(
        and(
          eq(terms.id, termId),
          scopeWhere(atSchoolLevel(scope), TERM_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return term ?? null;
  }

  /**
   * The owning branch of a term — the B6 resolution layer's adapter, same
   * shape as `getSubjectOwnerId`. Filtered by org so a cross-tenant id and a
   * nonexistent one are indistinguishable: both null, both NOT_FOUND upstream.
   * Authorization-neutral by design — "who owns it", never "may you see it".
   */
  async getTermOwnerId(
    organizationId: string,
    termId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: terms.schoolId })
      .from(terms)
      .where(
        and(
          eq(terms.id, termId),
          eq(terms.organizationId, organizationId),
        ),
      );

    return row?.schoolId ?? null;
  }
}

export const termService = new TermService();
