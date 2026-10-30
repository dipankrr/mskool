import {
  annualDraft,
  annualDirty,
  annualErrors,
  annualPayload,
  annualSummary,
  asAnnualSnapshot,
  snapshotVersionOf,
  equalWeights,
  filterCounts,
  filterStudents,
  firstAnnualError,
  hasAnnualErrors,
  presetOf,
  policyCounts,
  policyPromotionLine,
  renormalizedNote,
  scoreAgainstBar,
  sortPolicies,
  sortStudents,
  togglePick,
  uncoveredPolicyScopes,
  verdictCountsLine,
  verdictInWords,
  weightTotal,
  withPreset,
} from "./annual";
import type { AnnualPolicyRowLike, AnnualStudentLike, TermLite } from "./annual";

const terms: TermLite[] = [
  { id: "t1", name: "Term 1", sequenceNumber: 1 },
  { id: "t2", name: "Term 2", sequenceNumber: 2 },
  { id: "t3", name: "Term 3", sequenceNumber: 3 },
];

function row(over: Partial<AnnualPolicyRowLike> = {}): AnnualPolicyRowLike {
  return {
    id: "p1",
    classId: null,
    method: "weighted",
    bestN: null,
    totalDisplay: "average",
    annualSubjectPassPercent: "33.00",
    useOwnPassRules: false,
    minSubjectsToPass: null,
    mandatoryPassSubjectIds: [],
    compartmentAllowed: false,
    maxSubjectsForCompartment: null,
    minAttendancePct: "75.00",
    terms: [
      { termId: "t1", weightage: "20.00" },
      { termId: "t2", weightage: "30.00" },
      { termId: "t3", weightage: "50.00" },
    ],
    summary: "",
    ...over,
  };
}

const where = { academicYearId: "y1", classId: null };

describe("equalWeights", () => {
  it("splits to exactly 100 with the remainder on the last term", () => {
    expect(equalWeights(3)).toEqual(["33.33", "33.33", "33.34"]);
    expect(equalWeights(2)).toEqual(["50", "50"]);
    expect(equalWeights(0)).toEqual([]);
  });
});

describe("annualDraft", () => {
  it("opens a first rule as weighted over every term with an equal split", () => {
    const draft = annualDraft(null, terms);
    expect(draft.preset).toBe("weighted");
    expect(draft.picked).toEqual(["t1", "t2", "t3"]);
    expect(weightTotal(draft)).toBe(10000);
    expect(draft.passPercent).toBe("");
  });

  it("reads a saved rule back into its preset", () => {
    expect(presetOf(row())).toBe("weighted");
    expect(presetOf(row({ method: "single_term", terms: [{ termId: "t3", weightage: null }] }))).toBe("single");
    const three = [1, 2, 3].map((n) => ({ termId: `t${n}`, weightage: null }));
    expect(presetOf(row({ method: "best_n", bestN: 3, terms: three }))).toBe("average");
    expect(presetOf(row({ method: "best_n", bestN: 3, totalDisplay: "sum", terms: three }))).toBe("sum");
    expect(presetOf(row({ method: "best_n", bestN: 2, terms: three }))).toBe("best");
  });

  it("starts a class rule as a copy of the school default", () => {
    const draft = annualDraft(null, terms, row({ annualSubjectPassPercent: "35.00" }));
    expect(draft.passPercent).toBe("35");
    expect(draft.weights.t3).toBe("50");
  });
});

describe("annualErrors", () => {
  const base = () => ({ ...annualDraft(null, terms), passPercent: "33" });

  it("accepts a complete weighted rule", () => {
    expect(hasAnnualErrors(annualErrors(base()))).toBe(false);
  });

  it("says the weights must total 100 and by how much they miss", () => {
    const draft = { ...base(), weights: { t1: "20", t2: "30", t3: "40" } };
    expect(annualErrors(draft).weights).toBe("The weights add up to 90% - they must total exactly 100%.");
  });

  it("asks for a weight on every picked term", () => {
    const draft = { ...base(), weights: { t1: "50", t2: "50", t3: "" } };
    expect(annualErrors(draft).weights).toBe("Give every picked term a weight.");
  });

  it("treats the year pass mark as optional, but refuses a nonsense one", () => {
    expect(annualErrors({ ...base(), passPercent: "" }).pass).toBeUndefined();
    expect(annualErrors({ ...base(), passPercent: "101" }).pass).toBe(
      "Enter a pass mark between 0 and 100, or leave it blank.",
    );
    expect(annualErrors({ ...base(), passPercent: "abc" }).pass).toBeTruthy();
  });

  it("needs best-N to fit the picked terms", () => {
    const best = { ...withPreset(base(), "best", terms), bestN: "4" };
    expect(annualErrors(best).bestN).toBe("Only 3 terms are picked.");
    expect(annualErrors({ ...best, bestN: "" }).bestN).toBe("Say how many terms count.");
    expect(annualErrors({ ...best, bestN: "2" }).bestN).toBeUndefined();
  });

  it("needs exactly one term for a one-term rule", () => {
    const single = withPreset(base(), "single", terms);
    expect(single.picked).toEqual(["t3"]);
    expect(hasAnnualErrors(annualErrors(single))).toBe(false);
  });

  it("checks the own-rules block only when it is in use", () => {
    const off = { ...base(), rules: { ...base().rules, minSubjectsToPass: "99" } };
    expect(hasAnnualErrors(annualErrors(off))).toBe(false);
    const on = { ...off, useOwnRules: true };
    expect(annualErrors(on).minSubjects).toBeTruthy();
    const comp = { ...on, rules: { ...on.rules, minSubjectsToPass: "", compartmentAllowed: true } };
    expect(annualErrors(comp).compartmentCap).toBeTruthy();
  });

  it("reports the first problem in reading order", () => {
    const errors = annualErrors({ ...base(), passPercent: "", picked: [] });
    expect(firstAnnualError(errors)).toBe("Pick at least one term.");
  });
});

describe("annualPayload", () => {
  const draft = () => ({ ...annualDraft(null, terms), passPercent: "33" });

  it("sends weighted as weighted with each weight", () => {
    const p = annualPayload(draft(), where);
    expect(p).toMatchObject({ method: "weighted", bestN: null, totalDisplay: "average", annualSubjectPassPercent: "33" });
    expect(p.terms).toEqual([
      { termId: "t1", weightage: "33.33" },
      { termId: "t2", weightage: "33.33" },
      { termId: "t3", weightage: "33.34" },
    ]);
  });

  it("stores Average and Sum as best-N over every picked term", () => {
    const avg = annualPayload(withPreset(draft(), "average", terms), where);
    expect(avg).toMatchObject({ method: "best_n", bestN: 3, totalDisplay: "average" });
    expect(avg.terms.every((t) => t.weightage === null)).toBe(true);
    expect(annualPayload(withPreset(draft(), "sum", terms), where)).toMatchObject({
      method: "best_n",
      bestN: 3,
      totalDisplay: "sum",
    });
  });

  it("stores One term and Best N", () => {
    expect(annualPayload(withPreset(draft(), "single", terms), where)).toMatchObject({
      method: "single_term",
      bestN: null,
      terms: [{ termId: "t3", weightage: null }],
    });
    const best = { ...withPreset(draft(), "best", terms), bestN: "2" };
    expect(annualPayload(best, where)).toMatchObject({ method: "best_n", bestN: 2 });
  });

  it("sends no pass mark when it is left blank, so the papers' own pass marks decide", () => {
    expect(annualPayload({ ...draft(), passPercent: "" }, where).annualSubjectPassPercent).toBeNull();
    expect(annualPayload({ ...draft(), passPercent: "  " }, where).annualSubjectPassPercent).toBeNull();
  });

  it("sends an own-rules block only when it is on", () => {
    const off = annualPayload({ ...draft(), rules: { ...draft().rules, minSubjectsToPass: "4" } }, where);
    expect(off).toMatchObject({ useOwnPassRules: false, minSubjectsToPass: null, compartmentAllowed: false });
    const on = annualPayload(
      {
        ...draft(),
        useOwnRules: true,
        rules: {
          minSubjectsToPass: "4",
          mandatoryPassSubjectIds: ["maths"],
          compartmentAllowed: true,
          maxSubjectsForCompartment: "2",
          minAttendancePct: "80",
        },
      },
      { ...where, id: "p1" },
    );
    expect(on).toMatchObject({
      id: "p1",
      useOwnPassRules: true,
      minSubjectsToPass: 4,
      mandatoryPassSubjectIds: ["maths"],
      compartmentAllowed: true,
      maxSubjectsForCompartment: 2,
      minAttendancePct: "80",
    });
  });
});

describe("annualDirty", () => {
  it("is clean for an untouched draft and dirty after an edit", () => {
    const r = row();
    const draft = annualDraft(r, terms);
    expect(annualDirty(draft, r)).toBe(false);
    expect(annualDirty({ ...draft, passPercent: "40" }, r)).toBe(true);
    expect(annualDirty(togglePick(draft, "t1", terms), r)).toBe(true);
  });

  it("ignores formatting-only differences in a percentage", () => {
    const r = row();
    const draft = annualDraft(r, terms);
    expect(annualDirty({ ...draft, passPercent: "33.0" }, r)).toBe(false);
  });
});

describe("togglePick", () => {
  it("adds in term order and keeps single-term to one pick", () => {
    const draft = { ...annualDraft(null, terms), picked: ["t1", "t3"] };
    expect(togglePick(draft, "t2", terms).picked).toEqual(["t1", "t2", "t3"]);
    const single = withPreset(draft, "single", terms);
    expect(togglePick(single, "t1", terms).picked).toEqual(["t1"]);
  });
});

describe("annualSummary", () => {
  it("reads the three lines live", () => {
    const draft = { ...annualDraft(null, terms), weights: { t1: "20", t2: "30", t3: "50" }, passPercent: "33" };
    expect(annualSummary(draft, terms, "Pass 5 of 6")).toEqual([
      "Weighted: Term 1 20% · Term 2 30% · Term 3 50%",
      "A subject passes with 33% or more for the year.",
      "Pass 5 of 6",
    ]);
  });

  it("says the papers' pass marks decide when no fixed pass mark is set", () => {
    const draft = { ...annualDraft(null, terms), passPercent: "" };
    expect(annualSummary(draft, terms, null)[1]).toBe(
      "A subject passes the year when it reaches the pass marks of its own papers.",
    );
  });

  it("describes the other methods and its own rules", () => {
    const base = { ...annualDraft(null, terms), passPercent: "33" };
    expect(annualSummary(withPreset(base, "average", terms), terms, null)[0]).toBe("Average of 3 terms");
    expect(annualSummary(withPreset(base, "single", terms), terms, null)[0]).toBe("Term 3 is the year");
    expect(annualSummary({ ...withPreset(base, "best", terms), bestN: "2" }, terms, null)[0]).toBe(
      "Best 2 of 3 terms for each subject",
    );
    const own = {
      ...base,
      useOwnRules: true,
      rules: { ...base.rules, minSubjectsToPass: "5", compartmentAllowed: true, maxSubjectsForCompartment: "2" },
    };
    expect(annualSummary(own, terms, null)[2]).toBe("At least 5 subjects must pass · compartment up to 2 subjects");
  });
});

describe("policyPromotionLine", () => {
  it("says whose rules decide promotion", () => {
    expect(policyPromotionLine(row())).toBe("Promotion follows the term pass rules");
    expect(
      policyPromotionLine(
        row({ useOwnPassRules: true, minSubjectsToPass: 5, compartmentAllowed: true, maxSubjectsForCompartment: 2 }),
      ),
    ).toBe("At least 5 subjects must pass · compartment up to 2 subjects");
  });
});

describe("rule list helpers", () => {
  it("counts, orders and finds uncovered scopes", () => {
    const rows = [
      { id: "b", classId: "c2" },
      { id: "a", classId: null },
      { id: "c", classId: "c1" },
    ];
    expect(policyCounts(rows)).toEqual({ defaults: 1, classes: 2 });
    expect(sortPolicies(rows, (id) => (id === "c1" ? 1 : 2)).map((r) => r.id)).toEqual(["a", "c", "b"]);
    const classes = [
      { id: "c1", name: "Class 1" },
      { id: "c2", name: "Class 2" },
      { id: "c3", name: "Class 3" },
    ];
    expect(uncoveredPolicyScopes(classes, rows).map((o) => o.id)).toEqual(["c3"]);
    expect(uncoveredPolicyScopes(classes, []).map((o) => o.id)).toEqual(["", "c1", "c2", "c3"]);
  });
});

const student = (over: Partial<AnnualStudentLike> = {}): AnnualStudentLike => ({
  studentId: "s",
  name: "Asha",
  rollNumber: "1",
  sectionName: "A",
  promotionStatus: "promoted",
  failedSubjectIds: [],
  renormalized: false,
  rankInClass: 1,
  subjects: [],
  ...over,
});

describe("class list helpers", () => {
  const list = [
    student({ studentId: "1", name: "Zed", rollNumber: "10", sectionName: "A" }),
    student({ studentId: "2", name: "Amy", rollNumber: "2", sectionName: "A", promotionStatus: "detained", failedSubjectIds: ["m"] }),
    student({ studentId: "3", name: "Bo", rollNumber: "1", sectionName: "B", promotionStatus: "compartment", failedSubjectIds: ["m"] }),
    student({ studentId: "4", name: "Cy", rollNumber: null, sectionName: "B", renormalized: true }),
    student({ studentId: "5", name: "Di", sectionName: "B", subjects: [{ isExempted: true, renormalized: false }] }),
  ];

  it("filters and counts", () => {
    expect(filterStudents(list, "detained").map((s) => s.studentId)).toEqual(["2"]);
    expect(filterStudents(list, "compartment").map((s) => s.studentId)).toEqual(["3"]);
    expect(filterStudents(list, "flagged").map((s) => s.studentId)).toEqual(["4", "5"]);
    expect(filterCounts(list)).toEqual({ all: 5, detained: 1, compartment: 1, flagged: 2 });
  });

  it("sorts by section, then roll number as a number, then name", () => {
    expect(sortStudents(list).map((s) => s.studentId)).toEqual(["2", "1", "3", "4", "5"]);
  });

  it("prints the class-scoped count line, leaving out zero buckets", () => {
    expect(verdictCountsLine(list)).toBe("3 promoted · 1 compartment · 1 detained");
    expect(verdictCountsLine([student()])).toBe("1 promoted");
  });
});

describe("verdictInWords", () => {
  const name = (id: string) => ({ m: "Maths", s: "Science", e: "English" })[id] ?? "a subject";

  it("explains each verdict", () => {
    expect(verdictInWords(student(), name)).toBe("Passed every counted subject.");
    expect(verdictInWords(student({ promotionStatus: "promoted", failedSubjectIds: ["m"] }), name)).toBe(
      "Did not pass Maths, which the promotion rules allow.",
    );
    expect(verdictInWords(student({ promotionStatus: "compartment", failedSubjectIds: ["m", "s"] }), name)).toBe(
      "Did not pass Maths and Science. Promoted on compartment: these subjects are re-attempted.",
    );
    expect(verdictInWords(student({ promotionStatus: "detained", failedSubjectIds: ["m", "s", "e"] }), name)).toBe(
      "Did not pass Maths, Science and English. The promotion rules do not allow moving up.",
    );
    expect(verdictInWords(student({ promotionStatus: "detained" }), name)).toBe("Did not meet the promotion rules.");
  });
});

describe("verdictInWords - with the bars", () => {
  const name = (id: string) => ({ m: "Maths", s: "Science" })[id] ?? "a subject";
  const detail = (id: string) => scoreAgainstBar(id === "m" ? "31.00" : "29.50", "33.00");

  it("says what each failed subject scored against its bar", () => {
    expect(
      verdictInWords({ promotionStatus: "detained", failedSubjectIds: ["m", "s"] }, name, detail),
    ).toBe(
      "Did not pass Maths (31 against 33) and Science (29.5 against 33). The promotion rules do not allow moving up.",
    );
  });

  it("has no detail when a bar is unknown", () => {
    expect(scoreAgainstBar(null, "33.00")).toBeNull();
    expect(scoreAgainstBar("31.00", null)).toBeNull();
  });
});

describe("renormalizedNote", () => {
  it("names the terms used and their effective weights", () => {
    const sources = [
      { termId: "t1", used: true, effectiveWeight: "28.57" },
      { termId: "t2", used: false, effectiveWeight: "0.00" },
      { termId: "t3", used: true, effectiveWeight: "71.43" },
    ];
    const name = (id: string) => ({ t1: "Term 1", t2: "Term 2", t3: "Term 3" })[id] ?? id;
    expect(renormalizedNote(sources, name, 3)).toBe("Counted from 2 of 3 terms (Term 1 28.57%, Term 3 71.43%).");
  });
});

describe("asAnnualSnapshot", () => {
  const card = {
    snapshotVersion: 2,
    kind: "annual",
    student: {},
    school: {},
    academicYear: {},
    policy: {},
    totals: {},
    verdict: { failedSubjects: [] },
    terms: [],
    subjects: [{ byTerm: [] }],
  };

  it("accepts a version-2 annual card", () => {
    expect(asAnnualSnapshot(card)).not.toBeNull();
  });

  it("refuses a term card, a newer version, and anything malformed", () => {
    expect(asAnnualSnapshot({ ...card, snapshotVersion: 1 })).toBeNull();
    expect(asAnnualSnapshot({ ...card, snapshotVersion: 3 })).toBeNull();
    expect(asAnnualSnapshot({ ...card, subjects: [{}] })).toBeNull();
    expect(asAnnualSnapshot(null)).toBeNull();
    expect(asAnnualSnapshot("card")).toBeNull();
  });

  it("reads the version without trusting the rest", () => {
    expect(snapshotVersionOf({ snapshotVersion: 3 })).toBe(3);
    expect(snapshotVersionOf({})).toBeNull();
    expect(snapshotVersionOf(undefined)).toBeNull();
  });
});
