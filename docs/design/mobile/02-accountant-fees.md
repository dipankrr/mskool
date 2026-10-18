# 02 — Journey 2: accountant collects a fee and survives an ambiguous timeout

Status: draft for owner review (2026-10-17, grounded at commit `6e1984b`).
Related ledger row: `/fees/counter`, `/fees/collect`, `/fees/payments`,
`/fees/payments/[paymentId]`, `/fees/ledger` (mobile phase 5 — "Counter
collection, allocation review, receipt, reversal/bounce recovery").

---

## 1. Persona, permission, context

**Actor:** accountant (`accountant@demo-trust.test`, role `accountant`, scope
**school** — Main Campus). Holds `fee_payment:create|read|update|export`,
`student_fee_assignment:read`, `student:read`, `academic_year:read|read_history`
(arrears across sessions). **Not** `fee_payment:approve` / `fee_waiver:approve`
/ `fee_refund:approve` — the counter never approves (finding F4).

**Where/when:** fee counter, parent standing in front, money in transit, both
parties looking at the screen, network that drops mid-transaction. The moment
of truth is the submit.

## 2. Measurable outcome

> With the parent present, the accountant finds a student, shows the exact
> amount due, records a counter payment against the right installments, and
> hands over the server-issued receipt number — **including when the first
> submission times out ambiguously, without double-charging.**

## 3. Entry-to-done journey and wireflow

```
[Home]                                  [Fees tab]
  │  "Collect fees" (gated fee_payment:create)
  ▼
[Find student]  ── student.list(q)      search name / admission number
  ▼
[Student dues]  ── fees.installment.dues
  │  total-due card; rows: unpaid/partial installments,
  │  balance = netAmount − paidAmount, due dates; arrears → year/context switch
  ▼
[Collect] — allocation editor
  │  auto-split oldest-first; each allocation editable; total = Σ allocations
  │  mode: cash · upi · cheque · neft_rtgs · card · dd  (+ mode fields:
  │  transactionReference / bankName / chequeDate as applicable); remarks
  ▼
[Confirm] — totals + mode; "Record payment"
  │  fees.payment.record { …, clientReference: <uuid v4> }   ← minted at first submit,
  ├── success → [Receipt] DEMO-2025-##### (server-issued)      payload FROZEN there
  │             + share affordance
  └── timeout / uncertain ───────────► [Recovery sheet]
        (1) "Retry submission" — same key + identical payload.
            Idempotent: if the first attempt landed, the retry RETURNS ITS
            RECEIPT instead of writing a second payment.
        (2) "Check recent payments" — fees.payment.list filtered to this
            student, newest first.
              found  → open the receipt (done)
              absent → "Start a new attempt" (new clientReference)
```

The idempotency mechanics are real, not aspirational:

- `clientReference` is the idempotency key; unique index
  `fee_payments_school_client_reference_uq (schoolId, clientReference)`.
- Retrying with the same key **and unchanged payload** returns the original
  receipt. **A mismatched payload on a used key is a refusal** — which is why
  the payload freezes at first submit: any edit means "abandon this attempt
  and resolve via lookup first", never a silent new key.
- Never auto-retry in the background — every attempt is visible to the desk.
- Payment amount is derived from allocation sum; exceeding an installment's
  balance is the only refusal (future-due installments are payable).
- Receipt numbers come from a row-locked sequence: `${prefix}-${year}-#####`.
- `financial_transactions` is append-only; corrections are offsetting rows
  (hard rule 3) — the counter never "edits" a payment.

## 4. Screens, hierarchy, realistic sample content

| Screen | Content (seed reality) |
|---|---|
| S1 Home / Fees | Branch "Main Campus · 2025-26"; "Collect fees" first action |
| S2 Find student | Recent students first; search "Aditi" or "DEMO-0001" (name parts + admission number, server-side) |
| S3 Dues | Card "Outstanding ₹1,000"; row "Tuition Fee · May 2025 · ₹1,000 balance (net ₹1,000 − paid ₹0)"; session switcher visible for holders of `academic_year:read_history` |
| S4 Collect | Allocation "Tuition Fee May — ₹1,000 / ₹1,000"; mode chips (cash selected); remarks optional |
| S5 Confirm | "Collect ₹1,000 · Cash"; button "Record payment" |
| S6 Receipt | "Receipt DEMO-2025-00042 · ₹1,000 · Aditi Sharma · Cash"; Share |
| S7 Recovery sheet | Two actions as wireflow; copy: "We couldn't confirm this payment. It may already be recorded." |

Seed fee structure for realism: "Tuition Fee" ₹12,000/year billed monthly.

## 5. State / recovery table

| State | Design |
|---|---|
| Loading | Skeletons on search and dues; submit never fires on stale totals (revalidate dues right before submit) |
| Empty | "Nothing pending — paid up" on dues; empty search → "No student matches" |
| Error | Inline retry on the failed query; committed money states are terminal, not retried by UI |
| Offline | ADR-043 online-only: banner + disabled submit; allocation draft kept in memory; Retry on reconnect |
| Denied | No `fee_payment:create` → dues view read-only; no `student_fee_assignment:read` → Fees tab hidden |
| Submitting | Full-screen lock on the confirm action; back gesture disabled during flight |
| Success | Receipt from the server response only (never optimistic); success screen shows the server receipt number |
| **Uncertain timeout** | First-class state (S7): payload frozen; Retry-same-key or Lookup; never a silent second write |
| Interruption / resume | Frozen attempt (key + payload) survives backgrounding and screen navigation within the session; app killed → lookup path is the recovery ("check recent payments") |
| Refusals | exceed-balance → inline on the allocation row; payload-mismatch (should be unreachable by design) → forced lookup |

## 6. Procedure-to-screen mapping

| Screen | Procedures |
|---|---|
| S1 | `me.get` (context, permission union) |
| S2 | `student.list` (gate `student:read`; q across name + admission number) |
| S3 | `fees.installment.dues` (gate `student_fee_assignment:read`; year-scoped) |
| S5–S6 | `fees.payment.record` (gate `fee_payment:create`; returns receipt) |
| S7 | `fees.payment.list` / `fees.payment.detail` (gate `fee_payment:read`) |

Explicitly **not** in this journey: approve/clear/bounce/reverse/cancel,
waive, refund — separate permission tiers and separate journeys (phase 5's
reversal/bounce recovery and the approval flows).

## 7. Platform, keyboard, accessibility

- Numeric keyboards for amounts; currency formatting `₹1,00,000` (Indian
  grouping) rendered consistently; input remains plain digits.
- Mode-dependent fields appear/clear per mode (cheque → date + bank; upi →
  reference) — no dead fields.
- Large tap targets; the confirm button is the visual anchor; destructive
  paths styled apart.
- TalkBack announces total-due and allocation changes; amounts are text, not
  images; text scaling tolerated on money screens.
- Screen privacy (money + phone on screen in a public counter) — noted as a
  later platform decision (e.g. Android `FLAG_SECURE`), not promised here.
- Share uses the native share sheet; PDF/print artifacts are the phase-5
  native workflow (ledger row), not invented here.

## 8. Device targets

Portrait phones; counter posture (phone often passed/angled between two
people). No tablet layout in the first slice.

## 9. Open questions for the owner

1. **Offline collection** — same ADR-043 validation as attendance: is
   "fails visibly, retries, drafts in memory" acceptable at the counter?
2. **Allocation editing depth for v1.** Web parity is: auto-split oldest-first
   + full manual adjustment. Keep full parity on mobile, or ship
   auto-split + "adjust" as a secondary step?
3. **Late fee display.** Late fees are computed live server-side; where should
   they appear — folded into the installment balance, or their own line item
   on the confirm? (Display rule needed before slice 5.)
4. **Recovery entry points.** Should "Find a payment" (the lookup) also be a
   standalone entry on the Fees tab (useful beyond timeouts)?
5. **Multi-campus accountants.** Seed accountant is school-scoped; an org with
   two registers needs one accountant per campus or a wider grant. Note now,
   decide when an org asks?
