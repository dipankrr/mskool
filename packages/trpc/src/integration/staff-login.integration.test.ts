import { beforeAll, describe, expect, it } from "vitest";

/**
 * STAFF SIGN-IN (ADR-068), against real Postgres: phone + joining code.
 *
 *   - a new staff record needs a 10-digit phone, refused when another current
 *     staff member here has it (named) or someone current elsewhere does;
 *   - account status says "code" until the person joins, then "password";
 *   - a wrong code is the uniform refusal and counts against the code;
 *     5 wrong tries kill it; a new invite revokes the old code;
 *   - join creates the `staff.<digits>` login and links the record; a second
 *     code re-sets the password;
 *   - leaving switches the login off (`left.<id>`), frees the number for
 *     another organisation, and account status goes back to "code".
 *
 * FIXTURE ISOLATION: borrows the authz world's orgs and schools; adds its own
 * staff rows keyed on per-run phones.
 */
import { db } from "@repo/db";
import { staff, staffJoinCodes, user as userTable } from "@repo/db/schema";
import { JOIN_MISMATCH, staffLoginService, staffService } from "@repo/services";
import type { DataScope } from "@repo/authz";
import { eq } from "drizzle-orm";
import { buildWorld } from "./world";

const RUN = String(Date.now()).slice(-7);
const phone = (n: number) => `9${RUN}${String(n).padStart(2, "0")}`;
const scope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

describe("staff sign-in (ADR-068)", () => {
  let scopeA: DataScope;
  let scopeB: DataScope;
  let adminA: string;
  let staffId: string;

  beforeAll(async () => {
    const world = await buildWorld();
    scopeA = scope(world.orgAId, world.schoolA1Id);
    scopeB = scope(world.orgBId, world.schoolB1Id);
    adminA = world.users.adminA;
    const row = await staffService.createStaff(scopeA, {
      firstName: "Join",
      lastName: "Tester",
      phone: `+91 ${phone(1).slice(0, 5)} ${phone(1).slice(5)}`,
      teachesClasses: true,
    });
    staffId = row.id;
  });

  it("stores the phone as 10 digits and suggests an employee code", async () => {
    const [row] = await db.select().from(staff).where(eq(staff.id, staffId));
    expect(row!.phone).toBe(phone(1));
    expect(row!.employeeCode).toMatch(/^EMP-\d{3,}$/);
    expect(row!.teachesClasses).toBe(true);
  });

  it("checks a phone: here (named), elsewhere (unnamed), free, invalid", async () => {
    expect(await staffLoginService.checkPhone(scopeA.organizationId, phone(1))).toEqual({
      state: "here",
      name: "Join Tester",
    });
    expect(await staffLoginService.checkPhone(scopeB.organizationId, phone(1))).toEqual({
      state: "elsewhere",
      name: null,
    });
    expect((await staffLoginService.checkPhone(scopeA.organizationId, phone(2))).state).toBe("free");
    expect((await staffLoginService.checkPhone(scopeA.organizationId, "12345")).state).toBe("invalid");
  });

  it("refuses a number that is current staff here or elsewhere", async () => {
    await expect(
      staffService.createStaff(scopeA, { firstName: "Dup", lastName: "Here", phone: phone(1) }),
    ).rejects.toThrow(/Join Tester already has this number/);
    await expect(
      staffService.createStaff(scopeB, { firstName: "Dup", lastName: "Else", phone: phone(1) }),
    ).rejects.toThrow(/another school/);
  });

  it("says 'code' before joining, for unknown numbers too", async () => {
    expect(await staffLoginService.accountState(phone(1))).toBe("code");
    expect(await staffLoginService.accountState(phone(99))).toBe("code");
  });

  it("a wrong code is the uniform refusal and counts against the code", async () => {
    const invite = await staffLoginService.invite(scopeA.organizationId, staffId, adminA);
    const wrong = invite.code === "000000" ? "111111" : "000000";
    await expect(
      staffLoginService.join({ phone: phone(1), code: wrong, password: "JoinTest123!" }),
    ).rejects.toThrow(JOIN_MISMATCH);
    const [open] = await db
      .select({ failed: staffJoinCodes.failedAttempts })
      .from(staffJoinCodes)
      .where(eq(staffJoinCodes.staffId, staffId))
      .orderBy(staffJoinCodes.createdAt);
    expect(open!.failed).toBeGreaterThanOrEqual(1);
  });

  it("a new invite revokes the old code; the new one joins", async () => {
    const first = await staffLoginService.invite(scopeA.organizationId, staffId, adminA);
    const second = await staffLoginService.invite(scopeA.organizationId, staffId, adminA);
    if (first.code !== second.code) {
      await expect(
        staffLoginService.join({ phone: phone(1), code: first.code, password: "JoinTest123!" }),
      ).rejects.toThrow(JOIN_MISMATCH);
    }
    const joined = await staffLoginService.join({
      phone: phone(1),
      code: second.code,
      password: "JoinTest123!",
    });
    expect(joined.firstJoin).toBe(true);
    const [login] = await db.select().from(userTable).where(eq(userTable.id, joined.userId));
    expect(login!.username).toBe(`staff.${phone(1)}`);
    expect(login!.email).toBeNull();
    const [row] = await db.select().from(staff).where(eq(staff.id, staffId));
    expect(row!.userId).toBe(joined.userId);
    expect(await staffLoginService.accountState(phone(1))).toBe("password");
    // The code works once.
    await expect(
      staffLoginService.join({ phone: phone(1), code: second.code, password: "Another123!" }),
    ).rejects.toThrow(JOIN_MISMATCH);
  });

  it("a later code re-sets the password of someone who joined", async () => {
    const invite = await staffLoginService.invite(scopeA.organizationId, staffId, adminA);
    expect(invite.resetsPassword).toBe(true);
    const again = await staffLoginService.join({
      phone: phone(1),
      code: invite.code,
      password: "NewPassword123!",
    });
    expect(again.firstJoin).toBe(false);
  });

  it("five wrong tries kill a code", async () => {
    const invite = await staffLoginService.invite(scopeA.organizationId, staffId, adminA);
    const wrong = invite.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      await expect(
        staffLoginService.join({ phone: phone(1), code: wrong, password: "JoinTest123!" }),
      ).rejects.toThrow(JOIN_MISMATCH);
    }
    await expect(
      staffLoginService.join({ phone: phone(1), code: invite.code, password: "JoinTest123!" }),
    ).rejects.toThrow(JOIN_MISMATCH);
  });

  it("leaving switches the login off and frees the number", async () => {
    const [before] = await db.select().from(staff).where(eq(staff.id, staffId));
    await staffService.deactivateStaff(scopeA, staffId, { status: "resigned" }, adminA);
    const [login] = await db.select().from(userTable).where(eq(userTable.id, before!.userId!));
    expect(login!.username).toBe(`left.${staffId}`);
    expect(await staffLoginService.accountState(phone(1))).toBe("code");
    // The number is free again, even in another organisation.
    const elsewhere = await staffService.createStaff(scopeB, {
      firstName: "New",
      lastName: "Home",
      phone: phone(1),
    });
    expect(elsewhere.phone).toBe(phone(1));
  });
});
