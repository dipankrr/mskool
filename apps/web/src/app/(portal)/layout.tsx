import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { PortalShell } from "@/components/portal-shell";
import { hasServerSession, readMustChangePassword } from "@/lib/auth-server";

/**
 * Never prerender or cache this subtree — same contract as (dashboard).
 */
export const dynamic = "force-dynamic";

/**
 * Gate and chrome for every route under (portal) — the family's half of
 * the product (ADR-007/008).
 *
 * The session gate mirrors (dashboard). The MUST-CHANGE gate is the
 * portal's own: a family login whose credential is still the school's
 * temporary password goes straight to the change screen and stays there
 * for every portal route until the flag clears — better-auth's
 * /change-password proves possession of the current password, so the
 * change is the family's first real act, not a detour.
 *
 * Identity itself (which children this login owns) is NOT decided here:
 * the shell asks `me.get`, which returns the ownership list, and every
 * portal.* procedure re-asserts it per request. A staff login wandering
 * into /portal gets the shell with no children and empty states, never
 * someone else's data.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  if (!(await hasServerSession())) {
    redirect("/login");
  }

  const mustChange = await readMustChangePassword();
  if (mustChange) {
    redirect("/change-password");
  }

  return <PortalShell>{children}</PortalShell>;
}
