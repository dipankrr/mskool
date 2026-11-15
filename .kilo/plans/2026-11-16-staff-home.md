# Staff Home rebuild (2026-11-16)

Design: `docs/design/mobile/prototype/staff-home-v5.html` (current), v4 for the
holiday, set-up and past-session frames. Owner said "implement it, keep it the
same as the mockup, keep committing". Branch `feat/staff-home` off main 6762537.

## Rules (from the design conversation)

- Cards come from **assignments** (own sections and pairs), **permissions**
  (school-wide areas) and **scope** (how wide). Never from a role name.
- Fixed order: day card → your attendance → waiting on you → school today →
  you teach → staff · fees · exams · students → coming up. Missing cards drop out.
- Time rule: once all own sections are marked, "your attendance" is one green
  line and "you teach" moves below the school cards.
- Your attendance: one section = big card; several = list, unmarked first with
  Mark, marked show who and when; 6+ fold the marked ones; all marked = green line.
- All branches: a Home-only switch for org-scoped staff with 2+ branches.
  Dashboard data only. The active context (one branch) is NOT changed.

## Open calls taken as drawn (owner can overrule)

"You teach" by subject with a By class switch; fixed time rule; Teaching/Admin
tags only for people with both; past session keeps today's notice (summary later);
Home stays on daily attendance status.

## Data

Reused reads: `assignment.mine`, `homework.home`, `fees.dashboard.overview`,
`assignment.overview`, `academic.setupStatus`, `student.rosterSummary`, `staff.list`.

New `home` router:
- `home.attendanceToday` (staffListProcedure attendance:read): every visible
  section's day from `daily_attendance_status` (counts), who marked first from
  `attendance_records.markedBy` (provenance only, not reporting), whether the
  caller sees the whole branch, today's calendar day and the next non-working days.
- `home.myPapers` (protected, own assignments like `assignment.mine`): open
  exams' papers for the caller's subject pairs with entered/students, and the
  next papers on the date sheet.
- `home.org` (orgListProcedure school:read): per branch, only what the caller
  may read there: students, attendance today, fees today and this month, staff
  not joined.

## Not in the data (mockup cards dropped or changed)

- No concession approval queue exists (concessions are added directly), so no
  "concessions to approve". Waiting items are: cheques pending, teaching gaps,
  sections to assign, homework to check, marks to enter, set-up steps.
- No marks-entry deadline column, so no "closes Friday".
- No payment-mode split on the dashboard read; fee card shows today's total,
  receipts and pending cheques.
- Week trends, lowest sections, absent streaks, birthdays, family sign-ins:
  later (new reads).

## Build order

1. Contracts + service + router + integration test for `home.*`.
2. Mobile: theme hues, pure ordering logic with tests, section components, Home.
3. All branches switch + trust view.
4. Gates, emulator check, ADR-072, TASKS.
