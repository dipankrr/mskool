import { db } from "@repo/db";
import { feeHeads, feePayments, feeRefunds } from "@repo/db/schema";
import type { DataScope } from "@repo/authz";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { feeDocumentsService } from "./fee-documents.service";
import { feesCollectionService } from "./fees-collection.service";
import { feesDashboardService } from "./fees-dashboard.service";
import { fromCents, toCents } from "./fees-maths";
import { resolvePortalChild, type PortalChild } from "./portal-child";
import { refuse } from "./service-error";

/**
 * The family fee reads (ADR-062): `portalFees.summary`, `.payment`,
 * `.receipt` and `.statement`. Read-only mirrors of the admin student fee
 * page and the printed documents (ADR-058, ADR-059), reshaped so a family
 * never receives staff columns: no collector, no staff remarks or reversal
 * reasons on screen, no concession reasons (owner F2), no structure choices.
 *
 * The staff services take a `DataScope`; here it is built from the CHILD's
 * school, never from the session, and every payment id is checked against
 * the child before anything is read.
 */

function childScope(child: PortalChild): DataScope {
  return {
    organizationId: child.organizationId,
    schoolId: child.schoolId,
    classId: null,
    sectionId: null,
  };
}

const PAYMENT_NOT_FOUND = "Payment not found.";

class PortalFeesService {
  async summary(
    ownedStudentIds: readonly string[],
    input: { studentId: string; academicYearId?: string },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId, input.academicYearId);
    const scope = childScope(child);

    const [summary, payments, heads] = await Promise.all([
      feesDashboardService.studentSummary(
        [scope],
        {
          organizationId: child.organizationId,
          academicYearId: child.academicYearId,
          studentId: child.studentId,
        },
        true,
      ),
      this.payments(child),
      db
        .select({ id: feeHeads.id, name: feeHeads.name })
        .from(feeHeads)
        .where(eq(feeHeads.schoolId, child.schoolId)),
    ]);
    if (!summary) throw refuse("NOT_FOUND", "Student not found.");
    const headName = new Map(heads.map((h) => [h.id, h.name]));

    return {
      student: {
        id: child.studentId,
        name: summary.student.name,
        className: summary.student.className,
        sectionName: summary.student.sectionName,
        rollNumber: summary.student.rollNumber,
      },
      academicYear: { id: child.academicYearId, name: child.year.name, isCurrent: child.year.isCurrent },
      feeAssigned: summary.feeRecord != null,
      totals: summary.totals,
      months: summary.months,
      dues: summary.dues.map((due) => {
        const open = due.paymentStatus === "unpaid" || due.paymentStatus === "partial";
        return {
          id: due.id,
          feeHeadName: headName.get(due.feeHeadId) ?? "Fee",
          description: due.description,
          periodKey: due.periodKey,
          dueDate: due.dueDate,
          amount: due.amount,
          concessionAmount: due.concessionAmount,
          discountAmount: due.discountAmount,
          lateFeeAmount: due.lateFeeCharged,
          netAmount: due.netAmount,
          paidAmount: due.paidAmount,
          balance: open ? fromCents(toCents(due.netAmount) - toCents(due.paidAmount)) : "0.00",
          status: due.paymentStatus,
        };
      }),
      previousDues: summary.previousDues.map((row) => {
        const open = row.status === "unpaid" || row.status === "partial";
        return {
          id: row.id,
          label: row.description,
          amount: row.amount,
          paidAmount: row.paidAmount,
          balance: open ? fromCents(toCents(row.amount) - toCents(row.paidAmount)) : "0.00",
          status: row.status,
        };
      }),
      // F2: the type and the amount, never the reason staff typed.
      concessions: summary.concessions.map((c) => ({
        concessionType: c.concessionType,
        amount: c.concessionAmount,
      })),
      payments,
    };
  }

  /** Every payment this session, newest first, bounced and cancelled included (F3). */
  private async payments(child: PortalChild) {
    const rows = await db
      .select({
        id: feePayments.id,
        receiptNumber: feePayments.receiptNumber,
        paymentDate: feePayments.paymentDate,
        paymentMode: feePayments.paymentMode,
        amount: feePayments.amount,
        lateFeeAmount: feePayments.lateFeeAmount,
        status: feePayments.paymentStatus,
      })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.studentId, child.studentId),
          eq(feePayments.schoolId, child.schoolId),
          eq(feePayments.academicYearId, child.academicYearId),
        ),
      )
      .orderBy(desc(feePayments.paymentDate), desc(feePayments.createdAt));
    const refunded = await this.refundedOf(child, rows.map((r) => r.id));
    return rows.map((r) => ({
      ...r,
      totalAmount: fromCents(toCents(r.amount) + toCents(r.lateFeeAmount)),
      refundedAmount: refunded.get(r.id) ?? "0.00",
    }));
  }

  private async refundedOf(child: PortalChild, paymentIds: string[]) {
    if (paymentIds.length === 0) return new Map<string, string>();
    const rows = await db
      .select({
        paymentId: feeRefunds.originalPaymentId,
        total: sql<string>`coalesce(sum(${feeRefunds.refundAmount}), 0)::numeric(12,2)::text`,
      })
      .from(feeRefunds)
      .where(
        and(
          eq(feeRefunds.schoolId, child.schoolId),
          inArray(feeRefunds.originalPaymentId, paymentIds),
        ),
      )
      .groupBy(feeRefunds.originalPaymentId);
    return new Map(rows.map((r) => [r.paymentId, r.total]));
  }

  /**
   * The payment must be this child's, in the child's school. Any other id,
   * including another child's payment in the same school, is NOT_FOUND.
   */
  private async ownedPayment(
    ownedStudentIds: readonly string[],
    input: { studentId: string; paymentId: string },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId);
    const [payment] = await db
      .select({ id: feePayments.id, academicYearId: feePayments.academicYearId })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.id, input.paymentId),
          eq(feePayments.studentId, child.studentId),
          eq(feePayments.schoolId, child.schoolId),
        ),
      );
    if (!payment) throw refuse("NOT_FOUND", PAYMENT_NOT_FOUND);
    return child;
  }

  async payment(
    ownedStudentIds: readonly string[],
    input: { studentId: string; paymentId: string },
  ) {
    const child = await this.ownedPayment(ownedStudentIds, input);
    const detail = await feesCollectionService.getPaymentDetail(childScope(child), input.paymentId);
    if (!detail) throw refuse("NOT_FOUND", PAYMENT_NOT_FOUND);
    const { payment, allocations, openingBalanceAllocations } = detail;
    const refunded = await this.refundedOf(child, [payment.id]);

    return {
      id: payment.id,
      receiptNumber: payment.receiptNumber,
      paymentDate: payment.paymentDate,
      paymentMode: payment.paymentMode,
      amount: payment.amount,
      lateFeeAmount: payment.lateFeeAmount,
      totalAmount: fromCents(toCents(payment.amount) + toCents(payment.lateFeeAmount)),
      status: payment.paymentStatus,
      refundedAmount: refunded.get(payment.id) ?? "0.00",
      allocations: allocations.map((a) => ({
        feeHeadName: a.feeHeadName,
        description: a.description,
        periodKey: a.periodKey,
        dueDate: a.dueDate,
        amount: a.amountAllocated,
        lateFeeAmount: a.lateFeeAmount,
      })),
      previousDues: openingBalanceAllocations.map((a) => ({
        label: a.description,
        originAcademicYearName: a.originAcademicYearName,
        amount: a.amountAllocated,
      })),
    };
  }

  /** The printed receipt the counter hands over (ADR-059), same HTML. */
  async receipt(
    ownedStudentIds: readonly string[],
    input: { studentId: string; paymentId: string },
  ) {
    const child = await this.ownedPayment(ownedStudentIds, input);
    const document = await feeDocumentsService.receipt(childScope(child), input.paymentId, undefined);
    if (!document) throw refuse("NOT_FOUND", PAYMENT_NOT_FOUND);
    return document;
  }

  /** The year's fee statement (owner F4). */
  async statement(
    ownedStudentIds: readonly string[],
    input: { studentId: string; academicYearId?: string },
  ) {
    const child = await resolvePortalChild(ownedStudentIds, input.studentId, input.academicYearId);
    const document = await feeDocumentsService.statement(
      childScope(child),
      { academicYearId: child.academicYearId, studentId: child.studentId },
      true,
    );
    if (!document) throw refuse("NOT_FOUND", "Student not found.");
    return document;
  }
}

export const portalFeesService = new PortalFeesService();
