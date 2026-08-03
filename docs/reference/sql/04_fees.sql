-- =============================================================================
-- FEES
-- Template → Resolved → Transactional pattern:
--   FeeHead (types of fee)
--   → FeeStructure (class-level template)
--     → StudentFeeAssignment (per-student resolved, with concessions)
--       → FeeInstallment (what's owed and when)
--         → FeePayment + PaymentAllocation (what actually arrived)
--
-- Key principles:
--   - Billing (installments) and collection (payments) are decoupled
--   - Invoiced amounts are snapshotted — fee revisions don't touch raised invoices
--   - Every money-movement writes to financial_transactions (unified ledger)
--   - Sequential immutable receipt numbers
--   - Payment status tracks cleared/bounced/reversed — not just success/fail
-- =============================================================================


-- =============================================================================
-- 30. FEE HEADS
-- Types of fee a school charges. Fully custom per school.
-- is_taxable flag for future GST compliance.
-- is_refundable reserved for security deposit type fees.
-- =============================================================================
CREATE TABLE fee_heads (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    name                    VARCHAR(150) NOT NULL,           -- "Tuition Fee", "Transport", "Lab Fee"
    short_code              VARCHAR(20),                     -- "TF", "TR", "LAB"
    description             VARCHAR(255),

    category                VARCHAR(30) NOT NULL DEFAULT 'Regular'
                                CHECK (category IN (
                                    'Regular',          -- standard recurring (tuition, activity)
                                    'One_Time',         -- admission fee, registration fee
                                    'Optional',         -- transport, hostel — opt-in
                                    'Fine',             -- late fee, damage fine
                                    'Refundable'        -- security deposit (reserved, not built yet)
                                )),

    is_taxable              BOOLEAN NOT NULL DEFAULT FALSE,  -- GST applicability flag
    tax_percentage          DECIMAL(5,2),                    -- populated if is_taxable = TRUE
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_fh_school_name UNIQUE (school_id, name)
);

CREATE INDEX idx_fh_school ON fee_heads(school_id);


-- =============================================================================
-- 31. FEE STRUCTURES  (Class-level template)
-- Defines which fee heads apply to a class in a given academic year,
-- amounts, and the installment generation cadence.
-- =============================================================================
CREATE TABLE fee_structures (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    class_id                BIGINT NOT NULL REFERENCES classes(id),

    name                    VARCHAR(150) NOT NULL,           -- "Class 6 Fee Structure 2025-26"

    -- how/when are installments generated?
    installment_mode        VARCHAR(20) NOT NULL DEFAULT 'Term_Wise'
                                CHECK (installment_mode IN (
                                    'Upfront',          -- all at once at year start
                                    'Term_Wise',        -- one batch per term (recommended default)
                                    'Monthly'           -- one installment per month
                                )),

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_fs_class_year UNIQUE (school_id, academic_year_id, class_id)
);

CREATE INDEX idx_fs_school_year ON fee_structures(school_id, academic_year_id);


-- =============================================================================
-- 32. FEE STRUCTURE LINES
-- Individual fee head entries within a fee structure.
-- Each line defines the amount and installment split for one fee head.
-- =============================================================================
CREATE TABLE fee_structure_lines (
    id                      BIGSERIAL PRIMARY KEY,
    fee_structure_id        BIGINT NOT NULL REFERENCES fee_structures(id),
    fee_head_id             BIGINT NOT NULL REFERENCES fee_heads(id),
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    annual_amount           DECIMAL(10,2) NOT NULL CHECK (annual_amount >= 0),

    -- how is this fee head split into installments?
    installment_frequency   VARCHAR(20) NOT NULL DEFAULT 'Inherit'
                                CHECK (installment_frequency IN (
                                    'Inherit',          -- follow fee_structure.installment_mode
                                    'Monthly',
                                    'Quarterly',
                                    'Half_Yearly',
                                    'Annual',           -- one-time, full amount in first installment
                                    'Term_Wise'
                                )),

    -- which months/terms does this fee apply to?
    -- e.g. tuition applies all 12 months, but a one-time admission fee only once
    applicable_from_month   SMALLINT DEFAULT 1 CHECK (applicable_from_month BETWEEN 1 AND 12),
    applicable_to_month     SMALLINT DEFAULT 12 CHECK (applicable_to_month BETWEEN 1 AND 12),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_fsl_structure_head UNIQUE (fee_structure_id, fee_head_id)
);

CREATE INDEX idx_fsl_structure ON fee_structure_lines(fee_structure_id);


-- =============================================================================
-- 33. STUDENT FEE ASSIGNMENTS  (Resolved layer)
-- Per-student fee record, auto-generated from FeeStructure on enrollment.
-- This is what the student actually owes — after any concessions applied.
-- Mid-session admission: only installments from admission_month onward generated.
-- =============================================================================
CREATE TABLE student_fee_assignments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    enrollment_id           BIGINT NOT NULL REFERENCES student_enrollments(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    fee_structure_id        BIGINT NOT NULL REFERENCES fee_structures(id),

    -- snapshotted from structure at time of assignment
    -- changes to structure after assignment do not affect this student
    base_annual_amount      DECIMAL(10,2) NOT NULL,          -- before concessions
    net_annual_amount       DECIMAL(10,2) NOT NULL,          -- after concessions

    -- for mid-session admissions: installments generated only from this date
    fee_effective_from      DATE NOT NULL,
    -- join month charged in full regardless of actual join date (school setting)
    joining_month_full_charge BOOLEAN NOT NULL DEFAULT TRUE,

    status                  VARCHAR(20) NOT NULL DEFAULT 'Active'
                                CHECK (status IN ('Active','Suspended','Cancelled')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_sfa_student_year UNIQUE (student_id, academic_year_id, school_id)
);

CREATE INDEX idx_sfa_student ON student_fee_assignments(student_id);
CREATE INDEX idx_sfa_school_year ON student_fee_assignments(school_id, academic_year_id);


-- =============================================================================
-- 34. FEE CONCESSIONS
-- Per-student discount/waiver on top of the resolved fee assignment.
-- Does not replace the base structure — only adjusts it.
-- Common types: sibling discount, staff ward, scholarship, RTE waiver.
-- =============================================================================
CREATE TABLE fee_concessions (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_fee_assignment_id BIGINT NOT NULL REFERENCES student_fee_assignments(id),
    fee_head_id             BIGINT REFERENCES fee_heads(id),    -- NULL = applies to all fee heads

    concession_type         VARCHAR(30) NOT NULL
                                CHECK (concession_type IN (
                                    'Sibling_Discount',
                                    'Staff_Ward',
                                    'Merit_Scholarship',
                                    'Need_Based',
                                    'RTE_Waiver',
                                    'Management_Discount',
                                    'Other'
                                )),

    calculation_type        VARCHAR(15) NOT NULL
                                CHECK (calculation_type IN ('Flat','Percentage')),
    value                   DECIMAL(10,2) NOT NULL CHECK (value > 0),
    -- computed and stored for audit
    concession_amount       DECIMAL(10,2) NOT NULL,

    reason                  VARCHAR(500),
    approved_by             BIGINT REFERENCES users(id),
    approved_at             TIMESTAMPTZ,
    valid_from              DATE NOT NULL,
    valid_to                DATE,                               -- NULL = full year

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_fc_assignment ON fee_concessions(student_fee_assignment_id);
CREATE INDEX idx_fc_student ON fee_concessions(school_id);


-- =============================================================================
-- 35. STUDENT OPTIONAL FEE SUBSCRIPTIONS
-- For opt-in services: Transport (route/zone-based), Hostel, Canteen.
-- Priced independently of class — not part of FeeStructure.
-- =============================================================================
CREATE TABLE student_optional_fee_subscriptions (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    fee_head_id             BIGINT NOT NULL REFERENCES fee_heads(id),

    service_detail          VARCHAR(255),                     -- "Route 3 - Dum Dum", "Hostel Block A"
    monthly_amount          DECIMAL(10,2) NOT NULL,
    annual_amount           DECIMAL(10,2) NOT NULL,

    subscribed_from         DATE NOT NULL,
    subscribed_to           DATE,                             -- NULL = full year
    status                  VARCHAR(20) NOT NULL DEFAULT 'Active'
                                CHECK (status IN ('Active','Cancelled','Suspended')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_sofs_student_year ON student_optional_fee_subscriptions(student_id, academic_year_id);


-- =============================================================================
-- 36. LATE FEE RULES
-- Configurable per school (and optionally per fee structure).
-- Late fee is computed live for display; frozen into payment at charge time.
-- =============================================================================
CREATE TABLE late_fee_rules (
    id                      BIGSERIAL PRIMARY KEY,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    fee_structure_id        BIGINT REFERENCES fee_structures(id),  -- NULL = applies school-wide

    grace_period_days       SMALLINT NOT NULL DEFAULT 0,
    calculation_type        VARCHAR(20) NOT NULL
                                CHECK (calculation_type IN (
                                    'Flat',             -- fixed amount after due date
                                    'Percentage',       -- % of overdue amount (one-time)
                                    'Per_Day'           -- accrues daily until paid
                                )),
    value                   DECIMAL(8,2) NOT NULL,          -- amount or percentage
    max_late_fee            DECIMAL(10,2),                  -- cap, nullable = no cap

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to            DATE,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)
);

CREATE INDEX idx_lfr_school ON late_fee_rules(school_id) WHERE is_active = TRUE;


-- =============================================================================
-- 37. FEE INSTALLMENTS  (Billing layer)
-- What a student owes and when. Generated per term/month per the school's
-- installment_mode. Once generated, amounts are snapshotted — a fee revision
-- affects only future (not yet generated) installments.
-- =============================================================================
CREATE TABLE fee_installments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_fee_assignment_id BIGINT NOT NULL REFERENCES student_fee_assignments(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    fee_head_id             BIGINT NOT NULL REFERENCES fee_heads(id),
    term_id                 BIGINT REFERENCES terms(id),            -- populated if term-wise generation

    installment_number      SMALLINT NOT NULL,
    description             VARCHAR(150),                           -- "April 2025 Tuition Fee"

    -- amounts snapshotted at generation time
    amount                  DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    concession_amount       DECIMAL(10,2) NOT NULL DEFAULT 0,
    net_amount              DECIMAL(10,2) NOT NULL,                 -- amount - concession_amount

    due_date                DATE NOT NULL,
    period_month            SMALLINT CHECK (period_month BETWEEN 1 AND 12),
    period_year             SMALLINT,

    -- payment tracking
    paid_amount             DECIMAL(10,2) NOT NULL DEFAULT 0,
    balance_amount          DECIMAL(10,2)
                                GENERATED ALWAYS AS (net_amount - paid_amount) STORED,
    payment_status          VARCHAR(20) NOT NULL DEFAULT 'Unpaid'
                                CHECK (payment_status IN (
                                    'Unpaid',
                                    'Partial',
                                    'Paid',
                                    'Waived',           -- explicitly waived by management
                                    'Cancelled'         -- student withdrew, future installments cancelled
                                )),

    -- late fee — computed live; frozen here when actually charged
    late_fee_applicable     DECIMAL(10,2) NOT NULL DEFAULT 0,
    late_fee_charged        DECIMAL(10,2) NOT NULL DEFAULT 0,
    late_fee_waived         DECIMAL(10,2) NOT NULL DEFAULT 0,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_installment UNIQUE (student_fee_assignment_id, fee_head_id, installment_number)
);

CREATE INDEX idx_fi_student_year ON fee_installments(student_id, academic_year_id);
CREATE INDEX idx_fi_due_date ON fee_installments(school_id, due_date);
CREATE INDEX idx_fi_status ON fee_installments(school_id, payment_status)
    WHERE payment_status IN ('Unpaid','Partial');
CREATE INDEX idx_fi_assignment ON fee_installments(student_fee_assignment_id);


-- =============================================================================
-- 38. OPENING BALANCES
-- Carries unpaid dues forward across academic year boundaries.
-- Tagged with origin year for traceability.
-- Separate from current year's fee structure — clean per-year scoping.
-- =============================================================================
CREATE TABLE opening_balances (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),  -- the NEW year
    origin_academic_year_id BIGINT NOT NULL REFERENCES academic_years(id),  -- where dues came from

    amount                  DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    description             VARCHAR(255),                   -- "Carried forward from 2024-25"

    paid_amount             DECIMAL(10,2) NOT NULL DEFAULT 0,
    balance_amount          DECIMAL(10,2)
                                GENERATED ALWAYS AS (amount - paid_amount) STORED,
    status                  VARCHAR(20) NOT NULL DEFAULT 'Unpaid'
                                CHECK (status IN ('Unpaid','Partial','Paid','Waived')),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id),

    CONSTRAINT uq_ob_student_year UNIQUE (student_id, academic_year_id, origin_academic_year_id)
);

CREATE INDEX idx_ob_student ON opening_balances(student_id, academic_year_id);


-- =============================================================================
-- 39. FEE PAYMENTS  (Collection layer)
-- Records actual money received. Decoupled from installments —
-- one payment can cover multiple installments (quarterly lump sum)
-- or partially cover one (partial payment).
-- Linked to installments via payment_allocations join table.
-- =============================================================================
CREATE TABLE fee_payments (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    -- sequential, immutable receipt number per school
    receipt_number          VARCHAR(50) NOT NULL,

    amount                  DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    late_fee_amount         DECIMAL(10,2) NOT NULL DEFAULT 0,  -- frozen at payment time
    total_amount            DECIMAL(10,2)
                                GENERATED ALWAYS AS (amount + late_fee_amount) STORED,

    payment_date            DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_mode            VARCHAR(20) NOT NULL
                                CHECK (payment_mode IN (
                                    'Cash',
                                    'UPI',
                                    'Cheque',
                                    'NEFT_RTGS',
                                    'Card',
                                    'DD',               -- Demand Draft
                                    'Online_Portal'
                                )),

    -- for non-cash payments
    transaction_reference   VARCHAR(150),                   -- UPI ref, cheque number, NEFT UTR
    bank_name               VARCHAR(100),
    cheque_date             DATE,                           -- for post-dated cheques

    -- payment lifecycle — not just success/fail
    payment_status          VARCHAR(20) NOT NULL DEFAULT 'Cleared'
                                CHECK (payment_status IN (
                                    'Pending',          -- UPI/cheque not yet confirmed
                                    'Cleared',          -- confirmed money received
                                    'Bounced',          -- cheque bounce
                                    'Reversed',         -- UPI reversal / refund
                                    'Cancelled'
                                )),
    status_updated_at       TIMESTAMPTZ,
    status_updated_by       BIGINT REFERENCES users(id),
    status_reason           VARCHAR(255),                   -- bounce reason, reversal reason

    remarks                 VARCHAR(500),
    collected_by            BIGINT REFERENCES users(id),    -- staff who collected/entered
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_receipt UNIQUE (school_id, receipt_number)
);

CREATE INDEX idx_fp_student_year ON fee_payments(student_id, academic_year_id);
CREATE INDEX idx_fp_school_date ON fee_payments(school_id, payment_date);
CREATE INDEX idx_fp_status ON fee_payments(school_id, payment_status);
CREATE INDEX idx_fp_receipt ON fee_payments(school_id, receipt_number);

COMMENT ON COLUMN fee_payments.receipt_number IS
    'Sequential and immutable. Never reused. Corrections via reversal entries only.';
COMMENT ON COLUMN fee_payments.late_fee_amount IS
    'Late fee frozen at time of payment. Immune to future rule changes.';


-- =============================================================================
-- 40. PAYMENT ALLOCATIONS
-- Join table: FeePayment ↔ FeeInstallment.
-- Decouples how money arrives from what it's paying for.
-- Handles: partial payments, bundled quarterly payments, advance payments.
-- =============================================================================
CREATE TABLE payment_allocations (
    id                      BIGSERIAL PRIMARY KEY,
    payment_id              BIGINT NOT NULL REFERENCES fee_payments(id),
    installment_id          BIGINT NOT NULL REFERENCES fee_installments(id),
    school_id               BIGINT NOT NULL REFERENCES schools(id),

    amount_allocated        DECIMAL(10,2) NOT NULL CHECK (amount_allocated > 0),
    allocated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_pa_payment_installment UNIQUE (payment_id, installment_id)
);

CREATE INDEX idx_pa_payment ON payment_allocations(payment_id);
CREATE INDEX idx_pa_installment ON payment_allocations(installment_id);


-- =============================================================================
-- 41. FEE REFUNDS
-- Records refunds against a payment (withdrawal, advance, bounce resolution).
-- References original payment — not a delete or overwrite.
-- =============================================================================
CREATE TABLE fee_refunds (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT NOT NULL REFERENCES students(id),
    original_payment_id     BIGINT NOT NULL REFERENCES fee_payments(id),

    refund_amount           DECIMAL(10,2) NOT NULL CHECK (refund_amount > 0),
    refund_date             DATE NOT NULL,
    refund_mode             VARCHAR(20) NOT NULL
                                CHECK (refund_mode IN ('Cash','UPI','Cheque','NEFT_RTGS','DD')),
    transaction_reference   VARCHAR(150),
    reason                  VARCHAR(500) NOT NULL,

    status                  VARCHAR(20) NOT NULL DEFAULT 'Processed'
                                CHECK (status IN ('Pending','Processed','Failed')),

    approved_by             BIGINT REFERENCES users(id),
    processed_by            BIGINT REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fr_student ON fee_refunds(student_id);
CREATE INDEX idx_fr_payment ON fee_refunds(original_payment_id);


-- =============================================================================
-- 42. FINANCIAL TRANSACTIONS  (Unified ledger)
-- Every money-movement event writes one row here — regardless of type.
-- Append-only. Never updated or deleted.
-- This is the single table accountants, Tally exporters, and GST reporters
-- query — no need to union across fee_payments, refunds, concessions.
-- =============================================================================
CREATE TABLE financial_transactions (
    id                      BIGSERIAL PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    student_id              BIGINT REFERENCES students(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),

    transaction_type        VARCHAR(30) NOT NULL
                                CHECK (transaction_type IN (
                                    'Fee_Payment',
                                    'Fee_Refund',
                                    'Late_Fee_Charged',
                                    'Concession_Applied',
                                    'Waiver_Applied',
                                    'Opening_Balance',
                                    'Opening_Balance_Payment',
                                    'Advance_Payment',
                                    'Cheque_Bounce_Charge',
                                    'Security_Deposit_Received',    -- reserved for future
                                    'Security_Deposit_Refunded'     -- reserved for future
                                )),

    direction               VARCHAR(10) NOT NULL
                                CHECK (direction IN ('Credit','Debit')),  -- Credit = money in, Debit = money out / reduction

    amount                  DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    fee_head_id             BIGINT REFERENCES fee_heads(id),
    reference_id            BIGINT,                         -- ID in source table (payment_id, refund_id etc.)
    reference_table         VARCHAR(50),                    -- 'fee_payments', 'fee_refunds' etc.
    receipt_number          VARCHAR(50),                    -- denormalised for quick lookup

    description             VARCHAR(500),
    transaction_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    is_taxable              BOOLEAN NOT NULL DEFAULT FALSE,
    tax_amount              DECIMAL(10,2) NOT NULL DEFAULT 0,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              BIGINT REFERENCES users(id)

    -- NO updated_at — this table is append-only, never updated
);

CREATE INDEX idx_ft_school_date ON financial_transactions(school_id, transaction_date);
CREATE INDEX idx_ft_student ON financial_transactions(student_id, academic_year_id);
CREATE INDEX idx_ft_type ON financial_transactions(school_id, transaction_type);

COMMENT ON TABLE financial_transactions IS
    'Append-only unified financial ledger. Never update or delete rows.
     All corrections happen via new offsetting entries (like double-entry bookkeeping).
     Single source of truth for accounting reports, Tally export, GST reporting.';


-- =============================================================================
-- 43. RECEIPT NUMBER SEQUENCES  (Per-school sequential receipts)
-- Ensures receipt numbers are sequential and unique per school.
-- Using a dedicated counter table rather than relying on BIGSERIAL
-- so receipt numbers can be formatted (e.g. "RCP-2025-00042").
-- =============================================================================
CREATE TABLE receipt_number_sequences (
    school_id               BIGINT NOT NULL REFERENCES schools(id),
    academic_year_id        BIGINT NOT NULL REFERENCES academic_years(id),
    last_number             BIGINT NOT NULL DEFAULT 0,
    prefix                  VARCHAR(20) NOT NULL DEFAULT 'RCP',

    PRIMARY KEY (school_id, academic_year_id)
);

COMMENT ON TABLE receipt_number_sequences IS
    'Counter table for generating sequential receipt numbers per school per year.
     Application must use SELECT ... FOR UPDATE to prevent race conditions.';
