import type { FeeDocument } from "@repo/contracts";
import { fromCents, toCents } from "../fees-maths";
import {
  A4,
  esc,
  fileNameOf,
  footerBlock,
  longDate,
  pageShell,
  rupees,
  schoolHeader,
  signatureBlock,
  titleOf,
  type PrintIdentity,
} from "./html";

const CSS = `
thead{display:table-header-group}
td,th{font-size:8.5pt}
h3{margin:10pt 0 3pt;font-size:10pt}
.muted{color:#555}
`;

export type DayBookPayment = {
  receiptNumber: string;
  studentName: string;
  classLine: string | null;
  modeLabel: string;
  reference: string | null;
  total: string;
  status: string;
};

export type DayBookRefund = {
  studentName: string;
  modeLabel: string;
  amount: string;
  reason: string;
};

const STATUS_NOTE: Record<string, string> = {
  pending: "Waiting to clear",
  bounced: "Bounced",
  reversed: "Refunded",
  cancelled: "Cancelled",
};

const counted = (status: string) => status === "cleared" || status === "pending";

/** One day at the counter. Totals count only money that is, or may yet be, real. */
export function dayBookTotals(payments: DayBookPayment[], refunds: DayBookRefund[]) {
  const byMode = new Map<string, bigint>();
  let received = 0n;
  let waiting = 0n;
  for (const row of payments) {
    if (!counted(row.status)) continue;
    const cents = toCents(row.total);
    byMode.set(row.modeLabel, (byMode.get(row.modeLabel) ?? 0n) + cents);
    received += cents;
    if (row.status === "pending") waiting += cents;
  }
  const refunded = refunds.reduce((sum, row) => sum + toCents(row.amount), 0n);
  const cashRefunded = refunds
    .filter((row) => row.modeLabel === "Cash")
    .reduce((sum, row) => sum + toCents(row.amount), 0n);
  const cashIn = byMode.get("Cash") ?? 0n;
  return {
    byMode: [...byMode.entries()].map(([label, cents]) => ({ label, amount: fromCents(cents) })),
    received: fromCents(received),
    waiting: fromCents(waiting),
    refunded: fromCents(refunded),
    cashInHand: fromCents(cashIn - cashRefunded),
  };
}

export function renderDayBook(
  identity: PrintIdentity,
  input: { date: string; payments: DayBookPayment[]; refunds: DayBookRefund[] },
): FeeDocument {
  const title = titleOf(identity, "dayBook");
  const totals = dayBookTotals(input.payments, input.refunds);
  const rows = input.payments
    .map(
      (row, index) => `<tr>
<td>${index + 1}</td>
<td>${esc(row.receiptNumber)}</td>
<td>${esc(row.studentName)}${row.classLine ? `<div class="muted">${esc(row.classLine)}</div>` : ""}</td>
<td>${esc(row.modeLabel)}${row.reference ? `<div class="muted">${esc(row.reference)}</div>` : ""}</td>
<td class="num">${rupees(row.total)}${STATUS_NOTE[row.status] ? `<div class="muted">${STATUS_NOTE[row.status]}</div>` : ""}</td>
</tr>`,
    )
    .join("");
  const summary = [
    ...totals.byMode.map(
      (row) => `<tr><td>${esc(row.label)}</td><td class="num">${rupees(row.amount)}</td></tr>`,
    ),
    `<tr class="total"><td>Total received</td><td class="num">${rupees(totals.received)}</td></tr>`,
    toCents(totals.waiting) > 0n
      ? `<tr><td>Of which waiting to clear</td><td class="num">${rupees(totals.waiting)}</td></tr>`
      : "",
    toCents(totals.refunded) > 0n
      ? `<tr><td>Refunded today</td><td class="num">${rupees(totals.refunded)}</td></tr>`
      : "",
    `<tr class="total"><td>Cash in hand from today</td><td class="num">${rupees(totals.cashInHand)}</td></tr>`,
  ].join("");
  const refunds = input.refunds.length
    ? `<h3>Refunds</h3><table><thead><tr><th>Student</th><th>Mode</th><th>Reason</th><th class="num">Amount</th></tr></thead><tbody>${input.refunds
        .map(
          (row) =>
            `<tr><td>${esc(row.studentName)}</td><td>${esc(row.modeLabel)}</td><td>${esc(row.reason)}</td><td class="num">${rupees(row.amount)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";
  const body = `<div class="sheet">
${schoolHeader(identity)}
<div class="doc-title">${esc(title)} · ${longDate(input.date)}</div>
${
  input.payments.length
    ? `<table><thead><tr><th>#</th><th>Receipt</th><th>Student</th><th>Mode</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>No payments were recorded on this day.</p>`
}
${refunds}
<h3>Summary</h3>
<table><tbody>${summary}</tbody></table>
<div class="signs">${signatureBlock("Prepared by")}${signatureBlock("Checked by")}</div>
${footerBlock(identity)}
</div>`;
  return {
    html: pageShell({ title, size: A4, identity, css: CSS, body }),
    fileName: fileNameOf("Day-book", input.date),
    ...A4,
  };
}

export type ChequeRow = {
  paymentDate: string;
  reference: string | null;
  bankName: string | null;
  chequeDate: string | null;
  studentName: string;
  classLine: string | null;
  receiptNumber: string;
  modeLabel: string;
  total: string;
};

export function renderChequeList(
  identity: PrintIdentity,
  input: { rows: ChequeRow[]; today: string; sessionName: string },
): FeeDocument {
  const title = titleOf(identity, "chequeList");
  const total = fromCents(input.rows.reduce((sum, row) => sum + toCents(row.total), 0n));
  const rows = input.rows
    .map(
      (row, index) => `<tr>
<td>${index + 1}</td>
<td>${esc(row.reference ?? "-")}${row.modeLabel === "Cheque" ? "" : `<div class="muted">${esc(row.modeLabel)}</div>`}</td>
<td>${esc(row.bankName ?? "-")}</td>
<td>${row.chequeDate ? longDate(row.chequeDate) : longDate(row.paymentDate)}</td>
<td>${esc(row.studentName)}${row.classLine ? `<div class="muted">${esc(row.classLine)}</div>` : ""}</td>
<td>${esc(row.receiptNumber)}</td>
<td class="num">${rupees(row.total)}</td>
</tr>`,
    )
    .join("");
  const body = `<div class="sheet">
${schoolHeader(identity)}
<div class="doc-title">${esc(title)}</div>
<div class="facts"><div>Session: <b>${esc(input.sessionName)}</b></div><div>As on: <b>${longDate(input.today)}</b></div><div>Count: <b>${input.rows.length}</b></div></div>
${
  input.rows.length
    ? `<table><thead><tr><th>#</th><th>Cheque No</th><th>Bank</th><th>Date</th><th>Student</th><th>Receipt</th><th class="num">Amount</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="6">Total</td><td class="num">${rupees(total)}</td></tr></tbody></table>`
    : `<p>No cheques are waiting to clear.</p>`
}
<div class="signs">${signatureBlock("Handed over by")}${signatureBlock("Received by")}</div>
${footerBlock(identity)}
</div>`;
  return {
    html: pageShell({ title, size: A4, identity, css: CSS, body }),
    fileName: fileNameOf("Cheque-list", input.today),
    ...A4,
  };
}
