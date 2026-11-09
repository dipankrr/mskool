# Student profile revamp (staff app) — 2026-11-09

Owner approved the round-2 mockup ("Ready to build", 2026-11-09):
`docs/design/mobile/prototype/student-profile.html`, frames in
`docs/design/mobile/prototype/shots/student-profile/`.

## 0. Owner decisions

- Design for helpfulness to staff. Every block is gated by **permission and scope,
  never by role name**: a teacher holding every permission sees what an admin sees.
- Look: the emerald band (round-1 colour option 1), slate band for a student who left.
- Don't redraw per role.

## 1. Actor, task, context

Any staff member who holds `student:read` opens a student from the Students tab (or
anywhere that links a student). Typical moments: a parent is on the phone ("is he in
school today?"), a fee is being chased, a teacher wants to know why marks dropped, the
office is finishing an admission. The phone is one-handed, often mid-conversation.

## 2. Journey

Students tab → row → profile.
- Top: identity band (photo, name, Adm · age · gender · blood group, Class · Sec · Roll
  capsule, "today" chip), action row (Call, Message, Collect, ID card).
- "To finish" (new admission) and "Heads up" (health first, then problems worst-first),
  each line jumping to where it is fixed.
- At a glance tiles: Attendance → attendance summary sheet; Fees → fee page;
  Results → the student's result for that exam; Homework → a sheet of the last 10.
- Family (call, add/edit), Family app line, Details (4 facts + "All details" sheet).
- ⋯ More: Change photo, Change roll number, Family app sign-in, Fee statement,
  Student is leaving. ⋯ is not drawn when nothing in it is allowed.

## 3. Permission map (what the build implements)

| Block | Needs | Data |
|---|---|---|
| Page | `student:read` | `student.byId` |
| Capsule, placement gaps | `enrollment:read`; fill gaps `enrollment:update`; enrol `enrollment:create` | `enrollment.list` |
| Edit, photo | `student:update` | existing |
| Call/Message/family/health | `student:read` | `guardian.list` |
| Add/edit parent | `student:update` | existing |
| Today chip, Attendance tile, absence flag | `attendance:read` + scope | `attendance.statusHistory`, `attendance.summary` |
| Fees tile, fee flag, Fee statement | `fee_report:read` or `student_fee_assignment:read` | `fees.dashboard.student`, `fees.document.statement` |
| Collect | `fee_payment:create` | Collect route |
| Results tile, results flag | **`exam:read`** + scope (deviation: the mockup said `marks:read`/`report_card:read`; `exam:read` is what the results screen it opens needs) | **new** `exam.results.studentLatest` |
| Homework tile, missed flag | `homework:read` (subject teacher: own pairs) | **new** `homework.studentRecent` |
| Family app line, sign-in jobs | `portal_access:activate` (what `portalAccess.status` needs) | `portalAccess.status` |
| ID card | `id_card:print` | `idCard.print.*` with a new optional `studentId` filter |
| Change roll, Student is leaving | `enrollment:update` | `enrollment.update`, `enrollment.leave` |
| Rejoin | `student:update` | `student.rejoin` |

Rules: a block whose read is FORBIDDEN / NOT_FOUND, or that comes back empty because of
scope, is not drawn. Any other failure keeps the block and shows Retry inside it.
Rows reflow (1–4 actions, tiles 2-up or full width). No locks, no disabled buttons.

## 4. Deviations and open items

- **Section move left out.** `enrollment.assignSection` refuses an enrollment that has a
  section: "moving a student mid-year is a transfer, and transfers are logged — that flow
  is not built yet". More offers "Change roll number" only. A transfer flow is its own piece.
- **Attendance floor**: no school setting exists; tile numbers stay neutral ink (no red
  threshold). Absence flag fires at 2+ absences in the last 7 marked days.
- "Today" can't tell a holiday from "not marked yet"; it says "No attendance today yet".

## 5. New server reads

`exam.results.studentLatest` — `staffListProcedure("exam:read")`, input
`{ academicYearId, studentId }`. Scope through the student's enrollment that year
(`scopeWhere` on enrollment school/class/section). Returns the latest published
(published/locked) term result: term name, percentage, grade, pass, subjects failed,
previous published term's percentage, best and weakest subject (exam subject results of
that term's published exams), and an `examId` + `classId` to open the result screen.
`null` when none or out of scope.

`homework.studentRecent` — `staffListProcedure("homework:read")`, input
`{ academicYearId, studentId }`. The student's last 10 `student_assignments` (assignment
published/closed, due before now + 7 days) inside the existing `visibleWhere` (scope +
subject-teacher pairs), newest due first, each with `studentWord`. Plus counts:
handed in (sent/late/checked/redo), missed, counted.

`idCardPrintListSchema` gains optional `studentId` (roster filters), so one card prints
through the existing flow.

## 6. Screen states

Loading (skeleton of the page shape), error (whole page only when `student.byId` fails),
denied (`student:read` missing), per-block loading/Retry, new admission (To finish list,
"+ Section/+ Roll", Add parent in place of Call), left (slate band, banner, Collect as the
main action, Rejoin), graduated (banner, no Rejoin), no guardian, no fee permission, pull to
refresh, app resume (queries refetch on focus as elsewhere).

## 7. Acceptance

- Every block in §3 appears only with its permission; verified with a full-permission
  login and a narrower one on the emulator.
- Status bar icons are light over the band and return to dark on other screens.
- Existing flows reached from the page still work: photo, enrol/assign/roll, leaving,
  rejoin, guardian add/edit, portal access, fee page, Collect, statement print, ID card.
- `pnpm check-types` green; mobile jest/eslint green; new service reads covered by an
  integration test.

## 8. References

Expo SDK 57 (expo-router ~57.0.26, expo-status-bar ~57.0.1 `setStatusBarStyle`,
react-native-safe-area-context ~5.7), RN 0.86. Skills read: `.agents/skills/mobile-design`
(design process, review checklist). The Expo skills named in AGENTS.md are not installed in
this checkout; Expo APIs used are ones already used in this app.

## 9. Build record

Built 2026-11-09 on `feat/student-profile`.

- Server (`cf5aadc`): `exam.results.studentLatest`, `homework.studentRecent`, roster
  `studentId` filter. Integration: exam + homework 36/36, idcard 14/14.
- Mobile: `screens/students/detail.tsx` rebuilt from `screens/students/profile/*`
  (band, action row, heads-up, glance, family, details, more/homework/profile sheets,
  enrollment sheets moved unchanged, `use-profile-data`, `profile-logic` + 13 tests);
  `lib/profile-copy.ts`; band colour roles in `theme/brand-admin.ts`; icons `message`,
  `health`, `personAdd`; `StudentPhotoView` `onDark`.
- Gates: mobile tsc clean, eslint clean, jest 734/734.

Walked on the emulator (admin login, Aarav, live data): band, today chip ("Absent
today · marked 12:29 pm"), actions (Add parent, Collect, ID card), To finish, Heads up
(overdue fee, missed homework), four tiles with real numbers, collapsing bar, empty
family, family app line, details, More sheet. Fixed during the walk: oversized attendance
squares; "Class Class 6" doubled label (fix in code, **not re-seen** — the emulator's
display froze after a restart).

Not walked: a narrow-permission login, a student who has left, a graduate, health note,
the attendance/homework/all-details sheets, statement print, ID card print, enrol/place/roll
from the capsule, iOS, large text.
