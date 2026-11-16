import { areasFor, withAlpha } from "./areas";
import { currentTerm, daysUntil, fraction, monthInitials, weekOf } from "./time";

const grants = (...list: string[]) => {
  const set = new Set(list);
  return (permission: string) => set.has(permission);
};

describe("areasFor", () => {
  it("always has Overview, first", () => {
    expect(areasFor(grants(), false)).toEqual(["overview"]);
  });

  it("gives a principal every area in order", () => {
    const has = grants("exam:read", "class:read", "staff:read", "school:read", "school:update", "academic_year:read", "academic_year:update");
    expect(areasFor(has, true)).toEqual(["overview", "exams", "academics", "staff", "school"]);
  });

  it("gives a teacher Teaching in place of Staff", () => {
    expect(areasFor(grants("exam:read"), true)).toEqual(["overview", "exams", "teaching"]);
  });

  it("needs a write grant for School, as More did", () => {
    expect(areasFor(grants("school:read", "academic_year:read"), false)).toEqual(["overview"]);
  });
});

describe("time", () => {
  const terms = [
    { name: "Term 2", startDate: "2026-09-01", endDate: "2026-12-20" },
    { name: "Term 1", startDate: "2026-04-01", endDate: "2026-08-31" },
  ];

  it("finds the term running today", () => {
    expect(currentTerm(terms, "2026-11-16")?.name).toBe("Term 2");
    expect(currentTerm(terms, "2027-01-02")).toBeNull();
  });

  it("counts weeks into a term", () => {
    expect(weekOf(terms[0]!, "2026-09-01")).toEqual({ week: 1, weeks: 16 });
    expect(weekOf(terms[0]!, "2026-11-16").week).toBe(11);
  });

  it("places today on a span, clamped", () => {
    expect(fraction("2026-04-01", "2027-03-31", "2025-01-01")).toBe(0);
    expect(fraction("2026-04-01", "2027-03-31", "2028-01-01")).toBe(1);
    expect(fraction("2026-01-01", "2026-01-11", "2026-01-06")).toBeCloseTo(0.5);
  });

  it("counts days either way", () => {
    expect(daysUntil("2026-11-19", "2026-11-16")).toBe(3);
    expect(daysUntil("2026-11-10", "2026-11-16")).toBe(-6);
  });

  it("starts the month initials at the session's month", () => {
    expect(monthInitials("2026-04-01").join("")).toBe("AMJJASONDJFM");
  });

  it("adds an alpha byte to a colour", () => {
    expect(withAlpha("#C4520A", 0.3)).toBe("#C4520A4D");
  });
});
