import { expect, test } from "@playwright/test";

/**
 * THE SESSION-BOUNDARY TEST — the sign-out/in staleness bug, as a walk.
 *
 * The bug: sign out as admin, sign in as teacher, and the teacher saw the
 * admin's app (nav, permission-gated buttons, lists) until a hard refresh.
 * Three caches survived sign-out — the React Query cache (me.get's
 * permission snapshot + every list), the localStorage active-context, and
 * Next's client router cache — because nothing on the sign-out or sign-in
 * path cleared them (see lib/session-boundary.ts).
 *
 * The proof is asymmetric ON PURPOSE: the admin sees Branches, the teacher
 * does not. The nav filter renders from me.get's permissions — the exact
 * cached answer a half-fix would leave behind. NO page reload anywhere:
 * the whole point is that the SPA navigation carries the cleared caches.
 */
test("a sign-out/sign-in switch does not leak the previous user's UI", async ({
  page,
}) => {
  // --- Sign in as the org admin -------------------------------------------
  await page.goto("/login");
  await page.locator("#email").fill("admin@demo-trust.test");
  await page.locator("#password").fill("Password123!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("/");
  // The greeting renders from me.get; the admin's seed name is "Demo Trust
  // Administrator" — and the shell shows his email, the unambiguous id.
  await expect(page.getByRole("heading", { name: "Hello, Demo" })).toBeVisible();
  await expect(page.getByText("admin@demo-trust.test").first()).toBeVisible();
  // The admin's nav: Branches is visible (school:read).
  await expect(page.locator('a[href="/branches"]:visible').first()).toBeVisible();

  // --- Sign out via the profile page (the real button, not a shortcut) -----
  await page.locator('a[href="/profile"]:visible').first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");

  // --- Sign in as the class teacher, in the SAME tab, no reload -----------
  await page.locator("#email").fill("teacher@demo-trust.test");
  await page.locator("#password").fill("Password123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // The teacher's app, from the TEACHER's me.get: her email in the shell,
  // her greeting, and Branches gone from the nav. If me.get were still the
  // admin's cached answer, all three assertions fail here.
  await expect(page.getByRole("heading", { name: "Hello, Demo" })).toBeVisible();
  await expect(page.getByText("teacher@demo-trust.test").first()).toBeVisible();
  await expect(page.locator('a[href="/branches"]:visible')).toHaveCount(0);

  // And a permission-gated page renders as HER, not as the admin: the
  // students register's "Admit student" button (student:create) — the admin
  // holds it, the class teacher does not (read/export only).
  await page.locator('a[href="/students"]:visible').first().click();
  await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Admit student" })).toHaveCount(0);
});
