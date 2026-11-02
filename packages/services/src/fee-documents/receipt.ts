import type { FeeDocument, FeeReceiptLayout } from "@repo/contracts";
import { toCents } from "../fees-maths";
import { amountInWords } from "./amount-words";
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

export type ReceiptData = {
  receiptNumber: string;
  paymentDate: string;
  studentName: string;
  admissionNumber: string;
  classLine: string | null;
  lines: { label: string; amount: string }[];
  amount: string;
  lateFee: string;
  discount: string;
  total: string;
  modeLabel: string;
  reference: string | null;
  bankName: string | null;
  chequeDate: string | null;
  remarks: string | null;
  status: string;
  refunded: string;
};

/** More lines than this won't fit half a sheet, so the receipt takes a full page. */
export const HALF_PAGE_MAX_LINES = 9;

const THERMAL_WIDTH = { thermal_58: 164, thermal_80: 227 } as const;

const STAMP: Record<string, string> = {
  cancelled: "CANCELLED",
  bounced: "BOUNCED",
  reversed: "REFUNDED",
};

const positive = (amount: string) => toCents(amount) > 0n;

function moneyRow(label: string, amount: string, extraClass = ""): string {
  return `<tr class="${extraClass}"><td>${esc(label)}</td><td class="num">${rupees(amount)}</td></tr>`;
}

function receiptBody(identity: PrintIdentity, data: ReceiptData, copyLabel: string | null): string {
  const stamp = STAMP[data.status];
  const facts = [
    ["Receipt No", data.receiptNumber],
    ["Date", longDate(data.paymentDate)],
    ["Student", data.studentName],
    ["Admission No", data.admissionNumber],
    ["Class", data.classLine],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<div>${esc(label)}: <b>${esc(value)}</b></div>`)
    .join("");
  const rows = [
    ...data.lines.map((line) => moneyRow(line.label, line.amount)),
    positive(data.lateFee) ? moneyRow("Late fee", data.lateFee) : "",
    moneyRow("Total", data.total, "total"),
  ].join("");
  const meta = [
    `Paid by: ${data.modeLabel}`,
    data.reference ? `Ref: ${data.reference}` : null,
    data.bankName ? `Bank: ${data.bankName}` : null,
    data.chequeDate ? `Cheque date: ${longDate(data.chequeDate)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const notes = [
    positive(data.discount) ? `Discount given: ${rupees(data.discount)}` : null,
    positive(data.refunded) && !stamp ? `Refunded: ${rupees(data.refunded)}` : null,
    data.status === "pending" ? "Subject to the money reaching the school." : null,
    data.remarks ? `Note: ${data.remarks}` : null,
  ]
    .filter(Boolean)
    .map((note) => `<div class="note">${esc(note)}</div>`)
    .join("");

  return `${stamp ? `<div class="stamp">${stamp}</div>` : ""}
${schoolHeader(identity)}
<div class="doc-title">${esc(titleOf(identity, "receipt"))}${copyLabel ? ` · ${esc(copyLabel)}` : ""}</div>
<div class="facts">${facts}</div>
<table><thead><tr><th>Particulars</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
${identity.showAmountInWords ? `<div class="words">${esc(amountInWords(data.total))}</div>` : ""}
<div class="meta">${esc(meta)}</div>
${notes}
${signatureBlock(identity.signatureLabel)}
${footerBlock(identity)}`;
}

/**
 * Roughly how tall a thermal receipt is, since that paper has no fixed length and
 * the phone needs a page height. Measured against rendered PDFs; a little slack
 * only feeds a little more paper.
 */
function thermalHeight(identity: PrintIdentity, data: ReceiptData, width: number): number {
  const perLine = width < 200 ? 17 : 15;
  const lineCount =
    data.lines.length * 1.4 +
    identity.headerLines.length +
    identity.subLines.length +
    identity.footerLines.length +
    (data.reference ? 1 : 0) +
    (data.bankName ? 1 : 0) +
    (data.remarks ? 2 : 0) +
    (positive(data.discount) ? 1 : 0) +
    (positive(data.lateFee) ? 1 : 0) +
    (positive(data.refunded) ? 1 : 0);
  return Math.ceil(200 + (identity.logoDataUri ? 40 : 0) + lineCount * perLine);
}

const THERMAL_CSS = `
body{font-size:8pt}
.sheet{padding:6pt 7pt}
.school{flex-direction:column;gap:3pt}
.school-name{font-size:10pt}
.school-extra,.school-line{font-size:7pt}
.logo{width:30pt;height:30pt}
.doc-title{margin:4pt 0;padding:2pt 0;font-size:8.5pt}
.facts{display:block;margin-bottom:3pt}
th,td{padding:2pt 1pt;font-size:7.5pt}
.words,.meta,.note{font-size:7pt;margin-top:3pt}
.sign{width:70%;margin-top:18pt;font-size:7pt}
.foot{font-size:6.5pt;margin-top:5pt}
.stamp{font-size:14pt;border-width:1.5pt;padding:2pt 6pt;top:30%}
`;

// A hair under a full page, so rounding never spills a blank second sheet.
const HALF_CSS = `
.a4{height:841pt;overflow:hidden}
.half{position:relative;height:420pt;padding:18pt 34pt;overflow:hidden}
.half + .half{border-top:1px dashed #777}
.half .sign{margin-top:14pt}
.half .doc-title{margin:5pt 0}
.half .foot{margin-top:5pt}
.half .school-name{font-size:12pt}
.half .logo{width:34pt;height:34pt}
.half th,.half td{padding:2pt 4pt}
.half .stamp{top:45%}
.spacer{height:420pt}
`;

export function renderReceipt(
  identity: PrintIdentity,
  data: ReceiptData,
  requested: FeeReceiptLayout,
): FeeDocument {
  const halfRequested =
    requested === "a4_half_two" || requested === "a4_half_top" || requested === "a4_half_bottom";
  // A long receipt moves to a full page rather than being cut off.
  const layout: FeeReceiptLayout =
    halfRequested && data.lines.length > HALF_PAGE_MAX_LINES ? "a4_full" : requested;

  const fileName = fileNameOf("Receipt", data.receiptNumber);
  const title = titleOf(identity, "receipt");

  if (layout === "thermal_58" || layout === "thermal_80") {
    const width = THERMAL_WIDTH[layout];
    const size = { width, height: thermalHeight(identity, data, width) };
    return {
      html: pageShell({
        title,
        size,
        identity,
        css: THERMAL_CSS,
        body: `<div class="sheet">${receiptBody(identity, data, null)}</div>`,
      }),
      fileName,
      ...size,
    };
  }

  const halves =
    layout === "a4_half_two"
      ? `<div class="half">${receiptBody(identity, data, "Parent copy")}</div><div class="half">${receiptBody(identity, data, "Office copy")}</div>`
      : layout === "a4_half_top"
        ? `<div class="half">${receiptBody(identity, data, null)}</div>`
        : layout === "a4_half_bottom"
          ? `<div class="spacer"></div><div class="half">${receiptBody(identity, data, null)}</div>`
          : `<div class="sheet">${receiptBody(identity, data, null)}</div>`;

  return {
    html: pageShell({ title, size: A4, identity, css: HALF_CSS, body: `<div class="a4">${halves}</div>` }),
    fileName,
    ...A4,
  };
}
