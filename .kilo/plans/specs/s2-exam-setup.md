# Screen Spec — S2: Exam Setup, Lifecycle, and Readiness

Per `.agents/skills/frontend-product-ux-skill/` — workflow-first; spec
precedes code for slice S2.

## Screens

1. `/exams` — the exams hub: every exam for the active year with its
   lifecycle state and publication progress.
2. `/exams/[examId]` — the exam detail: blueprint editor (schedules per
   class, components per schedule), lifecycle controls, and the per-class
   readiness panel.

## Purpose

Turn exam setup from a data-entry chore into a guided workflow: create the
exam, fill its blueprint, walk the lifecycle, and publish class by class —
each step gated by the same preconditions the API enforces.

## Primary user

Principal / VP (exam creation, lifecycle, publication). Subject teachers
read the schedule; class teachers read their class's readiness.

## Entry points

- Nav: "Exams" (`/exams`).
- Exam detail from the hub; readiness panel deep-links publishing.

## Context that must remain visible

- The exam's status badge (7 states) on every screen it appears.
- On detail: the term + year; which class's blueprint you are editing.
- On readiness: unverified counts, stale-compute warning, below-bar
  attendance list (advisory), and what publishing will make visible.

## Primary task

1. Hub: scan exams → open one → create new (name, term, type).
2. Detail: per class — add subject schedules (subject, date, start,
   duration, venue); per schedule — components (name, max, pass, weightage,
   mandatory); save batches.
3. Lifecycle: hit the next-state button; the server's worded precondition
   errors surface inline.
4. Readiness: review the checklist → "Publish this class" (consequence
   stated: "Results become visible to parents").

## Secondary tasks

- Edit weight/count while still draft; locked once marks exist (worded).
- Recompute eligibility; override a below-bar student with a reason.

## Information hierarchy

1. Critical: status badge + the next-action button.
2. Important: the schedules table / components table / readiness checklist.
3. Metadata: venue, duration, sequence.
4. Helper: field descriptions (weightage sums to 100; coverage must be
   complete before scheduling).

## Layout

- Hub: DataTable (exam, term, status, classes published).
- Detail: header (status + transitions) → schedules section (per class
  groups) → components per schedule (expandable) → readiness panel.

## Components

DataTable, StatusBadge, FormDialog, ConfirmDialog (transition +
publish), EmptyState, PermissionGate — house primitives only.

## Data shown

Schedules: class, subject, date, time, duration, venue, locked badge.
Components: name, max, pass, weightage, mandatory badge. Readiness:
entered/total, verified count, stale flag, below-bar attendance list.

## User actions

Create/update exam; save schedules batch; save components batch;
transition; recompute eligibility; override; publish class; publish exam.

## Default state

Hub lists the active year's exams; detail shows draft exam with empty
schedules (empty state: "Add the first subject schedule").

## Loading / Error / Empty states

Skeletons; friendly wordings (lib/copy); retry; empty states with the
primary action — per the S1 spec and fees precedent.

## Partial/in-progress state

Partial entry is valid — the readiness panel SHOWS the gap rather than
blocking navigation; publish refuses with the worded reason.

## Locked/published state

Published exam: blueprint frozen (edit actions hidden), publication
records per class visible, revision-window actions appear.

## Validation rules

Contract schemas: batch saves, weightage sums, ISO dates, duration bounds.

## Accessibility requirements

Same as S1 (labels, keyboard, focus, status text, aria-invalid).

## Responsive behavior

Tables collapse to cards (renderCard); the detail's sections stack.

## Success / next step

Exam scheduled → entered → verified → published per class with the cards
frozen — S3's marks grid then feeds the entry state this screen reports.
