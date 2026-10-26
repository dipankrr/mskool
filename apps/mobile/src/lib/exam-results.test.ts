import {
  asSnapshot,
  checkCorrection,
  displayPercent,
  entriesForSubject,
  isCorrectableEntry,
  isGradeOnlyRow,
  matchesResultFilter,
  publicationState,
  rankLine,
  resultRows,
  resultVerdict,
  versionChanges,
} from "./exam-results";
import type { ClassResults, StudentEntry } from "./exam-results";

function table(overrides?: Partial<ClassResults>): ClassResults {
  return {
    examStatus: "under_verification",
    roster: [
      {
        studentId: "s1",
        rollNumber: "1",
        admissionNumber: "A1",
        firstName: "Aarav",
        lastName: "Mehta",
      },
      {
        studentId: "s2",
        rollNumber: "2",
        admissionNumber: "A2",
        firstName: "Bhavya",
        lastName: "Rao",
      },
      {
        studentId: "s3",
        rollNumber: "3",
        admissionNumber: "A3",
        firstName: "Chirag",
        lastName: "Das",
      },
      {
        studentId: "s4",
        rollNumber: null,
        admissionNumber: "A4",
        firstName: "Divya",
        lastName: "Nair",
      },
      {
        studentId: "s5",
        rollNumber: "5",
        admissionNumber: "A5",
        firstName: "Esha",
        lastName: "Iyer",
      },
    ],
    subjects: [{ id: "sub1", name: "Mathematics" }],
    subjectResults: [
      {
        studentId: "s4",
        subjectId: "sub1",
        finalMarks: null,
        maxMarks: "80.00",
        graceMarksApplied: "0.00",
        isPassed: false,
        isAbsent: true,
        isExempted: false,
        grade: null,
        countsTowardResult: true,
        isGradedOnly: false,
        resultStatus: "provisional",
      },
    ],
    termResults: [
      termOf("s1", { isPassed: true, percentage: "82.40" }),
      termOf("s2", { isPassed: true, percentage: "59.20", subjectsFailedCount: 2 }),
      termOf("s3", { isPassed: false, percentage: "31.00" }),
      termOf("s4", { isPassed: false, percentage: "0.00", grade: null, totalMarks: null }),
    ],
    stats: [],
    classAverage: "55.10",
    ...overrides,
  };
}

function termOf(
  studentId: string,
  overrides?: Partial<ClassResults["termResults"][number]>,
): ClassResults["termResults"][number] {
  return {
    studentId,
    totalMarks: "300.00",
    maxMarks: "500.00",
    percentage: "60.00",
    grade: "C",
    isPassed: true,
    subjectsFailedCount: 0,
    rankInSection: null,
    rankInClass: null,
    resultStatus: "provisional",
    publishedAt: null,
    ...overrides,
  };
}

function entry(overrides?: Partial<StudentEntry>): StudentEntry {
  return {
    id: "r1",
    scheduleId: "sch1",
    componentId: "c1",
    component: "Theory",
    subjectId: "sub1",
    maxMarks: "80.00",
    resultStatus: "published",
    marksObtained: "62.00",
    gradeObtained: null,
    isAbsent: false,
    isExempted: false,
    ...overrides,
  };
}

describe("resultRows", () => {
  it("joins every rostered student with their term result and subjects", () => {
    const rows = resultRows(table());
    expect(rows).toHaveLength(5);
    expect(rows[0]?.term?.percentage).toBe("82.40");
    expect(rows[3]?.anyAbsent).toBe(true);
    expect(rows[4]?.term).toBeNull();
    expect(rows[4]?.anyAbsent).toBe(false);
  });
});

describe("matchesResultFilter", () => {
  const rows = resultRows(table());

  it("partitions failed, attention and absent without overlap", () => {
    expect(rows.filter((row) => matchesResultFilter(row, "failed")).map((r) => r.student.studentId)).toEqual(["s3"]);
    expect(rows.filter((row) => matchesResultFilter(row, "attention")).map((r) => r.student.studentId)).toEqual(["s2"]);
    expect(rows.filter((row) => matchesResultFilter(row, "absent")).map((r) => r.student.studentId)).toEqual(["s4"]);
    expect(rows.filter((row) => matchesResultFilter(row, "all"))).toHaveLength(5);
  });

  it("shows uncomputed students only under All", () => {
    expect(matchesResultFilter(rows[4]!, "failed")).toBe(false);
    expect(matchesResultFilter(rows[4]!, "attention")).toBe(false);
  });
});

describe("display helpers", () => {
  it("trims trailing zeros off percentages", () => {
    expect(displayPercent("82.40")).toBe("82.4");
    expect(displayPercent("60.00")).toBe("60");
    expect(displayPercent("59.25")).toBe("59.25");
    expect(displayPercent(null)).toBe("—");
    expect(displayPercent("")).toBe("—");
  });

  it("reads the row's verdict with absent winning", () => {
    const rows = resultRows(table());
    expect(resultVerdict(rows[0]!)).toBe("pass");
    expect(resultVerdict(rows[2]!)).toBe("fail");
    expect(resultVerdict(rows[3]!)).toBe("absent");
    expect(resultVerdict(rows[4]!)).toBe("none");
    expect(rankLine(rows[0]!.term)).toBeNull();
    expect(rankLine(rows[4]!.term)).toBeNull();
    const ranked = termOf("s1", { rankInSection: 3, rankInClass: 12 });
    expect(rankLine(ranked)).toEqual({ section: 3, class: 12 });
  });

  it("flags the GPA branch from a percentage-less, graded row", () => {
    const gpa = resultRows(table())[0]!;
    expect(isGradeOnlyRow(gpa)).toBe(false);
    const graded = resultRows(
      table({
        termResults: [termOf("s1", { percentage: null, grade: "A", totalMarks: null })],
      }),
    )[0]!;
    expect(isGradeOnlyRow(graded)).toBe(true);
  });
});

describe("publicationState", () => {
  it("maps the three states and refuses the rest", () => {
    const row = {
      classId: "c1",
      state: "published",
      publishedAt: "2026-10-27T00:00:00.000Z",
      revisionOpenedAt: null,
      reIssuedAt: null,
    };
    expect(publicationState(row)).toBe("published");
    expect(publicationState({ ...row, state: "revision_open" })).toBe("revision_open");
    expect(publicationState({ ...row, state: "re_issued" })).toBe("re_issued");
    expect(publicationState({ ...row, state: "weird" })).toBeNull();
    expect(publicationState(undefined)).toBeNull();
  });
});

describe("asSnapshot", () => {
  const good = {
    snapshotVersion: 1,
    student: { name: "Bhavya Rao", admissionNumber: "A2", className: "Class 6", sectionName: "B", rollNumber: "2" },
    school: { name: "Demo Trust" },
    academicYear: { name: "2026-27" },
    term: null,
    subjects: [{ subjectName: "Mathematics", marksObtained: "62.00" }],
    totals: { totalMarks: "300.00" },
    attendance: null,
    termAssessments: [],
    generatedAt: "2026-10-27T00:00:00Z",
  };

  it("accepts a card the renderer can draw and refuses anything else", () => {
    expect(asSnapshot(good)).not.toBeNull();
    expect(asSnapshot(null)).toBeNull();
    expect(asSnapshot("v2")).toBeNull();
    expect(asSnapshot({ ...good, subjects: "all" })).toBeNull();
    expect(asSnapshot({ ...good, student: {} })).toBeNull();
    expect(asSnapshot({ ...good, totals: null })).toBeNull();
  });
});

describe("versionChanges", () => {
  const v1 = asSnapshot({
    ...base(),
    subjects: [subject("Mathematics", "62.00"), subject("Physics", "48.00", true)],
    totals: { ...base().totals, totalMarks: "296.00", rankInClass: 12 },
  });
  const v2 = asSnapshot({
    ...base(),
    subjects: [subject("Mathematics", "65.00"), subject("Physics", "48.00", true)],
    totals: { ...base().totals, totalMarks: "299.00", rankInClass: 10 },
  });

  it("lists totals and subject moves, oldest wording first, bounded", () => {
    const changes = versionChanges(v1, v2);
    expect(changes[0]).toBe("Total 296.00 → 299.00");
    expect(changes[1]).toBe("Rank in class 12 → 10");
    expect(changes[2]).toBe("Mathematics 62.00 → 65.00");
    expect(changes).toHaveLength(3);
  });

  it("prints an absent flip as AB and survives a null side", () => {
    const v3 = asSnapshot({
      ...base(),
      subjects: [subject("Mathematics", null, true)],
      totals: base().totals,
    });
    const changes = versionChanges(v2, v3);
    expect(changes).toContain("Mathematics 65.00 → AB");
    expect(versionChanges(v1, null)).toEqual([]);
  });
});

function base() {
  return {
    snapshotVersion: 1,
    student: { name: "Bhavya Rao", admissionNumber: "A2", className: "Class 6", sectionName: "B", rollNumber: "2" },
    school: { name: "Demo Trust" },
    academicYear: { name: "2026-27" },
    term: null,
    subjects: [] as ReturnType<typeof subject>[],
    totals: { totalMarks: "296.00", maxMarks: null, percentage: null, grade: "C", gradePoint: null, isPassed: true, rankInSection: null, rankInClass: 12 },
    attendance: null,
    termAssessments: [],
    generatedAt: "2026-10-27T00:00:00Z",
  };
}

function subject(name: string, marks: string | null, absent = false) {
  return {
    subjectId: "sub1",
    subjectName: name,
    subjectTypeId: null,
    widgetName: null,
    widgetSequence: null,
    marksObtained: marks,
    maxMarks: "80.00",
    grade: null,
    gradePoint: null,
    isAbsent: absent,
    isExempted: false,
    countsTowardResult: true,
  };
}

describe("checkCorrection", () => {
  it("demands a type and a real reason", () => {
    expect(checkCorrection({ max: 80, gradedOnly: false, text: "65", revisionType: null, reason: "Rechecked script" })).toEqual({
      ok: false,
      reason: "type",
    });
    expect(
      checkCorrection({ max: 80, gradedOnly: false, text: "65", revisionType: "marks_correction", reason: "no" }),
    ).toEqual({ ok: false, reason: "reason" });
  });

  it("passes the value through the marks checks and clears on blank", () => {
    expect(
      checkCorrection({ max: 80, gradedOnly: false, text: "65", revisionType: "marks_correction", reason: "Rechecked script" }),
    ).toEqual({ ok: true, revisedMarks: "65", revisedGrade: null });
    expect(
      checkCorrection({ max: 80, gradedOnly: false, text: "", revisionType: "data_entry_error", reason: "Wrong cell" }),
    ).toEqual({ ok: true, revisedMarks: null, revisedGrade: null });
    expect(
      checkCorrection({ max: 80, gradedOnly: false, text: "81", revisionType: "marks_correction", reason: "Rechecked script" }),
    ).toEqual({ ok: false, reason: "range" });
    expect(
      checkCorrection({ max: 80, gradedOnly: false, text: "sixty", revisionType: "marks_correction", reason: "Rechecked script" }),
    ).toEqual({ ok: false, reason: "format" });
  });

  it("routes graded-only subjects to the grade field, uppercased and bounded", () => {
    expect(
      checkCorrection({ max: 0, gradedOnly: true, text: "a+", revisionType: "re_evaluation", reason: "Board ruled" }),
    ).toEqual({ ok: true, revisedMarks: null, revisedGrade: "A+" });
  });
});

describe("entries helpers", () => {
  it("filters by subject and only corrects published rows", () => {
    const rows = [entry(), entry({ id: "r2", resultStatus: "entered" }), entry({ id: "r3", subjectId: "sub2" })];
    expect(entriesForSubject(rows, "sub1")).toHaveLength(2);
    expect(isCorrectableEntry(rows[0]!)).toBe(true);
    expect(isCorrectableEntry(rows[1]!)).toBe(false);
  });
});
