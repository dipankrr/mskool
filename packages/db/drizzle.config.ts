import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations run against the DIRECT endpoint, not the pooled one: DDL and
    // drizzle-kit's advisory locks need a real session. Falls back to
    // DATABASE_URL, which is correct whenever Postgres is not behind a
    // transaction-mode pooler.
    url: env.DIRECT_DATABASE_URL ?? env.DATABASE_URL,
  },

  // Write `admissionNumber` in TS, get `admission_number` in Postgres.
  // Must match the `casing` passed to drizzle() in client.ts.
  casing: "snake_case",

  strict: true,
  verbose: true,
});
