import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createOpenApiExpressMiddleware } from "trpc-to-openapi";
import { apiReference } from "@scalar/express-api-reference";
import { auth } from "@repo/auth";
import { appRouter } from "@repo/trpc";
import { createContext } from "@repo/trpc";
import { openApiDocument } from "./openapi";
import { env } from "./env";

type Server = import("express").Application;

/**
 * Every better-auth email/password signup route. `sign-up/email` is the only
 * one today, but the prefix covers any sibling a future better-auth version
 * adds, so an upgrade cannot quietly reopen registration.
 */
const SIGN_UP_PATH = /^\/api\/auth\/sign-up(\/|$)/;


export function createServer() : Server {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  /**
   * Self-registration is closed (ADR-021).
   *
   * mskool is multi-tenant: an account is meaningful only once an org has
   * granted it a role. A stranger signing up gets a real row in `user` with no
   * role_assignments — invisible to authorization, but a real credential
   * against a system holding other schools' student data. Staff are provisioned
   * by their organization (ADR-007).
   *
   * This blocks at the HTTP edge rather than setting
   * `emailAndPassword.disableSignUp`, because that flag is checked *inside* the
   * route handler that `auth.api.signUpEmail()` also runs — it would disable
   * server-side provisioning too, forcing the seed (and the future staff-invite
   * flow) to hand-roll password hashing in breach of hard rule 9. The intent is
   * "no signup from the network", not "no signup ever", and this expresses
   * exactly that.
   *
   * MUST stay above the better-auth mount: Express matches in order, and
   * whichever handler is registered first wins.
   *
   * Written as a path test rather than `app.all("/api/auth/sign-up", ...)`
   * because Express 5 changed its path matching, and a pattern that silently
   * fails to match would leave the endpoint open while looking closed.
   * Comparing `req.path` cannot mis-parse.
   */
  app.use((req, res, next) => {
    if (SIGN_UP_PATH.test(req.path)) {
      // Deliberately indistinguishable from a route that does not exist. A 403
      // would confirm the endpoint is there and merely switched off.
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  });


  // better-auth mounts its own routes (sign-in, session, etc.) at /api/auth/* —
  // it needs the RAW body, so it's mounted BEFORE express.json().
  app.all("/api/auth/*", toNodeHandler(auth));


  app.use(express.json());

  // Native tRPC endpoint — this is what apps/web's httpBatchLink talks
  // to (full type inference, batched calls, no REST/JSON-schema layer
  // in between).
  app.use("/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  // REST-over-tRPC: every procedure with `.meta({ openapi: {...} })`
  // becomes a plain JSON REST endpoint here too, e.g. POST /api/exams.
  // Same routers, same validation — just a second transport for
  // anything that isn't a tRPC client (mobile apps, partner
  // integrations, curl).
  app.use("/api", createOpenApiExpressMiddleware({ router: appRouter, createContext }));

  // Interactive API docs (Scalar) reading the generated OpenAPI doc.
  app.get("/openapi.json", (_req, res) => res.json(openApiDocument));
  app.use(
    "/docs",
    apiReference({
      spec: { url: "/openapi.json" },
    }),
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));

  return app;
}
