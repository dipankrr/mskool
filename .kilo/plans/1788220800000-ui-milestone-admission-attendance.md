# mskool — UI milestone: admission + attendance screens

Six chunks: **U1** students list + admit, **U2** student detail + enrollment
actions, **U3** the attendance calendar, **U4** the marking policy, **U5**
the marking screen, **U6** docs. Each chunk lands as its own commit, one
concern per commit. Pure frontend — no migrations, no backend changes
expected (a discovered API gap is a STOP-and-report, not a quiet backend
edit inside a UI chunk).

## Goal

Make the shipped backend usable. The admission flow
(`student.create` → `enrollment.create` → `enrollment.assignSection`) and
attendance marking (calendar → policy → mark) exist only as APIs; this
milestone gives them screens. It also gives TEACHERS their first landing
surface — until now the console only served org admins and principals, and
the class/subject teacher logins in the seed have nothing to open.

Everything here clones the existing verticals (`features/<domain>/` with a
`use-*.ts` hook + form dialogs) and the console-frontend plan
(`.kilo/plans/1787116995782-school-admin-console-frontend.md`) is the
standing record of web decisions — read it before changing `apps/web`.

## Workflow protocol — read before starting

**One chunk per turn. The owner commits (unless explicitly authorized per-instance).**

1. Implement **exactly one** chunk. Do not begin the next one.
2. Run that chunk's **Verify** steps.
3. Tick that chunk's boxes in this file as part of the same diff.
4. Run `git status` and `git diff --stat`, and summarise what changed and why.
5. Propose the commit message (subject + body) from that chunk.
6. **Stop and wait.**

Every chunk leaves `pnpm check-types` green (8/8) and the web unit suite
green. `pnpm lint` is NOT a gate — it has never been wired up (a recorded
tooling debt, not this milestone's to pay).

## Execution order

```
U0 plan ── U1 students list + admit ── U2 student detail + enrollment
                                             │
       U3 calendar ── U4 policy ── U5 marking ── U6 docs
```

U3/U4/U5 are independent of U1/U2; both chains feed U6. Within the
attendance chain, U5 needs U3's calendar data and reads the policy from U4.

## Preconditions (verified 2026-08-31)

- [x] Phase 3 committed in full (9 commits, C0–C8); `check-types` 8/8;
      integration 93; smoke 158; `db:verify` 72.
- [x] Backend surface for this milestone is complete and smoke-proven:
      `student.*`, `enrollment.*`, `attendance.calendar.*`, `attendance.policy.*`,
      `attendance.mark/status`.
- [x] Seed provides 9 logins (password `Password123!`) including class_teacher
      and subject_teacher — the manual-test cast for every chunk. Dev: web
      :3000, API :4000; restart the API between smoke runs (sign-in limiter).
- [x] The demo org is DAILY-mode for attendance; the calendar for its 2025-26
      year is generated (Mon–Fri) with holidays on 2025-08-15 and 2025-10-02.

## Hard context an implementer must know

**Which node each call addresses is the whole subtlety** — `use-branches.ts`
documents the house rules and they apply unchanged:

- permissive LISTS address `{ organizationId }` (or the widest node) — the
  builder clips to the caller's grants;
- CREATES name their parents explicitly in the input (B5), never the
  "active branch" blindly;
- row-addressed UPDATE/DEACTIVATE address the ROW's own node
  (`{ organizationId, id }`), not the active context's;
- `attendance.mark`'s `sectionId` IS the addressed node (B5) — the marking
  screen submits the section it is marking.

**Permission gating is `PermissionGate` (hidden, not disabled)** driven by
`me.get`'s `permissions` — a render hint; the server is the authority. Per
screen (verify against `defaultPermissions.ts` at build time, don't trust
this table blindly):

| Screen | gate to SHOW | gate for ACTIONS |
|---|---|---|
| Students list | `student:read` | Admit = `student:create` |
| Student detail | `student:read` | edit `student:update`; deactivate `student:delete` (SENSITIVE → fresh gate read + confirm dialog) |
| Enrollment actions | `enrollment:read` | `enrollment:create` / section assignment per matrix |
| Calendar screen | `attendance:read` | generate/override = `attendance:update` |
| Policy screen | `attendance:read` | save = `attendance:update` |
| Marking screen | `attendance:read` | mark = `attendance:create`; day view is read-only without it |

The NAV currently assumes an admin audience. With teachers arriving, nav
items for the new screens need permission awareness (the same `has()` from
`useActiveContext`), so a class_teacher sees Attendance but not Branches.

**Marking UX for refusals: client-side states, server-side authority.** The
marking screen knows the selected date's day type (the month's calendar is
already fetched). A holiday/weekend/no-row date renders a non-editable
explanation — the SAME words `translateErrors` produces — instead of letting
submit fail. The server refuses anyway; the client state is UX, never a
security decision. The `correctionReason` convention is implemented here:
the UI asks for a reason when EDITING a PAST date, never on same-day
marking, and sends it optionally (the backend never enforces).

**Dates are strings, always.** ISO end to end; `lib/format.ts` converts to
DD/MM/YYYY for display without constructing a `Date` for a calendar date.
The calendar month-grid builder computes weekdays with UTC-only `Date`
arithmetic (the same walk the generator uses) and gets unit tests — it is
exactly the kind of pure helper `lib/` exists for.

**Row types come from `inferRouterOutputs<AppRouter>`**, not
`@repo/contracts` (CONVENTIONS.md). Input types come from `@repo/contracts`
— the contracts are what the forms submit.

**Known web traps** (all fixed, all easy to reintroduce): loading gates use
`isLoading`, not `isPending`; queries retry once, never on permission/not-
found errors; row-addressed mutations invalidate the list AND `me.get`
where the switchers' data changed.

## Locked decisions

| Decision | Choice |
|---|---|
| Daily-mode UI only | The marking + policy screens model daily marking; period-wise configuration is API-only this milestone (recorded deferral). |
| Refusal states | Client renders calendar-known refusals as inline states with the translateErrors wording; submit-failures surface through `lib/errors`. |
| correctionReason | Asked on past-date edits only; optional in the payload; never required client-side either. |
| Roster source | The marking screen's roster comes from `enrollment.list` for the section (carries student names). |
| Section picker | Fed by the permissive `academic.section.list` (clipped to the caller's grants — a teacher sees exactly her sections). |
| Student detail layout | One page: profile card + enrollment history + actions; admission adds the FIRST enrollment. |
| Vocabulary | `lib/copy.ts` owns everything user-facing; attendance words: Present, Absent, Late, Half Day, On Leave; Indian formatting via `lib/format.ts`. |
| Summary/reports | Deferred — the API exists; reports land with the report-card phase. |
| Tests | Pure helpers (month grid, status maps, date logic) get unit tests; screens rely on `check-types` + manual walks with the seed cast. |
| Commit cadence | One chunk = one commit; tests ride with the code they cover. |

## Chunk U0 — plan file — ✅ DONE (2026-08-31, this commit)

- [x] This file: protocol, chunks, hard context, locked decisions, ledger.

## Chunk U1 — `feat(web): the students list and admission` — ✅ DONE (2026-08-31)

- [x] `features/students/` vertical: `use-students.ts` (list + server-side
      search via `q`, create mutation per the use-branches addressing rules:
      list addresses `{ organizationId }`, create names the branch via
      `writeScopeArgs()`); students page under `(dashboard)/students` —
      debounced search input, `data-table` (admission number, name, Class,
      gender, DOB), distinct empty states for "no students" vs "no matches".
- [x] The Class column degrades PER PERMISSION: the enrollment join
      (`enrollment.list`) and the class/section name lookups are separate
      queries, so a librarian (`student:read` without `enrollment:read`)
      gets a working register with "—" in the Class column, never a failed
      screen.
- [x] Admit dialog: identity + core demographics from `createStudentSchema`
      (admission number, name, DOB, gender, optional admission date /
      phone / email); native `type="date"` inputs (already ISO); empty
      optional fields become `undefined` (the branch-dialog rule); the
      duplicate admission number surfaces via `lib/errors` from the
      translateErrors wording.
- [x] Nav entry "Students" with `permission: "student:read"`; `lib/copy.ts`
      vocabulary (`students:` section, `nav.students`); `Student` +
      `EnrollmentPair` row types derived in `lib/trpc/types.ts`.
- [x] Deactivate + edit intentionally deferred to U2's detail page.

**Verify:** `check-types` 8/8 ✅; unit suite green ✅; manual walk — org
admin admits a student, searches, duplicate admission number wording
(OWNER: pending on-screen walk with the seed logins).

## Chunk U2 — `feat(web): student detail, enrollment, section assignment` — ✅ DONE (2026-08-31)

- [x] Student detail page `(dashboard)/students/[studentId]`: breadcrumb,
      profile card (identity + contact), edit dialog
      (`updateStudentSchema`, prefilled; identity/status absent from the
      form because the contract omits them), deactivate behind
      `student:delete` (SENSITIVE) with the records-kept confirm; the
      register rows link here.
- [x] Enrollment card shows the ACTIVE session in three states matching the
      status machine's admission track: not enrolled (→ Enroll), enrolled
      without a section (→ Assign section), sectioned (settled — NO
      re-pointing, per the transfer deferral). Enroll dialog: class picker +
      optional section (status derives admitted vs section_assigned);
      session comes from the switcher, not a picker. Assign-section dialog:
      section + optional roll number.
- [x] Dialogs close on SUCCESS only — the hooks return `mutateAsync`
      promises so a refused submission keeps the form up beside the error
      toast (bug found and fixed during the browser walk).
- [x] **Browser walk (agent-browser), org admin over HTTP:** signed in →
      register rendered the seeded students with the Class column (Aditi
      "Class 6 · A", Rohan "Class 6", Zoya not-enrolled — correct per
      branch); admitted DEMO-1000 Kiran Rao (date inputs needed JS-set
      values — see the drift note); searched and found her; duplicate
      admission number refused, dialog stayed open; detail page → enrolled
      into Class 6 without a section (status "Admitted" shown) → assigned
      Section A roll 12 (status "Section assigned") → the assign action
      correctly disappeared; edit dialog added a phone and the card
      reflected it. Deactivate not clicked (destructive; same confirm
      pattern as branches, machine-verified).

**Verify:** `check-types` 8/8 ✅; unit suite green ✅; browser walk end to
end ✅.

## Chunk U3 — `feat(web): the attendance calendar` — ✅ DONE (2026-08-31)

- [x] `lib/calendar-grid.ts` + 6 unit tests: the pure UTC Monday-first month
      grid (leap February, Sunday-ending sixth week, ISO/shape invariants —
      the same walk as the backend generator).
- [x] Calendar screen `(dashboard)/attendance/calendar`: month navigation
      (opens the session's current-or-start month), day cells colored per
      day type with reason in the tooltip, legend, distinct empty state
      ("generate first") and no-session state; nav entry "Attendance"
      behind `attendance:read`.
- [x] Generate dialog (working-weekday checkboxes, Mon–Fri pre-ticked,
      empty selection refused) — the idempotent 0-case toast verified live
      ("every day already had a row").
- [x] Day override dialog (type + reason; stored reason prefills, blank
      field is OMITTED so the don't-wipe rule holds — verified live: a
      reason-less re-mark kept "Unit Tests").
- [x] **`FormDialog` bug found by the walk and fixed at the component:** a
      plain-handler consumer's `<form onSubmit>` never called
      preventDefault, so EVERY non-react-hook-form dialog (generate,
      override, enroll, assign-section — i.e. all of U2's non-RHF dialogs
      too) performed a NATIVE form submission and reloaded the page on
      submit — silently, because a reload re-fetches everything and only
      client state (the selected month) betrayed it. FormDialog now owns
      preventDefault for both transports; mutation flows update in place.

**Verify:** `check-types` 8/8 ✅; unit suite green (44 web, +6) ✅; browser
walk ✅ — generate (0-case toast), override to exam_day/holiday with reasons,
don't-wipe prefill, in-place cell updates with toasts, month navigation.

## Chunk U4 — `feat(web): the marking policy` — ✅ DONE (2026-08-31)

- [x] Policy page `(dashboard)/attendance/policy`: one form for the school's
      one row — marking mode, derivation rule, threshold (nullable; the
      contract's refine enforced client-side), late-arrival minutes.
      Null policy renders the "defaults already in effect" note; saving
      CREATES the row. The period-wise-only fields stay visible with help
      text rather than vanishing on mode switch.
- [x] The calendar page links here ("Marking policy" in the header).
- [x] Browser check (spartan): form renders defaults, Period-wise +
      threshold_percentage + 50 saved — DB row confirms
      `period_wise/threshold_percentage/50`, toast captured, no reload.
      Walk-time detours (toast expiry, a below-fold Save button, a Base UI
      scroll-lock overlay eating clicks) were all automation artifacts,
      not product bugs — noted so the next walker doesn't chase them.

**Verify:** `check-types` 8/8 ✅; unit suite green ✅; browser check ✅
(demo MAIN policy now period_wise @ 50% — flip back via the screen if the
marking walk should be daily).

## Chunk U5 — `feat(web): the marking screen`

- [ ] Marking screen `(dashboard)/attendance/mark`: section picker (clipped
      `academic.section.list`) + date picker + roster from `enrollment.list`;
      per-student status control (the five statuses); absent-by-default
      bulk action; submit via `attendance.mark`.
- [ ] Calendar-aware states: holiday/weekend/no-calendar dates are
      non-editable with the worded explanation; same-day edit vs past-date
      edit (reason field on past edits only).
- [ ] Read-only day view for callers without `attendance:create` (the
      subject-teacher read cell of the smoke, now a screen); loading and
      empty states for the not-yet-marked day.
- [ ] Nav entry "Attendance", permission-aware (teachers finally land
      somewhere).

**Verify:** `check-types` 8/8; web unit suite green; manual walk — teacher
marks her section same-day, edits a past date with a reason, sees holiday
and no-calendar states; principal sees the same screen read-only.

## Chunk U6 — `docs: TASKS.md — the UI milestone done`

- [ ] Resume-here: what shipped, what the deferrals are (period-wise UI,
      summary reports, …), verification surface, next-up pointer
      (Phase 4 fees — owner's call on timing).

## Commit ledger (owner commits; agent prepares messages)

| # | Commit | Chunk |
|---|---|---|
| 1 | `docs: the UI milestone plan` | U0 |
| 2 | `feat(web): the students list and admission` | U1 |
| 3 | `feat(web): student detail, enrollment, section assignment` | U2 |
| 4 | `feat(web): the attendance calendar` | U3 |
| 5 | `feat(web): the marking policy` | U4 |
| 6 | `feat(web): the marking screen` | U5 |
| 7 | `docs: TASKS.md — the UI milestone done` | U6 |

## Recorded deferrals (do not silently absorb)

- Period-wise marking UI (period management screens) — API exists; lands
  when a period-wise school is a real user.
- Attendance summary/report screens — the API exists; reports land with the
  report-card phase.
- The student portal UI, guardians, sibling links, previous-school records —
  each lands with the flow that needs it (unchanged from the students slice).
- `pnpm lint` wiring — pre-existing tooling debt, not this milestone's.
- E2E coverage for the new screens — the 4 existing browser walks stand;
  new E2E is worth a dedicated slice after the screens settle.
