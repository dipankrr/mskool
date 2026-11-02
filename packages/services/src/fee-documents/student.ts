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

export type StudentLabel = {
  name: string;
  admissionNumber: string;
  classLine: string | null;
};

export type StatementData = {
  student: StudentLabel;
  sessionName: string;
  today: string;
  dues: { dueDate: string; label: string; net: string; paid: string; status: string }[];
  previousDues: { label: string; amount: string; paid: string }[];
  payments: {
    date: string;
    receiptNumber: string;
    modeLabel: string;
    total: string;
    discount: string;
    status: string;
    refunded: string;
  }[];
  totals: { dueNow: string; later: string; paid: string; concession: string; discount: string };
};

const CSS = `
thead{display:table-header-group}
td,th{font-size:8.5pt}
h3{margin:10pt 0 3pt;font-size:10pt}
.muted{color:#555}
.cert{font-size:12pt;line-height:1.7;margin:26pt 0;text-align:justify}
`;

const STATUS_NOTE: Record<string, string> = {
  pending: "Waiting to clear",
  bounced: "Bounced",
  reversed: "Refunded",
  cancelled: "Cancelled",
  waived: "Forgiven",
};

function studentFacts(student: StudentLabel, sessionName: string, today: string): string {
  return `<div class="facts">${[
    ["Student", student.name],
    ["Admission No", student.admissionNumber],
    ["Class", student.classLine],
    ["Session", sessionName],
    ["As on", longDate(today)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div>${esc(label)}: <b>${esc(value)}</b></div>`)
    .join("")}</div>`;
}

export function renderStatement(identity: PrintIdentity, data: StatementData): FeeDocument {
  const title = titleOf(identity, "statement");
  const dueRows = data.dues
    .map((row) => {
      const balance = toCents(row.net) - toCents(row.paid);
      const note = STATUS_NOTE[row.status];
      return `<tr><td>${longDate(row.dueDate)}</td><td>${esc(row.label)}${note ? ` <span class="muted">(${note})</span>` : ""}</td><td class="num">${rupees(row.net)}</td><td class="num">${rupees(row.paid)}</td><td class="num">${rupees(row.status === "waived" || balance < 0n ? "0.00" : fromCents(balance))}</td></tr>`;
    })
    .join("");
  const previous = data.previousDues.length
    ? `<h3>Previous dues</h3><table><thead><tr><th>For</th><th class="num">Amount</th><th class="num">Paid</th></tr></thead><tbody>${data.previousDues
        .map(
          (row) =>
            `<tr><td>${esc(row.label)}</td><td class="num">${rupees(row.amount)}</td><td class="num">${rupees(row.paid)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";
  const payments = data.payments.length
    ? `<h3>Payments</h3><table><thead><tr><th>Date</th><th>Receipt</th><th>Mode</th><th class="num">Amount</th></tr></thead><tbody>${data.payments
        .map((row) => {
          const notes = [
            STATUS_NOTE[row.status],
            toCents(row.refunded) > 0n && row.status === "cleared" ? `Refunded ${rupees(row.refunded)}` : null,
            toCents(row.discount) > 0n ? `Discount ${rupees(row.discount)}` : null,
          ].filter(Boolean);
          return `<tr><td>${longDate(row.date)}</td><td>${esc(row.receiptNumber)}</td><td>${esc(row.modeLabel)}</td><td class="num">${rupees(row.total)}${notes.length ? `<div class="muted">${notes.map(esc).join(" · ")}</div>` : ""}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : "";
  const summary = [
    ["Due now", data.totals.dueNow, true],
    ["Later this session", data.totals.later, false],
    ["Paid so far", data.totals.paid, false],
    ["Concessions", data.totals.concession, false],
    ["Discounts", data.totals.discount, false],
  ]
    .filter(([, amount, always]) => always || toCents(String(amount)) > 0n)
    .map(
      ([label, amount, strong]) =>
        `<tr class="${strong ? "total" : ""}"><td>${esc(String(label))}</td><td class="num">${rupees(String(amount))}</td></tr>`,
    )
    .join("");
  const body = `<div class="sheet">
${schoolHeader(identity)}
<div class="doc-title">${esc(title)}</div>
${studentFacts(data.student, data.sessionName, data.today)}
<table><tbody>${summary}</tbody></table>
<h3>Dues</h3>
${
  data.dues.length
    ? `<table><thead><tr><th>Due date</th><th>For</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>${dueRows}</tbody></table>`
    : `<p>No dues this session.</p>`
}
${previous}
${payments}
${signatureBlock(identity.signatureLabel)}
${footerBlock(identity)}
</div>`;
  return {
    html: pageShell({ title, size: A4, identity, css: CSS, body }),
    fileName: fileNameOf("Fee-statement", data.student.admissionNumber),
    ...A4,
  };
}

export function renderNoDues(
  identity: PrintIdentity,
  input: { student: StudentLabel; sessionName: string; today: string },
): FeeDocument {
  const title = titleOf(identity, "noDues");
  const { student } = input;
  const body = `<div class="sheet">
${schoolHeader(identity)}
<div class="doc-title">${esc(title)}</div>
<div class="cert">This is to certify that <b>${esc(student.name)}</b>, Admission No. <b>${esc(student.admissionNumber)}</b>${student.classLine ? `, of <b>${esc(student.classLine)}</b>` : ""}, has no fees payable to this school for the session <b>${esc(input.sessionName)}</b> as on <b>${longDate(input.today)}</b>.</div>
${signatureBlock(identity.signatureLabel)}
${footerBlock(identity)}
</div>`;
  return {
    html: pageShell({ title, size: A4, identity, css: CSS, body }),
    fileName: fileNameOf("No-dues", student.admissionNumber),
    ...A4,
  };
}

export type StructureSheetData = {
  structureName: string;
  className: string | null;
  sessionName: string;
  lines: {
    name: string;
    frequencyLabel: string;
    note: string | null;
    total: string;
    periods: { label: string; dueDate: string; amount: string }[];
  }[];
};

export function renderStructureSheet(identity: PrintIdentity, data: StructureSheetData): FeeDocument {
  const title = titleOf(identity, "structureSheet");
  const summary = data.lines
    .map(
      (line) =>
        `<tr><td>${esc(line.name)}${line.note ? ` <span class="muted">(${esc(line.note)})</span>` : ""}</td><td>${esc(line.frequencyLabel)}</td><td class="num">${rupees(line.total)}</td></tr>`,
    )
    .join("");
  const grand = data.lines.reduce((sum, line) => sum + toCents(line.total), 0n);

  // By due date, so a parent can read what falls due when.
  const byDate = new Map<string, { label: string; amount: string }[]>();
  for (const line of data.lines) {
    for (const period of line.periods) {
      const rows = byDate.get(period.dueDate) ?? [];
      rows.push({ label: line.name, amount: period.amount });
      byDate.set(period.dueDate, rows);
    }
  }
  const schedule = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const total = rows.reduce((sum, row) => sum + toCents(row.amount), 0n);
      return `<tr><td>${longDate(date)}</td><td>${rows
        .map((row) => `${esc(row.label)} ${rupees(row.amount)}`)
        .join("<br/>")}</td><td class="num"><b>${rupees(fromCents(total))}</b></td></tr>`;
    })
    .join("");
  const body = `<div class="sheet">
${schoolHeader(identity)}
<div class="doc-title">${esc(title)}</div>
<div class="facts"><div>For: <b>${esc(data.structureName)}</b></div>${data.className ? `<div>Class: <b>${esc(data.className)}</b></div>` : ""}<div>Session: <b>${esc(data.sessionName)}</b></div></div>
<table><thead><tr><th>Fee</th><th>How often</th><th class="num">In the session</th></tr></thead><tbody>${summary}<tr class="total"><td colspan="2">Total</td><td class="num">${rupees(fromCents(grand))}</td></tr></tbody></table>
<h3>When each is due</h3>
<table><thead><tr><th>Due date</th><th>Fees</th><th class="num">Total</th></tr></thead><tbody>${schedule}</tbody></table>
${footerBlock(identity)}
</div>`;
  return {
    html: pageShell({ title, size: A4, identity, css: CSS, body }),
    fileName: fileNameOf("Fee-structure", data.structureName),
    ...A4,
  };
}
