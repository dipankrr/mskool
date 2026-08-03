-- =============================================================================
-- EXAMS & RESULTS
-- Template → Resolved → Computed pattern:
--   GradingScale + PassCriteria (config)
--   → Exam + ExamSubjectSchedule + ExamComponent (setup / template)
--     → StudentComponentResult (raw entered marks)
--       → StudentSubjectResult (computed per subject)
--         → StudentTermResult (computed per term)
--           → StudentFinalResult (computed annual)
--
-- Key principles:
--   - Marks stored as DECIMAL(6,2) — supports half-marks, negatives
--   - is_absent / is_exempted at component level (not just subject level)
--   - Results locked on publish — corrections via revision table only
--   - GradingScale never mutated after use — old results keep their reference
--   - Rank computed explicitly (triggered action), never live
--   - CoScholastic is a separate, simpler pipeline — never feeds into result math
-- =============================================================================


-- =============================================================================
-- 44. GRADING SCALES
-- Mark-range → grade/label lookup.
-- Assignable per school, per class, or per exam component.
-- Never mutated after results reference it — new scale = new row.
-- mode: fixed_range (common) or percentile_rank (reserved for board use).
-- =============================================================================
CREATE TABLE grading_scales (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    name                    VARCHAR(100) NOT NULL,           -- "Standard 10-Point", "CBSE 9-Point"
    description             VARCHAR(255),
    mode                    VARCHAR(20) NOT NULL DEFAULT 'Fixed_Range'
                                CHECK (mode IN (
                                    'Fixed_Range',          -- 90-100 → A+  (most schools)
                                    'Percentile_Rank'       -- reserved: board-style relative grading
                                )),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    -- once results reference this scale, it must not be modified
    -- is_locked set to TRUE when first StudentSubjectResult references it
    is_locked               BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT uq_gs_school_name UNIQUE (school_id, name)
);

CREATE INDEX idx_gs_school ON grading_scales(school_id) WHERE is_active = TRUE;

COMMENT ON TABLE grading_scales IS
    'Never mutated after is_locked = TRUE. If school changes grading policy,
     create a new GradingScale row. Old results keep reference to old scale.
     This ensures duplicate marksheets years later reproduce exactly.';


-- =============================================================================
-- 45. GRADING SCALE BANDS
-- Individual ranges within a grading scale.
-- e.g. {90-100 → A+, grade_point: 10.0, descriptor: "Outstanding"}
-- =============================================================================
CREATE TABLE grading_scale_bands (
    id                      BIGSERIAL PRIMARY KEY,
    grading_scale_id        BIGINT NOT NULL REFERENCES grading_scales(id),

    min_marks               DECIMAL(6,2) NOT NULL,
    max_marks               DECIMAL(6,2) NOT NULL,
    grade_label             VARCHAR(10) NOT NULL,            -- "A+", "B2", "Distinction"
    grade_point             DECIMAL(4,2),                    -- GPA value, nullable
    descriptor              VARCHAR(100),                    -- "Outstanding", "Satisfactory"
    sequence_number         SMALLINT NOT NULL,               -- for ordering display

    CONSTRAINT chk_gsb_range CHECK (max_marks >= min_marks),
    CONSTRAINT uq_gsb_label UNIQUE (grading_scale_id, grade_label)
);

CREATE INDEX idx_gsb_scale ON grading_scale_bands(grading_scale_id);


-- =============================================================================
-- 46. PASS CRITERIA  (School/class-level config)
-- Defines what "passing" means for a school or specific class.
-- Class-level row overrides school default when present.
-- =============================================================================
CREATE TABLE pass_criteria (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    class_id                BIGINT REFERENCES classes(id),  -- NULL = school-wide default
    academic_year_id        BIGINT REFERENCES academic_years(id),

    -- minimum subjects that must be passed
    min_subjects_to_pass    SMALLINT,                       -- NULL = all subjects must be passed
    -- subjects that are MANDATORY to pass regardless of min_subjects_to_pass
    mandatory_pass_subject_ids BIGINT[],

    -- grace marks
    grace_marks_allowed     BOOLEAN NOT NULL DEFAULT FALSE,
    max_grace_per_subject   DECIMAL(5,2),
    max_grace_total         DECIMAL(5,2),

    -- compartment (conditional promotion)
    compartment_allowed     BOOLEAN NOT NULL DEFAULT FALSE,
    max_subjects_for_compartment SMALLINT,

    -- minimum attendance % required to sit exams
    min_attendance_pct      DECIMAL(5,2) NOT NULL DEFAULT 75.00,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_pc_school_class_year UNIQUE (school_id, class_id, academic_year_id)
);

CREATE INDEX idx_pc_school ON pass_criteria(school_id);


-- =============================================================================
-- 47. EXAMS
-- An exam event scoped to a Term.
-- type: Regular (unit test, half-yearly, term exam), Supplementary, Improvement.
-- weightage_in_term: contribution toward this term's result.
-- =============================================================================
CREATE TABLE exams (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    term_id                 BIGINT NOT NULL REFERENCES terms(id),

    name                    VARCHAR(150) NOT NULL,           -- "Unit Test 1", "Half-Yearly", "Term 3 Exam"
    exam_type               VARCHAR(20) NOT NULL DEFAULT 'Regular'
                                CHECK (exam_type IN ('Regular','Supplementary','Improvement','Mock')),

    -- for Supplementary/Improvement: link to the original exam
    linked_exam_id          BIGINT REFERENCES exams(id),
    -- for supplementary: is the result capped at pass marks?
    supplementary_capped_at_pass BOOLEAN NOT NULL DEFAULT FALSE,

    -- contribution toward term result (all exams in a term must sum to 100)
    weightage_in_term       DECIMAL(5,2) NOT NULL DEFAULT 100.00
                                CHECK (weightage_in_term > 0 AND weightage_in_term <= 100),

    allows_negative_marking BOOLEAN NOT NULL DEFAULT FALSE,

    -- exam lifecycle
    status                  VARCHAR(20) NOT NULL DEFAULT 'Draft'
                                CHECK (status IN (
                                    'Draft',
                                    'Scheduled',
                                    'Ongoing',
                                    'Marks_Entry',      -- marks entry open
                                    'Under_Verification',
                                    'Published',        -- results visible to parents/students
                                    'Locked'            -- archived, no further changes
                                )),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_exams_school_year ON exams(school_id, academic_year_id);
CREATE INDEX idx_exams_term ON exams(term_id);


-- =============================================================================
-- 48. EXAM SUBJECT SCHEDULES  (Template layer)
-- Defines which subjects are examined, for which class/section,
-- on which date, with what component structure.
-- Defaults to class-wide; section_id populated only for section-level overrides.
-- Locked once any marks entry begins (is_locked).
-- =============================================================================
CREATE TABLE exam_subject_schedules (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    exam_id                 BIGINT NOT NULL REFERENCES exams(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),
    section_id              BIGINT REFERENCES sections(id),     -- NULL = all sections of class
    subject_id              BIGINT NOT NULL REFERENCES subjects(id),
    subject_group_id        BIGINT REFERENCES subject_groups(id),

    exam_date               DATE,
    start_time              TIME,
    duration_minutes        SMALLINT,
    venue                   VARCHAR(100),

    -- inherited from subject but can be overridden per schedule
    counts_towards_result   BOOLEAN NOT NULL DEFAULT TRUE,
    is_graded_only          BOOLEAN NOT NULL DEFAULT FALSE,

    -- prevents structural changes once marks entry begins
    is_locked               BOOLEAN NOT NULL DEFAULT FALSE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_ess_exam_class_subject UNIQUE (exam_id, class_id, section_id, subject_id)
);

CREATE INDEX idx_ess_exam ON exam_subject_schedules(exam_id);
CREATE INDEX idx_ess_class ON exam_subject_schedules(class_id, exam_id);


-- =============================================================================
-- 49. EXAM COMPONENTS
-- Theory / Practical / Oral / Internal Assessment / Project —
-- each with own max marks, pass marks, weightage, and optional grading scale.
-- Independent pass check per component (is_mandatory_pass) handles CBSE rule:
-- must pass Theory separately from Practical.
-- =============================================================================
CREATE TABLE exam_components (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    schedule_id             BIGINT NOT NULL REFERENCES exam_subject_schedules(id),
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    name                    VARCHAR(50) NOT NULL,            -- "Theory", "Practical", "Oral", "Internal"
    sequence_number         SMALLINT NOT NULL DEFAULT 1,

    max_marks               DECIMAL(6,2) NOT NULL CHECK (max_marks > 0),
    pass_marks              DECIMAL(6,2) NOT NULL CHECK (pass_marks >= 0),
    -- contribution to subject total (all components in a subject must sum to 100)
    weightage_percentage    DECIMAL(5,2) NOT NULL DEFAULT 100.00
                                CHECK (weightage_percentage > 0 AND weightage_percentage <= 100),

    -- must pass this component independently regardless of subject total
    is_mandatory_pass       BOOLEAN NOT NULL DEFAULT FALSE,

    -- negative marking (overrides exam-level setting for this component)
    allows_negative_marking BOOLEAN NOT NULL DEFAULT FALSE,
    negative_marks_per_wrong DECIMAL(4,2),

    -- optional: this component gets its own independent grade (ICSE case)
    grading_scale_id        BIGINT REFERENCES grading_scales(id),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_ec_schedule_name UNIQUE (schedule_id, name)
);

CREATE INDEX idx_ec_schedule ON exam_components(schedule_id);


-- =============================================================================
-- 50. EXAM ELIGIBILITY  (Attendance-based check)
-- Pre-computed per student per exam: eligible to sit or not.
-- Reads from attendance_summary (min_attendance_pct from pass_criteria).
-- Manual override possible with approval + audit trail.
-- =============================================================================
CREATE TABLE exam_eligibility (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    exam_id                 BIGINT NOT NULL REFERENCES exams(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    attendance_percentage   DECIMAL(5,2) NOT NULL,
    min_required_pct        DECIMAL(5,2) NOT NULL,
    is_eligible             BOOLEAN NOT NULL,

    -- manual override
    is_overridden           BOOLEAN NOT NULL DEFAULT FALSE,
    override_eligible       BOOLEAN,
    override_reason         VARCHAR(500),
    overridden_by           BIGINT REFERENCES users(id),
    overridden_at           TIMESTAMPTZ,

    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_ee_student_exam UNIQUE (student_id, exam_id)
);

CREATE INDEX idx_ee_exam ON exam_eligibility(exam_id);
CREATE INDEX idx_ee_student ON exam_eligibility(student_id);


-- =============================================================================
-- 51. STUDENT COMPONENT RESULTS  (Raw entered marks — the ground truth)
-- One row per student per component per exam.
-- Created in Draft state; progresses through verification to Published/Locked.
-- NEVER overwritten after Published — corrections via StudentComponentResultRevisions.
-- =============================================================================
CREATE TABLE student_component_results (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    exam_id                 BIGINT NOT NULL REFERENCES exams(id),
    schedule_id             BIGINT NOT NULL REFERENCES exam_subject_schedules(id),
    component_id            BIGINT NOT NULL REFERENCES exam_components(id),
    subject_id              BIGINT NOT NULL REFERENCES subjects(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    -- actual marks — DECIMAL supports half-marks and negatives
    marks_obtained          DECIMAL(6,2),                    -- NULL if absent or grade-only
    grade_obtained          VARCHAR(10),                     -- computed from grading scale, or entered directly

    -- student states (independent of marks)
    is_absent               BOOLEAN NOT NULL DEFAULT FALSE,  -- component-level absence
    is_exempted             BOOLEAN NOT NULL DEFAULT FALSE,
    exemption_type          VARCHAR(30)
                                CHECK (exemption_type IN ('Medical','Disability','Board_Approved','Other')),
    recomputation_method    VARCHAR(50),                     -- how to handle subject total when exempted

    -- lifecycle
    result_status           VARCHAR(20) NOT NULL DEFAULT 'Draft'
                                CHECK (result_status IN (
                                    'Draft',            -- being entered, partial saves OK
                                    'Entered',          -- teacher marked as complete
                                    'Verified',         -- senior staff verified
                                    'Published',        -- visible to parent/student
                                    'Locked'            -- archived
                                )),

    -- for bulk imports: which import batch created this row
    import_batch_id         UUID,

    entered_by              BIGINT REFERENCES users(id),
    entered_at              TIMESTAMPTZ,
    verified_by             BIGINT REFERENCES users(id),
    verified_at             TIMESTAMPTZ,
    published_at            TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_scr_student_component UNIQUE (student_id, exam_id, component_id),
    CONSTRAINT chk_scr_marks CHECK (
        -- if absent or grade-only, marks can be null; otherwise must be present
        is_absent = TRUE OR is_exempted = TRUE OR marks_obtained IS NOT NULL OR grade_obtained IS NOT NULL
    )
);

CREATE INDEX idx_scr_exam ON student_component_results(exam_id);
CREATE INDEX idx_scr_student_exam ON student_component_results(student_id, exam_id);
CREATE INDEX idx_scr_schedule ON student_component_results(schedule_id);
CREATE INDEX idx_scr_status ON student_component_results(exam_id, result_status);

-- DB-level guard: marks cannot exceed component max
-- Note: max_marks lives in exam_components; enforced via trigger (see below)


-- =============================================================================
-- 52. STUDENT COMPONENT RESULT REVISIONS  (Audit trail for corrections)
-- Every post-publish correction creates a row here.
-- Original StudentComponentResult is updated (marks changed) but this table
-- permanently preserves what it was before, who changed it, and why.
-- =============================================================================
CREATE TABLE student_component_result_revisions (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    original_result_id      BIGINT NOT NULL REFERENCES student_component_results(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    exam_id                 BIGINT NOT NULL REFERENCES exams(id),

    previous_marks          DECIMAL(6,2),
    revised_marks           DECIMAL(6,2),
    previous_grade          VARCHAR(10),
    revised_grade           VARCHAR(10),
    previous_status         VARCHAR(20),                    -- was_absent, was_exempted
    revised_status          VARCHAR(20),

    reason                  VARCHAR(500) NOT NULL,
    revision_type           VARCHAR(30) NOT NULL
                                CHECK (revision_type IN (
                                    'Marks_Correction',
                                    'Re_Evaluation',
                                    'Data_Entry_Error',
                                    'Other'
                                )),

    requested_by            BIGINT REFERENCES users(id),
    approved_by             BIGINT NOT NULL REFERENCES users(id),
    revised_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scrr_result ON student_component_result_revisions(original_result_id);
CREATE INDEX idx_scrr_exam ON student_component_result_revisions(exam_id);


-- =============================================================================
-- 53. STUDENT SUBJECT RESULTS  (Computed from components)
-- One row per student per subject per exam.
-- Computed: weighted rollup of component marks → grace → pass/fail → grade.
-- Stores both raw (before grace) and final (after grace) for full audit trail.
-- =============================================================================
CREATE TABLE student_subject_results (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    exam_id                 BIGINT NOT NULL REFERENCES exams(id),
    schedule_id             BIGINT NOT NULL REFERENCES exam_subject_schedules(id),
    subject_id              BIGINT NOT NULL REFERENCES subjects(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    -- computed marks
    marks_obtained          DECIMAL(6,2),                   -- weighted sum of components (before grace)
    max_marks               DECIMAL(6,2) NOT NULL,
    pass_marks              DECIMAL(6,2) NOT NULL,

    -- grace tracking
    marks_before_grace      DECIMAL(6,2),
    grace_marks_applied     DECIMAL(6,2) NOT NULL DEFAULT 0,
    final_marks             DECIMAL(6,2),                   -- marks_obtained + grace_marks_applied

    -- pass/fail — independently evaluated
    is_passed               BOOLEAN,
    failed_components       JSONB,                          -- [{component_id, component_name}] if any mandatory component failed

    -- absence/exemption at subject level (derived from components)
    is_absent               BOOLEAN NOT NULL DEFAULT FALSE,
    is_exempted             BOOLEAN NOT NULL DEFAULT FALSE,

    -- grade applied after grace, from grading scale
    grade                   VARCHAR(10),
    grade_point             DECIMAL(4,2),
    grading_scale_id        BIGINT REFERENCES grading_scales(id),  -- snapshotted reference

    -- rank within class/section — NULL until explicitly computed
    rank_in_class           SMALLINT,
    rank_in_section         SMALLINT,
    rank_computed_at        TIMESTAMPTZ,

    result_status           VARCHAR(20) NOT NULL DEFAULT 'Draft'
                                CHECK (result_status IN ('Draft','Published','Locked')),
    published_at            TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_ssr_student_exam_subject UNIQUE (student_id, exam_id, subject_id)
);

CREATE INDEX idx_ssr_exam ON student_subject_results(exam_id);
CREATE INDEX idx_ssr_student ON student_subject_results(student_id, academic_year_id);
CREATE INDEX idx_ssr_subject ON student_subject_results(subject_id, exam_id);


-- =============================================================================
-- 54. STUDENT TERM RESULTS  (Computed per term)
-- Weighted rollup of all Exam results within a Term.
-- counts_towards_result subjects excluded from total math.
-- Co-scholastic results sit alongside but don't affect this computation.
-- =============================================================================
CREATE TABLE student_term_results (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    term_id                 BIGINT NOT NULL REFERENCES terms(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),
    section_id              BIGINT REFERENCES sections(id),  -- snapshotted

    -- only counts_towards_result=TRUE subjects included in these totals
    total_marks_obtained    DECIMAL(8,2),
    total_max_marks         DECIMAL(8,2),
    percentage              DECIMAL(5,2),
    grade                   VARCHAR(10),
    grade_point             DECIMAL(4,2),

    is_passed               BOOLEAN,
    subjects_failed_count   SMALLINT NOT NULL DEFAULT 0,
    subjects_failed         BIGINT[],                       -- array of subject_ids

    -- attendance for this term (from attendance_summary)
    attendance_percentage   DECIMAL(5,2),

    rank_in_class           SMALLINT,
    rank_in_section         SMALLINT,
    rank_computed_at        TIMESTAMPTZ,

    result_status           VARCHAR(20) NOT NULL DEFAULT 'Draft'
                                CHECK (result_status IN ('Draft','Published','Locked')),
    published_at            TIMESTAMPTZ,
    published_by            BIGINT REFERENCES users(id),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_str_student_term UNIQUE (student_id, term_id)
);

CREATE INDEX idx_str_term ON student_term_results(term_id);
CREATE INDEX idx_str_student ON student_term_results(student_id, academic_year_id);


-- =============================================================================
-- 55. STUDENT FINAL RESULTS  (Computed annual — closes the academic loop)
-- Rollup from Terms per school's cumulative/terminal rule.
-- promotion_status feeds next year's StudentEnrollment creation.
-- =============================================================================
CREATE TABLE student_final_results (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),  -- snapshotted
    section_id              BIGINT REFERENCES sections(id),           -- snapshotted

    total_marks_obtained    DECIMAL(8,2),
    total_max_marks         DECIMAL(8,2),
    percentage              DECIMAL(5,2),
    grade                   VARCHAR(10),
    grade_point             DECIMAL(4,2),

    is_passed               BOOLEAN,
    subjects_failed_count   SMALLINT NOT NULL DEFAULT 0,
    subjects_failed         BIGINT[],

    -- annual attendance
    attendance_percentage   DECIMAL(5,2),

    rank_in_class           SMALLINT,
    rank_in_section         SMALLINT,
    rank_computed_at        TIMESTAMPTZ,

    promotion_status        VARCHAR(30)
                                CHECK (promotion_status IN (
                                    'Pending',
                                    'Promoted',
                                    'Detained',
                                    'Compartment',
                                    'Promoted_With_Improvement'
                                )),
    compartment_subjects    BIGINT[],                       -- subject_ids with compartment

    result_status           VARCHAR(20) NOT NULL DEFAULT 'Draft'
                                CHECK (result_status IN ('Draft','Published','Locked')),
    published_at            TIMESTAMPTZ,
    published_by            BIGINT REFERENCES users(id),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_sfr_student_year UNIQUE (student_id, academic_year_id)
);

CREATE INDEX idx_sfr_student ON student_final_results(student_id);
CREATE INDEX idx_sfr_school_year ON student_final_results(school_id, academic_year_id);


-- =============================================================================
-- 56. CO-SCHOLASTIC ASSESSMENTS
-- Separate pipeline: Life Skills, Art, PE, Discipline, Values, Work Education.
-- Teacher-observed, grade/descriptor only — no marks, no components.
-- Feeds the same report card but NEVER touches result math or pass/fail.
-- =============================================================================
CREATE TABLE coscholastic_assessments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    term_id                 BIGINT NOT NULL REFERENCES terms(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    area                    VARCHAR(50) NOT NULL
                                CHECK (area IN (
                                    'Life_Skills',
                                    'Art_Education',
                                    'Health_Physical_Education',
                                    'Work_Education',
                                    'Discipline',
                                    'Values_Attitudes',
                                    'Other'
                                )),
    area_custom_name        VARCHAR(100),                   -- for 'Other' area type

    grade                   VARCHAR(10),                    -- "A", "B", "Outstanding"
    descriptor              VARCHAR(100),                   -- "Excellent", "Needs Improvement"
    teacher_remarks         VARCHAR(500),

    assessed_by             BIGINT REFERENCES users(id),
    assessment_status       VARCHAR(20) NOT NULL DEFAULT 'Draft'
                                CHECK (assessment_status IN ('Draft','Published','Locked')),
    published_at            TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_ca_student_term_area UNIQUE (student_id, term_id, area)
);

CREATE INDEX idx_ca_student_term ON coscholastic_assessments(student_id, term_id);
CREATE INDEX idx_ca_term ON coscholastic_assessments(term_id);


-- =============================================================================
-- 57. REPORT CARD TEMPLATES
-- Configurable per class-group — different format for primary vs secondary.
-- Controls layout, which sections appear, language, display options.
-- =============================================================================
CREATE TABLE report_card_templates (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT REFERENCES academic_years(id),  -- NULL = applies across years

    name                    VARCHAR(150) NOT NULL,
    -- which classes use this template (array of class_ids)
    applicable_class_ids    BIGINT[],

    -- layout and display config as JSONB (flexible without schema changes)
    layout_config           JSONB NOT NULL DEFAULT '{}',
    -- e.g. {
    --   "show_marks": true,
    --   "show_grade": true,
    --   "show_rank": false,
    --   "show_attendance": true,
    --   "show_coscholastic": true,
    --   "show_teacher_remarks": true,
    --   "grading_display_mode": "both",   -- "marks_only" | "grade_only" | "both"
    --   "language": "en",
    --   "header_text": "Progress Report",
    --   "footer_text": "..."
    -- }

    is_default              BOOLEAN NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_rct_school ON report_card_templates(school_id);


-- =============================================================================
-- 58. PUBLISHED REPORT CARDS  (Versioned snapshots)
-- Stores a snapshot of the report card at the time of publish.
-- When a correction is made post-publish, old version preserved, new version
-- added with is_current = TRUE.
-- Ensures a duplicate marksheet request years later reproduces exactly.
-- =============================================================================
CREATE TABLE published_report_cards (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    term_id                 BIGINT REFERENCES terms(id),    -- NULL = annual/final report card

    version                 SMALLINT NOT NULL DEFAULT 1,
    is_current              BOOLEAN NOT NULL DEFAULT TRUE,

    -- full snapshot of report card data at publish time
    -- includes: student name (legal), school name, marks, grades, attendance,
    -- co-scholastic, teacher remarks, grading scale used — everything frozen
    snapshot_data           JSONB NOT NULL,
    template_id             BIGINT REFERENCES report_card_templates(id),

    -- for revised versions
    revision_reason         VARCHAR(500),
    replaces_version        SMALLINT,                       -- previous version this replaces

    published_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_by            BIGINT NOT NULL REFERENCES users(id),

    CONSTRAINT uq_prc_student_term_version UNIQUE (student_id, academic_year_id, term_id, version)
);

CREATE INDEX idx_prc_student ON published_report_cards(student_id, academic_year_id);
CREATE INDEX idx_prc_current ON published_report_cards(student_id, academic_year_id)
    WHERE is_current = TRUE;

COMMENT ON TABLE published_report_cards IS
    'Versioned snapshot. When a correction is published, previous version stays.
     New version inserted with is_current=TRUE and replaces_version set.
     Guarantees exact reproduction of any historical report card on demand.';


-- =============================================================================
-- TRIGGER: Prevent marks from exceeding component max_marks
-- Application layer validates too, but DB constraint is the safety net.
-- =============================================================================
CREATE OR REPLACE FUNCTION check_marks_not_exceed_max()
RETURNS TRIGGER AS $$
DECLARE
    v_max_marks DECIMAL(6,2);
BEGIN
    SELECT max_marks INTO v_max_marks
    FROM exam_components
    WHERE id = NEW.component_id;

    IF NEW.marks_obtained IS NOT NULL AND NEW.marks_obtained > v_max_marks THEN
        RAISE EXCEPTION
            'marks_obtained (%) exceeds max_marks (%) for component_id %',
            NEW.marks_obtained, v_max_marks, NEW.component_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_marks_max
    BEFORE INSERT OR UPDATE ON student_component_results
    FOR EACH ROW EXECUTE FUNCTION check_marks_not_exceed_max();


-- =============================================================================
-- TRIGGER: Lock grading scale once first result references it
-- =============================================================================
CREATE OR REPLACE FUNCTION lock_grading_scale_on_use()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.grading_scale_id IS NOT NULL THEN
        UPDATE grading_scales
        SET is_locked = TRUE
        WHERE id = NEW.grading_scale_id AND is_locked = FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lock_grading_scale
    AFTER INSERT ON student_subject_results
    FOR EACH ROW EXECUTE FUNCTION lock_grading_scale_on_use();


-- =============================================================================
-- TRIGGER: Auto-set updated_at on key tables
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'organizations','schools','users','user_school_assignments',
        'academic_years','terms','academic_calendar','classes','sections',
        'subjects','fee_heads','fee_structures','student_fee_assignments',
        'fee_installments','fee_payments','student_enrollments',
        'student_subject_enrollments','exams','exam_subject_schedules',
        'student_component_results','student_subject_results',
        'student_term_results','student_final_results',
        'coscholastic_assessments','report_card_templates'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_set_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            t
        );
    END LOOP;
END;
$$;
