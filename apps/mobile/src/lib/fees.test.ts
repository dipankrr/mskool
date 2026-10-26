import {
  buildReceiptText,
  canWaiveInstallment,
  concessionValueError,
  daysBetweenIso,
  dueLabel,
  dueTiming,
  installmentTitle,
  isPayable,
  isSettled,
  ledgerTotals,
  ledgerTypeLabel,
  monthLabel,
  monthRangeLabel,
  nextClientReference,
  oldestFirst,
  outstandingTotals,
  paymentActions,
  paymentModeLabel,
  referenceFields,
} from "./fees";

const ALLOW_ALL = () => true;
const DENY_ALL = () => false;

describe("referenceFields", () => {
  it("asks cash for nothing and instruments for provenance", () => {
    expect(referenceFields("cash").reference).toBe(false);
    expect(referenceFields("upi").reference).toBe(true);
    expect(referenceFields("upi").bank).toBe(false);
    expect(referenceFields("cheque").bank).toBe(true);
    expect(referenceFields("cheque").chequeDate).toBe(true);
    expect(referenceFields("neft_rtgs").chequeDate).toBe(false);
    expect(referenceFields("dd").bank).toBe(true);
  });
});

describe("paymentActions", () => {
  it("offers the full pending set to an approver", () => {
    const actions = paymentActions("pending", ALLOW_ALL).map((a) => a.action);
    expect(actions).toEqual(["clear", "cancel", "bounce"]);
  });

  it("separates approval from refund — the accountant/principal split", () => {
    const accountant = (permission: string) =>
      permission === "fee_refund:create";
    const principal = (permission: string) =>
      permission === "fee_payment:approve";

    expect(paymentActions("cleared", accountant).map((a) => a.action)).toEqual([
      "refund",
    ]);
    expect(paymentActions("cleared", principal).map((a) => a.action)).toEqual([
      "bounce",
      "reverse",
    ]);
  });

  it("renders nothing for a closed status, even for an approver", () => {
    expect(paymentActions("bounced", ALLOW_ALL)).toEqual([]);
    expect(paymentActions("reversed", ALLOW_ALL)).toEqual([]);
    expect(paymentActions("cancelled", ALLOW_ALL)).toEqual([]);
  });

  it("renders nothing when the caller has no grant", () => {
    expect(paymentActions("pending", DENY_ALL)).toEqual([]);
    expect(paymentActions("cleared", DENY_ALL)).toEqual([]);
  });
});

describe("canWaiveInstallment", () => {
  it("is a management act on a never-paid installment", () => {
    const open = { paymentStatus: "unpaid", paidAmount: "0.00" };
    const partPaid = { paymentStatus: "partial", paidAmount: "500.00" };
    expect(canWaiveInstallment(open, ALLOW_ALL)).toBe(true);
    expect(canWaiveInstallment(open, DENY_ALL)).toBe(false);
    expect(canWaiveInstallment(partPaid, ALLOW_ALL)).toBe(false);
  });
});

describe("isPayable", () => {
  it("accepts only an open balance", () => {
    expect(
      isPayable({ paymentStatus: "unpaid", balanceAmount: "100.00" }),
    ).toBe(true);
    expect(isPayable({ paymentStatus: "partial", balanceAmount: "0.01" })).toBe(
      true,
    );
    expect(isPayable({ paymentStatus: "paid", balanceAmount: "0.00" })).toBe(
      false,
    );
    expect(
      isPayable({ paymentStatus: "waived", balanceAmount: "100.00" }),
    ).toBe(false);
    expect(isPayable({ paymentStatus: "unpaid", balanceAmount: "0.00" })).toBe(
      false,
    );
  });
});

describe("paymentModeLabel", () => {
  it("names counter modes and the gateway's online rows", () => {
    expect(paymentModeLabel("cash")).toBe("Cash");
    expect(paymentModeLabel("neft_rtgs")).toBe("NEFT / RTGS");
    expect(paymentModeLabel("online_portal")).toBe("Online");
    expect(paymentModeLabel("mystery")).toBe("mystery");
  });
});

describe("installmentTitle", () => {
  it("prefers the generated description, then a numbered fallback", () => {
    expect(
      installmentTitle({
        description: "April 2026 Tuition Fee",
        installmentNumber: 4,
      }),
    ).toBe("April 2026 Tuition Fee");
    expect(installmentTitle({ description: "  ", installmentNumber: 4 })).toBe(
      "Installment 4",
    );
    expect(installmentTitle({})).toBe("Installment");
  });
});

describe("concessionValueError", () => {
  it("requires a positive amount and caps a percentage at 100", () => {
    expect(concessionValueError("flat", "2500")).toBeNull();
    expect(concessionValueError("flat", "0")).toBe("Enter a value above zero.");
    expect(concessionValueError("flat", "abc")).toBe(
      "Enter a value above zero.",
    );
    expect(concessionValueError("percentage", "100")).toBeNull();
    expect(concessionValueError("percentage", "100.01")).toBe(
      "A percentage cannot be more than 100.",
    );
  });
});

describe("daysBetweenIso / dueTiming / dueLabel", () => {
  it("counts calendar days, not elapsed milliseconds", () => {
    expect(daysBetweenIso("2026-10-01", "2026-10-26")).toBe(25);
    expect(daysBetweenIso("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetweenIso("nope", "2026-10-26")).toBeNull();
  });

  it("classifies upcoming / due / overdue", () => {
    expect(dueTiming("2026-11-01", "2026-10-26")).toBe("upcoming");
    expect(dueTiming("2026-10-26", "2026-10-26")).toBe("due");
    expect(dueTiming("2026-10-01", "2026-10-26")).toBe("overdue");
    expect(dueTiming(null, "2026-10-26")).toBe("none");
    expect(dueTiming("not-a-date", "2026-10-26")).toBe("none");
  });

  it("says how late, in words a parent understands", () => {
    expect(dueLabel("2026-10-26", "2026-10-26")).toBe("Due today");
    expect(dueLabel("2026-10-25", "2026-10-26")).toBe("1 day overdue");
    expect(dueLabel("2026-10-01", "2026-10-26")).toBe("25 days overdue");
    expect(dueLabel("2026-11-05", "2026-10-26")).toBe("Due 5 Nov 2026");
    expect(dueLabel(null, "2026-10-26")).toBe("No due date");
  });
});

describe("outstandingTotals", () => {
  it("sums exactly and separates the accruing late fee", () => {
    const totals = outstandingTotals([
      {
        amount: "1000.00",
        concessionAmount: "100.00",
        netAmount: "900.00",
        paidAmount: "400.00",
        balanceAmount: "500.00",
        lateFeeApplicable: "50.00",
      },
      {
        amount: "1000.00",
        concessionAmount: "0.00",
        netAmount: "1000.00",
        paidAmount: "0.00",
        balanceAmount: "1000.00",
        lateFeeApplicable: "0.00",
      },
    ]);

    expect(totals).toEqual({
      assessed: "2000.00",
      concession: "100.00",
      net: "1900.00",
      paid: "400.00",
      balance: "1500.00",
      lateFee: "50.00",
      count: 2,
    });
  });

  it("is settled only at a zero balance", () => {
    expect(isSettled({ balance: "0.00" })).toBe(true);
    expect(isSettled({ balance: "0.01" })).toBe(false);
  });
});

describe("oldestFirst", () => {
  it("orders by due date then installment number, stably", () => {
    const rows = [
      { id: "c", dueDate: "2026-06-10", installmentNumber: 2 },
      { id: "a", dueDate: "2026-04-10", installmentNumber: 1 },
      { id: "b", dueDate: "2026-06-10", installmentNumber: 1 },
      { id: "d", dueDate: "2026-04-10", installmentNumber: 1 },
    ];
    expect(oldestFirst(rows).map((row) => row.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("does not mutate the input", () => {
    const rows = [
      { id: "b", dueDate: "2026-06-10" },
      { id: "a", dueDate: "2026-04-10" },
    ];
    oldestFirst(rows);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

describe("nextClientReference", () => {
  it("is unique per attempt and short enough for the column", () => {
    const first = nextClientReference(1_700_000_000_000, () => 0.5);
    const second = nextClientReference(1_700_000_000_000, () => 0.75);
    expect(first).toMatch(/^mob-[a-z0-9]+-[a-z0-9]+$/);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(150);
  });
});

describe("buildReceiptText", () => {
  it("prints only server-issued values, with Indian money", () => {
    const text = buildReceiptText({
      schoolName: "Demo Public School — Main Campus",
      receiptNumber: "RCP-2026-00042",
      paymentDate: "2026-10-26",
      studentName: "Aditi Sharma",
      className: "Class 6 · A",
      lines: [
        { label: "April 2026 Tuition Fee", amount: "12500.00" },
        { label: "April 2026 Transport Fee", amount: "1500.00" },
      ],
      amount: "14000.00",
      lateFee: "250.00",
      total: "14250.00",
      modeLabel: "UPI",
      reference: "UPI-9931",
      collectedBy: "R. Menon",
    });

    expect(text).toContain("Receipt: RCP-2026-00042");
    expect(text).toContain("Date: 26 Oct 2026");
    expect(text).toContain("April 2026 Tuition Fee  ₹12,500.00");
    expect(text).toContain("Late fee: ₹250.00");
    expect(text).toContain("Total paid: ₹14,250.00");
    expect(text).toContain("Mode: UPI");
    expect(text).toContain("Reference: UPI-9931");
  });

  it("omits the late-fee line when nothing was charged", () => {
    const text = buildReceiptText({
      schoolName: "Demo",
      receiptNumber: "RCP-2026-00001",
      paymentDate: "2026-10-26",
      studentName: "A",
      className: "Class 6",
      lines: [],
      amount: "100.00",
      lateFee: "0.00",
      total: "100.00",
      modeLabel: "Cash",
    });
    expect(text).not.toContain("Late fee");
    expect(text).not.toContain("Reference:");
  });
});

describe("ledgerTotals", () => {
  it("sums cash in and out in paise and nets them", () => {
    const totals = ledgerTotals([
      { cashEffect: "in", amount: "12500.00" },
      { cashEffect: "in", amount: "250.50" },
      { cashEffect: "out", amount: "1500.25" },
    ]);
    expect(totals.credit).toBe("12750.50");
    expect(totals.debit).toBe("1500.25");
    expect(totals.net).toBe("11250.25");
  });

  it("lets the net go negative rather than flooring at zero", () => {
    const totals = ledgerTotals([
      { cashEffect: "in", amount: "100.00" },
      { cashEffect: "out", amount: "250.00" },
    ]);
    expect(totals.net).toBe("-150.00");
  });

  it("leaves receivable movements out of money in and out", () => {
    const totals = ledgerTotals([
      { cashEffect: "none", amount: "4500.00" },
      { cashEffect: "in", amount: "1000.00" },
    ]);
    expect(totals.credit).toBe("1000.00");
    expect(totals.debit).toBe("0.00");
  });

  it("ignores unparseable rows instead of zeroing the rest", () => {
    const totals = ledgerTotals([
      { cashEffect: "in", amount: "100.00" },
      { cashEffect: "in", amount: "not-money" },
      { cashEffect: "sideways", amount: "50.00" },
    ]);
    expect(totals.credit).toBe("100.00");
    expect(totals.debit).toBe("0.00");
    expect(totals.net).toBe("100.00");
  });
});

describe("ledgerTypeLabel", () => {
  it("prints a known type and falls back to the raw value", () => {
    expect(ledgerTypeLabel("fee_payment")).toBe("Fee payment");
    expect(ledgerTypeLabel("waiver_applied")).toBe("Waiver");
    expect(ledgerTypeLabel("future_type")).toBe("future_type");
  });
});

describe("monthRangeLabel", () => {
  it("names one month or a full range, falling back to the number", () => {
    expect(monthLabel(4)).toBe("April");
    expect(monthRangeLabel(4, 4)).toBe("April");
    expect(monthRangeLabel(1, 12)).toBe("All year");
    expect(monthRangeLabel(6, 9)).toBe("June – September");
    expect(monthLabel(13)).toBe("13");
  });
});
