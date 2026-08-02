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

export function createServer() : Server {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  // better-auth mounts its own routes (sign-up, sign-in, org invites,
  // session, etc.) at /api/auth/* — it needs the RAW body, so it's
  // mounted BEFORE express.json().
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
