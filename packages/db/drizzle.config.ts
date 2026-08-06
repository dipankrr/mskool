import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  // Write `admissionNumber` in TS, get `admission_number` in Postgres.
  // Must match the `casing` passed to drizzle() in client.ts.
  casing: "snake_case",

  strict: true,
  verbose: true,
});
