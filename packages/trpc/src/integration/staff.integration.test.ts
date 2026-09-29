import { beforeAll, describe, expect, it } from "vitest";

/**
 * STAFF & ROLES — the employment-register and privilege-change proofs,
 * against REAL Postgres (the fees/exams integration precedent). What only
 * the database and the services can vouch for:
 *
 *   - the register: per-org employee-code uniqueness bites, tenancy filters
 *     clip, the soft delete stamps the leaving status (hard rule 2);
 *   - login provisioning (ADR-035): the credential is a SEPARATE act — the
 *     first create links a better-auth user with `must_change_password`,
 *     a second create is refused, and both credential acts leave
 *     `authz_audit_log` rows;
 *   - role grants (ADR-005): a grant's target must have a staff record, the
 *     scope node must exist in THIS org with the claimed type, duplicates
 *     are refused, revoke is a soft delete carrying the reason, and both
 *     acts write audit rows;
 *   - cross-tenant invisibility: a foreign org's staff and scope are
 *     indistinguishable from nonexistent ones.
 *
 * FIXTURE ISOLATION: borrows the authz suite's world (orgs `authz-itg-a/b`)
 * for schools and users, and adds its OWN staff rows keyed on per-run
 * employee codes, so nothing here collides with the authz assertions.
 */

import { db } from "@repo/db";
import {
  authzAuditLog,
  organizations,
  roleAssignments,
  staff as staffTable,
  user as userTable,
} from "@repo/db/schema";
import { buildWorld } from "./world";
import { roleService, staffService } from "@repo/services";
import { invalidateUserAuthCache, type DataScope } from "@repo/authz";
import { and, eq, isNull } from "drizzle-orm";

const RUN = Date.now();
const code = (suffix: string) => `ITG-${RUN}-${suffix}`;

const schoolScope = (organizationId: string, schoolId: string): DataScope => ({
  organizationId,
  schoolId,
  classId: null,
  sectionId: null,
});

describe("staff & roles (ADR-035)", () => {
  let orgAId: string;
  let orgBId: string;
  let schoolA1Id: string;
  let schoolB1Id: string;
  let scopeA1: DataScope;
  let scopeB1: DataScope;
  let adminAId: string;
  let principalA1Id: string;
  let adminBId: string;
  let loginlessStaffId: string;
  let provisionedUserId: string;

  beforeAll(async () => {
    const world = await buildWorld();
    orgAId = world.orgAId;
    orgBId = world.orgBId;
    schoolA1Id = world.schoolA1Id;
    schoolB1Id = world.schoolB1Id;
    scopeA1 = schoolScope(orgAId, schoolA1Id);
    scopeB1 = schoolScope(orgBId, schoolB1Id);
    adminAId = world.users.adminA;
    principalA1Id = world.users.principalA1;
    adminBId = world.users.adminB;
  });

  it("creates a staff member with no login (employment ≠ credential, ADR-008)", async () => {
    const row = await staffService.createStaff(scopeA1, {
      employeeCode: code("T1"),
      firstName: "Integration",
      lastName: "Teacher",
      designation: "Teacher",
      // ADR-037: staff sign in with email — provisioning without one is
      // refused, so the record carries it before the login act.
      email: `itg-${RUN}-t1@itg.test`,
    });

    expect(row.userId).toBeNull();
    expect(row.status).toBe("active");
    loginlessStaffId = row.id;
  });

  it("refuses a duplicate employee code within the org (the unique index bites)", async () => {
    // Drizzle wraps the driver error — the constraint name rides in the
    // CAUSE, not the message ("Failed query: …"). The router's
    // translateErrors reads the same cause and words it (ADR-022).
    try {
      await staffService.createStaff(scopeA1, {
        employeeCode: code("T1"),
        firstName: "Duplicate",
        lastName: "Probe",
      });
      expect.unreachable("the unique index did not bite");
    } catch (e: any) {
      expect(String(e?.cause?.message ?? e?.message)).toMatch(
        /staff_org_employee_code_uq/,
      );
    }
  });

  it("clips the register by tenancy: a foreign scope sees none of it", async () => {
    const inOrg = await staffService.listStaff([scopeA1], code("T1"));
    expect(inOrg).toHaveLength(1);

    const foreign = await staffService.listStaff([scopeB1], code("T1"));
    expect(foreign).toHaveLength(0);
  });

  it("soft-deletes with an honest leaving status and a stamped dateOfLeaving", async () => {
    const resigned = await staffService.deactivateStaff(scopeA1, loginlessStaffId, {
      status: "resigned",
    });
    expect(resigned?.status).toBe("resigned");
    expect(resigned?.dateOfLeaving).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // A suspension is NOT a departure: no leaving date.
    const suspended = await staffService.createStaff(scopeA1, {
      employeeCode: code("T2"),
      firstName: "Integration",
      lastName: "Suspended",
    });
    const out = await staffService.deactivateStaff(scopeA1, suspended.id, {
      status: "suspended",
    });
    expect(out?.status).toBe("suspended");
    expect(out?.dateOfLeaving).toBeNull();
  });

  it("reactivation restores the record; an active record refuses it", async () => {
    // T2 was suspended two cases ago: the way back clears the status and
    // any leaving date (none here — suspensions never stamp one).
    const suspended = await staffService.listStaff([scopeA1], code("T2"));
    expect(suspended).toHaveLength(0); // suspended rows are history, not listed
    const [t2row] = await db
      .select()
      .from(staffTable)
      .where(eq(staffTable.employeeCode, code("T2")));
    const revived = await staffService.reactivateStaff(scopeA1, t2row!.id);
    expect(revived?.status).toBe("active");
    expect(revived?.dateOfLeaving).toBeNull();

    await expect(
      staffService.reactivateStaff(scopeA1, t2row!.id),
    ).rejects.toThrow(/already active/i);
    await expect(
      staffService.reactivateStaff(scopeA1, crypto.randomUUID()),
    ).resolves.toBeNull();
  });

  it("provisions the first login: user row + forced change + audit (ADR-035)", async () => {
    // Re-activate the record first — logins are for active staff only.
    const revived = await staffService.reactivateStaff(scopeA1, loginlessStaffId);
    expect(revived?.status).toBe("active");
    expect(revived?.dateOfLeaving).toBeNull();

    const actor = adminAId;
    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, orgAId));

    const row = await staffService.createLogin(
      scopeA1,
      actor,
      loginlessStaffId,
      "Integration123!",
    );

    expect(row?.userId).toBeTruthy();
    provisionedUserId = row!.userId!;

    const [user] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, provisionedUserId));
    expect(user!).toBeTruthy();
    expect(user!.mustChangePassword).toBe(true);
    // ADR-037: the sign-in email is copied from the record at provisioning.
    expect(user!.email).toBe(`itg-${RUN}-t1@itg.test`);
    // The username is {org_slug}-{employee_code}, lower-cased.
    expect(user!.username).toBe(
      `${org!.slug}-${code("T1")}`.toLowerCase(),
    );

    const [audit] = await db
      .select()
      .from(authzAuditLog)
      .where(
        and(
          eq(authzAuditLog.organizationId, orgAId),
          eq(authzAuditLog.action, "staff_login_created"),
          eq(authzAuditLog.targetUserId, provisionedUserId),
        ),
      );
    expect(audit).toBeTruthy();
    expect(audit?.actorUserId).toBe(actor);
  });

  it("refuses a second login — reset, not re-provision", async () => {
    await expect(
      staffService.createLogin(scopeA1, adminAId, loginlessStaffId, "Integration123!"),
    ).rejects.toThrow(/already has a login/i);
  });

  it("refuses provisioning without an email — the login would be unusable (ADR-037)", async () => {
    const noEmail = await staffService.createStaff(scopeA1, {
      employeeCode: code("T9"),
      firstName: "Integration",
      lastName: "NoEmail",
    });
    await expect(
      staffService.createLogin(scopeA1, adminAId, noEmail.id, "Integration123!"),
    ).rejects.toThrow(/email address/i);
    expect(noEmail.userId).toBeNull();
  });

  it("reset re-arms the forced change and writes its audit row", async () => {
    await staffService.resetLogin(scopeA1, adminAId, loginlessStaffId, "Integration456!");

    const [user] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, provisionedUserId));
    expect(user!).toBeTruthy();
    expect(user!.mustChangePassword).toBe(true);

    const [audit] = await db
      .select()
      .from(authzAuditLog)
      .where(
        and(
          eq(authzAuditLog.organizationId, orgAId),
          eq(authzAuditLog.action, "staff_password_reset"),
          eq(authzAuditLog.targetUserId, provisionedUserId),
        ),
      );
    expect(audit).toBeTruthy();
  });

  it("provisioning is refused for a foreign org's staff row", async () => {
    await expect(
      staffService.createLogin(scopeB1, adminBId, loginlessStaffId, "Integration123!"),
    ).resolves.toBeNull();
  });

  it("deactivation strands nothing permanently: reset works inactive, reactivate restores", async () => {
    // A resignation with a live login: the credential stays usable until
    // someone resets it (ADR-035 defers deprovisioning automation), so the
    // reset path must stay open for inactive records.
    await staffService.deactivateStaff(scopeA1, loginlessStaffId, {
      status: "resigned",
    });
    await staffService.resetLogin(scopeA1, adminAId, loginlessStaffId, "AfterLeaving123!");
    const [user] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, provisionedUserId));
    expect(user!.mustChangePassword).toBe(true);

    const back = await staffService.reactivateStaff(scopeA1, loginlessStaffId);
    expect(back?.status).toBe("active");
    expect(back?.dateOfLeaving).toBeNull();
  });

  it("an empty patch is refused with words, not a driver 500", async () => {
    await expect(staffService.updateStaff(scopeA1, loginlessStaffId, {})).rejects.toThrow(
      /Nothing to update/i,
    );
  });

  it("adopts a login stranded by a crashed provisioning instead of stranding the record", async () => {
    const t3 = await staffService.createStaff(scopeA1, {
      employeeCode: code("T3"),
      firstName: "Integration",
      lastName: "Orphan",
      email: `itg-${RUN}-t3@itg.test`,
    });
    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, orgAId));
    const username = `${org!.slug}-${code("T3")}`.toLowerCase();

    // The footprint of the old crash: the user row landed, the link did not.
    const [orphan] = await db
      .insert(userTable)
      .values({
        id: crypto.randomUUID(),
        name: "Integration Orphan",
        username,
        displayUsername: username,
      })
      .returning();

    const row = await staffService.createLogin(scopeA1, adminAId, t3.id, "Adopted123!");
    expect(row?.userId).toBe(orphan!.id);

    const [adoptedUser] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, orphan!.id));
    expect(adoptedUser!.mustChangePassword).toBe(true);

    const [audit] = await db
      .select()
      .from(authzAuditLog)
      .where(
        and(
          eq(authzAuditLog.organizationId, orgAId),
          eq(authzAuditLog.action, "staff_login_created"),
          eq(authzAuditLog.targetUserId, orphan!.id),
        ),
      );
    expect(audit?.details).toMatchObject({ adopted: true });
  });

  describe("role assignments (ADR-005)", () => {
    it("grants, refuses duplicates, revokes once, and audits both acts", async () => {
      // The grant target needs a staff record of her own (the service's
      // guard). Per-run employee code — re-runs accumulate rows by design.
      const [staffRow] = await db
        .insert(staffTable)
        .values({
          organizationId: orgAId,
          schoolId: schoolA1Id,
          userId: principalA1Id,
          employeeCode: code("P1"),
          firstName: "Integration",
          lastName: "Principal",
          designation: "Principal",
        })
        .returning();
      expect(staffRow).toBeTruthy();

      // A live grant from a previous run must not stand (rows accumulate;
      // the duplicate guard would otherwise point at history).
      await db
        .update(roleAssignments)
        .set({ revokedAt: new Date(), revokedBy: adminAId })
        .where(
          and(
            eq(roleAssignments.organizationId, orgAId),
            eq(roleAssignments.userId, principalA1Id),
            eq(roleAssignments.roleType, "librarian"),
            isNull(roleAssignments.revokedAt),
          ),
        );

      const row = await roleService.assign(orgAId, adminAId, {
        userId: principalA1Id,
        roleType: "librarian",
        scopeType: "school",
        scopeId: schoolA1Id,
      });

      expect(row.revokedAt).toBeNull();
      expect(row.grantedBy).toBe(adminAId);

      // Duplicate live grant — the same person, role, and scope.
      await expect(
        roleService.assign(orgAId, adminAId, {
          userId: principalA1Id,
          roleType: "librarian",
          scopeType: "school",
          scopeId: schoolA1Id,
        }),
      ).rejects.toThrow(/already granted/i);

      const revoked = await roleService.revoke(orgAId, adminAId, row.id, {
        reason: "Integration proof — the grant was a test",
      });
      expect(revoked?.revokedBy).toBe(adminAId);
      expect(revoked?.revokedAt).toBeTruthy();

      await invalidateUserAuthCache(principalA1Id);

      const [grantAudit] = await db
        .select()
        .from(authzAuditLog)
        .where(
          and(
            eq(authzAuditLog.organizationId, orgAId),
            eq(authzAuditLog.action, "role_granted"),
            eq(authzAuditLog.targetUserId, principalA1Id),
            eq(authzAuditLog.roleType, "librarian"),
          ),
        )
        .limit(1);
      expect(grantAudit).toBeTruthy();

      const [revokeAudit] = await db
        .select()
        .from(authzAuditLog)
        .where(
          and(
            eq(authzAuditLog.organizationId, orgAId),
            eq(authzAuditLog.action, "role_revoked"),
            eq(authzAuditLog.targetUserId, principalA1Id),
            eq(authzAuditLog.roleType, "librarian"),
          ),
        )
        .limit(1);
      expect(revokeAudit?.details).toMatchObject({
        reason: "Integration proof — the grant was a test",
      });

      // Revoking twice is a null, never a second edit of history.
      const again = await roleService.revoke(orgAId, adminAId, row.id, {
        reason: "Second attempt must not pass",
      });
      expect(again).toBeNull();
    });

    it("refuses a target with no staff record in the org", async () => {
      await expect(
        roleService.assign(orgAId, adminAId, {
          userId: adminBId, // an admin of the FOREIGN org
          roleType: "librarian",
          scopeType: "school",
          scopeId: schoolA1Id,
        }),
      ).rejects.toThrow(/holds no staff record/i);
    });

    it("refuses a scope node that does not exist in this org", async () => {
      await expect(
        roleService.assign(orgAId, adminAId, {
          userId: principalA1Id,
          roleType: "librarian",
          scopeType: "school",
          scopeId: schoolB1Id, // foreign ORG node
        }),
      ).rejects.toThrow(/does not exist in this organisation/i);
    });

    it("refuses an org grant whose scope is not the org itself", async () => {
      await expect(
        roleService.assign(orgAId, adminAId, {
          userId: principalA1Id,
          roleType: "librarian",
          scopeType: "org",
          scopeId: schoolA1Id,
        }),
      ).rejects.toThrow(/granted at the organisation itself/i);
    });

    it("labels active assignments for display", async () => {
      const views = await roleService.listForUser(orgAId, principalA1Id);
      const principalGrant = views.find(
        (v) => v.roleType === "principal" && v.scopeId === schoolA1Id,
      );
      expect(principalGrant).toBeTruthy();
      expect(principalGrant!.scopeLabel).not.toBe("Unknown scope");
    });

    it("reads the org's permission matrix", async () => {
      const matrix = await roleService.listPermissions(orgAId);
      expect(matrix.length).toBeGreaterThan(0);
      expect(matrix.some((r) => r.roleType === "principal")).toBe(true);
    });

    it("holders resolve to this org's staff record, never another org's (M8)", async () => {
      // principalA1 holds a staff row in orgA (P1, above). Give the SAME
      // login a staff row in orgB: the join must still resolve orgA's row.
      const [foreignRow] = await db
        .insert(staffTable)
        .values({
          organizationId: orgBId,
          schoolId: schoolB1Id,
          userId: principalA1Id,
          employeeCode: code("PX"),
          firstName: "Foreign",
          lastName: "Twin",
        })
        .returning();

      // A live grant from a previous run must not stand (rows accumulate;
      // the duplicate guard would otherwise point at history).
      await db
        .update(roleAssignments)
        .set({ revokedAt: new Date(), revokedBy: adminAId })
        .where(
          and(
            eq(roleAssignments.organizationId, orgAId),
            eq(roleAssignments.userId, principalA1Id),
            eq(roleAssignments.roleType, "accountant"),
            isNull(roleAssignments.revokedAt),
          ),
        );

      const grant = await roleService.assign(orgAId, adminAId, {
        userId: principalA1Id,
        roleType: "accountant",
        scopeType: "school",
        scopeId: schoolA1Id,
      });

      const holders = await roleService.listHolders(orgAId);
      const mine = holders.filter(
        (h) => h.userId === principalA1Id && h.roleType === "accountant",
      );
      // Rows accumulate across runs by design, so several orgA staff rows
      // may resolve — but every one must be orgA's. Pre-fix the join also
      // returned the orgB twin (a 404 staffId and a foreign name).
      expect(mine.length).toBeGreaterThan(0);
      const orgAStaffIds = new Set(
        (
          await db
            .select({ id: staffTable.id })
            .from(staffTable)
            .where(
              and(
                eq(staffTable.userId, principalA1Id),
                eq(staffTable.organizationId, orgAId),
              ),
            )
        ).map((r) => r.id),
      );
      expect(mine.every((h) => orgAStaffIds.has(h.staffId))).toBe(true);
      expect(mine.some((h) => h.staffId === foreignRow!.id)).toBe(false);

      await roleService.revoke(orgAId, adminAId, grant.id, {
        reason: "Integration proof — the grant was a test",
      });
    });
  });

  it("register reads never leak across the org boundary", async () => {
    const rows = await staffService.listStaff([scopeA1], "Integration");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgAId)).toBe(true);
  });

  it("search escapes wildcards: % and _ match nothing by themselves (M12)", async () => {
    expect(await staffService.listStaff([scopeA1], "%")).toHaveLength(0);
    expect(await staffService.listStaff([scopeA1], "_")).toHaveLength(0);
    // And ordinary search still works through the same path.
    expect((await staffService.listStaff([scopeA1], code("T1"))).length).toBeGreaterThan(0);
  });

  describe("permission editor (ADR-036)", () => {
    it("serves the grouped catalog and the shipped defaults as data", () => {
      const { catalog, defaults } = roleService.permissionDefaults();

      expect(catalog.length).toBeGreaterThan(0);
      const academic = catalog.find((c) => c.category === "Academic");
      expect(academic?.resources.some((r) => r.resource === "student")).toBe(true);
      expect(defaults.some((d) => d.roleType === "principal")).toBe(true);
    });

    it("applies a batched diff, audits each changed permission, and resets by diff", async () => {
      const actor = adminAId; // org_admin: editable target, holds no librarian role

      const result = await roleService.updatePermissions(orgAId, actor, ["org_admin"], {
        roleType: "librarian",
        add: ["student:export"],
        remove: [],
      });
      expect(result).toMatchObject({ added: 1, removed: 0 });

      const [addedAudit] = await db
        .select()
        .from(authzAuditLog)
        .where(
          and(
            eq(authzAuditLog.organizationId, orgAId),
            eq(authzAuditLog.action, "permission_added"),
            eq(authzAuditLog.permission, "student:export"),
          ),
        )
        .limit(1);
      expect(addedAudit).toBeTruthy();

      // A no-op save writes nothing (unchanged permissions are not audited).
      const noop = await roleService.updatePermissions(orgAId, actor, ["org_admin"], {
        roleType: "librarian",
        add: ["student:export"],
        remove: [],
      });
      expect(noop).toMatchObject({ added: 0, removed: 0 });

      // Reset is diff-only: exactly the one diverging permission is withdrawn.
      const reset = await roleService.resetPermissions(orgAId, actor, ["org_admin"], "librarian");
      expect(reset).toMatchObject({ added: 0, removed: 1 });

      const [removedAudit] = await db
        .select()
        .from(authzAuditLog)
        .where(
          and(
            eq(authzAuditLog.organizationId, orgAId),
            eq(authzAuditLog.action, "permission_removed"),
            eq(authzAuditLog.permission, "student:export"),
          ),
        )
        .limit(1);
      expect(removedAudit).toBeTruthy();
    });

    it("never edits the bootstrap role", async () => {
      await expect(
        roleService.updatePermissions(orgAId, adminAId, ["org_admin"], {
          roleType: "org_admin",
          add: [],
          remove: ["fees:collect"],
        }),
      ).rejects.toThrow(/bootstrap role/i);
    });

    it("never lets a caller edit a role they hold", async () => {
      await expect(
        roleService.updatePermissions(orgAId, adminAId, ["librarian"], {
          roleType: "librarian",
          add: ["student:export"],
          remove: [],
        }),
      ).rejects.toThrow(/hold this role yourself/i);
    });

    it("refuses permissions the system does not know, and self-contradictory diffs", async () => {
      await expect(
        roleService.updatePermissions(orgAId, adminAId, ["org_admin"], {
          roleType: "librarian",
          add: ["not_a_permission"],
          remove: [],
        }),
      ).rejects.toThrow(/not a permission this system knows/i);

      await expect(
        roleService.updatePermissions(orgAId, adminAId, ["org_admin"], {
          roleType: "librarian",
          add: ["student:read"],
          remove: ["student:read"],
        }),
      ).rejects.toThrow(/both added and removed/i);
    });
  });
});

