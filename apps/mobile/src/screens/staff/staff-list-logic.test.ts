import { isOffice, matches, staffCounts, staffGroups, teachingTags } from "./staff-list-logic";
import type { ListPerson } from "./staff-list-logic";

const none = { classTeacherOf: null, subjects: [] };
function person(over: Partial<ListPerson> & { firstName: string }): ListPerson {
  return {
    lastName: "X",
    employeeCode: "EMP-1",
    phone: null,
    designation: null,
    teachesClasses: false,
    status: "active",
    joinState: "joined",
    teaching: none,
    ...over,
  };
}

const priya = person({ firstName: "Priya", designation: "Subject Teacher", teachesClasses: true });
const rakesh = person({ firstName: "Rakesh", designation: "Principal", teachesClasses: true, phone: "9000000002" });
const asha = person({ firstName: "Asha", designation: "Accountant", joinState: "not_invited" });
const sunil = person({ firstName: "Sunil", designation: "Clerk", status: "resigned" });
const people = [rakesh, asha, priya, sunil];

describe("staff list logic", () => {
  it("puts a teaching principal in both tabs and a plain teacher in one", () => {
    expect(isOffice(rakesh)).toBe(true);
    expect(isOffice(priya)).toBe(false);
    expect(isOffice(person({ firstName: "N", teachesClasses: true }))).toBe(false);
    expect(isOffice(asha)).toBe(true);
  });

  it("counts tabs over current people; overlap is allowed", () => {
    const c = staffCounts(people);
    expect([c.all, c.teaching, c.office, c.left]).toEqual([3, 2, 2, 1]);
    expect(c.notOnApp.map((p) => p.firstName)).toEqual(["Asha"]);
  });

  it("groups All once each, teaching first, A to Z", () => {
    const groups = staffGroups(people, { tab: "all", query: "", showLeft: false });
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.firstName)])).toEqual([
      ["Teaching", ["Priya", "Rakesh"]],
      ["Office", ["Asha"]],
    ]);
  });

  it("shows people who left only when asked, in their place", () => {
    const groups = staffGroups(people, { tab: "office", query: "", showLeft: true });
    expect(groups[0]!.rows.map((r) => r.firstName)).toEqual(["Asha", "Rakesh", "Sunil"]);
  });

  it("searches names, codes and phones across tabs", () => {
    expect(matches(rakesh, "rak")).toBe(true);
    expect(matches(rakesh, "00002")).toBe(true);
    expect(matches(rakesh, "emp-1")).toBe(true);
    expect(matches(rakesh, "zz")).toBe(false);
    const groups = staffGroups(people, { tab: "office", query: "priya", showLeft: false });
    expect(groups[0]!.rows.map((r) => r.firstName)).toEqual(["Priya"]);
  });

  it("builds teaching tags with the class teacher first", () => {
    const tags = teachingTags({
      classTeacherOf: { className: "Class 6", sectionName: "A" },
      subjects: [
        { subjectName: "Science", sections: [{ className: "Class 6", sectionName: "A" }, { className: "Class 6", sectionName: "B" }] },
        { subjectName: "Maths", sections: [{ className: "Class 7", sectionName: "A" }] },
        { subjectName: "EVS", sections: [{ className: "Class 5", sectionName: "A" }] },
      ],
    });
    expect(tags.shown.map((t) => t.label)).toEqual(["6-A", "Science · 6-A 6-B", "Maths · 7-A"]);
    expect(tags.shown[0]!.classTeacher).toBe(true);
    expect(tags.more).toBe(1);
  });
});
