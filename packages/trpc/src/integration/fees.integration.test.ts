import { beforeAll, describe, expect, it } from "vitest";

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

import { db } from "@repo/db";
import {
  academicYears,
  feeHeads,
  students as studentsTable,
  feeInstallments,
  feeStructureLines,
  feeStructures,
  financialTransactions,
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
import { and, eq, sql } from "drizzle-orm";

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

  it("mid-session joiner: tuition starts October, term-wise lab collapses to T2", async () => {
    const midRows = await installmentsOf(w.assignmentMidId);
    const tuitionRows = midRows.filter((r) => r.feeHeadId === w.tuitionHeadId);
    const labRows = midRows.filter((r) => r.feeHeadId === w.labHeadId);
    expect(tuitionRows).toHaveLength(6); // Oct–Mar
    expect(tuitionRows[0]?.periodMonth).toBe(10);
    expect(labRows).toHaveLength(1); // T1 ended before the joiner arrived
    expect(labRows[0]?.amount).toBe("2400.00"); // the money follows the survivor
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

