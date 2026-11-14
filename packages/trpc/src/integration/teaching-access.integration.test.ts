import { beforeAll, describe, expect, it } from "vitest";

/**
 * ASSIGNING IS THE ACCESS (ADR-068, option A), against real Postgres.
 *
 *   - an assignment for someone who hasn't joined grants nothing yet; joining
 *     turns it into a section-level `subject_teacher` grant;
 *   - the subject gate's fact follows the staff record's login;
 *   - ending the assignment revokes the grant; a substitute's grant expires;
 *   - class teachers are refused while the school has them switched off;
 *   - leaving ends every assignment and every grant;
 *   - a hand-made class/subject teacher role is refused.
 *
 * FIXTURE ISOLATION: the authz world's org A, branch A1, section 6-B and
 * Physics; its own staff rows keyed on per-run phones.
 */
import { db } from "@repo/db";
import { roleAssignments, schools, sectionTeacherAssignments } from "@repo/db/schema";
import {
  assignmentService,
  roleService,
  staffLoginService,
  staffService,
} from "@repo/services";
import type { DataScope } from "@repo/authz";
import { and, eq, isNull } from "drizzle-orm";
import { buildWorld } from "./world";

const RUN = String(Date.now()).slice(-7);
const phone = (n: number) => `8${RUN}${String(n).padStart(2, "0")}`;

function daysFromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("teaching assignments give access (ADR-068)", () => {
  let scope: DataScope;
  let orgId: string;
  let schoolId: string;
  let sectionId: string;
  let yearId: string;
  let physicsId: string;
  let adminId: string;
  let staffId: string;
  let userId: string;
  let assignmentId: string;

  const grants = (role: "class_teacher" | "subject_teacher") =>
    db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.scopeType, "section"),
          eq(roleAssignments.scopeId, sectionId),
          eq(roleAssignments.roleType, role),
          isNull(roleAssignments.revokedAt),
        ),
      );

  beforeAll(async () => {
    const world = await buildWorld();
    orgId = world.orgAId;
    schoolId = world.schoolA1Id;
    sectionId = world.section6bId;
    yearId = world.currentYearAId;
    physicsId = world.subjectA1PhysicsId;
    adminId = world.users.adminA;
    scope = { organizationId: orgId, schoolId, classId: null, sectionId: null };
    const row = await staffService.createStaff(scope, {
      firstName: "Access",
      lastName: "Teacher",
      phone: phone(1),
      teachesClasses: true,
    });
    staffId = row.id;
  });

  it("assigns before joining; joining turns it into a section grant", async () => {
    const created = await assignmentService.createSectionTeacherAssignment(
      scope,
      { sectionId, academicYearId: yearId, staffId, role: "subject_teacher", subjectId: physicsId },
      adminId,
    );
    assignmentId = created.id;

    const invite = await staffLoginService.invite(orgId, staffId, adminId);
    const joined = await staffLoginService.join({
      phone: phone(1),
      code: invite.code,
      password: "AccessTest123!",
    });
    userId = joined.userId;

    const held = await grants("subject_teacher");
    expect(held).toHaveLength(1);
    expect(held[0]!.expiresAt).toBeNull();
    expect(
      await assignmentService.hasSubjectAssignment(orgId, userId, sectionId, physicsId),
    ).toBe(true);
  });

  it("ending the assignment revokes the grant and the subject fact", async () => {
    await assignmentService.endAssignment(scope, assignmentId, undefined, adminId);
    expect(await grants("subject_teacher")).toHaveLength(0);
    expect(
      await assignmentService.hasSubjectAssignment(orgId, userId, sectionId, physicsId),
    ).toBe(false);
  });

  it("a substitute's grant expires on its own", async () => {
    const until = daysFromToday(14);
    await assignmentService.createSectionTeacherAssignment(
      scope,
      {
        sectionId,
        academicYearId: yearId,
        staffId,
        role: "subject_teacher",
        subjectId: physicsId,
        effectiveTo: until,
      },
      adminId,
    );
    const held = await grants("subject_teacher");
    expect(held).toHaveLength(1);
    expect(held[0]!.expiresAt?.toISOString().slice(0, 10)).toBe(until);
  });

  it("refuses a class teacher while the school has them switched off", async () => {
    await db.update(schools).set({ classTeachersEnabled: false }).where(eq(schools.id, schoolId));
    try {
      await expect(
        assignmentService.createSectionTeacherAssignment(
          scope,
          { sectionId, academicYearId: yearId, staffId, role: "class_teacher" },
          adminId,
        ),
      ).rejects.toThrow(/doesn't use class teachers/);
    } finally {
      await db.update(schools).set({ classTeachersEnabled: true }).where(eq(schools.id, schoolId));
    }
  });

  it("refuses hand-made teacher roles", async () => {
    await expect(
      roleService.assign(orgId, adminId, {
        userId,
        roleType: "subject_teacher",
        scopeType: "section",
        scopeId: sectionId,
      }),
    ).rejects.toThrow(/what they teach/);
  });

  it("leaving ends every assignment and every grant", async () => {
    await staffService.deactivateStaff(scope, staffId, { status: "resigned" }, adminId);
    const open = await db
      .select({ id: sectionTeacherAssignments.id, to: sectionTeacherAssignments.effectiveTo })
      .from(sectionTeacherAssignments)
      .where(eq(sectionTeacherAssignments.staffId, staffId));
    const today = daysFromToday(0);
    expect(open.every((row) => row.to !== null && row.to <= today)).toBe(true);
    expect(await grants("subject_teacher")).toHaveLength(0);
  });
});
