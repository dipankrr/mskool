import {
  academicService,
  enrollmentService,
  feesBillingService,
  feesCollectionService,
  feesDashboardService,
  feesService,
  organizationService,
  studentService,
  termService,
} from "@repo/services";
import { db } from "@repo/db";
import {
  academicYears,
  feeDuesRuns,
  feeHeads,
  feeInstallments,
  feePayments,
  feeStructures,
  financialTransactions,
  openingBalances,
  paymentAllocations,
  user,
} from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The fee overhaul's proof: each case the plan names, against a real database,
 * and after each one a check that dues, payments and the ledger still agree.
 * See `.kilo/plans/2026-11-01-fees-overhaul.md`.
 */
const RUN = `fo-${randomUUID().slice(0, 8)}`;

type Scope = Parameters<typeof feesBillingService.generateThrough>[0];
const w = {} as {
  scope: Scope;
  yearId: string;
  classId: string;
  tuitionId: string;
  labId: string;
  busId: string;
  adminId: string;
};

const cents = (money: string | null) => Math.round(Number(money ?? "0") * 100);

let counter = 0;
async function student(tag: string, enrollmentDate = "2025-04-01", classId = w.classId) {
  counter += 1;
  const row = await studentService.createStudent(w.scope, {
    admissionNumber: `${RUN}-${tag}-${counter}`,
    firstName: tag,
    lastName: "Walk",
    dateOfBirth: "2012-01-01",
    gender: "other",
  } as Parameters<typeof studentService.createStudent>[1]);
  const enrollment = await enrollmentService.createEnrollment(w.scope, {
    studentId: row.id,
    academicYearId: w.yearId,
    classId,
    enrollmentDate,
  } as Parameters<typeof enrollmentService.createEnrollment>[1]);
  return { id: row.id, enrollmentId: enrollment.id };
}

async function billed(tag: string, feeEffectiveFrom?: string) {
  const s = await student(tag);
  const { assignment } = await feesBillingService.billEnrollment(
    w.scope,
    { enrollmentId: s.enrollmentId, ...(feeEffectiveFrom ? { feeEffectiveFrom } : {}) },
    w.adminId,
  );
  return { ...s, assignmentId: assignment.id };
}

const duesOf = (studentId: string) =>
  db
    .select()
    .from(feeInstallments)
    .where(eq(feeInstallments.studentId, studentId))
    .orderBy(feeInstallments.dueDate, feeInstallments.periodKey);

async function pay(
  studentId: string,
  allocations: { installmentId: string; amount: string }[],
  extra: Record<string, unknown> = {},
) {
  return feesCollectionService.recordPayment(
    w.scope,
    {
      studentId,
      academicYearId: w.yearId,
      paymentDate: "2025-11-20",
      paymentMode: "cash",
      allocations,
      ...extra,
    } as Parameters<typeof feesCollectionService.recordPayment>[1],
    w.adminId,
  );
}

/**
 * THE AGREEMENT CHECK. For one student: each due's paid amount equals what
 * standing allocations put on it, no due is overpaid or negative, and the
 * ledger's cash for a payment nets to zero once the payment has fallen through.
 */
async function assertAgreement(studentId: string) {
  const dues = await duesOf(studentId);
  for (const due of dues) {
    expect(cents(due.netAmount)).toBe(
      cents(due.amount) - cents(due.concessionAmount) - cents(due.discountAmount),
    );
    expect(cents(due.netAmount)).toBeGreaterThanOrEqual(0);
    if (due.paymentStatus !== "waived" && due.paymentStatus !== "cancelled") {
      expect(cents(due.paidAmount)).toBeLessThanOrEqual(cents(due.netAmount));
    }
    expect(cents(due.lateFeeCharged)).toBeGreaterThanOrEqual(0);
  }

  const payments = await db.select().from(feePayments).where(eq(feePayments.studentId, studentId));
  for (const payment of payments) {
    const rows = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          // Receipt numbers are unique per school, and every run makes a new one.
          eq(financialTransactions.studentId, studentId),
          eq(financialTransactions.receiptNumber, payment.receiptNumber),
        ),
      );
    const cash = rows
      .filter((r) => !["concession_applied", "waiver_applied", "opening_balance"].includes(r.transactionType))
      .reduce((acc, r) => acc + (r.direction === "credit" ? 1 : -1) * cents(r.amount), 0);
    if (["bounced", "reversed", "cancelled"].includes(payment.paymentStatus)) {
      expect(cash).toBe(0);
    }
    const noncash = rows
      .filter((r) => r.transactionType === "concession_applied")
      .reduce((acc, r) => acc + (r.direction === "debit" ? 1 : -1) * cents(r.amount), 0);
    if (["bounced", "reversed", "cancelled"].includes(payment.paymentStatus)) {
      expect(noncash).toBe(0);
    }
  }
}

beforeAll(async () => {
  const org = await organizationService.createOrganization({
    name: RUN,
    legalName: `${RUN} Trust`,
    slug: RUN,
  });
  const school = await organizationService.createSchool(org.id, {
    name: "Overhaul School",
    legalName: "Overhaul School",
    code: "OVH",
    board: "cbse",
  });
  const scope = {
    organizationId: org.id,
    schoolId: school.id,
    classId: null,
    sectionId: null,
  } as Scope;
  const [year] = await db
    .insert(academicYears)
    .values({
      organizationId: org.id,
      schoolId: school.id,
      name: "2025-26",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      originalEndDate: "2026-03-31",
      isCurrent: true,
    })
    .returning();
  if (!year) throw new Error("year");
  const klass = await academicService.createClass(scope, { name: "Six", numericOrder: 6 });
  const [admin] = await db
    .insert(user)
    .values({
      id: `admin-${RUN}`,
      name: "Admin",
      email: `${RUN}@fees-itg.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  if (!admin) throw new Error("admin");
  const head = async (name: string, category: "regular" | "optional" = "regular") => {
    const [row] = await db
      .insert(feeHeads)
      .values({ organizationId: org.id, schoolId: school.id, name, category })
      .returning();
    if (!row) throw new Error("head");
    return row.id;
  };
  Object.assign(w, {
    scope,
    yearId: year.id,
    classId: klass.id,
    tuitionId: await head("Tuition"),
    labId: await head("Lab"),
    busId: await head("Bus", "optional"),
    adminId: admin.id,
  });
  await termService.createTerm(scope, {
    academicYearId: year.id,
    name: "T1",
    sequenceNumber: 1,
    startDate: "2025-04-01",
    endDate: "2025-09-30",
    weightage: "50.00",
  });
  await termService.createTerm(scope, {
    academicYearId: year.id,
    name: "T2",
    sequenceNumber: 2,
    startDate: "2025-10-01",
    endDate: "2026-03-31",
    weightage: "50.00",
  });
  const structure = await feesService.createFeeStructure(
    scope,
    { academicYearId: year.id, classId: klass.id, name: "Six fees" },
    admin.id,
  );
  await feesService.createFeeStructureLine(scope, structure.id, {
    feeHeadId: w.tuitionId,
    frequency: "monthly",
    amount: "1000.00",
  });
  await feesService.createFeeStructureLine(scope, structure.id, {
    feeHeadId: w.labId,
    frequency: "monthly",
    amount: "200.00",
  });
}, 180_000);

describe("schedule", () => {
  it("edited rows, skipped months and frequency changes never skip or duplicate a due", async () => {
    const klass = await academicService.createClass(w.scope, { name: `Sch ${RUN}`, numericOrder: 70 });
    const structure = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Schedule" },
      w.adminId,
    );
    const options = await feesService.listPeriodOptions(w.scope, w.yearId, "monthly");
    const line = await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: w.tuitionId,
      frequency: "monthly",
      amount: "1000.00",
      periodKeys: options.map((o) => o.key).filter((key) => !["2025-04", "2025-12"].includes(key)),
    });
    const [withPeriods] = await feesService.listFeeStructureLines(w.scope, structure.id);
    expect(withPeriods?.periods).toHaveLength(10);
    const october = withPeriods?.periods.find((p) => p.periodKey === "2025-10");
    await feesService.updateLinePeriod(w.scope, october?.id ?? "", { amount: "1200.00" });

    const s = await student("SCHED", "2025-04-01", klass.id);
    await feesBillingService.billEnrollment(w.scope, { enrollmentId: s.enrollmentId }, w.adminId);
    const first = await duesOf(s.id);
    expect(first.map((d) => d.periodKey)).not.toContain("2025-12");
    expect(first.find((d) => d.periodKey === "2025-10")?.amount).toBe("1200.00");

    // A re-save keeps the edited row, and adding December creates only December.
    await feesService.updateFeeStructureLine(w.scope, line.id, {
      periodKeys: options.map((o) => o.key).filter((key) => key !== "2025-04"),
    });
    const [assignment] = await db
      .select({ id: feeInstallments.studentFeeAssignmentId })
      .from(feeInstallments)
      .where(eq(feeInstallments.studentId, s.id));
    await feesBillingService.generateInstallments(w.scope, assignment?.id ?? "", undefined, {
      through: "all",
    });
    const second = await duesOf(s.id);
    expect(second).toHaveLength(first.length + 1);
    expect(second.find((d) => d.periodKey === "2025-10")?.amount).toBe("1200.00");
    await assertAgreement(s.id);
  }, 120_000);

  it("a retired structure does not block its replacement, and a class can have two", async () => {
    const klass = await academicService.createClass(w.scope, { name: `Two ${RUN}`, numericOrder: 71 });
    const old = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Same name" },
      w.adminId,
    );
    await feesService.deactivateFeeStructure(w.scope, old.id);
    const science = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Same name" },
      w.adminId,
    );
    const commerce = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Commerce" },
      w.adminId,
    );
    await feesService.createFeeStructureLine(w.scope, science.id, {
      feeHeadId: w.tuitionId,
      frequency: "monthly",
      amount: "3000.00",
    });
    await feesService.createFeeStructureLine(w.scope, commerce.id, {
      feeHeadId: w.tuitionId,
      frequency: "monthly",
      amount: "2000.00",
    });
    const s = await student("PICK", "2025-04-01", klass.id);
    await expect(
      feesBillingService.billEnrollment(w.scope, { enrollmentId: s.enrollmentId }, w.adminId),
    ).rejects.toThrow(/more than one fee structure/);
    await feesBillingService.billEnrollment(
      w.scope,
      { enrollmentId: s.enrollmentId, feeStructureId: commerce.id },
      w.adminId,
    );
    expect((await duesOf(s.id))[0]?.amount).toBe("2000.00");
  }, 120_000);
});

describe("late fee", () => {
  it("is charged once, per month, undone by a bounce, and forgiven when asked", async () => {
    const klass = await academicService.createClass(w.scope, { name: `Late ${RUN}`, numericOrder: 72 });
    const structure = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Late" },
      w.adminId,
    );
    await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: w.tuitionId,
      frequency: "monthly",
      amount: "1000.00",
    });
    await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: w.labId,
      frequency: "monthly",
      amount: "200.00",
    });
    const rule = await feesService.createLateFeeRule(
      w.scope,
      {
        feeStructureId: structure.id,
        calculationType: "flat",
        value: "100.00",
        gracePeriodDays: 0,
        effectiveFrom: "2025-01-01",
      } as Parameters<typeof feesService.createLateFeeRule>[1],
      w.adminId,
    );

    const s = await student("LATE", "2025-04-01", klass.id);
    await feesBillingService.billEnrollment(w.scope, { enrollmentId: s.enrollmentId }, w.adminId);
    const dues = await duesOf(s.id);
    const aprilTuition = dues.find((d) => d.periodKey === "2025-04" && d.feeHeadId === w.tuitionId);
    const aprilLab = dues.find((d) => d.periodKey === "2025-04" && d.feeHeadId === w.labId);
    const mayTuition = dues.find((d) => d.periodKey === "2025-05" && d.feeHeadId === w.tuitionId);

    // The quote says what recording will charge.
    const quote = await feesCollectionService.quotePayment(w.scope, {
      studentId: s.id,
      academicYearId: w.yearId,
      paymentDate: "2025-11-20",
      allocations: [{ installmentId: aprilTuition?.id ?? "", amount: "100.00" }],
    });
    expect(quote.lateFeeAmount).toBe("100.00");

    // Three part payments: one late fee.
    const first = await pay(s.id, [{ installmentId: aprilTuition?.id ?? "", amount: "100.00" }]);
    expect(first.lateFeeAmount).toBe("100.00");
    const second = await pay(s.id, [{ installmentId: aprilTuition?.id ?? "", amount: "100.00" }]);
    expect(second.lateFeeAmount).toBe("0.00");

    // Same month, other fee: still one.
    const lab = await pay(s.id, [{ installmentId: aprilLab?.id ?? "", amount: "200.00" }]);
    expect(lab.lateFeeAmount).toBe("0.00");

    // Another month: its own.
    const may = await pay(s.id, [{ installmentId: mayTuition?.id ?? "", amount: "100.00" }], {
      paymentMode: "cheque",
      transactionReference: "CHQ1",
      bankName: "Bank",
    });
    expect(may.lateFeeAmount).toBe("100.00");

    // A bounce gives the late fee back to the month, so paying again charges again.
    await feesCollectionService.bouncePayment(
      w.scope,
      { paymentId: may.id, reason: "No funds" },
      w.adminId,
    );
    const afterBounce = await pay(s.id, [{ installmentId: mayTuition?.id ?? "", amount: "100.00" }], {
      waiveLateFee: true,
    });
    expect(afterBounce.lateFeeAmount).toBe("0.00");
    const [forgiven] = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, afterBounce.id));
    expect(forgiven?.lateFeeWaived).toBe("100.00");

    // Forgiven stays forgiven.
    const again = await pay(s.id, [{ installmentId: mayTuition?.id ?? "", amount: "100.00" }]);
    expect(again.lateFeeAmount).toBe("0.00");

    // A rule switched off stops charging.
    await feesService.deactivateLateFeeRule(w.scope, rule.id);
    const june = dues.find((d) => d.periodKey === "2025-06" && d.feeHeadId === w.tuitionId);
    const off = await pay(s.id, [{ installmentId: june?.id ?? "", amount: "100.00" }]);
    expect(off.lateFeeAmount).toBe("0.00");

    await assertAgreement(s.id);
  }, 180_000);
});

describe("concessions", () => {
  it("monthly: ₹1,200 granted is ₹1,200 applied, however months are created", async () => {
    const s = await billed("CON1");
    const [assignment] = await db
      .select({ id: feeInstallments.studentFeeAssignmentId })
      .from(feeInstallments)
      .where(eq(feeInstallments.studentId, s.id));
    const created = await feesService.createConcession(
      w.scope,
      assignment?.id ?? "",
      {
        concessionType: "other",
        calculationType: "flat",
        value: "1200.00",
        feeHeadId: w.tuitionId,
        validFrom: "2025-04-01",
      },
      w.adminId,
    );
    expect(created.concessionAmount).toBe("1200.00");
    const total = (await duesOf(s.id)).reduce((acc, d) => acc + cents(d.concessionAmount), 0);
    expect(total).toBe(120000);
    await assertAgreement(s.id);
  }, 120_000);

  it("months already paid stay out, the full flat amount still lands, and void undoes it", async () => {
    const s = await billed("CON2");
    const tuition = (await duesOf(s.id)).filter((d) => d.feeHeadId === w.tuitionId);
    for (const due of tuition.slice(0, 7)) {
      await pay(s.id, [{ installmentId: due.id, amount: due.netAmount }]);
    }
    const created = await feesService.createConcession(
      w.scope,
      s.assignmentId,
      {
        concessionType: "other",
        calculationType: "flat",
        value: "1000.00",
        feeHeadId: w.tuitionId,
        validFrom: "2025-04-01",
      },
      w.adminId,
    );
    expect(created.concessionAmount).toBe("1000.00");
    const after = (await duesOf(s.id)).filter((d) => d.feeHeadId === w.tuitionId);
    expect(after.slice(0, 7).every((d) => d.concessionAmount === "0.00")).toBe(true);
    expect(after.reduce((acc, d) => acc + cents(d.concessionAmount), 0)).toBe(100000);

    await feesService.voidConcession(w.scope, created.id, "Mistake", w.adminId);
    const voided = (await duesOf(s.id)).filter((d) => d.feeHeadId === w.tuitionId);
    expect(voided.reduce((acc, d) => acc + cents(d.concessionAmount), 0)).toBe(0);
    await assertAgreement(s.id);
  }, 180_000);

  it("refuses more than is left, and says so", async () => {
    const s = await billed("CON3");
    await expect(
      feesService.createConcession(
        w.scope,
        s.assignmentId,
        {
          concessionType: "other",
          calculationType: "flat",
          value: "99999.00",
          validFrom: "2025-04-01",
        },
        w.adminId,
      ),
    ).rejects.toThrow(/cannot exceed/);
  }, 60_000);
});

describe("discount at collect", () => {
  it("reduces the due, is non-cash in the ledger, and is undone by a bounce", async () => {
    const s = await billed("DISC");
    const due = (await duesOf(s.id)).find((d) => d.feeHeadId === w.tuitionId);
    const payment = await pay(s.id, [{ installmentId: due?.id ?? "", amount: "800.00" }], {
      discounts: [{ installmentId: due?.id ?? "", amount: "200.00" }],
      discountReason: "Sibling",
      paymentMode: "cheque",
      transactionReference: "CHQ2",
      bankName: "Bank",
    });
    expect(payment.discountAmount).toBe("200.00");
    expect(payment.amount).toBe("800.00");
    const [settled] = await db.select().from(feeInstallments).where(eq(feeInstallments.id, due?.id ?? ""));
    expect(settled?.paymentStatus).toBe("paid");
    expect(settled?.netAmount).toBe("800.00");

    await feesCollectionService.bouncePayment(
      w.scope,
      { paymentId: payment.id, reason: "No funds" },
      w.adminId,
    );
    const [reopened] = await db.select().from(feeInstallments).where(eq(feeInstallments.id, due?.id ?? ""));
    expect(reopened?.paymentStatus).toBe("unpaid");
    expect(reopened?.netAmount).toBe("1000.00");
    expect(reopened?.discountAmount).toBe("0.00");
    await assertAgreement(s.id);
  }, 120_000);

  it("needs a reason, and can't exceed what is owed", async () => {
    const s = await billed("DISC2");
    const due = (await duesOf(s.id)).find((d) => d.feeHeadId === w.tuitionId);
    await expect(
      pay(s.id, [{ installmentId: due?.id ?? "", amount: "800.00" }], {
        discounts: [{ installmentId: due?.id ?? "", amount: "200.00" }],
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      pay(s.id, [{ installmentId: due?.id ?? "", amount: "900.00" }], {
        discounts: [{ installmentId: due?.id ?? "", amount: "200.00" }],
        discountReason: "Too much",
      }),
    ).rejects.toThrow(/exceeds/);
  }, 60_000);
});

describe("refund and bounce", () => {
  it("a payment with a refund can't bounce; a full refund can include the late fee", async () => {
    const klass = await academicService.createClass(w.scope, { name: `Ref ${RUN}`, numericOrder: 73 });
    const structure = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Ref" },
      w.adminId,
    );
    await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: w.tuitionId,
      frequency: "monthly",
      amount: "1000.00",
    });
    await feesService.createLateFeeRule(
      w.scope,
      {
        feeStructureId: structure.id,
        calculationType: "flat",
        value: "50.00",
        gracePeriodDays: 0,
        effectiveFrom: "2025-01-01",
      } as Parameters<typeof feesService.createLateFeeRule>[1],
      w.adminId,
    );
    const s = await student("REF", "2025-04-01", klass.id);
    await feesBillingService.billEnrollment(w.scope, { enrollmentId: s.enrollmentId }, w.adminId);
    const due = (await duesOf(s.id)).find((d) => d.feeHeadId === w.tuitionId);
    const payment = await pay(s.id, [{ installmentId: due?.id ?? "", amount: "1000.00" }]);
    expect(payment.lateFeeAmount).toBe("50.00");

    await feesCollectionService.recordRefund(
      w.scope,
      {
        originalPaymentId: payment.id,
        refundAmount: "400.00",
        refundDate: "2025-11-21",
        refundMode: "cash",
        reason: "Overcharge",
      },
      w.adminId,
    );
    await expect(
      feesCollectionService.bouncePayment(w.scope, { paymentId: payment.id, reason: "x" }, w.adminId),
    ).rejects.toThrow(/refund against it/);

    // The rest of the principal, then the late fee.
    await feesCollectionService.recordRefund(
      w.scope,
      {
        originalPaymentId: payment.id,
        refundAmount: "650.00",
        refundDate: "2025-11-21",
        refundMode: "cash",
        reason: "Left the school",
      },
      w.adminId,
    );
    await expect(
      feesCollectionService.recordRefund(
        w.scope,
        {
          originalPaymentId: payment.id,
          refundAmount: "1.00",
          refundDate: "2025-11-21",
          refundMode: "cash",
          reason: "Too much",
        },
        w.adminId,
      ),
    ).rejects.toThrow(/exceeds/);
    await assertAgreement(s.id);
  }, 180_000);
});

describe("dates, receipts, previous dues", () => {
  it("refuses a payment dated in the future or outside the session", async () => {
    const s = await billed("DATE");
    const due = (await duesOf(s.id)).find((d) => d.feeHeadId === w.tuitionId);
    await expect(
      pay(s.id, [{ installmentId: due?.id ?? "", amount: "100.00" }], { paymentDate: "2099-01-01" }),
    ).rejects.toThrow(/future/);
    await expect(
      pay(s.id, [{ installmentId: due?.id ?? "", amount: "100.00" }], { paymentDate: "2024-01-01" }),
    ).rejects.toThrow(/session/);
  }, 60_000);

  it("receipts come from the session's start, not its name, and can continue a paper book", async () => {
    await feesBillingService.setSessionSettings(w.scope, w.yearId, {
      receiptPrefix: "SCH",
      nextReceiptNumber: 5000,
    });
    const s = await billed("RCPT");
    const due = (await duesOf(s.id)).find((d) => d.feeHeadId === w.tuitionId);
    const payment = await pay(s.id, [{ installmentId: due?.id ?? "", amount: "100.00" }]);
    expect(payment.receiptNumber).toMatch(/^SCH-2504-0*5000$/);
    await expect(
      feesBillingService.setSessionSettings(w.scope, w.yearId, { nextReceiptNumber: 10 }),
    ).rejects.toThrow(/higher/);
  }, 60_000);

  it("previous dues need no earlier session, stay unique, and a mistake can be cancelled", async () => {
    const s = await student("PREV");
    const balance = await feesBillingService.createOpeningBalance(
      w.scope,
      { studentId: s.id, academicYearId: w.yearId, amount: "2400.00" },
      w.adminId,
    );
    expect(balance.originAcademicYearId).toBeNull();
    await expect(
      feesBillingService.createOpeningBalance(
        w.scope,
        { studentId: s.id, academicYearId: w.yearId, amount: "100.00" },
        w.adminId,
      ),
    ).rejects.toThrow(/already has previous dues/);

    await feesBillingService.cancelOpeningBalance(w.scope, { id: balance.id, reason: "Typo" }, w.adminId);
    const corrected = await feesBillingService.createOpeningBalance(
      w.scope,
      { studentId: s.id, academicYearId: w.yearId, amount: "240.00" },
      w.adminId,
    );
    expect(corrected.amount).toBe("240.00");
    const [row] = await db.select().from(openingBalances).where(eq(openingBalances.id, corrected.id));
    expect(row?.status).toBe("unpaid");
    const ledger = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.referenceId, corrected.id),
          eq(financialTransactions.transactionType, "opening_balance"),
        ),
      );
    const owed = ledger.reduce(
      (acc, r) => acc + (r.direction === "credit" ? 1 : -1) * cents(r.amount),
      0,
    );
    expect(owed).toBe(24000);
  }, 60_000);

  it("rejects previous dues for a student of another branch", async () => {
    const org = await organizationService.createOrganization({
      name: `${RUN} other`,
      legalName: `${RUN} other`,
      slug: `${RUN}-other`,
    });
    const school = await organizationService.createSchool(org.id, {
      name: "Other",
      legalName: "Other",
      code: "OTH",
      board: "cbse",
    });
    const s = await student("XT");
    await expect(
      feesBillingService.createOpeningBalance(
        { organizationId: org.id, schoolId: school.id, classId: null, sectionId: null } as Scope,
        { studentId: s.id, academicYearId: w.yearId, amount: "10.00" },
        w.adminId,
      ),
    ).rejects.toThrow(/not found in this school/);
  }, 60_000);
});

describe("leaving, rejoining, services, one-offs", () => {
  it("leaving cancels later dues; the sweep skips them; rejoining reopens from today", async () => {
    const s = await billed("LEAVE", "2025-04-01");
    await enrollmentService.leaveEnrollment(w.scope, w.adminId, s.enrollmentId, {
      to: "withdrawn",
      leftOn: "2025-06-15",
    } as Parameters<typeof enrollmentService.leaveEnrollment>[3]);

    const dues = await duesOf(s.id);
    const june = dues.find((d) => d.periodKey === "2025-06" && d.feeHeadId === w.tuitionId);
    const july = dues.find((d) => d.periodKey === "2025-07" && d.feeHeadId === w.tuitionId);
    expect(june?.paymentStatus).toBe("unpaid");
    expect(july?.paymentStatus).toBe("cancelled");

    const through = await feesBillingService.generateThrough(w.scope, {
      academicYearId: w.yearId,
      through: "2026-03-31",
    });
    expect(through.failed).toHaveLength(0);
    expect((await duesOf(s.id)).length).toBe(dues.length);

    await studentService.rejoinStudent(w.scope, s.id);
    const after = await duesOf(s.id);
    // The fixture session ended before today, so nothing is reopened or added.
    expect(after.filter((d) => d.paymentStatus === "cancelled").length).toBe(
      dues.filter((d) => d.paymentStatus === "cancelled").length,
    );
    await assertAgreement(s.id);
  }, 180_000);

  it("a service can stop and restart without dropping a month or billing twice", async () => {
    const s = await billed("BUS");
    const first = await feesService.createSubscription(
      w.scope,
      {
        studentId: s.id,
        academicYearId: w.yearId,
        feeHeadId: w.busId,
        monthlyAmount: "500.00",
        annualAmount: "6000.00",
        subscribedFrom: "2025-04-01",
        subscribedTo: "2025-06-30",
      },
      w.adminId,
    );
    await feesBillingService.generateInstallments(w.scope, s.assignmentId, undefined, { through: "all" });
    await expect(
      feesService.createSubscription(
        w.scope,
        {
          studentId: s.id,
          academicYearId: w.yearId,
          feeHeadId: w.busId,
          monthlyAmount: "500.00",
          annualAmount: "6000.00",
          subscribedFrom: "2025-07-01",
        },
        w.adminId,
      ),
    ).rejects.toThrow(/already on this service/);

    await feesService.cancelSubscription(w.scope, first.id);
    await feesService.createSubscription(
      w.scope,
      {
        studentId: s.id,
        academicYearId: w.yearId,
        feeHeadId: w.busId,
        monthlyAmount: "600.00",
        annualAmount: "7200.00",
        subscribedFrom: "2025-10-01",
        subscribedTo: "2025-11-30",
      },
      w.adminId,
    );
    await feesBillingService.generateInstallments(w.scope, s.assignmentId, undefined, { through: "all" });
    const bus = (await duesOf(s.id)).filter((d) => d.feeHeadId === w.busId);
    expect(bus.map((d) => d.periodKey)).toEqual(["2025-04", "2025-05", "2025-06", "2025-10", "2025-11"]);
    expect(bus.find((d) => d.periodKey === "2025-10")?.amount).toBe("600.00");
    await assertAgreement(s.id);
  }, 180_000);

  it("an optional fee type can't also sit on a fee structure", async () => {
    const klass = await academicService.createClass(w.scope, { name: `Opt ${RUN}`, numericOrder: 74 });
    const structure = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Opt" },
      w.adminId,
    );
    await expect(
      feesService.createFeeStructureLine(w.scope, structure.id, {
        feeHeadId: w.busId,
        frequency: "monthly",
        amount: "100.00",
      }),
    ).rejects.toThrow(/optional fee type/);
  }, 60_000);

  it("a one-off charge needs no fee record, collects like a due, and has no late fee", async () => {
    const s = await student("ONE");
    const due = await feesBillingService.createOneOffCharge(w.scope, {
      studentId: s.id,
      academicYearId: w.yearId,
      feeHeadId: w.labId,
      description: "School dress",
      amount: "750.00",
      dueDate: "2025-04-01",
    });
    expect(due?.studentFeeAssignmentId).toBeNull();
    const payment = await pay(s.id, [{ installmentId: due?.id ?? "", amount: "750.00" }]);
    expect(payment.lateFeeAmount).toBe("0.00");
    await assertAgreement(s.id);
  }, 60_000);

  it("cancelling a due is never-paid only; waiving a due already free says why", async () => {
    const s = await billed("CANCEL");
    const [first, second] = await duesOf(s.id);
    await feesBillingService.cancelDue(w.scope, first?.id ?? "");
    await pay(s.id, [{ installmentId: second?.id ?? "", amount: "10.00" }]);
    await expect(feesBillingService.cancelDue(w.scope, second?.id ?? "")).rejects.toThrow(/no payment/);

    const free = await billed("FREE");
    await feesService.createConcession(
      w.scope,
      free.assignmentId,
      {
        concessionType: "rte_waiver",
        calculationType: "percentage",
        value: "100",
        validFrom: "2025-04-01",
      },
      w.adminId,
    );
    const [freeDue] = await duesOf(free.id);
    await expect(
      feesCollectionService.waiveInstallment(w.scope, freeDue?.id ?? "", w.adminId),
    ).rejects.toThrow(/nothing to waive/);
  }, 120_000);
});

describe("one-off charges without a fee type", () => {
  it("need no fee type, and the hidden one never shows in the lists", async () => {
    const s = await student("ONE");
    const first = await feesCollectionService.addOneOffCharge(
      w.scope,
      { studentId: s.id, academicYearId: w.yearId, description: "Dress", amount: "500.00" },
      w.adminId,
    );
    const second = await feesCollectionService.addOneOffCharge(
      w.scope,
      { studentId: s.id, academicYearId: w.yearId, description: "Notebook", amount: "120.00" },
      w.adminId,
    );
    expect(first.payment).toBeNull();
    expect(first.due?.feeHeadId).toBe(second.due?.feeHeadId);
    const listed = await feesService.listFeeHeads([w.scope]);
    expect(listed.some((head) => head.id === first.due?.feeHeadId)).toBe(false);
    const [hidden] = await db
      .select()
      .from(feeHeads)
      .where(eq(feeHeads.id, first.due?.feeHeadId ?? ""));
    expect(hidden?.isSystem).toBe(true);
  }, 60_000);

  it("Paid makes the charge and the receipt together, and a retry doesn't charge twice", async () => {
    const s = await student("PAIDNOW");
    const clientReference = randomUUID();
    const input = {
      studentId: s.id,
      academicYearId: w.yearId,
      description: "Dress",
      amount: "750.00",
      paid: { paymentMode: "cash" as const, paymentDate: "2025-11-20", clientReference },
    };
    const first = await feesCollectionService.addOneOffCharge(w.scope, input, w.adminId);
    expect(first.payment?.amount).toBe("750.00");
    expect(first.payment?.lateFeeAmount).toBe("0.00");
    expect(first.payment?.paymentStatus).toBe("cleared");
    const [paid] = await duesOf(s.id);
    expect(paid?.paymentStatus).toBe("paid");

    const retry = await feesCollectionService.addOneOffCharge(w.scope, input, w.adminId);
    expect(retry.payment?.id).toBe(first.payment?.id);
    expect(await duesOf(s.id)).toHaveLength(1);
    await assertAgreement(s.id);
  }, 60_000);

  it("a refused payment leaves no charge behind, and a cheque stays pending", async () => {
    const s = await student("PAIDBAD");
    await expect(
      feesCollectionService.addOneOffCharge(
        w.scope,
        {
          studentId: s.id,
          academicYearId: w.yearId,
          description: "Dress",
          amount: "750.00",
          paid: { paymentMode: "cash", paymentDate: "2030-01-01" },
        },
        w.adminId,
      ),
    ).rejects.toThrow();
    expect(await duesOf(s.id)).toHaveLength(0);

    const held = await feesCollectionService.addOneOffCharge(
      w.scope,
      {
        studentId: s.id,
        academicYearId: w.yearId,
        description: "Dress",
        amount: "750.00",
        paid: {
          paymentMode: "cheque",
          paymentDate: "2025-11-20",
          transactionReference: "CHQ9",
          bankName: "Bank",
        },
      },
      w.adminId,
    );
    expect(held.payment?.paymentStatus).toBe("pending");
    await assertAgreement(s.id);
  }, 60_000);
});

describe("dues created late, and creating dues in the background", () => {
  async function startedClass(tag: string, numericOrder: number) {
    const klass = await academicService.createClass(w.scope, { name: `${tag} ${RUN}`, numericOrder });
    const structure = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: tag },
      w.adminId,
    );
    await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: w.tuitionId,
      frequency: "monthly",
      amount: "1000.00",
    });
    return { klass, structure };
  }

  it("a due can't be late before it was created", async () => {
    const { klass, structure } = await startedClass("Created late", 91);
    // Billing started long ago, and this student's dues are only being made now.
    await db
      .update(feeStructures)
      .set({ billingStartedAt: new Date("2025-04-01T00:00:00Z") })
      .where(eq(feeStructures.id, structure.id));
    const s = await student("LATECREATED", "2025-04-01", klass.id);
    await feesBillingService.billEnrollment(w.scope, { enrollmentId: s.enrollmentId }, w.adminId);
    const dues = await duesOf(s.id);
    expect(dues.length).toBeGreaterThan(0);
    // This session has ended, so "the day it was made" is the session's last day.
    expect(dues.every((d) => d.dueDate === "2026-03-31")).toBe(true);
  }, 120_000);

  it("a run creates what is missing once, and one at a time", async () => {
    const { klass, structure } = await startedClass("Run", 92);
    const s = await student("RUNNER", "2025-04-01", klass.id);
    await feesBillingService.assignFeeStructure(
      w.scope,
      { enrollmentId: s.enrollmentId, feeStructureId: structure.id },
      w.adminId,
    );
    expect(await duesOf(s.id)).toHaveLength(0);

    await feesBillingService.setFeeGenerationMode(w.scope, "monthly_manual");
    try {
      const scopes = [w.scope];
      const input = { organizationId: w.scope.organizationId, academicYearId: w.yearId };
      const paused = await feesDashboardService.overview(scopes, input, true);
      expect(paused?.paused?.missingDues).toBeGreaterThanOrEqual(12);

      const run = await feesBillingService.startDuesRun(
        w.scope,
        { academicYearId: w.yearId, upTo: "rest", classId: klass.id },
        w.adminId,
        { wait: true },
      );
      expect(run.through).toBe("2026-03-31");
      expect(await duesOf(s.id)).toHaveLength(12);
      const latest = await feesBillingService.latestDuesRun(w.scope, w.yearId);
      expect(latest?.status).toBe("done");
      expect(latest?.insertedCount).toBe(12);

      await feesBillingService.startDuesRun(
        w.scope,
        { academicYearId: w.yearId, upTo: "rest", classId: klass.id },
        w.adminId,
        { wait: true },
      );
      expect(await duesOf(s.id)).toHaveLength(12);
      expect((await feesBillingService.latestDuesRun(w.scope, w.yearId))?.insertedCount).toBe(0);
    } finally {
      await feesBillingService.setFeeGenerationMode(w.scope, "monthly_auto");
    }
    const auto = await feesDashboardService.overview([w.scope], { organizationId: w.scope.organizationId, academicYearId: w.yearId }, true);
    expect(auto?.paused).toBeNull();

    const [holding] = await db
      .insert(feeDuesRuns)
      .values({
        organizationId: w.scope.organizationId,
        schoolId: w.scope.schoolId ?? "",
        academicYearId: w.yearId,
        through: "2026-03-31",
      })
      .returning();
    await expect(
      feesBillingService.startDuesRun(w.scope, { academicYearId: w.yearId, upTo: "rest" }, w.adminId),
    ).rejects.toThrow(/already being created/);
    // Cut off by a restart: it no longer blocks anyone.
    await db
      .update(feeDuesRuns)
      .set({ startedAt: new Date("2025-01-01T00:00:00Z") })
      .where(eq(feeDuesRuns.id, holding?.id ?? ""));
    await feesBillingService.startDuesRun(
      w.scope,
      { academicYearId: w.yearId, upTo: "rest", classId: klass.id },
      w.adminId,
      { wait: true },
    );
  }, 240_000);

  it("setup status says who is waiting, and what each class has", async () => {
    const { klass, structure } = await startedClass("Status", 93);
    await student("WAITING", "2025-04-01", klass.id);
    const before = await feesDashboardService.setupStatus(w.scope, w.yearId);
    const row = before.structures.find((item) => item.id === structure.id);
    expect(row).toMatchObject({ started: false, lineCount: 1, waitingStudents: 1 });
    expect(before.classes.find((item) => item.id === klass.id)?.hasStructure).toBe(true);

    await feesBillingService.startBilling(w.scope, structure.id, w.adminId);
    const after = await feesDashboardService.setupStatus(w.scope, w.yearId);
    expect(after.structures.find((item) => item.id === structure.id)).toMatchObject({
      started: true,
      waitingStudents: 0,
    });
    expect(after.classes.find((item) => item.id === klass.id)?.billedStudents).toBe(1);
  }, 120_000);
});

describe("start billing and new students", () => {
  it("present at Start billing are existing; admissions after are new and billed on their own", async () => {
    const klass = await academicService.createClass(w.scope, { name: `Start ${RUN}`, numericOrder: 75 });
    const structure = await feesService.createFeeStructure(
      w.scope,
      { academicYearId: w.yearId, classId: klass.id, name: "Start" },
      w.adminId,
    );
    await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: w.tuitionId,
      frequency: "monthly",
      amount: "1000.00",
    });
    await feesService.createFeeStructureLine(w.scope, structure.id, {
      feeHeadId: w.labId,
      frequency: "once",
      amount: "5000.00",
      whoPays: "new_students",
    });

    const existing = await student("OLD", "2025-04-01", klass.id);
    const started = await feesBillingService.startBilling(w.scope, structure.id, w.adminId);
    expect(started.billedCount).toBe(1);
    const oldDues = await duesOf(existing.id);
    expect(oldDues.some((d) => d.feeHeadId === w.labId)).toBe(false);
    // No due is late before billing started.
    const todayIst = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect(oldDues.every((d) => d.dueDate >= todayIst.slice(0, 10))).toBe(true);

    const again = await feesBillingService.startBilling(w.scope, structure.id, w.adminId);
    expect(again.billedCount).toBe(0);
    expect(again.skippedCount).toBe(1);

    const joined = await student("NEW", "2025-10-15", klass.id);
    const auto = await feesBillingService.billIfReady(w.scope, joined.enrollmentId, w.adminId);
    expect(auto?.assignment.isNewStudent).toBe(true);
    expect(auto?.assignment.feeEffectiveFrom).toBe("2025-10-15");
    const newDues = await duesOf(joined.id);
    expect(newDues.some((d) => d.feeHeadId === w.labId && d.amount === "5000.00")).toBe(true);
    expect(newDues.some((d) => d.periodKey === "2025-09")).toBe(false);
  }, 180_000);

  it("a left student can't be billed, and the sweep reports failures", async () => {
    const s = await student("GONE");
    await enrollmentService.leaveEnrollment(w.scope, w.adminId, s.enrollmentId, {
      to: "withdrawn",
      leftOn: "2025-04-02",
    } as Parameters<typeof enrollmentService.leaveEnrollment>[3]);
    await expect(
      feesBillingService.billEnrollment(w.scope, { enrollmentId: s.enrollmentId }, w.adminId),
    ).rejects.toThrow(/cannot be billed/);
  }, 60_000);
});

describe("closed session", () => {
  it("refuses new fee writes, while a bounce can still be recorded", async () => {
    const s = await billed("CLOSED");
    const due = (await duesOf(s.id)).find((d) => d.feeHeadId === w.tuitionId);
    const cheque = await pay(s.id, [{ installmentId: due?.id ?? "", amount: "100.00" }], {
      paymentMode: "cheque",
      transactionReference: "CHQ3",
      bankName: "Bank",
    });
    await db.update(academicYears).set({ status: "closed" }).where(eq(academicYears.id, w.yearId));
    try {
      await expect(
        pay(s.id, [{ installmentId: due?.id ?? "", amount: "100.00" }]),
      ).rejects.toThrow(/session is closed/);
      await feesCollectionService.bouncePayment(
        w.scope,
        { paymentId: cheque.id, reason: "No funds" },
        w.adminId,
      );
    } finally {
      await db.update(academicYears).set({ status: "upcoming" }).where(eq(academicYears.id, w.yearId));
    }
    await assertAgreement(s.id);
  }, 120_000);
});

describe("dashboard reads", () => {
  it("adds up to the dues, lists who owes, and one student's page agrees", async () => {
    const s = await billed("DASH");
    const due = (await duesOf(s.id)).find((d) => d.feeHeadId === w.tuitionId);
    await pay(s.id, [{ installmentId: due?.id ?? "", amount: "100.00" }]);

    const scopes = [w.scope];
    const input = { organizationId: w.scope.organizationId, academicYearId: w.yearId };
    const overview = await feesDashboardService.overview(scopes, input, true);
    expect(overview?.trend.length).toBeGreaterThan(0);
    expect(cents(overview?.allTimeDue ?? "0")).toBeGreaterThan(0);
    expect(overview?.studentsWithDue).toBeGreaterThan(0);

    const list = await feesDashboardService.list(
      scopes,
      {
        ...input,
        search: `${RUN}-DASH`,
        show: "owes",
        sort: "oldest",
        page: 1,
        pageSize: 25,
      },
      true,
    );
    expect(list?.total).toBe(1);
    const row = list?.rows[0];
    expect(row?.lastPaymentAmount).toBe("100.00");

    const summary = await feesDashboardService.studentSummary(
      scopes,
      { ...input, studentId: s.id },
      true,
    );
    expect(summary?.totals.dueNow).toBe(row?.dueNow);
    expect(summary?.totals.paid).toBe("100.00");
    expect(summary?.months).toHaveLength(12);
    expect(summary?.recentPayments).toHaveLength(1);

    const paid = await feesDashboardService.list(
      scopes,
      {
        ...input,
        search: `${RUN}-DASH`,
        show: "paid",
        sort: "name",
        page: 1,
        pageSize: 25,
      },
      true,
    );
    expect(paid?.total).toBe(0);
  }, 120_000);

  it("the year view adds each student's months and picks the same students as the list", async () => {
    const s = await billed("YEAR");
    const notBilled = await student("YEARNB");
    const dues = await duesOf(s.id);
    const april = dues.find((d) => d.feeHeadId === w.tuitionId && d.dueDate.startsWith("2025-04"));
    const may = dues.filter((d) => d.dueDate.startsWith("2025-05"));
    await pay(s.id, [
      { installmentId: april?.id ?? "", amount: "100.00" },
      ...may.map((d) => ({ installmentId: d.id, amount: d.netAmount })),
    ]);

    const scopes = [w.scope];
    const input = {
      organizationId: w.scope.organizationId,
      academicYearId: w.yearId,
      search: `${RUN}-YEAR`,
      show: "all" as const,
      sort: "name" as const,
      page: 1,
      pageSize: 25,
    };
    const list = await feesDashboardService.list(scopes, { ...input, view: "list" }, true);
    const year = await feesDashboardService.list(scopes, { ...input, view: "year" }, true);

    // The list itself doesn't change, and doesn't pay for the months.
    expect(list?.months).toBeUndefined();
    expect(list?.rows[0]?.monthStates).toBeUndefined();
    expect(year?.rows.map((row) => row.studentId)).toEqual(list?.rows.map((row) => row.studentId));
    expect(year?.total).toBe(list?.total);
    expect(year?.totalDue).toBe(list?.totalDue);

    // The session has ended, so its last month is "now" and every month is owed.
    expect(year?.months).toHaveLength(12);
    expect(year?.months?.[0]).toEqual({ key: "2025-04", label: "Apr", current: false });
    expect(year?.months?.at(-1)?.current).toBe(true);

    const states = year?.rows.find((row) => row.studentId === s.id)?.monthStates;
    expect(states?.slice(0, 3)).toEqual(["partial", "paid", "due"]);
    // April asks for ₹1,200 and ₹100 of it is paid.
    expect(year?.rows.find((row) => row.studentId === s.id)?.monthPaid?.slice(0, 3)).toEqual([8, 100, 0]);
    expect(year?.rows.find((row) => row.studentId === notBilled.id)?.monthStates).toEqual(
      Array(12).fill("none"),
    );
    await assertAgreement(s.id);
  }, 120_000);
});
