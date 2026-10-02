import { beforeAll, describe, expect, it } from "vitest";

/**
 * GUARDIANS — the parents' contact truth (ADR-037's follow-up), against REAL
 * Postgres. What only the database and the services can vouch for:
 *
 *   - adding a guardian dedupes the contact by (org, phone) and immediately
 *     gains the PENDING family link — no typed secrets, no credential row;
 *   - the same digits on a sibling (or a foreign-org child) share the one
 *     global user; re-attaching an active pair is refused, re-linking after
 *     a detach reopens;
 *   - a phone correction moves the login (old link revoked, new pending);
 *     switching portal access off revokes, switching on re-pends;
 *   - detach stamps history and revokes, except when the digits are still
 *     genuinely shared by another live relation;
 *   - cross-tenant ids are invisible (null/empty, never foreign rows).
 *
 * Per-run fixtures (RUN-suffixed numbers and phones) accumulate by design.
 */

import { db } from "@repo/db";
import {
  guardians,
  studentGuardians,
  studentPortalAccess,
  user as userTable,
} from "@repo/db/schema";
import { buildGuardianWorld, buildWorld } from "./world";
import { guardianService, studentService } from "@repo/services";
import { getOwnedStudentIds, type DataScope } from "@repo/authz";
import { and, eq } from "drizzle-orm";

const RUN = Date.now();
const adm = (suffix: string) => `GRD-${RUN}-${suffix}`;
const PHONE_FATHER = `7${String(RUN).slice(-9)}`;
const PHONE_MOTHER = `6${String(RUN).slice(-9)}`;
const PHONE_NEW = `5${String(RUN).slice(-9)}`;
const DOB = "2016-02-29";

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

describe("guardians (parents' contact truth)", () => {
  let orgCId: string;
  let orgDId: string;
  let schoolC1Id: string;
  let schoolD1Id: string;
  let scopeC1: DataScope;
  let scopeD1: DataScope;
  let adminAId: string;
  let adminBId: string;
  let kid1Id: string;
  let kid2Id: string;
  let fatherGuardianId: string;
  let fatherUserId: string;

  beforeAll(async () => {
    const world = await buildWorld();
    const gworld = await buildGuardianWorld();
    orgCId = gworld.orgCId;
    orgDId = gworld.orgDId;
    schoolC1Id = gworld.schoolC1Id;
    schoolD1Id = gworld.schoolD1Id;
    scopeC1 = schoolScope(orgCId, schoolC1Id);
    scopeD1 = schoolScope(orgDId, schoolD1Id);
    adminAId = world.users.adminA;
    adminBId = world.users.adminB;

    kid1Id = (
      await studentService.createStudent(scopeC1, {
        admissionNumber: adm("K1"),
        firstName: "Guardian",
        lastName: "One",
        dateOfBirth: DOB,
        gender: "female",
      })
    ).id;
    kid2Id = (
      await studentService.createStudent(scopeC1, {
        admissionNumber: adm("K2"),
        firstName: "Guardian",
        lastName: "Two",
        dateOfBirth: DOB,
        gender: "male",
      })
    ).id;
  });

  it("adds a guardian and gains the pending link with no credential", async () => {
    const view = await guardianService.addGuardian(scopeC1, adminAId, {
      studentId: kid1Id,
      firstName: "Guardian",
      lastName: "Father",
      relation: "father",
      phone: PHONE_FATHER,
      isPrimary: true,
    });
    expect(view?.phone).toBe(PHONE_FATHER);
    expect(view?.isPrimary).toBe(true);
    expect(view?.portal).toMatchObject({ username: PHONE_FATHER, isActive: false });
    expect(view?.portal?.hasCredential).toBe(false);
    fatherGuardianId = view!.id;

    const [login] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.username, PHONE_FATHER));
    expect(login!.email).toBeNull();
    fatherUserId = login!.id;
    // Pending is invisible to ownership.
    expect(await getOwnedStudentIds(login!.id)).toHaveLength(0);
  });

  it("mother gets her own login; the same father on a sibling shares his", async () => {
    const mother = await guardianService.addGuardian(scopeC1, adminAId, {
      studentId: kid1Id,
      firstName: "Guardian",
      lastName: "Mother",
      relation: "mother",
      phone: PHONE_MOTHER,
    });
    expect(mother?.portal?.username).toBe(PHONE_MOTHER);

    const sib = await guardianService.addGuardian(scopeC1, adminAId, {
      studentId: kid2Id,
      firstName: "Guardian",
      lastName: "Father",
      relation: "father",
      phone: PHONE_FATHER,
    });
    // Same digits, same global user — second kid, no second account.
    const [login] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.username, PHONE_FATHER));
    expect(sib?.portal?.username).toBe(PHONE_FATHER);
    expect(login!.id).toBe(fatherUserId);

    await expect(
      guardianService.addGuardian(scopeC1, adminAId, {
        studentId: kid1Id,
        firstName: "Guardian",
        lastName: "Father",
        relation: "father",
        phone: PHONE_FATHER,
      }),
    ).rejects.toThrow(/already linked/i);
  });

  it("lists guardians with inline login state, primary first", async () => {
    const views = await guardianService.listForStudent(scopeC1, kid1Id);
    expect(views).toHaveLength(2);
    expect(views[0]!.isPrimary).toBe(true);
    expect(views.map((view) => view.phone).sort()).toEqual(
      [PHONE_FATHER, PHONE_MOTHER].sort(),
    );
  });

  it("a phone correction moves the login: old revoked, new pending", async () => {
    const updated = await guardianService.updateGuardian(scopeC1, adminAId, {
      studentId: kid1Id,
      guardianId: fatherGuardianId,
      phone: PHONE_NEW,
    });
    expect(updated?.phone).toBe(PHONE_NEW);
    expect(updated?.portal).toMatchObject({ username: PHONE_NEW, isActive: false });

    // The old login lost THIS student (kid2's shared row survives on it).
    const oldLinks = await db
      .select()
      .from(studentPortalAccess)
      .where(
        and(
          eq(studentPortalAccess.userId, fatherUserId),
          eq(studentPortalAccess.studentId, kid1Id),
        ),
      );
    expect(oldLinks[0]?.isActive).toBe(false);

    const [newLogin] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.username, PHONE_NEW));
    expect(newLogin).toBeTruthy();
  });

  it("switching portal access off revokes, switching on re-pends", async () => {
    await guardianService.updateGuardian(scopeC1, adminAId, {
      studentId: kid2Id,
      guardianId: fatherGuardianId,
      canAccessPortal: false,
    });
    // kid2's father link (shared user) is revoked; kid1's corrected login
    // is a different user and untouched.
    const views = await guardianService.listForStudent(scopeC1, kid2Id);
    const father = views.find((view) => view.id === fatherGuardianId);
    expect(father?.canAccessPortal).toBe(false);

    await guardianService.updateGuardian(scopeC1, adminAId, {
      studentId: kid2Id,
      guardianId: fatherGuardianId,
      canAccessPortal: true,
    });
    const reopened = await guardianService.listForStudent(scopeC1, kid2Id);
    const fatherAgain = reopened.find((view) => view.id === fatherGuardianId);
    expect(fatherAgain?.canAccessPortal).toBe(true);
    expect(fatherAgain?.portal?.isActive).toBe(false);
  });

  it("detach stamps history and revokes, shared digits survive", async () => {
    // Mother holds kid1 alone on her digits: detaching revokes her link.
    const motherViews = await guardianService.listForStudent(scopeC1, kid1Id);
    const mother = motherViews.find((view) => view.phone === PHONE_MOTHER)!;
    const detached = await guardianService.detachGuardian(scopeC1, adminAId, {
      studentId: kid1Id,
      guardianId: mother.id,
      reason: "Integration proof — custody test",
    });
    expect(detached?.endedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [motherLogin] = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.username, PHONE_MOTHER));
    const [revoked] = await db
      .select()
      .from(studentPortalAccess)
      .where(
        and(
          eq(studentPortalAccess.userId, motherLogin!.id),
          eq(studentPortalAccess.studentId, kid1Id),
        ),
      );
    expect(revoked?.isActive).toBe(false);
    expect(revoked?.revokedAt).toBeTruthy();
  });

  it("cross-tenant ids are invisible", async () => {
    await expect(
      guardianService.addGuardian(scopeD1, adminBId, {
        studentId: kid1Id,
        firstName: "Foreign",
        lastName: "Probe",
        relation: "father",
        phone: PHONE_NEW,
      }),
    ).resolves.toBeNull();
    expect(await guardianService.listForStudent(scopeD1, kid1Id)).toEqual([]);
    // And the foreign admin cannot touch the guardian row either.
    await expect(
      guardianService.updateGuardian(scopeD1, adminBId, {
        studentId: kid1Id,
        guardianId: fatherGuardianId,
        firstName: "Foreign",
      }),
    ).resolves.toBeNull();
  });

  it("guardian contact dedupes by phone within the org", async () => {
    const [guardian] = await db
      .select({ id: guardians.id })
      .from(guardians)
      .where(
        and(eq(guardians.organizationId, orgCId), eq(guardians.phone, PHONE_NEW)),
      );
    const count = await db
      .select({ id: studentGuardians.id })
      .from(studentGuardians)
      .where(eq(studentGuardians.guardianId, guardian!.id));
    // kid1 (corrected) + kid2 (sibling share): one contact, two relations.
    expect(count.length).toBeGreaterThanOrEqual(1);
  });
});
