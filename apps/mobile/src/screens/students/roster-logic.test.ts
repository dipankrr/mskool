import {
  activeFilterCount,
  emptyFilters,
  rosterItems,
  rosterVisibleViews,
} from "./roster-logic";

const row = (id: string, className: string | null, sectionName: string | null) => ({
  id,
  className,
  sectionName,
});

describe("rosterItems", () => {
  it("heads each class and section once, in class order", () => {
    const items = rosterItems(
      [row("a", "Class 6", "A"), row("b", "Class 6", "A"), row("c", "Class 6", "B")],
      "class",
    );
    expect(items.map((item) => item.key)).toEqual([
      "group-Class 6 · A",
      "a",
      "b",
      "group-Class 6 · B",
      "c",
    ]);
  });

  it("puts a class with no section under the class name", () => {
    expect(rosterItems([row("a", "Class 6", null)], "class")[0]).toMatchObject({
      kind: "group",
      label: "Class 6",
    });
  });

  it("gives students with no class one unnamed heading", () => {
    const items = rosterItems([row("a", null, null), row("b", null, null)], "class");
    expect(items.filter((item) => item.kind === "group")).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: null });
  });

  it("adds no headings to name or newest order", () => {
    const rows = [row("a", "Class 6", "A"), row("b", "Class 7", "A")];
    expect(rosterItems(rows, "name").map((item) => item.key)).toEqual(["a", "b"]);
    expect(rosterItems(rows, "newest").map((item) => item.key)).toEqual(["a", "b"]);
  });
});

describe("rosterVisibleViews", () => {
  const counts = { current: 5, notPlaced: 0, left: 2, alumni: 0, all: 7 };

  it("always shows Current and All, and the rest only with someone in them", () => {
    expect(rosterVisibleViews("current", counts)).toEqual(["current", "left", "all"]);
  });

  it("keeps the open tab after its last student has moved", () => {
    expect(rosterVisibleViews("alumni", counts)).toContain("alumni");
  });

  it("shows only the two fixed tabs before the counts arrive", () => {
    expect(rosterVisibleViews("current", undefined)).toEqual(["current", "all"]);
  });
});

describe("activeFilterCount", () => {
  it("counts each filter in use", () => {
    expect(activeFilterCount(emptyFilters)).toBe(0);
    expect(
      activeFilterCount({ ...emptyFilters, classId: "c", gender: "female", noPhoto: true }),
    ).toBe(3);
  });

  it("ignores a half-typed admission year", () => {
    expect(activeFilterCount({ ...emptyFilters, admissionYear: "20" })).toBe(0);
    expect(activeFilterCount({ ...emptyFilters, admissionYear: "2026" })).toBe(1);
  });
});
