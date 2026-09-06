import { requireSchoolId } from "./academic.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import {
  getUserUsername,
  revokeUserSessions,
  setUserPassword,
  updateUserUsername,
} from "@repo/auth/credentials";
import { db } from "@repo/db";
import {
  authzAuditLog,
  organizations,
  studentPortalAccess,
  students,
  user,
} from "@repo/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PORTAL ACCESS — the family login's credential lifecycle (ADR-007 + ADR-008).
 *
 * A family signs in with a PHONE NUMBER (no email — that is the decision),
 * stored as the better-auth username `{org_slug}-{phone}` because a phone
 * alone is not unique across orgs. Staff-side lifecycle:
 *
 *   - **activate** — first credential for a student's family login: the
 *     staff member mints the username, sets the INITIAL password, and flags
 *     `must_change_password` so the first login forces a change.
 *   - **resetPassword** — re-issues a forgotten password: same flag, and
 *     every live session dies.
 *   - **changePhone** — THE RIDER: the phone IS the credential, so changing
 *     it is a credential change with its own permission, an audit row, and
 *     mandatory session revocation. Otherwise it is a quiet account-takeover
 *     path — a staff member changing the number, then signing in as the
 *     family, with nothing recording either.
 *
 * Hard rule 9: passwords, usernames, and sessions are better-auth's. This
 * service never touches the `account` or `session` tables and never hashes —
 * everything goes through @repo/auth's credential seam (better-auth's own
 * internal adapter). The one exception is the `user` table lookup by
 * username, which is a plain read for pre-checking uniqueness with a worded
 * error instead of a raw constraint failure.
 *
 * Tenancy: `student_portal_access` is OWNERSHIP (ADR-008), not a scope node
 * — the branch question flows through the student row, which carries the
 * school. Every flow asserts that before anything credential-shaped runs.
 */

const ACCESS_SCOPE_COLUMNS = {
  organizationId: students.organizationId,
  schoolId: students.schoolId,
} as const;

/** The active access row for a student of THIS school — the tenancy gate.
 * A student may sit under several family logins (ADR-008): name the login,
 * or the flow refuses rather than guess which credential to move. */
function accessForStudent(scope: DataScope, studentId: string, userId?: string) {
  return db
    .select({ userId: studentPortalAccess.userId })
    .from(studentPortalAccess)
    .innerJoin(students, eq(studentPortalAccess.studentId, students.id))
    .where(
      and(
        eq(studentPortalAccess.studentId, studentId),
        eq(studentPortalAccess.isActive, true),
        userId ? eq(studentPortalAccess.userId, userId) : undefined,
        scopeWhere([scope], ACCESS_SCOPE_COLUMNS),
      ),
    );
}

async function requireSingleLogin(
  scope: DataScope,
  studentId: string,
  userId: string | undefined,
): Promise<{ userId: string } | null> {
  const rows = await accessForStudent(scope, studentId, userId);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(
      "This student has more than one active portal login — name the login to change.",
    );
  }
  return rows[0]!;
}

/** The stored username for a family login. Lowercase by plugin normalization. */
export function portalPhoneUsername(orgSlug: string, phone: string): string {
  return `${orgSlug}-${phone}`.toLowerCase();
}

export class PortalAccessService {
  /**
   * First credential for a student's family login. Reuses the family user
   * when the phone already belongs to one (a sibling sharing the login is
   * the ADR-008 model — one login, N students), otherwise creates it.
   */
  async activate(
    scope: DataScope,
    actorUserId: string,
    input: { studentId: string; phone: string; password: string },
  ) {
    const schoolId = requireSchoolId(scope);
    const [student] = await db
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
      })
      .from(students)
      .where(and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)));
    if (!student) return null;

    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId));
    if (!org) return null;

    const username = portalPhoneUsername(org.slug, input.phone);
    const [existingByUsername] = await db
      .select({ id: user.id, username: user.username })
      .from(user)
      .where(eq(user.username, username));

    let userId: string;
    if (existingByUsername) {
      // The family login already exists — this activation links another
      // child to it (or re-arms a stale row). A password is being (re)set,
      // so any live session dies.
      userId = existingByUsername.id;
    } else {
      // No email exists for a portal login (ADR-007: synthetic addresses
      // get mistaken for real ones) — the core User type still requires
      // the field, so the insert goes through with it explicitly null.
      // better-auth ids are text (hard rule 10's exception); a random
      // UUID string is exactly the shape it mints itself.
      const [created] = await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: [student.firstName, student.lastName].filter(Boolean).join(" "),
          email: null,
          username,
          displayUsername: username,
          mustChangePassword: true,
        })
        .returning({ id: user.id });
      if (!created) throw new Error("Failed to create the portal login.");
      userId = created.id;
    }

    await setUserPassword(userId, input.password);

    if (existingByUsername) {
      await db
        .update(user)
        .set({ mustChangePassword: true })
        .where(eq(user.id, userId));
      await revokeUserSessions(userId);
    }

    // Find-or-create the ownership row (ADR-008): one login → N students.
    const [access] = await db
      .insert(studentPortalAccess)
      .values({
        userId,
        studentId: input.studentId,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [studentPortalAccess.userId, studentPortalAccess.studentId],
        set: { isActive: true },
      })
      .returning();

    await db.insert(authzAuditLog).values({
      organizationId: scope.organizationId,
      action: "portal_activated",
      actorUserId,
      targetUserId: userId,
      scopeId: input.studentId,
      permission: "portal_access:activate",
      details: { studentId: input.studentId, username },
    });

    return access ?? null;
  }

  /**
   * Re-issue a forgotten password: the flag returns, every live session
   * dies. The staff member never sees the old one — nobody does.
   */
  async resetPassword(
    scope: DataScope,
    actorUserId: string,
    input: { studentId: string; userId?: string; password: string },
  ) {
    const access = await requireSingleLogin(scope, input.studentId, input.userId);
    if (!access) return null;

    await setUserPassword(access.userId, input.password);
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, access.userId));
    await revokeUserSessions(access.userId);

    await db.insert(authzAuditLog).values({
      organizationId: scope.organizationId,
      action: "portal_password_reset",
      actorUserId,
      targetUserId: access.userId,
      scopeId: input.studentId,
      permission: "portal_access:reset_password",
      details: { studentId: input.studentId },
    });

    return true;
  }

  /**
   * THE PHONE CHANGE (ADR-007's rider). The phone is the login credential,
   * so this is a credential change: the username moves, every live session
   * is revoked, and the audit row records who changed what and why. A
   * change without the revocation would leave the changer — or an attacker
   * who reached this endpoint — holding a live family session.
   */
  async changePhone(
    scope: DataScope,
    actorUserId: string,
    input: { studentId: string; userId?: string; newPhone: string; reason: string },
  ) {
    const access = await requireSingleLogin(scope, input.studentId, input.userId);
    if (!access) return null;

    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId));
    if (!org) return null;

    const previousUsername = await getUserUsername(access.userId);
    const newUsername = portalPhoneUsername(org.slug, input.newPhone);
    if (newUsername === previousUsername) {
      throw new Error("That is already this login's phone number.");
    }

    const [taken] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, newUsername));
    if (taken) {
      throw new Error("That phone number already belongs to another portal login.");
    }

    await updateUserUsername(access.userId, newUsername);
    await revokeUserSessions(access.userId);

    await db.insert(authzAuditLog).values({
      organizationId: scope.organizationId,
      action: "portal_phone_changed",
      actorUserId,
      targetUserId: access.userId,
      scopeId: input.studentId,
      permission: "portal_access:change_phone",
      details: {
        studentId: input.studentId,
        reason: input.reason,
        previousUsername: previousUsername ?? null,
        newUsername,
      },
    });

    return true;
  }
}

export const portalAccessService = new PortalAccessService();
