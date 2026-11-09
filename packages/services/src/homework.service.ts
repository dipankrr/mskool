import { scopeWhere, type DataScope } from "@repo/authz";
import {
  KIND_COMES_BACK,
  KIND_GRADING,
  type CheckResultInput,
  type ComesBack,
  type CreateHomeworkInput,
  type GiveAgainInput,
  type GradingMode,
  type HomeworkKind,
  type HomeworkSummary,
  type ImageRef,
  type ListHomeworkInput,
  type MoveDueInput,
  type PortalSendInput,
  type SaveRegisterInput,
  type StudentRecentHomework,
  type StudentRecentHomeworkInput,
  type UpdateHomeworkInput,
  type UploadRequest,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicYears,
  assignmentComments,
  assignmentFiles,
  assignmentQuestions,
  assignmentTargets,
  assignments,
  classSubjectMappings,
  classes,
  dailyAttendanceStatus,
  gradingScaleBands,
  gradingScales,
  questionAttemptAnswers,
  questionAttempts,
  sectionTeacherAssignments,
  sections,
  studentAssignments,
  studentEnrollments,
  studentPhotos,
  studentPortalAccess,
  students,
  subjects,
  submissionFiles,
  submissions,
  user,
} from "@repo/db/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { todayInIst } from "./enrollment-status";
import { compareRoll, studentWord, validateChoices } from "./homework-rules";
import { fullName, resolvePortalChild } from "./portal-child";
import { refuse } from "./service-error";
import { storageService } from "./storage.service";

/**
 * HOMEWORK (ADR-039, rebuilt by ADR-064) — the daily homework diary.
 *
 * A teacher GIVES a homework (one subject, one or more sections) and later
 * CHECKS it on a list: Done / Incomplete / Not done / Absent, plus marks, a
 * grade letter or a remark when the homework is graded. Students see their
 * homework, tick it, or send photos and text. Nothing keeps history: a check
 * result, a submission and a per-child deadline are overwritten in place.
 *
 * Knows nothing about HTTP. Every staff read takes a DataScope (or a list)
 * as a REQUIRED argument and filters by it (hard rule 1); a teacher who only
 * holds the subject_teacher role is further limited to their own (section,
 * subject) pairs, passed in as `pairs`. Every write re-reads its rows through
 * the caller's scope INSIDE the transaction. The family side starts from
 * `resolvePortalChild` (ADR-062).
 */

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;
type Assignment = typeof assignments.$inferSelect;
type StudentAssignmentRow = typeof studentAssignments.$inferSelect;

/** A teacher's (section, subject) pair. */
export type TeachingPair = { sectionId: string; subjectId: string };

/**
 * Who is reading: the caller's scopes for the permission, and — for a caller
 * whose only grant is the subject_teacher role — their own pairs. `pairs`
 * null means the scopes alone decide.
 */
export type HomeworkAccess = {
  userId: string;
  scopes: DataScope[];
  pairs: TeachingPair[] | null;
};

const ASSIGNMENT_COLS = {
  organizationId: assignments.organizationId,
  schoolId: assignments.schoolId,
} as const;

const SA_COLS = {
  organizationId: studentAssignments.organizationId,
  schoolId: studentAssignments.schoolId,
} as const;

const SECTION_COLS = {
  organizationId: sections.organizationId,
  schoolId: sections.schoolId,
  classId: sections.classId,
  sectionId: sections.id,
} as const;

/** Homework tables carry org + school only, so a class/section scope widens to its school. */
function atSchoolLevel(scope: DataScope): DataScope {
  return { ...scope, classId: null, sectionId: null };
}

function requireSchool(scope: DataScope): string {
  if (!scope.schoolId) {
    throw new Error("Homework needs a school: the caller's scope must resolve to a school node.");
  }
  return scope.schoolId;
}

function toDate(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw refuse("BAD_REQUEST", "That date isn't valid.");
  return d;
}

const ACTIVE_ENROLLMENT = ["studying"] as const;
/** Undo after Give works for this long, while no student has done anything. */
const UNDO_WINDOW_MS = 15 * 60 * 1000;
const TEACHER_FILE = "homework_teacher_file" as const;
const STUDENT_FILE = "homework_student_file" as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type VisibleFilters = {
  statuses?: Assignment["status"][];
  kind?: HomeworkKind;
  notKind?: HomeworkKind;
  comesBack?: Assignment["comesBack"][];
  subjectId?: string;
  forSectionId?: string;
  academicYearId?: string;
  search?: string;
  mine?: boolean;
  before?: Date;
  dueFrom?: Date;
  dueTo?: Date;
  publishedFrom?: Date;
  needsCheck?: boolean;
};

export class HomeworkService {
  // ── Shared row loading ───────────────────────────────────────────────────

  /** One homework in the caller's school, or NOT_FOUND. */
  private async load(ex: Executor, scope: DataScope, id: string): Promise<Assignment> {
    const [row] = await ex
      .select()
      .from(assignments)
      .where(and(eq(assignments.id, id), scopeWhere(atSchoolLevel(scope), ASSIGNMENT_COLS)));
    if (!row) throw refuse("NOT_FOUND", "That homework could not be found.");
    return row;
  }

  private async sectionIdsOf(ex: Executor, assignmentId: string): Promise<string[]> {
    const rows = await ex
      .select({ sectionId: assignmentTargets.sectionId })
      .from(assignmentTargets)
      .where(
        and(
          eq(assignmentTargets.assignmentId, assignmentId),
          eq(assignmentTargets.targetType, "section"),
        ),
      );
    return rows.map((r) => r.sectionId as string);
  }

  /**
   * A subject-gated route names one (section, subject) pair; the gate proved
   * the caller may use it. This proves the pair describes THIS homework, so a
   * teacher's pair on 6A cannot reach another teacher's homework on 7B.
   */
  private async assertPair(
    ex: Executor,
    assignment: Assignment,
    pair: TeachingPair,
  ): Promise<void> {
    const sectionIds = await this.sectionIdsOf(ex, assignment.id);
    if (assignment.subjectId !== pair.subjectId || !sectionIds.includes(pair.sectionId)) {
      throw refuse("NOT_FOUND", "That homework could not be found.");
    }
  }

  /** The sections named, all in this school and one academic year. */
  private async loadSections(ex: Executor, schoolId: string, sectionIds: string[]) {
    const ids = [...new Set(sectionIds)];
    const rows = await ex
      .select({
        id: sections.id,
        name: sections.name,
        classId: sections.classId,
        academicYearId: sections.academicYearId,
        organizationId: sections.organizationId,
      })
      .from(sections)
      .where(and(inArray(sections.id, ids), eq(sections.schoolId, schoolId)));
    if (rows.length !== ids.length) {
      throw refuse("BAD_REQUEST", "One of the classes could not be found.");
    }
    const years = new Set(rows.map((r) => r.academicYearId));
    if (years.size !== 1) throw refuse("BAD_REQUEST", "All the classes must be from the same year.");
    return rows;
  }

  private async defaultScaleId(ex: Executor, schoolId: string): Promise<string> {
    const [scale] = await ex
      .select({ id: gradingScales.id })
      .from(gradingScales)
      .where(and(eq(gradingScales.schoolId, schoolId), eq(gradingScales.isDefault, true)));
    if (!scale) {
      throw refuse(
        "CONFLICT",
        "The school has no grade letters set up yet. Use marks or a remark instead.",
      );
    }
    return scale.id;
  }

  private async gradeLetters(ex: Executor, scaleId: string | null): Promise<string[]> {
    if (!scaleId) return [];
    const bands = await ex
      .select({ label: gradingScaleBands.gradeLabel })
      .from(gradingScaleBands)
      .where(eq(gradingScaleBands.gradingScaleId, scaleId))
      .orderBy(desc(gradingScaleBands.minMarks));
    return bands.map((b) => b.label);
  }

  /** Active students in the sections, optionally only some of them. */
  private async resolveStudents(
    ex: Executor,
    schoolId: string,
    academicYearId: string,
    sectionIds: string[],
    onlyEnrollmentIds: string[] | null,
  ) {
    const rows = await ex
      .select({ id: studentEnrollments.id, sectionId: studentEnrollments.sectionId })
      .from(studentEnrollments)
      .where(
        and(
          eq(studentEnrollments.schoolId, schoolId),
          eq(studentEnrollments.academicYearId, academicYearId),
          inArray(studentEnrollments.sectionId, sectionIds),
          inArray(studentEnrollments.enrollmentStatus, [...ACTIVE_ENROLLMENT]),
        ),
      );
    if (onlyEnrollmentIds) {
      const wanted = new Set(onlyEnrollmentIds);
      const picked = rows.filter((r) => wanted.has(r.id));
      if (picked.length !== wanted.size) {
        throw refuse("BAD_REQUEST", "One of the students is not in these classes.");
      }
      return picked.map((r) => ({ id: r.id, sectionId: r.sectionId as string }));
    }
    return rows.map((r) => ({ id: r.id, sectionId: r.sectionId as string }));
  }

  /**
   * Makes the teacher's photos exactly `objectIds`: links new ones (only
   * files this teacher uploaded for this homework, or for none yet), and
   * hands the dropped ones to the storage sweeper.
   */
  private async setFiles(
    tx: Tx,
    assignment: Pick<Assignment, "id" | "organizationId" | "schoolId">,
    userId: string | null,
    objectIds: string[],
  ): Promise<void> {
    const ids = [...new Set(objectIds)];
    const existing = await tx
      .select({ objectId: assignmentFiles.objectId })
      .from(assignmentFiles)
      .where(eq(assignmentFiles.assignmentId, assignment.id));
    const before = existing.map((r) => r.objectId);
    await storageService.attach(tx, {
      organizationId: assignment.organizationId,
      purpose: TEACHER_FILE,
      parentId: assignment.id,
      userId,
      objectIds: ids,
    });
    await tx.delete(assignmentFiles).where(eq(assignmentFiles.assignmentId, assignment.id));
    if (ids.length) {
      await tx.insert(assignmentFiles).values(
        ids.map((objectId, i) => ({
          organizationId: assignment.organizationId,
          schoolId: assignment.schoolId,
          assignmentId: assignment.id,
          objectId,
          sortOrder: i,
        })),
      );
    }
    const dropped = before.filter((id) => !ids.includes(id));
    await storageService.markDeleted(tx, assignment.organizationId, dropped);
  }

  /** Writes the audience: section targets plus optional student targets. */
  private async setTargets(
    tx: Tx,
    assignment: Pick<Assignment, "id" | "organizationId" | "schoolId">,
    sectionIds: string[],
    studentEnrollmentIds: string[] | null,
  ): Promise<void> {
    await tx.delete(assignmentTargets).where(eq(assignmentTargets.assignmentId, assignment.id));
    await tx.insert(assignmentTargets).values([
      ...sectionIds.map((sectionId) => ({
        organizationId: assignment.organizationId,
        schoolId: assignment.schoolId,
        assignmentId: assignment.id,
        targetType: "section" as const,
        sectionId,
      })),
      ...(studentEnrollmentIds ?? []).map((studentEnrollmentId) => ({
        organizationId: assignment.organizationId,
        schoolId: assignment.schoolId,
        assignmentId: assignment.id,
        targetType: "student" as const,
        studentEnrollmentId,
      })),
    ]);
  }

  private async studentTargetsOf(ex: Executor, assignmentId: string): Promise<string[] | null> {
    const rows = await ex
      .select({ id: assignmentTargets.studentEnrollmentId })
      .from(assignmentTargets)
      .where(
        and(
          eq(assignmentTargets.assignmentId, assignmentId),
          eq(assignmentTargets.targetType, "student"),
        ),
      );
    return rows.length ? rows.map((r) => r.id as string) : null;
  }

  /**
   * Gives a draft or scheduled homework: one row per student, then
   * `published`. A class with no students is refused rather than giving
   * homework nobody receives.
   */
  private async giveNow(tx: Tx, assignment: Assignment): Promise<Assignment> {
    if (assignment.kind === "quiz") {
      const [q] = await tx
        .select({ n: count() })
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, assignment.id));
      if (!q || q.n === 0) throw refuse("CONFLICT", "Add questions before giving the quiz.");
    }
    const now = new Date();
    if (assignment.closeAt.getTime() <= now.getTime()) {
      throw refuse("BAD_REQUEST", "The due time has already passed. Pick a later one.");
    }
    const sectionIds = await this.sectionIdsOf(tx, assignment.id);
    const only = await this.studentTargetsOf(tx, assignment.id);
    const rows = await this.resolveStudents(
      tx,
      assignment.schoolId,
      assignment.academicYearId,
      sectionIds,
      only,
    );
    if (rows.length === 0) {
      throw refuse("CONFLICT", "These classes have no students yet, so there is nobody to give it to.");
    }
    await tx
      .insert(studentAssignments)
      .values(
        rows.map((e) => ({
          organizationId: assignment.organizationId,
          schoolId: assignment.schoolId,
          assignmentId: assignment.id,
          studentEnrollmentId: e.id,
          sectionId: e.sectionId,
          effectiveDueAt: assignment.dueAt,
          effectiveCloseAt: assignment.closeAt,
        })),
      )
      .onConflictDoNothing();
    const [given] = await tx
      .update(assignments)
      .set({ status: "published", publishedAt: now, publishAt: null })
      .where(eq(assignments.id, assignment.id))
      .returning();
    return given ?? assignment;
  }

  // ── Give ────────────────────────────────────────────────────────────────

  /**
   * Give (or keep as a draft). The router has already proved the caller may
   * give this subject in EVERY named section. Files are processed before the
   * transaction (bucket work never runs inside one).
   */
  async create(scope: DataScope, userId: string, input: CreateHomeworkInput): Promise<HomeworkSummary> {
    const schoolId = requireSchool(scope);
    const fileIds = input.kind === "reading" || input.kind === "quiz" ? [] : (input.fileObjectIds ?? []);
    await storageService.ensureReady(userId, fileIds);

    const comesBack: ComesBack = input.kind === "quiz" ? "questions" : input.comesBack;
    const gradingMode: GradingMode =
      input.kind === "quiz" ? "marks" : input.kind === "reading" ? "none" : input.gradingMode;
    const maxMarks =
      input.kind === "quiz" ? "0" : input.kind === "reading" ? null : (input.maxMarks ?? null);
    validateChoices({ kind: input.kind, comesBack, gradingMode, maxMarks });

    const dueAt = toDate(input.dueAt);
    const closeAt = input.closeAt ? toDate(input.closeAt) : dueAt;
    if (closeAt < dueAt) throw refuse("BAD_REQUEST", "Late work can't end before the due time.");
    const publishAt = input.publishAt ? toDate(input.publishAt) : null;
    if (publishAt && publishAt > dueAt) {
      throw refuse("BAD_REQUEST", "It can't be given after it is due.");
    }

    const id = await db.transaction(async (tx) => {
      const secs = await this.loadSections(tx, schoolId, input.sectionIds);
      const academicYearId = secs[0]!.academicYearId;
      const [subject] = await tx
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.id, input.subjectId), eq(subjects.schoolId, schoolId)));
      if (!subject) throw refuse("BAD_REQUEST", "That subject could not be found.");
      const gradingScaleId = gradingMode === "grade" ? await this.defaultScaleId(tx, schoolId) : null;

      const [row] = await tx
        .insert(assignments)
        .values({
          organizationId: secs[0]!.organizationId,
          schoolId,
          academicYearId,
          subjectId: input.subjectId,
          kind: input.kind,
          comesBack,
          title: input.kind === "reading" ? input.pages : input.title,
          description: input.kind === "reading" ? null : (input.details ?? null),
          topic: input.kind === "reading" ? input.book : null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          gradingMode,
          maxMarks,
          gradingScaleId,
          dueAt,
          closeAt,
          publishAt,
          status: publishAt && input.give && publishAt > new Date() ? "scheduled" : "draft",
          createdBy: userId,
        })
        .returning();
      if (!row) throw new Error("Failed to save the homework.");

      const only = input.studentEnrollmentIds?.length ? input.studentEnrollmentIds : null;
      if (only) {
        await this.resolveStudents(tx, schoolId, academicYearId, input.sectionIds, only);
      }
      await this.setTargets(tx, row, [...new Set(input.sectionIds)], only);
      await this.setFiles(tx, row, userId, fileIds);

      if (input.give && row.status === "draft") await this.giveNow(tx, row);
      return row.id;
    });
    return this.summary(scope, id);
  }

  /**
   * Edit. Before anything comes back everything can change; after the first
   * hand-in, attempt or check (`isLocked`) the classes, how it comes back and
   * grading are refused. Changing a given homework's due time moves every
   * child still on the old one.
   */
  async update(
    scope: DataScope,
    userId: string,
    pair: TeachingPair,
    input: UpdateHomeworkInput,
  ): Promise<HomeworkSummary> {
    const schoolId = requireSchool(scope);
    if (input.fileObjectIds) await storageService.ensureReady(userId, input.fileObjectIds);

    await db.transaction(async (tx) => {
      const a = await this.load(tx, scope, input.id);
      await this.assertPair(tx, a, pair);
      if (a.status === "cancelled" || a.status === "closed") {
        throw refuse("CONFLICT", "This homework is no longer open, so it can't be edited.");
      }
      const given = a.status === "published";
      const changesShape =
        input.sectionIds !== undefined ||
        input.studentEnrollmentIds !== undefined ||
        (input.comesBack !== undefined && input.comesBack !== a.comesBack) ||
        (input.gradingMode !== undefined && input.gradingMode !== a.gradingMode) ||
        (input.maxMarks !== undefined && input.maxMarks !== a.maxMarks);
      if (changesShape && a.isLocked) {
        throw refuse(
          "CONFLICT",
          "Work has already come back, so the classes, how it comes back and grading are fixed now.",
        );
      }
      if (given && (input.sectionIds !== undefined || input.studentEnrollmentIds !== undefined)) {
        throw refuse("CONFLICT", "It has been given already. Give it to another class instead.");
      }

      const comesBack = input.comesBack ?? a.comesBack;
      const gradingMode = a.kind === "quiz" ? "marks" : (input.gradingMode ?? a.gradingMode);
      const maxMarks = input.maxMarks !== undefined ? input.maxMarks : a.maxMarks;
      validateChoices({ kind: a.kind, comesBack, gradingMode, maxMarks });
      const gradingScaleId =
        gradingMode === "grade" ? (a.gradingScaleId ?? (await this.defaultScaleId(tx, schoolId))) : null;

      const dueAt = input.dueAt ? toDate(input.dueAt) : a.dueAt;
      let closeAt =
        input.closeAt === null ? dueAt : input.closeAt ? toDate(input.closeAt) : a.closeAt;
      if (input.dueAt && input.closeAt === undefined) {
        // Keep the same late window when only the due time moves.
        closeAt = new Date(dueAt.getTime() + (a.closeAt.getTime() - a.dueAt.getTime()));
      }
      if (closeAt < dueAt) throw refuse("BAD_REQUEST", "Late work can't end before the due time.");
      if (given && closeAt <= new Date()) {
        throw refuse("BAD_REQUEST", "The new due time has already passed.");
      }

      let publishAt = a.publishAt;
      let status = a.status;
      if (!given && input.publishAt !== undefined) {
        publishAt = input.publishAt ? toDate(input.publishAt) : null;
        status = publishAt && publishAt > new Date() ? "scheduled" : "draft";
      }

      if (input.sectionIds) {
        const secs = await this.loadSections(tx, schoolId, input.sectionIds);
        if (secs[0]!.academicYearId !== a.academicYearId) {
          throw refuse("BAD_REQUEST", "All the classes must be from the same year.");
        }
      }
      if (input.sectionIds !== undefined || input.studentEnrollmentIds !== undefined) {
        const sectionIds = input.sectionIds ?? (await this.sectionIdsOf(tx, a.id));
        const only =
          input.studentEnrollmentIds === undefined
            ? await this.studentTargetsOf(tx, a.id)
            : input.studentEnrollmentIds?.length
              ? input.studentEnrollmentIds
              : null;
        if (only) await this.resolveStudents(tx, schoolId, a.academicYearId, sectionIds, only);
        await this.setTargets(tx, a, [...new Set(sectionIds)], only);
      }

      await tx
        .update(assignments)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.details !== undefined && a.kind !== "reading" ? { description: input.details } : {}),
          ...(input.book !== undefined && a.kind === "reading" ? { topic: input.book } : {}),
          ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
          comesBack,
          gradingMode,
          maxMarks: a.kind === "quiz" ? a.maxMarks : maxMarks,
          gradingScaleId,
          dueAt,
          closeAt,
          publishAt,
          status,
        })
        .where(eq(assignments.id, a.id));

      if (input.fileObjectIds) await this.setFiles(tx, a, userId, input.fileObjectIds);

      if (given && (dueAt.getTime() !== a.dueAt.getTime() || closeAt.getTime() !== a.closeAt.getTime())) {
        await this.moveRows(tx, a, { dueAt, closeAt }, { onlyOnOldDates: true });
      }
    });
    return this.summary(scope, input.id);
  }

  /** Gives a draft now. */
  async give(scope: DataScope, pair: TeachingPair, id: string): Promise<HomeworkSummary> {
    await db.transaction(async (tx) => {
      const a = await this.load(tx, scope, id);
      await this.assertPair(tx, a, pair);
      if (a.status !== "draft" && a.status !== "scheduled") {
        throw refuse("CONFLICT", "This homework has already been given.");
      }
      await this.giveNow(tx, a);
    });
    return this.summary(scope, id);
  }

  /**
   * The toast's Undo: takes a just-given homework back to a draft. Only in
   * the first minutes and only while no student has sent, ticked, started or
   * been checked, so nobody loses work.
   */
  async undoGive(scope: DataScope, pair: TeachingPair, id: string): Promise<HomeworkSummary> {
    await db.transaction(async (tx) => {
      const a = await this.load(tx, scope, id);
      await this.assertPair(tx, a, pair);
      if (a.status !== "published" || !a.publishedAt) {
        throw refuse("CONFLICT", "This homework is not just given, so it can't be undone.");
      }
      if (Date.now() - a.publishedAt.getTime() > UNDO_WINDOW_MS || a.isLocked) {
        throw refuse("CONFLICT", "It's too late to undo. Cancel the homework instead.");
      }
      const [active] = await tx
        .select({ n: count() })
        .from(studentAssignments)
        .where(
          and(eq(studentAssignments.assignmentId, a.id), ne(studentAssignments.status, "assigned")),
        );
      if (active && active.n > 0) {
        throw refuse("CONFLICT", "A student has already started on it. Cancel the homework instead.");
      }
      await tx.delete(studentAssignments).where(eq(studentAssignments.assignmentId, a.id));
      await tx
        .update(assignments)
        .set({ status: "draft", publishedAt: null })
        .where(eq(assignments.id, a.id));
    });
    return this.summary(scope, id);
  }

  /** Deletes a draft that never reached a student (D-7), with its photos. */
  async deleteDraft(scope: DataScope, pair: TeachingPair, id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const a = await this.load(tx, scope, id);
      await this.assertPair(tx, a, pair);
      if (a.status !== "draft" && a.status !== "scheduled") {
        throw refuse("CONFLICT", "Only a homework that was never given can be deleted. Cancel it instead.");
      }
      await this.setFiles(tx, a, null, []);
      // A quiz draft's question images go with it.
      const qImages = await tx
        .select({ id: assignmentQuestions.imageObjectId })
        .from(assignmentQuestions)
        .where(eq(assignmentQuestions.assignmentId, a.id));
      await tx.delete(assignments).where(eq(assignments.id, a.id));
      await storageService.markDeleted(
        tx,
        a.organizationId,
        qImages.map((r) => r.id).filter((x): x is string => Boolean(x)),
      );
    });
  }

  /** Cancels a given homework: students no longer see it. Results already saved stay. */
  async cancel(scope: DataScope, pair: TeachingPair, id: string): Promise<HomeworkSummary> {
    await db.transaction(async (tx) => {
      const a = await this.load(tx, scope, id);
      await this.assertPair(tx, a, pair);
      if (a.status === "draft" || a.status === "scheduled") {
        throw refuse("CONFLICT", "It was never given. Delete the draft instead.");
      }
      if (a.status === "cancelled") return;
      await tx
        .update(assignments)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(assignments.id, a.id));
    });
    return this.summary(scope, id);
  }

  /**
   * Stops accepting work now. Children who never sent work (or never handed
   * in a quiz) become missing; open quiz attempts are handed in by the
   * questions service.
   */
  async close(scope: DataScope, pair: TeachingPair, id: string): Promise<HomeworkSummary> {
    await db.transaction(async (tx) => {
      const a = await this.load(tx, scope, id);
      await this.assertPair(tx, a, pair);
      if (a.status !== "published") throw refuse("CONFLICT", "Only a given homework can be closed.");
      const now = new Date();
      await tx.update(assignments).set({ status: "closed" }).where(eq(assignments.id, a.id));
      await tx
        .update(studentAssignments)
        .set({ effectiveCloseAt: now })
        .where(
          and(eq(studentAssignments.assignmentId, a.id), gt(studentAssignments.effectiveCloseAt, now)),
        );
      if (a.comesBack === "sent") await this.markMissing(tx, a.id);
    });
    return this.summary(scope, id);
  }

  /** Children with nothing sent by their close time become missing. */
  async markMissing(ex: Executor, assignmentId: string): Promise<number> {
    const rows = await ex
      .update(studentAssignments)
      .set({ status: "missing", statusChangedAt: new Date() })
      .where(
        and(
          eq(studentAssignments.assignmentId, assignmentId),
          inArray(studentAssignments.status, ["assigned", "redo"]),
          lte(studentAssignments.effectiveCloseAt, new Date()),
        ),
      )
      .returning({ id: studentAssignments.id });
    return rows.length;
  }

  /**
   * Rewrites children's deadlines. `onlyOnOldDates` keeps a child whose
   * deadline was moved on its own and is later than the new one.
   */
  private async moveRows(
    tx: Tx,
    a: Assignment,
    next: { dueAt: Date; closeAt: Date },
    opts: { onlySectionId?: string; onlyStudentAssignmentId?: string; onlyOnOldDates?: boolean },
  ): Promise<void> {
    const conds = [eq(studentAssignments.assignmentId, a.id)];
    if (opts.onlySectionId) conds.push(eq(studentAssignments.sectionId, opts.onlySectionId));
    if (opts.onlyStudentAssignmentId) conds.push(eq(studentAssignments.id, opts.onlyStudentAssignmentId));
    if (opts.onlyOnOldDates) {
      conds.push(
        or(
          eq(studentAssignments.effectiveDueAt, a.dueAt),
          lt(studentAssignments.effectiveCloseAt, next.closeAt),
        )!,
      );
    }
    await tx
      .update(studentAssignments)
      .set({ effectiveDueAt: next.dueAt, effectiveCloseAt: next.closeAt })
      .where(and(...conds));
    // A child marked missing gets another chance when the new close is ahead.
    if (next.closeAt > new Date()) {
      await tx
        .update(studentAssignments)
        .set({ status: "assigned", statusChangedAt: new Date() })
        .where(and(...conds, eq(studentAssignments.status, "missing")));
    }
  }

  /** Move the due date for everyone, one section, or one child. */
  async moveDue(scope: DataScope, pair: TeachingPair, input: MoveDueInput): Promise<HomeworkSummary> {
    await db.transaction(async (tx) => {
      const a = await this.load(tx, scope, input.id);
      await this.assertPair(tx, a, pair);
      if (a.status !== "published" && a.status !== "closed") {
        throw refuse("CONFLICT", "Edit the draft to change its due time.");
      }
      const dueAt = toDate(input.dueAt);
      const closeAt = input.closeAt
        ? toDate(input.closeAt)
        : new Date(dueAt.getTime() + (a.closeAt.getTime() - a.dueAt.getTime()));
      if (closeAt < dueAt) throw refuse("BAD_REQUEST", "Late work can't end before the due time.");
      if (closeAt <= new Date()) throw refuse("BAD_REQUEST", "The new due time has already passed.");

      if (input.onlyStudentAssignmentId) {
        const [sa] = await tx
          .select({ id: studentAssignments.id })
          .from(studentAssignments)
          .where(
            and(
              eq(studentAssignments.id, input.onlyStudentAssignmentId),
              eq(studentAssignments.assignmentId, a.id),
            ),
          );
        if (!sa) throw refuse("NOT_FOUND", "That student's homework could not be found.");
        await this.moveRows(tx, a, { dueAt, closeAt }, { onlyStudentAssignmentId: sa.id });
      } else if (input.onlySectionId) {
        const sectionIds = await this.sectionIdsOf(tx, a.id);
        if (!sectionIds.includes(input.onlySectionId)) {
          throw refuse("BAD_REQUEST", "That class was not given this homework.");
        }
        await this.moveRows(tx, a, { dueAt, closeAt }, { onlySectionId: input.onlySectionId });
      } else {
        await this.moveRows(tx, a, { dueAt, closeAt }, { onlyOnOldDates: true });
        await tx.update(assignments).set({ dueAt, closeAt }).where(eq(assignments.id, a.id));
      }
      if (a.status === "closed") {
        await tx.update(assignments).set({ status: "published" }).where(eq(assignments.id, a.id));
      }
    });
    return this.summary(scope, input.id);
  }

  /**
   * Give the same homework to other classes, as a new homework with its own
   * due time. Photos and quiz question images are COPIED: a file belongs to
   * one record (ADR-063). The router proved the caller may give this subject
   * in every target section.
   */
  async giveAgain(scope: DataScope, userId: string, pair: TeachingPair, input: GiveAgainInput) {
    const schoolId = requireSchool(scope);
    const source = await this.load(db, scope, input.id);
    await this.assertPair(db, source, pair);
    if (source.status === "draft" || source.status === "scheduled") {
      throw refuse("CONFLICT", "Give the draft first, then give it to another class.");
    }
    const files = await db
      .select({ objectId: assignmentFiles.objectId })
      .from(assignmentFiles)
      .where(eq(assignmentFiles.assignmentId, source.id))
      .orderBy(asc(assignmentFiles.sortOrder));
    const questions = await db
      .select()
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, source.id))
      .orderBy(asc(assignmentQuestions.position));

    const copyFile = async (objectId: string) =>
      (
        await storageService.copyToOrg({
          sourceObjectId: objectId,
          targetOrganizationId: source.organizationId,
          targetSchoolId: source.schoolId,
          uploadedBy: userId,
        })
      ).id;
    const fileCopies = await Promise.all(files.map((f) => copyFile(f.objectId)));
    const imageCopies = new Map<string, string>();
    for (const q of questions) {
      if (q.imageObjectId && !imageCopies.has(q.imageObjectId)) {
        imageCopies.set(q.imageObjectId, await copyFile(q.imageObjectId));
      }
    }

    const dueAt = toDate(input.dueAt);
    const closeAt = input.closeAt
      ? toDate(input.closeAt)
      : new Date(dueAt.getTime() + (source.closeAt.getTime() - source.dueAt.getTime()));
    if (closeAt < dueAt) throw refuse("BAD_REQUEST", "Late work can't end before the due time.");

    const id = await db.transaction(async (tx) => {
      const secs = await this.loadSections(tx, schoolId, input.toSectionIds);
      const [row] = await tx
        .insert(assignments)
        .values({
          organizationId: source.organizationId,
          schoolId,
          academicYearId: secs[0]!.academicYearId,
          subjectId: source.subjectId,
          sourceAssignmentId: source.id,
          kind: source.kind,
          comesBack: source.comesBack,
          title: source.title,
          description: source.description,
          topic: source.topic,
          estimatedMinutes: source.estimatedMinutes,
          gradingMode: source.gradingMode,
          maxMarks: source.maxMarks,
          gradingScaleId: source.gradingScaleId,
          dueAt,
          closeAt,
          status: "draft",
          createdBy: userId,
        })
        .returning();
      if (!row) throw new Error("Failed to save the homework.");
      await this.setTargets(tx, row, [...new Set(input.toSectionIds)], null);
      await this.setFiles(tx, row, userId, fileCopies);
      if (questions.length) {
        const images = [...imageCopies.values()];
        await storageService.attach(tx, {
          organizationId: row.organizationId,
          purpose: TEACHER_FILE,
          parentId: row.id,
          userId,
          objectIds: images,
        });
        await tx.insert(assignmentQuestions).values(
          questions.map((q) => ({
            organizationId: q.organizationId,
            schoolId: q.schoolId,
            assignmentId: row.id,
            sourceQuestionId: q.sourceQuestionId,
            position: q.position,
            questionType: q.questionType,
            body: q.body,
            imageObjectId: q.imageObjectId ? (imageCopies.get(q.imageObjectId) ?? null) : null,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            marks: q.marks,
          })),
        );
      }
      await this.giveNow(tx, row);
      return row.id;
    });
    return this.summary(scope, id);
  }

  /** Upload links for the teacher's photos. Linked by the save that names them. */
  async fileUploadTickets(
    scope: DataScope,
    userId: string,
    input: { homeworkId?: string; files: UploadRequest[] },
  ) {
    const schoolId = requireSchool(scope);
    let parentId: string | null = null;
    let organizationId = scope.organizationId;
    if (input.homeworkId) {
      const a = await this.load(db, scope, input.homeworkId);
      parentId = a.id;
      organizationId = a.organizationId;
    }
    return storageService.createUploads({
      organizationId,
      schoolId,
      purpose: TEACHER_FILE,
      parentId,
      uploadedBy: userId,
      files: input.files,
    });
  }

  // ── Reads (staff) ───────────────────────────────────────────────────────

  /** Summaries for many homework ids, in the order given. */
  async summaries(ids: string[]): Promise<HomeworkSummary[]> {
    if (ids.length === 0) return [];
    const rowsP = db
      .select({ a: assignments, subjectName: subjects.name })
      .from(assignments)
      .innerJoin(subjects, eq(assignments.subjectId, subjects.id))
      .where(inArray(assignments.id, ids));
    const targetsP = db
      .select({
        assignmentId: assignmentTargets.assignmentId,
        sectionId: sections.id,
        sectionName: sections.name,
        className: classes.name,
        classOrder: classes.numericOrder,
      })
      .from(assignmentTargets)
      .innerJoin(sections, eq(assignmentTargets.sectionId, sections.id))
      .innerJoin(classes, eq(sections.classId, classes.id))
      .where(inArray(assignmentTargets.assignmentId, ids))
      .orderBy(asc(classes.numericOrder), asc(sections.name));
    const countsP = db
      .select({
        assignmentId: studentAssignments.assignmentId,
        sectionId: studentAssignments.sectionId,
        status: studentAssignments.status,
        n: count(),
      })
      .from(studentAssignments)
      .where(inArray(studentAssignments.assignmentId, ids))
      .groupBy(studentAssignments.assignmentId, studentAssignments.sectionId, studentAssignments.status);
    const fileCountsP = db
      .select({ assignmentId: assignmentFiles.assignmentId, n: count() })
      .from(assignmentFiles)
      .where(inArray(assignmentFiles.assignmentId, ids))
      .groupBy(assignmentFiles.assignmentId);
    const [rows, targets, counts, fileCounts] = await Promise.all([rowsP, targetsP, countsP, fileCountsP]);

    const byId = new Map<string, HomeworkSummary>();
    for (const { a, subjectName } of rows) {
      const sections = targets
        .filter((t) => t.assignmentId === a.id)
        .map((t) => {
          const mine = counts.filter((c) => c.assignmentId === a.id && c.sectionId === t.sectionId);
          const n = (s: StudentAssignmentRow["status"]) =>
            mine.filter((c) => c.status === s).reduce((sum, c) => sum + c.n, 0);
          const total = mine.reduce((sum, c) => sum + c.n, 0);
          const submitted = n("submitted");
          const checked = n("checked");
          const toCheck =
            a.comesBack === "brought"
              ? total - checked
              : a.comesBack === "sent" || a.comesBack === "questions"
                ? submitted
                : 0;
          return {
            sectionId: t.sectionId,
            sectionName: t.sectionName,
            className: t.className,
            total,
            toCheck,
            checked,
            submitted,
            missing: n("missing"),
            redo: n("redo"),
          };
        });
      byId.set(a.id, {
        id: a.id,
        kind: a.kind,
        comesBack: a.comesBack,
        gradingMode: a.gradingMode,
        maxMarks: a.maxMarks,
        title: a.title,
        book: a.kind === "reading" ? a.topic : null,
        subjectId: a.subjectId,
        subjectName,
        status: a.status,
        dueAt: a.dueAt,
        closeAt: a.closeAt,
        publishAt: a.publishAt,
        publishedAt: a.publishedAt,
        estimatedMinutes: a.estimatedMinutes,
        createdBy: a.createdBy,
        createdAt: a.createdAt,
        sections,
        fileCount: fileCounts.find((f) => f.assignmentId === a.id)?.n ?? 0,
      });
    }
    return ids.map((id) => byId.get(id)).filter((x): x is HomeworkSummary => Boolean(x));
  }

  async summary(scope: DataScope, id: string): Promise<HomeworkSummary> {
    await this.load(db, scope, id);
    const [s] = await this.summaries([id]);
    if (!s) throw refuse("NOT_FOUND", "That homework could not be found.");
    return s;
  }

  /**
   * The homework ids the caller may see, newest given first (or earliest due
   * first): by scope, and for a subject teacher only their own pairs (or what
   * they gave themselves).
   */
  private async visibleIds(
    access: HomeworkAccess,
    filters: VisibleFilters & { limit: number; earliestDueFirst?: boolean },
  ): Promise<string[]> {
    const rows = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(...this.visibleWhere(access, filters)))
      .orderBy(filters.earliestDueFirst ? asc(assignments.dueAt) : desc(assignments.createdAt))
      .limit(filters.limit);
    return rows.map((r) => r.id);
  }

  /** How many visible homework fall due on each IST day (YYYY-MM-DD). */
  private async dueDayCounts(access: HomeworkAccess, filters: VisibleFilters): Promise<Map<string, number>> {
    const day = sql<string>`to_char(${assignments.dueAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
    const rows = await db
      .select({ day, n: count() })
      .from(assignments)
      .where(and(...this.visibleWhere(access, filters)))
      .groupBy(day);
    return new Map(rows.map((r) => [r.day, r.n]));
  }

  private visibleWhere(access: HomeworkAccess, filters: VisibleFilters) {
    const conds = [
      or(...access.scopes.map((s) => scopeWhere(atSchoolLevel(s), ASSIGNMENT_COLS)))!,
    ];
    if (filters.statuses) conds.push(inArray(assignments.status, filters.statuses));
    if (filters.kind) conds.push(eq(assignments.kind, filters.kind));
    if (filters.notKind) conds.push(ne(assignments.kind, filters.notKind));
    if (filters.comesBack) conds.push(inArray(assignments.comesBack, filters.comesBack));
    if (filters.subjectId) conds.push(eq(assignments.subjectId, filters.subjectId));
    if (filters.academicYearId) conds.push(eq(assignments.academicYearId, filters.academicYearId));
    if (filters.mine) conds.push(eq(assignments.createdBy, access.userId));
    if (filters.before) conds.push(lt(assignments.createdAt, filters.before));
    if (filters.dueFrom) conds.push(gte(assignments.dueAt, filters.dueFrom));
    if (filters.dueTo) conds.push(lt(assignments.dueAt, filters.dueTo));
    if (filters.publishedFrom) conds.push(gte(assignments.publishedAt, filters.publishedFrom));
    if (filters.needsCheck) {
      // Something still waits on the teacher: brought work not checked, or sent work not reviewed.
      conds.push(
        sql`exists (select 1 from ${studentAssignments} where ${studentAssignments.assignmentId} = ${assignments.id} and ((${assignments.comesBack} = 'brought' and ${studentAssignments.status} <> 'checked') or (${assignments.comesBack} = 'sent' and ${studentAssignments.status} = 'submitted')))`,
      );
    }
    if (filters.search) {
      const term = `%${filters.search.replace(/[%_\\]/g, "\\$&")}%`;
      conds.push(or(ilike(assignments.title, term), ilike(assignments.topic, term))!);
    }
    if (filters.forSectionId) {
      conds.push(
        sql`exists (select 1 from ${assignmentTargets} where ${assignmentTargets.assignmentId} = ${assignments.id} and ${assignmentTargets.sectionId} = ${filters.forSectionId})`,
      );
    }
    if (access.pairs) {
      const pairConds = access.pairs.map(
        (p) =>
          sql`(${assignments.subjectId} = ${p.subjectId} and exists (select 1 from ${assignmentTargets} where ${assignmentTargets.assignmentId} = ${assignments.id} and ${assignmentTargets.sectionId} = ${p.sectionId}))`,
      );
      conds.push(or(eq(assignments.createdBy, access.userId), ...pairConds)!);
    }
    return conds;
  }

  /** All homework (by date given, newest first). */
  async list(access: HomeworkAccess, input: ListHomeworkInput): Promise<HomeworkSummary[]> {
    const ids = await this.visibleIds(access, {
      kind: input.kind,
      subjectId: input.subjectId,
      forSectionId: input.forSectionId,
      academicYearId: input.academicYearId,
      search: input.search,
      mine: input.mine,
      before: input.before ? toDate(input.before) : undefined,
      limit: input.limit,
    });
    const all = await this.summaries(ids);
    return all.filter((s) => s.status !== "draft" || s.createdBy === access.userId);
  }

  /**
   * One student's last 10 homework the caller may see (scope, and a subject teacher's
   * own pairs), newest due first, each in the student's own word. Work due more than a
   * week ahead is left out: the tile is about how they've been doing, not the queue.
   */
  async studentRecent(access: HomeworkAccess, input: StudentRecentHomeworkInput): Promise<StudentRecentHomework> {
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 86_400_000);
    const rows = await db
      .select({
        studentAssignmentId: studentAssignments.id,
        assignmentId: assignments.id,
        sectionId: studentAssignments.sectionId,
        subjectId: assignments.subjectId,
        subjectName: subjects.name,
        kind: assignments.kind,
        comesBack: assignments.comesBack,
        title: assignments.title,
        status: studentAssignments.status,
        checkStatus: studentAssignments.checkStatus,
        isLate: studentAssignments.isLate,
        effectiveDueAt: studentAssignments.effectiveDueAt,
        effectiveCloseAt: studentAssignments.effectiveCloseAt,
      })
      .from(studentAssignments)
      .innerJoin(assignments, eq(assignments.id, studentAssignments.assignmentId))
      .innerJoin(studentEnrollments, eq(studentEnrollments.id, studentAssignments.studentEnrollmentId))
      .innerJoin(subjects, eq(subjects.id, assignments.subjectId))
      .where(
        and(
          eq(studentEnrollments.studentId, input.studentId),
          lte(studentAssignments.effectiveDueAt, horizon),
          ...this.visibleWhere(access, {
            statuses: ["published", "closed"],
            academicYearId: input.academicYearId,
          }),
        ),
      )
      .orderBy(desc(studentAssignments.effectiveDueAt))
      .limit(10);

    const items = rows.map((row) => ({
      studentAssignmentId: row.studentAssignmentId,
      assignmentId: row.assignmentId,
      sectionId: row.sectionId,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      kind: row.kind,
      comesBack: row.comesBack,
      title: row.title,
      dueAt: row.effectiveDueAt,
      word: studentWord(row, row.comesBack, now),
    }));
    const handedIn = items.filter((i) => ["sent", "late", "checked", "redo"].includes(i.word)).length;
    const missed = items.filter((i) => i.word === "missed").length;
    return { items, handedIn, missed, counted: handedIn + missed };
  }

  /** Home: to check, quizzes, out now, given today, drafts. */
  async home(access: HomeworkAccess) {
    const now = new Date();
    const today = todayInIst();
    const DAY = 24 * 3600 * 1000;
    const monthAgo = new Date(now.getTime() - 30 * DAY);
    const todayStart = new Date(`${today}T00:00:00+05:30`);
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const weekFrom = new Date(todayStart.getTime() + (dow === 0 ? 1 : 1 - dow) * DAY);
    const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const weekStart = istDay(weekFrom);
    // Today, or Monday when today is the Sunday before the week shown.
    const shownDay = dow === 0 ? weekStart : today;

    // Each part of Home is its own bounded read, so a busy school cannot push
    // one part's homework out of another's (one shared cap of 300 used to).
    const live: Assignment["status"][] = ["published", "closed"];
    const [checkIds, quizGivenIds, outIds, todayIds, draftIds, week] = await Promise.all([
      this.visibleIds(access, {
        statuses: live,
        comesBack: ["brought", "sent"],
        dueFrom: monthAgo,
        dueTo: now,
        needsCheck: true,
        earliestDueFirst: true,
        limit: 200,
      }),
      this.visibleIds(access, { statuses: live, kind: "quiz", dueFrom: monthAgo, limit: 100 }),
      this.visibleIds(access, { statuses: ["published"], notKind: "quiz", dueFrom: now, earliestDueFirst: true, limit: 200 }),
      this.visibleIds(access, { statuses: live, publishedFrom: todayStart, limit: 100 }),
      this.visibleIds(access, { statuses: ["draft", "scheduled"], mine: true, limit: 100 }),
      this.weekStrip(access, weekStart, shownDay),
    ]);
    const all = await this.summaries([...new Set([...checkIds, ...quizGivenIds, ...outIds, ...todayIds, ...draftIds])]);

    const answersToMark = new Map<string, number>();
    const quizIds = all.filter((s) => s.kind === "quiz").map((s) => s.id);
    if (quizIds.length) {
      const rows = await db
        .select({ assignmentId: studentAssignments.assignmentId, n: count() })
        .from(questionAttemptAnswers)
        .innerJoin(questionAttempts, eq(questionAttemptAnswers.attemptId, questionAttempts.id))
        .innerJoin(studentAssignments, eq(questionAttempts.studentAssignmentId, studentAssignments.id))
        .where(
          and(
            inArray(studentAssignments.assignmentId, quizIds),
            eq(questionAttemptAnswers.needsManualReview, true),
            isNull(questionAttemptAnswers.gradedAt),
            ne(questionAttempts.status, "in_progress"),
          ),
        )
        .groupBy(studentAssignments.assignmentId);
      for (const r of rows) answersToMark.set(r.assignmentId, r.n);
    }

    const given = all.filter((s) => s.status === "published" || s.status === "closed");
    const checkSet = new Set(checkIds);
    const toCheck = given
      .filter((s) => checkSet.has(s.id))
      .flatMap((s) =>
        s.sections
          .filter((sec) => sec.toCheck > 0)
          .filter((sec) =>
            !access.pairs ||
            s.createdBy === access.userId ||
            access.pairs.some((p) => p.sectionId === sec.sectionId && p.subjectId === s.subjectId),
          )
          .map((sec) => ({
            homework: s,
            sectionId: sec.sectionId,
            sectionName: sec.sectionName,
            className: sec.className,
            toCheck: sec.toCheck,
          })),
      )
      .sort((x, y) => x.homework.dueAt.getTime() - y.homework.dueAt.getTime());

    return {
      toCheck,
      quizzes: given
        .filter((s) => s.kind === "quiz")
        .map((s) => ({ ...s, answersToMark: answersToMark.get(s.id) ?? 0 }))
        .filter((s) => s.status === "published" || s.answersToMark > 0),
      outNow: given.filter((s) => s.kind !== "quiz" && s.status === "published" && s.dueAt > now),
      givenToday: given.filter((s) => s.publishedAt && istDay(s.publishedAt) === today),
      drafts: all.filter(
        (s) => (s.status === "draft" || s.status === "scheduled") && s.createdBy === access.userId,
      ),
      // Home v3's day strip: this school week (Monday to Saturday, IST; on a
      // Sunday, the week ahead), with a count per day and the shown day's homework.
      ...week,
    };
  }

  /**
   * Home's day strip for any school week: everything given (or closed) that
   * falls due in the seven days from `fromIso` (a Monday, IST).
   */
  async week(access: HomeworkAccess, fromIso: string, dayIso?: string) {
    return this.weekStrip(access, fromIso, dayIso ?? fromIso);
  }

  /**
   * One school week for the day strip: how many fall due on each day (Mon-Sat),
   * and the full homework for one day only. A principal's week at a big school
   * runs to hundreds; a day is what one screen shows.
   */
  private async weekStrip(access: HomeworkAccess, fromIso: string, dayIso: string) {
    const DAY = 24 * 3600 * 1000;
    const from = new Date(`${fromIso}T00:00:00+05:30`);
    const dayStart = new Date(`${dayIso}T00:00:00+05:30`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(dayStart.getTime())) {
      throw refuse("BAD_REQUEST", "That week isn't valid.");
    }
    const live: Assignment["status"][] = ["published", "closed"];
    const [counts, ids] = await Promise.all([
      this.dueDayCounts(access, { statuses: live, dueFrom: from, dueTo: new Date(from.getTime() + 7 * DAY) }),
      this.visibleIds(access, {
        statuses: live,
        dueFrom: dayStart,
        dueTo: new Date(dayStart.getTime() + DAY),
        earliestDueFirst: true,
        limit: 300,
      }),
    ]);
    const weekDays = Array.from({ length: 6 }, (_, i) => {
      const day = new Date(from.getTime() + i * DAY + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      return { day, count: counts.get(day) ?? 0 };
    });
    const dayItems = (await this.summaries(ids)).sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime());
    return { weekStart: fromIso, weekDays, day: dayIso, dayItems };
  }

  /**
   * One class and subject (Home v3's class page): how the class is doing
   * (on time over the last 30 days, what waits to be checked), the
   * homework given to it, and the children who owe work this week.
   */
  async classView(access: HomeworkAccess, pair: TeachingPair) {
    if (access.pairs && !access.pairs.some((p) => p.sectionId === pair.sectionId && p.subjectId === pair.subjectId)) {
      throw refuse("NOT_FOUND", "That class could not be found.");
    }
    const [sec] = await db
      .select({
        sectionName: sections.name,
        className: classes.name,
        organizationId: sections.organizationId,
        schoolId: sections.schoolId,
      })
      .from(sections)
      .innerJoin(classes, eq(sections.classId, classes.id))
      .where(and(eq(sections.id, pair.sectionId), or(...access.scopes.map((s) => scopeWhere(s, SECTION_COLS)))!));
    if (!sec) throw refuse("NOT_FOUND", "That class could not be found.");

    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    // The class page is about now: what comes up next (earliest first) and
    // what was due lately (newest first), each with its own limit, so neither
    // far-off homework nor a long history can crowd out this week's.
    const base = and(
      eq(assignments.subjectId, pair.subjectId),
      eq(assignmentTargets.sectionId, pair.sectionId),
      inArray(assignments.status, ["published", "closed"]),
    );
    const pick = (where: SQL | undefined, order: SQL) =>
      db
        .select({ id: assignments.id })
        .from(assignments)
        .innerJoin(assignmentTargets, eq(assignmentTargets.assignmentId, assignments.id))
        .where(where)
        .orderBy(order)
        .limit(50);
    const [upcoming, recent] = await Promise.all([
      pick(and(base, gte(assignments.dueAt, now)), asc(assignments.dueAt)),
      pick(and(base, lt(assignments.dueAt, now), gte(assignments.dueAt, monthAgo)), desc(assignments.dueAt)),
    ]);
    const idRows = [...upcoming, ...recent];
    const ids = idRows.map((r) => r.id);

    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const [homework, subject, size, rows] = await Promise.all([
      this.summaries(ids),
      db.select({ name: subjects.name }).from(subjects).where(eq(subjects.id, pair.subjectId)),
      db
        .select({ n: count() })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.sectionId, pair.sectionId),
            inArray(studentEnrollments.enrollmentStatus, [...ACTIVE_ENROLLMENT]),
          ),
        ),
      ids.length
        ? db
            .select({
              sa: studentAssignments,
              comesBack: assignments.comesBack,
              studentId: students.id,
              firstName: students.firstName,
              middleName: students.middleName,
              lastName: students.lastName,
              rollNumber: studentEnrollments.rollNumber,
            })
            .from(studentAssignments)
            .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
            .innerJoin(studentEnrollments, eq(studentAssignments.studentEnrollmentId, studentEnrollments.id))
            .innerJoin(students, eq(studentEnrollments.studentId, students.id))
            .where(
              and(
                inArray(studentAssignments.assignmentId, ids),
                eq(studentAssignments.sectionId, pair.sectionId),
                gte(studentAssignments.effectiveDueAt, monthAgo),
                lte(studentAssignments.effectiveDueAt, now),
              ),
            )
        : Promise.resolve([]),
    ]);

    // On time: work that comes back, due in the last 30 days, done (or sent / ticked) without being late.
    const counted = rows.filter((r) => r.comesBack !== "none");
    const onTime = counted.filter(
      (r) =>
        !r.sa.isLate &&
        (r.sa.checkStatus === "done" || (r.sa.status === "submitted" && r.sa.checkStatus === null)),
    ).length;

    const owe = new Map<string, { studentId: string; name: string; rollNumber: string | null; notDone: number; incomplete: number; missing: number }>();
    for (const r of rows) {
      if (r.sa.effectiveDueAt < weekAgo) continue;
      const kind =
        r.sa.checkStatus === "not_done"
          ? "notDone"
          : r.sa.checkStatus === "incomplete"
            ? "incomplete"
            : r.sa.status === "missing"
              ? "missing"
              : null;
      if (!kind) continue;
      const entry = owe.get(r.studentId) ?? {
        studentId: r.studentId,
        name: fullName(r),
        rollNumber: r.rollNumber,
        notDone: 0,
        incomplete: 0,
        missing: 0,
      };
      entry[kind] += 1;
      owe.set(r.studentId, entry);
    }

    const mine = homework.map((h) => ({ ...h, sections: h.sections.filter((s) => s.sectionId === pair.sectionId) }));
    return {
      sectionId: pair.sectionId,
      subjectId: pair.subjectId,
      sectionName: sec.sectionName,
      className: sec.className,
      subjectName: subject[0]?.name ?? "",
      studentCount: size[0]?.n ?? 0,
      onTimePct: counted.length ? Math.round((onTime / counted.length) * 100) : null,
      toCheck: mine.reduce((n, h) => n + (h.sections[0]?.toCheck ?? 0), 0),
      homework: mine,
      owe: [...owe.values()]
        .sort((x, y) => y.notDone + y.incomplete + y.missing - (x.notDone + x.incomplete + x.missing))
        .slice(0, 20),
    };
  }

  /**
   * Give step 2: the caller's classes grouped by subject. A subject teacher
   * sees their own pairs; anyone else, every subject mapped to the classes in
   * their scope for the current year.
   */
  async givePairs(access: HomeworkAccess, academicYearId?: string) {
    const yearCond = academicYearId
      ? eq(sections.academicYearId, academicYearId)
      : sql`${sections.academicYearId} in (select ${academicYears.id} from ${academicYears} where ${academicYears.isCurrent})`;
    const scopeCond = or(...access.scopes.map((s) => scopeWhere(s, SECTION_COLS)))!;

    let pairs: { sectionId: string; subjectId: string }[];
    if (access.pairs) {
      pairs = access.pairs;
    } else {
      const rows = await db
        .select({ sectionId: sections.id, subjectId: classSubjectMappings.subjectId })
        .from(sections)
        .innerJoin(
          classSubjectMappings,
          and(
            eq(classSubjectMappings.classId, sections.classId),
            eq(classSubjectMappings.academicYearId, sections.academicYearId),
          ),
        )
        .where(and(scopeCond, yearCond));
      pairs = rows;
    }
    if (pairs.length === 0) return [];

    const sectionIds = [...new Set(pairs.map((p) => p.sectionId))];
    const secRows = await db
      .select({
        sectionId: sections.id,
        sectionName: sections.name,
        classId: classes.id,
        className: classes.name,
        classOrder: classes.numericOrder,
      })
      .from(sections)
      .innerJoin(classes, eq(sections.classId, classes.id))
      .where(and(inArray(sections.id, sectionIds), scopeCond, yearCond));
    const sizes = await db
      .select({ sectionId: studentEnrollments.sectionId, n: count() })
      .from(studentEnrollments)
      .where(
        and(
          inArray(studentEnrollments.sectionId, sectionIds),
          inArray(studentEnrollments.enrollmentStatus, [...ACTIVE_ENROLLMENT]),
        ),
      )
      .groupBy(studentEnrollments.sectionId);

    // Homework due on the next day (any subject), by section.
    const tomorrow = new Date(`${todayInIst()}T00:00:00+05:30`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dayAfter = new Date(tomorrow.getTime() + 24 * 3600 * 1000);
    const due = await db
      .select({ sectionId: assignmentTargets.sectionId, n: count() })
      .from(assignmentTargets)
      .innerJoin(assignments, eq(assignmentTargets.assignmentId, assignments.id))
      .where(
        and(
          inArray(assignmentTargets.sectionId, sectionIds),
          inArray(assignments.status, ["published", "scheduled"]),
          gte(assignments.dueAt, tomorrow),
          lt(assignments.dueAt, dayAfter),
        ),
      )
      .groupBy(assignmentTargets.sectionId);

    const subjectIds = [...new Set(pairs.map((p) => p.subjectId))];
    const subjectRows = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(inArray(subjects.id, subjectIds))
      .orderBy(asc(subjects.name));

    return subjectRows
      .map((subject) => ({
        subjectId: subject.id,
        subjectName: subject.name,
        sections: secRows
          .filter((s) => pairs.some((p) => p.subjectId === subject.id && p.sectionId === s.sectionId))
          .sort((x, y) => x.classOrder - y.classOrder || x.sectionName.localeCompare(y.sectionName))
          .map((s) => ({
            sectionId: s.sectionId,
            sectionName: s.sectionName,
            classId: s.classId,
            className: s.className,
            studentCount: sizes.find((z) => z.sectionId === s.sectionId)?.n ?? 0,
            dueTomorrow: due.find((d) => d.sectionId === s.sectionId)?.n ?? 0,
          })),
      }))
      .filter((s) => s.sections.length > 0);
  }

  /** Give step 4's starting point: this teacher's last choices for the subject and kind. */
  async giveDefaults(access: HomeworkAccess, subjectId: string, kind: HomeworkKind) {
    const [last] = await db
      .select()
      .from(assignments)
      .where(
        and(
          or(...access.scopes.map((s) => scopeWhere(atSchoolLevel(s), ASSIGNMENT_COLS)))!,
          eq(assignments.createdBy, access.userId),
          eq(assignments.subjectId, subjectId),
          eq(assignments.kind, kind),
          ne(assignments.status, "cancelled"),
        ),
      )
      .orderBy(desc(assignments.createdAt))
      .limit(1);
    if (last) {
      return {
        comesBack: last.comesBack,
        gradingMode: last.gradingMode,
        maxMarks: kind === "quiz" ? null : last.maxMarks,
        estimatedMinutes: last.estimatedMinutes,
        lastId: last.id,
      };
    }
    return {
      comesBack: KIND_COMES_BACK[kind][0]!,
      gradingMode: KIND_GRADING[kind][0]!,
      maxMarks: kind === "project" ? "20" : null,
      estimatedMinutes: null,
      lastId: null,
    };
  }

  /** One homework with its photos, sections and counts. */
  async detail(scope: DataScope, id: string) {
    const a = await this.load(db, scope, id);
    const [s] = await this.summaries([id]);
    const files = await db
      .select({ objectId: assignmentFiles.objectId })
      .from(assignmentFiles)
      .where(eq(assignmentFiles.assignmentId, id))
      .orderBy(asc(assignmentFiles.sortOrder));
    const refs = await storageService.imageRefs(a.organizationId, files.map((f) => f.objectId));
    const [q] = await db
      .select({ n: count() })
      .from(assignmentQuestions)
      .where(eq(assignmentQuestions.assignmentId, id));
    const [c] = await db
      .select({ n: count() })
      .from(assignmentComments)
      .where(and(eq(assignmentComments.assignmentId, id), eq(assignmentComments.isDeleted, false)));
    const [author] = await db.select({ name: user.name }).from(user).where(eq(user.id, a.createdBy));
    return {
      ...s!,
      details: a.kind === "reading" ? null : a.description,
      isLocked: a.isLocked,
      sourceAssignmentId: a.sourceAssignmentId,
      files: files.map((f) => refs.get(f.objectId)).filter((r): r is ImageRef => Boolean(r)),
      studentEnrollmentIds: (await this.studentTargetsOf(db, id)) ?? [],
      questionCount: q?.n ?? 0,
      commentCount: c?.n ?? 0,
      createdByName: author?.name ?? "",
    };
  }

  // ── Checking ─────────────────────────────────────────────────────────────

  private async rowsFor(ex: Executor, assignmentId: string, sectionId: string | null, saId?: string) {
    const conds = [eq(studentAssignments.assignmentId, assignmentId)];
    if (sectionId) conds.push(eq(studentAssignments.sectionId, sectionId));
    if (saId) conds.push(eq(studentAssignments.id, saId));
    return ex
      .select({
        sa: studentAssignments,
        studentId: students.id,
        firstName: students.firstName,
        middleName: students.middleName,
        lastName: students.lastName,
        rollNumber: studentEnrollments.rollNumber,
        photoObjectId: studentPhotos.objectId,
      })
      .from(studentAssignments)
      .innerJoin(studentEnrollments, eq(studentAssignments.studentEnrollmentId, studentEnrollments.id))
      .innerJoin(students, eq(studentEnrollments.studentId, students.id))
      .leftJoin(studentPhotos, eq(studentPhotos.studentId, students.id))
      .where(and(...conds));
  }

  private async fileCounts(saIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (saIds.length === 0) return out;
    const rows = await db
      .select({ saId: submissions.studentAssignmentId, n: count(submissionFiles.id) })
      .from(submissions)
      .leftJoin(submissionFiles, eq(submissionFiles.submissionId, submissions.id))
      .where(inArray(submissions.studentAssignmentId, saIds))
      .groupBy(submissions.studentAssignmentId);
    for (const r of rows) out.set(r.saId, r.n);
    return out;
  }

  private toRow(
    r: Awaited<ReturnType<HomeworkService["rowsFor"]>>[number],
    absent: Set<string>,
    files: Map<string, number>,
    photos: Map<string, ImageRef>,
  ) {
    return {
      studentAssignmentId: r.sa.id,
      studentId: r.studentId,
      name: fullName(r),
      rollNumber: r.rollNumber,
      photo: r.photoObjectId ? (photos.get(r.photoObjectId) ?? null) : null,
      status: r.sa.status,
      absentToday: absent.has(r.studentId),
      submittedAt: r.sa.submittedAt,
      isLate: r.sa.isLate,
      fileCount: files.get(r.sa.id) ?? 0,
      checkStatus: r.sa.checkStatus,
      marks: r.sa.marks,
      grade: r.sa.grade,
      remark: r.sa.remark,
      note: r.sa.note,
      checkedAt: r.sa.checkedAt,
    };
  }

  /**
   * The checking list for one section, in roll order. For work brought to
   * class, children absent today (attendance) are flagged so the screen can
   * leave them out of the count; other ways back ignore attendance.
   */
  async register(scope: DataScope, pair: TeachingPair, id: string) {
    const a = await this.load(db, scope, id);
    await this.assertPair(db, a, pair);
    if (a.status === "draft" || a.status === "scheduled") {
      throw refuse("CONFLICT", "Give the homework before checking it.");
    }
    // Independent reads run together: each is a round trip to the database.
    const [rows, att, secRows, summaries, gradeLetters] = await Promise.all([
      this.rowsFor(db, a.id, pair.sectionId),
      a.comesBack === "brought"
        ? db
            .select({ studentId: dailyAttendanceStatus.studentId })
            .from(dailyAttendanceStatus)
            .where(
              and(
                eq(dailyAttendanceStatus.sectionId, pair.sectionId),
                eq(dailyAttendanceStatus.date, todayInIst()),
                eq(dailyAttendanceStatus.status, "absent"),
              ),
            )
        : Promise.resolve([] as { studentId: string }[]),
      db
        .select({ sectionName: sections.name, className: classes.name })
        .from(sections)
        .innerJoin(classes, eq(sections.classId, classes.id))
        .where(eq(sections.id, pair.sectionId)),
      this.summaries([a.id]),
      a.gradingMode === "grade" ? this.gradeLetters(db, a.gradingScaleId) : Promise.resolve([] as string[]),
    ]);
    const absent = new Set(att.map((r) => r.studentId));
    const [files, photos] = await Promise.all([
      this.fileCounts(rows.map((r) => r.sa.id)),
      storageService.imageRefs(a.organizationId, rows.map((r) => r.photoObjectId)),
    ]);
    const sec = secRows[0];
    const summary = summaries[0];
    return {
      homework: summary!,
      sectionId: pair.sectionId,
      sectionName: sec?.sectionName ?? "",
      className: sec?.className ?? "",
      gradeLetters,
      rows: rows
        .sort((x, y) => compareRoll(x.rollNumber, y.rollNumber) || fullName(x).localeCompare(fullName(y)))
        .map((r) => this.toRow(r, absent, files, photos)),
    };
  }

  /** Validates one result against the homework's grading and returns the columns to write. */
  private resultColumns(a: Assignment, letters: string[], r: CheckResultInput) {
    const graded = r.checkStatus === "done" || r.checkStatus === "incomplete";
    let marks: string | null = null;
    let grade: string | null = null;
    let remark: CheckResultInput["remark"] = null;
    if (graded && a.gradingMode === "marks" && r.marks != null) {
      if (Number(r.marks) > Number(a.maxMarks ?? "0")) {
        throw refuse("BAD_REQUEST", `Marks can't be more than ${Number(a.maxMarks)}.`);
      }
      marks = r.marks;
    }
    if (graded && a.gradingMode === "grade" && r.grade) {
      if (!letters.includes(r.grade)) throw refuse("BAD_REQUEST", "That grade isn't one of the school's.");
      grade = r.grade;
    }
    if (graded && a.gradingMode === "remark") remark = r.remark ?? null;
    return { marks, grade, remark };
  }

  /**
   * Saves the checking list. Idempotent: each row is set to exactly what was
   * sent, so a retry after a dropped connection writes the same thing. A null
   * check status clears the result. Saving makes results visible to students.
   */
  async saveRegister(scope: DataScope, userId: string, input: SaveRegisterInput) {
    return db.transaction(async (tx) => {
      const a = await this.load(tx, scope, input.id);
      await this.assertPair(tx, a, { sectionId: input.sectionId, subjectId: input.subjectId });
      if (a.status !== "published" && a.status !== "closed") {
        throw refuse("CONFLICT", "Only a given homework can be checked.");
      }
      if (a.comesBack !== "brought" && a.comesBack !== "sent") {
        throw refuse("CONFLICT", "Nothing comes back for this homework, so there is nothing to check.");
      }
      const letters = a.gradingMode === "grade" ? await this.gradeLetters(tx, a.gradingScaleId) : [];
      const ids = input.results.map((r) => r.studentAssignmentId);
      const existing = await tx
        .select()
        .from(studentAssignments)
        .where(
          and(
            inArray(studentAssignments.id, ids),
            eq(studentAssignments.assignmentId, a.id),
            eq(studentAssignments.sectionId, input.sectionId),
          ),
        );
      if (existing.length !== new Set(ids).size) {
        throw refuse("NOT_FOUND", "One of the students is not on this list.");
      }
      const now = new Date();
      // One UPDATE for the whole list: a round trip per child made a class of
      // 40 take many seconds against a remote database (2026-11-08 walk).
      const rows = input.results.map((r) => {
        const sa = existing.find((e) => e.id === r.studentAssignmentId)!;
        const note = r.note === undefined ? sa.note : r.note;
        if (r.checkStatus === null) {
          const back = sa.submittedAt
            ? "submitted"
            : a.comesBack === "sent" && sa.effectiveCloseAt <= now
              ? "missing"
              : "assigned";
          return {
            id: sa.id,
            status: back,
            checkStatus: null,
            marks: null,
            grade: null,
            remark: null,
            note,
            checkedBy: null,
            checkedAt: null,
            changedAt: (sa.status === back ? sa.statusChangedAt : now).toISOString(),
          };
        }
        const cols = this.resultColumns(a, letters, r);
        return {
          id: sa.id,
          status: "checked",
          checkStatus: r.checkStatus,
          marks: cols.marks,
          grade: cols.grade,
          remark: cols.remark,
          note,
          checkedBy: userId,
          checkedAt: now.toISOString(),
          changedAt: (sa.status === "checked" ? sa.statusChangedAt : now).toISOString(),
        };
      });
      await tx.execute(sql`
        UPDATE student_assignments AS sa SET
          status = v.status::student_assignment_status,
          check_status = v.check_status::homework_check_status,
          marks = v.marks::numeric,
          grade = v.grade,
          remark = v.remark::homework_remark,
          note = v.note,
          checked_by = v.checked_by,
          checked_at = v.checked_at::timestamptz,
          status_changed_at = v.changed_at::timestamptz,
          updated_at = now()
        FROM (VALUES ${sql.join(
          rows.map(
            (r) =>
              sql`(${r.id}::uuid, ${r.status}::text, ${r.checkStatus}::text, ${r.marks}::text, ${r.grade}::text, ${r.remark}::text, ${r.note}::text, ${r.checkedBy}::text, ${r.checkedAt}::text, ${r.changedAt}::text)`,
          ),
          sql`, `,
        )}) AS v(id, status, check_status, marks, grade, remark, note, checked_by, checked_at, changed_at)
        WHERE sa.id = v.id AND sa.assignment_id = ${a.id}
      `);
      if (!a.isLocked) await tx.update(assignments).set({ isLocked: true }).where(eq(assignments.id, a.id));

      const all = await tx
        .select({ status: studentAssignments.status, checkStatus: studentAssignments.checkStatus })
        .from(studentAssignments)
        .where(
          and(eq(studentAssignments.assignmentId, a.id), eq(studentAssignments.sectionId, input.sectionId)),
        );
      const c = (s: CheckResultInput["checkStatus"]) => all.filter((x) => x.checkStatus === s).length;
      return {
        saved: input.results.length,
        counts: {
          done: c("done"),
          incomplete: c("incomplete"),
          notDone: c("not_done"),
          absent: c("absent"),
          unchecked: c(null),
        },
      };
    });
  }

  private async loadStudentAssignment(ex: Executor, scope: DataScope, saId: string) {
    const [row] = await ex
      .select({ sa: studentAssignments, a: assignments })
      .from(studentAssignments)
      .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
      .where(and(eq(studentAssignments.id, saId), scopeWhere(atSchoolLevel(scope), SA_COLS)));
    if (!row) throw refuse("NOT_FOUND", "That student's homework could not be found.");
    return row;
  }

  /** The pair names the CHILD's section and the homework's subject. */
  private assertChildPair(row: { sa: StudentAssignmentRow; a: Assignment }, pair: TeachingPair) {
    if (row.a.subjectId !== pair.subjectId || row.sa.sectionId !== pair.sectionId) {
      throw refuse("NOT_FOUND", "That student's homework could not be found.");
    }
  }

  /** One child's homework for the teacher: what they sent and the result. */
  async studentHomework(scope: DataScope, pair: TeachingPair, saId: string) {
    const row = await this.loadStudentAssignment(db, scope, saId);
    this.assertChildPair(row, pair);
    const [r] = await this.rowsFor(db, row.a.id, null, saId);
    const [sub] = await db.select().from(submissions).where(eq(submissions.studentAssignmentId, saId));
    const files = sub
      ? await db
          .select({ objectId: submissionFiles.objectId })
          .from(submissionFiles)
          .where(eq(submissionFiles.submissionId, sub.id))
          .orderBy(asc(submissionFiles.sortOrder))
      : [];
    const refs = await storageService.imageRefs(row.a.organizationId, [
      ...files.map((f) => f.objectId),
      r!.photoObjectId,
    ]);
    return {
      ...this.toRow(r!, new Set(), new Map([[saId, files.length]]), refs),
      homeworkId: row.a.id,
      sectionId: row.sa.sectionId,
      dueAt: row.sa.effectiveDueAt,
      closeAt: row.sa.effectiveCloseAt,
      tickedBy: row.sa.tickedBy,
      submission: sub
        ? {
            bodyText: sub.bodyText,
            submittedAt: sub.submittedAt,
            isLate: sub.isLate,
            files: files.map((f) => refs.get(f.objectId)).filter((x): x is ImageRef => Boolean(x)),
          }
        : null,
    };
  }

  /**
   * Sends work sent in the app back to redo, with a note the student sees.
   * It reopens even past the close time: the child gets a day from now.
   */
  async sendBack(scope: DataScope, pair: TeachingPair, saId: string, note: string) {
    await db.transaction(async (tx) => {
      const row = await this.loadStudentAssignment(tx, scope, saId);
      this.assertChildPair(row, pair);
      if (row.a.comesBack !== "sent") throw refuse("CONFLICT", "Only work sent in the app can be sent back.");
      if (row.a.status === "cancelled") throw refuse("CONFLICT", "This homework was cancelled.");
      if (row.sa.status !== "submitted" && row.sa.status !== "checked") {
        throw refuse("CONFLICT", "Nothing has been sent yet, so there is nothing to send back.");
      }
      const now = new Date();
      const minClose = new Date(now.getTime() + 24 * 3600 * 1000);
      await tx
        .update(studentAssignments)
        .set({
          status: "redo",
          note,
          checkStatus: null,
          marks: null,
          grade: null,
          remark: null,
          checkedBy: null,
          checkedAt: null,
          statusChangedAt: now,
          effectiveCloseAt: row.sa.effectiveCloseAt < minClose ? minClose : row.sa.effectiveCloseAt,
        })
        .where(eq(studentAssignments.id, saId));
      if (row.a.status === "closed") {
        await tx.update(assignments).set({ status: "published" }).where(eq(assignments.id, row.a.id));
      }
    });
    return this.studentHomework(scope, pair, saId);
  }

  /** The teacher's "Mark read" (or its undo) on work that comes back as a tick. */
  async markTick(scope: DataScope, pair: TeachingPair, saId: string, ticked: boolean) {
    await db.transaction(async (tx) => {
      const row = await this.loadStudentAssignment(tx, scope, saId);
      this.assertChildPair(row, pair);
      if (row.a.comesBack !== "tick") throw refuse("CONFLICT", "This homework isn't ticked off.");
      const now = new Date();
      await tx
        .update(studentAssignments)
        .set(
          ticked
            ? {
                status: "submitted",
                submittedAt: row.sa.submittedAt ?? now,
                tickedBy: row.sa.tickedBy ?? "teacher",
                isLate: row.sa.submittedAt ? row.sa.isLate : now > row.sa.effectiveDueAt,
                statusChangedAt: now,
              }
            : { status: "assigned", submittedAt: null, tickedBy: null, isLate: false, statusChangedAt: now },
        )
        .where(eq(studentAssignments.id, saId));
    });
    return this.studentHomework(scope, pair, saId);
  }

  // ── Comments ─────────────────────────────────────────────────────────────

  private async commentRows(assignmentId: string, studentAssignmentId: string | null, viewerId: string) {
    const rows = await db
      .select({ c: assignmentComments, authorName: user.name })
      .from(assignmentComments)
      .innerJoin(user, eq(assignmentComments.authorUserId, user.id))
      .where(
        and(
          eq(assignmentComments.assignmentId, assignmentId),
          eq(assignmentComments.isDeleted, false),
          studentAssignmentId
            ? eq(assignmentComments.studentAssignmentId, studentAssignmentId)
            : isNull(assignmentComments.studentAssignmentId),
        ),
      )
      .orderBy(asc(assignmentComments.createdAt));
    const staffIds = await this.staffAuthors(rows.map((r) => r.c.authorUserId));
    return rows.map((r) => ({
      id: r.c.id,
      assignmentId: r.c.assignmentId,
      studentAssignmentId: r.c.studentAssignmentId,
      authorName: r.authorName,
      fromStaff: staffIds.has(r.c.authorUserId),
      isMine: r.c.authorUserId === viewerId,
      body: r.c.body,
      createdAt: r.c.createdAt,
    }));
  }

  /** Authors who are staff: anyone who is not a family login. */
  private async staffAuthors(userIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Set();
    const family = await db
      .selectDistinct({ userId: studentPortalAccess.userId })
      .from(studentPortalAccess)
      .where(inArray(studentPortalAccess.userId, ids));
    const familyIds = new Set(family.map((r) => r.userId));
    return new Set(ids.filter((id) => !familyIds.has(id)));
  }

  /**
   * Staff read: the class question board, or ONE child's private thread.
   * Never every private thread at once (the old leak).
   */
  async listComments(scope: DataScope, viewerId: string, assignmentId: string, studentAssignmentId?: string) {
    const a = await this.load(db, scope, assignmentId);
    if (studentAssignmentId) {
      const row = await this.loadStudentAssignment(db, scope, studentAssignmentId);
      if (row.a.id !== a.id) throw refuse("NOT_FOUND", "That student's homework could not be found.");
    }
    return this.commentRows(a.id, studentAssignmentId ?? null, viewerId);
  }

  async postComment(
    scope: DataScope,
    userId: string,
    input: { assignmentId: string; studentAssignmentId?: string; body: string },
  ) {
    const a = await this.load(db, scope, input.assignmentId);
    if (input.studentAssignmentId) {
      const row = await this.loadStudentAssignment(db, scope, input.studentAssignmentId);
      if (row.a.id !== a.id) throw refuse("NOT_FOUND", "That student's homework could not be found.");
    }
    await db.insert(assignmentComments).values({
      organizationId: a.organizationId,
      schoolId: a.schoolId,
      assignmentId: a.id,
      studentAssignmentId: input.studentAssignmentId ?? null,
      authorUserId: userId,
      body: input.body,
    });
    return this.commentRows(a.id, input.studentAssignmentId ?? null, userId);
  }

  /** Staff remove any comment on a homework in their scope (moderation). */
  async deleteComment(scope: DataScope, commentId: string): Promise<void> {
    const [row] = await db
      .select({ id: assignmentComments.id })
      .from(assignmentComments)
      .where(
        and(
          eq(assignmentComments.id, commentId),
          scopeWhere(atSchoolLevel(scope), {
            organizationId: assignmentComments.organizationId,
            schoolId: assignmentComments.schoolId,
          }),
        ),
      );
    if (!row) throw refuse("NOT_FOUND", "That comment could not be found.");
    await db.update(assignmentComments).set({ isDeleted: true }).where(eq(assignmentComments.id, commentId));
  }

  // ── The student side (ADR-062: one child per call) ───────────────────────

  private async portalRow(ownedStudentIds: readonly string[], studentId: string, saId: string) {
    const child = await resolvePortalChild(ownedStudentIds, studentId);
    const [row] = await db
      .select({ sa: studentAssignments, a: assignments, enrollmentStudentId: studentEnrollments.studentId })
      .from(studentAssignments)
      .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
      .innerJoin(studentEnrollments, eq(studentAssignments.studentEnrollmentId, studentEnrollments.id))
      .where(
        and(
          eq(studentAssignments.id, saId),
          eq(studentEnrollments.studentId, child.studentId),
          eq(studentAssignments.organizationId, child.organizationId),
          inArray(assignments.status, ["published", "closed"]),
        ),
      );
    if (!row) throw refuse("NOT_FOUND", "That homework could not be found.");
    return { child, ...row };
  }

  private portalItem(
    r: { sa: StudentAssignmentRow; a: Assignment; subjectName: string; teacherName: string },
    now: Date,
    newReplies = 0,
  ) {
    return {
      studentAssignmentId: r.sa.id,
      kind: r.a.kind,
      comesBack: r.a.comesBack,
      gradingMode: r.a.gradingMode,
      maxMarks: r.a.maxMarks,
      title: r.a.title,
      book: r.a.kind === "reading" ? r.a.topic : null,
      subjectName: r.subjectName,
      teacherName: r.teacherName,
      estimatedMinutes: r.a.estimatedMinutes,
      givenAt: r.a.publishedAt ?? r.a.createdAt,
      dueAt: r.sa.effectiveDueAt,
      closeAt: r.sa.effectiveCloseAt,
      word: studentWord(r.sa, r.a.comesBack, now),
      checkStatus: r.sa.checkStatus,
      marks: r.sa.marks,
      grade: r.sa.grade,
      remark: r.sa.remark,
      hasNote: Boolean(r.sa.note),
      // A result or a send-back the student hasn't opened since it happened.
      isNew:
        (r.sa.status === "checked" || r.sa.status === "redo") &&
        (r.sa.resultSeenAt === null ||
          r.sa.resultSeenAt < r.sa.statusChangedAt ||
          (r.sa.checkedAt !== null && r.sa.resultSeenAt < r.sa.checkedAt)),
      newReplies,
      canUntick:
        r.a.comesBack === "tick" &&
        r.sa.status === "submitted" &&
        r.sa.tickedBy === "student" &&
        now <= r.sa.effectiveDueAt,
    };
  }

  /** The child's homework, newest due first within each group. */
  async portalList(ownedStudentIds: readonly string[], studentId: string, filter: "open" | "done" | "all") {
    const child = await resolvePortalChild(ownedStudentIds, studentId);
    const rows = await db
      .select({ sa: studentAssignments, a: assignments, subjectName: subjects.name, teacherName: user.name })
      .from(studentAssignments)
      .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
      .innerJoin(subjects, eq(assignments.subjectId, subjects.id))
      .innerJoin(user, eq(assignments.createdBy, user.id))
      .where(
        and(
          eq(studentAssignments.studentEnrollmentId, child.enrollmentId),
          eq(studentAssignments.organizationId, child.organizationId),
          inArray(assignments.status, ["published", "closed"]),
        ),
      )
      .orderBy(desc(studentAssignments.effectiveDueAt))
      .limit(300);
    const now = new Date();
    const replies = await this.newStaffReplies(rows.map((r) => ({ sa: r.sa, assignmentId: r.a.id })));
    const items = rows.map((r) => this.portalItem(r, now, replies.get(r.sa.id) ?? 0));
    if (filter === "open") return items.filter((i) => ["to_do", "redo", "sent", "late", "with_teacher"].includes(i.word));
    if (filter === "done") return items.filter((i) => ["checked", "missed", "over"].includes(i.word));
    return items;
  }

  async portalGet(ownedStudentIds: readonly string[], studentId: string, saId: string) {
    const { sa, a } = await this.portalRow(ownedStudentIds, studentId, saId);
    // Every read below depends only on the row above, so they run together:
    // one round trip of waiting instead of seven on a slow phone network.
    const [metaRows, teacherFiles, subRows, quizCount, attemptRows, replies] = await Promise.all([
      db
        .select({ subjectName: subjects.name, teacherName: user.name })
        .from(assignments)
        .innerJoin(subjects, eq(assignments.subjectId, subjects.id))
        .innerJoin(user, eq(assignments.createdBy, user.id))
        .where(eq(assignments.id, a.id)),
      db
        .select({ objectId: assignmentFiles.objectId })
        .from(assignmentFiles)
        .where(eq(assignmentFiles.assignmentId, a.id))
        .orderBy(asc(assignmentFiles.sortOrder)),
      db.select().from(submissions).where(eq(submissions.studentAssignmentId, sa.id)),
      a.kind === "quiz"
        ? db.select({ n: count() }).from(assignmentQuestions).where(eq(assignmentQuestions.assignmentId, a.id))
        : Promise.resolve([]),
      a.kind === "quiz"
        ? db
            .select({ id: questionAttempts.id, status: questionAttempts.status })
            .from(questionAttempts)
            .where(eq(questionAttempts.studentAssignmentId, sa.id))
        : Promise.resolve([]),
      this.newStaffReplies([{ sa, assignmentId: a.id }]),
    ]);
    const meta = metaRows[0];
    const sub = subRows[0];
    const subFiles = sub
      ? await db
          .select({ objectId: submissionFiles.objectId })
          .from(submissionFiles)
          .where(eq(submissionFiles.submissionId, sub.id))
          .orderBy(asc(submissionFiles.sortOrder))
      : [];
    const refs = await storageService.imageRefs(a.organizationId, [
      ...teacherFiles.map((f) => f.objectId),
      ...subFiles.map((f) => f.objectId),
    ]);
    const pick = (ids: { objectId: string }[]) =>
      ids.map((f) => refs.get(f.objectId)).filter((x): x is ImageRef => Boolean(x));
    const quiz =
      a.kind === "quiz"
        ? {
            questionCount: quizCount[0]?.n ?? 0,
            attemptId: attemptRows[0]?.id ?? null,
            attemptStatus: attemptRows[0]?.status ?? null,
          }
        : null;
    const now = new Date();
    return {
      ...this.portalItem({ sa, a, subjectName: meta!.subjectName, teacherName: meta!.teacherName }, now, replies.get(sa.id) ?? 0),
      details: a.kind === "reading" ? null : a.description,
      files: pick(teacherFiles),
      note: sa.note,
      canSend: this.canSend(a, sa, now),
      submission: sub
        ? { bodyText: sub.bodyText, submittedAt: sub.submittedAt, isLate: sub.isLate, files: pick(subFiles) }
        : null,
      quiz,
    };
  }

  /**
   * Teacher messages each child hasn't read yet: on the class board and in the
   * child's own thread, written after they last opened Questions.
   */
  private async newStaffReplies(rows: { sa: StudentAssignmentRow; assignmentId: string }[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (rows.length === 0) return out;
    const comments = await db
      .select({
        assignmentId: assignmentComments.assignmentId,
        studentAssignmentId: assignmentComments.studentAssignmentId,
        authorUserId: assignmentComments.authorUserId,
        createdAt: assignmentComments.createdAt,
      })
      .from(assignmentComments)
      .where(
        and(
          inArray(assignmentComments.assignmentId, [...new Set(rows.map((r) => r.assignmentId))]),
          eq(assignmentComments.isDeleted, false),
          or(
            isNull(assignmentComments.studentAssignmentId),
            inArray(assignmentComments.studentAssignmentId, rows.map((r) => r.sa.id)),
          ),
        ),
      );
    if (comments.length === 0) return out;
    const staff = await this.staffAuthors(comments.map((c) => c.authorUserId));
    for (const { sa, assignmentId } of rows) {
      const seen = sa.commentsSeenAt;
      const n = comments.filter(
        (c) =>
          c.assignmentId === assignmentId &&
          (c.studentAssignmentId === null || c.studentAssignmentId === sa.id) &&
          staff.has(c.authorUserId) &&
          (seen === null || c.createdAt > seen),
      ).length;
      if (n > 0) out.set(sa.id, n);
    }
    return out;
  }

  private canSend(a: Assignment, sa: StudentAssignmentRow, now: Date): boolean {
    return (
      a.comesBack === "sent" &&
      a.status === "published" &&
      now <= sa.effectiveCloseAt &&
      (sa.status === "assigned" || sa.status === "submitted" || sa.status === "redo")
    );
  }

  async portalMarkViewed(ownedStudentIds: readonly string[], studentId: string, saId: string) {
    const { sa } = await this.portalRow(ownedStudentIds, studentId, saId);
    const now = new Date();
    // The first look, and having seen the latest result or send-back.
    const seesResult = sa.status === "checked" || sa.status === "redo";
    if (!sa.firstViewedAt || seesResult) {
      await db
        .update(studentAssignments)
        .set({ firstViewedAt: sa.firstViewedAt ?? now, ...(seesResult ? { resultSeenAt: now } : {}) })
        .where(eq(studentAssignments.id, sa.id));
    }
  }

  /** Tick (until the close time) or untick (a student's own tick, until the due time). */
  async portalTick(ownedStudentIds: readonly string[], studentId: string, saId: string, ticked: boolean) {
    const { sa, a } = await this.portalRow(ownedStudentIds, studentId, saId);
    if (a.comesBack !== "tick") throw refuse("CONFLICT", "This homework isn't ticked off.");
    const now = new Date();
    if (ticked) {
      if (sa.status === "submitted") return this.portalGet(ownedStudentIds, studentId, saId);
      if (a.status !== "published" || now > sa.effectiveCloseAt) {
        throw refuse("CONFLICT", "It's past the time to tick this one.");
      }
      await db
        .update(studentAssignments)
        .set({
          status: "submitted",
          submittedAt: now,
          tickedBy: "student",
          isLate: now > sa.effectiveDueAt,
          statusChangedAt: now,
        })
        .where(eq(studentAssignments.id, sa.id));
    } else {
      if (sa.status !== "submitted") return this.portalGet(ownedStudentIds, studentId, saId);
      if (sa.tickedBy !== "student" || now > sa.effectiveDueAt) {
        throw refuse("CONFLICT", "This tick can't be undone any more.");
      }
      await db
        .update(studentAssignments)
        .set({ status: "assigned", submittedAt: null, tickedBy: null, isLate: false, statusChangedAt: now })
        .where(eq(studentAssignments.id, sa.id));
    }
    return this.portalGet(ownedStudentIds, studentId, saId);
  }

  /** Upload links for the child's photos, tied to this homework. */
  async portalUploadTickets(
    userId: string,
    ownedStudentIds: readonly string[],
    studentId: string,
    saId: string,
    files: UploadRequest[],
  ) {
    const { sa, a } = await this.portalRow(ownedStudentIds, studentId, saId);
    if (!this.canSend(a, sa, new Date())) throw refuse("CONFLICT", "This homework isn't taking work now.");
    return storageService.createUploads({
      organizationId: a.organizationId,
      schoolId: a.schoolId,
      purpose: STUDENT_FILE,
      parentId: sa.id,
      uploadedBy: userId,
      files,
    });
  }

  /**
   * Sends (or replaces) the child's work. One submission per child: until
   * it is checked, sending again replaces the text and photos; photos no
   * longer used go to the storage sweeper.
   */
  async portalSend(userId: string, ownedStudentIds: readonly string[], input: PortalSendInput) {
    const { sa, a } = await this.portalRow(ownedStudentIds, input.studentId, input.studentAssignmentId);
    const now = new Date();
    if (!this.canSend(a, sa, now)) {
      if (sa.status === "checked") throw refuse("CONFLICT", "This has been checked already.");
      throw refuse("CONFLICT", "This homework isn't taking work now.");
    }
    await storageService.ensureReady(userId, input.fileObjectIds);
    const isLate = now > sa.effectiveDueAt;
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(studentAssignments)
        .where(eq(studentAssignments.id, sa.id))
        .for("update");
      if (!locked || locked.status === "checked" || locked.status === "missing") {
        throw refuse("CONFLICT", "This homework isn't taking work now.");
      }
      const [prev] = await tx.select().from(submissions).where(eq(submissions.studentAssignmentId, sa.id));
      const before = prev
        ? (
            await tx
              .select({ objectId: submissionFiles.objectId })
              .from(submissionFiles)
              .where(eq(submissionFiles.submissionId, prev.id))
          ).map((r) => r.objectId)
        : [];
      await storageService.attach(tx, {
        organizationId: a.organizationId,
        purpose: STUDENT_FILE,
        parentId: sa.id,
        userId,
        objectIds: input.fileObjectIds,
      });
      let submissionId: string;
      if (prev) {
        await tx
          .update(submissions)
          .set({ bodyText: input.bodyText ?? null, submittedByUserId: userId, submittedAt: now, isLate })
          .where(eq(submissions.id, prev.id));
        await tx.delete(submissionFiles).where(eq(submissionFiles.submissionId, prev.id));
        submissionId = prev.id;
      } else {
        const [created] = await tx
          .insert(submissions)
          .values({
            organizationId: a.organizationId,
            schoolId: a.schoolId,
            studentAssignmentId: sa.id,
            bodyText: input.bodyText ?? null,
            submittedByUserId: userId,
            submittedAt: now,
            isLate,
          })
          .returning({ id: submissions.id });
        submissionId = created!.id;
      }
      if (input.fileObjectIds.length) {
        await tx.insert(submissionFiles).values(
          input.fileObjectIds.map((objectId, i) => ({
            organizationId: a.organizationId,
            schoolId: a.schoolId,
            submissionId,
            objectId,
            sortOrder: i,
          })),
        );
      }
      await storageService.markDeleted(
        tx,
        a.organizationId,
        before.filter((id) => !input.fileObjectIds.includes(id)),
      );
      await tx
        .update(studentAssignments)
        .set({ status: "submitted", submittedAt: now, isLate, statusChangedAt: now })
        .where(eq(studentAssignments.id, sa.id));
      if (!a.isLocked) await tx.update(assignments).set({ isLocked: true }).where(eq(assignments.id, a.id));
    });
    return this.portalGet(ownedStudentIds, input.studentId, input.studentAssignmentId);
  }

  /** The class question board plus the child's own private thread. */
  async portalComments(userId: string, ownedStudentIds: readonly string[], studentId: string, saId: string) {
    const { a, sa } = await this.portalRow(ownedStudentIds, studentId, saId);
    const [board, mine] = await Promise.all([
      this.commentRows(a.id, null, userId),
      this.commentRows(a.id, sa.id, userId),
      db.update(studentAssignments).set({ commentsSeenAt: new Date() }).where(eq(studentAssignments.id, sa.id)),
    ]);
    return [...board, ...mine].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  }

  async portalPostComment(
    userId: string,
    ownedStudentIds: readonly string[],
    input: { studentId: string; studentAssignmentId: string; toClass: boolean; body: string },
  ) {
    const { a, sa } = await this.portalRow(ownedStudentIds, input.studentId, input.studentAssignmentId);
    await db.insert(assignmentComments).values({
      organizationId: a.organizationId,
      schoolId: a.schoolId,
      assignmentId: a.id,
      studentAssignmentId: input.toClass ? null : sa.id,
      authorUserId: userId,
      body: input.body,
    });
    return this.portalComments(userId, ownedStudentIds, input.studentId, input.studentAssignmentId);
  }

  // ── Worker hooks (ADR-040) ───────────────────────────────────────────────

  /** Scheduled homework whose moment has come. */
  async dueScheduled(limit: number): Promise<string[]> {
    const rows = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.status, "scheduled"), lte(assignments.publishAt, new Date())))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /** Gives one scheduled homework. Null when it is no longer scheduled. */
  async publishScheduled(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [a] = await tx.select().from(assignments).where(eq(assignments.id, id)).for("update");
      if (!a || a.status !== "scheduled") return false;
      await this.giveNow(tx, a);
      return true;
    });
  }

  /** Work sent in the app, past its close time, with children who sent nothing. */
  async sweepMissing(limit: number): Promise<number> {
    const rows = await db
      .selectDistinct({ assignmentId: studentAssignments.assignmentId })
      .from(studentAssignments)
      .innerJoin(assignments, eq(studentAssignments.assignmentId, assignments.id))
      .where(
        and(
          eq(assignments.comesBack, "sent"),
          inArray(assignments.status, ["published", "closed"]),
          inArray(studentAssignments.status, ["assigned", "redo"]),
          lte(studentAssignments.effectiveCloseAt, new Date()),
        ),
      )
      .limit(limit);
    let n = 0;
    for (const r of rows) n += await this.markMissing(db, r.assignmentId);
    return n;
  }

  // ── Owner resolution (the router's gate) ─────────────────────────────────

  async getAssignmentOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: assignments.schoolId })
      .from(assignments)
      .where(and(eq(assignments.id, id), eq(assignments.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }

  async getStudentAssignmentOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: studentAssignments.schoolId })
      .from(studentAssignments)
      .where(and(eq(studentAssignments.id, id), eq(studentAssignments.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }

  async getCommentOwnerId(organizationId: string, id: string): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: assignmentComments.schoolId })
      .from(assignmentComments)
      .where(and(eq(assignmentComments.id, id), eq(assignmentComments.organizationId, organizationId)));
    return row?.schoolId ?? null;
  }

  /** A caller's open subject_teacher pairs in an organisation. */
  async teachingPairs(organizationId: string, userId: string): Promise<TeachingPair[]> {
    const rows = await db
      .select({ sectionId: sectionTeacherAssignments.sectionId, subjectId: sectionTeacherAssignments.subjectId })
      .from(sectionTeacherAssignments)
      .where(
        and(
          eq(sectionTeacherAssignments.organizationId, organizationId),
          eq(sectionTeacherAssignments.userId, userId),
          eq(sectionTeacherAssignments.role, "subject_teacher"),
          isNull(sectionTeacherAssignments.effectiveTo),
        ),
      );
    return rows
      .filter((r): r is TeachingPair => Boolean(r.subjectId))
      .map((r) => ({ sectionId: r.sectionId, subjectId: r.subjectId }));
  }
}

export const homeworkService = new HomeworkService();
