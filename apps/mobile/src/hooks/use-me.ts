import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { authClient } from "../lib/auth";
import { trpc } from "../lib/trpc";

export type Me = inferRouterOutputs<AppRouter>["me"]["get"];

/**
 * Session hydration + `me.get` (Step 0). First call after sign-in: identity,
 * permission map for gated rendering, staff/family dispatch, forced-change
 * flag. `staleTime` 60s bounds freshness; foreground return refetches
 * explicitly (see root layout) and assignment mutations invalidate — never
 * polling, never an interval refetch.
 *
 * The query stays disabled until a session exists, so a signed-out boot
 * never fires an unauthenticated request.
 */
export function useMe() {
  const {
    data: session,
    isPending: sessionPending,
    refetch: refetchSession,
  } = authClient.useSession();
  const query = trpc.me.get.useQuery(undefined, {
    staleTime: 60_000,
    enabled: !!session,
  });
  const me = query.data ?? null;
  const memberships = me?.memberships ?? [];

  return {
    ...query,
    session,
    sessionPending,
    /**
     * Force a server-truth session refresh. The sign-in cookie hook only
     * *notifies* the session atom (an async background refetch), so callers
     * that navigate right after signing in settle with this first.
     */
    refetchSession,
    me,
    /** Any live staff grant. Empty is "no staff access", not an error. */
    isStaff: memberships.length > 0,
    /** Owned students present — the family-shell dispatch (Step 9). */
    isFamily: (me?.portal?.studentIds.length ?? 0) > 0,
    mustChangePassword: me?.user.mustChangePassword ?? false,
  };
}
