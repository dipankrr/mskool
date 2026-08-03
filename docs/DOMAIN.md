# Domain

63 tables in 6 groups. Column-level detail lives in `docs/reference/sql/` — but where
that SQL conflicts with `docs/DECISIONS.md`, the ADR wins (it is pre-decision material).

---

## The pattern that repeats everywhere

**Template → Resolved → Transactional.** Once you see it, most of the schema explains
itself.

```
Template        what the school configured        class-level, reusable
Resolved        what applies to THIS student      per-student, snapshotted
Transactional   what actually happened            append-mostly, audited
```

| Domain | Template | Resolved | Transactional |
|---|---|---|---|
| Subjects | `class_subject_mappings` | `student_subject_enrollments` | — |
| Fees | `fee_structures` | `student_fee_assignments` → `fee_installments` | `fee_payments` + `payment_allocations` |
| Exams | `exam_subject_schedules` | `student_component_results` | `student_subject_results` → term → final |
| Attendance | `attendance_policies` | `daily_attendance_status` | `attendance_records` |
| Years | `academic_year_templates` | `academic_years` | — |

The Resolved layer exists because **the template can change and history must not**. A
school revising its fee structure in October must not alter invoices already raised. So
`student_fee_assignments` snapshots amounts at assignment time, and revisions affect only
installments not yet generated.

The second recurring shape: **granular → authoritative**. `attendance_records` may hold
one row per period; `daily_attendance_status` holds exactly one row per student per day.
Everything downstream reads only the authoritative layer (hard rule 5), because otherwise
"days present" means something different at each school.

---

## 1. Foundation & identity (9)

| Table | Notes |
|---|---|
| `organizations` | The tenant (ADR-001). Trust/Society. |
| `schools` | Branches. `school_id` is the tenant key on nearly every table below. |
| `staff` | Employment identity: `employee_code`, `designation`, `date_of_joining`. |
| `guardians` | Contact records, **no login** (ADR-006). |
| `students` | Admission identity. No `user_id` (ADR-008). |
| `student_guardians` | Dated student↔guardian link. Custody changes are new rows. |
| `student_relationships` | Sibling/twin links — drives sibling fee concessions. |
| `previous_school_records` | TC-in provenance for transfer admissions. |
| `student_portal_access` | user ↔ student, many-to-many (ADR-008). |

Plus better-auth's own `user`, `session`, `account`, `verification` — `text` ids, not
counted above.

`schools.legal_name` is **snapshotted onto documents** at generation time, not
live-joined. A school renaming itself must not retroactively rewrite certificates issued
under the old name.

## 2. Authorization (4)

| Table | Notes |
|---|---|
| `scope_nodes` | The tree authz walks. Hard rule 12. |
| `org_role_permissions` | Per-org, editable — permissions are data, not code. |
| `role_assignments` | Staff only (ADR-005). Never students. |
| `authz_audit_log` | Who granted what, when. |

## 3. Academic structure (15)

`academic_year_templates`, `academic_years`, `terms`, `academic_calendar`, `classes`,
`sections`, `section_teacher_assignments`, `system_subject_catalog`, `subjects`,
`subject_name_history`, `subject_groups`, `class_subject_mappings`,
`student_enrollments`, `section_transfer_log`, `student_subject_enrollments`.

Distinctions that are easy to get wrong:

- **`classes` are school-scoped; `sections` are year-scoped.** "Class 6" is permanent;
  "6-A in 2025-26" is a new row every year.
- **`student_enrollments` is the year anchor.** One row per student per year. Attendance,
  fees, and results all hang off it. Promotion inserts a new row (hard rule 6).
- **`class_subject_mappings` is the template; `student_subject_enrollments` is the
  authority.** Exams and report cards read the latter, because electives, drops, and
  exemptions make them differ.
- **`academic_years` carries `original_end_date`** frozen at creation, separate from a
  possibly-extended `end_date`.
- **`subject_name_history`** exists so a 2019 marksheet reprints "Maths" if that is what
  it said in 2019.

## 4. Attendance (6)

`attendance_policies`, `periods`, `attendance_records`, `attendance_corrections`,
`daily_attendance_status`, `attendance_summary`.

- `attendance_records.section_id` is **snapshotted at marking time**. A mid-year section
  transfer must not rewrite which section last month's attendance belonged to.
- Schools mark either daily or period-wise; `daily_attendance_status` normalises both via
  `derivation_mode` (`homeroom_authoritative` or `threshold_percentage`).
- Corrections never overwrite: a row goes into `attendance_corrections` and the original's
  `record_status` becomes `corrected`.
- `attendance_summary` is a pre-aggregate, refreshed on change — report cards and late-fee
  rules would otherwise re-`COUNT` a year of rows per student.

## 5. Fees (14)

`fee_heads`, `fee_structures`, `fee_structure_lines`, `student_fee_assignments`,
`fee_concessions`, `student_optional_fee_subscriptions`, `late_fee_rules`,
`fee_installments`, `opening_balances`, `fee_payments`, `payment_allocations`,
`fee_refunds`, `financial_transactions`, `receipt_number_sequences`.

**Billing and collection are deliberately decoupled.** `fee_installments` is what is owed;
`fee_payments` is what arrived; `payment_allocations` joins them many-to-many. That is the
only way to handle one cheque covering three months, or half of one month.

- `financial_transactions` is the append-only ledger every money movement writes to —
  the one table accounting and Tally export read (hard rule 3).
- `receipt_number_sequences` needs `SELECT … FOR UPDATE`; two concurrent cashiers must not
  produce the same receipt number.
- `fee_payments.payment_status` tracks `pending → cleared → bounced/reversed`, not just
  success. A bounced cheque is a real event with an accounting consequence.
- Late fee is computed live for display but **frozen into the payment** when charged, so a
  later rule change cannot alter a past receipt.
- `opening_balances` carries prior-year dues forward tagged with their origin year, rather
  than polluting the current year's structure.

## 6. Exams & results (15)

`grading_scales`, `grading_scale_bands`, `pass_criteria`, `exams`,
`exam_subject_schedules`, `exam_components`, `exam_eligibility`,
`student_component_results`, `student_component_result_revisions`,
`student_subject_results`, `student_term_results`, `student_final_results`,
`coscholastic_assessments`, `report_card_templates`, `published_report_cards`.

The computation chain:

```
student_component_results   raw entered marks — the ground truth
      ↓ weighted by exam_components.weightage_percentage
student_subject_results     + grace, pass/fail, grade
      ↓ weighted by exams.weightage_in_term
student_term_results
      ↓ per terms.result_mode (cumulative | terminal)
student_final_results       → promotion_status → next year's enrollment
```

- **Components** (Theory/Practical/Oral/Internal) each carry `max_marks`, `pass_marks`,
  and `is_mandatory_pass` — which is how "must pass Theory separately from Practical" is
  expressed.
- `grading_scales.is_locked` flips true on first use and the scale then never changes;
  otherwise a policy change would silently restate old results.
- `subjects.counts_towards_result = false` excludes a subject from totals — co-scholastic
  and activity subjects.
- `coscholastic_assessments` is a **separate pipeline** with grades only, and never enters
  result maths.
- `published_report_cards` stores a full JSONB snapshot, versioned. A duplicate marksheet
  requested in 2032 must reproduce exactly, including the school name and grading scale in
  force at the time.

---

## Critical flows

**Admission.** Create `students` → `student_enrollments` for the current year →
auto-generate `student_subject_enrollments` from `class_subject_mappings` → create
`student_fee_assignments` from the class `fee_structures` → generate `fee_installments`
from `fee_effective_from` onward. Mid-session admission generates only remaining
installments; `joining_month_full_charge` decides whether the joining month is prorated.

**Promotion (year rollover).** Read `student_final_results.promotion_status` → insert a
**new** `student_enrollments` row for the next year (never mutate the old one) → carry
unpaid dues into `opening_balances` tagged with the origin year. Students with
`promotion_pending` wait on a supplementary result. Note `scope_nodes` and
`role_assignments` also need remapping across years — listed under "Later" in `TASKS.md`.

**Fee collection (counter).** Staff records a payment → insert `fee_payments` (receipt
number from the row-locked sequence) → `payment_allocations` against chosen installments →
update `fee_installments.paid_amount` and `payment_status` → append to
`financial_transactions`. One transaction.

**Fee collection (portal).** Different, and the difference is the point (ADR-009): the
student creates a payment *intent* only; the gateway webhook, running as
`kind: 'system'`, is what writes `fee_payments`. The client never asserts that money
arrived.

**Result publication.** Enter marks (`draft`) → `entered` → `verified` → compute subject,
term, and final results → publish, which writes `published_report_cards` snapshots. Only
then is anything visible to a student (hard rule 8). Post-publish corrections insert a
`student_component_result_revisions` row first (hard rule 7) and produce a new report card
version rather than editing the old one.
