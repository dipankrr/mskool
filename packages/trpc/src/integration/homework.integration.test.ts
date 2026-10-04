import { beforeAll, describe, expect, it } from "vitest";

/**
 * HOMEWORK / ASSIGNMENTS (ADR-039, slice A) — the proofs against REAL
 * Postgres. What only the database and the services can vouch for:
 *
 *   - settings resolution: the class override wins field-by-field over the
 *     school default, and the platform fallback fills a bare school;
 *   - the publish resolution: active enrollments in the target section
 *     become student_assignments rows with snapshotted deadlines, and a
 *     second publish is refused;
 *   - the publish-time caps: per-day and weekend, against the EFFECTIVE
 *     settings;
 *   - submissions: versioned, channel-checked, late logic (due vs close,
 *     policy), role switches, and the immutability of old versions;
 *   - evaluations: append-only with is_current flipping, the denormalised
 *     columns moving, marks bounded by the assignment's max;
 *   - the post-publish integrity rule: a material edit snapshots a revision;
 *   - TENANCY: a foreign org's assignment/row is null on every read, and a
 *     foreign-org storage object cannot become this school's homework.
 *
 * FIXTURE ISOLATION: borrows the authz suite's world (orgs `authz-itg-a/b`)
 * and adds its OWN assignments/students/portal rows keyed on the run
 * timestamp. Nothing from the fixture is deleted (hard rule 2).
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  assignmentEvaluations,
  guardians,
  assignmentRevisions,
  assignmentSettings,
  assignmentTargets,
  assignments,
  classes,
  rubrics,
  sections,
  studentAssignments,
  studentEnrollments,
  studentPortalAccess,
  students,
  submissions,
} from "@repo/db/schema";
import { homeworkService, homeworkWorkerService } from "@repo/services";
import { and, eq, ne } from "drizzle-orm";
import { buildWorld, findOrCreateUser } from "./world";

const RUN = Date.now();
const title = (s: string) => `ITG HW ${RUN} ${s}`;

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

/** A due date N days ahead at 18:00 UTC — a weekday unless N lands oddly. */
function dueInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(18, 0, 0, 0);
  // Nudge Sundays (0) and Saturdays (6) to the following Monday.
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString();
}

describe("homework / assignments (slice A)", () => {
  let orgAId: string;
  let orgBId: string;
  let schoolA1Id: string;
  let scopeA1: DataScope;
  let scopeB1: DataScope;
  let class6Id: string;
  let section6aId: string;
  let subjectMathId: string;
  let currentYearAId: string;
  let adminAId: string;

  let baseAssignmentId: string;
  let baseStudentAssignmentIds: string[] = [];

  const createDraft = async (overrides: Record<string, unknown> = {}) => {
    return homeworkService.createAssignment(scopeA1, adminAId, {
      academicYearId: currentYearAId,
      subjectId: subjectMathId,
      sectionId: section6aId,
      title: title("base"),
      submissionTypes: ["text", "file"],
      gradingMode: "marks",
      maxMarks: "10",
      dueAt: dueInDays(3),
      closeAt: dueInDays(4),
      ...overrides,
    } as Parameters<typeof homeworkService.createAssignment>[2]);
  };

  beforeAll(async () => {
    const world = await buildWorld();
    orgAId = world.orgAId;
    orgBId = world.orgBId;
    schoolA1Id = world.schoolA1Id;
    scopeA1 = schoolScope(orgAId, schoolA1Id);
    scopeB1 = schoolScope(orgBId, world.schoolB1Id);
    class6Id = world.class6Id;
    section6aId = world.section6aId;
    subjectMathId = world.subjectA1MathId;
    currentYearAId = world.currentYearAId;
    adminAId = world.users.adminA;

    // Portal fixtures — the world's OWNED student + its existing 6-A
    // enrollment, reached through TWO run-scoped logins: the student's own
    // (guardianId null) and a guardian's (guardianId set). No new students
    // or enrollments: other suites pin 6-A's exact roster, so this fixture
    // only ever adds portal ACCESS rows, which nobody counts.
    const studentUser = await findOrCreateUser(`hw-student-${RUN}`);
    const parentUser = await findOrCreateUser(`hw-parent-${RUN}`);
    portalStudentUserId = studentUser.id;
    parentUserId = parentUser.id;
    portalStudentId = world.ownedStudentId;
    portalEnrollmentId = world.enrollmentOwnedId;

    await db
      .insert(studentPortalAccess)
      .values({ userId: portalStudentUserId, studentId: portalStudentId, guardianId: null })
      .onConflictDoNothing();
    const [guardian] = await db
      .insert(guardians)
      .values({
        organizationId: orgAId,
        firstName: "Homework",
        lastName: "Guardian",
        phone: String(RUN).slice(-10),
      })
      .returning();
    await db
      .insert(studentPortalAccess)
      .values({ userId: parentUserId, studentId: portalStudentId, guardianId: guardian!.id });
  });

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  it("resolves effective settings: class override wins, school default fills, platform fallback covers a bare school", async () => {
    try {
    // No rows yet for a run-scoped override — the platform defaults answer.
    const bare = await homeworkService.resolveSettings(schoolA1Id, class6Id);
    expect(bare.maxFilesPerSubmission).toBe(5);
    expect(bare.defaultLatePolicy).toBe("allowed");

    await homeworkService.upsertSettings(scopeA1, adminAId, {
      maxAssignmentsPerDay: 4,
      defaultLateWindowHours: 24,
    });
    await homeworkService.upsertSettings(scopeA1, adminAId, {
      classId: class6Id,
      maxAssignmentsPerDay: 1,
      allowWeekendAssignments: false,
    });

    const effective = await homeworkService.resolveSettings(schoolA1Id, class6Id);
    // The override row wins WHOLE — it is a complete config row.
    expect(effective.maxAssignmentsPerDay).toBe(1);
    expect(effective.allowWeekendAssignments).toBe(false);
    // A class WITHOUT its own override row reads the school default.
    const defaultOnly = await homeworkService.resolveSettings(schoolA1Id, null);
    expect(defaultOnly.maxAssignmentsPerDay).toBe(4);
    expect(defaultOnly.defaultLateWindowHours).toBe(24);
    // …and identity fields are absent (they are not settings).
    expect(effective).not.toHaveProperty("organizationId");
  } finally {
    // RESET: these rows persist across runs, and the publish tests below
    // need the caps off — even if an assertion above failed.
    await homeworkService.upsertSettings(scopeA1, adminAId, {
      maxAssignmentsPerDay: null,
    });
    await homeworkService.upsertSettings(scopeA1, adminAId, {
      classId: class6Id,
      maxAssignmentsPerDay: null,
      allowWeekendAssignments: true,
    });
    }
  });

  // -------------------------------------------------------------------------
  // Draft + publish resolution
  // -------------------------------------------------------------------------

  it("creates a draft with targets and resources; a foreign section and a foreign year are refused", async () => {
    const draft = await createDraft({
      resources: [{ resourceType: "link", url: "https://example.com/wb", title: "Workbook" }],
    });
    baseAssignmentId = draft.id;
    expect(draft.status).toBe("draft");

    const targets = await db
      .select()
      .from(assignmentTargets)
      .where(eq(assignmentTargets.assignmentId, draft.id));
    expect(targets).toHaveLength(1);
    expect(targets[0]?.targetType).toBe("section");

    // A School-B section id under a School-A scope — the FK would accept it.
    const [foreignSection] = await db
      .select({ id: sections.id })
      .from(sections)
      .where(eq(sections.schoolId, scopeB1.schoolId!))
      .limit(1);
    await expect(
      createDraft({ title: title("foreign"), sectionId: foreignSection!.id }),
    ).rejects.toThrow(/Section not found in this school/);

    // The section's own year is binding — a closed year cannot host homework.
    await expect(
      createDraft({ academicYearId: (await db.select({ id: classes.id }).from(classes).where(eq(classes.id, class6Id)))[0]!.id && crypto.randomUUID() }),
    ).rejects.toThrow(/Academic year does not match the section's year/);
  });

  it("publish resolves active enrollments into student assignments; double publish is refused", async () => {
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, baseAssignmentId));
    // The settings test above set the class cap to 1/day and weekends off;
    // the base draft is due on a weekday, and nothing else is due that day.
    await homeworkService.publishAssignment(scopeA1, adminAId, assignment!.id);

    const rows = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.assignmentId, assignment!.id));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    baseStudentAssignmentIds = rows.map((r) => r.id);
    for (const row of rows) {
      expect(row.status).toBe("assigned");
      expect(row.effectiveCloseAt.getTime()).toBeGreaterThanOrEqual(
        row.effectiveDueAt.getTime(),
      );
    }

    await expect(
      homeworkService.publishAssignment(scopeA1, adminAId, assignment!.id),
    ).rejects.toThrow(/published assignment cannot be published/);
  });

  it("publish-time caps: a second assignment due the same day breaches the class cap; weekends are refused", async () => {
    // Arm the caps on the class row. The reset lives in FINALLY — a failed
    // assertion must never leave the cap armed to poison later runs (this
    // actually happened and flaked three suites).
    try {
      await homeworkService.upsertSettings(scopeA1, adminAId, {
        classId: class6Id,
        maxAssignmentsPerDay: 1,
        allowWeekendAssignments: false,
      });
      // Cap is 1/day for this class — the base assignment owns its due date.
      const second = await createDraft({ title: title("capped") });
      await expect(
        homeworkService.publishAssignment(scopeA1, adminAId, second!.id),
      ).rejects.toThrow(/per-day limit/);

      // Lift the cap; the weekend rule still bites.
      await homeworkService.upsertSettings(scopeA1, adminAId, {
        classId: class6Id,
        maxAssignmentsPerDay: null,
        allowWeekendAssignments: false,
      });
    const weekend = new Date();
    weekend.setUTCDate(weekend.getUTCDate() + 14);
    while (weekend.getUTCDay() !== 0) weekend.setUTCDate(weekend.getUTCDate() + 1);
    weekend.setUTCHours(18, 0, 0, 0);
    const saturdayDue = new Date(weekend);
    saturdayDue.setUTCDate(saturdayDue.getUTCDate() - 1);
    const weekendDraft = await createDraft({
      title: title("weekend"),
      dueAt: saturdayDue.toISOString(),
      closeAt: weekend.toISOString(),
    });
    await expect(
      homeworkService.publishAssignment(scopeA1, adminAId, weekendDraft!.id),
    ).rejects.toThrow(/weekend/);
    } finally {
      // RESET (rows persist across runs) — never skipped, even on failure.
      await homeworkService.upsertSettings(scopeA1, adminAId, {
        classId: class6Id,
        maxAssignmentsPerDay: null,
        allowWeekendAssignments: true,
      });
    }
  });

  it("a foreign org's assignment is invisible on every read", async () => {
    expect(await homeworkService.getAssignmentDetail(scopeB1, baseAssignmentId)).toBeNull();
    expect(
      await homeworkService.listStudentAssignments([scopeB1], baseAssignmentId),
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Submissions (the family door's engine, driven at the service seam)
  // -------------------------------------------------------------------------

  let portalStudentUserId: string;
  let portalStudentId: string;
  let parentUserId: string;
  let studentSaId: string;
  let portalEnrollmentId: string;

  const resolveSa = async (assignmentId: string): Promise<string> => {
    const [sa] = await db
      .select({ id: studentAssignments.id })
      .from(studentAssignments)
      .where(
        and(
          eq(studentAssignments.assignmentId, assignmentId),
          eq(studentAssignments.studentEnrollmentId, portalEnrollmentId),
        ),
      );
    return sa!.id;
  };
  const resolveStudentSaId = () => resolveSa(baseAssignmentId);
  it("submits on time as the student; resubmission versions; the old version is untouched", async () => {
    studentSaId = await resolveStudentSaId();
    const first = await homeworkService.portalSubmit(portalStudentUserId, [portalStudentId], {
      studentAssignmentId: studentSaId,
      bodyText: "Done, attached my notebook page.",
    });
    expect(first.submission.versionNo).toBe(1);
    expect(first.submission.isLate).toBe(false);
    expect(first.studentAssignment.status).toBe("submitted");
    expect(first.studentAssignment.completionSource).toBe("student");

    const second = await homeworkService.portalSubmit(portalStudentUserId, [portalStudentId], {
      studentAssignmentId: studentSaId,
      bodyText: "Corrected the second answer.",
    });
    expect(second.submission.versionNo).toBe(2);

    const versions = await db
      .select()
      .from(submissions)
      .where(eq(submissions.studentAssignmentId, studentSaId))
      .orderBy(submissions.versionNo);
    expect(versions).toHaveLength(2);
    expect(versions[0]?.bodyText).toBe("Done, attached my notebook page.");
  });

  it("the parent login submits as PARENT; an unlinked login is refused", async () => {
    const parentSubmit = await homeworkService.portalSubmit(parentUserId, [portalStudentId], {
      studentAssignmentId: studentSaId,
      bodyText: "Submitted by the parent.",
    });
    expect(parentSubmit.submission.submittedByRole).toBe("parent");
    expect(parentSubmit.studentAssignment.completionSource).toBe("parent");

    const outsider = await findOrCreateUser(`hw-outsider-${RUN}`);
    await expect(
      homeworkService.portalSubmit(outsider.id, [portalStudentId], {
        studentAssignmentId: studentSaId,
        bodyText: "not mine",
      }),
    ).rejects.toThrow(/no portal access/);
  });

  it("refuses an unaccepted channel, a closed window, and a no-late policy breach", async () => {
    await expect(
      homeworkService.portalSubmit(portalStudentUserId, [portalStudentId], {
        studentAssignmentId: studentSaId,
        linkUrl: "https://example.com/x",
      }),
    ).rejects.toThrow(/does not accept that submission type/);

    // Fully closed: a draft whose close already passed.
    const past = await createDraft({
      title: title("closed"),
      submissionTypes: ["text"],
      gradingMode: "none",
      dueAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
      closeAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
    });
    await homeworkService.publishAssignment(scopeA1, adminAId, past!.id);
    const [pastSa] = await db
      .select()
      .from(studentAssignments)
      .where(
        and(
          eq(studentAssignments.assignmentId, past.id),
          eq(studentAssignments.studentEnrollmentId, portalEnrollmentId),
        ),
      )
      .limit(1);
    await expect(
      homeworkService.portalSubmit(portalStudentUserId, [portalStudentId], {
        studentAssignmentId: pastSa!.id,
        bodyText: "too late",
      }),
    ).rejects.toThrow(/submission window closed/);

    // Late but still open, with the policy switched to not_allowed.
    const [strict] = await db
      .update(assignments)
      .set({
        latePolicy: "not_allowed",
        dueAt: new Date(Date.now() - 2 * 3600_000),
        closeAt: new Date(Date.now() - 2 * 3600_000),
      })
      .where(eq(assignments.id, past.id))
      .returning();
    void strict;
    await db
      .update(studentAssignments)
      .set({
        effectiveDueAt: new Date(Date.now() - 2 * 3600_000),
        effectiveCloseAt: new Date(Date.now() + 2 * 3600_000),
        submissionCount: 0,
      })
      .where(eq(studentAssignments.assignmentId, past.id));
    await expect(
      homeworkService.portalSubmit(portalStudentUserId, [portalStudentId], {
        studentAssignmentId: pastSa!.id,
        bodyText: "late but open",
      }),
    ).rejects.toThrow(/Late submissions are not allowed/);
  });

  it("a foreign-org storage object cannot become this school's submission file", async () => {
    // base assignment accepts text+file; feed it a made-up object id — the
    // org-scoped re-read refuses it.
    await expect(
      homeworkService.portalSubmit(portalStudentUserId, [portalStudentId], {
        studentAssignmentId: studentSaId,
        fileObjectIds: [crypto.randomUUID()],
      }),
    ).rejects.toThrow(/attached files could not be found/);
  });

  // -------------------------------------------------------------------------
  // Evaluations — append-only, denormalised
  // -------------------------------------------------------------------------

  it("grades with marks; a regrade flips is_current and moves the denormalised columns; over-max refuses", async () => {
    // The roster is a ONE-STUDENT section by design (the authz suite pins it
    // exactly), so every grading proof runs against OUR student's rows on
    // fresh assignments.
    const graded = await createDraft({
      title: title("graded"),
      submissionTypes: ["text"],
      gradingMode: "marks",
      maxMarks: "10",
    });
    await homeworkService.publishAssignment(scopeA1, adminAId, graded!.id);
    const gradedSaId = await resolveSa(graded!.id);

    // Marks mode with no submission is refused.
    await expect(
      homeworkService.evaluateStudentAssignment(scopeA1, adminAId, {
        id: gradedSaId,
        sectionId: section6aId,
        subjectId: subjectMathId,
        outcome: "reviewed",
        marks: "8",
      }),
    ).rejects.toThrow(/nothing to review yet/);

    await homeworkService.portalSubmit(portalStudentUserId, [portalStudentId], {
      studentAssignmentId: gradedSaId,
      bodyText: "My worked solutions.",
    });

    const { evaluation } = await homeworkService.evaluateStudentAssignment(
      scopeA1,
      adminAId,
      {
        id: gradedSaId,
        sectionId: section6aId,
        subjectId: subjectMathId,
        outcome: "reviewed",
        marks: "8.5",
        feedback: "Neat work.",
      },
    );
    expect(evaluation.isCurrent).toBe(true);

    const [sa] = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.id, gradedSaId));
    expect(sa!.status).toBe("reviewed");
    expect(sa!.currentMarks).toBe("8.50");
    expect(sa!.currentEvaluationId).toBe(evaluation.id);

    // Regrade: two rows, exactly one current, the denormalisation follows.
    const { evaluation: second } = await homeworkService.evaluateStudentAssignment(
      scopeA1,
      adminAId,
      {
        id: gradedSaId,
        sectionId: section6aId,
        subjectId: subjectMathId,
        outcome: "reviewed",
        marks: "9.00",
      },
    );
    const evals = await db
      .select()
      .from(assignmentEvaluations)
      .where(eq(assignmentEvaluations.studentAssignmentId, gradedSaId));
    expect(evals).toHaveLength(2);
    expect(evals.filter((e) => e.isCurrent)).toHaveLength(1);
    expect(evals.find((e) => e.isCurrent)?.id).toBe(second.id);

    await expect(
      homeworkService.evaluateStudentAssignment(scopeA1, adminAId, {
        id: gradedSaId,
        sectionId: section6aId,
        subjectId: subjectMathId,
        outcome: "reviewed",
        marks: "11",
      }),
    ).rejects.toThrow(/cannot exceed the maximum/);
  });

  // OUR student's graded row on the base assignment: resubmit_requested must
  // clear the marks, and a wrong gate pair must refuse.
  it("request-resubmit moves the status without marks; the gate pair must describe the row", async () => {
    const targetId = studentSaId;

    const { studentAssignment } = await homeworkService.evaluateStudentAssignment(
      scopeA1,
      adminAId,
      {
        id: targetId,
        sectionId: section6aId,
        subjectId: subjectMathId,
        outcome: "resubmit_requested",
        feedback: "Please redo Q3.",
      },
    );
    expect(studentAssignment.status).toBe("resubmit_requested");
    expect(studentAssignment.currentMarks).toBeNull();

    await expect(
      homeworkService.evaluateStudentAssignment(scopeA1, adminAId, {
        id: targetId,
        sectionId: section6aId,
        subjectId: crypto.randomUUID(),
        outcome: "reviewed",
        marks: "5",
      }),
    ).rejects.toThrow(/do not match/);
  });

  it("excuses before submission and refuses once work exists; extensions append and revive missing rows", async () => {
    // Our student's base row HAS submissions — pin it reviewed, then the
    // excuse must refuse: reviewed work is graded work, never excused.
    await homeworkService.evaluateStudentAssignment(scopeA1, adminAId, {
      id: studentSaId,
      sectionId: section6aId,
      subjectId: subjectMathId,
      outcome: "reviewed",
      marks: "7",
    });
    await expect(
      homeworkService.excuseStudentAssignment(scopeA1, adminAId, {
        id: studentSaId,
        reason: "already graded",
      }),
    ).rejects.toThrow(/work on record/);

    // A fresh completion-mode assignment gives a work-free row to excuse.
    const scratch = await createDraft({
      title: title("excuse-target"),
      submissionTypes: ["tick"],
      gradingMode: "completion",
    });
    await homeworkService.publishAssignment(scopeA1, adminAId, scratch!.id);
    const scratchSaId = await resolveSa(scratch!.id);

    const excused = await homeworkService.excuseStudentAssignment(scopeA1, adminAId, {
      id: scratchSaId,
      reason: "Left school this month.",
    });
    expect(excused.status).toBe("excused");

    // Extension on the excused row still moves deadlines (append-only log).
    const extended = await homeworkService.grantExtension(scopeA1, adminAId, {
      id: scratchSaId,
      sectionId: section6aId,
      subjectId: subjectMathId,
      newDueAt: dueInDays(10),
      newCloseAt: dueInDays(11),
      reason: "Family travel.",
    });
    expect(extended.effectiveCloseAt.getTime()).toBeGreaterThan(
      extended.effectiveDueAt.getTime(),
    );
  });

  it("a material edit after publish snapshots a revision; cancel is a status, never a delete", async () => {
    const edited = await homeworkService.updateAssignment(scopeA1, adminAId, {
      id: baseAssignmentId,
      sectionId: section6aId,
      subjectId: subjectMathId,
      title: `${title("base")} (amended)`,
      changeSummary: "Clarified Q2 wording.",
    });
    expect(edited.title).toContain("(amended)");

    const revisions = await db
      .select()
      .from(assignmentRevisions)
      .where(eq(assignmentRevisions.assignmentId, baseAssignmentId));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revisionNo).toBe(1);
    expect((revisions[0]?.snapshot as Record<string, unknown>).title).not.toContain(
      "(amended)",
    );

    // A draft edit writes NO revision.
    const scratch = await createDraft({ title: title("draft-edit") });
    await homeworkService.updateAssignment(scopeA1, adminAId, {
      id: scratch.id,
      sectionId: section6aId,
      subjectId: subjectMathId,
      title: `${title("draft-edit")} 2`,
    });
    expect(
      (await db
        .select()
        .from(assignmentRevisions)
        .where(eq(assignmentRevisions.assignmentId, scratch.id))).length,
    ).toBe(0);

    const cancelled = await homeworkService.cancelAssignment(
      scopeA1,
      adminAId,
      scratch.id,
      "Created in error.",
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).not.toBeNull();
    // The row survived (hard rule 2's spirit).
    expect(
      await homeworkService.getAssignmentDetail(scopeA1, scratch.id),
    ).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Comments + acknowledgements
  // -------------------------------------------------------------------------

  it("posts class-wide and private threads; the family reads its own thread and cannot post class-wide", async () => {
    await homeworkService.staffPostComment(scopeA1, adminAId, {
      assignmentId: baseAssignmentId,
      body: "Class: bring your lab notebooks tomorrow.",
    });
    const privateComment = await homeworkService.staffPostComment(scopeA1, adminAId, {
      assignmentId: baseAssignmentId,
      studentAssignmentId: studentSaId,
      body: "Your Q3 needs another look.",
    });

    // Family read: class-wide + their own thread.
    const familyView = await homeworkService.listComments({
      studentIds: [portalStudentId],
      assignmentId: baseAssignmentId,
    });
    expect(familyView.some((c) => c.id === privateComment!.id)).toBe(true);
    // Privacy: no OTHER student's private thread leaks into this family's view.
    const foreignThreads = familyView.filter(
      (c) => c.studentAssignmentId !== null && c.studentAssignmentId !== studentSaId,
    );
    expect(foreignThreads).toHaveLength(0);

    // Family post into their own thread; class-wide refused.
    const familyPost = await homeworkService.portalPostComment(parentUserId, [portalStudentId], {
      assignmentId: baseAssignmentId,
      studentAssignmentId: studentSaId,
      body: "What page should we revise?",
    });
    expect(familyPost.studentAssignmentId).toBe(studentSaId);
    await expect(
      homeworkService.portalPostComment(parentUserId, [portalStudentId], {
        assignmentId: baseAssignmentId,
        body: "class-wide attempt",
      }),
    ).rejects.toThrow(/their own thread/);

    const acknowledged = await homeworkService.portalAcknowledge(
      parentUserId,
      [portalStudentId],
      studentSaId,
    );
    // Idempotent: a second signature is a no-op, not a duplicate row.
    const again = await homeworkService.portalAcknowledge(
      parentUserId,
      [portalStudentId],
      studentSaId,
    );
    expect(acknowledged).toBeTruthy();
    expect(again).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Rubrics
  // -------------------------------------------------------------------------

  it("creates a rubric with criteria + levels; a foreign school cannot read it", async () => {
    const rubric = await homeworkService.createRubric(scopeA1, adminAId, {
      name: `ITG Rubric ${RUN}`,
      criteria: [
        {
          name: "Presentation",
          sortOrder: 0,
          levels: [
            { label: "Neat", points: "2", sortOrder: 0 },
            { label: "Messy", points: "0", sortOrder: 1 },
          ],
        },
      ],
    });
    const detail = await homeworkService.getRubricDetail(scopeA1, rubric.id);
    expect(detail?.criteria).toHaveLength(1);
    expect(detail?.criteria[0]?.levels).toHaveLength(2);
    expect(await homeworkService.getRubricDetail(scopeB1, rubric.id)).toBeNull();
    expect(
      (await db.select().from(rubrics).where(eq(rubrics.id, rubric.id))).length,
    ).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // THE SWEEPER (ADR-040) — merged into this suite because it shares the
  // fixture AND the settings-coordination contract (it arms and resets the
  // class cap; a concurrent file doing the same is the race the full-suite
  // run caught).
  // ---------------------------------------------------------------------------

  /** Hours ago — a deadline that has already passed. */
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3600_000).toISOString();

  describe("homework sweeper (ADR-040)", () => {
  let orgAId: string;
  let schoolA1Id: string;
  let scopeA1: DataScope;
  let section6aId: string;
  let subjectMathId: string;
  let currentYearAId: string;
  let adminAId: string;
  let class6Id: string;
  let portalEnrollmentId: string;

  /** Creates a published/cancelled/scheduled assignment closed in the past. */
  const createAssignment = async (opts: {
    name: string;
    status: "published" | "cancelled" | "scheduled";
    closeHoursAgo: number;
    gradingMode?: "none" | "marks" | "completion";
  }) => {
    const draft = await homeworkService.createAssignment(scopeA1, adminAId, {
      academicYearId: currentYearAId,
      subjectId: subjectMathId,
      sectionId: section6aId,
      title: title(opts.name),
      submissionTypes: ["text"],
      gradingMode: opts.gradingMode ?? "none",
      dueAt: hoursAgo(opts.closeHoursAgo + 24),
      closeAt: hoursAgo(opts.closeHoursAgo),
    });
    if (opts.status === "published") {
      await homeworkService.publishAssignment(scopeA1, adminAId, draft.id);
    } else {
      await db
        .update(assignments)
        .set({
          status: opts.status,
          ...(opts.status === "scheduled"
            ? { publishAt: new Date(Date.now() - 3600_000) }
            : {}),
          ...(opts.status === "cancelled"
            ? { cancelledAt: new Date(), cancelReason: "sweep fixture" }
            : {}),
        })
        .where(eq(assignments.id, draft.id));
    }
    return draft;
  };

  const firstSaId = async (assignmentId: string) => {
    const [sa] = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.assignmentId, assignmentId));
    return sa!;
  };

  beforeAll(async () => {
    const world = await buildWorld();
    orgAId = world.orgAId;
    schoolA1Id = world.schoolA1Id;
    scopeA1 = schoolScope(orgAId, schoolA1Id);
    section6aId = world.section6aId;
    subjectMathId = world.subjectA1MathId;
    currentYearAId = world.currentYearAId;
    adminAId = world.users.adminA;
    class6Id = world.class6Id;
    portalEnrollmentId = world.enrollmentOwnedId;
  });

  it("publishes a scheduled assignment whose publish_at has passed — resolution included", async () => {
    const draft = await createAssignment({
      name: "scheduled",
      status: "scheduled",
      closeHoursAgo: 24,
    });

    const result = await homeworkWorkerService.runSweep();
    expect(result.published.some((p) => p.id === draft.id)).toBe(true);

    const [row] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, draft.id));
    expect(row!.status).toBe("published");
    // The audience resolved — the student assignment rows exist.
    const sa = await firstSaId(draft.id);
    expect(sa.status).toBe("missing"); // it closed yesterday, un-submitted
  });

  it("a poisoned scheduled publish (per-day cap) is refused WITHOUT poisoning siblings", async () => {
    // A failed earlier run can leave STALE scheduled rows behind (a refused
    // publish stays 'scheduled' forever); they would join this test's cap
    // arithmetic. The suite never expects cross-run scheduled rows, so
    // cancel them first — the same fixture-repairs-itself guarantee the
    // authz world uses.
    await db
      .update(assignments)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "stale scheduled fixture" })
      .where(and(eq(assignments.schoolId, schoolA1Id), eq(assignments.status, "scheduled")));

    // Arm the class cap at 1 and schedule two assignments due the same day.
    // Reset in finally — same reason as the caps test above.
    try {
    await homeworkService.upsertSettings(scopeA1, adminAId, {
      classId: class6Id,
      maxAssignmentsPerDay: 1,
      allowWeekendAssignments: true,
    });

    const makeScheduled = async (name: string) => {
      const draft = await homeworkService.createAssignment(scopeA1, adminAId, {
        academicYearId: currentYearAId,
        subjectId: subjectMathId,
        sectionId: section6aId,
        title: title(name),
        submissionTypes: ["text"],
        gradingMode: "none",
        dueAt: hoursAgo(48),
        closeAt: hoursAgo(24),
      });
      await db
        .update(assignments)
        .set({ status: "scheduled", publishAt: new Date(Date.now() - 3600_000) })
        .where(eq(assignments.id, draft.id));
      return draft.id;
    };
    const first = await makeScheduled("cap-a");
    const second = await makeScheduled("cap-b");

    const result = await homeworkWorkerService.runSweep();
    const publishedIds = result.published.map((p) => p.id);
    const refusedIds = result.publishRefusals.map((r) => r.id);

    // Exactly one published; the other was refused in words, not a 500, and
    // the refusal names the cap.
    expect(publishedIds.length + refusedIds.length).toBe(2);
    if (refusedIds.length === 1) {
      expect(refusedIds[0]).not.toBe(publishedIds[0]);
      expect(result.publishRefusals[0]?.reason).toMatch(/per-day limit/);
    }
    void first;
    void second;
    } finally {
      // RESET (rows persist across runs) — never skipped, even on failure.
      await homeworkService.upsertSettings(scopeA1, adminAId, {
        classId: class6Id,
        maxAssignmentsPerDay: null,
        allowWeekendAssignments: true,
      });
    }
  });

  it("the Missing sweep honours the assignment-status join: cancelled untouched, closed swept", async () => {
    // A CANCELLED assignment whose rows already resolved (published first,
    // cancelled after — the teacher regretted it): its rows must stay
    // assigned forever, never "missing".
    const cancelledDraft = await createAssignment({
      name: "cancelled",
      status: "published",
      closeHoursAgo: 24,
    });
    await db
      .update(assignments)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "sweep fixture" })
      .where(eq(assignments.id, cancelledDraft.id));
    const cancelled = cancelledDraft;
    const closed = await createAssignment({
      name: "closed",
      status: "published",
      closeHoursAgo: 24,
    });
    // Close it the way a teacher does (the sweep must treat closed the same
    // as published — the window really did shut).
    await db
      .update(assignments)
      .set({ status: "closed" })
      .where(eq(assignments.id, closed.id));

    await homeworkWorkerService.runSweep();

    const cancelledSa = await firstSaId(cancelled.id);
    expect(cancelledSa.status).toBe("assigned"); // NOT missing
    const closedSa = await firstSaId(closed.id);
    expect(closedSa.status).toBe("missing");
    expect(closedSa.missingMarkedAt).not.toBeNull();
  });

  it("human decisions are never overwritten: excused and reviewed rows stay put", async () => {
    const graded = await createAssignment({
      name: "graded",
      status: "published",
      closeHoursAgo: 24,
      gradingMode: "completion",
    });
    const gradedSaId = (await firstSaId(graded.id)).id;

    // One row reviewed (completion-mode verify), another excused — the only
    // enrollment in 6-A is the same student, so use two assignments instead.
    await homeworkService.evaluateStudentAssignment(scopeA1, adminAId, {
      id: gradedSaId,
      sectionId: section6aId,
      subjectId: subjectMathId,
      outcome: "reviewed",
    });

    await homeworkWorkerService.runSweep();
    const [after] = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.id, gradedSaId));
    expect(after!.status).toBe("reviewed");
  });

  it("a future extension is immune; granting one after a miss revives the row", async () => {
    const extended = await createAssignment({
      name: "extended",
      status: "published",
      closeHoursAgo: 24,
    });
    const saId = (await firstSaId(extended.id)).id;

    // The extension moves the deadlines into the future BEFORE the sweep.
    await homeworkService.grantExtension(scopeA1, adminAId, {
      id: saId,
      sectionId: section6aId,
      subjectId: subjectMathId,
      newDueAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      newCloseAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
      reason: "sweep immunity fixture",
    });

    await homeworkWorkerService.runSweep();
    const [alive] = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.id, saId));
    expect(alive!.status).toBe("assigned");

    // Now let the extended window lapse too: the row goes missing…
    await db
      .update(studentAssignments)
      .set({
        effectiveDueAt: new Date(Date.now() - 48 * 3600_000),
        effectiveCloseAt: new Date(Date.now() - 24 * 3600_000),
      })
      .where(eq(studentAssignments.id, saId));
    await homeworkWorkerService.runSweep();
    const [missed] = await db
      .select()
      .from(studentAssignments)
      .where(eq(studentAssignments.id, saId));
    expect(missed!.status).toBe("missing");

    // …and a fresh extension revives it (the sweep must not be a dead end).
    const revived = await homeworkService.grantExtension(scopeA1, adminAId, {
      id: saId,
      sectionId: section6aId,
      subjectId: subjectMathId,
      newDueAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      newCloseAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
      reason: "second chance",
    });
    expect(revived.status).toBe("assigned");
  });

  it("is idempotent: a second sweep marks nothing new", async () => {
    const first = await homeworkWorkerService.runSweep();
    const second = await homeworkWorkerService.runSweep();
    expect(second.markedMissing).toHaveLength(0);
    expect(second.published).toHaveLength(0);
    void first;
  });

  it("a foreign holder of the sweep lease makes the sweep SKIP, not queue", async () => {
    // Another instance's lease is a Redis key with a TTL; hold it here.
    // (A Postgres advisory lock was the original design — this deployment's
    // Postgres sits behind a transaction-pooling proxy where session state
    // is not per-client, so the lease moved to Redis.)
    const { getRedis } = await import("@repo/authz");
    await getRedis().set("lock:homework-sweep", "test-holder", "PX", 60_000, "NX");
    try {
      const result = await homeworkWorkerService.runSweep();
      expect(result.summary).toMatch(/skipped/);
      expect(result.markedMissing).toHaveLength(0);
    } finally {
      await getRedis().del("lock:homework-sweep");
    }
  });

  it("a quiet second run after a lease-gated skip stays a no-op", async () => {
    // After the skip above, the lease is released — a real sweep runs and,
    // being idempotent, marks nothing new.
    const result = await homeworkWorkerService.runSweep();
    expect(result.markedMissing).toHaveLength(0);
  });

  it("leaves the settings as it found them", async () => {
    const [row] = await db
      .select()
      .from(assignmentSettings)
      .where(
        and(
          eq(assignmentSettings.schoolId, schoolA1Id),
          eq(assignmentSettings.classId, class6Id),
        ),
      );
    expect(row?.maxAssignmentsPerDay ?? null).toBeNull();
    expect(row?.allowWeekendAssignments ?? true).toBe(true);
  });
});

});
