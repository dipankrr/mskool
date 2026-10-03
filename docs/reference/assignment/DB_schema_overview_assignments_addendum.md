# Schema Overview — Addendum: Assignments & Questions

## Run Order (append)

```
06_assignments.sql   -- Settings, Rubrics, Series, Assignments, Targets, Resources,
                     -- Revisions, StudentAssignments, Extensions, Submissions,
                     -- Evaluations, Comments, Acknowledgements, Summary
07_questions.sql       -- QuestionBank, Options, QuestionSettings, AssignmentQuestions,
                     -- QuestionAttempts, QuestionAttemptAnswers
```

Requires the existing `files` table for uploads.

## Table Index (26 new tables: 58 → 84)

### Assignments
| # | Table | Purpose |
|---|-------|---------|
| 59 | `assignment_settings` | School default + per-class overrides: allowed submission types, file limits, late defaults, daily cap |
| 60 | `rubrics` | Reusable rubric per school |
| 61 | `rubric_criteria` | Criteria within a rubric |
| 62 | `rubric_levels` | Levels and points per criterion |
| 63 | `assignment_series` | Recurring assignments (reading log, daily practice) |
| 64 | `assignments` | Authored item. Belongs to year + subject + targets. `created_by` is audit only |
| 65 | `assignment_targets` | Audience: Section or individual Student |
| 66 | `assignment_resources` | Teacher's files / links / videos |
| 67 | `assignment_revisions` | Snapshot before any material post-publish edit |
| 68 | `student_assignments` | **Authoritative resolved per-student record. Other modules read only this** |
| 69 | `assignment_extensions` | Per-student deadline overrides (append-only) |
| 70 | `submissions` | Immutable, versioned. Records who submitted (Student/Parent/Teacher) |
| 71 | `submission_files` | Files attached to a submission version |
| 72 | `assignment_evaluations` | Append-only; regrade = new row, `is_current` flips |
| 73 | `evaluation_files` | Annotated copies / feedback attachments |
| 74 | `assignment_rubric_scores` | Rubric scoring per evaluation |
| 75 | `assignment_comments` | Class-wide Q&A or private student↔teacher thread |
| 76 | `assignment_acknowledgements` | Parent "seen/signed" (digital homework diary) |
| 77 | `student_assignment_summary` | Pre-aggregated counts per month/term/year |

### Questions (question-based assignments)
| # | Table | Purpose |
|---|-------|---------|
| 78 | `question_bank_items` | Reusable questions (Private / School visibility) |
| 79 | `question_options` | Options for MCQ questions |
| 80 | `assignment_question_settings` | Shuffle, attempts, scoring policy, answer reveal |
| 81 | `assignment_questions` | **Snapshot** of questions + answer key per assignment |
| 82 | `question_attempts` | One per attempt; bounded only by assignment deadline (no timer) |
| 83 | `question_attempt_answers` | Answers, auto/manual marks, review flag |
| 84 | `question_attempt_answer_files` | Uploads for FileUpload-type questions |

## Design Rules

1. **Pattern:** `Assignment` → `StudentAssignment` → `Submission` → `Evaluation`.
2. **Ownership:** assignments belong to year + subject + target sections, never to a teacher. Access is decided by `ScopeContext` (section_ids / subject_ids).
3. **Resolution:** targets resolve through `student_subject_enrollments`, so electives work. Late joiners get backfilled rows (`is_backfilled = TRUE`, `counts_toward_stats = FALSE`): they can view past work, and submission is governed only by `effective_close_at`.
4. **Deadlines:** `due_at` is the on-time mark, `close_at` the hard cutoff. Per-student values are snapshotted into `student_assignments`; extensions override them.
5. **Integrity:** submissions are versioned, evaluations are append-only, and edits after publish create an `assignment_revisions` snapshot. Cancelling sets status; nothing is deleted.
6. **No grading impact:** assignment and question scores never feed exams or report cards.
7. **Questions are part of assignments:** a question set is attached to an assignment, question types mix freely (MCQ, fill-blank, written, FileUpload), and the assignment can also allow a free-form Text/File/Link response alongside it. No timer. Questions are snapshotted into the assignment, and the answer key must never reach student sessions.
8. **Group projects (not built):** can be added later with `assignment_groups`, `assignment_group_members` and a nullable `submissions.group_id`, with no change to existing tables.

## Application-Level Rules (not enforced in SQL)

- Material edits after publish create a revision and notify students.
- A background worker sets `Missing` after `effective_close_at`, handles scheduled publishing, and sends due-soon reminders.
- Dropping an elective marks open rows `Excused`; adding one backfills read-only rows.
- Teachers edit an assignment if scope covers all target sections and the subject; they grade a student if scope covers that student's section. Class teachers get read access to all subjects in their section.
- `max_assignments_per_day` is checked at publish time against `assignment_settings`.
