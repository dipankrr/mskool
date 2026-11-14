import {
  exclusiveEnd,
  filledPercent,
  groupMyTeaching,
  lastDayOf,
  sectionLabel,
  teachingLine,
} from "./teaching-logic";

const row = (
  role: "class_teacher" | "subject_teacher",
  className: string,
  sectionName: string,
  subjectName: string | null = null,
) => ({ role, className, sectionName, subjectName });

describe("teaching logic (ADR-068)", () => {
  it("labels sections the way schools say them", () => {
    expect(sectionLabel("Class 6", "A")).toBe("6-A");
    expect(sectionLabel("Nursery", "B")).toBe("Nursery-B");
    expect(sectionLabel("Class 6", "6-A")).toBe("6-A");
  });

  it("groups class teacher first, subjects with their sections, no duplicates", () => {
    const groups = groupMyTeaching([
      row("subject_teacher", "Class 6", "A", "Maths"),
      row("class_teacher", "Class 6", "A"),
      row("subject_teacher", "Class 6", "B", "Maths"),
      row("subject_teacher", "Class 6", "B", "Maths"),
      row("subject_teacher", "Class 8", "A", "Science"),
    ]);
    expect(groups.classTeacher).toBe("6-A");
    expect(groups.subjects).toEqual([
      { name: "Maths", sections: ["6-A", "6-B"] },
      { name: "Science", sections: ["8-A"] },
    ]);
    expect(groups.count).toBe(4);
  });

  it("says nothing when nothing is assigned", () => {
    expect(teachingLine([])).toBeNull();
    expect(groupMyTeaching([]).count).toBe(0);
  });

  it("writes Home's line", () => {
    expect(
      teachingLine([
        row("class_teacher", "Class 6", "A"),
        row("subject_teacher", "Class 6", "A", "Maths"),
        row("subject_teacher", "Class 7", "A", "Maths"),
      ]),
    ).toBe("Class teacher of 6-A · Maths in 6-A, 7-A");
  });

  it("rounds the filled share and survives an empty session", () => {
    expect(filledPercent(38, 47)).toBe(81);
    expect(filledPercent(0, 0)).toBe(0);
  });

  it("stores a substitute's last day as the next day, and back", () => {
    expect(exclusiveEnd("2026-11-28")).toBe("2026-11-29");
    expect(exclusiveEnd("2026-12-31")).toBe("2027-01-01");
    expect(lastDayOf("2026-11-29")).toBe("2026-11-28");
  });
});
