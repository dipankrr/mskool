import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import "../../i18n";
import { todayIso } from "../../../lib/format";
import { parseMoney, toMoneyString } from "../../../lib/money";
import type { FeeSummary } from "../../lib/fees";
import { FamilyThemeProvider } from "../../theme";
import { FHeader, FScreen, FSegment } from "../../ui";
import { FeesView } from "./view";

/**
 * Dev-only: the Fees screen on sample data, one kind of account at a time,
 * so every state can be looked at without arranging it in a database. The
 * screen and its rules are the real ones; only the figures are made up.
 * Payment rows and the statement button lead nowhere here.
 */
export function FamilyFeesPreview() {
  return (
    <FamilyThemeProvider>
      <Preview />
    </FamilyThemeProvider>
  );
}

const KINDS = ["late", "due", "paid", "year", "mixed"] as const;
type Kind = (typeof KINDS)[number];

const MONTHLY = 450000n; // paise
const cents = (value: string) => parseMoney(value) ?? 0n;

function monthKey(year: number, monthIndex: number): string {
  const date = new Date(year, monthIndex, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** A 12-month session that started seven months ago, tuition due on the 10th. */
function sample(kind: Kind, today: string): FeeSummary {
  const thisMonth = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const monthIndex = Number(today.slice(5, 7)) - 1;
  const keys = Array.from({ length: 12 }, (_, i) => monthKey(year, monthIndex - 7 + i));
  const paidMonths = { late: 5, due: 7, paid: 8, year: 12, mixed: 6 }[kind];

  const dues = keys.map((key, i) => {
    const partial = kind === "mixed" && i === paidMonths;
    const paid = i < paidMonths ? MONTHLY : partial ? 200000n : 0n;
    return {
      id: `tuition-${key}`,
      feeHeadName: "Tuition Fee",
      description: null,
      periodKey: key,
      dueDate: `${key}-10`,
      amount: toMoneyString(MONTHLY),
      concessionAmount: "0.00",
      discountAmount: "0.00",
      lateFeeAmount: "0.00",
      netAmount: toMoneyString(MONTHLY),
      paidAmount: toMoneyString(paid),
      balance: toMoneyString(MONTHLY - paid),
      status: paid === MONTHLY ? "paid" : paid > 0n ? "partial" : "unpaid",
    };
  });
  if (kind === "mixed") {
    dues.push({
      ...dues[0]!,
      id: "costume",
      feeHeadName: "Activity Fee",
      description: "Annual day costume" as unknown as null,
      periodKey: "one:costume",
      dueDate: `${thisMonth}-25`,
      amount: "600.00",
      netAmount: "600.00",
      paidAmount: "0.00",
      balance: "600.00",
      status: "unpaid",
    });
  }

  let overdue = 0n;
  let now = 0n;
  let later = 0n;
  let paid = 0n;
  const months = keys.map((key) => {
    const inMonth = dues.filter((due) => due.dueDate.startsWith(key));
    const balance = inMonth.reduce((total, due) => total + cents(due.balance), 0n);
    const net = inMonth.reduce((total, due) => total + cents(due.netAmount), 0n);
    const monthPaid = inMonth.reduce((total, due) => total + cents(due.paidAmount), 0n);
    paid += monthPaid;
    if (key < thisMonth) overdue += balance;
    else if (key === thisMonth) now += balance;
    else later += balance;
    return {
      month: key,
      label: "",
      net: toMoneyString(net),
      paid: toMoneyString(monthPaid),
      balance: toMoneyString(balance),
      state: balance === 0n ? "paid" : key < thisMonth ? "overdue" : key === thisMonth ? "due" : "upcoming",
    };
  });
  const previous = kind === "mixed" ? 150000n : 0n;

  const payments = keys.slice(0, Math.min(paidMonths, 8)).map((key, i) => ({
    id: `pay-${key}`,
    receiptNumber: `R-${String(101 + i).padStart(4, "0")}`,
    paymentDate: `${key}-08`,
    paymentMode: i % 3 === 0 ? "cash" : "upi",
    amount: toMoneyString(MONTHLY),
    lateFeeAmount: "0.00",
    status: "cleared",
    totalAmount: toMoneyString(MONTHLY),
    refundedAmount: "0.00",
  }));
  if (kind === "mixed") {
    payments.push({
      id: "pay-bounced",
      receiptNumber: "R-0140",
      paymentDate: `${thisMonth}-02`,
      paymentMode: "cheque",
      amount: toMoneyString(MONTHLY),
      lateFeeAmount: "0.00",
      status: "bounced",
      totalAmount: toMoneyString(MONTHLY),
      refundedAmount: "0.00",
    });
  }
  payments.reverse();

  return {
    student: { id: "sample", name: "Aditi Sharma", className: "Class 5", sectionName: "A", rollNumber: "12" },
    academicYear: { id: "year", name: "Session", isCurrent: true },
    feeAssigned: true,
    totals: {
      dueNow: toMoneyString(overdue + now + previous),
      thisMonth: toMoneyString(now),
      overdue: toMoneyString(overdue),
      previousDues: toMoneyString(previous),
      later: toMoneyString(later),
      paid: toMoneyString(paid),
      concession: kind === "mixed" ? "6000.00" : "0.00",
      discount: "0.00",
    },
    months,
    dues,
    previousDues:
      kind === "mixed"
        ? [{ id: "prev", label: "Tuition Fee", amount: "1500.00", paidAmount: "0.00", balance: "1500.00", status: "unpaid" }]
        : [],
    concessions: kind === "mixed" ? [{ concessionType: "sibling_discount", amount: "6000.00" }] : [],
    payments,
  } as unknown as FeeSummary;
}

function Preview() {
  const { t } = useTranslation("kit");
  const { t: tf } = useTranslation("family");
  const [kind, setKind] = useState<Kind>("late");
  const today = todayIso();
  const data = useMemo(() => sample(kind, today), [kind, today]);
  return (
    <FScreen testID="family-fees-preview" header={<FHeader title={tf("tabs.fees")} />}>
      <FSegment
        testID="preview-kind"
        options={KINDS.map((value) => ({ key: value, label: t(`fees.${value}`) }))}
        value={kind}
        onChange={setKind}
      />
      <FeesView
        key={kind}
        data={data}
        today={today}
        onPayment={() => undefined}
        statement={{ busy: false, error: false, share: () => undefined }}
      />
    </FScreen>
  );
}
