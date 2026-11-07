# Family reads: fees, attendance, exams (design note)

Status: **draft for owner review, 2026-11-07. Nothing built.**

Scope agreed in conversation on 2026-11-06/07: backend first, then the owner
finalises the family app design and theme, then the screens. This note covers
the backend only. Login needs no backend (ADR-037 claim flow is done and
tested); it waits for the screen phase.

Out of scope: homework (full revamp coming), results and report cards
(separate rethink, see section 6), notices, timetable, leave requests,
messaging, events.

---

## 0. Step 0: fix the official attendance figure (agreed 2026-11-07)

Found while designing the ranking. `attendance_summary` (written by
`recomputeSummaries` in `attendance.service.ts`) divides present days by
every working day of the whole period, from the first day of the year,
including days that have not happened yet and days before the student
enrolled. Term results (`minAttendancePct`), the attendance printed on report
cards, and exam eligibility all read it, so a late joiner can fail a term on
attendance for days before she was enrolled. Mid-term, eligibility makes
almost everyone look short.

Agreed rules:

1. Working days count from the child's enrolment date. A gap between leaving
   and rejoining (`leavingHistory`) does not count.
2. The whole-period figure stays for admins ("how much of the year is
   done"), computed per child from their own days.
3. A "so far" figure (working days from joining up to today) is added; family
   screens, the ranking and pre-exam eligibility use it. This settles A1.
4. A one-time recompute over every student through the existing
   `recomputeSummary` op.
5. Unpublished term and annual results pick the new figures up on their next
   compute. Published cards keep their printed figure until reissued.

Day-to-day marking and the staff "present share" are unchanged.

6. **Speed (owner: a 15-student save takes about 20 s).** `markAttendance`
   makes its database calls one at a time: re-marked records updated one by
   one, daily status upserted one by one, then `recomputeSummaries` upserts
   every month, term and year row per student, about 200 sequential round
   trips for 15 students. Step 0 batches all three into multi-row writes, and
   a save recomputes only the marked date's month, its term and the year.
   Measure before and after on the remote database.
7. **Recompute scope:** current session only; closed sessions keep their
   figures (owner, 2026-11-07). Only the calculated totals in
   `attendance_summary` are rewritten; the daily marks never change.
8. **Late rule (owner, 2026-11-07): per-school switch** "Late counts as
   present" on `attendance_policies`, default on. Flipping it recomputes that
   school's current session. Mobile gets the toggle and a confirm sheet on the
   marking policy screen; web is left alone (the field is optional, so the web
   policy page keeps working without it).
9. **A3:** owner said "do whatever is best": 15 counted working days for
   term and year, half the month's working days so far for a month.

Still open: **A2 below.** Today `late` is NOT counted as present in the
official rate (`countSlice` counts `present` only), so a late day lowers the
percentage exactly like an absence.

---

## 1. Shared rules for every family read

- **Door.** `studentProcedure`, as `portalExam` and `portalHomework` do:
  ownership only, never `can()`. `ctx.studentIds` comes from
  `getOwnedStudentIds`.
- **One child per call.** Each read takes a `studentId` and refuses with
  NOT_FOUND (never FORBIDDEN, so ids can't be probed) when it is not in
  `ctx.studentIds`. The existing `assertStudentOwnership` helper is the guard.
- **School comes from the student, never the session.** A family can own
  children in different schools and even different organisations (the claim
  flow merges across orgs). Every read resolves the child's school and
  current enrolment first and scopes all queries by that.
- **Year.** Optional `academicYearId`; default is the child's current
  enrolment's year.
- **Own output schemas.** Never return staff select schemas (for example
  `feePaymentSelectSchema` carries `collectedBy` and internal columns). Each
  read has a narrow `portal*` contract listing exactly what a parent sees.
- **Proofs.** Integration tests per read, plus `smoke:authz` checks over HTTP:
  a family reading another family's child gets NOT_FOUND, a staff session
  without portal ownership is refused, a revoked link loses access.

Router names follow the existing pattern: `portalFees.*`,
`portalAttendance.*`, and `portalExam.schedule.*` beside the existing
`portalExam.results.*`.

---

## 2. Fees: `portalFees.*`

Source: the same service behind the admin student fee page
(`feesDashboardService.studentSummary`, contract `feeStudentSummarySchema`)
and the printed documents from ADR-059 (`fee-documents.service.ts`, merged to
`main`).

### 2.1 `portalFees.summary({ studentId, academicYearId? })`

| In | Out (staff-only) |
|---|---|
| Child name, class, section, roll number | Enrollment id/status, structure id and choices, "new student" flag |
| Totals: due now, this month, overdue, previous dues, later, paid, concession, discount | |
| Months strip: label, net, paid, balance, state (overdue / due / upcoming / paid) | |
| Dues (installments): fee head, period, amount, concession, late fee, paid, balance, due date | Internal ids beyond what the screen needs |
| Previous dues (opening balances): label, amount, paid, balance | |
| Concessions: type, amount | Calculation details; **reason: see question F2** |
| Payments: receipt number, date, mode, amount, status (cleared, cheque pending, bounced, cancelled, refunded), refunded amount | Collected by, cheque/bank internals, staff remarks, reversal reasons |

### 2.2 `portalFees.payment({ studentId, paymentId })`

One payment with its allocations (which dues it paid). Same in/out split as
above.

### 2.3 `portalFees.receipt({ studentId, paymentId })` and `portalFees.statement({ studentId, academicYearId? })`

Reuse `feeDocumentsService.receipt` and `.statement` (server-rendered HTML,
printed or shared as PDF on the phone the same way the staff app does). These
methods take a staff `DataScope` today; the family read builds a school scope
from the child's school instead of the session. The receipt already prints the
payment's remarks, which is what the parent gets on paper at the counter, so
that stays.

### Owner answers (fees), 2026-11-07

- **F1:** show the same months the admin student fee page shows today. The
  billed-monthly vs already-billed future months question is to be revisited
  later.
- **F2:** type and amount only, no reason. **F3:** show bounced and cancelled
  payments with their status. **F4:** statement PDF too.

### Questions as asked (fees)

- **F1. Future months.** The staff page shows no future months by default.
  Should parents see the whole year's upcoming months (plan ahead) or only up
  to this month? *Leaning: whole year, marked "upcoming".*
- **F2. Concession reason.** Show it ("Sibling", "Staff child") or only the
  type and amount? Reasons are typed by staff and can be blunt. *Leaning:
  type and amount only.*
- **F3. Bounced and cancelled payments.** Show them in the list with their
  status, or hide anything that did not end as money received? *Leaning:
  show with status; parents know they gave a cheque.*
- **F4. Statement PDF** as well as receipts? It is free (the document
  exists). *Leaning: yes.*

---

## 3. Attendance: `portalAttendance.*`

Source: `daily_attendance_status` (hard rule 5), `academic_calendar`,
`attendance_summary`, `student_enrollments.enrollmentDate`.

### 3.1 `portalAttendance.month({ studentId, month })`

Every day of the month: date, day type from the calendar (working, holiday,
exam day, half day, weekend), the child's status (present, absent, late, half
day, on leave, not marked yet), and holiday names. Days before the child's
enrolment date show as "not enrolled". Plus the month's counts.

### 3.2 `portalAttendance.overview({ studentId, academicYearId? })`

The child's percentage and counts for this month, each term, and the year.

### 3.3 `portalAttendance.ranking({ studentId, period })`

`period` = `{ kind: "month", month }` | `{ kind: "term", termId }` |
`{ kind: "year" }` (all three, as agreed).

Returns:
- top 10 of the child's section: rank, first name + last initial (see A4),
  percentage
- the child's own rank, percentage and the section size, or
  "not ranked yet" with the reason
- whether the period is still running

No other child's data beyond the top 10.

### 3.4 How the ranking counts

- **Who is ranked:** students actively enrolled in the child's section for
  that year. Leavers are out. A student with no section is ranked within
  their class's sectionless group only if the owner wants (question A5).
- **Percentage:** days present ÷ working days, counted the same way as the
  official figure (half day is not present, the existing rule), **but only
  over days that have happened and that the student was enrolled for.**
  Why: today `attendance_summary` uses the whole planned period as the
  denominator, so in November a year percentage reads about 40% for
  everyone, and it counts days from the start of the year even for a
  student who joined in September. Ranked on that, every late joiner sits at
  the bottom. The ranking is computed from daily status per request, which is
  cheap at section size (about 40 students), and needs no new table.
- **Ties:** equal percentages share a rank (1, 2, 2, 4). Within a tie the top
  10 list is ordered by name.
- **Minimum days to be ranked:** term and year need at least **15** counted
  working days. A month needs at least **half of the month's working days so
  far**. Below that the child sees their own percentage with "Not ranked
  yet". In the first days of a month nobody qualifies yet, and the screen
  says so.
- **Top 10 can hold more than 10** when ties straddle 10th place; all tied at
  10th are shown.

### 3.5 School switch for the top 10

Cheap: `attendance_policies` already exists per school and has an editor on
mobile (marking policy). Add one column, `familyRankingVisible boolean
default true`, and one toggle on that screen. When off, the ranking read
returns the child's own rank only, or nothing (question A6).

### Owner answers (attendance), 2026-11-07

- **A1:** settled by step 0 ("so far" for families, ranking, eligibility).
- **A2:** late should count as present by default; asked how big a per-school
  setting is (answer: small, see section 0). Awaiting go-ahead on the setting.
- **A3:** open (15 days for term/year, half the month's days so far).
- **A4:** full name in the top 10.
- **A5:** no ranking for students without a section (they cannot be marked
  today).
- **A6:** switch off shows the child's own rank only.

### Questions as asked (attendance)

- **A1. Which percentage do parents see on the overview:** the official one
  (whole planned period, matches the report card and staff screens) or the
  "so far" one the ranking uses? Showing two different numbers is
  confusing. *Leaning: "so far" on family screens, and the report card keeps
  the official one; or change the official one for everyone, which is a
  bigger decision touching staff screens and report cards.*
- **A2. Late counts as present?** The ranking follows whatever the official
  figure does today. Confirm that's what you want.
- **A3. Minimum days:** 15 for term and year, half the month's days so far for
  a month. OK?
- **A4. Names in the top 10:** full name, or first name + last initial?
  *Leaning: first name + last initial.*
- **A5. Students with no section:** rank them within the class's sectionless
  group, or don't rank them? *Leaning: don't rank; it's an edge case.*
- **A6. When the school switch is off:** show the child's own rank only, or
  hide ranking entirely?

---

## 4. Exams: `portalExam.schedule.*`

Source: `exams`, `exam_subject_schedules` (date, start time, duration,
venue, section), `exam_components` (parts and max marks),
`exam_class_publication`, and `resolvePapers` in `exam-shared.ts` for which
papers apply to which child.

### 4.1 `portalExam.schedule.list({ studentId, academicYearId? })`

Exams for the child's class with status from `scheduled` onward (never
`draft`). Per exam: name, type, term, first and last paper date, a
family-facing state (upcoming, ongoing, marks being checked, results out),
and the number of papers.

### 4.2 `portalExam.schedule.detail({ studentId, examId })`

The child's own date sheet: each paper's subject, date, start time, duration,
venue, and parts with max marks (Theory 80, Practical 20). Papers are picked
by `resolvePapers`: a section paper only for that section, class-wide papers
for everyone. A student with no section gets class-wide papers only, which is
already how the engine works, so no special case.

When the child's class is published, the state reads "results out" and points
to the term card. No marks are shown here (hard rule 8, and section 6).

### Hidden from families

Eligibility (advisory, staff-only), pass marks, weightages, the exam's
`countsTowardTermResult`, verification state, entry progress.

### Owner answers (exams), 2026-11-07

- **E1:** yes, mock and class tests are on the date sheet.
- **E2:** yes, an exam moved back to draft simply disappears for now.

### Questions as asked (exams)

- **E1. Mock and class-test exams** (`examType` other than regular): show
  them on the date sheet too? *Leaning: yes, they are real dates for the
  child.*
- **E2. An exam moved back to draft** after parents saw it simply disappears.
  OK for now? (No notifications exist yet.)

---

## 5. Order of work after approval

0. Step 0 (section 0), with its own tests and the recompute, before anything
   else.
1. Contracts: `portal*` input/output schemas.
2. Attendance (biggest new logic: the ranking count), with unit tests for the
   counting rules and integration tests against Postgres.
3. Fees (mostly reshaping existing reads), including the receipt/statement
   scope change.
4. Exams (smallest).
5. `smoke:authz` portal checks; `check-types`, lint, unit, integration,
   `check:openapi`.
6. The attendance switch migration, if approved, with its toggle on the
   mobile policy screen.

An ADR records the family read rules (section 1) and the ranking count
(section 3.4) once the owner agrees.

---

## 6. Recorded for later, not in this work

The result system's family layer: every exam publish re-issues the term card
with the running term total, so after the first unit test parents see a
partial "Term 1" card with nothing saying it is partial, and no family can see
one exam's marks. One direction is a frozen per-exam card beside the term
card, with the term card marked in progress until the term's last exam
publishes. Needs its own design and ADR.
