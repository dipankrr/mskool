import { beforeAll, describe, expect, it } from "vitest";

/**
 * THE ANNUAL RESULT (ADR-053) against REAL Postgres: the policy rows and
 * their guards, readiness reading the SAME paper resolver the compute uses,
 * a set-based generate (idempotent, upserting), renormalization for a
 * section that did not sit a paper, the publish gate, the V2 card, and the
 * frozen-after-publish guard.
 *
 * The annual engine reads exam-grain rows, so the fixture seeds
 * `student_subject_results` directly - the marks pipeline above them is
 * exam.integration's concern. Own org per run (hard rule 2: rows
 * accumulate; assertions key on this run's ids).
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  academicYears,
  classSubjectMappings,
  classes,
  examClassPublication,
  examSubjectSchedules,
  exams,
  organizations,
  publishedReportCards,
  schools,
  sections,
  studentEnrollments,
  studentFinalResults,
  studentFinalSubjectResults,
  studentSubjectResults,
  students,
  subjectTypes,
  subjects,
  terms,
  user,
} from "@repo/db/schema";
import { examAnnualService } from "@repo/services";
import { and, eq } from "drizzle-orm";

const RUN = `annual-itg-${Date.now()}`;
const PRINCIPAL = `itg-principal-${RUN}`;

interface World {
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  classId: string;
  sectionA: string;
  sectionB: string;
  termIds: [string, string, string];
  examIds: [string, string, string];
  maths: string;
  science: string;
  asha: string;
  ravi: string;
  meera: string;
}

let w: World;
const scopeOf = (over: Partial<DataScope> = {}): DataScope => ({
  organizationId: w.organizationId,
  schoolId: w.schoolId,
  classId: null,
  sectionId: null,
  ...over,
});

async function seedWorld(): Promise<World> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: "Annual ITG", legalName: "Annual ITG Trust", slug: RUN })
      .returning();
    const [school] = await tx
      .insert(schools)
      .values({ organizationId: org!.id, name: "Annual ITG School", legalName: "Annual ITG School", code: "AITG" })
      .returning();
    const base = { organizationId: org!.id, schoolId: school!.id };
    const [year] = await tx
      .insert(academicYears)
      .values({
        ...base,
        name: "2033-34",
        startDate: "2033-04-01",
        endDate: "2034-03-31",
        originalEndDate: "2034-03-31",
      })
      .returning();
    const termRows = await tx
      .insert(terms)
      .values(
        [1, 2, 3].map((n) => ({
          ...base,
          academicYearId: year!.id,
          name: `Term ${n}`,
          sequenceNumber: n,
          startDate: `2033-0${n * 2 + 2}-01`,
          endDate: `2033-0${n * 2 + 3}-28`,
        })),
      )
      .returning();
    const [klass] = await tx
      .insert(classes)
      .values({ ...base, name: "Annual Class 8", numericOrder: 8 })
      .returning();
    const [secA] = await tx
      .insert(sections)
      .values({ ...base, academicYearId: year!.id, classId: klass!.id, name: "A" })
      .returning();
    const [secB] = await tx
      .insert(sections)
      .values({ ...base, academicYearId: year!.id, classId: klass!.id, name: "B" })
      .returning();
    const [maths] = await tx.insert(subjects).values({ ...base, name: "Annual Maths" }).returning();
    const [science] = await tx.insert(subjects).values({ ...base, name: "Annual Science" }).returning();
    const [mainType] = await tx
      .insert(subjectTypes)
      .values({ ...base, name: "Main Subjects" })
      .returning();
    for (const s of [maths!, science!]) {
      await tx.insert(classSubjectMappings).values({
        ...base,
        academicYearId: year!.id,
        classId: klass!.id,
        subjectId: s.id,
        subjectTypeId: mainType!.id,
      });
    }

    const mkStudent = async (key: string, sectionId: string) => {
      const [s] = await tx
        .insert(students)
        .values({
          ...base,
          admissionNumber: `${RUN}-${key}`,
          firstName: key,
          lastName: "Itg",
          dateOfBirth: "2012-06-15",
          gender: "female",
        })
        .returning();
      await tx.insert(studentEnrollments).values({
        ...base,
        studentId: s!.id,
        academicYearId: year!.id,
        classId: klass!.id,
        sectionId,
      });
      return s!.id;
    };
    const asha = await mkStudent("Asha", secA!.id);
    const ravi = await mkStudent("Ravi", secA!.id);
    const meera = await mkStudent("Meera", secB!.id);

    await tx.insert(user).values({
      id: PRINCIPAL,
      name: "ITG Principal",
      email: `${RUN}-principal@test.local`,
      emailVerified: true,
    });

    // One counting exam per term. Maths is a class-wide paper every term;
    // Science is class-wide in Terms 1 and 3 but a SECTION A paper only in
    // Term 2 - section B does not sit it (ADR-052).
    const examIds: string[] = [];
    for (const [i, term] of termRows.entries()) {
      const [exam] = await tx
        .insert(exams)
        .values({
          ...base,
          academicYearId: year!.id,
          termId: term.id,
          name: `ITG Term ${i + 1} Exam`,
          createdBy: PRINCIPAL,
        })
        .returning();
      examIds.push(exam!.id);
      const paper = {
        ...base,
        examId: exam!.id,
        classId: klass!.id,
        examDate: `2033-0${(i + 1) * 2 + 3}-10`,
        startTime: "09:00:00",
        durationMinutes: 120,
        passMarks: "33.00",
      };
      await tx.insert(examSubjectSchedules).values({ ...paper, subjectId: maths!.id });
      await tx
        .insert(examSubjectSchedules)
        .values({ ...paper, subjectId: science!.id, sectionId: i === 1 ? secA!.id : null });
    }

    return {
      organizationId: org!.id,
      schoolId: school!.id,
      academicYearId: year!.id,
      classId: klass!.id,
      sectionA: secA!.id,
      sectionB: secB!.id,
      termIds: [termRows[0]!.id, termRows[1]!.id, termRows[2]!.id],
      examIds: [examIds[0]!, examIds[1]!, examIds[2]!],
      maths: maths!.id,
      science: science!.id,
      asha,
      ravi,
      meera,
    };
  });
}

async function seedResults(
  rows: { student: string; subject: string; term: 0 | 1 | 2; marks: number }[],
) {
  await db.insert(studentSubjectResults).values(
    rows.map((r) => ({
      organizationId: w.organizationId,
      schoolId: w.schoolId,
      studentId: r.student,
      examId: w.examIds[r.term],
      subjectId: r.subject,
      marksObtained: r.marks.toFixed(2),
      finalMarks: r.marks.toFixed(2),
      maxMarks: "100.00",
      passMarks: "33.00",
      isPassed: r.marks >= 33,
      countsTowardResult: true,
      isGradedOnly: false,
    })),
  );
}

const policyInput = (over: Record<string, unknown> = {}) =>
  ({
    academicYearId: w.academicYearId,
    classId: null,
    method: "weighted" as const,
    annualSubjectPassPercent: "33.00",
    terms: [
      { termId: w.termIds[0], weightage: "20.00" },
      { termId: w.termIds[1], weightage: "30.00" },
      { termId: w.termIds[2], weightage: "50.00" },
    ],
    useOwnPassRules: false,
    mandatoryPassSubjectIds: [],
    compartmentAllowed: false,
    totalDisplay: "average" as const,
    minAttendancePct: "75.00",
    ...over,
  }) as Parameters<typeof examAnnualService.savePolicy>[2];

beforeAll(async () => {
  w = await seedWorld();
});

describe("annual integration: the policy", () => {
  it("refuses to generate until the school has set its annual rules", async () => {
    await expect(
      examAnnualService.generate(scopeOf(), w.academicYearId, w.classId),
    ).rejects.toThrow(/Set the annual rules/);
    const readiness = await examAnnualService.readiness(scopeOf(), w.academicYearId, w.classId);
    expect(readiness?.policy).toBeNull();
    expect(readiness?.blockers.map((b) => b.code)).toContain("no_policy");
  });

  it("saves the school default and refuses a second one for the same scope", async () => {
    const saved = await examAnnualService.savePolicy(scopeOf(), PRINCIPAL, policyInput());
    expect(saved.summary).toBe("Weighted: Term 1 20% · Term 2 30% · Term 3 50% · subject pass 33%");
    expect(saved.terms).toHaveLength(3);
    await expect(
      examAnnualService.savePolicy(scopeOf(), PRINCIPAL, policyInput()),
    ).rejects.toThrow(/already has a default annual rule/);
  });

  it("refuses a term from another year and leaves the policy as it was", async () => {
    await expect(
      examAnnualService.savePolicy(
        scopeOf(),
        PRINCIPAL,
        policyInput({ id: undefined, classId: w.classId, terms: [{ termId: crypto.randomUUID(), weightage: "100.00" }] }),
      ),
    ).rejects.toThrow(/must belong to this academic year/);
    const list = await examAnnualService.listPolicies([scopeOf()], w.academicYearId);
    expect(list).toHaveLength(1);
  });
});

describe("annual integration: readiness reads the same papers the compute does", () => {
  it("blocks on papers a student sat that have no computed result, naming them", async () => {
    const readiness = await examAnnualService.readiness(scopeOf(), w.academicYearId, w.classId);
    const missing = readiness!.blockers.filter((b) => b.code === "missing_result");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((b) => /Annual Maths/.test(b.message))).toBe(true);
    expect(readiness!.publishBlockedReason).toBe("Generate the year first.");
  });
});

describe("annual integration: generate, review, publish", () => {
  beforeAll(async () => {
    await seedResults([
      // Asha: strong, full year.
      ...([70, 80, 90] as const).map((m, t) => ({ student: w.asha, subject: w.maths, term: t as 0 | 1 | 2, marks: m })),
      ...([60, 60, 60] as const).map((m, t) => ({ student: w.asha, subject: w.science, term: t as 0 | 1 | 2, marks: m })),
      // Ravi: fails Maths over the year.
      ...([20, 25, 30] as const).map((m, t) => ({ student: w.ravi, subject: w.maths, term: t as 0 | 1 | 2, marks: m })),
      ...([80, 80, 80] as const).map((m, t) => ({ student: w.ravi, subject: w.science, term: t as 0 | 1 | 2, marks: m })),
      // Meera (section B): full Maths, Science with NO Term 2 paper.
      ...([50, 50, 50] as const).map((m, t) => ({ student: w.meera, subject: w.maths, term: t as 0 | 1 | 2, marks: m })),
      { student: w.meera, subject: w.science, term: 0 as const, marks: 40 },
      { student: w.meera, subject: w.science, term: 2 as const, marks: 60 },
    ]);
  });

  it("has no blockers once every sat paper has a result, and flags the section that did not sit", async () => {
    const r = await examAnnualService.readiness(scopeOf(), w.academicYearId, w.classId);
    expect(r!.blockers).toEqual([]);
    expect(r!.warnings.map((x) => x.code)).toContain("no_paper_for_section");
    expect(r!.warnings.map((x) => x.code)).toContain("term_not_published");
    expect(r!.status).toBe("none");
  });

  it("generates the class in one go and renormalizes the student whose section did not sit", async () => {
    const out = await examAnnualService.generate(scopeOf(), w.academicYearId, w.classId);
    expect(out).toMatchObject({ generated: 3, promoted: 2, detained: 1, compartment: 0, renormalized: 1 });

    const table = await examAnnualService.table(scopeOf(), w.academicYearId, w.classId);
    expect(table!.status).toBe("draft");
    const by = Object.fromEntries(table!.students.map((s) => [s.name.split(" ")[0]!, s]));
    const sub = (name: string, subjectId: string) => by[name]!.subjects.find((x) => x.subjectId === subjectId)!;

    expect(sub("Asha", w.maths).percentage).toBe("83.00");
    expect(by.Asha).toMatchObject({ promotionStatus: "promoted", rankInClass: 1, rankInSection: 1 });
    expect(sub("Ravi", w.maths)).toMatchObject({ percentage: "26.50", isPassed: false });
    expect(by.Ravi).toMatchObject({ promotionStatus: "detained", failedSubjectIds: [w.maths] });

    // T1 40 (20) and T3 60 (50) renormalized over 70: 54.29.
    expect(sub("Meera", w.science)).toMatchObject({ percentage: "54.29", renormalized: true });
    expect(by.Meera).toMatchObject({ renormalized: true, termsUsed: 3 });
    const trail = sub("Meera", w.science).sources;
    expect(trail.find((t) => t.termId === w.termIds[1])).toMatchObject({ score: null, used: false });
    expect(trail.find((t) => t.termId === w.termIds[0])?.effectiveWeight).toBe("28.57");
  });

  it("is idempotent: generating again upserts the same rows", async () => {
    await examAnnualService.generate(scopeOf(), w.academicYearId, w.classId);
    const finals = await db
      .select({ id: studentFinalResults.id })
      .from(studentFinalResults)
      .where(eq(studentFinalResults.academicYearId, w.academicYearId));
    const subjectRows = await db
      .select({ id: studentFinalSubjectResults.id })
      .from(studentFinalSubjectResults)
      .where(eq(studentFinalSubjectResults.academicYearId, w.academicYearId));
    expect(finals).toHaveLength(3);
    expect(subjectRows).toHaveLength(6);
  });

  it("will not publish while the term exams are unpublished, and says which", async () => {
    await expect(
      examAnnualService.publishClass(scopeOf(), PRINCIPAL, w.academicYearId, w.classId),
    ).rejects.toThrow(/Publish the term results first/);
    expect(
      await db.select().from(publishedReportCards).where(eq(publishedReportCards.academicYearId, w.academicYearId)),
    ).toHaveLength(0);
  });

  it("previews the annual card as a draft before it is published", async () => {
    const card = await examAnnualService.card(scopeOf(), w.academicYearId, w.classId, w.asha);
    expect(card?.status).toBe("draft");
    const snap = card!.snapshotData as { snapshotVersion: number; verdict: { promotionStatus: string }; terms: unknown[] };
    expect(snap.snapshotVersion).toBe(2);
    expect(snap.verdict.promotionStatus).toBe("promoted");
    expect(snap.terms).toHaveLength(3);
  });

  it("publishes the class once the term exams are published, as version-2 annual cards", async () => {
    await db.insert(examClassPublication).values(
      w.examIds.map((examId) => ({
        organizationId: w.organizationId,
        schoolId: w.schoolId,
        examId,
        classId: w.classId,
        publishedBy: PRINCIPAL,
      })),
    );
    const ready = await examAnnualService.readiness(scopeOf(), w.academicYearId, w.classId);
    expect(ready!.publishBlockedReason).toBeNull();

    const out = await examAnnualService.publishClass(scopeOf(), PRINCIPAL, w.academicYearId, w.classId);
    expect(out).toEqual({ published: 3, skipped: 0 });

    const cards = await db
      .select()
      .from(publishedReportCards)
      .where(and(eq(publishedReportCards.academicYearId, w.academicYearId)));
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.termId === null && c.snapshotVersion === 2 && c.isCurrent && c.version === 1)).toBe(true);

    const card = await examAnnualService.card(scopeOf(), w.academicYearId, w.classId, w.ravi);
    expect(card).toMatchObject({ status: "published", version: 1 });
  });

  it("freezes the class: generating or publishing again is refused", async () => {
    await expect(
      examAnnualService.generate(scopeOf(), w.academicYearId, w.classId),
    ).rejects.toThrow(/published and frozen/);
    await expect(
      examAnnualService.publishClass(scopeOf(), PRINCIPAL, w.academicYearId, w.classId),
    ).rejects.toThrow(/Already published/);
    const r = await examAnnualService.readiness(scopeOf(), w.academicYearId, w.classId);
    expect(r!.status).toBe("published");
  });
});

describe("annual integration: tenancy", () => {
  it("answers null - never another school's rows - for a foreign scope", async () => {
    const foreign = scopeOf({ schoolId: crypto.randomUUID() });
    expect(await examAnnualService.table(foreign, w.academicYearId, w.classId)).toBeNull();
    expect(await examAnnualService.readiness(foreign, w.academicYearId, w.classId)).toBeNull();
    expect(await examAnnualService.generate(foreign, w.academicYearId, w.classId)).toBeNull();
  });
});
