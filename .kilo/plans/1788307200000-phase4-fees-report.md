# Phase 4 fees — overnight run report

**Read me first.** This file is the narrative of the overnight run
(2026-09-03 night) — what was done, what was verified, what was skipped
and why. The plan file (`1788307200000-phase4-fees.md`) is the contract;
this file is the truth of what actually happened. A morning reviewer
should read the STATUS line, then the per-chunk entries, then use the
plan's Reviewer's guide for the commit-by-commit code review.

---

## STATUS: HARDENING S1 COMMITTED, S2 DONE (uncommitted) — S3 next

- Branch: `feature/phase4-fees` (15 commits ahead of main + S2 working tree, unmerged)
- Last commit: `fix(services,contracts): collection trust hardening`
- S2 `fix(services): concession validity windows + the recompute race`
  implemented and green, NOT committed — owner reviews then commits per chunk.
- Next: S3 (cross-tenant IDOR matrix), same pattern.

---

## Run summary

All eight chunks landed. Phase 4 fees is backend-complete on
`feature/phase4-fees`: 14 tables across migrations 0010/0011, the
contract → service → router chain (36 REST endpoints over three service
files), the billing engine, collection with the row-locked receipt
sequence and the idempotency key, the ADR-009 webhook seam, a 34-test
hermetic maths suite, a 14-test integration suite against real Postgres,
seed fee fixtures, and three live smoke checks.

## Verification surface at end of run (post-hardening)

- `pnpm check-types` — 8/8 packages green
- `pnpm test` — 204 unit tests (86 authz + 38 services + 48 web + 32 trpc)
- `pnpm test:integration` — 117 (93 authz + 24 fees), real Postgres
- `pnpm db:verify` — 119 assertions (43 fee-specific)
- `pnpm check:builders` / `pnpm check:openapi` — green; 100 endpoints (36 fee)
- `pnpm lint` — clean (pre-existing warnings only)
- `pnpm db:seed` — idempotent, fee reality seeded, payment recorded
- `pnpm smoke:authz` — 143/164; ALL 21 failures are pre-existing demo-org
  drift (a third academic year, extra students/enrollments from earlier UI
  testing); the SIX fee checks PASS (3 counter + 3 signed-webhook:
  signed-accept 200+receipt, tampered-body 401, replay returns the original
  receipt). Recommend resetting the demo org or drift-tolerant rewrites —
  owner's call.

## Per-chunk log

### F0 — plan amendment
- Status: done
- Commit: `docs: amend the Phase 4 fees plan for the overnight run` (df8ebe0)
- Deviations / notes: protocol rewritten (owner's 2026-09-03 authorization);
  migrations renumbered 0010/0011 (ADR-031 consumed 0009).

### F1 — fee configuration schema (`0010`)
- Status: done
- Commit: `feat(db): the fee configuration layer` (91f19bc)
- Verify: check-types 8/8 green; db:verify 90/90 (20 new fee assertions);
  migration reviewed purely additive before apply.
- Deviations / notes: one verify test bug found and fixed mid-chunk (the
  zero-amount assertion initially reused an existing head and hit the
  unique-pair index, not the CHECK — test fixed, schema unchanged).

### F2 — billing/collection/ledger schema (`0011`)
- Status: done
- Commit: `feat(db): billing, collection, and the ledger` (2579c80)
- Verify: check-types 8/8; db:verify 114/114 (24 new); the append-only
  trigger proven to reject UPDATE and DELETE and accept INSERT; generated
  balance/total columns exact-checked (700.00 / 320.00).
- Deviations / notes: two verify test bugs found and fixed mid-chunk (a
  fixture missing late_fee_amount; an always-true placeholder assertion
  removed on principle). `last_number` narrowed bigint → integer (reasoned
  in the plan's reviewer entry). `db:migrate` prints a benign identifier-
  truncation NOTICE for the long `student_optional_fee_subscriptions_*_fk`
  constraint names — cosmetic, Postgres truncates >63-char identifiers.

### F3 — fee configuration contracts + services
- Status: done
- Commit: `feat(contracts,services): the fee configuration layer` (538cec0)
- Verify: check-types 8/8; unit suite green (86 authz + 48 web + 32 trpc);
  lint clean on the new files.
- Deviations / notes: concession amounts computed in BigInt paise with floor
  division (never a float, never over-discount). Aggregate cap (sum of a
  student's concessions vs base) handled by F4's
  `recomputeAssignmentConcessions`. Structure lines have no deactivate —
  corrected by update.

### F4 — the billing engine
- Status: done
- Commit: `feat(contracts,services): the billing engine` (f300a28)
- Verify: check-types 8/8; NEW services unit suite 28/28 (pure maths:
  buckets, apportionment, late fee, money round-trips); full unit suite
  194 green.
- Deviations / notes: pure maths extracted to `fees-maths.ts` (no db
  imports) so the tests stay hermetic — turbo `test` must not need
  Postgres or env. Three test-expectation bugs fixed during the run (the
  implementation held). Prorated joining month SHRINKS the annual total
  rather than inflating another month (stated in code). Subscription
  installments are excluded from all-heads concessions by design (they
  price outside the structure); a concession NAMES a subscription head to
  discount it.

### F5 — collection and the ledger
- Status: done
- Commit: `feat(contracts,services): collection and the ledger` (f93bb65)
- Verify: check-types 8/8; services unit suite 33/33 (allocator tests
  added), 199 total; whole-monorepo check-types re-run after the api
  route landed.
- Deviations / notes: `clearPayment` writes NO ledger row (the movement
  was already recorded at record time; documented in the reviewer entry).
  Cancel writes no ledger row either — no money moved. Webhook mounted
  BEFORE express.json with its own express.raw parser so the HMAC covers
  the provider's exact bytes. FEE_WEBHOOK_SECRET has a dev default;
  production must set it (noted in env.ts).

### F6 — fees routers
- Status: done
- Commit: `feat(trpc): fees routers` (04ec20c)
- Verify: check-types 8/8; check:builders green; check:openapi 100
  endpoints (36 fee); unit suite 199 green.
- Deviations / notes: no per-row owner resolvers (fee rows own their
  schoolId; argued in the router head — owner may want B6 anyway). One
  real bug caught by check:openapi only: transition path params must be
  literally named `id`. The webhook route is deliberately NOT in the
  OpenAPI doc (provider-facing, signature-gated).

### F7 — integration, smoke, and seed
- Status: done (with an environmental caveat on the smoke)
- Commit: `test: fees in integration, smoke, and seed` (8384765)
- Verify: integration 107/107 (14 new fee tests incl. the receipt
  concurrency race); unit 200; seed idempotent with a payable demo
  reality; live smoke — the three fee checks PASS (140/161 overall).
- Deviations / notes: the 21 smoke FAILs are PRE-EXISTING dev-database
  drift — the demo trust accumulated a third academic year, extra
  students/enrollments/sections from UI testing, and the smoke's
  exact-count assertions break on that. I made the fixture SANITY checks
  drift-tolerant (seeded rows looked up by name/number) but left the
  assertion suite untouched — resetting the demo org (or drift-tolerant
  rewrites) is an owner decision, recommended before the next full smoke
  run. The fee integration fixture builds its own org per run
  (`fees-itg-<ts>`); rows accumulate there by design.
- Two real fixes that came out of the run: the seed's fee assignment
  needed an explicit feeEffectiveFrom (the enrollment's default of
  "today" fell outside the seeded year, collapsing the generator to one
  bucket — correct behaviour, wrong demo data), and the smoke's
  first-row lookups broke on drift (now name-based).

### H — hardening slice (2026-09-03, post-run)
- Status: done
- Commits: `fix(services,db): the concession clamp` +
  `test: webhook, invariant sweep, same-installment race`
- Verify: db:verify 119; services 38; integration 111; smoke webhook 3/3.
- What it closed, in the order the owner asked:
  1. The stacked-concession hole (found on self-review): per-head totals
     now clamp at the head's annual amount, with three DB CHECK backstops
     (migration 0012). End-to-end test: 120% stacked → capped at 100%.
  2. The webhook route finally RAN: signed accept, tamper 401, replay
     idempotency — over live HTTP, HMAC computed exactly as a provider would.
  3. The invariant sweep: a bounced+refunded+waived history balances on both
     views of the identity; paid ≤ net everywhere; allocations sum to
     principals. NOTE: the sweep's first formula was wrong (it ignored that
     bounced recordings cancel out of the net) — the LEDGER was correct, the
     test's math was not; corrected and documented in the test.
  4. The same-installment race: two concurrent FULL allocations → exactly
     one payment, the loser refused with the worded error; a
     partial-then-full interleaving ends with paid ≤ net and allocations
     equal to paid. The row locks work under contention.

### H5 — the last coverage gaps
- Status: done
- Commit: `test: the remaining transitions, subscriptions, opening balances`
- Verify: integration 117/117 — ALL SIX new tests passed on their FIRST
  run, zero code changes needed (the implementation held).
- What closed: clear/cancel/reverse transitions (state validation, ledger
  presence/absence, re-open behaviour, illegal-move refusals); optional
  subscriptions generating their own installments (full-window 12 months,
  mid-window 6 from October, structure heads untouched — the generator's
  idempotent FILL proven again by a late subscription); opening balances
  (the transactional balance + ledger row pair, the carry-forward read,
  the self-origin refusal). Late-fee WIRING remains deferred by design:
  computeLateFee is unit-tested, but no endpoint exposes the live display
  amount — that lands with the UI slice.

### S1 — collection trust hardening (F1–F4)
- Status: implemented, green, UNCOMMITTED (owner commits per chunk)
- Files: `fees.contract.ts`, `fees-collection.service.ts`, `fees.integration.test.ts` (+5)
- Verify: check-types 8/8; test 204; integration 122 (93+29); builders/openapi
  green (100 endpoints); lint 0 errors. No migration. Full reviewer entry in
  the hardening plan's Reviewer's guide entries.
- Notes: gateway dummy wire mode `"upi"` (never persisted); rules read via
  `feesService` (pool connection, config-grade); S1 rule rows deactivated
  in-test; suite runs last so no earlier test sees a rule.

### S2 — concession windows + the recompute race (F5–F7)
- Status: implemented, green, UNCOMMITTED (owner commits per chunk)
- Files: `fees-maths.ts` (+`windowedConcessionShares`), `fees-billing.service.ts`,
  `fees-billing.test.ts` (+5), `fees.integration.test.ts` (+1 Jun–Aug), `DOMAIN.md`
- Verify: check-types 8/8; test 209; integration 123 (93+30); lint 0 errors.
  H1/H5/concessions suites pass unchanged. No migration.
- Notes: 4-arg signature (deviation from the 3-arg sketch, reasoned in the
  reviewer entry); race fix structural; net restated from applied shares;
  F8/F9/F10 recorded as deferrals in the hardening plan. One tsc catch
  during the work (tuple-destructured string keys) — fixed, no test impact.


### F8 — docs
- Status: done
- Commit: `docs: TASKS.md — Phase 4 done`
- Verify: docs-only; check-types green at commit time.
- Deviations / notes: resume-here rewritten; the UI-milestone section
  demoted under its own heading; the stale "Next: Phase 4" paragraph
  replaced with the shipped-state pointer.

## Shortcuts and honest confessions

- `receipt_number_sequences.last_number` narrowed bigint → integer
  (2.1B receipts/year is margin enough; reasoned in the reviewer entry).
- `clearPayment` and `cancelPayment` write no ledger rows — the movement
  was recorded at record time, or no money moved. Documented in code.
- Cheque/UPI payments allocate immediately at `pending` (the reference's
  model); a stricter allocate-on-clear variant is a behavior change for
  the owner to decide.
- `FEE_WEBHOOK_SECRET` defaults to a dev value; production must set it.
- The smoke fixture SANITY checks were made drift-tolerant; the smoke's
  exact-count ASSERTIONS were left untouched (they fail on the drifted
  demo org, pre-existing). `check:openapi` must be re-run after any
  router input rename — it caught a real `{id}` mismatch the type
  checker could not see.
- The fee integration fixture creates one org pair PER RUN
  (`fees-itg-<ts>`); rows accumulate in the dev database by design
  (hard rule 2). Clean when next resetting.
- The fee assignment for student1 was created before the effective-date
  fix and briefly held a single 12000.00 installment; the seed re-run
  filled the remaining monthly rows (the generator's fill-missing
  behaviour working as designed). Receipt RCP-2025-00001 is that
  full-year 12000.00 payment — legitimate history, cosmetically odd.

## Handoff

1. Owner reviews the branch commit-by-commit via the plan's Reviewer's
   guide (9 commits, F0–F8), then merges to main.
2. Next work, owner's call: the fees UI slice (setup → collection
   counter → dues/ledger screens), or Phase 5 exams.
3. Before the next full smoke run: reset the demo org or make the
   remaining exact-count assertions drift-tolerant.
