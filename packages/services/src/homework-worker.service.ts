import { getRedis } from "@repo/authz";
import { homeworkQuestionsService } from "./homework-questions.service";
import { homeworkService } from "./homework.service";
import { randomUUID } from "node:crypto";

/**
 * THE HOMEWORK SWEEPER (ADR-040) — the time-driven half of ADR-039.
 *
 * The time-driven state changes no HTTP request performs (ADR-064):
 *   1. SCHEDULED → PUBLISHED when publish_at arrives, through the same code
 *      the teacher's Give runs.
 *   2. Quiz attempts left open at the close time are handed in and marked;
 *      children who never started become MISSING.
 *   3. Work sent in the app with nothing sent by the close time becomes
 *      MISSING. Work brought to class never does: only the teacher records it.
 *   Each is a WHERE on state and time, so a row a teacher already checked or
 *   sent back no longer matches and the sweep never overwrites a person.
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
  /** Scheduled homework given this tick. */
  published: { id: string }[];
  /** Scheduled publishes that REFUSED (cap hit, vanished section) — retried next tick. */
  publishRefusals: { id: string; reason: string }[];
  /** Quiz attempts handed in at their close time. */
  handedIn: number;
  /** Children marked missing this tick. */
  markedMissing: number;
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
        handedIn: 0,
        markedMissing: 0,
        summary: "skipped (another instance holds the sweep lease)",
      };
    }

    try {
      // 1. Scheduled homework whose moment has come. Each is given in its
      // own transaction so one refusal (a class with no students) cannot
      // undo the others; a refusal is retried next tick.
      for (const id of await homeworkService.dueScheduled(publishBatch)) {
        try {
          if (await homeworkService.publishScheduled(id)) published.push({ id });
          else publishRefusals.push({ id, reason: "not in a publishable state" });
        } catch (err) {
          publishRefusals.push({ id, reason: err instanceof Error ? err.message : "unknown refusal" });
        }
      }

      // 2. Quizzes: open attempts are handed in at the close time; children
      // who never started become missing.
      const quiz = await homeworkQuestionsService.sweepQuizzes(publishBatch);

      // 3. Work sent in the app: nothing sent by the close time is missing.
      // Work brought to class is never marked missing; only the teacher
      // records it.
      const missing = await homeworkService.sweepMissing(publishBatch);

      return {
        published,
        publishRefusals,
        handedIn: quiz.handedIn,
        markedMissing: missing + quiz.missing,
        summary: `${published.length} published, ${quiz.handedIn} quiz attempts handed in, ${missing + quiz.missing} missing, ${publishRefusals.length} publish refusal(s)`,
      };
    } finally {
      if (leaseHeld) {
        // Release our OWN lease only (compare the holder) so a slow sweep
        // whose lease expired and was re-taken by another instance does not
        // delete the successor's lease.
        try {
          const current = await getRedis().get(SWEEP_LEASE_KEY);
          if (current === holder) await getRedis().del(SWEEP_LEASE_KEY);
        } catch {
          // Lease expiry is the fallback release path.
        }
      }
    }
  }
}

export const homeworkWorkerService = new HomeworkWorkerService();
