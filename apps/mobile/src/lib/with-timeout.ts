/**
 * Bounded waits for native requests (2026-10-17 walk finding: an unreachable
 * API left the sign-in spinner running ~2.5 minutes — Android's TCP expiry,
 * with no client-side deadline of our own). Two shapes:
 *
 * - `withTimeout` aborts work we own; native fetch accepts the signal, so the
 *   socket is torn down rather than merely ignored.
 * - `bestEffort` bounds a wait on work we cannot abort (better-auth 1.6.23's
 *   session atom `refetch` takes no signal). The work finishes in the
 *   background either way; only our wait is capped.
 */
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function bestEffort(
  work: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
