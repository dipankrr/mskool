import { defineConfig } from "vitest/config";

/**
 * The integration suite: real Postgres (DATABASE_URL from the root .env,
 * supplied by the dotenv wrapper in the script), fake Redis socket.
 *
 * One file against one database — parallel workers would contend over the
 * shared fixture, so fileParallelism is off and timeouts are generous enough
 * for a cloud database round-trip per query.
 */
export default defineConfig({
  test: {
    include: ["src/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
