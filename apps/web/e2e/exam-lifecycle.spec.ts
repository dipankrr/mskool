import { expect, test, type Page } from "@playwright/test";

/**
 * THE PRINCIPAL'S JOURNEY (Phase 6a's regression gate) — the test whose
 * absence let "can't even create an exam" ship green through every suite.
 *
 * Everything else tests a layer: the conformance suite proves the router
 * accepts UI-shaped payloads, smoke:authz proves authorization, the
 * integration suite proves the services. This spec proves the PRODUCT:
 * a principal clicks "Add exam", fills the dialog, schedules the papers,
 * enters marks as the subject teacher would see them, walks the lifecycle,
 * and publishes — nothing but the real browser, the real API, the seeded
 * demo world.
 *
 * Fixture notes:
 * - The created exam is a MOCK: the seeded "Term 1 Examination" already
 *   weighs 100 in the term, and the weightage invariant (correctly)
 *   refuses a second counting exam. Mocks never count — that's the guard
 *   working, not a workaround.
 * - Both counted subjects (Mathematics, Physics) must be scheduled or the
 *   coverage gate refuses the `scheduled` transition.
 * - Marks entry covers EVERY roster student × EVERY component — the
 *   verification gate counts rows, not students.
 * - The run leaves its exam behind (hard rule 2); the name is
 *   timestamp-unique so re-runs never collide.
 */

const EXAM_NAME = () => `Journey ${Date.now()}`;
const FAMILY = /families|students/i;

test.describe("exam lifecycle (principal through the browser)", () => {
  test.use({ storageState: "../../auth-principal.json" });

  test("creates an exam in the dialog and walks it to published results", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const examName = EXAM_NAME();
    // Wire truth for the principal's mutating steps (publish especially —
    // its refusals toast once and vanish).
    page.on("response", async (res) => {
      if (/exam\.(publication|exam\.transition|results\.compute)/.test(res.url())) {
        const body = await res.text().catch(() => "");
        if (res.status() !== 200 || body.includes("error")) {
          console.log(`[principal wire] ${res.status()} ${res.url().split("/").pop()} ${body.slice(0, 200)}`);
        }
      }
    });

    // ── 1. The hub: create through the real dialog ──────────────────────
    await page.goto("/exams");
    await page.getByRole("button", { name: "Add exam" }).click();
    // The dialog resets its form when the terms query resolves — fill only
    // after that reset lands, or it wipes what was typed (learned here).
    await expect(
      page.getByRole("dialog", { name: "Add exam" }).locator("#exam-term"),
    ).toBeVisible();
    await page.waitForTimeout(500);
    await page.locator("#exam-name").fill(examName);
    // Term picker (Base UI select — option lookup at page level).
    await page.locator("#exam-term").click();
    await page.getByRole("option", { name: "Term 1" }).click();
    // Type: mock (non-counting — the seeded exam owns the term's 100).
    await page.locator("#exam-type").click();
    await page.getByRole("option", { name: "Mock" }).click();
    // Mocks hide the weightage (they never count) and say so — the honest
    // state, pinned here because hiding fields is where BUG-1 was born.
    await expect(
      page.getByText("Mock and test papers always run but never count toward the term."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("cell", { name: examName })).toBeVisible({
      timeout: 15_000,
    });

    // ── 2. The detail page: schedules for BOTH counted subjects ─────────
    await page.getByRole("link", { name: examName }).click();
    await page.waitForURL(/\/exams\/[0-9a-f-]{36}/);
    // The URL carries the id every later step needs (the teacher context
    // and the post-entry return both navigate by it).
    const examId = page.url().split("/").pop()!;
    await page.getByRole("button", { name: "Edit schedules" }).first().click();
    // Rows are built one at a time: appending re-renders the open popups.
    // Each pick waits for the listbox to actually open — the aggressive
    // re-render can swallow a popup that was never shown.
    const pickSubject = async (row: number, name: string) => {
      await page.waitForTimeout(400);
      await page.locator(`#schedule-subject-${row}`).click();
      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible({ timeout: 10_000 });
      await page.getByRole("option", { name }).click();
    };
    await page.getByRole("dialog").getByRole("button", { name: "Add subject" }).click();
    await pickSubject(0, "Mathematics");
    await page.locator("#schedule-date-0").fill("2025-09-10");
    await page.locator("#schedule-start-0").fill("09:00");
    await page.getByRole("dialog").getByRole("button", { name: "Add subject" }).click();
    await pickSubject(1, "Physics");
    await page.locator("#schedule-date-1").fill("2025-09-12");
    await page.locator("#schedule-start-1").fill("09:00");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("button", { name: "Add component" }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── 3. Components on the Mathematics paper ──────────────────────────
    // The row button opens the ComponentsDialog; the dialog's own append
    // button shares the label, so the appends are scoped to the dialog.
    await page.getByRole("button", { name: "Add component" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Add component" }).click();
    await page.locator("#component-name-0").fill("Theory");
    await page.locator("#component-max-0").fill("80");
    await page.locator("#component-pass-0").fill("27");
    await page.locator("#component-weight-0").fill("80");
    await page.getByRole("dialog").getByRole("button", { name: "Add component" }).click();
    await page.locator("#component-name-1").fill("Internal");
    await page.locator("#component-max-1").fill("20");
    await page.locator("#component-pass-1").fill("7");
    await page.locator("#component-weight-1").fill("20");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

    // ── 3b. Components on the Physics paper (BUG-10: a componentless
    // paper passed verification trivially and then blocked publish).
    // Wait for the post-save refetch to land first — in the stale render
    // the MATH row's button still reads "Add component", and clicking it
    // re-opens the wrong editor. Then the click is scoped to the Physics
    // ROW, so no ordering assumption can misfire.
    await expect(
      page.getByRole("button", { name: "2 components" }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole("row", { name: /Physics/ })
      .getByRole("button", { name: "Add component" })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Add component" }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("dialog").getByRole("button", { name: "Add component" }).click();
    await page.locator("#component-name-0").fill("Theory");
    await page.locator("#component-max-0").fill("100");
    await page.locator("#component-pass-0").fill("40");
    await page.locator("#component-weight-0").fill("100");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

    // ── 4. The lifecycle: schedule → ongoing → marks entry ──────────────
    const transition = async (label: string) => {
      await page.getByRole("button", { name: label, exact: true }).click();
      // The ConfirmDialog's confirm repeats the verb.
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: label, exact: true })
        .click();
      await page.waitForTimeout(1500);
    };
    await transition("Schedule exam");
    await transition("Mark ongoing");
    await transition("Open marks entry");

    // ── 5. Marks entry AS THE SUBJECT TEACHER ───────────────────────────
    // marks:create belongs to the teacher (ADR-029's subject gate — the
    // smoke proves the principal is refused). A fresh context carries the
    // teacher's storage state for this leg; the principal's page stays
    // open for the publish that follows.
    const teacherContext = await browser.newContext({
      storageState: "../../auth-subjectteacher.json",
    });
    const teacherPage = await teacherContext.newPage();
    // Ground truth for the save leg: the wire, not the UI. The "Saved"
    // cell markers are transient (the invalidation refetch resets them),
    // so the proof is the count of 200 responses.
    let savedOnWire = 0;
    teacherPage.on("response", async (res) => {
      if (res.url().includes("exam.marks.save") && res.status() === 200) {
        savedOnWire++;
      }
    });
    await teacherPage.goto(`/exams/${examId}/entry`);
    await teacherPage.waitForURL(/\/entry/, { timeout: 15_000 });
    // Class-wide paper: the grid waits for the section pick (the gate's
    // fact) — wait for the picker to appear, then choose. Section-scoped
    // papers render no picker; the wait times out harmlessly.
    const sectionTrigger = teacherPage.locator('[aria-label="Section"]');
    await sectionTrigger.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    if (await sectionTrigger.isVisible()) {
      await sectionTrigger.click();
      await teacherPage.getByRole("option", { name: "A", exact: true }).click();
    }
    // The grid renders after the roster loads — wait for the first cell.
    await expect(teacherPage.locator('input[type="number"]').first()).toBeVisible({
      timeout: 20_000,
    });
    // Desktop table AND mobile card copies exist; visible inputs only.
    const cells = teacherPage.locator('input[type="number"]:visible');
    const count = await cells.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < count; i++) {
      await cells.nth(i).fill(i % 2 === 0 ? "72" : "16");
      await cells.nth(i).blur();
    }
    // EVERY cell must land on the wire before switching papers — the
    // autosave is debounced, and navigating away aborts in-flight saves.
    await expect
      .poll(() => savedOnWire, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(count);
    await teacherPage.waitForTimeout(1500);

    // The SECOND paper (Physics): switch the picker, enter its cells. The
    // verification gate counts every scheduled paper's entries. Switching
    // papers resets the section pick (the grid's gate fact), so it is
    // re-picked — same wait as the first paper.
    const pickSection = async () => {
      const trigger = teacherPage.locator('[aria-label="Section"]');
      await trigger.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      if (await trigger.isVisible()) {
        await trigger.click();
        await teacherPage.getByRole("option", { name: "A", exact: true }).click();
      }
    };
    const paperTrigger = teacherPage.locator('[aria-label="Paper"]');
    await paperTrigger.click();
    await teacherPage
      .getByRole("option", { name: /Physics/ })
      .click();
    await pickSection();
    await expect(teacherPage.locator('input[type="number"]:visible').first()).toBeVisible({
      timeout: 20_000,
    });
    const physicsCells = teacherPage.locator('input[type="number"]:visible');
    const physicsCount = await physicsCells.count();
    expect(physicsCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < physicsCount; i++) {
      await physicsCells.nth(i).fill("55");
      await physicsCells.nth(i).blur();
    }
    await expect
      .poll(() => savedOnWire, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(count + physicsCount);
    await teacherPage.waitForTimeout(1500);
    await teacherContext.close();

    // ── 6. Back on the principal's page: verification, then publish ─────
    await page.goto(`/exams/${examId}`);
    // The readiness checklist must show every entry landed before the
    // verification transition is attempted (it refuses partial entry).
    // 2 students × (2 Math + 1 Physics components) = 6 expected.
    await expect(page.getByText(/Entries: 6\/6/)).toBeVisible({ timeout: 30_000 });
    await transition("Start verification");
    // The readiness panel: publish THIS class. The ConfirmDialog is waited
    // for BEFORE its confirm is clicked — the transition's re-render can
    // swallow a click that arrives too early (the run-31 race).
    await page.getByRole("button", { name: "Publish this class" }).click();
    const confirmButton = page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Publish this class" });
    await expect(confirmButton).toBeVisible({ timeout: 15_000 });
    await confirmButton.click();
    // The exam's header now reads "<term> · Published" — the status the
    // whole journey was walking toward.
    await expect(page.getByText(/· Published$/)).toBeVisible({
      timeout: 60_000,
    });
  });

  // Silence the unused lint while keeping the type import for future flows.
  void FAMILY;
});
