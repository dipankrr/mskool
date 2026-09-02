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
const DONE_TITLE = "Attendance done";
const READ_ONLY_NOTE =
  "You can see this section's day but not mark it — marking needs the attendance:create permission.";
const DETAIL_SUBTITLE = "The student's record: identity, session enrollment, and actions.";

/**
 * A teaching day in the seeded 2025-26 calendar (Mon-Fri; not a holiday),
 * reserved for THE marking test so it starts unmarked on every run —
 * the mark itself is an upsert, so a re-run re-marks the same values.
 * 2025-12-01 was the original; it is already marked by earlier runs, and
 * the derived DONE state (correctly) refuses a second "Mark attendance".
 */
const MARK_DATE = "2025-12-08";
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

    // The full-year view lays out every session month at once — the seeded
    // 2025-26 session spans April to March, so the December→January
    // boundary must both be there (the sessionMonths walk). The seeded
    // calendar runs Saturday as a half day, so a December Saturday carries
    // the half-day colour, and the contextual header button reads as
    // fill-missing rather than generate (the calendar exists).
    await page.goto("/attendance/calendar");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Full year" }).click();
    await expect(page.getByText("Dec 2025", { exact: true })).toBeVisible();
    await expect(page.getByText("Jan 2026", { exact: true })).toBeVisible();
    await expect(page.getByText("Apr 2025", { exact: true })).toBeVisible();
    await expect(page.getByText("Mar 2026", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fill missing days" }),
    ).toBeVisible();

    // Month navigation stops at the session's ends. The calendar opens on
    // the session's first month when today is outside it (September 2026
    // is), so Previous starts disabled; walk to the LAST month and Next
    // must be disabled there instead.
    await page.getByRole("button", { name: "Month" }).click();
    await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();
    while (!(await page.getByRole("button", { name: "Next month" }).isDisabled())) {
      await page.getByRole("button", { name: "Next month" }).click();
    }
    await expect(page.getByText("March 2026", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous month" })).toBeEnabled();
  });

  test("marks a school day and the mark survives a reload", async ({ page }) => {
    await page.goto("/attendance/mark");

    await pickSelect(page, "mark-section", SECTION_LABEL);
    await page.locator("#mark-date").fill(MARK_DATE);

    // The calendar gate admits the date: the roster renders with marking
    // controls (the class teacher holds attendance:create).
    const markAll = page.getByRole("button", { name: "All present" });
    await expect(markAll).toBeVisible();

    // Read the first student's STORED status from the pre-filled chip's own
    // label, BEFORE any edit — the prefill renders exactly what the
    // authoritative layer holds. The taps below must land the first student
    // on the SUCCESSOR of that stored status (one step round the page's
    // cycle: present → absent → late → on leave → half day → present), so
    // the submitted day ALWAYS differs from the stored one — including the
    // steady state a previous run of this test leaves behind, because the
    // successor of any status is never that status. The wheel never
    // collides with itself: each run advances the first student one step.
    const chip = page.getByRole("button", { name: /^Change status — currently / }).first();
    const beforeLabel = await chip.getAttribute("aria-label");
    const before = (beforeLabel ?? "").split("currently ")[1] ?? "Present";
    // The PAGE's cycle order (mark/page.tsx CYCLE), not alphabetical.
    const CYCLE = ["Present", "Absent", "Late", "On leave", "Half day"];
    expect(CYCLE, `prefill chip reads a known status (got "${before}")`).toContain(before);
    const successor = CYCLE[(CYCLE.indexOf(before) + 1) % CYCLE.length]!;

    // Bulk actions work: All absent flips every chip, the tally follows, and
    // the save button enables (the roster's size is environment-dependent —
    // the admission spec adds students — so assert the flip, not a count).
    await page.getByRole("button", { name: "All absent" }).click();
    await expect(page.getByRole("button", { name: "Mark attendance" })).toBeEnabled();
    // "All present" resets every chip to the cycle's start.
    await markAll.click();
    await expect(page.getByText("present", { exact: false }).first()).toBeVisible();

    // The chip taps — the cycle control itself, not just the bulk buttons.
    // "All present" reset the chip to Present, so the tap count is simply
    // the successor's index in the cycle; if that is Present (stored was
    // Half day), use two taps (Absent) instead — Present would equal a
    // possible all-present stored day, Absent never equals Half day.
    let taps = CYCLE.indexOf(successor);
    if (taps === 0) taps = 2;
    for (let i = 0; i < taps; i++) {
      await chip.click();
    }
    await expect(
      page.getByRole("button", { name: `Change status — currently ${successor}` }).first(),
    ).toBeVisible();

    // Submit: the click starts an async mutation — wait until the
    // authoritative layer answers before reloading, or the reload aborts the
    // request and the mark never lands (the flake this guard closed).
    await page.getByRole("button", { name: "Mark attendance" }).click();
    // The DONE state is DERIVED from the stored marks, so it appears the
    // same for anyone opening the day, and (below) survives a reload.
    await expect(page.getByRole("button", { name: DONE_TITLE })).toBeVisible();
    await expect(page.locator("[data-slot='badge']", { hasText: DONE_TITLE })).toBeVisible();

    // The colour key: every cycle status shows its short letter with its
    // colour and full word.
    for (const word of CYCLE) {
      await expect(page.locator("span", { hasText: word }).first()).toBeVisible();
    }

    // Persistence, across a fresh load: the day pre-fills from
    // attendance.status. Section and date are client state and reset on
    // reload, so they are chosen again.
    await page.reload();
    await pickSelect(page, "mark-section", SECTION_LABEL);
    await page.locator("#mark-date").fill(MARK_DATE);

    // DONE SURVIVES THE RELOAD — the whole point of deriving it: a teacher
    // returning to a marked day sees the same answer as the one who marked
    // it. The button relabels AND disables; the badge is up top.
    await expect(page.locator("[data-slot='badge']", { hasText: DONE_TITLE })).toBeVisible();
    await expect(page.getByRole("button", { name: DONE_TITLE })).toBeDisabled();

    // The pre-fill comes from the stored marks: the first roster row reads
    // the successor status this run wrote, and the rest read Present.
    await expect(
      page.getByRole("button", { name: `Change status — currently ${successor}` }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change status — currently Present" }).first(),
    ).toBeVisible();

    // Editing flips the day out of done: one more chip tap makes the status
    // differ from the stored marks, so the button re-enables.
    await page
      .getByRole("button", { name: `Change status — currently ${successor}` })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Mark attendance" })).toBeEnabled();
  });
});

test.describe("read-only day view (principal)", () => {
  test.use({ storageState: "../../auth-principal.json" });

  test("shows the day without marking controls", async ({ page }) => {
    await page.goto("/attendance/mark");

    await pickSelect(page, "mark-section", SECTION_LABEL);
    await page.locator("#mark-date").fill(MARK_DATE);

    // Same screen, controls absent — the read-only degradation, not a
    // different page and not an error state. The roster shows word badges
    // (no tap-to-cycle chips), roll numbers lead each row, the live tally
    // renders from the stored marks, and no bulk actions or save button.
    await expect(page.getByText(READ_ONLY_NOTE)).toBeVisible();
    await expect(page.getByRole("button", { name: "All present" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark attendance" })).toHaveCount(0);
    await expect(page.getByText("present", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Change status" })).toHaveCount(0);
  });
});
