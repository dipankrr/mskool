# Mobile Fees — staff slice (Step 5)

Status: built, gate-green and device-walked (2026-10-26). Branch `feat/mobile-fees-slice` from `main` @ `506be65`.
Backend is frozen for this slice; gaps are recorded at the bottom.
Staff side only — the family/portal fee door is not in scope.

## Actor, task, context

- **Actor:** the school accountant (also principal / vice-principal, who hold the
  same grants), signed in to one branch and the running academic year.
- **Context:** a parent is standing at the counter. The accountant has one hand
  free, the queue is real, and the answer must be right the first time — a
  receipt cannot be edited, only reversed.
- **Tasks, in order of frequency:**
  1. "What does this child owe, and since when?" (search → balance)
  2. "Take the money and give a receipt." (collect → receipt)
  3. "The cheque bounced — put the dues back." (recovery)
  4. "Reconcile the day / the year." (payments, ledger)
  5. "Set up the year's fees." (heads, structures, late fees, subscriptions)

## Design read

Same system as the rest of the staff app: quiet emerald-on-canvas, one accent,
light-only, iOS/Android phones. Fees adds **money gravity**: amounts are the
largest thing on the screen, in tabular figures, right-aligned in lists and
centred in the receipt. Dials: variance 4 (this is an instrument, not a poster),
motion 3 (state changes only), density 5 (a counter screen shows more rows than
a homework screen). Nothing celebratory; no confetti on payment.

## Information architecture

```
(tabs)/fees.tsx                  Dues — the working list (6th tab)
fees/student/[studentId]         Student fee desk
fees/collect/[studentId]         Allocation + payment
fees/receipt/[paymentId]         Receipt (server number)
fees/payments                    Payments list
fees/payment/[paymentId]         Payment detail + transitions
fees/ledger                      Ledger (In / Out / Net)
fees/setup                       Setup hub
fees/setup/heads                 Fee heads
fees/setup/heads/new             New head
fees/setup/heads/[headId]        Edit head
fees/setup/structures            Structures
fees/setup/structures/new        New structure
fees/setup/structures/[id]       Structure detail + lines + late-fee rules
fees/setup/structures/[id]/lines/new
fees/setup/structures/[id]/lines/[lineId]
fees/setup/late-fees             Late-fee rules
fees/setup/subscriptions         Optional-fee subscriptions
fees/setup/opening-balances      Opening balances
```

The tab is a **sixth** destination by owner decision (2026-10-26), gated on
`fee_payment:read` or `fee_report:read`. The label is capped like the others.

### Why the dues list reads the matrix

`fees.matrix.list` is the **only** fee read that returns student identity
(name, admission number, class, section, roll), the assignment/generation
state, the totals, the oldest due date and pagination in one call.
`fees.installment.dues` returns raw installments with a `studentId` and no
name, so it cannot drive a list. Therefore:

- **Dues tab** = `matrix.list` with `view: "attention"` (unpaid/partial overdue,
  opening-balance dues and ungenerated assignments), `sort: "oldestDue"`,
  search, class/section filters, `pageSize: 25`.
- **Student desk** = `assignment.byStudent` + `installment.dues` (outstanding) +
  `payment.list` (history) + `matrix.cell` per month for the month strip.
- The wide matrix is **never** rendered as a squeezed table. Its per-month
  cells become a horizontal month strip on the student desk; tapping a month
  opens that month's installment breakdown.

## Journeys

### A. Collect (the core loop)

1. Fees tab → search "aditi" or an admission number → row: name, class,
   balance, oldest due, state pill.
2. Tap → student desk: balance card (assessed / concession / paid / balance),
   opening balance if any, outstanding installments oldest-first with late fee,
   month strip, payment history.
3. **Collect payment** → allocation screen:
   - every outstanding installment, oldest first, **prefilled** with its full
     balance (the common case is "pay everything"), each editable;
   - a "Pay full balance" reset and per-row "clear";
   - the running total is the sum of allocations, never typed separately;
   - a row cannot exceed its balance (clamped with a visible reason);
   - mode pills (cash / UPI / cheque / NEFT-RTGS / card / DD);
   - reference fields appear per mode (UPI ref, cheque no + bank + date, UTR,
     card last-4, DD no);
   - a `clientReference` is generated once per attempt so a retry cannot
     double-charge.
4. Review sheet: student, allocation lines, total, mode, reference. Confirm.
5. Server returns the payment with its **receipt number** → receipt screen.
6. Receipt: school, receipt no, date, student, class, lines, late fee, total,
   mode, collected by. Share as text. Done → student desk (balances refetched).

### B. Recover

Payment detail renders only legal transitions:
`pending → clear | cancel | bounce`, `cleared → bounce | reverse | refund`
(the server allows bouncing a pending payment; the client mirrors it).
Each transition asks for a reason (min 1 char, the server's rule), warns what
it does ("re-opens the installments it paid"), and invalidates dues, the
student desk, payments and the ledger.

### C. Reconcile

- Payments list: receipt, date, mode, amount, status; filter by status.
- Ledger: In / Out / Net summary for the year, rows with type, direction,
  amount, date, student; filter by student.

### D. Set up

- Heads: list, create, edit, deactivate.
- Structures: list by year, create, edit, deactivate; lines (add/edit) with
  head, amount, frequency, installments; late-fee rules per structure.
- Subscriptions: list, create, cancel.
- Opening balances: list, create (writes its ledger row).
- Assignment/generate/concessions live on the **student desk**, not setup —
  they are per-student acts: "Assign structure", "Generate installments",
  "Add concession", "Recompute concessions".

## Screen states

Every data screen: initial loading (skeleton), empty (why + next action),
error with retry, content, refresh error over cached content, permission
denial, and for writes: idle / submitting / failed-with-draft-kept / success
only after the server confirms.

Money-specific states: no fee assignment ("Assign the year's structure"),
assignment but no installments ("Generate installments"), zero balance
("Nothing outstanding"), waived installment (not payable), closed year
(read-only).

## Money rules (client-side, mirrored in unit tests)

- Amounts are decimal **strings** on the wire; the client converts to integer
  paise for arithmetic and back to a 2-dp string. Never `parseFloat` maths.
- A payment's amount is the sum of its allocations — the client never sends a
  total, and the review sheet shows the derived sum.
- An allocation is clamped to `netAmount - paidAmount`; over-allocation is a
  validation error, not a silent clamp.
- Late fee is **display-only** on the client (`lateFeeApplicable`); the server
  computes and freezes the charged amount.
- Formatting is Indian grouping (`₹1,23,456.00`), tabular where the platform
  allows it, and the negative/zero cases are explicit.

## Chunks (one commit each)

1. **5A — Dues + student desk.** Tab, money helpers + tests, dues list,
   student fee desk, month strip, empty/denied states.
2. **5B — Collect + receipt.** Allocation screen, mode/reference fields,
   review sheet, idempotency key, receipt, share.
3. **5C — Payments + recovery.** Payments list, detail, clear/cancel/bounce/
   reverse, refund.
4. **5D — Ledger.** In/Out/Net summary, rows, student filter.
5. **5E — Setup.** Heads, structures + lines + late-fee rules, subscriptions,
   opening balances, assign/generate/concession actions on the desk.

## Acceptance

- An accountant finds a student by name or admission number, sees the balance
  and its oldest due date, collects with allocations that cannot exceed a
  balance, and receives a server-numbered receipt.
- A bounce re-opens the installments it paid and the dues list reflects it.
- The ledger's In / Out / Net reconciles with the payments in the year.
- No screen shows a receipt number, a balance or a success state the server
  did not produce.
- Illegal transitions do not render.
- Rendered and walked on the Android emulator at 1.0× and 1.3× text scale.

## Verification

- `pnpm --filter @repo/mobile check-types`
- `pnpm --filter @repo/mobile lint`
- Jest: money parse/format, allocation clamp, transition legality, dues
  grouping, status labels.
- Device walk: dues empty + loaded, collect full + partial, receipt, payments
  list, clear/bounce, ledger totals, setup create/deactivate, 1.3× pass.

## Documented backend gaps (no changes made in the slice)

Status after the backend follow-up is marked **[closed]** / **[partly closed]**;
see "Backend gap closure" below.

1. **[partly closed]** `installment.dues`, `payment.list` and `ledger.list`
   return raw rows with a `studentId` and **no student name/class**. The dues
   tab therefore reads the matrix; the payments list shows receipt + amount +
   date and the detail shows the id. A `studentName` join is the fix.
   `payment.list` and `ledger.list` now carry it; `installment.dues` does not.
2. **[closed]** `payment.detail` allocations carry `installmentId` only — no
   description or fee head, so receipt lines are labelled from the student's
   installment list when available and fall back to the id.
3. No "all installments for a student" read: `installment.dues` is
   unpaid/partial only, so paid history comes from payments, not installments.
4. `matrix.list` computes the whole cohort in memory before filtering and
   paginating; mobile keeps `pageSize` small and asks for one view at a time.
5. No receipt PDF/print endpoint; the receipt is shared as text.
6. No late-fee preview endpoint: the client shows `lateFeeApplicable`, which is
   computed live, but the charged amount is only known after the write.
7. `fee_structure.list` needs `academicYearId` + `includeHistory`; there is no
   "current year" convenience read.
8. Concession creation returns only `concessionAmount` — the desk refetches.
9. No bulk "assign structure to a class" endpoint; assignment is per student.

## As built

The IA collapsed some routes into sheets: new/edit for heads, lines and late-fee
rules are `FormSheet`s on their list screens; late-fee rules live on the
structure screen; subscriptions and opening balances share
`fees/setup/services`. Routes: `(tabs)/fees`, `fees/student/[studentId]`,
`fees/collect/[studentId]`, `fees/receipt/[paymentId]`, `fees/payments`,
`fees/payments/[paymentId]`, `fees/ledger`, `fees/setup`,
`fees/setup/{heads,structures,structures/[structureId],services}`.

## Walk (emulator-5554, 1080×2400, 1.0× and 1.3×)

Dues (attention) → Aditi desk → collect with Admission cleared and Lab
`150.555` (input stops at `150.55`) → review → RCP-2025-00003, ₹13,150.55 +
₹1,100.00 server late fee → receipt labelled from the installment cache →
desk balances refetched. Desk history → RCP-00002 (pending UPI) → empty reason
refused → clear → bounce → closed, dues list +₹200 and the installment back
on collect. Payments list (Collected excludes the bounce), ledger In/Out/Net,
setup hub → structure detail with lines and late-fee rule.

Fixed during the walk: receipt amounts now always come from the server
allocations (only labels are cached, per installment); amount inputs stop at
two decimals (`sanitizeAmountInput`); collect's "Pay full balance" was pushed
off-screen; collect explains a carried-forward balance it cannot take; desk
payment rows open the payment detail; `FormSheet` used no keyboard avoidance
on Android, so the keyboard covered sheet fields and the save action (every
sheet in the app, homework included); bounce copy said "cheque" for every
mode; refund hint printed a raw amount; "January – December" for a 1–12 line
now reads "All year"; at 1.3× the six-tab bar ellipsised Attendance/Homework
(label capped at 1×), the segment bar ellipsised "Attention" (shrinks to fit)
and a ₹5000.00 allocation rendered as "000.00" (wider box, capped input).

Further backend gaps found on the walk (no changes made):

10. **[closed]** No write pays an **opening balance**: `payment.record`
    allocations target installments only, so a carried-forward due shows on
    the desk but cannot be collected. Collect says so.
11. **[closed — server side]** The ledger counts `opening_balance` as Money in,
    though it is a receivable, not cash.
12. **[closed]** A bounce posts a debit for the allocated amount only; the late
    fee charged on the bounced payment stays in Money in.
13. "Collected" differs by screen: the matrix excludes late fees, the payments
    list includes them. (Open.)
14. **[closed]** Gap 2 is the most visible one left: after a restart, receipts
    and payment detail for fully paid installments show "Installment c1937743".

## Backend gap closure (2026-10-26)

Backend only — `apps/mobile` untouched; one web type alias repointed
(`FeePayment` = `payment.record` output, since the list row grew). Decision
record: **ADR-049** in `docs/DECISIONS.md`. Files:
`packages/contracts/src/contracts/fees.contract.ts`,
`packages/services/src/fees-collection.service.ts`,
`packages/trpc/src/routers/fees.router.ts`,
`packages/trpc/src/integration/fees.integration.test.ts` (new describe
"fees: mobile backend gaps (ADR-049)"). No migration.

| Gap | Server change | Mobile follow-up it unlocks |
|---|---|---|
| 2 / 14 | `payment.detail` → `paymentDetailOutputSchema`: each allocation adds `feeHeadId`, `feeHeadName`, `description`, `installmentNumber`, `dueDate` (ordered by due date); new `openingBalanceAllocations[]` (`openingBalanceId`, `amountAllocated`, `description`, `originAcademicYearId/Name`). | Receipt and payment detail label lines from the server; drop the installment label cache (`lib/fees-receipt-cache.ts`) and the "Installment c1937743" fallback; show a "Carried forward from 2025-26" line. |
| 10 | `payment.record` accepts `openingBalanceAllocations: [{ openingBalanceId, amount }]`; `allocations` may now be empty (total must be > 0). Locks + re-checks the balance, updates `paidAmount`/`status`, writes one `opening_balance_payment` credit per portion (the link row). Bounce/reverse/refund re-open portions. Refusals are worded ("exceeds the opening balance still owed. The outstanding amount is …", "carried into", "belong to the paying student", "waived"). | Collect gets an opening-balance line (pay full/part, with the year it came from) on the same receipt; remove the "cannot take a carried-forward balance" explainer; the desk's opening-balance figure updates after collect. Opening balances are paid in the year they were carried **into**, so collect must send that year. |
| 11 | `ledger.list` rows add `cashEffect: "in" \| "out" \| "none"` (`none` = `opening_balance`, `concession_applied`, `waiver_applied`). Rows themselves are unchanged (append-only). | Ledger In/Out/Net sums `cashEffect` instead of `direction`; show `none` rows as "not cash" (muted, outside the totals). Until mobile switches, its totals are still wrong. |
| 12 | Bounce and reverse write a second debit for `lateFeeAmount` when > 0. | None required: the ledger's Net is right once the row lands. Old bounced payments keep their one-sided late fee (ADR-049). |
| 1 | `payment.list` rows add `studentName`, `admissionNumber`, `className`, `sectionName`; `ledger.list` rows the same (nullable for non-student rows). Class/section come from the enrollment in the row's year (null if none). | Payments list and ledger rows show the student and class; the payment detail can show who paid without a second read. |

Proven by `fees.integration`: detail labels (gap 2), list/ledger labels incl.
an un-enrolled student and foreign-scope isolation (gap 1), opening balance
refusals → cash part-payment → link row → detail → refund → cheque settles →
bounce re-opens → cash nets to what was kept (gap 10/11), bounce + reverse
with a late fee net to zero (gap 12), waiver is `none` (gap 11).

Still open, found while closing these (backend):

15. `cancelPayment` writes no ledger row, but `recordPayment` already credited
    the pending payment, so a cancelled payment stays in Money in. Needs a new
    `financial_transaction_type` value (migration) — ADR-049 consequences.
16. **[closed — ADR-049 §4]** A second partial refund re-walks the allocations from the first one
    (`recordRefund` does not subtract what earlier refunds took back, and
    reads allocations unordered), so with two or more allocations it can
    over-reopen the first and never reopen the next (the clamp at 0 hides it).
17. **[closed — ADR-049 §4]** `reversePayment` after a partial refund re-opens the full allocations and
    debits the full principal again — the refunded part is offset twice.

## Docs / skills used

- `docs/MOBILE_PLAN.md` §10 + parity ledger, `docs/TASKS.md`, `AGENTS.md`,
  `docs/DOMAIN.md` §5, `docs/DECISIONS.md` (ledger append-only, ADR-009).
- Skill: `expo-data-fetching` (four states, mutation discipline, no optimistic
  money writes). Design-system patterns are the repo's existing tokens and
  components; no new token is introduced.
- Expo SDK 57 / RN 0.86.3 / React 19.2 / React Query 5.101.2.
