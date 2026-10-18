# 01 — Journey 1: class teacher marks attendance between periods

Status: draft for owner review (2026-10-17, grounded at commit `6e1984b`).
Related ledger row: `/attendance/calendar`, `/attendance/policy`,
`/attendance/mark`, `/attendance/reports` (mobile phase 3 —
"Fast section/day selection, roster marking, correction reason, readable
summaries").

---

## 1. Persona, permission, context

**Actor:** class teacher (`teacher@demo-trust.test`, role `class_teacher`,
scope **class**). The subject teacher (`attendance:create` + `read`, **no**
`update`) is a secondary actor.

**Permissions used:** `attendance:create` (the mark gate), `attendance:read`
(preload + status), `enrollment:read` (roster), `section:read`,
`academic_year:read`. Corrections: `attendance:update` (class teacher ✓,
subject teacher ✗ — see Q4).

**Where/when:** standing at the classroom door or between periods; 30–60
seconds available; one hand holding the phone; spotty corridor Wi-Fi. This is
the highest-frequency staff task in the product.

## 2. Measurable outcome

> In under 60 seconds, standing at the door, the class teacher marks today's
> attendance for their section and sees server confirmation that the school's
> daily attendance status reflects it (`attendance.mark` → `{ marked: n }`,
> daily status recomputed in the same transaction).

## 3. Entry-to-done journey and wireflow

```
[Home]                                      [Attendance tab]
  │  primary tile "Mark attendance" (gated attendance:create)
  ▼
[Pick section & day]                         today pre-selected; day-type badge
  │  sections listed (my sections first — finding F2);   from the calendar
  │  already-marked badge via attendance.status
  ▼
[Mark roster]                                preloads existing marks when present
  │  default all present; tap row = toggle present↔absent;
  │  long-press = status sheet (late / on_leave / half_day);
  │  "mark all present"; live counts in header (present 34 · absent 4)
  ▼
[Review & submit]                            counts summary; past date →
  │  attendance.mark  → { marked: n }        correction-reason prompt (ADR-030)
  │  (upsert — resubmitting is safe)         day refused → holiday/weekend/None
  ▼
[Done]  "Today marked · Class 6-A · 38/38"
        failure branches: calendar refused · roster changed · offline · denied · expired
```

Key semantics from the real backend:

- **Re-marking is an upsert** on `(section, date, period)` — a second submit
  updates, never duplicates. An uncertain timeout is resolved by simply
  resubmitting.
- **The calendar refuses** dates with no calendar row or holiday/weekend
  (`attendance.calendar.*` owns day types).
- **Roster membership is checked** per entry — a student who moved sections
  is refused; refresh the roster.
- **No "today only" server rule** — dates are free; past edits prompt for
  `correctionReason` (ADR-030: never wiped by an update without one).
- Reporting reads `daily_attendance_status` / `attendance_summary`, never
  `attendance_records` (hard rule 5) — the done state reflects the read path.

## 4. Screens, hierarchy, realistic sample content

| Screen | Content (seed reality) |
|---|---|
| S1 Home | Branch "Main Campus · 2025-26"; tile "Mark attendance" as the first action for `attendance:create` |
| S2 Section & day | "Class 6 — Section A" (only seeded section); today "Thu 17 Oct"; day-type from calendar; badge "Marked 09:12" when preloaded |
| S3 Roster | 38 rows; "Aditi Sharma · DEMO-0001" first; status chips — present (emerald), absent (red), late (amber), on_leave (orange), half_day (sky)¹; header counts |
| S4 Review | "Present 34 · Absent 2 · Late 1 · On leave 1 · Half day 0"; past-date note when editing old dates |
| S5 Done | "Marked · 38 students · Class 6-A"; server-returned count; optional "View today's status" |

¹ Color language borrowed from the web console as reference only — the mobile
design system is its own work (AGENTS.md mobile rule 1). Status is never
color-only: each chip carries the label.

Attendance policy in seed: mode `daily`, derivation `homeroom_authoritative`,
late cutoff 15 minutes.

## 5. State / recovery table

| State | Design |
|---|---|
| Loading | Skeletons for section list and roster; no layout jump when data lands |
| Empty | No sections → "No section is assigned to you yet — ask the office to assign you" (ties to F2); empty roster → "No students on this section's roster" |
| Error | Inline retry on the affected query only; rest of the screen usable |
| Offline | **Online-only by ADR-043**: visible banner "You're offline — marking needs a connection"; submit disabled; all marks kept in memory; reconnect → explicit Retry (Q1) |
| Denied | No `attendance:create` → screen read-only (marking disabled with explanation); no `attendance:read` → tab not shown at all |
| Submitting | Controls locked, spinner in button, double-tap impossible |
| Success | `{ marked: n }` shown; re-mark shows "updated" phrasing, not "created" |
| Interruption / resume | Back navigation mid-mark keeps the draft; app backgrounded → draft kept, roster revalidated on return with a "roster changed" notice if it differs; app killed → in-memory draft lost (Q1) |
| Refusals | Holiday/weekend/no calendar row → server message surfaced verbatim-ish; roster mismatch → refresh prompt keeps unmarked entries; session expired → re-auth and resume within the same app session |

## 6. Procedure-to-screen mapping

| Screen | Procedures |
|---|---|
| S2 | `academic.year.current` / `academic.year.list`; `academic.section.list`; optional: `assignment.teacherAssignment.list` (requires `sectionId` — no "my sections" list exists, F2); `attendance.status` for the marked-badge; `attendance.calendar.list` for day types |
| S3 | `enrollment.list` (section roster) — preload existing marks from `attendance.status` |
| S4/S5 | `attendance.mark` (gate `attendance:create`); `attendance.status` to confirm the daily read path |

## 7. Platform, keyboard, accessibility

- No typing anywhere in the main flow — tap and long-press only.
- Primary submit action sits in thumb reach (bottom of screen).
- Android back mid-mark returns to the roster with state intact; leaving the
  journey with unsaved marks asks once ("Discard 4 marks?").
- TalkBack announces row state and a live count summary when counts change.
- Text scaling supported on rows and chips; tap targets ≥ 44 dp; status
  labels always visible (no color-only encoding).
- Optional haptic tick on status change — nothing depends on it.

## 8. Device targets

Portrait phones, primary widths 360–430 dp, one-handed use. No tablet layout
in the first slice (release-gate window checks come later).

## 9. Open questions for the owner

1. **Offline marking.** ADR-043 proposes online-only with retry, and
   `docs/MOBILE_PLAN.md` explicitly requires Step-0 validation of that against
   attendance. Is "visible failure + retry, drafts in memory only" acceptable
   for the attendance slice — or must a teacher be able to *start* marking
   without connectivity (requiring a local queue, conflict handling, duplicate
   prevention — a much larger design)?
2. **"My sections" shortcut.** Today a screen can only enumerate every section
   in the school (F2). Add a scoped "my sections" list procedure, or ship the
   picker with recent-first ordering derived from previous use?
3. **Marking interaction:** proposed toggle present↔absent + long-press status
   sheet + "mark all present". Alternative: web parity (tap cycles all five
   statuses) or inline segmented chips per row. Which reads best to you?
4. **Subject-teacher corrections.** Defaults give `subject_teacher` no
   `attendance:update`. Intended (their screen simply hides past-date editing),
   or should the defaults grant it?
5. **Period-wise schools.** First attendance slice serves the seed reality
   (`daily` policy; no period picker), with `periodId` support later — agree?
