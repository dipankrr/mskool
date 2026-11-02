# Fees — gotchas and bugs found

Read this before changing the fee system. Each entry is something that
bit us (or nearly did), why it happens, and the rule that prevents it.

Related: `docs/DOMAIN.md` §5 (the flow), `docs/DECISIONS.md` ADR-058 (the
current model), ADR-009 and ADR-049 (ledger and collection),
`.kilo/plans/2026-11-01-fees-overhaul.md` (every issue, decision and defer).

## Money and maths

- **Never use floats for money.** Amounts are `numeric(10,2)` strings on
  the wire; the server works in integer paise (`toCents`/`fromCents`), the
  mobile app in `bigint` paise (`lib/money.ts`). `parseFloat` is a bug.
- **Prices come from `fee_line_periods`, never from a division.** There is no
  yearly amount any more. A year total is the sum of the rows.
- **A due's identity is `period_key`** (`2026-11`, `q:2026-10`, `term:<id>`,
  `once`). A row number would skip or duplicate dues when months or frequency
  change, and that bug class is why the key exists.
- **A created due never changes.** Structure edits only reach dues not yet
  created. A rule change does not fix rows already written.
- **Concessions record `coveredPeriods` when created.** Spreading over "dues
  that exist now" drifted as new months arrived. *Proved in tests:* the old code
  turned a ₹1,000 concession into ₹1,600.
- **A late fee is charged once on a due.** Each part payment used to charge it
  again (₹300 in place of ₹100). `allocations.late_fee_amount` records what a
  payment charged, so a bounce undoes exactly that.
- **The rule is the one in effect when the due fell due** (`pickLateFeeRule`),
  not the one in effect today.
- **Discount is not cash.** It sits in `discount_amount`, reduces the net and
  writes a non-cash ledger row. An allocation can now be ₹0 cash with a discount,
  which is why its check is `>= 0`.
- **The amount box is fees, not cash handed over.** The late fee goes on top,
  because which dues the amount reaches decides the late fee. The bottom bar is
  the full amount.

## Creating dues

- **Timing never changes an amount, but a paused school reads low.** While
  automatic is paused, dues nobody added don't exist, so "Due now" is too small.
  That's why the dashboard shows a card while any are waiting.
- **A period key must match what the schedule generates.** *Bug found on the walk:*
  0039 keyed old one-time dues `n:1`, a one-time line's period is `once`, and the
  next sweep created every such fee a second time (₹5,000 extra on two demo
  students). Any key change needs a check that a re-run inserts nothing.
- **The sweep bills too.** With `pnpm dev` the worker is on, so it bills unbilled
  admissions of any started structure, across every school in that database. Use
  `FEES_WORKER_DISABLED=true` if you're checking fixed numbers.
- **"Create remaining months" freezes those months.** A created due never changes,
  so a fee increase afterwards won't reach them.
- **`billingStartedAt` must be stamped before billing.** Otherwise a first due
  isn't moved up to Start billing and turns late the moment it's created.
- **Only move a due date up once a structure has started.** Flooring dates to
  today on an unstarted structure gave wrong dates.
- **The sweep is on by default.** `FEES_WORKER_DISABLED=true` is for local walks.
  It covers all open sessions, bills unbilled admissions, reports failures and
  shows in `/health` as `feesSweeper`.
- **A sweep killed mid-run leaves its Redis lease** (`lock:fees-monthly-sweep`)
  for up to 10 minutes; every run until then reports "skipped". A test that runs
  the sweep must clear the key first, or it silently tests nothing.
- **The sweep is database-wide.** Tests pass `runMonthlySweep({ schoolIds })`.
- **`generateThrough` is one transaction per student, in sequence.** Fine for an
  hourly job; batch it before running it inside a request for thousands.

## Ledger (ADR-009, ADR-049)

- **`financial_transactions` is append-only** (a database trigger refuses
  updates/deletes). Corrections are new offsetting rows, never edits.
- **`direction` is not cash.** Opening balances, concessions, waivers and
  discounts change what is *owed*. Use `cashEffect` (`in`/`out`/`none`).
- **A refund's ledger row references the `fee_refunds` row, not the payment.**
  A reversal also writes `fee_refund` but references the payment.
- **A bounce is refused after a refund**, and a refund can include late fee
  (`refundPosition`).
- **A receipt keeps its full amount for ever.** "Paid so far" can be lower than
  the receipts add up to, so the student page shows a Refunded chip on the row.
- **Opening balances are paid through the ledger link**, not
  `payment_allocations`.
- **Assert all three agree.** `assertAgreement` in
  `fees-overhaul.integration.test.ts` compares dues, payments and ledger. Use it
  in any new money test.

## Permissions

- **Only the principal (and org admins) hold `fee_payment:approve`** by default.
  The accountant can collect and refund but can't clear, cancel, bounce or reverse.
- **Refunds go by `fee_refund:create`.** There is no approval step.
- **The fee tab is gated on `fee_report:read` or
  `student_fee_assignment:read`**; `fee_payment:read` alone has no student-bearing
  read and would open onto a denial.

## Sessions and dates

- **All fee dates are IST** (`todayInIst`).
- **Money dates are checked after the locks** (`assertMoneyDate`), so the date
  check and the write see the same row.
- **Previous dues from an earlier session don't close that session's dues.**
  Until promotion ships, staff must not collect both.
- **Demo data must sit in a current session.** With the seed's 2025-26 in October
  2026 every due was overdue and late fees fired on every payment. Seed with
  `pnpm db:seed -- --current-session`.
- **A "Pending" UPI in old demo data is not current behaviour.** UPI and card
  clear immediately now.

## Mobile

- **A money screen must not carry on past a failed read.** *Bug found on the
  device walk:* if the previous-dues read failed, collect prefilled without them
  and quoted ₹13,800 instead of ₹18,300, and Retry refetched only the dues. A
  read counts as settled only on success, and Retry refetches whatever failed.
- **A student can owe with no fee record**, through previous dues. A row must not
  print "Not billed" with no amount, and "of N" must count them, or it reads "3/2".
- **Same-date dues need a fixed order** (`oldestFirst`: date, then name). A month's
  fees share a due date, and the order decides where a part payment lands.
- **Amount inputs must stop at two decimals** (`sanitizeAmountInput`);
  `parseMoney` rejects a third decimal and the value would silently vanish.
- **Format money with `formatMoney`** and dates with `formatReadableDate` wherever
  a person reads them. A raw wire string ("400.00", "2026-04-01") is a bug.
- **Invalidate `utils.fees.dashboard`** with any mutation that moves money or dues,
  or the dashboard shows old figures.
- **`FormSheet` needs keyboard avoidance on Android** (`behavior="padding"`).
- **A dead stored session must go to sign-in**, not a Retry.
- **Device walks with `adb shell input text`:** if the target field is not
  focused, keystrokes reach the React Native dev menu — "r" reloads the app.
- **Git Bash rewrites `/sdcard` in adb arguments** unless `MSYS_NO_PATHCONV=1` is
  set. The emulator's screenshots can also freeze while the app runs on: if the
  clock stops, trust `uiautomator dump` and cycle the screen.

## OpenAPI

- **A REST input can't repeat `id` inside `data`.** The generator crashes at
  startup with `Unrecognized key: "id"`. Keep `id` at the top level.
- **List inputs don't fit a REST body.** `payment.quote` has no OpenAPI meta for
  that reason. Paging inputs use `z.coerce.number()`.

## Open

- Promotion and carry-forward, gateway, receipt PDF, CSV import, class-wide
  one-off charges, web parity: section 7 of the overhaul plan.
