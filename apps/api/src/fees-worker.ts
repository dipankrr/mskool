import { feesBillingService } from "@repo/services";
import { env } from "./env";

/**
 * THE MONTHLY FEES SWEEP'S HOST LOOP (ADR-051).
 *
 * For schools in `monthly_auto` mode, a fixed-interval tick brings every
 * billed student of the current session up to the end of this month. The
 * generator only fills what is missing, so the tick can run as often as it
 * likes: hourly by default, and the first tick after the 1st of a month
 * creates that month's dues. Correctness lives in the service (insert-only
 * generator, Redis lease); this file owns the clock, the in-flight guard,
 * the kill switch and graceful shutdown — the homework sweeper's shape.
 *
 * Disabled by default for the same reason as the homework sweeper: test
 * suites drive the sweep directly and must never race a live tick.
 */
export interface FeesWorkerHandle {
  stop: () => Promise<void>;
}

export function startFeesWorker(): FeesWorkerHandle | null {
  if (env.FEES_WORKER_DISABLED === "true") {
    console.log("⏸️  fees monthly sweep disabled (FEES_WORKER_DISABLED)");
    return null;
  }

  const tickSeconds = env.FEES_WORKER_TICK_SECONDS;
  let inFlight = false;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  feesWorkerHealth.startedAt = new Date();

  const tick = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    const beganAt = Date.now();
    try {
      const result = await feesBillingService.runMonthlySweep();
      feesWorkerHealth.lastSweepAt = new Date();
      feesWorkerHealth.lastSummary = result.summary;
      if (result.inserted > 0) {
        console.log(`🧾 fees sweep: ${result.summary} (${Date.now() - beganAt}ms)`);
      }
    } catch (err) {
      // Logged and retried next tick; the sweep only ever fills gaps.
      console.error("[fees-worker] sweep failed:", err);
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

  console.log(`🧾 fees monthly sweep on (every ${tickSeconds}s)`);

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
export const feesWorkerHealth = {
  startedAt: null as Date | null,
  lastSweepAt: null as Date | null,
  lastSummary: null as string | null,
};
