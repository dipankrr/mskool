/**
 * Read-only connectivity + drift check. Run before applying a migration:
 *
 *   pnpm --filter @repo/db db:check
 *
 * Answers two questions the migration flow depends on:
 *   1. Do the connection strings actually work (TLS, credentials, pooling)?
 *   2. What is already in the database? drizzle/ describing tables that the
 *      server has never seen is fine on a fresh database and dangerous on one
 *      that has been migrated — the difference decides whether a baseline may
 *      be regenerated.
 */
import postgres from "postgres";
import { env } from "../src/env";

async function listTables(label: string, url: string) {
  const sql = postgres(url, { prepare: false, idle_timeout: 5 });
  try {
    const [{ version }] = await sql<{ version: string }[]>`SELECT version()`;
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    console.log(`\n=== ${label} ===`);
    console.log(version.split(" ").slice(0, 2).join(" "));
    console.log(
      tables.length === 0
        ? "public schema: EMPTY (no tables)"
        : `public schema: ${tables.length} table(s)\n  ` +
            tables.map((t) => t.table_name).join("\n  "),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  await listTables("DATABASE_URL (pooled — runtime)", env.DATABASE_URL);

  if (env.DIRECT_DATABASE_URL && env.DIRECT_DATABASE_URL !== env.DATABASE_URL) {
    await listTables(
      "DIRECT_DATABASE_URL (direct — migrations)",
      env.DIRECT_DATABASE_URL,
    );
  } else {
    console.log("\nDIRECT_DATABASE_URL not set — drizzle-kit will use DATABASE_URL.");
  }
}

// Rethrow rather than process.exit(1): an unhandled rejection already exits
// non-zero, and this file has no other reason to pull in @types/node.
main().catch((error) => {
  console.error("\nConnection check FAILED:\n", error);
  throw error;
});


