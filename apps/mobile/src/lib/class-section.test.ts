import {
  classesWithoutSection,
  nextClassOrder,
  nextSectionName,
  sectionsByClass,
} from "./class-section";

describe("nextSectionName", () => {
  it("starts a class with no sections at A", () => {
    expect(nextSectionName([])).toBe("A");
  });

  it("follows the highest letter, whatever the order or case", () => {
    expect(nextSectionName(["B", "a"])).toBe("C");
  });

  it("leaves the field empty when names aren't letters", () => {
    expect(nextSectionName(["Rose", "Lily"])).toBe("");
  });

  it("ignores names that aren't letters when some are", () => {
    expect(nextSectionName(["A", "Rose"])).toBe("B");
  });

  it("leaves the field empty after Z", () => {
    expect(nextSectionName(["Z"])).toBe("");
  });
});

describe("nextClassOrder", () => {
  it("starts at 1", () => {
    expect(nextClassOrder([])).toBe("1");
  });

  it("follows the highest order, including negatives", () => {
    expect(nextClassOrder([-3, -2])).toBe("-1");
    expect(nextClassOrder([1, 6, 2])).toBe("7");
  });

  it("stays inside the allowed range", () => {
    expect(nextClassOrder([20])).toBe("20");
  });
});

describe("sectionsByClass", () => {
  it("keeps a class with no sections as an empty entry", () => {
    const grouped = sectionsByClass(
      ["c6", "c7"],
      [
        { classId: "c6", name: "A" },
        { classId: "c6", name: "B" },
      ],
    );
    expect(grouped.get("c6")).toHaveLength(2);
    expect(grouped.get("c7")).toEqual([]);
    expect(classesWithoutSection(grouped)).toBe(1);
  });

  it("drops sections of a class that isn't listed", () => {
    const grouped = sectionsByClass(["c6"], [{ classId: "gone", name: "A" }]);
    expect([...grouped.keys()]).toEqual(["c6"]);
    expect(classesWithoutSection(grouped)).toBe(1);
  });
});
