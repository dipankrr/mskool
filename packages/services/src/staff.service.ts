import { requireSchoolId } from "./academic.service";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import { revokeUserSessions, setUserPassword } from "@repo/auth/credentials";
import type {
  CreateStaffInput,
  DeactivateStaffInput,
  UpdateStaffInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import { authzAuditLog, organizations, staff, user } from "@repo/db/schema";
import { and, asc, eq, ilike, or } from "drizzle-orm";

/**
 * STAFF — the employment register (ADR-008). The row is the EMPLOYMENT
 * identity; the login is a separate, later act (ADR-035). What a staff
 * member may DO lives in role_assignments (role.service), never here.
 *
 * Knows nothing about HTTP. The staff track takes a DataScope as a REQUIRED
 * argument and filters by it (hard rule 1); input types come from
 * `@repo/contracts`.
 *
 * **Scope shape: SCHOOL-level.** The staff table has a primary posting
 * (`schoolId`) and no class/section columns — a section-scoped coordinator
 * listing staff is asking about the school's register, the same
 * entity-shape widening as the student registry (documented in
 * academic.service.ts). NOT in the scope tree — no `scope_nodes` row (hard
 * rule 12 names school/class/section only); the denormalised
 * `organizationId` + `schoolId` feed `scopeWhere` like every academic table.
 *
 * Login provisioning (ADR-035) is the one credential-shaped concern here,
 * and hard rule 9 still holds: passwords and sessions go through
 * @repo/auth's credential seam. The `user` insert is the sanctioned
 * direct write (the same one portal activation makes) — better-auth's own
 * adapter mints this exact shape on sign-up, `email: null` per ADR-007.
 */

const STAFF_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: staff.organizationId,
  schoolId: staff.schoolId,
} as const;

/** better-auth's username plugin validator, lower-cased (ADR-007 rider). */
const USERNAME_RE = /^[a-z0-9._-]+$/;

const fullName = (row: { firstName: string; middleName: string | null; lastName: string }) =>
  [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ");

export class StaffService {
  /**
   * Admits a staff member into the register. No login is created — ADR-035
   * separates the employment record from the credential. A duplicate
   * employee code within the org is refused by `staff_org_employee_code_uq`,
   * not pre-checked (ADR-22); `translateErrors` words it.
   */
  async createStaff(scope: DataScope, input: CreateStaffInput) {
    const schoolId = requireSchoolId(scope);

    const [row] = await db
      .insert(staff)
      .values({
        ...input,
        organizationId: scope.organizationId,
        schoolId,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create staff record.");
    }

    return row;
  }

  /**
   * The branch's staff register. Takes the PLURAL scopes (a user may hold
   * grants in several branches). Active only unless `includeInactive` —
   * resigned teachers are history (hard rule 2), not options for tomorrow's
   * role assignments.
   *
   * `q` searches name parts and the employee code — the one lookup HR
   * actually performs at a desk.
   */
  async listStaff(scopes: DataScope[], q?: string, includeInactive?: boolean) {
    return db
      .select()
      .from(staff)
      .where(
        and(
          scopeWhere(scopes, STAFF_SCOPE_COLUMNS),
          includeInactive ? undefined : eq(staff.status, "active"),
          q
            ? or(
                ilike(staff.firstName, `%${q}%`),
                ilike(staff.middleName, `%${q}%`),
                ilike(staff.lastName, `%${q}%`),
                ilike(staff.employeeCode, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(staff.lastName), asc(staff.firstName));
  }

  /**
   * Reads one staff member. No active filter, unlike the list: a resigned
   * teacher must still resolve for the attendance, marks, and assignments
   * that reference her (hard rule 2 — the register is history, not a larder).
   */
  async getStaffById(scope: DataScope, staffId: string) {
    const [row] = await db
      .select()
      .from(staff)
      .where(
        and(
          eq(staff.id, staffId),
          scopeWhere(scope, STAFF_SCOPE_COLUMNS),
        ),
      );

    return row ?? null;
  }

  /**
   * Demographics, contact, and posting details are correctable; identity is
   * not (the contract omits the employee code, the status, and the login
   * link — see its docstring).
   */
  async updateStaff(scope: DataScope, staffId: string, input: UpdateStaffInput) {
    const [row] = await db
      .update(staff)
      .set(input)
      .where(
        and(
          eq(staff.id, staffId),
          scopeWhere(scope, STAFF_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return row ?? null;
  }

  /**
   * The register's soft delete (hard rule 2): the employment status records
   * WHY it ended, and every attendance row, mark, and role assignment keeps
   * pointing at her. A departure stamps `dateOfLeaving`; a suspension does
   * not — she is expected back.
   */
  async deactivateStaff(
    scope: DataScope,
    staffId: string,
    input: DeactivateStaffInput,
  ) {
    const leaving = input.status !== "suspended";
    const [row] = await db
      .update(staff)
      .set({
        status: input.status,
        dateOfLeaving: leaving ? new Date().toISOString().slice(0, 10) : null,
      })
      .where(
        and(
          eq(staff.id, staffId),
          scopeWhere(scope, STAFF_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return row ?? null;
  }

  /**
   * The owning branch of a staff member — the B6 resolution layer's
   * adapter. Authorization-neutral by design: this answers "who owns it",
   * never "may you see it".
   */
  async getStaffOwnerId(
    organizationId: string,
    staffId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: staff.schoolId })
      .from(staff)
      .where(
        and(
          eq(staff.id, staffId),
          eq(staff.organizationId, organizationId),
        ),
      );

    return row?.schoolId ?? null;
  }

  /**
   * ADR-035: FIRST credential for a staff login. The admin sets an initial
   * password and hands it over; `must_change_password` forces the flip at
   * first sign-in, so the hand-off ends with exactly one person knowing the
   * secret. The username is `{org_slug}-{employee_code}` — unique across
   * orgs the way the portal's `{org_slug}-{phone}` is.
   */
  async createLogin(
    scope: DataScope,
    actorUserId: string,
    staffId: string,
    password: string,
  ) {
    const row = await this.getStaffById(scope, staffId);
    if (!row) return null;

    if (row.userId) {
      throw new Error(
        "This staff member already has a login. Reset the password instead.",
      );
    }
    if (row.status !== "active") {
      throw new Error(
        "Logins are provisioned for active staff only — reactivate the record first.",
      );
    }

    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId));
    if (!org) return null;

    const username = `${org.slug}-${row.employeeCode}`.toLowerCase();
    if (!USERNAME_RE.test(username)) {
      throw new Error(
        `The employee code "${row.employeeCode}" contains characters a login cannot use — letters, digits, dots, hyphens, and underscores only.`,
      );
    }

    // Plain read, the sanctioned pre-check: a worded conflict instead of a
    // raw constraint failure (the same exception portal activation uses).
    const [taken] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, username));
    if (taken) {
      throw new Error(
        `The login name "${username}" is already taken — check the employee code.`,
      );
    }

    const [created] = await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: fullName(row),
        email: row.email ?? null,
        username,
        displayUsername: username,
        mustChangePassword: true,
      })
      .returning({ id: user.id });
    if (!created) throw new Error("Failed to create the staff login.");

    await setUserPassword(created.id, password);

    const [updated] = await db
      .update(staff)
      .set({ userId: created.id })
      .where(eq(staff.id, staffId))
      .returning();

    await db.insert(authzAuditLog).values({
      organizationId: scope.organizationId,
      action: "staff_login_created",
      actorUserId,
      targetUserId: created.id,
      scopeId: staffId,
      permission: "staff:update",
      details: { staffId, username },
    });

    return updated ?? null;
  }

  /**
   * ADR-035: re-issue a forgotten password. The flag returns (the handed
   * password is again a shared secret until the first change), and every
   * live session dies — nobody stays signed in on a credential they no
   * longer know.
   */
  async resetLogin(
    scope: DataScope,
    actorUserId: string,
    staffId: string,
    password: string,
  ) {
    const row = await this.getStaffById(scope, staffId);
    if (!row) return null;

    if (!row.userId) {
      throw new Error(
        "This staff member has no login to reset. Create one first.",
      );
    }

    await setUserPassword(row.userId, password);
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, row.userId));
    await revokeUserSessions(row.userId);

    await db.insert(authzAuditLog).values({
      organizationId: scope.organizationId,
      action: "staff_password_reset",
      actorUserId,
      targetUserId: row.userId,
      scopeId: staffId,
      permission: "staff:update",
      details: { staffId },
    });

    return row;
  }
}

export const staffService = new StaffService();
