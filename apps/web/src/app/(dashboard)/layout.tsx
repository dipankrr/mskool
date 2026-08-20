import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ActiveContextProvider } from "@/features/session/active-context";
import { hasServerSession } from "@/lib/auth-server";

/**
 * Never prerender or cache this subtree. Session validity must be evaluated per
 * request — see the note on `hasServerSession`.
 */
export const dynamic = "force-dynamic";

/**
 * Gate and chrome for every route under (dashboard).
 *
 * Bounces to /login when the incoming cookie is not a valid session, then hands off
 * to the client shell. Three layers, in this order for a reason:
 *
 *   session gate     — server-side, so an unauthenticated request never renders app UI
 *   context provider — calls `me.get`, resolves organization, branch and session
 *   AppShell         — navigation and switchers, visible in every context state
 *
 * The provider wraps the shell rather than the other way round because the shell
 * displays the context; the shell wraps the page because the page must not render
 * until the context resolves, and `ActiveContextGate` inside the shell is what
 * enforces that.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await hasServerSession())) {
    redirect("/login");
  }

  return (
    <ActiveContextProvider>
      <AppShell>{children}</AppShell>
    </ActiveContextProvider>
  );
}
