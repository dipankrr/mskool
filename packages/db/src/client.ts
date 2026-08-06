import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
import * as schema from "./schema";

const queryClient = postgres(env.DATABASE_URL);
// `casing` must match drizzle.config.ts, or generated SQL and runtime
// queries will disagree about column names.
export const db = drizzle(queryClient, { schema, casing: "snake_case" });

export type Database = typeof db;
