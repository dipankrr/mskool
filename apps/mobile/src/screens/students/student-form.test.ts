import {
  emptyStudentForm,
  isStudentFormDirty,
  normaliseStudentDigits,
  studentCreatePayload,
  studentFormFrom,
  studentUpdatePayload,
  validateStudentField,
  validateStudentForm,
} from "./student-form";

const VALID: Parameters<typeof studentUpdatePayload>[0] = {
  ...emptyStudentForm(),
  admissionNumber: "2026-014",
  firstName: "Aditi",
  lastName: "Sharma",
  dateOfBirth: "2014-06-12",
  gender: "female",
};

describe("emptyStudentForm", () => {
  it("assumes nothing", () => {
    const form = emptyStudentForm();
    expect(form.admissionNumber).toBe("");
    expect(form.dateOfBirth).toBeNull();
    expect(form.gender).toBeNull();
    expect(form.bloodGroup).toBeNull();
  });
});

describe("studentFormFrom", () => {
  it("maps a stored row, emptying nulls", () => {
    const form = studentFormFrom({
      admissionNumber: "2025-003",
      firstName: "Rohan",
      middleName: null,
      lastName: "Verma",
      dateOfBirth: "2013-01-09",
      admissionDate: "2025-04-01",
      gender: "male",
      bloodGroup: "o_positive",
      email: null,
      phone: "9830011223",
      nationality: null,
      religion: null,
      category: null,
      motherTongue: null,
      aadhaarNumber: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      pincode: null,
      medicalConditions: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
    expect(form.middleName).toBe("");
    expect(form.email).toBe("");
    expect(form.bloodGroup).toBe("o_positive");
    expect(form.phone).toBe("9830011223");
  });

  it("returns a blank form for nothing", () => {
    expect(studentFormFrom(null)).toEqual(emptyStudentForm());
  });
});

describe("validateStudentForm", () => {
  it("accepts the required minimum", () => {
    expect(validateStudentForm(VALID)).toEqual({});
  });

  it("demands the required fields", () => {
    const errors = validateStudentForm(emptyStudentForm());
    expect(errors.admissionNumber).toBeDefined();
    expect(errors.firstName).toBeDefined();
    expect(errors.lastName).toBeDefined();
    expect(errors.dateOfBirth).toBeDefined();
    expect(errors.gender).toBeDefined();
  });

  it("refuses a future date of birth", () => {
    const errors = validateStudentForm({
      ...VALID,
      dateOfBirth: "2999-01-01",
    });
    expect(errors.dateOfBirth).toBeDefined();
  });

  it("checks the optional shapes only when filled", () => {
    expect(
      validateStudentForm({ ...VALID, email: "not-an-email" }).email,
    ).toBeDefined();
    expect(
      validateStudentForm({ ...VALID, aadhaarNumber: "1234" }).aadhaarNumber,
    ).toBeDefined();
    expect(
      validateStudentForm({ ...VALID, pincode: "012345" }).pincode,
    ).toBeDefined();
    expect(validateStudentForm({ ...VALID, phone: "123" }).phone).toBeDefined();
    expect(validateStudentForm({ ...VALID, email: "" }).email).toBeUndefined();
  });
});

describe("validateStudentField", () => {
  it("validates one field without the rest", () => {
    expect(
      validateStudentField("firstName", { ...VALID, firstName: "" }),
    ).toBeDefined();
    expect(
      validateStudentField("lastName", { ...VALID, firstName: "" }),
    ).toBeUndefined();
  });
});

describe("payloads", () => {
  it("trims and keeps nulls for empty optionals", () => {
    const payload = studentCreatePayload({
      ...VALID,
      firstName: "  Aditi  ",
      email: "",
      middleName: "  ",
    });
    expect(payload.firstName).toBe("Aditi");
    expect(payload.email).toBeNull();
    expect(payload.middleName).toBeNull();
    expect(payload.admissionNumber).toBe("2026-014");
  });

  it("omits the admission number from the update payload", () => {
    const payload = studentUpdatePayload(VALID);
    expect("admissionNumber" in payload).toBe(false);
  });
});

describe("isStudentFormDirty", () => {
  it("notices any change", () => {
    const base = studentFormFrom(null);
    expect(isStudentFormDirty(base, base)).toBe(false);
    expect(isStudentFormDirty(base, { ...base, city: "Kolkata" })).toBe(true);
    expect(isStudentFormDirty(base, { ...base, gender: "male" })).toBe(true);
  });
});

describe("normaliseStudentDigits", () => {
  it("strips everything but digits", () => {
    expect(normaliseStudentDigits("12 34-ab")).toBe("1234");
  });
});
