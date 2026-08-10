import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { env } from "@/env";

type SessionResponse = {
  session?: unknown;
};

/**
 * Never prerender or cache this subtree. Session validity must be evaluated per
 * request — a cached "still valid" answer would keep a signed-out user inside
 * the dashboard shell. Declared at route level because `RequestInit.cache` is
 * not in this app's DOM lib types, so `fetch(..., { cache: "no-store" })` does
 * not type-check here.
 */
export const dynamic = "force-dynamic";


/**
 * Gate for every route under (dashboard).
 *
 * Asks the API whether the incoming cookie is a valid session, and bounces to
 * /login if not. This is a UX gate, not the security boundary — it only decides
 * what to render. Every actual read or write is authorized again server-side by
 * the tRPC procedure that serves it, so a forged cookie gets a shell with no
 * data in it.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Forward the browser's cookie: this runs on the server, where fetch has no
  // cookie jar of its own.
  const cookie = (await headers()).get("cookie") ?? "";

  const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/api/auth/get-session`, {
    headers: { cookie },
  });


  if (!res.ok) {
    // Treat an unreachable or erroring API as unauthenticated. Failing closed
    // is the only safe direction for an auth check.
    redirect("/login");
  }

  const session = (await res.json()) as SessionResponse;

  if (!session.session) {
    redirect("/login");
  }

  return children;
}
