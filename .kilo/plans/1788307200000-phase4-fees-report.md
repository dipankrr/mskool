# Phase 4 fees — overnight run report

**Read me first.** This file is the narrative of the overnight run
(2026-09-03 night) — what was done, what was verified, what was skipped
and why. The plan file (`1788307200000-phase4-fees.md`) is the contract;
this file is the truth of what actually happened. A morning reviewer
should read the STATUS line, then the per-chunk entries, then use the
plan's Reviewer's guide for the commit-by-commit code review.

---

## STATUS: F3 DONE, F4 NEXT

- Branch: `feature/phase4-fees`
- Last commit: F3 `feat(contracts,services): the fee configuration layer`
- Next up: F4 — the billing engine (assignment resolution, installment
  generation, concession apportionment, late-fee maths)

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
- Commit: `feat(db): billing, collection, and the ledger`
- Verify: check-types 8/8; db:verify 114/114 (24 new); the append-only
  trigger proven to reject UPDATE and DELETE and accept INSERT; generated
  balance/total columns exact-checked (700.00 / 320.00).
- Deviations / notes: two verify test bugs found and fixed mid-chunk (a
  fixture missing late_fee_amount; an always-true placeholder assertion
  removed on principle). `last_number` narrowed bigint → integer (reasoned
  in the plan's reviewer entry). `db:migrate` prints a benign identifier-
  truncation NOTICE for the long `student_optional_fee_subscriptions_*_fk`
  constraint names — cosmetic, Postgres truncates >63-char identifiers.

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

### F3 — fee configuration contracts + services
- Status: done
- Commit: `feat(contracts,services): the fee configuration layer`
- Verify: check-types 8/8; unit suite green (86 authz + 48 web + 32 trpc);
  lint clean on the new files.
- Deviations / notes: concession amounts computed in BigInt paise with floor
  division (never a float, never over-discount). Aggregate cap (sum of a
  student's concessions vs base) deferred to F4's apportionment engine where
  it belongs. Structure lines have no deactivate — corrected by update.
