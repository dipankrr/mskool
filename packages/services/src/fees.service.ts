import {
  atSchoolLevel,
  requireSchoolId,
  yearVisibilityWhere,
} from "./academic.service";
import { fromCents, toCents } from "./fees-maths";
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
  feeStructureLines,
  feeStructures,
  lateFeeRules,
  studentFeeAssignments,
  studentOptionalFeeSubscriptions,
  students,
} from "@repo/db/schema";
import { and, asc, eq } from "drizzle-orm";

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
   * service refuses for the same shape. The one-per-class+year uniqueness is
   * `fee_structures_class_year_uq` (ADR-022).
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
   * Deactivation, never delete (hard rule 2): assignments snapshot FROM a
   * structure and the snapshot's FK must keep resolving.
   */
  async deactivateFeeStructure(scope: DataScope, structureId: string) {
    const [structure] = await db
      .update(feeStructures)
      .set({ isActive: false })
      .where(
        and(
          eq(feeStructures.id, structureId),
          scopeWhere(atSchoolLevel(scope), STRUCTURE_SCOPE),
        ),
      )
      .returning();
    return structure ?? null;
  }

  // -------------------------------------------------------------------------
  // Fee structure lines
  // -------------------------------------------------------------------------

  /**
   * Adds a head to a structure. The parent structure and the head are both
   * re-read in scope — a head of the OTHER branch is indistinguishable from a
   * nonexistent one. The head must also be ACTIVE: adding a retired head to a
   * new structure is a data-entry accident, not history-writing.
   */
  async createFeeStructureLine(
    scope: DataScope,
    structureId: string,
    input: CreateFeeStructureLineInput,
    actorId: string,
  ) {
    const schoolId = requireSchoolId(scope);

    const [structure] = await db
      .select({ id: feeStructures.id })
      .from(feeStructures)
      .where(
        and(
          eq(feeStructures.id, structureId),
          eq(feeStructures.schoolId, schoolId),
        ),
      );
    if (!structure) {
      throw new Error("Fee structure not found in this school.");
    }

    const [head] = await db
      .select({ id: feeHeads.id })
      .from(feeHeads)
      .where(
        and(
          eq(feeHeads.id, input.feeHeadId),
          eq(feeHeads.schoolId, schoolId),
          eq(feeHeads.isActive, true),
        ),
      );
    if (!head) {
      throw new Error("Fee head not found in this school.");
    }

    const [line] = await db
      .insert(feeStructureLines)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
        feeStructureId: structureId,
      })
      .returning();

    if (!line) {
      throw new Error("Failed to create fee structure line.");
    }
    return line;
  }

  async listFeeStructureLines(scope: DataScope, structureId: string) {
    return db
      .select()
      .from(feeStructureLines)
      .where(
        and(
          eq(feeStructureLines.feeStructureId, structureId),
          scopeWhere(atSchoolLevel(scope), LINE_SCOPE),
        ),
      )
      .orderBy(asc(feeStructureLines.createdAt));
  }

  async updateFeeStructureLine(
    scope: DataScope,
    lineId: string,
    input: UpdateFeeStructureLineInput,
  ) {
    const [line] = await db
      .update(feeStructureLines)
      .set(input)
      .where(
        and(
          eq(feeStructureLines.id, lineId),
          scopeWhere(atSchoolLevel(scope), LINE_SCOPE),
        ),
      )
      .returning();
    return line ?? null;
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
        throw new Error("Fee structure not found in this school.");
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
      throw new Error("Student not found in this school.");
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
      throw new Error("Fee head not found in this school.");
    }
    if (head.category !== "optional") {
      throw new Error("Only optional-category fee heads can be subscribed to.");
    }

    const [subscription] = await db
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
    return subscription;
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

  async cancelSubscription(scope: DataScope, subscriptionId: string) {
    const [subscription] = await db
      .update(studentOptionalFeeSubscriptions)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(studentOptionalFeeSubscriptions.id, subscriptionId),
          scopeWhere(atSchoolLevel(scope), SUBSCRIPTION_SCOPE),
        ),
      )
      .returning();
    return subscription ?? null;
  }

  // -------------------------------------------------------------------------
  // Fee concessions
  // -------------------------------------------------------------------------

  /**
   * Records a concession against an assignment and computes the AUDIT amount
   * in the same breath. Percentage rounds DOWN (integer paise, floor) — the
   * school never over-discounts by a rounding artefact. A named head
   * percentages against THAT head's line in the assignment's structure;
   * the all-heads form percentages against the assignment's snapshotted base.
   *
   * `approvedBy`/`approvedAt` are stamped from the caller's identity — the v1
   * stand-in for the (deferred) approval workflow: recording WHO granted the
   * discount is the part that cannot wait.
   */
  async createConcession(
    scope: DataScope,
    assignmentId: string,
    input: CreateConcessionInput,
    actorId: string,
  ) {
    const schoolId = requireSchoolId(scope);

    const [assignment] = await db
      .select({
        id: studentFeeAssignments.id,
        baseAnnualAmount: studentFeeAssignments.baseAnnualAmount,
        feeStructureId: studentFeeAssignments.feeStructureId,
      })
      .from(studentFeeAssignments)
      .where(
        and(
          eq(studentFeeAssignments.id, assignmentId),
          eq(studentFeeAssignments.schoolId, schoolId),
        ),
      );
    if (!assignment) {
      throw new Error("Fee assignment not found in this school.");
    }

    let baseCents: bigint;
    if (input.feeHeadId) {
      const [line] = await db
        .select({ annualAmount: feeStructureLines.annualAmount })
        .from(feeStructureLines)
        .where(
          and(
            eq(feeStructureLines.feeStructureId, assignment.feeStructureId),
            eq(feeStructureLines.feeHeadId, input.feeHeadId),
            eq(feeStructureLines.schoolId, schoolId),
          ),
        );
      if (!line) {
        throw new Error(
          "That fee head is not part of the assigned structure, so the concession has nothing to apply to.",
        );
      }
      baseCents = toCents(line.annualAmount);
    } else {
      baseCents = toCents(assignment.baseAnnualAmount);
    }

    const valueCents = toCents(input.value);
    const concessionCents =
      input.calculationType === "percentage"
        ? // floor(base × value / 100) in paise: base_cents × value_cents / 10⁴.
          (baseCents * valueCents) / 10000n
        : valueCents;

    if (concessionCents > baseCents) {
      throw new Error("The concession cannot exceed the amount it applies to.");
    }

    const [concession] = await db
      .insert(feeConcessions)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
        studentFeeAssignmentId: assignmentId,
        concessionAmount: fromCents(concessionCents),
        approvedBy: actorId,
        approvedAt: new Date(),
        createdBy: actorId,
      })
      .returning();

    if (!concession) {
      throw new Error("Failed to create concession.");
    }
    return concession;
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
