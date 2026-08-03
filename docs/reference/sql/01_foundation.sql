-- =============================================================================
-- SMS DATABASE SCHEMA
-- PostgreSQL 15+
-- Multi-tenant: shared DB, shared schema, school_id on every tenant-scoped table
-- IDs: BIGSERIAL (internal FKs) + UUID (external/public facing)
-- Conventions:
--   - snake_case everywhere
--   - created_at / updated_at on every table
--   - soft deletes via status enum, never hard DELETE on core records
--   - audit fields (created_by, updated_by) reference users.id
-- =============================================================================

-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- for exclusion constraints on date ranges


-- =============================================================================
-- 1. ORGANIZATIONS
-- Top-level entity. One per Trust / Society / Owner group.
-- An org can own multiple School branches.
-- =============================================================================
CREATE TABLE organizations (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    name                VARCHAR(255) NOT NULL,
    legal_name          VARCHAR(255) NOT NULL,           -- as per registration docs
    registration_number VARCHAR(100),                    -- trust/society reg number
    registration_type   VARCHAR(50),                     -- 'Trust' | 'Society' | 'Pvt Ltd' | 'Other'

    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    city                VARCHAR(100),
    state               VARCHAR(100),
    pincode             VARCHAR(10),
    country             VARCHAR(100) NOT NULL DEFAULT 'India',

    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(20),
    website_url         VARCHAR(500),
    logo_url            VARCHAR(500),

    status              VARCHAR(20) NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active', 'Inactive', 'Suspended')),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE organizations IS
    'Top-level entity. One per Trust/Society/Owner. Parent of all School branches.';


-- =============================================================================
-- 2. SCHOOLS (Branches)
-- Each row = one physical school branch under an Organization.
-- school_id is the primary tenant key used on almost every downstream table.
-- =============================================================================
CREATE TABLE schools (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    organization_id     BIGINT NOT NULL REFERENCES organizations(id),

    name                VARCHAR(255) NOT NULL,
    legal_name          VARCHAR(255) NOT NULL,           -- snapshotted on documents at generation time

    affiliation_type    VARCHAR(20) NOT NULL DEFAULT 'None'
                            CHECK (affiliation_type IN ('None','CBSE','ICSE','State_Board','IB','IGCSE','Other')),
    affiliation_number  VARCHAR(100),                    -- board registration number
    udise_code          VARCHAR(20),                     -- UDISE+ code for govt reporting

    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    city                VARCHAR(100),
    state               VARCHAR(100),
    pincode             VARCHAR(10),
    country             VARCHAR(100) NOT NULL DEFAULT 'India',

    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(20),
    logo_url            VARCHAR(500),

    established_date    DATE,
    timezone            VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',

    status              VARCHAR(20) NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active', 'Inactive', 'Closed')),
    -- controls whether org-level bulk actions (start session etc.) include this branch
    is_active_for_bulk  BOOLEAN NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          BIGINT                           -- references users.id, nullable on bootstrap
);

CREATE INDEX idx_schools_organization ON schools(organization_id);
CREATE INDEX idx_schools_status ON schools(status) WHERE status = 'Active';

COMMENT ON TABLE schools IS
    'One row per physical school branch. school_id is the tenant key for all downstream tables.';
COMMENT ON COLUMN schools.legal_name IS
    'Snapshotted onto report cards, receipts, certificates at generation time — not live-linked.';


-- =============================================================================
-- 3. USERS
-- Central identity table. One row per human.
-- A user can be a Teacher, Principal, Student, Guardian, Owner, Accountant —
-- role is NOT stored here, it lives in user_school_assignments.
-- Users are NEVER deleted — only deactivated. Preserves entered_by integrity.
-- =============================================================================
CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    full_name           VARCHAR(255) NOT NULL,
    legal_name          VARCHAR(255),                    -- as per govt ID, used on certificates
    email               VARCHAR(255) UNIQUE,
    phone               VARCHAR(20) UNIQUE,

    password_hash       VARCHAR(255),                    -- null if SSO/OTP only
    date_of_birth       DATE,
    gender              VARCHAR(20) CHECK (gender IN ('Male','Female','Other','Prefer_Not_To_Say')),
    profile_photo_url   VARCHAR(500),

    status              VARCHAR(20) NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active', 'Inactive', 'Suspended')),

    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS
    'Central identity. Role is in user_school_assignments, not here.
     Never hard-deleted — status=Inactive only.';
COMMENT ON COLUMN users.legal_name IS
    'Used on certificates and official documents. May differ from display full_name.';


-- =============================================================================
-- 4. USER SCHOOL ASSIGNMENTS
-- Join table: User ↔ School ↔ Role
-- One person can have multiple rows:
--   - different roles at the same school (Teacher + Exam Coordinator)
--   - same role across multiple schools (Accountant at 3 branches)
--   - org-level role: school_id IS NULL, organization_id is set (Owner, Org Admin)
-- =============================================================================
CREATE TABLE user_school_assignments (
    id                  BIGSERIAL PRIMARY KEY,
    public_id           UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,

    user_id             BIGINT NOT NULL REFERENCES users(id),
    school_id           BIGINT REFERENCES schools(id),          -- NULL for org-level roles
    organization_id     BIGINT NOT NULL REFERENCES organizations(id),

    role                VARCHAR(50) NOT NULL
                            CHECK (role IN (
                                'Owner', 'Org_Admin',           -- org-level, school_id is NULL
                                'Principal', 'Vice_Principal',
                                'Teacher', 'Class_Teacher',
                                'Accountant', 'Admin_Staff',
                                'Librarian', 'Counselor',
                                'Student', 'Guardian',
                                'Other'
                            )),

    -- date-ranged: tracks joins, role changes, departures
    effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to        DATE,                                    -- NULL = currently active

    is_primary_role     BOOLEAN NOT NULL DEFAULT TRUE,          -- primary role for this school assignment

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          BIGINT REFERENCES users(id),

    -- org-level roles must have school_id NULL; school-level roles must have school_id set
    CONSTRAINT chk_role_scope CHECK (
        (role IN ('Owner','Org_Admin') AND school_id IS NULL) OR
        (role NOT IN ('Owner','Org_Admin') AND school_id IS NOT NULL)
    ),
    -- no overlapping active assignment for same user+school+role
    CONSTRAINT uq_user_school_role_active UNIQUE (user_id, school_id, role, effective_from)
);

CREATE INDEX idx_usa_user ON user_school_assignments(user_id);
CREATE INDEX idx_usa_school ON user_school_assignments(school_id);
CREATE INDEX idx_usa_org ON user_school_assignments(organization_id);
CREATE INDEX idx_usa_active ON user_school_assignments(school_id, role)
    WHERE effective_to IS NULL;

COMMENT ON TABLE user_school_assignments IS
    'User-School-Role join. Supports multi-role, multi-school, org-level roles.
     Dated: effective_from/to tracks role history without mutation.';
