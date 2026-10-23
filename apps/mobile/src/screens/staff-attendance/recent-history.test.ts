import { collectRecentDays } from "./recent-history";

function mark(date: string, studentId: string, status: "present" | "absent" | "late") {
  return { date, studentId, status };
}

describe("collectRecentDays", () => {
  it("keeps the last five distinct marked dates in chronological order", () => {
    const rows = [
      mark("2026-03-02", "s1", "present"),
      mark("2026-03-03", "s1", "absent"),
      mark("2026-03-04", "s1", "present"),
      mark("2026-03-05", "s1", "late"),
      mark("2026-03-06", "s1", "present"),
      mark("2026-03-09", "s1", "present"),
    ];
    expect(collectRecentDays(rows).map((day) => day.date)).toEqual([
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-09",
    ]);
  });

  it("groups every student under their date and leaves missing marks absent", () => {
    const days = collectRecentDays([
      mark("2026-03-05", "s1", "present"),
      mark("2026-03-05", "s2", "absent"),
      mark("2026-03-06", "s1", "late"),
    ]);
    expect(days).toHaveLength(2);
    expect(days[0]?.statuses.get("s1")).toBe("present");
    expect(days[0]?.statuses.get("s2")).toBe("absent");
    expect(days[1]?.statuses.get("s1")).toBe("late");
    expect(days[1]?.statuses.has("s2")).toBe(false);
  });

  it("ignores row order and duplicate dates", () => {
    const days = collectRecentDays([
      mark("2026-03-06", "s1", "absent"),
      mark("2026-03-05", "s1", "present"),
      mark("2026-03-06", "s1", "present"),
    ]);
    expect(days.map((day) => day.date)).toEqual(["2026-03-05", "2026-03-06"]);
    expect(days[1]?.statuses.get("s1")).toBe("present");
  });

  it("returns an empty fold for no history", () => {
    expect(collectRecentDays([])).toEqual([]);
  });
});
