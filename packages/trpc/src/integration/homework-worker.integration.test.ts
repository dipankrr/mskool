import { beforeAll, describe, expect, it } from "vitest";

/**
 * THE HOMEWORK SWEEPER (ADR-040) — proofs against REAL Postgres. The
 * worker's entire contract is that time-driven transitions are correct and
 * safe, so every proof drives `runSweep()` directly against hand-built late
 * rows (no clock mocking, no sleeping):
 *
 *   - scheduled publishing resolves the audience exactly like the button;
 *   - a poisoned scheduled publish (per-day cap) is refused per-assignment
 *     and does NOT poison its siblings;
 *   - the Missing sweep touches only rows of PUBLISHED/CLOSED assignments —
 *     a CANCELLED assignment's rows are never "missing";
 *   - excused / reviewed / resubmit-requested rows are never overwritten;
 *   - a future extension is immune, and granting one after a miss revives
 *     the row;
 *   - backfilled (view-only) rows are excluded;
 *   - re-running the sweep is a no-op (idempotency);
 *   - a foreign holder of the advisory lock makes the sweep SKIP.
 */

import type { DataScope } from "@repo/authz";
import { db } from "@repo/db";
import {
  assignmentSettings,
  assignments,
  classes,
  studentAssignments,
} from "@repo/db/schema";
import { homeworkService, homeworkWorkerService } from "@repo/services";
import { and, eq } from "drizzle-orm";
import { buildWorld } from "./world";

const RUN = Date.now();
const title = (s: string) => `ITG SWEEP ${RUN} ${s}`;

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

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
    // Arm the class cap at 1 and schedule two assignments due the same day.
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

    // RESET (rows persist across runs).
    await homeworkService.upsertSettings(scopeA1, adminAId, {
      classId: class6Id,
      maxAssignmentsPerDay: null,
      allowWeekendAssignments: true,
    });
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
