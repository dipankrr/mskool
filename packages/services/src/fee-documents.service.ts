import { atSchoolLevel, requireSchoolId } from "./academic.service";
import { todayInIst } from "./enrollment-status";
import {
  renderChequeList,
  renderDayBook,
  type ChequeRow,
  type DayBookPayment,
} from "./fee-documents/counter";
import { dueLabel, rupees, type PrintIdentity } from "./fee-documents/html";
import {
  renderDefaulters,
  renderNotices,
  upiLink,
  type OwingStudent,
} from "./fee-documents/notices";
import { renderReceipt, type ReceiptData } from "./fee-documents/receipt";
import {
  renderNoDues,
  renderStatement,
  renderStructureSheet,
  type StudentLabel,
} from "./fee-documents/student";
import { feesDashboardService } from "./fees-dashboard.service";
import { feesService } from "./fees.service";
import { feesCollectionService } from "./fees-collection.service";
import { fromCents, toCents } from "./fees-maths";
import { refuse } from "./service-error";
import { storageService } from "./storage.service";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import QRCode from "qrcode";
import type {
  FeeDocument,
  FeeDocumentDayBookInput,
  FeeDocumentDefaultersInput,
  FeeDocumentNoticesInput,
  FeePrintSettings,
  FeeReceiptLayout,
  FeePrintImageUploadInput,
  UpdateFeePrintSettingsInput,
  UploadTicket,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  classes,
  feeHeads,
  feePrintSettings,
  feeRefunds,
  schools,
  sections,
  studentEnrollments,
  students,
} from "@repo/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * PRINTED FEE DOCUMENTS. Each method reads through the same scoped reads the
 * screens use, then hands plain data to a template and returns finished HTML. The
 * client turns that HTML into a PDF, so a layout fix ships with the API. Nothing
 * here writes to a fee table.
 */

const SETTINGS_SCOPE: ScopeColumns = {
  organizationId: feePrintSettings.organizationId,
  schoolId: feePrintSettings.schoolId,
};
const REFUND_SCOPE: ScopeColumns = {
  organizationId: feeRefunds.organizationId,
  schoolId: feeRefunds.schoolId,
};

const YEAR_SCOPE: ScopeColumns = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
};
const HEAD_SCOPE: ScopeColumns = {
  organizationId: feeHeads.organizationId,
  schoolId: feeHeads.schoolId,
};

const DEFAULT_SIGNATURE = "Authorised signature";

/** Beyond this a phone may struggle, so a batch asks for one class at a time. */
const MAX_NOTICES = 300;

const FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half yearly",
  term_wise: "Each term",
  once: "Once",
};

const MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  neft_rtgs: "NEFT / RTGS",
  card: "Card",
  dd: "Demand draft",
  online_portal: "Online",
};

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const DEFAULT_SETTINGS: FeePrintSettings = {
  headerText: "",
  subText: "",
  footerText: "",
  signatureLabel: "",
  titles: {},
  showAmountInWords: true,
  receiptLayout: "a4_half_two",
  upiMode: "off",
  upiId: null,
  upiPayeeName: null,
  logoObjectId: null,
  upiImageObjectId: null,
};

// A refusal is plain text, so it borrows the printed money format.
const rupeesText = rupees;


export class FeeDocumentsService {
  async getPrintSettings(scope: DataScope): Promise<FeePrintSettings> {
    requireSchoolId(scope);
    const [row] = await db
      .select()
      .from(feePrintSettings)
      .where(scopeWhere([{ ...scope, classId: null, sectionId: null }], SETTINGS_SCOPE));
    if (!row) return DEFAULT_SETTINGS;
    return {
      headerText: row.headerText,
      subText: row.subText,
      footerText: row.footerText,
      signatureLabel: row.signatureLabel,
      titles: row.titles,
      showAmountInWords: row.showAmountInWords,
      receiptLayout: row.receiptLayout,
      upiMode: row.upiMode,
      upiId: row.upiId,
      upiPayeeName: row.upiPayeeName,
      logoObjectId: row.logoObjectId,
      upiImageObjectId: row.upiImageObjectId,
    };
  }

  async updatePrintSettings(
    scope: DataScope,
    input: UpdateFeePrintSettingsInput,
    userId: string,
  ): Promise<FeePrintSettings> {
    const schoolId = requireSchoolId(scope);
    const current = await this.getPrintSettings(scope);
    const next: FeePrintSettings = {
      ...current,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    };
    if (next.upiMode === "upi_id" && !next.upiId) {
      throw refuse("BAD_REQUEST", "Enter the school's UPI ID, or turn the QR off.");
    }
    if (next.upiMode === "image" && !next.upiImageObjectId) {
      throw refuse("BAD_REQUEST", "Upload the QR image, or turn the QR off.");
    }
    // A file the caller just PUT is processed before anything is linked.
    await storageService.ensureReady(
      userId,
      [next.logoObjectId, next.upiImageObjectId].filter((id): id is string => Boolean(id)),
    );
    await db.transaction(async (tx) => {
      // Only images uploaded for this school's printing, of the right kind,
      // can be pointed at (ADR-063); a replaced or cleared one is let go.
      const slots = [
        { purpose: "fee_print_logo" as const, before: current.logoObjectId, after: next.logoObjectId },
        { purpose: "fee_upi_qr" as const, before: current.upiImageObjectId, after: next.upiImageObjectId },
      ];
      for (const slot of slots) {
        if (slot.after && slot.after !== slot.before) {
          await storageService.attach(tx, {
            organizationId: scope.organizationId,
            purpose: slot.purpose,
            parentId: schoolId,
            userId,
            objectIds: [slot.after],
          });
        }
      }
      await tx
        .insert(feePrintSettings)
        .values({ ...next, organizationId: scope.organizationId, schoolId })
        .onConflictDoUpdate({ target: feePrintSettings.schoolId, set: { ...next, updatedAt: new Date() } });
      await storageService.markDeleted(
        tx,
        scope.organizationId,
        slots.flatMap((s) => (s.before && s.before !== s.after ? [s.before] : [])),
      );
    });
    return next;
  }

  /**
   * An upload link for the school's logo or UPI QR (ADR-063). The client PUTs
   * the file, then saves the settings with the returned id; the save
   * processes and links it.
   */
  async printImageUpload(
    scope: DataScope,
    input: FeePrintImageUploadInput,
    userId: string,
  ): Promise<UploadTicket> {
    const schoolId = requireSchoolId(scope);
    const [ticket] = await storageService.createUploads({
      organizationId: scope.organizationId,
      schoolId,
      purpose: input.kind === "upi_qr" ? "fee_upi_qr" : "fee_print_logo",
      parentId: schoolId,
      uploadedBy: userId,
      files: [input.file],
    });
    if (!ticket) throw new Error("No upload link was created.");
    return ticket;
  }

  /** The school as it prints: its record, plus what it has set for printing. */
  private async identity(scope: DataScope, settings: FeePrintSettings): Promise<PrintIdentity> {
    const schoolId = requireSchoolId(scope);
    const [school] = await db
      .select()
      .from(schools)
      .where(and(eq(schools.id, schoolId), eq(schools.organizationId, scope.organizationId)));
    if (!school) throw refuse("NOT_FOUND", "School not found.");

    const logo = settings.logoObjectId
      ? await storageService.getBytes(scope.organizationId, settings.logoObjectId)
      : null;

    return {
      schoolName: school.legalName || school.name,
      addressLine: [school.addressLine1, school.addressLine2, school.city, school.state, school.pincode]
        .filter(Boolean)
        .join(", "),
      contactLine: [school.phone, school.email].filter(Boolean).join(" · "),
      affiliationLine: school.affiliationNumber ? `Affiliation No: ${school.affiliationNumber}` : "",
      headerLines: linesOf(settings.headerText),
      subLines: linesOf(settings.subText),
      footerLines: linesOf(settings.footerText),
      signatureLabel: settings.signatureLabel.trim() || DEFAULT_SIGNATURE,
      titles: settings.titles,
      showAmountInWords: settings.showAmountInWords,
      logoDataUri: logo
        ? `data:${logo.contentType};base64,${Buffer.from(logo.data).toString("base64")}`
        : null,
    };
  }

  /** A receipt prints what was recorded on the payment, never a recalculation. */
  async receipt(
    scope: DataScope,
    paymentId: string,
    layout: FeeReceiptLayout | undefined,
  ): Promise<FeeDocument | null> {
    const detail = await feesCollectionService.getPaymentDetail(scope, paymentId);
    if (!detail) return null;
    const { payment, allocations, openingBalanceAllocations } = detail;

    const [person] = await db
      .select({
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        admissionNumber: students.admissionNumber,
        className: classes.name,
        sectionName: sections.name,
      })
      .from(students)
      .leftJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, students.id),
          eq(studentEnrollments.academicYearId, payment.academicYearId),
        ),
      )
      .leftJoin(classes, eq(classes.id, studentEnrollments.classId))
      .leftJoin(sections, eq(sections.id, studentEnrollments.sectionId))
      .where(and(eq(students.id, payment.studentId), eq(students.schoolId, payment.schoolId)));

    const [refunds] = await db
      .select({ total: sql<string>`coalesce(sum(${feeRefunds.refundAmount}), 0)::numeric(12,2)::text` })
      .from(feeRefunds)
      .where(
        and(
          eq(feeRefunds.originalPaymentId, payment.id),
          scopeWhere([{ ...scope, classId: null, sectionId: null }], REFUND_SCOPE),
        ),
      );

    const settings = await this.getPrintSettings(scope);
    const identity = await this.identity(scope, settings);

    const data: ReceiptData = {
      receiptNumber: payment.receiptNumber,
      paymentDate: payment.paymentDate,
      studentName: person
        ? [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ")
        : "",
      admissionNumber: person?.admissionNumber ?? "",
      classLine: person?.className
        ? [person.className, person.sectionName].filter(Boolean).join(" · ")
        : null,
      lines: [
        ...openingBalanceAllocations.map((row) => ({
          label: row.description?.trim() || `Carried forward from ${row.originAcademicYearName}`,
          amount: row.amountAllocated,
        })),
        ...allocations.map((row) => ({ label: dueLabel(row), amount: row.amountAllocated })),
      ],
      amount: payment.amount,
      lateFee: payment.lateFeeAmount,
      discount: payment.discountAmount ?? "0.00",
      total: payment.totalAmount ?? fromCents(toCents(payment.amount) + toCents(payment.lateFeeAmount)),
      modeLabel: MODE_LABEL[payment.paymentMode] ?? payment.paymentMode,
      reference: payment.transactionReference,
      bankName: payment.bankName,
      chequeDate: payment.chequeDate,
      remarks: payment.remarks,
      status: payment.paymentStatus,
      refunded: refunds?.total ?? "0.00",
    };
    return renderReceipt(identity, data, layout ?? settings.receiptLayout);
  }

  private async sessionName(scope: DataScope, academicYearId: string): Promise<string | null> {
    const [year] = await db
      .select({ name: academicYears.name })
      .from(academicYears)
      .where(and(eq(academicYears.id, academicYearId), scopeWhere([atSchoolLevel(scope)], YEAR_SCOPE)));
    return year?.name ?? null;
  }

  /** Everyone who owes, in class order: the same figures the dashboard shows. */
  private async owing(
    scope: DataScope,
    input: { academicYearId: string; classId?: string; sectionId?: string },
    includeHistory: boolean,
  ): Promise<{ rows: OwingStudent[]; total: string } | null> {
    const list = await feesDashboardService.list(
      [scope],
      {
        organizationId: scope.organizationId,
        academicYearId: input.academicYearId,
        classId: input.classId,
        sectionId: input.sectionId,
        show: "owes",
        sort: "name",
        page: 1,
        pageSize: 5000,
      },
      includeHistory,
    );
    if (!list) return null;
    const rows = [...list.rows].sort(
      (a, b) =>
        a.className.localeCompare(b.className, undefined, { numeric: true }) ||
        (a.sectionName ?? "").localeCompare(b.sectionName ?? "") ||
        Number(a.rollNumber ?? 0) - Number(b.rollNumber ?? 0) ||
        a.studentName.localeCompare(b.studentName),
    );
    return {
      rows: rows.map((row) => ({
        name: row.studentName,
        admissionNumber: row.admissionNumber,
        className: row.className,
        sectionName: row.sectionName,
        rollNumber: row.rollNumber,
        dueNow: row.dueNow,
        thisMonth: row.thisMonth,
        overdue: row.overdue,
        previousDues: row.previousDues,
        overdueMonths: row.overdueMonths,
      })),
      total: list.totalDue,
    };
  }

  /** "Class 6 · A" when one class is printed, otherwise everyone. */
  private scopeLabel(rows: OwingStudent[], input: { classId?: string; sectionId?: string }): string {
    const first = rows[0];
    if (!first || !input.classId) return "All classes";
    return input.sectionId && first.sectionName
      ? `${first.className} ${first.sectionName}`
      : first.className;
  }

  async notices(
    scope: DataScope,
    input: FeeDocumentNoticesInput,
    includeHistory: boolean,
  ): Promise<FeeDocument | null> {
    const owing = await this.owing(scope, input, includeHistory);
    if (!owing) return null;
    if (owing.rows.length === 0) {
      throw refuse("CONFLICT", "Nobody here owes anything right now.");
    }
    if (owing.rows.length > MAX_NOTICES) {
      throw refuse("BAD_REQUEST", `That's ${owing.rows.length} notices. Choose one class at a time.`);
    }

    const settings = await this.getPrintSettings(scope);
    const identity = await this.identity(scope, settings);
    const payee = settings.upiPayeeName?.trim() || identity.schoolName;

    let kind: "svg" | "image" | "none" = "none";
    let imageDataUri: string | null = null;
    if (settings.upiMode === "upi_id" && settings.upiId) {
      kind = "svg";
      const upiId = settings.upiId;
      await Promise.all(
        owing.rows.map(async (row) => {
          row.qrSvg = await QRCode.toString(
            upiLink({ upiId, payeeName: payee, amount: row.dueNow, note: row.admissionNumber }),
            { type: "svg", margin: 0, errorCorrectionLevel: "M" },
          );
        }),
      );
    } else if (settings.upiMode === "image" && settings.upiImageObjectId) {
      const image = await storageService.getBytes(scope.organizationId, settings.upiImageObjectId);
      if (image) {
        kind = "image";
        imageDataUri = `data:${image.contentType};base64,${Buffer.from(image.data).toString("base64")}`;
      }
    }

    return renderNotices(identity, {
      rows: owing.rows,
      perPage: input.perPage,
      today: todayInIst(),
      scopeLabel: this.scopeLabel(owing.rows, input),
      qr: { kind, schoolName: payee, imageDataUri },
    });
  }

  async defaulters(
    scope: DataScope,
    input: FeeDocumentDefaultersInput,
    includeHistory: boolean,
  ): Promise<FeeDocument | null> {
    const owing = await this.owing(scope, input, includeHistory);
    if (!owing) return null;
    const sessionName = await this.sessionName(scope, input.academicYearId);
    const identity = await this.identity(scope, await this.getPrintSettings(scope));
    return renderDefaulters(identity, {
      rows: owing.rows,
      total: owing.total,
      sessionName: sessionName ?? "",
      today: todayInIst(),
      scopeLabel: this.scopeLabel(owing.rows, input),
    });
  }

  async dayBook(scope: DataScope, input: FeeDocumentDayBookInput): Promise<FeeDocument | null> {
    if (!(await this.sessionName(scope, input.academicYearId))) return null;
    const payments = await feesCollectionService.listPayments(
      [atSchoolLevel(scope)],
      input.academicYearId,
    );
    const refundRows = await db
      .select({
        amount: feeRefunds.refundAmount,
        mode: feeRefunds.refundMode,
        reason: feeRefunds.reason,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
      })
      .from(feeRefunds)
      .innerJoin(students, eq(students.id, feeRefunds.studentId))
      .where(
        and(
          eq(feeRefunds.refundDate, input.date),
          eq(feeRefunds.academicYearId, input.academicYearId),
          scopeWhere([atSchoolLevel(scope)], REFUND_SCOPE),
        ),
      );
    const identity = await this.identity(scope, await this.getPrintSettings(scope));
    const rows: DayBookPayment[] = payments
      .filter((row) => row.paymentDate === input.date)
      .map((row) => ({
        receiptNumber: row.receiptNumber,
        studentName: row.studentName,
        classLine: row.className ? [row.className, row.sectionName].filter(Boolean).join(" · ") : null,
        modeLabel: MODE_LABEL[row.paymentMode] ?? row.paymentMode,
        reference: row.transactionReference,
        total: row.totalAmount ?? row.amount,
        status: row.paymentStatus,
      }));
    return renderDayBook(identity, {
      date: input.date,
      payments: rows,
      refunds: refundRows.map((row) => ({
        studentName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
        modeLabel: MODE_LABEL[row.mode] ?? row.mode,
        amount: row.amount,
        reason: row.reason,
      })),
    });
  }

  async chequeList(scope: DataScope, academicYearId: string): Promise<FeeDocument | null> {
    const sessionName = await this.sessionName(scope, academicYearId);
    if (!sessionName) return null;
    const payments = await feesCollectionService.listPayments([atSchoolLevel(scope)], academicYearId);
    const identity = await this.identity(scope, await this.getPrintSettings(scope));
    const rows: ChequeRow[] = payments
      .filter(
        (row) =>
          row.paymentStatus === "pending" && (row.paymentMode === "cheque" || row.paymentMode === "dd"),
      )
      .map((row) => ({
        paymentDate: row.paymentDate,
        reference: row.transactionReference,
        bankName: row.bankName,
        chequeDate: row.chequeDate,
        studentName: row.studentName,
        classLine: row.className ? [row.className, row.sectionName].filter(Boolean).join(" · ") : null,
        receiptNumber: row.receiptNumber,
        modeLabel: MODE_LABEL[row.paymentMode] ?? row.paymentMode,
        total: row.totalAmount ?? row.amount,
      }));
    return renderChequeList(identity, { rows, today: todayInIst(), sessionName });
  }

  private async studentFacts(
    scope: DataScope,
    input: { academicYearId: string; studentId: string },
    includeHistory: boolean,
  ) {
    const summary = await feesDashboardService.studentSummary(
      [scope],
      { organizationId: scope.organizationId, ...input },
      includeHistory,
    );
    if (!summary) return null;
    const student: StudentLabel = {
      name: summary.student.name,
      admissionNumber: summary.student.admissionNumber,
      classLine: summary.student.className
        ? [summary.student.className, summary.student.sectionName].filter(Boolean).join(" · ")
        : null,
    };
    const sessionName = (await this.sessionName(scope, input.academicYearId)) ?? "";
    return { summary, student, sessionName };
  }

  async statement(
    scope: DataScope,
    input: { academicYearId: string; studentId: string },
    includeHistory: boolean,
  ): Promise<FeeDocument | null> {
    const facts = await this.studentFacts(scope, input, includeHistory);
    if (!facts) return null;
    const { summary, student, sessionName } = facts;

    // The page's own payment list stops at the latest five; a statement shows them all.
    const payments = await feesCollectionService.listPayments(
      [atSchoolLevel(scope)],
      input.academicYearId,
      input.studentId,
    );
    const refunds = await db
      .select({
        paymentId: feeRefunds.originalPaymentId,
        total: sql<string>`coalesce(sum(${feeRefunds.refundAmount}), 0)::numeric(12,2)::text`,
      })
      .from(feeRefunds)
      .where(
        and(
          eq(feeRefunds.studentId, input.studentId),
          eq(feeRefunds.academicYearId, input.academicYearId),
          scopeWhere([atSchoolLevel(scope)], REFUND_SCOPE),
        ),
      )
      .groupBy(feeRefunds.originalPaymentId);
    const refundOf = new Map(refunds.map((row) => [row.paymentId, row.total]));

    const heads = await db
      .select({ id: feeHeads.id, name: feeHeads.name })
      .from(feeHeads)
      .where(scopeWhere([atSchoolLevel(scope)], HEAD_SCOPE));
    const headName = new Map(heads.map((row) => [row.id, row.name]));

    const identity = await this.identity(scope, await this.getPrintSettings(scope));
    return renderStatement(identity, {
      student,
      sessionName,
      today: todayInIst(),
      dues: summary.dues.map((row) => ({
        dueDate: row.dueDate,
        label: dueLabel({ description: row.description, feeHeadName: headName.get(row.feeHeadId) ?? "Fee" }),
        net: row.netAmount,
        paid: row.paidAmount,
        status: row.paymentStatus,
      })),
      previousDues: summary.previousDues.map((row) => ({
        label: row.description?.trim() || "Previous dues",
        amount: row.amount,
        paid: row.paidAmount,
      })),
      payments: payments.map((row) => ({
        date: row.paymentDate,
        receiptNumber: row.receiptNumber,
        modeLabel: MODE_LABEL[row.paymentMode] ?? row.paymentMode,
        total: row.totalAmount ?? row.amount,
        discount: row.discountAmount ?? "0.00",
        status: row.paymentStatus,
        refunded: refundOf.get(row.id) ?? "0.00",
      })),
      totals: summary.totals,
    });
  }

  /** Refused while anything is owed, later or now, or a cheque hasn't cleared. */
  async noDues(
    scope: DataScope,
    input: { academicYearId: string; studentId: string },
    includeHistory: boolean,
  ): Promise<FeeDocument | null> {
    const facts = await this.studentFacts(scope, input, includeHistory);
    if (!facts) return null;
    const { summary, student, sessionName } = facts;
    if (toCents(summary.totals.dueNow) > 0n) {
      throw refuse("CONFLICT", `${student.name} still owes ${rupeesText(summary.totals.dueNow)}.`);
    }
    if (toCents(summary.totals.later) > 0n) {
      throw refuse(
        "CONFLICT",
        `${student.name} has ${rupeesText(summary.totals.later)} of dues later this session. Cancel the ones that no longer apply first.`,
      );
    }
    const payments = await feesCollectionService.listPayments(
      [atSchoolLevel(scope)],
      input.academicYearId,
      input.studentId,
    );
    if (payments.some((row) => row.paymentStatus === "pending")) {
      throw refuse("CONFLICT", `${student.name} has a payment still waiting to clear.`);
    }
    const identity = await this.identity(scope, await this.getPrintSettings(scope));
    return renderNoDues(identity, { student, sessionName, today: todayInIst() });
  }

  async structureSheet(
    scope: DataScope,
    structureId: string,
    includeHistory: boolean,
  ): Promise<FeeDocument | null> {
    const structure = await feesService.getFeeStructureById(scope, structureId, includeHistory);
    if (!structure) return null;
    const lines = await feesService.listFeeStructureLines(scope, structureId);
    const heads = await db
      .select({ id: feeHeads.id, name: feeHeads.name })
      .from(feeHeads)
      .where(scopeWhere([atSchoolLevel(scope)], HEAD_SCOPE));
    const headName = new Map(heads.map((row) => [row.id, row.name]));
    const [klass] = structure.classId
      ? await db
          .select({ name: classes.name })
          .from(classes)
          .where(and(eq(classes.id, structure.classId), eq(classes.schoolId, structure.schoolId)))
      : [];
    const identity = await this.identity(scope, await this.getPrintSettings(scope));
    return renderStructureSheet(identity, {
      structureName: structure.name,
      className: klass?.name ?? null,
      sessionName: (await this.sessionName(scope, structure.academicYearId)) ?? "",
      lines: lines.map((line) => ({
        name: headName.get(line.feeHeadId) ?? "Fee",
        frequencyLabel: FREQUENCY_LABEL[line.frequency] ?? line.frequency,
        note: line.whoPays === "new_students" ? "New students only" : null,
        total: fromCents(line.periods.reduce((sum, period) => sum + toCents(period.amount), 0n)),
        periods: line.periods.map((period) => ({
          label: period.label,
          dueDate: period.dueDate,
          amount: period.amount,
        })),
      })),
    });
  }
}

export const feeDocumentsService = new FeeDocumentsService();
