-- =============================================================================
-- ATTENDANCE
-- Two-layer pattern (consistent with rest of system):
--   AttendanceRecord (granular: daily or per-period)
--   → DailyAttendanceStatus (always-present resolved record)
--
-- Key principles:
--   - section_id snapshotted at time of marking (historical integrity)
--   - corrections are audited, never silent overwrites
--   - DailyAttendanceStatus is the single source of truth for all downstream
--     modules (fees, exam eligibility, CBSE/UDISE+ reporting)
-- =============================================================================


-- =============================================================================
-- 24. ATTENDANCE MARKING POLICY  (School-level config)
-- Controls who can mark attendance and at what granularity.
-- Actual role enforcement deferred to authz system; this table stores the
-- configuration so authz has data to work with when built.
-- =============================================================================
CREATE TABLE attendance_policies (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id) UNIQUE,  -- one policy per school

    marking_mode            VARCHAR(20) NOT NULL DEFAULT 'Daily'
                                CHECK (marking_mode IN ('Daily','Period_Wise')),

    -- for period-wise schools: how is the single daily status derived?
    daily_status_rule       VARCHAR(30) NOT NULL DEFAULT 'Homeroom_Authoritative'
                                CHECK (daily_status_rule IN (
                                    'Homeroom_Authoritative',   -- first/homeroom period decides
                                    'Threshold_Percentage'      -- X% of periods = Present
                                )),
    threshold_percentage    SMALLINT                             -- used when rule = Threshold_Percentage
                                CHECK (threshold_percentage BETWEEN 1 AND 100),

    -- late arrival window (minutes after start time = Late, not Absent)
    late_arrival_minutes    SMALLINT NOT NULL DEFAULT 15,

    -- roles allowed to mark attendance (stored as array; authz engine reads this)
    can_mark_roles          TEXT[] NOT NULL DEFAULT ARRAY['ClassTeacher','Teacher'],
    -- roles allowed to correct attendance after it's been marked
    can_correct_roles       TEXT[] NOT NULL DEFAULT ARRAY['Principal','Vice_Principal','ClassTeacher'],

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by              BIGINT REFERENCES users(id)
);


-- =============================================================================
-- 25. PERIODS  (for period-wise schools)
-- Defines the period structure for a section in a given academic year.
-- Schools using daily-only mode never populate this table.
-- =============================================================================
CREATE TABLE periods (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    section_id              BIGINT NOT NULL REFERENCES sections(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    name                    VARCHAR(50) NOT NULL,            -- "Period 1", "Homeroom", "Lunch"
    sequence_number         SMALLINT NOT NULL,
    is_homeroom             BOOLEAN NOT NULL DEFAULT FALSE,  -- the authoritative period for daily status
    subject_id              BIGINT REFERENCES subjects(id),  -- which subject this period covers
    teacher_id              BIGINT REFERENCES users(id),

    -- time is informational; actual date of marking is on AttendanceRecord
    start_time              TIME,
    end_time                TIME,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_period_sequence UNIQUE (section_id, academic_year_id, sequence_number)
);

CREATE INDEX idx_periods_section ON periods(section_id, academic_year_id);


-- =============================================================================
-- 26. ATTENDANCE RECORDS  (Granular layer)
-- One row per student per day (daily mode) OR
-- one row per student per period per day (period-wise mode).
-- period_id is NULL for daily-mode schools.
-- section_id is SNAPSHOTTED at time of marking — never live-referenced.
-- =============================================================================
CREATE TABLE attendance_records (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    date                    DATE NOT NULL,

    -- snapshotted at time of marking for historical integrity
    -- even if student later transfers sections, this stays as-was
    section_id              BIGINT NOT NULL REFERENCES sections(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),

    -- NULL for daily-mode schools; populated for period-wise
    period_id               BIGINT REFERENCES periods(id),

    status                  VARCHAR(20) NOT NULL
                                CHECK (status IN (
                                    'Present',
                                    'Absent',
                                    'Late',             -- arrived within late_arrival_minutes window
                                    'Half_Day',         -- present for only part of the day
                                    'On_Leave',         -- approved leave (medical, event)
                                    'Holiday'           -- shouldn't normally appear; guard value
                                )),

    leave_type              VARCHAR(30)                          -- populated if status = On_Leave
                                CHECK (leave_type IN ('Medical','Family','Event','Other')),
    remarks                 VARCHAR(255),

    marked_by               BIGINT NOT NULL REFERENCES users(id),
    marked_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- current status of this record in its lifecycle
    record_status           VARCHAR(20) NOT NULL DEFAULT 'Marked'
                                CHECK (record_status IN ('Marked','Corrected','Voided')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- daily-mode: one record per student per date
    -- period-wise: one record per student per date per period
    CONSTRAINT uq_attendance_daily UNIQUE (student_id, date, school_id, period_id)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_ar_school_date ON attendance_records(school_id, date);
CREATE INDEX idx_ar_student_date ON attendance_records(student_id, date);
CREATE INDEX idx_ar_section_date ON attendance_records(section_id, date);

COMMENT ON COLUMN attendance_records.section_id IS
    'Snapshotted at marking time. Historical integrity: mid-year section transfers
     do not retroactively change past attendance records.';


-- =============================================================================
-- 27. ATTENDANCE CORRECTIONS
-- Audit trail for every change to an attendance record.
-- Original record is never overwritten — correction creates a new row here
-- and updates attendance_records.record_status to Corrected.
-- =============================================================================
CREATE TABLE attendance_corrections (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    attendance_record_id    BIGINT NOT NULL REFERENCES attendance_records(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),

    previous_status         VARCHAR(20) NOT NULL,
    new_status              VARCHAR(20) NOT NULL,
    reason                  VARCHAR(500) NOT NULL,

    corrected_by            BIGINT NOT NULL REFERENCES users(id),
    corrected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by             BIGINT REFERENCES users(id),          -- if school requires approval
    approved_at             TIMESTAMPTZ
);

CREATE INDEX idx_ac_record ON attendance_corrections(attendance_record_id);
CREATE INDEX idx_ac_student ON attendance_corrections(student_id);


-- =============================================================================
-- 28. DAILY ATTENDANCE STATUS  (Resolved / authoritative layer)
-- ALWAYS present for every student for every working day — regardless of
-- whether the school uses daily or period-wise marking.
--
-- For daily-mode schools: direct copy of the single AttendanceRecord.
-- For period-wise schools: derived from period records via the school's rule
--   (Homeroom_Authoritative or Threshold_Percentage).
--
-- This is the ONLY table downstream modules (fees fines, exam eligibility,
-- CBSE/UDISE+ reporting) should ever query for attendance data.
-- =============================================================================
CREATE TABLE daily_attendance_status (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    section_id              BIGINT NOT NULL REFERENCES sections(id),   -- snapshotted
    class_id                BIGINT NOT NULL REFERENCES classes(id),

    date                    DATE NOT NULL,

    status                  VARCHAR(20) NOT NULL
                                CHECK (status IN ('Present','Absent','Late','Half_Day','On_Leave')),

    -- for period-wise schools: how many periods present/total
    periods_present         SMALLINT,
    periods_total           SMALLINT,

    -- source of this record
    derivation_mode         VARCHAR(30) NOT NULL
                                CHECK (derivation_mode IN (
                                    'Direct',               -- daily-mode: copied directly
                                    'Homeroom_Authoritative',
                                    'Threshold_Percentage',
                                    'Manual_Override'       -- principal/admin overrode
                                )),

    -- if manually overridden, link to who did it and why
    override_by             BIGINT REFERENCES users(id),
    override_reason         VARCHAR(500),
    override_at             TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_das_student_date UNIQUE (student_id, date, school_id)
);

CREATE INDEX idx_das_school_date ON daily_attendance_status(school_id, date);
CREATE INDEX idx_das_student_year ON daily_attendance_status(student_id, academic_year_id);
CREATE INDEX idx_das_section_date ON daily_attendance_status(section_id, date);

COMMENT ON TABLE daily_attendance_status IS
    'Single source of truth for attendance. All downstream modules read ONLY this table.
     Never query attendance_records directly from fees/exams/reporting modules.';


-- =============================================================================
-- 29. ATTENDANCE SUMMARY  (Pre-aggregated, refreshed periodically)
-- Stores cumulative present/absent/late counts per student per month and
-- per term. Avoids expensive COUNT queries on daily_attendance_status
-- every time a report card or fee fine calculation is needed.
-- Refreshed nightly or on any attendance change.
-- =============================================================================
CREATE TABLE attendance_summary (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    term_id                 BIGINT REFERENCES terms(id),             -- NULL = full-year summary

    period_type             VARCHAR(10) NOT NULL
                                CHECK (period_type IN ('Monthly','Term','Annual')),
    period_month            SMALLINT CHECK (period_month BETWEEN 1 AND 12),  -- for Monthly
    period_year             SMALLINT NOT NULL,

    working_days            SMALLINT NOT NULL DEFAULT 0,
    days_present            SMALLINT NOT NULL DEFAULT 0,
    days_absent             SMALLINT NOT NULL DEFAULT 0,
    days_late               SMALLINT NOT NULL DEFAULT 0,
    days_on_leave           SMALLINT NOT NULL DEFAULT 0,
    attendance_percentage   DECIMAL(5,2)
                                GENERATED ALWAYS AS (
                                    CASE WHEN working_days = 0 THEN 0
                                    ELSE ROUND((days_present::DECIMAL / working_days) * 100, 2)
                                    END
                                ) STORED,

    last_computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_as_student_period UNIQUE (student_id, academic_year_id, period_type, period_month, period_year)
);

CREATE INDEX idx_as_student_year ON attendance_summary(student_id, academic_year_id);
CREATE INDEX idx_as_school_term ON attendance_summary(school_id, term_id);
