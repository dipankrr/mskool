import { requireSchoolId } from "./academic.service";
import { portalAccessService } from "./portal-access.service";
import { scopeWhere, type DataScope, type ScopeColumns } from "@repo/authz";
import type {
  AddGuardianInput,
  DetachGuardianInput,
  GuardianView,
  UpdateGuardianInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  account,
  guardians,
  studentGuardians,
  studentPortalAccess,
  students,
  user,
} from "@repo/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

/**
 * GUARDIANS — the parents' contact truth, and the death of the typed-digits
 * box (ADR-037's follow-up).
 *
 * `guardians` rows are org-scoped contact records (ADR-006: no login);
 * `student_guardians` ties them to students. The family login FOLLOWS the
 * contact data automatically: saving a portal-enabled phone creates the
 * pending link (`portalAccessService.ensureLink` — one-way import, no
 * cycle), so staff never type digits into a credential UI again.
 *
 * Corrections move links, never rename credentials: a phone edit revokes
 * the old link and pends the new one; `canAccessPortal: false` (or a
 * detach) revokes that guardian's links for the student. The shared-number
 * household shares the login by construction — revoking checks no other
 * live relation rides the same digits first.
 */

const STUDENT_SCOPE_COLUMNS: ScopeColumns = {
  organizationId: students.organizationId,
  schoolId: students.schoolId,
} as const;

/** Calendar fact in IST (same reasoning as staff.service's copy). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const todayIst = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

type LiveRelation = {
  relationId: string;
  guardianId: string;
  phone: string;
};

export class GuardianService {
  /** Live (unended) guardian relations of one student, with phones. */
  private async liveRelations(studentId: string): Promise<LiveRelation[]> {
    const rows = await db
      .select({
        relationId: studentGuardians.id,
        guardianId: studentGuardians.guardianId,
        phone: guardians.phone,
      })
      .from(studentGuardians)
      .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
      .where(
        and(eq(studentGuardians.studentId, studentId), isNull(studentGuardians.endedOn)),
      );
    return rows;
  }

  /**
   * Revoke one login's links to one student, but only when no OTHER live
   * guardian relation still rides the same digits (shared household keeps
   * working; the audit names the guardian whose relation ended).
   */
  private async revokeUnlessShared(
    scope: DataScope,
    actorUserId: string,
    studentId: string,
    userId: string,
    keepDigits: string[],
  ) {
    const live = await this.liveRelations(studentId);
    const [login] = await db
      .select({ username: user.username })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (login?.username && keepDigits.includes(login.username)) return;
    const stillRides = live.some((row) => keepDigits.includes(row.phone));
    if (stillRides) return;
    await portalAccessService.revokeLink(scope, actorUserId, { studentId, userId });
  }

  /**
   * Adds a guardian to a student. Dedupes the contact by (org, phone):
   * the same digits are the same household, never a second guardian row.
   * A portal-enabled phone immediately gains the pending link.
   */
  async addGuardian(scope: DataScope, actorUserId: string, input: AddGuardianInput) {
    const schoolId = requireSchoolId(scope);
    const [student] = await db
      .select({ id: students.id, firstName: students.firstName, lastName: students.lastName })
      .from(students)
      .where(
        and(
          eq(students.id, input.studentId),
          eq(students.schoolId, schoolId),
          eq(students.status, "active"),
        ),
      );
    if (!student) return null;

    let [guardian] = await db
      .select()
      .from(guardians)
      .where(
        and(
          eq(guardians.organizationId, scope.organizationId),
          eq(guardians.phone, input.phone),
        ),
      )
      .limit(1);
    if (!guardian) {
      const [created] = await db
        .insert(guardians)
        .values({
          organizationId: scope.organizationId,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          phone: input.phone,
        })
        .returning();
      if (!created) throw new Error("Failed to save the guardian.");
      guardian = created;
    }

    const [existing] = await db
      .select()
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.studentId, input.studentId),
          eq(studentGuardians.guardianId, guardian.id),
        ),
      )
      .limit(1);
    if (existing && !existing.endedOn) {
      throw new Error("This guardian is already linked to this student.");
    }
    const portalOnReopen = input.canAccessPortal ?? true;
    if (existing) {
      // Re-link after a detach: reopen with the new terms rather than
      // stacking a second history row for the same pair.
      await db
        .update(studentGuardians)
        .set({
          endedOn: null,
          relation: input.relation,
          isPrimary: false,
          isEmergencyContact: input.isEmergencyContact ?? false,
          canAccessPortal: portalOnReopen,
        })
        .where(eq(studentGuardians.id, existing.id));
      if (input.isPrimary) {
        await db
          .update(studentGuardians)
          .set({ isPrimary: false })
          .where(eq(studentGuardians.studentId, input.studentId));
        await db
          .update(studentGuardians)
          .set({ isPrimary: true })
          .where(eq(studentGuardians.id, existing.id));
      }
      if (portalOnReopen) {
        await portalAccessService.ensureLink(scope, actorUserId, {
          studentId: input.studentId,
          phone: guardian.phone,
          guardianId: guardian.id,
        });
      }
      return this.viewFor(scope, input.studentId, guardian.id);
    }

    if (input.isPrimary) {
      await db
        .update(studentGuardians)
        .set({ isPrimary: false })
        .where(eq(studentGuardians.studentId, input.studentId));
    }

    // Contract defaults (canAccessPortal: true) apply at validation, not
    // here: direct callers (tests, REST) omit the field, and skipping the
    // link on `undefined` would silently strand the login. Default inside.
    const portalOn = input.canAccessPortal ?? true;

    await db.insert(studentGuardians).values({
      studentId: input.studentId,
      guardianId: guardian.id,
      relation: input.relation,
      isPrimary: input.isPrimary ?? false,
      isEmergencyContact: input.isEmergencyContact ?? false,
      canAccessPortal: portalOn,
    });

    if (portalOn) {
      await portalAccessService.ensureLink(scope, actorUserId, {
        studentId: input.studentId,
        phone: guardian.phone,
        guardianId: guardian.id,
      });
    }

    return this.viewFor(scope, input.studentId, guardian.id);
  }

  /**
   * Corrects contact truth. A phone change moves the login: the old link is
   * revoked (unless the household still rides those digits) and the new
   * digits gain a pending link. Switching portal access off revokes that
   * guardian's links for the student; switching it on re-pends them.
   */
  async updateGuardian(scope: DataScope, actorUserId: string, input: UpdateGuardianInput) {
    const schoolId = requireSchoolId(scope);
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)));
    if (!student) return null;

    const [relation] = await db
      .select()
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.studentId, input.studentId),
          eq(studentGuardians.guardianId, input.guardianId),
        ),
      )
      .limit(1);
    if (!relation) return null;

    const [guardian] = await db
      .select()
      .from(guardians)
      .where(
        and(
          eq(guardians.id, input.guardianId),
          eq(guardians.organizationId, scope.organizationId),
        ),
      )
      .limit(1);
    if (!guardian) return null;

    const oldPhone = guardian.phone;
    // Liveness BEFORE the contact edit: the shared-household check must see
    // who rode the OLD digits, not the already-corrected ones (reading after
    // the update would find the new digits "still riding" and wrongly spare
    // the stale link).
    const liveBefore = await this.liveRelations(input.studentId);
    const patch: Partial<typeof guardians.$inferInsert> = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (Object.keys(patch).length > 0) {
      await db.update(guardians).set(patch).where(eq(guardians.id, guardian.id));
    }

    const relationPatch: Partial<typeof studentGuardians.$inferInsert> = {};
    if (input.relation !== undefined) relationPatch.relation = input.relation;
    if (input.isEmergencyContact !== undefined) {
      relationPatch.isEmergencyContact = input.isEmergencyContact;
    }
    if (input.canAccessPortal !== undefined) {
      relationPatch.canAccessPortal = input.canAccessPortal;
    }
    if (input.isPrimary !== undefined) {
      if (input.isPrimary) {
        await db
          .update(studentGuardians)
          .set({ isPrimary: false })
          .where(eq(studentGuardians.studentId, input.studentId));
      }
      relationPatch.isPrimary = input.isPrimary;
    }
    if (Object.keys(relationPatch).length > 0) {
      await db
        .update(studentGuardians)
        .set(relationPatch)
        .where(eq(studentGuardians.id, relation.id));
    }

    const newPhone = input.phone ?? oldPhone;
    const portalOn = input.canAccessPortal ?? relation.canAccessPortal;

    if (newPhone !== oldPhone) {
      // The old login loses THIS student — unless ANOTHER guardian genuinely
      // shared the old digits (checked pre-edit). The new digits belong to a
      // different user entirely and can never protect the old login.
      const [oldLogin] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, oldPhone))
        .limit(1);
      if (oldLogin) {
        const sharedOld = liveBefore.some(
          (row) => row.guardianId !== guardian.id && row.phone === oldPhone,
        );
        if (!sharedOld) {
          await portalAccessService.revokeLink(scope, actorUserId, {
            studentId: input.studentId,
            userId: oldLogin.id,
            reason: "Guardian phone corrected.",
          });
        }
      }
      if (portalOn) {
        await portalAccessService.ensureLink(scope, actorUserId, {
          studentId: input.studentId,
          phone: newPhone,
          guardianId: guardian.id,
        });
      }
    } else if (input.canAccessPortal !== undefined) {
      const [login] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, newPhone))
        .limit(1);
      if (!portalOn && login) {
        await this.revokeUnlessShared(scope, actorUserId, input.studentId, login.id, []);
      } else if (portalOn) {
        await portalAccessService.ensureLink(scope, actorUserId, {
          studentId: input.studentId,
          phone: newPhone,
          guardianId: guardian.id,
        });
      }
    }

    return this.viewFor(scope, input.studentId, guardian.id);
  }

  /**
   * Closes a relation (custody change, correction): stamps `endedOn`,
   * switches portal access off, and revokes that guardian's links unless
   * the digits are still genuinely shared. History, never delete.
   */
  async detachGuardian(scope: DataScope, actorUserId: string, input: DetachGuardianInput) {
    const schoolId = requireSchoolId(scope);
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, input.studentId), eq(students.schoolId, schoolId)));
    if (!student) return null;

    const [relation] = await db
      .select()
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.studentId, input.studentId),
          eq(studentGuardians.guardianId, input.guardianId),
        ),
      )
      .limit(1);
    if (!relation) return null;

    const [guardian] = await db
      .select()
      .from(guardians)
      .where(eq(guardians.id, input.guardianId))
      .limit(1);

    await db
      .update(studentGuardians)
      .set({ endedOn: todayIst(), canAccessPortal: false })
      .where(eq(studentGuardians.id, relation.id));

    if (guardian) {
      const [login] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, guardian.phone))
        .limit(1);
      if (login) {
        // The closing guardian's own digits are no longer a keeper: any
        // OTHER live relation on the same digits still protects the login.
        const live = await this.liveRelations(input.studentId);
        const shared = live.some(
          (row) => row.guardianId !== input.guardianId && row.phone === guardian.phone,
        );
        if (!shared) {
          await portalAccessService.revokeLink(scope, actorUserId, {
            studentId: input.studentId,
            userId: login.id,
            reason: input.reason ?? "Guardian detached.",
          });
        }
      }
    }

    return this.viewFor(scope, input.studentId, input.guardianId);
  }

  /** One student's guardians with each login state inline (profile read). */
  async listForStudent(scope: DataScope, studentId: string): Promise<GuardianView[]> {
    const schoolId = requireSchoolId(scope);
    const [student] = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.id, studentId),
          eq(students.schoolId, schoolId),
          scopeWhere([scope], STUDENT_SCOPE_COLUMNS),
        ),
      );
    if (!student) return [];

    const rows = await db
      .select({
        guardian: guardians,
        relation: studentGuardians,
      })
      .from(studentGuardians)
      .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
      .where(eq(studentGuardians.studentId, studentId));

    const views: GuardianView[] = [];
    for (const row of rows) {
      views.push(await this.viewFor(scope, studentId, row.guardian.id));
    }
    views.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.firstName.localeCompare(b.firstName);
    });
    return views;
  }

  private async viewFor(
    scope: DataScope,
    studentId: string,
    guardianId: string,
  ): Promise<GuardianView | null> {
    const [row] = await db
      .select({
        guardian: guardians,
        relation: studentGuardians,
      })
      .from(studentGuardians)
      .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
      .where(
        and(
          eq(studentGuardians.studentId, studentId),
          eq(studentGuardians.guardianId, guardianId),
          eq(guardians.organizationId, scope.organizationId),
        ),
      )
      .limit(1);
    if (!row) return null;

    // A corrected phone leaves the old (revoked) row beside the new
    // pending one under the same guardianId: prefer live ranks — active,
    // then pending, then revoked history. (Postgres sorts nulls last, so
    // the nulls-first rank is spelled out, not assumed.)
    const [link] = await db
      .select({
        userId: studentPortalAccess.userId,
        username: user.username,
        isActive: studentPortalAccess.isActive,
      })
      .from(studentPortalAccess)
      .innerJoin(user, eq(studentPortalAccess.userId, user.id))
      .where(
        and(
          eq(studentPortalAccess.studentId, studentId),
          eq(studentPortalAccess.guardianId, guardianId),
        ),
      )
      .orderBy(
        desc(isNull(studentPortalAccess.revokedAt)),
        desc(studentPortalAccess.isActive),
      )
      .limit(1);

    let hasCredential = false;
    if (link) {
      const [cred] = await db
        .select({ id: account.id })
        .from(account)
        .where(
          and(eq(account.userId, link.userId), eq(account.providerId, "credential")),
        )
        .limit(1);
      hasCredential = Boolean(cred);
    }

    return {
      id: row.guardian.id,
      firstName: row.guardian.firstName,
      lastName: row.guardian.lastName,
      relation: row.relation.relation,
      phone: row.guardian.phone,
      isPrimary: row.relation.isPrimary,
      isEmergencyContact: row.relation.isEmergencyContact,
      canAccessPortal: row.relation.canAccessPortal,
      endedOn: row.relation.endedOn,
      portal: link
        ? {
            username: link.username ?? "",
            isActive: link.isActive,
            hasCredential,
          }
        : null,
    };
  }
}

export const guardianService = new GuardianService();
