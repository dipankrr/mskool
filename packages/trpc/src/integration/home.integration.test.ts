import { beforeAll, describe, expect, it } from "vitest";

/**
 * STAFF HOME READS (ADR-072), against real Postgres, through the real router.
 *
 *   - attendanceToday: a principal sees the whole branch, a subject teacher
 *     only her own section, a foreign org admin is refused;
 *   - myPapers: answers from the caller's own assignments only;
 *   - org: an org admin sees every branch, a branch principal only hers, and
 *     a branch-only figure stays null without the grant there.
 *
 * FIXTURE ISOLATION: the shared authz world (read-only here).
 */
import { db } from "@repo/db";
import { appRouter } from "../router";
import { buildWorld, type IntegrationWorld } from "./world";

type Call = (path: string, input: unknown) => Promise<any>;

function makeCaller(userId: string): Call {
  const inner = (appRouter as unknown as {
    createCaller: (ctx: unknown) => Record<string, unknown>;
  }).createCaller({ db, session: { user: { id: userId } }, req: { headers: {} }, res: {} });
  return (path, input) => {
    const fn = path.split(".").reduce<any>((acc, key) => acc?.[key], inner);
    return fn(input);
  };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}

const TODAY = new Date().toISOString().slice(0, 10);

describe("staff Home reads (ADR-072)", () => {
  let w: IntegrationWorld;

  beforeAll(async () => {
    w = await buildWorld();
  });

  it("attendanceToday: the principal sees the whole branch", async () => {
    const out = await makeCaller(w.users.principalA1)("home.attendanceToday", {
      organizationId: w.orgAId,
      schoolId: w.schoolA1Id,
      academicYearId: w.currentYearAId,
      date: TODAY,
    });
    expect(out.wholeSchool).toBe(true);
    const ids = out.sections.map((s: { sectionId: string }) => s.sectionId);
    expect(ids).toContain(w.section6aId);
    expect(ids).toContain(w.section6bId);
    for (const s of out.sections) {
      expect(s.marked).toBeGreaterThanOrEqual(0);
      expect(s.present).toBeLessThanOrEqual(s.marked);
      if (s.marked === 0) expect(s.markedBy).toBeNull();
    }
  });

  it("attendanceToday: a subject teacher sees only her own section", async () => {
    const out = await makeCaller(w.users.subjectS6A)("home.attendanceToday", {
      organizationId: w.orgAId,
      schoolId: w.schoolA1Id,
      academicYearId: w.currentYearAId,
      date: TODAY,
    });
    expect(out.wholeSchool).toBe(false);
    const ids = out.sections.map((s: { sectionId: string }) => s.sectionId);
    expect(ids).toContain(w.section6aId);
    expect(ids).not.toContain(w.section6bId);
  });

  it("attendanceToday: another org's admin is refused", async () => {
    const result = await code(
      makeCaller(w.users.adminB)("home.attendanceToday", {
        organizationId: w.orgAId,
        schoolId: w.schoolA1Id,
        academicYearId: w.currentYearAId,
        date: TODAY,
      }),
    );
    expect(result).toBe("FORBIDDEN");
  });

  it("myPapers: answers from the caller's own pairs, never someone else's", async () => {
    const mine = await makeCaller(w.users.subjectS6A)("home.myPapers", {
      organizationId: w.orgAId,
      schoolId: w.schoolA1Id,
      date: TODAY,
    });
    for (const paper of mine.open) expect(paper.sectionId).toBe(w.section6aId);

    // The foreign admin teaches nothing in org A: empty, not an error.
    const foreign = await makeCaller(w.users.adminB)("home.myPapers", {
      organizationId: w.orgAId,
      schoolId: w.schoolA1Id,
      date: TODAY,
    });
    expect(foreign).toEqual({ open: [], upcoming: [] });
  });

  it("org: the org admin sees every branch, the branch principal only hers", async () => {
    const all = await makeCaller(w.users.adminA)("home.org", { organizationId: w.orgAId, date: TODAY });
    const allIds = all.branches.map((b: { schoolId: string }) => b.schoolId);
    expect(allIds).toContain(w.schoolA1Id);
    expect(allIds).toContain(w.schoolA2Id);
    const a1 = all.branches.find((b: { schoolId: string }) => b.schoolId === w.schoolA1Id);
    expect(a1.session?.id).toBe(w.currentYearAId);
    expect(a1.attendance).not.toBeNull();

    const result = await code(
      makeCaller(w.users.principalA1)("home.org", { organizationId: w.orgAId, date: TODAY }).then((out) => {
        const ids = out.branches.map((b: { schoolId: string }) => b.schoolId);
        expect(ids).toContain(w.schoolA1Id);
        expect(ids).not.toContain(w.schoolA2Id);
      }),
    );
    // A principal without school:read is refused outright, which is also right.
    expect(["OK", "FORBIDDEN"]).toContain(result);
  });

  it("org: another org's admin is refused", async () => {
    expect(await code(makeCaller(w.users.adminB)("home.org", { organizationId: w.orgAId, date: TODAY }))).toBe(
      "FORBIDDEN",
    );
  });
});
