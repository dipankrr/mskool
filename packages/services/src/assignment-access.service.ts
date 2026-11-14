import { invalidateUserAuthCache } from "@repo/authz";
import { db } from "@repo/db";
import {
  authzAuditLog,
  roleAssignments,
  sectionTeacherAssignments as STA,
  staff,
} from "@repo/db/schema";
import { and, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";

/**
 * ASSIGNING IS THE ACCESS (ADR-068, option A).
 *
 * A teaching assignment is the timetable fact (ADR-012); the permission check
 * still reads only role grants (`can()` is untouched). This service keeps the
 * two in step: for every (person, section) the open assignments decide which
 * SECTION-level teacher grants exist —
 *
 *   - any class teacher row → one `class_teacher` grant at the section;
 *   - any subject row       → one `subject_teacher` grant at the section
 *     (the subject gate, ADR-029a, still limits WHICH subjects);
 *   - no rows               → those grants are revoked.
 *
 * A grant's `expiresAt` is the assignment's end when every row has one (a
 * substitute), so access ends on time without a job. The auth cache is
 * cleared on every change: access moves immediately, not in five minutes.
 *
 * `effectiveTo` is EXCLUSIVE (ADR-068): ending today sets today, so the row
 * stops counting now; a substitute "until 28 Nov" is stored as 29 Nov.
 *
 * Hand-made class/subject teacher grants are refused by role.service, so the
 * only writer of section-level teacher grants is this service.
 */

const TEACHER_ROLES = ["class_teacher", "subject_teacher"] as const;
type TeacherRole = (typeof TEACHER_ROLES)[number];

/** Today as a UTC date, the clock `effective_from`'s CURRENT_DATE uses. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** An assignment that counts today. */
export function assignmentIsCurrent(today: string = todayUtc()): SQL {
  return or(isNull(STA.effectiveTo), gt(STA.effectiveTo, today))!;
}

function endOf(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export class AssignmentAccessService {
  /**
   * Brings one person's teacher grants on one section in line with their
   * current assignments there. Safe to call any number of times.
   */
  async syncSection(
    organizationId: string,
    userId: string,
    sectionId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const today = todayUtc();
    const rows = await db
      .select({ role: STA.role, effectiveTo: STA.effectiveTo })
      .from(STA)
      .innerJoin(staff, eq(STA.staffId, staff.id))
      .where(
        and(
          eq(STA.organizationId, organizationId),
          eq(STA.sectionId, sectionId),
          eq(staff.userId, userId),
          eq(staff.status, "active"),
          assignmentIsCurrent(today),
        ),
      );

    const want = new Map<TeacherRole, Date | null>();
    for (const role of TEACHER_ROLES) {
      const mine = rows.filter((row) => row.role === role);
      if (mine.length === 0) continue;
      const open = mine.some((row) => row.effectiveTo === null);
      const last = mine
        .map((row) => row.effectiveTo)
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1);
      want.set(role, open || !last ? null : endOf(last));
    }

    const held = await db
      .select({
        id: roleAssignments.id,
        roleType: roleAssignments.roleType,
        expiresAt: roleAssignments.expiresAt,
      })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.organizationId, organizationId),
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.scopeType, "section"),
          eq(roleAssignments.scopeId, sectionId),
          inArray(roleAssignments.roleType, [...TEACHER_ROLES]),
          isNull(roleAssignments.revokedAt),
        ),
      );

    let changed = false;
    const now = new Date();
    for (const role of TEACHER_ROLES) {
      const grants = held.filter((row) => row.roleType === role);
      const wanted = want.get(role);
      if (wanted === undefined) {
        if (grants.length === 0) continue;
        await db
          .update(roleAssignments)
          .set({ revokedAt: now, revokedBy: actorUserId })
          .where(inArray(roleAssignments.id, grants.map((row) => row.id)));
        await db.insert(authzAuditLog).values({
          organizationId,
          action: "role_revoked",
          actorUserId,
          targetUserId: userId,
          roleType: role,
          scopeType: "section",
          scopeId: sectionId,
          permission: "teacher_assignment:update",
          details: { via: "teaching_assignment" },
        });
        changed = true;
        continue;
      }
      const [keep, ...extra] = grants;
      if (extra.length > 0) {
        await db
          .update(roleAssignments)
          .set({ revokedAt: now, revokedBy: actorUserId })
          .where(inArray(roleAssignments.id, extra.map((row) => row.id)));
        changed = true;
      }
      if (keep) {
        const same = (keep.expiresAt?.getTime() ?? null) === (wanted?.getTime() ?? null);
        if (!same) {
          await db
            .update(roleAssignments)
            .set({ expiresAt: wanted })
            .where(eq(roleAssignments.id, keep.id));
          changed = true;
        }
        continue;
      }
      await db.insert(roleAssignments).values({
        userId,
        organizationId,
        roleType: role,
        scopeType: "section",
        scopeId: sectionId,
        expiresAt: wanted,
        grantedBy: actorUserId,
      });
      await db.insert(authzAuditLog).values({
        organizationId,
        action: "role_granted",
        actorUserId,
        targetUserId: userId,
        roleType: role,
        scopeType: "section",
        scopeId: sectionId,
        permission: "teacher_assignment:create",
        details: { via: "teaching_assignment" },
      });
      changed = true;
    }

    if (changed) await invalidateUserAuthCache(userId);
  }

  /**
   * Every section a staff member's grants touch, brought in line: their
   * current assignments plus any section they still hold a teacher grant on.
   * Runs when someone joins (their first grants) and after bulk changes.
   */
  async syncStaff(
    organizationId: string,
    staffId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const [row] = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.organizationId, organizationId)));
    if (!row?.userId) return;
    const userId = row.userId;

    const assigned = await db
      .selectDistinct({ sectionId: STA.sectionId })
      .from(STA)
      .where(
        and(
          eq(STA.organizationId, organizationId),
          eq(STA.staffId, staffId),
          assignmentIsCurrent(),
        ),
      );
    const granted = await db
      .selectDistinct({ sectionId: roleAssignments.scopeId })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.organizationId, organizationId),
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.scopeType, "section"),
          inArray(roleAssignments.roleType, [...TEACHER_ROLES]),
          isNull(roleAssignments.revokedAt),
        ),
      );
    const sectionIds = new Set([
      ...assigned.map((r) => r.sectionId),
      ...granted.map((r) => r.sectionId),
    ]);
    for (const sectionId of sectionIds) {
      await this.syncSection(organizationId, userId, sectionId, actorUserId);
    }
  }

  /** Ends every current assignment a staff member holds (they are leaving). */
  async endAllForStaff(organizationId: string, staffId: string): Promise<number> {
    const today = todayUtc();
    const ended = await db
      .update(STA)
      .set({ effectiveTo: today })
      .where(
        and(
          eq(STA.organizationId, organizationId),
          eq(STA.staffId, staffId),
          assignmentIsCurrent(today),
        ),
      )
      .returning({ id: STA.id });
    return ended.length;
  }
}

export const assignmentAccessService = new AssignmentAccessService();
