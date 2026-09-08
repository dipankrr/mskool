# Phase 6a Bug Inventory — Exam/Result System

The detector's raw findings before fixes, with evidence. Each entry: what a
user saw, the root cause, the fix. Everything here is fixed and locked by
the conformance suite (`packages/trpc/src/integration/exam-conformance.integration.test.ts`)
and the HTTP walk (15/15 steps, fresh exam, full lifecycle).

## Why every gate was green while all of this was broken

Four suites, each testing a different layer, none testing the seams:
integration called services directly (bypassing router input parsing);
smoke:authz tested authorization, not happy paths; e2e walked route mounts
and two flows, never the exam dialogs; property tests checked pure math.
No suite sent a real UI-shaped payload through the real router. That is
the class of every bug below. The conformance suite now exists precisely
to hold that seam.

## BUG-1 — Creating an exam from the UI could never work

- **User impact:** "Add exam" → 400, every time, since S2.
- **Root cause:** `createExamSchema` overrode `weightageInTerm` with a
  required `pct100`, discarding drizzle-zod's default-derived optionality;
  the dialog never sent the field (there was no field to send).
- **Fix:** contract omits nothing new — the payload without the field is
  accepted and the DB default `100.00` applies (verified by the suite's
  "WITHOUT weightageInTerm" test). The dialog now also SHOWS the weightage
  prefilled at 100, because it changes term math and hiding it was its own
  UX bug (the term-weightage invariant is the guard, not obscurity).

## BUG-2 — Saving schedules/components from the UI could never work

- **User impact:** the ScheduleDialog and ComponentsDialog saved nothing:
  400 "expected string, received undefined" on `id`.
- **Root cause:** every owner-resolved procedure addresses its row as `id`
  (ADR-027; the builder attaches and validates it). The batch-save
  contracts named the envelope field `examId`/`scheduleId`, and — worse —
  the ROW schemas still required per-row `examId`/`scheduleId` keys the
  dialogs never put in rows.
- **Fix:** row schemas omit the parent keys (the service stamps
  `examId: input.id` / `scheduleId: input.id` on every row — a per-row key
  could only enable cross-parent drift). Envelope uses `id`. The dialogs
  were already id-shaped from the family-login slice; the contracts and
  the seed were brought into line.

## BUG-3 — Saves returned stale empties (the connection race)

- **User impact:** a successful schedules/components save responded with
  `[]` — the UI re-fetched into the same race and the freshly saved rows
  appeared missing.
- **Root cause:** `saveSchedules`/`saveComponents` ended with
  `return db.select()` INSIDE the transaction callback — a second pool
  connection that cannot see the uncommitted rows. Same class as the
  applyRevision fix from B6.
- **Fix:** read back through `tx`.

## BUG-4 — Every deliberate workflow refusal showed as "Something went wrong"

- **User impact:** the coverage gate, the term-weightage invariant, the
  freeze locks, the verification gate, the publish gates, revision-window
  guards, the autosave conflict — all 500'd with the generic message.
  ADR-032's "worded errors, never a silent flip" died at the HTTP boundary.
- **Root cause:** `translateError` words only Postgres constraints (by
  name) and service errors via `SERVICE_TRANSLATIONS` (by message regex).
  The exam domain contributed ~25 deliberate throws; none were listed.
- **Fix:** the exam-domain block added to `SERVICE_TRANSLATIONS` —
  coverage, weightage sum, lifecycle map, template locks, verification
  completeness, publish gates, revision windows, grading-band rules,
  portal-credential refusals. The HTTP walk now shows each gate wording
  itself (e.g. the weightage refusal that correctly stopped a second
  counting exam in a full term).

## BUG-5 — Mapping a subject from the class page could never work

- **User impact:** "Map subject" on the class curriculum could not
  succeed — the service requires `subjectTypeId` (ADR-032's core idea),
  the dialog never sent one.
- **Fix:** the dialog gains the Result-type picker (with help text saying
  what the type decides), required before submit.

## Verified fixed, end to end

The HTTP walk (fresh mock exam on the seeded demo): create → save
schedules → save components → transitions (scheduled → ongoing →
marks_entry) → grid read → full-class marks entry (both components, every
roster student) → eligibility recompute → readiness → under_verification →
compute → publishClass → cards.versions (v4) → cards.classSet (2 cards).
All 15 steps green. The conformance suite replays the same walk through
`createCaller` with UI-shaped payloads — 5/5, including both create
payloads (with and without weightage), the reads, the full workflow, and
the setup-screen payloads.

## Deliberate non-bugs the walk confirmed working

- Two counting 100-weight exams in one term → refused, worded (BUG-4 fix).
- Partial marks entry → verification refused, worded, with the count.
- Publishing before under_verification → refused, worded.
- Marks entry before marks_entry state → refused, worded.

## Not fixed in this pass (recorded, not silently dropped)

- **Grade-only entry UI:** the marks grid is numeric-only; graded-only
  subjects (Co-curricular/Personality) and term-grade areas have backend
  (`saveTermAssessment`) but no entry surface. Deferred with the owner's
  earlier lean noted; it is feature work on a working backend, not a
  broken flow.
- **No delete/end for subject mappings** (backend): a wrong mapping is
  unfixable via UI. The update endpoint only patches elective/sequence.
- Exam name/weightage edit UI (endpoint exists), section-scoped papers,
  per-component grading-scale override, negative marking — schema/service
  features without dialogs.
