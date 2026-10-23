import {
  branchFormFrom,
  branchPayload,
  emptyBranchForm,
  isBranchFormDirty,
  normaliseBranchCode,
  validateBranchForm,
  validateBranchField,
} from "./branch-form";

describe("branchFormFrom", () => {
  it("starts a create form on CBSE with empty text", () => {
    expect(emptyBranchForm()).toEqual({
      name: "",
      legalName: "",
      code: "",
      board: "cbse",
      email: "",
      phone: "",
      city: "",
      state: "",
      pincode: "",
      udiseCode: "",
    });
  });

  it("maps every nullable stored column to an empty string", () => {
    const form = branchFormFrom({
      name: "Main Campus",
      legalName: "Demo Public School",
      code: "MAIN",
      board: "icse",
      email: null,
      phone: null,
      city: "Kolkata",
      state: null,
      pincode: null,
      udiseCode: null,
    });
    expect(form.board).toBe("icse");
    expect(form.city).toBe("Kolkata");
    expect(form.email).toBe("");
    expect(form.udiseCode).toBe("");
  });
});

describe("validateBranchField", () => {
  const base = emptyBranchForm();

  it("requires a name and a registered name of at least two characters", () => {
    expect(validateBranchField("name", base)).toBeDefined();
    expect(validateBranchField("name", { ...base, name: " A " })).toBeDefined();
    expect(validateBranchField("name", { ...base, name: "Main" })).toBeUndefined();
    expect(validateBranchField("legalName", base)).toBeDefined();
  });

  it("requires a code in capitals, numbers and hyphens", () => {
    expect(validateBranchField("code", base)).toBeDefined();
    expect(
      validateBranchField("code", { ...base, code: "main campus" }),
    ).toBeDefined();
    expect(validateBranchField("code", { ...base, code: "MAIN-2" })).toBeUndefined();
    expect(normaliseBranchCode("maiN-2")).toBe("MAIN-2");
  });

  it("accepts empty optionals but not malformed ones", () => {
    expect(validateBranchField("email", base)).toBeUndefined();
    expect(
      validateBranchField("email", { ...base, email: "office@school.test" }),
    ).toBeUndefined();
    expect(
      validateBranchField("email", { ...base, email: "not-an-email" }),
    ).toBeDefined();

    expect(validateBranchField("phone", base)).toBeUndefined();
    expect(
      validateBranchField("phone", { ...base, phone: "033 2345 6789" }),
    ).toBeUndefined();
    expect(validateBranchField("phone", { ...base, phone: "12345" })).toBeDefined();

    expect(validateBranchField("pincode", base)).toBeUndefined();
    expect(
      validateBranchField("pincode", { ...base, pincode: "700001" }),
    ).toBeUndefined();
    expect(
      validateBranchField("pincode", { ...base, pincode: "012345" }),
    ).toBeDefined();

    expect(validateBranchField("udiseCode", base)).toBeUndefined();
    expect(
      validateBranchField("udiseCode", { ...base, udiseCode: "12345678901" }),
    ).toBeUndefined();
    expect(
      validateBranchField("udiseCode", { ...base, udiseCode: "12345" }),
    ).toBeDefined();
  });
});

describe("validateBranchForm", () => {
  it("collects only the fields that are wrong", () => {
    const errors = validateBranchForm({ ...emptyBranchForm(), name: "Main" });
    expect(Object.keys(errors).sort()).toEqual(["code", "legalName"]);
  });
});

describe("branchPayload", () => {
  it("trims, uppercases the code, and omits empty optionals", () => {
    const form = {
      ...emptyBranchForm(),
      name: "  Main Campus ",
      legalName: " Demo Public School ",
      code: " main ",
      phone: "03323456789",
    };
    expect(branchPayload(form)).toEqual({
      name: "Main Campus",
      legalName: "Demo Public School",
      code: "MAIN",
      board: "cbse",
      phone: "03323456789",
    });
  });
});

describe("isBranchFormDirty", () => {
  it("compares every field", () => {
    const form = emptyBranchForm();
    expect(isBranchFormDirty(form, emptyBranchForm())).toBe(false);
    expect(isBranchFormDirty({ ...form, city: "Kolkata" }, form)).toBe(true);
  });
});
