import { redirect } from "next/navigation";
import { ReactNode } from "react";

import Navbar from "@/components/navbar";
import { hasServerSession } from "@/lib/auth-server";

/**
 * Never prerender or cache this subtree. Session validity must be evaluated per
 * request — see the note on `hasServerSession`, which cannot express the opt-out
 * on the fetch itself.
 */
export const dynamic = "force-dynamic";

/**
 * Gate and chrome for every route under (dashboard).
 *
 * Bounces to /login when the incoming cookie is not a valid session, then
 * renders the authenticated shell around the page. Navbar lives here rather than
 * in the root layout: it carries a profile menu and a sign-out, which are
 * meaningless — and misleading — to a visitor on the sign-in page.
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
      {children}
    </>
  );
}
