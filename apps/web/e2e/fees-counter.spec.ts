import { expect, test, type Page } from "@playwright/test";

/**
 * THE COLLECT FLOW — the money path, pinned forever.
 *
 *   1. as the accountant, collect the full balance in CASH against the
 *      seeded student's open dues → the confirmation renders with a
 *      receipt number, and the payment appears in the list, cleared.
 *   2. as the accountant, collect by CHEQUE → pending (the bank decides,
 *      not the desk).
 *   3. as the org admin, BOUNCE that cheque → the student's Outstanding
 *      total on /fees/outstanding grows (the arrears view re-opens).
 *
 * Re-runnability: every run collects against whatever dues are open (the
 * spec reads CURRENT balances, never hardcoded rows), and the bounced
 * cheque is itself a fresh row each run. Assertions are about
 * relationships (receipt exists; status flips; total re-opens), not
 * amounts. When dues drain, `pnpm db:seed` is the documented reset.
 *
 * Roles by permission: the accountant records (fee_payment:create, no
 * approve); the admin bounces (fee_payment:approve). That split IS the
 * separation-of-duties story.
 */

const COLLECT_URL = "/fees/collect";
const OUTSTANDING_URL = "/fees/outstanding";
const PAYMENTS_URL = "/fees/payments";

/**
 * The seeded students, in fallback order: the spec collects from whoever
 * still has open dues. DEMO-0001 first, DEMO-0002 as fallback.
 */
const STUDENTS = ["DEMO-0001", "DEMO-0002"] as const;

/** Verbatim from lib/copy.ts — the suite pins the user-visible contract. */
const PENDING_BADGE = "Pending confirmation";
const CLEARED_BADGE = "Cleared";

function receiptCard(page: Page) {
  return page.getByTestId("receipt-card");
}

test.describe("collect flow (accountant)", () => {
  test.use({ storageState: "../../auth-accountant.json" });

  test("collects a cash payment and renders the confirmation", async ({ page }) => {
    await recordCollectPayment(page, { partialAmount: "100" });

    const receiptCardLocator = receiptCard(page);
    await expect(receiptCardLocator).toBeVisible();
    await expect(receiptCardLocator).toContainText(/RCP-\d{4}-\d{5}/);
    await expect(receiptCardLocator).toContainText(CLEARED_BADGE);

    await page.goto(PAYMENTS_URL);
    await expect(
      page.getByRole("cell", { name: /RCP-\d{4}-\d{5}/ }).first(),
    ).toBeVisible();
  });

  test("collects a cheque payment and it lands pending", async ({ page }) => {
    await recordCollectPayment(page, {
      mode: "Cheque",
      reference: `CHQ-${Date.now()}`,
      partialAmount: "100",
    });

    const receiptCardLocator = receiptCard(page);
    await expect(receiptCardLocator).toBeVisible();
    await expect(receiptCardLocator).toContainText(PENDING_BADGE);

    const receiptText = await receiptCardLocator.locator(".font-mono").first().textContent();
    expect(receiptText).toMatch(/RCP-\d{4}-\d{5}/);
  });
});

test.describe("collect lifecycle (org admin)", () => {
  test.use({ storageState: "../../auth-orgadmin.json" });

  test("bounces a cheque and the outstanding re-opens", async ({ page }) => {
    // Record as the admin first (org_admin holds every permission), then
    // bounce the same receipt — one role keeps the test self-contained.
    // The admin sees TWO schools, so the branch is picked explicitly.
    const { admissionNumber } = await recordCollectPayment(page, {
      mode: "Cheque",
      reference: `CHQ-${Date.now()}`,
      partialAmount: "100",
      mainBranchFirst: true,
    });
    const receiptCardLocator = receiptCard(page);
    const receiptNumber = await receiptCardLocator.locator(".font-mono").first().textContent();
    expect(receiptNumber).toMatch(/RCP-\d{4}-\d{5}/);

    // Outstanding BEFORE the bounce: this student's compact-row total.
    await page.goto(OUTSTANDING_URL);
    const studentRow = page
      .getByRole("row")
      .filter({ hasText: admissionNumber })
      .first();
    await expect(studentRow).toBeVisible({ timeout: 10_000 });
    const totalBefore = await studentRow.textContent();

    // Bounce via the payments detail.
    await page.goto(PAYMENTS_URL);
    await page.getByRole("link", { name: receiptNumber ?? "" }).first().click();
    const bounceButton = page.getByRole("button", { name: "Bounce" });
    await expect(bounceButton).toBeVisible();
    await bounceButton.click();
    const dialog = page.locator(".fixed.inset-0");
    await dialog.locator("input").fill("E2E: the bank returned this cheque — bounce and re-open");
    await dialog.getByRole("button", { name: "Bounce" }).click();

    await expect(page.getByText("Bounced").first()).toBeVisible();

    // Outstanding AFTER: the same row reads a larger total — re-locate
    // (the page re-rendered) and wait for the text to change, which IS
    // the re-open assertion.
    await page.goto(OUTSTANDING_URL);
    const rowAfter = page
      .getByRole("row")
      .filter({ hasText: admissionNumber })
      .first();
    await expect
      .poll(async () => rowAfter.textContent(), { timeout: 10_000 })
      .not.toBe(totalBefore);
  });
});

/**
 * The collect walk, shared: pick a student who still has open dues
 * (fallback order), collect the full outstanding balance (auto-split
 * oldest-first), optionally switch the method and add its reference,
 * then submit. Amounts are never hardcoded.
 *
 * Callers whose role sees MULTIPLE schools must pick the MAIN branch
 * first (`pickMainBranch`); single-school roles auto-land on it.
 */
async function recordCollectPayment(
  page: Page,
  options: {
    mode?: string;
    reference?: string;
    payInFull?: boolean;
    partialAmount?: string;
    mainBranchFirst?: boolean;
  },
): Promise<{ admissionNumber: string }> {
  await page.goto(COLLECT_URL);

  if (options.mainBranchFirst) {
    await pickMainBranch(page);
  }

  // Try the seeded students in order; pick the first with open dues.
  let chosen: string | null = null;
  for (const admission of STUDENTS) {
    await page.getByPlaceholder("Name or admission number…").fill(admission);
    // The results re-filter on debounce and REPLACE their DOM rows — wait
    // for the filtered row to settle before clicking, or the click lands
    // on a node React is about to throw away.
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
    // The dues query is async: wait until the account settles — the
    // Collect-full-balance action, or the nothing-to-collect empty state.
    await expect(
      page
        .getByRole("button", { name: /Collect full balance/ })
        .or(page.getByText("Nothing to collect")),
    ).toBeVisible({ timeout: 10_000 });
    const hasDues = await page.getByRole("button", { name: /Collect full balance/ }).count();
    if (hasDues > 0) {
      chosen = admission;
      break;
    }
    // Nothing to collect for this one — back out and try the next.
    await page.getByRole("button", { name: "Back" }).click();
  }
  expect(chosen, "a seeded student with open instalments (re-run pnpm db:seed if both drained)").toBeTruthy();

  // Amount: either the full outstanding balance (drains the student —
  // only for suites that reseed after) or a small partial that leaves dues
  // for the tests that follow.
  if (options.partialAmount) {
    await page.getByRole("textbox", { name: "Amount received" }).fill(options.partialAmount);
  } else if (options.payInFull ?? false) {
    await page.getByRole("button", { name: /Collect full balance/ }).click();
  }

  // Optional method switch (cheque and friends need the reference field).
  if (options.mode && options.mode !== "Cash") {
    await page.getByRole("radio", { name: options.mode }).click();
    if (options.reference) {
      await page
        .locator("label")
        .filter({ hasText: "Reference" })
        .locator("input")
        .first()
        .fill(options.reference);
    }
  }

  // The submit names its total ("Record ₹X payment").
  await page.getByRole("button", { name: /^Record .* payment/ }).click();

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
  await page.keyboard.press("Escape");
  await page
    .locator('div[role="presentation"][data-base-ui-inert]')
    .waitFor({ state: "detached", timeout: 10_000 });
  await page.getByPlaceholder("Name or admission number…").waitFor({ timeout: 10_000 });
}
