import { describe, expect, it } from "vitest";

import {
  collectionPercent,
  isCurrentMonth,
  isFutureMonth,
  matrixRowBalance,
  settlementPercent,
} from "./matrix-helpers";

describe("matrix money helpers", () => {
  it("calculates settlement bars with exact integer percentages", () => {
    expect(settlementPercent("0.00", "0.00")).toBe(0n);
    expect(settlementPercent("100.00", "0.01")).toBe(0n);
    expect(settlementPercent("3.00", "1.00")).toBe(33n);
    expect(settlementPercent("3.00", "2.00")).toBe(66n);
    expect(settlementPercent("3.00", "3.00")).toBe(100n);
  });

  it("calculates collection percentages without floating point", () => {
    expect(collectionPercent("0.00", "0.00")).toBeNull();
    expect(collectionPercent("0.00", "100.00")).toBe(0n);
    expect(collectionPercent("0.01", "0.03")).toBe(33n);
    expect(collectionPercent("100.00", "100.00")).toBe(100n);
  });

  it("adds opening balance to the server total exactly", () => {
    expect(
      matrixRowBalance({
        totals: { balanceAmount: "0.03" },
        openingBalance: { balance: "0.01" },
      }),
    ).toBe("0.04");
  });
});

describe("matrix month helpers", () => {
  it("identifies the current and future month by calendar key", () => {
    expect(isCurrentMonth("2026-04", "2026-04")).toBe(true);
    expect(isCurrentMonth("2026-05", "2026-04")).toBe(false);
    expect(isFutureMonth("2026-05", "2026-04")).toBe(true);
    expect(isFutureMonth("2026-03", "2026-04")).toBe(false);
  });
});
