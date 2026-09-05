# Screen Spec — S1: Exam Config Screens (subjects, subject types, scales, criteria, class curriculum)

Written per `.agents/skills/frontend-product-ux-skill/` (workflow-first;
this spec precedes any code for slice S1).

## Screens

1. `/subjects` — the school's subject catalogue.
2. `/exams/setup` — the exam policy screen (tabs: Subject Types · Grading
   Scales · Pass Criteria).
3. `/classes/[classId]` — new "Subjects & Teachers" section on the existing
   class detail page (class-subject mappings + teacher assignments for the
   active year).

## Purpose

Everything an exam needs must exist BEFORE an exam is created: the subject
vocabulary, the school's subject types (which own result math and report-card
widgets), grading scales, pass rules, and each class's yearly curriculum with
its teachers. S1 makes those first-class screens so S2 (exam setup) never
blocks on missing data.

## Primary user

School admin / principal (config owner). Class teachers READ the class
curriculum; only admins edit.

## Entry points

- App shell nav: "Subjects" (catalogue), "Exam Setup" (policy).
- Class detail page (existing `/classes/[classId]`): new section.

## Context that must remain visible

- The active school + academic year (the app shell's active context).
- On `/exams/setup`: which tab is active; whether a grading scale is LOCKED
  (first use) — locked scales show a lock badge and disable band editing.
- On the class page: the year the curriculum belongs to; each mapping's
  subject type badge.

## Primary task (per screen)

1. Subjects: scan the catalogue → add/rename/deactivate a subject.
2. Subject types: scan the widget list → add a type (name + flags) or apply
   the CBSE preset → assign subjects to types on the class page.
3. Grading scales: view bands → create a scale with bands → replace bands of
   an unlocked scale.
4. Pass criteria: view the year's default + class overrides → edit the
   default (must-pass list, grace, compartment, attendance bar).
5. Class curriculum: per class — add a subject mapping (subject + type +
   sequence), assign the subject teacher.

## Secondary tasks

- Apply the CBSE preset (one click, idempotent per name).
- Deactivate (never delete) a subject/type/scale.
- See which scale is the school default; switch the default.

## Information hierarchy

1. Critical: the list itself (subjects / types / scales / mappings) with
   state badges (active, locked, default).
2. Important: primary action button ("Add subject", "Apply CBSE preset").
3. Metadata: sequence, description, short code.
4. Helper: explanations of what the flags mean (counts toward result /
   graded only / term grade) as field descriptions inside dialogs.

## Layout

- Fees-style: PageHeader + Tabs (setup screen) / single-section pages, dense
  DataTable rows, actions in row menus, dialogs for create/edit. No cards.

## Components

Reused primitives only: PageHeader, SectionHeader, DataTable, StatusBadge,
EmptyState, FormField, ConfirmationDialog (deactivate), Select, Input.

## Data shown

- Subjects: name, short name, code, active.
- Subject types: name, counts-toward badge, graded-only badge, mode badge,
  sequence.
- Scales: name, default badge, locked badge, bands (label, range, point).
- Pass criteria: min subjects, grace caps, compartment cap, attendance bar.
- Class curriculum: subject, type (badge), teacher, sequence, elective flag.

## User actions

Subjects: create, update, deactivate. Types: create, update, deactivate,
apply preset. Scales: create (with bands), replace bands, rename,
deactivate. Criteria: create default, create class override, edit. Class
curriculum: add mapping, change mapping type (blocked with the worded error
once assessment data exists — ADR-032 lock), end/start teacher assignment.

## Default state

Lists render from the active context's school + year. Types tab shows the
"Apply CBSE preset" affordance when the school has no types yet.

## Loading state

Table skeletons (fees precedent).

## Empty state

"Nothing here yet" + the primary action ("Add your first subject") — never a
blank table.

## Error state

lib/copy.ts friendly wordings; worded domain errors (locked type, frozen
blueprint) surface inline in the dialog.

## Partial/in-progress state

Mapping rows may lack a teacher (class-teacher default for term_grade);
criteria may be default-only.

## Locked/published state

- Locked grading scale: bands disabled + lock badge.
- Subject type with assessment data: flags disabled with the worded reason
  (re-assign a different type instead).

## Validation rules

Contract schemas (`@repo/contracts` exam.contract.ts): names ≤ limits,
percent strings, bands contiguous (worded), grade caps ≤ subject caps.

## Accessibility requirements

Labels independent of placeholders, keyboard-navigable tables/dialogs,
focus-visible, status not by color alone (badge text), aria-invalid on
errors — per the skill's checklist and the fees precedent.

## Responsive behavior

Tables collapse secondary columns; dialogs become sheets on narrow screens
(fees precedent).

## Success / next step

S1 done when a school can, entirely from the UI: define subjects, seed
types, set the default scale + pass criteria, and wire a class's curriculum
— the exact preconditions S2's exam creation asserts.
