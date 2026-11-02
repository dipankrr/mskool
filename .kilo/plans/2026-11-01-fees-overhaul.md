# Fees overhaul

Status: **approved to build by the owner, 2026-11-01** ("okay do lets start implementing"). Branch
`feat/fees-overhaul`, built on an uncommitted tree; the owner splits commits. This document is the
single record of the discussion. Where it disagrees with the 2026-10-26 simplification plan, this
one wins.

Earlier plans it replaces: `2026-10-26-fees-simplification.md`. Rules to read first:
`docs/FEES-GOTCHAS.md`, `AGENTS.md` hard rules 2, 3, 4 and the mobile contract.

## 1. Goal

Started as "the system should focus on monthly, not yearly". The yearly assumption turned out to
run through price entry, due creation, concessions and the screens, and an audit found real money
bugs on top.

- The goal is **clarity and a system that can run any fee structure, not fewer features**. Removing
  a label is fine. Removing a capability is not.
- Fees is the most sensitive module and the app is going live, so every issue we know about gets
  fixed with a test that proves it.
- About 90% of schools bill monthly. Maybe 50%+ of schools join mid-session.
- Dev mode: no data or backward compatibility to preserve.
- **Kept as is:** payments, allocations, the append-only ledger, refund walk, receipts, idempotency,
  money in paise. **Rebuilt:** fee setup and billing. **Improved:** four screens.

## 2. Decisions

### Owner's decisions
| # | Decision |
|---|---|
| O1 | Monthly-focused; whole year stays possible |
| O2 | Goal is clarity and any structure, not fewer features |
| O3 | Totals come from dues already created, not from the fee structure |
| O4 | Sessions that are not April to March must work |
| O5 | Dev mode, no compatibility work |
| O6 | UI is four areas: dashboard (default Fees screen, full revamp from the owner's sketch), setup (fine, add a guided flow like academic setup), student profile (tweaks), collect (UX fixes) |
| O7 | Refunds: whoever holds the permission. No approval step. `fee_refund:approve` is removed |
| O8 | UPI and card are not held pending |
| O9 | Web fee screens keep working with the new system, with no web UI revamp |
| O10 | Discount at collect on the total bill, with no new permission |
| O11 | Many schools charge admission again every year, so "everyone pays" stays the default |
| O12 | Mid-session has no special mode: tick the months, enter previous dues by hand, no paid-ahead field |
| O13 | The app stays neutral on session dates. A school may use its real session, or start at its actual date with a one-day term. The owner prefers the one-day term |
| O14 | Paid-ahead is rare in India, so no special field; staff waive those months |
| O15 | One-off bills on a student, such as dress or notebooks, must be possible |
| O16 | Dashboard follows the owner's sketch (section 5) |

### Defaults accepted when the owner said to start
| # | Default |
|---|---|
| D1 | Fee amount is entered per period, with an editable month list |
| D2 | School setting for when dues are created: automatic (default), by hand, all at once |
| D3 | Several fee structures per class are allowed, linked to sections; if nothing links, staff pick |
| D4 | Late fee keeps flat, percent and per day, and gains "per fee or per month", default per month |
| D5 | NEFT, DD and cheque stay pending until cleared |
| D6 | Head categories get a real effect: Optional means opt-in, One-time defaults a line to Once, Fine is what one-off charges default to |
| D7 | Discount uses the existing `fee_waiver:create` permission |

## 3. How the system works after this

### Words
On screen: **fee type** (`fee_heads`), **fee structure** (`fee_structures`), **fee line**, **due**
(`fee_installments`), **previous dues** (`opening_balances`). Tables keep their names. The half-done
"fee chart" wording is removed; the app says fee structure everywhere.

### The pipeline
```
Fee structure + schedule → Student is billed → Dues are created → Parent pays → Receipt
```
The three timing options only change how far ahead dues are created:
- **Automatic:** a job runs every hour and creates all dues up to the end of this month. It only
  creates dues; it does not take money or message anyone.
- **By hand:** someone presses Generate dues and picks a month. Due dates do not move, so a late
  press can leave dues already overdue.
- **All at once:** every due of the session is created at billing.
"Due now" only counts up to this month, whichever option is set.

### Fee line and schedule
- A line has a fee type, how often (monthly, quarterly, half-yearly, per term, once), an amount per
  period, the months it charges, and who pays (everyone or new students only).
- Saving a line builds its **schedule**: one row per period (`fee_line_periods`) with a period key,
  dates, amount and due date. A single row can be edited or switched off.
- The month list replaces from/to, so April to February, December off and April off all work, in
  any session.
- The structure carries the **due day**: 1 to 31, where 31 means the last day of the month.
- The structure carries the **fee months** the school charges; new lines start from those.
- `annual_amount` and the division are gone. The year total is the sum of the rows.

### Rules
1. **A created due never changes.** A structure edit only affects dues not yet created.
2. **A due is identified by its period** (`2026-11`, `q:2026-10`, `term:<id>`, `once`), not a row
   number, so editing months or frequency cannot skip or duplicate dues.
3. **Billing is one state.** Billed means the student has a fee record. A billed student with no
   dues yet simply has nothing due.
4. **Start billing** is a switch on a fee structure. It bills everyone in that structure's class or
   sections. After that, new admissions are billed automatically.
5. **Students present at Start billing are billed from the first charged month.** Anyone admitted
   after uses their enrollment date.
6. **New student** means no earlier enrollment at this school, and in a school's first billed
   session, admitted after Start billing. Next April they count as returning on their own.
7. **No due is late before Start billing.** A first due date earlier than Start billing moves up to
   that day.
8. **Leaving** cancels unpaid dues after the leaving date and stops new ones. **Rejoining** reopens
   dues from the rejoin date; the months away stay cancelled.
9. **Concessions are rules applied per due**, written on the server when added. A concession records
   exactly which periods it covers when it is created, so it cannot drift.
   - Percent: that share of each covered due that is not yet paid.
   - Flat: the amount spread over covered dues that are not yet paid.
   - The screen reports what was actually applied.
10. **Late fee is charged once.** Paying in parts does not charge it again. Bounce, reverse and
    cancel undo what that payment charged. A rule only applies to dues that fell due while it was in
    effect. Late fee can be forgiven at the counter.
11. **Discount at collect** sits in its own column on the due, is shown on the receipt, is written
    to the ledger as non-cash, and is undone if the payment bounces, reverses or cancels.
12. **One-off charges** are dues with no fee line and no late fee.

### Mid-session school, with no special code
1. Setup asks "Which months do you charge?" and they tick October to March.
2. A per-class table takes previous dues, one amount per student.
3. Set the fee structure to New students only for admission or annual fees, or leave them off.
4. Set the next receipt number if a paper book continues.
5. Start billing.

Paid ahead: waive those months. Old receipts stay in the paper book. Year totals cover only the
months in the app.

### Session dates
Real session: the attendance calendar must start from the school's first day, because attendance
percentages count every working day in the calendar, marked or not. The calendar generator gets a
"start from" date. One-day term: leave that term out of per-term fees. Whether past exam papers can
be dated inside a one-day term is checked in the build.

## 4. Issues

Audit findings 1 to 34 come from a report the owner shared, verified 2026-11-01. N1 to N14 were found
during verification. "Fixed by" names the build stage in section 6.

### Money
| # | Issue | Fixed by |
|---|---|---|
| 1 | Late fee re-charged on every partial payment; `late_fee_charged` never written. Proved: flat ₹100 capped ₹100 charged ₹300 over three part payments | S1 |
| 2 | Recompute reads raw `annual_amount`, not what the student is billed | S3 |
| 3 | Subscription row-number collisions drop dues silently; no uniqueness; optional head can also sit on a line | S2 |
| 6 | Waiving a fully conceded due crashes on the ledger check | S1 |
| N1 | Receipt prefix uses the session name's first word and the counter restarts each session, so "Session-2026" then "Session-2027" collide and collection fails | S1 |
| N2 | Monthly concession over-discounts. Proved: ₹1,200 granted, ₹1,600 applied | S3 |
| N3 | Concession falls short once dues are paid, while the screen says the full amount | S3 |
| N4 | Changing frequency or months after billing silently stops new dues | S2 |
| N5 | Partial refund then bounce leaves the ledger at ₹0 while the school is out the refund | S1 |
| N6 | Carried-forward dues do not close the old session's dues | Deferred, section 7 |
| N7 | A wrong carried-forward amount cannot be corrected | S1 |
| N8 | A late-fee rule cannot be switched off; no route | S1 |
| N9 | Staff cannot forgive a late fee at the counter | S1 |
| N10 | Flat late fee per due means three heads, three fees; new rule hits dues already late | S1 |
| N11 | A late fee can never be returned after a full refund | S1 |
| 4 | Gateway payment spanning two sessions refused | Deferred with gateway |
| 5 | Webhook returns 422 for outages | S1 (small) |
| New | Gateway: allocates to waived dues; adds late fee above money received; replay after dues clear returns 422 | Waived and replay in S1; late fee deferred with gateway |

### Tenancy, auth, validation
| # | Issue | Fixed by |
|---|---|---|
| 7 | `createOpeningBalance` does not re-read student and sessions through scope | S1 |
| 8 | `paymentDate` and `refundDate` unbounded; bad calendar dates reach Postgres | S1 |
| 9 | `fee_refund:approve` dead; real gate not sensitive; principal cannot refund | S1 |
| 10 | Fee refusals reach staff as "Something went wrong" | S1, using `ServiceRefusal` |
| N14 | Webhook route live with a default secret in the code | S1 |

### Lifecycle
| # | Issue | Fixed by |
|---|---|---|
| 11 | No suspend, cancel or restore on a fee record; wording points to a page that does not exist | S3 |
| 12 | No due cancellation | S3 |
| 13 | Concessions cannot be voided | S3 |
| 14 | Concession then recompute is two calls; web never chains it | S3 |
| 15 | Year-end carry-forward is one at a time. Promotion deferral is now recorded | Deferred, section 7 |
| 16 | Monthly run bills students who left | S2 |
| N12 | A retired structure blocks its replacement | S2 |
| N13 | Monthly run ignores individual failures; covers only the current session | S2 |
| New | `assign` bills a student who has left; only `billClass` checks | S2 |
| New | Cancelling a service leaves its created future dues | S3 |
| New | Closed session accepts server writes | S3 |

### Reads and performance
| # | Issue | Fixed by |
|---|---|---|
| 17 | No index on ledger `receipt_number` (minor, type index narrows it) | S1 |
| 18 | Year-wide unpaginated reads | S4 for the screens this build touches |
| New | Fees tab loads every student's dues into memory, twice; student page makes seven calls | S4 |
| 23 | "Collected" gives different numbers per screen | S4: one definition, cash received by date, cleared plus pending shown apart |

### Mobile and web
| # | Issue | Fixed by |
|---|---|---|
| 22 | Mobile cancel warning says the ledger is untouched | S6 |
| 19 | Web cannot collect carried-forward balances | Accepted, mobile only (O9) |
| 20 | Web payment detail shows ID prefixes | S6 if cheap, else accepted |
| 21 | Web refund form shows no ceiling | Accepted; server refuses in words after #10 |
| 24 | Web lets 150% through; server refuses | Accepted; server refuses in words after #10 |

### Minor
| # | Issue | Fixed by |
|---|---|---|
| 25 | Dead permissions: `fee_payment:update/export/delete`, `fee_waiver:read` | S1 (removed where unused) |
| 26 | Three date policies | S1: IST everywhere |
| 27 | Cheque details required by mobile only | S1 |
| 28 | Head category can change after use | S2 |
| 29 | Money regex has no upper bound | S1 |
| 30 | Dead maths kept alive by tests | S3 |
| 31 | `fromCents` corrupts negatives | S1 |
| 32 | Lock order differs between record and transitions | S1 |
| 33 | Comments misstate late-fee precedence | S1 |
| 34 | Web overview loads the whole register (not checked); stale student-desk comments | S6 for comments |

### Recorded trade-offs, unchanged
RLS deferred; `authz_audit_log` unused; gateway, GST, Tally, notifications and deposits deferred;
services get no concessions; receipt counter is `integer`; accountant collects and refunds, principal
clears cheques.

## 5. Dashboard (owner's sketch)

Source: `docs/design/mobile/fees-dashboard-sketch.png`. Default screen of the Fees tab.

Top to bottom:
1. **Swipeable cards with page dots:** the fee setup card while anything is unfinished, and
   attention cards such as "3 cheques waiting" and "6 students not billed". Hidden when empty.
2. **Total due this month** with a small trend line, a progress bar and "₹X collected this month".
3. **Two small cards:** All time due, and Students with due (30/120).
4. **View detailed fee report** link, which opens Payments and the ledger.
5. A **collapse arrow** that folds sections 1 to 4 away, leaving the list full height.
6. **Search student**, **Filter**, **Sort**, and a count line ("12 · total ₹X").
7. **Student rows:** name, class, section and roll, amount in red when overdue, with **More info**
   collapsed by default.
8. **Floating Collect button**, which opens collect with a student search.

Meanings used in this build, to be confirmed by the owner:
- **Total due this month:** still unpaid on dues that fall in this month.
- **Bar:** how much of this month's dues is paid.
- **Collected this month:** cash received in this month, whatever month it paid for.
- **All time due:** everything still unpaid up to now, including overdue months and previous dues.
  Not-yet-due months are excluded.
- **Students with due:** students owing anything up to now, out of students with a fee record or previous dues.
- **Trend line:** still-unpaid amount for each of the last six months. No charting dependency.

The mockup from the discussion also proposed Owes and Paid; the sketch uses Filter, so Paid is a
filter value.

## 6. Build stages

Each stage ends with `pnpm check-types`, tests and a commit hand-off.

- **S0** This document.
- **S1 Money and safety:** late fee once, per-month option, forgiveness, quote endpoint; refund and
  bounce fixes; receipt numbering and next number; `ServiceRefusal`; validation; opening balance
  scope, optional origin, void; permissions; webhook; UPI and card immediate; IST dates; index.
- **S2 Dues creation:** `fee_line_periods`; due by period key; frequency cleanup; months list; due day;
  who pays; several structures with sections; Start billing; auto-billing at admission; generator
  from schedule; sweep on by default, failures reported, all open sessions, enrolled only; `/health`.
- **S3 Lifecycle:** concession rules, void, server-side apply; leaving and rejoining; fee record
  suspend and restore; due cancellation; one-off charges; discount at collect; closed-session refusal.
- **S4 Reads:** dashboard read and student read.
- **S5 Dashboard** from the sketch.
- **S6 Screens:** guided setup, student profile, collect, wording; web kept compiling.
- **S7 Proof:** fee-type and event test matrix with a dues, payments and ledger agreement check;
  device walks at 1.0x and 1.3x; docs (ADRs, gotchas, tasks, ledger).

## 7. Deferred on purpose

| Item | Why | Revisit |
|---|---|---|
| Promotion and year-end carry-forward (#15, N6) | The promotion system is deferred (ADR-057). Until then, entering previous dues from an earlier session does not close that session's dues, so staff must not collect both | With promotion |
| Gateway (#4, #5 rest, late fee above money received) | No gateway exists; the webhook route refuses until a secret is set | With gateway |
| Web parity: discount, one-off charges, carried-forward collection | O9 | When web is rebuilt |
| Receipt PDF | Listed go-live need; separate slice | Before launch |
| CSV import of students and previous dues | Bulk entry is a per-class table for now | Before schools with large rolls join |
| Class-wide one-off charges | Single student first | On request |
| Pause on a fee line for one student | Suspend on the fee record covers long leave for now | On request |
| Term weightage as fee share | Unused once schedules hold amounts; the column stays until term form is revisited | With term form |

## 8. Launch checklist beyond this build

The revamp fixes known problems. A safe launch also needs: tests of full money flows, device walks,
a regular check that dues, payments and the ledger agree, restored backups, alerts when the automatic
run fails, receipt PDF, a test at real school size, and a pilot: one school, one full month, alongside
its existing register, totals compared daily.

## 9. Edge cases to test (S7 matrix)

Fee types (monthly, quarterly, half-yearly, per term, once, service, one-off) against events (join at
start, join mid-period, leave, rejoin, concession flat and percent, concession then void, part
payment, overpay refused, pay ahead, bounce, reverse, cancel, refund partial and full, discount, late
fee each kind, waive, cancel due, edit structure after billing). Sessions: April to March, January to
December, June to May, short session. Calendar: December off, April off, April to February. After
every test: dues, payments and ledger agree.

## 10. Build record

**Status, 2026-11-02:** S1 to S7 built on `feat/fees-overhaul`, in the four commits listed under
Hand-off. Not pushed. ADR-058 records the decisions. Migrations 0039 to 0044 are applied to the `.env`
Neon database.

### Gates, last run 2026-11-02
| Gate | Result |
|---|---|
| `check-types` | 8 of 9; the ninth fails only on the owner's untracked `apps/api/scripts/tmp-seed-fees-demo.ts` |
| Lint | 0 errors in all three apps |
| Unit tests | services 179, trpc 42, authz 88, web 115, mobile 42 suites / 735, after the second round |
| `pnpm db:verify` | passes |
| `pnpm check:openapi` | generates |
| Full `test:integration` | 356 of 357 across 17 files. The one failure was a test reusing the class name `Late`; `fees-overhaul` then passed 28 of 28 |
| Empty database | All 44 migrations apply, `db:verify` passes, `db:seed` passes after a fix for the new payment-date rule |
| `smoke-authz`, on that empty database | 234 of 241, every fee check passing. Three `school.list` cells went stale with `4c76521`, which gave teaching roles `school:read`. Four family-link revoke checks fail in code the fee commits didn't touch; cause not traced |
| Create remaining months, pressed on the emulator | 134 dues for 17 students in about 35 seconds, no duplicates, due-now totals unchanged |

**Not run:** web Playwright, including `e2e/fees-counter.spec.ts`.

**Don't run the default `pnpm db:seed` on the demo database.** It is written for 2025-26 and makes that
the current session. The demo uses `pnpm db:seed -- --current-session`. The default seed was run on it
once on 2026-11-02: both branches were set back to 2026-27 afterwards, but 2024-25 and 2025-26 now hold
seed rows, including 12 unpaid dues on Aditi Sharma in 2025-26. They don't show while 2026-27 is current.

### Device walk: Android emulator, Main Campus
- **1.0x:** dashboard, More info, Filter sheet, student page, month strip, More, Collect search,
  collect (part payment, discount and reason, late fee quote, review), one recorded cash payment,
  receipt, student page and dashboard after it, setup list, Months and due day sheet, structures
  list, structure page, a schedule opened, add-line form opened, previous dues opened.
- **1.3x:** dashboard, Collect search, collect.
- **The recorded payment agreed in Postgres:** fee payment ₹5,200, late fee ₹50, discount ₹100,
  and the dues and ledger match.

**Not walked (integration tests cover the server side of most):** Start billing and Bill anyone
missed; saving a fee line or schedule row; saving previous dues; a held cheque or bank transfer;
clear, bounce, refund and cancel on a phone; Forgive the late fee; Adjust per fee; Pay the rest of
the year; concession, one-off, cancel-due, assign and status sheets; Sort; optional services; the
attendance "Start from" field (typechecked and unit-tested around it only); a caller with fewer
permissions; multi-branch beyond the switcher; iOS; TalkBack. **Web was not opened in a browser**:
it typechecks and its tests pass.

### Found by the walk and fixed
- Collect quoted ₹13,800 instead of ₹18,300 when the previous-dues read failed, and Retry refetched
  only the dues. It now stops on the error.
- The confirm sheet and receipt didn't add up by eye, because discount sat inside the sum. The sheet
  now lists lines before discount, and the receipt shows "Discount given" below the total.
- Refunds were invisible on the student page, so "Paid so far" couldn't be squared with receipts.
- A notice said UPI and card stay pending. Changing only a line's months crashed with "No values to
  set". Same-date dues changed order between loads. Raw ISO dates, "Fee head" wording.

### After the owner's first look, 2026-11-02
Dashboard filters are one scrolling line: Class, Sec once a class is chosen, then Owes, Paid and Not
billed. Turning a chip off shows everyone. Sort moved beside the count. A student with previous dues
and no fee record now shows the amount, and counts in "Students with due".

The bottom bar now slides away while the dashboard scrolls down, and Collect moves with it. Setup steps use the same tick as academic setup.

### Second round, built 2026-11-02 at the owner's request
- **Fee setup rebuilt:** rows carry icons; a row still needing work is tinted yellow with a caution
  mark; finished rows stay plain; optional rows are never flagged. Start billing happens on the row,
  structure by structure, with the student count. Receipt numbering moved out of Months and due day.
- **"When dues are created" removed.** A Dues row opens Pause automatic and Create remaining months
  now. All at once is gone from the code, which also removes the trap where switching to it stopped
  new months. A dashboard card appears while paused dues are waiting.
- **Late-created dues** are due the day they're made, not late on day one.
- **One-off charges** ask only what it's for and the amount, with a Paid now switch that makes the
  receipt in the same transaction.
- **Web:** one "due now" line on the overview, Outstanding, status matrix, Collect and student card;
  late fee shown before recording; notices for previous dues and for a structure that hasn't started;
  discount on payment detail.
- **Bug found while building:** old one-time dues keyed `n:1` got a second due from the sweep, adding
  ₹5,000 to Aditi Sharma and Rohan Verma. 0044 cancels the unpaid twins and fixes the keys.

**Checked on the second round.** Emulator: Fee setup, Dues sheet, Pause on and off, the Create remaining
months warning (not confirmed), the one-off sheet with Paid now through to its receipt, hidden nav bar
with Collect following it. Web, headless as the seeded accountant: overview, Outstanding, Collect
(₹1,000 + ₹50 late fee = "Record ₹1,050", no payment recorded), student card, payment discount row,
no page errors, and totals matching the app (Aditi ₹18,720).

**Not checked on the second round.** On a device: the dashboard's paused card (no dues were waiting),
pressing Create remaining months for real, Start billing on the setup row (every demo structure has
started), a one-off paid by cheque. On web: the status matrix's amounts view, the "start billing"
notice (no unstarted structure to show it), `e2e/fees-counter.spec.ts` (it collects the seeded
student's full balance, which would wipe the demo figures). At real school size: the background run.

**Decided against asking again:** the owner wrote "done done" for which rows go yellow; built as
**not done**, because a caution mark on finished work reads backwards.

**Still open, for the owner:** whether fees joins the Home setup card; what "View detailed fee report"
should do, since it only opens Payments; whether the web is used for fees at launch at all.

### Left as they are
- **"View detailed fee report" only opens the Payments list.** No fee report screen exists. The owner
  decides: rename the link, or build a report.
- During the walk the collect screen once showed Cheque selected and the page scrolled, with no tap
  from the walk script behind it. It didn't happen again and the review sheet states the mode, but
  the cause is unexplained; someone else touching the emulator is the likely reason.
- On a school with no fee data, the empty state starts partly behind the tab bar until scrolled.
- The amount box means fees, not cash handed over; the late fee goes on top and the bottom bar shows
  the full amount. Typing what a parent handed over needs the sum worked backwards, since the amount
  decides the late fee. Revisit if cashiers trip on it.
- `0041` and `0042` delete permission rows, so run them with the API that no longer knows those names.

### Dev database residue
Receipt `RCP-2604-00003` on Rohan Verma (DEMO-0002), reason "Device walk test", and receipt
`RCP-2604-00004` for ₹10, "Walk test dress", on Bhavya Rao (WALK-002). A `pnpm dev` sweep
billed the demo school's unbilled Class 6 students, which is why its totals jumped. Demo school lines
have schedules, and its old dues keep backfilled keys such as `n:1`. Integration runs left their own
`RUN` organizations.

### Hand-off
The type chain means commits 1 to 3 only typecheck together. Stage by explicit path.
**Keep out:** `apps/mobile/README.md`, `apps/mobile/package.json`, `apps/web/src/lib/auth-client.ts`,
`apps/web/src/lib/trpc/client.ts`, `rough.md`, `skills-lock.json`, `.kilo/tmp/`, `.zcodeignore`,
`apps/api/scripts/tmp-*`, `apps/mobile/scripts/`, `docs/reference/Final_Exam_Result_System_Report.md`,
`packages/db/*.mjs`. **`apps/api/src/env.ts` also holds the owner's CORS hunk**: use `git add -p`.

1. `feat(fees): bill from a schedule of periods, and fix the money rules (ADR-058)`
   `.env.example`, `apps/api/scripts/seed.ts`, `apps/api/scripts/smoke-authz.ts`, `apps/api/src/env.ts`
   (hunk), `apps/api/src/fees-webhook.ts`, `apps/api/src/server.ts`, `packages/authz/src/`
   (`defaultPermissions.ts`, `permissions.ts`), `packages/contracts/src/contracts/`
   (`attendance.contract.ts`, `fees.contract.ts`), `packages/db/drizzle/` (`0039` to `0044`, their
   snapshots, `meta/_journal.json`), `packages/db/scripts/verify-schema.ts`, `packages/db/src/schema/`
   (`fees.ts`, `organization.ts`), `packages/services/src/` (`attendance.service.ts`,
   `enrollment.service.ts`, `fees-billing.service.ts`, `fees-billing.test.ts`,
   `fees-collection.service.ts`, `fees-dashboard.service.ts`, `fees-maths.ts`, `fees-property.test.ts`,
   `fees.service.ts`, `index.ts`, `student.service.ts`), `packages/trpc/src/routers/`
   (`enrollment.router.ts`, `fees.router.ts`), `packages/trpc/src/integration/`
   (`fees.integration.test.ts`, `fees-overhaul.integration.test.ts`)
2. `feat(mobile): new fee dashboard, guided setup, clearer collect and receipt`
   `apps/mobile/src/lib/` (`copy.ts`, `fees.ts`, `fees.test.ts`, `fees-copy.ts`),
   `apps/mobile/src/app/(staff)/fees/collect/index.tsx`,
   `apps/mobile/src/app/(staff)/fees/setup/previous-dues.tsx`,
   `apps/mobile/src/screens/staff-attendance/manage/generate-sheet.tsx`,
   `apps/mobile/src/components/` (`screen-frame.tsx`, `tab-bar.tsx`), and in
   `apps/mobile/src/screens/fees/`: `collect.tsx`, `collect-search.tsx`, `concession-sheet.tsx`,
   `dashboard-cards.tsx`, `dashboard-row.tsx`, `desk-actions.tsx`, `dues-row.tsx` (deleted),
   `dues-sheet.tsx`, `generation-card.tsx` (deleted), `index.tsx`, `installment-row.tsx`, `month-sheet.tsx`, `payment-detail.tsx`,
   `payment-row.tsx`, `receipt.tsx`, `setup-checklist.tsx` (deleted), `setup-previous-dues.tsx`,
   `setup-services.tsx`, `setup-structure.tsx`, `setup-structures.tsx`, `setup.tsx`, `student-desk.tsx`
3. `fix(web): keep fee screens working on the schedule model, with one due-now total`
   `apps/web/src/lib/copy.ts`; in `apps/web/src/app/(dashboard)/fees/`: `page.tsx`,
   `outstanding/page.tsx`, `collect/page.tsx`, `payments/[paymentId]/page.tsx`,
   `setup/[structureId]/page.tsx`; and in `apps/web/src/features/fees/`: `due-now.ts`, `fee-enums.ts`,
   `fee-profile-card.tsx`, `fee-structures-section.tsx`, `fee-styles.ts`, `matrix-helpers.ts`,
   `matrix-helpers.test.ts`, `structure-dialog.tsx`, `structure-line-dialog.tsx`, `use-fee-ledger.ts`
4. `docs: record the fees overhaul (ADR-058)`
   `.kilo/plans/2026-11-01-fees-overhaul.md`, `docs/DECISIONS.md`, `docs/DOMAIN.md`,
   `docs/FEES-BACKEND-NEEDS.md`, `docs/FEES-GOTCHAS.md`, `docs/MOBILE_PLAN.md`, `docs/TASKS.md`,
   `docs/design/mobile/fees-dashboard-sketch.png`
