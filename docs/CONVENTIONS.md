# Conventions

Naming, Drizzle patterns, and the rationale behind the 12 hard rules in `AGENTS.md`.
A rule you understand is a rule you apply correctly in a case nobody anticipated.

---

## Naming

| Thing | Convention | Example |
|---|---|---|
| DB table | `snake_case`, plural | `student_enrollments` |
| DB column | `snake_case` | `admission_number` |
| Drizzle export | `camelCase`, plural | `studentEnrollments` |
| TS type | `PascalCase`, singular | `StudentEnrollment` |
| Zod schema | `camelCase` + suffix | `insertStudentSchema` |
| Service | `PascalCase` class + singleton | `class FeeService` → `feeService` |
| tRPC procedure | `<domain>.<verb>` | `fee.list`, `student.create` |
| Student procedure | `portal.<domain>.<verb>` | `portal.fees.list` |
| Permission | `<resource>:<action>` | `fee:read`, `student:create` |

Drizzle's `casing: "snake_case"` config handles the TS↔DB conversion. Write
`admissionNumber` in schema files; the column is created as `admission_number`.

---

## Column patterns

```ts
// Primary key — always. (Hard rule 10)
id: uuid().primaryKey().defaultRandom(),

// Timestamps — always withTimezone. (Hard rule 11)
createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),

// FK to a tenant
schoolId: uuid().notNull().references(() => schools.id),

// FK to a user — text, because better-auth owns that table. (ADR-002)
createdBy: text().references(() => user.id),

// Money — never float. (Hard rule 4)
amount: decimal({ precision: 10, scale: 2 }).notNull(),

// Marks — 6,2 supports half-marks and negatives
marksObtained: decimal({ precision: 6, scale: 2 }),

// Enum-ish — pgEnum, not a bare varchar + CHECK
status: studentStatusEnum().notNull().default('active'),
```

**Enums:** the reference SQL uses `VARCHAR + CHECK`. We use `pgEnum`, which gives a
narrowed TS union for free. Values are `snake_case` (`transferred_out`), not the SQL's
`Title_Case`.

---

## The 12 hard rules, and why

### 1. Never query an operational table without a tenancy filter

The whole product is one database shared by every customer. A missing `where` clause is
not a bug, it is a data breach — one school reading another's students.

Defence: tenancy is a **required function argument**, never an ambient value.

```ts
// Right — the compiler rejects a call that omits scope
listStudents(scope: DataScope, filters?: StudentFilters)

// Wrong — nothing forces the caller to pass it
listStudents(filters?: StudentFilters & { schoolId?: string })
```

Staff filter by `DataScope` (derived from `role_assignments`); students filter by owned
`studentId` (from `student_portal_access`). See ADR-005.

### 2. Never hard-delete

`DELETE` on a user, student, payment, attendance record, or result destroys history that
regulators, parents, and courts may ask for years later. It also breaks `created_by`
references, corrupting the audit trail of *other* records.

Use `status` / `is_active`. A "deleted" student is `status = 'withdrawn'`.

### 3. Never UPDATE `financial_transactions`

It is a ledger. Ledgers are append-only, like double-entry bookkeeping. A correction is a
new offsetting row, not an edit — so the sum over time is always reconstructible and any
mistake remains visible.

An `UPDATE` here silently changes financial history, which is indistinguishable from
fraud during an audit. The table has no `updated_at` column, deliberately.

### 4. Never store money as float

`0.1 + 0.2 !== 0.3`. Repeated over thousands of fee installments, floats produce receipts
that do not sum to the amount collected.

`decimal(10,2)` in Postgres. In TypeScript, Drizzle returns `decimal` as `string` — keep
it a string or hand it to a decimal library. Never `parseFloat`.

### 5. Never read `attendance_records` for reporting

`attendance_records` is the granular layer: one row per student per day, or per *period*
in period-wise schools. Counting "days present" from it double-counts in period-wise
schools and yields a different answer per school.

`daily_attendance_status` is the resolved layer: exactly one row per student per working
day, whatever the school's marking mode. Fees, exam eligibility, and UDISE+ reporting read
only this.

### 6. Never mutate `student_enrollments` year-over-year

The enrollment row is the scope anchor for a student's year: class, section, roll number.
Attendance, fees, and results all hang off it.

Mutating it at promotion would retroactively rewrite which class last year's attendance
belonged to. Promotion **inserts a new row** for the new year. The old one is frozen.

### 7. Never update `student_component_results` after `published`

Once marks are published, parents have seen them. Silently changing them destroys trust
and the ability to explain a discrepancy.

A correction inserts into `student_component_result_revisions` first — recording previous
value, new value, reason, and approver — then updates. The audit row is what makes the
change defensible.

### 8. Never expose unpublished marks to students

Teachers save drafts. A student seeing a draft mark, or a mark later corrected upward, is
a real incident with real parent phone calls.

The student portal reads `published_report_cards` (versioned snapshots) only — never
`student_component_results` or `student_subject_results`.

### 9. Never implement auth logic by hand

Password hashing, session rotation, timing-safe comparison, and token expiry are all
easy to get subtly, invisibly wrong. better-auth owns them. See ADR-003.

### 10. UUID primary keys everywhere

Sequential integer ids are enumerable: `/students/1041` tells an attacker there are at
least 1041 students and lets them walk the range. See ADR-002.

Exception: better-auth's own tables use `text` ids. FKs to `user.id` are therefore `text`.

### 11. Always `timestamp({ withTimezone: true })`

Schools are `Asia/Kolkata` today, but a server in UTC writing naive timestamps produces
attendance dated the previous day for anything after 18:30 IST. Store the offset.

### 12. Creating a school/class/section MUST insert a `scope_nodes` row

`scope_nodes` is the tree authorization walks to answer "may this user act here?". A node
missing from the tree is unreachable — every request for it 403s, including by the person
who just created it.

The insert belongs in the **same transaction** as the entity, inside the service. Not a
follow-up call that can fail independently.

---

## Anti-patterns

**Business logic in a tRPC router.** Routers validate input, call a service, return.
Logic in a router cannot be reused by the REST surface, a background job, or a webhook.

**Runtime imports in `apps/web`.** `import type { AppRouter }` only. A runtime import
from `@repo/db` pulls Drizzle and your connection string into the browser bundle.

**Reading `process.env` outside a package's own `env.ts`.** Each package declares the
vars it needs via `createEnv()` from `@repo/env`, and that file is the only reader. A
typo'd env var should fail loudly at boot, not as `undefined` three files deep at 2am.


**A second source of truth for a permission question.** If `org_role_permissions` answers
it, no other table may. See ADR-012 — this is why `attendance_policies.can_mark_roles` was
dropped.

**Optional tenancy parameters.** `schoolId?: string` means "sometimes unscoped", which
means eventually unscoped. Required argument, or a discriminated union.
