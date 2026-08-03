# SMS — School Management System
## Complete Project Context for AI Agent

---

## 1. What This Is

A **multi-tenant SaaS School Management System** targeting private schools in India — primarily CBSE-affiliated, ICSE-affiliated, and unaffiliated private schools. Most target schools currently use no software at all.

This is a **production-grade platform**, not a narrow MVP. The goal is to go beyond admin-only tooling and create genuine engagement for all school stakeholders — Owners, Principals, Teachers, Students, and Parents — reframing the product as a "school community platform."

The system handles five core domains:
1. **Academic Structure** — Organizations, Schools (branches), Academic Years, Classes, Sections, Subjects, Student Enrollments
2. **Attendance** — Daily and period-wise attendance, corrections, authoritative daily status
3. **Fees** — Fee structures, installment billing, payment collection, concessions, financial ledger
4. **Exams & Results** — Multi-component exams, term/annual results, grading, report cards
5. **Authorization** — (deferred — being designed separately, NOT part of current codebase)

---

## 2. Market and Business Context

- **Target market**: Indian private schools; CBSE/ICSE schools are small in number but higher revenue; unaffiliated schools are the majority volume
- **Sales cycle**: Tied to April academic year start; December–April is the admissions/onboarding window
- **Ownership structures**: Trust/Society — "Owner" and "Principal" are distinct decision-maker roles
- **Key differentiator**: CBSE/NEP 2020 Holistic Progress Card alignment as a compliance-based sales point; most competitors haven't caught up
- **Integrations planned**: UPI-first fee payment, WhatsApp-first parent engagement (not built yet)
- **Branch support**: One Owner can run multiple school branches across cities under one Organization

---

## 3. Tech Stack Decisions

| Concern | Decision |
|---------|----------|
| Database | PostgreSQL 15+ |
| ORM | **Drizzle** |
| ID strategy | **UUID everywhere** — every table's primary key is a UUID. No integer IDs anywhere. No separate `public_id` column. One ID per row, always UUID. |
| Multi-tenancy | Shared DB, shared schema. Tenant = Organization (NOT school). See Section 4 for full explanation. |
| Auth | **better-auth** |

### ID Strategy — UUID Everywhere
Every table uses a single UUID primary key:
```ts
// Drizzle
id: uuid('id').primaryKey().defaultRandom()
```
- No BIGSERIAL, no integer PKs, no separate `public_id` columns
- The same `id` is used internally for all FK relationships AND exposed in APIs, URLs, and documents
- UUIDs are safe to expose — they are non-enumerable and non-guessable
- All foreign key columns are UUID type: `school_id uuid NOT NULL REFERENCES schools(id)`

### Auth — better-auth
- better-auth manages the `users` table, sessions, and authentication flows
- better-auth creates and owns its own tables (`user`, `session`, `account`, `verification`) — do not manually create or conflict with these
- The SMS `users` table (which stores school-role assignments and domain-specific user data) references better-auth's `user.id`
- Do not implement custom password hashing, session management, or JWT logic — delegate entirely to better-auth
- better-auth supports multi-tenant org structures natively; consult better-auth docs for org/member primitives before implementing custom role logic

---

## 4. Tenancy Model — Critical, Read Carefully

### The Tenant is the Organization, NOT the School

This is the most important architectural decision to understand. Getting this wrong causes data leaks and broken access patterns.

```
Platform (SaaS operator — us)
  └─ Organization  ← THE TENANT BOUNDARY
       ├─ School A (Branch — Kolkata)
       ├─ School B (Branch — Siliguri)
       └─ School C (Branch — Asansol)
```

**An Organization is a Trust/Society/Owner group** — e.g. "Greenwood Education Trust" that runs three schools across West Bengal. Each school is a branch of that Organization.

**Why the tenant is the Org, not the School:**
- The Owner logs in once and sees all their branches — they don't have separate accounts per branch
- Billing and subscription happen at the org level — one invoice for the whole group
- Org-level staff (like an Accountant who covers all branches) exist at the org level, not repeated per school
- Org-wide actions (start new academic session across all branches) originate at the org level
- Data isolation is still enforced at the school level — a teacher at School A cannot see School B's students

### How Tenancy Works in Practice

**Org-scoped data** — things that belong to the whole organization:
- The `organizations` row itself
- `academic_year_templates` (org defines, schools inherit)
- Org-level user roles (`Owner`, `Org_Admin`) in `user_school_assignments` where `school_id IS NULL`
- Billing / subscription records (outside this schema)

**School-scoped data** — everything operational:
- `school_id` is present on every operational table (academic years, classes, sections, students, attendance, fees, exams, results)
- A student belongs to a school, not an org
- A fee payment belongs to a school, not an org
- Attendance belongs to a school, not an org

**The access pattern:**
- A request authenticated as an `Owner` or `Org_Admin` carries an `organization_id` in session context — they can query across all schools WHERE `school_id IN (SELECT id FROM schools WHERE organization_id = $orgId)`
- A request authenticated as a `Teacher`, `Principal`, `Accountant` at a specific school carries both `organization_id` AND `school_id` in session context — all queries must filter by their specific `school_id`
- Cross-org data access is never permitted — ever

### Tenancy Isolation Rule
**Every query on an operational table MUST filter by `school_id` for school-scoped actors, or by `organization_id` → school lookup for org-scoped actors.** Never query operational tables without a tenancy filter. Row-level security (RLS) will be added as a DB-level enforcement layer when the authz system is built.

### Why a Single School Can Still Be a Valid Tenant
An Org with only one School is perfectly valid — it's just an Org with one branch. The schema handles this without any special-casing. The Owner still logs in at the Org level; they just happen to only see one school.

### User Roles and Tenancy Scope

Roles live in `user_school_assignments`, not on the user record:

| Role | `school_id` | `organization_id` | Scope |
|------|-------------|-------------------|-------|
| `Owner` | NULL | set | All schools under this org |
| `Org_Admin` | NULL | set | All schools under this org |
| `Principal` | set | set | One specific school |
| `Vice_Principal` | set | set | One specific school |
| `Teacher` | set | set | One specific school |
| `Accountant` | set | set | One specific school (or NULL for org-level accountant) |
| `Student` | set | set | One specific school |
| `Guardian` | set | set | One specific school |

A person can have multiple rows in `user_school_assignments` — e.g. an Accountant covering 3 branches has 3 rows, one per school. An Owner has one row with `school_id = NULL`.

---

## 5. Core Architecture Principles

These principles apply **everywhere** in the codebase. Every feature, query, and mutation must respect them.

### 5.1 Template → Resolved → Transactional
Every domain follows a three-layer pattern. Never skip a layer or short-circuit from template directly to transactional:

```
ClassSubjectMapping (template, per class)
  → StudentSubjectEnrollment (resolved, per student)

FeeStructure (template, per class)
  → StudentFeeAssignment (resolved, per student)
    → FeeInstallment (billing/transactional)
      → FeePayment + PaymentAllocation (collection/transactional)

ExamSubjectSchedule (template, per class)
  → StudentComponentResult (raw entered, per student)
    → StudentSubjectResult (computed per subject)
      → StudentTermResult (computed per term)
        → StudentFinalResult (computed annual)

AcademicYearTemplate (org-level template)
  → AcademicYear (per school, independent after creation)
```

### 5.2 Granular Layer → Single Authoritative Resolved Record
When data comes in at a granular level but is consumed at an aggregated level, always maintain a single resolved record that downstream modules read from — never have two modules independently aggregate the raw data:

- `attendance_records` (per day or per period) → `daily_attendance_status` (**all modules read only this**)
- `student_component_results` (per component) → `student_subject_results` (per subject)
- `fee_installments` (billing) ↔ `fee_payments` (collection) via `payment_allocations` join

### 5.3 Historical Integrity — Nothing Retroactively Changes
This is non-negotiable. Changing the current year must never corrupt what happened in a prior year. Changing a configuration must never silently alter historical records.

Mechanisms used:
- **Year scoping**: promotion creates a new `student_enrollments` row for the new year, never mutates the old one. Every prior year's attendance/fees/results stays anchored to that year's enrollment permanently.
- **Snapshotting at transaction time**: `section_id` is snapshotted on `attendance_records` at the moment of marking. If the student later transfers sections, past attendance stays as-was.
- **Immutable grading scales**: `grading_scales` are never modified after a result references them (`is_locked = TRUE`). Policy changes create a new scale row.
- **Snapshotted installment amounts**: `fee_installments.amount` is snapshotted at generation time. Fee structure revisions only affect future (not yet generated) installments.
- **Versioned report cards**: `published_report_cards` stores a full JSONB snapshot at publish time. Corrections create a new version; the original version is permanently preserved.
- **Audit tables, never overwrites**: corrections to attendance, marks, fees all go through dedicated revision/correction tables. The original record is never silently updated after it has been published/confirmed.

### 5.4 Soft Deletes Only
Core records are never hard-deleted:
- Users: `status = 'inactive'`
- Schools: `status = 'closed'`
- Subjects: `is_active = false`
- Transactional records (payments, results, attendance): never deleted at all

### 5.5 Configurable-per-School, Never Hardcoded
The system supports CBSE, ICSE, and unaffiliated schools through **configuration differences, not schema differences**. There is one schema — schools just configure it differently:
- Number of terms (2, 3, or "Full Year") — set per school
- Grading scale bands — configured per school/class
- Fee heads and structures — fully custom per school
- Attendance marking mode (daily vs period-wise) — configured per school
- Pass criteria, grace marks, compartment rules — configured per school/class
- Report card layout — templated per class-group

### 5.6 Decoupled Billing and Collection (Fees)
Billing (what's owed) and collection (what arrived) are always separate tables joined by an allocation table. This handles: quarterly lump sum against monthly billing, partial payments, advance payments — all without special cases. A payment can cover multiple installments; an installment can be covered by multiple partial payments.

### 5.7 Unified Financial Ledger
Every money-movement event (payment received, refund issued, concession applied, late fee charged) writes one row to `financial_transactions`. This is an **append-only** table — never updated or deleted. It is the single source of truth for accounting reports, Tally export, and GST reporting. Corrections happen via new offsetting entries, not updates.

---

## 6. Database Schema

### 6.1 Drizzle Conventions
```ts
// UUID primary key — every table
id: uuid('id').primaryKey().defaultRandom()

// UUID foreign key
school_id: uuid('school_id').notNull().references(() => schools.id)

// Timestamps — every table
created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

// Soft delete pattern
status: varchar('status', { length: 30 }).notNull().default('active')

// Boolean flags
is_active: boolean('is_active').notNull().default(true)

// Money — always decimal, never float
amount: decimal('amount', { precision: 10, scale: 2 }).notNull()

// Marks — decimal supports half-marks
marks_obtained: decimal('marks_obtained', { precision: 6, scale: 2 })
```

### 6.2 Table Inventory (58 tables)

#### Foundation (4 tables)
| Table | Purpose |
|-------|---------|
| `organizations` | Top-level Trust/Society entity. The tenant. |
| `schools` | One branch per org. `school_id` is on every operational table. |
| `users` | SMS-specific user data and role assignments. References better-auth `user.id`. Never deleted. |
| `user_school_assignments` | User ↔ School ↔ Role join. Dated. Supports multi-role, multi-school, org-level roles. |

#### Academic Structure (19 tables)
| Table | Purpose |
|-------|---------|
| `academic_year_templates` | Org-level template for bulk session creation across branches |
| `academic_years` | One per school per year. Primary time-scope key. Overlapping years prevented by exclusion constraint. |
| `terms` | Subdivisions of an academic year. Every year has ≥1 (auto "Full Year" if school doesn't split). |
| `academic_calendar` | Working/Holiday/Half-Day per date per school per year. Attendance validates against this. |
| `classes` | Grade levels. School-scoped, NOT year-scoped. Has `numeric_order` for correct sorting. |
| `sections` | Year-scoped subdivisions of a class (6-A, 6-B). New row each year. |
| `section_teacher_assignments` | Dated teacher-section assignments. Mid-year changes = new row, not mutation. |
| `system_subject_catalog` | Platform-seeded master subject list. Carries CBSE/ICSE subject codes. |
| `subjects` | School-specific subjects. References catalog or fully custom. |
| `subject_name_history` | Tracks name changes so historical documents reproduce the name active at generation time. |
| `subject_groups` | CBSE/ICSE variable component weightage (Group I/II = 80/20, Group III = 50/50). Optional. |
| `class_subject_mappings` | Template: which subjects a class takes this year. Auto-generates student subject enrollments. |
| `students` | Core student identity. Has own user login via `user_id`. |
| `student_guardians` | Dated student-guardian relationships. Guardian changes tracked over time, not overwritten. |
| `student_relationships` | Sibling/twin links between students. Used by fees module for concession eligibility. |
| `previous_school_records` | Lightweight TC-in provenance. Where the student came from. |
| `student_enrollments` | One per student per year. Scope anchor for all yearly data. `section_id` nullable until assigned. |
| `section_transfer_log` | Mid-year section moves. Base enrollment untouched. Attendance unaffected (snapshotted). |
| `student_subject_enrollments` | Resolved: which subjects this student is actually assessed on this year. Auto-generated from class mapping. Overridable for electives. |

#### Attendance (6 tables)
| Table | Purpose |
|-------|---------|
| `attendance_policies` | Per-school config: marking mode, daily status rule, roles allowed to mark/correct. |
| `periods` | Period structure for period-wise schools only. |
| `attendance_records` | Granular. `period_id` nullable (null = daily mode). `section_id` snapshotted at marking time. |
| `attendance_corrections` | Audit trail for every correction. Original never overwritten. |
| `daily_attendance_status` | **Authoritative resolved record. ALL downstream modules read ONLY this table.** |
| `attendance_summary` | Pre-aggregated counts per student per month/term/year. Refreshed nightly. |

#### Fees (14 tables)
| Table | Purpose |
|-------|---------|
| `fee_heads` | Types of fee. Fully custom per school. Has `is_taxable` (GST) and `category`. |
| `fee_structures` | Template: fee heads per class per year, with `installment_mode`. |
| `fee_structure_lines` | Individual fee head entries within a structure. |
| `student_fee_assignments` | Resolved per-student. Auto-generated from class structure. Handles mid-session admissions. |
| `fee_concessions` | Per-student discounts/waivers. Flat or percentage. Sits on top of assignment. |
| `student_optional_fee_subscriptions` | Transport/Hostel opt-in. Priced by route/zone, not class. |
| `late_fee_rules` | Configurable: Flat / Percentage / Per_Day accrual. Frozen into payment at charge time. |
| `fee_installments` | Billing: what's owed and when. Amounts snapshotted at generation time. |
| `opening_balances` | Previous-year dues carried forward. Tagged with origin year. |
| `fee_payments` | Collection: actual money. Full lifecycle: Pending/Cleared/Bounced/Reversed. |
| `payment_allocations` | Join: Payment ↔ Installment. Handles partial, bundled, advance without special cases. |
| `fee_refunds` | Refunds against payments. References original, never deletes it. |
| `financial_transactions` | Append-only unified ledger. Every money event writes here. Never updated. |
| `receipt_number_sequences` | Counter for sequential receipt numbers per school per year. Use row-lock to prevent races. |

#### Exams & Results (15 tables + 3 triggers)
| Table | Purpose |
|-------|---------|
| `grading_scales` | Mark-range → grade lookup. Auto-locked once first result references it. |
| `grading_scale_bands` | Individual bands within a scale (90-100 → A+, grade_point 10.0). |
| `pass_criteria` | Pass rules per school/class: min subjects, grace marks, compartment eligibility, min attendance %. |
| `exams` | Exam events scoped to a Term. Type: Regular/Supplementary/Improvement. |
| `exam_subject_schedules` | Template: subjects per exam per class. Locked once marks entry begins. |
| `exam_components` | Theory/Practical/Oral/Internal per subject. Own max marks, pass marks, weightage, optional grading scale. |
| `exam_eligibility` | Attendance-based eligibility per student per exam. Manual override with audit. |
| `student_component_results` | Raw entered marks. Ground truth. Never overwritten post-publish. |
| `student_component_result_revisions` | Audit trail for every post-publish correction. Previous values permanently preserved. |
| `student_subject_results` | Computed: weighted component rollup per subject. Stores before-grace and after-grace. |
| `student_term_results` | Computed: weighted exam rollup per term. Only `counts_towards_result` subjects in totals. |
| `student_final_results` | Computed: annual result per cumulative/terminal rule. Has `promotion_status`. |
| `coscholastic_assessments` | Life Skills/Art/PE — separate pipeline, grade/descriptor only, never feeds result math. |
| `report_card_templates` | Configurable layout per class-group. JSONB config. |
| `published_report_cards` | Versioned JSONB snapshots at publish time. Corrections add new version rows. |

**DB Triggers:**
- `trg_check_marks_max` — prevents `marks_obtained > max_marks` at DB level
- `trg_lock_grading_scale` — auto-sets `is_locked = true` when first result references a scale
- `trg_set_updated_at` — auto-updates `updated_at` on all relevant tables

---

## 7. Domain Logic — Critical Flows

### 7.1 Academic Year
- One `academic_year` per school per year. Overlapping date ranges blocked by DB exclusion constraint.
- `is_current = true` on only one row per school at a time.
- Org can bulk-create years across all active branches from a template. Each branch's row is fully independent after creation.
- `original_end_date` frozen at creation. `end_date` may update if year extends.

### 7.2 Terms
- Every `academic_year` must have ≥1 `term` row (enforced at application layer).
- Schools with no term concept get one auto-created "Full Year" term.
- `weightage` across all terms in a year must sum to 100.
- `result_mode` (`Cumulative` or `Terminal`) determines how `student_final_results` rolls up.

### 7.3 Student Enrollment Lifecycle
```
Admitted → Section_Assigned → Active → Transferred_Out | Withdrawn | Passed_Out
```
- `section_id` nullable until school assigns section.
- Promotion: new `student_enrollments` row for new year. Never mutate old row.
- Compartment: `promotion_pending = true`. New year enrollment deferred until supplementary result confirmed.
- Mid-year section transfer: insert `section_transfer_log`. Do NOT update `student_enrollments.section_id`.

### 7.4 Attendance Flow
1. Check `academic_calendar` — cannot mark attendance on non-working day.
2. Insert `attendance_records` (daily or per-period per `attendance_policies.marking_mode`).
3. Derive and upsert `daily_attendance_status`.
4. Nightly: refresh `attendance_summary`.
5. Corrections: insert `attendance_corrections`, update `attendance_records.record_status = 'corrected'`, re-derive `daily_attendance_status`.
6. **Never read `attendance_records` directly for reporting. Always use `daily_attendance_status` and `attendance_summary`.**

### 7.5 Fee Collection Flow
1. On enrollment: generate `student_fee_assignments` from `fee_structures` for student's class.
2. Apply `fee_concessions` → update `net_annual_amount`.
3. Generate `fee_installments` per `installment_mode`. Mid-session: only from `fee_effective_from` onward. Full month charged for join month.
4. Payment arrives: create `fee_payments` (Pending for non-cash, Cleared for cash).
5. Create `payment_allocations` linking payment to installment(s).
6. Update `fee_installments.paid_amount` and `payment_status`.
7. Write to `financial_transactions` (append-only, always).
8. Receipt: row-lock `receipt_number_sequences`, increment, format, store on `fee_payments`.
9. Bounces/reversals: update `fee_payments.payment_status`, write offsetting entry to `financial_transactions`. Never delete ledger rows.

### 7.6 Exam & Result Flow
1. Create `exams` under a `term` with a `weightage_in_term`.
2. Create `exam_subject_schedules` per class + `exam_components` per subject.
3. Teacher enters marks → `student_component_results` in `draft`. Partial saves OK.
4. Teacher completes → status `entered`.
5. Senior staff verifies → status `verified`. Pre-publish corrections are simple updates, no revision trail.
6. **Publish (per-class action)** → status `published`. From this point: any correction requires inserting `student_component_result_revisions` first, then updating the result.
7. Compute `student_subject_results`: weighted component rollup → grace → pass/fail → grade lookup.
8. Explicitly trigger rank computation. Tied ranks: both get same rank, next rank skips. Null until triggered.
9. Compute `student_term_results`: weighted exam rollup, `counts_towards_result = true` subjects only.
10. Year-end: compute `student_final_results` per term `result_mode`.
11. Generate `published_report_cards` JSONB snapshot — includes student legal name, school legal name, all marks/grades/attendance/co-scholastic, frozen.
12. Post-publish corrections: new version row in `published_report_cards` with `is_current = true`, old stays with `is_current = false`.

### 7.7 Co-Scholastic
- Completely separate from exam result computation.
- Teacher enters grade/descriptor per area per term in `coscholastic_assessments`.
- No marks, no components, no weightage math.
- Feeds report card generation but never included in `student_term_results` or `student_final_results`.

### 7.8 Grading Scales
- Assigned per school, optionally per class, optionally per exam component.
- Auto-locked (`is_locked = true`) by trigger when first result references the scale.
- Policy change: create a new `grading_scales` row, apply going forward. Old results keep their reference.

---

## 8. Cross-Domain Rules

### 8.1 Roles and Access
- Role is per `user_school_assignments` row, not per user.
- A Principal who is also a parent has two rows — one `Principal`, one `Guardian`.
- Org-level roles (`Owner`, `Org_Admin`): `school_id IS NULL`. Can see across all org branches.
- School-level roles: always have `school_id` set.
- `attendance_policies.can_mark_roles` / `can_correct_roles`: config arrays the authz system will read.

### 8.2 Exam Eligibility Check
- Check `exam_eligibility` before allowing a student to sit an exam.
- `is_eligible` computed from `attendance_summary.attendance_percentage` vs `pass_criteria.min_attendance_pct`.
- Manual override allowed with mandatory reason and `overridden_by`.

### 8.3 Year-End Promotion Flow
1. `student_final_results.promotion_status` determined.
2. `Promoted` → new `student_enrollments` in next year's next class.
3. `Detained` → new `student_enrollments` in next year's same class.
4. `Compartment` → `promotion_pending = true`, enrollment deferred.
5. `Passed_Out` (Class 12) → `students.status = 'passed_out'`, no new enrollment.
6. Unpaid fee balance → `opening_balances` row in new year referencing old year.

### 8.4 TC (Transfer Certificate) Out
1. `student_enrollments.enrollment_status = 'transferred_out'`
2. `students.status = 'transferred_out'`
3. Future `fee_installments` → status `cancelled`
4. No-dues check before TC issuance (application logic, not schema-enforced)
5. All historical records (attendance, results, payments) remain intact

---

## 9. better-auth Integration Notes

- better-auth owns: `user`, `session`, `account`, `verification` tables — do not touch these manually
- SMS `users` table (for domain data and role assignments) has a `better_auth_user_id` column referencing better-auth's `user.id`
- Session context provided by better-auth includes: `userId` (better-auth user id), from which the application resolves the SMS `users.id` and their `user_school_assignments`
- Multi-tenancy context (which org, which school) is derived from `user_school_assignments` at request time, not stored in the session token
- Organization concept in better-auth (if used): maps to `organizations` table. Evaluate whether better-auth's built-in org/member model can replace `user_school_assignments` or should sit alongside it — this is an open design decision at implementation time

---

## 10. What Is NOT Built Yet

| Domain | Status |
|--------|--------|
| **Authorization / Permissions** | Deferred. Schema has `role` on assignments and `entered_by` audit fields as preparation. |
| **Notifications** | Cross-cutting service, own domain. |
| **Timetabling** | `periods` table exists for attendance only, not a full timetable. |
| **Admissions Workflow** | Pre-enrollment funnel that eventually creates `students` + `student_enrollments`. |
| **Security Deposits** | Reserved: `fee_heads.category = 'refundable'` and `financial_transactions` types exist. No dedicated table yet. |
| **Messaging / Communication** | Own domain. |
| **Library / Inventory** | Non-core. Addable independently. |
| **Tally Export** | `financial_transactions` is export-ready by design. Integration not built. |
| **GST** | Fields exist (`is_taxable`, `tax_percentage`, `tax_amount`). Computation/filing not built. |
| **UPI / Payment Gateway** | `payment_mode` includes `UPI`. Gateway integration not built. |
| **WhatsApp Integration** | Not built. |
| **UDISE+ / CBSE Board Reporting** | `udise_code` exists. Report generation not built. |

---

## 11. Naming Conventions (Drizzle / PostgreSQL)

| Convention | Rule |
|------------|------|
| Tables | `snake_case`, plural nouns |
| Columns | `snake_case` |
| Primary key | `id uuid primaryKey defaultRandom()` — every table |
| Foreign keys | `{table_singular}_id` — e.g. `school_id`, `student_id`, all UUID type |
| Timestamps | `created_at`, `updated_at`, `published_at`, `effective_from`, `effective_to` |
| Status values | `snake_case` strings — e.g. `'active'`, `'passed_out'`, `'marks_entry'` |
| Boolean flags | `is_*` prefix — e.g. `is_active`, `is_locked`, `is_current` |
| Indexes | `idx_{table}_{columns}` |
| Constraints | `uq_*` unique, `chk_*` check |
| Triggers | `trg_{description}` |
| Drizzle schema files | One file per domain: `schema/foundation.ts`, `schema/academic.ts`, `schema/attendance.ts`, `schema/fees.ts`, `schema/exams.ts` |

---

## 12. Anti-Patterns — Never Do These

1. **Never hard-delete a user, student, payment, attendance record, or exam result.** Use status fields.
2. **Never update a `financial_transactions` row.** Append-only. Corrections = new offsetting rows.
3. **Never modify `grading_scales` or `grading_scale_bands` after `is_locked = true`.**
4. **Never update `fee_installments.amount` after generation.** Revisions require cancel + regenerate.
5. **Never read `attendance_records` directly for reporting.** Always use `daily_attendance_status`.
6. **Never query an operational table without a `school_id` (or org→school) filter.**
7. **Never mutate `student_enrollments` for year-over-year changes.** Promotion creates a new row.
8. **Never update `student_component_results` directly after status = `published`.** Insert revision row first.
9. **Never update `published_report_cards` rows.** Corrections add a new version row.
10. **Never treat the School as the tenant.** The Organization is the tenant. A school is a branch. Owner access spans all branches; data isolation is enforced at the school level within the org.
11. **Never store money as float.** Always `decimal(10,2)` in DB, and use a decimal library in application code.
12. **Never implement auth logic manually.** better-auth owns sessions, passwords, and tokens.

---

## 13. Recurring Patterns for New Features

**New time-bound data** (changes year to year): scope to `academic_year_id`. New rows for new years, never mutate old rows.

**New per-school configuration**: add a settings/config table per school. Never hardcode assumptions about how schools work.

**New event that happened** (transaction, marking, correction): add `created_by` + `created_at`. If correctable after confirmation, add a revision/audit table. Never allow silent overwrites.

**New computed field**: store as a Drizzle `$computed` / generated column or pre-computed summary table. Never compute live in every query.

**New document a user may reference years later** (certificate, receipt, marksheet): snapshot all relevant data into a JSONB column at creation time. Never rely on live joins to reconstruct historical state.

**New org-wide action** (bulk action across branches): template → per-school-materialized-copy pattern. Each school's copy is independent after creation.

**New cross-tenant query** (platform admin, analytics): always explicit org or school filter. Never allow a query that returns rows from multiple orgs without an intentional org filter.

---

## 14. Schema File Structure

```
sms-schema/                         ← Raw SQL reference (source of truth for structure)
├── README.md
├── 01_foundation.sql
├── 02_academic_structure.sql
├── 03_attendance.sql
├── 04_fees.sql
└── 05_exams.sql

src/db/schema/                      ← Drizzle schema (what the application uses)
├── foundation.ts                   ← organizations, schools, users, user_school_assignments
├── academic.ts                     ← academic years → student subject enrollments
├── attendance.ts                   ← attendance policy → attendance summary
├── fees.ts                         ← fee heads → receipt sequences
└── exams.ts                        ← grading scales → published report cards
```

Total schema: **58 tables, 103 indexes, 46 named constraints, 3 DB triggers.**
