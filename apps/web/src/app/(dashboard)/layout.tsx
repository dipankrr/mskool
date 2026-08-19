import { redirect } from "next/navigation";
import { ReactNode } from "react";

import Navbar from "@/components/navbar";
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
 * Bounces to /login when the incoming cookie is not a valid session, then
 * renders the authenticated shell around the page. Navbar lives here rather than
 * in the root layout: it carries a profile menu and a sign-out, which are
 * meaningless — and misleading — to a visitor on the sign-in page.
 *
 * `ActiveContextProvider` sits inside the gate because it is the client-side
 * bootstrap: it calls `me.get` to learn which organization, branch and session
 * this user is working in, and holds children back until that resolves. Every
 * staff call below it reads its scope from there.
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
    <>
      <Navbar />
      <ActiveContextProvider>{children}</ActiveContextProvider>
    </>
  );
}
