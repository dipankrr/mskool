import { beforeAll, describe, expect, it } from "vitest";

/**
 * HOMEWORK (ADR-064) — the proofs against REAL Postgres:
 *
 *   - Give: one homework for several sections, each child resolved with
 *     their section; each type's allowed ways back and grading; Undo.
 *   - The gates: a subject teacher gives only to their own pairs, EVERY
 *     section checked, and reads only their own pairs.
 *   - Checking: the list in roll order, results validated against grading,
 *     idempotent saves, clearing, and the lock on how it comes back.
 *   - The student side: the six words, tick/untick, one submission replaced
 *     until checked, Redo, files linked and let go.
 *   - Comments: the staff board never carries a private thread.
 *   - The worker: scheduled giving, missing for work sent in the app, and
 *     work brought to class never marked missing.
 *
 * FIXTURE ISOLATION: borrows the authz world (orgs `authz-itg-a/b`), adds
 * only homework rows and portal ACCESS rows keyed on the run. Other suites
 * pin 6-A's exact roster, so no students are created.
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  assignmentFiles,
  assignments,
  storageObjects,
  studentAssignments,
  studentPortalAccess,
  submissionFiles,
  submissions,
} from "@repo/db/schema";
import { homeworkService, homeworkWorkerService, storageService, studentWord } from "@repo/services";
import { and, eq, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { TINY_PNG, useMemoryStore } from "./storage-fixtures";
import { buildWorld, findOrCreateUser, type IntegrationWorld } from "./world";

const RUN = Date.now();
const title = (s: string) => `ITG HW ${RUN} ${s}`;

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

const hoursAhead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

type Call = (path: string, input: unknown) => Promise<any>;
function callerFor(userId: string): Call {
  const inner = (appRouter as unknown as {
    createCaller: (ctx: unknown) => Record<string, unknown>;
  }).createCaller({ db, session: { user: { id: userId } }, req: { headers: {} }, res: {} });
  return (path, input) => {
    const fn = path.split(".").reduce<any>((acc, key) => acc?.[key], inner);
    if (typeof fn !== "function") return Promise.reject(new Error(`no router path "${path}"`));
    return fn(input);
  };
}

async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (cause) {
    const e = cause as { code?: string; message?: string };
    return { code: e.code ?? "?", message: e.message ?? "" };
  }
  throw new Error("expected the call to be refused");
}

describe("homework (ADR-064)", () => {
  let w: IntegrationWorld;
  let scopeA1: DataScope;
  let scopeB1: DataScope;
  let pair6a: { sectionId: string; subjectId: string };
  let store: ReturnType<typeof useMemoryStore>;
  let studentUserId: string;
  let ownedSaOf: (homeworkId: string) => Promise<typeof studentAssignments.$inferSelect>;

  const upload = async (purpose: "homework_teacher_file" | "homework_student_file", userId: string, parentId: string | null) => {
    const [ticket] = await storageService.createUploads({
      organizationId: w.orgAId,
      schoolId: w.schoolA1Id,
      purpose,
      parentId,
      uploadedBy: userId,
      files: [{ contentType: "image/png", sizeBytes: TINY_PNG.length }],
    });
    await store.put("private", `tmp/${ticket!.objectId}`, TINY_PNG, {
      contentType: "image/png",
      cacheControl: "no-store",
    });
    return ticket!.objectId;
  };

  const giveHomework = (overrides: Record<string, unknown> = {}) =>
    homeworkService.create(scopeA1, w.users.adminA, {
      kind: "homework",
      subjectId: w.subjectA1MathId,
      sectionIds: [w.section6aId],
      title: title("Ex 4.3"),
      comesBack: "brought",
      gradingMode: "none",
      dueAt: hoursAhead(20),
      give: true,
      ...overrides,
    } as Parameters<typeof homeworkService.create>[2]);

  beforeAll(async () => {
    w = await buildWorld();
    store = useMemoryStore();
    scopeA1 = schoolScope(w.orgAId, w.schoolA1Id);
    scopeB1 = schoolScope(w.orgBId, w.schoolB1Id);
    pair6a = { sectionId: w.section6aId, subjectId: w.subjectA1MathId };
    const student = await findOrCreateUser(`hw-student-${RUN}`);
    studentUserId = student.id;
    await db
      .insert(studentPortalAccess)
      .values({ userId: studentUserId, studentId: w.ownedStudentId, guardianId: null })
      .onConflictDoNothing();
    ownedSaOf = async (homeworkId) => {
      const [row] = await db
        .select()
        .from(studentAssignments)
        .where(
          and(
            eq(studentAssignments.assignmentId, homeworkId),
            eq(studentAssignments.studentEnrollmentId, w.enrollmentOwnedId),
          ),
        );
      return row!;
    };
  });

  // ── Give ────────────────────────────────────────────────────────────────

  it("gives one homework to two sections; every child carries their section", async () => {
    const hw = await giveHomework({ sectionIds: [w.section6aId, w.section6bId], title: title("two classes") });
    expect(hw.status).toBe("published");
    expect(hw.sections.map((s) => s.sectionId).sort()).toEqual([w.section6aId, w.section6bId].sort());
    const rows = await db.select().from(studentAssignments).where(eq(studentAssignments.assignmentId, hw.id));
    expect(rows.find((r) => r.studentEnrollmentId === w.enrollmentOwnedId)?.sectionId).toBe(w.section6aId);
    expect(rows.find((r) => r.studentEnrollmentId === w.enrollmentSection6bId)?.sectionId).toBe(w.section6bId);
    expect(rows.every((r) => r.status === "assigned")).toBe(true);
  });

  it("refuses ways back and grading a type does not allow", async () => {
    await expect(
      homeworkService.create(scopeA1, w.users.adminA, {
        kind: "reading",
        subjectId: w.subjectA1MathId,
        sectionIds: [w.section6aId],
        book: "Panchatantra",
        pages: "Ch 2",
        comesBack: "sent" as "tick",
        dueAt: hoursAhead(20),
        give: true,
      }),
    ).rejects.toThrow(/can't come back that way/);
    await expect(giveHomework({ comesBack: "tick", gradingMode: "marks", maxMarks: "10" })).rejects.toThrow(
      /Only work that comes back/,
    );
    await expect(giveHomework({ gradingMode: "marks" })).rejects.toThrow(/out of/);
    await expect(
      giveHomework({ kind: "practice", comesBack: "brought", gradingMode: "marks", maxMarks: "5" }),
    ).rejects.toThrow(/can't be graded that way/);
  });

  it("Reading keeps the book and the pages; a quiz can't be given without questions", async () => {
    const reading = await homeworkService.create(scopeA1, w.users.adminA, {
      kind: "reading",
      subjectId: w.subjectA1MathId,
      sectionIds: [w.section6aId],
      book: "Panchatantra",
      pages: "Chapter 2",
      comesBack: "tick",
      dueAt: hoursAhead(30),
      give: true,
    });
    expect(reading.book).toBe("Panchatantra");
    expect(reading.title).toBe("Chapter 2");
    await expect(
      homeworkService.create(scopeA1, w.users.adminA, {
        kind: "quiz",
        subjectId: w.subjectA1MathId,
        sectionIds: [w.section6aId],
        title: title("quiz"),
        dueAt: hoursAhead(30),
        give: true,
      }),
    ).rejects.toThrow(/Add questions/);
  });

  it("Undo takes a just-given homework back to a draft; then it can be given again", async () => {
    const hw = await giveHomework({ title: title("undo") });
    const back = await homeworkService.undoGive(scopeA1, pair6a, hw.id);
    expect(back.status).toBe("draft");
    expect(await db.select().from(studentAssignments).where(eq(studentAssignments.assignmentId, hw.id))).toHaveLength(0);
    const again = await homeworkService.give(scopeA1, pair6a, hw.id);
    expect(again.status).toBe("published");
  });

  it("Undo is refused once a student has done something", async () => {
    const hw = await giveHomework({ title: title("undo late"), comesBack: "tick" });
    const sa = await ownedSaOf(hw.id);
    await homeworkService.portalTick([w.ownedStudentId], w.ownedStudentId, sa.id, true);
    await expect(homeworkService.undoGive(scopeA1, pair6a, hw.id)).rejects.toThrow(/already started/);
  });

  it("a pair that does not describe the homework is NOT_FOUND", async () => {
    const hw = await giveHomework({ title: title("pair") });
    await expect(
      homeworkService.cancel(scopeA1, { sectionId: w.section6bId, subjectId: w.subjectA1MathId }, hw.id),
    ).rejects.toThrow(/could not be found/);
    await expect(
      homeworkService.cancel(scopeA1, { sectionId: w.section6aId, subjectId: w.subjectA1PhysicsId }, hw.id),
    ).rejects.toThrow(/could not be found/);
    await expect(homeworkService.detail(scopeB1, hw.id)).rejects.toThrow(/could not be found/);
  });

  // ── The gates (through the real router) ─────────────────────────────────

  it("a subject teacher gives only to their own pairs, every section checked", async () => {
    const teacher = callerFor(w.users.subjectS6A);
    const base = {
      organizationId: w.orgAId,
      kind: "homework",
      subjectId: w.subjectA1MathId,
      title: title("teacher gives"),
      comesBack: "brought",
      gradingMode: "none",
      dueAt: hoursAhead(20),
      give: true,
    };
    const ok = await teacher("homework.create", { ...base, sectionId: w.section6aId, sectionIds: [w.section6aId] });
    expect(ok.status).toBe("published");

    const both = await refusal(
      teacher("homework.create", { ...base, sectionId: w.section6aId, sectionIds: [w.section6aId, w.section6bId] }),
    );
    expect(both.code).toBe("FORBIDDEN");

    const physics = await refusal(
      teacher("homework.create", {
        ...base,
        subjectId: w.subjectA1PhysicsId,
        sectionId: w.section6aId,
        sectionIds: [w.section6aId],
      }),
    );
    expect(physics.code).toBe("FORBIDDEN");
  });

  it("a subject teacher's Home and pairs show only their own pairs", async () => {
    const teacher = callerFor(w.users.subjectS6A);
    const pairs = await teacher("homework.pairs", { organizationId: w.orgAId, schoolId: w.schoolA1Id });
    const flat = pairs.flatMap((p: any) => p.sections.map((s: any) => `${p.subjectId}:${s.sectionId}`));
    expect(flat).toContain(`${w.subjectA1MathId}:${w.section6aId}`);
    expect(flat.every((x: string) => x.startsWith(w.subjectA1MathId) || x.endsWith(w.section6bId))).toBe(true);

    // Admin gives Physics to 6-A; the Math teacher does not see it.
    const other = await giveHomework({ subjectId: w.subjectA1PhysicsId, title: title("physics, not hers") });
    const list = await teacher("homework.list", { organizationId: w.orgAId, schoolId: w.schoolA1Id, limit: 100 });
    expect(list.some((h: any) => h.id === other.id)).toBe(false);
  });

  // ── Checking ────────────────────────────────────────────────────────────

  it("checks a list: grading validated, saves idempotent, results visible to the student", async () => {
    const hw = await giveHomework({ title: title("check"), gradingMode: "marks", maxMarks: "10" });
    const reg = await homeworkService.register(scopeA1, pair6a, hw.id);
    expect(reg.rows.length).toBeGreaterThan(0);
    const mine = reg.rows.find((r) => r.studentId === w.ownedStudentId)!;
    expect(mine.checkStatus).toBeNull();

    await expect(
      homeworkService.saveRegister(scopeA1, w.users.adminA, {
        id: hw.id,
        ...pair6a,
        results: [{ studentAssignmentId: mine.studentAssignmentId, checkStatus: "done", marks: "11" }],
      }),
    ).rejects.toThrow(/more than 10/);

    const save = () =>
      homeworkService.saveRegister(scopeA1, w.users.adminA, {
        id: hw.id,
        ...pair6a,
        results: [
          { studentAssignmentId: mine.studentAssignmentId, checkStatus: "done", marks: "8", note: "Neat work" },
        ],
      });
    const first = await save();
    const second = await save();
    expect(second.counts).toEqual(first.counts);
    expect(first.counts.done).toBe(1);

    const portal = await homeworkService.portalGet([w.ownedStudentId], w.ownedStudentId, mine.studentAssignmentId);
    expect(portal.word).toBe("checked");
    expect(portal.marks).toBe("8.00");
    expect(portal.note).toBe("Neat work");

    // Not done shows as "missed" to the student and drops the marks.
    await homeworkService.saveRegister(scopeA1, w.users.adminA, {
      id: hw.id,
      ...pair6a,
      results: [{ studentAssignmentId: mine.studentAssignmentId, checkStatus: "not_done", marks: "8" }],
    });
    const notDone = await ownedSaOf(hw.id);
    expect(notDone.marks).toBeNull();
    expect(studentWord(notDone, "brought", new Date())).toBe("missed");

    // Clearing takes the child back to unchecked.
    await homeworkService.saveRegister(scopeA1, w.users.adminA, {
      id: hw.id,
      ...pair6a,
      results: [{ studentAssignmentId: mine.studentAssignmentId, checkStatus: null }],
    });
    const cleared = await ownedSaOf(hw.id);
    expect(cleared.status).toBe("assigned");
    expect(cleared.checkStatus).toBeNull();

    // After a check, how it comes back and grading are fixed.
    await expect(
      homeworkService.update(scopeA1, w.users.adminA, pair6a, { id: hw.id, gradingMode: "remark" }),
    ).rejects.toThrow(/fixed now/);
    // But the title can still change.
    const renamed = await homeworkService.update(scopeA1, w.users.adminA, pair6a, { id: hw.id, title: title("renamed") });
    expect(renamed.title).toBe(title("renamed"));
  });

  it("a remark is one of three words; a child from another section is refused", async () => {
    const hw = await giveHomework({ title: title("remark"), gradingMode: "remark", sectionIds: [w.section6aId, w.section6bId] });
    const sa = await ownedSaOf(hw.id);
    const res = await homeworkService.saveRegister(scopeA1, w.users.adminA, {
      id: hw.id,
      ...pair6a,
      results: [{ studentAssignmentId: sa.id, checkStatus: "done", remark: "bad" }],
    });
    expect(res.counts.done).toBe(1);
    expect((await ownedSaOf(hw.id)).remark).toBe("bad");

    const [six6b] = await db
      .select()
      .from(studentAssignments)
      .where(and(eq(studentAssignments.assignmentId, hw.id), eq(studentAssignments.sectionId, w.section6bId)));
    await expect(
      homeworkService.saveRegister(scopeA1, w.users.adminA, {
        id: hw.id,
        ...pair6a,
        results: [{ studentAssignmentId: six6b!.id, checkStatus: "done" }],
      }),
    ).rejects.toThrow(/not on this list/);
  });

  // ── The student side ────────────────────────────────────────────────────

  it("tick until due, untick only a student's own tick", async () => {
    const hw = await giveHomework({ title: title("tick"), comesBack: "tick" });
    const sa = await ownedSaOf(hw.id);
    const ticked = await homeworkService.portalTick([w.ownedStudentId], w.ownedStudentId, sa.id, true);
    expect(ticked.word).toBe("sent");
    expect(ticked.canUntick).toBe(true);
    const unticked = await homeworkService.portalTick([w.ownedStudentId], w.ownedStudentId, sa.id, false);
    expect(unticked.word).toBe("to_do");

    // The teacher's "Mark read" can't be undone by the student.
    await homeworkService.markTick(scopeA1, pair6a, sa.id, true);
    await expect(homeworkService.portalTick([w.ownedStudentId], w.ownedStudentId, sa.id, false)).rejects.toThrow(
      /can't be undone/,
    );
  });

  it("sends photos, replaces them until checked, and lets the old ones go", { timeout: 90_000 }, async () => {
    const hw = await giveHomework({ title: title("sent"), comesBack: "sent", gradingMode: "marks", maxMarks: "10" });
    const sa = await ownedSaOf(hw.id);
    expect((await homeworkService.portalGet([w.ownedStudentId], w.ownedStudentId, sa.id)).canSend).toBe(true);

    const first = await upload("homework_student_file", studentUserId, sa.id);
    const sent = await homeworkService.portalSend(studentUserId, [w.ownedStudentId], {
      studentId: w.ownedStudentId,
      studentAssignmentId: sa.id,
      fileObjectIds: [first],
    });
    expect(sent.word).toBe("sent");
    expect(sent.submission?.files).toHaveLength(1);

    const second = await upload("homework_student_file", studentUserId, sa.id);
    await homeworkService.portalSend(studentUserId, [w.ownedStudentId], {
      studentId: w.ownedStudentId,
      studentAssignmentId: sa.id,
      bodyText: "Q1 = 4",
      fileObjectIds: [second],
    });
    const subs = await db.select().from(submissions).where(eq(submissions.studentAssignmentId, sa.id));
    expect(subs).toHaveLength(1);
    const files = await db.select().from(submissionFiles).where(eq(submissionFiles.submissionId, subs[0]!.id));
    expect(files.map((f) => f.objectId)).toEqual([second]);
    const [old] = await db.select().from(storageObjects).where(eq(storageObjects.id, first));
    expect(old!.status).toBe("deleted");

    // A file uploaded for another child's homework can't be linked here.
    const hw2 = await giveHomework({ title: title("sent 2"), comesBack: "sent" });
    const sa2 = await ownedSaOf(hw2.id);
    await expect(
      homeworkService.portalSend(studentUserId, [w.ownedStudentId], {
        studentId: w.ownedStudentId,
        studentAssignmentId: sa2.id,
        fileObjectIds: [second],
      }),
    ).rejects.toThrow(/can't be used here/);

    // Checked: no more sending.
    await homeworkService.saveRegister(scopeA1, w.users.adminA, {
      id: hw.id,
      ...pair6a,
      results: [{ studentAssignmentId: sa.id, checkStatus: "done", marks: "9" }],
    });
    await expect(
      homeworkService.portalSend(studentUserId, [w.ownedStudentId], {
        studentId: w.ownedStudentId,
        studentAssignmentId: sa.id,
        bodyText: "late fix",
        fileObjectIds: [],
      }),
    ).rejects.toThrow(/checked already/);

    // Redo reopens it with the note; sending again puts it back to sent.
    const back = await homeworkService.sendBack(scopeA1, pair6a, sa.id, "Show the working for Q2");
    expect(back.status).toBe("redo");
    expect(back.checkStatus).toBeNull();
    const redo = await homeworkService.portalGet([w.ownedStudentId], w.ownedStudentId, sa.id);
    expect(redo.word).toBe("redo");
    expect(redo.note).toBe("Show the working for Q2");
    const again = await homeworkService.portalSend(studentUserId, [w.ownedStudentId], {
      studentId: w.ownedStudentId,
      studentAssignmentId: sa.id,
      bodyText: "Q2 working attached",
      fileObjectIds: [second],
    });
    expect(again.word).toBe("sent");
  });

  it("another family's child is NOT_FOUND", async () => {
    const hw = await giveHomework({ title: title("tenancy") });
    const sa = await ownedSaOf(hw.id);
    await expect(homeworkService.portalGet([w.studentB1Id], w.studentB1Id, sa.id)).rejects.toThrow(/could not be found/);
    await expect(homeworkService.portalGet([w.ownedStudentId], w.studentB1Id, sa.id)).rejects.toThrow();
  });

  // ── Files on the teacher's side ─────────────────────────────────────────

  it("give-again copies photos; deleting a draft lets its photos go", async () => {
    const photo = await upload("homework_teacher_file", w.users.adminA, null);
    const hw = await giveHomework({ title: title("photo"), fileObjectIds: [photo] });
    const copy = await homeworkService.giveAgain(scopeA1, w.users.adminA, pair6a, {
      id: hw.id,
      toSectionIds: [w.section6bId],
      dueAt: hoursAhead(40),
    });
    const [copied] = await db.select().from(assignmentFiles).where(eq(assignmentFiles.assignmentId, copy.id));
    expect(copied!.objectId).not.toBe(photo);
    const [original] = await db.select().from(storageObjects).where(eq(storageObjects.id, photo));
    expect(original!.status).toBe("ready");
    expect(original!.parentId).toBe(hw.id);

    const draftPhoto = await upload("homework_teacher_file", w.users.adminA, null);
    const draft = await giveHomework({ title: title("draft"), fileObjectIds: [draftPhoto], give: false });
    expect(draft.status).toBe("draft");
    await homeworkService.deleteDraft(scopeA1, pair6a, draft.id);
    expect(await db.select().from(assignments).where(eq(assignments.id, draft.id))).toHaveLength(0);
    const [gone] = await db.select().from(storageObjects).where(eq(storageObjects.id, draftPhoto));
    expect(gone!.status).toBe("deleted");
  });

  // ── Comments ────────────────────────────────────────────────────────────

  it("the staff board never carries a private thread", async () => {
    const hw = await giveHomework({ title: title("comments") });
    const sa = await ownedSaOf(hw.id);
    await homeworkService.portalPostComment(studentUserId, [w.ownedStudentId], {
      studentId: w.ownedStudentId,
      studentAssignmentId: sa.id,
      toClass: false,
      body: "Private: I was absent",
    });
    await homeworkService.portalPostComment(studentUserId, [w.ownedStudentId], {
      studentId: w.ownedStudentId,
      studentAssignmentId: sa.id,
      toClass: true,
      body: "Is Q3 needed?",
    });
    const board = await homeworkService.listComments(scopeA1, w.users.adminA, hw.id);
    expect(board.map((c) => c.body)).toEqual(["Is Q3 needed?"]);
    expect(board[0]!.fromStaff).toBe(false);
    const thread = await homeworkService.listComments(scopeA1, w.users.adminA, hw.id, sa.id);
    expect(thread.map((c) => c.body)).toEqual(["Private: I was absent"]);
    await homeworkService.deleteComment(scopeA1, thread[0]!.id);
    expect(await homeworkService.listComments(scopeA1, w.users.adminA, hw.id, sa.id)).toHaveLength(0);
  });

  // ── Home v3 ─────────────────────────────────────────────────────────────

  it("Home's week holds homework due this week; the class view counts who owes work", async () => {
    const hw = await giveHomework({ title: title("class view") });
    const access = { userId: w.users.adminA, scopes: [scopeA1], pairs: null };
    const home = await homeworkService.home(access);
    expect(home.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(home.weekDays).toHaveLength(6);
    // Home's shown day reads the same through the week endpoint.
    const sameDay = await homeworkService.week(access, home.weekStart, home.day);
    expect(sameDay.dayItems.map((h) => h.id).sort()).toEqual(home.dayItems.map((h) => h.id).sort());
    // Any day of the week holds every homework due that day, however many the
    // school has (a shared cap once dropped the newest), and its count agrees.
    const dueDay = new Date(new Date(hw.dueAt).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const from = new Date(`${home.weekStart}T00:00:00+05:30`);
    const dueWeek = new Date(from.getTime() + Math.floor((new Date(hw.dueAt).getTime() - from.getTime()) / (7 * 86_400_000)) * 7 * 86_400_000 + 5.5 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const strip = await homeworkService.week(access, dueWeek, dueDay);
    expect(strip.dayItems.some((h) => h.id === hw.id)).toBe(true);
    expect(strip.weekDays.find((d) => d.day === dueDay)?.count ?? 0).toBeGreaterThanOrEqual(strip.dayItems.length);

    // Mark the owned child Not done on work due an hour ago.
    const past = new Date(Date.now() - 3600_000);
    await db.update(assignments).set({ dueAt: past, closeAt: past }).where(eq(assignments.id, hw.id));
    await db
      .update(studentAssignments)
      .set({ effectiveDueAt: past, effectiveCloseAt: past })
      .where(eq(studentAssignments.assignmentId, hw.id));
    const sa = await ownedSaOf(hw.id);
    await homeworkService.saveRegister(scopeA1, w.users.adminA, {
      id: hw.id,
      ...pair6a,
      results: [{ studentAssignmentId: sa.id, checkStatus: "not_done" }],
    });
    const view = await homeworkService.classView(access, pair6a);
    expect(view.homework.some((h) => h.id === hw.id)).toBe(true);
    expect(view.homework.every((h) => h.sections.every((s) => s.sectionId === w.section6aId))).toBe(true);
    expect(view.owe.find((o) => o.studentId === w.ownedStudentId)?.notDone).toBeGreaterThan(0);
    expect(view.onTimePct === null || (view.onTimePct >= 0 && view.onTimePct <= 100)).toBe(true);

    // A subject teacher can't open a pair that isn't theirs.
    await expect(
      homeworkService.classView(
        { userId: w.users.subjectS6A, scopes: [scopeA1], pairs: [pair6a] },
        { sectionId: w.section6bId, subjectId: w.subjectA1MathId },
      ),
    ).rejects.toThrow(/could not be found/);
  });

  // ── The worker ──────────────────────────────────────────────────────────

  it("the worker gives scheduled homework and marks unsent work missing, never brought work", async () => {
    const scheduled = await giveHomework({ title: title("scheduled"), publishAt: hoursAhead(1) });
    expect(scheduled.status).toBe("scheduled");
    await db.update(assignments).set({ publishAt: new Date(Date.now() - 1000) }).where(eq(assignments.id, scheduled.id));

    const sent = await giveHomework({ title: title("missing"), comesBack: "sent" });
    const brought = await giveHomework({ title: title("never missing") });
    const past = new Date(Date.now() - 1000);
    await db
      .update(studentAssignments)
      .set({ effectiveDueAt: past, effectiveCloseAt: past })
      .where(inArray(studentAssignments.assignmentId, [sent.id, brought.id]));

    let given = false;
    for (let i = 0; i < 5 && !given; i++) {
      const result = await homeworkWorkerService.runSweep({ publishBatch: 200 });
      given = result.published.some((p) => p.id === scheduled.id);
      if (result.summary.startsWith("skipped")) await new Promise((r) => setTimeout(r, 500));
    }
    expect(given).toBe(true);
    expect((await ownedSaOf(sent.id)).status).toBe("missing");
    expect((await ownedSaOf(brought.id)).status).toBe("assigned");
    expect(studentWord(await ownedSaOf(sent.id), "sent", new Date())).toBe("missed");
  });
});
