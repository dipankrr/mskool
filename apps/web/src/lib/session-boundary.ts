"use client";

/**
 * THE SIGN-IN/OUT BOUNDARY — where one human's data must end and the next's
 * begin, in a SPA that never reloads.
 *
 * The bug this file exists to make impossible: sign out as org_admin, sign
 * in as a teacher, and the teacher saw the admin's app — nav, permissions
 * hint, every list — until a hard refresh. Three caches held the previous
 * user's answers, and none of them keys by session:
 *
 *   1. The React Query cache. `me.get` (the permission snapshot the nav
 *      renders from) has a five-minute staleTime by design, and every list
 *      query (students, classes, calendar) is cached under keys that name
 *      the DATA, not the viewer. After sign-in the queries are "fresh", so
 *      nothing refetches — the new user is served the old user's answers.
 *   2. localStorage's active context — org/branch/session ids the next
 *      user may have no grant for; a leftover branch id would make
 *      `writeScopeArgs()` target a school the new user cannot write.
 *   3. Next's client router cache. `router.replace` alone does not drop
 *      prefetched RSC payloads, and the dashboard layout is dynamic but
 *      its children may still be replayed from the client cache.
 *
 * Clearing all three is a session-boundary operation: it belongs to BOTH
 * sides. Sign-out must not leave the next user a dirty cache, and sign-in
 * must not trust whatever a previous user left behind (the expired-session
 * path redirects straight to /login without the sign-out button, so
 * sign-in is the only boundary both flows are guaranteed to cross).
 *
 * Deliberately NOT `queryClient.clear()` followed by `resetQueries` games:
 * `removeQueries` drops every entry so each `useQuery` remounts into a
 * pending state and refetches under the new session. The one cache we
 * cannot reach from here is better-auth's `useSession` atom; sign-out
 * updates it on success and sign-in's first dashboard fetch is what
 * refreshes `me.get`.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** Verbatim twin of active-context's key — see the note in clearSessionState. */
const ACTIVE_CONTEXT_KEY = "mskool.active-context.v1";

export function useSessionBoundary() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useCallback(async () => {
    // 1. Every cached answer dies: permissions, lists, calendars — all of
    // it belonged to someone else now.
    queryClient.removeQueries();

    // 2. The persisted org/branch/session selection dies with it. The
    // next user's own defaults resolve fresh on their first load, the
    // same defensive-read path that survives corrupted JSON. localStorage
    // can throw in private-browsing modes; the boundary must not.
    try {
      window.localStorage.removeItem(ACTIVE_CONTEXT_KEY);
    } catch {
      // No storage: nothing to clear. The in-memory caches above were the
      // actual bug; this was belt-and-braces.
    }

    // 3. Next's client-side router cache. `refresh()` re-runs the server
    // components for the current tree under the new cookie, so the shell
    // cannot replay the previous user's RSC payload. Awaiting it means the
    // caller's navigate happens against a clean router state.
    await router.refresh();
  }, [queryClient, router]);
}
