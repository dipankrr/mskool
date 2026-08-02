import { generateOpenApiDocument } from "trpc-to-openapi";
import { appRouter } from "@repo/trpc";
import { env } from "./env";

/**
 * Every procedure with a `.meta({ openapi: {...} })` block (see the
 * routers in trpc/routers/*) shows up here automatically. Add a new
 * procedure with that meta and it appears in /api/docs with zero
 * extra wiring — the zod input/output schemas double as the request/
 * response schemas in the spec.
 */
export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: "Exam Platform API",
  description: "Multi-vendor merit/talent-search exam management API.",
  version: "0.1.0",
  baseUrl: `http://localhost:${env.PORT}/api`,
  tags: ["exams", "registrations", "marks", "results"],
});
