# Journey 5: Teacher homework, redesigned

Status: **proposal for owner review, v2 (2026-11-08).** Nothing is built and no other doc is changed.
Mockups: `prototype/homework-v2.html` (31 phone frames, numbered in screen order). The first
version, `prototype/homework.html` (24 frames, one Give sheet), is kept for comparison.

This replaces the Step 4 homework design (`.kilo/plans/2026-10-25-mobile-homework.md`).
That build followed the API's shape (one assignment, one section, a draft → publish → grade
lifecycle). Teachers think in two daily moments instead, and the backend has to change to
serve those moments, so both sides change.

**What changed in v2**, after the owner's review of v1:
- Give is a stepped flow like admission, the same four steps for every type.
- Five types, each with defaults for how work comes back and how it's graded.
- "Checked" became "Grading"; Remark (Excellent / Good / Bad) was added.
- Quizzes have their own section on Home; reading has a "who ticked" screen.
- "Diary" became "All homework". Copy says "student", never "family" or "parent".
- No notifications are promised (none exist yet). No homework settings screen.

---

## 1. Who, how often, and what "good" means

| Actor | How often | The job |
|---|---|---|
| Subject teacher | Several times a day | Give homework at the end of a period; check notebooks at the start of the next |
| Class teacher | Daily | The above, plus "what did my section get tonight, and who keeps skipping it?" |
| Principal / coordinator | Weekly | "Is homework being given, checked, and not overloading anyone?" |

**Measurable targets** (to check on a mid-range Android during the device walk):

- **Give** homework to two sections: **under 20 seconds**. From "Same as last time": type the
  title, Next, Give.
- **Check** a class of 32 notebooks (no grading): **under 60 seconds**, about one tap per exception.
- **Grade** 30 children (marks or remark): about one tap per child, on one screen.
- Nothing a teacher saved is lost on a bad network.

## 2. Design principles

1. **Home is a to-do list.** "To check" first, oldest first, with real progress per class.
   Quizzes have their own section; reading and practice sit under "Out now".
2. **Only my classes.** A teacher sees the (section, subject) pairs they teach. Class teachers
   also see their section. Principals get an aggregate view, not everyone's list.
3. **Give asks one thing at a time.** What → classes → the work → when and how. Single-choice
   steps move on by themselves; steps with one possible answer are skipped.
4. **Checking works like attendance.** Bulk first ("All done"), then exceptions, one save.
5. **No step the teacher doesn't need.** No separate publish. Undo replaces "Are you sure?".
   Drafts are optional.
6. **End on what's next.** After checking: who needs following up, and the next class to check.

## 3. Types, how work comes back, and grading

### The two settings

**Comes back**

| Choice | Backend value today | Who sets each child's status |
|---|---|---|
| Brought to class | `offline` | Only the teacher. Never marked missing automatically |
| Sent in the app (photos or a typed answer) | `file` / `text` | The student sends it; after the late window it becomes "not sent" |
| Student ticks it | `tick` | The student ticks; the teacher can override |
| Nothing | `none` | Nobody; it just goes in the diary |
| Answered in the app (quiz only) | `questions` | The student answers; open attempts are handed in at close |

**Grading.** If work comes back to the teacher (brought or sent), it is always checked on the
Done / Incomplete / Not done list. Grading only adds a level on top:

| Choice | What the teacher does |
|---|---|
| None | The Done list alone |
| Marks | The list plus a number pad (out of N) |
| Grade | The list plus the school's grade letters (A–E) |
| Remark | The list plus Excellent / Good / Bad, one tap each |
| Auto-marked (quiz only) | The app marks; the teacher marks only written answers |

The grading row is hidden for "Student ticks it" and "Nothing". Rubric stays hidden (D-6).

### Each type

| Type | Comes back (★ default) | Grading (★ default) | Due by default |
|---|---|---|---|
| **Homework** | ★ Brought · Sent · Student ticks · Nothing | ★ None · Marks · Grade · Remark | Tomorrow, first period |
| **Practice** | ★ Nothing · Student ticks · Brought | ★ None · Remark | Tomorrow |
| **Project** | ★ Brought · Sent | ★ Marks out of 20 · Grade · Remark | 2 weeks, late a few days |
| **Reading** | ★ Student ticks · Nothing | (none) | End of the week |
| **Quiz** | Answered in the app (fixed) | Auto-marked (fixed) | Opens now, closes tomorrow 8:00 |

- Worksheet is Homework with a file attached. Classwork is dropped. Project groups come later.
- The teacher's last choice is remembered per subject and class, so their own defaults need no
  setup.
- The teacher can always set a child's status by hand (a late notebook, a child who read in class).
- Changing how it comes back or grading is locked after the first hand-in or check.

### How one table holds different fields per type

The assignment already has `title` (required), `description` (optional, long) and `topic`
(optional label). No new columns:

| Type | What the teacher fills in | Saved as |
|---|---|---|
| Homework, Practice, Project | Title, Details (optional; "1." auto-numbers typed questions), files | `title`, `description` |
| Reading | Book, what to read | Book → `topic`, chapter or pages → `title` |
| Quiz | Title, questions | `title`; questions in the existing question tables |

The create API takes a different input per type and validates it (Reading needs a book, a Quiz
needs at least one question), then maps it onto the same columns.

**Home v3 (2026-11-09, owner-approved):** Home is now group 0 of the mockup (needs you now, this week, my classes, and a class page), replacing frames 1 and 2's stacked lists. The class page also carries the class diary's useful part, who owes work.

## 4. Structure

```
Homework tab
├── Home: To check · Quizzes · Out now · Given today · Drafts · [Give]
│   ├── Give: what → classes → the work → when and how ──► Undo toast
│   ├── Check list (Done list / marks pad / remark pad) ──► student sheet (hold) ──► Saved summary
│   ├── Online review list ──► review queue
│   ├── Quiz results ──► written-answer queue
│   └── Reading ticks
├── All homework (by date given, type filter, search)
├── Owe work (by child)
├── Homework detail ──► move due date · give to another class · edit
└── ⋯ menu: Question bank · Rubrics (principal)

Elsewhere
├── Class diary: class teacher, from Home or the section page
├── Student page ▸ Homework tab: a child's record
└── Principal ▸ Homework this week
```

## 5. Journeys

### A. Give (frames 5 to 14)
1. **What are you giving?** Homework / Practice / Project / Reading / Quiz. "Same as last time"
   jumps to step 3 with everything filled in. "Copy something you gave before" lives here.
2. **Which classes?** One card per subject the teacher teaches, each class a tick chip with its
   size, and "Select all". Ticking one subject's class dims the other cards (one homework, one
   subject); tapping a dimmed card switches. An amber dot marks a class that already has homework
   due tomorrow. One subject: one card; one class: the step is skipped.
3. **The work.** Title and details plus files; Reading asks book and pages; Quiz builds its
   question list (write, bank, scan later).
4. **When and how.** Every choice is on the screen, no sheet: due date (Reading: read by; Quiz:
   opens, closes and rules), "Comes back" as tiles (only the ones the type allows), and grading as
   a segmented choice with an "out of" stepper for marks. Choosing "Student ticks it" or "Nothing"
   removes the grading row. An optional "About how long" row (15 / 30 / 45 min / 1 hr chips,
   stored as `estimatedMinutes`) helps the class diary's load figure. Only rare settings sit behind "More" (late window, publish later,
   some students). The answered steps show as chips at the top, which is the review. Then
   **Give**, and a toast with **Undo**.

Due chips skip Sundays (and holidays, if a school calendar exists). Students see new work in
their app straight away; there are no notifications yet.

### B. Check (frames 15 to 20, and Owe work, frame 3)
Home → **Check now** → list opens unset with **All done** → tap exceptions (Done → Incomplete →
Not done) → **Save** → who to follow up → **Next: 6B**.

- For work brought to class, children absent today come from attendance and are left out of the
  count (the teacher can change them). Other ways back ignore attendance.
- With Marks: a sticky number pad, "Next" moves down the roll. With Remark: three big buttons,
  each tap moves on.
- Hold on a child: status, a note chip the student sees, "Bring it tomorrow", recent pattern.
- Re-opening shows what was saved, so editing works the same way.

### C. Online work, quizzes, reading (frames 21 to 24)
- **Online:** the list (to review / reviewed / not sent, with Remind) → one child at a time with
  photos, grading, feedback chips, Redo → Save · next.
- **Quiz:** class average, per-question results (most missed first, most common wrong answer),
  a queue for written answers, Remind for those who haven't attempted.
- **Reading:** ticked / not yet, "Mark read" override, Remind. Nobody is marked "not done".

### D. One homework (frames 25 to 28)
What was asked, each class's progress with **Check**, students' questions, then: edit, move due
date for everyone, give to another class, stop accepting work. Cancel and delete-draft sit in ⋯.

- **Move due date** moves every child's deadline and the late window, can apply to one section,
  and keeps any later per-student extension.
- **Give to another class** copies the homework as a new one with its own due date.
- **Edit** reuses Give's steps 3 and 4; after the first hand-in or check, classes, how it comes
  back and grading are locked, with a sentence saying why.

### E. Beyond one teacher (frames 29 to 31)
- **Class diary:** tonight's homework across subjects for the section, a load estimate, and
  children owing work across subjects.
- **Child's record:** on-time rate against the class, a recent strip, the pattern in words
  (including remarks, "mostly Good"), and what's still owed.
- **Principal:** checked-within-2-days rate, gaps, heavy days, behind-on-checking, by class.

## 6. Feature list

| Feature | Today | Proposed |
|---|---|---|
| Give to several sections at once | No | Yes |
| Photo of the board or worksheet (PDF later) | No (no upload path) | Yes |
| Publish in one step | Draft → detail → Publish → confirm | Give, with Undo |
| Types | 7 kinds × 7 submission types × 5 grading modes, all up front | 5 types with defaults; two plain settings |
| Schedule for later, some students only | Not usable | Under More |
| Copy | No | "Copy something you gave before" in step 1 |
| Check notebook work | One child per screen; marks refused | Attendance-style list; marks and remark pads |
| Notes on checking | No | Note chips the student sees |
| Online work review | One child per screen, files invisible | List, then a queue with photos |
| Quiz results per question | No | Yes |
| Reading follow-up | No | Who ticked, Remind, override |
| Follow-ups and defaulters | No | After saving, Owe work, the child's record |
| Class diary and load | No | Class teacher view |
| Principal oversight | Everyone sees the whole school | Aggregate view |
| School homework settings | One row per school plus class overrides, partly unusable | None; fixed rules until a school asks |

## 7. Backend changes (dev mode, so no compatibility constraint)

**Model**
1. **Teacher check result.** Each student assignment carries a teacher-recorded outcome: `done`,
   `incomplete`, `not_done` or `absent`, plus an optional grade (marks, grade letter or remark)
   and a note, kept as one row per student that is overwritten when changed (who checked it and
   when are stored), with no submission needed. Work brought
   to class never becomes `missing` from the sweeper.
2. **Comes back** is one value per assignment (`offline`, `file`/`text`, `tick`, `none`,
   `questions`), not an array. `kind` is the type: homework, practice, project, reading, quiz
   (classwork and worksheet go).
3. **Grading** is `none`, `marks`, `grade` or `remark`; `completion` merges into `none`. Remark is three
   fixed words (Excellent / Good / Bad), stored as an enum on the child's row.
4. **Per-type create input**, validated per type, mapped onto `title` / `description` / `topic`.
5. **Multi-section homework.** One assignment with several section targets, each subject-gated at
   create time.
6. **Attachments: photos only for now** (storage per ADR-063). Why the first build had none:
   every upload endpoint was single-purpose, the old file route served images to staff only, and
   the mobile screens never handled files. ADR-063 removed those blocks; homework still needs:
   - A teacher upload link (`homework.fileUpload`, gated by the teacher's pair) and a student one
     (portal, gated by the child the login owns), purposes `homework_teacher_file` and
     `homework_student_file`. The save calls `ensureReady` then `attach`, parent = the homework
     for teacher files and the student's homework for theirs.
   - Reads return image references `{ id, url, thumbUrl }`; lists and the review queue use the
     thumbnail. Family reads carry their own links, so no file route changes.
   - A file belongs to one record: "Give to another class", "Same as last time" and "Copy" copy the
     files in the bucket and link the copies; bank question images are copied when a question is
     attached to a quiz.
   - Undo, deleting a draft, removing a photo and replacing a submission mark the files that
     disappeared deleted, in the same transaction.
   - Documents (PDF) wait: storage accepts JPEG, PNG and WebP only. Added later as its own change.
   - `evaluation_files` (annotated copies) has no screen and goes.
7. **Remove** the school settings table's use (parents/students can send, file limits, daily cap,
   weekend switch, class overrides). Parent and student logins are treated the same; who sent
   something may still be stored but isn't shown.
8. **No versioning.** Homework is a daily diary, not money, so it keeps no history:
   - Edit history goes: the `assignment_revisions` table and its snapshot writes (homework and
     questions services), and the "Edited N times" count.
   - One submission per student: the student can replace it until it's checked; after that the
     teacher can send it back to redo, which reopens it. `versionNo`, `allowResubmission` and
     `maxSubmissions` go, with "Maximum attempts" in the form.
   - One result per student, overwritten (see item 1); `assignment_evaluations.isCurrent` goes.
   - Quizzes allow one attempt for now; `maxAttempts` and `attemptScoring` go.
   - Kept: the copy of bank questions made when they are attached to a quiz, so editing the bank
     never changes a quiz already given.

**Read models** (each built for one screen, scoped to the caller's own pairs)
- `homework.home`: to check, quizzes, out now, given today, drafts.
- `homework.register.get` / `homework.register.save` (batch, idempotent, offline-safe).
- `homework.reviewQueue`, `homework.quizResults`, `homework.readingTicks`.
- `homework.classDiary`, `homework.studentRecord`, `homework.schoolWeek`.

**Fixes carried over from the review**
- Check that the section and subject match the record on every write; scope reads to the caller's
  own pairs.
- Close really stops submissions (keeping per-student extensions).
- Due-date edits propagate to every child's deadline.
- Honour the score-hiding setting; make roll-number sorting safe for "12A".
- Auto-submit quiz attempts at close; guard publishing (a past close time, a quiz with no
  questions).
- Edits allowed until the first hand-in; deleting drafts that never reached a student.
- A student "tick" can't be submitted today (the submit input demands text, a link or files).
- Question-bank visibility isn't enforced: every teacher in the branch can read every question and
  its answer key. Teachers can add bank questions but not retire their own.
- Private comment threads leak: the staff comment list without a student returns every private
  thread on the homework. There is no way for staff to delete a comment.
- Giving to a class with no enrolled students succeeds silently.
- "Publish later" has no worker that publishes at the set time.
- A teacher's own (section, subject) pairs need one read (`teacherAssignment.listMine`), not one
  query per section.

**Student side rules** (owner, 2026-11-08; screens are designed later, these fix the backend):
- The student sees one of six words per homework: To do, Sent, Late, Checked (with the grade or
  remark under it), Redo, Missed.
- Grades, remarks and the teacher's note become visible when the teacher saves the checking list,
  so the whole class sees theirs together, not mid-checking.
- A student's tick ("Student ticks it") can be undone until the due date, then it locks.
- Sending back to redo reopens work sent in the app: the student sees "Redo" with the note, sends
  new photos (replacing the old ones) and it returns to the review queue.

**Student screens not yet designed:** seeing homework, ticking, sending photos, quiz attempts,
seeing grades. The family app has no homework screens yet and its
reads were left out of the family chunk. It needs its own short design once the teacher side is
agreed.

## 8. Build order (each chunk reviewed, then built)

1. **H1 Backend core — built 2026-11-08 (ADR-064).** Types, comes back, grading (with remark),
   check results, multi-section, per-type create input, no versioning, the fixes above, the
   `home`, `pairs`, `defaults` and `register` reads, photo uploads for both sides and the
   student endpoints (pulled forward from H3 and the family chunk, since they shape the model),
   tests. Old mobile screens removed; the Homework tab is hidden until H2.
2. **H2 Home + Give + Check:** the daily loop. Device walk against the time targets above.
3. **H3 Photo uploads + online review:** teacher and student upload links, attach and delete
   rules, file copies on copy and give again, review queue with thumbnails.
4. **H4 Quiz in Give + results**, plus "Add from bank" for typed homework questions (bank images copied on attach).
5. **H5 Reading ticks, class diary, child record, principal view.**
6. **H6 Notifications:** needs push infrastructure, which doesn't exist yet.

### H2 slice plan (Home, Give, Check)

**Actor and context.** A subject or class teacher between periods, one hand, a mid-range Android,
sometimes on a weak connection. Built on the H1 API (ADR-064); frames 1, 5 to 11 and 14 to 20.

**Routes.** `(tabs)/homework` (Home), `homework/give` (the four steps), `homework/check`
(`id` + `sectionId`). Thin route files; bodies in `screens/homework/`.

**Screens and states**
- **Home.** To check (one card per homework and section, "Check now"), Out now, Drafts, and a
  Give button for callers with `homework:create`. States: loading skeletons; error with Retry;
  no session year; nothing given yet (empty state with Give); all checked (frame 2). Quizzes show
  as a read-only card until H4. Pull to refresh.
- **Give, step 1: type.** Homework, Practice, Project, Reading; Quiz shows "comes with the quiz
  update" until H4. "Same as last time" (from `defaults.lastId`) prefills classes and choices.
- **Step 2: classes.** One card per subject with tick chips per section, size and an amber dot
  when that class already has homework due tomorrow; "Select all"; picking another subject's
  chip switches subject and clears. One subject and one section: the step is skipped. States:
  loading, error, no classes assigned (a sentence saying who sets this up).
- **Step 3: the work.** Title and details (Homework, Practice, Project) with up to 10 photos
  (camera or library, resized on the phone, uploaded straight away with a per-photo spinner and
  retry); Reading asks book and pages. Validation inline.
- **Step 4: when and how.** Due chips (Tomorrow, the next school day after, Pick; Project: 1 or
  2 weeks), comes-back tiles (only those the type allows), grading segment (hidden for tick and
  nothing) with an "out of" stepper for marks, "About how long" chips, and More (late window).
  The chips at the top repeat steps 1 to 3 and jump back. Footer: Draft and Give.
- **After Give.** Back on Home with a toast "Given to 6A, 6B" and **Undo** for 15 minutes'
  worth of the toast's life (the server decides if Undo is still allowed).
- **Check.** Counts at the top (Done, Incomplete, Not done, Left), the class in roll order,
  "All done" marks every unset child Done, a tap cycles Done, Incomplete, Not done, Absent.
  Children absent today (work brought to class) start as Absent. Marks: a sticky number pad
  that moves down the roll; Grade: the school's letters; Remark: three big buttons. Hold a child
  for status, a note the student sees and quick chips. Save, then a summary with who to follow
  up and "Next: 6B" when another section of the same homework waits. Re-opening shows what was
  saved. A failed save keeps every mark and offers Retry; leaving with unsaved marks asks first.

**Acceptance.** Give to two sections in under 20 seconds from "Same as last time"; check 32
notebooks with three exceptions in under 60 seconds; both on a mid-range Android, with text at
1.3x still usable; nothing shows as saved before the server confirms.

## 9. Decisions

**Agreed with the owner (2026-11-08)**
- Types: Homework, Practice, Project, Reading, Quiz. Project groups later.
- Give is stepped (admission style); subject and classes are one step; the last step is split
  into "the work" and "when and how".
- Give sends straight away with Undo (D-2).
- Teachers see only their pairs, class teachers their section, principals totals (D-4).
- Reading and Homework can be "Student ticks it" or "Nothing".
- Grading: None / Marks / Grade / Remark (Excellent / Good / Bad).
- Parent and student logins are the same; copy says "student"; no homework settings.
- Attendance only feeds the check list for work brought to class.
- No notifications until push exists (D-5 waits).
- Photos only for now; documents (PDF) later.
- No versioning: no edit history, one submission and one result per student, one quiz attempt.

- Checking starts blank with an "All done" button (D-1).
- Four statuses: Done / Incomplete / Not done / Absent; "not brought" is a note (D-3).
- Student side rules as in section 7.
- Estimated time is an optional row in step 4.
- Rubrics hidden in the app for now (D-6); a draft never given is really deleted (D-7); load
  guide later (D-8); repeating homework later (D-9); the staff app's emerald style (D-10).

Nothing is open.
