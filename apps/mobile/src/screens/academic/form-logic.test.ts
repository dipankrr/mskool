import {
  classFormFrom,
  classPayload,
  emptySectionForm,
  emptyTermForm,
  isFormDirty,
  mappingUpdatePayload,
  sectionPayload,
  termPayload,
  validateAssignmentForm,
  validateClassForm,
  validateMappingForm,
  validateSectionForm,
  validateSubjectForm,
  validateTermForm,
} from "./form-logic";

describe("class forms", () => {
  it("accepts a normal class", () => {
    expect(
      validateClassForm({ name: "Class 6", order: "6", description: "" }),
    ).toEqual({});
  });

  it("bounds the order like the contract", () => {
    expect(validateClassForm({ name: "Nursery", order: "-3", description: "" }).order).toBeUndefined();
    expect(validateClassForm({ name: "Nursery", order: "21", description: "" }).order).toBeDefined();
    expect(validateClassForm({ name: "Nursery", order: "six", description: "" }).order).toBeDefined();
  });

  it("demands a name", () => {
    expect(validateClassForm({ name: "", order: "1", description: "" }).name).toBeDefined();
  });

  it("builds the payload with the description only when set", () => {
    const withDescription = classPayload({
      name: " Class 6 ",
      order: "6",
      description: "Grade six",
    });
    expect(withDescription.name).toBe("Class 6");
    expect(withDescription.numericOrder).toBe(6);
    expect(withDescription.description).toBe("Grade six");
    expect(classPayload({ name: "Class 6", order: "6", description: "" }).description).toBeUndefined();
  });

  it("round-trips a stored row", () => {
    const form = classFormFrom({ name: "Class 6", numericOrder: 6, description: null });
    expect(form.order).toBe("6");
    expect(form.description).toBe("");
  });
});

describe("section forms", () => {
  it("demands class and name", () => {
    const errors = validateSectionForm(emptySectionForm());
    expect(errors.classId).toBeDefined();
    expect(errors.name).toBeDefined();
  });

  it("bounds capacity only when set", () => {
    expect(
      validateSectionForm({ ...emptySectionForm(), name: "A", classId: "c1", maxStudents: "" }).maxStudents,
    ).toBeUndefined();
    expect(
      validateSectionForm({ ...emptySectionForm(), name: "A", classId: "c1", maxStudents: "0" }).maxStudents,
    ).toBeDefined();
    expect(
      validateSectionForm({ ...emptySectionForm(), name: "A", classId: "c1", maxStudents: "40" }).maxStudents,
    ).toBeUndefined();
  });

  it("carries the academic year and optional fields", () => {
    const payload = sectionPayload(
      { ...emptySectionForm(), classId: "c1", name: " B ", shift: "day", roomNumber: "204", maxStudents: "40" },
      "y1",
    );
    expect(payload.academicYearId).toBe("y1");
    expect(payload.name).toBe("B");
    expect(payload.shift).toBe("day");
    expect(payload.roomNumber).toBe("204");
    expect(payload.maxStudents).toBe(40);
    expect(payload.stream).toBeUndefined();
  });
});

describe("subject forms", () => {
  it("demands a name", () => {
    expect(validateSubjectForm({ name: "", shortName: "", code: "" }).name).toBeDefined();
  });

  it("omits empty optionals", () => {
    const payload = validateSubjectForm({ name: "Mathematics", shortName: "", code: "" });
    expect(payload).toEqual({});
  });
});

describe("term forms", () => {
  it("rejects an empty form", () => {
    const errors = validateTermForm(emptyTermForm());
    expect(errors.name).toBeDefined();
    expect(errors.sequence).toBeDefined();
    expect(errors.startDate).toBeDefined();
    expect(errors.endDate).toBeDefined();
    expect(errors.weightage).toBeUndefined(); // default 100 is valid
  });

  it("orders the dates", () => {
    const errors = validateTermForm({
      ...emptyTermForm(),
      name: "Term 1",
      sequence: "1",
      startDate: "2025-04-01",
      endDate: "2025-03-31",
    });
    expect(errors.endDate).toBeDefined();
  });

  it("bounds the weightage above zero", () => {
    expect(
      validateTermForm({ ...emptyTermForm(), name: "T", sequence: "1", startDate: "2025-04-01", endDate: "2025-06-30", weightage: "0" }).weightage,
    ).toBeDefined();
    expect(
      validateTermForm({ ...emptyTermForm(), name: "T", sequence: "1", startDate: "2025-04-01", endDate: "2025-06-30", weightage: "33.5" }).weightage,
    ).toBeUndefined();
  });

  it("sends the weightage as a fixed-point string", () => {
    const payload = termPayload(
      { ...emptyTermForm(), name: "Term 1", sequence: "1", startDate: "2025-04-01", endDate: "2025-06-30", weightage: "33.5" },
      "y1",
    );
    expect(payload.weightage).toBe("33.50");
    expect(payload.academicYearId).toBe("y1");
  });
});

describe("mapping forms", () => {
  it("demands a subject", () => {
    expect(validateMappingForm({ subjectId: null, isElective: false, sequence: "0" }).subjectId).toBeDefined();
  });

  it("updates only elective and sequence", () => {
    const payload = mappingUpdatePayload({ subjectId: "s1", isElective: true, sequence: "3" });
    expect(payload.isElective).toBe(true);
    expect(payload.sequenceNumber).toBe(3);
    expect("subjectId" in payload).toBe(false);
  });
});

describe("assignment forms", () => {
  it("demands teacher and role", () => {
    const errors = validateAssignmentForm({ userId: null, role: "subject_teacher", subjectId: null });
    expect(errors.userId).toBeDefined();
  });

  it("pairs subject with the subject_teacher role only", () => {
    expect(
      validateAssignmentForm({ userId: "u1", role: "subject_teacher", subjectId: null }).subjectId,
    ).toBeDefined();
    expect(
      validateAssignmentForm({ userId: "u1", role: "class_teacher", subjectId: "s1" }).subjectId,
    ).toBeDefined();
    expect(
      validateAssignmentForm({ userId: "u1", role: "class_teacher", subjectId: null }).subjectId,
    ).toBeUndefined();
    expect(
      validateAssignmentForm({ userId: "u1", role: "subject_teacher", subjectId: "s1" }).subjectId,
    ).toBeUndefined();
  });
});

describe("isFormDirty", () => {
  it("compares values", () => {
    expect(isFormDirty({ a: 1 }, { a: 1 })).toBe(false);
    expect(isFormDirty({ a: 1 }, { a: 2 })).toBe(true);
    expect(isFormDirty({ a: null }, { a: null })).toBe(false);
  });
});
