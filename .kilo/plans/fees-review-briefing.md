# Fees review briefing — the two piles awaiting merge

Written 2026-09-05, before owner review. This is the front door; the
per-commit detail lives in the two reviewer's guides it points at.
One session of context, then you review on your own.

---

## What is awaiting review

| Pile | Branch | Commits | Nature |
|---|---|---|---|
| Fees backend | `feature/phase4-fees` | 20 | schema + services + routers + tests for all 14 fee tables |
| Fees UI | `feature/fees-ui` | 14 | apps/web only, stacked on the backend branch |

The UI pile's app code is **apps/web-only** (verified after the 2026-09-05
strip — see below); its remaining non-web files are `docs/TASKS.md`, the
two `.kilo/plans` records, `redesign-fees-UI-prompt.md` (the design spec),
and `skills-lock.json`.

**Where to read what:**

- Backend review: `.kilo/plans/1788307200000-phase4-fees.md` → "Reviewer's
  guide" (line ~44). Drivable top-to-bottom: per-commit claim / files /
  read-in-order questions / invariants / verify commands / known shortcuts.
- UI review: `.kilo/plans/1788440000000-fees-ui.md` → "Reviewer's guide"
  (line ~66). Same shape.
- What actually happened on the overnight UI run (recovery anchor, honest
  walk log): `.kilo/plans/1788440000000-fees-ui-report.md`.
- Backend gaps the UI deliberately did not paper over:
  `docs/FEES-BACKEND-NEEDS.md`.

## Fresh gate runs (2026-09-05, both branches)

| Gate | phase4-fees | fees-ui (rewritten) |
|---|---|---|
| `pnpm check-types` | 8/8 | 8/8 |
| `pnpm test` (unit) | 4/4 packages | 4/4 packages |
| `pnpm test:integration` | 135/135 | 135/135 |
| `pnpm db:verify` | all pass | all pass |
| `pnpm check:openapi` | pass | pass |
| `pnpm check:builders` | pass | pass |
| `pnpm lint` | — | 0 errors |
| `pnpm reset:demo -- --yes` → `db:seed` → `smoke:authz` | — | 172/172 |
| `pnpm test:e2e` | — | see TASKS.md resume-here for the final count |

Two transient, non-code failures hit during the run, both documented
behaviors, both resolved without changes: `reset:demo` refuses without
`--yes`, and `smoke:authz`/E2E sign-ins can hit the Express limiter
(20/15 min) when run back-to-back — wait out the window or restart the
API and re-run.

## The 2026-09-05 branch strip (what changed and why)

The UI branch had swept in two vendored agent skills (`ui-ux-pro-max`,
`vercel-react-best-practices`), each duplicated under `.agents/skills/`
and `.zcode/skills/` — 296 files, 154,924 lines of inert reference data.
The branch history was rewritten (two `git filter-branch --index-filter`
passes over `feature/phase4-fees..feature/fees-ui`) to remove them.
Evidence:

- `git diff --stat backup/fees-ui-pre-strip feature/fees-ui` →
  296 files, **deletions only**, zero real-file changes.
- 14 commits before and after; commit messages identical; hashes from
  the plan commit onward changed (inherent to any rewrite).
- `backup/fees-ui-pre-strip` holds the pre-strip branch until you delete
  it. Restore: `git branch -f feature/fees-ui backup/fees-ui-pre-strip`.
- Recurrence is prevented by the `.gitignore` entries for
  `.agents/skills/` and `.zcode/skills/` (an uncommitted change awaiting
  your commit — see the commit list at the bottom).

`main`'s own historical skills (shadcn + a few small ones) were left
alone deliberately — rewriting main invalidates every branch base for a
few thousand inert lines. Accepted.

## The distilled checkpoints (if you read nothing else)

Backend — highest-value questions from the guide:

1. The append-only trigger on `financial_transactions` is HAND-WRITTEN
   and covers UPDATE + DELETE (INSERT stays open). No `updated_at` column.
2. `fee_installments.balance_amount` is a GENERATED column with a
   `net = amount − concession` CHECK — money derived by the DB, not code.
3. Both receipt backstops exist (`school_receipt_uq` + partial
   `client_reference` unique); the sequence uses `SELECT … FOR UPDATE`.
4. The money wire regex refuses floats/exponents/3+ decimals; all
   concession maths is BigInt paise with FLOOR (never over-discounts).
5. Both parents (class, year) are re-read through the caller's
   `schoolId` before use — the cross-tenant hole is closed at the service.
6. Known shortcuts, stated in the guide: rule precedence
   (structure-beats-school-wide) is service policy, not a DB constraint;
   payment-status transitions are service-owned, not DB-constrained.

UI — the three rules everything was built on:

1. **Forms ARE the contracts** — RHF + zodResolver on the exact
   `@repo/contracts` schemas; money fields error through the wire regex.
2. **The UI never computes what the server owns** — totals are derived
   sums of allocations; late fee only ever displayed from the receipt;
   concession amounts toasted back from the server; no optimistic
   updates on any money path.
3. **The state machine is encoded in the UI** — illegal transitions do
   not render; approve-tier actions are hidden (not disabled) from roles
   without them.

And the durable armor: `apps/web/e2e/fees-counter.spec.ts` — three tests
(cash → receipt, cheque → pending, admin bounce → dues re-open) that
caught two real UI bugs before landing.

## Merge — DONE 2026-09-05, via a nested merge (not the sequence below)

The sequence below was the original plan; the owner chose the simpler
path after review, and it is recorded here so the deviation is
intentional, not an omission:

```bash
git checkout feature/phase4-fees
git merge --no-ff feature/fees-ui        # → 42e306e
git checkout main
git merge --no-ff feature/phase4-fees    # → bd10829
```

Why this is equivalent-and-safer here: the UI branch already contained
the backend, so the merged main tree is byte-identical to the fees-ui
tip that passed every gate; all 34 commit hashes are preserved; no
rebase, no conflict risk. Verified post-merge: `smoke:authz` 172/172 on
main. The rebase route's only advantage (two separate merge commits on
main, one per pile) was cosmetic and mattered for pile-level reverts
that are unlikely for one feature.

## Commits this session left for you (on `feature/fees-ui`)

1. `.gitignore` (modified, unstaged):
   `chore: gitignore agent skill directories`
2. `.kilo/plans/fees-review-briefing.md` (new, untracked) +
   `docs/TASKS.md` (resume-here refresh, unstaged):
   `docs: fees review briefing + TASKS.md gate refresh`
