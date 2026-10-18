import { useCallback, useMemo } from "react";

import { useActiveContext } from "./use-active-context";
import { useMe } from "./use-me";

/**
 * The caller's permission *hint* set: the union of `me.get` permissions
 * across memberships — scoped to the active org when one is resolved. Used to
 * decide what to render (tabs, gates, read-only vs editing), never to
 * authorize: every action is re-checked server-side by `can()`, so a tampered
 * hint gains nothing.
 */
export function usePermissions() {
  const { me } = useMe();
  const { organizationId } = useActiveContext();

  const permissions = useMemo(() => {
    const memberships = me?.memberships ?? [];
    const scoped = organizationId
      ? memberships.filter((m) => m.organization.id === organizationId)
      : memberships;
    // A stale active org (revoked mid-session) must not blank the UI down to
    // "no permissions": fall back to the full union — the server still
    // refuses anything the grants no longer allow.
    const source = scoped.length > 0 ? scoped : memberships;
    const union = new Set<string>();
    for (const membership of source) {
      for (const permission of membership.permissions) union.add(permission);
    }
    return union;
  }, [me, organizationId]);

  const has = useCallback(
    (permission: string) => permissions.has(permission),
    [permissions],
  );
  const hasAny = useCallback(
    (...candidates: string[]) => candidates.some((p) => permissions.has(p)),
    [permissions],
  );

  return { permissions, has, hasAny };
}
