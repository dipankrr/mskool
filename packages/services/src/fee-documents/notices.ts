import type { FeeDocument } from "@repo/contracts";
import { toCents } from "../fees-maths";
import {
  A4,
  esc,
  fileNameOf,
  footerBlock,
  longDate,
  pageShell,
  rupees,
  schoolHeader,
  titleOf,
  type PrintIdentity,
} from "./html";

export type OwingStudent = {
  name: string;
  admissionNumber: string;
  className: string;
  sectionName: string | null;
  rollNumber: string | null;
  dueNow: string;
  thisMonth: string;
  overdue: string;
  previousDues: string;
  overdueMonths: number;
  /** An inline SVG for this student, when the school uses its UPI ID. */
  qrSvg?: string | null;
};

const classLine = (row: OwingStudent) =>
  [row.className, row.sectionName].filter(Boolean).join(" · ");

// Heights sit a hair under a full page, so rounding never spills a blank sheet.

/** The UPI link a phone's UPI app opens. Nothing in mskool hears about the payment. */
export function upiLink(input: {
  upiId: string;
  payeeName: string;
  amount: string;
  note: string;
}): string {
  const params = [
    ["pa", input.upiId],
    ["pn", input.payeeName],
    ["am", input.amount],
    ["cu", "INR"],
    ["tn", input.note],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? "")}`)
    .join("&");
  return `upi://pay?${params}`;
}

const NOTICE_CSS = `
.page{display:flex;flex-wrap:wrap;align-content:flex-start;width:595pt;height:841pt;overflow:hidden}
.page.break{break-after:page;page-break-after:always}
.notice{position:relative;overflow:hidden;padding:18pt 30pt;border-bottom:1px dashed #777}
.per-1 .notice{width:595pt;height:841pt;padding:34pt;border-bottom:none}
.per-2 .notice{width:595pt;height:420.5pt}
.per-4 .notice{width:297.5pt;height:420.5pt;padding:12pt 14pt;border-right:1px dashed #777}
.per-4 .school-name{font-size:10.5pt}
.per-4 .school-line,.per-4 .school-extra{font-size:7pt}
.per-4 .logo{width:24pt;height:24pt}
.per-4 .doc-title{margin:4pt 0;padding:2pt 0;font-size:9pt}
.per-4 th,.per-4 td,.per-4 .facts{font-size:8pt}
.per-4 .qr,.per-4 .qr-image{width:62pt;height:62pt}
.per-4 .pay-note{font-size:7pt}
.per-4 .foot{font-size:7pt}
.facts{font-size:9.5pt}
.pay{display:flex;align-items:center;gap:10pt;margin-top:8pt}
.qr,.qr-image{width:84pt;height:84pt;flex:none}
.qr svg{width:100%;height:100%;display:block}
.qr-image{background-size:contain;background-repeat:no-repeat;background-position:center}
.pay-note{flex:1;font-size:8.5pt}
`;

function noticeBody(
  identity: PrintIdentity,
  row: OwingStudent,
  today: string,
  qr: { kind: "svg" | "image" | "none"; schoolName: string },
): string {
  const facts = [
    ["Student", row.name],
    ["Admission No", row.admissionNumber],
    ["Class", classLine(row)],
    ["Date", longDate(today)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div>${esc(label)}: <b>${esc(value)}</b></div>`)
    .join("");
  const rows = [
    toCents(row.overdue) > 0n
      ? `<tr><td>Overdue${row.overdueMonths > 0 ? ` (${row.overdueMonths} ${row.overdueMonths === 1 ? "month" : "months"})` : ""}</td><td class="num">${rupees(row.overdue)}</td></tr>`
      : "",
    toCents(row.thisMonth) > 0n
      ? `<tr><td>This month</td><td class="num">${rupees(row.thisMonth)}</td></tr>`
      : "",
    toCents(row.previousDues) > 0n
      ? `<tr><td>Previous dues</td><td class="num">${rupees(row.previousDues)}</td></tr>`
      : "",
    `<tr class="total"><td>Total due</td><td class="num">${rupees(row.dueNow)}</td></tr>`,
  ].join("");
  const qrBlock =
    qr.kind === "none"
      ? ""
      : `<div class="pay">${
          qr.kind === "svg" && row.qrSvg
            ? `<div class="qr">${row.qrSvg}</div>`
            : `<div class="qr-image"></div>`
        }<div class="pay-note">Scan with any UPI app to pay. Check that it shows <b>${esc(qr.schoolName)}</b> before paying. Please bring or send the payment reference to the school office.</div></div>`;
  return `<section class="notice">
${schoolHeader(identity)}
<div class="doc-title">${esc(titleOf(identity, "dueNotice"))}</div>
<div class="facts">${facts}</div>
<table><tbody>${rows}</tbody></table>
${qrBlock}
${footerBlock(identity)}
</section>`;
}

export function renderNotices(
  identity: PrintIdentity,
  input: {
    rows: OwingStudent[];
    perPage: 1 | 2 | 4;
    today: string;
    scopeLabel: string;
    qr: { kind: "svg" | "image" | "none"; schoolName: string; imageDataUri?: string | null };
  },
): FeeDocument {
  const title = titleOf(identity, "dueNotice");
  const pages: string[] = [];
  for (let start = 0; start < input.rows.length; start += input.perPage) {
    const chunk = input.rows.slice(start, start + input.perPage);
    const isLast = start + input.perPage >= input.rows.length;
    pages.push(
      `<div class="page per-${input.perPage}${isLast ? "" : " break"}">${chunk
        .map((row) => noticeBody(identity, row, input.today, input.qr))
        .join("")}</div>`,
    );
  }
  // One class holds the image, so 60 notices carry one copy of it.
  const imageCss = input.qr.imageDataUri
    ? `.qr-image{background-image:url("${input.qr.imageDataUri}")}`
    : "";
  return {
    html: pageShell({
      title,
      size: A4,
      identity,
      css: NOTICE_CSS + imageCss,
      body: pages.join(""),
    }),
    fileName: fileNameOf("Due-notices", input.scopeLabel),
    ...A4,
  };
}

const TABLE_CSS = `
thead{display:table-header-group}
td,th{font-size:8.5pt}
.group td{font-weight:700;background:#eee}
`;

export function renderDefaulters(
  identity: PrintIdentity,
  input: { rows: OwingStudent[]; sessionName: string; today: string; scopeLabel: string; total: string },
): FeeDocument {
  const title = titleOf(identity, "defaulters");
  let lastGroup: string | null = null;
  let serial = 0;
  const rows = input.rows
    .map((row) => {
      const group = classLine(row);
      const heading =
        group !== lastGroup ? `<tr class="group"><td colspan="7">${esc(group)}</td></tr>` : "";
      lastGroup = group;
      serial += 1;
      return `${heading}<tr>
<td>${serial}</td>
<td>${esc(row.name)}${row.rollNumber ? ` (Roll ${esc(row.rollNumber)})` : ""}</td>
<td>${esc(row.admissionNumber)}</td>
<td class="num">${rupees(row.overdue)}</td>
<td class="num">${rupees(row.thisMonth)}</td>
<td class="num">${rupees(row.previousDues)}</td>
<td class="num"><b>${rupees(row.dueNow)}</b></td>
</tr>`;
    })
    .join("");
  const body = `<div class="sheet">
${schoolHeader(identity)}
<div class="doc-title">${esc(title)}</div>
<div class="facts"><div>Session: <b>${esc(input.sessionName)}</b></div><div>For: <b>${esc(input.scopeLabel)}</b></div><div>As on: <b>${longDate(input.today)}</b></div><div>Students: <b>${input.rows.length}</b></div></div>
<table><thead><tr><th>#</th><th>Student</th><th>Adm. No</th><th class="num">Overdue</th><th class="num">This month</th><th class="num">Previous</th><th class="num">Total due</th></tr></thead>
<tbody>${rows}<tr class="total"><td colspan="6">Total</td><td class="num">${rupees(input.total)}</td></tr></tbody></table>
${footerBlock(identity)}
</div>`;
  return {
    html: pageShell({ title, size: A4, identity, css: TABLE_CSS, body }),
    fileName: fileNameOf("Fees-outstanding", input.scopeLabel),
    ...A4,
  };
}
