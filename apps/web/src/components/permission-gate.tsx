"use client";

import type { ReactNode } from "react";
// Type-only, per the CONVENTIONS.md sanction — nothing reaches the bundle.
import type { Permission } from "@repo/authz";

import { useActiveContext } from "@/features/session/active-context";

/**
 * Hides an action the caller cannot perform. **Not** a security boundary.
 *
 * The permission list comes from `me.get`, which the contract is explicit about:
 * it is a render hint (ADR-017). Authorization happens server-side in `can()` on
 * every single call, and `SENSITIVE_PERMISSIONS` bypasses the Redis snapshot
 * entirely — so a user who edits their permission array in devtools gets a visible
 * button and a 403, which is the correct outcome.
 *
 * **Hidden, not disabled.** A greyed-out control with no explanation is worse than
 * an absent one: it invites clicking, invites asking why, and teaches the user that
 * the app is unpredictable. A principal who cannot create branches should see a
 * screen that simply has no create button, not one that dares them.
 *
 * `fallback` exists for the case where absence itself is confusing — an empty state
 * can then say "ask your administrator" instead of showing an action.
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  /** A `<resource>:<action>` pair from the Permission union, e.g. `school:create`. */
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { has } = useActiveContext();

  return <>{has(permission) ? children : fallback}</>;
}
