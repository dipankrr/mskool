import { planTeacherChanges, teacherGrid } from "./teacher-grid";
import type { OverviewLike } from "./teacher-grid";
import { orderPicker } from "../staff/teacher-picker-logic";

const t = (id: string, staffId: string, name: string) => ({ assignmentId: id, staffId, name });

const overview: OverviewLike = {
  sections: [
    {
      sectionId: "s6a",
      sectionName: "A",
      className: "Class 6",
      classTeacher: t("ct1", "priya", "Priya Rao"),
      subjects: [
        { subjectId: "math", subjectName: "Maths", teachers: [t("a1", "priya", "Priya Rao")] },
        { subjectId: "eng", subjectName: "English", teachers: [t("a2", "arjun", "Arjun Das")] },
      ],
    },
    {
      sectionId: "s6b",
      sectionName: "B",
      className: "Class 6",
      classTeacher: null,
      subjects: [
        { subjectId: "math", subjectName: "Maths", teachers: [t("a3", "rakesh", "Rakesh Kumar")] },
        { subjectId: "eng", subjectName: "English", teachers: [] },
      ],
    },
  ],
};

describe("by-teacher grid (ADR-068)", () => {
  it("lists the teacher's subjects with every section that takes them", () => {
    const grid = teacherGrid(overview, "priya");
    expect(grid.subjects.map((s) => s.subjectName)).toEqual(["Maths"]);
    const cells = grid.subjects[0]!.classes[0]!.sections;
    expect(cells.map((c) => [c.label, c.mine, c.others])).toEqual([
      ["6-A", true, []],
      ["6-B", false, ["Rakesh Kumar"]],
    ]);
    expect(grid.classTeacherOf?.sectionId).toBe("s6a");
    expect(grid.slotCount).toBe(2);
    expect(grid.sectionCount).toBe(1);
    expect(grid.otherSubjects).toEqual([{ subjectId: "eng", subjectName: "English" }]);
  });

  it("adds a picked subject", () => {
    const grid = teacherGrid(overview, "priya", ["eng"]);
    expect(grid.subjects.map((s) => s.subjectName)).toEqual(["English", "Maths"]);
  });

  it("plans adds alongside others and ends only this teacher's rows", () => {
    const grid = teacherGrid(overview, "priya");
    const plan = planTeacherChanges(grid, new Set(["math:s6a", "math:s6b"]), undefined);
    expect(plan.end).toEqual(["a1"]);
    expect(plan.add).toEqual([{ sectionId: "s6b", role: "subject_teacher", subjectId: "math" }]);
  });

  it("moves or removes the class teacher job", () => {
    const grid = teacherGrid(overview, "priya");
    expect(planTeacherChanges(grid, new Set(), "s6b")).toEqual({
      add: [{ sectionId: "s6b", role: "class_teacher", subjectId: null }],
      end: ["ct1"],
    });
    expect(planTeacherChanges(grid, new Set(), null)).toEqual({ add: [], end: ["ct1"] });
    expect(planTeacherChanges(grid, new Set(), "s6a")).toEqual({ add: [], end: [] });
  });
});

describe("teacher picker order (ADR-068)", () => {
  const people = [
    { staffId: "a", name: "Neha", designation: "TGT", teachesClasses: true, slots: 4 },
    { staffId: "b", name: "Rakesh", designation: "PGT", teachesClasses: true, slots: 12 },
    { staffId: "c", name: "Mohan", designation: "Accountant", teachesClasses: false, slots: 0 },
    { staffId: "d", name: "Meera", designation: "TGT", teachesClasses: true, slots: 3 },
  ];

  it("puts subject teachers first, hides non-teachers and the excluded, marks the busiest", () => {
    const out = orderPicker(people, { query: "", showAll: false, prefer: ["b"], exclude: ["d"] });
    expect(out.groups[0]!.people.map((p) => [p.name, p.busiest])).toEqual([["Rakesh", true]]);
    expect(out.groups[1]!.people.map((p) => p.name)).toEqual(["Neha"]);
    expect(out.total).toBe(2);
  });

  it("searches, and shows everyone on request", () => {
    expect(orderPicker(people, { query: "moh", showAll: true, prefer: [], exclude: [] }).total).toBe(1);
    expect(orderPicker(people, { query: "moh", showAll: false, prefer: [], exclude: [] }).total).toBe(0);
  });
});
