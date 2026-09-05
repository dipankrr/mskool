# Fees backend needs (for the UX redesign spec)

The redesign spec (`redesign-fees-UI-prompt.md`) is implemented **frontend-only**.
These are the backend gaps it works around, and what a future backend
addendum should provide. Nothing here is built — this is the shopping list.

## Needed for the full spec

1. **Session fee aggregates** — one call returning, per academic year:
   `collected`, `outstanding`, `overdue`, `studentsWithDues`.
   The Overview dashboard currently sums installment rows client-side
   (three heavy queries on landing). Server aggregates are the real fix.
2. **Dues rows with student + class joined** — `studentName`,
   `admissionNumber`, `className`, plus per-student `oldestDue`.
   Today the UI joins names from the register page (truncated, often `—`).
3. **`duesListSchema.sectionId` picked by the router** — the schema has it,
   the router ignores it. The spec's Class filter on Outstanding needs it
   (or a class filter with an enrollment join).
4. **Payment detail with installment join** — `description` + `dueDate` per
   allocation. Today the detail carries ids only, so the UI shows a UUID
   prefix as last resort. No client query can fix this: paid installments
   leave dues by definition.
5. **Concession list endpoint** — concessions are visible only via net
   amounts and ledger rows today.
6. **Refund list endpoint** — the ledger's `fee_refund` rows are the read
   path today.
7. **Late-fee preview endpoint** — the counter/receipt can only display the
   frozen server-computed fee after recording, never a pre-quote.

## Deliberately not requested

- No changes to calculations, allocation rules, state machine, permissions,
  or append-only ledger posture. The spec is presentation + interaction only.
