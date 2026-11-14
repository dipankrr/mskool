import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { invalidateUserAuthCache } from "@repo/authz";
import { revokeUserSessions, setUserPassword } from "@repo/auth/credentials";
import { db } from "@repo/db";
import {
  account,
  authzAuditLog,
  organizations,
  roleAssignments,
  staff,
  staffJoinCodes,
  user,
} from "@repo/db/schema";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";

import { assignmentAccessService } from "./assignment-access.service";
import { normalizePhone } from "./phone";
import { ServiceRefusal } from "./service-error";

/**
 * STAFF SIGN-IN (ADR-068) — phone + password, first set with a joining code.
 *
 * - A staff login's username is `staff.` + the 10 phone digits. Families keep
 *   the bare digits (ADR-037), so one phone can have a staff login and a
 *   family login side by side, each with its own password.
 * - The office **invites**: a 6-digit code, only its hash stored, valid 7 days,
 *   works once, dead after 5 wrong tries, revoked by the next invite.
 * - The staff member **joins** with phone + code + a password they choose.
 *   The same path re-sets a forgotten password: the office sends a new code.
 * - **Leaving** switches the login off and frees the number: the username
 *   becomes `left.<staffId>`, sessions and role grants go. The user row stays
 *   so past work keeps its author (hard rule 2).
 * - A staff login belongs to one organisation. A number that is current staff
 *   somewhere else is refused, with no override.
 *
 * Hard rule 9: passwords and sessions go through @repo/auth's credential seam.
 */

export const STAFF_USERNAME_PREFIX = "staff.";
export const JOIN_CODE_DAYS = 7;
export const JOIN_CODE_MAX_TRIES = 5;

const CURRENT_STATUSES = ["active", "on_leave", "suspended"] as const;

/** One sentence for every failed join, so no reply says which part missed. */
export const JOIN_MISMATCH =
  "That code doesn't match this phone number, or it has expired. Ask your school office for a new code.";

export const ELSEWHERE_REFUSAL =
  "This number is already used by staff at another school. Ask the person to have their previous school mark them as left.";

export function staffUsername(digits: string): string {
  return `${STAFF_USERNAME_PREFIX}${digits}`;
}

function hashCode(staffId: string, code: string): string {
  return createHash("sha256").update(`${staffId}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  return Boolean(row);
}

export class StaffLoginService {
  /**
   * The phone's owner if it is current staff in ANOTHER organisation, else
   * null. Used to refuse adding, editing or inviting with that number.
   */
  async currentElsewhere(organizationId: string, digits: string): Promise<boolean> {
    const [row] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.phone, digits),
          ne(staff.organizationId, organizationId),
          inArray(staff.status, [...CURRENT_STATUSES]),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /**
   * What the phone field says while the office types (frame 06): free, used
   * by someone here (named, so the office can spot a duplicate), or used
   * elsewhere (never which school).
   */
  async checkPhone(
    organizationId: string,
    rawPhone: string,
    exceptStaffId?: string,
  ): Promise<{ state: "invalid" | "free" | "here" | "elsewhere"; name: string | null }> {
    const digits = normalizePhone(rawPhone);
    if (!digits) return { state: "invalid", name: null };
    const [here] = await db
      .select({ id: staff.id, firstName: staff.firstName, lastName: staff.lastName })
      .from(staff)
      .where(
        and(
          eq(staff.organizationId, organizationId),
          eq(staff.phone, digits),
          inArray(staff.status, [...CURRENT_STATUSES]),
          exceptStaffId ? ne(staff.id, exceptStaffId) : undefined,
        ),
      )
      .limit(1);
    if (here) return { state: "here", name: `${here.firstName} ${here.lastName}`.trim() };
    if (await this.currentElsewhere(organizationId, digits)) {
      return { state: "elsewhere", name: null };
    }
    return { state: "free", name: null };
  }

  /**
   * Normalises a phone for the staff record and refuses one that cannot be
   * used: not 10 digits, another current staff member here, or current staff
   * elsewhere. Returns the 10 digits.
   */
  async requireUsablePhone(
    organizationId: string,
    rawPhone: string,
    exceptStaffId?: string,
  ): Promise<string> {
    const check = await this.checkPhone(organizationId, rawPhone, exceptStaffId);
    if (check.state === "invalid") {
      throw new ServiceRefusal("BAD_REQUEST", "A phone number is 10 digits.");
    }
    if (check.state === "here") {
      throw new ServiceRefusal("CONFLICT", `${check.name} already has this number.`);
    }
    if (check.state === "elsewhere") {
      throw new ServiceRefusal("CONFLICT", ELSEWHERE_REFUSAL);
    }
    return normalizePhone(rawPhone)!;
  }

  /**
   * Issues a joining code for a staff member the caller may edit. Revokes any
   * open code first. Returns the code in plain text exactly once.
   */
  async invite(organizationId: string, staffId: string, actorUserId: string) {
    const [row] = await db
      .select({
        id: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
        phone: staff.phone,
        status: staff.status,
        userId: staff.userId,
        orgName: organizations.name,
      })
      .from(staff)
      .innerJoin(organizations, eq(staff.organizationId, organizations.id))
      .where(and(eq(staff.id, staffId), eq(staff.organizationId, organizationId)));
    if (!row) throw new ServiceRefusal("NOT_FOUND", "Staff member not found.");
    if (row.status !== "active") {
      throw new ServiceRefusal(
        "BAD_REQUEST",
        "Only current staff can be invited. Bring them back first.",
      );
    }
    const digits = row.phone ? normalizePhone(row.phone) : null;
    if (!digits) {
      throw new ServiceRefusal("BAD_REQUEST", "Add their 10-digit phone number first.");
    }
    if (await this.currentElsewhere(organizationId, digits)) {
      throw new ServiceRefusal("CONFLICT", ELSEWHERE_REFUSAL);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + JOIN_CODE_DAYS * 24 * 60 * 60 * 1000);
    const joined = row.userId ? await hasPassword(row.userId) : false;

    await db.transaction(async (tx) => {
      await tx
        .update(staffJoinCodes)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(staffJoinCodes.staffId, staffId),
            isNull(staffJoinCodes.usedAt),
            isNull(staffJoinCodes.revokedAt),
          ),
        );
      await tx.insert(staffJoinCodes).values({
        organizationId,
        staffId,
        codeHash: hashCode(staffId, code),
        expiresAt,
        createdBy: actorUserId,
      });
      await tx.insert(authzAuditLog).values({
        organizationId,
        action: "staff_invited",
        actorUserId,
        targetUserId: row.userId,
        scopeId: staffId,
        permission: "staff:update",
        details: { staffId, resetsPassword: joined },
      });
    });

    return {
      code,
      expiresAt: expiresAt.toISOString(),
      phone: digits,
      firstName: row.firstName,
      lastName: row.lastName,
      organizationName: row.orgName,
      /** True when this code re-sets the password of someone who has joined. */
      resetsPassword: joined,
    };
  }

  /**
   * Which second step sign-in shows (frame 01): `password` for a phone with a
   * staff login and a password, `code` for everything else, unknown numbers
   * included, so the only thing the answer reveals is "has joined".
   */
  async accountState(rawPhone: string): Promise<"password" | "code"> {
    const digits = normalizePhone(rawPhone);
    if (!digits) return "code";
    const [login] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.username, staffUsername(digits)))
      .limit(1);
    if (!login) return "code";
    return (await hasPassword(login.id)) ? "password" : "code";
  }

  /**
   * Phone + code + new password. Creates the staff login on first join, or
   * re-sets the password (and signs out every device) when they had one.
   * Every failure is the same sentence. Returns the staff id joined.
   */
  async join(input: { phone: string; code: string; password: string }): Promise<{
    staffId: string;
    userId: string;
    firstJoin: boolean;
  }> {
    const digits = normalizePhone(input.phone);
    const code = input.code.replace(/\D/g, "");
    if (!digits || code.length !== 6) throw new Error(JOIN_MISMATCH);

    const now = new Date();
    const open = await db
      .select({
        codeId: staffJoinCodes.id,
        codeHash: staffJoinCodes.codeHash,
        failedAttempts: staffJoinCodes.failedAttempts,
        staffId: staff.id,
        organizationId: staff.organizationId,
        userId: staff.userId,
        firstName: staff.firstName,
        lastName: staff.lastName,
      })
      .from(staffJoinCodes)
      .innerJoin(staff, eq(staffJoinCodes.staffId, staff.id))
      .where(
        and(
          eq(staff.phone, digits),
          eq(staff.status, "active"),
          isNull(staffJoinCodes.usedAt),
          isNull(staffJoinCodes.revokedAt),
          gt(staffJoinCodes.expiresAt, now),
        ),
      );

    const usable = open.filter((row) => row.failedAttempts < JOIN_CODE_MAX_TRIES);
    const match = usable.find((row) => sameHash(row.codeHash, hashCode(row.staffId, code)));
    if (!match) {
      if (usable.length > 0) {
        await db
          .update(staffJoinCodes)
          .set({ failedAttempts: sql`${staffJoinCodes.failedAttempts} + 1` })
          .where(inArray(staffJoinCodes.id, usable.map((row) => row.codeId)));
      }
      throw new Error(JOIN_MISMATCH);
    }

    const username = staffUsername(digits);
    const name = `${match.firstName} ${match.lastName}`.trim();
    let userId = match.userId;
    let firstJoin = false;

    if (!userId) {
      // A leftover login under this username with no staff record pointing
      // at it is the footprint of a crashed join: reuse it. One that a staff
      // record still owns would mean two current records share the phone,
      // which the index forbids, so it is refused as a mismatch.
      const [existing] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, username))
        .limit(1);
      if (existing) {
        const [owner] = await db
          .select({ id: staff.id })
          .from(staff)
          .where(eq(staff.userId, existing.id))
          .limit(1);
        if (owner) throw new Error(JOIN_MISMATCH);
        userId = existing.id;
      } else {
        const [created] = await db
          .insert(user)
          .values({
            id: crypto.randomUUID(),
            name,
            email: null,
            username,
            displayUsername: digits,
            mustChangePassword: false,
          })
          .returning({ id: user.id });
        if (!created) throw new Error("Failed to create the staff login.");
        userId = created.id;
      }
      firstJoin = true;
    } else {
      // Rejoining after leaving, or a changed phone: point the username back.
      await db
        .update(user)
        .set({ username, displayUsername: digits, mustChangePassword: false })
        .where(eq(user.id, userId));
      firstJoin = !(await hasPassword(userId));
    }

    await setUserPassword(userId, input.password);
    if (!firstJoin) await revokeUserSessions(userId);

    await db.transaction(async (tx) => {
      await tx
        .update(staffJoinCodes)
        .set({ usedAt: now })
        .where(eq(staffJoinCodes.id, match.codeId));
      await tx
        .update(staff)
        .set({ userId })
        .where(eq(staff.id, match.staffId));
      await tx.insert(authzAuditLog).values({
        organizationId: match.organizationId,
        action: firstJoin ? "staff_joined" : "staff_password_reset",
        actorUserId: userId,
        targetUserId: userId,
        scopeId: match.staffId,
        permission: "staff:update",
        details: { staffId: match.staffId, viaCode: true },
      });
    });

    // ADR-068: whatever the office assigned before they joined becomes their
    // access now.
    await assignmentAccessService.syncStaff(match.organizationId, match.staffId, userId);

    return { staffId: match.staffId, userId: userId!, firstJoin };
  }

  /**
   * Switches off a leaver's login and frees their number: the username goes
   * to `left.<staffId>`, sessions end, open codes and role grants are
   * revoked. Idempotent. Called by the staff service when someone leaves.
   */
  async switchOff(organizationId: string, staffId: string, actorUserId: string): Promise<void> {
    const [row] = await db
      .select({ userId: staff.userId })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.organizationId, organizationId)));
    if (!row) return;

    const now = new Date();
    await db
      .update(staffJoinCodes)
      .set({ revokedAt: now })
      .where(
        and(
          eq(staffJoinCodes.staffId, staffId),
          isNull(staffJoinCodes.usedAt),
          isNull(staffJoinCodes.revokedAt),
        ),
      );
    if (!row.userId) return;

    const userId = row.userId;
    await db
      .update(user)
      .set({ username: `left.${staffId}`, displayUsername: null })
      .where(eq(user.id, userId));
    await db
      .update(roleAssignments)
      .set({ revokedAt: now, revokedBy: actorUserId })
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.organizationId, organizationId),
          isNull(roleAssignments.revokedAt),
        ),
      );
    await revokeUserSessions(userId);
    await invalidateUserAuthCache(userId);
    await db.insert(authzAuditLog).values({
      organizationId,
      action: "staff_left",
      actorUserId,
      targetUserId: userId,
      scopeId: staffId,
      permission: "staff:delete",
      details: { staffId },
    });
  }
}

export const staffLoginService = new StaffLoginService();
