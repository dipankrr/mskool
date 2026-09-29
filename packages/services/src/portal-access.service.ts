import { requireSchoolId } from "./academic.service";
import {
  invalidateUserAuthCache,
  scopeWhere,
  type DataScope,
} from "@repo/authz";
import {
  getUserUsername,
  revokeUserSessions,
  setUserPassword,
  updateUserUsername,
} from "@repo/auth/credentials";
import { db } from "@repo/db";
import {
  account,
  authzAuditLog,
  organizations,
  studentGuardians,
  studentPortalAccess,
  students,
  user,
} from "@repo/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

/**
 * Digits only, last 10 (tolerates +91 / leading 0 / spaces / hyphens).
 * Returns null rather than throwing — the caller chooses the wording:
 * staff input gets the field error, the public claim gets the uniform
 * refusal (never say which field missed).
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const tail = digits.length > 10 ? digits.slice(-10) : digits;
  return /^\d{10}$/.test(tail) ? tail : null;
}

/**
 * The claim refusal, shared by every public trio check (ADR-037). One
 * message for unknown phone, no link, wrong admission number, wrong DOB,
 * inactive student — disambiguating any of them would let a caller probe
 * which half they got right.
 */
export const CLAIM_MISMATCH =
  "Those details do not match our records. Check the phone number, admission number, and date of birth.";

async function hasCredentialAccount(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  return Boolean(row);
}

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

  /**
   * GLOBAL PHONE IDENTITY (ADR-037) — staff links a guardian phone, no
   * secret. Creates the global `user(phone)` on first sight (locked: no
   * credential row) and a PENDING link (`isActive=false`, no `revokedAt`).
   * The parent activates it from home via `claim` / `verifyLink`.
   *
   * Active links are never downgraded: re-linking an active pair is a
   * no-op returning the row. Revoked links re-pend (history stays in the
   * audit trail). Siblings sharing digits share the user — second kid, same
   * phone, no new user, no password touch.
   */
  async ensureLink(
    scope: DataScope,
    actorUserId: string,
    input: { studentId: string; phone: string; guardianId?: string },
  ) {
    const digits = normalizePhone(input.phone);
    if (!digits) throw new Error("A phone number is 10 digits.");
    const schoolId = requireSchoolId(scope);

    const [student] = await db
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        status: students.status,
      })
      .from(students)
      .where(and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)));
    if (!student || student.status !== "active") return null;

    // The guardian gate (people.ts): the link must name a live
    // portal-enabled guardian relation when one is named at all.
    if (input.guardianId) {
      const [relation] = await db
        .select({
          canAccessPortal: studentGuardians.canAccessPortal,
          endedOn: studentGuardians.endedOn,
        })
        .from(studentGuardians)
        .where(
          and(
            eq(studentGuardians.studentId, input.studentId),
            eq(studentGuardians.guardianId, input.guardianId),
          ),
        )
        .limit(1);
      if (!relation) {
        throw new Error("That guardian is not linked to this student.");
      }
      if (!relation.canAccessPortal || relation.endedOn) {
        throw new Error("Portal access is switched off for this guardian.");
      }
    }

    let [login] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, digits))
      .limit(1);
    if (!login) {
      const [created] = await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: [student.firstName, student.lastName].filter(Boolean).join(" "),
          email: null,
          username: digits,
          displayUsername: digits,
          mustChangePassword: false,
        })
        .returning({ id: user.id });
      if (!created) throw new Error("Failed to create the family login.");
      login = created;
    }
    const userId = login.id;

    const [existing] = await db
      .select()
      .from(studentPortalAccess)
      .where(
        and(
          eq(studentPortalAccess.userId, userId),
          eq(studentPortalAccess.studentId, input.studentId),
        ),
      )
      .limit(1);
    if (existing) {
      // Active stays active; revoked re-pends; guardian backfills when the
      // row never named one. No secret is ever touched here.
      if (existing.isActive) return existing;
      const [reopened] = await db
        .update(studentPortalAccess)
        .set({
          isActive: false,
          revokedAt: null,
          guardianId: existing.guardianId ?? input.guardianId ?? null,
        })
        .where(eq(studentPortalAccess.id, existing.id))
        .returning();
      await db.insert(authzAuditLog).values({
        organizationId: scope.organizationId,
        action: "portal_activated",
        actorUserId,
        targetUserId: userId,
        scopeId: input.studentId,
        permission: "portal_access:activate",
        details: { studentId: input.studentId, username: digits, pending: true },
      });
      await invalidateUserAuthCache(userId);
      return reopened ?? null;
    }

    const [access] = await db
      .insert(studentPortalAccess)
      .values({
        userId,
        studentId: input.studentId,
        guardianId: input.guardianId ?? null,
        isActive: false,
      })
      .returning();

    await db.insert(authzAuditLog).values({
      organizationId: scope.organizationId,
      action: "portal_activated",
      actorUserId,
      targetUserId: userId,
      scopeId: input.studentId,
      permission: "portal_access:activate",
      details: { studentId: input.studentId, username: digits, pending: true },
    });
    await invalidateUserAuthCache(userId);

    return access ?? null;
  }

  /**
   * First claim AND forgot-reset, one shape (ADR-037). No credential yet →
   * sets the first password and activates the trio-matching pending links.
   * Credential exists → the same trio re-sets it (every session revoked).
   * Anything else → the uniform refusal. Cross-org by construction: the
   * trio is matched wherever the links point.
   */
  async claim(input: {
    phone: string;
    admissionNumber: string;
    dateOfBirth: string;
    password: string;
  }) {
    const digits = normalizePhone(input.phone);
    if (!digits) throw new Error(CLAIM_MISMATCH);

    const [login] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, digits))
      .limit(1);
    if (!login) throw new Error(CLAIM_MISMATCH);

    const candidates = await db
      .select({
        accessId: studentPortalAccess.id,
        isActive: studentPortalAccess.isActive,
        revokedAt: studentPortalAccess.revokedAt,
        organizationId: students.organizationId,
        studentId: students.id,
      })
      .from(studentPortalAccess)
      .innerJoin(students, eq(studentPortalAccess.studentId, students.id))
      .where(
        and(
          eq(studentPortalAccess.userId, login.id),
          eq(students.admissionNumber, input.admissionNumber),
          eq(students.dateOfBirth, input.dateOfBirth),
          eq(students.status, "active"),
        ),
      );
    // Revoked stays revoked: only pending-or-active links count, so a
    // custody-revoked row can never be re-armed by guessing the trio.
    const usable = candidates.filter((row) => !row.revokedAt);
    if (usable.length === 0) throw new Error(CLAIM_MISMATCH);

    const firstClaim = !(await hasCredentialAccount(login.id));
    await setUserPassword(login.id, input.password);

    const pendingIds = usable.filter((row) => !row.isActive).map((row) => row.accessId);
    if (pendingIds.length > 0) {
      await db
        .update(studentPortalAccess)
        .set({ isActive: true })
        .where(inArray(studentPortalAccess.id, pendingIds));
    }

    if (firstClaim) {
      await db.insert(authzAuditLog).values({
        organizationId: usable[0]!.organizationId,
        action: "portal_activated",
        actorUserId: login.id,
        targetUserId: login.id,
        scopeId: usable[0]!.studentId,
        permission: "portal_access:activate",
        details: {
          claimed: true,
          studentIds: usable.map((row) => row.studentId),
        },
      });
    } else {
      await db
        .update(user)
        .set({ mustChangePassword: false })
        .where(eq(user.id, login.id));
      await revokeUserSessions(login.id);
      await db.insert(authzAuditLog).values({
        organizationId: usable[0]!.organizationId,
        action: "portal_password_reset",
        actorUserId: login.id,
        targetUserId: login.id,
        scopeId: usable[0]!.studentId,
        permission: "portal_access:reset_password",
        details: { studentIds: usable.map((row) => row.studentId), viaClaim: true },
      });
    }
    await invalidateUserAuthCache(login.id);

    return {
      userId: login.id,
      activatedStudentIds: usable.map((row) => row.studentId),
    };
  }

  /**
   * Second-kid (and nth-kid) proof for a signed-in login (ADR-037). The
   * caller names a PENDING link of their own and that kid's pair — no
   * password change, ever. Nothing leaks: missing link and wrong pair are
   * the same uniform refusal.
   */
  async verifyLink(
    callerUserId: string,
    input: { studentId: string; admissionNumber: string; dateOfBirth: string },
  ) {
    const [match] = await db
      .select({
        accessId: studentPortalAccess.id,
        organizationId: students.organizationId,
      })
      .from(studentPortalAccess)
      .innerJoin(students, eq(studentPortalAccess.studentId, students.id))
      .where(
        and(
          eq(studentPortalAccess.userId, callerUserId),
          eq(studentPortalAccess.studentId, input.studentId),
          eq(studentPortalAccess.isActive, false),
          isNull(studentPortalAccess.revokedAt),
          eq(students.admissionNumber, input.admissionNumber),
          eq(students.dateOfBirth, input.dateOfBirth),
          eq(students.status, "active"),
        ),
      )
      .limit(1);
    if (!match) throw new Error(CLAIM_MISMATCH);

    await db
      .update(studentPortalAccess)
      .set({ isActive: true })
      .where(eq(studentPortalAccess.id, match.accessId));

    await db.insert(authzAuditLog).values({
      organizationId: match.organizationId,
      action: "portal_activated",
      actorUserId: callerUserId,
      targetUserId: callerUserId,
      scopeId: input.studentId,
      permission: "portal_access:activate",
      details: { studentId: input.studentId, verified: true },
    });
    await invalidateUserAuthCache(callerUserId);

    return true;
  }

  /**
   * Staff revokes one login's access to one student (custody, correction).
   * Flag + timestamp, never delete (hard rule 2). No dedicated audit action
   * exists without an enum migration, so this rides `role_revoked` with the
   * portal permission named — the details carry the reason.
   */
  async revokeLink(
    scope: DataScope,
    actorUserId: string,
    input: { studentId: string; userId: string; reason?: string },
  ) {
    const [row] = await db
      .select({ accessId: studentPortalAccess.id })
      .from(studentPortalAccess)
      .innerJoin(students, eq(studentPortalAccess.studentId, students.id))
      .where(
        and(
          eq(studentPortalAccess.userId, input.userId),
          eq(studentPortalAccess.studentId, input.studentId),
          scopeWhere([scope], ACCESS_SCOPE_COLUMNS),
        ),
      )
      .limit(1);
    if (!row) return null;

    await db
      .update(studentPortalAccess)
      .set({ isActive: false, revokedAt: new Date() })
      .where(eq(studentPortalAccess.id, row.accessId));

    await db.insert(authzAuditLog).values({
      organizationId: scope.organizationId,
      action: "role_revoked",
      actorUserId,
      targetUserId: input.userId,
      scopeId: input.studentId,
      permission: "portal_access:revoke",
      details: { studentId: input.studentId, reason: input.reason ?? null },
    });
    await invalidateUserAuthCache(input.userId);

    return true;
  }

  /** One student's link rows with the login identifier staff must see. */
  async linkStatus(scope: DataScope, studentId: string) {
    const rows = await db
      .select({
        userId: studentPortalAccess.userId,
        username: user.username,
        guardianId: studentPortalAccess.guardianId,
        isActive: studentPortalAccess.isActive,
        revokedAt: studentPortalAccess.revokedAt,
      })
      .from(studentPortalAccess)
      .innerJoin(students, eq(studentPortalAccess.studentId, students.id))
      .innerJoin(user, eq(studentPortalAccess.userId, user.id))
      .where(
        and(
          eq(studentPortalAccess.studentId, studentId),
          scopeWhere([scope], ACCESS_SCOPE_COLUMNS),
        ),
      );
    const userIds = rows.map((row) => row.userId);
    const credentialed = new Set(
      userIds.length === 0
        ? []
        : await db
            .select({ userId: account.userId })
            .from(account)
            .where(
              and(
                inArray(account.userId, userIds),
                eq(account.providerId, "credential"),
              ),
            )
            .then((found) => found.map((entry) => entry.userId)),
    );
    return rows.map((row) => ({
      userId: row.userId,
      username: row.username ?? "",
      guardianId: row.guardianId,
      isActive: row.isActive,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      hasCredential: credentialed.has(row.userId),
    }));
  }
}

export const portalAccessService = new PortalAccessService();
