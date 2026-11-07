import { concessionKey, dueName, duesInMonth, isOpen, isOverdue, isPositive, modeKey, openDues } from "./fees";
import type { Due } from "./fees";

const due = (id: string, dueDate: string, balance: string, status: Due["status"] = "unpaid"): Due => ({
  id,
  dueDate,
  balance,
  status,
});

describe("family fee rules", () => {
  it("reads money without floats", () => {
    expect(isPositive("0.00")).toBe(false);
    expect(isPositive("0.01")).toBe(true);
    expect(isPositive(null)).toBe(false);
  });

  it("keeps only dues with something left to pay, oldest first", () => {
    const list = [
      due("c", "2026-12-10", "500.00"),
      due("a", "2026-10-10", "1000.00", "partial"),
      due("b", "2026-11-10", "0.00", "paid"),
      due("d", "2026-09-10", "300.00", "waived"),
      due("e", "2026-08-10", "0.00", "unpaid"),
    ];
    expect(openDues(list).map((d) => d.id)).toEqual(["a", "c"]);
    expect(isOpen(list[3]!)).toBe(false);
  });

  it("filters a month by due date, paid ones included", () => {
    const list = [
      due("x", "2026-11-10", "0.00", "paid"),
      due("y", "2026-11-05", "200.00"),
      due("z", "2026-11-20", "100.00", "cancelled"),
      due("w", "2026-12-10", "100.00"),
    ];
    expect(duesInMonth(list, "2026-11").map((d) => d.id)).toEqual(["y", "x"]);
  });

  it("calls a due overdue only when open and past", () => {
    expect(isOverdue(due("a", "2026-11-01", "10.00"), "2026-11-07")).toBe(true);
    expect(isOverdue(due("a", "2026-11-07", "10.00"), "2026-11-07")).toBe(false);
    expect(isOverdue(due("a", "2026-11-01", "0.00", "paid"), "2026-11-07")).toBe(false);
  });

  it("names modes and concessions it knows, else other", () => {
    expect(modeKey("upi")).toBe("upi");
    expect(modeKey("barter")).toBe("other");
    expect(concessionKey("rte_waiver")).toBe("rte_waiver");
    expect(concessionKey("custom")).toBe("other");
  });
});

describe("due names", () => {
  it("names monthly, one-off and other dues", () => {
    expect(dueName({ feeHeadName: "Tuition Fee", description: "Tuition Fee — 2026-05", periodKey: "2026-05" })).toEqual({
      kind: "monthly",
      head: "Tuition Fee",
      month: "2026-05",
    });
    expect(dueName({ feeHeadName: "Other", description: "Picnic", periodKey: "one:abc" })).toEqual({ kind: "named", name: "Picnic" });
    expect(dueName({ feeHeadName: "Annual Fee", description: null, periodKey: "2026" })).toEqual({ kind: "named", name: "Annual Fee" });
  });
});
