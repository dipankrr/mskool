# Mobile Step 2 Chunk A — Students: roster, detail, admit/edit (slice plan)

Date: 2026-10-24 · Branch: `feature/mobile-step2` (owner-authorized commits, never pushed)
Source of truth: `docs/MOBILE_PLAN.md` §7 ledger; endpoint inventory in this file's §6.

## 0. Step-level decisions recorded here

**F1 resolved by the owner (2026-10-24).** "Who admits on mobile?" is not a
question: roles-permissions are dynamic and every screen gates on permission
strings, never role names. Whoever holds `enrollment:create` sees the admit
affordances (chunk C); `student:create` gates student creation here. The
pending F1 note in `docs/TASKS.md` is closed by this line.

**Step 2 chunk order: students → academic setup → people flows.** On a real
org you create structure before admitting people, and this order lets chunk C's
E2E run the full acceptance arc (structure → admit → enroll → guardian → link)
in one shot. The §7 ledger's row order is presentation, not build order; this
file is the working record.

**Form fields policy.** The student row is wide (23 columns). The mobile form
shows every column the contracts accept, grouped Basics / Contact / Background
/ Address / Medical — scrolling beats omission on admit day, and the demo
schools record category, blood group and medical notes routinely. Only
`admissionNumber` and `status` are read-only-in-edit (the contract refuses
them), which the form says with a note, not a dead field.

## 1. Actor / task / context

**Actors** (permission-gated, never role-gated; defaults shown for wiring):
- Every staff grant holds `student:read` → roster + detail are universal.
- `student:create` (principal, VP by default) → Add action.
- `student:update` (principal, VP) → Edit action.
- `student:delete` (org admin; SENSITIVE — fresh cache read) → Deactivate.

**Task:** find a student, read their record, admit a new student, correct a
record, retire a student (soft — hard rule 2: no hard delete).

**Context:** active organization + branch from `useActiveContext`; every call
addresses `organizationId` (+ `schoolId` where the list supports it). No global
year picker (ADR-047) — students are branch-level, not session-level, in this
chunk; enrollment (chunk C) is session-bound.

## 2. Journeys

**J1 — Find and read.** More → Manage → Students → roster (search by name or
admission number, debounced 300 ms) → tap row → detail: identity facts,
contact, background, address, medical, guardians (read-only summary this
chunk). Pull-to-refresh on the roster.

**J2 — Admit.** Roster header `Add` (only with `student:create`) → form, create
mode: admission number, name parts, DOB (DateField, max today), gender
(ChoicePills), optional contact/background/address/medical → Save → invalidates
roster → back to roster (new row findable via search).

**J3 — Edit.** Detail header `Edit` (with `student:update`) → same form, edit
mode, `gcTime: 0` (chunk B lesson: an edit always opens on the server's
current row) → admission number shown read-only with a note → Save →
invalidates roster + byId → back to detail showing saved truth.

**J4 — Deactivate.** On the edit screen, bottom, behind a consequence Notice +
destructive confirm (branch-close pattern) — only with `student:delete`.
Success returns to the roster without the student (list is active-only).

**J5 — Denial.** Direct deep links: `/students` without `student:read` renders
the denial screen; `/student-form` without the write grants renders the write
denial. No silent blank screens.

## 3. Wireflow

```
More hub ── Students row ──► /students (roster, search + Add?)
                               │ tap row
                               ▼
                        /students/[studentId] (detail, Edit?)
                               │ Edit
                               ▼
                        /student-form (?id= → edit; none → create)
                               │ save/deactivate → invalidate → router.back()
```

## 4. Screen states (every screen)

- Initial loading: skeleton rows (roster) / skeleton blocks (detail, form-in-edit).
- Error + retry: `ErrorCard` (roster, detail, form load).
- Empty: roster no-results vs genuinely no students (differ by whether a query
  is active); guardians empty line on detail.
- Permission denial: read denial on `/students`; write denial on `/student-form`.
- Submitting: Save button loading + disabled; deactivating state.
- Success: never optimistic — server confirms, then invalidate, then navigate.
- Offline/network failure: friendly copy via `toFriendlyError`; form input
  preserved (save error Notice in footer, values untouched).
- Unsaved changes: `useUnsavedChanges` guard on the form.
- App resume / stale: `gcTime: 0` on the edit query; roster refetch on focus is
  React Query default behaviour (staleTime 0).

## 5. Acceptance criteria

1. Roster renders every active student of the addressed branch; search filters
   by name/admission number server-side (`q`); empty and error states honest.
2. Detail shows the contract's student fields grouped, plus guardian summary;
   nothing invented, nothing leaked (no other org's student reachable —
   cross-tenant id → NOT_FOUND screen).
3. Admit creates with required fields only; duplicate admission number shows
   the server's worded CONFLICT, not a crash.
4. Edit round-trips: change → save → detail shows the new truth; admission
   number unchanged and visibly locked.
5. Deactivate: confirm → student leaves the roster; DB row remains
   `status='inactive'` (verified via psql during the walk).
6. Permission splits on device: teacher (read-only, no Add/Edit), principal
   (create/edit, no deactivate), admin (all). Denial screens on deep links.
7. Gates green; walk recorded with captures; ledger ticked.

## 6. Endpoint table (chunk A)

| Procedure | Gate | Screen/use | Done |
|---|---|---|---|
| `student.list` | `student:read` (list) | roster search | ☐ |
| `student.byId` | `student:read` (overlap, owner=student's school) | detail + edit load | ☐ |
| `student.create` | `student:create` | admit form | ☐ |
| `student.update` | `student:update` | edit form | ☐ |
| `student.deactivate` | `student:delete` (SENSITIVE) | edit form footer | ☐ |
| `student.byAdmissions` | `student:read` | (photo slice — register mode) | ☐ |
| `student.uploadPhoto` / `.removePhoto` / `.photo` | `student:update` / `student:read` | (photo slice) | ☐ |
| `guardian.list` | `student:read` (addressed by student id) | detail guardian summary | ☐ |

Note: `student.photo` (read) and photo writes belong to the photo mini-slice;
the detail screen renders initials avatar in this slice (`photoUrl` presence
noted, photo rendering arrives with the photo slice).

## 7. Files

```
.kilo/plans/2026-10-24-mobile-step2a-students.md   (this file)
apps/mobile/src/screens/students/index.tsx          roster
apps/mobile/src/screens/students/detail.tsx         detail
apps/mobile/src/screens/students/form.tsx           create/edit form
apps/mobile/src/screens/students/student-form.ts    pure validation/payload (+ test)
apps/mobile/src/lib/copy.ts                         students.* additions
apps/mobile/src/app/(staff)/students.tsx            route (thin)
apps/mobile/src/app/(staff)/students/[studentId].tsx route (thin)
apps/mobile/src/app/(staff)/student-form.tsx        route (thin)
apps/mobile/src/screens/more/index.tsx              Manage row (Students)
```

Icon: existing `students` / `person` glyphs; no new icon needed.

## 8. Walk plan (after build)

Emulator-5554, real API + Postgres. Admin persona: admit a demo student, edit
them, deactivate them (psql check `status='inactive'`), search + empty/error
states, offline save preserves input. Principal: no deactivate control.
Subject teacher: no Add, no Edit, roster readable. 360×640 @1.3× pass. Deep
links to both denial screens. Fix findings, re-walk, record.

## 9. Commit plan

1. `feat(mobile): student roster and detail` — screens/students (list+detail), routes, copy, more row.
2. `feat(mobile): admit and edit students` — form + pure module + tests + deactivate.
(Photos, if they land tonight, are a third commit with their own design record.)
