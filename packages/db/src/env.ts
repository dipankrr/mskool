import { createEnv } from "@repo/env";
import { z } from "zod";

// The ONLY file in this package allowed to touch process.env directly.
export const env = createEnv({
  /**
   * Runtime connection. On Neon this is the POOLED endpoint (host contains
   * `-pooler`) — PgBouncer in transaction mode, which is what you want for a
   * request-per-connection API. See client.ts for the `prepare: false` that
   * transaction pooling forces on us.
   */
  DATABASE_URL: z.url(),

  /**
   * Migrations only (drizzle-kit). Neon's DIRECT endpoint, no PgBouncer.
   *
   * DDL and drizzle-kit's advisory locks need a real session, which
   * transaction pooling does not give you. Optional because a running API
   * never migrates — production injects DATABASE_URL alone and would fail to
   * boot if this were required. drizzle.config.ts falls back to DATABASE_URL,
   * which is correct for any non-pooled Postgres.
   */
  DIRECT_DATABASE_URL: z.url().optional(),
});


