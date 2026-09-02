import { expect, test, type Page } from "@playwright/test";

/**
 * THE FLOW HALF OF THE NET — the U2/U5 screens as the user walks them.
 *
 * routes.spec.ts pins that every page MOUNTS for every role; this spec pins
 * that the two money-adjacent flows WORK: a student admitted through the
 * dialog exists afterwards, and a marked day survives a reload. The walks
 * mirror the manual browser walks from the UI milestone (the dialog-close
 * bug and the calendar-gate refusals were both found that way), so a
 * regression of exactly that class now fails here instead of waiting for a
 * human.
 *
 * One role per flow, by permission, not convenience:
 *   - principal admits (student:create; single school, so the branch is
 *     auto-selected and writeScopeArgs() is non-null) and pins the read-only
 *     day view (attendance:read + update, NO attendance:create — the subject
 *     teacher holds create, since period-wise schools let her mark her own
 *     subject);
 *   - class_teacher marks (attendance:create on 6-A).
 *
 * Roles sign in via the saved storage states global-setup refreshed — no
 * sign-in traffic per test, and the API's limiter stays untouched.
 */

/** Verbatim from lib/copy.ts — the suite pins the user-visible contract. */
const ALREADY_MARKED = "Already marked today — submitting again updates the marks.";
const READ_ONLY_NOTE =
  "You can see this section's day but not mark it — marking needs the attendance:create permission.";
const DETAIL_SUBTITLE = "The student's record: identity, session enrollment, and actions.";

/** A teaching day in the seeded 2025-26 calendar (Mon-Fri; not a holiday). */
const MARK_DATE = "2025-12-01";
/** The seeded roster of 6-A: one student, sectioned. */
const ROSTER_ADMISSION_NUMBER = "DEMO-0001";
const SECTION_LABEL = "Class 6 · A";

/**
 * Opens a Base UI select and picks an option by its visible label. The
 * trigger is identified by its id (every select on these screens has one);
 * the popup renders options in a portal, so the option is looked up at page
 * level, not inside the trigger's subtree.
 */
async function pickSelect(page: Page, triggerId: string, optionLabel: string) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: optionLabel }).click();
}

test.describe("admission flow (principal)", () => {
  test.use({ storageState: "../../auth-principal.json" });

  test("admits a student through the dialog, register, and detail page", async ({
    page,
  }) => {
    const stamp = Date.now().toString(36);
    const lastName = `E2E${stamp}`;
    const admissionNumber = `E2E-${stamp}`;

    await page.goto("/students");
    await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    // The dialog opens, and the required identity fields take input.
    await page.getByRole("button", { name: "Admit student" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Admit a student")).toBeVisible();

    await dialog.locator("#student-admission-number").fill(admissionNumber);
    await dialog.locator("#student-first-name").fill("Zara");
    await dialog.locator("#student-last-name").fill(lastName);
    await dialog.locator("#student-dob").fill("2014-05-10");
    await pickSelect(dialog.page(), "student-gender", "Female");

    // Success closes the dialog (close-on-success is the U2 contract); a
    // validation failure would leave it open and fail the next assertion.
    await dialog.getByRole("button", { name: "Admit student" }).click();
    await expect(dialog).toBeHidden();

    // The register finds her by admission number — the server-side search,
    // not a filter of stale local state.
    const search = page.getByLabel("Search students");
    await search.fill(admissionNumber);
    const admitted = page.getByRole("link", { name: `Zara ${lastName}` });
    await expect(admitted).toBeVisible();

    // Her record page mounts with her name as the title.
    await admitted.click();
    await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: `Zara ${lastName}` })).toBeVisible();
    await expect(page.getByText(DETAIL_SUBTITLE)).toBeVisible();
  });
});

test.describe("marking flow (class teacher)", () => {
  test.use({ storageState: "../../auth-classteacher.json" });

  test("renders the three attendance screens without error wording", async ({
    page,
  }) => {
    const friendlyErrors = [
      "You don't have permission to do this.",
      "Couldn't load this list",
      "Couldn't reach the server.",
      "Something went wrong on our side.",
    ];

    for (const path of ["/attendance/calendar", "/attendance/policy", "/attendance/mark"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const mainText = await page.locator("main").innerText();
      for (const text of friendlyErrors) {
        expect(mainText, `${path} must render without error wording`).not.toContain(text);
      }
    }

    // The policy screen shows the seeded policy, not an error state. The
    // loop above left the browser on the last path, so navigate explicitly.
    await page.goto("/attendance/policy");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("How this branch marks attendance. One policy per branch"),
    ).toBeVisible();
  });

  test("marks a school day and the mark survives a reload", async ({ page }) => {
    await page.goto("/attendance/mark");

    await pickSelect(page, "mark-section", SECTION_LABEL);
    await page.locator("#mark-date").fill(MARK_DATE);

    // The calendar gate admits the date: the roster renders with marking
    // controls (the class teacher holds attendance:create).
    const markAll = page.getByRole("button", { name: "Mark all present" });
    await expect(markAll).toBeVisible();
    await markAll.click();

    // The submit button shares its label with the page heading; the role
    // disambiguates. The click starts an async mutation — wait until the
    // authoritative layer answers before reloading, or the reload aborts the
    // request and the mark never lands (exactly the flake this guard closed).
    await page.getByRole("button", { name: "Mark attendance" }).click();
    await expect(page.getByText(ALREADY_MARKED)).toBeVisible();

    // Persistence, across a fresh load: the day pre-fills from
    // attendance.status. Section and date are client state and reset on
    // reload, so they are chosen again.
    await page.reload();
    await pickSelect(page, "mark-section", SECTION_LABEL);
    await page.locator("#mark-date").fill(MARK_DATE);

    await expect(page.getByText(ALREADY_MARKED)).toBeVisible();
    await expect(
      page.getByLabel(ROSTER_ADMISSION_NUMBER),
      "the pre-filled status must come from the stored marks",
    ).toContainText("present");
  });
});

test.describe("read-only day view (principal)", () => {
  test.use({ storageState: "../../auth-principal.json" });

  test("shows the day without marking controls", async ({ page }) => {
    await page.goto("/attendance/mark");

    await pickSelect(page, "mark-section", SECTION_LABEL);
    await page.locator("#mark-date").fill(MARK_DATE);

    // Same screen, controls absent — the read-only degradation, not a
    // different page and not an error state.
    await expect(page.getByText(READ_ONLY_NOTE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark all present" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark attendance" })).toHaveCount(0);
  });
});
