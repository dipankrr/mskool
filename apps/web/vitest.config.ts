import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for apps/web's pure modules (src/lib) only.
//
// test.include is deliberate and narrow: Playwright owns e2e spec files
// (plan locked decision - those need running servers and a seeded database),
// and without this pin vitest's default glob would try to run them too.
// resolve.alias mirrors tsconfig paths so lib modules importing "@/..."
// resolve outside Next.js.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
