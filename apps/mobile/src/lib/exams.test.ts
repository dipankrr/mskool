import {
  canReview,
  partitionBySection,
  checkMarks,
  compareRoll,
  countBySegment,
  displayMarks,
  isAssignmentConstrained,
  isEntryOpen,
  isMyPaper,
  marksEqual,
  matchesSegment,
  normalizeMarks,
  sanitizeGradeText,
  sanitizeMarksText,
  sectionsForPaper,
  segmentOf,
  sortExams,
  sortRosterByRoll,
  stageMoves,
} from "./exams";

describe("lifecycle", () => {
  it("opens entry only in marks_entry and under_verification", () => {
    expect(isEntryOpen("marks_entry")).toBe(true);
    expect(isEntryOpen("under_verification")).toBe(true);
    for (const status of ["draft", "scheduled", "ongoing", "published", "locked"]) {
      expect(isEntryOpen(status)).toBe(false);
    }
  });

  it("offers one primary forward move per stage", () => {
    expect(stageMoves("draft").primary?.key).toBe("scheduled");
    expect(stageMoves("scheduled").primary?.key).toBe("ongoing");
    expect(stageMoves("ongoing").primary?.key).toBe("marks_entry");
    expect(stageMoves("marks_entry").primary?.key).toBe("under_verification");
  });

  it("keeps back moves and the lock out of the primary slot", () => {
    const scheduled = stageMoves("scheduled");
    expect(scheduled.overflow.map((m) => m.key)).toEqual(["back_to_draft"]);

    const verifying = stageMoves("under_verification");
    expect(verifying.primary).toBeNull();
    // marks_entry from verification is a BACK step with its own wording.
    expect(verifying.overflow.map((m) => m.key)).toEqual(["back_to_entry"]);

    const published = stageMoves("published");
    expect(published.primary).toBeNull();
    expect(published.overflow).toEqual([
      { target: "locked", key: "locked", destructive: true },
    ]);
  });

  it("offers nothing from locked or an unknown status", () => {
    expect(stageMoves("locked")).toEqual({ primary: null, overflow: [] });
    expect(stageMoves("???")).toEqual({ primary: null, overflow: [] });
  });

  it("groups stages into list segments", () => {
    expect(segmentOf("marks_entry")).toBe("open");
    expect(segmentOf("under_verification")).toBe("open");
    expect(segmentOf("draft")).toBe("upcoming");
    expect(segmentOf("ongoing")).toBe("upcoming");
    expect(segmentOf("published")).toBe("published");
    expect(segmentOf("locked")).toBe("published");
    expect(matchesSegment("draft", "all")).toBe(true);
    expect(matchesSegment("draft", "open")).toBe(false);
  });

  it("counts and orders exams with open ones first", () => {
    const rows = [
      { name: "Final", status: "published" },
      { name: "UT 2", status: "scheduled" },
      { name: "UT 1", status: "marks_entry" },
      { name: "Mock", status: "under_verification" },
    ];
    expect(countBySegment(rows)).toEqual({
      open: 2,
      upcoming: 1,
      published: 1,
      all: 4,
    });
    expect(sortExams(rows).map((r) => r.name)).toEqual([
      "Mock",
      "UT 1",
      "UT 2",
      "Final",
    ]);
  });
});

describe("marks text", () => {
  it("lets only a marks-shaped value through while typing", () => {
    expect(sanitizeMarksText("17")).toBe("17");
    expect(sanitizeMarksText("17,5")).toBe("17.5");
    expect(sanitizeMarksText("1a7")).toBe("17");
    expect(sanitizeMarksText("1.2.3")).toBe("1.23");
    expect(sanitizeMarksText("12.345")).toBe("12.34");
    expect(sanitizeMarksText("123456")).toBe("1234");
    expect(sanitizeMarksText("-5")).toBe("5");
  });

  it("keeps a leading minus only when negative marking is on", () => {
    expect(sanitizeMarksText("-5", true)).toBe("-5");
    expect(sanitizeMarksText("5-", true)).toBe("5");
  });

  it("normalizes to the canonical wire form", () => {
    expect(normalizeMarks("05")).toBe("5");
    expect(normalizeMarks("5.")).toBe("5");
    expect(normalizeMarks("17.50")).toBe("17.5");
    expect(normalizeMarks("17.05")).toBe("17.05");
    expect(normalizeMarks(".5")).toBe("0.5");
    expect(normalizeMarks("-0.50")).toBe("-0.5");
  });

  it("displays server decimals without trailing zeros", () => {
    expect(displayMarks("17.00")).toBe("17");
    expect(displayMarks("17.50")).toBe("17.5");
    expect(displayMarks(null)).toBe("");
    expect(displayMarks(undefined)).toBe("");
    expect(marksEqual("17.00", "17")).toBe(true);
    expect(marksEqual("17.5", "17.50")).toBe(true);
    expect(marksEqual("17", null)).toBe(false);
  });

  it("accepts blank as an empty draft", () => {
    expect(checkMarks("", { max: 20, allowNegative: false })).toEqual({
      ok: true,
      value: null,
    });
    expect(checkMarks("  ", { max: 20, allowNegative: false })).toEqual({
      ok: true,
      value: null,
    });
  });

  it("accepts a value up to and including the max, as hundredths", () => {
    const rule = { max: 20, allowNegative: false };
    expect(checkMarks("20", rule)).toEqual({ ok: true, value: "20" });
    expect(checkMarks("20.00", rule)).toEqual({ ok: true, value: "20" });
    expect(checkMarks("19.99", rule)).toEqual({ ok: true, value: "19.99" });
    expect(checkMarks("20.01", rule)).toEqual({ ok: false, reason: "range" });
    expect(checkMarks("22", rule)).toEqual({ ok: false, reason: "range" });
  });

  it("handles fractional maxima without float drift", () => {
    const rule = { max: 12.5, allowNegative: false };
    expect(checkMarks("12.5", rule)).toEqual({ ok: true, value: "12.5" });
    expect(checkMarks("12.51", rule)).toEqual({ ok: false, reason: "range" });
  });

  it("refuses unfinished and negative values", () => {
    const rule = { max: 20, allowNegative: false };
    expect(checkMarks(".", rule)).toEqual({ ok: false, reason: "format" });
    expect(checkMarks("-", rule)).toEqual({ ok: false, reason: "format" });
    expect(checkMarks("-1", rule)).toEqual({ ok: false, reason: "negative" });
    expect(checkMarks("-1", { max: 20, allowNegative: true })).toEqual({
      ok: true,
      value: "-1",
    });
    expect(checkMarks("5.", rule)).toEqual({ ok: true, value: "5" });
  });

  it("upper-cases and caps grades", () => {
    expect(sanitizeGradeText("a+")).toBe("A+");
    expect(sanitizeGradeText("abcdefghijklm")).toBe("ABCDEFGHIJ");
  });
});

describe("roster order", () => {
  const person = (rollNumber: string | null, firstName: string) => ({
    rollNumber,
    firstName,
    lastName: "X",
  });

  it("sorts numeric rolls numerically, not as strings", () => {
    const sorted = sortRosterByRoll([
      person("10", "J"),
      person("2", "B"),
      person("1", "A"),
    ]);
    expect(sorted.map((p) => p.rollNumber)).toEqual(["1", "2", "10"]);
  });

  it("puts no-roll students last and breaks ties by name", () => {
    const sorted = sortRosterByRoll([
      person(null, "Zed"),
      person("3", "Cee"),
      person(null, "Amy"),
    ]);
    expect(sorted.map((p) => p.firstName)).toEqual(["Cee", "Amy", "Zed"]);
  });

  it("sorts numbers before non-numeric rolls", () => {
    expect(compareRoll(person("5", "A"), person("A1", "B"))).toBeLessThan(0);
  });
});

describe("papers and teaching pairs", () => {
  const sectionPaper = { classId: "c7", sectionId: "s7a", subjectId: "maths" };
  const classPaper = { classId: "c7", sectionId: null, subjectId: "maths" };
  const pairs = [{ sectionId: "s7a", classId: "c7", subjectId: "maths" }];

  it("matches a section paper on that exact section and subject", () => {
    expect(isMyPaper(sectionPaper, pairs)).toBe(true);
    expect(isMyPaper({ ...sectionPaper, sectionId: "s7b" }, pairs)).toBe(false);
    expect(isMyPaper({ ...sectionPaper, subjectId: "sci" }, pairs)).toBe(false);
  });

  it("matches a class-wide paper on any section of the class", () => {
    expect(isMyPaper(classPaper, pairs)).toBe(true);
    expect(isMyPaper({ ...classPaper, classId: "c8" }, pairs)).toBe(false);
  });

  it("offers a class-wide paper only the sections the caller teaches", () => {
    const sections = [
      { id: "s7a", classId: "c7" },
      { id: "s7b", classId: "c7" },
      { id: "s8a", classId: "c8" },
    ];
    expect(sectionsForPaper(classPaper, sections, pairs).map((s) => s.id)).toEqual([
      "s7a",
    ]);
    // Unrestricted callers (scope roles) see the whole class.
    expect(sectionsForPaper(classPaper, sections, null).map((s) => s.id)).toEqual([
      "s7a",
      "s7b",
    ]);
    // A section paper is fixed to its section.
    expect(sectionsForPaper(sectionPaper, sections, null).map((s) => s.id)).toEqual([
      "s7a",
    ]);
  });

  it("constrains only a pure subject teacher", () => {
    expect(isAssignmentConstrained(["subject_teacher"])).toBe(true);
    expect(isAssignmentConstrained(["subject_teacher", "class_teacher"])).toBe(false);
    expect(isAssignmentConstrained(["principal"])).toBe(false);
    expect(isAssignmentConstrained([])).toBe(false);
  });

  it("lifts the constraint for any other role, custom ones included", () => {
    expect(isAssignmentConstrained(["head_of_department"])).toBe(false);
    expect(isAssignmentConstrained(["subject_teacher", "head_of_department"])).toBe(false);
  });
});

describe("review helpers", () => {
  it("offers Review only to verifiers while entry is open", () => {
    expect(canReview("under_verification", true)).toBe(true);
    expect(canReview("marks_entry", true)).toBe(true);
    expect(canReview("under_verification", false)).toBe(false);
    for (const status of ["draft", "scheduled", "ongoing", "published", "locked"]) {
      expect(canReview(status, true)).toBe(false);
    }
  });

  it("partitions a class-wide roster by the section being verified", () => {
    const students = [{ studentId: "a" }, { studentId: "b" }, { studentId: "c" }, { studentId: "d" }];
    const bySection = new Map<string, string | null>([
      ["a", "s-a"],
      ["b", "s-b"],
      ["c", null], // no section yet
    ]); // "d" is unknown to the enrollment read
    const result = partitionBySection(students, bySection, "s-a");
    expect(result.inScope.map((s) => s.studentId)).toEqual(["a", "c"]);
    expect(result.outOfScope.map((s) => s.studentId)).toEqual(["b", "d"]);
    expect(result.sectionless).toBe(1);
  });
});
