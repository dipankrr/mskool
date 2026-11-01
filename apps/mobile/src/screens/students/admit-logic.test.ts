import {
  admitSteps,
  emptyFamilyForm,
  familyPayloads,
  filledMoreGroups,
  findAdmissionClash,
  findPossibleDuplicate,
  fullFormProblems,
  isAdmissionNumberRefusal,
  normaliseParentPhone,
  primarySlot,
  sectionStrength,
  studentFullName,
  suggestAdmissionNumber,
  validateFamilyStep,
  validateFullStudent,
  validateStudentStep,
  type FamilyForm,
  type RegisterRow,
} from "./admit-logic";
import { emptyStudentForm } from "./student-form";

function row(overrides: Partial<RegisterRow> = {}): RegisterRow {
  return {
    id: "s1",
    admissionNumber: "2026-014",
    firstName: "Aditi",
    lastName: "Sharma",
    dateOfBirth: "2014-06-12",
    createdAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function family(overrides: Partial<FamilyForm> = {}): FamilyForm {
  return { ...emptyFamilyForm(), ...overrides };
}

const VALID_STUDENT = {
  ...emptyStudentForm(),
  admissionNumber: "2026-015",
  firstName: "Rohan",
  lastName: "Verma",
  dateOfBirth: "2015-01-09",
  gender: "male" as const,
};

describe("admitSteps", () => {
  it("offers the whole journey to a caller who can do all of it", () => {
    expect(admitSteps({ enroll: true, addFamily: true })).toEqual([
      "student",
      "class",
      "family",
      "review",
    ]);
  });

  it("drops a step whose write the account can't make", () => {
    expect(admitSteps({ enroll: false, addFamily: true })).toEqual([
      "student",
      "family",
      "review",
    ]);
    expect(admitSteps({ enroll: true, addFamily: false })).toEqual([
      "student",
      "class",
      "review",
    ]);
    expect(admitSteps({ enroll: false, addFamily: false })).toEqual(["student", "review"]);
  });
});

describe("suggestAdmissionNumber", () => {
  it("has nothing to offer on an empty register", () => {
    expect(suggestAdmissionNumber([])).toBeNull();
  });

  it("follows the newest admission and keeps the padding", () => {
    expect(
      suggestAdmissionNumber([
        row({ admissionNumber: "2026-099", createdAt: "2026-04-01T00:00:00.000Z" }),
        row({ admissionNumber: "2026-014", createdAt: "2026-05-01T00:00:00.000Z" }),
      ]),
    ).toBe("2026-015");
    expect(suggestAdmissionNumber([row({ admissionNumber: "ADM007" })])).toBe("ADM008");
    expect(suggestAdmissionNumber([row({ admissionNumber: "42" })])).toBe("43");
  });

  it("grows past the padding when the digits run out", () => {
    expect(suggestAdmissionNumber([row({ admissionNumber: "A-99" })])).toBe("A-100");
  });

  it("steps over numbers already used", () => {
    expect(
      suggestAdmissionNumber([
        row({ admissionNumber: "2026-014", createdAt: "2026-05-01T00:00:00.000Z" }),
        row({ admissionNumber: "2026-015", createdAt: "2026-04-01T00:00:00.000Z" }),
      ]),
    ).toBe("2026-016");
  });

  it("steps over a number the server refused", () => {
    expect(suggestAdmissionNumber([row({ admissionNumber: "A-1" })], "a-2")).toBe("A-3");
  });

  it("won't guess at a format with no trailing number", () => {
    expect(suggestAdmissionNumber([row({ admissionNumber: "2026-A" })])).toBeNull();
  });

  it("accepts Date as well as string timestamps", () => {
    expect(
      suggestAdmissionNumber([
        row({ admissionNumber: "A-1", createdAt: new Date("2026-01-01") }),
        row({ admissionNumber: "B-1", createdAt: new Date("2026-02-01") }),
      ]),
    ).toBe("B-2");
  });
});

describe("findAdmissionClash", () => {
  it("matches regardless of case and spacing", () => {
    expect(findAdmissionClash(" adm-1 ", [row({ admissionNumber: "ADM-1" })])?.id).toBe("s1");
  });

  it("finds nothing for a blank or unused number", () => {
    expect(findAdmissionClash("", [row()])).toBeNull();
    expect(findAdmissionClash("OTHER", [row()])).toBeNull();
  });
});

describe("findPossibleDuplicate", () => {
  it("needs the name and the birth date to match", () => {
    const form = { firstName: "aditi ", lastName: "SHARMA", dateOfBirth: "2014-06-12" };
    expect(findPossibleDuplicate(form, [row()])?.id).toBe("s1");
    expect(findPossibleDuplicate({ ...form, dateOfBirth: "2014-06-13" }, [row()])).toBeNull();
    expect(findPossibleDuplicate({ ...form, firstName: "Asha" }, [row()])).toBeNull();
  });

  it("stays quiet until the form has all three", () => {
    expect(
      findPossibleDuplicate({ firstName: "Aditi", lastName: "Sharma", dateOfBirth: null }, [row()]),
    ).toBeNull();
    expect(
      findPossibleDuplicate({ firstName: "Aditi", lastName: "", dateOfBirth: "2014-06-12" }, [row()]),
    ).toBeNull();
  });
});

describe("validateStudentStep", () => {
  it("passes a complete student", () => {
    expect(validateStudentStep(VALID_STUDENT, [row()])).toEqual({});
  });

  it("names each required field on a blank form", () => {
    expect(Object.keys(validateStudentStep(emptyStudentForm(), [])).sort()).toEqual([
      "admissionNumber",
      "dateOfBirth",
      "firstName",
      "gender",
      "lastName",
    ]);
  });

  it("refuses a used number and says whose it is", () => {
    const errors = validateStudentStep({ ...VALID_STUDENT, admissionNumber: "2026-014" }, [row()]);
    expect(errors.admissionNumber).toContain("Aditi Sharma");
  });
});

describe("isAdmissionNumberRefusal", () => {
  it("recognises the server's wording only", () => {
    expect(
      isAdmissionNumberRefusal("Admission number X is already used at this branch."),
    ).toBe(true);
    expect(isAdmissionNumberRefusal("Couldn't reach the server.")).toBe(false);
  });
});

describe("normaliseParentPhone", () => {
  it("keeps digits and removes a country prefix", () => {
    expect(normaliseParentPhone("98765 43210")).toBe("9876543210");
    expect(normaliseParentPhone("+91 98765 43210")).toBe("9876543210");
    expect(normaliseParentPhone("919876543210")).toBe("9876543210");
  });

  it("doesn't touch a 10-digit number that starts with 91", () => {
    expect(normaliseParentPhone("9198765432")).toBe("9198765432");
  });
});

describe("validateFamilyStep", () => {
  it("requires nobody", () => {
    expect(validateFamilyStep(emptyFamilyForm())).toEqual({});
  });

  it("needs a name and a phone together", () => {
    expect(
      Object.keys(validateFamilyStep(family({ father: { name: "Rakesh", phone: "" } }))),
    ).toEqual(["father.phone"]);
    expect(
      Object.keys(validateFamilyStep(family({ mother: { name: "", phone: "9876543210" } }))),
    ).toEqual(["mother.name"]);
  });

  it("refuses a phone that isn't 10 digits", () => {
    expect(
      validateFamilyStep(family({ father: { name: "Rakesh", phone: "98765" } }))["father.phone"],
    ).toBeDefined();
  });

  it("refuses the same phone twice, on the second person", () => {
    const errors = validateFamilyStep(
      family({
        father: { name: "Rakesh", phone: "9876543210" },
        mother: { name: "Sunita", phone: "9876543210" },
      }),
    );
    expect(Object.keys(errors)).toEqual(["mother.phone"]);
    expect(errors["mother.phone"]).toContain("Father");
  });

  it("asks the other guardian's relation", () => {
    expect(
      validateFamilyStep(family({ other: { name: "Asha", phone: "9876543210" } })).otherRelation,
    ).toBeDefined();
    expect(
      validateFamilyStep(
        family({ other: { name: "Asha", phone: "9876543210" }, otherRelation: "aunt" }),
      ),
    ).toEqual({});
  });
});

describe("primarySlot", () => {
  const both = {
    father: { name: "Rakesh", phone: "9876543210" },
    mother: { name: "Sunita", phone: "9876543211" },
  };

  it("defaults to the first person recorded", () => {
    expect(primarySlot(family())).toBeNull();
    expect(primarySlot(family(both))).toBe("father");
    expect(primarySlot(family({ mother: both.mother }))).toBe("mother");
  });

  it("honours the choice, unless that person was cleared", () => {
    expect(primarySlot(family({ ...both, primary: "mother" }))).toBe("mother");
    expect(primarySlot(family({ father: both.father, primary: "mother" }))).toBe("father");
  });
});

describe("familyPayloads", () => {
  it("is empty when nobody is recorded", () => {
    expect(familyPayloads(emptyFamilyForm())).toEqual([]);
  });

  it("builds one body per person, with exactly one primary", () => {
    const payloads = familyPayloads(
      family({
        father: { name: " Rakesh ", phone: "9876543210" },
        other: { name: "Asha", phone: "9876543211" },
        otherRelation: "aunt",
        primary: "other",
      }),
    );
    expect(payloads.map((entry) => entry.slot)).toEqual(["father", "other"]);
    expect(payloads[0]?.payload).toEqual({
      firstName: "Rakesh",
      lastName: null,
      relation: "father",
      phone: "9876543210",
      isPrimary: false,
      isEmergencyContact: false,
      canAccessPortal: true,
    });
    expect(payloads[1]?.payload.relation).toBe("aunt");
    expect(payloads[1]?.payload.isPrimary).toBe(true);
  });
});

describe("sectionStrength", () => {
  it("counts current students per section", () => {
    const counts = sectionStrength([
      { enrollment: { sectionId: "a", enrollmentStatus: "studying" } },
      { enrollment: { sectionId: "a", enrollmentStatus: "completed" } },
      { enrollment: { sectionId: "a", enrollmentStatus: "withdrawn" } },
      { enrollment: { sectionId: "b", enrollmentStatus: "transferred_out" } },
      { enrollment: { sectionId: null, enrollmentStatus: "admitted" } },
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.has("b")).toBe(false);
  });
});

describe("studentFullName", () => {
  it("skips the blanks", () => {
    expect(studentFullName({ firstName: "Rohan", middleName: " ", lastName: "Verma" })).toBe(
      "Rohan Verma",
    );
    expect(studentFullName({ firstName: "Rohan", middleName: "Kumar", lastName: "Verma" })).toBe(
      "Rohan Kumar Verma",
    );
  });
});

describe("the full form", () => {
  const ready = {
    ...emptyStudentForm(),
    firstName: "Aditi",
    lastName: "Sharma",
    dateOfBirth: "2014-06-12",
    gender: "female" as const,
    admissionNumber: "2026-015",
  };

  it("checks the optional fields the steps leave alone", () => {
    const bad = { ...ready, pincode: "12", email: "not-an-email" };
    expect(validateStudentStep(bad, [])).toEqual({});
    expect(Object.keys(validateFullStudent(bad, []))).toEqual(
      expect.arrayContaining(["pincode", "email"]),
    );
  });

  it("still refuses a used number", () => {
    const used = row({ admissionNumber: "2026-015" });
    expect(validateFullStudent(ready, [used]).admissionNumber).toBeDefined();
  });

  it("names the parts holding an error, in the order they appear", () => {
    expect(
      fullFormProblems({ firstName: "x", pincode: "x", emergencyContactPhone: "x" }, { "father.phone": "x" }),
    ).toEqual(["student", "family", "address", "health"]);
    expect(fullFormProblems({}, {})).toEqual([]);
  });

  it("lists only the optional groups something was typed into", () => {
    expect(filledMoreGroups(ready)).toEqual([]);
    expect(filledMoreGroups({ ...ready, city: "Kolkata", bloodGroup: "b_positive" })).toEqual([
      "address",
      "health",
    ]);
    expect(filledMoreGroups({ ...ready, city: "   " })).toEqual([]);
  });
});
