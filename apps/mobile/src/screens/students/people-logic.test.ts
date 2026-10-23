import {
  ENROLLMENT_TRANSITIONS,
  emptyEnrollmentForm,
  emptyGuardianForm,
  enrollmentCreatePayload,
  guardianFormFrom,
  guardianPayload,
  validateEnrollmentForm,
  validateGuardianForm,
} from "./people-logic";
import { copy } from "../../lib/copy";

describe("enrollment transitions map", () => {
  it("mirrors the service's legal moves", () => {
    expect(ENROLLMENT_TRANSITIONS.admitted).toEqual(["withdrawn"]);
    expect(ENROLLMENT_TRANSITIONS.section_assigned).toEqual([
      "active",
      "withdrawn",
    ]);
    expect(ENROLLMENT_TRANSITIONS.active).toEqual([
      "transferred_out",
      "withdrawn",
      "passed_out",
    ]);
    expect(ENROLLMENT_TRANSITIONS.withdrawn).toEqual([]);
    expect(ENROLLMENT_TRANSITIONS.passed_out).toEqual([]);
  });
});

describe("enrollment form", () => {
  it("demands a class on create", () => {
    const errors = validateEnrollmentForm(emptyEnrollmentForm(), "create");
    expect(errors.classId).toBeDefined();
    expect(errors.sectionId).toBeUndefined(); // admitted without one is legal
  });

  it("demands a section in assign mode", () => {
    const errors = validateEnrollmentForm(emptyEnrollmentForm(), "assign");
    expect(errors.sectionId).toBeDefined();
  });

  it("bounds the roll length", () => {
    const errors = validateEnrollmentForm(
      { ...emptyEnrollmentForm(), classId: "c1", rollNumber: "x".repeat(21) },
      "create",
    );
    expect(errors.rollNumber).toBeDefined();
  });

  it("omits the section and roll when unset", () => {
    const payload = enrollmentCreatePayload(
      { ...emptyEnrollmentForm(), classId: "c1" },
      { studentId: "s1", academicYearId: "y1" },
    );
    expect(payload.studentId).toBe("s1");
    expect(payload.classId).toBe("c1");
    expect("sectionId" in payload).toBe(false);
    expect("rollNumber" in payload).toBe(false);
  });

  it("sends the section when set (status derives server-side)", () => {
    const payload = enrollmentCreatePayload(
      { ...emptyEnrollmentForm(), classId: "c1", sectionId: "sec1", rollNumber: " 12 " },
      { studentId: "s1", academicYearId: "y1" },
    );
    expect(payload.sectionId).toBe("sec1");
    expect(payload.rollNumber).toBe("12");
  });
});

describe("guardian form", () => {
  it("demands name, relation and a 10-digit phone", () => {
    const errors = validateGuardianForm(emptyGuardianForm());
    expect(errors.firstName).toBeDefined();
    expect(errors.relation).toBeDefined();
    expect(errors.phone).toBeDefined();
  });

  it("round-trips a stored view", () => {
    const form = guardianFormFrom({
      id: "g1",
      firstName: "Sunita",
      lastName: "Sharma",
      relation: "mother",
      phone: "9830011223",
      isPrimary: true,
      isEmergencyContact: false,
      canAccessPortal: true,
      endedOn: null,
      portal: null,
    });
    expect(form.firstName).toBe("Sunita");
    expect(form.isPrimary).toBe(true);
  });

  it("sends null for an empty last name", () => {
    const payload = guardianPayload({
      ...emptyGuardianForm(),
      firstName: " Sunita ",
      relation: "mother",
      phone: "9830011223",
    });
    expect(payload.firstName).toBe("Sunita");
    expect(payload.lastName).toBeNull();
  });

  it("carries the portal toggle", () => {
    const payload = guardianPayload({
      ...emptyGuardianForm(),
      firstName: "Sunita",
      relation: "mother",
      phone: "9830011223",
      canAccessPortal: false,
    });
    expect(payload.canAccessPortal).toBe(false);
  });

  it("labels every relation", () => {
    for (const relation of [
      "father",
      "mother",
      "grandfather",
      "grandmother",
      "uncle",
      "aunt",
      "brother",
      "sister",
      "legal_guardian",
      "other",
    ] as const) {
      expect(copy.students.relations[relation]).toBeTruthy();
    }
  });
});
