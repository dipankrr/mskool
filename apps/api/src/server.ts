import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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

/**
 * Credential stuffing and password spraying target sign-in specifically. The
 * window is generous for a human mistyping a password three times, hostile to
 * a script trying two hundred. better-auth has its own limiter, but it is
 * in-memory and NODE_ENV-dependent; this one is deterministic at the edge
 * regardless of how the process is deployed.
 */
const SIGN_IN_PATH = /^\/api\/auth\/sign-in(\/|$)/;

const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

/**
 * A ceiling on everything else: legitimate clients batch, poll, and retry,
 * but no browser session needs hundreds of requests a minute today.
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests." },
});


export function createServer() : Server {
  const app = express();

  /**
   * Behind one reverse-proxy hop (nginx / a cloud load balancer), Express
   * must trust X-Forwarded-For or every client shares the proxy's IP — which
   * would make the limiters below lock out ALL users because of one attacker.
   * Set to the number of trusted hops in the actual deployment topology; if a
   * second proxy is ever added, this must change with it.
   */
  app.set("trust proxy", 1);

  // Security headers. The API reference page needs inline scripts/styles and
  // bundled assets that the strict default CSP refuses, so a narrower policy
  // is layered on just for the documentation surface below; every other route
  // keeps the strict one.
  app.use(helmet());
  const docsHeaders = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
      },
    },
  });
  app.use("/docs", docsHeaders);
  app.use("/openapi.json", docsHeaders);

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  // Rate limits sit above everything stateful, including better-auth: a
  // flooded endpoint must never reach session verification at all.
  app.use(generalLimiter);

  /**
   * Mounted as a PREDICATE, deliberately. Express 4 silently skips
   * `app.use(/regex/, middleware)` mounts — verified empirically while wiring
   * this up: the regex never matched, the limiter never ran, and nothing
   * warned. The same path test that works for the sign-up block below,
   * applied as an ordinary middleware that always executes.
   */
  app.use((req, res, next) => {
    if (SIGN_IN_PATH.test(req.originalUrl)) {
      signInLimiter(req, res, next);
      return;
    }
    next();
  });

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


  // An explicit ceiling: JSON payloads beyond this are malformed by
  // definition today (no file uploads yet), and an unbounded body parser is
  // a memory-exhaustion vector.
  app.use(express.json({ limit: "1mb" }));

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
