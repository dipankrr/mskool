import { toCents } from "../fees-maths";

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(value: number): string {
  if (value < 20) return ONES[value] ?? "";
  const unit = value % 10;
  const tens = TENS[Math.floor(value / 10)] ?? "";
  return unit === 0 ? tens : `${tens} ${ONES[unit]}`;
}

function belowThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return [hundreds > 0 ? `${ONES[hundreds]} Hundred` : "", rest > 0 ? belowHundred(rest) : ""]
    .filter(Boolean)
    .join(" ");
}

/** Indian grouping: crore, lakh, thousand. */
function wholeInWords(value: bigint): string {
  if (value === 0n) return "Zero";
  const parts: string[] = [];
  const crore = value / 10_000_000n;
  const lakh = Number((value / 100_000n) % 100n);
  const thousand = Number((value / 1_000n) % 100n);
  const rest = Number(value % 1_000n);
  if (crore > 0n) parts.push(`${wholeInWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** "105000.50" reads "Rupees One Lakh Five Thousand and Fifty Paise Only". */
export function amountInWords(amount: string): string {
  const cents = toCents(amount);
  const abs = cents < 0n ? -cents : cents;
  const rupees = abs / 100n;
  const paise = Number(abs % 100n);
  const whole = `Rupees ${wholeInWords(rupees)}`;
  return paise > 0 ? `${whole} and ${belowHundred(paise)} Paise Only` : `${whole} Only`;
}
