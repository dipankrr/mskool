import { describe, expect, it } from "vitest";

import {
  admitSteps,
  emptyFamilyForm,
  familyPayloads,
  findAdmissionClash,
  findPossibleDuplicate,
  isAdmissionNumberRefusal,
  normaliseParentPhone,
  primarySlot,
  sectionStrength,
  studentFullName,
  suggestAdmissionNumber,
  validateFamilyStep,
  type FamilyForm,
  type RegisterRow,
} from "./admit-logic";

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
    expect(suggestAdmissionNumber([row({ admissionNumber: "A-99" })])).toBe("A-100");
  });

  it("steps over numbers used or refused", () => {
    expect(
      suggestAdmissionNumber([
        row({ admissionNumber: "A-1", createdAt: "2026-05-01T00:00:00.000Z" }),
        row({ admissionNumber: "A-2", createdAt: "2026-04-01T00:00:00.000Z" }),
      ]),
    ).toBe("A-3");
    expect(suggestAdmissionNumber([row({ admissionNumber: "A-1" })], "a-2")).toBe("A-3");
  });

  it("won't guess at a format with no trailing number", () => {
    expect(suggestAdmissionNumber([row({ admissionNumber: "2026-A" })])).toBeNull();
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
  });

  it("stays quiet until the form has all three", () => {
    expect(findPossibleDuplicate({ firstName: "Aditi", lastName: "Sharma" }, [row()])).toBeNull();
  });
});

describe("isAdmissionNumberRefusal", () => {
  it("recognises the server's wording only", () => {
    expect(isAdmissionNumberRefusal("Admission number X is already used.")).toBe(true);
    expect(isAdmissionNumberRefusal("Couldn't reach the server.")).toBe(false);
  });
});

describe("normaliseParentPhone", () => {
  it("keeps digits and removes a country prefix", () => {
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

  it("refuses the same phone twice, on the second person", () => {
    const errors = validateFamilyStep(
      family({
        father: { name: "Rakesh", phone: "9876543210" },
        mother: { name: "Sunita", phone: "9876543210" },
      }),
    );
    expect(Object.keys(errors)).toEqual(["mother.phone"]);
  });

  it("asks the other guardian's relation", () => {
    expect(
      validateFamilyStep(family({ other: { name: "Asha", phone: "9876543210" } })).otherRelation,
    ).toBeDefined();
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
  });

  it("honours the choice, unless that person was cleared", () => {
    expect(primarySlot(family({ ...both, primary: "mother" }))).toBe("mother");
    expect(primarySlot(family({ father: both.father, primary: "mother" }))).toBe("father");
  });
});

describe("familyPayloads", () => {
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
    expect(payloads[0]?.payload.firstName).toBe("Rakesh");
    expect(payloads[0]?.payload.isPrimary).toBe(false);
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
      { enrollment: { sectionId: null, enrollmentStatus: "admitted" } },
    ]);
    expect(counts.get("a")).toBe(2);
  });
});

describe("studentFullName", () => {
  it("skips the blanks", () => {
    expect(studentFullName({ firstName: "Rohan", middleName: " ", lastName: "Verma" })).toBe(
      "Rohan Verma",
    );
  });
});
