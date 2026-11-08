import {
  academicService,
  enrollmentService,
  feeDocumentsService,
  feesBillingService,
  feesCollectionService,
  feesService,
  organizationService,
  storageService,
  studentService,
} from "@repo/services";
import { db } from "@repo/db";
import { academicYears, feeHeads, feeInstallments, user } from "@repo/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { TINY_PNG, useMemoryStore } from "./storage-fixtures";

/**
 * Printed fee documents against a real database: what each one includes and
 * refuses, and that a school never prints another school's records.
 */
const RUN = `fd-${randomUUID().slice(0, 8)}`;

type Scope = Parameters<typeof feeDocumentsService.receipt>[0];
const w = {} as {
  scope: Scope;
  otherScope: Scope;
  yearId: string;
  classId: string;
  emptyClassId: string;
  structureId: string;
  adminId: string;
};

let counter = 0;
async function billed(tag: string, classId = w.classId) {
  counter += 1;
  const row = await studentService.createStudent(w.scope, {
    admissionNumber: `${RUN}-${tag}-${counter}`,
    firstName: tag,
    lastName: "Print",
    dateOfBirth: "2012-01-01",
    gender: "other",
  } as Parameters<typeof studentService.createStudent>[1]);
  const enrollment = await enrollmentService.createEnrollment(w.scope, {
    studentId: row.id,
    academicYearId: w.yearId,
    classId,
    enrollmentDate: "2025-04-01",
  } as Parameters<typeof enrollmentService.createEnrollment>[1]);
  await feesBillingService.billEnrollment(w.scope, { enrollmentId: enrollment.id }, w.adminId);
  const dues = await db
    .select()
    .from(feeInstallments)
    .where(eq(feeInstallments.studentId, row.id))
    .orderBy(feeInstallments.dueDate);
  return { id: row.id, name: `${tag} Print`, dues };
}

async function pay(
  studentId: string,
  dues: { id: string; netAmount: string }[],
  extra: Record<string, unknown> = {},
) {
  return feesCollectionService.recordPayment(
    w.scope,
    {
      studentId,
      academicYearId: w.yearId,
      paymentDate: "2025-11-20",
      paymentMode: "cash",
      allocations: dues.map((due) => ({ installmentId: due.id, amount: due.netAmount })),
      ...extra,
    } as Parameters<typeof feesCollectionService.recordPayment>[1],
    w.adminId,
  );
}

async function schoolIn(name: string) {
  const org = await organizationService.createOrganization({
    name: `${RUN} ${name}`,
    legalName: `${RUN} ${name} Trust`,
    slug: `${RUN}-${name.toLowerCase()}`,
  });
  const school = await organizationService.createSchool(org.id, {
    name: `${name} School`,
    legalName: `${name} Public School`,
    code: name.slice(0, 3).toUpperCase(),
    board: "cbse",
  });
  return { organizationId: org.id, schoolId: school.id, classId: null, sectionId: null } as Scope;
}

beforeAll(async () => {
  useMemoryStore();
  const scope = await schoolIn("Print");
  const otherScope = await schoolIn("Other");
  const [year] = await db
    .insert(academicYears)
    .values({
      organizationId: scope.organizationId,
      schoolId: scope.schoolId as string,
      name: "2025-26",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      originalEndDate: "2026-03-31",
      isCurrent: true,
    })
    .returning();
  if (!year) throw new Error("year");
  const klass = await academicService.createClass(scope, { name: "Six", numericOrder: 6 });
  const empty = await academicService.createClass(scope, { name: "Seven", numericOrder: 7 });
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
  const [tuition] = await db
    .insert(feeHeads)
    .values({
      organizationId: scope.organizationId,
      schoolId: scope.schoolId as string,
      name: "Tuition",
      category: "regular",
    })
    .returning();
  if (!tuition) throw new Error("head");
  const structure = await feesService.createFeeStructure(
    scope,
    { academicYearId: year.id, classId: klass.id, name: "Six fees" },
    admin.id,
  );
  await feesService.createFeeStructureLine(scope, structure.id, {
    feeHeadId: tuition.id,
    frequency: "monthly",
    amount: "1000.00",
  });
  Object.assign(w, {
    scope,
    otherScope,
    yearId: year.id,
    classId: klass.id,
    emptyClassId: empty.id,
    structureId: structure.id,
    adminId: admin.id,
  });
}, 180_000);

describe("receipts", () => {
  it("print what was recorded, and never another school's payment", async () => {
    const s = await billed("RECEIPT");
    const payment = await pay(s.id, s.dues.slice(0, 2));
    const doc = await feeDocumentsService.receipt(w.scope, payment.id, "a4_full");
    expect(doc?.html).toContain(payment.receiptNumber);
    expect(doc?.html).toContain("₹2,000.00");
    expect(doc?.html).toContain("Rupees Two Thousand Only");
    expect(doc?.html).toContain("Tuition");
    expect(doc?.html).toContain("Public School");
    expect(doc?.fileName).toBe(`Receipt-${payment.receiptNumber}.pdf`);

    expect(await feeDocumentsService.receipt(w.otherScope, payment.id, "a4_full")).toBeNull();
  }, 120_000);
});

describe("print settings", () => {
  it("start from defaults, and a school's lines and titles reach the paper", async () => {
    const defaults = await feeDocumentsService.getPrintSettings(w.scope);
    expect(defaults.receiptLayout).toBe("a4_half_two");
    expect(defaults.showAmountInWords).toBe(true);

    await feeDocumentsService.updatePrintSettings(w.scope, {
      headerText: "ডেমো ট্রাস্ট\nRecognised by the Board",
      titles: { receipt: "Money Receipt" },
      showAmountInWords: false,
    }, w.adminId);
    const s = await billed("SETTINGS");
    const payment = await pay(s.id, s.dues.slice(0, 1));
    const html = (await feeDocumentsService.receipt(w.scope, payment.id, undefined))?.html ?? "";
    expect(html).toContain("ডেমো ট্রাস্ট");
    expect(html).toContain("Money Receipt");
    expect(html).not.toContain("Rupees");
    expect(html).toContain("Parent copy");

    // Another school's settings stay untouched.
    expect((await feeDocumentsService.getPrintSettings(w.otherScope)).headerText).toBe("");
    await feeDocumentsService.updatePrintSettings(w.scope, { showAmountInWords: true }, w.adminId);
  }, 120_000);

  it("refuse a QR with nothing behind it, and an image from another organization", async () => {
    await expect(
      feeDocumentsService.updatePrintSettings(w.scope, { upiMode: "upi_id", upiId: null }, w.adminId),
    ).rejects.toThrow("UPI ID");
    await expect(
      feeDocumentsService.updatePrintSettings(w.scope, { upiMode: "image" }, w.adminId),
    ).rejects.toThrow("QR image");
    const foreign = await storageService.ingest({
      organizationId: w.otherScope.organizationId,
      schoolId: w.otherScope.schoolId,
      purpose: "fee_print_logo",
      parentId: w.otherScope.schoolId,
      uploadedBy: w.adminId,
      bytes: TINY_PNG,
    });
    await expect(
      feeDocumentsService.updatePrintSettings(w.scope, { logoObjectId: foreign.id }, w.adminId),
    ).rejects.toThrow("can't be used here");

    // A QR uploaded as a logo is the wrong kind of file for the QR slot.
    const logo = await feeDocumentsService.uploadPrintImage(
      w.scope,
      { kind: "logo", contentType: "image/png", dataBase64: TINY_PNG.toString("base64") },
      w.adminId,
    );
    await expect(
      feeDocumentsService.updatePrintSettings(
        w.scope,
        { upiMode: "image", upiImageObjectId: logo.objectId },
        w.adminId,
      ),
    ).rejects.toThrow("can't be used here");
  }, 60_000);

  it("print the school's own logo, and let a replaced one go", async () => {
    const first = await feeDocumentsService.uploadPrintImage(
      w.scope,
      { kind: "logo", contentType: "image/png", dataBase64: TINY_PNG.toString("base64") },
      w.adminId,
    );
    await feeDocumentsService.updatePrintSettings(w.scope, { logoObjectId: first.objectId }, w.adminId);
    const s = await billed("LOGO");
    const payment = await pay(s.id, s.dues.slice(0, 1));
    const html = (await feeDocumentsService.receipt(w.scope, payment.id, "a4_full"))?.html ?? "";
    expect(html).toContain("data:image/webp;base64,");

    const second = await feeDocumentsService.uploadPrintImage(
      w.scope,
      { kind: "logo", contentType: "image/png", dataBase64: TINY_PNG.toString("base64") },
      w.adminId,
    );
    await feeDocumentsService.updatePrintSettings(w.scope, { logoObjectId: second.objectId }, w.adminId);
    expect((await storageService.getMeta(w.scope.organizationId, first.objectId))?.status).toBe("deleted");
    expect((await storageService.getMeta(w.scope.organizationId, second.objectId))?.status).toBe("ready");
    await feeDocumentsService.updatePrintSettings(w.scope, { logoObjectId: null }, w.adminId);
    expect((await storageService.getMeta(w.scope.organizationId, second.objectId))?.status).toBe("deleted");
  }, 120_000);
});

describe("due notices and lists", () => {
  it("cover only those who owe, with a QR per student once the UPI ID is set", async () => {
    const owes = await billed("OWES");
    const paid = await billed("PAIDUP");
    await pay(paid.id, paid.dues);

    const plain = await feeDocumentsService.notices(
      w.scope,
      { academicYearId: w.yearId, classId: w.classId, perPage: 2 },
      true,
    );
    expect(plain?.html).toContain(owes.name);
    expect(plain?.html).not.toContain(paid.name);
    expect(plain?.html).not.toContain("<svg");

    await feeDocumentsService.updatePrintSettings(w.scope, {
      upiMode: "upi_id",
      upiId: "school@okaxis",
      upiPayeeName: "Print School",
    }, w.adminId);
    const withQr = await feeDocumentsService.notices(
      w.scope,
      { academicYearId: w.yearId, classId: w.classId, perPage: 4 },
      true,
    );
    const notices = withQr?.html.match(/class="notice"/g)?.length ?? 0;
    expect(notices).toBeGreaterThan(0);
    expect(withQr?.html.match(/<svg/g)).toHaveLength(notices);
    await feeDocumentsService.updatePrintSettings(w.scope, { upiMode: "off" }, w.adminId);

    const owing = await feeDocumentsService.defaulters(
      w.scope,
      { academicYearId: w.yearId, classId: w.classId },
      true,
    );
    expect(owing?.html).toContain(owes.name);
    expect(owing?.html).not.toContain(paid.name);
  }, 180_000);

  it("refuse notices for a class where nobody owes", async () => {
    await expect(
      feeDocumentsService.notices(
        w.scope,
        { academicYearId: w.yearId, classId: w.emptyClassId, perPage: 2 },
        true,
      ),
    ).rejects.toThrow("Nobody here owes");
  }, 60_000);
});

describe("no-dues certificate", () => {
  it("is refused while money is owed or a cheque hasn't cleared, and prints once settled", async () => {
    const owing = await billed("NODUESOWING");
    await expect(
      feeDocumentsService.noDues(w.scope, { academicYearId: w.yearId, studentId: owing.id }, true),
    ).rejects.toThrow("still owes");

    const byCheque = await billed("NODUESCHEQUE");
    await pay(byCheque.id, byCheque.dues, {
      paymentMode: "cheque",
      transactionReference: "CHQ123",
      bankName: "Bank",
    });
    await expect(
      feeDocumentsService.noDues(w.scope, { academicYearId: w.yearId, studentId: byCheque.id }, true),
    ).rejects.toThrow("waiting to clear");

    const settled = await billed("NODUESPAID");
    await pay(settled.id, settled.dues);
    const doc = await feeDocumentsService.noDues(
      w.scope,
      { academicYearId: w.yearId, studentId: settled.id },
      true,
    );
    expect(doc?.html).toContain("has no fees payable");
    expect(doc?.html).toContain(settled.name);

    const cheques = await feeDocumentsService.chequeList(w.scope, w.yearId);
    expect(cheques?.html).toContain("CHQ123");
  }, 180_000);
});

describe("statement, day book and structure sheet", () => {
  it("a statement lists every payment, not only the latest five", async () => {
    const s = await billed("STATEMENT");
    const receipts: string[] = [];
    for (const due of s.dues.slice(0, 6)) {
      receipts.push((await pay(s.id, [due])).receiptNumber);
    }
    const doc = await feeDocumentsService.statement(
      w.scope,
      { academicYearId: w.yearId, studentId: s.id },
      true,
    );
    for (const receipt of receipts) expect(doc?.html).toContain(receipt);
    expect(doc?.html).toContain("₹6,000.00");
  }, 180_000);

  it("the day book shows the day's receipts and what they add up to", async () => {
    const s = await billed("DAYBOOK");
    const payment = await pay(s.id, s.dues.slice(0, 3));
    const doc = await feeDocumentsService.dayBook(w.scope, { academicYearId: w.yearId, date: "2025-11-20" });
    expect(doc?.html).toContain(payment.receiptNumber);
    expect(doc?.html).toContain("Total received");
    expect(doc?.html).toContain("Cash in hand from today");
  }, 120_000);

  it("the structure sheet totals the session", async () => {
    const doc = await feeDocumentsService.structureSheet(w.scope, w.structureId, true);
    expect(doc?.html).toContain("Monthly");
    expect(doc?.html).toContain("₹12,000.00");
    expect(await feeDocumentsService.structureSheet(w.otherScope, w.structureId, true)).toBeNull();
  }, 60_000);
});
