import { requireSchoolId } from "./academic.service";
import { escapeLike, scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import { revokeUserSessions, setUserPassword } from "@repo/auth/credentials";
import type {
  CreateStaffInput,
  DeactivateStaffInput,
  SetStaffLeaveInput,
  UpdateStaffInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  authzAuditLog,
  organizations,
  roleAssignments,
  schools,
  scopeNodes,
  staff,
  staffPendingRoles,
  user,
} from "@repo/db/schema";
import { and, asc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { invalidateUserAuthCache } from "@repo/authz";

import { assignmentAccessService } from "./assignment-access.service";
import { staffLoginService } from "./staff-login.service";

/** Starter designations offered before a school has any of its own (ADR-068). */
const STARTER_DESIGNATIONS = [
  "PRT",
  "TGT",
  "PGT",
  "Principal",
  "Vice Principal",
  "Coordinator",
  "Accountant",
  "Librarian",
  "Lab Assistant",
  "Office Staff",
];

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

/**
 * Today's calendar date in IST (UTC+5:30, no DST — the offset is constant).
 * `dateOfLeaving` is a calendar fact ("relieved 16 September"), not an
 * instant: stamping UTC slices the wrong day after 18:30 IST.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const todayIst = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

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
    // ADR-068: the phone is the sign-in, so it is required, 10 digits, and
    // not current staff anywhere else. The code is suggested when left out.
    const phone = await staffLoginService.requireUsablePhone(scope.organizationId, input.phone);
    const employeeCode =
      input.employeeCode?.trim() || (await this.nextEmployeeCode(scope.organizationId));

    const [row] = await db
      .insert(staff)
      .values({
        ...input,
        phone,
        employeeCode,
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
            ? (() => {
                // Escape wildcards first: q:"%" must match nothing, not the
                // whole register.
                const pattern = `%${escapeLike(q)}%`;
                return or(
                  ilike(staff.firstName, pattern),
                  ilike(staff.middleName, pattern),
                  ilike(staff.lastName, pattern),
                  ilike(staff.employeeCode, pattern),
                );
              })()
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
  async updateStaff(
    scope: DataScope,
    staffId: string,
    input: UpdateStaffInput,
    actorUserId?: string,
  ) {
    // An empty patch is a client bug, not a no-op: drizzle refuses .set({}).
    if (Object.keys(input).length === 0) {
      throw new Error("Nothing to update — send at least one field.");
    }
    const patch = { ...input };
    if (input.phone !== undefined) {
      if (!input.phone) {
        throw new Error("A staff member needs a phone number: it is how they sign in.");
      }
      patch.phone = await staffLoginService.requireUsablePhone(
        scope.organizationId,
        input.phone,
        staffId,
      );
    }
    const [row] = await db
      .update(staff)
      .set(patch)
      .where(
        and(
          eq(staff.id, staffId),
          scopeWhere(scope, STAFF_SCOPE_COLUMNS),
        ),
      )
      .returning();

    // A joined person's sign-in moves to the new number at once (same
    // password), so the record and the sign-in never disagree.
    if (row && patch.phone && actorUserId) {
      await staffLoginService.movePhone(scope.organizationId, staffId, patch.phone, actorUserId);
    }

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
    actorUserId: string,
  ) {
    const leaving = input.status !== "suspended";
    const [row] = await db
      .update(staff)
      .set({
        status: input.status,
        dateOfLeaving: leaving ? todayIst() : null,
        statusUntil: null,
        statusNote: input.note?.trim() || null,
      })
      .where(
        and(
          eq(staff.id, staffId),
          scopeWhere(scope, STAFF_SCOPE_COLUMNS),
        ),
      )
      .returning();

    // ADR-068: someone who leaves can no longer sign in, and their number is
    // free for whoever needs it next. A suspension switches the sign-in off
    // but keeps their classes and roles for when it is lifted.
    if (row && leaving) {
      // Their classes end today (gaps show for the office to fill), then the
      // login goes and every grant with it.
      await assignmentAccessService.endAllForStaff(scope.organizationId, staffId);
      await staffLoginService.switchOff(scope.organizationId, staffId, actorUserId);
      await db
        .update(staffPendingRoles)
        .set({ cancelledAt: new Date(), cancelledBy: actorUserId })
        .where(
          and(
            eq(staffPendingRoles.staffId, staffId),
            isNull(staffPendingRoles.appliedAt),
            isNull(staffPendingRoles.cancelledAt),
          ),
        );
    } else if (row) {
      await staffLoginService.suspend(scope.organizationId, staffId, actorUserId);
    }

    return row ?? null;
  }

  /** The next free "EMP-###" code in the organisation (the add form's default). */
  async nextEmployeeCode(organizationId: string): Promise<string> {
    const [row] = await db
      .select({
        max: sql<number | null>`max(nullif(regexp_replace(${staff.employeeCode}, '[^0-9]', '', 'g'), '')::int)`,
      })
      .from(staff)
      .where(and(eq(staff.organizationId, organizationId), ilike(staff.employeeCode, "EMP-%")));
    const next = (row?.max ?? 0) + 1;
    return `EMP-${String(next).padStart(3, "0")}`;
  }

  /**
   * What the add form suggests (frame 06): designations this organisation
   * already uses, most used first, then the starter list; and the next code.
   */
  async formHints(organizationId: string) {
    const used = await db
      .select({ designation: staff.designation, n: sql<number>`count(*)::int` })
      .from(staff)
      .where(and(eq(staff.organizationId, organizationId), isNotNull(staff.designation)))
      .groupBy(staff.designation)
      .orderBy(sql`count(*) desc`)
      .limit(30);
    const seen = new Set<string>();
    const designations: string[] = [];
    for (const name of [...used.map((row) => row.designation ?? ""), ...STARTER_DESIGNATIONS]) {
      const clean = name.trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      designations.push(clean);
    }
    return { designations, nextEmployeeCode: await this.nextEmployeeCode(organizationId) };
  }

  /**
   * The way back from a deactivation (M7): suspension ends, a resignation
   * is withdrawn, a mistake is undone. The leaving date clears — an active
   * record with a leaving date is a contradiction. Role assignments and
   * sessions are deliberately NOT touched here (ADR-035 defers
   * deprovisioning automation): revoking roles and resetting the password
   * stay explicit acts, and the UI says so where the credential lives.
   */
  async reactivateStaff(scope: DataScope, staffId: string, actorUserId?: string) {
    const row = await this.getStaffById(scope, staffId);
    if (!row) return null;
    if (row.status === "active") {
      throw new Error("This staff record is already active.");
    }
    // Someone coming back after leaving needs their number free again: it
    // was released when they left and may belong to someone else now.
    if (row.status !== "suspended" && row.status !== "on_leave" && row.phone) {
      await staffLoginService.requireUsablePhone(scope.organizationId, row.phone, staffId);
    }
    const [updated] = await db
      .update(staff)
      .set({ status: "active", dateOfLeaving: null, statusUntil: null, statusNote: null })
      .where(eq(staff.id, staffId))
      .returning();

    if (updated && row.status === "suspended" && actorUserId) {
      await staffLoginService.reinstate(scope.organizationId, staffId, actorUserId);
    }

    return updated ?? null;
  }

  /**
   * On leave and back (staff roles, 2026-11-15). Leave keeps the sign-in,
   * classes and roles; the office covers the classes. Only someone working
   * or already on leave can be put on leave.
   */
  async setLeave(scope: DataScope, staffId: string, input: SetStaffLeaveInput) {
    const row = await this.getStaffById(scope, staffId);
    if (!row) return null;
    if (row.status !== "active" && row.status !== "on_leave") {
      throw new Error(
        row.status === "suspended"
          ? "They are suspended. Lift the suspension first."
          : "They have left. Bring them back first.",
      );
    }
    const [updated] = await db
      .update(staff)
      .set(
        input.onLeave
          ? { status: "on_leave", statusUntil: input.until ?? null, statusNote: input.note?.trim() || null }
          : { status: "active", statusUntil: null, statusNote: null },
      )
      .where(eq(staff.id, staffId))
      .returning();
    return updated ?? null;
  }

  /**
   * Moves someone to another branch of the same organisation. Their classes
   * end at the old branch (gaps show there), and every grant tied to the old
   * branch ends: branch roles and the section grants under it. Org-wide
   * roles stay. Waiting roles for the old branch are cancelled. The record,
   * photo and sign-in move with them.
   */
  async moveStaff(
    organizationId: string,
    staffId: string,
    toSchoolId: string,
    actorUserId: string,
  ) {
    const [row] = await db
      .select({ id: staff.id, schoolId: staff.schoolId, userId: staff.userId, status: staff.status })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.organizationId, organizationId)));
    if (!row) return null;
    if (row.schoolId === toSchoolId) {
      throw new Error("They already work at this branch.");
    }
    if (row.status !== "active" && row.status !== "on_leave") {
      throw new Error("Only current staff can be moved.");
    }
    const [target] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(and(eq(schools.id, toSchoolId), eq(schools.organizationId, organizationId)));
    if (!target) throw new Error("That branch is not in this organisation.");

    await assignmentAccessService.endAllForStaff(organizationId, staffId);
    const now = new Date();
    if (row.userId) {
      // Every grant made below the org level, at or under the old branch.
      const nodes = await db
        .select({ id: scopeNodes.id })
        .from(scopeNodes)
        .where(
          and(
            eq(scopeNodes.organizationId, organizationId),
            or(eq(scopeNodes.id, row.schoolId), eq(scopeNodes.schoolId, row.schoolId)),
          ),
        );
      const ids = nodes.map((n) => n.id);
      if (ids.length > 0) {
        await db
          .update(roleAssignments)
          .set({ revokedAt: now, revokedBy: actorUserId })
          .where(
            and(
              eq(roleAssignments.userId, row.userId),
              eq(roleAssignments.organizationId, organizationId),
              ne(roleAssignments.scopeType, "org"),
              inArray(roleAssignments.scopeId, ids),
              isNull(roleAssignments.revokedAt),
            ),
          );
      }
      await invalidateUserAuthCache(row.userId);
    }
    await db
      .update(staffPendingRoles)
      .set({ cancelledAt: now, cancelledBy: actorUserId })
      .where(
        and(
          eq(staffPendingRoles.staffId, staffId),
          ne(staffPendingRoles.scopeType, "org"),
          isNull(staffPendingRoles.appliedAt),
          isNull(staffPendingRoles.cancelledAt),
        ),
      );
    const [updated] = await db
      .update(staff)
      .set({ schoolId: toSchoolId })
      .where(eq(staff.id, staffId))
      .returning();
    await db.insert(authzAuditLog).values({
      organizationId,
      action: "staff_moved",
      actorUserId,
      targetUserId: row.userId,
      scopeId: staffId,
      permission: "staff:update",
      details: { staffId, from: row.schoolId, to: toSchoolId },
    });
    return updated ?? null;
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

    // Staff sign in with email: provisioning without one mints a login that
    // can never be used (user.email=null matches no sign-in). Refuse with
    // the fix named instead of stranding the record.
    if (!row.email) {
      throw new Error(
        "Add an email address to this staff record first — staff sign in with email.",
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
    // With one escape hatch (M10): a name taken by a login NO staff record
    // points at is the footprint of a crashed provisioning — the user row
    // landed, the link never did. Adopt it (re-issuing the password being
    // handed over now, since the old secret is unknowable) instead of
    // stranding the record behind a name nobody owns.
    const [taken] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, username));
    let adopted = false;
    if (taken) {
      const [linked] = await db
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.userId, taken.id))
        .limit(1);
      if (linked) {
        throw new Error(
          `The login name "${username}" is already taken — check the employee code.`,
        );
      }
      adopted = true;
    }

    // Sequencing beats atomicity here: the password write goes through
    // better-auth's OWN connection, which cannot see this method's
    // uncommitted rows (the borrowed-connection rule the exam saves
    // document) — so the user row commits BEFORE setUserPassword runs, and
    // the link + audit commit together after. Every crash point stays
    // recoverable: before the link, a retry adopts (above); after it, the
    // record already says "reset instead", and resetLogin recovers.
    let userId = adopted ? taken!.id : null;
    if (!userId) {
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
      userId = created.id;
    }

    await setUserPassword(userId, password);

    return db.transaction(async (tx) => {
      // An adopted login is a fresh hand-off too: the forced change applies
      // exactly as on a new provision (otherwise the admin-known password
      // would stand without one).
      if (adopted) {
        await tx
          .update(user)
          .set({ mustChangePassword: true })
          .where(eq(user.id, userId));
      }

      const [updated] = await tx
        .update(staff)
        .set({ userId })
        .where(eq(staff.id, staffId))
        .returning();

      await tx.insert(authzAuditLog).values({
        organizationId: scope.organizationId,
        action: "staff_login_created",
        actorUserId,
        targetUserId: userId,
        scopeId: staffId,
        permission: "staff:update",
        // The flag rides only on adoptions: existing audit readers match
        // the plain { staffId, username } shape for normal provisions.
        details: adopted ? { staffId, username, adopted } : { staffId, username },
      });

      return updated ?? null;
    });
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
