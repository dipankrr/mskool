import { describe, expect, it } from "vitest";

import {
  minDaysForMonth,
  rankEntries,
  topList,
  type RankingEntry,
} from "./attendance-ranking";

function entry(name: string, percentage: string | null, workingDays = 20): RankingEntry {
  return { studentId: name, name, workingDays, daysAttended: 0, percentage };
}

describe("rankEntries", () => {
  it("shares a rank on equal percentages and skips the next ones", () => {
    const ranked = rankEntries(
      [entry("D", "90.00"), entry("A", "100.00"), entry("C", "95.00"), entry("B", "95.00")],
      15,
    );
    expect(ranked.map((e) => [e.name, e.rank])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 2],
      ["D", 4],
    ]);
  });

  it("orders a tie by name", () => {
    const ranked = rankEntries([entry("zoya", "90.00"), entry("Amit", "90.00")], 1);
    expect(ranked.map((e) => e.name)).toEqual(["Amit", "zoya"]);
  });

  it("leaves out students below the minimum days and with no marks", () => {
    const ranked = rankEntries(
      [entry("A", "100.00", 14), entry("B", "80.00", 15), entry("C", null)],
      15,
    );
    expect(ranked.map((e) => e.name)).toEqual(["B"]);
    expect(ranked[0]!.rank).toBe(1);
  });
});

describe("topList", () => {
  it("shows everyone tied at 10th", () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => entry(`S${i}`, `${99 - i}.00`)),
      entry("T1", "50.00"),
      entry("T2", "50.00"),
      entry("Last", "10.00"),
    ];
    const top = topList(rankEntries(entries, 1));
    expect(top).toHaveLength(11);
    expect(top.slice(-2).map((e) => e.rank)).toEqual([10, 10]);
  });
});

describe("minDaysForMonth", () => {
  it("is half the school's working days so far, rounded up, at least one", () => {
    expect(minDaysForMonth(0)).toBe(1);
    expect(minDaysForMonth(1)).toBe(1);
    expect(minDaysForMonth(9)).toBe(5);
    expect(minDaysForMonth(22)).toBe(11);
  });
});
