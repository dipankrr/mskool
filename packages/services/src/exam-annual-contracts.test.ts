import { reportCardSnapshot, saveAnnualPolicyInput } from "@repo/contracts";
import { describe, expect, it } from "vitest";

/**
 * THE ANNUAL CONTRACTS (ADR-053): the cross-field rules a policy must meet
 * before it reaches the service, and the card union every reader depends on.
 */

const YEAR = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222221";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "22222222-2222-4222-8222-222222222223";

const base = {
  academicYearId: YEAR,
  classId: null,
  method: "weighted" as const,
  annualSubjectPassPercent: "33",
  terms: [
    { termId: T1, weightage: "20" },
    { termId: T2, weightage: "30" },
    { termId: T3, weightage: "50" },
  ],
};

const messages = (input: unknown) => {
  const result = saveAnnualPolicyInput.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe("saveAnnualPolicyInput", () => {
  it("accepts weights that total exactly 100", () => {
    expect(saveAnnualPolicyInput.safeParse(base).success).toBe(true);
  });

  it("applies the defaults a minimal payload leaves out", () => {
    const parsed = saveAnnualPolicyInput.parse(base);
    expect(parsed).toMatchObject({
      totalDisplay: "average",
      useOwnPassRules: false,
      compartmentAllowed: false,
      mandatoryPassSubjectIds: [],
      minAttendancePct: "75.00",
    });
  });

  it("refuses weights that do not total 100 and says by how much they miss", () => {
    const out = messages({ ...base, terms: [{ termId: T1, weightage: "20" }, { termId: T2, weightage: "30" }, { termId: T3, weightage: "40" }] });
    expect(out).toContain("The weights add up to 90% - they must total exactly 100%.");
  });

  it("refuses a weighted term with no weight", () => {
    expect(messages({ ...base, terms: [{ termId: T1, weightage: "100" }, { termId: T2 }] })).toContain(
      "Give every picked term a weight.",
    );
  });

  it("refuses the same term twice", () => {
    expect(
      messages({ ...base, terms: [{ termId: T1, weightage: "50" }, { termId: T1, weightage: "50" }] }),
    ).toContain("A term can be picked only once.");
  });

  it("needs exactly one term for a one-term rule", () => {
    const one = { ...base, method: "single_term" as const, terms: [{ termId: T3 }] };
    expect(saveAnnualPolicyInput.safeParse(one).success).toBe(true);
    expect(messages({ ...one, terms: [{ termId: T2 }, { termId: T3 }] })).toContain("Pick exactly one term.");
  });

  it("needs a count for best-N that fits the picked terms, and only then", () => {
    const best = { ...base, method: "best_n" as const, terms: [{ termId: T1 }, { termId: T2 }, { termId: T3 }] };
    expect(saveAnnualPolicyInput.safeParse({ ...best, bestN: 2 }).success).toBe(true);
    expect(messages(best)).toContain("Say how many terms count.");
    expect(messages({ ...best, bestN: 4 })).toContain("Only 3 terms are picked - N cannot be 4.");
    expect(messages({ ...base, bestN: 2 })).toContain("Only the best-N method uses a count.");
  });

  it("allows a printed sum only when the terms are added up", () => {
    const best = { ...base, method: "best_n" as const, bestN: 3, terms: [{ termId: T1 }, { termId: T2 }, { termId: T3 }] };
    expect(saveAnnualPolicyInput.safeParse({ ...best, totalDisplay: "sum" }).success).toBe(true);
    expect(messages({ ...base, totalDisplay: "sum" })).toContain(
      "A printed sum only makes sense when the terms are added up (best N).",
    );
  });

  it("needs a subject cap when its own rules allow a compartment", () => {
    expect(messages({ ...base, useOwnPassRules: true, compartmentAllowed: true })).toContain(
      "A compartment rule needs a subject cap.",
    );
    expect(
      saveAnnualPolicyInput.safeParse({ ...base, useOwnPassRules: true, compartmentAllowed: true, maxSubjectsForCompartment: 2 })
        .success,
    ).toBe(true);
  });

  it("refuses a pass mark outside 0-100", () => {
    expect(messages({ ...base, annualSubjectPassPercent: "101" })).toContain("Use a percentage between 0 and 100.");
  });
});

const v1 = {
  snapshotVersion: 1,
  student: { name: "A", admissionNumber: "1", className: "8", sectionName: null, rollNumber: null },
  school: { name: "S" },
  academicYear: { name: "2026-27" },
  term: null,
  subjects: [],
  totals: {
    totalMarks: null,
    maxMarks: null,
    percentage: null,
    grade: null,
    gradePoint: null,
    isPassed: null,
    rankInSection: null,
    rankInClass: null,
  },
  attendance: null,
  termAssessments: [],
  generatedAt: "2026-10-30T00:00:00.000Z",
};

const v2 = {
  snapshotVersion: 2,
  kind: "annual",
  student: v1.student,
  school: v1.school,
  academicYear: v1.academicYear,
  policy: { method: "weighted", totalDisplay: "average", annualSubjectPassPercent: "33.00", summary: "Weighted" },
  terms: [],
  subjects: [],
  totals: { ...v1.totals, isPassed: true },
  verdict: { promotionStatus: "promoted", failedSubjects: [], compartmentSubjects: [], renormalized: false },
  attendance: null,
  generatedAt: v1.generatedAt,
};

describe("reportCardSnapshot (the union every reader meets)", () => {
  it("accepts both versions", () => {
    expect(reportCardSnapshot.safeParse(v1).success).toBe(true);
    expect(reportCardSnapshot.safeParse(v2).success).toBe(true);
  });

  it("tells them apart by snapshotVersion", () => {
    expect(reportCardSnapshot.parse(v1).snapshotVersion).toBe(1);
    expect(reportCardSnapshot.parse(v2).snapshotVersion).toBe(2);
  });

  it("refuses a version it does not know, rather than guessing", () => {
    expect(reportCardSnapshot.safeParse({ ...v2, snapshotVersion: 3 }).success).toBe(false);
    expect(reportCardSnapshot.safeParse({ ...v2, kind: "term" }).success).toBe(false);
  });
});
