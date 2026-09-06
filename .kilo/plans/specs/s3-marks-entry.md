# Screen Spec — S3: Marks Entry and Verification

Per `.agents/skills/frontend-product-ux-skill/` — workflow-first; spec
precedes code for slice S3. This is the product's highest-frequency
teacher workflow and a high-trust academic record surface, so the
high-trust rules apply: state explicit, autosave honest, verification a
distinct act, published records never editable in place.

## Users / roles

- **Subject teacher** (primary): enters marks for her subject's paper in
  her section. `marks:create` + ADR-029 subject gate (server-enforced;
  the UI surfaces the worded refusal rather than pre-filtering — v1 has
  no client-readable per-subject grant map).
- **Class teacher / VP / Principal**: verifies entered marks
  (`marks:verify`), reviews the grid read-only (`marks:read`).

## Primary jobs

1. Enter one paper's marks fast: student × component grid, autosave per
   cell, keyboard-first (numeric input, Enter/Tab moves on).
2. Mark absent / exempt a student for a component — not a number, a
   status the result math treats specially.
3. Verify the entered set before compute (batch act, logged; verifier ==
   enterer allowed but recorded).

## Top workflow

```text
Exam detail (entry open) → "Enter marks" on a schedule
→ pick schedule → grid loads (roster × components)
→ type marks → blur/debounce autosave → cell turns Saved
→ finish → "Mark for verification"? (teacher's part done)
Class teacher: open verification view → scan → "Verify all entered"
```

## Important states

- Exam: `marks_entry` (editable) / `under_verification` (unverified
  editable, verified locked) — anything else: read notice, grid disabled.
- Cell: Empty → Saving → Saved (shows `updatedAt` truth) | Conflict
  ("changed while you were typing") | Refused (≤ max, subject gate) —
  never a silent overwrite; optimistic concurrency via `expectedUpdatedAt`.
- Entry row: draft → entered → verified → published (published cells are
  revision-ledger territory, not grid edits).
- Eligibility: advisory badge on the row (below attendance bar, not
  overridden) — entry continues; the bar is a decision, not a wall.

## Shared components

DataTable (grid is its own dense table, not the generic DataTable —
spreadsheet semantics), EmptyState, PageHeader, Badge, DropdownMenu
(cell status menu), ConfirmDialog (verify), PermissionGate.

## Screens

1. `/exams/[examId]/entry` — schedule picker (only this exam's papers)
   + the grid + verification controls. One screen, two modes: entry and
   review (same data, different affordances) — two screens would split
   the teacher's mental model for zero gain.

## New backend (view endpoint designed with the screen — plan rule)

- `ExamMarksService.entryGrid(scope, examId, scheduleId, sectionId?)`:
  roster (enrollment cohort definition, class + optional section) +
  existing component results joined to components — one call, no
  client-side stitching.
- `exam.marks.entry` read procedure: `marks:read` + schedule owner
  overlap gate. Writes stay the existing subject-gated `marks.save`.
- Integration proof: grid tenancy (other school's schedule NOT_FOUND)
  + roster/entry shape.

## Validation

Marks string regex + ≤ component max (inline error before save; the DB
trigger is the last line, the grid is the first). Exempt requires type.
Absent clears marks. Clearing every field returns the row to draft.

## Accessibility

Every cell input labelled (student + component, aria-label), status not
by color alone (worded badges), focus visible, keyboard order = grid
order, verify is a confirm dialog not a stealth bulk write.

## Responsive

Phone: grid becomes per-student cards (one card per student, its
components as labelled inputs) — the primary task survives; the
spreadsheet does not pretend to.

## Explicitly out (deferred, not silently dropped)

Term-grade (area) entry screen — rides with S4's term result screens if
not needed earlier; `listTermAssessments`/`saveTermAssessment` exist.
