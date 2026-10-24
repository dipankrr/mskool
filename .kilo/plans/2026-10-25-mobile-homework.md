# Mobile Homework — staff slice (Step 4)

Status: in progress. Branch `feat/mobile-homework-slice` from `main` @ `2428713`.
Backend is frozen for this slice; gaps are recorded at the bottom and in the final handoff.

## Actor, task, context

- **Actor:** class teacher or subject teacher, signed in to one branch and the running academic year.
- **Context:** standing in a corridor between periods, one hand on the phone, patchy network. They need to know what is due, what needs grading, and to give homework in under a minute.
- **Tasks, in order of frequency:**
  1. "What is due today / this week, and what needs grading?"
  2. "Give this section homework before the next class."
  3. "Grade what came back; tell a child to resubmit."
  4. "Attach a quiz or a question set." (occasional)
  5. "Change the school's homework defaults / rubrics." (principal/VP only)

## Design read

Staff operations app for Indian private schools; quiet emerald-on-canvas system, one accent,
light-only, iOS/Android phones. Premium = hierarchy, type, spacing, real data, speed.
Dials: variance 6, motion 4, density 5.

The downloaded `docs/reference/modern-agenda-calendar` is **not used as code**: it is an SDK 54
project on `react-native-calendars`, `@gorhom/bottom-sheet`, FlashList and a separate theme.
We rebuild the interaction (swipeable week rail + day agenda + haptics) natively on Reanimated 4.5.1
and our tokens, with no new dependency.

## Information architecture

Homework is the 5th staff tab: Home · Attendance · Students · **Homework** · More.
Visible only with `homework:read`. Header gear → settings (only with `school_settings:read`),
which also links to the question bank and rubrics.

```
(tabs)/homework                     Agenda (default) / All
  → /homework/[id]                  Detail
  → /homework/new                   Create draft
  → /homework/[id]/edit             Edit (draft/published)
  → /homework/[id]/grade            Grading grid
  → /homework/grade/[saId]          One student
  → /homework/[id]/questions        Question set
  → /homework/bank                  Bank
  → /homework/bank/new              Write a bank question
  → /homework/bank/[itemId]         Bank item
  → /homework/settings              School default / class override
  → /homework/rubrics               Rubrics
  → /homework/rubrics/new           Rubric builder
  → /homework/rubrics/[rubricId]    Rubric detail
```

All pushed screens sit outside the tab group, so the tab bar is not over a sticky footer.
List is the tab root.

## Journeys

### A. Marking day (read)
Home → Homework tab → today's selected in the week rail → cards due today → tap a card →
detail shows status, audience, submission rules, grading progress (published+) → Grade.

### B. Give homework
Homework → New → pick pair (5A · Mathematics) → kind → title → instructions → due date/time →
submission chips → grading mode → Save draft → detail → Publish (confirm) → published.

### C. Grade
Detail → Grade → grid sorted by roll, summary tiles → filter "To grade" → student →
submission text/link + history → marks + feedback → Save grade → row refreshes only after
server confirms; back to grid with updated counts.

### D. Resubmit / extension / excuse
Student grade → Request resubmit (feedback) or More → Extend deadline (new due/close + reason)
or Excuse (reason). All append-only; list/detail invalidated.

### E. Quiz
Detail → Questions → attach from bank or write a new question → set order → Save set.
Locked once a student starts. Grade → student → attempts list → grade a manual answer.

### F. Config (principal/VP)
Homework gear → Settings (school default, plus per-class override) → saving invalidates settings.
Rubrics: list → create (criteria + levels) → detail → retire/reactivate.

## Screen states

Every surface: permission denial (honest), no branch, no running session, initial loading
(skeletons shaped like content), error + retry, empty vs filtered-empty, offline (cached data
preserved, save fails into retry copy), submitting (button busy, no double-fire), success
(server-confirmed), app resume/refetch, unsaved-work guard on forms.

Specific:
- Publish confirm; published-with-zero-students notice + Cancel.
- Scheduled rows read-only (no scheduling UI; publishing now would ignore `publishAt`).
- Cancelled rows read-only with reason.
- Locked question set (a student started) banner.
- Grading mode `grade`/`rubric` read-only banner ("managed on the desk") because Step 7 scales
  and the rubric-score read do not exist yet.
- No homework data: empty state with "Give the first homework" CTA when permitted.

## Visual anatomy

- **Week rail:** month line + Today; 7 × 48 pt day cells, weekday letter, date, due-load dots,
  today ring, emerald selected capsule; paged by week, spring + haptic; capped at 1.3 text scale.
- **Agenda:** date-grouped cards, sticky headers; kind icon tile, title, subject · kind, due time;
  status word only when it matters (Draft / Closed / Cancelled); overdue/due today in semantic colour.
- **All:** Live / Drafts / Closed / All segments, search, subject chips, denser rows.
- **Detail:** hero (status, title, subject · section · due), progress stat tiles + segmented bar,
  grouped facts, footer action by status, More sheet.
- **Form:** one scroll, grouped Where / What / When / How / Grading; pair picker; sticky Save draft.
- **Grade:** summary tiles, filter chips, roster rows; student screen with submission card,
  large marks input, feedback, history timeline, footer Verify / Request resubmit.
- **Motion:** 120/200/320 tokens, press scale 0.98, haptic selection/success; Reduce Motion respected.
- New icons: homework, quiz, project, reading.

## Backend endpoints used

| Chunk | Procedures |
|---|---|
| 4A | `homework.list`, `byId`, `create`, `update`, `publish`, `cancel`, `close` |
| 4B | `homework.students.list/get/evaluate/extend/excuse` |
| 4C | `homework.bank.list/create/byId/setActive`, `questions.get/set`, `students.attempts.list/gradeAnswer`, `comments.list/post` |
| 4D | `homework.settings.get/upsert`, `rubrics.list/create/byId/setActive` |

## Data notes

- Timestamps arrive as ISO strings at runtime even though the contract types say `Date`.
  All formatting goes through helpers that accept `string | Date`.
- `homework.list` is fetched once per academic year with no status filter; segments, search,
  subject chips and the rail counts are client-side. The year's list is small.
- `homework.byId` has no resources; none are authored in v1.
- `students.list` provides the detail/grid counts.
- Question settings are **not read** by any endpoint, so the editor omits them; `questions.set`
  preserves existing settings when `settings` is absent (verified in the service).
- File/image attachments are not possible: no homework upload endpoint, no image submission type,
  `file` is unusable end-to-end, storage serves images only. V1 submission types exclude `file`.

## Chunks

1. **4A — Assign.** Foundation (tab, icons, format, copy, week rail, date-time field, pair picker),
   list/agenda/All, detail, create/edit, publish/cancel/close, zero-enrollment state.
2. **4B — Grade.** Grid, student grade, evaluate, extension, excuse, class/private comments.
3. **4C — Questions.** Bank list/detail/create/retire, attach/write question set, lock state,
   attempts list + manual answer grading.
4. **4D — Config.** Settings (default + class override), rubrics list/create/detail/retire.

Each chunk is its own commit. `pnpm check-types` is green after each.

## Acceptance

- A subject teacher can create a draft for an assigned (section, subject), publish it, see the
  student grid, grade a submission with marks/feedback, request a resubmit, extend and excuse.
- A principal can change the school default late window and see the effective settings.
- Published assignments from web (scheduled, graded, cancelled) open without crashing and
  present honest read-only states.
- No screen shows success before the server confirms; no mutation double-fires.
- Weekly rail date maths correct across month/year boundaries; accessibility labels announce
  full date + load; 44 pt minimum targets; large text does not clip primary actions.
- Android and iOS device walks on the running emulator for 4A/4B at minimum.

## Verification

- `pnpm --filter @repo/mobile check-types`
- `pnpm --filter @repo/mobile lint` (new files)
- Jest: week-strip date maths, status segmentation, grading-mode form validation.
- Device walk: agenda empty/loaded, create/publish, detail progress, grade save, resubmit,
  extension, zero-enrollment, offline error, denial.

## Documented backend gaps (no changes made)

1. `homework.list`: add `sectionIds`/`sectionNames`, `studentCount`, `submittedCount` for list
   context and triage. Without them the agenda shows subject only and no grading count.
2. `homework.byId`: return `resources` (and section names/class id) for detail + edit prefill.
3. `homework.questions.get`: return the `assignment_question_settings` row with the questions.
4. `homework.students.get`: include student name/roll/admission and assignment title/mode/max marks.
5. Homework upload: staff resources and student submissions; images now, documents later.
6. Storage: serve non-image content types and return submission files in the staff read.
7. Rubric parity: read `assignment_rubric_scores`, rubric update endpoint, grading-scale read (Step 7).
8. `homework.bank.setActive` uses `school_settings:update`; teachers can create but not retire.
9. Grading mode is immutable after create (`updateAssignmentInput` omits it).
10. Publish succeeds with zero enrolled students; consider a warning or block.
11. No `teacherAssignment.listMine` read; the pair picker does one section query per section.
12. `scheduled` has no publish worker/UI; mobile treats it as read-only.
13. Comments have no staff delete/moderation endpoint.

## Docs / skills used

- `docs/MOBILE_PLAN.md` §9 + parity ledger, `docs/TASKS.md`, `AGENTS.md`.
- Skills: `expo-router`, `expo-data-fetching`, `mobile-design`, `expo-native-ui`,
  `expo-animation` (motion review), `vercel-react-native-skills` (list performance).
- Expo SDK 57 / RN 0.86.3 / React 19.2 / Reanimated 4.5.1 / React Query 5.101.2.
- Reference: `docs/reference/modern-agenda-calendar` (interaction only; not code-compatible).
