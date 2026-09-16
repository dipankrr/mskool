import { beforeAll, describe, expect, it } from "vitest";

/**
 * EXAMS — the integrity proofs, against REAL Postgres (the fees integration
 * precedent). The property suite pins the pure maths; this file pins what
 * only the database and the services can vouch for:
 *
 *   - the lifecycle state machine: illegal moves refused with reasons, the
 *     coverage and entry gates bite;
 *   - the autosave optimistic guard: a stale expectedUpdatedAt is refused
 *     (two writers, one cell — no lost update);
 *   - publication: the readiness gate, the frozen photographs (version 1,
 *     is_current), the per-class release record, and the exam flipping to
 *     published on its last class;
 *   - hard rule 7: the revision LEDGER ROW lands before the mark moves, the
 *     chain recomputes, and only the card whose data changed is re-versioned;
 *   - the portal door: ownership-scoped reads of published cards only;
 *   - tenancy: a foreign scope sees nothing (null, never a leak).
 *
 * FIXTURE ISOLATION (the fees lesson): this file builds its OWN org (slug
 * `exams-itg-<ts>`) with minimal inserts; rows accumulate by design (hard
 * rule 2) — every exact assertion keys on this run's ids.
 */

import { db } from "@repo/db";
import {
  academicYears,
  classSubjectMappings,
  classes,
  examClassPublication,
  examComponents,
  examSubjectSchedules,
  exams,
  gradingScaleBands,
  gradingScales,
  organizations,
  passCriteria,
  publishedReportCards,
  sections,
  studentComponentResultRevisions,
  studentComponentResults,
  studentEnrollments,
  studentSubjectResults,
  studentTermResults,
  subjects,
  subjectTypes,
  terms,
  user,
  schools,
  students,
} from "@repo/db/schema";
import type { DataScope } from "@repo/authz";
import {
  examConfigService,
  examMarksService,
  examResultsService,
} from "@repo/services";
import { and, eq } from "drizzle-orm";

const RUN = `exams-itg-${Date.now()}`;
const PRINCIPAL = `itg-principal-${RUN}`;
const scopeOf = (w: World): DataScope => ({
  organizationId: w.organizationId,
  schoolId: w.schoolId,
  classId: null,
  sectionId: null,
});

interface World {
  organizationId: string;
  schoolId: string;
  academicYearId: string;
  termId: string;
  classId: string;
  sectionId: string;
  studentA: string;
  studentB: string;
  subjectId: string;
  examId: string;
  scheduleId: string;
  componentId: string;
}

let world: World;

// The real fixture — written with the drizzle builder end to end.
async function seedWorld(): Promise<World> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: "Exams ITG", legalName: "Exams ITG Trust", slug: RUN })
      .returning();
    const [school] = await tx
      .insert(schools)
      .values({ organizationId: org!.id, name: "Exams ITG School", legalName: "Exams ITG School", code: "EITG" })
      .returning();
    const [year] = await tx
      .insert(academicYears)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        name: "2031-32",
        startDate: "2031-04-01",
        endDate: "2032-03-31",
        originalEndDate: "2032-03-31",
      })
      .returning();
    const [term] = await tx
      .insert(terms)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        academicYearId: year!.id,
        name: "Term 1",
        sequenceNumber: 1,
        startDate: "2031-04-01",
        endDate: "2031-09-30",
      })
      .returning();
    const [klass] = await tx
      .insert(classes)
      .values({ organizationId: org!.id, schoolId: school!.id, name: "ITG Class 8", numericOrder: 8 })
      .returning();
    const [section] = await tx
      .insert(sections)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        academicYearId: year!.id,
        classId: klass!.id,
        name: "A",
      })
      .returning();
    const [subject] = await tx
      .insert(subjects)
      .values({ organizationId: org!.id, schoolId: school!.id, name: "ITG Mathematics" })
      .returning();

    const [studentA] = await tx
      .insert(students)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        admissionNumber: `${RUN}-A`,
        firstName: "Student",
        lastName: "A",
        dateOfBirth: "2012-06-15",
        gender: "female",
      })
      .returning();
    const [studentB] = await tx
      .insert(students)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        admissionNumber: `${RUN}-B`,
        firstName: "Student",
        lastName: "B",
        dateOfBirth: "2012-07-16",
        gender: "male",
      })
      .returning();

    for (const s of [studentA!, studentB!]) {
      await tx.insert(studentEnrollments).values({
        organizationId: org!.id,
        schoolId: school!.id,
        studentId: s.id,
        academicYearId: year!.id,
        classId: klass!.id,
        sectionId: section!.id,
      });
    }

    const [mainType] = await tx
      .insert(subjectTypes)
      .values({ organizationId: org!.id, schoolId: school!.id, name: "Main Subjects" })
      .returning();
    await tx.insert(subjectTypes).values({
      organizationId: org!.id,
      schoolId: school!.id,
      name: "Personality",
      countsTowardResult: false,
      isGradedOnly: true,
      assessmentMode: "term_grade",
      sequence: 2,
    });

    const [scale] = await tx
      .insert(gradingScales)
      .values({ organizationId: org!.id, schoolId: school!.id, name: "ITG Scale", isDefault: true })
      .returning();
    await tx.insert(gradingScaleBands).values([
      {
        organizationId: org!.id,
        schoolId: school!.id,
        gradingScaleId: scale!.id,
        minMarks: "0.00",
        maxMarks: "100.00",
        gradeLabel: "A",
        gradePoint: "10.00",
        sequenceNumber: 1,
      },
    ]);

    await tx.insert(classSubjectMappings).values({
      organizationId: org!.id,
      schoolId: school!.id,
      academicYearId: year!.id,
      classId: klass!.id,
      subjectId: subject!.id,
      subjectTypeId: mainType!.id,
    });

    await tx.insert(passCriteria).values({
      organizationId: org!.id,
      schoolId: school!.id,
      academicYearId: year!.id,
      classId: null,
    });

    const [principal] = await tx
      .insert(user)
      .values({
        id: PRINCIPAL,
        name: "ITG Principal",
        email: `${RUN}-principal@test.local`,
        emailVerified: true,
      })
      .returning();

    const [exam] = await tx
      .insert(exams)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        academicYearId: year!.id,
        termId: term!.id,
        name: "ITG Term 1 Final",
        createdBy: principal!.id,
      })
      .returning();
    const [schedule] = await tx
      .insert(examSubjectSchedules)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        examId: exam!.id,
        classId: klass!.id,
        subjectId: subject!.id,
        examDate: "2031-09-10",
        startTime: "09:00:00",
        durationMinutes: 180,
        passMarks: "33.00",
      })
      .returning();
    const [component] = await tx
      .insert(examComponents)
      .values({
        organizationId: org!.id,
        schoolId: school!.id,
        scheduleId: schedule!.id,
        name: "Theory",
        maxMarks: "100.00",
        passMarks: "33.00",
        weightagePercentage: "100.00",
      })
      .returning();

    return {
      organizationId: org!.id,
      schoolId: school!.id,
      academicYearId: year!.id,
      termId: term!.id,
      classId: klass!.id,
      sectionId: section!.id,
      studentA: studentA!.id,
      studentB: studentB!.id,
      subjectId: subject!.id,
      examId: exam!.id,
      scheduleId: schedule!.id,
      componentId: component!.id,
    };
  });
}

beforeAll(async () => {
  world = await seedWorld();
});

describe("exams integration: the lifecycle state machine", () => {
  it("refuses to schedule an exam with no coverage gaps and walks the legal path", async () => {
    const scope = scopeOf(world);

    // draft -> ongoing is illegal (must be scheduled first).
    await expect(
      examConfigService.transition(scope, { id: world.examId, target: "ongoing" }),
    ).rejects.toThrow(/Cannot move an exam from draft to ongoing/);

    const scheduled = await examConfigService.transition(scope, {
      id: world.examId,
      target: "scheduled",
    });
    expect(scheduled?.status).toBe("scheduled");

    // scheduled -> marks_entry skips two states — refused.
    await expect(
      examConfigService.transition(scope, { id: world.examId, target: "marks_entry" }),
    ).rejects.toThrow(/Cannot move an exam from scheduled to marks_entry/);

    await examConfigService.transition(scope, { id: world.examId, target: "ongoing" });
    const entry = await examConfigService.transition(scope, {
      id: world.examId,
      target: "marks_entry",
    });
    expect(entry?.status).toBe("marks_entry");
  });
});

describe("exams integration: the autosave cell", () => {
  it("creates lazily, then refuses a stale writer (no lost update)", async () => {
    const scope = scopeOf(world);
    // The gate pair the router checks: this section, this subject.
    const base = {
      examId: world.examId,
      scheduleId: world.scheduleId,
      componentId: world.componentId,
      sectionId: world.sectionId,
      subjectId: world.subjectId,
      isAbsent: false,
      isExempted: false,
    };

    const first = await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...base,
      studentId: world.studentA,
      marks: "72",
    });
    expect(first?.resultStatus).toBe("entered");
    expect(first?.marksObtained).toBe("72.00");

    // A SECOND writer saved after `first` was read: the stale writer loses,
    // worded for the teacher, and the newer value stands.
    const second = await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...base,
      studentId: world.studentA,
      marks: "75",
    });
    await expect(
      examMarksService.saveComponentResult(scope, PRINCIPAL, {
        ...base,
        studentId: world.studentA,
        marks: "80",
        expectedUpdatedAt: first!.updatedAt.toISOString(),
      }),
    ).rejects.toThrow(/changed while you were typing/);

    const [row] = await db
      .select()
      .from(studentComponentResults)
      .where(
        and(
          eq(studentComponentResults.studentId, world.studentA),
          eq(studentComponentResults.componentId, world.componentId),
        ),
      );
    expect(row?.marksObtained).toBe("75.00");
    void second;
  });

  it("absence is a flag, not a zero — an absent row carries no mark", async () => {
    const scope = scopeOf(world);
    const saved = await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      examId: world.examId,
      scheduleId: world.scheduleId,
      componentId: world.componentId,
      sectionId: world.sectionId,
      subjectId: world.subjectId,
      studentId: world.studentB,
      isAbsent: true,
      isExempted: false,
    });
    expect(saved?.isAbsent).toBe(true);
    expect(saved?.marksObtained).toBeNull();
    expect(saved?.resultStatus).toBe("entered");
  });

  it("binds the gate pair to the paper and the student to the section", async () => {
    const scope = scopeOf(world);
    const pair = { sectionId: world.sectionId, subjectId: world.subjectId };
    const cell = {
      examId: world.examId,
      scheduleId: world.scheduleId,
      componentId: world.componentId,
    };

    // Wrong subject: a gate pair from one paper never writes another.
    const wrongSubject = await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...cell,
      ...pair,
      subjectId: crypto.randomUUID(),
      studentId: world.studentA,
      marks: "10",
      isAbsent: false,
      isExempted: false,
    });
    expect(wrongSubject).toBeNull();

    // Cross-exam: this examId paired with that paper's schedule.
    const crossExam = await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...cell,
      ...pair,
      examId: crypto.randomUUID(),
      studentId: world.studentA,
      marks: "10",
      isAbsent: false,
      isExempted: false,
    });
    expect(crossExam).toBeNull();

    // A student no enrollment covers: outside this paper's cohort.
    const outsider = await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...cell,
      ...pair,
      studentId: crypto.randomUUID(),
      marks: "10",
      isAbsent: false,
      isExempted: false,
    });
    expect(outsider).toBeNull();

    // Verify binds the same way: the entered row verifies under its own
    // pair, and a foreign pair is refused before any row moves.
    const [row] = await db
      .select()
      .from(studentComponentResults)
      .where(
        and(
          eq(studentComponentResults.studentId, world.studentA),
          eq(studentComponentResults.componentId, world.componentId),
        ),
      );
    const verified = await examMarksService.verifyComponentResults(scope, PRINCIPAL, {
      componentResultIds: [row!.id],
      ...pair,
    });
    expect(verified.find((r) => r.id === row!.id)?.resultStatus).toBe("verified");
    await expect(
      examMarksService.verifyComponentResults(scope, PRINCIPAL, {
        componentResultIds: [row!.id],
        sectionId: world.sectionId,
        subjectId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/stated subject/);
  });

  it("the entry grid returns the roster and the entries in one read; a foreign scope sees nothing", async () => {
    const grid = await examMarksService.entryGrid(
      scopeOf(world),
      world.examId,
      world.scheduleId,
    );
    expect(grid).not.toBeNull();
    expect(grid!.roster.map((r) => r.studentId).sort()).toEqual(
      [world.studentA, world.studentB].sort(),
    );
    expect(grid!.components.length).toBeGreaterThanOrEqual(1);
    // The entries saved by the cases above are visible, keyed per student.
    const byStudent = new Map(grid!.entries.map((e) => [e.studentId, e]));
    expect(byStudent.get(world.studentA)?.marksObtained).toBe("75.00");
    expect(byStudent.get(world.studentB)?.isAbsent).toBe(true);

    const foreign = await examMarksService.entryGrid(
      {
        organizationId: crypto.randomUUID(),
        schoolId: crypto.randomUUID(),
        classId: null,
        sectionId: null,
      },
      world.examId,
      world.scheduleId,
    );
    expect(foreign).toBeNull();
  });
});

describe("exams integration: compute, publish, and the frozen photographs", () => {
  it("computes, ranks, publishes per class, and freezes the cards", async () => {
    const scope = scopeOf(world);

    // Per-component grading override (the ICSE case, ADR-032 §5): the part
    // gets its OWN grade on ITS scale — stamped onto the component result,
    // beside the marks. Bands land "Star" at ≥50 so the assertion
    // can never be satisfied by the default scale's lone "A". Labels stay within varchar(10).
    const [overrideScale] = await db
      .insert(gradingScales)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        name: "Override Scale",
        isDefault: false,
      })
      .returning();
    await db.insert(gradingScaleBands).values([
      {
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        gradingScaleId: overrideScale!.id,
        minMarks: "0.00",
        maxMarks: "50.00",
        gradeLabel: "Pass",
        sequenceNumber: 1,
      },
      {
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        gradingScaleId: overrideScale!.id,
        minMarks: "50.00",
        maxMarks: "100.00",
        gradeLabel: "Star",
        sequenceNumber: 2,
      },
    ]);
    await db
      .update(examComponents)
      .set({ gradingScaleId: overrideScale!.id })
      .where(eq(examComponents.id, world.componentId));

    // Entry complete (A: 72, B: absent) -> verification may open.
    const verification = await examConfigService.transition(scope, {
      id: world.examId,
      target: "under_verification",
    });
    expect(verification?.status).toBe("under_verification");

    const computed = await examResultsService.computeClassResults(scope, world.examId, world.classId);
    expect(computed).toHaveLength(2);

    // A's 75/100 grades "Star" on the override scale, beside the
    // marks; absent B has nothing to grade. The SUBJECT's grade ("A") is
    // still the default scale's — the override is additive.
    const stamped = await db
      .select()
      .from(studentComponentResults)
      .where(eq(studentComponentResults.componentId, world.componentId));
    const aComponent = stamped.find((r) => r.studentId === world.studentA);
    const bComponent = stamped.find((r) => r.studentId === world.studentB);
    expect(aComponent?.gradeObtained).toBe("Star");
    expect(bComponent?.gradeObtained ?? null).toBeNull();

    const subjects = await db
      .select()
      .from(studentSubjectResults)
      .where(eq(studentSubjectResults.examId, world.examId));
    const aResult = subjects.find((s) => s.studentId === world.studentA);
    const bResult = subjects.find((s) => s.studentId === world.studentB);
    // A's surviving mark is 75 — the SECOND writer won the concurrency test
    // above (the stale one was refused). The compute is honest about it.
    expect(aResult?.marksObtained).toBe("75.00");
    expect(aResult?.finalMarks).toBe("75.00");
    expect(aResult?.isPassed).toBe(true);
    expect(aResult?.grade).toBe("A");
    // Absence is not zero for DISPLAY, but it is zero's effect on the math.
    expect(bResult?.finalMarks).toBe("0.00");
    expect(bResult?.isPassed).toBe(false);
    expect(bResult?.isAbsent).toBe(true);

    await examResultsService.computeTermRanks(scope, world.termId);
    // Term ranks are the reporting rank (ADR-032): subject-level ranks stay
    // null until a rank computation targets them.
    const [termA] = await db
      .select()
      .from(studentTermResults)
      .where(eq(studentTermResults.studentId, world.studentA));
    expect(termA?.rankInSection).toBe(1);

    // Publish the one class: cards freeze, release record lands, exam flips.
    const published = await examResultsService.publishClass(scope, PRINCIPAL, world.examId, world.classId);
    expect(published?.published).toBe(true);

    const [exam] = await db.select().from(exams).where(eq(exams.id, world.examId));
    expect(exam?.status).toBe("published");

    const cards = await db
      .select()
      .from(publishedReportCards)
      .where(eq(publishedReportCards.academicYearId, world.academicYearId));
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.version === 1 && c.isCurrent)).toBe(true);

    const [publication] = await db
      .select()
      .from(examClassPublication)
      .where(eq(examClassPublication.examId, world.examId));
    expect(publication?.state).toBe("published");
  });

  it("the portal door returns the family's cards and nothing else", async () => {
    const own = await examResultsService.listOwnedCards([world.studentA]);
    expect(own).toHaveLength(1);
    expect(own[0]!.studentId).toBe(world.studentA);
    expect(own[0]!.isCurrent).toBe(true);

    // The other child's card is not readable through A's ownership.
    const foreign = await examResultsService.getOwnedCard([world.studentA], own[0]!.id);
    expect(foreign?.id).toBe(own[0]!.id);
    // The other child's card is NOT readable through B's ownership.
    const notMine = await examResultsService.getOwnedCard([world.studentB], own[0]!.id);
    expect(notMine).toBeNull();
  });
});

describe("exams integration: hard rule 7 — the correction ledger", () => {
  it("writes the ledger row first, recomputes, and re-photographs only the changed card", async () => {
    const scope = scopeOf(world);

    // B was absent; the office later records the approved mark 35 (pass at 33).
    const applied = await examResultsService.applyRevision(scope, PRINCIPAL, {
      id: (
        await db
          .select()
          .from(studentComponentResults)
          .where(eq(studentComponentResults.studentId, world.studentB))
      )[0]!.id,
      revisedMarks: "35",
      revisionType: "data_entry_error",
      reason: "absence was recorded in error; the sat mark is 35",
    });
    expect(applied?.applied).toBe(true);

    // The LEDGER: previous value preserved, reason and approver recorded.
    // Keyed to THIS run's org — rows accumulate by design across runs.
    const revisions = await db
      .select({ rev: studentComponentResultRevisions })
      .from(studentComponentResultRevisions)
      .innerJoin(
        examClassPublication,
        eq(examClassPublication.examId, world.examId),
      )
      .where(eq(studentComponentResultRevisions.originalResultId, applied!.componentResultId));
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    expect(revisions[0]!.rev.previousStatus).toBe("published");
    expect(revisions[0]!.rev.previousMarks ?? null).toBeNull();

    // B's chain recomputed: pass, rank 1 now (35 > A's 72? no — A still leads).
    const [bSubject] = await db
      .select()
      .from(studentSubjectResults)
      .where(eq(studentSubjectResults.studentId, world.studentB));
    expect(bSubject?.finalMarks).toBe("35.00");
    expect(bSubject?.isPassed).toBe(true);

    // The CARD: B's card was re-photographed (v2); A's data did not move, so
    // A's card keeps version 1 — the minimal-re-issue property.
    const bCard = await db
      .select()
      .from(publishedReportCards)
      .where(eq(publishedReportCards.studentId, world.studentB));
    const bCurrent = bCard.find((c) => c.isCurrent)!;
    expect(bCurrent.version).toBe(2);
    expect(bCurrent.replacesVersion).toBe(1);

    const aCards = await db
      .select()
      .from(publishedReportCards)
      .where(eq(publishedReportCards.studentId, world.studentA));
    expect(aCards).toHaveLength(1);
    expect(aCards[0]!.version).toBe(1);
  });

  it("windows accumulate without recompute; close re-issues once; windows reopen", async () => {
    const scope = scopeOf(world);

    // Open a window on the published class (reopenable states only).
    const opened = await examResultsService.openRevisionWindow(
      scope,
      PRINCIPAL,
      world.examId,
      world.classId,
    );
    expect(opened?.state).toBe("revision_open");

    // Correct A's mark inside the window: ledgered + mark updated, but NO
    // recompute — the card stays v1 and the aggregate stays 75.
    const [aRow] = await db
      .select()
      .from(studentComponentResults)
      .where(
        and(
          eq(studentComponentResults.studentId, world.studentA),
          eq(studentComponentResults.componentId, world.componentId),
        ),
      );
    const queued = await examResultsService.applyRevision(scope, PRINCIPAL, {
      id: aRow!.id,
      revisedMarks: "80",
      revisionType: "marks_correction",
      reason: "re-evaluation raised the mark to 80",
    });
    expect(queued?.applied).toBe(true);

    const [staleSubject] = await db
      .select()
      .from(studentSubjectResults)
      .where(eq(studentSubjectResults.studentId, world.studentA));
    expect(staleSubject?.finalMarks).toBe("75.00");
    const aCardsBefore = await db
      .select()
      .from(publishedReportCards)
      .where(eq(publishedReportCards.studentId, world.studentA));
    expect(aCardsBefore.filter((c) => c.isCurrent)).toHaveLength(1);
    expect(aCardsBefore.find((c) => c.isCurrent)!.version).toBe(1);

    // Close: one recompute, ranks once, the moved card re-versioned.
    const closed = await examResultsService.closeRevisionWindow(
      scope,
      PRINCIPAL,
      world.examId,
      world.classId,
    );
    expect(closed!.reIssued).toBeGreaterThanOrEqual(1);
    const [freshSubject] = await db
      .select()
      .from(studentSubjectResults)
      .where(eq(studentSubjectResults.studentId, world.studentA));
    expect(freshSubject?.finalMarks).toBe("80.00");
    const aCardsAfter = await db
      .select()
      .from(publishedReportCards)
      .where(eq(publishedReportCards.studentId, world.studentA));
    expect(aCardsAfter.find((c) => c.isCurrent)!.version).toBe(2);

    // A second correction is possible: the window reopens from re_issued,
    // and an empty close re-issues nothing.
    const reopened = await examResultsService.openRevisionWindow(
      scope,
      PRINCIPAL,
      world.examId,
      world.classId,
    );
    expect(reopened?.state).toBe("revision_open");
    const emptyClose = await examResultsService.closeRevisionWindow(
      scope,
      PRINCIPAL,
      world.examId,
      world.classId,
    );
    expect(emptyClose!.reIssued).toBe(0);
    // Slow on a cloud DB by design: open + apply + full single-tx close
    // (compute + ranks + snapshots) + reopen + close brushes the 30s
    // default, so this test carries its own budget.
  }, 120_000);
});

describe("exams config: locks and defaults", () => {
  it("a used scale refuses band edits but renames, switches default atomically, and locks types with data", async () => {
    const scope = scopeOf(world);

    // The fixture's default scale graded real results — bands frozen.
    const scales = await examConfigService.listGradingScales([scope]);
    const current = scales.find((s) => s.isDefault)!;
    await expect(
      examConfigService.replaceGradingScaleBands(scope, current.id, {
        bands: [{ minMarks: "0", maxMarks: "100", gradeLabel: "Z" }],
      }),
    ).rejects.toThrow(/locked/);
    const renamed = await examConfigService.updateGradingScale(scope, current.id, {
      name: "ITG Scale Renamed",
    });
    expect(renamed?.name).toBe("ITG Scale Renamed");

    // A new scale becomes default in one swap; exactly one default remains.
    const fresh = await examConfigService.createGradingScale(scope, {
      name: "ITG Scale 2",
      isDefault: false,
      bands: [{ minMarks: "0", maxMarks: "100", gradeLabel: "P" }],
    });
    const switched = await examConfigService.makeDefaultGradingScale(scope, fresh!.id);
    expect(switched?.isDefault).toBe(true);
    const after = await examConfigService.listGradingScales([scope]);
    expect(after.find((s) => s.id === current.id)?.isDefault).toBe(false);
    expect(after.filter((s) => s.isDefault)).toHaveLength(1);

    // The Main type backs assessed mappings — flagged locked, flags refuse.
    const types = await examConfigService.listSubjectTypes([scope]);
    const main = types.find((t) => t.name === "Main Subjects")!;
    expect(main.hasAssessmentData).toBe(true);
    await expect(
      examConfigService.updateSubjectType(scope, main.id, { isGradedOnly: true }),
    ).rejects.toThrow(/locked/);
    const renamedType = await examConfigService.updateSubjectType(scope, main.id, {
      name: "Main Subjects Renamed",
    });
    expect(renamedType?.name).toBe("Main Subjects Renamed");
  });
});

describe("exams integration: tenancy", () => {
  it("a foreign scope resolves nothing — null, never a leak", async () => {
    const foreignScope: DataScope = {
      organizationId: crypto.randomUUID(),
      schoolId: crypto.randomUUID(),
      classId: null,
      sectionId: null,
    };
    const owner = await examConfigService.getExamOwnerId(foreignScope.organizationId, world.examId);
    expect(owner).toBeNull();

    const updated = await examConfigService.updateExam(foreignScope, world.examId, { name: "hijacked" });
    expect(updated).toBeNull();

    const results = await examResultsService.computeClassResults(foreignScope, world.examId, world.classId);
    expect(results).toBeNull();
  });
});

describe("exams integration: results integrity (B1 snapshot, B2 published guard)", () => {
  it("snapshots the weighted default pass mark on component save; an explicit override survives", async () => {
    const scope = scopeOf(world);

    const [worldMapping] = await db
      .select()
      .from(classSubjectMappings)
      .where(
        and(
          eq(classSubjectMappings.classId, world.classId),
          eq(classSubjectMappings.subjectId, world.subjectId),
        ),
      );
    const [physics] = await db
      .insert(subjects)
      .values({ organizationId: world.organizationId, schoolId: world.schoolId, name: "ITG Physics" })
      .returning();
    await db.insert(classSubjectMappings).values({
      organizationId: world.organizationId,
      schoolId: world.schoolId,
      academicYearId: world.academicYearId,
      classId: world.classId,
      subjectId: physics!.id,
      subjectTypeId: worldMapping!.subjectTypeId,
    });
    const [paper] = await db
      .insert(examSubjectSchedules)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        examId: world.examId,
        classId: world.classId,
        subjectId: physics!.id,
        examDate: "2031-09-11",
        startTime: "09:00:00",
        durationMinutes: 180,
      })
      .returning();
    expect(paper?.passMarks).toBe("0.00");

    // 30% of (21/70) + 70% of (9/30) = 9.00 + 21.00 = 30.00.
    const saved = await examConfigService.saveComponents(scope, {
      id: paper!.id,
      components: [
        { name: "Theory", maxMarks: "70", passMarks: "21", weightagePercentage: "30" },
        { name: "Practical", maxMarks: "30", passMarks: "9", weightagePercentage: "70" },
      ],
    });
    expect(saved).toHaveLength(2);

    const [snapshotted] = await db
      .select()
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.id, paper!.id));
    expect(snapshotted?.passMarks).toBe("30.00");

    // The school overrides ("at least 40 total") — arranged directly, since
    // the schedule save freezes once entry opens. The unit under test is the
    // component save's preservation: restructuring the parts afterwards must
    // not recompute the school's word away.
    await db
      .update(examSubjectSchedules)
      .set({ passMarks: "40.00" })
      .where(eq(examSubjectSchedules.id, paper!.id));
    await examConfigService.saveComponents(scope, {
      id: paper!.id,
      components: [
        { name: "Theory", maxMarks: "70", passMarks: "21", weightagePercentage: "30" },
        { name: "Practical", maxMarks: "30", passMarks: "9", weightagePercentage: "70" },
      ],
    });
    const [kept] = await db
      .select()
      .from(examSubjectSchedules)
      .where(eq(examSubjectSchedules.id, paper!.id));
    expect(kept?.passMarks).toBe("40.00");
  });

  it("refuses ad-hoc recompute on a published exam (the window close and revisions still run)", async () => {
    const scope = scopeOf(world);
    const [exam] = await db.select().from(exams).where(eq(exams.id, world.examId));
    expect(exam?.status).toBe("published");

    await expect(
      examResultsService.computeClassResults(scope, world.examId, world.classId),
    ).rejects.toThrow(/published/);
  });
});

describe("exams integration: multi-exam term (M4 GPA, M5 boundary, M6 card flags)", () => {
  it("weights every exam's grade point, grades boundaries upper-wins, and honours exemptions on the card", async () => {
    const scope = scopeOf(world);

    // Term weights 60/40 across the two counting exams.
    await db
      .update(exams)
      .set({ weightageInTerm: "60.00" })
      .where(eq(exams.id, world.examId));
    const [second] = await db
      .insert(exams)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        academicYearId: world.academicYearId,
        termId: world.termId,
        name: "ITG Term 1 Second",
        countsTowardTermResult: true,
        weightageInTerm: "40.00",
        createdBy: PRINCIPAL,
      })
      .returning();

    const [physics] = await db
      .select()
      .from(subjects)
      .where(
        and(eq(subjects.schoolId, world.schoolId), eq(subjects.name, "ITG Physics")),
      );
    const [overrideScale] = await db
      .select()
      .from(gradingScales)
      .where(
        and(eq(gradingScales.schoolId, world.schoolId), eq(gradingScales.name, "Override Scale")),
      );

    const [mathsPaper] = await db
      .insert(examSubjectSchedules)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        examId: second!.id,
        classId: world.classId,
        subjectId: world.subjectId,
        examDate: "2031-10-05",
        startTime: "09:00:00",
        durationMinutes: 180,
        passMarks: "33.00",
      })
      .returning();
    const [physicsPaper] = await db
      .insert(examSubjectSchedules)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        examId: second!.id,
        classId: world.classId,
        subjectId: physics!.id,
        examDate: "2031-10-06",
        startTime: "09:00:00",
        durationMinutes: 120,
      })
      .returning();
    const [mathsPart] = await db
      .insert(examComponents)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        scheduleId: mathsPaper!.id,
        name: "Theory",
        maxMarks: "100.00",
        passMarks: "33.00",
        weightagePercentage: "100.00",
      })
      .returning();
    const [physicsPart] = await db
      .insert(examComponents)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        scheduleId: physicsPaper!.id,
        name: "Theory",
        maxMarks: "50.00",
        passMarks: "15.00",
        weightagePercentage: "100.00",
        gradingScaleId: overrideScale!.id,
      })
      .returning();

    await examConfigService.transition(scope, { id: second!.id, target: "scheduled" });
    await examConfigService.transition(scope, { id: second!.id, target: "ongoing" });
    await examConfigService.transition(scope, { id: second!.id, target: "marks_entry" });

    const cell = {
      examId: second!.id,
      sectionId: world.sectionId,
      isAbsent: false,
      isExempted: false,
    };
    // A: maths 35 (B band @8.00), physics 20/50 (40%, Pass on the override).
    await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...cell,
      scheduleId: mathsPaper!.id,
      componentId: mathsPart!.id,
      subjectId: world.subjectId,
      studentId: world.studentA,
      marks: "35",
    });
    await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...cell,
      scheduleId: physicsPaper!.id,
      componentId: physicsPart!.id,
      subjectId: physics!.id,
      studentId: world.studentA,
      marks: "20",
    });
    // B: maths exempted (no mark), physics exactly on the 50% boundary.
    await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...cell,
      scheduleId: mathsPaper!.id,
      componentId: mathsPart!.id,
      subjectId: world.subjectId,
      studentId: world.studentB,
      isExempted: true,
      exemptionType: "medical",
    });
    await examMarksService.saveComponentResult(scope, PRINCIPAL, {
      ...cell,
      scheduleId: physicsPaper!.id,
      componentId: physicsPart!.id,
      subjectId: physics!.id,
      studentId: world.studentB,
      marks: "25",
    });

    await examConfigService.transition(scope, { id: second!.id, target: "under_verification" });

    // C sits in class 9, so 8-A's cohort is still exactly A and B.
    const computed = await examResultsService.computeClassResults(scope, second!.id, world.classId);
    expect(computed).toHaveLength(2);

    // M5: 40% grades Pass; exactly-50% grades Star (upper-wins), deterministically.
    const stamped = await db
      .select()
      .from(studentComponentResults)
      .where(eq(studentComponentResults.componentId, physicsPart!.id));
    expect(stamped.find((r) => r.studentId === world.studentA)?.gradeObtained).toBe("Pass");
    expect(stamped.find((r) => r.studentId === world.studentB)?.gradeObtained).toBe("Star");

    // The term aggregates both exams by pure maths, independent of bands.
    // A's first-exam mark is 80, not 75 — the window test re-evaluated it —
    // so (80×60 + 35×40)/100 = 62.00 maths, (40×100)/100 = 40.00 physics,
    // term percentage (62 + 40)/2 = 51.00, everything passing.
    const [termA] = await db
      .select()
      .from(studentTermResults)
      .where(
        and(
          eq(studentTermResults.studentId, world.studentA),
          eq(studentTermResults.termId, world.termId),
        ),
      );
    expect(termA?.percentage).toBe("51.00");
    expect(termA?.isPassed).toBe(true);

    // M6 on the frozen card: maths carries both exams (62.00);
    // B's maths is exempted in the second exam, so the card excuses it.
    // Version +1 from whatever the revision tests left: earlier cases
    // re-issued these cards, so no absolute number is asserted.
    const aBefore = await examResultsService.listOwnedCards([world.studentA], world.academicYearId);
    const aWas = aBefore.find((c) => c.isCurrent)!;
    await examResultsService.publishClass(scope, PRINCIPAL, second!.id, world.classId);
    const aCards = await examResultsService.listOwnedCards([world.studentA], world.academicYearId);
    const aCurrent = aCards.find((c) => c.isCurrent)!;
    expect(aCurrent.version).toBe(aWas.version + 1);
    const aMaths = (aCurrent.snapshotData as any).subjects.find(
      (s: any) => s.subjectId === world.subjectId,
    );
    expect(aMaths.marksObtained).toBe("62.00");
    expect(aMaths.isExempted).toBe(false);

    const bCards = await examResultsService.listOwnedCards([world.studentB], world.academicYearId);
    const bCurrent = bCards.find((c) => c.isCurrent)!;
    const bMaths = (bCurrent.snapshotData as any).subjects.find(
      (s: any) => s.subjectId === world.subjectId,
    );
    expect(bMaths.isExempted).toBe(true);
    expect(bMaths.marksObtained).toBeNull();
    // Slow on a loaded DB by design: three transitions + four entries +
    // compute + publish + card reads brush the 30s default, so this test
    // carries its own budget (the windows-test precedent).
  }, 120_000);

  it("M4: a graded-only term weights every exam's grade point, not the first vote", async () => {
    // A third student in their OWN class taking ONLY a graded-only counted
    // subject: the term aggregate runs the GPA branch, where each subject's
    // grade point must combine its exam votes. The separate class keeps C
    // out of 8-A's cohort (compute counts, publish completeness gate) and
    // keeps 8-A's subjects out of C's subject set. Votes are arranged
    // directly — no writer in the product produces multi-exam graded votes
    // yet, which is exactly why the first-vote shortcut survived unnoticed.
    // Own order: classes are unique per (school, numeric_order).
    const [classB] = await db
      .insert(classes)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        name: "ITG Class 9",
        numericOrder: 9,
      })
      .returning();
    const [studentC] = await db
      .insert(students)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        admissionNumber: `${RUN}-C`,
        firstName: "Student",
        lastName: "C",
        dateOfBirth: "2012-08-17",
        gender: "female",
      })
      .returning();
    await db.insert(studentEnrollments).values({
      organizationId: world.organizationId,
      schoolId: world.schoolId,
      studentId: studentC!.id,
      academicYearId: world.academicYearId,
      classId: classB!.id,
      sectionId: null,
    });
    const [artType] = await db
      .insert(subjectTypes)
      .values({
        organizationId: world.organizationId,
        schoolId: world.schoolId,
        name: "ITG Graded Art",
        countsTowardResult: true,
        isGradedOnly: true,
      })
      .returning();
    const [art] = await db
      .insert(subjects)
      .values({ organizationId: world.organizationId, schoolId: world.schoolId, name: "ITG Art" })
      .returning();
    await db.insert(classSubjectMappings).values({
      organizationId: world.organizationId,
      schoolId: world.schoolId,
      academicYearId: world.academicYearId,
      classId: classB!.id,
      subjectId: art!.id,
      subjectTypeId: artType!.id,
    });

    const vote = (examId: string, gradePoint: string) => ({
      organizationId: world.organizationId,
      schoolId: world.schoolId,
      studentId: studentC!.id,
      examId,
      subjectId: art!.id,
      maxMarks: "100.00",
      passMarks: "0.00",
      finalMarks: "80.00",
      isPassed: true,
      grade: "A",
      gradePoint,
      countsTowardResult: true,
      isGradedOnly: true,
    });
    // Scoped to this run's org: rows accumulate across runs by design, and
    // an unscoped name lookup can return a previous run's exam (whose id no
    // term query in this run will ever match — a silent zero-weight vote).
    const [second] = await db
      .select()
      .from(exams)
      .where(
        and(
          eq(exams.organizationId, world.organizationId),
          eq(exams.name, "ITG Term 1 Second"),
        ),
      );
    await db.insert(studentSubjectResults).values([
      vote(world.examId, "10.00"),
      vote(second!.id, "8.00"),
    ]);

    await examResultsService.computeTermResult(
      db,
      studentC!.id,
      world.termId,
      world.schoolId,
      world.organizationId,
    );
    const [termC] = await db
      .select()
      .from(studentTermResults)
      .where(
        and(
          eq(studentTermResults.studentId, studentC!.id),
          eq(studentTermResults.termId, world.termId),
        ),
      );
    // (10.00×60 + 8.00×40)/100 = 9.20 — the first vote's 10.00 would prove
    // the shortcut survived.
    expect(termC?.gradePoint).toBe("9.20");
  });
});

describe("exams integration: term-grade binding (M1)", () => {
  it("writes through the bound mapping; misses and mismatches write nothing", async () => {
    const scope = scopeOf(world);

    const [gradeType] = await db
      .select()
      .from(subjectTypes)
      .where(
        and(
          eq(subjectTypes.schoolId, world.schoolId),
          eq(subjectTypes.assessmentMode, "term_grade"),
        ),
      );
    const [music] = await db
      .insert(subjects)
      .values({ organizationId: world.organizationId, schoolId: world.schoolId, name: "ITG Music" })
      .returning();
    await db.insert(classSubjectMappings).values({
      organizationId: world.organizationId,
      schoolId: world.schoolId,
      academicYearId: world.academicYearId,
      classId: world.classId,
      subjectId: music!.id,
      subjectTypeId: gradeType!.id,
    });
    const [mapping] = await db
      .select()
      .from(classSubjectMappings)
      .where(
        and(
          eq(classSubjectMappings.classId, world.classId),
          eq(classSubjectMappings.subjectId, music!.id),
        ),
      );

    const base = {
      mappingId: mapping!.id,
      termId: world.termId,
      sectionId: world.sectionId,
      subjectId: music!.id,
      studentId: world.studentA,
      grade: "A",
      descriptor: "Steady across the term",
    };

    // Happy path: mapping, pair, term, and student all bound to this school.
    const saved = await examMarksService.saveTermAssessment(scope, PRINCIPAL, {
      ...base,
      studentId: world.studentA,
    });
    expect(saved?.grade).toBe("A");

    // A subjectId from another paper never writes here (previously ignored).
    const crossed = await examMarksService.saveTermAssessment(scope, PRINCIPAL, {
      ...base,
      studentId: world.studentA,
      subjectId: world.subjectId,
    });
    expect(crossed).toBeNull();

    // A student no enrollment covers never writes here (previously written
    // under the caller's school stamp).
    const outsider = await examMarksService.saveTermAssessment(scope, PRINCIPAL, {
      ...base,
      studentId: crypto.randomUUID(),
    });
    expect(outsider).toBeNull();

    // A mapping id from nowhere never writes here.
    const ghost = await examMarksService.saveTermAssessment(scope, PRINCIPAL, {
      ...base,
      mappingId: crypto.randomUUID(),
    });
    expect(ghost).toBeNull();
  });
});

// -- drizzle table imports (used by the fixture and the assertions) ----------
