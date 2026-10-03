-- =====================================================================
-- 07_questions.sql
-- Question-based assignments (MCQ, fill-blank, written, file upload...)
-- Depends on: 06_assignments
--
-- Design notes
--  * Questions are part of an assignment, not a separate entity. Any assignment
--    with 'Questions' in submission_types has a question set. Question types can be
--    mixed freely in one assignment (MCQ, fill-blank, written, FileUpload...).
--    An assignment may ALSO allow a free-form response (Text/File/Link) via
--    submission_types; that goes through `submissions` (06), while question
--    answers go through `question_attempts` (07). kind = 'Quiz' is only a display label.
--  * No timer. The only time limit is the assignment deadline
--    (student_assignments.effective_close_at). Attempts must start before it.
--  * assignment_questions holds a SNAPSHOT of each question and its answer
--    key, so editing the question bank never changes an assignment already given.
--  * assignment_questions.correct_answer / options.is_correct must NEVER be
--    returned to a student session. Serve students from a separate read model.
--  * Questions lock when assignments.is_locked = TRUE (first attempt).
--  * Question scores are standalone: no impact on exams / report cards.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. QUESTION BANK (reusable)
-- visibility 'Platform' deliberately left out until curation exists.
-- ---------------------------------------------------------------------
CREATE TABLE question_bank_items (
    id              BIGSERIAL PRIMARY KEY,
    public_id       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    subject_id      BIGINT NOT NULL REFERENCES subjects(id),
    class_id        BIGINT REFERENCES classes(id),
    topic           VARCHAR(250),

    question_type   TEXT NOT NULL
        CHECK (question_type IN ('MCQ_Single','MCQ_Multi','TrueFalse','FillBlank',
                                 'Numeric','Match','ShortAnswer','LongAnswer',
                                 'FileUpload')),
    body            TEXT NOT NULL,
    image_file_id   BIGINT REFERENCES files(id),
    -- Answer key for non-option types, e.g.
    --   FillBlank: {"accepted":["photosynthesis"],"case_sensitive":false}
    --   Numeric:   {"value":9.8,"tolerance":0.1}
    --   Match:     {"pairs":[["A","2"],["B","1"]]}
    --   TrueFalse: {"value":true}
    -- NULL for MCQ (uses question_options) and Short/Long (manual review).
    correct_answer  JSONB,
    explanation     TEXT,
    difficulty      TEXT NOT NULL DEFAULT 'Medium'
        CHECK (difficulty IN ('Easy','Medium','Hard')),
    default_marks   NUMERIC(6,2) NOT NULL DEFAULT 1,

    visibility      TEXT NOT NULL DEFAULT 'Private'
        CHECK (visibility IN ('Private','School')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      BIGINT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qbank_lookup ON question_bank_items
    (school_id, subject_id, class_id, difficulty) WHERE is_active;

CREATE TABLE question_options (
    id              BIGSERIAL PRIMARY KEY,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    question_id     BIGINT NOT NULL REFERENCES question_bank_items(id),
    option_text     TEXT NOT NULL,
    image_file_id   BIGINT REFERENCES files(id),
    is_correct      BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_qoptions_question ON question_options (question_id);


-- ---------------------------------------------------------------------
-- 2. QUESTION-SET CONFIG (1:1 with assignment)
-- ---------------------------------------------------------------------
CREATE TABLE assignment_question_settings (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    assignment_id           BIGINT NOT NULL UNIQUE REFERENCES assignments(id),

    shuffle_questions       BOOLEAN NOT NULL DEFAULT FALSE,
    shuffle_options         BOOLEAN NOT NULL DEFAULT FALSE,
    one_question_at_a_time  BOOLEAN NOT NULL DEFAULT FALSE,
    max_attempts            INT NOT NULL DEFAULT 1,
    attempt_scoring         TEXT NOT NULL DEFAULT 'Best'
        CHECK (attempt_scoring IN ('Best','Latest','First')),

    show_score              TEXT NOT NULL DEFAULT 'AfterSubmit'
        CHECK (show_score IN ('Never','AfterSubmit','AfterClose')),
    show_answers            TEXT NOT NULL DEFAULT 'AfterClose'
        CHECK (show_answers IN ('Never','AfterSubmit','AfterClose')),
    show_explanations       BOOLEAN NOT NULL DEFAULT TRUE
);


-- ---------------------------------------------------------------------
-- 3. ASSIGNMENT QUESTIONS (snapshotted into the assignment)
-- ---------------------------------------------------------------------
CREATE TABLE assignment_questions (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id           BIGINT NOT NULL REFERENCES schools(id),
    assignment_id       BIGINT NOT NULL REFERENCES assignments(id),
    source_question_id  BIGINT REFERENCES question_bank_items(id),  -- provenance only
    position            INT NOT NULL,

    question_type       TEXT NOT NULL
        CHECK (question_type IN ('MCQ_Single','MCQ_Multi','TrueFalse','FillBlank',
                                 'Numeric','Match','ShortAnswer','LongAnswer',
                                 'FileUpload')),
    body                TEXT NOT NULL,
    image_file_id       BIGINT REFERENCES files(id),
    -- [{"id":1,"text":"...","image_file_id":null,"is_correct":true}, ...]
    options             JSONB,
    correct_answer      JSONB,
    explanation         TEXT,
    marks               NUMERIC(6,2) NOT NULL DEFAULT 1,

    UNIQUE (assignment_id, position)
);
CREATE INDEX idx_asg_questions ON assignment_questions (assignment_id);


-- ---------------------------------------------------------------------
-- 4. ATTEMPTS & ANSWERS
-- ---------------------------------------------------------------------
CREATE TABLE question_attempts (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_assignment_id   BIGINT NOT NULL REFERENCES student_assignments(id),
    attempt_no              INT NOT NULL,

    status                  TEXT NOT NULL DEFAULT 'InProgress'
        CHECK (status IN ('InProgress','Submitted','Graded')),
    question_order          JSONB,                    -- per-attempt shuffle
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at            TIMESTAMPTZ,
    is_late                 BOOLEAN NOT NULL DEFAULT FALSE,

    score_auto              NUMERIC(7,2) NOT NULL DEFAULT 0,
    score_manual            NUMERIC(7,2) NOT NULL DEFAULT 0,
    total_score             NUMERIC(7,2) NOT NULL DEFAULT 0,
    max_score               NUMERIC(7,2) NOT NULL DEFAULT 0,

    UNIQUE (student_assignment_id, attempt_no)
);
CREATE INDEX idx_attempts_sa ON question_attempts (student_assignment_id);

CREATE TABLE question_attempt_answers (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    attempt_id              BIGINT NOT NULL REFERENCES question_attempts(id),
    assignment_question_id  BIGINT NOT NULL REFERENCES assignment_questions(id),
    -- MCQ: {"option_ids":[2]}  Text: {"text":"..."}  Numeric: {"value":9.8}
    answer                  JSONB,
    is_correct              BOOLEAN,                  -- NULL until graded
    marks_awarded           NUMERIC(6,2),
    needs_manual_review     BOOLEAN NOT NULL DEFAULT FALSE,
    feedback                TEXT,
    graded_by               BIGINT REFERENCES users(id),  -- NULL = auto-graded
    graded_at               TIMESTAMPTZ,
    answered_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (attempt_id, assignment_question_id)
);
CREATE INDEX idx_attempt_answers_review ON question_attempt_answers (attempt_id)
    WHERE needs_manual_review;

-- Uploads for FileUpload-type questions (e.g. photo of worked solution).
-- FileUpload answers are always needs_manual_review = TRUE.
CREATE TABLE question_attempt_answer_files (
    id              BIGSERIAL PRIMARY KEY,
    school_id       BIGINT NOT NULL REFERENCES schools(id),
    answer_id       BIGINT NOT NULL REFERENCES question_attempt_answers(id),
    file_id         BIGINT NOT NULL REFERENCES files(id),
    sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_attempt_answer_files ON question_attempt_answer_files (answer_id);
