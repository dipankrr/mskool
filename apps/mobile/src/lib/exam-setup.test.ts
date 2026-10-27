import {
  checkComponents,
  createExamPayload,
  editFrozenFields,
  effectiveCountsTowardTerm,
  newPaper,
  paperSubjects,
  prefillExamDate,
  requiresLinkedExam,
  weightSum,
} from "./exam-setup";
import type { ComponentDraft, MappingRow, SubjectTypeRow } from "./exam-setup";

function type(args?: Partial<SubjectTypeRow>): SubjectTypeRow {
  return {
    id: "t1",
    name: "Main Subjects",
    countsTowardResult: true,
    isGradedOnly: false,
    assessmentMode: "exam",
    sequence: 1,
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
