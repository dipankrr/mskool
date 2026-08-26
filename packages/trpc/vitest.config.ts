import { defineConfig } from "vitest/config";

/**
 * Unit boundary only. The integration suite lives in src/integration and has
 * its own config (`pnpm test:integration`) because it needs the real
 * database; turbo's plain `test` task must stay hermetic.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/integration/**", "**/node_modules/**", "**/dist/**"],
  },
});
