import { getRedis } from "@repo/authz";
import { db } from "@repo/db";
import { storageObjects, type StorageVariant } from "@repo/db/schema";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getObjectStore, type Bucket } from "./storage/object-store";
import { objectPrefix, uploadKey } from "./storage/purposes";

/**
 * THE STORAGE SWEEPER (ADR-063) — removes files nothing uses any more.
 *
 * Bucket deletes can never be part of a database transaction, so the rest
 * of the system only MARKS files; this sweeper does the deleting. Each tick,
 * in batches:
 *   1. uploads handed out but never completed, after a day;
 *   2. processed files never attached to a record, after a day;
 *   3. files marked deleted (replaced, removed, refused).
 * Once a week it also lists the buckets and reports files no row knows about.
 *
 * Rows go first, each under its own savepoint, and the bytes only after the
 * commit. Every column that points at a file is a foreign key with
 * `restrict`, so a row a record still uses cannot be deleted: that refusal
 * means some flow marked a file in use, and the sweeper logs it and clears
 * the mark instead of retrying forever. A crash between commit and the bucket
 * call leaves bytes no row knows about, which the weekly report catches.
 *
 * Concurrency follows the homework sweeper: a best-effort Redis lease, and
 * every step safe to run twice (`DELETE … RETURNING` hands each row to one
 * caller; deleting a missing key succeeds). The database clock decides age.
 */

const SWEEP_LEASE_KEY = "lock:storage-sweep";
const SWEEP_LEASE_TTL_MS = 4 * 60_000;
const RECONCILE_KEY = "storage:reconcile:last";
const RECONCILE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export interface StorageSweepResult {
  abandonedUploads: number;
  unattachedFiles: number;
  deletedFiles: number;
  /** Files marked deleted that a record still uses: a bug somewhere. */
  stillInUse: string[];
  /** Present on the ticks that ran the weekly bucket check. */
  reconcile: { unknownFiles: number; unknownBytes: number } | null;
  summary: string;
}

type Doomed = {
  id: string;
  organizationId: string;
  purpose: (typeof storageObjects.$inferSelect)["purpose"];
  visibility: Bucket;
  variants: StorageVariant[];
};

const doomedColumns = {
  id: storageObjects.id,
  organizationId: storageObjects.organizationId,
  purpose: storageObjects.purpose,
  visibility: storageObjects.visibility,
  variants: storageObjects.variants,
};

export class StorageWorkerService {
  async runSweep(opts: { batch?: number; now?: Date } = {}): Promise<StorageSweepResult> {
    const batch = opts.batch ?? 200;
    const holder = `sweep-${randomUUID().slice(0, 8)}`;
    let leaseHeld = false;
    let redisAvailable = true;
    try {
      leaseHeld =
        (await getRedis().set(SWEEP_LEASE_KEY, holder, "PX", SWEEP_LEASE_TTL_MS, "NX")) === "OK";
    } catch {
      redisAvailable = false;
    }
    if (redisAvailable && !leaseHeld) {
      return {
        abandonedUploads: 0,
        unattachedFiles: 0,
        deletedFiles: 0,
        stillInUse: [],
        reconcile: null,
        summary: "skipped (another instance holds the sweep lease)",
      };
    }

    try {
      const abandoned = await this.sweepAbandonedUploads(batch);
      const unattached = await this.sweepRows(
        batch,
        and(
          eq(storageObjects.status, "ready"),
          isNull(storageObjects.attachedAt),
          lt(storageObjects.readyAt, sql`now() - interval '1 day'`),
        )!,
      );
      const deleted = await this.sweepRows(batch, eq(storageObjects.status, "deleted"));
      const reconcile = redisAvailable ? await this.maybeReconcile(opts.now ?? new Date()) : null;

      const stillInUse = [...unattached.stillInUse, ...deleted.stillInUse];
      const parts = [
        `${abandoned} abandoned upload(s)`,
        `${unattached.removed} unattached file(s)`,
        `${deleted.removed} deleted file(s)`,
      ];
      if (stillInUse.length) parts.push(`${stillInUse.length} still in use (unmarked)`);
      if (reconcile) parts.push(`weekly check: ${reconcile.unknownFiles} unknown file(s)`);
      return {
        abandonedUploads: abandoned,
        unattachedFiles: unattached.removed,
        deletedFiles: deleted.removed,
        stillInUse,
        reconcile,
        summary: parts.join(", "),
      };
    } finally {
      if (leaseHeld) {
        try {
          if ((await getRedis().get(SWEEP_LEASE_KEY)) === holder) {
            await getRedis().del(SWEEP_LEASE_KEY);
          }
        } catch {
          // The lease expires on its own.
        }
      }
    }
  }

  /** Step 1: uploads never completed. Nothing can point at a pending row. */
  private async sweepAbandonedUploads(batch: number): Promise<number> {
    const rows = await db
      .delete(storageObjects)
      .where(
        inArray(
          storageObjects.id,
          db
            .select({ id: storageObjects.id })
            .from(storageObjects)
            .where(
              and(
                eq(storageObjects.status, "pending"),
                lt(storageObjects.createdAt, sql`now() - interval '1 day'`),
              ),
            )
            .limit(batch),
        ),
      )
      .returning(doomedColumns);
    if (rows.length === 0) return 0;

    const store = getObjectStore();
    await store.delete(
      "private",
      rows.map((r) => uploadKey(r.id)),
    );
    // A crash inside `complete` can leave versions written for a row that
    // never became ready; they sit under the object's own prefix.
    for (const row of rows) {
      const listed = await store.list(row.visibility, {
        prefix: objectPrefix(row.organizationId, row.purpose, row.id),
      });
      if (listed.objects.length) {
        await store.delete(
          row.visibility,
          listed.objects.map((o) => o.key),
        );
      }
    }
    return rows.length;
  }

  /** Steps 2 and 3: rows first (foreign keys guard them), bytes after commit. */
  private async sweepRows(batch: number, where: ReturnType<typeof eq>) {
    const candidates = await db
      .select({ id: storageObjects.id })
      .from(storageObjects)
      .where(where)
      .limit(batch);

    const removed: Doomed[] = [];
    const stillInUse: string[] = [];
    if (candidates.length === 0) return { removed: 0, stillInUse };

    await db.transaction(async (tx) => {
      for (const { id } of candidates) {
        try {
          // A savepoint per row: one row a record still uses must not roll
          // back the others, or block the batch on every tick.
          await tx.transaction(async (sp) => {
            const [row] = await sp
              .delete(storageObjects)
              .where(and(eq(storageObjects.id, id), where))
              .returning(doomedColumns);
            if (row) removed.push(row);
          });
        } catch (error) {
          if (!isForeignKeyViolation(error)) throw error;
          stillInUse.push(id);
        }
      }
      if (stillInUse.length) {
        // A record points at it, so it is in use: clear the deleted mark.
        await tx
          .update(storageObjects)
          .set({
            status: "ready",
            deletedAt: null,
            attachedAt: sql`coalesce(${storageObjects.attachedAt}, now())`,
          })
          .where(inArray(storageObjects.id, stillInUse));
      }
    });

    for (const id of stillInUse) {
      console.warn(
        `[storage-sweep] ${id} was marked for deletion but a record still uses it; unmarked.`,
      );
    }

    const store = getObjectStore();
    for (const bucket of ["private", "public"] as const) {
      const keys = removed
        .filter((r) => r.visibility === bucket)
        .flatMap((r) => r.variants.map((v) => v.path));
      if (keys.length) await store.delete(bucket, keys);
    }
    // Refused uploads can still have their raw file in tmp/.
    if (removed.length)
      await store.delete(
        "private",
        removed.map((r) => uploadKey(r.id)),
      );

    return { removed: removed.length, stillInUse };
  }

  /** Weekly: list both buckets and count files no row knows about. Report only. */
  private async maybeReconcile(now: Date) {
    const redis = getRedis();
    const last = Number((await redis.get(RECONCILE_KEY)) ?? 0);
    if (now.getTime() - last < RECONCILE_EVERY_MS) return null;
    await redis.set(RECONCILE_KEY, String(now.getTime()));
    return this.reconcile(now);
  }

  async reconcile(now = new Date()) {
    const store = getObjectStore();
    const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
    let unknownFiles = 0;
    let unknownBytes = 0;

    for (const bucket of ["private", "public"] as const) {
      let cursor: string | undefined;
      do {
        const page = await store.list(bucket, { cursor });
        // Files younger than a day may belong to an upload in progress.
        const settled = page.objects.filter((o) => o.lastModified.getTime() < dayAgo);
        const idOf = (key: string) => {
          const parts = key.split("/");
          return parts[0] === "tmp" ? parts[1] : parts[2];
        };
        const ids = [...new Set(settled.map((o) => idOf(o.key)).filter(isUuid))];
        const known = new Set(
          ids.length
            ? (
                await db
                  .select({ id: storageObjects.id })
                  .from(storageObjects)
                  .where(inArray(storageObjects.id, ids))
              ).map((r) => r.id)
            : [],
        );
        for (const o of settled) {
          const id = idOf(o.key);
          if (!id || !known.has(id)) {
            unknownFiles++;
            unknownBytes += o.sizeBytes;
          }
        }
        cursor = page.cursor ?? undefined;
      } while (cursor);
    }

    if (unknownFiles) {
      console.warn(
        `[storage-sweep] weekly check: ${unknownFiles} file(s), ${unknownBytes} bytes in the buckets that no row knows about.`,
      );
    }
    return { unknownFiles, unknownBytes };
  }
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  );
}

/**
 * A delete a foreign key refused: 23001 from an `onDelete: restrict` key
 * (student photos, fee settings), 23503 from a default "no action" key (the
 * homework tables).
 */
function isForeignKeyViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: string }).code;
    if (code === "23001" || code === "23503") return true;
  }
  return false;
}

export const storageWorkerService = new StorageWorkerService();
