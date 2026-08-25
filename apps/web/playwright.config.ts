import { defineConfig, devices } from "@playwright/test";

/**
 * E2E — the browser half of the A2 net (see
 * .kilo/plans/1787570451000-authz-api-shape-refactor.md).
 *
 * This is deliberately NOT part of `pnpm test`. It needs a running web server,
 * a running API, and a seeded database; the `webServer` block below starts the
 * monorepo dev servers (reusing them when already up) and `globalSetup`
 * refreshes one saved auth state per seeded role before any spec runs.
 *
 * Vitest never sees these files: its only project today is @repo/authz, which
 * scans its own package, and this config's testDir pins Playwright to `e2e/`.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One worker: every role walks the same seeded fixture, and parallel runs
  // would only contend for the dev server while it compiles routes.
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000",
  },
  webServer: {
    command: "pnpm dev",
    cwd: "../..",
    url: process.env.E2E_WEB_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
