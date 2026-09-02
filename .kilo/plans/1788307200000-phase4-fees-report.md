# Phase 4 fees — overnight run report

**Read me first.** This file is the narrative of the overnight run
(2026-09-03 night) — what was done, what was verified, what was skipped
and why. The plan file (`1788307200000-phase4-fees.md`) is the contract;
this file is the truth of what actually happened. A morning reviewer
should read the STATUS line, then the per-chunk entries, then use the
plan's Reviewer's guide for the commit-by-commit code review.

---

## STATUS: F6 DONE, F7 NEXT

- Branch: `feature/phase4-fees`
- Last commit: F6 `feat(trpc): fees routers`
- Next up: F7 — integration, smoke, seed tests

---

## Run summary

(appended at the end of the run)

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
- Commit: `feat(contracts,services): the billing engine`
- Verify: check-types 8/8; NEW services unit suite 28/28 (pure maths:
  buckets, apportionment, late fee, money round-trips); full unit suite
  194 green (86 authz + 28 services + 48 web + 32 trpc).
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
- Commit: `feat(contracts,services): collection and the ledger`
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
- Commit: `feat(trpc): fees routers`
- Verify: check-types 8/8; check:builders green; check:openapi 100
  endpoints (36 fee); unit suite 199 green.
- Deviations / notes: no per-row owner resolvers (fee rows own their
  schoolId; argued in the router head — owner may want B6 anyway). One
  real bug caught by check:openapi only: transition path params must be
  literally named `id`. The webhook route is deliberately NOT in the
  OpenAPI doc (provider-facing, signature-gated).

<!-- template per chunk
### Fx — <name>
- Status: done / partial / blocked
- Commit: <sha or "uncommitted">
- Verify: <which gates ran, pass counts>
- Deviations / notes: <anything the owner should know; "none" must be true>
-->

## Verification surface at end of run

(check-types / test / integration / smoke / db:verify counts, filled at
the end — or at the last green state if the run died mid-chunk)

## Shortcuts and honest confessions

(anything expedient, any gate that failed, any corner cut — nothing here
is acceptable to leave blank if it happened)

## Handoff

(the exact next chunk, and any message the next session needs)
