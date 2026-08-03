# Architecture Decision Record

Append-only log. Never edit an accepted ADR to mean something new — add a superseding
ADR that references it. When `docs/reference/` SQL conflicts with this file, this wins.

---

## ADR-001 — The tenant is the Organization, not the school

**Accepted.** Indian private schools are owned by a Trust/Society that frequently runs
multiple branches. Billing, staff, and academic-year rollout happen at org level.

`organizations` is the top entity; `schools` are branches under it. Every operational
table carries `school_id`; org-wide operations join through it. A staff member can hold
roles at org scope (all branches) or school scope (one branch).

Making the school the tenant would force duplicate accounts per branch and make
cross-branch reporting impossible.

---

## ADR-002 — UUID primary keys, not BIGSERIAL + public_id

**Accepted. Supersedes the hybrid-ID strategy in `docs/reference/sql/`.**

The reference SQL uses `BIGSERIAL id` for FKs plus `public_id UUID` for external
exposure. We use a single `uuid` PK everywhere.

Two ID columns per table means every query must know which one it holds, and a mistake
leaks sequential internal ids (enumerable) or breaks a join. One column, one meaning.
Cost is index size and slightly larger indexes; worth it. Exception: better-auth owns
its own tables (`user`, `session`, `account`, `verification`) and their ids are `text`.
Any FK to a user is therefore `text`, not `uuid`.

---

## ADR-003 — better-auth for authentication only; authorization is ours

**Accepted.** better-auth owns credentials, sessions, and tokens. It does **not** own
roles, permissions, or organizations.

We do not install better-auth's organization plugin. It ships its own `member` table with
its own `role` column; running that beside `role_assignments` means two systems both
answering "what can this user do", drifting apart silently. One source of truth.

---

## ADR-004 — Drop `users` and `user_school_assignments` from the reference SQL

**Accepted. Supersedes reference SQL tables 3 and 4.**

- `users` (with `password_hash`) → better-auth's `user` table. Hand-rolling password
  storage next to a library that does it correctly is indefensible.
- `users.full_name / legal_name / phone / date_of_birth` → move to `staff` and
  `guardians`. better-auth's `user` holds auth fields only.
- `user_school_assignments` → `role_assignments` (from the authz prototype). Its
  `scope_type` + `scope_id` pair expresses org-level and school-level roles uniformly,
  replacing the reference SQL's nullable-`school_id`-plus-CHECK-constraint approach,
  which permits invalid states the type system cannot see.

New tables this forces into existence:

- **`staff`** — the reference SQL has nowhere to put `employee_code`, `designation`,
  or `date_of_joining`.
- **`guardians`** — guardian identity needs a home once guardians are not user rows
  (see ADR-006).

---

## ADR-005 — Two authorization tracks: staff by role, student by ownership

**Accepted.** Staff and students are authorized by different mechanisms.

```
STAFF   → role_assignments → org_role_permissions → can() → DataScope filter
STUDENT → session → student_portal_access → owned studentIds → ownership filter
```

Students get **no** `role_assignments` rows and never invoke `can()`. Reason: every
student has an identical permission set. Storing thousands of rows to express one
invariant, and building a Redis permission cache per student for zero variability, is
pure cost. What a student may see is not configurable, so it is code, not data.

Enforcement: `AuthContext` is a **discriminated union**, not a record with optional
fields.

```ts
type AuthContext =
  | { kind: 'platform_admin' }
  | { kind: 'staff';   userId: string; authz: UserAuthCache }
  | { kind: 'student'; userId: string; studentIds: string[]; activeStudentId: string }
  | { kind: 'system' }   // see ADR-009
```

Discriminated so a student reaching a staff procedure is a **compile error**
(`ctx.auth.activeStudentId` does not exist on the staff variant). With optional fields it
is a runtime check someone forgets in month four.

Where staff and students need the same data, the **service takes a scope discriminator**
as a required argument:

```ts
FeeService.listInstallments(scope:
  | { kind: 'staff';   dataScope: DataScope }
  | { kind: 'student'; studentId: string }
)
```

One query builder, two callers, and the compiler rejects an unfiltered call.

---

## ADR-006 — Guardians have no login; the student account is the family account

**Accepted. Supersedes reference SQL `student_guardians.user_id → users(id)`.**

`student_guardians.user_id` becomes `guardian_id → guardians.id`. Guardians are contact
records, not principals.

Consequence to accept deliberately: the fee and results screens in the student portal are
used by **parents**. Write that UI for an adult, not a nine-year-old. One login per
family; siblings appear under it.

---

## ADR-007 — Student credentials: phone number + password

**Accepted.** Students have no email, so email/password cannot be the credential.

Rejected alternatives:

- **Admission number** — schools re-issue and correct these; a login identifier must
  never be school-mutable. It stays a *display* identifier on documents.
- **OTP** — no per-login SMS cost, and no OTP infrastructure in v1.

Implementation: better-auth's **username plugin**, with the phone number as the
username — not the phoneNumber plugin, which is built around the OTP flows we rejected.

Follow-on details:

- better-auth usernames are globally unique but a phone is not unique across orgs, so
  the stored username is `{org_slug}-{phone}`. The login page resolves the org from
  subdomain or picker; the parent still types only their phone. Judged rare enough to
  accept.
- `user.email` must become nullable. Synthetic emails get mistaken for real ones by a
  notification job eventually.
- No email means no self-service reset. School staff set an initial password at portal
  activation, with `must_change_password` forcing a change on first login. Requires
  `student_portal:activate` and `student_portal:reset_password` in `RESOURCE_ACTIONS`.
- Changing a phone number is changing a credential: own permission, audit row, and
  session revocation. Otherwise it is a quiet account-takeover path. **Deferred, but
  must land before the portal ships.**

---

## ADR-008 — `student_portal_access` join table; drop `students.user_id`

**Accepted. Supersedes reference SQL `students.user_id BIGINT NOT NULL UNIQUE`.**

That constraint contradicts two decisions:

- `NOT NULL` — a student exists from admission day; portal access is activated later.
- `UNIQUE` — one user ↔ one student, but ADR-007 gives a family one phone login, and
  siblings share it. Three children under one number is impossible under `UNIQUE`.

Replaced by:

```
student_portal_access (id, user_id → user.id, student_id → students.id,
                       is_active, granted_at, granted_by)
```

One login → N students → an `activeStudentId` switcher, mirroring the staff
school-switcher. Every `portal.*` query verifies the requested `studentId` is in the
caller's set before filtering. Also handles a parent with children in two branches of
the same org.

---

## ADR-009 — A `system` auth context for payment webhooks

**Accepted.** A student tapping "Pay" must not be what writes
`fee_payments.payment_status = 'cleared'` — that lets the client decide money arrived.

```
1. studentProcedure  read own fee_installments (ownership filter)
2. studentProcedure  create payment intent → gateway (no fee_payments row yet)
3. gateway webhook   kind: 'system' → writes fee_payments + payment_allocations
                     + financial_transactions, row-locks the receipt sequence
```

`{ kind: 'system' }` is authenticated by webhook signature, not session, and is the only
path permitted to write the ledger. Built in Phase 1 rather than discovered in Phase 4.

---

## ADR-010 — Student UI is a route group, not a separate app

**Accepted.** `apps/web/src/app/(admin)/` and `(student)/` — separate layouts, navs, and
`features/` trees, sharing the tRPC client, `components/ui`, build, and deploy.
`middleware.ts` redirects each `kind` to its own root.

A separate app would only pay off with an independent deploy cadence or a different
domain. Neither applies. For a future native app, the generated REST surface
(`trpc-to-openapi`) is already there.

Router namespaces mirror this: `portal.*` for students, `<domain>.*` for staff, so
"is this endpoint student-reachable?" is answerable at a glance.

---

## ADR-011 — Owner is `org_admin` at org scope, not a separate role type

**Accepted.** Owner and Principal are distinct to *sales*, not to the permission system:
an Owner is org-scoped with full access, which `org_admin` at `scope_type='org'` already
expresses exactly. Labelled "Owner" in the UI. `ROLE_TYPES` stays at 8 values.

---

## ADR-012 — `section_teacher_assignments` is the subject-access source of truth

**Accepted.** The authz prototype's README describes a `staff_subject_assignments` table;
reference SQL table 11 `section_teacher_assignments` already carries `user_id`,
`subject_id`, `role`, and date-ranging. Same table. We keep the SQL one and point
`checkSubjectAccess` at it rather than creating a second.

Related overlap, resolved: `section_teacher_assignments.role`
(`ClassTeacher`/`SubjectTeacher`) vs `role_assignments.roleType`
(`class_teacher`/`subject_teacher`). `role_assignments` is the **authorization**
authority; `section_teacher_assignments` records the **timetable/subject** fact. Do not
read the latter to answer a permission question.

Also dropped for the same reason: `attendance_policies.can_mark_roles` and
`can_correct_roles` (reference SQL table 24). `org_role_permissions` owns who may mark
attendance. Two sources of truth for one question is how a permissions bug ships.

---

## ADR-013 — Postgres-only constructs stay, as hand-written migration SQL

**Accepted.** Several reference-SQL constructs cannot be expressed in Drizzle and are
appended to generated migrations by hand:

- `EXCLUDE USING gist` / `USING btree` on `academic_years` (no overlapping years, one
  current year per school) — needs `CREATE EXTENSION btree_gist`
- `DEFERRABLE INITIALLY DEFERRED` on `uq_attendance_daily`
- the three triggers: marks ≤ `max_marks`, lock grading scale on first use, and the
  `DO $$` block applying `trg_set_updated_at` across 25 tables

`generated always as` columns (`fee_installments.balance_amount`,
`fee_payments.total_amount`, `opening_balances.balance_amount`,
`attendance_summary.attendance_percentage`) **are** expressible, via
`.generatedAlwaysAs()`. Keep them. `BIGINT[]` array columns become `uuid[]`.

---

## ADR-014 — Homework deferred

**Accepted.** The authz prototype references `homework` permissions and subject-level
access for it, but no such table exists in the reference SQL. It is a genuine
student-portal feature (`homework`, `homework_submissions`), scheduled after the five
core domains. Recorded so the permission references are understood as forward-looking,
not as a missing table.


