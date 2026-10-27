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

/**
 * The tRPC deadline (2026-10-18 walk finding #4): on a dead-zone network a
 * request stays pending until the OS gives up — minutes, or never from the
 * user's point of view. A deadline turns that into the screens' existing
 * connection copy + retry, draft intact. Same 15 s bound as the auth calls.
 */
export const API_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Mutations get a longer leash (2026-10-27 7C walk finding): the heavy acts —
 * compute, publish, window close — run many sequential server-side queries,
 * and against a remote database the whole act can honestly take past the 15 s
 * read bound while the work lands. A false "Couldn't reach the server" after
 * a real success is worse than a slower failure: the teacher retypes, or
 * trusts the failure and walks away. Reads keep the tight bound. Walk
 * reality: compute measured ~60-75 s against the remote dev DB — the real
 * fix is server-side batching (plan gap 29); the leash is a bandage whose
 * final value follows that fix.
 */
export const API_MUTATION_TIMEOUT_MS = 120_000;

/**
 * Fuse an optional external signal (React Query cancellation) with a deadline
 * into one signal. `AbortSignal.any` is not available on Hermes, so this is
 * hand-rolled; call `release()` once the request settles to clear the timer
 * and the listener.
 */
export function withDeadline(
  external: AbortSignal | null | undefined,
  timeoutMs: number = API_REQUEST_TIMEOUT_MS,
): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forwardAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", forwardAbort);
  }
  const release = () => {
    clearTimeout(timer);
    external?.removeEventListener("abort", forwardAbort);
  };
  return { signal: controller.signal, release };
}
