import { beforeAll, describe, expect, it } from "vitest";

/**
 * STAFF ROLES AND STATUS (2026-11-15), against real Postgres:
 *
 *   - a role picked before someone joins waits on the staff record and
 *     becomes a real grant when they join; a waiting role can be cancelled;
 *   - a suspension stops the sign-in ("paused"), keeps the role, and lifting
 *     it brings the sign-in back on the same phone;
 *   - on leave is settable and keeps the sign-in; back clears it;
 *   - a joined person's new phone moves their sign-in at once;
 *   - a role's end date can be pushed out, and shows in "ending soon";
 *   - history reads the audit log back for one person;
 *   - leaving cancels waiting roles.
 *
 * FIXTURE ISOLATION: borrows the authz world's org and school; adds its own
 * staff rows keyed on per-run phones.
 */
import { db } from "@repo/db";
import { roleAssignments, staffPendingRoles, user as userTable } from "@repo/db/schema";
import { roleService, staffLoginService, staffService } from "@repo/services";
import type { DataScope } from "@repo/authz";
import { and, eq, isNull } from "drizzle-orm";
import { buildWorld } from "./world";

const RUN = String(Date.now()).slice(-7);
const phone = (n: number) => `8${RUN}${String(n).padStart(2, "0")}`;

describe("staff roles and status", () => {
  let scope: DataScope;
  let orgId: string;
  let schoolId: string;
  let admin: string;

  async function addAndJoin(n: number, first: string) {
    const row = await staffService.createStaff(scope, { firstName: first, lastName: "Roles", phone: phone(n) });
    const invite = await staffLoginService.invite(orgId, row.id, admin);
    const joined = await staffLoginService.join({ phone: phone(n), code: invite.code, password: "RolesTest123!" });
    return { staffId: row.id, userId: joined.userId };
  }

  beforeAll(async () => {
    const world = await buildWorld();
    orgId = world.orgAId;
    schoolId = world.schoolA1Id;
    admin = world.users.adminA;
    scope = { organizationId: orgId, schoolId, classId: null, sectionId: null };
  });

  it("a role picked before joining waits, then becomes a grant at join", async () => {
    const row = await staffService.createStaff(scope, { firstName: "Wait", lastName: "Roles", phone: phone(1) });
    const given = await roleService.assignToStaff(orgId, admin, {
      staffId: row.id,
      roleType: "librarian",
      scopeType: "school",
      scopeId: schoolId,
    });
    expect(given.waiting).toBe(true);
    const before = await roleService.forStaff(orgId, row.id);
    expect(before.map((r) => [r.roleType, r.waiting])).toEqual([["librarian", true]]);

    await expect(
      roleService.assignToStaff(orgId, admin, { staffId: row.id, roleType: "librarian", scopeType: "school", scopeId: schoolId }),
    ).rejects.toThrow(/already have this role/);
    await expect(
      roleService.assignToStaff(orgId, admin, { staffId: row.id, roleType: "subject_teacher", scopeType: "school", scopeId: schoolId }),
    ).rejects.toThrow(/Teaching/);

    const invite = await staffLoginService.invite(orgId, row.id, admin);
    const joined = await staffLoginService.join({ phone: phone(1), code: invite.code, password: "RolesTest123!" });
    const after = await roleService.forStaff(orgId, row.id);
    expect(after.map((r) => [r.roleType, r.waiting])).toEqual([["librarian", false]]);
    const grants = await db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, joined.userId), isNull(roleAssignments.revokedAt)));
    expect(grants.map((g) => g.grantedBy)).toEqual([admin]);
  });

  it("a waiting role can be cancelled", async () => {
    const row = await staffService.createStaff(scope, { firstName: "Cancel", lastName: "Roles", phone: phone(2) });
    const given = await roleService.assignToStaff(orgId, admin, {
      staffId: row.id,
      roleType: "accountant",
      scopeType: "school",
      scopeId: schoolId,
    });
    expect(await roleService.cancelPending(orgId, admin, given.id)).toEqual({ id: given.id });
    expect(await roleService.forStaff(orgId, row.id)).toEqual([]);
  });

  it("a suspension stops the sign-in and keeps the role; lifting brings both back", async () => {
    const { staffId, userId } = await addAndJoin(3, "Pause");
    await roleService.assignToStaff(orgId, admin, { staffId, roleType: "accountant", scopeType: "school", scopeId: schoolId });

    await staffService.deactivateStaff(scope, staffId, { status: "suspended", note: "Inquiry open" }, admin);
    expect(await staffLoginService.accountState(phone(3))).toBe("paused");
    const [off] = await db.select().from(userTable).where(eq(userTable.id, userId));
    expect(off!.username).toBe(`suspended.${staffId}`);
    expect((await roleService.forStaff(orgId, staffId)).map((r) => r.roleType)).toEqual(["accountant"]);
    await expect(staffLoginService.invite(orgId, staffId, admin)).rejects.toThrow(/suspended/);

    const back = await staffService.reactivateStaff(scope, staffId, admin);
    expect(back!.status).toBe("active");
    expect(back!.statusNote).toBeNull();
    const [on] = await db.select().from(userTable).where(eq(userTable.id, userId));
    expect(on!.username).toBe(`staff.${phone(3)}`);
    expect(await staffLoginService.accountState(phone(3))).toBe("password");
  });

  it("on leave keeps the sign-in; back clears it", async () => {
    const { staffId } = await addAndJoin(4, "Leave");
    const away = await staffService.setLeave(scope, staffId, { onLeave: true, until: "2026-12-20", note: "Family" });
    expect([away!.status, away!.statusUntil, away!.statusNote]).toEqual(["on_leave", "2026-12-20", "Family"]);
    expect(await staffLoginService.accountState(phone(4))).toBe("password");
    const back = await staffService.setLeave(scope, staffId, { onLeave: false });
    expect([back!.status, back!.statusUntil]).toEqual(["active", null]);
  });

  it("a joined person's new phone moves their sign-in at once", async () => {
    const { staffId, userId } = await addAndJoin(5, "Phone");
    await staffService.updateStaff(scope, staffId, { phone: phone(6) }, admin);
    const [login] = await db.select().from(userTable).where(eq(userTable.id, userId));
    expect(login!.username).toBe(`staff.${phone(6)}`);
    expect(await staffLoginService.accountState(phone(6))).toBe("password");
    expect(await staffLoginService.accountState(phone(5))).toBe("code");
  });

  it("extends a role's end date and lists it as ending soon", async () => {
    const { staffId } = await addAndJoin(7, "Ending");
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const given = await roleService.assignToStaff(orgId, admin, {
      staffId,
      roleType: "vice_principal",
      scopeType: "school",
      scopeId: schoolId,
      expiresAt: soon,
    });
    const ending = await roleService.ending(orgId, schoolId);
    expect(ending.some((e) => e.id === given.id)).toBe(true);
    const later = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const extended = await roleService.extend(orgId, admin, given.id, later);
    expect(extended!.expiresAt!.toISOString()).toBe(later);
    expect((await roleService.ending(orgId, schoolId)).some((e) => e.id === given.id)).toBe(false);
  });

  it("history reads the person's audit trail back, newest first", async () => {
    const { staffId } = await addAndJoin(8, "History");
    await roleService.assignToStaff(orgId, admin, { staffId, roleType: "librarian", scopeType: "school", scopeId: schoolId });
    const history = await roleService.history(orgId, staffId);
    const actions = history.map((h) => h.action);
    expect(actions[0]).toBe("role_granted");
    expect(actions).toContain("staff_joined");
    expect(actions).toContain("staff_invited");
    expect(history[0]!.roleType).toBe("librarian");
  });

  it("leaving cancels waiting roles", async () => {
    const row = await staffService.createStaff(scope, { firstName: "Gone", lastName: "Roles", phone: phone(9) });
    await roleService.assignToStaff(orgId, admin, { staffId: row.id, roleType: "librarian", scopeType: "school", scopeId: schoolId });
    await staffService.deactivateStaff(scope, row.id, { status: "resigned" }, admin);
    const open = await db
      .select()
      .from(staffPendingRoles)
      .where(and(eq(staffPendingRoles.staffId, row.id), isNull(staffPendingRoles.cancelledAt)));
    expect(open).toEqual([]);
  });
});
