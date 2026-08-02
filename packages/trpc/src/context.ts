import type { Request, Response } from "express";
import { auth } from "@repo/auth";
import { db } from "@repo/db";

/**
 * Built once per request. better-auth validates the session cookie;
 * then — if there's a logged-in user — we load (or build) their auth
 * cache from Redis. Zero DB calls on cache hit.
 *
 * `authz` is null when the session is absent (public endpoints) or when
 * Redis is cold for this user (the first request after login). In the
 * latter case, buildAuthCache runs its two DB queries and sets the key.
 *
 * isSuperAdmin is pulled off the session user and surfaced here so the
 * requirePermission middleware can short-circuit before ever touching
 * role_assignments or the authz cache.
 */
export async function createContext({ req, res }: { req: any; res: any }) {
  const session = await auth.api.getSession({ headers: req.headers as never });

  return {
    db,
    session,// null if not logged in; populated from Redis/DB otherwise.
    req,
    res,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
