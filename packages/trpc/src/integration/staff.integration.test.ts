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

  it("provisions the first login: user row + forced change + audit (ADR-035)", async () => {
    // Re-activate the record first — logins are for active staff only.
    // Direct write: the activation path of the register is the admin's
    // act, and drizzle refuses a .set({}).
    await db
      .update(staffTable)
      .set({ status: "active", dateOfLeaving: null })
      .where(eq(staffTable.id, loginlessStaffId));

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
    expect(user!.email).toBeNull();
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
  });

  it("register reads never leak across the org boundary", async () => {
    const rows = await staffService.listStaff([scopeA1], "Integration");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgAId)).toBe(true);
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

