import type { FeeDocumentKind } from "@repo/contracts";
import { toCents } from "../fees-maths";

/**
 * The shared parts of every printed document: escaping, money, dates, the school's
 * heading and the page shell. Nothing here reads the database.
 *
 * Sizes are points at 72 per inch, which is what expo-print's width and height mean.
 */
export const A4 = { width: 595, height: 842 };

/** Everything typed by a school or a person goes through this before reaching HTML. */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "105000.5" prints "₹1,05,000.50". Worked in paise, never through a float. */
export function rupees(amount: string): string {
  const cents = toCents(amount);
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const digits = (abs / 100n).toString();
  const paise = (abs % 100n).toString().padStart(2, "0");
  const last = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last}` : last;
  return `${negative ? "-" : ""}₹${grouped}.${paise}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-02" prints "2 Nov 2026". */
export function longDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""} ${year}`;
}

export const DEFAULT_TITLES: Record<FeeDocumentKind, string> = {
  receipt: "Fee Receipt",
  statement: "Fee Statement",
  dueNotice: "Fee Due Notice",
  defaulters: "Fees Outstanding",
  dayBook: "Day Book",
  chequeList: "Cheques Waiting to Clear",
  noDues: "No Dues Certificate",
  structureSheet: "Fee Structure",
};

export type PrintIdentity = {
  schoolName: string;
  addressLine: string;
  contactLine: string;
  affiliationLine: string;
  headerLines: string[];
  subLines: string[];
  footerLines: string[];
  signatureLabel: string;
  titles: Partial<Record<FeeDocumentKind, string>>;
  showAmountInWords: boolean;
  /** Inline data URI. Set in one CSS class, so 60 notices embed it once. */
  logoDataUri: string | null;
};

export function titleOf(identity: PrintIdentity, kind: FeeDocumentKind): string {
  return identity.titles[kind]?.trim() || DEFAULT_TITLES[kind];
}

/** The school's heading. Name and logo always print; everything else is optional. */
export function schoolHeader(identity: PrintIdentity): string {
  const lines = [
    ...identity.headerLines.map((line) => `<div class="school-extra">${esc(line)}</div>`),
    `<div class="school-name">${esc(identity.schoolName)}</div>`,
    identity.addressLine ? `<div class="school-line">${esc(identity.addressLine)}</div>` : "",
    identity.contactLine ? `<div class="school-line">${esc(identity.contactLine)}</div>` : "",
    identity.affiliationLine ? `<div class="school-line">${esc(identity.affiliationLine)}</div>` : "",
    ...identity.subLines.map((line) => `<div class="school-line">${esc(line)}</div>`),
  ].join("");
  return `<header class="school">${
    identity.logoDataUri ? `<div class="logo"></div>` : ""
  }<div class="school-text">${lines}</div></header>`;
}

export function footerBlock(identity: PrintIdentity): string {
  if (identity.footerLines.length === 0) return "";
  return `<footer class="foot">${identity.footerLines
    .map((line) => `<div>${esc(line)}</div>`)
    .join("")}</footer>`;
}

export function signatureBlock(label: string): string {
  return `<div class="sign"><div class="sign-line"></div><div>${esc(label)}</div></div>`;
}

export const BASE_CSS = `
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0}
body{font-family:"Noto Sans","Noto Sans Bengali","Noto Sans Devanagari",Roboto,sans-serif;font-size:10pt;line-height:1.35;color:#111}
.school{display:flex;align-items:center;justify-content:center;gap:10pt;text-align:center}
.school-text{flex:1;min-width:0}
.school-name{font-size:14pt;font-weight:700}
.school-extra{font-size:9pt}
.school-line{font-size:8.5pt;color:#333}
.logo{width:44pt;height:44pt;flex:none;background-size:contain;background-repeat:no-repeat;background-position:center}
.doc-title{margin:8pt 0;padding:3pt 0;text-align:center;font-weight:700;letter-spacing:.3pt;border-top:1px solid #111;border-bottom:1px solid #111}
.facts{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2pt 12pt;margin-bottom:6pt}
.facts b{font-weight:600}
table{width:100%;border-collapse:collapse}
th,td{padding:3pt 4pt;text-align:left;vertical-align:top;border-bottom:1px solid #ccc}
th{font-size:8.5pt;font-weight:600;border-bottom:1px solid #111}
.num{text-align:right;white-space:nowrap}
tr.total td{font-weight:700;border-top:1px solid #111;border-bottom:1px solid #111}
tr{break-inside:avoid;page-break-inside:avoid}
.words{margin-top:5pt;font-size:9pt}
.meta{font-size:9pt;margin-top:5pt}
.note{margin-top:5pt;font-size:8.5pt;color:#333}
.sign{margin-top:22pt;margin-left:auto;width:42%;text-align:center;font-size:8.5pt}
.signs{display:flex;justify-content:space-between;gap:20pt}
.signs .sign{margin-left:0;flex:1;width:auto}
.sign-line{border-top:1px solid #111;margin-bottom:2pt}
.foot{margin-top:8pt;padding-top:4pt;border-top:1px solid #ccc;text-align:center;font-size:8pt;color:#333}
.stamp{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-14deg);padding:3pt 14pt;border:2.5pt solid #b00020;color:#b00020;font-size:24pt;font-weight:700;opacity:.55;letter-spacing:2pt}
.sheet{position:relative;padding:28pt 34pt}
.page-break{break-after:page;page-break-after:always}
`;

/** A whole document. \`size\` must match the width and height the phone is given. */
export function pageShell(input: {
  title: string;
  size: { width: number; height: number };
  body: string;
  css?: string;
  identity: PrintIdentity;
}): string {
  const logo = input.identity.logoDataUri
    ? `.logo{background-image:url("${input.identity.logoDataUri}")}`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(input.title)}</title><style>
@page{size:${input.size.width}pt ${input.size.height}pt;margin:0}
${BASE_CSS}${logo}${input.css ?? ""}
</style></head><body>${input.body}</body></html>`;
}

/** A safe file name for sharing. */
export function fileNameOf(...parts: (string | null | undefined)[]): string {
  const name = parts
    .filter(Boolean)
    .join("-")
    .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${name || "Document"}.pdf`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The generator names a monthly due "Tuition Fee — 2026-11"; people say "Tuition Fee —
 * November 2026". Old one-time dues end in " — once", which the name alone says better.
 * The app's own friendlyDueName does the same, so screen and paper agree.
 */
export function dueLabel(row: { description: string | null; feeHeadName: string }): string {
  const description = row.description
    ?.trim()
    .replace(/ — once$/, "")
    .replace(
      /(\d{4})-(0[1-9]|1[0-2])$/,
      (_, year: string, month: string) => `${MONTH_NAMES[Number(month) - 1]} ${year}`,
    );
  return description || row.feeHeadName;
}
