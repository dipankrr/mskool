import { homeworkWorkerService } from "@repo/services";
import { env } from "./env";

/**
 * THE HOMEWORK SWEEPER'S HOST LOOP (ADR-040).
 *
 * A fixed-interval tick that calls the sweeper in @repo/services. Deliberately
 * boring: no queue, no cron library, no second process. Correctness lives in
 * the sweeper (idempotent WHERE clauses, DB clock, transaction-scoped
 * advisory lock) — this file only owns the clock, the in-flight guard, the
 * kill switch, and graceful shutdown.
 *
 * Multi-instance safety: N API instances all run this loop, and every tick
 * each tries pg_try_advisory_xact_lock — exactly one sweeps, the rest skip
 * within milliseconds. First-instance-wins, no coordination needed.
 *
 * Disabled by default (HOMEWORK_WORKER_DISABLED) so test suites that build
 * their own late rows and drive the sweeper directly never race a live tick;
 * the production .env leaves it on.
 */
export interface HomeworkWorkerHandle {
  stop: () => Promise<void>;
}

export function startHomeworkWorker(): HomeworkWorkerHandle | null {
  if (env.HOMEWORK_WORKER_DISABLED === "true") {
    console.log("⏸️  homework sweeper disabled (HOMEWORK_WORKER_DISABLED)");
    return null;
  }

  const tickSeconds = env.HOMEWORK_WORKER_TICK_SECONDS;
  let inFlight = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  homeworkWorkerHealth.startedAt = new Date();

  const tick = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    const beganAt = Date.now();
    try {
      const result = await homeworkWorkerService.runSweep({
        publishBatch: env.HOMEWORK_WORKER_PUBLISH_BATCH,
      });
      homeworkWorkerHealth.lastSweepAt = new Date();
      homeworkWorkerHealth.lastSummary = result.summary;
      if (result.published.length || result.markedMissing.length || result.publishRefusals.length) {
        console.log(
          `⏱️  homework sweep: ${result.summary} (${Date.now() - beganAt}ms)`,
        );
        for (const refusal of result.publishRefusals) {
          console.warn(`   publish refusal ${refusal.id}: ${refusal.reason}`);
        }
      }
    } catch (err) {
      // A failed tick is logged and retried next tick — nothing is
      // time-critical to the second, and every transition is idempotent.
      console.error("[homework-worker] sweep failed:", err);
    } finally {
      inFlight = false;
    }
  };

  // First sweep runs one tick after boot (let the server finish coming up),
  // then on the fixed interval.
  timer = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), tickSeconds * 1000);
    timer.unref?.();
  }, tickSeconds * 1000);
  timer.unref?.();

  console.log(
    `⏱️  homework sweeper on (every ${tickSeconds}s, batch ${env.HOMEWORK_WORKER_PUBLISH_BATCH})`,
  );

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        if (timer) clearTimeout(timer);
        // Wait out an in-flight sweep (bounded by one tick's work; the
        // advisory lock guarantees only one is running anywhere).
        const wait = () => (inFlight ? setTimeout(wait, 200) : resolve());
        wait();
      }),
  };
}

// Shared liveness fact for /health: the host records each completed sweep.
export const homeworkWorkerHealth = {
  startedAt: null as Date | null,
  lastSweepAt: null as Date | null,
  lastSummary: null as string | null,
};
