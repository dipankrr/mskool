import { useEffect, useRef } from "react";

import { queryClient } from "../lib/query";
import { authClient } from "../lib/auth";

/**
 * The session boundary (Step 0): the web's cross-session leak, ported here
 * as a rule. On sign-out or user switch, outstanding user-scoped requests
 * are cancelled FIRST — a late response must never paint the previous
 * user's data into the new session — then the query cache and persisted
 * active-context are dropped. Call once from the root layout.
 */
export function useSessionBoundary(clearActiveContext: () => void) {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    if (prevUserId.current !== null && prevUserId.current !== userId) {
      void queryClient.cancelQueries().then(() => {
        queryClient.clear();
        clearActiveContext();
      });
    }
    prevUserId.current = userId;
  }, [userId, clearActiveContext]);
}
