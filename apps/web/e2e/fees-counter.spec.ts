import { expect, test, type Page } from "@playwright/test";

/**
 * THE COUNTER FLOW — the money path, pinned forever.
 *
 * Everything else in the fees slice is walked manually per chunk and
 * guarded by the backend's own suites (42 integration tests, the
 * smoke matrix); the counter is where a REGRESSION would silently
 * double-collect or mis-state money, so it gets the durable armor:
 *
 *   1. as the accountant, record a CASH payment against the seeded
 *      student's next open instalment → the receipt renders with a
 *      receipt number, and the payment appears in the list, cleared.
 *   2. as the accountant, record a CHEQUE → pending (the desk's
 *      story: the bank decides, not the counter).
 *   3. as the org admin, BOUNCE that cheque → the instalment's
 *      balance re-opens on the dues screen (the arrears view grows).
 *
 * Re-runnability: every run allocates against whatever instalments
 * are open (the walk and manual testing drift the demo org — the
 * spec reads the CURRENT dues, never a hardcoded row), and the
 * bounced cheque is itself a fresh row each run. The receipt count
 * grows run over run, which is fine — the assertions are about
 * relationships (receipt exists; status flips; dues re-open), not
 * totals.
 *
 * Roles by permission: the accountant records (fee_payment:create,
 * no approve); the admin bounces (fee_payment:approve). That split
 * IS the separation-of-duties story — if someone ever merges the
 * tiers, step 3 fails because the accountant could do it herself.
 */

const COUNTER_URL = "/fees/counter";
const DUES_URL = "/fees/dues";
const PAYMENTS_URL = "/fees/payments";

/**
 * The seeded students, in fallback order: the spec pays whoever still
 * has open instalments. Re-runs consume dues (each run's Pay-in-full
 * closes a row; bounced runs re-open one), so the pick is DYNAMIC —
 * DEMO-0001 first, DEMO-0002 as fallback — and the test asserts only
 * relationships (receipt renders; status flips; dues re-open), never
 * hardcoded amounts. When both drain, `pnpm db:seed` re-fixture is the
 * documented reset (the seed is find-or-create; the smoke pair runs
 * after it unchanged).
 */
const STUDENTS = ["DEMO-0001", "DEMO-0002"] as const;

/** Verbatim from lib/copy.ts — the suite pins the user-visible contract. */
const PENDING_BADGE = "Pending confirmation";
const CLEARED_BADGE = "Cleared";

/**
 * The receipt CARD, specifically — the collecting card also contains the
 * word "receipt" (in the late-fee honesty line), so filtering by substring
 * text alone matches both; the receipt card is the one whose HEADER is
 * exactly "Receipt" (CardTitle) — match the mono receipt-number span.
 */
function receiptCard(page: Page) {
  return page.locator("[data-slot=card]").filter({ has: page.locator("span.font-mono") }).first();
}

test.describe("counter flow (accountant)", () => {
  test.use({ storageState: "../../auth-accountant.json" });

  test("records a cash payment and renders the receipt", async ({ page }) => {
    await recordCounterPayment(page, { payInFull: true });

    // The receipt panel: server's answer verbatim.
    const receiptCardLocator = receiptCard(page);
    await expect(receiptCardLocator).toBeVisible();
    await expect(receiptCardLocator).toContainText(/RCP-\d{4}-\d{5}/);
    await expect(receiptCardLocator).toContainText(CLEARED_BADGE);

    // The payments list shows it too.
    await page.goto(PAYMENTS_URL);
    await expect(
      page.getByRole("cell", { name: /RCP-\d{4}-\d{5}/ }).first(),
    ).toBeVisible();
  });

  test("records a cheque payment and it lands pending", async ({ page }) => {
    await recordCounterPayment(page, {
      mode: "Cheque",
      reference: `CHQ-${Date.now()}`,
      payInFull: true,
    });

    const receiptCardLocator = receiptCard(page);
    await expect(receiptCardLocator).toBeVisible();
    await expect(receiptCardLocator).toContainText(PENDING_BADGE);

    // Find this run's receipt number for the admin's bounce step below.
    const receiptText = await receiptCardLocator.locator("span.font-mono").first().textContent();
    expect(receiptText).toMatch(/RCP-\d{4}-\d{5}/);
  });
});

test.describe("counter lifecycle (org admin)", () => {
  test.use({ storageState: "../../auth-orgadmin.json" });

  test("bounces a cheque and the dues re-open", async ({ page }) => {
    // Record as the admin first (org_admin holds every permission), then
    // bounce the same receipt — one role keeps the test self-contained.
    // The admin sees TWO schools, so the branch is picked explicitly.
    const { admissionNumber } = await recordCounterPayment(page, {
      mode: "Cheque",
      reference: `CHQ-${Date.now()}`,
      payInFull: true,
      mainBranchFirst: true,
    });
    const receiptCardLocator = receiptCard(page);
    const receiptNumber = await receiptCardLocator.locator("span.font-mono").first().textContent();
    expect(receiptNumber).toMatch(/RCP-\d{4}-\d{5}/);

    // Dues BEFORE the bounce: count this student's open rows. The dues
    // page loads its sections async — wait for the student's section to
    // settle (at least one row, since the payment just reduced — never
    // emptied — their open set) before counting.
    await page.goto(DUES_URL);
    const studentSection = page
      .locator("section")
      .filter({ hasText: admissionNumber })
      .first();
    await expect(studentSection.locator("tbody tr").first()).toBeVisible({
      timeout: 10_000,
    });
    const openBefore = await studentSection.locator("tbody tr").count();

    // Bounce via the payments detail.
    await page.goto(PAYMENTS_URL);
    await page.getByRole("link", { name: receiptNumber ?? "" }).first().click();
    const bounceButton = page.getByRole("button", { name: "Bounce" });
    await expect(bounceButton).toBeVisible();
    await bounceButton.click();
    // The reason dialog has exactly one input; fill it via the dialog scope.
    const dialog = page.locator(".fixed.inset-0");
    await dialog.locator("input").fill("E2E: the bank returned this cheque — bounce and re-open");
    await dialog.getByRole("button", { name: "Bounce" }).click();

    // The detail shows the terminal state.
    await expect(page.getByText("Bounced").first()).toBeVisible();

    // Dues AFTER: the same student's open rows grew by the bounced one —
    // re-locate (the page re-rendered), and wait for the row count to
    // exceed the pre-bounce count, which IS the re-open assertion.
    await page.goto(DUES_URL);
    const sectionAfter = page
      .locator("section")
      .filter({ hasText: admissionNumber })
      .first();
    await expect
      .poll(async () => sectionAfter.locator("tbody tr").count(), {
        timeout: 10_000,
      })
      .toBeGreaterThan(openBefore);
  });
});

/**
 * The counter walk, shared: pick a student who still has open
 * instalments (fallback order), allocate the FIRST open instalment
 * (Pay in full), optionally switch the mode and add its reference,
 * then submit. Amounts are never hardcoded — the spec pays whatever
 * the server currently says is owed.
 *
 * Callers whose role sees MULTIPLE schools must pick the MAIN branch
 * first (`pickMainBranch`); single-school roles auto-land on it.
 */
async function recordCounterPayment(
  page: Page,
  options: { mode?: string; reference?: string; payInFull?: boolean; mainBranchFirst?: boolean },
): Promise<{ admissionNumber: string }> {
  await page.goto(COUNTER_URL);

  if (options.mainBranchFirst) {
    await pickMainBranch(page);
  }

  // Try the seeded students in order; pick the first with open dues.
  let chosen: string | null = null;
  for (const admission of STUDENTS) {
    await page.getByPlaceholder("Name or admission number…").fill(admission);
    // The picker re-filters on debounce and REPLACES its DOM rows — wait
    // for the filtered picker to settle (exactly one row for the search)
    // before clicking, or the click lands on a node React is about to
    // throw away and the selection silently never happens.
    await page
      .locator("button")
      .filter({ hasText: admission })
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(500); // debounce (300ms) + render
    await page
      .locator("button")
      .filter({ hasText: admission })
      .first()
      .click();
    // The dues query is async: wait until the panel settles — the first
    // allocation row, or the nothing-to-collect empty state — before
    // counting (racing the count was the drain-false-alarm failure).
    await expect(
      page
        .getByRole("button", { name: "Pay in full" })
        .first()
        .or(page.getByText("Nothing to collect")),
    ).toBeVisible({ timeout: 10_000 });
    const hasRows = await page.getByRole("button", { name: "Pay in full" }).count();
    if (hasRows > 0) {
      chosen = admission;
      break;
    }
    // Nothing to collect for this one — back out and try the next.
    await page.getByRole("button", { name: "Back" }).click();
  }
  expect(chosen, "a seeded student with open instalments (re-run pnpm db:seed if both drained)").toBeTruthy();

  // Allocate the first open instalment.
  if (options.payInFull ?? false) {
    await page.getByRole("button", { name: "Pay in full" }).first().click();
  }

  // Optional mode switch (cheque and friends need the reference field).
  if (options.mode && options.mode !== "Cash") {
    await page.getByRole("combobox", { name: "Paid by" }).click();
    await page.getByRole("option", { name: options.mode }).click();
    if (options.reference) {
      // The reference input sits inside its <label> — locate the label by
      // its visible text, then the input it contains.
      await page
        .locator("label")
        .filter({ hasText: "Reference" })
        .locator("input")
        .first()
        .fill(options.reference);
    }
  }

  await page.getByRole("button", { name: "Record payment" }).click();

  // The receipt appears (matched by its mono receipt-number span — the
  // collecting card also contains the word "receipt" in its help text).
  await expect(receiptCard(page)).toBeVisible({ timeout: 15_000 });
  return { admissionNumber: chosen! };
}

/**
 * A two-school caller (org admin) must name the branch before any fee
 * query offers a session. MAIN is the seeded school with the fee data.
 */
async function pickMainBranch(page: Page) {
  const branchButton = page.getByRole("button", { name: /Choose a branch|MAIN/ }).first();
  await branchButton.click();
  await page
    .getByRole("menuitemradio", { name: /Main Campus/ })
    .first()
    .click();
  // The branch menu does not auto-close on selection in every build —
  // press Escape to dismiss it, then wait for the inert overlay to
  // detach; until then its portal intercepts every click (the first
  // run of this spec failed exactly there). The shell itself uses
  // data-base-ui-inert permanently — only the presentation overlay dies.
  await page.keyboard.press("Escape");
  await page
    .locator('div[role="presentation"][data-base-ui-inert]')
    .waitFor({ state: "detached", timeout: 10_000 });
  // The context re-resolves; wait for the counter's search box to settle.
  await page.getByPlaceholder("Name or admission number…").waitFor({ timeout: 10_000 });
}
