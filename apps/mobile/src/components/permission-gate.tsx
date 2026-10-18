import type { ReactNode } from "react";

import { usePermissions } from "../hooks/use-permissions";

/**
 * Render children only when the caller's permission hints include the gate.
 * Pass an array to accept any of several. This is view behavior — the route
 * and the server enforce independently; a gated-off control that is called
 * anyway still fails with the honest refusal from the API.
 */
export function PermissionGate({
  permission,
  fallback = null,
  children,
}: {
  permission: string | string[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { has, hasAny } = usePermissions();
  const allowed = Array.isArray(permission)
    ? hasAny(...permission)
    : has(permission);
  return <>{allowed ? children : fallback}</>;
}
