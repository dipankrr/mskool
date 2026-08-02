import { initTRPC, TRPCError } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import type { Context } from "./context";

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create();

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

/**
 * Any logged-in user — session present, authz cache loaded. This does NOT
 * check permissions; it only confirms an authenticated session exists.
 * All authorization decisions happen in requirePermission below.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
