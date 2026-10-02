import { db } from "@repo/db";
import {
  authzAuditLog,
  staff,
  studentPortalAccess,
  students,
  user,
} from "@repo/db/schema";
import { revokeUserSessions } from "@repo/auth/credentials";
import { and, eq, isNull, like } from "drizzle-orm";

/**
 * ADR-037 MIGRATION — legacy `slug-phone` family usernames → plain digits.
 *
 * Password-preserving: the `user` row (and its credential hash) never
 * moves, only `username` is stripped, so nobody re-claims. Sessions are
 * revoked once per touched login (fresh sign-in, same password).
 *
 * Candidate: username matching `*-<10 digits>`, WITH portal-access rows,
 * and NOT referenced by any staff record (staff `slug-code` usernames are
 * a different namespace and stay exactly as they are).
 *
 * Merge rule per digit-group: earliest-created user survives; every other
 * row's access links move across (pairwise duplicates skipped, guardianId
 * backfilled where the survivor never named one); the emptied user is
 * deleted. Every strip and every move writes an audit row under the link's
 * own org — actor null (system migration, see the details).
 *
 * Usage: `pnpm --filter @repo/api migrate:usernames` dry-runs (prints,
 * writes nothing). Append `--execute` to write. Dev DB only until a
 * staging dump has survived the dry run.
 */
const EXECUTE = process.argv.includes("--execute");

async function main(): Promise<void> {
  const candidates = await db
    .select({ id: user.id, username: user.username, createdAt: user.createdAt })
    .from(user)
    .where(like(user.username, "%-__________"));

  const family = [];
  for (const row of candidates) {
    if (!row.username || !/-\d{10}$/.test(row.username)) continue;
    const [staffRow] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.userId, row.id))
      .limit(1);
    if (staffRow) continue;
    const links = await db
      .select({ id: studentPortalAccess.id })
      .from(studentPortalAccess)
      .where(eq(studentPortalAccess.userId, row.id))
      .limit(1);
    if (links.length === 0) continue;
    family.push(row);
  }

  const groups = new Map<string, typeof family>();
  for (const row of family) {
    const digits = row.username!.slice(-10);
    const list = groups.get(digits) ?? [];
    list.push(row);
    groups.set(digits, list);
  }

  let strips = 0;
  let merges = 0;
  let sessionsRevoked = 0;
  for (const [digits, rows] of groups) {
    const ordered = [...rows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1),
    );
    const survivor = ordered[0]!;
    for (const mover of ordered.slice(1)) {
      merges++;
      const moverLinks = await db
        .select()
        .from(studentPortalAccess)
        .where(eq(studentPortalAccess.userId, mover.id));
      for (const link of moverLinks) {
        const [student] = await db
          .select({ organizationId: students.organizationId })
          .from(students)
          .where(eq(students.id, link.studentId))
          .limit(1);
        if (EXECUTE) {
          const [existing] = await db
            .select()
            .from(studentPortalAccess)
            .where(
              and(
                eq(studentPortalAccess.userId, survivor.id),
                eq(studentPortalAccess.studentId, link.studentId),
              ),
            )
            .limit(1);
          if (existing) {
            if (!existing.guardianId && link.guardianId) {
              await db
                .update(studentPortalAccess)
                .set({ guardianId: link.guardianId })
                .where(eq(studentPortalAccess.id, existing.id));
            }
            await db.delete(studentPortalAccess).where(eq(studentPortalAccess.id, link.id));
          } else {
            await db
              .update(studentPortalAccess)
              .set({ userId: survivor.id })
              .where(eq(studentPortalAccess.id, link.id));
          }
          if (student) {
            await db.insert(authzAuditLog).values({
              organizationId: student.organizationId,
              action: "portal_phone_changed",
              actorUserId: null,
              targetUserId: survivor.id,
              scopeId: link.studentId,
              permission: "portal_access:migrate",
              details: {
                migrated: true,
                fromUserId: mover.id,
                studentId: link.studentId,
              },
            });
          }
          await revokeUserSessions(mover.id);
        }
      }
      if (EXECUTE) {
        await db.delete(user).where(eq(user.id, mover.id));
      }
      console.log(`merge ${mover.username} -> ${survivor.username} (${moverLinks.length} links)`);
    }

    if (survivor.username !== digits) {
      strips++;
      const links = await db
        .select({ studentId: studentPortalAccess.studentId })
        .from(studentPortalAccess)
        .where(eq(studentPortalAccess.userId, survivor.id))
        .limit(1);
      const [student] = links.length > 0
        ? await db
            .select({ organizationId: students.organizationId })
            .from(students)
            .where(eq(students.id, links[0]!.studentId))
            .limit(1)
        : [undefined];
      if (EXECUTE) {
        await db.update(user).set({ username: digits, displayUsername: digits }).where(
          eq(user.id, survivor.id),
        );
        if (student) {
          await db.insert(authzAuditLog).values({
            organizationId: student.organizationId,
            action: "portal_phone_changed",
            actorUserId: null,
            targetUserId: survivor.id,
            scopeId: links[0]!.studentId,
            permission: "portal_access:migrate",
            details: { migrated: true, previousUsername: survivor.username, newUsername: digits },
          });
        }
        await revokeUserSessions(survivor.id);
        sessionsRevoked++;
      }
      console.log(`strip ${survivor.username} -> ${digits}`);
    }
  }

  // Survivors already digits-shaped need no strip: counted, untouched.
  const alreadyClean = family.length - strips - merges;
  console.log(
    `${EXECUTE ? "EXECUTED" : "DRY RUN"}: ${family.length} legacy users, ` +
      `${strips} strips, ${merges} merges, ${sessionsRevoked} session revocations, ` +
      `${alreadyClean} already clean`,
  );

  // The invariant the deletion commit asserts before removing the legacy
  // stack: no FAMILY-shaped username may remain (staff `slug-code` rows that
  // happen to end in digits are a different namespace and stay).
  const remaining = await db
    .select({ id: user.id, username: user.username })
    .from(user)
    .where(like(user.username, "%-__________"));
  let legacyFamily = 0;
  for (const row of remaining.filter(
    (entry) => entry.username && /-\d{10}$/.test(entry.username),
  )) {
    const [staffRow] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.userId, row.id))
      .limit(1);
    const links = await db
      .select({ id: studentPortalAccess.id })
      .from(studentPortalAccess)
      .where(eq(studentPortalAccess.userId, row.id))
      .limit(1);
    if (!staffRow && links.length > 0) {
      legacyFamily++;
      if (legacyFamily <= 20) console.log(`  left: ${row.username}`);
    }
  }
  console.log(`legacy family usernames remaining: ${legacyFamily}`);
}

main().then(() => process.exit(0));
