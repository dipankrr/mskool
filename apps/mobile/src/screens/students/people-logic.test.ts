import {
  addressBlock,
  ageInYears,
  emptyEnrollmentForm,
  emptyGuardianForm,
  enrollmentCreatePayload,
  guardianFormFrom,
  guardianPayload,
  hasLeft,
  leavingOptions,
  maskAadhaar,
  validateEnrollmentForm,
  validateGuardianForm,
} from "./people-logic";
import { copy } from "../../lib/copy";

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

describe("a student leaving", () => {
  it("offers every way out to anyone still at the school", () => {
    const all = ["transferred_out", "withdrawn", "expelled"];
    expect(leavingOptions("admitted")).toEqual(all);
    expect(leavingOptions("studying")).toEqual(all);
    expect(leavingOptions("completed")).toEqual(all);
  });

  it("offers nothing once they have gone", () => {
    expect(leavingOptions("withdrawn")).toEqual([]);
    expect(leavingOptions("graduated")).toEqual([]);
  });

  it("treats graduating as having left, and a finished session as not", () => {
    expect(hasLeft("graduated")).toBe(true);
    expect(hasLeft("expelled")).toBe(true);
    expect(hasLeft("studying")).toBe(false);
    expect(hasLeft("completed")).toBe(false);
  });
});

describe("profile facts", () => {
  it("counts a birthday only once it has passed", () => {
    expect(ageInYears("2020-11-01", "2026-11-01")).toBe(6);
    expect(ageInYears("2020-11-02", "2026-11-01")).toBe(5);
    expect(ageInYears(null, "2026-11-01")).toBeNull();
    expect(ageInYears("2027-01-01", "2026-11-01")).toBeNull();
  });

  it("masks all but the last four Aadhaar digits", () => {
    expect(maskAadhaar("123456789012")).toBe("XXXX XXXX 9012");
  });

  it("writes the address as lines, skipping what is missing", () => {
    expect(
      addressBlock({
        addressLine1: "12 Park St",
        addressLine2: null,
        city: "Kolkata",
        state: "West Bengal",
        pincode: "700016",
      }),
    ).toBe("12 Park St\nKolkata, West Bengal 700016");
    expect(
      addressBlock({ addressLine1: null, addressLine2: null, city: null, state: null, pincode: "700016" }),
    ).toBe("700016");
    expect(
      addressBlock({ addressLine1: null, addressLine2: null, city: null, state: null, pincode: null }),
    ).toBeNull();
  });
});
