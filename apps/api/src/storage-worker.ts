import { storageWorkerService } from "@repo/services";
import { env } from "./env";

/**
 * THE STORAGE SWEEPER'S HOST LOOP (ADR-063).
 *
 * A fixed-interval tick that removes files nothing uses any more: uploads
 * never completed, files never attached, and files marked deleted. Correctness
 * lives in the service (rows first behind foreign keys, Redis lease, DB
 * clock); this file owns the clock, the in-flight guard, the kill switch and
 * graceful shutdown — the homework sweeper's shape. Cleanup is never
 * time-critical, so a host that suspends idle processes only delays it.
 */
export interface StorageWorkerHandle {
  stop: () => Promise<void>;
}

export function startStorageWorker(): StorageWorkerHandle | null {
  if (env.STORAGE_WORKER_DISABLED === "true") {
    console.log("⏸️  storage sweeper disabled (STORAGE_WORKER_DISABLED)");
    return null;
  }

  const tickSeconds = env.STORAGE_WORKER_TICK_SECONDS;
  let inFlight = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  storageWorkerHealth.startedAt = new Date();

  const tick = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    const beganAt = Date.now();
    try {
      const result = await storageWorkerService.runSweep({ batch: env.STORAGE_WORKER_BATCH });
      storageWorkerHealth.lastSweepAt = new Date();
      storageWorkerHealth.lastSummary = result.summary;
      const removed = result.abandonedUploads + result.unattachedFiles + result.deletedFiles;
      if (removed > 0 || result.stillInUse.length > 0 || result.reconcile) {
        console.log(`🗑️  storage sweep: ${result.summary} (${Date.now() - beganAt}ms)`);
      }
    } catch (err) {
      // Logged and retried next tick; every step is safe to run twice.
      console.error("[storage-worker] sweep failed:", err);
    } finally {
      inFlight = false;
    }
  };

  timer = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), tickSeconds * 1000);
    timer.unref?.();
  }, tickSeconds * 1000);
  timer.unref?.();

  console.log(`🗑️  storage sweeper on (every ${tickSeconds}s, batch ${env.STORAGE_WORKER_BATCH})`);

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        if (timer) clearTimeout(timer);
        const wait = () => (inFlight ? setTimeout(wait, 200) : resolve());
        wait();
      }),
  };
}

/** Liveness for /health: the host records each completed sweep. */
export const storageWorkerHealth = {
  startedAt: null as Date | null,
  lastSweepAt: null as Date | null,
  lastSummary: null as string | null,
};
