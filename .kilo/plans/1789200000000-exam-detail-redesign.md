# Exam detail redesign — the owner's flow, made concrete (Phase 6b)

Date: 2026-09-12 · Branch: `feature/phase5-exams` · Web-only (no backend, no contract change)

## The brief (owner's words, operationalized)

1. Hub keeps its one "Add exam" button. Keep.
2. The status train stays — it is the good part.
3. Stop asking the principal to ADD papers. Ask which classes take the exam,
   then pre-populate each class's papers from its curriculum as an editable
   table (most schools examine every mapped subject; deleting a row is the
   exception, not the default action).
4. Class chips across the top of the papers section — not stacked cards, not
   a dropdown. 5 classes × 8 subjects must never be one long scroll.
5. Sections must be first-class: a paper is class-wide by default, but any
   paper can get a section's own date/room/time (the schema already supports
   this — `exam_subject_schedules.sectionId` NULL = whole class).
6. "Publish readiness / Compute result / Publish this class / all" at the
   bottom confused the owner — fold publication into one understandable flow,
   and only show it from marks entry onward.
7. Buttons that don't look like buttons — outline/ghost everywhere gave the
   page no hierarchy. One solid primary action; the rest demoted.

## Product model

Who: the principal (also admin). Job per lifecycle stage:

| Stage | Their job | Page leads with |
|---|---|---|
| draft | choose classes, fix the date sheet | class chips + editable papers |
| scheduled | sanity-check, then start | papers (read-only) + "Mark ongoing" |
| ongoing | nothing until papers end | papers + "Open marks entry" |
| marks_entry / verification | get marks in, verify | entry links + Results section |
| published / locked | distribute results | "View results" |

## Screen changes

### Exam detail page (`[examId]/page.tsx`) — rewritten

- **Header**: exam name, term, status badge. Lifecycle track below (kept).
- **Action bar**: ONE solid button = the stage's next action (or its dialog);
  back-moves + secondary links collapse into a "More actions" overflow menu
  (real `DropdownMenu`, styled as a button, not a text link).
- **Stage-aware body** (the page changes shape with the state):
  - draft/scheduled → `PapersSection` in edit mode (chips, add classes,
    remove class, per-row editing).
  - ongoing → papers read-only; primary action "Open marks entry".
  - marks_entry/verification → papers read-only with "Enter marks" links;
    the **Results & publication** card (see below).
  - published/locked → results link; papers read-only.
- **Gone**: the always-rendered readiness panel with its own class dropdown.

### New: `papers-section.tsx` (feature component)

- **Class chips**: horizontal, wrap on mobile; selected chip filled; each
  chip shows the class name and paper count. Chips ARE the class dropdown of
  the old readiness panel AND the old per-class cards.
- **"Add classes"** (solid, only in draft/scheduled): dialog lists branch
  classes NOT yet in the exam. On confirm, per class:
  - fetch `assignment.subjectMapping.list` (exam's academic year), keep
    active mappings;
  - build one schedule row per subject — date prefilled working-day-sequence
    starting tomorrow (Sundays skipped), 09:30, 180 min, section = All;
  - `schedules.save` per class (batch), then one default component
    ("Theory", 100 marks, pass 33, weight 100) per created paper — the CBSE
    norm as an EDITABLE default, never a hidden rule;
  - toast: "N classes added · M papers created from the class subjects".
  - Edit is cheap afterwards: `schedules.save` replaces the class's rows and
    explicitly deletes their components (service-verified, no-marks guard).
- **Per-class papers table** (DataTable, card fallback on mobile): Subject ·
  Section ("All sections" or name) · Date · Time · Duration · Venue ·
  Components (count → ComponentsDialog) · Actions.
  - Row actions: Edit paper (opens ScheduleDialog), Components, and — from
    marks entry — Enter marks.
  - **Date-sheet conflict lint** (client-side, same class + date +
    overlapping start/end): amber "Overlaps <subject>" badge in the row.
    Advisory only; the server stays the referee.
- **"Remove class"** (draft/scheduled only): in the section toolbar; confirm
  dialog states marks-rows consequence; saves an empty batch for the class.
- **"Edit schedule"** opens the rewritten ScheduleDialog for the active chip.

### Rewritten: `schedule-dialog.tsx` — table, not stacked fieldsets

One `<table>`: Subject · Section · Date · Start · Duration(min) · Venue ·
Pass mark override · delete. `overflow-x-auto` on phones. The append row and
the save semantics are unchanged (batch replace per class). Same wire shape —
the conformance suite's payloads still fit.

### Results & publication card (marks entry onward)

- Title "Results & publication", description states the order:
  compute → review → publish (parents see results after publish).
- Badges: Marks entered x/y · Verified z · Results up to date / stale
  ("Recalculate" refreshes ELIGIBILITY — the old button's real job, now
  honestly labeled "Recheck attendance eligibility").
- Below-pass-mark students: same list, exemptions with reason kept (the
  audit path), renamed honestly ("Below pass mark", "Allow to sit").
- Publish per class: solid button → ConfirmDialog whose consequence now
  embeds the live checklist ("Marks entered 6/6 · 1 student below pass mark
  (exempt if needed) · Results become visible to parents immediately").
  "Publish all classes" moves into the same row as secondary.

### Copy pass (vocabulary = the principal's)

- "Blueprint / schedule section" → "Papers"; per-class edit → "Edit papers".
- "Publish readiness" → "Results & publication"; "below bar" → "Below pass
  mark"; "compute" (eligibility) → "Recheck attendance eligibility".
- Transition labels keep their verbs; consequences unchanged (they were good).

## Deliberately unchanged

- Entry page + marks grid (BUG-11 hardening stands).
- Results page (compute/ranks/revisions live there; typography follow-up is
  separate recorded work).
- Hub page. Contracts, services, routers — zero backend changes.

## Test impact

- Unit (web): unchanged hooks still typecheck; papers-section adds none.
- Conformance/integration/smoke: untouched (no backend).
- **e2e journey rewritten** for the new flow: create → Add classes → 2
  prefilled papers appear → edit Math components to Theory 80 + Internal 20
  (keeps exercising ComponentsDialog) → transitions → teacher enters marks →
  entries still total 6/6 → verification → publish this class. The prefill
  path (the new feature) is itself the journey's happy path.

## Risks

- Prefill creates papers the school didn't want → one "Remove class" click
  undoes it while draft (the guard: marks-absence check server-side).
- Base UI select re-render races in the batch editor → the journey's
  wait-for-listbox discipline is kept from Phase 6a.
- Class chips + active-class sections query: only the ACTIVE class's
  sections are fetched (enabled-gated) — a foreign class never 403s.
