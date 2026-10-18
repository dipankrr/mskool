# 00 — Personas and permissions (real actors, real grants)

Status: draft for owner review (2026-10-17, grounded at commit `6e1984b`).

The three journeys are staff journeys. This doc names the actual actors, their
actual grants from the seeded default matrix
(`packages/authz/src/defaultPermissions.ts`), their data scope, and the gaps
that need an owner decision before the journeys can be built as designed.

Reminder of the model: the tenant is the **organization** (a trust/society); a
**school** is a branch under it. Authorization is `role_assignments →
org_role_permissions → can()` + `DataScope`, evaluation server-side only.
Client-side permission checks (`me.get` union) are for hiding UI, never for
enforcement (`docs/MOBILE_PLAN.md` → "Permission-gated rendering").

---

## 1. Actor cards

### A1 — Class teacher (journey 1)

- **Seed login:** `teacher@demo-trust.test` · role type `class_teacher` ·
  scope level **class** · seeded at the class/section level under Main Campus.
- **Grants that matter here:** `attendance:create`, `attendance:read`,
  `attendance:update`, `attendance:export`, `student:read`, `enrollment:read`,
  `section:read`, `class:read`, `academic_year:read`,
  `student_fee_assignment:read`, `fee_payment:read` (fee reads exist so they
  can chase defaulters — read only; no collection).
- **Their job on the phone:** at the bell, mark today's attendance for their
  section in under a minute, standing up, one thumb. Owns the class's
  attendance; can edit/correct it later in the day.

### A2 — Subject teacher (secondary attendance actor)

- **Seed login:** `subject-teacher@demo-trust.test` · `subject_teacher` ·
  scope level **section** · sees only their assigned sections.
- **Grants that matter:** `attendance:create`, `attendance:read` — **no
  `attendance:update`** — plus `student:read`, `enrollment:read`,
  `teacher_assignment:read`, `section:read`.
- **Consequence:** subject teachers can mark but not (by default grant)
  correct. The UI difference for corrections is review question Q4 in
  `01-teacher-attendance.md`.

### A3 — Accountant (journey 2)

- **Seed login:** `accountant@demo-trust.test` · `accountant` · scope level
  **school** (Main Campus in seed) — fees are per-school.
- **Grants that matter:** `fee_payment:create|read|update|export`,
  `student_fee_assignment:create|read|update`, `fee_waiver:create|read`,
  `fee_refund:create|read`, `fee_report:read|export`, `student:read`,
  `enrollment:read`, `class:read`, `section:read`,
  `academic_year:read|read_history` (chases arrears across sessions).
- **Deliberately absent:** `fee_waiver:approve`, `fee_refund:approve`,
  `fee_payment:approve` — separation of duties; the counter records money and
  can *request* waivers/refunds, never approve them. The collect journey must
  not offer approve actions.

### A4 — Front office / admissions desk (journey 3) — **the gap**

- **There is no front-office role type.** `ROLE_TYPES` has no
  `front_office`/`admissions` role, and `staff_coordinator` (the HR role) has
  no `student:create`. Admissions work therefore has to run on a credential
  that holds the right grants:
  - `student:create` — **vice_principal** ✓, principal ✓, org_admin ✓
  - guardian writes gate on `student:update` (no dedicated guardian resource;
    `packages/trpc/src/routers/guardian.router.ts` header) — vice_principal ✓
  - `enrollment:create` — **principal ✓, org_admin ✓ — vice_principal ✗**
    (VP holds `enrollment:read|update` only)
  - `enrollment:update` for `enrollment.assignSection` — vice_principal ✓
  - `section:read`, `class:read` — vice_principal ✓
- **Net:** with a vice-principal credential the desk can admit and assign
  sections but **cannot enroll into the academic year**; only a principal or
  org admin can. See finding F1 below.

### A5 — Principal (navigation review)

- **Seed logins:** `principal@demo-trust.test` (school scope, Main Campus),
  `admin@demo-trust.test` (org_admin, sees **both** campuses).
- **Grants that matter:** the approve tier (`fee_payment:approve`,
  `fee_waiver:approve`, `fee_refund:approve`), `student:create|read|update`,
  `enrollment:create|read|update`, `attendance:read|update` (**not**
  `attendance:create` — principals correct, they don't mark),
  `academic_year:read_history`, `report_card:*`, `marks:verify|publish`.
- **Navigation need:** a principal (or admin) whose credentials span more than
  one branch must see and switch branch context without re-login — the
  cross-branch switch in `04-navigation-proposal.md`.

---

## 2. Capability matrix (exact permissions)

Legend: ✓ granted by default · — not granted · scope note in §3.
Cells name the permission string that decides each action.

| Capability | Class teacher | Subject teacher | Accountant | Vice-principal | Principal | Org admin |
|---|---|---|---|---|---|---|
| Mark attendance | ✓ `attendance:create` | ✓ `attendance:create` | — | — | — | ✓ |
| Read attendance | ✓ | ✓ | — | ✓ `attendance:read` | ✓ | ✓ |
| Correct past attendance | ✓ `attendance:update` | — | — | ✓ `attendance:update` | ✓ | ✓ |
| Look up a student + dues | ✓ read-only | ✓ read-only | ✓ `student:read` + `student_fee_assignment:read` | ✓ | ✓ | ✓ |
| Record a payment | — | — | ✓ `fee_payment:create` | — | — | ✓ |
| Approve/reverse a payment | — | — | — | — | ✓ `fee_payment:approve` | ✓ |
| Approve waiver/refund | — | — | request only `fee_waiver:create`, `fee_refund:create` | — | ✓ approve | ✓ |
| Admit a student | — | — | — | ✓ `student:create` | ✓ | ✓ |
| Enroll into a year | — | — | — | — | ✓ `enrollment:create` | ✓ |
| Assign a section | — | — | — | ✓ `enrollment:update` | ✓ | ✓ |
| Record guardian phones | — | — | — | ✓ via `student:update` | ✓ | ✓ |
| Switch academic year | current only | current only | ✓ incl. history | current + history | ✓ incl. history | ✓ |

---

## 3. Data scope per actor

| Actor | Natural scope | What it means for queries |
|---|---|---|
| Class teacher | class | Sections of their class; marks limited to their class's sections |
| Subject teacher | section | Only their assigned sections (`teacher_assignment`) |
| Accountant | school | One branch; fees never span campuses in one call |
| Vice-principal | school | One branch, deputy-ops reach |
| Principal | school | One branch by default; history reads across sessions |
| Org admin | org | All branches; the only role that sees every campus at once |

Scope is a **required argument** to services (hard rule 1): the client always
sends `organizationId`, and writes additionally send `schoolId`
(`writeScopeArgs()` pattern). The server re-derives authorization on every
call; nothing about scope is remembered server-side between calls.

---

## 4. Findings and decisions needed

**F1 — Admissions desk has no viable single credential by default.**
`enrollment:create` is missing from `vice_principal`; there is no
front-office role type at all. Options:
(a) add `enrollment:create` to the `vice_principal` defaults (new orgs only),
(b) introduce a front-office role type + defaults,
(c) keep admissions on a principal/admin credential.
Note: editing an **existing** org's matrix is gated by `role_permission:update`,
which is deliberately not granted (ADR-035 — the matrix editor is deferred), so
the seeded demo org can only be changed by re-seeding or code, not through the
product. **Decision needed before journey 3's slice.**

**F2 — "My sections" has no shortcut procedure.** Attendance enumerates all
sections via `academic.section.list`; `assignment.teacherAssignment.list`
requires a `sectionId` up front. A teacher app that starts with a picker of
every section in the school is a UX smell for the fastest repeated task in the
product. **Decision needed:** add a scoped "my sections" list procedure, or
derive from `me.get` + existing queries at slice 3?

**F3 — Corrections are uneven across the two teaching roles.**
`subject_teacher` marks but cannot (by default) correct; `class_teacher` can.
The UI must not promise a correction it cannot deliver. See
`01-teacher-attendance.md` Q4.

**F4 — Money roles are cleanly separated.** The collect journey must never
offer waive/approve (#A3). Reversal/bounce/refund recovery is the payments/
ledger journey, not the counter journey.

**F5 — No section capacity data exists anywhere.** Nothing in the repo tracks
or enforces section capacity, so no admission screen may imply a capacity
check. Section lists show names only.
