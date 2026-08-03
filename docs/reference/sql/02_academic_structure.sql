-- =============================================================================
-- ACADEMIC STRUCTURE
-- Dependency order:
--   organizations → academic_year_templates
--   schools → academic_years → terms → academic_calendar
--   schools → classes → sections
--   system_subject_catalog → subjects → class_subject_mappings
--   students → student_enrollments → student_subject_enrollments
-- =============================================================================


-- =============================================================================
-- 5. ACADEMIC YEAR TEMPLATES  (Org-level)
-- Org defines a reusable template so "start new session" can bulk-create
-- AcademicYear rows across all active branches in one action.
-- Each generated AcademicYear is fully independent after creation.
-- =============================================================================
CREATE TABLE academic_year_templates (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    organization_id         BIGINT NOT NULL REFERENCES organizations(id),

    name                    VARCHAR(100) NOT NULL,           -- e.g. "Standard 2-Term Year"
    default_start_month     SMALLINT NOT NULL                -- 1-12
                                CHECK (default_start_month BETWEEN 1 AND 12),
    default_end_month       SMALLINT NOT NULL
                                CHECK (default_end_month BETWEEN 1 AND 12),
    -- term structure stored as JSONB: [{name, sequence, weightage, result_mode}]
    -- kept as JSONB since it's a template config, not queried relationally
    term_structure          JSONB NOT NULL DEFAULT '[]',
    is_default              BOOLEAN NOT NULL DEFAULT FALSE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_ayt_org ON academic_year_templates(organization_id);


-- =============================================================================
-- 6. ACADEMIC YEARS
-- One row per school per year. The primary scoping key for all time-bound data
-- (enrollment, attendance, fees, exams).
-- Overlapping years for the same school are prevented by exclusion constraint.
-- =============================================================================
CREATE TABLE academic_years (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    name                    VARCHAR(20) NOT NULL,            -- e.g. "2025-26"
    start_date              DATE NOT NULL,
    end_date                DATE NOT NULL,
    original_end_date       DATE NOT NULL,                   -- preserved if year is extended later

    status                  VARCHAR(20) NOT NULL DEFAULT 'Upcoming'
                                CHECK (status IN ('Upcoming','Active','Closing','Closed')),
    is_current              BOOLEAN NOT NULL DEFAULT FALSE,

    -- if bulk-created from org template, track origin
    created_from_template_id BIGINT REFERENCES academic_year_templates(id),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT chk_ay_dates CHECK (end_date >= start_date),

    -- only one current year per school at a time
    CONSTRAINT uq_ay_current_per_school EXCLUDE USING btree (school_id WITH =)
        WHERE (is_current = TRUE),

    -- no overlapping date ranges for same school
    CONSTRAINT uq_ay_no_overlap EXCLUDE USING gist (
        school_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    )
);

CREATE INDEX idx_ay_school ON academic_years(school_id);
CREATE INDEX idx_ay_current ON academic_years(school_id) WHERE is_current = TRUE;

COMMENT ON COLUMN academic_years.original_end_date IS
    'Frozen at creation. end_date may be updated if year is extended; this preserves original intent.';


-- =============================================================================
-- 7. TERMS
-- Subdivisions of an academic year (Term 1, Term 2, or "Full Year" if no splits).
-- Every AcademicYear has at least one Term — enforced at application layer.
-- =============================================================================
CREATE TABLE terms (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    name                    VARCHAR(100) NOT NULL,           -- "Term 1", "First Term", "Full Year"
    sequence_number         SMALLINT NOT NULL,               -- for ordering
    start_date              DATE NOT NULL,
    end_date                DATE NOT NULL,

    -- how does this term contribute to the Final/Annual result?
    result_mode             VARCHAR(20) NOT NULL DEFAULT 'Cumulative'
                                CHECK (result_mode IN ('Cumulative','Terminal')),
    -- percentage weight toward annual result (all terms in a year must sum to 100)
    weightage               DECIMAL(5,2) NOT NULL DEFAULT 100.00
                                CHECK (weightage > 0 AND weightage <= 100),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT chk_term_dates CHECK (end_date >= start_date),
    CONSTRAINT uq_term_sequence UNIQUE (academic_year_id, sequence_number)
);

CREATE INDEX idx_terms_ay ON terms(academic_year_id);
CREATE INDEX idx_terms_school ON terms(school_id);


-- =============================================================================
-- 8. ACADEMIC CALENDAR
-- Per school per year: one row per date with day type.
-- Attendance marking validates against this before accepting an entry.
-- Can be bulk-generated from org template then edited per branch.
-- =============================================================================
CREATE TABLE academic_calendar (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    date                    DATE NOT NULL,
    day_type                VARCHAR(20) NOT NULL
                                CHECK (day_type IN ('Working','Holiday','Half_Day','Weekend','Exam_Day')),
    reason                  VARCHAR(255),                    -- "Diwali", "Republic Day", "Local Holiday"
    created_from_template   BOOLEAN NOT NULL DEFAULT FALSE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_calendar_school_date UNIQUE (school_id, academic_year_id, date)
);

CREATE INDEX idx_calendar_school_date ON academic_calendar(school_id, date);


-- =============================================================================
-- 9. CLASSES
-- Grade levels. School-scoped, NOT year-scoped.
-- "Class 6" exists as a permanent concept — what changes year to year are Sections.
-- numeric_order ensures correct sort (Class 1, 2... 10, 11, 12 not alphabetical).
-- =============================================================================
CREATE TABLE classes (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    name                    VARCHAR(100) NOT NULL,           -- "Class 6", "Grade 6", "Standard VI"
    numeric_order           SMALLINT NOT NULL,               -- 1-20, for correct sorting
    description             VARCHAR(255),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_class_order UNIQUE (school_id, numeric_order),
    CONSTRAINT uq_class_name UNIQUE (school_id, name)
);

CREATE INDEX idx_classes_school ON classes(school_id);


-- =============================================================================
-- 10. SECTIONS
-- Year-scoped subdivision of a Class (6-A, 6-B, Morning, Day).
-- A new Section row is created each academic year even for the same letter.
-- =============================================================================
CREATE TABLE sections (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),

    name                    VARCHAR(50) NOT NULL,            -- "A", "B", "Morning", "Day"
    -- labels only — no downstream logic impact
    shift                   VARCHAR(20) CHECK (shift IN ('Morning','Day','Evening')),
    stream                  VARCHAR(50),                     -- "Science", "Commerce", "Arts"
    house                   VARCHAR(50),                     -- "Red", "Blue", "Green"

    max_students            SMALLINT,                        -- capacity for this year
    room_number             VARCHAR(20),
    status                  VARCHAR(20) NOT NULL DEFAULT 'Active'
                                CHECK (status IN ('Active','Inactive')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_section_name UNIQUE (academic_year_id, class_id, name)
);

CREATE INDEX idx_sections_school ON sections(school_id);
CREATE INDEX idx_sections_class_year ON sections(class_id, academic_year_id);


-- =============================================================================
-- 11. SECTION TEACHER ASSIGNMENTS
-- Dated record of which teacher is assigned to a section in which role.
-- Teacher changes mid-year create a new row (effective_to set on old row).
-- Never mutated — full history preserved.
-- =============================================================================
CREATE TABLE section_teacher_assignments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    section_id              BIGINT NOT NULL REFERENCES sections(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    user_id                 BIGINT NOT NULL REFERENCES users(id),
    role                    VARCHAR(30) NOT NULL
                                CHECK (role IN ('ClassTeacher','SubjectTeacher','CoTeacher','ActivityTeacher')),
    subject_id              BIGINT,                          -- populated if role = SubjectTeacher (FK added after subjects table)

    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to            DATE,                            -- NULL = currently active

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_sta_section ON section_teacher_assignments(section_id);
CREATE INDEX idx_sta_user ON section_teacher_assignments(user_id);
CREATE INDEX idx_sta_active ON section_teacher_assignments(section_id)
    WHERE effective_to IS NULL;


-- =============================================================================
-- 12. SYSTEM SUBJECT CATALOG
-- Platform-seeded master list of subjects. Schools pick from here.
-- Prevents naming inconsistencies ("Maths" vs "Math" vs "Mathematics").
-- Carries board-assigned subject codes for CBSE/ICSE compliance.
-- =============================================================================
CREATE TABLE system_subject_catalog (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    name                    VARCHAR(150) NOT NULL UNIQUE,
    short_name              VARCHAR(20),
    -- board-assigned code (e.g. CBSE code 041 = Mathematics)
    subject_code            VARCHAR(20),
    board_type              VARCHAR(20) NOT NULL DEFAULT 'Any'
                                CHECK (board_type IN ('Any','CBSE','ICSE','State_Board','IB')),
    category                VARCHAR(20) NOT NULL DEFAULT 'Scholastic'
                                CHECK (category IN ('Scholastic','CoScholastic','Vocational','Language')),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- 13. SUBJECTS
-- School-specific subjects. Can reference system catalog or be fully custom.
-- =============================================================================
CREATE TABLE subjects (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    -- link to catalog (nullable if school created a fully custom subject)
    catalog_subject_id      BIGINT REFERENCES system_subject_catalog(id),

    name                    VARCHAR(150) NOT NULL,
    short_name              VARCHAR(20),
    subject_code            VARCHAR(20),                     -- school's own code or inherited from catalog

    category                VARCHAR(20) NOT NULL DEFAULT 'Scholastic'
                                CHECK (category IN ('Scholastic','CoScholastic','Vocational','Language')),

    -- FALSE = this subject's marks are excluded from the main total/pass calculation
    -- handles: co-scholastic areas, activity subjects, CBSE Life Skills etc.
    counts_towards_result   BOOLEAN NOT NULL DEFAULT TRUE,
    -- TRUE = no numeric marks, grade entered directly (e.g. Art, PE in many schools)
    is_graded_only          BOOLEAN NOT NULL DEFAULT FALSE,

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_subject_school_name UNIQUE (school_id, name)
);

CREATE INDEX idx_subjects_school ON subjects(school_id);

-- Add subject FK to section_teacher_assignments now that subjects table exists
ALTER TABLE section_teacher_assignments
    ADD CONSTRAINT fk_sta_subject FOREIGN KEY (subject_id) REFERENCES subjects(id);


-- =============================================================================
-- 14. SUBJECT NAME HISTORY
-- Tracks subject name changes so historical documents reproduce the name
-- that was in use at time of generation.
-- =============================================================================
CREATE TABLE subject_name_history (
    id                      BIGSERIAL PRIMARY KEY,
    subject_id              BIGINT NOT NULL REFERENCES subjects(id),
    name                    VARCHAR(150) NOT NULL,
    effective_from          DATE NOT NULL,
    effective_to            DATE,
    changed_by              BIGINT REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snh_subject ON subject_name_history(subject_id);


-- =============================================================================
-- 15. SUBJECT GROUPS  (for CBSE/ICSE variable component weightage)
-- Groups subjects by their internal:external split rule.
-- e.g. CBSE: all subjects = 80% external + 20% internal
-- ICSE: Group I/II = 80/20, Group III = 50/50
-- Schools without grouping needs never create rows here.
-- =============================================================================
CREATE TABLE subject_groups (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    name                    VARCHAR(100) NOT NULL,           -- "Group I", "Core", "Default"
    description             VARCHAR(255),

    -- default component weightage for subjects in this group
    -- stored as JSONB: [{component_name, weightage_pct, max_marks, has_independent_pass}]
    default_component_config JSONB NOT NULL DEFAULT '[]',

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_sg_school_name UNIQUE (school_id, name)
);

CREATE INDEX idx_sg_school ON subject_groups(school_id);


-- =============================================================================
-- 16. CLASS SUBJECT MAPPINGS  (Template layer)
-- Defines which subjects a Class takes in a given Academic Year.
-- Starting point for auto-generating StudentSubjectEnrollments.
-- =============================================================================
CREATE TABLE class_subject_mappings (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),
    subject_id              BIGINT NOT NULL REFERENCES subjects(id),

    subject_group_id        BIGINT REFERENCES subject_groups(id),   -- nullable, for CBSE/ICSE grouping
    is_elective             BOOLEAN NOT NULL DEFAULT FALSE,          -- TRUE = not auto-assigned to all students
    sequence_number         SMALLINT NOT NULL DEFAULT 0,             -- display order on report card

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_csm_class_subject UNIQUE (academic_year_id, class_id, subject_id)
);

CREATE INDEX idx_csm_class_year ON class_subject_mappings(class_id, academic_year_id);
CREATE INDEX idx_csm_school ON class_subject_mappings(school_id);


-- =============================================================================
-- 17. STUDENTS
-- Core student identity record.
-- student has their own user login (user_id FK to users).
-- Never deleted — status tracks lifecycle.
-- =============================================================================
CREATE TABLE students (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    user_id                 BIGINT NOT NULL REFERENCES users(id) UNIQUE,  -- student's own login

    admission_number        VARCHAR(50) NOT NULL,
    admission_date          DATE NOT NULL,

    date_of_birth           DATE NOT NULL,
    gender                  VARCHAR(20) CHECK (gender IN ('Male','Female','Other','Prefer_Not_To_Say')),
    blood_group             VARCHAR(5),
    nationality             VARCHAR(50) NOT NULL DEFAULT 'Indian',
    religion                VARCHAR(50),

    -- for RTE / govt compliance reporting
    category                VARCHAR(10)
                                CHECK (category IN ('General','OBC','SC','ST','EWS','Other')),
    is_rte                  BOOLEAN NOT NULL DEFAULT FALSE,

    photo_url               VARCHAR(500),

    status                  VARCHAR(20) NOT NULL DEFAULT 'Active'
                                CHECK (status IN ('Active','Transferred_Out','Withdrawn','Passed_Out','Deceased')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_student_admission UNIQUE (school_id, admission_number)
);

CREATE INDEX idx_students_school ON students(school_id);
CREATE INDEX idx_students_user ON students(user_id);
CREATE INDEX idx_students_status ON students(school_id, status);


-- =============================================================================
-- 18. STUDENT GUARDIANS
-- Dated relationship between a student and their guardian(s).
-- Guardian changes (custody, bereavement) are tracked over time, not overwritten.
-- Guardians also have user accounts for parent-facing features.
-- =============================================================================
CREATE TABLE student_guardians (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    student_id              BIGINT NOT NULL REFERENCES students(id),
    user_id                 BIGINT NOT NULL REFERENCES users(id),   -- guardian's own login

    relationship_type       VARCHAR(20) NOT NULL
                                CHECK (relationship_type IN ('Father','Mother','Guardian','Sibling','Grandparent','Other')),
    is_primary              BOOLEAN NOT NULL DEFAULT FALSE,          -- primary contact for comms + fee responsibility
    can_pickup              BOOLEAN NOT NULL DEFAULT TRUE,           -- school safety: authorized to pick up child

    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to            DATE,                                    -- NULL = currently active

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_sg_student ON student_guardians(student_id);
CREATE INDEX idx_sg_user ON student_guardians(user_id);
CREATE INDEX idx_sg_active ON student_guardians(student_id) WHERE effective_to IS NULL;


-- =============================================================================
-- 19. STUDENT RELATIONSHIPS
-- Sibling / twin links between students at the same school.
-- Used by fees module for sibling concession eligibility.
-- =============================================================================
CREATE TABLE student_relationships (
    id                      BIGSERIAL PRIMARY KEY,
    student_id_1            BIGINT NOT NULL REFERENCES students(id),
    student_id_2            BIGINT NOT NULL REFERENCES students(id),
    relationship_type       VARCHAR(20) NOT NULL
                                CHECK (relationship_type IN ('Sibling','Twin')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_sr_pair UNIQUE (student_id_1, student_id_2),
    CONSTRAINT chk_sr_no_self CHECK (student_id_1 <> student_id_2)
);


-- =============================================================================
-- 20. PREVIOUS SCHOOL RECORDS
-- Lightweight provenance record for TC-in (transfer) students.
-- Stores where they came from, not the actual academic history.
-- =============================================================================
CREATE TABLE previous_school_records (
    id                      BIGSERIAL PRIMARY KEY,
    student_id              BIGINT NOT NULL REFERENCES students(id),

    school_name             VARCHAR(255) NOT NULL,
    board_type              VARCHAR(50),
    last_class_attended     VARCHAR(50),
    tc_number               VARCHAR(100),
    tc_date                 DATE,
    reason_for_leaving      VARCHAR(255),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);


-- =============================================================================
-- 21. STUDENT ENROLLMENTS
-- One row per student per academic year. Scope anchor for all yearly data.
-- section_id is nullable at start (student admitted before section finalized).
-- Never mutated year-over-year — promotion creates a new row for the new year.
-- =============================================================================
CREATE TABLE student_enrollments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),
    section_id              BIGINT REFERENCES sections(id),          -- nullable until section assigned

    roll_number             VARCHAR(20),                             -- assigned within section
    -- labels on enrollment (can differ from section defaults)
    stream                  VARCHAR(50),
    house                   VARCHAR(50),

    enrollment_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    enrollment_status       VARCHAR(30) NOT NULL DEFAULT 'Admitted'
                                CHECK (enrollment_status IN (
                                    'Admitted',         -- accepted, section not yet assigned
                                    'Section_Assigned', -- section set, not yet active
                                    'Active',           -- attending classes
                                    'Transferred_Out',  -- left mid-year with TC
                                    'Withdrawn',        -- left without TC
                                    'Passed_Out'        -- completed year
                                )),

    -- set at year-end after final result
    promotion_status        VARCHAR(30)
                                CHECK (promotion_status IN (
                                    'Pending',          -- not yet decided
                                    'Promoted',
                                    'Detained',
                                    'Compartment',      -- passed with conditions
                                    'Promoted_With_Improvement'
                                )),
    -- TRUE while waiting for supplementary exam result before next year enrollment
    promotion_pending       BOOLEAN NOT NULL DEFAULT FALSE,

    -- if this enrollment was created by org/school bulk action
    created_from_template   BOOLEAN NOT NULL DEFAULT FALSE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    -- one enrollment per student per year per school
    CONSTRAINT uq_enrollment_student_year UNIQUE (student_id, academic_year_id, school_id)
);

CREATE INDEX idx_se_school_year ON student_enrollments(school_id, academic_year_id);
CREATE INDEX idx_se_student ON student_enrollments(student_id);
CREATE INDEX idx_se_section ON student_enrollments(section_id);
CREATE INDEX idx_se_class_year ON student_enrollments(class_id, academic_year_id);


-- =============================================================================
-- 22. SECTION TRANSFER LOG
-- Tracks mid-year section moves without mutating the base enrollment.
-- Attendance records snapshot section_id at marking time, so historical
-- records remain accurate regardless of transfers.
-- =============================================================================
CREATE TABLE section_transfer_log (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    enrollment_id           BIGINT NOT NULL REFERENCES student_enrollments(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    from_section_id         BIGINT REFERENCES sections(id),
    to_section_id           BIGINT NOT NULL REFERENCES sections(id),
    effective_date          DATE NOT NULL,
    reason                  VARCHAR(255),

    approved_by             BIGINT REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_stl_student ON section_transfer_log(student_id);
CREATE INDEX idx_stl_enrollment ON section_transfer_log(enrollment_id);


-- =============================================================================
-- 23. STUDENT SUBJECT ENROLLMENTS  (Resolved layer)
-- The authoritative record: which subjects is this specific student being
-- assessed on this year. Auto-generated from ClassSubjectMapping on enrollment,
-- overridable for electives/drops/exemptions.
-- Exams, Attendance-per-subject, and Report Cards always read from here.
-- =============================================================================
CREATE TABLE student_subject_enrollments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    enrollment_id           BIGINT NOT NULL REFERENCES student_enrollments(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),
    section_id              BIGINT REFERENCES sections(id),
    subject_id              BIGINT NOT NULL REFERENCES subjects(id),

    enrollment_type         VARCHAR(10) NOT NULL DEFAULT 'Auto'
                                CHECK (enrollment_type IN ('Auto','Manual')),  -- Manual = elective override

    status                  VARCHAR(20) NOT NULL DEFAULT 'Active'
                                CHECK (status IN ('Active','Dropped','Exempted')),
    -- date range for when this subject was active for this student
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to            DATE,                                    -- NULL = still active

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_sse_student_subject_year UNIQUE (student_id, subject_id, academic_year_id)
);

CREATE INDEX idx_sse_enrollment ON student_subject_enrollments(enrollment_id);
CREATE INDEX idx_sse_student_year ON student_subject_enrollments(student_id, academic_year_id);
CREATE INDEX idx_sse_subject ON student_subject_enrollments(subject_id);
CREATE INDEX idx_sse_active ON student_subject_enrollments(enrollment_id)
    WHERE status = 'Active' AND effective_to IS NULL;
