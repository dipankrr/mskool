import { monthCells, studentStatusByDate } from "./student-calendar";

describe("monthCells", () => {
  it("pads a Monday-first month to full weeks", () => {
    const cells = monthCells("2026-10-15");
    expect(cells.length % 7).toBe(0);
    expect(cells.filter((cell): cell is string => cell !== null)).toHaveLength(31);
    expect(cells[0]).toBeNull();
    expect(cells).toContain("2026-10-01");
    expect(cells).toContain("2026-10-31");
  });

  it("handles a leap February", () => {
    const cells = monthCells("2024-02-10");
    expect(cells.filter((cell): cell is string => cell !== null)).toHaveLength(29);
    expect(cells).toContain("2024-02-29");
  });
});

describe("studentStatusByDate", () => {
  it("keeps only the requested student's days", () => {
    const map = studentStatusByDate(
      [
        { date: "2026-10-01", studentId: "a", status: "present" },
        { date: "2026-10-01", studentId: "b", status: "absent" },
        { date: "2026-10-02", studentId: "a", status: "late" },
      ],
      "a",
    );
    expect(map.get("2026-10-01")).toBe("present");
    expect(map.get("2026-10-02")).toBe("late");
    expect(map.size).toBe(2);
  });

  it("uses the last row for a duplicated date", () => {
    const map = studentStatusByDate(
      [
        { date: "2026-10-01", studentId: "a", status: "present" },
        { date: "2026-10-01", studentId: "a", status: "half_day" },
      ],
      "a",
    );
    expect(map.get("2026-10-01")).toBe("half_day");
  });
});
