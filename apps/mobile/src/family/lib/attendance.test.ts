import { clampMonth, dayLook, isTopRank, monthBounds, monthGrid, monthKeyOf, shiftMonth } from "./attendance";
import type { MonthDay } from "./attendance";

const day = (date: string, extra: Partial<MonthDay> = {}): MonthDay => ({
  date,
  dayType: "working",
  label: null,
  enrolled: true,
  status: "present",
  ...extra,
});

describe("family attendance rules", () => {
  it("steps months across year ends", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-04", -11)).toBe("2025-05");
    expect(monthKeyOf("2026-11-07")).toBe("2026-11");
    expect(clampMonth("2027-02", "2026-04", "2026-11")).toBe("2026-11");
  });

  it("bounds months from the first term to today", () => {
    expect(monthBounds("2026-11-07", ["2026-10-01", "2026-04-01"])).toEqual({ first: "2026-04", last: "2026-11" });
    expect(monthBounds("2026-11-07", [])).toEqual({ first: "2025-12", last: "2026-11" });
  });

  it("lays a month out Monday first with blanks", () => {
    // November 2026 starts on a Sunday: six blanks, then the 1st.
    const weeks = monthGrid("2026-11", [day("2026-11-02")]);
    expect(weeks[0]!.slice(0, 6).every((c) => c.kind === "blank")).toBe(true);
    expect(weeks[0]![6]).toMatchObject({ kind: "day", day: 1, info: null });
    expect(weeks.flat().filter((c) => c.kind === "day")).toHaveLength(30);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[1]![0]).toMatchObject({ kind: "day", day: 2, info: { status: "present" } });
  });

  it("reads each day for a family", () => {
    const today = "2026-11-07";
    expect(dayLook(day("2026-11-02"), "2026-11-02", today)).toBe("present");
    expect(dayLook(day("2026-11-03", { status: "absent" }), "2026-11-03", today)).toBe("absent");
    expect(dayLook(day("2026-11-04", { status: "not_marked" }), "2026-11-04", today)).toBe("notMarked");
    expect(dayLook(day("2026-11-09", { status: "not_marked" }), "2026-11-09", today)).toBe("upcoming");
    expect(dayLook(day("2026-11-08", { dayType: "weekend", status: null }), "2026-11-08", today)).toBe("holiday");
    expect(dayLook(day("2026-11-05", { enrolled: false }), "2026-11-05", today)).toBe("notEnrolled");
    expect(dayLook(null, "2026-11-20", today)).toBe("upcoming");
    expect(dayLook(day("2026-11-10"), "2026-11-10", today)).toBe("upcoming");
    expect(dayLook(null, "2026-11-01", today)).toBe("none");
  });

  it("cheers a top-ten rank only", () => {
    expect(isTopRank(3)).toBe(true);
    expect(isTopRank(11)).toBe(false);
    expect(isTopRank(null)).toBe(false);
  });
});
