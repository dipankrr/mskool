import { describe, expect, it } from "vitest";

import {
  addMoney,
  clampMoney,
  compareMoney,
  formatMoney,
  formatMoneyPlain,
  fromPaise,
  isMoneyString,
  maxMoney,
  minMoney,
  subtractMoney,
  toPaise,
} from "./money";

/**
 * The money module's tests pin the invariant the whole fees UI leans on:
 * no float is ever constructed — not in the helpers, and not in these
 * tests. Every assertion goes through the public API on strings, and the
 * round-trip cases are chosen to be the ones a float would misround
 * (₹0.10, 12,50,000.01) so a regression to float math fails a test
 * rather than a reconciliation.
 */

describe("isMoneyString", () => {
  it.each([
    "0",
    "12",
    "12.5",
    "12.50",
    "12000.00",
    "100000000.99",
  ])("accepts %s", (value) => {
    expect(isMoneyString(value)).toBe(true);
  });

  it.each([
    "12.505",
    "1e3",
    "-5",
    " 12",
    "12 ",
    "",
    "abc",
    "12.",
    ".50",
    null,
    undefined,
    12.5,
  ])("refuses %s", (value) => {
    expect(isMoneyString(value)).toBe(false);
  });
});

describe("toPaise / fromPaise", () => {
  it.each([
    ["0", 0n],
    ["12", 1200n],
    ["12.5", 1250n],
    ["12.50", 1250n],
    ["12000.00", 1200000n],
    ["0.01", 1n],
    ["0.10", 10n],
    ["100000000.99", 10000000099n],
  ])("converts %s exactly", (value, paise) => {
    expect(toPaise(value)).toBe(paise);
  });

  it.each([
    ["0.00", 0n],
    ["12.50", 1250n],
    ["12000.00", 1200000n],
  ])("converts %n back to %s", (expected, paise) => {
    expect(fromPaise(paise)).toBe(expected);
  });

  it("round-trips the paise-exact cases a float would misround", () => {
    for (const value of ["0.01", "0.10", "100000000.99", "12345.67"]) {
      expect(fromPaise(toPaise(value))).toBe(value.replace(/^(\d+)$/, "$1.00"));
    }
  });

  it("preserves the sign through fromPaise", () => {
    expect(fromPaise(-1250n)).toBe("-12.50");
  });
});

describe("addMoney / subtractMoney", () => {
  it("sums exactly, any argument count", () => {
    expect(addMoney()).toBe("0.00");
    expect(addMoney("12.50")).toBe("12.50");
    expect(addMoney("0.01", "0.10")).toBe("0.11");
    expect(addMoney("1000.00", "1000.00", "1000.00")).toBe("3000.00");
    expect(addMoney("1250000.01", "0.01")).toBe("1250000.02");
  });

  it("subtracts exactly, signed results", () => {
    expect(subtractMoney("12.50", "2.50")).toBe("10.00");
    expect(subtractMoney("2.50", "12.50")).toBe("-10.00");
  });

  it("never drifts on the ledger-style sum", () => {
    // 1000 installments of ₹0.01: a float accumulator loses cents; paise does not.
    const pennies = Array.from({ length: 1000 }, () => "0.01");
    expect(addMoney(...pennies)).toBe("10.00");
  });
});

describe("compareMoney / minMoney / maxMoney / clampMoney", () => {
  it("compares by value, not string order", () => {
    expect(compareMoney("9.00", "10.00")).toBe(-1);
    expect(compareMoney("10.00", "9.00")).toBe(1);
    expect(compareMoney("12.5", "12.50")).toBe(0);
  });

  it("picks the extremes", () => {
    expect(minMoney("9.00", "10.00")).toBe("9.00");
    expect(maxMoney("9.00", "10.00")).toBe("10.00");
  });

  it("clamps into the bracket", () => {
    expect(clampMoney("150.00", "0.00", "100.00")).toBe("100.00");
    expect(clampMoney("50.00", "0.00", "100.00")).toBe("50.00");
    expect(clampMoney("0.00", "10.00", "100.00")).toBe("10.00");
  });
});

describe("formatMoney / formatMoneyPlain", () => {
  it("formats with the rupee sign, en-IN grouping, two decimals", () => {
    expect(formatMoney("12000.00")).toBe("₹ 12,000.00");
    expect(formatMoney("1250000.00")).toBe("₹ 12,50,000.00");
    expect(formatMoney("100000000.99")).toBe("₹ 10,00,00,000.99");
    expect(formatMoney("0.50")).toBe("₹ 0.50");
    expect(formatMoney("500")).toBe("₹ 500.00");
  });

  it("formats negatives with a true minus sign", () => {
    expect(formatMoney("-12.50")).toBe("−₹ 12.50");
  });

  it("renders absent or invalid input as an em dash, never as zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney("1e3")).toBe("—");
    expect(formatMoney("12.505")).toBe("—");
  });

  it("plain variant drops the sign and space", () => {
    expect(formatMoneyPlain("12000.00")).toBe("12,000.00");
    expect(formatMoneyPlain("bad")).toBe("—");
  });
});
