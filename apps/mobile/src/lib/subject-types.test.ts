import { copy } from "./copy";
import {
  checkSubjectType,
  flagSentence,
  hasSubjectTypeErrors,
  startingSubjectTypeId,
  subjectTypeCreatePayload,
  subjectTypeDraft,
  subjectTypeDirty,
  subjectTypeSummary,
  subjectTypeUpdatePayload,
  termGradeCaution,
} from "./subject-types";
import type { SubjectTypeDraft, SubjectTypeLike } from "./subject-types";

function row(args: Partial<SubjectTypeLike> = {}): SubjectTypeLike {
  return {
    name: "Main Subjects",
    assessmentMode: "exam",
    countsTowardResult: true,
    isGradedOnly: false,
    sequence: 0,
    hasAssessmentData: false,
    ...args,
  };
}

function draft(args: Partial<SubjectTypeDraft> = {}): SubjectTypeDraft {
  return {
    name: "Main Subjects",
    assessmentMode: "exam",
    countsTowardResult: true,
    isGradedOnly: false,
    sequence: "0",
    ...args,
  };
}

describe("flagSentence", () => {
  it("states the counted exam case", () => {
    expect(
      flagSentence({
        assessmentMode: "exam",
        countsTowardResult: true,
        isGradedOnly: false,
      }),
    ).toBe("Exam papers · Marks · Counted in the result");
  });

  it("states the co-curricular case", () => {
    expect(
      flagSentence({
        assessmentMode: "exam",
        countsTowardResult: false,
        isGradedOnly: true,
      }),
    ).toBe("Exam papers · Grade only · Not counted");
  });

  it("states the Personality case", () => {
    expect(
      flagSentence({
        assessmentMode: "term_grade",
        countsTowardResult: false,
        isGradedOnly: true,
      }),
    ).toBe("Term grades · Grade only · Not counted");
  });

  it("states an uncounted marks case plainly", () => {
    expect(
      flagSentence({
        assessmentMode: "exam",
        countsTowardResult: false,
        isGradedOnly: false,
      }),
    ).toBe("Exam papers · Marks · Not counted");
  });
});

describe("subjectTypeDraft / summary", () => {
  it("copies a row into the form", () => {
    expect(
      subjectTypeDraft(
        row({
          assessmentMode: "term_grade",
          countsTowardResult: false,
          isGradedOnly: true,
          sequence: 3,
        }),
      ),
    ).toEqual({
      name: "Main Subjects",
      assessmentMode: "term_grade",
      countsTowardResult: false,
      isGradedOnly: true,
      sequence: "3",
    });
  });

  it("starts a new type counted and marked", () => {
    expect(subjectTypeDraft(null)).toEqual({
      name: "",
      assessmentMode: "exam",
      countsTowardResult: true,
      isGradedOnly: false,
      sequence: "0",
    });
  });

  it("writes the live sentence", () => {
    expect(
      subjectTypeSummary(
        draft({
          name: "Personality",
          assessmentMode: "term_grade",
          countsTowardResult: false,
          isGradedOnly: true,
        }),
      ),
    ).toBe(
      "Personality — entered at term end, shown as a grade, not counted in totals.",
    );
  });

  it("names an unnamed type without an empty dash", () => {
    expect(subjectTypeSummary(draft({ name: "  " }))).toContain(
      "This type — entered through exam papers",
    );
  });
});

describe("termGradeCaution", () => {
  it("warns only when term grades are counted", () => {
    expect(
      termGradeCaution(
        draft({ assessmentMode: "term_grade", countsTowardResult: true }),
      ),
    ).toBe(copy.exams.grading.types.termCountsCaution);
    expect(
      termGradeCaution(
        draft({ assessmentMode: "term_grade", countsTowardResult: false }),
      ),
    ).toBeNull();
    expect(termGradeCaution(draft({ assessmentMode: "exam" }))).toBeNull();
  });
});

describe("checkSubjectType", () => {
  it("accepts a named type with a whole card order", () => {
    expect(hasSubjectTypeErrors(checkSubjectType(draft()))).toBe(false);
    expect(checkSubjectType(draft({ sequence: "999" }))).toEqual({});
  });

  it("requires a name", () => {
    expect(checkSubjectType(draft({ name: " " }))).toEqual({
      name: copy.exams.grading.types.nameRequired,
    });
  });

  it("refuses a card order outside 0–999", () => {
    for (const sequence of ["", "-1", "1.5", "1000", "abc"]) {
      expect(checkSubjectType(draft({ sequence })).sequence).toBe(
        copy.exams.grading.types.sequenceError,
      );
    }
  });
});

describe("payloads", () => {
  it("creates with the full flag truth and a trimmed name", () => {
    expect(
      subjectTypeCreatePayload(
        draft({ name: "  Activities ", sequence: "2" }),
      ),
    ).toEqual({
      name: "Activities",
      assessmentMode: "exam",
      countsTowardResult: true,
      isGradedOnly: false,
      sequence: 2,
    });
  });

  it("sends nothing when nothing changed", () => {
    expect(subjectTypeUpdatePayload(draft(), row())).toEqual({});
    expect(subjectTypeDirty(draft(), row())).toBe(false);
  });

  it("sends only the changed name", () => {
    expect(
      subjectTypeUpdatePayload(draft({ name: "Scholastic" }), row()),
    ).toEqual({ name: "Scholastic" });
  });

  it("sends only the changed flags on an unlocked type", () => {
    expect(
      subjectTypeUpdatePayload(
        draft({ countsTowardResult: false, isGradedOnly: true }),
        row(),
      ),
    ).toEqual({ countsTowardResult: false, isGradedOnly: true });
  });

  it("never sends a behaviour flag for a locked type", () => {
    expect(
      subjectTypeUpdatePayload(
        draft({
          countsTowardResult: false,
          isGradedOnly: true,
          assessmentMode: "term_grade",
          sequence: "4",
        }),
        row({ hasAssessmentData: true }),
      ),
    ).toEqual({ sequence: 4 });
  });
});

describe("startingSubjectTypeId", () => {
  it("starts on the school's default", () => {
    expect(
      startingSubjectTypeId([
        { id: "a", isDefault: false },
        { id: "b", isDefault: true },
      ]),
    ).toBe("b");
  });

  it("starts on the only type when there is no default", () => {
    expect(startingSubjectTypeId([{ id: "a", isDefault: false }])).toBe("a");
  });

  it("makes the person choose among several with no default", () => {
    expect(
      startingSubjectTypeId([
        { id: "a", isDefault: false },
        { id: "b", isDefault: false },
      ]),
    ).toBeNull();
  });

  it("has nothing to start on with no types", () => {
    expect(startingSubjectTypeId([])).toBeNull();
  });
});
