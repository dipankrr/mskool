-- =====================================================================
-- 06_assignments.sql
-- Homework / Assignments module
-- Depends on: 01_foundation, 02_academic_structure, 05_exams (grading_scales)
-- Also assumes an existing `files` table (id BIGSERIAL) for uploads.
--
-- Design notes
--  * Pattern: Assignment (authored) -> StudentAssignment (resolved)
--             -> Submission (versioned) -> Evaluation (append-only)
--  * student_assignments is the single authoritative per-student record.
--    All other modules read only that.
--  * Assignments belong to year + subject + target sections.
--    created_by is audit only, NOT ownership.
--  * NO grading impact on exams / report cards, by design.
--  * Group projects are not built now. Path kept open: a future
--    assignment_groups table + submissions.group_id would not require
--    changes to existing tables beyond one nullable column.
--  * Soft state only: nothing here is hard-deleted (comments use is_deleted).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. CONFIGURATION
-- School-wide defaults (class_id NULL) with optional per-class overrides.
-- ---------------------------------------------------------------------
CREATE TABLE assignment_settings (
    id                          BIGSERIAL PRIMARY KEY,
    public_id                   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id                   BIGINT NOT NULL REFERENCES schools(id),
    class_id                    BIGINT REFERENCES classes(id),  -- NULL = school default

    allowed_submission_types    TEXT[] NOT NULL
        DEFAULT ARRAY['None','Tick','Offline','Text','File','Link','Questions'],
    students_can_submit         BOOLEAN NOT NULL DEFAULT TRUE,
    parents_can_submit          BOOLEAN NOT NULL DEFAULT TRUE,

    max_files_per_submission    INT NOT NULL DEFAULT 5,
    max_file_size_mb            INT NOT NULL DEFAULT 10,
    allowed_mime_types          TEXT[],                          -- NULL = platform default

    default_late_policy         TEXT NOT NULL DEFAULT 'Allowed'
        CHECK (default_late_policy IN ('NotAllowed','Allowed')),
    default_late_window_hours   INT NOT NULL DEFAULT 48,         -- close_at = due_at + this

    max_assignments_per_day     INT,                             -- per section, NULL = no cap
    allow_weekend_assignments   BOOLEAN NOT NULL DEFAULT TRUE,
    questions_enabled             BOOLEAN NOT NULL DEFAULT TRUE,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_settings_types CHECK (
        allowed_submission_types <@ ARRAY['None','Tick','Offline','Text','File','Link','Questions']
    )
);
CREATE UNIQUE INDEX uq_assignment_settings_school_default
    ON assignment_settings (school_id) WHERE class_id IS NULL;
CREATE UNIQUE INDEX uq_assignment_settings_class
    ON assignment_settings (school_id, class_id) WHERE class_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 2. RUBRICS (reusable per school)
-- ---------------------------------------------------------------------
CREATE TABLE rubrics (
    id            BIGSERIAL PRIMARY KEY,
    public_id     UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id     BIGINT NOT NULL REFERENCES schools(id),
    name          VARCHAR(150) NOT NULL,
    description   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by    BIGINT NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rubric_criteria (
    id            BIGSERIAL PRIMARY KEY,
    public_id     UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id     BIGINT NOT NULL REFERENCES schools(id),
    rubric_id     BIGINT NOT NULL REFERENCES rubrics(id),
    name          VARCHAR(150) NOT NULL,
    description   TEXT,
    sort_order    INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_rubric_criteria_rubric ON rubric_criteria (rubric_id);

CREATE TABLE rubric_levels (
    id            BIGSERIAL PRIMARY KEY,
    public_id     UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id     BIGINT NOT NULL REFERENCES schools(id),
    criterion_id  BIGINT NOT NULL REFERENCES rubric_criteria(id),
    label         VARCHAR(100) NOT NULL,          -- e.g. Excellent / Good / Needs work
    description   TEXT,
    points        NUMERIC(6,2) NOT NULL,
    sort_order    INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_rubric_levels_criterion ON rubric_levels (criterion_id);


-- ---------------------------------------------------------------------
-- 3. SERIES (recurring assignments: weekly reading log, daily practice)
-- ---------------------------------------------------------------------
CREATE TABLE assignment_series (
    id            BIGSERIAL PRIMARY KEY,
    public_id     UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id     BIGINT NOT NULL REFERENCES schools(id),
    title         VARCHAR(200) NOT NULL,
    recurrence    TEXT,                            -- iCal RRULE string
    created_by    BIGINT NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- 4. ASSIGNMENTS (authored item)
-- ---------------------------------------------------------------------
CREATE TABLE assignments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    term_id                 BIGINT REFERENCES terms(id),
    subject_id              BIGINT NOT NULL REFERENCES subjects(id),

    series_id               BIGINT REFERENCES assignment_series(id),
    source_assignment_id    BIGINT REFERENCES assignments(id),   -- cloned from

    kind                    TEXT NOT NULL DEFAULT 'Homework'
        CHECK (kind IN ('Homework','Classwork','Project','Worksheet',
                        'Reading','Practice','Quiz')),
    title                   VARCHAR(250) NOT NULL,
    description             TEXT,                                -- rich text / markdown
    topic                   VARCHAR(250),                        -- chapter / topic label
    estimated_minutes       INT,

    submission_types        TEXT[] NOT NULL DEFAULT ARRAY['None'],
    grading_mode            TEXT NOT NULL DEFAULT 'None'
        CHECK (grading_mode IN ('None','Marks','Grade','Rubric','Completion')),
    max_marks               NUMERIC(7,2),
    grading_scale_id        BIGINT REFERENCES grading_scales(id),
    rubric_id               BIGINT REFERENCES rubrics(id),

    publish_at              TIMESTAMPTZ,
    due_at                  TIMESTAMPTZ NOT NULL,
    close_at                TIMESTAMPTZ NOT NULL,                -- hard submission cutoff
    late_policy             TEXT NOT NULL DEFAULT 'Allowed'
        CHECK (late_policy IN ('NotAllowed','Allowed')),
    allow_resubmission      BOOLEAN NOT NULL DEFAULT TRUE,
    max_submissions         INT,                                 -- NULL = unlimited versions

    status                  TEXT NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft','Scheduled','Published','Closed','Cancelled')),
    is_locked               BOOLEAN NOT NULL DEFAULT FALSE,      -- set on first submission/attempt
    cancelled_at            TIMESTAMPTZ,
    cancel_reason           TEXT,

    created_by              BIGINT NOT NULL REFERENCES users(id), -- audit only
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_asg_types CHECK (
        submission_types <@ ARRAY['None','Tick','Offline','Text','File','Link','Questions']
    ),
    CONSTRAINT chk_asg_dates CHECK (close_at >= due_at),
    CONSTRAINT chk_asg_late CHECK (late_policy = 'Allowed' OR close_at = due_at),
    CONSTRAINT chk_asg_marks CHECK (grading_mode <> 'Marks' OR max_marks IS NOT NULL),
    CONSTRAINT chk_asg_grade CHECK (grading_mode <> 'Grade' OR grading_scale_id IS NOT NULL),
    CONSTRAINT chk_asg_rubric CHECK (grading_mode <> 'Rubric' OR rubric_id IS NOT NULL)
);
CREATE INDEX idx_assignments_school_year ON assignments (school_id, academic_year_id, status);
CREATE INDEX idx_assignments_subject     ON assignments (subject_id, due_at);
CREATE INDEX idx_assignments_due         ON assignments (status, due_at);
CREATE INDEX idx_assignments_series      ON assignments (series_id) WHERE series_id IS NOT NULL;


-- Audience: whole section(s) or specific students.
CREATE TABLE assignment_targets (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    assignment_id           BIGINT NOT NULL REFERENCES assignments(id),
    target_type             TEXT NOT NULL CHECK (target_type IN ('Section','Student')),
    section_id              BIGINT REFERENCES sections(id),
    student_enrollment_id   BIGINT REFERENCES student_enrollments(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_target_shape CHECK (
        (target_type = 'Section' AND section_id IS NOT NULL AND student_enrollment_id IS NULL) OR
        (target_type = 'Student' AND student_enrollment_id IS NOT NULL AND section_id IS NULL)
    )
);
CREATE UNIQUE INDEX uq_target_section ON assignment_targets (assignment_id, section_id)
    WHERE section_id IS NOT NULL;
CREATE UNIQUE INDEX uq_target_student ON assignment_targets (assignment_id, student_enrollment_id)
    WHERE student_enrollment_id IS NOT NULL;
CREATE INDEX idx_target_section ON assignment_targets (section_id) WHERE section_id IS NOT NULL;


-- Teacher-provided reference material.
CREATE TABLE assignment_resources (
    id              BIGSERIAL PRIMARY KEY,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    assignment_id   BIGINT NOT NULL REFERENCES assignments(id),
    resource_type   TEXT NOT NULL CHECK (resource_type IN ('File','Link','Video')),
    file_id         BIGINT REFERENCES files(id),
    url             TEXT,
    title           VARCHAR(250),
    sort_order      INT NOT NULL DEFAULT 0,
    CONSTRAINT chk_resource_shape CHECK (
        (resource_type = 'File' AND file_id IS NOT NULL) OR
        (resource_type <> 'File' AND url IS NOT NULL)
    )
);
CREATE INDEX idx_asg_resources ON assignment_resources (assignment_id);


-- Snapshot of the assignment BEFORE any material edit after publish.
CREATE TABLE assignment_revisions (
    id              BIGSERIAL PRIMARY KEY,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    assignment_id   BIGINT NOT NULL REFERENCES assignments(id),
    revision_no     INT NOT NULL,
    snapshot        JSONB NOT NULL,
    change_summary  TEXT,
    changed_by      BIGINT NOT NULL REFERENCES users(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (assignment_id, revision_no)
);


-- ---------------------------------------------------------------------
-- 5. STUDENT_ASSIGNMENTS (resolved; authoritative per-student record)
-- Resolved at publish via student_subject_enrollments (so electives work).
-- Late joiners are backfilled with is_backfilled = TRUE: they can view
-- past assignments, but submission is governed purely by effective_close_at.
-- ---------------------------------------------------------------------
CREATE TABLE student_assignments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    assignment_id           BIGINT NOT NULL REFERENCES assignments(id),
    student_enrollment_id   BIGINT NOT NULL REFERENCES student_enrollments(id),
    section_id              BIGINT NOT NULL REFERENCES sections(id),   -- snapshot at resolve time

    status                  TEXT NOT NULL DEFAULT 'Assigned'
        CHECK (status IN ('Assigned','InProgress','Submitted','ResubmitRequested',
                          'Reviewed','Excused','Missing')),
    completion_source       TEXT
        CHECK (completion_source IN ('Student','Parent','TeacherVerified')),

    effective_due_at        TIMESTAMPTZ NOT NULL,     -- snapshot; extensions override
    effective_close_at      TIMESTAMPTZ NOT NULL,

    is_backfilled           BOOLEAN NOT NULL DEFAULT FALSE,
    counts_toward_stats     BOOLEAN NOT NULL DEFAULT TRUE,

    first_viewed_at         TIMESTAMPTZ,
    started_at              TIMESTAMPTZ,
    submitted_at            TIMESTAMPTZ,
    is_late                 BOOLEAN NOT NULL DEFAULT FALSE,
    submission_count        INT NOT NULL DEFAULT 0,

    -- denormalised from the current evaluation
    current_evaluation_id   BIGINT,                   -- FK added below
    current_marks           NUMERIC(7,2),
    current_grade           VARCHAR(20),
    reviewed_at             TIMESTAMPTZ,

    excused_by              BIGINT REFERENCES users(id),
    excused_reason          TEXT,
    excused_at              TIMESTAMPTZ,
    missing_marked_at       TIMESTAMPTZ,

    status_changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (assignment_id, student_enrollment_id)
);
CREATE INDEX idx_sa_enrollment_status ON student_assignments (student_enrollment_id, status);
CREATE INDEX idx_sa_assignment_status ON student_assignments (assignment_id, status);
CREATE INDEX idx_sa_section           ON student_assignments (section_id);
CREATE INDEX idx_sa_missing_job       ON student_assignments (effective_close_at)
    WHERE status IN ('Assigned','InProgress');


-- Per-student deadline overrides. Append-only.
CREATE TABLE assignment_extensions (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_assignment_id   BIGINT NOT NULL REFERENCES student_assignments(id),
    previous_due_at         TIMESTAMPTZ NOT NULL,
    previous_close_at       TIMESTAMPTZ NOT NULL,
    new_due_at              TIMESTAMPTZ NOT NULL,
    new_close_at            TIMESTAMPTZ NOT NULL,
    reason                  TEXT,
    granted_by              BIGINT NOT NULL REFERENCES users(id),
    granted_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asg_ext_sa ON assignment_extensions (student_assignment_id);


-- ---------------------------------------------------------------------
-- 6. SUBMISSIONS (immutable, versioned)
-- ---------------------------------------------------------------------
CREATE TABLE submissions (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_assignment_id   BIGINT NOT NULL REFERENCES student_assignments(id),
    version_no              INT NOT NULL,
    body_text               TEXT,
    link_url                TEXT,
    submitted_by_user_id    BIGINT NOT NULL REFERENCES users(id),
    submitted_by_role       TEXT NOT NULL
        CHECK (submitted_by_role IN ('Student','Parent','Teacher')),
    is_late                 BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_assignment_id, version_no)
);

CREATE TABLE submission_files (
    id              BIGSERIAL PRIMARY KEY,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    submission_id   BIGINT NOT NULL REFERENCES submissions(id),
    file_id         BIGINT NOT NULL REFERENCES files(id),
    sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_submission_files ON submission_files (submission_id);


-- ---------------------------------------------------------------------
-- 7. EVALUATIONS (append-only; regrade = new row, is_current flips)
-- ---------------------------------------------------------------------
CREATE TABLE assignment_evaluations (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_assignment_id   BIGINT NOT NULL REFERENCES student_assignments(id),
    submission_id           BIGINT REFERENCES submissions(id),   -- NULL for offline/completion
    outcome                 TEXT NOT NULL DEFAULT 'Reviewed'
        CHECK (outcome IN ('Reviewed','ResubmitRequested')),
    marks                   NUMERIC(7,2),
    grade                   VARCHAR(20),
    feedback                TEXT,
    is_current              BOOLEAN NOT NULL DEFAULT TRUE,
    evaluated_by            BIGINT REFERENCES users(id),         -- NULL when is_auto
    is_auto                 BOOLEAN NOT NULL DEFAULT FALSE,      -- system-graded (auto-scored questions)
    evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_eval_evaluator CHECK (is_auto OR evaluated_by IS NOT NULL)
);
CREATE UNIQUE INDEX uq_eval_current ON assignment_evaluations (student_assignment_id)
    WHERE is_current;
CREATE INDEX idx_eval_sa ON assignment_evaluations (student_assignment_id);

ALTER TABLE student_assignments
    ADD CONSTRAINT fk_sa_current_eval
    FOREIGN KEY (current_evaluation_id) REFERENCES assignment_evaluations(id);

CREATE TABLE evaluation_files (          -- annotated copies, feedback attachments
    id              BIGSERIAL PRIMARY KEY,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    evaluation_id   BIGINT NOT NULL REFERENCES assignment_evaluations(id),
    file_id         BIGINT NOT NULL REFERENCES files(id)
);
CREATE INDEX idx_eval_files ON evaluation_files (evaluation_id);

CREATE TABLE assignment_rubric_scores (
    id              BIGSERIAL PRIMARY KEY,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    evaluation_id   BIGINT NOT NULL REFERENCES assignment_evaluations(id),
    criterion_id    BIGINT NOT NULL REFERENCES rubric_criteria(id),
    level_id        BIGINT REFERENCES rubric_levels(id),
    points          NUMERIC(6,2) NOT NULL,
    comment         TEXT,
    UNIQUE (evaluation_id, criterion_id)
);


-- ---------------------------------------------------------------------
-- 8. COMMENTS & ACKNOWLEDGEMENTS
-- student_assignment_id NULL  => class-wide Q&A on the assignment
-- student_assignment_id SET   => private thread (student/parent <-> teacher)
-- ---------------------------------------------------------------------
CREATE TABLE assignment_comments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    assignment_id           BIGINT NOT NULL REFERENCES assignments(id),
    student_assignment_id   BIGINT REFERENCES student_assignments(id),
    parent_comment_id       BIGINT REFERENCES assignment_comments(id),
    author_user_id          BIGINT NOT NULL REFERENCES users(id),
    body                    TEXT NOT NULL,
    is_deleted              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at               TIMESTAMPTZ
);
CREATE INDEX idx_comments_assignment ON assignment_comments (assignment_id, created_at);
CREATE INDEX idx_comments_sa ON assignment_comments (student_assignment_id)
    WHERE student_assignment_id IS NOT NULL;

-- Digital replacement for the parent-signed homework diary.
CREATE TABLE assignment_acknowledgements (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_assignment_id   BIGINT NOT NULL REFERENCES student_assignments(id),
    guardian_user_id        BIGINT NOT NULL REFERENCES users(id),
    acknowledged_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_assignment_id, guardian_user_id)
);


-- ---------------------------------------------------------------------
-- 9. SUMMARY (pre-aggregated; same idea as attendance_summary)
-- subject_id NULL => across all subjects.
-- ---------------------------------------------------------------------
CREATE TABLE student_assignment_summary (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_enrollment_id   BIGINT NOT NULL REFERENCES student_enrollments(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    term_id                 BIGINT REFERENCES terms(id),
    subject_id              BIGINT REFERENCES subjects(id),
    period_type             TEXT NOT NULL CHECK (period_type IN ('Month','Term','Year')),
    period_start            DATE NOT NULL,

    total_assigned          INT NOT NULL DEFAULT 0,
    submitted_on_time       INT NOT NULL DEFAULT 0,
    submitted_late          INT NOT NULL DEFAULT 0,
    missing                 INT NOT NULL DEFAULT 0,
    excused                 INT NOT NULL DEFAULT 0,
    reviewed                INT NOT NULL DEFAULT 0,
    avg_score_percent       NUMERIC(5,2),

    computed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_asg_summary ON student_assignment_summary
    (student_enrollment_id, period_type, period_start, COALESCE(subject_id, 0));
CREATE INDEX idx_asg_summary_school ON student_assignment_summary (school_id, academic_year_id);
