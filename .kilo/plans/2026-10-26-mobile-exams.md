# Mobile Exams + Results — staff (Step 7)

Status: **7A built and walked 2026-10-26; 7B (verify, reopen, readiness) approved (D6–D11), built and walked 2026-10-27. Both are COMMITTED on the branch 2026-10-27 — `2380fab`, `f335a0e`, `ace7f75` (the owner's three, which absorbed the lib/copy/hub groups), then `7820672` (entry rows, student sheet, verify hooks), `e678b4b` (paper screen + route), `968f778` (Home/More entry points) + the docs commit — see the notes at the two "Commits (hand-off)" sections for how the original grouping landed.** 7C (results, publish, correct): designed the same day under the owner's pre-review waiver and BUILT, gate-green, **not yet device-walked** — see the addendum below. 7D (lifecycle, blueprint) BUILT, not yet walked. 7E (term grades) and 7F (grading setup) BUILT and ANDROID-DEVICE-WALKED 2026-10-28; iOS not walked — see their addenda and build records.
Branch: `feat/mobile-exams-7a`, cut from `main` @ `dbc0a7a`. Committed, NOT pushed, NOT merged.
Backend is frozen for this step, as for homework and fees; gaps are recorded at the bottom.
Source of truth for the endpoint list: `exam.router.ts` (46 staff + 2 portal). The portal
pair (`portalExam.results.*`) belongs to Step 9 and is not touched here.

## Actor, task, context

Three different people use this domain, with different jobs, devices habits and stakes.
The app must not make all three walk through one "exam admin" screen.

| Actor | Permissions | Job on a phone | Frequency |
|---|---|---|---|
| **Subject / class teacher** | `exam:read`, `marks:read/create/update` | Enter one paper's marks for a section; fix a typo; see what is still blank | Burst: 30–60 students at a time, a few times per exam |
| **Verifier (HOD, VP, principal)** | `marks:verify` | Check what was entered, verify it, send a wrong one back | A few times per exam |
| **Principal / VP / admin** | `exam:update/publish`, `marks:publish`, `report_card:read` | Move the exam through its stages, check readiness, compute, publish, correct after publishing | Rare, high stakes |
| **Admin (setup)** | `exam:create/update` | Create exams, papers, components; grading scales, subject types, pass criteria | Per term / per year |

**Context.** Teacher: staff room or corridor, answer scripts in one hand and the phone in the
other, patchy network, interrupted every few minutes. Principal: at a desk or in a meeting,
wants a yes/no on "can I publish". Both need the server's refusals in plain words, never a
silent no-op (BUG-9 is the cautionary tale: a grid that accepts typing but saves nothing).

**Design read.** *Reading this as: a school-operations tool for teachers and the principal,
used in short interrupted bursts, with the app's existing calm emerald-on-canvas utility
interface (Clash Grotesk, light only), targeting Android now and iOS later.*
Dials: variance 4, motion 3, density 6 (the entry list is the densest screen in the app; the
rest stay at the homework/fees level). Money-adjacent stakes (published marks reach families)
lower variance and motion on the publish path.

## What the data looks like (so the screens are honest)

- **Exam lifecycle** — `draft → scheduled → ongoing → marks_entry → under_verification →
  published → locked`. Back-moves exist only `scheduled→draft` and `under_verification→
  marks_entry`. Marks can be typed **only** in `marks_entry` and `under_verification`
  (`saveComponentResult` throws otherwise).
- **Paper** = `exam_subject_schedules` row: class + subject + optional section (null = whole
  class sits it, entered section by section) + date/time/venue + pass marks + `isLocked`.
- **Component** = a part of a paper (Theory 80, Practical 20, or the implicit *Overall* for
  graded-only papers). Each has max, pass, weightage, mandatory-pass flag.
- **Entry cell** = `(student, component)`; status `draft → entered → verified → published →
  locked`. Absent and exempt are flags (exempt needs a type). Save carries
  `expectedUpdatedAt`; a stale one is refused with "changed while you were typing".
- **Edit rules the server enforces:** verified rows can't be autosaved (`under_verification`
  says "open a revision window"); published/locked rows say "corrections go through the
  revision ledger"; negative marks need the exam's opt-in; the (section, subject) pair is
  gated — `subject_teacher` must be assigned, every other role is decided by scope
  (ADR-029a). `marks.entry` returns `canEnter` + `canEnterReason` so the screen knows first.
- **Results chain** — compute (per class) → class results table → publish (per class or the
  whole exam) → revision window → apply revision (ledger first) → close window (re-issues only
  changed cards). `readiness` gives expected/entered/verified counts, stale-compute flag and
  the below-attendance-bar list.
- **Unpublished marks never reach families** (hard rule 8) and published rows are never
  updated in place (hard rule 7). The mobile app only calls the existing procedures, so both
  hold; the UI's job is to make the consequence legible before the irreversible step.

## Information architecture

Exams is **not a 7th bottom tab** (the bar already carries Home · Attendance · Students ·
Homework · Fees · More at the top of its range, and most staff see five of them). It is a
pushed destination reached from three places:

1. **Home card** — "Marks to enter" for anyone with `marks:create`: lists open papers
   (exam in `marks_entry`) from their teaching pairs, one tap into the paper. This is the
   high-frequency path, one tap from the home screen.
2. **More → Teaching → Exams** (`exam:read`).
3. **Deep link** `/exams/...` (notifications later).

```
/exams                                   Exams list (this branch's running session)
/exams/[examId]                          Exam hub: stage track, classes → papers, next action
/exams/[examId]/paper/[scheduleId]       MARKS ENTRY (7A) — also the verify surface (7B)
/exams/[examId]/class/[classId]          Class results + readiness + publish (7C)
/exams/[examId]/class/[classId]/student/[studentId]   Result detail / correction / card versions (7C)
/exams/new, /exams/[examId]/edit         Create / edit exam (7D)
/exams/[examId]/papers                   Papers + components editor (7D)
/exams/[examId]/eligibility              Attendance-bar list + overrides (7D)
/exams/term-grades                       Term-grade entry (7E)
/exams/setup                             Grading hub (7F)
/exams/setup/subject-types | grading-scales | pass-criteria   (7F)
```

All screens sit outside the tab group (a pushed route covers the floating bar, so sticky
footers have no overlap), list is the root. Route files stay thin; bodies live in
`apps/mobile/src/screens/exams/`.

## Chunks

Each chunk is its own branch-able slice with its own commits, device walk and gate run;
7A is the only one designed to wireframe depth here. Later chunks get a short design
addendum appended to this file and reviewed **before** their UI starts (AGENTS.md mobile
rule 2) — they reopen design review only if they depart from patterns 7A establishes.

| Chunk | Job | Procedures (staff) | Count |
|---|---|---|---|
| **7A — Find the paper, enter marks** | Teacher | `exam.list/byId/transition`, `eligibility.list`, `marks.entry/save` | 6 |
| **7B — Verify** | Verifier | `marks.verify/unverify` (+ re-uses `marks.entry`) | 2 |
| **7C — Results, publish, correct** | Principal | `eligibility.readiness`, `results.table/compute/computeTermRanks/computeFinal`, `publication.list/publishClass/publishExam/openRevisionWindow/closeRevisionWindow/applyRevision`, `marks.studentEntries`, `cards.versions/classSet` | 14 |
| **7D — Exam lifecycle + blueprint** | Admin | `exam.create/update`, `schedules.list/save`, `components.list/save`, `eligibility.recompute/override` | 8 |
| **7E — Term grades** | Teacher | `termGrades.list/save` | 2 |
| **7F — Grading setup** | Admin | `subjectTypes.*` (6), `gradingScales.*` (5), `passCriteria.*` (3) | 14 |

Total 6+2+14+8+2+14 = **46**, the router's staff count. The MOBILE_PLAN §12 ledger rows tick
per chunk.

Order rationale: 7A is the teacher's whole job and the plan's acceptance path; 7B reuses 7A's
screen; 7C is the principal's decision surface and needs 7A/7B data to be meaningful; 7D/7F
are configuration that the web handles acceptably today and that mobile only needs for parity;
7E is a variant of 7A's grid. Because exams are created on the web today, the walk fixture
for 7A–7C is built once (see Verification) rather than waiting for 7D.

---

# Chunk 7A — Find the paper, enter marks

## Journeys

### A1. Teacher, between periods (the main one)
Home → **Marks to enter** card (or More → Exams) → exam hub → *Class 7 · Mathematics* →
paper opens on the first blank row, keyboard up → type `17`, **Next** → type `18`, **Next** →
… → last blank → "All 32 entered" bar → back. Target: a 32-student single-component paper in
under 3 minutes of typing with no taps other than the keyboard's Next.

### A2. Class-wide paper (section must be named)
Paper opens read-only with "Choose your section to start" and a section chip. The pick
authorizes the save (ADR-029 fact) but never filters the roster (BUG-9). After picking,
the grid unlocks. The pick is remembered per paper for the session.

### A3. Multi-component paper
Paper shows component pills `Theory /80 · Practical /20`. One component is on screen at a
time; each row still has exactly one input, so the single-component rhythm is unchanged. A row's
secondary line shows the other component's state ("Practical: 18").

### A4. Absent, exempt, grade-only
- Absent: **AB** toggle on the row (one tap); the row tints and the input is replaced by "Absent".
- Exempt: tap the student's name → **student sheet** → Exempted switch + required type
  (medical / disability / board approved / other).
- Grade-only paper (`isGradedOnly`): the input is a short text (≤10 chars, auto upper-case).

### A5. Principal moves the exam forward
Exam hub footer shows **one** primary action for the stage ("Start marks entry",
"Send for verification"…), `exam:update`-gated, behind a confirm that states the consequence
(copy comes from the web's `copy.exams.workflow.transitionConsequences`, kept the same).
Back-moves live in the hub's overflow. `locked` is destructive-styled and never offered
without the consequence text.

### A6. Refusals the user must understand
Exam not open for entry, caller not assigned, verified row, published row, stale cell, negative
marks, offline. Every one is worded; none is a generic toast.

## Wireflow

```
Home ─ Marks to enter card ───────────────┐
More ─ Exams ─► Exams list ─► Exam hub ───┼─► Paper (marks entry) ─► Student sheet
                                          │        │  └─► Section sheet (class-wide papers)
                                          │        └─► Unsaved-rows guard on leave
                                          └─► Transition confirm (principal)
```

### Screen 1 — Exams list `/exams`
```
‹                                     [session chip 2026-27]
Exams
[ Open for marks · 2 ][ Upcoming · 3 ][ Published · 4 ][ All ]
┌────────────────────────────────────────────┐
│ ▍Unit Test 1                    MARKS ENTRY│
│  Term 1 · Unit test                         │
│  3 classes scheduled · 0 published          │
└────────────────────────────────────────────┘
```
- One reads: `exam.list({ academicYearId })`; segments and search are client-side (a year's exams
  are tens, not thousands). Default segment: **Open for marks** if any exist, else **All**.
- Card: name, term, type, stage pill, classes scheduled / published. No fake progress bars —
  per-paper progress needs one `marks.entry` call per paper and belongs on the hub.
- States: loading skeleton shaped like cards; empty ("No exams in this session yet" + hint that
  exams are created by the school office, and a *New exam* button only when 7D lands and
  `exam:create` is held); filtered-empty; error + Retry; offline = cached list + banner.

### Screen 2 — Exam hub `/exams/[examId]`
```
‹ Exams                                          [⋮]
Unit Test 1
Term 1 · Unit test · 20% of term
Draft ─ Scheduled ─ Ongoing ─ ●Marks entry ─ Verification ─ Published ─ Locked   (scrolls)

 [ 6 ] [ 7 ] [ 8 ]    ← class chips (classes with papers)
 Papers · Class 7
 ┌ Mathematics         Mon 6 Apr · 10:00 · 60 min ┐
 │ 7-A, 7-B ▸ my section: 7-A         Enter marks ›│
 └─────────────────────────────────────────────────┘
 ┌ Science             Tue 7 Apr                   ┐
 │ Not yours                           View ›      │
 └─────────────────────────────────────────────────┘
─────────────────────────────────────────────────────
 [        Send for verification        ]   ← stage's one next action
```
- Reads: `exam.byId` (exam + schedules + components), `eligibility.list` (badges), plus the
  school-scoped class and subject lists to name papers (**every query carries `schoolId`**).
- **My papers first.** Papers whose (class, subject) is in the caller's teaching pairs
  (`useTeachingPairs` pattern) pin to the top with an "Enter marks" action; everything else
  stays visible and read-only ("Not yours" for subject teachers; scope-holders see all as
  editable). Filtering is a hint — the paper screen re-checks via `canEnter`.
- The stage track is a compact scrollable stepper (the web owner called the track "the good
  part"); the current stage is filled, past stages tick.
- Footer action is stage-driven and permission-gated; the server is still the referee, a
  refusal arrives in its own words.
- States: stage-specific empty ("No papers yet — the office hasn't scheduled this exam");
  entry not open banner on `draft/scheduled/ongoing`; `published/locked` shows results link
  (7C) instead of Enter marks.

### Screen 3 — Marks entry `/exams/[examId]/paper/[scheduleId]`  **(the heart)**
```
‹ Class 7 · Mathematics                                   [⋮]
Unit Test 1 · out of 20 · pass 7
Section 7-A ▾                      ← only for class-wide papers
 Entered 18 of 32 ━━━━━━━━━░░░░░░          ← the only progress indicator
[All 32][Missing 14][Absent 1][Below pass 2]      [Theory/80 ▏Practical/20]  (multi only)
─────────────────────────────────────────────────────────────────
 01  Aarav Mehta                                   [ 17 ]  ✓
 02  Bhavya Rao      🔸Below attendance bar        [ AB ]  ✓   ← row tinted
 03  Chirag Das                                    [  ▏ ]      ← focused, keyboard up
 04  Divya Nair                                    [    ]
 …
─────────────────────────────────────────────────────────────────
 All changes saved                         [ Verify 18 ]  (marks:verify, 7B)
```
Row anatomy: roll · name (2 lines max, text-scale safe) · optional advisory pill ·
numeric field (≥48 dp tall, right-aligned, shows `/20` as the placeholder) · AB chip · state glyph.
The list is a FlatList (windowed), rows memoized; the focused row is scrolled above the
keyboard. State glyphs: none (blank) · spinner (saving) · ✓ (server-confirmed) · ⚠ "Not saved ·
Retry" · 🔒 verified. A tick only ever appears after the mutation resolves (mobile rule 4).

**Interaction contract**
1. **Commit, not keystroke.** A cell saves on Next/Done/blur if its value changed, never per
   character. Pasting/typing garbage is blocked by `decimal-pad` + a sanitizer (digits, one
   dot, ≤2 decimals).
2. **Validate before the wire.** `> max` → red "Out of 20", no request. Negative allowed only if
   `allowsNegativeMarking`. Below component pass → amber advisory (never blocking).
3. **Per-cell serial queue.** One in-flight save per cell; later edits to the same cell wait and
   carry the latest `updatedAt` from the previous response as `expectedUpdatedAt`, so the app
   never conflicts with itself. Different cells save in parallel (small cap).
4. **Never lose typed work.** A failed save keeps the typed value, marks the row "Not saved ·
   Retry", and raises a sticky bar "3 rows not saved · Retry all". Leaving the screen with
   unsaved rows triggers the existing unsaved-changes guard (Keep editing / Discard).
5. **Conflict.** "Changed while you were typing" → row shows the server value, the typed value
   is offered as "Reapply 17" (one tap), never auto-overwritten.
6. **Keyboard rhythm.** Android: `decimal-pad` + `returnKeyType="next"` advances. iOS decimal
   pads have no return key → an `InputAccessoryView` with Prev / Next / Done (designed now,
   verified at the iOS gate; iOS is parked). Next skips locked (verified) rows.
7. **Jump to blank.** The Missing chip and a "Go to first blank" menu item; on open, the list
   scrolls to the first blank row when any exist.
8. **Absent** clears the number, saves `isAbsent: true`, and is reversible by tapping the chip
   again (saves the cleared draft).

**Read-only variants** (same layout, inputs replaced by plain values, an explanatory notice
above the list): exam not in entry stages; `canEnter === false` with the honest reason
("You're not the assigned teacher for this paper" / "Your role can't enter marks"); paper
`isLocked`; class-wide paper with no section chosen yet; all rows verified.

**Student sheet** (tap the name): full-width bottom sheet via `FormSheet` — every component's
value, Absent switch, Exempted switch → type pills (required), Save, and `‹ 02 of 32 ›` to move
between students without closing. Exemption lives here because it is rare and needs a reason.

**Overflow ⋮**: Go to first blank · Filter reset · (7B) Verify all entered · Paper details
(date, venue, duration, components table).

### Screen states (every surface)
Initial loading (skeleton rows with the real row height) · empty roster ("No students are
enrolled in this paper's class yet") · error + Retry (cached rows preserved) · offline (inputs
stay usable; saves fail into "Not saved · Retry" — online-first per ADR-043, no offline queue
in v1) · permission denial (honest screens, never a generic 403) · no branch / no running
session · submitting (per-row, never a global spinner) · success (server-confirmed only) ·
app resume (refetch `marks.entry` but **merge** — rows with unsaved edits keep the typed value)
· unsaved-work guard · text scaling to 1.3× without clipping the row's primary field · screen
reader: each row reads "Roll 3, Chirag Das, marks out of 20, empty".

## Data and hooks

- `useExamList(academicYearId)`, `useExamHub(examId)` (byId + class/subject names + eligibility +
  teaching pairs), `usePaperGrid(examId, scheduleId, sectionId?)` (marks.entry), `useSaveCell`.
- Pure, unit-tested modules in `lib/exams.ts`: stage map + next-action copy, marks parsing /
  sanitizing / range check, row-state reducer, per-cell queue, filter predicates (missing /
  absent / below pass), progress counts, roll-order sort, "my papers" matching.
- Timestamps arrive as ISO strings at runtime although contracts type `Date` — all helpers accept
  `string | Date` (homework lesson). `updatedAt` is round-tripped **verbatim** as
  `expectedUpdatedAt` (re-formatting loses milliseconds and manufactures false conflicts).
- Cache: grid query `staleTime` 0 on entry (a stale grid is how conflicts start); list/hub 60 s.
  Saves patch the grid cache from the response (`id`, `resultStatus`, `updatedAt`, flags) — no
  refetch per cell. `gcTime: 0` on the grid so reopening always shows server truth.
- Every class/section/subject/enrollment read carries `schoolId` (retest rule from Step 2).

## Backend endpoints used (7A)

`exam.list` · `exam.byId` · `exam.transition` · `eligibility.list` · `marks.entry` ·
`marks.save`; supporting reads already used elsewhere: `academic.class.list`,
`academic.section.list`, `subject.list`, `assignment.teacherAssignment.list`, `me.get`.

## Acceptance (7A)

- A subject teacher assigned to Class 7 · Mathematics opens the paper from Home, enters all
  marks with the keyboard's Next only, sees each row confirm, and leaves with zero unsaved rows.
- The same teacher opening Class 8 · Science sees the honest not-assigned read-only state.
- A principal moves a `scheduled` exam to `ongoing` → `marks_entry` through confirms and sees
  the hub change shape; an illegal move surfaces the server's wording.
- Over-max, negative (when disallowed), verified-row, stale-cell and offline cases all end in a
  specific message with the typed value preserved.
- Multi-component and class-wide papers work; absent and exempt round-trip.
- Backgrounding mid-entry and returning loses nothing; rows with unsaved edits survive a refetch.
- 44/48 dp targets; 1.3× text scale; screen-reader labels; no success shown before the server
  confirms; no mutation double-fires.

## Verification (7A)

- `pnpm check-types` · `pnpm --filter @repo/mobile lint` · mobile jest (new: `lib/exams.test.ts`
  — marks sanitizer/range, queue ordering and `expectedUpdatedAt` chaining, reducer, filters,
  next-action map, my-papers matching).
- **Walk fixture** (none exists — the seed has no exams): a one-off script
  `apps/api/scripts/tmp-seed-exam-walk.ts` (deleted after the walk, per the fees precedent)
  creating a Term-1 exam with a single-component paper (Class 6 · Mathematics), a
  multi-component paper (Theory/Practical), a class-wide paper, a graded-only paper, and the
  exam in `marks_entry`. Reuse the demo staff logins (class teacher, subject teacher, principal).
- Device walk on emulator-5554 at 1.0× and 1.3×: full A1 run; section pick; component switch;
  absent/exempt; over-max; block the API mid-entry (Not saved → Retry all → recovers); verified-row
  refusal (verify via web or SQL); not-assigned teacher; principal transition with an illegal move;
  background/resume. iOS stays parked; the accessory-bar design is verified at the iOS gate.

---

# Later chunks — design intent (full addendum appended before each build)

## 7B — Verify
**Superseded by the full design addendum "Chunk 7B — Verify (design addendum, 2026-10-27)" at the bottom of
this file** (awaiting owner review). Summary: a Review segment on the paper screen with read-first rows, a counted
verify confirm, reopen from the student sheet and an undo banner, and reviewer counts on the hub.

## 7C — Results, publish, correct
Principal's surface; one decision per screen.
- **Class results** is a ranked **list, not a table** (the plan forbids squeezing wide matrices):
  rank · name · total · % · grade · result pill; tap → result detail with the subject breakdown
  and (when permitted) "Correct a mark". Filters: Failed · Needs attention · Absent.
- **Readiness card on top**, from `eligibility.readiness`: entered/expected, verified,
  "results are out of date — recompute", below-bar students (overridable, 7D). The **Publish**
  button is enabled by the server, but the confirm sheet restates the counts (as the web does)
  and says families will see the card.
- Compute (class), term ranks, final results are explicit buttons with progress and result counts
  from the server; **publish all** reports `publishedClasses` and `failedClassIds` honestly,
  naming classes that failed.
- **Revision window**: open (confirm) → correct marks (entry picker from `studentEntries`,
  revised value + required reason ≥3 chars) → close (confirm; shows `reIssued` count).
- **Card review**: `cards.classSet` + `cards.versions` rendered as native screens (subject rows,
  version diff like the web's `versionDiff`). PDF/share/print: needs a client render (no server
  PDF); decision D4 below.
- Never optimistic. Every irreversible button uses the stateful submit pattern and the server's
  refusal copy.

## 7D — Exam lifecycle + blueprint
Create/edit exam as a native form (term, type, weight, supplementary/improvement link rule);
"Add classes" generates papers from each class's mapped subjects (as the web does); per-paper
date/time/venue and a components editor (name, max, pass, weight, mandatory pass; weights must
total 100) as bottom sheets; eligibility recompute and the override sheet (reason ≥3 chars).
Blueprint edits only in `draft/scheduled` (the server freezes later; the UI says why).

## 7E — Term grades
Reuses the entry list: students × one graded subject per term, grade or marks per the mapping's
type, same queue/guard/state glyphs, `termGrades.list/save` with the same `subjectGate`.

Design addendum (2026-10-28, before code; the owner asked for the chunk directly).

**Job.** At term end a teacher gives an area grade — Art, Music, PE, Value Education, the
term_grade subjects that never sit a paper — to every student of a section. The web screen is a
web table; mobile keeps the 7A rhythm: subject chosen once, one grade field per row, the
keyboard's Next key moves down, a tick appears only when the server has the value.

**Entry.** `/exams/term-grades` (route exists in §Route map). Two doors:
1. **Exams list** — a "Term grades" shortcut row beside "Final results"/"New exam", shown for
   `exam:read` (read-only callers enter with inputs disabled, like the web). The shortcut card now
   renders in the EMPTY state too (a school with term-grade areas but no exams still has grades to
   enter); the old early return hid every shortcut then.
2. No hub row. Term grades are term-wide, not exam-wide; the hub stays about one exam.

**Screen.**
- Anchor order: term → class → section → subject. Each is a `ChipRow`; a row hides when there is
  one choice (`Full Year`, one section). Term defaults to the `termId` route param (none passed
  today), else the single term, else the term containing today, else nothing — the screen asks.
- Class defaults to the first visible class (hub pattern). **Section does not**: with more than one
  section nothing is preselected and the list shows "Choose the section" — a grade written to the
  wrong section is silent data corruption, and the context line already proves the save target.
- Subject defaults to the first term_grade mapping of the class (the chip is highlighted and the
  header names it). The mapping's `subjectTypeId` must resolve to a type with
  `assessmentMode = "term_grade"`; every other mapping is excluded exactly as the web does.
- Header: chosen-context line (`Term 1 · Class 6 · A · Art`), read-only notices
  (`!marks:create`; a subject_teacher whose pairs don't include section+subject), a progress card
  (`Graded N of M` + meter) and a filter row `All / Missing / Graded`.
- Rows: roll · name (+ remarks hint) · grade field (10 chars, upper-cased) · state glyph.
  Tap the name for the sheet: grade + remarks (≤500), Save commits both; the row stays one field.
- Commit on Next (`submitBehavior="submit"`, keyboard stays up) and on blur. A cleared field never
  deletes a saved grade — the row says so instead of pretending; the server has no delete.
- Footer: `All changes saved` / `Saving…` / `Unsaved changes` / `N rows aren't saved · Retry all`.
  Leave guard on any unsaved cell, and the context chips ask the same live store before they remount
  the entry (term/class/section/subject switches must not throw typed work away). Pull-to-refresh
  re-reads the term's rows; the draft keeps typed work and flags a server value that moved
  (`Changed on the server`).
- States: permission denial, loading skeletons, roster/subject/term/class empty states, read-only,
  not-assigned, error + retry (both reads), offline (failed row + retry), submitting, saved.

**Data.** `academic.term.list`, `academic.class.list`, `academic.section.list`,
`assignment.subjectMapping.list` + `exam.subjectTypes.list` (area filter), `enrollment.list`
(section roster, roll order), `exam.termGrades.list` (term rows joined to students client-side),
`exam.termGrades.save` per student. No backend change.

**Gaps recorded, not fixed here.**
33. `termGrades.save` has no `expectedUpdatedAt`/version — two writers are last-write-wins; the
    draft detects a moved server value on refetch but cannot prevent the overwrite. Marks has the
    token; term grades should adopt it if concurrency matters.
34. `termGrades.save` never checks publication — term grades stay editable after a report card is
    frozen (the card itself is immutable). The web has the same hole. Decide whether entry freezes
    at publication.
35. `termGrades.list` returns the whole school's rows for the term; the screen filters to the
    active mapping client-side. A `mappingId`/`sectionId` filter would shrink the payload.
36. No `subjectName` on the mapping row; names come from `subject.list` (and the type filter from
    `subjectTypes.list`), two extra reads the web also pays.
37. `term_assessments.descriptor` (≤100 chars) has no editor in either client, so every save sends
    no descriptor and the service writes `descriptor: null` — a value written by another tool
    would be erased. Decide whether the column is dropped or the sheet should edit it.
38. `termGrades.save` returns `null` (not a typed refusal) when the student is no longer enrolled in
    the term, the section is not the mapping's class, or the mapping is not in the branch. The app
    can only say "Not saved · Tap to retry", which is wrong for a student who moved section; a
    refusal code would let the row say why.

**Walk record (2026-10-28, emulator-5554, 1080×2400 / 393 dp, admin `admin@demo-trust.test`,
session 2026-27).** Walked the real dev client against the running API/Neon DB.

*Walked and correct.* Exams list → "Term grades" shortcut; the same shortcut renders in the EMPTY
state (checked on North Campus, which has no exams in the session) with the segments bar hidden.
Term/class default as designed; with two sections **none is preselected** and "Choose the section"
holds the list. Roster in roll order (12 students), `Graded N of M`, `All/Missing/Graded` counts,
"Go to first blank" offered on All/Missing and hidden on Graded. Typing upper-cases (`a+` → `A+`);
the IME's next arrow saves, moves focus down and **keeps the keyboard up**; tapping away
(blur) saves too. Remark sheet: empty grade refused with "Type a grade before saving.", grade +
remark save, row then reads "Remarks added". Failed save: API stopped mid-entry → row goes
"Not saved · Tap to retry" with the caution border and refresh glyph, footer "1 row isn't saved ·
Retry all"; the alert offers Keep editing / Use saved value / Try again, and Try again after the
API returned wrote the row. Context chips with typed work raised "Some grades aren't saved" and
Keep editing preserved the typed value; switching with nothing unsaved remounted onto Section B's
own 3-student roster with 0 graded (no cross-section leakage). Class 7 (no sections) and North
Campus (no term-grade subject) both showed their honest empty states.

*Findings — all three fixed in this chunk, then re-walked.*
1. Section chips printed bare `A` / `B` under rows that print `Term 1`, `Class 6` — a letter with
   no noun, on the one row that decides where a write lands. Now `Section A` / `Section B`
   (`copy.exams.termGrades.sectionChip`).
2. The row's second line was painted `critical` for every tone, so a harmless "Remarks added" read
   as an error. `lineFor` now returns text + tone (failed → caution, problem → critical,
   changed-elsewhere → caution, remarks → muted) and the row paints what it means.
3. Closing the remark sheet left the keyboard up over the roster with nothing to type into (the
   sheet's input owned it). Opening and closing the sheet now dismisses it, verified with
   `dumpsys input_method` showing `mInputShown=false` after both Close and Save.

*Not walked.* iOS entirely — the accessory bar (prev/next/done above the keyboard) is
`InputAccessoryView`, Android-only verification cannot cover it. The two-writer conflict (the
server has no `expectedUpdatedAt`, gap 33). A 100+ roster. Read-only and not-assigned notices
(the walk used an org admin, `pairs === null`); both are one branch each and were verified by
typecheck only. The footer row ("N rows aren't saved · Retry all") sits under the keyboard while a
field is focused — the row's own retry glyph is reachable, the bulk retry needs the keyboard down.

*Walk fixture left in the dev DB:* Main Campus · Class 6 · Section A · Term 2 · Personality —
A+ · B · A (+ "Great team player") · C · D for the first five students by roll.

## 7F — Grading setup

### Actor, task, context

**Who:** the school's exam administrator (org admin, principal, exam coordinator) — the people who
own `exam:create` / `exam:update`. A class teacher never opens this screen; they feel its effects
in 7E (which subjects appear in Term grades) and in 7A/7D (which subjects generate papers).

**When:** setup week before a session, and the rare mid-year policy fork — a new scale because the
old one locked, a class override because Class 10 is judged differently, a subject type that was
created as "Exam" when it should have been "Term grade". This is a **configuration** surface: low
frequency, high consequence, no undo. It must read like a policy document, not a CRUD table.

**The one sentence the hub answers:** *"Where do I change how this school grades?"*

### Information architecture

```
Exams list  ──► "Grading setup" row (exam:update or exam:create)
                        │
                        ▼
              Grading setup hub (/exams/setup)
              ├── Subject types      /exams/setup/subject-types       list + sheet
              ├── Grading scales     /exams/setup/grading-scales      list
              │     ├── new          …/grading-scales/new             pushed editor
              │     └── one scale    …/grading-scales/[scaleId]       pushed editor
              └── Pass criteria      /exams/setup/pass-criteria       list (per session)
                    ├── new          …/pass-criteria/new               pushed editor
                    └── one rule     …/pass-criteria/[criteriaId]      pushed editor
```

**Entry point.** The Exams list gains one `LinkRow` after "New exam": *Grading setup — Subject
types, grading scales and pass rules*, icon `settings`. It is gated on `exam:update || exam:create`
(the same "this is an admin act" reasoning as "Final results"), so a teacher's list stays a
teacher's list. It renders in the empty state too. No row on the exam hub: these rules are
school-wide, not exam-wide, and putting them under one exam would imply otherwise.

**Why a hub of three destinations, not a segmented screen (the web's tabs).** Each list has its
own states, its own writes and its own shape (a sheet, a band editor, a policy form). A hub lets
one screen stay one thing, and mirrors the fee setup hub already in the app. The three rows carry
live counts so the hub itself answers "is anything missing?" before a tap.

**Why the editors are pushed screens, not sheets.** A subject type (5 fields) fits a sheet. A scale
is 1–10 band cards; pass criteria are 9 controls. Both need a real scroll body, a sticky save,
and an unsaved-work guard. Sheets are for two- or three-field edits; these are policy forms.

### What the data actually allows (so the UI does not promise more)

| Thing | Server truth | Consequence for the screen |
|---|---|---|
| `subjectTypes.list` | active only, ordered by `sequence`, then name; carries `hasAssessmentData` | a retired type disappears everywhere; there is no "show retired" list (gap 41) |
| Type flags | `countsTowardResult`, `isGradedOnly`, `assessmentMode` lock once **any** component result **or** term assessment exists for a mapping of that type | list chip "In use"; sheet keeps name + card order editable, disables the three behaviour controls, shows why |
| `gradingScales.list` | active only, with bands ordered by `sequenceNumber`; `isDefault`, `isLocked` | locked scales are readable but their bands are immutable; name/description still editable |
| Bands | contiguous 0–100, no gaps/overlaps; first must start at 0, last end at 100; `gradeLabel` ≤10 chars and unique per scale; service validates exact hundredths | client validates the same rules *before* the call and paints the gap/overlap on the row; server stays the referee |
| Scale create | scale + bands atomic; `isDefault` swap inside the same transaction | one call, one failure surface |
| Scale update | name/description/`isActive` only; locked scales refuse deactivation | editor sends only what changed; retire is hidden on a locked scale |
| `makeDefault` | allowed on a locked scale (steers future computes only) | shown on locked scales too |
| `passCriteria` | one school default (classId null) + one row per class, per year; no delete | create picks a scope that is still free; no retire action; a wrong rule is corrected, not removed |
| Criteria validation | grace on ⇒ both caps; compartment on ⇒ cap ≥ 1 | mirrored inline; disable-independent, the server is still the last word |

### Journeys

**A1 — Setup week (org admin, desktop-free).** Opens Exams → Grading setup. No scales exist, no
types. Hub says so in three quiet details. → Subject types → empty state offers *Use the CBSE
starter set*; confirm → three types appear, `Personality` reads *Term grades · Grade only · Not
counted*. → Back, Grading scales → *Add scale* → name "CBSE 10-point", the editor opens with one
band 0–100; type A1 91–100 → **Add band** prefills 0–90 → set A 81–90 → repeat down to E 0–32.
The coverage bar fills left to right, the status line goes from "Gap 0–80" to "Covers 0–100".
"Check a score" 87 → *A1 · 9 points*. Save → back on the list, the new scale wears **Default**
because it was the first. → Pass criteria → *Add rule* → scope *School default* only (no default
exists) → leave min subjects blank, grace off, compartment off, attendance 75 → save. Total: three
screens, no dead ends, every refusal explained.

**A2 — The scale locked itself (principal, mid-year).** Opens a scale with results against it. The
editor opens read-only for bands with a neutral notice: *results have been graded with this scale*.
Name and description still save; *Make school default* is offered; *Retire* is not. The way out is
stated: create a new scale. The new-scale editor is the same screen, so nothing new to learn.

**A3 — Class 10 is judged differently (admin).** Pass criteria already has the school default. Add
rule → scope sheet lists only classes **without** a rule; Class 10 is there, Class 6 is not (it
already overrides). Editor opens with the default's values as a starting point, not blanks, so the
override is a delta the admin can see. The "In short" card rewrites as grace/compartment flip.

**A4 — Refusals the user must understand.** A gap in the bands, a duplicate grade label, a locked
type's behaviour toggle, a default that cannot be retired, a locked scale that cannot be retired, a
class that already has a rule (never offered), a session-less pass-criteria screen, a server wording
that the client did not predict (shown verbatim, form stays open, nothing lost).

### Screen 1 — Grading setup hub (`/exams/setup`)

- **Header:** "Grading setup"; meta `session · branch`; back.
- Neutral intro notice: *How this school turns marks into grades and decides what passes. These
  rules are school-wide and rarely change.*
- One `Card` with three `LinkRow`s, each with a live detail:
  - **Subject types** — `3 types · 1 in use` / `None yet`. Detail `How each kind of subject is entered and counted`.
  - **Grading scales** — `2 scales · CBSE 10-point is default` / `No default scale yet`. Detail `Percentage bands that become grades`.
  - **Pass criteria** — `2026-27 · School default + 2 class rules` / `No rules for this session`. Detail `What passing a year means`.
- **States:** denied (`exam:read` absent) → lock empty state; no branch → school empty state;
  loading → three skeleton rows; any of the three reads failing → one `ErrorCard` with retry
  (the hub is a summary, a half-summary is a lie); no session → the first two rows still work,
  the criteria row reads *Needs a running session* and is not pressable.

### Screen 2 — Subject types (`/exams/setup/subject-types`)

**List.** Active types in card order. Row:
- Title: the name; trailing quiet chip **In use** when `hasAssessmentData`.
- Meta: one plain sentence built from the flags —
  - `term_grade` → *Term grades · Grade only · Not counted*
  - exam, counted, not graded-only → *Exam papers · Marks · Counted in the result*
  - exam, not counted, graded-only → *Exam papers · Grade only · Not counted* (the co-curricular case)
  - any other legal combination is stated just as plainly.
- Tap → the type sheet (edit). No trailing chevron noise; the row is a button.
- Header action **Add type** (`exam:create`).
- Below the list, when `exam:create`: a quiet secondary `CapsuleButton` **Use the CBSE starter set**
  with one line of help. Empty state offers the same two actions. Preset runs behind an `Alert`
  confirm that says exactly what it does and that existing types are left alone; its result is a
  positive `Notice` (`Added 2 subject types.` / `The starter set is already in place.`).
- **Empty:** *No subject types yet* — types group subjects on the report card and decide how they
  are graded; start from the CBSE set or add your own.
- **States:** denied, no branch, loading skeleton, error + retry, empty, pull-to-refresh.

**Sheet (create / edit).** Lives in `FormSheet`; five fields and a live summary.
- **In short** line at the top, rebuilt as the controls change: *"Personality — entered at term
  end, shown as a grade, not counted in totals."* This is the anti-wall-of-switches device.
- Name (`FormField`, required, ≤100).
- **Assessed by** `ChoicePills`: *Exam papers* / *Term grades*. Help explains both in school words.
- **Counts toward the result** `SwitchRow` + help.
- **Grade only** `SwitchRow` + help.
- **Card order** numeric field + help (*lower sits higher*).
- When term-grade + counts is chosen, a caution line: term grades carry no marks, so counting them
  has no effect — most schools leave it off. It does not block the save.
- Locked type: behaviour controls `disabled`, a neutral notice with the server's reason; name and
  card order stay editable; the save still works.
- Retire: a destructive text action in the sheet footer (edit only), behind an `Alert`. When the
  type is in use the body says the extra truth: grades already recorded stay, but the type leaves
  the pickers **and Term grades**, and there is no restore list on mobile (gap 41).
- **States:** submitting (footer loading, fields stay), server refusal in a critical `Notice`
  above the footer with the form intact, success closes the sheet and shows a positive notice on
  the list.

### Screen 3 — Grading scales (`/exams/setup/grading-scales`)

**List.** Row:
- Title: name; chips **Default** and **Locked — in use**.
- Meta: description when present, then the band sentence `A1 91–100 · A2 81–90 · …` on up to two
  lines (never a table).
- Tap → the editor. Header action **Add scale** (`exam:create`).
- **Empty:** *No grading scales yet* — add a scale so computed results can show grades.

**Editor (`new` / `[scaleId]`).**
- Title: *New grading scale* / the scale's name. Meta: `Default · Locked — in use` or `N bands`.
- Name, Description.
- New only: `SwitchRow` **School default**, pre-checked when the school has none, with the reason
  in the help.
- Locked only: neutral notice — results have been graded with this scale; bands can't change;
  create a new scale for a new policy. Bands render as a read-only list.
- **Bands section**
  - `SectionHead` "Bands" + status: *Covers 0–100* (positive) or *1 gap · 2 to fix* (critical).
  - **Coverage bar**: one horizontal strip of the 0–100 range, one segment per band (width by
    range), gaps painted critical. Decorative (`accessible={false}`); the sentence carries the
    meaning.
  - **Band card**, one per band, in display order:
    - header `Band 1` + remove (trash). Removing extends the band below (or above, for the bottom
      band) so a delete never invents a gap.
    - `Grade` (≤10, upper-cased) + `Points` (optional, 0–100) on one line.
    - `From %` + `To %` on the next line.
    - inline error under the card when this band is the problem.
  - **Add band** prefills the largest uncovered interval (0–100 when empty; 0–90 after 91–100;
    0–80 after 91–100 + 81–90). When the scale already covers 0–100 the action is replaced by a
    quiet line: *Every percentage already lands in a band.*
- **Check a score** (only when the bands are valid): a small numeric field, live result
  `87% → A1 · 9 points`. This is the proof the whole screen exists for.
- Secondary actions below the form: **Make school default** (non-default, behind an `Alert`) and
  **Retire this scale** (not default, not locked; destructive, behind an `Alert` that says past
  results keep grading as they did). A default scale shows no retire action and one line why.
- **Footer:** primary **Save scale**, plus the first validation problem as a one-line caption
  above it whenever the form is invalid — so the reason is visible from the bottom of a long
  scroll. Save is only enabled when something changed.
- **Save order:** bands first, then name/description (the likely refusal is a band rule; a failed
  name write must not leave new bands with an old name). Only dirty parts are sent. Success →
  invalidate the list and go back. Failure → critical notice with the server's wording, form
  intact.
- **Unsaved guard:** `useUnsavedChanges` on any local change (bands, name, description, default).

**Gap / overlap wording** (client, mirroring the service):
- *Bands must start at 0.*
- *Bands must end at 100.*
- *Gap: nothing covers 71–80.*
- *A2 and B1 overlap at 81.*
- *The band ends before it starts.*
- *Two bands can't share a grade.*
- *Enter a number from 0 to 100.*

### Screen 4 — Pass criteria (`/exams/setup/pass-criteria`)

**List**, per running session. Row:
- Title: *School default* or the class name; quiet chip **Default** on the school row.
- Meta line 1: `Pass 5 of 6 · Grace 5 / 10 · Compartment 2` / `All counted subjects · No grace ·
  No compartment`.
- Meta line 2: `Attendance 75% flags only · Absence can fail · Exempt papers score zero`.
- Header action **Add rule** (`exam:create`), hidden when every scope is taken.
- **Empty:** *No pass rules for this session* — add the school-wide default; classes can override
  it later.
- No session: honest empty state with the session's role explained.

**Editor (`new` / `[criteriaId]`).**
- Title: *New pass rule* / *Pass rule · Class 6*. Meta: session · *School default* / class name.
- Create only: **Applies to** row opening a `ChoiceSheet` — *School default* (hidden when one
  exists) plus every class **without** a rule. The choice is required before save.
  Edit: the scope is printed, not editable (moving a row would collide with the unique index).
- **In short** card at the top, four lines, rewritten live:
  1. pass rule (`All counted subjects` / `At least 5 of 6 counted subjects` / `… including Maths`)
  2. grace (`Grace up to 5 per subject, 10 in total`)
  3. compartment (`Up to 2 failed subjects`, `No compartment`)
  4. attendance (`Below 75% is flagged, never blocked`)
- **Promotion**: min subjects numeric (blank = all); **Must-pass subjects** row opening a
  multi-select `FormSheet` (name + check, Done; “None” when empty).
- **Grace marks**: switch; when on, per-subject and total fields.
- **Compartment**: switch; when on, the failed-subject cap.
- **Attendance**: percent field, help says advisory.
- **Absence & exemption**: two switches with the web's plain-language help.
- **Footer:** **Save rule**, caption with the first invalid field. Save is enabled only when
  changed. New rows start from the school default's values when one exists — an override is a
  delta, not a blank page.
- **Unsaved guard** on any change.

### Every surface's states

| State | Hub | Lists | Editors |
|---|---|---|---|
| Permission denied | lock + who to ask | lock + who to ask | not reachable (row hidden) |
| No branch | school empty | school empty | not reachable |
| No session | criteria row says so; others work | criteria empty state | criteria editor not reachable |
| Loading | 3 skeletons | 3 row skeletons | centred spinner? No — screen skeleton with name field disabled |
| Empty | counts read "None yet" | designed empty state with the create action | n/a |
| Read error | one ErrorCard, retry all | ErrorCard, retry | ErrorCard, retry the row read |
| Submitting | n/a | n/a | footer loading; fields stay editable? **No** — reads are cheap, but a double-submit is not: disable the footer only |
| Save refused | n/a | n/a | critical Notice above the footer, form intact, nothing typed is lost |
| Saved | n/a | positive Notice after the sheet closes | go back to the list; the row is already refreshed |
| Locked / in use | n/a | chip | notice + disabled behaviour controls; name/order still save |
| Unsaved | n/a | n/a | `useUnsavedChanges` on back, Android back and swipe |
| Offline | ErrorCard when the read fails | ErrorCard | save failure wording; the draft stays |

Keyboard: numeric fields use `decimal-pad`/`number-pad`; sheets are `KeyboardAvoidingView` already;
the band editor is a pushed screen (no `InputAccessoryView` needed — Save is a button, not the IME);
"Add band" scrolls nothing and does not steal focus.

### Data and hooks

New `screens/exams/grading/use-grading.ts`:
- `useGradingScope()` → active context (`organizationId`, `schoolId`, running year, permissions).
  Every class/subject read carries `schoolId`.
- `useSubjectTypesAdmin()` / `useSubjectTypeActions()` (create, update, deactivate, applyPreset).
- `useGradingScalesAdmin()` / `useGradingScaleActions()` (create, update, replaceBands, makeDefault).
- `usePassCriteriaAdmin(yearId)` / `usePassCriteriaActions()` (create, update).
- `useCriteriaClasses()`, `useCriteriaSubjects()`.
- Invalidation: types → `subjectTypes.list`, `subjectMapping.list` (all), `termGrades.list`;
  scales → `gradingScales.list`; criteria → `passCriteria.list`, `eligibility.list`.

Pure logic (unit-tested, no React):
- `lib/grading-scale.ts` — hundredth parsing, band validation + coverage (gaps/overlaps with the
  offending band), largest-uncovered-interval prefill for Add, remove-and-extend, grade lookup for
  the score check, list-row band sentence.
- `lib/pass-criteria.ts` — draft → summary lines, validation mirrored from the contract, list-row
  meta, default-copy for an override.
- `lib/subject-types.ts` — flag sentence, validation, and the "term grades carry no marks" caution.

### Backend endpoints used

| Act | Procedure | Count |
|---|---|---|
| read types / create / update / deactivate / preset | `subjectTypes.list/create/update/deactivate/applyPreset` | 5 |
| read scales / create / rename+retire / replace bands / make default | `gradingScales.list/create/update/replaceBands/makeDefault` | 5 |
| read / create / update rules | `passCriteria.list/create/update` | 3 |

13 of 7F's 14 procedures. `subjectTypes.byId` is not called: a list row already carries the whole
row (the web's tables do the same). No backend change.

### Acceptance (7F)

1. From Exams, an admin reaches all three lists in two taps; a teacher without `exam:update` never
   sees the row.
2. The hub's three details are true counts, including the default scale's name.
3. A type can be created with only a name (server defaults fill the rest), edited, and retired;
   an in-use type locks its behaviour controls and says why, while name/order still save.
4. The preset is idempotent, states what it will do before doing it, and reports what it added.
5. A scale cannot be saved with a gap, overlap, missing 0/100 edge, duplicate label, or a range
   that ends before it starts — each problem is shown on the row *and* above the save.
6. A saved scale is contiguous by construction, the first may be the default without a second
   call, and a locked scale's bands are visibly immutable while its name still saves.
7. “Check a score” resolves against the edited bands before save.
8. Pass criteria creates a school default, then only offers uncovered classes; an override starts
   from the default's values; grace/compartment caps are required exactly when their switch is on.
9. Every screen handles loading, empty, error, denied, no-branch, no-session, submitting, refused,
   saved, locked, and unsaved changes.
10. No write is optimistic; nothing reports success before the server answers.

### Deliberate non-builds / new gaps (no backend change)

39. **No reactivation.** `subjectTypes.list` and `gradingScales.list` return active rows only, so a
    retired type or scale has no screen to come back from, although both `update` routes accept
    `isActive: true`. Add an inactive filter (or a `includeInactive` flag) before promising undo.
40. **No scale clone.** "Create a new scale" is a blank editor; a locked scale cannot be copied
    band-for-band, so a policy fork re-types every band. A `clone` route would remove the chore.
41. **No pass-criteria delete.** A class override that should not exist can only be edited into
    something harmless. The unique index also means a mistaken scope cannot be moved.
42. **Band `descriptor` has no editor** (same shape as gap 37). The editor preserves an existing
    descriptor when replacing bands, but cannot set one.
43. **Config rows have no `expectedUpdatedAt`.** Two admins editing the same scale last-write-wins,
    silently. Marks and term grades have the same hole (gap 33).
44. **No audit read.** The tables carry `createdBy`/`updatedAt`, but no screen can answer "who
    changed the pass rule in July?".
45. **Term-grade flag combinations are not enforced server-side.** `assessmentMode: term_grade`
    with `countsTowardResult: true` is accepted; the app explains the contradiction but cannot
    refuse it.
46. **`subjectTypes.list`'s lock flag is tenant-wide, not branch-wide** (`schoolIds` union across
    scopes). A type used in another campus reads "In use" here. Correct for shared types, noisy
    when the branches are meant to be independent.

### Docs and skills (7F)

Read before coding: `mobile-design` (forms, screen-patterns: sheets for short edits, pushed forms
for long ones, one primary action per screen, states before styling) and the repo's existing
patterns in `screens/fees/setup-heads.tsx` (list + sheet + retire) and
`screens/exams/components-editor.tsx` (pushed form, inline validation, unsaved guard). No new
dependency, no new native module, no new Expo API: `FormSheet` / `ScreenFrame` / `ChoiceSheet` /
`SwitchRow` / `ChoicePills` / `Notice` / `CapsuleButton` are already used on this branch.
`TextInput` numeric/decimal behaviour and `usePreventRemove` were verified for 7A/7D (see the 7A
table above); nothing here re-opens them. The only platform question left is visual (coverage bar
at large text), checked on the device walk.

---

## Owner decisions needed at review (recommendation first)

- **D1 — Navigation.** Exams is a pushed destination (Home card + More), **not** a 7th tab.
  Alternative: promote Exams to a tab and demote Students to More-only. Recommendation:
  Home card + More; revisit after a term of use.
- **D2 — Entry layout.** Inline list with one input per row, component-at-a-time (recommended),
  vs. a focused one-student-at-a-time card (big input, photo, Prev/Next). The list wins on
  scan/edit and matches Attendance; a focused mode can be added later if the walk shows wrong-row
  mistakes. Say if you want the focused mode in 7A instead of later.
- **D3 — Graded-only grades.** The entry contract carries no grade vocabulary, so the grade
  field is free text (≤10 chars, upper-cased) and the server judges it. Fine for v1, or do you
  want a backend change to serve the scale's allowed grades?
- **D4 — Report card PDF/share (7C).** No server PDF exists; the web prints client-side. Options:
  `expo-print` HTML → PDF → share sheet (recommended), or defer sharing and ship review-only.
- **D5 — "My papers" scope.** Derive from teaching pairs on the client (recommended; no backend
  change), or request a `marks.myPapers` read later for exact answers.

## Documented backend gaps (no changes made)

1. No read for "papers I can enter" — client derives from `exam.byId` ∩ teaching pairs.
2. `marks.entry` carries no grade vocabulary for graded-only papers (D3).
3. `exam.byId` schedules carry ids, not names — screens join the class and subject lists.
4. No per-paper entry progress on `exam.list`/`byId`; progress needs one `marks.entry` per paper.
5. No server PDF for report cards (D4).
6. `marks.save` is one cell per call; a whole-column paste/import would need a batch endpoint.
7. Section names for a class-wide paper's picker need `academic.section.list` (a second read).
8. Over-max (trigger) and negative-marks (plain Error) refusals have no friendly mapping in
   `errors.ts`, so they surface as the generic message; the app validates both client-side first.

## Docs and skills — verified 2026-10-26 (before any 7A code)

Pinned: Expo `~57.0.28`, `expo-router ~57.0.26`, React Native `0.86.3`, React `19.2.3`,
`@tanstack/react-query 5.101.2`, `@trpc/* 11.18.0`. The reactnative.dev pages fetched are the
site's current docs (not versioned to 0.86.3); anything that matters for a release gate is
re-checked on device.

| Topic | Source | What it settles |
|---|---|---|
| `TextInput` | https://reactnative.dev/docs/textinput | `keyboardType="decimal-pad"` is cross-platform. `submitBehavior="submit"` fires `onSubmitEditing` **without** blurring (keeps the keyboard up between rows); `blurOnSubmit` is deprecated. `onEndEditing` is the documented way to read the final value (`onBlur`'s `nativeEvent.text` may be undefined). `inputAccessoryViewID` is iOS-only. `enterKeyHint`/`inputMode` exist but we keep `keyboardType` + `returnKeyType` (what the other forms use). `maxFontSizeMultiplier` caps scaling (we use 1.3 on the field). **The page does not say whether iOS decimal pads show a return key** — treated as "no return key" (the forms skill agrees for phone-pad), so iOS gets the accessory bar; verified at the iOS gate, not assumed. |
| `InputAccessoryView` | https://reactnative.dev/docs/inputaccessoryview | iOS-only, linked by `nativeID` ↔ `inputAccessoryViewID`; no multiline support; **cannot be used with a bottom tab bar** (react-native#20157). The paper screen is a pushed route outside `(tabs)`, so this does not apply — keep it that way. |
| `FlatList` | https://reactnative.dev/docs/flatlist | `scrollToIndex` beyond the render window needs `getItemLayout` (our rows scale with text size, so we do not use it and instead keep the next rows inside the window and fall back on `onScrollToIndexFailed`); rows are not state-preserving when they leave the window → **drafts live in a reducer outside the rows**; `extraData` is required because the memoized `renderItem` reads external state. |
| Expo Router params | https://docs.expo.dev/router/reference/url-parameters/ | `useLocalSearchParams<{…}>()` for dynamic segments; **`router.setParams` re-mounts the screen when a route param changes** → the section pick is local state, never a route param (a remount would drop unsaved rows). |
| Cache patch | https://tanstack.com/query/v5/docs/framework/react/guides/updates-from-mutation-responses and https://trpc.io/docs/client/react/useUtils | `setQueryData` takes an updater that must not mutate `oldData`; tRPC `utils.x.setData` wraps it (updater signature read from the types, not the page). |

Skills read: `mobile-design` (`design-process`, `forms`, `screen-patterns`),
`vercel-react-native-skills` (list rules). The Expo-named skills AGENTS.md lists
(`expo-router`, `expo-data-fetching`, …) are **not installed in `.agents/skills`** — the
official docs above stood in for them.

**Conflict recorded:** `vercel-react-native-skills/list-performance-virtualize` says use
FlashList. FlashList is not a dependency, the plan forbids a new one, and its cell recycling
fights text inputs that hold focus. Decision: `FlatList` with memoized rows and drafts outside
the rows. A section's roster is tens of rows; revisit only if a class-wide paper walks slowly.

**Server wording already mapped (no new mapping needed):** "Marks entry is not open for this
exam yet." (CONFLICT), "This entry is locked. Corrections go through the revision window after
publication." (CONFLICT), "Someone else saved this cell while you were typing — refresh the cell
and reapply." (CONFLICT) all pass through `lib/errors` as human text; the not-assigned FORBIDDEN
line is already allow-listed. **Two refusals have no mapped wording:** over-max is a DB trigger
(`marks exceed the component maximum`, migration 0015) and negative marks is a plain
`Error("This exam does not allow negative marks.")`; neither is in `packages/trpc/src/errors.ts`,
so the server would answer the generic "Something went wrong". The client therefore checks both
**before** sending (a requirement, not polish); the gap is recorded below (#8).

## Reuse (no new dependency expected)

`ScreenFrame`, `FormSheet`, `ChoiceSheet`, `ChoicePills`, `SelectField`, `StatusPill`, `StatMeter`
/`StatusMeter`, `SectionLabel`, `EmptyState`, `ErrorCard`, `Skeleton`, `Notice`, `SwitchRow`,
`PermissionGate`, `usePermissions`, `useActiveContext`, `use-unsaved-changes`, the homework
`use-teaching-pairs` approach, `lib/errors` + copy conventions. New icons: `exams`, `marks`,
`verified`, `absent`.

## Commit plan (7A, one concern each)

1. `feat(mobile): exams foundation — copy, icons, lib/exams (pure logic + tests)`
2. `feat(mobile): exams list + exam hub + stage transition`
3. `feat(mobile): marks entry — grid, per-cell queue, student sheet`
4. `feat(mobile): exams entry points — Home card, More row, permission gates`
5. `docs: ledger + tasks for 7A`

Never committed by the agent; each commit's message and file list is handed to the owner.

---

# 7A build record (2026-10-26)

## What shipped

Routes (thin): `(staff)/exams.tsx`, `(staff)/exams/[examId].tsx`, `(staff)/exams/[examId]/paper/[scheduleId].tsx`.
Bodies in `screens/exams/`: `index` (list), `hub`, `paper` (marks entry), `entry-row`, `student-sheet`,
`paper-card`, `stage-track`, `chip-row`, `meta`, `types`, `use-exam-data`. Logic in `lib/exams.ts` (stages, marks
text, roster order, my-papers) and `lib/exam-draft.ts` (the `PaperDraft` store); tests beside them.
Shared: `components/list-screen-frame.tsx` (new; `ScreenFrame` for a windowed list),
`HeaderActionButton`/`HeaderAction` now exported from `screen-frame.tsx`, four icons, `useUnsavedChanges`
takes optional copy, Home `OpenExamsCard`, More → Teaching → Exams.

## Deviations from the design above (each deliberate)

- **Home card lists open exams, not papers.** Listing papers needs `byId` per exam plus teaching pairs; the card
  opens the hub, where the caller's own papers are pinned and marked "Your paper". One extra tap, far less machinery.
- **Lock is in the overflow, never the primary button** (`stageMoves`). A published exam's main business is its
  results; the irreversible act takes a detour.
- **Pass mark on the paper header is the sum of the components' own pass marks** ("pass 7" on a /20 paper). The
  grid's `passMarks` is the weighted 0-100 scale (it arrived as 35).
- **No "paper is locked" banner.** `isLocked` flips when entry OPENS, so it is true exactly when entry is allowed.
- **under_verification copy corrected.** The web says "Entry closes for editing"; `saveComponentResult` keeps entry
  open in that stage and only locks verified rows. Mobile says "Marks stay editable until they are verified".
  The web string should be fixed to match (not done here).
- **Failed-save row line is "Not saved · Tap to retry"**; the full friendly sentence is in the retry dialog.
  (A conflict still shows its own wording.)
- **Section pick is local state**, auto-selected when the caller has exactly one section for the paper; a
  section paper passes its own section as the advisory `sectionId` so `canEnter` is evaluated up front.
- **Rapid one-student-at-a-time mode (D2) not built**, as decided.

## Walk record — emulator-5554 (1080x2400), Metro :8081, API :4000, 2026-10-26

Walked as org admin and as `subject-teacher@demo-trust.test` (demo seed login):
- More → Teaching → Exams; Home "Marks to enter" card (teacher); list segments with counts, incl. Upcoming.
- Hub: stage track, "PAPERS · CLASS 6"; admin sees every paper as Enter marks; the subject teacher sees
  Mathematics + Physics as "Your paper" and Personality as "Not your paper"; no stage button for the teacher.
- Entry, single component: typed 17, then the **keyboard's own Next key**: saved with a tick and focus moved to the
  next row with the keyboard still up; over-max 22 and 99: red "Out of 20" row, nothing sent; a below-pass mark
  (4/20) in amber; AB chip (row tint, spinner, tick); student sheet (roll/admission, field, Absent, Exempted ->
  required type -> Medical -> the row shows "Exempt" with a tick); progress bar and Missing/Absent chip counts.
- Failure path: API stopped, typed 14: row shows the failure ("Not saved · Tap to retry"), footer "1 row isn't
  saved · Retry all"; back with unsaved work shows the "Some marks aren't saved" guard (Keep editing / Leave
  anyway); API restarted, Retry all: saved with a tick, footer "All changes saved".
- Multi-component class-wide paper (Physics): Section row (auto-picked), Theory /40 · Practical /10 switch,
  "Practical: –" line on each row.
- Not-assigned paper (Personality, subject teacher): read-only rows, "No section to enter for" notice, no footer.
- Stage move (admin): confirm sheet with the consequence; **refusal path**: "Some marks are still missing..."
  shown inside the open sheet; **success path**: Unit Test 2 Scheduled -> Ongoing: "Exam moved to Ongoing.",
  stage 3 of 7, footer becomes "Open marks entry".
- 1.0x and 1.3x text scale on the hub and the entry list (rows hold; the bar-flag line now wraps to two lines).

Findings fixed during the walk: header pass mark; no class name on a single-class hub; footer CTA not full width;
failed-row text truncated; read-only placeholder "/20" (now a dash); bar-flag line truncated at 1.3x.

## Not walked (say so, do not claim)

iOS entirely (parked; the InputAccessoryView bar and the iOS decimal-pad return key are unverified);
a graded-only paper (the demo has no graded-only subject); the two-writer stale-cell conflict (store logic is
unit-tested, the screen path is not); the hub Options sheet and a back-move confirm (no walked exam sat in a stage
with a back move); the student-sheet arrows; a 100+ student class-wide roster and the `onScrollToIndexFailed`
fallback; the section ChoiceSheet with more than one section (the demo school has one).
**Walker's notes:** `adb shell input keyevent 66` (synthetic Enter) hides the keyboard; tap the IME's own Next key
instead. Editing a module the paper screen imports (copy, entry-row) triggers a dev reload that resets the
screen's state; that is not a product bug.

## Fixture and environment

`apps/api/scripts/tmp-seed-exam-walk.ts` (deleted) created, in the demo school's Class 6-A: exams "Unit Test 1
(walk)" (now marks_entry, some marks entered) and "Unit Test 2 (walk)" (now ongoing), three papers each (Maths
section-A /20, Physics class-wide Theory 40 + Practical 10, Personality class-wide /20), and eleven students
`WALK-001`..`WALK-011` (rolls 2-12). Both exams are set to not count toward the term (the term already has a
counting exam at 100%). The dev DB also holds hundreds of integration-test schools, so any script that loops over
`schools` is very slow: look the demo school up by name.

## Gates

`pnpm check-types`: every package green except `@repo/api`, whose only errors are in the pre-existing untracked
`scripts/tmp-seed-fees-demo.ts`. Mobile: `tsc --noEmit` clean, `eslint` 0 errors, jest 31 suites / 452 tests
(+50 new: `lib/exams.test.ts`, `lib/exam-draft.test.ts`).

## Backend gaps added during the build

9. The web's under_verification consequence string is wrong (see above).
10. The grid's `passMarks` is the weighted 0-100 scale while components carry raw pass marks; a client must not
    print it next to "out of 20".
11. `exam.byId` has no term name, and `marks.entry` has no exemption type for an exempt row, so the sheet cannot
    show a saved exemption's type.

## Commits (hand-off — the agent does not commit)

LANDED 2026-10-27. The owner's three commits (`2380fab`, `f335a0e`, `ace7f75`) absorbed
groups 1–3 below; the rest landed, regrouped whole-file, as `7820672` (groups 4 + most of
7B-3's leaves and hooks), `e678b4b` (the paper screen + route, incl. the section-narrowing
fix) and `968f778` (group 5). The regrouping was forced by reality: 7B hunks already sat
inside untracked 7A files, so the plan's shared-file splits were not separable.

1. `feat(mobile): exam entry logic — marks text, stages, draft store (pure, tested)` — `apps/mobile/src/lib/exams.ts`, `exams.test.ts`, `exam-draft.ts`, `exam-draft.test.ts`.
2. `feat(mobile): list screen frame, icons and copy for exams` — `components/list-screen-frame.tsx`, `components/screen-frame.tsx`, `components/app-icon.tsx`, `hooks/use-unsaved-changes.ts`, `lib/copy.ts`.
3. `feat(mobile): exams list, hub and stage moves` — `app/(staff)/exams.tsx`, `app/(staff)/exams/[examId].tsx`, `screens/exams/{index,hub,stage-track,paper-card,chip-row,meta,types,use-exam-data}`.
4. `feat(mobile): marks entry — rows, save queue, student sheet` — `app/(staff)/exams/[examId]/paper/[scheduleId].tsx`, `screens/exams/{paper,entry-row,student-sheet}`.
5. `feat(mobile): exams entry points on Home and More` — `screens/staff-home/{index,open-exams}.tsx`, `screens/more/index.tsx`.
6. `docs: plan, ledger and tasks for exams 7A` — `.kilo/plans/2026-10-26-mobile-exams.md`, `docs/MOBILE_PLAN.md`, `docs/TASKS.md`.

Do NOT include the unrelated working-tree changes (`apps/api/src/env.ts`, `apps/web/src/lib/*`, `rough.md`,
`skills-lock.json`, the `tmp-*` scripts, `.kilo/tmp/`, `.zcodeignore`).

---

# Chunk 7B — Verify (design addendum, 2026-10-27) — APPROVED (D6-D11), BUILT; see "7B build record" below

Plan rule (AGENTS.md mobile rule 2): the journey, wireflow, states and acceptance are written and reviewed
before any 7B UI. This replaces the short "7B — Verify" sketch above; where they differ, this wins.

## What the server actually does (read from `exam-marks.service.ts`, not assumed)

- `marks.verify` / `marks.unverify` take `{ componentResultIds, sectionId, subjectId }` plus the usual scope.
  Gate: `marks:verify` only — **not subject-gated, not stage-gated** (it works in `marks_entry` and
  `under_verification`; the web only offers it when entry is open). The input's `sectionId` is the addressed
  scope node, so the caller's scope must cover that section.
- A batch must be **one paper** and every student in it must sit in the stated section — or have **no
  section**, on a class-wide paper only. So a class-wide paper with several sections is verified **section by
  section**; one batch of the whole class is refused ("Some entries are outside the stated section").
- `verify` moves `entered → verified` (stamps `verifiedBy/At`, so `updatedAt` moves). A `draft` row in the batch
  throws ("An unentered entry cannot be verified…"); `published/locked` rows throw. Already-verified rows are
  left alone. **There is no `expectedUpdatedAt`**: whatever value a row has at the moment the server runs is what
  gets verified, even if it changed a second after the reviewer read it (backend gap #12).
- `unverify` moves `verified → entered` (clears `verifiedBy/At`). It is the **only** way to correct a
  verified-but-unpublished mark: `marks.save` refuses a verified row, and a revision window needs a
  publication. No audit row (the service says so). Published/locked rows refuse.
- Default holders of `marks:verify`: **principal and vice_principal** (and org_admin). `class_teacher` and
  `subject_teacher` do not (the router's comment says class teachers verify; the default matrix says otherwise —
  schools can grant it per role). Everything below is permission-gated, never role-gated.
- `eligibility.readiness(examId, classId)` returns `expectedEntries / enteredEntries / verifiedEntries` (cells =
  students × components, `entered` counts every non-draft row including verified) plus 7C's publish facts.
  `enrollment.list` takes `classId`, which is the only way to learn which section a student of a class-wide
  paper sits in.

## Actor, task, context

**Actor:** vice principal / principal (or a class teacher the school granted `marks:verify`), at a desk or in a
meeting, with the answer scripts or the teacher's register beside them. **Task:** "Did the teachers enter these
correctly, and is it safe to lock them?" — read a paper's marks against the scripts, fix a wrong one, then lock
the paper so it can feed results. **Frequency:** a few times per exam, 6–12 papers each, one class at a time.
**Stakes:** verified marks lock and feed published report cards; the act must be deliberate, countable and
undoable until publication.

Design read: *a high-stakes review task done at a desk; the entry screen's calm utility interface, quieter and
denser, read-first; Android now.* Dials: variance 3, motion 2, density 6.

## Journeys

### B1. Review and verify a paper (the main one)
Hub (under_verification) → class chip → the paper with "12 to verify" → paper opens in **Review** → scan the
list (values large, roll order, read-only) → tap a doubtful student → sheet → correct the value (saves through
the same queue) → back → footer **Verify 12 entries** → confirm sheet states counts and consequence → "Verified
12 entries" banner with **Reopen these**.

### B2. Correct after verifying
Review → a verified student (seal glyph) → sheet → **Reopen for correction** → confirm → the row returns to
"to verify", editable in the sheet → correct → Verify again. A mistaken whole-batch verify is undone from the
success banner ("Reopen these") for as long as the screen is open.

### B3. Class-wide paper with several sections
Review shows the section chip ("Verifying 6-B · 28 students"); Verify acts on that section only (the batch rule
above). Switching section switches the list and the counts; the paper-wide progress stays visible.

### B4. A teacher (no `marks:verify`) opens the same paper
No Enter/Review switch. Verified rows show the seal and "Verified"; the sheet says "This entry is verified. Ask
a reviewer to reopen it." (today's copy says "only change through a correction" — wrong for unpublished rows).

### B5. Hub as a reviewer
Under the class chips: **"Entered 96 of 96 · Verified 40"** with a three-state bar (from `readiness`, one read per
class), and each paper card shows its own **"20 verified · 12 to verify"**; papers needing review sort first.

## Wireflow

```
Hub (reviewer) ─ paper ─► Paper · Enter | Review ─ Review ─┬─► Student sheet ─► Reopen confirm
                                                            │      └─ correct a value (same save queue)
                                                            ├─► Section sheet (class-wide, >1 section)
                                                            └─► Verify confirm ─► success banner ─► Reopen these
```

### Screen 1 — Paper, Review mode (`/exams/[examId]/paper/[scheduleId]`, same route)
```
‹ Class 6 · Mathematics                                [ Section 6-B ▾ ]   (only class-wide, >1 section)
Unit Test 1 · out of 20 · pass 7
[ Enter | Review ]                      ← SegmentBar, only with marks:verify and entry open
┌ Review ──────────────────────────────────────────────┐
│ ▰▰▰▰▰▰▰▱▱▱▱▱   (verified solid · to verify tint · missing grey)
│ 20 verified · 12 to verify · 0 missing       (words, never colour alone)
└──────────────────────────────────────────────────────┘
[ To verify 12 ][ Verified 20 ][ Missing 0 ][ Absent 1 ]                       ← ChipRow
 02  Aarav Mehta                                   17
 03  Bhavya Rao                                    9  ⚑ below pass
 04  Chirag Das      Changed just now             13  [Changed]
 05  Divya Nair                                 Exempt
 06  Esha Iyer       Theory 32 · Practical 8        ◆ Verified    ← multi-component: one line, no component switch
───────────────────────────────────────────────────────
 [          Verify 12 entries          ]   ← footer; the reason line appears when it is disabled
```
- **Rows are read-first summaries, not inputs.** The verifier is checking, not typing; a 48 dp input per row
  invites accidental edits while scrolling and a keyboard in the way. Correction is deliberate: tap a row →
  the student sheet (which already has every component, absent, exempt) → the value saves through the same
  `PaperDraft` queue as in 7A. A multi-component student is one row with all values, so the component switch is
  hidden in Review.
- Row anatomy: roll · name (+ one status line) · value(s) right-aligned in callout/semibold · glyph.
  Glyphs: **verified = seal** (`grade` icon, accent) with the word "Verified" as the status line; entered rows have
  **no glyph** (they are not done); `Changed` pill (amber) on a row whose server value moved while the reviewer
  was on the screen; amber value colour for below-pass (advisory, as in 7A); absent/exempt read as words.
- Progress meter: `StatusMeter` segments verified (positive, solid) / to verify (positive, 35%) / missing
  (neutral, 20%), with the counts printed beside it. Counts are **cells** (students × components) to match the
  server; the confirm sheet also says how many students that is.
- Chips replace Missing/Absent/Below pass: **To verify** (default) · Verified · Missing · Absent. Membership
  freezes at tap (the 7A rule) so a row does not vanish from "To verify" the instant it is verified.
- Footer (the only primary): `Verify {n} entries`. Disabled states state their reason in one line:
  unsaved edits ("Save or discard your edits first"), a class-wide multi-section paper with no section
  chosen, nothing to verify ("Everything entered is verified"). Missing students do **not** block (D7).

### Screen 2 — Verify confirm sheet
```
Verify 12 entries?                                   ✕
12 marks for 12 students in Section 6-B will lock.
2 students have no mark yet and are not included.
They can be reopened for correction until results are published. Recorded under your name.
[ Verify 12 entries ]
[ Not yet ]
```
Before sending, the app **re-reads the paper** and compares each entered row's `updatedAt` with what the sheet
showed. If anything moved, the sheet does not verify: it says "3 marks changed while you were reviewing",
marks those rows `Changed`, and returns to the list (D11). A refusal from the server (scope, sealed row)
appears inside the open sheet in the server's words, as in 7A's stage move. Never optimistic: the banner and
the seals appear only after the server answers; the store is then synced from the returned rows.

### Screen 3 — Student sheet additions
- Verified row, reviewer: a **Reopen for correction** button (confirm: "This returns the mark to 'to verify' so it
  can be changed. It stays recorded as entered by the teacher.") → `unverify` for this student's verified rows in
  this paper → the fields become editable.
- Verified row, non-reviewer: the read-only note above (B4). Published/locked: no reopen; the note says
  corrections after publication go through a correction window (7C).
- Entered row, reviewer with `marks:create`: fields editable exactly as in 7A.

### Screen 4 — Success banner
"Verified 12 entries." + **Reopen these** (batch `unverify`, same confirm). It lives on the screen until the
reviewer leaves or edits; it is the undo for a mistaken batch.

### Screen 5 — Hub, reviewer view
Under the class chips: a card "Entered 96 of 96 · Verified 40 · 56 to verify" with the three-state bar. Paper cards
for reviewers carry `20 verified · 12 to verify` instead of the action line, and sort **needs review first**
(then the 7A order). Teachers and non-reviewers see the 7A hub unchanged.
- Data: `readiness` once per **active class**; per-paper counts from one `marks.entry` read per paper of the
  active class, reduced to counts with `select`, `staleTime` 30 s, **only** for reviewers at an entry stage (D8).

## Screen states (all new surfaces)

Initial loading (skeleton shaped like the meter + rows) · nothing entered yet ("Nothing to review yet", link to
Enter) · everything verified (a quiet "All 32 entries are verified" card, no primary, reopen via row) · error +
Retry with cached rows kept · offline (Verify fails into the sheet with the connection copy; nothing changes) ·
permission loss mid-session (the server refusal, in its words) · unsaved edits (Verify disabled + reason, switching
mode keeps the draft) · changed-remotely rows (flag + banner "2 marks changed while you were reviewing —
Review changes") · submitting (button busy, sheet stays) · success (server-confirmed only) · app resume (grid
re-read and merged; changed flags may appear) · stage moves past entry (Review segment disappears; verified rows
read-only) · text scale 1.3× (rows wrap the status line, value never clips) · screen reader: each row reads
"Roll 3, Bhavya Rao, 9 out of 20, entered, not yet verified".

## Data, hooks, store (no new dependency, no backend change)

- `useVerification(paper, section)` (new, `screens/exams/use-verification.ts`): the two mutations, the verify
  batch from the store, and — only for a class-wide paper with several sections — `enrollment.list({ classId })`
  to partition the roster (`partitionBySection`, pure, tested). Every read carries `schoolId`.
- `lib/exam-draft.ts` gains: `reviewSummary(draft, studentIds, componentIds, version)` (verified / to verify /
  missing / absent / changed, in cells); `verifyBatch(draft, studentIds, componentIds)` (row ids whose **server**
  status is `entered`, not dirty, not changed); `Cell.remoteChange` set by `sync()` when a refetch brings a newer
  `updatedAt` with a different value for a cell the screen already showed, cleared by `acknowledge(key)`; and
  `verified`/`reopened` merges from the mutation response rows through the existing `sync`.
- Verify is built from `base` (server truth), never from typed text, and is disabled while `draft.status().total
  > 0` — a typed-but-unsaved value must not be verified as its old self.
- `lib/exams.ts` gains `canReview(stage, permissions)` and `partitionBySection`.
- Query invalidation after verify/reopen: `exam.eligibility.readiness` and the hub counts.

## Files (expected)

New: `screens/exams/review-row.tsx`, `review-summary.tsx`, `verify-sheet.tsx`, `use-verification.ts`,
`use-review-counts.ts` (hub). Changed: `paper.tsx` (mode switch, review list/footer), `student-sheet.tsx`
(reopen + notes), `hub.tsx` + `paper-card.tsx` (reviewer counts/order), `lib/exam-draft.ts`, `lib/exams.ts`,
`lib/copy.ts`. Tests: store (remote-change flag, `verifyBatch`, `reviewSummary`, merges from verify/unverify
rows), `partitionBySection`, `canReview`.

## Acceptance (7B)

- A principal/VP opens an `under_verification` paper, sees Review by default, reads every value without a keyboard,
  corrects one through the sheet, verifies the rest, and sees seals only after the server answers.
- Missing students are excluded and said so; partial verification works.
- A value changed by someone else between reading and confirming is **not** verified; the reviewer is told which rows.
- A mistaken verify is undone from the banner; a single row is reopened from its sheet; a reopened row can be
  corrected and verified again.
- A class-wide paper with two sections is verified one section at a time, and a sectionless student is included.
- A teacher without `marks:verify` never sees Review, Verify or Reopen, and reads verified rows as locked with the
  honest note.
- Hub counts (class and per paper) match the server's; reviewers see the review-first order.
- 44/48 dp targets, 1.3× text, screen-reader row labels, no success before the server confirms, no double-fire.

## Verification plan

- `pnpm check-types`, mobile lint, jest (new store/lib tests as above).
- **Fixture** (throwaway script, deleted after): fill **every** cell of "Unit Test 1 (walk)" (the stage move to
  verification refuses until every student has every part entered), add Class 6-B with 3 students so Physics
  (class-wide) has two sections plus one sectionless student, then move the exam to `under_verification`.
- Device walk on emulator-5554 at 1.0× and 1.3×: B1 end to end; partial verify (leave one blank); B2 (reopen a row,
  Reopen these); B3 (two sections); B4 as a subject teacher; the changed-remotely guard (edit a cell from a second
  client — `curl` the tRPC `marks.save` — between opening the confirm sheet and confirming); offline verify;
  server refusal path (verify after the exam is published, via SQL); hub counts as a reviewer and as a teacher.

## Decisions for the owner (recommendation first)

- **D6 — Where Review lives.** A segment on the paper screen with read-first rows and corrections through the
  student sheet (recommended), or a separate screen. One screen keeps one mental model and one save queue.
- **D7 — Partial verification.** Verify only what is entered, say what is excluded (recommended; matches the
  server and the web), or require a complete paper first.
- **D8 — Hub counts.** Class-level `readiness` **and** per-paper counts from `marks.entry` reads for the active
  class (recommended; without them a reviewer must open every paper to learn what is left). If it feels slow on a
  real network, drop per-paper counts and keep the class line.
- **D9 — Move `eligibility.readiness` from 7C to 7B** (read-only, for the hub line). 7C then builds the publish
  card on top of it. Ledger: 7B = verify, unverify, readiness (3); 7C drops to 13. Staff total stays 46.
- **D10 — Undo.** A "Reopen these" banner after a verify, plus per-student reopen in the sheet (recommended), or
  per-student reopen only.
- **D11 — Changed-while-reviewing guard.** Client-side re-read and compare before verifying, excluding changed
  rows (recommended; the server has no per-row guard), or trust the click.

## Backend gaps added by this addendum (no changes made)

12. `marks.verify` has no `expectedUpdatedAt` per row, so a verify can lock a value the reviewer never saw. The
    client guard above narrows the window to milliseconds; the server should take the stamps.
13. The grid returns no `verifiedBy`/`verifiedAt`, so the screen cannot say who verified a row or when.
14. `marks.save`'s refusal of a verified row is mapped to "This entry is locked. Corrections go through the
    revision window after publication." — wrong before publication (the correction path is `unverify`). The
    mobile UI prevents the attempt (verified rows are read-only), but the mapping should be fixed.
15. `unverify` writes no audit row.
16. No endpoint partitions a class's roster by section; `enrollment.list({ classId })` is used, which returns the
    whole class's enrollments.
17. The router comment says class teachers verify; the default permission matrix gives `marks:verify` only to
    principal and vice principal.

---

# 7B build record (2026-10-27)

Owner approved D6-D11 as recommended ("including moving readiness into 7B"), then said to build 7B on top of the
uncommitted 7A tree on `feat/mobile-exams-7a` and that they will split the commits themselves with `git add -p`.

## What shipped

- **Review mode on the paper screen** (same route). `Enter | Review` segment for `marks:verify` holders while entry is
  open; a paper under verification opens in Review. Read-first rows (roll, name, values, one status line, a seal glyph
  for verified), never an input. Summary card counted **per mark, not per student**, with "Whole paper: x of y verified"
  when a section is in hand. Filters To verify / Verified / Missing / Absent (frozen when tapped, so a row does not
  jump out from under the finger). A "Changed" pill + banner when a value moved on the server after the reviewer first
  saw it; opening the row acknowledges it.
- **Verify** = one sheet, one batch: "Verify N entries?" with the consequence, then re-read the paper, compare
  `updatedAt` of every item, exclude anything that moved (and say so), then send. Seals appear only after the server's
  rows are merged into the store. Success banner with **Reopen these** (undo for exactly that batch).
- **Corrections** go through the student sheet: tap a row, **Reopen for correction** (inline confirm), edit, verify again.
  Locked-row notes are role-aware (reviewer: reopen offered; teacher: "Ask a reviewer to reopen it"; sealed
  after publication: honest note, no action).
- **Class-wide papers**: one section at a time (server rule). Section picker, "Verifying section B - 5 students
  (2 with no section yet)": sectionless students ride along in whichever section is verified first.
- **Hub as a reviewer**: class readiness card ("34 verified - 28 to verify"), per-paper pills (To verify / Verified /
  Waiting / No marks) and counts, **needs-review-first** ordering. Teachers see none of it.
- **Store** (`exam-draft.ts`): `remoteChange` flag, `acknowledge/acknowledgeAll`, `reviewSummary`,
  `studentsMatchingReview`, `verifyBatch` (server-`entered` and unchanged cells only, never typed text),
  `staleItems`, `reopenItems`. **Logic** (`exams.ts`): `canReview`, `partitionBySection`.
- **Found in the walk and fixed (7A scope, see findings): a class-wide paper's Enter roster is now narrowed to the
  chosen section.**
- Mobile ledger: `eligibility.readiness` moved here (D9); 7B = verify, unverify, readiness.

## Deviations from the 7B design (each deliberate)

- The pre-verify re-read is a direct `utils...entry.fetch(..., { retry: false })`, not `grid.refetch()`: the query
  client's default retry made a dead connection wait two 15 s deadlines on a locked sheet; it now says so after one.
- Loading, error and gone states of the paper screen carry **no header**. With the empty store the old header drew
  "Entered 0 of 17" above a connection error.
- The panel is **keyed by section**, so the undo banner, frozen filter and stale notice never follow the reviewer to
  another section (the banner's undo would otherwise have addressed another section's rows).
- Review's Verify is disabled with a stated reason (unsaved edits, no section chosen, nothing entered, all verified,
  only changed rows left) instead of being hidden; the reason is one line under the button.

## Walk record - emulator-5554, Metro :8081, API :4000, 2026-10-27

Fixture "Unit Test 3 (walk)" at `under_verification` in Class 6 (every mark entered; Maths section A /20 with one mark
cleared; Physics class-wide Theory 40 + Practical 10; Personality class-wide /20); Class 6-B with three students and one
sectionless student added (plus the demo's own sectionless student).

- Admin hub: class card, review-first order, per-paper pills and counts; counts and order update after a verify.
- Review default at `under_verification`; rows, summary, filters; stale-value guard (value changed by a DB script
  between opening the sheet and confirming: flagged, excluded, notice); acknowledge on open.
- Verify sheet content; verify success (seals only after the answer); correction in the sheet then "Verify 1 entry";
  per-student reopen; **Reopen these**; partial verify (the missing student is excluded and stated).
- Class-wide Physics: picker (A, B), "Choose your section to start" until picked; section B (3 + 2 sectionless) then
  section A (12 + the same 2, already sealed) - whole paper 34 of 34; the sectionless pair is not re-counted.
- Offline verify (API stopped with the sheet open): "Couldn't verify - Couldn't reach the server..." inside the sheet,
  nothing sealed, the button retries; API restarted, retried, 24 entries verified.
- Paper screen with the API down: clean "Couldn't reach the server" + Retry; Retry after the API returned recovered.
- Subject teacher (6-A): hub with no review chrome; Physics (all verified) shows locked rows, "Verified", the teacher's
  note, no Reopen, sheet arrows over the 12 students of section A; Unit Test 1 Physics roster is section A only
  ("Entered 0 of 12") and a typed mark saves with a tick.

Findings fixed during the walk: "Verified" line coloured amber when the student was also below the attendance bar (line
text and colour are now decided together); stale banner lingering after acknowledging; false "Changed" flags from a
grid the hub had cached before the screen mounted (`mountedAt` gate); two stacked green notices after verifying a whole
section; the undo banner / frozen filter following the reviewer to another section (undo would have addressed the wrong
section); "5 students" in a three-student section unexplained; error state counting "Entered 0 of 17"; offline verify
waiting two deadlines; **7A gap: with two sections, a class-wide paper's Enter list showed the other section's students
and a mark typed for one of them failed "Not saved - Tap to retry"** (the server accepts a mark only for a student of the
stated section or one with no section yet).

Environment note (not a product bug): the app held a cached section list from before the fixture's section B existed,
and its refetch sat paused behind the dev menu; the paper then showed one section until a full reload. The partition
decision reads the (60 s fresh) section list, so a section created while a reviewer already has the paper open is not
seen until the list refreshes.

## Not walked (say so, do not claim)

iOS entirely; 1.3x text on the Review rows, the verify sheet and the hub reviewer card (7A's 1.3x walk covered entry
only); a paper that is entirely single-section **and** reviewed in one tap (Personality was not opened; the all-verified
card was seen on both Physics sections); the server's refusal after a paper is published (SQL) and the sealed-row note;
a class teacher who was granted `marks:verify`; a 100+ student roster in Review; screen-reader reading of the new row
labels (labels are written, TalkBack not run); a graded-only paper in Review (the demo has none).

## Fixture and environment (left in the dev DB)

Demo school's Class 6: exams "Unit Test 1/2/3 (walk)"; UT3 at `under_verification` with Physics fully verified (34/34),
Maths and Personality unverified; students `WALK-001`..`WALK-015`; section "6-B". UT1's Physics has one teacher-typed
mark (Aarav Mehta, Theory 31). All `tmp-*` fixture scripts of this chunk are deleted; the API started for the walk is
stopped.

## Gates

Mobile `tsc --noEmit` clean; `eslint` 0 errors (one warning in the generated `.expo/types/router.d.ts`); jest 31 suites /
467 tests (+15 over 7A: review summaries and chips, `verifyBatch`, `staleItems`, `reopenItems`, remote-change merges,
`canReview`, `partitionBySection`). `pnpm check-types`: every package green except `@repo/api`, whose only errors are
in the pre-existing untracked `scripts/tmp-seed-fees-demo.ts`.

## Backend gaps added during the build

18. `marks.entry` returns the whole class for a class-wide paper (by design, BUG-9) but gives no section per student, while
    `marks.save` accepts a mark only for a student of the stated section (or a sectionless one). A client must read
    `enrollment.list({ classId })` to narrow the list. The grid should return each student's `sectionId`.
19. A section teacher's `enrollment.list` is clipped to her own section, so a **sectionless student never appears in her
    Enter list** although the completeness gate counts them: someone who covers the class (principal, class teacher)
    must enter them. Worth a product decision on who owns sectionless students.
20. `marks.verify` accepts no `expectedUpdatedAt` (gap 12): the client guard narrows the window; the server should take
    the stamps. Re-stated because the guard is now built and walked.

## Commits (hand-off - the agent does not commit; 7A is still uncommitted, so these sit on top of it)

LANDED 2026-10-27, folded into `7820672` and `e678b4b` (see the note at the 7A hand-off above).

Everything new in 7A is untracked, so `git add -p` needs `git add -N <file>` first for the files marked (shared).
7B-only new files are whole-file; shared files hold both 7A and 7B hunks.

1. `feat(mobile): review logic - remote-change flag, review summaries, verify batch, section partition (pure, tested)`
   - `apps/mobile/src/lib/exam-draft.ts` (shared), `exam-draft.test.ts` (shared), `exams.ts` (shared), `exams.test.ts`
     (shared): the 7B hunks (`remoteChange`, `acknowledge*`, `reviewSummary`, `studentsMatchingReview`, `verifyBatch`,
     `staleItems`, `reopenItems`, `canReview`, `partitionBySection`, and their tests).
2. `feat(mobile): copy for exam review and reviewer hub`
   - `apps/mobile/src/lib/copy.ts` (shared): `paper.review.*`, `paper.sheet.{locked*, reopen*}`, `hub.review.*`,
     `hub.notStarted*`, `sectionScope`, and the corrected under_verification consequence copy.
3. `feat(mobile): verify - review mode, verify sheet, reopen`
   - new: `screens/exams/{review-row,review-summary,verify-sheet,review-panel,use-verification,use-review}`
   - shared: `screens/exams/paper.tsx` (mode segment, review branch, `refetchEntries`, section key, gate),
     `screens/exams/student-sheet.tsx` (reopen + role notes)
4. `feat(mobile): reviewer hub - class readiness, paper counts, review-first order`
   - new: `screens/exams/{hub-review-card.tsx,use-review-counts.ts}`
   - shared: `screens/exams/hub.tsx`, `screens/exams/paper-card.tsx`, `screens/exams/use-exam-data.ts`
     (`canVerify`, `canReadMarks`)
5. `fix(mobile): narrow a class-wide paper's entry list to the chosen section`
   - `screens/exams/paper.tsx` (the `fullRoster` / `roster` / `sectionMap` hunk and the `sectionMap.pending` gate term),
     `screens/exams/use-verification.ts` (`willRun`). Fold into commit 4 of 7A if you prefer the fix to land with entry.
6. `docs: plan, ledger and tasks for exams 7B` - `.kilo/plans/2026-10-26-mobile-exams.md`, `docs/MOBILE_PLAN.md`,
   `docs/TASKS.md`.

Do NOT include the unrelated working-tree changes (`apps/api/src/env.ts`, `apps/web/src/lib/*`, `rough.md`,
`skills-lock.json`, `apps/api/scripts/tmp-*`, `packages/db/*.mjs`, `.kilo/tmp/`, `.zcodeignore`).

---

# Chunk 7C — Results, publish, correct (design addendum, 2026-10-27) — BUILDING

Plan rule 2: the journey, wireflow, states and acceptance are written before any 7C UI.
The owner waived pre-review on 2026-10-27 ("no need of permission needed for design") and
directed the build to proceed; every decision below was taken under that waiver, is
labelled D12–D16, and can be reopened by the owner at any walk. Where this addendum and
the short "7C — Results, publish, correct" sketch above differ, this wins.

## What the server actually does (read from `exam-results.service.ts` / `exam.router.ts`, not assumed)

13 endpoints, three permission tiers:

- **Reads.** `results.table` (`exam:read`, owner-resolved to the exam): one photograph of
  the last compute — `examStatus`, roster (active enrollments, roll order), a subject
  list, per-student×subject rows (`finalMarks/maxMarks/graceMarksApplied/isPassed/
  isAbsent/isExempted/grade/countsTowardResult/isGradedOnly/resultStatus`), per-student
  term rows of the exam's term (`total/percentage/grade/isPassed/subjectsFailedCount/
  rankInSection/rankInClass/resultStatus/publishedAt`), per-subject class stats and the
  class average. `publication.list` (`exam:read`): a row ONLY for classes already
  published — `state: published | revision_open | re_issued` with the three timestamps.
  `marks.studentEntries` (`marks:read`, owner-resolved to the exam): one student's
  component rows across all the exam's papers, each carrying the `componentResultId` the
  correction apply needs — ids only, no paper/subject names (join `exam.byId`).
  `cards.versions` (`report_card:read`, owner-resolved to the STUDENT): every version of
  the student's cards, newest first. `cards.classSet` (`report_card:read`, owner-resolved
  to the exam): the class's CURRENT cards for the exam's term — `snapshotData` is
  `unknown` and must pass `reportCardSnapshotV1` validation before render.
- **Compute.** `results.compute` (`exam:update`): one class; refuses on
  published/locked ("This exam is published — recompute is closed. Correct through a
  revision window."). `results.computeTermRanks` (`exam:update`, term-wide, no owner
  resolution): ranks per section AND per class; sectionless students get a class rank
  only. `results.computeFinal` (`exam:update`, year-wide): verdicts
  `promoted | compartment | detained`; throws "The year's cumulative terms weigh X —
  they must sum to exactly 100…" when weights do not close; students with no term rows
  get no final row at all.
- **Publish.** `publication.publishClass` (`exam:publish`): the exam must be
  `under_verification` or `published`; then per-schedule entry completeness (cohort ×
  components rows, no drafts — "every student needs every component entered (or marked
  absent)") and compute freshness ("Marks changed after the last compute — recompute the
  results before publishing."). The act flips component/subject/term rows to published,
  assembles every student's snapshot, re-issues existing cards (version+1), upserts the
  publication row, writes the audit row, and flips the EXAM to `published` when the last
  class publishes. All-or-nothing per class. **Verification is optional** (ADR-032 §7):
  Entered rows publish fine — the readiness card's verified count is how the principal
  publishes knowingly. `publication.publishExam` (`exam:publish`): loops the scheduled
  classes, each in its own transaction; failures RIDE ALONG —
  `{ publishedClasses, failedClassIds }`, no reasons (gap 23).
- **Correct.** `publication.openRevisionWindow` (`marks:publish`): a guarded UPDATE that
  returns NULL (not an error) when the class is not published or a window is already
  open (gap 27). `publication.closeRevisionWindow` (`marks:publish`): requires state
  `revision_open` (else NULL), then ONE recompute + ranks + re-version of exactly the
  cards whose snapshot changed; returns `{ reIssued }`. `publication.applyRevision`
  (`marks:publish`, owner-resolved to the component result): the LEDGER ROW FIRST (hard
  rule 7; `requestedBy == approvedBy` — no maker-checker in v1), refusals for
  draft/entered ("edit it directly in the grid") and locked; with an open window it
  ledgers + updates the mark and stops (`{ applied: true }`, cards move at close);
  without one it is the auto-window of size one — recompute class + term + ranks and
  re-photograph every changed card of the CLASS, in one transaction. `reason` ≥ 3 chars,
  `revisionType` is a four-value enum. It does NOT check `revisedMarks` against the
  component max (gap 21) — the client must, as in entry.
- **Default holders.** Principal: everything. Vice principal: compute + corrections +
  reads, **no `exam:publish`**. Class/subject teacher: `exam:read` + `report_card:read`
  — the results are visible, every act is hidden. All gating is by permission string
  (`me.get`), never by role.

## Actor, task, context

**Actor:** the principal (publish) and the principal/VP (compute, correct), at a desk in
the days after the exam closes, with the verification counts already green from 7B.
Class teachers open the same screens read-only to see how their class did.
**Task:** "Are the results fair and complete — and are we ready for families to see
them?" Compute, scan the ranked list, fix a wrong mark through the ledger, publish one
class or the exam, and hand out cards. **Frequency:** a few times per term; corrections
are rare but high-stakes. **Stakes:** publication is the door to families — hard rule 8
starts here, and every correction after it is a ledgered, versioned act.

Design read: *the principal's decision surface — the calmest, most deliberate screen in
the app; one decision per screen; numbers that explain themselves.* Dials: variance 2,
motion 1, density 5. Reuses 7B's read-first row language and the confirm-sheet pattern.

## Journeys

### C1 — Compute and review a class
Hub (under_verification or later) → class chip → **Results** row → the class results
screen: readiness strip (entered/verified from `eligibility.readiness`, the stale banner
when marks changed after the last compute) → ranked list — rank · name · total · % ·
grade · result pill (or grade-only rows in the GPA branch) → filters
Failed / Needs attention / Absent → **Compute results** → honest counts → **Compute
ranks** (per section and class).

### C2 — Publish one class
Results screen → **Publish this class** (`exam:publish`) → confirm sheet restates the
readiness counts and says families will see the cards → the server's three refusals
show inline with their own wording → success banner "Published. Families can see Class
6's cards now." → the publication card appears (state + timestamp).

### C3 — Publish every class
Hub options sheet → **Publish all classes** (`exam:publish`) → confirm → result sheet:
"Published 3 classes." and, honestly, "1 failed: Class 7 — open its results to see why"
(the failed ids joined to names; the class's readiness card explains).

### C4 — Correct one published mark
Results → student → **result detail** (term totals, subject rows with pass/absent/exempt
and grace) → tap the subject → the entries sheet (`marks.studentEntries`: every
component of every paper, with its id) → a published row → **Correct this mark** →
sheet: previous value, revised marks (or grade for graded-only), type pills, reason
≥ 3 chars → confirm says the act applies at once and re-issues affected cards →
`applyRevision` → "Corrected. Results recomputed; changed cards were re-issued."
(a draft/entered row instead routes: "edit it directly in the paper screen" with the
link).

### C5 — A correction window
Publication card (`marks:publish`) → **Open correction window** → confirm ("corrections
are ledgered now and apply when you close") → state badge `revision_open` → corrections
during the window say "will apply when the window closes" → **Close window** → confirm →
"Window closed · 2 cards re-issued" (the count is real: `reIssued`) or "No card
changed."

### C6 — Review and hand out the cards
Results screen → **Report cards** (`report_card:read`) → the class set: student ·
version · published-at, "No card" for the cohort's gaps → a card renders natively from
the validated snapshot (widgets in `widgetSequence` order, totals, attendance ribbon,
term-grade areas) → version history on the same screen (v2 replaces v1 · reason) → a
card that fails snapshot validation renders "Card data unreadable — shown on the web"
and never a crash. Print/share: **deferred** (D15) — no `expo-print` in the dev client;
recorded, not silent.

### C7 — The read-only teacher
Same screens, zero act affordances: no compute, no publish, no window, no correct —
hidden, not disabled (the 7B pattern). The result detail reads like a marksheet.

### C8 — Final results (year end)
Exams list header → **Final results** (`exam:update`) → class chips → the year's
verdicts: student · Promoted/Compartment/Detained pill → **Compute final
results** → the weightage refusal verbatim when the year does not close. The
endpoint is the compute itself — its answer carries only
`{ studentId, promotionStatus }` (gap 28: no percentage or grade comes back),
so the row is name + verdict, honestly. Read-only for everyone else (the
header row hides without `exam:update`).

## Wireflow

```
Hub ─ class chip ─ "Results" row ─► Class results ─┬─ Compute / Compute ranks
      │ (under_verification+)                       ├─ Publish confirm ─► banner
      ├ options ─► Publish all ─► per-class result  ├─ Publication card ─ Open/Close window
      │                                             ├─ Report cards ─► Class cards ─► Card view (versions)
      └─ student row ─► Result detail ─┬─ Entries sheet ─► Correct confirm
                                       └─ Card view
Exams list header ─► Final results (year-wide compute, class chips)
```

### Screen 1 — Class results (`/exams/[examId]/class/[classId]`)
```
‹ Class 6 · Unit Test 1                       (stage pill: Under verification)
┌ Readiness ─────────────────────────────────────────────┐
│ Entered 96 of 96 · Verified 88 ▰▰▰▰▰▰▰▰▱▱               │
│ ⚠ Marks changed after the last compute — recompute.     │  (readiness.staleCompute)
│ ⚑ 2 students below the attendance bar (advisory)        │  (belowBar, overridable in 7D)
└─────────────────────────────────────────────────────────┘
[ Compute results ]  [ Compute ranks ]          (exam:update; busy → honest counts)
[ Failed 3 ][ Needs attention 2 ][ Absent 1 ]   (ChipRow filters)
 1  Aarav Mehta        412/500   82.4%  A    Pass
 2  Bhavya Rao         296/500   59.2%  C    Pass
 3  Chirag Das         —        —       —    Not computed
 4  Divya Nair        Absent on 2 papers          Fail   (reason spelled, not just colour)
─────────────────────────────────────────────────────────
 [           Publish this class           ]              (exam:publish; reason line when off)
┌ Publication ───────────────────────────────────────────┐
│ Published 27 Oct · [ Open correction window ]           │  (marks:publish)
│ Window open since 28 Oct · [ Close window ]             │
└─────────────────────────────────────────────────────────┘
 [ Report cards › ]                                      (report_card:read)
```

### Screen 2 — Result detail (`/exams/[examId]/class/[classId]/student/[studentId]`)
```
‹ Bhavya Rao · Class 6                    Rank 12 in class · Rank 3 in 6-B
┌ Term result ─ 296/500 · 59.2% · Grade C · Pass (2 subjects failed) ┐
Mathematics          62/80  B   Pass          ›   (tap → entries sheet)
Physics              48/80  C   Pass          ›
Personality          A      —   Graded        ›
Report card: v2 · 26 Oct · [ View › ]
```

### Screen 3 — Card view (`/exams/[examId]/class/[classId]/card/[studentId]`)
Native render of `reportCardSnapshotV1`: school/student header, widget groups in
`widgetSequence` order (subject rows: marks, grade, absent/exempt), totals band with
ranks, attendance ribbon, term-grade areas with remarks; below, the version history
rows (v2 replaces v1 · "revision window re-issue" / "correction: …"). Unparseable
snapshot → the unreadable notice, never a crash.

## States (every screen)

Initial loading = skeleton rows; empty = "Nothing computed yet — Compute results" (table
null or zero term rows); error = ErrorCard + Retry; offline = the standard offline copy
with Retry (never optimistic — every act waits for the server); permission = the acts
are hidden, the reads stay; submitting = the button's pending state with the confirm
sheet held open until the server answers; success = the 7B banner pattern, then the list
refetches; resume = reads refetch on focus, an in-flight confirm sheet is cancelled
safely (the acts are idempotent or refused server-side); unsaved = the correction
sheet's discards ride FormSheet's guard.

## Component/file plan

- `lib/exam-results.ts` (NEW, pure, tested): row filter predicates (failed /
  needs-attention / absent), rank display (class vs section), publication and promotion
  labels/tones, snapshot parse-guard, version diff summary, correction input validation
  (marks ≤ max, reason ≥ 3, type required).
- `lib/exams.ts`: no changes needed beyond reusing `isResultsStage`.
- `lib/copy.ts`: `exams.results.*`, `exams.publication.*`, `exams.cards.*`,
  `exams.final.*`.
- `screens/exams/results.tsx` + `use-results.ts` (reads + the seven mutations with
  invalidations, the correction apply included), `result-detail.tsx` +
  `entries-sheet.tsx` + `correction-sheet.tsx`, `class-cards.tsx`, `card-view.tsx`,
  `final-results.tsx`.
- Routes: `app/(staff)/exams/[examId]/class/[classId].tsx`,
  `.../class/[classId]/student/[studentId].tsx`,
  `.../class/[classId]/card/[studentId].tsx`, `.../class/[classId]/cards.tsx`,
  `app/(staff)/exams/final.tsx` (static segment wins over `[examId]`).
- Hub: a per-class **Results** row from `under_verification` onward (D13);
  **Publish all classes** in the options sheet (D12).

## Decisions taken under the owner's waiver (reopenable at any walk)

- **D12 — Publish-all lives in the hub options sheet.** An exam-level act next to the
  stage moves; the class screen publishes exactly one class. The web's both-on-one-page
  split is deliberate on mobile: one decision per screen.
- **D13 — The Results row appears from `under_verification` onward.** Compute is legal
  earlier, but the surface needs 7B's verification story to be honest; at `marks_entry`
  the hub's readiness card is the truth. Revisit if the owner wants provisional peeks.
- **D14 — Correction granularity is one component result**, exactly what the ledger
  rows and `applyRevision` address; no whole-subject batch edit exists server-side.
- **D15 — Report cards render natively; print/share is deferred.** No `expo-print` /
  `expo-sharing` in the dev client, and adding them means a native rebuild mid-slice.
  The follow-up is one commit: install both, render the snapshot to HTML, share the PDF
  (the plan's D4 recommendation). Recorded in the ledger as 7C ◐ until then.
- **D16 — Final results is one lean screen** (`/exams/final`): year-wide compute with
  the weightage refusal verbatim, class chips, verdict pills. The annual's deep surfaces
  (7E term grades) are separate chunks.

## Backend gaps added during the design (no changes made)

21. `applyRevision` does not check `revisedMarks` against the component max — the client
    validates as in entry; the server's over-max refusal has no friendly wording (gap 8's family).
22. `revisionImpactSchema` (contracts) is served by NO route — the rank-move impact
    preview ADR-032 §8 imagined does not exist for any client; the web confirms without
    it and so does mobile. Worth one read endpoint someday.
23. `publishExam` returns `failedClassIds` without reasons; the client links each failed
    class's results screen where readiness explains.
24. `cards.classSet` cohorts on ALL enrollments (no status filter) — the list shows
    "No card" rows for leavers; acceptable, but the read could filter.
25. `results.table`'s subject list is exam-wide; the class screen intersects it with the
    class's own schedules from `exam.byId`.
26. `marks.studentEntries` carries ids only — paper/subject names come from `exam.byId`.
27. `openRevisionWindow` returns NULL for "already open" and "nothing published" alike —
    indistinguishable; the sheet's null case reads "Publish the class first."
28. `results.computeFinal` returns only `{ studentId, promotionStatus }` — no percentage
    or grade — so a client that wants to show the annual's numbers next to the verdict
    needs a read endpoint or a wider response. The mobile screen shows name + verdict.

## Acceptance (what the walk must show)

Principal: compute a class → ranks → publish it → the exam flips when the last class
publishes → open a window → correct a mark inside it → close (reIssued counts) → the
class card set renders and the version history shows the re-issue. VP: correct outside a
window (auto-window-of-one) but no publish button exists. Class teacher: everything
read-only. Refusals verbatim: incomplete entry, stale compute, published-exam recompute,
locked correction, weightage sum. Every act offline shows the standard failure, never a
fake success. Filters, GPA-branch grade-only rows, "Not computed" and "No card" states
all real. 1.3× text and TalkBack labels on the three new screens; Android first, iOS
stays parked.


## 7C device walk record (2026-10-27, emulator-5554 against the REMOTE dev DB)

The dev environment moved under this walk: Postgres is now Neon and Redis Upstash
(remote), so every heavy act pays network latency. Walked as org admin; fixtures as
left by 7B (UT3 at under_verification; the owner's earlier data shows Aditi 172 from
the Entrance Test era).

**What the walk verified (all on-device):**
- Results screen: readiness strip (62 of 63 · 34 verified), below-bar advisory line,
  filters, ranked list with real totals, verdict pills, "1 subject" and "Absent on 1
  paper" lines, GPA-ready rows, honest "—" for the roll-less.
- Compute results + compute ranks: server counts honest ("Ranks updated for 15
  students."), banner pattern.
- Publish refusals, verbatim inline in the sheet: incomplete entry (Aditi's draft
  Written row) and stale compute (the SQL fix landed after the compute).
- Publish success: exam flipped to Published (stage track, Home card dropped it, list
  moved it to the Published segment), publication card "Published 27/10/2026".
- Correction outside the window (auto-window-of-one): the ledger sheet's direct-note
  wording, validation ("Choose a reason type"), then "Corrected. Results recomputed;
  changed cards were re-issued." — totals 128.5 → 133.5, rank 9 → 5, card v2 → v3.
- Card view + version history: v4 "revision window re-issue" / v3 "correction:
  Rechecked the script totals" with real change diffs ("Total 128.50 → 133.50 · Rank
  in class 9 → 5 · Mathematics 78.50 → 83.50"), v2 "re-issue", v1. The whole
  hard-rule-7 chain on one screen.
- Correction window: open confirm, the publication card's "Correction window open
  since…", the entries sheet's window note, then Close window → the class recomputed
  (Aditi 138.5 with the 18 mark) and the state is re_issued in the DB.

**Findings fixed during the walk:**
1. Timestamps rendered as em dashes on the publication card — `formatIsoDate` only
   accepts date-only strings; `formatTimestampDate` added and the four screens
   switched to it.
2. Mutation deadline: compute measured ~45–75 s server-side against Neon; the 15 s
   global deadline aborted the client while the work landed ("Couldn't reach the
   server" after real success). Mutations now take a 120 s leash (`with-timeout.ts`);
   reads keep 15 s. The real fix is server-side — gap 29 below.

**Findings recorded, not fixed:**
29. The compute's per-student loop is sequential and slow on a remote DB (~45–75 s
    for 17 students); publish ≈ 60 s, window close ≈ 100 s. Needs server-side
    batching; the client leash is a bandage, and even 120 s raced the compute once
    (the false-failure-while-successful case was hit twice).
30. Post-publish readiness is misleading: published rows are not counted as verified
    ("Entered 63 of 63 · 0 verified") and the stale banner says "Compute again before
    publishing" on a class that is already published (where the server refuses
    recompute). The readiness read needs post-publish semantics.

**Not walked (recorded, do not claim):** the vice-principal split (correct without
publish), the read-only teacher, the offline act failure, 1.3× text, TalkBack, iOS.
Fixture left in the dev DB: UT3 published with a 4-version card on Aditi (walk data,
labelled "(walk)"); the walk's SQL fixes touched only walk-fixture rows and the
flip of UT3 to counts_toward_term_result. Walk scripts deleted.

---

# Chunk 7D — Exam lifecycle + blueprint (design addendum, 2026-10-27) — BUILDING

Owner waiver stands ("no need to get review from me. finish the 7D"); decisions below
are taken under it, labelled D17–D21, reopenable at any walk. Where this addendum and
the short "7D" sketch above differ, this wins.

## What the server actually does (read from `exam-config.service.ts` / `exam-marks.service.ts`, not assumed)

6 endpoints close here (`exam.create`, `exam.update`, `schedules.save`,
`components.save`, `eligibility.recompute`, `eligibility.override`); the stage moves
are 7A's and stay.

- **`exam.create`** (`exam:create`): the year is DERIVED from the term — the client
  never sends it. `mock`/`test` force `countsTowardTermResult: false` server-side; a
  supplementary/improvement exam REQUIRES `linkedExamId` (contract refine). Term must
  belong to the caller's school and year ("Term not found in this school and year.").
- **`exam.update`** (`exam:update`): partial; term/type/linked-exam are NOT editable
  (the contract omits them). Weight-in-term, the counting flag and the negative-mark
  floor freeze the moment ANY component result exists — "This exam already has marks —
  its weight in the term can no longer change." The counting flip is frozen in BOTH
  directions; the negative floor freezes independently.
- **`schedules.save`** (`exam:update`): frozen once entry opens ("Marks entry has
  opened — the exam blueprint is frozen."); a class whose schedules carry marks cannot
  be restructured ("Marks exist for this exam's schedules…"). Removal is EXPLICIT per
  class (`removeClassIds`) and cannot be mixed with saving that class. Identity is
  (class, subject, section): an edit updates in place, only vanished identities are
  deleted. `passMarks: "0.00"` means not-yet-snapshotted default.
- **`components.save`** (`exam:update`): refuses a locked schedule ("This schedule is
  locked — marks entry has begun.") and any existing marks. Weightages must sum to
  exactly 100 ("Component weightages must sum to exactly 100 (currently X)."). The
  save REPLACES all components of the paper and snapshots the subject pass mark from
  the weighted default while the paper still carries the un-snapshotted default.
- **`exam.transition → scheduled`** (7A's move, preconditions that matter for 7D's
  screens): at least one paper; every paper at least one component ("Every scheduled
  paper needs at least one component — add the parts (e.g. Theory, Internal) for
  X, Y."); strict coverage ("Coverage incomplete: N counted subject(s)…"); counting
  exams of the term must weigh exactly 100 ("Counting exams of this term weigh X —
  they must sum to exactly 100. Adjust the weightages first.").
- **`eligibility.recompute` / `eligibility.override`** (`exam:update`): the recompute
  walks the scheduled classes' cohorts, reading the term attendance row (annual as
  fallback) against the year's pass criteria, and upserts one row per student. The
  override is cohort-bound and scope-checked; it records the verdict, the reason
  (≥ 3 chars), who and when.

## Actor, task, context

The office — whoever holds `exam:create`/`exam:update` (principal, VP, org admin) —
setting up next term's exams at a desk, a week or two before they run. Teachers never
see these acts. **Task:** "Create the Unit Test cycle, give every class its papers
and parts, and keep the attendance bar advisory honest." Frequency: a handful of
times per term, then only edits. **Stakes:** the blueprint is the denominator of
every result that follows — freezing rules exist because a late change restates
history, so the UI's core job is making the freeze legible, not fighting it.

Design read: *the calm admin form — the Step 1B form kit (FormField, ChoicePills,
SwitchRow, DateField, SelectField), bottom sheets for pickers, one decision per
screen, freeze reasons printed where the frozen control sits.* Dials: variance 1,
motion 1, density 5.

## Journeys

- **D1 — Create an exam.** Exams list → **New exam** row (`exam:create`) → the form:
  name, term picker (the running session's terms), type pills, weightage, counted
  switch (auto-off and locked for mock/test with the server's reason printed),
  negative-marking switch; a supplementary/improvement pick demands the linked exam.
  Save → the new exam's hub at Draft.
- **D2 — Build the blueprint.** Hub (draft/scheduled, `exam:update`) → **Papers &
  components** → the setup screen, grouped by class: **Add class** → class picker →
  the class's mapped COUNTED exam-mode subjects become paper rows with the web's
  prefilled defaults (09:30 · 180 min · sequential dates from the first paper day)
  and the CBSE default component (Theory 100, pass 33, weight 100, mandatory).
  Per-paper row edits date/time/duration/venue and the pass-mark override; Remove
  class behind a confirm; Save batches the class's grid — the freeze/marks refusals
  print inline.
- **D3 — Edit a paper's parts.** Paper row → the components editor: one row per part
  (name, max, pass, weight, mandatory switch), add/remove, a running weight sum with
  the gap to 100 shown before the save, the pass ≤ max check client-side. Frozen
  (locked or marks exist) → read-only rows with the reason.
- **D4 — Edit exam details.** Hub → **Edit exam**: name, weightage, counted flag,
  negative-marking — each frozen control disabled with its reason once marks exist;
  term and type are facts, shown uneditable.
- **D5 — Attendance eligibility.** Hub → **Attendance eligibility** → the screen:
  recompute button with the honest count, Below-bar / Allowed groups, per-student
  override sheet (allow or rescind, reason required), **Allow all** with one shared
  recorded reason (the web's parity).
- **D6 — The freeze.** At `marks_entry` and beyond the setup screen reads papers
  read-only with the server's freeze line; the same for locked papers' components.
  No dialog fights the freeze — the screen just stops offering the acts.

## Wireflow

```
List ─ New exam ─► Exam form ─► hub (draft)
Hub (draft/scheduled) ─ "Papers & components" ─► Setup ─┬─ Add class ─► Class sheet
                                                        ├─ paper row edits (date/time/venue/pass)
                                                        ├─ Remove class ─► confirm
Hub options ─ Edit exam ─► Exam form (edit)             └─ paper ─► Components editor
Hub options ─ Attendance eligibility ─► Eligibility ─ student ─► Override sheet
```

## Files

`lib/exam-setup.ts` (pure, tested: paper generation from mappings, weight-sum and
pass≤max checks, the frozen-field logic, the CBSE default row) + tests; `copy.ts`
(`exams.form.*`, `exams.setup.*`, `exams.eligibility.*`); `use-exam-form.ts`,
`use-setup.ts` hooks; screens `exam-form.tsx`, `exam-setup.tsx`,
`components-editor.tsx`, `eligibility.tsx`; routes `/exams/exam-form` (static),
`/exams/[examId]/setup`, `/exams/[examId]/setup/[scheduleId]`,
`/exams/[examId]/eligibility`; the list's New exam row and the hub's three new
options entries.

## Decisions (waived, reopenable)

- **D17 — One setup screen per exam** (the web's "papers section" parity), not a
  wizard: all classes' papers on one scroll, grouped by class.
- **D18 — "Add class" generates papers from the class's mapped counted exam-mode
  subjects** with the web's defaults (09:30 · 180 min · sequential dates); term-grade
  subjects are never papers.
- **D19 — New papers carry the CBSE default component** (Theory 100 / pass 33 /
  weight 100 / mandatory) exactly as the web prefills, so scheduling never trips the
  empty-paper refusal by surprise.
- **D20 — The eligibility screen exists from `marks_entry` onward** (the transition
  recomputes there anyway) and "Allow all" loops the per-student override with one
  shared reason.
- **D21 — The edit form renders frozen controls disabled with the reason line** once
  marks exist; term and type are always facts, never controls.

## Backend gaps (design-time)

31. `exam.create` returns the bare row; the client navigates with the id only —
    enough for the hub, but a create-that-returns-the-hub-shape would save a read.
32. The eligibility override is one call per student: "Allow all" is a client-side
    loop (the web's choice too). A batch endpoint would make it atomic; not built.

## Acceptance (what the walk must show)

Create an exam → add a class (papers generated with defaults) → edit a paper's
date → open the components editor, watch the weight sum, save → schedule the exam
(all four preconditions; each refusal verbatim: empty papers, coverage, weightage
sum) → eligibility recompute + override + allow-all. Freeze: at marks_entry the
setup screen is read-only with the freeze line; a locked paper's editor likewise.
Every refusal prints inline; nothing optimistic.

---

# 7F build record (2026-10-28)

Built on `feat/mobile-exams-7a` on top of 7E (`61b6c93`, unpushed). No backend change: the 14
procedures in §7F already existed and were read from `exam.router.ts` / `exam-config.service.ts`
before any screen was written.

## What shipped

- **Entry + hub.** One `LinkRow` on the Exams list ("Grading setup", `testID` `exams-grading`),
  gated on `exam:update || exam:create`, rendered in the empty state too. The hub answers the three
  questions with live counts: types ("4 types · 2 in use"), scales ("1 scale · Demo Grading Scale is
  default"), rules ("2026-27 · School default + 1 class rule").
- **Subject types** (`/exams/setup/subject-types`): list + `FormSheet`. The sheet is name, card
  order, the three behaviour controls, and the plain-language sentence the flags produce. An in-use
  type hides the behaviour controls behind a lock notice and still saves name/order. The CBSE
  starter set sits behind a confirm that says it adds only what is missing, and reports the count.
- **Grading scales** (`/exams/setup/grading-scales`): list rows stack name → chips (`Default`,
  `Locked — in use`) → the band sentence; a locked scale is a fact, not a control. Pushed band
  editor (`new`, `[scaleId]`) with direct min/max entry, a live 0–100 coverage strip, per-row
  validation, "Add band" prefilling the largest uncovered interval, removing a band extending its
  neighbour, and "Check a score" resolving against the *unsaved* bands.
- **Pass criteria** (`/exams/setup/pass-criteria`): the school default plus per-class overrides,
  the "In short" read-back above the controls, a scope picker offering only uncovered scopes, the
  must-pass multi-select, and grace/compartment caps that are required exactly when their switch
  is on. A saved scope cannot move (the unique indexes name it), so the editor renders it read-only.
- **Pure layer.** `lib/grading-scale.ts` (37 tests), `lib/pass-criteria.ts` (27),
  `lib/subject-types.ts` (17). Band contiguity mirrors the server exactly: shared edges are
  contiguous, the higher band owns a boundary value, only gaps and overlaps are refused — the note
  under the coverage bar says so in words ("91% counts as A1").
- **Shared fix.** `ScreenFrame` now pads for the IME on Android as well (`behavior="padding"` plus
  `flex: 1` on the scroll body). On the pinned SDK Android is edge-to-edge, `adjustResize` no longer
  shrinks the window, and every form's sticky footer sat behind the keyboard. Re-walked on the New
  exam form, the scale editor and the pass-rule editor: the footer rides above the IME and the
  focused field stays reachable.

## Decisions taken during the build (each reopenable)

- **The editors are pushed screens, the subject type is a sheet.** A scale is 1–10 band cards and a
  pass rule is 9 controls; both need a scroll body, a sticky save and an unsaved-work guard.
- **Save stays enabled and reveals the reason.** Nothing is red before the first press; the footer
  repeats the first problem only after a save attempt, exactly like `fees/setup-heads.tsx`. A
  disabled button with no explanation was the failure mode the owner flagged.
- **Action results live in the footer, not the top of the body.** "Make school default" and
  "Retire" are at the bottom of a long form; a notice at the top is off-screen exactly when it is
  needed. The scale editor's footer now carries error → notice → validation caption in that order.
- **A new pass rule opens as a copy of the school default.** The only missing thing is the scope,
  and the empty picker already says so, so the form does not open on a red caption.
- **The must-pass multi-select is a sheet with the counted subjects only**, because a must-pass
  subject that is not counted cannot fail anything.
- **The list row names must-pass subjects** (up to three, then `+N`; "1 must-pass subject" when the
  subject read failed). "At least 5 subjects · Must pass Mathematics · Grace 5 / 15 · Compartment 2"
  reads as the policy it is.

## Walk record — emulator-5554, Metro :8081, API :4000, 2026-10-28

Admin, session 2026-27, Demo Public School — Main Campus.

- Hub: all three counts true; the default scale named; the row opens from the Exams list.
- Subject types: list order, "In use" chips, the locked sheet (behaviour controls replaced by the
  reason, name and order still save), create → sheet → save, retire behind a confirm.
- Scales: list row, locked editor (bands read-only, name saves, make-default still offered), the
  new-scale flow end to end (blank → one 0–100 band → split, coverage strip, gap and overlap
  refused on the row *and* above the save, "Check a score", unsaved guard on back), make-default →
  "Default scale switched." in the footer → restored the Demo default, and retired the test scale.
- Pass criteria: list, create (Class 6 override, min 5, compartment 2, must-pass Mathematics), the
  live "In short" card while typing, the scope sheet listing only uncovered scopes, the single
  remaining scope auto-picked, the must-pass sheet, the edit flow with the read-only scope, and the
  row meta naming the subject.
- Keyboard: New exam form, scale editor and pass-rule editor with the IME open — footer visible,
  no double padding, focused field reachable.

Findings fixed during the walk: the pristine new-rule form painted a red caption before any press;
the grace-total field had no error slot; the retire body repeated a sentence it could not need; the
scale editor's status line was at the top of a long form (moved to the footer); the band sentence
ran label and range together (ranges dropped to regular weight); the list row did not name the
must-pass subject.

## Not walked (say so, do not claim)

iOS entirely; the starter-set confirm on a school that already has one of the three types (the call
is idempotent and unit-covered, the sheet copy not re-read); a 10-band scale at 1.3× text; the
coverage strip at 1.3× (it is decorative, the sentence carries the meaning); TalkBack on the new
rows and sheets; a second admin editing the same scale (no `expectedUpdatedAt`, gap 43).

## Fixture and environment (left in the dev DB)

Demo school, session 2026-27: one grading scale ("Demo Grading Scale", default, locked), four
subject types, and a deliberate Class 6 pass-criteria override (min 5 subjects, grace 5 / 15,
compartment 2, must-pass Mathematics). The test scale created during the walk was retired. No
`tmp-*` script was added for this chunk.

## Gates

Mobile `tsc --noEmit` clean; `eslint` on the new and changed files: 0 problems; jest 37 suites /
587 tests (+81: grading scale 37, pass criteria 27, subject types 17). Root `pnpm check-types`:
every package green except `@repo/api`, whose only errors are in the pre-existing untracked
`scripts/tmp-seed-fees-demo.ts`.

## Backend gaps added during the build

None new — 39–46 in §7F were written at design time and all still hold. Two are worth repeating
because the walk felt them: **40** (no scale clone: a policy fork re-types every band) and **41**
(no pass-criteria delete: a mistaken override can only be edited into something harmless).

## Commits (hand-off — local only, never pushed)

The owner asked for small local commits on the branch. Suggested split if the grouping needs to be
redone with `git add -p`: (1) pure logic + tests, (2) `copy.ts` + the `ScreenFrame` keyboard fix +
the icon, (3) the eight routes and the hub, (4) subject types, (5) scales + band editor,
(6) pass criteria, (7) docs.

---

## UX revision (2026-10-29) — UI-only pass, owner-directed

The owner reviewed the finished 7A–7F flow: "not liking the UX and flow… UI changes which
will improve UX are welcome." Scope held to UI-layer edits; no endpoint, route, permission
or schema change, and the marks-entry rhythm untouched.

1. **Exams list leads with exams** (`screens/exams/index.tsx`): the exam cards follow the
   segment bar directly; "New exam", "Term grades", "Final results" and "Grading setup"
   moved under a "More tools" label below the cards (order: New exam, Term grades, Final
   results, Grading setup; the New exam row hides while the list is empty). Creation also
   gets a `+ New` header action (gated `exam:create`, hidden without read) and the
   session-empty state carries a "Create the first exam" button. Copy: `list.toolsLabel`,
   `list.createFirst`, `form.newAction`.
2. **Class results wears two shapes** (`results.tsx`): once the class is published
   (`publication.list` state non-null) the publication card and the Report cards row lead,
   the ranked list becomes reference, the publish footer disappears, and the readiness read
   is not requested at all (gap 30 masking — the read reports "0 verified" + stale on a
   published class). Pre-publication the readiness strip and compute stay, and "Compute
   results" + "Compute ranks" are one button ("Compute results & ranks") that runs compute,
   then term ranks, and answers "Computed N students. Ranks updated for M." — a ranks
   failure downgrades the banner to caution instead of hiding the compute success. While
   either runs, a neutral notice says it can take a minute or two and that the list below is
   the last compute. Copy: `results.computeAll`, `computingTitle`, `computingBody`.
3. **Result detail names its publication state** (`result-detail.tsx`): a muted line under
   the term totals — Published/Re-issued/Correction window open since {date} — so the
   corrector knows the window state before opening any subject. Reuses the publication
   copy; no new strings.
4. **Final results survives navigation** (`final-results.tsx`): a module-level cache keyed
   organization+year keeps the last successful compute so returning to the screen shows the
   verdicts (labelled "Computed {date}" with "Recompute for the latest verdicts") instead of
   a roster of "Not computed"; the button reads "Recompute final results" once anything is
   shown. This is a bandage over gap 28 (the compute response is the only source of
   verdicts; no read endpoint), not a fix.

Walk (emulator-5554, 1080×2400, admin, remote Neon dev DB, session 2026-27): the list's new
order, `+ New` and More tools group; UT3 (walk) published class results — publication card
with "Open correction window", Report cards row, no readiness, no publish footer; result
detail's "Published 27/10/2026" line; UT1 (walk) hub — the verification move refused
inline ("Some marks are still missing…"), leaving the fixture untouched. Screenshots in
`apps/mobile/.expo/walk/ux-*.png`.

Not walked, owed: the pre-publication results shape with the merged compute button and the
computing notice (no fixture exam sits at under_verification with complete entry — UT1's
move was refused, and no marks were fabricated for a walk fixture); the final-results cache
round-trip (`results.computeFinal` failed twice at ~2 minutes with the friendly error in
this environment — pre-existing server-side condition in the Neon-latency family; the error
path itself was walked); the empty-state create button; iOS; TalkBack; 1.3× text.

Gates: mobile tsc clean, jest 37 suites / 587 tests, lint 0 errors; root `pnpm check-types`
green except the pre-existing untracked `apps/api/scripts/tmp-seed-fees-demo.ts`.

New backend gap: none — but 28 and 29 graduate from "recorded" to "felt": the final-results
dead end and the two-minute compute are exactly what the owner's UX complaint pointed at.

### UX revision, round 2 (2026-10-29, later the same day)

The owner pushed back on round 1's timidity ("i expected better… many places we can do"). Five
more UI-only changes, same constraints:

- **Hub, one Results row per class** (`hub.tsx`): the single active-class row became a list —
  every class gets `Results — {class}` with its publication state as the detail line
  (Published / Re-issued / Correction window open since {date} / "Not published yet") from the
  existing `publication.list` read. The publish-all follow-up ("Not published: Class 7") lands
  on the right screen without chip-switching.
- **The teacher's hub now carries progress** (`hub.tsx` + `paper-card.tsx`): the per-paper
  counts read reviewers already pay for is enabled for the CALLER'S OWN papers during entry
  (bounded by teaching assignments). Own PaperCards show "Entered N of M" → "All entered", and
  a pinned "Continue entering · {subject} · N entries left" row deep-links to the first own
  paper with gaps in schedule order. Reviewers keep their view; nobody else pays.
- **Component completion on the marks grid** (`paper.tsx`): finished components get a ✓ in the
  component bar, and when the active component has no blanks a handoff chip offers
  "{Component} is complete. / Next: {other} · N to enter" — one tap switches component and
  resets the filter. Multi-component papers no longer cost a silent extra roster pass.
- **Final results count line** (`final-results.tsx`): "12 promoted · 2 compartment · 1
  detained" derived client-side from the verdicts (fresh or cached); zero segments omitted.
- **Report-cards search** (`class-cards.tsx`): a client-side name filter over the already-loaded
  roster, reusing the students screen's search-field pattern; empty result gets its own state.

Walked on emulator-5554 (admin): the per-class Results row with its publication detail on UT3;
the report-cards search end-to-end ("jai" → one row + clear button); the uniform login-refusal
copy while attempting a teacher sign-in (subject-teacher@demo-trust.test and
teacher@demo-trust.test both refused with the seeded passwords — the teacher-gated pieces
(Continue row, entry progress, ✓ + handoff) share the reviewer counts read that IS walked, but
need a teacher session with a teaching assignment to be seen on-device). Also: Metro died
mid-walk and the dev client hit the known `UnsatisfiedLinkError` teardown race on force-stop —
recovered by restarting Metro and relaunching; both are environment, not app.

Gates re-run after round 2: mobile tsc clean, jest 37/587, lint 0; root check-types green
except the pre-existing untracked `apps/api/scripts/tmp-seed-fees-demo.ts`.

### UX revision round 2 — the owed walk, completed (2026-10-29, same day)

The verifier's bar was the repo's own: a UI slice is not done until its screens render on a
phone. The teacher session was unblocked by reading the seed (`Password123!` for all demo
users) and proving the pair against the running API with curl — the earlier on-device failures
were adb input mangling, not wrong passwords. `subject-teacher@demo-trust.test` owns BOTH the
single-component Mathematics 6-A paper and the class-wide two-component Physics paper of UT1
(walk), which made every teacher-gated piece reachable.

Walked on emulator-5554 (subject teacher, UT1 at marks_entry):

- **Hub, teacher view:** the pinned "Continue entering — Mathematics · 6 entries left" row;
  "Your paper" pills on Mathematics and Physics; live entry lines "Entered 6 of 12" /
  "Entered 1 of 34"; nothing on Personality ("Not your paper"). The Continue row deep-links
  into the paper.
- **Marks entry:** typed 11 Theory marks for section 6-A through the IME-Next rhythm
  (focus auto-advanced, save queue drained to "All changes saved").
- **Component ✓ + handoff:** with Theory complete the bar shows "Theory /40 ✓" (Practical
  unmarked), Missing 0, and the chip "Theory is complete. / Next: Practical · 12 to enter";
  tapping it switched to Practical, dropped the chip, and the rows flipped to "Theory: N"
  context with empty /10 inputs.

Two walk-fixes came out of it (both in the round-2 code, found live):

1. **The ✓/handoff computation was stale** (`paper.tsx`): the hand `useMemo` over the draft
   store kept its first (pre-load, empty-roster) result under the React Compiler, painting ✓
   on unfinished components while the non-memoized summary on the same screen said Missing 11.
   The blanks map is now recomputed every render (the file's own `summarizePaper` idiom) and
   gated on `draft.loaded && roster.length > 0` — `studentsMatching` skips students without a
   draft cell, so an unloaded draft must read as "unknown", never as zero blanks.
2. **The hub's refresh skipped the counts** (`hub.tsx`): pull-to-refresh refetched `detail`
   only, so after a round of typing the hub kept showing pre-entry numbers ("Entered 1 of 34"
   while 11 saves had landed). `onRefresh` now also invalidates `exam.marks.entry`, and the
   same pull showed "Entered 12 of 34".

Fixture note: UT1 Physics Theory for section 6-A is now fully entered (12 cells, values
19–35) and the hub counts reflect it; UT1 stays at marks_entry.

**Final results is now precisely diagnosed:** `results.computeFinal` failed three times on
device (~2 min each, the friendly "Couldn't compute the final results" banner — the error path
itself walked thrice). The DB shows `student_final_results` untouched since the Oct 27 walk
(2 stale "promoted" rows), so the server fails before writing — this is a server-side fault
in the gap 28/29 family, not the 120 s client leash alone. Until the compute succeeds, the
verdict count line and the cache round-trip cannot render real data on any client.

Remaining owed from the whole revision: the pre-publication results shape (needs an exam at
under_verification with complete entry — UT1 now has Physics Theory complete for 6-A but
Mathematics is still 6 of 12 and Personality untouched), the empty-state create button, iOS,
TalkBack, 1.3×.

Gates re-run after the two fixes: mobile tsc clean, jest 37 suites / 587 tests, lint 0 errors;
root `pnpm check-types` green except the pre-existing untracked
`apps/api/scripts/tmp-seed-fees-demo.ts`. Walk screenshots: `apps/mobile/.expo/walk/ux-60…75`.

### UX revision round 3 — the "find more" audit (2026-10-29, same day)

The owner asked for more. A screen-by-screen audit of the surfaces the earlier rounds had not
re-read (entry-row, student-sheet, review-panel, verify-sheet, exam-setup, use-exam-data,
eligibility, components-editor, result-row) plus fresh eyes on the revision's own code found
four real defects, all fixed; one suspected defect was a misdiagnosis and was reverted before
it shipped.

1. **Class results flashed the wrong shape while the publication read was in flight**
   (`results.tsx`): `isPublished` starts false, so a PUBLISHED class briefly rendered the
   pre-publication shape — readiness strip and the publish CTA — until `publication.list`
   landed. The screen now waits for the read: `publicationKnown` gates both branches and the
   publish footer (unknown renders neither), and the readiness fetch is not started for a
   class that may already be published.
2. **Readiness "Couldn't load" while merely loading** (`results.tsx`): with the readiness
   query enabled, `readiness.data` is undefined during the fetch and the card printed the
   load-error copy. The card renders nothing while `readiness.isPending`.
3. **Final-results count line mixed year-wide numbers into a class list**
   (`final-results.tsx`): the verdicts map is year-wide, so "12 promoted" above a Class 6
   roster counted other classes. The counts now intersect the verdicts with the active
   class's roster (already in hand from the enrollment read).
4. **Exam setup's unsaved-changes guard hung on a `touched` flag** (`exam-setup.tsx`): add a
   class then remove it — or edit a field back to its original value — and leaving was still
   blocked with nothing pending; the flag also false-positived off any server row carrying a
   pass override. `dirty` is now a real diff of the drafts against `exam.byId`'s schedules
   (new rows, or any field diverging), and the `touched` state is gone.
5. **The eligibility override sheet hid the server's refusal** (`eligibility.tsx`): the apply
   failure wrote to the screen-level error Notice, which renders BEHIND the still-open sheet —
   the user saw nothing. The refusal now lands in the sheet's own problem slot.

**Reverted, recorded honestly:** a suspected review-mode dead tap (sheet lookups against the
section-narrowed roster while the panel lists the full roster) turned out to be impossible —
the panel renders `scope.students`, which is the same partition the entry `roster` narrows to,
so the lookup always matched. The on-device "no sheet" that suggested it was fast-refresh
residue after many hot reloads: a cold restart opened the sheet from the same tap
(`ux-103`). The paper.tsx navigation change was reverted; the shipped code keeps 7B's
section-scoped sheet navigation.

Gates after round 3: mobile tsc clean, jest 37 suites / 587 tests, lint 0 errors; root
`pnpm check-types` green except the pre-existing untracked
`apps/api/scripts/tmp-seed-fees-demo.ts`. Walk screenshots `ux-90…103` (review scope line,
section sheet, the student sheet on a cold start).


---

# Chunk 7G - Annual results (design addendum, 2026-10-30) - APPROVED ("do whatever is best"), BUILT; see "7G build record" below

Backs onto **ADR-053** (accepted and built, same day) - read it first; this addendum is only the
phone side and the build order. It replaces the lean year-wide screen of C8/D16
(`/exams/final`, gaps 28 and 29). **Built the same day** - see the 7G build record at the end.

## What the server does today (read from code, not run)

- `results.computeFinal` ({ academicYearId }, `exam:update`) loops every student of the
  year sequentially, no transaction, returns `{ studentId, promotionStatus }` only. On
  device it failed three times at about two minutes and wrote nothing (the table is
  untouched since Oct 27) - a server-side fault, cause not yet isolated. The term class
  compute it sits on is separately measured at 45-75 s for 17 students (gap 29).
- The year is decided by `terms.result_mode` + `terms.weightage`; the weights must total
  100 or the whole run throws part-way; class pass rules are ignored; a graded-only class
  is detained; ranks are never written.
- No annual published card can be written; `cards.classSet` already tolerates a null term.
- `/exams/final` shows name + verdict pills from a module-level cache and, after a year-wide
  compute, a year-wide count ("12 promoted" above a Class 6 list - walk finding).

## Actor, task, context

The principal or exam head at year end, at a desk or between meetings, on a phone. One
class at a time. Two questions, in this order: *is this class safe to publish?* and *who is
held back, and why, in words I can say to a parent?* A teacher with `exam:read` reads the
same screens with every act affordance hidden (the 7B pattern). The numbers are public to
parents the moment they publish, so the screen's job is certainty, not speed.

## Information architecture

```
Grading setup (7F hub)
  + Annual rules  ->  list  ->  editor            (new; sits beside Pass criteria)
Exams list header -> Final results  ->  class list (rework of /exams/final)
        class row -> Class annual  ->  Student annual  ->  Annual card
```

Routes (all under `app/(staff)/exams/`): `final.tsx` (rework), `final/[classId].tsx`,
`final/[classId]/student/[studentId].tsx`, `final/[classId]/card/[studentId].tsx`,
`setup/annual-rules.tsx`, `setup/annual-rules/new.tsx`, `setup/annual-rules/[policyId].tsx`.

## Journeys

- **G1 - First time (school default).** Grading setup -> *Annual rules* ("Not set up") ->
  Add rule -> pick *How the year is counted* -> tick terms (weights if weighted) -> *Subject
  pass mark* -> *Promotion rules: same as term pass rules* (default on) -> Save.
- **G2 - One class counts differently.** Add rule -> Applies to a class (the editor starts
  from the default's values - an override is a delta, not a blank page) -> change -> Save.
- **G3 - Generate a class.** Final results -> class row -> readiness card says *Ready* ->
  **Generate** -> the list fills: % - verdict - rank per student -> chips *Detained*,
  *Compartment*, *Flagged* narrow it.
- **G4 - Blocked.** Readiness lists what is missing in plain words ("Maths - 2B - Term 2:
  3 students have no result"); each line opens that class's term results screen, where
  the 7C readiness already explains how to fix it. Generate stays enabled (it is a
  preview); Publish says why not.
- **G5 - Why is she detained?** Student row -> a verdict card in words ("Failed Maths 31 and
  Science 29 against a 33 pass mark. Compartment allows 2 subjects, so: Compartment in
  Maths and Science.") above the subject x term grid.
- **G6 - A late joiner.** Row carries *2 of 3 terms*; the detail says "No Term 2 paper -
  the year was counted from Term 1 and Term 3 (weights 29% and 71%)".
- **G7 - Publish a class.** Publish -> confirm sheet (counts: students, held back, flagged,
  renormalized) -> banner. A published class shows *Published*, Generate is gone, and a
  *predates a Term 2 correction* note appears if an input changed afterwards.
- **G8 - The read-only teacher.** Same screens, no Generate/Publish/Add rule.

## Screens

### 1. Annual rules list (`/exams/setup/annual-rules`)
Per running session, the pass-criteria list shape. Row title: *School default* or the class
name (quiet **Default** chip). Meta 1: `Weighted - T1 20 - T2 30 - T3 50` / `Best 2 of 3
terms` / `Term 3 only` / `Average of 3 terms`. Meta 2: `Subject pass 33% - Uses the term pass
rules` / `Own rules: 5 of 6, compartment 2`. Header **Add rule** (`exam:create`) hidden when
every scope is taken. Empty: *No annual rules for this session - add the school-wide
default; classes can override it later.* The 7F hub gains a row **Annual rules**
(`2026-27 - Weighted - 3 terms` / `Not set up`).

### 2. Annual rules editor (`new` / `[policyId]`)
Title *New annual rule* / *Annual rule - Class 6*. Create only: **Applies to** (ChoiceSheet:
School default if free, else classes without a rule); edit prints the scope.
- **In short** card, live, three sentences: how the year is counted / what passes a subject
  / what decides promotion.
- **How the year is counted** - ChoiceSheet with the five labels (ADR-053 §2), each with a
  one-line example. Below it a term list: tick a term; weighted shows a weight field per
  ticked term and a live chip `Total 100 ✓` / `Total 90 - must be 100`; best-N shows a
  stepper (1..ticked); single-term shows radio rows. Terms come from the session's terms.
- **Subject pass mark** - percent field, help *A subject passes when its year score is at
  least this.*
- **Promotion rules** - switch *Same as the term pass rules* (default on) with the
  resolved summary underneath (`Pass 5 of 6 - Compartment 2`). Off reveals the pass-criteria
  fields (min subjects, must-pass multi-select, compartment, attendance) prefilled from the
  resolved rules.
- Footer **Save rule** + caption with the first invalid field; enabled only when changed;
  `useUnsavedChanges`; save refusals render as a critical Notice with the form intact.
- No grace and no absence/exemption switches: they belong to marks, not the year (ADR-053 §5).

### 3. Final results (`/exams/final`, rework)
Session header. **One row per class** (replaces the year-wide verdict map and its year-wide
count): class name - status chip - one meta line. Chips: *Not generated*, *Blocked (2)*,
*Ready*, *Draft - generated 2h ago*, *Stale*, *Published*. No year-wide Compute button; the
action lives on the class. Pull to refresh.

### 4. Class annual (`/exams/final/[classId]`)
- Header class name; subtitle = the policy sentence (taps through to Annual rules).
- **Readiness card.** Blockers (critical Notice, one line each, each pressable) and warnings
  (neutral: *3 students counted from fewer terms - 1 subject has no paper in 2B*). Empty
  readiness reads *Ready - every paper that should have a result has one.*
- **Action bar:** **Generate** (`exam:update`; label *Generate again* with a draft) and
  **Publish** (`exam:publish`; disabled with its reason on the button's caption).
- **List.** Section chips (as the 7C class screen), then rows: name, roll, `%`, grade, rank,
  verdict pill, and a quiet `2 of 3 terms` tag when renormalized. Filter chips *All /
  Detained / Compartment / Flagged*. Count line is class-scoped and filter-aware.
- Generating shows `Generating 2B - 41 students...` as a single indeterminate state; a lost
  connection ends in *Could not confirm - check the list, generating again is safe*.

### 5. Student annual (`/exams/final/[classId]/student/[studentId]`)
Verdict card in words (G5) -> grid, one row per subject: `T1 T2 T3 | Year | Pass` with the
terms used in the year bolded and the others dimmed (best-N shows which two counted);
exempt subjects read *Excused*; graded-only read the per-term grades -> attendance (year) ->
ranks (section, class) -> **View card** (when generated) -> renormalization note (G6).

### 6. Annual card (`.../card/[studentId]`)
The V2 snapshot rendered in the existing card view (a sibling component, not a fork of
the V1 layout): subjects with the term strip, totals, verdict, ranks, attendance, and the
one-line policy summary. Honours the same *Draft preview - not yet published* banner
as the term cards.

## Every surface's states

| State | Final results | Class annual | Rules list/editor |
|---|---|---|---|
| Denied (`exam:read`) | lock + who to ask | lock | row hidden |
| No branch / no session | school or session empty state | not reachable | empty state |
| Loading | class-row skeletons | readiness + list skeletons | row skeletons |
| No annual rules | every class *Blocked: set the annual rules* -> link | blocker, link to rules | designed empty state |
| Blocked | chip with count | critical Notice, pressable lines | n/a |
| Generating | row spinner | action bar loading, list kept | n/a |
| Stale | *Stale* chip | warning *Term 2 changed since this was generated* + Generate again | n/a |
| Published | *Published* | Generate hidden, banner, ranks shown | n/a |
| Read error / offline | ErrorCard, retry | ErrorCard, retry; a failed generate keeps the old list | save failure wording, draft kept |
| Read-only | no actions | no Generate/Publish | no Add rule |

## Data and hooks

New tRPC surface (`exam.annual.*`, types only on mobile per ADR-048):
`policies.list` / `policies.save` / `policies.delete`; `readiness({ classId, academicYearId })`;
`generate({ classId, academicYearId })`; `table({ classId, academicYearId })` (the whole class:
subject rows, term strips, verdict, ranks - the student screen reads the cached row, there is
no per-student endpoint); `publishClass({ classId, academicYearId })`. Cards come from the
existing `cards.classSet` (null term) once V2 exists. **Retired:** `results.computeFinal`
and the module-level cache in `final-results.tsx`. Hooks follow the 7F pattern (one query
per read, invalidate on save/generate/publish). Pure helpers with tests in
`apps/mobile/src/lib/`: policy sentence, weight-total chip, preset <-> stored shape,
verdict-in-words, blocker wording.

## Build order (each step green on its own; I stop after 7G-0 and after 7G-2 for review)

- **7G-0 Groundwork, backend only, no schema.** Extract `termSubjectScore` and the paper
  resolver; pin today's behavior in tests (including a fully-exempt paper and a graded-only
  class); then the fully-exempt fix (ADR-053 §7). Then gap 29: batch the term class compute
  (and `computeTermResult`'s per-student queries) behind those pinning tests, because the
  year rides on fresh term rows; **time it before and after** on the dev DB and keep the
  change only if the number moves. The new annual generate is set-based from the start and
  does not inherit the loop.
- **7G-1 Schema + engine, backend.** Policy tables, `student_final_subject_results`, the new
  `student_final_results` columns, drop `terms.result_mode` (+ term form and copy), the pure
  engines (weighted / single / best-N, renormalization, GPA, graded-only, ties, rounding),
  `exam.annual.*` service + router, `verify-schema` and openapi clean.
- **7G-2 Mobile.** Annual rules (list, editor, hub row), Final results rework, Class annual,
  Student annual; device walk on a fixture class (3 terms, a late joiner, a fully-exempt
  student, a section with no paper, a graded-only class).
- **7G-3 Publish + V2.** Snapshot union and V2 builder, `publishClass`, mobile card view V2,
  **web portal + print V2 reader before the first V2 card exists**.

## Acceptance (what the walk must show)

1. A school with no annual rules cannot generate and is told where to set them.
2. Weighted 20/30/50, Average, Sum, One term, Best 2 of 3 each give the hand-calculated
   numbers on the fixture (the engine tests carry the same cases).
3. A late joiner is counted from the terms they have, flagged `2 of 3 terms`, and publish
   warns; no run throws and nothing is half-written when a term is missing.
4. A graded-only class is promoted, not detained; a fully-exempt student is not failed for
   the excused subject; the term card and the term total agree about it.
5. Detained/compartment reads in words that match the class's pass rules; a class rule
   overrides the school rule; "same as term pass rules" follows a later pass-criteria edit.
6. Ranks (section and class) exist after Generate and tie correctly (1,2,2,4).
7. A Term 2 correction after Generate shows *Stale*; after Publish it shows *predates a
   correction* and the published card is unchanged.
8. Generate on a 40-student class completes well inside the request limit (the number is
   recorded in the build record, from the 7G-0 measurement).

## Decisions taken under the owner's waiver ("do whatever is best", 2026-10-30), reopenable

- **D-G1 - Annual subject pass.** A score threshold in the policy, with an optional own
  promotion-rules block that overrides `pass_criteria` as a whole (not field by field).
  Not "every term passed" (contradicts best-N) and not "last term" (ignores the method).
- **D-G2 - No coverage floor.** A student with fewer terms is counted from the terms they
  have, flagged on the row and counted in the publish warning; never blocked. Reopen if a
  school wants "at least half the year's weight" - it is an additive column.
- **D-G3 - Exemption.** A fully-exempt paper is excused everywhere, which also corrects the
  term card/total mismatch; partial exemption is untouched. This is the one change to term
  output; it is pinned by tests first and affects only fully-exempt students.
- **D-G4 - Ranks inside Generate.** The term flow keeps ranks as a separate explicit step;
  for the year they are written in the same transaction because class generation is the
  unit, so ranks can never be stale against the rows.
- **D-G5 - Class-first Final results.** The year-wide compute and its year-wide count go;
  every action is on a class.
- **D-G6 - Presets.** Average and Sum are stored as best-N over all included terms (equal
  weights without 33.33% rounding); only the printed total differs.
- **D-G7 - Corrections after publish are not in 7G.** Stale/predates warnings only.

## Backend gaps recorded (no changes made)

47. Web portal and print have no annual reader; 7G-3 must add it before any V2 publish.
48. `results.computeFinal` has no tests today; the retired path leaves none behind.
49. A published annual card cannot be corrected (D-G7) - needs its own window design.
50. `schedules.save` wipes derived pass marks when `passMarks` is omitted (the existing
    TASKS finding) - unrelated to 7G, still open.

---

# 7G build record (2026-10-30)

Built on `feat/mobile-exams-7a`, **committed locally in small commits, not pushed, branch unchanged** (the owner's
instruction for this chunk: "finish the work and keep committing"). The owner approved the design with "do whatever is
best"; D-G1..D-G7 stand as written, plus the ADR-053 §7 refinement noted below.

## What shipped

| Step | Where | Commit |
|---|---|---|
| 7G-0 | `termSubjectScore` + the pure annual engines (weighted / single / best-N, verdict, sentence) in `exams-maths`; the paper resolver, subject set, cohorts, criteria and scale moved to `exam-shared`; fully-excused paper rule | `refactor(exams): one term-subject function…` |
| 7G-1 | Migration 0033 (policies, policy terms, `student_final_subject_results`, `student_final_results` + class/section/policy/rank-in-section/renormalized); `exam-annual.service` + `exam-annual-compute` (pure) + `exam.annual.*` router; contracts incl. the v2 card | `feat(exams): the annual result as a saved policy…`, `…annual.overview` |
| 7G-2 | Mobile: Annual rules (list, editor, hub row); Final results by class; class screen (readiness, generate, publish, filters); student screen; v2 card screen; `computeFinal` retired | `feat(mobile): annual rules…`, `feat(mobile): final results by class…` |
| 7G-2b | Migration 0034 drops `terms.result_mode`; mobile term form loses the field and calls the weight "Fee share %" | `refactor(exams): the term row no longer decides…` |
| 7G-3 | Web family portal reads v1 and v2 cards (`annual-card-view`) | `feat(web): the family portal reads the annual card…` |
| gap 29 | Set-based term class compute: **63.0 s → 4.0 s** for 20 students × 3 subjects | `perf(exams): the class compute is set-based…` |

Tests added: 33 maths + 15 compute-scenario + 13 contract unit tests (services), 28→31 mobile logic tests, 12 annual
+ 2 exemption integration tests against Postgres. Existing suites still green: services 169, mobile 38 suites / 633
tests, integration exam 18 + conformance 8.

## Deviations from the design above (each deliberate)

- **Class list chips**: Not generated / Draft / Published only, from one grouped read (`exam.annual.overview`, added
  during the build). A readiness chip per class would cost a readiness call per class; the Blocked / Ready / Stale
  states live on the class screen, where readiness is fetched.
- **Excused papers at the term** (ADR-053 §7 refined): a paper excused in one exam of a term leaves that exam out of the
  weighting; the SUBJECT is excused only when excused in every exam. An old integration expectation encoding "any
  exemption blanks the subject" was corrected (35.00 now, not the zero's-effect blend 21.00).
- **Readiness warnings**: `no_paper_for_section` is a warning, never a blocker (a section that does not sit is legal).
- **Web**: the portal reader shipped in 7G (it had to land before any v2 publish). The staff print set for annual cards
  is NOT built (see gaps).
- **`annual.policies.delete`** exists on the server and is not used by mobile (a wrong rule is edited, as pass criteria).

## Walk record

**Not walked on a device or emulator, and not claimed.** Backend behavior is covered by the integration tests above;
the mobile screens by `tsc`, lint and the pure-logic tests only. The walk needs: a session with 3 terms and published
term exams for a class; a late joiner / a section that did not sit a paper; a fully-excused student; a graded-only class;
then Annual rules (create default, class override, weights not totalling 100, best-N, own promotion rules), Final
results → class → Generate → filters → student → card → Publish (confirm sheet, then frozen), and the family portal.
Also not checked: iOS, TalkBack, 1.3× text, keyboard-over-footer on the editor.

## Gates

`tsc --noEmit` green for db, contracts, services, trpc, web and mobile; `apps/api` fails only on the owner's untracked
`scripts/tmp-seed-fees-demo.ts` (pre-existing). `pnpm db:verify` passes. `pnpm check:openapi` lists the new routes.
`pnpm check:builders` reports 3 violations in `public_site.router.ts` (`publicProcedure`) — pre-existing, not touched.
Mobile lint on the new files: 0 errors.

## Environment left behind

Migrations 0033 and 0034 are applied to the dev database (the shared Neon DB): other branches that select
`terms.result_mode` will fail against it until they merge this. Integration runs leave their own orgs
(`annual-itg-*`, `exempt-itg-*`, `exams-itg-*`, and two `perf-itg-*` orgs with 20 students each) by design (hard rule 2).
Two stale `student_final_results` rows from the 2026-10-27 walk remain (policy_id NULL); the annual screens ignore them
and Generate overwrites them.

## Backend gaps added by 7G (no further changes made)

47. **No staff print set for annual cards** (the web print page is per exam); the portal prints its own card.
48. **Term-grade areas have no annual representation** — they stay on the term cards, as they are out of the term result.
49. **A published annual card cannot be corrected** (D-G7); readiness says "predates a correction" and the cards stay frozen.
50. `schedules.save` wipes derived pass marks when `passMarks` is omitted (existing finding), still open.
51. **Publish (term) and window close still loop per student** (gap 29 measured ~60 s and ~100 s). Only the class compute
    was made set-based; `publishClass` / `closeRevisionWindow` / `assembleSnapshot` are unchanged and are the next candidates.
52. `annual.generate` / `publishClass` return no per-student reasons when they refuse; the class screen shows the
    server's sentence verbatim.

## 7G after first device use (2026-10-30, same day)

The owner ran the screens and reported four things; each was reproduced before it was changed.

| Report | Cause | Fix |
|---|---|---|
| Final results shows "Something went wrong on our side" | `annual.overview`'s SQL lost its quotes (`<> draft`) - not the absence of a rule | quoted; the list answers before any rule or year exists |
| Rule cannot be saved ("Some details need fixing") | the policy's `classId` (null = school default) collided with the staff builders' reserved scope field of the same name | renamed `appliesToClassId` |
| (same family) refusals read as generic server errors | plain `Error`s are only translated when their text matches a regex in `trpc/errors.ts` | `ServiceRefusal` (coded Error) recognised by the transport; the annual service uses it |
| "Why is the year pass mark mandatory?" | it was a second number beside each paper's own pass mark | optional; blank = the papers' pass marks weighted as the score is (ADR-053 amended, migration 0035); the bar used is stored and shown |
| Weights as sliders | text fields | the existing `Slider` (owner's untracked `components/slider.tsx`, committed unchanged with this work) per picked term, 0-100, whole percents, `0% / 50% / 100%` marks, a live total ("Total configured weight: 115% - must equal 100%") and "Split evenly" |

Why the earlier tests missed 1-3: the service tests called the service directly. The new
`exam-annual-conformance.integration.test.ts` sends the phone's payloads through `appRouter.createCaller`
(real input schemas, builders and error translation). 8 tests; 22 annual integration tests in all, plus 7
unit tests for the refusal translation.

Still not walked on a device (the new slider layout has only been type-checked and linted).
