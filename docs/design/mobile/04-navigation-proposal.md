# 04 — Navigation proposal (the decision the review locks)

Status: draft for owner review (2026-10-17, grounded at commit `6e1984b`).
Inputs: the three journeys above, the principal's cross-branch requirement
(`docs/MOBILE_PLAN.md` lines 389–401), and the real context model below.

---

## 1. Context model (facts, not choices)

- `me.get` returns memberships: per organization → `scopeTypes` (coarsest
  first), `roleTypes`, the permission **union**, and the `schools` the user
  may see. `memberships: []` = no staff access, a valid state.
- **There is no branch-switch procedure.** Switches are client-side context;
  every staff call carries `organizationId` (+ `schoolId` on writes), and the
  server re-derives authorization per call. Nothing is remembered server-side.
- Mobile persistence per plan: **AsyncStorage** for school choice +
  active-context (convenience), revalidated against `me.get` on every session
  start; **SecureStore** for the session only.
- Years: `academic.year.list` / `.current`; history only for holders of
  `academic_year:read_history` (accountant, VP, principal; class teacher sees
  current only).

## 2. Tab proposal

Rules:

1. **Tabs are jobs, not tables.** No tab mirrors a web sidebar section.
2. Tab visibility follows the **read** capability; every action inside is
   gated by its **write** capability via `PermissionGate`.
3. Max 4 content tabs + `More` (5 total).
4. Tab order is role-stable: Home first, the actor's primary job second.

| Tab | Visible when | The job it serves |
|---|---|---|
| Home | always (staff) | Permission-filtered quick actions + branch/year context |
| Attendance | `attendance:read` | Mark (if `attendance:create`) or view today's status |
| Students | `student:read` | Register search, student detail, admission entry |
| Fees | `fee_payment:create` (collection world) | Find student → dues → collect → receipt |
| More | always | Profile, context details, sign-out, later domains (leave, announcements) |

Resulting sets (draft — this is what review locks):

- **Class teacher / subject teacher:** Home · Attendance · Students · More
- **Accountant:** Home · Fees · Students · More
- **Vice-principal:** Home · Attendance · Students · More (attendance tab shows
  view/correct, no marking — they lack `attendance:create`)
- **Principal / org admin:** Home · Attendance · Fees · Students · More
  (5 tabs; Fees is the oversight/approval side of money — approve flows arrive
  with phase 5)

Teachers hold `student_fee_assignment:read` (defaulter chasing) — whether that
earns them a read-only Fees surface now or later is Q3.

## 3. The cross-branch switch (principal review item)

- **Placement:** a context chip in the Home header — "Main Campus · 2025-26" —
  opening a bottom sheet. Not a tab, not buried in settings.
- **Sheet contents:** branches from `me.get` `schools` (org-scoped accounts see
  every campus; school-scoped see their one) + academic year (history appears
  only for `read_history` holders).
- **Switch behavior:** re-keys every query (context ids are part of query
  keys); Home summary shows that branch's own data; nothing merges two
  branches into one view (scope is per-call by design). The principal's
  cross-branch review is exactly this round-trip: Main → North → Main.
- **Persistence:** remembered across restarts, revalidated against `me.get`
  at every session start (stale grants can't resurrect a lost branch).

## 4. Modal vs push conventions

- **Sheets / modals:** pickers (section, date, mode), status selection,
  context switch, recovery sheet, share sheet. Short, dismissible, never
  hold unsaved multi-field work.
- **Pushed screens:** focused multi-step tasks — roster marking, find student
  → dues → collect → receipt, the admit flow. Back always keeps drafts.
- **Dedicated confirm screens (later phases):** approvals, reversals,
  destructive actions — never a bare swipe or a toast-only flow.

## 5. Route sketch (IA level)

```
src/app/
  (auth)/            as built in Step 0 (login, change-password)
  (staff)/
    _layout.tsx      ← the tab shell — LOCKED at this review
    index.tsx        ← Home (context chip, quick actions)
    attendance/      ← phase 3 (mark / today's status)
    students/        ← phase 2 (register, detail, admit)
    fees/            ← phase 5 (search → dues → collect → receipt)
    more/            ← profile, context, sign-out
```

Implementation details (which Expo Router primitive renders the tabs, header
options) are chosen at build time against the SDK-pinned docs per the repo's
mobile rules — this document decides the **information architecture**, not the
component API.

## 6. What your approval locks

1. The tab set, order, and per-role visibility rules above.
2. The context chip + sheet pattern, including persistence and revalidation.
3. Sheet-vs-push conventions.
4. The first shared primitives to build: `Button`, `Field` (text/select/date),
   `EmptyState`, `StatusChip`, `PermissionGate`, `ThemedText`, `AppIcon`,
   `theme/tokens.ts`, and the `staff-home` screen.
5. The Home principle: task shortcuts first (permission-filtered), not a
   dashboard of cards.

## 7. Open questions for the owner

1. **Shell scope:** build the shell with Home + More only and let tabs appear
   with their slices (recommended — no dead ends), or pre-create all five tab
   routes now with "coming in a later slice" empty states? Either way the
   structure above locks now.
2. **Bell-time entry:** for teachers, should the Attendance tab be the default
   landing (with today + last-used section preselected), or Home with a big
   "Mark attendance" as the first action? (Recommendation: Attendance tab;
   Home stays one tap.)
3. **Teacher Fees visibility:** show the read-only dues surface when phase 5
   lands, or keep teachers out of Fees entirely (they chase defaulters from
   the class screen instead)?
4. **More tab contents:** profile, context details, sign-out now; leave /
   announcements / homework domains as they ship — agree with this order?
5. **Naming:** "Students" vs "Register"; "More" vs "Profile" — cheap to lock
   now, annoying to rename later. Preference?
