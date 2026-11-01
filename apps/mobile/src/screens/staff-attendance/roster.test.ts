import { buildRoster } from "./roster";
import type { EnrollmentPair } from "./roster";

function pair(
  id: string,
  first: string,
  last: string | null,
  roll: string | null,
  sectionId = "sec-1",
  middle: string | null = null,
): EnrollmentPair {
  return {
    enrollment: { sectionId, rollNumber: roll },
    student: { id, firstName: first, middleName: middle, lastName: last },
  };
}

describe("buildRoster on a date", () => {
  const withStatus = (id: string, enrollmentStatus: string, leftOn: string | null) => ({
    enrollment: { sectionId: "sec-1", rollNumber: null, enrollmentStatus, leftOn },
    student: { id, firstName: id, middleName: null, lastName: null },
  });

  it("drops a student from the day they left, and keeps them before it", () => {
    const rows = [withStatus("stay", "studying", null), withStatus("gone", "withdrawn", "2026-10-15")];
    const ids = (date: string) => buildRoster(rows, "sec-1", date).map((entry) => entry.studentId);
    expect(ids("2026-10-14")).toEqual(["gone", "stay"]);
    expect(ids("2026-10-15")).toEqual(["stay"]);
    expect(ids("2026-10-16")).toEqual(["stay"]);
  });

  it("drops a departure with no recorded date", () => {
    expect(buildRoster([withStatus("gone", "withdrawn", null)], "sec-1", "2026-10-14")).toEqual([]);
  });

  it("lists everyone when no date is given", () => {
    expect(buildRoster([withStatus("gone", "withdrawn", "2026-10-15")], "sec-1")).toHaveLength(1);
  });
});

describe("buildRoster", () => {
  it("keeps numeric roll order (2 before 10), un-numbered last by name", () => {
    const roster = buildRoster(
      [
        pair("c", "Chetan", "Rao", null),
        pair("a", "Aarav", "Sharma", "10"),
        pair("b", "Bina", "Iyer", "2"),
        pair("d", "Deepa", "Nair", null),
      ],
      "sec-1",
    );
    expect(roster.map((row) => row.studentId)).toEqual(["b", "a", "c", "d"]);
  });

  it("filters rows from other sections and joins the full name", () => {
    const roster = buildRoster(
      [
        pair("a", "Aarav", "Sharma", "1", "sec-2"),
        pair("b", "Bina", "Iyer", "2", "sec-1", "M"),
      ],
      "sec-1",
    );
    expect(roster).toEqual([
      { studentId: "b", name: "Bina M Iyer", roll: "2" },
    ]);
  });

  it("renders an em-dash-free name when parts are missing", () => {
    const roster = buildRoster([pair("a", "Aarav", null, "1")], "sec-1");
    expect(roster[0]?.name).toBe("Aarav");
  });

  it("is empty for an empty section", () => {
    expect(buildRoster([], "sec-1")).toEqual([]);
  });
});
