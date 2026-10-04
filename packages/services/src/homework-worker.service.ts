import { db } from "@repo/db";
import { assignments, studentAssignments } from "@repo/db/schema";
import { getRedis } from "@repo/authz";
import { and, eq, lte, sql } from "drizzle-orm";
import { homeworkService } from "./homework.service";
import { randomUUID } from "node:crypto";

/**
 * THE HOMEWORK SWEEPER (ADR-040) — the time-driven half of ADR-039.
 *
 * Three time-driven state changes no HTTP request exists to perform:
 *   1. SCHEDULED → PUBLISHED when publish_at arrives (runs the SAME
 *      publishAssignment service the teacher's button runs — resolution,
 *      caps, student_assignments — so "publish at 8am" and "publish now"
 *      are provably one behavior).
 *   2. ASSIGNED / IN_PROGRESS → MISSING once effective_close_at has passed
 *      on a PUBLISHED or CLOSED assignment. Cancelled assignments are
 *      deliberately excluded (a cancelled homework is not missed work), as
 *      are backfilled/view-only rows (is_backfilled — they were never
 *      submittable). The states are the mutex: a row excused, graded, or
 *      resubmit-requested by a human no longer matches the WHERE, so the
 *      sweep can never overwrite a human decision; an extension granted in
 *      the same instant moves effective_close_at past the sweep's clock and
 *      grantExtension revives a just-missed row anyway.
 *
 * The clock is the DATABASE's now(), never the app's — the deadline columns
 * were written by the database, and N app instances with skewed clocks must
 * not disagree about "past due".
 *
 * Concurrency: the sweeper is called by every API instance's tick loop, and
 * mutual exclusion is a REDIS LEASE (SET key NX with a TTL), not a Postgres
 * advisory lock — this deployment's Postgres sits behind a transaction-
 * pooling proxy, where session state (including advisory locks and backend
 * pids) is not per-client. The lease is BEST-EFFORT by design: the sweep
 * itself is idempotent and safe to run twice (set-based WHERE clauses), so a
 * Redis outage degrades to "two instances may do the same harmless UPDATE",
 * never to incorrect data. A losing instance skips and tries next tick.
 *
 * Idempotency is the core property: every transition is a set-based
 * UPDATE ... WHERE state-and-time clause. Running twice does nothing the
 * second time. Running during downtime is fine — the next tick drains the
 * backlog. The database is the queue.
 */

/** Redis lease: key, TTL, holder value. The TTL must comfortably exceed the
 *  longest possible sweep (set-based UPDATEs over indexed scans — seconds),
 *  and its expiry is the crash-recovery mechanism: a dead instance's lease
 *  simply lapses and the next tick takes over. */
const SWEEP_LEASE_KEY = "lock:homework-sweep";
const SWEEP_LEASE_TTL_MS = 4 * 60_000;

export interface SweepResult {
  /** Scheduled assignments flipped to published this tick. */
  published: { id: string; title: string }[];
  /** Scheduled publishes that REFUSED (cap hit, vanished section) — retried next tick. */
  publishRefusals: { id: string; reason: string }[];
  /** Student assignment rows flipped to missing this tick. */
  markedMissing: string[];
  /** One-line human summary for the tick log. */
  summary: string;
}

export class HomeworkWorkerService {
  /**
   * One sweep. Throws only on infrastructure failure (the host's tick loop
   * catches and logs); domain refusals are returned, not thrown.
   */
  async runSweep(opts: { publishBatch?: number } = {}): Promise<SweepResult> {
    const publishBatch = opts.publishBatch ?? 50;
    const published: SweepResult["published"] = [];
    const publishRefusals: SweepResult["publishRefusals"] = [];

    // Best-effort lease. NX = only one holder; PX = auto-expiry (crash
    // recovery); the value names the holder for the logs. If Redis itself is
    // down, sweep anyway — idempotency makes a duplicate sweep a no-op, and
    // skipping every sweep because the lock service is down would be worse.
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
        published: [],
        publishRefusals: [],
        markedMissing: [],
        summary: "skipped (another instance holds the sweep lease)",
      };
    }

    // One transaction holds the sweep's reads and the Missing UPDATE; the
    // scheduled publishes deliberately run OUTSIDE it (their own
    // transactions) so one refusal cannot roll back the others.
    return db.transaction(async (tx) => {
      // --- 1. scheduled publishing -----------------------------------------
      // The ids are picked here; each assignment publishes in its OWN
      // transaction (publishAssignment opens one) so a single refusal — a
      // per-day cap, a vanished section — cannot roll back the others.
      // DB clock, and a batch cap: after downtime the backlog drains at
      // publishBatch per tick, not in one unbounded loop.
      const dueIds = await tx
        .select({ id: assignments.id, title: assignments.title })
        .from(assignments)
        .where(
          and(
            eq(assignments.status, "scheduled"),
            lte(assignments.publishAt, sql`now()`),
          ),
        )
        .limit(publishBatch);

      for (const due of dueIds) {
        // The sweep has no DataScope — it is the system acting, not a caller.
        // publishAssignment's school-scoped guard is satisfied by a
        // school-level synthetic scope; the row's own tenancy was fixed at
        // creation and the scopeWhere here would be a tautology, so the
        // direct id-addressed path is the honest one.
        try {
          const publishedAssignment =
            await homeworkService.publishScheduledAssignment(due.id);
          if (publishedAssignment) {
            published.push({ id: due.id, title: due.title });
          } else {
            publishRefusals.push({
              id: due.id,
              reason: "not in a publishable state",
            });
          }
        } catch (err) {
          publishRefusals.push({
            id: due.id,
            reason: err instanceof Error ? err.message : "unknown refusal",
          });
        }
      }

      // --- 2. the missing sweep ---------------------------------------------
      // One set-based UPDATE. The join is the integrity: only rows of
      // PUBLISHED or CLOSED assignments; cancelled/draft/scheduled are
      // excluded; is_backfilled rows are view-only, never submittable, so
      // they are never "missing". DB clock on both sides of the comparison.
      const swept = await tx
        .update(studentAssignments)
        .set({ status: "missing", missingMarkedAt: sql`now()`, statusChangedAt: sql`now()` })
        .where(
          sql`status IN ('assigned','in_progress')
              AND effective_close_at < now()
              AND is_backfilled = false
              AND assignment_id IN (
                SELECT id FROM assignments
                WHERE status IN ('published','closed')
              )`,
        )
        .returning({ id: studentAssignments.id });
      const markedMissing = swept.map((r) => r.id);

      try {
        return {
          published,
          publishRefusals,
          markedMissing,
          summary: `${published.length} published, ${markedMissing.length} missing, ${publishRefusals.length} publish refusal(s)`,
        };
      } finally {
        if (leaseHeld) {
          // Release our OWN lease only (compare the holder) so a slow sweep
          // whose lease expired and was re-taken by another instance does
          // not delete the successor's lease.
          try {
            const current = await getRedis().get(SWEEP_LEASE_KEY);
            if (current === holder) await getRedis().del(SWEEP_LEASE_KEY);
          } catch {
            // Lease expiry is the fallback release path.
          }
        }
      }
    });
  }
}

export const homeworkWorkerService = new HomeworkWorkerService();
