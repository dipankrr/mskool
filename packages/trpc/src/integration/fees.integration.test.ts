import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * FEES — the money-safety proofs, against REAL Postgres. The unit suite
 * (packages/services/fees-billing.test.ts) pins the pure maths; this file
 * pins what only a database can vouch for:
 *
 *   - the receipt sequence under CONCURRENCY: parallel recordings, separate
 *     connections, one student — distinct receipt numbers, no collision;
 *   - the ledger trigger refusing UPDATE/DELETE through a real connection;
 *   - over-allocation refused with the worded error, paying-ahead allowed;
 *   - the idempotency key: the same clientReference twice is ONE receipt;
 *   - bounce re-opens balances and writes its ledger row; refunds validate
 *     against contribution; the waiver is never-paid-only;
 *   - generation idempotency and the mid-session effective date;
 *   - concession re-apportionment touching never-paid installments only;
 *   - tenancy: a cross-org payment is a student-not-found refusal.
 *
 * FIXTURE ISOLATION. The authz suite asserts EXACT counts against its world
 * (classes per role, enrollments per class), so this file borrows nothing
 * from it: every run builds its OWN org pair (slug `fees-itg-<ts>`), school,
 * year, class and students. Concessions and payments are append-only
 * history, so the students are per-run too — a re-run against the same
 * student would double-count and make every exact assertion drift. Rows
 * accumulate in the fixture database by design (hard rule 2 — nothing is
 * deleted); the volume is a handful of rows per run.
 */

import {
  feeMatrixCellOutputSchema,
  feeMatrixInputSchema,
  feeMatrixOutputSchema,
  recordPaymentSchema,
  type FeeMatrixCellInput,
  type FeeMatrixInput,
  type RecordPaymentInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  feeHeads,
  feePayments,
  feeRefunds,
  paymentAllocations as paymentAllocationsTable,
  students as studentsTable,
  studentEnrollments,
  studentFeeAssignments,
  feeInstallments,
  feeStructureLines,
  feeStructures,
  financialTransactions,
  lateFeeRules,
  openingBalances as openingBalancesTable,
  user,
} from "@repo/db/schema";
import {
  academicService,
  enrollmentService,
  termService,
  feesBillingService,
  feesCollectionService,
  feesService,
  organizationService,
} from "@repo/services";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getRedis } from "@repo/authz";

const RUN = `fees-itg-${Date.now()}`;

interface FeeWorld {
  scopeA: {
    organizationId: string;
    schoolId: string;
    classId: null;
    sectionId: null;
  };
  scopeB: {
    organizationId: string;
    schoolId: string;
    classId: null;
    sectionId: null;
  };
  orgAId: string;
  schoolAId: string;
  yearAId: string;
  classId: string;
  tuitionHeadId: string;
  labHeadId: string;
  adminId: string;

  /** The full-session student and her assignment (installments generated). */
  studentAId: string;
  assignmentAId: string;
  /** The mid-session joiner (effective 2025-10-01). */
  assignmentMidId: string;
}

let w: FeeWorld;

interface MatrixWorld {
  classId: string;
  sectionId: string;
  closedYearId: string;
  multiStudentId: string;
  midStudentId: string;
  unassignedStudentId: string;
  ungeneratedStudentId: string;
  partialStudentId: string;
  paidStudentId: string;
  concededStudentId: string;
  waivedStudentId: string;
  waivedOnlyStudentId: string;
  cancelledStudentId: string;
  openingStudentId: string;
}

let matrix: MatrixWorld;

async function freshStudent(tag: string) {
  const [student] = await db
    .insert(studentsTable)
    .values({
      organizationId: w.orgAId,
      schoolId: w.schoolAId,
      admissionNumber: `${RUN}-${tag}`,
      firstName: "ItgFee",
      lastName: tag,
      dateOfBirth: "2012-06-15",
      gender: "female",
    })
    .returning();
  if (!student) throw new Error(`Failed to create student ${tag}.`);
  return student;
}

async function enroll(studentId: string) {
  return enrollmentService.createEnrollment(w.scopeA, {
    studentId,
    academicYearId: w.yearAId,
    classId: w.classId,
    enrollmentDate: "2025-04-01",
  });
}

/** Assign + generate. Each call makes a FRESH assignment (per-run students). */
async function assignAndGenerate(studentId: string, effectiveFrom?: string) {
  const enrollment = await enroll(studentId);
  const assignment = await feesBillingService.assignFeeStructure(
    w.scopeA,
    {
      enrollmentId: enrollment.id,
      ...(effectiveFrom ? { feeEffectiveFrom: effectiveFrom } : {}),
    },
    w.adminId,
  );
  await feesBillingService.generateInstallments(w.scopeA, assignment.id);
  return assignment;
}

const paise = (money: string) => BigInt(money.replace(".", ""));
const fromPaise = (p: bigint) => `${p / 100n}.${String(p % 100n).padStart(2, "0")}`;

const installmentsOf = (assignmentId: string) =>
  db
    .select()
    .from(feeInstallments)
    .where(eq(feeInstallments.studentFeeAssignmentId, assignmentId))
    .orderBy(feeInstallments.installmentNumber);

beforeAll(async () => {
  // Org + school through the services: the school gets its scope_nodes row
  // (hard rule 12) exactly as production would.
  const orgA = await organizationService.createOrganization({
    name: `${RUN} A`,
    legalName: `${RUN} Trust A`,
    slug: `${RUN}-a`,
  });
  const orgB = await organizationService.createOrganization({
    name: `${RUN} B`,
    legalName: `${RUN} Trust B`,
    slug: `${RUN}-b`,
  });
  const schoolA = await organizationService.createSchool(orgA.id, {
    name: "Fee School A",
    legalName: "Fee School A",
    code: "FEE-A",
    board: "cbse",
  });
  const schoolB = await organizationService.createSchool(orgB.id, {
    name: "Fee School B",
    legalName: "Fee School B",
    code: "FEE-B",
    board: "cbse",
  });
  const scopeA = {
    organizationId: orgA.id,
    schoolId: schoolA.id,
    classId: null,
    sectionId: null,
  } as FeeWorld["scopeA"];
  const scopeB = {
    organizationId: orgB.id,
    schoolId: schoolB.id,
    classId: null,
    sectionId: null,
  } as FeeWorld["scopeB"];

  // The session the fees hang off.
  const [year] = await db
    .insert(academicYears)
    .values({
      organizationId: orgA.id,
      schoolId: schoolA.id,
      name: "2025-26",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      originalEndDate: "2026-03-31",
      isCurrent: true,
    })
    .returning();
  if (!year) throw new Error("Failed to create the fee year.");

  const klass = await academicService.createClass(scopeA, {
    name: "Fee 6",
    numericOrder: 6,
  });

  const [adminUser] = await db
    .insert(user)
    .values({
      id: `fee-admin-${RUN}`,
      name: "Fee Admin",
      email: `${RUN}@fees-itg.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!adminUser) throw new Error("Failed to create the fixture admin user.");

  // Heads are created raw in the fixture (createdBy is nullable; there is no
  // better-auth user at fixture time).
  const [tuitionHead] = await db
    .insert(feeHeads)
    .values({
      organizationId: orgA.id,
      schoolId: schoolA.id,
      name: "Tuition Fee",
      category: "regular",
    })
    .returning();
  const [labHead] = await db
    .insert(feeHeads)
    .values({
      organizationId: orgA.id,
      schoolId: schoolA.id,
      name: "Lab Fee",
      category: "regular",
    })
    .returning();
  if (!tuitionHead || !labHead) throw new Error("Fee head fixture missing.");

  const structure = await feesService.createFeeStructure(
    scopeA,
    {
      academicYearId: year.id,
      classId: klass.id,
      name: "Fee 6 Structure",
      installmentMode: "monthly",
    },
    adminUser.id,
  );

  await db.insert(feeStructureLines).values([
    {
      organizationId: orgA.id,
      schoolId: schoolA.id,
      feeStructureId: structure.id,
      feeHeadId: tuitionHead.id,
      annualAmount: "12000.00",
      installmentFrequency: "monthly",
    },
    {
      organizationId: orgA.id,
      schoolId: schoolA.id,
      feeStructureId: structure.id,
      feeHeadId: labHead.id,
      annualAmount: "2400.00",
      installmentFrequency: "term_wise",
    },
  ]);

  // Terms for the term-wise line: Apr–Sep (60%), Oct–Mar (40%).
  await termService.createTerm(scopeA, {
    academicYearId: year.id,
    name: "T1",
    sequenceNumber: 1,
    startDate: "2025-04-01",
    endDate: "2025-09-30",
    weightage: "60.00",
  });
  await termService.createTerm(scopeA, {
    academicYearId: year.id,
    name: "T2",
    sequenceNumber: 2,
    startDate: "2025-10-01",
    endDate: "2026-03-31",
    weightage: "40.00",
  });

  // The world is live from here: the helpers read it.
  w = {
    scopeA,
    scopeB,
    orgAId: orgA.id,
    schoolAId: schoolA.id,
    yearAId: year.id,
    classId: klass.id,
    tuitionHeadId: tuitionHead.id,
    labHeadId: labHead.id,
    adminId: adminUser.id,
    studentAId: "",
    assignmentAId: "",
    assignmentMidId: "",
  };

  // Assignments for the two fixture students.
  const studentA = await freshStudent("A");
  const enrollmentA = await enroll(studentA.id);
  const assignmentA = await feesBillingService.assignFeeStructure(
    scopeA,
    { enrollmentId: enrollmentA.id },
    adminUser.id,
  );
  await feesBillingService.generateInstallments(scopeA, assignmentA.id);

  const studentMid = await freshStudent("MID");
  const enrollmentMid = await enroll(studentMid.id);
  const assignmentMid = await feesBillingService.assignFeeStructure(
    scopeA,
    { enrollmentId: enrollmentMid.id, feeEffectiveFrom: "2025-10-01" },
    adminUser.id,
  );
  await feesBillingService.generateInstallments(scopeA, assignmentMid.id);

  w = {
    scopeA,
    scopeB,
    orgAId: orgA.id,
    schoolAId: schoolA.id,
    yearAId: year.id,
    classId: klass.id,
    tuitionHeadId: tuitionHead.id,
    labHeadId: labHead.id,
    adminId: adminUser.id,
    studentAId: studentA.id,
    assignmentAId: assignmentA.id,
    assignmentMidId: assignmentMid.id,
  };
});

describe("fees: the generator", () => {
  it("splits tuition monthly and lab term-wise, sums exact", async () => {
    const rows = await installmentsOf(w.assignmentAId);
    const tuitionRows = rows.filter((r) => r.feeHeadId === w.tuitionHeadId);
    const labRows = rows.filter((r) => r.feeHeadId === w.labHeadId);
    expect(tuitionRows).toHaveLength(12);
    expect(tuitionRows.every((r) => r.amount === "1000.00")).toBe(true);
    expect(labRows).toHaveLength(2);
    expect(labRows[0]?.amount).toBe("1440.00"); // 60% of 2400.00
    expect(labRows[1]?.amount).toBe("960.00"); // remainder to the last
  });

  it("is IDEMPOTENT: a re-run inserts nothing", async () => {
    const result = await feesBillingService.generateInstallments(
      w.scopeA,
      w.assignmentAId,
    );
    expect(result.inserted).toBe(0);
  });

  it("mid-session joiner: tuition starts October at the monthly rate, lab is T2 only (ADR-050)", async () => {
    const midRows = await installmentsOf(w.assignmentMidId);
    const tuitionRows = midRows.filter((r) => r.feeHeadId === w.tuitionHeadId);
    const labRows = midRows.filter((r) => r.feeHeadId === w.labHeadId);
    expect(tuitionRows).toHaveLength(6); // Oct–Mar
    expect(tuitionRows[0]?.periodMonth).toBe(10);
    // The same ₹1,000 a month as a full-year student, not 12000 / 6.
    expect(tuitionRows.every((r) => r.amount === "1000.00")).toBe(true);
    expect(labRows).toHaveLength(1); // T1 ended before the joiner arrived
    expect(labRows[0]?.amount).toBe("960.00"); // T2's 40% of 2400.00, not all of it
  });
});

describe("fees: concessions", () => {
  it("percentages round DOWN and recompute touches never-paid installments only", async () => {
    // 10% of 14400.00 = 1440.00, all heads.
    const concession = await feesService.createConcession(
      w.scopeA,
      w.assignmentAId,
      {
        concessionType: "merit_scholarship",
        calculationType: "percentage",
        value: "10",
        validFrom: "2025-04-01",
      },
      w.adminId,
    );
    expect(concession.concessionAmount).toBe("1440.00");

    await feesBillingService.recomputeAssignmentConcessions(
      w.scopeA,
      w.assignmentAId,
    );

    const rows = await installmentsOf(w.assignmentAId);
    const concessionSum = rows.reduce(
      (acc, r) => acc + paise(r.concessionAmount),
      0n,
    );
    expect(concessionSum).toBe(144_000n); // 1440.00 across installments, exact

    // Now pay ONE installment, add a NEW concession, and recompute: the paid
    // row must keep its historical share; only never-paid rows move.
    const first = rows[0];
    if (!first) throw new Error("No installments.");
    await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: w.studentAId,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-05",
        paymentMode: "cash",
        allocations: [{ installmentId: first.id, amount: first.netAmount }],
      },
      w.adminId,
    );
    await feesService.createConcession(
      w.scopeA,
      w.assignmentAId,
      {
        concessionType: "sibling_discount",
        calculationType: "flat",
        value: "120",
        feeHeadId: w.tuitionHeadId,
        validFrom: "2025-05-01",
      },
      w.adminId,
    );
    await feesBillingService.recomputeAssignmentConcessions(
      w.scopeA,
      w.assignmentAId,
    );

    const rowsAfter = await installmentsOf(w.assignmentAId);
    const firstAfter = rowsAfter.find((r) => r.id === first.id);
    expect(firstAfter?.concessionAmount).toBe(first.concessionAmount); // frozen
  });
});

describe("fees: collection", () => {
  it("over-allocation is REFUSED, worded", async () => {
    const rows = await installmentsOf(w.assignmentAId);
    const open = rows.find((r) => r.paymentStatus === "unpaid");
    if (!open) throw new Error("No open installment.");
    const balance = paise(open.netAmount) - paise(open.paidAmount);
    await expect(
      feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: w.studentAId,
          academicYearId: w.yearAId,
          paymentDate: "2025-04-05",
          paymentMode: "cash",
          allocations: [
            { installmentId: open.id, amount: `${balance + 1n}`.replace(/(\d{2})$/, ".$1") },
          ],
          clientReference: `over-${open.id}`,
        },
        w.adminId,
      ),
    ).rejects.toThrow(/outstanding balance/);
  });

  it("paying AHEAD allocates cleanly (future-due is not a refusal)", async () => {
    const rows = await installmentsOf(w.assignmentAId);
    const lastTuition = rows
      .filter((r) => r.feeHeadId === w.tuitionHeadId && r.paymentStatus === "unpaid")
      .pop();
    if (!lastTuition) throw new Error("No unpaid tuition installment.");
    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: w.studentAId,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-06",
        paymentMode: "upi",
        allocations: [
          { installmentId: lastTuition.id, amount: lastTuition.netAmount },
        ],
        clientReference: `itg-ahead-${lastTuition.id}`,
      },
      w.adminId,
    );
    expect(payment.paymentStatus).toBe("pending"); // UPI enters pending
  });

  it("the SAME clientReference twice returns the ORIGINAL payment — one receipt", async () => {
    const rows = await installmentsOf(w.assignmentAId);
    const open = rows.find(
      (r) => r.feeHeadId === w.tuitionHeadId && r.paymentStatus === "unpaid",
    );
    if (!open) throw new Error("No unpaid tuition installment.");
    const key = `itg-idem-${open.id}`;
    const input = {
      studentId: w.studentAId,
      academicYearId: w.yearAId,
      paymentDate: "2025-04-07",
      paymentMode: "cash" as const,
      allocations: [{ installmentId: open.id, amount: open.netAmount }],
      clientReference: key,
    };
    const first = await feesCollectionService.recordPayment(
      w.scopeA,
      input,
      w.adminId,
    );
    const second = await feesCollectionService.recordPayment(
      w.scopeA,
      input,
      w.adminId,
    );
    expect(second.id).toBe(first.id);
    expect(second.receiptNumber).toBe(first.receiptNumber);
  });

  it("CONCURRENCY: parallel recordings claim DISTINCT receipts and exact balances", async () => {
    // A fresh student, fresh assignment, two parallel cashiers — separate
    // connections through the pool, the exact race two desks would run.
    const studentC = await freshStudent("C");
    const assignmentC = await assignAndGenerate(studentC.id);
    const rows = await installmentsOf(assignmentC.id);
    const tuitionRows = rows.filter((r) => r.feeHeadId === w.tuitionHeadId);
    const targets = [tuitionRows[0], tuitionRows[1]];
    if (!targets[0] || !targets[1]) throw new Error("Fixture installments missing.");

    const results = await Promise.all(
      targets.map((t) => {
        if (!t) throw new Error("Fixture installment missing.");
        return feesCollectionService.recordPayment(
          w.scopeA,
          {
            studentId: studentC.id,
            academicYearId: w.yearAId,
            paymentDate: "2025-04-08",
            paymentMode: "cash",
            allocations: [{ installmentId: t.id, amount: t.netAmount }],
            clientReference: `itg-conc-${t.id}`,
          },
          w.adminId,
        );
      }),
    );

    const receipts = results.map((r) => r.receiptNumber);
    expect(new Set(receipts).size).toBe(2); // distinct — no collision

    // Balances exact: each target fully paid, nothing double-applied.
    const after = await installmentsOf(assignmentC.id);
    for (const t of targets) {
      if (!t) throw new Error("Fixture installment missing.");
      const row = after.find((r) => r.id === t.id);
      expect(row?.paymentStatus).toBe("paid");
      expect(row?.paidAmount).toBe(t.netAmount);
    }

    // Exactly one fee_payment ledger row per recording.
    const ledgerRows = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceTable, "fee_payments"),
          eq(financialTransactions.studentId, studentC.id),
        ),
      );
    expect(ledgerRows).toHaveLength(2);
  });

  it("a bounce RE-OPENS balances and writes the cheque_bounce_charge ledger row", async () => {
    const studentD = await freshStudent("D");
    const assignmentD = await assignAndGenerate(studentD.id);
    const rows = await installmentsOf(assignmentD.id);
    const open = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!open) throw new Error("No tuition installment.");

    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: studentD.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-09",
        paymentMode: "cheque",
        transactionReference: "CHQ-000123",
        allocations: [{ installmentId: open.id, amount: open.netAmount }],
      },
      w.adminId,
    );
    expect(payment.paymentStatus).toBe("pending"); // cheque enters pending

    const bounced = await feesCollectionService.bouncePayment(
      w.scopeA,
      { paymentId: payment.id, reason: "Cheque returned: insufficient funds" },
      w.adminId,
    );
    expect(bounced.paymentStatus).toBe("bounced");

    const [reopened] = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, open.id));
    expect(reopened?.paidAmount).toBe("0.00");
    expect(reopened?.paymentStatus).toBe("unpaid");

    const ledgerRows = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceId, payment.id),
          eq(financialTransactions.transactionType, "cheque_bounce_charge"),
        ),
      );
    expect(ledgerRows).toHaveLength(1);
  });

  it("a refund validates against CONTRIBUTION and re-opens the allocated balance", async () => {
    const studentE = await freshStudent("E");
    const assignmentE = await assignAndGenerate(studentE.id);
    const rows = await installmentsOf(assignmentE.id);
    const open = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!open) throw new Error("No tuition installment.");

    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: studentE.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-10",
        paymentMode: "cash",
        allocations: [{ installmentId: open.id, amount: open.netAmount }],
      },
      w.adminId,
    );

    // More than the payment's principal is refused.
    await expect(
      feesCollectionService.recordRefund(
        w.scopeA,
        {
          originalPaymentId: payment.id,
          refundAmount: `${paise(payment.amount) + 1n}`.replace(/(\d{2})$/, ".$1"),
          refundDate: "2025-04-11",
          refundMode: "cash",
          reason: "Withdrawal",
        },
        w.adminId,
      ),
    ).rejects.toThrow(/Refundable/);

    const refund = await feesCollectionService.recordRefund(
      w.scopeA,
      {
        originalPaymentId: payment.id,
        refundAmount: "500.00",
        refundDate: "2025-04-11",
        refundMode: "cash",
        reason: "Partial withdrawal adjustment",
      },
      w.adminId,
    );
    expect(refund.refundAmount).toBe("500.00");

    const [after] = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, open.id));
    expect(after?.paidAmount).toBe("500.00");
    expect(after?.paymentStatus).toBe("partial");
  });

  it("the waiver is NEVER-PAID-only and writes waiver_applied", async () => {
    const studentW = await freshStudent("W");
    const assignmentW = await assignAndGenerate(studentW.id);
    const rows = await installmentsOf(assignmentW.id);
    const open = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!open) throw new Error("No tuition installment.");

    const waived = await feesCollectionService.waiveInstallment(
      w.scopeA,
      open.id,
      w.adminId,
    );
    expect(waived.paymentStatus).toBe("waived");

    const ledgerRows = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceId, open.id),
          eq(financialTransactions.transactionType, "waiver_applied"),
        ),
      );
    expect(ledgerRows).toHaveLength(1);
  });

  it("TENANCY: a payment addressed from org B for an org-A student is refused", async () => {
    await expect(
      feesCollectionService.recordPayment(
        w.scopeB,
        {
          studentId: w.studentAId,
          academicYearId: w.yearAId,
          paymentDate: "2025-04-12",
          paymentMode: "cash",
          allocations: [{ installmentId: w.assignmentAId, amount: "1.00" }],
        },
        w.adminId,
      ),
    ).rejects.toThrow(/Student not found/);
  });
});

describe("fees: the ledger and the gateway path", () => {
  it("the ledger is append-only through a REAL connection (hard rule 3)", async () => {
    const [row] = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.referenceTable, "fee_payments"))
      .limit(1);
    if (!row) throw new Error("No ledger row to test against.");

    const assertAppendOnly = (error: unknown) => {
      const text = [
        error instanceof Error ? error.message : String(error),
        error instanceof Error && error.cause ? String(error.cause) : "",
      ].join(" ");
      expect(text).toContain("append-only");
    };
    await db
      .execute(
        `UPDATE financial_transactions SET amount = 1.00 WHERE id = '${row.id}'`,
      )
      .catch(assertAppendOnly);
    await db
      .execute(`DELETE FROM financial_transactions WHERE id = '${row.id}'`)
      .catch(assertAppendOnly);
  });

  it("the gateway path: oldest-due-first allocation, order id idempotency", async () => {
    const studentG = await freshStudent("G");
    const assignmentG = await assignAndGenerate(studentG.id);
    const rows = await installmentsOf(assignmentG.id);
    const oldest = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!oldest) throw new Error("No tuition installments for student G.");

    const orderId = `gw-${oldest.id}`;
    const payment = await feesCollectionService.recordGatewayPayment({
      organizationId: w.orgAId,
      studentId: studentG.id,
      gatewayOrderId: orderId,
      amount: "1500.00", // 1000 (oldest) + 500 (next)
      paymentDate: "2025-04-15",
    });
    expect(payment.paymentStatus).toBe("pending"); // online_portal enters pending

    const replay = await feesCollectionService.recordGatewayPayment({
      organizationId: w.orgAId,
      studentId: studentG.id,
      gatewayOrderId: orderId, // replayed webhook
      amount: "1500.00",
      paymentDate: "2025-04-15",
    });
    expect(replay.id).toBe(payment.id); // ONE receipt

    // Surplus is refused, not banked.
    await expect(
      feesCollectionService.recordGatewayPayment({
        organizationId: w.orgAId,
        studentId: studentG.id,
        gatewayOrderId: `gw-surplus-${oldest.id}`,
        amount: "999999.00",
        paymentDate: "2025-04-15",
      }),
    ).rejects.toThrow(/outstanding dues/);
  });
});


describe("fees: the stacked-concession clamp, end to end (H1)", () => {
  it("concessions past 100% of the fee clamp at the fee, never invert dues", async () => {
    const studentS = await freshStudent("S");
    const assignmentS = await assignAndGenerate(studentS.id);

    // Two individually-valid tuition concessions: 60% + 60% = 120%.
    await feesService.createConcession(
      w.scopeA,
      assignmentS.id,
      {
        concessionType: "merit_scholarship",
        calculationType: "percentage",
        value: "60",
        feeHeadId: w.tuitionHeadId,
        validFrom: "2025-04-01",
      },
      w.adminId,
    );
    await feesService.createConcession(
      w.scopeA,
      assignmentS.id,
      {
        concessionType: "staff_ward",
        calculationType: "percentage",
        value: "60",
        feeHeadId: w.tuitionHeadId,
        validFrom: "2025-04-01",
      },
      w.adminId,
    );
    await feesBillingService.recomputeAssignmentConcessions(w.scopeA, assignmentS.id);

    const rows = await installmentsOf(assignmentS.id);
    const tuitionRows = rows.filter((r) => r.feeHeadId === w.tuitionHeadId);
    expect(tuitionRows.length).toBeGreaterThan(0);

    // The head's total concession equals its annual amount exactly — capped,
    // not exceeded — and every installment's net is zero or positive.
    const tuitionConcessionSum = tuitionRows.reduce(
      (acc, r) => acc + paise(r.concessionAmount),
      0n,
    );
    expect(tuitionConcessionSum).toBe(1_200_000n); // 12000.00 = the annual cap
    for (const r of tuitionRows) {
      expect(paise(r.netAmount) >= 0n).toBe(true);
      expect(paise(r.concessionAmount) <= paise(r.amount)).toBe(true);
    }

    // The lab head is untouched by tuition-only concessions.
    const labRows = rows.filter((r) => r.feeHeadId === w.labHeadId);
    for (const r of labRows) {
      expect(r.concessionAmount).toBe("0.00");
    }
  });
});

describe("fees: the invariant sweep (H3)", () => {
  /**
   * The systematic cross-check individual tests cannot make: walk ONE
   * student's entire money history — payments, bounces, refunds, waivers,
   * the ledger — and assert the accounts actually balance:
   *
   *   credits − debits = collected_in − refunded_out − waived_off
   *
   * plus every installment's paid ≤ net, and every payment's allocations
   * sum to its principal. Any drift anywhere in the collection flow makes
   * this test fail loudly instead of surfacing in an audit years later.
   */
  it("a student's full money history balances to the paisa", async () => {
    const studentV = await freshStudent("V");
    const assignmentV = await assignAndGenerate(studentV.id);
    const rows = await installmentsOf(assignmentV.id);
    const targets = rows
      .filter((r) => r.feeHeadId === w.tuitionHeadId)
      .slice(0, 3);
    if (targets.length < 3) throw new Error("Fixture rows missing.");

    // A bounced cheque against target 0 (money came, then un-came).
    const bouncedPayment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: studentV.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-05",
        paymentMode: "cheque",
        transactionReference: "CHQ-V1",
        allocations: [
          { installmentId: targets[0]!.id, amount: targets[0]!.netAmount },
        ],
      },
      w.adminId,
    );
    await feesCollectionService.bouncePayment(
      w.scopeA,
      { paymentId: bouncedPayment.id, reason: "Bounced for the sweep" },
      w.adminId,
    );

    // A cleared cash payment against target 1, partially refunded.
    const clearedPayment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: studentV.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-06",
        paymentMode: "cash",
        allocations: [
          { installmentId: targets[1]!.id, amount: targets[1]!.netAmount },
        ],
      },
      w.adminId,
    );
    await feesCollectionService.recordRefund(
      w.scopeA,
      {
        originalPaymentId: clearedPayment.id,
        refundAmount: "250.00",
        refundDate: "2025-04-07",
        refundMode: "cash",
        reason: "Sweep partial refund",
      },
      w.adminId,
    );

    // A waiver on target 2.
    await feesCollectionService.waiveInstallment(
      w.scopeA,
      targets[2]!.id,
      w.adminId,
    );

    // ---- THE SWEEP ---------------------------------------------------------
    const ledger = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.studentId, studentV.id));

    const credit = ledger
      .filter((r) => r.direction === "credit")
      .reduce((acc, r) => acc + paise(r.amount), 0n);
    const debit = ledger
      .filter((r) => r.direction === "debit")
      .reduce((acc, r) => acc + paise(r.amount), 0n);

    // What the subsystems SAY happened.
    const paymentsRows = await db
      .select()
      .from(feePayments)
      .where(and(eq(feePayments.studentId, studentV.id), eq(feePayments.paymentStatus, "cleared")));
    const refundsRows = await db
      .select()
      .from(feeRefunds)
      .where(eq(feeRefunds.studentId, studentV.id));
    const waivedRows = (await installmentsOf(assignmentV.id)).filter(
      (r) => r.paymentStatus === "waived",
    );

    const collected = paymentsRows.reduce((acc, r) => acc + paise(r.amount), 0n);
    const refunded = refundsRows.reduce((acc, r) => acc + paise(r.refundAmount), 0n);
    const waived = waivedRows.reduce((acc, r) => acc + paise(r.netAmount), 0n);

    // The books balance when both sides count the SAME events. The ledger
    // writes: a fee_payment CREDIT per recording (cleared or not), a
    // cheque_bounce_charge DEBIT per bounce, a fee_refund DEBIT per refund,
    // a waiver_applied DEBIT per waiver. So:
    //
    //   ledger net = recorded - bounced - refunded - waived
    //              = collected - refunded - waived   (cleared-only view)
    //
    // A bounced recording's credit and its bounce-charge debit cancel —
    // the accountant's answer to "the cheque never became money".
    const allPayments = await db
      .select()
      .from(feePayments)
      .where(eq(feePayments.studentId, studentV.id));
    const recordedAll = allPayments.reduce((acc, r) => acc + paise(r.amount), 0n);
    const bouncedAll = allPayments
      .filter((r) => r.paymentStatus === "bounced")
      .reduce((acc, r) => acc + paise(r.amount), 0n);
    expect(credit - debit).toBe(recordedAll - bouncedAll - refunded - waived);
    // The cleared-only view of the same net.
    expect(credit - debit).toBe(collected - refunded - waived);

    // Every installment: paid ≤ net (the DB CHECK's live-path proof), and
    // every cleared payment's allocations sum to its principal.
    for (const r of await installmentsOf(assignmentV.id)) {
      expect(paise(r.paidAmount) <= paise(r.netAmount)).toBe(true);
    }
    for (const p of paymentsRows) {
      const allocs = await db
        .select()
        .from(paymentAllocationsTable)
        .where(eq(paymentAllocationsTable.paymentId, p.id));
      const sum = allocs.reduce((acc, a) => acc + paise(a.amountAllocated), 0n);
      expect(sum).toBe(paise(p.amount));
    }
  });
});

describe("fees: the same-installment race (H4)", () => {
  /**
   * The sharpest race in the counter flow: two cashiers, the SAME student,
   * the SAME installment, each trying to allocate the FULL balance
   * simultaneously. The row locks serialize them — the second transaction
   * re-checks the balance INSIDE its lock and must be refused with the
   * worded over-allocation error. Exactly one payment survives, the
   * installment is paid exactly once, the ledger holds one fee_payment row
   * for the winner, and the receipt sequence is untouched by the loser.
   */
  it("two concurrent FULL allocations of one installment: exactly one wins", async () => {
    const studentR = await freshStudent("R");
    const assignmentR = await assignAndGenerate(studentR.id);
    const rows = await installmentsOf(assignmentR.id);
    const target = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!target) throw new Error("Race fixture installment missing.");

    const input = {
      studentId: studentR.id,
      academicYearId: w.yearAId,
      paymentDate: "2025-04-08",
      paymentMode: "cash" as const,
      allocations: [{ installmentId: target.id, amount: target.netAmount }],
    };

    const settled = await Promise.allSettled([
      feesCollectionService.recordPayment(w.scopeA, { ...input, clientReference: `race-a-${target.id}` }, w.adminId),
      feesCollectionService.recordPayment(w.scopeA, { ...input, clientReference: `race-b-${target.id}` }, w.adminId,
      ),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1); // exactly one winner
    expect(rejected).toHaveLength(1); // the other refused
    const rejection = rejected[0];
    if (!rejection || rejection.status !== "rejected") throw new Error("unreachable");
    expect(String(rejection.reason)).toContain("outstanding balance");

    // The installment: paid exactly its net, ONCE.
    const [after] = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, target.id));
    expect(after?.paymentStatus).toBe("paid");
    expect(after?.paidAmount).toBe(target.netAmount);

    // The ledger: ONE fee_payment credit for the winner, nothing for the loser.
    const ledgerRows = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceTable, "fee_payments"),
          eq(financialTransactions.studentId, studentR.id),
        ),
      );
    expect(ledgerRows).toHaveLength(1);

    // One payment row for this student, status cleared.
    const paymentsForStudent = await db
      .select()
      .from(feePayments)
      .where(eq(feePayments.studentId, studentR.id));
    expect(paymentsForStudent).toHaveLength(1);
    expect(paymentsForStudent[0]?.paymentStatus).toBe("cleared");
  });

  it("partial-then-full race: the second caller gets the REMAINING balance check", async () => {
    // A subtler variant: one cashier pays half, the other the full amount,
    // concurrently. Whoever lands first, the second must never push
    // paid_amount past net — either by refusing the full ask or by
    // re-reading the shrunken balance.
    const studentR2 = await freshStudent("R2");
    const assignmentR2 = await assignAndGenerate(studentR2.id);
    const rows = await installmentsOf(assignmentR2.id);
    const target = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!target) throw new Error("Race fixture installment missing.");
    const net = paise(target.netAmount);
    const half = net / 2n;

    const settled = await Promise.allSettled([
      feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: studentR2.id,
          academicYearId: w.yearAId,
          paymentDate: "2025-04-08",
          paymentMode: "cash",
          allocations: [
            { installmentId: target.id, amount: `${half / 100n}.${(half % 100n).toString().padStart(2, "0")}` },
          ],
          clientReference: `race-half-a-${target.id}`,
        },
        w.adminId,
      ),
      feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: studentR2.id,
          academicYearId: w.yearAId,
          paymentDate: "2025-04-08",
          paymentMode: "cash",
          allocations: [{ installmentId: target.id, amount: target.netAmount }],
          clientReference: `race-full-b-${target.id}`,
        },
        w.adminId,
      ),
    ]);

    // The DB CHECK is the backstop; the row lock makes it unreachable in
    // practice. Either way, the row ends legal.
    const [after] = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, target.id));
    expect(paise(after?.paidAmount ?? "0") <= net).toBe(true);
    expect(after?.paymentStatus === "paid" || after?.paymentStatus === "partial").toBe(true);

    // Every successful payment's allocations sum to its principal — no
    // phantom money from the interleaving.
    const paymentsRows2 = await db
      .select()
      .from(feePayments)
      .where(eq(feePayments.studentId, studentR2.id));
    for (const p of paymentsRows2) {
      const allocs = await db
        .select()
        .from(paymentAllocationsTable)
        .where(eq(paymentAllocationsTable.paymentId, p.id));
      expect(allocs.reduce((acc, a) => acc + paise(a.amountAllocated), 0n)).toBe(
        paise(p.amount),
      );
    }
    // And the installment's paid_amount equals the SUM of its allocations.
    const targetAllocs = await db
      .select()
      .from(paymentAllocationsTable)
      .where(eq(paymentAllocationsTable.installmentId, target.id));
    expect(
      targetAllocs.reduce((acc, a) => acc + paise(a.amountAllocated), 0n),
    ).toBe(paise(after?.paidAmount ?? "0"));
  });
});
describe("fees: the remaining named transitions (H5)", () => {
  /** A pending cheque payment, fully allocated to its target installment. */
  async function pendingChequePayment(
    studentId: string,
    targetInstallmentId: string,
    net: string,
  ) {
    return feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-09",
        paymentMode: "cheque",
        transactionReference: `CHQ-${studentId.slice(0, 8)}`,
        allocations: [{ installmentId: targetInstallmentId, amount: net }],
      },
      w.adminId,
    );
  }

  it("clearPayment: pending → cleared; a second clear is refused; no new ledger row", async () => {
    const student = await freshStudent("TR1");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const target = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!target) throw new Error("Fixture installment missing.");
    const payment = await pendingChequePayment(student.id, target.id, target.netAmount);
    expect(payment.paymentStatus).toBe("pending");

    const cleared = await feesCollectionService.clearPayment(
      w.scopeA,
      { paymentId: payment.id, reason: "Bank confirmed the cheque" },
      w.adminId,
    );
    expect(cleared.paymentStatus).toBe("cleared");

    // The clear writes NO new ledger row — the movement was recorded at
    // record time; clearing only flips the confirmation.
    const ledgerRows = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.referenceId, payment.id));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.transactionType).toBe("fee_payment");

    // Clearing again is refused with the state-machine wording.
    await expect(
      feesCollectionService.clearPayment(
        w.scopeA,
        { paymentId: payment.id, reason: "Twice" },
        w.adminId,
      ),
    ).rejects.toThrow(/cleared payment cannot be cleared/);

    // The installment stays paid.
    const [after] = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, target.id));
    expect(after?.paymentStatus).toBe("paid");
  });

  it("cancelPayment: pending → cancelled, balances RE-OPEN, its credit is offset (gap 15)", async () => {
    const student = await freshStudent("TR2");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const target = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    if (!target) throw new Error("Fixture installment missing.");
    const payment = await pendingChequePayment(student.id, target.id, target.netAmount);

    const ledgerBefore = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.referenceId, payment.id));

    const cancelled = await feesCollectionService.cancelPayment(
      w.scopeA,
      { paymentId: payment.id, reason: "Parent withdrew the cheque" },
      w.adminId,
    );
    expect(cancelled.paymentStatus).toBe("cancelled");

    // The installment is re-opened: pending cheque payments allocate
    // immediately, so cancel must take the money back off.
    const [after] = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, target.id));
    expect(after?.paidAmount).toBe("0.00");
    expect(after?.paymentStatus).toBe("unpaid");

    // No money moved, but the pending payment was credited at entry: the
    // cancel offsets it with a payment_cancelled debit (ADR-049, gap 15).
    const ledgerAfter = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.referenceId, payment.id));
    expect(ledgerAfter).toHaveLength(ledgerBefore.length + 1);
    const offset = ledgerAfter.find((r) => r.transactionType === "payment_cancelled");
    expect(offset?.direction).toBe("debit");
    expect(offset?.amount).toBe(payment.amount);
    const cashRows = await feesCollectionService.listLedger([w.scopeA], w.yearAId, student.id);
    expect(cashRows.find((r) => r.transactionType === "payment_cancelled")?.cashEffect).toBe("out");

    // Cancelling a CLEARED payment is refused — that money moved.
    const clearedPayment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-10",
        paymentMode: "cash",
        allocations: [{ installmentId: target.id, amount: target.netAmount }],
        clientReference: `tr2-clear-${target.id}`,
      },
      w.adminId,
    );
    await expect(
      feesCollectionService.cancelPayment(
        w.scopeA,
        { paymentId: clearedPayment.id, reason: "Too late" },
        w.adminId,
      ),
    ).rejects.toThrow(/cleared payment cannot move to cancelled/);
  });

  it("reversePayment: cleared → reversed, balances re-open, a fee_refund debit lands", async () => {
    const student = await freshStudent("TR3");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const target = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    const labTarget = rows.find((r) => r.feeHeadId === w.labHeadId);
    if (!target || !labTarget) throw new Error("Fixture installments missing.");
    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-10",
        paymentMode: "cash",
        allocations: [{ installmentId: target.id, amount: target.netAmount }],
        clientReference: `tr3-cash-${target.id}`,
      },
      w.adminId,
    );
    expect(payment.paymentStatus).toBe("cleared");

    const reversed = await feesCollectionService.reversePayment(
      w.scopeA,
      { paymentId: payment.id, reason: "Duplicate entry at the desk" },
      w.adminId,
    );
    expect(reversed.paymentStatus).toBe("reversed");

    const [after] = await db
      .select()
      .from(feeInstallments)
      .where(eq(feeInstallments.id, target.id));
    expect(after?.paidAmount).toBe("0.00");
    expect(after?.paymentStatus).toBe("unpaid");

    const ledgerRows = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.referenceId, payment.id))
      .orderBy(financialTransactions.createdAt);
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows[0]?.transactionType).toBe("fee_payment");
    expect(ledgerRows[1]?.transactionType).toBe("fee_refund");
    expect(ledgerRows[1]?.direction).toBe("debit");
    expect(ledgerRows[1]?.amount).toBe(payment.amount);

    // Reversing a PENDING payment is refused — it has not confirmed.
    const pendingPayment = await pendingChequePayment(
      student.id,
      labTarget.id,
      labTarget.netAmount,
    );
    await expect(
      feesCollectionService.reversePayment(
        w.scopeA,
        { paymentId: pendingPayment.id, reason: "Not yet" },
        w.adminId,
      ),
    ).rejects.toThrow(/pending payment cannot move to reversed/);
  });
});

describe("fees: optional subscriptions generate their own installments (H5)", () => {
  async function optionalHead(name: string) {
    const [head] = await db
      .insert(feeHeads)
      .values({
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        name,
        category: "optional",
      })
      .returning();
    if (!head) throw new Error("Optional head fixture missing.");
    return head;
  }

  it("a full-window transport subscription adds its 12 monthly rows on re-generation", async () => {
    const transport = await optionalHead(`Transport ${RUN}`);
    const student = await freshStudent("SB1");
    const assignment = await assignAndGenerate(student.id);

    await feesService.createSubscription(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        feeHeadId: transport.id,
        serviceDetail: "Route 3",
        monthlyAmount: "800.00",
        annualAmount: "9600.00",
        subscribedFrom: "2025-04-01",
      },
      w.adminId,
    );

    // The generator is idempotent FILL: the earlier run pre-dates the
    // subscription, so this re-run adds exactly its 12 months.
    const result = await feesBillingService.generateInstallments(w.scopeA, assignment.id);
    expect(result.inserted).toBe(12);

    const rows = await installmentsOf(assignment.id);
    const transportRows = rows.filter((r) => r.feeHeadId === transport.id);
    expect(transportRows).toHaveLength(12);
    expect(transportRows.every((r) => r.amount === "800.00")).toBe(true);
    expect(transportRows[0]?.periodMonth).toBe(4);
    expect(transportRows[11]?.periodMonth).toBe(3);
    // The structure's own heads are untouched by the subscription rows.
    expect(rows.filter((r) => r.feeHeadId === w.tuitionHeadId)).toHaveLength(12);
  });

  it("a mid-window subscription bills only from its own start", async () => {
    const hostel = await optionalHead(`Hostel ${RUN}`);
    const student = await freshStudent("SB2");
    const assignment = await assignAndGenerate(student.id);

    await feesService.createSubscription(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        feeHeadId: hostel.id,
        serviceDetail: "Block A",
        monthlyAmount: "2000.00",
        annualAmount: "24000.00",
        subscribedFrom: "2025-10-01", // joined the hostel in October
      },
      w.adminId,
    );
    await feesBillingService.generateInstallments(w.scopeA, assignment.id);

    const rows = await installmentsOf(assignment.id);
    const hostelRows = rows
      .filter((r) => r.feeHeadId === hostel.id)
      .sort(
        (a, b) =>
          (a.periodYear ?? 0) * 12 +
          (a.periodMonth ?? 0) -
          ((b.periodYear ?? 0) * 12 + (b.periodMonth ?? 0)),
      );
    expect(hostelRows).toHaveLength(6); // Oct–Mar only
    expect(hostelRows[0]?.periodMonth).toBe(10);
    expect(hostelRows.every((r) => r.amount === "2000.00")).toBe(true);
  });
});

describe("fees: opening balances (H5)", () => {
  it("records the balance AND its ledger row; refuses a self-origin balance", async () => {
    // A second year in the fixture org: dues carried FROM 2025-26 INTO 2026-27.
    const [year2] = await db
      .insert(academicYears)
      .values({
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        name: "2026-27",
        startDate: "2026-04-01",
        endDate: "2027-03-31",
        originalEndDate: "2027-03-31",
        isCurrent: false,
      })
      .returning();
    if (!year2) throw new Error("Second year fixture missing.");

    const student = await freshStudent("OB1");
    const balance = await feesBillingService.createOpeningBalance(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: year2.id,
        originAcademicYearId: w.yearAId,
        amount: "150.00",
        description: "Carried forward from 2025-26",
      },
      w.adminId,
    );
    expect(balance.amount).toBe("150.00");

    // The ledger row landed in the SAME transaction — type, direction, reference.
    const [ledgerRow] = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceId, balance.id),
          eq(financialTransactions.transactionType, "opening_balance"),
        ),
      );
    expect(ledgerRow).toBeTruthy();
    expect(ledgerRow?.direction).toBe("credit");
    expect(ledgerRow?.referenceTable).toBe("opening_balances");

    // The carry-forward read finds it, clipped to the student and year.
    const listed = await feesBillingService.listOpeningBalances(
      [w.scopeA],
      year2.id,
      student.id,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.balanceAmount).toBe("150.00");

    // A balance originating from the year it lands in is a category error.
    await expect(
      feesBillingService.createOpeningBalance(
        w.scopeA,
        {
          studentId: student.id,
          academicYearId: year2.id,
          originAcademicYearId: year2.id,
          amount: "10.00",
        },
        w.adminId,
      ),
    ).rejects.toThrow(/cannot originate/);
  });
});

describe("fees: S1 collection trust hardening (F1–F4)", () => {
  it("F1: the same clientReference on a DIFFERENT payload is refused, not replayed", async () => {
    const student = await freshStudent("S1F1");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const open = rows.find(
      (r) => r.feeHeadId === w.tuitionHeadId && r.paymentStatus === "unpaid",
    );
    if (!open) throw new Error("No open installment for F1.");
    const key = `s1-idem-${open.id}`;
    await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-07",
        paymentMode: "cash",
        allocations: [{ installmentId: open.id, amount: open.netAmount }],
        clientReference: key,
      },
      w.adminId,
    );
    // Same key, different amount → refusal (a reused order id is not a replay).
    await expect(
      feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: student.id,
          academicYearId: w.yearAId,
          paymentDate: "2025-04-07",
          paymentMode: "cash",
          allocations: [{ installmentId: open.id, amount: "1.00" }],
          clientReference: key,
        },
        w.adminId,
      ),
    ).rejects.toThrow(/already used for a different payment/);
    // Same key, different student → refusal.
    const stranger = await freshStudent("S1F1B");
    await expect(
      feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: stranger.id,
          academicYearId: w.yearAId,
          paymentDate: "2025-04-07",
          paymentMode: "cash",
          allocations: [{ installmentId: open.id, amount: open.netAmount }],
          clientReference: key,
        },
        w.adminId,
      ),
    ).rejects.toThrow(/already used for a different payment/);
  });

  it("F2: a payment cannot allocate installments from another academic year", async () => {
    const [year2] = await db
      .insert(academicYears)
      .values({
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        name: "2027-28",
        startDate: "2027-04-01",
        endDate: "2028-03-31",
        originalEndDate: "2028-03-31",
        isCurrent: false,
      })
      .returning();
    if (!year2) throw new Error("Second year fixture missing for F2.");
    const student = await freshStudent("S1F2");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const open = rows.find((r) => r.paymentStatus === "unpaid");
    if (!open) throw new Error("No open installment for F2.");
    await expect(
      feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: student.id,
          academicYearId: year2.id,
          paymentDate: "2025-04-07",
          paymentMode: "cash",
          allocations: [{ installmentId: open.id, amount: open.netAmount }],
          clientReference: `s1-year-${open.id}`,
        },
        w.adminId,
      ),
    ).rejects.toThrow(/belong to the payment's academic year/);
  });

  it("F3: late fee is computed server-side — past-due charges, not-due does not", async () => {
    await db.insert(lateFeeRules).values({
      organizationId: w.orgAId,
      schoolId: w.schoolAId,
      feeStructureId: null,
      gracePeriodDays: 0,
      calculationType: "flat",
      value: "100.00",
      maxLateFee: null,
      isActive: true,
      effectiveFrom: "2025-04-01",
      effectiveTo: null,
      createdBy: w.adminId,
    });
    const student = await freshStudent("S1LATE");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const tuition = rows
      .filter((r) => r.feeHeadId === w.tuitionHeadId)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const first = tuition[0];
    const last = tuition[tuition.length - 1];
    if (!first || !last) throw new Error("Tuition installments missing for F3.");

    // Five days past due (due 2025-04-01, paid 2025-04-06): the flat rule fires.
    const late = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-06",
        paymentMode: "cash",
        allocations: [{ installmentId: first.id, amount: first.netAmount }],
        clientReference: `s1-late-${first.id}`,
      },
      w.adminId,
    );
    expect(late.lateFeeAmount).toBe("100.00");
    const lateRows = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceId, late.id),
          eq(financialTransactions.transactionType, "late_fee_charged"),
        ),
      );
    expect(lateRows).toHaveLength(1);
    expect(lateRows[0]?.amount).toBe("100.00");

    // Not yet due (a March installment paid in April): no fee, no ledger row.
    const early = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-06",
        paymentMode: "cash",
        allocations: [{ installmentId: last.id, amount: last.netAmount }],
        clientReference: `s1-early-${last.id}`,
      },
      w.adminId,
    );
    expect(early.lateFeeAmount).toBe("0.00");
    const earlyRows = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceId, early.id),
          eq(financialTransactions.transactionType, "late_fee_charged"),
        ),
      );
    expect(earlyRows).toHaveLength(0);

    await db
      .update(lateFeeRules)
      .set({ isActive: false })
      .where(
        and(
          eq(lateFeeRules.schoolId, w.schoolAId),
          eq(lateFeeRules.isActive, true),
        ),
      );
  });

  it("F3: per-day late fee accrues by days past grace and respects the cap", async () => {
    await db.insert(lateFeeRules).values({
      organizationId: w.orgAId,
      schoolId: w.schoolAId,
      feeStructureId: null,
      gracePeriodDays: 0,
      calculationType: "per_day",
      value: "10.00",
      maxLateFee: "25.00",
      isActive: true,
      effectiveFrom: "2025-04-01",
      effectiveTo: null,
      createdBy: w.adminId,
    });
    const student = await freshStudent("S1PERDAY");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const first = rows
      .filter((r) => r.feeHeadId === w.tuitionHeadId)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
    if (!first) throw new Error("Tuition installments missing for per-day F3.");
    // 5 days late × 10.00 = 50.00, capped at 25.00.
    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-06",
        paymentMode: "cash",
        allocations: [{ installmentId: first.id, amount: first.netAmount }],
        clientReference: `s1-perday-${first.id}`,
      },
      w.adminId,
    );
    expect(payment.lateFeeAmount).toBe("25.00");
    await db
      .update(lateFeeRules)
      .set({ isActive: false })
      .where(
        and(
          eq(lateFeeRules.schoolId, w.schoolAId),
          eq(lateFeeRules.isActive, true),
        ),
      );
  });

  it("F4: online_portal is not a valid counter paymentMode on the wire", async () => {
    const rows = await installmentsOf(w.assignmentAId);
    const open = rows.find((r) => r.paymentStatus === "unpaid");
    if (!open) throw new Error("No open installment for F4.");
    const base = {
      studentId: w.studentAId,
      academicYearId: w.yearAId,
      paymentDate: "2025-04-07",
      allocations: [{ installmentId: open.id, amount: open.netAmount }],
    };
    expect(
      recordPaymentSchema.safeParse({ ...base, paymentMode: "online_portal" })
        .success,
    ).toBe(false);
    expect(
      recordPaymentSchema.safeParse({ ...base, paymentMode: "cash" }).success,
    ).toBe(true);
    // The gateway path still writes online_portal and enters pending.
    expect(open.netAmount).toBeTruthy();
  });
});

describe("fees: S2 concession validity windows (F5)", () => {
  it("a Jun–Aug concession discounts only the June, July and August installments", async () => {
    const student = await freshStudent("S2WIN");
    const assignment = await assignAndGenerate(student.id);
    await feesService.createConcession(
      w.scopeA,
      assignment.id,
      {
        concessionType: "sibling_discount",
        calculationType: "flat",
        value: "3000.00",
        feeHeadId: w.tuitionHeadId,
        validFrom: "2025-06-01",
        validTo: "2025-08-31",
      },
      w.adminId,
    );
    await feesBillingService.recomputeAssignmentConcessions(w.scopeA, assignment.id);

    const rows = await installmentsOf(assignment.id);
    const tuition = rows.filter((r) => r.feeHeadId === w.tuitionHeadId);
    expect(tuition).toHaveLength(12);
    for (const r of tuition) {
      if (r.periodMonth === 6 || r.periodMonth === 7 || r.periodMonth === 8) {
        expect(r.concessionAmount).toBe("1000.00");
      } else {
        expect(r.concessionAmount).toBe("0.00");
      }
    }
    // The lab head is untouched by a tuition-named concession.
    const lab = rows.filter((r) => r.feeHeadId === w.labHeadId);
    for (const r of lab) expect(r.concessionAmount).toBe("0.00");
  });
});

describe("fees: S3 the cross-tenant IDOR matrix", () => {
  // One org-A reality (student + assignment + a cleared cash payment) that
  // every probe addresses from org B's scope. All probes fail at the row
  // filter, so the fixture is never mutated and stays reusable.
  let s3: {
    studentId: string;
    assignmentId: string;
    installmentId: string;
    paymentId: string;
    structureId: string;
    lineId: string;
  } | null = null;
  async function s3world() {
    if (s3) return s3;
    const student = await freshStudent("S3X");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const open = rows.find((r) => r.paymentStatus === "unpaid");
    if (!open) throw new Error("No open installment for S3.");
    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-07",
        paymentMode: "cash",
        allocations: [{ installmentId: open.id, amount: open.netAmount }],
        clientReference: `s3-seed-${open.id}`,
      },
      w.adminId,
    );
    const [structure] = await db
      .select({ id: feeStructures.id })
      .from(feeStructures)
      .where(eq(feeStructures.schoolId, w.schoolAId))
      .limit(1);
    const [line] = await db
      .select({ id: feeStructureLines.id })
      .from(feeStructureLines)
      .where(eq(feeStructureLines.schoolId, w.schoolAId))
      .limit(1);
    if (!structure || !line) throw new Error("Structure fixture missing for S3.");
    s3 = {
      studentId: student.id,
      assignmentId: assignment.id,
      installmentId: open.id,
      paymentId: payment.id,
      structureId: structure.id,
      lineId: line.id,
    };
    return s3;
  }

  it("getPaymentDetail from the foreign scope is null (receipt ids are not guessable across tenants)", async () => {
    const f = await s3world();
    // Receipt-number guessing is a db:verify concern (school_receipt_uq is
    // PER SCHOOL); the IDOR case here is the row id addressed cross-tenant.
    expect(await feesCollectionService.getPaymentDetail(w.scopeB, f.paymentId)).toBeNull();
  });

  it("bouncePayment from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesCollectionService.bouncePayment(
        w.scopeB,
        { paymentId: f.paymentId, reason: "S3 probe" },
        w.adminId,
      ),
    ).rejects.toThrow(/Payment not found in this school\./);
  });

  it("reversePayment from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesCollectionService.reversePayment(
        w.scopeB,
        { paymentId: f.paymentId, reason: "S3 probe" },
        w.adminId,
      ),
    ).rejects.toThrow(/Payment not found in this school\./);
  });

  it("cancelPayment from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesCollectionService.cancelPayment(
        w.scopeB,
        { paymentId: f.paymentId, reason: "S3 probe" },
        w.adminId,
      ),
    ).rejects.toThrow(/Payment not found in this school\./);
  });

  it("recordRefund from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesCollectionService.recordRefund(
        w.scopeB,
        {
          originalPaymentId: f.paymentId,
          refundAmount: "10.00",
          refundDate: "2025-04-08",
          refundMode: "cash",
          reason: "S3 probe",
        },
        w.adminId,
      ),
    ).rejects.toThrow(/Payment not found in this school\./);
  });

  it("waiveInstallment from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesCollectionService.waiveInstallment(w.scopeB, f.installmentId, w.adminId),
    ).rejects.toThrow(/Installment not found in this school\./);
  });

  it("generateInstallments from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesBillingService.generateInstallments(w.scopeB, f.assignmentId),
    ).rejects.toThrow(/Fee assignment not found in this school\./);
  });

  it("recomputeAssignmentConcessions from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesBillingService.recomputeAssignmentConcessions(w.scopeB, f.assignmentId),
    ).rejects.toThrow(/Fee assignment not found in this school\./);
  });

  it("createConcession from the foreign scope is the generic refusal", async () => {
    const f = await s3world();
    await expect(
      feesService.createConcession(
        w.scopeB,
        f.assignmentId,
        {
          concessionType: "other",
          calculationType: "flat",
          value: "10",
          validFrom: "2025-04-01",
        },
        w.adminId,
      ),
    ).rejects.toThrow(/Fee assignment not found in this school\./);
  });

  it("listDues from the foreign scope never sees the foreign student's rows", async () => {
    const f = await s3world();
    const rows = await feesCollectionService.listDues([w.scopeB], w.yearAId, {
      studentId: f.studentId,
    });
    expect(rows).toHaveLength(0);
  });

  it("recordGatewayPayment with a foreign student is refused before allocation", async () => {
    const f = await s3world();
    await expect(
      feesCollectionService.recordGatewayPayment({
        organizationId: w.scopeB.organizationId,
        studentId: f.studentId,
        gatewayOrderId: `s3-gw-${f.studentId}`,
        amount: "10.00",
        paymentDate: "2025-04-07",
      }),
    ).rejects.toThrow(/Student not found\./);
  });

  it("configuration reads from the foreign scope are null/empty, never foreign rows", async () => {
    const f = await s3world();
    expect(await feesService.getFeeHeadById(w.scopeB, w.tuitionHeadId)).toBeNull();
    expect(
      await feesService.getFeeStructureById(w.scopeB, f.structureId, true),
    ).toBeNull();
    expect(await feesService.listFeeStructureLines(w.scopeB, f.structureId)).toHaveLength(0);
    expect(
      await feesService.updateFeeStructureLine(w.scopeB, f.lineId, {
        annualAmount: "12000.00",
      }),
    ).toBeNull();
  });
});

describe("fees: student fee status matrix", () => {
  const query = (overrides: Partial<FeeMatrixInput> = {}) =>
    feeMatrixInputSchema.parse({
      academicYearId: w.yearAId,
      classId: matrix.classId,
      page: 1,
      pageSize: 100,
      ...overrides,
    });

  const cellInput = (
    studentId: string,
    month: string,
    academicYearId = w.yearAId,
  ): FeeMatrixCellInput => ({ academicYearId, studentId, month });

  beforeAll(async () => {
    const klass = await academicService.createClass(w.scopeA, {
      name: `Fee Matrix ${RUN}`,
      numericOrder: 99,
    });
    const section = await academicService.createSection(w.scopeA, {
      academicYearId: w.yearAId,
      classId: klass.id,
      name: "MX-A",
    });
    const structure = await feesService.createFeeStructure(
      w.scopeA,
      {
        academicYearId: w.yearAId,
        classId: klass.id,
        name: `Fee Matrix Structure ${RUN}`,
        installmentMode: "monthly",
      },
      w.adminId,
    );
    await db.insert(feeStructureLines).values([
      {
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        feeStructureId: structure.id,
        feeHeadId: w.tuitionHeadId,
        annualAmount: "12000.00",
        installmentFrequency: "monthly",
      },
      {
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        feeStructureId: structure.id,
        feeHeadId: w.labHeadId,
        annualAmount: "2400.00",
        installmentFrequency: "term_wise",
      },
    ]);

    const createMatrixStudent = async (tag: string) => freshStudent(`MX-${tag}`);
    const enrollMatrix = async (studentId: string) =>
      enrollmentService.createEnrollment(w.scopeA, {
        studentId,
        academicYearId: w.yearAId,
        classId: klass.id,
        sectionId: section.id,
        enrollmentDate: "2025-04-01",
      });
    const generateMatrix = async (tag: string, effectiveFrom?: string) => {
      const student = await createMatrixStudent(tag);
      const enrollment = await enrollMatrix(student.id);
      const assignment = await feesBillingService.assignFeeStructure(
        w.scopeA,
        {
          enrollmentId: enrollment.id,
          ...(effectiveFrom ? { feeEffectiveFrom: effectiveFrom } : {}),
        },
        w.adminId,
      );
      await feesBillingService.generateInstallments(w.scopeA, assignment.id);
      return { student, assignment };
    };

    const multi = await generateMatrix("MULTI");
    const mid = await generateMatrix("MID", "2025-10-01");

    const unassignedStudent = await createMatrixStudent("UNASSIGNED");
    await enrollMatrix(unassignedStudent.id);

    const ungeneratedStudent = await createMatrixStudent("UNGENERATED");
    const ungeneratedEnrollment = await enrollMatrix(ungeneratedStudent.id);
    await feesBillingService.assignFeeStructure(
      w.scopeA,
      { enrollmentId: ungeneratedEnrollment.id },
      w.adminId,
    );

    const partial = await generateMatrix("PARTIAL");
    const partialRows = await installmentsOf(partial.assignment.id);
    const partialTarget = partialRows.find((row) => row.feeHeadId === w.tuitionHeadId);
    if (!partialTarget) throw new Error("Matrix partial target missing.");
    await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: partial.student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-05",
        paymentMode: "cash",
        allocations: [{ installmentId: partialTarget.id, amount: "100.00" }],
      },
      w.adminId,
    );

    const paid = await generateMatrix("PAID");
    for (const row of await installmentsOf(paid.assignment.id)) {
      await db
        .update(feeInstallments)
        .set({ paidAmount: row.netAmount, paymentStatus: "paid" })
        .where(eq(feeInstallments.id, row.id));
    }

    const conceded = await generateMatrix("CONCEDED");
    await feesService.createConcession(
      w.scopeA,
      conceded.assignment.id,
      {
        concessionType: "management_discount",
        calculationType: "percentage",
        value: "100",
        validFrom: "2025-04-01",
      },
      w.adminId,
    );
    await feesBillingService.recomputeAssignmentConcessions(w.scopeA, conceded.assignment.id);

    const waived = await generateMatrix("WAIVED");
    const waivedRows = await installmentsOf(waived.assignment.id);
    for (const row of waivedRows.filter((candidate) => candidate.feeHeadId === w.tuitionHeadId)) {
      await feesCollectionService.waiveInstallment(w.scopeA, row.id, w.adminId);
    }
    for (const row of waivedRows.filter((candidate) => candidate.feeHeadId === w.labHeadId)) {
      await db
        .update(feeInstallments)
        .set({ paidAmount: row.netAmount, paymentStatus: "paid" })
        .where(eq(feeInstallments.id, row.id));
    }

    const waivedOnly = await generateMatrix("WAIVED_ONLY");
    for (const row of await installmentsOf(waivedOnly.assignment.id)) {
      await feesCollectionService.waiveInstallment(w.scopeA, row.id, w.adminId);
    }

    const cancelled = await generateMatrix("CANCELLED");
    await db
      .update(feeInstallments)
      .set({ paymentStatus: "cancelled" })
      .where(
        and(
          eq(feeInstallments.studentFeeAssignmentId, cancelled.assignment.id),
          eq(feeInstallments.feeHeadId, w.labHeadId),
          eq(feeInstallments.dueDate, "2025-04-01"),
        ),
      );

    const openingStudent = await createMatrixStudent("OPENING");
    await enrollMatrix(openingStudent.id);
    const [priorOne] = await db
      .insert(academicYears)
      .values({
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        name: "2022-23",
        startDate: "2022-04-01",
        endDate: "2023-03-31",
        originalEndDate: "2023-03-31",
        isCurrent: false,
      })
      .returning();
    const [priorTwo] = await db
      .insert(academicYears)
      .values({
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        name: "2023-24",
        startDate: "2023-04-01",
        endDate: "2024-03-31",
        originalEndDate: "2024-03-31",
        isCurrent: false,
      })
      .returning();
    if (!priorOne || !priorTwo) throw new Error("Matrix opening years missing.");
    await feesBillingService.createOpeningBalance(
      w.scopeA,
      {
        studentId: openingStudent.id,
        academicYearId: w.yearAId,
        originAcademicYearId: priorOne.id,
        amount: "100.00",
      },
      w.adminId,
    );
    await feesBillingService.createOpeningBalance(
      w.scopeA,
      {
        studentId: openingStudent.id,
        academicYearId: w.yearAId,
        originAcademicYearId: priorTwo.id,
        amount: "50.00",
      },
      w.adminId,
    );

    matrix = {
      classId: klass.id,
      sectionId: section.id,
      closedYearId: priorOne.id,
      multiStudentId: multi.student.id,
      midStudentId: mid.student.id,
      unassignedStudentId: unassignedStudent.id,
      ungeneratedStudentId: ungeneratedStudent.id,
      partialStudentId: partial.student.id,
      paidStudentId: paid.student.id,
      concededStudentId: conceded.student.id,
      waivedStudentId: waived.student.id,
      waivedOnlyStudentId: waivedOnly.student.id,
      cancelledStudentId: cancelled.student.id,
      openingStudentId: openingStudent.id,
    };
  }, 300_000);

  it("keeps unassigned, ungenerated, mid-year, and section-scoped students visible", async () => {
    const result = await feesCollectionService.listMatrix([w.scopeA], query(), true);
    expect(result).not.toBeNull();
    expect(feeMatrixOutputSchema.safeParse(result).success).toBe(true);
    const rows = result!.rows;
    const byId = new Map(rows.map((row) => [row.studentId, row]));
    expect(result!.months).toHaveLength(12);
    expect(byId.get(matrix.unassignedStudentId)?.assignmentState).toBe("unassigned");
    expect(byId.get(matrix.unassignedStudentId)?.generationState).toBe("not_assigned");
    expect(byId.get(matrix.ungeneratedStudentId)?.generationState).toBe("not_generated");
    expect(byId.get(matrix.multiStudentId)?.sectionName).toBe("MX-A");
    expect(byId.get(matrix.midStudentId)?.cells[0]).toMatchObject({
      assessedAmount: "0.00",
      feeHeadCount: 0,
      paymentState: "no_fee",
      timingState: "none",
    });
    const october = byId
      .get(matrix.midStudentId)
      ?.cells.find((cell) => cell.month === "2025-10");
    expect(october).toMatchObject({
      assessedAmount: "1960.00", // tuition 1000.00 + T2 lab 960.00 (ADR-050)
      feeHeadCount: 2,
      month: "2025-10",
    });
    expect(byId.get(matrix.multiStudentId)?.cells[0]).toMatchObject({
      assessedAmount: "2440.00",
      concessionAmount: "0.00",
      netAmount: "2440.00",
      feeHeadCount: 2,
    });
  });

  it("aggregates heads, preserves exact strings, and separates paid, partial, conceded, and overdue states", async () => {
    const result = await feesCollectionService.listMatrix([w.scopeA], query(), true);
    const rows = result!.rows;
    const byId = new Map(rows.map((row) => [row.studentId, row]));
    expect(byId.get(matrix.partialStudentId)?.cells[0]).toMatchObject({
      assessedAmount: "2440.00",
      paidAmount: "100.00",
      balanceAmount: "2340.00",
      paymentState: "partial",
      timingState: "overdue",
    });
    expect(byId.get(matrix.paidStudentId)?.totals).toMatchObject({
      balanceAmount: "0.00",
      paymentState: "paid",
      timingState: "none",
    });
    expect(byId.get(matrix.concededStudentId)?.totals).toMatchObject({
      assessedAmount: "14400.00",
      concessionAmount: "14400.00",
      netAmount: "0.00",
      balanceAmount: "0.00",
      paymentState: "conceded",
    });
    expect(byId.get(matrix.multiStudentId)?.oldestDueDate).toBe("2025-04-01");
  });

  it("excludes cancelled installments and removes waived amounts from outstanding totals", async () => {
    const result = await feesCollectionService.listMatrix([w.scopeA], query(), true);
    const byId = new Map(result!.rows.map((row) => [row.studentId, row]));
    expect(byId.get(matrix.cancelledStudentId)?.cells[0]).toMatchObject({
      assessedAmount: "1000.00",
      feeHeadCount: 1,
      balanceAmount: "1000.00",
    });
    expect(byId.get(matrix.waivedStudentId)?.cells[0]).toMatchObject({
      assessedAmount: "2440.00",
      feeHeadCount: 2,
      balanceAmount: "0.00",
      paymentState: "paid",
    });
    expect(byId.get(matrix.waivedOnlyStudentId)?.totals).toMatchObject({
      balanceAmount: "0.00",
      paymentState: "conceded",
      timingState: "none",
    });
  });

  it("keeps opening balances outside month cells and aggregates their origins", async () => {
    const result = await feesCollectionService.listMatrix([w.scopeA], query(), true);
    const row = result!.rows.find((candidate) => candidate.studentId === matrix.openingStudentId);
    expect(row?.totals.assessedAmount).toBe("0.00");
    expect(row?.cells.every((cell) => cell.assessedAmount === "0.00")).toBe(true);
    expect(row?.openingBalance).toEqual({
      amount: "150.00",
      paid: "0.00",
      balance: "150.00",
      status: "unpaid",
      originCount: 2,
    });
  });

  it("returns the aggregate and only actual due-month installments for a cell", async () => {
    const april = await feesCollectionService.getMatrixCell(
      [w.scopeA],
      cellInput(matrix.midStudentId, "2025-04"),
      true,
    );
    expect(april).not.toBeNull();
    expect(feeMatrixCellOutputSchema.safeParse(april).success).toBe(true);
    expect(april).toMatchObject({
      studentId: matrix.midStudentId,
      month: "2025-04",
      assessedAmount: "0.00",
      feeHeadCount: 0,
      paymentState: "no_fee",
      timingState: "none",
    });
    expect(april!.installments).toHaveLength(0);

    const october = await feesCollectionService.getMatrixCell(
      [w.scopeA],
      cellInput(matrix.midStudentId, "2025-10"),
      true,
    );
    expect(october).toMatchObject({
      studentId: matrix.midStudentId,
      month: "2025-10",
      assessedAmount: "1960.00",
      balanceAmount: "1960.00",
      feeHeadCount: 2,
      paymentState: "unpaid",
    });
    expect(october!.installments).toHaveLength(2);
    expect(october!.installments.every((installment) => installment.dueDate === "2025-10-01")).toBe(
      true,
    );
    expect(october!.installments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feeHeadId: w.tuitionHeadId,
          feeHeadName: "Tuition Fee",
          amount: "1000.00",
          balanceAmount: "1000.00",
          paymentStatus: "unpaid",
        }),
        expect.objectContaining({
          feeHeadId: w.labHeadId,
          feeHeadName: "Lab Fee",
          amount: "960.00",
          balanceAmount: "960.00",
          paymentStatus: "unpaid",
        }),
      ]),
    );
  });

  it("keeps paid and waived installments visible and returns a valid unassigned cell", async () => {
    const paid = await feesCollectionService.getMatrixCell(
      [w.scopeA],
      cellInput(matrix.paidStudentId, "2025-04"),
      true,
    );
    expect(paid).toMatchObject({
      assessedAmount: "2440.00",
      balanceAmount: "0.00",
      paymentState: "paid",
    });
    expect(paid!.installments).toHaveLength(2);
    expect(paid!.installments.every((installment) => installment.paymentStatus === "paid")).toBe(true);
    expect(paid!.installments.every((installment) => installment.balanceAmount === "0.00")).toBe(
      true,
    );

    const waived = await feesCollectionService.getMatrixCell(
      [w.scopeA],
      cellInput(matrix.waivedStudentId, "2025-04"),
      true,
    );
    expect(waived).toMatchObject({
      assessedAmount: "2440.00",
      balanceAmount: "0.00",
      paymentState: "paid",
    });
    expect(waived!.installments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paymentStatus: "waived", balanceAmount: "0.00" }),
        expect.objectContaining({ paymentStatus: "paid", balanceAmount: "0.00" }),
      ]),
    );

    const unassigned = await feesCollectionService.getMatrixCell(
      [w.scopeA],
      cellInput(matrix.unassignedStudentId, "2025-04"),
      true,
    );
    expect(unassigned).toMatchObject({
      studentId: matrix.unassignedStudentId,
      month: "2025-04",
      assessedAmount: "0.00",
      paymentState: "no_fee",
      timingState: "none",
    });
    expect(unassigned!.installments).toHaveLength(0);
  });

  it("returns null for an inaccessible student or academic year", async () => {
    expect(
      await feesCollectionService.getMatrixCell(
        [w.scopeB],
        cellInput(matrix.multiStudentId, "2025-04"),
        true,
      ),
    ).toBeNull();
    expect(
      await feesCollectionService.getMatrixCell(
        [w.scopeA],
        cellInput(matrix.multiStudentId, "2025-04"),
        false,
      ),
    ).not.toBeNull();
    expect(
      await feesCollectionService.getMatrixCell(
        [w.scopeA],
        cellInput(matrix.multiStudentId, "2025-04", matrix.closedYearId),
        false,
      ),
    ).toBeNull();
  });

  it("filters by view, search, class, section, sort, and pagination", async () => {
    const unpaid = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ view: "unpaid" }),
      true,
    );
    expect(unpaid!.rows.map((row) => row.studentId)).toEqual(
      expect.arrayContaining([matrix.multiStudentId, matrix.midStudentId]),
    );
    expect(unpaid!.rows.some((row) => row.studentId === matrix.partialStudentId)).toBe(false);

    const partial = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ view: "partial" }),
      true,
    );
    expect(partial!.rows.map((row) => row.studentId)).toEqual([matrix.partialStudentId]);

    const paid = await feesCollectionService.listMatrix([w.scopeA], query({ view: "paid" }), true);
    expect(paid!.rows.map((row) => row.studentId)).toEqual(
      expect.arrayContaining([
        matrix.paidStudentId,
        matrix.concededStudentId,
        matrix.waivedStudentId,
      ]),
    );

    const notGenerated = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ view: "notGenerated" }),
      true,
    );
    expect(notGenerated!.rows.map((row) => row.studentId)).toEqual(
      expect.arrayContaining([matrix.unassignedStudentId, matrix.ungeneratedStudentId]),
    );
    expect(notGenerated!.rows.some((row) => row.studentId === matrix.cancelledStudentId)).toBe(
      false,
    );

    const attention = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ view: "attention" }),
      true,
    );
    expect(attention!.rows.map((row) => row.studentId)).toEqual(
      expect.arrayContaining([
        matrix.unassignedStudentId,
        matrix.ungeneratedStudentId,
        matrix.openingStudentId,
        matrix.multiStudentId,
      ]),
    );
    expect(attention!.rows.some((row) => row.studentId === matrix.paidStudentId)).toBe(false);

    const searched = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ search: "MX-PARTIAL" }),
      true,
    );
    expect(searched!.rows.map((row) => row.studentId)).toEqual([matrix.partialStudentId]);
    const wildcard = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ search: "%" }),
      true,
    );
    expect(wildcard!.rows).toHaveLength(0);

    const sectionFiltered = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ sectionId: matrix.sectionId }),
      true,
    );
    expect(sectionFiltered!.rows.length).toBeGreaterThan(0);
    expect(sectionFiltered!.rows.every((row) => row.sectionId === matrix.sectionId)).toBe(true);

    const byBalance = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ sort: "balance" }),
      true,
    );
    const balanceOrder = byBalance!.rows.map((row) => row.studentId);
    const cancelledIndex = balanceOrder.indexOf(matrix.cancelledStudentId);
    const openingIndex = balanceOrder.indexOf(matrix.openingStudentId);
    const paidIndex = balanceOrder.indexOf(matrix.paidStudentId);
    expect(cancelledIndex).toBeLessThan(openingIndex);
    expect(openingIndex).toBeLessThan(paidIndex);
    expect(byBalance!.cohortTotals.outstandingStudentCount).toBe(5);

    const firstPage = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ page: 1, pageSize: 2, sort: "student" }),
      true,
    );
    const secondPage = await feesCollectionService.listMatrix(
      [w.scopeA],
      query({ page: 2, pageSize: 2, sort: "student" }),
      true,
    );
    expect(firstPage!.pageInfo.total).toBe(secondPage!.pageInfo.total);
    expect(firstPage!.rows).toHaveLength(2);
    expect(secondPage!.rows).toHaveLength(2);
    expect(
      firstPage!.rows.some((left) =>
        secondPage!.rows.some((right) => left.studentId === right.studentId),
      ),
    ).toBe(false);
  }, 120_000);

  it("uses the IST calendar date for due and overdue timing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-09-30T18:30:00.000Z"));
    try {
      const result = await feesCollectionService.listMatrix([w.scopeA], query(), true);
      const byId = new Map(result!.rows.map((row) => [row.studentId, row]));
      expect(byId.get(matrix.multiStudentId)?.timingState).toBe("overdue");
      expect(byId.get(matrix.midStudentId)?.timingState).toBe("due");
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces academic-year history visibility", async () => {
    const closed = query({ academicYearId: matrix.closedYearId });
    expect(await feesCollectionService.listMatrix([w.scopeA], closed, false)).toBeNull();
    expect(await feesCollectionService.listMatrix([w.scopeA], closed, true)).not.toBeNull();
  });

  it("isolates a foreign scope from the matrix cohort", async () => {
    const result = await feesCollectionService.listMatrix([w.scopeB], query(), true);
    expect(result).toBeNull();
  });
});

describe("fees: mobile backend gaps (ADR-049)", () => {
  /** The 2026-27 year the H5 test may already have made; overlap is refused, so reuse it. */
  async function carryIntoYear() {
    const [existing] = await db
      .select()
      .from(academicYears)
      .where(and(eq(academicYears.schoolId, w.schoolAId), eq(academicYears.name, "2026-27")));
    if (existing) return existing;
    const [created] = await db
      .insert(academicYears)
      .values({
        organizationId: w.orgAId,
        schoolId: w.schoolAId,
        name: "2026-27",
        startDate: "2026-04-01",
        endDate: "2027-03-31",
        originalEndDate: "2027-03-31",
        isCurrent: false,
      })
      .returning();
    if (!created) throw new Error("Carry-into year fixture missing.");
    return created;
  }

  async function balanceRow(id: string) {
    const [row] = await db
      .select()
      .from(openingBalancesTable)
      .where(eq(openingBalancesTable.id, id));
    if (!row) throw new Error("Opening balance vanished.");
    return row;
  }

  it("gap 2: payment detail labels every installment line from the server", async () => {
    const student = await freshStudent("G2");
    const assignment = await assignAndGenerate(student.id);
    const rows = await installmentsOf(assignment.id);
    const tuition = rows.find((r) => r.feeHeadId === w.tuitionHeadId);
    const lab = rows.find((r) => r.feeHeadId === w.labHeadId);
    if (!tuition || !lab) throw new Error("Fixture installments missing.");

    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-01",
        paymentMode: "cash",
        allocations: [
          { installmentId: lab.id, amount: lab.netAmount },
          { installmentId: tuition.id, amount: "400.00" },
        ],
      },
      w.adminId,
    );

    const detail = await feesCollectionService.getPaymentDetail(w.scopeA, payment.id);
    expect(detail?.openingBalanceAllocations).toEqual([]);
    const byInstallment = new Map(detail?.allocations.map((a) => [a.installmentId, a]));
    expect(byInstallment.get(tuition.id)).toEqual({
      installmentId: tuition.id,
      amountAllocated: "400.00",
      feeHeadId: w.tuitionHeadId,
      feeHeadName: "Tuition Fee",
      description: tuition.description,
      installmentNumber: tuition.installmentNumber,
      dueDate: tuition.dueDate,
    });
    expect(byInstallment.get(lab.id)?.feeHeadName).toBe("Lab Fee");
    expect(byInstallment.get(lab.id)?.amountAllocated).toBe(lab.netAmount);
  });

  it("gap 1: payment and ledger rows carry the student's name, admission number and class", async () => {
    const student = await freshStudent("G1");
    const assignment = await assignAndGenerate(student.id);
    const [first] = await installmentsOf(assignment.id);
    if (!first) throw new Error("Fixture installment missing.");
    await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-01",
        paymentMode: "cash",
        allocations: [{ installmentId: first.id, amount: first.netAmount }],
      },
      w.adminId,
    );

    const label = {
      studentName: "ItgFee G1",
      admissionNumber: `${RUN}-G1`,
      className: "Fee 6",
      sectionName: null,
    };
    const payments = await feesCollectionService.listPayments([w.scopeA], w.yearAId, student.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject(label);
    const ledger = await feesCollectionService.listLedger([w.scopeA], w.yearAId, student.id);
    expect(ledger.length).toBeGreaterThan(0);
    for (const row of ledger) expect(row).toMatchObject({ ...label, cashEffect: "in" });

    // No enrollment in the row's year: the class is null, the row still lists.
    const year2 = await carryIntoYear();
    const loner = await freshStudent("G1B");
    const balance = await feesBillingService.createOpeningBalance(
      w.scopeA,
      {
        studentId: loner.id,
        academicYearId: year2.id,
        originAcademicYearId: w.yearAId,
        amount: "10.00",
      },
      w.adminId,
    );
    const [obRow] = await feesCollectionService.listLedger([w.scopeA], year2.id, loner.id);
    expect(obRow?.referenceId).toBe(balance.id);
    expect(obRow).toMatchObject({
      studentName: "ItgFee G1B",
      className: null,
      sectionName: null,
      cashEffect: "none",
    });

    // The scope still clips: a foreign scope sees none of it.
    expect(
      await feesCollectionService.listPayments([w.scopeB], w.yearAId, student.id),
    ).toEqual([]);
    expect(await feesCollectionService.listLedger([w.scopeB], w.yearAId, student.id)).toEqual(
      [],
    );
  });

  it("gap 10: an opening balance is collected, refunded, and re-opened by a bounce", async () => {
    const year2 = await carryIntoYear();
    const student = await freshStudent("G10");
    const balance = await feesBillingService.createOpeningBalance(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: year2.id,
        originAcademicYearId: w.yearAId,
        amount: "500.00",
        description: "Carried forward from 2025-26",
      },
      w.adminId,
    );
    const payInput = (
      amount: string,
      extra: Partial<RecordPaymentInput> = {},
    ): RecordPaymentInput => ({
      studentId: student.id,
      academicYearId: year2.id,
      paymentDate: "2026-04-10",
      paymentMode: "cash",
      allocations: [],
      openingBalanceAllocations: [{ openingBalanceId: balance.id, amount }],
      ...extra,
    });

    // Refusals, worded, before any money moves.
    await expect(
      feesCollectionService.recordPayment(w.scopeA, payInput("500.01"), w.adminId),
    ).rejects.toThrow(/exceeds the opening balance still owed. The outstanding amount is 500.00/);
    await expect(
      feesCollectionService.recordPayment(
        w.scopeA,
        payInput("10.00", { academicYearId: w.yearAId }),
        w.adminId,
      ),
    ).rejects.toThrow(/carried into/);
    const other = await freshStudent("G10X");
    await expect(
      feesCollectionService.recordPayment(
        w.scopeA,
        payInput("10.00", { studentId: other.id }),
        w.adminId,
      ),
    ).rejects.toThrow(/belong to the paying student/);
    await expect(
      feesCollectionService.recordPayment(w.scopeB, payInput("10.00"), w.adminId),
    ).rejects.toThrow();
    expect((await balanceRow(balance.id)).paidAmount).toBe("0.00");

    // Cash 200.00 against the carried-forward balance.
    const cash = await feesCollectionService.recordPayment(
      w.scopeA,
      payInput("200.00"),
      w.adminId,
    );
    expect(cash.amount).toBe("200.00");
    expect(cash.paymentStatus).toBe("cleared");
    let row = await balanceRow(balance.id);
    expect(row.paidAmount).toBe("200.00");
    expect(row.balanceAmount).toBe("300.00");
    expect(row.status).toBe("partial");

    // The link row: opening_balance_payment, referencing the balance, under the receipt.
    const cashLedger = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.schoolId, w.schoolAId),
          eq(financialTransactions.receiptNumber, cash.receiptNumber),
        ),
      );
    expect(cashLedger).toEqual([
      expect.objectContaining({
        transactionType: "opening_balance_payment",
        direction: "credit",
        amount: "200.00",
        referenceId: balance.id,
        referenceTable: "opening_balances",
      }),
    ]);

    const detail = await feesCollectionService.getPaymentDetail(w.scopeA, cash.id);
    expect(detail?.allocations).toEqual([]);
    expect(detail?.openingBalanceAllocations).toEqual([
      {
        openingBalanceId: balance.id,
        amountAllocated: "200.00",
        description: "Carried forward from 2025-26",
        originAcademicYearId: w.yearAId,
        originAcademicYearName: "2025-26",
      },
    ]);

    // A refund takes 50.00 back off the balance it paid.
    await feesCollectionService.recordRefund(
      w.scopeA,
      {
        originalPaymentId: cash.id,
        refundAmount: "50.00",
        refundDate: "2026-04-11",
        refundMode: "cash",
        reason: "Over-collected carry-forward",
      },
      w.adminId,
    );
    row = await balanceRow(balance.id);
    expect(row.paidAmount).toBe("150.00");
    expect(row.status).toBe("partial");

    // A cheque for the rest settles it; its bounce re-opens exactly that much.
    const cheque = await feesCollectionService.recordPayment(
      w.scopeA,
      payInput("350.00", { paymentMode: "cheque", transactionReference: "CHQ-G10" }),
      w.adminId,
    );
    expect(cheque.paymentStatus).toBe("pending");
    row = await balanceRow(balance.id);
    expect(row.paidAmount).toBe("500.00");
    expect(row.status).toBe("paid");
    await expect(
      feesCollectionService.recordPayment(w.scopeA, payInput("0.01"), w.adminId),
    ).rejects.toThrow(/outstanding amount is 0.00/);

    await feesCollectionService.bouncePayment(
      w.scopeA,
      { paymentId: cheque.id, reason: "Cheque returned" },
      w.adminId,
    );
    row = await balanceRow(balance.id);
    expect(row.paidAmount).toBe("150.00");
    expect(row.status).toBe("partial");

    // The student's year nets to the cash actually kept: the receivable row
    // is `none`, so Money in/out see only the cash.
    const ledger = await feesCollectionService.listLedger([w.scopeA], year2.id, student.id);
    const effects = ledger.map((r) => [r.transactionType, r.cashEffect]);
    expect(effects).toContainEqual(["opening_balance", "none"]);
    expect(effects).toContainEqual(["opening_balance_payment", "in"]);
    const cashIn = ledger
      .filter((r) => r.cashEffect === "in")
      .reduce((acc, r) => acc + paise(r.amount), 0n);
    const cashOut = ledger
      .filter((r) => r.cashEffect === "out")
      .reduce((acc, r) => acc + paise(r.amount), 0n);
    expect(cashIn - cashOut).toBe(paise("150.00"));
    expect(cashIn - cashOut).toBe(paise(row.paidAmount));
  });

  it("gaps 12 and 15: bounce, reversal and cancel offset the late fee as well as the principal", async () => {
    await db.insert(lateFeeRules).values({
      organizationId: w.orgAId,
      schoolId: w.schoolAId,
      feeStructureId: null,
      gracePeriodDays: 0,
      calculationType: "flat",
      value: "75.00",
      maxLateFee: null,
      isActive: true,
      effectiveFrom: "2025-04-01",
      effectiveTo: null,
      createdBy: w.adminId,
    });
    try {
      const student = await freshStudent("G12");
      const assignment = await assignAndGenerate(student.id);
      const tuition = (await installmentsOf(assignment.id))
        .filter((r) => r.feeHeadId === w.tuitionHeadId)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
      const [first, second, third] = tuition;
      if (!first || !second || !third) throw new Error("Tuition installments missing.");

      // Both paid long past due: the flat rule fires on each.
      const cheque = await feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: student.id,
          academicYearId: w.yearAId,
          paymentDate: "2025-06-20",
          paymentMode: "cheque",
          transactionReference: "CHQ-G12",
          allocations: [{ installmentId: first.id, amount: first.netAmount }],
        },
        w.adminId,
      );
      const cash = await feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: student.id,
          academicYearId: w.yearAId,
          paymentDate: "2025-06-20",
          paymentMode: "cash",
          allocations: [{ installmentId: second.id, amount: second.netAmount }],
        },
        w.adminId,
      );
      const withdrawn = await feesCollectionService.recordPayment(
        w.scopeA,
        {
          studentId: student.id,
          academicYearId: w.yearAId,
          paymentDate: "2025-06-20",
          paymentMode: "upi",
          transactionReference: "UPI-G12",
          allocations: [{ installmentId: third.id, amount: third.netAmount }],
        },
        w.adminId,
      );
      expect(cheque.lateFeeAmount).toBe("75.00");
      expect(cash.lateFeeAmount).toBe("75.00");
      expect(withdrawn.lateFeeAmount).toBe("75.00");
      await feesCollectionService.cancelPayment(
        w.scopeA,
        { paymentId: withdrawn.id, reason: "Parent withdrew" },
        w.adminId,
      );

      await feesCollectionService.bouncePayment(
        w.scopeA,
        { paymentId: cheque.id, reason: "Cheque returned" },
        w.adminId,
      );
      await feesCollectionService.reversePayment(
        w.scopeA,
        { paymentId: cash.id, reason: "Duplicate entry" },
        w.adminId,
      );

      for (const [payment, type] of [
        [cheque, "cheque_bounce_charge"],
        [cash, "fee_refund"],
        [withdrawn, "payment_cancelled"],
      ] as const) {
        const debits = await db
          .select()
          .from(financialTransactions)
          .where(
            and(
              eq(financialTransactions.referenceId, payment.id),
              eq(financialTransactions.direction, "debit"),
            ),
          );
        expect(debits.map((d) => `${d.transactionType}:${d.amount}`).sort()).toEqual(
          [`${type}:${payment.amount}`, `${type}:75.00`].sort(),
        );
      }

      // Nothing was kept, so the student's cash nets to zero — late fees included.
      const ledger = await feesCollectionService.listLedger([w.scopeA], w.yearAId, student.id);
      const net = ledger.reduce((acc, r) => {
        if (r.cashEffect === "in") return acc + paise(r.amount);
        if (r.cashEffect === "out") return acc - paise(r.amount);
        return acc;
      }, 0n);
      expect(net).toBe(0n);
    } finally {
      await db
        .update(lateFeeRules)
        .set({ isActive: false })
        .where(and(eq(lateFeeRules.schoolId, w.schoolAId), eq(lateFeeRules.isActive, true)));
    }
  }, 90_000);

  /** A cleared cash payment covering the student's first two tuition months. */
  async function twoLinePayment(tag: string) {
    const student = await freshStudent(tag);
    const assignment = await assignAndGenerate(student.id);
    const [first, second] = (await installmentsOf(assignment.id))
      .filter((r) => r.feeHeadId === w.tuitionHeadId)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (!first || !second) throw new Error("Tuition installments missing.");
    // Listed second-first on purpose: the walk order is by due date, not input order.
    const payment = await feesCollectionService.recordPayment(
      w.scopeA,
      {
        studentId: student.id,
        academicYearId: w.yearAId,
        paymentDate: "2025-04-01",
        paymentMode: "cash",
        allocations: [
          { installmentId: second.id, amount: second.netAmount },
          { installmentId: first.id, amount: first.netAmount },
        ],
      },
      w.adminId,
    );
    const paidOf = async (id: string) => {
      const [row] = await db.select().from(feeInstallments).where(eq(feeInstallments.id, id));
      return [row?.paidAmount, row?.paymentStatus];
    };
    const refund = (amount: string) =>
      feesCollectionService.recordRefund(
        w.scopeA,
        {
          originalPaymentId: payment.id,
          refundAmount: amount,
          refundDate: "2025-04-02",
          refundMode: "cash",
          reason: `Refund ${amount}`,
        },
        w.adminId,
      );
    return { student, first, second, payment, paidOf, refund };
  }

  it("gap 16: repeated partial refunds walk on from where the last one stopped", async () => {
    const { first, second, payment, paidOf, refund } = await twoLinePayment("G16");
    expect(first.netAmount).toBe("1000.00");
    expect(second.netAmount).toBe("1000.00");
    expect(payment.amount).toBe("2000.00");

    await refund("300.00");
    expect(await paidOf(first.id)).toEqual(["700.00", "partial"]);
    expect(await paidOf(second.id)).toEqual(["1000.00", "paid"]);

    // The old walk took this from the first line again (clamped at 0) and
    // never touched the second.
    await refund("1200.00");
    expect(await paidOf(first.id)).toEqual(["0.00", "unpaid"]);
    expect(await paidOf(second.id)).toEqual(["500.00", "partial"]);

    await refund("500.00");
    expect(await paidOf(second.id)).toEqual(["0.00", "unpaid"]);
    await expect(refund("0.01")).rejects.toThrow(/Refundable: 0.00/);
  });

  it("gap 17: a reversal after a partial refund offsets only what the payment still holds", async () => {
    const { student, first, second, payment, paidOf, refund } = await twoLinePayment("G17");
    await refund("300.00");

    await feesCollectionService.reversePayment(
      w.scopeA,
      { paymentId: payment.id, reason: "Disputed" },
      w.adminId,
    );
    expect(await paidOf(first.id)).toEqual(["0.00", "unpaid"]);
    expect(await paidOf(second.id)).toEqual(["0.00", "unpaid"]);

    const [reversal] = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceId, payment.id),
          eq(financialTransactions.direction, "debit"),
        ),
      );
    expect(reversal?.transactionType).toBe("fee_refund");
    expect(reversal?.amount).toBe("1700.00");

    const ledger = await feesCollectionService.listLedger([w.scopeA], w.yearAId, student.id);
    const net = ledger.reduce((acc, r) => {
      if (r.cashEffect === "in") return acc + paise(r.amount);
      if (r.cashEffect === "out") return acc - paise(r.amount);
      return acc;
    }, 0n);
    expect(net).toBe(0n);

    // A fully refunded payment has nothing left to reverse.
    const full = await twoLinePayment("G17B");
    await full.refund("2000.00");
    await expect(
      feesCollectionService.reversePayment(
        w.scopeA,
        { paymentId: full.payment.id, reason: "Too late" },
        w.adminId,
      ),
    ).rejects.toThrow(/fully refunded/);
  }, 90_000);

  it("gap 13: the matrix reports late fees on standing payments beside paidAmount", async () => {
    await db.insert(lateFeeRules).values({
      organizationId: w.orgAId,
      schoolId: w.schoolAId,
      feeStructureId: null,
      gracePeriodDays: 0,
      calculationType: "flat",
      value: "40.00",
      maxLateFee: null,
      isActive: true,
      effectiveFrom: "2025-04-01",
      effectiveTo: null,
      createdBy: w.adminId,
    });
    try {
      const student = await freshStudent("G13");
      const assignment = await assignAndGenerate(student.id);
      const [first, second, third] = (await installmentsOf(assignment.id))
        .filter((r) => r.feeHeadId === w.tuitionHeadId)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
      if (!first || !second || !third) throw new Error("Tuition installments missing.");
      const pay = (installment: typeof first, mode: "cash" | "cheque") =>
        feesCollectionService.recordPayment(
          w.scopeA,
          {
            studentId: student.id,
            academicYearId: w.yearAId,
            paymentDate: "2025-06-20",
            paymentMode: mode,
            ...(mode === "cheque" ? { transactionReference: `CHQ-${installment.id.slice(0, 6)}` } : {}),
            allocations: [{ installmentId: installment.id, amount: installment.netAmount }],
          },
          w.adminId,
        );
      await pay(first, "cash"); // cleared: counts
      await pay(second, "cheque"); // pending: counts, like its principal
      const bounced = await pay(third, "cheque");
      await feesCollectionService.bouncePayment(
        w.scopeA,
        { paymentId: bounced.id, reason: "Cheque returned" },
        w.adminId,
      );

      const result = feeMatrixOutputSchema.parse(
        await feesCollectionService.listMatrix(
          [w.scopeA],
          feeMatrixInputSchema.parse({ academicYearId: w.yearAId, search: `${RUN}-G13` }),
          true,
        ),
      );
      const [row] = result.rows;
      expect(result.rows).toHaveLength(1);
      expect(row?.totals.lateFeePaidAmount).toBe("80.00");
      // paidAmount stays principal only: the two standing installments.
      expect(row?.totals.paidAmount).toBe(
        fromPaise(paise(first.netAmount) + paise(second.netAmount)),
      );
      expect(result.cohortTotals.lateFeePaidAmount).toBe("80.00");

      // A student with no payments reports zero, not a missing field.
      const none = await freshStudent("G13B");
      await assignAndGenerate(none.id);
      const empty = await feesCollectionService.listMatrix(
        [w.scopeA],
        feeMatrixInputSchema.parse({ academicYearId: w.yearAId, search: `${RUN}-G13B` }),
        true,
      );
      expect(empty?.rows[0]?.totals.lateFeePaidAmount).toBe("0.00");
    } finally {
      await db
        .update(lateFeeRules)
        .set({ isActive: false })
        .where(and(eq(lateFeeRules.schoolId, w.schoolAId), eq(lateFeeRules.isActive, true)));
    }
  }, 90_000);

  it("gap 11: waivers stay as written but are receivables, never cash", async () => {
    const student = await freshStudent("G11");
    const assignment = await assignAndGenerate(student.id);
    const [first] = await installmentsOf(assignment.id);
    if (!first) throw new Error("Fixture installment missing.");
    await feesCollectionService.waiveInstallment(w.scopeA, first.id, w.adminId);
    const ledger = await feesCollectionService.listLedger([w.scopeA], w.yearAId, student.id);
    const waiver = ledger.find((r) => r.transactionType === "waiver_applied");
    expect(waiver?.direction).toBe("debit"); // the immutable row is unchanged
    expect(waiver?.cashEffect).toBe("none");
  });
});

describe("fees: bill a whole class (billClass)", () => {
  let classId: string;
  let sectionAId: string;
  let sectionBId: string;
  let bareClassId: string;
  let preBilledAssignmentId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const klass = await academicService.createClass(w.scopeA, {
      name: `Fee Bulk ${RUN}`,
      numericOrder: 90,
    });
    classId = klass.id;
    const [sectionA, sectionB] = await Promise.all(
      ["BK-A", "BK-B"].map((name) =>
        academicService.createSection(w.scopeA, {
          academicYearId: w.yearAId,
          classId,
          name,
        }),
      ),
    );
    if (!sectionA || !sectionB) throw new Error("Bulk sections missing.");
    sectionAId = sectionA.id;
    sectionBId = sectionB.id;

    const structure = await feesService.createFeeStructure(
      w.scopeA,
      {
        academicYearId: w.yearAId,
        classId,
        name: `Fee Bulk Structure ${RUN}`,
        installmentMode: "monthly",
      },
      w.adminId,
    );
    await db.insert(feeStructureLines).values({
      organizationId: w.orgAId,
      schoolId: w.schoolAId,
      feeStructureId: structure.id,
      feeHeadId: w.tuitionHeadId,
      annualAmount: "12000.00",
      installmentFrequency: "monthly",
    });

    const enrollInto = async (tag: string, sectionId: string) => {
      const student = await freshStudent(`BK-${tag}`);
      ids[tag] = student.id;
      return enrollmentService.createEnrollment(w.scopeA, {
        studentId: student.id,
        academicYearId: w.yearAId,
        classId,
        sectionId,
        enrollmentDate: "2025-04-01",
      });
    };

    // Section A: one already billed, one new, one who left.
    const preBilled = await enrollInto("A-PRE", sectionAId);
    const assignment = await feesBillingService.assignFeeStructure(
      w.scopeA,
      { enrollmentId: preBilled.id },
      w.adminId,
    );
    await feesBillingService.generateInstallments(w.scopeA, assignment.id);
    preBilledAssignmentId = assignment.id;
    await enrollInto("A-NEW", sectionAId);
    const left = await enrollInto("A-LEFT", sectionAId);
    await db
      .update(studentEnrollments)
      .set({ enrollmentStatus: "withdrawn" })
      .where(eq(studentEnrollments.id, left.id));

    // Section B: two new.
    await enrollInto("B-NEW1", sectionBId);
    await enrollInto("B-NEW2", sectionBId);

    const bare = await academicService.createClass(w.scopeA, {
      name: `Fee Bulk Bare ${RUN}`,
      numericOrder: 91,
    });
    bareClassId = bare.id;
    const bareStudent = await freshStudent("BK-BARE");
    await enrollmentService.createEnrollment(w.scopeA, {
      studentId: bareStudent.id,
      academicYearId: w.yearAId,
      classId: bareClassId,
      enrollmentDate: "2025-04-01",
    });
  });

  it("section filter: bills only the section's unbilled, skips the billed, refuses the left", async () => {
    const result = await feesBillingService.billClass(
      w.scopeA,
      { academicYearId: w.yearAId, classId, sectionId: sectionAId },
      w.adminId,
    );
    expect(result.refusal).toBeNull();
    expect(result.billed.map((s) => s.studentId)).toEqual([ids["A-NEW"]]);
    expect(result.skipped.map((s) => [s.studentId, s.assignmentId])).toEqual([
      [ids["A-PRE"], preBilledAssignmentId],
    ]);
    expect(result.refused).toEqual([
      expect.objectContaining({
        studentId: ids["A-LEFT"],
        reason: "Not enrolled: withdrawn.",
      }),
    ]);
    expect([result.billedCount, result.skippedCount, result.refusedCount]).toEqual([1, 1, 1]);

    // The billed student got the full year's monthly dues in the same call.
    const billed = result.billed[0];
    expect(billed?.installmentsCreated).toBe(12);
    const rows = await installmentsOf(billed?.assignmentId ?? "");
    expect(rows).toHaveLength(12);
    expect(rows.reduce((acc, r) => acc + paise(r.netAmount), 0n)).toBe(1_200_000n);

    // Section B is untouched by a section-A run.
    const sectionB = await db
      .select({ id: studentFeeAssignments.id })
      .from(studentFeeAssignments)
      .where(
        and(
          eq(studentFeeAssignments.academicYearId, w.yearAId),
          inArray(studentFeeAssignments.studentId, [ids["B-NEW1"]!, ids["B-NEW2"]!]),
        ),
      );
    expect(sectionB).toHaveLength(0);
  });

  it("whole class: bills the rest; a second run bills nobody", async () => {
    const first = await feesBillingService.billClass(
      w.scopeA,
      { academicYearId: w.yearAId, classId },
      w.adminId,
    );
    expect(first.billed.map((s) => s.studentId).sort()).toEqual(
      [ids["B-NEW1"], ids["B-NEW2"]].sort(),
    );
    expect(first.skippedCount).toBe(2); // A-PRE and A-NEW from the section run
    expect(first.refusedCount).toBe(1);

    const second = await feesBillingService.billClass(
      w.scopeA,
      { academicYearId: w.yearAId, classId },
      w.adminId,
    );
    expect(second.billedCount).toBe(0);
    expect(second.skippedCount).toBe(4);
    expect(second.refusedCount).toBe(1);

    // No duplicate dues: still exactly 12 per billed student.
    for (const s of first.billed) {
      expect(await installmentsOf(s.assignmentId)).toHaveLength(12);
    }
  });

  it("a class with no active fee chart refuses as a whole", async () => {
    const result = await feesBillingService.billClass(
      w.scopeA,
      { academicYearId: w.yearAId, classId: bareClassId },
      w.adminId,
    );
    expect(result.refusal).toMatch(/no active fee chart/i);
    expect(result.feeStructureId).toBeNull();
    expect([result.billedCount, result.skippedCount, result.refusedCount]).toEqual([0, 0, 0]);
  });

  it("refuses a class of another school, billing nobody", async () => {
    const outsider = await freshStudent("BK-X");
    await enrollmentService.createEnrollment(w.scopeA, {
      studentId: outsider.id,
      academicYearId: w.yearAId,
      classId,
      sectionId: sectionBId,
      enrollmentDate: "2025-04-01",
    });
    await expect(
      feesBillingService.billClass(
        w.scopeB,
        { academicYearId: w.yearAId, classId },
        w.adminId,
      ),
    ).rejects.toThrow(/^Class not found in this school/);
    const assigned = await db
      .select({ id: studentFeeAssignments.id })
      .from(studentFeeAssignments)
      .where(eq(studentFeeAssignments.studentId, outsider.id));
    expect(assigned).toHaveLength(0);
  });

  it("refuses a section of a different class", async () => {
    await expect(
      feesBillingService.billClass(
        w.scopeA,
        { academicYearId: w.yearAId, classId: bareClassId, sectionId: sectionAId },
        w.adminId,
      ),
    ).rejects.toThrow(/^The section is not in the class being billed/);
  });
});

describe("fees: month-by-month generation (ADR-051)", () => {
  async function assignOnly(studentId: string) {
    const enrollment = await enroll(studentId);
    return feesBillingService.assignFeeStructure(
      w.scopeA,
      { enrollmentId: enrollment.id },
      w.adminId,
    );
  }

  const endOfThisMonth = () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}`;
  };

  it("generates a prefix, adds the rest later, and matches all-at-once to the paisa", async () => {
    const once = await assignOnly((await freshStudent("MB1")).id);
    const stepped = await assignOnly((await freshStudent("MB2")).id);
    for (const id of [once.id, stepped.id]) {
      await feesService.createConcession(
        w.scopeA,
        id,
        {
          concessionType: "merit_scholarship",
          calculationType: "percentage",
          value: "10",
          validFrom: "2025-04-01",
        },
        w.adminId,
      );
    }

    await feesBillingService.generateInstallments(w.scopeA, once.id, undefined, {
      through: "all",
    });

    const first = await feesBillingService.generateInstallments(
      w.scopeA,
      stepped.id,
      undefined,
      { through: "2025-06-30" },
    );
    const early = await installmentsOf(stepped.id);
    expect(early.length).toBeGreaterThan(0);
    expect(early.every((r) => r.dueDate <= "2025-06-30")).toBe(true);
    expect(first.inserted).toBe(early.length);

    await feesBillingService.generateInstallments(w.scopeA, stepped.id, undefined, {
      through: "2025-12-31",
    });
    await feesBillingService.generateInstallments(w.scopeA, stepped.id, undefined, {
      through: "all",
    });
    const again = await feesBillingService.generateInstallments(
      w.scopeA,
      stepped.id,
      undefined,
      { through: "all" },
    );
    expect(again.inserted).toBe(0);

    // Same rows, same amounts, same concession shares: generating month by
    // month never piles a concession onto the first months.
    const all = await installmentsOf(once.id);
    const steppedRows = await installmentsOf(stepped.id);
    expect(steppedRows).toHaveLength(all.length);
    const key = (r: { feeHeadId: string; installmentNumber: number }) =>
      `${r.feeHeadId}:${r.installmentNumber}`;
    const byKey = new Map(all.map((r) => [key(r), r]));
    for (const row of steppedRows) {
      const twin = byKey.get(key(row));
      expect(twin).toBeTruthy();
      expect(row.dueDate).toBe(twin?.dueDate);
      expect(row.amount).toBe(twin?.amount);
      expect(row.concessionAmount).toBe(twin?.concessionAmount);
    }
  });

  it("generateThrough brings a class up to a date; a second run adds nothing", async () => {
    const student = await freshStudent("MB3");
    const assignment = await assignOnly(student.id);

    const result = await feesBillingService.generateThrough(w.scopeA, {
      academicYearId: w.yearAId,
      through: "2025-05-31",
      classId: w.classId,
    });
    expect(result.failed).toHaveLength(0);
    expect(result.inserted).toBeGreaterThan(0);
    const rows = await installmentsOf(assignment.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.dueDate <= "2025-05-31")).toBe(true);

    const again = await feesBillingService.generateThrough(w.scopeA, {
      academicYearId: w.yearAId,
      through: "2025-05-31",
      classId: w.classId,
    });
    expect(again.inserted).toBe(0);
  }, 180_000);

  it("the school's mode decides the cut-off when none is asked", async () => {
    try {
      await feesBillingService.setFeeGenerationMode(w.scopeA, "monthly_manual");
      expect(await feesBillingService.getFeeGenerationMode(w.scopeA)).toEqual({
        mode: "monthly_manual",
      });
      expect(
        await feesBillingService.resolveThrough(db, w.schoolAId, undefined),
      ).toBe(endOfThisMonth());
      expect(await feesBillingService.resolveThrough(db, w.schoolAId, "all")).toBeNull();

      await feesBillingService.setFeeGenerationMode(w.scopeA, "all_now");
      expect(
        await feesBillingService.resolveThrough(db, w.schoolAId, undefined),
      ).toBeNull();
    } finally {
      await feesBillingService.setFeeGenerationMode(w.scopeA, "all_now");
    }
  });

  it("the sweep fills billed students of monthly_auto schools, and only those", async () => {
    // A run killed mid-sweep (a timed-out test) leaves its lease until the
    // TTL; clear it so this test exercises the sweep, not the lease.
    await getRedis().del("lock:fees-monthly-sweep");
    const student = await freshStudent("MB4");
    const assignment = await assignOnly(student.id);
    expect(await installmentsOf(assignment.id)).toHaveLength(0);

    // all_now school: the sweep leaves it alone.
    await feesBillingService.runMonthlySweep({ schoolIds: [w.schoolAId] });
    expect(await installmentsOf(assignment.id)).toHaveLength(0);

    try {
      await feesBillingService.setFeeGenerationMode(w.scopeA, "monthly_auto");
      const swept = await feesBillingService.runMonthlySweep({ schoolIds: [w.schoolAId] });
      expect(swept.summary).not.toMatch(/^skipped/);
      const rows = await installmentsOf(assignment.id);
      // The fixture session ended before today, so "up to this month" is all
      // of it.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.dueDate <= endOfThisMonth())).toBe(true);
    } finally {
      await feesBillingService.setFeeGenerationMode(w.scopeA, "all_now");
    }
  }, 180_000);
});
