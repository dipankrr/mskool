# mskool — Phase 4 fees: security hardening (2 waves, 7 commits)

**READ `AGENTS.md` FIRST.** This plan is written to be executed by an agent
with ZERO conversation context. Everything you need is in this file or in the
files it points to. Do not re-litigate decisions recorded here — they are the
owner's.

---

## 0. What this is and where you are starting from

The Phase 4 fees backend is COMPLETE on branch `feature/phase4-fees`
(13 commits ahead of `main`, tip `b46f8a7`, never pushed, never merged —
merging is the OWNER's act, not yours). It shipped: 14 tables (migrations
0010–0012), the contract → service → router chain (36 REST endpoints), the
billing engine, collection with a row-locked receipt sequence, the ADR-009
signed-webhook seam, and a hardening slice (commits `977372d`, `2d96bea`,
`b46f8a7`) that closed the concession-clamp hole, the webhook happy/tamper/
replay paths, the invariant sweep, and the same-installment race.

Two external security reviews (pasted by the owner) plus a self-review then
surfaced SEVEN remaining findings. The owner has made decisions on all of
them (§3). This plan implements the accepted fixes (Wave 1) and the
requested tests (Wave 2). **No migration is expected in this plan** — every
fix is contract- or service-level; the DB schema from 0012 stands.

### Verify your starting point before touching anything

Run these; if the numbers differ materially, STOP and read
`.kilo/plans/1788307200000-phase4-fees-report.md` to understand why:

- `pnpm check-types` → green, 8/8 packages
- `pnpm test` → 204 unit (86 authz + 38 services + 48 web + 32 trpc)
- `pnpm test:integration` → 117 (93 authz + 24 fees), real Postgres
- `pnpm db:verify` → 119 PASS (27 CHECKs catalogued)
- `pnpm check:builders` / `pnpm check:openapi` → green, 100 endpoints
- `git log main..HEAD --oneline | wc -l` → 13
- `git status` → clean

The live smoke is 143/164 with 21 pre-existing failures caused by dev-DB
drift on the demo org (details in S6 — you will FIX this, see the owner's
decision in §3).

---

## 1. Protocol (amended overnight-run protocol, owner-authorized — same as the Phase 4 run)

1. Implement ONE commit's scope (S0–S6 below), no more.
2. Run that commit's **Verify** steps. `pnpm check-types` must be green
   before every commit; the other gates as listed.
3. Tick that commit's boxes in THIS file, in the same diff.
4. Append a **Reviewer's guide entry** to THIS file (format in §8) and a
   status + entry to `.kilo/plans/1788307200000-phase4-fees-report.md`
   (STATUS line at top, per-chunk entry under the per-chunk log).
5. Commit on `feature/phase4-fees` with the message from the ledger (§7).
   **Never commit to main. Never push. Never merge.**
6. Move to the next commit immediately. If a gate fails and 30 minutes of
   bounded effort does not fix it: record the failure honestly in the run
   report, commit whatever IS green, move on. A failed gate is never hidden.

---

## 2. Context the fixes need (read once; locate code by SYMBOL, not line)

### 2.1 The fee code map

| Concern | File |
|---|---|
| Pure money maths (no db imports) | `packages/services/src/fees-maths.ts` — `toCents`/`fromCents` (accepts leading `-` for re-open deltas), `splitIntoBuckets`, `headConcessionTotals` (HAS the H1 per-head clamp at the head's annual), `apportionHeadTotal`, `computeLateFee`, `allocateOldestFirst` |
| Configuration CRUD + concessions | `packages/services/src/fees.service.ts` — `createConcession` (computes audit amount server-side, floor), `listActiveLateFeeRules(scopes)` |
| Billing engine | `packages/services/src/fees-billing.service.ts` — `assignFeeStructure`, `generateInstallments` (idempotent: ON CONFLICT DO NOTHING on assignment+head+number), `recomputeAssignmentConcessions`, `createOpeningBalance` |
| Collection + ledger | `packages/services/src/fees-collection.service.ts` — `recordPayment` (the ONE transaction: idempotency pre-check → receipt-sequence `FOR UPDATE` → installments `FOR UPDATE` in id order → allocations → `paid_amount`/status → ledger INSERTs), `applyToInstallments` (private, takes negative deltas for re-open), `transitionPayment`/`clearPayment`/`bouncePayment`/`reversePayment`/`cancelPayment`, `recordRefund`, `waiveInstallment`, `recordGatewayPayment`, reads (`listDues`, `listPayments`, `getPaymentDetail`, `listLedger`) |
| Wire schemas | `packages/contracts/src/contracts/fees.contract.ts` — `money` regex, `feePaymentModeSchema` (includes `online_portal`), `recordPaymentSchema` (currently carries a client-supplied `lateFeeAmount`), `gatewayPaymentSchema`, all select schemas |
| Routers | `packages/trpc/src/routers/fees.router.ts` — 36 endpoints; mutations gate on `staffProcedure` with a REQUIRED `schoolId` parent; `fee_payment:approve` (SENSITIVE — fresh DB read) gates the transitions |
| Webhook route | `apps/api/src/fees-webhook.ts` — `POST /api/webhooks/fees`, HMAC-SHA256 over the RAW body (`express.raw`, mounted BEFORE `express.json()`), timing-safe compare, header `x-fee-webhook-signature` (hex); 401 bad signature (generic wording), 400 malformed JSON, 422 business refusal |
| Fees integration suite | `packages/trpc/src/integration/fees.integration.test.ts` — builds its OWN org per run (slug `fees-itg-<ts>`), per-run students (`freshStudent(tag)`), helpers `assignAndGenerate`, `installmentsOf`, `paise` (money→BigInt-cents: `BigInt(money.replace(".", ""))` — `BigInt("0.00")` THROWS, always use `paise` in assertions) |
| Live smoke | `apps/api/scripts/smoke-authz.ts` — `query`/`mutate` helpers, `report()`; existing fee cells: accountant records a payment, due list shrinks by one, teacher FORBIDDEN on record, 3 signed-webhook checks |
| Seed | `apps/api/scripts/seed.ts` — fee reality: heads, structure, assignment (explicit `feeEffectiveFrom: currentYearA.startDate` — do not "fix" this, it is deliberate), one cleared payment keyed `client_reference = "seed-receipt-001"` |
| DB schema/CHECKs | `packages/db/src/schema/fees.ts` + migrations 0010–0012; the 0012 backstops: `fee_installments_net_non_negative`, `fee_installments_concession_capped`, `fee_installments_paid_capped` (with waived/cancelled OR-leg) |

### 2.2 Hard rules that bind this work (from AGENTS.md / docs/CONVENTIONS.md)

- **Hard rule 3:** `financial_transactions` is append-only, ENFORCED by the
  0011 trigger. Never UPDATE/DELETE a ledger row in code. Any cleanup script
  must DROP the trigger first and recreate it after (see S6).
- **Hard rule 4:** money is decimal-strings on the wire, BigInt paise in
  code. `toCents` accepts a leading minus (re-open deltas); DB columns stay
  CHECKed non-negative themselves.
- **Hard rule 1:** every service query filters by the required `DataScope`
  argument. Never add a query without the scope filter.
- **Hard rule 2:** no hard deletes of money/people rows — EXCEPT the
  owner-approved reset script (S6), which is dev-fixture cleanup, not a
  product path.

### 2.3 Tooling truths learned the hard way (do not rediscover)

- **Git Bash heredocs eat `${...}` and backticks** — a `cat << 'EOF'` append
  of test code got truncated mid-file once. For appending code with template
  literals, use the Write tool or a `node` patch script, not heredocs.
- `BigInt("1200.00")` throws. Use the suite's `paise()` helper.
- The API must be RUNNING for the smoke: from repo root
  `npx dotenv-cli -e .env -- pnpm --filter @repo/api dev`
  (plain `pnpm --filter @repo/api dev` did NOT load the root .env in this
  environment). Health check: `curl http://localhost:4000/health`.
- **The sign-in limiter (20/15min) trips during smoke iterations.** Restart
  the API between smoke runs: `taskkill //F //IM node.exe`, relaunch, wait
  ~30s for health.
- `check:openapi` is the only gate that sees REST-path/input mismatches
  (it caught a real `{id}` naming bug in F6). Re-run it after ANY contract
  change.
- The fees integration fixture accumulates orgs per run by design
  (`fees-itg-<ts>`); S6 adds an optional cleanup for them.
- `db:verify` rejects by constraint NAME (`expectReject`); the ledger
  trigger raises P0001 with no name — match the MESSAGE
  (`expectTriggerReject` helper, "append-only").

---

## 3. Findings and owner decisions (verbatim — do not re-ask)

| # | Finding (severity) | Owner decision |
|---|---|---|
| F1 | `recordPayment`'s idempotency hit returns the original payment WITHOUT checking it matches the new payload (student/amount). A gateway bug reusing an order id across payloads would get a wrong-but-healthy-looking 200. (Low) | **FIX — S1** |
| F2 | A payment's `academicYearId` is never validated against the installments it allocates; a year-X payment can allocate year-Y installments. Ledger year-scoped reads then misreport. (Medium-Low) | **FIX — S1** |
| F3 | `lateFeeAmount` is client-supplied in `recordPaymentSchema` — the "never trust amount/late fee from the client" anti-pattern. It is ledger-logged and bounded by nothing but the caller's honesty. (Medium) | **FIX — S1: compute server-side; DELETE the field** |
| F4 | Staff can pass `paymentMode: "online_portal"` on a counter payment; only the webhook should write that mode. (Low-Medium label-integrity) | **FIX — S1: strip from the staff contract** |
| F5 | Concession `validFrom`/`validTo` are validated for ORDER but never READ: every concession applies to every installment regardless of its window. An accountant granting a "Jun–Aug sibling discount" silently discounts the whole year. (Medium) | **FIX — S2: honor windows ("dont delay it")** |
| F6 | `recomputeAssignmentConcessions` has a TOCTOU: it reads installments and decides frozen-ness OUTSIDE the transaction, then updates inside without re-locking. A payment committing between read and write can be restated under. If `paid > new net` the 0012 `paid_capped` CHECK aborts loudly (backstop works); if `paid <= new net` the drift is silent. (Medium) | **FIX — S2** |
| F7 | Mid-year structure line additions generate new installments for existing assignments while the assignment's snapshotted `base/net_annual_amount` headers are never restated → header vs sum-of-installments drift. | **DOCUMENT ONLY — S2: a DOMAIN.md note; no behavior change** |
| F8 | Separation of duties: the accountant holds both `fee_payment:create` and `fee_payment:approve` (record AND reverse with one login). Append-only ledger makes it detectable, not preventable. | **Owner: detect-only for now; "we need to add different permission for it later."** Record as a deferral; DO NOT implement. |
| F9 | `authz_audit_log` has no writer (dead table since Phase 1). | **Owner: not needed for fees now.** Keep deferred; do not wire it here. |
| F10 | No Postgres RLS; tenancy is application-level. | **Owner: "we will have to implement RLS later."** Keep the existing recorded deferral (revisit before student-portal launch). Do not implement. |
| F11 | Demo org has drifted (UI-test rows: a third academic year, extra students/enrollments/sections), breaking 21 smoke exact-count assertions. | **Owner: "if my data is making issues to test then delete it." → build and RUN the reset (S6).** |

---

## 4. WAVE 1 — code fixes

### Commit S0 — `docs: the fees security-hardening plan` (THIS FILE)

- [ ] This file committed as-is on the feature branch (tick this box in the
      same commit; it is the F0 precedent).
- [ ] Run report gains a STATUS line pointing at this plan.

**Verify:** `git status` clean after commit.

### Commit S1 — `fix(services,contracts): collection trust hardening`

Four independent fixes to `recordPayment` and the contracts. Each has its
own test. Read `recordPayment` end-to-end first — the fixes slot into its
existing transaction in specific places.

- [ ] **F1 — idempotency payload match.** The pre-check (immediately after
      the `if (input.clientReference)` guard, the `SELECT ... WHERE
      school_id AND client_reference` lookup) currently returns `existing`
      unconditionally. Change it to verify the hit MATCHES the request:
      `existing.studentId === input.studentId` AND `existing.amount` equals
      the sum of the input's allocation amounts (compare paise, string-safe).
      On mismatch throw:
      `"This payment reference was already used for a different payment."`
      (worded; `translateErrors` maps service Errors to BAD_REQUEST).
      Rationale: an idempotency key is a promise about a SPECIFIC payload.
- [ ] **F2 — year consistency.** In the lock loop (the `for (const
      allocation of input.allocations)` block over the `FOR UPDATE` rows),
      the select currently fetches `id, studentId, netAmount, paidAmount,
      paymentStatus`. Add `academicYearId` to the select and add the check:
      `inst.academicYearId === input.academicYearId`, else throw
      `"Every allocated installment must belong to the payment's academic year."`
- [ ] **F3 — server-side late fee (the big one).**
      1. DELETE `lateFeeAmount` from `recordPaymentSchema` in the contracts.
         Grep for `lateFeeAmount` usages across tests/smoke/seed and update
         (believed: none pass it today — verify by grep).
      2. In `recordPayment`, replace `const lateFeeCents = input.lateFeeAmount
         ? toCents(input.lateFeeAmount) : 0n` with a computation, performed
         INSIDE the transaction AFTER the installment locks:
         a. Load the assignment: `studentFeeAssignments` by the locked
            rows' `studentFeeAssignmentId` (all locked rows share it —
            assert that too while you are there: one installment list,
            one assignment; a mixed allocation is a refusal).
         b. Load the school's ACTIVE rules once:
            `feesService.listActiveLateFeeRules([scopeAtSchoolLevel])` —
            import `feesService` (cross-service import within
            @repo/services is established: fees-billing imports academic
            helpers).
         c. For EACH allocated installment: `computeLateFee(
              { dueDate, balanceCents: net - paid },
              rules, assignment.feeStructureId, input.paymentDate)` —
            i.e. the fee is computed on the installment's outstanding
            balance as of the payment, per the already-tested selection
            policy (structure-named rule beats school-wide; latest
            effective_from wins; grace shifts; cap applies). Sum across
            the allocated installments. A payment allocating only
            not-yet-due installments computes 0 — correct.
         d. `fee_payments.late_fee_amount` and the single
            `late_fee_charged` ledger row keep working exactly as now,
            fed by the computed value. This is the plan's "computed live,
            frozen when charged" invariant, now enforced by the server.
         e. `recordGatewayPayment` inherits this automatically (it calls
            `recordPayment`) — online payments pay the same late-fee
            policy. That is intended; state it in the code comment.
      3. Update the REVIEWER's contract expectation: the only client-supplied
         money field left in `recordPaymentSchema` is per-installment
         allocation amounts, which are bounded by the live-balance re-check
         under row locks (cash-at-a-desk has no oracle; the balance check
         IS the bound). Late fee, totals, statuses: all server-authoritative.
- [ ] **F4 — strip `online_portal` from the staff wire.**
      1. In the contracts: add `feeCounterPaymentModeSchema =
         z.enum(["cash","upi","cheque","neft_rtgs","card","dd"])` and use it
         in `recordPaymentSchema.paymentMode`. KEEP the full
         `feePaymentModeSchema` (with `online_portal`) exported — the DB
         enum and select schemas are unchanged; NO migration.
      2. In `fees-collection.service.ts`, `recordPayment`'s input type comes
         from the contract, so `recordGatewayPayment` (which writes
         `paymentMode: "online_portal"`) would no longer type-check. Fix
         WITHOUT a cast: give `recordPayment` an optional internal options
         parameter —
         `recordPayment(scope, input, actorId, opts?: { mode?: "online_portal" })`
         — where the persisted mode is `opts?.mode ?? input.paymentMode`.
         Only `recordGatewayPayment` passes `opts`; the tRPC router cannot
         (it is not in the wire contract). This keeps the union at the type
         level and the gate at the wire level.
- [ ] **Tests (add to the fees integration suite, its fixture pattern):**
      - Idempotency: same `clientReference`, DIFFERENT amount → refuses
        with the new wording; same key + same payload twice → still one
        receipt (existing test keeps passing).
      - Year mismatch: allocate a year-Y installment on a year-X payment →
        refused with the new wording.
      - Late fee: create a `late_fee_rules` row (flat, grace 0) for the
        structure; let an installment go 5 days past due; record a payment
        allocating it → `fee_payments.late_fee_amount` equals the rule's
        value, and exactly one `late_fee_charged` ledger row exists.
        A payment on a NOT-yet-due installment → late fee 0.00, no
        `late_fee_charged` row. A `per_day` rule × days late, and a
        `max_late_fee` cap case, if cheap to add.
      - online_portal: `recordPayment` with `paymentMode: "online_portal"`
        now FAILS CONTRACT VALIDATION in a test that calls the zod schema
        directly (no HTTP needed): `recordPaymentSchema.safeParse(...)` →
        failure. Plus: the gateway path still writes `online_portal` and
        enters `pending` (existing gateway test asserts pending — keep
        green).
- [ ] `check:openapi` re-run (contract changed).

**Verify:** `check-types` 8/8; services unit suite green; integration green
(+~4 tests); `check:builders`; `check:openapi`; lint clean.

### Commit S2 — `fix(services): concession validity windows + the recompute race`

- [ ] **F5 — honor windows.** Chosen semantics (stated to the owner): a
      concession contributes to an installment iff
      `validFrom <= installment.dueDate` AND
      (`validTo == null` OR `installment.dueDate <= validTo`).
      Implementation shape: add a PURE function in `fees-maths.ts` —
      `windowedConcessionShares(concessions, buckets, headAnnualCents)` →
      per-bucket cents — where each bucket's share is the sum of the
      concessions applicable to THAT bucket (per F5's rule; a named-head
      concession only counts for its head; an all-heads concession is
      apportioned among the window-covered buckets proportionally, floor,
      remainder to the last covered bucket), capped per bucket at the
      bucket's amount, and the TOTAL across buckets clamped at the head's
      annual (preserving H1). Wire it into `generateInstallments` and
      `recomputeAssignmentConcessions`, REPLACING the current
      `headConcessionTotals` + `apportionHeadTotal` pairing for per-bucket
      shares. `headConcessionTotals` stays exported (H1 clamp tests use it).
      NOTE: the existing H1 tests pass concessions with
      `validFrom: "2025-04-01"` and no `validTo` → applicable to every
      bucket → they must keep passing unchanged. New unit tests:
      - a Jun–Aug concession (`validFrom 2025-06-01, validTo 2025-08-31`)
        on a 12-month head discounts ONLY June/July/August buckets;
      - an all-heads concession with a window covers only its months,
        proportionally;
      - total across windowed buckets still clamped at head annual (H1
        composes with windows);
      - every share ≥ 0 and ≤ bucket amount.
      And one integration test mirroring the Jun–Aug case end to end.
- [ ] **F6 — close the TOCTOU.** In `recomputeAssignmentConcessions`, the
      installment reads (and the frozen/not-frozen decision) currently
      happen BEFORE `db.transaction`. Move the frozen re-check INSIDE the
      transaction: after opening the tx, re-SELECT the head's installment
      rows `.for("update")` and re-derive `frozen = paymentStatus !== "unpaid"
      || paidAmount !== "0.00"` from the LOCKED rows before each update.
      The pre-tx reads can stay for share PLANNING (pure math) but the
      WRITE decision must come from the locked read. Keep the 0012
      `paid_capped` CHECK as the loud backstop.
      **Honesty note for the reviewer entry:** the race window cannot be
      deterministically triggered from a test (it is a
      read-decide-write interleaving); the fix is structural and the
      assertion is that the locked re-read is on the write path.
- [ ] **F7 — DOMAIN.md note.** In `docs/DOMAIN.md` §5 (fees), add a short
      paragraph: mid-year structure line ADDITIONS generate new
      installments for existing assignments while the assignment's
      snapshotted `base_annual_amount`/`net_annual_amount` headers are
      historical snapshots of assignment time — the sum of generated
      installments is the operative truth; headers are not restated
      (recorded owner decision, 2026-09-03). Also note the percentage
      consequence: all-heads concession percentages ride the header, so a
      stale header skews concession maths for students whose structure grew
      post-assignment; revisit if a real school does mid-year edits.
- [ ] Record F8/F9/F10 as deferrals in the plan file's "Recorded
      deferrals" section (owner-verbatim, §3 table above) — no code.

**Verify:** `check-types`; services unit suite (+~5 window tests);
integration green (+1); H1/H5 suites still green unchanged.

---

## 5. WAVE 2 — pure testing (no behavior changes)

### Commit S3 — `test: the cross-tenant IDOR matrix`

All in the fees integration suite (it already has two orgs: `w.scopeA`,
`w.scopeB` — school B of org B is `w.scopeB`). Every probe asserts the
GENERIC refusal (NOT_FOUND or the service's worded error) — never a leak
message that confirms the row exists. Build the B-side fixture minimally:
org B needs its own student + assignment + installments (reuse the fixture
helpers with `w.scopeB`; `findOrCreateStudent` is org-parameterized by
admission number — parameterize the helper call with B's ids).

- [ ] `getPaymentDetail(scopeB, foreignPaymentId)` → null/NOT_FOUND.
- [ ] `bouncePayment` / `reversePayment` / `cancelPayment` addressed from
      scopeB against an org-A payment id → "Payment not found in this
      school."
- [ ] `recordRefund` from scopeB on a foreign payment → same.
- [ ] `waiveInstallment` from scopeB on a foreign installment → same.
- [ ] `generateInstallments` / `recomputeAssignmentConcessions` /
      `createConcession` from scopeB on a foreign assignment id →
      "Fee assignment not found in this school."
- [ ] `listDues` with scopeB + a foreign studentId → the foreign student's
      rows are invisible (list scoped by scopeB's school returns nothing
      for that student).
- [ ] `recordGatewayPayment` with orgB's organizationId + org-A student →
      "Student not found." (schoolOfStudent is org-filtered).
- [ ] `getFeeHeadById` / `getFeeStructureById` / `listFeeStructureLines` /
      `updateFeeStructureLine` with foreign ids → null / NOT_FOUND /
      empty list.
- [ ] **Receipt-number guessing:** an org-B caller reading
      `getPaymentDetail` for the org-A payment's id (not the receipt
      string — the id) is the IDOR case above; ADDITIONALLY assert that
      `fee_payments.school_receipt_uq` uniqueness is PER SCHOOL: school B
      can have its own `RCP-2025-00001` (a `db:verify` assertion already
      covers this — reference it in a comment, do not duplicate).
- [ ] **Router-level (over live HTTP, in the smoke):** the accountant's
      cookie requesting `fees.payment.detail` with a FOREIGN-ORG payment
      id + their own org/school ids → expect NOT_FOUND (the generic
      wording), proving the wire path composes the node gate with the row
      filter. This is the one new smoke cell; the rest of the matrix is
      service-level per the repo's evidence model.

**Verify:** integration green (+~9); smoke green on the new cell (restart
API first — limiter).

### Commit S4 — `test: webhook hostile edges + fee role-matrix cells`

- [ ] **Webhook edges (smoke, live HTTP):**
      - NO `x-fee-webhook-signature` header → 401.
      - Valid signature over MALFORMED JSON bytes (`"{not json"` signed
        correctly) → 400.
      - Signature computed with the WRONG secret over a valid body → 401.
      - (Existing signed-accept / tamper / replay cells keep passing.)
      Compute HMACs exactly as the existing smoke block does
      (`createHmac("sha256", process.env.FEE_WEBHOOK_SECRET).update(raw)`).
- [ ] **Role-matrix fee cells (smoke).** FIRST read
      `packages/authz/src/defaultPermissions.ts` and DERIVE each cell from
      the matrix — do not trust this plan's paraphrase; record what you
      find in the reviewer entry. The cells to pin (expected outcomes per
      the matrix as of writing):
      - class_teacher: `fees.installment.dues` for her class → ALLOWED
        (holds `student_fee_assignment:read`; a positive cell — proves
        the gate is not just blanket-deny).
      - class_teacher: `fees.payment.record` → FORBIDDEN (existing cell;
        keep).
      - librarian: whatever fee permissions the matrix gives (VERIFY by
        reading — believed none or read-only); pin at least one denial
        (e.g. `fees.payment.record` or `fees.installment.waive`) and, if
        the matrix grants any read, pin that read.
      - staff_coordinator (org-scoped): `fees.installment.waive` → derive
        from matrix (believed no `fee_waiver:approve` → FORBIDDEN).
      - vice_principal: derive from matrix; pin one fee cell.
- [ ] Restart API before the smoke run; all new cells PASS.

**Verify:** smoke +N cells all PASS; no regression in the 143 existing
passing cells (the 21 drift failures are addressed NEXT).

### Commit S5 — `chore(api): demo-org reset script`

- [ ] New file `apps/api/scripts/reset-demo.ts` (run pattern like the
      seed: see `apps/api/package.json` scripts; add
      `"reset:demo": "tsx scripts/reset-demo.ts"` and a root-script
      `reset:demo` wiring dotenv like `db:seed`).
- [ ] Scope: deletes ONLY the org with slug `demo-trust` (read the slug
      from the seed's constants) plus the better-auth `user` rows whose
      emails end `@demo-trust.test` (the seed re-creates them via
      `signUpEmail`). Optional `--fees-itg` flag additionally deletes the
      accumulated `fees-itg-%` orgs (the integration fixture's per-run
      worlds — their rows accumulate by design; this is the sanctioned
      cleanup).
- [ ] Deletion order (FK-safe, EMPIRICALLY VALIDATED during the Phase 4
      run — do not reorder without testing):
      1. `DROP TRIGGER IF EXISTS financial_transactions_append_only_trg ON
         financial_transactions` — hard rule 3's trigger blocks ledger
         DELETEs; this is a dev-fixture script, the ONLY sanctioned
         trigger-drop.
      2. Per student of the org(s): `fee_refunds` → `payment_allocations`
         (by payment ids) → `financial_transactions` (by student) →
         `fee_payments` → `fee_installments` → `fee_concessions` →
         `student_fee_assignments` → `opening_balances` →
         `student_enrollments` → `students`.
      3. Then the rest of the subtree:
         `fee_structure_lines` → `fee_structures` → `fee_heads` →
         `attendance_records` → `daily_attendance_status` →
         `attendance_summary` → `academic_calendar` →
         `section_teacher_assignments` → `periods` →
         `attendance_policies` → `class_subject_mappings` → `subjects` →
         `sections` → `terms` → `academic_years` → `classes` →
         `student_portal_access` → `scope_nodes` (org's nodes) →
         `role_assignments` → `org_role_permissions` → `schools` →
         `organizations` → the demo `user` rows.
      4. `CREATE TRIGGER financial_transactions_append_only_trg BEFORE
         UPDATE OR DELETE ON financial_transactions FOR EACH ROW EXECUTE
         FUNCTION financial_transactions_block_mutation()` — restore, and
         ASSERT it exists afterward (query pg_trigger).
      5. Print a summary of deleted rows per table.
- [ ] Safety rails: require `--yes` argv or refuse to run; print the target
      org ids and row counts BEFORE deleting; refuse if `NODE_ENV` is
      `production` (belt and braces — this script must never be pointable
      at a real tenant).
- [ ] Redis note: the authz cache (5-min TTL) keys by userId; deleted
      users' keys go stale-harmless. No flush needed; note it in the script.
- [ ] **RUN IT (owner-approved):** `pnpm reset:demo --yes` (plus
      `--fees-itg`), then `pnpm db:seed`, then `pnpm db:verify` (119 PASS),
      then restart the API and run the FULL smoke.
- [ ] **Expected result: the 21 drift failures are GONE** — smoke goes to
      all-green (~164/164). If any remain, they are REAL — investigate
      before proceeding; do not paper over.

**Verify:** script is re-runnable; post-reset seed + db:verify + smoke
all-green; trigger restored (db:verify proves it).

### Commit S6 — `test: property-based money maths`

- [ ] `pnpm --filter @repo/services add -D fast-check`; lockfile committed.
- [ ] New file `packages/services/src/fees-property.test.ts`. Properties
      (each: `fc.assert(fc.property(...))`, default numRuns is fine; keep
      the whole suite under ~10s):
      1. **Exact split:** for random annual paise (1..10^8), frequency in
         {monthly, quarterly, half_yearly, upfront, annual}, month range,
         full-charge joiner: `sum(bucket.amountCents) === annual` EXACTLY.
      2. **Prorated joiner:** with `joiningMonthFullCharge: false` and a
         mid-month effective date: `sum <= annual`, joining bucket equals
         `floor(base * remainingDays/dim)` (the documented shrink — this
         is the ONE exception to exactness; assert it precisely).
      3. **Clamp:** for random concession lists (mixed named-head and
         all-heads, random amounts 0..2×annual): every head's total
         `<= annual`, and (with full-year windows) per-bucket share `<=`
         bucket amount → net ≥ 0, using the S2 windowed function with
         full-year windows.
      4. **Windows:** random windows; a bucket is discounted > 0 ONLY if
         its due date lies inside some concession's window; buckets outside
         every window get exactly 0.
      5. **Late fee:** random rules/days: fee is 0 within grace; `per_day`
         fee is monotonic non-decreasing in days past grace; capped rules
         never exceed `maxLateFee`; percentage fee ≤ balance × pct.
      6. **Gateway allocator:** random outstanding lists: the returned
         allocations sum EXACTLY to min(total, available); every
         allocation ≤ its balance; allocations are oldest-due-first
         ordered; total > available → null.
      Money generation: build paise as `fc.integer({min: 1, max: 10_000_000})`
      then `fromCents` — never generate floats.
- [ ] If a property FAILS: it found a real bug — fix the implementation
      (not the property), record it in the reviewer entry, and re-run.

**Verify:** services suite green (38 + windows + properties); full
`pnpm test` green; runtime sane.

### Final: full verification surface + docs

- [ ] Full gates: `check-types`, `pnpm test`, `pnpm test:integration`,
      `db:verify` (119 — unchanged; NO migration in this plan),
      `check:builders`, `check:openapi`, `pnpm lint`.
- [ ] Live smoke: all-green after S5's reset (restart API first).
- [ ] Run report: STATUS → COMPLETE; per-commit entries present;
  "Shortcuts and honest confessions" updated with anything real.
- [ ] `docs/TASKS.md` resume-here: update the commit count (13 → 20),
      the verification numbers, and note the security-hardening slice
      shipped (one paragraph; the details live in this plan + report).

---

## 6. Commit ledger

| # | Commit message | Chunk |
|---|---|---|
| 0 | `docs: the fees security-hardening plan` | S0 |
| 1 | `fix(services,contracts): collection trust hardening` | S1 |
| 2 | `fix(services): concession validity windows + the recompute race` | S2 |
| 3 | `test: the cross-tenant IDOR matrix` | S3 |
| 4 | `test: webhook hostile edges + fee role-matrix cells` | S4 |
| 5 | `chore(api): demo-org reset script` | S5 |
| 6 | `test: property-based money maths` | S6 |

(Commit bodies: write them like the previous fee commits — what, why, the
invariant, the proof. Read `git log main..HEAD` for the house voice.)

## 7. Reviewer's-guide entry format (append one per commit, same as the Phase 4 plan)

```
- **Commit Sn: `<subject>`** — one-sentence claim.
- **Files** — every file touched, why in ≤5 words each.
- **Read in this order** — 3–6 symbol/file anchors, each phrased as the
  QUESTION the reviewer is asking there, not a description.
- **Invariants exercised** — which hard rules / §3 findings.
- **Verify yourself** — exact commands + expected numbers.
- **Known shortcuts** — anything expedient, stated bluntly; "none" must be true.
```

## 8. What NOT to do

- Do not commit to main, push, or merge (owner's acts).
- Do not implement F8 (separation of duties), F9 (audit-log writer), or
  F10 (RLS) — recorded deferrals with owner decisions.
- Do not add a migration — the fixes are contract/service-level by design.
- Do not change the seed's `feeEffectiveFrom` pin or the idempotent
  generator's ON CONFLICT behavior.
- Do not weaken any assertion to make a gate pass; a red gate is information.
- Do not reset the demo org without the `--yes` flag path (the script
  enforces this anyway).

## 9. Handoff line for the run report

When all seven commits land: STATUS → `HARDENING COMPLETE — 20 commits,
awaiting owner review`; verification surface table updated with the new
numbers; handoff: "Owner reviews via this plan's Reviewer's guide (§7
entries) and the Phase 4 plan, then merges. Next: the fees UI slice or
Phase 5 exams — owner's call."
