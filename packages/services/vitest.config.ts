import { defineConfig } from "vitest/config";

/**
 * Unit boundary only — the fees maths (buckets, apportionment, late fee) is
 * pure and tested here with no database. Collection concurrency is the
 * integration suite's job (F7), which needs the real Postgres.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
