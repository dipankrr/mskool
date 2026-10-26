# Fees — make it understandable, keep it flexible

Status: **proposal, awaiting owner approval** (2026-10-26).
Branch `feat/mobile-fees-slice`. Staff side only.

## Why

The owner, who built it, finds the fee flow hard to follow; an accountant
will too. The system is flexible on purpose — schools bill differently — and
that flexibility stays. What changes is **where** things live, **what they
are called**, and **what the screens lead with**.

**Rule: nothing is removed.** Every screen, option and figure that exists
today stays reachable. Moving a detail behind a toggle or a "More" menu is
allowed; deleting one needs the owner's sign-off.

## The flow, in one line

> **Set the prices → Bill the students → Take money → Fix mistakes → See the totals**

| Stage | Who, how often | Today's pieces |
|---|---|---|
| 1. Set the prices | Admin, once a year | Fee heads, structures + lines, late-fee rules, optional services |
| 2. Bill the students | Admin, start of year + new admissions | Assign structure, generate installments, concessions, previous dues |
| 3. Take money | Cashier, daily | Dues list, student desk, collect, receipt |
| 4. Fix mistakes | Senior staff, rarely | Clear, cancel, bounce, reverse, refund, waive |
| 5. See the totals | Accountant, principal | Fees tab totals, payments, ledger |

Every screen should belong visibly to one stage. Today the student desk mixes
2, 3 and 4, and stage 2 is hidden on it entirely.

## Decisions taken

1. **Billing: both.** "Bill all students in this class" is a shortcut that
   skips anyone already billed (safe to press twice). Billing one student
   stays, for mid-year admissions, class changes and special cases.
2. **Month by month is the default view.** The whole session is one tap away.
   The backend may keep generating the full year's dues; only what the
   screens lead with changes.
3. **Previous session's dues stay one total line**: "Previous dues (2024-25):
   ₹X", payable like any other due. No itemising, no storage change.
4. **"Generate all dues now / monthly" is a school setting, in phase 2.**
5. **Demo data must live in a current session** so dues are past, current and
   future — not all overdue.

## Words

| Today (database word) | On screen |
|---|---|
| Fee head | Fee type |
| Fee structure | Fee chart |
| Fee structure line | Fee in the chart |
| Assign structure + generate installments | Bill (this student / all students) |
| Generate installments (re-run) | Add missing dues |
| Installment | Due |
| Opening balance | Previous dues (2024-25) |
| Optional subscription | Optional service (transport, hostel…) |
| Concession | Concession / scholarship |
| Waive | Waive this due |
| Bounce / reverse / refund / cancel | Unchanged — accountants use these words |

Copy only: no API or column is renamed.

## Phase 1 — understandable

### Backend (one new call)
- `fees.assignment.billClass({ academicYearId, classId, sectionId? })`:
  for each enrolled student without an active assignment, assign the class's
  active structure and generate installments. Returns billed / skipped /
  refused counts with reasons (no structure, not enrolled). Idempotent.
  Integration test: run twice → second run bills nobody.

### Fees tab
- Leads with **Due this month** and **Overdue**, from the matrix's month
  data; a "This month / Whole session" toggle shows today's year totals.
- When the year is not set up, a **year-setup checklist** replaces the
  totals: Fee types → Fee charts (copy from last year) → Late-fee rule →
  Bill students. Each step shows done / next and opens its screen.

### Student page (desk) — three zones
1. **Due now**: ₹X, "October + 1 month overdue", previous dues as one line,
   **Collect**.
2. **History**: payments (tap → payment detail).
3. **More**: concession, waive, add missing dues, previous dues details,
   recompute concessions, the full-year month strip and every due.
- Not billed yet → **Bill this student** (one button for assign + generate).

### Collect
- Prefills only what is due up to this month (plus previous dues).
- Future months sit under **Pay ahead**, collapsed; opening it lists them
  at zero, ready to fill.

### Setup
- Fee chart screen: **Copy from last year** and **Bill all students in this
  class**.
- "Student services" splits: optional services stay; previous dues move to
  the student page.

### Closed session
- A closed session is read-only on every fee screen (collect, bill,
  concession, setup writes hidden; a notice says why). Verify the server
  refuses the same writes; record a backend gap if it does not.

### Walk (emulator, 1.0× and 1.3×)
Bill a class → collect this month → pay ahead → partial refund twice →
cancel a pending UPI → bounce → concession → waive → setup edits → closed
session. Every flow not walked in the first slice is walked here.

## Phase 2 — generate all now, or month by month

| Piece | Size |
|---|---|
| School setting (one column + migration) and a Setup toggle | Small |
| Generator accepts "up to month X" (it already only fills what is missing) | Small |
| Manual **Generate {month} dues** for the school (uses `billClass`) | Small |
| Pay ahead creates future dues on demand; unbilled months read "not billed yet" | Medium — the careful part |
| Automatic run on the 1st, on the homework worker's pattern (ADR-040) | Medium — last, after manual is tried |

Benefit beyond preference: in monthly mode a mid-year price change reaches
later months automatically, and a student who leaves has no future dues to
cancel.

## Demo data (prerequisite)

`apps/api/scripts/seed.ts` hard-codes 2025-26 as the current session (terms,
holidays, exams, sections, staff grants). Proposed: derive the current
session from today (April–March containing today) and the previous one from
it, then `pnpm reset:demo -- --yes` and `pnpm db:seed`. This wipes and
recreates **only** the `demo-trust` org. Needs owner approval.

## Progress (2026-10-26)

Done: billClass endpoint (e471510) + "Bill all students in this class" on the
fee chart; Fees tab month view; collect prefills up to this month with Pay
ahead; student page leads with Due now; "Bill this student" is one action;
whole rupees drop ".00"; dues named "Tuition Fee — November 2026"; closed
session hides collect, billing, concessions and fee-chart edits.

**Backend gap found:** the fee services never check the session's status, so
a closed session still accepts collections, billing and concessions. The
mobile guard (`useSessionOpen`) is the only one today; the server should
refuse these writes for a closed year.

Owner decision: the month-by-month strip stays on the student page (not
behind More).

## Not in scope

Parent/portal fees, receipt PDF, late-fee preview endpoint, the
`installment.dues` student join (all recorded as gaps in
`2026-10-26-mobile-fees.md`).
