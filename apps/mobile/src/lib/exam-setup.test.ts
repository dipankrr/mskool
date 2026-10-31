import {
  checkComponents,
  collapsibleSubject,
  createExamPayload,
  editFrozenFields,
  effectiveCountsTowardTerm,
  mergeToClassWide,
  newPaper,
  paperAddChoices,
  paperKey,
  paperSubjects,
  prefillExamDate,
  requiresLinkedExam,
  samePaper,
  schedulePartitionViolations,
  sectionLens,
  splitClassWide,
  subjectOrder,
  subjectShape,
  weightHeadroom,
  weightSum,
} from "./exam-setup";
import type {
  ComponentDraft,
  MappingRow,
  PaperDraft,
  PartCopy,
  SubjectTypeRow,
  WeightContribution,
} from "./exam-setup";

function type(args?: Partial<SubjectTypeRow>): SubjectTypeRow {
  return {
    id: "t1",
    name: "Main Subjects",
    countsTowardResult: true,
    isGradedOnly: false,
    assessmentMode: "exam",
    sequence: 1,
    isDefault: false,
    isActive: true,
    hasAssessmentData: false,
    organizationId: "o1",
    schoolId: "sc1",
    createdAt: "2026-10-27T00:00:00.000Z",
    updatedAt: "2026-10-27T00:00:00.000Z",
    createdBy: null,
    ...args,
  };
}

function mapping(args?: Partial<MappingRow>): MappingRow {
  return {
    id: "m1",
    academicYearId: "y1",
    classId: "c1",
    subjectId: "s1",
    subjectTypeId: "t1",
    isElective: false,
    sequenceNumber: 1,
    createdAt: "2026-10-27T00:00:00.000Z",
    updatedAt: "2026-10-27T00:00:00.000Z",
    organizationId: "o1",
    schoolId: "sc1",
    createdBy: null,
    ...args,
  };
}

describe("paperSubjects", () => {
  const typeById = new Map([
    ["t1", type()],
    ["t2", type({ id: "t2", countsTowardResult: false, name: "Activities" })],
    ["t3", type({ id: "t3", assessmentMode: "term_grade", name: "Areas" })],
  ]);

  it("keeps counted exam-mode subjects without an existing paper", () => {
    const rows = paperSubjects({
      mappings: [mapping(), mapping({ id: "m2", subjectId: "s2" })],
      typeById,
      existingSubjectIds: new Set(["s2"]),
    });
    expect(rows.map((row) => row.subjectId)).toEqual(["s1"]);
  });

  it("drops uncounted and term-grade mappings", () => {
    const rows = paperSubjects({
      mappings: [
        mapping({ id: "m2", subjectTypeId: "t2" }),
        mapping({ id: "m3", subjectTypeId: "t3" }),
        mapping({ id: "m4", subjectTypeId: null }),
      ],
      typeById,
      existingSubjectIds: new Set(),
    });
    expect(rows).toEqual([]);
  });
});

describe("prefillExamDate", () => {
  it("starts tomorrow and skips Sundays", () => {
    // Wednesday 2026-10-28 is a Wednesday; the 28th+1... use fixed dates.
    const from = new Date(2026, 9, 30); // Friday 30 Oct 2026
    expect(prefillExamDate(0, from)).toBe("2026-10-31"); // Saturday
    expect(prefillExamDate(1, from)).toBe("2026-11-02"); // skips Sunday 1 Nov
    expect(prefillExamDate(2, from)).toBe("2026-11-03");
  });
});

describe("newPaper", () => {
  it("prefills a valid row with the web's defaults", () => {
    const paper = newPaper({ classId: "c1", subjectId: "s1", index: 0 });
    expect(paper.sectionId).toBeNull();
    expect(paper.startTime).toBe("09:30");
    expect(paper.durationMinutes).toBe(180);
    expect(paper.passMarks).toBeUndefined();
    expect(paper.examDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("weightSum and checkComponents", () => {
  const part = (args?: Partial<ComponentDraft>): ComponentDraft => ({
    name: "Theory",
    maxMarks: "100",
    passMarks: "33",
    weightagePercentage: "100",
    isMandatoryPass: true,
    ...args,
  });

  it("sums the weight column", () => {
    expect(weightSum([part(), part({ weightagePercentage: "40" })])).toBe(140);
    expect(weightSum([part({ weightagePercentage: "60" }), part({ weightagePercentage: "40" })])).toBe(100);
  });

  it("catches pass over max, bad numbers and empty names with the row", () => {
    expect(checkComponents([part()])).toEqual({ ok: true });
    expect(checkComponents([part({ passMarks: "101" })])).toEqual({
      ok: false,
      row: 0,
      reason: "passOverMax",
    });
    expect(checkComponents([part({ maxMarks: "abc" })])).toEqual({
      ok: false,
      row: 0,
      reason: "format",
    });
    expect(checkComponents([part({ name: "  " })])).toEqual({
      ok: false,
      row: 0,
      reason: "emptyName",
    });
    expect(checkComponents([part(), part({ passMarks: "50", maxMarks: "40" })])).toEqual({
      ok: false,
      row: 1,
      reason: "passOverMax",
    });
  });
});

describe("the form's frozen fields", () => {
  it("freezes weight, counting and negative marking from marks entry on", () => {
    expect(editFrozenFields({ status: "draft" })).toEqual({
      weightage: false,
      countsTowardTerm: false,
      negativeMarking: false,
    });
    expect(editFrozenFields({ status: "scheduled" })).toEqual({
      weightage: false,
      countsTowardTerm: false,
      negativeMarking: false,
    });
    expect(editFrozenFields({ status: "marks_entry" })).toEqual({
      weightage: true,
      countsTowardTerm: true,
      negativeMarking: true,
    });
    expect(editFrozenFields({ status: "published" })).toEqual({
      weightage: true,
      countsTowardTerm: true,
      negativeMarking: true,
    });
  });

  it("forces mocks and tests out of the term aggregate", () => {
    expect(effectiveCountsTowardTerm("mock", true)).toBe(false);
    expect(effectiveCountsTowardTerm("test", true)).toBe(false);
    expect(effectiveCountsTowardTerm("regular", true)).toBe(true);
    expect(effectiveCountsTowardTerm("regular", false)).toBe(false);
  });

  it("demands a linked exam only for supplementary and improvement", () => {
    expect(requiresLinkedExam("regular")).toBe(false);
    expect(requiresLinkedExam("supplementary")).toBe(true);
    expect(requiresLinkedExam("improvement")).toBe(true);
  });

  it("builds the create payload without a weight when blank", () => {
    expect(
      createExamPayload({
        name: " Unit Test 4 ",
        termId: "t1",
        examType: "mock",
        weightageInTerm: "",
        countsTowardTermResult: true,
        allowsNegativeMarking: false,
        linkedExamId: null,
      }),
    ).toEqual({
      name: "Unit Test 4",
      termId: "t1",
      examType: "mock",
      countsTowardTermResult: false,
      allowsNegativeMarking: false,
    });
    expect(
      createExamPayload({
        name: "Term 1 Examination",
        termId: "t1",
        examType: "supplementary",
        weightageInTerm: "20",
        countsTowardTermResult: true,
        allowsNegativeMarking: true,
        linkedExamId: "e9",
      }),
    ).toEqual({
      name: "Term 1 Examination",
      termId: "t1",
      examType: "supplementary",
      weightageInTerm: "20",
      countsTowardTermResult: true,
      allowsNegativeMarking: true,
      linkedExamId: "e9",
    });
  });
});

describe("weightHeadroom", () => {
  const exam = (args?: Partial<WeightContribution>): WeightContribution => ({
    id: "e1",
    termId: "term-1",
    countsTowardTermResult: true,
    weightageInTerm: "50.00",
    ...args,
  });

  it("gives the full term when nothing counts in it yet", () => {
    expect(weightHeadroom([], "term-1")).toBe(100);
    expect(
      weightHeadroom([exam({ countsTowardTermResult: false })], "term-1"),
    ).toBe(100);
  });

  it("subtracts the term's counting exams", () => {
    expect(
      weightHeadroom(
        [exam({ weightageInTerm: "50.00" }), exam({ id: "e2", weightageInTerm: "30.00" })],
        "term-1",
      ),
    ).toBe(20);
  });

  it("ignores exams of other terms and non-counting exams", () => {
    expect(
      weightHeadroom(
        [
          exam({ termId: "term-2", weightageInTerm: "100.00" }),
          exam({ countsTowardTermResult: false, weightageInTerm: "100.00" }),
        ],
        "term-1",
      ),
    ).toBe(100);
  });

  it("a full term leaves zero headroom", () => {
    expect(weightHeadroom([exam({ weightageInTerm: "100.00" })], "term-1")).toBe(0);
    expect(
      weightHeadroom(
        [exam({ weightageInTerm: "60.00" }), exam({ id: "e2", weightageInTerm: "70.00" })],
        "term-1",
      ),
    ).toBe(0);
  });

  it("the exam being edited does not consume its own weight", () => {
    expect(
      weightHeadroom([exam({ weightageInTerm: "50.00" })], "term-1", "e1"),
    ).toBe(100);
    expect(
      weightHeadroom(
        [exam({ weightageInTerm: "50.00" }), exam({ id: "e2", weightageInTerm: "30.00" })],
        "term-1",
        "e1",
      ),
    ).toBe(70);
  });

  it("no term picked yet is the full term", () => {
    expect(weightHeadroom([exam({ weightageInTerm: "100.00" })], null)).toBe(100);
  });
});

describe("paperKey", () => {
  it("separates a class-wide paper from every section paper", () => {
    expect(paperKey("s1", null)).toBe("s1|*");
    expect(paperKey("s1", "secA")).toBe("s1|secA");
    expect(paperKey("s1", "secA")).not.toBe(paperKey("s1", "secB"));
  });
});

describe("schedulePartitionViolations", () => {
  it("accepts one class-wide paper", () => {
    expect(schedulePartitionViolations([{ subjectId: "s1", sectionId: null }])).toEqual([]);
  });

  it("accepts a partial set of section papers", () => {
    expect(
      schedulePartitionViolations([
        { subjectId: "s1", sectionId: "secA" },
        { subjectId: "s1", sectionId: "secC" },
      ]),
    ).toEqual([]);
  });

  it("refuses a section paper under a subject that also has a class-wide paper", () => {
    const violations = schedulePartitionViolations([
      { subjectId: "s1", sectionId: null },
      { subjectId: "s1", sectionId: "secA" },
    ]);
    expect(violations).toEqual([{ subjectId: "s1", sectionId: "secA" }]);
  });

  it("refuses the same section twice for one subject", () => {
    const violations = schedulePartitionViolations([
      { subjectId: "s1", sectionId: "secA" },
      { subjectId: "s1", sectionId: "secA" },
    ]);
    expect(violations).toEqual([{ subjectId: "s1", sectionId: "secA" }]);
  });

  it("judges subjects independently", () => {
    expect(
      schedulePartitionViolations([
        { subjectId: "s1", sectionId: null },
        { subjectId: "s2", sectionId: "secA" },
      ]),
    ).toEqual([]);
  });
});

describe("paperAddChoices", () => {
  it("offers everything for a subject with no papers", () => {
    const choices = paperAddChoices([]);
    expect(choices.canAddClassWide).toBe(true);
    expect(choices.canAddSections).toBe(true);
    expect(choices.takenSections.size).toBe(0);
  });

  it("a class-wide paper blocks both further shapes", () => {
    const choices = paperAddChoices([{ subjectId: "s1", sectionId: null }]);
    expect(choices.canAddClassWide).toBe(false);
    expect(choices.canAddSections).toBe(false);
  });

  it("section papers leave the untaken sections open", () => {
    const choices = paperAddChoices([
      { subjectId: "s1", sectionId: "secA" },
      { subjectId: "s1", sectionId: "secB" },
    ]);
    expect(choices.canAddClassWide).toBe(false);
    expect(choices.canAddSections).toBe(true);
    expect(choices.takenSections.has("secA")).toBe(true);
    expect(choices.takenSections.has("secC")).toBe(false);
  });
});

function draft(args: Partial<PaperDraft> = {}): PaperDraft {
  return {
    subjectId: "s1",
    sectionId: null,
    examDate: "2026-11-02",
    startTime: "09:30",
    durationMinutes: 180,
    venue: "",
    passMarks: null,
    isNew: false,
    partsFrom: null,
    ...args,
  };
}

const THEORY_80: PartCopy[] = [
  {
    name: "Theory",
    maxMarks: "80",
    passMarks: "26",
    weightagePercentage: "80",
    isMandatoryPass: true,
    sequenceNumber: 0,
  },
  {
    name: "Internal",
    maxMarks: "20",
    passMarks: "7",
    weightagePercentage: "20",
    isMandatoryPass: false,
    sequenceNumber: 1,
  },
];
const none = () => null;

describe("splitClassWide", () => {
  it("turns the class-wide row into one copy per section, in place", () => {
    const rows = [
      draft({ subjectId: "s0" }),
      draft({ subjectId: "s1", examDate: "2026-11-05" }),
      draft({ subjectId: "s2" }),
    ];
    const next = splitClassWide(rows, "s1", ["secA", "secB"], THEORY_80);
    expect(next.map((r) => [r.subjectId, r.sectionId])).toEqual([
      ["s0", null],
      ["s1", "secA"],
      ["s1", "secB"],
      ["s2", null],
    ]);
    expect(next[1]!.examDate).toBe("2026-11-05");
    expect(next[1]!.isNew).toBe(true);
    expect(next[2]!.partsFrom).toBe(THEORY_80);
  });

  it("leaves a subject that is already sectioned alone", () => {
    const rows = [draft({ sectionId: "secA" })];
    expect(splitClassWide(rows, "s1", ["secA", "secB"], null)).toEqual(rows);
  });

  it("is a no-op for a class with no sections", () => {
    const rows = [draft()];
    expect(splitClassWide(rows, "s1", [], null)).toEqual(rows);
  });
});

describe("mergeToClassWide", () => {
  it("keeps the chosen section's settings as the class-wide row", () => {
    const rows = [
      draft({ sectionId: "secA", examDate: "2026-11-02" }),
      draft({ sectionId: "secB", examDate: "2026-11-03" }),
      draft({ subjectId: "s2" }),
    ];
    const next = mergeToClassWide(rows, "s1", "secB", () => THEORY_80);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({
      subjectId: "s1",
      sectionId: null,
      examDate: "2026-11-03",
      isNew: true,
      partsFrom: THEORY_80,
    });
    expect(next[1]!.subjectId).toBe("s2");
  });

  it("does nothing when the section to keep is missing", () => {
    const rows = [draft({ sectionId: "secA" })];
    expect(mergeToClassWide(rows, "s1", "secZ", none)).toEqual(rows);
  });
});

describe("samePaper and collapsibleSubject", () => {
  const sections = ["secA", "secB"];

  it("two identical section papers over every section collapse", () => {
    const rows = [draft({ sectionId: "secA" }), draft({ sectionId: "secB" })];
    expect(collapsibleSubject(rows, "s1", sections, none)).toBe("secA");
  });

  it("a different date, time, duration, venue or pass mark keeps them apart", () => {
    for (const patch of [
      { examDate: "2026-11-03" },
      { startTime: "14:00" },
      { durationMinutes: 120 },
      { venue: "Hall 2" },
      { passMarks: "30" },
    ]) {
      const rows = [
        draft({ sectionId: "secA" }),
        draft({ sectionId: "secB", ...patch }),
      ];
      expect(collapsibleSubject(rows, "s1", sections, none)).toBeNull();
    }
  });

  it("different parts keep them apart; the default part equals null", () => {
    const a = draft({ sectionId: "secA" });
    const b = draft({ sectionId: "secB" });
    const parts = (row: PaperDraft) => (row === b ? THEORY_80 : null);
    expect(collapsibleSubject([a, b], "s1", sections, parts)).toBeNull();
    expect(samePaper(a, b, none)).toBe(true);
  });

  it("a subset of the sections is a deliberate shape, never collapsed", () => {
    const rows = [draft({ sectionId: "secA" })];
    expect(collapsibleSubject(rows, "s1", sections, none)).toBeNull();
  });

  it("a one-section class never collapses", () => {
    const rows = [draft({ sectionId: "secA" })];
    expect(collapsibleSubject(rows, "s1", ["secA"], none)).toBeNull();
  });

  it("a class-wide row is already collapsed", () => {
    expect(collapsibleSubject([draft()], "s1", sections, none)).toBeNull();
  });
});

describe("sectionLens", () => {
  const rows = [
    draft({ subjectId: "math", sectionId: "secA" }),
    draft({ subjectId: "phy" }),
    draft({ subjectId: "hin", sectionId: "secA" }),
    draft({ subjectId: "hin", sectionId: "secB" }),
  ];

  it("a class-wide paper is inherited by every section", () => {
    expect(sectionLens(rows, "phy", "secB").state).toBe("inherited");
  });

  it("a section's own paper is its own", () => {
    const lens = sectionLens(rows, "math", "secA");
    expect(lens.state).toBe("own");
    expect(lens.row).toBe(rows[0]);
  });

  it("a sectioned subject with no row for the section is not sat", () => {
    const lens = sectionLens(rows, "math", "secB");
    expect(lens.state).toBe("notSat");
    expect(lens.row).toBeNull();
  });
});

describe("subjectShape and subjectOrder", () => {
  it("labels the three shapes", () => {
    expect(subjectShape([draft()], ["secA", "secB"])).toEqual({ kind: "classWide" });
    expect(subjectShape([draft({ sectionId: "secA" })], ["secA", "secB"])).toEqual({
      kind: "subset",
      sectionIds: ["secA"],
    });
    expect(
      subjectShape(
        [draft({ sectionId: "secA" }), draft({ sectionId: "secB" })],
        ["secA", "secB"],
      ),
    ).toEqual({ kind: "differs" });
  });

  it("keeps subjects in first-appearance order", () => {
    expect(
      subjectOrder([
        draft({ subjectId: "b" }),
        draft({ subjectId: "a", sectionId: "x" }),
        draft({ subjectId: "a", sectionId: "y" }),
      ]),
    ).toEqual(["b", "a"]);
  });
});
