# mskool — Phase 3: attendance (with `academic_calendar`)

Six tables: **`academic_calendar`**, `attendance_policies`, `periods`,
`attendance_records`, `daily_attendance_status`, `attendance_summary`.
Slices: **C1** calendar + policies + periods, **C2** their contracts/services,
**C3** their routers, **C4** the record-layer tables, **C5** the marking flow,
**C6** the mark/status/summary routers, **C7** tests, **C8** docs. Each chunk
lands as its own commit, one layer per commit.

`academic_calendar` was deferred from Phase 2 deliberately; it is pulled in HERE
because the reference couples it to attendance twice — marking validates the
date's `day_type` before accepting an entry, and `attendance_summary`'s
"working days" denominator is unknowable without it. Building attendance without
it would mean accepting entries on Diwali and deriving working days from "days
someone happened to mark", which is the fragile data this codebase exists to
avoid.

**`attendance_corrections` (reference table 27) is DROPPED** — owner-settled
2026-08-31, replaced by a nullable `correction_reason` ON the record itself
(see Locked decisions). The reference is source material, not law; this is the
second trim after `can_mark_roles` (ADR-012), recorded as ADR-030 in C5.

## Goal

Phase 3 per the roadmap: policies, periods, dated records with section
snapshots, the authoritative daily-status layer, and the pre-aggregated summary
— behind the same contracts → services → routers → tests pipeline as every
Phase 2 slice, with the calendar as the marking gate.

## Workflow protocol — read before starting

**One chunk per turn. The owner commits (unless explicitly authorized per-instance).**

1. Implement **exactly one** chunk. Do not begin the next one.
2. Run that chunk's **Verify** steps.
3. Tick that chunk's boxes in this file as part of the same diff.
4. Run `git status` and `git diff --stat`, and summarise what changed and why.
5. Propose the commit message from that chunk verbatim; amend if the chunk grew.
6. **Stop and wait.**

Never run `git add`/`commit`/`push` without the owner's explicit per-instance
authorization. If a chunk cannot finish cleanly, stop and report rather than
leaving a broken intermediate state. Every chunk leaves `pnpm check-types` green
across all 8 packages.

## Execution order

```
C0 plan file ── C1 db ── C2 contracts+services ── C3 routers
                                                    │
        C4 record-layer db ── C5 marking flow ──────┤
                                                    │
        C6 mark/status/summary routers ── C7 tests ── C8 docs
```

C4's tables are inert until C5's flow uses them; C5 needs C1's calendar and C4's
tables. Do not read this file top-to-bottom as an order.

## Preconditions (no diff; verified 2026-08-31)

- [x] `pnpm check-types` green 8/8 at baseline (students slice committed).
- [x] `pnpm test:integration` = 80 passing; `pnpm smoke:authz` all-pass (152
      checks, 8-role matrix); `pnpm db:verify` = 37.
- [x] **Smoke gotcha, learned the hard way:** back-to-back smoke runs trip the
      sign-in rate limiter (429). Restart the dev API to reset the in-memory
      counters before re-running.

## Hard context an implementer must know

**The calendar is the marking gate.** The marking service reads the
`academic_calendar` row for (school, year, date) inside the transaction:
`working`/`exam_day`/`half_day` accepted; `holiday`/`weekend` refused; **no row →
refused** ("generate the calendar first") — the strict reading of the reference's
"validates against this before accepting an entry". Cross-table, so it cannot be
a CHECK: it lives in the service beside the parent re-reads. Refusal wordings go
into `translateErrors` (keyed on the thrown messages).

**Section + class are SNAPSHOTTED at marking time** on `attendance_records` and
`daily_attendance_status` — never live-referenced. A mid-year transfer must not
rewrite which section last month's attendance belonged to. Load-bearing for
every historical report.

**Hard rule 5 lands in C5:** `attendance_records` are write-only ground truth;
the ONLY thing downstream reads is `daily_attendance_status`. The summary and
every future phase (report cards, late fees) go through it.

**No `attendance_corrections` — records edit in place, with a reason when it
matters.** Owner-settled: disputes on attendance are not expected at this
product stage, and the five statuses (late, on_leave, …) already let a teacher
record reality. Instead of the reference's corrections table:
- `attendance_records.correctionReason` varchar(500) NULLABLE — the owner's
  design. The FRONTEND asks for a reason when editing a PAST date and does not
  ask for same-day marking; the backend stores what it receives and never
  enforces.
- Micro-rule: an update WITHOUT a reason never wipes an existing one (a
  reason-less re-mark of an already-edited row keeps the old note).
- The audit-lite trio is backend-owned: `updatedAt` + `updatedBy` on the record
  answer "was it edited, when, by whom"; `correctionReason` answers "why (if
  said)".
- The additive retrofit (a real history table) stays open if a school ever asks
  — recorded as ADR-030 in C5.

**Per-table scope columns** (the S2.4 lesson): the record/status tables carry
org+school+class+section — scopeWhere gets THEIR columns, no borrowing.

**Attendance is NOT subject-gated.** It is section-scoped — no `subjectGate`
here. `can_mark_roles`/`can_correct_roles` from the reference are DROPPED
(ADR-012: `role_assignments` is the authorization authority; the smoke matrix
pins who holds `attendance:create/update`).

**Daily vs period-wise is a PER-SCHOOL policy**, not a schema fork:
`periodId` is NULL on records for daily-mode schools, and the daily-status
derivation follows the policy's rule (direct copy vs homeroom_authoritative vs
threshold_percentage). Periods exist only for period-wise schools.

**The calendar is attendance-namespaced.** The reference files it under academic
structure, but its only v1 consumer is marking — the routers live under
`attendance.calendar.*`. Day-type enum values are lowercase (house style).

## Locked decisions

| Decision | Choice |
|---|---|
| `academic_calendar` | Pulled INTO this slice (was a Phase 2 deferral) — marking validates against it; summary needs its working days. |
| `attendance_corrections` | DROPPED (owner-settled 2026-08-31, ADR-030 in C5). Records edit in place; `correctionReason` nullable on the record captures the "why" for past-date edits. |
| `correctionReason` enforcement | Frontend convention ONLY — never validated, never required by the backend. An update without a reason preserves an existing one. |
| Marking temporal rule | NONE — `markAttendance` upserts any calendar-valid date, past or present. The reason convention is the only past/same-day distinction. |
| Record status enum | `present/absent/late/half_day/on_leave` — the reference's `Holiday` guard value DROPPED: holiday days have no records, the calendar refuses them. |
| Marking on a date with no calendar row | REFUSED (strict). The bulk generator makes this a non-event; strictness keeps "working days" honest. |
| `can_mark_roles` / `can_correct_roles` | Dropped (ADR-012). The matrix pins `attendance:create` to class_teacher/subject_teacher/vp/principal. |
| Routers | One namespace: `attendance.*` — calendar, policy, periods, mark, status, summary. |
| Snapshot rule | `sectionId`+`classId` copied onto records AND daily status at marking; never live-referenced. |
| Summary | Recomputed by the service on every mark (`recomputeSummary`); generated percentage column in the DB. |
| Commit cadence | One layer per commit; tests ride with the code they cover. |

## Chunk C0 — plan file — ✅ DONE (2026-08-31, this commit)

- [x] This file: workflow protocol, chunks, hard context, locked decisions,
      ledger. Committed before any code chunk.

## Chunk C1 — `feat(db): calendar + policies + periods` (`0007`) — ✅ DONE (2026-08-31)

- [x] `academic_calendar` (new `packages/db/src/schema/attendance.ts` — one
      file per domain; the calendar lives here too because its consumer is
      marking): org+school denormalised; year FK; `date`; `day_type` enum
      (`working/holiday/half_day/weekend/exam_day`); `reason` varchar(255);
      `createdFromTemplate`; `createdBy`; unique `(schoolId, academicYearId,
      date)`; index (schoolId, date). Relations + barrel.
- [x] `attendance_policies` (same file): ONE per school — unique `schoolId`;
      `marking_mode` enum (`daily`/`period_wise`) default `daily`;
      `daily_status_rule` enum (`homeroom_authoritative`/
      `threshold_percentage`); `thresholdPercentage` smallint nullable with
      CHECK 1–100; `lateArrivalMinutes` smallint default 15; `updatedBy` →
      user. (Also carries the denormalised `organizationId` for `scopeWhere`
      — per-table scope columns, the S2.4 lesson.)
- [x] `periods` (same file): section+year-scoped; name varchar(50); sequence;
      `isHomeroom` boolean; nullable subject FK + teacher FK; start/end TIME;
      unique `(sectionId, academicYearId, sequenceNumber)`.
- [x] `pnpm db:generate` → `0007_open_nick_fury.sql` reviewed (purely
      additive: 3 enums, 3 tables, 12 FKs, 8 indexes, 1 CHECK), migrated,
      `db:verify` extended (calendar date uniqueness incl. next-year and
      other-school acceptances; policy one-per-school + threshold 0/101/100;
      period sequence uniqueness incl. same-seq-other-section) — **53
      assertions, all green** (was 37; +14).

**Verify:** `check-types` 8/8 ✅; `db:verify` all green ✅; migration purely additive ✅.

## Chunk C2 — `feat(contracts,services): calendar, policy, periods` — ✅ DONE (2026-08-31)

- [x] `attendance.contract.ts` (grows through C5): day-type upsert schema
      (date + dayType + reason), generate input (year + working weekdays
      array), list filter (year, month?). Plus the policy upsert (with the
      refine: a `threshold_percentage` rule requires a threshold) and period
      create/update (the STA year-consistency `academicYearId` on create;
      section/year NOT patchable on update; HH:MM(:SS) `timeOfDay` regex).
- [x] `attendance.service.ts`:
      `generateYearCalendar(scope, { academicYearId, workingWeekdays })` —
      idempotent bulk (one row per date of the year, `onConflictDoNothing` on
      the (school, year, date) index — fills MISSING only; existing rows'
      day types preserved; overrides go through `upsertDay`); `upsertDay`
      (single date, any type + reason; the date must fall INSIDE the year's
      bounds — checked against the parent re-read); `listCalendar(scopes,
      year, month?)` with the required `includeHistory` +
      `yearVisibilityWhere` (the terms-list pattern). Calendar is SCHOOL-level
      (atSchoolLevel widening — no class dimension).
- [x] Policy: `getPolicy(scope)` (null before the first upsert — the marking
      flow treats missing as defaults) and `upsertPolicy` (school-scoped
      write, `updatedBy` from ctx via the actorId arg; first upsert creates
      the row, keyed on `attendance_policies_school_uq`).
- [x] Periods: section-scoped CRUD; the section re-read through its own
      table inside the transaction and the input's year must EQUAL the
      section's (the STA year-consistency pattern); optional subject
      re-read; `getPeriodOwnerId` for the B6 adapter.

**Verify:** `check-types` 8/8 ✅; unit suite green ✅ (86 authz + 38 web + 32
trpc).

## Chunk C3 — `feat(trpc): attendance.calendar / policy / periods` — ✅ DONE (2026-08-31)

- [x] `attendance.router.ts` with `calendar.generate` / `calendar.upsert` /
      `calendar.list`, `policy.get` / `policy.upsert`, `period.list` /
      `period.byId` / `period.create` / `period.update` — OpenAPI meta +
      output everywhere; **gate choices recorded in the router header:
      `attendance:update` gates every configuration surface,
      `attendance:create` RESERVED for marking (C6)** — deliberately
      different from the matrix's subject_teacher cell (create yes, update
      no: she marks but does not configure). Reads are `attendance:read`;
      calendar/policy lists are permissive (school-level facts,
      `atSchoolLevel` widening); `period.byId` is B7 overlap with a
      `resolvePeriodOwner` B6 resolver; mutations cover.
- [x] Registered under `attendance` in the root router
      (`attendance.calendar.*` / `attendance.policy.*` /
      `attendance.period.*`).
- [x] Small evolutions the routers forced: `generateYearCalendar` now
      returns `{ generated }` (an output needs an effect, not an intent);
      `getPolicyForSchool(scopes, schoolId)` added for the permissive policy
      read; one `translateErrors` entry for the date-outside-year refusal
      (the rest of the service's wordings already matched existing regexes).

**Verify:** `check-types` 8/8 ✅; `check:builders` clean ✅; `check:openapi`
lists all 9 attendance endpoints ✅; unit suite green ✅.

## Chunk C4 — `feat(db): records + daily status + summary` (`0008`) — ✅ DONE (2026-08-31)

- [x] `attendance_records`: org+school; student/year FKs; `date`; snapshotted
      `sectionId` + `classId` (NOT NULL — the snapshot rule documented on the
      table); `periodId` NULL for daily mode; `status` enum
      (`present/absent/late/half_day/on_leave`); `correctionReason`
      varchar(500) nullable; `markedBy` (original marker, NOT NULL) +
      `updatedBy` (last editor); timestamps. Indexes: (student, date),
      (section, date), (school, date), org.
- [x] `daily_attendance_status`: student/year; snapshotted section+class;
      date; the 5 statuses; `periodsPresent`/`periodsTotal` nullable;
      `derivationMode` enum (direct/homeroom_authoritative/
      threshold_percentage/manual_override); nullable `overriddenBy` +
      `overrideReason`; unique (student, academicYearId, date) + (school,
      date), (section, date) indexes. Hard rule 5 documented ON the table.
- [x] `attendance_summary`: student/year; nullable term; `periodType` enum
      (monthly/term/annual); nullable month/year keys; working/present/
      absent/late/leave counts; **generated** percentage column
      (`generatedAlwaysAs`, drizzle-visible — CASE working_days = 0 → 0);
      per-type shape CHECKs.
- [x] **Hand-written SQL:** the daily-mode double-mark guard —
      `UNIQUE (student_id, date, COALESCE(period_id, zero-uuid))` expression
      index appended to `0008_shocking_banshee.sql` (marked like 0001's
      EXCLUDEs) — plus `db:verify` assertions proving it rejects the second
      daily row and the same period twice while accepting the period-wise
      pair.
- [x] `pnpm db:generate` → `0008` reviewed (3 enums, 3 tables, 21 FKs, 3
      partial unique indexes, 4 CHECKs, 1 generated column, all additive),
      migrated, `db:verify` extended — **72 assertions, all green** (was 53;
      +19).

**DEVIATION (recorded, owner-reviewable):** the planned single composite
unique `(student, year, type, month, year)` for `attendance_summary` puts
nullable columns (`month`, `term_id`) inside a unique key — and Postgres
treats NULLs as DISTINCT, the exact trap the double-mark guard exists for.
Two `term` rows (or two identical months) would both insert. Replaced with
THREE partial unique indexes — monthly on (student, year, month, year) WHERE
monthly; term on (student, year, term) WHERE term; annual on (student, year)
WHERE annual — all drizzle-visible and verifiable by name, plus three shape
CHECKs pinning which columns each type may fill. Also not carried from the
reference: `remarks` and `leave_type` on records (the leave-approval workflow
is a recorded deferral; both are additive later if a school asks).

**Verify:** `check-types` 8/8 ✅; `db:verify` all green incl. the guard ✅.

## Chunk C5 — `feat(contracts,services): the marking flow` (+ ADR-030) — ✅ DONE (2026-08-31)

- [x] `markAttendance(scope, { sectionId, date, periodId?, entries })` — ONE
      transaction: section re-read through the scope (parent verification);
      policy read (missing row = daily-mode defaults); period agreement
      (daily + periodId → refused; period-wise without → refused; period of
      another section → refused); the calendar gate (no row → refused strict;
      holiday/weekend → refused; working/half_day/exam_day accepted); roster
      check (entries must be on the section's section_assigned/active
      enrollments); record upsert (select-then-split — the guard is an
      EXPRESSION index and cannot be an ON CONFLICT target; concurrent
      duplicate marks race the guard and surface as generic CONFLICT).
      Entries dedupe (last wins); `markedBy` on insert, `updatedBy` on edit;
      **snapshot columns written on INSERT only** — a re-mark re-marks the
      status without re-homing the row.
- [x] Don't-wipe micro-rule: an update WITHOUT `correctionReason` preserves
      the stored one; an explicit reason overwrites.
- [x] Daily-status derivation, same transaction: direct copy (daily mode);
      period-wise per policy — threshold_percentage (present-like =
      present/late/half_day vs the school's threshold, counts stored) or
      homeroom_authoritative (homeroom period's record decides; the day's
      first period falls back). Upsert on (student, year, date); the UPDATE
      path never touches snapshot columns.
- [x] `recomputeSummaries` internals + explicit `recomputeSummary` op:
      monthly/term/annual rows recomputed from daily status + calendar
      (working days = calendar truth — working/exam_day/half_day, no
      mid-period cap); pure function of source rows, never an increment;
      upserts via `targetWhere` matching the partial indexes. Called at the
      end of every mark inside the same transaction.
- [x] `getDailyStatus(scope, { sectionId, date })` — the status table's own
      four scope columns, NO widening: a section teacher sees exactly her
      section's day.
- [x] `attendance.contract.ts` completed for the marking flow:
      `markAttendanceSchema`, `attendanceEntrySchema` (correctionReason
      optional — stored, never required), `getDailyStatusSchema`, the daily
      status + summary select schemas. Hard rule 5 documented at the service
      head.
- [x] `translateErrors`: 7 new wordings (missing calendar row, holiday,
      weekend, roster stranger, daily/period mode mismatch, wrong-period).
- [x] **ADR-030** recorded in `docs/DECISIONS.md`: records edit in place;
      the corrections table dropped for the on-record `correctionReason`
      convention; the additive retrofit path (a history table fed by the
      marking service's single write seam) recorded.

**Verify:** `check-types` 8/8 ✅; unit suite green ✅ (86 authz + 38 web +
32 trpc).

## Chunk C6 — `feat(trpc): attendance.mark / status / summary` — ✅ DONE (2026-08-31)

- [x] `mark` (`attendance:create` — the permission's first and only
      consumer, reserved since C3; B5: the sectionId inside the mark payload
      IS the addressed node; cover gate), `status` (`attendance:read`,
      permissive list — the no-widening crown: the service filters on the
      status table's own four scope columns, so a section teacher sees
      exactly her section's day even addressing the school node), `summary`
      (`attendance:read`, permissive — scoped through the ENROLLMENT join:
      the summary table has no class/section columns, so the scope rides
      `student_enrollments` instead of widening; a section teacher gets her
      section's students' rows whether or not she names the section).
- [x] Flat procedures beside the sub-routers (`attendance.mark` /
      `attendance.status` / `attendance.summary`) — single actions, no
      sub-resource to group (the enrollment router's flat precedent).
      OpenAPI meta + output everywhere; `listSummariesSchema` added to the
      contract; `getDailyStatus` now takes the plural permissive scopes.
- [x] `check:builders` clean — no overlap mutations, attendance not in
      `SUBJECT_GATED_WRITES`.

**Verify:** `check-types` 8/8 ✅; `check:openapi` lists all 12 attendance
endpoints ✅; unit suite green ✅.

## Chunk C7 — `test: attendance in integration, smoke, and seed`

- [ ] Integration: holiday marking refused (worded); missing-calendar date
      refused; the SNAPSHOT pin (transfer the student's enrollment, mark again,
      the old record keeps the old section); the double-mark guard (second
      daily row rejected, period-wise pair accepted); the reason convention
      (same-day re-mark without a reason → reason null; past-date edit WITH a
      reason → stored; past-date edit WITHOUT → old reason preserved);
      derivation per policy (direct vs threshold); summary counts vs the
      calendar (working days = calendar truth); roster/permission exactness
      (who may mark, who may read).
- [ ] Smoke: mark + status cells for the marking roles; the calendar refusals
      over HTTP; prior cells unaffected.
- [ ] Seed: the demo school's policy (daily mode), the generated 2025-26
      calendar with two holidays (the refusals' non-vacuity control), printed
      in the summary.

**Verify:** integration suite green; seed idempotent; live smoke all-pass
(restart the API first if the rate limiter bites).

## Chunk C8 — `docs: TASKS.md — Phase 3 done`

- [ ] Resume-here: Phase 3 recorded, the deferral list shrinks by
      `academic_calendar`, ADR-030 noted, the verification surface updated,
      next-up pointer (Phase 4 fees or the UI milestone — owner's call).

## Commit ledger (owner commits; agent prepares messages)

| # | Commit | Chunk |
|---|---|---|
| 1 | `docs: the Phase 3 attendance plan` | C0 |
| 2 | `feat(db): the attendance calendar, policies, and periods` | C1 |
| 3 | `feat(contracts,services): calendar, policy, periods` | C2 |
| 4 | `feat(trpc): attendance calendar / policy / period routers` | C3 |
| 5 | `feat(db): attendance records, daily status, and summary` | C4 |
| 6 | `feat(contracts,services): the marking flow (ADR-030)` | C5 |
| 7 | `feat(trpc): attendance mark / status / summary` | C6 |
| 8 | `test: attendance in integration, smoke, and seed` | C7 |
| 9 | `docs: TASKS.md — Phase 3 done` | C8 |

Drift notes:
- 2026-08-31: plan written after the students slice and the verification
  hardening; `academic_calendar` pulled in from the Phase 2 deferrals per the
  reference's own coupling ("attendance marking validates against this").
- 2026-08-31: `attendance_corrections` DROPPED during planning (owner Q&A) —
  records edit in place; `correctionReason` on the record is the owner's
  design (frontend convention: asked for past-date edits, not same-day;
  backend stores, never enforces). ADR-030 lands with C5.
- The sign-in rate limiter will bite during C7's smoke iterations — restart
  the dev API to reset the in-memory counters.

## Recorded deferrals (do not silently absorb)

- Timetabling (periods' times are informational until a timetable exists).
- The leave-approval workflow (On_Leave is marker-entered in v1).
- A real corrections/history table (the additive retrofit behind ADR-030).
- Summary backfill automation beyond the explicit `recomputeSummary` op.
