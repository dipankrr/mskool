import { headers } from "next/headers";

import { env } from "@/env";

type SessionResponse = {
  session?: unknown;
};

/**
 * Does the incoming request carry a valid session? Answered on the server.
 *
 * The browser counterpart is `lib/auth-client.ts`. This one runs in server
 * components, where `fetch` has no cookie jar of its own, so the request's
 * cookie is forwarded by hand.
 *
 * One function rather than a copy in each caller, because the two callers are
 * inverses — the dashboard redirects when there is NO session, `/login` when
 * there IS one — and two copies of an auth check drift in opposite directions.
 *
 * **Every caller must also export `dynamic = "force-dynamic"`.** Reading
 * `headers()` already opts a route out of static rendering, and Next has not
 * cached `fetch` by default since 15, so this is a declaration of intent rather
 * than a workaround: a cached "still valid" answer would keep a signed-out user
 * inside the dashboard shell, and that must stay impossible by accident.
 *
 * This is a UX gate, not the security boundary: it only decides what to render.
 * Every read and write is authorized again server-side by the tRPC procedure
 * that serves it, so a forged cookie gets a shell with no data in it.
 */
export async function hasServerSession(): Promise<boolean> {
  const cookie = (await headers()).get("cookie") ?? "";

  const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/api/auth/get-session`, {
    headers: { cookie },
  });

  // An unreachable or erroring API counts as "no session". Failing closed is the
  // only safe direction for the dashboard gate, and it is also the right answer
  // for /login, where it yields the sign-in form rather than a redirect loop.
  if (!res.ok) return false;

  // better-auth answers "no session" with 200 and a JSON `null` body, not 401 and
  // not `{}`. Reading `.session` off that throws, which is how this arrived: the
  // gate crashed into an error boundary for exactly the visitor it exists to
  // redirect. Optional chaining is the whole fix, and the reason it is spelled
  // out here is that the shape looks safe and is not.
  const session = (await res.json()) as SessionResponse | null;

  return Boolean(session?.session);
}
