import { copy } from "./copy";
import {
  criteriaCounts,
  criteriaDraft,
  criteriaDraftFromDefault,
  criteriaErrors,
  criteriaMeta,
  criteriaPayload,
  criteriaSummary,
  criteriaUpdatePayload,
  hasCriteriaErrors,
  sortCriteriaRows,
  uncoveredScopes,
} from "./pass-criteria";
import type {
  CriteriaDraft,
  CriteriaRowLike,
} from "./pass-criteria";

function row(args: Partial<CriteriaRowLike> = {}): CriteriaRowLike {
  return {
    id: "rule-1",
    classId: null,
    minSubjectsToPass: null,
    mandatoryPassSubjectIds: [],
    graceMarksAllowed: false,
    maxGracePerSubject: null,
    maxGraceTotal: null,
    compartmentAllowed: false,
    maxSubjectsForCompartment: null,
    absentMandatoryFails: true,
    exemptRenormalizes: false,
    minAttendancePct: "75.00",
    ...args,
  };
}

function draft(args: Partial<CriteriaDraft> = {}): CriteriaDraft {
  return {
    minSubjectsToPass: "",
    mandatoryPassSubjectIds: [],
    graceMarksAllowed: false,
    maxGracePerSubject: "",
    maxGraceTotal: "",
    compartmentAllowed: false,
    maxSubjectsForCompartment: "",
    minAttendancePct: "75",
    absentMandatoryFails: true,
    exemptRenormalizes: false,
    ...args,
  };
}

describe("criteriaDraft", () => {
  it("starts a blank rule with the server's defaults", () => {
    expect(criteriaDraft(null)).toEqual(
      draft({ minAttendancePct: "75" }),
    );
  });

  it("reads a saved row back into form strings", () => {
    expect(
      criteriaDraft(
        row({
          minSubjectsToPass: 5,
          maxGracePerSubject: "5.00",
          maxGraceTotal: "10.50",
          maxSubjectsForCompartment: 2,
          minAttendancePct: "75.00",
        }),
      ),
    ).toEqual(
      draft({
        minSubjectsToPass: "5",
        maxGracePerSubject: "5",
        maxGraceTotal: "10.5",
        maxSubjectsForCompartment: "2",
        minAttendancePct: "75",
      }),
    );
  });

  it("an override starts from the default's values", () => {
    const school = row({
      minSubjectsToPass: 4,
      graceMarksAllowed: true,
      maxGracePerSubject: "5.00",
      maxGraceTotal: "8.00",
      compartmentAllowed: true,
      maxSubjectsForCompartment: 1,
      absentMandatoryFails: false,
      exemptRenormalizes: true,
      minAttendancePct: "70.00",
    });
    expect(criteriaDraftFromDefault(school)).toEqual(criteriaDraft(school));
  });
});

describe("criteriaErrors", () => {
  it("accepts a blank minimum and blank caps with both policies off", () => {
    expect(hasCriteriaErrors(criteriaErrors(draft()))).toBe(false);
  });

  it("refuses a minimum outside 1–50", () => {
    for (const value of ["0", "51", "1.5", "abc"]) {
      expect(criteriaErrors(draft({ minSubjectsToPass: value })).minSubjects).toBe(
        copy.exams.grading.criteria.minSubjectsError,
      );
    }
    expect(
      criteriaErrors(draft({ minSubjectsToPass: "50" })).minSubjects,
    ).toBeUndefined();
  });

  it("needs both grace caps when grace is on", () => {
    const both = criteriaErrors(draft({ graceMarksAllowed: true }));
    expect(both.gracePerSubject).toBe(
      copy.exams.grading.criteria.graceNeedsCaps,
    );
    expect(both.graceTotal).toBe(copy.exams.grading.criteria.graceNeedsCaps);

    const totalOnly = criteriaErrors(
      draft({ graceMarksAllowed: true, maxGracePerSubject: "5" }),
    );
    expect(totalOnly.gracePerSubject).toBeUndefined();
    expect(totalOnly.graceTotal).toBe(
      copy.exams.grading.criteria.graceNeedsCaps,
    );
  });

  it("refuses an out-of-range grace cap", () => {
    expect(
      criteriaErrors(
        draft({
          graceMarksAllowed: true,
          maxGracePerSubject: "101",
          maxGraceTotal: "10",
        }),
      ).gracePerSubject,
    ).toBe(copy.exams.grading.criteria.graceCapError);
  });

  it("needs a compartment cap of 1–20 when compartment is on", () => {
    for (const value of ["", "0", "21", "1.5"]) {
      expect(
        criteriaErrors(
          draft({ compartmentAllowed: true, maxSubjectsForCompartment: value }),
        ).compartmentCap,
      ).toBe(copy.exams.grading.criteria.compartmentCapError);
    }
    expect(
      criteriaErrors(
        draft({ compartmentAllowed: true, maxSubjectsForCompartment: "20" }),
      ).compartmentCap,
    ).toBeUndefined();
  });

  it("requires an attendance percentage", () => {
    for (const value of ["", "101", "abc"]) {
      expect(
        criteriaErrors(draft({ minAttendancePct: value })).attendance,
      ).toBe(copy.exams.grading.criteria.attendanceError);
    }
  });
});

describe("criteriaPayload", () => {
  it("canonicalises the create payload", () => {
    expect(
      criteriaPayload(
        draft({
          minSubjectsToPass: "5",
          mandatoryPassSubjectIds: ["s1", "s1", "s2"],
          graceMarksAllowed: true,
          maxGracePerSubject: "05.0",
          maxGraceTotal: "10",
          compartmentAllowed: true,
          maxSubjectsForCompartment: "2",
          minAttendancePct: "075.00",
        }),
        null,
      ),
    ).toEqual({
      classId: null,
      minSubjectsToPass: 5,
      mandatoryPassSubjectIds: ["s1", "s2"],
      graceMarksAllowed: true,
      maxGracePerSubject: "5",
      maxGraceTotal: "10",
      compartmentAllowed: true,
      maxSubjectsForCompartment: 2,
      absentMandatoryFails: true,
      exemptRenormalizes: false,
      minAttendancePct: "75",
    });
  });

  it("sends null for a policy that is off", () => {
    expect(criteriaPayload(draft(), "class-1")).toMatchObject({
      classId: "class-1",
      minSubjectsToPass: null,
      graceMarksAllowed: false,
      maxGracePerSubject: null,
      maxGraceTotal: null,
      compartmentAllowed: false,
      maxSubjectsForCompartment: null,
      minAttendancePct: "75",
    });
  });
});

describe("criteriaUpdatePayload", () => {
  it("sends nothing when nothing changed", () => {
    const saved = row({
      minSubjectsToPass: 5,
      mandatoryPassSubjectIds: ["s1"],
      graceMarksAllowed: true,
      maxGracePerSubject: "5.00",
      maxGraceTotal: "10.00",
      compartmentAllowed: true,
      maxSubjectsForCompartment: 2,
      minAttendancePct: "75.00",
    });
    expect(criteriaUpdatePayload(criteriaDraft(saved), saved)).toEqual({});
  });

  it("sends only the changed field", () => {
    expect(
      criteriaUpdatePayload(
        criteriaDraft(row({ minAttendancePct: "75.00" })),
        row({ minAttendancePct: "75.00" }),
      ),
    ).toEqual({});
    expect(
      criteriaUpdatePayload(
        draft({ minAttendancePct: "80" }),
        row({ minAttendancePct: "75.00" }),
      ),
    ).toEqual({ minAttendancePct: "80" });
    expect(
      criteriaUpdatePayload(draft({ minSubjectsToPass: "5" }), row()),
    ).toEqual({ minSubjectsToPass: 5 });
  });

  it("does not treat the same mandatory subjects in another order as a change", () => {
    const saved = row({ mandatoryPassSubjectIds: ["s1", "s2"] });
    const next = criteriaDraft(saved);
    next.mandatoryPassSubjectIds = ["s2", "s1"];
    expect(criteriaUpdatePayload(next, saved)).toEqual({});
  });

  it("toggling grace off leaves the caps in place", () => {
    const saved = row({
      graceMarksAllowed: true,
      maxGracePerSubject: "5.00",
      maxGraceTotal: "10.00",
    });
    const next = criteriaDraft(saved);
    next.graceMarksAllowed = false;
    expect(criteriaUpdatePayload(next, saved)).toEqual({
      graceMarksAllowed: false,
    });
  });

  it("sends a changed cap only while grace is on", () => {
    const saved = row({
      graceMarksAllowed: true,
      maxGracePerSubject: "5.00",
      maxGraceTotal: "10.00",
    });
    const next = criteriaDraft(saved);
    next.maxGraceTotal = "12";
    expect(criteriaUpdatePayload(next, saved)).toEqual({
      maxGraceTotal: "12",
    });
  });
});

describe("criteriaMeta", () => {
  it("describes a bare default row", () => {
    expect(criteriaMeta(row())).toEqual({
      line1: "All counted subjects · No grace · No compartment",
      line2:
        "Attendance 75% flags only · Absence can fail · Exempt papers score zero",
    });
  });

  it("names must-pass subjects, three at most", () => {
    const names = new Map([
      ["s1", "Maths"],
      ["s2", "Science"],
      ["s3", "English"],
      ["s4", "Hindi"],
    ]);
    const lookup = (id: string) => names.get(id) ?? null;

    expect(
      criteriaMeta(row({ mandatoryPassSubjectIds: ["s1", "s2"] }), lookup).line1,
    ).toBe("All counted subjects · Must pass Maths, Science · No grace · No compartment");

    expect(
      criteriaMeta(
        row({ mandatoryPassSubjectIds: ["s1", "s2", "s3", "s4"] }),
        lookup,
      ).line1,
    ).toContain("Must pass Maths, Science, English +1");

    // Names missing (the subject query failed) still say something true.
    expect(criteriaMeta(row({ mandatoryPassSubjectIds: ["s1"] })).line1).toBe(
      "All counted subjects · 1 must-pass subject · No grace · No compartment",
    );
  });

  it("describes a policy with every lever set", () => {
    expect(
      criteriaMeta(
        row({
          minSubjectsToPass: 5,
          graceMarksAllowed: true,
          maxGracePerSubject: "5.00",
          maxGraceTotal: "10.00",
          compartmentAllowed: true,
          maxSubjectsForCompartment: 2,
          absentMandatoryFails: false,
          exemptRenormalizes: true,
          minAttendancePct: "80.00",
        }),
      ),
    ).toEqual({
      line1: "At least 5 subjects · Grace 5 / 10 · Compartment 2",
      line2:
        "Attendance 80% flags only · Absence never auto-fails · Exempt papers leave the total",
    });
  });
});

describe("criteriaSummary", () => {
  const names = new Map([
    ["s1", "Maths"],
    ["s2", "Science"],
  ]);
  const nameOf = (id: string) => names.get(id) ?? null;

  it("summarises the quiet default", () => {
    expect(criteriaSummary(draft(), nameOf)).toEqual([
      "All counted subjects must pass",
      "No grace marks",
      "No compartment",
      "Below 75% is flagged, never blocked",
    ]);
  });

  it("summarises a stricter rule", () => {
    expect(
      criteriaSummary(
        draft({
          minSubjectsToPass: "5",
          mandatoryPassSubjectIds: ["s1"],
          graceMarksAllowed: true,
          maxGracePerSubject: "5",
          maxGraceTotal: "10",
          compartmentAllowed: true,
          maxSubjectsForCompartment: "2",
          minAttendancePct: "80",
        }),
        nameOf,
      ),
    ).toEqual([
      "At least 5 counted subjects must pass, including Maths",
      "Grace up to 5 per subject, 10 in total",
      "Up to 2 failed subjects can be compartmented",
      "Below 80% is flagged, never blocked",
    ]);
  });

  it("says a half-typed policy is unfinished rather than claiming one", () => {
    expect(
      criteriaSummary(
        draft({
          minSubjectsToPass: "0",
          graceMarksAllowed: true,
          compartmentAllowed: true,
          minAttendancePct: "",
        }),
      ),
    ).toEqual([
      "Minimum subjects still needed",
      "Grace marks — both caps still needed",
      "Compartment — cap still needed",
      "Attendance bar still needed",
    ]);
  });

  it("says one compartment subject in the singular", () => {
    expect(
      criteriaSummary(
        draft({ compartmentAllowed: true, maxSubjectsForCompartment: "1" }),
      )[2],
    ).toBe("1 failed subject can be compartmented");
  });
});

describe("scopes", () => {
  const classes = [
    { id: "c6", name: "Class 6" },
    { id: "c7", name: "Class 7" },
    { id: "c10", name: "Class 10" },
  ];

  it("offers the school default plus every class when nothing is covered", () => {
    expect(uncoveredScopes(classes, [])).toEqual([
      {
        id: "",
        label: "School default",
        detail: "Every class without its own rule",
      },
      { id: "c6", label: "Class 6", detail: "This class's own rule" },
      { id: "c7", label: "Class 7", detail: "This class's own rule" },
      { id: "c10", label: "Class 10", detail: "This class's own rule" },
    ]);
  });

  it("never offers a default that exists or a class that already overrides", () => {
    expect(
      uncoveredScopes(classes, [{ classId: null }, { classId: "c6" }]),
    ).toEqual([
      { id: "c7", label: "Class 7", detail: "This class's own rule" },
      { id: "c10", label: "Class 10", detail: "This class's own rule" },
    ]);
  });

  it("offers nothing when every scope is taken", () => {
    expect(
      uncoveredScopes(classes, [
        { classId: null },
        { classId: "c6" },
        { classId: "c7" },
        { classId: "c10" },
      ]),
    ).toEqual([]);
  });

  it("orders the list default first, then by class order", () => {
    const rows = [
      { id: "c10", classId: "c10" },
      { id: "default", classId: null },
      { id: "c6", classId: "c6" },
    ];
    expect(
      sortCriteriaRows(rows, (id) => (id === "c6" ? 6 : 10)).map(
        (entry) => entry.id,
      ),
    ).toEqual(["default", "c6", "c10"]);
    expect(criteriaCounts(rows)).toEqual({ defaults: 1, classes: 2 });
  });
});
