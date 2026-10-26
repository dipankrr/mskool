import {
  clampAllocation,
  formatAmountDigits,
  formatMoney,
  isPositiveMoney,
  paidPercent,
  parseMoney,
  sanitizeAmountInput,
  subtractMoney,
  sumMoney,
  toInputAmount,
  toMoneyString,
} from "./money";

describe("parseMoney", () => {
  it("reads wire decimals exactly, without float drift", () => {
    expect(parseMoney("0.00")).toBe(0n);
    expect(parseMoney("1250")).toBe(125000n);
    expect(parseMoney("1250.5")).toBe(125050n);
    expect(parseMoney("1250.05")).toBe(125005n);
    expect(parseMoney(" 42.10 ")).toBe(4210n);
    // 0.1 + 0.2 is the classic float trap; paise makes it exact.
    expect((parseMoney("0.1") ?? 0n) + (parseMoney("0.2") ?? 0n)).toBe(30n);
  });

  it("rejects anything that is not a plain 2-dp decimal", () => {
    expect(parseMoney("1.234")).toBeNull(); // more than paise
    expect(parseMoney("1,250.00")).toBeNull(); // grouping is display only
    expect(parseMoney("₹1250")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("1e5")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });

  it("keeps the sign for ledger corrections", () => {
    expect(parseMoney("-25.50")).toBe(-2550n);
  });
});

describe("toMoneyString", () => {
  it("always emits two decimals — the shape the API validates", () => {
    expect(toMoneyString(0n)).toBe("0.00");
    expect(toMoneyString(5n)).toBe("0.05");
    expect(toMoneyString(125000n)).toBe("1250.00");
    expect(toMoneyString(-2550n)).toBe("-25.50");
  });
});

describe("formatMoney", () => {
  it("groups the Indian way: last three, then pairs", () => {
    expect(formatMoney("0.00")).toBe("₹0");
    expect(formatMoney("999.99")).toBe("₹999.99");
    expect(formatMoney("1000")).toBe("₹1,000");
    expect(formatMoney("125000")).toBe("₹1,25,000");
    expect(formatMoney("12345678.90")).toBe("₹1,23,45,678.90");
  });

  it("uses a true minus sign for negatives and an em dash for missing", () => {
    expect(formatMoney("-25.50")).toBe("−₹25.50");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("nope")).toBe("—");
  });
});

describe("formatAmountDigits", () => {
  it("groups without the symbol, and drops a zero fraction", () => {
    expect(formatAmountDigits("125000")).toBe("1,25,000");
    expect(formatAmountDigits("1250.5")).toBe("1,250.50");
    expect(formatAmountDigits("junk")).toBe("junk");
  });
});

describe("sumMoney", () => {
  it("sums exactly and ignores unparseable entries", () => {
    expect(sumMoney(["100.10", "200.20", "0.70"])).toBe("301.00");
    expect(sumMoney(["100", null, "junk"])).toBe("100.00");
    expect(sumMoney([])).toBe("0.00");
  });
});

describe("isPositiveMoney", () => {
  it("is true only for a parseable amount above zero", () => {
    expect(isPositiveMoney("0.01")).toBe(true);
    expect(isPositiveMoney("0.00")).toBe(false);
    expect(isPositiveMoney("-1.00")).toBe(false);
    expect(isPositiveMoney("x")).toBe(false);
  });
});

describe("clampAllocation", () => {
  it("caps at the outstanding balance instead of letting the server refuse", () => {
    expect(clampAllocation("5000", "2500")).toBe("2500.00");
    expect(clampAllocation("2500", "2500")).toBe("2500.00");
    expect(clampAllocation("100.50", "2500")).toBe("100.50");
  });

  it("collapses junk, zero and negative requests to zero", () => {
    expect(clampAllocation("", "2500")).toBe("0.00");
    expect(clampAllocation("abc", "2500")).toBe("0.00");
    expect(clampAllocation("-10", "2500")).toBe("0.00");
    expect(clampAllocation("100", "0.00")).toBe("0.00");
    expect(clampAllocation("100", "-5")).toBe("0.00");
  });
});

describe("subtractMoney", () => {
  it("subtracts exactly and never inverts a balance", () => {
    expect(subtractMoney("2500", "500")).toBe("2000.00");
    expect(subtractMoney("0.30", "0.10")).toBe("0.20");
    expect(subtractMoney("500", "2500")).toBe("0.00");
  });
});

describe("paidPercent", () => {
  it("reports a whole-number collection meter, clamped to 0–100", () => {
    expect(paidPercent("0", "10000")).toBe(0);
    expect(paidPercent("2500", "10000")).toBe(25);
    expect(paidPercent("10000", "10000")).toBe(100);
    expect(paidPercent("12000", "10000")).toBe(100);
    expect(paidPercent("100", "0")).toBe(0);
  });
});

describe("sanitizeAmountInput", () => {
  it("keeps digits and one point with at most two decimals", () => {
    expect(sanitizeAmountInput("1500")).toBe("1500");
    expect(sanitizeAmountInput("1500.")).toBe("1500.");
    expect(sanitizeAmountInput("1500.5")).toBe("1500.5");
    expect(sanitizeAmountInput("1500.555")).toBe("1500.55");
    expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
  });

  it("drops grouping, symbols and signs a paste may carry", () => {
    expect(sanitizeAmountInput("₹1,23,456.00")).toBe("123456.00");
    expect(sanitizeAmountInput("-50")).toBe("50");
  });

  it("caps the whole part at ten digits", () => {
    expect(sanitizeAmountInput("12345678901234")).toBe("1234567890");
  });
});

describe("toInputAmount", () => {
  it("drops .00 and keeps real paise", () => {
    expect(toInputAmount("5000.00")).toBe("5000");
    expect(toInputAmount("49.50")).toBe("49.50");
    expect(toInputAmount(null)).toBe("");
  });
});
