"use client";

import { trpc } from "@/lib/trpc/client";
import { toFriendlyError } from "@/lib/errors";

/**
 * The first call after sign-in, and the one every other call depends on.
 *
 * A better-auth session carries only the user — no org, no role, no scope — but
 * every staff procedure requires an `organizationId` in its input. `me.get` is
 * the endpoint that tells the browser which organizations it may legitimately
 * name; inventing one client-side is exactly the cross-tenant move the staff
 * builders exist to prevent.
 *
 * **Long `staleTime`, deliberately.** The response is a permission snapshot, and
 * it changes when someone's role changes — days or months, not seconds. Refetching
 * it on every mount would put a Redis round-trip in front of every navigation for
 * data that is already only a render hint: `can()` re-checks server-side on every
 * request, and SENSITIVE_PERMISSIONS bypasses the cache entirely, so a stale menu
 * item cannot become a stale authorization.
 */
const FIVE_MINUTES = 5 * 60 * 1000;

export function useMe() {
  return trpc.me.get.useQuery(undefined, {
    staleTime: FIVE_MINUTES,
    gcTime: FIVE_MINUTES * 2,
    // The window regaining focus is not news about someone's role.
    refetchOnWindowFocus: false,
    /**
     * Retrying an expired session three times just delays the redirect by three
     * round-trips. Anything else — a cold Neon start, a dropped connection — is
     * worth one retry, since this call gates the entire shell.
     */
    retry: (failureCount, error) =>
      !toFriendlyError(error).requiresSignIn && failureCount < 1,
  });
}
