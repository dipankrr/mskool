# SMS Database Schema
## School Management System — PostgreSQL

---

## Run Order
Execute files in this order (dependency sequence):

```
01_foundation.sql          -- Organizations, Schools, Users, UserSchoolAssignments
02_academic_structure.sql  -- AcademicYears, Terms, Calendar, Classes, Sections,
                           -- Subjects, Enrollments
03_attendance.sql          -- AttendancePolicy, Periods, AttendanceRecords,
                           -- DailyAttendanceStatus, AttendanceSummary
04_fees.sql                -- FeeHeads, FeeStructures, Installments, Payments,
                           -- Allocations, Refunds, FinancialTransactions
05_exams.sql               -- GradingScales, Exams, Components, Results (all levels),
                           -- CoScholastic, ReportCards
```

---

## Table Index (58 tables)

### Foundation
| # | Table | Purpose |
|---|-------|---------|
| 1 | `organizations` | Top-level Trust/Society entity |
| 2 | `schools` | Branch per organization. Primary tenant key |
| 3 | `users` | Central identity. Never deleted |
| 4 | `user_school_assignments` | User ↔ School ↔ Role join. Multi-role, multi-school |

### Academic Structure
| # | Table | Purpose |
|---|-------|---------|
| 5 | `academic_year_templates` | Org-level template for bulk session creation |
| 6 | `academic_years` | One per school per year. Primary time scope key |
| 7 | `terms` | Subdivisions of academic year (Term 1/2/3 or Full Year) |
| 8 | `academic_calendar` | Working/Holiday/Half-Day per date per school |
| 9 | `classes` | Grade levels. School-scoped, NOT year-scoped |
| 10 | `sections` | Year-scoped subdivisions of a class (6-A, 6-B) |
| 11 | `section_teacher_assignments` | Dated teacher-section assignments |
| 12 | `system_subject_catalog` | Platform-seeded master subject list |
| 13 | `subjects` | School-specific subjects (from catalog or custom) |
| 14 | `subject_name_history` | Tracks name changes for historical document accuracy |
| 15 | `subject_groups` | CBSE/ICSE component-weightage grouping config |
| 16 | `class_subject_mappings` | Template: subjects per class per year |
| 17 | `students` | Core student identity |
| 18 | `student_guardians` | Dated student-guardian relationships |
| 19 | `student_relationships` | Sibling/twin links (for fee concessions) |
| 20 | `previous_school_records` | TC-in provenance |
| 21 | `student_enrollments` | One per student per year. Scope anchor for all yearly data |
| 22 | `section_transfer_log` | Mid-year section moves. Base enrollment untouched |
| 23 | `student_subject_enrollments` | Resolved: subjects this student is assessed on this year |

### Attendance
| # | Table | Purpose |
|---|-------|---------|
| 24 | `attendance_policies` | Per-school config: daily vs period-wise, marking roles |
| 25 | `periods` | Period structure for period-wise schools |
| 26 | `attendance_records` | Granular: daily or per-period. section_id snapshotted |
| 27 | `attendance_corrections` | Audit trail for all corrections |
| 28 | `daily_attendance_status` | **Authoritative resolved record. All modules read only this** |
| 29 | `attendance_summary` | Pre-aggregated counts per month/term/year |

### Fees
| # | Table | Purpose |
|---|-------|---------|
| 30 | `fee_heads` | Types of fee (Tuition, Transport, Lab...) |
| 31 | `fee_structures` | Template: fee heads per class per year |
| 32 | `fee_structure_lines` | Individual fee head entries within a structure |
| 33 | `student_fee_assignments` | Resolved: what this student owes this year |
| 34 | `fee_concessions` | Per-student discounts/waivers on top of assignment |
| 35 | `student_optional_fee_subscriptions` | Transport/Hostel opt-in subscriptions |
| 36 | `late_fee_rules` | Configurable late fee calculation per school |
| 37 | `fee_installments` | Billing: what's owed and when (snapshotted amounts) |
| 38 | `opening_balances` | Previous-year dues carried forward |
| 39 | `fee_payments` | Collection: actual money received with lifecycle status |
| 40 | `payment_allocations` | Join: Payment ↔ Installment (decoupled billing/collection) |
| 41 | `fee_refunds` | Refunds against payments |
| 42 | `financial_transactions` | **Append-only unified ledger. Single source for accounting** |
| 43 | `receipt_number_sequences` | Sequential receipt number counter per school per year |

### Exams & Results
| # | Table | Purpose |
|---|-------|---------|
| 44 | `grading_scales` | Mark-range → grade lookup. Never mutated after use |
| 45 | `grading_scale_bands` | Individual bands within a grading scale |
| 46 | `pass_criteria` | Pass rules, grace marks, compartment config per school/class |
| 47 | `exams` | Exam events scoped to a Term |
| 48 | `exam_subject_schedules` | Template: subjects, dates, structure per exam per class |
| 49 | `exam_components` | Theory/Practical/Oral/Internal with marks and weightage |
| 50 | `exam_eligibility` | Attendance-based eligibility check per student per exam |
| 51 | `student_component_results` | **Raw entered marks. Ground truth. Never overwritten post-publish** |
| 52 | `student_component_result_revisions` | Audit trail for post-publish corrections |
| 53 | `student_subject_results` | Computed: weighted component rollup per subject per exam |
| 54 | `student_term_results` | Computed: weighted exam rollup per term |
| 55 | `student_final_results` | Computed: annual result + promotion status |
| 56 | `coscholastic_assessments` | Life Skills/Art/PE — separate pipeline, no marks math |
| 57 | `report_card_templates` | Configurable layout per class-group |
| 58 | `published_report_cards` | Versioned snapshots. Guarantees historical reproducibility |

---

## Core Design Principles

### 1. Template → Resolved → Transactional
Used consistently across all domains:
- `ClassSubjectMapping` → `StudentSubjectEnrollment`
- `FeeStructure` → `StudentFeeAssignment` → `FeeInstallment` → `FeePayment`
- `ExamSubjectSchedule` → `StudentComponentResult` → `StudentSubjectResult` → `StudentTermResult` → `StudentFinalResult`
- `AcademicYearTemplate` → `AcademicYear`
- `AcademicCalendar` template → per-school calendar

### 2. Granular Layer → Single Authoritative Resolved Record
- `AttendanceRecord` (daily/period) → `DailyAttendanceStatus` (always present, all modules read only this)
- `StudentComponentResult` (per component) → `StudentSubjectResult` (per subject)
- `FeeInstallment` (billing) ↔ `FeePayment` (collection) via `PaymentAllocation`

### 3. Historical Integrity — Nothing Retroactively Changes
- `AcademicYear` scoping: promotion creates new `StudentEnrollment`, never mutates old one
- `section_id` snapshotted on `AttendanceRecord` at marking time
- `GradingScale` never mutated after use (`is_locked = TRUE`)
- `FeeInstallment` amounts snapshotted at generation time
- `PublishedReportCard` versioned snapshots
- Corrections via dedicated audit/revision tables, never silent overwrites

### 4. Hybrid ID Strategy
- `id BIGSERIAL` — internal primary key, used for all FK relationships
- `public_id UUID` — exposed in APIs, URLs, receipts, anything user-facing
- Internal integers never leave the backend

### 5. Soft Deletes Only
- Users: `status = 'Inactive'`
- Schools: `status = 'Closed'`
- Subjects: `is_active = FALSE`
- Core transactional records (payments, results, attendance): never deleted

### 6. Financial Integrity
- `financial_transactions`: append-only unified ledger
- Sequential immutable receipt numbers via `receipt_number_sequences`
- `FeePayment.payment_status`: Pending/Cleared/Bounced/Reversed
- `is_taxable` flag on `FeeHead` for GST readiness
- Late fee frozen into payment at charge time

---

## Multi-Tenancy
- Shared DB, shared schema
- `school_id` on every tenant-scoped table
- `organization_id` for cross-branch org-level operations
- Org-level roles: `user_school_assignments` with `school_id = NULL`
- Row-level security (RLS) to be added when authz system is designed

---

## What's Deliberately NOT in This Schema
- **Authorization / Permissions** — deferred, own dedicated design
- **Notifications** — cross-cutting, own service
- **Timetabling** — independent domain, not core
- **Admissions workflow** — can be added independently
- **Security deposits** — door kept open via `fee_heads.category = 'Refundable'`
- **Messaging / Communication** — own domain
- **Library, Inventory** — non-core, addable independently
