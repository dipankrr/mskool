# Screen Spec — S5: Portal Cards, Print, Attendance Reports

Per `.agents/skills/frontend-product-ux-skill/` — workflow-first; spec
precedes code for slice S5. The family-facing surface is where the product
is deliberately NOT a cliche ERP (owner's product principle): the card is
narrative and readable, not a database dump; hard rule 8 makes
`published_report_cards` the ONLY door.

## Users / roles

- **Parent/Student login** (portal): sees the family's CURRENT published
  cards (`studentProcedure` ownership; no can()). Reads only — every
  number on the page is a frozen photograph.
- **Staff with report_card:read**: prints the class set (current cards,
  one per student) from the results screen.
- **Staff with attendance:read**: reads the attendance report (the
  Phase 3 rider — the summaries table already exists; this is its screen).

## Top workflows

```text
Family: sign in → Results → pick a child's card → read the narrative card
        → Print (browser print, styles hide the chrome)
Staff:  exam results → Print class set → print view (one card per student)
Staff:  Attendance → Reports → pick year/section → student × period %
```

## The narrative card (product principle)

Rendered from `reportCardSnapshotV1`, grouped by the school's OWN widget
sequence (`widgetName`/`widgetSequence` — ADR-032's subject types):
scoring subjects show mark/max with the class-meaningful stats, graded
areas show letter grades, term-grade areas render as remarks. Totals,
rank (when computed), and attendance close the card. The tone is a
report about a child, not a row of columns: name, class, term, then the
widgets, then the summary line ("Passed — 3rd in class of 42").

## Print

Client-side (owner's decision): a dedicated print layout with
`window.print()`; screen chrome (nav, buttons) hidden via print styles.
Class set = the same card component repeated, page-break between
students.

## States

- Portal empty: "No results published yet" (published-only is the rule,
  said out loud — unpublished marks NEVER cross the door).
- Class set empty: the publish hasn't happened for this class; say so.
- Attendance report: sections with no summary rows show an empty state,
  not zeros.

## New backend (with the screen — plan rule)

- `exam.cards.classSet` read (`report_card:read`, exam-owner overlap):
  every student's CURRENT card for the exam's term — the class set's
  data.

## Accessibility

Card is semantic headings + tables with captions; print keeps contrast;
empty states are text.

## Explicitly out (deferred)

Portal IA as a separate route group/nav (this phase renders the pages at
/portal/results; the shell integration and child-switcher land with the
portal's own slice); server-side PDF; custom per-school card layouts.
