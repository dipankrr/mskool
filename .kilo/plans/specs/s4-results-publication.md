# Screen Spec — S4: Results, Publication, and Correction Windows

Per `.agents/skills/frontend-product-ux-skill/` — workflow-first; spec
precedes code for slice S4. This is the principal's decision surface and
the school's public act: publication makes marks visible to families, so
every consequential button states its consequence and every frozen number
stays frozen (high-trust rules).

## Users / roles

- **Principal / VP** (primary): computes results, reviews the league
  table, publishes per class or the whole exam, opens/closes correction
  windows, applies post-publication corrections (`marks:publish`).
- **Class teacher**: reads her class's results and her students' card
  history (`report_card:read`).
- **Subject teacher**: reads results for her subject's rows.

## Primary jobs

1. Compute → review → publish, class by class, with the readiness panel's
   checklist already green (S2 owns the checklist; S4 owns the act).
2. Read the league table: rank, total, percentage, grade, pass state —
   and the class statistics that give the numbers meaning (per-subject
   average/highest, class average, pass count).
3. After publication: open a correction window, fix the mark (ledger
   row first), close the window — cards re-issue only where data changed.

## Top workflow

```text
Exam detail (verified entries) → Results tab → pick class
→ Compute → table + stats fill → review → "Publish this class"
(consequence stated) → status Published
Later: "Open correction window" → per-student correction dialog
(ledger first, reason required) → "Close window" → re-issued cards named
```

## Important states

- Computed vs stale: the compute is a snapshot; a stale badge (from
  readiness) means the table is a photograph of an earlier state.
- Published per class: the publication record (who/when, card version)
  is the visible proof; before publish, rows say Draft.
- Correction window: open (corrections allowed) / closed (re-issued
  count shown). Corrections are never silent: previous marks, revised
  marks, and the reason are recorded.
- Card versions: every card is versioned; the history view shows each
  version with its issued date and what changed (version N vs N-1
  summary).

## Screens

1. `/exams/[examId]/results` — class picker; the league table; class
   stats; compute/publish/correction-window controls; per-student card
   version list. One screen — the publication controls live where the
   numbers they freeze are visible.

## New backend (view endpoints designed with the screen — plan rule)

- `ExamResultsService.classResults(scope, examId, classId)`: term
  results + the subject-result matrix + roster names + class stats, one
  read.
- `exam.publication.list(examId)`: the per-class publication records.
- `ExamMarksService.listStudentEntries(scope, examId, studentId)`:
  the student's component entries (with component + schedule labels) —
  the correction dialog's data.
- `exam.marks.studentEntries` read: `marks:read` + exam owner overlap.

## Validation

Correction requires: an open window for the class, a reason (min 3),
and the ledger row lands before the mark moves (hard rule 7 — service
order, tested in B6). The dialog says "the student's card will re-issue
when the window closes" before commit.

## Accessibility

Rank/order is text not just position; pass/fail not color alone; the
publish consequence is read by screen readers (dialog description);
per-subject stats have table headers.

## Responsive

The league table collapses to per-student cards (rank + total + grade
prominent); stats collapse to a two-column list.

## Explicitly out (deferred)

Server-side PDF; CSV export; per-school custom card layouts (the
snapshot is the data; layout/print is S5's client-side print pass).
