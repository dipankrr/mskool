import { buildNav, itemForPath, searchNav } from "./nav";

const withGrants = (...grants: string[]) => {
  const set = new Set(grants);
  return (permission: string) => set.has(permission);
};

const keys = (groups: ReturnType<typeof buildNav>) =>
  groups.flatMap((group) => group.items.map((item) => item.key));

describe("buildNav", () => {
  it("shows only Home to someone with no grants", () => {
    const groups = buildNav(withGrants());
    expect(keys(groups)).toEqual(["home"]);
  });

  it("drops a group the caller holds nothing in, and the Soon line with it", () => {
    const groups = buildNav(withGrants("student:read"));
    expect(groups.map((group) => group.key)).toEqual(["top", "daily"]);
    expect(keys(groups)).not.toContain("timetable");
  });

  it("filters sub-lines one by one", () => {
    const groups = buildNav(withGrants("student:read", "student:create"));
    const students = groups[1]!.items.find((item) => item.key === "students")!;
    expect(students.subs.map((sub) => sub.key)).toEqual(["students-all", "students-admit"]);
  });

  it("never lets a sub-line rescue a parent the caller cannot open", () => {
    const groups = buildNav(withGrants("student:create", "student:update"));
    expect(keys(groups)).toEqual(["home"]);
  });

  it("opens an item directly when one sub-line is all that is left", () => {
    const groups = buildNav(withGrants("attendance:read"));
    const attendance = groups[1]!.items.find((item) => item.key === "attendance")!;
    expect(attendance.subs).toEqual([]);
    expect(attendance.href).toBe("/attendance");
    expect(attendance.tab).toBe(true);
  });

  it("needs a write grant for Branches and Sessions, as More did", () => {
    expect(keys(buildNav(withGrants("school:read", "academic_year:read")))).toEqual(["home"]);
    expect(keys(buildNav(withGrants("school:read", "school:update")))).toContain("branches");
  });

  it("keeps Timetable, tagged, beside a real Academics line", () => {
    const groups = buildNav(withGrants("exam:read"));
    const timetable = groups.find((group) => group.key === "academics")!.items.find((item) => item.key === "timetable")!;
    expect(timetable.soon).toBe(true);
    expect(timetable.href).toBeUndefined();
  });
});

describe("searchNav", () => {
  const groups = buildNav(
    withGrants("student:read", "student:create", "student:update", "exam:read", "exam:create", "subject:read"),
  );

  it("returns nothing for an empty query", () => {
    expect(searchNav(groups, "  ")).toEqual([]);
  });

  it("finds a sub-line by its own name and names its item", () => {
    const [match] = searchNav(groups, "bulk");
    expect(match).toMatchObject({ key: "students-photos", parent: "Students" });
  });

  it("lists every sub-line of an item matched by name", () => {
    const found = searchNav(groups, "exam").map((match) => match.key);
    expect(found).toEqual(expect.arrayContaining(["exams-all", "exams-create", "exams-term-grades"]));
  });

  it("finds an item that opens directly", () => {
    expect(searchNav(groups, "subj")[0]).toMatchObject({ key: "subjects", parent: null });
  });

  it("never offers the Soon line", () => {
    expect(searchNav(groups, "timetable")).toEqual([]);
  });
});

describe("itemForPath", () => {
  const groups = buildNav(withGrants("student:read", "student:update", "exam:read"));

  it("matches a tab through its route groups", () => {
    expect(itemForPath(groups, "/students")).toBe("students");
  });

  it("matches a pushed screen to its item", () => {
    expect(itemForPath(groups, "/students/photos")).toBe("students");
  });

  it("is null for a screen the sidebar does not list", () => {
    expect(itemForPath(groups, "/profile")).toBeNull();
  });
});
