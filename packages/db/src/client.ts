import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
import * as schema from "./schema";

/**
 * `prepare: false` is REQUIRED against a transaction-mode pooler (Neon's
 * `-pooler` endpoint, Supabase's :6543, plain PgBouncer).
 *
 * postgres.js uses named prepared statements by default. Transaction pooling
 * hands each transaction whichever backend connection is free, so the prepare
 * and the execute can land on different backends — you get
 * `prepared statement "s1" already exists` or `does not exist`, intermittently
 * and only under concurrency. It looks like a flaky network, not a config bug,
 * which is why it is worth a comment this long.
 *
 * Cost: no statement reuse, so a little more planning work per query. Fine at
 * our scale, and unavoidable while we pool this way.
 */
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

// `casing` must match drizzle.config.ts, or generated SQL and runtime
// queries will disagree about column names.
export const db = drizzle(queryClient, { schema, casing: "snake_case" });

export type Database = typeof db;
