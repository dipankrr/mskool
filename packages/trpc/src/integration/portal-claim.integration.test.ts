import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * FAMILY CLAIM (ADR-037) — the passwordless-provisioning proofs, against REAL
 * Postgres. What only the database and the services can vouch for:
 *
 *   - `ensureLink` mints the GLOBAL phone user (digits-only username, no
 *     credential row) and a PENDING link; re-linking never downgrades an
 *     active pair and never touches a secret;
 *   - `claim` with a bad phone, a wrong admission number, or a wrong DOB is
 *     the SAME uniform refusal every time (no enumeration oracle);
 *   - the first claim sets the password and activates only the trio-matching
 *     links — a sibling linked under the same phone stays pending;
 *   - `verifyLink` activates the nth kid with that kid's pair and rejects a
 *     foreign kid with the same uniform refusal;
 *   - a second claim (forgot) re-sets the password, kills every live
 *     session, and writes the reset audit row;
 *   - `revokeLink` flags (never deletes), drops ownership immediately, and
 *     is invisible cross-tenant;
 *   - the `canAccessPortal` guardian gate actually bites.
 *
 * Fixtures are per-run and FULLY PRIVATE: the suite assembles its own orgs
 * from the world helpers (RUN-suffixed slugs, emails, admission numbers and
 * phones) instead of borrowing the authz world. The claim lifecycle needs
 * its students ACTIVE, and vitest runs test files concurrently — students
 * left active in the shared authz world would break its exact registry pin
 * mid-run (the exam suite hit the same wall; isolation is structural, not
 * sweep-based). Private orgs also mean re-runs accumulate rows by design
 * and never collide.
 */

import { db } from "@repo/db";
import {
  authzAuditLog,
  guardians,
  session as sessionTable,
  studentGuardians,
  studentPortalAccess,
  user as userTable,
} from "@repo/db/schema";
import {
  findOrCreateAssignment,
  findOrCreateOrganization,
  findOrCreateSchool,
  findOrCreateUser,
  syncDefaultPermissions,
} from "./world";
import { portalAccessService } from "@repo/services";
import { studentService } from "@repo/services";
import { getOwnedStudentIds, type DataScope } from "@repo/authz";
import { and, eq } from "drizzle-orm";

const RUN = Date.now();
const adm = (suffix: string) => `CLM-${RUN}-${suffix}`;
/** Per-run 10-digit phones: no collision with any other run's users. */
const PHONE = `9${String(RUN).slice(-9)}`;
const PHONE_OTHER = `8${String(RUN).slice(-9)}`;
const ORG_A_SLUG = `clm-itg-a-${RUN}`;
const ORG_B_SLUG = `clm-itg-b-${RUN}`;
const DOB_1 = "2015-04-02";
const DOB_2 = "2017-09-11";

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

describe("family claim (ADR-037)", () => {
  let orgAId: string;
  let orgBId: string;
  let schoolA1Id: string;
  let schoolB1Id: string;
  let scopeA1: DataScope;
  let scopeB1: DataScope;
  let adminAId: string;
  let adminBId: string;
  let kid1Id: string;
  let kid2Id: string;
  let kidBId: string;
  let familyUserId: string;

  beforeAll(async () => {
    // A minimal PRIVATE world — the shared authz world is left untouched.
    // Run-keyed orgs/users mean find-or-create never collides with a prior
    // run or another suite running in parallel.
    const [orgA, orgB] = await Promise.all([
      findOrCreateOrganization(ORG_A_SLUG, "Claim ITG Trust A"),
      findOrCreateOrganization(ORG_B_SLUG, "Claim ITG Trust B"),
    ]);
    await Promise.all([
      syncDefaultPermissions(orgA.id),
      syncDefaultPermissions(orgB.id),
    ]);
    const [schoolA1, schoolB1] = await Promise.all([
      findOrCreateSchool(orgA.id, "CLM-A1", "Claim ITG School A1"),
      findOrCreateSchool(orgB.id, "CLM-B1", "Claim ITG School B1"),
    ]);
    const [adminA, adminB] = await Promise.all([
      findOrCreateUser(`clm-admin-a-${RUN}`),
      findOrCreateUser(`clm-admin-b-${RUN}`),
    ]);
    await Promise.all([
      findOrCreateAssignment({
        userId: adminA.id, organizationId: orgA.id,
        roleType: "org_admin", scopeType: "org", scopeId: orgA.id,
      }),
      findOrCreateAssignment({
        userId: adminB.id, organizationId: orgB.id,
        roleType: "org_admin", scopeType: "org", scopeId: orgB.id,
      }),
    ]);
    orgAId = orgA.id;
    orgBId = orgB.id;
    schoolA1Id = schoolA1.id;
    schoolB1Id = schoolB1.id;
    scopeA1 = schoolScope(orgAId, schoolA1Id);
    scopeB1 = schoolScope(orgBId, schoolB1Id);
    adminAId = adminA.id;
    adminBId = adminB.id;
  });

  it("admits two siblings in one school and one child in the foreign org", async () => {
    const kid1 = await studentService.createStudent(scopeA1, {
      admissionNumber: adm("K1"),
      firstName: "Claim",
      lastName: "One",
      dateOfBirth: DOB_1,
      gender: "female",
    });
    const kid2 = await studentService.createStudent(scopeA1, {
      admissionNumber: adm("K2"),
      firstName: "Claim",
      lastName: "Two",
      dateOfBirth: DOB_2,
      gender: "male",
    });
    const kidB = await studentService.createStudent(scopeB1, {
      admissionNumber: adm("KB"),
      firstName: "Claim",
      lastName: "Bee",
      dateOfBirth: DOB_1,
      gender: "female",
    });
    kid1Id = kid1.id;
    kid2Id = kid2.id;
    kidBId = kidB.id;
    expect(kid1Id).toBeTruthy();
  });

  it("ensureLink mints the global phone user with no credential, link pending", async () => {
    const access = await portalAccessService.ensureLink(scopeA1, adminAId, {
      studentId: kid1Id,
      phone: PHONE,
    });
    expect(access?.isActive).toBe(false);
    familyUserId = access!.userId;

    const [login] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, familyUserId));
    // Global identity: digits only, no slug, no email, no forced-change
    // flag (there is no hand-off secret to force).
    expect(login!.username).toBe(PHONE);
    expect(login!.email).toBeNull();

    const status = await portalAccessService.linkStatus(scopeA1, kid1Id);
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      userId: familyUserId,
      username: PHONE,
      isActive: false,
      hasCredential: false,
    });
    // Pending is invisible to ownership: no session-less leak.
    expect(await getOwnedStudentIds(familyUserId)).toHaveLength(0);
  });

  it("claim refusals are uniform: unknown phone, wrong number, wrong DOB", async () => {
    const trio = { admissionNumber: adm("K1"), dateOfBirth: DOB_1, password: "ClaimPass123!" };
    const [unknown, wrongAdm, wrongDob] = await Promise.allSettled([
      portalAccessService.claim({ phone: PHONE_OTHER, ...trio }),
      portalAccessService.claim({ phone: PHONE, admissionNumber: adm("NOPE"), dateOfBirth: DOB_1, password: "ClaimPass123!" }),
      portalAccessService.claim({ phone: PHONE, admissionNumber: adm("K1"), dateOfBirth: "2000-01-01", password: "ClaimPass123!" }),
    ]);
    const messages = [unknown, wrongAdm, wrongDob].map((r) =>
      r.status === "rejected" ? String((r.reason as Error)?.message) : "RESOLVED?!",
    );
    for (const message of messages) {
      expect(message).toMatch(/do not match our records/i);
    }
    // The oracle test: all three read byte-identical.
    expect(new Set(messages).size).toBe(1);
  });

  it("first claim sets the password and activates only the matching link", async () => {
    // Sibling linked under the same phone BEFORE the claim.
    const sib = await portalAccessService.ensureLink(scopeA1, adminAId, {
      studentId: kid2Id,
      phone: PHONE,
    });
    expect(sib!.userId).toBe(familyUserId);

    const out = await portalAccessService.claim({
      phone: PHONE,
      admissionNumber: adm("K1"),
      dateOfBirth: DOB_1,
      password: "ClaimPass123!",
    });
    expect(out.userId).toBe(familyUserId);
    expect(out.activatedStudentIds).toEqual([kid1Id]);

    const owned = await getOwnedStudentIds(familyUserId);
    expect(owned).toEqual([kid1Id]);
    const status = await portalAccessService.linkStatus(scopeA1, kid2Id);
    expect(status[0]).toMatchObject({ isActive: false, hasCredential: true });
  });

  it("verifyLink activates the second kid, rejects a foreign one uniformly", async () => {
    await expect(
      portalAccessService.verifyLink(familyUserId, {
        studentId: kid2Id,
        admissionNumber: adm("K2"),
        dateOfBirth: DOB_2,
      }),
    ).resolves.toBe(true);
    expect(await getOwnedStudentIds(familyUserId)).toEqual(
      expect.arrayContaining([kid1Id, kid2Id]),
    );

    // A stranger's kid id with a guessed pair: same uniform refusal, and
    // the failed attempt activates nothing.
    await expect(
      portalAccessService.verifyLink(familyUserId, {
        studentId: kidBId,
        admissionNumber: adm("K1"),
        dateOfBirth: DOB_1,
      }),
    ).rejects.toThrow(/do not match our records/i);
    expect(await getOwnedStudentIds(familyUserId)).toHaveLength(2);
  });

  it("cross-org: the same phone links the foreign-org child to the same user", async () => {
    const link = await portalAccessService.ensureLink(scopeB1, adminBId, {
      studentId: kidBId,
      phone: PHONE,
    });
    // One human, one login — the org boundary is crossed only by ownership.
    expect(link!.userId).toBe(familyUserId);

    await expect(
      portalAccessService.verifyLink(familyUserId, {
        studentId: kidBId,
        admissionNumber: adm("KB"),
        dateOfBirth: DOB_1,
      }),
    ).resolves.toBe(true);
    expect(await getOwnedStudentIds(familyUserId)).toEqual(
      expect.arrayContaining([kid1Id, kid2Id, kidBId]),
    );
  });

  it("forgot claim re-sets the password, kills sessions, audits", async () => {
    // A live session the reset must kill.
    await db.insert(sessionTable).values({
      id: crypto.randomUUID(),
      token: `itg-claim-${RUN}`,
      userId: familyUserId,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    await portalAccessService.claim({
      phone: PHONE,
      admissionNumber: adm("K1"),
      dateOfBirth: DOB_1,
      password: "ClaimPass456!",
    });

    const sessions = await db
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.userId, familyUserId));
    expect(sessions).toHaveLength(0);

    const [audit] = await db
      .select()
      .from(authzAuditLog)
      .where(
        and(
          eq(authzAuditLog.targetUserId, familyUserId),
          eq(authzAuditLog.action, "portal_password_reset"),
        ),
      );
    expect(audit).toBeTruthy();
    // Ownership survives the reset untouched.
    expect(await getOwnedStudentIds(familyUserId)).toHaveLength(3);
  });

  it("revokeLink flags, drops ownership at once, and is cross-tenant invisible", async () => {
    await expect(
      portalAccessService.revokeLink(scopeB1, adminBId, {
        studentId: kidBId,
        userId: familyUserId,
        reason: "Integration proof — custody test",
      }),
    ).resolves.toBe(true);
    expect(await getOwnedStudentIds(familyUserId)).toHaveLength(2);

    const status = await portalAccessService.linkStatus(scopeB1, kidBId);
    expect(status[0]?.isActive).toBe(false);

    // Foreign scope cannot even see the row to revoke it.
    await expect(
      portalAccessService.revokeLink(scopeA1, adminAId, {
        studentId: kidBId,
        userId: familyUserId,
      }),
    ).resolves.toBeNull();
  });

  it("the canAccessPortal guardian gate bites", async () => {
    const [guardian] = await db
      .insert(guardians)
      .values({
        organizationId: orgAId,
        firstName: "Claim",
        lastName: "Gate",
        phone: PHONE_OTHER,
      })
      .returning();
    await db.insert(studentGuardians).values({
      studentId: kid1Id,
      guardianId: guardian!.id,
      relation: "father",
      canAccessPortal: false,
    });

    await expect(
      portalAccessService.ensureLink(scopeA1, adminAId, {
        studentId: kid1Id,
        phone: PHONE_OTHER,
        guardianId: guardian!.id,
      }),
    ).rejects.toThrow(/switched off/i);
  });

  it("re-linking an active pair is a no-op that touches no secret", async () => {
    const before = await portalAccessService.linkStatus(scopeA1, kid1Id);
    const again = await portalAccessService.ensureLink(scopeA1, adminAId, {
      studentId: kid1Id,
      phone: PHONE,
    });
    expect(again!.isActive).toBe(true);
    const after = await portalAccessService.linkStatus(scopeA1, kid1Id);
    expect(after).toEqual(before);
  });
});
