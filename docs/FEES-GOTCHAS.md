# Fees — gotchas and bugs found

Read this before changing the fee system. Each entry is something that
bit us (or nearly did), why it happens, and the rule that prevents it.
Bugs are listed with the commit that fixed them; open ones say so.

Related: `docs/DOMAIN.md` §5 (the flow), `docs/DECISIONS.md` ADR-009,
ADR-049, ADR-050, `docs/FEES-BACKEND-NEEDS.md` (missing endpoints),
`.kilo/plans/2026-10-26-mobile-fees.md` (gap list),
`.kilo/plans/2026-10-26-fees-simplification.md` (the redesign).

## Money and maths

- **Never use floats for money.** Amounts are `numeric(10,2)` strings on
  the wire; the server works in integer paise (`toCents`/`fromCents`), the
  mobile app in `bigint` paise (`lib/money.ts`). `parseFloat` is a bug.
- **A period's price never depends on when the student joined (ADR-050).**
  Shares are computed over the whole year, then only the attended periods
  are billed. *Bug fixed in `30e1107`:* a student joining in October paid
  the year's ₹12,000 tuition as ₹2,000 a month for six months while
  classmates paid ₹1,000; quarterly, half-yearly and term lines and
  percentage concessions were compressed the same way. The old unit tests
  *asserted* the compression ("still sums exactly") — a passing test can
  encode a wrong rule.
- **One loader decides what a student owes:** `feesBillingService.lineSplits`.
  The billed base (`base_annual_amount`), the concession budget per head and
  head-scoped percentage concessions all read through it. Computing any of
  these from `fee_structure_lines.annual_amount` directly reintroduces the
  joiner bug.
- **Concession shares are spread over ALL of a student's buckets**, then
  installments are written. Generating a subset (month by month) must still
  compute shares over the full set and write only the subset, or a
  concession piles onto the first months.
- **Late fees are computed by the server at payment time and frozen** on the
  payment. The client can only say "late fee applies"; there is no preview
  endpoint.

## The generator

- **It is insert-only (`ON CONFLICT DO NOTHING` on assignment, head,
  installment number).** It never rewrites an existing installment. So a
  rule change (like ADR-050) does not fix rows already generated: they need
  a reviewed one-off correction. Dev data was corrected by deleting an
  unpaid student's rows and re-billing.
- **`installment_number` counts the student's own buckets from 1.** Do not
  renumber by position in the year: an assignment generated earlier would
  then get a *second* set of rows on the next run, because the conflict key
  no longer matches.
- **Buckets come out in date order**, so "generate up to month X" is a
  prefix of the full set and numbers stay stable as later months are added.
  Keep it that way.
- **Upfront/annual lines are one-time charges** (admission, annual fee) and
  are billed whole whenever the student joins, due on the effective date.

## Month-by-month generation (ADR-051)

- **The mode changes timing, never amounts.** Shares are computed over the
  student's full set of buckets, then filtered by the cut-off. Filtering
  before computing shares would pile concessions onto the first months.
- **Every generator call without `through` follows the school's mode**:
  billing, "Bill all students" and "Add missing dues" alike. Pass `"all"` to
  force the whole session.
- **The cut-off uses the server's date**, not the device's.
- **The automatic sweep is off unless `FEES_WORKER_DISABLED=false`**, like the
  homework sweeper; test suites drive `runMonthlySweep` directly.
- **A sweep killed mid-run leaves its Redis lease** (`lock:fees-monthly-sweep`)
  for up to 10 minutes; every run until then reports "skipped". Harmless in
  production (the next hourly run proceeds), but a test that runs the sweep
  must clear the key first, or it silently tests nothing.
- **The sweep is database-wide.** A test that switches its school to
  `monthly_auto` and is then killed (a timeout skips its `finally`) leaves
  that school in monthly_auto, and every later sweep processes it too. Tests
  pass `runMonthlySweep({ schoolIds })`. Leftover fixture schools were reset
  by hand on 2026-10-26.
- **`generateThrough` is one transaction per student, run in sequence.** Over
  a remote database a large school takes a while (the integration tests
  needed a longer timeout). Fine for an hourly sweep or a button press; batch
  it before running it inside a request for thousands of students.
- **In monthly schools the bill and the written dues differ.**
  `base_annual_amount` is the session; the matrix only sees written dues. The
  student page shows the gap as "₹X more will be billed as the months
  arrive".

## Ledger (ADR-009, ADR-049)

- **`financial_transactions` is append-only** (a database trigger refuses
  updates/deletes). Corrections are new offsetting rows, never edits.
- **`direction` is not cash.** Opening balances, concessions and waivers are
  rows that change what is *owed*. Use `cashEffect` (`in`/`out`/`none`) for
  money-in/money-out totals.
- **A refund's ledger row references the `fee_refunds` row, not the
  payment** (`referenceTable = "fee_refunds"`); it carries the payment's
  receipt number. A reversal also writes `fee_refund` but references the
  payment. *Bug fixed in `59861cc`:* the payment screen matched refunds on
  `referenceId === paymentId`, found none, never showed refunds and always
  offered the full amount as refundable.
- **Cancelling a pending payment posts `payment_cancelled` offsets**
  (migration 0031). Before that, a cancelled payment stayed in "money in".
- **Opening balances are paid through the ledger link**, not
  `payment_allocations` (its `installment_id` is NOT NULL).

## Permissions

- **Only the principal (and org admins) hold `fee_payment:approve`** by
  default; the vice-principal and accountant do not. The accountant can
  collect and refund but cannot clear, cancel, bounce or reverse. *Bug
  fixed in `d8b3bf5`:* the accountant saw "This payment is closed" on a
  pending payment; open payments now say who can act on them.
- **The fee tab is gated on `fee_report:read` or
  `student_fee_assignment:read`**; `fee_payment:read` alone has no
  student-bearing read and would open onto a denial.

## Sessions and dates

- **A closed session is read-only only in the app.** The fee services do not
  check `academic_years.status`, so the server still accepts collections,
  billing and concessions in a closed year. *Open.*
- **Demo data must sit in a current session.** With the seed's 2025-26 in
  October 2026 every due was overdue and late fees fired on every payment,
  which hid the month-by-month problems. Seed with
  `pnpm db:seed -- --current-session` (the default stays 2025-26 for the
  authz smoke and web e2e).
- **"Collected" has two honest readings** (fees only, or all cash with late
  fees). The app shows a per-device switch rather than picking one.

## Mobile

- **Amount inputs must stop at two decimals** (`sanitizeAmountInput`);
  `parseMoney` rejects a third decimal and the value would silently vanish.
- **Format money with `formatMoney`** everywhere a person reads it: whole
  rupees print as ₹5,000, paise keep both digits (₹49.50). A raw wire
  string ("400.00") in a notice is a bug.
- **`FormSheet` needs keyboard avoidance on Android** (`behavior="padding"`);
  a translucent-status-bar modal is not resized by `adjustResize`.
- **A dead stored session must go to sign-in**, not a Retry: an
  `UNAUTHORIZED` from `me.get` discards the session (`5404228`).
- **Device walks with `adb shell input text`:** if the target field is not
  focused, keystrokes reach the React Native dev menu — "r" reloads the app.
  Tap the field and confirm focus before typing.

## Open

- Server does not refuse fee writes in a closed session (above).
- `installment.dues` has no student name join.
- No receipt PDF, no late-fee preview.
- Existing pre-ADR-050 joiner rows in any non-dev database need a reviewed
  correction.
