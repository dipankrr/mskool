import {
  atSchoolLevel,
  requireSchoolId,
  yearVisibilityWhere,
} from "./academic.service";
import {
  concessionKey,
  concessionShares,
  coveredPeriodsFor,
  fromCents,
  periodOptions,
  toCents,
  type LineFrequency,
  type PeriodOption,
} from "./fees-maths";
import { assertSessionOpen, feesBillingService } from "./fees-billing.service";
import { todayInIst } from "./enrollment-status";
import { refuse } from "./service-error";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  CreateConcessionInput,
  CreateFeeHeadInput,
  CreateFeeStructureInput,
  CreateFeeStructureLineInput,
  CreateLateFeeRuleInput,
  CreateSubscriptionInput,
  UpdateFeeHeadInput,
  UpdateFeeStructureInput,
  UpdateFeeStructureLineInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  feeConcessions,
  feeHeads,
  feeInstallments,
  feeLinePeriods,
  feeSessionSettings,
  feeStructureLines,
  feeStructureSections,
  feeStructures,
  lateFeeRules,
  sections,
  studentFeeAssignments,
  studentOptionalFeeSubscriptions,
  students,
  terms,
} from "@repo/db/schema";
import { and, asc, eq, gt, gte, inArray, lte, ne } from "drizzle-orm";

/**
 * FEES — the configuration layer. Phase 4, chunk F3.
 *
 * Knows nothing about HTTP. Every read takes a DataScope (or the plural
 * scopes) as a REQUIRED argument and filters by it (hard rule 1); every
 * create re-reads its parents through the caller's scope, because a FK proves
 * a row EXISTS, not that it belongs to your tenant (the section-service
 * pattern).
 *
 * Everything here is SCHOOL-level configuration: heads, structures, lines and
 * late-fee rules have no class/section dimension their own (a structure
 * ADDRESSES a class, but the right to manage fees is a school-office right,
 * not a class-teacher one), so the scope widens with `atSchoolLevel` — the
 * same entity-shape reasoning as subjects. Subscriptions and concessions are
 * STUDENT-level rows but are managed by the same office roles; their re-reads
 * key on the student's own school, so a class-scoped caller cannot smuggle a
 * student of another branch past the school gate.
 *
 * Money is a decimal STRING end to end (hard rule 4): the `money` arithmetic
 * helpers below work in integer paise (BigInt) so no float ever touches a
 * concession computation.
 *
 * NOT in the scope tree — no `scope_nodes` rows (hard rule 12 names
 * school/class/section only). The billing engine (F4) and collection (F5)
 * live in their own files; this file is the vocabulary's CRUD.
 */

const HEAD_SCOPE: ScopeColumns = {
  organizationId: feeHeads.organizationId,
  schoolId: feeHeads.schoolId,
};
const STRUCTURE_SCOPE: ScopeColumns = {
  organizationId: feeStructures.organizationId,
  schoolId: feeStructures.schoolId,
};
const LINE_SCOPE: ScopeColumns = {
  organizationId: feeStructureLines.organizationId,
  schoolId: feeStructureLines.schoolId,
};
const PERIOD_SCOPE: ScopeColumns = {
  organizationId: feeLinePeriods.organizationId,
  schoolId: feeLinePeriods.schoolId,
};
const RULE_SCOPE: ScopeColumns = {
  organizationId: lateFeeRules.organizationId,
  schoolId: lateFeeRules.schoolId,
};
const SUBSCRIPTION_SCOPE: ScopeColumns = {
  organizationId: studentOptionalFeeSubscriptions.organizationId,
  schoolId: studentOptionalFeeSubscriptions.schoolId,
};
const CONCESSION_SCOPE: ScopeColumns = {
  organizationId: feeConcessions.organizationId,
  schoolId: feeConcessions.schoolId,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

// ---------------------------------------------------------------------------

export class FeesService {
  // -------------------------------------------------------------------------
  // Fee heads
  // -------------------------------------------------------------------------

  /**
   * A duplicate name within the school is refused by
   * `fee_heads_school_name_uq`, not pre-checked here (ADR-022): the
   * constraint holds by construction and `translateErrors` words it.
   */
  async createFeeHead(scope: DataScope, input: CreateFeeHeadInput, actorId: string) {
    const schoolId = requireSchoolId(scope);

    const [head] = await db
      .insert(feeHeads)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
        createdBy: actorId,
      })
      .returning();

    if (!head) {
      throw new Error("Failed to create fee head.");
    }
    return head;
  }

  /**
   * The school's ACTIVE heads, alphabetical — a head picker is scanned by
   * eye. The inactive rows are history that structures, assignments and
   * ledger rows still point at (hard rule 2), not options for tomorrow's
   * structure.
   */
  async listFeeHeads(scopes: DataScope[]) {
    return db
      .select()
      .from(feeHeads)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), HEAD_SCOPE),
          eq(feeHeads.isActive, true),
          eq(feeHeads.isSystem, false),
        ),
      )
      .orderBy(asc(feeHeads.name));
  }

  /** Single read — inactive rows resolve (the ledger must keep its FKs). */
  async getFeeHeadById(scope: DataScope, headId: string) {
    const [head] = await db
      .select()
      .from(feeHeads)
      .where(
        and(
          eq(feeHeads.id, headId),
          scopeWhere(atSchoolLevel(scope), HEAD_SCOPE),
        ),
      );
    return head ?? null;
  }

  async updateFeeHead(scope: DataScope, headId: string, input: UpdateFeeHeadInput) {
    if (input.category !== undefined) {
      const [onLine] = await db
        .select({ id: feeStructureLines.id })
        .from(feeStructureLines)
        .where(eq(feeStructureLines.feeHeadId, headId))
        .limit(1);
      const [onService] = await db
        .select({ id: studentOptionalFeeSubscriptions.id })
        .from(studentOptionalFeeSubscriptions)
        .where(eq(studentOptionalFeeSubscriptions.feeHeadId, headId))
        .limit(1);
      const [current] = await db
        .select({ category: feeHeads.category })
        .from(feeHeads)
        .where(eq(feeHeads.id, headId));
      if ((onLine || onService) && current && current.category !== input.category) {
        throw refuse(
          "CONFLICT",
          "This fee type is already in use, so its kind can't change. Create a new fee type instead.",
        );
      }
    }
    const [head] = await db
      .update(feeHeads)
      .set(input)
      .where(
        and(
          eq(feeHeads.id, headId),
          scopeWhere(atSchoolLevel(scope), HEAD_SCOPE),
        ),
      )
      .returning();
    return head ?? null;
  }

  /** Never a DELETE (hard rule 2) — the whole fee chain points at a head. */
  async deactivateFeeHead(scope: DataScope, headId: string) {
    const [head] = await db
      .update(feeHeads)
      .set({ isActive: false })
      .where(
        and(
          eq(feeHeads.id, headId),
          scopeWhere(atSchoolLevel(scope), HEAD_SCOPE),
        ),
      )
      .returning();
    return head ?? null;
  }

  // -------------------------------------------------------------------------
  // Fee structures
  // -------------------------------------------------------------------------

  /**
   * Creates the class-level template. Both parents are RE-READ through the
   * caller's scope first: the FKs to `classes` and `academic_years` never
   * mention `school_id`, so Postgres would happily accept a structure
   * pointing at another branch's class — the cross-tenant link the section
   * service refuses for the same shape.
   */
  async createFeeStructure(scope: DataScope, input: CreateFeeStructureInput, actorId: string) {
    const schoolId = requireSchoolId(scope);

    const [klass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(
        and(eq(classes.id, input.classId), eq(classes.schoolId, schoolId)),
      );
    if (!klass) {
      throw new Error("Class not found in this school.");
    }

    const [year] = await db
      .select({ id: academicYears.id })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, input.academicYearId),
          eq(academicYears.schoolId, schoolId),
        ),
      );
    if (!year) {
      throw new Error("Academic year not found in this school.");
    }

    const [structure] = await db
      .insert(feeStructures)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
        createdBy: actorId,
      })
      .returning();

    if (!structure) {
      throw new Error("Failed to create fee structure.");
    }
    return structure;
  }

  /**
   * The structures of ONE year, for structure pickers and the setup screen.
   * `includeHistory` is REQUIRED (the ADR-024 rule): when false, the read is
   * pinned to the current session via the year JOIN, so a stale or guessed
   * id for a closed year returns nothing.
   */
  async listFeeStructures(
    scopes: DataScope[],
    academicYearId: string,
    includeHistory: boolean,
  ) {
    return db
      .select()
      .from(feeStructures)
      .innerJoin(
        academicYears,
        eq(academicYears.id, feeStructures.academicYearId),
      )
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), STRUCTURE_SCOPE),
          eq(feeStructures.academicYearId, academicYearId),
          yearVisibilityWhere(includeHistory),
        ),
      )
      .orderBy(asc(feeStructures.name))
      .then((rows) => rows.map((row) => row.fee_structures));
  }

  /** Single read with the same year-visibility gate. */
  async getFeeStructureById(
    scope: DataScope,
    structureId: string,
    includeHistory: boolean,
  ) {
    const [row] = await db
      .select()
      .from(feeStructures)
      .innerJoin(
        academicYears,
        eq(academicYears.id, feeStructures.academicYearId),
      )
      .where(
        and(
          eq(feeStructures.id, structureId),
          scopeWhere(atSchoolLevel(scope), STRUCTURE_SCOPE),
          yearVisibilityWhere(includeHistory),
        ),
      );
    return row?.fee_structures ?? null;
  }

  async updateFeeStructure(
    scope: DataScope,
    structureId: string,
    input: UpdateFeeStructureInput,
  ) {
    const [structure] = await db
      .update(feeStructures)
      .set(input)
      .where(
        and(
          eq(feeStructures.id, structureId),
          scopeWhere(atSchoolLevel(scope), STRUCTURE_SCOPE),
        ),
      )
      .returning();
    return structure ?? null;
  }

  /**
   * Deactivation, never delete (hard rule 2): fee records keep pointing at a
   * structure. Its sections are released so a replacement can take them.
   */
  async deactivateFeeStructure(scope: DataScope, structureId: string) {
    return db.transaction(async (tx) => {
      const [structure] = await tx
        .update(feeStructures)
        .set({ isActive: false })
        .where(
          and(
            eq(feeStructures.id, structureId),
            scopeWhere(atSchoolLevel(scope), STRUCTURE_SCOPE),
          ),
        )
        .returning();
      if (structure) {
        await tx
          .delete(feeStructureSections)
          .where(eq(feeStructureSections.feeStructureId, structureId));
      }
      return structure ?? null;
    });
  }

  // -------------------------------------------------------------------------
  // Fee structure lines and their schedules
  // -------------------------------------------------------------------------

  /** The session as the schedule maths needs it. */
  private async sessionShape(exec: Executor, schoolId: string, academicYearId: string) {
    const [year] = await exec
      .select({ startDate: academicYears.startDate, endDate: academicYears.endDate })
      .from(academicYears)
      .where(and(eq(academicYears.id, academicYearId), eq(academicYears.schoolId, schoolId)));
    if (!year) {
      throw refuse("BAD_REQUEST", "Academic year not found in this school.");
    }
    const yearTerms = await exec
      .select({
        id: terms.id,
        name: terms.name,
        startDate: terms.startDate,
        endDate: terms.endDate,
      })
      .from(terms)
      .where(eq(terms.academicYearId, academicYearId))
      .orderBy(asc(terms.sequenceNumber));
    return { startDate: year.startDate, endDate: year.endDate, terms: yearTerms };
  }

  /** Every period a line of this frequency could charge this session. */
  async listPeriodOptions(
    scope: DataScope,
    academicYearId: string,
    frequency: LineFrequency,
  ): Promise<PeriodOption[]> {
    const schoolId = requireSchoolId(scope);
    const session = await this.sessionShape(db, schoolId, academicYearId);
    const dueDay = await feesBillingService.dueDayOf(db, schoolId, academicYearId);
    return periodOptions(frequency, session, dueDay);
  }

  /**
   * Makes a line's schedule match what was asked. A row edited by hand keeps
   * that edit; everything else follows the line. Dues already created are never
   * touched: they carry their own amounts.
   *
   * With no periods named, a new line starts from the months the school charges.
   */
  private async syncSchedule(
    tx: Tx,
    args: {
      organizationId: string;
      schoolId: string;
      academicYearId: string;
      lineId: string;
      frequency: LineFrequency;
      amount: string;
      periodKeys?: string[];
      frequencyChanged: boolean;
    },
  ) {
    const session = await this.sessionShape(tx, args.schoolId, args.academicYearId);
    const dueDay = await feesBillingService.dueDayOf(tx, args.schoolId, args.academicYearId);
    const options = periodOptions(args.frequency, session, dueDay);
    const byKey = new Map(options.map((o) => [o.key, o]));

    if (args.frequencyChanged) {
      await tx.delete(feeLinePeriods).where(eq(feeLinePeriods.feeStructureLineId, args.lineId));
    }
    const existing = await tx
      .select()
      .from(feeLinePeriods)
      .where(eq(feeLinePeriods.feeStructureLineId, args.lineId));

    let keys = args.periodKeys;
    if (!keys) {
      if (existing.length > 0) {
        keys = existing.map((row) => row.periodKey);
      } else if (args.frequency === "monthly") {
        const [settings] = await tx
          .select({ chargedMonths: feeSessionSettings.chargedMonths })
          .from(feeSessionSettings)
          .where(
            and(
              eq(feeSessionSettings.schoolId, args.schoolId),
              eq(feeSessionSettings.academicYearId, args.academicYearId),
            ),
          );
        const charged = settings?.chargedMonths ?? [];
        keys = charged.length > 0 ? charged : options.map((o) => o.key);
      } else {
        keys = options.map((o) => o.key);
      }
    }
    const unknown = keys.find((key) => !byKey.has(key));
    if (unknown) {
      throw refuse("BAD_REQUEST", "Those periods are not all in this session.");
    }
    if (keys.length === 0) {
      throw refuse("BAD_REQUEST", "Choose at least one period for this fee.");
    }

    const wanted = new Set(keys);
    for (const row of existing) {
      if (!wanted.has(row.periodKey)) {
        await tx.delete(feeLinePeriods).where(eq(feeLinePeriods.id, row.id));
      } else if (!row.amountEdited) {
        await tx
          .update(feeLinePeriods)
          .set({ amount: args.amount })
          .where(eq(feeLinePeriods.id, row.id));
      }
    }
    const have = new Set(existing.map((row) => row.periodKey));
    const toAdd = keys.filter((key) => !have.has(key));
    if (toAdd.length > 0) {
      await tx.insert(feeLinePeriods).values(
        toAdd.map((key) => {
          const option = byKey.get(key);
          if (!option) throw refuse("BAD_REQUEST", "Those periods are not all in this session.");
          return {
            organizationId: args.organizationId,
            schoolId: args.schoolId,
            feeStructureLineId: args.lineId,
            periodKey: key,
            label: option.label,
            startDate: option.startDate,
            endDate: option.endDate,
            dueDate: option.dueDate,
            amount: args.amount,
            termId: option.termId,
          };
        }),
      );
    }
  }

  /**
   * Adds a fee to a structure and builds its schedule. The structure and the
   * head are both re-read in scope. An Optional head is refused: students opt
   * in to those through a service, and having it on a line too would bill the
   * same month twice.
   */
  async createFeeStructureLine(
    scope: DataScope,
    structureId: string,
    input: CreateFeeStructureLineInput,
  ) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [structure] = await tx
        .select({ id: feeStructures.id, academicYearId: feeStructures.academicYearId })
        .from(feeStructures)
        .where(and(eq(feeStructures.id, structureId), eq(feeStructures.schoolId, schoolId)));
      if (!structure) {
        throw refuse("NOT_FOUND", "Fee structure not found in this school.");
      }
      await assertSessionOpen(tx, structure.academicYearId);

      const [head] = await tx
        .select({ id: feeHeads.id, category: feeHeads.category })
        .from(feeHeads)
        .where(
          and(
            eq(feeHeads.id, input.feeHeadId),
            eq(feeHeads.schoolId, schoolId),
            eq(feeHeads.isActive, true),
          ),
        );
      if (!head) {
        throw refuse("NOT_FOUND", "Fee head not found in this school.");
      }
      if (head.category === "optional") {
        throw refuse(
          "BAD_REQUEST",
          "This is an optional fee type. Students join it as a service, so it cannot also sit on a fee structure.",
        );
      }

      const { periodKeys, ...values } = input;
      const [line] = await tx
        .insert(feeStructureLines)
        .values({
          ...values,
          organizationId: scope.organizationId,
          schoolId,
          feeStructureId: structureId,
        })
        .returning();
      if (!line) {
        throw new Error("Failed to create fee structure line.");
      }

      await this.syncSchedule(tx, {
        organizationId: scope.organizationId,
        schoolId,
        academicYearId: structure.academicYearId,
        lineId: line.id,
        frequency: line.frequency,
        amount: line.amount,
        periodKeys,
        frequencyChanged: false,
      });
      return line;
    });
  }

  async listFeeStructureLines(scope: DataScope, structureId: string) {
    const lines = await db
      .select()
      .from(feeStructureLines)
      .where(
        and(
          eq(feeStructureLines.feeStructureId, structureId),
          scopeWhere(atSchoolLevel(scope), LINE_SCOPE),
        ),
      )
      .orderBy(asc(feeStructureLines.createdAt));
    if (lines.length === 0) return [];
    const periods = await db
      .select()
      .from(feeLinePeriods)
      .where(
        inArray(
          feeLinePeriods.feeStructureLineId,
          lines.map((line) => line.id),
        ),
      )
      .orderBy(asc(feeLinePeriods.startDate));
    return lines.map((line) => ({
      ...line,
      periods: periods.filter((period) => period.feeStructureLineId === line.id),
    }));
  }

  async updateFeeStructureLine(
    scope: DataScope,
    lineId: string,
    input: UpdateFeeStructureLineInput,
  ) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: feeStructureLines.id,
          frequency: feeStructureLines.frequency,
          academicYearId: feeStructures.academicYearId,
        })
        .from(feeStructureLines)
        .innerJoin(feeStructures, eq(feeStructures.id, feeStructureLines.feeStructureId))
        .where(
          and(
            eq(feeStructureLines.id, lineId),
            scopeWhere(atSchoolLevel(scope), LINE_SCOPE),
          ),
        );
      if (!current) return null;
      await assertSessionOpen(tx, current.academicYearId);

      const { periodKeys, ...values } = input;
      // Changing only the months has no column to set; the schedule is the edit.
      const hasColumns = Object.values(values).some((value) => value !== undefined);
      const [line] = hasColumns
        ? await tx
            .update(feeStructureLines)
            .set(values)
            .where(eq(feeStructureLines.id, lineId))
            .returning()
        : await tx.select().from(feeStructureLines).where(eq(feeStructureLines.id, lineId));
      if (!line) return null;

      await this.syncSchedule(tx, {
        organizationId: scope.organizationId,
        schoolId,
        academicYearId: current.academicYearId,
        lineId,
        frequency: line.frequency,
        amount: line.amount,
        periodKeys,
        frequencyChanged: line.frequency !== current.frequency,
      });
      return line;
    });
  }

  /** Changes one row of a schedule: "₹1,200 from October" or a different date. */
  async updateLinePeriod(
    scope: DataScope,
    periodId: string,
    input: { amount?: string; dueDate?: string },
  ) {
    const [period] = await db
      .update(feeLinePeriods)
      .set({
        ...(input.amount !== undefined ? { amount: input.amount, amountEdited: true } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate, dueDateEdited: true } : {}),
      })
      .where(
        and(
          eq(feeLinePeriods.id, periodId),
          scopeWhere(atSchoolLevel(scope), PERIOD_SCOPE),
        ),
      )
      .returning();
    return period ?? null;
  }

  /** Which sections a structure covers. A section can only be on one. */
  async setStructureSections(scope: DataScope, structureId: string, sectionIds: string[]) {
    const schoolId = requireSchoolId(scope);
    return db.transaction(async (tx) => {
      const [structure] = await tx
        .select({ id: feeStructures.id, classId: feeStructures.classId })
        .from(feeStructures)
        .where(and(eq(feeStructures.id, structureId), eq(feeStructures.schoolId, schoolId)));
      if (!structure) {
        throw refuse("NOT_FOUND", "Fee structure not found in this school.");
      }
      if (sectionIds.length > 0) {
        const found = await tx
          .select({ id: sections.id })
          .from(sections)
          .where(
            and(
              inArray(sections.id, sectionIds),
              eq(sections.classId, structure.classId),
              eq(sections.schoolId, schoolId),
            ),
          );
        if (found.length !== new Set(sectionIds).size) {
          throw refuse("BAD_REQUEST", "Those sections are not all in this structure's class.");
        }
        const taken = await tx
          .select({ sectionId: feeStructureSections.sectionId })
          .from(feeStructureSections)
          .where(
            and(
              inArray(feeStructureSections.sectionId, sectionIds),
              ne(feeStructureSections.feeStructureId, structureId),
            ),
          );
        if (taken.length > 0) {
          throw refuse("CONFLICT", "One of those sections is already on another fee structure.");
        }
      }
      await tx
        .delete(feeStructureSections)
        .where(eq(feeStructureSections.feeStructureId, structureId));
      if (sectionIds.length > 0) {
        await tx.insert(feeStructureSections).values(
          [...new Set(sectionIds)].map((sectionId) => ({ feeStructureId: structureId, sectionId })),
        );
      }
      return { sectionIds: [...new Set(sectionIds)] };
    });
  }

  async listStructureSections(scope: DataScope, structureId: string) {
    const rows = await db
      .select({ sectionId: feeStructureSections.sectionId })
      .from(feeStructureSections)
      .innerJoin(feeStructures, eq(feeStructures.id, feeStructureSections.feeStructureId))
      .where(
        and(
          eq(feeStructureSections.feeStructureId, structureId),
          scopeWhere(atSchoolLevel(scope), STRUCTURE_SCOPE),
        ),
      );
    return rows.map((row) => row.sectionId);
  }

  // -------------------------------------------------------------------------
  // Late fee rules
  // -------------------------------------------------------------------------

  async createLateFeeRule(scope: DataScope, input: CreateLateFeeRuleInput, actorId: string) {
    const schoolId = requireSchoolId(scope);

    // A structure-narrowed rule re-reads its parent in scope, like any child.
    if (input.feeStructureId) {
      const [structure] = await db
        .select({ id: feeStructures.id })
        .from(feeStructures)
        .where(
          and(
            eq(feeStructures.id, input.feeStructureId),
            eq(feeStructures.schoolId, schoolId),
          ),
        );
      if (!structure) {
        throw refuse("NOT_FOUND", "Fee structure not found in this school.");
      }
    }

    const [rule] = await db
      .insert(lateFeeRules)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
        createdBy: actorId,
      })
      .returning();

    if (!rule) {
      throw new Error("Failed to create late fee rule.");
    }
    return rule;
  }

  /** The ACTIVE rules — exactly what `computeLateFee` (F4) will consult. */
  async listActiveLateFeeRules(scopes: DataScope[]) {
    return db
      .select()
      .from(lateFeeRules)
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), RULE_SCOPE),
          eq(lateFeeRules.isActive, true),
        ),
      )
      .orderBy(asc(lateFeeRules.effectiveFrom));
  }

  async deactivateLateFeeRule(scope: DataScope, ruleId: string) {
    const [rule] = await db
      .update(lateFeeRules)
      .set({ isActive: false })
      .where(
        and(
          eq(lateFeeRules.id, ruleId),
          scopeWhere(atSchoolLevel(scope), RULE_SCOPE),
        ),
      )
      .returning();
    return rule ?? null;
  }

  // -------------------------------------------------------------------------
  // Optional fee subscriptions
  // -------------------------------------------------------------------------

  /**
   * Subscribes a student to an opt-in service. The head must be ACTIVE and
   * `optional`-category: a subscription IS the opt-in, and a `regular` head
   * subscribed to would double-charge what the structure already bills. The
   * student re-read is school-level — subscriptions are office work, and the
   * school gate is what keeps another branch's student out.
   */
  async createSubscription(scope: DataScope, input: CreateSubscriptionInput, actorId: string) {
    const schoolId = requireSchoolId(scope);

    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)),
      );
    if (!student) {
      throw refuse("BAD_REQUEST", "Student not found in this school.");
    }

    const [head] = await db
      .select({ id: feeHeads.id, category: feeHeads.category })
      .from(feeHeads)
      .where(
        and(
          eq(feeHeads.id, input.feeHeadId),
          eq(feeHeads.schoolId, schoolId),
          eq(feeHeads.isActive, true),
        ),
      );
    if (!head) {
      throw refuse("NOT_FOUND", "Fee head not found in this school.");
    }
    if (head.category !== "optional") {
      throw refuse("BAD_REQUEST", "Only optional-category fee heads can be subscribed to.");
    }

    await assertSessionOpen(db, input.academicYearId);
    const [running] = await db
      .select({ id: studentOptionalFeeSubscriptions.id })
      .from(studentOptionalFeeSubscriptions)
      .where(
        and(
          eq(studentOptionalFeeSubscriptions.studentId, input.studentId),
          eq(studentOptionalFeeSubscriptions.academicYearId, input.academicYearId),
          eq(studentOptionalFeeSubscriptions.feeHeadId, input.feeHeadId),
          eq(studentOptionalFeeSubscriptions.status, "active"),
        ),
      );
    if (running) {
      throw refuse("CONFLICT", "This student is already on this service.");
    }

    return db.transaction(async (tx) => {
      const [subscription] = await tx
        .insert(studentOptionalFeeSubscriptions)
        .values({
          ...input,
          organizationId: scope.organizationId,
          schoolId,
          createdBy: actorId,
        })
        .returning();

      if (!subscription) {
        throw new Error("Failed to create subscription.");
      }

      // Coming back to a service: its cancelled months in the new window are
      // owed again, at the new price. Months with money on them stay as they are.
      const [assignment] = await tx
        .select({ id: studentFeeAssignments.id })
        .from(studentFeeAssignments)
        .where(
          and(
            eq(studentFeeAssignments.studentId, input.studentId),
            eq(studentFeeAssignments.academicYearId, input.academicYearId),
          ),
        );
      if (assignment) {
        await tx
          .update(feeInstallments)
          .set({
            paymentStatus: "unpaid",
            amount: subscription.monthlyAmount,
            concessionAmount: "0",
            netAmount: subscription.monthlyAmount,
            paidAmount: "0",
          })
          .where(
            and(
              eq(feeInstallments.studentFeeAssignmentId, assignment.id),
              eq(feeInstallments.feeHeadId, input.feeHeadId),
              eq(feeInstallments.paymentStatus, "cancelled"),
              gte(feeInstallments.dueDate, subscription.subscribedFrom),
              subscription.subscribedTo
                ? lte(feeInstallments.dueDate, subscription.subscribedTo)
                : undefined,
            ),
          );
      }
      return subscription;
    });
  }

  /**
   * A student's (or the school's) subscriptions for a year. `includeHistory`
   * REQUIRED — the year edge applies (ADR-024).
   */
  async listSubscriptions(
    scopes: DataScope[],
    academicYearId: string,
    includeHistory: boolean,
    studentId?: string,
  ) {
    return db
      .select()
      .from(studentOptionalFeeSubscriptions)
      .innerJoin(
        academicYears,
        eq(academicYears.id, studentOptionalFeeSubscriptions.academicYearId),
      )
      .where(
        and(
          scopeWhere(scopes.map(atSchoolLevel), SUBSCRIPTION_SCOPE),
          eq(studentOptionalFeeSubscriptions.academicYearId, academicYearId),
          studentId
            ? eq(studentOptionalFeeSubscriptions.studentId, studentId)
            : undefined,
          yearVisibilityWhere(includeHistory),
        ),
      )
      .then((rows) => rows.map((row) => row.student_optional_fee_subscriptions));
  }

  /** Stopping a service also stops its future months that were already created. */
  async cancelSubscription(scope: DataScope, subscriptionId: string) {
    return db.transaction(async (tx) => {
      const [subscription] = await tx
        .update(studentOptionalFeeSubscriptions)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(studentOptionalFeeSubscriptions.id, subscriptionId),
            scopeWhere(atSchoolLevel(scope), SUBSCRIPTION_SCOPE),
          ),
        )
        .returning();
      if (!subscription) return null;
      const [assignment] = await tx
        .select({ id: studentFeeAssignments.id })
        .from(studentFeeAssignments)
        .where(
          and(
            eq(studentFeeAssignments.studentId, subscription.studentId),
            eq(studentFeeAssignments.academicYearId, subscription.academicYearId),
          ),
        );
      if (assignment) {
        await tx
          .update(feeInstallments)
          .set({ paymentStatus: "cancelled" })
          .where(
            and(
              eq(feeInstallments.studentFeeAssignmentId, assignment.id),
              eq(feeInstallments.feeHeadId, subscription.feeHeadId),
              eq(feeInstallments.paymentStatus, "unpaid"),
              eq(feeInstallments.paidAmount, "0"),
              gt(feeInstallments.dueDate, todayInIst()),
            ),
          );
      }
      return subscription;
    });
  }

  // -------------------------------------------------------------------------
  // Fee concessions
  // -------------------------------------------------------------------------

  /**
   * A concession is a rule applied to each due it covers. When it is created it
   * fixes which periods it covers: dues already paid are left out, because money
   * received is not renegotiated. Applying it is part of adding it, in one
   * transaction, so a student never has a recorded concession and unchanged dues.
   *
   * `concession_amount` is what was actually applied, so the screen can say so.
   */
  async createConcession(
    scope: DataScope,
    assignmentId: string,
    input: CreateConcessionInput,
    actorId: string,
  ) {
    const schoolId = requireSchoolId(scope);

    return db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(studentFeeAssignments)
        .where(
          and(
            eq(studentFeeAssignments.id, assignmentId),
            eq(studentFeeAssignments.schoolId, schoolId),
          ),
        );
      if (!assignment) {
        throw refuse("NOT_FOUND", "Fee assignment not found in this school.");
      }
      await assertSessionOpen(tx, assignment.academicYearId);

      const existing = await tx
        .select({
          feeHeadId: feeInstallments.feeHeadId,
          periodKey: feeInstallments.periodKey,
          amount: feeInstallments.amount,
          paidAmount: feeInstallments.paidAmount,
          paymentStatus: feeInstallments.paymentStatus,
        })
        .from(feeInstallments)
        .where(eq(feeInstallments.studentFeeAssignmentId, assignment.id));

      const frozen = new Set(
        existing
          .filter((row) => row.paymentStatus !== "unpaid" || toCents(row.paidAmount) !== 0n)
          .map((row) => concessionKey(row.feeHeadId, row.periodKey)),
      );

      const plan = await feesBillingService.planFor(tx, assignment);
      if (input.feeHeadId && !plan.some((due) => due.feeHeadId === input.feeHeadId)) {
        throw refuse(
          "BAD_REQUEST",
          "That fee head is not part of the assigned structure, so the concession has nothing to apply to.",
        );
      }

      const coveredPeriods = coveredPeriodsFor(plan, frozen, {
        feeHeadId: input.feeHeadId ?? null,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
      });
      if (coveredPeriods.length === 0) {
        throw refuse(
          "CONFLICT",
          "Nothing is left for this concession to apply to: those dues are already paid or fall outside its dates.",
        );
      }

      const amounts = new Map(
        plan.map((due) => [concessionKey(due.feeHeadId, due.periodKey), due.amountCents]),
      );
      for (const row of existing) {
        amounts.set(concessionKey(row.feeHeadId, row.periodKey), toCents(row.amount));
      }
      const coveredTotal = coveredPeriods.reduce((acc, key) => acc + (amounts.get(key) ?? 0n), 0n);
      const valueCents = toCents(input.value);
      if (input.calculationType === "flat" && valueCents > coveredTotal) {
        throw refuse(
          "BAD_REQUEST",
          `The concession cannot exceed what is left to pay on those dues. The most it can be is ${fromCents(coveredTotal)}.`,
        );
      }
      if (input.calculationType === "percentage" && valueCents > 10000n) {
        throw refuse("BAD_REQUEST", "A percentage concession can be at most 100%.");
      }

      const appliedCents = [
        ...concessionShares(
          [{ calculationType: input.calculationType, valueCents, coveredPeriods }],
          coveredPeriods.map((key) => ({ key, amountCents: amounts.get(key) ?? 0n })),
        ).values(),
      ].reduce((acc, part) => acc + part, 0n);

      const [concession] = await tx
        .insert(feeConcessions)
        .values({
          ...input,
          organizationId: scope.organizationId,
          schoolId,
          studentFeeAssignmentId: assignmentId,
          concessionAmount: fromCents(appliedCents),
          coveredPeriods,
          approvedBy: actorId,
          approvedAt: new Date(),
          createdBy: actorId,
        })
        .returning();

      if (!concession) {
        throw new Error("Failed to create concession.");
      }

      await feesBillingService.recomputeAssignmentConcessions(scope, assignmentId, tx);
      return concession;
    });
  }

  /**
   * Withdraws a concession given by mistake. Dues not yet paid go back to their
   * full amount; money already received against a reduced due is left alone.
   */
  async voidConcession(
    scope: DataScope,
    concessionId: string,
    reason: string,
    actorId: string,
  ) {
    return db.transaction(async (tx) => {
      const [concession] = await tx
        .update(feeConcessions)
        .set({
          status: "void",
          voidedAt: new Date(),
          voidedBy: actorId,
          voidReason: reason,
        })
        .where(
          and(
            eq(feeConcessions.id, concessionId),
            eq(feeConcessions.status, "active"),
            scopeWhere(atSchoolLevel(scope), CONCESSION_SCOPE),
          ),
        )
        .returning();
      if (!concession) {
        throw refuse("NOT_FOUND", "That concession could not be found, or was already withdrawn.");
      }
      await feesBillingService.recomputeAssignmentConcessions(
        scope,
        concession.studentFeeAssignmentId,
        tx,
      );
      return concession;
    });
  }

  async listConcessions(scope: DataScope, assignmentId: string) {
    return db
      .select()
      .from(feeConcessions)
      .where(
        and(
          eq(feeConcessions.studentFeeAssignmentId, assignmentId),
          scopeWhere(atSchoolLevel(scope), CONCESSION_SCOPE),
        ),
      )
      .orderBy(asc(feeConcessions.createdAt));
  }
}

export const feesService = new FeesService();
